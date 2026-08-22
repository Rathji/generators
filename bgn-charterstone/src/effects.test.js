// src/effects.test.js — Task 41 determinism suite.
// Run in-page via ?test=effects, or programmatically via window.__loadEffectsTests().
// Task 41: assistants, starting + crate personas, and special cards (friend,
// item, guest, treasure, guidepost, companion) transcribe as deterministic
// pure-effect functions. Every persona/special `ability` is evaluated here
// twice under different seeds and must return an identical, JSON-plain,
// known-kind effect result; assistant `effect` maps must be static
// deterministic item grants; contextual abilities must scale with the state.

import { DEFAULT_CARDS, CARD_TYPES, SPECIAL_SUBTYPES } from "./cards.js";
import {
  effects, resolveAbility, isEffectResult, deepEqual, isPlainSerializable,
  EFFECT_KINDS,
} from "./effects.js";

export function runEffectsTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const cards = Object.values(DEFAULT_CARDS);
  const personaAndSpecial = cards.filter(c => c.type === CARD_TYPES.PERSONA || c.type === CARD_TYPES.SPECIAL);
  const assistants = cards.filter(c => c.type === CARD_TYPES.ASSISTANT && c.effect != null);

  const baseCtx = {
    state: null,
    playerId: "A",
    constructedBuildingCount: 2,
    player: { coins: () => 4, resources: () => ({}), constructedBuildingCount: 2 },
  };

  // ── every persona & special card has a deterministic pure ability ──
  const specialCount = 12 + 12 + 12 + 15 + 1 + 6; // friend+item+guest+treasure+guidepost+companion
  ok("the content set ships 8 personas and " + specialCount + " special cards",
    personaAndSpecial.length === 8 + specialCount &&
    cards.filter(c => c.type === CARD_TYPES.PERSONA).length === 8 &&
    cards.filter(c => c.type === CARD_TYPES.SPECIAL).length === specialCount);
  ok("every persona and special card carries an ability function",
    personaAndSpecial.every(c => typeof c.ability === "function"));
  ok("each special subtype from the box catalog is present",
    Object.values(SPECIAL_SUBTYPES).every(st =>
      cards.some(c => c.type === CARD_TYPES.SPECIAL && c.subtype === st)));

  let allDeterministic = true;
  let allPlain = true;
  let allValid = true;
  for (const c of personaAndSpecial) {
    const r1 = resolveAbility(c, { ...baseCtx, seed: 1 });
    const r2 = resolveAbility(c, { ...baseCtx, seed: 42 });
    if (!r1 || !r1.ok || !isEffectResult(r1.result)) allValid = false;
    if (!r1 || !r2 || !deepEqual(r1.result, r2.result)) allDeterministic = false;
    if (!r1 || !isPlainSerializable(r1.result)) allPlain = false;
  }
  ok("every persona/special effect is deterministic given a state+seed", allDeterministic);
  ok("every persona/special ability resolves to a valid, known effect kind", allValid);
  ok("every persona/special effect result is plain JSON data (log/campaign-safe)", allPlain);

  // ── state-aware (contextual) abilities remain pure functions of the state ──
  const rich = { ...baseCtx, player: { coins: () => 9, resources: () => ({}), constructedBuildingCount: 5 } };
  const poor = { ...baseCtx, player: { coins: () => 1, resources: () => ({}), constructedBuildingCount: 2 } };
  ok("spc-friend-4 scales with the player's coins (2 wood at 3+ coins)",
    deepEqual(resolveAbility(DEFAULT_CARDS["spc-friend-4"], rich).result, effects.items({ wood: 2, clay: 1 })) &&
    deepEqual(resolveAbility(DEFAULT_CARDS["spc-friend-4"], poor).result, effects.items({ wood: 1, clay: 1 })));
  ok("spc-treasure-13 scales its end-game VP with constructed buildings",
    resolveAbility(DEFAULT_CARDS["spc-treasure-13"], rich).result.vp === 5 &&
    resolveAbility(DEFAULT_CARDS["spc-treasure-13"], poor).result.vp === 3);
  ok("the same state + different seeds always yields the same result for contextual abilities",
    deepEqual(
      resolveAbility(DEFAULT_CARDS["spc-friend-4"], { ...rich, seed: 1 }).result,
      resolveAbility(DEFAULT_CARDS["spc-friend-4"], { ...rich, seed: 99 }).result));

  // ── persona effects transcribe as executable data ──
  ok("persona-1 (Founder) grants an extra starting coin via setup",
    deepEqual(resolveAbility(DEFAULT_CARDS["persona-1"], baseCtx).result, effects.setup({ coins: 1 })));
  ok("persona-2 (Foreman) grants a free use of an owned building",
    deepEqual(resolveAbility(DEFAULT_CARDS["persona-2"], baseCtx).result, effects.freeOwnedBuildingUse()));
  ok("persona-8 (Alchemist) trades 2 coins for any 1 resource",
    deepEqual(resolveAbility(DEFAULT_CARDS["persona-8"], baseCtx).result, effects.trade({ coins: 2 }, { any: 1 })));
  const personaKinds = Array.from({ length: 8 }, (_, i) =>
    resolveAbility(DEFAULT_CARDS["persona-" + (i + 1)], baseCtx).result.kind);
  ok("the 8 personas cover 8 distinct effect kinds", new Set(personaKinds).size === 8);

  // ── assistant effects are static, deterministic item grants ──
  const KNOWN_TRIGGERS = new Set(["place", "construct", "scoreObjective", "treasury", "market"]);
  ok("every assistant effect is a static trigger → items map",
    assistants.every(a => {
      const e = a.effect;
      return e && typeof e === "object" && !Array.isArray(e) &&
        deepEqual(JSON.parse(JSON.stringify(e)), e) &&
        Object.entries(e).every(([t, bonus]) =>
          KNOWN_TRIGGERS.has(t) && bonus && typeof bonus === "object" && !Array.isArray(bonus) &&
          Object.values(bonus).every(n => Number.isInteger(n) && n >= 0));
    }));

  // ── the effect vocabulary is closed and covers the campaign's needs ──
  const kindsUsed = new Set(personaAndSpecial.map(c => resolveAbility(c, baseCtx).result.kind));
  ok("persona/special effects only use the known effect vocabulary",
    [...kindsUsed].every(k => EFFECT_KINDS.includes(k)));
  ok("the vocabulary spans setup, trade, free use, gain-card, income, reputation, items, VP, end-game VP, retrieve, guidepost",
    ["setup", "trade", "freeOwnedBuildingUse", "gainCard", "reputation", "income", "items", "vp", "endGameVp", "retrieveWorkers", "guidepost"]
      .every(k => kindsUsed.has(k)));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "effects", pass, fail, results };
}
