/* ============================================================================
   THE LEDGER — reports.js
   Financial Reporting & Analytics (Phase 7, tasks 34–39):
    34. A/R and A/P aging reports — unpaid invoices and unpaid bills bucketed
        by days past due (current / 1–30 / 31–60 / 61–90 / 90+).
    35. Profit & Loss statement — revenue, expenses and net income over a
        date range, computed from the trial balance at range end minus the
        trial balance at the day before range start (so mid-period posting
        and closed periods behave correctly).
    36. Balance sheet — assets, liabilities and equity (including unclosed
        net income) at a point in time; must balance.
    37. Cash flow statement — indirect method: operating cash flow starts
        from net income, adds back non-cash expense, then adjusts for working
        capital; investing and financing sections follow; the statement
        reconciles to the change in cash.
    38. Financial KPI dashboard — revenue, expenses, cash position, A/R and
        A/P balances, net income and margins at a glance.
    39. Profit margin analysis — gross/net margins shown across the
        dashboard and P&L.
   Everything is derived from the double-entry ledger (posted entries), so
   voiding or adjusting a document stays consistent automatically.
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function money(n) { return FW.money(n); }
  function prevDay(date) {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function firstOfYear() { const d = new Date(); return d.getFullYear() + "-01-01"; }
  function typeOfAccount(id, accounts) { const a = accounts.find(x => x.id === id); return a ? a.type : null; }

  /* ── ledger aggregation helpers ──────────────────────────────────────── */
  async function balancesAsOf(entries, accounts, asOf) {
    const posted = entries.filter(e => e.status === "posted" && (!asOf || (e.date && e.date <= asOf)));
    return Ledger.computeBalances(posted, accounts);
  }
  function deltaBalances(endMap, startMap) {
    const out = {};
    for (const id in endMap) out[id] = round2((endMap[id] || { balance: 0 }).balance - ((startMap && startMap[id]) || { balance: 0 }).balance);
    return out;
  }
  function bucketDelta(delta, accounts, pred) {
    return round2(accounts.filter(a => pred(a)).reduce((s, a) => s + (delta[a.id] || 0), 0));
  }
  function sign(v, prefix, suffix) {
    const s = v < 0 ? "-" : "";
    return s + prefix + money(Math.abs(v)) + suffix;
  }

  /* ── shared date-range control ───────────────────────────────────────── */
  function rangeControls(currentFrom, currentTo, onApply) {
    const wrap = FW.el("div", "row-flex", null, { style: "gap:10px;align-items:flex-end;flex-wrap:wrap" });
    const mk = (id, label, val) => {
      const f = FW.el("div", "field", null, { style: "flex:0 0 auto;margin-bottom:0" });
      f.appendChild(FW.el("label", null, null, { text: label, htmlFor: id }));
      const inp = FW.el("input", null, null, { type: "date", id, value: val, style: "padding:6px 10px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:12.8px;font-family:inherit" });
      f.appendChild(inp);
      return { f, inp };
    };
    const from = mk("rptFrom", "From", currentFrom || firstOfYear());
    const to = mk("rptTo", "To", currentTo || today());
    const btn = FW.el("button", "btn btn-primary btn-sm", null, { text: "Run" });
    btn.style.marginBottom = "1px";
    wrap.appendChild(from.f); wrap.appendChild(to.f); wrap.appendChild(btn);
    btn.addEventListener("click", () => onApply(from.inp.value || firstOfYear(), to.inp.value || today()));
    return wrap;
  }
  function asOfControl(current, onApply) {
    const wrap = FW.el("div", "row-flex", null, { style: "gap:10px;align-items:flex-end;flex-wrap:wrap" });
    const f = FW.el("div", "field", null, { style: "flex:0 0 auto;margin-bottom:0" });
    f.appendChild(FW.el("label", null, null, { text: "As of", htmlFor: "rptAsOf" }));
    const inp = FW.el("input", null, null, { type: "date", id: "rptAsOf", value: current || today(), style: "padding:6px 10px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:12.8px;font-family:inherit" });
    f.appendChild(inp);
    const btn = FW.el("button", "btn btn-primary btn-sm", null, { text: "Run" });
    btn.style.marginBottom = "1px";
    wrap.appendChild(f); wrap.appendChild(btn);
    btn.addEventListener("click", () => onApply(inp.value || today()));
    return wrap;
  }

  /* ── dashboard (task 38) ─────────────────────────────────────────────── */
  async function renderDashboard(ctn) {
    const [accounts, entries] = await Promise.all([Ledger.loadAccounts(), Ledger.loadEntries()]);
    const bal = await balancesAsOf(entries, accounts, today());
    const byId = {}; for (const a of accounts) byId[a.id] = a;
    let revenue = 0, expenses = 0, cash = 0, arBal = 0, apBal = 0, fixed = 0;
    for (const id in bal) {
      const a = byId[id];
      if (!a) continue;
      const v = bal[id].balance;
      if (a.type === "revenue") revenue = round2(revenue + v);
      else if (a.type === "expense") expenses = round2(expenses + v);
      else if (a.type === "asset") {
        if (String(a.code || "").startsWith("10")) cash = round2(cash + v);
        else if (String(a.code || "").startsWith("14")) fixed = round2(fixed + v);
        if (a.code === "1100") arBal = v;
      } else if (a.type === "liability" && a.code === "2000") apBal = v;
    }
    const net = round2(revenue - expenses);
    const margin = revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : (net === 0 ? 0 : null);
    let agingHtml = "";
    if (window.AR && window.AP) {
      const [invoices, bills] = await Promise.all([window.AR.loadInvoices(), window.AP.loadBills()]);
      const arAg = window.AR.arAging(invoices, today());
      const apAg = window.AP.apAging(bills, today());
      agingHtml = '<div class="card"><div class="card-head"><h3>Receivables &amp; payables aging</h3><button class="btn btn-ghost btn-sm" data-go="reports" data-tab="aging">Full aging →</button></div>' +
        '<div class="stack" style="padding:14px 16px 16px">' +
        '<div class="spread" style="margin-bottom:10px"><span class="muted small">Accounts receivable <span class="num">' + money(arBal) + "</span></span>" +
        '<span class="muted small">' + arAg.buckets.filter((b, i) => i > 0).reduce((s, b) => s + b.count, 0) + " overdue · " + money(arAg.overdue) + "</span></div>" +
        '<div class="muted small" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' + arAg.buckets.map(b => '<span class="chip chip-pending">' + esc(b.label) + " " + money(b.total) + "</span>").join("") + "</div>" +
        '<div class="spread" style="margin-bottom:10px"><span class="muted small">Accounts payable <span class="num">' + money(apBal) + "</span></span>" +
        '<span class="muted small">' + apAg.buckets.filter((b, i) => i > 0).reduce((s, b) => s + b.count, 0) + " overdue · " + money(apAg.overdue) + "</span></div>" +
        '<div class="muted small" style="display:flex;gap:10px;flex-wrap:wrap">' + apAg.buckets.map(b => '<span class="chip chip-pending">' + esc(b.label) + " " + money(b.total) + "</span>").join("") + "</div>" +
        "</div></div>";
    }
    let html = '<div class="stat-grid" style="margin-bottom:16px">' +
      '<div class="stat-card card"><div class="stat-value">' + money(revenue) + '</div><div class="stat-label">Total revenue</div><div class="stat-sub">all-time, posted</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + money(expenses) + '</div><div class="stat-label">Total expenses</div><div class="stat-sub">all-time, posted</div></div>' +
      '<div class="stat-card card"><div class="stat-value ' + (net < 0 ? "neg" : "") + '">' + money(net) + '</div><div class="stat-label">Net income</div><div class="stat-sub">' + (margin == null ? "—" : margin + "% margin") + "</div></div>" +
      '<div class="stat-card card"><div class="stat-value">' + money(cash) + '</div><div class="stat-label">Cash position</div><div class="stat-sub">bank &amp; cash accounts</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + money(arBal) + '</div><div class="stat-label">Receivables</div><div class="stat-sub">A/R balance</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + money(apBal) + '</div><div class="stat-label">Payables</div><div class="stat-sub">A/P balance</div></div>' +
      "</div>";
    html += '<div class="row-flex" style="gap:16px;align-items:stretch;flex-wrap:wrap">' +
      '<div class="card" style="flex:1 1 340px"><div class="card-head"><h3>Financial statements</h3></div><div class="stack" style="padding:14px 16px 16px">' +
      '<button class="btn btn-ghost" data-go="reports" data-tab="pl" style="width:100%;text-align:left;justify-content:flex-start">Profit &amp; Loss <span class="muted small" style="margin-left:auto">revenue vs expenses →</span></button>' +
      '<button class="btn btn-ghost" data-go="reports" data-tab="bs" style="width:100%;text-align:left;justify-content:flex-start">Balance Sheet <span class="muted small" style="margin-left:auto">assets = liabilities + equity →</span></button>' +
      '<button class="btn btn-ghost" data-go="reports" data-tab="cf" style="width:100%;text-align:left;justify-content:flex-start">Cash Flow <span class="muted small" style="margin-left:auto">where cash came &amp; went →</span></button>' +
      "</div></div>" +
      '<div class="card" style="flex:1 1 340px"><div class="card-head"><h3>Key metrics</h3></div><div class="stack" style="padding:14px 16px 16px">' +
      '<div class="spread"><span class="muted small">Fixed assets (net)</span><span class="num">' + money(fixed) + "</span></div>" +
      '<div class="spread"><span class="muted small">Profit margin</span><span class="num">' + (margin == null ? "—" : margin + "%") + "</span></div>" +
      '<div class="spread"><span class="muted small">Working capital (cash)</span><span class="num">' + money(round2(cash + arBal - apBal)) + "</span></div>" +
      '<div class="spread"><span class="muted small">Posted entries</span><span class="num">' + entries.filter(e => e.status === "posted").length + "</span></div>" +
      "</div></div>" +
      "</div>";
    if (agingHtml) html += agingHtml;
    ctn.innerHTML = html;
    ctn.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => {
      const ev = new CustomEvent("ledger-go-report", { detail: { tab: b.getAttribute("data-tab") } });
      document.dispatchEvent(ev);
    }));
  }

  /* ── P&L (task 35) ───────────────────────────────────────────────────── */
  async function renderPL(ctn, from, to) {
    const [accounts, entries] = await Promise.all([Ledger.loadAccounts(), Ledger.loadEntries()]);
    const startMap = await balancesAsOf(entries, accounts, prevDay(from));
    const endMap = await balancesAsOf(entries, accounts, to);
    const delta = deltaBalances(endMap, startMap);
    const byId = {}; for (const a of accounts) byId[a.id] = a;
    const revRows = [], expRows = [];
    for (const id in delta) {
      const a = byId[id];
      if (!a || Math.abs(delta[id]) < 0.005) continue;
      if (a.type === "revenue") revRows.push({ a, v: delta[id] });
      else if (a.type === "expense") expRows.push({ a, v: delta[id] });
    }
    revRows.sort((x, y) => String(x.a.code).localeCompare(String(y.a.code)));
    expRows.sort((x, y) => String(x.a.code).localeCompare(String(y.a.code)));
    const revSum = round2(revRows.reduce((s, r) => s + r.v, 0));
    const expSum = round2(expRows.reduce((s, r) => s + r.v, 0));
    const net = round2(revSum - expSum);
    const margin = revSum > 0 ? Math.round((net / revSum) * 1000) / 10 : (net === 0 ? 0 : null);
    let html = rangeControls(from, to, (f, t) => renderPL(ctn, f, t)).outerHTML;
    html += '<div class="stat-grid" style="margin:16px 0">' +
      '<div class="stat-card card"><div class="stat-value">' + money(revSum) + '</div><div class="stat-label">Revenue</div><div class="stat-sub">' + esc(from) + " → " + esc(to) + "</div></div>" +
      '<div class="stat-card card"><div class="stat-value">' + money(expSum) + '</div><div class="stat-label">Expenses</div><div class="stat-sub">' + expRows.length + " accounts</div></div>" +
      '<div class="stat-card card"><div class="stat-value ' + (net < 0 ? "neg" : "") + '">' + money(net) + '</div><div class="stat-label">Net income</div><div class="stat-sub">' + (margin == null ? "—" : margin + "% margin") + "</div></div>" +
      "</div>";
    html += '<div class="card"><div class="card-head"><h3>Profit &amp; Loss — ' + esc(from) + " → " + esc(to) + "</h3></div>";
    if (!revRows.length && !expRows.length) {
      html += '<p class="muted small" style="text-align:center;padding:18px 14px">No posted activity in this range.</p></div>';
    } else {
      html += '<div class="tbl">' +
        '<div class="tr th"><div class="td" style="flex:2 1 220px">Account</div><div class="td num" style="flex:1 1 110px">Amount</div><div class="td num" style="flex:1 1 110px">% of revenue</div></div>';
      if (revRows.length) {
        html += '<div class="tr sect"><div class="td" style="flex:1 1 100%">Revenue</div></div>';
        for (const r of revRows) html += row(r.a, r.v, revSum);
        html += '<div class="tr tot"><div class="td" style="flex:2 1 220px">Total revenue</div><div class="td num" style="flex:1 1 110px">' + money(revSum) + '</div><div class="td num" style="flex:1 1 110px">100%</div></div>';
      }
      if (expRows.length) {
        html += '<div class="tr sect"><div class="td" style="flex:1 1 100%">Expenses</div></div>';
        for (const r of expRows) html += row(r.a, -r.v, revSum);
        html += '<div class="tr tot"><div class="td" style="flex:2 1 220px">Total expenses</div><div class="td num" style="flex:1 1 110px">' + money(expSum) + '</div><div class="td num" style="flex:1 1 110px">' + (revSum > 0 ? Math.round((expSum / revSum) * 1000) / 10 + "%" : "—") + '</div></div>';
      }
      html += '<div class="tr tot"><div class="td" style="flex:2 1 220px">Net income</div><div class="td num" style="flex:1 1 110px"><span class="' + (net < 0 ? "neg" : "") + '">' + money(net) + '</span></div><div class="td num" style="flex:1 1 110px">' + (margin == null ? "—" : margin + "%") + "</div></div>";
      html += "</div></div>";
    }
    ctn.innerHTML = html;
    ctn.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => document.dispatchEvent(new CustomEvent("ledger-go-report", { detail: { tab: b.getAttribute("data-tab") } }))));
    function row(a, v, base) {
      const pct = base > 0 ? Math.round((Math.abs(v) / base) * 1000) / 10 : 0;
      return '<div class="tr"><div class="td" style="flex:2 1 220px"><span class="mono acct-code">' + esc(a.code) + "</span> " + esc(a.name) + '</div><div class="td num" style="flex:1 1 110px"><span class="' + (v < 0 ? "neg" : "") + '">' + money(v) + '</span></div><div class="td num muted" style="flex:1 1 110px">' + (base > 0 ? pct + "%" : "—") + "</div></div>";
    }
  }

  /* ── Balance sheet (task 36) ─────────────────────────────────────────── */
  async function renderBS(ctn, asOf) {
    const [accounts, entries] = await Promise.all([Ledger.loadAccounts(), Ledger.loadEntries()]);
    const bal = await balancesAsOf(entries, accounts, asOf);
    const byId = {}; for (const a of accounts) byId[a.id] = a;
    const assets = [], liabs = [], eqs = [];
    let revenue = 0, expenses = 0;
    for (const id in bal) {
      const a = byId[id];
      if (!a || Math.abs(bal[id].balance) < 0.005) continue;
      const v = bal[id].balance;
      if (a.type === "asset") assets.push({ a, v });
      else if (a.type === "liability") liabs.push({ a, v });
      else if (a.type === "equity") eqs.push({ a, v });
      else if (a.type === "revenue") revenue = round2(revenue + v);
      else if (a.type === "expense") expenses = round2(expenses + v);
    }
    assets.sort((x, y) => String(x.a.code).localeCompare(String(y.a.code)));
    liabs.sort((x, y) => String(x.a.code).localeCompare(String(y.a.code)));
    eqs.sort((x, y) => String(x.a.code).localeCompare(String(y.a.code)));
    const totAssets = round2(assets.reduce((s, r) => s + r.v, 0));
    const totLiab = round2(liabs.reduce((s, r) => s + r.v, 0));
    const totEq = round2(eqs.reduce((s, r) => s + r.v, 0));
    const netIncome = round2(revenue - expenses);
    const totLiabEq = round2(totLiab + totEq + netIncome);
    const balanced = Math.abs(totAssets - totLiabEq) < 0.05;
    let html = asOfControl(asOf, v => renderBS(ctn, v)).outerHTML;
    html += '<div class="row-flex" style="gap:16px;margin-top:16px;align-items:stretch;flex-wrap:wrap">' +
      '<div class="card" style="flex:1 1 340px"><div class="card-head"><h3>Assets — ' + esc(asOf) + "</h3></div>" +
      '<div class="tbl"><div class="tr th"><div class="td" style="flex:2 1 200px">Account</div><div class="td num" style="flex:1 1 100px">Amount</div></div>';
    if (!assets.length) html += '<p class="muted small" style="text-align:center;padding:16px 12px">No asset balances.</p>';
    for (const r of assets) html += '<div class="tr"><div class="td" style="flex:2 1 200px"><span class="mono acct-code">' + esc(r.a.code) + "</span> " + esc(r.a.name) + '</div><div class="td num" style="flex:1 1 100px">' + money(r.v) + "</div></div>";
    html += '<div class="tr tot"><div class="td" style="flex:2 1 200px">Total assets</div><div class="td num" style="flex:1 1 100px">' + money(totAssets) + "</div></div></div></div>" +
      '<div class="card" style="flex:1 1 340px"><div class="card-head"><h3>Liabilities &amp; equity — ' + esc(asOf) + "</h3></div>" +
      '<div class="tbl"><div class="tr th"><div class="td" style="flex:2 1 200px">Account</div><div class="td num" style="flex:1 1 100px">Amount</div></div>';
    if (liabs.length) {
      html += '<div class="tr sect"><div class="td" style="flex:1 1 100%">Liabilities</div></div>';
      for (const r of liabs) html += '<div class="tr"><div class="td" style="flex:2 1 200px"><span class="mono acct-code">' + esc(r.a.code) + "</span> " + esc(r.a.name) + '</div><div class="td num" style="flex:1 1 100px">' + money(r.v) + "</div></div>";
      html += '<div class="tr tot"><div class="td" style="flex:2 1 200px">Total liabilities</div><div class="td num" style="flex:1 1 100px">' + money(totLiab) + "</div></div>";
    }
    if (eqs.length) {
      html += '<div class="tr sect"><div class="td" style="flex:1 1 100%">Equity</div></div>';
      for (const r of eqs) html += '<div class="tr"><div class="td" style="flex:2 1 200px"><span class="mono acct-code">' + esc(r.a.code) + "</span> " + esc(r.a.name) + '</div><div class="td num" style="flex:1 1 100px">' + money(r.v) + "</div></div>";
      html += '<div class="tr tot"><div class="td" style="flex:2 1 200px">Total equity</div><div class="td num" style="flex:1 1 100px">' + money(totEq) + "</div></div>";
    }
    html += '<div class="tr"><div class="td" style="flex:2 1 200px">Net income (unclosed periods)</div><div class="td num" style="flex:1 1 100px"><span class="' + (netIncome < 0 ? "neg" : "") + '">' + money(netIncome) + "</span></div></div>" +
      '<div class="tr tot"><div class="td" style="flex:2 1 200px">Total liabilities &amp; equity</div><div class="td num" style="flex:1 1 100px">' + money(totLiabEq) + "</div></div></div></div>" +
      "</div>";
    html += '<div class="note ' + (balanced ? "" : "warn") + '" style="margin-top:14px">' + (balanced
      ? "✓ The balance sheet is in balance — total assets " + money(totAssets) + " equal total liabilities and equity " + money(totLiabEq) + "."
      : "⚠ The balance sheet is out of balance — total assets " + money(totAssets) + " vs liabilities + equity " + money(totLiabEq) + " (difference " + money(round2(totAssets - totLiabEq)) + "). This usually means an unbalanced entry slipped through.") + "</div>";
    ctn.innerHTML = html;
  }

  /* ── Cash flow (task 37) ─────────────────────────────────────────────── */
  async function renderCF(ctn, from, to) {
    const [accounts, entries] = await Promise.all([Ledger.loadAccounts(), Ledger.loadEntries()]);
    const startMap = await balancesAsOf(entries, accounts, prevDay(from));
    const endMap = await balancesAsOf(entries, accounts, to);
    const delta = deltaBalances(endMap, startMap);
    const byId = {}; for (const a of accounts) byId[a.id] = a;
    const isCash = a => a.type === "asset" && String(a.code || "").startsWith("10");
    const isFixed = a => a.type === "asset" && String(a.code || "").startsWith("14");
    const isAr = a => a.code === "1100";
    const isInv = a => a.code === "1200";
    const isPrepaid = a => a.code === "1300";
    const isOtherAsset = a => a.type === "asset" && !isCash(a) && !isFixed(a) && !isAr(a) && !isInv(a) && !isPrepaid(a);
    const isAp = a => a.code === "2000";
    const isTax = a => a.code === "2100";
    const isPayroll = a => a.code === "2200";
    const isLoan = a => a.type === "liability" && String(a.code || "").startsWith("23");
    const isOtherLiab = a => a.type === "liability" && !isAp(a) && !isTax(a) && !isPayroll(a) && !isLoan(a);
    const isEquity = a => a.type === "equity" && a.code === "3000";
    const isDraws = a => a.type === "equity" && a.code === "3100";
    const isOtherEq = a => a.type === "equity" && !isEquity(a) && !isDraws(a);
    const revDelta = bucketDelta(delta, accounts, a => a.type === "revenue");
    const expDelta = bucketDelta(delta, accounts, a => a.type === "expense");
    const depDelta = bucketDelta(delta, accounts, a => a.code === "5900");
    const ni = round2(revDelta - expDelta);
    const dAr = bucketDelta(delta, accounts, isAr);
    const dInv = bucketDelta(delta, accounts, isInv);
    const dPrepaid = bucketDelta(delta, accounts, isPrepaid);
    const dOtherAsset = bucketDelta(delta, accounts, isOtherAsset);
    const dAp = bucketDelta(delta, accounts, isAp);
    const dTax = bucketDelta(delta, accounts, isTax);
    const dPayroll = bucketDelta(delta, accounts, isPayroll);
    const dOtherLiab = bucketDelta(delta, accounts, isOtherLiab);
    const dFixed = bucketDelta(delta, accounts, isFixed);
    const dLoan = bucketDelta(delta, accounts, isLoan);
    const dEquity = bucketDelta(delta, accounts, isEquity);
    const dDraws = bucketDelta(delta, accounts, isDraws);
    const dOtherEq = bucketDelta(delta, accounts, isOtherEq);
    const operating = round2(ni + depDelta + dAp + dTax + dPayroll + dOtherLiab - dAr - dInv - dPrepaid - dOtherAsset);
    const investing = round2(-dFixed);
    const financing = round2(dLoan + dEquity - dDraws + dOtherEq);
    const dCash = bucketDelta(delta, accounts, isCash);
    const unclassified = round2(dCash - operating - investing - financing);
    const startCash = Object.keys(startMap).filter(id => byId[id] && isCash(byId[id])).reduce((s, id) => s + (startMap[id].balance || 0), 0);
    const endCash = Object.keys(endMap).filter(id => byId[id] && isCash(byId[id])).reduce((s, id) => s + (endMap[id].balance || 0), 0);
    const rows = (label, cells, tot, extra) =>
      '<div class="tr sect"><div class="td" style="flex:1 1 100%">' + label + "</div></div>" + cells +
      '<div class="tr tot"><div class="td" style="flex:2 1 240px">' + extra + "</div><div class=\"td num\" style=\"flex:1 1 110px\">" + money(tot) + "</div></div>";
    const cell = (label, v, ind) => '<div class="tr"><div class="td" style="flex:2 1 240px' + (ind ? ";padding-left:" + ind + "px" : "") + '">' + label + '</div><div class="td num" style="flex:1 1 110px"><span class="' + (v < 0 ? "neg" : "") + '">' + money(v) + "</span></div></div>";
    let html = rangeControls(from, to, (f, t) => renderCF(ctn, f, t)).outerHTML;
    html += '<div class="card" style="margin-top:16px"><div class="card-head"><h3>Cash flow statement (indirect) — ' + esc(from) + " → " + esc(to) + "</h3></div>" +
      '<div class="tbl">' +
      rows("Operating activities",
        cell("Net income", ni) + cell("Depreciation &amp; amortization (add-back)", depDelta) + cell("Increase in accounts receivable", -dAr) + cell("Increase in inventory", -dInv) + cell("Increase in prepaid expenses", -dPrepaid) + cell("Other asset changes", -dOtherAsset) + cell("Increase in accounts payable", dAp) + cell("Increase in sales tax payable", dTax) + cell("Increase in payroll liabilities", dPayroll) + cell("Other liability changes", dOtherLiab),
        operating, "Net cash from operating activities") +
      rows("Investing activities",
        cell("Purchase of fixed assets (net)", -dFixed),
        investing, "Net cash from investing activities") +
      rows("Financing activities",
        cell("Loans borrowed / (repaid)", dLoan) + cell("Owner contributions", dEquity) + cell("Owner draws", -dDraws) + cell("Other equity changes", dOtherEq),
        financing, "Net cash from financing activities") +
      (Math.abs(unclassified) >= 0.05 ? cell("Unclassified change", unclassified) : "") +
      '<div class="tr tot"><div class="td" style="flex:2 1 240px">Net change in cash</div><div class="td num" style="flex:1 1 110px">' + money(round2(operating + investing + financing + unclassified)) + "</div></div>" +
      '<div class="tr"><div class="td" style="flex:2 1 240px">Cash, start of period</div><div class="td num" style="flex:1 1 110px">' + money(startCash) + "</div></div>" +
      '<div class="tr tot"><div class="td" style="flex:2 1 240px">Cash, end of period</div><div class="td num" style="flex:1 1 110px">' + money(endCash) + "</div></div>" +
      "</div></div>";
    html += '<div class="note" style="margin-top:12px">' + (Math.abs(unclassified) < 0.05
      ? "✓ The statement reconciles — net change in cash " + money(round2(operating + investing + financing)) + " equals the actual movement in cash accounts " + money(round2(endCash - startCash)) + "."
      : "The statement is reconciled to the ledger — net change in cash includes an unclassified difference of " + money(unclassified) + " (accounts outside the standard buckets).") + " · Cash " + money(startCash) + " → " + money(endCash) + "</div>";
    ctn.innerHTML = html;
  }

  /* ── Aging (task 34) ─────────────────────────────────────────────────── */
  async function renderAging(ctn, asOf) {
    const [invoices, bills] = await Promise.all([window.AR.loadInvoices(), window.AP.loadBills()]);
    const arAg = window.AR.arAging(invoices, asOf);
    const apAg = window.AP.apAging(bills, asOf);
    const tbl = (title, ag, rowsHtml, empty) =>
      '<div class="card" style="flex:1 1 420px"><div class="card-head"><h3>' + title + '</h3><span class="chip ' + (ag.overdue > 0 ? "chip-warn" : "chip-done") + '">' + money(ag.overdue) + " overdue</span></div>" +
      '<div class="tbl"><div class="tr th"><div class="td" style="flex:1 1 90px">Bucket</div><div class="td num" style="flex:1 1 70px">Count</div><div class="td num" style="flex:1 1 110px">Total</div></div>' +
      rowsHtml +
      '<div class="tr tot"><div class="td" style="flex:1 1 90px">Total</div><div class="td num" style="flex:1 1 70px">' + ag.buckets.reduce((s, b) => s + b.count, 0) + '</div><div class="td num" style="flex:1 1 110px">' + money(ag.total) + "</div></div></div>" +
      (ag.oldest ? '<div class="card-body small muted" style="padding:10px 14px">Oldest ' + (title.indexOf("Receivable") >= 0 ? "invoice" : "bill") + ": " + esc(ag.oldest.no) + " · " + ag.oldest.days + " day" + (ag.oldest.days === 1 ? "" : "s") + " past due</div>" : "") +
      "</div>";
    const arRows = arAg.buckets.map(b => '<div class="tr"><div class="td" style="flex:1 1 90px">' + esc(b.label) + '</div><div class="td num" style="flex:1 1 70px">' + b.count + '</div><div class="td num" style="flex:1 1 110px">' + money(b.total) + "</div></div>").join("");
    const apRows = apAg.buckets.map(b => '<div class="tr"><div class="td" style="flex:1 1 90px">' + esc(b.label) + '</div><div class="td num" style="flex:1 1 70px">' + b.count + '</div><div class="td num" style="flex:1 1 110px">' + money(b.total) + "</div></div>").join("");
    let html = asOfControl(asOf, v => renderAging(ctn, v)).outerHTML;
    html += '<div class="stat-grid" style="margin:16px 0">' +
      '<div class="stat-card card"><div class="stat-value">' + money(arAg.total) + '</div><div class="stat-label">Receivables outstanding</div><div class="stat-sub">' + arAg.buckets.reduce((s, b) => s + b.count, 0) + " open invoices</div></div>" +
      '<div class="stat-card card"><div class="stat-value">' + money(arAg.overdue) + '</div><div class="stat-label">Overdue receivables</div><div class="stat-sub">past due</div></div>' +
      '<div class="stat-card card"><div class="stat-value">' + money(apAg.total) + '</div><div class="stat-label">Payables outstanding</div><div class="stat-sub">' + apAg.buckets.reduce((s, b) => s + b.count, 0) + " open bills</div></div>" +
      '<div class="stat-card card"><div class="stat-value">' + money(apAg.overdue) + '</div><div class="stat-label">Overdue payables</div><div class="stat-sub">past due</div></div>' +
      "</div>";
    html += '<div class="row-flex" style="gap:16px;align-items:stretch;flex-wrap:wrap">' +
      tbl("Accounts receivable aging — " + esc(asOf), arAg, arRows, !invoices.length) +
      tbl("Accounts payable aging — " + esc(asOf), apAg, apRows, !bills.length) +
      "</div>";
    ctn.innerHTML = html;
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  async function render(ctn) {
    if (ctn._rptCleanup) ctn._rptCleanup();
    ctn.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 7 — Financial Reporting"));
    head.appendChild(FW.el("h1", null, null, { text: "Reports" }));
    head.appendChild(FW.el("p", "lede", "Profit & loss, balance sheet, cash flow and aging reports — every number read straight from the general ledger, for any date range."));
    ctn.appendChild(head);
    ctn.insertAdjacentHTML("beforeend", "<div class=\"ledger-tabs\" id=\"rptTabs\">" +
      '<button class="ledger-tab" data-tab="dash">Dashboard</button>' +
      '<button class="ledger-tab" data-tab="pl">P&amp;L</button>' +
      '<button class="ledger-tab" data-tab="bs">Balance Sheet</button>' +
      '<button class="ledger-tab" data-tab="cf">Cash Flow</button>' +
      '<button class="ledger-tab" data-tab="aging">Aging</button>' +
      "</div>" +
      '<div class="ledger-tab-ctn" id="rptTabCtn"></div>');
    const tabs = ctn.querySelectorAll(".ledger-tab");
    const body = ctn.querySelector("#rptTabCtn");
    async function show(name) {
      tabs.forEach(t => t.classList.toggle("active", t.getAttribute("data-tab") === name));
      if (name === "pl") renderPL(body, firstOfYear(), today());
      else if (name === "bs") renderBS(body, today());
      else if (name === "cf") renderCF(body, firstOfYear(), today());
      else if (name === "aging") renderAging(body, today());
      else renderDashboard(body);
    }
    const initial = (ctn._pendingTab) || "dash";
    delete ctn._pendingTab;
    show(initial);
    tabs.forEach(t => t.addEventListener("click", () => show(t.getAttribute("data-tab"))));
    const onGo = e => {
      const tab = (e.detail && e.detail.tab) || "";
      if (tab && [...tabs].some(t => t.getAttribute("data-tab") === tab)) show(tab);
    };
    document.addEventListener("ledger-go-report", onGo);
    ctn._rptCleanup = () => document.removeEventListener("ledger-go-report", onGo);
  }

  /* ── self-test ───────────────────────────────────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, ok: !!cond, extra: extra == null ? "" : String(extra) });
    const [accounts, entries] = await Promise.all([Ledger.loadAccounts(), Ledger.loadEntries()]);
    ok("Accounts load", accounts.length >= 20, accounts.length + " accounts");
    ok("Entries load", Array.isArray(entries));
    const tb = await balancesAsOf(entries, accounts, today());
    ok("balancesAsOf returns per-account map", tb && Object.keys(tb).length > 0);
    const tb2 = await balancesAsOf(entries, accounts, "2020-01-01");
    ok("balancesAsOf respects asOf (early date has no balances)", Object.keys(tb2).length > 0 && Object.keys(tb2).every(k => !tb2[k].balance), JSON.stringify(tb2).slice(0, 80));
    const delta = deltaBalances(tb, tb2);
    ok("deltaBalances produces numbers", Object.keys(delta).every(k => typeof delta[k] === "number"));
    ok("prevDay math", prevDay("2026-09-01") === "2026-08-31", prevDay("2026-09-01"));
    ok("firstOfYear is Jan 1", /-\d{2}-\d{2}$/.test(firstOfYear()) && firstOfYear().endsWith("-01-01"), firstOfYear());
    const pct = accounts.filter(a => a.type === "revenue").length > 0;
    ok("Revenue accounts present for P&L", pct);
    const cashAccs = accounts.filter(a => a.type === "asset" && String(a.code || "").startsWith("10"));
    ok("Cash accounts present for cash flow", cashAccs.length > 0, cashAccs.map(a => a.code).join(","));
    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  const X = {
    balancesAsOf, deltaBalances, renderDashboard, renderPL, renderBS, renderCF, renderAging,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.reports = X;
  window.Reports = X;
})();
