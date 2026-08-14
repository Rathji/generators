// ============================================================================
//  src/main.js — ENTRY POINT for VGN Character Forge
//  ----------------------------------------------------------------------------
//  Reads branding from main.pjs `config`, runs the CRT boot sequence, then
//  shows the TITLE screen (attract mode: chiptune + starfield). Pressing
//  START opens the FORGE (built by src/forge.js). The coin bar with the
//  back-to-hub link is kept from the VGN Generic Template.
//  ============================================================================

import { startBG } from './bg.js';
import { AudioEngine } from './audio.js';
import { initForge } from './forge.js';

const $ = (id) => document.getElementById(id);
const $config = (window.root && window.root.config) || null;

function cfg(name, fallback) {
  const v = $config && $config[name];
  if (v == null) return fallback;
  // perchance nodes expose `.evaluateItem` as an auto-evaluating getter
  const s = (v && typeof v === 'object' && 'evaluateItem' in v) ? v.evaluateItem : v;
  return s === '' || s == null ? fallback : s;
}

const CFG = {
  gameTitle:    cfg('gameTitle', 'VGN CHARACTER FORGE'),
  tagline:      cfg('tagline', 'Forge game characters for VGN games, avatars & chat.'),
  coinPrompt:   cfg('coinPrompt', 'PRESS START TO OPEN THE FORGE'),
  backHubUrl:   cfg('backHubUrl', 'https://perchance.org/vgn-video-game-network'),
  backHubLabel: cfg('backHubLabel', 'RETURN TO VGN HUB'),
  slug:         cfg('slug', 'vgn-character-forge'),
  draftKey:     cfg('draftKey', 'vgn-character-forge-draft'),
  howToUse:     cfg('howToUse', 'VGN CHARACTER FORGE builds SillyTavern-compatible character cards for the Video Game Network.'),
};

// ---- subsystems ---------------------------------------------------------------
const audio = new AudioEngine();
startBG($('backdrop'));
const forge = initForge({ audio, draftKey: CFG.draftKey });

const overlays = {
  boot: $('bootOverlay'),
  title: $('titleOverlay'),
  forge: $('forgeOverlay'),
  howto: $('howtoOverlay'),
};

let screen = 'boot';
let unlocked = false;

function showOverlay(key) {
  for (const k in overlays) overlays[k].classList.remove('show');
  overlays[key].classList.add('show');
}

function goBoot() { screen = 'boot'; showOverlay('boot'); }
function goTitle() { screen = 'title'; showOverlay('title'); }
function goForge() {
  screen = 'forge';
  showOverlay('forge');
  audio.stopMusic();
  audio.sfx('start');
}
function goAbout() { showOverlay('howto'); audio.sfx('select'); }
function goBack() {
  if (screen === 'forge') goForge();
  else goTitle();
}

// Unlock audio on the first gesture; on the title screen this also starts the
// attract-mode chiptune loop.
function unlockOnce() {
  audio.unlock();
  if (!unlocked) {
    unlocked = true;
    if (screen === 'title') audio.startMusic();
  }
  window.removeEventListener('pointerdown', unlockOnce);
  window.removeEventListener('keydown', unlockOnce);
}
window.addEventListener('pointerdown', unlockOnce);
window.addEventListener('keydown', unlockOnce);

// ---- branding -----------------------------------------------------------------
$('titleEl').textContent = CFG.gameTitle;
$('taglineEl').textContent = CFG.tagline;
$('coinPromptTxt').textContent = ' ' + CFG.coinPrompt;
$('bootFoot').textContent = CFG.slug + ' · v1.0.0';
$('forgeTitleEl').textContent = CFG.gameTitle;
$('forgeFoot').textContent = CFG.slug;
const hubLink = $('hubLink');
hubLink.href = CFG.backHubUrl;
hubLink.textContent = '« ' + CFG.backHubLabel + ' »';

// ---- about / how-to ------------------------------------------------------------
$('howToBodyEl').textContent = CFG.howToUse;
$('howToTitleEl').textContent = 'ABOUT & HOW TO USE';

// ---- buttons --------------------------------------------------------------------
$('startBtn').addEventListener('click', () => { audio.unlock(); goForge(); });
$('aboutBtn').addEventListener('click', goAbout);
$('howToBackBtn').addEventListener('click', goBack);

// ---- boot sequence ---------------------------------------------------------------
const BOOT_LINES = [
  '> vgn-video-game-network · character forge v1.0.0',
  '> CRT DISPLAY ............... OK',
  '> CARD FORMAT V3.0 .......... LOADED',
  '> AVATAR SYNTHESIZER ........ ONLINE',
  '> FORGE-CORE AI ............. LINKED',
  '> ALL SYSTEMS NOMINAL — PRESS START',
];
const bootLinesEl = $('bootLines');
let bootLine = 0;

function bootStep() {
  bootLinesEl.textContent += (bootLinesEl.textContent ? '\n' : '') + BOOT_LINES[bootLine];
  bootLine++;
  if (bootLine < BOOT_LINES.length) {
    setTimeout(bootStep, 260 + Math.random() * 140);
  } else {
    setTimeout(goTitle, 700);
  }
}

goBoot();
bootStep();

// Debug hook for playtesting from the devtools console.
window.__vgn = { goTitle, goForge, forge, audio };
