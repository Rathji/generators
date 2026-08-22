// src/effects.js — deterministic pure-effect functions (Task 41).
// Persona and special cards carry an `ability` — a PURE function `(ctx) =>
// result` that returns a plain, JSON-serializable effect descriptor. There is
// NO randomness anywhere: the same state (+ ctx.seed, which resolvers are
// allowed to read but never required to) always yields the same result, which
// is exactly what `resolveAbility` and the Task 41 determinism suite assert.
// Effect descriptors use the `kind` vocabulary below; later phases (persona
// engine, special-card resolution, Task 45+) consume them.

export const EFFECT_KINDS = Object.freeze([
  "items",              // gain item map: { kind:"items", items:{coins:2, wood:1} }
  "vp",                 // immediate VP: { kind:"vp", vp:3 }
  "reputation",         // gain reputation: { kind:"reputation", amount:1 }
  "income",             // bonus during income: { kind:"income", items:{coins:1} }
  "gainCard",           // gain a face-up advancement card: { kind:"gainCard" }
  "retrieveWorkers",    // retrieve all of your workers: { kind:"retrieveWorkers" }
  "trade",              // exchange: { kind:"trade", pay:{coins:2}, gain:{any:1} } ("any" = any resource)
  "setup",              // personal-supply setup bonus: { kind:"setup", items:{coins:1} }
  "freeOwnedBuildingUse",// use one of your own buildings for free: { kind:"freeOwnedBuildingUse" }
  "endGameVp",          // end-game VP: { kind:"endGameVp", vp:4 }
  "guidepost",          // reveals a guidepost: { kind:"guidepost" }
]);

const KIND_SET = new Set(EFFECT_KINDS);

export const effects = {
  items(items) {
    return { kind: "items", items: { ...items } };
  },
  vp(n) {
    return { kind: "vp", vp: n };
  },
  reputation(n) {
    return { kind: "reputation", amount: n };
  },
  income(items) {
    return { kind: "income", items: { ...items } };
  },
  gainCard() {
    return { kind: "gainCard" };
  },
  retrieveWorkers() {
    return { kind: "retrieveWorkers" };
  },
  trade(pay, gain) {
    return { kind: "trade", pay: { ...pay }, gain: { ...gain } };
  },
  setup(items) {
    return { kind: "setup", items: { ...items } };
  },
  freeOwnedBuildingUse() {
    return { kind: "freeOwnedBuildingUse" };
  },
  endGameVp(n) {
    return { kind: "endGameVp", vp: n };
  },
  guidepost() {
    return { kind: "guidepost" };
  },
};

export function isEffectResult(v) {
  return !!v && typeof v === "object" && !Array.isArray(v) && KIND_SET.has(v.kind);
}

// Evaluate a card's ability as a pure function of ctx. Returns
// { ok:true, cardId, result } or { ok:false, reason } (null when the card has
// no ability). `ctx` may carry {state, playerId, player, seed, ...} — the
// ability may read any of it, but must be deterministic in it.
export function resolveAbility(card, ctx = {}) {
  if (!card || typeof card.ability !== "function") return null;
  const result = card.ability(ctx);
  if (!isEffectResult(result)) {
    return { ok: false, reason: "invalid_effect", cardId: card.id, result };
  }
  return { ok: true, cardId: card.id, result };
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every(k => k in b && deepEqual(a[k], b[k]));
}

// True when `result` is plain JSON data (no functions) — a guarantee that
// ability results can be serialized into game logs and campaign state.
export function isPlainSerializable(result) {
  try {
    return deepEqual(JSON.parse(JSON.stringify(result)), result);
  } catch {
    return false;
  }
}
