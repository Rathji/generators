// Validation tests for Task #80: Global Input Remapping.

import { InputManager, DEFAULT_BINDINGS, DEFAULT_ACTIONS } from "../engine/input.js";

function keyEvent(key) {
  return { key };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const input = new InputManager();
  check("default actions defined", DEFAULT_ACTIONS.includes("up") && DEFAULT_ACTIONS.includes("confirm"));
  check("default binding for up", Array.isArray(DEFAULT_BINDINGS.up));

  // Default mapping: arrows + WASD.
  check("ArrowUp maps to up", input.actionForKey("ArrowUp") === "up");
  check("w maps to up", input.actionForKey("w") === "up");
  check("Enter maps to confirm", input.actionForKey("Enter") === "confirm");
  check("Escape maps to cancel", input.actionForKey("Escape") === "cancel");
  check("unknown key maps to null", input.actionForKey("x") === null);

  // Rebind: move jump to space.
  const reb = input.rebind("jump", "Space");
  check("rebind unknown action fails", reb.ok === false);
  const reb2 = input.rebind("confirm", "j");
  check("rebind confirm to j", reb2.ok === true && input.actionForKey("j") === "confirm");
  check("j removed from other actions", !input.keysFor("menu").includes("j"));
  check("old confirm keys removed", input.actionForKey("Enter") === null || input.keysFor("confirm").every((k) => k !== "enter"));
  check("confirm keys are ['j']", input.keysFor("confirm").length === 1 && input.keysFor("confirm")[0] === "j");

  // handleKeyDown marks pressed and reports the action.
  let fired = null;
  const input2 = new InputManager({ onAction: (a) => (fired = a) });
  const action = input2.handleKeyDown(keyEvent("ArrowLeft"));
  check("keydown returns action", action === "left");
  check("onAction fired", fired === "left");
  check("isDown true while held", input2.isDown("left") === true);
  input2.handleKeyUp(keyEvent("ArrowLeft"));
  check("keyup clears held", input2.isDown("left") === false);

  // Multiple keys can map to one action.
  const input3 = new InputManager();
  check("arrow and wasd both up", input3.actionForKey("ArrowUp") === "up" && input3.actionForKey("w") === "up");

  // Snapshot/load for persistence.
  const snap = input.bindingsSnapshot();
  check("snapshot shape", snap.up.length === 2 && snap.confirm.includes("j"));
  const input4 = new InputManager();
  check("fresh input has defaults", input4.actionForKey("j") === null);
  input4.load(snap);
  check("loaded bindings restore", input4.actionForKey("j") === "confirm");

  // Reset returns to defaults.
  input.reset();
  check("reset restores defaults", input.actionForKey("j") === null && input.actionForKey("Enter") === "confirm");

  // describe produces readable lines.
  const desc = input.describe("confirm");
  check("describe includes key label", typeof desc === "string" && desc.includes("Confirm"));
  check("describeAll returns one per action", input.describeAll().length === DEFAULT_ACTIONS.length);

  // Disabled input ignores events.
  const input5 = new InputManager();
  input5.setEnabled(false);
  check("disabled input ignores keydown", input5.handleKeyDown(keyEvent("ArrowUp")) === null);

  return out;
}
