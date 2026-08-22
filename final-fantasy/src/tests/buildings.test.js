// Validation tests for Task #50: Residential Interior Mapping.

import { BuildingSystem } from "../engine/buildings.js";
import { BUILDINGS } from "../data/buildings.js";
import { MAPS } from "../data/maps.js";
import { MapManager, TransitionManager } from "../engine/transitions.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new BuildingSystem(BUILDINGS);

  check("cornelia has buildings", sys.buildingsFor("cornelia").length === 5);
  check("buildingAt door", sys.buildingAt("cornelia", 2, 1)?.id === "cornelia_house");
  check("buildingAt empty tile", sys.buildingAt("cornelia", 3, 3) === null);
  check("buildingById", sys.buildingById("cornelia_shop")?.name === "General Store");

  const enter = sys.enter("cornelia", 2, 1);
  check("enter resolves interior", enter && enter.mapId === "cornelia_house" && enter.x === 3 && enter.y === 4);
  check("enter empty tile", sys.enter("cornelia", 5, 5) === null);

  const exit = sys.exit("cornelia_house");
  check("exit resolves town door", exit && exit.mapId === "cornelia" && exit.x === 2 && exit.y === 1);
  check("exit unknown interior", sys.exit("bogus") === null);

  check("interiorOf", sys.interiorOf("cornelia", 10, 1) === "cornelia_shop");
  check("townOfInterior", sys.townOfInterior("cornelia_shop") === "cornelia");

  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  const transitions = new TransitionManager(maps);
  sys.registerTransitions(transitions);

  transitions.start("cornelia", 2, 1, "S");
  const t1 = transitions.transitionAt(2, 1);
  check("registered door link resolves", t1 && t1.to.mapId === "cornelia_house" && t1.to.x === 3 && t1.to.y === 4);

  transitions.start("cornelia_house", 3, 5, "N");
  const t2 = transitions.transitionAt(3, 5);
  check("registered exit link resolves", t2 && t2.to.mapId === "cornelia" && t2.to.x === 2 && t2.to.y === 1);

  const shopEnter = transitions.start("cornelia", 10, 1, "S") && transitions.transitionAt(10, 1);
  check("shop door link resolves", shopEnter && shopEnter.to.mapId === "cornelia_shop");

  check("interior maps are registered", maps.has("cornelia_house") && maps.has("cornelia_shop"));
  const houseDef = maps.get("cornelia_house");
  check("interior exit tile walkable", houseDef.rows[5][3] === ".");

  const noBuildings = new BuildingSystem({});
  check("empty system safe", noBuildings.enter("cornelia", 2, 1) === null && noBuildings.exit("x") === null);

  return out;
}
