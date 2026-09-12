// ============================================================================
// quote-u — Admin station renderer (roadmap task 8)
// ----------------------------------------------------------------------------
// The operational home for the system of record: document sync status, the
// conflict-resolution panel, version history with restore, full backup &
// restore, and capacity & archive. Everything here rides on the versioned
// document store (src/store.js); later phases add flags, data mode, mappings
// and the audit log to this station.
// ============================================================================
window.QU_RENDERERS = window.QU_RENDERERS || {};

function renderAdminStation(ctx) {
  const store = ctx.store || (window.QU && window.QU.store) || null;
  const wrap = document.createElement("div");
  wrap.className = "admin-stack";

  if (!store) {
    const card = document.createElement("div");
    card.className = "state state-empty";
    card.innerHTML = '<p class="state-title">Document store unavailable</p><p class="state-msg">The system-of-record storage has not initialised, so admin functions are unavailable.</p>';
    wrap.appendChild(card);
    return wrap;
  }

  const statusCard = document.createElement("section");
  statusCard.className = "card admin-status";
  statusCard.innerHTML = `
    <div class="card-title-row">
      <div>
        <h2>System of record</h2>
        <p class="hint" style="margin:2px 0 0">Every entity document is reconciled against its canonical copy on startup. Edits made on more than one device since the last sync surface as conflicts to resolve.</p>
      </div>
      <span class="chip" data-admin-chip>…</span>
    </div>
    <div class="sys-grid" data-admin-status></div>
    <div class="admin-actions">
      <button class="btn btn-ghost btn-sm" data-admin-sync>Sync now</button>
    </div>
  `;
  wrap.appendChild(statusCard);

  const chipEl = statusCard.querySelector("[data-admin-chip]");
  const statusEl = statusCard.querySelector("[data-admin-status]");
  const syncBtn = statusCard.querySelector("[data-admin-sync]");

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderStatus(sum, boot) {
    if (!sum) {
      chipEl.textContent = "unavailable";
      statusEl.innerHTML = '<div class="sys-row"><span class="sys-k">Status</span><span class="sys-v muted">could not be read</span></div>';
      return;
    }
    const c = sum.counts;
    const bits = [];
    if (c.synced) bits.push(c.synced + " synced");
    if (c.localOnly) bits.push(c.localOnly + " local-only");
    if (c.pending) bits.push(c.pending + " pending");
    if (c.conflict) bits.push(c.conflict + " conflict" + (c.conflict === 1 ? "" : "s"));
    if (c.diverged) bits.push(c.diverged + " diverged");
    if (c.problem) bits.push(c.problem + " errors");
    chipEl.textContent = c.total + " documents";
    const last = sum.info && sum.info.lastReconcileAt;
    const rows = [
      ["Documents", c.total + (c.none === c.total ? " (none configured yet)" : "")],
      ["State", bits.length ? bits.join(" · ") : "all in sync"],
      ["Last reconcile", last ? esc(window.QU_SYNC ? window.QU_SYNC.timeAgo(last) : last) : "not yet"],
      ["Build stage", boot && boot.ok === false ? "store unavailable" : "sync, conflict, backup & archive"]
    ];
    statusEl.innerHTML = rows.map(r => `<div class="sys-row"><span class="sys-k">${r[0]}</span><span class="sys-v muted">${r[1]}</span></div>`).join("");
  }

  (async () => {
    try {
      const boot = await (window.QU.storeReady || Promise.resolve(null)).catch(() => null);
      let sum = await store.statusSummary().catch(() => null);
      renderStatus(sum, boot);
      if (sum && (sum.counts.pending > 0 || sum.counts.conflict > 0) && store.reconcileAll) {
        await store.reconcileAll().catch(() => null);
        sum = await store.statusSummary().catch(() => null);
        renderStatus(sum, boot);
      }
      await Promise.all([
        mountZone(wrap, window.QU_SYNC, "conflictBlocks", store, { onChange: () => window.QU.rerender && window.QU.rerender() }),
        mountZone(wrap, window.QU_HISTORY, "renderZone", store, { onChange: () => window.QU.rerender && window.QU.rerender() }),
        mountZone(wrap, window.QU_BACKUP, "renderZone", store),
        mountZone(wrap, window.QU_CAPACITY, "renderZone", store),
        mountZone(wrap, (window.QU && window.QU.invoiceMapping) || null, "renderZone", store, {}),
        mountZone(wrap, (window.QU && window.QU.features) || null, "renderZone", null, {}),
        mountZone(wrap, (window.QU && window.QU.reconciliation) || null, "renderZone", null, {}),
        mountZone(wrap, (window.QU && window.QU.integrity) || null, "renderZone", null, {}),
        mountZone(wrap, (window.QU && window.QU.observability) || null, "renderZone", null, {}),
        mountZone(wrap, (window.QU && window.QU.verification) || null, "renderZone", null, {}),
        mountZone(wrap, (window.QU && window.QU.roles) || null, "renderZone", null, {}),
        mountZone(wrap, (window.QU && window.QU.hub) || null, "renderZone", store, {})
      ]);
    } catch (e) {
      console.error("quote-u admin station failed:", e);
    }
  })();

  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing…";
    try {
      const res = await store.reconcileAll();
      const conflicts = Object.keys(res || {}).filter(m => res[m] && res[m].state === "conflict");
      if (window.QU && window.QU.toast) window.QU.toast(conflicts.length ? "Sync complete — " + conflicts.length + " document" + (conflicts.length === 1 ? "" : "s") + " need resolution" : "All documents in sync");
    } catch (e) {
      if (window.QU && window.QU.toast) window.QU.toast("Sync failed: " + ((e && e.message) || e));
    }
    if (window.QU && window.QU.rerender) window.QU.rerender();
  });

  return wrap;
}

async function mountZone(container, mod, fn, store, opts) {
  if (!mod || typeof mod[fn] !== "function") return;
  try {
    const zone = await mod[fn](store, opts);
    if (zone) container.appendChild(zone);
  } catch (e) {
    console.error("quote-u admin zone failed:", e);
  }
}

window.QU_RENDERERS.admin = renderAdminStation;
