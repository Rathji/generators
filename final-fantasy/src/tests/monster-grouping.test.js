// Validation tests for Task #115: monster encounter grouping.

import { MonsterGroupingSystem } from "../engine/grouping.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const enemySystem = new EnemyTemplateSystem();
  const sys = new MonsterGroupingSystem({ enemySystem });

  check("validate ok", sys.validate().ok === true);
  check("validate clean errors", sys.validate().errors.length === 0);
  check("isValid true", sys.isValid() === true);

  check("hasGroup goblins", sys.hasGroup("goblins") === true);
  check("hasGroup unknown false", sys.hasGroup("nope") === false);
  check("groupDef goblins exists", Array.isArray(sys.groupDef("goblins")));
  check("groupDef unknown null", sys.groupDef("nope") === null);
  check("allGroups non-empty", sys.allGroups().length === Object.keys(ENEMY_GROUPS).length);

  const goblins = sys.expand("goblins");
  check("expand goblins -> 2 goblins", goblins.length === 2 && goblins.every((e) => e.id === "goblin"));
  check("expand unknown -> empty", sys.expand("nope").length === 0);

  const bandits = sys.expand("bandits");
  check("bandits expands 3 members", bandits.length === 3);

  const stats = sys.stats("bandits");
  check("stats totals", stats.members === 3 && stats.xp === 2 * 12 + 10 && stats.gold === 2 * 18 + 12);
  check("stats min/max hp", stats.minHp === 12 && stats.maxHp === 18 && stats.totalHp === 2 * 18 + 12);
  check("stats unknown null", sys.stats("nope") === null);

  check("pick rng 0 -> first group", sys.pick(() => 0) === sys.allGroups()[0]);
  check("pick rng .99 -> last group", sys.pick(() => 0.9999) === sys.allGroups()[sys.allGroups().length - 1]);

  const desc = sys.describe("goblins");
  check("describe mentions goblin count", desc.includes("Goblin") && desc.includes("2"));

  const boss = sys.describe("garland_ambush");
  check("describe boss group", boss.includes("Garland"));

  return out;
}
