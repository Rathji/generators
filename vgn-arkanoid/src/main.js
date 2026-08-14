// ============================================================================
//  src/main.js — ENTRY POINT for the VGN physics template shell
//  ----------------------------------------------------------------------------
//  What happens here, in order:
//    1. Read the `config` list from main.pjs (via window.root)
//    2. Build the subsystems: input, audio, HUD, engine
//    3. Wire every button, overlay and state transition
//    4. Run the CRT boot sequence, then hand control to the engine loop
//  You should NOT need to edit this file to ship a game — pick a demo in
//  main.pjs `config.demoGame` (breakout | pong | none), or drop your own
//  module into the DEMOS map below (see index.html, "GAME MODULE API").
//  ============================================================================

import { GameEngine, STATES } from './engine.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { HUD, pad6 } from './hud.js';
import breakoutGame from './breakoutgame.js';
import pongGame from './ponggame.js';

// Which demo runs is set in main.pjs `config.demoGame` (breakout | pong |
// none). Both demos are full games built on src/physics.js — pick one or
// write your own module and register it in the DEMOS map below.
const DEMOS = { breakout: breakoutGame, pong: pongGame };
const blankGame = {
  init() {}, reset() {}, update() {},
  render(g) { g.fillStyle = '#07031a'; g.fillRect(0, 0, 480, 270); },
};

const $ = (id) => document.getElementById(id);

// ---- 1. configuration (from the `config` list in main.pjs) ------------------
const $config = (window.root && window.root.config) || null;

function cfg(name, fallback) {
  const v = $config && $config[name];
  if (v == null) return fallback;
  const s = typeof v.evaluateItem === 'function' ? v.evaluateItem : v;
  return s === '' || s == null ? fallback : s;
}

const CFG = {
  gameTitle:    cfg('gameTitle', 'VGN GENERIC TEMPLATE'),
  tagline:      cfg('tagline', 'Plug in any game. Ship it on VGN.'),
  coinPrompt:   cfg('coinPrompt', 'INSERT COIN ▶ PRESS START'),
  backHubUrl:   cfg('backHubUrl', 'https://perchance.org/vgn-video-game-network'),
  backHubLabel: cfg('backHubLabel', 'RETURN TO VGN HUB'),
  highScoreKey: cfg('highScoreKey', 'vgn-generic-template-best'),
  slug:         cfg('titleCfg', 'vgn-generic-template'),
  howToPlay:    cfg('howToPlay', 'Move — ARROWS / WASD\nJump — SPACE\nPause — P'),
  demoGame:     cfg('demoGame', 'breakout'),
};

const DEFAULT_CONTROLS = [
  ['ARROWS / WASD', 'MOVE'],
  ['SPACE / W / UP / Z', 'JUMP'],
  ['P / ESC', 'PAUSE'],
  ['ENTER', 'START / CONFIRM'],
];

// ---- 2. subsystems ------------------------------------------------------------
const input = new Input();
const audio = new AudioEngine();
const hud = new HUD({
  hudEl: $('hud'),
  scoreEl: $('scoreEl'),
  livesEl: $('livesEl'),
  timerEl: $('timerEl'),
  extraEl: $('hudExtraEl'),
});

// Which demo game runs is chosen in main.pjs `config.demoGame`
// (breakout | pong | none). The demos export their own how-to text and
// controls table, which the shell uses to build the How-To overlay.
const demoName = String(CFG.demoGame).toLowerCase();
const activeGame = demoName === 'none' ? blankGame : (DEMOS[demoName] || breakoutGame);
const CONTROLS = activeGame.controls || DEFAULT_CONTROLS;

const engine = new GameEngine({
  canvas: $('gameCanvas'),
  input,
  audio,
  hud,
  game: activeGame,
  onTick: onMenuTick,          // hoisted function declarations — see below
  onStateChange: onStateChange,
});

// ---- 3. wiring: high score, overlays, buttons ---------------------------------
let highScore = loadHigh();

const overlays = {
  boot: $('bootOverlay'),
  title: $('titleOverlay'),
  pause: $('pauseOverlay'),
  gameOver: $('gameOverOverlay'),
  howto: $('howtoOverlay'),
};

const titleHiScoreEl = $('titleHiScoreEl');
const gameOverStatsEl = $('gameOverStatsEl');
const newHiBanner = $('newHiBanner');

// Show exactly the overlay(s) appropriate to the current engine state.
function renderOverlays() {
  for (const key in overlays) overlays[key].classList.remove('show');
  switch (engine.state) {
    case STATES.BOOT:      overlays.boot.classList.add('show'); hud.hide(); break;
    case STATES.TITLE:     overlays.title.classList.add('show'); hud.hide(); break;
    case STATES.PLAYING:   hud.show(); break;
    case STATES.PAUSED:    overlays.pause.classList.add('show'); hud.show(); break;
    case STATES.GAME_OVER: overlays.gameOver.classList.add('show'); hud.show(); break;
  }
}

// React to every state change: swap overlays + drive the audio.
function onStateChange(prev, next) {
  if (next === STATES.TITLE) {
    renderOverlays();
    titleHiScoreEl.textContent = 'HI-SCORE ' + pad6(highScore);
    audio.stopMusic();
  } else if (next === STATES.PLAYING) {
    renderOverlays();
    if (prev === STATES.PAUSED) {
      audio.setMusicLevel(0.5);                 // resuming: keep the music running
    } else {
      audio.sfx('start');
      audio.startMusic();
    }
  } else if (next === STATES.PAUSED) {
    renderOverlays();
    audio.sfx('pause');
    audio.setMusicLevel(0.16);                  // duck the music while paused
  } else if (next === STATES.GAME_OVER) {
    renderOverlays();
    audio.stopMusic();
    audio.sfx('gameover');
    const final = engine.finalScore;
    const isNewHi = final > highScore && final > 0;
    if (isNewHi) { highScore = final; saveHigh(final); }
    gameOverStatsEl.replaceChildren(
      statLine('FINAL SCORE  ' + pad6(final)),
      statLine('HI-SCORE  ' + pad6(highScore), true),
    );
    newHiBanner.textContent = isNewHi ? '★ NEW HI-SCORE! ★' : '';
  }
}

function statLine(text, gold) {
  const div = document.createElement('div');
  div.textContent = text;
  if (gold) div.style.color = 'var(--clr-gold)';
  return div;
}

// Menu-level keyboard handling, run once per animation frame (before update).
function onMenuTick() {
  switch (engine.state) {
    case STATES.TITLE:
    case STATES.GAME_OVER:
      if (input.pressed('start') || input.pressed('confirm')) startGame();
      break;
    case STATES.PLAYING:
      if (input.pressed('pause')) engine.pause();
      break;
    case STATES.PAUSED:
      if (input.pressed('pause') || input.pressed('start') || input.pressed('confirm')) {
        engine.resume();
        input.clearEdges();
      }
      break;
  }
}

// Start (or restart) a run. Called by START / CONTINUE / RESTART buttons and
// by Enter/Space on the title & game-over screens.
function startGame() {
  audio.unlock();               // browser autoplay gate — this IS the gesture
  engine.startRun();            // resets the game module, state → PLAYING
  input.clearEdges();           // the key that started the run mustn't jump
}

function openHowTo() {
  for (const key in overlays) overlays[key].classList.remove('show');
  overlays.howto.classList.add('show');
  audio.sfx('select');
}

function closeHowTo() {
  renderOverlays();
  audio.sfx('select');
}

// ---- high-score persistence (localStorage; failures are silently ignored) ----
function loadHigh() {
  try { return parseInt(localStorage.getItem(CFG.highScoreKey) || '0', 10) || 0; }
  catch { return 0; }
}
function saveHigh(n) {
  try { localStorage.setItem(CFG.highScoreKey, String(n)); } catch { /* no-op */ }
}

// ---- auto-pause when the tab/window loses focus -------------------------------
function handleBlur() {
  input.clear();                // don't let keys get stuck
  if (engine.state === STATES.PLAYING) engine.pause();
}
window.addEventListener('blur', handleBlur);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) handleBlur();
});

// ---- autoplay safety net: unlock audio on the very first gesture --------------
function unlockAudioOnce() {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudioOnce);
  window.removeEventListener('keydown', unlockAudioOnce);
}
window.addEventListener('pointerdown', unlockAudioOnce);
window.addEventListener('keydown', unlockAudioOnce);

// ---- 4. boot sequence (CRT power-on) -------------------------------------------
const BOOT_LINES = [
  '> vgn-video-game-network  physics template v1.1.0',
  '> CRT DISPLAY ........... OK',
  '> INPUT DEVICE .......... OK',
  '> AUDIO CHIP VGN-2.0 ..... OK',
  '> PHYSICS ENGINE VGN-1.0 . OK',
  '> GAME MODULE ............ OK',
  '> ALL SYSTEMS NOMINAL — INSERT COIN TO BEGIN',
];
const bootLinesEl = $('bootLines');
let bootLine = 0;
let bootTimer = 0;

function bootStep() {
  bootLinesEl.textContent += (bootLinesEl.textContent ? '\n' : '') + BOOT_LINES[bootLine];
  bootLine++;
  if (bootLine < BOOT_LINES.length) {
    bootTimer = setTimeout(bootStep, 280 + Math.random() * 160);
  } else {
    bootTimer = setTimeout(() => engine.finishBoot(), 800);
  }
}

// ---- button wiring --------------------------------------------------------------
$('startBtn').addEventListener('click', startGame);
$('continueBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', () => { engine.resume(); input.clearEdges(); });
$('pauseRestartBtn').addEventListener('click', startGame);
$('quitToTitleBtn').addEventListener('click', () => engine.toTitle());
$('gameOverTitleBtn').addEventListener('click', () => engine.toTitle());
$('howtoBtn').addEventListener('click', openHowTo);
$('pauseHowtoBtn').addEventListener('click', openHowTo);
$('howToBackBtn').addEventListener('click', closeHowTo);

// ---- branding (from main.pjs config) ----------------------------------------------
$('titleEl').textContent = CFG.gameTitle;
$('taglineEl').textContent = CFG.tagline;
$('coinPromptTxt').textContent = ' ' + CFG.coinPrompt;
$('titleHiScoreEl').textContent = 'HI-SCORE ' + pad6(highScore);
$('bootFoot').textContent = CFG.slug + ' · v1.0.0';
const hubLink = $('hubLink');
hubLink.href = CFG.backHubUrl;
hubLink.textContent = '« ' + CFG.backHubLabel + ' »';

// ---- how-to-play screen content ------------------------------------------------------
$('howToTitleEl').textContent = 'HOW TO PLAY';
$('howToBodyEl').textContent = activeGame.howToPlay || CFG.howToPlay;
const table = $('howToTable');
for (const [key, val] of CONTROLS) {
  const tr = document.createElement('tr');
  const tdKey = document.createElement('td'); tdKey.textContent = key;
  const tdVal = document.createElement('td'); tdVal.textContent = val;
  tr.append(tdKey, tdVal);
  table.appendChild(tr);
}
const titleControlsEl = document.querySelector('.title-controls');
if (titleControlsEl) {
  titleControlsEl.textContent = CONTROLS.map(([k, v]) => k + ' — ' + v).join('   ·   ');
}
$('howToNoteEl').textContent =
  "You're playing a demo on the VGN 2D physics engine (src/physics.js). Pick the other demo " +
  "in main.pjs `config.demoGame` (breakout | pong | none), or write your own module — the " +
  'shell keeps all of this: loop, pause, audio, HUD, high scores, CRT look.';

// ---- 5. go -----------------------------------------------------------------------------
input.attach();
activeGame.init(engine.gameCtx);
bootStep();
engine.start();

// Debug / console hook — handy for playtesting the shell from the devtools
// console (e.g. `__vgn.engine.pause()`, `__vgn.start()`). Not used by the app.
window.__vgn = { engine, start: startGame };
