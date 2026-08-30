// Five Realms — activated-ability local layer (roadmap Phase 8, task 25).
// The five-realms-plugin natively validates and resolves card.abilities (declared in
// src/cards/abilities.js): priority, tap/sickness on {T} costs, mana/life/sacrifice
// costs, a targeting subset (player / spell / types / toughnessLE), then pushes a
// { kind:"ability" } stack entry that resolves through the shared template library.
// This module adds the checks the plugin CANNOT express, mirroring how cast.js layers
// local validation over the plugin's own:
//   • validateAbilityActivation(game, action) — the rich Alpha targeting filters
//     (tapped, colors, subtypes, notTypes, owner, powerLE, ... — declared in
//     src/cards/targeting.js card.abilityTargeting, task 21) via target.targetSetLegal,
//     plus the declaration's activation `timing` window. Hooked into turn.doAction so
//     every activation is gated the same way a cast is gated by validateCast.
//   • activateAbility(game, action) — validate-then-act convenience for tests / UI.
//
// Plugin gaps documented here: (1) legalActions skips TAPPED permanents entirely, so a
// tapped creature's non-tap ability (e.g. Granite Gargoyle's {R} pump after blocking)
// isn't offered by the plugin's enumeration even though the reducer accepts it — the
// local layer validates/accepts it correctly, and callers wanting the full menu use
// target.legalTargetSets. (2) legalActions enumerates the targeting SUBSET, so rich
// filters (Royal Assassin vs untapped creatures) still appear there; the local validator
// rejects them. (3) frTargetSetLegalForTargeting checks no "protections" — the local
// target layer does (slotTargetLegal consults card.protections).

import * as target from "./target.js";
import * as turn from "./turn.js";

const TIMING_STEPS = {
  upkeep: ["upkeep"],
  combat: ["begin_combat", "declare_attackers", "declare_blockers", "combat_damage", "end_combat"],
  sorcery: ["precombat_main", "postcombat_main"],
};

// timingLegal(ability, raw, player) -> null | reason. Abilities without a `timing`
// declaration are instant-speed (legal whenever the controller holds priority).
function timingLegal(ability, raw, player) {
  const t = ability.timing;
  if (!t) return null;
  if (t === "yourTurn" && raw.activePlayer !== player) return "activate only during your turn";
  if (t === "opponentTurn" && raw.activePlayer === player) return "activate only during an opponent's turn";
  const steps = TIMING_STEPS[t];
  if (steps) {
    if (raw.activePlayer !== player) return "activate only during your turn";
    if (steps.indexOf(raw.step) === -1) return "activate only during your " + t;
  }
  return null;
}

// validateAbilityActivation(game, action) -> null when the activation is legal, else a
// reason string. Only meaningful for { type:"activateAbility", abilityName } actions
// (mana-ability taps have no abilityName and are handled by mana.js / continuous.js).
export function validateAbilityActivation(game, action) {
  if (!action || action.type !== "activateAbility" || !action.abilityName) return null;
  const raw = game.raw;
  const objId = action.objectId;
  const obj = objId != null ? raw.objects[objId] : null;
  if (!obj || obj.zone !== "battlefield" || obj.controller !== action.player) {
    return "object is not a permanent you control";
  }
  const card = target.cardDefFor(game, obj.cardId);
  if (!card || !Array.isArray(card.abilities)) return "no known activated abilities on this permanent";
  let ability = null;
  for (const a of card.abilities) {
    if (a && a.name === action.abilityName) { ability = a; break; }
  }
  if (!ability) return "unknown ability: " + action.abilityName;
  const tErr = timingLegal(ability, raw, action.player);
  if (tErr) return tErr;
  // Rich targeting: validate against the full Alpha spec (card.abilityTargeting) even
  // though the plugin only checks its subset. No rich spec -> the plugin's own validation
  // (and its "takes no targets" rejection) stands.
  const rich = target.abilityTargetingFor(game, obj.cardId, action.abilityName);
  if (rich) {
    const v = target.targetSetLegal(game, rich, action.targets || [], action.player);
    if (!v.ok) return v.reason;
  }
  return null;
}

// activateAbility(game, action) -> validate-then-run through turn.doAction (which throws
// on any rejection). Returns the resulting raw state.
export function activateAbility(game, action) {
  const err = validateAbilityActivation(game, action);
  if (err) throw new Error("action rejected: " + err);
  return turn.doAction(game, action);
}
