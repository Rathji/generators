// Validation tests for Task #185: The Highland Encounter Table — the
// storm-peak's birds and wind-wraiths, the hill bandits, and the deeper
// storm-cabal theme of the summit.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { ELEMENTS } from "../data/elements.js";
import { ITEMS } from "../data/items.js";
import { EncounterGenerator } from "../engine/encounters.js";

const PEAK_MONSTERS = ["highlandWolf", "stormHawk", "thunderVulture", "galeWisp", "windWraith", "highlandBrigand", "stormShaman", "peakGolem"];
const PEAK_GROUPS = ["highland_wolves", "cliff_hawks", "hill_bandits", "wind_wraiths", "hawk_flight", "gale_wisps", "storm_cabal", "wind_guardians"];

function allRefs(e) {
  const out = [];
  for (const k of ["weak", "resist", "immune"]) if (Array.isArray(e?.elements?.[k])) out.push(...e.elements[k]);
  return out;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  for (const id of PEAK_MONSTERS) {
    check("peak monster exists: " + id, !!ENEMIES[id]);
    const m = ENEMIES[id];
    if (!m) continue;
    for (const ref of allRefs(m)) {
      if (ELEMENTS.includes(ref)) continue;
      check("peak status immunity valid: " + id, ["poison", "sleep", "stone", "paralysis"].includes(ref));
    }
    for (const l of m.loot ?? []) check("peak monster loot exists: " + id + " -> " + l.itemId, !!ITEMS[l.itemId]);
  }

  for (const g of PEAK_GROUPS) {
    check("peak group exists: " + g, !!ENEMY_GROUPS[g]);
    for (const member of ENEMY_GROUPS[g] ?? []) check("peak group member exists: " + g + " -> " + member.id, !!ENEMIES[member.id]);
  }

  // The highlands table is moderate; the peak theme runs deeper.
  const highlands = ENCOUNTERS.west_highlands;
  check("west highlands table defined", !!highlands && Array.isArray(highlands.table) && highlands.table.length >= 4);
  check("highlands rate ~0.16", highlands && typeof highlands.rate === "number" && highlands.rate > 0.1 && highlands.rate < 0.2);
  const highGroups = new Set((highlands?.table ?? []).map((e) => e.group));
  check("highlands table groups all exist", [...highGroups].every((g) => !!ENEMY_GROUPS[g]));

  const theme = ENCOUNTERS.dungeon_peak;
  check("dungeon_peak theme defined", !!theme && Array.isArray(theme.table) && theme.table.length >= 4);
  check("highland_peak_b2 uses the peak theme", ENCOUNTERS.highland_peak_b2?.theme === "dungeon_peak");
  const themeGroups = new Set((theme?.table ?? []).map((e) => e.group));
  check("peak theme groups all exist", [...themeGroups].every((g) => !!ENEMY_GROUPS[g]));

  // The generator resolves a highland roll to real enemies.
  const gen = new EncounterGenerator({ tables: ENCOUNTERS });
  const picked = gen.pickGroup("west_highlands");
  check("highlands roll picks a group", !!picked && PEAK_GROUPS.includes(picked.group));
  const forced = gen.forceEncounter("west_highlands", "storm_cabal");
  check("highlands force encounter builds enemies", !!forced && forced.enemies.length >= 2);
  const peakForced = gen.forceEncounter("highland_peak_b2", "wind_guardians");
  check("themed peak force encounter works", !!peakForced && peakForced.enemies.length >= 2);

  // The summit reads like the storm: the wind's own fear ice, and the storm
  // shamans carry the sky's lightning.
  check("storm hawk fears frost", ENEMIES.stormHawk.elements.weak.includes("ice"));
  check("storm hawk shrugs wind", ENEMIES.stormHawk.elements.resist.includes("wind"));
  check("thunder vulture fears frost", ENEMIES.thunderVulture.elements.weak.includes("ice"));
  check("gale wisp shrugs wind", ENEMIES.galeWisp.elements.resist.includes("wind"));
  check("wind wraith fears holy", ENEMIES.windWraith.elements.weak.includes("holy"));
  check("storm shaman fears frost", ENEMIES.stormShaman.elements.weak.includes("ice"));
  check("peak golem shrugs wind and ice", ENEMIES.peakGolem.elements.resist.includes("wind") && ENEMIES.peakGolem.elements.resist.includes("ice"));
  check("peak golem fears lightning", ENEMIES.peakGolem.elements.weak.includes("lightning"));

  return out;
}
