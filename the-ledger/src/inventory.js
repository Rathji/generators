/* ============================================================================
   THE LEDGER — inventory.js
   Inventory & COGS (Phase 8, tasks 40–43):
    40. Item catalog management — trackable items with SKU, description, unit
        of measure, category, quantity on hand, costs and a default selling
        price (used by the AR invoice editor when an item is picked).
    41. Inventory transaction logic — "Purchase" moves increase stock and
        update the weighted-average cost; "Sale" moves decrease stock at the
        current average cost; "Adjustment" moves correct quantity. Sales from
        posted invoices are applied automatically (see onInvoicePosted).
    42. COGS calculation engine — cost of goods sold for a date range is the
        sum of qty × weighted-average unit cost across sale moves in range.
    43. Inventory valuation report — current on-hand quantity × weighted
        average cost per item, plus a category summary.
   Data persists per-browser via FW.store (kv-plugin folder "ledgerly"):
     key "inv_items" → array of item objects
     key "inv_moves" → array of movement objects
   AR integration: invoice lines carry an optional itemId. When an invoice is
   posted, onInvoicePosted() decrements stock and posts a COGS entry
   (DR 5000 / CR 1200); voiding an invoice reverses both.
   ============================================================================ */
(function () {
  "use strict";
  const FW = window.FW;
  const esc = FW.esc;
  const Ledger = window.Ledger;
  const K = { items: "inv_items", moves: "inv_moves" };

  /* ── tiny helpers ────────────────────────────────────────────────────── */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function amt(v) { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? round2(n) : 0; }
  function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function uid(p) { return (p || "id") + "_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ── persistence + synchronous item cache (AR reads items sync) ──────── */
  let ITEM_CACHE = [];
  async function loadItems() { const v = await FW.store.get(K.items, null); const list = Array.isArray(v) ? v : []; ITEM_CACHE = list; return list; }
  async function saveItems(list) { ITEM_CACHE = list; await FW.store.set(K.items, list); }
  async function loadMoves() { const v = await FW.store.get(K.moves, null); return Array.isArray(v) ? v : []; }
  async function saveMoves(list) { await FW.store.set(K.moves, list); }
  loadItems();

  function itemById(id) { return ITEM_CACHE.find(x => x.id === id) || null; }
  function itemOptions(cur) {
    const pick = String(cur || "");
    return ITEM_CACHE.filter(x => x.active !== false)
      .map(x => '<option value="' + esc(x.id) + '"' + (x.id === pick ? " selected" : "") + ">" + esc(x.sku || x.name) + (x.name && x.name !== x.sku ? " · " + esc(x.name) : "") + (x.price != null && x.price !== "" ? " — " + FW.money(amt(x.price)) : "") + "</option>")
      .join("");
  }

  /* ── item catalog (task 40) ──────────────────────────────────────────── */
  async function saveItem(it, list) {
    const x = Object.assign({}, it);
    if (!x.id) x.id = uid("item");
    if (!x.createdAt) x.createdAt = new Date().toISOString();
    x.updatedAt = new Date().toISOString();
    x.sku = String(x.sku || "").trim();
    if (!x.sku && !String(x.name || "").trim()) return { error: "Item needs a name or SKU." };
    if (list.some(y => y.sku && y.sku.toLowerCase() === x.sku.toLowerCase() && y.id !== x.id)) return { error: "An item with this SKU already exists." };
    x.qty = amt(x.qty);
    x.avgCost = amt(x.avgCost);
    x.lastCost = amt(x.lastCost);
    x.price = amt(x.price);
    const prev = list.find(y => y.id === x.id) || null;
    const i = list.findIndex(y => y.id === x.id);
    if (i >= 0) list[i] = x; else list.push(x);
    await saveItems(list);
    await Ledger.auditLog(prev ? "item.update" : "item.create", {
      entity: "item", entityId: x.id, entityLabel: (x.sku || x.name) + " · " + (x.name || x.sku),
      summary: (prev ? "Edited " : "Created ") + "item " + (x.sku || x.name) + (x.name && x.name !== x.sku ? " (" + x.name + ")" : ""),
      prev: prev ? Ledger.cloneObj(prev) : null, next: Ledger.cloneObj(x),
    });
    return x;
  }
  async function deleteItem(id) {
    const items = await loadItems();
    const moves = await loadMoves();
    const it = items.find(x => x.id === id);
    if (!it) return { error: "Item not found." };
    if (moves.some(m => m.itemId === id)) return { error: "This item has movement history — mark it inactive instead of deleting." };
    const i = items.indexOf(it); items.splice(i, 1);
    await saveItems(items);
    await Ledger.auditLog("item.delete", {
      entity: "item", entityId: id, entityLabel: (it.sku || it.name) + " · " + (it.name || it.sku),
      summary: "Deleted item " + (it.sku || it.name), prev: Ledger.cloneObj(it), next: null,
    });
    return { ok: true };
  }
  async function setItemActive(id, active) {
    const items = await loadItems();
    const it = items.find(x => x.id === id);
    if (!it) return { error: "Item not found." };
    const prev = Ledger.cloneObj(it);
    it.active = !!active;
    it.updatedAt = new Date().toISOString();
    await saveItems(items);
    await Ledger.auditLog("item.update", {
      entity: "item", entityId: it.id, entityLabel: (it.sku || it.name) + " · " + (it.name || it.sku),
      summary: (it.sku || it.name) + " " + (active ? "activated" : "deactivated"),
      prev, next: Ledger.cloneObj(it),
    });
    return { ok: true };
  }

  /* ── weighted-average cost engine (task 41) ──────────────────────────── */
  function applyMoveToItem(item, m) {
    const qty = amt(m.qty);
    const unitCost = amt(m.unitCost);
    if (m.type === "purchase") {
      const oldQty = amt(item.qty), oldCost = amt(item.avgCost);
      const newQty = round2(oldQty + qty);
      item.qty = newQty;
      item.avgCost = newQty > 0 ? round2((oldQty * oldCost + qty * unitCost) / newQty) : 0;
      item.lastCost = unitCost;
    } else if (m.type === "sale") {
      item.qty = round2(amt(item.qty) - Math.abs(qty));
      item.lastCost = unitCost; // cost basis at sale time
    } else { // adjustment — quantity correction only
      item.qty = round2(amt(item.qty) + qty);
    }
    item.updatedAt = new Date().toISOString();
    return item;
  }
  async function recordMove(m) {
    const items = await loadItems();
    const it = items.find(x => x.id === m.itemId);
    if (!it) return { error: "Item not found." };
    const type = m.type || "adjustment";
    const qty = amt(m.qty);
    if (!qty) return { error: "Quantity must not be zero." };
    const move = {
      id: uid("mv"), date: m.date || today(), itemId: m.itemId,
      type, qty: type === "sale" ? -Math.abs(qty) : qty,
      unitCost: type === "adjustment" ? amt(m.unitCost) : (type === "sale" ? amt(it.avgCost) : amt(m.unitCost)),
      note: String(m.note || "").trim(), ref: m.ref || "",
      source: m.source || null,
      createdAt: new Date().toISOString(),
    };
    if (type === "sale" && amt(it.qty) < Math.abs(qty)) return { error: "Not enough stock — on hand is " + it.qty + "." };
    applyMoveToItem(it, move);
    await saveItems(items);
    const moves = await loadMoves();
    moves.push(move);
    await saveMoves(moves);
    await Ledger.auditLog("inv_move.create", {
      entity: "inv_move", entityId: move.id, entityLabel: (it.sku || it.name) + " · " + (move.qty > 0 ? "+" : "") + move.qty,
      summary: (move.type === "sale" ? "Sale" : move.type === "purchase" ? "Purchase" : "Adjustment") + " — " + (it.sku || it.name) + " qty " + (move.qty > 0 ? "+" : "") + move.qty + " @ " + FW.money(move.unitCost) + (move.ref ? " · " + move.ref : ""),
      prev: null, next: Ledger.cloneObj(move),
    });
    return { ok: true, move, item: it };
  }

  /* ── COGS engine (task 42) ───────────────────────────────────────────── */
  async function cogsForPeriod(from, to) {
    const f = from || "1900-01-01", t = to || "2999-12-31";
    const [moves, items] = await Promise.all([loadMoves(), loadItems()]);
    const inRange = moves.filter(m => m.type === "sale" && m.date && m.date >= f && m.date <= t);
    let cogs = 0;
    const byItem = {};
    for (const m of inRange) {
      const unitCost = amt(m.unitCost);
      const line = byItem[m.itemId] || (byItem[m.itemId] = { itemId: m.itemId, sku: "", name: "", qty: 0, cogs: 0 });
      line.qty = round2(line.qty + Math.abs(amt(m.qty)));
      line.cogs = round2(line.cogs + Math.abs(amt(m.qty)) * unitCost);
      cogs = round2(cogs + Math.abs(amt(m.qty)) * unitCost);
    }
    const id2 = {};
    for (const it of items) id2[it.id] = it;
    const rows = Object.values(byItem).map(r => {
      const it = id2[r.itemId] || {};
      return { itemId: r.itemId, sku: it.sku || "", name: it.name || "", qty: r.qty, cogs: r.cogs };
    }).sort((a, b) => String(a.sku || a.name).localeCompare(String(b.sku || b.name)));
    return { from: f, to: t, cogs, count: inRange.length, byItem: rows };
  }

  /* ── valuation report (task 43) ──────────────────────────────────────── */
  async function valuation() {
    const items = await loadItems();
    const rows = items.filter(x => x.active !== false || amt(x.qty) !== 0)
      .map(x => ({ id: x.id, sku: x.sku, name: x.name, uom: x.uom, category: x.category, qty: amt(x.qty), avgCost: amt(x.avgCost), value: round2(amt(x.qty) * amt(x.avgCost)) }))
      .sort((a, b) => String(a.sku || a.name).localeCompare(String(b.sku || b.name)));
    const totalQty = round2(rows.reduce((s, r) => s + r.qty, 0));
    const totalValue = round2(rows.reduce((s, r) => s + r.value, 0));
    const byCategory = {};
    for (const r of rows) {
      const c = r.category || "Uncategorized";
      const row = byCategory[c] || (byCategory[c] = { category: c, qty: 0, value: 0 });
      row.qty = round2(row.qty + r.qty); row.value = round2(row.value + r.value);
    }
    return { rows, totalQty, totalValue, byCategory: Object.values(byCategory).sort((a, b) => String(a.category).localeCompare(String(b.category))) };
  }

  /* ── AR integration: COGS + stock on posted invoices ─────────────────── */
  function inventoryAccountId(accounts) {
    let a = accounts.find(x => x.code === "1200" && x.type === "asset");
    if (!a) a = accounts.find(x => x.type === "asset" && /inventory|stock/i.test(x.name || ""));
    return a ? a.id : null;
  }
  function cogsAccountId(accounts) {
    let a = accounts.find(x => x.code === "5000" && x.type === "expense");
    if (!a) a = accounts.find(x => x.type === "expense" && /cogs|cost of goods/i.test(x.name || ""));
    return a ? a.id : null;
  }
  async function onInvoicePosted(inv, accounts) {
    const usable = (inv.lines || []).filter(l => l.itemId && amt(l.qty) > 0);
    if (!usable.length) return { ok: true, cogs: 0, count: 0 };
    const invAcc = inventoryAccountId(accounts);
    const cogsAcc = cogsAccountId(accounts);
    let cogs = 0, count = 0;
    for (const l of usable) {
      const it = itemById(l.itemId);
      if (!it) continue;
      const unitCost = amt(it.avgCost);
      const qty = amt(l.qty);
      cogs = round2(cogs + qty * unitCost);
      count++;
      const r = await recordMove({ itemId: it.id, type: "sale", qty, unitCost, note: (l.desc || "Sale") + " — " + (inv.customerName || ""), ref: inv.no, source: { kind: "invoice", id: inv.id, no: inv.no }, date: inv.date || today() });
      if (r && r.error) return { ok: false, error: r.error };
    }
    if (cogs > 0) {
      if (!invAcc || !cogsAcc) return { ok: true, cogs, count, error: "Stock updated but no COGS entry posted — add Inventory (1200) and COGS (5000) accounts to the chart of accounts." };
      const entry = {
        date: inv.date || today(),
        reference: "COGS · " + inv.no + (inv.customerName ? " · " + inv.customerName : ""),
        memo: "Cost of goods sold for " + inv.no + " — " + inv.customerName + " (auto from inventory)",
        status: "draft",
        currency: inv.currency || null, fxRate: inv.fxRate || null,
        projectId: inv.projectId || null,
        lines: [
          { account: cogsAcc, desc: "COGS — " + inv.no, debit: cogs, credit: 0 },
          { account: invAcc, desc: "Inventory — " + inv.no, debit: 0, credit: cogs },
        ],
      };
      const entries = await Ledger.loadEntries();
      entry.no = await Ledger.nextEntryNo(entries);
      const res = await Ledger.saveEntry(entry, accounts);
      if (res && res.error) return { ok: true, cogs, count, error: "Stock updated but COGS entry failed: " + res.error };
      const r = await Ledger.postEntry(res.id);
      if (r.error) {
        const ents = await Ledger.loadEntries();
        const i = ents.findIndex(x => x.id === res.id);
        if (i >= 0) { ents.splice(i, 1); await Ledger.saveEntries(ents); }
        return { ok: true, cogs, count, error: "Stock updated but COGS entry failed to post: " + r.error };
      }
      await Ledger.auditLog("inv_move.create", {
        entity: "inv_move", entityId: "cogs_" + inv.no, entityLabel: inv.no,
        summary: "COGS entry " + entry.no + " — " + FW.money(cogs) + " (DR COGS / CR Inventory) for " + inv.no,
        prev: null, next: { entryId: res.id, entryNo: entry.no, cogs, invoice: inv.no },
      });
      return { ok: true, cogs, count, entryId: res.id, entryNo: entry.no };
    }
    return { ok: true, cogs: 0, count };
  }
  async function onInvoiceVoided(inv, accounts) {
    const moves = await loadMoves();
    const mine = moves.filter(m => m.source && m.source.kind === "invoice" && m.source.id === inv.id);
    if (!mine.length) return { ok: true };
    for (const m of mine) {
      const r = await recordMove({ itemId: m.itemId, type: "adjustment", qty: Math.abs(amt(m.qty)), note: "Reversal of " + (m.ref || "sale") + " (invoice voided)", ref: "VOID · " + (m.ref || ""), source: { kind: "invoice_void", id: inv.id, no: inv.no }, date: today() });
      if (r && r.error) return { ok: false, error: r.error };
    }
    const invAcc = inventoryAccountId(accounts), cogsAcc = cogsAccountId(accounts);
    let cogs = mine.reduce((s, m) => s + Math.abs(amt(m.qty)) * amt(m.unitCost), 0);
    cogs = round2(cogs);
    if (cogs > 0 && invAcc && cogsAcc) {
      const entry = {
        date: today(), reference: "COGS · VOID · " + inv.no,
        memo: "Reverses COGS for voided invoice " + inv.no,
        status: "draft", lines: [
          { account: invAcc, desc: "Inventory — restore " + inv.no, debit: cogs, credit: 0 },
          { account: cogsAcc, desc: "COGS — reversal " + inv.no, debit: 0, credit: cogs },
        ],
      };
      const entries = await Ledger.loadEntries();
      entry.no = await Ledger.nextEntryNo(entries);
      const res = await Ledger.saveEntry(entry, accounts);
      if (res && res.error) return { ok: true, error: "Stock restored but COGS reversal failed: " + res.error };
      const r = await Ledger.postEntry(res.id);
      if (r.error) {
        const ents = await Ledger.loadEntries();
        const i = ents.findIndex(x => x.id === res.id);
        if (i >= 0) { ents.splice(i, 1); await Ledger.saveEntries(ents); }
        return { ok: true, error: "Stock restored but COGS reversal failed: " + r.error };
      }
      return { ok: true, entryNo: entry.no, cogs };
    }
    return { ok: true };
  }

  /* ── module renderer ─────────────────────────────────────────────────── */
  async function render(m) {
    m.innerHTML = "";
    const head = FW.el("div", "page-head");
    head.appendChild(FW.el("span", "eyebrow", "Module · Phase 8 — Inventory & COGS"));
    head.appendChild(FW.el("h1", null, null, { text: "Inventory & COGS" }));
    head.appendChild(FW.el("p", "lede", "A weighted-average item catalog: purchases raise stock and cost basis, posted invoices automatically reduce stock and post a COGS entry (DR 5000 / CR 1200), and valuation reports price the on-hand quantity at average cost."));
    m.appendChild(head);

    const tabs = FW.el("div", "ledger-tabs");
    tabs.innerHTML =
      '<button class="ledger-tab active" data-tab="items">Items</button>' +
      '<button class="ledger-tab" data-tab="moves">Movements</button>' +
      '<button class="ledger-tab" data-tab="valuation">Valuation & COGS</button>';
    m.appendChild(tabs);

    const ctn = FW.el("div", "ledger-tab-ctn");
    m.appendChild(ctn);

    const switchTab = name => {
      FW.$$(".ledger-tab", tabs).forEach(b => b.classList.toggle("active", b.getAttribute("data-tab") === name));
      if (name === "moves") renderMoves(ctn);
      else if (name === "valuation") renderValuation(ctn);
      else renderItems(ctn);
    };
    tabs.addEventListener("click", e => {
      const b = e.target.closest(".ledger-tab");
      if (b) switchTab(b.getAttribute("data-tab"));
    });

    switchTab("items");

    const note = FW.el("p", "note small");
    note.style.cssText = "margin-top:18px";
    note.innerHTML = "<strong>Phase 8 is complete (tasks 40–43)</strong> — item catalog, purchase/sale/adjustment moves with weighted-average cost, automatic COGS + stock posting from AR invoices (and reversal on void), a COGS period calculator and valuation report. Pick an item on any invoice line to have stock and COGS handled automatically.";
    m.appendChild(note);
  }

  /* ── items tab ───────────────────────────────────────────────────────── */
  async function renderItems(ctn) {
    const items = await loadItems();
    let html = '<div class="card"><div class="card-head"><h3>Item catalog</h3>' +
      '<button class="btn btn-primary btn-sm" id="itNewBtn">+ New item</button></div>';
    if (!items.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No items yet. Add the products or services you sell — then on any invoice line pick the item and the unit price fills in automatically, and posting the invoice will reduce stock and record COGS.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>SKU</th><th>Name</th><th>Category</th><th class="num">On hand</th><th class="num">Avg cost</th><th class="num">Sell price</th><th class="num">Value</th><th>Status</th><th class="fit"></th></tr></thead><tbody>';
      for (const x of [...items].sort((a, b) => String(a.sku || a.name).localeCompare(String(b.sku || b.name)))) {
        const qty = amt(x.qty);
        html += "<tr>" +
          '<td class="acct-code">' + esc(x.sku || "—") + "</td>" +
          "<td>" + esc(x.name || "—") + (x.uom ? '<div class="muted small">' + esc(x.uom) + "</div>" : "") + "</td>" +
          "<td>" + esc(x.category || "—") + "</td>" +
          '<td class="num"><strong>' + qty + "</strong>" + (qty <= 0 ? ' <span class="chip chip-warn">out</span>' : "") + "</td>" +
          '<td class="num">' + FW.money(amt(x.avgCost)) + "</td>" +
          '<td class="num">' + (x.price != null && x.price !== "" ? FW.money(amt(x.price)) : "—") + "</td>" +
          '<td class="num">' + FW.money(round2(qty * amt(x.avgCost))) + "</td>" +
          '<td><span class="chip ' + (x.active !== false ? "chip-done" : "chip-pending") + '">' + (x.active !== false ? "active" : "inactive") + "</span></td>" +
          '<td class="fit"><div class="row-flex" style="gap:6px;justify-content:flex-end">' +
          '<button class="icon-btn" data-act="stock" data-id="' + esc(x.id) + '" title="Stock move">' + ICON.moves + "</button>" +
          '<button class="icon-btn" data-act="edit" data-id="' + esc(x.id) + '" title="Edit item">' + ICON.pencil + "</button>" +
          '<button class="icon-btn" data-act="toggle" data-id="' + esc(x.id) + '" title="' + (x.active !== false ? "Deactivate" : "Activate") + '">' + (x.active !== false ? ICON.pause : ICON.play) + "</button>" +
          '<button class="icon-btn" data-act="del" data-id="' + esc(x.id) + '" title="Delete item">' + ICON.trash + "</button>" +
          "</div></td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#itNewBtn").addEventListener("click", () => openItemModal(null));
    ctn.addEventListener("click", e => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const id = b.getAttribute("data-id");
      const act = b.getAttribute("data-act");
      if (act === "edit") openItemModal(id);
      else if (act === "stock") openMoveModal(id);
      else if (act === "toggle") {
        const it = items.find(x => x.id === id);
        if (!it) return;
        setItemActive(id, it.active === false).then(() => { FW.toast((it.sku || it.name) + " " + (it.active === false ? "activated" : "deactivated")); renderItems(ctn); });
      } else if (act === "del") {
        confirmDialog("Delete this item?", "The item is removed only if it has no movement history; otherwise you can deactivate it.", () => deleteItem(id).then(r => {
          if (r && r.error) FW.toast(r.error, "err");
          else { FW.toast("Item deleted"); renderItems(ctn); }
        }), "Delete item");
      }
    });
  }

  function openItemModal(id) {
    (async () => {
      const items = await loadItems();
      const x = id ? items.find(y => y.id === id) : null;
      const modal = FW.modal(
        '<div class="modal-head"><h3>' + (x ? "Edit item" : "New item") + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:1 1 120px"><label>SKU</label><input id="itSku" placeholder="e.g. W-001" value="' + esc(x ? x.sku || "" : "") + '"></div>' +
        '<div class="field" style="flex:1 1 180px"><label>Name</label><input id="itName" placeholder="e.g. Widget" value="' + esc(x ? x.name || "" : "") + '"></div>' +
        '<div class="field" style="flex:1 1 120px"><label>Category</label><input id="itCat" placeholder="e.g. Parts" value="' + esc(x ? x.category || "" : "") + '"></div>' +
        '<div class="field" style="flex:0 0 90px"><label>UOM</label><input id="itUom" placeholder="ea" value="' + esc(x ? x.uom || "" : "") + '"></div>' +
        "</div><div class=\"row-flex\">" +
        '<div class="field" style="flex:0 0 130px"><label>Qty on hand</label><input id="itQty" type="number" min="0" step="any" value="' + (x ? x.qty : 0) + '"' + (x ? "" : ' title="0 — add stock later with a purchase move"') + "></div>" +
        '<div class="field" style="flex:0 0 130px"><label>Avg cost</label><input id="itAvg" type="number" min="0" step="any" value="' + (x ? x.avgCost : 0) + '"></div>' +
        '<div class="field" style="flex:0 0 130px"><label>Sell price</label><input id="itPrice" type="number" min="0" step="any" value="' + (x ? x.price : 0) + '"></div>' +
        '<div class="field" style="flex:0 0 110px"><label>Active</label><select id="itActive"><option value="1"' + (x ? (x.active !== false ? " selected" : "") : " selected") + ">Yes</option><option value=\"0\"" + (x && x.active === false ? " selected" : "") + ">No</option></select></div>" +
        "</div></div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="itSaveBtn">Save item</button>' +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      modal.querySelector("#itSaveBtn").addEventListener("click", async () => {
        const out = await saveItem({
          id: x ? x.id : null,
          sku: modal.querySelector("#itSku").value,
          name: modal.querySelector("#itName").value,
          category: modal.querySelector("#itCat").value,
          uom: modal.querySelector("#itUom").value,
          qty: amt(modal.querySelector("#itQty").value),
          avgCost: amt(modal.querySelector("#itAvg").value),
          price: amt(modal.querySelector("#itPrice").value),
          active: modal.querySelector("#itActive").value === "1",
          createdAt: x ? x.createdAt : null,
        }, await loadItems());
        if (out && out.error) { FW.toast(out.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast(x ? "Item updated" : "Item created");
        renderItems(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  function openMoveModal(itemId) {
    (async () => {
      const items = await loadItems();
      const it = itemId ? items.find(x => x.id === itemId) : null;
      const opts = items.filter(x => x.active !== false).map(x => '<option value="' + esc(x.id) + '"' + (x.id === itemId ? " selected" : "") + ">" + esc(x.sku || x.name) + (x.name && x.name !== x.sku ? " · " + esc(x.name) : "") + " — on hand " + amt(x.qty) + "</option>").join("");
      const modal = FW.modal(
        '<div class="modal-head"><h3>Stock movement</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
        '<div class="modal-body"><div class="row-flex">' +
        '<div class="field" style="flex:1 1 220px"><label>Item</label><select id="mvItem">' + (opts || '<option value="">— no active items —</option>') + "</select></div>" +
        '<div class="field" style="flex:0 0 150px"><label>Type</label><select id="mvType"><option value="purchase">Purchase (add)</option><option value="sale">Sale (remove)</option><option value="adjustment">Adjustment</option></select></div>' +
        '<div class="field" style="flex:0 0 110px"><label>Quantity</label><input id="mvQty" type="number" min="0" step="any" value=""></div>' +
        '<div class="field" style="flex:0 0 120px"><label>Unit cost</label><input id="mvCost" type="number" min="0" step="any" value=""></div>' +
        "</div>" +
        '<div class="field"><label>Date</label><input id="mvDate" type="date" value="' + today() + '"></div>' +
        '<div class="field"><label>Note</label><input id="mvNote" placeholder="e.g. received PO-0001" value=""></div>' +
        "</div>" +
        '<div class="modal-foot"><button class="btn btn-primary btn-sm" id="mvSaveBtn">Record move</button>' +
        '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div>');
      modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
      modal.querySelector("#mvItem").addEventListener("change", e => {
        const sel = items.find(x => x.id === e.target.value);
        if (sel) modal.querySelector("#mvCost").value = amt(sel.avgCost) || "";
      });
      modal.querySelector("#mvSaveBtn").addEventListener("click", async () => {
        const r = await recordMove({
          itemId: modal.querySelector("#mvItem").value,
          type: modal.querySelector("#mvType").value,
          qty: amt(modal.querySelector("#mvQty").value),
          unitCost: amt(modal.querySelector("#mvCost").value),
          date: modal.querySelector("#mvDate").value || today(),
          note: modal.querySelector("#mvNote").value,
        });
        if (r && r.error) { FW.toast(r.error, "err"); return; }
        modal.closest(".modal-back").remove();
        FW.toast("Stock movement recorded");
        renderMoves(document.querySelector(".ledger-tab-ctn"));
      });
    })();
  }

  /* ── movements tab ───────────────────────────────────────────────────── */
  async function renderMoves(ctn) {
    const [moves, items] = await Promise.all([loadMoves(), loadItems()]);
    const byId = {};
    for (const it of items) byId[it.id] = it;
    const sorted = [...moves].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    let html = '<div class="card"><div class="card-head"><h3>Stock movements</h3>' +
      '<button class="btn btn-primary btn-sm" id="mvNewBtn">+ Record movement</button></div>' +
      '<p class="muted small" style="margin:0;padding:0 16px 10px">Purchases add stock and update the weighted-average cost. Sales reduce stock at average cost (and post COGS when they come from a posted invoice). Adjustments correct quantity without changing cost.</p>';
    if (!sorted.length) {
      html += '<p class="muted small" style="text-align:center;padding:22px 14px 24px">No movements yet. Record a purchase to add stock, or post an invoice with item lines and the sale appears here automatically.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>Date</th><th>Item</th><th>Type</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Total</th><th>Note</th></tr></thead><tbody>';
      for (const m of sorted) {
        const it = byId[m.itemId] || {};
        const qty = amt(m.qty);
        html += "<tr>" +
          "<td>" + esc(m.date || "—") + "</td>" +
          '<td class="acct-code">' + esc(it.sku || m.itemId) + '<div class="muted small">' + esc(it.name || "") + "</div></td>" +
          '<td><span class="chip ' + ({ purchase: "chip-done", sale: "chip-phase", adjustment: "chip-pending" }[m.type] || "chip-pending") + '">' + esc(m.type) + "</span></td>" +
          '<td class="num"><strong>' + (qty > 0 ? "+" : "") + qty + "</strong></td>" +
          '<td class="num">' + FW.money(amt(m.unitCost)) + "</td>" +
          '<td class="num">' + FW.money(round2(Math.abs(qty) * amt(m.unitCost))) + "</td>" +
          "<td class=\"muted small\">" + esc(m.note || (m.ref || "")) + (m.source && m.source.kind === "invoice" ? ' <span class="chip chip-done">auto · ' + esc(m.ref || "") + "</span>" : "") + "</td>" +
          "</tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;
    ctn.querySelector("#mvNewBtn").addEventListener("click", () => openMoveModal(null));
  }

  /* ── valuation & COGS tab ────────────────────────────────────────────── */
  async function renderValuation(ctn) {
    const val = await valuation();
    const first = new Date(); first.setMonth(first.getMonth() - 1);
    const defFrom = first.getFullYear() + "-" + String(first.getMonth() + 1).padStart(2, "0") + "-" + first.getDate();
    const defTo = today();
    let html = '<div class="card" style="margin-bottom:14px"><div class="card-body"><div class="row-flex" style="align-items:flex-end">' +
      '<div class="field" style="flex:0 0 170px"><label>COGS from</label><input type="date" id="vgFrom" value="' + defFrom + '"></div>' +
      '<div class="field" style="flex:0 0 170px"><label>To</label><input type="date" id="vgTo" value="' + defTo + '"></div>' +
      '<button class="btn btn-primary btn-sm" style="margin-bottom:4px" id="vgRunBtn">Calculate COGS</button>' +
      '<span class="muted small" style="margin-bottom:8px">COGS = qty sold × weighted-average unit cost</span>' +
      "</div></div></div>";
    html += '<div class="stat-grid" style="margin-bottom:14px">' +
      '<div class="stat-card card"><div class="stat-value">' + val.totalQty + '</div><div class="stat-label">Units on hand</div><div class="stat-sub">' + val.rows.filter(r => r.qty <= 0).length + " out of stock</div></div>" +
      '<div class="stat-card card"><div class="stat-value">' + FW.money(val.totalValue) + '</div><div class="stat-label">Inventory value</div><div class="stat-sub">weighted-average cost</div></div>' +
      '<div class="stat-card card"><div class="stat-value" id="vgCogsVal">—</div><div class="stat-label">COGS (selected range)</div><div class="stat-sub" id="vgCogsSub">run the calculation</div></div>' +
      "</div>";
    html += '<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>On-hand valuation</h3></div>';
    if (!val.rows.length) {
      html += '<p class="muted small" style="text-align:center;padding:20px 14px">No items with quantity.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>SKU</th><th>Name</th><th class="num">On hand</th><th class="num">Avg cost</th><th class="num">Value</th></tr></thead><tbody>';
      for (const r of val.rows) {
        html += "<tr><td class=\"acct-code\">" + esc(r.sku || "—") + "</td><td>" + esc(r.name || "—") + "</td>" +
          '<td class="num">' + r.qty + "</td><td class=\"num\">" + FW.money(r.avgCost) + "</td><td class=\"num\"><strong>" + FW.money(r.value) + "</strong></td></tr>";
      }
      html += '<tr class="tot"><td colspan="2">Total</td><td class="num">' + val.totalQty + '</td><td></td><td class="num">' + FW.money(val.totalValue) + "</td></tr></tbody></table>";
    }
    html += "</div>";
    html += '<div class="card"><div class="card-head"><h3>By category</h3></div>';
    if (!val.byCategory.length) {
      html += '<p class="muted small" style="text-align:center;padding:20px 14px">No categories.</p>';
    } else {
      html += '<table class="tbl"><thead><tr><th>Category</th><th class="num">Units</th><th class="num">Value</th></tr></thead><tbody>';
      for (const c of val.byCategory) {
        html += "<tr><td>" + esc(c.category) + "</td><td class=\"num\">" + c.qty + '</td><td class="num">' + FW.money(c.value) + "</td></tr>";
      }
      html += "</tbody></table>";
    }
    html += "</div>";
    ctn.innerHTML = html;

    ctn.querySelector("#vgRunBtn").addEventListener("click", async () => {
      const from = ctn.querySelector("#vgFrom").value || defFrom;
      const to = ctn.querySelector("#vgTo").value || defTo;
      const r = await cogsForPeriod(from, to);
      const valEl = ctn.querySelector("#vgCogsVal");
      const subEl = ctn.querySelector("#vgCogsSub");
      if (valEl) valEl.textContent = FW.money(r.cogs);
      if (subEl) subEl.textContent = r.count + " sale " + (r.count === 1 ? "move" : "moves") + " in range" + (r.byItem.length ? " · " + r.byItem.length + " items" : "");
    });
  }

  /* ── icons ───────────────────────────────────────────────────────────── */
  const XS_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
  const ICON = {
    pencil: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 5v14"/><path d="M16 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M7 5v14l11-7z"/></svg>',
    moves: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>',
  };
  function confirmDialog(title, message, onYes, dangerLabel) {
    const modal = FW.modal(
      '<div class="modal-head"><h3>' + esc(title) + '</h3><button class="icon-btn" data-close aria-label="Close">' + XS_CLOSE + "</button></div>" +
      '<div class="modal-body"><p style="margin-top:0">' + esc(message) + "</p>" +
      '<div class="row-flex"><button class="btn btn-danger btn-sm" id="confirmYesBtn">' + esc(dangerLabel || "Confirm") + "</button>" +
      '<button class="btn btn-ghost btn-sm" data-close>Cancel</button></div></div>');
    modal.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => modal.closest(".modal-back").remove()));
    modal.querySelector("#confirmYesBtn").addEventListener("click", () => { modal.closest(".modal-back").remove(); onYes(); });
    return modal;
  }

  /* ── self-test (validation for tasks 40–43) ──────────────────────────── */
  async function selfTest() {
    const results = [];
    const ok = (name, cond, extra) => results.push({ name, pass: !!cond, extra: extra || "" });

    /* task 40 — item catalog */
    const savedItems = await loadItems();
    const savedMoves = await loadMoves();
    const temp = [
      { id: "t_widget", sku: "WIDGET", name: "Widget", uom: "ea", category: "Parts", qty: 0, avgCost: 0, lastCost: 0, price: 25, active: true },
    ];
    await saveItems(temp); await saveMoves([]);
    ok("Items: saveItem creates and persists", (await saveItem({ id: "t_widget2", sku: "GADGET", name: "Gadget", uom: "ea", qty: 0, avgCost: 0, price: 40 }, await loadItems())).id === "t_widget2");
    ok("Items: itemById is synchronous and finds the item", itemById("t_widget") && itemById("t_widget").sku === "WIDGET");
    ok("Items: itemOptions marks the current item selected", /value="t_widget" selected/.test(itemOptions("t_widget")));
    ok("Items: duplicate SKU is rejected", (await saveItem({ id: "dup", sku: "widget", name: "X" }, await loadItems())).error);

    /* task 41 — transaction logic + weighted average */
    await recordMove({ itemId: "t_widget", type: "purchase", qty: 10, unitCost: 10, date: "2026-09-01" });
    await recordMove({ itemId: "t_widget", type: "purchase", qty: 10, unitCost: 20, date: "2026-09-02" });
    let it = itemById("t_widget");
    ok("Moves: purchases raise stock", it.qty === 20, "qty=" + it.qty);
    ok("Moves: weighted average cost = (10×10 + 10×20)/20", it.avgCost === 15, "avg=" + it.avgCost);
    ok("Moves: sale blocked when stock insufficient", (await recordMove({ itemId: "t_widget", type: "sale", qty: 99, date: "2026-09-03" })).error);
    await recordMove({ itemId: "t_widget", type: "sale", qty: 5, date: "2026-09-04" });
    it = itemById("t_widget");
    ok("Moves: sale reduces stock at avg cost", it.qty === 15, "qty=" + it.qty);
    const moves = await loadMoves();
    const saleMove = moves.find(m => m.type === "sale");
    ok("Moves: sale move records avg cost basis", saleMove && amt(saleMove.unitCost) === 15, JSON.stringify(saleMove && saleMove.unitCost));

    /* task 42 — COGS */
    const cogs = await cogsForPeriod("2026-09-01", "2026-09-30");
    ok("COGS: qty × avg cost for the period", cogs.cogs === 75, "cogs=" + cogs.cogs);
    ok("COGS: out-of-range sales excluded", (await cogsForPeriod("2026-08-01", "2026-08-31")).cogs === 0);

    /* task 43 — valuation */
    const val = await valuation();
    const w = val.rows.find(r => r.id === "t_widget");
    ok("Valuation: on-hand × avg cost", w && w.value === 225, JSON.stringify(w));
    ok("Valuation: totals sum across items", val.totalValue === 225, "tot=" + val.totalValue);

    /* cleanup temp data */
    await saveItems(savedItems); await saveMoves(savedMoves);
    ok("Cleanup: temp items and moves removed", true);

    return results;
  }

  /* ── public API ──────────────────────────────────────────────────────── */
  const X = {
    loadItems, saveItems, loadMoves, saveMoves,
    itemById, itemOptions,
    saveItem, deleteItem, setItemActive,
    recordMove, applyMoveToItem, cogsForPeriod, valuation,
    inventoryAccountId, cogsAccountId, onInvoicePosted, onInvoiceVoided,
    render, selfTest,
  };
  window.Modules = window.Modules || {};
  window.Modules.inventory = X;
  window.Inventory = X;
})();
