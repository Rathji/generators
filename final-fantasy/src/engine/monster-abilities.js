// Task #116: Monster Ability System — resolves an enemy's signature combat
// move (assigned per monster id) into concrete damage/effects, and audits
// that every assignment references a real ability and a real enemy.

import { MONSTER_ABILITIES, MONSTER_ABILITY_ASSIGN } from "../data/monster-abilities.js";

export class MonsterAbilitySystem {
  constructor(opts = {}) {
    this.abilities = opts.abilities ?? MONSTER_ABILITIES;
    this.assign = opts.assign ?? MONSTER_ABILITY_ASSIGN;
    this.enemySystem = opts.enemySystem ?? null;
  }

  ability(abilityId) {
    return this.abilities[abilityId] ?? null;
  }

  abilityOf(enemyId) {
    const aid = this.assign[enemyId];
    if (!aid) return null;
    return this.abilities[aid] ?? null;
  }

  hasAbility(enemyId) {
    return !!this.abilityOf(enemyId);
  }

  describe(enemyId) {
    const a = this.abilityOf(enemyId);
    if (!a) return null;
    const enemy = this.enemySystem?.template(enemyId);
    return {
      enemyId,
      enemyName: enemy?.name ?? enemyId,
      ability: a.name,
      kind: a.kind,
      element: a.element ?? null,
      power: a.power ?? null,
      summary: (enemy?.name ?? enemyId) + " uses " + a.name + (a.element ? " (" + a.element + ")" : "") + ".",
    };
  }

  // Resolve an ability against a target. `ctx` supplies the combat seams:
  // { random, statsOf, hurt(target, amount), heal(target, amount), status,
  //   affinity(element, target) }.
  resolveAbility(ability, enemy, target, ctx = {}) {
    if (!ability) return { ok: false, messages: [], error: "unknown ability" };
    const rng = ctx.random ?? Math.random;
    const msgs = [];
    const verb = enemy.name + " " + (ability.flavor ?? ("uses " + ability.name + "!"));
    msgs.push(verb);

    if (ability.kind === "heal") {
      const amount = Math.max(1, Math.round((ability.power ?? 10) * (0.9 + rng() * 0.2)));
      const before = enemy.hp;
      if (ctx.heal) ctx.heal(enemy, amount);
      else enemy.hp = Math.min(enemy.maxHp ?? enemy.hp, enemy.hp + amount);
      const healed = enemy.hp - before;
      msgs.push(enemy.name + " recovers " + healed + " HP.");
      return { ok: true, messages: msgs, healed };
    }

    if (ability.kind === "buff") {
      enemy.buffs = enemy.buffs ?? [];
      const existing = enemy.buffs.find((b) => b.stat === ability.stat);
      const buff = { stat: ability.stat, amount: ability.amount ?? 1, turns: ability.turns ?? 3 };
      if (existing) existing.turns = buff.turns;
      else enemy.buffs.push(buff);
      msgs.push(enemy.name + "'s " + ability.stat + " surges!");
      return { ok: true, messages: msgs, buff };
    }

    const isMagic = ability.kind === "magic" || ability.kind === "debuff";
    const a = ctx.statsOf ? ctx.statsOf(enemy) : enemy;
    const t = ctx.statsOf ? ctx.statsOf(target) : target;
    if (!t) return { ok: false, messages: msgs, error: "no target" };
    const atk = isMagic ? (a.int ?? 0) + (ability.power ?? 0) : (a.str ?? 0) + (a.atk ?? 0) + (ability.power ?? 0);
    const def = isMagic ? (t.mdef ?? 0) : (t.def ?? 0);
    let damage = Math.max(1, Math.round(Math.max(1, atk - def) * (0.85 + rng() * 0.3)));
    if (ability.element) {
      const mult = ctx.affinity ? ctx.affinity(ability.element, target) : 1;
      damage = Math.max(1, Math.round(damage * mult));
    }
    const dealt = ctx.hurt ? ctx.hurt(target, damage) : damage;
    msgs.push(enemy.name + "'s " + ability.name + " hits " + target.name + " for " + dealt + " damage!");
    const result = { ok: true, messages: msgs, damage: dealt, element: ability.element ?? null, kind: ability.kind };

    if (ability.kind === "debuff" && ability.status && ctx.status) {
      const res = ctx.status.apply(target, ability.status.id, { chance: ability.status.chance ?? 1 });
      if (res.ok) {
        msgs.push(target.name + " is " + res.name + "!");
        result.status = res.status;
      }
    }
    return result;
  }

  // Every assigned enemy must exist; every assigned ability must exist.
  audit() {
    const errors = [];
    for (const [enemyId, aid] of Object.entries(this.assign)) {
      if (this.enemySystem && !this.enemySystem.exists(enemyId)) {
        errors.push({ enemy: enemyId, error: "unknown enemy id" });
      }
      if (!this.abilities[aid]) {
        errors.push({ enemy: enemyId, ability: aid, error: "unknown ability" });
      }
    }
    for (const [id, def] of Object.entries(this.abilities)) {
      if (!def.name) errors.push({ ability: id, error: "missing name" });
      if (def.element && def.element !== null && typeof def.element !== "string") {
        errors.push({ ability: id, error: "invalid element" });
      }
      if (def.target !== "self" && def.target !== "single") {
        errors.push({ ability: id, error: "unknown target: " + def.target });
      }
    }
    return { ok: errors.length === 0, errors };
  }
}
