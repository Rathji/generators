// Validation tests for Task #76: World Map Terrain Constraints.

import { TerrainRules, TRAVEL_MODES, TERRAIN_TYPES } from "../engine/terrain.js";
import { WorldMapTerrainSystem, TERRAIN_COSTS, TERRAIN_LABELS } from "../engine/world-terrain.js";

function makeRules(rows) {
  return new TerrainRules({ rows, terrain: { "~": "water", "^": "mountain", "*": "forest", "+": "ice" } });
}

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const rules = makeRules(["...++...", "..~~~~~~", ".*.^^...", ".....+.."]);
  const sys = new WorldMapTerrainSystem(rules);

  // Plain land is cheap and walkable for land travel.
  check("plain costs 1 on foot", sys.moveCost(0, 0, TRAVEL_MODES.LAND) === 1);
  check("plain traversable", sys.isTraversable(0, 0, TRAVEL_MODES.LAND));

  // Forest slows land travel but remains passable.
  check("forest costs 2 on foot", sys.moveCost(1, 2, TRAVEL_MODES.LAND) === 2);
  check("forest half speed", Math.abs(sys.speedModifier(1, 2, TRAVEL_MODES.LAND) - 0.5) < 1e-9);
  check("forest traversable on foot", sys.isTraversable(1, 2, TRAVEL_MODES.LAND));

  // Mountains are impassable on foot but free for the airship.
  check("mountain impassable on foot", !Number.isFinite(sys.moveCost(3, 2, TRAVEL_MODES.LAND)));
  check("mountain passable by air", sys.isTraversable(3, 2, TRAVEL_MODES.AIR));
  check("mountain costs 1 by air", sys.moveCost(3, 2, TRAVEL_MODES.AIR) === 1);

  // Water needs a ship; land cannot cross.
  check("water impassable on foot", !Number.isFinite(sys.moveCost(2, 1, TRAVEL_MODES.LAND)));
  check("water passable by ship", sys.isTraversable(2, 1, TRAVEL_MODES.SHIP));
  check("water costs 1 by ship", sys.moveCost(2, 1, TRAVEL_MODES.SHIP) === 1);

  // Ice is frozen land: walkable on foot, free for the airship. A ship can
  // dock at coastal ice (like land) but cannot sail across interior ice.
  check("ice costs 1 on foot", sys.moveCost(3, 0, TRAVEL_MODES.LAND) === 1);
  check("ice traversable on foot", sys.isTraversable(3, 0, TRAVEL_MODES.LAND));
  check("coastal ice docks a ship", sys.moveCost(3, 0, TRAVEL_MODES.SHIP) === 1);
  check("interior ice blocks ship", !Number.isFinite(sys.moveCost(5, 3, TRAVEL_MODES.SHIP)));
  check("ice passable by air", sys.moveCost(3, 0, TRAVEL_MODES.AIR) === 1);
  check("ice label", sys.describeTile(3, 0).label === "Ice");

  // Path costs sum per tile.
  check("path over plain cost 2", sys.pathCost(0, 0, "E", 2, TRAVEL_MODES.LAND) === 2);
  check("path through forest cost 3", sys.pathCost(0, 2, "E", 2, TRAVEL_MODES.LAND) === 3);
  check("path blocked by water is infinite", !Number.isFinite(sys.pathCost(0, 1, "E", 4, TRAVEL_MODES.LAND)));
  check("path over water by ship works", sys.pathCost(1, 1, "E", 6, TRAVEL_MODES.SHIP) === 6);

  // Out-of-bounds is never traversable.
  check("out of bounds not traversable", !sys.isTraversable(9, 9, TRAVEL_MODES.AIR));

  // describeTile reports labels/costs.
  const desc = sys.describeTile(1, 2);
  check("describeTile label forest", desc.label === "Forest");
  check("describeTile cost 2", desc.cost === 2);
  check("describeTile traversable", desc.traversable === true);
  check("terrain label map complete", TERRAIN_LABELS[TERRAIN_TYPES.FOREST] === "Forest");

  // Cost table covers every terrain type for every mode.
  const audit = WorldMapTerrainSystem.validateCostTable(TERRAIN_COSTS);
  check("cost table fully specified", audit.length === 0, JSON.stringify(audit));

  // Real overworld map honors these constraints.
  const { MAPS } = await import("../data/maps.js");
  const overworld = MAPS.find((m) => m.id === "overworld");
  const realRules = new TerrainRules(overworld);
  const real = new WorldMapTerrainSystem(realRules);
  const hasTerrain = (t) => {
    for (let y = 0; y < realRules.height; y++) {
      for (let x = 0; x < realRules.width; x++) {
        if (realRules.terrainAt(x, y) === t) return true;
      }
    }
    return false;
  };
  check("overworld contains forest tiles", hasTerrain("forest"));
  check("overworld contains mountains", hasTerrain("mountain"));
  check("overworld contains water", hasTerrain("water"));
  check("overworld contains ice", hasTerrain("ice"));
  check("overworld rows are square", overworld.rows.every((r) => r.length === overworld.rows[0].length));
  check("real overworld plain walkable", real.isTraversable(3, 4, TRAVEL_MODES.LAND));
  check("real overworld mountain blocks land", !real.isTraversable(3, 2, TRAVEL_MODES.LAND));
  check("real overworld water blocks land", !real.isTraversable(4, 6, TRAVEL_MODES.LAND));
  check("real overworld water allows ship", real.isTraversable(4, 6, TRAVEL_MODES.SHIP));
  check("real overworld glacier ice walkable", real.isTraversable(25, 11, TRAVEL_MODES.LAND));
  check("real overworld ice coast docks ship", real.isTraversable(24, 11, TRAVEL_MODES.SHIP));

  return out;
}
