import { FACTIONS, CREATURES, factionCreatures, buildingsFor, SPELLS, GUILD_SPELLS, SKILLS,
  TERRAIN, RESOURCES, RES_BY_ID, HERO_NAMES, MOVEMENT_BASE, XP_PER_LEVEL, HERO_STATS_BASE, HERO_BUY_COST } from './data.js';
import { DIRS, hexDist, inBounds, key } from './hex.js';

// ---------- RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let uid = 1;
export function nextId(prefix) { return prefix + (uid++); }

// ---------- helpers ----------
export function armyValue(stacks) {
  return (stacks || []).reduce((s, st) => s + (st && CREATURES[st.id] ? CREATURES[st.id].cost.gold * st.count : 0), 0);
}
export function playerHas(game, pid, res) { return game.players[pid].resources[res] >= 0; }
export function spendRes(game, pid, cost) {
  const p = game.players[pid];
  for (const k in cost) { p.resources[k] -= cost[k]; if (p.resources[k] < 0) p.resources[k] = 0; }
}
export function canAfford(game, pid, cost) {
  const p = game.players[pid];
  return Object.entries(cost || {}).every(([k, v]) => p.resources[k] >= v);
}

export function findHero(game, id) { return game.heroes.find(h => h.id === id); }
export function findTown(game, id) { return game.towns.find(t => t.id === id); }
export function objAt(game, q, r) { return game.objects.find(o => o.q === q && o.r === r) || null; }
export function heroAt(game, q, r) { return game.heroes.find(h => h.q === q && h.r === r) || null; }
export function townAt(game, q, r) { return game.towns.find(t => t.q === q && t.r === r) || null; }

// ---------- terrain / movement ----------
export function terrainOf(game, q, r) { return game.map.terrain[r][q]; }
export function isPassable(game, q, r) {
  if (!inBounds(q, r, game.w, game.h)) return false;
  return TERRAIN[terrainOf(game, q, r)].cost >= 0;
}
export function moveCost(game, q, r, hero) {
  const t = TERRAIN[terrainOf(game, q, r)];
  let c = t.cost;
  const pf = hero?.skills?.pathfinding;
  if (pf) c *= (1 - pf * 0.15);
  return Math.max(50, Math.round(c));
}

export function occupiedBy(game, q, r, selfHero = null) {
  const h = heroAt(game, q, r);
  if (h && h !== selfHero) return h;
  return null;
}

function isBlockingObj(game, o) {
  if (!o) return false;
  if (o.type === 'stack') return true;
  if (o.type === 'dwelling' && o.guard) return true;
  if (o.type === 'mine' && o.owner !== null && o.owner !== undefined && game.players[o.owner].isAI !== undefined) {
    // enemy-owned mines are capturable by walking on — not blocking
    return false;
  }
  return false;
}

export function isBlocked(game, q, r, selfHero = null) {
  if (!isPassable(game, q, r)) return true;
  if (occupiedBy(game, q, r, selfHero)) return true;
  const town = townAt(game, q, r);
  if (town && town.owner !== null && town.owner !== undefined) {
    const townOwner = town.owner;
    const me = selfHero ? selfHero.pid : -1;
    if (townOwner !== me) return true; // enemy town blocks
  }
  const o = objAt(game, q, r);
  if (o && o.type === 'stack') return true;
  if (o && o.type === 'dwelling' && o.guard) return true;
  return false;
}

export function heroMaxMove(hero) {
  let m = MOVEMENT_BASE;
  const lvl = hero.skills?.logistics || 0;
  m *= (1 + lvl * 0.15);
  return Math.round(m);
}

// Dijkstra reachable set + parents. Returns {costs: Map(key->{q,r,cost}), parent: Map(key->key)}
export function reachable(game, hero, maxCost) {
  const costs = new Map();
  const parent = new Map();
  const startKey = key(hero.q, hero.r);
  costs.set(startKey, { q: hero.q, r: hero.r, cost: 0 });
  const open = [{ q: hero.q, r: hero.r, cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const cur = open.shift();
    for (const [dq, dr] of DIRS) {
      const nq = cur.q + dq, nr = cur.r + dr;
      if (!inBounds(nq, nr, game.w, game.h)) continue;
      if (isBlocked(game, nq, nr, hero)) continue;
      const nk = key(nq, nr);
      if (costs.has(nk)) continue;
      const nc = cur.cost + moveCost(game, nq, nr, hero);
      if (nc > maxCost) continue;
      costs.set(nk, { q: nq, r: nr, cost: nc });
      parent.set(nk, key(cur.q, cur.r));
      open.push({ q: nq, r: nr, cost: nc });
    }
  }
  return { costs, parent };
}

export function pathTo(game, hero, targetQ, targetR, maxCost) {
  const { costs, parent } = reachable(game, hero, maxCost);
  const tk = key(targetQ, targetR);
  if (!costs.has(tk)) return null;
  const path = [];
  let k = tk;
  while (k !== key(hero.q, hero.r)) {
    const [q, r] = k.split(',').map(Number);
    path.push({ q, r });
    k = parent.get(k);
    if (k === undefined) break;
  }
  return path.reverse();
}

export function canAttack(game, hero, tq, tr) {
  const { costs } = reachable(game, hero, hero.move);
  for (const [dq, dr] of DIRS) {
    const nq = tq + dq, nr = tr + dr;
    if (key(nq, nr) === key(hero.q, hero.r)) return true;
    if (costs.has(key(nq, nr))) return true;
  }
  return false;
}

// Moves hero along a precomputed path, applying interactions en route.
export function moveHeroPath(game, hero, path, onEvent = null) {
  for (const step of path) {
    const cost = moveCost(game, step.q, step.r, hero);
    if (hero.move < cost) break;
    hero.move -= cost;
    hero.q = step.q; hero.r = step.r;
    const ev = interactAt(game, hero, step.q, step.r);
    if (ev && onEvent) onEvent(ev);
    if (ev && ev.type === 'town') { hero.move = 0; break; }
    if (game.gameOver) break;
  }
}

// ---------- heroes ----------
export function makeHero(game, pid, faction, name, q, r, startArmy = null) {
  const hero = {
    id: nextId('h'), pid, name: name || 'Hero', q, r,
    atk: HERO_STATS_BASE.atk, def: HERO_STATS_BASE.def, pow: HERO_STATS_BASE.pow, know: HERO_STATS_BASE.know,
    xp: 0, level: 1, pendingLevels: 0, skills: {},
    army: new Array(7).fill(null), move: 0, mana: 0, spells: [],
  };
  if (startArmy) placeArmy(hero, startArmy);
  hero.move = heroMaxMove(hero);
  hero.mana = maxMana(hero);
  game.heroes.push(hero);
  return hero;
}

export function startArmyFor(faction) {
  const cs = factionCreatures(faction);
  return [{ id: cs[0].id, count: 14 }, { id: cs[1].id, count: 9 }, { id: cs[2].id, count: 5 }];
}

export function placeArmy(hero, stacks) {
  for (const st of stacks) addToArmy(hero, st.id, st.count);
}

export function addToArmy(hero, id, count) {
  for (const slot of hero.army) {
    if (slot && slot.id === id) { slot.count += count; return; }
  }
  const empty = hero.army.findIndex(s => !s);
  if (empty >= 0) hero.army[empty] = { id, count };
  else return null; // no room
}

export function maxMana(hero) {
  const int = hero.skills?.intelligence || 0;
  return Math.round(hero.know * 10 * (1 + int * 0.25));
}

export function xpToNext(level) { return level * XP_PER_LEVEL; }
export function giveXp(game, hero, amt) {
  hero.xp += amt;
  while (hero.xp >= xpToNext(hero.level)) {
    hero.xp -= xpToNext(hero.level);
    hero.level++;
    hero.pendingLevels++;
    const roll = Math.random();
    if (roll < 0.35) hero.atk++;
    else if (roll < 0.7) hero.def++;
    else if (roll < 0.85) hero.pow++;
    else hero.know++;
  }
}

export function availableSkills(hero, n) {
  const pool = Object.keys(SKILLS).filter(k => (hero.skills[k] || 0) < SKILLS[k].max);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}
export function applySkill(hero, skillId) {
  hero.skills[skillId] = (hero.skills[skillId] || 0) + 1;
}

// ---------- towns ----------
export function townIncome(town) {
  let inc = 0;
  for (const b of ['townhall', 'cityhall', 'capitol']) if (town.buildings.includes(b)) inc += { townhall: 500, cityhall: 1000, capitol: 2000 }[b];
  return inc;
}
export function townGrowthMult(town) {
  let m = 0;
  for (const b of ['fort', 'citadel', 'castle']) if (town.buildings.includes(b)) m += { fort: 0.25, citadel: 0.5, castle: 1.0 }[b];
  return m;
}
export function townCanBuild(town, building, game) {
  const def = buildingsFor(town.faction).find(b => b.id === building.id);
  if (town.buildings.includes(building.id)) return { ok: false, reason: 'Built' };
  if (!def) return { ok: false, reason: 'Unknown' };
  for (const req of def.requires || []) if (!town.buildings.includes(req)) return { ok: false, reason: 'Requires ' + req };
  return { ok: true };
}
export function buildInTown(game, town, bId) {
  const def = buildingsFor(town.faction).find(b => b.id === bId);
  if (!def || town.buildings.includes(bId)) return false;
  if (!canAfford(game, town.owner, def.cost)) return false;
  const chk = townCanBuild(town, def, game);
  if (!chk.ok) return false;
  spendRes(game, town.owner, def.cost);
  town.buildings.push(bId);
  if (def.provides) {
    if (!town.stock) town.stock = {};
    town.stock[def.tier] = town.stock[def.tier] || { base: 0, up: 0 };
  }
  return true;
}

export function townSpells(town) {
  const guildLevel = Math.max(0, town.buildings.filter(b => b.startsWith('mages')).length);
  const list = [];
  for (let i = 0; i < guildLevel; i++) for (const s of GUILD_SPELLS[i]) if (!list.includes(s)) list.push(s);
  return list.map(id => SPELLS[id]);
}

export function learnTownSpells(hero, town) {
  for (const s of townSpells(town)) if (!hero.spells.includes(s.id)) hero.spells.push(s.id);
}

export function townRecruitCosts(town) {
  const defs = buildingsFor(town.faction);
  const out = [];
  for (let tier = 1; tier <= 7; tier++) {
    const base = defs.find(d => d.id === `dwelling${tier}`);
    const up = defs.find(d => d.id === `dwelling${tier}u`);
    if (!base || !town.buildings.includes(base.id)) continue;
    const upgraded = up && town.buildings.includes(up.id);
    const id = upgraded ? CREATURES[base.provides].upgrade : base.provides;
    out.push({ tier, id, upgraded, growth: CREATURES[id].growth });
  }
  return out;
}

// ---------- calendar & turn ----------
export function newDay(game) {
  game.day++;
  if (game.day > 7) {
    game.day = 1;
    game.week++;
    if (game.week > 4) { game.week = 1; game.month++; }
    weeklyGrowth(game);
  }
}
export function weeklyGrowth(game) {
  for (const town of game.towns) {
    if (town.owner === null || town.owner === undefined) continue;
    const mult = 1 + townGrowthMult(town);
    for (const r of townRecruitCosts(town)) {
      if (!town.stock) town.stock = {};
      town.stock[r.tier] = town.stock[r.tier] || { base: 0, up: 0 };
      const key = r.upgraded ? 'up' : 'base';
      town.stock[r.tier][key] += Math.round(CREATURES[r.id].growth * mult);
    }
  }
  for (const o of game.objects) {
    if (o.type === 'dwelling' && o.owner !== null && o.owner !== undefined && !o.guard) {
      o.stock += CREATURES[o.creatureId].growth * 2;
    }
  }
}

export function startPlayerTurn(game, player) {
  const pid = player.id;
  // income
  let gold = 0, res = {};
  for (const o of game.objects) if (o.type === 'mine' && o.owner === pid) {
    const inc = MINE_INCOME[o.sub];
    if (inc.gold) gold += inc.gold; else for (const k in inc) res[k] = (res[k] || 0) + inc[k];
  }
  for (const t of game.towns) if (t.owner === pid) gold += townIncome(t);
  const estates = game.heroes.filter(h => h.pid === pid).reduce((s, h) => s + (h.skills?.estates || 0) * 200, 0);
  gold += estates;
  player.resources.gold += gold;
  for (const k in res) player.resources[k] += res[k];
  if (gold) log(`${player.name} collects ${gold} gold/day income`);
  for (const h of game.heroes) if (h.pid === pid) {
    h.move = heroMaxMove(h);
    h.mana = maxMana(h);
  }
  autoLevelAI(game);
}
export const MINE_INCOME = {
  gold: { gold: 500 }, wood: { wood: 2 }, ore: { ore: 2 },
  gems: { gems: 1 }, crystal: { crystal: 1 }, sulfur: { sulfur: 1 }, mercury: { mercury: 1 },
};

// ---------- interactions ----------
// Returns an event object for the UI to react to, or null.
export function interactAt(game, hero, q, r) {
  const o = objAt(game, q, r);
  const town = townAt(game, q, r);
  if (town) {
    if (town.owner === hero.pid) return { type: 'town', town };
    return null; // enemy town — handled by attack path
  }
  if (!o) return null;
  if (o.type === 'gold' || o.type === 'wood' || o.type === 'ore' || o.type === 'gems' ||
      o.type === 'crystal' || o.type === 'sulfur' || o.type === 'mercury') {
    game.players[hero.pid].resources[o.type] += o.amt;
    removeObj(game, o);
    return { type: 'collect', res: o.type, amt: o.amt };
  }
  if (o.type === 'chest') {
    removeObj(game, o);
    if (o.gold) { game.players[hero.pid].resources.gold += o.gold; return { type: 'chest', gold: o.gold }; }
    giveXp(game, hero, o.xp);
    return { type: 'chest', xp: o.xp };
  }
  if (o.type === 'mine') {
    const prev = o.owner;
    o.owner = hero.pid;
    return { type: 'mine', sub: o.sub, captured: prev !== hero.pid };
  }
  if (o.type === 'dwelling') {
    if (o.guard) return null; // must fight
    return { type: 'dwelling', obj: o };
  }
  return null;
}

export function removeObj(game, o) {
  const i = game.objects.indexOf(o);
  if (i >= 0) game.objects.splice(i, 1);
}

// ---------- battle application ----------
// battle: from combat.js; meta: {kind, objId, attackerHeroId, defenderHeroId}
export function resolveBattle(game, battle, meta) {
  const att = battle.attacker, def = battle.defender;
  const attHero = meta.attackerHeroId ? findHero(game, meta.attackerHeroId) : null;
  const defHero = meta.defenderHeroId ? findHero(game, meta.defenderHeroId) : null;
  const attWon = battle.winner === 'att';

  if (attHero) {
    attHero.army = new Array(7).fill(null);
    placeArmy(attHero, battle.results.attStacks);
    if (!battle.results.attStacks.length) killHero(game, attHero);
    else {
      const gained = Math.floor(armyValue(def.stacksInput) / 20) + 200;
      giveXp(game, attHero, gained);
    }
  }
  if (defHero) {
    defHero.army = new Array(7).fill(null);
    placeArmy(defHero, battle.results.defStacks);
    if (!battle.results.defStacks.length) killHero(game, defHero);
    else {
      const gained = Math.floor(armyValue(att.stacksInput) / 20) + 200;
      giveXp(game, defHero, gained);
    }
  }

  if (meta.kind === 'stack') {
    const o = game.objects.find(x => x.id === meta.objId);
    if (o) {
      if (attWon) {
        removeObj(game, o);
        if (o.gold) { game.players[att.pid].resources.gold += o.gold; }
        if (o.xp && attHero) giveXp(game, attHero, o.xp);
      }
    }
  } else if (meta.kind === 'dwelling') {
    const o = game.objects.find(x => x.id === meta.objId);
    if (o && attWon) { o.guard = null; o.owner = att.pid; o.stock = CREATURES[o.creatureId].growth * 2; }
  } else if (meta.kind === 'town') {
    const town = findTown(game, meta.objId);
    if (town && attWon) {
      town.owner = att.pid;
      town.guard = null;
    }
  } else if (meta.kind === 'hero') {
    // loser already killed above via killHero
  }

  autoLevelAI(game);
  checkGameOver(game);
}

export function killHero(game, hero) {
  const i = game.heroes.indexOf(hero);
  if (i >= 0) game.heroes.splice(i, 1);
}

export function autoLevelAI(game) {
  for (const h of game.heroes) {
    if (h.pid === 0 || h.pendingLevels <= 0) continue;
    while (h.pendingLevels > 0) {
      const opts = availableSkills(h, 1);
      if (!opts.length) { h.pendingLevels = 0; break; }
      applySkill(h, opts[0]);
      h.pendingLevels--;
    }
  }
}

export function checkGameOver(game) {
  if (game.gameOver) return game.gameOver;
  const alive = p => game.heroes.some(h => h.pid === p.id) || game.towns.some(t => t.owner === p.id);
  const human = game.players.find(p => !p.isAI);
  const enemies = game.players.filter(p => p.isAI);
  if (!alive(human)) { game.gameOver = 'lose'; return 'lose'; }
  if (enemies.length && enemies.every(p => !alive(p))) { game.gameOver = 'win'; return 'win'; }
  return null;
}

// ---------- map generation ----------
export function newGame(w, h, seed) {
  const rng = mulberry32(seed || (Math.random() * 1e9) | 0);
  const game = {
    version: 1, seed, w, h,
    map: { terrain: genTerrain(w, h, rng) },
    players: [
      { id: 0, name: 'Blue', isAI: false, resources: { gold: 6000, wood: 10, ore: 10, gems: 3, crystal: 3, sulfur: 3, mercury: 3 } },
      { id: 1, name: 'Red', isAI: true, resources: { gold: 6000, wood: 10, ore: 10, gems: 3, crystal: 3, sulfur: 3, mercury: 3 } },
    ],
    towns: [], heroes: [], objects: [],
    day: 1, week: 1, month: 1, turn: 0, gameOver: null,
  };
  genObjects(game, rng);
  game.players[0].name = 'You';
  return game;
}

function genTerrain(w, h, rng) {
  const g = Array.from({ length: h }, () => new Array(w).fill('grass'));
  const set = (q, r, t) => { if (q >= 0 && q < w && r >= 0 && r < h) g[r][q] = t; };
  const blobs = [
    { t: 'water', n: 5, len: 12 },
    { t: 'rock', n: 8, len: 9 },
    { t: 'trees', n: 8, len: 22 },
    { t: 'dirt', n: 4, len: 20 },
    { t: 'sand', n: 3, len: 18 },
    { t: 'snow', n: 2, len: 8 },
  ];
  for (const b of blobs) {
    for (let i = 0; i < b.n; i++) {
      let q = Math.floor(rng() * w), r = Math.floor(rng() * h);
      for (let s = 0; s < b.len; s++) {
        set(q, r, b.t);
        const [dq, dr] = DIRS[Math.floor(rng() * 6)];
        q += dq; r += dr;
        if (q < 0) q = 0; if (q >= w) q = w - 1;
        if (r < 0) r = 0; if (r >= h) r = h - 1;
      }
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const ng = g.map(row => [...row]);
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
      if (g[r][q] !== 'grass') continue;
      const counts = {};
      for (const [dq, dr] of DIRS) {
        const nq = q + dq, nr = r + dr;
        if (nq < 0 || nq >= w || nr < 0 || nr >= h) continue;
        const t = g[nr][nq];
        if (t !== 'grass') counts[t] = (counts[t] || 0) + 1;
      }
      for (const t in counts) if (counts[t] >= 4) ng[r][q] = t;
    }
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) g[r][q] = ng[r][q];
  }
  // ensure spawn points clear
  for (const [q, r] of [[2, 3], [w - 3, h - 4], [2, h - 4], [w - 3, 3]]) {
    for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
      set(q + dq, r + dr, 'grass');
    }
  }
  return g;
}

function genObjects(game, rng) {
  const { w, h } = game;
  const spots = [];
  const addObj = (o) => { o.q = Math.floor(o.q); o.r = Math.floor(o.r); game.objects.push(o); return o; };
  const findSpot = (minDist, avoid, tries = 1000) => {
    for (let i = 0; i < tries; i++) {
      const q = Math.floor(rng() * w), r = Math.floor(rng() * h);
      if (!isPassable(game, q, r)) continue;
      if (townAt(game, q, r) || heroAt(game, q, r) || objAt(game, q, r)) continue;
      if (avoid && spots.some(s => hexDist(s, { q, r }) < minDist)) continue;
      return { q, r };
    }
    return null;
  };

  const factions = Object.keys(FACTIONS);
  // player towns
  const p1Pos = { q: 3, r: 3 }, p2Pos = { q: w - 4, r: h - 4 };
  spots.push(p1Pos, p2Pos);
  game.towns.push(makeTown('castle', p1Pos.q, p1Pos.r, 0, 'Bluehold'));
  game.towns.push(makeTown('stronghold', p2Pos.q, p2Pos.r, 1, 'Redrock'));
  const heroes = game.heroes;
  makeHero(game, 0, 'castle', pickName(rng, 'castle'), p1Pos.q + 1, p1Pos.r, startArmyFor('castle'));
  makeHero(game, 1, 'stronghold', pickName(rng, 'stronghold'), p2Pos.q - 1, p2Pos.r, startArmyFor('stronghold'));

  // neutral towns
  const nTowns = [
    { f: 'rampart', name: 'Fernmire' },
    { f: 'necropolis', name: 'Gravehall' },
  ];
  for (const t of nTowns) {
    const sp = findSpot(10, spots);
    if (!sp) continue;
    spots.push(sp);
    const town = makeTown(t.f, sp.q, sp.r, null, t.name);
    town.guard = makeNeutralArmy(rng, t.f, 3, 6000, 9000);
    game.towns.push(town);
  }

  // mines
  const mineTypes = ['gold', 'wood', 'ore', 'gems', 'crystal', 'sulfur', 'mercury'];
  for (let i = 0; i < 13; i++) {
    const sub = mineTypes[i % mineTypes.length];
    const near = i < 4 ? p1Pos : i < 8 ? p2Pos : null;
    const sp = findSpot(2, spots);
    if (!sp) continue;
    spots.push(sp);
    addObj({ id: nextId('o'), type: 'mine', sub, owner: null, q: sp.q, r: sp.r });
  }

  // resource piles
  const piles = [
    { type: 'gold', amt: () => 600 + Math.floor(rng() * 900) },
    { type: 'wood', amt: () => 4 + Math.floor(rng() * 5) },
    { type: 'ore', amt: () => 4 + Math.floor(rng() * 5) },
    { type: 'gems', amt: () => 2 + Math.floor(rng() * 3) },
    { type: 'crystal', amt: () => 2 + Math.floor(rng() * 3) },
    { type: 'sulfur', amt: () => 2 + Math.floor(rng() * 2) },
    { type: 'mercury', amt: () => 2 + Math.floor(rng() * 2) },
  ];
  for (let i = 0; i < 24; i++) {
    const p = piles[i % piles.length];
    const near = i % 2 === 0 ? p1Pos : p2Pos;
    const sp = findSpot(1, spots);
    if (!sp) continue;
    spots.push(sp);
    addObj({ id: nextId('o'), type: p.type, amt: p.amt(), q: sp.q, r: sp.r });
  }

  // chests
  for (let i = 0; i < 6; i++) {
    const sp = findSpot(2, spots);
    if (!sp) continue;
    spots.push(sp);
    const chest = { id: nextId('o'), type: 'chest', q: sp.q, r: sp.r };
    if (rng() < 0.5) chest.gold = 1000 + Math.floor(rng() * 2000);
    else chest.xp = 600 + Math.floor(rng() * 1000);
    addObj(chest);
  }

  // dwellings
  for (let i = 0; i < 8; i++) {
    const f = factions[Math.floor(rng() * factions.length)];
    const tier = 1 + Math.floor(rng() * 5);
    const sp = findSpot(1, spots);
    if (!sp) continue;
    spots.push(sp);
    const creature = factionCreatures(f)[tier - 1];
    addObj({
      id: nextId('o'), type: 'dwelling', creatureId: creature.id, tier,
      guard: makeGuard(rng, creature.id), owner: null, stock: 0,
      q: sp.q, r: sp.r,
    });
  }

  // wandering neutral stacks
  const tierCounts = [
    { t: 1, n: [10, 25] }, { t: 2, n: [6, 14] }, { t: 3, n: [4, 9] },
  ];
  for (let i = 0; i < 10; i++) {
    const sp = findSpot(1, spots);
    if (!sp) continue;
    spots.push(sp);
    const tcf = tierCounts[Math.floor(rng() * tierCounts.length)];
    const f = factions[Math.floor(rng() * factions.length)];
    const base = factionCreatures(f)[tcf.t - 1];
    const army = [{ id: base.id, count: tcf.n[0] + Math.floor(rng() * (tcf.n[1] - tcf.n[0] + 1)) }];
    if (rng() < 0.35) {
      const f2 = factions[Math.floor(rng() * factions.length)];
      const t2 = Math.min(3, tcf.t + 1);
      army.push({ id: factionCreatures(f2)[t2 - 1].id, count: Math.max(2, Math.floor(army[0].count / 3)) });
    }
    addObj({
      id: nextId('o'), type: 'stack', army, gold: 300 + Math.floor(rng() * 800), xp: 150 + Math.floor(rng() * 300),
      q: sp.q, r: sp.r,
    });
  }
}

function pickName(rng, faction) {
  const names = HERO_NAMES[faction];
  return names[Math.floor(rng() * names.length)];
}

function makeTown(faction, q, r, owner, name) {
  return {
    id: nextId('t'), name, faction, q, r, owner,
    buildings: ['townhall'], guard: null, stock: {},
  };
}

function makeGuard(rng, creatureId) {
  const c = CREATURES[creatureId];
  const count = Math.round(c.growth * (1.2 + rng() * 1.3));
  return [{ id: creatureId, count }];
}

function makeNeutralArmy(rng, faction, maxTier, minVal, maxVal) {
  const cs = factionCreatures(faction);
  const val = minVal + rng() * (maxVal - minVal);
  const army = [];
  let total = 0;
  for (let tier = 1; tier <= maxTier && total < val; tier++) {
    const c = cs[tier - 1];
    const count = Math.max(1, Math.floor((val / maxTier) / c.cost.gold) + (rng() < 0.5 ? 1 : 0));
    if (count > 0) { army.push({ id: c.id, count }); total += count * c.cost.gold; }
  }
  if (!army.length) army.push({ id: cs[0].id, count: 1 });
  return army;
}

// ---------- save / load ----------
export function serializeGame(game) {
  return JSON.stringify(game);
}
export function deserializeGame(str) {
  const game = JSON.parse(str);
  if (!game || !game.map) throw new Error('bad save');
  return game;
}

// ---------- misc ----------
export function hexesInRadius(game, q, r, radius) {
  const out = [];
  for (let dq = -radius; dq <= radius; dq++) for (let dr = -radius; dr <= radius; dr++) {
    if (Math.abs(dq + dr) > radius) continue;
    const nq = q + dq, nr = r + dr;
    if (inBounds(nq, nr, game.w, game.h)) out.push({ q: nq, r: nr });
  }
  return out;
}

let _logSink = null;
export function setLogSink(fn) { _logSink = fn; }
export function log(msg) { if (_logSink) _logSink(msg); }
