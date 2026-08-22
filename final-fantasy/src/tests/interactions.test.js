// Validation tests for Task #13: Interaction Trigger System.

import { TriggerSystem } from "../engine/interactions.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ts = new TriggerSystem();
  ts.add({ id: "guard_talk", mapId: "cornelia", x: 8, y: 3, on: "interact", action: { type: "dialogue", dialogueId: "cornelia.guard" } });
  ts.add({ id: "cave_door", mapId: "overworld", x: 3, y: 2, on: "interact", action: { type: "transition", mapId: "cave1", x: 4, y: 9, facing: "S" } });
  ts.add({ id: "ambush", mapId: "overworld", x: 12, y: 2, on: "step", action: { type: "battle", group: "bandits" } });

  check("interact trigger found", ts.checkInteract("cornelia", 8, 3)?.id === "guard_talk");
  check("step trigger not interact", ts.checkInteract("overworld", 12, 2) === null);
  check("step trigger found", ts.checkStep("overworld", 12, 2)?.id === "ambush");
  check("no trigger at empty tile", ts.checkInteract("cornelia", 1, 1) === null);
  check("wrong map no trigger", ts.checkInteract("elsewhere", 8, 3) === null);

  const r1 = ts.execute(ts.checkInteract("cornelia", 8, 3));
  check("dialogue result id", r1.result === "cornelia.guard" && r1.triggerId === "guard_talk");
  const r2 = ts.execute(ts.checkInteract("overworld", 3, 2));
  check("transition result coords", r2.result.mapId === "cave1" && r2.result.x === 4 && r2.result.facing === "S");
  const r3 = ts.execute(ts.checkStep("overworld", 12, 2));
  check("battle result group", r3.result === "bandits");
  check("execute null returns null", ts.execute(null) === null);

  let called = null;
  ts.execute(ts.checkInteract("cornelia", 8, 3), {}, { dialogue: (id) => { called = id; } });
  check("dialogue handler invoked", called === "cornelia.guard");

  // conditional (gated) triggers
  const blocked = new TriggerSystem({ getFlag: () => false, hasItem: () => false });
  blocked.add({ id: "key_door", mapId: "overworld", x: 5, y: 5, on: "interact", condition: { item: "crystalKey" }, action: { type: "transition", mapId: "elfheim", x: 1, y: 1 } });
  const skipped = blocked.execute(blocked.checkInteract("overworld", 5, 5));
  check("conditional trigger skipped without item", skipped.skipped === true);

  const open = new TriggerSystem({ getFlag: () => false, hasItem: () => true });
  open.add({ id: "key_door", mapId: "overworld", x: 5, y: 5, on: "interact", condition: { item: "crystalKey" }, action: { type: "transition", mapId: "elfheim", x: 1, y: 1 } });
  const passed = open.execute(open.checkInteract("overworld", 5, 5));
  check("conditional trigger fires with item", passed.result.mapId === "elfheim");

  // generic handler fallback
  let generic = null;
  ts.add({ id: "script", mapId: "cornelia", x: 9, y: 9, on: "interact", action: { type: "scripted", name: "shake" } });
  ts.execute(ts.checkInteract("cornelia", 9, 9), {}, { generic: (a) => { generic = a.name; } });
  check("generic handler invoked", generic === "shake");
  check("generic result passthrough", ts.execute(ts.checkInteract("cornelia", 9, 9)).result.name === "shake");

  return out;
}
