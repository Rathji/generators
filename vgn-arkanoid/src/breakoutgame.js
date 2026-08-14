// ============================================================================
//  BREAKOUT / ARKANOID — src/breakoutgame.js
//  ============================================================================
//  A deep Arkanoid built on src/physics.js:
//    • 7 BRICK KINDS — normal (1-hit, colors & points by height), silver
//      (2-hit), gold (3-hit), indestructible iron (bounces, never breaks),
//      hidden (invisible until you hit it), and chain-reaction bombs that
//      take out every brick around them when popped.
//    • 10 CAPSULES (E S L F M Z C T X P) — expand, shrink, slow, fast,
//      multi-ball, laser, sticky catch (aim & release), fireball pierce,
//      extra life and points.
//    • 8 level patterns that cycle as you climb, with gold / iron / bomb
//      bricks seeded in on later levels.
//  CONTROLS: ARROWS / WASD / MOUSE move the paddle, SPACE / CLICK launches
//  (and, while the catch capsule is active, releases an aimed ball), hold
//  SPACE / X to fire lasers, P / ESC pauses.
//  TUNING:   every number below can be overridden in main.pjs `config`
//            (breakoutPaddleSpeed, breakoutBallSpeed, breakoutDropChance...).
//  ============================================================================

import { World, WALL_LAYER } from './physics.js';
import { LOGICAL_W, LOGICAL_H } from './engine.js';

const W = LOGICAL_W;
const H = LOGICAL_H;

// Collision layers (bitmasks): the ball hits bricks/paddle/walls, power-up
// capsules only ever touch the paddle, lasers only touch bricks.
const L = { BALL: 1, PADDLE: 2, BRICK: 4, DROP: 8, LASER: 16 };

const $cfg = (window.root && window.root.config) || null;
function conf(name, fallback) {
  const v = $cfg && $cfg[name];
  if (v == null) return fallback;
  const s = typeof v.evaluateItem === 'function' ? v.evaluateItem : v;
  return s === '' || s == null ? fallback : s;
}

const PADDLE_SPEED = conf('breakoutPaddleSpeed', 380);
const BASE_BALL_SPEED = conf('breakoutBallSpeed', 260);
const ROWS = conf('breakoutRows', 7);
const COLS = conf('breakoutCols', 10);
const LIVES = conf('breakoutLives', 3);
const POWERUPS = conf('breakoutPowerups', true);
const DROP_CHANCE = conf('breakoutDropChance', 0.16);
const PHYS_GRAVITY = conf('physicsGravity', 0);

const BRICK_W = 36, BRICK_H = 12, BRICK_GAP = 3;
const PADDLE_W = 66, PADDLE_H = 9;
const PADDLE_Y = H - 22;
const BALL_R = 4;
const LAZ_SPEED = 720;
const MULTI_MAX = 6;
const LIFE_MAX = 9;

// Normal-brick palette by row (top rows are worth the most).
const BRICK_STYLE = [
  { score: 50, base: '#8d94ff', dark: '#3d47b0' },
  { score: 50, base: '#7ad4ff', dark: '#2a6fae' },
  { score: 30, base: '#39ff6e', dark: '#0f9d3c' },
  { score: 30, base: '#ffd23e', dark: '#a87c00' },
  { score: 20, base: '#ff9e3d', dark: '#a85700' },
  { score: 20, base: '#ff6b6b', dark: '#a82d2d' },
  { score: 10, base: '#ff2d95', dark: '#a00f58' },
];

// Capsule roster: letter → effect. `good:false` ones are traps.
const CAPSULES = {
  E: { effect: 'expand',  color: '#39ff6e', label: 'EXPAND' },
  S: { effect: 'shrink',  color: '#ff3b30', label: 'SHRINK' },
  L: { effect: 'slow',    color: '#2de1ff', label: 'SLOW' },
  F: { effect: 'fast',    color: '#ff9e3d', label: 'FAST' },
  M: { effect: 'multi',   color: '#c792ff', label: 'MULTI-BALL' },
  Z: { effect: 'laser',   color: '#ff2d95', label: 'LASER' },
  C: { effect: 'catch',   color: '#9be564', label: 'CATCH' },
  T: { effect: 'through', color: '#ff6b35', label: 'FIREBALL' },
  X: { effect: 'life',    color: '#ffd23e', label: 'EXTRA LIFE' },
  P: { effect: 'points',  color: '#ffffff', label: '+500' },
};

// Brick-kind → [hp, score, body color, dark edge]. Normal bricks resolve by
// row palette instead (see buildLevel).
const KIND_STYLE = {
  S: { hp: 2, score: 60, base: '#c9d4ff', dark: '#4a5bb0' },
  G: { hp: 3, score: 90, base: '#ffd700', dark: '#8a5a00' },
  X: { hp: Infinity, score: 0, base: '#7c8aa0', dark: '#3a4356' },
  B: { hp: 1, score: 120, base: '#ff4d2e', dark: '#7a1500' },
  '?': { hp: 1, score: 50, base: '#9be564', dark: '#3a7a1e' },
};

// Level layouts — one grid per slot, cycling with `level`. Legend:
//   . empty   # normal   S silver (2-hit)   G gold (3-hit)
//   X iron (indestructible)   ? hidden   B bomb (bombs also seed in randomly)
const PATTERNS = [
  // 0 — CLASSIC (steel roof over a plain field) — the arcade opener
  [
    'SSSSSSSSSS',
    'SSSSSSSSSS',
    '##########',
    '##########',
    '##########',
    '##########',
    '##########',
  ],
  // 1 — PYRAMID
  [
    '..........',
    '...####...',
    '..######..',
    '.########.',
    '##########',
    '##########',
    '##########',
  ],
  // 2 — CHECKERBOARD
  [
    'S.S.S.S.S.',
    '.S.S.S.S.S',
    '#.#.#.#.#.',
    '.#.#.#.#.#',
    '#.#.#.#.#.',
    '.#.#.#.#.#',
    '#.#.#.#.#.',
  ],
  // 3 — TOWER WALLS (indestructible buttresses arch the field)
  [
    'X#.####.#X',
    'X#......#X',
    'X#......#X',
    'X#......#X',
    'X#......#X',
    'X#......#X',
    'X########X',
  ],
  // 4 — SERPENTINE
  [
    'S...S...S.',
    'S...S...S.',
    '##..##..##',
    '.##.##.##.',
    '..###.###.',
    '.###..###.',
    '####..####',
  ],
  // 5 — DIAMOND (gold core)
  [
    '....##....',
    '...####...',
    '..######..',
    '.##GGGG##.',
    '..######..',
    '...####...',
    '....##....',
  ],
  // 6 — STAGGERED STAIRS
  [
    '........S.',
    'S.........',
    '........S.',
    'S.........',
    '........S.',
    'S.........',
    '........S.',
  ],
  // 7 — GHOST GRID (hidden bricks inside a steel frame)
  [
    'SSSSSSSSSS',
    'S????????S',
    'S??####??S',
    'S??####??S',
    'S????????S',
    'SSSSSSSSSS',
  ],
];

// ---- module state (the shell keeps one instance alive across runs) ----------
let gctx = null;
let world = null;
let paddle = null;
let bricks = [];
let balls = [];
let drops = [];
let lasers = [];
let particles = [];
let state = 'serve';            // serve | play | clear
let lives = LIVES;
let level = 1;
let score = 0;
let levelSpeed = BASE_BALL_SPEED;
let destructibleCount = 0;      // bricks that must die to clear the level
let slowUntil = 0, fastUntil = 0, laserUntil = 0, catchUntil = 0, throughUntil = 0;
let laserCd = 0;
let statusMsg = '';
let statusUntil = 0;
let clearTimer = 0;
let shake = 0;

const now = () => (gctx ? gctx.time() : 0);
const slowOn = () => slowUntil > now();
const fastOn = () => fastUntil > now();
const laserOn = () => laserUntil > now();
const catchOn = () => catchUntil > now();
const throughOn = () => throughUntil > now();

// ---- lifecycle hooks ----------------------------------------------------------

function init() { /* everything is built fresh in reset() */ }

function reset(ctx) {
  gctx = ctx;
  world = new World({ width: W, height: H, gravity: PHYS_GRAVITY, walls: ['top', 'left', 'right'] });
  bricks = [];
  balls = [];
  drops = [];
  lasers = [];
  particles = [];
  level = 1;
  lives = LIVES;
  score = 0;
  levelSpeed = BASE_BALL_SPEED;
  destructibleCount = 0;
  slowUntil = fastUntil = laserUntil = catchUntil = throughUntil = 0;
  laserCd = 0;
  statusMsg = '';
  statusUntil = 0;
  clearTimer = 0;
  shake = 0;

  paddle = world.rect({
    x: W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H,
    restitution: 0.25, friction: 0.2, layer: L.PADDLE,
    mask: L.BALL | L.DROP | WALL_LAYER,
    onCollide: onPaddleHit,
    data: { type: 'paddle', baseW: PADDLE_W },
  });

  buildLevel();
  serveBall();

  ctx.hud.setScore(score);
  ctx.hud.setLives(lives);
  ctx.hud.setTimerRaw('LEVEL 1');
  ctx.hud.setExtra('PRESS SPACE / CLICK TO LAUNCH');
}

// ---- world construction ---------------------------------------------------------

function lvlRand(seed) {
  let s = (seed + 1) * 2654435761 >>> 0;
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function rowStyle(r) {
  const s = BRICK_STYLE[Math.min(r, BRICK_STYLE.length - 1)];
  return { hp: 1, score: s.score, base: s.base, dark: s.dark };
}

function brickStyle(kind, r) {
  if (kind === '#') return rowStyle(r);
  return KIND_STYLE[kind];
}

function buildLevel() {
  const pattern = PATTERNS[level % PATTERNS.length];
  const rand = lvlRand(level);
  const total = COLS * (BRICK_W + BRICK_GAP) - BRICK_GAP;
  const x0 = (W - total) / 2;
  const y0 = 22;
  destructibleCount = 0;
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      let ch = pattern[r][c];
      if (ch === '.' || ch === ' ') continue;
      // Difficulty scaling: gold, iron and bombs seed into later levels.
      if (ch === '#') {
        if (level >= 3 && rand() < Math.min(0.14, 0.02 * level)) ch = 'G';
        else if (level >= 5 && rand() < 0.06) ch = 'B';
        else if (level >= 4 && rand() < 0.04) ch = 'X';
      }
      const style = brickStyle(ch, r);
      const b = world.rect({
        x: x0 + c * (BRICK_W + BRICK_GAP) + BRICK_W / 2,
        y: y0 + r * (BRICK_H + BRICK_GAP) + BRICK_H / 2,
        w: BRICK_W, h: BRICK_H, static: true, restitution: 1,
        layer: L.BRICK, mask: L.BALL | L.LASER,
        onCollide: (other) => {
          if (other.data && other.data.type === 'laser') laserHit(b);
          else hitBrick(b);
        },
        data: { type: 'brick', kind: ch, hp: style.hp, score: style.score, base: style.base, dark: style.dark, flash: 0 },
      });
      bricks.push(b);
      if (ch !== 'X') destructibleCount++;
    }
  }
}

function makeBall(x, y) {
  const b = world.circle({
    x, y, r: BALL_R, restitution: 1, gravityScale: 0, layer: L.BALL,
    mask: L.PADDLE | L.BRICK | WALL_LAYER,
    data: { type: 'ball' },
  });
  b._pierce = throughOn();
  balls.push(b);
  return b;
}

function serveBall() {
  for (const b of balls) world.remove(b);
  balls = [];
  makeBall(paddle.x, paddle.y - PADDLE_H / 2 - BALL_R - 1)._serving = true;
  state = 'serve';
}

function targetSpeed() {
  let sp = levelSpeed;
  if (slowOn()) sp *= 0.66;
  if (fastOn()) sp *= 1.3;
  return sp;
}

function launchBall(b) {
  const sp = targetSpeed();
  // Serving balls launch at a random pitch; caught balls launch at the angle
  // the paddle is aimed at (see onPaddleHit / catch).
  let t = b._stuck
    ? Math.max(-1, Math.min(1, b._stuckOff / (paddle.w / 2)))
    : (Math.random() < 0.5 ? -1 : 1) * 0.55;
  let ang = t * (70 * Math.PI / 180);
  const minA = 18 * Math.PI / 180;
  ang = Math.sign(ang || 1) * Math.max(minA, Math.abs(ang));
  b.vx = Math.sin(ang) * sp;
  b.vy = -Math.cos(ang) * sp;
  b._serving = false;
  b._stuck = false;
  state = 'play';
  gctx.audio.sfx('start');
}

// ---- collision callbacks ----------------------------------------------------------

// Paddle hit: angle the rebound off where the ball struck (classic breakout).
// The engine's generic reflection already ran — we override with a controlled
// launch so the ball can't leave the paddle at a boring 90°. While the catch
// capsule is active the ball sticks instead, so you can aim.
function onPaddleHit(self, contact) {
  const other = contact.other;
  if (!other || !other.data) return;
  if (other.data.type !== 'ball' || other._serving || other._stuck) return;
  if (catchOn()) {
    other._stuck = true;
    other._stuckOff = Math.max(-self.w / 2 + 4, Math.min(self.w / 2 - 4, other.x - self.x));
    other.vx = 0;
    other.vy = 0;
    gctx.audio.sfx('catch');
    return;
  }
  const t = Math.max(-1, Math.min(1, (other.x - self.x) / (self.w / 2)));
  const ang = t * (Math.PI / 3);                 // up to ±60°
  const sp = targetSpeed();
  other.vx = Math.sin(ang) * sp;
  other.vy = -Math.cos(ang) * sp;
  if (other.vx === 0) other.vx = sp * 0.2 * (Math.random() < 0.5 ? -1 : 1);
  gctx.audio.sfx('paddle');
  spawnBurst(other.x, other.y, '#ffffff', 4, 70);
}

// A ball clipped a brick: reveal hidden bricks, chip hp, or detonate bombs.
function hitBrick(b) {
  if (b.dead || state === 'clear') return;
  const d = b.data;
  if (d.kind === 'X') {                         // iron — bounce only
    d.flash = 0.12;
    gctx.audio.sfx('hit');
    return;
  }
  if (d.kind === '?') {                         // hidden — materialize, no score yet
    d.kind = '#';
    d.hp = 1;
    d.flash = 0.3;
    gctx.audio.sfx('hit');
    return;
  }
  d.hp--;
  d.flash = 0.12;
  if (d.hp <= 0) destroyBrick(b);
  else gctx.audio.sfx('hit');
}

// Lasers punch straight through anything destructible — including gold.
function laserHit(b) {
  if (b.dead || state === 'clear') return;
  if (b.data.kind === 'X') {
    b.data.flash = 0.12;
    gctx.audio.sfx('hit');
    return;
  }
  destroyBrick(b);
}

function destroyBrick(b) {
  if (b.dead || state === 'clear') return;
  const d = b.data;
  if (d.kind === 'X') return;
  world.remove(b);
  destructibleCount--;
  addScore(d.score);
  spawnBurst(b.x, b.y, d.base, 12, 130);
  shake = Math.min(shake + 1.5, 5);
  if (d.kind === 'B') { explode(b); return; }   // chain-reaction bomb
  gctx.audio.sfx('brick');
  maybeDrop(b.x, b.y);
  if (destructibleCount <= 0) levelCleared();
}

function explode(b) {
  gctx.audio.sfx('boom');
  shake = Math.min(shake + 6, 9);
  spawnBurst(b.x, b.y, '#ff9e3d', 26, 220);
  const hits = world.queryCircle(b.x, b.y, 84,
    bd => bd.data && bd.data.type === 'brick' && !bd.dead);
  for (const h of hits) if (h !== b) destroyBrick(h);
  if (destructibleCount <= 0) levelCleared();
}

function catchDrop(d) {
  if (d.dead) return;
  world.remove(d);
  const cap = CAPSULES[d.data.letter];
  gctx.audio.sfx('power');
  spawnBurst(d.x, d.y, cap.color, 10, 120);
  applyCapsule(cap.effect);
  statusMsg = cap.label + (cap.effect === 'points' ? ' POINTS!' : '!');
  statusUntil = now() + 2;
}

function applyCapsule(effect) {
  const baseW = paddle.data.baseW;
  if (effect === 'expand')       paddle.w = Math.min(baseW * 1.55, 110);
  else if (effect === 'shrink')  paddle.w = Math.max(baseW * 0.62, 38);
  else if (effect === 'slow')    slowUntil = now() + 10;
  else if (effect === 'fast')    fastUntil = now() + 10;
  else if (effect === 'laser')   laserUntil = now() + 12;
  else if (effect === 'catch')   catchUntil = now() + 12;
  else if (effect === 'through') { throughUntil = now() + 10; for (const b of balls) b._pierce = true; }
  else if (effect === 'multi')   multiSplit();
  else if (effect === 'life')    { lives = Math.min(lives + 1, LIFE_MAX); gctx.hud.setLives(lives); }
  else if (effect === 'points')  addScore(500);
}

function multiSplit() {
  const src = balls.filter(b => !b.dead && !b._stuck);
  for (const b of src) {
    if (balls.length >= MULTI_MAX) break;
    const ang = Math.atan2(b.vy, b.vx);
    for (const da of [0.5, -0.5]) {
      if (balls.length >= MULTI_MAX) break;
      const nb = makeBall(b.x + Math.cos(ang + da) * BALL_R * 2, b.y + Math.sin(ang + da) * BALL_R * 2);
      const sp = Math.hypot(b.vx, b.vy) || targetSpeed();
      nb.vx = Math.cos(ang + da) * sp;
      nb.vy = Math.sin(ang + da) * sp;
    }
  }
}

function maybeDrop(x, y) {
  if (!POWERUPS) return;
  if (Math.random() >= DROP_CHANCE) return;
  const letters = Object.keys(CAPSULES);
  const letter = letters[Math.floor(Math.random() * letters.length)];
  const cap = CAPSULES[letter];
  const d = world.circle({
    x, y, r: 6, vy: 80, gravityScale: 0, sensor: true,  // constant fall speed
    layer: L.DROP, mask: L.PADDLE,           // falls THROUGH bricks & balls
    onCollide: () => catchDrop(d),           // only ever overlaps the paddle
    data: { type: 'drop', letter, color: cap.color },
  });
  drops.push(d);
}

function levelCleared() {
  state = 'clear';
  clearTimer = 1.4;
  const bonus = 500 + level * 100;
  addScore(bonus);
  gctx.audio.sfx('levelup');
  statusMsg = 'LEVEL ' + level + ' CLEAR!  +' + bonus;
  statusUntil = now() + 2.5;
  for (const b of balls) world.remove(b);
  balls = [];
}

// ---- helpers -------------------------------------------------------------------------

function addScore(n) {
  score += n;
  gctx.hud.setScore(score);
}

function spawnBurst(x, y, color, count, speed) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    const life = 0.3 + Math.random() * 0.35;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life, max: life, color });
  }
}

function fireLasers() {
  const y = paddle.y - PADDLE_H / 2 - 4;
  for (const off of [-paddle.w / 2 + 7, paddle.w / 2 - 7]) {
    const bolt = world.rect({
      x: paddle.x + off, y, w: 2.5, h: 8, sensor: true,
      vy: -LAZ_SPEED, gravityScale: 0, layer: L.LASER, mask: L.BRICK,
      data: { type: 'laser' },
    });
    lasers.push(bolt);
    spawnBurst(paddle.x + off, y, '#ff2d95', 3, 60);
  }
  gctx.audio.sfx('laser');
}

// Fireball through-bricks: the ball's mask drops BRICK, so the engine never
// stops it — instead we sweep the segment it travelled this frame and pop
// every brick it overlaps, with a few sub-samples so it can't tunnel.
function pierceCheck(b, px, py) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - px, b.y - py) / 3));
  for (let i = 0; i <= steps; i++) {
    const sx = px + (b.x - px) * i / steps;
    const sy = py + (b.y - py) * i / steps;
    const hits = world.queryCircle(sx, sy, BALL_R + 1,
      bd => bd.data && bd.data.type === 'brick' && !bd.dead);
    for (const h of hits) destroyBrick(h);
    if (state !== 'play') return;
  }
}

function updateHudExtra() {
  const t = now();
  const parts = [];
  if (laserOn()) parts.push('LASER');
  if (catchOn()) parts.push('CATCH');
  if (throughOn()) parts.push('FIREBALL');
  if (slowOn()) parts.push('SLOW');
  if (fastOn()) parts.push('FAST');
  let line = parts.join('  ');
  if (statusUntil > t && statusMsg) line = statusMsg + (line ? '   |   ' + line : '');
  if (state === 'serve') line = 'PRESS SPACE / CLICK TO LAUNCH' + (line ? '  ·  ' + line : '');
  gctx.hud.setExtra(line);
}

// ---- the run ---------------------------------------------------------------------------

function update(dt, ctx) {
  const input = ctx.input;
  const t = now();

  // --- expire power-up timers -------------------------------------------------
  if (slowUntil > 0 && t > slowUntil) slowUntil = 0;
  if (fastUntil > 0 && t > fastUntil) fastUntil = 0;
  if (laserUntil > 0 && t > laserUntil) laserUntil = 0;
  if (catchUntil > 0 && t > catchUntil) catchUntil = 0;
  if (throughUntil > 0 && t > throughUntil) { throughUntil = 0; for (const b of balls) b._pierce = false; }

  // --- paddle: mouse position wins, else keyboard ---------------------------
  if (ctx.pointer && ctx.pointer.active) {
    const half = paddle.w / 2;
    const target = Math.max(half + 4, Math.min(W - half - 4, ctx.pointer.x));
    paddle.vx = Math.max(-PADDLE_SPEED, Math.min(PADDLE_SPEED, (target - paddle.x) * 16));
  } else {
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    paddle.vx = dir * PADDLE_SPEED;
  }
  paddle.vy = 0;

  // --- serve / launch / level transitions ------------------------------------
  if (state === 'serve') {
    for (const b of balls) {
      if (!b._serving) continue;
      b.x = paddle.x;                                    // glued to the paddle
      b.y = paddle.y - PADDLE_H / 2 - BALL_R - 1;
      b.vx = b.vy = 0;
      if (input.pressed('jump') || input.pressed('confirm') || (ctx.pointer && ctx.pointer.down)) {
        launchBall(b);
      }
    }
  } else if (state === 'clear') {
    clearTimer -= dt;
    if (clearTimer <= 0) {
      level++;
      levelSpeed = BASE_BALL_SPEED + (level - 1) * 30;
      buildLevel();
      serveBall();
      gctx.hud.setTimerRaw('LEVEL ' + level);
    }
  } else if (state === 'play') {
    // --- stuck (catch capsule) balls follow the paddle & can be aimed -------
    for (const b of balls) {
      if (!b._stuck) continue;
      b._stuckOff = Math.max(-paddle.w / 2 + 4, Math.min(paddle.w / 2 - 4, b._stuckOff));
      b.x = paddle.x + b._stuckOff;
      b.y = paddle.y - PADDLE_H / 2 - BALL_R - 1;
      b.vx = b.vy = 0;
      if (input.pressed('jump') || input.pressed('confirm') || (ctx.pointer && ctx.pointer.down)) {
        launchBall(b);
      }
    }
    // --- laser cannon --------------------------------------------------------
    if (laserOn()) {
      laserCd -= dt;
      if (laserCd <= 0) {
        laserCd = input.isDown('fire') ? 0.32 : 0.95;
        fireLasers();
      }
    }
  }

  // --- keep fireball mask in sync ---------------------------------------------
  for (const b of balls) {
    const want = b._pierce && !b._stuck;
    const has = (b.mask & L.BRICK) === 0;
    if (want && !has) b.mask = L.PADDLE | WALL_LAYER;
    else if (!want && has) b.mask = L.PADDLE | L.BRICK | WALL_LAYER;
    b._px = b.x;                                       // for pierce sweeps
    b._py = b.y;
  }

  // --- the physics simulation (the engine does the real work) ----------------
  world.step(dt);

  // --- fireball pierce sweeps + flame trail ------------------------------------
  if (state === 'play') {
    for (const b of balls) {
      if (b.dead || b._stuck) continue;
      if (b._pierce) {
        pierceCheck(b, b._px, b._py);
        if (Math.random() < 0.45) {
          particles.push({
            x: b.x + (Math.random() - 0.5) * 4, y: b.y + BALL_R + 1,
            vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 30,
            life: 0.25, max: 0.25, color: Math.random() < 0.5 ? '#ff9e3d' : '#ff6b35',
          });
        }
      }
    }
  }

  // --- cosmetic bookkeeping ----------------------------------------------------
  for (const b of bricks) if (!b.dead && b.data.flash > 0) b.data.flash -= dt;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  shake = Math.max(0, shake - dt * 10);

  // --- lasers cleanup ------------------------------------------------------------
  for (let i = lasers.length - 1; i >= 0; i--) {
    if (lasers[i].dead || lasers[i].y < -16) {
      world.remove(lasers[i]);
      lasers.splice(i, 1);
    }
  }

  // --- balls lost / stuck -------------------------------------------------------
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    if (b.dead) { balls.splice(i, 1); continue; }
    if (b._stuck || b._serving) continue;
    if (b.y - BALL_R > H + 40) {
      world.remove(b);
      balls.splice(i, 1);
    } else if (Math.abs(b.vy) < 30 && state === 'play') {
      b.vy = -60;                                      // never let it stall flat
    }
  }
  if (balls.length === 0 && state !== 'clear') {       // 'clear' legitimately has none
    lives--;
    gctx.hud.setLives(lives);
    gctx.audio.sfx('die');
    if (lives <= 0) {
      ctx.hud.setExtra('GAME OVER');
      ctx.gameOver();
      return;
    }
    serveBall();
  }

  // --- drops that fell past the paddle ------------------------------------------
  for (let i = drops.length - 1; i >= 0; i--) {
    if (drops[i].dead || drops[i].y > H + 40) {
      world.remove(drops[i]);
      drops.splice(i, 1);
    }
  }

  updateHudExtra();
}

function render(g, dt, ctx) {
  const t = ctx.wallTime();
  g.save();
  g.translate(shake ? (Math.random() - 0.5) * shake : 0, shake ? (Math.random() - 0.5) * shake : 0);

  // background
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#160b38');
  grad.addColorStop(0.6, '#0a0420');
  grad.addColorStop(1, '#05010f');
  g.fillStyle = grad;
  g.fillRect(-8, -8, W + 16, H + 16);

  // faint grid
  g.strokeStyle = 'rgba(45, 225, 255, 0.06)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 24; x < W; x += 24) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 24; y < H; y += 24) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();

  // bricks
  for (const b of bricks) {
    if (b.dead) continue;
    const d = b.data;
    const x = b.x - BRICK_W / 2, y = b.y - BRICK_H / 2;
    if (d.kind === '?') {                       // hidden — faint outline only
      g.strokeStyle = 'rgba(155, 229, 100, 0.22)';
      g.strokeRect(x + 0.5, y + 0.5, BRICK_W - 1, BRICK_H - 1);
      continue;
    }
    g.fillStyle = d.base;
    g.fillRect(x, y, BRICK_W, BRICK_H);
    if (d.kind === 'X') {                       // indestructible iron — moving stripes
      g.save();
      g.beginPath(); g.rect(x, y, BRICK_W, BRICK_H); g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.32)';
      g.lineWidth = 3;
      for (let i = -1; i < 3; i++) {
        const sx = x + i * 12 + (t * 10 % 12);
        g.beginPath(); g.moveTo(sx, y); g.lineTo(sx + BRICK_H, y + BRICK_H); g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y, BRICK_W, 2);
      g.restore();
    } else if (d.kind === 'G') {                // gold — sheen + remaining-hit pips
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + 2, y + 1, 5, BRICK_H - 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < d.hp; i++) g.fillRect(x + 4 + i * 10, y + BRICK_H - 4, 7, 2);
    } else if (d.kind === 'B') {                // bomb — hazard stripes + blinking dot
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(x, y, BRICK_W, 3);
      g.fillRect(x, y + BRICK_H - 3, BRICK_W, 3);
      if (Math.sin(t * 14) > -0.3) {
        g.fillStyle = '#fff';
        g.fillRect(b.x - 3, b.y - 3, 6, 6);
      }
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x, y, BRICK_W, 2);
      g.fillStyle = d.dark;
      g.fillRect(x, y + BRICK_H - 3, BRICK_W, 3);
      if (d.hp > 1) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x, y + 3, BRICK_W, 2);              // silver rivet
      }
    }
    if (d.flash > 0) {
      g.fillStyle = 'rgba(255,255,255,' + Math.min(1, d.flash * 10) + ')';
      g.fillRect(x, y, BRICK_W, BRICK_H);
    }
  }

  // capsules (rotating diamonds with their letter)
  g.font = 'bold 8px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const d of drops) {
    if (d.dead) continue;
    const s = 3.5 + 2.5 * (0.5 + 0.5 * Math.sin(t * 6 + d.x));
    g.save();
    g.translate(d.x, d.y);
    g.rotate(t * 2);
    g.fillStyle = d.data.color;
    g.globalAlpha = 0.92;
    g.fillRect(-s, -s, s * 2, s * 2);
    g.restore();
    g.fillStyle = '#120a28';
    g.fillText(d.data.letter, d.x, d.y + 0.5);
  }
  g.globalAlpha = 1;

  // balls
  for (const b of balls) {
    if (b.dead) continue;
    if (b._pierce) {                              // fireball
      g.fillStyle = 'rgba(255,110,53,0.35)';
      g.beginPath(); g.arc(b.x, b.y, BALL_R + 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff6b35';
      g.beginPath(); g.arc(b.x, b.y, BALL_R + 1, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff0e0';
      g.beginPath(); g.arc(b.x, b.y, BALL_R * 0.7, 0, Math.PI * 2); g.fill();
      continue;
    }
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); g.arc(b.x, b.y, BALL_R + 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#cfe8ff';
    g.beginPath(); g.arc(b.x - 1, b.y - 1, BALL_R * 0.45, 0, Math.PI * 2); g.fill();
  }

  // laser bolts
  for (const lz of lasers) {
    if (lz.dead) continue;
    g.fillStyle = 'rgba(255,45,149,0.35)';
    g.fillRect(lz.x - 2.5, lz.y - 6, 5, 12);
    g.fillStyle = '#ff2d95';
    g.fillRect(lz.x - 1.25, lz.y - 5, 2.5, 10);
    g.fillStyle = '#fff';
    g.fillRect(lz.x - 0.6, lz.y - 4, 1.2, 8);
  }

  // dotted aim guide while serving
  if (state === 'serve' && balls[0] && !balls[0].dead) {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 30; y < balls[0].y; y += 8) g.fillRect(balls[0].x - 1, y, 2, 2);
  }

  // particles
  for (const p of particles) {
    g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    g.fillStyle = p.color;
    g.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  g.globalAlpha = 1;

  // paddle
  if (catchOn()) {                              // sticky glow
    g.fillStyle = 'rgba(155,229,100,0.25)';
    g.fillRect(paddle.x - paddle.w / 2 - 3, paddle.y - paddle.h / 2 - 3, paddle.w + 6, paddle.h + 6);
  }
  g.fillStyle = 'rgba(255, 210, 62, 0.15)';
  g.fillRect(paddle.x - paddle.w / 2 - 2, paddle.y - paddle.h / 2 - 2, paddle.w + 4, paddle.h + 4);
  g.fillStyle = '#7a4f00';
  g.fillRect(paddle.x - paddle.w / 2, paddle.y - paddle.h / 2, paddle.w, paddle.h);
  g.fillStyle = '#ffd23e';
  g.fillRect(paddle.x - paddle.w / 2, paddle.y - paddle.h / 2, paddle.w, 4);
  g.fillStyle = '#fff3c4';
  g.fillRect(paddle.x - paddle.w / 2 + 3, paddle.y - paddle.h / 2 + 1, paddle.w - 6, 2);
  if (laserOn()) {                              // laser barrels
    for (const off of [-paddle.w / 2 + 7, paddle.w / 2 - 7]) {
      g.fillStyle = '#ff2d95';
      g.fillRect(paddle.x + off - 2, paddle.y - paddle.h / 2 - 7, 4, 8);
      g.fillStyle = '#fff';
      g.fillRect(paddle.x + off - 1, paddle.y - paddle.h / 2 - 6, 2, 4);
    }
  }

  g.restore();
}

// ---- module the shell imports ----------------------------------------------------------
const howToPlay = [
  'Move — ARROWS / WASD / MOUSE',
  'Launch — SPACE / CLICK',
  'Fire lasers — hold SPACE / X (when you catch the Z capsule)',
  'Pause — P / ESC',
  'Break every brick. Iron bricks can\'t be broken — skip them.',
  'Capsules: E expand · S shrink · L slow · F fast · M multi-ball ·',
  'Z laser · C catch (aim & release) · T fireball · X extra life · P points',
].join('\n');

const controls = [
  ['ARROWS / WASD / MOUSE', 'MOVE PADDLE'],
  ['SPACE / CLICK', 'LAUNCH BALL'],
  ['SPACE / X (hold)', 'FIRE LASER'],
  ['P / ESC', 'PAUSE'],
];

// Debug / test hook — also handy for playtesting from the devtools console:
//   __brk.get()            snapshot of live state
//   __brk.level(3)         jump straight to level 3
//   __brk.capsule('laser') force a capsule on (expand/shrink/slow/fast/multi/
//                         laser/catch/through/life/points)
window.__brk = {
  get() {
    const kinds = {};
    for (const b of bricks) if (!b.dead) kinds[b.data.kind] = (kinds[b.data.kind] || 0) + 1;
    return {
      state, level, lives, score,
      balls: balls.length,
      stuck: balls.filter(b => b._stuck).length,
      ball0: balls[0] && !balls[0].dead
        ? { x: Math.round(balls[0].x), y: Math.round(balls[0].y), vx: Math.round(balls[0].vx), vy: Math.round(balls[0].vy), serving: !!balls[0]._serving }
        : null,
      bricks: bricks.filter(b => !b.dead).length,
      destructible: destructibleCount,
      lasers: lasers.length,
      drops: drops.length,
      paddleW: paddle ? paddle.w : 0,
      kinds,
      effects: { slow: slowOn(), fast: fastOn(), laser: laserOn(), catch: catchOn(), through: throughOn() },
    };
  },
  level(n) {
    level = Math.max(1, n | 0);
    levelSpeed = BASE_BALL_SPEED + (level - 1) * 30;
    for (const b of bricks) world.remove(b);
    bricks = [];
    for (const b of balls) world.remove(b);
    balls = [];
    buildLevel();
    serveBall();
    gctx.hud.setTimerRaw('LEVEL ' + level);
  },
  capsule(effect) {
    applyCapsule(effect);
    return 'applied ' + effect;
  },
  // Place the first ball at a spot dropping toward the paddle (test harness).
  ball(x, y) {
    const b = balls[0];
    if (!b) return 'no ball';
    b.x = x ?? paddle.x;
    b.y = y ?? 160;
    b.vx = 0;
    b.vy = 200;
    b._serving = false;
    b._stuck = false;
    state = 'play';
    return 'ok';
  },
  // Pop the first live bomb brick (test harness) — triggers the chain.
  bomb() {
    const b = bricks.find(x => !x.dead && x.data.kind === 'B');
    if (!b) return 'no bomb';
    hitBrick(b);
    return 'popped';
  },
  // Hit the first live brick of a given kind (test harness).
  poke(kind) {
    const b = bricks.find(x => !x.dead && x.data.kind === kind);
    if (!b) return 'none of kind ' + kind;
    hitBrick(b);
    return 'hit ' + kind;
  },
};

export default { init, reset, update, render, howToPlay, controls };
