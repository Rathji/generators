// Validation tests for Task #184: waystone world events — one `step` event
// per stone, gated to the stone's tile, firing the `waystone` action.

import { WorldEventSystem } from "../engine/world-events.js";
import { WORLD_EVENTS } from "../data/world-events.js";
import { WAYSTONES } from "../data/waystones.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const sys = new WorldEventSystem(WORLD_EVENTS, { state });

  check("six waystone events", WORLD_EVENTS.filter((e) => e.event.type === "waystone").length === 6);

  const activated = [];
  const handlers = {
    waystone: (act) => activated.push(act.waystoneId),
  };

  for (const w of WAYSTONES) {
    const ev = sys.eventAt(w.mapId, w.x, w.y, "step");
    check("event at " + w.id + " tile", !!ev && ev.event.type === "waystone" && ev.event.waystoneId === w.id);
    if (!ev) continue;
    check("event ready at " + w.id, sys.pending(w.mapId, w.x, w.y, "step") !== null);
    const r = sys.trigger(ev, handlers);
    check("trigger fires " + w.id, r.lit === true && r.event.type === "waystone");
  }

  check("all six waystones reported", activated.length === 6 && activated.every((id) => WAYSTONES.some((w) => w.id === id)));
  check("no event on empty tile", sys.eventAt("cornelia", 1, 1, "step") === null);
  check("re-fires on re-step", sys.pending("cornelia", 12, 3, "step") !== null);

  return out;
}
