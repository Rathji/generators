// Task #162: Total Playtime Tracker — a clock + step counter saved to the
// player profile. The cumulative total and the lifetime step count persist
// as raw number flags on the GameState (so they ride saves, autosaves, and
// slot metadata); the current session accumulates in memory and is folded
// into the total on transitions/saves.

export class PlaytimeTracker {
  constructor(opts = {}) {
    this.state = opts.state ?? null;
    this.totalFlag = opts.totalFlag ?? "playtime_total_sec";
    this.stepsFlag = opts.stepsFlag ?? "playtime_steps";
    this.sessionSec = 0;
    this._start = performance.now();
  }

  totalSec() {
    return Number(this.state?.flags?.[this.totalFlag] ?? 0);
  }

  steps() {
    return Number(this.state?.flags?.[this.stepsFlag] ?? 0);
  }

  sessionSecs() {
    return this.sessionSec;
  }

  _persist() {
    if (!this.state) return this;
    this.state.flags[this.totalFlag] = this.totalSec();
    this.state.flags[this.stepsFlag] = this.steps();
    return this;
  }

  // Called from the frame loop with the real elapsed ms.
  tick(dtMs) {
    this.sessionSec += Math.max(0, dtMs) / 1000;
    return this;
  }

  // Fold the running session into the persisted total (on transitions, on
  // saves, on quit). Returns the new total.
  recordSession() {
    const n = this.totalSec() + this.sessionSec;
    if (this.state) this.state.flags[this.totalFlag] = n;
    this.sessionSec = 0;
    this._start = performance.now();
    this._persist();
    return n;
  }

  // One world step (move) counts toward the lifetime step counter.
  addStep(n = 1) {
    if (this.state) this.state.flags[this.stepsFlag] = this.steps() + Math.max(0, Math.floor(n));
    return this.steps();
  }

  stats() {
    return {
      totalSec: this.totalSec(),
      sessionSec: this.sessionSec,
      steps: this.steps(),
      label: fmtDuration(this.totalSec() + this.sessionSec),
    };
  }

  label() {
    return this.stats().label;
  }

  // Drop the profile counters (New Game boots a fresh profile).
  reset() {
    if (this.state) {
      delete this.state.flags[this.totalFlag];
      delete this.state.flags[this.stepsFlag];
    }
    this.sessionSec = 0;
    this._start = performance.now();
    return this;
  }

  // Re-sync the tracker to a freshly restored state (Continue).
  restore() {
    this.sessionSec = 0;
    this._start = performance.now();
    return this;
  }
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}
