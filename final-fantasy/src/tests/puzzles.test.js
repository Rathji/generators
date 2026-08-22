// Validation tests for Task #55: Dungeon Puzzle Trigger System.

import { PuzzleSystem } from "../engine/puzzles.js";
import { PUZZLES } from "../data/puzzles.js";
import { GameState } from "../engine/state.js";
import { TileMap } from "../engine/grid.js";
import { MovementSystem } from "../engine/movement.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const sys = new PuzzleSystem(PUZZLES, { state });

  const p = sys.puzzleById("cave_lower_gate");
  check("puzzle exists", p?.mapId === "caves_of_cornelia_b2");
  check("switchAt finds switch", sys.switchAt("caves_of_cornelia_b2", 11, 1)?.id === "plate_a");
  check("switchAt empty tile", sys.switchAt("caves_of_cornelia_b2", 0, 0) === null);
  check("doorAt finds door", sys.doorAt("caves_of_cornelia_b2", 2, 1)?.id === "gate");

  check("door closed before solve", sys.isOpen(p, p.doors[0]) === false);
  check("blockedAt true when closed", sys.blockedAt("caves_of_cornelia_b2", 2, 1) === true);
  check("blockedAt false on plain tile", sys.blockedAt("caves_of_cornelia_b2", 5, 1) === false);

  check("press on non-switch fails", sys.press("caves_of_cornelia_b2", 0, 0).ok === false);

  const press = sys.press("caves_of_cornelia_b2", 11, 1);
  check("press solves puzzle", press.ok === true && press.solved === true);
  check("required press count", press.pressed === 1 && press.required === 1);
  check("door now open", sys.isOpen(p, p.doors[0]) === true);
  check("blockedAt false when open", sys.blockedAt("caves_of_cornelia_b2", 2, 1) === false);
  check("solved flag persisted", state.getFlag("puzzle_cave_lower_solved") === true);
  check("isSolved", sys.isSolved(p) === true);
  check("press again blocked", sys.press("caves_of_cornelia_b2", 11, 1).ok === false);

  // Two-plate puzzle: only both presses open the doors.
  const multi = new PuzzleSystem([
    {
      id: "double_gate",
      mapId: "b2",
      flag: "double_gate_solved",
      switches: [{ id: "s1", x: 1, y: 1 }, { id: "s2", x: 2, y: 1 }],
      doors: [{ id: "d1", x: 3, y: 1 }],
      required: 2,
    },
  ]);
  const r1 = multi.press("b2", 1, 1);
  check("first press not solved", r1.ok === true && r1.solved === false);
  check("door still closed", multi.isDoorOpen("double_gate", 0) === false);
  const r2 = multi.press("b2", 2, 1);
  check("second press solves", r2.solved === true);
  check("door open now", multi.isDoorOpen("double_gate", 0) === true);

  // Movement integration via the walkability hook.
  const map = TileMap.fromAscii([
    "###########",
    "#...S...D.#",
    "#.........#",
    "###########",
  ], { solid: { "#": true } });
  const mov = new MovementSystem(map);
  const hook = new PuzzleSystem([
    { id: "mov_gate", mapId: "m", switches: [{ id: "sw", x: 5, y: 1 }], doors: [{ id: "door", x: 9, y: 1 }], required: 1 },
  ]).hookFor("m");
  mov.setWalkabilityHook(hook);
  check("door tile blocked by hook", mov.isWalkable(9, 1) === false);
  const swHook = hook(5, 1);
  check("switch tile walkable", swHook === false && mov.isWalkable(5, 1) === true);
  const closedSys = new PuzzleSystem([{ id: "mov_gate", mapId: "m", switches: [{ id: "sw", x: 5, y: 1 }], doors: [{ id: "door", x: 9, y: 1 }], required: 1 }]);
  closedSys.press("m", 5, 1);
  const openMov = new MovementSystem(map);
  openMov.setWalkabilityHook(closedSys.hookFor("m"));
  check("door walkable after solve", openMov.isWalkable(9, 1) === true);

  check("reset clears state", (multi.reset(), multi.pressedCount("double_gate") === 0));

  return out;
}
