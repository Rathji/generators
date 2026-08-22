// Task #61: Status Effect State Machine — tracks Poison, Sleep, Stone,
// Paralysis (and the synergy primer Soaked) with turn-by-turn rules:
// poison ticks damage, sleep/stone block actions, paralysis may skip turns,
// and some statuses wear off over time or when the target is hit.

export const STATUS_DEFS = {
  poison: { id: "poison", name: "Poison", turns: Infinity, blockChance: 0, damageFrac: 1 / 8, wakeOnHit: false, persistOnDeath: false },
  sleep: { id: "sleep", name: "Sleep", turns: 3, blockChance: 1, damageFrac: 0, wakeOnHit: true, persistOnDeath: false },
  paralysis: { id: "paralysis", name: "Paralysis", turns: 2, blockChance: 0.5, damageFrac: 0, wakeOnHit: false, persistOnDeath: false },
  stone: { id: "stone", name: "Stone", turns: Infinity, blockChance: 1, damageFrac: 0, wakeOnHit: false, persistOnDeath: true },
  soaked: { id: "soaked", name: "Soaked", turns: 3, blockChance: 0, damageFrac: 0, wakeOnHit: false, persistOnDeath: false },
};

export const STATUS_IDS = Object.freeze(Object.keys(STATUS_DEFS));

export class StatusEffectSystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.defs = opts.defs ?? STATUS_DEFS;
    this.timers = new Map(); // target -> Map(statusId -> turnsLeft)
    // Optional external immunity source (e.g. accessory slot). Return truthy
    // to treat the target as immune for that status.
    this.immunityHook = opts.immunityHook ?? null;
  }

  def(statusId) {
    return this.defs[statusId] ?? null;
  }

  maxHpOf(t) {
    return t.maxHp ?? (typeof t.getStats === "function" ? t.getStats().maxHp : t.hp);
  }

  _timers(target) {
    if (!this.timers.has(target)) this.timers.set(target, new Map());
    return this.timers.get(target);
  }

  _ensure(target) {
    if (!Array.isArray(target.statuses)) target.statuses = [];
    return target.statuses;
  }

  // Targets may declare status immunity via `statusImmune` (or an elements
  // `immune` list, e.g. undead ignoring poison), or via the optional
  // immunityHook (e.g. an equipped accessory like the Ribbon).
  immune(target, statusId) {
    if (Array.isArray(target.statusImmune) && target.statusImmune.includes(statusId)) return true;
    const el = target.elements;
    if (el && Array.isArray(el.immune) && el.immune.includes(statusId)) return true;
    if (this.immunityHook && this.immunityHook(target, statusId)) return true;
    return false;
  }

  has(target, statusId) {
    return Array.isArray(target.statuses) && target.statuses.includes(statusId);
  }

  turnsLeft(target, statusId) {
    return this._timers(target).get(statusId) ?? 0;
  }

  active(target) {
    if (!Array.isArray(target.statuses)) return [];
    return target.statuses.map((s) => ({
      status: s,
      name: this.def(s)?.name ?? s,
      turns: this.turnsLeft(target, s),
    }));
  }

  // Attempt to afflict a status. `chance` (default 1) rolls against this.rng.
  apply(target, statusId, opts = {}) {
    const def = this.def(statusId);
    if (!def) return { ok: false, error: "unknown status", status: statusId };
    if (this.immune(target, statusId)) return { ok: false, error: "immune", status: statusId };
    const chance = opts.chance ?? 1;
    if (this.rng() >= chance) return { ok: false, error: "resisted", status: statusId };
    const list = this._ensure(target);
    if (!list.includes(statusId)) list.push(statusId);
    const turns = opts.turns ?? def.turns;
    this._timers(target).set(statusId, turns);
    return { ok: true, status: statusId, name: def.name, turns };
  }

  cure(target, statusId) {
    if (!this.has(target, statusId)) return { ok: false, error: "not afflicted", status: statusId };
    this._ensure(target);
    target.statuses = target.statuses.filter((s) => s !== statusId);
    this._timers(target).delete(statusId);
    return { ok: true, cured: statusId };
  }

  cureAll(target) {
    const cured = Array.isArray(target.statuses) ? [...target.statuses] : [];
    if (Array.isArray(target.statuses)) target.statuses = [];
    this.timers.delete(target);
    return { ok: true, cured };
  }

  // When a target falls, drop most statuses (stone lingers on the body).
  clearOnDeath(target) {
    if ((target.hp ?? 0) > 0) return;
    target.statuses = (Array.isArray(target.statuses) ? target.statuses : []).filter(
      (s) => this.def(s)?.persistOnDeath
    );
    this.timers.delete(target);
  }

  // Advance one turn for the target: poison ticks damage, durations tick down.
  tick(target) {
    const events = [];
    if ((target.hp ?? 0) <= 0) return events;
    const maxHp = this.maxHpOf(target);
    const timer = this._timers(target);
    for (const statusId of [...(target.statuses ?? [])]) {
      const def = this.def(statusId);
      if (!def) continue;
      if (def.damageFrac && (target.hp ?? 0) > 0) {
        const dmg = Math.max(1, Math.floor(maxHp * def.damageFrac));
        target.hp = Math.max(0, (target.hp ?? 0) - dmg);
        events.push({ type: "damage", status: statusId, name: def.name, amount: dmg, target });
        if ((target.hp ?? 0) <= 0) this.clearOnDeath(target);
      }
      const turns = timer.get(statusId);
      if (Number.isFinite(turns)) {
        const left = turns - 1;
        if (left <= 0) {
          target.statuses = target.statuses.filter((s) => s !== statusId);
          timer.delete(statusId);
          events.push({ type: "woreOff", status: statusId, name: def.name, target });
        } else {
          timer.set(statusId, left);
        }
      }
    }
    return events;
  }

  tickAll(combatants) {
    const events = [];
    for (const c of combatants) events.push(...this.tick(c));
    return events;
  }

  // Whether the target cannot act this turn. Returns the blocking status id,
  // or false. Sleep/stone always block; paralysis blocks by chance.
  blocked(target, rng = this.rng) {
    if (!Array.isArray(target.statuses)) return false;
    for (const statusId of target.statuses) {
      const def = this.def(statusId);
      if (!def || !def.blockChance) continue;
      if (def.blockChance >= 1 || rng() < def.blockChance) return statusId;
    }
    return false;
  }

  // Called when the target takes a physical hit (jolts sleepers awake).
  onHit(target) {
    if (!Array.isArray(target.statuses)) return [];
    const woke = [];
    for (const statusId of [...target.statuses]) {
      if (this.def(statusId)?.wakeOnHit) {
        this.cure(target, statusId);
        woke.push(statusId);
      }
    }
    return woke;
  }

  reset() {
    this.timers.clear();
    return this;
  }
}
