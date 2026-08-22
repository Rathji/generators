// Validation tests for Tasks #35/#36: Ship/Water Navigation & Airship Flight.

import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { TerrainRules, terrainRulesFor, TRAVEL_MODES, TRAVEL_MODE_NAMES, TERRAIN_TYPES } from "../engine/terrain.js";
import { MAPS } from "../data/maps.js";

const SEA_DEF = {
  id: "sea",
  rows: ["###", "#.~", "###"],
  terrain: { "~": "water" },
  solid: { "#": true },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ow = MAPS.find((m) => m.id === "overworld");
  const tr = new TerrainRules(ow);
  check("terrain types", TERRAIN_TYPES.LAND === "land" && TRAVEL_MODES.SHIP === "ship" && TRAVEL_MODE_NAMES.air === "Airship");
  check("overworld terrain spec", tr.terrain["~"] === "water" && tr.terrain["^"] === "mountain");
  check("land tile classified", tr.terrainAt(7, 4) === "land");
  check("water tile classified", tr.isWater(6, 6) === true);
  check("mountain tile classified", tr.isMountain(3, 2) === true);
  check("out of bounds terrain", tr.terrainAt(-1, 0) === "land");

  check("land cannot enter water", tr.canTraverse("land", 6, 6) === false);
  check("ship can enter water", tr.canTraverse("ship", 6, 6) === true);
  check("ship cannot enter land", tr.canTraverse("ship", 7, 4) === false);
  check("ship cannot enter mountain", tr.canTraverse("ship", 3, 2) === false);
  check("air can enter anything", tr.canTraverse("air", 6, 6) === true && tr.canTraverse("air", 3, 2) === true && tr.canTraverse("air", 7, 4) === true);
  check("out of bounds blocks all modes", tr.canTraverse("air", -1, 5) === false && tr.canTraverse("land", 99, 99) === false);

  const seaMap = TileMap.fromAscii(SEA_DEF.rows, { solid: SEA_DEF.solid });
  const seaTerrain = terrainRulesFor(SEA_DEF);
  const sys = new MovementSystem(seaMap);
  sys.setTerrain(seaTerrain);
  const hero = new GridEntity(1, 1, { travelMode: "land", id: "hero" });
  sys.addEntity(hero);

  check("land blocked stepping onto water", sys.move(hero, "E") === false && hero.x === 1 && hero.facing === "E");
  hero.setTravelMode("ship");
  check("ship sails onto water", sys.move(hero, "E") === true && hero.x === 2 && hero.y === 1);
  check("ship docks back at coastal land", sys.move(hero, "W") === true && hero.x === 1);

  hero.setTravelMode("air");
  check("airship over water ok", sys.move(hero, "E") === true && hero.x === 2);
  check("airship flies to land", sys.move(hero, "W") === true && hero.x === 1);
  check("airship cannot leave bounds", sys.move(hero, "E") === true && sys.move(hero, "E") === false && hero.x === 2);

  const air = new GridEntity(1, 1, { travelMode: "air" });
  const sys2 = new MovementSystem(seaMap);
  sys2.setTerrain(seaTerrain);
  sys2.addEntity(air);
  check("air ignores terrain entirely", sys2.move(air, "E") === true && sys2.move(air, "W") === true);

  const noTerrainSys = new MovementSystem(seaMap);
  const walker = new GridEntity(1, 1);
  noTerrainSys.addEntity(walker);
  check("no terrain rules => water walkable", noTerrainSys.move(walker, "E") === true && walker.x === 2);

  const seaMap2 = TileMap.fromAscii(SEA_DEF.rows, { solid: SEA_DEF.solid });
  const shipScale = new MovementSystem(seaMap2);
  shipScale.setTerrain(seaTerrain);
  const fish2 = new GridEntity(1, 1, { travelMode: "ship" });
  shipScale.addEntity(fish2);
  check("ship walkable water", shipScale.isWalkable(2, 1, fish2, "ship") === true);
  check("ship docks at coastal land", shipScale.isWalkable(1, 1, fish2, "ship") === true);
  check("ship still barred from interior land", tr.canTraverse("ship", 8, 1) === false);

  check("modeAllowed sets", tr.modeAllowed("air").size === 5 && tr.modeAllowed("ship").has("water") && tr.modeAllowed("land").has("land") && tr.modeAllowed("land").has("ice"));

  return out;
}
