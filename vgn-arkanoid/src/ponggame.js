// ============================================================================
//  PONG — src/ponggame.js
//  ============================================================================
//  The second full game on src/physics.js — proof the same engine covers a
//  different genre with zero changes. Two dynamic paddles, a fast circle
//  ball, angle-dependent paddle bounces (classic pong: where you hit decides
//  where it goes), and a top/bottom wall pair with no side walls so the ball
//  can score. Player 1 is W/S, Player 2 is ↑/↓ or a config-switchable AI.
//
//  TUNING: pongWinScore, pongAi, pongBallSpeed, pongPaddleSpeed in main.pjs.
//  ============================================================================

import { World, WALL_LAYER } from './physics.js';
import { LOGICAL_W, LOGICAL_H } from './engine.js';

const W = LOGICAL_W;
const H = LOGICAL_H;

const L = { BALL: 1, PADDLE: 2 };

const $cfg = (window.root && window.root.config) || null;
function conf(name, fallback) {
  const v = $cfg && $cfg[name];
  if (v == null) return fallback;
  const s = typeof v.evaluateItem === 'function' ? v.evaluateItem : v;
  return s === '' || s == null ? fallback : s;
}

const PADDLE_SPEED = conf('pongPaddleSpeed', 320);
const BALL_SPEED = conf('pongBallSpeed', 300);
const WIN_SCORE = conf('pongWinScore', 7);
const AI = conf('pongAi', true);
const AI_SKILL = 3.0;
const PHYS_GRAVITY = conf('physicsGravity', 0);

const PADDLE_W = 8, PADDLE_H = 46;
const BALL_R = 4;

// ---- module state ---------------------------------------------------------------------
let gctx = null;
let world = null;
let p1 = null;
let p2 = null;
let ball = null;
let score1 = 0;
let score2 = 0;
let state = 'serve';          // serve | play | win
let serveTimer = 0;
let serveDir = 1;
let winTimer = 0;
let trail = [];

// ---- lifecycle -------------------------------------------------------------------------

function init() { /* everything is built fresh in reset() */ }

function reset(ctx) {
  gctx = ctx;
  world = new World({ width: W, height: H, gravity: PHYS_GRAVITY, walls: ['top', 'bottom'] });

  const paddleOpts = {
    w: PADDLE_W, h: PADDLE_H, restitution: 1, gravityScale: 0,
    layer: L.PADDLE, mask: L.BALL | WALL_LAYER, data: { type: 'paddle' },
  };
  p1 = world.rect({ x: 26, y: H / 2, ...paddleOpts });
  p2 = world.rect({ x: W - 26, y: H / 2, ...paddleOpts });

  ball = world.circle({
    x: W / 2, y: H / 2, r: BALL_R, restitution: 1, gravityScale: 0,
    layer: L.BALL, mask: L.PADDLE | WALL_LAYER,
    onCollide: onBallHit, data: { type: 'ball' },
  });

  score1 = 0; score2 = 0;
  state = 'serve'; serveTimer = 0.9; winTimer = 0; trail = [];
  serveDir = Math.random() < 0.5 ? 1 : -1;
  centerBall();

  ctx.hud.setScore(0);
  ctx.hud.setLives(0);
  ctx.hud.setTimerRaw('TO ' + WIN_SCORE);
  ctx.hud.setExtra('FIRST TO ' + WIN_SCORE);
}

function centerBall() {
  ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0;
  trail = [];
}

// ---- collision callbacks ---------------------------------------------------------------

function onBallHit(self, contact) {
  const other = contact.other;
  if (!other || !other.data) return;
  if (other.data.type === 'wall') {
    gctx.audio.sfx('select');                       // wall thwack
    return;
  }
  // Paddle — angle the rebound off the hit point (classic pong).
  const rel = Math.max(-1, Math.min(1, (self.y - other.y) / (other.h / 2)));
  const ang = rel * (Math.PI / 3);                  // ±60° from the normal
  const dir = self.x < other.x ? 1 : -1;
  self.vx = Math.cos(ang) * BALL_SPEED * dir;
  self.vy = Math.sin(ang) * BALL_SPEED;
  gctx.audio.sfx('jump');                           // paddle hit
}

// ---- the run ---------------------------------------------------------------------------

function update(dt, ctx) {
  const input = ctx.input;

  // Paddles only ever move vertically; ball hits impart a tiny horizontal
  // impulse, so zero it every frame and keep them near their walls (there
  // are no side walls in pong — the ball must be free to score).
  p1.vx = 0; p2.vx = 0;
  p1.x = Math.max(20, Math.min(110, p1.x));
  p2.x = Math.max(W - 110, Math.min(W - 20, p2.x));

  // --- P1 (left): W / S ------------------------------------------------------
  const p1d = (input.isDown('p1down') ? 1 : 0) - (input.isDown('p1up') ? 1 : 0);
  p1.vy = p1d * PADDLE_SPEED;

  // --- P2 (right): AI or ↑/↓ --------------------------------------------------
  if (AI) {
    // chase the ball when it's coming our way, drift to center otherwise;
    // a little sine wobble keeps it beatable.
    const target = ball.vx > 0 ? ball.y : H / 2;
    const err = Math.sin(ctx.time() * 1.7) * 10;
    const want = (target + err - p2.y) * AI_SKILL;
    p2.vy = Math.max(-PADDLE_SPEED * 0.95, Math.min(PADDLE_SPEED * 0.95, want));
  } else {
    const p2d = (input.isDown('p2down') ? 1 : 0) - (input.isDown('p2up') ? 1 : 0);
    p2.vy = p2d * PADDLE_SPEED;
  }

  // --- serve / scoring / win ---------------------------------------------------
  if (state === 'serve') {
    serveTimer -= dt;
    gctx.hud.setExtra('READY...');
    if (serveTimer <= 0) {
      state = 'play';
      ball.vx = serveDir * BALL_SPEED * 0.9;
      ball.vy = (Math.random() < 0.5 ? -1 : 1) * BALL_SPEED * 0.22;
      const sp = Math.hypot(ball.vx, ball.vy);      // normalize to full speed
      ball.vx *= BALL_SPEED / sp;
      ball.vy *= BALL_SPEED / sp;
      gctx.audio.sfx('start');
    }
  } else if (state === 'play') {
    if (ball.x < -30) scorePoint(2);
    else if (ball.x > W + 30) scorePoint(1);
  } else if (state === 'win') {
    winTimer -= dt;
    if (winTimer <= 0) {
      gctx.hud.setExtra('');
      ctx.gameOver();
    }
  }

  // --- the physics simulation --------------------------------------------------
  world.step(dt);

  // --- ball trail ---------------------------------------------------------------
  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > 14) trail.shift();
}

function scorePoint(who) {
  if (who === 1) score1++; else score2++;
  gctx.hud.setScore(score1);
  gctx.hud.setLives(score2);
  gctx.audio.sfx('coin');
  centerBall();

  if (score1 >= WIN_SCORE || score2 >= WIN_SCORE) {
    state = 'win';
    winTimer = 1.6;
    gctx.hud.setExtra((score1 >= WIN_SCORE ? 'PLAYER 1' : 'PLAYER 2') + ' WINS!');
    return;
  }
  // serve toward the player who conceded the point
  serveDir = who === 1 ? -1 : 1;
  state = 'serve';
  serveTimer = 0.8;
  gctx.hud.setExtra(score1 + ' : ' + score2 + '  —  READY');
}

// ---- rendering --------------------------------------------------------------------------

function render(g, dt, ctx) {
  // background
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b0722');
  grad.addColorStop(1, '#05010f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // dashed center line + circle
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 2;
  g.setLineDash([6, 8]);
  g.beginPath(); g.moveTo(W / 2, 12); g.lineTo(W / 2, H - 12); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.beginPath(); g.arc(W / 2, H / 2, 26, 0, Math.PI * 2); g.stroke();

  // ball trail
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    g.globalAlpha = (i / trail.length) * 0.5;
    g.fillStyle = '#ffffff';
    g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  g.globalAlpha = 1;

  // paddles
  drawPaddle(g, p1);
  drawPaddle(g, p2);

  // ball
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.beginPath(); g.arc(ball.x, ball.y, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); g.fill();
}

function drawPaddle(g, p) {
  const x = p.x - p.w / 2, y = p.y - p.h / 2;
  g.fillStyle = '#0d2a3a';
  g.fillRect(x, y, p.w, p.h);
  g.fillStyle = '#2de1ff';
  g.fillRect(x, y + 2, p.w, p.h - 4);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(x + 1, y + 2, p.w - 2, 2);
}

// ---- module the shell imports ----------------------------------------------------------
const howToPlay = [
  'Player 1 (left) — W / S',
  'Player 2 (right) — ↑ / ↓ (or AI)',
  'Pause — P / ESC',
  'First to ' + WIN_SCORE + ' wins.',
].join('\n');

const controls = [
  ['W / S', 'PLAYER 1'],
  ['↑ / ↓', 'PLAYER 2'],
  ['P / ESC', 'PAUSE'],
];

export default { init, reset, update, render, howToPlay, controls };
