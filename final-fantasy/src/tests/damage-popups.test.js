// Validation tests for Task #155: Damage Number Pop-ups — short-lived
// floating numbers above targets. The core system is DOM-free data.

import { DamagePopupSystem } from "../engine/damage-popups.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const pop = new DamagePopupSystem({ cell: 18 });

  check("starts empty", pop.count() === 0);
  check("clear on empty is safe", pop.clear().count() === 0);

  const dmg = pop.add(3, 4, "-12", { kind: "damage" });
  check("damage popup spawns at the tile", dmg.x === 3 && dmg.y === 4 && dmg.text === "-12");
  check("damage color is red", dmg.color === "#ff8a8a");
  check("damage duration ~900ms", dmg.duration === 900);

  const heal = pop.add(5, 5, "+30", { kind: "heal" });
  check("heal popup is green + longer", heal.kind === "heal" && heal.color === "#7dffa6" && heal.duration === 1100);
  const crit = pop.add(1, 1, "-99", { kind: "crit" });
  check("crit popup is gold", crit.color === "#ffe14d");
  const miss = pop.add(2, 2, "MISS", { kind: "miss" });
  check("miss popup is grey", miss.kind === "miss" && miss.color === "#9aa4c0");

  check("active lists the popups", pop.active().length === 4 && pop.count() === 4);

  // Aging: at 400ms nothing has expired yet.
  pop.update(400);
  check("young popups survive", pop.count() === 4);
  // Past the damage duration -> the short ones expire (dmg 900 + miss 700
  // both gone, heal + crit at 1100 survive).
  pop.update(600);
  check("expired popups are dropped", pop.count() === 2 && pop.active()[0].kind === "heal");
  pop.update(300);
  check("everything expired", pop.count() === 0);

  // Cap: a burst of spawns never grows unbounded.
  const p2 = new DamagePopupSystem({ max: 5 });
  for (let i = 0; i < 20; i++) p2.add(i, 0, "-1", { kind: "damage" });
  check("popups capped", p2.count() === 5);

  // Distinct ids.
  const p3 = new DamagePopupSystem();
  const a = p3.add(0, 0, "-1", { kind: "damage" });
  const b = p3.add(0, 0, "-2", { kind: "damage" });
  check("popups get unique ids", a.id !== b.id);

  return out;
}
