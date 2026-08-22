// Validation tests for Task #53: Dungeon Level Transition Logic.

import { DungeonSystem } from "../engine/dungeons.js";
import { DUNGEONS } from "../data/dungeons.js";
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

  const maps = new MapManager();
  for (const def of MAPS) maps.register(def);
  const transitions = new TransitionManager(maps);
  const buildings = new BuildingSystem(BUILDINGS);
  buildings.registerTransitions(transitions);
  const sys = new DungeonSystem(DUNGEONS, { transitions, maps });
  sys.registerTransitions(transitions);

  check("dungeon def", sys.def("caves_of_cornelia")?.name === "Caves of Cornelia");
  check("ids", sys.ids().includes("caves_of_cornelia"));
  check("dungeonForMap", sys.dungeonForMap("caves_of_cornelia_b2")?.id === "caves_of_cornelia");
  check("dungeonForMap unknown", sys.dungeonForMap("cornelia") === null);

  check("two levels", sys.levels("caves_of_cornelia").length === 2);
  check("levelIndex", sys.levelIndex("caves_of_cornelia", "caves_of_cornelia_b2") === 1);
  check("levelOf", sys.levelOf("caves_of_cornelia", "caves_of_cornelia_b2")?.number === 2);
  check("isLowestLevel", sys.isLowestLevel("caves_of_cornelia", "caves_of_cornelia_b2") === true);
  check("isTopLevel", sys.isTopLevel("caves_of_cornelia", "caves_of_cornelia_b2") === false);

  check("stairAt finds stair", sys.stairAt("caves_of_cornelia", "caves_of_cornelia", 14, 10)?.id === "cave_l2_down");
  check("stairAt none", sys.stairAt("caves_of_cornelia", "caves_of_cornelia", 0, 0) === null);

  const down = sys.useStairs("caves_of_cornelia", "caves_of_cornelia", 14, 10);
  check("descend resolves", down && down.to.mapId === "caves_of_cornelia_b2" && down.to.x === 7 && down.to.y === 1);
  check("current level tracked", sys.currentLevelName() === "Caves — Lower Level");
  check("transition applied", transitions.current.mapId === "caves_of_cornelia_b2");

  const up = sys.useStairs("caves_of_cornelia", "caves_of_cornelia_b2", 13, 3);
  check("ascend resolves", up && up.to.mapId === "caves_of_cornelia" && up.to.x === 12 && up.to.y === 10);
  check("current level back to top", sys.currentLevelName() === "Caves — Upper Level");

  const exit = sys.exit("caves_of_cornelia", "caves_of_cornelia", 9, 5);
  check("exit to overworld", exit && exit.to.mapId === "overworld" && exit.to.x === 10 && exit.to.y === 4);
  check("current cleared on exit", sys.current === null);
  check("exit no tile", sys.exit("caves_of_cornelia", "caves_of_cornelia", 0, 0) === null);

  const d2 = new DungeonSystem(DUNGEONS, { transitions, maps });
  check("no stairs without dungeon", d2.useStairs("nope", "x", 0, 0) === null);

  transitions.start("cornelia", 2, 1, "S");
  const viaLink = transitions.transitionAt(2, 1);
  check("buildings links still intact", viaLink && viaLink.to.mapId === "cornelia_house");

  sys.reset();
  check("reset clears current", sys.current === null);

  return out;
}
