// Validation tests for Task #106: Wind Shrine Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { LANDMARKS } from "../data/landmarks.js";

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

  const shrine = DUNGEONS.wind_shrine;
  check("wind shrine dungeon defined", !!shrine);
  check("shrine has two levels", shrine && shrine.levels.length === 2);
  check("level 1 map exists", !!byId("wind_shrine"));
  check("level 2 map exists", !!byId("wind_shrine_b2"));

  for (const id of ["wind_shrine", "wind_shrine_b2"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && typeof m.theme === "string");
  }

  // Entry/exit/stairs on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("wind_shrine").rows, { tiles: byId("wind_shrine").tiles, solid: byId("wind_shrine").solid });
  const tm2 = TileMap.fromAscii(byId("wind_shrine_b2").rows, { tiles: byId("wind_shrine_b2").tiles, solid: byId("wind_shrine_b2").solid });
  const entry = shrine.entry;
  check("shrine entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));
  for (const s of shrine.stairs) {
    const tm = s.fromMap === "wind_shrine" ? tm1 : tm2;
    const toTm = s.toMap === "wind_shrine" ? tm1 : tm2;
    check("shrine stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("shrine stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of shrine.exits) {
    const tm = ex.mapId === "wind_shrine" ? tm1 : tm2;
    check("shrine exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
  }

  // DungeonSystem resolves transitions.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("wind_shrine", "wind_shrine", 14, 10);
  check("shrine stairs descend", down && down.to.mapId === "wind_shrine_b2");
  const up = sys.useStairs("wind_shrine", "wind_shrine_b2", 14, 4);
  check("shrine stairs ascend", up && up.to.mapId === "wind_shrine");
  const exit = sys.exit("wind_shrine", "wind_shrine", 7, 1);
  check("shrine exit returns to overworld", exit && exit.to.mapId === "overworld");

  // The overworld entrance tile (6,2) is standable (forest, airship access).
  const ow = byId("overworld");
  const owTm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  check("overworld shrine entrance standable", owTm.inBounds(6, 2) && owTm.canStand(6, 2));
  const lm = LANDMARKS.find((l) => l.id === "wind_shrine");
  check("wind shrine landmark at entrance", lm && lm.x === 6 && lm.y === 2);

  // Decorative cloud tiles are non-solid and walkable.
  check("cloud tile at (13,2) walkable", tm1.inBounds(13, 2) && tm1.canStand(13, 2));
  check("cloud tile at (3,8) walkable", tm1.inBounds(3, 8) && tm1.canStand(3, 8));
  check("cloud tile at (3,3) walkable", tm2.inBounds(3, 3) && tm2.canStand(3, 3));
  check("cloud tile at (8,5) walkable", tm2.inBounds(8, 5) && tm2.canStand(8, 5));

  // Chests sit on walkable tiles.
  const chests = CHESTS.filter((c) => c.mapId === "wind_shrine" || c.mapId === "wind_shrine_b2");
  check("shrine has chests", chests.length >= 2);
  for (const c of chests) {
    const tm = c.mapId === "wind_shrine" ? tm1 : tm2;
    check("shrine chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Boss lair tile in the sky altar is walkable (Wind Fiend, Task #109).
  check("sky altar boss tile walkable", tm2.inBounds(3, 5) && tm2.canStand(3, 5));

  return out;
}
