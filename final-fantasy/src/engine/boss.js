// Task #32: Boss Phase Transition Logic — bosses change attack patterns and
// stats when their HP drops below configured thresholds.

export class BossPhaseController {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.history = []; // log of transitions
  }

  isBoss(enemy) {
    return !!enemy && (enemy.boss === true || (Array.isArray(enemy.phases) && enemy.phases.length > 0));
  }

  // Index of the phase the enemy is currently in: 0 = base (no phase yet),
  // 1..n = the phase triggered at the corresponding threshold.
  activePhase(enemy) {
    if (!enemy || !Array.isArray(enemy.phases) || !enemy.phases.length) return 0;
    const ratio = (enemy.hp ?? 0) / Math.max(1, enemy.maxHp ?? 1);
    let idx = 0;
    for (let i = 0; i < enemy.phases.length; i++) {
      if (ratio <= enemy.phases[i].below) idx = i + 1;
    }
    return idx;
  }

  // Apply any newly-crossed phases. Returns a transition report or null.
  checkPhase(enemy) {
    if (!this.isBoss(enemy)) return null;
    const target = this.activePhase(enemy);
    const current = enemy.currentPhase ?? 0;
    if (target <= current) return null;
    const transitions = [];
    for (let p = current + 1; p <= target; p++) {
      const def = enemy.phases[p - 1];
      this._apply(enemy, def);
      enemy.currentPhase = p;
      const record = { phase: p, name: def.name ?? "Phase " + p, enemy };
      enemy.phaseTransitions.push(record);
      transitions.push(record);
    }
    this.history.push(...transitions);
    return { enemy, transitions };
  }

  phaseState(enemy) {
    if (!enemy) return { phase: 0, name: null };
    if (enemy.currentPhase <= 0 || !Array.isArray(enemy.phases)) {
      return { phase: 0, name: null };
    }
    const def = enemy.phases[enemy.currentPhase - 1];
    return { phase: enemy.currentPhase, name: def ? def.name ?? null : null };
  }

  reset(enemy) {
    if (enemy) {
      enemy.currentPhase = 0;
      enemy.phaseTransitions = [];
    }
    return enemy;
  }

  _apply(enemy, def) {
    for (const stat of ["str", "atk", "int", "agi", "def", "mdef"]) {
      if (typeof def[stat] === "number") enemy[stat] = (enemy[stat] ?? 0) + def[stat];
    }
    if (typeof def.hp === "number") {
      enemy.hp = Math.min(enemy.maxHp, (enemy.hp ?? 0) + def.hp);
    }
    if (typeof def.mp === "number") {
      enemy.mp = Math.min(enemy.maxMp ?? (enemy.mp ?? 0), (enemy.mp ?? 0) + def.mp);
    }
    if (def.ai) {
      enemy.ai = {
        ...(enemy.ai ?? {}),
        ...def.ai,
        spells: def.ai.spells ? [...def.ai.spells] : (enemy.ai?.spells ? [...enemy.ai.spells] : []),
      };
    }
  }
}
