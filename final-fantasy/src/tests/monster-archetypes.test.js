// Validation tests for Task #114: monster archetypes.

import { MonsterArchetypeSystem } from "../engine/archetypes.js";
import { ENEMY_ARCHETYPES, ENEMY_ARCHETYPE_ASSIGN } from "../data/archetypes.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { ENEMIES } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new MonsterArchetypeSystem({ enemySystem: new EnemyTemplateSystem() });

  check("every enemy has an archetype", sys.uncovered().length === 0);
  check("all enemy ids assigned", Object.keys(ENEMIES).every((id) => ENEMY_ARCHETYPE_ASSIGN[id]));

  check("goblin archetype is humanoid", sys.archetypeOf("goblin")?.name === "Humanoid");
  check("archetypeOf unknown null", sys.archetypeOf("nope") === null);
  check("def lookup", sys.def("undead")?.name === "Undead");
  check("def unknown null", sys.def("nope") === null);

  check("all 8 archetypes have names", sys.defs().length === 8 && sys.defs().every((d) => typeof d.name === "string"));
  check("undead has monsters", sys.monstersIn("undead").length > 0);
  check("monstersIn zombie included", sys.monstersIn("undead").includes("zombie"));
  check("construct is largest family", sys.monstersIn("construct").includes("golem") && sys.monstersIn("construct").includes("chronoSprite"));

  const zombieWeak = sys.effectiveWeaknesses("zombie");
  check("zombie effective weakness merges template+archetype", zombieWeak.includes("fire") && zombieWeak.includes("holy"));
  check("merged weaknesses dedupe", zombieWeak.length === zombieWeak.filter((e, i) => zombieWeak.indexOf(e) === i).length);
  const goblinWeak = sys.effectiveWeaknesses("goblin");
  check("goblin merges fire + humanoid thunder", goblinWeak.includes("fire") && goblinWeak.includes("thunder"));
  check("knight resists holy (humanoid)", sys.effectiveResists("knight").includes("holy"));
  check("knight weak to thunder", sys.effectiveWeaknesses("knight").includes("thunder"));
  check("fiend weak to holy", sys.effectiveWeaknesses("chaos").includes("holy"));

  const desc = sys.describe("zombie");
  check("describe mentions archetype + weakness", desc.includes("Undead") && desc.includes("holy"));
  check("describe unknown", sys.describe("nope") === "Unknown enemy.");

  const audit = sys.audit();
  check("audit ok", audit.ok === true && audit.errors.length === 0);

  check("all archetype ids referenced or valid", Object.keys(ENEMY_ARCHETYPES).every((id) => sys.def(id)));
  check("assign values all valid archetype ids", Object.values(ENEMY_ARCHETYPE_ASSIGN).every((id) => !!ENEMY_ARCHETYPES[id]));

  return out;
}
