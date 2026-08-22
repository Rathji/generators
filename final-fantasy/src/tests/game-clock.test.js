// Validation tests for Task #138: Game Clock — day/hour state advancing
// with movement and battle, night/day periods, and save persistence.

import { GameClock, HOURS_PER_DAY, PERIODS } from "../engine/game-clock.js";
import { GameState } from "../engine/state.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const clock = new GameClock({ state, hour: 8, day: 1, stepsPerHour: 4 });

  check("starts at day 1, 8 AM", clock.hour === 8 && clock.day === 1);
  check("day period", clock.period() === PERIODS.DAY && clock.isDay() === true);
  check("label", clock.label().includes("Day 1") && clock.label().includes("AM"));

  // 4 overworld steps = one hour.
  clock.advanceSteps(4);
  check("4 steps advance one hour", clock.hour === 9 && clock.day === 1);
  clock.advanceSteps(1);
  check("1 step does not advance yet", clock.hour === 9 && clock.day === 1);

  // 4 more steps -> hour 10; a battle adds another hour -> 11.
  clock.advanceSteps(3);
  check("accumulates across calls", clock.hour === 10);
  clock.advanceBattle();
  check("battle takes an hour", clock.hour === 11);

  // Night window (>= 18 or < 6).
  clock.setHour(20);
  check("night after 20:00", clock.isNight() === true && clock.period() === PERIODS.NIGHT);
  clock.setHour(23);
  clock.advanceHours(1);
  check("hour wraps to 0 and day rolls", clock.hour === 0 && clock.day === 2);
  check("midnight is night", clock.isNight() === true);
  clock.setHour(6);
  check("dawn at 6", clock.period() === PERIODS.DAWN);
  clock.setHour(17);
  check("dusk at 17", clock.period() === PERIODS.DUSK);

  // Persistence: hour/day ride the state flags as raw numbers.
  clock.setHour(14);
  check("persists to flags", state.flags.clock_hour === 14 && state.flags.clock_day === 2);

  // restore() reads those raw flag values back.
  const clock2 = new GameClock({ state, hour: 0, day: 1 });
  clock2.restore();
  check("restore from flags", clock2.hour === 14 && clock2.day === 2);

  // A save/restore cycle survives via the flags.
  const snapshot = state.snapshot();
  const freshState = new GameState();
  freshState.restore(snapshot);
  const clock3 = new GameClock({ state: freshState });
  clock3.restore();
  check("clock survives a state snapshot", clock3.hour === 14 && clock3.day === 2);

  check("24 hours in a day", HOURS_PER_DAY === 24);

  return out;
}
