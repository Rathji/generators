// Validation tests for Task #75: Ship/Airship Access Logic.

import { TravelAccessSystem, TRAVEL_ACCESS } from "../engine/travel.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("travel access defines ship and air", "ship" in TRAVEL_ACCESS && "air" in TRAVEL_ACCESS);

  const flags = {};
  const state = fakeState(flags);
  let hasEngine = false;
  const world = { hasItem: (id) => id === "airshipEngine" && hasEngine };
  const sys = new TravelAccessSystem(TRAVEL_ACCESS, { state, world });

  check("ship locked by default", !sys.canUse("ship"));
  check("airship locked by default", !sys.canUse("air"));
  const shipReq = sys.requirement("ship");
  check("ship requires flag", shipReq.type === "flag" && shipReq.flag === "ship_obtained");
  const airReq = sys.requirement("air");
  check("airship requires item", airReq.type === "item" && airReq.itemId === "airshipEngine");
  check("denied dialogue provided", typeof shipReq.deniedDialogue === "string" && shipReq.deniedDialogue.length > 0);

  // Grant the ship.
  const grant = sys.grant("ship");
  check("grant ship succeeds", grant.ok === true);
  check("ship flag set", flags.ship_obtained === true);
  check("ship usable after grant", sys.canUse("ship"));

  // Airship stays locked without the item.
  check("airship still locked", !sys.canUse("air"));
  hasEngine = true;
  check("airship unlocked once engine held", sys.canUse("air"));

  // Unknown mode is rejected.
  check("unknown mode rejected", !sys.canUse("bicycle"));
  check("grant unknown mode fails", sys.grant("bicycle").ok === false);

  // Status summary for the HUD.
  const status = sys.status();
  check("status lists both modes", status.length === 2);
  const shipRow = status.find((s) => s.mode === "ship");
  check("status reports ship unlocked", shipRow.unlocked === true);

  // Def must exist for every declared mode.
  for (const mode of sys.modes()) {
    check("def present for " + mode, sys.def(mode)?.name);
  }

  return out;
}
