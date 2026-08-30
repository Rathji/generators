// Alpha targeting declarations (roadmap Phase 6, task 21). For every Alpha spell, Aura
// and activated ability that targets, this module declares a targeting spec in the
// five-realms-plugin shape ({ min, max, distinct, slots }), extended with the local
// filters Alpha needs that the plugin's slot model doesn't express:
//   slot = {
//     player: true,            // target is a player (index)
//     opponent: true,          // ...and must be a player other than the caster
//     spell: true,             // target is a spell on the stack
//     spellColors: ["R"],      // spell target must be that color ("target red spell")
//     spellTypes: [...],       // spell target must be one of these types (Fork)
//     permanent: true,         // any permanent on the battlefield
//     types: [...],            // OR-match on card types (Creature, Artifact|Enchantment...)
//     notTypes: [...],         // card must not have any of these types (nonartifact)
//     subtypes: [...],         // OR-match on subtypes (Mountain, Wall)
//     notSubtypes: [...],      // card must not have any of these subtypes (non-Wall)
//     colors: [...],           // OR-match on the card's colors (target red permanent)
//     notColors: [...],        // card must not have any of these colors (nonblack)
//     toughnessLE: n, powerLE: n,
//     zone: "graveyard",       // target is a card in a graveyard (else battlefield)
//     owner: "self"|playerIdx, // only cards controlled by (or, in a graveyard, owned by)
//                              //   that player -- "self" = the caster
//     tapped: true,            // permanent must be tapped (Royal Assassin)
//   }
//   targeting = { min, max, distinct, slots: [slot, ...] }  (slots repeat the last for
//   multi-target spells; `max` may be "X" for Fireball/Volcanic Eruption style)
//
// The projection (cards/plugin.js) attaches these as card.targeting (spells/Auras cast
// as a targeted spell), card.modes (modal "Choose one" cards -- targeting per mode, no
// effects here; those arrive with the modes task), card.abilityTargeting (activated
// abilities that target -- the abilities framework task adds their costs/effects), and
// card.protections (innate "Protection from {color}" for the target-legality check).
// The query layer in src/game/target.js consumes them. Names here match the Alpha data
// records (cards/data/alpha.js) exactly.

// ────────────────────────────────────────────────────────────────────────────────────────
// The declaration table: card name -> targeting spec (spells/Auras).
// ────────────────────────────────────────────────────────────────────────────────────────
const ANY_TARGET = { min: 1, max: 1, slots: [{ player: true, types: ["Creature"] }] };
const TARGET_CREATURE = { min: 1, max: 1, slots: [{ types: ["Creature"] }] };
const TARGET_PLAYER = { min: 1, max: 1, slots: [{ player: true }] };
const TARGET_SPELL = { min: 1, max: 1, slots: [{ spell: true }] };
const TARGET_SPELL_OR_PERMANENT = { min: 1, max: 1, slots: [{ spell: true, permanent: true }] };
const TARGET_LAND = { min: 1, max: 1, slots: [{ types: ["Land"] }] };
const TARGET_ARTIFACT = { min: 1, max: 1, slots: [{ types: ["Artifact"] }] };
const ENCHANT_CREATURE = TARGET_CREATURE;
const ENCHANT_LAND = TARGET_LAND;
const ENCHANT_ARTIFACT = TARGET_ARTIFACT;
const ENCHANT_ENCHANTMENT = { min: 1, max: 1, slots: [{ types: ["Enchantment"] }] };

const SPELL_TARGETING = {
  // ── White ────────────────────────────────────────────────────────────────────────────
  "Blaze of Glory": TARGET_CREATURE, // "target creature defending player controls" (combat restriction)
  "Death Ward": TARGET_CREATURE,
  "Disenchant": { min: 1, max: 1, slots: [{ types: ["Artifact", "Enchantment"] }] },
  "Guardian Angel": ANY_TARGET,
  "Healing Salve": {
    modes: [
      { name: "life-gain", targeting: TARGET_PLAYER },
      { name: "damage-prevention", targeting: ANY_TARGET },
    ],
  },
  "Purelace": TARGET_SPELL_OR_PERMANENT,
  "Resurrection": { min: 1, max: 1, slots: [{ zone: "graveyard", types: ["Creature"], owner: "self" }] },
  "Righteousness": TARGET_CREATURE, // "target blocking creature" (combat restriction)
  "Swords to Plowshares": TARGET_CREATURE,
  "Black Ward": ENCHANT_CREATURE,
  "Blue Ward": ENCHANT_CREATURE,
  "Green Ward": ENCHANT_CREATURE,
  "Red Ward": ENCHANT_CREATURE,
  "White Ward": ENCHANT_CREATURE,
  "Animate Wall": { min: 1, max: 1, slots: [{ types: ["Creature"], subtypes: ["Wall"] }] }, // "Enchant Wall"
  "Blessing": ENCHANT_CREATURE,
  "Consecrate Land": ENCHANT_LAND,
  "Farmstead": ENCHANT_LAND,
  "Holy Armor": ENCHANT_CREATURE,
  "Holy Strength": ENCHANT_CREATURE,
  "Lance": ENCHANT_CREATURE,

  // ── Blue ─────────────────────────────────────────────────────────────────────────────
  "Ancestral Recall": TARGET_PLAYER,
  "Animate Artifact": ENCHANT_ARTIFACT,
  "Blue Elemental Blast": {
    modes: [
      { name: "counter", targeting: { min: 1, max: 1, slots: [{ spell: true, spellColors: ["R"] }] } },
      { name: "destroy", targeting: { min: 1, max: 1, slots: [{ permanent: true, colors: ["R"] }] } },
    ],
  },
  "Braingeyser": TARGET_PLAYER,
  "Control Magic": ENCHANT_CREATURE,
  "Counterspell": TARGET_SPELL,
  "Creature Bond": ENCHANT_CREATURE,
  "Drain Power": TARGET_PLAYER,
  "Feedback": ENCHANT_ENCHANTMENT,
  "Flight": ENCHANT_CREATURE,
  "Fork": { min: 1, max: 1, slots: [{ spell: true, spellTypes: ["Instant", "Sorcery"] }] },
  "Invisibility": ENCHANT_CREATURE,
  "Jump": TARGET_CREATURE,
  "Magical Hack": TARGET_SPELL_OR_PERMANENT,
  "Mana Short": TARGET_PLAYER,
  "Phantasmal Terrain": ENCHANT_LAND,
  "Power Leak": ENCHANT_ENCHANTMENT,
  "Power Sink": TARGET_SPELL,
  "Psionic Blast": ANY_TARGET,
  "Psychic Venom": ENCHANT_LAND,
  "Sleight of Mind": TARGET_SPELL_OR_PERMANENT,
  "Spell Blast": TARGET_SPELL, // "with mana value X" (X-dependent CMC filter, not modeled)
  "Steal Artifact": ENCHANT_ARTIFACT,
  "Thoughtlace": TARGET_SPELL_OR_PERMANENT,
  "Twiddle": { min: 1, max: 1, slots: [{ types: ["Artifact", "Creature", "Land"] }] },
  "Unsummon": TARGET_CREATURE,
  "Volcanic Eruption": {
    min: 1,
    max: "X",
    slots: [{ types: ["Land"], subtypes: ["Mountain"] }],
  },

  // ── Black ────────────────────────────────────────────────────────────────────────────
  "Animate Dead": { min: 1, max: 1, slots: [{ zone: "graveyard", types: ["Creature"] }] }, // any graveyard
  "Cursed Land": ENCHANT_LAND,
  "Deathlace": TARGET_SPELL_OR_PERMANENT,
  "Drain Life": ANY_TARGET,
  "Evil Presence": ENCHANT_LAND,
  "Fear": ENCHANT_CREATURE,
  "Howl from Beyond": TARGET_CREATURE,
  "Mind Twist": TARGET_PLAYER,
  "Paralyze": ENCHANT_CREATURE,
  "Raise Dead": { min: 1, max: 1, slots: [{ zone: "graveyard", types: ["Creature"], owner: "self" }] },
  "Simulacrum": { min: 1, max: 1, slots: [{ types: ["Creature"], owner: "self" }] },
  "Sinkhole": TARGET_LAND,
  "Terror": {
    min: 1,
    max: 1,
    slots: [{ types: ["Creature"], notTypes: ["Artifact"], notColors: ["B"] }],
  },
  "Unholy Strength": ENCHANT_CREATURE,
  "Warp Artifact": ENCHANT_ARTIFACT,
  "Weakness": ENCHANT_CREATURE,
  "Word of Command": { min: 1, max: 1, slots: [{ player: true, opponent: true }] },

  // ── Red ──────────────────────────────────────────────────────────────────────────────
  "Burrowing": ENCHANT_CREATURE,
  "Chaoslace": TARGET_SPELL_OR_PERMANENT,
  "Disintegrate": ANY_TARGET,
  "Earthbind": ENCHANT_CREATURE,
  "False Orders": TARGET_CREATURE, // "target creature defending player controls" (combat restriction)
  "Fireball": { min: 1, max: "X", slots: [{ player: true, types: ["Creature"] }] },
  "Firebreathing": ENCHANT_CREATURE,
  "Lightning Bolt": ANY_TARGET,
  "Red Elemental Blast": {
    modes: [
      { name: "counter", targeting: { min: 1, max: 1, slots: [{ spell: true, spellColors: ["U"] }] } },
      { name: "destroy", targeting: { min: 1, max: 1, slots: [{ permanent: true, colors: ["U"] }] } },
    ],
  },
  "Shatter": TARGET_ARTIFACT,
  "Stone Rain": TARGET_LAND,
  "Tunnel": { min: 1, max: 1, slots: [{ types: ["Creature"], subtypes: ["Wall"] }] },

  // ── Green ────────────────────────────────────────────────────────────────────────────
  "Aspect of Wolf": ENCHANT_CREATURE,
  "Berserk": TARGET_CREATURE,
  "Giant Growth": TARGET_CREATURE,
  "Ice Storm": TARGET_LAND,
  "Instill Energy": ENCHANT_CREATURE,
  "Kudzu": ENCHANT_LAND,
  "Lifelace": TARGET_SPELL_OR_PERMANENT,
  "Living Artifact": ENCHANT_ARTIFACT,
  "Lure": ENCHANT_CREATURE,
  "Natural Selection": TARGET_PLAYER,
  "Regeneration": ENCHANT_CREATURE,
  "Regrowth": { min: 1, max: 1, slots: [{ zone: "graveyard", owner: "self" }] },
  "Stream of Life": TARGET_PLAYER,
  "Wanderlust": ENCHANT_CREATURE,
  "Web": ENCHANT_CREATURE,
  "Wild Growth": ENCHANT_LAND,
};

// ────────────────────────────────────────────────────────────────────────────────────────
// Activated abilities that target: card name -> [{ name, targeting }].
// (Costs/effects arrive with the abilities-framework task; targeting is declared now so
// the target query covers abilities too.)
// ────────────────────────────────────────────────────────────────────────────────────────
const ABILITY_TARGETING = {
  "Samite Healer": [{ name: "guard", targeting: ANY_TARGET }],
  "Northern Paladin": [
    { name: "smite", targeting: { min: 1, max: 1, slots: [{ permanent: true, colors: ["B"] }] } },
  ],
  "Pirate Ship": [{ name: "broadside", targeting: ANY_TARGET }],
  "Prodigal Sorcerer": [{ name: "zap", targeting: ANY_TARGET }],
  "Vesuvan Doppelganger": [{ name: "copy", targeting: TARGET_CREATURE }],
  "Demonic Hordes": [{ name: "ravage", targeting: TARGET_LAND }],
  "Deathgrip": [
    { name: "counter-green", targeting: { min: 1, max: 1, slots: [{ spell: true, spellColors: ["G"] }] } },
  ],
  "Nettling Imp": [
    { name: "taunt", targeting: { min: 1, max: 1, slots: [{ types: ["Creature"], notSubtypes: ["Wall"] }] } },
  ],
  "Royal Assassin": [
    { name: "murder", targeting: { min: 1, max: 1, slots: [{ types: ["Creature"], tapped: true }] } },
  ],
  "Dwarven Demolition Team": [
    { name: "demolish", targeting: { min: 1, max: 1, slots: [{ types: ["Creature"], subtypes: ["Wall"] }] } },
  ],
  "Dwarven Warriors": [
    { name: "harry", targeting: { min: 1, max: 1, slots: [{ types: ["Creature"], powerLE: 2 }] } },
  ],
  "Orcish Artillery": [{ name: "bombard", targeting: ANY_TARGET }],
  "Stone Giant": [
    { name: "hurl", targeting: { min: 1, max: 1, slots: [{ types: ["Creature"], owner: "self" }] } },
  ],
  "Gaea's Liege": [{ name: "reshape", targeting: TARGET_LAND }],
  "Ley Druid": [{ name: "untap", targeting: TARGET_LAND }],
  "Lifeforce": [
    { name: "counter-black", targeting: { min: 1, max: 1, slots: [{ spell: true, spellColors: ["B"] }] } },
  ],
  "Cyclopean Tomb": [
    { name: "mire", targeting: { min: 1, max: 1, slots: [{ types: ["Land"], notSubtypes: ["Swamp"] }] } },
  ],
  "Disrupting Scepter": [{ name: "coerce", targeting: TARGET_PLAYER }],
  "Glasses of Urza": [{ name: "peer", targeting: TARGET_PLAYER }],
  "Helm of Chatzuk": [{ name: "banding", targeting: TARGET_CREATURE }],
  "Icy Manipulator": [
    { name: "freeze", targeting: { min: 1, max: 1, slots: [{ types: ["Artifact", "Creature", "Land"] }] } },
  ],
  "Jade Monolith": [{ name: "redirect", targeting: TARGET_CREATURE }],
  "Rod of Ruin": [{ name: "zap", targeting: ANY_TARGET }],
};

// ────────────────────────────────────────────────────────────────────────────────────────
// Innate "Protection from {color}" — the target-legality gate ("a protected card can't be
// targeted by anything of that color"). Wards that GRANT protection are continuous effects
// (a later task) and don't appear here.
// ────────────────────────────────────────────────────────────────────────────────────────
const PROTECTION_COLORS = { white: "W", blue: "U", black: "B", red: "R", green: "G" };

export function alphaProtections(rulesText) {
  const out = [];
  const t = String(rulesText || "");
  const re = /Protection from\s+(\w+)/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    const col = PROTECTION_COLORS[m[1].toLowerCase()];
    if (col && out.indexOf(col) === -1) out.push(col);
  }
  return out;
}

export function alphaTargeting(name) {
  const spec = SPELL_TARGETING[name];
  if (!spec) return null;
  return spec.modes ? { modes: spec.modes } : spec;
}

export function alphaAbilityTargeting(name) {
  const list = ABILITY_TARGETING[name];
  return list ? list.map((a) => ({ name: a.name, targeting: a.targeting })) : null;
}

// ────────────────────────────────────────────────────────────────────────────────────────
// Human-readable descriptions for the game log / UI.
// ────────────────────────────────────────────────────────────────────────────────────────
const TYPE_NAMES = { Creature: "creature", Enchantment: "enchantment", Artifact: "artifact", Land: "land" };
const COLOR_NAMES = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

export function describeSlot(slot) {
  const parts = [];
  if (slot.zone === "graveyard") {
    const typesPart = (Array.isArray(slot.types) && slot.types.length)
      ? slot.types.map((t) => TYPE_NAMES[t] || t).join(" or ") + " card"
      : "card";
    const ownerPart = slot.owner === "self" ? "your " : slot.owner === undefined ? "a " : "";
    parts.push(typesPart + " in " + ownerPart + "graveyard");
  } else if (slot.spell) {
    let s = "spell";
    if (Array.isArray(slot.spellTypes) && slot.spellTypes.length) {
      s = " " + slot.spellTypes.join(" or ") + " spell";
    }
    if (Array.isArray(slot.spellColors) && slot.spellColors.length) {
      s = (slot.spellColors.map((c) => COLOR_NAMES[c] || c).join(" or ")) + s;
    }
    if (slot.permanent) s += " or permanent";
    parts.push(s);
  } else {
    const quals = [];
    if (Array.isArray(slot.colors) && slot.colors.length) quals.push(slot.colors.map((c) => COLOR_NAMES[c]).join(" or "));
    if (Array.isArray(slot.notColors) && slot.notColors.length) quals.push("non" + slot.notColors.map((c) => COLOR_NAMES[c]).join("/non"));
    if (Array.isArray(slot.notTypes) && slot.notTypes.length) quals.push("non" + slot.notTypes.map((t) => t.toLowerCase()).join("/non"));
    if (Array.isArray(slot.subtypes) && slot.subtypes.length) quals.push(slot.subtypes.join("/"));
    if (Array.isArray(slot.notSubtypes) && slot.notSubtypes.length) quals.push("non-" + slot.notSubtypes.join("/non-"));
    if (typeof slot.powerLE === "number") quals.push("with power " + slot.powerLE + " or less");
    if (typeof slot.toughnessLE === "number") quals.push("with toughness " + slot.toughnessLE + " or less");
    if (slot.tapped) quals.push("tapped");
    let what = "permanent";
    if (Array.isArray(slot.types) && slot.types.length) {
      what = slot.types.map((t) => TYPE_NAMES[t] || t).join(" or ");
    }
    const hasPerm = Array.isArray(slot.types) && slot.types.length;
    if (quals.length || hasPerm) parts.push((quals.length ? quals.join(", ") + " " : "") + what);
    if (slot.player) parts.push(slot.opponent ? "opponent" : "player");
    if (slot.owner === "self") parts.push("you control");
  }
  return parts.join(" or ");
}

export function describeTargeting(t, opts = {}) {
  if (!t) return "no target";
  const x = opts.x;
  const max = t.max === "X" ? (typeof x === "number" && x > 0 ? x : 0) : typeof t.max === "number" ? t.max : 1;
  const min = typeof t.min === "number" ? t.min : 0;
  const slots = Array.isArray(t.slots) && t.slots.length ? t.slots : [{ player: true, permanent: true }];
  const one = describeSlot(slots[0]);
  if (min === max) {
    if (min === 1) return "target " + one;
    return "target " + min + " " + one + (min > 1 ? "s" : "");
  }
  if (max >= 100000) return "any number of targets";
  return "up to " + max + " targets";
}
