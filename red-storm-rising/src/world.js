import { CLASSES, WEAPONS, REPAIR_RATE, DECOY_COUNT, NOISEMAKER_COUNT } from './data.js';

export const DR = Math.PI / 180;
export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function randn() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function flavorList(name, fallback) {
  try { const l = window[name]; if (l && l.selectOne) return l.selectOne.evaluateItem; } catch (e) { }
  return pick(fallback);
}
export function moveToward(v, cmd, step) { if (v < cmd) return Math.min(cmd, v + step); if (v > cmd) return Math.max(cmd, v - step); return v; }
export function normalizeDeg(h) { h = h % 360; if (h < 0) h += 360; return h; }
export function relCourse(h) { let d = normalizeDeg(h); if (d > 180) d -= 360; return d; }
export function turnToward(h, target, rate) { return normalizeDeg(h + clamp(relCourse(target - h), -rate, rate)); }
export function bearingDeg(a, b) { return normalizeDeg(Math.atan2(b.x - a.x, b.y - a.y) / DR); }
export function rangeNm(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function offsetPos(x, y, bearing, dist) { return { x: x + Math.sin(bearing * DR) * dist, y: y + Math.cos(bearing * DR) * dist }; }

let _pid = 1;
export function makePlatform(cls, opts = {}) {
  const c = CLASSES[cls];
  const p = {
    id: 'p' + (_pid++), cls, name: opts.name || c.name, side: c.side, kind: c.kind,
    x: opts.x ?? rand(-3, 3), y: opts.y ?? rand(-3, 3),
    heading: opts.heading ?? rand(0, 360), headingCmd: null,
    speed: opts.speed ?? c.maxSpeed * 0.5, speedCmd: null,
    depth: opts.depth ?? (c.kind === 'sub' ? 180 : 0), depthCmd: null,
    maxSpeed: c.maxSpeed, turnRate: c.turnRate, maxAccel: c.maxAccel, maxDepth: c.maxDepth || 350,
    baseNoise: c.baseNoise, noisePerKnot: c.noisePerKnot, noise: 10, silent: false,
    hull: 100, flooding: 0, fire: 0, sinking: false, sinkT: 0, reported: false,
    activeRange: c.activeRange || 0, sonar: !!c.sonar,
    loads: { ...(c.loads || {}) },
    helos: c.helos || 0, radar: !!c.radar, reflect: c.reflect ?? 1,
    maxDepthRate: c.kind === 'sub' ? 90 : 0,
    systems: { sonar: 100, propulsion: 100, steering: 100, weapons: 100, hull: 100 },
    repairTeams: 2, value: c.value || 0, lengthNm: c.lengthNm || 0.02,
    ai: opts.ai || { mode: 'transit' }, isPlayer: !!opts.isPlayer,
    decoys: DECOY_COUNT, noisemakers: NOISEMAKER_COUNT, decoyActive: null, noisemakerActive: null,
    lastPingT: 0, escortReported: false,
    visualT: 0, esm: null,
  };
  p.speedCmd = p.speed; p.depthCmd = p.depth; p.headingCmd = p.heading;
  return p;
}

function tubeInit(p) {
  const c = CLASSES[p.cls];
  if (!c.tubes) return null;
  const first = Object.keys(p.loads)[0] || null;
  return Array.from({ length: c.tubes }, (_, i) => ({ idx: i, weapon: first, count: p.loads[first] || 0, ready: true, reloadT: 0 }));
}

export class World {
  constructor(mission, opts = {}) {
    this.t = 0;
    this.mission = mission;
    this.platforms = [];
    this.weapons = [];
    this.effects = [];
    this.log = [];
    this.contacts = new Map();
    this.groups = [];
    this.sea = { factor: rand(0.78, 1.22), visibility: rand(0.25, 1), daylight: true };
    this.over = false; this.overType = null;
    this.missionStats = { tonnage: 0, sunk: [], launched: 0, pings: 0 };
    this.nextContactNum = 1;
    this.heloCount = 0;
    this.debug = opts.debug || {};
  }

  addLog(text, type = 'info') {
    this.log.push({ t: this.t, text, type });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  addEffect(type, x, y, opts = {}) {
    this.effects.push({ type, x, y, t0: this.t, dur: opts.dur ?? 3, ...opts });
    if (this.effects.length > 200) this.effects.splice(0, this.effects.length - 200);
  }

  clock() {
    const d = Math.floor(this.t / 86400) + 1;
    const s = this.t % 86400;
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(Math.floor(s % 60)).padStart(2, '0');
    return `DAY ${d}  ${hh}:${mm}:${ss}`;
  }

  spawn(platform) {
    platform.tubes = tubeInit(platform);
    this.platforms.push(platform);
    return platform;
  }

  setupPlayer(p) {
    this.player = p;
    this.spawn(p);
  }

  makeFormation(leader, members) {
    const g = { leaderId: leader.id, course: leader.headingCmd ?? leader.heading, speed: leader.speed, members: [] };
    for (const m of members) {
      const offB = rand(0, 360), offR = m.offR ?? rand(1.5, 3);
      g.members.push({ id: m.id, offB, offR });
      m.ai.form = { leaderId: leader.id, offB, offR };
      m.ai.mode = 'formation';
    }
    this.groups.push(g);
  }

  step(dt) {
    if (this.over) return;
    let remaining = dt;
    while (remaining > 0) {
      const s = Math.min(remaining, 5);
      this.stepSub(s);
      remaining -= s;
    }
  }

  stepSub(dt) {
    this.t += dt;
    for (const p of this.platforms) {
      if (p.sinking) { this.stepSinking(p, dt); continue; }
      this.computeNoise(p);
      this.stepPlatform(p, dt);
      this.stepAI(p, dt);
    }
    this.maybeRadio(dt);
    this.updatePlayerSonar(dt);
    this.updatePlayerVisual(dt);
    this.updateEnemySonar(dt);
    this.updateESM(dt);
    this.stepWeapons(dt);
    this.cleanup(dt);
    this.checkEnd();
  }

  maybeRadio(dt) {
    if (Math.random() < dt / 90000) {
      this.addLog(flavorList('radioChatter', [
        '(unintelligible Russian HF traffic)',
        '— K-414 to Group: sonar contact, bearing 210. Possible submarine.',
        '— Comrade Admiral, orders to increase speed to 22 knots.',
        '(distant sonar transducer ping)',
        '— Watch your datum, the screen is thin tonight.',
      ]), 'radio');
    }
  }

  computeNoise(p) {
    let n = p.baseNoise + p.noisePerKnot * p.speed;
    if (p.silent) n *= 0.5;
    if (p.fire > 0) n *= 1.6;
    if (p.systems.propulsion < 40) n *= 1.8;
    if (p.sinking) n *= 0.4;
    p.noise = n;
    if (p.isPlayer) p.selfNoise = (p.silent ? 2 : 0) + p.speed * 0.35 + (p.systems.propulsion < 40 ? 4 : 0) + 3;
    else p.selfNoise = 3 + p.speed * 0.35;
  }

  stepPlatform(p, dt) {
    p.speed = moveToward(p.speed, p.speedCmd, p.maxAccel * dt / 60);
    if (p.kind === 'sub') p.speed = Math.min(p.speed, p.maxSpeed * (p.systems.propulsion < 40 ? 0.45 : 1));
    p.speed = Math.max(0, p.speed);
    if (p.headingCmd != null) {
      const tr = p.turnRate * (p.systems.steering < 40 ? 0.3 : 1);
      p.heading = turnToward(p.heading, p.headingCmd, tr * dt);
    }
    p.x += Math.sin(p.heading * DR) * p.speed * dt / 3600;
    p.y += Math.cos(p.heading * DR) * p.speed * dt / 3600;
    if (p.kind === 'sub' && p.depthCmd != null) {
      p.depth = clamp(moveToward(p.depth, p.depthCmd, p.maxDepthRate * dt / 60), 8, p.maxDepth);
      p.depth = Math.max(p.depth, 6);
    }
  }

  stepSinking(p, dt) {
    p.sinkT += dt;
    p.speed = moveToward(p.speed, 0, 2 * dt / 60);
    if (p.sinkT > 2) this.addEffect('explosion', p.x, p.y, { dur: 4, big: true });
    if (p.sinkT > 150 || (p.kind === 'sub' && p.sinkT > 80)) {
      this.platforms = this.platforms.filter(q => q !== p);
      this.contacts.delete(p.id);
    }
  }

  stepAI(p, dt) {
    const ai = p.ai;
    if (ai.form && ai.mode === 'formation') {
      const leader = this.getById(ai.form.leaderId);
      if (leader && !leader.sinking) {
        const target = offsetPos(leader.x, leader.y, leader.heading + ai.form.offB, ai.form.offR);
        const d = rangeNm(p, { x: target.x, y: target.y });
        if (d > 0.4) p.headingCmd = bearingDeg(p, target);
        p.speedCmd = Math.min(leader.speedCmd, p.maxSpeed);
        p.depthCmd = 0; p.depth = 0;
        return;
      }
    }
    if (p.kind === 'surface') this.stepSurfaceAI(p, dt);
    else if (p.kind === 'sub') this.stepSubAI(p, dt);
    else if (p.kind === 'air') this.stepHeloAI(p, dt);
    else if (p.kind === 'buoy') this.stepBuoy(p, dt);
  }

  getById(id) { return this.platforms.find(q => q.id === id); }

  enemyPlatforms() { return this.platforms.filter(q => !q.isPlayer && q.side === 'sov' && !q.sinking); }

  datumFor(p) {
    if (!p.ai.datum) return null;
    const age = this.t - p.ai.datum.t;
    return age < 1800 ? p.ai.datum : null;
  }

  stepSurfaceAI(p, dt) {
    const ai = p.ai;
    if (ai.mode === 'alert' || ai.mode === 'asw') { this.stepASWShip(p, dt); return; }
    if (ai.mode === 'evade') { this.stepEvade(p, dt); return; }
    if (ai.mode === 'transit' || ai.mode === 'sag') {
      p.headingCmd = ai.course;
      p.speedCmd = ai.speed;
    }
    const datum = this.datumFor(p);
    const pl = this.player;
    if (datum) {
      const d = Math.hypot(datum.x - p.x, datum.y - p.y);
      if (d < 24 && p.sonar && (p.activeRange > 0 || p.helos > 0)) {
        ai.mode = 'alert';
        ai.alertT = this.t;
        p.speedCmd = Math.min(25, p.maxSpeed);
        return;
      }
    }
    if (ai.mode === 'alert' && this.t - (ai.alertT || 0) > 1500 && !this.datumFor(p)) { ai.mode = 'sag'; }
  }

  enemyActiveRange(e, pl) {
    let r = e.activeRange;
    if (pl.depth > 150) r *= 0.8;
    if (pl.depth > 250) r *= 0.55;
    if (pl.depth > 350) r *= 0.35;
    return r;
  }

  stepASWShip(p, dt) {
    const ai = p.ai;
    const datum = this.datumFor(p);
    const pl = this.player;
    if (!datum) {
      if (ai.mode === 'asw') ai.mode = 'sag';
      if (ai.mode === 'alert') { ai.mode = 'sag'; ai.heloOut = false; }
      return;
    }
    if (p.helos > 0 && !ai.heloOut && this.t > (ai.heloLaunchT || 0)) {
      ai.heloLaunchT = this.t + 1800;
      ai.heloOut = true;
      this.launchHelo(p, datum);
    }
    p.speedCmd = Math.min(25, p.maxSpeed);
    p.headingCmd = bearingDeg(p, { x: datum.x, y: datum.y });
    if (p.activeRange > 0) p.activeSonar = true; else p.activeSonar = false;
    if (this.t - (ai.lastPingT || 0) > 30 && p.activeRange > 0) {
      ai.lastPingT = this.t;
      p.lastPingT = this.t;
      this.addEffect('ping', p.x, p.y, { dur: 6, scale: p.activeRange });
      if (rangeNm(p, pl) < 28) {
        this.addLog(`[SONAR] ENEMY ACTIVE SONAR — bearing ${String(Math.round(bearingDeg(this.player, p))).padStart(3, '0')}`, 'sonar');
      }
      if (rangeNm(p, pl) < this.enemyActiveRange(p, pl) && !pl.sinking) {
        const err = rand(0.1, 0.4);
        this.giveDatum(p, { x: pl.x + randn() * err, y: pl.y + randn() * err, t: this.t, why: 'ACTIVE SONAR' });
        if (!p.escortReported) { this.addLog(`[SONAR] ACTIVE ECHO — probable submarine bearing ${String(Math.round(bearingDeg(p, pl))).padStart(3, '0')}`, 'radio'); p.escortReported = true; }
        p.ai.lastFresh = this.t;
      }
    }
    const dPl = rangeNm(p, pl);
    const fresh = this.t - datum.t < 300;
    const cap = this.enemyTorpsTargetingPlayer() < 2;
    if (fresh && dPl < 11 && p.loads.ssn15 > 0 && this.t > (ai.aswFireT || 0) && cap) {
      ai.aswFireT = this.t + 360;
      p.loads.ssn15--;
      this.fireMissile(p, 'ssn15', datum, pl.depth > 150 ? 250 : pl.depth + 40);
      this.addLog(`[CONTACT] ${p.name} — WEAPON LAUNCH SIGNATURE BEARING ${String(Math.round(bearingDeg(p, pl))).padStart(3, '0')}`, 'danger');
    }
    if (fresh && dPl < 9 && p.loads.silex > 0 && this.t > (ai.aswFireT || 0) && cap) {
      ai.aswFireT = this.t + 360;
      p.loads.silex--;
      this.fireMissile(p, 'silex', datum, pl.depth + 40);
      this.addLog(`[CONTACT] ${p.name} — WEAPON LAUNCH SIGNATURE BEARING ${String(Math.round(bearingDeg(p, pl))).padStart(3, '0')}`, 'danger');
    }
    if (fresh && dPl < 2.6 && p.loads.rbu > 0 && pl.depth < 220 && this.t > (ai.rbuT || 0)) {
      ai.rbuT = this.t + 90;
      for (let i = 0; i < 3 && p.loads.rbu > 0; i++) { p.loads.rbu--; this.fireRocket(p, 'rbu', datum); }
      this.addLog(`[CONTACT] RBU VOLLEY — MASSIVE TURBULENCE BEARING ${String(Math.round(bearingDeg(p, pl))).padStart(3, '0')}`, 'danger');
    }
    const torps = this.weapons.filter(w => w.type === 'mk48' || w.type === 'harpoon');
    const incoming = torps.find(w => rangeNm({ x: w.x, y: w.y }, p) < 2.2);
    if (incoming && ai.mode !== 'evade') {
      ai.mode = 'evade'; ai.evadeT = this.t;
      this.addLog(`[ALERT] ${p.name} — TORPEDO CONTACT!`, 'radio');
    }
  }

  stepEvade(p, dt) {
    const ai = p.ai;
    if (p.noisemakers > 0 && p.kind === 'surface' && this.t > (ai.nmT || 0)) {
      ai.nmT = this.t + 30;
      p.noisemakers--;
      const np = this.spawn(makePlatform('buoy', { x: p.x, y: p.y }));
      np.isNoisemaker = true; np.lifeT = this.t + 300;
      this.addEffect('decoy', p.x, p.y, { dur: 6 });
    }
    p.speedCmd = p.maxSpeed;
    const torps = this.weapons.filter(w => w.type === 'mk48' || w.type === 'harpoon');
    const closest = torps.reduce((a, b) => (rangeNm({ x: a.x, y: a.y }, p) < rangeNm({ x: b.x, y: b.y }, p) ? a : b), torps[0]);
    if (closest) {
      const away = bearingDeg(p, { x: p.x + Math.sin((bearingDeg(p, { x: closest.x, y: closest.y }) + 180) * DR), y: p.y + Math.cos((bearingDeg(p, { x: closest.x, y: closest.y }) + 180) * DR) });
      p.headingCmd = away + (Math.random() < 0.5 ? -35 : 35);
    } else {
      p.headingCmd = ai.course;
    }
    if (this.t - (ai.evadeT || 0) > 420) ai.mode = 'sag';
  }

  launchHelo(fromShip, datum) {
    const h = this.spawn(makePlatform('ka27', { x: fromShip.x, y: fromShip.y, heading: bearingDeg(fromShip, datum), speed: 80 }));
    h.ai = { mode: 'heloASW', datum: { ...datum }, buoysDropped: 0, parentId: fromShip.id, base: { x: fromShip.x, y: fromShip.y } };
    h.speedCmd = 80;
    this.heloCount++;
    this.addLog(`[RADIO] HELO LAUNCH DETECTED — rotor noise bearing ${String(Math.round(bearingDeg(this.player, h))).padStart(3, '0')}`, 'radio');
  }

  stepHeloAI(p, dt) {
    const ai = p.ai;
    if (ai.mode === 'return') {
      p.headingCmd = bearingDeg(p, ai.base); p.speedCmd = 80;
      if (rangeNm(p, ai.base) < 1) { p.ai.mode = 'done'; }
      return;
    }
    const datum = this.datumFor(p);
    const pl = this.player;
    p.speedCmd = 80;
    if (datum) {
      const d = rangeNm(p, datum);
      if (d > 1.2) {
        p.headingCmd = bearingDeg(p, datum);
      } else {
        p.speedCmd = 0;
        if (ai.buoysDropped < 8 && this.t > (ai.buoyT || 0)) {
          ai.buoyT = this.t + 20;
          ai.buoysDropped++;
          const b = this.spawn(makePlatform('buoy', { x: datum.x + rand(-0.7, 0.7), y: datum.y + rand(-0.7, 0.7) }));
          b.ai = { mode: 'buoy', lifeT: this.t + 7200 };
          b.isBuoy = true;
          this.addEffect('splash', b.x, b.y, { dur: 5 });
        }
        if (p.loads.lwt > 0 && rangeNm(p, pl) < 1.4 && pl.depth < 140 && this.t > (ai.lwtT || 0)) {
          ai.lwtT = this.t + 180;
          p.loads.lwt--;
          this.fireTorpedo(p, 'lwt', { x: pl.x, y: pl.y }, pl.depth, pl.id);
          this.addLog('[CONTACT] SPLASH — WEAPON IN THE WATER NEARBY!', 'danger');
        }
      }
    } else {
      p.headingCmd = bearingDeg(p, ai.base); p.speedCmd = 80;
      if (rangeNm(p, ai.base) < 1.5) { ai.mode = 'return'; }
    }
    if (this.buoyDetectsPlayer(p)) {
      this.giveDatum(p, { x: pl.x + randn() * 0.3, y: pl.y + randn() * 0.3, t: this.t, why: 'HELO DF' });
    }
  }

  buoyDetectsPlayer(helo) {
    const pl = this.player;
    if (rangeNm(helo, pl) < 0.5) return pl.noise > 8;
    return false;
  }

  stepBuoy(p, dt) {
    if (!p.isBuoy && !p.isNoisemaker) { p.lifeT = p.lifeT || this.t + 7200; }
    if (p.lifeT && this.t > p.lifeT) {
      this.platforms = this.platforms.filter(q => q !== p);
      return;
    }
    if (p.isNoisemaker) {
      const torps = this.weapons.filter(w => w.kind === 'torpedo' && (w.type === 't53' || w.seekingNoise));
      for (const t of torps) {
        if (rangeNm({ x: t.x, y: t.y }, p) < 1.2 && !t.targetIsNoisemaker) {
          t.targetIsNoisemaker = p.id;
          this.addLog('[SONAR] TORPEDO HOMING SIGNAL — turning away from us.', 'info');
        }
      }
    }
    if (p.isBuoy) {
      const pl = this.player;
      const detect = passiveDetectRange(pl, { selfNoise: 3 }, this.sea);
      if (rangeNm(p, pl) < detect && !pl.sinking) {
        this.giveDatumAll({ x: pl.x + randn() * 0.4, y: pl.y + randn() * 0.4, t: this.t, why: 'SONOBUOY' });
      }
    }
  }

  giveDatum(platform, datum) {
    platform.ai.datum = { x: datum.x, y: datum.y, t: datum.t, why: datum.why };
    platform.ai.alertT = this.t;
    if (platform.ai.mode === 'sag' || platform.ai.mode === 'transit' || platform.ai.mode === 'formation') {
      platform.ai.mode = 'alert';
    }
  }

  giveDatumAll(datum) {
    for (const p of this.enemyPlatforms()) {
      if (p.kind === 'air' || p.kind === 'buoy') continue;
      this.giveDatum(p, datum);
    }
  }

  stepSubAI(p, dt) {
    const ai = p.ai;
    if (ai.mode === 'evade') { this.stepSubEvade(p, dt); return; }
    const datum = this.datumFor(p);
    const pl = this.player;
    if (datum && !this.anyIncomingTorp(p)) {
      ai.mode = 'attack';
      const d = Math.hypot(datum.x - p.x, datum.y - p.y);
      p.headingCmd = bearingDeg(p, { x: datum.x, y: datum.y });
      p.speedCmd = Math.min(24, p.maxSpeed);
      if (p.activeRange > 0 && this.t - (ai.lastPingT || 0) > 45) {
        ai.lastPingT = this.t;
        this.addEffect('ping', p.x, p.y, { dur: 6, scale: p.activeRange });
        if (rangeNm(p, pl) < this.enemyActiveRange(p, pl)) {
          this.giveDatum(p, { x: pl.x + randn() * 0.3, y: pl.y + randn() * 0.3, t: this.t, why: 'ACTIVE SONAR' });
          this.addLog(`[SONAR] ENEMY ACTIVE SONAR — bearing ${String(Math.round(bearingDeg(this.player, p))).padStart(3, '0')}`, 'sonar');
        }
      }
      if (d < 8.5 && p.loads.set65 > 0 && this.t > (ai.fireT || 0) && pl.depth < 420 && this.enemyTorpsTargetingPlayer() < 2) {
        ai.fireT = this.t + 240;
        p.loads.set65--;
        this.fireTorpedo(p, 'set65', { x: datum.x, y: datum.y }, clamp(pl.depth, 20, 300), pl.id);
        this.addLog(`[SONAR] WEAPON LAUNCH — tube open, bearing ${String(Math.round(bearingDeg(this.player, p))).padStart(3, '0')}!`, 'danger');
      }
      if (d < 5 && p.loads.t53 > 0 && this.t > (ai.fireT || 0) && this.enemyTorpsTargetingPlayer() < 2) {
        ai.fireT = this.t + 240;
        p.loads.t53--;
        this.fireTorpedo(p, 't53', { x: pl.x, y: pl.y }, 10, pl.id);
        this.addLog(`[SONAR] WEAPON LAUNCH — bearing ${String(Math.round(bearingDeg(this.player, p))).padStart(3, '0')}!`, 'danger');
      }
      if (this.t - (ai.attackT || this.t) > 900 && !this.datumFor(p)) { ai.mode = 'patrol'; }
    } else {
      if (ai.mode === 'attack') { ai.mode = 'patrol'; }
      if (ai.mode === 'patrol') {
        if (!ai.patrolPt) { ai.patrolPt = { x: p.x + rand(-6, 6), y: p.y + rand(-6, 6) }; }
        const d = rangeNm(p, ai.patrolPt);
        p.headingCmd = bearingDeg(p, ai.patrolPt);
        p.speedCmd = d < 0.8 ? (p.speed = moveToward(p.speed, 0, 1 * dt / 60), 0) : 10;
        if (d < 0.8) ai.patrolPt = { x: p.x + rand(-8, 8), y: p.y + rand(-8, 8) };
      } else if (ai.mode === 'transit') {
        p.headingCmd = ai.course; p.speedCmd = ai.speed;
      }
    }
    const torps = this.weapons.filter(w => w.type === 'mk48');
    const incoming = torps.find(w => rangeNm({ x: w.x, y: w.y }, p) < 2.0);
    if (incoming && ai.mode !== 'evade') {
      ai.mode = 'evade'; ai.evadeT = this.t;
      this.addLog(`[ALERT] TORPEDO IN THE WATER — bearing ${String(Math.round(bearingDeg(this.player, p))).padStart(3, '0')}`, 'danger');
    }
  }

  anyIncomingTorp(p) {
    return this.weapons.some(w => (w.type === 'mk48' || w.type === 'set65' || w.type === 'lwt') && rangeNm({ x: w.x, y: w.y }, p) < 2.5);
  }

  enemyTorpsTargetingPlayer() {
    const pid = this.player.id;
    return this.weapons.filter(w => w.side === 'sov' && w.kind === 'torpedo' && (w.targetId === pid || (w.datumX != null && rangeNm({ x: w.x, y: w.y }, this.player) < 0.5))).length;
  }

  stepSubEvade(p, dt) {
    const ai = p.ai;
    p.speedCmd = Math.min(p.maxSpeed * 0.95, 30);
    if (p.depthCmd == null || p.depthCmd < 200) p.depthCmd = Math.min(340, p.maxDepth);
    const torps = this.weapons.filter(w => w.type === 'mk48' || w.type === 'lwt');
    const closest = torps.reduce((a, b) => (rangeNm({ x: a.x, y: a.y }, p) < rangeNm({ x: b.x, y: b.y }, p) ? a : b), torps[0]);
    if (closest) p.headingCmd = bearingDeg(p, { x: closest.x, y: closest.y }) + 180 + (Math.random() < 0.5 ? -30 : 30);
    if (this.t - (ai.evadeT || 0) > 600) { ai.mode = 'patrol'; ai.patrolPt = null; }
  }

  updatePlayerSonar(dt) {
    const pl = this.player;
    if (pl.systems.sonar < 25) { this.contacts.clear(); return; }
    for (const t of this.platforms) {
      if (t === pl || t.sinking || (t.kind === 'air' && t.ai.mode === 'done') || t.kind === 'buoy') continue;
      const r = rangeNm(pl, t);
      const dr = passiveDetectRange(t, pl, this.sea);
      if (r < dr) {
        let c = this.contacts.get(t.id);
        if (!c) {
          c = {
            num: this.nextContactNum++, targetId: t.id, bearing: 0, bearingErr: 6,
            range: rand(8, 30), rangeErr: 25, speed: 0, speedErr: 8,
            suspect: 'UNKNOWN', q: 0, lastNoise: t.noise, history: [], lastFixT: this.t,
            rate: 0, prevBearing: null, lastUpdateT: null,
          };
          this.contacts.set(t.id, c);
          this.addLog(`[SONAR] NEW CONTACT — bearing ${String(Math.round(bearingDeg(pl, t))).padStart(3, '0')}`, 'sonar');
        }
        this.updateContact(c, t, dt, 0);
      } else {
        const c = this.contacts.get(t.id);
        if (c) {
          if (this.t - (c.lastFixT || 0) > 600) { this.contacts.delete(t.id); }
          else { c.q = Math.max(0, c.q - dt / 900); }
        }
      }
    }
    for (const [id, c] of this.contacts) {
      if (!this.getById(id) || this.getById(id).sinking) this.contacts.delete(id);
    }
  }

  updateContact(c, t, dt, bonus) {
    const pl = this.player;
    const trueBrg = bearingDeg(pl, t);
    c.q = Math.min(1, c.q + dt / 150 + bonus);
    c.bearingErr = Math.max(1, 6 * Math.pow(0.5, c.q * 2.2));
    const err = c.bearingErr * (0.5 + 0.5 * randn());
    c.bearing = normalizeDeg(trueBrg + err);
    c.lastNoise = t.noise;

    const now = this.t;
    const dtSec = c.lastUpdateT ? Math.max(0.1, now - c.lastUpdateT) : 1;
    c.lastUpdateT = now;
    const dTheta = relCourse(c.bearing - (c.prevBearing != null ? c.prevBearing : c.bearing));
    c.prevBearing = c.bearing;
    const instRate = dTheta / dtSec;
    const alpha = 1 - Math.exp(-dtSec / 90);
    c.rate = (c.rate || 0) + (instRate - (c.rate || 0)) * alpha;
    const omega = Math.abs(c.rate) * DR;
    if (omega > 2e-5) {
      const relPerp = this.targetSpeedGuess(c) / 3600;
      const rRule = relPerp / omega;
      const gain = (0.008 + 0.05 * c.q) * clamp(dtSec / 60, 0.02, 0.5);
      if (rRule > 0.5 && rRule < 60) c.range = lerp(c.range, rRule, gain);
    }
    c.speed = lerp(c.speed, this.targetSpeedGuess(c), 0.02 * clamp(dtSec / 60, 0.05, 0.4));
    if (c.q > 0.3) {
      const trueR = Math.max(0.8, rangeNm(pl, t));
      const truthGain = 0.0025 * c.q * clamp(dtSec / 60, 0.05, 0.4);
      c.range = lerp(c.range, clamp(trueR, 0.8, 60), truthGain);
    }
    if (now - (c.lastFixT || 0) > 90) {
      c.lastFixT = now;
      c.rangeErr = Math.max(1.5, 28 * Math.pow(0.5, c.q * 3));
      c.speedErr = Math.max(2, 8 * Math.pow(0.5, c.q * 2));
    }
  }

  targetSpeedGuess(c) {
    if (c.suspect === 'MERCHANT') return 14;
    if (c.suspect === 'SURFACE') return 20;
    if (c.suspect === 'SUBMARINE') return 10;
    if (c.suspect === 'SSBN') return 8;
    if (c.suspect === 'AIR') return 40;
    return c.lastNoise > 34 ? 16 : 10;
  }

  updateEnemySonar(dt) {
    const pl = this.player;
    if (pl.sinking) return;
    for (const e of this.enemyPlatforms()) {
      if (e.kind === 'air' || e.kind === 'buoy') continue;
      if (!e.sonar && !e.radar) continue;
      const r = rangeNm(e, pl);
      const dr = passiveDetectRange(pl, e, this.sea);
      if (r < dr && !pl.silent && pl.speed > 1) {
        if (!e.ai.datum || (this.t - e.ai.datum.t) > 90 || rand() < 0.15) {
          this.giveDatum(e, { x: pl.x + randn() * Math.max(0.3, r * 0.08), y: pl.y + randn() * Math.max(0.3, r * 0.08), t: this.t, why: 'PASSIVE SONAR' });
        }
      }
      if (e.radar && pl.depth < 25 && r < 30 && e.ai.mode === 'alert') {
        this.giveDatum(e, { x: pl.x + randn() * 0.5, y: pl.y + randn() * 0.5, t: this.t, why: 'RADAR' });
        if (e.loads.ssn19 > 0 && this.t > (e.ai.missileT || 0) && e.cls !== 'merchant') {
          e.ai.missileT = this.t + 400;
          e.loads.ssn19--;
          this.fireMissile(e, 'ssn19', { x: pl.x, y: pl.y }, 0);
          this.addLog(`[RADAR] ANTI-SHIP MISSILE LAUNCH — bearing ${String(Math.round(bearingDeg(pl, e))).padStart(3, '0')}!`, 'danger');
        }
      }
    }
  }

  updateESM(dt) {
    for (const e of this.enemyPlatforms()) {
      if (e.kind === 'air' || e.kind === 'buoy') continue;
      if (e.radar && e.ai.mode === 'alert') {
        const brg = bearingDeg(this.player, e);
        if (!this.player.esm || this.t - this.player.esmT > 300) {
          this.player.esm = { brg, type: 'RADAR' };
          this.player.esmT = this.t;
          const c = this.contacts.get(e.id);
          if (!c) {
            const c2 = { num: this.nextContactNum++, targetId: e.id, bearing: brg, bearingErr: 8, range: 0, rangeErr: 99, speed: 0, speedErr: 99, suspect: 'UNKNOWN', q: 0.15, lastNoise: e.noise, history: [], lastFixT: this.t, esm: true };
            this.contacts.set(e.id, c2);
            this.addLog(`[ESM] RADAR EMISSION — bearing ${String(Math.round(brg)).padStart(3, '0')}`, 'sonar');
          }
        }
      }
    }
    this.player.esm = null;
  }

  activePing() {
    const pl = this.player;
    if (this.t - (pl.lastPingT || 0) < 20) return false;
    pl.lastPingT = this.t;
    this.missionStats.pings++;
    this.addEffect('ping', pl.x, pl.y, { dur: 7, scale: pl.activeRange });
    this.addLog('[SONAR] ACTIVE PING OUT', 'sonar');
    for (const t of this.platforms) {
      if (t === pl || t.sinking) continue;
      const r = rangeNm(pl, t);
      if (r < pl.activeRange && (t.kind !== 'air' || t.ai.mode === 'done') && t.kind !== 'buoy') {
        let c = this.contacts.get(t.id);
        if (!c) {
          c = { num: this.nextContactNum++, targetId: t.id, bearing: bearingDeg(pl, t), bearingErr: 1, range: r, rangeErr: 1, speed: 0, speedErr: 4, suspect: 'UNKNOWN', q: 0.5, lastNoise: t.noise, history: [], lastFixT: this.t };
          this.contacts.set(t.id, c);
        }
        c.bearing = bearingDeg(pl, t) + randn() * 0.5;
        c.range = r + randn() * 0.4;
        c.rangeErr = Math.min(c.rangeErr, 1.5);
        c.bearingErr = 1;
        c.q = Math.min(1, c.q + 0.3);
        this.addEffect('pingEcho', c.bearing, r, { dur: 5 });
        this.addLog(`[SONAR] ECHO — contact ${c.num} range ${r.toFixed(1)} nm`, 'sonar');
      }
    }
    this.giveDatumAll({ x: pl.x + randn() * 0.3, y: pl.y + randn() * 0.3, t: this.t, why: 'ACTIVE PING' });
    return true;
  }

  updatePlayerVisual(dt) {
    const pl = this.player;
    if (pl.depth > 25 || !this.sea.daylight || pl.silent) return;
    pl.visualT = (pl.visualT || 0) + dt;
    if (pl.visualT < 40) return;
    pl.visualT = 0;
    const visR = 4 * this.sea.visibility;
    for (const t of this.platforms) {
      if (t === pl || t.sinking || t.kind === 'sub' || t.kind === 'buoy' || (t.kind === 'air' && t.ai.mode !== 'done')) continue;
      const r = rangeNm(pl, t);
      if (r < visR) {
        let c = this.contacts.get(t.id);
        if (!c) {
          c = { num: this.nextContactNum++, targetId: t.id, bearing: bearingDeg(pl, t), bearingErr: 0.5, range: r, rangeErr: 0.3, speed: t.speed, speedErr: 1, suspect: t.cls === 'merchant' ? 'MERCHANT' : 'SURFACE', q: 0.8, lastNoise: t.noise, history: [], lastFixT: this.t };
          this.contacts.set(t.id, c);
          this.addLog(`[VISUAL] PERISCOPE — ${t.name} bearing ${String(Math.round(bearingDeg(pl, t))).padStart(3, '0')}, range ${r.toFixed(1)} nm`, 'sonar');
        } else {
          c.bearing = bearingDeg(pl, t); c.range = r; c.rangeErr = 0.3; c.q = Math.min(1, c.q + 0.4);
        }
      }
    }
  }

  stepWeapons(dt) {
    for (const w of this.weapons) {
      if (w.dead) continue;
      w.px = w.x; w.py = w.y;
      w.age += dt;
      if (w.wire) {
        const launcher = this.getById(w.launcherId);
        if (launcher && rangeNm({ x: w.x, y: w.y }, launcher) > 25) {
          w.wire = false;
          this.addLog('[WEAPONS] WIRE LOST — torpedo autonomous', 'info');
        }
        if (w.wire && w.autoSteer) {
          const t = this.getById(w.targetId);
          if (t && !t.sinking) { w.headingCmd = bearingDeg({ x: w.x, y: w.y }, t); }
        }
      }
      this.stepOneWeapon(w, dt);
    }
    this.weapons = this.weapons.filter(w => !w.dead);
  }

  stepOneWeapon(w, dt) {
    const def = WEAPONS[w.type];
    const moveDist = w.speed * dt / 3600;
    if (w.kind === 'torpedo') {
      w.fuel -= dt;
      if (w.fuel <= 0) { w.dead = true; this.addLog('[WEAPONS] TORPEDO EXHAUSTED', 'info'); return; }
      if (w.headingCmd != null) w.heading = turnToward(w.heading, w.headingCmd, def.turn * dt);
      w.x += Math.sin(w.heading * DR) * moveDist;
      w.y += Math.cos(w.heading * DR) * moveDist;
      if (w.targetId) {
        const t = this.getById(w.targetId);
        if (t && !t.sinking) {
          const r = rangeNm({ x: w.x, y: w.y }, t);
          if (w.state === 'homing') {
            if (w.lockDepth == null) w.lockDepth = t.depth;
            else if (Math.abs(t.depth - w.lockDepth) > 90) {
              w.lockDepth = null; w.state = 'search';
              this.addLog('[WEAPONS] TORPEDO LOST LOCK — target depth change', 'info');
            }
          }
          if (w.state === 'search' || w.state === 'wire') {
            if (this.torpedoAcquires(w, t, r)) { w.state = 'homing'; w.lockDepth = t.depth; this.addLog('[WEAPONS] TORPEDO HOMING — target bearing stable', 'info'); }
          }
          if (w.state === 'homing') {
            let aim = t;
            if (w.type === 't53' && t.kind === 'surface') { aim = this.wakeAimPoint(w, t); }
            else if (t.speed > 0.5) aim = offsetPos(t.x, t.y, t.heading, Math.min(0.5, r * 0.25));
            w.headingCmd = bearingDeg({ x: w.x, y: w.y }, aim);
          }
          if (!w.targetIsNoisemaker) {
            let decoy = this.platforms.find(q => q.isNoisemaker && rangeNm({ x: w.x, y: w.y }, q) < 1.2 && rangeNm({ x: w.x, y: w.y }, q) < r + 1);
            if (!decoy && def.seeker.includes('active')) {
              const ad = this.platforms.find(q => q.isActiveDecoy && rangeNm({ x: w.x, y: w.y }, q) < 1.5);
              if (ad) decoy = ad;
            }
            if (decoy) { w.targetIsNoisemaker = decoy.id; }
          }
          if (w.targetIsNoisemaker) {
            const nm = this.getById(w.targetIsNoisemaker);
            if (nm) {
              w.headingCmd = bearingDeg({ x: w.x, y: w.y }, nm);
              if (rangeNm({ x: w.x, y: w.y }, nm) < 0.06) {
                this.addEffect('explosion', w.x, w.y, { dur: 3 });
                this.platforms = this.platforms.filter(q => q !== nm);
                w.dead = true;
                return;
              }
            } else w.targetIsNoisemaker = null;
          }
          if (r < (t.lengthNm || 0.03) * 0.6 && (w.state === 'homing' || w.state === 'wire')) { this.damagePlatform(t, def.warhead, w); w.dead = true; return; }
        }
      }
      if (w.state === 'search' || w.state === 'wire') {
        if (w.datumX != null) {
          const d = rangeNm({ x: w.x, y: w.y }, { x: w.datumX, y: w.datumY });
          if (d > 1.2) w.headingCmd = bearingDeg({ x: w.x, y: w.y }, { x: w.datumX, y: w.datumY });
          else w.headingCmd = w.heading + 90 + Math.sin(w.age / 4) * 60;
        }
      }
      if (w.depthCmd != null) w.depth = moveToward(w.depth, w.depthCmd, 8 * dt);
      if (w.path.length < 400) w.path.push({ x: w.x, y: w.y });
      else { w.path.shift(); w.path.push({ x: w.x, y: w.y }); }
    } else if (w.kind === 'missile') {
      w.fuel -= dt;
      if (w.fuel <= 0) { w.dead = true; this.addEffect('explosion', w.x, w.y, { dur: 2 }); return; }
      if (w.headingCmd != null) w.heading = turnToward(w.heading, w.headingCmd, def.turn * dt);
      w.x += Math.sin(w.heading * DR) * moveDist;
      w.y += Math.cos(w.heading * DR) * moveDist;
      if (w.state === 'fly') {
        const d = w.datumX != null ? rangeNm({ x: w.x, y: w.y }, { x: w.datumX, y: w.datumY }) : 999;
        if (d < def.terminalRange) {
          const t = this.findNearestSurface(w, def.terminalRange, def.terminalCone);
          if (t) { w.targetId = t.id; w.state = 'homing'; this.addLog(`[CONTACT] MISSILE LOCKED — ${t.name}`, 'danger'); }
        }
        if (d < 0.8) {
          w.dead = true;
          this.addEffect('explosion', w.x, w.y, { dur: 3, big: true });
          const pl = this.player;
          if (rangeNm({ x: w.x, y: w.y }, pl) < 0.3 && pl.depth < 35 && !pl.sinking) {
            this.damagePlayer(def.warhead * 0.45, 'ANTI-SHIP MISSILE');
          }
          return;
        }
      } else if (w.state === 'homing') {
        const t = this.getById(w.targetId);
        if (t && !t.sinking) {
          w.headingCmd = bearingDeg({ x: w.x, y: w.y }, t);
          const r = rangeNm({ x: w.x, y: w.y }, t);
          if (r < (t.lengthNm || 0.03)) { this.damagePlatform(t, def.warhead, w); w.dead = true; return; }
        } else { w.dead = true; return; }
      }
      if (w.path.length < 100) w.path.push({ x: w.x, y: w.y });
      else { w.path.shift(); w.path.push({ x: w.x, y: w.y }); }
    } else if (w.kind === 'rocket') {
      w.fuel -= dt;
      if (w.fuel <= 0) {
        if (def.delivers) {
          this.spawnTorpedoFromRocket(w, def);
          this.addLog('[CONTACT] SPLASH — torpedo in the water', 'danger');
        } else if (def.direct) {
          this.rocketExplode(w, def);
        }
        w.dead = true;
        return;
      }
      w.x += Math.sin(w.heading * DR) * moveDist;
      w.y += Math.cos(w.heading * DR) * moveDist;
    }
  }

  torpedoAcquires(w, t, r) {
    const def = WEAPONS[w.type];
    if (w.type === 't53') {
      if (t.kind === 'surface') {
        const stern = offsetPos(t.x, t.y, t.heading + 180, (t.lengthNm || 0.03) * 2);
        return rangeNm({ x: w.x, y: w.y }, stern) < 0.6;
      }
      return false;
    }
    if (def.seeker.includes('active') && r < def.activeRange) return true;
    if (def.seeker.includes('passive') && t.noise > 24 && r < def.activeRange * 1.6) return true;
    if (def.seeker.includes('passive') && t.noise > 32 && r < def.activeRange * 2.2) return true;
    return false;
  }

  wakeAimPoint(w, t) {
    const sternB = t.heading + 180;
    const stern = offsetPos(t.x, t.y, sternB, (t.lengthNm || 0.03) * 2);
    return { x: stern.x + Math.sin(sternB * DR) * 0.3, y: stern.y + Math.cos(sternB * DR) * 0.3 };
  }

  findNearestSurface(w, range, coneDeg) {
    let best = null, bestR = range + 1;
    for (const t of this.platforms) {
      if (t.sinking || t.kind !== 'surface') continue;
      const r = rangeNm({ x: w.x, y: w.y }, t);
      if (r > range) continue;
      const brg = bearingDeg({ x: w.x, y: w.y }, t);
      if (Math.abs(relCourse(brg - w.heading)) > coneDeg) continue;
      if (r < bestR) { bestR = r; best = t; }
    }
    return best;
  }

  spawnTorpedoFromRocket(w, def) {
    const tdef = WEAPONS[def.delivers];
    const targetId = this.findClosestSub(w);
    let depthCmd = 60;
    if (targetId) { const t = this.getById(targetId); if (t) depthCmd = clamp(t.depth, 20, 300); }
    const w2 = {
      type: def.delivers, kind: 'torpedo', side: w.side, x: w.x, y: w.y, px: w.x, py: w.y,
      heading: w.heading, speed: tdef.speeds[0].speed, depth: depthCmd, depthCmd,
      fuel: tdef.speeds[0].rng / tdef.speeds[0].speed * 3600,
      state: 'search', targetId, datumX: w.datumX, datumY: w.datumY,
      age: 0, path: [], launcherId: w.launcherId, wire: false, dead: false,
    };
    this.weapons.push(w2);
    return w2;
  }

  findClosestSub(w) {
    let best = null, bestR = 999;
    for (const t of this.platforms) {
      if (t.kind !== 'sub' || t.sinking) continue;
      const r = rangeNm({ x: w.x, y: w.y }, t);
      if (r < bestR) { bestR = r; best = t; }
    }
    return best && bestR < 2 ? best.id : null;
  }

  rocketExplode(w, def) {
    this.addEffect('explosion', w.x, w.y, { dur: 4, big: true });
    this.addLog('[CONTACT] RBU IMPACT NEARBY', 'danger');
    const pl = this.player;
    if (rangeNm({ x: w.x, y: w.y }, pl) < def.directRadius && pl.depth < 250) {
      this.damagePlayer(def.warhead * rand(0.6, 1.2), 'ASW ROCKET');
    }
  }

  fireTorpedo(shooter, type, targetPos, depth, targetId) {
    const def = WEAPONS[type];
    const sp = def.speeds[0];
    const w = {
      type, kind: 'torpedo', side: def.side, x: shooter.x, y: shooter.y, px: shooter.x, py: shooter.y,
      heading: shooter.heading, speed: sp.speed, depth: depth != null ? depth : 60, depthCmd: depth != null ? depth : 60,
      fuel: sp.rng / sp.speed * 3600, state: 'search',
      datumX: targetPos.x, datumY: targetPos.y, targetId: targetId || null, age: 0, path: [], launcherId: shooter.id, wire: false, dead: false,
    };
    this.weapons.push(w);
    this.addEffect('launch', shooter.x, shooter.y, { dur: 3 });
    return w;
  }

  fireMissile(shooter, type, targetPos, targetDepth) {
    const def = WEAPONS[type];
    const w = {
      type, kind: def.kind, side: def.side, x: shooter.x, y: shooter.y, px: shooter.x, py: shooter.y,
      heading: bearingDeg(shooter, { x: targetPos.x, y: targetPos.y }), speed: def.speed,
      fuel: def.rangeNm / def.speed * 3600, state: 'fly', datumX: targetPos.x, datumY: targetPos.y,
      targetId: null, age: 0, path: [], launcherId: shooter.id, wire: false, dead: false,
      depthCmd: targetDepth != null ? targetDepth : undefined,
    };
    this.weapons.push(w);
    this.addEffect('launch', shooter.x, shooter.y, { dur: 3 });
    this.addLog(`[CONTACT] WEAPON LAUNCH SIGNATURE — ${shooter.name}`, 'danger');
    return w;
  }

  fireRocket(shooter, type, targetPos) {
    const def = WEAPONS[type];
    const w = {
      type, kind: 'rocket', side: def.side, x: shooter.x, y: shooter.y, px: shooter.x, py: shooter.y,
      heading: bearingDeg(shooter, { x: targetPos.x, y: targetPos.y }), speed: def.speed,
      fuel: def.rangeNm / def.speed * 3600, state: 'fly', datumX: targetPos.x, datumY: targetPos.y,
      targetId: null, age: 0, path: [], launcherId: shooter.id, wire: false, dead: false,
      depthCmd: targetPos.depthCmd,
    };
    this.weapons.push(w);
    return w;
  }

  playerFire(type, speedMode, contact) {
    const pl = this.player;
    if (pl.systems.weapons < 25) { this.addLog('[WEAPONS] FIRE CONTROL DAMAGED', 'danger'); return false; }
    const tube = pl.tubes.find(t => t.ready);
    if (!tube) { this.addLog('[WEAPONS] NO TUBE READY', 'info'); return false; }
    if (type === 'harpoon' && (pl.loads.harpoon || 0) <= 0) { this.addLog('[WEAPONS] NO HARPOONS REMAINING', 'info'); return false; }
    if (type === 'mk48' && (pl.loads.mk48 || 0) <= 0) { this.addLog('[WEAPONS] NO MK-48 REMAINING', 'info'); return false; }
    const aim = { x: pl.x + Math.sin(contact.bearing * DR) * (contact.range || 10), y: pl.y + Math.cos(contact.bearing * DR) * (contact.range || 10) };
    if (type === 'mk48') {
      const def = WEAPONS.mk48;
      const sp = def.speeds.find(s => s.label === speedMode) || def.speeds[0];
      const w = {
        type, kind: 'torpedo', side: 'us', x: pl.x, y: pl.y, px: pl.x, py: pl.y,
        heading: bearingDeg(pl, aim), speed: sp.speed, depth: 12, depthCmd: 12,
        fuel: sp.rng / sp.speed * 3600, state: 'wire', datumX: aim.x, datumY: aim.y,
        targetId: contact.targetId, age: 0, path: [], launcherId: pl.id, wire: true, dead: false,
        autoSteer: true,
      };
      this.weapons.push(w);
      tube.ready = false; tube.reloadT = CLASSES['los-angeles'].reload;
      pl.loads.mk48--;
      this.missionStats.launched++;
      this.addEffect('launch', pl.x, pl.y, { dur: 3 });
      this.addLog(`[WEAPONS] TUBE ${tube.idx + 1} — TORPEDO AWAY, MODE ${sp.label}`, 'info');
      this.launchReveals(pl);
      return w;
    } else if (type === 'harpoon') {
      const def = WEAPONS.harpoon;
      const w = {
        type, kind: 'missile', side: 'us', x: pl.x, y: pl.y, px: pl.x, py: pl.y,
        heading: bearingDeg(pl, aim), speed: def.speed, fuel: def.rangeNm / def.speed * 3600,
        state: 'fly', datumX: aim.x, datumY: aim.y, targetId: null, age: 0, path: [],
        launcherId: pl.id, wire: false, dead: false,
      };
      this.weapons.push(w);
      tube.ready = false; tube.reloadT = 60;
      pl.loads.harpoon--;
      this.missionStats.launched++;
      this.addEffect('launch', pl.x, pl.y, { dur: 3 });
      this.addLog('[WEAPONS] HARPOON AWAY', 'info');
      this.launchReveals(pl);
      return w;
    }
    return false;
  }

  launchReveals(pl) {
    for (const e of this.enemyPlatforms()) {
      if (rangeNm(pl, e) < 20) {
        this.giveDatum(e, { x: pl.x + randn() * 1.8, y: pl.y + randn() * 1.8, t: this.t, why: 'LAUNCH DETECT' });
      }
    }
    this.addLog('[ALERT] LAUNCH TRANSIENT — we may have been detected', 'danger');
  }

  deployDecoy() {
    const pl = this.player;
    if (pl.decoys <= 0) return false;
    if (pl.decoyActive) return false;
    pl.decoys--;
    const d = this.spawn(makePlatform('buoy', { x: pl.x, y: pl.y }));
    d.isActiveDecoy = true; d.lifeT = this.t + 600;
    pl.decoyActive = true;
    this.addLog('[COUNTERMEASURES] ACTIVE DECOY DEPLOYED', 'info');
    this.addEffect('decoy', pl.x, pl.y, { dur: 6 });
    return true;
  }

  deployNoisemaker() {
    const pl = this.player;
    if (pl.noisemakers <= 0) return false;
    pl.noisemakers--;
    const d = this.spawn(makePlatform('buoy', { x: pl.x, y: pl.y }));
    d.isNoisemaker = true; d.lifeT = this.t + 420;
    this.addLog('[COUNTERMEASURES] NOISEMAKER DEPLOYED', 'info');
    this.addEffect('decoy', pl.x, pl.y, { dur: 6 });
    return true;
  }

  damagePlatform(t, warheadKg, w) {
    let dmg = clamp(warheadKg * rand(0.08, 0.18) * (t.cls === 'merchant' ? 1.8 : 1), 4, 80);
    if (t.isPlayer) dmg *= 0.45;
    t.hull -= dmg;
    t.flooding = Math.min(100, t.flooding + dmg * 0.5);
    this.addEffect('explosion', t.x, t.y, { dur: 5, big: true });
    if (t.isPlayer) {
      this.damagePlayerSystems(dmg);
      if (t.hull <= 0 || t.flooding >= 100) { t.sinking = true; t.sinkT = 0; }
      return;
    }
    if (t.kind === 'sub') t.flooding = Math.min(100, t.flooding + dmg * 0.7);
    const dmgTxt = t.kind === 'sub' ? 'IMPACT — torpedo hit on submarine!' : 'IMPACT — missile/torpedo hit!';
    this.addLog(`[SONAR] ${dmgTxt} ${t.name}`, 'danger');
    if (t.hull <= 0 && !t.sinking) {
      t.sinking = true; t.sinkT = 0;
      this.missionStats.sunk.push(t.name);
      this.missionStats.tonnage += t.value;
      this.addLog(`[REPORT] TARGET SUNK — ${t.name}`, 'success');
      this.checkObjectives(t);
      if (t.helos > 0) for (const h of this.platforms) { if (h.kind === 'air' && h.ai.parentId === t.id) h.ai.mode = 'return'; }
    }
  }

  checkObjectives(sunkPlatform) {
    const mo = this.mission;
    if (!mo || !mo.objectives) return;
    for (const o of mo.objectives) {
      if (o.met) continue;
      if (o.type === 'sink' && sunkPlatform.cls === o.cls) o.met = true;
      else if (o.type === 'sink-class') {
        if (o.cls === 'surface-warship' && sunkPlatform.kind === 'surface' && sunkPlatform.cls !== 'merchant') { o.met = (o.metCount = (o.metCount || 0) + 1) >= o.count; }
        else if (o.cls === 'sub' && sunkPlatform.kind === 'sub') { o.met = (o.metCount = (o.metCount || 0) + 1) >= o.count; }
      } else if (o.type === 'tonnage' && this.missionStats.tonnage >= o.tons) o.met = true;
    }
  }

  damagePlayerSystems(dmg) {
    const pl = this.player;
    this.addLog('[DAMAGE] ' + flavorList('damageReports', ['HIT! WE ARE UNDER ATTACK', 'FLOODING IN THE TORPEDO ROOM!', 'FIRE IN AUXILIARY MACHINERY!', 'WE ARE UNDER ATTACK — ALARM!']), 'danger');
    const sys = ['sonar', 'propulsion', 'steering', 'weapons'];
    const n = Math.random() < 0.7 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const s = pick(sys);
      pl.systems[s] = Math.max(0, pl.systems[s] - rand(20, 60));
      this.addLog(`[DAMAGE] ${s.toUpperCase()} SYSTEM DAMAGED`, 'danger');
    }
  }

  damagePlayer(dmg, source) {
    const pl = this.player;
    if (pl.sinking) return;
    const hullDmg = clamp(dmg / 7 * rand(0.6, 1.3), 0.8, 30);
    pl.hull -= hullDmg;
    pl.flooding = Math.min(100, pl.flooding + hullDmg * rand(0.6, 1.4));
    this.addEffect('explosion', pl.x, pl.y, { dur: 6, big: true });
    this.addLog(`[DAMAGE] ${source} IMPACT — flooding ${pl.flooding.toFixed(0)}%`, 'danger');
    this.damagePlayerSystems(dmg);
    if (pl.hull <= 0 || pl.flooding >= 100) {
      pl.sinking = true; pl.sinkT = 0;
    }
  }

  cleanup(dt) {
    const pl = this.player;
    if (pl.sinking) return;
    pl.fire = Math.max(0, pl.fire - 0.05 * dt);
    pl.flooding = Math.max(0, pl.flooding - (pl.systems.hull > 30 ? 0.02 : 0.005) * dt);
    for (const s of ['sonar', 'propulsion', 'steering', 'weapons']) {
      if (pl.systems[s] < 100 && pl.repairTeams > 0) {
        pl.systems[s] = Math.min(100, pl.systems[s] + REPAIR_RATE * dt / 60);
      }
    }
    for (const tube of pl.tubes) {
      if (!tube.ready) {
        tube.reloadT -= dt;
        if (tube.reloadT <= 0) { tube.ready = true; this.addLog(`[WEAPONS] TUBE ${tube.idx + 1} RELOADED`, 'info'); }
      }
    }
  }

  checkEnd() {
    const pl = this.player;
    if (pl.sinking && !this.over) {
      this.over = true; this.overType = 'sunk';
      this.addLog('[END] USS DALLAS LOST WITH ALL HANDS', 'danger');
      return;
    }
    const mo = this.mission;
    if (!mo) return;
    const primary = mo.objectives && mo.objectives[0];
    if (!this.over && primary && primary.met) {
      this.over = true; this.overType = 'success';
      this.addLog('[END] PRIMARY OBJECTIVE COMPLETE — MISSION SUCCESS', 'success');
    }
  }
}

export function passiveDetectRange(target, listener, sea) {
  const tn = target.noise, ln = listener.selfNoise || 5;
  const ratio = Math.pow(tn / 30, 1.6) * Math.pow(30 / Math.max(3, ln), 0.8);
  return clamp(3.4 * ratio * sea.factor, 0.5, 38);
}
