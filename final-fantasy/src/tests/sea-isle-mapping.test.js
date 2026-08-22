// Validation tests for Task #111: Ocean Expansion + Windfall Isle.
//
// The overworld grew east to 23 columns: an open sea beyond the Elfheim bay
// with the ship-only Windfall Isle (cols 19-22, rows 10-12).

import { MAPS } from "../data/maps.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules, TRAVEL_MODES } from "../engine/terrain.js";
import { WorldMapTerrainSystem } from "../engine/world-terrain.js";

function bfs(ow, tm, wt, start, goal, mode) {
  const seen = new Set([start[0] + "," + start[1]]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal[0] && y === goal[1]) return true;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      const k = nx + "," + ny;
      if (seen.has(k)) continue;
      if (!tm.inBounds(nx, ny) || !tm.canStand(nx, ny)) continue;
      if (!wt.isTraversable(nx, ny, mode)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return false;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ow = MAPS.find((m) => m.id === "overworld");
  check("overworld exists", !!ow);
  check("overworld is 27 wide", ow.rows.every((r) => r.length === 27), "widths: " + [...new Set(ow.rows.map((r) => r.length))].join(","));
  check("overworld still 15 tall", ow.rows.length === 15);

  const tm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  const wt = new WorldMapTerrainSystem(new TerrainRules(ow));

  // The island exists as a landmass (Walkable Isle rows 10-12, cols 19-22).
  const islandTiles = [
    [20, 10], [21, 10],
    [19, 11], [20, 11], [21, 11], [22, 11],
    [19, 12], [20, 12], [21, 12], [22, 12],
  ];
  for (const [x, y] of islandTiles) {
    check(`island tile (${x},${y}) is land`, wt.terrainAt(x, y) === "land" && tm.canStand(x, y));
  }

  // The island is ringed by open water (ship can dock all around it).
  const ringWater = [[19, 10], [22, 10], [19, 13], [20, 13], [21, 13], [22, 13], [18, 10], [18, 12], [18, 13]];
  for (const [x, y] of ringWater) {
    check(`ring water (${x},${y}) is water`, wt.terrainAt(x, y) === "water");
  }

  // The Elfheim bay (existing east water) connects to the open sea.
  check("bay connects to open sea", wt.terrainAt(18, 10) === "water" && wt.terrainAt(19, 10) === "water");

  // The island is ship-reachable from the Elfheim shore (17,13) but NOT on
  // foot (ship-only destination). Pravog's pond is landlocked, so the real
  // ship route runs through the Elfheim bay. The ship docks at a coastal
  // tile; the interior (20,11) is reached on foot afterward.
  check("island ship-reachable from Elfheim shore", bfs(ow, tm, wt, [17, 13], [20, 12], TRAVEL_MODES.SHIP));
  check("island ship-reachable from bay interior", bfs(ow, tm, wt, [16, 11], [21, 12], TRAVEL_MODES.SHIP));
  check("island not foot-reachable from Elfheim shore", !bfs(ow, tm, wt, [17, 13], [20, 11], TRAVEL_MODES.LAND));

  // Old landmarks remain standable (existing coordinates untouched).
  const keep = [[13, 2], [7, 9], [10, 4], [2, 8], [1, 6], [5, 5], [16, 13], [6, 2], [14, 13], [2, 10]];
  for (const [x, y] of keep) {
    check(`legacy tile (${x},${y}) standable`, tm.inBounds(x, y) && tm.canStand(x, y));
  }

  // Task #141: the Glacier Isle (cols 24-26, rows 10-13) is ice terrain,
  // walkable on foot and dockable by ship through the channel at col 23.
  for (const [x, y] of [[24, 10], [25, 10], [26, 10], [24, 11], [25, 11], [24, 12], [25, 13], [26, 13]]) {
    check(`glacier tile (${x},${y}) is ice`, wt.terrainAt(x, y) === "ice" && tm.canStand(x, y));
  }
  check("glacier channel water (23,11)", wt.terrainAt(23, 11) === "water");
  check("glacier isle walkable on foot", bfs(ow, tm, wt, [24, 11], [26, 12], TRAVEL_MODES.LAND));
  check("glacier isle ship-reachable from windfall", bfs(ow, tm, wt, [21, 13], [24, 11], TRAVEL_MODES.SHIP));
  check("glacier isle not ship-sailable over ice interior", !bfs(ow, tm, wt, [24, 12], [25, 13], TRAVEL_MODES.SHIP));

  return out;
}
