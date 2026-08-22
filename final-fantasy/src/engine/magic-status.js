// Task #133: Magic-Based Status Infliction — every status spell carries its
// own status id, chance, and turn duration (Sleep puts a target to sleep for
// 2 turns, Poison for 4, Hold for 2, Water's soak for 2). This system
// extracts that mapping and applies it through a StatusEffectSystem, and
// audits that every status spell has a fully-specified inflict block.

import { SPELLS } from "../data/spells.js";

export class MagicStatusInflictionSystem {
  constructor(opts = {}) {
    this.db = opts.spells ?? SPELLS;
  }

  statusSpells() {
    return Object.entries(this.db).filter(([, spell]) => spell.kind === "status");
  }

  // { status, chance, turns } for a spell, or null if it inflicts nothing.
  statusOf(spellId) {
    const spell = this.db[spellId];
    if (!spell?.inflict) return null;
    return {
      spellId,
      status: spell.inflict.status,
      chance: spell.inflict.chance ?? 1,
      turns: spell.inflict.turns ?? null,
    };
  }

  describe(spellId) {
    const spell = this.db[spellId];
    const info = this.statusOf(spellId);
    if (!spell || !info) return null;
    return {
      spellId,
      name: spell.name,
      status: info.status,
      chance: info.chance,
      turns: info.turns,
      summary: spell.name + " inflicts " + info.status + " for " + (info.turns ?? "its default") + " turn(s) (chance " + Math.round(info.chance * 100) + "%).",
    };
  }

  // Apply a status spell's effect to a target via a StatusEffectSystem.
  apply(spellId, target, ctx = {}) {
    const info = this.statusOf(spellId);
    if (!info || !ctx.status) return { ok: false, error: "no status" };
    return ctx.status.apply(target, info.status, {
      chance: info.chance,
      turns: info.turns ?? undefined,
    });
  }

  audit() {
    const errors = [];
    for (const [id, spell] of this.statusSpells()) {
      if (!spell.inflict) {
        errors.push({ spell: id, error: "status spell missing inflict" });
        continue;
      }
      if (!spell.inflict.status) errors.push({ spell: id, error: "inflict missing status" });
      if (typeof spell.inflict.turns !== "number" || spell.inflict.turns < 1) {
        errors.push({ spell: id, error: "inflict missing turns" });
      }
      const chance = spell.inflict.chance ?? 1;
      if (chance < 0 || chance > 1) errors.push({ spell: id, error: "chance out of range" });
    }
    return { ok: errors.length === 0, errors };
  }
}
