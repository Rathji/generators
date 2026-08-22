// Task #138: Game Clock — a 24-hour day/night clock that advances with
// overworld movement and battle, persisted to the save (raw flag values on
// the GameState), and consumed by NPC schedules and any day/night logic.

export const HOURS_PER_DAY = 24;
export const PERIODS = Object.freeze({
  DAWN: "dawn",
  DAY: "day",
  DUSK: "dusk",
  NIGHT: "night",
});

export class GameClock {
  constructor(opts = {}) {
    this.hour = opts.hour ?? 8;
    this.day = opts.day ?? 1;
    this.state = opts.state ?? null;
    // World-map steps per in-game hour (town steps are free).
    this.stepsPerHour = opts.stepsPerHour ?? 4;
    this._stepAcc = 0;
    // Persist flags: read as raw numeric values, not booleans.
    this.hourFlag = opts.hourFlag ?? "clock_hour";
    this.dayFlag = opts.dayFlag ?? "clock_day";
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  _persist() {
    if (!this.state) return;
    this.state.flags[this.hourFlag] = this.hour;
    this.state.flags[this.dayFlag] = this.day;
  }

  setHour(h) {
    this.hour = ((Math.floor(h) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
    this._persist();
    return this;
  }

  setDay(d) {
    this.day = Math.max(1, Math.floor(d));
    this._persist();
    return this;
  }

  setTime(hour, day = this.day) {
    this.setDay(day);
    return this.setHour(hour);
  }

  advanceHours(n) {
    const h = this.hour + n;
    this.day += Math.floor(h / HOURS_PER_DAY);
    this.hour = ((h % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
    this._persist();
    return this;
  }

  // Advance by overworld steps — every stepsPerHour steps is one hour.
  advanceSteps(steps) {
    this._stepAcc += Math.max(0, steps);
    while (this._stepAcc >= this.stepsPerHour) {
      this._stepAcc -= this.stepsPerHour;
      this.advanceHours(1);
    }
    return this;
  }

  // A battle is assumed to take an hour of in-game time.
  advanceBattle() {
    return this.advanceHours(1);
  }

  isNight() {
    return this.hour < 6 || this.hour >= 18;
  }

  isDay() {
    return !this.isNight();
  }

  period() {
    if (this.hour >= 5 && this.hour < 7) return PERIODS.DAWN;
    if (this.hour >= 7 && this.hour < 17) return PERIODS.DAY;
    if (this.hour >= 17 && this.hour < 19) return PERIODS.DUSK;
    return PERIODS.NIGHT;
  }

  hourLabel() {
    const h12 = this.hour % 12 === 0 ? 12 : this.hour % 12;
    return h12 + (this.hour < 12 ? " AM" : " PM");
  }

  label() {
    return "Day " + this.day + ", " + this.hourLabel() + " (" + this.period() + ")";
  }

  // Rebuild the clock from persisted raw flag values (numbers on flags).
  restore() {
    if (!this.state) return this;
    const h = this.state.flags[this.hourFlag];
    const d = this.state.flags[this.dayFlag];
    if (Number.isFinite(h)) this.hour = ((Math.floor(h) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
    if (Number.isFinite(d)) this.day = Math.max(1, Math.floor(d));
    return this;
  }
}
