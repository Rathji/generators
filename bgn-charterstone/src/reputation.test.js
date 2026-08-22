// src/reputation.test.js — Tasks 8 & 9 validation suite for src/reputation.js.
// Run in-page via ?test=reputation, or programmatically via window.__loadReputationTests().
// Task 8: the track — first token on the player-count space, then the next
// open space toward the ocean, 1 influence token per placement, full track
// rejects. Task 9: end-game scoring 10/7/4 with ties sharing a tier and
// 0-token players not qualifying.

import { createReputationTrack, scoreReputation, REPUTATION_MAX_SPACE } from "./reputation.js";
import { createInfluencePool } from "./influence.js";

export function runReputationTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };

  // ── Task 8: track geometry & placement ──
  const ids = ["A", "B", "C", "D"];
  const influence = createInfluencePool({ playerIds: ids });
  const t = createReputationTrack({ playerCount: 4, playerIds: ids, influence });

  ok("a 4-player track starts at space 4", t.firstSpace === 4 && t.length === REPUTATION_MAX_SPACE - 4 + 1 && t.length === 7);
  const first = t.place("A");
  ok("the first token lands on the space matching the player count", first.ok && first.space === 4);
  ok("a placement costs exactly 1 influence token", influence.availableOf("A") === 11 && influence.placedOn("A", "reputation:4") === 1);
  const second = t.place("B");
  const third = t.place("A");
  ok("further tokens go to the next open space closer to the ocean",
    second.space === 5 && third.space === 6 && t.tokensOf("A") === 2 && t.tokensOf("B") === 1);
  ok("occupied lists spaces in order", JSON.stringify(t.occupied().map(x => x.space)) === JSON.stringify([4, 5, 6]));
  ok("counts track every player", JSON.stringify(t.counts()) === JSON.stringify({ A: 2, B: 1, C: 0, D: 0 }));
  ok("nextOpenSpace reports the first free space", t.nextOpenSpace() === 7);

  for (let i = 0; i < 4; i++) {
    const r = t.place(ids[i % 4]);
    if (!r.ok) break;
  }
  const last = t.place("A");
  ok("a full track rejects further placements",
    t.isFull() && t.nextOpenSpace() === null && !last.ok && last.reason === "track_full");

  const noInfluenceTrack = createReputationTrack({ playerCount: 3, playerIds: ["X"] });
  ok("without an influence pool placement still tracks spaces",
    noInfluenceTrack.place("X").space === 3 && noInfluenceTrack.tokensOf("X") === 1);

  const broke = createInfluencePool({ playerIds: ["Y"] });
  for (let i = 0; i < 12; i++) broke.spend("Y", 1);
  const brokeTrack = createReputationTrack({ playerCount: 3, playerIds: ["Y"], influence: broke });
  const noTok = brokeTrack.place("Y");
  ok("placing reputation with 0 influence tokens is rejected", !noTok.ok && noTok.reason === "no_influence");
  ok("invalid config is rejected",
    throws(() => createReputationTrack({ playerCount: 0 })) &&
    throws(() => createReputationTrack({ playerCount: 7 })) &&
    throws(() => createReputationTrack({ playerCount: 4, maxSpace: 3 })));

  // ── Task 8: serialization ──
  const serInf = createInfluencePool({ playerIds: ids });
  const ser = createReputationTrack({ playerCount: 4, playerIds: ids, influence: serInf });
  ser.place("A");
  ser.place("B");
  ser.place("C");
  const sJSON = ser.toJSON();
  const serInf2 = createInfluencePool({ playerIds: ids });
  const ser2 = createReputationTrack({ playerCount: 4, playerIds: ids, influence: serInf2 });
  ser2.fromJSON(sJSON);
  ok("reputation track round-trips identically", JSON.stringify(ser2.toJSON()) === JSON.stringify(sJSON));
  ok("reputation restore keeps placements and stays live",
    ser2.tokensOf("A") === 1 && ser2.nextOpenSpace() === 7 && ser2.place("D").space === 7);

  // ── Task 9: end-game scoring ──
  const scored = scoreReputation({ A: 5, B: 3, C: 3, D: 1 });
  const byId = Object.fromEntries(scored.map(s => [s.playerId, s.vp]));
  ok("token counts {5,3,3,1} score {10,7,7,4}", JSON.stringify(byId) === JSON.stringify({ A: 10, B: 7, C: 7, D: 4 }));
  ok("scoring reports tokens alongside vp", scored.find(s => s.playerId === "A").tokens === 5);

  const zeros = scoreReputation({ A: 5, B: 0, C: 3, D: 1 });
  const zById = Object.fromEntries(zeros.map(s => [s.playerId, s.vp]));
  ok("players with 0 tokens do not qualify and keep their tier free",
    JSON.stringify(zById) === JSON.stringify({ A: 10, B: 0, C: 7, D: 4 }));

  const allZero = scoreReputation({ A: 0, B: 0 });
  ok("an all-zero game scores nothing", allZero.every(s => s.vp === 0));

  const tie = scoreReputation([{ playerId: "X", tokens: 2 }, { playerId: "Y", tokens: 2 }, { playerId: "Z", tokens: 2 }]);
  ok("a full tie shares the top tier", tie.every(s => s.vp === 10));

  const arrayForm = scoreReputation([{ playerId: "A", tokens: 6 }, { playerId: "B", tokens: 4 }, { playerId: "C", tokens: 2 }, { playerId: "D", tokens: 1 }]);
  const aById = Object.fromEntries(arrayForm.map(s => [s.playerId, s.vp]));
  ok("beyond three distinct tiers the lowest tier scores nothing (10/7/4 only)",
    JSON.stringify(aById) === JSON.stringify({ A: 10, B: 7, C: 4, D: 0 }));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "reputation", pass, fail, results };
}
