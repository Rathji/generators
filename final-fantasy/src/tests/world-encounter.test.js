// Validation tests for Task #37: World Map Encounter Trigger (global table).

import { EncounterGenerator } from "../engine/encounters.js";
import { ENCOUNTERS } from "../data/encounters.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("global table exists", !!ENCOUNTERS.global && Array.isArray(ENCOUNTERS.global.table) && ENCOUNTERS.global.table.length >= 2);
  check("overworld opts into global", ENCOUNTERS.overworld.useGlobal === true);

  const gen = new EncounterGenerator({ random: () => 0 });
  const globalTable = gen.tableFor("overworld");
  check("overworld table resolves to global", globalTable === ENCOUNTERS.global);
  check("world encounter rate", gen.encounterRate("overworld") === ENCOUNTERS.global.rate);
  check("world min gap", gen.minGap("overworld") === ENCOUNTERS.global.minGap);
  check("usesGlobal flag", gen.usesGlobal("overworld") === true);

  const caveTable = gen.tableFor("caves_of_cornelia");
  check("cave keeps own table", caveTable === ENCOUNTERS.caves_of_cornelia);
  check("no table map null", gen.tableFor("cornelia") === null && gen.encounterRate("cornelia") === 0);

  const worldEnc = gen.forceEncounter("overworld", "goblins");
  check("world encounter builds enemies", worldEnc !== null && worldEnc.mapId === "overworld" && worldEnc.enemies.length === 2);

  const fromGlobal = gen.pickGroup("overworld", () => 0.99);
  const globalNames = ENCOUNTERS.global.table.map((t) => t.group);
  check("picked group from global table", globalNames.includes(fromGlobal.group));

  const stepped = new EncounterGenerator({ random: () => 0 });
  stepped.onStep("overworld", 1);
  stepped.onStep("overworld", 1);
  const hit = stepped.onStep("overworld", 1);
  check("world step encounter rolls global groups", hit !== null && globalNames.includes(hit.groupId));

  const town = new EncounterGenerator({ random: () => 0 });
  check("towns never roll encounters", town.onStep("cornelia", 10) === null);

  const anyMap = new EncounterGenerator({ random: () => 0 });
  check("map without table silent", anyMap.onStep("nope", 10) === null);

  return out;
}
