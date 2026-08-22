// Validation tests for Task #97: Chaos Shrine Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";
import { WORLD_EVENTS } from "../data/world-events.js";

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

  const shrine = DUNGEONS.chaos_shrine;
  check("chaos shrine dungeon defined", !!shrine);
  check("shrine has two levels", shrine.levels.length === 2);
  check("shrine level 1 map exists", !!byId("chaos_shrine"));
  check("shrine level 2 map exists", !!byId("chaos_shrine_b2"));

  for (const id of ["chaos_shrine", "chaos_shrine_b2"]) {
    const m = byId(id);
    check(id + " rows square", m && m.rows.every((r) => r.length === m.rows[0].length));
    check(id + " themed", m && typeof m.theme === "string");
  }

  // Entry/exit/stairs on walkable tiles.
  const tm1 = TileMap.fromAscii(byId("chaos_shrine").rows, { tiles: byId("chaos_shrine").tiles, solid: byId("chaos_shrine").solid });
  const tm2 = TileMap.fromAscii(byId("chaos_shrine_b2").rows, { tiles: byId("chaos_shrine_b2").tiles, solid: byId("chaos_shrine_b2").solid });
  const entry = shrine.entry;
  check("shrine entry walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));
  for (const s of shrine.stairs) {
    const tm = s.fromMap === "chaos_shrine" ? tm1 : tm2;
    const toTm = s.toMap === "chaos_shrine" ? tm1 : tm2;
    check("shrine stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    check("shrine stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of shrine.exits) {
    const tm = ex.mapId === "chaos_shrine" ? tm1 : tm2;
    check("shrine exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
  }

  // DungeonSystem resolves shrine transitions.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("chaos_shrine", "chaos_shrine", 14, 10);
  check("shrine stairs descend", down && down.to.mapId === "chaos_shrine_b2");
  const up = sys.useStairs("chaos_shrine", "chaos_shrine_b2", 14, 4);
  check("shrine stairs ascend", up && up.to.mapId === "chaos_shrine");
  const exit = sys.exit("chaos_shrine", "chaos_shrine", 7, 1);
  check("shrine exit returns to overworld", exit && exit.to.mapId === "overworld");

  // The overworld entrance tile is walkable land and hosts the Garland event.
  const ow = byId("overworld");
  const owTm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  check("overworld shrine entrance walkable", owTm.inBounds(13, 2) && owTm.canStand(13, 2));
  const garland = WORLD_EVENTS.find((e) => e.id === "chaos_shrine_boss");
  check("garland blocks the shrine entrance", garland && garland.mapId === "overworld" && garland.x === 13 && garland.y === 2);
  check("garland requires the crystal key", garland?.require.flag === "crystal_key_found");

  // Chests in the shrine sit on walkable tiles.
  const shrineChests = CHESTS.filter((c) => c.mapId === "chaos_shrine" || c.mapId === "chaos_shrine_b2");
  check("shrine has chests", shrineChests.length >= 2);
  for (const c of shrineChests) {
    const tm = c.mapId === "chaos_shrine" ? tm1 : tm2;
    check("shrine chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Boss lair tile in the dark altar is walkable.
  check("chaos boss lair tile walkable", tm2.inBounds(3, 5) && tm2.canStand(3, 5));

  return out;
}
