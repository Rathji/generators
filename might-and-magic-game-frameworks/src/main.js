import { S, setScreen } from './app.js';
import * as E from './engine.js';
import { runAITurn } from './ai.js';
import { drawMap, MAP_CW, MAP_CH } from './render.js';
import { setupMapCanvas } from './mapui.js';
import { showGameOver, refreshAll, openHeroScreen } from './screens.js';
import { updateTopbar, updateHeroStrip, toast, setMapRedraw, setStripClick, showModal, hideModal } from './hud.js';

const SAVE_KEY = 'mamf-save';

function kv() {
  return (typeof window !== 'undefined' && window.kv) || null;
}

async function loadSave() {
  try {
    const k = kv();
    if (!k) return null;
    const str = await k.mamf.get(SAVE_KEY);
    return str ? E.deserializeGame(str) : null;
  } catch (e) {
    console.warn('load save failed', e);
    return null;
  }
}

async function saveGame() {
  try {
    const k = kv();
    if (!k || !S.game) return;
    await k.mamf.set(SAVE_KEY, E.serializeGame(S.game));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function newGame() {
  const cfg = (window.root && root.gameConfig) || {};
  const w = cfg.mapW || 24;
  const h = cfg.mapH || 16;
  S.game = E.newGame(w, h, (Math.random() * 1e9) | 0);
  S.selectedHeroId = null;
  E.startPlayerTurn(S.game, S.game.players[0]);
  E.autoLevelAI(S.game);
  refreshAll();
  setScreen('map');
  toast('New game started');
  saveGame();
  if (window.__game) window.__game.sync = () => S.game;
}

function endTurn() {
  const game = S.game;
  if (!game || game.gameOver) return;
  if (game.players[game.turn].isAI) return;
  game.turn = (game.turn + 1) % game.players.length;
  if (game.turn === 0) E.newDay(game);
  while (true) {
    if (game.gameOver) break;
    const p = game.players[game.turn];
    E.startPlayerTurn(game, p);
    if (!p.isAI) break;
    runAITurn(game, p);
    game.turn = (game.turn + 1) % game.players.length;
    if (game.turn === 0) E.newDay(game);
  }
  if (game.gameOver) {
    refreshAll();
    showGameOver(game);
    return;
  }
  saveGame();
  refreshAll();
  toast(`Day ${game.day}, week ${game.week} — your turn`, 'news');
}

function init() {
  E.setLogSink(msg => console.log('[game]', msg));
  setupMapCanvas();

  setMapRedraw(() => {
    const cvs = document.getElementById('mapCanvas');
    const ctx = cvs.getContext('2d');
    if (S.game) drawMap(ctx, S.game, S);
  });
  setStripClick(hero => openHeroScreen(S.game, hero));

  document.getElementById('newGameBtn').addEventListener('click', newGame);
  document.getElementById('endTurnBtn').addEventListener('click', endTurn);
  S.onNewGame = () => { hideModal(); newGame(); };

  // continue button if a save exists
  loadSave().then(save => {
    if (save && !save.gameOver) document.getElementById('continueBtn').hidden = false;
  });
  document.getElementById('continueBtn').addEventListener('click', async () => {
    const save = await loadSave();
    if (save) {
      if (save.gameOver) { toast('That game is over — start a new one'); return; }
      S.game = save;
      S.selectedHeroId = null;
      refreshAll();
      setScreen('map');
      toast('Game loaded');
    }
  });

  // debug hook
  window.__game = {
    get state() { return S.game; },
    get battle() { return S.battle; },
    get meta() { return S.battleMeta; },
    get spell() { return S.combatSpell; },
    checkWin: () => E.checkGameOver(S.game),
    newGame,
    endTurn,
  };
}

init();
