// src/framework/store/index.js — the canonical document store.
//
// Every content module's data lives as a versioned JSON document under the
// KB's own storage namespace. Physical layout:
//
//   <ns>-registry            small JSON index of every document (id, version,
//                            chunk list, byte size, content hash, timestamps).
//                            This is the commit point: writes land here last.
//   <ns>-<docId>-<n>         one file per chunk of the document's serialized
//                            JSON. Chunks are ≤ `ceiling` bytes each, so no
//                            single write can exceed the storage ceiling and
//                            large documents are transparently split.
//
// The registry + chunk files live on the cloud channel (editable files, so
// they survive across devices and reloads); a local cache holds the joined
// document for fast reads plus the per-file edit keys. Writes are serialized
// through an internal mutex, are full-snapshot per chunk (rewriting identical
// content is a no-op), and commit the registry with a compare-and-set guard so
// concurrent writers are detected instead of silently clobbering each other.
//
// Sync & conflict *resolution* (two devices editing the same document) is the
// next roadmap task; this layer already exposes `sync()` to reconcile the
// local cache against the canonical documents.

import { StoreError, CODES } from "./errors.js";
import { CHUNK_CEILING, byteLength, splitStringByBytes, hashString } from "./chunking.js";
import { KEYS, makeDraft, makeConflict } from "./records.js";

export { StoreError, CODES } from "./errors.js";
export { CHUNK_CEILING } from "./chunking.js";

const REG_SCHEMA = "kb-registry/1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDocumentStore({
  namespace,
  ceiling = CHUNK_CEILING,
  channel,
  cache,
  now = () => Date.now(),
}) {
  const registryName = namespace + "-registry";
  // Physical file names must be lowercase letters/numbers/hyphens (the editable
  // file format), so doc ids are lowercased here. The id itself keeps its case
  // inside the registry JSON.
  //
  // Chunk names are stamped with the version AND a content-hash prefix, so two
  // writers who independently produce different content never write to the
  // same physical file — a concurrent same-document write can't corrupt the
  // other side's data. The registry, which points at exactly one chunk set per
  // document, remains the commit point; superseded chunk sets stay behind as
  // orphans (preserving the losing side for conflict resolution / history).
  const chunkName = (id, version, hash, i) =>
    `${namespace}-${id.toLowerCase()}-v${version}-${(hash || "h").slice(0, 8)}-${i}`;

  let reg = null; // in-memory mirror of the registry
  let touchedIds = new Set(); // docs we've modified since the last committed registry write
  let baseByDoc = new Map(); // id -> canonical hash each touched doc was based on
  let lastConflictIds = new Set(); // docs a concurrent writer committed while we wrote
  // Session-authoritative registry state. The live editable-file channel can
  // serve ~10s-stale reads right after a write, so a cloud registry read may
  // lag our own commits. These maps let us re-assert OUR writes/deletes over
  // any read, so a stale read can never resurrect a deleted doc, drop a
  // written one, or misreport our own write as a concurrent conflict.
  let sessionWritten = new Map(); // id -> meta we committed this session
  let sessionDeleted = new Map(); // id -> meta we deleted this session
  let sessionWrittenRev = new Map(); // id -> registry rev at which we last committed the write
  let sessionConflicted = new Set(); // ids whose last session write was rejected as a conflict (never re-assert)
  let queue = Promise.resolve();
  let listeners = [];

  const withLock = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.then(
      () => {},
      () => {},
    );
    return p;
  };

  function emit(evt) {
    for (const l of listeners) {
      try {
        l(evt);
      } catch {}
    }
  }

  // ---- cache helpers (cache failures are never fatal to reads/writes) ----
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

  // ---- registry ----
  async function readRegistryOnce() {
    try {
      const text = await channel.get(registryName);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  // Fold this session's own writes/deletes over a cloud registry read. The
  // read may be stale (missing our recent commits), so for a doc we wrote or
  // deleted ourselves this session, re-assert OUR state when the read is
  // OLDER than the commit that carried it (readRev < committedRev) — that's a
  // stale read that can't see our change. When the read is at-or-after that
  // commit, it already reflects the truth (absent = deleted later, different =
  // advanced by someone else), so we trust it and never mask another device's
  // deletion or edit. Writes that were rejected as conflicts are never
  // re-asserted — theirs stays canonical until the user resolves.
  function mergeSessionState(cloudDocs, readRev) {
    const merged = { ...(cloudDocs || {}) };
    for (const [id, meta] of sessionWritten) {
      if (sessionConflicted.has(id)) continue;
      const cRev = sessionWrittenRev.get(id);
      if (cRev != null && readRev != null && readRev >= cRev) continue; // read is current — trust it
      const theirs = merged[id];
      if (theirs && theirs.version >= meta.version) continue; // at-or-ahead → don't clobber
      if (theirs && theirs.hash === meta.hash) continue; // already ours
      merged[id] = meta;
    }
    for (const [id, delMeta] of sessionDeleted) {
      const theirs = merged[id];
      if (!theirs) {
        if (delMeta.committedRev != null && readRev != null && readRev >= delMeta.committedRev) {
          sessionDeleted.delete(id); // deletion confirmed by a current read — stop re-asserting
        }
        continue;
      }
      if (theirs.hash === delMeta.hash) {
        if (delMeta.committedRev != null && readRev != null && readRev >= delMeta.committedRev) {
          sessionDeleted.delete(id); // re-created with identical content after our delete — keep it
        } else {
          delete merged[id]; // stale read re-adding a doc we deleted
        }
      } else {
        sessionDeleted.delete(id); // re-created/changed by someone else — our delete is moot
      }
    }
    return merged;
  }

  async function loadRegistry(forceCloud = false) {
    if (reg && !forceCloud) return reg;
    if (!forceCloud && !reg) {
      const cached = await cacheGet("registry-meta");
      if (cached && typeof cached === "object" && cached.docs) {
        reg = cached;
        return reg;
      }
    }
    const cloud = await readRegistryOnce();
    if (cloud && cloud.docs) {
      reg = { ...cloud, docs: mergeSessionState(cloud.docs, cloud.rev ?? 0) };
      await cacheSet("registry-meta", reg);
      return reg;
    }
    if (forceCloud) {
      reg = null;
      await cacheDel("registry-meta");
      return reg;
    }
    return reg;
  }

  // Commit the in-memory registry. Re-reads the cloud registry first; for each
  // touched document, if the canonical content moved since we based our write
  // on it (baseByDoc), a concurrent writer got there first — we keep THEIR
  // version in the registry (never silently overwrite) and report the id so
  // the caller can preserve ours as a draft + conflict. Commits with a bumped
  // rev and retries when displaced by a coalesced write.
  //
  // Reads are merged through mergeSessionState, so a stale read (~10s lag on
  // the editable channel) can't drop our own writes or resurrect our deleted
  // docs. A read-back of OUR OWN entry (same hash) or the still pre-write
  // state (hash === base) is likewise not a conflict. Only a provably-newer
  // post-put read (rev > the rev we just wrote) is checked for displacements,
  // so a stale verify read can never be misreported as one.
  async function commitRegistry() {
    if (!reg) return;
    lastConflictIds = new Set();
    for (let attempt = 0; attempt < 12; attempt++) {
      const cloud = await readRegistryOnce();
      const conflicted = new Set();
      let merged;
      if (cloud && cloud.docs) {
        merged = mergeSessionState(cloud.docs, cloud.rev ?? 0);
        for (const id of touchedIds) {
          const ours = reg.docs && reg.docs[id] ? reg.docs[id] : null; // our computed entry (null = delete)
          const theirs = cloud.docs[id] || null;
          const baseHash = baseByDoc.has(id) ? baseByDoc.get(id) : null;
          if (theirs) {
            const isOurs = !!ours && theirs.hash === ours.hash;
            const isPreWrite = theirs.hash === baseHash;
            if (!isOurs && !isPreWrite) {
              // canonical moved since we based our write on it (or the doc was
              // concurrently created) → keep theirs, never silently overwrite
              conflicted.add(id);
              continue;
            }
          }
          if (ours) merged[id] = ours;
          else delete merged[id];
        }
      } else {
        merged = mergeSessionState(reg.docs || {}); // first commit: no cloud registry yet
      }
      reg = { ...reg, docs: merged };
      const rev = (cloud && cloud.rev ? cloud.rev : 0) + 1;
      const payload = JSON.stringify({
        schema: REG_SCHEMA,
        rev,
        updatedAt: now(),
        docs: reg.docs || {},
      });
      let res;
      try {
        res = await channel.put(registryName, payload);
      } catch (e) {
        if (e.code === CODES.EDIT_KEY_REQUIRED || e.code === CODES.STORAGE_UNAVAILABLE) throw e;
        if (attempt === 11) {
          throw new StoreError(CODES.REGISTRY_WRITE_FAILED, "Could not save the document index. Please try again.");
        }
        await sleep(300 * (attempt + 1));
        continue;
      }
      if (res && res.superseded) {
        await sleep(1000 + attempt * 250);
        continue;
      }
      // Post-put verification: only a read NEWER than the rev we just wrote
      // can reveal a concurrent writer who displaced us in the tiny window —
      // and only then is the displacement check meaningful. A stale or equal
      // read must never be misread as a conflict, nor revert our commit.
      const post = await readRegistryOnce();
      if (post && post.docs && (post.rev || 0) > rev) {
        const displaced = new Set();
        for (const id of touchedIds) {
          const ours = reg.docs && reg.docs[id] ? reg.docs[id] : null;
          const theirsPost = post.docs[id] || null;
          const baseHash = baseByDoc.has(id) ? baseByDoc.get(id) : null;
          if (theirsPost) {
            const isOurs = !!ours && theirsPost.hash === ours.hash;
            const isPreWrite = theirsPost.hash === baseHash;
            if (!isOurs && !isPreWrite) displaced.add(id);
          }
        }
        const finalDocs = { ...post.docs };
        for (const id of touchedIds) {
          if (displaced.has(id)) continue; // keep post's (theirs) entry canonical
          const ours = reg.docs && reg.docs[id] ? reg.docs[id] : null;
          if (ours) finalDocs[id] = ours;
          else delete finalDocs[id];
        }
        reg = { ...reg, docs: finalDocs, rev: Math.max(post.rev ?? 0, rev), updatedAt: now() };
        for (const id of displaced) conflicted.add(id);
      } else {
        reg = { ...reg, rev, updatedAt: now() };
      }
      const committedRev = reg.rev ?? rev;
      for (const id of touchedIds) {
        if (sessionWritten.has(id)) sessionWrittenRev.set(id, committedRev);
        const sd = sessionDeleted.get(id);
        if (sd) sd.committedRev = committedRev;
      }
      touchedIds.clear();
      baseByDoc.clear();
      lastConflictIds = conflicted;
      await cacheSet("registry-meta", reg);
      return;
    }
    throw new StoreError(
      CODES.CONCURRENT_WRITE,
      "The document index is busy being updated elsewhere. Please try again in a few seconds.",
    );
  }

  // ---- chunk writes ----
  async function putReliable(name, text) {
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const res = await channel.put(name, text);
        if (res && res.superseded) {
          await sleep(1000 + attempt * 250);
          continue;
        }
        return res;
      } catch (e) {
        if (e.code === CODES.EDIT_KEY_REQUIRED || e.code === CODES.STORAGE_UNAVAILABLE || e.code === CODES.INVALID_DATA) throw e;
        if (attempt === 11) {
          throw new StoreError(CODES.CHUNK_WRITE_FAILED, `Could not save part of "${name}". Please try again.`);
        }
        await sleep(300 * (attempt + 1));
      }
    }
  }

  function docEnvelope(id, meta, data) {
    return {
      id,
      version: meta.version,
      updatedAt: meta.updatedAt,
      updatedBy: meta.updatedBy,
      bytes: meta.bytes,
      hash: meta.hash,
      chunkCount: meta.chunks ? meta.chunks.length : 0,
      data,
    };
  }

  // ---- internal (lock-free) operations; callers hold the mutex ----

  // Write a single document's chunks + registry meta. Mutates `reg.docs` and
  // `touchedIds` so the enclosing _writeMany can commit them all at once.
  async function _writeOne(id, data, updatedBy, updatedAt) {
    if (
      data === undefined ||
      (typeof data !== "object" && typeof data !== "string" && typeof data !== "number" && typeof data !== "boolean")
    ) {
      throw new StoreError(CODES.INVALID_DATA, `Document "${id}" must be a serializable value.`);
    }
    let json;
    try {
      json = JSON.stringify(data);
    } catch {
      throw new StoreError(CODES.INVALID_DATA, `Document "${id}" could not be serialized.`);
    }
    if (json === undefined) {
      throw new StoreError(CODES.INVALID_DATA, `Document "${id}" could not be serialized.`);
    }
    const prev = (reg.docs && reg.docs[id]) || null;
    const bytes = byteLength(json);
    const hash = hashString(json);
    if (prev && prev.hash === hash) {
      sessionDeleted.delete(id);
      sessionWritten.set(id, prev);
      return { id, changed: false, meta: prev, doc: docEnvelope(id, prev, data), base: prev };
    }
    const meta = {
      version: (prev ? prev.version : 0) + 1,
      bytes,
      hash,
      updatedAt,
      updatedBy,
    };
    const parts = splitStringByBytes(json, ceiling);
    const names = parts.map((_, i) => chunkName(id, meta.version, hash, i));
    meta.chunks = names;
    for (let i = 0; i < parts.length; i++) {
      await putReliable(names[i], parts[i]);
    }
    baseByDoc.set(id, prev ? prev.hash : null);
    reg.docs[id] = meta;
    sessionDeleted.delete(id);
    sessionWritten.set(id, meta);
    touchedIds.add(id);
    return { id, changed: true, meta, base: prev };
  }

  async function _writeMany(docs, opts = {}) {
    const updatedBy = opts.updatedBy || "system";
    await loadRegistry(true);
    lastConflictIds = new Set(); // a no-op-only batch must not inherit a stale flag
    const updatedAt = now();
    if (!reg) reg = { schema: REG_SCHEMA, rev: 0, updatedAt, docs: {} };
    const changes = [];
    for (const [id, data] of Object.entries(docs)) {
      try {
        const c = await _writeOne(id, data, updatedBy, updatedAt);
        changes.push(c);
      } catch (e) {
        changes.push({ id, changed: false, error: e });
      }
    }
    if (touchedIds.size) await commitRegistry();
    const conflictedIds = lastConflictIds;
    for (const c of changes) {
      if (c.error) {
        // A failed write is preserved locally as a draft so the change is
        // never silently lost (offline, unsaved preview, lost edit key, …).
        // The sync engine pushes the draft once the cloud is reachable.
        const stageable =
          opts.stageOnFailure !== false &&
          (c.error.code === CODES.STORAGE_UNAVAILABLE || c.error.code === CODES.EDIT_KEY_REQUIRED);
        if (stageable) {
          const prev = (reg.docs && reg.docs[c.id]) || null;
          const draft = makeDraft({
            data: docs[c.id],
            base: prev ? { version: prev.version, hash: prev.hash } : null,
            baseData: null,
            at: updatedAt,
            updatedBy,
            reason: "failed-write",
          });
          await cacheSet(KEYS.draft(c.id), draft);
          c.staged = true;
          c.draft = draft;
        }
        continue;
      }
      if (conflictedIds.has(c.id)) {
        // A concurrent writer committed a different version of this document
        // while we wrote ours. Theirs stays canonical; ours is preserved as a
        // draft + conflict record for the user to resolve (keep-mine /
        // keep-theirs / field-merge). Nothing is silently discarded.
        const theirs = await _readDocument(c.id, { force: true }).catch(() => null);
        const mine = makeDraft({
          data: docs[c.id],
          base: c.base ? { version: c.base.version, hash: c.base.hash } : null,
          baseData: null,
          at: updatedAt,
          updatedBy,
          reason: "concurrent-write",
        });
        await cacheSet(KEYS.draft(c.id), mine);
        if (theirs) {
          await cacheSet(
            KEYS.conflict(c.id),
            makeConflict({
              mine,
              theirs: { version: theirs.version, hash: theirs.hash, data: theirs.data, at: now() },
              base: null,
              at: now(),
            }),
          );
          c.conflicted = true;
          c.version = theirs.version;
          c.theirs = theirs;
        } else {
          c.conflicted = true;
          c.version = null;
        }
        continue;
      }
      if (!c.changed) continue;
      const doc = docEnvelope(c.id, c.meta, docs[c.id]);
      c.doc = doc;
      await cacheSet("doc::" + c.id, doc);
      await cacheSet("doc-meta::" + c.id, c.meta);
      emit({ type: "write", id: c.id, version: c.meta.version, hash: c.meta.hash, updatedBy, updatedAt });
    }
    return changes;
  }

  async function _ensureMany(defs) {
    await loadRegistry(true);
    const toWrite = {};
    for (const [id, seedFn] of Object.entries(defs)) {
      if (reg && reg.docs && reg.docs[id]) continue; // exists — never overwrite on ensure
      toWrite[id] = typeof seedFn === "function" ? seedFn() : seedFn;
    }
    if (!Object.keys(toWrite).length) return [];
    return _writeMany(toWrite, { updatedBy: "system", stageOnFailure: false });
  }

  async function _readDocument(id, opts = {}) {
    const force = !!opts.force;
    if (!force) {
      const cached = await cacheGet("doc::" + id);
      if (cached) return cached;
    }
    await loadRegistry(force);
    const meta = reg && reg.docs ? reg.docs[id] : null;
    if (!meta) return null;
    const parts = [];
    for (const name of meta.chunks || []) {
      const text = await channel.get(name);
      if (text == null) {
        throw new StoreError(CODES.MISSING_CHUNK, `Document "${id}" is missing data part "${name}".`);
      }
      parts.push(text);
    }
    const json = parts.join("");
    if (meta.hash && hashString(json) !== meta.hash) {
      throw new StoreError(CODES.INTEGRITY, `Document "${id}" failed its integrity check.`);
    }
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      throw new StoreError(CODES.INTEGRITY, `Document "${id}" is corrupt and could not be parsed.`);
    }
    const doc = docEnvelope(id, meta, data);
    await cacheSet("doc::" + id, doc);
    await cacheSet("doc-meta::" + id, meta);
    return doc;
  }

  async function _deleteDocument(id) {
    await loadRegistry(true);
    const meta = reg && reg.docs ? reg.docs[id] : null;
    if (!meta) return { changed: false };
    // The chunk files are deliberately left in place: they are content-addressed
    // and only ever referenced by the registry, so once the entry is removed they
    // are inert (harmless orphans that also enable recovery). Destroying them is
    // dangerous on the live editable channel, whose reads can lag a write by
    // many seconds: a stale registry state (this device's own session merge, a
    // coalesced commit, or another device) can re-reference a deleted doc's
    // chunk names, and if the content was blanked the document is permanently
    // corrupted instead of merely read as a stale version.
    delete reg.docs[id];
    sessionWritten.delete(id);
    sessionDeleted.set(id, { version: meta.version, hash: meta.hash });
    baseByDoc.set(id, meta.hash);
    touchedIds.add(id);
    await commitRegistry();
    if (lastConflictIds.has(id)) {
      // the document was concurrently changed upstream — keep their version
      const theirs = await _readDocument(id, { force: true }).catch(() => null);
      if (theirs) {
        await cacheSet("doc::" + id, theirs);
        await cacheSet("doc-meta::" + id, theirs);
      }
      return { changed: false, conflicted: true, version: theirs ? theirs.version : null };
    }
    await cacheDel("doc::" + id);
    await cacheDel("doc-meta::" + id);
    emit({ type: "delete", id });
    return { changed: true };
  }

  async function _listDocuments() {
    await loadRegistry();
    if (!reg || !reg.docs) return [];
    return Object.entries(reg.docs)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async function _meta(id) {
    const cached = await cacheGet("doc-meta::" + id);
    if (cached) return cached;
    await loadRegistry();
    return reg && reg.docs ? reg.docs[id] || null : null;
  }

  async function _documentStats(id) {
    await loadRegistry();
    const m = reg && reg.docs ? reg.docs[id] : null;
    if (!m) return null;
    const chunkCount = m.chunks ? m.chunks.length : 0;
    return {
      id,
      version: m.version,
      bytes: m.bytes,
      chunkCount,
      ceiling,
      capacity: chunkCount * ceiling,
      used: m.bytes,
      remaining: Math.max(0, chunkCount * ceiling - m.bytes),
    };
  }

  async function _sync() {
    await loadRegistry(true);
    if (!reg || !reg.docs) return { checked: 0, stale: 0, newLocal: 0 };
    let stale = 0;
    let newLocal = 0;
    for (const [id, m] of Object.entries(reg.docs)) {
      const cached = await cacheGet("doc-meta::" + id);
      if (cached && cached.version !== m.version) {
        await cacheDel("doc::" + id); // drop stale content; next read re-fetches
        stale++;
      } else if (!cached) {
        newLocal++;
      }
      await cacheSet("doc-meta::" + id, m);
    }
    return { checked: Object.keys(reg.docs).length, stale, newLocal };
  }

  async function _getStatus() {
    const docs = await _listDocuments();
    const totalBytes = docs.reduce((s, d) => s + (d.bytes || 0), 0);
    const chunkCount = docs.reduce((s, d) => s + (d.chunks ? d.chunks.length : 0), 0);
    return {
      namespace,
      ceiling,
      rev: reg ? reg.rev || 0 : 0,
      docCount: docs.length,
      totalBytes,
      chunkCount,
      docs,
    };
  }

  // ---- public API ----
  return {
    namespace,
    ceiling,
    registryName,

    withLock,
    ensure: (id, seedFn) => withLock(() => _ensureMany({ [id]: seedFn })),
    ensureMany: (defs) => withLock(() => _ensureMany(defs)),
    writeDocument: (id, data, opts) =>
      withLock(() =>
        _writeMany({ [id]: data }, opts).then((changes) => {
          const c = changes[0];
          if (c.error) {
            if (c.staged) {
              c.error.message = `Saved locally for later sync — ${c.error.message}`;
              c.error.staged = true;
              c.error.draftId = id;
            }
            throw c.error;
          }
          return {
            changed: c.changed,
            conflicted: !!c.conflicted,
            doc: c.doc || null,
            meta: c.meta,
            version: c.version,
            theirs: c.theirs || null,
          };
        }),
      ),
    writeMany: (docs, opts) => withLock(() => _writeMany(docs, opts)),
    readDocument: (id, opts) => withLock(() => _readDocument(id, opts)),
    deleteDocument: (id) => withLock(() => _deleteDocument(id)),
    listDocuments: () => withLock(() => _listDocuments()),
    meta: (id) => withLock(() => _meta(id)),
    documentStats: (id) => withLock(() => _documentStats(id)),
    sync: () => withLock(() => _sync()),
    getStatus: () => withLock(() => _getStatus()),
    onChange(cb) {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    },
    StoreError,
  };
}
