// Validation tests for Task #15: Narrative Event Sequence.

import { StoryDirector } from "../engine/events.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inventory = new Inventory();
  const ctx = { state, inventory };
  const events = [];
  const handlers = {
    dialogue: (id) => events.push("dialogue:" + id),
    transition: (step) => events.push("transition:" + step.mapId),
    event: (name) => events.push("event:" + name),
  };

  const dir = new StoryDirector(ctx, handlers);
  check("not running initially", dir.isRunning() === false);
  dir.queue([
    { type: "setFlag", flag: "scene_started" },
    { type: "giveItem", itemId: "potion", count: 2 },
    { type: "dialogue", dialogueId: "intro" },
    { type: "setFlag", flag: "scene_after" },
  ]);
  check("running after queue", dir.isRunning() === true);

  const r1 = dir.advance();
  check("flag step applied", state.getFlag("scene_started") === true);
  check("item step applied", inventory.count("potion") === 2);
  check("dialogue step blocks", r1.waiting !== null && r1.waiting.dialogueId === "intro");
  check("director waiting", dir.isWaiting() === true);
  check("three steps before block", r1.steps.length === 3);
  check("later flag not yet set", state.getFlag("scene_after") === false);

  const r2 = dir.resume();
  check("resume runs the rest", state.getFlag("scene_after") === true);
  check("sequence finished", r2.done === true && dir.isRunning() === false);
  check("dialogue handler called", events.includes("dialogue:intro"));

  const dir2 = new StoryDirector(ctx, handlers);
  dir2.queue([{ type: "transition", mapId: "overworld", x: 3, y: 3 }]);
  const rt = dir2.advance();
  check("transition step executed", events.includes("transition:overworld") && rt.done === true);

  const dir3 = new StoryDirector(ctx, handlers);
  dir3.queue([{ type: "wait" }, { type: "setFlag", flag: "after_wait" }]);
  const rw = dir3.advance();
  check("wait step blocks", rw.waiting !== null && rw.waiting.type === "wait");
  dir3.resume();
  check("resume after wait", state.getFlag("after_wait") === true);

  const dir4 = new StoryDirector(ctx, handlers);
  dir4.queue([{ type: "event", name: "camera_shake" }, { type: "setFlag", flag: "shook" }]);
  const r4 = dir4.advance();
  check("event handler invoked", events.includes("event:camera_shake"));
  check("event then flag", state.getFlag("shook") === true && r4.done === true);

  const dir5 = new StoryDirector(ctx, handlers);
  dir5.queue([]);
  check("empty sequence done", dir5.advance().done === true);

  const dir6 = new StoryDirector(ctx, handlers);
  dir6.queue([{ type: "setFlag", flag: "a" }]);
  check("peek returns first step", dir6.peek()?.type === "setFlag" && dir6.peek()?.flag === "a");

  const dir7 = new StoryDirector(ctx, handlers);
  dir7.queue([{ type: "unknown_step" }]);
  const r7 = dir7.advance();
  check("unknown step non-blocking", r7.done === true);

  return out;
}
