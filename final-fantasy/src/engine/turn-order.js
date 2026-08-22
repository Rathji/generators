// Task #126: Turn-Order Queue Resolver — an ordered queue of combatants,
// recalculated every round from agility + speed modifiers (buffs like Haste/
// Slow feed in via the BuffSystem). The queue drives whose turn it is next
// and re-rolls initiative when a round ends.

export class TurnOrderQueue {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.buffs = opts.buffs ?? null; // BuffSystem (optional)
    this.actors = []; // ordered queue of combatants
    this.round = 0;
    this.onRoundStart = opts.onRoundStart ?? null; // (round) => void
  }

  statsOf(c) {
    return typeof c.getStats === "function" ? c.getStats() : c;
  }

  alive(c) {
    return (c.hp ?? 0) > 0;
  }

  // Initiative roll for one combatant: AGI + jitter, plus any buff modifier.
  speedOf(c) {
    const agi = this.statsOf(c).agi ?? 0;
    let spd = agi + Math.floor(this.rng() * (agi / 2 + 1));
    if (this.buffs) spd += this.buffs.speedMod(c);
    return spd;
  }

  // Build (or rebuild) the queue from a set of combatants, highest speed first.
  build(combatants) {
    this.actors = (combatants ?? [])
      .filter((c) => this.alive(c))
      .map((c) => ({ c, spd: this.speedOf(c) }))
      .sort((a, b) => b.spd - a.spd)
      .map((o) => o.c);
    return [...this.actors];
  }

  // Force a re-roll of initiative mid-round (e.g. after a Haste/Slow lands).
  recalculate(combatants = this.actors) {
    return this.build(combatants);
  }

  isEmpty() {
    return this.actors.length === 0;
  }

  peek() {
    return this.actors[0] ?? null;
  }

  next() {
    return this.actors.length ? this.actors.shift() : null;
  }

  remaining() {
    return [...this.actors];
  }

  queue() {
    return [...this.actors];
  }

  // Begin a fresh round: increment the counter, rebuild the queue from the
  // current combatants, and fire the round-start callback.
  startRound(combatants) {
    this.round += 1;
    this.build(combatants);
    if (this.onRoundStart) this.onRoundStart(this.round);
    return { round: this.round, order: [...this.actors] };
  }

  reset() {
    this.actors = [];
    this.round = 0;
    return this;
  }

  // Human-readable ordering with speeds, for debugging/UI.
  describe(combatants) {
    return (combatants ?? []).map((c) => ({ name: c.name, speed: this.speedOf(c) }));
  }
}
