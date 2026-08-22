// Validation tests for Task #30: Enemy Stat Template System.

import { EnemyTemplateSystem } from "../engine/enemies.js";
import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const es = new EnemyTemplateSystem();
  check("template lookup", es.template("goblin").name === "Goblin");
  check("unknown template null", es.template("nope") === null && es.createEnemy("nope") === null);

  const g = es.createEnemy("goblin");
  check("instance has stats", g.hp === 18 && g.maxHp === 18 && g.str === 6 && g.atk === 4 && g.xp === 12 && g.gold === 18);
  check("elements cloned", Array.isArray(g.elements.weak) && g.elements.weak.includes("fire"));
  check("loot table cloned", Array.isArray(g.loot) && g.loot[0].itemId === "goblinFang");

  g.hp = 5;
  const g2 = es.createEnemy("goblin");
  check("instances are independent", g2.hp === 18 && g2.hp !== g.hp);
  g.elements.weak.push("ice");
  const g3 = es.createEnemy("goblin");
  check("template not mutated by instance", g3.elements.weak.includes("ice") === false);

  const group = es.createGroup("bandits");
  check("group builds enemies", group.length === 3 && group[0].id === "goblin" && group[1].id === "goblin" && group[2].id === "imp");
  check("group unknown empty", es.createGroup("nope").length === 0);
  check("hasGroup", es.hasGroup("bandits") && !es.hasGroup("nope"));
  check("group def exposed", es.groupDef("bandits").length === 2);

  const chief = es.createEnemy("goblinChief");
  const alwaysDrop = es.lootFor(chief, () => 0);
  const neverDrop = es.lootFor(chief, () => 0.9);
  check("guaranteed loot drops", alwaysDrop.includes("ironSword"));
  check("chance loot conditional", neverDrop.includes("ironSword") === true && neverDrop.includes("goblinFang") === false);

  const noLoot = es.createEnemy("imp");
  check("no loot table => none", es.lootFor(noLoot, () => 0).length === 0);

  const rewards = es.rewardsFor([es.createEnemy("goblin"), es.createEnemy("imp")]);
  check("rewards sum", rewards.xp === 22 && rewards.gold === 30);

  const zombie = es.createEnemy("zombie");
  check("affinities present", zombie.elements.weak.includes("fire") && zombie.elements.resist.includes("ice"));

  check("data export complete", typeof ENEMIES.goblin === "object" && Array.isArray(ENEMY_GROUPS.imp_pack));
  check("every group enemy exists", Object.values(ENEMY_GROUPS).flat().every((e) => !!ENEMIES[e.id]));

  return out;
}
