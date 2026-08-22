// Validation tests for Task #137: Overworld Fog-of-War Reveal.

import { FogOfWar } from "../engine/fog-of-war.js";
import { WorldMapFogSystem } from "../engine/world-fog.js";
import { GameState } from "../engine/state.js";

const MAP_DEF = {
  rows: ["####", "#..#", "#..#", "####"],
  solid: { "#": true },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const fog = new FogOfWar({ radius: 2 });
  const state = new GameState();
  const sys = new WorldMapFogSystem(fog, { state, mapId: "overworld", radius: 2 });

  check("starts unexplored", sys.count() === 0 && fog.count("overworld") === 0);
  check("isRevealed false before", sys.isRevealed(1, 1) === false);

  sys.reveal(1, 1);
  check("reveal discovers a radius", sys.isRevealed(1, 1) === true && sys.count() > 0);
  check("reveal persists to flag", typeof state.flags.ow_fog_explored === "string" && state.flags.ow_fog_explored.length > 0);

  const before = sys.count();
  sys.reveal(1, 2);
  check("second reveal grows the set", sys.count() > before);
  const afterBoth = sys.count();

  // restore() rebuilds the explored set from the persisted flag, exactly as
  // the demo does when the party returns to the overworld after a resetAll.
  fog.resetAll();
  check("resetAll wipes fog", fog.count("overworld") === 0);
  sys.restore();
  check("restore rebuilds from flag", sys.count() === afterBoth && sys.isRevealed(1, 1) && sys.isRevealed(1, 2));

  // A fresh system bound to the same state rehydrates on construction time
  // restore() — the discovery survived.
  const sys2 = new WorldMapFogSystem(new FogOfWar({ radius: 2 }), { state });
  sys2.restore();
  check("a second instance rehydrates the same fog", sys2.count() === afterBoth);

  // coverage: only in-bounds passable tiles count, so it is always <= 1.
  const cov = sys2.coverage(MAP_DEF); // all 4 inner tiles were explored
  check("coverage fraction", cov === 1);

  sys2.reset();
  check("reset clears fog + flag", sys2.count() === 0 && state.flags.ow_fog_explored === undefined);

  return out;
}
