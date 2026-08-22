// Validation tests for Task #25: Random Encounter Generator.

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

  const gen = new EncounterGenerator({ random: () => 0 });
  check("rate from table (global via useGlobal)", gen.encounterRate("overworld") === ENCOUNTERS.global.rate);
  check("rate unknown map 0", gen.encounterRate("cornelia") === 0);
  check("minGap from table", gen.minGap("overworld") === ENCOUNTERS.global.minGap);
  check("hasTable", gen.hasTable("overworld") && !gen.hasTable("nope"));
  check("usesGlobal", gen.usesGlobal("overworld") === true && gen.usesGlobal("caves_of_cornelia") === false);

  check("minGap blocks early encounter", gen.onStep("overworld", 1) === null && gen.onStep("overworld", 1) === null);
  const third = gen.onStep("overworld", 1);
  check("encounter after minGap", third !== null && third.mapId === "overworld");
  check("enemy instances built", Array.isArray(third.enemies) && third.enemies.length === 2 && third.enemies[0].maxHp > 0);
  check("group id from global table", ENCOUNTERS.global.table.some((t) => t.group === third.groupId));
  check("counter reset after encounter", gen.sinceLast === 0 && gen.totalSteps === 3);
  check("lastEncounter stored", gen.lastEncounter.groupId === third.groupId);

  const pick0 = gen.pickGroup("overworld", () => 0);
  check("weighted pick first", pick0.group === ENCOUNTERS.global.table[0].group);
  const pickLast = gen.pickGroup("overworld", () => 0.99);
  check("weighted pick last", pickLast.group === ENCOUNTERS.global.table[ENCOUNTERS.global.table.length - 1].group);
  check("pickGroup unknown map null", gen.pickGroup("nope", () => 0) === null);

  const forced = gen.forceEncounter("caves_of_cornelia", "cave_dwellers");
  check("forceEncounter builds group", forced !== null && forced.forced === true && forced.enemies.length === 2 && forced.enemies[0].id === "zombie");
  check("forceEncounter unknown group null", gen.forceEncounter("overworld", "nope") === null);

  const neverGen = new EncounterGenerator({ random: () => 0.99 });
  check("rate too high never triggers", neverGen.onStep("overworld", 4) === null && neverGen.onStep("overworld", 4) === null);

  const cave = new EncounterGenerator({ random: () => 0 });
  for (let i = 0; i < 5; i++) cave.onStep("caves_of_cornelia", 1);
  check("dungeon table triggers", cave.lastEncounter !== null && cave.lastEncounter.mapId === "caves_of_cornelia");
  check("total steps tracked", cave.totalSteps === 5);

  gen.reset();
  check("reset clears state", gen.sinceLast === 0 && gen.totalSteps === 0 && gen.lastEncounter === null);

  const es = new EnemyTemplateSystem();
  const withSys = new EncounterGenerator({ enemySystem: es, random: () => 0 });
  const e = withSys.forceEncounter("overworld", "goblins");
  check("custom enemy system wired", e.enemies.length === 2 && e.enemies[0].id === "goblin");

  return out;
}
