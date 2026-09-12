/* ============================================================
   RMM-U — sync, conflict, backup & versioning  (Phase 1 · Task 5)

   Continuity is the console's safety net. It rides on the
   canonical document store (src/erp.store.js) and adds:

     • Startup reconciliation — the store already re-reads every
       cached document against its canonical copy on boot and
       surfaces two-sided divergence as a pending conflict; this
       module records that reconcile run and exposes its report.
     • Keep-mine / keep-theirs / field-level merge — the topbar
       Sync Center (src/erp.sync.js) drives the store's conflict
       engine; this module links to it and shows the open-conflict
       state alongside the reconcile report.
     • One-click full backup — download a JSON bundle and/or publish
       the same bundle into RMM-U's own storage namespace, with a
       validated restore that refuses malformed documents (engine
       in src/erp.backup.js).
     • Version history with restore — a bounded, attributable ring
       of per-document snapshots (this file). Every committed write
       schedules a debounced capture, so the recent history of every
       document can be viewed, compared and restored.
     • Capacity & guided archival — per-document size against the
       storage ceiling, with a recommendation per document and
       one-click archival of a retired tenant aggregate.

   The console lives in the Reports station ("Data & continuity"):
   tabs for Sync, Version history, Backup & restore, and Capacity &
   archival. Everything is exposed as window.ERP.continuity for
   later phases (the alert pipeline, patch compliance and audit all
   lean on version history).

   Storage note: snapshots are kept in their own canonical document
   (rmm-v1-versions), so history survives across devices and travels
   in backups. It is deliberately bounded — per-document count, per
   snapshot and total bytes — so versioning can never push the
   store over its ceiling.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store) return;
  const store = ERP.store;
  const ui = ERP.ui;
  const DC = (ERP.continuity = {});

  /* ─────────────────────────── helpers ─────────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const now = () => new Date().toISOString();
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const json = (v) => JSON.stringify(v == null ? null : v);
  const rand = (n) => { let s = ""; const c = "abcdefghijklmnopqrstuvwxyz0123456789"; for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0]; return s; };
  const byteSize = (t) => { try { return new Blob([String(t)]).size; } catch (e) { return String(t).length; } };
  function hashText(t) { let h = 5381; const s = String(t); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  DC.HISTORY_MODULE = "versions";
  DC.NAMESPACE_PREFIX = store.namespace + "-v" + store.schemaVersion + "-";
  DC.HISTORY_DOC = DC.NAMESPACE_PREFIX + "versions";   // rmm-v1-versions
  DC.BACKUP_DOC = DC.NAMESPACE_PREFIX + "backup";      // rmm-v1-backup

  const EXCLUDED = new Set([DC.HISTORY_DOC, DC.BACKUP_DOC, store.indexName]);
  DC.EXCLUDED = EXCLUDED;

  let LIMITS = {
    perDoc: cfg("rmm.versionHistoryPerDoc", 25),
    totalBytes: cfg("rmm.versionHistoryBytes", 3 * 1024 * 1024),
    snapshotBytes: Math.min(cfg("rmm.versionSnapshotBytes", 1536 * 1024), Math.floor(store.maxDocBytes * 0.4)),
  };

  DC.configure = function (opts) { Object.assign(LIMITS, opts || {}); return DC.limits(); };
  DC.limits = function () { return Object.assign({}, LIMITS); };

  let seqCounter = 0;
  const listeners = [];

  DC.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }
  DC.notify = notify;

  function actorName() {
    try {
      if (ERP.team && typeof ERP.team.me === "function") {
        const me = ERP.team.me();
        if (me && me.displayName) return String(me.displayName);
      }
    } catch (e) {}
    return ERP.role || "owner";
  }

  async function audit(action, targetType, targetId, summary) {
    try {
      if (ERP.master && typeof ERP.master.audit === "function") {
        await ERP.master.audit({ action, targetType, targetId, summary });
      }
    } catch (e) {}
  }

  function logicalName(name) {
    return name.indexOf(DC.NAMESPACE_PREFIX) === 0 ? name.slice(DC.NAMESPACE_PREFIX.length) : name;
  }

  async function readDoc(name) {
    const r = await store.get(name);
    return r && r.doc ? r.doc : null;
  }

  async function labelMap() {
    const T = ERP.tenancy;
    const providers = {};
    if (T && typeof T.list === "function") {
      try { (await T.list()).forEach((p) => { providers[p.id] = p.name; }); } catch (e) {}
    }
    return { providers };
  }

  function docLabel(name, map) {
    if (name.indexOf(DC.NAMESPACE_PREFIX + "provider-") === 0) {
      const id = name.slice((DC.NAMESPACE_PREFIX + "provider-").length);
      const nm = map && map.providers && map.providers[id];
      return "Tenant · " + (nm || id);
    }
    try { return store.humanDocName(name); } catch (e) { return name; }
  }
  DC.docLabel = docLabel;

  /* ─────────────────────────── history store ─────────────────────────── */

  async function loadHistory() {
    const r = await store.loadDoc(DC.HISTORY_MODULE);
    const list = r && !r.error && Array.isArray(r.records) ? r.records : [];
    return list.filter((e) => e && e.doc);
  }

  function saveHistory(hist) {
    return store.put(DC.HISTORY_DOC, hist, { module: DC.HISTORY_MODULE, name: "versions", year: null }, { force: true });
  }

  function newestFor(hist, doc) {
    let best = null;
    for (const e of hist) {
      if (e.doc !== doc) continue;
      if (!best || (e.at || "") > (best.at || "") || ((e.at || "") === (best.at || "") && (e.seq || 0) > (best.seq || 0))) best = e;
    }
    return best;
  }

  function prune(hist) {
    const removed = [];
    const byDoc = {};
    hist.forEach((e) => { (byDoc[e.doc] = byDoc[e.doc] || []).push(e); });
    Object.keys(byDoc).forEach((d) => {
      const list = byDoc[d].slice().sort((a, b) => (b.at || "").localeCompare(a.at || "") || (b.seq || 0) - (a.seq || 0));
      while (list.length > LIMITS.perDoc) {
        const gone = list.pop();
        const i = hist.indexOf(gone);
        if (i >= 0) { hist.splice(i, 1); removed.push(gone); }
      }
    });
    let total = hist.reduce((n, e) => n + (e.bytes || 0), 0);
    if (total > LIMITS.totalBytes) {
      const oldest = hist.slice().sort((a, b) => (a.at || "").localeCompare(b.at || "") || (a.seq || 0) - (b.seq || 0));
      for (const e of oldest) {
        if (total <= LIMITS.totalBytes) break;
        const i = hist.indexOf(e);
        if (i >= 0) { hist.splice(i, 1); removed.push(e); total -= (e.bytes || 0); }
      }
    }
    return removed;
  }

  /* ─────────────────────────── capture ─────────────────────────── */

  /* Snapshot one document's current records into the version ring.
     De-duplicates against the newest snapshot for that document; a
     snapshot larger than the per-snapshot cap is skipped (reported),
     never silently dropped. */
  DC.capture = async function (docName, opts) {
    opts = opts || {};
    if (!docName || EXCLUDED.has(docName)) return { skipped: true, reason: "excluded", doc: docName };
    const doc = opts.doc || (await readDoc(docName));
    if (!doc) return { error: "no_doc", doc: docName };
    const records = asArr(doc.records);
    const text = json(records);
    const size = byteSize(text);
    if (size > LIMITS.snapshotBytes && !opts.force) return { skipped: true, reason: "too_large", bytes: size, doc: docName };

    const hist = await loadHistory();
    const last = newestFor(hist, docName);
    const hash = hashText(text);
    if (!opts.force && last && (last.rev || 0) === (doc.rev || 0) && last.hash === hash) {
      return { skipped: true, reason: "unchanged", doc: docName, entry: last };
    }
    const entry = {
      id: "ver-" + Date.now().toString(36) + "-" + rand(4),
      seq: ++seqCounter,
      doc: docName,
      rev: doc.rev || 0,
      docDoc: doc.doc || logicalName(docName),
      docYear: doc.year == null ? null : doc.year,
      at: now(),
      actor: actorName(),
      reason: opts.reason || "manual",
      bytes: size,
      count: records.length,
      hash,
      records: clone(records),
    };
    hist.push(entry);
    const pruned = prune(hist);
    const w = await saveHistory(hist);
    if (w && w.error) return { error: w.error, message: w.message, doc: docName };
    notify("capture", { entry, pruned: pruned.length });
    return { entry, pruned: pruned.length };
  };

  /* Snapshot every document whose index revision moved past its newest
     snapshot. This is the automatic writer: a debounced scan after any
     committed write, and the explicit "Capture all now" action. */
  DC.captureChanged = async function (opts) {
    opts = opts || {};
    const idx = (await store.getIndex()).index;
    const hist = await loadHistory();
    const changed = [];
    for (const name of Object.keys(idx.documents || {})) {
      if (EXCLUDED.has(name)) continue;
      const meta = idx.documents[name] || {};
      if (!(meta.bytes > 0)) continue;
      const last = newestFor(hist, name);
      if (!last || (meta.rev || 0) > (last.rev || 0)) changed.push(name);
    }
    const captured = [];
    for (const name of changed) {
      const r = await DC.capture(name, { reason: opts.reason || "auto" });
      if (r && r.entry) captured.push(name);
    }
    return { captured, scanned: Object.keys(idx.documents || {}).length };
  };

  DC.captureAll = async function (opts) {
    opts = opts || {};
    const idx = (await store.getIndex()).index;
    const captured = [];
    for (const name of Object.keys(idx.documents || {})) {
      if (EXCLUDED.has(name)) continue;
      const r = await DC.capture(name, { reason: opts.reason || "manual", force: true });
      if (r && r.entry) captured.push(name);
    }
    return { captured };
  };

  /* ─────────────────────────── read / restore ─────────────────────────── */

  DC.list = async function (opts) {
    opts = opts || {};
    const hist = await loadHistory();
    const map = await labelMap();
    let list = hist.map((e) => Object.assign({}, e, { label: docLabel(e.doc, map) }));
    if (opts.doc) list = list.filter((e) => e.doc === opts.doc);
    if (opts.reason) list = list.filter((e) => e.reason === opts.reason);
    list.sort((a, b) => (b.at || "").localeCompare(a.at || "") || (b.seq || 0) - (a.seq || 0));
    if (opts.limit) list = list.slice(0, opts.limit);
    if (!opts.withRecords) list = list.map((e) => { const c = Object.assign({}, e); delete c.records; return c; });
    return list;
  };

  DC.get = async function (id) {
    const hist = await loadHistory();
    const e = hist.find((x) => String(x.id) === String(id));
    if (!e) return null;
    const map = await labelMap();
    return Object.assign({}, e, { label: docLabel(e.doc, map) });
  };

  DC.compare = async function (id) {
    const e = await DC.get(id);
    if (!e) return { error: "not_found" };
    const cur = (await readDoc(e.doc)) || { records: [] };
    const a = asArr(e.records);
    const b = asArr(cur.records);
    const keyOf = (r, i) => (r && r.id != null ? "id:" + r.id : "#" + i);
    const mapA = new Map(a.map((r, i) => [keyOf(r, i), r]));
    const mapB = new Map(b.map((r, i) => [keyOf(r, i), r]));
    const added = [], removed = [], changed = [];
    mapB.forEach((r, k) => { if (!mapA.has(k)) added.push(k); else if (json(mapA.get(k)) !== json(r)) changed.push(k); });
    mapA.forEach((r, k) => { if (!mapB.has(k)) removed.push(k); });
    return {
      doc: e.doc, label: e.label, versionId: e.id, versionRev: e.rev, versionAt: e.at,
      currentRev: cur.rev || 0, added, removed, changed,
      unchanged: a.length - removed.length - changed.length,
      total: a.length, currentCount: b.length,
    };
  };

  /* Restore a snapshot. The current state is snapshotted first, so a
     restore is itself reversible. Force-writes deliberately bypass the
     compare-and-set guard — the user has explicitly chosen this version. */
  DC.restore = async function (id) {
    const e = await DC.get(id);
    if (!e) return { error: "not_found", id };
    const pre = await DC.capture(e.doc, { reason: "pre-restore", force: true });
    const cur = await readDoc(e.doc);
    const env = {
      schema: store.docSchema,
      schemaVersion: store.schemaVersion,
      doc: (cur && cur.doc) || e.docDoc || logicalName(e.doc),
      year: e.docYear == null ? null : e.docYear,
      rev: 0,
      updatedAt: now(),
      updatedBy: actorName(),
      records: clone(asArr(e.records)),
    };
    const w = await store.forceSet(e.doc, env);
    if (w && w.error) return { error: w.error, message: w.message, doc: e.doc };
    await audit("restore_version", "version", e.id, "Restored " + docLabel(e.doc, await labelMap()) + " to revision " + e.rev + " (" + asArr(e.records).length + " records).");
    notify("restore", { entry: e });
    return { ok: true, doc: e.doc, restored: asArr(e.records).length, rev: w.rev, preSnapshot: (pre && pre.entry && pre.entry.id) || null };
  };

  DC.prune = async function () {
    const hist = await loadHistory();
    const removed = prune(hist);
    if (removed.length) await saveHistory(hist);
    return { removed: removed.length, kept: hist.length };
  };

  DC.clear = async function (opts) {
    opts = opts || {};
    const hist = await loadHistory();
    const kept = opts.doc ? hist.filter((e) => e.doc !== opts.doc) : [];
    const w = await saveHistory(kept);
    notify("clear", { doc: opts.doc || null, cleared: hist.length - kept.length });
    return { cleared: hist.length - kept.length, kept: kept.length, error: (w && w.error) || null };
  };

  DC.stats = async function () {
    const hist = await loadHistory();
    const total = hist.reduce((n, e) => n + (e.bytes || 0), 0);
    const docs = {};
    hist.forEach((e) => { docs[e.doc] = (docs[e.doc] || 0) + 1; });
    const at = hist.map((e) => e.at).filter(Boolean).sort();
    return {
      snapshots: hist.length, docs: Object.keys(docs).length, bytes: total, byDoc: docs,
      oldest: at[0] || null, newest: at[at.length - 1] || null,
      perDoc: LIMITS.perDoc, totalLimit: LIMITS.totalBytes, snapshotLimit: LIMITS.snapshotBytes,
    };
  };

  /* ─────────────────────────── capacity & archival ─────────────────────────── */

  function adviceFor(pct) {
    if (pct >= 90) return { label: "At risk", tone: "danger", hint: "One more write may exceed the ceiling — archive or trim this document now." };
    if (pct >= 75) return { label: "Archive soon", tone: "warn", hint: "Approaching the write ceiling — archive a closed period or retire the data." };
    if (pct >= 50) return { label: "Watch", tone: "info", hint: "Growing — consider archival once the period is closed." };
    return { label: "Healthy", tone: "muted", hint: "Comfortably under the ceiling." };
  }

  /* Size one document's envelope. Prefers the fast local cache, falling
     back to a canonical read, so a document that exists canonically but
     is missing from the (possibly stale or empty) store index is still
     measured. */
  async function envelopeMeta(name) {
    let doc = store.cachedDoc ? store.cachedDoc(name) : null;
    if (!doc) {
      const r = await store.readCanonical(name);
      doc = r && r.doc;
    }
    if (!doc) return null;
    const decl = (store.declaredDocs() || []).find((d) => d.name === doc.doc);
    return {
      bytes: byteSize(json(doc)),
      recordCount: asArr(doc.records).length,
      rev: doc.rev || 0,
      updatedAt: doc.updatedAt || "",
      year: doc.year == null ? null : doc.year,
      module: decl ? decl.module : name,
    };
  }

  /* Every document the console owns: those the index knows about, plus
     the declared module documents and the per-tenant provider
     aggregates, plus anything currently cached. The index alone is not
     authoritative — a device that has only ever *read* a document (never
     written it here) has it canonically but not in its local index, so a
     capacity report built from the index alone would under-report. */
  async function candidateDocNames(indexDocs) {
    const names = new Set(Object.keys(indexDocs || {}));
    const cached = store.cachedDocNames ? store.cachedDocNames() : [];
    (store.declaredDocs() || []).forEach((d) => {
      if (!d || !d.name) return;
      if (d.splitByYear) {
        const logical = DC.NAMESPACE_PREFIX + d.name;
        cached.concat(Object.keys(indexDocs || {})).forEach((n) => {
          if (n === logical || n.indexOf(logical + "-") === 0) names.add(n);
        });
      } else {
        try { names.add(store.docName(d.module, null)); } catch (e) {}
      }
    });
    const T = ERP.tenancy;
    if (T && typeof T.list === "function") {
      try { (await T.list()).forEach((p) => { if (p && p.id) names.add(T.providerDocName(p.id)); }); } catch (e) {}
    }
    cached.forEach((n) => names.add(n));
    EXCLUDED.forEach((n) => names.delete(n));
    return Array.from(names);
  }

  DC.capacity = async function () {
    const idxRes = await store.getIndex();
    const idx = idxRes.index || { documents: {} };
    const map = await labelMap();
    const ceiling = store.maxDocBytes;
    const names = await candidateDocNames(idx.documents || {});
    const rows = [];
    for (const name of names) {
      let e = (idx.documents || {})[name];
      if (!e || e.bytes == null) {
        const measured = await envelopeMeta(name);
        if (!measured) continue;
        e = measured;
      }
      const r = {
        doc: name, label: docLabel(name, map), bytes: e.bytes || 0, recordCount: e.recordCount || 0,
        rev: e.rev || 0, updatedAt: e.updatedAt || "", year: e.year == null ? null : e.year,
        module: e.module || "", isProvider: name.indexOf(DC.NAMESPACE_PREFIX + "provider-") === 0,
      };
      r.pct = Math.round((r.bytes / ceiling) * 1000) / 10;
      const adv = adviceFor(r.pct);
      r.advice = adv.label; r.tone = adv.tone; r.hint = adv.hint;
      rows.push(r);
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    const total = rows.reduce((n, r) => n + r.bytes, 0);
    return { rows, total, ceiling, count: rows.length, indexSource: idxRes.source, at: now() };
  };

  DC.documents = async function () {
    const cap = await DC.capacity();
    const hist = await loadHistory();
    const byDoc = {};
    hist.forEach((e) => { (byDoc[e.doc] = byDoc[e.doc] || []).push(e); });
    return cap.rows.map((r) => {
      const list = byDoc[r.doc] || [];
      const newest = list.slice().sort((a, b) => (b.at || "").localeCompare(a.at || "") || (b.seq || 0) - (a.seq || 0))[0] || null;
      return {
        doc: r.doc, label: r.label, bytes: r.bytes, recordCount: r.recordCount, rev: r.rev,
        updatedAt: r.updatedAt, pct: r.pct, advice: r.advice, tone: r.tone,
        snapshots: list.length, lastAt: newest ? newest.at : null, lastRev: newest ? newest.rev : null,
      };
    });
  };

  /* Documents that would benefit from archival, with a concrete action
     where one exists (a retired tenant, or a closed fiscal-year doc). */
  DC.archiveCandidates = async function () {
    const cap = await DC.capacity();
    const T = ERP.tenancy;
    let providers = [];
    if (T && typeof T.list === "function") { try { providers = await T.list(); } catch (e) {} }
    const byId = {}; providers.forEach((p) => { byId[p.id] = p; });
    const out = [];
    for (const r of cap.rows) {
      const providerId = r.isProvider ? r.doc.slice((DC.NAMESPACE_PREFIX + "provider-").length) : null;
      if (providerId) {
        const rec = byId[providerId];
        if (rec && rec.status === "archived") {
          out.push({ doc: r.doc, label: r.label, bytes: r.bytes, pct: r.pct, kind: "provider", providerId, actionable: true, reason: "Tenant is archived — move its aggregate to the read-only archive." });
        } else if (r.pct >= 60) {
          out.push({ doc: r.doc, label: r.label, bytes: r.bytes, pct: r.pct, kind: "provider", providerId, actionable: false, reason: "Large tenant document — archive it once the tenant is retired." });
        }
      } else if (r.year && r.year !== store.currentFiscalYear() && r.recordCount > 0) {
        out.push({ doc: r.doc, label: r.label, bytes: r.bytes, pct: r.pct, kind: "year", year: r.year, module: r.module, actionable: true, reason: "Closed fiscal-year document — archive it to trim the live store." });
      } else if (r.pct >= 60) {
        out.push({ doc: r.doc, label: r.label, bytes: r.bytes, pct: r.pct, kind: "doc", actionable: false, reason: "Over 60% of the ceiling — trim or split this document's records." });
      }
    }
    out.sort((a, b) => b.bytes - a.bytes);
    return out;
  };

  /* Move a retired tenant's aggregate into the read-only archive doc and
     empty the live document so it stops consuming space. Recoverable via
     DC.restoreTenantArchive. */
  DC.archiveTenant = async function (docName) {
    const T = ERP.tenancy;
    if (!T || typeof T.get !== "function") return { error: "no_tenancy" };
    if (docName.indexOf(DC.NAMESPACE_PREFIX + "provider-") !== 0) return { error: "not_a_provider" };
    const id = docName.slice((DC.NAMESPACE_PREFIX + "provider-").length);
    const g = await T.get(id);
    if (g.error) return { error: g.error, message: g.message, providerId: id };
    await DC.capture(docName, { reason: "pre-archive" });
    const loaded = await store.loadDoc(ERP.MASTER.archive, { all: true });
    const archRecs = asArr(loaded.records);
    const entry = {
      id: Date.now(),
      originModule: "providers",
      originLabel: "Tenant · " + g.provider.name,
      originDoc: docName,
      providerId: id,
      provider: clone(g.provider),
      recordCount: 1,
      archivedAt: now(),
      date: now(),
      kind: "tenant",
      records: [clone(g.provider)],
    };
    archRecs.push(entry);
    const w1 = await store.saveDoc(ERP.MASTER.archive, archRecs);
    if (w1.error) return { error: w1.error, message: w1.message, stage: "archive_write" };
    const w2 = await store.put(docName, [], { module: T.REGISTRY_MODULE, name: "provider-" + id, year: null });
    if (w2.error) return { error: w2.error, message: w2.message, stage: "clear_live" };
    const reg = asArr((await store.loadDoc(T.REGISTRY_MODULE)).records).filter((p) => p.id !== id);
    await store.saveDoc(T.REGISTRY_MODULE, reg);
    T.reload();
    await audit("archive_tenant", "provider", id, "Archived tenant " + g.provider.name + " to the read-only archive.");
    notify("archive", { entry });
    return { ok: true, archived: 1, archiveId: entry.id, providerId: id };
  };

  DC.restoreTenantArchive = async function (archiveId) {
    const T = ERP.tenancy;
    if (!T || typeof T.save !== "function") return { error: "no_tenancy" };
    const loaded = await store.loadDoc(ERP.MASTER.archive, { all: true });
    const archRecs = asArr(loaded.records);
    const entry = archRecs.find((e) => String(e.id) === String(archiveId));
    if (!entry) return { error: "not_found" };
    const p = clone(entry.provider) || (entry.records && entry.records[0]);
    if (!p) return { error: "no_provider_payload" };
    p.status = "active";
    const r = await T.save(p);
    if (r.error) return { error: r.error, message: r.message };
    const remaining = archRecs.filter((e) => String(e.id) !== String(archiveId));
    const y = store.fiscalYearOf(entry);
    if (remaining.length) await store.saveDoc(ERP.MASTER.archive, remaining);
    else await store.clearDoc(ERP.MASTER.archive, y);
    T.reload();
    await audit("restore_tenant", "provider", p.id, "Restored tenant " + p.name + " from the archive.");
    notify("restore-archive", { entry });
    return { ok: true, restored: 1, providerId: p.id };
  };

  /* ─────────────────────────── reconciliation ─────────────────────────── */

  DC.lastReport = null;
  DC.lastReconciledAt = null;

  DC.reconcile = async function (opts) {
    opts = opts || {};
    let report;
    try { report = await store.sync(); }
    catch (e) { report = { results: [], conflicts: store.conflicts(), errors: [{ error: String((e && e.message) || e) }] }; }
    DC.lastReport = report;
    DC.lastReconciledAt = now();
    let captured = { captured: [] };
    if (opts.capture !== false) { try { captured = await DC.captureChanged({ reason: "reconcile" }); } catch (e) {} }
    notify("reconcile", { report, at: DC.lastReconciledAt });
    return Object.assign({}, report, { captured: captured.captured || [], at: DC.lastReconciledAt });
  };

  /* ─────────────────────────── automatic capture ─────────────────────────── */

  let installed = false;
  let scanTimer = null;

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (store.backendOverridden && store.backendOverridden()) return; // tests / restore flows: never write history behind a stub
      DC.captureChanged({ reason: "auto" }).catch(() => {});
    }, 1200);
  }

  DC.install = function () {
    if (installed) return false;
    installed = true;
    ["saveDoc", "put", "forceSet", "clearDoc"].forEach((m) => {
      const fn = store[m];
      if (typeof fn !== "function") return;
      store[m] = function () {
        const p = fn.apply(store, arguments);
        try { Promise.resolve(p).then(() => scheduleScan(), () => {}); } catch (e) {}
        return p;
      };
    });
    setTimeout(() => {
      if (store.backendOverridden && store.backendOverridden()) return;
      DC.reconcile({ capture: true }).catch(() => {});
    }, 3500);
    return true;
  };
  DC.installed = () => installed;

  /* ─────────────────────────── console UI ─────────────────────────── */

  const REASON_TONE = { auto: "info", manual: "muted", reconcile: "info", "pre-restore": "warn", "pre-archive": "warn", initial: "muted" };
  function reasonBadge(r) { return ui.badge(r || "manual", REASON_TONE[r] || "muted"); }
  function sizeCell(n) { return store.fmtBytes(n || 0); }
  function bar(pct) {
    const p = Math.min(100, Math.max(0, pct || 0));
    return '<div class="erp-cap-bar"><span style="width:' + p + '%"></span></div><span class="erp-cap-pct">' + p + "%</span>";
  }
  function shortDoc(name) { return name.length > 46 ? name.slice(0, 43) + "…" : name; }

  DC.render = async function (ctx) {
    const root = ctx.el;
    const hostClass = root.className || "";
    const T = ERP.tenancy;
    const backup = ERP.backup;
    let tab = validTab(root.__tab) || "sync";
    let filterDoc = "";
    const state = { capacity: null, docs: [], history: [], archived: [], published: null, candidates: [] };

    function validTab(id) {
      return id === "sync" || id === "versions" || id === "backup" || id === "capacity" || id === "reports" || id === "schedules" || id === "deliveries" || id === "quality" ? id : null;
    }

    async function loadAll() {
      state.capacity = await DC.capacity();
      state.docs = await DC.documents();
      state.history = await DC.list({});
      state.candidates = await DC.archiveCandidates();
      state.archived = backup ? await backup.archivedDocs() : [];
      state.published = backup ? await backup.publishedBackup() : null;
    }

    function statBlock() {
      const conflicts = store.conflicts().length;
      const stor = state.capacity ? state.capacity.total : 0;
      const cap = state.capacity ? state.capacity.ceiling : store.maxDocBytes;
      return ui.grid([
        ui.statCard({ label: "Open conflicts", value: String(conflicts), tone: conflicts ? "warn" : null, sub: conflicts ? "review & resolve" : "all in sync" }),
        ui.statCard({ label: "Snapshots kept", value: String(state.history.length), sub: "recent versions" }),
        ui.statCard({ label: "Documents", value: String(state.capacity ? state.capacity.count : 0), sub: "tracked in the store" }),
        ui.statCard({ label: "Stored", value: store.fmtBytes(stor), sub: "of " + store.fmtBytes(cap) + " per doc" }),
      ], "erp-kpi-grid");
    }

    /* ── sync tab ── */
    function syncPanel() {
      const conflicts = store.conflicts();
      const report = DC.lastReport;
      let html = "";
      html += ui.card("Reconcile with the canonical store",
        '<p class="erp-sub">On startup — and whenever you press Sync — every document on this device is compared with its canonical copy. A document edited on two consoles at once is <b>never</b> overwritten silently: it is held as a conflict until you keep mine, keep theirs, or merge field by field.</p>' +
        '<div class="erp-btn-row">' + ui.btn("Reconcile now", { act: "dc-reconcile", primary: true }) + ui.btn("Open sync center", { act: "dc-open-sync" }) + "</div>" +
        (DC.lastReconciledAt ? '<p class="erp-sub">Last reconcile: ' + ui.dateTime(DC.lastReconciledAt) + "</p>" : ""));
      if (conflicts.length) {
        html += ui.card("Open conflicts", ui.table([
          { key: "doc", label: "Document", render: (c) => "<b>" + ui.esc(store.humanDocName(c.name)) + "</b>" },
          { key: "revs", label: "Revisions", render: (c) => "yours " + (c.localRev || 0) + " · other " + (c.canonicalRev || 0) },
          { key: "at", label: "Detected", render: (c) => ui.dateTime(c.detectedAt) },
          { key: "act", label: "", render: () => ui.btn("Review", { small: true, act: "dc-open-sync" }) },
        ], conflicts, { emptyText: "No conflicts." }));
      } else {
        html += ui.card("Conflicts", ui.alert("All documents are in sync. Nothing has been overwritten — if another console changes a document, it appears here for review.", "success"));
      }
      if (report) {
        const rows = (report.results || []).filter((r) => r.state !== "in_sync").map((r) => ({
          doc: store.humanDocName(r.name), state: r.state, detail: r.error || (r.from != null ? "rev " + r.from + " → " + (r.to || r.to) : ""),
        }));
        html += ui.card("Last reconcile report",
          ui.summary([
            { label: "Updated", value: String(report.synced || 0) },
            { label: "Pushed", value: String(report.pushed || 0) },
            { label: "Conflicted", value: String(report.conflicted || 0) },
            { label: "Up to date", value: String(report.inSync || 0) },
            { label: "Captured", value: String((report.captured || []).length) },
          ]) +
          ui.table([
            { key: "doc", label: "Document" },
            { key: "state", label: "Result", render: (r) => ui.badge(r.state, r.state === "conflict" ? "warn" : r.state === "error" ? "danger" : "info") },
            { key: "detail", label: "Detail", render: (r) => ui.esc(r.detail || "") },
          ], rows, { emptyText: "Everything reconciled with no changes." }));
      }
      return html;
    }

    /* ── version history tab ── */
    function versionsPanel() {
      const docs = state.docs.slice().sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
      const hist = filterDoc ? state.history.filter((e) => e.doc === filterDoc) : state.history;
      const docOpts = ['<option value="">All documents (' + state.history.length + " snapshots)</option>"]
        .concat(docs.map((d) => '<option value="' + ui.esc(d.doc) + '"' + (filterDoc === d.doc ? " selected" : "") + ">" + ui.esc(d.label) + " — " + d.snapshots + " snapshot" + (d.snapshots === 1 ? "" : "s") + "</option>")).join("");
      const rows = hist.map((e) => ({
        document: '<span class="rmm-dc-ver">' + ui.esc(e.label) + '</span><span class="rmm-dc-sub">' + ui.esc(shortDoc(e.doc)) + "</span>",
        rev: "r" + (e.rev || 0),
        at: ui.dateTime(e.at),
        by: ui.esc(e.actor || ""),
        reason: reasonBadge(e.reason),
        n: ui.fmt(e.count || 0, 0),
        size: sizeCell(e.bytes),
        actions: ui.btn("View", { small: true, act: "dc-view-version", arg: e.id }) + " " +
          ui.btn("Compare", { small: true, act: "dc-compare-version", arg: e.id }) + " " +
          ui.btn("Restore", { small: true, act: "dc-restore-version", arg: e.id }),
      }));
      const controls =
        '<div class="rmm-dc-controls">' +
          '<label class="rmm-dc-filter">Document <select data-dc-filter>' + docOpts + "</select></label>" +
          '<div class="erp-btn-row">' + ui.btn("Capture all now", { small: true, act: "dc-capture-all" }) + ui.btn("Prune", { small: true, act: "dc-prune" }) + ui.btn("Clear history…", { small: true, danger: true, act: "dc-clear-history" }) + "</div>" +
        "</div>" +
        '<p class="erp-sub">Every committed write schedules a snapshot. Kept per document: ' + LIMITS.perDoc + " · per snapshot cap: " + store.fmtBytes(LIMITS.snapshotBytes) + " · total cap: " + store.fmtBytes(LIMITS.totalBytes) + ". Restoring a version snapshots the current state first, so a restore is reversible.</p>";
      return ui.card("Version history", controls) +
        ui.card("Snapshots", ui.table([
          { key: "document", label: "Document", render: (r) => r.document },
          { key: "rev", label: "Rev", align: "right" },
          { key: "at", label: "Captured" },
          { key: "by", label: "By" },
          { key: "reason", label: "Reason", render: (r) => r.reason },
          { key: "n", label: "Records", align: "right" },
          { key: "size", label: "Size", align: "right" },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No snapshots yet — capture one, or make a change and it will be captured automatically." }));
    }

    /* ── backup tab ── */
    function backupPanel() {
      const pub = state.published;
      const pubHtml = pub
        ? '<p class="erp-alert tone-success">Published backup: ' + ui.dateTime(pub.exportedAt) + " · " + Object.keys(pub.docs || {}).length + " documents · " + store.fmtBytes(byteSize(json(pub))) + "</p>"
        : '<p class="erp-alert">No published backup yet. Publish one so another device can restore from RMM-U\'s own namespace.</p>';
      return ui.card("Full backup",
        pubHtml +
        '<p class="erp-sub">Download saves every document to a JSON file on your device. Publish stores the same bundle in RMM-U\'s own storage namespace (re-publishing identical content is a safe no-op).</p>' +
        '<div class="erp-btn-row">' +
          ui.btn("Download backup", { primary: true, act: "dc-backup-download" }) +
          ui.btn("Publish backup", { act: "dc-backup-publish" }) +
          ui.btn("Restore published", { act: "dc-restore-published" }) +
          ui.btn("Restore from file…", { act: "dc-restore-file" }) +
        "</div>") +
        ui.card("Validated restore",
          ui.alert("Restore overwrites every matching document with the backup's contents. The bundle is schema-checked first — any malformed document is reported and skipped. This is the one action that intentionally overrides the conflict protection.", "warn") +
          '<p class="erp-sub">Snapshots in the version history are included in the bundle, so restoring a backup also restores the recent version history.</p>');
    }

    /* ── capacity tab ── */
    function capacityPanel() {
      const cap = state.capacity || { rows: [], total: 0, ceiling: store.maxDocBytes };
      const rows = cap.rows.map((r) => ({
        doc: "<b>" + ui.esc(r.label) + "</b>" + (r.doc !== r.label ? '<div class="rmm-dc-sub">' + ui.esc(shortDoc(r.doc)) + "</div>" : ""),
        recs: ui.fmt(r.recordCount, 0),
        size: sizeCell(r.bytes),
        bar: bar(r.pct),
        advice: ui.badge(r.advice, r.tone),
      }));
      const cands = state.candidates;
      const candHtml = cands.length
        ? '<ul class="rmm-dc-guidance">' + cands.map((c) => (
            '<li><div class="rmm-dc-g-text"><b>' + ui.esc(c.label) + "</b><span class=\"erp-sub\">" + ui.esc(c.reason) + " · " + sizeCell(c.bytes) + " · " + c.pct + "% of ceiling</span></div>" +
            (c.kind === "provider" && c.actionable ? ui.btn("Archive tenant", { small: true, danger: true, act: "dc-archive-tenant", arg: c.doc }) :
             c.kind === "year" && c.actionable ? ui.btn("Archive year…", { small: true, act: "dc-archive-year" }) : "")
          )).join("") + "</ul>"
        : ui.alert("Every document is comfortably under the ceiling. Nothing needs archiving right now.", "success");
      return ui.card("Storage",
        ui.summary([
          { label: "Total stored", value: store.fmtBytes(cap.total) },
          { label: "Ceiling / document", value: store.fmtBytes(cap.ceiling) },
          { label: "Documents", value: String(cap.rows.length) },
          { label: "Archived periods", value: String(state.archived.length) },
        ]) +
        ui.table([
          { key: "doc", label: "Document", render: (r) => r.doc },
          { key: "recs", label: "Records", align: "right" },
          { key: "size", label: "Size", align: "right" },
          { key: "bar", label: "vs ceiling", render: (r) => r.bar },
          { key: "advice", label: "Advice", render: (r) => r.advice },
        ], rows, { scroll: true, emptyText: "No documents stored yet." })) +
        ui.card("Guided archival", candHtml) +
        ui.card("Read-only archive",
          (state.archived.length
            ? ui.table([
                { key: "label", label: "Archived period", render: (r) => "<b>" + ui.esc(r.originLabel) + "</b>" + (r.kind === "tenant" ? ' <span class="erp-sub">tenant</span>' : " · FY " + ui.esc(r.originYear)) },
                { key: "n", label: "Records", align: "right", render: (r) => ui.fmt(r.recordCount || asArr(r.records).length, 0) },
                { key: "at", label: "Archived", render: (r) => ui.dateTime(r.archivedAt) },
                { key: "act", label: "", render: (r) => ui.btn("View", { small: true, act: "dc-view-archive", arg: r.id }) + " " + ui.btn("Restore", { small: true, act: "dc-restore-archive", arg: r.id }) },
              ], state.archived, { emptyText: "Nothing archived." })
            : '<p class="erp-sub">Archived records stay readable here and can be restored at any time. Archived tenants are recoverable in full.</p>'));
    }

    async function reportCtx() {
      const providers = (await ERP.tenancy.list()).filter((p) => p.status !== "archived");
      const providerId = (DC.reportProviderId && providers.some((p) => p.id === DC.reportProviderId)) ? DC.reportProviderId : (providers[0] || {}).id;
      DC.__providers = providers;
      return { providers, providerId };
    }

    async function renderReportTab(id) {
      const panel = root.querySelector('[data-panel="' + id + '"]');
      if (!panel) return;
      const rc = await reportCtx();
      const o = { providerId: rc.providerId, providers: rc.providers, toast: ctx.toast, onProvider: (v) => { DC.reportProviderId = v; } };
      if (id === "quality") {
        const DQ = ERP.dataQuality;
        if (!DQ) { panel.innerHTML = ui.alert("The data-quality linter module is not loaded.", "warn"); return; }
        return DQ.renderPanel(panel, o);
      }
      const RP = ERP.rmmReports;
      if (!RP) { panel.innerHTML = ui.alert("The reporting module is not loaded.", "warn"); return; }
      if (id === "reports") return RP.renderLibrary(panel, o);
      if (id === "schedules") return RP.renderSchedules(panel, o);
      if (id === "deliveries") return RP.renderDeliveries(panel, o);
    }

    async function paint() {
      ui.loading(root, "Loading data & continuity");
      await loadAll();
      root.className = hostClass;
      const conflicts = store.conflicts().length;
      const tabs = ui.tabs([
        { id: "sync", label: "Sync & conflicts", badge: conflicts ? String(conflicts) : "" },
        { id: "versions", label: "Version history", badge: String(state.history.length) },
        { id: "backup", label: "Backup & restore" },
        { id: "capacity", label: "Capacity & archival" },
        { id: "reports", label: "Client reports" },
        { id: "schedules", label: "Report schedules" },
        { id: "deliveries", label: "Deliveries" },
        { id: "quality", label: "Data quality" },
      ], tab);
      root.innerHTML =
        ui.pageHead("Data & continuity",
          "Reconcile every document with its canonical copy, resolve two-console edits, back up and restore the whole console, keep a restorable version history, and run or schedule the per-client reports — with per-document storage reporting and guided archival.",
          ui.badge(store.canonicalAvailable() ? "Canonical backup on" : "Local only", store.canonicalAvailable() ? "success" : "muted")) +
        statBlock() + tabs.html;
      root.querySelector('[data-panel="sync"]').innerHTML = syncPanel();
      root.querySelector('[data-panel="versions"]').innerHTML = versionsPanel();
      root.querySelector('[data-panel="backup"]').innerHTML = backupPanel();
      root.querySelector('[data-panel="capacity"]').innerHTML = capacityPanel();
      ui.showTab(root, tab);
      if (tab === "reports" || tab === "schedules" || tab === "deliveries" || tab === "quality") await renderReportTab(tab);
    }

    async function openVersion(id) {
      const e = await DC.get(id);
      if (!e) return ctx.toast("Snapshot not found.", "error");
      const recs = asArr(e.records);
      const cols = recs.length ? Object.keys(recs[0]).filter((k) => k !== "records") : [];
      const table = recs.length
        ? ui.table(cols.map((k) => ({ key: k, label: k })), recs, { scroll: true, emptyText: "No records." })
        : "<p class=\"erp-modal-note\">This version is empty (the document had no records).</p>";
      ui.modal({
        title: "Version · " + e.label + " · r" + (e.rev || 0),
        body: '<p class="erp-modal-note">Captured ' + ui.dateTime(e.at) + " by <b>" + ui.esc(e.actor) + "</b> (" + ui.esc(e.reason) + ") · " + recs.length + " record" + (recs.length === 1 ? "" : "s") + " · " + sizeCell(e.bytes) + "</p>" + table,
        size: "lg",
        foot: ui.btn("Close", { small: true, act: "v-close" }) + " " + ui.btn("Restore this version", { small: true, primary: true, act: "v-restore" }),
      });
      const m = document.querySelector("#uiModal");
      m.querySelector("[data-act=v-close]").onclick = () => ui.closeModal();
      m.querySelector("[data-act=v-restore]").onclick = async () => { ui.closeModal(); await doRestore(id); };
    }

    async function compareVersion(id) {
      const d = await DC.compare(id);
      if (d.error) return ctx.toast("Snapshot not found.", "error");
      const ids = (label, arr, tone) => arr.length
        ? '<div class="rmm-dc-ids"><b>' + label + " (" + arr.length + "):</b> " + arr.map((x) => "<code>" + ui.esc(x) + "</code>").join(", ") + "</div>"
        : "";
      ui.modal({
        title: "Compare · " + d.label,
        body: '<p class="erp-modal-note">Version r' + d.versionRev + " (" + ui.dateTime(d.versionAt) + ") vs the current document r" + d.currentRev + ".</p>" +
          '<div class="rmm-dc-diff">' +
            "<div><span>Added since</span><b>" + d.added.length + "</b></div>" +
            "<div><span>Removed since</span><b>" + d.removed.length + "</b></div>" +
            "<div><span>Changed since</span><b>" + d.changed.length + "</b></div>" +
            "<div><span>Unchanged</span><b>" + Math.max(0, d.unchanged) + "</b></div>" +
          "</div>" +
          ids("Added", d.added) + ids("Removed", d.removed) + ids("Changed", d.changed) +
          '<p class="erp-sub">Record identity is matched by <code>id</code> where present.</p>',
        foot: ui.btn("Close", { small: true, act: "c-close" }),
      });
      const m = document.querySelector("#uiModal");
      m.querySelector("[data-act=c-close]").onclick = () => ui.closeModal();
    }

    async function doRestore(id) {
      const ok = await ui.confirm({ title: "Restore this version?", message: "The document is replaced with this snapshot. The current contents are captured as a new snapshot first, so you can restore forward again.", okLabel: "Restore", danger: true });
      if (!ok) return;
      const r = await DC.restore(id);
      if (r.error) return ctx.toast("Restore failed: " + (r.message || r.error), "error");
      ctx.toast("Restored " + r.restored + " record(s).");
      tab = "versions";
      await paint();
    }

    root.onclick = async (e) => {
      const tabEl = e.target.closest ? e.target.closest("[data-tab]") : null;
      if (tabEl && root.contains(tabEl)) {
        const id = tabEl.getAttribute("data-tab");
        if (validTab(id)) {
          tab = id; ui.showTab(root, tab);
          if (id === "reports" || id === "schedules" || id === "deliveries" || id === "quality") await renderReportTab(id);
        }
        return;
      }
      const el = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el || !root.contains(el)) return;
      const act = el.getAttribute("data-act");
      const arg = el.getAttribute("data-arg");

      if (act === "dc-open-sync") { if (ERP.syncCenter) ERP.syncCenter.open(); return; }
      if (act === "dc-reconcile") {
        el.disabled = true;
        const rep = await DC.reconcile();
        ctx.toast("Reconciled — " + (rep.synced || 0) + " updated, " + (rep.pushed || 0) + " pushed, " + (rep.conflicted || 0) + " conflicted.", rep.conflicted ? "error" : null);
        await paint();
        return;
      }
      if (act === "dc-capture-all") {
        el.disabled = true;
        const r = await DC.captureAll({ reason: "manual" });
        ctx.toast("Captured " + r.captured.length + " document(s).");
        await paint(); return;
      }
      if (act === "dc-prune") {
        const r = await DC.prune();
        ctx.toast(r.removed ? "Pruned " + r.removed + " old snapshot(s)." : "Nothing to prune.");
        await paint(); return;
      }
      if (act === "dc-clear-history") {
        const ok = await ui.confirm({ title: "Clear version history", message: "Remove every stored snapshot? Documents are untouched; only the ability to restore an older version is lost.", okLabel: "Clear", danger: true });
        if (!ok) return;
        const r = await DC.clear();
        ctx.toast("Cleared " + r.cleared + " snapshot(s).");
        await paint(); return;
      }
      if (act === "dc-view-version") return openVersion(arg);
      if (act === "dc-compare-version") return compareVersion(arg);
      if (act === "dc-restore-version") return doRestore(arg);

      if (act === "dc-backup-download") {
        el.disabled = true;
        try { const b = await backup.downloadBackup(); ctx.toast("Backup downloaded — " + Object.keys(b.docs || {}).length + " documents."); }
        catch (err) { ctx.toast("Download failed: " + ((err && err.message) || err), "error"); }
        el.disabled = false; return;
      }
      if (act === "dc-backup-publish") {
        el.disabled = true; el.textContent = "Publishing…";
        try {
          const res = await backup.publishBackup();
          ctx.toast(res.noop ? "Backup already published (identical content)." : "Backup published to the RMM-U namespace.");
          await paint();
        } catch (err) { ctx.toast("Publish failed: " + ((err && err.message) || err), "error"); el.disabled = false; }
        return;
      }
      if (act === "dc-restore-published") {
        const b = await backup.publishedBackup();
        if (!b) { ctx.toast("No published backup found.", "error"); return; }
        root.__renderBackup = paint;
        return backup.restoreUi(root, b);
      }
      if (act === "dc-restore-file") {
        const input = backup.fileInput();
        input.onchange = async (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          try { const b = JSON.parse(await f.text()); root.__renderBackup = paint; backup.restoreUi(root, b); }
          catch (err) { ctx.toast("Could not read that file: " + ((err && err.message) || err), "error"); }
        };
        input.click(); return;
      }

      if (act === "dc-archive-tenant") {
        const ok = await ui.confirm({ title: "Archive this tenant?", message: "The tenant aggregate moves to the read-only archive and its live document is emptied. You can restore it in full from the archive at any time.", okLabel: "Archive", danger: true });
        if (!ok) return;
        const r = await DC.archiveTenant(arg);
        ctx.toast(r.ok ? "Tenant archived." : "Archive failed: " + (r.message || r.error), r.ok ? "success" : "error");
        await paint(); return;
      }
      if (act === "dc-archive-year") {
        if (backup) backup.archivePickerUi(root, paint);
        return;
      }
      if (act === "dc-view-archive") {
        const entry = state.archived.find((x) => String(x.id) === String(arg));
        if (entry && entry.kind === "tenant") return openTenantArchive(entry);
        if (entry && backup) backup.archiveViewUi(entry, paint);
        return;
      }
      if (act === "dc-restore-archive") {
        const entry = state.archived.find((x) => String(x.id) === String(arg));
        if (entry && entry.kind === "tenant") {
          const ok = await ui.confirm({ title: "Restore archived tenant?", message: "The tenant is written back to its live document and re-added to the registry. The archive entry is removed.", okLabel: "Restore" });
          if (!ok) return;
          const r = await DC.restoreTenantArchive(arg);
          ctx.toast(r.ok ? "Tenant restored." : "Restore failed: " + (r.message || r.error), r.ok ? "success" : "error");
          await paint(); return;
        }
        if (backup) {
          const ok = await ui.confirm({ title: "Restore archived period?", message: "The archived records move back to the live document. The archive entry is removed.", okLabel: "Restore" });
          if (!ok) return;
          const r = await backup.restoreArchive(arg);
          ctx.toast(r.ok ? "Restored " + r.restored + " record(s)." : "Restore failed: " + (r.message || r.error), r.ok ? "success" : "error");
          await paint();
        }
        return;
      }
    };

    root.onchange = (e) => {
      const sel = e.target && e.target.matches && e.target.matches("[data-dc-filter]") ? e.target : null;
      if (!sel) return;
      filterDoc = sel.value;
      tab = "versions";
      paint();
    };

    async function openTenantArchive(entry) {
      const p = entry.provider || (entry.records && entry.records[0]) || {};
      ui.modal({
        title: "Archived tenant · " + (p.name || entry.providerId),
        size: "lg",
        body: '<p class="erp-modal-note"><b>Read-only.</b> Archived ' + ui.dateTime(entry.archivedAt) + " · " + store.fmtBytes(byteSize(json(p))) + "</p>" +
          '<div class="rmm-kv">' +
            krow("Provider id", p.id) + krow("Status", p.status) + krow("Timezone", p.timezone) +
            krow("Sites", asArr(p.sites).length) + krow("Device groups", asArr(p.deviceGroups).length) + krow("Devices", asArr(p.devices).length) +
          "</div>",
        foot: ui.btn("Close", { small: true, act: "ta-close" }) + " " + ui.btn("Restore tenant", { small: true, primary: true, act: "ta-restore" }),
      });
      const m = document.querySelector("#uiModal");
      m.querySelector("[data-act=ta-close]").onclick = () => ui.closeModal();
      m.querySelector("[data-act=ta-restore]").onclick = async () => {
        ui.closeModal();
        const r = await DC.restoreTenantArchive(entry.id);
        ctx.toast(r.ok ? "Tenant restored." : "Restore failed: " + (r.message || r.error), r.ok ? "success" : "error");
        await paint();
      };
    }

    function krow(label, val) {
      return '<div class="rmm-kv-row"><span>' + ui.esc(label) + "</span><b>" + ui.esc(val == null ? "—" : String(val)) + "</b></div>";
    }

    try {
      await paint();
    } catch (e) {
      root.className = hostClass;
      ctx.error({ title: "Could not load data & continuity", message: (e && e.message) || String(e), retry: { label: "Retry", onClick: () => paint() } });
    }
  };

  /* ─────────────────────────── boot ─────────────────────────── */

  DC.install();
})();
