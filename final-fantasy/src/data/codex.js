// Task #231: The Codex — the party's encyclopedia of everything discovered
// while adventuring: enemies, items, spells, classes, locations, and quests.
// This catalog holds the *static* knowledge; the engine (codex.js) tracks
// what the player has actually discovered. Lore is curated for the major places
// and major foes; everything else gets a generated entry fallback.

import { ENEMIES } from "./enemies.js";
import { ITEMS } from "./items.js";
import { SPELLS } from "./spells.js";
import { CLASSES } from "./classes.js";
import { QUESTS } from "./quests.js";
import { SIDE_QUESTS } from "./side-quests.js";
import { MAPS } from "./maps.js";
import { classifyMap } from "./music-regions.js";

export const CODEX_SECTIONS = [
  { id: "enemies", label: "Bestiary" },
  { id: "items", label: "Items" },
  { id: "spells", label: "Spells" },
  { id: "classes", label: "Classes" },
  { id: "locations", label: "Locations" },
  { id: "quests", label: "Quests" },
];

// Curated lore for the realm's notable places, keyed by map id.
const LOCATION_LORE = {
  overworld: "The vast wilderness that binds the five kingdoms. Legends say four crystals kept it in balance until darkness swallowed the land.",
  cornelia: "A humble farming capital and the party's home. King Cornelia knows the crystals' secret.",
  caves_of_cornelia: "The twisting caverns beneath Cornelia where the Earth Crystal slumbered behind a locked door.",
  cornelia_castle: "The royal seat of Cornelia, where the king speaks in whispers of the failing light.",
  pravog: "A riverside trade hub of merchants and rumors, watched over by a chapel of the old faith.",
  elfheim: "A forested haven of the elves, home to the Prince's Hall and the gate to Mount Gulg.",
  windfall: "A highland village where the wind always blows and the Wind Shrine awaits.",
  dwarfholm: "The dwarven mountain home, honeycombed with forges, tunnels, and the great Forge itself.",
  glacierport: "A cold sea-port at the edge of the northern wastes, gateway to the frozen depths.",
  sea_shrine: "The Sea Shrine.",
};

// A curated bestiary lore note for the major monsters. Absent enemies get a
// generated line from their stats.
const ENEMY_LORE = {
  goblin: "A vicious little greenskin that ambushes travelers on the road from Cornelia. Their fangs sell, if you can pry them loose.",
  imp: "A darting, grinning trickster. Imps love to flee more than they love to fight.",
  goblinChief: "A hulking goblin warlord crowned with feathers. It commands the caves' defenders.",
  knight: "A fallen knight in rusted plate, bound to the crypts by an old oath it can no longer keep.",
  garland: "Garland, the knight who betrayed the realm to seize the Earth Crystal. A tragic, burning foe.",
  marshGuardian: "The ancient guardian of the Marsh Cave, wreathed in algae and patient as the swamp itself.",
  forgeGolem: "A titan of molten stone and iron, stomping through the Forge's depths.",
  forgeColossus: "A mountain of living metal at the furnace's heart - the Colossus, and the source of adamantite.",
  tideSerpent: "The Drowned Vault's leviathan, coiled around the sea crystal.",
  seaGull: "A shrieking seabird with a taste for shiny things.",
  windFiend: "The Wind Fiend, a storm given shape, reigning over the Sky Altar.",
};

// Helper builders ---------------------------------------------------------

export function enemyDetails(id) {
  const e = ENEMIES[id];
  if (!e) return null;
  const elems = [];
  for (const [k, v] of Object.entries(e.elements ?? {})) {
    if (Array.isArray(v)) v.forEach((x) => elems.push(k + ": " + x));
    else elems.push(k + ": " + v);
  }
  return {
    id,
    name: e.name,
    kind: "enemy",
    boss: !!e.boss,
    stats: { HP: e.hp, MP: e.mp ?? 0, ATK: e.atk, DEF: e.def, AGI: e.agi, MDEF: e.mdef ?? 0 },
    drops: "XP " + e.xp + " · " + e.gold + "g",
    elements: elems.length ? elems.join(" · ") : null,
    lore: ENEMY_LORE[id] || (e.name.toLowerCase() + " prowls the wilds; no fuller account of it exists."),
  };
}

export function enemyCatalog() {
  return Object.keys(ENEMIES).map(enemyDetails).filter(Boolean);
}

export function itemDetails(id) {
  const i = ITEMS[id];
  if (!i) return null;
  return {
    id,
    name: i.name,
    kind: "item",
    type: i.type,
    rarity: i.rarity,
    description: i.description,
  };
}

export function itemCatalog() {
  return Object.keys(ITEMS).map(itemDetails).filter(Boolean);
}

export function spellDetails(id) {
  const s = SPELLS[id];
  if (!s) return null;
  return {
    id,
    name: s.name,
    kind: "spell",
    target: s.target,
    mp: s.mp,
    power: s.power,
    kind2: s.kind,
    element: s.element,
  };
}

export function spellCatalog() {
  return Object.keys(SPELLS).map(spellDetails).filter(Boolean);
}

export function classDetails(id) {
  const c = CLASSES[id];
  if (!c) return null;
  return {
    id,
    name: c.name,
    kind: "class",
    stats: { HP: c.baseHp, MP: c.baseMp, STR: c.baseStr, AGI: c.baseAgi, DEF: c.baseDef, MDEF: c.baseMdef },
    spells: (c.spells ?? []).map((s) => "Lv" + s.lvl + " " + (SPELLS[s.spell]?.name ?? s.spell)),
  };
}

export function classCatalog() {
  return Object.keys(CLASSES).map(classDetails).filter(Boolean);
}

export function locationDetails(id) {
  const m = MAPS.find((x) => x.id === id);
  if (!m) return null;
  const region = classifyMap(id);
  const regionName = region === "town" ? "Town" : region === "dungeon" ? "Dungeon" : "Wilderness";
  return {
    id,
    name: m.name,
    kind: "location",
    region: regionName,
    lore: LOCATION_LORE[id] || (m.name + ", a place of the " + regionName.toLowerCase() + "."),
  };
}

export function locationCatalog() {
  return MAPS.map((m) => locationDetails(m.id)).filter(Boolean);
}

export function questDetails(id) {
  const q = QUESTS.find((x) => x.id === id) || SIDE_QUESTS[id];
  if (!q) return null;
  return {
    id,
    name: q.name,
    kind: "quest",
    description: q.description ?? q.dialogue?.start,
    objectives: (q.objectives ?? q.steps ?? []).map((o) => o.text ?? o.description),
    reward: q.reward ? `Reward · ${q.reward.gold ?? 0}g` : undefined,
  };
}

export function questCatalog() {
  return [
    ...QUESTS.map((q) => questDetails(q.id)).filter(Boolean),
    ...Object.keys(SIDE_QUESTS).map((id) => questDetails(id)).filter(Boolean),
  ];
}

const CATALOGS = {
  enemies: enemyCatalog,
  items: itemCatalog,
  spells: spellCatalog,
  classes: classCatalog,
  locations: locationCatalog,
  quests: questCatalog,
};

export function catalogFor(section) {
  return (CATALOGS[section] || (() => []))();
}
