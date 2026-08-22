// A Bard's Tale — combat foundation: monster data (from main.pjs lists),
// depth-based spawning, turn-order queue, and attack resolution.

import { rollDice, equipAttackBonus } from "./party.js";

let monsterCache = null;

export function loadMonsters() {
  if (monsterCache) return monsterCache;
  const list = (root && root.monster) ? root.monster.selectAll : [];
  monsterCache = list.map(m => ({
    id: m.id.evaluateItem,
    name: m.monsterName.evaluateItem,
    tier: Number(m.tier) || 1,
    hp: Number(m.hp) || 10,
    ac: Number(m.ac) || 10,
    attack: Number(m.attack) || 5,
    damage: String(m.damage.evaluateItem),
    xp: Number(m.xp) || 5,
    boss: !!Number(m.boss),
  }));
  return monsterCache;
}

export function rollDamage(expr) {
  const m2 = String(expr).match(/^(\d+)d(\d+)$/i);
  if (!m2) return 1;
  return rollDice(Number(m2[2]), Number(m2[1]));
}

export function partyDamage(member) {
  const buff = member.buff ? (member.buff.attackBonus || 0) : 0;
  return Math.max(1, member.mods.STR) + buff + equipAttackBonus(member) + rollDice(6, 1);
}

// Spawn a monster group appropriate for the current floor depth. Deeper
// floors draw from harder tiers, field larger groups, and bolster stats.
export function spawnMonsters(floor) {
  const all = loadMonsters();
  let pool;
  if (floor <= 1) pool = all.filter(m => m.tier === 1);
  else if (floor <= 3) pool = all.filter(m => m.tier <= 2);
  else if (floor <= 4) pool = all.filter(m => m.tier === 2);
  else if (floor <= 6) pool = all.filter(m => m.tier >= 2);
  else pool = all.filter(m => m.tier === 3);
  if (!pool.length) pool = all;

  const count = floor >= 7 ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 3);
  const hpMul = 1 + (floor - 1) * 0.07;
  const atkBonus = Math.floor((floor - 1) / 2);
  const xpBonus = (floor - 1) * 3;
  const out = [];
  for (let i = 0; i < count; i++) {
    const tpl = pool[Math.floor(Math.random() * pool.length)];
    out.push({
      uid: "m" + i,
      name: tpl.name,
      tier: tpl.tier,
      stackSize: 1 + Math.floor(Math.random() * 3),
      hp: Math.max(1, Math.round(tpl.hp * (0.8 + Math.random() * 0.5) * hpMul)),
      maxHp: tpl.hp,
      ac: tpl.ac,
      attack: tpl.attack + atkBonus,
      damage: tpl.damage,
      xp: tpl.xp + xpBonus,
    });
  }
  return out;
}

// The final boss — a single, multi-stage foe fought alone on the deepest
// floor. Its behavior is scripted in main.js (bossAct).
export function spawnBoss() {
  const tpl = loadMonsters().find(m => m.boss) || loadMonsters().find(m => m.tier === 3);
  return [{
    uid: "boss",
    name: tpl.name,
    tier: tpl.tier,
    boss: true,
    stage: 1,
    stackSize: 1,
    hp: tpl.hp,
    maxHp: tpl.hp,
    ac: tpl.ac,
    attack: tpl.attack,
    damage: tpl.damage,
    xp: tpl.xp,
  }];
}

// Interleave party members and monsters by speed (DEX/attack + jitter).
export function buildTurnQueue(party, monsters) {
  const actors = [];
  for (const m of party) {
    actors.push({ kind: "party", member: m, speed: 10 + m.mods.DEX + Math.floor(Math.random() * 7) });
  }
  for (const mo of monsters) {
    actors.push({ kind: "monster", monster: mo, speed: 7 + mo.attack + Math.floor(Math.random() * 7) });
  }
  actors.sort((a, b) => b.speed - a.speed);
  return actors;
}

export function actorAlive(actor) {
  return actor.kind === "party" ? actor.member.hp > 0 : actor.monster.hp > 0;
}

// Accuracy: attacker skill (dex mod for the party, monster attack for foes)
// vs the defender's armor class.
export function computeHit(attackerSkill, defenderAc) {
  const chance = Math.max(0.15, Math.min(0.95, 0.65 + attackerSkill * 0.04 - (defenderAc - 10) * 0.03));
  return Math.random() < chance;
}

export function monsterDamageRoll(monster) {
  return rollDamage(monster.damage) + Math.max(0, Math.floor((monster.attack - 5) / 2));
}
