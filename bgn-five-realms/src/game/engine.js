// Five Realms — local game layer over the five-realms-plugin engine (roadmap Phase 3).
// The plugin owns the authoritative state machine ($output: "newGame"/"act"/"state");
// this module is the ergonomic wrapper later phases (AI, UI) build on: player views,
// zone moves, card instances, snapshot/restore, and a change-history log. The plugin
// reducer is the outer gate for its own actions; helpers here clone-and-mutate the
// plugin's plain state for the pieces Phase 1 doesn't expose (life/mana/zone moves),
// and every such mutation is recorded in the wrapper's history.

import { alphaDb } from "../cards/db.js";

const fr = (typeof window !== "undefined" && window.root && window.root.fr) ? window.root.fr : null;

export const ZONES = ["library", "hand", "battlefield", "graveyard", "exile", "stack"];

export function requireEngine() {
  if (!fr) throw new Error("five-realms-plugin not loaded (root.fr missing)");
  return fr;
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// newGame({seed, decks, rules, cards}) -> { raw, history, seed, _rules }. decks is an array of
// card-id lists (one per player). Omitting it uses the plugin's default deck. rules
// carries the gameplay toggles (defaults { manaBurn: true }) that the mana layer reads.
// cards adds EXTRA card records merged over the Alpha DB (useful for test-only synthetic
// cards with trigger effects; defaults to none).
// The full 295-card Alpha DB is always injected via config.cards so the engine can
// resolve Alpha cards (spell effects, permanent entry, SBA) natively — merged over the
// plugin's fixture database, which keeps every fixture id working too.
export function newGame(opts = {}) {
  const engine = requireEngine();
  const raw = engine("newGame", {
    seed: opts.seed,
    decks: opts.decks,
    cards: Object.assign({}, alphaDb(), opts.cards || {}),
  });
  return {
    raw,
    history: [],
    seed: opts.seed === undefined ? raw.seed : opts.seed,
    _rules: Object.assign({ manaBurn: true }, opts.rules),
  };
}

// snapshot(game) -> plain JSON-safe object capturing state + history + rules + the
// continuous-effects keyword overlay (granted keywords are wrapper state, not plugin raw).
export function snapshot(game) {
  return {
    raw: requireEngine()("state", game.raw),
    history: clone(game.history || []),
    seed: game.seed,
    _rules: clone(game._rules || { manaBurn: true }),
    _keywordOverlay: clone(game._keywordOverlay || {}),
    _regenerating: clone(game._regenerating || {}),
  };
}

// restore(snap) -> a fresh game wrapper; fails loudly on a malformed snapshot.
export function restore(snap) {
  if (!snap || !snap.raw || !Array.isArray(snap.raw.players)) {
    throw new Error("restore: not a valid snapshot");
  }
  return {
    raw: requireEngine()("state", snap.raw),
    history: clone(snap.history || []),
    seed: snap.seed,
    _rules: clone(snap._rules || { manaBurn: true }),
    _keywordOverlay: clone(snap._keywordOverlay || {}),
    _regenerating: clone(snap._regenerating || {}),
  };
}

// act(game, action) -> runs the plugin reducer, swaps in the new state, logs it.
export function act(game, action) {
  if (!action || typeof action.type !== "string") throw new Error("act: action.type required");
  game.raw = requireEngine()("act", game.raw, action);
  game.history.push({ action: action.type, at: Date.now() });
  return game.raw;
}

export function players(game) {
  return game.raw.players;
}

export function player(game, i) {
  return game.raw.players[i];
}

export function life(game, i) {
  return game.raw.players[i].life;
}

export function setLife(game, i, value, reason) {
  if (!Number.isFinite(value)) throw new Error("setLife: numeric value required");
  game.raw = clone(game.raw);
  game.raw.players[i].life = value;
  game.history.push({ action: "setLife", player: i, value, reason });
  return game.raw;
}

export function manaPool(game, i) {
  return { ...game.raw.players[i].manaPool };
}

export function addMana(game, i, symbol, qty, reason) {
  const pool = game.raw.players[i].manaPool;
  if (typeof pool[symbol] !== "number") throw new Error("addMana: unknown symbol " + symbol);
  game.raw = clone(game.raw);
  game.raw.players[i].manaPool[symbol] += qty === undefined ? 1 : qty;
  game.history.push({ action: "addMana", player: i, symbol, qty: qty === undefined ? 1 : qty, reason });
  return game.raw;
}

export function spendMana(game, i, symbol, qty, reason) {
  const n = qty === undefined ? 1 : qty;
  const pool = game.raw.players[i].manaPool;
  if (typeof pool[symbol] !== "number") throw new Error("spendMana: unknown symbol " + symbol);
  if (pool[symbol] < n) throw new Error("spendMana: insufficient " + symbol + " mana");
  game.raw = clone(game.raw);
  game.raw.players[i].manaPool[symbol] -= n;
  game.history.push({ action: "spendMana", player: i, symbol, qty: n, reason });
  return game.raw;
}

function zoneContainer(state, zone, i) {
  if (zone === "battlefield" || zone === "stack") return state[zone];
  if (ZONES.includes(zone) && state.players[i]) return state.players[i][zone];
  return null;
}

export function zoneIds(game, zone, i) {
  const arr = zoneContainer(game.raw, zone, i);
  if (!arr) throw new Error("zoneIds: unknown zone/player");
  return arr.slice();
}

// moveCard(game, objId, fromZone, toZone, playerIdx) — clone-based zone transfer that
// mirrors the plugin's frZoneMove semantics (append-ordered target zones; library/hand/
// graveyard/exile are per-player, battlefield/stack shared).
export function moveCard(game, objId, fromZone, toZone, playerIdx) {
  if (!ZONES.includes(fromZone) || !ZONES.includes(toZone)) throw new Error("moveCard: bad zone");
  const raw = clone(game.raw);
  const from = zoneContainer(raw, fromZone, playerIdx);
  const to = zoneContainer(raw, toZone, playerIdx);
  if (!from || !to) throw new Error("moveCard: unknown zone/player");
  const idx = from.indexOf(objId);
  if (idx === -1) throw new Error("moveCard: " + objId + " not in " + fromZone);
  if (!raw.objects[objId]) throw new Error("moveCard: unknown object " + objId);
  from.splice(idx, 1);
  to.push(objId);
  const obj = raw.objects[objId];
  obj.zone = toZone;
  obj.controller = playerIdx;
  game.raw = raw;
  game.history.push({ action: "moveCard", objId, fromZone, toZone, player: playerIdx });
  return game.raw;
}

// cardInstance(game, objId) -> { obj, card } where obj is the live instance and card is
// its immutable definition from the plugin DB (null if the engine doesn't know the id).
export function cardInstance(game, objId) {
  const obj = game.raw.objects[objId];
  if (!obj) return null;
  let card = null;
  try {
    const maybe = requireEngine()("card", obj.cardId);
    if (maybe && typeof maybe === "object") card = maybe;
  } catch (e) {}
  return { obj, card };
}

// legalActions(game) -> the plugin's planar-legal-action solver for the current state (the
// $output "legalActions" op). Returns [] on a malformed game. Mirrors the reducer's own
// guard clauses so a client can enumerate what it may do without tripping the reducer.
export function legalActions(game) {
  try {
    const acts = requireEngine()("legalActions", game.raw);
    return Array.isArray(acts) ? acts : [];
  } catch (e) {
    return [];
  }
}

// render(cardIdOrRecord) -> the plugin's render envelope ({card, typeLine, frontSvg,
// glyphSvg, gemSvg, gemSmallSvg, rects, palette, costSymbols}), or null when unknown.
export function render(cardId) {
  try {
    const out = requireEngine()("render", cardId);
    return out && typeof out === "object" ? out : null;
  } catch (e) {
    return null;
  }
}
