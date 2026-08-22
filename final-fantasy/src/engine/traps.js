// Task #146: Trap Trigger System — hidden tiles on walkable ground that
// spring a negative effect (damage, poison, paralysis, gold loss) the first
// time the party steps on them (or again after a cooldown). Pure logic over
// GameState/party/status — no DOM — so it is unit-testable.

import { TileMap } from "./grid.js";

export class TrapSystem {
  constructor(traps = [], opts = {}) {
    this.traps = traps;
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.status = opts.status ?? null;
    this.random = opts.random ?? Math.random;
    this.step = 0;
  }

  all() {
    return [...this.traps];
  }

  trapById(id) {
    return this.traps.find((t) => t.id === id) ?? null;
  }

  trapsFor(mapId) {
    return this.traps.filter((t) => t.mapId === mapId);
  }

  trapAt(mapId, x, y) {
    return this.traps.find((t) => t.mapId === mapId && t.x === x && t.y === y) ?? null;
  }

  _flag(trap) {
    return "trap_" + trap.id + "_sprung";
  }

  isSprung(trap) {
    if (!trap) return false;
    if (trap.once) return !!(this.state && this.state.getFlag(this._flag(trap)));
    if (!this.state) return false;
    const last = this._sprungStep(trap);
    if (last == null) return false;
    if (!trap.cooldownSteps) return true;
    return this.step - last < trap.cooldownSteps;
  }

  // Cooldown traps record the step they last fired on (raw number flag).
  _sprungStep(trap) {
    if (!this.state) return null;
    const raw = this.state.flags["trap_" + trap.id + "_step"];
    return raw == null ? null : Number(raw);
  }

  _markSprung(trap) {
    if (!this.state) return;
    if (trap.once) this.state.setFlag(this._flag(trap), true);
    else this.state.flags["trap_" + trap.id + "_step"] = this.step;
  }

  // Bump the internal step counter (the demo calls this each move).
  onStep() {
    this.step += 1;
    return this;
  }

  // Step on (mapId, x, y): springs the trap there if present and armed.
  // `step` overrides the internal counter (useful for deterministic tests).
  check(mapId, x, y, step = null) {
    const trap = this.trapAt(mapId, x, y);
    if (!trap) return { ok: false, error: "no trap", trap: null };
    if (step != null) this.step = Math.max(this.step, step);
    if (trap.once) {
      if (this.isSprung(trap)) return { ok: false, error: "already sprung", trap };
    } else {
      const last = this._sprungStep(trap);
      if (last != null && (!trap.cooldownSteps || this.step - last < trap.cooldownSteps)) {
        return { ok: false, error: "rearming", trap };
      }
    }
    if (this.random() >= (trap.chance ?? 1)) return { ok: false, error: "dodged", trap };
    this._markSprung(trap);
    const effects = this._apply(trap.effect);
    return { ok: true, trap, line: trap.line, effects };
  }

  _apply(effect) {
    const effects = [];
    const members = this.party?.members ?? [];
    if (effect.kind === "damage") {
      for (const m of members) {
        if (m.hp <= 0) continue;
        if (typeof m.damage === "function") m.damage(effect.amount);
        else m.hp = Math.max(0, m.hp - effect.amount);
        effects.push({ type: "damage", member: m, amount: effect.amount });
      }
    } else if (effect.kind === "status") {
      for (const m of members) {
        if (m.hp <= 0) continue;
        const r = this.status
          ? this.status.apply(m, effect.status, { chance: effect.chance ?? 1, turns: effect.turns })
          : { ok: false };
        if (r.ok) effects.push({ type: "status", member: m, status: effect.status });
      }
    } else if (effect.kind === "drainGold") {
      const take = Math.max(0, Math.min(effect.amount, this.party?.gold ?? 0));
      if (this.party) this.party.gold -= take;
      effects.push({ type: "drainGold", amount: take });
    }
    return effects;
  }

  sprung() {
    return this.traps.filter((t) => this.isSprung(t));
  }

  remaining() {
    return this.traps.filter((t) => !this.isSprung(t));
  }

  reset() {
    for (const t of this.traps) {
      if (this.state) {
        this.state.clearFlag(this._flag(t));
        delete this.state.flags["trap_" + t.id + "_step"];
      }
    }
    return this;
  }

  // Every trap must sit on a walkable (in-bounds, non-solid) tile so the
  // party can actually reach it.
  audit(registry) {
    const errors = [];
    for (const t of this.traps) {
      const def = registry?.get?.(t.mapId);
      if (!def) {
        errors.push({ id: t.id, error: "no such map: " + t.mapId });
        continue;
      }
      const tm = TileMap.fromAscii(def.rows, { tiles: def.tiles, solid: def.solid });
      if (!tm.canStand(t.x, t.y)) errors.push({ id: t.id, error: "tile not walkable at " + t.x + "," + t.y });
    }
    return errors;
  }
}
