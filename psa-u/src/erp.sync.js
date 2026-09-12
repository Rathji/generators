/* ============================================================
   BUSINESS ERP — Sync & conflicts center (Task 3)
   Reconciles the local cache against the canonical documents on
   every startup and on demand ("Sync" button). When the same
   document was edited on this device AND on another device since
   the last sync, a conflict is surfaced here with three explicit
   resolutions — keep mine / keep theirs / field-level merge — so
   no write ever silently discards either side's changes.

   The engine lives in src/erp.store.js (store.sync, store.resolve
   Conflict, store.resolveFieldConflict); this file is the shell
   UI: a topbar Sync button with a pending-conflict badge, a slim
   attention banner, and a modal with per-document resolution.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = (window.ERP && window.ERP.store) || null;
  if (!store) return;

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => (n == null ? "0" : String(n));

  let busy = false;
  let lastReport = null;

  /* ─────────────────── sync engine wrapper ─────────────────── */

  async function runSync(silent) {
    if (busy) return lastReport;
    busy = true;
    setSyncing(true);
    let report;
    try {
      report = await store.sync();
    } catch (e) {
      report = { results: [], conflicts: store.conflicts(), errors: [{ error: String(e && e.message || e) }] };
    }
    busy = false;
    lastReport = report;
    setSyncing(false);
    if (!silent) {
      const parts = [];
      if (report.synced) parts.push(report.synced + " updated");
      if (report.pushed) parts.push(report.pushed + " pushed");
      if (report.conflicted) parts.push(report.conflicted + " conflicted");
      if (report.inSync) parts.push(report.inSync + " up to date");
      const errs = (report.errors || []).length;
      if (errs) parts.push(errs + " failed");
      ERP.toast("Sync complete — " + (parts.join(", ") || "nothing to do"), report.conflicted || errs ? "error" : "success");
    }
    refresh();
    return report;
  }

  function setSyncing(on) {
    const btn = $("#syncBtn");
    if (btn) btn.classList.toggle("syncing", on);
    const now = $("#syncNowBtn");
    if (now) now.disabled = on;
  }

  /* ─────────────────── render: banner + badge ─────────────────── */

  function refresh() {
    const conflicts = store.conflicts();
    const badge = $("#syncBadge");
    if (badge) {
      badge.textContent = fmt(conflicts.length);
      badge.hidden = conflicts.length === 0;
      badge.classList.toggle("has-conflicts", conflicts.length > 0);
    }
    const banner = $("#syncBanner");
    if (banner) banner.hidden = conflicts.length === 0;
    const text = $("#syncBannerText");
    if (text) {
      text.textContent =
        conflicts.length + " document" + (conflicts.length === 1 ? "" : "s") +
        " changed on another device since your last sync. Nothing has been overwritten — review and choose.";
    }
    const modal = $("#syncModal");
    if (modal && modal.classList.contains("open")) renderModal();
  }

  /* ─────────────────── modal ─────────────────── */

  function open() {
    const m = $("#syncModal");
    if (!m) return;
    m.classList.add("open");
    renderModal();
  }
  function close() {
    const m = $("#syncModal");
    if (m) m.classList.remove("open");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderModal() {
    const body = $("#syncModalBody");
    if (!body) return;
    const conflicts = store.conflicts();
    const mergeActive = conflicts.map((c) => store.pendingMerge(c.name)).filter(Boolean);
    let html = "";

    if (!conflicts.length) {
      html = '<div class="erp-sync-status"><strong>All documents in sync.</strong>' +
        "<p>Your local copies match the stored documents. If another device makes changes, they will appear here for review — nothing is overwritten without you choosing.</p></div>";
    } else {
      html = '<div class="erp-sync-status warn"><strong>' + conflicts.length + " open conflict" + (conflicts.length === 1 ? "" : "s") + "</strong>" +
        "<p>Each document below was edited on this device and on another device since the last sync. Pick what to keep — or merge the two sides field by field.</p></div>";
      html += conflicts.map((c) => renderConflictCard(c)).join("");
    }

    if (mergeActive.length) {
      html = '<div class="erp-sync-status warn"><strong>Resolve the conflicting fields to finish the merge.</strong>' +
        "<p>Fields you both changed are listed below. Pick a side for each — the rest of the two versions has already been merged.</p></div>" +
        mergeActive.map((st) => renderFieldPicker(st)).join("");
    }

    body.innerHTML = html;

    body.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.getAttribute("data-action");
        const action = btn.getAttribute("data-resolve");
        btn.disabled = true;
        try {
          const r = await store.resolveConflict(name, action);
          if (r.error) {
            ERP.toast("Could not resolve: " + (r.error || "unknown error"), "error");
            renderModal();
          } else if (r.status === "needs_decisions") {
            renderModal();
          } else {
            ERP.toast("Conflict resolved — " + { keep_mine: "kept your version", keep_theirs: "kept the other device's version", merge: "merged both versions" }[action] + ".", "success");
            refresh();
          }
        } catch (e) {
          ERP.toast("Resolution failed: " + (e && e.message || e), "error");
          btn.disabled = false;
        }
      });
    });

    body.querySelectorAll("input[type=radio][data-resolve-field]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const name = inp.getAttribute("data-name");
        const recordId = inp.getAttribute("data-record");
        const field = inp.getAttribute("data-field");
        const side = inp.value;
        inp.disabled = true;
        try {
          const r = await store.resolveFieldConflict(name, recordId, field, side);
          if (r.committed) {
            ERP.toast("Merge complete — both versions combined.", "success");
            refresh();
          } else {
            renderModal();
          }
        } catch (e) {
          ERP.toast("Field resolution failed: " + (e && e.message || e), "error");
          inp.disabled = false;
        }
      });
    });
  }

  function renderConflictCard(c) {
    const local = store.cachedDoc(c.name);
    const localRecs = local && local.records ? local.records.length : 0;
    const canonRecs = c.canonical && c.canonical.records ? c.canonical.records.length : 0;
    return (
      '<div class="erp-conflict-card" data-conflict="' + esc(c.name) + '">' +
        '<div class="erp-conflict-head">' +
          "<h3>" + esc(store.humanDocName(c.name)) + "</h3>" +
          '<span class="erp-conflict-meta">your rev ' + esc(fmt(c.localRev)) + " · other rev " + esc(fmt(c.canonicalRev)) + "</span>" +
        "</div>" +
        "<p class=\"erp-conflict-desc\">" +
          "You have <strong>" + localRecs + "</strong> record" + (localRecs === 1 ? "" : "s") +
          " (rev " + esc(fmt(c.localRev)) + "); the other device has <strong>" + canonRecs + "</strong> record" + (canonRecs === 1 ? "" : "s") +
          " (rev " + esc(fmt(c.canonicalRev)) + ").</p>" +
        '<div class="erp-conflict-actions">' +
          '<button class="btn btn-sm btn-primary" data-action="' + esc(c.name) + '" data-resolve="keep_mine">Keep mine</button>' +
          '<button class="btn btn-sm btn-ghost" data-action="' + esc(c.name) + '" data-resolve="keep_theirs">Keep theirs</button>' +
          '<button class="btn btn-sm btn-ghost" data-action="' + esc(c.name) + '" data-resolve="merge">Merge changes</button>' +
        "</div>" +
      "</div>"
    );
  }

  function renderFieldPicker(st) {
    const fcs = st.merged.fieldConflicts || [];
    const rows = fcs.map((fc) => {
      const mine = esc(typeof fc.mine === "object" ? JSON.stringify(fc.mine) : fc.mine);
      const theirs = esc(typeof fc.theirs === "object" ? JSON.stringify(fc.theirs) : fc.theirs);
      const radio = (side, label, val) =>
        '<label class="erp-field-opt"><input type="radio" name="f-' + esc(st.name) + "-" + esc(fc.recordId) + "-" + esc(fc.field) + '" value="' + side + '" data-resolve-field data-name="' + esc(st.name) + '" data-record="' + esc(fc.recordId) + '" data-field="' + esc(fc.field) + '">' + label + "</label>";
      return (
        '<div class="erp-field-conflict" data-field-row>' +
          '<div class="erp-field-title">Record #' + esc(fc.recordId) + " — <code>" + esc(fc.field) + "</code></div>" +
          '<div class="erp-field-vals">' +
            "<div>" + radio("mine", "My value", fc.mine) + '<span class="erp-field-val mine">' + mine + "</span></div>" +
            "<div>" + radio("theirs", "Their value", fc.theirs) + '<span class="erp-field-val theirs">' + theirs + "</span></div>" +
          "</div>" +
        "</div>"
      );
    }).join("");
    return '<div class="erp-conflict-card"><div class="erp-conflict-head"><h3>Merge · ' + esc(store.humanDocName(st.name)) + "</h3>" +
      '<span class="erp-conflict-meta">' + fcs.length + " field" + (fcs.length === 1 ? "" : "s") + " need" + (fcs.length === 1 ? "s" : "") + " a choice</span></div>" + rows + "</div>";
  }

  /* ─────────────────── wiring ─────────────────── */

  function wire() {
    const sb = $("#syncBtn");
    if (sb) sb.addEventListener("click", open);
    const bannerBtn = $("#syncBannerBtn");
    if (bannerBtn) bannerBtn.addEventListener("click", open);
    const now = $("#syncNowBtn");
    if (now) now.addEventListener("click", () => runSync(false));
    const modal = $("#syncModal");
    if (modal) {
      modal.querySelectorAll("[data-sync-close]").forEach((b) => b.addEventListener("click", close));
      modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && modal.classList.contains("open")) close();
    });
    store.setSyncListener(refresh);
  }

  function init() {
    wire();
    refresh();
    // Reconcile once shortly after load (boot already syncs inside the store,
    // but re-running here also catches documents cached between then and now).
    setTimeout(() => runSync(true), 400);
    setInterval(() => runSync(true), 60000);
  }

  ERP.syncCenter = { open, close, refresh, runSync };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
