// Task #158: Turn-Order Visual Queue — a sidebar view of the upcoming turn
// order (party + enemies). DOM-free: snapshots the TurnOrderQueue's order
// each round, labels each actor's side, tracks the current actor by index
// (the sidebar keeps showing the whole round, current one highlighted), and
// re-rolls a fresh round from the survivors.

export class TurnQueueView {
  constructor(opts = {}) {
    this.queue = opts.queue ?? null; // TurnOrderQueue (optional)
    this.combatants = [];
    this.party = []; // party members (side labeling)
    this.order = []; // snapshot of this round's order
    this.current = null;
    this.pos = 0;
    this.round = 0;
  }

  isParty(c) {
    return this.party.includes(c);
  }

  side(c) {
    return this.isParty(c) ? "party" : "enemy";
  }

  // Build the queue from all combatants; `party` marks whose side is whose.
  build(combatants, party = []) {
    this.combatants = [...(combatants ?? [])];
    this.party = [...party];
    this.current = null;
    this.pos = 0;
    if (this.queue) {
      this.queue.build(this.combatants.filter((c) => (c.hp ?? 0) > 0));
      this.order = [...this.queue.queue()];
    } else {
      this.order = this.combatants.filter((c) => (c.hp ?? 0) > 0);
    }
    return [...this.order];
  }

  // The full round order, current actor marked active: {actor, name, side,
  // hp, active}.
  items() {
    return this.order.map((actor) => ({
      actor,
      name: actor.name,
      side: this.side(actor),
      hp: actor.hp ?? 0,
      active: actor === this.current,
    }));
  }

  remaining() {
    return this.items().slice(this.pos);
  }

  // Advance to the next actor in the round; returns null at round's end.
  next() {
    if (this.pos >= this.order.length) {
      this.current = null;
      return null;
    }
    this.current = this.order[this.pos];
    this.pos += 1;
    return { actor: this.current, side: this.side(this.current), remaining: this.order.length - this.pos };
  }

  // End of the round: rebuild from survivors, bump the round counter.
  endRound() {
    const alive = this.combatants.filter((c) => (c.hp ?? 0) > 0);
    this.current = null;
    this.pos = 0;
    if (this.queue) {
      const r = this.queue.startRound(alive);
      this.round = r.round;
      this.order = [...r.order];
      return r;
    }
    this.round += 1;
    this.order = alive;
    return { round: this.round, order: [...alive] };
  }

  // Compact one-line rendering for logs / terminals.
  render() {
    return this.order
      .map((actor) => {
        let label = actor === this.current ? "[" + actor.name + "]" : actor.name;
        if (!this.isParty(actor)) label += "*";
        return label;
      })
      .join(" > ");
  }
}
