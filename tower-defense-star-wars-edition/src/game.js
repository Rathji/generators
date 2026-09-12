import { GRID, TOWERS, ENEMIES, PLANETS, DIFFICULTIES, ABILITIES, HERO } from "./config.js";
import * as audio from "./audio.js";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

function towerDef(id) { return TOWERS.find((t) => t.id === id); }

function buildMap(planet) {
  const { cols, rows, cell } = GRID;
  const nodes = [planet.start, ...planet.waypoints];
  const cellKeys = [];
  const seen = new Set();
  const push = (c, r) => {
    const k = c + "," + r;
    if (!seen.has(k)) { seen.add(k); cellKeys.push([c, r]); }
  };
  push(nodes[0][0], nodes[0][1]);
  for (let i = 0; i < nodes.length - 1; i++) {
    let [c, r] = nodes[i];
    const [c1, r1] = nodes[i + 1];
    const dc = Math.sign(c1 - c), dr = Math.sign(r1 - r);
    while (c !== c1 || r !== r1) { c += dc; r += dr; push(c, r); }
  }
  const pathSet = new Set(cellKeys.map(([c, r]) => c + "," + r));
  const pts = cellKeys.map(([c, r]) => ({ x: (c + 0.5) * cell, y: (r + 0.5) * cell, c, r }));
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    pts[i].seg = length;
    length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  pts[0].seg = 0;

  const decor = [];
  const density = planet.decor === "tree" ? 0.1 : planet.decor === "rock" ? 0.06 : 0.05;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pathSet.has(c + "," + r)) continue;
      if (Math.random() < density) decor.push({ c, r, seed: Math.random(), type: planet.decor });
    }
  }
  const decorSet = new Set(decor.map((d) => d.c + "," + d.r));

  return {
    cols, rows, cell,
    pathKeys: pathSet,
    decorKeys: decorSet,
    decor,
    pts,
    length,
    spawn: pts[0],
    exit: pts[pts.length - 1],
    planet,
  };
}

export function pointAtDist(map, d) {
  const pts = map.pts;
  if (d <= 0) { const p = pts[0]; const n = pts[1] || p; return { x: p.x, y: p.y, angle: Math.atan2(n.y - p.y, n.x - p.x) }; }
  if (d >= map.length) { const p = pts[pts.length - 1]; const q = pts[pts.length - 2] || p; return { x: p.x, y: p.y, angle: Math.atan2(p.y - q.y, p.x - q.x) }; }
  let lo = 0, hi = pts.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (pts[mid].seg <= d) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[lo + 1];
  const segLen = (b.seg - a.seg) || 1;
  const t = clamp((d - a.seg) / segLen, 0, 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export class Game {
  constructor(planetIndex, difficultyKey, opts = {}) {
    this.planetIndex = planetIndex;
    this.planet = PLANETS[planetIndex];
    this.difficulty = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.endless = !!opts.endless;
    this.map = buildMap(this.planet);
    this.maxLives = this.difficulty.lives;
    this.totalWaves = this.endless ? Infinity : this.planet.waves;

    this.phase = "running";
    this.speed = 1;
    this.time = 0;

    this.credits = 260 + (this.endless ? 60 : 0);
    this.lives = this.maxLives;
    this.score = 0;

    this.enemies = [];
    this.towers = [];
    this.projectiles = [];
    this.particles = [];
    this.beams = [];
    this.floaters = [];
    this.hero = null;

    this.wave = 0;
    this.waveActive = false;
    this.queue = [];
    this.waveTime = 0;
    this.countdown = 6;
    this.pendingBoss = false;

    this.abilities = {};
    Object.keys(ABILITIES).forEach((k) => {
      this.abilities[k] = { cd: 0, ready: true, used: 0 };
    });

    this.kills = 0;
    this.creditsEarned = 0;
    this.damageDealt = 0;
    this.shots = 0;
    this.hits = 0;
    this.leaks = 0;
    this.startedAt = 0;
    this.elapsed = 0;
    this.waveClearBonus = 0;

    this.selectedTowerType = null;
    this.selectedTowerId = null;
    this.placementValid = false;
    this.events = [];
  }

  emit(type, payload) { this.events.push({ type, payload }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  notify(msg, kind) { this.emit("toast", { msg, kind }); }

  nextPlanetId() { return PLANETS[this.planetIndex + 1] ? PLANETS[this.planetIndex + 1].id : null; }

  cellKey(c, r) { return c + "," + r; }

  isBuildable(c, r) {
    if (c < 0 || r < 0 || c >= this.map.cols || r >= this.map.rows) return false;
    const k = this.cellKey(c, r);
    if (this.map.pathKeys.has(k) || this.map.decorKeys.has(k)) return false;
    if (this.towers.some((t) => t.col === c && t.row === r)) return false;
    if (this.hero && this.hero.col === c && this.hero.row === r) return false;
    return true;
  }

  towerAt(c, r) { return this.towers.find((t) => t.col === c && t.row === r) || null; }

  tierStats(tower) { return towerDef(tower.typeId).tiers[tower.level]; }

  hpScale(wave) {
    let s = 1 + 0.15 * (wave - 1);
    s *= this.difficulty.hp;
    if (this.endless) s *= 1 + 0.09 * Math.floor(wave / 5);
    return s;
  }

  spawnEnemy(typeId, wave = this.wave || 1) {
    const def = ENEMIES[typeId];
    if (!def) return null;
    const hp = Math.round(def.hp * this.hpScale(wave));
    const shield = Math.round((def.shield || 0) * this.hpScale(wave));
    const e = {
      type: typeId,
      def,
      hp, maxHp: hp,
      shield, maxShield: shield,
      speed: def.speed * clamp(1 + 0.008 * (wave - 1), 1, 1.45),
      armor: def.armor,
      bounty: Math.round(def.bounty * (1 + 0.02 * (wave - 1)) * this.difficulty.bounty),
      radius: def.radius,
      flying: !!def.flying,
      boss: !!def.boss,
      heavy: !!def.heavy,
      dist: 0,
      x: this.map.spawn.x,
      y: this.map.spawn.y,
      angle: 0,
      alive: true,
      reached: false,
      slowUntil: 0, slowMult: 1,
      stunUntil: 0,
      breakUntil: 0,
      flashUntil: 0,
      abilityTimer: def.boss ? 5 : 0,
      hitFlash: 0,
      seed: Math.random(),
    };
    this.enemies.push(e);
    return e;
  }

  startWave() {
    this.wave += 1;
    this.waveActive = true;
    this.waveTime = 0;
    this.queue = this.composeWave(this.wave);
    audio.play("wave");
    this.notify("Wave " + this.wave + (this.isBossWave(this.wave) ? " — BOSS INCOMING" : ""), this.isBossWave(this.wave) ? "warn" : "info");
  }

  isBossWave(wave) {
    if (this.endless) return wave % 5 === 0;
    return wave === this.totalWaves;
  }

  composeWave(wave) {
    const pool = this.planet.pool.filter((p) => p.from <= wave);
    const list = pool.length ? pool : [this.planet.pool[0]];
    const entries = [];
    const count = Math.round(4 + wave * 1.7);
    const interval = clamp(0.95 - wave * 0.02, 0.32, 0.95) * this.difficulty.spawn;
    let t = 0;
    const weights = list.map((p, i) => 1 + (list.length - 1 - i) * 0.15 + Math.max(0, wave - p.from) * 0.05);
    const totalW = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < count; i++) {
      let pick = Math.random() * totalW;
      let idx = 0;
      for (let j = 0; j < weights.length; j++) { pick -= weights[j]; if (pick <= 0) { idx = j; break; } }
      entries.push({ t, type: list[idx].type });
      t += interval * rand(0.6, 1.3);
    }
    if (this.isBossWave(wave)) {
      entries.push({ t: t + 1.2, type: this.planet.boss });
    } else if (wave % 5 === 3 && wave > 4) {
      const tanks = list.filter((p) => ["atst", "superdroid", "droideka", "atat"].includes(p.type));
      if (tanks.length) entries.push({ t: t + 0.8, type: tanks[tanks.length - 1].type });
    }
    return entries;
  }

  canAfford(cost) { return this.credits >= cost; }

  canPlace(typeId, c, r) {
    if (!this.isBuildable(c, r)) return false;
    const def = towerDef(typeId);
    return !!def && this.canAfford(def.tiers[0].cost);
  }

  placeTower(typeId, c, r) {
    const def = towerDef(typeId);
    if (!def) return null;
    if (!this.isBuildable(c, r)) { audio.play("error"); this.notify("Can't build there", "bad"); return null; }
    const cost = def.tiers[0].cost;
    if (!this.canAfford(cost)) { audio.play("error"); this.notify("Not enough credits", "bad"); return null; }
    this.credits -= cost;
    const tower = {
      id: "t" + Math.random().toString(36).slice(2, 9),
      typeId, col: c, row: r,
      x: (c + 0.5) * this.map.cell, y: (r + 0.5) * this.map.cell,
      level: 0, cooldown: 0, angle: -Math.PI / 2,
      targeting: "first", disabledUntil: 0, invested: cost,
      shots: 0, hits: 0, kills: 0, recoil: 0,
    };
    this.towers.push(tower);
    audio.play("build");
    this.burst(tower.x, tower.y, def.glow, 12, 90);
    return tower;
  }

  upgradeCost(tower) {
    const t = towerDef(tower.typeId).tiers[tower.level + 1];
    return t ? t.cost : null;
  }

  upgradeTower(tower) {
    const cost = this.upgradeCost(tower);
    if (cost == null) { this.notify("Max level", "bad"); audio.play("error"); return false; }
    if (!this.canAfford(cost)) { this.notify("Not enough credits", "bad"); audio.play("error"); return false; }
    this.credits -= cost;
    tower.invested += cost;
    tower.level += 1;
    audio.play("upgrade");
    this.burst(tower.x, tower.y, towerDef(tower.typeId).glow, 16, 120);
    this.emit("towerChanged", { id: tower.id });
    return true;
  }

  sellValue(tower) { return Math.floor(tower.invested * 0.7); }

  sellTower(tower) {
    const v = this.sellValue(tower);
    this.credits += v;
    this.towers = this.towers.filter((t) => t !== tower);
    if (this.selectedTowerId === tower.id) this.selectedTowerId = null;
    audio.play("sell");
    this.notify("Sold for " + v + " credits", "info");
    this.burst(tower.x, tower.y, "#f5b642", 12, 80);
    return v;
  }

  setTargeting(tower, mode) {
    tower.targeting = mode;
    this.emit("towerChanged", { id: tower.id });
  }

  buildHero(c, r) {
    if (this.hero && this.hero.alive) { this.notify("Hero already deployed", "bad"); return null; }
    if (!this.isBuildable(c, r)) { audio.play("error"); this.notify("Can't deploy there", "bad"); return null; }
    if (!this.canAfford(HERO.cost)) { audio.play("error"); this.notify("Not enough credits", "bad"); return null; }
    this.credits -= HERO.cost;
    this.hero = {
      col: c, row: r, x: (c + 0.5) * this.map.cell, y: (r + 0.5) * this.map.cell,
      tx: null, ty: null, hp: HERO.hp, maxHp: HERO.hp,
      cooldown: 0, abilityCd: 0, angle: -Math.PI / 2, alive: true,
      invested: HERO.cost, respawn: 0, reapTimer: 0,
    };
    audio.play("build");
    this.burst(this.hero.x, this.hero.y, "#57e08a", 20, 130);
    return this.hero;
  }

  moveHero(c, r) {
    if (!this.hero || !this.hero.alive) return;
    if (!this.isBuildable(c, r)) return;
    this.hero.tx = (c + 0.5) * this.map.cell;
    this.hero.ty = (r + 0.5) * this.map.cell;
    this.hero.tcol = c; this.hero.trow = r;
  }

  useHeroAbility() {
    const h = this.hero;
    if (!h || !h.alive) return false;
    if (h.abilityCd > 0) { audio.play("error"); return false; }
    h.abilityCd = HERO.ability.cooldown;
    audio.play("ability");
    this.aoe(h.x, h.y, HERO.ability.radius, HERO.ability.damage, { stun: HERO.ability.stun, color: "#57e08a" });
    this.ring(h.x, h.y, HERO.ability.radius, "#57e08a");
    return true;
  }

  castAbility(id, x, y) {
    const a = ABILITIES[id];
    if (!a) return false;
    const slot = this.abilities[id];
    if (!slot || slot.cd > 0) { audio.play("error"); this.notify(a.name + " recharging", "bad"); return false; }
    slot.cd = a.cooldown;
    slot.used += 1;
    audio.play(id === "orbital" ? "nova" : "ability");
    if (id === "lightning") {
      this.aoe(x, y, a.radius, a.damage, { stun: a.stun, color: "#c084fc" });
      this.ring(x, y, a.radius, "#c084fc");
      for (let i = 0; i < 10; i++) {
        const ang = rand(0, TAU), r = rand(0, a.radius);
        this.beams.push({ x1: x, y1: y, x2: x + Math.cos(ang) * r, y2: y + Math.sin(ang) * r, life: 0.25, max: 0.25, color: "#c084fc", width: 2 });
      }
    } else if (id === "push") {
      this.enemies.forEach((e) => {
        if (e.alive && dist2(e.x, e.y, x, y) < a.radius * a.radius) {
          e.dist = Math.max(0, e.dist - a.knockback);
          this.damage(e, a.damage, "ability", {});
          this.status(e, "stun", 0.8);
        }
      });
      this.ring(x, y, a.radius, "#9fd8ff");
    } else if (id === "orbital") {
      this.aoe(x, y, a.radius, a.damage, { color: "#ffd27a", big: true });
      this.ring(x, y, a.radius, "#ffd27a");
      this.ring(x, y, a.radius * 0.6, "#fff2c4");
      this.shake = 10;
    }
    this.emit("abilityUsed", { id });
    return true;
  }

  aoe(x, y, radius, damage, opts = {}) {
    this.enemies.forEach((e) => {
      if (!e.alive) return;
      const d2 = dist2(e.x, e.y, x, y);
      if (d2 <= radius * radius) {
        const falloff = 1 - 0.4 * Math.sqrt(d2) / radius;
        this.damage(e, damage * falloff, opts.attackType || "ability", {});
        if (opts.stun) this.status(e, "stun", opts.stun);
      }
    });
    for (let i = 0; i < (opts.big ? 34 : 18); i++) this.spark(x + rand(-radius, radius) * 0.8, y + rand(-radius, radius) * 0.8, opts.color || "#fff", rand(1, 4), rand(40, 160));
  }

  status(e, kind, dur, mult) {
    if (kind === "slow") { e.slowUntil = Math.max(e.slowUntil, this.time + dur); e.slowMult = Math.min(e.slowMult || 1, mult || 0.5); }
    else if (kind === "stun") { e.stunUntil = Math.max(e.stunUntil, this.time + dur); }
    else if (kind === "break") { e.breakUntil = Math.max(e.breakUntil, this.time + dur); }
  }

  damage(e, raw, attackType, opts = {}) {
    if (!e.alive) return 0;
    let dmg = raw;
    if (e.breakUntil > this.time) dmg *= 1.35;
    let armor = e.armor;
    if (attackType === "laser") armor *= 0.35;
    if (attackType === "ion") armor *= 0.5;
    dmg = Math.max(dmg - armor, raw * 0.15);
    let dealt = 0;
    if (e.shield > 0) {
      const mul = attackType === "ion" ? (opts.shieldMul || 3) : 0.45;
      const toShield = dmg * mul;
      const absorbed = Math.min(e.shield, toShield);
      e.shield -= absorbed;
      dealt += absorbed;
      if (e.shield <= 0) {
        const over = toShield - absorbed;
        e.hp -= over * (attackType === "ion" ? 1 : 0.6);
        dealt += over;
        this.burst(e.x, e.y, "#8fd8ff", 10, 90);
      }
    } else {
      e.hp -= dmg;
      dealt += dmg;
    }
    e.hitFlash = 1;
    this.damageDealt += dealt;
    if (e.hp <= 0) this.kill(e, opts.source);
    return dealt;
  }

  kill(e, source) {
    if (!e.alive) return;
    e.alive = false;
    this.kills += 1;
    const gain = e.bounty;
    this.credits += gain;
    this.creditsEarned += gain;
    this.score += Math.round(gain * 4 * this.difficulty.score);
    if (source && source.kills != null) source.kills += 1;
    this.burst(e.x, e.y, e.def.accent || "#fff", e.boss ? 40 : 14, e.boss ? 220 : 120);
    for (let i = 0; i < (e.boss ? 5 : 2); i++) this.smoke(e.x + rand(-8, 8), e.y + rand(-8, 8));
    this.floater(e.x, e.y - e.radius, "+" + gain, "#7ef0a6");
    if (e.boss) { this.ring(e.x, e.y, 120, "#ffd27a"); this.shake = 12; audio.play("explode"); }
  }

  leak(e) {
    e.alive = false;
    e.reached = true;
    const cost = e.boss ? 5 : e.heavy ? 3 : e.flying ? 1 : 1;
    this.lives = Math.max(0, this.lives - cost);
    this.leaks += 1;
    this.emit("leak", { cost });
    audio.play("error");
    this.floater(this.map.exit.x, this.map.exit.y - 20, "-" + cost + " ♥", "#ff5a6e");
    if (this.lives <= 0 && this.phase === "running") this.end(false);
  }

  burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, size: rand(1.5, 3.6), color, kind: "spark", drag: 0.9 });
    }
  }

  spark(x, y, color, size, speed) {
    const a = rand(0, TAU);
    this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: rand(0.2, 0.5), max: 0.5, size, color, kind: "spark", drag: 0.9 });
  }

  smoke(x, y) {
    this.particles.push({ x, y, vx: rand(-12, 12), vy: rand(-30, -8), life: rand(0.6, 1.2), max: 1.2, size: rand(5, 11), color: "rgba(120,130,150,0.5)", kind: "smoke", drag: 0.97 });
  }

  ring(x, y, r, color) { this.particles.push({ x, y, r: 4, tr: r, life: 0.5, max: 0.5, color, kind: "ring" }); }

  floater(x, y, text, color) { this.floaters.push({ x, y, text, color, life: 1, max: 1 }); }

  findTarget(tower) {
    const def = towerDef(tower.typeId);
    const s = this.tierStats(tower);
    const r2 = s.range * s.range;
    let best = null, bestScore = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.flying && !def.air) continue;
      if (dist2(e.x, e.y, tower.x, tower.y) > r2) continue;
      let score;
      if (tower.targeting === "first") score = e.dist;
      else if (tower.targeting === "last") score = -e.dist;
      else if (tower.targeting === "closest") score = -dist2(e.x, e.y, tower.x, tower.y);
      else score = e.hp + e.shield;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  fire(tower, target) {
    const def = towerDef(tower.typeId);
    const s = this.tierStats(tower);
    tower.cooldown = 1 / s.fireRate;
    tower.recoil = 1;
    tower.shots += 1;
    this.shots += 1;
    const mx = tower.x + Math.cos(tower.angle) * 16;
    const my = tower.y + Math.sin(tower.angle) * 16;
    const p = {
      x: mx, y: my, target, type: def.attack, color: def.glow,
      speed: s.pSpeed, damage: s.damage, splash: s.splash || 0,
      chain: s.chain || 0, stun: s.stun || 0, shieldMul: s.shieldMul || 3,
      life: 2.4, source: tower, angle: tower.angle, trail: [], alive: true,
    };
    this.projectiles.push(p);
    if (def.attack === "laser") this.beams.push({ x1: mx, y1: my, x2: target.x, y2: target.y, life: 0.09, max: 0.09, color: def.glow, width: 2.4 });
    if (def.attack === "blaster") audio.play("blaster");
    else if (def.attack === "laser") audio.play("laser");
    else if (def.attack === "missile") audio.play("missile");
    else audio.play("ion");
  }

  impact(p, e) {
    const tower = p.source;
    if (tower) tower.hits += 1;
    this.hits += 1;
    if (p.splash > 0) {
      this.aoe(p.x, p.y, p.splash, p.damage, { color: p.color });
      this.ring(p.x, p.y, p.splash, p.color);
      this.burst(p.x, p.y, p.color, 12, 140);
      audio.play("explode");
      return;
    }
    this.damage(e, p.damage, p.type, { shieldMul: p.shieldMul, source: tower });
    if (p.stun) this.status(e, "stun", p.stun);
    if (p.type === "ion") {
      this.beams.push({ x1: p.x, y1: p.y, x2: e.x, y2: e.y, life: 0.16, max: 0.16, color: "#c4b5fd", width: 2 });
      let prev = e, jumps = p.chain;
      const hitSet = new Set([e]);
      while (jumps > 0) {
        let next = null, bd = 96 * 96;
        for (const o of this.enemies) {
          if (!o.alive || hitSet.has(o)) continue;
          const d2 = dist2(o.x, o.y, prev.x, prev.y);
          if (d2 < bd) { bd = d2; next = o; }
        }
        if (!next) break;
        this.beams.push({ x1: prev.x, y1: prev.y, x2: next.x, y2: next.y, life: 0.16, max: 0.16, color: "#c4b5fd", width: 1.8 });
        this.damage(next, p.damage * 0.78, "ion", { shieldMul: p.shieldMul });
        if (p.stun) this.status(next, "stun", p.stun * 0.7);
        hitSet.add(next);
        prev = next;
        jumps -= 1;
      }
      this.burst(e.x, e.y, "#c4b5fd", 10, 100);
    }
    this.burst(p.x, p.y, p.color, 5, 70);
    audio.play("hit");
  }

  update(dt) {
    if (this.phase !== "running") return;
    this.time += dt;
    this.elapsed += dt;
    this.shake = Math.max(0, (this.shake || 0) - dt * 40);

    Object.keys(this.abilities).forEach((k) => {
      const a = this.abilities[k];
      if (a.cd > 0) { a.cd = Math.max(0, a.cd - dt); a.ready = a.cd === 0; }
    });

    if (!this.waveActive) {
      if (this.wave < this.totalWaves) {
        this.countdown -= dt;
        if (this.countdown <= 0) this.startWave();
      }
    } else {
      this.waveTime += dt;
      while (this.queue.length && this.queue[0].t <= this.waveTime) {
        const q = this.queue.shift();
        this.spawnEnemy(q.type, this.wave);
      }
      if (!this.queue.length && !this.enemies.some((e) => e.alive)) {
        this.completeWave();
      }
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
      if (e.abilityTimer > 0) {
        e.abilityTimer -= dt;
        if (e.abilityTimer <= 0) {
          e.abilityTimer = 9;
          this.bossAbility(e);
        }
      }
      if (e.stunUntil > this.time) continue;
      let mult = 1;
      if (e.slowUntil > this.time) mult = e.slowMult;
      e.dist += e.speed * mult * dt;
      const pos = pointAtDist(this.map, e.dist);
      e.x = pos.x; e.y = pos.y; e.angle = pos.angle;
      if (e.dist >= this.map.length) this.leak(e);
    }

    for (const t of this.towers) {
      t.recoil = Math.max(0, t.recoil - dt * 6);
      if (t.disabledUntil > this.time) continue;
      const target = this.findTarget(t);
      if (target) {
        const want = Math.atan2(target.y - t.y, target.x - t.x);
        let d = want - t.angle;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        t.angle += d * Math.min(1, dt * 10);
        t.cooldown -= dt;
        if (t.cooldown <= 0) this.fire(t, target);
      } else {
        t.cooldown = Math.min(t.cooldown, 0.2);
      }
    }

    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      const e = p.target;
      if (e && !e.alive) { p.alive = false; if (p.splash) this.impact(p, e); continue; }
      const tx = e ? e.x : p.x, ty = e ? e.y : p.y;
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const step = p.speed * dt;
      p.angle = Math.atan2(dy, dx);
      if (d <= step + (e ? e.radius * 0.7 : 0)) {
        p.x = tx; p.y = ty;
        if (e) this.impact(p, e);
        p.alive = false;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);

    for (const pt of this.particles) {
      pt.life -= dt;
      if (pt.kind === "ring") { pt.r += (pt.tr - pt.r) * Math.min(1, dt * 10); continue; }
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      const dr = Math.pow(pt.drag || 0.95, dt * 60);
      pt.vx *= dr; pt.vy *= dr;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);

    for (const f of this.floaters) { f.life -= dt; f.y -= dt * 26; }
    this.floaters = this.floaters.filter((f) => f.life > 0);

    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.hero && this.hero.alive) this.updateHero(dt);
    else if (this.hero && !this.hero.alive) {
      this.hero.respawn -= dt;
      if (this.hero.respawn <= 0) {
        this.hero.alive = true;
        this.hero.hp = this.hero.maxHp;
        this.hero.x = this.map.spawn.x + 40;
        this.hero.y = this.map.spawn.y;
        this.hero.tx = null;
        this.notify("Jedi returned to the field", "info");
      }
    }
  }

  updateHero(dt) {
    const h = this.hero;
    if (h.abilityCd > 0) h.abilityCd = Math.max(0, h.abilityCd - dt);
    if (h.tx != null) {
      const dx = h.tx - h.x, dy = h.ty - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) { h.tx = null; }
      else {
        const step = HERO.speed * dt;
        h.x += (dx / d) * step;
        h.y += (dy / d) * step;
        h.angle = Math.atan2(dy, dx);
      }
      h.col = Math.floor(h.x / this.map.cell);
      h.row = Math.floor(h.y / this.map.cell);
    }
    const s = HERO;
    h.cooldown -= dt;
    if (h.cooldown <= 0) {
      let best = null, bd = s.range * s.range;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d2 = dist2(e.x, e.y, h.x, h.y);
        if (d2 < bd) { bd = d2; best = e; }
      }
      if (best) {
        h.cooldown = 1 / s.fireRate;
        h.angle = Math.atan2(best.y - h.y, best.x - h.x);
        this.beams.push({ x1: h.x, y1: h.y, x2: best.x, y2: best.y, life: 0.12, max: 0.12, color: "#57e08a", width: 3 });
        this.damage(best, s.damage, "hero", {});
        this.shots += 1; this.hits += 1;
        audio.play("laser");
      }
    }
    for (const e of this.enemies) {
      if (e.alive && dist2(e.x, e.y, h.x, h.y) < 26 * 26) {
        h.hp -= (e.boss ? 40 : 12) * dt;
        h.hitFlash = 1;
        if (h.hp <= 0) {
          h.alive = false;
          h.respawn = 9;
          this.burst(h.x, h.y, "#57e08a", 24, 150);
          this.notify("Jedi Knight has fallen!", "warn");
          break;
        }
      }
    }
    if (h.hitFlash) h.hitFlash = Math.max(0, h.hitFlash - dt * 3);
  }

  bossAbility(e) {
    const r = 140;
    let hit = false;
    for (const t of this.towers) {
      if (dist2(t.x, t.y, e.x, e.y) < r * r) { t.disabledUntil = this.time + 3.5; hit = true; }
    }
    if (hit) {
      this.ring(e.x, e.y, r, e.def.accent);
      this.beams.push({ x1: e.x, y1: e.y, x2: e.x, y2: e.y, life: 0.3, max: 0.3, color: e.def.accent, width: 4 });
      this.notify(e.def.name + " disrupts your defenses!", "warn");
    }
  }

  completeWave() {
    this.waveActive = false;
    const bonus = 40 + this.wave * 12;
    this.credits += bonus;
    this.creditsEarned += bonus;
    this.waveClearBonus = bonus;
    this.countdown = this.endless ? 5 : (this.wave >= this.totalWaves ? 0 : 8);
    if (this.wave >= this.totalWaves) { this.end(true); return; }
    this.emit("waveClear", { wave: this.wave, bonus });
    this.notify("Wave " + this.wave + " cleared  (+" + bonus + ")", "good");
  }

  readyNextWave() {
    if (this.phase !== "running" || this.waveActive) return;
    this.credits += 25;
    this.creditsEarned += 25;
    this.countdown = 0;
    this.startWave();
  }

  end(won) {
    if (this.phase === "victory" || this.phase === "gameover") return;
    this.phase = won ? "victory" : "gameover";
    this.stars = won ? this.computeStars() : 0;
    audio.play(won ? "win" : "lose");
    this.emit("end", { won });
  }

  computeStars() {
    const ratio = this.lives / this.maxLives;
    let s = 1;
    if (ratio >= 0.6) s = 2;
    if (ratio >= 0.9) s = 3;
    return s;
  }

  accuracy() {
    if (!this.shots) return 100;
    return Math.round((this.hits / this.shots) * 100);
  }

  summary() {
    return {
      won: this.phase === "victory",
      planet: this.planet.name,
      planetId: this.planet.id,
      wave: this.wave,
      totalWaves: this.totalWaves,
      lives: this.lives,
      maxLives: this.maxLives,
      score: this.score,
      stars: this.stars || 0,
      kills: this.kills,
      creditsEarned: this.creditsEarned,
      damage: Math.round(this.damageDealt),
      accuracy: this.accuracy(),
      elapsed: Math.round(this.elapsed),
      difficulty: this.difficulty.name,
      endless: this.endless,
    };
  }
}
