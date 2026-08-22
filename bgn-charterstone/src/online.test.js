// src/online.test.js — Phase 14 multiplayer validation (Tasks 65-68).
// Run in-page via ?test=online, or programmatically via window.__loadOnlineTests().
// Task 65 (lobby): rooms hold 1-6 seats; six clients join one room and each
//   sees the full seat map and its own seat (turn order = seat order).
// Task 66 (authoritative turn sync): the acting player's move is stored +
//   broadcast, stale turns and wrong-seat moves are rejected, and a client
//   that disconnects mid-turn reconnects to an identical board.
// Task 67 (online campaign persistence): campaign + snapshot survive a fully
//   closed room; reopening at game 4 keeps every legacy change.
// Task 68 (chat & presence): chat broadcasts to room members, rapid repeats
//   are rate-limited, joins emit presence, and N-players-online is global.
// These tests run in the unsaved-editor EMULATOR (single document, shared
// emulated server). Real cross-tab multiplayer only works once the
// generator is saved and published.

import { createOnlineClient, ONLINE_VERSION } from "./online.js";
import { createGameState, serializeGameState } from "./serialization.js";
import { createCampaignState, finishGame, beginNextGame, campaignStateToJSON, campaignStateFromJSON } from "./campaignState.js";

function sockFactory() {
  const r = (typeof window !== "undefined" && window.root) || null;
  return r && typeof r.createServerSocket === "function" ? r.createServerSocket() : null;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function runOnlineTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const mk = nm => createOnlineClient({ name: nm, socketFactory: sockFactory, autoReconnect: false });
  const closeAll = async clients => {
    for (const c of clients) { try { await c.leave(); } catch (e) {} try { c.close(); } catch (e) {} }
    await wait(80);
  };

  try {
    // ── Task 65: lobby (1-6 seats, join codes, host/join, presence) ──
    {
      const A = mk("Alpha");
      ok("online client exposes its API", ONLINE_VERSION === 1 && typeof A.connect === "function" && typeof A.joinRoom === "function");
      ok("client connects in the emulator", (await A.connect()) === true && A.isOpen === true);
      const r = await A.createRoom({ name: "Alpha", maxSeats: 6 });
      ok("host creates a 6-seat room", !!(r && r.ok === true));
      const code = r.code;
      ok("join code is 5 chars from the code alphabet", /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(code));
      ok("host takes seat 0", r.seat === 0);
      const clients = [A];
      const hostPresence = [];
      A.on("presence", m => hostPresence.push(m));
      for (let i = 1; i < 6; i++) {
        const c = mk("P" + i);
        await c.connect();
        const jr = await c.joinRoom({ code, name: "P" + i });
        ok("player " + i + " joins into seat " + i, !!(jr && jr.ok === true && jr.seat === i));
        clients.push(c);
      }
      await wait(120);
      const seats = A.snap.seats;
      ok("host sees all 6 seats with the right names", seats.length === 6 && seats.map(s => s.name).join(",") === "Alpha,P1,P2,P3,P4,P5");
      ok("host sees all 6 players connected", seats.every(s => s.connected));
      ok("each client knows its own seat (turn order = seat order)", clients.every((c, i) => c.seat === i));
      ok("host received presence events as players joined", hostPresence.length >= 5 && hostPresence[hostPresence.length - 1].online === 6);
      const fullRoom = await clients[5].getRoom(code);
      ok("a later joiner sees the same seat map", !!(fullRoom && fullRoom.ok && fullRoom.snap.seats.length === 6 && fullRoom.snap.seats[0].name === "Alpha"));
      const dup = await clients[1].joinRoom({ code, name: "P1" });
      ok("rejoining your own room is idempotent", !!(dup && dup.ok === true && dup.seat === 1));
      await closeAll(clients);
    }

    // ── Task 66: authoritative turn sync ──
    {
      const A = mk("H");
      await A.connect();
      const r = await A.createRoom({ name: "H", maxSeats: 2 });
      const code = r.code;
      const B = mk("G");
      await B.connect();
      await B.joinRoom({ code, name: "G" });
      const st = await A.startGame();
      ok("host starts the game", !!(st && st.ok === true) && A.snap.status === 2);
      const m1 = await A.submitMove({ turn: 0, snapshot: "SNAP-1" });
      ok("acting player's move accepted and bumps the turn", !!(m1 && m1.ok === true && m1.turn === 1));
      await wait(100);
      ok("opponent receives the broadcast snapshot", !!(B.snap && B.snap.snapshot === "SNAP-1" && B.snap.turn === 1));
      const m2 = await B.submitMove({ turn: 1, snapshot: "SNAP-2" });
      ok("second player's move accepted", !!(m2 && m2.ok === true));
      const stale = await A.submitMove({ turn: 1, snapshot: "OLD" });
      ok("stale turn counter is rejected", !!(stale && stale.ok === false && stale.err === "stale"));
      const raw = await A.rawRpc("move", JSON.stringify({ code, seat: 1, turn: 2, snapshot: "X" }));
      let rawObj; try { rawObj = JSON.parse(raw); } catch (e) { rawObj = null; }
      ok("server rejects a move claiming the wrong seat", !!(rawObj && rawObj.ok === false && rawObj.err === "wrong_seat"));
      const X = mk("X");
      await X.connect();
      const rawX = await X.rawRpc("move", JSON.stringify({ code, seat: 0, turn: 2, snapshot: "Y" }));
      let rawXObj; try { rawXObj = JSON.parse(rawX); } catch (e) { rawXObj = null; }
      ok("a non-member cannot move", !!(rawXObj && rawXObj.ok === false && rawXObj.err === "not_in_room"));
      await X.close();
      await B.close();
      await wait(120);
      const B2 = mk("G2");
      await B2.connect();
      const re = await B2.joinRoom({ code, seat: 1, name: "G2" });
      ok("a disconnected player reconnects to their seat", !!(re && re.ok === true && re.seat === 1));
      const rs = await B2.getRoom(code);
      ok("reconnect re-syncs an identical board", !!(rs && rs.ok && rs.snap.snapshot === "SNAP-2" && rs.snap.turn === 2 && rs.snap.status === 2));
      const eg = await A.endGame({ winner: 0 });
      ok("host can end the game", !!(eg && eg.ok === true) && A.snap.status === 3 && A.snap.winner === 0);
      await closeAll([A, B2]);
    }

    // ── Task 67: online campaign persistence ──
    {
      const P = createCampaignState({ players: [{ id: "p1", charterId: 0 }, { id: "p2", charterId: 1 }, { id: "p3", charterId: 2 }] });
      ok("campaign starts at game 1", P.gameNumber === 1);
      finishGame(P, { winnerId: "p1", legacy: { constructedBuildings: [{ buildingId: "bldg-mine", ownerId: "p1", q: 0, r: 0 }], stickers: ["sticker-legacy-1"] } });
      finishGame(P, { winnerId: "p2", legacy: { stickers: ["sticker-legacy-2"] } });
      finishGame(P, { winnerId: "p1", legacy: { stickers: ["sticker-legacy-3"] } });
      ok("campaign advanced to game 4 with legacy changes", P.gameNumber === 4 && P.stickers.length === 3 && P.constructedBuildings.length === 1);
      const campaignJson = JSON.stringify(campaignStateToJSON(P));
      ok("campaign JSON fits a room slot", campaignJson.length > 100 && campaignJson.length < 16384);
      const S = createGameState({ seed: 7, players: [{ id: "p1", charterId: 0 }, { id: "p2", charterId: 1 }, { id: "p3", charterId: 2 }], gameNumber: 3, campaignId: P.id });
      const snapJson = serializeGameState(S);
      ok("a real game-3 snapshot fits a room slot", snapJson.length > 1000 && snapJson.length < 48970);
      const A = mk("C0");
      await A.connect();
      const r = await A.createRoom({ name: "C0", maxSeats: 6 });
      const code = r.code;
      const B = mk("C1"); await B.connect(); await B.joinRoom({ code, name: "C1" });
      const C = mk("C2"); await C.connect(); await C.joinRoom({ code, name: "C2" });
      await A.startGame();
      const cm = await A.submitCampaign(campaignJson);
      ok("campaign accepted", !!(cm && cm.ok === true));
      const mv = await A.submitMove({ turn: 0, snapshot: snapJson });
      ok("game-3 snapshot move accepted", !!(mv && mv.ok === true));
      await closeAll([A, B, C]);
      const D0 = mk("D0"); await D0.connect();
      const re0 = await D0.joinRoom({ code, seat: 0, name: "D0" });
      const D1 = mk("D1"); await D1.connect();
      const re1 = await D1.joinRoom({ code, seat: 1, name: "D1" });
      const D2 = mk("D2"); await D2.connect();
      const re2 = await D2.joinRoom({ code, seat: 2, name: "D2" });
      ok("players rejoin their seats after the room closed", !!(re0 && re0.ok && re0.seat === 0) && re1.seat === 1 && re2.seat === 2);
      const got = await D0.getRoom(code);
      ok("campaign + snapshot intact after reopening", !!(got && got.ok && got.snap.campaign === campaignJson && got.snap.snapshot === snapJson && got.snap.turn === 1 && got.snap.status === 2));
      const restored = campaignStateFromJSON(JSON.parse(got.snap.campaign));
      ok("persisted campaign is game 4 with legacy intact", restored.gameNumber === 4 && restored.stickers.length === 3 && restored.constructedBuildings.length === 1);
      const next = beginNextGame(restored);
      ok("campaign reopens at game 4", !!(next && next.gameNumber === 4));
      await closeAll([D0, D1, D2]);
    }

    // ── Task 68: chat & presence ──
    {
      const A = mk("E0");
      await A.connect();
      const r = await A.createRoom({ name: "E0", maxSeats: 4 });
      const code = r.code;
      const B = mk("E1");
      await B.connect();
      await B.joinRoom({ code, name: "E1" });
      const chats = [];
      B.on("chat", m => chats.push(m));
      const c1 = await A.chat("Hello table");
      ok("first chat accepted", !!(c1 && c1.ok === true));
      await wait(120);
      ok("chat broadcasts to room members", chats.length === 1 && chats[0].text === "Hello table" && chats[0].seat === 0 && chats[0].name === "E0");
      const c2 = await A.chat("too fast");
      ok("rapid second chat is rate-limited", !!(c2 && c2.ok === false && c2.err === "rate_limited"));
      const pres = [];
      B.on("presence", m => pres.push(m));
      const C = mk("E2");
      await C.connect();
      await C.joinRoom({ code, name: "E2" });
      await wait(120);
      ok("joining emits presence to the room", pres.length >= 1 && pres[pres.length - 1].online === 3);
      const nA = await A.online();
      const nC = await C.online();
      ok("N-players-online indicator is global and consistent", nA >= 3 && nA === nC);
      await closeAll([A, B, C]);
      const Q = mk("Probe");
      await Q.connect();
      ok("online count drops after everyone leaves", (await Q.online()) === 0);
      await Q.close();
    }
  } catch (err) {
    ok("suite threw: " + (err && err.message ? err.message : err), false);
  }

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "online", pass, fail, results };
}
