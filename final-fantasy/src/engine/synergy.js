// Task #63: Combat Combo/Synergy Logic — status effects boost specific
// elemental spells (Water soaks a target, then Lightning strikes harder).

export const SYNERGY_DEFS = [
  { id: "soak_lightning", status: "soaked", element: "lightning", multiplier: 1.5 },
];

export class SynergySystem {
  constructor(opts = {}) {
    this.rules = opts.rules ?? SYNERGY_DEFS;
    this.status = opts.status ?? null; // StatusEffectSystem (optional)
  }

  _hasStatus(target, statusId) {
    if (this.status && typeof this.status.has === "function") return this.status.has(target, statusId);
    return Array.isArray(target?.statuses) && target.statuses.includes(statusId);
  }

  // Damage multiplier for casting `element` at a target carrying a synergy
  // status (defaults to 1 when no rule applies).
  boostFor(target, element) {
    if (!element) return 1;
    let mult = 1;
    for (const rule of this.rules) {
      if (rule.element !== element) continue;
      if (!this._hasStatus(target, rule.status)) continue;
      mult *= rule.multiplier;
    }
    return mult;
  }

  rulesForStatus(statusId) {
    return this.rules.filter((r) => r.status === statusId);
  }

  rulesForElement(element) {
    return this.rules.filter((r) => r.element === element);
  }

  // UI hint, e.g. "+50% vs Soaked".
  hint(element) {
    const rs = this.rulesForElement(element);
    if (!rs.length) return null;
    return rs.map((r) => "+" + Math.round((r.multiplier - 1) * 100) + "% vs " + r.status).join(" ");
  }
}
