/* ============================================================
   PSA-U — receiving, drop-ship & inventory (Phase 9 · Task 44)

   Where ordered goods land. This module owns:

     • warehouse  — a stock location (name, code, address) so
                    quantities can be tracked per site (Task 44).
     • stockMove  — the append-only movement ledger. Every receipt,
                    issue, transfer, stocktake adjustment and
                    write-off is a signed row, so an item's on-hand
                    quantity is always the sum of its history and can
                    be reconciled back to the records that caused it
                    (Task 44).
     • receipt    — a receiving document against a purchase order
                    (or ad-hoc), recording full or partial receipts,
                    the variance against what was ordered, and the
                    drop-ship case where goods go straight to the
                    client and never touch stock (Task 44).

   Storage: provider-document records (kinds "warehouse" /
   "stockMove" / "receipt"). Purchase orders themselves belong to
   ERP.procurement; receiving updates a PO's fulfilled quantities
   through `ERP.procurement.applyReceipt`, keeping the two engines
   consistent.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const W = (ERP.inventory = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("inventory requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const maskedMoney = (v) => (ERP.security.canSeeFinancials() ? ui.money(v) : "•••");
  const providerRecords = (pid, kind) => ten().records("provider", pid, kind);

  W.MOVE_REASONS = [
    { id: "receipt", label: "Receipt", tone: "success" },
    { id: "issue", label: "Issue", tone: "info" },
    { id: "transfer", label: "Transfer", tone: "muted" },
    { id: "count", label: "Stocktake", tone: "warn" },
    { id: "writeoff", label: "Write-off", tone: "danger" },
  ];
  W.reasonLabel = (id) => (W.MOVE_REASONS.find((r) => r.id === id) || {}).label || id || "—";
  W.reasonTone = (id) => (W.MOVE_REASONS.find((r) => r.id === id) || {}).tone || "muted";

  /* ─────────────────────────── emit (workflow) ─────────────────────────── */

  async function emit(pid, event, payload, extra) {
    if (!ERP.workflow) return;
    try { await ERP.workflow.emit(event, Object.assign({ event: event, actor: actor() }, payload || {}, extra || {})); } catch (e) {}
  }

  /* ─────────────────────────── record models ─────────────────────────── */

  W.newWarehouse = (over) => Object.assign({
    kind: "warehouse", id: null, providerId: null,
    name: "", code: "", address: "", active: true, isDefault: false,
    createdAt: null, updatedAt: null,
  }, over || {});

  W.newMove = (over) => Object.assign({
    kind: "stockMove", id: null, providerId: null, itemId: null, warehouseId: null,
    delta: 0, reason: "receipt", refType: "", refId: null, refNumber: "",
    unitCost: 0, at: null, note: "", by: null,
  }, over || {});

  W.newReceipt = (over) => Object.assign({
    kind: "receipt", id: null, providerId: null, number: "",
    poId: null, vendorId: null, companyId: null, warehouseId: null,
    dropShip: false, status: "posted", date: "",
    lines: [], receivedBy: null, note: "", openDiscrepancies: 0,
    createdAt: null, updatedAt: null,
  }, over || {});

  async function nextNumber(pid, prefix) {
    const list = await providerRecords(pid, "receipt");
    let max = 0;
    list.forEach((r) => { const m = /(\d+)\s*$/.exec(String(r.number || "")); if (m) max = Math.max(max, Number(m[1])); });
    return prefix + "-" + String(max + 1).padStart(4, "0");
  }

  /* ─────────────────────────── warehouses ─────────────────────────── */

  W.warehouses = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "warehouse");
    if (query.active === "active") list = list.filter((r) => r.active !== false);
    return list.slice().sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || "")));
  };
  W.warehouse = async function (pid, id) {
    const list = await providerRecords(pid, "warehouse");
    return list.find((r) => String(r.id) === String(id)) || null;
  };
  W.defaultWarehouse = async function (pid) {
    const list = await W.warehouses(pid, {});
    return list.find((r) => r.isDefault) || list[0] || null;
  };
  W.saveWarehouse = async function (pid, rec) {
    if (!ERP.security.enforce("inventory.edit")) return { error: "forbidden" };
    if (!String(rec && rec.name || "").trim()) return { error: "name_required", message: "Give the warehouse a name." };
    const existing = rec && rec.id != null && rec.id !== "" ? await W.warehouse(pid, rec.id) : null;
    const w = Object.assign(W.newWarehouse(), existing || {}, rec);
    w.name = String(w.name).trim();
    w.providerId = pid;
    if (!existing) {
      w.id = w.id != null && w.id !== "" ? w.id : ten().nextId(await providerRecords(pid));
      w.createdAt = nowIso();
    }
    w.updatedAt = nowIso();
    await ten().upsert("provider", pid, w);
    if (w.isDefault) {
      const list = await providerRecords(pid, "warehouse");
      for (const other of list) {
        if (String(other.id) !== String(w.id) && other.isDefault) { other.isDefault = false; await ten().upsert("provider", pid, other); }
      }
    }
    return { record: w, created: !existing };
  };
  W.removeWarehouse = async function (pid, id) {
    if (!ERP.security.enforce("inventory.edit")) return { error: "forbidden" };
    const moves = await providerRecords(pid, "stockMove");
    if (moves.some((m) => String(m.warehouseId) === String(id) && num(m.delta) !== 0)) return { error: "in_use", message: "This warehouse has stock history; keep it for the audit trail." };
    await ten().remove("provider", pid, (r) => r.kind === "warehouse" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── the stock ledger ─────────────────────────── */

  W.moves = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "stockMove");
    if (query.itemId) list = list.filter((r) => String(r.itemId) === String(query.itemId));
    if (query.warehouseId) list = list.filter((r) => String(r.warehouseId) === String(query.warehouseId));
    if (query.reason) list = list.filter((r) => String(r.reason) === String(query.reason));
    if (query.refId) list = list.filter((r) => String(r.refId) === String(query.refId));
    return list.slice().sort((a, b) => num(b.id) - num(a.id));
  };

  W.onHand = async function (pid, itemId, warehouseId) {
    if (itemId == null) return 0;
    let list = await providerRecords(pid, "stockMove");
    if (warehouseId) list = list.filter((m) => String(m.warehouseId) === String(warehouseId));
    return round2(list.filter((m) => String(m.itemId) === String(itemId)).reduce((n, m) => n + num(m.delta), 0));
  };

  async function recordMove(pid, o) {
    const m = Object.assign(W.newMove(), o);
    m.providerId = pid;
    m.id = ten().nextId(await providerRecords(pid));
    m.at = m.at || nowIso();
    m.by = m.by != null ? m.by : (actor().memberId || null);
    m.delta = num(m.delta);
    await ten().upsert("provider", pid, m);
    return m;
  }

  /* Adjust an item's on-hand quantity to a counted figure (stocktake),
     recording only the difference so the ledger stays append-only. */
  W.adjust = async function (pid, o) {
    if (!ERP.security.enforce("inventory.adjust")) return { error: "forbidden" };
    const itemId = o && o.itemId;
    const warehouseId = (o && o.warehouseId) || (await W.defaultWarehouse(pid) || {}).id || null;
    if (itemId == null) return { error: "item_required", message: "Choose an item to adjust." };
    const current = await W.onHand(pid, itemId, warehouseId);
    const target = num(o && o.qty);
    const delta = round2(target - current);
    if (!delta) return { ok: true, delta: 0, onHand: current, message: "Nothing to adjust." };
    const m = await recordMove(pid, { itemId: itemId, warehouseId: warehouseId, delta: delta, reason: o.reason || "count", note: o.note || "" });
    await maybeLow(pid, itemId, warehouseId);
    await emit(pid, "stock.adjusted", { move: m, onHand: target });
    return { ok: true, move: m, delta: delta, onHand: target };
  };

  W.transfer = async function (pid, o) {
    if (!ERP.security.enforce("inventory.edit")) return { error: "forbidden" };
    o = o || {};
    const qty = num(o.qty);
    if (!o.itemId) return { error: "item_required", message: "Choose an item to transfer." };
    if (!o.fromWarehouseId || !o.toWarehouseId) return { error: "warehouse_required", message: "Choose both warehouses." };
    if (String(o.fromWarehouseId) === String(o.toWarehouseId)) return { error: "same_warehouse", message: "Choose two different warehouses." };
    if (qty <= 0) return { error: "qty_required", message: "Enter a quantity to transfer." };
    const have = await W.onHand(pid, o.itemId, o.fromWarehouseId);
    if (qty > have) return { error: "insufficient", message: "Only " + have + " on hand at the source warehouse." };
    const out = await recordMove(pid, { itemId: o.itemId, warehouseId: o.fromWarehouseId, delta: -qty, reason: "transfer", refType: "warehouse", refId: o.toWarehouseId, note: o.note || "" });
    const into = await recordMove(pid, { itemId: o.itemId, warehouseId: o.toWarehouseId, delta: qty, reason: "transfer", refType: "warehouse", refId: o.fromWarehouseId, note: o.note || "" });
    await maybeLow(pid, o.itemId, o.fromWarehouseId);
    return { ok: true, out: out, in: into };
  };

  W.issue = async function (pid, o) {
    if (!ERP.security.enforce("inventory.edit")) return { error: "forbidden" };
    o = o || {};
    const qty = num(o.qty);
    if (!o.itemId) return { error: "item_required", message: "Choose an item to issue." };
    if (qty <= 0) return { error: "qty_required", message: "Enter a quantity." };
    const warehouseId = o.warehouseId || (await W.defaultWarehouse(pid) || {}).id || null;
    const have = await W.onHand(pid, o.itemId, warehouseId);
    if (qty > have) return { error: "insufficient", message: "Only " + have + " on hand." };
    const m = await recordMove(pid, { itemId: o.itemId, warehouseId: warehouseId, delta: -qty, reason: "issue", refType: o.refType || "", refId: o.refId != null ? o.refId : null, refNumber: o.refNumber || "", note: o.note || "" });
    await maybeLow(pid, o.itemId, warehouseId);
    return { ok: true, move: m, onHand: round2(have - qty) };
  };

  async function maybeLow(pid, itemId, warehouseId) {
    try {
      const item = await ERP.catalog.item(pid, itemId);
      if (!item || !item.trackInventory) return;
      const oh = await W.onHand(pid, itemId, warehouseId);
      if (num(item.reorderPoint) > 0 && oh <= num(item.reorderPoint)) await emit(pid, "stock.low", { item: item, onHand: oh, reorderPoint: item.reorderPoint, warehouseId: warehouseId });
    } catch (e) {}
  }

  /* Levels for every item that tracks inventory, optionally per warehouse. */
  W.levels = async function (pid, query) {
    query = query || {};
    const items = await ERP.catalog.items(pid, { inventory: true });
    const moves = await providerRecords(pid, "stockMove");
    const warehouses = await W.warehouses(pid, {});
    const scope = query.warehouseId
      ? warehouses.filter((w) => String(w.id) === String(query.warehouseId))
      : warehouses;
    const byKey = {};
    moves.forEach((m) => {
      if (query.warehouseId && String(m.warehouseId) !== String(query.warehouseId)) return;
      const k = m.itemId + "|" + (m.warehouseId == null ? "" : m.warehouseId);
      byKey[k] = (byKey[k] || 0) + num(m.delta);
    });
    const rows = [];
    for (const item of items) {
      let total = 0;
      const perWh = [];
      const whList = scope.length ? scope : [{ id: null, name: "Unassigned" }];
      for (const w of whList) {
        const k = item.id + "|" + (w.id == null ? "" : w.id);
        const q = round2(byKey[k] || 0);
        total += q;
        if (q !== 0 || whList.length === 1) perWh.push({ warehouseId: w.id, warehouseName: w.name, qty: q });
      }
      const low = num(item.reorderPoint) > 0 && round2(total) <= num(item.reorderPoint);
      rows.push({ item: item, onHand: round2(total), perWarehouse: perWh, reorderPoint: num(item.reorderPoint), low: low, value: round2(round2(total) * num(item.cost)) });
    }
    return rows.sort((a, b) => (b.low ? 1 : 0) - (a.low ? 1 : 0) || String(a.item.name).localeCompare(String(b.item.name)));
  };

  W.lowStock = async function (pid) {
    return (await W.levels(pid, {})).filter((r) => r.low);
  };

  W.valuation = async function (pid) {
    const rows = await W.levels(pid, {});
    return round2(rows.reduce((n, r) => n + num(r.value), 0));
  };

  /* ─────────────────────────── receiving ─────────────────────────── */

  W.receipts = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "receipt");
    if (query.poId) list = list.filter((r) => String(r.poId) === String(query.poId));
    if (query.vendorId) list = list.filter((r) => String(r.vendorId) === String(query.vendorId));
    if (query.dropShip === true) list = list.filter((r) => !!r.dropShip);
    return list.slice().sort((a, b) => num(b.id) - num(a.id));
  };
  W.receipt = async function (pid, id) {
    const list = await providerRecords(pid, "receipt");
    return list.find((r) => String(r.id) === String(id)) || null;
  };

  /* Post a receipt. Lines reference a PO line (qtyReceived) or are ad-hoc
     (itemId + qtyReceived). Drop-ship receipts fulfil the PO but post no
     stock; otherwise tracked items receive into the chosen warehouse. */
  W.receive = async function (pid, o) {
    if (!ERP.security.enforce("procurement.receive")) return { error: "forbidden" };
    o = o || {};
    const po = o.poId != null && o.poId !== "" && ERP.procurement ? await ERP.procurement.get(pid, o.poId) : null;
    const rawLines = Array.isArray(o.lines) ? o.lines.filter((l) => num(l.qtyReceived) !== 0) : [];
    if (!rawLines.length) return { error: "no_lines", message: "Enter a quantity to receive on at least one line." };
    const dropShip = !!o.dropShip;
    let warehouseId = dropShip ? null : (o.warehouseId || (await W.defaultWarehouse(pid) || {}).id || null);

    const receipt = W.newReceipt({
      providerId: pid, number: await nextNumber(pid, "RCV"),
      poId: po ? po.id : null, vendorId: (po && po.vendorId) || o.vendorId || null,
      companyId: (po && po.companyId) || o.companyId || null,
      warehouseId: warehouseId, dropShip: dropShip, status: "posted",
      date: o.date || ui.today(), note: o.note || "", receivedBy: actor().memberId || null,
      createdAt: nowIso(), updatedAt: nowIso(),
      lines: rawLines.map((l) => ({
        poLineId: l.poLineId != null ? l.poLineId : null,
        itemId: l.itemId != null ? l.itemId : null,
        description: l.description || "",
        qtyOrdered: num(l.qtyOrdered),
        receivedBefore: num(l.receivedBefore),
        qtyReceived: num(l.qtyReceived),
        unitCost: num(l.unitCost),
        variance: round2(num(l.qtyReceived) - num(l.outstanding)),
        discrepancy: round2(num(l.qtyReceived) - num(l.outstanding)) !== 0,
        resolved: false, resolutionNote: "",
      })),
    });
    receipt.id = ten().nextId(await providerRecords(pid));
    receipt.openDiscrepancies = receipt.lines.filter((l) => l.discrepancy).length;

    /* post stock (skipped entirely for a drop-ship) */
    if (!dropShip) {
      for (const line of receipt.lines) {
        if (line.itemId == null) continue;
        const item = await ERP.catalog.item(pid, line.itemId);
        if (!item || !item.trackInventory) continue;
        await recordMove(pid, {
          itemId: line.itemId, warehouseId: warehouseId, delta: line.qtyReceived, reason: "receipt",
          refType: "receipt", refId: receipt.id, refNumber: receipt.number, unitCost: line.unitCost, note: line.description,
        });
        await maybeLow(pid, line.itemId, warehouseId);
      }
    }

    await ten().upsert("provider", pid, receipt);

    /* push fulfilled quantities back onto the PO */
    if (po && ERP.procurement && ERP.procurement.applyReceipt) {
      try { await ERP.procurement.applyReceipt(pid, po.id, receipt.lines.filter((l) => l.poLineId != null).map((l) => ({ poLineId: l.poLineId, qty: l.qtyReceived }))); } catch (e) {}
    }
    await emit(pid, "receipt.posted", { receipt: receipt }, { dropShip: dropShip, openDiscrepancies: receipt.openDiscrepancies });
    return { record: receipt, created: true };
  };

  W.reconcile = async function (pid, receiptId, o) {
    if (!ERP.security.enforce("inventory.edit")) return { error: "forbidden" };
    const r = await W.receipt(pid, receiptId);
    if (!r) return { error: "not_found" };
    o = o || {};
    let touched = 0;
    r.lines = (r.lines || []).map((line) => {
      if (o.lineId != null && String(line.poLineId || line.itemId) !== String(o.lineId)) return line;
      if (!line.discrepancy || line.resolved) return line;
      touched += 1;
      return Object.assign({}, line, { resolved: true, resolutionNote: o.note || "accepted variance" });
    });
    r.openDiscrepancies = (r.lines || []).filter((l) => l.discrepancy && !l.resolved).length;
    r.updatedAt = nowIso();
    await ten().upsert("provider", pid, r);
    return { record: r, resolved: touched };
  };

  /* Open receiving discrepancies across every receipt, for the queue. */
  W.discrepancies = async function (pid) {
    const list = await providerRecords(pid, "receipt");
    const out = [];
    for (const r of list) {
      for (const line of (r.lines || [])) {
        if (line.discrepancy && !line.resolved) out.push({ receiptId: r.id, receiptNumber: r.number, date: r.date, poId: r.poId, line: line });
      }
    }
    return out.sort((a, b) => num(b.receiptId) - num(a.receiptId));
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  W.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    if ((await providerRecords(pid, "warehouse")).length) return { skipped: "already_seeded" };
    let id = (await providerRecords(pid)).reduce((m, r) => Math.max(m, num(r.id)), 0);
    await ten().upsert("provider", pid, W.newWarehouse({ id: ++id, providerId: pid, name: "Main warehouse", code: "MAIN", isDefault: true, createdAt: nowIso(), updatedAt: nowIso() }));
    return { seeded: 1 };
  };

  /* ═══════════════════════════ panels ═══════════════════════════
     These render into the Procurement station's tabs (the station
     frame is owned by ERP.procurement). */

  W.renderReceiving = async function (panel, pid) {
    await W.ensure(pid);
    const [receipts, disc] = await Promise.all([W.receipts(pid, {}), W.discrepancies(pid)]);
    const canReceive = ERP.security.can("procurement.receive");
    const canEdit = ERP.security.can("inventory.edit");
    const dropShips = receipts.filter((r) => r.dropShip);
    const rows = receipts.map((r) => ({
      number: ui.esc(r.number || ""),
      date: ui.esc(r.date || ""),
      drop: r.dropShip ? ui.badge("drop-ship", "info") : ui.badge("stock", "muted"),
      lines: String((r.lines || []).length),
      received: String(round2((r.lines || []).reduce((n, l) => n + num(l.qtyReceived), 0))),
      open: num(r.openDiscrepancies) ? ui.badge(String(r.openDiscrepancies) + " open", "warn") : "—",
      by: ui.esc(r.receivedBy != null ? "#" + r.receivedBy : "—"),
      actions: r.openDiscrepancies && canEdit ? ui.btn("Reconcile", { small: true, act: "rv-recon", arg: r.id }) : "",
    }));
    const discRows = disc.map((d) => ({
      receipt: ui.esc(d.receiptNumber || ""),
      date: ui.esc(d.date || ""),
      line: ui.esc(d.line.description || "item"),
      ordered: String(num(d.line.qtyOrdered)),
      received: String(num(d.line.qtyReceived)),
      variance: (num(d.line.variance) > 0 ? "+" : "") + num(d.line.variance),
      actions: canEdit ? ui.btn("Accept", { small: true, act: "rv-recon", arg: d.receiptId, attrs: { "data-line": d.line.poLineId != null ? d.line.poLineId : d.line.itemId } }) : "",
    }));
    panel.innerHTML =
      ui.summary([
        { label: "Receipts", value: String(receipts.length) },
        { label: "Drop-ships", value: String(dropShips.length) },
        { label: "Open discrepancies", value: String(disc.length) },
      ]) +
      '<div class="erp-db-toolbar">' + (canReceive ? ui.btn("Receive goods", { small: true, primary: true, act: "rv-new" }) : "") + "</div>" +
      ui.card("Receipts", ui.table([
        { key: "number", label: "Receipt" }, { key: "date", label: "Date" }, { key: "drop", label: "Type" },
        { key: "lines", label: "Lines", align: "right" }, { key: "received", label: "Units", align: "right" },
        { key: "open", label: "Discrepancies" }, { key: "by", label: "Received by" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "Nothing received yet." })) +
      ui.card("Discrepancy queue", ui.table([
        { key: "receipt", label: "Receipt" }, { key: "date", label: "Date" }, { key: "line", label: "Line" },
        { key: "ordered", label: "Ordered", align: "right" }, { key: "received", label: "Received", align: "right" },
        { key: "variance", label: "Variance", align: "right" }, { key: "actions", label: "", align: "right" },
      ], discRows, { emptyText: "No open discrepancies — everything received matches what was ordered." }));

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "rv-new") return W.openReceiveModal(pid, {}, () => W.renderReceiving(panel, pid));
      if (act === "rv-recon") {
        const lineId = el.getAttribute("data-line");
        ui.confirm({ title: "Accept variance", message: "Accept the difference between ordered and received?", onConfirm: async () => {
          const r = await W.reconcile(pid, arg, { lineId: lineId || undefined, note: "accepted by " + actorName() });
          if (r.error) return ERP.toast(r.message || r.error, "error");
          ERP.toast("Discrepancy reconciled.", "success"); W.renderReceiving(panel, pid);
        } });
      }
    });
  };

  W.renderStock = async function (panel, pid) {
    await W.ensure(pid);
    const [levels, warehouses, valuation] = await Promise.all([W.levels(pid, {}), W.warehouses(pid, {}), W.valuation(pid)]);
    const canEdit = ERP.security.can("inventory.edit");
    const canAdjust = ERP.security.can("inventory.adjust");
    const low = levels.filter((r) => r.low);
    const rows = levels.map((r) => ({
      item: ui.esc(ERP.catalog.itemLabel(r.item)),
      onHand: String(r.onHand),
      reorder: String(r.reorderPoint || "—"),
      state: r.low ? ui.badge("reorder", "warn") : (r.onHand > 0 ? ui.badge("in stock", "success") : ui.badge("none", "muted")),
      value: maskedMoney(r.value),
      actions: (canAdjust ? ui.btn("Adjust", { small: true, act: "iv-adjust", arg: r.item.id }) : "") + (canEdit ? " " + ui.btn("Transfer", { small: true, act: "iv-transfer", arg: r.item.id }) : ""),
    }));
    const whRows = warehouses.map((w) => ({
      name: ui.esc(w.name) + (w.isDefault ? " " + ui.badge("default", "info") : ""),
      code: ui.esc(w.code || "—"),
      address: ui.esc(w.address || "—"),
      actions: canEdit ? ui.btn("Edit", { small: true, act: "iv-whedit", arg: w.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "iv-whdel", arg: w.id }) : "",
    }));
    panel.innerHTML =
      ui.summary([
        { label: "Tracked items", value: String(levels.length) },
        { label: "At or below reorder", value: String(low.length) },
        { label: "Stock value", value: maskedMoney(valuation) },
        { label: "Warehouses", value: String(warehouses.length) },
      ]) +
      '<div class="erp-db-toolbar">' +
        (canEdit ? ui.btn("New warehouse", { small: true, act: "iv-whnew" }) : "") +
        (canAdjust ? ui.btn("Stocktake", { small: true, primary: true, act: "iv-adjust" }) : "") +
      "</div>" +
      ui.card("Stock on hand", ui.table([
        { key: "item", label: "Item" }, { key: "onHand", label: "On hand", align: "right" },
        { key: "reorder", label: "Reorder pt", align: "right" }, { key: "state", label: "Status" },
        { key: "value", label: "Value", align: "right" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No items track inventory yet." })) +
      ui.card("Warehouses", ui.table([
        { key: "name", label: "Name" }, { key: "code", label: "Code" }, { key: "address", label: "Address" }, { key: "actions", label: "", align: "right" },
      ], whRows, { emptyText: "No warehouses." }));

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "iv-whnew") return W.openWarehouseModal(pid, null, () => W.renderStock(panel, pid));
      if (act === "iv-whedit") { const w = await W.warehouse(pid, arg); if (w) return W.openWarehouseModal(pid, w, () => W.renderStock(panel, pid)); }
      if (act === "iv-whdel") { ui.confirm({ title: "Delete warehouse", message: "Delete this warehouse?", onConfirm: async () => { const r = await W.removeWarehouse(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Warehouse deleted.", "success"); W.renderStock(panel, pid); } }); }
      if (act === "iv-adjust") return W.openAdjustModal(pid, arg || null, () => W.renderStock(panel, pid));
      if (act === "iv-transfer") return W.openTransferModal(pid, arg, () => W.renderStock(panel, pid));
    });
  };

  /* ─────────────────────────── modals ─────────────────────────── */

  W.openReceiveModal = async function (pid, opts, refresh) {
    if (!ERP.security.enforce("procurement.receive")) return;
    await W.ensure(pid);
    opts = opts || {};
    const [pos, warehouses, items] = await Promise.all([
      ERP.procurement ? ERP.procurement.receivable(pid) : Promise.resolve([]),
      W.warehouses(pid, { active: "active" }),
      ERP.catalog.options(pid, { inventory: true }),
    ]);
    let po = opts.poId != null ? await ERP.procurement.get(pid, opts.poId) : null;
    const whOptions = warehouses.map((w) => ({ value: w.id, label: w.name + (w.isDefault ? " (default)" : "") }));
    const head =
      ui.select("poId", "Purchase order", [{ value: "", label: "— ad-hoc receipt —" }].concat(pos.map((p) => ({ value: p.id, label: (p.number || "") + " · " + (p.__vendorName || "") }))), po ? po.id : (opts.poId || "")) +
      '<div class="erp-form-row">' +
        ui.select("warehouseId", "Receive into", whOptions, (await W.defaultWarehouse(pid) || {}).id) +
        ui.dateInput("date", "Date", ui.today()) +
      "</div>" +
      ui.check("dropShip", "Drop-ship (ship straight to the client — no stock)", false) +
      '<div data-rv-lines></div>' +
      ui.textarea("note", "Note", "", 2);
    const modal = ui.modal({
      title: "Receive goods", size: "lg", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "rv-cancel" }) + " " + ui.btn("Post receipt", { small: true, primary: true, act: "rv-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const linesCtn = modal.querySelector("[data-rv-lines]");

    async function drawLines() {
      if (po) {
        const rows = (po.lines || []).map((l) => {
          const outstanding = round2(num(l.qty) - num(l.receivedQty));
          return '<div class="erp-rcv-line" data-rvline="' + ui.esc(l.id) + '" data-item="' + ui.esc(l.itemId) + '" data-desc="' + ui.esc(l.description) + '" data-cost="' + ui.esc(l.unitCost) + '" data-ordered="' + ui.esc(l.qty) + '" data-before="' + ui.esc(l.receivedQty) + '" data-outstanding="' + outstanding + '">' +
            '<span>' + ui.esc(l.description || ERP.catalog.itemLabel(null)) + '</span>' +
            '<span class="erp-sub">outstanding ' + outstanding + ' of ' + num(l.qty) + '</span>' +
            '<input class="erp-input" type="number" data-rvqty value="' + outstanding + '" min="0">' +
            "</div>";
        });
        linesCtn.innerHTML = rows.join("") || '<p class="erp-alert">This purchase order has no lines.</p>';
      } else {
        linesCtn.innerHTML = '<div class="erp-rcv-line" data-rvline="" data-item="" data-desc="" data-cost="0" data-ordered="0" data-before="0" data-outstanding="0">' +
          '<select class="erp-input" data-rvitem>' + [{ value: "", label: "— choose an item —" }].concat(items).map((i) => '<option value="' + ui.esc(i.value) + '">' + ui.esc(i.label) + "</option>").join("") + "</select>" +
          '<input class="erp-input" type="number" data-rvqty value="1" min="0">' +
          "</div>";
      }
    }
    await drawLines();
    const poSel = form.querySelector('[name="poId"]');
    if (poSel) poSel.addEventListener("change", async () => { po = poSel.value ? await ERP.procurement.get(pid, poSel.value) : null; drawLines(); });
    modal.querySelector("[data-act=rv-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=rv-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["poId", "warehouseId", "date", "dropShip", "note"]);
      const lines = [...linesCtn.querySelectorAll("[data-rvline]")].map((row) => {
        const sel = row.querySelector("[data-rvitem]");
        return {
          poLineId: row.getAttribute("data-rvline") || null,
          itemId: sel ? (sel.value || null) : (row.getAttribute("data-item") || null),
          description: row.getAttribute("data-desc") || "",
          qtyOrdered: num(row.getAttribute("data-ordered")),
          receivedBefore: num(row.getAttribute("data-before")),
          outstanding: num(row.getAttribute("data-outstanding")),
          unitCost: num(row.getAttribute("data-cost")),
          qtyReceived: num((row.querySelector("[data-rvqty]") || {}).value),
        };
      });
      btn.disabled = true;
      const r = await W.receive(pid, Object.assign({}, v, { lines: lines }));
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Receipt " + r.record.number + " posted.", "success"); refresh();
    };
  };

  W.openAdjustModal = async function (pid, itemId, refresh) {
    if (!ERP.security.enforce("inventory.adjust")) return;
    await W.ensure(pid);
    const [items, warehouses] = await Promise.all([ERP.catalog.options(pid, { inventory: true }), W.warehouses(pid, { active: "active" })]);
    const curr = itemId != null ? await W.onHand(pid, itemId, (await W.defaultWarehouse(pid) || {}).id) : 0;
    const head =
      '<div class="erp-form-row">' +
        ui.select("itemId", "Item", [{ value: "", label: "— choose an item —" }].concat(items), itemId) +
        ui.select("warehouseId", "Warehouse", warehouses.map((w) => ({ value: w.id, label: w.name })), (await W.defaultWarehouse(pid) || {}).id) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("qty", "Counted quantity", curr, { min: 0, step: 1 }) +
        ui.select("reason", "Reason", W.MOVE_REASONS.filter((r) => r.id === "count" || r.id === "writeoff"), "count") +
      "</div>" +
      ui.textarea("note", "Note", "", 2);
    const modal = ui.modal({
      title: "Adjust stock", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "iv-cancel" }) + " " + ui.btn("Post adjustment", { small: true, primary: true, act: "iv-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=iv-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=iv-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["itemId", "warehouseId", "qty", "reason", "note"]);
      if (!v.itemId) return ERP.toast("Choose an item.", "error");
      btn.disabled = true;
      const r = await W.adjust(pid, v);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Stock adjusted by " + (r.delta > 0 ? "+" : "") + r.delta + ".", "success"); refresh();
    };
  };

  W.openTransferModal = async function (pid, itemId, refresh) {
    if (!ERP.security.enforce("inventory.edit")) return;
    await W.ensure(pid);
    const [items, warehouses] = await Promise.all([ERP.catalog.options(pid, { inventory: true }), W.warehouses(pid, { active: "active" })]);
    const head =
      ui.select("itemId", "Item", [{ value: "", label: "— choose an item —" }].concat(items), itemId) +
      '<div class="erp-form-row">' +
        ui.select("fromWarehouseId", "From", warehouses.map((w) => ({ value: w.id, label: w.name })), (warehouses[0] || {}).id) +
        ui.select("toWarehouseId", "To", warehouses.map((w) => ({ value: w.id, label: w.name })), (warehouses[1] || warehouses[0] || {}).id) +
      "</div>" +
      ui.number("qty", "Quantity", 1, { min: 1, step: 1 }) +
      ui.textarea("note", "Note", "", 2);
    const modal = ui.modal({
      title: "Transfer stock", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "iv-cancel" }) + " " + ui.btn("Transfer", { small: true, primary: true, act: "iv-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=iv-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=iv-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["itemId", "fromWarehouseId", "toWarehouseId", "qty", "note"]);
      if (!v.itemId) return ERP.toast("Choose an item.", "error");
      btn.disabled = true;
      const r = await W.transfer(pid, v);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Stock transferred.", "success"); refresh();
    };
  };

  W.openWarehouseModal = async function (pid, warehouse, refresh) {
    if (!ERP.security.enforce("inventory.edit")) return;
    const w = warehouse ? clone(warehouse) : W.newWarehouse();
    const head =
      '<div class="erp-form-row">' +
        ui.text("name", "Name", w.name, "e.g. Main warehouse") +
        ui.text("code", "Code", w.code, "e.g. MAIN") +
      "</div>" +
      ui.text("address", "Address", w.address) +
      ui.check("isDefault", "Default warehouse", !!w.isDefault) +
      ui.check("active", "Active", w.active !== false);
    const modal = ui.modal({
      title: warehouse ? "Edit warehouse" : "New warehouse", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "iw-cancel" }) + " " + ui.btn(warehouse ? "Save" : "Create", { small: true, primary: true, act: "iw-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=iw-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=iw-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "code", "address", "isDefault", "active"]);
      if (!v.name) return ERP.toast("Give the warehouse a name.", "error");
      btn.disabled = true;
      const r = await W.saveWarehouse(pid, Object.assign({}, w, v, { id: w.id }));
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(warehouse ? "Warehouse saved." : "Warehouse created.", "success"); refresh();
    };
  };
})();
