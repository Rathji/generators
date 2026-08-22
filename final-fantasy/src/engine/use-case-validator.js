// Task #144: Item Use-Case Validation — refuse spells/items whose targets
// cannot benefit (Cure cannot target an already full-HP ally, Esuna cannot
// be spent on a healthy ally, revive cannot hit a living member). Wired into
// SpellCastingSystem.cast for the "heal" and "cureStatus" spell kinds; the
// consumable path already self-validates in resolveItemEffect.

import { isAlive } from "./targets.js";

function maxHpOf(target) {
  return target?.getStats ? target.getStats().maxHp : (target?.maxHp ?? 0);
}

export class UseCaseValidator {
  // Why a given target is (in)valid for a spell. Returns null when valid.
  reason(spell, target) {
    if (!target) return "no target";
    if (spell.kind === "heal") {
      if (!isAlive(target)) return "target is down";
      if (target.hp >= maxHpOf(target)) return "already full HP";
      return null;
    }
    if (spell.kind === "cureStatus") {
      if (!isAlive(target)) return "target is down";
      if (spell.cureStatus === "all") {
        return target.statuses && target.statuses.length ? null : "nothing to cure";
      }
      if (typeof target.hasStatus === "function") {
        return target.hasStatus(spell.cureStatus) ? null : "not afflicted";
      }
      return target.statuses?.includes(spell.cureStatus) ? null : "not afflicted";
    }
    return isAlive(target) ? null : "target is down";
  }

  spellTargetValid(spell, target) {
    return this.reason(spell, target) === null;
  }

  // Filter a resolved target list down to only usable targets.
  spellTargets(spell, targets) {
    return (targets || []).filter((t) => this.spellTargetValid(spell, t));
  }

  // Validate an already-resolved target list for a cast. `ok` is true when
  // at least one valid target remains. `blocked` lists every rejected
  // target and why.
  validateSpellCast(spell, targets) {
    const valid = this.spellTargets(spell, targets);
    const blocked = (targets || [])
      .filter((t) => !this.spellTargetValid(spell, t))
      .map((t) => ({ target: t, reason: this.reason(spell, t) }));
    const firstReason = blocked[0]?.reason ?? null;
    return {
      ok: valid.length > 0,
      valid,
      blocked,
      reason: blocked.length && !valid.length ? firstReason : null,
    };
  }
}
