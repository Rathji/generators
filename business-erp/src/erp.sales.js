/* ============================================================
   BUSINESS ERP — Sales module (Tasks 14–18)
   - Catalog tab (Task 7 UI): product/service catalog with sku,
     uom, default sale price, default cost and tax treatment.
   - Quotes (14): catalog line items with manual line editing and
     per-line discounting, automatic tax, validity/expiry,
     draft → sent → accepted / declined states; accepting converts
     to a sales order without retyping.
   - Sales orders (15): created from accepted quotes or entered
     directly; per-line fulfillment (shipped/delivered/invoiced),
     delivery promise dates, stamped status transitions open →
     confirmed → shipped → delivered → invoiced.
   - Invoices (16): generated from delivered order lines with
     partial invoicing allowed; each carries order + party refs and
     auto-posts to the ledger when the Phase 7 finance module is
     present (guarded, no-op until then).
   - Backorders & stock checks (17): confirming an order checks
     available stock, splits shippable vs backordered, raises a
     purchasing shortfall automatically, and (once inventory lands)
     relieves backorders in order-date order as stock arrives.
   - Credit notes (18): full or partial credit against an invoice
     with a required reason; reverses the invoice's ledger postings
     (guarded) and marks the invoice credited.
   Data lives in the sales document (splitByYear: false).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const store = ERP.store;
  const master = ERP.master;
  const S = (ERP.sales = {});
  const esc = ui.esc;

  const QT = {
    draft: { label: "Draft", tone: "muted" },
    sent: { label: "Sent", tone: "info" },
    accepted: { label: "Accepted", tone: "success" },
    declined: { label: "Declined", tone: "danger" },
  };
  const OR = {
    open: { label: "Open", tone: "info" },
    confirmed: { label: "Confirmed", tone: "warn" },
    shipped: { label: "Shipped", tone: "warn" },
    delivered: { label: "Delivered", tone: "success" },
    invoiced: { label: "Invoiced", tone: "success" },
  };
  const IV = {
    draft: { label: "Draft", tone: "muted" },
    posted: { label: "Posted", tone: "info" },
    partially_credited: { label: "Partially credited", tone: "warn" },
    credited: { label: "Credited", tone: "muted" },
    paid: { label: "Paid", tone: "success" },
  };
  const CN = {
    posted: { label: "Posted", tone: "info" },
    applied: { label: "Applied", tone: "success" },
  };
  const TERM_DAYS = { immediate: 0, net15: 15, net30: 30, net60: 60, net90: 90 };

  /* ─────────────────────────── data helpers ─────────────────────────── */

  let cache = null;
  async function docs() {
    if (cache) return cache;
    const r = await store.loadDoc("sales");
    cache = (r.records || []).slice();
    return cache;
  }
  S.records = docs;
  S.invalidate = () => { cache = null; };

  async function save(list) {
    const r = await store.saveDoc("sales", list || []);
    cache = (list || []).slice();
    return r;
  }

  S.byKind = function (list, kind) { return (list || []).filter((r) => (r.kind || "") === kind); };

  function activityRec(rec, type, summary) {
    const act = rec.activity || (rec.activity = []);
    act.push({ id: Date.now(), ts: new Date().toISOString(), type: type || "note", summary: summary || "", by: ERP.role || "owner" });
  }

  /* ─────────────────────────── line & doc math ─────────────────────────── */

  S.lineTotals = function (l) {
    l = l || {};
    const qty = Number(l.qty) || 0;
    const price = Number(l.unitPrice) || 0;
    const sub = qty * price;
    const disc = sub * (Number(l.discountPct) || 0) / 100;
    const taxable = sub - disc;
    const tax = taxable * (Number(l.taxRate) || 0) / 100;
    return { sub, disc, tax, total: taxable + tax };
  };

  S.computeTotals = function (lines) {
    let subtotal = 0, discount = 0, taxTotal = 0;
    for (const l of (lines || [])) { const t = S.lineTotals(l); subtotal += t.sub; discount += t.disc; taxTotal += t.tax; }
    return { subtotal, discount, taxTotal, total: subtotal - discount + taxTotal };
  };

  /* ─────────────────────────── cross-module hooks (Phase 7) ─────────────────────────── */

  async function postInvoice(inv) {
    if (ERP.finance && typeof ERP.finance.postSalesInvoice === "function") return await ERP.finance.postSalesInvoice(inv);
    return null;
  }
  async function reverseInvoice(cn) {
    if (ERP.finance && typeof ERP.finance.reverseInvoice === "function") return await ERP.finance.reverseInvoice(cn);
    return null;
  }

  /* ─────────────────────────── stock & backorders (Task 17) ─────────────────────────── */

  async function stockAvail(itemId) {
    const inv = ERP.inventory;
    if (inv && typeof inv.available === "function") return await inv.available(itemId);
    return Infinity;
  }

  /* Create a draft PO in the purchasing doc covering backordered lines. */
  S.raiseShortfall = async function (order, backordered) {
    const purchMod = ERP.getModule("purchasing");
    if (!purchMod || !purchMod.doc) return null;
    const r = await store.loadDoc("purchasing");
    const list = (r.records || []).slice();
    const po = {
      id: master.nextId(list), kind: "po", num: await master.allocateNumber("po"),
      status: "draft", source: "shortfall", orderId: order.id, orderNum: order.num,
      supplierId: null, date: ui.today(), expectedDate: null,
      lines: backordered.map((l) => ({ itemId: l.itemId, description: l.description, qty: l.qtyBackordered, unitCost: 0, taxCode: l.taxCode || "NONE", taxRate: l.taxRate || 0 })),
      notes: "Auto-suggested to cover backorders on " + order.num,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    list.push(po);
    await store.saveDoc("purchasing", list);
    await master.audit({ action: "raise_shortfall", targetType: "po", targetId: po.id, summary: "Raised " + po.num + " to cover backorders on " + order.num + "." });
    return po;
  };

  /* Lines with outstanding backorders for an item, oldest order first. */
  S.backorderedLines = async function (itemId) {
    const allDocs = await docs();
    const out = [];
    const orders = S.byKind(allDocs, "order")
      .filter((o) => o.status === "confirmed" || o.status === "shipped")
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));
    for (const o of orders) {
      for (const l of (o.lines || [])) {
        if (String(l.itemId) === String(itemId) && (Number(l.qtyBackordered) || 0) > 0) {
          out.push({ order: o, line: l, qty: Number(l.qtyBackordered) });
        }
      }
    }
    return out;
  };

  /* Relieve part of a backorder once stock arrives: reduces qtyBackordered,
     increases qtyDelivered, and advances the order to delivered when complete. */
  S.relieveBackorder = async function (order, line, qty) {
    const allDocs = await docs();
    qty = Number(qty) || 0;
    const q = Math.min(qty, Number(line.qtyBackordered) || 0);
    if (!(q > 0)) return 0;
    line.qtyBackordered = (Number(line.qtyBackordered) || 0) - q;
    line.qtyDelivered = (Number(line.qtyDelivered) || 0) + q;
    if ((order.lines || []).every((l) => (Number(l.qtyDelivered) || 0) >= (Number(l.qty) || 0))) {
      order.status = "delivered"; order.stamps = order.stamps || {}; order.stamps.deliveredAt = new Date().toISOString();
    }
    activityRec(order, "deliver", "Backorder relief: " + ui.fmt(q) + " unit(s) delivered from goods receipt.");
    await save(allDocs);
    return q;
  };

  /* ─────────────────────────── core business actions ─────────────────────────── */

  /* Create a quote (draft) from form data. */
  S.createQuote = async function (data) {
    const allDocs = await docs();
    const lines = (data.lines || []).filter((l) => l.qty > 0 && (l.description || l.itemId)).map((l, i) => Object.assign({}, l, { lineNo: i + 1 }));
    if (!lines.length) throw new Error("Add at least one line with a quantity.");
    const totals = S.computeTotals(lines);
    const doc = {
      id: master.nextId(allDocs), kind: "quote", num: await master.allocateNumber("quote"),
      partyId: Number(data.partyId), date: data.date || ui.today(), validUntil: data.validUntil || "",
      lines, currency: data.currency || "USD", notes: data.notes || "",
      status: "draft",
      subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Quote created.", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    await save(allDocs.concat([doc]));
    return doc;
  };

  /* Create a sales order (open) from form data. */
  S.createOrder = async function (data) {
    const allDocs = await docs();
    const lines = (data.lines || []).filter((l) => l.qty > 0 && (l.description || l.itemId)).map((l, i) => Object.assign({}, l, {
      lineNo: i + 1, qtyShipped: 0, qtyDelivered: 0, qtyInvoiced: 0, qtyBackordered: 0,
    }));
    if (!lines.length) throw new Error("Add at least one line with a quantity.");
    const totals = S.computeTotals(lines);
    const doc = {
      id: master.nextId(allDocs), kind: "order", num: await master.allocateNumber("order"),
      source: data.source || "direct", quoteId: data.quoteId != null ? data.quoteId : null, quoteNum: data.quoteNum || "",
      partyId: Number(data.partyId), date: data.date || ui.today(), promiseDate: data.promiseDate || "",
      lines, currency: data.currency || "USD", notes: data.notes || "",
      status: "open", subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total,
      stamps: { confirmedAt: null, shippedAt: null, deliveredAt: null, invoicedAt: null },
      hasBackorder: false,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Order created.", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    await save(allDocs.concat([doc]));
    return doc;
  };

  /* Persist an edited quote/order/invoice doc. */
  S.updateDoc = async function (doc) {
    const allDocs = await docs();
    const lines = (doc.lines || []).map((l, i) => Object.assign({}, l, { lineNo: i + 1 }));
    const totals = S.computeTotals(lines);
    const merged = Object.assign({}, doc, {
      lines, subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total,
      updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    });
    await save(allDocs.map((x) => (String(x.id) === String(merged.id) ? merged : x)));
    return merged;
  };

  S.sendQuote = async function (quote) {
    if (!quote || quote.kind !== "quote") throw new Error("Not a quote.");
    if (quote.status !== "draft") throw new Error("Only draft quotes can be sent.");
    const allDocs = await docs();
    quote.status = "sent"; quote.sentAt = new Date().toISOString();
    activityRec(quote, "send", "Quote sent.");
    await save(allDocs);
    return quote;
  };

  S.declineQuote = async function (quote) {
    if (!quote || quote.kind !== "quote") throw new Error("Not a quote.");
    if (quote.status !== "sent") throw new Error("Only a sent quote can be declined.");
    const allDocs = await docs();
    quote.status = "declined"; quote.declinedAt = new Date().toISOString();
    activityRec(quote, "decline", "Quote declined.");
    await save(allDocs);
    return quote;
  };

  S.deleteDoc = async function (rec) {
    const allDocs = await docs();
    await save(allDocs.filter((x) => String(x.id) !== String(rec.id)));
    return true;
  };

  /* Accept a sent quote → convert to a sales order without retyping. */
  S.acceptQuote = async function (quote) {
    if (!quote || quote.kind !== "quote") throw new Error("Not a quote.");
    if (quote.status !== "sent") throw new Error("Only a sent quote can be accepted.");
    const allDocs = await docs();
    const order = await S.buildOrderFromQuote(quote, allDocs);
    quote.status = "accepted"; quote.acceptedAt = new Date().toISOString(); quote.acceptedOrderId = order.id;
    activityRec(quote, "accept", "Accepted — converted to " + order.num + ".");
    await save(allDocs.map((x) => (String(x.id) === String(quote.id) ? quote : x)).concat([order]));
    await master.audit({ action: "accept_quote", targetType: "quote", targetId: quote.id, summary: "Accepted " + quote.num + " → " + order.num + "." });
    return order;
  };

  S.buildOrderFromQuote = async function (quote, allDocs) {
    const totals = S.computeTotals(quote.lines);
    return {
      id: master.nextId(allDocs), kind: "order", num: await master.allocateNumber("order"),
      source: "quote", quoteId: quote.id, quoteNum: quote.num,
      partyId: quote.partyId, date: ui.today(), promiseDate: quote.promiseDate || "",
      lines: (quote.lines || []).map((l) => Object.assign({}, l, { qtyShipped: 0, qtyDelivered: 0, qtyInvoiced: 0, qtyBackordered: 0 })),
      currency: quote.currency, notes: "From accepted quote " + quote.num + (quote.notes ? "\n" + quote.notes : ""),
      status: "open", subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total,
      stamps: { confirmedAt: null, shippedAt: null, deliveredAt: null, invoicedAt: null },
      hasBackorder: false,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Order created from accepted quote " + quote.num, by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
  };

  /* Confirm an order: check stock, split shippable vs backordered, raise shortfall. */
  S.confirmOrder = async function (order) {
    if (!order || order.kind !== "order") throw new Error("Not an order.");
    if (order.status !== "open") throw new Error("Only open orders can be confirmed.");
    const allDocs = await docs();
    order.status = "confirmed";
    order.stamps = order.stamps || {}; order.stamps.confirmedAt = new Date().toISOString();
    const backordered = [];
    for (const l of (order.lines || [])) {
      l.qtyBackordered = 0;
      if (l.itemId) {
        const avail = await stockAvail(l.itemId);
        const qty = Number(l.qty) || 0;
        const short = avail === Infinity ? 0 : Math.max(0, qty - avail);
        l.qtyBackordered = short;
        if (short > 0) backordered.push(l);
      }
    }
    order.hasBackorder = backordered.length > 0;
    activityRec(order, "confirm", "Order confirmed" + (backordered.length ? " — " + backordered.length + " line(s) backordered." : "."));
    await save(allDocs);
    await master.audit({ action: "confirm_order", targetType: "order", targetId: order.id, summary: "Confirmed " + order.num + (order.hasBackorder ? " with backorders." : ".") });
    if (backordered.length) await S.raiseShortfall(order, backordered);
    return { hasBackorder: order.hasBackorder, backordered: backordered.length };
  };

  /* Record a shipment against selected lines. */
  S.recordShipment = async function (order, qtyMap) {
    if (!order || order.kind !== "order") throw new Error("Not an order.");
    const allDocs = await docs();
    let any = 0;
    const callShipped = {};
    for (const l of (order.lines || [])) {
      const v = Number((qtyMap || {})[l.lineNo]) || 0;
      if (v > 0) { l.qtyShipped = (l.qtyShipped || 0) + v; any += v; callShipped[l.lineNo] = v; }
    }
    if (!any) throw new Error("Enter a quantity to ship.");
    if ((order.lines || []).every((l) => (l.qtyShipped || 0) >= (Number(l.qty) || 0))) {
      order.status = "shipped"; order.stamps = order.stamps || {}; order.stamps.shippedAt = new Date().toISOString();
    }
    activityRec(order, "ship", "Shipped " + ui.fmt(any) + " unit(s).");
    await save(allDocs);
    await master.audit({ action: "ship_order", targetType: "order", targetId: order.id, summary: "Shipped " + ui.fmt(any) + " unit(s) on " + order.num + "." });
    const I = ERP.inventory;
    if (I && typeof I.postIssue === "function") {
      for (const l of (order.lines || [])) {
        const v = Number(callShipped[l.lineNo]) || 0;
        if (v > 0 && l.itemId != null) {
          await I.postIssue({ itemId: l.itemId, qty: v, refType: "sales", refId: order.id, refNum: order.num, note: "Sales shipment " + order.num, date: ui.today() });
        }
      }
    }
    return any;
  };

  /* Record a delivery against selected lines (max = shipped). */
  S.recordDelivery = async function (order, qtyMap) {
    if (!order || order.kind !== "order") throw new Error("Not an order.");
    const allDocs = await docs();
    let any = 0;
    for (const l of (order.lines || [])) {
      const v = Number((qtyMap || {})[l.lineNo]) || 0;
      if (v > 0) { l.qtyDelivered = (l.qtyDelivered || 0) + v; any += v; }
    }
    if (!any) throw new Error("Enter a quantity to deliver.");
    if ((order.lines || []).every((l) => (l.qtyDelivered || 0) >= (l.qtyShipped || 0))) {
      order.status = "delivered"; order.stamps = order.stamps || {}; order.stamps.deliveredAt = new Date().toISOString();
    }
    activityRec(order, "deliver", "Delivered " + ui.fmt(any) + " unit(s).");
    await save(allDocs);
    await master.audit({ action: "deliver_order", targetType: "order", targetId: order.id, summary: "Delivered " + ui.fmt(any) + " unit(s) on " + order.num + "." });
    return any;
  };

  /* Invoice selected (delivered) lines of an order. Partial invoicing allowed. */
  S.invoiceFromOrder = async function (order, qtyMap) {
    if (!order || order.kind !== "order") throw new Error("Not an order.");
    const allDocs = await docs();
    const qtyMapN = qtyMap || {};
    const lines = (order.lines || []).filter((l) => (Number(qtyMapN[l.lineNo]) || 0) > 0).map((l) => {
      const q = Number(qtyMapN[l.lineNo]);
      return Object.assign({}, l, { qty: q, qtyInvoiced: q });
    });
    if (!lines.length) throw new Error("Choose at least one line with a quantity to invoice.");
    const totals = S.computeTotals(lines);
    const party = await master.party(order.partyId);
    const days = TERM_DAYS[((party && party.paymentTerms) || "net30")] != null ? TERM_DAYS[((party && party.paymentTerms) || "net30")] : 30;
    const inv = {
      id: master.nextId(allDocs), kind: "invoice", num: await master.allocateNumber("invoice"),
      partyId: order.partyId, orderId: order.id, orderNum: order.num, date: ui.today(),
      dueDate: ui.addDays(ui.today(), days),
      lines, currency: order.currency, notes: "Invoice for " + order.num,
      status: "posted", subtotal: totals.subtotal, discount: totals.discount, taxTotal: totals.taxTotal, total: totals.total,
      amountPaid: 0, amountCredited: 0, ledgerEntries: null,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Invoice created from " + order.num + ".", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    allDocs.push(inv);
    for (const l of (order.lines || [])) {
      const q = Number(qtyMapN[l.lineNo]) || 0;
      if (q > 0) l.qtyInvoiced = (l.qtyInvoiced || 0) + q;
    }
    if ((order.lines || []).every((l) => (l.qtyInvoiced || 0) >= (Number(l.qty) || 0))) {
      order.status = "invoiced"; order.stamps = order.stamps || {}; order.stamps.invoicedAt = new Date().toISOString();
    }
    activityRec(order, "invoice", "Invoiced " + inv.num + ".");
    const journal = await postInvoice(inv);
    if (journal) inv.ledgerEntries = { journalId: journal.id, num: journal.num };
    await save(allDocs);
    await master.audit({ action: "create_invoice", targetType: "invoice", targetId: inv.id, summary: "Invoice " + inv.num + " (" + ui.money(inv.total) + ") for " + order.num + "." });
    return inv;
  };

  /* Full or partial credit note against an invoice (reason required). */
  S.createCreditNote = async function (inv, amount, reason) {
    if (!inv || inv.kind !== "invoice") throw new Error("Not an invoice.");
    if (!reason || !String(reason).trim()) throw new Error("A reason is required for a credit note.");
    amount = Number(amount);
    if (!isFinite(amount) || amount <= 0) throw new Error("Enter a credit amount greater than zero.");
    const remaining = Number(inv.total) - Number(inv.amountCredited || 0) - Number(inv.amountPaid || 0);
    if (amount > remaining + 0.0001) throw new Error("Credit amount exceeds what is left on the invoice.");
    const allDocs = await docs();
    const cn = {
      id: master.nextId(allDocs), kind: "creditNote", num: await master.allocateNumber("creditNote"),
      partyId: inv.partyId, invoiceId: inv.id, invoiceNum: inv.num, date: ui.today(),
      reason: String(reason).trim(), amount, currency: inv.currency,
      status: "posted", amountApplied: 0, lines: (inv.lines || []).slice(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    inv.amountCredited = (inv.amountCredited || 0) + amount;
    inv.status = inv.amountCredited >= inv.total - 0.0001 ? "credited" : "partially_credited";
    activityRec(inv, "credit", "Credit note " + cn.num + " (" + ui.money(amount) + "): " + cn.reason);
    allDocs.push(cn);
    const journal = await reverseInvoice(cn);
    if (journal) cn.ledgerEntries = { journalId: journal.id, num: journal.num };
    await save(allDocs);
    await master.audit({ action: "create_credit_note", targetType: "invoice", targetId: inv.id, summary: "Credit note " + cn.num + " (" + ui.money(amount) + ") against " + inv.num + " — " + cn.reason });
    return cn;
  };

  /* ─────────────────────────── line editor ─────────────────────────── */

  function itemOptions(catalog, sel) {
    return '<option value="">Custom / one-off…</option>' + (catalog || []).map((c) => '<option value="' + c.id + '"' + (String(c.id) === String(sel) ? " selected" : "") + ">" + esc(c.name + (c.sku ? " (" + c.sku + ")" : "")) + "</option>").join("");
  }
  function taxOptions(taxes, sel) {
    return (taxes || []).map((t) => '<option value="' + esc(t.code) + '"' + (t.code === sel ? " selected" : "") + ">" + esc(t.code + (t.rate ? " — " + t.rate + "%" : "")) + "</option>").join("");
  }
  function lineRowHtml(l, catalog, taxes) {
    l = l || {};
    return '<div class="erp-line-row" data-line-row>' +
      '<select class="erp-li-item" data-li-item>' + itemOptions(catalog, l.itemId) + "</select>" +
      '<input class="erp-li-desc" type="text" placeholder="Description" value="' + esc(l.description || "") + '">' +
      '<input class="erp-li-qty" type="number" step="any" min="0" value="' + (l.qty == null ? 1 : l.qty) + '">' +
      '<input class="erp-li-price" type="number" step="any" min="0" value="' + (l.unitPrice == null ? "" : l.unitPrice) + '">' +
      '<input class="erp-li-disc" type="number" step="any" min="0" max="100" value="' + (l.discountPct || 0) + '">' +
      '<select class="erp-li-tax" data-li-tax>' + taxOptions(taxes, l.taxCode || "NONE") + "</select>" +
      '<span class="erp-li-total" data-li-total></span>' +
      '<button type="button" class="icon-btn" data-li-del title="Remove line" aria-label="Remove line">×</button>' +
      "</div>";
  }

  function lineEditorHtml(lines, catalog, taxes) {
    const rows = (lines && lines.length ? lines : [null]).map((l) => lineRowHtml(l, catalog, taxes)).join("");
    return '<div class="erp-line-rows" data-line-rows>' + rows + "</div>" +
      '<div class="erp-btn-row">' + ui.btn("Add line", { small: true, act: "li-add" }) + "</div>" +
      '<div class="erp-line-totals" data-li-totals></div>';
  }

  function wireLineEditor(body, catalog, taxes, cur) {
    const rowsCtn = body.querySelector("[data-line-rows]");
    const totalsEl = body.querySelector("[data-li-totals]");
    function readRows() {
      return Array.from(rowsCtn.querySelectorAll("[data-line-row]")).map((row) => {
        const itemId = row.querySelector("[data-li-item]").value;
        const it = itemId ? (catalog || []).find((c) => String(c.id) === String(itemId)) : null;
        const desc = row.querySelector("[data-li-desc]").value.trim();
        const taxCode = row.querySelector("[data-li-tax]").value;
        const taxRate = ((taxes || []).find((t) => t.code === taxCode) || {}).rate || 0;
        return {
          itemId: itemId ? Number(itemId) : null,
          description: desc || (it ? it.name : ""),
          qty: Number(row.querySelector("[data-li-qty]").value) || 0,
          unitPrice: Number(row.querySelector("[data-li-price]").value) || 0,
          discountPct: Number(row.querySelector("[data-li-disc]").value) || 0,
          taxCode, taxRate,
          uom: (it && it.uom) || "",
        };
      });
    }
    function recalc() {
      const rows = readRows();
      const t = S.computeTotals(rows);
      rows.forEach((r, i) => {
        const rowEl = rowsCtn.querySelectorAll("[data-line-row]")[i];
        if (rowEl) rowEl.querySelector("[data-li-total]").textContent = ui.money(S.lineTotals(r).total, cur);
      });
      totalsEl.innerHTML = "Subtotal <b>" + ui.money(t.subtotal, cur) + "</b>&nbsp; Tax <b>" + ui.money(t.taxTotal, cur) + "</b>&nbsp; <span class=\"erp-grand\">Total <b>" + ui.money(t.total, cur) + "</b></span>";
    }
    function addRow(l) {
      const div = document.createElement("div");
      div.innerHTML = lineRowHtml(l, catalog, taxes);
      rowsCtn.appendChild(div.firstElementChild);
      recalc();
    }
    rowsCtn.addEventListener("input", recalc);
    rowsCtn.addEventListener("change", (e) => {
      if (e.target.matches("[data-li-item]")) {
        const row = e.target.closest("[data-line-row]");
        const it = (catalog || []).find((c) => String(c.id) === String(e.target.value));
        if (it) {
          row.querySelector("[data-li-desc]").value = it.name;
          row.querySelector("[data-li-price]").value = it.salePrice != null ? it.salePrice : "";
          row.querySelector("[data-li-tax]").value = it.taxCode || "NONE";
        }
      }
      recalc();
    });
    rowsCtn.addEventListener("click", (e) => {
      const del = e.target.closest("[data-li-del]");
      if (!del) return;
      const row = del.closest("[data-line-row]");
      if (rowsCtn.querySelectorAll("[data-line-row]").length > 1) row.remove();
      else {
        row.querySelector("[data-li-desc]").value = "";
        row.querySelector("[data-li-item]").value = "";
        row.querySelectorAll("input[type=number]").forEach((i) => { i.value = ""; });
        row.querySelector("[data-li-tax]").value = "NONE";
      }
      recalc();
    });
    body.querySelector("[data-act=li-add]").addEventListener("click", () => addRow(null));
    recalc();
    return { readRows, recalc };
  }

  /* ─────────────────────────── doc form modal (quote / order) ─────────────────────────── */

  function docFormModal(doc, kind, state, onChanged) {
    const isNew = !doc;
    const isQuote = kind === "quote";
    const title = isNew ? (isQuote ? "New quote" : "New sales order") : (isQuote ? "Edit quote" : "Edit sales order");
    const partyOpts = state.partiesAll.map((p) => ({ value: p.id, label: p.name }));
    const body = ui.form(
      ui.select("partyId", "Party", partyOpts, doc && doc.partyId, "Choose a party…") +
      (isQuote ? ui.dateInput("validUntil", "Valid until", (doc && doc.validUntil) || ui.addDays(ui.today(), 30)) : ui.dateInput("promiseDate", "Delivery promise", (doc && doc.promiseDate) || "")) +
      ui.textarea("notes", "Notes", (doc && doc.notes) || "", 2) +
      '<div class="field"><label>Lines</label>' + lineEditorHtml((doc && doc.lines) || [], state.catalog, state.taxes) + "</div>"
    );
    const m = ui.modal({
      title, size: "lg",
      body,
      foot: ui.btn("Cancel", { small: true, act: "s-cancel" }) + " " + ui.btn(isNew ? (isQuote ? "Create quote" : "Create order") : "Save changes", { small: true, primary: true, act: "s-save" }),
    });
    const bodyEl = m.querySelector("#uiModalBody");
    m.querySelector("[data-act=s-cancel]").onclick = () => ui.closeModal();
    const editor = wireLineEditor(bodyEl, state.catalog, state.taxes, state.cur);
    m.querySelector("[data-act=s-save]").onclick = async (t) => {
      const fields = ui.collect(bodyEl, ["partyId", "validUntil", "promiseDate", "notes"]);
      const lines = editor.readRows().filter((l) => l.qty > 0 && (l.description || l.itemId));
      if (!fields.partyId) { ERP.toast("Choose a party.", "error"); return; }
      if (!lines.length) { ERP.toast("Add at least one line with a quantity.", "error"); return; }
      t.disabled = true;
      try {
        if (isNew) {
          const base = { partyId: Number(fields.partyId), lines, currency: state.cur, notes: fields.notes || "" };
          if (isQuote) base.validUntil = fields.validUntil || "";
          else base.promiseDate = fields.promiseDate || "";
          const doc = isQuote ? await S.createQuote(base) : await S.createOrder(base);
          await master.audit({ action: isQuote ? "create_quote" : "create_order", targetType: isQuote ? "quote" : "order", targetId: doc.id, summary: (isQuote ? "Quote " : "Order ") + doc.num + " (" + ui.money(doc.total) + ") for " + (state.partiesMap[String(doc.partyId)] || "?") + "." });
          ERP.toast((isQuote ? "Quote " : "Order ") + doc.num + " created.", "success");
        } else {
          const merged = Object.assign({}, doc, {
            partyId: Number(fields.partyId), lines, currency: state.cur, notes: fields.notes || "",
            updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
          });
          if (isQuote) merged.validUntil = fields.validUntil || "";
          else merged.promiseDate = fields.promiseDate || "";
          await S.updateDoc(merged);
          ERP.toast(isQuote ? "Quote updated." : "Order updated.", "success");
        }
        ui.closeModal();
        onChanged();
      } catch (e) {
        t.disabled = false;
        ERP.toast("Could not save: " + ((e && e.message) || e), "error");
      }
    };
  }

  /* ─────────────────────────── Catalog tab (Task 7 UI) ─────────────────────────── */

  async function renderCatalog(panel, state, onChanged) {
    const catalog = state.catalog;
    const q = (panel.__q || "").toLowerCase();
    const rows = catalog.filter((c) => !q || (c.name || "").toLowerCase().indexOf(q) !== -1 || (c.sku || "").toLowerCase().indexOf(q) !== -1).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    panel.innerHTML =
      ui.summary([
        { label: "Items", value: String(catalog.length) },
        { label: "Products", value: String(catalog.filter((c) => c.type === "product").length) },
        { label: "Services", value: String(catalog.filter((c) => c.type === "service").length) },
        { label: "Inactive", value: String(catalog.filter((c) => c.active === false).length) },
      ]) +
      '<div class="erp-toolbar">' +
      '<input type="search" placeholder="Search catalog…" value="' + esc(panel.__q || "") + '" data-c-q>' +
      ui.btn("New item", { primary: true, act: "cat-new" }) +
      "</div>" +
      ui.table([
        { key: "name", label: "Item", render: (r) => "<b>" + esc(r.name || "—") + "</b>" + (r.sku ? '<div class="erp-sub">' + esc(r.sku) + "</div>" : "") },
        { key: "type", label: "Type", render: (r) => ui.badge(r.type || "—", r.type === "product" ? "info" : "warn") },
        { key: "uom", label: "UoM", render: (r) => esc(r.uom || "—") },
        { key: "sale", label: "Sale price", align: "right", render: (r) => ui.money(r.salePrice || 0) },
        { key: "cost", label: "Default cost", align: "right", render: (r) => ui.money(r.cost || 0) },
        { key: "tax", label: "Tax", render: (r) => esc(r.taxCode || "—") },
        { key: "active", label: "Status", render: (r) => ui.badge(r.active === false ? "Inactive" : "Active", r.active === false ? "danger" : "success") },
        { key: "actions", label: "", render: (r) => ui.btn("Edit", { small: true, act: "cat-edit", arg: r.id }) + " " + ui.btn(r.active === false ? "Activate" : "Deactivate", { small: true, act: "cat-toggle", arg: r.id }) },
      ], rows, { emptyText: "No catalog items yet." });

    panel.querySelector("[data-c-q]").addEventListener("input", (e) => { panel.__q = e.target.value; renderCatalog(panel, state, onChanged); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      const item = catalog.find((x) => String(x.id) === arg);
      if (act === "cat-new") catalogModal(null, state, async (c, isNew) => {
        const list = await master.catalog();
        if (isNew) c.id = master.nextId(list);
        await master.saveCatalog(list.concat([c]));
        ERP.toast("Catalog item added.", "success");
        onChanged();
      });
      else if (act === "cat-edit") { if (item) catalogModal(item, state, async (c) => {
        const list = await master.catalog();
        await master.saveCatalog(list.map((x) => (String(x.id) === arg ? c : x)));
        ERP.toast("Catalog item updated.", "success");
        onChanged();
      }); }
      else if (act === "cat-toggle") {
        if (!item) return;
        const list = await master.catalog();
        await master.saveCatalog(list.map((x) => (String(x.id) === arg ? Object.assign({}, x, { active: x.active === false }) : x)));
        ERP.toast(item.active === false ? "Item activated." : "Item deactivated.", "success");
        onChanged();
      }
    });
  }

  function catalogModal(item, state, onSave) {
    const isNew = !item;
    const m = ui.modal({
      title: isNew ? "New catalog item" : "Edit " + (item.name || "item"),
      body: ui.form(
        ui.text("name", "Name *", item && item.name, "Widget") +
        ui.text("sku", "SKU", item && item.sku) +
        ui.select("type", "Type", ["product", "service"], (item && item.type) || "product") +
        ui.text("uom", "Unit of measure", item && item.uom, "ea") +
        ui.number("salePrice", "Sale price", item && item.salePrice != null ? item.salePrice : "", { min: 0 }) +
        ui.number("cost", "Default cost", item && item.cost != null ? item.cost : "", { min: 0 }) +
        ui.number("reorderPoint", "Reorder point", item && item.reorderPoint != null ? item.reorderPoint : "", { min: 0, hint: "Flag for reordering when on-hand stock drops below this." }) +
        ui.select("taxCode", "Tax treatment", state.taxes.map((t) => t.code), (item && item.taxCode) || "NONE") +
        ui.check("active", "Active", !item || item.active !== false)
      ),
      foot: ui.btn("Cancel", { small: true, act: "c-cancel" }) + " " + ui.btn(isNew ? "Add item" : "Save changes", { small: true, primary: true, act: "c-save" }),
    });
    m.querySelector("[data-act=c-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=c-save]").onclick = async (t) => {
      const f = ui.collect(m, ["name", "sku", "type", "uom", "salePrice", "cost", "reorderPoint", "taxCode", "active"]);
      if (!f.name || !f.name.trim()) { ERP.toast("Name is required.", "error"); return; }
      const merged = Object.assign({}, item || {}, {
        name: f.name.trim(), sku: (f.sku || "").trim(), type: f.type || "product", uom: (f.uom || "").trim(),
        salePrice: f.salePrice == null ? 0 : Number(f.salePrice), cost: f.cost == null ? 0 : Number(f.cost),
        reorderPoint: f.reorderPoint == null ? 0 : Number(f.reorderPoint),
        taxCode: f.taxCode || "NONE", active: f.active !== false,
        updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
      });
      t.disabled = true;
      try { await onSave(merged, isNew); ui.closeModal(); } catch (e) { t.disabled = false; ERP.toast("Could not save: " + ((e && e.message) || e), "error"); }
    };
  }

  /* ─────────────────────────── Quotes tab ─────────────────────────── */

  function quoteExpiry(q) {
    return q.validUntil && (q.status === "draft" || q.status === "sent") && ui.diffDays(ui.today(), q.validUntil) > 0;
  }

  async function renderQuotes(panel, state, onChanged) {
    const quotes = S.byKind(state.allDocs, "quote").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const openVal = quotes.filter((q) => q.status === "sent" && !quoteExpiry(q)).reduce((s, q) => s + Number(q.total || 0), 0);
    panel.innerHTML =
      ui.summary([
        { label: "Quotes", value: String(quotes.length) },
        { label: "Open value", value: ui.money(openVal) },
        { label: "Accepted", value: String(quotes.filter((q) => q.status === "accepted").length) },
      ]) +
      '<div class="erp-toolbar">' +
      ui.btn("New quote", { primary: true, act: "qt-new" }) +
      "</div>" +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" },
        { key: "party", label: "Party", render: (r) => esc(state.partiesMap[String(r.partyId)] || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "valid", label: "Valid until", render: (r) => quoteExpiry(r) ? esc(r.validUntil) + " " + ui.badge("Expired", "danger") : esc(r.validUntil || "—") },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, QT) },
        { key: "total", label: "Total", align: "right", render: (r) => ui.money(r.total || 0, r.currency) },
        { key: "actions", label: "", render: (r) =>
          ui.btn("Open", { small: true, act: "qt-open", arg: r.id }) + " " +
          ui.btn("Edit", { small: true, act: "qt-edit", arg: r.id }) + " " +
          (r.status === "draft" ? ui.btn("Send", { small: true, act: "qt-send", arg: r.id }) : "") +
          (r.status === "sent" && !quoteExpiry(r) ? ui.btn("Accept", { small: true, primary: true, act: "qt-accept", arg: r.id }) + " " + ui.btn("Decline", { small: true, danger: true, act: "qt-decline", arg: r.id }) : "") +
          ((r.status === "draft" || r.status === "declined" || quoteExpiry(r)) ? ui.btn("Delete", { small: true, danger: true, act: "qt-del", arg: r.id }) : "") },
      ], quotes, { emptyText: "No quotes yet. Create one to start selling." });

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      const q = quotes.find((x) => String(x.id) === arg);
      if (act === "qt-new") docFormModal(null, "quote", state, onChanged);
      else if (act === "qt-edit") { if (q && (q.status === "draft" || q.status === "declined")) docFormModal(q, "quote", state, onChanged); }
      else if (act === "qt-send") {
        if (!q) return;
        try {
          await S.sendQuote(q);
          await master.audit({ action: "send_quote", targetType: "quote", targetId: q.id, summary: "Sent " + q.num + "." });
          onChanged();
        } catch (err) { ERP.toast(err.message || String(err), "error"); }
      }
      else if (act === "qt-accept") {
        if (!q) return;
        if (await ui.confirm({ title: "Accept " + q.num + "?", message: "Accepting converts this quote into a sales order without retyping.", okLabel: "Accept & convert" })) {
          try {
            const order = await S.acceptQuote(q);
            ERP.toast("Quote accepted — created " + order.num + ".", "success");
            onChanged();
          } catch (err) { ERP.toast(err.message || String(err), "error"); }
        }
      }
      else if (act === "qt-decline") {
        if (!q) return;
        try {
          await S.declineQuote(q);
          await master.audit({ action: "decline_quote", targetType: "quote", targetId: q.id, summary: "Declined " + q.num + "." });
          onChanged();
        } catch (err) { ERP.toast(err.message || String(err), "error"); }
      }
      else if (act === "qt-del") {
        if (!q) return;
        if (await ui.confirm({ title: "Delete quote?", message: "The quote will be removed permanently.", danger: true })) {
          await S.deleteDoc(q);
          await master.audit({ action: "delete_quote", targetType: "quote", targetId: q.id, summary: "Deleted " + q.num + "." });
          ERP.toast("Quote deleted.", "success");
          onChanged();
        }
      }
      else if (act === "qt-open") { if (q) quoteDetail(q, state, onChanged); }
    });
  }

  function quoteDetail(q, state, onChanged) {
    const m = ui.modal({
      title: q.num || "Quote",
      size: "lg",
      body:
        ui.summary([
          { label: "Party", value: esc(state.partiesMap[String(q.partyId)] || "—") },
          { label: "Date", value: esc(q.date || "—") },
          { label: "Valid until", value: esc(q.validUntil || "—") },
          { label: "Status", value: ui.statusBadge(q.status, QT) },
        ]) +
        ui.card("Lines", ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Qty", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "price", label: "Unit price", align: "right", render: (r) => ui.money(r.unitPrice || 0, q.currency) },
          { key: "disc", label: "Disc.", align: "right", render: (r) => (r.discountPct ? ui.pct(r.discountPct) : "—") },
          { key: "tax", label: "Tax", align: "right", render: (r) => ui.money(r.taxRate ? S.lineTotals(r).tax : 0, q.currency) },
          { key: "total", label: "Line total", align: "right", render: (r) => ui.money(S.lineTotals(r).total, q.currency) },
        ], q.lines || []) +
        '<div class="erp-line-totals">Subtotal <b>' + ui.money(q.subtotal || 0, q.currency) + "</b>&nbsp; Tax <b>" + ui.money(q.taxTotal || 0, q.currency) + '</b>&nbsp; <span class="erp-grand">Total <b>' + ui.money(q.total || 0, q.currency) + "</b></span></div>") +
        (q.notes ? "<p>" + esc(q.notes) + "</p>" : "") +
        activityCard(q),
      foot: ui.btn("Close", { small: true, act: "qd-close" }) + " " +
        (q.status === "draft" ? ui.btn("Edit", { small: true, act: "qd-edit" }) + " " + ui.btn("Send", { small: true, primary: true, act: "qd-send" }) : "") +
        (q.status === "sent" && !quoteExpiry(q) ? ui.btn("Accept", { small: true, primary: true, act: "qd-accept" }) + " " + ui.btn("Decline", { small: true, danger: true, act: "qd-decline" }) : "") +
        ((q.status === "draft" || q.status === "declined" || quoteExpiry(q)) ? ui.btn("Delete", { small: true, danger: true, act: "qd-del" }) : ""),
    });
    const modalEl = document.querySelector("#uiModal");
    const bindAct = (act, fn) => { const b = modalEl.querySelector("[data-act=" + act + "]"); if (b) b.onclick = fn; };
    bindAct("qd-close", () => ui.closeModal());
    bindAct("qd-edit", () => { ui.closeModal(); docFormModal(q, "quote", state, onChanged); });
    bindAct("qd-send", async () => { try { await S.sendQuote(q); await master.audit({ action: "send_quote", targetType: "quote", targetId: q.id, summary: "Sent " + q.num + "." }); ui.closeModal(); onChanged(); } catch (err) { ERP.toast(err.message || String(err), "error"); } });
    bindAct("qd-accept", async () => {
      if (await ui.confirm({ title: "Accept " + q.num + "?", message: "Accepting converts this quote into a sales order without retyping.", okLabel: "Accept & convert" })) {
        try { const order = await S.acceptQuote(q); ERP.toast("Created " + order.num + ".", "success"); ui.closeModal(); onChanged(); } catch (err) { ERP.toast(err.message || String(err), "error"); }
      }
    });
    bindAct("qd-decline", async () => { try { await S.declineQuote(q); await master.audit({ action: "decline_quote", targetType: "quote", targetId: q.id, summary: "Declined " + q.num + "." }); ui.closeModal(); onChanged(); } catch (err) { ERP.toast(err.message || String(err), "error"); } });
    bindAct("qd-del", async () => {
      if (await ui.confirm({ title: "Delete quote?", message: "The quote will be removed permanently.", danger: true })) { await S.deleteDoc(q); await master.audit({ action: "delete_quote", targetType: "quote", targetId: q.id, summary: "Deleted " + q.num + "." }); ui.closeModal(); onChanged(); }
    });
  }

  function activityCard(rec) {
    const acts = (rec.activity || []).slice().sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    return ui.card("Activity", '<div class="erp-timeline">' +
      (acts.length ? acts.map((a) => '<div class="erp-timeline-item"><span class="erp-timeline-when">' + ui.dateTime(a.ts) + "</span><b>" + esc(a.type || "note") + "</b> — " + esc(a.summary) + (a.by ? ' <span class="erp-sub">by ' + esc(a.by) + "</span>" : "") + "</div>").join("") : '<p class="erp-alert">No activity yet.</p>') +
      "</div>");
  }

  /* ─────────────────────────── Orders tab ─────────────────────────── */

  async function renderOrders(panel, state, onChanged) {
    const orders = S.byKind(state.allDocs, "order").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const openOrders = orders.filter((o) => o.status !== "invoiced");
    panel.innerHTML =
      ui.summary([
        { label: "Orders", value: String(orders.length) },
        { label: "Open value", value: ui.money(openOrders.reduce((s, o) => s + Number(o.total || 0), 0)) },
        { label: "Backordered", value: String(orders.filter((o) => o.hasBackorder).length) },
      ]) +
      '<div class="erp-toolbar">' +
      ui.btn("New order", { primary: true, act: "so-new" }) +
      "</div>" +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" + (r.source === "quote" ? '<div class="erp-sub">from ' + esc(r.quoteNum || "quote") + "</div>" : "") },
        { key: "party", label: "Party", render: (r) => esc(state.partiesMap[String(r.partyId)] || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "promise", label: "Promise", render: (r) => esc(r.promiseDate || "—") },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, OR) + (r.hasBackorder ? " " + ui.badge("Backorder", "danger") : "") },
        { key: "total", label: "Total", align: "right", render: (r) => ui.money(r.total || 0, r.currency) },
        { key: "actions", label: "", render: (r) => ui.btn("Open", { small: true, act: "so-open", arg: r.id }) + " " + (r.status === "open" ? ui.btn("Edit", { small: true, act: "so-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "so-del", arg: r.id }) : "") },
      ], orders, { emptyText: "No sales orders yet." });

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      const o = orders.find((x) => String(x.id) === arg);
      if (act === "so-new") docFormModal(null, "order", state, onChanged);
      else if (act === "so-edit") { if (o && o.status === "open") docFormModal(o, "order", state, onChanged); }
      else if (act === "so-del") {
        if (!o || o.status !== "open") return;
        if (await ui.confirm({ title: "Delete order?", message: "Only open (unconfirmed) orders can be deleted.", danger: true })) {
          await S.deleteDoc(o);
          await master.audit({ action: "delete_order", targetType: "order", targetId: o.id, summary: "Deleted " + o.num + "." });
          ERP.toast("Order deleted.", "success");
          onChanged();
        }
      }
      else if (act === "so-open") { if (o) orderDetail(o, state, onChanged); }
    });
  }

  function orderLineStatus(l) {
    const qty = Number(l.qty) || 0;
    const shipped = Number(l.qtyShipped) || 0;
    const delivered = Number(l.qtyDelivered) || 0;
    const invoiced = Number(l.qtyInvoiced) || 0;
    const back = Number(l.qtyBackordered) || 0;
    let s = "Pending";
    if (invoiced >= qty) s = "Invoiced";
    else if (delivered >= qty) s = "Delivered";
    else if (shipped >= qty) s = "Shipped";
    else if (shipped > 0) s = "Partially shipped";
    else if (back > 0) s = "Backordered";
    return s;
  }

  function orderDetail(o, state, onChanged) {
    const canConfirm = o.status === "open";
    const canShip = (o.status === "confirmed" || o.status === "shipped") && o.lines.some((l) => (Number(l.qtyShipped) || 0) < (Number(l.qty) || 0));
    const canDeliver = (o.status === "confirmed" || o.status === "shipped" || o.status === "delivered") && o.lines.some((l) => (Number(l.qtyDelivered) || 0) < (Number(l.qtyShipped) || 0));
    const canInvoice = (o.status === "confirmed" || o.status === "shipped" || o.status === "delivered") && o.lines.some((l) => (Number(l.qtyInvoiced) || 0) < (Number(l.qtyDelivered) || 0));
    const m = ui.modal({
      title: o.num || "Order",
      size: "lg",
      body:
        ui.summary([
          { label: "Party", value: esc(state.partiesMap[String(o.partyId)] || "—") },
          { label: "Date", value: esc(o.date || "—") },
          { label: "Promise", value: esc(o.promiseDate || "—") },
          { label: "Status", value: ui.statusBadge(o.status, OR) },
          { label: "Total", value: ui.money(o.total || 0, o.currency) },
        ]) +
        stampRow(o) +
        ui.card("Lines", ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Qty", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "fulfill", label: "Fulfillment", render: (r) => '<span class="erp-fulfill">S ' + ui.qty(r.qtyShipped || 0) + " · D " + ui.qty(r.qtyDelivered || 0) + " · I " + ui.qty(r.qtyInvoiced || 0) + (r.qtyBackordered ? " · BO " + ui.qty(r.qtyBackordered) : "") + "</span>" },
          { key: "lineStatus", label: "Line status", render: (r) => ui.badge(orderLineStatus(r), orderLineStatus(r) === "Invoiced" ? "success" : orderLineStatus(r) === "Backordered" ? "danger" : "info") },
          { key: "total", label: "Line total", align: "right", render: (r) => ui.money(S.lineTotals(r).total, o.currency) },
        ], o.lines || []) +
        '<div class="erp-line-totals">Subtotal <b>' + ui.money(o.subtotal || 0, o.currency) + "</b>&nbsp; Tax <b>" + ui.money(o.taxTotal || 0, o.currency) + '</b>&nbsp; <span class="erp-grand">Total <b>' + ui.money(o.total || 0, o.currency) + "</b></span></div>") +
        (o.notes ? "<p>" + esc(o.notes) + "</p>" : "") +
        activityCard(o),
      foot: ui.btn("Close", { small: true, act: "od-close" }) + " " +
        ui.btn("Edit", { small: true, act: "od-edit" }) + " " +
        (canConfirm ? ui.btn("Confirm order", { small: true, primary: true, act: "od-confirm" }) : "") + " " +
        (canShip ? ui.btn("Record shipment", { small: true, act: "od-ship" }) : "") + " " +
        (canDeliver ? ui.btn("Record delivery", { small: true, act: "od-deliver" }) : "") + " " +
        (canInvoice ? ui.btn("Create invoice", { small: true, primary: true, act: "od-invoice" }) : "") + " " +
        (o.status === "open" ? ui.btn("Delete", { small: true, danger: true, act: "od-del" }) : ""),
    });
    const modalEl = document.querySelector("#uiModal");
    const bindAct = (act, fn) => { const b = modalEl.querySelector("[data-act=" + act + "]"); if (b) b.onclick = fn; };
    bindAct("od-close", () => ui.closeModal());
    bindAct("od-edit", () => { ui.closeModal(); docFormModal(o, "order", state, onChanged); });
    bindAct("od-confirm", async (t) => {
      t.disabled = true;
      try {
        const res = await S.confirmOrder(o);
        ERP.toast(res.hasBackorder ? "Order confirmed — backorders raised as purchasing shortfalls." : "Order confirmed.", res.hasBackorder ? "warn" : "success");
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    });
    bindAct("od-ship", () => qtyModal(o, "ship", state, onChanged));
    bindAct("od-deliver", () => qtyModal(o, "deliver", state, onChanged));
    bindAct("od-invoice", () => qtyModal(o, "invoice", state, onChanged));
    bindAct("od-del", async () => {
      if (o.status !== "open") return;
      if (await ui.confirm({ title: "Delete order?", message: "Only open (unconfirmed) orders can be deleted.", danger: true })) {
        await save(state.allDocs.filter((x) => String(x.id) !== String(o.id)));
        await master.audit({ action: "delete_order", targetType: "order", targetId: o.id, summary: "Deleted " + o.num + "." });
        ui.closeModal(); onChanged();
      }
    });
  }

  function stampRow(o) {
    const st = o.stamps || {};
    const bits = [];
    if (st.confirmedAt) bits.push('<span class="erp-stamp">Confirmed ' + ui.dateTime(st.confirmedAt) + "</span>");
    if (st.shippedAt) bits.push('<span class="erp-stamp">Shipped ' + ui.dateTime(st.shippedAt) + "</span>");
    if (st.deliveredAt) bits.push('<span class="erp-stamp">Delivered ' + ui.dateTime(st.deliveredAt) + "</span>");
    if (st.invoicedAt) bits.push('<span class="erp-stamp">Invoiced ' + ui.dateTime(st.invoicedAt) + "</span>");
    return bits.length ? '<div class="erp-stamp-row">' + bits.join("") + "</div>" : "";
  }

  /* Shared per-line quantity modal for ship / deliver / invoice. */
  function qtyModal(o, mode, state, onChanged) {
    const isInvoice = mode === "invoice";
    const maxFn = (l) => isInvoice ? ((Number(l.qtyDelivered) || 0) - (Number(l.qtyInvoiced) || 0)) : mode === "deliver" ? ((Number(l.qtyShipped) || 0) - (Number(l.qtyDelivered) || 0)) : ((Number(l.qty) || 0) - (Number(l.qtyShipped) || 0));
    const rows = (o.lines || []).filter((l) => maxFn(l) > 0);
    if (!rows.length) { ERP.toast("Nothing left to " + mode + ".", "error"); return; }
    const titleMap = { ship: "Record shipment — " + o.num, deliver: "Record delivery — " + o.num, invoice: "Create invoice from " + o.num };
    const m = ui.modal({
      title: titleMap[mode],
      size: "lg",
      body: '<p class="erp-modal-note">' + (isInvoice ? "Invoices are generated from delivered lines — partial invoicing is allowed." : "Enter quantities to " + mode + ".") + "</p>" +
        ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Qty", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "done", label: mode === "invoice" ? "Invoiced" : mode === "deliver" ? "Delivered" : "Shipped", align: "right", render: (r) => ui.qty(mode === "invoice" ? (r.qtyInvoiced || 0) : mode === "deliver" ? (r.qtyDelivered || 0) : (r.qtyShipped || 0)) },
          { key: "toDo", label: "Quantity", align: "right", render: (r) => '<input type="number" step="any" min="0" max="' + maxFn(r) + '" value="' + maxFn(r) + '" data-qty="' + r.lineNo + '">' },
        ], rows),
      foot: ui.btn("Cancel", { small: true, act: "q-cancel" }) + " " + ui.btn(mode === "invoice" ? "Create invoice" : "Record", { small: true, primary: true, act: "q-save" }),
    });
    const bodyEl = m.querySelector("#uiModalBody");
    m.querySelector("[data-act=q-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=q-save]").onclick = async (t) => {
      const map = {};
      let any = 0;
      for (const row of rows) {
        const v = Number(bodyEl.querySelector('[data-qty="' + row.lineNo + '"]').value) || 0;
        if (v > 0) { map[row.lineNo] = v; any += v; }
      }
      if (!any) { ERP.toast("Enter a quantity.", "error"); return; }
      t.disabled = true;
      try {
        if (mode === "invoice") {
          const inv = await S.invoiceFromOrder(o, map);
          ERP.toast("Invoice " + inv.num + " created (" + ui.money(inv.total) + ").", "success");
        } else if (mode === "deliver") {
          await S.recordDelivery(o, map);
          ERP.toast("Delivery recorded.", "success");
        } else {
          await S.recordShipment(o, map);
          ERP.toast("Shipment recorded.", "success");
        }
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }

  /* ─────────────────────────── Invoices tab ─────────────────────────── */

  async function renderInvoices(panel, state, onChanged) {
    const invoices = S.byKind(state.allDocs, "invoice").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const outstanding = invoices.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amountPaid || 0) - Number(i.amountCredited || 0)), 0);
    const orderOptions = S.byKind(state.allDocs, "order").filter((o) => o.lines.some((l) => (Number(l.qtyDelivered) || 0) > (Number(l.qtyInvoiced) || 0)));
    panel.innerHTML =
      ui.summary([
        { label: "Invoices", value: String(invoices.length) },
        { label: "Outstanding", value: ui.money(outstanding) },
        { label: "Credited", value: String(invoices.filter((i) => i.status === "credited").length) },
      ]) +
      '<div class="erp-toolbar">' +
      ui.btn("New invoice", { primary: true, act: "iv-new" }) +
      "</div>" +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" + (r.orderNum ? '<div class="erp-sub">' + esc(r.orderNum) + "</div>" : "") },
        { key: "party", label: "Party", render: (r) => esc(state.partiesMap[String(r.partyId)] || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "due", label: "Due", render: (r) => esc(r.dueDate || "—") },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, IV) },
        { key: "total", label: "Total", align: "right", render: (r) => ui.money(r.total || 0, r.currency) },
        { key: "left", label: "Open", align: "right", render: (r) => ui.money(Math.max(0, Number(r.total || 0) - Number(r.amountPaid || 0) - Number(r.amountCredited || 0)), r.currency) },
        { key: "actions", label: "", render: (r) => ui.btn("Open", { small: true, act: "iv-open", arg: r.id }) },
      ], invoices, { emptyText: "No invoices yet. Invoices are generated from delivered order lines." });

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "iv-new") {
        if (!orderOptions.length) { ERP.toast("No orders with delivered, uninvoiced lines.", "error"); return; }
        const m = ui.modal({
          title: "Create invoice from order",
          body: '<div class="field"><label>Order</label><select data-iv-order>' + orderOptions.map((o) => '<option value="' + o.id + '">' + esc(o.num + " — " + (state.partiesMap[String(o.partyId)] || "?") + " (" + ui.money(o.total) + ")") + "</option>").join("") + "</select></div>",
          foot: ui.btn("Cancel", { small: true, act: "io-cancel" }) + " " + ui.btn("Next", { small: true, primary: true, act: "io-next" }),
        });
        m.querySelector("[data-act=io-cancel]").onclick = () => ui.closeModal();
        m.querySelector("[data-act=io-next]").onclick = () => {
          const order = orderOptions.find((o) => String(o.id) === m.querySelector("[data-iv-order]").value);
          ui.closeModal();
          if (order) qtyModal(order, "invoice", state, onChanged);
        };
      } else if (act === "iv-open") {
        const inv = invoices.find((x) => String(x.id) === arg);
        if (inv) invoiceDetail(inv, state, onChanged);
      }
    });
  }

  function invoiceDetail(inv, state, onChanged) {
    const open = Math.max(0, Number(inv.total || 0) - Number(inv.amountPaid || 0) - Number(inv.amountCredited || 0));
    const m = ui.modal({
      title: inv.num || "Invoice",
      size: "lg",
      body:
        ui.summary([
          { label: "Party", value: esc(state.partiesMap[String(inv.partyId)] || "—") },
          { label: "Date", value: esc(inv.date || "—") },
          { label: "Due", value: esc(inv.dueDate || "—") },
          { label: "Status", value: ui.statusBadge(inv.status, IV) },
          { label: "Total", value: ui.money(inv.total || 0, inv.currency) },
          { label: "Open", value: ui.money(open, inv.currency) },
        ]) +
        (inv.orderNum ? "<p>Source order: <b>" + esc(inv.orderNum) + "</b></p>" : "") +
        ui.card("Lines", ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Qty", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "price", label: "Unit price", align: "right", render: (r) => ui.money(r.unitPrice || 0, inv.currency) },
          { key: "tax", label: "Tax", align: "right", render: (r) => ui.money(r.taxRate ? S.lineTotals(r).tax : 0, inv.currency) },
          { key: "total", label: "Line total", align: "right", render: (r) => ui.money(S.lineTotals(r).total, inv.currency) },
        ], inv.lines || []) +
        '<div class="erp-line-totals">Subtotal <b>' + ui.money(inv.subtotal || 0, inv.currency) + "</b>&nbsp; Tax <b>" + ui.money(inv.taxTotal || 0, inv.currency) + '</b>&nbsp; <span class="erp-grand">Total <b>' + ui.money(inv.total || 0, inv.currency) + "</b></span></div>") +
        (inv.amountPaid ? '<p class="erp-alert tone-success">Paid ' + ui.money(inv.amountPaid, inv.currency) + "</p>" : "") +
        (inv.amountCredited ? '<p class="erp-alert tone-warn">Credited ' + ui.money(inv.amountCredited, inv.currency) + "</p>" : "") +
        (inv.notes ? "<p>" + esc(inv.notes) + "</p>" : "") +
        activityCard(inv),
      foot: ui.btn("Close", { small: true, act: "id-close" }) + " " +
        (open > 0 ? ui.btn("Credit note", { small: true, danger: true, act: "id-credit" }) : ""),
    });
    const modalEl = document.querySelector("#uiModal");
    const bindAct = (act, fn) => { const b = modalEl.querySelector("[data-act=" + act + "]"); if (b) b.onclick = fn; };
    bindAct("id-close", () => ui.closeModal());
    bindAct("id-credit", () => creditModal(inv, state, onChanged, open));
  }

  function creditModal(inv, state, onChanged, openAmt) {
    const m = ui.modal({
      title: "Credit note against " + inv.num,
      body: ui.form(
        '<p class="erp-modal-note">Crediting an invoice reverses its ledger postings (once finance lands) and marks it as credited. A reason is required.</p>' +
        ui.number("amount", "Credit amount", openAmt, { min: 0.01, step: 0.01, hint: "Open on invoice: " + ui.money(openAmt) }) +
        ui.textarea("reason", "Reason *", "", 2)
      ),
      foot: ui.btn("Cancel", { small: true, act: "cn-cancel" }) + " " + ui.btn("Issue credit note", { small: true, danger: true, act: "cn-save" }),
    });
    const bodyEl = m.querySelector("#uiModalBody");
    m.querySelector("[data-act=cn-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=cn-save]").onclick = async (t) => {
      const f = ui.collect(bodyEl, ["amount", "reason"]);
      t.disabled = true;
      try {
        const cn = await S.createCreditNote(inv, f.amount, f.reason);
        ERP.toast("Credit note " + cn.num + " issued.", "success");
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }

  /* ─────────────────────────── Credit notes tab ─────────────────────────── */

  async function renderCreditNotes(panel, state, onChanged) {
    const cns = S.byKind(state.allDocs, "creditNote").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const total = cns.reduce((s, c) => s + Number(c.amount || 0), 0);
    panel.innerHTML =
      ui.summary([
        { label: "Credit notes", value: String(cns.length) },
        { label: "Total credited", value: ui.money(total) },
      ]) +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" },
        { key: "party", label: "Party", render: (r) => esc(state.partiesMap[String(r.partyId)] || "—") },
        { key: "invoice", label: "Invoice", render: (r) => esc(r.invoiceNum || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "amount", label: "Amount", align: "right", render: (r) => ui.money(r.amount || 0, r.currency) },
        { key: "reason", label: "Reason", render: (r) => esc(r.reason || "—") },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, CN) },
      ], cns, { emptyText: "No credit notes yet. Issue one from an invoice." });
  }

  /* ─────────────────────────── controller ─────────────────────────── */

  S.render = async function (ctx) {
    const el = ctx.el;
    ui.loading(el, "Loading Sales");
    let state;
    try {
      const allDocs = await docs();
      const partiesAll = await master.parties();
      const catalog = await master.catalog();
      const taxes = await master.taxes();
      const cur = await master.currency();
      const partiesMap = {};
      partiesAll.forEach((p) => { partiesMap[String(p.id)] = p.name; });
      state = { allDocs, partiesAll, partiesMap, catalog, taxes, cur, el };
    } catch (e) {
      ctx.error({ title: "Could not load Sales data", message: (e && e.message) || String(e) });
      return;
    }

    const tabDefs = [
      { id: "catalog", label: "Catalog", badge: String(state.catalog.length) },
      { id: "quotes", label: "Quotes", badge: String(S.byKind(state.allDocs, "quote").length) },
      { id: "orders", label: "Orders", badge: String(S.byKind(state.allDocs, "order").length) },
      { id: "invoices", label: "Invoices", badge: String(S.byKind(state.allDocs, "invoice").length) },
      { id: "creditnotes", label: "Credit notes", badge: String(S.byKind(state.allDocs, "creditNote").length) },
    ];
    const active = el.__tab || "quotes";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML = ui.pageHead("Sales", "Quotes, orders, invoices and credit notes — from catalog to cash.", "") + t.html;

    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => { panels[p.getAttribute("data-panel")] = p; });
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));

    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });

    const refresh = async () => {
      S.invalidate();
      state.allDocs = await docs();
      state.partiesAll = await master.parties();
      state.catalog = await master.catalog();
      state.taxes = await master.taxes();
      state.cur = await master.currency();
      state.partiesMap = {};
      state.partiesAll.forEach((p) => { state.partiesMap[String(p.id)] = p.name; });
      await renderPanel(el.__tab || "quotes");
    };

    const renderPanel = async (id) => {
      const p = panels[id];
      if (!p) return;
      if (id === "catalog") await renderCatalog(p, state, refresh);
      else if (id === "quotes") await renderQuotes(p, state, refresh);
      else if (id === "orders") await renderOrders(p, state, refresh);
      else if (id === "invoices") await renderInvoices(p, state, refresh);
      else if (id === "creditnotes") await renderCreditNotes(p, state, refresh);
    };

    await renderPanel(active);
  };
})();
