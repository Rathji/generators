/* ============================================================
   PSA-U — version history & restore (Phase 1 · Task 6)
   Every committed document write is observed through the store's
   commit hook, and a restorable snapshot is appended to the
   `versions` document (psa-v1-versions) so any record set can be
   rolled back to an earlier revision. Snapshots are per-document,
   pruned to a bounded window, and metadata-only for documents too
   large to duplicate (those restore from a published backup).

   The log is a normal versioned store document, so it syncs across
   devices and is covered by backup/restore like everything else.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = ERP.store;

  const H = (ERP.history = {});

  H.MODULE = "versions";
  H.MAX_PER_DOC = 20;             // newest snapshots kept per document
  H.MAX_RECORDS = 300;            // total snapshots kept across all documents
  H.MAX_TOTAL_BYTES = 1536 * 1024; // snapshot log byte budget (~1.5 MiB)
  H.MAX_SNAPSHOT_BYTES = 256 * 1024; // larger docs are logged metadata-only
  H.SKIP_PREFIX = "psa-v1-versions"; // never snapshot the log itself

  const NAME = () => store.docName(H.MODULE);

  /* ─────────────────────────── read / write ─────────────────────────── */

  let cache = null;

  async function records(force) {
    if (cache && !force) return cache;
    const r = await store.loadDoc(H.MODULE);
    cache = (r && r.records) || [];
    return cache;
  }

  async function write(list, meta) {
    const r = await store.saveDoc(H.MODULE, list, meta);
    if (!r.error) cache = list;
    return r;
  }

  H.invalidate = () => { cache = null; };

  /* ─────────────────────────── snapshotting ─────────────────────────── */

  function bytesOf(v) {
    try { return new Blob([JSON.stringify(v)]).size; } catch (e) { return String(JSON.stringify(v)).length; }
  }

  function sameRecords(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  /* Snapshots are serialised through this chain: the store's commit hook is
     fire-and-forget, and two writes landing together would otherwise each read
     the same base list and the later write would clobber the earlier. Queueing
     them keeps the log consistent and makes the ordering deterministic. */
  let chain = Promise.resolve();

  async function snapshotNow(name, doc, note) {
    if (!name || !doc || doc.schema !== "psa-doc") return { skipped: "schema" };
    if (name.indexOf(H.SKIP_PREFIX) === 0) return { skipped: "log" };
    const recs = doc.records || [];
    const list = await records();
    const mine = list.filter((v) => v.doc === name).sort((a, b) => b.id - a.id);
    const latest = mine[0];
    if (latest && sameRecords(latest.records, recs)) return { skipped: "unchanged" };

    const body = {
      id: Date.now(),
      kind: "version",
      doc: name,
      rev: doc.rev || 0,
      ts: new Date().toISOString(),
      by: (ERP.security && ERP.security.actorLabel && ERP.security.actorLabel()) || doc.updatedBy || ERP.role || "owner",
      role: ERP.role || "",
      note: note || "",
      count: recs.length,
    };
    const size = bytesOf(recs);
    body.bytes = size;
    if (size <= H.MAX_SNAPSHOT_BYTES) body.records = JSON.parse(JSON.stringify(recs));
    else body.tooLarge = true;

    list.push(body);
    const pruned = prune(list);
    await write(pruned);
    return { snapshot: body, pruned: list.length - pruned.length };
  }

  /* Snapshot one committed document. Called from the store's commit hook for
     every successful write, so callers never invoke it directly. */
  H.snapshot = function (name, doc, note) {
    const run = () => snapshotNow(name, doc, note);
    const p = chain.then(run, run);
    chain = p.then(() => {}, () => {});
    return p;
  };

  /* Await all queued snapshots — used before reading the log in tests and by
     anything that must see every snapshot written. */
  H.flush = () => chain;

  /* Keep the newest MAX_PER_DOC per document and stay under the totals. */
  function prune(list) {
    const byDoc = {};
    for (const v of list) (byDoc[v.doc] = byDoc[v.doc] || []).push(v);
    let keep = [];
    for (const k in byDoc) {
      byDoc[k].sort((a, b) => (b.id || 0) - (a.id || 0));
      keep.push.apply(keep, byDoc[k].slice(0, H.MAX_PER_DOC));
    }
    keep.sort((a, b) => (b.id || 0) - (a.id || 0));
    if (keep.length > H.MAX_RECORDS) keep = keep.slice(0, H.MAX_RECORDS);
    let total = 0;
    const out = [];
    for (const v of keep) {
      total += (v.bytes || 0) + 200;
      if (total > H.MAX_TOTAL_BYTES && out.length) continue;
      out.push(v);
    }
    out.sort((a, b) => (b.id || 0) - (a.id || 0));
    return out;
  }

  /* ─────────────────────────── public queries ─────────────────────────── */

  H.entries = async function (name) {
    const list = await records();
    return list
      .filter((v) => !name || v.doc === name)
      .sort((a, b) => (b.id || 0) - (a.id || 0))
      .map((v) => ({
        id: v.id, doc: v.doc, rev: v.rev, ts: v.ts, by: v.by, role: v.role,
        note: v.note, count: v.count, bytes: v.bytes, tooLarge: !!v.tooLarge,
      }));
  };

  H.count = async function (name) {
    return (await H.entries(name)).length;
  };

  H.documents = async function () {
    const list = await records();
    const seen = {};
    for (const v of list) {
      const e = (seen[v.doc] = seen[v.doc] || { doc: v.doc, versions: 0, last: null });
      e.versions++;
      if (!e.last || (v.id || 0) > (e.last.id || 0)) e.last = { id: v.id, ts: v.ts, rev: v.rev, count: v.count };
    }
    return Object.keys(seen).map((k) => seen[k]).sort((a, b) => (b.last && b.last.ts > a.last.ts ? 1 : -1));
  };

  /* Restore a snapshot: writes the snapshot's records back through the store
     (CAS-checked, so a device that has moved on gets a conflict to resolve
     rather than a silent clobber). Returns the store write result. */
  H.restore = async function (name, id) {
    const list = await records(true);
    const snap = list.find((v) => String(v.id) === String(id) && (!name || v.doc === name));
    if (!snap) return { error: "not_found", name, id };
    if (snap.tooLarge || !snap.records) {
      return { error: "snapshot_too_large", name, id, message: "This revision was too large to keep a restorable copy of. Restore from a published backup instead." };
    }
    const docNameFull = snap.doc;
    const decl = store.declaredDocs().find((d) => docNameFull.indexOf("psa-v1-" + d.name) === 0);
    const logical = decl ? decl.name : docNameFull.replace(/^psa-v1-/, "");
    const doc = {
      schema: "psa-doc",
      schemaVersion: store.schemaVersion,
      doc: logical,
      year: null,
      rev: 0,
      updatedAt: new Date().toISOString(),
      updatedBy: ERP.role || "owner",
      records: JSON.parse(JSON.stringify(snap.records)),
    };
    /* Snapshot the *current* state first so a restore is itself undoable. */
    const current = store.cachedDoc(docNameFull) || (await store.get(docNameFull)).doc;
    if (current) await H.snapshot(docNameFull, current, "Before restore to " + new Date(snap.ts).toLocaleString());
    const res = await store.forceSet(docNameFull, doc);
    if (!res.error && ERP.master) {
      try { await ERP.master.audit({ action: "restore_version", targetType: "doc", targetId: docNameFull, summary: "Restored " + logical + " to revision " + snap.rev + " (" + snap.ts + ")." }); } catch (e) {}
    }
    return res;
  };

  H.clear = async function (name) {
    const list = await records(true);
    const keep = name ? list.filter((v) => v.doc !== name) : [];
    await write(keep);
    return { removed: list.length - keep.length };
  };

  /* ─────────────────────────── wiring ─────────────────────────── */

  function boot() {
    if (!store.setCommitListener) return;
    store.setCommitListener((name, doc) => {
      /* fire-and-forget; never let history slow down or break a write */
      H.snapshot(name, doc).catch(() => {});
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
