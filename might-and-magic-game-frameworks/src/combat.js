import { CREATURES, SPELLS, SKILLS } from './data.js';
import { DIRS, hexDist, inBounds } from './hex.js';

export const FIELD = { cols: 11, rows: 8 };

let cuid = 1;
const nextUid = () => 'st' + (cuid++);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- setup ----------
export function setupBattle(attInfo, defInfo) {
  const attacker = makeSide(attInfo);
  const defender = makeSide(defInfo);
  const battle = {
    attacker, defender,
    order: [], cur: 0, round: 1,
    over: false, winner: null, results: null, log: [],
  };
  // placement
  placeStacks(attacker, 1);
  placeStacks(defender, FIELD.cols - 2);
  buildOrder(battle);
  return battle;
}

function makeSide(info) {
  const side = {
    pid: info.pid,
    hero: info.hero || null,
    ai: !!info.ai,
    stacksInput: info.stacks.map(s => ({ id: s.id, count: s.count })),
    stacks: [],
  };
  const hero = side.hero;
  for (const s of info.stacks) {
    if (!s || s.count <= 0) continue;
    const def = CREATURES[s.id];
    side.stacks.push({
      uid: nextUid(), side, def, id: s.id, count: s.count,
      hp: def.hp, pos: { q: 0, r: 0 }, acted: true, waited: false, defended: false,
      effects: {}, movedDist: 0, doubleAttacked: false,
      heroAtk: hero ? hero.atk : 0, heroDef: hero ? hero.def : 0,
      heroSkills: hero ? { ...hero.skills } : {},
    });
  }
  return side;
}

function placeStacks(side, startCol) {
  const rows = FIELD.rows;
  side.stacks.forEach((st, i) => {
    const row = Math.floor(i / 2);
    const colOff = i % 2;
    st.pos = { q: startCol + colOff, r: row };
  });
  if (side.stacks.length > rows * 2) {
    // stack beyond 2 columns — place on col+2
    side.stacks.slice(rows * 2).forEach((st, i) => { st.pos = { q: startCol + 2 + (i % 2), r: Math.floor(i / 2) }; });
  }
}

function buildOrder(battle) {
  const all = [...battle.attacker.stacks, ...battle.defender.stacks];
  all.sort((a, b) => {
    const da = effSpeed(a), db = effSpeed(b);
    if (db !== da) return db - da;
    if (a.side === b.side) return 0;
    return a.side === battle.attacker ? -1 : 1;
  });
  battle.order = all.map(s => s.uid);
  battle.cur = 0;
  // mark everyone acted=false except whoever's first
  for (const st of all) { st.acted = true; st.waited = false; }
  if (battle.order.length) current(battle).acted = false;
}

// ---------- derived stats ----------
export function effSpeed(st) {
  let s = st.def.speed;
  if (st.effects.haste) s += 2;
  if (st.effects.slow) s -= 2;
  return Math.max(1, s);
}
export function effAtk(st) {
  return st.def.atk + st.heroAtk;
}
export function effDef(st) {
  let d = st.def.def + st.heroDef;
  if (st.def.special.includes('ignoreDefense')) return Math.floor(d / 2);
  return d;
}
export function dmgMult(st, ranged) {
  let m = 1;
  const off = st.heroSkills.offense || 0;
  const arc = st.heroSkills.archery || 0;
  if (ranged) m *= SKILLS.archery.eff(arc);
  else m *= SKILLS.offense.eff(off);
  if (st.effects.bless) m *= (1 + 0.25);
  if (st.effects.curse) m *= (1 - 0.25);
  return Math.max(0.05, m);
}
export function dmgTakenMult(st) {
  let m = 1;
  const arm = st.heroSkills.armorer || 0;
  m *= SKILLS.armorer.eff(arm);
  if (st.defended) m *= 0.7;
  if (st.effects.shield) m *= 0.8;
  return Math.max(0.05, m);
}
export function stackInfo(st) {
  const ranged = st.def.special.includes('ranged');
  return {
    uid: st.uid, id: st.id, name: st.def.name, count: st.count, hp: st.hp, maxHp: st.def.hp,
    atk: effAtk(st), def: effDef(st), dmg: st.def.dmg, speed: effSpeed(st),
    ranged, fly: st.def.special.includes('fly'), side: st.side.pid,
  };
}

// ---------- reachability ----------
export function reachableStacks(battle, st) {
  const res = new Set();
  const dist = effSpeed(st);
  const fly = st.def.special.includes('fly');
  const seen = new Set([st.pos.q + ',' + st.pos.r]);
  const queue = [{ q: st.pos.q, r: st.pos.r, d: 0 }];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dq, dr] of DIRS) {
      const nq = cur.q + dq, nr = cur.r + dr;
      if (nq < 0 || nq >= FIELD.cols || nr < 0 || nr >= FIELD.rows) continue;
      const k = nq + ',' + nr;
      if (seen.has(k)) continue;
      if (!fly && stackAt(battle, nq, nr)) continue;
      const nd = cur.d + 1;
      if (nd > dist) continue;
      seen.add(k);
      res.add(k);
      queue.push({ q: nq, r: nr, d: nd });
    }
  }
  return res;
}

export function stackAt(battle, q, r) {
  for (const side of [battle.attacker, battle.defender]) {
    const st = side.stacks.find(s => s.count > 0 && s.pos.q === q && s.pos.r === r);
    if (st) return st;
  }
  return null;
}
export function canAttack(battle, st, target) {
  const dist = hexDist(st.pos, target.pos);
  if (st.def.special.includes('ranged')) return dist <= 10 && dist >= 1;
  return dist === 1;
}

// ---------- actions ----------
export function current(battle) { return battle.order[battle.cur] ? findStack(battle, battle.order[battle.cur]) : null; }
export function findStack(battle, uid) {
  for (const side of [battle.attacker, battle.defender]) {
    const s = side.stacks.find(x => x.uid === uid);
    if (s) return s;
  }
  return null;
}

export function moveStack(battle, st, q, r) {
  if (!reachableStacks(battle, st).has(q + ',' + r)) return false;
  const d = hexDist(st.pos, { q, r });
  st.movedDist += d;
  st.pos = { q, r };
  return true;
}

export function attack(battle, st, target) {
  const ranged = st.def.special.includes('ranged');
  if (!canAttack(battle, st, target)) return null;
  const first = dealDamage(battle, st, target, ranged);
  if (st.def.special.includes('doubleAttack') && !st.doubleAttacked) {
    st.doubleAttacked = true;
    const second = target.count > 0 && canAttack(battle, st, target) ? dealDamage(battle, st, target, ranged) : 0;
    return first + second;
  }
  return first;
}

function dealDamage(battle, st, target, ranged) {
  let mult = dmgTakenMult(target);
  let dmg = rollDamage(st, ranged);
  if (st.def.special.includes('charge') && st.movedDist >= 3) dmg *= 1.5;
  const luck = st.heroSkills.luck || 0;
  if (Math.random() < luck) { dmg *= 2; battle.log.push(`${st.def.name} lands a lucky blow!`); }
  dmg = Math.max(1, Math.round(dmg * mult));
  applyDamage(battle, target, dmg);
  battle.log.push(`${st.def.name} (${st.count}) attacks ${target.def.name} (${target.count}) for ${dmg}`);
  // melee retaliation
  if (!ranged && target.count > 0 && !target.def.special.includes('noRetaliation') &&
      !target.retaliated && hexDist(st.pos, target.pos) === 1) {
    target.retaliated = true;
    const rd = Math.max(1, Math.round(rollDamage(target, false) * dmgTakenMult(st)));
    applyDamage(battle, st, rd);
    battle.log.push(`${target.def.name} retaliates for ${rd}`);
  }
  checkEnd(battle);
  return dmg;
}

function rollDamage(st, ranged) {
  const [lo, hi] = st.def.dmg;
  let per = lo + Math.random() * (hi - lo);
  return per * st.count * dmgMult(st, ranged) * ratio(effAtk(st), effDef(st));
}

function ratio(atk, def) {
  return clamp(1 + 0.05 * (atk - def), 0.3, 3.0);
}

export function applyDamage(battle, target, D) {
  if (D <= 0 || target.count <= 0) return;
  const n = target.count;
  let per = D / n;
  let dead = 0;
  if (target.hp <= per) dead = n;
  else dead = Math.min(n, Math.floor(target.hp / per));
  target.count -= dead;
  target.hp = Math.max(0.01, target.hp - per);
  if (target.count <= 0) {
    target.count = 0;
    const idx = battle.order.indexOf(target.uid);
    if (idx >= 0) battle.order.splice(idx, 1);
    if (idx >= 0 && idx < battle.cur) battle.cur--;
    battle.log.push(`${target.def.name} is destroyed!`);
  }
  checkEnd(battle);
}

export function healStack(battle, target, amount) {
  if (target.count <= 0) return;
  const per = amount / target.count;
  target.hp = Math.min(target.def.hp, target.hp + per);
  battle.log.push(`${target.def.name} is healed for ${Math.round(per * target.count)}`);
}

export function castSpell(battle, side, spellId, target) {
  const hero = side.hero;
  if (!hero) return false;
  const spell = SPELLS[spellId];
  if (!spell || !hero.spells.includes(spellId)) return false;
  if (hero.mana < spell.mana) return false;
  const valid = validSpellTargets(battle, side, spell);
  if (!valid.has(target.uid)) return false;
  hero.mana -= spell.mana;
  const pow = hero.pow * (1 + (hero.skills?.sorcery || 0) * 0.1);
  if (spell.dmg) {
    const dmg = Math.max(1, Math.round(spell.dmg(pow)));
    applyDamage(battle, target, dmg);
    battle.log.push(`${hero.name} casts ${spell.name} for ${dmg} damage`);
    if (spell.aoe) {
      for (const [dq, dr] of DIRS) {
        const st = stackAt(battle, target.pos.q + dq, target.pos.r + dr);
        if (st && st.side !== side) applyDamage(battle, st, Math.round(dmg * 0.6));
      }
    }
  } else if (spell.heal) {
    healStack(battle, target, spell.heal(pow));
  } else if (spell.buff) {
    target.effects[spellId] = { turns: spell.turns };
    battle.log.push(`${hero.name} casts ${spell.name} on ${target.def.name}`);
  }
  checkEnd(battle);
  return true;
}

export function validSpellTargets(battle, side, spell) {
  const set = new Set();
  for (const st of side.stacks) if (st.count > 0) {
    const isEnemy = st.side !== side;
    const wantEnemy = spell.target === 'enemy';
    if (isEnemy === wantEnemy) set.add(st.uid);
  }
  return set;
}

export function waitAction(battle, st) {
  st.acted = true;
  st.waited = true;
  // move to end of order (after all others)
  const uid = st.uid;
  battle.order = battle.order.filter(u => u !== uid);
  const lastWaited = battle.order.length;
  battle.order.splice(lastWaited, 0, uid);
  battle.cur = Math.max(0, battle.order.indexOf(uid) - 1);
}

export function defendAction(battle, st) {
  st.defended = true;
  st.acted = true;
}

export function endCurrent(battle) {
  battle.cur++;
  if (battle.cur >= battle.order.length) {
    newRound(battle);
  }
  const st = current(battle);
  if (st) st.acted = false;
}

function newRound(battle) {
  battle.round++;
  battle.cur = 0;
  for (const side of [battle.attacker, battle.defender]) for (const st of side.stacks) {
    st.retaliated = false;
    st.defended = false;
    st.waited = false;
    st.doubleAttacked = false;
    st.movedDist = 0;
    st.acted = true;
    for (const k in st.effects) {
      st.effects[k].turns--;
      if (st.effects[k].turns <= 0) delete st.effects[k];
    }
  }
  const st = current(battle);
  if (st) st.acted = false;
  // rebuild order (buffs changed speed)
  buildOrder(battle);
}

function checkEnd(battle) {
  if (battle.over) return;
  const attAlive = battle.attacker.stacks.some(s => s.count > 0);
  const defAlive = battle.defender.stacks.some(s => s.count > 0);
  if (!attAlive || !defAlive) {
    battle.over = true;
    battle.winner = attAlive ? 'att' : 'def';
    battle.results = {
      attStacks: battle.attacker.stacks.filter(s => s.count > 0).map(s => ({ id: s.id, count: s.count })),
      defStacks: battle.defender.stacks.filter(s => s.count > 0).map(s => ({ id: s.id, count: s.count })),
    };
  }
}

// ---------- auto combat (AI / quick battle) ----------
export function runAuto(battle) {
  let guard = 0;
  while (!battle.over && guard++ < 5000) {
    const st = current(battle);
    if (!st) break;
    if (!st.acted) {
      aiAct(battle, st);
      if (battle.over) break;
      st.acted = true;
    }
    endCurrent(battle);
  }
  return battle;
}

// Advance through any AI-controlled stacks until a player stack must act.
export function processTurn(battle) {
  let guard = 0;
  while (!battle.over && guard++ < 2000) {
    const st = current(battle);
    if (!st) break;
    if (st.side.ai) {
      if (!st.acted) {
        aiAct(battle, st);
        if (battle.over) break;
        st.acted = true;
      }
      endCurrent(battle);
    } else {
      if (st.acted) endCurrent(battle);
      else break;
    }
  }
  return battle;
}

export function aiAct(battle, st) {
  // cast damage spell if hero has mana
  const hero = st.side.hero;
  const enemiesSide = st.side === battle.attacker ? battle.defender : battle.attacker;
  if (hero && hero.mana > 0 && hero.spells.some(s => SPELLS[s].dmg)) {
    const dmgSpell = hero.spells.find(s => SPELLS[s].dmg);
    const valid = enemiesSide.stacks.filter(t => t.count > 0);
    const best = valid.sort((a, b) => b.count * b.def.hp - a.count * a.def.hp)[0];
    if (best && hero.mana >= SPELLS[dmgSpell].mana) {
      hero.mana -= SPELLS[dmgSpell].mana;
      const pow = hero.pow;
      applyDamage(battle, best, Math.max(1, Math.round(SPELLS[dmgSpell].dmg(pow))));
      return;
    }
  }
  // heal if badly hurt
  if (st.def.special.includes('heals')) {
    const friends = st.side.stacks.filter(s => s.count > 0 && s !== st && s.hp < s.def.hp);
    if (friends.length) {
      const weakest = friends.sort((a, b) => a.hp / a.def.hp - b.hp / b.def.hp)[0];
      healStack(battle, weakest, weakest.def.hp * 0.2);
      return;
    }
  }
  if (st.def.special.includes('regenerate')) {
    st.hp = Math.min(st.def.hp, st.hp + st.def.hp * 0.2);
  }
  const enemies = (st.side === battle.attacker ? battle.defender : battle.attacker).stacks.filter(s => s.count > 0);
  if (!enemies.length) return;
  const nearest = enemies.slice().sort((a, b) => hexDist(st.pos, a.pos) - hexDist(st.pos, b.pos))[0];
  const ranged = st.def.special.includes('ranged');
  if (ranged && hexDist(st.pos, nearest.pos) >= 2) {
    attack(battle, st, nearest);
    return;
  }
  if (hexDist(st.pos, nearest.pos) === 1) {
    attack(battle, st, nearest);
    return;
  }
  // move toward nearest
  const reach = reachableStacks(battle, st);
  let best = null, bestD = Infinity;
  for (const k of reach) {
    const [q, r] = k.split(',').map(Number);
    if (stackAt(battle, q, r)) continue;
    const d = hexDist({ q, r }, nearest.pos);
    if (d < bestD) { bestD = d; best = { q, r }; }
  }
  if (best) moveStack(battle, st, best.q, best.r);
}
