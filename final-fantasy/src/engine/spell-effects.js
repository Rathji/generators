// Task #65: Spell Effect Mapping — every spell resolves to a functional
// outcome: elemental damage, healing, status infliction, or status curing.

import { SPELLS } from "../data/spells.js";

export class SpellEffectSystem {
  // Categorize a spell by what it actually does.
  classify(spell) {
    if (spell.kind === "heal") return "heal";
    if (spell.kind === "cureStatus") return "cureStatus";
    if (spell.inflict) return "status";
    if (spell.kind === "damage") return "damage";
    return "unknown";
  }

  profile(spellId) {
    const spell = SPELLS[spellId];
    if (!spell) return null;
    return {
      spellId,
      name: spell.name,
      kind: this.classify(spell),
      element: spell.element ?? null,
      target: spell.target ?? "single-enemy",
      mp: spell.mp,
      power: spell.power ?? 0,
      inflict: spell.inflict ?? null,
      cureStatus: spell.cureStatus ?? null,
    };
  }

  describe(spellId) {
    const p = this.profile(spellId);
    if (!p) return null;
    if (p.kind === "damage")
      return p.name + ": deals " + p.power + " " + (p.element ?? "elemental") + " damage to " + p.target.replace(/-/g, " ") + ".";
    if (p.kind === "heal") return p.name + ": restores " + p.power + " HP to " + p.target.replace(/-/g, " ") + ".";
    if (p.kind === "status") return p.name + ": inflicts " + p.inflict.status + " on " + p.target.replace(/-/g, " ") + ".";
    if (p.kind === "cureStatus")
      return p.name + ": cures " + (p.cureStatus === "all" ? "all status ailments" : p.cureStatus) + " on " + p.target.replace(/-/g, " ") + ".";
    return p.name;
  }

  // Execute the non-damage outcome of a spell against one target, delegating
  // to a StatusEffectSystem when available.
  resolve(spellId, target, ctx = {}) {
    const p = this.profile(spellId);
    if (!p) return { ok: false, error: "unknown spell" };
    if (!ctx.status) return { ok: false, error: "status system required" };
    if (p.kind === "status") {
      const r = ctx.status.apply(target, p.inflict.status, { chance: p.inflict.chance ?? 1 });
      return { ok: r.ok, status: p.inflict.status, resisted: r.error === "resisted" };
    }
    if (p.kind === "cureStatus") {
      const r =
        p.cureStatus === "all" ? ctx.status.cureAll(target) : ctx.status.cure(target, p.cureStatus);
      return { ok: r.ok, cured: r.cured };
    }
    return { ok: false, error: "damage/heal spells are resolved by the casting system" };
  }
}
