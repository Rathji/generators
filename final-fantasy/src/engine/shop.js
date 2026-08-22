// Task #22: Shop Transaction System — buy/sell against a fixed price list,
// validating gold and inventory capacity for every transaction.

import { ITEMS } from "../data/items.js";

export class ShopSystem {
  constructor(shopDef, party, inventory, opts = {}) {
    this.shop = shopDef;
    this.party = party;
    this.inventory = inventory;
    this.priceMod = opts.priceMod ?? shopDef.priceMod ?? 1;
    this.sellRatio = opts.sellRatio ?? shopDef.sellRatio ?? 0.5;
  }

  get id() {
    return this.shop.id;
  }

  get name() {
    return this.shop.name;
  }

  inStock(itemId) {
    return this.shop.stock.includes(itemId);
  }

  priceOf(itemId) {
    const item = ITEMS[itemId];
    if (!item) return null;
    return Math.floor(item.price * this.priceMod);
  }

  sellPriceOf(itemId) {
    const price = this.priceOf(itemId);
    if (price === null) return null;
    return Math.floor(price * this.sellRatio);
  }

  // All sellable stock with current pricing/count.
  stockList() {
    return this.shop.stock.map((id) => {
      const item = ITEMS[id];
      return {
        id,
        name: item.name,
        type: item.type,
        description: item.description ?? "",
        price: this.priceOf(id),
        count: this.inventory.count(id),
      };
    });
  }

  // Every inventory item the party could sell back (price > 0).
  sellableList() {
    return this.inventory
      .list()
      .filter((entry) => ITEMS[entry.id] && (ITEMS[entry.id].price ?? 0) > 0)
      .map((entry) => ({ ...entry, sellPrice: this.sellPriceOf(entry.id) }));
  }

  canBuy(itemId, qty = 1) {
    if (!this.inStock(itemId)) return { ok: false, error: "not in stock" };
    const price = this.priceOf(itemId);
    if (price === null) return { ok: false, error: "unknown item" };
    const total = price * qty;
    if (this.party.gold < total) return { ok: false, error: "insufficient gold", cost: total };
    if (!this.inventory.canAdd(itemId, qty)) return { ok: false, error: "inventory full" };
    return { ok: true, cost: total };
  }

  buy(itemId, qty = 1) {
    const check = this.canBuy(itemId, qty);
    if (!check.ok) return check;
    if (!this.party.spendGold(check.cost)) return { ok: false, error: "gold transaction failed" };
    if (!this.inventory.add(itemId, qty)) {
      this.party.addGold(check.cost);
      return { ok: false, error: "inventory full" };
    }
    return { ok: true, cost: check.cost, qty, count: this.inventory.count(itemId) };
  }

  canSell(itemId, qty = 1) {
    const price = this.sellPriceOf(itemId);
    if (price === null) return { ok: false, error: "unknown item" };
    if (price <= 0) return { ok: false, error: "not sellable" };
    if (!this.inventory.has(itemId, qty)) return { ok: false, error: "not owned", count: this.inventory.count(itemId) };
    return { ok: true, gained: price * qty };
  }

  sell(itemId, qty = 1) {
    const check = this.canSell(itemId, qty);
    if (!check.ok) return check;
    if (!this.inventory.remove(itemId, qty)) return { ok: false, error: "remove failed" };
    this.party.addGold(check.gained);
    return { ok: true, gained: check.gained, qty, count: this.inventory.count(itemId) };
  }
}

// Task #22 UI: DOM shop panel with Buy/Sell tabs, price lists, and gold readout.
export class ShopUI {
  constructor(container, opts = {}) {
    this.container = container;
    this.shop = null;
    this.onTrade = opts.onTrade ?? null;
    this.mode = "buy";
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div class="shop-ui">
        <div class="su-head"><span class="su-title" id="suTitle">Shop</span> <span class="su-gold" id="suGold">Gold 0</span></div>
        <div class="su-tabs">
          <button class="su-tab" id="suTabBuy">Buy</button>
          <button class="su-tab" id="suTabSell">Sell</button>
        </div>
        <div class="su-list" id="suList"></div>
      </div>
      <style>
        .shop-ui { font-family: monospace; color: #e8eefc; background: #0a0e1e; border: 2px solid #39456e; padding: 10px; min-width: 340px; max-height: 420px; overflow-y: auto; }
        .su-head { display: flex; justify-content: space-between; margin-bottom: 8px; }
        .su-title { color: #ffd24a; font-weight: bold; }
        .su-gold { color: #7ac8ff; }
        .su-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
        .su-tab { flex: 1; background: #1b2440; color: #cfe0ff; border: 1px solid #39456e; padding: 4px; cursor: pointer; font-family: monospace; }
        .su-tab.active { background: #3a2d00; color: #ffd24a; }
        .su-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 4px 2px; border-bottom: 1px solid #1a2138; font-size: 13px; }
        .su-row button { background: #1b2440; color: #cfe0ff; border: 1px solid #39456e; padding: 2px 8px; cursor: pointer; font-family: monospace; }
        .su-row button:hover { background: #2a3b6e; }
        .su-note { color: #8fa8e8; font-size: 12px; }
      </style>`;
    this.titleEl = this.container.querySelector("#suTitle");
    this.goldEl = this.container.querySelector("#suGold");
    this.listEl = this.container.querySelector("#suList");
    this.tabBuy = this.container.querySelector("#suTabBuy");
    this.tabSell = this.container.querySelector("#suTabSell");
    this.tabBuy.addEventListener("click", () => { this.mode = "buy"; this.render(); });
    this.tabSell.addEventListener("click", () => { this.mode = "sell"; this.render(); });
  }

  setShop(shop) {
    this.shop = shop;
    return this;
  }

  render() {
    if (!this.shop) return this;
    this.titleEl.textContent = this.shop.name;
    this.goldEl.textContent = "Gold " + this.shop.party.gold;
    this.tabBuy.classList.toggle("active", this.mode === "buy");
    this.tabSell.classList.toggle("active", this.mode === "sell");
    this.listEl.innerHTML = "";
    const rows = this.mode === "buy" ? this.shop.stockList() : this.shop.sellableList();
    if (!rows.length) {
      const div = document.createElement("div");
      div.className = "su-note";
      div.textContent = this.mode === "buy" ? "Nothing for sale." : "Nothing to sell.";
      this.listEl.appendChild(div);
      return this;
    }
    for (const r of rows) {
      const row = document.createElement("div");
      row.className = "su-row";
      const price = this.mode === "buy" ? r.price + "g" : r.sellPrice + "g";
      row.innerHTML =
        "<span><b>" + r.name + "</b> <span class='su-note'>x" + r.count + "</span></span>" +
        "<span class='su-note'>" + price + "</span>";
      const btn = document.createElement("button");
      btn.textContent = this.mode === "buy" ? "Buy" : "Sell";
      btn.addEventListener("click", () => {
        if (this.onTrade) this.onTrade(this.shop, r.id, this.mode);
        this.render();
      });
      row.appendChild(btn);
      this.listEl.appendChild(row);
    }
    return this;
  }
}
