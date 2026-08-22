// Validation tests for Task #34: World Map Movement Scaling.

import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { TRAVEL_MODES } from "../engine/terrain.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // 7 wide: (1,1) and (3,1)-(5,1) open, (2,1) wall; row2 fully open.
  const ROWS = ["#######", "#.#...#", "#.....#", "#######"];
  const map = TileMap.fromAscii(ROWS, { solid: { "#": true } });

  const sys = new MovementSystem(map);
  check("default scale 1", sys.scale === 1);
  const hero = new GridEntity(1, 2, { facing: "S" });
  sys.addEntity(hero);
  sys.setScale(2);
  check("scale set to 2", sys.scale === 2);

  const ok = sys.moveScaled(hero, "E"); // (1,2) -> (3,2), intermediate (2,2) open
  check("scaled move advances 2 tiles", ok === true && hero.x === 3 && hero.y === 2);

  const ok2 = sys.moveScaled(hero, "E"); // (3,2) -> (5,2)
  check("chained scaled move", ok2 === true && hero.x === 5);

  const edge = sys.moveScaled(hero, "E"); // (5,2) -> target (7,2) out of bounds
  check("scaled move stops at map edge", edge === false && hero.x === 5);
  check("facing still turns on block", hero.facing === "E");

  const sys2 = new MovementSystem(map);
  const h2 = new GridEntity(1, 1);
  sys2.addEntity(h2);
  sys2.setScale(2);
  const wallBlock = sys2.moveScaled(h2, "E"); // intermediate (2,1) is wall
  check("scaled move blocked by intermediate wall", wallBlock === false && h2.x === 1 && h2.y === 1);

  sys.setScale(1);
  const single = sys.move(hero, "W"); // (5,2) -> (4,2)
  check("move unaffected at scale 1", single === true && hero.x === 4 && hero.y === 2);

  const sys3 = new MovementSystem(map);
  const a = new GridEntity(3, 2, { id: "a" });
  const b = new GridEntity(1, 2, { id: "b" });
  sys3.addEntity(a);
  sys3.addEntity(b);
  const occBlock = sys3.moveSteps(b, "E", 2); // passes through occupied (3,2)
  check("moveSteps blocked by entity in path", occBlock === false && b.x === 1);

  const sys4 = new MovementSystem(map);
  const h4 = new GridEntity(1, 2);
  sys4.addEntity(h4);
  const s3 = sys4.moveSteps(h4, "E", 3);
  check("moveSteps moves multiple tiles", s3 === true && h4.x === 4);

  check("travelMode default land", new GridEntity(0, 0).travelMode === TRAVEL_MODES.LAND);
  const boat = new GridEntity(0, 0, { travelMode: "ship" });
  check("travelMode from opts", boat.travelMode === "ship");
  boat.setTravelMode("air");
  check("setTravelMode updates", boat.travelMode === "air");
  boat.setTravelMode("nope");
  check("invalid mode ignored", boat.travelMode === "air");

  const sys5 = new MovementSystem(map);
  const h5 = new GridEntity(1, 2);
  sys5.addEntity(h5);
  check("canMove true for open step", sys5.canMove(h5, "E", 2) === true);
  check("canMove false past wall", sys5.canMove(h5, "E", 5) === false);

  return out;
}
