// Validation tests for Task #1: Grid-Based Movement System.
// Run via browser_eval:  const t = await import("./src/tests/grid.test.js"); return t.run();

import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // ---- TileMap: construction & collision data ----
  const map = TileMap.fromAscii([
    "#######",
    "#.....#",
    "#.#...#",
    "#.....#",
    "#######",
  ]);
  check("map dims 7x5", map.width === 7 && map.height === 5);
  check("border walls solid", map.isSolid(0, 0) && map.isSolid(6, 0) && map.isSolid(0, 4) && map.isSolid(6, 4));
  check("interior floor walkable", map.canStand(1, 1) && map.canStand(5, 3));
  check("pillar solid", map.isSolid(2, 2));
  check("out-of-bounds is solid", map.isSolid(-1, 0) && map.isSolid(7, 0) && map.isSolid(0, -1) && map.isSolid(0, 5));
  check("out-of-bounds not walkable", !map.canStand(7, 2) && !map.canStand(2, 5));

  const m2 = TileMap.fromAscii(["A~", "A#"], { solid: { "~": true, "#": true } });
  check("custom solid spec: A walkable", m2.canStand(0, 0) && m2.canStand(0, 1));
  check("custom solid spec: ~ solid", m2.isSolid(1, 0));
  check("custom solid spec: # solid", m2.isSolid(1, 1));

  const m3 = TileMap.fromAscii([".#"], { tiles: { ".": 5, "#": 9 } });
  check("tile id floor", m3.tiles[0] === 5);
  check("tile id wall", m3.tiles[1] === 9);

  const m4 = TileMap.fromAscii(["##", "#"]);
  check("uneven rows: width = max row", m4.width === 2 && m4.height === 2);
  check("padded cell is non-solid", m4.canStand(1, 1));

  const m5 = TileMap.fromAscii(["...."]);
  m5.setSolid(2, 0);
  check("setSolid makes tile solid", m5.isSolid(2, 0) === true);
  m5.setSolid(2, 0, false);
  check("setSolid clears tile", m5.isSolid(2, 0) === false);

  // ---- MovementSystem: cardinal-only rules ----
  const sys = new MovementSystem(map);
  const hero = new GridEntity(3, 3);
  check("addEntity ok", sys.addEntity(hero) === true);
  check("default facing is N", hero.facing === "N");
  check("addEntity rejects occupied tile", sys.addEntity(new GridEntity(3, 3)) === false);
  check("constructor seeds entities", new MovementSystem(map, [new GridEntity(1, 1)]).isOccupied(1, 1) === true);

  check("diagonal NE rejected", sys.move(hero, "NE") === false && hero.x === 3 && hero.y === 3);
  check("diagonal SW rejected", sys.move(hero, "SW") === false && hero.x === 3 && hero.y === 3);
  check("prototype-key dir rejected", sys.move(hero, "toString") === false);
  check("unknown dir rejected", sys.move(hero, "up") === false && sys.move(hero, "") === false);
  check("facing unchanged on invalid dir", hero.facing === "N");

  check("move N ok", sys.move(hero, "N") === true && hero.x === 3 && hero.y === 2);
  check("facing updated to N", hero.facing === "N");
  check("move E ok", sys.move(hero, "E") === true && hero.x === 4 && hero.y === 2);
  check("move S ok", sys.move(hero, "S") === true && hero.x === 4 && hero.y === 3);
  check("move W ok", sys.move(hero, "W") === true && hero.x === 3 && hero.y === 3);
  check("cardinal loop returned to start", hero.x === 3 && hero.y === 3);

  // ---- canMove is non-mutating ----
  const sys2 = new MovementSystem(map);
  const c = new GridEntity(3, 1);
  sys2.addEntity(c);
  check("canMove blocked by wall", sys2.canMove(c, "N") === false);
  check("canMove open floor", sys2.canMove(c, "S") === true);
  check("canMove does not move", c.x === 3 && c.y === 1);
  check("canMove rejects diagonal", sys2.canMove(c, "NE") === false);

  // ---- Wall collision: blocked step keeps position but faces the obstacle ----
  const sys3 = new MovementSystem(map);
  const bump = new GridEntity(3, 1);
  sys3.addEntity(bump);
  check("bump border wall blocked", sys3.move(bump, "N") === false);
  check("bump keeps position", bump.x === 3 && bump.y === 1);
  check("bump faces the wall", bump.facing === "N");

  const sys3b = new MovementSystem(map);
  const bump2 = new GridEntity(2, 3);
  sys3b.addEntity(bump2);
  check("bump pillar blocked", sys3b.move(bump2, "N") === false && bump2.x === 2 && bump2.y === 3);

  // ---- Entity-entity blocking ----
  const sys4 = new MovementSystem(map);
  const a = new GridEntity(3, 3);
  const b = new GridEntity(3, 2);
  sys4.addEntity(a);
  sys4.addEntity(b);
  check("entity blocks entity", sys4.move(a, "N") === false && a.x === 3 && a.y === 3);
  check("blocked mover faces obstacle", a.facing === "N");
  check("isOccupied true", sys4.isOccupied(3, 2) === true);
  check("entityAt returns blocker", sys4.entityAt(3, 2) === b);
  check("blocker moves E, freeing tile", sys4.move(b, "E") === true && b.x === 4 && b.y === 2);
  check("tile freed", sys4.isOccupied(3, 2) === false);
  check("first entity can now move N", sys4.move(a, "N") === true && a.x === 3 && a.y === 2);

  // ---- removeEntity ----
  const sys5 = new MovementSystem(map);
  const e1 = new GridEntity(1, 1);
  const e2 = new GridEntity(5, 3);
  sys5.addEntity(e1);
  sys5.addEntity(e2);
  check("two entities tracked", sys5.entities.length === 2);
  check("removeEntity ok", sys5.removeEntity(e1) === true);
  check("removed entity frees tile", sys5.isOccupied(1, 1) === false);
  check("removing unknown entity fails", sys5.removeEntity(new GridEntity(1, 1)) === false);
  check("one entity left", sys5.entities.length === 1);

  // ---- Out-of-bounds on an open map ----
  const openSys = new MovementSystem(TileMap.fromAscii(["....", "...."]));
  const trav = new GridEntity(0, 0);
  openSys.addEntity(trav);
  check("off-map N blocked", openSys.move(trav, "N") === false && trav.y === 0);
  check("off-map W blocked", openSys.move(trav, "W") === false && trav.x === 0);
  check("move into bounds ok", openSys.move(trav, "E") === true && trav.x === 1);
  openSys.move(trav, "E");
  openSys.move(trav, "E");
  check("off-map E blocked at edge", openSys.move(trav, "E") === false && trav.x === 3);

  // ---- Full multi-step navigation respecting collision ----
  const navSys = new MovementSystem(map);
  const runner = new GridEntity(1, 1);
  navSys.addEntity(runner);
  const path = [
    ["E", 2, 1], ["E", 3, 1], ["E", 4, 1],
    ["S", 4, 2], ["S", 4, 3],
    ["E", 5, 3],
    ["N", 5, 2], ["N", 5, 1],
    ["W", 4, 1], ["W", 3, 1], ["W", 2, 1], ["W", 1, 1],
  ];
  let navOk = true;
  for (const [dir, ex, ey] of path) {
    if (!navSys.move(runner, dir) || runner.x !== ex || runner.y !== ey) {
      navOk = false;
      break;
    }
  }
  check("full path navigation respects collision", navOk);

  return out;
}
