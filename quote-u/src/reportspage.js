// ============================================================================
// quote-u — Reports station renderer (roadmap task 58, analytics handoff 60)
// ----------------------------------------------------------------------------
// The dashboards & reports surface. It calls the ONE pure analytics engine
// (QU_REPORTS) and renders: quote volume, win/loss rate, average margin, cycle
// time and the open pipeline, filterable by rep, company and period — plus a
// by-rep / by-company breakdown and the schema-stable BI handoff
// (QU_ANALYTICS): build the extract, publish it to the pipeline, or download it
// as JSON/CSV.
//
// Margin is INTERNAL: it is shown here and nowhere a client can reach.
// ============================================================================
window.QU_RENDERERS = window.QU_RENDERERS || {};

function renderReportsStation(ctx) {
  const wrap = document.createElement("div");
  wrap.className = "admin-stack";
  const R = window.QU_REPORTS || null;
  const A = window.QU_ANALYTICS || null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(cents) {
    if (!Number.isSafeInteger(cents)) return "—";
    try { return (window.QU_MONEY && window.QU_MONEY.format(cents)) || String(cents); } catch (e) { return String(cents); }
  }
  function pct(bp) {
    if (bp === null || bp === undefined || !isFinite(bp)) return "—";
    return (bp / 100).toFixed(1) + "%";
  }
  function days(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return "—";
    return (ms / 86400000).toFixed(1) + "d";
  }

  if (!R) {
    const c = document.createElement("div");
    c.className = "state state-empty";
    c.innerHTML = '<p class="state-title">Reports unavailable</p><p class="state-msg">The analytics engine is not loaded.</p>';
    wrap.appendChild(c);
    return wrap;
  }

  const state = { preset: "90d", rep: "", company_id: "", report: null, loading: false };

  // ---- filter bar -----------------------------------------------------------

  const filterCard = document.createElement("section");
  filterCard.className = "card";
  filterCard.innerHTML =
    '<div class="card-title-row"><div><h2>Filters</h2>' +
    '<p class="hint" style="margin:2px 0 0">Quote volume, win/loss, margin and cycle time — by rep, company and period. Margin is internal and never reaches the portal.</p></div>' +
    '<span class="chip" data-rp-chip>…</span></div>' +
    '<div class="rp-filters" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:8px">' +
    '<div class="rp-presets" data-rp-presets></div>' +
    '<label class="hint" style="display:flex;flex-direction:column;gap:2px">Rep<select data-rp-rep class="rp-select"><option value="">All reps</option></select></label>' +
    '<label class="hint" style="display:flex;flex-direction:column;gap:2px">Company<select data-rp-company class="rp-select"><option value="">All companies</option></select></label>' +
    '<label class="hint" style="display:flex;flex-direction:column;gap:2px">From<input type="date" data-rp-from class="rp-select"></label>' +
    '<label class="hint" style="display:flex;flex-direction:column;gap:2px">To<input type="date" data-rp-to class="rp-select"></label>' +
    '<button class="btn btn-primary btn-sm" data-rp-run>Run report</button>' +
    "</div>" +
    '<div data-rp-msg class="hint" style="margin-top:6px"></div>';
  wrap.appendChild(filterCard);

  const presetsEl = filterCard.querySelector("[data-rp-presets]");
  const repEl = filterCard.querySelector("[data-rp-rep]");
  const companyEl = filterCard.querySelector("[data-rp-company]");
  const fromEl = filterCard.querySelector("[data-rp-from]");
  const toEl = filterCard.querySelector("[data-rp-to]");
  const chipEl = filterCard.querySelector("[data-rp-chip]");
  const msgEl = filterCard.querySelector("[data-rp-msg]");

  const PRESETS = [["30d", "30 days"], ["90d", "90 days"], ["12m", "12 months"], ["ytd", "YTD"], ["all", "All time"]];
  presetsEl.style.display = "flex";
  presetsEl.style.gap = "4px";
  PRESETS.forEach(([key, label]) => {
    const b = document.createElement("button");
    b.className = "btn btn-ghost btn-sm" + (key === state.preset ? " btn-primary" : "");
    b.textContent = label;
    b.dataset.preset = key;
    b.addEventListener("click", () => {
      state.preset = key;
      presetsEl.querySelectorAll("button").forEach(x => x.className = "btn btn-ghost btn-sm" + (x.dataset.preset === key ? " btn-primary" : ""));
      fromEl.value = ""; toEl.value = "";
      load();
    });
    presetsEl.appendChild(b);
  });

  const kpiRow = document.createElement("div");
  kpiRow.className = "rp-kpis";
  kpiRow.style.display = "grid";
  kpiRow.style.gridTemplateColumns = "repeat(auto-fit,minmax(150px,1fr))";
  kpiRow.style.gap = "10px";
  kpiRow.style.marginTop = "10px";
  wrap.appendChild(kpiRow);

  const breakdownCard = document.createElement("section");
  breakdownCard.className = "card";
  breakdownCard.innerHTML = '<div class="card-title-row"><div><h2>Breakdown</h2><p class="hint" style="margin:2px 0 0">The same metrics grouped by rep and by company.</p></div></div><div data-rp-breakdown></div>';
  wrap.appendChild(breakdownCard);
  const breakdownEl = breakdownCard.querySelector("[data-rp-breakdown]");

  const handoffCard = document.createElement("section");
  handoffCard.className = "card";
  handoffCard.innerHTML =
    '<div class="card-title-row"><div><h2>Analytics &amp; BI handoff</h2>' +
    '<p class="hint" style="margin:2px 0 0">A <strong>schema-stable</strong> extract of quotes, decisions and margins, publishable to the pipeline\'s analytics ingestion (or downloadable as JSON/CSV). The schema is frozen and fingerprinted so a consumer can pin it.</p></div>' +
    '<span class="chip" data-ax-chip>…</span></div>' +
    '<div class="sys-grid" data-ax-info></div>' +
    '<div class="admin-actions" style="margin-top:10px">' +
    '<button class="btn btn-ghost btn-sm" data-ax-build>Build extract</button>' +
    '<button class="btn btn-primary btn-sm" data-ax-publish>Publish to BI</button>' +
    '<button class="btn btn-ghost btn-sm" data-ax-json>Download JSON</button>' +
    '<button class="btn btn-ghost btn-sm" data-ax-csv>Download CSV</button>' +
    "</div>" +
    '<div data-ax-msg class="hint" style="margin-top:6px"></div>';
  wrap.appendChild(handoffCard);
  const axChip = handoffCard.querySelector("[data-ax-chip]");
  const axInfo = handoffCard.querySelector("[data-ax-info]");
  const axMsg = handoffCard.querySelector("[data-ax-msg]");

  if (A) {
    const sch = A.schema();
    axChip.textContent = "v" + sch.version + " · " + A.fingerprint();
    axInfo.innerHTML = Object.keys(sch.tables).map(t =>
      '<div class="sys-row"><span class="sys-k">' + esc(t) + '</span><span class="sys-v muted" style="overflow:visible;white-space:normal;text-align:right">' + esc(sch.tables[t].join(", ")) + "</span></div>"
    ).join("");
  } else {
    axChip.textContent = "unavailable";
    axInfo.innerHTML = '<div class="sys-row"><span class="sys-k">Status</span><span class="sys-v muted">the analytics module is not loaded</span></div>';
  }

  // ---- data load ------------------------------------------------------------

  function currentFilter() {
    const f = { rep: repEl.value || null, company_id: companyEl.value || null };
    if (fromEl.value || toEl.value) { f.from = fromEl.value || null; f.to = toEl.value || null; }
    else Object.assign(f, R.periodFromPreset(state.preset));
    return f;
  }

  function kpiCard(label, value, sub) {
    const d = document.createElement("div");
    d.className = "card rp-kpi";
    d.style.margin = "0";
    d.innerHTML = '<div class="hint" style="text-transform:uppercase;letter-spacing:.04em;font-size:11px">' + esc(label) + '</div>' +
      '<div style="font-size:22px;font-weight:700;margin:4px 0 2px">' + esc(value) + '</div>' +
      '<div class="hint">' + esc(sub || "") + "</div>";
    return d;
  }

  function render(report) {
    const v = report.volume, w = report.win_loss, m = report.margin, c = report.cycle_time, p = report.pipeline;
    kpiRow.innerHTML = "";
    kpiRow.appendChild(kpiCard("Quote volume", String(v.quotes), v.versions + " versions · " + v.sent + " sent"));
    kpiRow.appendChild(kpiCard("Win rate", pct(w.win_rate_bp), w.won + " won · " + w.lost + " lost" + (w.expired ? " · " + w.expired + " lapsed" : "")));
    kpiRow.appendChild(kpiCard("Avg margin", pct(m.margin_bp), money(m.margin_cents) + (m.accepted_versions ? " over " + m.accepted_versions + " accepted" : "")));
    kpiRow.appendChild(kpiCard("Cycle time", days(c.avg_ms), c.samples + " decided · median " + days(c.median_ms)));
    kpiRow.appendChild(kpiCard("Open pipeline", String(p.open_count), money(p.deal_value_cents) + " deal value"));

    function table(rows) {
      if (!rows.length) return '<p class="hint">No rows.</p>';
      return '<div style="overflow-x:auto"><table class="rp-table" style="width:100%;border-collapse:collapse;font-size:13px">' +
        "<thead><tr>" + ["Rep/Company", "Quotes", "Sent", "Decided", "Won", "Lost", "Win rate", "Avg margin", "Avg deal"].map(h => '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">' + h + "</th>").join("") + "</tr></thead><tbody>" +
        rows.map(r => "<tr>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + esc(r.label) + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + r.quotes + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + r.sent + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + r.decided + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + r.won + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + r.lost + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + pct(r.win_rate_bp) + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + pct(r.margin_bp) + "</td>" +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--border)">' + money(r.avg_deal_cents) + "</td>" +
          "</tr>").join("") + "</tbody></table></div>";
    }

    breakdownEl.innerHTML =
      '<h3 style="margin:10px 0 4px;font-size:13px">By rep</h3>' + table(report.by_rep) +
      '<h3 style="margin:16px 0 4px;font-size:13px">By company</h3>' + table(report.by_company);
  }

  async function load() {
    if (!window.QU || !window.QU.reports) {
      msgEl.textContent = "The reports service is not available.";
      return;
    }
    state.loading = true;
    chipEl.textContent = "loading…";
    try {
      const report = await window.QU.reports.report(currentFilter());
      state.report = report;
      chipEl.textContent = report.filter.hasPeriod ? "filtered period" : "all time";
      render(report);
      msgEl.textContent = "";
    } catch (e) {
      chipEl.textContent = "error";
      msgEl.textContent = "Could not build the report: " + ((e && e.message) || e);
    }
    state.loading = false;
  }

  filterCard.querySelector("[data-rp-run]").addEventListener("click", load);
  fromEl.addEventListener("change", () => { state.preset = ""; load(); });
  toEl.addEventListener("change", () => { state.preset = ""; load(); });
  repEl.addEventListener("change", load);
  companyEl.addEventListener("change", load);

  // ---- analytics handoff ----------------------------------------------------

  handoffCard.querySelector("[data-ax-build]").addEventListener("click", async () => {
    if (!A || !window.QU.analytics) { axMsg.textContent = "The analytics module is not available."; return; }
    try {
      const ex = await window.QU.analytics.buildExtract();
      axMsg.textContent = "Built " + ex.fingerprint + " — quotes " + ex.counts.quotes + ", decisions " + ex.counts.decisions + ", margins " + ex.counts.margins + ".";
      handoffCard._extract = ex;
    } catch (e) { axMsg.textContent = "Could not build the extract: " + ((e && e.message) || e); }
  });
  handoffCard.querySelector("[data-ax-publish]").addEventListener("click", async () => {
    if (!window.QU.analytics) { axMsg.textContent = "The analytics module is not available."; return; }
    axMsg.textContent = "Publishing…";
    const r = await window.QU.analytics.publish(handoffCard._extract);
    axMsg.textContent = r.ok ? ("Published to " + r.stream + " (" + r.counts.decisions + " decisions, " + r.counts.margins + " margins).") : ("Publish refused: " + (r.detail || r.code));
  });
  function download(name, text, type) {
    try {
      const blob = new Blob([text], { type: type || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) { axMsg.textContent = "Download failed: " + ((e && e.message) || e); }
  }
  handoffCard.querySelector("[data-ax-json]").addEventListener("click", async () => {
    if (!A) return;
    const ex = handoffCard._extract || (window.QU.analytics ? await window.QU.analytics.buildExtract() : null);
    if (ex) download("quote-u-analytics.json", JSON.stringify(ex, null, 2), "application/json");
  });
  handoffCard.querySelector("[data-ax-csv]").addEventListener("click", async () => {
    if (!A) return;
    const ex = handoffCard._extract || (window.QU.analytics ? await window.QU.analytics.buildExtract() : null);
    if (ex) download("quote-u-analytics.csv", A.toCsv(ex.tables.decisions, A.TABLES.decisions), "text/csv");
  });

  // ---- boot -----------------------------------------------------------------

  (async () => {
    try {
      if (window.QU && window.QU.reports && typeof window.QU.reports.facets === "function") {
        const f = await window.QU.reports.facets();
        (f.reps || []).forEach(r => { const o = document.createElement("option"); o.value = r; o.textContent = r; repEl.appendChild(o); });
        (f.companies || []).forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; companyEl.appendChild(o); });
      }
    } catch (e) { /* filters stay at "all" */ }
    load();
  })();

  return wrap;
}

window.QU_RENDERERS.reports = renderReportsStation;
