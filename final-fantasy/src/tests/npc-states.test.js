// Validation tests for Task #106: quest-driven NPC state changes.

import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";
import { GameState } from "../engine/state.js";

function registry() {
  const m = new MapManager();
  for (const def of MAPS) m.register(def);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const placements = JSON.parse(JSON.stringify(NPC_PLACEMENTS));
  const sys = new NpcPlacementSystem(placements, registry());

  const blacksmith = sys.npcById("cornelia_blacksmith");
  check("blacksmith base at (3,5) facing W", blacksmith.x === 3 && blacksmith.y === 5 && blacksmith.facing === "W");

  const base = sys.resolveState(blacksmith);
  check("before flag resolveState returns base placement", base.x === 3 && base.y === 5 && base.facing === "W");
  check("base def not mutated by resolveState", blacksmith.x === 3 && blacksmith.y === 5);

  const state = new GameState();
  state.setFlag("story_garland_defeated", true);
  const sys2 = new NpcPlacementSystem(placements, registry(), { state });
  const smith = sys2.npcById("cornelia_blacksmith");
  const resolved = sys2.resolveState(smith);
  check("after flag resolved to (2,1) facing E", resolved.x === 2 && resolved.y === 1 && resolved.facing === "E");
  check("stateId recorded on resolved copy", resolved.stateId === "story_garland_defeated");
  check("base def still at original spot", smith.x === 3 && smith.y === 5);

  const moved = sys2.activeNpcAt("cornelia", 2, 1);
  check("activeNpcAt reflects state override", moved && moved.id === "cornelia_blacksmith" && moved.x === 2);
  check("activeNpcAt empty at base tile now", sys2.activeNpcAt("cornelia", 3, 5) === null);
  check("activeNpcAt empty on unknown tile", sys2.activeNpcAt("cornelia", 9, 9) === null);

  const bad = new NpcPlacementSystem(
    { cornelia: [{ id: "n", name: "N", x: 1, y: 1, facing: "N", states: [{ require: { flag: "f" }, x: 99, y: 99 }] }] },
    registry()
  );
  check("out-of-bounds state tile flagged invalid", bad.isValid() === false);
  check("state validation reason recorded", bad.invalidPlacements.some((r) => r.reason === "out of bounds"));

  const solid = new NpcPlacementSystem(
    { cornelia: [{ id: "n2", name: "N2", x: 1, y: 1, facing: "N", states: [{ require: { flag: "f" }, x: 0, y: 0 }] }] },
    registry()
  );
  check("solid state tile flagged invalid", solid.invalidPlacements.some((r) => r.reason === "solid tile"));

  check("no-state system unaffected by resolve", sys2.npcAt("cornelia", 8, 3)?.id === "cornelia_guard");
  check("guard has no states", Array.isArray(sys2.npcById("cornelia_guard").states) === false);

  return out;
}
