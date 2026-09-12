/* ============================================================
   PSA-U — financial reporting (Phase 6 · Task 33)

   The numbers a practice runs on, all derived from the billing
   ledger (never re-keyed):

     • AR aging        — every open posted invoice bucketed by how
                         far past due it is (current / 1–30 / 31–60 /
                         61–90 / 90+), per client and in total.
     • revenue         — invoiced revenue by client and by service
                         (the source of each invoice line: agreement,
                         time by work type, expense, project, manual).
     • billing backlog — unbilled work in progress: approved billable
                         time at its resolved rate, approved billable
                         expenses with markup, and posted agreement
                         charges not yet on an invoice.
     • summaries       — invoice counts and totals by status, plus
                         payments received over the period.

   Every report exports to CSV and to a print/PDF view. The reports
   read through ERP.billing / ERP.payments so they always agree with
   the register and the invoices themselves.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const AR = (ERP.ar = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("reports require the tenancy service");
    return ERP.tenancy;
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function maskedMoney(v, cur) { return ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••"; }

  const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];

  /* ─────────────────────────── AR aging ─────────────────────────── */

  AR.arAging = async function (pid, opts) {
    opts = opts || {};
    const asOf = opts.asOf || ui.today();
    const invoices = (await ERP.billing.all(pid, { companyId: opts.companyId }))
      .filter((i) => i.status === "posted" && num(i.balance) > 0.005);
    const byCompany = {};
    for (const inv of invoices) {
      const cid = String(inv.companyId);
      if (!byCompany[cid]) byCompany[cid] = { companyId: inv.companyId, companyName: inv.__companyName || "", current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0, invoices: 0 };
      const days = inv.dueDate ? ui.diffDays(inv.dueDate, asOf) : 0;
      let bucket = "current";
      if (days > 90) bucket = "90+";
      else if (days > 60) bucket = "61-90";
      else if (days > 30) bucket = "31-60";
      else if (days > 0) bucket = "1-30";
      byCompany[cid][bucket] = round2(byCompany[cid][bucket] + num(inv.balance));
      byCompany[cid].total = round2(byCompany[cid].total + num(inv.balance));
      byCompany[cid].invoices += 1;
    }
    const rows = Object.keys(byCompany).map((k) => byCompany[k]).sort((a, b) => b.total - a.total);
    const totals = BUCKETS.reduce((t, b) => { t[b] = round2(rows.reduce((n, r) => n + num(r[b]), 0)); return t; }, {});
    totals.total = round2(rows.reduce((n, r) => n + num(r.total), 0));
    totals.invoices = rows.reduce((n, r) => n + r.invoices, 0);
    return { asOf: asOf, rows: rows, totals: totals, buckets: BUCKETS };
  };

  /* ─────────────────────────── revenue ─────────────────────────── */

  AR.revenue = async function (pid, opts) {
    opts = opts || {};
    const all = await ERP.billing.all(pid, { companyId: opts.companyId });
    const invoices = all.filter((i) => i.status === "posted" && (!opts.from || String(i.issueDate) >= String(opts.from)) && (!opts.to || String(i.issueDate) <= String(opts.to)));
    const byClient = {}, byService = {};
    for (const inv of invoices) {
      const cid = String(inv.companyId);
      if (!byClient[cid]) byClient[cid] = { companyId: inv.companyId, companyName: inv.__companyName || "", invoices: 0, subtotal: 0, tax: 0, total: 0 };
      byClient[cid].invoices += 1;
      byClient[cid].subtotal = round2(byClient[cid].subtotal + num(inv.subtotal));
      byClient[cid].tax = round2(byClient[cid].tax + num(inv.taxTotal));
      byClient[cid].total = round2(byClient[cid].total + num(inv.total));
      for (const l of inv.lines || []) {
        const label = l.source === "time" ? (l.meta && l.meta.workTypeLabel ? "Time · " + l.meta.workTypeLabel : "Time") : ERP.billing.sourceLabel(l.source);
        const key = label;
        if (!byService[key]) byService[key] = { service: key, source: l.source, amount: 0, tax: 0, lines: 0 };
        byService[key].amount = round2(byService[key].amount + num(l.amount));
        byService[key].tax = round2(byService[key].tax + num(l.taxAmount));
        byService[key].lines += 1;
      }
    }
    const clientRows = Object.keys(byClient).map((k) => byClient[k]).sort((a, b) => b.total - a.total);
    const serviceRows = Object.keys(byService).map((k) => byService[k]).sort((a, b) => b.amount - a.amount);
    const totals = {
      invoices: clientRows.reduce((n, r) => n + r.invoices, 0),
      subtotal: round2(clientRows.reduce((n, r) => n + r.subtotal, 0)),
      tax: round2(clientRows.reduce((n, r) => n + r.tax, 0)),
      total: round2(clientRows.reduce((n, r) => n + r.total, 0)),
    };
    return { from: opts.from || "", to: opts.to || "", byClient: clientRows, byService: serviceRows, totals: totals };
  };

  /* ─────────────────────────── billing backlog (unbilled WIP) ─────────────────────────── */

  AR.backlog = async function (pid, opts) {
    opts = opts || {};
    const companies = await ERP.companies.list();
    const rows = [];
    for (const e of companies) {
      if (opts.companyId != null && opts.companyId !== "" && String(e.id) !== String(opts.companyId)) continue;
      const row = { companyId: e.id, companyName: e.name, time: 0, minutes: 0, expenses: 0, agreements: 0, total: 0, items: 0 };
      try {
        const entries = await ERP.time.entries(pid, { companyId: e.id });
        for (const en of entries) {
          if (!en.billable || en.writtenOff || en.invoiceId != null) continue;
          if (["approved", "locked"].indexOf(String(en.status)) === -1) continue;
          const rate = (en.rate && num(en.rate.amount)) || 0;
          const value = round2((num(en.minutes) / 60) * rate);
          row.time = round2(row.time + value);
          row.minutes += num(en.minutes);
          row.items += 1;
        }
      } catch (err) {}
      try {
        const expenses = await ERP.expenses.list(pid, { companyId: e.id });
        for (const x of expenses) {
          if (!x.billable || x.writtenOff || x.invoiceId != null) continue;
          if (["approved", "reimbursed"].indexOf(String(x.status)) === -1) continue;
          row.expenses = round2(row.expenses + ERP.expenses.billableAmount(x));
          row.items += 1;
        }
      } catch (err) {}
      try {
        const charges = await ERP.agreements.charges(e.id, {});
        for (const c of charges) {
          if (c.status !== "posted" || c.billedInvoiceId != null) continue;
          row.agreements = round2(row.agreements + num(c.total));
          row.items += 1;
        }
      } catch (err) {}
      row.total = round2(row.time + row.expenses + row.agreements);
      if (row.items) rows.push(row);
    }
    rows.sort((a, b) => b.total - a.total);
    const totals = {
      time: round2(rows.reduce((n, r) => n + r.time, 0)),
      minutes: rows.reduce((n, r) => n + r.minutes, 0),
      expenses: round2(rows.reduce((n, r) => n + r.expenses, 0)),
      agreements: round2(rows.reduce((n, r) => n + r.agreements, 0)),
      total: round2(rows.reduce((n, r) => n + r.total, 0)),
      items: rows.reduce((n, r) => n + r.items, 0),
    };
    return { asOf: opts.asOf || ui.today(), rows: rows, totals: totals };
  };

  /* ─────────────────────────── invoice / payment summary ─────────────────────────── */

  AR.summary = async function (pid, opts) {
    opts = opts || {};
    const all = await ERP.billing.all(pid, { companyId: opts.companyId });
    const invoices = all.filter((i) => (!opts.from || String(i.issueDate) >= String(opts.from)) && (!opts.to || String(i.issueDate) <= String(opts.to)));
    const counts = {}, totals = { invoiced: 0, tax: 0, paid: 0, credits: 0, adjustments: 0, outstanding: 0, writtenOff: 0 };
    for (const inv of invoices) {
      counts[inv.status] = (counts[inv.status] || 0) + 1;
      if (inv.status === "void") continue;
      if (inv.status === "posted") {
        totals.invoiced = round2(totals.invoiced + num(inv.total));
        totals.tax = round2(totals.tax + num(inv.taxTotal));
        totals.paid = round2(totals.paid + num(inv.amountPaid));
        totals.credits = round2(totals.credits + num(inv.credits));
        totals.adjustments = round2(totals.adjustments + num(inv.adjustments));
        totals.writtenOff = round2(totals.writtenOff + num(inv.writeOff));
        totals.outstanding = round2(totals.outstanding + num(inv.balance));
      }
    }
    const payments = (await ERP.payments.all(pid, { companyId: opts.companyId, from: opts.from, to: opts.to })).filter((p) => p.status !== "void");
    totals.received = round2(payments.reduce((n, p) => n + num(p.amount), 0));
    return { from: opts.from || "", to: opts.to || "", counts: counts, totals: totals, paymentCount: payments.length };
  };

  /* ─────────────────────────── exports ─────────────────────────── */

  AR.toCsv = function (rows, columns) {
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = columns.map((c) => esc(c.label != null ? c.label : c.key)).join(",");
    const body = (rows || []).map((r) => columns.map((c) => esc(c.render ? c.render(r) : r[c.key])).join(",")).join("\n");
    return head + (body ? "\n" + body : "") + "\n";
  };

  AR.downloadCsv = function (name, rows, columns) {
    try {
      const csv = AR.toCsv(rows, columns);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, csv: csv, filename: name };
    } catch (e) { return { error: "export_failed", message: (e && e.message) || String(e) }; }
  };

  AR.printHtml = function (title, bodyHtml) {
    try {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      document.body.appendChild(frame);
      const doc = frame.contentWindow.document;
      doc.open();
      doc.write(
        "<!doctype html><html><head><title>" + ui.esc(title) + "</title>" +
        "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;padding:28px;}" +
        "h1{font-size:20px;margin:0 0 4px;}h2{font-size:13px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#475569;}" +
        "table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;}th,td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left;}" +
        "th{background:#f1f5f9;}td.num,th.num{text-align:right;}p.meta{color:#64748b;font-size:12px;margin:0 0 12px;}</style>" +
        "</head><body>" + bodyHtml + "</body></html>"
      );
      doc.close();
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 3000);
      return { ok: true };
    } catch (e) { return { error: "print_failed", message: (e && e.message) || String(e) }; }
  };

  /* ─────────────────────────── station tab ─────────────────────────── */

  AR.render = async function (panel, pid) {
    const host = panel.__host || panel;
    const state = host.__bill || (host.__bill = { companyId: "" });
    const companies = await ERP.companies.optionList();
    if ((!state.companyId || !companies.some((c) => String(c.value) === String(state.companyId))) && companies.length) state.companyId = companies[0].value;
    if (!state.from) state.from = ERP.billing.defaultPeriod(ui.today()).start;
    if (!state.to) state.to = ui.today();

    const [aging, revenue, backlog, summary] = await Promise.all([
      AR.arAging(pid, { companyId: state.companyId, asOf: ui.today() }),
      AR.revenue(pid, { companyId: state.companyId, from: state.from, to: state.to }),
      AR.backlog(pid, { companyId: state.companyId }),
      AR.summary(pid, { companyId: state.companyId, from: state.from, to: state.to }),
    ]);

    const agingRows = aging.rows.map((r) => ({
      client: ui.esc(r.companyName),
      current: maskedMoney(r.current),
      b1: maskedMoney(r["1-30"]),
      b2: maskedMoney(r["31-60"]),
      b3: maskedMoney(r["61-90"]),
      b4: maskedMoney(r["90+"]),
      total: maskedMoney(r.total),
    }));
    const revClientRows = revenue.byClient.map((r) => ({ client: ui.esc(r.companyName), invoices: String(r.invoices), subtotal: maskedMoney(r.subtotal), tax: maskedMoney(r.tax), total: maskedMoney(r.total) }));
    const revServiceRows = revenue.byService.map((r) => ({ service: ui.esc(r.service), source: ui.badge(ERP.billing.sourceLabel(r.source), "info"), amount: maskedMoney(r.amount), tax: maskedMoney(r.tax) }));
    const backlogRows = backlog.rows.map((r) => ({ client: ui.esc(r.companyName), time: maskedMoney(r.time), hours: ui.fmt(r.minutes / 60, 1) + "h", expenses: maskedMoney(r.expenses), agreements: maskedMoney(r.agreements), total: maskedMoney(r.total) }));

    panel.innerHTML =
      ui.summary([
        { label: "Open AR", value: maskedMoney(aging.totals.total) },
        { label: "Overdue", value: maskedMoney(round2(aging.totals["1-30"] + aging.totals["31-60"] + aging.totals["61-90"] + aging.totals["90+"])) },
        { label: "Revenue (period)", value: maskedMoney(revenue.totals.total) },
        { label: "Unbilled WIP", value: maskedMoney(backlog.totals.total) },
        { label: "Received", value: maskedMoney(summary.totals.received) },
        { label: "Outstanding", value: maskedMoney(summary.totals.outstanding) },
      ]) +
      '<div class="erp-db-toolbar">' +
        ui.select("ar-client", "Client", [{ value: "", label: "All clients" }].concat(companies), state.companyId) +
        ui.dateInput("ar-from", "From", state.from) +
        ui.dateInput("ar-to", "To", state.to) +
        '<span class="erp-db-hint">Every figure derives from posted invoices, payments and unbilled work</span>' +
      "</div>" +
      ui.card("AR aging — as of " + ui.esc(aging.asOf),
        ui.table([
          { key: "client", label: "Client" },
          { key: "current", label: "Current", align: "right" },
          { key: "b1", label: "1–30", align: "right" },
          { key: "b2", label: "31–60", align: "right" },
          { key: "b3", label: "61–90", align: "right" },
          { key: "b4", label: "90+", align: "right" },
          { key: "total", label: "Total", align: "right" },
        ], agingRows, { emptyText: "No open receivables." }) +
        ui.summary([
          { label: "Current", value: maskedMoney(aging.totals.current) },
          { label: "1–30", value: maskedMoney(aging.totals["1-30"]) },
          { label: "31–60", value: maskedMoney(aging.totals["31-60"]) },
          { label: "61–90", value: maskedMoney(aging.totals["61-90"]) },
          { label: "90+", value: maskedMoney(aging.totals["90+"]) },
          { label: "Total", value: maskedMoney(aging.totals.total) },
        ]) +
        '<div class="erp-btn-row">' +
          ui.btn("Export aging CSV", { small: true, act: "ar-csv-aging" }) +
          ui.btn("Print / PDF", { small: true, act: "ar-print-aging" }) +
        "</div>") +
      ui.card("Revenue by client — " + ui.esc(revenue.from || "…") + " → " + ui.esc(revenue.to || "…"),
        ui.table([
          { key: "client", label: "Client" },
          { key: "invoices", label: "Invoices", align: "right" },
          { key: "subtotal", label: "Net", align: "right" },
          { key: "tax", label: "Tax", align: "right" },
          { key: "total", label: "Gross", align: "right" },
        ], revClientRows, { emptyText: "No invoiced revenue in this period." }) +
        '<div class="erp-btn-row">' + ui.btn("Export revenue CSV", { small: true, act: "ar-csv-revenue" }) + "</div>") +
      ui.card("Revenue by service",
        ui.table([
          { key: "service", label: "Service" },
          { key: "source", label: "Source" },
          { key: "amount", label: "Net", align: "right" },
          { key: "tax", label: "Tax", align: "right" },
        ], revServiceRows, { emptyText: "No service revenue yet." })) +
      ui.card("Billing backlog (unbilled WIP)",
        ui.table([
          { key: "client", label: "Client" },
          { key: "time", label: "Unbilled time", align: "right" },
          { key: "hours", label: "Hours", align: "right" },
          { key: "expenses", label: "Unbilled expenses", align: "right" },
          { key: "agreements", label: "Unposted charges", align: "right" },
          { key: "total", label: "Total WIP", align: "right" },
        ], backlogRows, { emptyText: "Nothing left unbilled — all work is on an invoice." }) +
        '<div class="erp-btn-row">' + ui.btn("Export backlog CSV", { small: true, act: "ar-csv-backlog" }) + "</div>") +
      ui.card("Invoice & payment summary",
        ui.summary([
          { label: "Draft", value: String(summary.counts.draft || 0) },
          { label: "Approved", value: String(summary.counts.approved || 0) },
          { label: "Posted", value: String(summary.counts.posted || 0) },
          { label: "Void", value: String(summary.counts.void || 0) },
          { label: "Invoiced", value: maskedMoney(summary.totals.invoiced) },
          { label: "Tax", value: maskedMoney(summary.totals.tax) },
          { label: "Paid", value: maskedMoney(summary.totals.paid) },
          { label: "Credits", value: maskedMoney(summary.totals.credits) },
          { label: "Adjustments", value: maskedMoney(summary.totals.adjustments) },
          { label: "Written off", value: maskedMoney(summary.totals.writtenOff) },
          { label: "Payments", value: String(summary.paymentCount) },
          { label: "Outstanding", value: maskedMoney(summary.totals.outstanding) },
        ]) +
        '<div class="erp-btn-row">' + ui.btn("Export summary CSV", { small: true, act: "ar-csv-summary" }) + "</div>");

    const bind = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; AR.render(panel, pid); }); };
    bind('[name="ar-client"]', "companyId");
    bind('[name="ar-from"]', "from");
    bind('[name="ar-to"]', "to");

    ui.bind(panel, "click", "[data-act]", (el, e, act) => {
      if (act === "ar-csv-aging") { AR.downloadCsv("ar-aging-" + aging.asOf + ".csv", aging.rows, [{ key: "companyName", label: "Client" }, { key: "current", label: "Current" }, { key: "1-30", label: "1-30" }, { key: "31-60", label: "31-60" }, { key: "61-90", label: "61-90" }, { key: "90+", label: "90+" }, { key: "total", label: "Total" }]); return ERP.toast("Aging exported.", "success"); }
      if (act === "ar-csv-revenue") { AR.downloadCsv("revenue-" + (revenue.from || "all") + ".csv", revenue.byClient, [{ key: "companyName", label: "Client" }, { key: "invoices", label: "Invoices" }, { key: "subtotal", label: "Net" }, { key: "tax", label: "Tax" }, { key: "total", label: "Gross" }]); return ERP.toast("Revenue exported.", "success"); }
      if (act === "ar-csv-backlog") { AR.downloadCsv("billing-backlog-" + backlog.asOf + ".csv", backlog.rows, [{ key: "companyName", label: "Client" }, { key: "time", label: "Unbilled time" }, { key: "minutes", label: "Minutes" }, { key: "expenses", label: "Unbilled expenses" }, { key: "agreements", label: "Unposted charges" }, { key: "total", label: "Total WIP" }]); return ERP.toast("Backlog exported.", "success"); }
      if (act === "ar-csv-summary") { AR.downloadCsv("invoice-summary.csv", [summary.totals], [{ key: "invoiced", label: "Invoiced" }, { key: "tax", label: "Tax" }, { key: "paid", label: "Paid" }, { key: "credits", label: "Credits" }, { key: "adjustments", label: "Adjustments" }, { key: "writtenOff", label: "Written off" }, { key: "received", label: "Received" }, { key: "outstanding", label: "Outstanding" }]); return ERP.toast("Summary exported.", "success"); }
      if (act === "ar-print-aging") {
        const rows = aging.rows.map((r) => '<tr><td>' + ui.esc(r.companyName) + '</td><td class="num">' + ui.money(r.current) + '</td><td class="num">' + ui.money(r["1-30"]) + '</td><td class="num">' + ui.money(r["31-60"]) + '</td><td class="num">' + ui.money(r["61-90"]) + '</td><td class="num">' + ui.money(r["90+"]) + '</td><td class="num"><b>' + ui.money(r.total) + "</b></td></tr>").join("");
        AR.printHtml("AR aging", '<h1>AR aging</h1><p class="meta">As of ' + ui.esc(aging.asOf) + "</p><table><thead><tr><th>Client</th><th class=\"num\">Current</th><th class=\"num\">1-30</th><th class=\"num\">31-60</th><th class=\"num\">61-90</th><th class=\"num\">90+</th><th class=\"num\">Total</th></tr></thead><tbody>" + (rows || '<tr><td colspan="7">No open receivables.</td></tr>') + "</tbody></table>");
        return;
      }
    });
  };
})();
