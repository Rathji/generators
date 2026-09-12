/* ============================================================
   PSA-U — vendors & purchase orders (Phase 9 · Tasks 43 & 45)

   Buying the goods the practice resells or consumes. This module
   owns:

     • vendor         — a supplier with its own terms, currency and
                        lead time, so a purchase order can derive its
                        expected date (Task 43).
     • purchaseOrder  — a PO raised against a vendor with line items
                        (item, quantity, unit cost and, where it is
                        resold, unit price), a status flow, and links
                        to the client, opportunity, project or ticket
                        that needs the goods; expected vs received
                        dates are tracked (Task 43).
     • approvals      — a configurable approval threshold plus a PO
                        status flow (draft → pending approval →
                        approved → ordered → partially received →
                        received/closed), with the markup floor
                        enforced on resale lines so a PO cannot be
                        submitted or approved below it without a
                        recorded override (Task 45).

   Storage: provider-document records (kinds "vendor" /
   "purchaseOrder" / "procurementSettings"). Receiving itself lives
   in ERP.inventory; `applyReceipt` lets it push fulfilled quantities
   back here. Procurement intents raised by Phase 8's quote
   conversion become POs through `fromIntents`.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const P = (ERP.procurement = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("procurement requires the tenancy service");
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
  const maskedMoney = (v, cur) => (ERP.security.canSeeFinancials() ? ui.money(v, cur) : "•••");
  const providerRecords = (pid, kind) => ten().records("provider", pid, kind);
  const clientOptions = () => ERP.companies.optionList();

  /* ─────────────────────────── constants ─────────────────────────── */

  P.PO_STATUSES = [
    { id: "draft", label: "Draft", tone: "muted" },
    { id: "pending_approval", label: "Pending approval", tone: "warn" },
    { id: "approved", label: "Approved", tone: "info" },
    { id: "ordered", label: "Ordered", tone: "info" },
    { id: "partially_received", label: "Partially received", tone: "warn" },
    { id: "received", label: "Received", tone: "success" },
    { id: "closed", label: "Closed", tone: "muted" },
    { id: "cancelled", label: "Cancelled", tone: "danger" },
  ];
  P.statusLabel = (id) => (P.PO_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  P.statusTone = (id) => (P.PO_STATUSES.find((s) => s.id === id) || {}).tone || "muted";
  const OPEN_STATUSES = ["draft", "pending_approval", "approved", "ordered", "partially_received"];

  P.DEFAULT_POLICY = {
    poApprovalThreshold: 2500,
    enforceApprovals: true,
    enforceMarkupFloor: true,
    allowOverride: true,
    requireVendor: true,
  };

  P.DEFAULT_VENDORS = [
    { name: "Ingram Micro", code: "INGRAM", email: "orders@ingram.test", phone: "+1 555 0100", website: "https://ingram.test", terms: "Net 30", currency: "USD", leadTimeDays: 5 },
    { name: "TD SYNNEX", code: "SYNNEX", email: "orders@synnex.test", phone: "+1 555 0110", website: "https://synnex.test", terms: "Net 30", currency: "USD", leadTimeDays: 7 },
    { name: "Direct Distributor", code: "DIRECT", terms: "Prepay", currency: "USD", leadTimeDays: 3 },
  ];

  /* ─────────────────────────── emit (workflow) ─────────────────────────── */

  async function emit(pid, event, payload, extra) {
    if (!ERP.workflow) return;
    try { await ERP.workflow.emit(event, Object.assign({ event: event, actor: actor() }, payload || {}, extra || {})); } catch (e) {}
  }

  /* ─────────────────────────── record models ─────────────────────────── */

  P.newVendor = (over) => Object.assign({
    kind: "vendor", id: null, providerId: null,
    name: "", code: "", contactName: "", email: "", phone: "", website: "", address: "",
    terms: "", currency: "", leadTimeDays: 5, active: true, notes: "",
    createdAt: null, updatedAt: null,
  }, over || {});

  P.newLine = (over) => Object.assign({
    id: null, itemId: null, description: "", qty: 1, unit: "each",
    unitCost: 0, unitPrice: 0, receivedQty: 0, taxRate: 0,
  }, over || {});

  P.newPO = (over) => Object.assign({
    kind: "purchaseOrder", id: null, providerId: null, number: "",
    vendorId: null, companyId: null, opportunityId: null, projectId: null, ticketId: null,
    status: "draft", orderDate: "", expectedDate: "", receivedDate: "",
    currency: "", dropShip: false, taxRate: 0,
    lines: [], subtotal: 0, tax: 0, total: 0,
    approval: { state: "none", required: false, threshold: 0, requestedBy: null, requestedAt: null, decidedBy: null, decidedAt: null, note: "", reason: "" },
    receipts: [], history: [], notes: "",
    createdBy: null, createdAt: null, updatedAt: null,
  }, over || {});

  /* ─────────────────────────── settings / policy (Task 45) ─────────────────────────── */

  P.policy = async function (pid) {
    const rec = (await providerRecords(pid, "procurementSettings"))[0] || null;
    let base = Object.assign({}, P.DEFAULT_POLICY, rec || {});
    try { if (ERP.catalog) { const s = await ERP.catalog.settings(pid); base = Object.assign(base, { poApprovalThreshold: num(s.poApprovalThreshold, base.poApprovalThreshold), allowOverride: s.allowOverride !== false }); } } catch (e) {}
    return base;
  };
  P.savePolicy = async function (pid, patch) {
    if (!ERP.security.enforce("procurement.approve")) return { error: "forbidden" };
    const rec = Object.assign({ kind: "procurementSettings", id: "settings", providerId: pid }, await P.policy(pid), patch || {});
    await ten().upsert("provider", pid, rec);
    return { record: rec };
  };
  P.requiresApproval = async function (pid, po) {
    const pol = await P.policy(pid);
    if (pol.enforceApprovals === false) return false;
    return num(po && po.total) >= num(pol.poApprovalThreshold);
  };

  /* ─────────────────────────── numbering ─────────────────────────── */

  P.nextNumber = async function (pid) {
    const list = await providerRecords(pid, "purchaseOrder");
    let max = 0;
    list.forEach((p) => { const m = /(\d+)\s*$/.exec(String(p.number || "")); if (m) max = Math.max(max, Number(m[1])); });
    return "PO-" + String(max + 1).padStart(4, "0");
  };

  /* ─────────────────────────── vendors ─────────────────────────── */

  P.vendors = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "vendor");
    if (query.active === "active") list = list.filter((v) => v.active !== false);
    const q = String(query.q || "").toLowerCase().trim();
    if (q) list = list.filter((v) => String(v.name || "").toLowerCase().indexOf(q) !== -1 || String(v.code || "").toLowerCase().indexOf(q) !== -1);
    return list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  };
  P.vendor = async function (pid, id) {
    const list = await providerRecords(pid, "vendor");
    return list.find((v) => String(v.id) === String(id)) || null;
  };
  P.saveVendor = async function (pid, rec) {
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    if (!String(rec && rec.name || "").trim()) return { error: "name_required", message: "Give the vendor a name." };
    const existing = rec && rec.id != null && rec.id !== "" ? await P.vendor(pid, rec.id) : null;
    const v = Object.assign(P.newVendor(), existing || {}, rec);
    v.name = String(v.name).trim();
    v.providerId = pid;
    v.leadTimeDays = num(v.leadTimeDays, 5);
    if (!existing) {
      v.id = v.id != null && v.id !== "" ? v.id : ten().nextId(await providerRecords(pid));
      v.createdAt = nowIso();
    }
    v.updatedAt = nowIso();
    await ten().upsert("provider", pid, v);
    return { record: v, created: !existing };
  };
  P.removeVendor = async function (pid, id) {
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const open = (await providerRecords(pid, "purchaseOrder")).filter((p) => String(p.vendorId) === String(id) && OPEN_STATUSES.indexOf(p.status) !== -1);
    if (open.length) return { error: "in_use", message: "This vendor has open purchase orders." };
    await ten().remove("provider", pid, (r) => r.kind === "vendor" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── purchase orders ─────────────────────────── */

  P.compute = function (po) {
    po = po || {};
    const lines = po.lines || [];
    let subtotal = 0;
    lines.forEach((l) => { subtotal += num(l.qty) * num(l.unitCost); });
    subtotal = round2(subtotal);
    const tax = round2(subtotal * num(po.taxRate) / 100);
    return { subtotal: subtotal, tax: tax, total: round2(subtotal + tax) };
  };

  P.list = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "purchaseOrder");
    if (query.status) list = list.filter((p) => String(p.status) === String(query.status));
    if (query.vendorId) list = list.filter((p) => String(p.vendorId) === String(query.vendorId));
    if (query.companyId) list = list.filter((p) => String(p.companyId) === String(query.companyId));
    if (query.opportunityId) list = list.filter((p) => String(p.opportunityId) === String(query.opportunityId));
    if (query.projectId) list = list.filter((p) => String(p.projectId) === String(query.projectId));
    if (query.ticketId) list = list.filter((p) => String(p.ticketId) === String(query.ticketId));
    if (query.open === true) list = list.filter((p) => OPEN_STATUSES.indexOf(p.status) !== -1);
    const q = String(query.q || "").toLowerCase().trim();
    if (q) list = list.filter((p) => String(p.number || "").toLowerCase().indexOf(q) !== -1 || String(p.notes || "").toLowerCase().indexOf(q) !== -1);
    return list.slice().sort((a, b) => num(b.id) - num(a.id));
  };

  P.get = async function (pid, id) {
    const list = await providerRecords(pid, "purchaseOrder");
    return list.find((p) => String(p.id) === String(id)) || null;
  };

  P.save = async function (pid, rec) {
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const existing = rec && rec.id != null && rec.id !== "" ? await P.get(pid, rec.id) : null;
    const po = Object.assign(P.newPO(), existing || {}, rec);
    const pol = await P.policy(pid);
    if (!po.vendorId && pol.requireVendor !== false) return { error: "vendor_required", message: "Choose a vendor for the purchase order." };
    if (!(po.lines || []).length) return { error: "lines_required", message: "Add at least one line to the purchase order." };
    po.lines = (po.lines || []).map((l, i) => Object.assign(P.newLine(), l, { id: l.id != null && l.id !== "" ? l.id : "PL" + (i + 1) }));
    const totals = P.compute(po);
    po.subtotal = totals.subtotal; po.tax = totals.tax; po.total = totals.total;
    po.providerId = pid;
    if (!existing) {
      po.id = po.id != null && po.id !== "" ? po.id : ten().nextId(await providerRecords(pid));
      po.number = po.number || await P.nextNumber(pid);
      po.status = "draft";
      po.createdAt = nowIso();
      po.createdBy = po.createdBy != null ? po.createdBy : (actor().memberId || null);
      po.history = [{ at: nowIso(), by: actorName(), type: "created", text: "Draft raised" }];
    } else {
      po.history = Array.isArray(po.history) ? po.history : [];
    }
    po.updatedAt = nowIso();
    await ten().upsert("provider", pid, po);
    if (!existing) await emit(pid, "purchase_order.created", { purchaseOrder: po });
    return { record: po, created: !existing };
  };

  /* Draft a PO from Phase 8's pending procurement intents. Each intent is
     marked ordered and pointed at the new PO. */
  P.fromIntents = async function (pid, intentIds, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const ids = (intentIds || []).map(String);
    const intents = (await providerRecords(pid, "procurementIntent")).filter((r) => ids.indexOf(String(r.id)) !== -1 && r.status === "pending");
    if (!intents.length) return { error: "no_intents", message: "No pending procurement intents were selected." };
    const vendorId = opts.vendorId || intents.map((i) => i.vendorId).find((v) => v != null) || null;
    const lines = [];
    for (const it of intents) {
      let unitPrice = 0;
      try { if (ERP.catalog && it.itemId != null) unitPrice = await ERP.catalog.priceFor(pid, it.itemId, { companyId: it.companyId }); } catch (e) { unitPrice = 0; }
      lines.push(P.newLine({ itemId: it.itemId != null ? it.itemId : null, description: it.description, qty: num(it.qty, 1), unit: it.unit || "each", unitCost: num(it.unitCost), unitPrice: unitPrice }));
    }
    const companyId = intents.map((i) => i.companyId).find((c) => c != null) || null;
    const res = await P.save(pid, P.newPO({ vendorId: vendorId, companyId: companyId, currency: opts.currency || "", lines: lines, notes: "Raised from " + intents.length + " procurement intent(s)." }));
    if (res.error) return res;
    for (const it of intents) {
      if (ERP.sales && ERP.sales.markProcurementOrdered) { try { await ERP.sales.markProcurementOrdered(pid, it.id, res.record.id); } catch (e) {} }
    }
    return { record: res.record, purchaseOrder: res.record, intents: intents.length };
  };

  /* Raise a PO from pending procurement intents, grouped by client. */
  P.pendingIntents = async function (pid) {
    if (ERP.sales && ERP.sales.procurementQueue) { try { return await ERP.sales.procurementQueue(pid); } catch (e) {} }
    return (await providerRecords(pid, "procurementIntent")).filter((r) => r.status === "pending");
  };

  /* POs that still have goods outstanding, for the receiving picker. */
  P.receivable = async function (pid) {
    const list = await P.list(pid, {});
    const vendors = await providerRecords(pid, "vendor");
    const vmap = {}; vendors.forEach((v) => { vmap[v.id] = v.name; });
    return list.filter((p) => ["approved", "ordered", "partially_received"].indexOf(p.status) !== -1 && (p.lines || []).some((l) => round2(num(l.qty) - num(l.receivedQty)) > 0))
      .map((p) => Object.assign({}, p, { __vendorName: vmap[p.vendorId] || "" }));
  };

  P.outstanding = function (po) {
    return round2((po && po.lines || []).reduce((n, l) => n + Math.max(0, num(l.qty) - num(l.receivedQty)), 0));
  };

  /* Apply a receipt's fulfilled quantities back onto the PO and roll its
     status forward (received when every line is fulfilled). */
  P.applyReceipt = async function (pid, poId, lines) {
    const po = await P.get(pid, poId);
    if (!po) return { error: "not_found" };
    for (const upd of (lines || [])) {
      const line = (po.lines || []).find((l) => String(l.id) === String(upd.poLineId));
      if (line) line.receivedQty = round2(num(line.receivedQty) + num(upd.qty));
    }
    const allIn = (po.lines || []).every((l) => num(l.receivedQty) >= num(l.qty));
    const anyIn = (po.lines || []).some((l) => num(l.receivedQty) > 0);
    const before = po.status;
    po.status = allIn ? "received" : (anyIn ? "partially_received" : po.status);
    if (allIn) po.receivedDate = po.receivedDate || ui.today();
    po.updatedAt = nowIso();
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "status", text: "Status → " + P.statusLabel(po.status) }]);
    await ten().upsert("provider", pid, po);
    if (po.status !== before && po.status === "received") await emit(pid, "purchase_order.received", { purchaseOrder: po });
    return { record: po };
  };

  /* ─────────────────────────── status flow & approvals ─────────────────────────── */

  P.setStatus = async function (pid, id, status, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    po.status = status;
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "status", text: "Status → " + P.statusLabel(status) + (opts.note ? " (" + opts.note + ")" : "") }]);
    po.updatedAt = nowIso();
    if (status === "ordered" && !po.orderDate) po.orderDate = ui.today();
    if (status === "closed" && !po.receivedDate) po.receivedDate = ui.today();
    await ten().upsert("provider", pid, po);
    await emit(pid, "purchase_order." + status, { purchaseOrder: po }, opts);
    return { record: po };
  };

  /* Submit a draft: enforce the markup floor, then route to approval if the
     total clears the threshold — otherwise approve automatically. */
  P.submit = async function (pid, id, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (po.status !== "draft") return { error: "not_draft", message: "Only a draft can be submitted." };

    const policy = await P.policy(pid);
    if (ERP.catalog && policy.enforceMarkupFloor !== false) {
      const check = await ERP.catalog.checkPoFloors(pid, po);
      if (!check.ok) {
        if (!opts.override) return { error: "markup_floor", message: "A line is below the " + check.floorPct + "% markup floor. Record an override to proceed.", violations: check.violations, floorPct: check.floorPct };
        if (!policy.allowOverride) return { error: "no_override", message: "Overrides are disabled for markup floors." };
        const ov = await ERP.catalog.overrideRecord(pid, { refType: "po", refId: po.id, refNumber: po.number, companyId: po.companyId, type: "markup", floorPct: check.floorPct, violations: check.violations, reason: opts.overrideReason });
        if (ov.error) return ov;
        po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "override", text: "Markup floor overridden: " + (opts.overrideReason || "") }]);
      }
    }

    const needs = await P.requiresApproval(pid, po);
    po.approval = Object.assign({}, po.approval, {
      required: needs, threshold: num(policy.poApprovalThreshold), state: needs ? "pending" : "approved",
      requestedBy: actorName(), requestedAt: nowIso(), note: opts.note || "",
    });
    po.status = needs ? "pending_approval" : "approved";
    if (!needs) { po.approval.decidedBy = actorName(); po.approval.decidedAt = nowIso(); }
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "submitted", text: needs ? "Submitted for approval (≥ " + policy.poApprovalThreshold + ")" : "Submitted (auto-approved)" }]);
    po.updatedAt = nowIso();
    await ten().upsert("provider", pid, po);
    await emit(pid, "purchase_order.submitted", { purchaseOrder: po }, { requiresApproval: needs });
    if (needs && ERP.approvals) { try { await ERP.approvals.forPO(pid, po, {}); } catch (e) {} }
    return { record: po, requiresApproval: needs };
  };

  P.approve = async function (pid, id, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("procurement.approve")) return { error: "forbidden" };
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (po.status !== "pending_approval") return { error: "not_pending", message: "This purchase order is not awaiting approval." };
    const policy = await P.policy(pid);
    if (ERP.catalog && policy.enforceMarkupFloor !== false) {
      const check = await ERP.catalog.checkPoFloors(pid, po);
      if (!check.ok && !opts.override) return { error: "markup_floor", message: "A line is below the " + check.floorPct + "% markup floor. Record an override to approve.", violations: check.violations, floorPct: check.floorPct };
      if (!check.ok && opts.override) {
        const ov = await ERP.catalog.overrideRecord(pid, { refType: "po", refId: po.id, refNumber: po.number, companyId: po.companyId, type: "markup", floorPct: check.floorPct, violations: check.violations, reason: opts.overrideReason });
        if (ov.error) return ov;
      }
    }
    po.approval = Object.assign({}, po.approval, { state: "approved", decidedBy: actorName(), decidedAt: nowIso(), note: opts.note || "" });
    po.status = "approved";
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "approved", text: "Approved" }]);
    po.updatedAt = nowIso();
    await ten().upsert("provider", pid, po);
    await emit(pid, "purchase_order.approved", { purchaseOrder: po });
    return { record: po };
  };

  P.reject = async function (pid, id, reason) {
    if (!ERP.security.enforce("procurement.approve")) return { error: "forbidden" };
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (po.status !== "pending_approval") return { error: "not_pending", message: "This purchase order is not awaiting approval." };
    po.approval = Object.assign({}, po.approval, { state: "rejected", decidedBy: actorName(), decidedAt: nowIso(), reason: reason || "" });
    po.status = "draft";
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "rejected", text: "Rejected: " + (reason || "") }]);
    po.updatedAt = nowIso();
    await ten().upsert("provider", pid, po);
    await emit(pid, "purchase_order.rejected", { purchaseOrder: po }, { reason: reason || "" });
    return { record: po };
  };

  P.order = async function (pid, id, opts) {
    opts = opts || {};
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (po.status !== "approved") return { error: "not_approved", message: "Only an approved purchase order can be placed with the vendor." };
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const vendor = await P.vendor(pid, po.vendorId);
    po.orderDate = opts.orderDate || ui.today();
    po.expectedDate = opts.expectedDate || (vendor && num(vendor.leadTimeDays) ? ui.addDays(po.orderDate, num(vendor.leadTimeDays)) : "");
    po.status = "ordered";
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "ordered", text: "Ordered" + (po.expectedDate ? ", expected " + po.expectedDate : "") }]);
    po.updatedAt = nowIso();
    await ten().upsert("provider", pid, po);
    await emit(pid, "purchase_order.ordered", { purchaseOrder: po });
    return { record: po };
  };

  P.cancel = async function (pid, id, reason) {
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (["received", "closed", "cancelled"].indexOf(po.status) !== -1) return { error: "not_cancellable", message: "This purchase order can no longer be cancelled." };
    po.status = "cancelled";
    po.history = (po.history || []).concat([{ at: nowIso(), by: actorName(), type: "cancelled", text: "Cancelled: " + (reason || "") }]);
    po.updatedAt = nowIso();
    await ten().upsert("provider", pid, po);
    await emit(pid, "purchase_order.cancelled", { purchaseOrder: po }, { reason: reason || "" });
    return { record: po };
  };

  P.close = async function (pid, id) {
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (["received", "partially_received"].indexOf(po.status) === -1) return { error: "not_received", message: "Only a received purchase order can be closed." };
    return P.setStatus(pid, id, "closed");
  };

  P.remove = async function (pid, id) {
    if (!ERP.security.enforce("procurement.edit")) return { error: "forbidden" };
    const po = await P.get(pid, id);
    if (!po) return { error: "not_found" };
    if (po.status !== "draft" && po.status !== "cancelled") return { error: "not_draft", message: "Only a draft or cancelled purchase order can be deleted." };
    await ten().remove("provider", pid, (r) => r.kind === "purchaseOrder" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* Open POs awaiting approval. */
  P.approvalQueue = async function (pid) {
    return P.list(pid, { status: "pending_approval" });
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  P.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    let seeded = { vendors: 0, policy: false };
    if (!(await providerRecords(pid, "procurementSettings")).length) {
      await ten().upsert("provider", pid, Object.assign({ kind: "procurementSettings", id: "settings", providerId: pid }, P.DEFAULT_POLICY));
      seeded.policy = true;
    }
    if (!(await providerRecords(pid, "vendor")).length) {
      let id = (await providerRecords(pid)).reduce((m, r) => Math.max(m, num(r.id)), 0);
      for (const d of P.DEFAULT_VENDORS) {
        await ten().upsert("provider", pid, Object.assign(P.newVendor(d), { id: ++id, providerId: pid, createdAt: nowIso(), updatedAt: nowIso() }));
        seeded.vendors += 1;
      }
    }
    if (ERP.catalog && ERP.catalog.ensure) { try { await ERP.catalog.ensure(pid); } catch (e) {} }
    if (ERP.inventory && ERP.inventory.ensure) { try { await ERP.inventory.ensure(pid); } catch (e) {} }
    return seeded;
  };

  /* ═══════════════════════════ station ═══════════════════════════
     Five tabs: purchase orders, vendors, receiving & drop-ship,
     inventory, and approvals & margin rules. The receiving and
     inventory tabs are owned by ERP.inventory. */

  function blankState() {
    return { tab: "orders", status: "", vendorId: "", q: "", showIntents: true };
  }
  let currentHost = null;

  async function renderTab(id) {
    const host = currentHost;
    if (!host) return;
    const old = host.querySelector('[data-panel="' + id + '"]');
    if (!old) return;
    const panel = document.createElement("div");
    panel.className = old.className;
    panel.setAttribute("data-panel", id);
    panel.__host = host;
    old.replaceWith(panel);
    ERP.states.loading(panel, "Loading procurement");
    try {
      const pid = await ten().providerId();
      if (id === "orders") await renderOrders(panel, pid);
      else if (id === "vendors") await renderVendors(panel, pid);
      else if (id === "receiving") await ERP.inventory.renderReceiving(panel, pid);
      else if (id === "inventory") await ERP.inventory.renderStock(panel, pid);
      else if (id === "approvals") await renderApprovals(panel, pid);
    } catch (e) {
      console.error("procurement tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }
  const st = (panel) => panel.__host.__procurement;

  P.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "purchasing", title: "Procurement", phase: "Phase 9 · Procurement & inventory",
        message: "Create a service provider first — then raise purchase orders and receive stock here.",
      });
      return;
    }
    await P.ensure(pid);
    host.__procurement = host.__procurement || blankState();
    currentHost = host;
    const pending = await P.approvalQueue(pid);
    const defs = [
      { id: "orders", label: "Purchase orders" },
      { id: "vendors", label: "Vendors" },
      { id: "receiving", label: "Receiving & drop-ship" },
      { id: "inventory", label: "Inventory" },
      { id: "approvals", label: "Approvals & rules", badge: pending.length ? String(pending.length) : "" },
    ];
    const active = defs.find((d) => d.id === host.__procurement.tab) ? host.__procurement.tab : "orders";
    host.innerHTML = ui.pageHead("Procurement", "Vendors, purchase orders, receiving and inventory.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__procurement.tab = b.getAttribute("data-tab");
      await renderTab(host.__procurement.tab);
    }));
    await renderTab(active);
  };

  /* ── purchase orders tab ── */

  async function renderOrders(panel, pid) {
    const state = st(panel);
    const [orders, vendors, intents] = await Promise.all([P.list(pid, state), P.vendors(pid, {}), P.pendingIntents(pid)]);
    const canEdit = ERP.security.can("procurement.edit");
    const canApprove = ERP.security.can("procurement.approve");
    const vmap = {}; vendors.forEach((v) => { vmap[v.id] = v.name; });
    const cmap = {}; (await clientOptions()).forEach((c) => { cmap[c.value] = c.label; });
    const rows = orders.map((p) => {
      const canPlace = p.status === "approved" && canEdit;
      const canDecide = p.status === "pending_approval" && canApprove;
      return {
        number: ui.esc(p.number || ""),
        vendor: ui.esc(vmap[p.vendorId] || "—"),
        client: ui.esc(cmap[p.companyId] || "—"),
        status: ui.badge(P.statusLabel(p.status), P.statusTone(p.status)),
        total: maskedMoney(p.total, p.currency),
        expected: ui.esc(p.expectedDate || "—"),
        received: P.outstanding(p) > 0 ? String(P.outstanding(p)) + " outstanding" : ui.badge("complete", "success"),
        actions: ui.btn("Open", { small: true, act: "po-open", arg: p.id }) + (canPlace ? " " + ui.btn("Order", { small: true, primary: true, act: "po-order", arg: p.id }) : "") + (canDecide ? " " + ui.btn("Approve", { small: true, primary: true, act: "po-approve", arg: p.id }) : "") + (canEdit ? " " + ui.btn("Edit", { small: true, act: "po-edit", arg: p.id }) : ""),
      };
    });
    const open = orders.filter((p) => OPEN_STATUSES.indexOf(p.status) !== -1);
    const intentRows = intents.map((i) => ({
      item: ui.esc(ERP.catalog.itemLabel({ sku: "", name: i.description })),
      qty: String(num(i.qty)),
      cost: maskedMoney(i.unitCost),
      quote: ui.esc(i.quoteId != null ? "#" + i.quoteId : "—"),
      actions: canEdit ? ui.btn("Add to draft", { small: true, act: "po-intent", arg: i.id }) : "",
    }));
    panel.innerHTML =
      ui.summary([
        { label: "Open POs", value: String(open.length) },
        { label: "Committed", value: maskedMoney(round2(open.reduce((n, p) => n + num(p.total), 0))) },
        { label: "Awaiting approval", value: String(orders.filter((p) => p.status === "pending_approval").length) },
        { label: "Vendors", value: String(vendors.length) },
        { label: "Pending intents", value: String(intents.length) },
      ]) +
      '<div class="erp-db-toolbar">' +
        '<input class="erp-input" data-pf="q" placeholder="Search number or note…" value="' + ui.esc(state.q) + '">' +
        ui.select("pf-status", "Status", [{ value: "", label: "Any status" }].concat(P.PO_STATUSES.map((s) => ({ value: s.id, label: s.label }))), state.status) +
        ui.select("pf-vendor", "Vendor", [{ value: "", label: "All vendors" }].concat(vendors.map((v) => ({ value: v.id, label: v.name }))), state.vendorId) +
        (canEdit ? ui.btn("New PO", { small: true, primary: true, act: "po-new" }) : "") +
        (canEdit && intents.length ? ui.btn("Raise from intents (" + intents.length + ")", { small: true, act: "po-fromintents" }) : "") +
      "</div>" +
      ui.table([
        { key: "number", label: "PO" }, { key: "vendor", label: "Vendor" }, { key: "client", label: "Client" },
        { key: "status", label: "Status" }, { key: "total", label: "Total", align: "right" },
        { key: "expected", label: "Expected" }, { key: "received", label: "Fulfilment" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No purchase orders yet." }) +
      (intentRows.length ? ui.card("Procurement intents from converted quotes", ui.table([
        { key: "item", label: "Item" }, { key: "qty", label: "Qty", align: "right" }, { key: "cost", label: "Unit cost", align: "right" },
        { key: "quote", label: "Quote" }, { key: "actions", label: "", align: "right" },
      ], intentRows, { emptyText: "No pending intents." })) : "");

    const qEl = panel.querySelector('[data-pf="q"]');
    if (qEl) qEl.addEventListener("change", () => { state.q = qEl.value; renderTab("orders"); });
    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("orders"); }); };
    bindSel('[name="pf-status"]', "status"); bindSel('[name="pf-vendor"]', "vendorId");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "po-new") return openPOModal(pid, null, () => renderTab("orders"));
      if (act === "po-edit") { const p = await P.get(pid, arg); if (p) return openPOModal(pid, p, () => renderTab("orders")); }
      if (act === "po-open") { const p = await P.get(pid, arg); if (p) return openPODetail(pid, p, () => renderTab("orders")); }
      if (act === "po-order") { const r = await P.order(pid, arg, {}); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Purchase order placed.", "success"); renderTab("orders"); }
      if (act === "po-approve") return openApproveModal(pid, arg, () => renderTab("orders"));
      if (act === "po-fromintents") return openFromIntentsModal(pid, intents, () => renderTab("orders"));
    });
  }

  /* ── vendors tab ── */

  async function renderVendors(panel, pid) {
    const state = st(panel);
    const [vendors, orders] = await Promise.all([P.vendors(pid, { q: state.q }), P.list(pid, {})]);
    const canEdit = ERP.security.can("procurement.edit");
    const spend = {};
    orders.forEach((p) => { spend[p.vendorId] = (spend[p.vendorId] || 0) + num(p.total); });
    const rows = vendors.map((v) => ({
      name: ui.esc(v.name) + (v.active === false ? " " + ui.badge("inactive", "muted") : ""),
      code: ui.esc(v.code || "—"),
      contact: ui.esc(v.contactName || "—") + (v.email ? ' <span class="erp-sub">' + ui.esc(v.email) + "</span>" : ""),
      terms: ui.esc(v.terms || "—"),
      lead: v.leadTimeDays != null ? String(v.leadTimeDays) + " days" : "—",
      spend: maskedMoney(round2(spend[v.id] || 0)),
      actions: ui.btn("Edit", { small: true, act: "ve-edit", arg: v.id }) + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "ve-del", arg: v.id }) : ""),
    }));
    panel.innerHTML =
      '<div class="erp-db-toolbar">' +
        '<input class="erp-input" data-vf="q" placeholder="Search vendors…" value="' + ui.esc(state.q || "") + '">' +
        (canEdit ? ui.btn("New vendor", { small: true, primary: true, act: "ve-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "name", label: "Vendor" }, { key: "code", label: "Code" }, { key: "contact", label: "Contact" },
        { key: "terms", label: "Terms" }, { key: "lead", label: "Lead time" }, { key: "spend", label: "Ordered value", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No vendors yet." });
    const qEl = panel.querySelector('[data-vf="q"]');
    if (qEl) qEl.addEventListener("change", () => { state.q = qEl.value; renderTab("vendors"); });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ve-new") return openVendorModal(pid, null, () => renderTab("vendors"));
      if (act === "ve-edit") { const v = await P.vendor(pid, arg); if (v) return openVendorModal(pid, v, () => renderTab("vendors")); }
      if (act === "ve-del") { ui.confirm({ title: "Delete vendor", message: "Delete this vendor?", onConfirm: async () => { const r = await P.removeVendor(pid, arg); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Vendor deleted.", "success"); renderTab("vendors"); } }); }
    });
  }

  /* ── approvals & rules tab ── */

  async function renderApprovals(panel, pid) {
    const [policy, queue, catalogSettings, overrides] = await Promise.all([
      P.policy(pid), P.approvalQueue(pid), ERP.catalog.settings(pid), ERP.catalog.marginOverrides(pid, {}),
    ]);
    const canApprove = ERP.security.can("procurement.approve");
    const canMargins = ERP.security.can("catalog.margins");
    const qRows = queue.map((p) => ({
      number: ui.esc(p.number || ""),
      total: maskedMoney(p.total, p.currency),
      threshold: maskedMoney(p.approval && p.approval.threshold),
      requested: ui.esc((p.approval && p.approval.requestedBy) || "—"),
      actions: canApprove ? ui.btn("Approve", { small: true, primary: true, act: "po-approve", arg: p.id }) + " " + ui.btn("Open", { small: true, act: "po-open", arg: p.id }) : ui.btn("Open", { small: true, act: "po-open", arg: p.id }),
    }));
    const ovRows = overrides.map((o) => ({
      ref: ui.esc((o.refType === "po" ? "PO " : "Quote ") + (o.refNumber || "#" + o.refId)),
      type: ui.badge(o.type === "markup" ? "Markup" : "Margin", o.type === "markup" ? "warn" : "info"),
      actual: ERP.security.canSeeFinancials() ? num(o.actualPct) + "%" : "•••",
      floor: num(o.floorPct) + "%",
      reason: ui.esc(o.reason || ""),
      by: ui.esc(o.by || ""),
      at: ui.esc(ui.date(o.at)),
    }));
    const form =
      ui.form(
        '<div class="erp-form-row">' +
          ui.number("poApprovalThreshold", "PO approval threshold", policy.poApprovalThreshold, { step: 50, min: 0 }) +
          ui.number("quoteMarginFloorPct", "Quote margin floor %", catalogSettings.quoteMarginFloorPct, { step: 0.5, min: 0 }) +
        "</div>" +
        '<div class="erp-form-row">' +
          ui.number("poMarkupFloorPct", "PO markup floor %", catalogSettings.poMarkupFloorPct, { step: 0.5, min: 0 }) +
        "</div>" +
        ui.check("enforceApprovals", "Require approval at or above the threshold", policy.enforceApprovals !== false) +
        ui.check("enforceMarkupFloor", "Block submission below the markup floor", policy.enforceMarkupFloor !== false) +
        ui.check("allowOverride", "Allow a recorded override of a floor", policy.allowOverride !== false) +
        ui.check("requireVendor", "Require a vendor on every purchase order", policy.requireVendor !== false),
        canApprove ? ui.btn("Save rules", { small: true, primary: true, act: "pr-save" }) : ui.alert("Only an approver may change procurement rules.", "warn")
      );
    panel.innerHTML =
      ui.grid([
        ui.card("Procurement approval & margin rules", form),
        ui.card("Awaiting approval", ui.table([
          { key: "number", label: "PO" }, { key: "total", label: "Total", align: "right" }, { key: "threshold", label: "Threshold", align: "right" },
          { key: "requested", label: "Requested by" }, { key: "actions", label: "", align: "right" },
        ], qRows, { emptyText: "No purchase orders are awaiting approval." })),
      ]) +
      ui.card("Recorded floor overrides", ui.table([
        { key: "ref", label: "Record" }, { key: "type", label: "Floor" }, { key: "actual", label: "Actual", align: "right" },
        { key: "floor", label: "Floor", align: "right" }, { key: "reason", label: "Reason" }, { key: "by", label: "By" }, { key: "at", label: "When" },
      ], ovRows, { emptyText: "No floor has been overridden." }));

    const saveBtn = panel.querySelector("[data-act=pr-save]");
    if (saveBtn) saveBtn.onclick = async (btn) => {
      const formEl = panel.querySelector("[data-ui-form]");
      const v = ui.collect(formEl, ["poApprovalThreshold", "quoteMarginFloorPct", "poMarkupFloorPct", "enforceApprovals", "enforceMarkupFloor", "allowOverride", "requireVendor"]);
      btn.disabled = true;
      const rp = await P.savePolicy(pid, v);
      const rc = canMargins ? await ERP.catalog.saveSettings(pid, { poApprovalThreshold: v.poApprovalThreshold, quoteMarginFloorPct: v.quoteMarginFloorPct, poMarkupFloorPct: v.poMarkupFloorPct, allowOverride: v.allowOverride }) : { record: null };
      if (rp.error) { ERP.toast(rp.message || rp.error, "error"); btn.disabled = false; return; }
      void rc;
      ERP.toast("Procurement rules saved.", "success"); renderTab("approvals");
    };
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "po-approve") return openApproveModal(pid, arg, () => renderTab("approvals"));
      if (act === "po-open") { const p = await P.get(pid, arg); if (p) return openPODetail(pid, p, () => renderTab("approvals")); }
    });
  }

  /* ── PO modal ── */

  async function openPOModal(pid, po, refresh) {
    if (!ERP.security.enforce("procurement.edit")) return;
    const [vendors, clients, items, members] = await Promise.all([P.vendors(pid, { active: "active" }), clientOptions(), ERP.catalog.options(pid), (ERP.members ? ERP.members.members() : Promise.resolve([]))]);
    const [opps, projects] = await Promise.all([
      (ERP.sales ? ERP.sales.list(pid, {}) : Promise.resolve([])),
      (ERP.projects ? ERP.projects.list(pid, {}) : Promise.resolve([])),
    ]);
    const p = po ? clone(po) : P.newPO({ orderDate: ui.today() });
    p.lines = (p.lines || []).map((l) => Object.assign(P.newLine(), l));
    let lineSeq = p.lines.length;
    const oppOptions = [{ value: "", label: "— none —" }].concat(opps.map((o) => ({ value: o.id, label: (o.number || "") + " " + o.name })));
    const projOptions = [{ value: "", label: "— none —" }].concat((projects || []).map((x) => ({ value: x.id, label: (x.number || "") + " " + x.name })));
    const head =
      '<div class="erp-form-row">' +
        ui.select("vendorId", "Vendor", [{ value: "", label: "— choose a vendor —" }].concat(vendors.map((v) => ({ value: v.id, label: v.name }))), p.vendorId) +
        ui.select("companyId", "Client", [{ value: "", label: "— none —" }].concat(clients), p.companyId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("opportunityId", "Opportunity", oppOptions, p.opportunityId) +
        ui.select("projectId", "Project", projOptions, p.projectId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("orderDate", "Order date", p.orderDate) +
        ui.dateInput("expectedDate", "Expected date", p.expectedDate) +
        ui.number("taxRate", "Tax %", p.taxRate, { min: 0, step: 0.1 }) +
      "</div>" +
      ui.check("dropShip", "Drop-ship (deliver straight to the client)", !!p.dropShip) +
      ui.textarea("notes", "Notes", p.notes, 2);
    const body = ui.form(head) +
      ui.card("Line items", '<div data-po-lines></div><div class="erp-proj-add-row">' + ui.btn("Add line", { small: true, act: "pom-addline" }) + "</div>") +
      '<div data-po-totals></div>';
    const modal = ui.modal({
      title: po ? "Edit purchase order " + (po.number || "") : "New purchase order", size: "lg", body: body,
      foot: ui.btn("Cancel", { small: true, act: "pom-cancel" }) + " " + ui.btn(po ? "Save draft" : "Create draft", { small: true, primary: true, act: "pom-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    const linesCtn = modal.querySelector("[data-po-lines]");
    const totalsCtn = modal.querySelector("[data-po-totals]");
    const itemMap = {}; items.forEach((i) => { itemMap[i.value] = i; });
    void members;

    function readLines() {
      return [...linesCtn.querySelectorAll("[data-line]")].map((row) => ({
        id: row.getAttribute("data-line"),
        itemId: row.querySelector('[data-lf="itemId"]').value || null,
        description: row.querySelector('[data-lf="description"]').value,
        qty: num(row.querySelector('[data-lf="qty"]').value, 1),
        unit: row.querySelector('[data-lf="unit"]').value,
        unitCost: num(row.querySelector('[data-lf="unitCost"]').value),
        unitPrice: num(row.querySelector('[data-lf="unitPrice"]').value),
        receivedQty: num(row.getAttribute("data-received")),
        taxRate: 0,
      }));
    }
    function drawTotals() {
      const t = P.compute(Object.assign({}, p, { lines: readLines(), taxRate: num((form.querySelector('[name="taxRate"]') || {}).value) }));
      totalsCtn.innerHTML = ui.summary([
        { label: "Subtotal", value: maskedMoney(t.subtotal) },
        { label: "Tax", value: maskedMoney(t.tax) },
        { label: "Total", value: maskedMoney(t.total) },
      ]);
    }
    function drawLines() {
      linesCtn.innerHTML = (p.lines.length ? p.lines.map((l) => '<div class="erp-po-line" data-line="' + ui.esc(l.id) + '" data-received="' + ui.esc(l.receivedQty) + '">' +
        '<select class="erp-input" data-lf="itemId">' + [{ value: "", label: "— item —" }].concat(items.map((i) => ({ value: i.value, label: i.label }))).map((o) => '<option value="' + ui.esc(o.value) + '"' + (String(o.value) === String(l.itemId) ? " selected" : "") + ">" + ui.esc(o.label) + "</option>").join("") + "</select>" +
        '<input class="erp-input" data-lf="description" value="' + ui.esc(l.description) + '" placeholder="Description">' +
        '<input class="erp-input" type="number" data-lf="qty" value="' + ui.esc(l.qty) + '" placeholder="Qty">' +
        '<input class="erp-input" data-lf="unit" value="' + ui.esc(l.unit) + '" placeholder="Unit">' +
        '<input class="erp-input" type="number" data-lf="unitCost" value="' + ui.esc(l.unitCost) + '" placeholder="Unit cost">' +
        '<input class="erp-input" type="number" data-lf="unitPrice" value="' + ui.esc(l.unitPrice) + '" placeholder="Resale price">' +
        '<button type="button" class="btn small danger" data-act="pom-rmline" data-arg="' + ui.esc(l.id) + '">×</button></div>').join("")
        : '<p class="erp-alert">No lines yet — add one.</p>');
      drawTotals();
    }
    drawLines();
    form.addEventListener("input", drawTotals);
    linesCtn.addEventListener("input", drawTotals);
    linesCtn.addEventListener("change", async (e) => {
      const lf = e.target && e.target.getAttribute && e.target.getAttribute("data-lf");
      if (lf !== "itemId") return;
      const row = e.target.closest("[data-line]");
      const item = itemMap[e.target.value];
      if (!row || !item) return;
      const it = await ERP.catalog.item(pid, item.value);
      if (!it) return;
      const desc = row.querySelector('[data-lf="description"]');
      const unit = row.querySelector('[data-lf="unit"]');
      const cost = row.querySelector('[data-lf="unitCost"]');
      const price = row.querySelector('[data-lf="unitPrice"]');
      if (desc && !desc.value) desc.value = it.name;
      if (unit && !unit.value) unit.value = it.unit || "each";
      if (cost && !num(cost.value)) cost.value = it.cost;
      if (price && !num(price.value)) {
        try { price.value = await ERP.catalog.priceFor(pid, it.id, { companyId: (form.querySelector('[name="companyId"]') || {}).value }); }
        catch (er) { price.value = it.price; }
      }
      drawTotals();
    });
    modal.querySelector("[data-act=pom-addline]").onclick = () => { p.lines = readLines(); lineSeq += 1; p.lines.push(P.newLine({ id: "PL" + lineSeq })); drawLines(); };
    ui.bind(modal, "click", "[data-act]", (el, e, act, arg) => {
      if (act === "pom-rmline") { p.lines = readLines().filter((l) => String(l.id) !== String(arg)); drawLines(); }
    });
    modal.querySelector("[data-act=pom-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pom-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["vendorId", "companyId", "opportunityId", "projectId", "orderDate", "expectedDate", "taxRate", "dropShip", "notes"]);
      btn.disabled = true;
      const payload = Object.assign({}, p, v, {
        id: p.id, lines: readLines(),
        companyId: v.companyId || null, opportunityId: v.opportunityId || null, projectId: v.projectId || null,
      });
      const r = await P.save(pid, payload);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(po ? "Purchase order saved." : "Draft purchase order created.", "success"); refresh();
    };
  }

  /* ── PO detail + status actions ── */

  async function openPODetail(pid, po, refresh) {
    const [vendor, company, receipts, floors] = await Promise.all([
      P.vendor(pid, po.vendorId), po.companyId ? ERP.companies.get(po.companyId) : Promise.resolve(null),
      (ERP.inventory ? ERP.inventory.receipts(pid, { poId: po.id }) : Promise.resolve([])),
      ERP.catalog.checkPoFloors(pid, po),
    ]);
    const canEdit = ERP.security.can("procurement.edit");
    const canApprove = ERP.security.can("procurement.approve");
    const canReceive = ERP.security.can("procurement.receive");
    const lineRows = (po.lines || []).map((l) => ({
      item: ui.esc(l.description || "—"),
      qty: String(num(l.qty)),
      unit: ui.esc(l.unit || ""),
      cost: maskedMoney(l.unitCost),
      price: num(l.unitPrice) ? maskedMoney(l.unitPrice) : "—",
      received: String(num(l.receivedQty)) + (num(l.receivedQty) >= num(l.qty) ? " " + ui.badge("done", "success") : ""),
    }));
    const receiptRows = (receipts || []).map((r) => ({
      number: ui.esc(r.number), date: ui.esc(r.date), drop: r.dropShip ? ui.badge("drop-ship", "info") : ui.badge("stock", "muted"),
      units: String(round2((r.lines || []).reduce((n, l) => n + num(l.qtyReceived), 0))),
    }));
    const historyRows = (po.history || []).slice().reverse().map((h) => ({ at: ui.esc(ui.dateTime(h.at)), by: ui.esc(h.by || ""), text: ui.esc(h.text || "") }));
    const actions = [];
    if (canEdit && po.status === "draft") actions.push(ui.btn("Submit", { small: true, primary: true, act: "pd-submit", arg: po.id }));
    if (canApprove && po.status === "pending_approval") actions.push(ui.btn("Approve", { small: true, primary: true, act: "pd-approve", arg: po.id }) + " " + ui.btn("Reject", { small: true, danger: true, act: "pd-reject", arg: po.id }));
    if (canEdit && po.status === "approved") actions.push(ui.btn("Place order", { small: true, primary: true, act: "pd-order", arg: po.id }));
    if (canReceive && ["approved", "ordered", "partially_received"].indexOf(po.status) !== -1) actions.push(ui.btn("Receive", { small: true, act: "pd-receive", arg: po.id }));
    if (canEdit && ["received", "partially_received"].indexOf(po.status) !== -1) actions.push(ui.btn("Close", { small: true, act: "pd-close", arg: po.id }));
    if (canEdit && ["draft", "approved", "ordered", "pending_approval", "partially_received"].indexOf(po.status) !== -1) actions.push(ui.btn("Cancel", { small: true, danger: true, act: "pd-cancel", arg: po.id }));

    const body =
      ui.summary([
        { label: "Status", value: ui.badge(P.statusLabel(po.status), P.statusTone(po.status)) },
        { label: "Total", value: maskedMoney(po.total, po.currency) },
        { label: "Vendor", value: ui.esc(vendor ? vendor.name : "—") },
        { label: "Client", value: ui.esc(company ? company.name : "—") },
        { label: "Expected", value: ui.esc(po.expectedDate || "—") },
        { label: "Received", value: ui.esc(po.receivedDate || "—") },
      ]) +
      (!floors.ok ? ui.alert("A resale line is below the " + floors.floorPct + "% markup floor. Submission needs a recorded override.", "warn") : "") +
      ui.card("Lines", ui.table([
        { key: "item", label: "Item" }, { key: "qty", label: "Qty", align: "right" }, { key: "unit", label: "Unit" },
        { key: "cost", label: "Unit cost", align: "right" }, { key: "price", label: "Resale", align: "right" }, { key: "received", label: "Received", align: "right" },
      ], lineRows, { emptyText: "No lines." })) +
      (po.notes ? ui.card("Notes", "<p>" + ui.esc(po.notes) + "</p>") : "") +
      ui.grid([
        ui.card("Receipts", ui.table([
          { key: "number", label: "Receipt" }, { key: "date", label: "Date" }, { key: "drop", label: "Type" }, { key: "units", label: "Units", align: "right" },
        ], receiptRows, { emptyText: "Nothing received yet." })),
        ui.card("History", ui.table([
          { key: "at", label: "When" }, { key: "by", label: "By" }, { key: "text", label: "Event" },
        ], historyRows, { emptyText: "No history." })),
      ]);
    const modal = ui.modal({
      title: "Purchase order " + (po.number || ""), size: "lg", body: body,
      foot: ui.btn("Close", { small: true, act: "pd-dismiss" }) + (actions.length ? " " + actions.join(" ") : ""),
    });
    modal.querySelector("[data-act=pd-dismiss]").onclick = () => ui.closeModal();
    ui.bind(modal, "click", "[data-act]", async (el, e, act) => {
      if (act === "pd-submit") return submitWithFloor(pid, po.id, refresh);
      if (act === "pd-approve") return openApproveModal(pid, po.id, refresh, true);
      if (act === "pd-reject") return openRejectModal(pid, po.id, refresh);
      if (act === "pd-order") {
        const r = await P.order(pid, po.id, {});
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ui.closeModal(); ERP.toast("Purchase order placed.", "success"); refresh();
      }
      if (act === "pd-close") {
        const r = await P.close(pid, po.id);
        if (r.error) return ERP.toast(r.message || r.error, "error");
        ui.closeModal(); ERP.toast("Purchase order closed.", "success"); refresh();
      }
      if (act === "pd-cancel") return openCancelModal(pid, po.id, refresh);
      if (act === "pd-receive") { ui.closeModal(); return ERP.inventory.openReceiveModal(pid, { poId: po.id }, refresh); }
    });
  }

  /* Submit a draft; on a markup-floor failure, offer a recorded override. */
  async function submitWithFloor(pid, id, refresh) {
    let r = await P.submit(pid, id, {});
    if (r.error === "markup_floor") {
      const ok = await ui.confirm({ title: "Override markup floor", message: "A line is below the markup floor. Record an override with a reason?", okLabel: "Override" });
      if (!ok) return;
      const reason = await promptText("Override reason", "Why is this below the floor?");
      if (!reason) return ERP.toast("A reason is required to override.", "error");
      r = await P.submit(pid, id, { override: true, overrideReason: reason });
    }
    if (r.error) return ERP.toast(r.message || r.error, "error");
    ui.closeModal(); ERP.toast(r.requiresApproval ? "Submitted for approval." : "Purchase order approved.", "success"); refresh();
  }

  function promptText(title, placeholder) {
    return new Promise((resolve) => {
      ui.modal({ title: title, body: '<input class="erp-input" id="prReason" placeholder="' + ui.esc(placeholder || "") + '">', foot: ui.btn("Cancel", { small: true, act: "pt-no" }) + " " + ui.btn("Confirm", { small: true, primary: true, act: "pt-yes" }) });
      const m = document.querySelector("#uiModal");
      m.querySelector("[data-act=pt-no]").onclick = () => { ui.closeModal(); resolve(""); };
      m.querySelector("[data-act=pt-yes]").onclick = () => { const v = (m.querySelector("#prReason") || {}).value || ""; ui.closeModal(); resolve(v.trim()); };
    });
  }

  async function openApproveModal(pid, id, refresh, fromDetail) {
    if (!ERP.security.enforce("procurement.approve")) return;
    const po = await P.get(pid, id);
    if (!po) return;
    const floors = await ERP.catalog.checkPoFloors(pid, po);
    const body = ui.summary([
      { label: "PO", value: ui.esc(po.number || "") },
      { label: "Total", value: maskedMoney(po.total, po.currency) },
      { label: "Threshold", value: maskedMoney(po.approval && po.approval.threshold) },
    ]) +
      (!floors.ok ? ui.alert("A resale line is below the " + floors.floorPct + "% markup floor.", "warn") : "") +
      ui.form(ui.textarea("note", "Approval note", "", 2) + (!floors.ok ? ui.text("overrideReason", "Override reason", "", "Required to pass the floor") : ""));
    const modal = ui.modal({
      title: "Approve " + (po.number || "purchase order"), body: body,
      foot: ui.btn("Cancel", { small: true, act: "pa-cancel" }) + " " + ui.btn("Approve", { small: true, primary: true, act: "pa-go" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pa-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pa-go]").onclick = async (btn) => {
      const v = ui.collect(form, ["note", "overrideReason"]);
      btn.disabled = true;
      const r = await P.approve(pid, id, { note: v.note, override: !floors.ok && !!v.overrideReason, overrideReason: v.overrideReason });
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Purchase order approved.", "success"); refresh();
      void fromDetail;
    };
  }

  async function openRejectModal(pid, id, refresh) {
    if (!ERP.security.enforce("procurement.approve")) return;
    const modal = ui.modal({
      title: "Reject purchase order", body: ui.form(ui.textarea("reason", "Reason", "", 2)),
      foot: ui.btn("Cancel", { small: true, act: "pj-cancel" }) + " " + ui.btn("Reject", { small: true, danger: true, act: "pj-go" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pj-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pj-go]").onclick = async (btn) => {
      const v = ui.collect(form, ["reason"]);
      btn.disabled = true;
      const r = await P.reject(pid, id, v.reason);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Purchase order rejected.", "success"); refresh();
    };
  }

  async function openCancelModal(pid, id, refresh) {
    const modal = ui.modal({
      title: "Cancel purchase order", body: ui.form(ui.textarea("reason", "Reason", "", 2)),
      foot: ui.btn("Keep", { small: true, act: "pc-cancel" }) + " " + ui.btn("Cancel PO", { small: true, danger: true, act: "pc-go" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pc-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pc-go]").onclick = async (btn) => {
      const v = ui.collect(form, ["reason"]);
      btn.disabled = true;
      const r = await P.cancel(pid, id, v.reason);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Purchase order cancelled.", "success"); refresh();
    };
  }

  async function openFromIntentsModal(pid, intents, refresh) {
    if (!ERP.security.enforce("procurement.edit")) return;
    const vendors = await P.vendors(pid, { active: "active" });
    const body = ui.alert("These product lines were raised when a quote was converted. Choose a vendor to raise a draft purchase order; the intents are then marked ordered.", "info") +
      ui.table([
        { key: "desc", label: "Item" }, { key: "qty", label: "Qty", align: "right" }, { key: "cost", label: "Unit cost", align: "right" },
      ], intents.map((i) => ({ desc: ui.esc(i.description || "—"), qty: String(num(i.qty)), cost: maskedMoney(i.unitCost) }))) +
      ui.form(ui.select("vendorId", "Vendor", [{ value: "", label: "— choose a vendor —" }].concat(vendors.map((v) => ({ value: v.id, label: v.name }))), ""));
    const modal = ui.modal({
      title: "Raise purchase order from intents", size: "lg", body: body,
      foot: ui.btn("Cancel", { small: true, act: "pf-cancel" }) + " " + ui.btn("Create draft", { small: true, primary: true, act: "pf-go" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=pf-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=pf-go]").onclick = async (btn) => {
      const v = ui.collect(form, ["vendorId"]);
      if (!v.vendorId) return ERP.toast("Choose a vendor.", "error");
      btn.disabled = true;
      const r = await P.fromIntents(pid, intents.map((i) => i.id), { vendorId: v.vendorId });
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast("Draft " + r.record.number + " created from " + r.intents + " intent(s).", "success"); refresh();
    };
  }

  /* ── vendor modal ── */

  async function openVendorModal(pid, vendor, refresh) {
    if (!ERP.security.enforce("procurement.edit")) return;
    const v = vendor ? clone(vendor) : P.newVendor();
    const head =
      '<div class="erp-form-row">' +
        ui.text("name", "Vendor", v.name, "e.g. Ingram Micro") +
        ui.text("code", "Code", v.code) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("contactName", "Contact", v.contactName) +
        ui.text("email", "Email", v.email) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("phone", "Phone", v.phone) +
        ui.text("website", "Website", v.website) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("terms", "Terms", v.terms, "Net 30") +
        ui.number("leadTimeDays", "Lead time (days)", v.leadTimeDays, { min: 0, step: 1 }) +
        ui.select("currency", "Currency", [{ value: "", label: "Provider default" }].concat(Object.keys(ui.CURRENCIES).map((c) => ({ value: c, label: c }))), v.currency) +
      "</div>" +
      ui.text("address", "Address", v.address) +
      ui.check("active", "Active", v.active !== false) +
      ui.textarea("notes", "Notes", v.notes, 2);
    const modal = ui.modal({
      title: vendor ? "Edit vendor" : "New vendor", size: "lg", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "vm-cancel" }) + " " + ui.btn(vendor ? "Save" : "Create", { small: true, primary: true, act: "vm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=vm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=vm-save]").onclick = async (btn) => {
      const val = ui.collect(form, ["name", "code", "contactName", "email", "phone", "website", "terms", "leadTimeDays", "currency", "address", "active", "notes"]);
      if (!val.name) return ERP.toast("Give the vendor a name.", "error");
      btn.disabled = true;
      const r = await P.saveVendor(pid, Object.assign({}, v, val, { id: v.id }));
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(vendor ? "Vendor saved." : "Vendor created.", "success"); refresh();
    };
  }
})();
