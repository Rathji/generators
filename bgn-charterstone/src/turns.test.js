// src/turns.test.js — Task 4 validation suite for src/turns.js.
// Run in-page via ?test=turns, or programmatically via window.__loadTurnTests().

import { createTurnMachine, ACTIONS, rollCharterstoneDie } from "./turns.js";

export function runTurnTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };

  const P = [
    { id: "A", charterId: 0 },
    { id: "B", charterId: 1 },
    { id: "C", charterId: 2 },
    { id: "D", charterId: 3 },
  ];

  // ── creation & first player ──
  const m = createTurnMachine({ players: P, firstPlayer: "B" });
  ok("explicit first player is honoured", m.firstPlayerId === "B" && m.currentPlayerId === "B");
  ok("first player is in the players list", m.players.includes(m.firstPlayerId));
  ok("seat order is the registration order", m.players.join(",") === "A,B,C,D");
  ok("charterId maps through playerCharter", m.playerCharter("C") === 2 && m.playerCharter("D") === 3);

  const rngSeq = [0.75, 0.4];
  const rng = () => (rngSeq.length ? rngSeq.shift() : 0);
  const rolled = createTurnMachine({ players: P, rng });
  ok("die roll re-rolls inactive charters (4 then 2 → C)", rolled.firstPlayerId === "C");
  const alwaysFirst = createTurnMachine({ players: P, rng: () => 0 });
  ok("die roll of charter 0 picks player A", alwaysFirst.firstPlayerId === "A");

  ok("rollCharterstoneDie honours rng bounds",
    rollCharterstoneDie(() => 0) === 0 &&
    rollCharterstoneDie(() => 0.5) === 3 &&
    rollCharterstoneDie(() => 0.99999) === 5);

  ok("empty players is rejected", throws(() => createTurnMachine({ players: [] })));
  ok("duplicate player ids are rejected", throws(() => createTurnMachine({ players: [P[0], { ...P[0] }] })));
  ok("bad charterId is rejected", throws(() => createTurnMachine({ players: [{ id: "X", charterId: 9 }] })));
  ok("firstPlayer not among players is rejected", throws(() => createTurnMachine({ players: P, firstPlayer: "ZZZ" })));

  // ── turn progression ──
  const t = createTurnMachine({ players: P, firstPlayer: "A" });
  const order = [];
  for (let i = 0; i < 8; i++) {
    const res = t.takeTurn(t.currentPlayerId, i % 2 === 0 ? ACTIONS.PLACE : ACTIONS.RETRIEVE);
    order.push(res.playerId);
  }
  ok("turns proceed round-robin from the first player", order.join(",") === "A,B,C,D,A,B,C,D");
  ok("turnsTaken counts every completed turn", t.turnsTaken() === 8);
  ok("counts track per-player turns", JSON.stringify(t.counts()) === JSON.stringify({ A: 2, B: 2, C: 2, D: 2 }));
  ok("play wraps around to the front player after the last seat", t.currentPlayerId === "A" && t.nextPlayerId() === "B");
  ok("seatOf and playerAtSeat are inverse", t.seatOf("C") === 2 && t.playerAtSeat(2) === "C");
  ok("isPlayerOnTurn reflects the current player", t.isPlayerOnTurn("A") && !t.isPlayerOnTurn("B"));

  // ── legality of turns ──
  const l = createTurnMachine({ players: P, firstPlayer: "A" });
  const wrong = l.takeTurn("C", ACTIONS.PLACE);
  ok("out-of-turn move is rejected", !wrong.ok && wrong.reason === "not_your_turn");
  ok("rejected move does not advance the turn", l.currentPlayerId === "A" && l.turnsTaken() === 0);
  const bad = l.takeTurn("A", "build");
  ok("illegal action is rejected", !bad.ok && bad.reason === "illegal_action");
  ok("legalActions exposes exactly the two turn actions",
    l.legalActions().join(",") === ACTIONS.PLACE + "," + ACTIONS.RETRIEVE);
  const okTurn = l.takeTurn("A", ACTIONS.PLACE);
  ok("a legal turn returns its details", okTurn.ok && okTurn.turn === 1 && okTurn.playerId === "A" && okTurn.nextPlayerId === "B");

  // ── round completion ──
  const r = createTurnMachine({ players: P, firstPlayer: "A" });
  const flags = [];
  let last;
  for (let i = 0; i < 12; i++) {
    last = r.takeTurn(r.currentPlayerId, i % 2 === 0 ? ACTIONS.PLACE : ACTIONS.RETRIEVE);
    flags.push(last.roundJustCompleted);
  }
  ok("round completes only at 4-turn boundaries", flags.join(",") === "false,false,false,true,false,false,false,true,false,false,false,true");
  ok("a 4-player round closes only after 12 turns", r.isRoundComplete() && r.completedRounds() === 3 && r.currentRound() === 4);
  ok("turn 12 hands play back to the first player", last.nextPlayerId === "A");
  ok("mid-round state is correctly incomplete", !createTurnMachine({ players: P, firstPlayer: "A" }).isRoundComplete());
  const mid = createTurnMachine({ players: P, firstPlayer: "A" });
  for (let i = 0; i < 11; i++) mid.takeTurn(mid.currentPlayerId, ACTIONS.PLACE);
  ok("after 11 turns the round is not yet complete", !mid.isRoundComplete() && mid.completedRounds() === 2);
  const lastTurn = mid.takeTurn(mid.currentPlayerId, ACTIONS.RETRIEVE);
  ok("the 12th turn closes the round", lastTurn.roundJustCompleted && mid.completedRounds() === 3 && lastTurn.nextPlayerId === "A");

  // ── history & copies ──
  const h = createTurnMachine({ players: P, firstPlayer: "B" });
  h.takeTurn("B", ACTIONS.PLACE);
  h.takeTurn("C", ACTIONS.RETRIEVE);
  const hist = h.history();
  ok("history records turn, player, action in order",
    hist.length === 2 && hist[0].turn === 1 && hist[0].playerId === "B" && hist[0].action === "place" &&
    hist[1].playerId === "C" && hist[1].action === "retrieve");
  hist[0].playerId = "HACK";
  ok("history is a detached copy", h.history()[0].playerId === "B");
  const countsCopy = h.counts();
  countsCopy.B = 99;
  ok("counts is a detached copy", h.counts().B === 1);

  // ── single player ──
  const solo = createTurnMachine({ players: [{ id: "S", charterId: 5 }], firstPlayer: "S" });
  const soloTurn = solo.takeTurn("S", ACTIONS.PLACE);
  ok("solo game rounds complete on every turn", soloTurn.roundJustCompleted && solo.nextPlayerId() === "S" && solo.currentRound() === 2);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "turns", pass, fail, results };
}
