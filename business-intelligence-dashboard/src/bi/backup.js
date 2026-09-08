/* ============================================================
   BI backup & restore (task 4).

   create()   — one-click full backup: collects every canonical
                report/dashboard/metric-catalog/view/settings/
                schedule/archive definition into a backup envelope,
                returns it (for a downloadable file) and can also
                publish it as a canonical "backup" document.
   validate() — validates a backup BEFORE anything is replaced:
                schema, per-doc id/kind/data, and total size vs
                the store ceiling. Nothing is written on failure.
   restore()  — writes each document back through the store's
                idempotent, version-checked layer (force restores
                over a remote-newer doc only when the user chose
                to restore — re-publishing identical content is a
                free no-op).
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const backup = (BI.backup = {});

  const SCHEMA = "bi/backup/v1";
  const INCLUDE_KINDS = ["report", "dashboard", "metricCatalog", "view", "settings", "schedule", "archive"];

  function collectDocs() {
    const out = [];
    for (const e of BI.store.list()) {
      if (!INCLUDE_KINDS.includes(e.kind)) continue;
      const d = BI.store.get(e.id);
      if (!d) continue;
      out.push({
        id: d.id,
        kind: d.kind,
        label: d.label,
        meta: d.meta || {},
        data: d.data,
        version: d.version,
      });
    }
    return out;
  }

  /* Build the backup envelope (also used for the downloadable file). */
  backup.create = function () {
    const docs = collectDocs();
    const payload = {
      schema: SCHEMA,
      generatedAt: new Date().toISOString(),
      deviceId: BI.store.deviceId(),
      version: 1,
      docCount: docs.length,
      docs,
    };
    return payload;
  };

  /* Downloadable file (one-click full backup). */
  backup.download = function () {
    const payload = backup.create();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bi-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return payload;
  };

  /* Published backup document (canonical store doc, kind "backup"). */
  backup.publish = async function () {
    const payload = backup.create();
    const id = "backup-" + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const existing = BI.store.get(id);
    const res = existing
      ? await BI.store.update(id, payload, { force: true })
      : await BI.store.create({ id, kind: "backup", label: "Backup " + payload.generatedAt.slice(0, 10), data: payload });
    return res.ok ? { ok: true, id, doc: res.envelope } : res;
  };

  /* Latest published backup, if any. */
  backup.latest = function () {
    const entries = BI.store.list().filter((e) => e.kind === "backup").sort((a, b) => b.id.localeCompare(a.id));
    return entries.length ? BI.store.get(entries[0].id) : null;
  };

  /* Accept a raw backup (parsed JSON from a file, or a backup doc's data). */
  function normalizeInput(raw) {
    if (!raw || typeof raw !== "object") return { error: { code: "invalid_backup", message: "The backup is not a JSON object." } };
    const payload = raw.schema === SCHEMA ? raw : raw.data && raw.data.schema === SCHEMA ? raw.data : null;
    if (!payload) return { error: { code: "invalid_backup", message: "Not a BI backup (missing schema 'bi/backup/v1')." } };
    if (!Array.isArray(payload.docs)) return { error: { code: "invalid_backup", message: "The backup has no documents list." } };
    return { payload };
  }

  /* Validate a backup without writing anything. */
  backup.validate = function (raw) {
    const { payload, error } = normalizeInput(raw);
    if (error) return { ok: false, error };
    const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
    const kinds = ["report", "dashboard", "metricCatalog", "view", "settings", "schedule", "backup", "archive"];
    const problems = [];
    let sizeBytes = 0;
    const docs = [];
    for (const d of payload.docs) {
      if (!d || !ID_RE.test(String(d.id || ""))) { problems.push("invalid id: " + (d && d.id)); continue; }
      if (!kinds.includes(d.kind)) { problems.push("invalid kind '" + (d && d.kind) + "' for " + (d && d.id)); continue; }
      if (d.data == null || typeof d.data !== "object") { problems.push("document " + d.id + " has no data object"); continue; }
      sizeBytes += new TextEncoder().encode(JSON.stringify(d)).length;
      docs.push(d);
    }
    const ceiling = BI.store.status().ceilingBytes;
    if (sizeBytes > ceiling) {
      problems.push("total restore size (" + sizeBytes + " B) exceeds the store ceiling (" + ceiling + " B)");
    }
    if (problems.length) {
      return { ok: false, error: { code: "backup_invalid_doc", message: "The backup failed validation: " + problems.join("; ") }, problems, sizeBytes, docCount: payload.docs.length };
    }
    return { ok: true, payload, docs, sizeBytes, docCount: docs.length };
  };

  /* Restore — validated first; nothing is replaced if validation fails.
     Each doc goes back through the store's version-checked layer: a backup
     doc that is OLDER than the current local version is refused (a newer
     edit exists) unless the caller passes {force:true} — restoring is
     deliberate, but never silently clobbers newer work. */
  backup.restore = async function (raw, opts) {
    opts = opts || {};
    const v = backup.validate(raw);
    if (!v.ok) return v;
    const force = opts.force === true;
    const summary = { restored: 0, idempotent: 0, errors: [] };
    for (const d of v.docs) {
      let res;
      if (BI.store.exists(d.id)) {
        const cur = BI.store.get(d.id);
        const backupVersion = Number(d.version) || 0;
        const localVersion = Number(cur && cur.version) || 0;
        if (!force && backupVersion < localVersion) {
          summary.errors.push({ id: d.id, error: "remote_newer", local: localVersion, backup: backupVersion });
          continue;
        }
        res = await BI.store.update(d.id, d.data, { meta: d.meta, label: d.label, force });
      } else {
        res = await BI.store.create({ id: d.id, kind: d.kind, label: d.label, meta: d.meta, data: d.data });
        if (!res.ok && res.error && res.error.code === "exists") {
          /* the remote copy already exists but isn't in this device's cache —
             adopt it first so the update path has a local base (edit keys
             still come from the creating device via importEditKeys) */
          await BI.store.refresh(d.id);
          res = await BI.store.update(d.id, d.data, { meta: d.meta, label: d.label, force });
        }
      }
      if (res.ok) {
        if (res.changed === false) summary.idempotent++;
        else summary.restored++;
      } else {
        summary.errors.push({ id: d.id, error: res.error && res.error.code });
      }
    }
    if (summary.errors.length) {
      return { ok: false, error: { code: "restore_partial", message: "Restored " + summary.restored + " docs but " + summary.errors.length + " failed." }, summary };
    }
    return { ok: true, summary };
  };

  /* Restore from a published backup document id. */
  backup.restoreFromDoc = async function (id, opts) {
    const doc = BI.store.get(id);
    if (!doc || doc.kind !== "backup") return { ok: false, error: { code: "not_found", message: "No backup document '" + id + "'." } };
    return backup.restore(doc.data, opts);
  };
})();
