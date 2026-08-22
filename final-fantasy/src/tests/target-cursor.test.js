// Validation tests for Task #157: Target Selection Cursor — cycle through
// living enemies, auto-skip the dead, and compute the struck set (single or
// multi-target expansion).

import { TargetCursorSystem } from "../engine/target-cursor.js";

function enemy(id, hp = 20) {
  return { id, name: id, hp, maxHp: 30 };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const cursor = new TargetCursorSystem({ random: () => 0 });
  const [a, b, c] = [enemy("a"), enemy("b"), enemy("c")];

  check("unbound cursor is empty", cursor.current === null && cursor.aliveCount() === 0);

  cursor.bind([a, b, c]);
  check("bind lands on first living", cursor.selected === a && cursor.isAlive() === true);

  cursor.next();
  check("next moves forward", cursor.selected === b);
  cursor.next();
  check("next wraps", cursor.selected === c);
  cursor.next();
  check("wrap-around", cursor.selected === a);
  cursor.prev();
  check("prev wraps backward", cursor.selected === c);

  // Kill the current target -> refresh re-anchors.
  c.hp = 0;
  cursor.refresh();
  check("refresh skips dead", cursor.selected === a && cursor.isAlive());

  // Bounds with a single living enemy.
  const only = enemy("only");
  const solo = new TargetCursorSystem();
  solo.bind([enemy("gone1", 0), only, enemy("gone2", 0)]);
  check("first living wins", solo.selected === only);
  solo.next();
  check("single-target cycle stays put", solo.selected === only);

  // Empty fight.
  const empty = new TargetCursorSystem();
  empty.bind([enemy("x", 0), enemy("y", 0)]);
  check("no living targets", empty.current === null && empty.aliveCount() === 0);
  check("move on empty is safe", empty.next() === null);

  // Random pick (c fell earlier in the test — pick from the living).
  const rnd = new TargetCursorSystem({ random: () => 0.99 });
  rnd.bind([a, b, c]);
  const picked = rnd.random();
  check("random pick is living", picked === b && picked.hp > 0);

  // Highlighted set: single target by default.
  const plain = new TargetCursorSystem();
  plain.bind([a, b, c]);
  plain.next();
  check("single highlight", plain.highlighted().length === 1 && plain.highlighted()[0] === b);

  // Highlighted set with a MultiTargetResolver-style expansion.
  const multi = new TargetCursorSystem({
    multiTarget: { targets: (atk, enemies) => enemies.filter((e) => e.hp > 0).slice(0, 2) },
  });
  multi.bind([a, b, c]);
  const struck = multi.highlighted({ level: 5 });
  check("multi-target expansion", struck.length === 2 && struck.includes(a) && struck.includes(b));

  const markers = multi.markers({ level: 5 });
  check("markers mark struck", markers.filter((m) => m.struck).length === 2);
  check("markers mark selected", markers.find((m) => m.enemy === a).selected === true);

  return out;
}
