// Validation tests for Task #150: Mid-Game Plot Twist Trigger — a global
// event that changes the party's goals and updates the quest log headline.

import { PlotTwistSystem } from "../engine/plot-twist.js";
import { PLOT_TWISTS } from "../data/plot-twist.js";
import { GameState } from "../engine/state.js";
import { QuestLogSystem } from "../engine/quest-log.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const questLog = new QuestLogSystem({});
  const seen = [];
  const twists = new PlotTwistSystem(PLOT_TWISTS, {
    state,
    questLog,
    handlers: { dialogue: (id) => seen.push(id) },
  });

  check("twist data present", PLOT_TWISTS.length >= 1);
  check("not fired without its flags", twists.check().length === 0);
  check("quest log untouched before the twist", questLog.entries().length === 0);

  // Garland falls + the water crystal restored -> the twist fires.
  state.setFlag("story_garland_defeated", true);
  state.setFlag("crystal_water", true);
  const fired = twists.check();
  check("twist fires exactly once", fired.length === 1 && fired[0].type === "fired");
  check("twist is the mid-game reveal", fired[0].twist.id === "king_conspiracy");
  check("party goals rewritten by flags", state.getFlag("goal_seek_truth") === true && state.getFlag("twist_king_conspiracy_seen") === true);
  check("dialogue handler invoked", seen.includes("plot.twist_king"));
  check("quest log headline changes", questLog.entries().length === 1 && questLog.entries()[0].kind === "twist" && questLog.entries()[0].primary === true);
  check("active goal is the twist", questLog.activeGoal() === "The King's Conspiracy");

  check("second check does not re-fire", twists.check().length === 0);

  // Once the story catches up (Chaos falls) the log returns to the main road.
  state.setFlag("story_chaos_defeated", true);
  const resolved = twists.check();
  check("twist resolves", resolved.length === 1 && resolved[0].type === "resolved");
  check("log clears after resolution", questLog.entries().length === 0);

  // force-fire path for tests.
  const s2 = new GameState();
  const q2 = new QuestLogSystem({});
  const t2 = new PlotTwistSystem(PLOT_TWISTS, { state: s2, questLog: q2 });
  const fr = t2.fire("king_conspiracy");
  check("fire() works directly", fr.ok === true && q2.entries()[0].name === "The King's Conspiracy");
  check("fire() refuses twice", t2.fire("king_conspiracy").ok === false);

  return out;
}
