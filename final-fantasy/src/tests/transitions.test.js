// Validation tests for Task #19: Overworld-to-Town Transition Logic.

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
  check("maps registered", reg.has("overworld") && reg.has("cornelia") && reg.has("cornelia_inn"));
  check("unknown map null", reg.get("nope") === null);
  check("register returns this (chainable)", reg.register(MAPS[0]) === reg);

  const tm = new TransitionManager(reg);
  tm.addLink({ fromMap: "overworld", fromX: 7, fromY: 9, toMap: "cornelia", toX: 6, toY: 6, facing: "N" });
  tm.addLink({ fromMap: "cornelia", fromX: 6, fromY: 7, toMap: "overworld", toX: 7, toY: 9, facing: "S" });
  tm.addLink({ fromMap: "cornelia", fromX: 5, fromY: 6, toMap: "cornelia_inn", toX: 4, toY: 4, facing: "N" });
  tm.addLink({ fromMap: "cornelia_inn", fromX: 4, fromY: 5, toMap: "cornelia", toX: 5, toY: 6, facing: "N" });

  check("start on valid map", tm.start("overworld", 7, 9, "S")?.mapId === "overworld");
  check("start on unknown map null", tm.start("nope", 0, 0) === null);

  const intoTown = tm.transitionAt(7, 9);
  check("transition into town", intoTown.to.mapId === "cornelia" && intoTown.to.x === 6 && intoTown.to.y === 6);
  check("from-map recorded", intoTown.from.mapId === "overworld");
  check("current map updated", tm.current.mapId === "cornelia");

  const backOut = tm.transitionAt(6, 7);
  check("transition back to overworld", backOut.to.mapId === "overworld" && backOut.to.x === 7 && backOut.to.y === 9);

  tm.start("overworld", 7, 9, "S");
  const entered = tm.enterTown(7, 9, "cornelia", 6, 6);
  check("enterTown moves into town", entered.to.mapId === "cornelia");
  check("return point remembered", tm.returnPoint.mapId === "overworld" && tm.returnPoint.x === 7 && tm.returnPoint.y === 9);
  const left = tm.leaveTown();
  check("leaveTown returns to overworld", left.to.mapId === "overworld" && left.to.x === 7 && left.to.y === 9);
  check("return point cleared", tm.returnPoint === null);
  check("leaveTown without return null", tm.leaveTown() === null);

  check("transitionAt without link null", tm.transitionAt(1, 1) === null);
  check("moveTo unknown map null", tm.moveTo("nope", 0, 0) === null);

  const tileMap = reg.buildTileMap("cornelia");
  check("tilemap materialized", tileMap !== null && tileMap.width === 15 && tileMap.height === 8);
  check("tilemap collision", tileMap.isSolid(0, 0) === true && tileMap.canStand(7, 4) === true);

  const ow = reg.buildTileMap("overworld");
  check("overworld tilemap", ow.width === 27 && ow.height === 15);

  return out;
}
