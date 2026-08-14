// ============================================================================
//  PONG — src/ponggame.js
//  ============================================================================
//  The classic arcade paddle game, on the shell's physics engine. Two paddles,
//  a fast ball, angle-dependent paddle bounces (where you hit decides where it
//  goes), a rally speed-up and a first-to-N match. Player 1 is W/S or the
//  mouse/touch; Player 2 is ↑/↓ or a CPU opponent with human-ish errors.
//
//  TUNING: pongWinScore, pongAi, pongBallSpeed, pongMaxSpeed,
//  pongPaddleSpeed, pongPaddleSize in main.pjs.
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

const PADDLE_SPEED = conf('pongPaddleSpeed', 330);
const BALL_SPEED = conf('pongBallSpeed', 300);
const MAX_SPEED = conf('pongMaxSpeed', 430);
const WIN_SCORE = conf('pongWinScore', 7);
const AI = conf('pongAi', true);
const PADDLE_H = conf('pongPaddleSize', 46);

const PADDLE_W = 8;
const BALL_R = 4;
const MAX_ANGLE = Math.PI / 3;              // ±60° rebound off the normal
const AI_SKILL = 3.2;
const AI_MAX = 0.94;                        // fraction of full paddle speed

// ---- module state -------------------------------------------------------------
let gctx = null;
let world = null;
let p1 = null;
let p2 = null;
let ball = null;
let score1 = 0;
let score2 = 0;
let state = 'serve';                        // serve | play | win
let serveTimer = 0;
let winTimer = 0;
let serveDir = 1;
let rally = 0;                              // consecutive paddle hits — ball speeds up
let aiErr = 0;
let aiErrT = 0;
let trail = [];
let flashTxt = '';
let flashT = 0;

// ---- lifecycle -----------------------------------------------------------------
function init() {}

function reset(ctx) {
  gctx = ctx;
  world = new World({ width: W, height: H, gravity: 0, walls: ['top', 'bottom'] });

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
  state = 'serve'; serveTimer = 1.0; winTimer = 0; rally = 0;
  serveDir = Math.random() < 0.5 ? 1 : -1;
  flashTxt = ''; flashT = 0; trail = [];
  centerBall();

  ctx.hud.setScoreRaw('P1  0');
  ctx.hud.setLivesRaw('P2  0');
  ctx.hud.setTimerRaw('FIRST TO ' + WIN_SCORE);
  ctx.hud.setExtra('READY');
}

function centerBall() {
  ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0;
  trail = [];
}

// ---- collision callback ----------------------------------------------------------
function onBallHit(self, contact) {
  const other = contact.other;
  if (!other || !other.data) return;
  if (other.data.type === 'wall') {
    gctx.audio.sfx('pongWall');
    return;
  }
  // Paddle — angle the rebound off where the ball met the paddle (classic pong).
  const rel = Math.max(-1, Math.min(1, (self.y - other.y) / (other.h / 2)));
  const ang = rel * MAX_ANGLE;
  const dir = self.x < other.x ? 1 : -1;
  rally++;
  const sp = Math.min(MAX_SPEED, BALL_SPEED + rally * 9);
  self.vx = Math.cos(ang) * sp * dir;
  self.vy = Math.sin(ang) * sp;
  if (Math.abs(self.vy) < sp * 0.18) self.vy = (self.vy < 0 ? -1 : 1) * sp * 0.18;
  gctx.audio.sfx('paddle');
}

// ---- the run ---------------------------------------------------------------------
function update(dt, ctx) {
  const input = ctx.input;
  const ptr = ctx.pointer;

  // Paddles only ever move vertically; keep them anchored near their walls.
  p1.vx = 0; p2.vx = 0;
  p1.x = Math.max(20, Math.min(110, p1.x));
  p2.x = Math.max(W - 110, Math.min(W - 20, p2.x));

  // --- P1 (left): W/S, or the mouse/touch once it's over the field ---------------
  const p1key = (input.isDown('p1down') ? 1 : 0) - (input.isDown('p1up') ? 1 : 0);
  if (p1key !== 0) {
    p1.vy = p1key * PADDLE_SPEED;
  } else if (ptr.active) {
    const dy = ptr.y - p1.y;
    p1.vy = Math.max(-PADDLE_SPEED, Math.min(PADDLE_SPEED, dy * 12));
  } else {
    p1.vy = 0;
  }

  // --- P2 (right): CPU or ↑/↓ ------------------------------------------------------
  if (AI) {
    // Chases the ball when it's coming our way, drifts to centre otherwise.
    // The error re-rolls every ~0.25 s so the CPU can't be perfect.
    aiErrT -= dt;
    if (aiErrT <= 0) { aiErrT = 0.22 + Math.random() * 0.18; aiErr = (Math.random() - 0.5) * 30; }
    const target = ball.vx > 0 ? ball.y + ball.vy * 0.1 + aiErr : H / 2;
    const want = (target - p2.y) * AI_SKILL;
    p2.vy = Math.max(-PADDLE_SPEED * AI_MAX, Math.min(PADDLE_SPEED * AI_MAX, want));
  } else {
    const p2key = (input.isDown('p2down') ? 1 : 0) - (input.isDown('p2up') ? 1 : 0);
    p2.vy = p2key * PADDLE_SPEED;
  }

  // --- serve / score / win ----------------------------------------------------------
  if (state === 'serve') {
    serveTimer -= dt;
    if (serveTimer <= 0) {
      state = 'play';
      launch();
    }
  } else if (state === 'play') {
    if (ball.x < -30) scorePoint(2);
    else if (ball.x > W + 30) scorePoint(1);
  } else if (state === 'win') {
    winTimer -= dt;
    if (winTimer <= 0) { gctx.hud.setExtra(''); ctx.gameOver(); }
  }

  world.step(dt);

  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > 14) trail.shift();

  if (flashT > 0) flashT -= dt;
}

function launch() {
  const ang = (Math.random() - 0.5) * 1.0;          // ±~29° off the horizontal
  ball.vx = Math.cos(ang) * BALL_SPEED * serveDir;
  ball.vy = Math.sin(ang) * BALL_SPEED;
  gctx.audio.sfx('start');
  flashTxt = 'GO!';
  flashT = 0.5;
}

// who = the player who scored the point.
function scorePoint(who) {
  if (who === 1) score1++; else score2++;
  rally = 0;
  gctx.hud.setScoreRaw('P1  ' + score1);
  gctx.hud.setLivesRaw('P2  ' + score2);
  gctx.audio.sfx('pongScore');
  flashTxt = (who === 1 ? 'PLAYER 1' : 'PLAYER 2') + ' SCORES';
  flashT = 1.1;
  centerBall();

  if (score1 >= WIN_SCORE || score2 >= WIN_SCORE) {
    state = 'win';
    winTimer = 2.2;
    flashTxt = 'PLAYER ' + (who === 1 ? 1 : 2) + ' WINS!';
    flashT = winTimer;
    gctx.hud.setScore(score1 + score2);             // match total → hi-score bookkeeping
    gctx.hud.setTimerRaw(score1 + '  :  ' + score2);
    gctx.hud.setExtra('MATCH OVER');
    return;
  }
  // Serve toward the player who conceded the point.
  serveDir = who === 2 ? -1 : 1;
  state = 'serve';
  serveTimer = 1.0;
  gctx.hud.setExtra('READY');
}

function getResultText() {
  const w = score1 >= score2 ? 1 : 2;
  return [['PLAYER ' + w + ' WINS', true], [score1 + ' : ' + score2]];
}

// ---- rendering ---------------------------------------------------------------------
function render(g, dt, ctx) {
  // court background
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0a0620');
  grad.addColorStop(1, '#04010e');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // centre line + circle
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 2;
  g.setLineDash([7, 9]);
  g.beginPath(); g.moveTo(W / 2, 14); g.lineTo(W / 2, H - 14); g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.arc(W / 2, H / 2, 28, 0, Math.PI * 2); g.stroke();

  // big field scores (classic pong numerals above each side)
  g.textAlign = 'center';
  g.font = "44px 'Press Start 2P', monospace";
  g.shadowColor = '#2de1ff'; g.shadowBlur = 14;
  g.fillStyle = '#2de1ff';
  g.fillText(score1, W / 2 - 74, 54);
  g.shadowColor = '#ff2d95';
  g.fillStyle = '#ff2d95';
  g.fillText(score2, W / 2 + 74, 54);
  g.shadowBlur = 0;

  // ball trail
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    g.globalAlpha = (i / trail.length) * 0.45;
    g.fillStyle = '#ffffff';
    g.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  g.globalAlpha = 1;

  drawPaddle(g, p1, '#2de1ff');
  drawPaddle(g, p2, '#ff2d95');

  // ball (square, like the arcade original — with a soft halo)
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(ball.x - 7, ball.y - 7, 14, 14);
  g.fillStyle = '#ffffff';
  g.fillRect(ball.x - BALL_R, ball.y - BALL_R, BALL_R * 2, BALL_R * 2);

  // centre messages: "READY" pulse while serving, then GO! / SCORES / WINS!
  const txt = flashT > 0 ? flashTxt : (state === 'serve' ? 'READY' : '');
  if (txt) {
    const pulse = state === 'serve'
      ? 0.55 + 0.45 * Math.sin(ctx.wallTime() * 6)
      : Math.min(1, flashT / 0.4);
    g.globalAlpha = Math.max(0, Math.min(1, pulse));
    g.font = "18px 'Press Start 2P', monospace";
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.shadowColor = '#39ff6e'; g.shadowBlur = 16;
    g.fillText(txt, W / 2, H / 2 + 6);
    g.shadowBlur = 0;
    g.globalAlpha = 1;
  }
}

function drawPaddle(g, p, color) {
  const x = p.x - p.w / 2, y = p.y - p.h / 2;
  g.shadowColor = color; g.shadowBlur = 10;
  g.fillStyle = color;
  g.fillRect(x, y, p.w, p.h);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(x + 1, y + 2, 2, p.h - 4);        // hot edge facing the ball
}

// ---- module the shell imports --------------------------------------------------------
const howToPlay = [
  'Player 1 (left) — W / S, or just move the mouse / touch',
  'Player 2 (right) — ↑ / ↓, or the CPU',
  'Pause — P / ESC',
  'First to ' + WIN_SCORE + ' wins the match.',
  'Hitting the ball off-centre angles its return.',
].join('\n');

const controls = [
  ['W / S — MOUSE / TOUCH', 'PLAYER 1'],
  ['↑ / ↓', 'PLAYER 2'],
  ['P / ESC', 'PAUSE'],
];

export default { init, reset, update, render, howToPlay, controls, getResultText };

// Debug / console hook for playtesting — not used by the app.
window.__pong = () => ({
  state, score1, score2, winTimer, serveTimer,
  ball: { x: Math.round(ball.x), y: Math.round(ball.y), vx: +ball.vx.toFixed(1), vy: +ball.vy.toFixed(1) },
  p1: { y: Math.round(p1.y) }, p2: { y: Math.round(p2.y) },
});
window.__pongWin = (who) => scorePoint(who);   // debug: force a point/wins
