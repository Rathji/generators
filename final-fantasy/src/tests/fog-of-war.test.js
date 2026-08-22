// Validation tests for Task #24: Dungeon Fog-of-War/Discovery System.

import { FogOfWar } from "../engine/fog-of-war.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const fog = new FogOfWar({ radius: 1 });
  check("fresh map unexplored", fog.isDiscovered("cave", 5, 5) === false && fog.count("cave") === 0);

  fog.discover("cave", 5, 5);
  check("single tile discovered", fog.isDiscovered("cave", 5, 5) === true);
  check("neighbor not discovered", fog.isDiscovered("cave", 6, 5) === false);

  fog.discoverRadius("cave", 5, 5);
  check("radius reveals 9 tiles", fog.count("cave") === 9);
  check("radius corner covered", fog.isDiscovered("cave", 4, 4) && fog.isDiscovered("cave", 6, 6));

  fog.discover("other", 0, 0);
  check("maps isolated", fog.isDiscovered("cave", 0, 0) === false && fog.isDiscovered("other", 0, 0) === true);

  const grid = fog.visibilityGrid("cave", 10, 8);
  check("grid dims", grid.length === 8 && grid[0].length === 10);
  check("grid marks explored", grid[5][5] === 1 && grid[0][0] === 0);
  check("grid clamps out of bounds", fog.discover("cave", -1, -1) && grid[-1] === undefined);

  const ascii = fog.renderMiniMap("cave", 10, 8, 5, 5);
  const lines = ascii.split("\n");
  check("minimap rows", lines.length === 8);
  check("minimap player marker", lines[5][5] === "@");
  check("minimap explored dot", lines[5][6] === "." || lines[4][5] === ".");
  check("minimap unexplored hash", lines[0][0] === "#");

  const deepFog = new FogOfWar({ radius: 2 });
  deepFog.discoverRadius("d", 3, 3);
  check("radius 2 reveals 25 tiles", deepFog.count("d") === 25);

  fog.reset("cave");
  check("reset map clears", fog.count("cave") === 0 && fog.isDiscovered("cave", 5, 5) === false);
  fog.discover("cave", 1, 1);
  fog.resetAll();
  check("resetAll clears everything", fog.count("cave") === 0 && fog.count("other") === 0);
  check("discoveredTiles lists coords", fog.discoveredTiles("cave").length === 0);

  const tiles = fog.discoverRadius("cave", 2, 2).discoveredTiles("cave");
  check("discoveredTiles parses coords", tiles.length === 9 && tiles.every((t) => typeof t.x === "number"));

  return out;
}
