// src/scoring.js — end-game scoring tally (Tasks 32-33).
// When the progress token reaches the end and the round is finished (each
// player has taken the same number of turns), the engine runs end-game
// scoring. Each player's final score sums four components:
//   reputationVp — 10/7/4 VP by reputation-token count (ties share their tier,
//                  0 tokens do not qualify; see src/reputation.js Task 9),
//   objectiveVp  — OBJECTIVE_VP per objective card the player scored,
//   buildingVp   — the sum of each constructed building's tile vp,
//   crateVp      — CRATE_VP per crate the player unlocked.
// Ties break by most reputation tokens, then most constructed buildings.
// CRATE_VP is PROVISIONAL: the printed game values crates through their
// content (buildings, personas), so Phase 9/42 refines it with the real
// Index Guide data. OBJECTIVE_VP matches the printed Grandstand benefit.

import { scoreReputation } from "./reputation.js";

export const OBJECTIVE_VP = 5;
export const CRATE_VP = 5;

export function scoreEndGame(state) {
  const rep = Object.fromEntries(
    scoreReputation(state.reputation.counts()).map(s => [s.playerId, s.vp])
  );
  const ad = state.automaData;
  const mult = ad && typeof ad.vpMultiplier === "number" ? ad.vpMultiplier : 1;
  const automaId = ad ? ad.automaId : null;
  const players = state.playerIds().map(pid => {
    const constructed = state.board.buildingsByOwner(pid);
    const buildingVp = constructed.reduce((sum, b) => {
      const tile = state.buildingTiles ? state.buildingTiles[b.buildingId] : null;
      return sum + (tile ? (tile.vp ?? 0) : 0);
    }, 0);
    const crates = state.crates ? state.crates.unlocked().filter(u => u.playerId === pid).length : 0;
    const objectiveVp = state.objectives ? state.objectives.scoredCount(pid) * OBJECTIVE_VP : 0;
    const reputationVp = rep[pid] ?? 0;
    // The Automa's difficulty multiplier scales ALL its scored sources (per
    // the automa-difficulty rule) — its reputation tokens, objectives,
    // buildings, and crates all yield scaled VP at end-game.
    const scaled = pid === automaId;
    const repVp = scaled ? Math.round(reputationVp * mult) : reputationVp;
    const objVp = scaled ? Math.round(objectiveVp * mult) : objectiveVp;
    const bldVp = scaled ? Math.round(buildingVp * mult) : buildingVp;
    const crVp = scaled ? Math.round(crates * CRATE_VP * mult) : crates * CRATE_VP;
    return {
      playerId: pid,
      reputationTokens: state.reputation.tokensOf(pid),
      reputationVp: repVp,
      objectiveVp: objVp,
      buildingVp: bldVp,
      crateVp: crVp,
      constructedBuildings: constructed.length,
      total: repVp + objVp + bldVp + crVp,
    };
  });
  players.sort((a, b) =>
    b.total - a.total ||
    b.reputationTokens - a.reputationTokens ||
    b.constructedBuildings - a.constructedBuildings ||
    a.playerId.localeCompare(b.playerId));
  let rank = 1;
  for (let i = 0; i < players.length; i++) {
    if (i > 0 &&
        (players[i].total !== players[i - 1].total ||
         players[i].reputationTokens !== players[i - 1].reputationTokens ||
         players[i].constructedBuildings !== players[i - 1].constructedBuildings)) {
      rank = i + 1;
    }
    players[i].rank = rank;
  }
  return players;
}
