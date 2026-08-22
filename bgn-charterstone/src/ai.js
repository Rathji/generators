// src/ai.js — Phase 13 heuristic AI opponents (Tasks 62-64).
// The AI enumerates the legal move space through the engine itself
// (engine.checkPlace preflights every placement, so anything it proposes is a
// move the real engine would accept) and scores candidates with a heuristic:
// printed building VP + benefit item value, construction cluster adjacency,
// and per-building action value (grandstand objective score, zeppelin
// construction, charterstone crate, cloudport quota). Difficulty levels:
//   easy   — noisy: ~50% of the time it plays a uniformly random legal move,
//   normal — one-ply: always the highest-scoring immediate move,
//   hard   — two-ply: the top-K candidates are evaluated by playing them on a
//            cloned state, letting the opponent reply with a normal move, and
//            comparing resulting positions (objective-aware).
// aiConstructionCell is the construction-strategy core: it ranks legal cells
// by cluster adjacency to the player's own buildings and printed tile value.
// simulateAIGame runs a full two-player AI-vs-AI match (used by Task 64).

import { CARD_TYPES } from "./cards.js";
import { WORKER_ACTIONS } from "./engine.js";
import { DEFAULT_CARDS } from "./cards.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { STARTING_SETUP } from "./indexGuide.js";
import { createGameState, restoreGameState } from "./serialization.js";
import { RESOURCE_TYPES } from "./economy.js";

export const AI_VERSION = 1;

export const AI_DIFFICULTIES = Object.freeze({
  easy: { id: "easy", label: "Easy", noise: 0.7, depth: 0, objectiveAware: false, lookahead: 0 },
  normal: { id: "normal", label: "Normal", noise: 0, depth: 1, objectiveAware: true, lookahead: 0 },
  hard: { id: "hard", label: "Hard", noise: 0, depth: 2, objectiveAware: true, lookahead: 6 },
});

export function normalizeAIDifficulty(d) {
  if (typeof d === "string") return AI_DIFFICULTIES[d] ?? AI_DIFFICULTIES.normal;
  if (d && typeof d === "object") return { ...AI_DIFFICULTIES.normal, ...d, id: d.id ?? "custom" };
  return AI_DIFFICULTIES.normal;
}

// Rough value of one unit of each item, used to score benefit maps.
const RESOURCE_VALUES = Object.freeze({
  coins: 1, metal: 2, coal: 2, pumpkin: 1, grain: 1, clay: 1, wood: 1,
});
export function itemValue(items) {
  let v = 0;
  for (const [k, n] of Object.entries(items ?? {})) v += (RESOURCE_VALUES[k] ?? 1) * (n || 0);
  return v;
}

function opponentId(state, playerId) {
  return state.playerIds().find(id => id !== playerId) ?? null;
}

// ── Task 63: construction-cell strategy ──
// Rank the player's legal construction cells: strong cluster adjacency to the
// player's own buildings (2/neighbour), a small bonus for the charter ring,
// the printed tile VP if known, and room for future expansion.
export function aiConstructionCell(state, playerId, cardId) {
  const legal = state.engine.legalConstructionCellsForPlayer(playerId);
  if (!legal || legal.length === 0) return { ok: false, reason: "no_legal_cells" };
  const card = state.cards ? state.cards[cardId] : null;
  const tile = card && state.buildingTiles ? state.buildingTiles[card.buildingId] : null;
  let best = null;
  let bestScore = -Infinity;
  const myCharter = state.turns ? state.turns.playerCharter(playerId) : null;
  for (const cell of legal) {
    let score = 0;
    const neighbors = state.board.neighborsOf(cell);
    const adjOwned = neighbors.filter(n => n.buildingId && state.board.ownerAt(n) === playerId).length;
    score += adjOwned * 2;
    if (myCharter != null && state.board.charterCell(myCharter) && state.board.isAdjacent(cell, state.board.charterCell(myCharter))) score += 0.5;
    if (tile) score += (tile.vp ?? 0) * 0.5;
    const open = neighbors.filter(n => n.type === "destination" && !n.buildingId).length;
    score += open * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return { ok: true, cell: best.key, score: bestScore, legalCount: legal.length };
}

function constructionScore(state, playerId, cellRef) {
  const cell = typeof cellRef === "string" ? state.board.cell(cellRef) : cellRef;
  if (!cell) return 0;
  const neighbors = state.board.neighborsOf(cell);
  const adjOwned = neighbors.filter(n => n.buildingId && state.board.ownerAt(n) === playerId).length;
  const open = neighbors.filter(n => n.type === "destination" && !n.buildingId).length;
  const myCharter = state.turns ? state.turns.playerCharter(playerId) : null;
  const charterAdj = myCharter != null && state.board.charterCell(myCharter) && state.board.isAdjacent(cell, state.board.charterCell(myCharter)) ? 0.5 : 0;
  return adjOwned * 1.5 + charterAdj + open * 0.25;
}

// Per-building placement options. Each option is an engine `opts` map for the
// building's benefit (resource type for the Treasury, mat card for the Market,
// objective id for the Grandstand, card+cell for the Zeppelin, card for the
// Charterstone, quota space for the Cloud Port).
function buildingOptions(state, playerId, buildingId) {
  switch (buildingId) {
    case "treasury": {
      return RESOURCE_TYPES
        .filter(r => (state.economy.amountOf(playerId, r) ?? 0) > 0)
        .map(resource => ({ resource }));
    }
    case "market": {
      return state.advancement.mat()
        .filter(id => id && !state.player(playerId).hasCard(id))
        .map(matCardId => ({ matCardId }));
    }
    case "grandstand": {
      const o = state.objectives;
      return o.revealedIds()
        .filter(id => o.isCompleted(id) && !o.hasScored(id, playerId))
        .map(objectiveId => ({ objectiveId }));
    }
    case "zeppelin": {
      const legal = state.engine.legalConstructionCellsForPlayer(playerId);
      const cards = state.player(playerId).cards
        .map(id => state.cards[id])
        .filter(c => c && c.type === CARD_TYPES.UNCONSTRUCTED_BUILDING);
      const out = [];
      for (const card of cards) {
        for (const cell of legal) out.push({ cardId: card.id, constructionCell: cell.key });
      }
      return out;
    }
    case "charterstone": {
      return state.player(playerId).cards
        .map(id => state.cards[id])
        .filter(c => c && c.type === CARD_TYPES.CONSTRUCTED_BUILDING && c.crateNumber && !state.crates.isUnlocked(c.id))
        .map(card => ({ cardId: card.id }));
    }
    case "cloudport": {
      return state.quota.spaces().filter(s => !s.occupiedBy).map(s => ({ quotaSpaceId: s.id }));
    }
    default:
      return [{}];
  }
}

// All legal, affordable moves for `playerId` right now, each with a heuristic
// `score`. Legality comes from engine.checkPlace — the same preflight the real
// engine runs before committing, so no candidate is ever illegal.
export function candidateActions(state, playerId) {
  const out = [];
  const engine = state.engine;
  const cells = state.board.commonsBuildings().concat(state.board.constructedBuildings());
  for (const b of cells) {
    const def = engine.defs[b.buildingId];
    if (!def) continue;
    const options = buildingOptions(state, playerId, b.buildingId);
    for (const opts of options) {
      const cp = engine.checkPlace(playerId, b.cell, opts);
      if (!cp.ok) continue;
      const cand = { kind: "place", cell: b.cell.key, buildingId: b.buildingId, opts, preview: cp.preview };
      cand.score = scoreCandidate(state, playerId, cand, def);
      out.push(cand);
    }
  }
  out.push({ kind: "retrieve", cell: null, buildingId: null, opts: {}, score: 0.25 });
  return out;
}

function scoreCandidate(state, playerId, cand, def) {
  let s = cand.preview ? (cand.preview.vp ?? 0) : 0;
  const b = def && def.benefit;
  if (b && b.items) s += itemValue(b.items);
  const owner = cand.cell ? state.board.ownerAt(cand.cell) : null;
  if (owner && owner !== playerId && def && def.ownerBenefit && def.ownerBenefit.items) {
    s += itemValue(def.ownerBenefit.items) * 0.3;
  }
  switch (cand.buildingId) {
    case "grandstand": s += 5; break;
    case "zeppelin": s += 5; break;
    case "charterstone": s += 5 + 3; break;
    case "cloudport": s += 3; break;
    case "market": {
      const card = cand.opts && cand.opts.matCardId ? state.cards[cand.opts.matCardId] : null;
      if (card && card.type === CARD_TYPES.UNCONSTRUCTED_BUILDING) s += 3;
      else s += 1;
      break;
    }
  }
  if (cand.buildingId === "zeppelin" && cand.opts && cand.opts.constructionCell) {
    const card = state.cards[cand.opts.cardId];
    const tile = card && state.buildingTiles ? state.buildingTiles[card.buildingId] : null;
    if (tile) s += tile.vp ?? 0;
    s += constructionScore(state, playerId, cand.opts.constructionCell);
  }
  return s;
}

// Apply a proposed move to the state (used by the simulation harness and the
// hard-AI lookahead). Returns the engine result.
export function applyMove(state, move) {
  if (move.kind === "retrieve") return state.engine.retrieveWorkers(move.playerId);
  if (move.kind === "scoreObjective") return state.engine.scoreObjective(move.playerId, move.objectiveId);
  return state.engine.placeWorker(move.playerId, move.cell, move.opts ?? {});
}

// ── Task 62: the decision core ──
// Propose the best legal move for `playerId`. Returns {ok:true, kind, cell,
// opts, buildingId, score, playerId, difficulty} or {ok:false, reason}.
export function proposeMove(state, playerId, config = {}) {
  if (!state.turns || !state.turns.isPlayerOnTurn(playerId)) {
    return { ok: false, reason: "not_your_turn", playerId };
  }
  if (state.engine.legalActions(playerId).length === 0) return { ok: false, reason: "no_legal_moves" };
  const difficulty = normalizeAIDifficulty(config.difficulty ?? "normal");
  const cands = candidateActions(state, playerId);
  if (cands.length === 0) return { ok: false, reason: "no_legal_moves" };
  const rng = config.rng ?? Math.random;
  let chosen = null;
  if (difficulty.noise > 0 && rng() < difficulty.noise) {
    chosen = cands[Math.floor(rng() * cands.length)];
  }
  if (!chosen) chosen = pickBestMove(state, playerId, cands, difficulty, config);
  return { ok: true, ...chosen, playerId, difficulty: difficulty.id };
}

function pickBestMove(state, playerId, cands, difficulty, config) {
  if (difficulty.lookahead > 0) {
    const top = [...cands].sort((a, b) => b.score - a.score).slice(0, difficulty.lookahead);
    let best = null;
    let bestEval = -Infinity;
    for (const cand of top) {
      const ev = evaluateTwoPly(state, playerId, cand, config);
      if (ev > bestEval) {
        bestEval = ev;
        best = cand;
      }
    }
    return best ?? top[0];
  }
  return [...cands].sort((a, b) => b.score - a.score)[0];
}

// Two-ply evaluation: play the candidate on a cloned state, let the opponent
// reply with a normal (one-ply) move, then score the resulting position as
// my VP+assets minus the opponent's. Falls back to the one-ply score if the
// clone fails.
function evaluateTwoPly(state, playerId, cand, config) {
  let clone;
  try {
    clone = restoreGameState(JSON.parse(state.serialize()));
  } catch (e) {
    return cand.score;
  }
  const opp = opponentId(state, playerId);
  const mine = applyMove(clone, { ...cand, playerId });
  if (!mine.ok) return cand.score - 100;
  if (opp && clone.turns.isPlayerOnTurn(opp) && clone.engine.legalActions(opp).length > 0) {
    const reply = proposeMove(clone, opp, { difficulty: "normal", rng: config.rng });
    if (reply.ok) applyMove(clone, reply);
  }
  const me = clone.player(playerId);
  const oppP = opp ? clone.player(opp) : null;
  const positionValue = p => {
    const res = p.resources();
    return p.vp + itemValue(res) * 0.5 + (p.capacity ?? 0) * 0.5;
  };
  return positionValue(me) - (oppP ? positionValue(oppP) : 0);
}

// ── Task 64: AI-vs-AI match runner ──
// Plays a full two-player game where each player is an AI of the given
// difficulty. `config.difficulties = {A: "...", B: "..."}`; returns the final
// game state, standings, and winner ids.
export function simulateAIGame(config = {}) {
  const players = config.players ?? [
    { id: "A", charterId: 0, startingCoins: 4 },
    { id: "B", charterId: 1, startingCoins: 4 },
  ];
  const g = createGameState({
    players,
    firstPlayer: config.firstPlayer ?? players[0].id,
    rng: config.rng,
    advancementConfig: config.advancementConfig ?? { deck: [...STARTING_SETUP.advancementDeck] },
    objectivesConfig: config.objectivesConfig ?? [...STARTING_SETUP.objectives],
    cards: config.cards ?? DEFAULT_CARDS,
    buildingDefs: config.buildingDefs ?? DEFAULT_ENGINE_DEFS,
    progress: config.progress,
    incomeEnabled: config.incomeEnabled,
  });
  for (const p of players) {
    const idx = players.indexOf(p);
    const personaId = STARTING_SETUP.personas[idx % STARTING_SETUP.personas.length];
    if (personaId) g.personas.add(p.id, personaId);
  }
  if (config.startingResources) {
    for (const p of players) g.economy.gain(p.id, config.startingResources);
  }
  if (config.startCards) {
    for (const [pid, cards] of Object.entries(config.startCards)) {
      for (const c of cards) {
        try { g.player(pid).gainCard(c); } catch (e) { /* already held */ }
      }
    }
  }
  const difficulties = config.difficulties ?? { A: "normal", B: "normal" };
  const maxTurns = config.maxTurns ?? 400;
  let steps = 0;
  const errors = [];
  const oneTurn = () => {
    const pid = g.turns.currentPlayerId;
    const move = proposeMove(g, pid, { difficulty: difficulties[pid] ?? "normal", rng: config.rng });
    if (!move.ok) {
      const forced = g.engine.retrieveWorkers(pid);
      if (!forced.ok) {
        errors.push("stalled at " + pid + ": " + move.reason);
        return false;
      }
      return true;
    }
    const applied = applyMove(g, move);
    if (!applied.ok) {
      errors.push("illegal AI move: " + applied.reason);
      return false;
    }
    return true;
  };
  while (steps < maxTurns && !(g.progress.endReached() && g.turns.allCountsEqual())) {
    steps++;
    if (!oneTurn()) break;
  }
  while (!g.turns.allCountsEqual() && steps < maxTurns + 100) {
    steps++;
    if (!oneTurn()) break;
  }
  const end = g.engine.endGame();
  return {
    g,
    steps,
    errors,
    ok: errors.length === 0 && end.ok,
    standings: end.ok ? end.standings : null,
    winnerIds: end.ok ? end.winnerIds : [],
  };
}
