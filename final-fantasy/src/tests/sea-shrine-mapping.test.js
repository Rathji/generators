// Validation tests for Task #113: Sea Shrine Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { ITEMS } from "../data/items.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { TransitionManager, MapManager } from "../engine/transitions.js";

function byId(id) {
  return MAPS.find((m) => m.id === id);
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const shrine = DUNGEONS.sea_shrine;
  check("sea shrine dungeon defined", !!shrine);
  check("shrine has three levels", shrine && shrine.levels.length === 3);
  check("level 1 map exists", !!byId("sea_shrine"));
  check("level 2 map exists", !!byId("sea_shrine_b2"));

  for (const id of ["sea_shrine", "sea_shrine_b2"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && typeof m.theme === "string");
  }

  // Entry/exit/stairs on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("sea_shrine").rows, { tiles: byId("sea_shrine").tiles, solid: byId("sea_shrine").solid });
  const tm2 = TileMap.fromAscii(byId("sea_shrine_b2").rows, { tiles: byId("sea_shrine_b2").tiles, solid: byId("sea_shrine_b2").solid });
  const entry = shrine.entry;
  check("shrine entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));
  for (const s of shrine.stairs) {
    const tm = s.fromMap === "sea_shrine" ? tm1 : tm2;
    const toTm = s.toMap === "sea_shrine" ? tm1 : tm2;
    check("shrine stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("shrine stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of shrine.exits) {
    const tm = ex.mapId === "sea_shrine" ? tm1 : tm2;
    check("shrine exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
  }

  // DungeonSystem resolves transitions; exit returns to Windfall's shrine door.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("sea_shrine", "sea_shrine", 14, 10);
  check("shrine stairs descend", down && down.to.mapId === "sea_shrine_b2");
  const up = sys.useStairs("sea_shrine", "sea_shrine_b2", 14, 4);
  check("shrine stairs ascend", up && up.to.mapId === "sea_shrine");
  const exit = sys.exit("sea_shrine", "sea_shrine", 7, 1);
  check("shrine exit returns to Windfall", exit && exit.to.mapId === "windfall" && exit.to.x === 10 && exit.to.y === 1);

  // Windfall's shrine door links into the shrine.
  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  const tman = new TransitionManager(reg);
  tman.addLink({ fromMap: "windfall", fromX: 10, fromY: 1, toMap: "sea_shrine", toX: 7, toY: 5, facing: "N" });
  tman.start("windfall", 10, 1, "N");
  const into = tman.transitionAt(10, 1);
  check("village shrine door -> sea shrine", into && into.to.mapId === "sea_shrine" && into.to.x === 7 && into.to.y === 5);

  // Decorative coral tiles are non-solid and walkable.
  check("coral tile at (13,2) walkable", tm1.inBounds(13, 2) && tm1.canStand(13, 2));
  check("coral tile at (3,8) walkable", tm1.inBounds(3, 8) && tm1.canStand(3, 8));
  check("coral tile at (3,3) walkable", tm2.inBounds(3, 3) && tm2.canStand(3, 3));
  check("coral tile at (8,5) walkable", tm2.inBounds(8, 5) && tm2.canStand(8, 5));

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "sea_shrine" || c.mapId === "sea_shrine_b2");
  check("shrine has chests", chests.length >= 2);
  for (const c of chests) {
    const tm = c.mapId === "sea_shrine" ? tm1 : tm2;
    check("shrine chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Boss lair tile in the sunken sanctum is walkable (Tide Serpent, Task #115).
  check("sanctum boss tile walkable", tm2.inBounds(3, 5) && tm2.canStand(3, 5));

  // The sea arc's key items exist.
  check("tideKey item exists", !!ITEMS.tideKey && ITEMS.tideKey.type === "key" && ITEMS.tideKey.keyId === "tide");
  check("tritonHarpoon exists", !!ITEMS.tritonHarpoon && ITEMS.tritonHarpoon.type === "weapon");
  check("tritonCrown exists", !!ITEMS.tritonCrown && ITEMS.tritonCrown.type === "accessory");

  return out;
}
