// Task #60: Flavor System — draws ambient NPC flavor lines from the flavor
// database, preferring lines the player hasn't seen yet in each category.

import { FLAVOR_TEXTS } from "../data/flavor.js";

export class FlavorSystem {
  constructor(db = FLAVOR_TEXTS, opts = {}) {
    this.db = db;
    this.random = opts.random ?? Math.random;
    this.seen = new Set();
    this.maxRetries = opts.maxRetries ?? 8;
  }

  categories() {
    return Object.keys(this.db);
  }

  lines(category) {
    return [...(this.db[category] ?? [])];
  }

  count(category) {
    return this.lines(category).length;
  }

  _entryId(category, entry, index) {
    return entry.id ?? category + "#" + index;
  }

  // Pick a line from a category, preferring unseen ones.
  pick(category, opts = {}) {
    const list = this.lines(category);
    if (!list.length) return null;
    const pool = list.map((l, i) => (typeof l === "string" ? { id: category + "#" + i, text: l } : { ...l, id: this._entryId(category, l, i) }));
    let attempts = 0;
    let chosen = null;
    do {
      chosen = pool[Math.floor(this.random() * pool.length)];
      attempts++;
    } while (opts.noRepeat !== false && this.seen.has(chosen.id) && attempts < this.maxRetries && this.seen.size < pool.length);
    const wasSeen = this.seen.has(chosen.id);
    this.seen.add(chosen.id);
    return {
      category,
      id: chosen.id,
      text: chosen.text,
      speaker: chosen.speaker ?? null,
      fresh: !wasSeen,
    };
  }

  pickMany(category, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const line = this.pick(category);
      if (line) out.push(line);
    }
    return out;
  }

  seenCount(category = null) {
    if (!category) return this.seen.size;
    const valid = new Set(this.lines(category).map((l, i) => this._entryId(category, l, i)));
    let n = 0;
    for (const id of this.seen) if (valid.has(id)) n++;
    return n;
  }

  unseen(category) {
    return this.lines(category).filter((l, i) => !this.seen.has(this._entryId(category, l, i)));
  }

  exhausted(category) {
    const list = this.lines(category);
    return list.length > 0 && list.every((l, i) => this.seen.has(this._entryId(category, l, i)));
  }

  resetSeen() {
    this.seen.clear();
    return this;
  }
}
