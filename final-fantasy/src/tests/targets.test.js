// Validation tests for Task #29: AoE Target Resolver.

import { TargetResolver, TARGET_SCOPES, isAlive } from "../engine/targets.js";

function enemy(id, hp) {
  return { id, name: id, hp, maxHp: hp, mp: 0, maxMp: 0, str: 1, atk: 1, int: 1, agi: 1, def: 1, mdef: 1 };
}

function ally(id, hp) {
  return { id, name: id, hp, maxHp: hp, mp: 0, maxMp: 0, str: 1, atk: 1, int: 1, agi: 1, def: 1, mdef: 1, getStats: () => ({ maxHp: hp }) };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const tr = new TargetResolver({ random: () => 0.5 });
  const e1 = enemy("goblin", 10);
  const e2 = enemy("imp", 10);
  const eDead = enemy("corpse", 0);
  const enemies = [e1, e2, eDead];
  const a1 = ally("hero", 20);
  const a2 = ally("mage", 20);
  const aDead = ally("fallen", 0);
  const party = [a1, a2, aDead];
  const source = a1;

  check("scopes defined", TARGET_SCOPES.includes("single-enemy") && TARGET_SCOPES.includes("all-enemies") && TARGET_SCOPES.includes("all-allies") && TARGET_SCOPES.includes("self"));

  const singleEnemy = tr.resolveTargets({ target: "single-enemy" }, source, party, enemies, e2);
  check("single-enemy honors chosen", singleEnemy.targets.length === 1 && singleEnemy.targets[0] === e2);

  const singleDead = tr.resolveTargets({ target: "single-enemy" }, source, party, enemies, eDead);
  check("dead chosen falls back to alive", singleDead.targets.length === 1 && singleDead.targets[0] !== eDead);

  const noEnemies = tr.resolveTargets({ target: "single-enemy" }, source, party, [], null);
  check("no valid target => empty", noEnemies.targets.length === 0);

  const allEnemies = tr.resolveTargets({ target: "all-enemies" }, source, party, enemies, null);
  check("all-enemies excludes dead", allEnemies.targets.length === 2 && allEnemies.targets.includes(e1) && allEnemies.targets.includes(e2) && !allEnemies.targets.includes(eDead));

  const singleAlly = tr.resolveTargets({ target: "single-ally" }, source, party, enemies, a2);
  check("single-ally honors chosen", singleAlly.targets.length === 1 && singleAlly.targets[0] === a2);

  const allAllies = tr.resolveTargets({ target: "all-allies" }, source, party, enemies, null);
  check("all-allies excludes dead", allAllies.targets.length === 2 && allAllies.targets.includes(a1) && allAllies.targets.includes(a2) && !allAllies.targets.includes(aDead));

  const self = tr.resolveTargets({ target: "self" }, source, party, enemies, null);
  check("self targets caster", self.targets.length === 1 && self.targets[0] === source);

  const unknown = tr.resolveTargets({ target: "bogus" }, source, party, enemies, null);
  check("unknown scope => empty", unknown.targets.length === 0);

  check("isArea true for aoe", tr.isArea({ target: "all-enemies" }) === true && tr.isArea({ target: "single-enemy" }) === false);
  check("isAlive helper", isAlive(e1) === true && isAlive(eDead) === false);

  const randomPick = tr.pick(null, [e1, e2], null);
  check("random pick from pool", (randomPick === e1 || randomPick === e2) === true);

  return out;
}
