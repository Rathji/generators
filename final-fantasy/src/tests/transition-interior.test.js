// Validation tests for Task #21: Interior/Exterior Map Transition.

import { MapManager, TransitionManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const reg = new MapManager();
  for (const def of MAPS) reg.register(def);
  check("dungeon map registered", reg.has("caves_of_cornelia"));
  const cave = reg.buildTileMap("caves_of_cornelia");
  check("dungeon tilemap materialized", cave.width === 15 && cave.height === 12);
  check("dungeon interior walkable", cave.canStand(9, 4) && cave.isSolid(0, 0));

  const tm = new TransitionManager(reg);
  tm.start("overworld", 7, 9, "S");

  const intoCave = tm.transitionTo("caves_of_cornelia", 9, 4, "N");
  check("transitionTo moves into interior", intoCave.to.mapId === "caves_of_cornelia" && intoCave.to.x === 9 && intoCave.to.y === 4);
  check("transitionTo preserves from state", intoCave.from.mapId === "overworld" && intoCave.from.facing === "S");
  check("exit stack depth 1", tm.depth === 1);
  check("last overworld position remembered", tm.lastPosition("overworld").x === 7 && tm.lastPosition("overworld").y === 9);
  const peek = tm.peekExit();
  check("peekExit shows exterior", peek.mapId === "overworld" && peek.x === 7 && peek.y === 9 && peek.facing === "S");

  const moved = tm.moveTo("caves_of_cornelia", 10, 6, "E");
  check("move within interior works", moved.to.x === 10 && moved.to.y === 6 && tm.depth === 1);
  tm.rememberPosition("caves_of_cornelia", 10, 6, "E");
  check("explicit rememberPosition records", tm.lastPosition("caves_of_cornelia").x === 10 && tm.lastPosition("caves_of_cornelia").facing === "E");

  const exit = tm.exitInterior();
  check("exitInterior returns to exterior coords", exit.to.mapId === "overworld" && exit.to.x === 7 && exit.to.y === 9);
  check("exitInterior restores facing", exit.to.facing === "S");
  check("exit stack cleared", tm.depth === 0);
  check("exitInterior when empty returns null", tm.exitInterior() === null);

  tm.start("caves_of_cornelia", 9, 4, "N");
  tm.rememberPosition("caves_of_cornelia", 5, 3, "W");
  const gone = tm.start("overworld", 1, 1, "S");
  check("restorePosition returns to remembered spot", tm.restorePosition("caves_of_cornelia") === true && tm.current.x === 5 && tm.current.y === 3 && tm.current.facing === "W");
  check("restorePosition unknown map false", tm.restorePosition("nope") === false);
  check("current still overworld after start", gone.mapId === "overworld");

  tm.start("overworld", 10, 4, "S");
  tm.addLink({ fromMap: "overworld", fromX: 10, fromY: 4, toMap: "caves_of_cornelia", toX: 9, toY: 4, facing: "N" });
  tm.addLink({ fromMap: "caves_of_cornelia", fromX: 9, fromY: 5, toMap: "overworld", toX: 10, toY: 4, facing: "S" });
  const viaLink = tm.transitionAt(10, 4);
  check("link into cave", viaLink.to.mapId === "caves_of_cornelia" && viaLink.to.x === 9 && viaLink.to.y === 4);
  const back = tm.transitionAt(9, 5);
  check("link out of cave", back.to.mapId === "overworld" && back.to.x === 10 && back.to.y === 4);

  const tm2 = new TransitionManager(reg);
  tm2.start("overworld", 7, 9, "S");
  tm2.transitionTo("cornelia_inn", 4, 4, "N");
  tm2.transitionTo("caves_of_cornelia", 9, 4, "N");
  check("nested interiors depth 2", tm2.depth === 2);
  const e1 = tm2.exitInterior();
  const e2 = tm2.exitInterior();
  check("nested exit returns to town", e1.to.mapId === "cornelia_inn");
  check("second exit returns to overworld", e2.to.mapId === "overworld" && e2.to.x === 7);
  check("depth back to 0", tm2.depth === 0);

  return out;
}
