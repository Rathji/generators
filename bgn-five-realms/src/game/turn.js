// Five Realms — turn lifecycle, priority, and state-based actions (roadmap Phase 4).
// The five-realms-plugin owns the step machine (its reducer advances steps, resolves
// the stack on all-pass, runs the untap/draw/combat-damage/cleanup automatic steps, and
// marks a deck-out loss). This module wraps that machine for clients: it watches step
// transitions into a step log, emits an on-step event, centralises the "life at 0 or
// less loses" state-based action for paths that bypass the reducer (setLife/changeLife),
// and provides autopass + turn-walk helpers for tests, AI, and the UI turn indicator.

import * as engine from "./engine.js";
import * as mana from "./mana.js";
import * as triggers from "./triggers.js";
import * as continuous from "./continuous.js";
import * as abilities from "./abilities.js";
import * as regenerate from "./regenerate.js";

// The 12 steps in order. `untap` and `cleanup` are turn-based-action-only: the plugin
// grants no priority there and auto-advances through them, so they never appear in the
// observable step log unless a consumer samples them directly.
export const STEP_ORDER = [
  "untap", "upkeep", "draw",
  "precombat_main",
  "begin_combat", "declare_attackers", "declare_blockers", "combat_damage", "end_combat",
  "postcombat_main",
  "end_step", "cleanup",
];

export const PHASE_FOR_STEP = {
  untap: "beginning", upkeep: "beginning", draw: "beginning",
  precombat_main: "precombat_main",
  begin_combat: "combat", declare_attackers: "combat", declare_blockers: "combat",
  combat_damage: "combat", end_combat: "combat",
  postcombat_main: "postcombat_main",
  end_step: "ending", cleanup: "ending",
};

export const PRETTY_STEP = {
  untap: "Untap",
  upkeep: "Upkeep",
  draw: "Draw",
  precombat_main: "Main Phase 1",
  begin_combat: "Begin Combat",
  declare_attackers: "Declare Attackers",
  declare_blockers: "Declare Blockers",
  combat_damage: "Combat Damage",
  end_combat: "End Combat",
  postcombat_main: "Main Phase 2",
  end_step: "End Step",
  cleanup: "Cleanup",
};

export const PRIORITY_STEPS = STEP_ORDER.filter((s) => s !== "untap" && s !== "cleanup");

function currentEntry(game) {
  const raw = game.raw;
  return {
    step: raw.step,
    turnNumber: raw.turnNumber,
    activePlayer: raw.activePlayer,
    phase: PHASE_FOR_STEP[raw.step] || "unknown",
    prettyStep: PRETTY_STEP[raw.step] || raw.step,
    at: Date.now(),
  };
}

// turnInfo(game) -> a plain snapshot of where the game is.
export function turnInfo(game) {
  const raw = game.raw;
  return {
    turnNumber: raw.turnNumber,
    activePlayer: raw.activePlayer,
    priorityPlayer: raw.priorityPlayer,
    step: raw.step,
    phase: PHASE_FOR_STEP[raw.step] || "unknown",
    prettyStep: PRETTY_STEP[raw.step] || raw.step,
    grantsPriority: PRIORITY_STEPS.includes(raw.step),
    gameOver: !!raw.gameOver,
    winner: raw.winner === undefined ? null : raw.winner,
    passedPlayers: (raw.passedPlayers || []).slice(),
  };
}

// initTurnTracker(game) -> records the current step as the first log entry so the log is
// always a complete timeline from the moment tracking starts. Safe to call again later
// (re-initialising just continues the existing log).
export function initTurnTracker(game) {
  game._stepLog = Array.isArray(game._stepLog) ? game._stepLog : [];
  game._stepCallbacks = Array.isArray(game._stepCallbacks) ? game._stepCallbacks : [];
  if (game._stepLog.length === 0) {
    game._stepLog.push(currentEntry(game));
  }
  return game;
}

// onStep(game, cb) -> register a callback invoked with (entry, game) whenever the
// observable (step, turn, active player) changes. Returns the game for chaining.
export function onStep(game, cb) {
  if (typeof cb !== "function") throw new Error("onStep: callback required");
  initTurnTracker(game);
  game._stepCallbacks.push(cb);
  return game;
}

// recordSteps(game) -> compares the current step/turn/active player against the last log
// entry and pushes (and fires callbacks for) any transition. Called by doAction/changeLife.
export function recordSteps(game) {
  if (!Array.isArray(game._stepLog)) return game;
  const last = game._stepLog[game._stepLog.length - 1];
  const cur = currentEntry(game);
  if (last.step !== cur.step || last.turnNumber !== cur.turnNumber || last.activePlayer !== cur.activePlayer) {
    game._stepLog.push(cur);
    const cbs = game._stepCallbacks.slice();
    for (const cb of cbs) {
      try {
        cb(cur, game);
      } catch (e) {}
    }
  }
  return game;
}

// runSba(game) -> the repeatable state-based-actions pass. Phase 4 covers the two
// foundational losses: a player at 0 or less life loses; a player who must draw from an
// empty library loses (already marked by the plugin's frGameDrawOne — this pass only
// reconciles the plugin's loss flags into gameOver/winner when they weren't set). The
// plugin's own reducer already runs its SBA loop on pass/cast/resolve; this pass exists
// so clone-and-mutate paths (setLife/changeLife) trigger loss immediately rather than
// waiting for the next priority grant. Idempotent and repeatable — later phases add more
// categories here.
export function runSba(game) {
  const raw = game.raw;
  if (!raw || !Array.isArray(raw.players)) return raw;
  if (raw.gameOver) return raw;
  let lostAny = false;
  for (let p = 0; p < raw.players.length; p++) {
    const pl = raw.players[p];
    if (!pl.lost && pl.life <= 0) {
      pl.lost = true;
      lostAny = true;
    }
  }
  if (lostAny) {
    for (let p = 0; p < raw.players.length; p++) {
      if (!raw.players[p].lost) {
        raw.gameOver = true;
        raw.winner = p;
        return raw;
      }
    }
    // Every player lost simultaneously — resolve to a draw: no winner.
    raw.gameOver = true;
    raw.winner = null;
  }
  return raw;
}

// passLocalTrigger(game, action) -> the stack-mode pass interception (task 23). In
// stack mode (game._rules.triggersImmediate === false) a triggered ability sits on the
// plugin's stack as a { kind: "trigger" } entry; the plugin's own passPriority would try
// to resolve it as a spell, so while a local trigger is on top this mirrors the plugin's
// pass semantics locally — validate priority, push the passing player, resolve the
// trigger on an all-pass round (resolveTriggerTop resets passedPlayers + priority), or
// hand priority to the next player — without ever handing the entry to the reducer.
function passLocalTrigger(game, action) {
  const raw = game.raw;
  const player = action.player;
  raw.lastActionError = null;
  if (raw.priorityPlayer !== player) {
    raw.lastActionError = "player " + player + " does not have priority";
    return;
  }
  if (raw.passedPlayers.indexOf(player) === -1) raw.passedPlayers.push(player);
  if (raw.passedPlayers.length < raw.players.length) {
    raw.priorityPlayer = (player + 1) % raw.players.length;
  } else {
    triggers.resolveTriggerTop(game);
  }
  game.history.push({ action: "passPriority", at: Date.now(), localTrigger: true });
}

// doAction(game, action) -> runs the plugin reducer, then observes the continuous-effects
// layer (global pumps are re-synced before the reducer so the plugin's combat/SBA math
// sees the current board, and again after so trigger-time SBA sees the post-action board;
// Mana Flare bonuses land before the mana tracker), the mana layer (mana burn at the
// cleanup transition + per-turn production/spend tracking), fires any triggered abilities
// the action produced (upkeep entry, deaths, draws), reconciles state-based actions and
// the step log. Rejected actions (reducer set lastActionError) throw loudly so clients
// can't silently feed illegal moves.
export function doAction(game, action) {
  if (!action || typeof action.type !== "string") throw new Error("doAction: action.type required");
  const prevPools = game.raw && Array.isArray(game.raw.players) ? mana.poolCopy(game) : null;
  const prevStep = game.raw ? game.raw.step : null;
  const prevActive = game.raw ? game.raw.activePlayer : null;
  const prev = triggers.captureEvents(game);
  continuous.syncContinuousEffects(game);
  // Local activation gate (task 25): the plugin validates costs, priority and its
  // targeting SUBSET; the rich Alpha filters (tapped, colors, subtypes, ...) and the
  // declaration's activation timing are enforced here, before the reducer — exactly how
  // cast.js gates casts. Mana-ability taps (no abilityName) are untouched.
  const abErr = abilities.validateAbilityActivation(game, action);
  if (abErr) throw new Error("action rejected: " + abErr);
  const regenTop = regenerate.stackTopRegeneration(game);
  const stackLenBefore = Array.isArray(game.raw.stack) ? game.raw.stack.length : 0;
  const regenBefore = regenerate.captureBattlefield(game);
  if (action.type === "passPriority" && !triggers.triggersImmediate(game) && triggers.isTriggerOnTop(game)) {
    passLocalTrigger(game, action);
  } else {
    engine.act(game, action);
  }
  if (game.raw.lastActionError) {
    throw new Error("action rejected: " + game.raw.lastActionError);
  }
  // Regeneration (task 25): a regeneration ability grants its shield when it RESOLVES
  // (an action that shrank the stack while it was on top — covers the plugin's native
  // all-pass resolve and resolve.js's resolveTop), then shields expire at end of turn,
  // then any creature the reducer destroyed while shielded is resurrected BEFORE the
  // continuous resync and trigger observation see the board.
  const stackLenAfter = Array.isArray(game.raw.stack) ? game.raw.stack.length : 0;
  if (regenTop && stackLenAfter < stackLenBefore) regenerate.grantFromResolved(game, regenTop);
  regenerate.endTurnShields(game, prevActive);
  regenerate.reconcileDeaths(game, regenBefore);
  continuous.postAction(game, action);
  if (prevPools) mana.observe(game, action, prevPools, prevStep);
  triggers.observe(game, action, prev);
  runSba(game);
  recordSteps(game);
  return game.raw;
}

// pass(game, player?) -> pass priority for the given player (defaults to whoever holds
// priority). The plugin alternates priority until all players have passed, at which point
// it either resolves the top of the stack (keeping the same step) or advances the turn.
export function pass(game, player) {
  const p = player === undefined ? game.raw.priorityPlayer : player;
  return doAction(game, { type: "passPriority", player: p });
}

// changeLife(game, player, delta, reason) -> the single life-change path (Phase 9
// centralises further hooks here). Applies the delta and reconciles SBAs immediately.
export function changeLife(game, player, delta, reason) {
  if (!Number.isFinite(delta)) throw new Error("changeLife: numeric delta required");
  const cur = engine.life(game, player);
  engine.setLife(game, player, cur + delta, reason);
  runSba(game);
  recordSteps(game);
  return game.raw;
}

// hasMeaningfulActions(game) -> true if the priority player has any legal action beyond
// passing or conceding (i.e. something that actually affects the game).
export function hasMeaningfulActions(game) {
  return engine.legalActions(game).some((a) => a.type !== "passPriority" && a.type !== "concede");
}

// setAutopass(game, player, on) -> enable/disable autopass for a player.
export function setAutopass(game, player, on) {
  if (!game._autopass) game._autopass = {};
  game._autopass[player] = !!on;
  return game;
}

// autopass(game) -> if autopass is on for the priority player and they have no meaningful
// legal actions, pass for them. Single step: callers that want to drain a whole sequence
// (e.g. walking turns) should loop on it.
export function autopass(game) {
  const pp = game.raw.priorityPlayer;
  if (game._autopass && game._autopass[pp] && !game.raw.gameOver && !hasMeaningfulActions(game)) {
    pass(game, pp);
    return true;
  }
  return false;
}

// stepLogOfTurn(game, turnNumber, activePlayer) -> the log entries for one player's turn.
export function stepLogOfTurn(game, turnNumber, activePlayer) {
  const log = Array.isArray(game._stepLog) ? game._stepLog : [];
  return log.filter((e) => e.turnNumber === turnNumber && e.activePlayer === activePlayer);
}

function forcePassLoop(game, opts = {}) {
  const max = opts.max === undefined ? 500 : opts.max;
  let passes = 0;
  while (!game.raw.gameOver && passes < max) {
    if (opts.until && opts.until(game)) break;
    pass(game, game.raw.priorityPlayer);
    passes += 1;
    if (opts.onPriority) opts.onPriority(game);
  }
  return { passes, gameOver: !!game.raw.gameOver };
}

// walk(game, opts) -> force-pass through the game (both players decline every priority
// chance) for up to `max` passes, until `until(game)` is satisfied, or until game over.
// `onPriority` (optional) receives (game) after each pass, letting a caller peek or act.
export function walk(game, opts = {}) {
  return forcePassLoop(game, opts);
}

// walkTurn(game, turns=1) -> advance a whole number of turns from wherever the game is,
// force-passing through every priority step. Returns { passes, gameOver, advancedTurns }.
export function walkTurn(game, turns = 1) {
  const startTurn = game.raw.turnNumber;
  const out = forcePassLoop(game, {
    max: 1000 * Math.max(1, turns) + 100,
    until: (g) => g.raw.turnNumber >= startTurn + turns,
  });
  return {
    passes: out.passes,
    gameOver: out.gameOver,
    advancedTurns: game.raw.turnNumber - startTurn,
  };
}

// walkToStep(game, step) -> force-pass until the game is at the given step (or game over).
// Note the plugin grants no priority at untap/cleanup, so walkToStep("untap") can only be
// observed as a passing-through point, not a destination; priority steps are the targets.
export function walkToStep(game, step, opts = {}) {
  const out = forcePassLoop(game, {
    max: opts.max === undefined ? 500 : opts.max,
    until: (g) => g.raw.step === step,
  });
  return { passes: out.passes, gameOver: out.gameOver, atStep: game.raw.step === step };
}

// turnIndicatorText(game) -> the display string for the phase/turn indicator (task 57).
export function turnIndicatorText(game) {
  const raw = game.raw;
  if (raw.gameOver) {
    const w = raw.winner === null || raw.winner === undefined ? "nobody" : "Player " + (raw.winner + 1);
    return "Game Over — " + w + " wins";
  }
  const info = turnInfo(game);
  const priority = info.grantsPriority ? " · P" + (info.priorityPlayer + 1) + " priority" : "";
  return (
    "Turn " + info.turnNumber +
    " · Player " + (info.activePlayer + 1) +
    " · " + info.prettyStep +
    priority
  );
}

// bindTurnIndicator(game, elOrId) -> keep a DOM element's text in sync with the turn/phase
// (updates on init and every step transition). Element may be an id string or a node.
// Appends a dedicated <span id="frPhaseText"> so a pre-existing logo span is preserved.
export function bindTurnIndicator(game, elOrId) {
  const el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
  if (!el) throw new Error("bindTurnIndicator: element not found");
  let span = document.getElementById("frPhaseText");
  if (!span) {
    span = document.createElement("span");
    span.id = "frPhaseText";
    el.appendChild(span);
  }
  const update = () => {
    span.textContent = " · " + turnIndicatorText(game);
  };
  update();
  onStep(game, update);
  return game;
}
