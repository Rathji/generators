// Alpha activated abilities (roadmap Phase 8, task 25), declared in the
// five-realms-plugin card.abilities model so the engine itself validates costs, enforces
// summoning sickness on {T} abilities, offers them in legalActions, and resolves their
// effects through the same template library as spells. Each entry:
//   { name, cost, targeting, effects, timing }
//   cost      = { tap?: bool, mana?: "{R}"-style cost string, life?: number,
//                sacrificeSelf?: bool } — paid by frActionActivateAbility.
//   targeting = the plugin-subset shape ({ min, max, slots }) using ONLY the slot fields
//               frSlotTargetLegal understands (player / spell / permanent / types /
//               toughnessLE). The rich Alpha filters (tapped, colors, subtypes, notTypes,
//               owner, powerLE, ...) stay on card.abilityTargeting (src/cards/targeting.js,
//               task 21) and are enforced by the local validator in src/game/abilities.js —
//               validateAbilityActivation runs before the plugin, exactly like cast.js's
//               validateCast — because the plugin's slot checker cannot express them.
//   effects   = template ops from the shared library (damage / life / draw / discard /
//               destroy / pump / tap / untap / shield / scry / addMana / token / counter /
//               tutor / regenerate) — the same engine as spells and triggers. "regenerate"
//               is a LOCAL op: the plugin has no regeneration template (its frApplyOneEffect
//               ignores it), so src/game/regenerate.js grants and honours the shield on
//               resolution.
//   timing    = optional activation window, enforced locally (abilities are instant-speed
//               by default): "yourTurn" / "opponentTurn" / "upkeep" / "combat" / "sorcery".
//
// Covered: every Alpha activated ability whose cost + targeting + effect fit the current
// engine — tap-to-damage (Prodigal Sorcerer, Pirate Ship, Rod of Ruin), tap-to-destroy
// (Royal Assassin, Northern Paladin, Dwarven Demolition Team, Demonic Hordes),
// tap-to-untap / tap-to-tap (Ley Druid, Icy Manipulator), mana-cost pump (Granite
// Gargoyle), mana-cost discard (Disrupting Scepter), self-damage (Orcish Artillery),
// damage prevention (Samite Healer), and regeneration (Drudge Skeletons). Deferred to
// their own tasks: keyword-granting pumps (Goblin Balloon Brigade — task 39's keyword
// work), X-cost / counter / token abilities (Clockwork Beast, Rock Hydra — tasks 34/48),
// mana abilities producing more than one mana or a choice (Basalt Monolith, Black Lotus,
// Jade Statue — task 42), and control / type-change / copy abilities (Vesuvan
// Doppelganger, Nettling Imp — task 44).

// Any-target shape the plugin expresses natively: a player index or a battlefield
// creature (the plugin's frSlotTargetLegal: numbers need slot.player, objects need types).
const ANY_TARGET = { min: 1, max: 1, slots: [{ player: true, types: ["Creature"] }] };

// ────────────────────────────────────────────────────────────────────────────────────────
// The declaration table: card name -> [ability, ...].
// Ability names deliberately match card.abilityTargeting (src/cards/targeting.js) so the
// resolve-time targeting lookup (resolve.js targetingForResolving) and the local validator
// find the rich spec by name.
// ────────────────────────────────────────────────────────────────────────────────────────
const ALPHA_ABILITIES = {
  // ── White ────────────────────────────────────────────────────────────────────────────
  // "{T}: Prevent the next 1 damage that would be dealt to any target this turn."
  "Samite Healer": [{
    name: "guard", cost: { tap: true }, targeting: ANY_TARGET,
    effects: [{ op: "shield", amount: 1, targets: [0] }],
  }],
  // "{W}{W}, {T}: Destroy target black permanent." (black filter is local-only)
  "Northern Paladin": [{
    name: "smite", cost: { tap: true, mana: "{W}{W}" },
    targeting: { min: 1, max: 1, slots: [{ permanent: true }] },
    effects: [{ op: "destroy", targets: [0] }],
  }],

  // ── Blue ─────────────────────────────────────────────────────────────────────────────
  // "{T}: This creature deals 1 damage to any target."
  "Prodigal Sorcerer": [{
    name: "zap", cost: { tap: true }, targeting: ANY_TARGET,
    effects: [{ op: "damage", amount: 1, targets: [0] }],
  }],
  "Pirate Ship": [{
    name: "broadside", cost: { tap: true }, targeting: ANY_TARGET,
    effects: [{ op: "damage", amount: 1, targets: [0] }],
  }],

  // ── Black ────────────────────────────────────────────────────────────────────────────
  // "{B}: Regenerate this creature." (local op — see header)
  "Drudge Skeletons": [{
    name: "regenerate", cost: { mana: "{B}" },
    effects: [{ op: "regenerate", targets: ["self"] }],
  }],
  // "{T}: Destroy target tapped creature." (tapped filter is local-only)
  "Royal Assassin": [{
    name: "murder", cost: { tap: true },
    targeting: { min: 1, max: 1, slots: [{ types: ["Creature"] }] },
    effects: [{ op: "destroy", targets: [0] }],
  }],
  // "{T}: Destroy target land."
  "Demonic Hordes": [{
    name: "ravage", cost: { tap: true },
    targeting: { min: 1, max: 1, slots: [{ types: ["Land"] }] },
    effects: [{ op: "destroy", targets: [0] }],
  }],

  // ── Red ──────────────────────────────────────────────────────────────────────────────
  // "{T}: Destroy target Wall." (Wall filter is local-only)
  "Dwarven Demolition Team": [{
    name: "demolish", cost: { tap: true },
    targeting: { min: 1, max: 1, slots: [{ types: ["Creature"] }] },
    effects: [{ op: "destroy", targets: [0] }],
  }],
  // "{R}: This creature gets +0/+1 until end of turn."
  "Granite Gargoyle": [{
    name: "fortify", cost: { mana: "{R}" },
    effects: [{ op: "pump", power: 0, toughness: 1, targets: ["self"] }],
  }],
  // "{T}: This creature deals 2 damage to any target and 3 damage to you."
  "Orcish Artillery": [{
    name: "bombard", cost: { tap: true }, targeting: ANY_TARGET,
    effects: [
      { op: "damage", amount: 2, targets: [0] },
      { op: "damage", amount: 3, targets: ["controller"] },
    ],
  }],

  // ── Green ────────────────────────────────────────────────────────────────────────────
  // "{T}: Untap target land."
  "Ley Druid": [{
    name: "untap", cost: { tap: true },
    targeting: { min: 1, max: 1, slots: [{ types: ["Land"] }] },
    effects: [{ op: "untap", targets: [0] }],
  }],

  // ── Artifacts ────────────────────────────────────────────────────────────────────────
  // "{3}, {T}: Target player discards a card. Activate only during your turn."
  "Disrupting Scepter": [{
    name: "coerce", cost: { tap: true, mana: "{3}" }, timing: "yourTurn",
    targeting: { min: 1, max: 1, slots: [{ player: true }] },
    effects: [{ op: "discard", amount: 1, targets: [0] }],
  }],
  // "{1}, {T}: Tap target artifact, creature, or land."
  "Icy Manipulator": [{
    name: "freeze", cost: { tap: true, mana: "{1}" },
    targeting: { min: 1, max: 1, slots: [{ types: ["Artifact", "Creature", "Land"] }] },
    effects: [{ op: "tap", targets: [0] }],
  }],
  // "{3}, {T}: This artifact deals 1 damage to any target."
  "Rod of Ruin": [{
    name: "zap", cost: { tap: true, mana: "{3}" }, targeting: ANY_TARGET,
    effects: [{ op: "damage", amount: 1, targets: [0] }],
  }],
};

// ────────────────────────────────────────────────────────────────────────────────────────
// attachAbilities(rec) -> the same record with rec.abilities spliced on when the card has
// any (mutates and returns rec; the db layer clones the pristine projection first).
// ────────────────────────────────────────────────────────────────────────────────────────
export function attachAbilities(rec) {
  const list = ALPHA_ABILITIES[rec.name];
  if (list) rec.abilities = list.map((a) => Object.assign({}, a));
  return rec;
}

export function alphaAbilities(name) {
  const list = ALPHA_ABILITIES[name];
  return list ? list.map((a) => Object.assign({}, a)) : null;
}
