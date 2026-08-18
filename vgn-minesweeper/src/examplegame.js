// ============================================================================
//  EXAMPLE GAME — src/examplegame.js
//  ============================================================================
//  ☠☠☠ THIS IS THE PLACEHOLDER ☠☠☠
//  The shell runs whatever module src/main.js imports. To build YOUR game:
//    1. Create src/mygame.js exporting an object with the hooks below.
//    2. In src/main.js change `import game from './examplegame.js'` →
//       `import game from './mygame.js'`.
//    3. Delete this file (or keep it as a reference).
//  Everything else — loop, pause, audio, HUD, high scores, CRT look — is
//  yours to keep, untouched.
//
//  GAME MODULE API (full write-up in the comment at the top of index.html):
//      init(ctx)        — called once at boot; build your world here
//      reset(ctx)       — called at the start of every run
//      update(dt, ctx)  — FIXED 60 Hz timestep; physics lives here
//      render(g, dt, ctx) — every animation frame; draw in 480×270 units
//  The `ctx` gives you ctx.width / ctx.height / ctx.input / ctx.audio /
//  ctx.hud / ctx.time / ctx.gameOver().
//
//  THE DEMO: a tiny "grab the coins" game. Move with arrows/WASD, jump with
//  Space, grab coins before the 60-second clock runs out. Nothing fancy —
//  exactly enough to prove the shell works and to show the API in action.
//  ============================================================================

import { LOGICAL_W } from './engine.js';

const W = LOGICAL_W;                 // 480 logical px wide
const H = 270;                       // 270 logical px tall
const GROUND = 232;                  // y of the floor top
const GRAVITY = 720;                 // px/s²
const MOVE_SPEED = 150;              // px/s
const JUMP_VEL = -235;               // px/s
const COIN_COUNT = 5;                // coins on screen at once

// Tuning lives in main.pjs' `config` list — read it here the same way the
// shell does, so fork devs can tweak without touching JS. (Fallbacks apply
// if the key is missing.)
const $cfg = (window.root && window.root.config) || null;
function conf(name, fallback) {
  const v = $cfg && $cfg[name];
  if (v == null) return fallback;
  const s = typeof v.evaluateItem === 'function' ? v.evaluateItem : v;
  return s === '' || s == null ? fallback : s;
}
const GAME_TIMER = conf('exampleTimerSeconds', 60);
const COIN_SCORE = conf('exampleCoinScore', 100);

// ---- the hero: a tiny 12×16 pixel sprite ------------------------------------
// Each char is a palette key ('.' = transparent). Rows 0–9 are the head and
// body; the two LEG_* frames (rows 10–15) swap for a walk cycle.
const HERO_TOP = [
  '....KKKK....',
  '...KKKKKK...',
  '...KWWWWK...',
  '...KKKKKK...',
  '....KKKK....',
  '....SSSS....',
  '...CSSSSC...',
  '..CCCCCCCC..',
  '..CBBBBBBC..',
  '..CCCCCCCC..',
];
const LEG_A = [
  '.CCC....CCC.',
  '.CCC....CCC.',
  '.CC......CC.',
  '.CC......CC.',
  '.GG......GG.',
  '............',
];
const LEG_B = [
  '..CCC..CCC..',
  '..CCC..CCC..',
  '...CC..CC...',
  '...CC..CC...',
  '...GG..GG...',
  '............',
];
const PALETTE = { K: '#2a2a6e', W: '#e8f4ff', S: '#ffd9a0', C: '#2de1ff', B: '#ffd23e', G: '#ffd23e' };

// ---- game state (module-level: the shell keeps one instance alive) ----------
let hero = null;
let coins = [];
let particles = [];
let stars = [];

// ---- lifecycle hooks ---------------------------------------------------------

function init() {
  stars = [];
  for (let i = 0; i < 26; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * (GROUND - 12),
      ph: Math.random() * Math.PI * 2,
      big: Math.random() < 0.3,
    });
  }
}

function reset(ctx) {
  hero = {
    x: W / 2,
    y: GROUND,
    vx: 0,
    vy: 0,
    onGround: true,
    facing: 1,
    anim: 0,
  };
  coins = [];
  for (let i = 0; i < COIN_COUNT; i++) coins.push(spawnCoin());
  particles = [];

  ctx.hud.setScore(0);
  ctx.hud.setLives(3);
  ctx.hud.setTimer(GAME_TIMER);
  ctx.hud.setExtra('GRAB THE COINS!');
}

function update(dt, ctx) {
  const input = ctx.input;

  // --- move ---
  const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
  hero.vx = dir * MOVE_SPEED;
  if (dir !== 0) {
    hero.facing = dir;
    hero.anim += dt * 2;                       // advance the walk cycle
  }

  // --- jump ---
  if (input.pressed('jump') && hero.onGround) {
    hero.vy = JUMP_VEL;
    hero.onGround = false;
    ctx.audio.sfx('jump');
  }

  // --- physics ---
  hero.vy += GRAVITY * dt;
  hero.x += hero.vx * dt;
  hero.y += hero.vy * dt;
  if (hero.y >= GROUND) {
    hero.y = GROUND;
    hero.vy = 0;
    hero.onGround = true;
  }
  hero.x = Math.max(20, Math.min(W - 20, hero.x));

  // --- collect coins ---
  const heroCx = hero.x;
  const heroCy = hero.y - 24;                  // sprite center (3× scale)
  for (const coin of coins) {
    const dx = coin.x - heroCx;
    const dy = coin.y - heroCy;
    if (dx * dx + dy * dy < 26 * 26) {
      collect(coin, ctx);
    }
  }

  // --- particles ---
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 500 * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // --- the clock ---
  const left = GAME_TIMER - ctx.time();
  if (left <= 0) {
    ctx.gameOver();
    return;
  }
  ctx.hud.setTimer(left);
  ctx.hud.setExtra(left <= 10 ? 'HURRY UP!' : ctx.time() < 3 ? 'GRAB THE COINS!' : '');
}

function render(g, dt, ctx) {
  const t = ctx.wallTime();

  // background wash
  g.fillStyle = '#07031a';
  g.fillRect(0, 0, W, H);

  // faint grid
  g.strokeStyle = 'rgba(45, 225, 255, 0.08)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= W; x += 24) { g.moveTo(x, 0); g.lineTo(x, GROUND); }
  for (let y = 0; y <= GROUND; y += 24) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();

  // twinkling stars
  for (const s of stars) {
    const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.7 + s.ph));
    g.globalAlpha = tw;
    g.fillStyle = s.big ? '#ffffff' : '#9adcff';
    g.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
  }
  g.globalAlpha = 1;

  // floor
  g.fillStyle = '#0d0630';
  g.fillRect(0, GROUND, W, H - GROUND);
  g.fillStyle = '#2de1ff';
  g.fillRect(0, GROUND, W, 2);
  g.fillStyle = '#ff2d95';
  g.fillRect(0, GROUND + 2, W, 2);
  g.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let x = 8; x < W; x += 32) g.fillRect(x, GROUND + 8, 16, 3);

  // coins (the pulse simulates spinning)
  for (const c of coins) {
    const w = Math.max(2, Math.round(5 * (0.8 + 0.2 * Math.sin(t * 5 + c.phase))));
    g.fillStyle = 'rgba(255, 210, 62, 0.15)';
    g.fillRect(Math.round(c.x - w - 2), Math.round(c.y - 3), w * 2 + 4, 6);
    g.fillStyle = '#c98f00';
    g.fillRect(Math.round(c.x - w), Math.round(c.y - 2), w * 2, 4);
    g.fillStyle = '#ffd23e';
    g.fillRect(Math.round(c.x - w), Math.round(c.y - 2), w * 2, 3);
    g.fillStyle = '#fff3c4';
    g.fillRect(Math.round(c.x - w + 1), Math.round(c.y - 2), 2, 1);
  }

  // sparkle particles
  for (const p of particles) {
    g.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
    g.fillStyle = '#ffd23e';
    g.fillRect(Math.round(p.x - 1), Math.round(p.y - 1), 2, 2);
  }
  g.globalAlpha = 1;

  // hero (3× scale → 36×48 px)
  const legFrame = Math.floor(hero.anim * 8) % 2;
  const sprite = HERO_TOP.concat(legFrame ? LEG_B : LEG_A);
  drawSprite(g, sprite, PALETTE,
    Math.round(hero.x - 18), Math.round(hero.y - 48), 3);
}

// ---- helpers -----------------------------------------------------------------

function drawSprite(g, sprite, palette, x, y, scale) {
  for (let r = 0; r < sprite.length; r++) {
    const row = sprite[r];
    for (let c = 0; c < row.length; c++) {
      const col = palette[row[c]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  }
}

function spawnCoin() {
  return {
    x: 30 + Math.random() * (W - 60),
    y: 155 + Math.random() * 47,               // all reachable with a jump
    phase: Math.random() * Math.PI * 2,
  };
}

function collect(coin, ctx) {
  ctx.hud.addScore(COIN_SCORE);
  ctx.audio.sfx('coin');
  for (let i = 0; i < 8; i++) {
    const life = 0.4 + Math.random() * 0.3;
    particles.push({
      x: coin.x,
      y: coin.y,
      vx: (Math.random() - 0.5) * 160,
      vy: -Math.random() * 140,
      life,
      max: life,
    });
  }
  // respawn somewhere else
  const c = spawnCoin();
  coin.x = c.x;
  coin.y = c.y;
  coin.phase = c.phase;
}

// ---- the module the shell imports ---------------------------------------------
export default { init, reset, update, render };
