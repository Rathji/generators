// Alpha card continuous / static effects — declared in a local data model (roadmap
// Phase 7, task 24). A continuous effect modifies characteristics (power/toughness,
// keywords) or game rules (mana production) for as long as its source is on the
// battlefield, re-evaluated whenever the relevant objects change (entered/left
// battlefield, gained/lost type, controller change). The five-realms-plugin has no
// notion of *global* static effects: its frPower/frToughness fold only exact-target
// layer-7 effect entries in state.effects (frEffectsFor matches by targetId), created by
// resolving pumps/auras. The local runtime in src/game/continuous.js bridges that gap by
// syncing every active global pump into state.effects as per-target entries (marked
// global:true) on every state change, so the plugin's own combat/SBA math sees the buffs;
// keyword grants and mana bonuses ride on the same declarations but live outside the
// plugin's effect list (see grantedKeywords / bonusForLandTap).
//
// Declaration shape (attached to a projection record as rec.continuous = [...]):
//   { layer: "powerToughness" | "mana",
//     power, toughness,          // layer powerToughness: the P/T modifier (+N/+N)
//     keywords: [],              // granted keywords (query overlay, not plugin-visible)
//     filter: { colors?, types?, subtypes? },  // target must match ALL listed criteria
//     controller: "self",        // target must be controlled by the source's controller
//     exclude: "self",           // exclude the source itself ("Other Merfolk get ...")
//     condition: (obj, card) => bool }   // extra predicate on the TARGET (e.g. Castle)
// Filters read the TARGET's own card definition (types/subtypes/colors).
//
// Coverage: the Alpha static effects that cleanly fit this model. Crusade and Bad Moon
// are global colour pumps; Lord of Atlantis and Goblin King are type pumps that also
// grant landwalk ("have islandwalk"/"mountainwalk") and exclude themselves ("Other"); 
// Castle is a conditional pump (only untapped creatures its controller controls); Mana
// Flare is a rule modifier (each land tapped for mana produces one extra mana). Not
// modelled: Gaea's Liege's type-changing clause ("all Forests you control are 1/1 green
// creatures that are still lands") — a layer-4 type change, deferred with the land/
// combat tasks — and the pure keyword grants with no P/T change (there are no such Alpha
// cards; the framework supports them via a synthetic test card, see continuous.test.js).

// ── Alpha continuous effects ───────────────────────────────────────────────────────────
const CONTINUOUS_EFFECTS = {
  "Crusade": [
    { layer: "powerToughness", power: 1, toughness: 1, filter: { colors: ["W"], types: ["Creature"] } },
  ],
  "Bad Moon": [
    { layer: "powerToughness", power: 1, toughness: 1, filter: { colors: ["B"], types: ["Creature"] } },
  ],
  "Lord of Atlantis": [
    { layer: "powerToughness", power: 1, toughness: 1, keywords: ["islandwalk"],
      filter: { types: ["Creature"], subtypes: ["Merfolk"] }, exclude: "self" },
  ],
  "Goblin King": [
    { layer: "powerToughness", power: 1, toughness: 1, keywords: ["mountainwalk"],
      filter: { types: ["Creature"], subtypes: ["Goblin"] }, exclude: "self" },
  ],
  "Castle": [
    { layer: "powerToughness", power: 0, toughness: 2, filter: { types: ["Creature"] },
      controller: "self", condition: (obj) => !obj.tapped },
  ],
  "Mana Flare": [
    { layer: "mana", filter: { types: ["Land"] } },
  ],
};

export function alphaContinuous(name) {
  return CONTINUOUS_EFFECTS[name] || null;
}

// attachContinuous(rec) -> rec with continuous attached (in place). Same contract as
// effects.js's attachEffects / triggers.js's attachTriggers: called on a clone, never on
// the shared projection records (so PLUGIN_CARD_MAP and its integrity checks stay pure).
export function attachContinuous(rec) {
  if (!rec || typeof rec.name !== "string") return rec;
  const ce = alphaContinuous(rec.name);
  if (ce) rec.continuous = ce;
  return rec;
}
