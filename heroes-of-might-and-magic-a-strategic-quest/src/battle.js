// src/battle.js — Turn-based tactical combat (Roadmap tasks 11-15).
// Grid layout by recruitment order, speed-based turn order, attack/defense
// damage formula, unit death + forward re-shift, and victory/defeat with
// rewards. Pure logic — the UI in index.html drives it.

import { UNIT_BY_ID } from "./units.js";

export const COLS = 12;
export const ROWS = 6;

const ENEMY_UNIT_ID = {
  "Goblin Raiders": "goblin",
  "Dire Wolves": "wolf",
  "Bandit Crew": "orc",
  "Orc Warband": "orc"
};

export function makeEnemyStacks(enc, playerArmy) {
  const id = ENEMY_UNIT_ID[enc.name] || "goblin";
  const u = UNIT_BY_ID[id];
  const playerPower = (playerArmy || []).reduce((s, st) => s + st.count * (UNIT_BY_ID[st.id] ? UNIT_BY_ID[st.id].atk : 1), 0);
  const scaled = Math.max(4, Math.round(playerPower / Math.max(1, u.atk) / 1.2));
  const count = Math.min(scaled, enc.count || 40);
  const split = Math.max(1, Math.floor(count * 0.6));
  const stacks = [{ id, count: split }];
  if (count - split > 0) stacks.push({ id, count: count - split });
  return stacks;
}

export function createUnit(side, id, count, x, y, bonusAtk, bonusDef) {
  const u = UNIT_BY_ID[id];
  return {
    id, side, name: u.name, count,
    atk: u.atk + (bonusAtk || 0), def: u.def + (bonusDef || 0), hp: u.hp, speed: u.speed,
    hpPool: u.hp,
    x, y
  };
}

export const FIREBALL_COST = 10;
export const FIREBALL_COOLDOWN = 2;

export function startBattle(heroArmy, enemyStacks, heroStats) {
  const hs = heroStats || {};
  const units = [];
  (heroArmy || []).forEach((s, i) => units.push(createUnit("player", s.id, s.count, 0, i % ROWS, hs.attack, hs.defense)));
  enemyStacks.forEach((s, i) => units.push(createUnit("enemy", s.id, s.count, COLS - 1, i % ROWS)));
  return {
    units,
    playerInitial: (heroArmy || []).map(s => ({ id: s.id, count: s.count })),
    enemyStacks,
    round: 0,
    order: [],
    acting: null,
    over: null,
    log: [],
    mana: hs.mana || 0,
    maxMana: hs.maxMana || 10,
    spellPower: hs.spellPower || 1,
    fireballCooldown: 0
  };
}

export function buildOrder(units, playerFirst) {
  return units.slice().sort((a, b) => {
    if (playerFirst && a.side !== b.side) return a.side === "player" ? -1 : 1;
    return (b.speed - a.speed) || (a.side === b.side ? 0 : a.side === "player" ? -1 : 1);
  });
}

export function checkEnd(battle) {
  const player = battle.units.filter(u => u.side === "player" && u.count > 0);
  const enemy = battle.units.filter(u => u.side === "enemy" && u.count > 0);
  if (enemy.length === 0 && player.length === 0) battle.over = { winner: "none" };
  else if (enemy.length === 0) battle.over = { winner: "player" };
  else if (player.length === 0) battle.over = { winner: "enemy" };
  return battle.over;
}

export function nextActor(battle) {
  let guard = 0;
  while (guard++ < 200) {
    if (!battle.order.length) {
      battle.round++;
      // Attacker advantage (like HoMM): the player's units act first every round;
      // Speed then orders the units within each side.
      battle.fireballCooldown = Math.max(0, (battle.fireballCooldown || 0) - 1);
      battle.mana = Math.min(battle.maxMana, (battle.mana || 0) + 2);
      battle.order = buildOrder(battle.units.filter(u => u.count > 0), true);
    }
    const u = battle.order.shift();
    if (!u || u.count <= 0) continue;
    battle.acting = u;
    return u;
  }
  return null;
}

export function canUseFireball(battle) {
  if (!battle || battle.over) return false;
  return battle.mana >= FIREBALL_COST && battle.fireballCooldown <= 0;
}

export function fireball(battle) {
  if (!canUseFireball(battle)) return null;
  const dmg = 6 + (battle.spellPower || 1) * 4;
  const hits = [];
  const enemies = battle.units.filter(u => u.side === "enemy" && u.count > 0);
  for (const e of enemies.slice()) {
    const res = attack(battle, { name: "Fireball", count: 1, atk: dmg, def: 0 }, e);
    hits.push({ unit: e, dmg, casualties: res.casualties, dead: res.defenderDead });
  }
  battle.mana -= FIREBALL_COST;
  battle.fireballCooldown = FIREBALL_COOLDOWN;
  return { hits, totalDamage: hits.reduce((s, h) => s + h.dmg, 0) };
}

export function attack(battle, attacker, defender) {
  const perUnit = Math.max(1, attacker.atk - Math.floor(defender.def / 2) + (Math.random() < 0.5 ? 1 : 0));
  const dmg = attacker.count * perUnit;
  const totalHp = defender.hp * defender.count;
  const newHp = Math.max(0, totalHp - dmg);
  const newCount = newHp > 0 ? Math.ceil(newHp / defender.hp) : 0;
  const casualties = defender.count - newCount;
  defender.count = newCount;
  let defenderDead = false;
  if (newCount > 0) {
    defender.hpPool = Math.max(1, newHp - (newCount - 1) * defender.hp);
  } else {
    defenderDead = true;
    battle.units = battle.units.filter(u => u !== defender);
    shiftUnits(battle, defender.side);
  }
  return { attacker, defender, dmg, perUnit, casualties, defenderDead };
}

export function shiftUnits(battle, side) {
  // Re-stack the surviving units of one side toward the front (task 14).
  const survivors = battle.units.filter(u => u.side === side).sort((a, b) => a.y - b.y);
  survivors.forEach((u, i) => { u.y = i; });
}

export function enemyReward(enemyStacks) {
  const count = enemyStacks.reduce((s, st) => s + st.count, 0);
  const gold = 80 + count * 8;
  const xp = count;
  return { gold, xp };
}
