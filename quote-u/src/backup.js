// ============================================================================
// quote-u — backup & restore panel (roadmap task 8)
// ----------------------------------------------------------------------------
// One-click full backup: publishes every entity document (data only, no write
// keys) to the server and downloads a copy carrying this device's write keys.
// Restoring validates the backup, previews exactly what will change, refuses
// while a sync item is pending, and archives the replaced version.
// Lifted from CRM-U's src/backup.js (window.QU_BACKUP).
// ============================================================================
window.QU_BACKUP = (function () {
  function moduleLabel(id) {
    const def = (window.QU_MODULES || []).find(m => m.id === id);
    if (def) return def.label;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function timeAgo(iso) {
    if (!iso) return "recently";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 8) return "just now";
    if (s < 60) return Math.round(s) + "s ago";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return new Date(iso).toLocaleDateString();
  }
  function fmtStamp(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function fmtBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }
  function backupFilename(snap) {
    const d = new Date(snap.at || Date.now());
    const p = x => String(x).padStart(2, "0");
    const stamp = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    return "quote-u-backup-" + stamp + ".json";
  }
  function downloadSnapshot(snap) {
    const json = JSON.stringify(snap, null, 1);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename(snap);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return json.length;
  }

  async function liveSummaryLine(store) {
    const sum = await store.statusSummary().catch(() => null);
    if (!sum) return "unavailable";
    const c = sum.counts;
    if (c.none === c.total) return "no documents yet";
    const bits = [];
    if (c.synced) bits.push(c.synced + " synced");
    if (c.localOnly) bits.push(c.localOnly + " local");
    if (c.pending) bits.push(c.pending + " pending");
    if (c.conflict) bits.push(c.conflict + " conflict");
    if (c.diverged) bits.push(c.diverged + " diverged");
    if (c.problem) bits.push(c.problem + " error");
    return c.total + " modules · " + (bits.join(" · ") || "…");
  }

  function publishedSummary(meta) {
    if (!meta) return null;
    const present = meta.modules.filter(x => x.present);
    const records = present.reduce((n, x) => n + (x.records || 0), 0);
    return { present: present.length, records, at: meta.at, id: meta.id };
  }

  function statusShow(statusEl, kind, text) {
    statusEl.innerHTML = "";
    statusEl.hidden = false;
    statusEl.appendChild(el("div", "bkp-msg " + kind, text));
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? "Working…" : btn.dataset.label;
  }

  async function openRestoreFlow(zone, store, sourceText, sourceLabel) {
    const statusEl = zone.querySelector("[data-bkp-status]");
    statusEl.innerHTML = "";
    statusEl.hidden = false;
    const loading = el("div", "bkp-loading");
    loading.appendChild(el("span", "bkp-spinner"));
    loading.appendChild(document.createTextNode("Validating backup…"));
    statusEl.appendChild(loading);
    const val = await store.validateBackup(sourceText).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
    if (!val.ok) {
      statusShow(statusEl, "err", val.detail || "That backup failed validation (" + val.code + ").");
      return;
    }
    loading.textContent = "Checking against today's data…";
    const preview = await store.previewBackup(val.snapshot).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
    if (!preview.ok) {
      statusShow(statusEl, "err", preview.detail || ("Couldn't prepare the restore (" + preview.code + ")."));
      return;
    }
    statusEl.innerHTML = "";
    const panel = el("div", "bkp-panel");
    const head = el("div", "bkp-panel-head");
    const tWrap = el("div");
    tWrap.appendChild(el("div", "bkp-panel-title", "Restore " + sourceLabel));
    const src = val.snapshot.generator && val.snapshot.generator.name ? "backup of " + val.snapshot.generator.name + " · " + fmtStamp(val.snapshot.at) : "backup from " + fmtStamp(val.snapshot.at);
    tWrap.appendChild(el("div", "bkp-panel-sub", src));
    head.appendChild(tWrap);
    panel.appendChild(head);

    const banners = el("div", "bkp-banners");
    const rollbackRows = preview.rows.filter(r => r.action === "replace" && r.rollback);
    const pendingRows = preview.rows.filter(r => r.pending);
    const writeRows = preview.rows.filter(r => r.action === "replace" || r.action === "create");
    if (rollbackRows.length) {
      banners.appendChild(el("div", "bkp-msg warn", rollbackRows.length + " module" + (rollbackRows.length === 1 ? " is" : "s are") + " newer than this backup: " + rollbackRows.map(r => moduleLabel(r.module)).join(", ") + ". Restoring rolls " + (rollbackRows.length === 1 ? "it" : "them") + " back to the backup. Today's version is archived on this device first, so nothing is lost silently."));
    }
    if (pendingRows.length) {
      banners.appendChild(el("div", "bkp-msg err", "Sync items are waiting on " + pendingRows.map(r => moduleLabel(r.module)).join(", ") + ". Restoring is disabled until those are resolved — finish them on the Sync section above, then try again."));
    }
    panel.appendChild(banners);

    if (!writeRows.length) banners.appendChild(el("div", "bkp-msg ok", "Every module in this backup already matches today's data — restoring would change nothing."));

    const wrapDiv = el("div", "bkp-table-wrap");
    const table = el("table", "bkp-table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    ["Module", "In backup", "Today", "What restore will do"].forEach(t => { const th = document.createElement("th"); th.textContent = t; htr.appendChild(th); });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const r of preview.rows) {
      const tr = document.createElement("tr");
      const modTd = document.createElement("td");
      modTd.appendChild(el("span", "bkp-mod", moduleLabel(r.module)));
      const snapTd = document.createElement("td");
      snapTd.appendChild(el("span", "bkp-cell", r.present ? "rev " + r.snapRev + " · " + r.records + " rec" : "no data"));
      const liveTd = document.createElement("td");
      liveTd.appendChild(el("span", "bkp-cell", r.liveRev ? "rev " + r.liveRev : r.liveState === "canonical" ? "rev 0" : r.liveState === "none" ? "no document" : r.liveState));
      const actTd = document.createElement("td");
      const act = el("span", "bkp-act " + (r.action === "noop" ? "noop" : r.action === "create" ? "create" : r.action === "replace" ? (r.rollback ? "rollback" : "replace") : "skip"),
        r.action === "noop" ? "No change needed" : r.action === "create" ? "Will create" : r.action === "replace" ? (r.rollback ? "Will roll back" : "Will replace") : r.action === "skip" ? "Left alone" : r.action);
      actTd.appendChild(act);
      if (r.note) actTd.appendChild(el("div", "bkp-note", r.note));
      tr.appendChild(modTd);
      tr.appendChild(snapTd);
      tr.appendChild(liveTd);
      tr.appendChild(actTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapDiv.appendChild(table);
    panel.appendChild(wrapDiv);

    const foot = el("div", "bkp-panel-foot");
    const restoreBtn = el("button", "btn btn-primary btn-sm", "Restore this backup");
    restoreBtn.dataset.label = restoreBtn.textContent;
    const cancelBtn = el("button", "btn btn-ghost btn-sm", "Cancel");
    cancelBtn.dataset.label = cancelBtn.textContent;
    if (pendingRows.length) restoreBtn.disabled = true;
    foot.appendChild(restoreBtn);
    foot.appendChild(cancelBtn);
    const footMsg = el("div", "bkp-msg");
    footMsg.hidden = true;
    foot.appendChild(footMsg);
    panel.appendChild(foot);
    statusEl.appendChild(panel);

    restoreBtn.addEventListener("click", async () => {
      busy(restoreBtn, true);
      cancelBtn.disabled = true;
      footMsg.hidden = false;
      footMsg.className = "bkp-msg";
      footMsg.textContent = "Writing restored documents…";
      const res = await store.restoreBackup(val.snapshot).catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      if (!res.ok) {
        footMsg.className = "bkp-msg err";
        footMsg.textContent = res.detail || ("The restore could not start (" + res.code + ").");
        busy(restoreBtn, false);
        cancelBtn.disabled = false;
        return;
      }
      const mods = Object.keys(res.results || {});
      const failed = mods.filter(m => res.results[m].action === "failed");
      const replaced = mods.filter(m => res.results[m].action === "replace");
      const created = mods.filter(m => res.results[m].action === "create");
      const noops = mods.filter(m => res.results[m].action === "noop");
      const parts = [];
      if (replaced.length) parts.push(replaced.length + " module" + (replaced.length === 1 ? "" : "s") + " restored");
      if (created.length) parts.push(created.length + " created");
      if (noops.length) parts.push(noops.length + " already up to date");
      if (failed.length) parts.push(failed.length + " failed");
      footMsg.className = failed.length ? "bkp-msg err" : "bkp-msg ok";
      footMsg.textContent = "Restore complete — " + parts.join(", ") + "." + (failed.length ? " " + failed.map(m => moduleLabel(m) + (res.results[m].detail ? ": " + res.results[m].detail : "")).join(" ") : "") + (res.keysApplied ? " " + res.keysApplied + " write key" + (res.keysApplied === 1 ? "" : "s") + " recovered onto this device." : "");
      if (window.QU && window.QU.toast) window.QU.toast(failed.length ? "Restore finished with " + failed.length + " problem" + (failed.length === 1 ? "" : "s") : "Backup restored");
      restoreBtn.disabled = true;
      cancelBtn.textContent = "Done";
      if (!failed.length && window.QU && window.QU.rerender) setTimeout(() => window.QU.rerender(), 1200);
    });
    cancelBtn.addEventListener("click", () => {
      statusEl.innerHTML = "";
      statusEl.hidden = true;
    });
  }

  async function renderZone(store) {
    if (!store || typeof store.buildBackup !== "function") return null;
    const zone = el("section", "backup-zone card");
    zone.innerHTML = `
      <div class="card-title-row" style="margin-bottom:6px">
        <h2>Backup &amp; restore</h2>
        <span class="chip" data-bkp-chip></span>
      </div>
      <p class="hint bkp-lead">Back up every entity document as a downloadable file (with this device's write keys) and as a published backup on the server. Restoring validates the backup first, shows exactly what will change, and only then replaces today's data — the replaced version is archived on this device.</p>
      <div class="bkp-grid">
        <div class="bkp-col">
          <h3>Back up</h3>
          <div class="sys-row"><span class="sys-k">Documents</span><span class="sys-v" data-bkp-live>…</span></div>
          <div class="sys-row"><span class="sys-k">Published</span><span class="sys-v" data-bkp-pub>…</span></div>
          <div class="bkp-actions">
            <button class="btn btn-primary btn-sm" data-bkp-full>Full backup &amp; download</button>
            <button class="btn btn-ghost btn-sm" data-bkp-dl>Download file only</button>
          </div>
          <p class="hint">Full backup publishes to the server and downloads a copy. Publishing again with nothing changed is a safe no-op.</p>
        </div>
        <div class="bkp-col">
          <h3>Restore</h3>
          <p class="hint">Restore from the latest published backup (this device) or from a downloaded backup file — a downloaded file can also recover this device's write keys.</p>
          <div class="bkp-actions">
            <button class="btn btn-ghost btn-sm" data-bkp-pubrestore>Restore published backup…</button>
            <button class="btn btn-ghost btn-sm" data-bkp-filerestore>Restore from a file…</button>
          </div>
          <input type="file" hidden data-bkp-file accept=".json,application/json">
        </div>
      </div>
      <div class="bkp-status" data-bkp-status hidden></div>
    `;
    const statusEl = zone.querySelector("[data-bkp-status]");
    const liveEl = zone.querySelector("[data-bkp-live]");
    const pubEl = zone.querySelector("[data-bkp-pub]");
    const chipEl = zone.querySelector("[data-bkp-chip]");
    chipEl.textContent = store.modules.length + " modules";

    liveSummaryLine(store).then(s => { liveEl.textContent = s; });
    store.latestPublishedBackup().then(latest => {
      if (latest.ok) {
        const s = publishedSummary(latest.meta);
        pubEl.textContent = s ? "published " + timeAgo(s.at) + " · " + s.present + " docs · " + s.records + " records" : "published";
      } else {
        pubEl.textContent = "never published";
      }
    }).catch(() => { pubEl.textContent = "unavailable"; });

    const fullBtn = zone.querySelector("[data-bkp-full]");
    const dlBtn = zone.querySelector("[data-bkp-dl]");
    fullBtn.dataset.label = fullBtn.textContent;
    dlBtn.dataset.label = dlBtn.textContent;

    async function runFull() {
      busy(fullBtn, true);
      dlBtn.disabled = true;
      statusShow(statusEl, "ok", "Publishing backup…");
      const pub = await store.publishBackup().catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      if (!pub.ok) {
        statusShow(statusEl, "err", pub.detail || ("Couldn't publish the backup (" + pub.code + ")."));
        busy(fullBtn, false);
        dlBtn.disabled = false;
        return;
      }
      const built = await store.buildBackup().catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      if (!built.ok) {
        statusShow(statusEl, "err", "The backup was published, but the download failed: " + (built.detail || built.code));
        busy(fullBtn, false);
        dlBtn.disabled = false;
        return;
      }
      const bytes = downloadSnapshot(built.snapshot);
      const fresh = await store.latestPublishedBackup().catch(() => null);
      if (fresh && fresh.ok) {
        const s = publishedSummary(fresh.meta);
        pubEl.textContent = s ? "published " + timeAgo(s.at) + " · " + s.present + " docs · " + s.records + " records" : "published";
      }
      const n = built.summary.present;
      statusShow(statusEl, "ok", "Backup complete — " + n + " entity document" + (n === 1 ? "" : "s") + " (" + built.summary.records + " records, " + fmtBytes(bytes) + " file). Downloaded and published" + (pub.noop ? " — nothing had changed since the last published backup, so the server copy is untouched." : "."));
      if (window.QU && window.QU.toast) window.QU.toast("Full backup saved & published");
      busy(fullBtn, false);
      dlBtn.disabled = false;
    }
    async function runDownloadOnly() {
      busy(dlBtn, true);
      fullBtn.disabled = true;
      statusShow(statusEl, "ok", "Reading every entity document…");
      const built = await store.buildBackup().catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      if (!built.ok) {
        statusShow(statusEl, "err", built.detail || ("Couldn't build the backup (" + built.code + ")."));
        busy(dlBtn, false);
        fullBtn.disabled = false;
        return;
      }
      const bytes = downloadSnapshot(built.snapshot);
      statusShow(statusEl, "ok", "Downloaded " + built.summary.present + " entity document" + (built.summary.present === 1 ? "" : "s") + " (" + built.summary.records + " records, " + fmtBytes(bytes) + "). Nothing was written to the server.");
      if (window.QU && window.QU.toast) window.QU.toast("Backup file downloaded");
      busy(dlBtn, false);
      fullBtn.disabled = false;
    }
    fullBtn.addEventListener("click", runFull);
    dlBtn.addEventListener("click", runDownloadOnly);

    const pubRestoreBtn = zone.querySelector("[data-bkp-pubrestore]");
    pubRestoreBtn.dataset.label = pubRestoreBtn.textContent;
    pubRestoreBtn.addEventListener("click", async () => {
      busy(pubRestoreBtn, true);
      const rp = await store.readPublishedBackup().catch(e => ({ ok: false, code: "error", detail: (e && e.message) || String(e) }));
      busy(pubRestoreBtn, false);
      if (!rp.ok) {
        statusShow(statusEl, "err", rp.detail || ("Couldn't read the published backup (" + rp.code + ")."));
        return;
      }
      await openRestoreFlow(zone, store, rp.snapshot, "published backup");
    });

    const fileRestoreBtn = zone.querySelector("[data-bkp-filerestore]");
    fileRestoreBtn.dataset.label = fileRestoreBtn.textContent;
    const fileInput = zone.querySelector("[data-bkp-file]");
    fileRestoreBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      fileInput.value = "";
      statusShow(statusEl, "ok", "Reading " + file.name + "…");
      let text;
      try {
        text = await file.text();
      } catch (e) {
        statusShow(statusEl, "err", "Couldn't read that file: " + ((e && e.message) || e));
        return;
      }
      await openRestoreFlow(zone, store, text, "downloaded file");
    });

    return zone;
  }

  return { renderZone };
})();
