// Task #157: Target Selection Cursor — a visual pointer that moves across
// the living enemies in a fight. Pure logic over the enemy array (no DOM):
// bind/cycle/auto-skip-dead, plus the set of enemies a strike will actually
// hit (single target, or the MultiTargetResolver expansion for fan attacks).

export class TargetCursorSystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    // Optional MultiTargetResolver — when present, `highlighted()` expands
    // the selected target into the full fan of enemies the attack will hit.
    this.multiTarget = opts.multiTarget ?? null;
    this.targets = [];
    this.index = -1;
  }

  alive(list) {
    return (list ?? []).filter((c) => (c.hp ?? 0) > 0);
  }

  aliveCount() {
    return this.alive(this.targets).length;
  }

  valid(c) {
    return !!c && (c.hp ?? 0) > 0;
  }

  _firstAlive() {
    return this.targets.findIndex((c) => this.valid(c));
  }

  bind(targets) {
    this.targets = [...(targets ?? [])];
    this.index = this._firstAlive();
    return this;
  }

  get current() {
    return this.index >= 0 && this.index < this.targets.length ? this.targets[this.index] : null;
  }

  get selected() {
    return this.current;
  }

  // True when the current target is still a valid living enemy.
  isAlive() {
    return this.valid(this.current);
  }

  // Re-anchor onto a living enemy if the current one fell.
  refresh() {
    if (!this.valid(this.current)) this.index = this._firstAlive();
    return this.current;
  }

  // Move by delta across LIVING enemies (wraps). Skips dead ones.
  move(dir) {
    const living = this.alive(this.targets);
    if (!living.length) {
      this.index = -1;
      return null;
    }
    const n = living.length;
    let start = this.current ? living.indexOf(this.current) : -1;
    if (start < 0) start = 0;
    let idx = (start + (dir > 0 ? 1 : -1) + n) % n;
    this.index = this.targets.indexOf(living[idx]);
    return this.current;
  }

  next() {
    return this.move(1);
  }

  prev() {
    return this.move(-1);
  }

  // Choose a random living enemy (auto-target helper).
  random() {
    const living = this.alive(this.targets);
    if (!living.length) return null;
    const pick = living[Math.floor(this.rng() * living.length)];
    this.index = this.targets.indexOf(pick);
    return pick;
  }

  // The enemies a strike will hit: the cursor target alone, or the
  // multi-target expansion when a MultiTargetResolver is wired in.
  highlighted(attacker = null) {
    const c = this.current;
    if (!c) return [];
    if (this.multiTarget && attacker) {
      const all = this.multiTarget.targets(attacker, this.targets);
      return all.filter((t) => this.targets.includes(t));
    }
    return [c];
  }

  // UI markers per enemy: {enemy, selected, struck} — one row per target so
  // a renderer can highlight the cursor row and the struck fan.
  markers(attacker = null) {
    const struck = this.highlighted(attacker);
    return this.targets.map((e, i) => ({
      enemy: e,
      index: i,
      selected: this.index === i,
      struck: struck.includes(e),
      dead: !this.valid(e),
    }));
  }
}
