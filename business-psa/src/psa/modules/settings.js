// src/psa/modules/settings.js — system & data management: sync + conflict
// resolution, backup & restore, storage capacity, archival, data-integrity
// checks, pipeline exchange, and (Phase 10) multi-user roles & the realtime
// hub.

import { registerModule, moduleShell, h, el, icon, tabs, toast, modal, confirmModal, moneyFmt, dateFmt, dateShort, numFmt, todayIso } from "../core.js";
import store, { refresh, flush, getSyncState, pendingConflicts, resolveConflict, getCollectionConfig, getDocInfo, getIndexInfo } from "../store.js";
import { downloadBackup, publishBackup, listBackups, validateBackup, restoreBackup, fetchPublishedBackup } from "../backup.js";
import { runChecksAndCache } from "../integrity.js";
import { discoverBundles, ingestOpportunities, convertOpportunityToSow, publishProjectState, publishInvoice, ingestReceipts, ingestPurchases, publishPurchases } from "../pipeline.js";
import { snapshot, byId, defaultCurrency } from "../derive.js";
import hub from "../hub.js";

const TABS = [
  { id: "sync", label: "Sync & conflicts", href: "settings" },
  { id: "backup", label: "Backup & restore", href: "settings/backup" },
  { id: "capacity", label: "Storage capacity", href: "settings/capacity" },
  { id: "archive", label: "Archive", href: "settings/archive" },
  { id: "integrity", label: "Data integrity", href: "settings/integrity" },
  { id: "pipeline", label: "Pipeline", href: "settings/pipeline" },
  { id: "users", label: "Users & realtime", href: "settings/users" },
];

function section(title, hint) {
  const wrap = el("div", "psa-settings-sec");
  wrap.appendChild(el("h3", "psa-settings-sec-title", h(title)));
  if (hint) wrap.appendChild(el("p", "dim", h(hint)));
  return wrap;
}

// ---- sync & conflicts ----

function renderSyncTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Sync & conflicts")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const syncBtn = el("button", "btn btn-primary btn-sm", "Sync now");
  toolbar.appendChild(syncBtn);
  sec.appendChild(toolbar);
  const host = el("div", "psa-sync");
  sec.appendChild(host);

  syncBtn.addEventListener("click", async (btn) => {
    btn.disabled = true;
    try {
      await refresh();
      const ok = await flush();
      toast(ok ? "Synced — all documents up to date" : "Some documents are waiting on the storage cooldown — will retry automatically", ok ? "ok" : "warn");
    } catch (e) {
      toast(e.message || "Sync failed", "err");
    }
    btn.disabled = false;
    render();
  });

  function render() {
    host.innerHTML = "";
    const conflicts = pendingConflicts();
    const conflictSec = section("Pending conflicts", "When the same document changed on two devices, nothing is overwritten — resolve it here first.");
    if (!conflicts.length) {
      const sc = el("div", "state-card state-empty");
      const inner = el("div", "state-card-inner");
      inner.appendChild(el("h3", "state-title", h("No sync conflicts")));
      inner.appendChild(el("p", "state-msg", h("All devices agree on the latest version of every document.")));
      sc.appendChild(inner);
      conflictSec.appendChild(sc);
    } else {
      for (const c of conflicts) {
        const item = el("div", "conflict-item psa-conflict-item");
        const label = el("div", "");
        label.innerHTML = "<strong>" + h(c.colId) + "</strong> · document <code>" + h(c.shardName.slice(0, 22) + "…") + "</code> · local rev " + c.localRev + " vs remote rev " + c.remoteRev + "<div class='cell-sub'>changed " + dateFmt(c.localUpdatedAt || c.createdAt) + " here · " + dateFmt(c.remoteUpdatedAt || c.createdAt) + " on the other device</div>";
        item.appendChild(label);
        const btns = el("div", "psa-conflict-btns");
        const mine = el("button", "btn btn-ghost btn-sm", "Keep mine");
        mine.addEventListener("click", async () => { await resolveConflict(c.id, "keep-mine", { resolvedBy: "local" }); toast("Your version pushed to cloud"); render(); });
        const theirs = el("button", "btn btn-ghost btn-sm", "Keep theirs");
        theirs.addEventListener("click", async () => { await resolveConflict(c.id, "keep-theirs", { resolvedBy: "local" }); toast("Cloud version adopted"); render(); });
        const merge = el("button", "btn btn-primary btn-sm", "Merge…");
        merge.addEventListener("click", () => mergeConflictModal(c, render));
        btns.appendChild(mine); btns.appendChild(theirs); btns.appendChild(merge);
        item.appendChild(btns);
        conflictSec.appendChild(item);
      }
    }
    host.appendChild(conflictSec);

    const stateSec = section("Document sync state", "Each shard is a versioned document; dirty means local changes not yet written to the cloud.");
    const st = getSyncState();
    stateSec.appendChild(el("p", "psa-mode-line", h("Storage mode: " + (st.mode === "cloud" ? "cloud (synced across devices)" : "local-only (save the generator to enable sync)") + " · index " + (st.indexDirty ? "dirty" : "synced"))));
    const wrap = el("div", "psa-table-wrap");
    wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Document</th><th>Collection</th><th class="num">Rev</th><th class="num">Bytes</th><th class="num">Records</th><th>Status</th></tr></thead><tbody>' +
      st.shards.map((s) => "<tr><td><code>" + h(s.name.slice(0, 20) + "…") + "</code></td><td>" + h(s.colId) + "</td><td class='num'>" + s.rev + "</td><td class='num'>" + numFmt(s.bytes / 1024, 1) + "KB</td><td class='num'>" + s.recordCount + "</td><td>" +
        (s.inConflict ? '<span class="badge badge-err">conflict</span>' : s.dirty ? '<span class="badge badge-warn">dirty</span>' : '<span class="badge badge-ok">synced</span>') +
        (s.error ? "<div class='cell-sub'>" + h(s.error.message) + "</div>" : "") +
        "</td></tr>").join("") +
      "</tbody></table>";
    stateSec.appendChild(wrap);
    host.appendChild(stateSec);
  }

  render();
}

function recordLabel(rec) {
  return rec.name || rec.title || rec.number || rec.id;
}

function mergeConflictModal(conflict, onDone) {
  const union = new Set([...Object.keys(conflict.localRecords), ...Object.keys(conflict.remoteRecords)]);
  const differing = [];
  for (const id of union) {
    const l = conflict.localRecords[id];
    const r = conflict.remoteRecords[id];
    if (l != null && r != null && JSON.stringify(l) === JSON.stringify(r)) continue;
    differing.push({ id, l, r });
  }
  if (!differing.length) {
    toast("No records actually differ — merge will keep both sides");
  }
  const form = el("div", "psa-form");
  const choices = {};
  for (const d of differing) {
    const row = el("div", "psa-merge-row");
    row.appendChild(el("label", "psa-field-label", h(recordLabel(d.l || d.r))));
    const sel = el("select", "psa-input", "");
    const o1 = el("option", "", h("Keep my version")); o1.value = "mine"; sel.appendChild(o1);
    const o2 = el("option", "", h("Keep their version")); o2.value = "theirs"; sel.appendChild(o2);
    sel.value = "mine";
    sel.addEventListener("change", () => { choices[d.id] = sel.value; });
    row.appendChild(sel);
    form.appendChild(row);
  }
  if (!differing.length) form.appendChild(el("p", "dim", h("No per-record choice needed.")));
  modal({
    title: "Merge conflict — per-record choices",
    body: form,
    wide: true,
    actions: [
      { label: "Cancel" },
      { label: "Apply merge", kind: "btn-primary", onClick: async (btn) => {
          btn.disabled = true;
          try {
            await resolveConflict(conflict.id, "merge", { resolvedBy: "local", perRecord: choices });
            toast("Merge applied and pushed to cloud");
            btn.closest(".psa-modal-overlay").remove();
            onDone();
          } catch (e) { toast(e.message || "Merge failed", "err"); btn.disabled = false; }
        } }
    ]
  });
}

// ---- backup & restore ----

async function renderBackupTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Backup & restore")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const dlBtn = el("button", "btn btn-primary btn-sm", "Download backup");
  const pubBtn = el("button", "btn btn-ghost btn-sm", "Publish backup");
  const fileBtn = el("button", "btn btn-ghost btn-sm", "Restore from file…");
  const fileInput = el("input", "", "");
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.hidden = true;
  toolbar.appendChild(dlBtn); toolbar.appendChild(pubBtn); toolbar.appendChild(fileBtn); toolbar.appendChild(fileInput);
  sec.appendChild(toolbar);
  const host = el("div", "psa-backup");
  sec.appendChild(host);

  dlBtn.addEventListener("click", async () => {
    const auth = await hub.requireAction("backup.download", "downloaded full backup");
    if (!auth.ok) return;
    try { await downloadBackup(); hub.recordAudit("backup.download", "downloaded full backup", auth.actor).catch(() => {}); toast("Backup downloaded"); }
    catch (e) { toast(e.message || "Backup failed", "err"); }
  });
  pubBtn.addEventListener("click", async (btn) => {
    btn.disabled = true;
    const auth = await hub.requireAction("backup.publish", "published backup");
    if (!auth.ok) { btn.disabled = false; return; }
    try { const m = await publishBackup(); hub.recordAudit("backup.publish", "published backup " + m.name.slice(0, 20), auth.actor).catch(() => {}); toast("Backup published — " + m.name.slice(0, 20) + "…"); }
    catch (e) { toast(e.message || "Publish failed", "err"); }
    btn.disabled = false;
    render();
  });
  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result);
      const v = validateBackup(text);
      if (!v.ok) {
        modal({ title: "Backup is invalid", body: el("div", "psa-form", v.errors.map((e) => "<p class='err-line'>" + h(e) + "</p>").join("")), actions: [{ label: "OK" }] });
        return;
      }
      const counts = Object.entries(v.summary.counts).filter(([, n]) => n > 0).map(([k, n]) => k + ": " + n).join(" · ") || "empty";
      confirmModal({
        title: "Restore this backup?",
        message: "This will replace live data with the backup's records across all collections (idempotent — re-restoring is safe). Created " + dateFmt(v.summary.createdAt) + ". " + counts,
        confirmLabel: "Restore",
        danger: true,
        onConfirm: async () => {
          const auth = await hub.requireAction("backup.restore", "restoring backup from " + dateFmt(v.summary.createdAt));
          if (!auth.ok) return;
          try {
            const res = await restoreBackup(text);
            hub.recordAudit("backup.restore", "restored backup from " + dateFmt(v.summary.createdAt), auth.actor).catch(() => {});
            if (res.ok) toast("Restore complete — " + Object.values(res.results).filter((r) => !r.unchanged).length + " collection(s) updated");
            else toast("Restore had errors — check the console", "err");
          } catch (e) { toast(e.message || "Restore failed", "err"); }
        }
      });
    };
    reader.readAsText(f);
    fileInput.value = "";
  });

  async function render() {
    host.innerHTML = "";
    const secWrap = section("Backup history", "Published backups live as documents in this generator's namespace and are listed here with their edit keys cached locally.");
    const list = await listBackups();
    if (!list.length) {
      secWrap.appendChild(el("p", "dim", h("No published backups yet. Publish one to keep a cloud copy you can restore from anywhere.")));
    } else {
      const wrap = el("div", "psa-table-wrap");
      wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Published</th><th>Records</th><th>Document</th><th></th></tr></thead><tbody>' +
        list.map((b, i) => {
          const counts = Object.entries(b.counts || {}).filter(([, n]) => n > 0).map(([k, n]) => k + ":" + n).join(" ") || "empty";
          return "<tr><td>" + dateFmt(b.at) + "</td><td>" + h(counts) + "</td><td><code>" + h((b.name || "").slice(0, 24) + "…") + "</code></td><td><button class='btn btn-ghost btn-sm' data-restore='" + i + "'>Restore</button></td></tr>";
        }).join("") + "</tbody></table>";
      secWrap.appendChild(wrap);
      secWrap.querySelectorAll("[data-restore]").forEach((btn) => btn.addEventListener("click", async () => {
        const b = list[Number(btn.dataset.restore)];
        confirmModal({
          title: "Restore backup from " + dateFmt(b.at) + "?",
          message: "This replaces live data with the published backup's records (idempotent).",
          confirmLabel: "Restore", danger: true,
          onConfirm: async () => {
            const auth = await hub.requireAction("backup.restore", "restoring published backup from " + dateFmt(b.at));
            if (!auth.ok) return;
            try {
              const data = await fetchPublishedBackup(b.name);
              const res = await restoreBackup(data);
              hub.recordAudit("backup.restore", "restored published backup from " + dateFmt(b.at), auth.actor).catch(() => {});
              toast(res.ok ? "Restored from published backup" : "Restore had errors", res.ok ? "ok" : "err");
            } catch (e) { toast(e.message || "Restore failed", "err"); }
          }
        });
      }));
    }
    host.appendChild(secWrap);
  }
  await render();
}

// ---- storage capacity ----

function renderCapacityTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Storage capacity")));
  sec.appendChild(head);
  const host = el("div", "psa-capacity");
  sec.appendChild(host);
  function render() {
    host.innerHTML = "";
    const cfg = getCollectionConfig();
    const idx = getIndexInfo();
    const secWrap = section("Documents vs the storage ceiling", "Each collection is stored in one or more versioned documents; a document auto-splits when it grows past the ceiling. Oversized single records are refused with a clear message.");
    const wrap = el("div", "psa-table-wrap");
    wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Collection</th><th class="num">Records</th><th class="num">Docs</th><th>Size / ceiling</th><th class="num">Used</th></tr></thead><tbody>' +
      Object.keys(cfg).sort().map((id) => {
        const info = getDocInfo(id);
        const max = cfg[id].maxDocBytes;
        const used = info.totalBytes / max;
        const pct = Math.round(used * 100);
        return "<tr><td>" + h(id) + "</td><td class='num'>" + info.recordCount + "</td><td class='num'>" + info.shards.length + "</td><td><div class='util-bar'><div class='util-bar-fill " + (used > 0.8 ? "fill-err" : used > 0.5 ? "fill-warn" : "") + "' style='width:" + Math.min(100, pct) + "%'></div></div></td><td class='num'>" + numFmt(info.totalBytes / 1024, 1) + "KB / " + numFmt(max / 1024, 0) + "KB (" + pct + "%)</td></tr>";
      }).join("") + "</tbody></table>";
    secWrap.appendChild(wrap);
    secWrap.appendChild(el("p", "psa-mode-line", h(idx.mode === "cloud" ? "Cloud storage — " + idx.shardCount + " document(s) across " + idx.collections + " collections" : "Local-only — save the generator to enable cloud storage")));
    host.appendChild(secWrap);
  }
  render();
}

// ---- archive ----

async function archiveRecords(records, reason) {
  const groupId = "arc-" + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();
  for (const r of records) {
    const arc = { id: "arc-" + Math.random().toString(36).slice(2, 12), kind: "archived-record", originalCollection: r.col, originalRecord: r.rec, archivedAt: now, reason, groupId };
    await store.saveRecord("archive", arc);
    await store.removeRecord(r.col, r.rec.id);
  }
}

async function restoreArchived(arc) {
  await store.saveRecord(arc.originalCollection, arc.originalRecord);
  await store.removeRecord("archive", arc.id);
}

async function renderArchiveTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Archive")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const archClosedBtn = el("button", "btn btn-primary btn-sm", "Archive closed projects");
  toolbar.appendChild(archClosedBtn);
  toolbar.appendChild(el("span", "psa-filter-label", "Archive past period before:"));
  const dateInp = el("input", "psa-input psa-input-sm", "");
  dateInp.type = "date";
  toolbar.appendChild(dateInp);
  const archPeriodBtn = el("button", "btn btn-ghost btn-sm", "Archive past period");
  toolbar.appendChild(archPeriodBtn);
  sec.appendChild(toolbar);
  const host = el("div", "psa-archive");
  sec.appendChild(host);

  archClosedBtn.addEventListener("click", () => {
    const closed = store.getAllRecords("projects").filter((p) => p.status === "closed");
    const archivedIds = new Set(store.getAllRecords("archive").map((a) => a.originalCollection + ":" + a.originalRecord.id));
    const pending = closed.filter((p) => !archivedIds.has("projects:" + p.id));
    if (!pending.length) { toast("No unarchived closed projects"); return; }
    const withChildren = [];
    for (const p of pending) {
      withChildren.push({ col: "projects", rec: p });
      for (const w of store.getAllRecords("workplans").filter((t) => t.projectId === p.id)) withChildren.push({ col: "workplans", rec: w });
      for (const a of store.getAllRecords("allocations").filter((a) => a.projectId === p.id)) withChildren.push({ col: "allocations", rec: a });
      for (const t of store.getAllRecords("timesheets").filter((t) => t.projectId === p.id)) withChildren.push({ col: "timesheets", rec: t });
      for (const e of store.getAllRecords("expenses").filter((e) => e.projectId === p.id)) withChildren.push({ col: "expenses", rec: e });
    }
    confirmModal({
      title: "Archive " + pending.length + " closed project(s)?",
      message: "Moves the projects and their work plans, allocations, timesheets and expenses into the read-only archive (" + withChildren.length + " records total). Restorable on demand.",
      confirmLabel: "Archive", danger: true,
      onConfirm: async () => { const auth = await hub.requireAction("archive.manage", "archived " + pending.length + " closed project(s)"); if (!auth.ok) return; await archiveRecords(withChildren, "Closed project archived"); hub.recordAudit("archive.manage", "archived " + pending.length + " closed project(s)", auth.actor).catch(() => {}); toast("Archived " + pending.length + " closed project(s)"); render(); }
    });
  });

  archPeriodBtn.addEventListener("click", () => {
    const cutoff = dateInp.value;
    if (!cutoff) { toast("Choose a date first", "err"); return; }
    const ts = store.getAllRecords("timesheets").filter((t) => t.date < cutoff);
    const ex = store.getAllRecords("expenses").filter((e) => e.date < cutoff);
    const recs = [...ts.map((t) => ({ col: "timesheets", rec: t })), ...ex.map((e) => ({ col: "expenses", rec: e }))];
    if (!recs.length) { toast("Nothing before " + dateFmt(cutoff)); return; }
    confirmModal({
      title: "Archive " + recs.length + " record(s) before " + dateFmt(cutoff) + "?",
      message: "Moves them into the archive and out of live actuals (historical periods only — restorable on demand).",
      confirmLabel: "Archive", danger: true,
      onConfirm: async () => { const auth = await hub.requireAction("archive.manage", "archived " + recs.length + " record(s) before " + dateFmt(cutoff)); if (!auth.ok) return; await archiveRecords(recs, "Past period archived (" + dateFmt(cutoff) + ")"); hub.recordAudit("archive.manage", "archived " + recs.length + " record(s) before " + dateFmt(cutoff), auth.actor).catch(() => {}); toast("Archived " + recs.length + " record(s)"); render(); }
    });
  });

  function render() {
    host.innerHTML = "";
    const archived = store.getAllRecords("archive").sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));
    const secWrap = section("Archived records", "Read-only archive — restored records go back to their original collection.");
    if (!archived.length) {
      secWrap.appendChild(el("p", "dim", h("Nothing archived yet. Archive closed projects or past periods to keep live documents small.")));
    } else {
      const wrap = el("div", "psa-table-wrap");
      wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Record</th><th>From</th><th>Archived</th><th>Reason</th><th></th></tr></thead><tbody>' +
        archived.map((a, i) => "<tr><td><strong>" + h(recordLabel(a.originalRecord)) + "</strong></td><td>" + h(a.originalCollection) + "</td><td>" + dateFmt(a.archivedAt) + "</td><td>" + h(a.reason || "—") + "</td><td><button class='btn btn-ghost btn-sm' data-restore='" + i + "'>Restore</button></td></tr>").join("") +
        "</tbody></table>";
      secWrap.appendChild(wrap);
      secWrap.querySelectorAll("[data-restore]").forEach((btn) => btn.addEventListener("click", async () => {
        const a = archived[Number(btn.dataset.restore)];
        confirmModal({
          title: "Restore " + h(recordLabel(a.originalRecord)) + "?",
          message: "Moves it back to " + a.originalCollection + " and removes it from the archive.",
          confirmLabel: "Restore",
          onConfirm: async () => { const auth = await hub.requireAction("archive.manage", "restored " + recordLabel(a.originalRecord) + " from archive"); if (!auth.ok) return; await restoreArchived(a); hub.recordAudit("archive.manage", "restored " + recordLabel(a.originalRecord) + " from archive", auth.actor).catch(() => {}); toast("Restored"); render(); }
        });
      }));
    }
    host.appendChild(secWrap);
  }
  render();
}

// ---- integrity ----

function renderIntegrityTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Data integrity")));
  sec.appendChild(head);
  const toolbar = el("div", "psa-crud-toolbar");
  const runBtn = el("button", "btn btn-primary btn-sm", "Run checks now");
  toolbar.appendChild(runBtn);
  toolbar.appendChild(el("span", "psa-filter-label", "Checks also re-run automatically after every write."));
  sec.appendChild(toolbar);
  const host = el("div", "psa-integrity");
  sec.appendChild(host);

  runBtn.addEventListener("click", async () => { await runChecksAndCache(); render(); });

  function render() {
    host.innerHTML = "";
    const data = window.__psaHealth || null;
    if (!data) { host.appendChild(el("p", "dim", h("No checks run yet — run them now."))); return; }
    const s = data.summary;
    const sc = el("div", "state-card state-" + (s.ok ? "empty" : "error"));
    const inner = el("div", "state-card-inner");
    inner.appendChild(el("h3", "state-title", h(s.ok ? (s.errors === 0 && s.warnings === 0 ? "All clear" : "No errors — " + s.warnings + " warning(s)") : s.errors + " error(s) found")));
    inner.appendChild(el("p", "state-msg", h("Checked " + dateFmt(s.checkedAt) + " — " + s.total + " issue(s) total")));
    sc.appendChild(inner);
    host.appendChild(sc);
    const bySev = { err: [], warn: [] };
    for (const i of data.issues) bySev[i.severity === "err" ? "err" : "warn"].push(i);
    for (const sev of ["err", "warn"]) {
      const list = bySev[sev];
      if (!list.length) continue;
      const secWrap = section(sev === "err" ? "Errors" : "Warnings", "");
      for (const i of list) {
        const item = el("div", "conflict-item");
        item.innerHTML = '<span class="badge badge-' + (sev === "err" ? "err" : "warn") + '">' + h(i.module) + "</span> " + h(i.message) + (i.refs && i.refs.length ? "<div class='cell-sub'>refs: " + h(i.refs.join(", ")) + "</div>" : "");
        secWrap.appendChild(item);
      }
      host.appendChild(secWrap);
    }
  }
  render();
}

// ---- pipeline ----

async function renderPipelineTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Pipeline — small-business bus")));
  sec.appendChild(head);
  const host = el("div", "psa-pipeline");
  sec.appendChild(host);

  function btnRow() {
    const row = el("div", "psa-page-actions");
    const discover = el("button", "btn btn-ghost btn-sm", "Discover bundles");
    const ingestOpp = el("button", "btn btn-ghost btn-sm", "Ingest opportunities");
    const ingestRec = el("button", "btn btn-ghost btn-sm", "Ingest receipts");
    const ingestPur = el("button", "btn btn-ghost btn-sm", "Ingest purchases");
    row.appendChild(discover); row.appendChild(ingestOpp); row.appendChild(ingestRec); row.appendChild(ingestPur);
    discover.addEventListener("click", async () => { try { await refreshBundles(); } catch (e) { toast(e.message || "Discover failed", "err"); } });
    ingestOpp.addEventListener("click", async () => { const auth = await hub.requireAction("pipeline.publish", "ingested opportunities"); if (!auth.ok) return; try { const c = await ingestOpportunities(); hub.recordAudit("pipeline.publish", "ingested " + c.length + " opportunity(ies)", auth.actor).catch(() => {}); toast("Ingested " + c.length + " opportunity(ies)"); render(); } catch (e) { toast(e.message || "Ingest failed", "err"); } });
    ingestRec.addEventListener("click", async () => { const auth = await hub.requireAction("pipeline.publish", "ingested receipts"); if (!auth.ok) return; try { const c = await ingestReceipts(); hub.recordAudit("pipeline.publish", "ingested " + c.length + " receipt(s)", auth.actor).catch(() => {}); toast("Applied " + c.length + " receipt(s)"); render(); } catch (e) { toast(e.message || "Ingest failed", "err"); } });
    ingestPur.addEventListener("click", async () => { const auth = await hub.requireAction("pipeline.publish", "ingested purchases"); if (!auth.ok) return; try { const c = await ingestPurchases(); hub.recordAudit("pipeline.publish", "ingested " + c.length + " purchase(s)", auth.actor).catch(() => {}); toast("Imported " + c.length + " purchase(s)"); render(); } catch (e) { toast(e.message || "Ingest failed", "err"); } });
    return row;
  }

  async function refreshBundles() {
    const dis = await discoverBundles();
    window.__psaDiscovered = dis;
    render();
  }

  function render() {
    host.innerHTML = "";
    host.appendChild(btnRow());

    const opps = store.getAllRecords("opportunities");
    if (opps.length) {
      const secWrap = section("Opportunities", "Ideas and won deals from the pipeline, ready to become SOWs and projects.");
      const wrap = el("div", "psa-table-wrap");
      wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Opportunity</th><th>Source</th><th class="num">Value</th><th>Status</th><th></th></tr></thead><tbody>' +
        opps.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map((o, i) => "<tr><td><strong>" + h(o.title) + "</strong></td><td>" + h(o.source || "—") + "</td><td class='num'>" + moneyFmt(o.value, defaultCurrency()) + "</td><td><span class='badge badge-" + (o.status === "converted" ? "ok" : "warn") + "'>" + h(o.status) + "</span></td><td>" + (o.status === "converted" ? "" : "<button class='btn btn-primary btn-sm' data-convert='" + i + "'>Convert to SOW</button>") + "</td></tr>").join("") +
        "</tbody></table>";
      secWrap.appendChild(wrap);
      secWrap.querySelectorAll("[data-convert]").forEach((btn) => btn.addEventListener("click", async () => {
        const o = opps[Number(btn.dataset.convert)];
        try {
          const auth = await hub.requireAction("pipeline.publish", "converted opportunity " + o.title + " to SOW");
          if (!auth.ok) return;
          const sow = await convertOpportunityToSow(o.id);
          hub.recordAudit("pipeline.publish", "converted opportunity " + o.title + " to SOW", auth.actor).catch(() => {});
          toast("SOW created — " + sow.name); render();
        }
        catch (e) { toast(e.message || "Conversion failed", "err"); }
      }));
      host.appendChild(secWrap);
    }

    const dis = window.__psaDiscovered;
    if (dis) {
      const ext = dis.external || [];
      if (ext.length) {
        const secWrap = section("External bundles found", "Published by other pipeline participants (idea-incubator, CRM, project-master, the-ledger, ERP).");
        const wrap = el("div", "psa-table-wrap");
        wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Kind</th><th>Generator</th><th class="num">Items</th><th>Summary</th><th>Published</th></tr></thead><tbody>' +
          ext.map((b) => "<tr><td>" + h(b.kind) + "</td><td>" + h(b.generator) + "</td><td class='num'>" + (b.count != null ? b.count : "—") + "</td><td>" + h(b.summary || "") + "</td><td>" + dateFmt(b.publishedAt) + "</td></tr>").join("") +
          "</tbody></table>";
        secWrap.appendChild(wrap);
        host.appendChild(secWrap);
      }
    }

    const local = store.getAllRecords("pipeline");
    const secWrap2 = section("Bundles published by this PSA", "Invoices, project states and purchases exported to the bus for other tools to consume.");
    if (!local.length) {
      secWrap2.appendChild(el("p", "dim", h("Nothing published yet. Publish an invoice from billing, a project state from Projects, or purchases from Expenses.")));
    } else {
      const wrap = el("div", "psa-table-wrap");
      wrap.innerHTML = '<table class="psa-table"><thead><tr><th>Kind</th><th>Document</th><th class="num">Items</th><th>Published</th></tr></thead><tbody>' +
        local.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "")).map((b) => "<tr><td>" + h(b.kind) + "</td><td><code>" + h((b.name || "").slice(0, 24) + "…") + "</code></td><td class='num'>" + (b.count != null ? b.count : "—") + "</td><td>" + dateFmt(b.publishedAt) + "</td></tr>").join("") +
        "</tbody></table>";
      secWrap2.appendChild(wrap);
    }
    host.appendChild(secWrap2);

    const pubSec = section("Publish", "Export live PSA data as bundles.");
    const projectSel = el("select", "psa-input", "");
    const invoiceSel = el("select", "psa-input", "");
    const expenseSel = el("select", "psa-input", "");
    const fill = (sel, list, labelFn) => {
      sel.appendChild(el("option", "", h("Select…")));
      for (const x of list) { const o = el("option", "", h(labelFn(x))); o.value = x.id; sel.appendChild(o); }
    };
    fill(projectSel, store.getAllRecords("projects").filter((p) => p.status !== "closed"), (p) => p.name);
    fill(invoiceSel, store.getAllRecords("billing").filter((b) => b.kind === "invoice" && b.status !== "void"), (b) => (b.number || b.id) + " — " + moneyFmt(b.total, b.currency));
    fill(expenseSel, store.getAllRecords("expenses").filter((e) => e.status !== "rejected" && e.status !== "draft" && !e.locked), (e) => (store.getRecord("projects", e.projectId) || {}).name + " — " + moneyFmt(e.amount, e.currency || "USD"));
    const pubProject = el("button", "btn btn-primary btn-sm", "Publish project state");
    const pubInvoice = el("button", "btn btn-primary btn-sm", "Publish invoice");
    const pubPurchases = el("button", "btn btn-primary btn-sm", "Publish purchases");
    pubProject.addEventListener("click", async () => { if (!projectSel.value) { toast("Choose a project", "err"); return; } const auth = await hub.requireAction("pipeline.publish", "published project state"); if (!auth.ok) return; try { const m = await publishProjectState(projectSel.value); hub.recordAudit("pipeline.publish", "published project state for " + (store.getRecord("projects", projectSel.value) || {}).name, auth.actor).catch(() => {}); toast("Published — " + m.name.slice(0, 18) + "…"); render(); } catch (e) { toast(e.message || "Publish failed", "err"); } });
    pubInvoice.addEventListener("click", async () => { if (!invoiceSel.value) { toast("Choose an invoice", "err"); return; } const auth = await hub.requireAction("pipeline.publish", "published invoice"); if (!auth.ok) return; try { const m = await publishInvoice(invoiceSel.value); hub.recordAudit("pipeline.publish", "published invoice " + (store.getRecord("billing", invoiceSel.value) || {}).number, auth.actor).catch(() => {}); toast("Published — " + m.name.slice(0, 18) + "…"); render(); } catch (e) { toast(e.message || "Publish failed", "err"); } });
    pubPurchases.addEventListener("click", async () => { if (!expenseSel.value) { toast("Choose an expense", "err"); return; } const auth = await hub.requireAction("pipeline.publish", "published purchases"); if (!auth.ok) return; try { const m = await publishPurchases([expenseSel.value]); hub.recordAudit("pipeline.publish", "published purchases for " + (store.getRecord("projects", (store.getRecord("expenses", expenseSel.value) || {}).projectId) || {}).name, auth.actor).catch(() => {}); toast("Published — " + m.name.slice(0, 18) + "…"); render(); } catch (e) { toast(e.message || "Publish failed", "err"); } });
    pubSec.appendChild(el("div", "psa-publish-row", ""));
    pubSec.lastChild.appendChild(el("label", "psa-field-label", "Project state")); pubSec.lastChild.appendChild(projectSel); pubSec.lastChild.appendChild(pubProject);
    pubSec.appendChild(el("div", "psa-publish-row", ""));
    pubSec.lastChild.appendChild(el("label", "psa-field-label", "Invoice")); pubSec.lastChild.appendChild(invoiceSel); pubSec.lastChild.appendChild(pubInvoice);
    pubSec.appendChild(el("div", "psa-publish-row", ""));
    pubSec.lastChild.appendChild(el("label", "psa-field-label", "Purchases")); pubSec.lastChild.appendChild(expenseSel); pubSec.lastChild.appendChild(pubPurchases);
    host.appendChild(pubSec);
  }

  try {
    const dis = await discoverBundles();
    window.__psaDiscovered = dis;
  } catch (e) {}
  render();
}

// ---- users & realtime (Phase 10) ----

function timeAgo(ts) {
  if (!ts) return "—";
  const t = typeof ts === "number" ? ts * 1000 : new Date(ts).getTime();
  if (!isFinite(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const hh = Math.floor(m / 60);
  if (hh < 24) return hh + "h ago";
  return Math.floor(hh / 24) + "d ago";
}

function labelForCol(col) {
  const map = { clients: "a client", projects: "a project", resources: "a resource", timesheets: "a timesheet", expenses: "an expense", billing: "an invoice", workplans: "a work plan", sows: "an SOW", ratecards: "a rate card", catalog: "the catalog", allocations: "an allocation", opportunities: "an opportunity", pipeline: "the pipeline", templates: "a template", scopechanges: "a scope change", reports: "a report" };
  return map[col] || "a record";
}

const STATUS_META = {
  idle: ["Idle", "muted"],
  connecting: ["Connecting…", "warn"],
  connected: ["Connected", "ok"],
  reconnecting: ["Reconnecting…", "warn"],
  blocked: ["Blocked", "err"],
};

function statusBadgeHtml(status) {
  const meta = STATUS_META[status] || ["Unknown", "muted"];
  return '<span class="badge badge-' + meta[1] + '">' + h(meta[0]) + "</span>";
}

function renderUsersTab(sec) {
  const head = el("div", "psa-page-head");
  head.appendChild(el("h1", "psa-page-title", h("Users & realtime")));
  sec.appendChild(head);
  const host = el("div", "psa-users");
  sec.appendChild(host);

  // ---- identity card (static form; re-render only the status line) ----
  const idCard = el("div", "psa-settings-sec");
  idCard.appendChild(el("h3", "psa-settings-sec-title", h("Your identity")));
  idCard.appendChild(el("p", "dim", h("Connect as yourself so other open sessions see your changes live, and so the hub can enforce your role. Offline (single-user) every action is allowed — roles only apply once you join the hub.")));
  const idRow = el("div", "psa-publish-row");
  const nameInput = el("input", "psa-input", "");
  nameInput.placeholder = "Your name";
  nameInput.maxLength = 32;
  const saved = hub.getState().me ? hub.getState().me.name : "";
  nameInput.value = saved || "";
  const connectBtn = el("button", "btn btn-primary btn-sm", "Connect");
  const statusLine = el("p", "psa-mode-line", "");
  statusLine.style.marginTop = "10px";
  idRow.appendChild(nameInput);
  idRow.appendChild(connectBtn);
  idCard.appendChild(idRow);
  idCard.appendChild(statusLine);
  host.appendChild(idCard);

  function refreshStatusLine() {
    const st = hub.getState();
    let txt = "Connection: " + STATUS_META[st.status]?.[0] + " · " + (st.mode === "emulator" ? "local emulator" : st.mode === "live" ? "live hub" : "not joined");
    if (st.me && st.me.role) txt += " · you are <strong>" + h(st.me.role) + "</strong>";
    if (st.online && st.online.length) txt += " · " + st.online.length + " online";
    statusLine.innerHTML = txt;
    connectBtn.textContent = st.status === "connected" ? "Disconnect" : "Connect";
    if (st.lastError) statusLine.innerHTML += '<div class="cell-sub err-line">' + h(st.lastError) + "</div>";
  }

  connectBtn.addEventListener("click", async () => {
    const st = hub.getState();
    if (st.status === "connected" || st.status === "connecting") {
      hub.disconnect();
      return;
    }
    const name = nameInput.value.trim();
    if (!name) { toast("Enter a name first", "err"); return; }
    await hub.connect(name);
    refreshStatusLine();
  });

  // ---- admin card (claim admin with the workspace password) ----
  const adminCard = el("div", "psa-settings-sec");
  adminCard.appendChild(el("h3", "psa-settings-sec-title", h("Admin")));
  adminCard.appendChild(el("p", "dim", h("Claim the admin role to manage roles, rate cards and project closures. The password was set by the workspace owner and is never stored anywhere in the app.")));
  const adminRow = el("div", "psa-publish-row");
  const passInput = el("input", "psa-input", "");
  passInput.type = "password";
  passInput.placeholder = "Admin password";
  const claimBtn = el("button", "btn btn-ghost btn-sm", "Claim admin");
  const adminHint = el("p", "psa-mode-line", h("Not an admin yet."));
  adminRow.appendChild(passInput);
  adminRow.appendChild(claimBtn);
  adminCard.appendChild(adminRow);
  adminCard.appendChild(adminHint);
  host.appendChild(adminCard);

  claimBtn.addEventListener("click", async () => {
    const proof = passInput.value.trim();
    if (!proof) { toast("Enter the admin password", "err"); return; }
    const r = await hub.claimAdmin(proof);
    if (r.ok) { toast("You are now admin"); passInput.value = ""; refreshStatusLine(); renderRoster(); renderAudit(); }
    else toast(r.reason || "Not allowed", "err");
  });

  // ---- dynamic sections ----
  const rosterCard = el("div", "psa-settings-sec");
  rosterCard.appendChild(el("h3", "psa-settings-sec-title", h("Roster")));
  const rosterHost = el("div", "psa-table-wrap");
  rosterCard.appendChild(rosterHost);
  host.appendChild(rosterCard);

  const feedCard = el("div", "psa-settings-sec");
  feedCard.appendChild(el("h3", "psa-settings-sec-title", h("Live changes")));
  const feedHost = el("div", "psa-feed");
  feedCard.appendChild(feedHost);
  host.appendChild(feedCard);

  const auditCard = el("div", "psa-settings-sec");
  auditCard.appendChild(el("h3", "psa-settings-sec-title", h("Audit log")));
  const auditHost = el("div", "psa-feed");
  auditCard.appendChild(auditHost);
  host.appendChild(auditCard);

  const infoCard = el("div", "psa-settings-sec");
  infoCard.appendChild(el("h3", "psa-settings-sec-title", h("Roles & permissions")));
  infoCard.appendChild(el("p", "dim", h("Consultants log time and expenses. Managers additionally approve timesheets, approve SOWs, create invoices / record payments / issue credit notes, publish to the pipeline and download backups. Admins additionally edit rate cards, close projects, restore backups and manage roles. When you're connected every action is checked by the hub server itself — hiding buttons is just a courtesy, the server is the authority.")));
  host.appendChild(infoCard);

  function renderRoster() {
    const st = hub.getState();
    if (st.status !== "connected") {
      rosterHost.innerHTML = '<p class="dim">Connect to see who is in the workspace.</p>';
      return;
    }
    const meName = st.me ? st.me.name : "";
    const amAdmin = st.me && st.me.role === "admin";
    const rows = st.roster.map((r) => {
      const online = st.online.includes(r.name);
      const isMe = r.name === meName;
      const roleSel = amAdmin ? '<select data-setrole="' + h(r.name) + '" class="psa-input psa-input-sm" aria-label="Set role for ' + h(r.name) + '"><option value="consultant"' + (r.role === "consultant" ? " selected" : "") + ">consultant</option><option value=\"manager\"" + (r.role === "manager" ? " selected" : "") + ">manager</option><option value=\"admin\"" + (r.role === "admin" ? " selected" : "") + ">admin</option></select>" : '<span class="badge badge-' + (r.role === "admin" ? "err" : r.role === "manager" ? "warn" : "muted") + '">' + h(r.role) + "</span>";
      return "<tr><td><strong>" + h(r.name) + "</strong>" + (isMe ? ' <span class="badge badge-ok">you</span>' : "") + "</td><td>" + roleSel + "</td><td>" + (online ? '<span class="badge badge-ok">online</span>' : '<span class="badge badge-muted">offline</span>') + "</td><td>" + timeAgo(r.lastSeen) + "</td></tr>";
    }).join("");
    rosterHost.innerHTML = rows ? '<table class="psa-table psa-roster"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last seen</th></tr></thead><tbody>' + rows + "</tbody></table>" : '<p class="dim">No one in the roster yet.</p>';
    rosterHost.querySelectorAll("[data-setrole]").forEach((sel) => sel.addEventListener("change", async () => {
      const r = await hub.setRole(sel.dataset.setrole, sel.value);
      if (r.ok) { toast(sel.dataset.setrole + " is now " + sel.value); renderAudit(); }
      else toast(r.reason || "Could not change role", "err");
    }));
  }

  function renderFeed() {
    const evs = hub.getState().recentEvents;
    feedHost.innerHTML = "";
    if (!evs.length) {
      feedHost.appendChild(el("p", "dim", h("No change events yet. When another session edits a record you'll see it here and the list refreshes automatically.")));
      return;
    }
    for (const e of evs.slice(0, 25)) {
      const item = el("div", "psa-feed-item" + (e.self ? " psa-feed-self" : ""));
      item.innerHTML = "<strong>" + h(e.actor || "?") + "</strong> " + (e.op === "delete" ? "deleted" : "updated") + " " + h(labelForCol(e.col)) + " <span class='dim'>" + h(String(e.id || "").slice(0, 20)) + "</span> · " + timeAgo(e.at) + (e.self ? ' <span class="badge badge-muted">you</span>' : "");
      feedHost.appendChild(item);
    }
  }

  function renderAudit() {
    const st = hub.getState();
    const local = store.getAllRecords("audit").sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const merged = [];
    for (const e of st.audit) {
      merged.push({ action: e.action, actor: e.actor, role: e.role, detail: e.detail, ts: e.ts * 1000, source: "hub" });
    }
    for (const e of local) {
      merged.push({ action: e.action, actor: e.actor, role: e.role, detail: e.detail, ts: new Date(e.at).getTime(), source: "local" });
    }
    merged.sort((a, b) => b.ts - a.ts);
    auditHost.innerHTML = "";
    if (!merged.length) {
      auditHost.appendChild(el("p", "dim", h("No audited actions yet — saves, approvals, invoices and role changes all land here.")));
      return;
    }
    for (const e of merged.slice(0, 60)) {
      const item = el("div", "psa-feed-item");
      item.innerHTML = '<span class="badge badge-' + (e.role === "admin" ? "err" : e.role === "manager" ? "warn" : "muted") + '">' + h(e.role || "local") + "</span> <strong>" + h(e.action) + "</strong> — " + h(e.detail || "") + " <span class='dim'>" + h(e.actor) + " · " + timeAgo(e.ts) + "</span>";
      auditHost.appendChild(item);
    }
  }

  function refreshAdminHint() {
    const st = hub.getState();
    adminHint.textContent = st.me && st.me.role === "admin" ? "You are admin — you can manage roles, rate cards, project closures and backups." : "Not an admin yet — claim it with the workspace password.";
    adminHint.className = "psa-mode-line" + (st.me && st.me.role === "admin" ? " admin-ok" : "");
  }

  function refreshAll() {
    refreshStatusLine();
    refreshAdminHint();
    renderRoster();
    renderFeed();
    renderAudit();
  }

  const unsub = hub.subscribe(() => refreshAll());
  if (usersUnsub) usersUnsub();
  usersUnsub = unsub;
  refreshAll();
}

let usersUnsub = null;

registerModule({
  id: "settings",
  label: "Settings",
  icon: "box",
  async render({ view, route }) {
    const active = route.parts[0] || "settings";
    const sec = moduleShell("settings");
    sec.appendChild(tabs(active, TABS));
    if (active === "settings") renderSyncTab(sec);
    else if (active === "backup") await renderBackupTab(sec);
    else if (active === "capacity") renderCapacityTab(sec);
    else if (active === "archive") await renderArchiveTab(sec);
    else if (active === "integrity") renderIntegrityTab(sec);
    else if (active === "pipeline") await renderPipelineTab(sec);
    else if (active === "users") renderUsersTab(sec);
    else renderSyncTab(sec);
    view.appendChild(sec);
  }
});
