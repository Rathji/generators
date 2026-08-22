// Task #4: Turn-Based Combat Resolver — agility-based turn order, and
// attack / spell / item / run actions with damage & healing resolution.
// Extended: critical hits (#62), status blocking/wake (#61), weapon scaling
// (#69) and armor mitigation (#70) via optional systems.

import { SPELLS } from "../data/spells.js";
import { CriticalHitSystem } from "./criticals.js";
import { elementalMultiplier } from "./affinity.js";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export class CombatResolver {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.inventory = opts.inventory ?? null;
    this.crits = opts.crits === false ? null : (opts.critSystem ?? opts.crits ?? new CriticalHitSystem({ random: this.rng }));
    this.status = opts.statusSystem ?? null;
    this.weaponScaling = opts.weaponScaling ?? null;
    this.armor = opts.armor ?? null;
    // Task #122: optional global math modifiers (damage scaling).
    this.balance = opts.balance ?? null;
    // Task #116: optional monster ability system for signature moves.
    this.abilities = opts.abilitySystem ?? opts.abilities ?? null;
    // Task #126/#128/#129: optional turn-order queue, buff/debuff system,
    // and multi-target attack resolver.
    this.turnQueue = opts.turnQueue ?? null;
    this.buffs = opts.buffs ?? null;
    this.multiTarget = opts.multiTarget ?? null;
    this.party = [];
    this.enemies = [];
    this.log = [];
    this.over = false;
    this.outcome = null;
    this._dead = new Set();
  }

  begin(party, enemies) {
    this.party = [...party];
    this.enemies = [...enemies];
    this.log = [];
    this.over = false;
    this.outcome = null;
    this._dead.clear();
  }

  statsOf(c) {
    return c.getStats ? c.getStats() : c;
  }

  maxHpOf(c) {
    return c.getStats ? c.getStats().maxHp : c.maxHp;
  }

  combatants() {
    return [...this.party, ...this.enemies].filter((c) => !this._dead.has(c));
  }

  speedOf(c) {
    const agi = this.statsOf(c).agi;
    let spd = agi + Math.floor(this.rng() * (agi / 2 + 1));
    // Task #128: Haste/Slow feed speed modifiers into the initiative roll.
    if (this.buffs) spd += this.buffs.speedMod(c);
    return spd;
  }

  turnOrder() {
    // Task #126: when a turn-order queue is wired in, it owns the ordering.
    if (this.turnQueue) return this.turnQueue.build(this.combatants());
    return this.combatants()
      .map((c) => ({ c, spd: this.speedOf(c) }))
      .sort((a, b) => b.spd - a.spd)
      .map((o) => o.c);
  }

  hitChance(atkStats, defStats, attacker = null) {
    let hit = Math.max(0.5, Math.min(0.95, 0.95 - (defStats.agi - atkStats.agi) * 0.005));
    // Task #128: Blind (and similar) reduce the attacker's hit chance.
    if (attacker && this.buffs) hit = Math.max(0.05, Math.min(0.95, hit + this.buffs.hitChanceMod(attacker)));
    return hit;
  }

  _hurt(c, amount) {
    const n = Math.max(0, Math.floor(amount));
    if (c.hp === undefined) return 0;
    const before = c.hp;
    if (typeof c.damage === "function") c.damage(n);
    else c.hp = Math.max(0, c.hp - n);
    const dealt = before - c.hp;
    if (c.hp <= 0) this._dead.add(c);
    return dealt;
  }

  _heal(c, amount) {
    if (typeof c.heal === "function") c.heal(amount);
    else if (c.hp !== undefined) c.hp = Math.min(this.maxHpOf(c), c.hp + Math.max(0, amount));
  }

  _checkOutcome() {
    if (this.over) return;
    if (this.enemies.length && this.enemies.every((c) => this._dead.has(c))) {
      this.over = true;
      this.outcome = "victory";
    } else if (this.party.length && this.party.every((c) => this._dead.has(c))) {
      this.over = true;
      this.outcome = "defeat";
    }
  }

  attack(attacker, target) {
    const msgs = [];
    if (this._dead.has(attacker)) return { messages: msgs, damage: 0 };
    if (this._dead.has(target)) return { messages: [attacker.name + "'s attack finds no target."], damage: 0 };
    if (this.status) {
      const blocked = this.status.blocked(attacker);
      if (blocked) {
        const sName = this.status.def(blocked)?.name ?? blocked;
        msgs.push(attacker.name + " is " + sName + " and cannot act.");
        return { messages: msgs, damage: 0, blocked };
      }
    }
    const a = this.statsOf(attacker);
    const t = this.statsOf(target);
    const hit = this.hitChance(a, t, attacker);
    if (this.rng() >= hit) {
      msgs.push(attacker.name + " attacks " + target.name + "... but misses!");
      return { messages: msgs, damage: 0, missed: true };
    }
    const atk = this.weaponScaling ? this.weaponScaling.effectiveAttack(attacker) : a.str + a.atk;
    const def = this.armor ? this.armor.flatReduction(target) : t.def;
    const base = Math.max(1, atk - def);
    let damage = Math.max(1, Math.round(base * (0.8 + this.rng() * 0.4)));
    if (this.balance) damage = this.balance.scaleDamage(damage);
    let armorBlocked = false;
    if (this.armor) {
      const m = this.armor.applyBlock(damage, target, this.rng);
      damage = m.damage;
      armorBlocked = m.blocked;
    }
    const crit = this.crits ? this.crits.roll(attacker, target) : { critical: false, multiplier: 1 };
    if (crit.critical) damage = Math.max(1, Math.round(damage * crit.multiplier));
    const dealt = this._hurt(target, damage);
    const woke = this.status ? this.status.onHit(target) : [];
    msgs.push(
      crit.critical
        ? attacker.name + " lands a CRITICAL HIT on " + target.name + " for " + dealt + " damage!"
        : attacker.name + " attacks " + target.name + " for " + dealt + " damage."
    );
    if (armorBlocked) msgs.push(target.name + "'s armor absorbs part of the blow.");
    if (woke.length) msgs.push(target.name + " is jolted awake!");
    this._checkOutcome();
    return { messages: msgs, damage: dealt, critical: crit.critical, critMult: crit.multiplier, armorBlocked };
  }

  // Task #129: attack every target the MultiTargetResolver selects (1-4),
  // resolving each hit through the normal attack pipeline.
  multiAttack(attacker, enemies) {
    const targets = this.multiTarget
      ? this.multiTarget.targets(attacker, enemies)
      : (enemies ?? []).filter((e) => !this._dead.has(e)).slice(0, 1);
    if (!targets.length) return { messages: [attacker.name + "'s attack finds no target."], damage: 0, targets: [], hits: [] };
    const hits = [];
    let total = 0;
    for (const t of targets) {
      const res = this.attack(attacker, t);
      hits.push({ target: t, ...res });
      total += res.damage ?? 0;
    }
    const messages = hits.flatMap((h) => h.messages);
    this._checkOutcome();
    return {
      messages,
      damage: total,
      targets: targets.map((t) => t.name),
      hits,
      allMissed: hits.every((h) => h.missed),
    };
  }

  spell(caster, spellId, target) {
    const spell = SPELLS[spellId];
    if (!spell) return { messages: [], ok: false, error: "unknown spell" };
    const msgs = [];
    if (caster.mp < spell.mp) {
      msgs.push(caster.name + " has insufficient MP!");
      return { messages: msgs, ok: false };
    }
    caster.mp -= spell.mp;
    const a = this.statsOf(caster);
    if (spell.kind === "heal") {
      const amount = Math.max(1, spell.power + Math.floor(a.int / 2));
      const before = target.hp;
      this._heal(target, amount);
      const healed = target.hp - before;
      msgs.push(caster.name + " casts " + spell.name + "! " + target.name + " recovers " + healed + " HP.");
      this._checkOutcome();
      return { messages: msgs, ok: true, healed };
    }
    const t = this.statsOf(target);
    const base = Math.max(1, spell.power + a.int - t.mdef);
    let damage = Math.max(1, Math.round(base * (0.8 + this.rng() * 0.4)));
    if (this.balance) damage = this.balance.scaleDamage(damage);
    const dealt = this._hurt(target, damage);
    msgs.push(caster.name + " casts " + spell.name + "! " + target.name + " takes " + dealt + " damage.");
    this._checkOutcome();
    return { messages: msgs, ok: true, damage: dealt, element: spell.element ?? null };
  }

  item(character, itemId, target) {    const item = this.inventory ? this.inventory.item(itemId) : null;
    if (!item) return { messages: [], ok: false, error: "item unavailable" };
    if (item.type !== "consumable") return { messages: [], ok: false, error: "not usable" };
    if (!this.inventory.has(itemId)) return { messages: [], ok: false, error: "not owned" };
    const res = this.inventory.use(itemId, target);
    if (!res.ok) {
      return { messages: [character.name + " uses " + item.name + "... nothing happens."], ok: false, error: res.error };
    }
    const msgs = [character.name + " uses " + item.name + "!"];
    this._checkOutcome();
    return { messages: msgs, ok: true };
  }

  // Task #116: resolve a monster's signature ability via MonsterAbilitySystem.
  ability(attacker, abilityId, target) {
    const msgs = [];
    if (!this.abilities) return { messages: msgs, ok: false, error: "no ability system" };
    const ability = this.abilities.ability(abilityId);
    if (!ability) return { messages: msgs, ok: false, error: "unknown ability" };
    if (this._dead.has(attacker)) return { messages: msgs, damage: 0 };
    if (this.status) {
      const blocked = this.status.blocked(attacker);
      if (blocked) {
        const sName = this.status.def(blocked)?.name ?? blocked;
        msgs.push(attacker.name + " is " + sName + " and cannot act.");
        return { messages: msgs, damage: 0, blocked };
      }
    }
    if (ability.target !== "self") {
      if (!target || this._dead.has(target)) return { messages: msgs, damage: 0 };
    } else {
      target = attacker;
    }
    const res = this.abilities.resolveAbility(ability, attacker, target, {
      random: this.rng,
      statsOf: (c) => this.statsOf(c),
      hurt: (c, amount) => this._hurt(c, amount),
      heal: (c, amount) => this._heal(c, amount),
      status: this.status ?? null,
      affinity: (el, t) => elementalMultiplier(el, t),
    });
    msgs.push(...res.messages);
    if (res.damage > 0 && this.status) {
      const woke = this.status.onHit(target);
      if (woke.length) msgs.push(target.name + " is jolted awake!");
    }
    this._checkOutcome();
    return { ...res, messages: msgs };
  }

  tryRun(partyTargets = this.party) {
    const pAgi =
      partyTargets.reduce((sum, c) => sum + this.statsOf(c).agi, 0) / Math.max(1, partyTargets.length);
    const eAgi = this.enemies.length
      ? this.enemies.reduce((sum, c) => sum + this.statsOf(c).agi, 0) / this.enemies.length
      : 0;
    const chance = Math.max(0.25, Math.min(0.9, 0.5 + (pAgi - eAgi) / 100));
    const success = this.rng() < chance;
    if (success) {
      this.over = true;
      this.outcome = "fled";
    }
    return { ok: success, chance };
  }

  get isVictory() {
    return this.outcome === "victory";
  }

  get isDefeat() {
    return this.outcome === "defeat";
  }

  get isOver() {
    return this.over;
  }
}
