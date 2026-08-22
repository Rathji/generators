// A Bard's Tale — the spell database (parsed from main.pjs) and effect
// resolution. Effect kinds: attack (single or all foes), heal (single or
// all allies), buff (AC/attack for a number of rounds), control (a foe
// loses its next turn, or is destroyed outright if below half HP — the
// `killHalf` banish trick). Tier 1 spells are known at level 1; tiers 2
// and 3 unlock at levels 2 and 3.

import { rollDamage } from "./combat.js";

let spellCache = null;

export function loadSpells() {
  if (spellCache) return spellCache;
  const list = (root && root.spell) ? root.spell.selectAll : [];
  spellCache = list.map(s => ({
    id: s.id.evaluateItem,
    name: s.spellName.evaluateItem,
    caster: s.caster.evaluateItem,
    tier: Number(s.tier) || 1,
    mp: Number(s.mp) || 1,
    school: s.school.evaluateItem,
    target: s.target.evaluateItem,
    damage: s.damage ? s.damage.evaluateItem : null,
    heal: s.heal ? s.heal.evaluateItem : null,
    plus: s.plus ? s.plus.evaluateItem : null,
    healPlus: s.healPlus ? Number(s.healPlus) : 0,
    rounds: s.rounds ? Number(s.rounds) : 0,
    attackBonus: s.attackBonus ? Number(s.attackBonus) : 0,
    acBonus: s.acBonus ? Number(s.acBonus) : 0,
    killHalf: !!s.killHalf,
    desc: s.desc.evaluateItem,
  }));
  return spellCache;
}

export function spellTierForLevel(level) {
  if (level >= 3) return 3;
  if (level >= 2) return 2;
  return 1;
}

export function getKnownSpells(member) {
  const tier = spellTierForLevel(member.level);
  return loadSpells().filter(s => s.caster === member.classId && s.tier <= tier);
}

function statMod(member, plus) {
  if (!plus) return 0;
  return member.mods[String(plus).toUpperCase()] || 0;
}

// Applies a spell to its target(s). Assumes mana was already deducted and
// the target passed for enemy/ally-targeted spells (null for "all" spells).
export function applySpellEffect(state, combat, caster, spell, target) {
  const log = (t) => {
    combat.log.push(t);
    if (combat.log.length > 14) combat.log.shift();
  };
  const bonus = statMod(caster, spell.plus);
  const isAll = spell.target === "all";

  if (spell.school === "attack") {
    if (isAll) {
      let total = 0;
      for (const mo of combat.monsters.filter(m => m.hp > 0)) {
        const dmg = Math.max(1, rollDamage(spell.damage) + bonus);
        mo.hp = Math.max(0, mo.hp - dmg);
        total += dmg;
        if (mo.hp === 0 && !mo.killed) { mo.killed = true; state.stats.kills++; }
      }
      log(caster.name + " casts " + spell.name + " — " + total + " damage rakes the foes.");
    } else {
      const dmg = Math.max(1, rollDamage(spell.damage) + bonus);
      target.hp = Math.max(0, target.hp - dmg);
      if (target.hp === 0 && !target.killed) { target.killed = true; state.stats.kills++; }
      log(caster.name + " casts " + spell.name + " on the " + target.name + " for " + dmg + " damage." +
        (target.hp === 0 ? " It is destroyed!" : ""));
    }
  } else if (spell.school === "heal") {
    const amount = Math.max(1, (spell.heal ? rollDamage(spell.heal) : 0) + bonus + spell.healPlus);
    const recipients = isAll ? state.party.filter(m => m.hp > 0) : [target];
    for (const m of recipients) {
      const before = m.hp;
      m.hp = Math.min(m.maxHp, m.hp + amount);
      log(caster.name + " casts " + spell.name + " — " + m.name + " recovers " + (m.hp - before) + " HP.");
    }
  } else if (spell.school === "buff") {
    const recipients = isAll ? state.party.filter(m => m.hp > 0) : [target];
    for (const m of recipients) {
      m.buff = { attackBonus: spell.attackBonus, acBonus: spell.acBonus, roundsLeft: spell.rounds };
      log(caster.name + " casts " + spell.name + " — " + m.name + " is bolstered.");
    }
  } else if (spell.school === "control") {
    if (spell.killHalf && target.hp <= Math.max(1, Math.floor(target.maxHp / 2))) {
      target.hp = 0;
      if (!target.killed) { target.killed = true; state.stats.kills++; }
      log(caster.name + " casts " + spell.name + " — the " + target.name + " is ripped from the world!");
    } else {
      target.skips = (target.skips || 0) + 1;
      log(caster.name + " casts " + spell.name + (spell.killHalf
        ? " — the " + target.name + " resists, shaking the bands free."
        : " — the " + target.name + " is bound and loses its next turn."));
    }
  }
}
