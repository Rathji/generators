// src/engine.js — worker-placement engine (Tasks 11-14, extended Phase 4).
// One engine action = one turn. placeWorker performs the full "place" turn in
// rule order: legality → benefit preflight (for effectful buildings) → bump
// any occupant → pay the building's cost (illegal if unpayable) → optionally
// spend influence tokens → gain the benefit → advance the turn. Building
// effects that go beyond plain item transfers use `{preflight, apply}`
// benefits: preflight runs BEFORE any side effect so illegal placements (e.g.
// Zeppelin construction on a non-adjacent cell) reject cleanly; apply runs
// after the cost is committed. retrieveWorkers is the "retrieve" turn.

import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { CARD_TYPES } from "./cards.js";
import { TRACK_REASONS } from "./progress.js";
import { OBJECTIVE_VP, scoreEndGame } from "./scoring.js";

export const WORKER_ACTIONS = Object.freeze({ PLACE: "place", RETRIEVE: "retrieve" });

export function createGameEngine(state, config = {}) {
  const defs = config.buildingDefs ?? DEFAULT_ENGINE_DEFS;
  const board = state.board;
  const economy = state.economy;
  const turns = state.turns;
  const progress = state.progress;

  // The game ends only when the progress token has reached the end AND the
  // round is finished (every player has taken the same number of turns). In
  // the window between those two, trailing players finish the round (Task 32).
  function gameOver() {
    return progress.endReached() && turns.allCountsEqual();
  }

  // Task 31: a player who begins their turn with 0 influence tokens must
  // advance the progress token 1 space before taking their turn.
  function turnStartAdvance(playerId) {
    if (progress.endReached()) return null;
    if (!state.influence) return null;
    if (state.influence.availableOf(playerId) > 0) return null;
    const adv = progress.advance(TRACK_REASONS.NO_INFLUENCE);
    if (adv.ok) {
      state.addLogEntry({ event: "forcedAdvance", detail: { playerId, reason: "noInfluence", from: adv.from, to: adv.position } });
    }
    return adv;
  }

  // Task 30: the general objective-scoring mechanic (1 static influence
  // placement, +5 VP, +1 progress). Consumed by scoring buildings (the
  // Grandstand) as their benefit; it does not advance the turn itself.
  function applyObjectiveScore(playerId, objectiveId) {
    const o = state.objectives;
    if (!o) return { ok: false, reason: "no_such_objective", objectiveId };
    const can = o.canScore(objectiveId, playerId);
    if (!can.ok) return can;
    if (!state.influence || state.influence.availableOf(playerId) < 1) {
      return { ok: false, reason: "no_influence", objectiveId };
    }
    o.score(objectiveId, playerId);
    state.influence.place(playerId, "objective:" + objectiveId);
    state.player(playerId).addVp(OBJECTIVE_VP);
    const advance = progress.advance(TRACK_REASONS.OBJECTIVE);
    return { ok: true, objectiveId, playerId, vp: OBJECTIVE_VP, advance };
  }


  function resolveCell(cellRef) {
    if (cellRef && typeof cellRef === "object" && cellRef.key) return cellRef;
    return board.cell(cellRef);
  }

  function buildingDefOf(cell) {
    if (!cell || !cell.buildingId) return null;
    return defs[cell.buildingId] ?? null;
  }

  function buildingCells() {
    return board.commonsBuildings().concat(board.constructedBuildings()).map(b => b.cell);
  }

  function resolveCost(def, ctx) {
    if (def.cost && typeof def.cost === "function") return def.cost(ctx) ?? null;
    return def.cost ?? {};
  }

  function resolveCostSafe(def, ctx) {
    try {
      return { ok: true, items: resolveCost(def, ctx) };
    } catch (err) {
      return { ok: false, reason: err && err.code ? err.code : "invalid_request" };
    }
  }

  function resolveInfluenceCost(def, ctx) {
    if (def.influenceCost == null) return null;
    if (typeof def.influenceCost === "function") return def.influenceCost(ctx) ?? null;
    return def.influenceCost;
  }

  function checkInfluenceAffordability(def, ctx, playerId) {
    const n = resolveInfluenceCost(def, ctx);
    if (n == null || n < 1) return { ok: true, needed: n ?? 0 };
    if (!state.influence) return { ok: true, needed: n };
    const available = state.influence.availableOf(playerId);
    if (available < n) {
      return { ok: false, reason: "cannot_afford_influence", needed: n, available };
    }
    return { ok: true, needed: n };
  }

  function preflightBenefit(def, ctx) {
    const b = def.benefit;
    if (b && typeof b === "object" && typeof b.preflight === "function") {
      const res = b.preflight(ctx);
      if (!res || res.ok === false) return { ok: false, reason: (res && res.reason) || "invalid_request" };
    }
    return { ok: true };
  }

  function resolveBenefit(def, ctx) {
    const b = def.benefit;
    if (!b) return null;
    if (typeof b === "function") return b(ctx);
    if (typeof b === "object" && typeof b.apply === "function") return b.apply(ctx);
    if (b.items) return economy.gain(ctx.playerId, ctx.take ?? b.items);
    return null;
  }

  function applyAssistantEffects(playerId, triggers, ctx) {
    if (!state.cards || !triggers || triggers.length === 0) return [];
    const p = state.player(playerId);
    if (!p) return [];
    const out = [];
    for (const cardId of p.cards) {
      const card = state.cards[cardId];
      if (!card || card.type !== CARD_TYPES.ASSISTANT || !card.effect) continue;
      for (const trigger of triggers) {
        const bonus = card.effect[trigger];
        if (!bonus) continue;
        const res = economy.gain(playerId, bonus);
        out.push({ cardId, trigger, granted: res.granted });
      }
    }
    return out;
  }

  function checkObjectives(playerId) {
    const o = state.objectives;
    const newly = [];
    if (!o || !state.cards) return newly;
    const player = state.player(playerId);
    if (!player) return newly;
    const constructedBuildingCount = board.buildingsByOwner(playerId).length;
    const pctx = { ...player, constructedBuildingCount };
    for (const id of o.revealedIds()) {
      if (o.isCompleted(id)) continue;
      const card = state.cards[id];
      if (!card || typeof card.condition !== "function") continue;
      if (card.condition({ state, playerId, player: pctx, constructedBuildingCount })) {
        if (o.markCompleted(id, playerId).ok) newly.push(id);
      }
    }
    return newly;
  }

  function playerCharterId(playerId) {
    return turns.playerCharter ? turns.playerCharter(playerId) : null;
  }
  function legalConstructionCellsForPlayer(playerId) {
    return board.legalConstructionCellsForOwner(playerId, playerCharterId(playerId));
  }
  function isLegalConstructionCellForPlayer(playerId, cellRef) {
    return board.isLegalConstructionCellForOwner(playerId, playerCharterId(playerId), cellRef);
  }

  const engine = {
    defs,

    legalActions(playerId) {
      if (gameOver()) return [];
      if (!turns.isPlayerOnTurn(playerId)) return [];
      const p = state.player(playerId);
      if (!p || p.workers < 1) return [WORKER_ACTIONS.RETRIEVE];
      const affordable = buildingCells().some(cell => {
        const def = buildingDefOf(cell);
        if (!def) return false;
        const ctx = { state, playerId, cell };
        const c = resolveCostSafe(def, ctx);
        if (!c.ok) return false;
        if (c.items && Object.keys(c.items).length > 0 && !economy.canPay(playerId, c.items)) return false;
        if (!checkInfluenceAffordability(def, ctx, playerId).ok) return false;
        return true;
      });
      return affordable ? [WORKER_ACTIONS.PLACE, WORKER_ACTIONS.RETRIEVE] : [WORKER_ACTIONS.RETRIEVE];
    },

    legalConstructionCellsForPlayer,
    isLegalConstructionCellForPlayer,
    checkObjectives,

    // Task 47 (Phase 10): non-committing legality check for the action-flow UI.
    // Runs the exact same preflight sequence as placeWorker (on-turn, workers,
    // building, cost resolution, affordability, influence, benefit preflight)
    // WITHOUT committing anything, so the UI can highlight legal destinations
    // and preview cost/benefit before the player confirms. The preview carries
    // the resolved cost and influence cost plus static def metadata.
    checkPlace(playerId, cellRef, opts = {}) {
      if (gameOver()) return { ok: false, reason: "game_ended", playerId };
      if (!turns.isPlayerOnTurn(playerId)) return { ok: false, reason: "not_your_turn", playerId };
      const cell = resolveCell(cellRef);
      const def = buildingDefOf(cell);
      if (!def) return { ok: false, reason: "no_building", cell: cell ? cell.key : String(cellRef) };
      const p = state.player(playerId);
      if (!p || p.workers < 1) return { ok: false, reason: "no_workers", playerId };
      const ctx = { state, playerId, cell, ...opts };
      const c = resolveCostSafe(def, ctx);
      if (!c.ok) return { ok: false, reason: c.reason, cell: cell.key };
      const cost = c.items;
      const hasCost = !!cost && Object.keys(cost).length > 0;
      if (hasCost && !economy.canPay(playerId, cost)) {
        return { ok: false, reason: "cannot_afford_cost", cost: { ...cost } };
      }
      const inf = checkInfluenceAffordability(def, ctx, playerId);
      if (!inf.ok) {
        return { ok: false, reason: inf.reason, influenceCost: inf.needed, available: inf.available, cell: cell.key };
      }
      const pf = preflightBenefit(def, ctx);
      if (!pf.ok) return { ok: false, reason: pf.reason, cell: cell.key };
      return {
        ok: true,
        preview: {
          buildingId: cell.buildingId,
          cell: cell.key,
          name: def.name,
          vp: def.vp ?? 0,
          cost: hasCost ? { ...cost } : {},
          influenceCost: inf.needed ?? 0,
        },
      };
    },

    scoreObjective(playerId, objectiveId) {
      const res = applyObjectiveScore(playerId, objectiveId);
      if (res.ok) {
        state.addLogEntry({ event: "scoreObjective", detail: { playerId, objectiveId, vp: res.vp } });
      }
      return res;
    },

    endGame() {
      if (!gameOver()) return { ok: false, reason: "game_not_over" };
      const standings = scoreEndGame(state);
      return { ok: true, standings, winnerIds: standings.filter(s => s.rank === 1).map(s => s.playerId) };
    },

    placeWorker(playerId, cellRef, opts = {}) {
      if (gameOver()) return { ok: false, reason: "game_ended", playerId };
      if (!turns.isPlayerOnTurn(playerId)) return { ok: false, reason: "not_your_turn", playerId };
      const forcedAdvance = turnStartAdvance(playerId);
      if (gameOver()) return { ok: false, reason: "game_ended", playerId, forcedAdvance };
      const cell = resolveCell(cellRef);
      const def = buildingDefOf(cell);
      if (!def) return { ok: false, reason: "no_building", cell: cell ? cell.key : String(cellRef) };
      const p = state.player(playerId);
      if (!p || p.workers < 1) return { ok: false, reason: "no_workers", playerId };
      const ctx = { state, playerId, cell, ...opts };

      const c = resolveCostSafe(def, ctx);
      if (!c.ok) return { ok: false, reason: c.reason, cell: cell.key };
      const cost = c.items;
      const hasCost = !!cost && Object.keys(cost).length > 0;
      if (hasCost && !economy.canPay(playerId, cost)) {
        return { ok: false, reason: "cannot_afford_cost", cost: { ...cost } };
      }
      const inf = checkInfluenceAffordability(def, ctx, playerId);
      if (!inf.ok) {
        return { ok: false, reason: inf.reason, influenceCost: inf.needed, available: inf.available, cell: cell.key };
      }
      const pf = preflightBenefit(def, ctx);
      if (!pf.ok) return { ok: false, reason: pf.reason, cell: cell.key };

      const bumped = cell.workerId;
      if (bumped) {
        board.removeWorker(cell);
        const owner = state.player(bumped);
        if (owner) owner.addWorkers(1);
      }
      p.spendWorkers(1);
      board.placeWorker(cell, playerId);
      if (hasCost) economy.pay(playerId, cost);
      const infN = inf.needed || 0;
      if (infN > 0 && state.influence) state.influence.spend(playerId, infN);
      const benefit = resolveBenefit(def, ctx);
      let ownerBenefit = null;
      if (cell.ownerId != null && cell.ownerId !== playerId && def.ownerBenefit) {
        const ob = typeof def.ownerBenefit === "function"
          ? def.ownerBenefit(ctx)
          : economy.gain(cell.ownerId, ctx.takeOwnerBenefit ?? def.ownerBenefit);
        ownerBenefit = { ownerId: cell.ownerId, result: ob };
      }
      const triggers = [...new Set(["place", cell.buildingId, ...(def.assistantTriggers ?? [])])];
      const assistants = applyAssistantEffects(playerId, triggers, ctx);
      const completedObjectives = checkObjectives(playerId);
      state.addLogEntry({ event: "place", detail: { playerId, cell: cell.key, buildingId: cell.buildingId, bumped, cost: hasCost ? cost : {}, influenceCost: infN, benefit, ownerBenefit, assistants, completedObjectives } });
      const turn = turns.takeTurn(playerId, WORKER_ACTIONS.PLACE);
      return {
        ok: true,
        playerId,
        cell: cell.key,
        buildingId: cell.buildingId,
        bumped: bumped ?? null,
        cost: hasCost ? { ...cost } : {},
        influenceCost: infN,
        benefit,
        ownerBenefit,
        assistants,
        completedObjectives,
        forcedAdvance,
        worker: p.workers,
        turn,
      };
    },

    retrieveWorkers(playerId) {
      if (gameOver()) return { ok: false, reason: "game_ended", playerId };
      if (!turns.isPlayerOnTurn(playerId)) return { ok: false, reason: "not_your_turn", playerId };
      const forcedAdvance = turnStartAdvance(playerId);
      if (gameOver()) return { ok: false, reason: "game_ended", playerId, forcedAdvance };
      const cells = board.workerCellsOf(playerId);
      for (const c of cells) {
        board.removeWorker(c);
        const p = state.player(playerId);
        if (p) p.addWorkers(1);
      }
      state.addLogEntry({ event: "retrieve", detail: { playerId, count: cells.length } });
      const turn = turns.takeTurn(playerId, WORKER_ACTIONS.RETRIEVE);
      return { ok: true, playerId, retrieved: cells.length, worker: state.player(playerId).workers, forcedAdvance, turn };
    },

    workersOn(cellRef) {
      return board.workerAt(cellRef);
    },
    workerCells() {
      return board.workerCells().map(c => ({ cell: c.key, playerId: c.workerId }));
    },
    workerCellsOf(playerId) {
      return board.workerCellsOf(playerId).map(c => c.key);
    },
  };
  return engine;
}
