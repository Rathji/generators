// Validation tests for Task #61: Status Effect State Machine.

import { StatusEffectSystem, STATUS_DEFS, STATUS_IDS } from "../engine/status.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new StatusEffectSystem({ random: () => 0 });
  const target = { id: "hero", name: "Hero", hp: 100, maxHp: 100, statuses: [] };

  check("status ids defined", ["poison", "sleep", "paralysis", "stone", "soaked"].every((s) => STATUS_IDS.includes(s)));
  check("defs have names", STATUS_DEFS.poison.name === "Poison" && STATUS_DEFS.stone.name === "Stone");

  const p = sys.apply(target, "poison");
  check("poison applies", p.ok === true && sys.has(target, "poison"));
  check("poison indefinite", sys.turnsLeft(target, "poison") === Infinity);

  const events = sys.tick(target);
  const dmg = events.find((e) => e.type === "damage");
  check("poison ticks damage", dmg && dmg.amount === 12 && target.hp === 88); // floor(100/8)
  check("poison persists after tick", sys.has(target, "poison"));

  // --- Sleep blocks actions and wears off ---
  const sleeper = { id: "s", name: "S", hp: 50, maxHp: 50, statuses: [] };
  sys.apply(sleeper, "sleep");
  check("sleep applied", sys.has(sleeper, "sleep") && sys.turnsLeft(sleeper, "sleep") === 3);
  check("sleep blocks", sys.blocked(sleeper) === "sleep");
  sys.tick(sleeper);
  sys.tick(sleeper);
  sys.tick(sleeper);
  check("sleep wears off after 3 turns", !sys.has(sleeper, "sleep"));
  check("no longer blocked", sys.blocked(sleeper) === false);

  // --- Sleep wakes on hit ---
  const dozer = { id: "d", name: "D", hp: 40, maxHp: 40, statuses: [] };
  sys.apply(dozer, "sleep");
  const woke = sys.onHit(dozer);
  check("hit wakes sleeper", woke.includes("sleep") && !sys.has(dozer, "sleep"));

  // --- Paralysis blocks by chance ---
  const para = { id: "p", name: "P", hp: 30, maxHp: 30, statuses: [] };
  sys.apply(para, "paralysis");
  check("paralysis blocks on low roll", sys.blocked(para, () => 0) === "paralysis");
  check("paralysis passes on high roll", sys.blocked(para, () => 0.9) === false);

  // --- Stone always blocks and survives death ---
  const stone = { id: "t", name: "T", hp: 60, maxHp: 60, statuses: [] };
  sys.apply(stone, "stone");
  check("stone blocks always", sys.blocked(stone, () => 0.9) === "stone");
  stone.hp = 0;
  sys.clearOnDeath(stone);
  check("stone persists after death", sys.has(stone, "stone"));

  // --- Immunity ---
  const resistant = { id: "r", name: "R", hp: 20, maxHp: 20, statuses: [], statusImmune: ["poison"] };
  check("immune target rejects status", sys.apply(resistant, "poison").ok === false);

  // --- Chance roll ---
  const roll0 = new StatusEffectSystem({ random: () => 0.99 });
  const victim = { id: "v", name: "V", hp: 20, maxHp: 20, statuses: [] };
  check("low chance resists", roll0.apply(victim, "sleep", { chance: 0.5 }).ok === false && !roll0.has(victim, "sleep"));

  // --- Cures ---
  const sick = { id: "k", name: "K", hp: 20, maxHp: 20, statuses: ["poison", "sleep"] };
  sys.cure(sick, "poison");
  check("cure removes one", !sys.has(sick, "poison") && sys.has(sick, "sleep"));
  const all = sys.cureAll(sick);
  check("cureAll clears rest", all.cured.includes("sleep") && sick.statuses.length === 0);

  // --- Active listing ---
  const listed = { id: "l", name: "L", hp: 50, maxHp: 50, statuses: [] };
  sys.apply(listed, "poison");
  sys.apply(listed, "soaked");
  const act = sys.active(listed);
  check("active lists statuses", act.length === 2 && act.every((a) => a.name));

  // --- Works on plain enemy objects without statuses array ---
  const plain = { id: "e", name: "Enemy", hp: 40, maxHp: 40 };
  check("applies to plain enemy", sys.apply(plain, "poison").ok === true && Array.isArray(plain.statuses));

  return out;
}
