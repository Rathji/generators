/* ============================================================
   BUSINESS ERP — Purchasing & Inventory module (Tasks 19–23)
   - Inventory (ERP.inventory): stock per product/location derived
     from an append-only movement log (receipt, issue, adjustment,
     transfer, opening) — never free-edited. Current quantities are
     derived; moving-average valuation + COGS come from the same
     log, so inventory value ties out to the ledger at any date.
   - Purchasing (ERP.purchasing): purchase orders with lines,
     expected dates and receipt status; goods receipts post stock-in
     at purchase cost and raise the supplier bill for the ledger in
     the same action; supplier bills & payments with due dates and
     aging; reorder suggestions presented as a finalizable PO.
   - Backorder relief: as goods arrive, backorders on sales orders
     (confirmed/shipped) are relieved in order-date order via
     ERP.sales.backorderedLines / relieveBackorder, posting an issue
     (COGS) movement at the moving-average cost.
   Data lives in the purchasing doc (splitByYear: false) and the
   inventory doc (splitByYear: true — movements partitioned by year).
   All ledger postings are guarded: they fire only when the Phase-7
   finance module is present.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const store = ERP.store;
  const master = ERP.master;
  const P = (ERP.purchasing = {});
  const I = (ERP.inventory = {});
  const esc = ui.esc;

  const TERM_DAYS = { immediate: 0, net15: 15, net30: 30, net60: 60, net90: 90 };

  const PO = {
    draft: { label: "Draft", tone: "muted" },
    sent: { label: "Sent", tone: "info" },
    partial: { label: "Partially received", tone: "warn" },
    received: { label: "Received", tone: "success" },
    closed: { label: "Closed", tone: "muted" },
  };
  const BILL = {
    open: { label: "Open", tone: "info" },
    partial: { label: "Partially paid", tone: "warn" },
    paid: { label: "Paid", tone: "success" },
  };
  const MV = {
    receipt: { label: "Receipt", tone: "success" },
    issue: { label: "Issue", tone: "warn" },
    adjustment: { label: "Adjustment", tone: "danger" },
    opening: { label: "Opening", tone: "muted" },
    transfer: { label: "Transfer", tone: "info" },
  };

  /* ─────────────────────────── data helpers ─────────────────────────── */

  let pcache = null;
  async function pdocs() {
    if (pcache) return pcache;
    const r = await store.loadDoc("purchasing");
    pcache = (r.records || []).slice();
    return pcache;
  }
  P.records = pdocs;
  P.invalidate = () => { pcache = null; };
  async function psave(list) {
    const r = await store.saveDoc("purchasing", list || []);
    pcache = (list || []).slice();
    return r;
  }
  P.byKind = function (list, kind) { return (list || []).filter((r) => (r.kind || "") === kind); };

  let icache = null;
  let stockCache = null;
  async function idocs() {
    if (icache) return icache;
    const r = await store.loadDoc("inventory", { all: true });
    icache = (r.records || []).slice();
    return icache;
  }
  I.movements = idocs;
  I.invalidate = () => { icache = null; stockCache = null; };
  async function isave(list) {
    const r = await store.saveDoc("inventory", list || []);
    icache = (list || []).slice();
    stockCache = null;
    return r;
  }

  function activityRec(rec, type, summary) {
    const act = rec.activity || (rec.activity = []);
    act.push({ id: Date.now(), ts: new Date().toISOString(), type: type || "note", summary: summary || "", by: ERP.role || "owner" });
  }
  function activityCard(rec) {
    const act = rec.activity || [];
    if (!act.length) return "";
    return ui.card("Activity", '<div class="erp-timeline">' + act.slice().reverse().map((a) =>
      '<div class="erp-tl-item"><div class="erp-tl-meta">' + esc(ui.dateTime(a.ts)) + (a.by ? " · " + esc(a.by) : "") + "</div><div>" + esc(a.summary || "") + "</div></div>"
    ).join("") + "</div>");
  }

  /* ─────────────────────────── line & doc math ─────────────────────────── */

  P.computeTotals = function (lines) {
    let subtotal = 0, taxTotal = 0;
    for (const l of (lines || [])) {
      const qty = Number(l.qty) || 0;
      const cost = Number(l.unitCost) || 0;
      const sub = qty * cost;
      subtotal += sub;
      taxTotal += sub * (Number(l.taxRate) || 0) / 100;
    }
    return { subtotal, taxTotal, total: subtotal + taxTotal };
  };
  P.lineTotals = function (l) {
    l = l || {};
    const qty = Number(l.qty) || 0;
    const cost = Number(l.unitCost) || 0;
    const sub = qty * cost;
    const tax = sub * (Number(l.taxRate) || 0) / 100;
    return { sub, tax, total: sub + tax };
  };

  /* ─────────────────────────── cross-module hooks (Phase 7) ─────────────────────────── */

  async function postGoodsIn(m) { if (ERP.finance && typeof ERP.finance.postGoodsIn === "function") return await ERP.finance.postGoodsIn(m); return null; }
  async function postGoodsOut(m) { if (ERP.finance && typeof ERP.finance.postGoodsOut === "function") return await ERP.finance.postGoodsOut(m); return null; }
  async function postOpening(m) { if (ERP.finance && typeof ERP.finance.postOpening === "function") return await ERP.finance.postOpening(m); return null; }
  async function postInventoryAdjustment(m) { if (ERP.finance && typeof ERP.finance.postInventoryAdjustment === "function") return await ERP.finance.postInventoryAdjustment(m); return null; }
  async function postBill(bill) { if (ERP.finance && typeof ERP.finance.postSupplierBill === "function") return await ERP.finance.postSupplierBill(bill); return null; }
  async function postSupplierPayment(pay) { if (ERP.finance && typeof ERP.finance.postSupplierPayment === "function") return await ERP.finance.postSupplierPayment(pay); return null; }

  /* ─────────────────────────── stock derivation & valuation ─────────────────────────── */

  function signedQty(m) {
    return Number(m.qty) || 0;
  }

  /* Moving-average cost for an item over the whole log, and the resulting
     on-hand quantity. Transfer movements net to zero and are skipped. */
  function valuationFor(itemId, movs) {
    let qty = 0, avg = 0;
    for (const m of movs) {
      if (String(m.itemId) !== String(itemId) || m.type === "transfer") continue;
      const q = Number(m.qty) || 0;
      const cost = Number(m.unitCost) || 0;
      if (q >= 0) {
        if (qty + q <= 0) { qty += q; avg = qty <= 0 ? 0 : cost; }
        else { avg = (qty * avg + q * cost) / (qty + q); qty += q; }
      } else {
        qty = Math.max(0, qty + q);
      }
    }
    return { qty, avgCost: qty > 0 ? avg : 0, value: qty > 0 ? qty * avg : 0 };
  }

  /* Current average cost for an item (before any issue is posted). */
  function avgAt(movs, itemId) {
    return valuationFor(itemId, movs).avgCost;
  }

  /* Derived stock per item: qty, moving-average cost, value, locations. */
  I.stock = async function () {
    if (stockCache) return stockCache;
    const movs = await idocs();
    const catalog = await master.catalog();
    const catMap = {};
    catalog.forEach((c) => { catMap[String(c.id)] = c; });
    const itemIds = [];
    movs.forEach((m) => { if (m.itemId != null && itemIds.indexOf(String(m.itemId)) === -1) itemIds.push(String(m.itemId)); });
    const locQty = {};
    for (const m of movs) {
      const k = String(m.itemId);
      if (m.type === "transfer") {
        if (m.fromLocation) { locQty[k] = locQty[k] || {}; locQty[k][m.fromLocation] = (locQty[k][m.fromLocation] || 0) - signedQty(m); }
        if (m.toLocation) { locQty[k] = locQty[k] || {}; locQty[k][m.toLocation] = (locQty[k][m.toLocation] || 0) + signedQty(m); }
      } else {
        const loc = m.location || "Main";
        locQty[k] = locQty[k] || {};
        locQty[k][loc] = (locQty[k][loc] || 0) + signedQty(m);
      }
    }
    const rows = itemIds.map((id) => {
      const val = valuationFor(id, movs);
      const c = catMap[id] || {};
      return {
        itemId: Number(id), name: c.name || ("Item " + id), sku: c.sku || "", uom: c.uom || "",
        qty: val.qty, avgCost: val.avgCost, value: val.value,
        reorderPoint: Number(c.reorderPoint) || 0,
        locations: Object.keys(locQty[id] || {}).map((loc) => ({ location: loc, qty: locQty[id][loc] })),
      };
    });
    rows.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    stockCache = rows;
    return rows;
  };

  /* On-hand quantity of an item across all locations (used by sales confirm). */
  I.available = async function (itemId) {
    const rows = await I.stock();
    const r = rows.find((x) => String(x.itemId) === String(itemId));
    return r ? r.qty : 0;
  };

  I.valuation = async function () {
    const rows = await I.stock();
    return {
      rows,
      totalQty: rows.reduce((s, r) => s + r.qty, 0),
      totalValue: rows.reduce((s, r) => s + r.value, 0),
    };
  };

  /* ─────────────────────────── movement posting ─────────────────────────── */

  let idSeq = 0;
  function uid() { return Date.now() * 1000 + (idSeq = (idSeq + 1) % 1000); }

  function baseMovement(o, type) {
    return {
      id: uid(), kind: "movement", type,
      itemId: o.itemId != null ? Number(o.itemId) : null,
      location: o.location || "Main",
      qty: Number(o.qty) || 0,
      unitCost: Number(o.unitCost) || 0,
      date: o.date || ui.today(),
      refType: o.refType || "", refId: o.refId != null ? o.refId : null, refNum: o.refNum || "",
      note: o.note || "",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: ERP.role || "owner",
    };
  }

  /* Goods receipt: stock-in at purchase cost, then relieve backorders. */
  I.postReceipt = async function (o) {
    if (!(Number(o.qty) > 0)) throw new Error("Receipt quantity must be positive.");
    if (o.itemId == null) throw new Error("Choose an item.");
    const m = baseMovement(o, "receipt");
    const list = await idocs();
    await postGoodsIn(m);
    await isave(list.concat([m]));
    await master.audit({ action: "stock_in", targetType: "item", targetId: m.itemId, summary: "Received " + ui.fmt(m.qty) + " × " + (m.refNum || ("item " + m.itemId)) + " at " + ui.money(m.unitCost) + (m.location ? " → " + m.location : "") + "." });
    await I.relieveBackorders(m.itemId);
    return m;
  };

  /* Issue: stock-out (negative qty). COGS posted at moving-average cost. */
  I.postIssue = async function (o) {
    if (!(Number(o.qty) > 0)) throw new Error("Issue quantity must be positive.");
    if (o.itemId == null) throw new Error("Choose an item.");
    const list = await idocs();
    const avg = avgAt(list, o.itemId);
    const m = baseMovement(o, "issue");
    m.qty = -m.qty;
    m.unitCost = avg;
    const nxt = list.concat([m]);
    await postGoodsOut({ itemId: m.itemId, qty: -m.qty, unitCost: avg, date: m.date, refType: m.refType, refId: m.refId, refNum: m.refNum, location: m.location });
    await isave(nxt);
    await master.audit({ action: "stock_out", targetType: "item", targetId: m.itemId, summary: "Issued " + ui.fmt(-m.qty) + " × " + (m.refNum || ("item " + m.itemId)) + (m.location ? " from " + m.location : "") + "." });
    return m;
  };

  /* Opening balance: positive stock-in at a given cost. */
  I.postOpening = async function (o) {
    if (!(Number(o.qty) > 0)) throw new Error("Opening quantity must be positive.");
    if (o.itemId == null) throw new Error("Choose an item.");
    const m = baseMovement(o, "opening");
    const list = await idocs();
    await postOpening(m);
    await isave(list.concat([m]));
    await master.audit({ action: "stock_opening", targetType: "item", targetId: m.itemId, summary: "Opening balance " + ui.fmt(m.qty) + " × item " + m.itemId + " at " + ui.money(m.unitCost) + "." });
    return m;
  };

  /* Adjustment: signed delta (+/-) against on-hand. */
  I.postAdjustment = async function (o) {
    const delta = Number(o.deltaQty) || 0;
    if (delta === 0) throw new Error("Adjustment quantity cannot be zero.");
    if (o.itemId == null) throw new Error("Choose an item.");
    const m = baseMovement(o, "adjustment");
    m.qty = delta;
    m.note = o.note || "Stock adjustment";
    const list = await idocs();
    await postInventoryAdjustment(m);
    await isave(list.concat([m]));
    await master.audit({ action: "stock_adjust", targetType: "item", targetId: m.itemId, summary: "Adjusted " + (delta > 0 ? "+" : "") + ui.fmt(delta) + " × " + (m.refNum || ("item " + m.itemId)) + "." });
    return m;
  };

  /* Transfer: moves qty between locations (valuation-neutral). */
  I.postTransfer = async function (o) {
    const from = (o.location || "Main").trim(), to = (o.toLocation || "").trim();
    if (!to) throw new Error("Choose a destination location.");
    if (from === to) throw new Error("Source and destination are the same.");
    if (!(Number(o.qty) > 0)) throw new Error("Transfer quantity must be positive.");
    if (o.itemId == null) throw new Error("Choose an item.");
    const m = baseMovement(o, "transfer");
    m.fromLocation = from; m.toLocation = to; m.location = "";
    const list = await idocs();
    await isave(list.concat([m]));
    await master.audit({ action: "stock_transfer", targetType: "item", targetId: m.itemId, summary: "Transferred " + ui.fmt(m.qty) + " × " + (m.refNum || ("item " + m.itemId)) + " from " + from + " to " + to + "." });
    return m;
  };

  /* Relieve sales backorders for an item in order-date order using on-hand
     stock; each relieved line posts an issue (COGS) movement at the current
     moving-average cost. Returns total quantity relieved. */
  I.relieveBackorders = async function (itemId) {
    const avail = await I.available(itemId);
    if (!(avail > 0)) return 0;
    const S = ERP.sales;
    if (!S || typeof S.backorderedLines !== "function") return 0;
    const lines = await S.backorderedLines(itemId);
    if (!lines.length) return 0;
    const movs = await idocs();
    const avg = avgAt(movs, itemId);
    let remaining = avail;
    const issued = [];
    for (const bl of lines) {
      if (!(remaining > 0)) break;
      const q = Math.min(bl.qty, remaining);
      await S.relieveBackorder(bl.order, bl.line, q);
      issued.push({ order: bl.order, line: bl.line, qty: q, refNum: bl.order.num });
      remaining -= q;
    }
    if (!issued.length) return 0;
    let nxt = await idocs();
    for (const it of issued) {
      const m = {
        id: uid(), kind: "movement", type: "issue",
        itemId: Number(itemId), location: "Main", qty: -it.qty, unitCost: avg,
        date: ui.today(), refType: "sales", refId: it.order.id, refNum: it.refNum,
        note: "Backorder relief on goods receipt", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: ERP.role || "owner",
      };
      nxt = nxt.concat([m]);
      await postGoodsOut({ itemId: Number(itemId), qty: it.qty, unitCost: avg, date: ui.today(), refType: "sales", refId: it.order.id, refNum: it.refNum });
    }
    await isave(nxt);
    const total = issued.reduce((s, i) => s + i.qty, 0);
    await master.audit({ action: "backorder_relief", targetType: "item", targetId: Number(itemId), summary: "Relieved " + ui.fmt(total) + " unit(s) of backorders as stock arrived." });
    return total;
  };

  /* ─────────────────────────── reorder suggestions (Task 22) ─────────────────────────── */

  I.reorderSuggestions = async function () {
    const stock = await I.stock();
    const catalog = await master.catalog();
    const catMap = {};
    catalog.forEach((c) => { catMap[String(c.id)] = c; });
    const out = [];
    for (const c of catalog) {
      if (c.type !== "product" || c.active === false) continue;
      const rp = Number(c.reorderPoint) || 0;
      if (!(rp > 0)) continue;
      const row = stock.find((s) => String(s.itemId) === String(c.id));
      const qty = row ? row.qty : 0;
      if (qty < rp) {
        out.push({
          itemId: c.id, name: c.name || ("Item " + c.id), sku: c.sku || "",
          qty, reorderPoint: rp, suggestedQty: Math.max(rp - qty, 0),
          supplierId: c.supplierId != null ? c.supplierId : null,
          unitCost: Number(c.cost) || 0, taxCode: c.taxCode || "NONE", taxRate: 0,
        });
      }
    }
    out.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return out;
  };

  /* Create draft POs for suggestions, grouped by supplier. */
  I.createReorderPOs = async function (suggestions) {
    const groups = {};
    for (const s of (suggestions || [])) {
      const key = String(s.supplierId != null ? s.supplierId : "none");
      (groups[key] = groups[key] || []).push(s);
    }
    const created = [];
    for (const key of Object.keys(groups)) {
      const supplierId = key === "none" ? null : Number(key);
      const lines = groups[key].map((s, i) => ({
        lineNo: i + 1, itemId: s.itemId, description: s.name,
        qty: s.suggestedQty, qtyReceived: 0, unitCost: s.unitCost, taxCode: s.taxCode || "NONE", taxRate: s.taxRate || 0,
      }));
      const po = await P.createPO({
        supplierId, expectedDate: ui.addDays(ui.today(), 14), lines,
        notes: "Auto-generated from reorder suggestions.", source: "reorder", currency: "USD",
      });
      created.push(po);
    }
    return created;
  };

  /* ─────────────────────────── purchasing core actions ─────────────────────────── */

  P.createPO = async function (data) {
    const allDocs = await pdocs();
    const lines = (data.lines || []).filter((l) => l.qty > 0 && (l.description || l.itemId)).map((l, i) => Object.assign({}, l, { lineNo: i + 1, qtyReceived: 0 }));
    if (!lines.length) throw new Error("Add at least one line with a quantity.");
    const totals = P.computeTotals(lines);
    const po = {
      id: master.nextId(allDocs), kind: "po", num: await master.allocateNumber("po"),
      status: "draft", source: data.source || "manual",
      supplierId: data.supplierId != null ? Number(data.supplierId) : null,
      date: data.date || ui.today(), expectedDate: data.expectedDate || "",
      lines, currency: data.currency || "USD", notes: data.notes || "",
      subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "PO created.", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    await psave(allDocs.concat([po]));
    return po;
  };

  P.updatePO = async function (po) {
    const allDocs = await pdocs();
    const lines = (po.lines || []).map((l, i) => Object.assign({}, l, { lineNo: i + 1 }));
    const totals = P.computeTotals(lines);
    const merged = Object.assign({}, po, {
      lines, subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    });
    await psave(allDocs.map((x) => (String(x.id) === String(merged.id) ? merged : x)));
    return merged;
  };

  P.sendPO = async function (po) {
    if (!po || po.kind !== "po") throw new Error("Not a purchase order.");
    if (po.status !== "draft") throw new Error("Only draft POs can be sent.");
    const allDocs = await pdocs();
    po.status = "sent"; po.sentAt = new Date().toISOString();
    activityRec(po, "send", "PO sent to supplier.");
    await psave(allDocs);
    await master.audit({ action: "send_po", targetType: "po", targetId: po.id, summary: "Sent " + po.num + "." });
    return po;
  };

  P.deletePO = async function (po) {
    if (!po || po.kind !== "po") throw new Error("Not a purchase order.");
    if (po.status !== "draft" && po.status !== "sent") throw new Error("Only draft or sent POs can be deleted.");
    const allDocs = await pdocs();
    await psave(allDocs.filter((x) => String(x.id) !== String(po.id)));
    return true;
  };

  /* Goods receipt against selected lines: posts stock-in at purchase cost
     and raises the supplier bill for the ledger in the same action. */
  P.receivePO = async function (po, qtyMap) {
    if (!po || po.kind !== "po") throw new Error("Not a purchase order.");
    if (po.status === "received" || po.status === "closed") throw new Error("This PO is already fully received.");
    if (po.status === "draft") throw new Error("Send the PO before receiving goods.");
    const allDocs = await pdocs();
    const map = qtyMap || {};
    const received = [];
    for (const l of (po.lines || [])) {
      const v = Number(map[l.lineNo]) || 0;
      if (v > 0) {
        l.qtyReceived = (l.qtyReceived || 0) + v;
        received.push({ line: l, qty: v });
      }
    }
    if (!received.length) throw new Error("Enter a quantity to receive.");
    for (const r of received) {
      await I.postReceipt({
        itemId: r.line.itemId, location: "Main", qty: r.qty, unitCost: Number(r.line.unitCost) || 0,
        date: ui.today(), refType: "po", refId: po.id, refNum: po.num, note: "Goods receipt for " + po.num,
      });
    }
    const fullyReceived = (po.lines || []).every((l) => (Number(l.qtyReceived) || 0) >= (Number(l.qty) || 0));
    po.status = fullyReceived ? "received" : "partial";
    po.receivedAt = po.receivedAt || new Date().toISOString();
    const totalQty = received.reduce((s, r) => s + r.qty, 0);
    activityRec(po, "receive", "Received " + ui.fmt(totalQty) + " unit(s).");
    await psave(allDocs);
    const bill = await P.createBillFromPO(po, received);
    await master.audit({ action: "receive_po", targetType: "po", targetId: po.id, summary: "Received " + ui.fmt(totalQty) + " unit(s) on " + po.num + " → bill " + bill.num + "." });
    return { any: totalQty, bill, fullyReceived };
  };

  P.createBillFromPO = async function (po, received) {
    const allDocs = await pdocs();
    const lines = received.map((r) => Object.assign({}, r.line, { qty: r.qty }));
    const totals = P.computeTotals(lines);
    const supplier = await master.party(po.supplierId);
    const days = TERM_DAYS[((supplier && supplier.paymentTerms) || "net30")] != null ? TERM_DAYS[((supplier && supplier.paymentTerms) || "net30")] : 30;
    const bill = {
      id: master.nextId(allDocs), kind: "bill", num: await master.allocateNumber("bill"),
      supplierId: po.supplierId, poId: po.id, poNum: po.num, date: ui.today(), dueDate: ui.addDays(ui.today(), days),
      lines, currency: po.currency || "USD", notes: "Bill from goods receipt of " + po.num,
      status: "open", subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      amountPaid: 0, fromReceipt: true, ledgerEntries: null,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Bill created from goods receipt of " + po.num + ".", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    allDocs.push(bill);
    const journal = await postBill(bill);
    if (journal) bill.ledgerEntries = { journalId: journal.id, num: journal.num };
    await psave(allDocs);
    return bill;
  };

  /* Direct supplier bill (no PO). */
  P.createBill = async function (data) {
    const allDocs = await pdocs();
    const lines = (data.lines || []).filter((l) => l.qty > 0 && (l.description || l.itemId)).map((l, i) => Object.assign({}, l, { lineNo: i + 1 }));
    if (!lines.length) throw new Error("Add at least one line with a quantity.");
    if (data.supplierId == null) throw new Error("Choose a supplier.");
    const totals = P.computeTotals(lines);
    const supplier = await master.party(data.supplierId);
    const days = TERM_DAYS[((supplier && supplier.paymentTerms) || "net30")] != null ? TERM_DAYS[((supplier && supplier.paymentTerms) || "net30")] : 30;
    const bill = {
      id: master.nextId(allDocs), kind: "bill", num: await master.allocateNumber("bill"),
      supplierId: Number(data.supplierId), poId: data.poId != null ? data.poId : null, poNum: data.poNum || "",
      date: data.date || ui.today(), dueDate: data.dueDate || ui.addDays(ui.today(), days),
      lines, currency: data.currency || "USD", notes: data.notes || "",
      status: "open", subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total,
      amountPaid: 0, ledgerEntries: null,
      activity: [{ id: Date.now(), ts: new Date().toISOString(), type: "create", summary: "Bill created.", by: ERP.role || "owner" }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    const journal = await postBill(bill);
    if (journal) bill.ledgerEntries = { journalId: journal.id, num: journal.num };
    await psave(allDocs.concat([bill]));
    return bill;
  };

  /* Pay a supplier bill: posts the payment and clears the referenced bill. */
  P.payBill = async function (bill, amount, method, date, ref) {
    if (!bill || bill.kind !== "bill") throw new Error("Not a bill.");
    amount = Number(amount);
    if (!isFinite(amount) || amount <= 0) throw new Error("Enter a payment amount greater than zero.");
    const remaining = Number(bill.total) - Number(bill.amountPaid || 0);
    if (amount > remaining + 0.0001) throw new Error("Payment exceeds what is owed on this bill.");
    const allDocs = await pdocs();
    const pay = {
      id: master.nextId(allDocs), kind: "payment", num: await master.allocateNumber("supplierPayment"),
      supplierId: bill.supplierId, billId: bill.id, billNum: bill.num,
      date: date || ui.today(), amount, method: method || "bank", ref: ref || "", status: "posted", ledgerEntries: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), updatedBy: ERP.role || "owner",
    };
    bill.amountPaid = (Number(bill.amountPaid) || 0) + amount;
    bill.status = bill.amountPaid >= bill.total - 0.0001 ? "paid" : "partial";
    activityRec(bill, "payment", "Paid " + ui.money(amount) + (ref ? " (" + esc(ref) + ")" : "") + ".");
    allDocs.push(pay);
    const journal = await postSupplierPayment(pay);
    if (journal) pay.ledgerEntries = { journalId: journal.id, num: journal.num };
    await psave(allDocs);
    await master.audit({ action: "pay_supplier", targetType: "bill", targetId: bill.id, summary: "Payment " + pay.num + " (" + ui.money(amount) + ") against " + bill.num + "." });
    return pay;
  };

  /* Supplier balance: outstanding on bills. */
  P.supplierBalance = async function (supplierId, bills) {
    bills = bills || P.byKind(await pdocs(), "bill");
    return bills.filter((b) => String(b.supplierId) === String(supplierId))
      .reduce((s, b) => s + Math.max(0, Number(b.total || 0) - Number(b.amountPaid || 0)), 0);
  };

  /* ─────────────────────────── line editor (purchase) ─────────────────────────── */

  function itemOptions(catalog, sel) {
    return '<option value="">Custom / one-off…</option>' + (catalog || []).map((c) => '<option value="' + c.id + '"' + (String(c.id) === String(sel) ? " selected" : "") + ">" + esc(c.name + (c.sku ? " (" + c.sku + ")" : "")) + "</option>").join("");
  }
  function taxOptions(taxes, sel) {
    return (taxes || []).map((t) => '<option value="' + esc(t.code) + '"' + (t.code === sel ? " selected" : "") + ">" + esc(t.code + (t.rate ? " — " + t.rate + "%" : "")) + "</option>").join("");
  }
  function poLineRowHtml(l, catalog, taxes) {
    l = l || {};
    return '<div class="erp-line-row" data-line-row>' +
      '<select class="erp-li-item" data-li-item>' + itemOptions(catalog, l.itemId) + "</select>" +
      '<input class="erp-li-desc" type="text" placeholder="Description" value="' + esc(l.description || "") + '">' +
      '<input class="erp-li-qty" type="number" step="any" min="0" value="' + (l.qty == null ? 1 : l.qty) + '">' +
      '<input class="erp-li-price" type="number" step="any" min="0" value="' + (l.unitCost == null ? "" : l.unitCost) + '">' +
      '<select class="erp-li-tax" data-li-tax>' + taxOptions(taxes, l.taxCode || "NONE") + "</select>" +
      '<span class="erp-li-total" data-li-total></span>' +
      '<button type="button" class="icon-btn" data-li-del title="Remove line" aria-label="Remove line">×</button>' +
      "</div>";
  }
  function poLineEditorHtml(lines, catalog, taxes) {
    const rows = (lines && lines.length ? lines : [null]).map((l) => poLineRowHtml(l, catalog, taxes)).join("");
    return '<div class="erp-line-rows" data-line-rows>' + rows + "</div>" +
      '<div class="erp-btn-row">' + ui.btn("Add line", { small: true, act: "pli-add" }) + "</div>" +
      '<div class="erp-line-totals" data-li-totals></div>';
  }
  function wirePoLineEditor(body, catalog, taxes, cur) {
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
          unitCost: Number(row.querySelector("[data-li-price]").value) || 0,
          taxCode, taxRate,
          uom: (it && it.uom) || "",
        };
      });
    }
    function recalc() {
      const rows = readRows();
      const t = P.computeTotals(rows);
      rows.forEach((r, i) => {
        const rowEl = rowsCtn.querySelectorAll("[data-line-row]")[i];
        if (rowEl) rowEl.querySelector("[data-li-total]").textContent = ui.money(P.lineTotals(r).total, cur);
      });
      totalsEl.innerHTML = "Subtotal <b>" + ui.money(t.subtotal, cur) + "</b>&nbsp; Tax <b>" + ui.money(t.taxTotal, cur) + '</b>&nbsp; <span class="erp-grand">Total <b>' + ui.money(t.total, cur) + "</b></span>";
    }
    function addRow(l) {
      const div = document.createElement("div");
      div.innerHTML = poLineRowHtml(l, catalog, taxes);
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
          row.querySelector("[data-li-price]").value = it.cost != null ? it.cost : "";
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
    body.querySelector("[data-act=pli-add]").addEventListener("click", () => addRow(null));
    recalc();
    return { readRows, recalc };
  }

  /* ─────────────────────────── Purchasing render ─────────────────────────── */

  P.render = async function (ctx) {
    const el = ctx.el;
    ui.loading(el, "Loading Purchasing");
    let state;
    try {
      const allDocs = await pdocs();
      const partiesAll = await master.parties();
      const catalog = await master.catalog();
      const taxes = await master.taxes();
      const cur = await master.currency();
      const partiesMap = {};
      partiesAll.forEach((p) => { partiesMap[String(p.id)] = p.name; });
      state = { allDocs, partiesAll, partiesMap, catalog, taxes, cur, el };
    } catch (e) {
      ctx.error({ title: "Could not load Purchasing data", message: (e && e.message) || String(e) });
      return;
    }
    const tabDefs = [
      { id: "pos", label: "Purchase orders", badge: String(P.byKind(state.allDocs, "po").length) },
      { id: "bills", label: "Supplier bills", badge: String(P.byKind(state.allDocs, "bill").length) },
      { id: "payments", label: "Payments", badge: String(P.byKind(state.allDocs, "payment").length) },
    ];
    const active = el.__tab || "pos";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML = ui.pageHead("Purchasing", "Purchase orders, goods receipts & supplier bills.", "") + t.html;
    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => { panels[p.getAttribute("data-panel")] = p; });
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));
    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });
    const refresh = async () => {
      P.invalidate(); I.invalidate();
      state.allDocs = await pdocs();
      state.partiesAll = await master.parties();
      state.catalog = await master.catalog();
      state.taxes = await master.taxes();
      state.cur = await master.currency();
      state.partiesMap = {};
      state.partiesAll.forEach((p) => { state.partiesMap[String(p.id)] = p.name; });
      await renderPanel(el.__tab || "pos");
    };
    const renderPanel = async (id) => {
      const p = panels[id];
      if (!p) return;
      if (id === "pos") await renderPOs(p, state, refresh);
      else if (id === "bills") await renderBills(p, state, refresh);
      else if (id === "payments") await renderPayments(p, state, refresh);
    };
    await renderPanel(active);
  };

  function poFormModal(doc, state, onChanged) {
    const isNew = !doc;
    const suppliers = state.partiesAll.filter((p) => p.type === "supplier" || p.type === "both");
    const supplierOpts = suppliers.map((p) => ({ value: p.id, label: p.name }));
    const body = ui.form(
      ui.select("supplierId", "Supplier", supplierOpts, doc && doc.supplierId, "Choose a supplier…") +
      ui.dateInput("expectedDate", "Expected delivery", (doc && doc.expectedDate) || ui.addDays(ui.today(), 14)) +
      ui.textarea("notes", "Notes", (doc && doc.notes) || "", 2) +
      '<div class="field"><label>Lines</label>' + poLineEditorHtml((doc && doc.lines) || [], state.catalog, state.taxes) + "</div>"
    );
    const m = ui.modal({
      title: isNew ? "New purchase order" : "Edit PO " + (doc.num || ""),
      size: "lg",
      body,
      foot: ui.btn("Cancel", { small: true, act: "po-cancel" }) + " " + ui.btn(isNew ? "Create PO" : "Save changes", { small: true, primary: true, act: "po-save" }),
    });
    const bodyEl = m.querySelector("#uiModalBody");
    m.querySelector("[data-act=po-cancel]").onclick = () => ui.closeModal();
    const editor = wirePoLineEditor(bodyEl, state.catalog, state.taxes, state.cur);
    m.querySelector("[data-act=po-save]").onclick = async (t) => {
      const f = ui.collect(bodyEl, ["supplierId", "expectedDate", "notes"]);
      const lines = editor.readRows().filter((l) => l.qty > 0 && (l.description || l.itemId));
      if (!lines.length) { ERP.toast("Add at least one line with a quantity.", "error"); return; }
      t.disabled = true;
      try {
        if (isNew) {
          const po = await P.createPO({ supplierId: f.supplierId ? Number(f.supplierId) : null, expectedDate: f.expectedDate || "", notes: f.notes || "", lines });
          await master.audit({ action: "create_po", targetType: "po", targetId: po.id, summary: "PO " + po.num + " (" + ui.money(po.total) + ") created." });
          ERP.toast("PO " + po.num + " created.", "success");
        } else {
          const merged = Object.assign({}, doc, { supplierId: f.supplierId ? Number(f.supplierId) : null, expectedDate: f.expectedDate || "", notes: f.notes || "" });
          merged.lines = lines;
          await P.updatePO(merged);
          ERP.toast("PO updated.", "success");
        }
        ui.closeModal(); onChanged();
      } catch (e) {
        t.disabled = false;
        ERP.toast("Could not save: " + ((e && e.message) || e), "error");
      }
    };
  }

  function receiveModal(po, state, onChanged) {
    const rows = (po.lines || []).filter((l) => (Number(l.qtyReceived) || 0) < (Number(l.qty) || 0));
    if (!rows.length) { ERP.toast("Nothing left to receive.", "error"); return; }
    const m = ui.modal({
      title: "Receive goods — " + po.num,
      size: "lg",
      body: '<p class="erp-modal-note">Receiving posts stock-in at purchase cost and raises the supplier bill in the same action.</p>' +
        ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Ordered", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "recv", label: "Received", align: "right", render: (r) => ui.qty(r.qtyReceived || 0) },
          { key: "cost", label: "Unit cost", align: "right", render: (r) => ui.money(r.unitCost || 0) },
          { key: "toDo", label: "To receive", align: "right", render: (r) => '<input type="number" step="any" min="0" max="' + ((Number(r.qty) || 0) - (Number(r.qtyReceived) || 0)) + '" value="' + ((Number(r.qty) || 0) - (Number(r.qtyReceived) || 0)) + '" data-qty="' + r.lineNo + '">' },
        ], rows),
      foot: ui.btn("Cancel", { small: true, act: "rc-cancel" }) + " " + ui.btn("Receive goods", { small: true, primary: true, act: "rc-save" }),
    });
    const bodyEl = m.querySelector("#uiModalBody");
    m.querySelector("[data-act=rc-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=rc-save]").onclick = async (t) => {
      const map = {};
      let any = 0;
      for (const row of rows) {
        const v = Number(bodyEl.querySelector('[data-qty="' + row.lineNo + '"]').value) || 0;
        if (v > 0) { map[row.lineNo] = v; any += v; }
      }
      if (!any) { ERP.toast("Enter a quantity to receive.", "error"); return; }
      t.disabled = true;
      try {
        const res = await P.receivePO(po, map);
        ERP.toast("Received " + ui.fmt(res.any) + " unit(s) — bill " + res.bill.num + " (" + ui.money(res.bill.total) + ") raised.", "success");
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }

  function poDetail(po, state, onChanged) {
    const remaining = (po.lines || []).some((l) => (Number(l.qtyReceived) || 0) < (Number(l.qty) || 0));
    const m = ui.modal({
      title: po.num || "Purchase order",
      size: "lg",
      body:
        ui.summary([
          { label: "Supplier", value: esc(state.partiesMap[String(po.supplierId)] || "—") },
          { label: "Date", value: esc(po.date || "—") },
          { label: "Expected", value: esc(po.expectedDate || "—") },
          { label: "Status", value: ui.statusBadge(po.status, PO) },
          { label: "Total", value: ui.money(po.total || 0, po.currency) },
        ]) +
        (po.source ? '<p class="erp-modal-note">Source: <b>' + esc(po.source) + "</b>" + (po.orderNum ? " · order " + esc(po.orderNum) : "") + "</p>" : "") +
        ui.card("Lines", ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Qty", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "recv", label: "Received", align: "right", render: (r) => ui.qty(r.qtyReceived || 0) },
          { key: "cost", label: "Unit cost", align: "right", render: (r) => ui.money(r.unitCost || 0, po.currency) },
          { key: "total", label: "Line total", align: "right", render: (r) => ui.money(P.lineTotals(r).total, po.currency) },
        ], po.lines || []) +
        '<div class="erp-line-totals">Subtotal <b>' + ui.money(po.subtotal || 0, po.currency) + "</b>&nbsp; Tax <b>" + ui.money(po.taxTotal || 0, po.currency) + '</b>&nbsp; <span class="erp-grand">Total <b>' + ui.money(po.total || 0, po.currency) + "</b></span></div>") +
        (po.notes ? "<p>" + esc(po.notes) + "</p>" : "") +
        activityCard(po),
      foot: ui.btn("Close", { small: true, act: "pd-close" }) + " " +
        (po.status === "draft" ? ui.btn("Edit", { small: true, act: "pd-edit" }) + " " + ui.btn("Send to supplier", { small: true, primary: true, act: "pd-send" }) + " " + ui.btn("Delete", { small: true, danger: true, act: "pd-del" }) : "") +
        (po.status === "sent" || po.status === "partial" ? ui.btn("Receive goods", { small: true, primary: true, act: "pd-receive" }) : "") +
        (po.status === "received" ? ui.btn("Close PO", { small: true, act: "pd-closepo" }) : ""),
    });
    const modalEl = document.querySelector("#uiModal");
    const bindAct = (act, fn) => { const b = modalEl.querySelector("[data-act=" + act + "]"); if (b) b.onclick = fn; };
    bindAct("pd-close", () => ui.closeModal());
    bindAct("pd-edit", () => { ui.closeModal(); poFormModal(po, state, onChanged); });
    bindAct("pd-del", async () => {
      const ok = await ui.confirm({ title: "Delete PO", message: "Delete " + po.num + "? This cannot be undone.", danger: true });
      if (!ok) return;
      try { await P.deletePO(po); ERP.toast("PO deleted.", "success"); ui.closeModal(); onChanged(); }
      catch (err) { ERP.toast(err.message || String(err), "error"); }
    });
    bindAct("pd-send", async (t) => {
      t.disabled = true;
      try { await P.sendPO(po); ERP.toast(po.num + " sent to supplier.", "success"); ui.closeModal(); onChanged(); }
      catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    });
    bindAct("pd-receive", () => { ui.closeModal(); receiveModal(po, state, onChanged); });
    bindAct("pd-closepo", async () => {
      const all = await pdocs();
      po.status = "closed";
      await psave(all);
      ERP.toast(po.num + " closed.", "success");
      ui.closeModal(); onChanged();
    });
  }

  async function renderPOs(panel, state, onChanged) {
    const pos = P.byKind(state.allDocs, "po").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const openVal = pos.filter((p) => p.status === "sent" || p.status === "partial").reduce((s, p) => s + Number(p.total || 0), 0);
    const q = (panel.__q || "").toLowerCase();
    const rows = pos.filter((p) => !q || (p.num || "").toLowerCase().indexOf(q) !== -1 || (state.partiesMap[String(p.supplierId)] || "").toLowerCase().indexOf(q) !== -1);
    panel.innerHTML =
      ui.summary([
        { label: "Purchase orders", value: String(pos.length) },
        { label: "Open value", value: ui.money(openVal) },
        { label: "Awaiting receipt", value: String(pos.filter((p) => p.status === "sent" || p.status === "partial").length) },
      ]) +
      '<div class="erp-toolbar">' +
      '<input type="search" placeholder="Search POs…" value="' + esc(panel.__q || "") + '" data-po-q>' +
      ui.btn("New PO", { primary: true, act: "po-new" }) +
      "</div>" +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" + (r.source === "shortfall" ? '<div class="erp-sub">shortfall</div>' : r.source === "reorder" ? '<div class="erp-sub">reorder</div>' : "") },
        { key: "supplier", label: "Supplier", render: (r) => esc(state.partiesMap[String(r.supplierId)] || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "expected", label: "Expected", render: (r) => esc(r.expectedDate || "—") },
        { key: "recv", label: "Received", render: (r) => {
          const total = (r.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0);
          const got = (r.lines || []).reduce((s, l) => s + (Number(l.qtyReceived) || 0), 0);
          return got + " / " + total;
        } },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, PO) },
        { key: "total", label: "Total", align: "right", render: (r) => ui.money(r.total || 0, r.currency) },
        { key: "actions", label: "", render: (r) => ui.btn("Open", { small: true, act: "po-open", arg: r.id }) },
      ], rows, { emptyText: "No purchase orders yet." });
    panel.querySelector("[data-po-q]").addEventListener("input", (e) => { panel.__q = e.target.value; renderPOs(panel, state, onChanged); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "po-new") poFormModal(null, state, onChanged);
      else if (act === "po-open") {
        const po = pos.find((x) => String(x.id) === arg);
        if (po) poDetail(po, state, onChanged);
      }
    });
  }

  function billDetail(bill, state, onChanged) {
    const open = Math.max(0, Number(bill.total || 0) - Number(bill.amountPaid || 0));
    const m = ui.modal({
      title: bill.num || "Bill",
      size: "lg",
      body:
        ui.summary([
          { label: "Supplier", value: esc(state.partiesMap[String(bill.supplierId)] || "—") },
          { label: "Date", value: esc(bill.date || "—") },
          { label: "Due", value: esc(bill.dueDate || "—") },
          { label: "Status", value: ui.statusBadge(bill.status, BILL) },
          { label: "Total", value: ui.money(bill.total || 0, bill.currency) },
          { label: "Open", value: ui.money(open, bill.currency) },
        ]) +
        (bill.poNum ? "<p>Source PO: <b>" + esc(bill.poNum) + "</b></p>" : "") +
        ui.card("Lines", ui.table([
          { key: "desc", label: "Description", render: (r) => esc(r.description || "—") },
          { key: "qty", label: "Qty", align: "right", render: (r) => ui.qty(r.qty) },
          { key: "cost", label: "Unit cost", align: "right", render: (r) => ui.money(r.unitCost || 0, bill.currency) },
          { key: "total", label: "Line total", align: "right", render: (r) => ui.money(P.lineTotals(r).total, bill.currency) },
        ], bill.lines || []) +
        '<div class="erp-line-totals">Subtotal <b>' + ui.money(bill.subtotal || 0, bill.currency) + "</b>&nbsp; Tax <b>" + ui.money(bill.taxTotal || 0, bill.currency) + '</b>&nbsp; <span class="erp-grand">Total <b>' + ui.money(bill.total || 0, bill.currency) + "</b></span></div>") +
        (bill.amountPaid ? '<p class="erp-alert tone-success">Paid ' + ui.money(bill.amountPaid, bill.currency) + "</p>" : "") +
        (bill.notes ? "<p>" + esc(bill.notes) + "</p>" : "") +
        activityCard(bill),
      foot: ui.btn("Close", { small: true, act: "bd-close" }) + " " +
        (open > 0 ? ui.btn("Record payment", { small: true, primary: true, act: "bd-pay" }) : ""),
    });
    const modalEl = document.querySelector("#uiModal");
    const bindAct = (act, fn) => { const b = modalEl.querySelector("[data-act=" + act + "]"); if (b) b.onclick = fn; };
    bindAct("bd-close", () => ui.closeModal());
    bindAct("bd-pay", () => { ui.closeModal(); payModal(bill, state, onChanged, open); });
  }

  function payModal(bill, state, onChanged, openAmt) {
    const m = ui.modal({
      title: "Record payment — " + bill.num,
      body: ui.form(
        ui.number("amount", "Amount", openAmt != null ? openAmt : "", { min: 0, hint: "Open on this bill: " + ui.money(openAmt != null ? openAmt : Math.max(0, Number(bill.total) - Number(bill.amountPaid || 0))) }) +
        ui.dateInput("date", "Date", ui.today()) +
        ui.text("method", "Method", "bank", "bank / cash / card…") +
        ui.text("ref", "Reference", "")
      ),
      foot: ui.btn("Cancel", { small: true, act: "py-cancel" }) + " " + ui.btn("Record payment", { small: true, primary: true, act: "py-save" }),
    });
    m.querySelector("[data-act=py-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=py-save]").onclick = async (t) => {
      const f = ui.collect(m, ["amount", "date", "method", "ref"]);
      if (!(Number(f.amount) > 0)) { ERP.toast("Enter an amount.", "error"); return; }
      t.disabled = true;
      try {
        await P.payBill(bill, Number(f.amount), (f.method || "bank").trim(), f.date || ui.today(), (f.ref || "").trim());
        ERP.toast("Payment recorded.", "success");
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }

  function billFormModal(state, onChanged) {
    const suppliers = state.partiesAll.filter((p) => p.type === "supplier" || p.type === "both");
    const body = ui.form(
      ui.select("supplierId", "Supplier", suppliers.map((p) => ({ value: p.id, label: p.name })), null, "Choose a supplier…") +
      ui.dateInput("date", "Bill date", ui.today()) +
      ui.dateInput("dueDate", "Due date", "") +
      ui.textarea("notes", "Notes", "", 2) +
      '<div class="field"><label>Lines</label>' + poLineEditorHtml(null, state.catalog, state.taxes) + "</div>"
    );
    const m = ui.modal({
      title: "New supplier bill",
      size: "lg",
      body,
      foot: ui.btn("Cancel", { small: true, act: "bf-cancel" }) + " " + ui.btn("Create bill", { small: true, primary: true, act: "bf-save" }),
    });
    const bodyEl = m.querySelector("#uiModalBody");
    m.querySelector("[data-act=bf-cancel]").onclick = () => ui.closeModal();
    const editor = wirePoLineEditor(bodyEl, state.catalog, state.taxes, state.cur);
    m.querySelector("[data-act=bf-save]").onclick = async (t) => {
      const f = ui.collect(bodyEl, ["supplierId", "date", "dueDate", "notes"]);
      const lines = editor.readRows().filter((l) => l.qty > 0 && (l.description || l.itemId));
      if (!f.supplierId) { ERP.toast("Choose a supplier.", "error"); return; }
      if (!lines.length) { ERP.toast("Add at least one line.", "error"); return; }
      t.disabled = true;
      try {
        const bill = await P.createBill({ supplierId: Number(f.supplierId), date: f.date || ui.today(), dueDate: f.dueDate || "", notes: f.notes || "", lines });
        await master.audit({ action: "create_bill", targetType: "bill", targetId: bill.id, summary: "Bill " + bill.num + " (" + ui.money(bill.total) + ") from " + (state.partiesMap[String(bill.supplierId)] || "?") + "." });
        ERP.toast("Bill " + bill.num + " created.", "success");
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }

  async function renderBills(panel, state, onChanged) {
    const bills = P.byKind(state.allDocs, "bill").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const outstanding = bills.reduce((s, b) => s + Math.max(0, Number(b.total || 0) - Number(b.amountPaid || 0)), 0);
    const today = ui.today();
    const overdue = bills.filter((b) => b.dueDate && b.dueDate < today && (Number(b.total || 0) - Number(b.amountPaid || 0)) > 0.0001).length;
    panel.innerHTML =
      ui.summary([
        { label: "Bills", value: String(bills.length) },
        { label: "Outstanding", value: ui.money(outstanding) },
        { label: "Overdue", value: String(overdue) },
      ]) +
      '<div class="erp-toolbar">' +
      ui.btn("New bill", { primary: true, act: "bl-new" }) +
      "</div>" +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" + (r.poNum ? '<div class="erp-sub">' + esc(r.poNum) + "</div>" : "") },
        { key: "supplier", label: "Supplier", render: (r) => esc(state.partiesMap[String(r.supplierId)] || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "due", label: "Due", render: (r) => esc(r.dueDate || "—") + (r.dueDate && r.dueDate < today && (Number(r.total) - Number(r.amountPaid || 0)) > 0.0001 ? " " + ui.badge("overdue", "danger") : "") },
        { key: "status", label: "Status", render: (r) => ui.statusBadge(r.status, BILL) },
        { key: "total", label: "Total", align: "right", render: (r) => ui.money(r.total || 0, r.currency) },
        { key: "open", label: "Open", align: "right", render: (r) => ui.money(Math.max(0, Number(r.total || 0) - Number(r.amountPaid || 0)), r.currency) },
        { key: "actions", label: "", render: (r) => ui.btn("Open", { small: true, act: "bl-open", arg: r.id }) },
      ], bills, { emptyText: "No supplier bills yet." });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "bl-new") billFormModal(state, onChanged);
      else if (act === "bl-open") {
        const bill = bills.find((x) => String(x.id) === arg);
        if (bill) billDetail(bill, state, onChanged);
      }
    });
  }

  async function renderPayments(panel, state, onChanged) {
    const pays = P.byKind(state.allDocs, "payment").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    panel.innerHTML =
      ui.summary([
        { label: "Payments", value: String(pays.length) },
        { label: "Total paid", value: ui.money(pays.reduce((s, p) => s + Number(p.amount || 0), 0)) },
      ]) +
      ui.table([
        { key: "num", label: "Number", render: (r) => "<b>" + esc(r.num || "—") + "</b>" },
        { key: "supplier", label: "Supplier", render: (r) => esc(state.partiesMap[String(r.supplierId)] || "—") },
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "method", label: "Method", render: (r) => esc(r.method || "—") },
        { key: "ref", label: "Reference", render: (r) => esc(r.ref || "—") },
        { key: "bill", label: "Bill", render: (r) => esc(r.billNum || "—") },
        { key: "amount", label: "Amount", align: "right", render: (r) => ui.money(r.amount || 0) },
      ], pays, { emptyText: "No supplier payments yet." });
  }

  /* ─────────────────────────── Inventory render ─────────────────────────── */

  I.render = async function (ctx) {
    const el = ctx.el;
    ui.loading(el, "Loading Inventory");
    let state;
    try {
      const stock = await I.stock();
      const movs = await I.movements();
      const catalog = await master.catalog();
      const partiesAll = await master.parties();
      const taxes = await master.taxes();
      state = { stock, movs, catalog, partiesAll, taxes, el };
    } catch (e) {
      ctx.error({ title: "Could not load Inventory data", message: (e && e.message) || String(e) });
      return;
    }
    const lowCount = state.stock.filter((r) => r.reorderPoint > 0 && r.qty < r.reorderPoint).length;
    const tabDefs = [
      { id: "stock", label: "Stock", badge: String(state.stock.filter((r) => r.qty > 0).length) },
      { id: "movements", label: "Movements", badge: String(state.movs.length) },
      { id: "valuation", label: "Valuation" },
      { id: "reorder", label: "Reorder", badge: lowCount ? String(lowCount) : "" },
    ];
    const active = el.__tab || "stock";
    const t = ui.tabs(tabDefs, active);
    el.innerHTML = ui.pageHead("Inventory", "Stock movements, levels & moving-average valuation.", "") + t.html;
    const panels = {};
    el.querySelectorAll("[data-panel]").forEach((p) => { panels[p.getAttribute("data-panel")] = p; });
    el.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === active));
    ui.bind(el, "click", "[data-tab]", async (tEl) => {
      el.__tab = tEl.getAttribute("data-tab");
      ui.showTab(el, el.__tab);
      await renderPanel(el.__tab);
    });
    const refresh = async () => {
      I.invalidate(); P.invalidate();
      state.stock = await I.stock();
      state.movs = await I.movements();
      state.catalog = await master.catalog();
      state.partiesAll = await master.parties();
      state.taxes = await master.taxes();
      await renderPanel(el.__tab || "stock");
    };
    const renderPanel = async (id) => {
      const p = panels[id];
      if (!p) return;
      if (id === "stock") await renderStock(p, state, refresh);
      else if (id === "movements") await renderMovements(p, state, refresh);
      else if (id === "valuation") await renderValuation(p, state, refresh);
      else if (id === "reorder") await renderReorder(p, state, refresh);
    };
    await renderPanel(active);
  };

  function movementModal(pre, state, onChanged) {
    const products = state.catalog.filter((c) => c.type === "product");
    const itemOpts = products.map((c) => ({ value: c.id, label: c.name + (c.sku ? " (" + c.sku + ")" : "") }));
    const m = ui.modal({
      title: "Record stock movement",
      size: "lg",
      body: ui.form(
        ui.select("type", "Type", [
          { value: "receipt", label: "Goods receipt (stock in)" },
          { value: "issue", label: "Issue (stock out)" },
          { value: "adjustment", label: "Adjustment (+/-)" },
          { value: "transfer", label: "Transfer between locations" },
          { value: "opening", label: "Opening balance" },
        ], (pre && pre.type) || "receipt") +
        ui.select("itemId", "Item", itemOpts, (pre && pre.itemId) || "") +
        ui.text("location", "Location", (pre && pre.location) || "Main") +
        ui.text("toLocation", "To location (transfers only)", "") +
        ui.number("qty", "Quantity", pre && pre.qty != null ? pre.qty : "", { min: 0 }) +
        ui.number("unitCost", "Unit cost (receipts/opening)", pre && pre.unitCost != null ? pre.unitCost : "", { min: 0 }) +
        ui.check("reduce", "Reduce stock (negative adjustment)", false) +
        ui.dateInput("date", "Date", ui.today()) +
        ui.textarea("note", "Note", "", 2)
      ),
      foot: ui.btn("Cancel", { small: true, act: "mv-cancel" }) + " " + ui.btn("Record movement", { small: true, primary: true, act: "mv-save" }),
    });
    m.querySelector("[data-act=mv-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=mv-save]").onclick = async (t) => {
      const f = ui.collect(m, ["type", "itemId", "location", "toLocation", "qty", "unitCost", "reduce", "date", "note"]);
      if (!f.itemId) { ERP.toast("Choose an item.", "error"); return; }
      if (!(Number(f.qty) > 0)) { ERP.toast("Enter a quantity.", "error"); return; }
      t.disabled = true;
      try {
        const base = { itemId: Number(f.itemId), location: (f.location || "Main").trim(), date: f.date || ui.today(), note: (f.note || "").trim(), refType: "manual" };
        if (f.type === "receipt") await I.postReceipt(Object.assign({}, base, { qty: f.qty, unitCost: f.unitCost || 0 }));
        else if (f.type === "issue") await I.postIssue(Object.assign({}, base, { qty: f.qty }));
        else if (f.type === "opening") await I.postOpening(Object.assign({}, base, { qty: f.qty, unitCost: f.unitCost || 0 }));
        else if (f.type === "adjustment") await I.postAdjustment(Object.assign({}, base, { deltaQty: f.reduce ? -f.qty : f.qty }));
        else if (f.type === "transfer") await I.postTransfer(Object.assign({}, base, { toLocation: (f.toLocation || "").trim(), qty: f.qty }));
        ERP.toast("Movement recorded.", "success");
        ui.closeModal(); onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }

  async function renderStock(panel, state, onChanged) {
    const stock = state.stock;
    const q = (panel.__q || "").toLowerCase();
    const rows = stock.filter((r) => !q || (r.name || "").toLowerCase().indexOf(q) !== -1 || (r.sku || "").toLowerCase().indexOf(q) !== -1);
    const totalVal = stock.reduce((s, r) => s + r.value, 0);
    const low = stock.filter((r) => r.reorderPoint > 0 && r.qty < r.reorderPoint).length;
    panel.innerHTML =
      ui.summary([
        { label: "Items stocked", value: String(stock.filter((r) => r.qty > 0).length) },
        { label: "Total on hand", value: ui.qty(stock.reduce((s, r) => s + r.qty, 0)) },
        { label: "Inventory value", value: ui.money(totalVal) },
        { label: "Low / out", value: String(low) },
      ]) +
      '<div class="erp-toolbar">' +
      '<input type="search" placeholder="Search stock…" value="' + esc(panel.__q || "") + '" data-st-q>' +
      ui.btn("Record movement", { primary: true, act: "st-move" }) +
      "</div>" +
      ui.table([
        { key: "item", label: "Item", render: (r) => "<b>" + esc(r.name || "—") + "</b>" + (r.sku ? '<div class="erp-sub">' + esc(r.sku) + "</div>" : "") },
        { key: "qty", label: "On hand", align: "right", render: (r) => "<b>" + ui.qty(r.qty) + "</b>" + (r.locations && r.locations.length > 1 ? '<div class="erp-sub">' + r.locations.map((l) => esc(l.location) + " " + ui.qty(l.qty)).join(" · ") + "</div>" : "") },
        { key: "avg", label: "Avg cost", align: "right", render: (r) => ui.money(r.avgCost) },
        { key: "value", label: "Value", align: "right", render: (r) => ui.money(r.value) },
        { key: "rp", label: "Reorder pt", align: "right", render: (r) => ui.qty(r.reorderPoint || 0) },
        { key: "status", label: "Status", render: (r) => r.qty <= 0 ? ui.badge("Out of stock", "danger") : r.reorderPoint > 0 && r.qty < r.reorderPoint ? ui.badge("Low", "warn") : ui.badge("OK", "success") },
        { key: "actions", label: "", render: (r) => ui.btn("Move", { small: true, act: "st-move-item", arg: r.itemId }) },
      ], rows, { emptyText: "No stock yet. Record a receipt or opening balance." });
    panel.querySelector("[data-st-q]").addEventListener("input", (e) => { panel.__q = e.target.value; renderStock(panel, state, onChanged); });
    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "st-move") movementModal(null, state, onChanged);
      else if (act === "st-move-item") movementModal({ itemId: arg }, state, onChanged);
    });
  }

  async function renderMovements(panel, state, onChanged) {
    const q = (panel.__q || "").toLowerCase();
    const type = panel.__type || "all";
    let movs = state.movs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.id || 0) - (a.id || 0));
    if (type !== "all") movs = movs.filter((m) => m.type === type);
    if (q) movs = movs.filter((m) => (m.note || "").toLowerCase().indexOf(q) !== -1 || (m.refNum || "").toLowerCase().indexOf(q) !== -1);
    const nameOf = {};
    state.catalog.forEach((c) => { nameOf[String(c.id)] = c.name; });
    const types = ["all", "receipt", "issue", "adjustment", "transfer", "opening"];
    panel.innerHTML =
      '<div class="erp-toolbar">' +
      '<select data-mv-type>' + types.map((t2) => '<option value="' + t2 + '"' + (t2 === type ? " selected" : "") + ">" + (t2 === "all" ? "All types" : (MV[t2] || {}).label || t2) + "</option>").join("") + "</select>" +
      '<input type="search" placeholder="Search movements…" value="' + esc(panel.__q || "") + '" data-mv-q>' +
      "</div>" +
      ui.table([
        { key: "date", label: "Date", render: (r) => esc(r.date || "—") },
        { key: "type", label: "Type", render: (r) => ui.statusBadge(r.type, MV) },
        { key: "item", label: "Item", render: (r) => esc(nameOf[String(r.itemId)] || ("Item " + r.itemId)) },
        { key: "location", label: "Location", render: (r) => esc(r.type === "transfer" ? ((r.fromLocation || "Main") + " → " + (r.toLocation || "")) : (r.location || "Main")) },
        { key: "qty", label: "Qty", align: "right", render: (r) => '<span class="' + (signedQty(r) < 0 ? "erp-neg" : "") + '">' + (signedQty(r) > 0 ? "+" : "") + ui.qty(signedQty(r)) + "</span>" },
        { key: "cost", label: "Unit cost", align: "right", render: (r) => r.unitCost ? ui.money(r.unitCost) : "—" },
        { key: "ref", label: "Reference", render: (r) => esc(r.refNum || "—") },
        { key: "note", label: "Note", render: (r) => esc(r.note || "") },
      ], movs, { emptyText: "No movements yet." });
    panel.querySelector("[data-mv-type]").addEventListener("change", (e) => { panel.__type = e.target.value; renderMovements(panel, state, onChanged); });
    panel.querySelector("[data-mv-q]").addEventListener("input", (e) => { panel.__q = e.target.value; renderMovements(panel, state, onChanged); });
  }

  async function renderValuation(panel, state, onChanged) {
    const stock = state.stock;
    const totalVal = stock.reduce((s, r) => s + r.value, 0);
    const totalQty = stock.reduce((s, r) => s + r.qty, 0);
    panel.innerHTML =
      ui.summary([
        { label: "Items stocked", value: String(stock.filter((r) => r.qty > 0).length) },
        { label: "Total on hand", value: ui.qty(totalQty) },
        { label: "Inventory value", value: ui.money(totalVal) },
      ]) +
      '<p class="erp-modal-note">Valuation is derived from the movement log using a moving average: each receipt updates the average cost, and each issue posts COGS at that average, so inventory value ties out to the ledger at any date (once the finance module is present).</p>' +
      ui.table([
        { key: "item", label: "Item", render: (r) => "<b>" + esc(r.name || "—") + "</b>" + (r.sku ? '<div class="erp-sub">' + esc(r.sku) + "</div>" : "") },
        { key: "qty", label: "On hand", align: "right", render: (r) => ui.qty(r.qty) },
        { key: "avg", label: "Avg cost", align: "right", render: (r) => ui.money(r.avgCost) },
        { key: "value", label: "Value", align: "right", render: (r) => "<b>" + ui.money(r.value) + "</b>" },
      ], stock, { emptyText: "No inventory yet." }) +
      '<div class="erp-line-totals"><span class="erp-grand">Inventory value <b>' + ui.money(totalVal) + "</b></span></div>";
  }

  async function renderReorder(panel, state, onChanged) {
    let suggestions = [];
    try { suggestions = await I.reorderSuggestions(); } catch (e) { suggestions = []; }
    const totalQty = suggestions.reduce((s, r) => s + r.suggestedQty, 0);
    panel.innerHTML =
      ui.summary([
        { label: "Items below reorder point", value: String(suggestions.length) },
        { label: "Suggested to order", value: ui.qty(totalQty) },
      ]) +
      (suggestions.length ? '<div class="erp-toolbar">' + ui.btn("Create PO(s)", { primary: true, act: "ro-create" }) + "</div>" : "") +
      '<p class="erp-modal-note">Products whose on-hand stock is below their reorder point. Creating POs groups them by supplier into draft purchase orders you can review and send.</p>' +
      ui.table([
        { key: "item", label: "Item", render: (r) => "<b>" + esc(r.name || "—") + "</b>" + (r.sku ? '<div class="erp-sub">' + esc(r.sku) + "</div>" : "") },
        { key: "qty", label: "On hand", align: "right", render: (r) => ui.qty(r.qty) },
        { key: "rp", label: "Reorder point", align: "right", render: (r) => ui.qty(r.reorderPoint) },
        { key: "suggest", label: "Suggested qty", align: "right", render: (r) => "<b>" + ui.qty(r.suggestedQty) + "</b>" },
        { key: "supplier", label: "Supplier", render: (r) => esc(r.supplierId != null ? (state.partiesAll.find((p) => String(p.id) === String(r.supplierId)) || {}).name || "—" : "Any") },
        { key: "cost", label: "Est. cost", align: "right", render: (r) => ui.money((r.unitCost || 0) * (r.suggestedQty || 0)) },
      ], suggestions, { emptyText: "No items are below their reorder point. Set reorder points on catalog items to get suggestions." });

    const createBtn = panel.querySelector("[data-act=ro-create]");
    if (createBtn) createBtn.onclick = async (t) => {
      t.disabled = true;
      try {
        const created = await I.createReorderPOs(suggestions);
        ERP.toast("Created " + created.map((p) => p.num).join(", ") + ".", "success");
        onChanged();
      } catch (err) { t.disabled = false; ERP.toast(err.message || String(err), "error"); }
    };
  }
})();
