// ============================================================================
// quote-u — Invoicing station: finance reconciliation view (roadmap task 39)
// ----------------------------------------------------------------------------
// The finance surface. Every approved version gets exactly one invoice intent
// (the double-billing guard); this station reconciles each intent's resulting
// invoice back against the acceptance record — the amount the client approved
// versus the amount the external system actually invoiced — and lets finance
// mark a clean match reconciled.
//
// Reads and the single `reconcile` write go through QU_RECONCILIATION; the
// intent guard stays the system of record on which path a version used.
// ============================================================================
window.QU_RENDERERS = window.QU_RENDERERS || {};

function renderInvoicingStation(ctx) {
  const wrap = document.createElement("div");
  wrap.className = "admin-stack";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(cents) {
    if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
    const M = window.QU_MONEY;
    if (M && typeof M.format === "function") return M.format(cents);
    return "$" + (cents / 100).toFixed(2);
  }

  const svc = (window.QU && window.QU.reconciliation) || null;
  const gateway = (window.QU && window.QU.gateway) || null;
  if (!svc) {
    const c = document.createElement("div");
    c.className = "state state-empty";
    c.innerHTML = '<p class="state-title">Reconciliation unavailable</p><p class="state-msg">The finance reconciliation service has not initialised.</p>';
    wrap.appendChild(c);
    return wrap;
  }

  const STATUS_COPY = {
    matched: "Matched",
    mismatch: "Mismatch",
    awaiting_invoice: "Awaiting invoice",
    pending: "Pending",
    failed: "Failed",
    unverified: "Unverified",
    no_approval: "Not approved"
  };
  const STATUS_CLASS = {
    matched: "pass",
    mismatch: "fail",
    failed: "fail",
    unverified: "fail",
    awaiting_invoice: "skip",
    pending: "skip",
    no_approval: "skip"
  };

  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = `
    <div class="card-title-row">
      <div>
        <h2>Invoice reconciliation</h2>
        <p class="hint" style="margin:2px 0 0">Every approved version has exactly one invoice intent — the hard double-billing guard. Each intent's resulting invoice is compared with the amount the client accepted; a clean match can be marked reconciled.</p>
      </div>
      <span class="chip" data-rec-chip>…</span>
    </div>
    <div class="admin-actions" style="margin:10px 0">
      <label class="hint" style="display:flex;gap:6px;align-items:center">Show
        <select data-rec-filter>
          <option value="all">All intents</option>
          <option value="attention">Needs attention</option>
          <option value="matched">Matched</option>
          <option value="awaiting">Awaiting invoice</option>
        </select>
      </label>
      <button class="btn btn-ghost btn-sm" data-rec-refresh>Refresh</button>
    </div>
    <div class="sys-grid" data-rec-summary></div>
    <div data-rec-list style="margin-top:12px"></div>
    <div class="hint" data-rec-msg style="margin-top:8px"></div>
  `;
  wrap.appendChild(card);

  const chipEl = card.querySelector("[data-rec-chip]");
  const summaryEl = card.querySelector("[data-rec-summary]");
  const listEl = card.querySelector("[data-rec-list]");
  const msgEl = card.querySelector("[data-rec-msg]");
  const filterEl = card.querySelector("[data-rec-filter]");

  let reports = [];

  function filtered() {
    const f = filterEl.value;
    if (f === "attention") return reports.filter(r => r.needs_attention);
    if (f === "matched") return reports.filter(r => r.status === "matched");
    if (f === "awaiting") return reports.filter(r => r.status === "awaiting_invoice" || r.status === "pending");
    return reports;
  }

  function renderSummary(sum) {
    if (!sum) { summaryEl.innerHTML = ""; return; }
    const c = sum.counts || {};
    const rows = [
      ["Intents", String(sum.total)],
      ["Matched", String(c.matched || 0)],
      ["Awaiting invoice", String((c.awaiting_invoice || 0) + (c.pending || 0))],
      ["Needs attention", String(sum.needs_attention || 0)]
    ];
    summaryEl.innerHTML = rows.map(r => `<div class="sys-row"><span class="sys-k">${r[0]}</span><span class="sys-v muted">${esc(r[1])}</span></div>`).join("");
    chipEl.textContent = sum.total + (sum.total === 1 ? " intent" : " intents");
  }

  function renderRow(r) {
    const cls = STATUS_CLASS[r.status] || "skip";
    const label = STATUS_COPY[r.status] || r.status;
    const approved = r.approved ? money(r.approved.subtotal_cents) : "—";
    const invoiced = r.invoiced ? money(r.invoiced.subtotal_cents) : "—";
    const variance = typeof r.variance_cents === "number" && r.variance_cents !== 0 ? money(r.variance_cents) : "—";
    const checks = r.checks.map(c =>
      `<div class="sys-row"><span class="sys-k">${esc(c.label)}</span><span class="sys-v muted">${c.ok ? "ok" : "expected " + esc(String(c.expected)) + ", got " + esc(String(c.actual))}</span></div>`
    ).join("");
    const canReconcile = r.status === "matched" && !r.reconciled;
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "8px 0";
    row.innerHTML = `
      <div class="card-title-row">
        <div>
          <h3 style="margin:0;font-size:15px">${esc(r.quote_id || "quote")} · <span class="hint">${esc(r.version_id || "")}</span></h3>
          <p class="hint" style="margin:2px 0 0">${esc(r.path || "path unknown")}${r.external_system ? " · " + esc(r.external_system) : ""}${r.external_reference ? " · " + esc(r.external_reference) : ""}${r.reconciled ? " · reconciled" : ""}</p>
        </div>
        <span class="st-chip ${cls}">${esc(label)}</span>
      </div>
      <div class="sys-grid">
        <div class="sys-row"><span class="sys-k">Approved (pre-tax)</span><span class="sys-v muted">${esc(approved)}</span></div>
        <div class="sys-row"><span class="sys-k">Invoiced (pre-tax)</span><span class="sys-v muted">${esc(invoiced)}</span></div>
        <div class="sys-row"><span class="sys-k">Variance</span><span class="sys-v muted">${esc(variance)}</span></div>
        <div class="sys-row"><span class="sys-k">Approved lines</span><span class="sys-v muted">${r.approved ? r.approved.line_count : "—"}</span></div>
      </div>
      <details style="margin-top:8px"><summary class="hint">Checks</summary>${checks || '<p class="hint">No checks yet.</p>'}</details>
      ${canReconcile ? '<div style="margin-top:10px"><button class="btn btn-primary btn-sm" data-rec-reconcile="' + esc(r.version_id) + '">Mark reconciled</button></div>' : ""}
    `;
    const btn = row.querySelector("[data-rec-reconcile]");
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Reconciling…";
        const res = await svc.reconcile(r.version_id, { actor: "finance" });
        msgEl.textContent = res.ok ? "Version " + r.version_id + " marked reconciled." : "Could not reconcile: " + (res.detail || res.code);
        await refresh();
      });
    }
    return row;
  }

  async function refresh() {
    msgEl.textContent = "";
    const res = await svc.list({});
    if (!res.ok) {
      msgEl.textContent = "Could not load intents: " + (res.detail || res.code);
      return;
    }
    reports = res.reports || [];
    renderSummary(res.summary);
    const rows = filtered();
    listEl.innerHTML = "";
    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = reports.length ? "No intents match this filter." : "No invoice intents yet — approve a quote and let its invoicing path run.";
      listEl.appendChild(empty);
      return;
    }
    rows.forEach(r => listEl.appendChild(renderRow(r)));
  }

  filterEl.addEventListener("change", refresh);
  card.querySelector("[data-rec-refresh]").addEventListener("click", refresh);
  refresh();

  return wrap;
}

window.QU_RENDERERS.invoicing = renderInvoicingStation;
