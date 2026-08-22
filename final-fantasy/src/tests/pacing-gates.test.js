// Validation tests for Task #153: Narrative Pacing Gates — "Wait" until
// mid-game flags are checked before the final dungeon's road opens.

import { PacingGateSystem } from "../engine/pacing-gates.js";
import { PACING_GATES } from "../data/pacing-gates.js";
import { GameState } from "../engine/state.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function registry() {
  const m = new MapManager();
  for (const d of MAPS) m.register(d);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const gates = new PacingGateSystem(PACING_GATES, { state });

  check("pacing gate data present", PACING_GATES.length >= 2);
  const shrine = gates.gateAt("overworld", 13, 2);
  check("shrine seal sits at the shrine entrance", shrine && shrine.id === "chaos_shrine_seal");
  check("no gate on an ordinary tile", gates.gateAt("overworld", 5, 5) === null);

  // Sealed by default — a "Wait" denial message.
  const denied = gates.canPass("overworld", 13, 2);
  check("sealed before the mid-game flags", denied.allowed === false && denied.gate.id === "chaos_shrine_seal");
  check("denial reads as a wait", denied.reason.includes("Wait"));
  check("all gates pending", gates.pending().length === PACING_GATES.length);

  // One crystal alone is not enough — the seal needs two.
  state.setFlag("crystal_fire", true);
  check("one crystal still sealed", gates.canPass("overworld", 13, 2).allowed === false);
  state.setFlag("crystal_water", true);
  const open = gates.canPass("overworld", 13, 2);
  check("two crystals open the seal", open.allowed === true && open.unlockFlag === "pacing_chaos_shrine_open");
  check("shrine no longer pending", gates.pending().some((g) => g.id === "chaos_shrine_seal") === false);

  // The eastern peaks need only the marsh waters stilled.
  state.clearFlag("crystal_water");
  check("eastern peaks sealed without water", gates.canPass("overworld", 18, 2).allowed === false);
  state.setFlag("crystal_water", true);
  check("eastern peaks open with water", gates.canPass("overworld", 18, 2).allowed === true);

  check("every gate sits on a walkable tile", gates.audit(registry()).length === 0);

  return out;
}
