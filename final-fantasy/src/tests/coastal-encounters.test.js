// Validation tests for Task #170: Coastal Encounter Table — the east-coast
// monsters and the global-table additions that seed them onto the roads.

import { ENCOUNTERS } from "../data/encounters.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";
import { ELEMENTS } from "../data/elements.js";
import { ITEMS } from "../data/items.js";
import { EncounterGenerator } from "../engine/encounters.js";

const COASTAL_MONSTERS = ["seaGull", "shoreCrab", "reefSerpent", "tideRaider", "coastWraith"];
const COASTAL_GROUPS = ["shore_crabs", "gull_flock", "reef_serpents", "tide_raiders", "coast_wraiths"];

function elementIdsOf(e) {
  const out = [];
  for (const k of ["weak", "resist", "immune"]) if (Array.isArray(e[k])) out.push(...e[k]);
  return out;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  for (const id of COASTAL_MONSTERS) {
    check("coastal monster exists: " + id, !!ENEMIES[id]);
    const m = ENEMIES[id];
    if (!m) continue;
    const els = elementIdsOf(m.elements ?? {});
    check("coastal monster elements valid: " + id, els.every((e) => ELEMENTS.includes(e)));
    for (const l of m.loot ?? []) {
      check("coastal monster loot exists: " + id + " -> " + l.itemId, !!ITEMS[l.itemId]);
    }
    check("coastal monster spells valid: " + id, !m.ai?.spells || m.ai.spells.every((s) => ["fire", "blizzard", "thunder"].includes(s)));
  }

  for (const g of COASTAL_GROUPS) {
    check("coastal group exists: " + g, !!ENEMY_GROUPS[g]);
    for (const member of ENEMY_GROUPS[g] ?? []) {
      check("coastal group member exists: " + g + " -> " + member.id, !!ENEMIES[member.id]);
    }
  }

  // The coastal table has a moderate rate and references real groups.
  const coastal = ENCOUNTERS.coastal;
  check("coastal table defined", !!coastal);
  check("coastal rate ~0.12", coastal && typeof coastal.rate === "number" && coastal.rate > 0 && coastal.rate < 0.15);
  check("coastal has a min gap", coastal && typeof coastal.minGap === "number");
  check("coastal table has groups", coastal && Array.isArray(coastal.table) && coastal.table.length >= 4);
  const coastalGroupIds = new Set((coastal?.table ?? []).map((e) => e.group));
  check("coastal table groups all exist", [...coastalGroupIds].every((g) => !!ENEMY_GROUPS[g]));

  // The global overworld table now includes the shore visitors.
  const globalTable = ENCOUNTERS.global.table.map((e) => e.group);
  check("global table has gull flock", globalTable.includes("gull_flock"));
  check("global table has shore crabs", globalTable.includes("shore_crabs"));

  // The generator resolves a coastal roll to real enemies.
  const gen = new EncounterGenerator({ tables: ENCOUNTERS });
  const picked = gen.pickGroup("coastal");
  check("coastal roll picks a group", !!picked && COASTAL_GROUPS.includes(picked.group));
  const forced = gen.forceEncounter("coastal", "tide_raiders");
  check("coastal force encounter builds enemies", !!forced && forced.enemies.length >= 2);

  // The monsters' resistances/weaknesses make the coast read like the sea.
  check("sea gull fears fire", ENEMIES.seaGull.elements.weak.includes("fire"));
  check("shore crab fears lightning", ENEMIES.shoreCrab.elements.weak.includes("lightning"));
  check("shore crab shrugs water", ENEMIES.shoreCrab.elements.resist.includes("water"));
  check("reef serpent fears frost", ENEMIES.reefSerpent.elements.weak.includes("ice"));
  check("coast wraith fears holy", ENEMIES.coastWraith.elements.weak.includes("holy"));

  return out;
}
