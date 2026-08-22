// src/economy.js — finite resource economy (Task 2).
// Six resources (metal, coal, pumpkin, grain, clay, wood) plus coins as
// currency. The general supply is finite (36 coins, 72 resource tokens) and
// every token always lives in exactly one store: general or a player's.
// gains from the general supply grant only what remains, flagging shortfalls;
// pay never overdraws; balances never go negative.

export const RESOURCE_TYPES = ["metal", "coal", "pumpkin", "grain", "clay", "wood"];
export const CURRENCY = "coins";
export const ITEMS = [CURRENCY, ...RESOURCE_TYPES];

function copyItems(items, keys) {
  const out = {};
  for (const k of keys) out[k] = items[k];
  return out;
}

function validateItems(items, allItemsSet) {
  if (!items || typeof items !== "object") throw new Error("economy: items must be an object");
  for (const [k, v] of Object.entries(items)) {
    if (!allItemsSet.has(k)) throw new Error("economy: unknown item '" + k + "'");
    if (!Number.isInteger(v) || v < 0) throw new Error("economy: quantity for '" + k + "' must be a non-negative integer");
  }
}

export function createEconomy(config = {}) {
  const resourceTypes = config.resourceTypes ?? [...RESOURCE_TYPES];
  const allItems = [CURRENCY, ...resourceTypes];
  const allItemsSet = new Set(allItems);

  const general = {};
  general[CURRENCY] = config.coins ?? 36;
  for (const r of resourceTypes) {
    let perType;
    if (config.resourceCounts == null) perType = 12;
    else if (typeof config.resourceCounts === "number") perType = config.resourceCounts;
    else perType = config.resourceCounts[r] ?? 12;
    if (!Number.isInteger(perType) || perType < 0) throw new Error("economy: resource count must be a non-negative integer");
    general[r] = perType;
  }
  if (!Number.isInteger(general[CURRENCY]) || general[CURRENCY] < 0) {
    throw new Error("economy: coin count must be a non-negative integer");
  }
  const initial = copyItems(general, allItems);

  const players = new Map();

  function storeOf(playerId) {
    const s = players.get(playerId);
    if (!s) throw new Error("economy: unknown player '" + playerId + "' (call addPlayer first)");
    return s;
  }

  const economy = {
    resourceTypes: [...resourceTypes],
    items: [...allItems],

    addPlayer(playerId) {
      if (players.has(playerId)) throw new Error("economy: player '" + playerId + "' already exists");
      const store = {};
      for (const k of allItems) store[k] = 0;
      players.set(playerId, store);
      return economy;
    },
    hasPlayer(playerId) {
      return players.has(playerId);
    },
    playerIds() {
      return [...players.keys()];
    },

    generalItems() {
      return copyItems(general, allItems);
    },
    balance(playerId) {
      return copyItems(storeOf(playerId), allItems);
    },
    amountOf(playerId, item) {
      return storeOf(playerId)[item];
    },

    canPay(playerId, items) {
      validateItems(items, allItemsSet);
      const store = storeOf(playerId);
      for (const k of allItems) {
        if ((items[k] || 0) > store[k]) return false;
      }
      return true;
    },

    pay(playerId, items) {
      validateItems(items, allItemsSet);
      const store = storeOf(playerId);
      const missing = {};
      let anyMissing = false;
      for (const k of allItems) {
        const need = items[k] || 0;
        if (need > store[k]) {
          missing[k] = need - store[k];
          anyMissing = true;
        }
      }
      if (anyMissing) return { ok: false, reason: "insufficient", missing };
      const paid = {};
      for (const k of allItems) {
        const amount = items[k] || 0;
        if (amount > 0) {
          store[k] -= amount;
          general[k] += amount;
          paid[k] = amount;
        }
      }
      return { ok: true, paid };
    },

    gain(playerId, items) {
      validateItems(items, allItemsSet);
      const store = storeOf(playerId);
      const granted = {};
      const shortfall = {};
      let anyShortfall = false;
      for (const k of allItems) {
        const want = items[k] || 0;
        const give = Math.min(want, general[k]);
        granted[k] = give;
        shortfall[k] = want - give;
        if (shortfall[k] > 0) anyShortfall = true;
        if (give > 0) {
          general[k] -= give;
          store[k] += give;
        }
      }
      return { ok: true, granted, shortfall, hasShortfall: anyShortfall };
    },

    totals() {
      const out = copyItems(general, allItems);
      for (const store of players.values()) {
        for (const k of allItems) out[k] += store[k];
      }
      return out;
    },
    initialTotals() {
      return copyItems(initial, allItems);
    },

    toJSON() {
      const stores = {};
      for (const [id, store] of players.entries()) stores[id] = copyItems(store, allItems);
      return {
        kind: "economy",
        resourceTypes: [...resourceTypes],
        items: [...allItems],
        initial: copyItems(initial, allItems),
        general: copyItems(general, allItems),
        players: stores,
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("economy: bad fromJSON payload");
      for (const k of allItems) {
        general[k] = typeof data.general?.[k] === "number" ? data.general[k] : 0;
        initial[k] = typeof data.initial?.[k] === "number" ? data.initial[k] : general[k];
      }
      players.clear();
      for (const [id, store] of Object.entries(data.players ?? {})) {
        const s = {};
        for (const k of allItems) s[k] = typeof store[k] === "number" ? store[k] : 0;
        players.set(id, s);
      }
      return economy;
    },
  };
  return economy;
}

export function restoreEconomy(data) {
  if (!data || typeof data !== "object") throw new Error("economy: bad restore payload");
  const resourceTypes = Array.isArray(data.resourceTypes) ? [...data.resourceTypes] : [...RESOURCE_TYPES];
  const economy = createEconomy({
    resourceTypes,
    coins: data.initial?.coins ?? 36,
    resourceCounts: Object.fromEntries(resourceTypes.map(r => [r, data.initial?.[r] ?? 12])),
  });
  economy.fromJSON(data);
  return economy;
}
