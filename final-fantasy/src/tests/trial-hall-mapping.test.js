// Validation tests for Task #161: Hall of Trials map, building, and gate.

import { MAPS } from "../data/maps.js";
import { BUILDINGS } from "../data/buildings.js";
import { BuildingSystem } from "../engine/buildings.js";
import { MapManager, TransitionManager } from "../engine/transitions.js";
import { GateSystem } from "../engine/gates.js";
import { TileMap } from "../engine/grid.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const hall = MAPS.find((m) => m.id === "trial_hall");
  check("trial_hall map exists", !!hall);
  check("rows are square", !!hall && hall.rows.every((r) => r.length === hall.rows[0].length));
  check("wide enough", !!hall && hall.rows[0].length >= 8);
  check("uses time theme", hall?.theme === "dungeon_time");
  check("trial gate pedestals present", !!hall && hall.rows[3].includes("T"));
  check("pedestal tiles declared", !!hall && hall.tiles.T !== undefined);
  check("exit tile walkable", (() => {
    if (!hall) return false;
    const tm = TileMap.fromAscii(hall.rows, { tiles: hall.tiles, solid: hall.solid });
    return tm.canStand(7, 6);
  })());
  check("gate pedestal walkable", (() => {
    if (!hall) return false;
    const tm = TileMap.fromAscii(hall.rows, { tiles: hall.tiles, solid: hall.solid });
    return tm.canStand(7, 3);
  })());

  const sys = new BuildingSystem(BUILDINGS);
  const b = sys.buildingById("trial_hall");
  check("building defined", !!b);
  check("building in cornelia", b?.town === "cornelia");
  check("door tile free", (() => {
    const town = MAPS.find((m) => m.id === "cornelia");
    if (!town) return false;
    const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
    return tm.inBounds(b.door.x, b.door.y) && tm.canStand(b.door.x, b.door.y);
  })());
  check("buildingAt resolves", sys.buildingAt("cornelia", 13, 1)?.id === "trial_hall");
  check("interior map matches data", b?.interior.mapId === "trial_hall");

  // Transition registration both ways.
  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  const transitions = new TransitionManager(maps);
  sys.registerTransitions(transitions);
  transitions.start("cornelia", 13, 1, "S");
  const t1 = transitions.transitionAt(13, 1);
  check("door link into hall", t1 && t1.to.mapId === "trial_hall" && t1.to.x === 7 && t1.to.y === 5);
  transitions.start("trial_hall", 7, 6, "N");
  const t2 = transitions.transitionAt(7, 6);
  check("exit link back to cornelia", t2 && t2.to.mapId === "cornelia" && t2.to.x === 13 && t2.to.y === 1);

  // Gate: sealed until Chrono falls.
  const sealed = new GateSystem({ getFlag: () => false });
  sealed.add({ id: "trial_hall_gate", mapId: "cornelia", x: 13, y: 1, require: { flag: "story_chrono_defeated" }, deniedDialogue: "sealed" });
  check("hall sealed before chrono", sealed.canPass("cornelia", 13, 1).allowed === false);
  check("denied dialogue present", typeof sealed.canPass("cornelia", 13, 1).reason === "string");
  const open = new GateSystem({ getFlag: (n) => n === "story_chrono_defeated" });
  open.add({ id: "trial_hall_gate", mapId: "cornelia", x: 13, y: 1, require: { flag: "story_chrono_defeated" }, deniedDialogue: "sealed" });
  check("hall opens after chrono", open.canPass("cornelia", 13, 1).allowed === true);
  check("ungated tile unaffected", open.canPass("cornelia", 2, 1).allowed === true);

  return out;
}
