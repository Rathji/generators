// Validation tests for Task #105: Airship Travel Integration.

import { TRAVEL_ACCESS, TravelAccessSystem } from "../engine/travel.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { MAPS } from "../data/maps.js";
import { LANDMARKS } from "../data/landmarks.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { TileMap } from "../engine/grid.js";
import { TerrainRules, TRAVEL_MODES } from "../engine/terrain.js";
import { WorldMapTerrainSystem } from "../engine/world-terrain.js";

function bfsReachable(ow, tm, wt, start, goal, mode) {
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

  // Travel access definition.
  const air = TRAVEL_ACCESS.air;
  check("air travel mode defined", !!air);
  check("air requires the engine item", air.require.type === "item" && air.require.itemId === "airshipEngine");
  check("air obtain flag is airship_obtained", air.obtain.type === "flag" && air.obtain.flag === "airship_obtained");

  // canUse gates on the engine item via the world's hasItem.
  const state = new GameState();
  const inv = new Inventory();
  const world = { hasItem: (id) => inv.has(id) };
  const travel = new TravelAccessSystem(TRAVEL_ACCESS, { state, world });
  check("airship locked without engine", travel.canUse("air") === false);
  inv.add("airshipEngine", 1);
  check("airship usable with engine", travel.canUse("air") === true);
  check("requirement reports hint", travel.requirement("air").hint.includes("airship engine"));

  // grant() sets the obtain flag (belt-and-suspenders path).
  const state2 = new GameState();
  const travel2 = new TravelAccessSystem(TRAVEL_ACCESS, { state: state2, world: { hasItem: () => false } });
  const g = travel2.grant("air");
  check("grant succeeds", g.ok === true && g.mode === "air");
  check("grant sets flag", state2.getFlag("airship_obtained") === true);

  // The iron sentinel boss is the story grant point.
  const ev = WORLD_EVENTS.find((e) => e.id === "iron_sentinel_boss");
  check("iron sentinel grants airship on win", ev && ev.event.onWinFlag === "airship_obtained");

  // Wind Shrine landmark exists at (6,2) for the airship arc.
  const lm = LANDMARKS.find((l) => l.id === "wind_shrine");
  check("wind shrine landmark exists", !!lm);
  check("wind shrine at (6,2)", lm && lm.x === 6 && lm.y === 2);
  check("wind shrine reveal gated on story", lm && lm.revealFlag === "story_started");

  // Airship traverses every terrain; land cannot stand on mountains/water.
  const ow = MAPS.find((m) => m.id === "overworld");
  const tm = TileMap.fromAscii(ow.rows, { tiles: ow.tiles, solid: ow.solid });
  const wt = new WorldMapTerrainSystem(new TerrainRules(ow));
  check("mountain tile standable in air", tm.canStand(4, 2) && wt.isTraversable(4, 2, TRAVEL_MODES.AIR));
  check("mountain tile not land-traversable", !wt.isTraversable(4, 2, TRAVEL_MODES.LAND));
  check("water tile traversable in air", wt.isTraversable(17, 10, TRAVEL_MODES.AIR));

  // Wind Shrine (6,2) reachable by air from the Elfheim gate.
  check(
    "wind shrine air-reachable from Elfheim",
    bfsReachable(ow, tm, wt, [16, 13], [6, 2], TRAVEL_MODES.AIR)
  );

  // The gnome tunnels entrance (14,13) is air-reachable too (fast-travel hub).
  check(
    "gnome tunnels entrance air-reachable from Cornelia",
    bfsReachable(ow, tm, wt, [7, 9], [14, 13], TRAVEL_MODES.AIR)
  );

  return out;
}
