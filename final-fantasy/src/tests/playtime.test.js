// Validation tests for Task #162: Total Playtime Tracker — a cumulative
// clock and step counter persisted to the player profile (state flags),
// with the running session folded in on record/transition.

import { PlaytimeTracker, fmtDuration } from "../engine/playtime.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("duration formatting", fmtDuration(3661) === "1h 1m" && fmtDuration(65) === "1m 5s" && fmtDuration(9) === "9s");
  check("zero duration", fmtDuration(0) === "0s");

  const state = new GameState();
  const pt = new PlaytimeTracker({ state });

  check("starts at zero", pt.totalSec() === 0 && pt.steps() === 0 && pt.sessionSecs() === 0);

  pt.tick(1000);
  pt.tick(500);
  check("session accumulates", Math.abs(pt.sessionSecs() - 1.5) < 0.001);

  const total = pt.recordSession();
  check("recordSession folds in", Math.abs(total - 1.5) < 0.001 && pt.sessionSecs() === 0);
  check("total persisted to state", Math.abs(state.flags["playtime_total_sec"] - 1.5) < 0.001);

  pt.addStep();
  pt.addStep(3);
  check("steps count", pt.steps() === 4);
  check("steps persisted", state.flags["playtime_steps"] === 4);

  // Sessions accumulate across records.
  pt.tick(2500);
  pt.recordSession();
  check("second session adds", Math.abs(pt.totalSec() - 4) < 0.001);
  check("label reflects total", pt.label() === "4s");

  const stats = pt.stats();
  check("stats shape", Math.abs(stats.totalSec - 4) < 0.001 && stats.steps === 4 && stats.label === "4s");

  // A fresh tracker over the same state sees the persisted totals.
  const pt2 = new PlaytimeTracker({ state });
  check("rehydrate totals", Math.abs(pt2.totalSec() - 4) < 0.001 && pt2.steps() === 4);
  pt2.tick(1000);
  pt2.recordSession();
  check("rehydrated tracker continues", Math.abs(pt2.totalSec() - 5) < 0.001);

  // Reset wipes the profile counters.
  pt2.reset();
  check("reset clears profile", pt2.totalSec() === 0 && pt2.steps() === 0 && state.flags["playtime_total_sec"] == null);

  // State-less tracker still works in memory.
  const bare = new PlaytimeTracker();
  bare.tick(2000);
  check("state-less session", Math.abs(bare.sessionSecs() - 2) < 0.001);
  check("state-less total stays 0", bare.totalSec() === 0 && bare.steps() === 0);

  return out;
}
