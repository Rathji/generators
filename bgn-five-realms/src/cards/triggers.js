// Alpha card triggered abilities — declared in the five-realms-plugin's card.triggers
// data model (roadmap Phase 7, task 23). The plugin already *fires* the conditions it
// knows natively — "enter" (frTriggersOnEnter), "attack" (frTriggersOnDeclareAttack)
// and "combatDamageToPlayer" (frTriggersOnCombatDamageToPlayer) — resolving them
// immediately at the event (the classic Alpha default). This module is the declaration
// layer that attaches a representative set of Alpha triggers to the plugin projection
// records; the conditions the plugin does NOT fire natively — "upkeep", "death",
// "creatureDies", "landDies", "draw" — are implemented by the local trigger runtime in
// src/game/triggers.js, which reads these same card.triggers entries.
//
// Trigger entry shape (matches the plugin's format, plus two local-only fields):
//   { when, firesFor?, player?, filter?, effects }
//   • when      — "upkeep" | "death" | "creatureDies" | "landDies" | "draw"
//                 (local runtime) | "enter" | "attack" | "combatDamageToPlayer"
//                 (plugin runtime).
//   • firesFor  — upkeep only: "controller" (default — fires in the controller's own
//                 upkeep) or "each" (fires in every player's upkeep).
//   • player    — draw only: "opponent" (fires when an opponent draws) | "controller" |
//                 "each" (default — any draw).
//   • filter    — creatureDies/landDies: { colors?: [], types?: [] } restricting the
//                 dying permanent (Sengir Vampire simplifies to "any creature dies").
//   • effects   — ops from the plugin's template library (damage/life/draw/discard/
//                 destroy/pump/counter/tap/untap/addMana/scry/token/sacrifice), with
//                 target refs resolved by the local runtime: "self", "controller",
//                 "opponent", "owner", plus the event refs "activePlayer"
//                 (upkeep), "drawingPlayer" (draw) and "diedController" (death).
// Attached by attachTriggers() — used by src/cards/db.js on a clone of each projection
// record, so the shared PLUGIN_CARD_MAP records and their integrity checks stay
// untouched (same pattern as effects.js).
//
// Coverage note: Alpha's full trigger suite is large and most entries are conditional
// (pay-or-sacrifice upkeep upkeep: Conversion/Phantasmal Forces/Lord of the Pit/Stasis/
// Demonic Hordes/Force of Nature; hand-size damage: Black Vise/The Rack; board-count
// damage: Karma/Power Surge; optional-pay death: Soul Net/Throne of Bone/Wooden Sphere;
// tapped-land triggers: Psychic Venom/Kudzu/Lifetap/Manabarbs; spell-cast triggers:
// Crystal Rod/Iron Star/Ivory Cup/Verduran Enchantress; enter-as-copy: Vesuvan
// Doppelganger; graveyard upkeep: Nether Shadow). These wait on the cost/choice and
// continuous-effect frameworks (tasks 24-26); the entries here are the ones that are
// cleanly modelable with plain effect templates today.

// ── Alpha triggered abilities ─────────────────────────────────────────────────────────
const ALPHA_TRIGGERS = {
  "Copper Tablet": [{
    when: "upkeep",
    firesFor: "each",
    effects: [{ op: "damage", targets: ["activePlayer"], amount: 1 }],
  }],
  "Sengir Vampire": [{
    // Simplified: the original reads "a creature dealt damage by this creature this turn
    // dies" — tracking which creatures it damaged this turn is deferred; any creature
    // death grows the vampire.
    when: "creatureDies",
    effects: [{ op: "pump", targets: ["self"], power: 1, toughness: 1, counters: true }],
  }],
  "Dingus Egg": [{
    when: "landDies",
    effects: [{ op: "damage", targets: ["diedController"], amount: 2 }],
  }],
};

export function alphaTriggers(name) {
  return ALPHA_TRIGGERS[name] || null;
}

// attachTriggers(rec) -> rec with triggers attached (in place). Same contract as
// effects.js's attachEffects: called on a clone, never on the shared projection.
export function attachTriggers(rec) {
  if (!rec || typeof rec.name !== "string") return rec;
  const tr = alphaTriggers(rec.name);
  if (tr) rec.triggers = tr;
  return rec;
}
