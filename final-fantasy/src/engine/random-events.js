// Task #135: World Map Random Event System — low-probability non-combat
// encounters while crossing the overworld: found items, stray gold, a
// wandering merchant, or a friendly fairy's healing. Weighted pick table,
// per-map opt-in, and a minimum-step gap between events.

import { RANDOM_EVENTS } from "../data/random-events.js";

const VALID_KINDS = ["item", "gold", "merchant", "heal"];

export class RandomEventSystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.events = opts.events ?? RANDOM_EVENTS;
    this.maps = opts.maps ?? ["overworld"];
    this.chance = opts.chance ?? 0.03; // probability per step
    this.minGap = opts.minGap ?? 8; // steps between events
    this.sinceLast = 0;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
    this.items = opts.items ?? null; // ITEMS db for audit
    this.lastEvent = null;
  }

  allows(mapId) {
    return this.maps.includes(mapId);
  }

  setChance(chance) {
    this.chance = chance;
    return this;
  }

  totalWeight() {
    return this.events.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  }

  pick() {
    const total = this.totalWeight();
    if (!total) return null;
    let roll = this.rng() * total;
    for (const e of this.events) {
      roll -= e.weight ?? 1;
      if (roll < 0) return e;
    }
    return this.events[this.events.length - 1] ?? null;
  }

  // Roll for an event on this step. Returns the event or null.
  roll(mapId) {
    if (!this.allows(mapId)) return null;
    this.sinceLast += 1;
    if (this.sinceLast < this.minGap) return null;
    if (this.rng() >= this.chance) return null;
    const ev = this.pick();
    if (!ev) return null;
    this.sinceLast = 0;
    this.lastEvent = ev;
    return ev;
  }

  // Apply an event's effect. Returns { ok, kind, message, ...details }.
  resolve(event, ctx = {}) {
    const inventory = ctx.inventory ?? this.inventory;
    const party = ctx.party ?? this.party;
    if (!event) return { ok: false, error: "no event" };
    if (event.kind === "item" || event.kind === "merchant") {
      const itemId = event.itemId;
      const count = event.count ?? 1;
      let added = true;
      let overflow = false;
      if (inventory) {
        if (inventory.has(itemId)) added = true;
        else added = inventory.add(itemId, count) === true;
        overflow = !added;
      }
      return { ok: true, kind: event.kind, itemId, count, added, overflow, message: event.message };
    }
    if (event.kind === "gold") {
      const min = event.min ?? 10;
      const max = event.max ?? min;
      const amount = Math.floor(min + this.rng() * (max - min + 1));
      const gold = party ? party.addGold(amount) : amount;
      return { ok: true, kind: "gold", amount, gold, message: event.message };
    }
    if (event.kind === "heal") {
      const healed = [];
      for (const m of party?.members ?? []) {
        if (!m.isAlive?.()) continue;
        const maxHp = m.getStats?.().maxHp ?? m.maxHp ?? m.hp;
        const amount = Math.max(1, Math.round(maxHp * (event.frac ?? 0.3)));
        const before = m.hp;
        if (typeof m.heal === "function") m.heal(amount);
        else m.hp = Math.min(maxHp, (m.hp ?? 0) + amount);
        healed.push({ id: m.id, amount: m.hp - before });
      }
      return { ok: true, kind: "heal", healed, message: event.message };
    }
    return { ok: false, error: "unknown event kind: " + event.kind };
  }

  describe(event) {
    if (!event) return null;
    return { id: event.id, kind: event.kind, message: event.message };
  }

  audit() {
    const errors = [];
    for (const e of this.events) {
      if (!e.id) errors.push({ event: e, error: "missing id" });
      if (!VALID_KINDS.includes(e.kind)) errors.push({ event: e.id, error: "unknown kind: " + e.kind });
      if (typeof e.weight !== "number" || e.weight <= 0) errors.push({ event: e.id, error: "invalid weight" });
      if ((e.kind === "item" || e.kind === "merchant") && this.items && !this.items[e.itemId]) {
        errors.push({ event: e.id, error: "unknown item: " + e.itemId });
      }
      if (e.kind === "gold" && (e.max ?? e.min ?? 0) < (e.min ?? 0)) errors.push({ event: e.id, error: "invalid gold range" });
    }
    return { ok: errors.length === 0, errors };
  }
}
