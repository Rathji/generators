// Validation tests for Task #12: NPC Pathing & Idle Behaviors.

import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { NpcController } from "../engine/npc.js";

const map = TileMap.fromAscii(["#######", "#.....#", "#.....#", "#.....#", "#######"]);

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // patrol walks the full waypoint loop
  const sys = new MovementSystem(map);
  const npc = new GridEntity(1, 1, { id: "walker" });
  sys.addEntity(npc);
  const ctrl = new NpcController(sys, npc, {
    type: "patrol",
    waypoints: [{ x: 5, y: 1 }, { x: 5, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 1 }],
  });
  let ticks = 0;
  while (ticks < 100 && ctrl.stepsTaken < 12) {
    ctrl.update();
    ticks += 1;
  }
  check("patrol completes its loop", npc.x === 1 && npc.y === 1);
  check("patrol took exactly the path length", ticks === 15);

  // blocked patrol cannot move
  const sys2 = new MovementSystem(map);
  const stuck = new GridEntity(1, 1, { id: "stuck" });
  const blocker = new GridEntity(2, 1, { id: "blocker" });
  sys2.addEntity(stuck);
  sys2.addEntity(blocker);
  const ctrl2 = new NpcController(sys2, stuck, { type: "patrol", waypoints: [{ x: 5, y: 3 }] });
  for (let i = 0; i < 10; i++) ctrl2.update();
  check("patrol blocked by entity stays", stuck.x === 1 && stuck.y === 1);

  // stationary stays in place and faces a direction
  const sys3 = new MovementSystem(map);
  const idler = new GridEntity(3, 2, { id: "idler" });
  sys3.addEntity(idler);
  const ctrl3 = new NpcController(sys3, idler, { type: "stationary" }, { random: () => 0.5 });
  ctrl3.update();
  check("stationary stays put", idler.x === 3 && idler.y === 2);
  check("stationary faces a cardinal dir", ["N", "S", "E", "W"].includes(idler.facing));
  check("stationary facing from rng", idler.facing === "E");

  const ctrl3b = new NpcController(sys3, idler, { type: "stationary", idleTurning: false });
  const facingBefore = idler.facing;
  ctrl3b.update();
  check("stationary without idleTurning keeps facing", idler.facing === facingBefore);

  // pause at waypoint
  const sys4 = new MovementSystem(map);
  const pauser = new GridEntity(1, 1, { id: "pauser" });
  sys4.addEntity(pauser);
  const ctrl4 = new NpcController(sys4, pauser, {
    type: "patrol",
    waypoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
    pauseAtWaypoint: 2,
  });
  ctrl4.update();
  check("pause at first waypoint", pauser.x === 1 && pauser.y === 1);
  ctrl4.update();
  ctrl4.update();
  ctrl4.update();
  check("moves after pause", pauser.x === 2 && pauser.y === 1);

  ctrl4.setWaypoints([{ x: 1, y: 1 }]);
  check("setWaypoints replaces", ctrl4.waypoints.length === 1);
  check("steps counted", ctrl.stepsTaken === 12);

  // patrol with no waypoints behaves stationary
  const sys5 = new MovementSystem(map);
  const wander = new GridEntity(2, 2, { id: "wander" });
  sys5.addEntity(wander);
  const ctrl5 = new NpcController(sys5, wander, { type: "patrol" });
  ctrl5.update();
  check("patrol without waypoints stays", wander.x === 2 && wander.y === 2);

  return out;
}
