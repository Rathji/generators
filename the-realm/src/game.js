import { genWorld, findPath, isInTown, walkable, N, T } from './world.js';
import { Renderer, screenToTile, TW, TH } from './render.js';
import {
  CLASSES, WEAPONS, ARMORS, ITEMS, MONSTERS,
  xpToNext, computeStats, rollDamage, rollHit, playerBackstabBonus, rollLoot
} from './entities.js';
import { Net } from './net.js';

const G = {
  world: null, grid: null, buildings: [],
  player: null, stats: null,
  monsters: [], spawns: [],
  loot: [], fx: [], projectiles: [],
  remote: [], remoteMap: new Map(),
  cam: { x: 48, y: 53, zoom: 1 },
  time: 0, keys: {}, hover: null,
  armed: 'attack', kills: 0, combatT: 0, healerT: 0,
  net: null, online: 0, inGame: false,
};
window.__realm = { G, renderer: null, setRenderer: r => { renderer = r; window.__realm.renderer = r; } };

const MELEE_BASE = 1.3;
const SIM_R = 16;
const rnd = () => Math.random();

const $ = id => document.getElementById(id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

let renderer = null;

/* ---------------- world / monsters ---------------- */

function initWorld(){
  G.world = genWorld(20260810);
  G.grid = G.world.grid;
  G.buildings = G.world.buildings;
  G.spawns = G.world.monsterSpawns.map((s, i) => ({ ...s, idx: i, t: 0 }));
  G.monsters = [];
  G.loot = []; G.fx = []; G.projectiles = [];
}

function makeMonster(spawn, lvl){
  const base = MONSTERS[spawn.type];
  const scale = 1 + (lvl - 1) * 0.07;
  return {
    x: spawn.x, y: spawn.y, type: spawn.type, spawnIdx: spawn.idx,
    hp: Math.round(base.hp * scale), maxHp: Math.round(base.hp * scale),
    xp: Math.round(base.xp * (1 + (lvl - 1) * 0.05)),
    radius: base.radius, speed: base.speed, aggroR: base.aggro,
    gold: base.gold, dmg: base.dmg, shape: base.shape,
    facing: rnd() * Math.PI * 2, mirror: rnd() < 0.5,
    walk: rnd() * 10, atkCd: 0.5 + rnd(), hurt: 0,
    wanderT: 0, wanderA: 0, state: 'idle', aggro: false,
    rootT: 0, dotT: 0, dotDmg: 0, dotTick: 0, dotColor: '#8fdf6a',
    dead: false, corpseT: 0,
  };
}

function updateMonsters(dt){
  const p = G.player;
  for (const sp of G.spawns){
    if (sp.t > 0){ sp.t -= dt; continue; }
    if (sp.active) continue;
    const dx = sp.x - p.x, dy = sp.y - p.y;
    if (dx * dx + dy * dy > 28 * 28) continue;
    const m = makeMonster(sp, p.lvl);
    G.monsters.push(m);
    sp.active = m;
  }
  for (const m of G.monsters) if (m.active !== false) simMonster(m, dt);
  G.monsters = G.monsters.filter(m => {
    if (m.dead && m.corpseT <= 0){
      const sp = G.spawns[m.spawnIdx];
      if (sp){ sp.active = null; sp.t = 12 + rnd() * 8; }
      return false;
    }
    return true;
  });
}

function simMonster(m, dt){
  const p = G.player;
  m.hurt -= dt;
  m.atkCd -= dt;
  m.walk += dt * (m.aggro ? 2.2 : 0.5);
  if (m.dead){ m.corpseT -= dt; return; }

  if (m.rootT > 0){ m.rootT -= dt; }
  if (m.dotT > 0){
    m.dotTick -= dt;
    if (m.dotTick <= 0){
      m.dotTick = 1;
      m.dotT--;
      m.hp -= m.dotDmg;
      fxText(m.x, m.y, '-' + m.dotDmg, m.dotColor);
      m.hurt = 0.2;
      if (m.hp <= 0){ killMonster(m); return; }
    }
  }

  const dx = p.x - m.x, dy = p.y - m.y;
  const d = Math.hypot(dx, dy);
  if (d > SIM_R || p.dead){
    m.aggro = false; m.state = 'idle';
    return;
  }

  if (!m.aggro){
    m.aggro = d < m.aggroR;
    if (m.aggro){ m.state = 'chase'; m.hpShown = true; }
  }
  if (!m.aggro){
    m.wanderT -= dt;
    if (m.wanderT <= 0){ m.wanderT = 1.5 + rnd() * 2.5; m.wanderA = rnd() * Math.PI * 2; }
    m.state = 'wander';
  } else if (m.state !== 'flee'){
    m.state = (m.hp / m.maxHp < 0.22 && ['rat', 'beetle', 'wolf', 'goblin'].includes(m.type)) ? 'flee' : 'chase';
  }

  let vx = 0, vy = 0;
  if (m.state === 'chase'){
    const dd = d || 1;
    vx = dx / dd * m.speed; vy = dy / dd * m.speed;
    m.facing = Math.atan2(dy, dx);
  } else if (m.state === 'flee'){
    const dd = d || 1;
    vx = -dx / dd * m.speed * 0.8; vy = -dy / dd * m.speed * 0.8;
    m.facing = Math.atan2(-dy, -dx);
  } else if (m.state === 'wander'){
    vx = Math.cos(m.wanderA) * m.speed * 0.32;
    vy = Math.sin(m.wanderA) * m.speed * 0.32;
    m.facing = m.wanderA;
  }

  if (m.rootT <= 0 && (vx || vy)){
    if (tryMonsterMove(m, vx * dt, vy * dt)){ m.mirror = vx < 0; }
  }

  if (m.state === 'chase' && d < m.radius + 0.34){
    if (m.atkCd <= 0){
      m.atkCd = 1.05 + rnd() * 0.5;
      const hit = rnd() < 0.82;
      const raw = m.dmg[0] + rnd() * (m.dmg[1] - m.dmg[0]);
      const armor = ARMORS[p.armor] ? ARMORS[p.armor].armor : 0;
      const dmg = hit ? Math.max(1, Math.round(raw - armor)) : 0;
      if (dmg > 0){
        applyDamageToPlayer(dmg);
        fxText(m.x + dx / d * 0.3, m.y + dy / d * 0.3, '-' + dmg, '#ff8080');
        m.hurt = 0.2;
      }
    }
  }
}

function tryMonsterMove(m, dx, dy){
  const p = G.player;
  if (isInTown(m.x + dx * 1.5, m.y + dy * 1.5)) return false;
  let moved = false;
  if (walkable(G.grid, m.x + dx, m.y) && !nearPlayer(m.x + dx, m.y, m.radius)){ m.x += dx; moved = true; }
  if (walkable(G.grid, m.x, m.y + dy) && !nearPlayer(m.x, m.y + dy, m.radius)){ m.y += dy; moved = true; }
  return moved || dx || dy;
}

function nearPlayer(x, y, r){
  const p = G.player;
  return (p.x - x) ** 2 + (p.y - y) ** 2 < (r + 0.28) ** 2;
}

/* ---------------- player / combat ---------------- */

function createPlayer(name, cls){
  const stats = computeStats(cls, 1);
  const cd = CLASSES[cls];
  const p = {
    name, cls, x: 48, y: 53, lvl: 1, xp: 0,
    hp: stats.maxHp, maxHp: stats.maxHp,
    mp: stats.maxMp, maxMp: stats.maxMp,
    gold: 12, bag: [],
    weapon: cd.startWeapon, armor: cd.startArmor,
    attackCd: 0, castT: 0, attack: 0,
    path: null, pathTimer: 0, target: null, abilityArmed: false,
    walk: 0, mirror: false, moving: false,
    dead: false, buffs: { meditate: 0 },
    startWeapon: cd.startWeapon,
  };
  G.player = p;
  G.stats = stats;
  return p;
}

function playerSpeed(){
  let s = G.stats.speed;
  if (G.player.buffs.meditate > 0) s *= 1.12;
  return s;
}

function tryPlayerMove(dx, dy){
  const p = G.player;
  let ok = false;
  if (canOccupy(p.x + dx, p.y, 0.26)){ p.x += dx; ok = true; }
  if (canOccupy(p.x, p.y + dy, 0.26)){ p.y += dy; ok = true; }
  return ok;
}

function canOccupy(x, y, r){
  if (!walkable(G.grid, x, y)) return false;
  const rr = r + 0.28;
  for (const m of G.monsters){
    if (m.dead) continue;
    const dx = m.x - x, dy = m.y - y;
    if (dx * dx + dy * dy < (rr + m.radius) ** 2) return false;
  }
  for (const rp of G.remote){
    const dx = rp.x - x, dy = rp.y - y;
    if (dx * dx + dy * dy < (rr + 0.3) ** 2) return false;
  }
  return true;
}

function updateMove(dt){
  const p = G.player;
  if (p.dead){ p.moving = false; return; }
  const k = G.keys;
  let mx = 0, my = 0;
  if (k.left || k.a) mx -= 1;
  if (k.right || k.d) mx += 1;
  if (k.up || k.w) my -= 1;
  if (k.down || k.s) my += 1;
  const speed = playerSpeed();
  if (mx || my){
    const dd = Math.hypot(mx, my) || 1;
    tryPlayerMove(mx / dd * speed * dt, my / dd * speed * dt);
    p.path = null; p.target = null;
    p.mirror = mx < 0;
    p.walk += dt * 6;
    p.moving = true;
    return;
  }
  if (p.path && p.path.length){
    const wp = p.path[0];
    const tx = wp.x + 0.5, ty = wp.y + 0.5;
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.14){ p.path.shift(); }
    else {
      const step = Math.min(speed * dt, d);
      tryPlayerMove(dx / d * step, dy / d * step);
      p.mirror = dx < 0;
      p.walk += dt * 6;
      p.moving = true;
    }
    return;
  }
  p.moving = false;
}

function updateAttack(dt){
  const p = G.player;
  if (p.dead) return;
  p.attackCd -= dt;
  p.castT -= dt;
  p.attack = Math.max(0, p.attack - dt * 3);
  p.pathTimer -= dt;
  const t = p.target;
  if (!t || t.dead){
    p.target = null;
    p.abilityArmed = false;
    return;
  }
  const cd = CLASSES[p.cls];
  const d = dist(p, t);
  const isRanged = p.abilityArmed && cd.ability.type === 'ranged';
  const range = isRanged ? cd.ability.range : MELEE_BASE + (t.radius || 0.3);
  if (d > range){
    if (p.pathTimer <= 0){
      p.path = findPath(G.grid, Math.floor(p.x), Math.floor(p.y), Math.floor(t.x), Math.floor(t.y));
      p.pathTimer = 0.6;
    }
  } else {
    p.path = null;
    p.mirror = t.x - p.x < 0;
    if (p.castT <= 0 && p.attackCd <= 0){
      if (p.abilityArmed && isRanged){
        castRanged(t);
        p.abilityArmed = false;
        if (G.armed === 'ability') G.armed = 'attack';
        p.attackCd = 0.5;
      } else if (p.abilityArmed){
        if (p.mp < cd.ability.cost){
          toast('Not enough mana', '#ff8080');
          p.abilityArmed = false;
          if (G.armed === 'ability') G.armed = 'attack';
          p.attackCd = 0.6;
        } else {
          p.mp -= cd.ability.cost;
          abilityMeleeHit(t);
          p.abilityArmed = false;
          if (G.armed === 'ability') G.armed = 'attack';
          p.attackCd = WEAPONS[p.weapon].speed;
          p.attack = 1;
        }
        updateHud();
      } else {
        playerAttack(t);
      }
    }
  }
}

function playerAttack(m){
  const p = G.player;
  const hit = rnd() < rollHit(G.stats.dex);
  if (!hit){
    fxText(m.x, m.y, 'miss', '#cfcfcf');
  } else {
    let dmg = rollDamage(p.weapon, G.stats.str, rnd);
    const crit = rnd() < 0.06 + G.stats.dex * 0.004;
    if (crit) dmg = Math.round(dmg * 2);
    dmg = Math.round(dmg * playerBackstabBonus(p, m));
    damageMonster(m, Math.max(1, dmg));
    if (crit) fxText(m.x, m.y, 'CRIT!', '#f2d54a');
  }
  p.attack = 1;
  p.attackCd = WEAPONS[p.weapon].speed;
}

function abilityMeleeHit(m){
  const p = G.player;
  const ab = CLASSES[p.cls].ability;
  if (ab.mult){
    let dmg = rollDamage(p.weapon, G.stats.str, rnd) * ab.mult;
    dmg = Math.max(1, Math.round(dmg));
    damageMonster(m, dmg);
    fxText(m.x, m.y, '-' + dmg, '#ffd54a');
    fxText(m.x, m.y, ab.name, '#fff0c0');
  }
  if (ab.dot){
    m.dotT = ab.dotTicks;
    m.dotDmg = ab.dot;
    m.dotTick = 0.4;
    m.dotColor = '#9adf6a';
    fxText(m.x, m.y, 'Poisoned!', '#9adf6a');
  }
}

function castRanged(m){
  const p = G.player;
  const ab = CLASSES[p.cls].ability;
  if (p.mp < ab.cost){
    toast('Not enough mana', '#ff8080');
    return;
  }
  p.mp -= ab.cost;
  G.projectiles.push({ x: p.x, y: p.y, px: p.x, py: p.y, tgt: m, ab, t: 0, dead: false, speed: 9 });
  p.castT = ab.castTime || 0.4;
  updateHud();
}

function castSelf(){
  const p = G.player;
  const cd = CLASSES[p.cls];
  const ab = cd.ability;
  if (p.dead || p.castT > 0) return;
  if (p.mp < ab.cost){ toast('Not enough mana', '#ff8080'); return; }
  p.mp -= ab.cost;
  p.castT = ab.castTime || 0.4;
  if (ab.heal){
    const amt = Math.round(ab.heal + (ab.healPerSpi || 0) * G.stats.spi);
    p.hp = Math.min(p.maxHp, p.hp + amt);
    fxText(p.x, p.y, '+' + amt, '#7dff9a');
  }
  if (ab.regen){
    p.buffs.meditate = ab.regen;
    fxText(p.x, p.y, 'Meditating…', '#9ad7ff');
  }
  updateHud();
}

function updateProjectiles(dt){
  for (const pr of G.projectiles){
    const t = pr.tgt;
    if (!t || t.dead){ pr.dead = true; continue; }
    const dx = t.x - pr.x, dy = t.y - pr.y;
    const d = Math.hypot(dx, dy) || 1;
    const step = pr.speed * dt;
    if (d <= step){
      pr.dead = true;
      const ab = pr.ab;
      if (ab.root){ t.rootT = ab.root; }
      if (ab.dot){ t.dotT = ab.dotTicks; t.dotDmg = ab.dot; t.dotTick = 0.3; t.dotColor = '#8fdf6a'; }
      const dmg = Math.max(1, Math.round((ab.dmg || 0) + (ab.dmgPerInt || 0) * G.stats.int + rnd() * 6));
      if (dmg > 0){
        damageMonster(t, dmg);
        fxText(t.x, t.y, '-' + dmg, '#ffb040');
      }
      fxText(t.x, t.y, ab.name, '#fff0c0');
    } else {
      pr.x += dx / d * step;
      pr.y += dy / d * step;
    }
  }
  G.projectiles = G.projectiles.filter(pr => !pr.dead);
}

function damageMonster(m, dmg){
  if (m.dead) return;
  m.hp -= dmg;
  m.hurt = 0.25;
  m.aggro = true;
  m.state = 'chase';
  G.combatT = 4;
  fxText(m.x, m.y, '-' + dmg, '#ffd0a0');
  if (m.hp <= 0) killMonster(m);
}

function killMonster(m){
  const p = G.player;
  m.dead = true;
  m.corpseT = 4;
  const gold = Math.round(m.gold[0] + rnd() * (m.gold[1] - m.gold[0]));
  p.gold += gold;
  p.xp += m.xp;
  G.kills++;
  G.combatT = 4;
  fxText(m.x, m.y, '+' + gold + 'g', '#f2d54a');
  for (const key of rollLoot(m.type, rnd)){
    G.loot.push({ x: m.x + (rnd() - 0.5) * 0.4, y: m.y + (rnd() - 0.5) * 0.4, key });
  }
  if (m.type === 'dragon') toast('You slew a Dragon!', '#f2d54a');
  else if (m.type === 'troll' || m.type === 'ogre') toast('A mighty beast falls!', '#e8d287');
  checkLevelUp();
}

function checkLevelUp(){
  const p = G.player;
  let up = false;
  while (p.xp >= xpToNext(p.lvl)){
    p.xp -= xpToNext(p.lvl);
    p.lvl++;
    up = true;
  }
  if (up){
    const st = computeStats(p.cls, p.lvl);
    G.stats = st;
    p.maxHp = st.maxHp;
    p.maxMp = st.maxMp;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    fxText(p.x, p.y, 'LEVEL UP!', '#f2d54a');
    toast(`You are now level ${p.lvl}!`, '#f2d54a');
    addSysChat(`You reached level ${p.lvl}!`, '#f2d54a');
  }
}

function applyDamageToPlayer(dmg){
  const p = G.player;
  if (p.dead) return;
  p.hp -= dmg;
  G.combatT = 5;
  if (p.hp <= 0){
    p.hp = 0;
    die();
  }
}

function die(){
  const p = G.player;
  p.dead = true;
  p.path = null;
  p.target = null;
  const lost = Math.floor(p.gold * 0.1);
  p.gold -= lost;
  if (lost > 0) G.loot.push({ x: p.x, y: p.y, key: 'goldbag', amount: lost });
  $('deathOverlay').hidden = false;
  $('deathMsg').textContent = lost > 0
    ? `You have fallen! ${lost} gold was lost. The Realm will claim you again shortly…`
    : 'You have fallen! The Realm will claim you again shortly…';
  G.respawnTimer = 5;
  addSysChat('You have fallen!', '#ff8080');
}

function respawn(){
  const p = G.player;
  p.dead = false;
  p.hp = p.maxHp;
  p.mp = p.maxMp;
  p.x = G.world.plaza.x;
  p.y = G.world.plaza.y;
  p.path = null;
  p.target = null;
  G.combatT = 0;
  $('deathOverlay').hidden = true;
  toast('You return to the Realm');
  addSysChat('You return to the Realm, restored.', '#7dff9a');
}

/* ---------------- fx / loot / healer / regen ---------------- */

function fxText(x, y, text, color, ttl = 0.9){
  G.fx.push({ x, y, text, color, t: 0, ttl });
}

function updateFx(dt){
  for (const f of G.fx) f.t += dt;
  G.fx = G.fx.filter(f => f.t < f.ttl);
  const p = G.player;
  for (const l of G.loot){
    if (p.dead) continue;
    if (dist(p, l) < 0.75 && l.pulse === undefined){
      if (l.key === 'goldbag'){
        p.gold += l.amount || 0;
        fxText(p.x, p.y, '+' + (l.amount || 0) + 'g', '#f2d54a');
        l.dead = true;
      } else if (p.bag.length < 30){
        p.bag.push(l.key);
        fxText(p.x, p.y, ITEMS[l.key].name, '#9ad7ff');
        l.dead = true;
      } else {
        toast('Bag is full!', '#ff8080');
        l.pulse = true;
      }
    }
  }
  G.loot = G.loot.filter(l => !l.dead);

  const healer = G.buildings.find(b => b.type === 'healer');
  if (healer && !p.dead){
    const hd = dist(p, { x: healer.door.x, y: healer.door.y });
    if (hd < 1.9 && p.hp < p.maxHp && G.healerT <= 0){
      G.healerT = 2.5;
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.4));
      fxText(p.x, p.y, '+' + Math.round(p.maxHp * 0.4), '#7dff9a');
      if (!G.healerMet){
        G.healerMet = true;
        addSysChat('The healer tends your wounds. "Rest well, friend."', '#9ad7ff');
      }
    }
  }
  G.healerT -= dt;

  if (G.combatT > 0) G.combatT -= dt;
  else {
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.04 * dt);
    p.mp = Math.min(p.maxMp, p.mp + (2 + G.stats.spi * 0.15) * dt);
  }
  if (p.buffs.meditate > 0){
    p.buffs.meditate -= dt;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.06 * dt);
    p.mp = Math.min(p.maxMp, p.mp + p.maxMp * 0.05 * dt);
    if (p.buffs.meditate <= 0) fxText(p.x, p.y, 'meditation ends', '#9ad7ff');
  }
}

/* ---------------- net ---------------- */

function setupNet(){
  G.net = new Net();
  G.net.on('chat', ({ name, text }) => addRemoteChat(name, text));
  G.net.on('roster', () => {
    syncRemote();
    updateOnlineLabel();
  });
  G.net.on('status', ({ connected, online }) => {
    if (connected && typeof online === 'number') G.online = online;
    updateOnlineLabel();
  });
  G.net.connect();
  G.net.on('joined', () => { updateOnlineLabel(); });
}

function syncRemote(){
  const want = new Map();
  for (const [id, p] of G.net.roster){
    if (id === G.net.myId) continue;
    let r = G.remoteMap.get(id);
    if (!r){
      const cd = CLASSES[p.cls] || CLASSES.warrior;
      r = {
        id, name: p.name, cls: p.cls, lvl: p.lvl,
        x: p.x, y: p.y, tx: p.x, ty: p.y,
        weapon: cd.startWeapon, mirror: false, walk: rnd() * 10,
        hp: 1, maxHp: 1, hpPct: 1,
      };
      G.remote.push(r);
      G.remoteMap.set(id, r);
    }
    r.tx = p.x;
    r.ty = p.y;
    r.lvl = p.lvl;
    want.set(id, r);
  }
  for (const r of [...G.remote]){
    if (!want.has(r.id)){
      G.remote.splice(G.remote.indexOf(r), 1);
      G.remoteMap.delete(r.id);
    }
  }
}

function updateRemote(dt){
  for (const r of G.remote){
    const dx = r.tx - r.x, dy = r.ty - r.y;
    const d = Math.hypot(dx, dy);
    const step = Math.min(d, 10 * dt);
    if (d > 0.04){
      r.x += dx / d * step;
      r.y += dy / d * step;
      r.walk += dt * 5;
      if (dx < 0) r.mirror = true;
      else if (dx > 0) r.mirror = false;
    }
  }
}

function updateOnlineLabel(){
  const n = G.net && G.net.myId ? G.net.roster.size + 1 : G.online;
  $('onlineLbl').textContent = n + (n === 1 ? ' adventurer online' : ' adventurers online');
  if (!G.inGame && $('onlineTxt')){
    $('onlineTxt').textContent = G.net && G.net.connected
      ? (n + ' adventurers online')
      : 'Playing in solo mode (offline)';
  }
}

/* ---------------- chat ---------------- */

function addLine(html, cls){
  const log = $('chatLog');
  const div = document.createElement('div');
  div.className = 'chatline ' + (cls || '');
  div.innerHTML = html;
  log.appendChild(div);
  while (log.children.length > 80) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function addRemoteChat(name, text){
  addLine(`<span class="chatname">${escapeHtml(name)}:</span> ${escapeHtml(text)}`, 'remote');
}

function addSysChat(text, color){
  addLine(`<span style="color:${color || '#9ad7ff'}">${escapeHtml(text)}</span>`, 'sys');
}

function addLocalChat(name, text){
  addLine(`<span class="chatname you">${escapeHtml(name)}:</span> ${escapeHtml(text)}`, 'you');
}

function escapeHtml(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- HUD / UI ---------------- */

function updateHud(){
  const p = G.player;
  const st = G.stats;
  $('hpFill').style.width = (p.hp / p.maxHp * 100) + '%';
  $('hpTxt').textContent = Math.ceil(p.hp) + '/' + p.maxHp;
  $('mpFill').style.width = (p.mp / p.maxMp * 100) + '%';
  $('mpTxt').textContent = Math.ceil(p.mp) + '/' + p.maxMp;
  const need = xpToNext(p.lvl);
  $('xpFill').style.width = (p.xp / need * 100) + '%';
  $('xpTxt').textContent = p.xp + '/' + need + ' XP';
  $('nameLbl').textContent = p.name;
  $('lvlLbl').textContent = p.lvl;
  $('goldLbl').textContent = p.gold;
  const ab = CLASSES[p.cls].ability;
  const abl = $('abilityCostLbl');
  if (abl) abl.textContent = ab.cost + ' MP';
  $('abilityBtn').classList.toggle('armed', G.armed === 'ability');
  $('attackBtn').classList.toggle('armed', G.armed === 'attack');
}

let toastTimer = null;
function toast(text, color){
  const el = $('toastCtn');
  el.textContent = text;
  el.style.color = color || '#e8e0cf';
  el.style.opacity = 1;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------------- input ---------------- */

function setupInput(){
  const canvas = $('gameCanvas');
  canvas.addEventListener('pointerdown', e => onCanvasDown(e));
  canvas.addEventListener('pointermove', e => onCanvasMove(e));
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT') return;
    const k = e.key.toLowerCase();
    G.keys[k] = true;
    if (k === ' '){
      e.preventDefault();
      attackNearest();
    }
    if (k === '1') arm('attack');
    if (k === '2') arm('ability');
    if (k === 'escape'){
      cancelTargeting();
      closeModals();
    }
    if (k === 'enter'){
      e.preventDefault();
      $('chatInput').focus();
    }
  });
  window.addEventListener('keyup', e => { G.keys[e.key.toLowerCase()] = false; });

  $('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter'){
      submitChat();
      e.target.blur();
    }
  });
  $('chatBtn').addEventListener('click', submitChat);
}

function cancelTargeting(){
  const p = G.player;
  p.target = null;
  p.path = null;
  G.armed = 'attack';
  p.abilityArmed = false;
}

function closeModals(){
  $('bagModal').hidden = true;
  $('charModal').hidden = true;
}

function onCanvasMove(e){
  const tile = screenToTile(e.clientX, e.clientY, G.cam, renderer.w, renderer.h, G.cam.zoom);
  let m = null;
  if (tile){
    for (const mm of G.monsters){
      if (mm.dead) continue;
      if (Math.abs(mm.x - tile.x) < 0.65 && Math.abs(mm.y - tile.y) < 0.65){
        m = mm;
        break;
      }
    }
  }
  G.hover = m;
  $('gameCanvas').style.cursor = m ? 'crosshair' : 'default';
}

function monsterAt(tile){
  let best = null, bestD = 0.8;
  for (const m of G.monsters){
    if (m.dead) continue;
    const d = Math.hypot(m.x - tile.x, m.y - tile.y);
    if (d < bestD){
      bestD = d;
      best = m;
    }
  }
  return best;
}

function lootAt(tile){
  let best = null, bestD = 0.7;
  for (const l of G.loot){
    const d = Math.hypot(l.x - tile.x, l.y - tile.y);
    if (d < bestD){
      bestD = d;
      best = l;
    }
  }
  return best;
}

function onCanvasDown(e){
  const p = G.player;
  if (!p || p.dead || !G.inGame) return;
  const tile = screenToTile(e.clientX, e.clientY, G.cam, renderer.w, renderer.h, G.cam.zoom);
  if (!tile) return;
  const m = monsterAt(tile);
  const l = lootAt(tile);
  if (m){
    p.target = m;
    p.path = null;
    const ab = CLASSES[p.cls].ability;
    if (G.armed === 'ability' && ab.type !== 'self'){
      p.abilityArmed = true;
    } else {
      p.abilityArmed = false;
      if (G.armed === 'ability') G.armed = 'attack';
    }
    return;
  }
  p.target = null;
  p.abilityArmed = false;
  if (l){
    G.lootMove = l;
    p.path = findPath(G.grid, Math.floor(p.x), Math.floor(p.y), Math.floor(l.x), Math.floor(l.y));
    return;
  }
  const path = findPath(G.grid, Math.floor(p.x), Math.floor(p.y), tile.x, tile.y);
  if (path) p.path = path;
  else toast('Cannot go there', '#ff8080');
}

function attackNearest(){
  const p = G.player;
  if (p.dead) return;
  let best = null, bestD = 49;
  for (const m of G.monsters){
    if (m.dead) continue;
    const d = (m.x - p.x) ** 2 + (m.y - p.y) ** 2;
    if (d < bestD){ bestD = d; best = m; }
  }
  if (best){
    p.target = best;
    p.path = null;
    p.abilityArmed = false;
  }
}

function arm(which){
  const p = G.player;
  if (!p || p.dead) return;
  if (which === 'ability'){
    const ab = CLASSES[p.cls].ability;
    if (ab.type === 'self'){
      castSelf();
      return;
    }
    G.armed = G.armed === 'ability' ? 'attack' : 'ability';
  } else {
    G.armed = 'attack';
  }
  p.abilityArmed = false;
  updateHud();
}

function submitChat(){
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const p = G.player;
  if (!p){ return; }
  const ok = G.net.sendChat(text);
  if (!ok){ toast('Chat unavailable (offline)', '#ff8080'); return; }
  addLocalChat(p.name, text);
}

/* ---------------- inventory / character ---------------- */

function openBag(){
  renderBag();
  $('bagModal').hidden = false;
  $('charModal').hidden = true;
}

function renderBag(){
  const grid = $('bagGrid');
  grid.innerHTML = '';
  const p = G.player;
  const renderSlot = (key, equipped) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (equipped ? ' equipped' : '');
    const it = ITEMS[key];
    slot.innerHTML = `<div class="sloticon">${it.icon}</div><div class="slottip">${it.name}${equipped ? ' (equipped)' : ''}${it.kind === 'food' ? ' — click to eat' : (it.kind === 'weapon' ? ' — click to wield' : ' — click to wear')}</div>`;
    slot.onclick = () => useItem(key);
    grid.appendChild(slot);
  };
  if (p.weapon && WEAPONS[p.weapon]) renderSlot(p.weapon, true);
  if (p.armor && ARMORS[p.armor]) renderSlot(p.armor, true);
  for (const key of p.bag) renderSlot(key, false);
  if (!grid.children.length) grid.innerHTML = '<div class="empty">Your pack is empty. Slay monsters to find loot!</div>';
}

function useItem(key){
  const p = G.player;
  const it = ITEMS[key];
  if (it.kind === 'food'){
    if (p.hp >= p.maxHp){ toast('You are already hale', '#9ad7ff'); return; }
    const i = p.bag.indexOf(key);
    if (i < 0) return;
    p.bag.splice(i, 1);
    p.hp = Math.min(p.maxHp, p.hp + it.heal);
    fxText(p.x, p.y, '+' + it.heal, '#7dff9a');
    addSysChat(`You eat the ${it.name.toLowerCase()}. (+${it.heal} health)`, '#9ad7ff');
    renderBag();
    updateHud();
  } else if (it.kind === 'weapon'){
    const old = p.weapon;
    const i = p.bag.indexOf(key);
    if (i >= 0){
      p.bag.splice(i, 1);
      if (old && old !== 'fists') p.bag.push(old);
      p.weapon = key;
      addSysChat(`You wield the ${it.name}.`, '#9ad7ff');
    }
    renderBag();
    updateHud();
  } else if (it.kind === 'armor'){
    const old = p.armor;
    const i = p.bag.indexOf(key);
    if (i >= 0){
      p.bag.splice(i, 1);
      if (old) p.bag.push(old);
      p.armor = key;
      addSysChat(`You wear the ${it.name}.`, '#9ad7ff');
    }
    renderBag();
    updateHud();
  }
}

function openChar(){
  const p = G.player;
  const st = G.stats;
  const ab = CLASSES[p.cls].ability;
  const w = WEAPONS[p.weapon];
  const a = ARMORS[p.armor] || { armor: 0 };
  const html = `
    <div class="charname" style="color:${CLASSES[p.cls].color}">${escapeHtml(p.name)} — Level ${p.lvl} ${CLASSES[p.cls].name}</div>
    <div class="charrow"><span>Health</span><b>${Math.ceil(p.hp)} / ${p.maxHp}</b></div>
    <div class="charrow"><span>Mana</span><b>${Math.ceil(p.mp)} / ${p.maxMp}</b></div>
    <div class="charrow"><span>Experience</span><b>${p.xp} / ${xpToNext(p.lvl)}</b></div>
    <div class="charrow"><span>Gold</span><b>${p.gold}</b></div>
    <div class="charrow"><span>Monsters slain</span><b>${G.kills}</b></div>
    <div class="stats">
      <div><label>STR</label><b>${st.str}</b><div class="statbar"><i style="width:${Math.min(100, st.str / 18 * 100)}%"></i></div></div>
      <div><label>DEX</label><b>${st.dex}</b><div class="statbar"><i style="width:${Math.min(100, st.dex / 18 * 100)}%"></i></div></div>
      <div><label>INT</label><b>${st.int}</b><div class="statbar"><i style="width:${Math.min(100, st.int / 18 * 100)}%"></i></div></div>
      <div><label>SPI</label><b>${st.spi}</b><div class="statbar"><i style="width:${Math.min(100, st.spi / 18 * 100)}%"></i></div></div>
    </div>
    <div class="charrow"><span>Weapon</span><b>${w.icon} ${w.name} (${w.dmg[0]}–${w.dmg[1]})</b></div>
    <div class="charrow"><span>Armor</span><b>${a.icon || '🛡️'} ${a.name} (${a.armor})</b></div>
    <div class="charrow"><span>Ability</span><b>${ab.icon} ${ab.name} — ${ab.desc}</b></div>
    <div class="charfoot">The Realm remembers your deeds, ${escapeHtml(p.name)}.</div>`;
  $('charBody').innerHTML = html;
  $('charModal').hidden = false;
  $('bagModal').hidden = true;
}

/* ---------------- main loop ---------------- */

function update(dt){
  G.time += dt;
  if (!G.inGame || !G.player) return;
  updateMove(dt);
  updateAttack(dt);
  updateMonsters(dt);
  updateProjectiles(dt);
  updateFx(dt);
  updateRemote(dt);
  if (G.respawnTimer !== undefined){
    G.respawnTimer -= dt;
    $('deathCount').textContent = Math.max(0, Math.ceil(G.respawnTimer));
    if (G.respawnTimer <= 0){
      G.respawnTimer = undefined;
      respawn();
    }
  }
  const p = G.player;
  if (!p.dead){
    G.cam.x += (p.x - G.cam.x) * Math.min(1, dt * 5);
    G.cam.y += (p.y - G.cam.y) * Math.min(1, dt * 5);
    clampCam();
  }
  if (G.net) G.net.sendPos(p.x, p.y, p.lvl);
  updateHud();
  updateMusic();
}

function clampCam(){
  const z = G.cam.zoom;
  const halfW = renderer.w / (2 * TW * z);
  const halfH = renderer.h / (2 * TH * z);
  G.cam.x = Math.max(halfW, Math.min(N - halfW, G.cam.x));
  G.cam.y = Math.max(halfH, Math.min(N - halfH, G.cam.y));
}

let lastT = performance.now();
function loop(t){
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  update(dt);
  if (G.inGame && renderer){
    G.cam.zoom = renderer.computeZoom();
    renderer.render(G);
    if (G.miniTimer <= 0){
      G.miniTimer = 0.35;
      renderer.drawMini(G);
    } else G.miniTimer -= dt;
  }
  requestAnimationFrame(loop);
}

/* ---------------- screens ---------------- */

function setupScreens(){
  $('enterBtn').addEventListener('click', () => {
    $('titleScreen').hidden = true;
    $('createScreen').hidden = false;
    buildClassCards();
  });

  $('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') tryCreate();
  });
  $('createBtn').addEventListener('click', tryCreate);
  $('nameInput').addEventListener('input', () => {
    const v = $('nameInput').value;
    if (v.length > 16) $('nameInput').value = v.slice(0, 16);
  });

  $('respawnBtn').addEventListener('click', () => {
    G.respawnTimer = 0.2;
  });

  $('bagBtn').addEventListener('click', openBag);
  $('charBtn').addEventListener('click', openChar);
  $('bagCloseBtn').addEventListener('click', closeModals);
  $('charCloseBtn').addEventListener('click', closeModals);
  $('attackBtn').addEventListener('click', () => arm('attack'));
  $('abilityBtn').addEventListener('click', () => arm('ability'));
  $('soundBtn').addEventListener('click', toggleSound);

  window.addEventListener('resize', () => { if (renderer) renderer.resize(); });
}

const CLASS_ICONS = {
  warrior: '⚔️', rogue: '🗡️', wizard: '🔮', cleric: '✚', monk: '👊', druid: '🌿',
};

let selectedClass = 'warrior';

function buildClassCards(){
  const list = $('classList');
  list.innerHTML = '';
  for (const key of Object.keys(CLASSES)){
    const cd = CLASSES[key];
    const card = document.createElement('div');
    card.className = 'classcard' + (key === selectedClass ? ' sel' : '');
    card.dataset.cls = key;
    card.innerHTML = `
      <div class="ccicon" style="background:${cd.color}22;border-color:${cd.color}">${CLASS_ICONS[key]}</div>
      <div class="ccname" style="color:${cd.color}">${cd.name}</div>
      <div class="ccstats">
        <span>STR ${cd.str}</span><span>DEX ${cd.dex}</span><span>INT ${cd.int}</span><span>SPI ${cd.spi}</span>
      </div>
      <div class="ccdesc">${cd.desc}</div>
    `;
    card.onclick = () => {
      selectedClass = key;
      buildClassCards();
    };
    list.appendChild(card);
  }
}

function tryCreate(){
  const name = $('nameInput').value.trim();
  if (!name){
    toast('Give your hero a name', '#ff8080');
    return;
  }
  if (name.length < 2){
    toast('Name must be at least 2 characters', '#ff8080');
    return;
  }
  startGame(name, selectedClass);
}

function startGame(name, cls){
  initWorld();
  createPlayer(name, cls);
  G.remote = [];
  G.remoteMap.clear();
  G.inGame = true;
  G.online = 0;
  $('createScreen').hidden = true;
  $('titleScreen').hidden = true;
  $('gameScreen').hidden = false;
  $('deathOverlay').hidden = true;
  addSysChat(`Welcome to the Realm, ${escapeHtml(name)}. The lands beyond the walls grow restless…`, '#e8d287');
  addSysChat('Tip: click to move, click a monster to attack, click a button on the bar to arm abilities. Chat with Enter.', '#9ad7ff');
  const joined = G.net.join({ name, cls, lvl: 1, x: 48, y: 53 });
  joined.then(ok => {
    if (!ok) addSysChat('(Offline — you are exploring alone.)', '#9ad7ff');
    updateOnlineLabel();
  });
  buildHotbar(cls);
  updateHud();
  setupMusic();
  updateMusic();
}

function buildHotbar(cls){
  const ab = CLASSES[cls].ability;
  $('abilityBtn').innerHTML = `${ab.icon} <span id="abilityNameLbl">${ab.name}</span><span id="abilityCostLbl" class="cost">${ab.cost} MP</span>`;
  $('abilityBtn').title = ab.desc;
  $('abilityNameLbl').style.fontSize = '10px';
}

/* ---------------- sound ---------------- */

const MUSIC = {
  town: 'https://user.uploads.dev/file/df2942a4a28e53c56196008180077fa1.mp3',
  wild: 'https://user.uploads.dev/file/50334c67c4400797ccc03f9592ae049d.mp3',
};

let soundOn = true;
const music = { region: null, audio: null, fade: null };

function setupMusic(){
  $('bgmTown').src = MUSIC.town;
  $('bgmWild').src = MUSIC.wild;
  $('bgmTown').volume = 0;
  $('bgmWild').volume = 0;
  music.region = null;
}

function updateMusic(){
  const p = G.player;
  if (!p || !G.inGame || p.dead) return;
  const region = isInTown(p.x, p.y) ? 'town' : 'wild';
  if (region === music.region && music.audio) return;
  const prev = music.audio;
  const au = region === 'town' ? $('bgmTown') : $('bgmWild');
  music.region = region;
  music.audio = au;
  const target = soundOn ? 0.5 : 0;
  au.volume = 0;
  au.play().catch(() => {});
  if (music.fade) clearInterval(music.fade);
  music.fade = setInterval(() => {
    au.volume = Math.min(target, au.volume + 0.05);
    if (prev && prev !== au) prev.volume = Math.max(0, prev.volume - 0.05);
    if (au.volume >= target){
      clearInterval(music.fade);
      music.fade = null;
      if (prev && prev !== au) prev.pause();
    }
  }, 100);
}

function toggleSound(){
  soundOn = !soundOn;
  if (soundOn){
    music.region = null;
    updateMusic();
  } else {
    if (music.audio) music.audio.volume = 0;
  }
  $('soundBtn').textContent = soundOn ? '🔊' : '🔇';
}

/* ---------------- boot ---------------- */

function init(){
  renderer = new Renderer($('gameCanvas'), $('minimap'));
  window.__realm.setRenderer(renderer);
  setupScreens();
  setupInput();
  setupNet();
  $('onlineTxt').textContent = 'Connecting to the Realm…';
  requestAnimationFrame(loop);
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else init();
