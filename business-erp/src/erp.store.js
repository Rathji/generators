/* ============================================================
   BUSINESS ERP — canonical document store (Task 2)
   Every module's data persists as versioned JSON documents
   under the ERP's own storage namespace:
     - canonical copy: upload-plugin editable files keyed to this
       generator, so records survive across devices AND reloads.
       One document per module, split by fiscal year for modules
       whose documents grow large (inventory, finance).
     - edit keys: cached in localStorage (required to rewrite an
       existing editable file; the key is only issued on create).
     - fast local cache: a localStorage JSON snapshot per document,
       so reads never block on the network; a throttled background
       refresh adopts a newer canonical version when one appears.
     - write ceiling: no serialized document may exceed
       api.maxDocBytes — oversized writes are refused with a
       clear error before any quota is spent.
   Every document carries {schema, schemaVersion, doc, year, rev,
   updatedAt, updatedBy, records}. `rev` is a monotone revision
   counter bumped on every committed write (each device starts from
   the newest rev it has seen, whether cached or canonical), which
   is what sync/conflict handling (Task 3) uses to detect that the
   other side changed a document. The store index (erp-v1-index)
   tracks the doc name, year, rev, record count, byte size and
   timestamp of every document — the basis for Task 3 (sync) and
   Task 5 (capacity & archival).
   NOTE: the editable namespace is keyed by generator name — if
   the generator is renamed, its canonical documents move with it.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;

  const STORE = {
    namespace: "erp",           // editable-name prefix: erp-v1-<doc>[-<year>]
    schemaVersion: 1,
    maxDocBytes: 4 * 1024 * 1024, // per-document ceiling (editable max is 5 MiB)
    indexName: "index",
    refreshMs: 15000,           // don't background-refresh a doc more often than this
  };

  const LS = {
    index: "erp.store.v1.index",      // cached index JSON
    cache: "erp.store.v1.cache.",     // + docName → cached doc JSON
    keys: "erp.store.v1.keys.",       // + docName → edit key
    alias: "erp.store.v1.alias.",     // + docName → recovered editable name (edit key lost)
    flushes: "erp.store.v1.flushes",  // doc names with pending canonical writes
    base: "erp.store.v1.base.",       // + docName → {rev, records|null} last-synced watermark (Task 3)
    conflicts: "erp.store.v1.conflicts", // JSON array of pending conflicts (Task 3)
    merge: "erp.store.v1.merge.",     // + docName → in-progress field-level merge state (Task 3)
  };

  const readLS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const rmLS = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

  function fmtBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MiB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KiB";
    return n + " B";
  }

  /* ─────────────────── editable layer (graceful) ─────────────────── */

  let backendOverride = null; // tests / restore flows can inject a stub backend

  function editable() {
    if (backendOverride) return backendOverride;
    return root && root.uploadPlugin && root.uploadPlugin.editable ? root.uploadPlugin.editable : null;
  }

  function canonicalAvailable() {
    return !!editable();
  }

  async function editableSet(name, json, editKey) {
    const ed = editable();
    if (!ed) return { error: "upload_plugin_unavailable", message: "The document store needs the upload plugin.", name };
    try {
      const target = aliasGet(name) || name;
      let res = await ed.set(target, json, editKey ? { editKey: editKey } : undefined) || {};
      if (res.error === "edit_key_required") {
        /* Self-heal: the canonical file exists but we no longer hold its
           edit key (localStorage was cleared while the server copy stayed,
           or the key was lost). Adopt a fresh editable name for this doc
           and remember the alias so every later read/write routes through
           it; the orphaned file is abandoned. */
        const fresh = target + "-" + Math.random().toString(36).slice(2, 8);
        const res2 = await ed.set(fresh, json) || {};
        if (res2.error) return { error: res2.error, name, recovered: false };
        if (res2.superseded) return Object.assign({}, res2, { name, recovered: true });
        if (res2.editKey) { keyPut(fresh, res2.editKey); keyPut(name, res2.editKey); }
        aliasPut(name, fresh);
        return Object.assign({}, res2, { created: true, recovered: true, name });
      }
      if (res.error) return { error: res.error, name };
      return res; // { created?, unchanged?, superseded?, editKey?, error? }
    } catch (e) {
      return { error: "editable_set_exception", message: (e && e.message) || String(e), name };
    }
  }

  async function editableGet(name) {
    const ed = editable();
    if (!ed) return { error: "upload_plugin_unavailable", message: "The document store needs the upload plugin.", name };
    try {
      return { name, text: await ed.get(aliasGet(name) || name) }; // text is null when the file doesn't exist yet
    } catch (e) {
      return { error: "editable_get_exception", message: (e && e.message) || String(e), name };
    }
  }

  /* ─────────────────── doc naming & config ─────────────────── */

  function docConfig(moduleId) {
    const m = ERP.getModule(moduleId);
    return m && m.doc ? m.doc : null;
  }

  function docName(moduleId, year) {
    const d = docConfig(moduleId);
    if (!d) throw new Error("No document declared for module: " + moduleId);
    const base = STORE.namespace + "-v" + STORE.schemaVersion + "-" + d.name;
    return year ? base + "-" + year : base;
  }

  /* Given a full store name, return the logical document name for the
     envelope (e.g. "erp-v1-crm" → "crm" when a declared module matches). */
  function logicalDocName(name) {
    const prefix = STORE.namespace + "-v" + STORE.schemaVersion + "-";
    const logical = name.indexOf(prefix) === 0 ? name.slice(prefix.length) : name;
    const decl = declaredDocs().find((d) => d.name === logical);
    return decl ? logical : name;
  }

  function declaredDocs() {
    return ERP.modules.filter((m) => m.doc).map((m) => ({
      module: m.id,
      name: m.doc.name,
      splitByYear: !!m.doc.splitByYear,
    }));
  }

  const indexName = () => STORE.namespace + "-v" + STORE.schemaVersion + "-" + STORE.indexName;

  /* Fiscal year of a record date. January-start by default; reads
     config.erp.fiscalYearStartMonth (1=Jan) once fiscal settings
     land in Task 9. Records with no usable date fall to now. */
  function fiscalYearOf(record) {
    let ts = record && (record.date || record.timestamp || record.createdAt);
    if (ts == null || ts === "") ts = Date.now();
    let d;
    if (ts instanceof Date) d = ts;
    else {
      const n = typeof ts === "number" ? ts : Date.parse(ts);
      d = isNaN(n) ? new Date() : new Date(n);
    }
    let startMonth = 1;
    try {
      const m = parseInt(ERP.configVal("erp.fiscalYearStartMonth", 1), 10);
      if (m >= 1 && m <= 12) startMonth = m;
    } catch (e) {}
    return d.getFullYear() + (d.getMonth() + 1 < startMonth ? -1 : 0);
  }

  function currentFiscalYear() {
    const now = new Date();
    let startMonth = 1;
    try {
      const m = parseInt(ERP.configVal("erp.fiscalYearStartMonth", 1), 10);
      if (m >= 1 && m <= 12) startMonth = m;
    } catch (e) {}
    return now.getFullYear() + (now.getMonth() + 1 < startMonth ? -1 : 0);
  }

  const serialize = (o) => JSON.stringify(o);
  const byteSize = (t) => { try { return new Blob([t]).size; } catch (e) { return String(t).length; } };

  /* ─────────────────── local cache + edit keys ─────────────────── */

  function cacheGet(name) {
    const raw = readLS(LS.cache + name);
    if (raw == null) return null;
    try { const d = JSON.parse(raw); return d && d.schema ? d : null; } catch (e) { return null; }
  }
  function cachePut(name, doc) { writeLS(LS.cache + name, serialize(doc)); }
  function keyGet(name) { return readLS(LS.keys + name); }
  function keyPut(name, k) { if (k) writeLS(LS.keys + name, k); }
  function aliasGet(name) { return readLS(LS.alias + name); }
  function aliasPut(name, alias) { if (alias && alias !== name) writeLS(LS.alias + name, alias); }

  /* ─────────────────── Task 3: sync watermark, conflicts, merges ─────────────────── */

  /* baseGet returns the {rev, records|null} this device last synced to.
     `records` is kept only while the doc is diverged (dirty or conflicted)
     so a 3-way merge still has its ancestor; once in sync it can be
     reconstructed from the local cache, so it is dropped. */
  function baseGet(name) {
    const raw = readLS(LS.base + name);
    if (raw == null) return null;
    try { const d = JSON.parse(raw); return d && typeof d.rev === "number" ? d : null; } catch (e) { return null; }
  }
  function basePut(name, b) { writeLS(LS.base + name, serialize(b)); }
  function baseRm(name) { rmLS(LS.base + name); }

  /* The rev this device last synced to. Falls back to the cached doc's rev
     when there is no watermark yet (caches created before Task 3, or a fresh
     device that read canonical without ever writing). */
  function baseRevOf(name) {
    const b = baseGet(name);
    if (b) return b.rev || 0;
    const local = cacheGet(name);
    return local ? local.rev || 0 : 0;
  }

  function loadConflicts() {
    try {
      const raw = readLS(LS.conflicts);
      const a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function saveConflicts(list) {
    const nonEmpty = (list || []).filter(Boolean);
    if (nonEmpty.length) writeLS(LS.conflicts, serialize(nonEmpty));
    else rmLS(LS.conflicts);
  }
  function conflictFor(name) { return loadConflicts().find((c) => c.name === name) || null; }
  function clearConflict(name) {
    saveConflicts(loadConflicts().filter((c) => c.name !== name));
  }

  function mergeGet(name) {
    const raw = readLS(LS.merge + name);
    if (raw == null) return null;
    try { const d = JSON.parse(raw); return d && d.merged ? d : null; } catch (e) { return null; }
  }
  function mergePut(name, st) { writeLS(LS.merge + name, serialize(st)); }
  function mergeRm(name) { rmLS(LS.merge + name); }

  function cachedDocNames() {
    const names = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(LS.cache) === 0) names.push(k.slice(LS.cache.length));
      }
    } catch (e) {}
    return names;
  }

  const deepEq = (a, b) => serialize(a) === serialize(b);

  /* Sync-state change notification: the shell's sync center registers a
     listener so the banner/modal react to new conflicts and resolutions. */
  let syncListener = null;
  function setSyncListener(fn) { syncListener = typeof fn === "function" ? fn : null; }
  function notifySync() {
    if (syncListener) { try { syncListener(); } catch (e) {} }
  }

  /* Record-level 3-way merge using the last-synced ancestor. Fields changed
     on only one side are taken from that side; fields changed on both sides
     become explicit field conflicts the user resolves. Never drops a record
     that only one side still has. Returns { records, fieldConflicts, notes }. */
  function threeWayMerge(localRecs, canonRecs, baseRecs) {
    const byId = (arr) => { const m = {}; (arr || []).forEach((r) => { if (r && r.id != null) m[String(r.id)] = r; }); return m; };
    const L = byId(localRecs), C = byId(canonRecs), B = byId(baseRecs || []);
    const ids = new Set([].concat(Object.keys(L), Object.keys(C), Object.keys(B)));
    const out = [], fieldConflicts = [], notes = [];
    const unionKeys = (a, b, c) => new Set([].concat(Object.keys(a), Object.keys(b), Object.keys(c)));
    for (const id of ids) {
      const l = L[id], c = C[id], b = B[id];
      if (b == null) {
        if (l && c) {
          if (deepEq(l, c)) { out.push(l); continue; }
          const merged = Object.assign({}, l), fcs = [];
          for (const k of unionKeys(l, c)) {
            if (deepEq(l[k], c[k])) merged[k] = l[k];
            else { fcs.push({ recordId: id, field: k, mine: l[k], theirs: c[k] }); merged[k] = l[k]; }
          }
          fieldConflicts.push.apply(fieldConflicts, fcs);
          out.push(merged);
        } else {
          out.push(l || c);
        }
      } else if (!l) {
        notes.push({ recordId: id, note: "deleted_on_my_side" });
        out.push(c); // keep it so the deletion is visible for review
      } else if (!c) {
        notes.push({ recordId: id, note: "deleted_on_their_side" });
        out.push(l);
      } else {
        const merged = Object.assign({}, l), fcs = [];
        for (const k of unionKeys(l, c, b)) {
          const lv = l[k], cv = c[k], bv = b[k];
          const lCh = !deepEq(lv, bv), cCh = !deepEq(cv, bv);
          if (!lCh && !cCh) merged[k] = lv;
          else if (lCh && !cCh) merged[k] = lv;
          else if (!lCh && cCh) merged[k] = cv;
          else if (deepEq(lv, cv)) merged[k] = lv;
          else { fcs.push({ recordId: id, field: k, mine: lv, theirs: cv }); merged[k] = lv; }
        }
        fieldConflicts.push.apply(fieldConflicts, fcs);
        out.push(merged);
      }
    }
    return { records: out, fieldConflicts, notes };
  }

  /* ─────────────────── document lifecycle ─────────────────── */

  function buildDoc(moduleId, year, records) {
    return {
      schema: "erp-doc",
      schemaVersion: STORE.schemaVersion,
      doc: docConfig(moduleId).name,
      year: year || null,
      rev: 0,
      updatedAt: new Date().toISOString(),
      updatedBy: ERP.role || "owner",
      records: records || [],
    };
  }

  function emptyDoc(moduleId, year) {
    return buildDoc(moduleId, year, []);
  }

  /* Read one document by module + (optional) fiscal year. Fast local
     cache first; a throttled background refresh adopts a newer
     canonical copy. Never throws — returns { doc, source, error,
     message }. */
  async function readDoc(moduleId, year, name) {
    const cached = cacheGet(name);
    if (cached) {
      refreshDoc(name);
      return { doc: cached, source: "cache" };
    }
    const res = await editableGet(name);
    if (res.error) {
      return { doc: emptyDoc(moduleId, year), source: "empty", error: res.error, message: res.message };
    }
    if (res.text == null) {
      const doc = emptyDoc(moduleId, year);
      cachePut(name, doc);
      return { doc, source: "empty" };
    }
    let doc;
    try {
      doc = JSON.parse(res.text);
    } catch (e) {
      return { doc: emptyDoc(moduleId, year), source: "empty", error: "corrupt_document", message: "The stored document is not valid JSON and could not be read." };
    }
    cachePut(name, doc);
    return { doc, source: "canonical" };
  }

  const refreshing = {};
  const lastRefresh = {};
  function refreshDoc(name) {
    if (refreshing[name]) return;
    const now = Date.now();
    if (lastRefresh[name] && now - lastRefresh[name] < STORE.refreshMs) return;
    lastRefresh[name] = now;
    refreshing[name] = true;
    editableGet(name).then((res) => {
      refreshing[name] = false;
      if (res.error || res.text == null) return;
      let remote;
      try { remote = JSON.parse(res.text); } catch (e) { return; }
      if (!remote || remote.schema !== "erp-doc") return;
      const local = cacheGet(name);
      if (!local) return;
      const localRev = local.rev || 0;
      const remoteRev = remote.rev || 0;
      if (remoteRev > localRev) {
        // Canonical is ahead. Adopt silently only if this device has no
        // un-pushed work of its own; otherwise surface a conflict so the
        // other side's changes are never silently discarded (Task 3).
        const b = baseGet(name);
        const baseRev = b ? b.rev : localRev;
        if (localRev > baseRev || dirty.has(name)) {
          recordConflict(name, local, remote, baseRev, (b && b.records) || null);
        } else {
          adopt(name, remote);
        }
      } else if (remoteRev === localRev && !deepEq((remote.records || []), (local.records || []))) {
        // Same revision number but divergent content — two devices wrote
        // within the editable layer's propagation window. Surface a conflict.
        const b = baseGet(name);
        recordConflict(name, local, remote, b ? b.rev : 0, (b && b.records) || null);
      }
    }).catch(() => { refreshing[name] = false; });
  }

  /* ─────────────────── write path ─────────────────── */

  const dirty = new Set();
  function markDirty(name) { dirty.add(name); writeLS(LS.flushes, serialize([...dirty])); }
  function clearDirty(name) { dirty.delete(name); writeLS(LS.flushes, serialize([...dirty])); }

  /* Core writer. Guards the ceiling, is idempotent on identical records,
     keeps the local cache first, and compares against canonical before
     overwriting (Task 3): if canonical advanced beyond this device's last
     sync, the write is refused with {error:"conflict"} and a pending conflict
     is recorded — the caller (or the sync center) then resolves it explicitly
     with keep-mine / keep-theirs / merge. The user's new content is always
     kept in the local cache so no edit is ever silently discarded. */
  async function writeNamedDoc(name, doc, meta, opts) {
    opts = opts || {};
    const json = serialize(doc);
    const bytes = byteSize(json);
    if (bytes > api.maxDocBytes) {
      return {
        error: "document_too_large",
        message: "This document is " + fmtBytes(bytes) + " — above the " + fmtBytes(api.maxDocBytes) + " ceiling. Split the module by fiscal year or archive older records.",
        name, bytes,
      };
    }

    const existing = cacheGet(name);

    const baseRev = baseRevOf(name);
    const g = await editableGet(name);
    let canonRev = 0, canonical = null;
    if (!g.error && g.text != null) {
      try { canonical = JSON.parse(g.text); canonRev = (canonical && canonical.rev) || 0; } catch (e) {}
    }

    // True no-op: the canonical document already holds exactly this content.
    // (Compared against canonical, not the cache — a keep-mine push must still
    // overwrite a canonical that differs even though the cache is unchanged.)
    // Even though nothing is written, the local cache is brought in line so it
    // reflects the committed state (e.g. a merge that resolved to canonical's
    // content must not leave the cache showing the old version).
    if (canonical && serialize(canonical.records || []) === serialize(doc.records || [])) {
      const rev = canonical.rev || 0;
      doc = Object.assign({}, doc, { rev, updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner" });
      cachePut(name, doc);
      basePut(name, { rev, records: null });
      clearDirty(name);
      clearConflict(name);
      mergeRm(name);
      touchIndexFromDoc(name, doc);
      notifySync();
      return { error: null, name, noop: true, bytes, rev };
    }

    const localPrevRev = existing ? existing.rev || 0 : 0;

    if (canonRev > baseRev && !opts.force) {
      // Another device wrote since this device last synced. Keep the user's
      // work in the local cache, record a conflict, refuse to overwrite.
      const newRev = Math.max(localPrevRev, baseRev) + 1;
      doc = Object.assign({}, doc, {
        rev: newRev,
        updatedAt: new Date().toISOString(),
        updatedBy: ERP.role || "owner",
      });
      cachePut(name, doc);
      recordConflict(name, doc, canonical, baseRev, baseRecords(name, existing, canonical));
      notifySync();
      return { error: "conflict", name, conflict: true, localRev: newRev, canonicalRev: canonRev,
        message: "This document was changed on another device since your last sync. Review it in Sync & conflicts — nothing has been overwritten." };
    }

    const rev = Math.max(canonRev, localPrevRev, baseRev) + 1;
    doc = Object.assign({}, doc, { rev });
    const json2 = serialize(doc);
    const bytes2 = byteSize(json2);

    cachePut(name, doc); // fast local write first — the app is never blocked on the network

    const res = await editableSet(name, json2, keyGet(name));
    if (res.error) {
      markDirty(name);
      return Object.assign({ error: res.error, name, bytes: bytes2, local: true, message: res.message }, res);
    }
    if (res.superseded) {
      markDirty(name); // a later flush retries with the latest local state
      return { error: null, name, bytes: bytes2, local: true, superseded: true, rev };
    }
    if (res.unchanged) {
      // server already had identical content — treat as committed no-op
      basePut(name, { rev, records: null });
      touchIndexFromDoc(name, doc);
      return { error: null, name, bytes: bytes2, noop: true, rev };
    }

    if (res.editKey) keyPut(name, res.editKey); // key is issued only on first create
    basePut(name, { rev, records: null }); // committed → in sync, ancestor droppable
    touchIndex(name, Object.assign({
      rev,
      recordCount: (doc.records || []).length,
      bytes: bytes2,
      updatedAt: doc.updatedAt,
      module: (declaredDocs().find((d) => d.name === doc.doc) || {}).module || name,
      name: doc.doc,
      year: doc.year || null,
    }, meta || {}));
    scheduleIndexWrite();
    clearConflict(name); // a stale pending conflict is resolved by this write
    notifySync();
    /* Multi-user hub: tell teammates this document's version changed. */
    if (ERP.team && typeof ERP.team.announceChange === "function") {
      try { ERP.team.announceChange(name, rev); } catch (e) {}
    }
    return { error: null, name, bytes: bytes2, rev, created: !!res.created, editKey: res.editKey || null, superseded: false };
  }

  function writeDoc(moduleId, year, doc) {
    const d = docConfig(moduleId);
    return writeNamedDoc(docName(moduleId, year), doc, {
      module: moduleId,
      name: d.name,
      year: year || null,
    });
  }

  /* Push the cached document to canonical verbatim (no rev bump, no conflict
     check — the caller has already established it is safe). Used by the dirty
     flush and by sync's "local ahead" path. */
  async function pushDoc(name) {
    const doc = cacheGet(name);
    if (!doc) { clearDirty(name); return { error: null, name, noop: true }; }
    const res = await editableSet(name, serialize(doc), keyGet(name));
    if (res.error || res.superseded) return res;
    if (res.editKey) keyPut(name, res.editKey);
    clearDirty(name);
    basePut(name, { rev: doc.rev || 0, records: null });
    touchIndexFromDoc(name, doc);
    notifySync();
    return { error: null, name, rev: doc.rev || 0 };
  }

  /* Retry canonical writes that were superseded (rate-limited) or failed,
     from the latest local cache. Runs on an interval while anything is
     dirty, and once at boot. Never touches a document that is under a
     pending conflict — those wait for explicit resolution. */
  async function flushDirty() {
    const blocked = new Set(loadConflicts().map((c) => c.name));
    for (const name of [...dirty]) {
      if (blocked.has(name)) continue;
      await pushDoc(name);
    }
  }

  /* ─────────────────── Task 3: sync, adopt, conflicts, resolution ─────────────────── */

  function metaForDoc(doc) {
    const decl = declaredDocs().find((d) => d.name === doc.doc);
    return { module: decl ? decl.module : (doc.doc || ""), name: doc.doc || "", year: doc.year || null };
  }

  function baseRecords(name, local, canonical) {
    const b = baseGet(name);
    if (b && b.records) return b.records;
    return (local && local.records) || (canonical && canonical.records) || [];
  }

  /* Adopt the canonical document: local cache, watermark, index, dirty flag
     and any pending conflict are all brought in line. Only ever called when
     this device has no un-pushed changes of its own. */
  function adopt(name, canonical) {
    cachePut(name, canonical);
    basePut(name, { rev: canonical.rev || 0, records: null });
    clearDirty(name);
    clearConflict(name);
    mergeRm(name);
    touchIndexFromDoc(name, canonical);
    notifySync();
  }

  /* Record a pending conflict between this device's local copy and the
     canonical one. The canonical snapshot is stored so resolution works even
     after the editable layer's read-lag hides the current version. */
  function recordConflict(name, local, canonical, baseRev, baseRecs) {
    const list = loadConflicts();
    const existing = list.find((c) => c.name === name);
    if (existing) {
      if (canonical && (canonical.rev || 0) > (existing.canonicalRev || 0)) {
        existing.canonical = canonical;
        existing.canonicalRev = canonical.rev || 0;
        existing.detectedAt = new Date().toISOString();
      }
      saveConflicts(list);
      return existing;
    }
    const entry = {
      name,
      detectedAt: new Date().toISOString(),
      baseRev: baseRev || 0,
      localRev: (local && local.rev) || 0,
      canonicalRev: (canonical && canonical.rev) || 0,
      canonical: canonical || null,
      baseRecords: baseRecs || null,
    };
    list.push(entry);
    saveConflicts(list);
    return entry;
  }

  /* Reconcile one cached document against canonical. Never overwrites either
     side silently — the local cache keeps this device's work, canonical keeps
     the other devices', and any divergence is surfaced as a conflict. */
  async function syncDoc(name) {
    const local = cacheGet(name);
    if (!local) return { name, state: "none" };

    const existingConflict = conflictFor(name);
    const b = baseGet(name);
    const baseRev = b ? b.rev : (local.rev || 0);
    const baseRecs = b && b.records ? b.records : local.records;

    const g = await editableGet(name);
    if (g.error) return { name, state: "error", error: g.error };
    let canonical = null;
    if (g.text != null) { try { canonical = JSON.parse(g.text); } catch (e) {} }
    const canonRev = canonical ? canonical.rev || 0 : 0;

    const localRev = local.rev || 0;
    const localChanged = localRev > baseRev || dirty.has(name);

    if (existingConflict) {
      if (canonical && canonRev > (existingConflict.canonicalRev || 0)) {
        existingConflict.canonical = canonical;
        existingConflict.canonicalRev = canonRev;
        existingConflict.detectedAt = new Date().toISOString();
        saveConflicts(loadConflicts());
      }
      return { name, state: "conflict", conflict: existingConflict };
    }

    if (!canonical || canonRev === 0) {
      if (localChanged) {
        await pushDoc(name);
        return { name, state: "pushed" };
      }
      return { name, state: "in_sync" };
    }

    if (canonRev > baseRev && localChanged) {
      recordConflict(name, local, canonical, baseRev, baseRecs);
      return { name, state: "conflict", conflict: conflictFor(name) };
    }
    if (canonRev > baseRev) {
      adopt(name, canonical);
      return { name, state: "fast_forwarded", from: baseRev, to: canonRev };
    }
    if (localChanged) {
      await pushDoc(name);
      return { name, state: "pushed", to: localRev };
    }
    if (canonRev === localRev && !deepEq((canonical.records || []), (local.records || []))) {
      recordConflict(name, local, canonical, baseRev, baseRecs);
      return { name, state: "conflict", conflict: conflictFor(name) };
    }
    return { name, state: "in_sync" };
  }

  async function sync() {
    const names = cachedDocNames();
    const results = [];
    for (const name of names) results.push(await syncDoc(name));
    return {
      results,
      conflicts: loadConflicts(),
      synced: results.filter((r) => r.state === "fast_forwarded").length,
      pushed: results.filter((r) => r.state === "pushed").length,
      conflicted: results.filter((r) => r.state === "conflict").length,
      inSync: results.filter((r) => r.state === "in_sync").length,
      errors: results.filter((r) => r.error),
    };
  }

  /* Resolve a conflict. actions:
     "keep_mine"   — push this device's local copy, superseding canonical.
     "keep_theirs" — adopt the canonical copy, discarding local changes.
     "merge"       — 3-way merge; auto-commits when unambiguous, else returns
                     {status:"needs_decisions", fieldConflicts} for the user. */
  async function resolveConflict(name, action) {
    const entry = conflictFor(name);
    if (!entry) return { error: "no_conflict", name, action };
    const local = cacheGet(name);
    const canonical = entry.canonical || (await readRawCanonical(name));

    if (action === "keep_mine") {
      if (!local) { adopt(name, canonical); return { action, applied: true, discarded: "local" }; }
      clearConflict(name);
      basePut(name, { rev: canonical ? canonical.rev || 0 : 0, records: canonical ? canonical.records : null });
      const w = await writeNamedDoc(name, local, metaForDoc(local), { force: true });
      return { action, applied: !w.error, result: w };
    }

    if (action === "keep_theirs") {
      if (canonical) adopt(name, canonical);
      else { clearConflict(name); mergeRm(name); }
      return { action, applied: true };
    }

    if (action === "merge") {
      const baseRecs = entry.baseRecords || (local ? local.records : []);
      const m = threeWayMerge(local ? local.records : [], canonical ? canonical.records : [], baseRecs);
      if (!m.fieldConflicts.length) {
        clearConflict(name);
        basePut(name, { rev: canonical ? canonical.rev || 0 : 0, records: canonical ? canonical.records : null });
        const mergedDoc = Object.assign({}, local || canonical, { records: m.records, rev: 0 });
        const w = await writeNamedDoc(name, mergedDoc, metaForDoc(mergedDoc), { force: true });
        return { action, applied: !w.error, merged: m, result: w };
      }
      mergePut(name, {
        name, local, canonical,
        merged: m,
        baseRev: entry.baseRev,
        canonicalRev: entry.canonicalRev,
      });
      return { action, status: "needs_decisions", fieldConflicts: m.fieldConflicts, notes: m.notes };
    }

    return { error: "unknown_action", name, action };
  }

  async function readRawCanonical(name) {
    const g = await editableGet(name);
    if (g.error || g.text == null) return null;
    try { return JSON.parse(g.text); } catch (e) { return null; }
  }

  /* Resolve a single field-level conflict inside an in-progress merge, then
     auto-commit when no field conflicts remain. side is "mine" or "theirs". */
  async function resolveFieldConflict(name, recordId, field, side) {
    const st = mergeGet(name);
    if (!st || !st.merged) return { error: "no_merge_in_progress", name };
    const fc = st.merged.fieldConflicts.find((x) => String(x.recordId) === String(recordId) && x.field === field);
    if (!fc) return { error: "no_field_conflict", name, recordId, field };
    const val = side === "theirs" ? fc.theirs : fc.mine;
    const rec = st.merged.records.find((r) => String(r.id) === String(recordId));
    if (rec) rec[field] = val;
    st.merged.fieldConflicts = st.merged.fieldConflicts.filter((x) => !(String(x.recordId) === String(recordId) && x.field === field));
    if (st.merged.fieldConflicts.length) {
      mergePut(name, st);
      return { action: "merge", status: "needs_decisions", remaining: st.merged.fieldConflicts.length };
    }
    mergeRm(name);
    clearConflict(name);
    const canonical = st.canonical;
    basePut(name, { rev: canonical ? canonical.rev || 0 : 0, records: canonical ? canonical.records : null });
    const mergedDoc = Object.assign({}, st.local || canonical, { records: st.merged.records, rev: 0 });
    const w = await writeNamedDoc(name, mergedDoc, metaForDoc(mergedDoc), { force: true });
    return { action: "merge", committed: true, result: w };
  }

  /* A human label for a document, e.g. "Inventory · FY 2025". Falls back to
     the raw store name for docs with no declared module. */
  function humanDocName(name) {
    const prefix = STORE.namespace + "-v" + STORE.schemaVersion + "-";
    const decl = declaredDocs().find((d) => name === prefix + d.name || name.indexOf(prefix + d.name + "-") === 0);
    if (!decl) return name;
    const m = ERP.getModule(decl.module);
    let label = m ? m.label : decl.name;
    const yearPart = name.slice((prefix + decl.name).length + 1);
    if (decl.splitByYear && /^\d{4}$/.test(yearPart)) label += " · FY " + yearPart;
    return label;
  }

  /* ─────────────────── index ─────────────────── */

  function emptyIndex() {
    return {
      schema: "erp-index",
      schemaVersion: STORE.schemaVersion,
      rev: 0,
      updatedAt: new Date().toISOString(),
      documents: {},
    };
  }

  function loadIndexFromCache() {
    const raw = readLS(LS.index);
    if (raw == null) return null;
    try {
      const d = JSON.parse(raw);
      return d && d.schema === "erp-index" ? d : null;
    } catch (e) { return null; }
  }

  function touchIndex(docName, meta) {
    const idx = loadIndexFromCache() || emptyIndex();
    idx.documents[docName] = Object.assign({}, idx.documents[docName], meta);
    idx.updatedAt = new Date().toISOString();
    writeLS(LS.index, serialize(idx));
  }

  function touchIndexFromDoc(docName, doc) {
    const json = serialize(doc);
    const decl = declaredDocs().find((d) => d.name === doc.doc);
    touchIndex(docName, {
      module: decl ? decl.module : docName,
      name: doc.doc,
      year: doc.year || null,
      rev: doc.rev || 0,
      recordCount: (doc.records || []).length,
      bytes: byteSize(json),
      updatedAt: doc.updatedAt,
    });
  }

  let indexTimer = null;
  function scheduleIndexWrite() {
    if (indexTimer) return;
    indexTimer = setTimeout(() => { indexTimer = null; writeIndex(); }, 600);
  }

  async function writeIndex() {
    const idx = loadIndexFromCache() || emptyIndex();
    idx.rev = (idx.rev || 0) + 1;
    idx.updatedAt = new Date().toISOString();
    writeLS(LS.index, serialize(idx));
    const name = indexName();
    const json = serialize(idx);
    const res = await editableSet(name, json, keyGet(name));
    if (!res.error && res.editKey) keyPut(name, res.editKey);
  }

  async function getIndex(opts) {
    opts = opts || {};
    const cached = loadIndexFromCache();
    if (cached && !opts.force) return { index: cached, source: "cache" };
    const res = await editableGet(indexName());
    if (res.error) {
      return cached
        ? { index: cached, source: "cache", error: res.error, message: res.message }
        : { index: emptyIndex(), source: "empty", error: res.error, message: res.message };
    }
    let idx;
    if (res.text == null) {
      idx = emptyIndex();
    } else {
      try { idx = JSON.parse(res.text); } catch (e) { idx = cached || emptyIndex(); }
    }
    if (idx.documents && typeof idx.documents === "object") {
      writeLS(LS.index, serialize(idx));
      return { index: idx, source: res.text == null ? "empty" : "canonical" };
    }
    return { index: cached || emptyIndex(), source: "cache" };
  }

  function yearsForModule(moduleId) {
    const d = docConfig(moduleId);
    if (!d) return [];
    const idx = loadIndexFromCache() || emptyIndex();
    return Object.keys(idx.documents)
      .filter((n) => {
        const e = idx.documents[n];
        return e.name === d.name && e.year;
      })
      .map((n) => idx.documents[n].year)
      .sort((a, b) => a - b);
  }

  /* ─────────────────── public API ─────────────────── */

  const api = {
    namespace: STORE.namespace,
    schemaVersion: STORE.schemaVersion,
    maxDocBytes: STORE.maxDocBytes,
    indexName: indexName(),
    canonicalAvailable,

    docName,
    docConfig,
    declaredDocs,
    fiscalYearOf,
    currentFiscalYear,
    fmtBytes,

    /* Load a module's records. For split-by-year modules the default
       is the current fiscal year; pass {year} for a specific year or
       {all:true} to merge every year present in the index.
       Returns { doc, records, source, error, message }. */
    async loadDoc(moduleId, opts) {
      opts = opts || {};
      const d = docConfig(moduleId);
      if (!d) return { error: "no_doc_declared", module: moduleId, records: [] };
      if (d.splitByYear && opts.all) {
        const years = yearsForModule(moduleId);
        const docs = [];
        const records = [];
        for (const y of years) {
          const r = await readDoc(moduleId, y, docName(moduleId, y));
          if (r.doc) { docs.push(r.doc); if (r.doc.records) records.push.apply(records, r.doc.records); }
        }
        return { doc: docs[0] || null, records, docs, source: "cache", year: null };
      }
      const year = d.splitByYear ? opts.year || currentFiscalYear() : null;
      const name = docName(moduleId, year);
      const r = await readDoc(moduleId, year, name);
      return { doc: r.doc, records: r.doc ? r.doc.records || [] : [], source: r.source, error: r.error, message: r.message, year };
    },

    /* Save a module's records. Split-by-year modules partition the
       records by fiscal year and write one document per year.
       Returns { error, results, years, doc, superseded, noop }. */
    async saveDoc(moduleId, records, opts) {
      opts = opts || {};
      const d = docConfig(moduleId);
      if (!d) return { error: "no_doc_declared", module: moduleId };
      records = records || [];
      if (d.splitByYear) {
        const groups = {};
        for (const rec of records) {
          const y = fiscalYearOf(rec);
          (groups[y] = groups[y] || []).push(rec);
        }
        const years = Object.keys(groups).map(Number).sort((a, b) => a - b);
        const results = [];
        for (const y of years) results.push(await writeDoc(moduleId, y, buildDoc(moduleId, y, groups[y])));
        if (!years.length) return { error: null, noop: true, results: [], years: [] };
        const failed = results.find((r) => r.error);
        return { error: failed ? failed.error : null, message: failed ? failed.message : null, results, years };
      }
      const res = await writeDoc(moduleId, null, buildDoc(moduleId, null, records));
      return Object.assign({ doc: res.doc || null }, res);
    },

    /* Generic read of any document by its full store name. */
    async get(name) {
      const cached = cacheGet(name);
      if (cached) { refreshDoc(name); return { doc: cached, source: "cache" }; }
      const res = await editableGet(name);
      if (res.error) return { doc: null, source: "empty", error: res.error, message: res.message };
      if (res.text == null) return { doc: null, source: "empty" };
      let doc;
      try { doc = JSON.parse(res.text); } catch (e) { return { doc: null, source: "empty", error: "corrupt_document", message: "The stored document is not valid JSON." }; }
      cachePut(name, doc);
      return { doc, source: "canonical" };
    },

    /* Generic write of any document by its full store name. Accepts a
       full document object (has .schema) or a plain records array,
       which gets wrapped in a versioned erp-doc envelope. */
    async set(name, recordsOrDoc) {
      let doc = recordsOrDoc;
      if (!doc || doc.schema !== "erp-doc") {
        doc = {
          schema: "erp-doc",
          schemaVersion: STORE.schemaVersion,
          doc: logicalDocName(name),
          year: null,
          rev: 0,
          updatedAt: new Date().toISOString(),
          updatedBy: ERP.role || "owner",
          records: doc || [],
        };
      }
      return writeNamedDoc(name, doc);
    },

    getIndex,
    async refreshIndex() { return getIndex({ force: true }); },

    /* Swap the canonical backend (tests / restore flows). Pass null to
       return to the real upload-plugin editable layer. */
    useBackend(ed) { backendOverride = ed || null; },
    /* True while a stub/restore backend is in use (tests, restore flows).
       Realtime-hub features treat an overridden backend as "offline". */
    backendOverridden() { return !!backendOverride; },

    /* Task 3 — sync & conflicts. */
    setSyncListener,
    async sync() { return sync(); },
    async syncDoc(name) { return syncDoc(name); },
    conflicts() { return loadConflicts(); },
    conflictFor,
    /* synchronous access to the local cached doc + in-progress merge state
       (used by the sync center UI to render counts/field conflicts) */
    cachedDoc(name) { return cacheGet(name); },
    cachedDocNames() { return cachedDocNames(); },
    pendingMerge(name) { return mergeGet(name); },
    humanDocName,
    async resolveConflict(name, action) { return resolveConflict(name, action); },
    async resolveFieldConflict(name, recordId, field, side) {
      return resolveFieldConflict(name, recordId, field, side);
    },

    /* Fresh canonical read of any doc by full store name (backup/restore,
       Task 4). Returns {doc|null, error}. Also caches the result. */
    async readCanonical(name) {
      const g = await editableGet(name);
      if (g.error) return { doc: null, error: g.error, message: g.message };
      if (g.text == null) return { doc: null };
      let doc;
      try { doc = JSON.parse(g.text); } catch (e) {
        return { doc: null, error: "corrupt_document", message: "The stored document is not valid JSON." };
      }
      if (doc && doc.schema === "erp-doc") cachePut(name, doc);
      return { doc: doc && doc.schema === "erp-doc" ? doc : null };
    },

    /* Force-write a document, bypassing the compare-and-set conflict check.
       Used by backup restore (Task 4) — the user has explicitly chosen to
       overwrite. Also clears any pending conflict for the doc. */
    async forceSet(name, recordsOrDoc, meta) {
      let doc = recordsOrDoc;
      if (!doc || doc.schema !== "erp-doc") {
        doc = {
          schema: "erp-doc",
          schemaVersion: STORE.schemaVersion,
          doc: logicalDocName(name),
          year: null,
          rev: 0,
          updatedAt: new Date().toISOString(),
          updatedBy: ERP.role || "owner",
          records: doc || [],
        };
      }
      return writeNamedDoc(name, doc, meta, { force: true });
    },

    /* Write an empty document for a module+year (archival, Task 5). */
    async clearDoc(moduleId, year) {
      const d = docConfig(moduleId);
      if (!d) return { error: "no_doc_declared" };
      const name = docName(moduleId, year || null);
      return writeNamedDoc(name, emptyDoc(moduleId, year || null), {
        module: moduleId, name: d.name, year: year || null,
      });
    },

    /* Diagnostic status: what the store knows + capacity view data. */
    async status() {
      const idxRes = await getIndex({ force: true });
      const idx = idxRes.index;
      const docs = [];
      let totalBytes = 0;
      for (const declared of declaredDocs()) {
        const entries = Object.keys(idx.documents)
          .filter((n) => idx.documents[n].name === declared.name)
          .map((n) => Object.assign({ docName: n }, idx.documents[n]));
        entries.sort((a, b) => (a.year || 0) - (b.year || 0));
        docs.push({ module: declared.module, splitByYear: declared.splitByYear, entries });
        for (const e of entries) totalBytes += e.bytes || 0;
      }
      return {
        canonical: canonicalAvailable(),
        schemaVersion: STORE.schemaVersion,
        maxDocBytes: STORE.maxDocBytes,
        indexSource: idxRes.source,
        indexError: idxRes.error || null,
        docs,
        totalBytes,
      };
    },

    /* Clear local cache + edit keys + sync state (keeps canonical intact).
       Used by tests and by backup/restore (Task 4). */
    resetLocal(moduleId) {
      if (moduleId) {
        const d = docConfig(moduleId);
        if (!d) return;
        const prefix = LS.cache + STORE.namespace + "-v" + STORE.schemaVersion + "-" + d.name;
        const kprefix = LS.keys + STORE.namespace + "-v" + STORE.schemaVersion + "-" + d.name;
        const bprefix = LS.base + STORE.namespace + "-v" + STORE.schemaVersion + "-" + d.name;
        const mprefix = LS.merge + STORE.namespace + "-v" + STORE.schemaVersion + "-" + d.name;
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && (k.indexOf(prefix) === 0 || k.indexOf(kprefix) === 0 || k.indexOf(bprefix) === 0 || k.indexOf(mprefix) === 0)) localStorage.removeItem(k);
          }
          saveConflicts(loadConflicts().filter((c) => c.name.indexOf(STORE.namespace + "-v" + STORE.schemaVersion + "-" + d.name) !== 0));
        } catch (e) {}
        return;
      }
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.indexOf(LS.cache) === 0) localStorage.removeItem(k);
          if (k && k.indexOf(LS.keys) === 0) localStorage.removeItem(k);
          if (k && k.indexOf(LS.base) === 0) localStorage.removeItem(k);
          if (k && k.indexOf(LS.merge) === 0) localStorage.removeItem(k);
          if (k && (k === LS.flushes || k === LS.conflicts)) localStorage.removeItem(k);
        }
      } catch (e) {}
    },
    resetAllLocal() {
      api.resetLocal();
      rmLS(LS.index);
      dirty.clear();
    },
  };

  ERP.store = api;

  /* ─────────────────── boot: reconcile, then resume pending writes ─────────────────── */

  function boot() {
    // Task 3: reconcile the local cache against canonical on every startup —
    // adopt newer versions this device hasn't seen, push its own un-pushed
    // work, and surface any two-sided divergence as a pending conflict
    // (never silently discarding either side).
    sync().then(() => {
      if (dirty.size) flushDirty();
    });
    try {
      const raw = readLS(LS.flushes);
      if (raw) {
        const names = JSON.parse(raw);
        if (Array.isArray(names)) names.forEach((n) => dirty.add(n));
      }
    } catch (e) {}
    setInterval(() => { if (dirty.size) flushDirty(); }, 10000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
