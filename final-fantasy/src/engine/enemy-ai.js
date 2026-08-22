// Task #31: Basic Enemy Action Logic — a decision tree for standard mobs:
// "cast a spell if it has one, MP, and the roll says so; otherwise attack
// a living party member."

import { SPELLS } from "../data/spells.js";

export class EnemyAI {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.targeting = opts.targeting ?? null; // TargetPrioritySystem
    this.status = opts.status ?? null; // StatusEffectSystem
    this.abilities = opts.abilities ?? null; // MonsterAbilitySystem (Task #116)
  }

  alive(list) {
    return (list || []).filter((c) => (c.hp ?? 0) > 0);
  }

  canCast(enemy, spellId) {
    const spell = SPELLS[spellId];
    if (!spell) return false;
    return (enemy.mp ?? 0) >= spell.mp;
  }

  castableSpells(enemy) {
    const ai = enemy.ai ?? {};
    return (ai.spells ?? []).filter((s) => this.canCast(enemy, s));
  }

  // Target selection: targeting system (threat/weakest per enemy.ai.targeting)
  // or uniform random as a fallback.
  _pickTarget(targets, enemy) {
    if (this.targeting) {
      return this.targeting.pick(targets, { mode: enemy?.ai?.targeting ?? "threat", source: enemy });
    }
    return targets[Math.floor(this.rng() * targets.length)];
  }

  // Decision tree — returns an action object.
  decide(enemy, party, allies = []) {
    const targets = this.alive(party);
    if (!targets.length) return { type: "wait", enemy };

    if (this.status) {
      const blocked = this.status.blocked(enemy);
      if (blocked) return { type: "wait", enemy, blocked, status: this.status.def(blocked)?.name ?? blocked };
    }

    const ai = enemy.ai ?? {};
    const castable = this.castableSpells(enemy);
    const spellChance = ai.spellChance ?? 0;
    // Task #116: signature abilities come first — a monster with a special
    // move uses it on its own abilityChance (default 0.2).
    const ability = this.abilities ? this.abilities.abilityOf(enemy.id) : null;
    if (ability) {
      const chance = ai.abilityChance ?? 0.2;
      if (this.rng() < chance) {
        const target = ability.target === "self" ? null : this._pickTarget(targets, enemy);
        return { type: "ability", enemy, abilityId: ability.id, ability, target };
      }
    }
    if (castable.length && this.rng() < spellChance) {
      const spellId = castable[Math.floor(this.rng() * castable.length)];
      const spell = SPELLS[spellId];
      const target =
        spell.target && spell.target.startsWith("single")
          ? this._pickTarget(targets, enemy)
          : null;
      return { type: "spell", enemy, spellId, spell, target };
    }
    return { type: "attack", enemy, target: this._pickTarget(targets, enemy) };
  }

  // Execute an action using a CombatResolver (attacks + enemy spells) or a
  // SpellCastingSystem for spell resolution.
  execute(action, ctx = {}) {
    const enemy = action.enemy;
    if (action.type === "wait") {
      return { ok: true, messages: [], blocked: action.blocked ?? null };
    }
    if (action.type === "spell" && action.spellId) {
      if (ctx.combat) {
        return ctx.combat.spell(enemy, action.spellId, action.target);
      }
      if (ctx.spellSystem) {
        return ctx.spellSystem.cast(enemy, action.spellId, ctx.party, ctx.enemies, action.target);
      }
      return { ok: false, messages: [enemy.name + " tries to cast but nothing happens."] };
    }
    // Task #116: signature abilities resolve through combat or the ability
    // system directly.
    if (action.type === "ability" && action.abilityId) {
      if (ctx.combat) {
        return ctx.combat.ability(enemy, action.abilityId, action.target);
      }
      if (this.abilities) {
        const res = this.abilities.resolveAbility(action.ability, enemy, action.target, {
          random: this.rng,
          statsOf: (c) => c,
          hurt: (c, amount) => { const before = c.hp; c.hp = Math.max(0, (c.hp ?? 0) - amount); return before - c.hp; },
          heal: (c, amount) => { c.hp = Math.min(c.maxHp ?? c.hp, (c.hp ?? 0) + amount); },
        });
        return { ok: res.ok, messages: res.messages };
      }
      return { ok: false, messages: [enemy.name + " tries " + action.ability?.name + " but nothing happens."] };
    }
    if (action.type === "attack" && ctx.combat) {
      return ctx.combat.attack(enemy, action.target);
    }
    if (ctx.combat && action.target) {
      return ctx.combat.attack(enemy, action.target);
    }
    return { ok: false, messages: [enemy.name + " hesitates."] };
  }

  // Decide + execute in one call.
  turn(enemy, party, enemies, ctx = {}) {
    const action = this.decide(enemy, party, enemies);
    const result = this.execute(action, { ...ctx, party, enemies });
    return { action, result };
  }
}
