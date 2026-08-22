// Task #122: Balance System — global combat-math modifiers applied at the
// damage, encounter-rate and reward seams, plus an audit that the config is
// sane. Identity by default (all multipliers 1).

import { BALANCE } from "../data/balance.js";

export class BalanceSystem {
  constructor(config = BALANCE) {
    this.config = config;
  }

  get damageMultiplier() {
    return this.config.damageMultiplier ?? 1;
  }

  get encounterRateMultiplier() {
    return this.config.encounterRateMultiplier ?? 1;
  }

  get goldMultiplier() {
    return this.config.goldMultiplier ?? 1;
  }

  get xpMultiplier() {
    return this.config.xpMultiplier ?? 1;
  }

  scaleDamage(amount) {
    return Math.max(1, Math.round(amount * this.damageMultiplier));
  }

  encounterRate(rate) {
    return Math.min(1, Math.max(0, rate * this.encounterRateMultiplier));
  }

  gold(amount) {
    return Math.max(0, Math.round(amount * this.goldMultiplier));
  }

  xp(amount) {
    return Math.max(0, Math.round(amount * this.xpMultiplier));
  }

  report() {
    return {
      damageMultiplier: this.damageMultiplier,
      encounterRateMultiplier: this.encounterRateMultiplier,
      goldMultiplier: this.goldMultiplier,
      xpMultiplier: this.xpMultiplier,
    };
  }

  audit() {
    const a = this.config.audit ?? {};
    const min = a.minMultiplier ?? 0;
    const max = a.maxMultiplier ?? 5;
    const errors = [];
    const values = {
      damage: this.damageMultiplier,
      encounter: this.encounterRateMultiplier,
      gold: this.goldMultiplier,
      xp: this.xpMultiplier,
    };
    for (const [name, v] of Object.entries(values)) {
      if (typeof v !== "number" || v < min || v > max) {
        errors.push({ modifier: name, value: v, error: "outside [" + min + "," + max + "]" });
      }
    }
    return { ok: errors.length === 0, errors, report: this.report() };
  }
}
