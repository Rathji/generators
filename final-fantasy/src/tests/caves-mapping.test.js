// Validation tests for Task #84: The Caves of Cornelia Mapping.

import { MAPS } from "../data/maps.js";
import { DUNGEONS } from "../data/dungeons.js";
import { CHESTS } from "../data/chests.js";
import { PUZZLES } from "../data/puzzles.js";
import { TileMap } from "../engine/grid.js";
import { DungeonSystem } from "../engine/dungeons.js";

function byId(id) {
  return MAPS.find((m) => m.id === id);
}

function buildTm(id) {
  const m = byId(id);
  return TileMap.fromAscii(m.rows, { tiles: m.tiles, solid: m.solid });
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const cave = DUNGEONS.caves_of_cornelia;
  check("caves dungeon defined", !!cave);
  check("caves has two levels", cave.levels.length === 2);
  check("upper level map exists", !!byId("caves_of_cornelia"));
  check("lower level map exists", !!byId("caves_of_cornelia_b2"));

  // Maps are square.
  for (const id of ["caves_of_cornelia", "caves_of_cornelia_b2"]) {
    const m = byId(id);
    check(id + " square", m && m.rows.every((r) => r.length === m.rows[0].length));
  }

  const tm1 = buildTm("caves_of_cornelia");
  const tm2 = buildTm("caves_of_cornelia_b2");

  // Stairs and exits sit on walkable tiles.
  for (const s of cave.stairs) {
    const tm = buildTm(s.fromMap);
    check("stair tile walkable: " + s.id, tm.inBounds(s.x, s.y) && tm.canStand(s.x, s.y));
    const toTm = buildTm(s.toMap);
    check("stair destination walkable: " + s.id, toTm.inBounds(s.toX, s.toY) && toTm.canStand(s.toX, s.toY));
  }
  for (const ex of cave.exits) {
    const tm = buildTm(ex.mapId);
    check("exit tile walkable", tm.inBounds(ex.x, ex.y) && tm.canStand(ex.x, ex.y));
    check("exit destination in bounds", tm1.inBounds(ex.toX, ex.toY));
  }

  // DungeonSystem resolves stairs and exits.
  const sys = new DungeonSystem(DUNGEONS, {});
  const down = sys.useStairs("caves_of_cornelia", "caves_of_cornelia", 14, 10);
  check("stairs descend to lower level", down && down.to.mapId === "caves_of_cornelia_b2");
  const up = sys.useStairs("caves_of_cornelia", "caves_of_cornelia_b2", 13, 3);
  check("stairs ascend to upper level", up && up.to.mapId === "caves_of_cornelia");
  const exit = sys.exit("caves_of_cornelia", "caves_of_cornelia", 9, 5);
  check("cave exit returns to overworld", exit && exit.to.mapId === "overworld");

  // Chest placements inside the cave are on walkable tiles.
  const caveChests = CHESTS.filter((c) => c.mapId === "caves_of_cornelia" || c.mapId === "caves_of_cornelia_b2");
  check("caves have chests", caveChests.length >= 2);
  for (const c of caveChests) {
    const tm = buildTm(c.mapId);
    check("chest on walkable tile: " + c.id, tm.inBounds(c.x, c.y) && tm.canStand(c.x, c.y));
  }

  // Puzzle door + switch inside the lower level.
  const puzzle = PUZZLES.find((p) => p.id === "cave_lower_gate");
  check("cave puzzle defined", !!puzzle);
  if (puzzle) {
    const door = puzzle.doors[0];
    check("puzzle door walkable when open", tm2.inBounds(door.x, door.y));
    const sw = puzzle.switches[0];
    check("puzzle switch walkable", tm2.inBounds(sw.x, sw.y) && tm2.canStand(sw.x, sw.y));
  }

  // The demo's spawn tile is walkable.
  const entry = cave.entry;
  check("demo spawn walkable", tm1.inBounds(entry.x, entry.y) && tm1.canStand(entry.x, entry.y));

  return out;
}
