// Validation tests for Task #129: Multi-Target Attack Resolver.

import { MultiTargetResolver, WEAPON_MULTI_BONUS, MAX_TARGETS } from "../engine/multi-target.js";
import { WeaponScalingSystem } from "../engine/weapon-scaling.js";
import { Character } from "../engine/character.js";
import { CombatResolver } from "../engine/combat.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

const itemDb = {
  ironSword: { id: "ironSword", name: "Iron Sword", type: "weapon", slot: "weapon", mods: { atk: 8 } },
  huntersBow: { id: "huntersBow", name: "Hunter's Bow", type: "weapon", slot: "weapon", mods: { atk: 6 } },
  knuckles: { id: "knuckles", name: "Knuckles", type: "weapon", slot: "weapon", mods: { atk: 5 } },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ws = new WeaponScalingSystem({ itemDb });
  const resolver = new MultiTargetResolver({ weaponScaling: ws });

  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  warrior.equipment.weapon = "ironSword";
  check("sword single target", resolver.targetCount(warrior) === 1);
  check("type bonus sword 0", resolver.typeBonus(warrior) === 0);

  const archer = new Character({ id: "a", name: "Archer", classId: "thief" });
  archer.equipment.weapon = "huntersBow";
  check("bow hits 2 at level 1", resolver.targetCount(archer) === 2);
  check("bow type bonus 1", resolver.typeBonus(archer) === 1);

  const monk = new Character({ id: "mk", name: "Monk", classId: "monk" });
  monk.equipment.weapon = "knuckles";
  check("knuckles hit 2", resolver.targetCount(monk) === 2);

  // Level scaling: an extra target every 8 levels, capped at MAX_TARGETS.
  const archer9 = new Character({ id: "a9", name: "Archer9", classId: "thief", level: 9 });
  archer9.equipment.weapon = "huntersBow";
  check("level 9 adds target", resolver.targetCount(archer9) === 3);
  check("level bonus at 9", resolver.levelBonus(archer9) === 1);
  const archer17 = new Character({ id: "a17", name: "Archer17", classId: "thief", level: 17 });
  archer17.equipment.weapon = "huntersBow";
  check("level 17 caps at 4", resolver.targetCount(archer17) === 4 && MAX_TARGETS === 4);
  const archer99 = new Character({ id: "a99", name: "Archer99", classId: "thief", level: 99 });
  archer99.equipment.weapon = "huntersBow";
  check("level 99 stays capped", resolver.targetCount(archer99) === 4);

  // targets() picks the first N living enemies.
  const es = new EnemyTemplateSystem();
  const goblin1 = es.createEnemy("goblin");
  const goblin2 = es.createEnemy("goblin");
  const imp = es.createEnemy("imp");
  const enemies = [goblin1, goblin2, imp];
  check("bow targets first 2", resolver.targets(archer, enemies).length === 2);
  const dead = es.createEnemy("goblin");
  dead.hp = 0;
  check("dead excluded from targets", resolver.targets(archer, [dead, goblin1, imp]).length === 2);
  check("no enemies => no targets", resolver.targets(archer, []).length === 0);

  // describe.
  const d = resolver.describe(archer);
  check("describe counts", d.count === 2 && d.typeBonus === 1 && d.levelBonus === 0);

  // CombatResolver.multiAttack integration.
  const cr = new CombatResolver({
    random: () => 0.5,
    crits: false,
    multiTarget: new MultiTargetResolver({ weaponScaling: ws }),
  });
  cr.begin([archer9], enemies);
  const res = cr.multiAttack(archer9, enemies);
  check("multiAttack hits 3 at level 9", res.targets.length === 3 && res.damage > 0);
  check("each target took damage", enemies.every((e) => e.hp < e.maxHp));
  check("hits array matches targets", res.hits.length === 3);

  // Without a multiTarget system, multiAttack hits a single enemy.
  const cr2 = new CombatResolver({ random: () => 0.5, crits: false });
  const fresh = [es.createEnemy("goblin"), es.createEnemy("imp")];
  cr2.begin([warrior], fresh);
  const res2 = cr2.multiAttack(warrior, fresh);
  check("default multiAttack hits 1", res2.targets.length === 1);

  check("weapon bonus table defined", WEAPON_MULTI_BONUS.bow === 1 && WEAPON_MULTI_BONUS.knuckles === 1);

  return out;
}
