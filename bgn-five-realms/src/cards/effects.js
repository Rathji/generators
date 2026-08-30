// Alpha card effects — declared in the five-realms-plugin effect-template language
// (roadmap Phase 6, task 22: spell resolution & fizzle). The plugin's engine already
// executes effects at resolution: a resolving instant/sorcery reads card.effects (or the
// chosen mode's effects), and the template library (op: damage/damageAll/life/draw/
// discard/destroy/pump/tap/untap/shield/scry/addMana/token/counter/tutor) substitutes X
// and the chosen targets. This module is that *declaration* layer for Alpha spells: a
// representative set of instants/sorceries (plus aura buffs), keyed by card name exactly
// like src/cards/targeting.js, attached to the plugin-projection records by
// attachEffects() (used by src/cards/db.js when the 295-card DB is injected into the
// engine). Effects that the plugin's template library can't express yet are simply left
// undeclared (card resolves with no effect) and are noted below — the damage/life/
// continuous-effect frameworks (tasks 31-33) will widen coverage.
//
// Conventions for correctness with fizzle (see src/game/resolve.js):
//   • Targeted spells reference ONLY indexed targets ([0], [1], ...). A fizzle empties
//     the entry's targets, so an effect with no index refs resolves to nothing — but an
//     effect refs "controller"/"opponent" would still fire, which would be wrong for a
//     fizzled spell. (Psionic Blast's "you lose 2" is unconditional in Alpha, so it
//     references "controller" deliberately.)
//   • amount: "X" substitutes the entry's chosen x.
// Documented simplifications vs. 1993 Alpha:
//   • Fireball: X damage to EACH chosen target, not divided evenly.
//   • Swords to Plowshares: destroy (graveyard) instead of exile; no life gain.
//   • Ancestral Recall: draws 3 for its controller (the plugin's draw op is
//     controller-only, so targeting an opponent doesn't make them draw).
//   • Hymn to Tourach / Mind Twist: discard from the top of the hand, not at random.
//   • Healing Salve "prevent the next 3 damage": a plain 3-point prevention shield.

// ── instant / sorcery effects ──────────────────────────────────────────────────────────
const SPELL_EFFECTS = {
  // White
  "Disenchant": [{ op: "destroy", targets: [0] }],
  "Swords to Plowshares": [{ op: "destroy", targets: [0] }],
  // Blue
  "Ancestral Recall": [{ op: "draw", amount: 3, player: "controller" }],
  "Counterspell": [{ op: "counter", targets: [0] }],
  "Psionic Blast": [
    { op: "damage", targets: [0], amount: 4 },
    { op: "life", targets: ["controller"], amount: 2 },
  ],
  // Black
  "Dark Ritual": [{ op: "addMana", mana: { B: 3 } }],
  "Hymn to Tourach": [{ op: "discard", amount: 2, targets: [0] }],
  "Mind Twist": [{ op: "discard", amount: "X", targets: [0] }],
  "Terror": [{ op: "destroy", targets: [0] }],
  // Red
  "Fireball": [{ op: "damage", targets: [0, 1], amount: "X" }],
  "Lightning Bolt": [{ op: "damage", targets: [0], amount: 3 }],
  "Stone Rain": [{ op: "destroy", targets: [0] }],
  // Green
  "Giant Growth": [{ op: "pump", targets: [0], power: 3, toughness: 3, untilEot: true }],
  "Stream of Life": [{ op: "life", targets: [0], amount: "X", gain: true }],
};

// ── modal spell effects (attach to the matching mode already declared in targeting.js) ─
const MODE_EFFECTS = {
  "Healing Salve": [
    { name: "life-gain", effects: [{ op: "life", targets: [0], amount: 3, gain: true }] },
    { name: "damage-prevention", effects: [{ op: "shield", targets: [0], amount: 3, untilEot: true }] },
  ],
  "Blue Elemental Blast": [
    { name: "counter", effects: [{ op: "counter", targets: [0] }] },
    { name: "destroy", effects: [{ op: "destroy", targets: [0] }] },
  ],
  "Red Elemental Blast": [
    { name: "counter", effects: [{ op: "counter", targets: [0] }] },
    { name: "destroy", effects: [{ op: "destroy", targets: [0] }] },
  ],
};

// ── Aura buffs (the plugin attaches the aura and applies the buff on resolution) ───────
const AURA_BUFFS = {
  "Holy Strength": { power: 1, toughness: 2 },
  "Unholy Strength": { power: 2, toughness: 1 },
};

export function alphaEffects(name) {
  return SPELL_EFFECTS[name] || null;
}

export function alphaModeEffects(name) {
  return MODE_EFFECTS[name] || null;
}

export function alphaAuraBuff(name) {
  return AURA_BUFFS[name] || null;
}

// attachEffects(rec) -> rec with effects/auraBuff attached (in place). Used by
// src/cards/db.js on a clone of each projection record so the shared PLUGIN_CARD_MAP
// records and their integrity checks stay untouched.
export function attachEffects(rec) {
  if (!rec || typeof rec.name !== "string") return rec;
  const fx = alphaEffects(rec.name);
  if (fx) rec.effects = fx;
  const modes = alphaModeEffects(rec.name);
  if (modes) {
    if (!Array.isArray(rec.modes)) rec.modes = [];
    for (const m of modes) {
      const existing = rec.modes.find((r) => r && r.name === m.name);
      if (existing) existing.effects = m.effects;
      else rec.modes.push({ name: m.name, effects: m.effects });
    }
  }
  const ab = alphaAuraBuff(rec.name);
  if (ab) rec.auraBuff = ab;
  return rec;
}
