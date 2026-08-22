// Task #128: Party-Wide Buff/Debuff System — temporary stat modifiers (Haste
// +AGI, Blind -hit chance, Might +STR, ...) tracked per target with turn
// timers, ticked each round. Stat deltas flow into getEffectiveStats via a
// hook, and hit/speed modifiers are consumed by CombatResolver when the
// system is wired in.

import { BUFF_DEFS } from "../data/buffs.js";

const KNOWN_STATS = ["atk", "hp", "mp", "str", "int", "agi", "def", "mdef", "maxHp", "maxMp"];

export class BuffSystem {
  constructor(opts = {}) {
    this.defs = opts.defs ?? BUFF_DEFS;
    this.timers = new Map(); // target -> Map(buffId -> turnsLeft)
  }

  def(buffId) {
    return this.defs[buffId] ?? null;
  }

  _timers(target) {
    if (!this.timers.has(target)) this.timers.set(target, new Map());
    return this.timers.get(target);
  }

  has(target, buffId) {
    return this._timers(target).has(buffId);
  }

  remaining(target, buffId) {
    return this._timers(target).get(buffId) ?? 0;
  }

  active(target) {
    return [...this._timers(target).keys()].map((bid) => ({
      id: bid,
      name: this.def(bid)?.name ?? bid,
      turns: this._timers(target).get(bid),
    }));
  }

  activeNames(target) {
    return this.active(target).map((b) => b.name);
  }

  // Apply (or refresh) a buff. `turns` defaults to the def's duration.
  apply(target, buffId, opts = {}) {
    const def = this.def(buffId);
    if (!def) return { ok: false, error: "unknown buff", buff: buffId };
    if (target.hp !== undefined && (target.hp ?? 0) <= 0) return { ok: false, error: "target down", buff: buffId };
    const turns = opts.turns ?? def.turns;
    this._timers(target).set(buffId, turns);
    return { ok: true, buff: buffId, name: def.name, turns };
  }

  // Buff every living party member at once (party-wide buffs).
  applyToParty(party, buffId, opts = {}) {
    const results = [];
    for (const m of party?.members ?? []) results.push(this.apply(m, buffId, opts));
    return { ok: results.some((r) => r.ok), results };
  }

  remove(target, buffId) {
    if (this._timers(target).delete(buffId)) return { ok: true, removed: buffId };
    return { ok: false, error: "not applied", buff: buffId };
  }

  clear(target) {
    this.timers.delete(target);
    return { ok: true };
  }

  clearAll() {
    this.timers.clear();
    return this;
  }

  refresh(target, buffId, opts = {}) {
    const def = this.def(buffId);
    if (!def) return { ok: false, error: "unknown buff", buff: buffId };
    const turns = opts.turns ?? def.turns;
    this._timers(target).set(buffId, turns);
    return { ok: true, buff: buffId, turns };
  }

  // Advance one turn: durations tick down, expired buffs are removed.
  tick(target) {
    const events = [];
    const timer = this._timers(target);
    for (const [buffId, left] of [...timer]) {
      const next = left - 1;
      if (next <= 0) {
        timer.delete(buffId);
        events.push({ type: "woreOff", buff: buffId, name: this.def(buffId)?.name ?? buffId, target });
      } else {
        timer.set(buffId, next);
      }
    }
    return events;
  }

  tickAll(combatants) {
    const events = [];
    for (const c of combatants ?? []) events.push(...this.tick(c));
    return events;
  }

  tickParty(party) {
    return this.tickAll(party?.members ?? []);
  }

  // Merged flat stat deltas from every active buff (e.g. { agi: 3, str: -2 }).
  statMods(target) {
    const out = {};
    for (const buffId of this._timers(target).keys()) {
      const mods = this.def(buffId)?.statMods;
      if (!mods) continue;
      for (const k in mods) out[k] = (out[k] || 0) + mods[k];
    }
    return out;
  }

  // Additive hit-chance modifier for the target as ATTACKER (Blind -0.25).
  hitChanceMod(target) {
    let m = 0;
    for (const buffId of this._timers(target).keys()) m += this.def(buffId)?.hitChance ?? 0;
    return m;
  }

  // Turn-order speed modifier (Haste +3 AGI feeds the turn queue).
  speedMod(target) {
    return this.statMods(target).agi ?? 0;
  }

  describe(buffId) {
    const def = this.def(buffId);
    if (!def) return null;
    return {
      id: buffId,
      name: def.name,
      friendly: def.friendly ?? true,
      turns: def.turns,
      statMods: def.statMods ?? {},
      hitChance: def.hitChance ?? 0,
      summary: def.summary ?? (def.name + " for " + def.turns + " turns."),
    };
  }

  audit() {
    const errors = [];
    for (const [id, def] of Object.entries(this.defs)) {
      if (!def.name) errors.push({ buff: id, error: "missing name" });
      if (!Number.isFinite(def.turns) || def.turns < 1) errors.push({ buff: id, error: "invalid turns" });
      if (def.statMods) {
        for (const stat of Object.keys(def.statMods)) {
          if (!KNOWN_STATS.includes(stat)) errors.push({ buff: id, error: "unknown stat: " + stat });
        }
      }
      const hc = def.hitChance ?? 0;
      if (hc < -1 || hc > 1) errors.push({ buff: id, error: "hitChance out of range" });
    }
    return { ok: errors.length === 0, errors };
  }
}
