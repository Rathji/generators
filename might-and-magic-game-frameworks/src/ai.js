import { CREATURES, buildingsFor } from './data.js';
import { hexDist, key } from './hex.js';
import * as E from './engine.js';
import { setupBattle, runAuto } from './combat.js';

// Greedy scoring AI: evaluates every reachable hex, moves toward the best goal.
let __aiSteps = 0;
window.__aiLog = [];
function step(where) {
  if (++__aiSteps > 20000) throw new Error('AI step limit exceeded at ' + where);
  if (window.__aiLog && window.__aiLog.length < 500) window.__aiLog.push(where + ':' + (window.__game?.state?.day || '?'));
}
export function resetAiLog() { __aiSteps = 0; window.__aiLog = []; }

export function runAITurn(game, player) {
  for (const hero of game.heroes.filter(h => h.pid === player.id)) {
    if (game.gameOver) return;
    aiHero(game, hero);
  }
  // build in all own towns (AI builds opportunistically)
  for (const town of game.towns.filter(t => t.owner === player.id)) {
    aiBuild(game, town);
  }
}

function aiHero(game, hero) {
  let budget = 40;
  while (budget-- > 0 && hero.move > 0 && !game.gameOver) {
    step('aiHero-loop');
    const { costs } = E.reachable(game, hero, hero.move);
    const goals = [];
    for (const [k, cell] of costs) {
      const [q, r] = k.split(',').map(Number);
      const score = scoreHex(game, hero, q, r);
      if (score <= 0) continue;
      goals.push({ q, r, score });
    }
    if (!goals.length) break;
    goals.sort((a, b) => b.score - a.score);
    const goal = goals[0];
    if (goal.score < 15) break;

    // If goal is an attackable entity, fight it
    const o = E.objAt(game, goal.q, goal.r);
    const town = E.townAt(game, goal.q, goal.r);
    const heroTarget = E.heroAt(game, goal.q, goal.r);
    if ((o && (o.type === 'stack' || (o.type === 'dwelling' && o.guard))) ||
        (town && town.owner !== hero.pid) || (heroTarget && heroTarget.pid !== hero.pid)) {
      if (E.canAttack(game, hero, goal.q, goal.r)) {
        aiBattle(game, hero, goal.q, goal.r);
        continue;
      }
      // too far — try to move closer
      const path = E.pathTo(game, hero, goal.q, goal.r, hero.move);
      if (!path) break;
      E.moveHeroPath(game, hero, path);
      continue;
    }

    const path = E.pathTo(game, hero, goal.q, goal.r, hero.move);
    if (!path) break;
    const events = [];
    E.moveHeroPath(game, hero, path, ev => events.push(ev));
    if (events.some(ev => ev.type === 'town')) {
      const t = events.find(ev => ev.type === 'town').town;
      aiTownActions(game, t, hero);
    } else if (events.some(ev => ev.type === 'dwelling')) {
      const o = events.find(ev => ev.type === 'dwelling').obj;
      aiDwelling(game, hero, o);
    }
    // dwelling guards cleared / mines captured are applied by interactAt already
  }
}

function scoreHex(game, hero, q, r) {
  const d = hexDist({ q: hero.q, r: hero.r }, { q, r });
  let score = 0;
  const myVal = E.armyValue(hero.army);
  const o = E.objAt(game, q, r);
  const town = E.townAt(game, q, r);
  const enemy = E.heroAt(game, q, r);
  if (o) {
    if (o.type === 'mine') {
      if (o.owner !== hero.pid) score += 80;
      else score -= 5;
    } else if (['gold', 'wood', 'ore', 'gems', 'crystal', 'sulfur', 'mercury'].includes(o.type)) {
      score += 45;
    } else if (o.type === 'chest') {
      score += 50;
    } else if (o.type === 'dwelling') {
      if (o.guard) {
        const targetVal = E.armyValue(o.guard);
        score += myVal > targetVal * 1.4 ? 60 : -100;
      } else {
        score += 35;
      }
    } else if (o.type === 'stack') {
      const targetVal = E.armyValue(o.army);
      score += myVal > targetVal * 1.35 ? 70 : -200;
    }
  }
  if (town) {
    if (town.owner === hero.pid) score += 25;
    else {
      const targetVal = E.armyValue(town.guard || []);
      score += myVal > targetVal * 1.2 ? 90 : -150;
    }
  }
  if (enemy && enemy.pid !== hero.pid) {
    const targetVal = E.armyValue(enemy.army);
    score += myVal > targetVal * 1.1 ? 120 : -150;
  }
  if (score > 0) score *= (1 - d * 0.015);
  return Math.round(score + (Math.random() - 0.5) * 10);
}

function aiBattle(game, hero, tq, tr) {
  step('aiBattle');
  const o = E.objAt(game, tq, tr);
  const town = E.townAt(game, tq, tr);
  const enemy = E.heroAt(game, tq, tr);
  let meta;
  let stacks;
  if (o && o.type === 'stack') {
    stacks = o.army; meta = { kind: 'stack', objId: o.id };
  } else if (o && o.type === 'dwelling') {
    stacks = o.guard; meta = { kind: 'dwelling', objId: o.id };
  } else if (town && town.owner !== hero.pid) {
    stacks = town.guard || []; meta = { kind: 'town', objId: town.id };
  } else if (enemy && enemy.pid !== hero.pid) {
    stacks = enemy.army; meta = { kind: 'hero', objId: enemy.id, defenderHeroId: enemy.id };
  } else return;
  meta.attackerHeroId = hero.id;
  const battle = setupBattle(
    { pid: hero.pid, hero, stacks: hero.army.filter(Boolean), ai: true },
    { pid: enemy ? enemy.pid : -1, hero: enemy || null, stacks, ai: true }
  );
  runAuto(battle);
  E.resolveBattle(game, battle, meta);
}

function aiTownActions(game, town, hero) {
  if (E.learnTownSpells) E.learnTownSpells(hero, town);
  aiBuild(game, town);
  aiRecruit(game, town, hero);
}

function aiRecruit(game, town, hero) {
  const costs = E.townRecruitCosts(town);
  const pid = town.owner;
  const p = game.players[pid];
  const sorted = costs.slice().sort((a, b) => b.tier - a.tier);
  for (const r of sorted) {
    const price = CREATURES[r.id].cost.gold;
    const stockKey = r.upgraded ? 'up' : 'base';
    while (p.resources.gold >= price * 5 && (town.stock[r.tier]?.[stockKey] || 0) > 0) {
      const toBuy = Math.min(town.stock[r.tier][stockKey], 5);
      const result = E.addToArmy(hero, r.id, toBuy);
      if (result === null) break;
      p.resources.gold -= price * toBuy;
      town.stock[r.tier][stockKey] -= toBuy;
    }
  }
}

function aiBuild(game, town) {
  const pid = town.owner;
  const p = game.players[pid];
  const defs = buildingsFor(town.faction);
  const prio = ['capitol', 'cityhall', 'fort', 'citadel', 'castle', 'mages1', 'mages2', 'mages3',
    ...defs.filter(d => d.provides && !d.providesUpgrade).map(d => d.id),
    ...defs.filter(d => d.providesUpgrade).map(d => d.id)];
  for (const id of prio) {
    const def = defs.find(d => d.id === id);
    if (!def) continue;
    if (E.townCanBuild(town, def, game).ok && E.canAfford(game, pid, def.cost)) {
      E.buildInTown(game, town, id);
      break;
    }
  }
}

function aiDwelling(game, hero, o) {
  if (o.owner !== hero.pid && o.owner !== null) return;
  if (o.owner === null) o.owner = hero.pid;
  const c = CREATURES[o.creatureId];
  const p = game.players[hero.pid];
  while (o.stock > 0 && p.resources.gold >= c.cost.gold * 3) {
    const toBuy = Math.min(o.stock, 3);
    const result = E.addToArmy(hero, o.creatureId, toBuy);
    if (result === null) break;
    p.resources.gold -= c.cost.gold * toBuy;
    o.stock -= toBuy;
  }
}
