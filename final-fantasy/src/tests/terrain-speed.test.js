// Validation tests for Task #136: Terrain-Based Movement Speed Modifiers.

import { TileMap } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { TerrainRules } from "../engine/terrain.js";
import { TerrainSpeedSystem } from "../engine/terrain-speed.js";

// row1: grass, mountain, water, forest then grass; row2: grass then ice;
// row3: open grass.
const ROWS = [
  "#############",
  "#.^~*.......#",
  "#..+........#",
  "#............#",
  "#############",
];
const DEF = {
  rows: ROWS,
  terrain: { "^": "mountain", "~": "water", "*": "forest", "+": "ice" },
  solid: { "#": true },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const rules = new TerrainRules(DEF);
  const ts = new TerrainSpeedSystem(rules);

  // Land walks grass at full speed and ice at half speed — but forests,
  // mountains and water stay impassable on foot (speed never unlocks
  // terrain the travel mode cannot enter).
  check("grass cost 1", ts.moveCost(1, 1) === 1);
  check("ice cost 2", ts.moveCost(3, 2) === 2);
  check("forest impassable on foot", ts.moveCost(4, 1) === Infinity);
  check("mountain impassable on foot", ts.moveCost(2, 1) === Infinity);
  check("water impassable on foot", ts.moveCost(3, 1) === Infinity);
  check("speed 1 on grass", ts.speedAt(1, 1) === 1);
  check("half speed on ice", ts.speedAt(3, 2) === 0.5);
  check("zero speed on blocked terrain", ts.speedAt(2, 1) === 0);
  // The airship is everywhere at cost 1; ships cross water at cost 1.
  check("airship crosses mountain at cost 1", ts.moveCost(2, 1, "air") === 1);
  check("ship crosses water at cost 1", ts.moveCost(3, 1, "ship") === 1);

  check("pathCost grass path", ts.pathCost(1, 3, "E", 2) === 2);
  check("pathCost grass then ice", ts.pathCost(1, 2, "E", 2) === 3);
  check("pathCost returns Infinity through mountain", ts.pathCost(1, 1, "E", 2) === Infinity);
  check("pathCost zero steps", ts.pathCost(1, 1, "W", 0) === 0);
  check("describeTile reports cost + speed", ts.describeTile(3, 2).cost === 2 && ts.describeTile(3, 2).speed === 0.5);
  check("validateCostTable clean", TerrainSpeedSystem.validateCostTable().length === 0);

  // MovementSystem integration: the scale becomes a movement budget.
  const map = TileMap.fromAscii(ROWS, { solid: { "#": true } });
  const sys = new MovementSystem(map);
  sys.setTerrain(rules);
  sys.setTerrainSpeed(ts);
  sys.setScale(3);

  // row3 is open grass: (1,3) -> (4,3) uses the full 3-tile budget.
  const hero = new GridEntity(1, 3, { facing: "S" });
  sys.addEntity(hero);
  const m1 = sys.moveScaled(hero, "E");
  check("open grass moves full scale", m1 === true && hero.x === 4 && hero.y === 3);

  // row2: grass then ice at (3,2) — ice eats 2 budget, halving distance.
  const sysF = new MovementSystem(map);
  sysF.setTerrain(rules);
  sysF.setTerrainSpeed(ts);
  sysF.setScale(3);
  const heroF = new GridEntity(1, 2, { facing: "S" });
  sysF.addEntity(heroF);
  const mF = sysF.moveScaled(heroF, "E");
  check("ice halves distance: 2 tiles on 3 budget", mF === true && heroF.x === 3 && heroF.y === 2);

  const sys2 = new MovementSystem(map);
  sys2.setTerrain(rules);
  sys2.setTerrainSpeed(ts);
  sys2.setScale(2);
  const h2 = new GridEntity(1, 1, { facing: "S" }); // (2,1) is mountain
  sys2.addEntity(h2);
  const blocked = sys2.moveScaled(h2, "E");
  check("mountain still blocks land movement", blocked === false && h2.x === 1);

  const air = new GridEntity(1, 1, { travelMode: "air", facing: "S" });
  const sys3 = new MovementSystem(map);
  sys3.setTerrain(rules);
  sys3.setTerrainSpeed(ts);
  sys3.setScale(4);
  sys3.addEntity(air);
  const airMoved = sys3.moveScaled(air, "E"); // air costs 1 everywhere
  check("airship ignores terrain costs", airMoved === true && air.x === 5 && air.y === 1);

  // No terrainSpeed bound -> old behavior (whole-scale leap).
  const sys4 = new MovementSystem(map);
  sys4.setTerrain(rules);
  sys4.setScale(3);
  const h4 = new GridEntity(1, 3);
  sys4.addEntity(h4);
  const leap = sys4.moveScaled(h4, "E");
  check("without terrainSpeed, moveScaled leaps scale tiles", leap === true && h4.x === 4);

  return out;
}
