// Validation tests for Task #64: Target Priority AI.

import { TargetPrioritySystem } from "../engine/target-priority.js";
import { EnemyAI } from "../engine/enemy-ai.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

function member(id, hp, maxHp, threat) {
  const m = { id, name: id, hp, maxHp, threat, str: 10, atk: 5, int: 3, agi: 7, def: 4, mdef: 2 };
  m.getStats = () => ({ ...m });
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const rng = () => 0;
  const tp = new TargetPrioritySystem({ random: rng });

  const tank = member("tank", 80, 100, 10);
  const dps = member("dps", 40, 50, 4);
  const healer = member("healer", 20, 50, 0);
  const party = [tank, dps, healer];

  check("threat mode picks tank", tp.pick(party, { mode: "threat" }) === tank);
  check("weakest picks lowest hp fraction", tp.pick(party, { mode: "weakest" }) === healer);
  check("lowestHp picks raw lowest", tp.pick(party, { mode: "lowestHp" }) === healer);
  check("strongest picks tank", tp.pick(party, { mode: "strongest" }) === tank);
  check("random uses rng", tp.pick(party, { mode: "random" }) === tank);
  check("empty returns null", tp.pick([]) === null);
  check("no candidates returns null", tp.pick([], { mode: "weakest" }) === null);

  const scored = tp.priorities(party);
  check("priorities breakdown", scored.length === 3 && scored.find((s) => s.target === tank).threat === 10);

  // Threat lookup table fallback
  const noThreat = [member("a", 50, 100), member("b", 50, 100)];
  check("threat table used", tp.pick(noThreat, { mode: "threat", threats: { a: 5, b: 1 } }) === noThreat[0]);

  // Ties resolved by rng
  const tie = tp.pick(noThreat, { mode: "threat", threats: { a: 3, b: 3 } });
  check("tie resolved deterministically", tie === noThreat[0]);

  // --- EnemyAI integration ---
  const es = new EnemyTemplateSystem();
  const goblin = es.createEnemy("goblin");
  goblin.ai = { targeting: "weakest" };
  const ai = new EnemyAI({ random: rng, targeting: tp });
  const act = ai.decide(goblin, [tank, dps, healer], []);
  check("ai picks weakest when targeting", act.type === "attack" && act.target === healer);

  const gob2 = es.createEnemy("goblin");
  gob2.ai = { targeting: "threat" };
  check("ai picks threat", ai.decide(gob2, party, []).target === tank);

  const gob3 = es.createEnemy("goblin");
  gob3.ai = { targeting: "random" };
  check("ai random fallback", ai.decide(gob3, party, []).target === tank);

  // --- EnemyAI blocks asleep enemies ---
  const sleeper = es.createEnemy("goblin");
  sleeper.statuses = ["sleep"];
  const aiNoStatus = new EnemyAI({ random: rng }); // no status system -> no blocking
  check("no status system ignores statuses", aiNoStatus.decide(sleeper, party, []).type === "attack");

  return out;
}
