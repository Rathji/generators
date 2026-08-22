// src/serialization.test.js — Task 6 validation suite for src/serialization.js.
// Run in-page via ?test=serialization, or programmatically via window.__loadSerializationTests().
// Covers: per-module toJSON/fromJSON round-trips, the container's JSON-string
// round-trip, serialize → restore → resume with identical legal actions, and
// kv-plugin persistence (skipped gracefully when the plugin is unavailable).

import { createGameState, serializeGameState, restoreGameState, saveGameStateToKv, loadGameStateFromKv, deleteGameStateFromKv } from "./serialization.js";
import { createBoard } from "./board.js";
import { createEconomy, restoreEconomy } from "./economy.js";
import { createPlayer, restorePlayer } from "./player.js";
import { createTurnMachine } from "./turns.js";
import { createProgressTrack } from "./progress.js";

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!(k in b) || !deepEqual(a[k], b[k])) return false;
  }
  return true;
}

export async function runSerializationTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };

  const PLAYERS = [
    { id: "A", charterId: 0, startingCoins: 4 },
    { id: "B", charterId: 1, startingCoins: 4 },
    { id: "C", charterId: 2, startingCoins: 4 },
  ];

  // ── per-module round-trips ──
  const board = createBoard();
  const bCell = board.legalConstructionCellsForCharter(1)[0];
  board.placeBuilding(bCell, "forge-01", "B");
  board.placeBuilding(board.legalConstructionCellsForCharter(2)[0], "mill-02", "C");
  const bJSON = board.toJSON();
  const board2 = createBoard({ destinationRings: bJSON.destinationRings });
  board2.fromJSON(bJSON);
  ok("board round-trips identically", deepEqual(board2.toJSON(), bJSON));
  ok("board restores constructed buildings and owners",
    board2.constructedBuildings().length === 2 &&
    board2.constructedBuildings().some(x => x.buildingId === "forge-01" && x.ownerId === "B") &&
    board2.buildingAt(bCell) === "forge-01" && board2.ownerAt(bCell) === "B");

  const eco = createEconomy();
  eco.addPlayer("A");
  eco.addPlayer("B");
  eco.gain("A", { coins: 4, metal: 3 });
  eco.gain("B", { wood: 2 });
  eco.pay("A", { metal: 1 });
  const eJSON = eco.toJSON();
  const eco2 = restoreEconomy(eJSON);
  ok("economy round-trips identically", deepEqual(eco2.toJSON(), eJSON));
  ok("economy restore preserves balances and conservation",
    eco2.amountOf("A", "metal") === 2 && eco2.amountOf("B", "wood") === 2 &&
    deepEqual(eco2.totals(), eco2.initialTotals()) && eco2.canPay("A", { coins: 4 }));

  const turns = createTurnMachine({ players: PLAYERS.map(p => ({ id: p.id, charterId: p.charterId })), firstPlayer: "A" });
  turns.takeTurn("A", "place");
  turns.takeTurn("B", "retrieve");
  const tJSON = turns.toJSON();
  const turns2 = createTurnMachine({ players: PLAYERS.map(p => ({ id: p.id, charterId: p.charterId })), firstPlayer: "A" });
  turns2.fromJSON(tJSON);
  ok("turns round-trips identically", deepEqual(turns2.toJSON(), tJSON));
  ok("turns restore keeps the in-progress player, counts and history",
    turns2.currentPlayerId === "C" && deepEqual(turns2.counts(), { A: 1, B: 1, C: 0 }) && turns2.turnsTaken() === 2 &&
    turns2.takeTurn("C", "place").ok);

  const progress = createProgressTrack({ playerCount: 3 });
  progress.advance("construct");
  progress.advance("crate");
  const pJSON = progress.toJSON();
  const progress2 = createProgressTrack({ spaces: pJSON.spaces, startSpace: pJSON.startSpace, incomeEnabled: pJSON.incomeEnabled });
  progress2.fromJSON(pJSON);
  ok("progress round-trips identically", deepEqual(progress2.toJSON(), pJSON));
  ok("progress restore keeps position and stays live",
    progress2.position === 5 && progress2.advance("objective").ok && progress2.position === 6);

  const eco3 = createEconomy();
  const pA = createPlayer({ id: "A", charterId: 0, startingCoins: 4, economy: eco3 });
  pA.addVp(3);
  pA.spendWorkers(1);
  pA.gainCard("assistant-03");
  const pJSON2 = pA.toJSON();
  const pA2 = restorePlayer(pJSON2, eco3);
  ok("player round-trips identically", deepEqual(pA2.toJSON(), pJSON2));
  ok("player restore preserves spent tokens and cards",
    pA2.workers === 1 && pA2.vp === 3 && pA2.hasCard("assistant-03") &&
    pA2.coins() === 4 && deepEqual(pA2.snapshot(), pA.snapshot()));

  // ── container: scripted 10-action game → serialize → restore → resume ──
  const g = createGameState({ players: PLAYERS, firstPlayer: "A", campaignId: "camp-test", gameNumber: 1 });

  const actions = [
    () => { g.addLogEntry({ event: "setup", detail: { players: 3 } }); g.economy.gain("A", { metal: 2, clay: 1 }); },
    () => g.turns.takeTurn("A", "place"),
    () => g.board.placeBuilding(g.board.legalConstructionCellsForCharter(1)[0], "forge-01", "B"),
    () => g.progress.advance("construct"),
    () => { g.economy.pay("B", { coins: 1 }); g.addLogEntry({ event: "pay", detail: { coins: 1 } }); },
    () => g.player("B").gainCard("assistant-03"),
    () => g.turns.takeTurn("B", "place"),
    () => g.player("A").addVp(3),
    () => g.economy.gain("C", { wood: 3 }),
    () => g.turns.takeTurn("C", "retrieve"),
  ];

  for (let i = 0; i < actions.length; i++) {
    let res;
    try { res = actions[i](); } catch (e) { res = { threw: e.message }; }
    ok("scripted action " + (i + 1) + " applies", res === undefined || (res && res.ok !== false) || (res && res.granted && !res.threw), res && res.threw ? res.threw : "");
  }

  const data = JSON.parse(serializeGameState(g));
  ok("serialized state is JSON with the right kind/version",
    data.kind === "charterstone-game" && data.version === 1 && typeof data.board === "object" && typeof data.log === "object");

  const g2 = restoreGameState(JSON.stringify(data));
  ok("restore from JSON string yields identical state", deepEqual(g2.toJSON(), data));
  const g3 = restoreGameState(data);
  ok("restore from a plain object yields identical state", deepEqual(g3.toJSON(), data));

  const legalBefore = () => ({
    legal: g.turns.legalActions().join(","),
    current: g.turns.currentPlayerId,
    next: g.turns.nextPlayerId(),
    rounds: g.turns.completedRounds(),
    progress: g.progress.position,
    buildings: g.board.constructedBuildings().length,
    totals: g.economy.totals(),
    logLen: g.log().length,
  });
  const before1 = legalBefore();
  const before2 = (() => { const gx = restoreGameState(data); return { legal: gx.turns.legalActions().join(","), current: gx.turns.currentPlayerId, next: gx.turns.nextPlayerId(), rounds: gx.turns.completedRounds(), progress: gx.progress.position, buildings: gx.board.constructedBuildings().length, totals: gx.economy.totals(), logLen: gx.log().length }; })();
  ok("restored state yields identical legal actions and mirrors the live state",
    deepEqual(before1, before2) && before1.legal === "place,retrieve");

  const resumeOn = gx => {
    const r1 = gx.turns.takeTurn(gx.turns.currentPlayerId, "place");
    const r2 = gx.economy.gain("A", { grain: 2 });
    const r3 = gx.progress.advance("objective");
    const r4 = gx.board.placeBuilding(gx.board.legalConstructionCellsForCharter(2)[0], "mill-02", "C");
    const r5 = gx.turns.takeTurn(gx.turns.currentPlayerId, "retrieve");
    return { r1, r2, r3, r4, r5 };
  };
  const out1 = resumeOn(g);
  const out2 = resumeOn(g2);
  ok("resume after restore produces identical outcomes", deepEqual(out1, out2));
  ok("resumed states stay fully in sync", deepEqual(g2.toJSON(), g.toJSON()));
  ok("resumed engine stays live (turn advances, board grows)",
    g.turns.turnsTaken() === 5 && g.board.constructedBuildings().length === 2 &&
    g.progress.position === (data.progress.position + 1) && g.player("A").vp === 3);

  ok("bad payload is rejected", throws(() => restoreGameState("{not json")) && throws(() => restoreGameState({ kind: "nope" })));

  // ── container integration of the Phase-2 modules (Tasks 7-10) ──
  const g2p = createGameState({ players: PLAYERS, firstPlayer: "A" });
  g2p.economy.gain("A", { grain: 3, wood: 2 });
  const repPlace = g2p.reputation.place("A");
  const quotaSell = g2p.quota.sell("A", "q2"); // grain 2, +1 reputation
  const data2p = JSON.parse(g2p.serialize());
  const g2p2 = restoreGameState(data2p);
  ok("container state includes the Phase-2 modules", !!(data2p.influence && data2p.reputation && data2p.quota));
  ok("container round-trip preserves influence/reputation/quota",
    deepEqual(g2p2.influence.toJSON(), g2p.influence.toJSON()) &&
    deepEqual(g2p2.reputation.toJSON(), g2p.reputation.toJSON()) &&
    deepEqual(g2p2.quota.toJSON(), g2p.quota.toJSON()));
  ok("the quota sell through the container awarded 3 VP, 1 reputation and consumed the commodity",
    quotaSell.ok && quotaSell.vpGained === 3 && quotaSell.reputationGained === 1 && repPlace.space === 3 &&
    g2p.player("A").vp === 3 && g2p.reputation.tokensOf("A") === 2 &&
    g2p.reputation.occupied().map(x => x.space).join(",") === "3,4" &&
    g2p.economy.amountOf("A", "grain") === 1 && g2p.influence.availableOf("A") === 9);

  // ── kv-plugin persistence (skipped when unavailable) ──
  const kv = (typeof window !== "undefined" && (window.kv || (window.root && window.root.kv))) || null;
  if (!kv) {
    results.push({ name: "kv persistence (skipped: kv-plugin unavailable)", pass: true, detail: "kv is not present in this page" });
  } else {
    const folder = "charterstone-test";
    const key = "roundtrip";
    try {
      await saveGameStateToKv(g, { kv, folder, key });
      const loaded = await loadGameStateFromKv({ kv, folder, key });
      ok("kv save→load restores an identical live state", loaded !== null && deepEqual(loaded.toJSON(), g.toJSON()));
      ok("kv-loaded state is a live engine (legal actions identical)",
        loaded.turns.legalActions().join(",") === g.turns.legalActions().join(",") &&
        loaded.turns.currentPlayerId === g.turns.currentPlayerId && loaded.progress.position === g.progress.position);
      await deleteGameStateFromKv({ kv, folder, key });
      const gone = await loadGameStateFromKv({ kv, folder, key });
      ok("kv delete removes the saved state", gone === null);
    } catch (err) {
      ok("kv persistence completes without errors", false, err.message);
    }
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "serialization", pass, fail, results };
}
