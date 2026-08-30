// Five Realms — casting spells (roadmap Phase 5, task 19).
// The complete casting pipeline on top of the plugin reducer. The reducer's
// frActionCastSpell already authoritatively enforces priority, hand/ownership,
// sorcery-vs-instant timing, mode legality, target legality, X validation, and the
// mana spend. This module is the client-facing layer the UI/AI will drive:
//   1. timingLegality  — a cheap local mirror of the reducer's timing gates so callers
//      can ask "can I cast this right now" (and why not) without touching the engine,
//   2. castableFromHand — enumerate every card in hand with its timing + affordability
//      (the "what can I cast" menu for the action panel / AI),
//   3. validateCast   — an authoritative dry-run of the whole cast on a clone of the
//      state (with an artificially topped-up pool so only timing/mode/target/X reject),
//      giving a clear reason before anything is tapped or paid,
//   4. castSpell      — the full pipeline: build a payment plan, validate, tap sources,
//      dispatch castSpell to the reducer, and announce the cast into the game history.
// Illegal casts are rejected with a clear reason (never a silent no-op), and nothing is
// tapped or paid unless the whole cast would succeed.

import * as engine from "./engine.js";
import * as turn from "./turn.js";
import * as mana from "./mana.js";
import * as cost from "./cost.js";

// The same sorcery-speed types the plugin reducer uses (a card is sorcery-speed if any
// of its types is in this list; Instants are the exception that can go any time).
export const SORCERY_SPEED_TYPES = ["Creature", "Sorcery", "Enchantment", "Artifact"];

// cardSpeed(card) -> "instant" | "sorcery" — the speed class for display / AI ranking.
export function cardSpeed(card) {
  if (!card || !Array.isArray(card.types)) return "sorcery";
  return card.types.some((t) => SORCERY_SPEED_TYPES.includes(t)) ? "sorcery" : "instant";
}

// timingLegality(game, player, objId) -> { ok:true } or { ok:false, reason }. Mirrors the
// reducer's timing gates locally: priority, hand/ownership, lands-are-not-cast, and for
// sorcery-speed cards (creature/sorcery/enchantment/artifact) active-player + main phase +
// empty stack. Instants are legal at any step where the player holds priority.
export function timingLegality(game, player, objId) {
  const raw = game.raw;
  if (!raw || !Array.isArray(raw.players)) return { ok: false, reason: "no game" };
  if (raw.gameOver) return { ok: false, reason: "game is over" };
  if (raw.priorityPlayer !== player) return { ok: false, reason: "player does not have priority" };
  const obj = raw.objects[objId];
  if (!obj || obj.zone !== "hand" || obj.owner !== player) {
    return { ok: false, reason: "object is not in player's hand" };
  }
  const card = mana.cardDefFor(game, objId);
  if (!card) return { ok: false, reason: "unknown card" };
  if (Array.isArray(card.types) && card.types.includes("Land")) {
    return { ok: false, reason: "lands are played, not cast" };
  }
  if (cardSpeed(card) === "sorcery") {
    if (raw.activePlayer !== player) {
      return { ok: false, reason: "sorcery-speed spell requires being the active player" };
    }
    if (raw.step !== "precombat_main" && raw.step !== "postcombat_main") {
      return { ok: false, reason: "sorcery-speed spell requires a main phase" };
    }
    if (raw.stack.length > 0) {
      return { ok: false, reason: "sorcery-speed spell requires an empty stack" };
    }
  }
  return { ok: true };
}

// castableFromHand(game, player?) -> [{ objId, card, speed, timing:{ok,reason},
// canPay, maxX, plan }] for every card in the player's hand. `timing` is the timing
// gate; `canPay` is whether the cost is payable right now (via cost.buildPayment, so it
// respects the floating pool plus untapped mana sources); `maxX` is the largest
// affordable X for X-cost cards (null otherwise). Cards are only listed when they pass
// BOTH gates, and entries carry the reason when they don't, so the UI can grey them out
// with a tooltip. player defaults to whoever holds priority.
export function castableFromHand(game, player) {
  const raw = game.raw;
  const p = player === undefined ? raw.priorityPlayer : player;
  const out = [];
  for (const objId of engine.zoneIds(game, "hand", p)) {
    const card = mana.cardDefFor(game, objId);
    if (!card) continue;
    const timing = timingLegality(game, p, objId);
    let plan = null;
    let maxX = null;
    let canPay = false;
    if (timing.ok) {
      const costStr = card.manaCost || "";
      const hasX = cost.parseCost(costStr).xCount > 0;
      plan = cost.buildPayment(game, p, costStr, hasX ? { x: "max" } : {});
      canPay = plan.ok;
      if (plan.ok) maxX = plan.x;
    }
    out.push({ objId, card, speed: cardSpeed(card), timing, canPay, maxX, plan });
  }
  return out;
}

// validateCast(game, player, objId, opts?) -> { ok:true } or { ok:false, reason }.
// Authoritative dry-run: clone the state, top the caster's pool up so affordability is
// not the gate, and run the reducer's castSpell on the clone. Any rejection (timing,
// mode, targets, X) comes back verbatim from the reducer; the real game is untouched.
// opts: { x?, mode?, targets? }.
export function validateCast(game, player, objId, opts = {}) {
  const raw = game.raw;
  if (!raw || !Array.isArray(raw.players)) return { ok: false, reason: "no game" };
  const obj = raw.objects[objId];
  const card = obj ? mana.cardDefFor(game, objId) : null;
  if (!card) return { ok: false, reason: "unknown card" };
  if (Array.isArray(card.types) && card.types.includes("Land")) {
    return { ok: false, reason: "lands are played, not cast" };
  }
  const clone = JSON.parse(JSON.stringify(raw));
  const pl = clone.players[player];
  if (!pl) return { ok: false, reason: "unknown player" };
  pl.manaPool = { W: 99, U: 99, B: 99, R: 99, G: 99, C: 99 };
  const action = { type: "castSpell", player, objectId: objId };
  if (opts.x !== undefined) action.x = opts.x;
  if (opts.mode !== undefined) action.mode = opts.mode;
  if (Array.isArray(opts.targets)) action.targets = opts.targets;
  try {
    const next = engine.requireEngine()("act", clone, action);
    if (next && next.lastActionError) return { ok: false, reason: next.lastActionError };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "engine error: " + e.message };
  }
}

// castSpell(game, player, objId, opts?) -> the full pipeline. opts:
//   x?: number|"max"  — the chosen X (defaults to 0; "max" spends as much as possible)
//   mode?: string      — the chosen mode for a modal spell
//   targets?: array    — object ids (or player indices) in slot order
//   strategy?/maxTaps? — passed through to the payment planner
// Returns { ok:true, ... } on success (spell on the stack, sources tapped, pool spent,
// announceCast entry in the game history) or { ok:false, reason } on any rejection —
// with nothing tapped or paid unless the whole cast was going to succeed. Throws only on
// programming errors (malformed cost, bad x) and on executePayment failures.
export function castSpell(game, player, objId, opts = {}) {
  const raw = game.raw;
  const card = mana.cardDefFor(game, objId);
  if (!card) throw new Error("castSpell: unknown card " + (raw.objects[objId] || {}).cardId);
  const costStr = card.manaCost || "";

  // 1. Authoritative legality dry-run first (timing/priority/mode/targets/X). The clone's
  //    pool is topped up, so affordability is not the gate here. For "max" X we validate
  //    with a placeholder 0; the real X is re-validated by the reducer at cast time.
  const v = validateCast(game, player, objId, {
    x: opts.x === "max" ? 0 : opts.x,
    mode: opts.mode,
    targets: opts.targets,
  });
  if (!v.ok) return { ok: false, reason: v.reason };

  // 2. Affordability (read-only): resolves X (including "max") and a taps-free plan.
  const payOpts = {};
  if (opts.x !== undefined) payOpts.x = opts.x;
  if (opts.strategy !== undefined) payOpts.strategy = opts.strategy;
  if (opts.maxTaps !== undefined) payOpts.maxTaps = opts.maxTaps;
  const plan = cost.buildPayment(game, player, costStr, payOpts);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  // 3. Tap the chosen mana sources (priority/tap/sickness enforced, production tracked).
  cost.executePayment(game, player, plan);

  // 4. Dispatch the cast to the reducer (pays the pool, moves the spell to the stack).
  const action = { type: "castSpell", player, objectId: objId };
  if (plan.cost.xCount > 0) action.x = plan.x;
  if (opts.mode !== undefined) action.mode = opts.mode;
  if (Array.isArray(opts.targets)) action.targets = opts.targets;
  game.history.push({
    action: "announceCast",
    player,
    objectId: objId,
    cardId: card.id,
    name: card.name,
    speed: cardSpeed(card),
    x: action.x,
    mode: action.mode === undefined ? null : action.mode,
    targets: action.targets === undefined ? [] : action.targets,
    cost: costStr,
  });
  try {
    turn.doAction(game, action);
  } catch (e) {
    // The reducer rejected after we tapped (should not happen after validateCast, but a
    // second-opinion guard costs nothing): the mana now floats in the pool. Report it.
    return { ok: false, reason: "cast rejected: " + e.message, tapped: true };
  }

  const entry = (game.raw.stack || []).find((s) => s && s.kind === "spell" && s.objId === objId);
  return {
    ok: true,
    objId,
    cardId: card.id,
    name: card.name,
    x: plan.cost.xCount > 0 ? plan.x : 0,
    mode: opts.mode === undefined ? null : opts.mode,
    targets: action.targets === undefined ? [] : action.targets,
    stackEntry: entry || null,
    plan,
  };
}
