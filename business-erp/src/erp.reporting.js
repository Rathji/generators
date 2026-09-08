/* ============================================================
   BUSINESS ERP — dashboard & reporting (Tasks 33–36)
   Two controllers, one file:

   ERP.dashboard (Task 33) — a live "business at a glance" view
   computed from every module document: cash, receivables,
   payables, open orders & POs, revenue vs last month, stock
   value and low-stock alerts, top customers and a recent
   activity feed. Every KPI card deep-links into the module tab
   that owns the underlying data (e.g. #/finance:receivables).

   ERP.reports (Tasks 34–36) — the Reports module, hosting:
     · report library  (Task 34) — saved report definitions in
       the `reports` document; each runs against live data and
       exports to CSV or prints (print-friendly via #erpPrintArea)
     · CSV import      (Task 35) — parties / catalog / stock
       counts / opening balances, pasted or loaded from file,
       validated row-by-row, only valid rows applied
     · audit log       (Task 36) — read-only, searchable view of
       every master.audit() entry across all years
     · backup & restore (hosts ERP.backup.renderPanel)
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = ERP.store;
  const master = ERP.master;
  const ui = ERP.ui;
  const esc = ui.esc;

  const fin = () => ERP.finance;
  const sales = () => ERP.sales;
  const purch = () => ERP.purchasing;
  const inv = () => ERP.inventory;
  const proj = () => ERP.projects;

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const num = (v, def) => { const n = Number(v); return isFinite(n) ? n : def; };

  function validDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T12:00:00").getTime());
  }
  function parseBool(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    if (["", "1", "true", "yes", "y", "active"].indexOf(s) !== -1) return true;
    if (["0", "false", "no", "n", "inactive"].indexOf(s) !== -1) return false;
    return null;
  }
  function monthRange(ym) {
    const [y, m] = ym.split("-").map(Number);
    const first = y + "-" + String(m).padStart(2, "0") + "-01";
    const last = ui.addDays((m === 12 ? y + 1 : y) + "-" + String(m === 12 ? 1 : m + 1).padStart(2, "0") + "-01", -1);
    return { from: first, to: last };
  }
  function currentAndPrevMonth() {
    const now = ui.today().slice(0, 7);
    const [y, m] = now.split("-").map(Number);
    const prev = (m === 1 ? y - 1 : y) + "-" + String(m === 1 ? 12 : m - 1).padStart(2, "0");
    return { cur: now, prev, curRange: monthRange(now), prevRange: monthRange(prev) };
  }

  /* ─────────────────────────── dashboard (33) ─────────────────────────── */

  const D = (ERP.dashboard = {});

  /* Gather every number the dashboard shows. Pure read — nothing saved. */
  D.kpis = async function () {
    const f = fin(), s = sales(), p = purch(), i = inv();
    if (f) f.invalidate();
    if (s) s.invalidate();
    if (p) p.invalidate();
    if (i) i.invalidate();

    let cash = 0, arTotal = 0, arOverdue = 0, apTotal = 0, apOverdue = 0, arRows = [], apRows = [];
    let revenueThis = 0, revenueLast = 0;
    if (f) {
      const br = await f.bankRegister();
      cash = round2(br.balance);
      const ar = await f.receivableAging();
      arTotal = round2(ar.totals.total); arOverdue = round2(ar.totals.overdue); arRows = ar.rows;
      const ap = await f.payableAging();
      apTotal = round2(ap.totals.total); apOverdue = round2(ap.totals.overdue); apRows = ap.rows;
      const m = currentAndPrevMonth();
      const pl = await f.profitLoss({ from: m.curRange.from, to: m.curRange.to });
      const pl2 = await f.profitLoss({ from: m.prevRange.from, to: m.prevRange.to });
      revenueThis = round2(pl.totalIncome); revenueLast = round2(pl2.totalIncome);
    }

    const salesDocs = (await store.loadDoc("sales")).records || [];
    const orders = salesDocs.filter((r) => r.kind === "order");
    const openOrders = orders.filter((o) => ["open", "confirmed", "shipped"].indexOf(o.status) !== -1);
    const openOrderValue = round2(openOrders.reduce((x, o) => x + (Number(o.total) || 0), 0));
    const invoices = salesDocs.filter((r) => r.kind === "invoice");

    const purchDocs = (await store.loadDoc("purchasing")).records || [];
    const openPOs = purchDocs.filter((r) => r.kind === "po" && (r.status === "sent" || r.status === "partial"));
    const openPOValue = round2(openPOs.reduce((x, r) => x + (Number(r.total) || 0), 0));
    const openBills = purchDocs.filter((r) => r.kind === "bill" && (r.status === "open" || r.status === "partial"));
    const openBillValue = round2(openBills.reduce((x, r) => x + (Number(r.total) || 0), 0));

    const parties = await master.parties();
    const partyName = {};
    parties.forEach((x) => { partyName[String(x.id)] = x.name; });

    const byParty = {};
    invoices.forEach((invDoc) => {
      const k = String(invDoc.partyId);
      byParty[k] = (byParty[k] || 0) + (Number(invDoc.total) || 0);
    });
    const topCustomers = Object.keys(byParty)
      .map((k) => ({ id: k, name: partyName[k] || ("Party " + k), revenue: round2(byParty[k]) }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    let lowStock = [], stockValue = 0;
    if (i) {
      const stock = await i.stock();
      const stockMap = {};
      stock.forEach((r) => { stockMap[String(r.itemId)] = r; });
      const catalog = await master.catalog();
      lowStock = [];
      for (const c of catalog) {
        const rp = Number(c.reorderPoint) || 0;
        if (!(rp > 0)) continue;
        const row = stockMap[String(c.id)];
        const qty = row ? row.qty : 0;
        if (qty < rp) lowStock.push({ itemId: c.id, name: c.name, sku: c.sku || "", qty, reorderPoint: rp });
      }
      stockValue = round2(stock.reduce((x, r) => x + r.value, 0));
    }

    const audit = await master.auditLog({ all: true });
    const recent = audit.slice().sort((a, b) => String(b.ts || b.id).localeCompare(String(a.ts || a.id))).slice(0, 8);

    return {
      cash, arTotal, arOverdue, apTotal, apOverdue, arRows, apRows,
      revenueThis, revenueLast,
      openOrders: openOrders.length, openOrderValue,
      openPOs: openPOs.length, openPOValue,
      openBills: openBills.length, openBillValue,
      topCustomers, lowStock, stockValue, recent,
      partyName,
    };
  };

  D.renderPanel = async function (ctx) {
    const el = ctx.el;
    el.className = "erp-content";
    try {
      const k = await D.kpis();
      const cur = await master.currency();
      const money = (n) => ui.money(n, cur);
      const name = (id) => k.partyName[String(id)] || ("Party " + id);

      const alerts = [];
      k.arRows.filter((r) => r.days > 0).slice(0, 5).forEach((r) => {
        alerts.push({ cls: "warn", text: r.num + " · " + esc(name(r.partyId)) + " · " + money(r.open) + " (" + r.days + "d overdue)", href: "#/sales:invoices" });
      });
      k.apRows.filter((r) => r.days > 0).slice(0, 5).forEach((r) => {
        alerts.push({ cls: "warn", text: r.num + " · " + esc(name(r.supplierId)) + " · " + money(r.open) + " (" + r.days + "d overdue)", href: "#/purchasing:bills" });
      });
      k.lowStock.slice(0, 5).forEach((r) => {
        alerts.push({ cls: "warn", text: esc(r.name) + " is low (" + ui.qty(r.qty) + " of reorder point " + ui.qty(r.reorderPoint) + ")", href: "#/inventory:stock" });
      });
      const alertsHtml = alerts.length
        ? '<ul class="erp-alert-list">' + alerts.map((a) => '<li class="tone-' + a.cls + '"><a href="' + a.href + '">' + a.text + "</a></li>").join("") + "</ul>"
        : ui.alert("Nothing needs attention right now.", "success");

      const topHtml = k.topCustomers.length
        ? '<ul class="erp-dash-list">' + k.topCustomers.map((c) => '<li><span class="erp-dash-list-name">' + esc(c.name) + '</span><b>' + money(c.revenue) + "</b></li>").join("") + "</ul>"
        : '<p class="erp-sub">No invoiced revenue yet.</p>';

      const recentHtml = k.recent.length
        ? '<ul class="erp-dash-list">' + k.recent.map((e) => '<li><span class="erp-dash-list-name">' + esc(e.summary || e.action || "activity") + '</span><b>' + esc(ui.dateTime(e.ts || e.date)) + "</b></li>").join("") + "</ul>"
        : '<p class="erp-sub">No activity recorded yet.</p>';

      el.innerHTML =
        ui.pageHead("Dashboard", "Your business at a glance — every card links to the module behind it.", "") +
        '<div class="erp-kpi-grid">' +
        ui.statCard({ label: "Cash at bank", value: money(k.cash), href: "#/finance:bank", sub: "Bank register balance" }) +
        ui.statCard({ label: "Receivables", value: money(k.arTotal), href: "#/finance:receivables", sub: k.arRows.length + " open · " + money(k.arOverdue) + " overdue" }) +
        ui.statCard({ label: "Payables", value: money(k.apTotal), href: "#/finance:payables", sub: k.apRows.length + " open · " + money(k.apOverdue) + " overdue" }) +
        ui.statCard({ label: "Open orders", value: String(k.openOrders), href: "#/sales:orders", sub: money(k.openOrderValue) + " not yet invoiced" }) +
        ui.statCard({ label: "Open purchase orders", value: String(k.openPOs), href: "#/purchasing:pos", sub: money(k.openPOValue) + " awaiting receipt" }) +
        ui.statCard({ label: "Open bills", value: String(k.openBills), href: "#/purchasing:bills", sub: money(k.openBillValue) + " to pay" }) +
        ui.statCard({ label: "Revenue this month", value: money(k.revenueThis), href: "#/finance:reports", sub: "vs " + money(k.revenueLast) + " last month" }) +
        ui.statCard({ label: "Stock value", value: money(k.stockValue), href: "#/inventory:stock", sub: k.lowStock.length ? k.lowStock.length + " item(s) low" : "All levels healthy" }) +
        "</div>" +
        '<div class="erp-dash-cols">' +
        ui.card("Needs attention", alertsHtml) +
        ui.card("Top customers", topHtml) +
        "</div>" +
        ui.card("Recent activity", recentHtml);
    } catch (e) {
      console.error("dashboard render failed", e);
      ctx.error({ title: "Could not load the dashboard", message: (e && e.message) || String(e) });
    }
  };

  D.render = D.renderPanel;

  /* ─────────────────────────── reports module (34–36) ─────────────────────────── */

  const R = (ERP.reports = {});

  let rcache = null;
  R.records = async function () {
    if (rcache) return rcache;
    const r = await store.loadDoc("reports");
    rcache = r.records || [];
    return rcache;
  };
  R.invalidate = () => { rcache = null; };
  const rsave = async (list) => { rcache = list; await store.saveDoc("reports", list); };

  /* ── report library (34) ── */

  const DEFAULT_REPORTS = [
    { id: "salesByPeriod", title: "Sales by period", module: "sales", type: "salesByPeriod", desc: "Invoiced revenue, tax and invoice counts grouped by calendar month." },
    { id: "salesByCustomer", title: "Sales by customer", module: "sales", type: "salesByCustomer", desc: "Invoiced revenue per customer, largest first." },
    { id: "salesByProduct", title: "Sales by product", module: "sales", type: "salesByProduct", desc: "Quantity and revenue per catalog item from invoice lines." },
    { id: "purchasingSpend", title: "Purchasing spend", module: "purchasing", type: "purchasingSpend", desc: "Supplier bills grouped by supplier." },
    { id: "projectProfitability", title: "Project profitability", module: "projects", type: "projectProfitability", desc: "Budget, billed, cost and profit per project." },
    { id: "agedReceivables", title: "Aged receivables", module: "finance", type: "agedReceivables", desc: "Open customer invoices by age bucket." },
    { id: "inventoryValuation", title: "Inventory valuation", module: "inventory", type: "inventoryValuation", desc: "On-hand quantity, average cost and value per item." },
    { id: "taxSummary", title: "Tax summary", module: "finance", type: "taxSummary", desc: "Output VAT on sales vs input VAT on purchases per rate." },
  ];
  R.DEFAULT_REPORTS = DEFAULT_REPORTS;

  R.seedReports = async function () {
    const list = await R.records();
    if (!list.length) {
      await rsave(DEFAULT_REPORTS.map((d) => Object.assign({}, d, { created: new Date().toISOString() })));
    }
    return R.records();
  };

  function tableCols(columns) {
    return columns.map((c) => ({
      key: c.key,
      label: c.label,
      align: c.align,
      render: (r) => (c.format ? c.format(r[c.key], r) : esc(String(r[c.key] == null ? "" : r[c.key]))),
    }));
  }

  R.toCsv = function (columns, rows) {
    const escv = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [columns.map((c) => escv(c.label || c.key)).join(",")];
    for (const r of rows || []) {
      lines.push(columns.map((c) => escv(c.format ? c.format(r[c.key], r) : r[c.key])).join(","));
    }
    return lines.join("\r\n");
  };

  R.downloadCsv = function (filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  R.runReport = async function (def) {
    const type = def && (def.type || def.id);
    switch (type) {
      case "salesByPeriod": return reportSalesByPeriod();
      case "salesByCustomer": return reportSalesByCustomer();
      case "salesByProduct": return reportSalesByProduct();
      case "purchasingSpend": return reportPurchasingSpend();
      case "projectProfitability": return reportProjectProfitability();
      case "agedReceivables": return reportAgedReceivables();
      case "inventoryValuation": return reportInventoryValuation();
      case "taxSummary": return reportTaxSummary();
      default: throw new Error("Unknown report type: " + type);
    }
  };

  async function partyMap() {
    const parties = await master.parties();
    const m = {};
    parties.forEach((p) => { m[String(p.id)] = p.name; });
    return m;
  }

  async function reportSalesByPeriod() {
    const docs = (await store.loadDoc("sales")).records || [];
    const by = {};
    for (const invDoc of docs.filter((r) => r.kind === "invoice")) {
      const per = String(invDoc.date || "").slice(0, 7);
      if (!per) continue;
      by[per] = by[per] || { period: per, count: 0, revenue: 0, tax: 0 };
      by[per].count += 1;
      by[per].revenue += Number(invDoc.subtotal) || 0;
      by[per].tax += Number(invDoc.taxTotal) || 0;
    }
    const rows = Object.keys(by).sort().map((k) => ({ period: k, count: by[k].count, revenue: round2(by[k].revenue), tax: round2(by[k].tax) }));
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    return {
      title: "Sales by period",
      subtitle: "Invoiced revenue grouped by calendar month.",
      columns: [
        { key: "period", label: "Period" },
        { key: "count", label: "Invoices", align: "right", format: (v) => ui.fmt(v, 0) },
        { key: "revenue", label: "Revenue", align: "right", format: (v) => ui.money(v) },
        { key: "tax", label: "Tax", align: "right", format: (v) => ui.money(v) },
      ],
      rows, summary: [{ label: "Total revenue", value: ui.money(total) }],
    };
  }

  async function reportSalesByCustomer() {
    const docs = (await store.loadDoc("sales")).records || [];
    const names = await partyMap();
    const by = {};
    for (const invDoc of docs.filter((r) => r.kind === "invoice")) {
      const k = String(invDoc.partyId);
      by[k] = by[k] || { partyId: k, customer: names[k] || ("Party " + k), count: 0, revenue: 0 };
      by[k].count += 1;
      by[k].revenue += Number(invDoc.total) || 0;
    }
    const rows = Object.keys(by).map((k) => ({ partyId: by[k].partyId, customer: by[k].customer, count: by[k].count, revenue: round2(by[k].revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    return {
      title: "Sales by customer",
      subtitle: "Invoiced revenue per customer, largest first.",
      columns: [
        { key: "customer", label: "Customer" },
        { key: "count", label: "Invoices", align: "right", format: (v) => ui.fmt(v, 0) },
        { key: "revenue", label: "Revenue", align: "right", format: (v) => ui.money(v) },
      ],
      rows, summary: [{ label: "Total revenue", value: ui.money(total) }],
    };
  }

  async function reportSalesByProduct() {
    const docs = (await store.loadDoc("sales")).records || [];
    const catalog = await master.catalog();
    const cat = {};
    catalog.forEach((c) => { cat[String(c.id)] = c; });
    const by = {};
    for (const invDoc of docs.filter((r) => r.kind === "invoice")) {
      for (const l of invDoc.lines || []) {
        const key = String(l.itemId != null ? l.itemId : l.description);
        const c = l.itemId != null ? cat[String(l.itemId)] : null;
        by[key] = by[key] || { item: c ? c.name : (l.description || "Item " + key), sku: c ? c.sku : "", qty: 0, revenue: 0 };
        const qty = Number(l.qty) || 0;
        const unit = (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100);
        by[key].qty += qty;
        by[key].revenue += qty * unit;
      }
    }
    const rows = Object.keys(by).map((k) => ({ item: by[k].item, sku: by[k].sku, qty: round2(by[k].qty), revenue: round2(by[k].revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    return {
      title: "Sales by product",
      subtitle: "Quantity and revenue per item from invoice lines.",
      columns: [
        { key: "item", label: "Item" },
        { key: "sku", label: "SKU" },
        { key: "qty", label: "Quantity", align: "right", format: (v) => ui.qty(v) },
        { key: "revenue", label: "Revenue", align: "right", format: (v) => ui.money(v) },
      ],
      rows,
    };
  }

  async function reportPurchasingSpend() {
    const docs = (await store.loadDoc("purchasing")).records || [];
    const names = await partyMap();
    const by = {};
    for (const b of docs.filter((r) => r.kind === "bill")) {
      const k = String(b.supplierId);
      by[k] = by[k] || { supplierId: k, supplier: names[k] || ("Party " + k), count: 0, spend: 0 };
      by[k].count += 1;
      by[k].spend += Number(b.total) || 0;
    }
    const rows = Object.keys(by).map((k) => ({ supplier: by[k].supplier, count: by[k].count, spend: round2(by[k].spend) }))
      .sort((a, b) => b.spend - a.spend);
    const total = rows.reduce((s, r) => s + r.spend, 0);
    return {
      title: "Purchasing spend",
      subtitle: "Supplier bills grouped by supplier.",
      columns: [
        { key: "supplier", label: "Supplier" },
        { key: "count", label: "Bills", align: "right", format: (v) => ui.fmt(v, 0) },
        { key: "spend", label: "Spend", align: "right", format: (v) => ui.money(v) },
      ],
      rows, summary: [{ label: "Total spend", value: ui.money(total) }],
    };
  }

  async function reportProjectProfitability() {
    const p = proj();
    if (!p) return { title: "Project profitability", columns: [], rows: [] };
    const docs = (await store.loadDoc("projects")).records || [];
    const projects = docs.filter((r) => r.kind === "project");
    const rows = [];
    for (const pr of projects) {
      let m;
      try { m = await p.projectMetrics(pr); } catch (e) { continue; }
      rows.push({ project: pr.title, budget: m.budget, billed: m.billed, cost: m.cost, profit: m.profit });
    }
    rows.sort((a, b) => a.project.localeCompare(b.project));
    return {
      title: "Project profitability",
      subtitle: "Budget, billed, cost and profit per project.",
      columns: [
        { key: "project", label: "Project" },
        { key: "budget", label: "Budget", align: "right", format: (v) => ui.money(v) },
        { key: "billed", label: "Billed", align: "right", format: (v) => ui.money(v) },
        { key: "cost", label: "Cost", align: "right", format: (v) => ui.money(v) },
        { key: "profit", label: "Profit", align: "right", format: (v) => ui.money(v) },
      ],
      rows,
    };
  }

  async function reportAgedReceivables() {
    const f = fin();
    const empty = { title: "Aged receivables", subtitle: "Open customer invoices by age bucket.", columns: [
      { key: "num", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "dueDate", label: "Due" },
      { key: "days", label: "Days", align: "right" }, { key: "bucket", label: "Bucket" }, { key: "open", label: "Open", align: "right", format: (v) => ui.money(v) },
    ], rows: [], summary: [] };
    if (!f) return empty;
    const ag = await f.receivableAging();
    const names = await partyMap();
    const rows = ag.rows.map((r) => ({ num: r.num, customer: names[r.partyId] || ("Party " + r.partyId), dueDate: ui.date(r.dueDate), days: r.days, bucket: r.bucket.label, open: r.open }));
    return Object.assign(empty, {
      rows,
      summary: [
        { label: "Total open", value: ui.money(ag.totals.total) },
        { label: "Overdue", value: ui.money(ag.totals.overdue) },
      ],
    });
  }

  async function reportInventoryValuation() {
    const i = inv();
    const empty = { title: "Inventory valuation", subtitle: "On-hand quantity, average cost and value per item.", columns: [
      { key: "item", label: "Item" }, { key: "sku", label: "SKU" }, { key: "qty", label: "Qty", align: "right" },
      { key: "avgCost", label: "Avg cost", align: "right" }, { key: "value", label: "Value", align: "right" },
    ], rows: [], summary: [] };
    if (!i) return empty;
    const v = await i.valuation();
    const rows = v.rows.map((r) => ({ item: r.name, sku: r.sku, qty: r.qty, avgCost: r.avgCost, value: r.value }));
    return Object.assign(empty, {
      rows,
      summary: [
        { label: "Total value", value: ui.money(v.totalValue) },
        { label: "Total qty", value: ui.qty(v.totalQty) },
      ],
    });
  }

  function lineTax(l, priceField) {
    const qty = Number(l.qty) || 0;
    const unit = Number(l[priceField]) || 0;
    const disc = Number(l.discountPct) || 0;
    const rate = Number(l.taxRate) || 0;
    return round2(qty * unit * (1 - disc / 100) * rate / 100);
  }

  async function reportTaxSummary() {
    const salesDocs = (await store.loadDoc("sales")).records || [];
    const purchDocs = (await store.loadDoc("purchasing")).records || [];
    const by = {};
    const acc = (code) => { code = String(code || "NONE").toUpperCase(); by[code] = by[code] || { taxCode: code, rate: 0, salesTax: 0, purchTax: 0 }; return by[code]; };
    for (const invDoc of salesDocs.filter((r) => r.kind === "invoice")) {
      for (const l of invDoc.lines || []) {
        const r = acc(l.taxCode);
        r.rate = Number(l.taxRate) || r.rate;
        r.salesTax += lineTax(l, "unitPrice");
      }
    }
    for (const b of purchDocs.filter((r) => r.kind === "bill")) {
      for (const l of b.lines || []) {
        const r = acc(l.taxCode);
        r.rate = Number(l.taxRate) || r.rate;
        r.purchTax += lineTax(l, "unitCost");
      }
    }
    const rows = Object.keys(by).sort().map((k) => ({
      taxCode: by[k].taxCode,
      rate: by[k].rate,
      salesTax: round2(by[k].salesTax),
      purchTax: round2(by[k].purchTax),
      net: round2(by[k].salesTax - by[k].purchTax),
    }));
    const netTotal = rows.reduce((s, r) => s + r.net, 0);
    return {
      title: "Tax summary",
      subtitle: "Output VAT on sales vs input VAT on purchases, per rate.",
      columns: [
        { key: "taxCode", label: "Tax code" },
        { key: "rate", label: "Rate %", align: "right", format: (v) => ui.pct(v) },
        { key: "salesTax", label: "Output VAT", align: "right", format: (v) => ui.money(v) },
        { key: "purchTax", label: "Input VAT", align: "right", format: (v) => ui.money(v) },
        { key: "net", label: "Net", align: "right", format: (v) => ui.money(v) },
      ],
      rows, summary: [{ label: "Net VAT due", value: ui.money(netTotal) }],
    };
  }

  /* ── CSV import (35) ── */

  const IMPORT_KINDS = {
    parties: {
      label: "Parties (customers & suppliers)",
      columns: ["name", "type", "taxId", "paymentTerms", "creditLimit", "email", "phone", "contactName", "active"],
      sample: "name,type,taxId,paymentTerms,creditLimit,email,phone,active\nNewco Ltd,customer,TX-9,net30,1000,hello@newco.com,+1 555 0100,true\nGlobal Supplies,supplier,TX-77,net60,0,orders@globalsupplies.io,+1 555 0142,true",
    },
    catalog: {
      label: "Catalog items",
      columns: ["name", "sku", "type", "uom", "salePrice", "cost", "reorderPoint", "taxCode", "supplierName", "active"],
      sample: "name,sku,type,uom,salePrice,cost,reorderPoint,taxCode,supplierName,active\nPremium Widget,PW-1,product,ea,120,48,20,VAT20,Global Supplies,true\nAdvisory,ADV-1,service,hr,200,0,0,VAT0,,true",
    },
    "stock-counts": {
      label: "Stock counts (opening stock per item)",
      columns: ["sku", "itemName", "location", "qty", "unitCost", "date"],
      sample: "sku,itemName,location,qty,unitCost,date\nPW-1,,Main,150,45,2026-09-01",
    },
    "opening-balances": {
      label: "Opening balances (account entries)",
      columns: ["account", "debit", "credit", "date", "memo"],
      sample: "account,debit,credit,date,memo\n1000,5000,0,2026-09-01,Opening bank\n3000,0,5000,2026-09-01,Opening equity",
    },
  };
  R.IMPORT_KINDS = IMPORT_KINDS;

  R.parseCsv = function (text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    const t = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (inQ) {
        if (c === '"') {
          if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows.map((r) => r.map((f) => String(f).trim()));
  };

  R.csvToObjects = function (kind, text) {
    const spec = IMPORT_KINDS[kind];
    if (!spec) throw new Error("Unknown import kind: " + kind);
    const columns = spec.columns;
    const parsed = R.parseCsv(text);
    const alias = (c) => String(c).replace(/[\s_-]+/g, "").toLowerCase();
    const known = new Set(columns.map(alias));
    let header = false, colIndex = null;
    if (parsed.length) {
      const matched = parsed[0].filter((c) => known.has(alias(c))).length;
      header = matched >= Math.min(2, columns.length);
      if (header) {
        colIndex = {};
        parsed[0].forEach((c, i) => {
          const a = alias(c);
          if (known.has(a)) colIndex[columns.find((x) => alias(x) === a)] = i;
        });
      }
    }
    const objects = [];
    const rows = header ? parsed.slice(1) : parsed;
    rows.forEach((cells, i) => {
      const obj = { _row: (header ? 2 : 1) + i, _raw: cells };
      if (header) {
        for (const c of columns) {
          if (colIndex[c] !== undefined) obj[c] = cells[colIndex[c]];
        }
      } else {
        columns.forEach((c, j) => { obj[c] = cells[j]; });
      }
      const hasAny = columns.some((c) => obj[c] != null && String(obj[c]).trim() !== "");
      if (hasAny) objects.push(obj);
    });
    return { header, columns, objects };
  };

  async function importCtx(kind) {
    if (kind === "parties") {
      const parties = await master.parties();
      const partyKey = new Set(parties.map((p) => String(p.name).toLowerCase() + "|" + String(p.type).toLowerCase()));
      return { partyKey };
    }
    if (kind === "catalog") {
      const catalog = await master.catalog();
      const catalogSkus = new Set(catalog.map((c) => String(c.sku || "").toLowerCase()));
      const taxes = await master.taxes();
      const taxCodes = new Set(taxes.map((t) => String(t.code).toUpperCase()));
      const parties = await master.parties();
      const suppliers = new Map();
      parties.filter((p) => p.type === "supplier" || p.type === "both").forEach((p) => suppliers.set(String(p.name).toLowerCase(), p));
      return { catalogSkus, taxCodes, suppliers };
    }
    if (kind === "stock-counts") {
      const catalog = await master.catalog();
      const catalogBySku = new Map(), catalogByName = new Map();
      catalog.forEach((c) => {
        if (c.sku) catalogBySku.set(String(c.sku).toLowerCase(), c);
        catalogByName.set(String(c.name).toLowerCase(), c);
      });
      return { catalogBySku, catalogByName };
    }
    if (kind === "opening-balances") {
      const chart = await master.chart();
      return { chart: new Set(chart.map((a) => String(a.code))) };
    }
    return {};
  }

  function validateRow(kind, obj, ctx) {
    const msg = (m) => ({ ok: false, message: m, data: null });
    try {
      if (kind === "parties") {
        const name = String(obj.name || "").trim();
        if (!name) return msg("Name is required");
        const type = String(obj.type || "customer").trim().toLowerCase();
        if (type !== "customer" && type !== "supplier" && type !== "both") return msg("Type must be customer, supplier or both");
        const key = name.toLowerCase() + "|" + type;
        if (ctx.partyKey.has(key)) return msg("Party already exists");
        const cl = obj.creditLimit === "" || obj.creditLimit == null ? 0 : Number(obj.creditLimit);
        if (!isFinite(cl) || cl < 0) return msg("Credit limit must be a number ≥ 0");
        const active = parseBool(obj.active);
        if (active === null) return msg("active must be true or false");
        ctx.partyKey.add(key);
        return { ok: true, message: "", data: { name, type, taxId: String(obj.taxId || "").trim(), paymentTerms: String(obj.paymentTerms || "net30").trim(), creditLimit: cl, email: String(obj.email || "").trim(), phone: String(obj.phone || "").trim(), contactName: String(obj.contactName || "").trim(), active } };
      }
      if (kind === "catalog") {
        const name = String(obj.name || "").trim();
        if (!name) return msg("Name is required");
        const type = String(obj.type || "product").trim().toLowerCase();
        if (type !== "product" && type !== "service") return msg("Type must be product or service");
        const sku = String(obj.sku || "").trim();
        const skuKey = sku.toLowerCase();
        if (sku && ctx.catalogSkus.has(skuKey)) return msg("SKU already exists");
        const salePrice = num(obj.salePrice, 0), cost = num(obj.cost, 0), rp = num(obj.reorderPoint, 0);
        if (salePrice < 0 || cost < 0 || rp < 0) return msg("Prices must be ≥ 0");
        const taxCode = String(obj.taxCode || "NONE").trim().toUpperCase();
        if (!ctx.taxCodes.has(taxCode)) return msg("Unknown tax code " + taxCode);
        const active = parseBool(obj.active);
        if (active === null) return msg("active must be true or false");
        let supplierId = null;
        if (obj.supplierName != null && String(obj.supplierName).trim() !== "") {
          const s = ctx.suppliers.get(String(obj.supplierName).trim().toLowerCase());
          if (!s) return msg("Unknown supplier '" + String(obj.supplierName).trim() + "'");
          supplierId = s.id;
        }
        if (sku) ctx.catalogSkus.add(skuKey);
        return { ok: true, message: "", data: { name, sku, type, uom: String(obj.uom || "ea").trim(), salePrice, cost, reorderPoint: rp, taxCode, active, supplierId } };
      }
      if (kind === "stock-counts") {
        const sku = String(obj.sku || "").trim().toLowerCase();
        const name = String(obj.itemName || "").trim().toLowerCase();
        let item = sku ? ctx.catalogBySku.get(sku) : null;
        if (!item && name) item = ctx.catalogByName.get(name);
        if (!item) return msg("Unknown item (match by SKU or item name)");
        const qty = Number(obj.qty);
        if (!isFinite(qty) || !(qty > 0)) return msg("Quantity must be a positive number");
        const unitCost = num(obj.unitCost, 0);
        if (unitCost < 0) return msg("Unit cost must be ≥ 0");
        const location = String(obj.location || "Main").trim() || "Main";
        const date = String(obj.date || "").trim() || ui.today();
        if (!validDate(date)) return msg("Date must be YYYY-MM-DD");
        return { ok: true, message: "", data: { itemId: item.id, qty, unitCost, location, date } };
      }
      if (kind === "opening-balances") {
        const account = String(obj.account || "").trim();
        if (!account) return msg("Account is required");
        if (!ctx.chart.has(account)) return msg("Unknown account " + account);
        const d = obj.debit === "" || obj.debit == null ? 0 : Number(obj.debit);
        const c = obj.credit === "" || obj.credit == null ? 0 : Number(obj.credit);
        if (!isFinite(d) || !isFinite(c) || d < 0 || c < 0) return msg("Debit/credit must be numbers ≥ 0");
        if (d === 0 && c === 0) return msg("Enter a debit or credit");
        if (d > 0 && c > 0) return msg("Row has both debit and credit");
        const date = String(obj.date || "").trim() || ui.today();
        if (!validDate(date)) return msg("Date must be YYYY-MM-DD");
        return { ok: true, message: "", data: { account, debit: d, credit: c, date } };
      }
      return msg("Unknown import kind");
    } catch (e) {
      return msg((e && e.message) || String(e));
    }
  }

  function displayOf(kind, obj) {
    const cols = IMPORT_KINDS[kind].columns;
    const parts = [];
    for (const c of cols) {
      if (obj[c] != null && String(obj[c]).trim() !== "") parts.push(String(obj[c]).trim());
    }
    return parts.slice(0, 4).join(", ");
  }

  /* Validate every row (no writes). */
  R.prepareImport = async function (kind, text) {
    const spec = IMPORT_KINDS[kind];
    if (!spec) throw new Error("Unknown import kind: " + kind);
    const parsed = R.csvToObjects(kind, text);
    const ctx = await importCtx(kind);
    const items = parsed.objects.map((obj) => {
      const v = validateRow(kind, obj, ctx);
      return { rowNo: obj._row, ok: v.ok, message: v.message || "", data: v.data || null, display: displayOf(kind, obj) };
    });
    return { kind, header: parsed.header, items, ctx };
  };

  /* Apply the valid rows from a prepared import (writes + audit). */
  R.applyImport = async function (kind, items, ctx) {
    const valid = items.filter((i) => i.ok && i.data).map((i) => i.data);
    if (!ctx) ctx = await importCtx(kind);
    let created = 0;
    if (kind === "parties") {
      const parties = await master.parties();
      let id = parties.length ? Math.max.apply(null, parties.map((p) => Number(p.id) || 0)) + 1 : 1;
      for (const d of valid) {
        parties.push({ id: id++, name: d.name, type: d.type, taxId: d.taxId, paymentTerms: d.paymentTerms, creditLimit: d.creditLimit, email: d.email, phone: d.phone, contactName: d.contactName, active: d.active, contacts: [], addresses: [], source: "csv" });
        created += 1;
      }
      await master.saveParties(parties);
    } else if (kind === "catalog") {
      const catalog = await master.catalog();
      let id = catalog.length ? Math.max.apply(null, catalog.map((c) => Number(c.id) || 0)) + 1 : 1;
      for (const d of valid) {
        catalog.push({ id: id++, name: d.name, sku: d.sku, type: d.type, uom: d.uom, salePrice: d.salePrice, cost: d.cost, reorderPoint: d.reorderPoint, taxCode: d.taxCode, active: d.active, supplierId: d.supplierId, source: "csv" });
        created += 1;
      }
      await master.saveCatalog(catalog);
    } else if (kind === "stock-counts") {
      for (const d of valid) {
        await inv().postOpening({ itemId: d.itemId, qty: d.qty, unitCost: d.unitCost, location: d.location, date: d.date });
        created += 1;
      }
      inv().invalidate();
    } else if (kind === "opening-balances") {
      if (valid.length) {
        const lines = valid.map((d) => ({ account: d.account, debit: d.debit, credit: d.credit }));
        try {
          await fin().postJournal({ date: valid[0].date, memo: "Opening balances (CSV import)", source: "opening", lines });
          created = valid.length;
        } catch (e) {
          return { created: 0, skipped: items.length, fatal: (e && e.message) || String(e), errors: items.filter((i) => !i.ok), kind };
        }
      }
    }
    const skipped = items.length - created;
    await master.audit({ action: "csv_import", targetType: "csv:" + kind, targetId: null, summary: "Imported " + created + " row(s) from CSV (" + kind + "), " + skipped + " skipped." });
    return { created, skipped, errors: items.filter((i) => !i.ok), kind };
  };

  /* ── reports module UI ── */

  R.renderPanel = async function (ctx) {
    const el = ctx.el;
    el.className = "erp-content";
    let defs;
    try {
      defs = await R.seedReports();
    } catch (e) {
      ctx.error({ title: "Could not load the report library", message: (e && e.message) || String(e) });
      return;
    }
    let auditCount = 0;
    try { auditCount = (await master.auditLog({ all: true })).length; } catch (e) {}
    const tabDefs = [
      { id: "reports", label: "Report library", badge: String(defs.length) },
      { id: "import", label: "CSV import" },
      { id: "audit", label: "Audit log", badge: auditCount ? String(auditCount) : undefined },
      { id: "backup", label: "Backup & restore" },
      { id: "team", label: "Team & access" },
      { id: "health", label: "System health" },
    ];
    const active = el.__tab || "reports";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML = ui.pageHead("Reports", "Saved reports, CSV import, the audit log and data utilities.", "") + t.html;

    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => { panels[p.getAttribute("data-panel")] = p; });
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));

    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });

    const refresh = async () => { await renderPanel(el.__tab || "reports"); };

    const renderPanel = async (id) => {
      const holder = panels[id];
      if (!holder) return;
      const p = document.createElement("div");
      p.className = "erp-tab-panel" + (id === active ? " active" : "");
      p.setAttribute("data-panel", id);
      holder.replaceWith(p);
      panels[id] = p;
      if (id === "reports") await renderReports(p, refresh);
      else if (id === "import") await renderImport(p, refresh);
      else if (id === "audit") await renderAudit(p, refresh);
      else if (id === "backup") await backupPanel(p, refresh);
      else if (id === "team") await (window.ERP.team.renderTeam(p, refresh));
      else if (id === "health") await (window.ERP.quality.renderHealth(p, refresh));
    };

    await renderPanel(active);
  };

  R.render = R.renderPanel;

  async function renderReports(p, refresh) {
    const defs = await R.records();
    const groups = {};
    defs.forEach((d) => { (groups[d.module] = groups[d.module] || []).push(d); });
    const cards = defs.map((d) =>
      '<div class="erp-report-card">' +
      '<div class="erp-report-card-head"><h4>' + esc(d.title) + "</h4>" + ui.badge(d.module, "info") + "</div>" +
      '<p class="erp-sub">' + esc(d.desc || "") + "</p>" +
      '<div class="erp-btn-row">' +
      ui.btn("Run", { small: true, primary: true, act: "rep-run", arg: d.id }) +
      ui.btn("Export CSV", { small: true, act: "rep-csv", arg: d.id }) +
      ui.btn("Print", { small: true, act: "rep-print", arg: d.id }) +
      "</div></div>"
    ).join("");
    p.innerHTML = ui.pageHead("Report library", "Each report runs against the current data. Export to CSV or print the result.", "") +
      (defs.length ? '<div class="erp-report-grid">' + cards + "</div>" : ui.alert("No report definitions yet.", "warn"));

    ui.bind(p, "click", "[data-act=rep-run]", async (t, e, act, arg) => {
      const def = defs.find((x) => String(x.id) === String(arg));
      if (!def) return;
      await runReportModal(def);
    });
    ui.bind(p, "click", "[data-act=rep-csv]", async (t, e, act, arg) => {
      const def = defs.find((x) => String(x.id) === String(arg));
      if (!def) return;
      const rep = await R.runReport(def);
      R.downloadCsv(def.id + ".csv", R.toCsv(rep.columns, rep.rows));
      ERP.toast("Downloaded " + def.id + ".csv (" + rep.rows.length + " rows).", "success");
    });
    ui.bind(p, "click", "[data-act=rep-print]", async (t, e, act, arg) => {
      const def = defs.find((x) => String(x.id) === String(arg));
      if (!def) return;
      await runReportModal(def, true);
    });
  }

  async function runReportModal(def, printNow) {
    const rep = await R.runReport(def);
    const tableHtml = ui.table(tableCols(rep.columns), rep.rows, { emptyText: "No rows for this report." });
    const summaryHtml = rep.summary && rep.summary.length ? ui.summary(rep.summary) : "";
    const modal = ui.modal({
      title: rep.title,
      size: "lg",
      body:
        '<div id="erpPrintArea">' +
        "<h2>" + esc(rep.title) + "</h2>" +
        (rep.subtitle ? '<p class="erp-sub">' + esc(rep.subtitle) + "</p>" : "") +
        tableHtml +
        "</div>" +
        summaryHtml,
      foot:
        ui.btn("Export CSV", { small: true, primary: true, act: "rr-csv" }) +
        " " + ui.btn("Print", { small: true, act: "rr-print" }) +
        " " + ui.btn("Close", { small: true, act: "rr-close" }),
    });
    ui.bind(modal, "click", "[data-act=rr-csv]", () => {
      R.downloadCsv(def.id + ".csv", R.toCsv(rep.columns, rep.rows));
      ERP.toast("Downloaded " + def.id + ".csv.", "success");
    });
    ui.bind(modal, "click", "[data-act=rr-print]", () => window.print());
    ui.bind(modal, "click", "[data-act=rr-close]", () => ui.closeModal());
    if (printNow) window.print();
  }

  async function renderImport(p, refresh) {
    p.innerHTML =
      ui.pageHead("Import data from CSV", "Paste a CSV below (or load a file), preview it row-by-row, then import only the valid rows.", "") +
      ui.card("1 · What are you importing?", ui.select("impKind", "Data type",
        Object.keys(IMPORT_KINDS).map((k) => ({ value: k, label: IMPORT_KINDS[k].label })), "parties"), "") +
      ui.card("2 · CSV content", "" +
        '<textarea class="erp-csv-input" data-imp-csv rows="8" placeholder="Paste CSV here…"></textarea>' +
        '<div class="erp-btn-row">' +
        ui.btn("Load file…", { small: true, act: "imp-file" }) +
        ui.btn("Load sample", { small: true, act: "imp-sample" }) +
        ui.btn("Preview", { small: true, primary: true, act: "imp-preview" }) +
        "</div>") +
      '<div class="erp-import-out" data-imp-out></div>' +
      '<input type="file" accept=".csv,text/csv" data-imp-file hidden>';

    p.__imp = null;

    ui.bind(p, "click", "[data-act=imp-file]", () => { p.querySelector("[data-imp-file]").click(); });
    ui.bind(p, "change", "[data-imp-file]", (t) => {
      const file = t.files && t.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { p.querySelector("[data-imp-csv]").value = String(rd.result || ""); };
      rd.readAsText(file);
    });
    ui.bind(p, "click", "[data-act=imp-sample]", () => {
      const kind = p.querySelector('[name="impKind"]').value;
      p.querySelector("[data-imp-csv]").value = IMPORT_KINDS[kind].sample;
    });
    ui.bind(p, "click", "[data-act=imp-preview]", async () => {
      const kind = p.querySelector('[name="impKind"]').value;
      const text = p.querySelector("[data-imp-csv]").value;
      const out = p.querySelector("[data-imp-out]");
      if (!text.trim()) { out.innerHTML = ui.alert("Paste some CSV first.", "warn"); return; }
      let res;
      try {
        res = await R.prepareImport(kind, text);
      } catch (e) {
        out.innerHTML = ui.alert((e && e.message) || String(e), "error");
        return;
      }
      p.__imp = res;
      renderImportPreview(p);
    });
    ui.bind(p, "click", "[data-act=imp-apply]", async () => {
      const res = p.__imp;
      if (!res) return;
      const t = p.querySelector("[data-act=imp-apply]");
      t.disabled = true;
      const result = await R.applyImport(res.kind, res.items, res.ctx);
      renderImportResult(p, result);
      t.disabled = false;
      refresh();
    });
  }

  function renderImportPreview(p) {
    const res = p.__imp;
    const out = p.querySelector("[data-imp-out]");
    const valid = res.items.filter((i) => i.ok).length;
    const invalid = res.items.length - valid;
    const rows = res.items.map((i) => ({
      rowNo: i.rowNo,
      status: i.ok ? ui.badge("OK", "success") : ui.badge("Error", "danger"),
      display: esc(i.display),
      message: esc(i.message || ""),
    }));
    out.innerHTML =
      ui.summary([
        { label: "Rows", value: String(res.items.length) },
        { label: "Valid", value: String(valid) },
        { label: "Errors", value: String(invalid) },
      ]) +
      (res.items.length ? ui.table([
        { key: "rowNo", label: "Row", width: "60px" },
        { key: "status", label: "Status" },
        { key: "display", label: "Values" },
        { key: "message", label: "Message" },
      ], rows, { scroll: true, emptyText: "No rows parsed." }) : "") +
      (valid ? '<div class="erp-btn-row"><button class="btn btn-primary" data-act="imp-apply">Import ' + valid + " row" + (valid === 1 ? "" : "s") + "</button></div>" : "");
  }

  function renderImportResult(p, result) {
    const out = p.querySelector("[data-imp-out]");
    const head = result.fatal
      ? ui.alert("Import blocked: " + esc(result.fatal), "error")
      : ui.alert("Imported " + result.created + " row(s), " + result.skipped + " skipped.", result.created ? "success" : "warn");
    const errRows = (result.errors || []).map((i) => ({ rowNo: i.rowNo, display: esc(i.display), message: esc(i.message) }));
    out.innerHTML = head + (errRows.length
      ? ui.card("Skipped rows", ui.table([{ key: "rowNo", label: "Row", width: "60px" }, { key: "display", label: "Values" }, { key: "message", label: "Why" }], errRows, { scroll: true }))
      : "");
  }

  /* Filter audit entries by a free-text query (summary/actor/action/target). */
  R.filterAudit = function (list, q) {
    const ql = (q || "").toLowerCase().trim();
    if (!ql) return list;
    return list.filter((e) =>
      String(e.summary || "").toLowerCase().indexOf(ql) !== -1 ||
      String(e.actor || "").toLowerCase().indexOf(ql) !== -1 ||
      String(e.action || "").toLowerCase().indexOf(ql) !== -1 ||
      String(e.targetType || "").toLowerCase().indexOf(ql) !== -1 ||
      String(e.targetId == null ? "" : e.targetId).toLowerCase().indexOf(ql) !== -1);
  };

  function auditTable(list, q) {
    const filtered = R.filterAudit(list, q);
    return ui.table([
      { key: "when", label: "When", render: (r) => esc(ui.dateTime(r.ts || r.date)) },
      { key: "actor", label: "Actor", render: (r) => ui.badge(r.actor || "owner", "muted") },
      { key: "action", label: "Action", render: (r) => esc(r.action || "") },
      { key: "target", label: "Target", render: (r) => esc(String(r.targetType || "") + (r.targetId != null ? " · " + r.targetId : "")) },
      { key: "summary", label: "Summary" },
    ], filtered, { scroll: true, emptyText: (q || "").trim() ? "No matching entries." : "No audit entries yet." });
  }

  async function renderAudit(p, refresh) {
    let list = [];
    try { list = await master.auditLog({ all: true }); } catch (e) {}
    list = list.slice().sort((a, b) => String(b.ts || b.id).localeCompare(String(a.ts || a.id)));
    const counts = {};
    list.forEach((e) => { counts[e.action] = (counts[e.action] || 0) + 1; });
    const countItems = Object.keys(counts).slice(0, 6).map((k) => ({ label: k, value: String(counts[k]) }));
    p.innerHTML =
      ui.pageHead("Audit log", "Every state-changing action recorded across all years. Read-only.", "") +
      ui.summary([{ label: "Entries", value: String(list.length) }].concat(countItems)) +
      '<div class="erp-toolbar"><input type="search" placeholder="Filter by summary, actor, action or target…" data-au-q value="' + esc(p.__q || "") + '"></div>' +
      '<div data-au-list>' + auditTable(list, p.__q) + "</div>";
    if (!p.__auBound) {
      p.__auBound = true;
      ui.bind(p, "input", "[data-au-q]", (t) => { p.__q = t.value; renderAudit(p, refresh); });
    }
  }

  async function backupPanel(p, refresh) {
    const backup = ERP.backup;
    if (backup && typeof backup.renderPanel === "function") {
      await backup.renderPanel(p);
    } else {
      p.innerHTML = ui.alert("The backup module failed to load.", "error");
    }
  }
})();
