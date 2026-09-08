// src/framework/store/sync.js — the sync & conflict engine (roadmap task 3).
//
// Layered on top of the document store. Its job:
//   • On every startup (and on demand) reconcile the local cache against the
//     canonical cloud documents — refresh anything that changed upstream.
//   • When a local draft exists (a change staged while offline, or a write the
//     store couldn't push, or a change a read-only device saved), detect
//     whether the canonical has moved since the draft was based. If it has,
//     open a CONFLICT record that preserves BOTH sides and let the user
//     resolve: keep-mine / keep-theirs / a 3-way field-level merge. A
//     resolution is never destructive — every side is also kept in a
//     per-document resolution history.
//
// The engine shares the store's cache (one kv folder per namespace) and talks
// to the store only through its public API, so it works identically against
// the real cloud channel and the in-memory test backends.

import { StoreError, CODES } from "./errors.js";
import { hashString } from "./chunking.js";
import { KEYS, makeDraft, makeConflict } from "./records.js";

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- field-level merge ----------------------------------------------------
// `merge3` produces a merged value that keeps as much of both sides as
// possible. With a known common ancestor (base) it's a real 3-way merge: a
// field only one side changed is taken from that side; only when BOTH sides
// changed a scalar differently does the policy decide. Arrays are unioned by
// item id (same-id items are themselves merged), so neither side's entries
// are dropped. Without a base it degrades to a safe 2-way merge.

export function merge3(mine, theirs, base, policy = {}) {
  const opts = { arrays: policy.arrays || "union", scalar: policy.scalar || "theirs" };
  const hasBase = base !== undefined && base !== null;
  return mergeField(mine, theirs, hasBase ? base : undefined, opts, hasBase);
}

function mergeField(m, t, b, opts, hasBase) {
  if (deepEqual(m, t)) return t;
  if (hasBase) {
    const mChanged = !deepEqual(m, b);
    const tChanged = !deepEqual(t, b);
    if (!mChanged) return t; // only the other side changed it
    if (!tChanged) return m; // only we changed it
  }
  if (isObj(m) && isObj(t)) {
    const keys = new Set([...Object.keys(m), ...Object.keys(t)]);
    const out = {};
    for (const k of keys) {
      if (k in m && k in t) out[k] = mergeField(m[k], t[k], hasBase ? b[k] : undefined, opts, hasBase);
      else out[k] = k in t ? t[k] : m[k];
    }
    return out;
  }
  if (Array.isArray(m) && Array.isArray(t)) {
    return unionById(t, m, hasBase ? b : undefined, opts, hasBase);
  }
  return opts.scalar === "mine" ? m : t;
}

// Union of two arrays of items (theirs first, mine's new items appended).
// Objects are keyed by `id`; scalars by value. Items present on both sides
// are merged field-by-field rather than dropped, so neither side's edits
// vanish.
function unionById(theirs, mine, base, opts, hasBase) {
  if (!theirs.length) return mine;
  if (!mine.length) return theirs;
  const out = [];
  const byKey = new Map();
  for (const it of [...theirs, ...mine]) {
    const key = isObj(it) ? it.id : it;
    if (key === undefined) {
      out.push(it);
      continue;
    }
    if (byKey.has(key)) {
      const i = byKey.get(key);
      const baseItem =
        hasBase && Array.isArray(base) ? base.find((x) => (isObj(x) ? x.id === key : x === key)) : undefined;
      out[i] = mergeField(it, out[i], baseItem, opts, hasBase); // mine is m, theirs is t (policy applies to t)
    } else {
      byKey.set(key, out.length);
      out.push(it);
    }
  }
  return out;
}

// ---- the engine ------------------------------------------------------------

export function createSyncEngine({ store, cache, now = () => Date.now() }) {
  const cacheGet = async (k) => {
    try {
      return await cache.get(k);
    } catch {
      return undefined;
    }
  };
  const cacheSet = async (k, v) => {
    try {
      await cache.set(k, v);
    } catch {}
  };
  const cacheDel = async (k) => {
    try {
      await cache.del(k);
    } catch {}
  };

  async function entriesByPrefix(prefix) {
    try {
      const entries = await cache.entries();
      return (entries || []).filter(([k]) => String(k).startsWith(prefix));
    } catch {
      return [];
    }
  }

  async function listConflicts() {
    const es = await entriesByPrefix("conflict::");
    const out = [];
    for (const [k, v] of es) {
      if (v && !v.resolved) out.push({ id: k.slice("conflict::".length), conflict: v });
    }
    return out.sort((a, b) => (a.conflict.detectedAt || 0) - (b.conflict.detectedAt || 0));
  }

  async function listDrafts() {
    const es = await entriesByPrefix("draft::");
    return es.map(([k, v]) => ({ id: k.slice("draft::".length), draft: v }));
  }

  // Stage a local change that couldn't reach the canonical copy yet. The
  // canonical state the change was based on is captured so a later 3-way merge
  // has its common ancestor.
  async function stageDraft(id, data, opts = {}) {
    const base = await cacheGet(KEYS.syncBase(id));
    let baseData = null;
    const cached = await cacheGet("doc::" + id);
    if (cached && cached.data !== undefined) baseData = cached.data;
    const draft = makeDraft({
      data,
      base,
      baseData,
      at: now(),
      updatedBy: opts.updatedBy || "system",
      reason: opts.reason || "manual",
      attempts: 0,
    });
    await cacheSet(KEYS.draft(id), draft);
    return draft;
  }

  async function openConflict(id, { mine, theirs, base = null }) {
    const record = makeConflict({ mine, theirs, base, at: now() });
    await cacheSet(KEYS.conflict(id), record);
    return record;
  }

  async function recordResolution(id, record) {
    const key = KEYS.resolution(id);
    const hist = (await cacheGet(key)) || [];
    hist.push(record);
    await cacheSet(key, hist);
  }

  async function canonicalSnapshot(id) {
    const doc = await store.readDocument(id, { force: true });
    if (!doc) return null;
    return { version: doc.version, hash: doc.hash, data: doc.data, at: doc.updatedAt || now() };
  }

  // Inspect one document against its canonical state and either refresh,
  // push a safe draft, open a conflict, or report it in sync.
  async function detect(id, canonical) {
    const conflict = await cacheGet(KEYS.conflict(id));
    if (conflict && !conflict.resolved) return { id, state: "conflict", conflict };

    const draft = await cacheGet(KEYS.draft(id));
    const base = await cacheGet(KEYS.syncBase(id));

    if (!canonical) {
      // Nothing on the cloud for this id.
      if (draft) {
        // A change staged for a brand-new document → try to create it.
        try {
          const res = await store.writeDocument(id, draft.data, { updatedBy: draft.updatedBy || "system" });
          const doc = res.doc;
          await cacheSet(KEYS.syncBase(id), {
            version: doc ? doc.version : 1,
            hash: doc ? doc.hash : null,
            at: now(),
          });
          await cacheDel(KEYS.draft(id));
          return { id, state: "draft-pushed", version: doc ? doc.version : 1 };
        } catch (e) {
          return { id, state: "pending", reason: "no-cloud-write", error: e };
        }
      }
      if (base) {
        // Deleted upstream while we still hold a local copy — keep it, never
        // silently discard. (Restore/export flows arrive with backup & restore.)
        return { id, state: "deleted-remote" };
      }
      return { id, state: "absent" };
    }

    if (draft) {
      if (draft.baseHash === canonical.hash) {
        // Canonical hasn't moved since the draft was based → pushing is safe.
        if (draft.attempts >= 2) {
          // Already failed a couple of times; stop retrying and surface it.
          const theirs = await canonicalSnapshot(id);
          const rec = await openConflict(id, {
            mine: draft,
            theirs,
            base: draft.baseData ? { data: draft.baseData } : null,
          });
          return { id, state: "conflict", conflict: rec };
        }
        try {
          const res = await store.writeDocument(id, draft.data, { updatedBy: draft.updatedBy || "system" });
          const doc = res.doc;
          await cacheSet(KEYS.syncBase(id), {
            version: doc ? doc.version : canonical.version + 1,
            hash: doc ? doc.hash : canonical.hash,
            at: now(),
          });
          await cacheDel(KEYS.draft(id));
          return { id, state: "draft-pushed", version: doc ? doc.version : null };
        } catch (e) {
          const d = { ...draft, attempts: (draft.attempts || 0) + 1 };
          await cacheSet(KEYS.draft(id), d);
          if (d.attempts >= 2) {
            const theirs = await canonicalSnapshot(id);
            const rec = await openConflict(id, {
              mine: d,
              theirs,
              base: d.baseData ? { data: d.baseData } : null,
            });
            return { id, state: "conflict", conflict: rec };
          }
          return { id, state: "pending", reason: "push-failed", error: e };
        }
      }
      // Canonical moved since the draft was based → genuine two-sided conflict.
      const theirs = await canonicalSnapshot(id);
      const rec = await openConflict(id, {
        mine: draft,
        theirs,
        base: draft.baseData ? { data: draft.baseData } : null,
      });
      return { id, state: "conflict", conflict: rec };
    }

    // No local change: just track the canonical.
    if (!base || base.hash !== canonical.hash) {
      await cacheSet(KEYS.syncBase(id), { version: canonical.version, hash: canonical.hash, at: now() });
      return { id, state: "refreshed" };
    }
    return { id, state: "synced" };
  }

  // Full reconcile: coerce the local cache, then inspect every canonical doc.
  async function reconcile() {
    try {
      await store.sync();
    } catch (e) {
      return { error: e };
    }
    const docs = await store.listDocuments().catch(() => []);
    const canon = new Map(docs.map((d) => [d.id, { version: d.version, hash: d.hash }]));
    const result = { checked: 0, pushed: 0, refreshed: 0, conflicts: [], pending: [], deletedRemote: 0, errors: [] };
    for (const [id, meta] of canon) {
      result.checked++;
      try {
        const s = await detect(id, meta);
        if (s.state === "conflict") result.conflicts.push(s);
        else if (s.state === "draft-pushed") result.pushed++;
        else if (s.state === "refreshed") result.refreshed++;
        else if (s.state === "pending") result.pending.push(s);
        else if (s.state === "deleted-remote") result.deletedRemote++;
      } catch (e) {
        result.errors.push({ id, error: e });
      }
    }
    // Also inspect docs we know locally that are no longer in the canonical
    // registry (deleted upstream, or local-only drafts awaiting creation).
    const localIds = new Set();
    for (const [k] of await entriesByPrefix("sync-base::")) localIds.add(k.slice("sync-base::".length));
    for (const [k] of await entriesByPrefix("draft::")) localIds.add(k.slice("draft::".length));
    for (const id of localIds) {
      if (canon.has(id)) continue;
      result.checked++;
      try {
        const s = await detect(id, null);
        if (s.state === "conflict") result.conflicts.push(s);
        else if (s.state === "draft-pushed") result.pushed++;
        else if (s.state === "pending") result.pending.push(s);
        else if (s.state === "deleted-remote") result.deletedRemote++;
      } catch (e) {
        result.errors.push({ id, error: e });
      }
    }
    await cacheSet(KEYS.lastReconciled, now());
    return result;
  }

  // Resolve an open conflict: keep-mine, keep-theirs, or field-level merge.
  async function resolveConflict(id, choice) {
    const conflict = await cacheGet(KEYS.conflict(id));
    if (!conflict) {
      throw new StoreError(CODES.INVALID_DATA, `No open conflict for "${id}" — it may already be resolved.`);
    }
    let adopted = null;
    let action = choice;

    if (choice === "theirs") {
      // Adopt the CURRENT canonical (it may have advanced since detection).
      const nowDoc = await store.readDocument(id, { force: true }).catch(() => null);
      if (nowDoc) adopted = { data: nowDoc.data, hash: nowDoc.hash, version: nowDoc.version };
      else adopted = { data: conflict.theirs.data, hash: conflict.theirs.hash, version: conflict.theirs.version };
    } else if (choice === "mine" || choice === "merge") {
      let data;
      if (choice === "mine") {
        data = conflict.mine.data;
        action = "keep-mine";
      } else {
        data = merge3(conflict.mine.data, conflict.theirs.data, conflict.base ? conflict.base.data : undefined);
        if (deepEqual(data, conflict.theirs.data)) {
          adopted = { data, hash: conflict.theirs.hash, version: conflict.theirs.version };
          action = "merge-theirs"; // merge collapsed to theirs — no write needed
        } else if (deepEqual(data, conflict.mine.data)) {
          action = "merge-mine"; // merge collapsed to ours — still write it
        } else {
          action = "merge";
        }
      }
      if (!adopted) {
        const res = await store.writeDocument(id, data, { updatedBy: choice === "mine" ? conflict.mine.updatedBy || "system" : "merge" });
        if (res.conflicted) {
          throw new StoreError(
            CODES.CONCURRENT_WRITE,
            `"${id}" changed again on the cloud while you were resolving — re-check the conflict before deciding.`,
          );
        }
        adopted = {
          data,
          hash: res.doc ? res.doc.hash : null,
          version: res.doc ? res.doc.version : (conflict.mine.baseVersion || 0) + 1,
        };
      }
    } else {
      throw new StoreError(CODES.INVALID_DATA, `Unknown resolution "${choice}".`);
    }

    // Record the resolution (with both sides attached) so nothing is ever
    // silently destroyed, then clear the conflict and re-sync.
    await recordResolution(id, {
      action,
      at: now(),
      mine: conflict.mine,
      theirs: conflict.theirs,
      adopted: { hash: adopted.hash, version: adopted.version },
    });
    await cacheDel(KEYS.draft(id));
    await cacheDel(KEYS.conflict(id));
    await cacheSet(KEYS.syncBase(id), { version: adopted.version, hash: adopted.hash, at: now() });
    try {
      await store.readDocument(id, { force: true }); // warm the cache to the adopted content
    } catch {}
    return { id, action, version: adopted.version, hash: adopted.hash };
  }

  // Called after a confirmed write so sync state stays coherent without a full
  // reconcile. A write FULFILLS a staged draft only when it produced the same
  // content; a different-content write leaves the draft in place so the
  // divergence is surfaced as a conflict instead of being silently discarded.
  async function noteWrite(id, doc) {
    if (!doc) return;
    await cacheSet(KEYS.syncBase(id), { version: doc.version, hash: doc.hash, at: now() });
    const draft = await cacheGet(KEYS.draft(id));
    if (draft && hashString(JSON.stringify(draft.data)) !== doc.hash) {
      await cacheDel(KEYS.conflict(id)); // stale conflict record (if any) — reconcile re-detects
    } else {
      await cacheDel(KEYS.draft(id));
      await cacheDel(KEYS.conflict(id));
    }
  }
  async function noteDelete(id) {
    await cacheDel(KEYS.syncBase(id));
    await cacheDel(KEYS.draft(id));
    await cacheDel(KEYS.conflict(id));
  }

  // Wire the engine to a store's change events (app-level convenience).
  function attach(storeInstance) {
    return storeInstance.onChange((evt) => {
      if (evt.type === "write") noteWrite(evt.id, { version: evt.version, hash: evt.hash });
      else if (evt.type === "delete") noteDelete(evt.id);
    });
  }

  async function getDocStatus(id) {
    const canonical = await store.readDocument(id, { force: true }).catch(() => null);
    const draft = await cacheGet(KEYS.draft(id));
    const conflict = await cacheGet(KEYS.conflict(id));
    const base = await cacheGet(KEYS.syncBase(id));
    let state = "absent";
    if (canonical) {
      if (conflict && !conflict.resolved) state = "conflict";
      else if (draft) state = "draft";
      else if (!base || base.hash !== canonical.hash) state = "stale";
      else state = "synced";
    } else if (draft) {
      state = "local-only";
    } else if (base) {
      state = "deleted-remote";
    }
    return {
      id,
      state,
      canonical: canonical ? { version: canonical.version, hash: canonical.hash } : null,
      base,
      draft: !!draft,
      conflict: conflict && !conflict.resolved ? conflict : null,
    };
  }

  async function getOverview() {
    const [conflicts, drafts, last] = await Promise.all([
      listConflicts(),
      listDrafts(),
      cacheGet(KEYS.lastReconciled),
    ]);
    const docs = await store.listDocuments().catch(() => []);
    return { docCount: docs.length, conflicts, drafts, lastReconciledAt: last };
  }

  return {
    reconcile,
    detect,
    resolveConflict,
    stageDraft,
    openConflict,
    listConflicts,
    listDrafts,
    getDocStatus,
    getOverview,
    noteWrite,
    noteDelete,
    attach,
    merge3,
  };
}
