// Validation tests for Task #14: Quest Tracking System.

import { GameState } from "../engine/state.js";
import { QuestTracker } from "../engine/quests.js";
import { QUESTS } from "../data/quests.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const tracker = new QuestTracker(QUESTS, state);
  check("all quests start inactive", QUESTS.every((q) => tracker.statusOf(q.id) === "inactive"));

  state.setFlag("prologue_started");
  check("quest activates on start flag", tracker.statusOf("prologue") === "active");
  check("active list includes quest", tracker.active().some((q) => q.id === "prologue"));

  state.setFlag("entered_castle");
  check("objective 1 completes", tracker.objectives("prologue")[0].done === true);
  check("objective 2 pending", tracker.objectives("prologue")[1].done === false);

  state.setFlag("king_met");
  check("quest completes via flag", tracker.isComplete("prologue") === true);
  check("completed list", tracker.completed().length === 1 && tracker.completed()[0].id === "prologue");
  check("all objectives done", tracker.objectives("prologue").every((o) => o.done));

  state.setFlag("earth_crystal_quest");
  check("second quest active", tracker.statusOf("crystal_one") === "active");
  state.setFlag("earth_crystal_lost");
  check("quest fails via flag", tracker.isFailed("crystal_one") === true);
  check("failed list", tracker.failed().some((q) => q.id === "crystal_one"));
  state.setFlag("earth_crystal_restored");
  check("completion beats failure", tracker.statusOf("crystal_one") === "completed");

  check("active list empty at end", tracker.active().length === 0);
  check("unknown quest inactive", tracker.statusOf("nope") === "inactive");
  check("unknown questById null", tracker.questById("nope") === null);
  check("unknown objectives empty", tracker.objectives("nope").length === 0);
  check("unstarted quest stays inactive", tracker.statusOf("lost_cat") === "inactive");

  // sync is idempotent and binds state later
  const tracker2 = new QuestTracker(QUESTS);
  check("unbound defaults inactive", tracker2.statusOf("prologue") === "inactive");
  tracker2.bind(state);
  check("bind recomputes states", tracker2.isComplete("prologue") === true);

  return out;
}
