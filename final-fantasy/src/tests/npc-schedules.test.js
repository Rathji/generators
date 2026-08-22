// Validation tests for Task #138: NPC Schedule System — timer-based movement
// between coordinates based on the game clock.

import { NpcPlacementSystem } from "../engine/npcs.js";
import { NpcScheduleSystem } from "../engine/npc-schedules.js";
import { GameClock } from "../engine/game-clock.js";
import { NPC_SCHEDULES } from "../data/npc-schedules.js";
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

  const maps = registry();
  const state = new GameState();
  const clock = new GameClock({ state, hour: 8, day: 1 });
  const schedules = new NpcScheduleSystem(NPC_SCHEDULES, clock);
  const sys = new NpcPlacementSystem(JSON.parse(JSON.stringify(NPC_PLACEMENTS)), maps, {
    state,
    schedules,
    clock,
  });

  check("base placements still valid", sys.isValid() === true);

  // The guard is at the gate in the morning...
  const at8 = sys.activeNpcAt("cornelia", 8, 3);
  check("guard at gate at 8 AM", at8?.id === "cornelia_guard");
  // ...and patrols the castle road mid-afternoon.
  clock.setHour(13);
  const at13 = sys.activeNpcAt("cornelia", 9, 3);
  check("guard patrols castle road at 1 PM", at13?.id === "cornelia_guard");
  check("guard not at the gate at 1 PM", sys.activeNpcAt("cornelia", 8, 3) === null);
  // Back at the gate by night.
  clock.setHour(20);
  check("guard returns at night", sys.activeNpcAt("cornelia", 8, 3)?.id === "cornelia_guard");

  // The blacksmith works the forge by day, then moves to the inn at night —
  // but only while his quest state is NOT active.
  clock.setHour(10);
  check("blacksmith at forge at 10 AM", sys.activeNpcAt("cornelia", 3, 5)?.id === "cornelia_blacksmith");
  clock.setHour(19);
  check("blacksmith at inn at 7 PM", sys.activeNpcAt("cornelia", 4, 4)?.id === "cornelia_blacksmith");

  // Task #106 wins: with the story flag set, the smith is pinned at his anvil
  // by the gate regardless of the clock.
  state.setFlag("story_garland_defeated", true);
  clock.setHour(19);
  const pinned = sys.activeNpcAt("cornelia", 2, 1);
  check("quest state pins the smith over the schedule", pinned?.id === "cornelia_blacksmith" && pinned.stateId === "story_garland_defeated");
  state.clearFlag("story_garland_defeated");

  // An NPC with no schedule window just stays at base placement.
  clock.setHour(3);
  check("unscheduled hour keeps base placement", sys.activeNpcAt("cornelia", 8, 3)?.id === "cornelia_guard");

  // The schedule system itself.
  check("positionFor window match", schedules.positionFor("cornelia_guard", 13)?.x === 9);
  check("positionFor null outside windows", schedules.positionFor("cornelia_blacksmith", 5) === null);
  check("def lookup", schedules.def("cornelia_guard")?.length === 4);
  check("def unknown", schedules.def("nope") === null);

  // Inline `schedule` arrays override the global data.
  const inline = new NpcScheduleSystem({});
  const res = inline.positionFor("anyone", 10, [{ from: 0, to: 24, x: 5, y: 5, facing: "N" }]);
  check("inline schedule override", res?.x === 5 && res?.facing === "N");

  // Audit of the shipped data.
  check("schedules audit clean", schedules.audit(sys, maps).length === 0);
  const bad = new NpcScheduleSystem({ x: [{ from: 25, to: 2, x: 1, y: 1 }] });
  check("audit flags bad window", bad.audit().length === 1);

  return out;
}
