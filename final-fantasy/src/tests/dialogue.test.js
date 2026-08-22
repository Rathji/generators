// Validation tests for Tasks #10 & #11: NPC Dialogue Engine + Conditional Dialogue Logic.

import { DialogueEngine, matchCondition, createDialogueWorld } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // ---- Core page flow (Task #10) ----
  check("localized data has entries", DIALOGUE["cornelia.elder"] != null && DIALOGUE["sign.inn"] != null);
  const de = new DialogueEngine();
  check("inactive before start", de.isActive() === false);
  const first = de.start("cornelia.elder");
  check("start returns first page", first != null && first.text === DIALOGUE["cornelia.elder"].pages[0]);
  check("speaker attached", first.speaker === "Village Elder");
  check("page metadata", first.total === 2 && first.page === 1 && first.done === false);
  const second = de.advance();
  check("advance to page 2", second.text === "Now their light is fading. Only a chosen party can restore them.");
  check("done on final advance", de.advance().done === true);
  check("inactive after completion", de.isActive() === false);
  check("advance when inactive null", de.advance() === null);

  const single = new DialogueEngine();
  check("string node single page", single.start("cornelia.woman").text === DIALOGUE["cornelia.woman"]);
  check("string node ends", single.advance().done === true);
  check("unknown id null", new DialogueEngine().start("nope") === null);

  // ---- Condition matching (Task #11) ----
  const world = { getFlag: (n) => n === "king_met", hasItem: (n) => n === "crystalKey" };
  check("cond flag", matchCondition({ flag: "king_met" }, world) === true);
  check("cond flag false", matchCondition({ flag: "other" }, world) === false);
  check("cond notFlag", matchCondition({ notFlag: "other" }, world) === true);
  check("cond item", matchCondition({ item: "crystalKey" }, world) === true);
  check("cond noItem", matchCondition({ noItem: "crystalKey" }, world) === false);
  check("cond all", matchCondition({ all: [{ flag: "king_met" }, { item: "crystalKey" }] }, world) === true);
  check("cond any", matchCondition({ any: [{ flag: "nope" }, { item: "crystalKey" }] }, world) === true);
  check("cond not", matchCondition({ not: { flag: "other" } }, world) === true);
  check("cond string shorthand", matchCondition("king_met", world) === true);
  check("cond function", matchCondition((w) => w.hasItem("crystalKey"), world) === true);
  check("cond null = true", matchCondition(null, world) === true);
  check("cond no world = false", matchCondition({ flag: "x" }, null) === false);

  // ---- Branches by world state ----
  const noWorld = new DialogueEngine();
  check("branch default (no world)", noWorld.start("cornelia.guard").id === "cornelia.guard.before");

  const keyWorld = new DialogueEngine({ world: { getFlag: () => false, hasItem: (n) => n === "crystalKey" } });
  check("branch by item", keyWorld.start("cornelia.guard").id === "cornelia.guard.key");

  const kingWorld = new DialogueEngine({ world: { getFlag: (n) => n === "king_met", hasItem: () => false } });
  const kingPage = kingWorld.start("cornelia.guard");
  check("branch by flag", kingPage.id === "cornelia.guard.after" && kingPage.text === "The king is awaiting you in the throne room. Do not keep him waiting.");

  // ---- condition + fallback ----
  const fallbackEng = new DialogueEngine({ world: { getFlag: () => false, hasItem: () => false } });
  check("condition fallback used", fallbackEng.start("elfheim.merchant").id === "elfheim.merchant.none");
  const swordWorld = new DialogueEngine({ world: { getFlag: () => false, hasItem: (n) => n === "mythrilSword" } });
  const merchant = swordWorld.start("elfheim.merchant");
  check("condition passes with item", merchant.id === "elfheim.merchant.deal" && merchant.text.includes("mythril"));

  // ---- createDialogueWorld wraps game ----
  const game = { state: new GameState(), inventory: new Inventory() };
  game.state.setFlag("x");
  game.inventory.add("crystalKey", 1);
  const dw = createDialogueWorld(game);
  check("world reads flags", dw.getFlag("x") === true && dw.getFlag("y") === false);
  check("world reads items", dw.hasItem("crystalKey") === true && dw.hasItem("potion") === false);

  const bound = new DialogueEngine().bindWorld(dw);
  check("bindWorld drives branches", bound.start("cornelia.guard").id === "cornelia.guard.key");

  // ---- context / abort / injected data ----
  const custom = new DialogueEngine({ data: { hi: { speaker: "E", pages: ["a"] } } });
  const ctx = custom.start("hi", { flag: "q" });
  check("context stored", custom.context.flag === "q");
  check("requestedId tracked", ctx.requestedId === "hi" && ctx.id === "hi");
  custom.abort();
  check("abort", custom.isActive() === false);
  check("function condition receives world", new DialogueEngine({ world: world }).conditionMet((env) => env.world.hasItem("crystalKey")) === true);

  return out;
}
