/* ============================================================
   PSA-U — product & service catalog, pricing and margin rules
   (Phase 9 · Tasks 42 & 45)

   The commercial catalog every other module prices from. This
   module owns:

     • catalogItem  — a product, service, subscription or labour
                      line with a SKU, a cost, a sell price, a class
                      and category (from the taxonomy), a unit, a tax
                      code, an optional preferred vendor and optional
                      stock behaviour (Task 42).
     • priceRule    — a documented pricing rule that derives a sell
                      price from cost or list price (markup / margin
                      / percent-adjust / fixed), scoped to an item, a
                      category, a class, a vendor or the provider,
                      with effective dates and a priority (Task 42).
     • priceOverride— a per-client price or discount for a single
                      item, with effective dates, so a negotiated
                      rate applies wherever the item is quoted
                      (Task 42).
     • margin rules — the configurable margin and markup floors a
                      quote or purchase order must respect, plus the
                      recorded overrides that let an authorised user
                      pass a floor deliberately (Task 45).

   Storage: catalog records live in the PROVIDER document (kinds
   "catalogItem" / "priceRule" / "priceOverride" / "catalogSettings"
   / "marginOverride") because a catalog is the practice's, shared by
   every client.

   resolvePrice(pid, {itemId, companyId, qty, date}) walks the
   documented precedence — client override, then item, category,
   class, vendor and provider rules, then the item's own list price —
   and returns the price together with the chain of rules it
   considered and which one applied, so a quote line's price is
   explainable and testable (the same discipline as Phase 4 rate
   resolution and Phase 5 charge derivation).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const C = (ERP.catalog = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("catalog requires the tenancy service");
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

  C.ITEM_TYPES = [
    { id: "product", label: "Product", inventory: true },
    { id: "service", label: "Service", inventory: false },
    { id: "subscription", label: "Subscription", inventory: false },
    { id: "labor", label: "Labour", inventory: false },
  ];
  C.itemTypeLabel = (id) => (C.ITEM_TYPES.find((t) => t.id === id) || {}).label || id || "—";
  C.itemTypeTone = (id) => ({ product: "info", service: "muted", subscription: "success", labor: "warn" }[id] || "muted");

  C.UNITS = ["each", "hour", "day", "week", "month", "year", "user", "device", "license", "seat", "GB", "TB"];

  C.PRICE_MODES = [
    { id: "markup", label: "Markup on cost %" },
    { id: "margin", label: "Margin on sell %" },
    { id: "percent", label: "Adjust list price %" },
    { id: "fixed", label: "Fixed price" },
  ];
  C.modeLabel = (id) => (C.PRICE_MODES.find((m) => m.id === id) || {}).label || id || "—";

  C.ROUNDINGS = [
    { id: "none", label: "No rounding" },
    { id: "cent", label: "Nearest cent" },
    { id: "nickel", label: "Nearest 5¢" },
    { id: "dime", label: "Nearest 10¢" },
    { id: "half", label: "Nearest 50¢" },
    { id: "whole", label: "Whole unit" },
  ];
  C.roundingLabel = (id) => (C.ROUNDINGS.find((r) => r.id === id) || {}).label || "No rounding";

  C.SCOPES = [
    { id: "global", label: "Provider-wide" },
    { id: "vendor", label: "By vendor" },
    { id: "class", label: "By class" },
    { id: "category", label: "By category" },
    { id: "item", label: "By item" },
  ];
  C.scopeLabel = (id) => (C.SCOPES.find((s) => s.id === id) || {}).label || id || "—";

  const SCOPE_RANK = { item: 5, category: 4, class: 3, vendor: 2, global: 1 };

  C.DEFAULT_SETTINGS = {
    quoteMarginFloorPct: 20,
    poMarkupFloorPct: 25,
    poApprovalThreshold: 2500,
    enforceQuotes: true,
    enforcePos: true,
    allowOverride: true,
    currency: "",
  };

  /* A starter catalog a new practice can quote from immediately. */
  C.DEFAULT_ITEMS = [
    { sku: "SVC-MGMT-WS", name: "Managed workstation", type: "subscription", classId: "subscription", categoryId: "workstation", unit: "device", cost: 8, price: 25, description: "Monitoring, patching and endpoint protection for one workstation." },
    { sku: "SVC-MGMT-SRV", name: "Managed server", type: "subscription", classId: "subscription", categoryId: "server", unit: "device", cost: 35, price: 95, description: "Monitoring, patching and backup verification for one server." },
    { sku: "SVC-M365-BP", name: "Microsoft 365 Business Premium", type: "subscription", classId: "subscription", categoryId: "cloud", unit: "user", cost: 18, price: 28, taxCode: "TAX", description: "Per-user productivity & security subscription." },
    { sku: "SVC-LABOUR-STD", name: "On-site labour — standard hours", type: "labor", classId: "labor", categoryId: "support", unit: "hour", cost: 55, price: 150, description: "Remote or on-site engineering during business hours." },
    { sku: "SVC-LABOUR-AFT", name: "On-site labour — after hours", type: "labor", classId: "labor", categoryId: "support", unit: "hour", cost: 70, price: 225, description: "Engineering outside business hours." },
    { sku: "HW-FW-EDGE", name: "Edge firewall appliance", type: "product", classId: "hardware", categoryId: "security", unit: "each", cost: 480, price: 950, trackInventory: true, reorderPoint: 2, reorderQty: 5, description: "Next-gen firewall with 3-year subscription." },
    { sku: "HW-SW-48", name: "48-port managed switch", type: "product", classId: "hardware", categoryId: "network", unit: "each", cost: 620, price: 1150, trackInventory: true, reorderPoint: 1, reorderQty: 3, description: "Layer-2/3 managed switch." },
    { sku: "SW-BDR", name: "Backup & disaster-recovery licence", type: "subscription", classId: "software", categoryId: "cloud", unit: "device", cost: 6, price: 18, description: "Off-site backup with tested restore." },
  ];

  C.DEFAULT_RULES = [
    { name: "Standard hardware markup", scope: "class", classId: "hardware", mode: "markup", value: 100, rounding: "half", priority: 100 },
    { name: "Standard service margin", scope: "class", classId: "service", mode: "margin", value: 55, rounding: "half", priority: 100 },
    { name: "Cloud resale margin", scope: "category", categoryId: "cloud", mode: "margin", value: 35, rounding: "cent", priority: 120 },
  ];

  /* ─────────────────────────── emit (workflow) ─────────────────────────── */

  async function emit(pid, event, payload, extra) {
    if (!ERP.workflow) return;
    try { await ERP.workflow.emit(event, Object.assign({ event: event, actor: actor() }, payload || {}, extra || {})); } catch (e) {}
  }

  /* ─────────────────────────── record models ─────────────────────────── */

  C.newItem = (over) => Object.assign({
    kind: "catalogItem", id: null, providerId: null,
    sku: "", name: "", description: "",
    type: "service", classId: "", categoryId: "", unit: "each",
    cost: 0, price: 0, taxCode: "", taxable: true,
    vendorId: null, vendorSku: "",
    trackInventory: false, reorderPoint: 0, reorderQty: 0,
    active: true, notes: "",
    createdAt: null, updatedAt: null, createdBy: null,
  }, over || {});

  C.newRule = (over) => Object.assign({
    kind: "priceRule", id: null, providerId: null,
    name: "", scope: "global", itemId: null, categoryId: "", classId: "", vendorId: null,
    mode: "markup", value: 0, rounding: "none", priority: 100,
    effectiveFrom: "", effectiveTo: "", active: true, notes: "",
    createdAt: null, updatedAt: null,
  }, over || {});

  C.newPriceOverride = (over) => Object.assign({
    kind: "priceOverride", id: null, providerId: null, itemId: null, companyId: null,
    price: null, discountPct: 0, effectiveFrom: "", effectiveTo: "", notes: "",
    createdAt: null, updatedAt: null,
  }, over || {});

  /* ─────────────────────────── settings ─────────────────────────── */

  C.settings = async function (pid) {
    let rec = null;
    try { rec = (await providerRecords(pid, "catalogSettings"))[0] || null; } catch (e) { rec = null; }
    return Object.assign({}, C.DEFAULT_SETTINGS, rec || {});
  };

  C.saveSettings = async function (pid, patch) {
    if (!ERP.security.enforce("catalog.margins")) return { error: "forbidden" };
    const cur = await C.settings(pid);
    const rec = Object.assign({ kind: "catalogSettings", id: "settings", providerId: pid }, cur, patch || {});
    await ten().upsert("provider", pid, rec);
    await emit(pid, "catalog.rules_updated", { settings: rec });
    return { record: rec };
  };

  /* ─────────────────────────── taxonomy & vendor option lists ─────────────────────────── */

  C.classOptions = async function (pid) {
    try { const l = await ERP.taxonomy.optionList(pid, "productClass"); return l.length ? l : []; } catch (e) { return []; }
  };
  C.categoryOptions = async function (pid) {
    try { const l = await ERP.taxonomy.optionList(pid, "productCategory"); return l.length ? l : []; } catch (e) { return []; }
  };
  C.vendorOptions = async function (pid, blank) {
    let list = [];
    try { if (ERP.procurement) list = await ERP.procurement.vendors(pid); } catch (e) { list = []; }
    return [{ value: "", label: blank || "— none —" }].concat(list.map((v) => ({ value: v.id, label: v.name })));
  };
  async function classLabel(pid, code) { if (!code) return "—"; try { return await ERP.taxonomy.label(pid, "productClass", code); } catch (e) { return code; } }
  async function categoryLabel(pid, code) { if (!code) return "—"; try { return await ERP.taxonomy.label(pid, "productCategory", code); } catch (e) { return code; } }
  C.classLabel = classLabel;
  C.categoryLabel = categoryLabel;

  /* ─────────────────────────── items ─────────────────────────── */

  C.newNumber = async function (pid, prefix) {
    const list = await providerRecords(pid, "catalogItem");
    let max = 0;
    list.forEach((i) => { const m = /(\d+)\s*$/.exec(String(i.sku || "")); if (m) max = Math.max(max, Number(m[1])); });
    return prefix + "-" + String(max + 1).padStart(4, "0");
  };

  C.items = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "catalogItem");
    if (query.type) list = list.filter((i) => String(i.type) === String(query.type));
    if (query.classId) list = list.filter((i) => String(i.classId) === String(query.classId));
    if (query.categoryId) list = list.filter((i) => String(i.categoryId) === String(query.categoryId));
    if (query.vendorId) list = list.filter((i) => String(i.vendorId) === String(query.vendorId));
    if (query.active === "active") list = list.filter((i) => i.active !== false);
    if (query.active === "inactive") list = list.filter((i) => i.active === false);
    const q = String(query.q || "").toLowerCase().trim();
    if (q) list = list.filter((i) => String(i.name || "").toLowerCase().indexOf(q) !== -1 || String(i.sku || "").toLowerCase().indexOf(q) !== -1 || String(i.description || "").toLowerCase().indexOf(q) !== -1);
    if (query.inventory) list = list.filter((i) => !!i.trackInventory);
    return list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  };

  C.item = async function (pid, id) {
    if (id == null || id === "") return null;
    const list = await providerRecords(pid, "catalogItem");
    return list.find((i) => String(i.id) === String(id)) || null;
  };
  C.itemBySku = async function (pid, sku) {
    const list = await providerRecords(pid, "catalogItem");
    return list.find((i) => String(i.sku || "").toLowerCase() === String(sku || "").toLowerCase()) || null;
  };

  /* Options for a generic item select: "SKU · name" so a picker reads well. */
  C.options = async function (pid, query) {
    const list = await C.items(pid, query);
    return list.map((i) => ({ value: i.id, label: (i.sku ? i.sku + " · " : "") + i.name }));
  };

  C.itemLabel = function (item) {
    if (!item) return "—";
    return (item.sku ? item.sku + " · " : "") + (item.name || "Item");
  };

  C.saveItem = async function (pid, rec) {
    if (!ERP.security.enforce("catalog.edit")) return { error: "forbidden" };
    const existing = rec && rec.id != null && rec.id !== "" ? await C.item(pid, rec.id) : null;
    if (!String(rec && rec.name || "").trim()) return { error: "name_required", message: "Give the item a name." };
    const it = Object.assign(C.newItem(), existing || {}, rec);
    it.name = String(it.name).trim();
    it.cost = num(it.cost);
    it.price = num(it.price);
    it.reorderPoint = num(it.reorderPoint);
    it.reorderQty = num(it.reorderQty);
    it.providerId = pid;
    if (!it.sku) {
      const prefix = it.type === "product" ? "PRD" : it.type === "labor" ? "LAB" : it.type === "subscription" ? "SUB" : "SVC";
      it.sku = await C.newNumber(pid, prefix);
    }
    const clash = (await providerRecords(pid, "catalogItem")).find((x) => String(x.id) !== String(it.id) && String(x.sku || "").toLowerCase() === String(it.sku).toLowerCase());
    if (clash) return { error: "sku_taken", message: "SKU " + it.sku + " is already used by " + clash.name + "." };
    if (!existing) {
      it.id = it.id != null && it.id !== "" ? it.id : ten().nextId(await providerRecords(pid));
      it.createdAt = nowIso();
      it.createdBy = it.createdBy != null ? it.createdBy : (actor().memberId || null);
    }
    it.updatedAt = nowIso();
    await ten().upsert("provider", pid, it);
    await emit(pid, existing ? "catalog.item_updated" : "catalog.item_created", { item: it });
    return { record: it, created: !existing };
  };

  /* Deleting an item is refused while stock is on hand or an open PO
     references it — deactivating is the safe alternative. */
  C.removeItem = async function (pid, id) {
    if (!ERP.security.enforce("catalog.edit")) return { error: "forbidden" };
    const it = await C.item(pid, id);
    if (!it) return { error: "not_found" };
    if (ERP.inventory) {
      try { const oh = await ERP.inventory.onHand(pid, id); if (num(oh) !== 0) return { error: "in_use", message: "Stock is on hand for this item; the item is kept for history." }; } catch (e) {}
    }
    const open = (await providerRecords(pid, "purchaseOrder")).filter((p) => ["draft", "pending_approval", "approved", "ordered", "partially_received"].indexOf(p.status) !== -1);
    if (open.some((p) => (p.lines || []).some((l) => String(l.itemId) === String(id)))) return { error: "in_use", message: "An open purchase order uses this item." };
    await ten().remove("provider", pid, (r) => r.kind === "catalogItem" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── pricing rules ─────────────────────────── */

  C.rules = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "priceRule");
    if (query.active === "active") list = list.filter((r) => r.active !== false);
    return list.slice().sort((a, b) => (SCOPE_RANK[b.scope] || 0) - (SCOPE_RANK[a.scope] || 0) || num(b.priority) - num(a.priority) || num(a.id) - num(b.id));
  };
  C.rule = async function (pid, id) {
    const list = await providerRecords(pid, "priceRule");
    return list.find((r) => String(r.id) === String(id)) || null;
  };
  C.saveRule = async function (pid, rec) {
    if (!ERP.security.enforce("catalog.edit")) return { error: "forbidden" };
    const existing = rec && rec.id != null && rec.id !== "" ? await C.rule(pid, rec.id) : null;
    if (!String(rec && rec.name || "").trim()) return { error: "name_required", message: "Give the rule a name." };
    const r = Object.assign(C.newRule(), existing || {}, rec);
    r.name = String(r.name).trim();
    r.value = num(r.value);
    r.priority = num(r.priority, 100);
    r.providerId = pid;
    if (r.scope === "item" && !r.itemId) return { error: "target_required", message: "Choose the item this rule prices." };
    if (r.scope === "category" && !r.categoryId) return { error: "target_required", message: "Choose the category this rule prices." };
    if (r.scope === "class" && !r.classId) return { error: "target_required", message: "Choose the class this rule prices." };
    if (r.scope === "vendor" && !r.vendorId) return { error: "target_required", message: "Choose the vendor this rule prices." };
    if (!existing) {
      r.id = r.id != null && r.id !== "" ? r.id : ten().nextId(await providerRecords(pid));
      r.createdAt = nowIso();
    }
    r.updatedAt = nowIso();
    await ten().upsert("provider", pid, r);
    return { record: r, created: !existing };
  };
  C.removeRule = async function (pid, id) {
    if (!ERP.security.enforce("catalog.edit")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "priceRule" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── per-client price overrides ─────────────────────────── */

  C.priceOverrides = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "priceOverride");
    if (query.itemId) list = list.filter((r) => String(r.itemId) === String(query.itemId));
    if (query.companyId) list = list.filter((r) => String(r.companyId) === String(query.companyId));
    return list.slice().sort((a, b) => num(b.id) - num(a.id));
  };
  C.priceOverride = async function (pid, id) {
    const list = await providerRecords(pid, "priceOverride");
    return list.find((r) => String(r.id) === String(id)) || null;
  };
  C.savePriceOverride = async function (pid, rec) {
    if (!ERP.security.enforce("catalog.edit")) return { error: "forbidden" };
    const existing = rec && rec.id != null && rec.id !== "" ? await C.priceOverride(pid, rec.id) : null;
    if (!rec || !rec.itemId) return { error: "item_required", message: "Choose the item to override." };
    if (!rec.companyId) return { error: "company_required", message: "Choose the client this price applies to." };
    const r = Object.assign(C.newPriceOverride(), existing || {}, rec);
    r.providerId = pid;
    if ((r.price == null || r.price === "") && !num(r.discountPct)) return { error: "price_required", message: "Set an override price or a discount." };
    if (!existing) {
      r.id = r.id != null && r.id !== "" ? r.id : ten().nextId(await providerRecords(pid));
      r.createdAt = nowIso();
    }
    r.updatedAt = nowIso();
    await ten().upsert("provider", pid, r);
    return { record: r, created: !existing };
  };
  C.removePriceOverride = async function (pid, id) {
    if (!ERP.security.enforce("catalog.edit")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "priceOverride" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* ─────────────────────────── price resolution ─────────────────────────── */

  function activeOn(rec, date) {
    const d = date || ui.today();
    if (rec && rec.effectiveFrom && String(rec.effectiveFrom) > d) return false;
    if (rec && rec.effectiveTo && String(rec.effectiveTo) < d) return false;
    return true;
  }
  C.activeOn = activeOn;

  function scopeMatches(rule, item, ctx) {
    if (rule.scope === "global") return true;
    if (!item) return false;
    if (rule.scope === "item") return String(item.id) === String(rule.itemId);
    if (rule.scope === "category") return !!rule.categoryId && String(item.categoryId) === String(rule.categoryId);
    if (rule.scope === "class") return !!rule.classId && String(item.classId) === String(rule.classId);
    if (rule.scope === "vendor") return !!rule.vendorId && String(item.vendorId) === String(rule.vendorId);
    return false;
  }

  C.roundTo = function (mode, value) {
    const v = num(value);
    if (mode === "cent") return round2(v);
    if (mode === "nickel") return Math.round(v * 20) / 20;
    if (mode === "dime") return Math.round(v * 10) / 10;
    if (mode === "half") return Math.round(v * 2) / 2;
    if (mode === "whole") return Math.round(v);
    return round2(v);
  };

  C.applyRule = function (rule, cost, listPrice) {
    const mode = rule.mode || "markup";
    const v = num(rule.value);
    let price;
    if (mode === "markup") price = num(cost) * (1 + v / 100);
    else if (mode === "margin") price = v >= 100 ? num(listPrice) : num(cost) / (1 - v / 100);
    else if (mode === "percent") price = num(listPrice) * (1 + v / 100);
    else if (mode === "fixed") price = v;
    else price = num(listPrice);
    return C.roundTo(rule.rounding, price);
  };

  /* Resolve a unit price for an item and (optionally) a client on a date.
     Returns the price plus the full chain of rules considered and which one
     applied, so the caller can explain the number. */
  C.resolvePrice = async function (pid, ctx) {
    ctx = ctx || {};
    const item = ctx.itemId != null && ctx.itemId !== "" ? await C.item(pid, ctx.itemId) : null;
    const cost = item ? num(item.cost) : num(ctx.cost);
    const listPrice = item ? num(item.price) : num(ctx.price);
    const date = ctx.date || ui.today();
    const chain = [];

    const rules = (await providerRecords(pid, "priceRule")).filter((r) => r.active !== false && activeOn(r, date) && scopeMatches(r, item, ctx));
    rules.sort((a, b) => (SCOPE_RANK[b.scope] || 0) - (SCOPE_RANK[a.scope] || 0) || num(b.priority) - num(a.priority) || num(a.id) - num(b.id));

    let price = listPrice;
    let applied = null;
    chain.push({ scope: "list", name: item ? "Item list price" : "Provided price", applied: true, price: round2(listPrice) });
    if (rules.length) {
      applied = rules[0];
      price = C.applyRule(applied, cost, listPrice);
      chain[chain.length - 1].applied = false;
      chain.push({ scope: applied.scope, name: applied.name, applied: true, price: round2(price), ruleId: applied.id });
      rules.slice(1).forEach((r) => chain.push({ scope: r.scope, name: r.name, applied: false, price: round2(C.applyRule(r, cost, listPrice)), ruleId: r.id }));
    }

    let override = null;
    if (item && ctx.companyId) {
      const ovs = (await providerRecords(pid, "priceOverride")).filter((r) => String(r.itemId) === String(item.id) && String(r.companyId) === String(ctx.companyId) && activeOn(r, date));
      override = ovs[0] || null;
    }
    if (override) {
      let ovPrice = price;
      let how = "";
      if (override.price != null && override.price !== "") { ovPrice = num(override.price); how = "fixed client price"; }
      else if (num(override.discountPct)) { ovPrice = price * (1 - num(override.discountPct) / 100); how = num(override.discountPct) + "% client discount"; }
      price = round2(ovPrice);
      chain.push({ scope: "client", name: (how || "Client override"), applied: true, price: price, overrideId: override.id });
    }

    const m = C.margin(cost, price);
    return {
      itemId: item ? item.id : (ctx.itemId != null ? ctx.itemId : null),
      item: item, cost: cost, basePrice: round2(listPrice), price: round2(price),
      source: override ? "client override" : applied ? applied.name : (item ? "list price" : "provided"),
      appliedRuleId: applied ? applied.id : null, overrideId: override ? override.id : null,
      chain: chain, marginPct: m.marginPct, markupPct: m.markupPct, currency: ctx.currency || (item && item.currency) || "",
    };
  };

  C.priceFor = async function (pid, itemId, ctx) {
    const r = await C.resolvePrice(pid, Object.assign({}, ctx || {}, { itemId: itemId }));
    return r.price;
  };

  /* ─────────────────────────── margin & markup rules (Task 45) ─────────────────────────── */

  C.margin = function (cost, sell) {
    cost = num(cost); sell = num(sell);
    const margin = sell - cost;
    const marginPct = sell ? Math.round((margin / sell) * 1000) / 10 : 0;
    const markupPct = cost ? Math.round((margin / cost) * 1000) / 10 : 0;
    return { cost: cost, sell: sell, margin: round2(margin), marginPct: marginPct, markupPct: markupPct };
  };

  /* A line's realised margin: revenue per unit after discount vs cost. */
  C.lineMargin = function (line) {
    const cost = num(line && line.unitCost);
    const sell = num(line && line.unitPrice) * (1 - num(line && line.discountPct) / 100);
    return C.margin(cost, round2(sell));
  };

  C.marginCheck = async function (pid, rec) {
    const s = await C.settings(pid);
    const m = C.margin(rec && rec.cost, rec && rec.sell);
    return {
      cost: m.cost, sell: m.sell, margin: m.margin, marginPct: m.marginPct, markupPct: m.markupPct,
      quoteFloor: num(s.quoteMarginFloorPct), markupFloor: num(s.poMarkupFloorPct),
      quoteOk: !s.enforceQuotes || m.marginPct >= num(s.quoteMarginFloorPct),
      markupOk: !s.enforcePos || m.markupPct >= num(s.poMarkupFloorPct),
      allowOverride: s.allowOverride !== false,
    };
  };

  /* Check a whole quote against the margin floor. Returns violations per
     line so the caller can decide between blocking and an override. */
  C.checkQuoteFloors = async function (pid, quote) {
    const s = await C.settings(pid);
    const floor = num(s.quoteMarginFloorPct);
    const out = { ok: true, enforced: !!s.enforceQuotes, floorPct: floor, violations: [] };
    if (!s.enforceQuotes) return out;
    for (const line of (quote && quote.lines) || []) {
      const m = C.lineMargin(line);
      if (m.marginPct < floor) out.violations.push({ lineId: line.id, description: line.description || "(line)", marginPct: m.marginPct, cost: m.cost, sell: m.sell });
    }
    out.ok = out.violations.length === 0;
    return out;
  };

  /* Check a purchase order's resale lines against the markup floor. */
  C.checkPoFloors = async function (pid, po) {
    const s = await C.settings(pid);
    const floor = num(s.poMarkupFloorPct);
    const out = { ok: true, enforced: !!s.enforcePos, floorPct: floor, violations: [] };
    if (!s.enforcePos) return out;
    for (const line of (po && po.lines) || []) {
      const cost = num(line.unitCost);
      const sell = num(line.unitPrice);
      if (!sell) continue;
      const m = C.margin(cost, sell);
      if (m.markupPct < floor) out.violations.push({ lineId: line.id, description: line.description || "(line)", markupPct: m.markupPct, cost: m.cost, sell: m.sell });
    }
    out.ok = out.violations.length === 0;
    return out;
  };

  /* Record an explicit, auditable pass over a floor. */
  C.recordMarginOverride = async function (pid, o) {
    o = o || {};
    const rec = {
      kind: "marginOverride", id: ten().nextId(await providerRecords(pid)), providerId: pid,
      refType: o.refType || "quote", refId: o.refId != null ? o.refId : null,
      refNumber: o.refNumber || "", companyId: o.companyId != null ? o.companyId : null,
      lineId: o.lineId != null ? o.lineId : null, description: o.description || "",
      type: o.type || "margin", floorPct: num(o.floorPct), actualPct: num(o.actualPct),
      cost: num(o.cost), sell: num(o.sell), reason: o.reason || "",
      by: actorName(), at: nowIso(),
    };
    await ten().upsert("provider", pid, rec);
    await emit(pid, "margin.overridden", { override: rec });
    return { record: rec };
  };

  C.marginOverrides = async function (pid, query) {
    query = query || {};
    let list = await providerRecords(pid, "marginOverride");
    if (query.refType) list = list.filter((r) => String(r.refType) === String(query.refType));
    if (query.refId) list = list.filter((r) => String(r.refId) === String(query.refId));
    return list.slice().sort((a, b) => num(b.id) - num(a.id));
  };

  /* Raise an override for each violation against a named record. */
  C.overrideRecord = async function (pid, o) {
    if (!ERP.security.enforce("catalog.margins", { companyId: o && o.companyId })) return { error: "forbidden" };
    const reason = String((o && o.reason) || "").trim();
    if (!reason) return { error: "reason_required", message: "A reason is required to override a margin floor." };
    const recs = [];
    for (const v of (o.violations || [])) {
      const r = await C.recordMarginOverride(pid, {
        refType: o.refType, refId: o.refId, refNumber: o.refNumber, companyId: o.companyId,
        lineId: v.lineId, description: v.description, type: o.type || "margin",
        floorPct: o.floorPct, actualPct: o.type === "markup" ? v.markupPct : v.marginPct,
        cost: v.cost, sell: v.sell, reason: reason,
      });
      recs.push(r.record);
    }
    return { records: recs };
  };

  /* ─────────────────────────── seeding ─────────────────────────── */

  C.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    let seeded = { items: 0, rules: 0, settings: false };
    if (!(await providerRecords(pid, "catalogSettings")).length) {
      await ten().upsert("provider", pid, Object.assign({ kind: "catalogSettings", id: "settings", providerId: pid }, C.DEFAULT_SETTINGS));
      seeded.settings = true;
    }
    if (!(await providerRecords(pid, "catalogItem")).length) {
      let id = (await providerRecords(pid)).reduce((m, r) => Math.max(m, num(r.id)), 0);
      for (const d of C.DEFAULT_ITEMS) {
        await ten().upsert("provider", pid, Object.assign(C.newItem(d), { id: ++id, providerId: pid, createdAt: nowIso(), updatedAt: nowIso() }));
        seeded.items += 1;
      }
    }
    if (!(await providerRecords(pid, "priceRule")).length) {
      let id = (await providerRecords(pid)).reduce((m, r) => Math.max(m, num(r.id)), 0);
      for (const d of C.DEFAULT_RULES) {
        await ten().upsert("provider", pid, Object.assign(C.newRule(d), { id: ++id, providerId: pid, createdAt: nowIso(), updatedAt: nowIso() }));
        seeded.rules += 1;
      }
    }
    return seeded;
  };

  /* ═══════════════════════════ station ═══════════════════════════
     Four tabs: the catalog itself; pricing rules; per-client price
     overrides; and the margin / markup floors with the override log. */

  function blankState() {
    return { tab: "catalog", q: "", classId: "", categoryId: "", type: "", active: "active", ruleId: "", itemId: "" };
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
    ERP.states.loading(panel, "Loading catalog");
    try {
      const pid = await ten().providerId();
      if (id === "catalog") await renderItems(panel, pid);
      else if (id === "rules") await renderRules(panel, pid);
      else if (id === "overrides") await renderOverrides(panel, pid);
      else if (id === "margins") await renderMargins(panel, pid);
    } catch (e) {
      console.error("catalog tab failed", id, e);
      ERP.states.error(panel, { title: "This tab hit a problem", message: (e && e.message) || "Unexpected error." });
    }
  }
  const st = (panel) => panel.__host.__catalog;

  C.render = async function (ctx) {
    const host = ctx.el;
    const pid = await ten().providerId();
    if (pid == null) {
      ERP.states.empty(host, {
        icon: "inventory", title: "Product & service catalog", phase: "Phase 9 · Products & inventory",
        message: "Create a service provider first — then build the catalog it quotes from.",
      });
      return;
    }
    await C.ensure(pid);
    host.__catalog = host.__catalog || blankState();
    currentHost = host;
    const defs = [
      { id: "catalog", label: "Catalog" },
      { id: "rules", label: "Pricing rules" },
      { id: "overrides", label: "Client overrides" },
      { id: "margins", label: "Margin rules" },
    ];
    const active = defs.find((d) => d.id === host.__catalog.tab) ? host.__catalog.tab : "catalog";
    host.innerHTML = ui.pageHead("Products & services", "The catalog, its pricing rules and the margin floors quotes must respect.", "") + ui.tabs(defs, active).html;
    host.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", async () => {
      ui.showTab(host, b.getAttribute("data-tab"));
      host.__catalog.tab = b.getAttribute("data-tab");
      await renderTab(host.__catalog.tab);
    }));
    await renderTab(active);
  };

  /* ── catalog items tab ── */

  async function renderItems(panel, pid) {
    const state = st(panel);
    const [items, classes, cats] = await Promise.all([C.items(pid, state), C.classOptions(pid), C.categoryOptions(pid)]);
    const canEdit = ERP.security.can("catalog.edit");
    const classMap = {}; classes.forEach((c) => { classMap[c.value] = c.label; });
    const catMap = {}; cats.forEach((c) => { catMap[c.value] = c.label; });
    const rows = [];
    for (const it of items) {
      let onHand = null;
      if (it.trackInventory && ERP.inventory) { try { onHand = await ERP.inventory.onHand(pid, it.id); } catch (e) { onHand = null; } }
      const m = C.margin(it.cost, it.price);
      rows.push({
        sku: ui.esc(it.sku || ""),
        name: ui.esc(it.name) + (it.active === false ? " " + ui.badge("inactive", "muted") : ""),
        type: ui.badge(C.itemTypeLabel(it.type), C.itemTypeTone(it.type)),
        group: ui.esc(classMap[it.classId] || it.classId || "—") + (it.categoryId ? ' <span class="erp-sub">' + ui.esc(catMap[it.categoryId] || it.categoryId) + "</span>" : ""),
        unit: ui.esc(it.unit || "—"),
        cost: maskedMoney(it.cost),
        price: maskedMoney(it.price),
        margin: ERP.security.canSeeFinancials() ? m.marginPct + "%" : "•••",
        stock: onHand == null ? "—" : String(onHand) + (num(it.reorderPoint) && onHand <= num(it.reorderPoint) ? " " + ui.badge("low", "warn") : ""),
        actions: ui.btn("Edit", { small: true, act: "ci-edit", arg: it.id }) + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "ci-del", arg: it.id }) : ""),
      });
    }
    const typeCount = (t) => items.filter((i) => i.type === t).length;
    panel.innerHTML =
      ui.summary([
        { label: "Items", value: String(items.length) },
        { label: "Products", value: String(typeCount("product")) },
        { label: "Services & labour", value: String(typeCount("service") + typeCount("labor")) },
        { label: "Subscriptions", value: String(typeCount("subscription")) },
      ]) +
      '<div class="erp-db-toolbar">' +
        '<input class="erp-input" data-cf="q" placeholder="Search name or SKU…" value="' + ui.esc(state.q) + '">' +
        ui.select("cf-class", "Class", [{ value: "", label: "All classes" }].concat(classes), state.classId) +
        ui.select("cf-cat", "Category", [{ value: "", label: "All categories" }].concat(cats), state.categoryId) +
        ui.select("cf-type", "Type", [{ value: "", label: "All types" }].concat(C.ITEM_TYPES.map((t) => ({ value: t.id, label: t.label }))), state.type) +
        ui.select("cf-active", "Show", [{ value: "active", label: "Active" }, { value: "", label: "All" }, { value: "inactive", label: "Inactive" }], state.active) +
        (canEdit ? ui.btn("New item", { small: true, primary: true, act: "ci-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "type", label: "Type" },
        { key: "group", label: "Class / category" }, { key: "unit", label: "Unit" },
        { key: "cost", label: "Cost", align: "right" }, { key: "price", label: "Sell", align: "right" },
        { key: "margin", label: "Margin", align: "right" }, { key: "stock", label: "On hand", align: "right" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No catalog items match." });

    const qEl = panel.querySelector('[data-cf="q"]');
    if (qEl) qEl.addEventListener("change", () => { state.q = qEl.value; renderTab("catalog"); });
    const bindSel = (sel, key) => { const el = panel.querySelector(sel); if (el) el.addEventListener("change", () => { state[key] = el.value; renderTab("catalog"); }); };
    bindSel('[name="cf-class"]', "classId"); bindSel('[name="cf-cat"]', "categoryId"); bindSel('[name="cf-type"]', "type"); bindSel('[name="cf-active"]', "active");
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "ci-new") return openItemModal(pid, null, () => renderTab("catalog"));
      if (act === "ci-edit") { const it = await C.item(pid, arg); if (it) return openItemModal(pid, it, () => renderTab("catalog")); }
      if (act === "ci-del") {
        const it = await C.item(pid, arg); if (!it) return;
        ui.confirm({ title: "Delete item", message: "Delete " + it.name + "?", onConfirm: async () => {
          const r = await C.removeItem(pid, it.id);
          if (r.error) return ERP.toast(r.message || r.error, "error");
          ERP.toast("Item deleted.", "success"); renderTab("catalog");
        } });
      }
    });
  }

  /* ── pricing rules tab ── */

  async function renderRules(panel, pid) {
    const state = st(panel);
    const [rules, classes, cats, vendors, items] = await Promise.all([C.rules(pid, {}), C.classOptions(pid), C.categoryOptions(pid), C.vendorOptions(pid, "— none —"), C.options(pid)]);
    const canEdit = ERP.security.can("catalog.edit");
    const classMap = {}; classes.forEach((c) => { classMap[c.value] = c.label; });
    const catMap = {}; cats.forEach((c) => { catMap[c.value] = c.label; });
    const itemMap = {}; items.forEach((i) => { itemMap[i.value] = i.label; });
    const vendorMap = {}; vendors.forEach((v) => { vendorMap[v.value] = v.label; });
    const target = (r) => (r.scope === "item" ? itemMap[r.itemId] : r.scope === "category" ? catMap[r.categoryId] : r.scope === "class" ? classMap[r.classId] : r.scope === "vendor" ? vendorMap[r.vendorId] : "Every item") || "—";
    const rows = rules.map((r) => ({
      name: ui.esc(r.name),
      scope: ui.badge(C.scopeLabel(r.scope), r.scope === "global" ? "muted" : "info"),
      target: ui.esc(target(r)),
      mode: ui.esc(C.modeLabel(r.mode)),
      value: ui.esc(r.mode === "fixed" ? maskedMoney(r.value) : r.value + "%"),
      rounding: ui.esc(C.roundingLabel(r.rounding)),
      priority: ui.esc(r.priority),
      window: ui.esc((r.effectiveFrom || r.effectiveTo) ? (r.effectiveFrom || "…") + " → " + (r.effectiveTo || "…") : "always"),
      active: r.active === false ? ui.badge("off", "muted") : ui.badge("on", "success"),
      actions: ui.btn("Edit", { small: true, act: "cr-edit", arg: r.id }) + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "cr-del", arg: r.id }) : ""),
    }));
    panel.innerHTML =
      ui.alert("Rules are matched most-specific first (item → category → class → vendor → provider), then by priority. A client override always wins. The first matching rule derives the sell price from cost or list.", "info") +
      '<div class="erp-db-toolbar">' + (canEdit ? ui.btn("New rule", { small: true, primary: true, act: "cr-new" }) : "") + "</div>" +
      ui.table([
        { key: "name", label: "Rule" }, { key: "scope", label: "Scope" }, { key: "target", label: "Applies to" },
        { key: "mode", label: "Mode" }, { key: "value", label: "Value", align: "right" }, { key: "rounding", label: "Rounding" },
        { key: "priority", label: "Priority", align: "right" }, { key: "window", label: "Effective" }, { key: "active", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No pricing rules yet." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "cr-new") return openRuleModal(pid, null, () => renderTab("rules"));
      if (act === "cr-edit") { const r = await C.rule(pid, arg); if (r) return openRuleModal(pid, r, () => renderTab("rules")); }
      if (act === "cr-del") { ui.confirm({ title: "Delete rule", message: "Delete this pricing rule?", onConfirm: async () => { await C.removeRule(pid, arg); ERP.toast("Rule deleted.", "success"); renderTab("rules"); } }); }
    });
  }

  /* ── client overrides tab ── */

  async function renderOverrides(panel, pid) {
    const [ovs, clients, items] = await Promise.all([C.priceOverrides(pid, {}), clientOptions(), C.options(pid)]);
    const canEdit = ERP.security.can("catalog.edit");
    const itemMap = {}; items.forEach((i) => { itemMap[i.value] = i.label; });
    const clientMap = {}; clients.forEach((c) => { clientMap[c.value] = c.label; });
    const rows = ovs.map((o) => ({
      item: ui.esc(itemMap[o.itemId] || "#" + o.itemId),
      client: ui.esc(clientMap[o.companyId] || "#" + o.companyId),
      price: o.price != null && o.price !== "" ? maskedMoney(o.price) : ' <span class="erp-sub">' + num(o.discountPct) + "% off</span>",
      window: ui.esc((o.effectiveFrom || o.effectiveTo) ? (o.effectiveFrom || "…") + " → " + (o.effectiveTo || "…") : "always"),
      notes: ui.esc(o.notes || ""),
      actions: ui.btn("Edit", { small: true, act: "co-edit", arg: o.id }) + (canEdit ? " " + ui.btn("Delete", { small: true, danger: true, act: "co-del", arg: o.id }) : ""),
    }));
    panel.innerHTML =
      ui.alert("A client override sets a negotiated price (or discount) for one client and item. It beats every pricing rule and applies wherever the item is quoted.", "info") +
      '<div class="erp-db-toolbar">' + (canEdit ? ui.btn("New override", { small: true, primary: true, act: "co-new" }) : "") + "</div>" +
      ui.table([
        { key: "item", label: "Item" }, { key: "client", label: "Client" }, { key: "price", label: "Price", align: "right" },
        { key: "window", label: "Effective" }, { key: "notes", label: "Notes" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No client price overrides." });
    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "co-new") return openOverrideModal(pid, null, () => renderTab("overrides"));
      if (act === "co-edit") { const o = await C.priceOverride(pid, arg); if (o) return openOverrideModal(pid, o, () => renderTab("overrides")); }
      if (act === "co-del") { ui.confirm({ title: "Delete override", message: "Delete this price override?", onConfirm: async () => { await C.removePriceOverride(pid, arg); ERP.toast("Override deleted.", "success"); renderTab("overrides"); } }); }
    });
  }

  /* ── margin rules tab ── */

  async function renderMargins(panel, pid) {
    const [settings, log] = await Promise.all([C.settings(pid), C.marginOverrides(pid, {})]);
    const canEdit = ERP.security.can("catalog.margins");
    const form =
      ui.form(
        '<div class="erp-form-row">' +
          ui.number("quoteMarginFloorPct", "Quote margin floor %", settings.quoteMarginFloorPct, { step: 0.5, min: 0 }) +
          ui.number("poMarkupFloorPct", "PO markup floor %", settings.poMarkupFloorPct, { step: 0.5, min: 0 }) +
        "</div>" +
        '<div class="erp-form-row">' +
          ui.number("poApprovalThreshold", "PO approval threshold", settings.poApprovalThreshold, { step: 50, min: 0 }) +
          ui.select("currency", "Display currency", [{ value: "", label: "Provider default" }].concat(Object.keys(ui.CURRENCIES).map((c) => ({ value: c, label: c }))), settings.currency) +
        "</div>" +
        ui.check("enforceQuotes", "Block sending a quote below the margin floor", settings.enforceQuotes !== false) +
        ui.check("enforcePos", "Block approving a PO below the markup floor", settings.enforcePos !== false) +
        ui.check("allowOverride", "Allow an owner to override a floor with a recorded reason", settings.allowOverride !== false),
        canEdit ? ui.btn("Save rules", { small: true, primary: true, act: "cm-save" }) : ui.alert("Only an owner may change margin rules.", "warn")
      );
    const rows = log.map((o) => ({
      ref: ui.esc((o.refType === "po" ? "PO " : "Quote ") + (o.refNumber || "#" + o.refId)),
      line: ui.esc(o.description || "—"),
      type: ui.badge(o.type === "markup" ? "Markup" : "Margin", o.type === "markup" ? "warn" : "info"),
      actual: maskedMoney(0) === "•••" ? "•••" : num(o.actualPct) + "%",
      floor: num(o.floorPct) + "%",
      reason: ui.esc(o.reason || ""),
      by: ui.esc(o.by || ""),
      at: ui.esc(ui.date(o.at)),
    }));
    panel.innerHTML =
      ui.grid([
        ui.card("Margin & approval rules", form),
        ui.card("How floors work", ui.alert("Quotes are checked line by line when they are sent: a line whose margin falls below the floor is blocked unless an owner records an override. Purchase orders are checked the same way against the markup floor, and a PO at or above the approval threshold needs an approver before it can be ordered.", "info")),
      ]) +
      ui.card("Recorded overrides", ui.table([
        { key: "ref", label: "Record" }, { key: "line", label: "Line" }, { key: "type", label: "Floor" },
        { key: "actual", label: "Actual", align: "right" }, { key: "floor", label: "Floor", align: "right" },
        { key: "reason", label: "Reason" }, { key: "by", label: "By" }, { key: "at", label: "When" },
      ], rows, { emptyText: "No floor has been overridden." }));

    const saveBtn = panel.querySelector("[data-act=cm-save]");
    if (saveBtn) saveBtn.onclick = async (btn) => {
      const formEl = panel.querySelector("[data-ui-form]");
      const v = ui.collect(formEl, ["quoteMarginFloorPct", "poMarkupFloorPct", "poApprovalThreshold", "currency", "enforceQuotes", "enforcePos", "allowOverride"]);
      btn.disabled = true;
      const r = await C.saveSettings(pid, v);
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ERP.toast("Margin rules saved.", "success"); renderTab("margins");
    };
  }

  /* ── item modal ── */

  async function openItemModal(pid, item, refresh) {
    if (!ERP.security.enforce("catalog.edit")) return;
    const [classes, cats, vendors] = await Promise.all([C.classOptions(pid), C.categoryOptions(pid), C.vendorOptions(pid, "— none —")]);
    const it = item ? clone(item) : C.newItem();
    const head =
      '<div class="erp-form-row">' +
        ui.text("name", "Name", it.name, "e.g. Managed workstation") +
        ui.text("sku", "SKU", it.sku, "auto if blank") +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("type", "Type", C.ITEM_TYPES.map((t) => ({ value: t.id, label: t.label })), it.type) +
        ui.select("unit", "Unit", C.UNITS.map((u) => ({ value: u, label: u })), it.unit) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("classId", "Class", [{ value: "", label: "— none —" }].concat(classes), it.classId) +
        ui.select("categoryId", "Category", [{ value: "", label: "— none —" }].concat(cats), it.categoryId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("cost", "Unit cost", it.cost, { min: 0, step: 0.01 }) +
        ui.number("price", "Sell price", it.price, { min: 0, step: 0.01 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("vendorId", "Preferred vendor", vendors, it.vendorId) +
        ui.text("vendorSku", "Vendor SKU", it.vendorSku) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.text("taxCode", "Tax code", it.taxCode, "e.g. TAX") +
        ui.text("description", "Short description", it.description) +
      "</div>" +
      ui.check("trackInventory", "Track inventory for this item", !!it.trackInventory) +
      '<div class="erp-form-row">' +
        ui.number("reorderPoint", "Reorder point", it.reorderPoint, { min: 0, step: 1 }) +
        ui.number("reorderQty", "Reorder quantity", it.reorderQty, { min: 0, step: 1 }) +
      "</div>" +
      ui.check("active", "Active (available to quote)", it.active !== false) +
      ui.textarea("notes", "Notes", it.notes, 2);
    const modal = ui.modal({
      title: item ? "Edit item" : "New catalog item", size: "lg", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "cim-cancel" }) + " " + ui.btn(item ? "Save" : "Create", { small: true, primary: true, act: "cim-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=cim-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=cim-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "sku", "type", "unit", "classId", "categoryId", "cost", "price", "vendorId", "vendorSku", "taxCode", "description", "trackInventory", "reorderPoint", "reorderQty", "active", "notes"]);
      if (!v.name) return ERP.toast("Give the item a name.", "error");
      btn.disabled = true;
      const r = await C.saveItem(pid, Object.assign({}, it, v, { id: it.id }));
      if (r.error) { ERP.toast(r.message || r.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(item ? "Item saved." : "Item created.", "success"); refresh();
    };
  }

  /* ── rule modal ── */

  async function openRuleModal(pid, rule, refresh) {
    if (!ERP.security.enforce("catalog.edit")) return;
    const [items, classes, cats, vendors] = await Promise.all([C.options(pid), C.classOptions(pid), C.categoryOptions(pid), C.vendorOptions(pid, "— none —")]);
    const r = rule ? clone(rule) : C.newRule();
    const head =
      ui.text("name", "Rule name", r.name, "e.g. Standard hardware markup") +
      '<div class="erp-form-row">' +
        ui.select("scope", "Scope", C.SCOPES.map((s) => ({ value: s.id, label: s.label })), r.scope) +
        ui.number("priority", "Priority", r.priority, { step: 10 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("itemId", "Item (item scope)", [{ value: "", label: "— none —" }].concat(items), r.itemId) +
        ui.select("categoryId", "Category", [{ value: "", label: "— none —" }].concat(cats), r.categoryId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("classId", "Class", [{ value: "", label: "— none —" }].concat(classes), r.classId) +
        ui.select("vendorId", "Vendor", vendors, r.vendorId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.select("mode", "Mode", C.PRICE_MODES.map((m) => ({ value: m.id, label: m.label })), r.mode) +
        ui.number("value", "Value", r.value, { step: 0.5 }) +
        ui.select("rounding", "Rounding", C.ROUNDINGS.map((x) => ({ value: x.id, label: x.label })), r.rounding) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("effectiveFrom", "Effective from", r.effectiveFrom) +
        ui.dateInput("effectiveTo", "Effective to", r.effectiveTo) +
      "</div>" +
      ui.check("active", "Active", r.active !== false) +
      ui.textarea("notes", "Notes", r.notes, 2);
    const modal = ui.modal({
      title: rule ? "Edit pricing rule" : "New pricing rule", size: "lg", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "crm-cancel" }) + " " + ui.btn(rule ? "Save" : "Create", { small: true, primary: true, act: "crm-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=crm-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=crm-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["name", "scope", "priority", "itemId", "categoryId", "classId", "vendorId", "mode", "value", "rounding", "effectiveFrom", "effectiveTo", "active", "notes"]);
      if (!v.name) return ERP.toast("Give the rule a name.", "error");
      btn.disabled = true;
      const res = await C.saveRule(pid, Object.assign({}, r, v, { id: r.id }));
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(rule ? "Rule saved." : "Rule created.", "success"); refresh();
    };
  }

  /* ── override modal ── */

  async function openOverrideModal(pid, override, refresh) {
    if (!ERP.security.enforce("catalog.edit")) return;
    const [items, clients] = await Promise.all([C.options(pid), clientOptions()]);
    const o = override ? clone(override) : C.newPriceOverride();
    const head =
      '<div class="erp-form-row">' +
        ui.select("itemId", "Item", [{ value: "", label: "— choose an item —" }].concat(items), o.itemId) +
        ui.select("companyId", "Client", [{ value: "", label: "— choose a client —" }].concat(clients), o.companyId) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.number("price", "Override price", o.price == null ? "" : o.price, { min: 0, step: 0.01 }) +
        ui.number("discountPct", "…or discount %", o.discountPct, { min: 0, step: 0.5 }) +
      "</div>" +
      '<div class="erp-form-row">' +
        ui.dateInput("effectiveFrom", "Effective from", o.effectiveFrom) +
        ui.dateInput("effectiveTo", "Effective to", o.effectiveTo) +
      "</div>" +
      ui.textarea("notes", "Notes", o.notes, 2);
    const modal = ui.modal({
      title: override ? "Edit client override" : "New client override", body: ui.form(head),
      foot: ui.btn("Cancel", { small: true, act: "com-cancel" }) + " " + ui.btn(override ? "Save" : "Create", { small: true, primary: true, act: "com-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=com-cancel]").onclick = () => ui.closeModal();
    modal.querySelector("[data-act=com-save]").onclick = async (btn) => {
      const v = ui.collect(form, ["itemId", "companyId", "price", "discountPct", "effectiveFrom", "effectiveTo", "notes"]);
      if (!v.itemId) return ERP.toast("Choose the item to override.", "error");
      if (!v.companyId) return ERP.toast("Choose the client.", "error");
      btn.disabled = true;
      const res = await C.savePriceOverride(pid, Object.assign({}, o, v, { id: o.id }));
      if (res.error) { ERP.toast(res.message || res.error, "error"); btn.disabled = false; return; }
      ui.closeModal(); ERP.toast(override ? "Override saved." : "Override created.", "success"); refresh();
    };
  }
})();
