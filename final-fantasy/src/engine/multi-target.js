// Task #129: Multi-Target Attack Resolver — how many enemies a single attack
// can hit (1-4), derived from weapon type (bows & knuckles strike extras)
// plus the attacker's level (an extra target every 8 levels, capped at 4).
// Feeds CombatResolver.multiAttack() so standard attacks can fan out.

export const WEAPON_MULTI_BONUS = {
  dagger: 0,
  sword: 0,
  knuckles: 1,
  staff: 0,
  bow: 1,
  unarmed: 0,
};

export const MAX_TARGETS = 4;

export class MultiTargetResolver {
  constructor(opts = {}) {
    this.weaponScaling = opts.weaponScaling ?? null; // WeaponScalingSystem (optional)
    this.bonus = opts.bonus ?? WEAPON_MULTI_BONUS;
    this.max = opts.max ?? MAX_TARGETS;
  }

  typeBonus(attacker) {
    if (!this.weaponScaling) return 0;
    return this.bonus[this.weaponScaling.type(attacker)] ?? 0;
  }

  levelBonus(attacker) {
    const level = attacker?.level ?? 1;
    return Math.min(this.max - 1, Math.floor((level - 1) / 8));
  }

  targetCount(attacker) {
    return Math.max(1, Math.min(this.max, 1 + this.typeBonus(attacker) + this.levelBonus(attacker)));
  }

  alive(enemies) {
    return (enemies ?? []).filter((e) => (e.hp ?? 0) > 0);
  }

  // The first N living enemies, in encounter order.
  targets(attacker, enemies) {
    return this.alive(enemies).slice(0, this.targetCount(attacker));
  }

  describe(attacker) {
    return {
      count: this.targetCount(attacker),
      typeBonus: this.typeBonus(attacker),
      levelBonus: this.levelBonus(attacker),
    };
  }
}
