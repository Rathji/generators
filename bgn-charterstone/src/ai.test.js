// src/ai.test.js — Phase 13 heuristic AI opponent validation (Tasks 62-64).
// Run in-page via ?test=ai, or programmatically via window.__loadAITests().
// Task 62 (decision core): the AI enumerates the legal move space through the
//   engine itself, so every candidate and every proposed move must pass the
//   engine's own checkPlace preflight across many random positions.
// Task 63 (construction strategy): aiConstructionCell returns a legal cell,
//   and it prefers cells adjacent to the player's own buildings (cluster
//   adjacency) over isolated ones.
// Task 64 (difficulty): a hard AI beats an easy AI in a majority of seeded
//   2-player simulations.

import {
  AI_VERSION, AI_DIFFICULTIES, normalizeAIDifficulty, itemValue,
  aiConstructionCell, candidateActions, proposeMove, applyMove, simulateAIGame,
} from "./ai.js";
import { createGameState, restoreGameState } from "./serialization.js";
import { createProgressTrack } from "./progress.js";
import { STARTING_SETUP } from "./indexGuide.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function runAITests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  ok("the AI module is versioned", AI_VERSION === 1);
  ok("AI_DIFFICULTIES ships easy/normal/hard with increasing depth",
    AI_DIFFICULTIES.easy.depth === 0 && AI_DIFFICULTIES.normal.depth === 1 &&
    AI_DIFFICULTIES.hard.depth === 2 && AI_DIFFICULTIES.easy.noise > 0 &&
    AI_DIFFICULTIES.normal.noise === 0 && AI_DIFFICULTIES.hard.noise === 0);
  ok("normalizeAIDifficulty handles strings, objects, and unknowns",
    normalizeAIDifficulty("hard").id === "hard" &&
    normalizeAIDifficulty({ depth: 3 }).depth === 3 &&
    normalizeAIDifficulty("nope") === AI_DIFFICULTIES.normal &&
    normalizeAIDifficulty(undefined) === AI_DIFFICULTIES.normal);
  ok("itemValue values the printed resources roughly (coins=1, metal=2)",
    itemValue({ coins: 1, metal: 1, wood: 1 }) === 4);

  const mkTrack = (n = 8) => createProgressTrack({
    spaces: Array.from({ length: n }, (_, i) => (i === n - 1 ? "end" : null)),
    startSpace: 2,
    incomeEnabled: false,
  });

  function makeGame(overrides = {}) {
    const g = createGameState({
      players: [
        { id: "A", charterId: 0, startingCoins: 4 },
        { id: "B", charterId: 1, startingCoins: 4 },
      ],
      firstPlayer: overrides.firstPlayer ?? "A",
      rng: overrides.rng ?? lcg(1),
      advancementConfig: { deck: [...STARTING_SETUP.advancementDeck] },
      objectivesConfig: [...STARTING_SETUP.objectives],
      progress: overrides.progress ?? mkTrack(),
      ...overrides,
    });
    return g;
  }

  // ── Task 62: the decision core never proposes an illegal move ──
  // Play out many seeded games where every turn is a proposeMove + applyMove.
  // At each position we record whether the proposed move passes the engine's
  // own preflight (and that every candidate move is legal too). We also drop
  // some random resources/influence onto the position to broaden the state
  // space without violating any invariant.
  {
    let positions = 0;
    let legalCount = 0;
    let candidateChecks = 0;
    let candidateLegal = 0;
    let games = 0;
    const errors = [];
    while (positions < 1000 && games < 60) {
      const seed = 700 + games * 17;
      const g = makeGame({ rng: lcg(seed), progress: mkTrack(8) });
      const difficulty = ["easy", "normal", "hard"][games % 3];
      let steps = 0;
      while (steps < 250 && !(g.progress.endReached() && g.turns.allCountsEqual())) {
        steps++;
        const pid = g.turns.currentPlayerId;
        // randomize the position a bit (always-legal mutations)
        if (positions % 3 === 0) {
          const r = ["metal", "coal", "pumpkin", "grain", "clay", "wood"][Math.floor(lcg(seed + positions)() * 6)];
          g.economy.gain(pid, { [r]: 1 + Math.floor(lcg(seed + positions + 1)() * 2) });
        }
        if (positions % 4 === 0 && g.influence.availableOf(pid) < 12) {
          g.influence.gain(pid, 1);
        }
        const cands = candidateActions(g, pid);
        for (const c of cands) {
          candidateChecks++;
          if (c.kind === "place") {
            const cp = g.engine.checkPlace(pid, c.cell, c.opts);
            if (cp.ok) candidateLegal++;
            else errors.push("illegal candidate " + c.buildingId + "@" + c.cell + ": " + cp.reason);
          } else {
            candidateLegal++;
          }
        }
        const mv = proposeMove(g, pid, { difficulty, rng: lcg(seed + steps) });
        positions++;
        if (!mv.ok) {
          // no legal move — the turn machine must still be able to resolve it
          const forced = g.engine.retrieveWorkers(pid);
          if (!forced.ok) { errors.push("stalled at " + pid + ": " + mv.reason); break; }
          legalCount++;
          continue;
        }
        if (mv.kind === "place") {
          const cp = g.engine.checkPlace(pid, mv.cell, mv.opts);
          if (cp.ok) legalCount++; else errors.push("illegal proposed " + mv.buildingId + "@" + mv.cell + ": " + cp.reason);
        } else if (mv.kind === "retrieve") {
          legalCount++;
        }
        const applied = applyMove(g, mv);
        if (!applied.ok && mv.kind !== "retrieve") errors.push("applyMove rejected: " + applied.reason);
      }
      games++;
    }
    ok("the AI never proposes an illegal move across 1000+ random positions",
      positions >= 1000 && legalCount === positions && errors.length === 0,
      "positions=" + positions + " legal=" + legalCount + " errors=" + errors.length);
    ok("every candidate move the AI enumerates passes the engine preflight",
      candidateChecks >= 1000 && candidateLegal === candidateChecks,
      "candidates=" + candidateChecks + " legal=" + candidateLegal);
    ok("the legality sweep covered all three difficulty levels", games >= 3);
  }

  // ── Task 63: construction strategy ──
  {
    // all AI-placed buildings sit on legal destinations across many positions
    let builds = 0;
    let legalBuilds = 0;
    const g = makeGame({ rng: lcg(99), progress: mkTrack(9) });
    g.economy.gain("A", { metal: 2, coal: 2, pumpkin: 2, grain: 2, clay: 2, wood: 2 });
    g.economy.gain("B", { metal: 2, coal: 2, pumpkin: 2, grain: 2, clay: 2, wood: 2 });
    try { g.player("A").gainCard("bldg-mine"); } catch (e) { /* held */ }
    try { g.player("B").gainCard("bldg-mill"); } catch (e) { /* held */ }
    let steps = 0;
    const sawZeppelin = [];
    while (steps < 200 && !(g.progress.endReached() && g.turns.allCountsEqual())) {
      steps++;
      const pid = g.turns.currentPlayerId;
      const mv = proposeMove(g, pid, { difficulty: "hard", rng: lcg(900 + steps) });
      if (!mv.ok) { g.engine.retrieveWorkers(pid); continue; }
      if (mv.kind === "place" && mv.buildingId === "zeppelin" && mv.opts && mv.opts.constructionCell) {
        builds++;
        const legal = g.engine.legalConstructionCellsForPlayer(pid).map(c => c.key);
        if (legal.includes(mv.opts.constructionCell)) legalBuilds++;
        sawZeppelin.push(mv.opts.constructionCell);
      }
      applyMove(g, mv);
    }
    ok("every AI-chosen construction cell is in the legal set",
      builds > 0 && builds === legalBuilds,
      "builds=" + builds + " legal=" + legalBuilds + " cells=" + JSON.stringify(sawZeppelin));

    // aiConstructionCell returns a legal cell for a held unconstructed card
    const g2 = makeGame({ rng: lcg(5), progress: mkTrack(9) });
    try { g2.player("A").gainCard("bldg-mine"); } catch (e) { /* held */ }
    const legalCells = g2.engine.legalConstructionCellsForPlayer("A").map(c => c.key);
    const pick = aiConstructionCell(g2, "A", "bldg-mine");
    ok("aiConstructionCell returns a legal cell for the construction card",
      pick.ok && legalCells.length > 0 && legalCells.includes(pick.cell),
      JSON.stringify({ pick, legalCells }));
    ok("aiConstructionCell returns no_legal_cells when none exist",
      (() => {
        const g3 = makeGame({ rng: lcg(6), progress: mkTrack(6) });
        for (const c of g3.board.destinationCells()) g3.board.placeBuilding(c, "quarry", "A");
        return !aiConstructionCell(g3, "A", "bldg-mine").ok;
      })());

    // cluster adjacency: a cell beside the player's own building wins over a
    // cell that only touches the charter
    const g4 = makeGame({ rng: lcg(7), progress: mkTrack(9) });
    try { g4.player("A").gainCard("bldg-mine"); } catch (e) { /* held */ }
    const charterCell = g4.board.charterCell(0);
    const charterCells = g4.board.adjacentDestinations(charterCell).filter(d => !d.buildingId);
    // put A's first building on one charter cell; that leaves the other charter
    // cells open — at least one of them should sit next to the new building too
    g4.board.placeBuilding(charterCells[0], "mill", "A");
    const pick2 = aiConstructionCell(g4, "A", "bldg-mine");
    ok("aiConstructionCell prefers a cell adjacent to the player's own building",
      pick2.ok && g4.board.isAdjacent(pick2.cell, charterCells[0]),
      "pick=" + pick2.cell + " firstBuilding=" + charterCells[0].key + " score=" + pick2.score);
  }

  // ── Task 64: hard beats easy ──
  {
    const mkTrack64 = () => createProgressTrack({
      spaces: Array.from({ length: 8 }, (_, i) => (i === 7 ? "end" : null)),
      startSpace: 2,
      incomeEnabled: false,
    });
    let hardWins = 0, easyWins = 0, ties = 0, games = 0, okGames = 0;
    for (let seed = 0; seed < 16; seed++) {
      const first = seed % 2 === 0 ? "A" : "B";
      // startCards grant one copy of the Mine card per player, so remove those
      // copies from the advancement deck to avoid duplicate building cards
      const granted = new Set(["bldg-mine"]);
      const deck = STARTING_SETUP.advancementDeck.filter(id => !granted.has(id));
      const r = simulateAIGame({
        rng: lcg(1000 + seed),
        difficulties: { A: "hard", B: "easy" },
        advancementConfig: { deck },
        progress: mkTrack64(),
        maxTurns: 300,
        startingResources: { wood: 3, clay: 3, grain: 3, pumpkin: 3, coal: 2 },
        startCards: { A: ["bldg-mine"], B: ["bldg-mine"] },
        firstPlayer: first,
      });
      games++;
      if (r.ok && r.winnerIds.length > 0) {
        okGames++;
        if (r.winnerIds.includes("A") && !r.winnerIds.includes("B")) hardWins++;
        else if (r.winnerIds.includes("B") && !r.winnerIds.includes("A")) easyWins++;
        else ties++;
      }
    }
    ok("hard beats easy in a majority of seeded 2-player simulations (Task 64)",
      games >= 12 && hardWins > easyWins,
      "hard=" + hardWins + " easy=" + easyWins + " ties=" + ties + " games=" + games + " ok=" + okGames);
    ok("all simulated games complete without illegal moves",
      okGames === games, "ok=" + okGames + " games=" + games);
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "ai", pass, fail, results };
}
