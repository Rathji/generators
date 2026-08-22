// Validation tests for Task #56: Dungeon-Specific Encounter Tables.

import { EncounterGenerator } from "../engine/encounters.js";
import { ENCOUNTERS } from "../data/encounters.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const enemies = new EnemyTemplateSystem();
  const gen = new EncounterGenerator({ enemySystem: enemies });

  check("theme tables exist", ENCOUNTERS.dungeon_cave && ENCOUNTERS.dungeon_castle && ENCOUNTERS.dungeon_volcano);
  check("b2 resolves cave theme", gen.tableFor("caves_of_cornelia_b2") === ENCOUNTERS.dungeon_cave);
  check("themeOf b2", gen.themeOf("caves_of_cornelia_b2") === "dungeon_cave");
  check("castle theme rate", gen.encounterRate("castle_map") === 0 || ENCOUNTERS.dungeon_castle.rate === 0.16);
  check("volcano theme hottest rate", ENCOUNTERS.dungeon_volcano.rate > ENCOUNTERS.dungeon_cave.rate);

  const castleTable = ENCOUNTERS.dungeon_castle.table;
  const groups = castleTable.map((e) => e.group);
  check("castle table uses castle groups", groups.includes("castle_guard") && groups.includes("haunted_halls"));

  const volcanoGroups = ENCOUNTERS.dungeon_volcano.table.map((e) => e.group);
  check("volcano table uses volcano groups", volcanoGroups.includes("volcanic_spirits") && volcanoGroups.includes("fire_swarm"));

  const knights = enemies.createGroup("castle_guard");
  check("castle_guard spawns knights", knights.length === 2 && knights.every((e) => e.name === "Knight"));
  check("knight stats", knights[0].hp === 36 && knights[0].def === 9);

  const spirits = enemies.createGroup("volcanic_spirits");
  check("volcanic_spirits composition", spirits.length === 3 && spirits.some((e) => e.name === "Fire Elemental"));
  const flame = spirits.find((e) => e.name === "Flame");
  check("flame fire-immune", flame.elements.immune.includes("fire") && flame.elements.weak.includes("ice"));

  const themed = new EncounterGenerator({ enemySystem: enemies, random: () => 0.5 });
  const forced = themed.forceEncounter("caves_of_cornelia_b2");
  check("force on themed map yields cave monsters", forced && forced.groupId !== null);
  check("b2 theme monsters valid", forced.enemies.every((e) => e.name));

  const cavePack = enemies.createGroup("cave_pack");
  check("cave_pack still available", cavePack.length === 3);

  const themedGen = new EncounterGenerator({ enemySystem: enemies, tables: ENCOUNTERS, random: () => 0 });
  themedGen.onStep("caves_of_cornelia_b2", 5);
  check("onStep returns cave-themed encounter", themedGen.lastEncounter?.mapId === "caves_of_cornelia_b2");
  check("theme table used", themedGen.tableFor("caves_of_cornelia_b2").table.every((e) => ["cave_dwellers", "cave_pack", "imp_pack", "goblin_brigade"].includes(e.group)));

  return out;
}
