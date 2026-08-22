// Validation tests for Task #126: Turn-Order Queue Resolver.

import { TurnOrderQueue } from "../engine/turn-order.js";
import { BuffSystem } from "../engine/buffs.js";
import { Character } from "../engine/character.js";
import { CombatResolver } from "../engine/combat.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const warrior = new Character({ id: "w", name: "Warrior", classId: "warrior" });
  const thief = new Character({ id: "t", name: "Thief", classId: "thief" });
  const enemy = { id: "e", name: "Slime", hp: 30, maxHp: 30, agi: 4, str: 3, def: 1 };

  // Seeded rng () => 0 => zero jitter, so ordering is pure agility.
  const q = new TurnOrderQueue({ random: () => 0 });
  const order = q.build([warrior, enemy, thief]);
  check("build sorts by agility", order[0] === thief && order[1] === warrior && order[2] === enemy);
  check("queue exposes ordering", q.queue()[0] === thief && q.queue().length === 3);

  check("peek returns next actor", q.peek() === thief);
  check("next pops in order", q.next() === thief && q.next() === warrior && q.next() === enemy);
  check("empty after all actors", q.isEmpty() === true && q.next() === null);

  const q2 = new TurnOrderQueue({ random: () => 0 });
  const r1 = q2.startRound([warrior, enemy, thief]);
  check("startRound round 1", r1.round === 1 && r1.order[0] === thief);
  const r2 = q2.startRound([warrior, enemy, thief]);
  check("startRound increments round", r2.round === 2);
  check("recalculate rebuilds queue", q2.recalculate([thief, enemy, warrior]).length === 3);

  // Haste (+3 AGI) feeds the speed roll via BuffSystem.
  const buffs = new BuffSystem();
  buffs.apply(warrior, "haste");
  const q3 = new TurnOrderQueue({ random: () => 0, buffs });
  check("haste speed modifier", buffs.speedMod(warrior) === 3);
  const o3 = q3.build([warrior, enemy, thief]);
  check("haste moves warrior ahead of slime", o3.indexOf(warrior) < o3.indexOf(enemy));
  check("thief still fastest", o3[0] === thief);

  // Dead combatants never join the queue.
  enemy.hp = 0;
  const q4 = new TurnOrderQueue({ random: () => 0 });
  const o4 = q4.build([warrior, enemy, thief]);
  check("dead combatants skipped", !o4.includes(enemy) && o4.length === 2);

  // Round-start callback.
  let called = 0;
  const q5 = new TurnOrderQueue({ random: () => 0, onRoundStart: () => called++ });
  q5.startRound([warrior, thief]);
  check("onRoundStart fires", called === 1);

  // Human-readable describe.
  const d = q5.describe([warrior]);
  check("describe returns speeds", d.length === 1 && typeof d[0].speed === "number" && d[0].name === "Warrior");

  // CombatResolver delegates to the queue when wired in.
  const cr = new CombatResolver({ random: () => 0, turnQueue: new TurnOrderQueue({ random: () => 0 }) });
  cr.begin([warrior, thief], [enemy]);
  const crOrder = cr.turnOrder();
  check("resolver uses queue", crOrder.length === 2 && crOrder[0] === thief);

  return out;
}
