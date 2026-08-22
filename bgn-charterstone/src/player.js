// src/player.js — player state (Task 3).
// Holds a player's persona, charter, workers, influence, VP, capacity, and
// cards; coins/resources live in the linked economy (Task 2). Counts change
// only through validated methods; property reads never mutate.

export const CHARTER_COLORS = ["#d9504a", "#3f7fd6", "#3fa05a", "#e0b23a", "#e0812f", "#9b6cc9"];
export const MAX_INFLUENCE = 12;
export const STARTING_WORKERS = 2;
export const GAME1_STARTING_COINS = 4;

function nonNegInt(name, v) {
  if (!Number.isInteger(v) || v < 0) throw new Error("player: " + name + " must be a non-negative integer");
}

export function createPlayer(config = {}) {
  const { id } = config;
  if (typeof id !== "string" || !id) throw new Error("player: id is required");

  const charterId = config.charterId ?? 0;
  nonNegInt("charterId", charterId);
  if (charterId > 5) throw new Error("player: charterId must be 0-5");

  const workers = config.workers ?? STARTING_WORKERS;
  const influence = config.influence ?? MAX_INFLUENCE;
  const vp = config.vp ?? 0;
  const capacity = config.capacity ?? 0;
  nonNegInt("workers", workers);
  nonNegInt("influence", influence);
  nonNegInt("vp", vp);
  nonNegInt("capacity", capacity);
  if (influence > MAX_INFLUENCE) throw new Error("player: influence cannot exceed " + MAX_INFLUENCE);

  const economy = config.economy || null;
  if (economy) {
    if (!economy.hasPlayer(id)) economy.addPlayer(id);
    const startingCoins = config.startingCoins ?? 0;
    nonNegInt("startingCoins", startingCoins);
    if (startingCoins > 0) economy.gain(id, { coins: startingCoins });
  }

  const archive = config.archive || null;

  const state = {
    id,
    charterId,
    color: config.color ?? CHARTER_COLORS[charterId],
    personaId: config.personaId ?? null,
    workers,
    influence,
    vp,
    capacity,
    cards: [],
  };

  function deleteCopy(items) {
    const out = { ...items };
    delete out.coins;
    return out;
  }

  const player = {
    get id() { return state.id; },
    get charterId() { return state.charterId; },
    get color() { return state.color; },
    get personaId() { return state.personaId; },
    get workers() { return state.workers; },
    get influence() { return state.influence; },
    get vp() { return state.vp; },
    get capacity() { return state.capacity; },
    get cards() { return [...state.cards]; },

    coins() {
      return economy ? economy.amountOf(state.id, "coins") : 0;
    },
    resources() {
      if (!economy) return {};
      const items = economy.balance(state.id);
      delete items.coins;
      return items;
    },

    addVp(n) { nonNegInt("vp", n); state.vp += n; return state.vp; },
    addCapacity(n) { nonNegInt("capacity", n); state.capacity += n; return state.capacity; },
    addWorkers(n) { nonNegInt("workers", n); state.workers += n; return state.workers; },
    spendWorkers(n) {
      nonNegInt("workers", n);
      if (n > state.workers) throw new Error("player: not enough workers");
      state.workers -= n;
      return state.workers;
    },
    gainInfluence(n) {
      nonNegInt("influence", n);
      state.influence = Math.min(MAX_INFLUENCE, state.influence + n);
      return state.influence;
    },
    spendInfluence(n) {
      nonNegInt("influence", n);
      if (n > state.influence) throw new Error("player: not enough influence");
      state.influence -= n;
      return state.influence;
    },

    gainCard(cardId) {
      if (typeof cardId !== "string" || !cardId) throw new Error("player: cardId must be a non-empty string");
      if (state.cards.includes(cardId)) throw new Error("player: card '" + cardId + "' already held");
      if (archive && archive.has(cardId)) {
        throw new Error("player: card '" + cardId + "' is archived and cannot re-enter a hand");
      }
      state.cards.push(cardId);
      return state.cards.length;
    },
    removeCard(cardId) {
      const i = state.cards.indexOf(cardId);
      if (i === -1) throw new Error("player: card '" + cardId + "' not held");
      state.cards.splice(i, 1);
      return state.cards.length;
    },
    hasCard(cardId) {
      return state.cards.includes(cardId);
    },

    snapshot() {
      return {
        id: state.id,
        charterId: state.charterId,
        color: state.color,
        personaId: state.personaId,
        workers: state.workers,
        influence: state.influence,
        vp: state.vp,
        capacity: state.capacity,
        cards: [...state.cards],
        coins: economy ? economy.amountOf(state.id, "coins") : 0,
        resources: economy ? deleteCopy(economy.balance(state.id)) : {},
      };
    },

    toJSON() {
      return {
        kind: "player",
        id: state.id,
        charterId: state.charterId,
        color: state.color,
        personaId: state.personaId,
        workers: state.workers,
        influence: state.influence,
        vp: state.vp,
        capacity: state.capacity,
        cards: [...state.cards],
      };
    },
  };

  return player;
}

export function restorePlayer(data, economy, archive) {
  if (!data || typeof data !== "object") throw new Error("player: bad restore payload");
  const p = createPlayer({
    id: data.id,
    charterId: data.charterId ?? 0,
    color: data.color ?? undefined,
    personaId: data.personaId ?? null,
    workers: data.workers ?? STARTING_WORKERS,
    influence: data.influence ?? MAX_INFLUENCE,
    vp: data.vp ?? 0,
    capacity: data.capacity ?? 0,
    economy: economy || null,
    startingCoins: 0,
    archive: archive || null,
  });
  for (const c of data.cards ?? []) p.gainCard(c);
  return p;
}
