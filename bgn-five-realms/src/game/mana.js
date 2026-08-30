// Five Realms — mana pool, mana burn, and mana abilities (roadmap Phase 5, tasks 16-17).
// The five-realms-plugin owns the authoritative pool ({W,U,B,R,G,C}) and pays/empties it
// inside its reducer, but (a) it wipes every player's pool at EVERY step advance (its
// Phase-1 simplification of the vintage "mana empties at end of phase" rule), and (b) its
// mana-ability reducer only handles single-colour production (frManaAbilityColor returns
// one character — a dual land's "WU" would corrupt the pool). This module layers on top:
//   1. add/remove operations that fail loudly on bad symbols or short pools, wrapping the
//      engine's pool ops and recording into a per-turn production/spend tracker,
//   2. a mana-burn hook fired when the game leaves the end step (the cleanup transition):
//      unspent mana deals that much damage to its owner, per the classic Alpha rule,
//   3. a multi-colour mana-ability path (dual lands) that taps the permanent and adds the
//      chosen colour without using the stack, driven by producesMana from the 295-card
//      projection (src/cards/plugin.js) when the plugin DB doesn't yet know the card.

import * as engine from "./engine.js";
import * as continuous from "./continuous.js";
import { PLUGIN_CARD_MAP } from "../cards/plugin.js";

// W/U/B/R/G = the five colours; C = colourless. Same six keys as the plugin's pool.
export const MANA_TYPES = ["W", "U", "B", "R", "G", "C"];

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function emptyTrack() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

// initManaLayer(game) -> ensures the per-game rules and per-turn tracker exist. Idempotent;
// safe to call on any wrapper (also lazily invoked by every other export).
export function initManaLayer(game) {
  if (!game._rules) game._rules = { manaBurn: true };
  if (!Array.isArray(game._manaTrack)) {
    game._manaTrack = [];
    for (let p = 0; p < game.raw.players.length; p++) {
      game._manaTrack.push({ produced: emptyTrack(), spent: emptyTrack() });
    }
    game._trackTurn = game.raw.turnNumber;
  }
  return game;
}

// resetManaTracks(game) -> start a fresh per-turn tracker (called automatically when the
// turn rolls over).
export function resetManaTracks(game) {
  initManaLayer(game);
  game._manaTrack = game._manaTrack.map(() => ({ produced: emptyTrack(), spent: emptyTrack() }));
  game._trackTurn = game.raw.turnNumber;
  return game;
}

// poolCopy(game) -> fresh copies of both players' mana pools.
export function poolCopy(game) {
  return game.raw.players.map((p) => ({ ...p.manaPool }));
}

// poolTotalOf(pool) -> the number of mana of every type in a pool object.
export function poolTotalOf(pool) {
  let t = 0;
  for (const s of MANA_TYPES) t += pool[s] || 0;
  return t;
}

export function producedThisTurn(game, player) {
  initManaLayer(game);
  return { ...game._manaTrack[player].produced };
}

export function spentThisTurn(game, player) {
  initManaLayer(game);
  return { ...game._manaTrack[player].spent };
}

export function totalProducedThisTurn(game, player) {
  return poolTotalOf(producedThisTurn(game, player));
}

export function totalSpentThisTurn(game, player) {
  return poolTotalOf(spentThisTurn(game, player));
}

function recordProduced(game, player, symbol, qty) {
  initManaLayer(game);
  if (!game._manaTrack[player].produced[symbol]) game._manaTrack[player].produced[symbol] = 0;
  game._manaTrack[player].produced[symbol] += qty;
}

function recordSpent(game, player, symbol, qty) {
  initManaLayer(game);
  if (!game._manaTrack[player].spent[symbol]) game._manaTrack[player].spent[symbol] = 0;
  game._manaTrack[player].spent[symbol] += qty;
}

// addMana/spendMana -> tracker-aware wrappers over the engine's pool ops. The engine
// throws on unknown symbols and insufficient mana, so these fail loudly too.
export function addMana(game, player, symbol, qty, reason) {
  const n = qty === undefined ? 1 : qty;
  engine.addMana(game, player, symbol, n, reason);
  recordProduced(game, player, symbol, n);
  return game.raw;
}

export function spendMana(game, player, symbol, qty, reason) {
  const n = qty === undefined ? 1 : qty;
  engine.spendMana(game, player, symbol, n, reason);
  recordSpent(game, player, symbol, n);
  return game.raw;
}

// applyManaBurn(game, pools) -> for each player, unspent mana deals that much damage to
// its owner (the classic Alpha rule). The plugin has already emptied the pools on the
// step advance, so this only adjusts life. Off when game._rules.manaBurn is false.
export function applyManaBurn(game, pools) {
  if (!game._rules) initManaLayer(game);
  if (game._rules.manaBurn === false) return game.raw;
  for (let p = 0; p < game.raw.players.length; p++) {
    const total = poolTotalOf(pools[p]);
    if (total > 0) engine.setLife(game, p, engine.life(game, p) - total, "mana burn");
  }
  return game.raw;
}

// burnMana(game) -> on-demand mana burn against the CURRENT pools (the doAction hook uses
// a pre-advance snapshot instead, because the plugin wipes pools during the advance).
export function burnMana(game) {
  return applyManaBurn(game, poolCopy(game));
}

// observe(game, action, prevPools, prevStep) -> called by turn.doAction after every
// accepted action. Resets the per-turn tracker on a turn roll, applies mana burn when the
// game leaves the end step (the cleanup transition), and reconciles production/spend for
// the reducer actions that deliberately move mana (castSpell spends, activateAbility
// produces). Other actions never touch the pool, and the plugin wipes pools at every step
// advance, so attributing deltas only for those action types avoids miscounting every
// end-of-step wipe as a spend.
export function observe(game, action, prevPools, prevStep) {
  initManaLayer(game);
  if (game.raw.turnNumber !== game._trackTurn) resetManaTracks(game);
  if (prevStep === "end_step" && game.raw.step !== "end_step" && !game.raw.gameOver) {
    applyManaBurn(game, prevPools);
  }
  const player = action.player;
  if (typeof player === "number" && (action.type === "castSpell" || action.type === "activateAbility")) {
    const cur = game.raw.players[player].manaPool;
    const prev = prevPools[player];
    for (const sym of MANA_TYPES) {
      const delta = (cur[sym] || 0) - (prev[sym] || 0);
      if (delta > 0) recordProduced(game, player, sym, delta);
      else if (delta < 0) recordSpent(game, player, sym, -delta);
    }
  }
  return game;
}

// cardDefFor(game, objId) -> the card definition for an object: the plugin's own DB first
// (its fixtures), then the 295-card Alpha projection, so mana abilities resolve for any
// card even before the plugin DB grows to the full set.
export function cardDefFor(game, objId) {
  const inst = engine.cardInstance(game, objId);
  if (inst && inst.card) return inst.card;
  const obj = game.raw.objects[objId];
  if (obj && PLUGIN_CARD_MAP[obj.cardId]) return PLUGIN_CARD_MAP[obj.cardId];
  return null;
}

// manaAbilityColors(game, objId) -> the colours the permanent's mana ability can produce
// (producesMana: "W" for a Plains, "WU" for a Tundra), or null when it has none.
export function manaAbilityColors(game, objId) {
  const card = cardDefFor(game, objId);
  if (!card || typeof card.producesMana !== "string" || card.producesMana === "") return null;
  return card.producesMana.split("");
}

// activateManaAbility(game, player, objId, chosenColor?) -> tap a permanent for mana
// without using the stack. Single-colour sources need no choice; a source with several
// colours (a dual land) requires the caller to name one. Validations fail loudly: the
// activator must hold priority, control an untapped battlefield permanent with a mana
// ability, and (for creatures) the permanent must not be summoning-sick. The plugin's own
// reducer cannot represent multi-colour production, so this path clones and mutates the
// state directly — the tapped permanent and the added mana stay consistent with the
// engine's own representation.
export function activateManaAbility(game, player, objId, chosenColor) {
  const raw = game.raw;
  if (raw.priorityPlayer !== player) {
    throw new Error("activateManaAbility: player " + player + " does not have priority");
  }
  const obj = raw.objects[objId];
  if (!obj || obj.zone !== "battlefield" || obj.controller !== player) {
    throw new Error("activateManaAbility: not a permanent you control on the battlefield");
  }
  if (obj.tapped) throw new Error("activateManaAbility: permanent is already tapped");
  const card = cardDefFor(game, objId);
  if (!card) throw new Error("activateManaAbility: unknown card " + obj.cardId);
  if (card.types.includes("Creature") && obj.summoningSickness) {
    throw new Error("activateManaAbility: summoning sickness prevents activating a tap ability");
  }
  const colors = manaAbilityColors(game, objId);
  if (!colors || colors.length === 0) {
    throw new Error("activateManaAbility: " + card.name + " has no mana ability");
  }
  const choice = chosenColor === undefined ? (colors.length === 1 ? colors[0] : null) : chosenColor;
  if (!choice || !MANA_TYPES.includes(choice)) {
    throw new Error("activateManaAbility: invalid colour " + JSON.stringify(chosenColor));
  }
  if (!colors.includes(choice)) {
    throw new Error("activateManaAbility: " + card.name + " can only produce " + colors.join("/"));
  }
  game.raw = clone(raw);
  game.raw.objects[objId].tapped = true;
  game.raw.players[player].manaPool[choice] += 1;
  recordProduced(game, player, choice, 1);
  // A Mana Flare on the battlefield (continuous "mana" layer) adds one more of the
  // produced colour — "Whenever a player taps a land for mana, that player adds one
  // additional mana of any type it produced."
  const bonus = continuous.bonusForLandTap(game, player, objId, choice);
  for (let i = 0; i < bonus; i++) recordProduced(game, player, choice, 1);
  game.history.push({ action: "activateManaAbility", player, objectId: objId, color: choice });
  return game.raw;
}
