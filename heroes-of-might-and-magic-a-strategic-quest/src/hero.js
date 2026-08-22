// src/hero.js — Hero entity, movement (task 3), and resource collection (task 5).
// The hero moves one tile per action; water and mountain are impassable.
// Movement points refill each turn (swamp tiles cost 2, others 1). Entering a
// resource node collects it; entering an encounter tile stops the hero there.

import { isPassable, terrainCost, pathTo, MAP_W, MAP_H } from "./map.js";

export const HERO_MAX_MOVES = 6;

const RESOURCE_GAIN = { gold: { gold: 500 }, gems: { gems: 5 } };

export function findHeroStart(map) {
  const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
  for (let r = 0; r < Math.max(MAP_W, MAP_H); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (!isPassable(map, x, y)) continue;
        const c = map.grid[y][x];
        if (c.resource || c.encounter || c.town) continue;
        return { x, y };
      }
    }
  }
  return { x: cx, y: cy };
}

export function xpForLevel(level) {
  return 100 + (level - 1) * 100;
}

export function createHero(map) {
  const start = findHeroStart(map);
  return {
    x: start.x, y: start.y,
    movesLeft: HERO_MAX_MOVES, maxMoves: HERO_MAX_MOVES, turn: 1,
    gold: 1000, gems: 2,
    level: 1, attack: 1, defense: 1, spellPower: 1, knowledge: 1,
    xp: 0, xpForNext: xpForLevel(1),
    mana: 10, maxMana: 10,
    army: [{ id: "peasant", count: 12 }, { id: "archer", count: 6 }, { id: "swordsman", count: 4 }]
  };
}

export function addXp(hero, amount) {
  hero.xp += amount;
  return pendingLevelUps(hero);
}

export function pendingLevelUps(hero) {
  let n = 0;
  while (hero.xp >= hero.xpForNext) {
    hero.xp -= hero.xpForNext;
    hero.level++;
    hero.xpForNext = xpForLevel(hero.level);
    n++;
  }
  return n;
}

export function gainAttribute(hero, attr) {
  if (!["attack", "defense", "spellPower", "knowledge"].includes(attr)) return false;
  hero[attr]++;
  if (attr === "knowledge") {
    hero.maxMana = hero.knowledge * 10;
    hero.mana = hero.maxMana;
  }
  return true;
}

export function regenMana(hero, amount) {
  hero.mana = Math.min(hero.maxMana, (hero.mana || 0) + amount);
}

export function collectAt(map, hero) {
  const cell = map.grid[hero.y][hero.x];
  if (!cell.resource) return null;
  const type = cell.resource;
  const gain = RESOURCE_GAIN[type] || {};
  for (const k of Object.keys(gain)) hero[k] = (hero[k] || 0) + gain[k];
  cell.resource = null;
  const idx = map.resources.findIndex(r => r.x === hero.x && r.y === hero.y);
  if (idx >= 0) map.resources.splice(idx, 1);
  map.stats.goldMines = map.resources.filter(r => r.type === "gold").length;
  map.stats.gemPiles = map.resources.filter(r => r.type === "gems").length;
  return { type, gain };
}

export function stepHero(map, hero, dx, dy) {
  const nx = hero.x + dx, ny = hero.y + dy;
  if (!isPassable(map, nx, ny)) return { ok: false, reason: "impassable" };
  const cost = terrainCost(map, nx, ny);
  if (hero.movesLeft < cost) return { ok: false, reason: "moves" };
  hero.x = nx; hero.y = ny;
  hero.movesLeft -= cost;
  const collected = collectAt(map, hero);
  return { ok: true, cost, terrain: map.grid[ny][nx].t, collected };
}

export function walkHero(map, hero, tx, ty) {
  if (tx === hero.x && ty === hero.y) return { ok: true, steps: 0, reached: true, collected: null };
  if (!isPassable(map, tx, ty)) return { ok: false, reason: "impassable" };
  const path = pathTo(map, hero.x, hero.y, tx, ty);
  if (!path) return { ok: false, reason: "unreachable" };
  let steps = 0;
  let collected = null;
  let stoppedAtEncounter = false;
  for (const t of path) {
    const cost = terrainCost(map, t.x, t.y);
    if (hero.movesLeft < cost) break;
    hero.x = t.x; hero.y = t.y;
    hero.movesLeft -= cost;
    steps++;
    collected = collectAt(map, hero) || collected;
    if (map.grid[t.y][t.x].encounter) { stoppedAtEncounter = true; break; }
  }
  return { ok: true, steps, reached: hero.x === tx && hero.y === ty, pathLength: path.length, collected, stoppedAtEncounter };
}

export function endTurn(hero) {
  hero.turn++;
  hero.movesLeft = hero.maxMoves;
  return hero.turn;
}
