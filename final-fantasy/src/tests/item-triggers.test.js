// Validation tests for Task #44: Key Item Trigger Mapping.

import { ItemTriggerSystem } from "../engine/item-triggers.js";
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
  const inv = new Inventory();
  const world = { getFlag: (n) => state.getFlag(n) };
  const ctx = { state, inventory: inv, world };

  const sys = new ItemTriggerSystem(world);
  sys
    .add({ id: "unlock_castle", item: "crystalKey", flags: ["castle_unlocked"], once: true, event: "castle_unlocked" })
    .add({ id: "open_chamber", item: "crystalKey", flags: ["crystal_chamber_unlocked"], condition: { flag: "castle_unlocked" }, once: true })
    .add({ id: "give_key", item: "crystalKey", consume: true, flags: ["crystal_key_given"] });

  check("missing item blocks trigger", sys.canTrigger("unlock_castle", ctx).ok === false);
  check("unknown trigger reported", sys.canTrigger("nope", ctx).error === "unknown trigger");

  check("condition-gated trigger blocked", sys.canTrigger("open_chamber", ctx).ok === false);

  inv.add("crystalKey", 1);
  check("item present unlocks trigger", sys.canTrigger("unlock_castle", ctx).ok === true);
  check("pending by item", sys.pending("crystalKey").length === 3);

  const res = sys.trigger("unlock_castle", ctx);
  check("trigger fired", res.triggered === "unlock_castle" && res.flags.includes("castle_unlocked"));
  check("non-consume keeps item", inv.has("crystalKey") === true && res.consumed === false);
  check("once guard blocks repeat", sys.canTrigger("unlock_castle", ctx).error === "already triggered");

  check("condition met opens trigger", sys.canTrigger("open_chamber", ctx).ok === true);

  const consume = sys.trigger("give_key", ctx);
  check("consume removes the key", consume.consumed === true && inv.has("crystalKey") === false);
  check("give_key flag set", state.getFlag("crystal_key_given") === true);

  const after = sys.trigger("give_key", ctx);
  check("consume trigger blocks without item", after.ok === false && after.error === "missing item");

  const events = [];
  const sys2 = new ItemTriggerSystem(world);
  sys2.add({ id: "ritual", item: "crystalKey", flags: ["ritual_done"], event: "ritual_performed" });
  inv.add("crystalKey", 1);
  sys2.trigger("ritual", { ...ctx, handlers: { event: (def, r) => events.push(def.id) } });
  check("event handler fired", events.includes("ritual"));
  check("isUnlocked helper", sys2.isUnlocked("ritual", ctx) === true);

  return out;
}
