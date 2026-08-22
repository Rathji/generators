// src/turns.js — turn/round state machine (Task 4).
// Round-robin turns starting from the first player (die-rolled against active
// charters or supplied directly). Each turn is exactly one of ACTIONS.PLACE
// ("place a worker") or ACTIONS.RETRIEVE ("retrieve all workers"). A round
// closes when every player has taken the same number of turns.

export const ACTIONS = Object.freeze({ PLACE: "place", RETRIEVE: "retrieve" });

export function rollCharterstoneDie(rng = Math.random) {
  return Math.min(5, Math.floor(rng() * 6));
}

export function createTurnMachine(config = {}) {
  const players = (config.players || []).map(p => ({ id: p.id, charterId: p.charterId }));
  if (players.length < 1) throw new Error("turns: at least one player is required");
  for (const p of players) {
    if (typeof p.id !== "string" || !p.id) throw new Error("turns: player id required");
    if (!Number.isInteger(p.charterId) || p.charterId < 0 || p.charterId > 5) {
      throw new Error("turns: charterId must be an integer 0-5");
    }
  }
  const idSet = new Set(players.map(p => p.id));
  if (idSet.size !== players.length) throw new Error("turns: duplicate player ids");
  const n = players.length;
  const rng = config.rng || Math.random;

  function rollFirstPlayerId() {
    for (let i = 0; i < 100; i++) {
      const face = rollCharterstoneDie(rng);
      const match = players.find(p => p.charterId === face);
      if (match) return match.id;
    }
    return players[0].id;
  }

  const firstPlayerId = config.firstPlayer ?? rollFirstPlayerId();
  if (!players.some(p => p.id === firstPlayerId)) {
    throw new Error("turns: firstPlayer is not among the players");
  }
  const firstIndex = players.findIndex(p => p.id === firstPlayerId);

  let currentIndex = firstIndex;
  const counts = {};
  for (const p of players) counts[p.id] = 0;
  const history = [];

  const machine = {
    players: players.map(p => p.id),
    firstPlayerId,
    get currentPlayerId() {
      return players[currentIndex].id;
    },

    playerCharter(playerId) {
      const p = players.find(x => x.id === playerId);
      return p ? p.charterId : null;
    },
    counts() {
      return { ...counts };
    },
    turnsTaken() {
      return history.length;
    },
    completedRounds() {
      return Math.min(...players.map(p => counts[p.id]));
    },
    currentRound() {
      return machine.completedRounds() + 1;
    },
    isRoundComplete() {
      if (history.length === 0) return false;
      const min = machine.completedRounds();
      return players.every(p => counts[p.id] === min);
    },
    allCountsEqual() {
      const first = counts[players[0].id];
      return players.every(p => counts[p.id] === first);
    },
    legalActions() {
      return [ACTIONS.PLACE, ACTIONS.RETRIEVE];
    },
    seatOf(playerId) {
      const i = players.findIndex(p => p.id === playerId);
      return i === -1 ? null : i;
    },
    playerAtSeat(i) {
      const p = players[i];
      return p ? p.id : null;
    },
    nextPlayerId() {
      return players[(currentIndex + 1) % n].id;
    },
    isPlayerOnTurn(playerId) {
      return machine.currentPlayerId === playerId;
    },

    takeTurn(playerId, action) {
      if (playerId !== machine.currentPlayerId) {
        return { ok: false, reason: "not_your_turn", playerId, action };
      }
      if (action !== ACTIONS.PLACE && action !== ACTIONS.RETRIEVE) {
        return { ok: false, reason: "illegal_action", playerId, action };
      }
      counts[playerId] += 1;
      history.push({ turn: history.length + 1, playerId, action });
      currentIndex = (currentIndex + 1) % n;
      return {
        ok: true,
        playerId,
        action,
        turn: history.length,
        round: machine.currentRound(),
        roundJustCompleted: machine.isRoundComplete(),
        nextPlayerId: machine.currentPlayerId,
      };
    },

    history() {
      return history.map(h => ({ ...h }));
    },

    toJSON() {
      return {
        kind: "turns",
        players: players.map(p => ({ id: p.id, charterId: p.charterId })),
        firstPlayerId,
        currentPlayerId: machine.currentPlayerId,
        counts: { ...counts },
        history: machine.history(),
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("turns: bad fromJSON payload");
      for (const k of Object.keys(counts)) delete counts[k];
      Object.assign(counts, data.counts ?? {});
      history.length = 0;
      for (const h of data.history ?? []) history.push({ turn: h.turn, playerId: h.playerId, action: h.action });
      const idx = players.findIndex(p => p.id === data.currentPlayerId);
      currentIndex = idx === -1 ? firstIndex : idx;
      return machine;
    },
  };
  return machine;
}
