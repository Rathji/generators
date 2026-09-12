/* ============================================================
   BUSINESS ERP — backup & restore (Task 4) and capacity &
   archival (Task 5)
   - One-click full backup: a downloadable JSON file (every module
     document, byte-complete) PLUS a published backup document in
     the ERP's own editable namespace. Restore is validated — every
     document is schema-checked before anything is written, and
     writes are idempotent (re-publishing identical content is a
     safe no-op via the store's unchanged-write detection).
   - Capacity view: every document's size against the storage
     ceiling. Archival: closed prior-period documents are moved to
     a clearly-labeled read-only archive that stays retrievable on
     demand (and can be restored).
   UI lives under Admin → Data & sync (psa.admin.js hosts the tab;
   this file exposes ERP.backup.{engine, renderPanel}).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = ERP.store;
  const ui = ERP.ui;
  const backup = (ERP.backup = {});

  /* ─────────────────────────── backup ─────────────────────────── */

  const BACKUP_NAME = "psa-v1-backup";

  /* Collect every document this generator owns into one bundle.
     Uses fresh canonical reads so the file reflects committed state. */
  backup.backupBundle = async function () {
    const names = new Set();
    const idx = (await store.getIndex()).index;
    Object.keys(idx.documents || {}).forEach((n) => names.add(n));
    /* Also include every document this device has cached/touched but the
       canonical index has not caught up with — a full backup must never miss
       a tenant document just because the index write is debounced. */
    try { (store.cachedDocNames ? store.cachedDocNames() : []).forEach((n) => names.add(n)); } catch (e) {}
    for (const decl of store.declaredDocs()) {
      if (decl.splitByYear) {
        names.add(store.docName(decl.module));
        try {
          for (const y of store.yearsForModule ? store.yearsForModule(decl.module) : []) {
            names.add(store.docName(decl.module, y));
          }
        } catch (e) {}
      } else {
        names.add(store.docName(decl.module));
      }
    }
    names.add(store.indexName);
    names.delete(BACKUP_NAME); // a backup never contains the backup doc itself

    const docs = {};
    const errors = [];
    for (const name of names) {
      const r = await store.readCanonical(name);
      if (r.error) { errors.push({ name, error: r.error }); continue; }
      if (r.doc) docs[name] = r.doc;
    }
    return {
      schema: "psa-backup",
      version: 1,
      generator: window.generatorName || "psa-u",
      exportedAt: new Date().toISOString(),
      docs,
      errors,
    };
  };

  backup.downloadBackup = async function () {
    const bundle = await backup.backupBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (window.generatorName || "erp") + "-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return bundle;
  };

  /* Publish the bundle to the ERP's own namespace. Re-publishing when no
     document content changed is a safe no-op (exportedAt is cosmetic and
     ignored when comparing). */
  backup.publishBackup = async function () {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("backup.manage");
    const bundle = await backup.backupBundle();
    delete bundle.errors;
    const existing = await backup.publishedBackup();
    const unchanged = existing && existing.generator === bundle.generator &&
      JSON.stringify(existing.docs || {}) === JSON.stringify(bundle.docs || {});
    if (unchanged) return { noop: true, published: true };
    const res = await store.forceSet(BACKUP_NAME, {
      schema: "psa-doc",
      schemaVersion: 1,
      doc: "backup",
      year: null,
      rev: 0,
      updatedAt: new Date().toISOString(),
      updatedBy: ERP.role || "owner",
      records: [bundle],
    }, { module: "backup", name: "backup", year: null });
    return res;
  };

  backup.publishedBackup = async function () {
    const r = await store.readCanonical(BACKUP_NAME);
    if (r.doc && r.doc.records && r.doc.records[0] && r.doc.records[0].schema === "psa-backup") return r.doc.records[0];
    return null;
  };

  /* Validate a bundle. Returns { valid, errors: [{doc, error}], docs }.
     A document is only included if it parses as a versioned psa-doc. */
  backup.validateBundle = function (obj) {
    const errors = [];
    if (!obj || obj.schema !== "psa-backup") {
      return { valid: false, errors: [{ doc: "(bundle)", error: "Not a PSA-U backup — expected schema \"psa-backup\"." }], docs: {} };
    }
    const docs = {};
    for (const name of Object.keys(obj.docs || {})) {
      const d = obj.docs[name];
      if (!d || d.schema !== "psa-doc") {
        errors.push({ doc: name, error: "Skipped: not a versioned psa-doc." });
        continue;
      }
      if (!Array.isArray(d.records)) {
        errors.push({ doc: name, error: "Skipped: missing records array." });
        continue;
      }
      docs[name] = d;
    }
    return { valid: errors.length === 0, errors, docs };
  };

  /* Restore a validated bundle. Every document is force-written; the local
     cache follows. Returns { written, errors }. */
  backup.restoreBundle = async function (bundle, opts) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("backup.manage");
    opts = opts || {};
    const v = backup.validateBundle(bundle);
    const written = [];
    const errors = v.errors.slice();
    if (!v.valid && !opts.allowPartial) return { written, errors, partial: false };
    for (const name of Object.keys(v.docs)) {
      const doc = v.docs[name];
      if (opts.docs && opts.docs.length && opts.docs.indexOf(name) === -1) continue;
      const r = await store.forceSet(name, JSON.parse(JSON.stringify(doc)));
      if (r.error) errors.push({ doc: name, error: r.message || r.error });
      else written.push(name);
    }
    store.resetLocal(); // local cache now mirrors the restored canonical
    await ERP.master.audit({ action: "restore_backup", perm: "backup.manage", targetType: "backup", targetId: 0, summary: "Restored " + written.length + " document(s) from a backup bundle" + (opts.docs ? " (selected)" : "") + "." });
    return { written, errors, partial: errors.length > 0 };
  };

  /* ─────────────────────────── capacity (Task 5) ─────────────────────────── */

  backup.capacity = async function () {
    const st = await store.status();
    const rows = [];
    let total = 0;
    for (const d of st.docs) {
      for (const e of d.entries) {
        total += e.bytes || 0;
        rows.push({
          module: d.module,
          label: store.humanDocName(e.docName),
          year: e.year || null,
          recordCount: e.recordCount || 0,
          bytes: e.bytes || 0,
          rev: e.rev || 0,
          updatedAt: e.updatedAt || "",
        });
      }
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    return { rows, total, ceiling: store.maxDocBytes, canonical: st.canonical };
  };

  /* ─────────────────────────── archival (Task 5) ─────────────────────────── */

  /* Move one closed fiscal year's documents into the read-only archive.
     The live doc is emptied so it stops growing the module's footprint. */
  backup.archiveDoc = async function (moduleId, year) {
    if (ERP.team && typeof ERP.team.guard === "function") await ERP.team.guard("data.manage");
    const mod = ERP.getModule(moduleId);
    if (!mod || !mod.doc) return { error: "no_doc_declared", module: moduleId };
    const r = await store.loadDoc(moduleId, { year });
    const records = r.records || [];
    const archName = store.docName(ERP.MASTER.archive, store.currentFiscalYear());
    const a = await store.get(archName);
    const archRecs = (a.doc && a.doc.records) || [];
    const entry = {
      id: Date.now(),
      originModule: moduleId,
      originLabel: mod.label,
      originYear: year,
      archivedAt: new Date().toISOString(),
      date: new Date().toISOString(),
      recordCount: records.length,
      records,
    };
    archRecs.push(entry);
    const w1 = await store.saveDoc(ERP.MASTER.archive, archRecs);
    if (w1.error) return { error: w1.error, message: w1.message, stage: "archive_write" };
    const w2 = await store.clearDoc(moduleId, year);
    if (w2.error) return { error: w2.error, message: w2.message, stage: "clear_live" };
    await ERP.master.audit({ action: "archive", perm: "data.manage", targetType: "doc", targetId: moduleId + ":" + year, summary: "Archived " + records.length + " record(s) from " + mod.label + " FY " + year + " to the read-only archive." });
    return { ok: true, archived: records.length, moduleId, year };
  };

  backup.archivedDocs = async function () {
    const r = await store.loadDoc(ERP.MASTER.archive, { all: true });
    return (r.records || []).sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));
  };

  backup.viewArchived = async function (archiveId) {
    const list = await backup.archivedDocs();
    return list.find((e) => String(e.id) === String(archiveId)) || null;
  };

  /* Restore an archived period back to its live module document. */
  backup.restoreArchive = async function (archiveId) {
    const list = await backup.archivedDocs();
    const entry = list.find((e) => String(e.id) === String(archiveId));
    if (!entry) return { error: "not_found" };
    const mod = ERP.getModule(entry.originModule);
    if (!mod || !mod.doc) return { error: "no_doc_declared" };
    const name = store.docName(entry.originModule, entry.originYear);
    const cur = await store.readCanonical(name);
    const existing = (cur.doc && cur.doc.records) || [];
    const merged = existing.concat(entry.records || []);
    const w = await store.forceSet(name, {
      schema: "psa-doc", schemaVersion: 1, doc: mod.doc.name, year: entry.originYear, rev: 0,
      updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner", records: merged,
    });
    if (w.error) return { error: w.error, message: w.message };
    const y = store.fiscalYearOf(entry);
    const yDoc = await store.loadDoc(ERP.MASTER.archive, { year: y });
    const remaining = ((yDoc.doc && yDoc.doc.records) || []).filter((e) => String(e.id) !== String(archiveId));
    if (remaining.length) await store.saveDoc(ERP.MASTER.archive, remaining);
    else await store.clearDoc(ERP.MASTER.archive, y);
    await ERP.master.audit({ action: "restore_archive", targetType: "doc", targetId: entry.originModule + ":" + entry.originYear, summary: "Restored " + (entry.records || []).length + " archived record(s) to " + entry.originLabel + " FY " + entry.originYear + "." });
    return { ok: true, restored: (entry.records || []).length };
  };

  /* ─────────────────────────── UI panel ─────────────────────────── */

  backup.renderPanel = async function (el) {
    const hostClass = el.className || "";
    const render = async () => {
      ui.loading(el, "Loading data utilities");
      el.className = hostClass;
      const cap = await backup.capacity();
      const archived = await backup.archivedDocs();
      const published = await backup.publishedBackup();
      const pct = (n) => Math.min(100, Math.round((n / cap.ceiling) * 1000) / 10);

      el.innerHTML =
        ui.pageHead("Data utilities", "Backup, restore, capacity and archival for every module document.", "") +
        '<div class="tabs erp-tabs" data-backup-tabs>' +
        '<button class="tab active" data-btab="backup">Backup &amp; restore</button>' +
        '<button class="tab" data-btab="capacity">Capacity &amp; archival</button>' +
        "</div>" +
        '<div data-backup-pane="backup" class="erp-tab-panel active"></div>' +
        '<div data-backup-pane="capacity" class="erp-tab-panel"></div>';

      const pane = (id) => el.querySelector('[data-backup-pane="' + id + '"]');

      /* backup pane */
      const lastPub = published
        ? "<p class=\"erp-alert tone-success\">Published backup: " + ui.dateTime(published.exportedAt) + " · " + Object.keys(published.docs || {}).length + " documents · " + store.fmtBytes(JSON.stringify(published).length) + "</p>"
        : '<p class="erp-alert">No published backup yet. Publish one so another device can restore from PSA-U\'s own namespace.</p>';
      pane("backup").innerHTML =
        ui.card("Full backup", lastPub +
          "<p class=\"erp-alert\">Download saves every module document to a JSON file on your device. Publish stores the same bundle in PSA-U's own storage namespace (re-publishing identical content is a safe no-op).</p>" +
          '<div class="erp-btn-row">' +
          ui.btn("Download backup", { primary: true, act: "download-backup" }) +
          ui.btn("Publish backup", { act: "publish-backup" }) +
          ui.btn("Restore published backup", { act: "restore-published" }) +
          ui.btn("Restore from file…", { act: "restore-file" }) +
          "</div>") +
        ui.card("Restore", '<p class="erp-alert tone-warn">Restore overwrites every matching document with the backup\'s contents. It is validated first — any malformed document is reported and skipped. This is the one action that intentionally overrides the normal conflict protection.</p><div class="erp-btn-row" data-restore-result></div>');

      /* capacity pane */
      const rows = cap.rows.map((r) => ({
        doc: r.label + (r.year ? " · FY " + r.year : ""),
        recs: ui.fmt(r.recordCount, 0),
        bytes: store.fmtBytes(r.bytes),
        bar: '<div class="erp-cap-bar"><span style="width:' + pct(r.bytes) + '%"></span></div><span class="erp-cap-pct">' + pct(r.bytes) + "%</span>",
      }));
      pane("capacity").innerHTML =
        ui.summary([
          { label: "Total stored", value: store.fmtBytes(cap.total) },
          { label: "Ceiling / doc", value: store.fmtBytes(cap.ceiling) },
          { label: "Archived periods", value: String(archived.length) },
        ]) +
        ui.card("Document sizes", ui.table([
          { key: "doc", label: "Document" },
          { key: "recs", label: "Records", align: "right" },
          { key: "bytes", label: "Size", align: "right" },
          { key: "bar", label: "vs ceiling" },
        ], rows, { emptyText: "No documents stored yet." })) +
        ui.card("Archival", backup.renderArchivePanel(archived), { actions: ui.btn("Archive a closed period…", { small: true, act: "archive-open" }) });

      /* bindings */
      ui.bind(el, "click", "[data-btab]", (t) => {
        el.querySelectorAll("[data-btab]").forEach((b) => b.classList.toggle("active", b === t));
        el.querySelectorAll("[data-backup-pane]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-backup-pane") === t.getAttribute("data-btab")));
      });
      ui.bind(el, "click", "[data-act]", async (t, e, act) => {
        if (act === "download-backup") {
          t.disabled = true;
          try { const b = await backup.downloadBackup(); ERP.toast("Backup downloaded — " + Object.keys(b.docs || {}).length + " documents.", "success"); }
          catch (err) { ERP.toast("Download failed: " + (err && err.message || err), "error"); }
          t.disabled = false;
        } else if (act === "publish-backup") {
          t.disabled = true; t.textContent = "Publishing…";
          try {
            const res = await backup.publishBackup();
            ERP.toast(res.noop ? "Backup already published (identical content)." : "Backup published to the PSA-U namespace.", "success");
            render();
          } catch (err) { ERP.toast("Publish failed: " + (err && err.message || err), "error"); }
        } else if (act === "restore-published") {
          const b = await backup.publishedBackup();
          if (!b) { ERP.toast("No published backup found.", "error"); return; }
          backup.restoreUi(el, b);
        } else if (act === "restore-file") {
          backup.fileInput().onchange = async (ev) => {
            const f = ev.target.files[0];
            if (!f) return;
            try { const b = JSON.parse(await f.text()); backup.restoreUi(el, b); }
            catch (err) { ERP.toast("Could not read that file: " + (err && err.message || err), "error"); }
          };
          backup.fileInput().click();
        } else if (act === "archive-open") {
          backup.archivePickerUi(el, render);
        } else if (act === "view-archive") {
          const entry = await backup.viewArchived(t.getAttribute("data-arg"));
          if (entry) backup.archiveViewUi(entry, render);
        } else if (act === "restore-archive") {
          if (await ui.confirm({ title: "Restore archived period?", message: "This moves " + (t.getAttribute("data-arg") === "" ? "" : "") + "the archived records back to the live document. The archive entry is removed." })) {
            const res = await backup.restoreArchive(t.getAttribute("data-arg"));
            ERP.toast(res.ok ? "Restored " + res.restored + " record(s)." : "Restore failed: " + (res.message || res.error), res.ok ? "success" : "error");
            render();
          }
        }
      });
    };
    render();
  };

  backup.renderArchivePanel = function (archived) {
    if (!archived.length) return '<p class="erp-alert">No archived periods. When a fiscal year is closed, archive its documents here to keep the live documents small. Archived records stay readable and can be restored at any time.</p>';
    return ui.table([
      { key: "label", label: "Archived period", render: (r) => "<b>" + ui.esc(r.originLabel) + "</b> · FY " + r.originYear },
      { key: "n", label: "Records", align: "right", render: (r) => ui.fmt(r.recordCount || (r.records || []).length, 0) },
      { key: "at", label: "Archived", render: (r) => ui.dateTime(r.archivedAt) },
      { key: "actions", label: "", render: (r) =>
        ui.btn("View", { small: true, act: "view-archive", arg: r.id }) + " " +
        ui.btn("Restore", { small: true, act: "restore-archive", arg: r.id }) },
    ], archived, { emptyText: "No archived periods." });
  };

  backup.restoreUi = function (el, bundle) {
    const v = backup.validateBundle(bundle);
    const names = Object.keys(v.docs);
    const errHtml = v.errors.length
      ? '<p class="erp-alert tone-warn">' + v.errors.map((e) => ui.esc(e.doc + ": " + e.error)).join("<br>") + "</p>"
      : "";
    const m = ui.modal({
      title: "Restore backup",
      body:
        '<p class="erp-modal-note">This backup contains <b>' + names.length + "</b> document(s) from <b>" + ui.esc(bundle.generator || "?") + "</b> exported " + ui.dateTime(bundle.exportedAt) + ".</p>" +
        errHtml +
        (names.length ? '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Document</th><th>Records</th></tr></thead><tbody>' +
          names.map((n) => "<tr><td>" + ui.esc(store.humanDocName(n)) + "</td><td>" + ui.fmt((v.docs[n].records || []).length, 0) + "</td></tr>").join("") +
          "</tbody></table></div>" : "") +
        '<p class="erp-alert tone-danger">Restore overwrites the current contents of these documents. This cannot be undone by the normal conflict flow.</p>',
      foot: ui.btn("Cancel", { small: true, act: "r-cancel" }) + " " + ui.btn("Restore " + names.length + " document(s)", { small: true, danger: true, act: "r-confirm" }),
    });
    m.querySelector("[data-act=r-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=r-confirm]").onclick = async (t) => {
      t.disabled = true; t.textContent = "Restoring…";
      const res = await backup.restoreBundle(bundle, { allowPartial: true });
      ui.closeModal();
      ERP.toast("Restore complete — " + res.written.length + " written" + (res.errors.length ? ", " + res.errors.length + " skipped" : "") + ".", res.errors.length ? "error" : "success");
      if (typeof el.__renderBackup === "function") el.__renderBackup();
    };
  };

  backup.archivePickerUi = function (el, rerender) {
    const candidates = [];
    (async () => {
      const mods = ["inventory", "finance"];
      const idx = (await store.getIndex()).index;
      for (const m of mods) {
        const mod = ERP.getModule(m);
        if (!mod || !mod.doc || !mod.doc.splitByYear) continue;
        for (const n of Object.keys(idx.documents || {})) {
          const e = idx.documents[n];
          if (e.name === mod.doc.name && e.year && e.year !== store.currentFiscalYear() && (e.recordCount || 0) > 0) {
            candidates.push({ module: m, year: e.year, count: e.recordCount, label: mod.label });
          }
        }
      }
      const opts = candidates.length ? candidates.map((c) => ({ value: c.module + ":" + c.year, label: c.label + " · FY " + c.year + " (" + c.count + " records)" })) : [];
      const body = candidates.length
        ? '<div class="field"><label>Document to archive</label><select data-archive-sel>' + opts.map((o) => '<option value="' + ui.esc(o.value) + '">' + ui.esc(o.label) + "</option>").join("") + "</select><div class=\"hint\">The records move to the read-only archive and the live document is emptied.</div></div>"
        : '<p class="erp-modal-note">No closed-period documents to archive yet. Inventory and Finance documents are split by fiscal year — archive the current year only after it is closed.</p>';
      const m = ui.modal({
        title: "Archive a closed period",
        body: body,
        foot: candidates.length ? ui.btn("Cancel", { small: true, act: "a-cancel" }) + " " + ui.btn("Archive", { small: true, danger: true, act: "a-go" }) : ui.btn("Close", { small: true, act: "a-cancel" }),
      });
      m.querySelector("[data-act=a-cancel]").onclick = () => ui.closeModal();
      const go = m.querySelector("[data-act=a-go]");
      if (go) go.onclick = async (t) => {
        const val = m.querySelector("[data-archive-sel]").value;
        const [mod, year] = val.split(":");
        t.disabled = true; t.textContent = "Archiving…";
        const res = await backup.archiveDoc(mod, Number(year));
        ui.closeModal();
        ERP.toast(res.ok ? "Archived " + res.archived + " record(s)." : "Archive failed: " + (res.message || res.error), res.ok ? "success" : "error");
        rerender();
      };
    })();
  };

  backup.archiveViewUi = function (entry, rerender) {
    const cols = Object.keys((entry.records && entry.records[0]) || {}).filter((k) => k !== "records");
    const table = entry.records && entry.records.length
      ? ui.table(cols.map((k) => ({ key: k, label: k, render: (r) => ui.esc(r[k] == null ? "" : r[k]) })), entry.records, { scroll: true, emptyText: "No records." })
      : '<p class="erp-modal-note">This archive entry is empty.</p>';
    ui.modal({
      title: "Archive · " + entry.originLabel + " FY " + entry.originYear,
      body: '<p class="erp-modal-note"><b>Read-only.</b> ' + (entry.recordCount || (entry.records || []).length) + " records archived " + ui.dateTime(entry.archivedAt) + ". Restore to return them to the live document.</p>" + table,
      foot: ui.btn("Close", { small: true, act: "v-close" }) + " " + ui.btn("Restore this archive", { small: true, act: "v-restore" }),
    });
    const m = document.querySelector("#uiModal");
    m.querySelector("[data-act=v-close]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=v-restore]").onclick = async () => {
      const res = await backup.restoreArchive(entry.id);
      ui.closeModal();
      ERP.toast(res.ok ? "Restored " + res.restored + " record(s)." : "Restore failed: " + (res.message || res.error), res.ok ? "success" : "error");
      rerender();
    };
  };

  let fileInputEl = null;
  backup.fileInput = function () {
    if (!fileInputEl) {
      fileInputEl = document.createElement("input");
      fileInputEl.type = "file";
      fileInputEl.accept = ".json,application/json";
      fileInputEl.style.display = "none";
      document.body.appendChild(fileInputEl);
    }
    return fileInputEl;
  };

  backup.render = async function (ctx) {
    await backup.renderPanel(ctx.el);
  };
})();
