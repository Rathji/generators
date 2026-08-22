// Validation tests for Task #81: Frame-Rate Independent Movement.

import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";

function openMap(w, h) {
  return TileMap.fromAscii(Array.from({ length: h }, () => ".".repeat(w)), {});
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const map = openMap(10, 10);
  const sys = new MovementSystem(map);
  sys.setStepInterval(180);
  const e = new GridEntity(2, 2);
  sys.addEntity(e);

  check("default step interval", sys.stepInterval === 180);
  sys.setStepInterval(90);
  check("step interval settable", sys.stepInterval === 90);
  sys.setStepInterval(180);

  // Held movement: one step per interval, independent of frame chunking.
  sys.setHeld(e, "E");
  const r1 = sys.update(90);
  check("90ms < 180ms no step", r1.length === 0 && e.x === 2);
  const r2 = sys.update(90);
  check("accumulated 180ms steps once", r2.length === 1 && e.x === 3);

  // Two 90ms updates == one 180ms update (frame-rate independence).
  const map2 = openMap(10, 10);
  const sysA = new MovementSystem(map2);
  sysA.setStepInterval(180);
  const a = new GridEntity(2, 2);
  sysA.addEntity(a);
  sysA.setHeld(a, "E");
  sysA.update(90);
  sysA.update(90);
  sysA.update(90);
  sysA.update(90);

  const map3 = openMap(10, 10);
  const sysB = new MovementSystem(map3);
  sysB.setStepInterval(180);
  const b = new GridEntity(2, 2);
  sysB.addEntity(b);
  sysB.setHeld(b, "E");
  sysB.update(360); // 360ms in one chunk

  check("chunked vs single update equal distance", a.x === b.x, "a=" + a.x + " b=" + b.x);
  check("two 180ms intervals = 2 steps", b.x === 4);

  // Non-held moves don't accumulate steps.
  const map4 = openMap(10, 10);
  const sysC = new MovementSystem(map4);
  sysC.setStepInterval(100);
  const c = new GridEntity(2, 2);
  sysC.addEntity(c);
  const steps = sysC.update(500);
  check("no held entity means no steps", steps.length === 0 && c.x === 2);

  // enqueueMove + drain: queued moves execute on update at intervals.
  const map5 = openMap(10, 10);
  const sysD = new MovementSystem(map5);
  sysD.setStepInterval(100);
  const d = new GridEntity(2, 2);
  sysD.addEntity(d);
  sysD.enqueueMove(d, "E");
  check("pending counted", sysD.pendingCount() === 1);
  sysD.update(100);
  check("queued move executed after interval", d.x === 3 && sysD.pendingCount() === 0);

  // drain() executes pending immediately.
  const map6 = openMap(10, 10);
  const sysE = new MovementSystem(map6);
  const e2 = new GridEntity(2, 2);
  sysE.addEntity(e2);
  sysE.enqueueMove(e2, "S");
  const drained = sysE.drain();
  check("drain executes pending", drained.length === 1 && e2.y === 3);

  // Walls stop held movement without throwing.
  const wallMap = TileMap.fromAscii(["###", "#.#", "###"], { solid: { "#": true } });
  const sysF = new MovementSystem(wallMap);
  const f = new GridEntity(1, 1);
  sysF.addEntity(f);
  sysF.setHeld(f, "N");
  const wallSteps = sysF.update(500);
  check("held move blocked by wall", f.y === 1 && wallSteps.every((s) => s.moved === false));

  // clearHeld stops further steps.
  sys.clearHeld(e);
  const after = sys.update(500);
  check("clearHeld stops movement", after.length === 0);

  return out;
}
