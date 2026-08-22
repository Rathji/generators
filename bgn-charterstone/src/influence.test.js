// src/influence.test.js — Task 7 validation suite for src/influence.js.
// Run in-page via ?test=influence, or programmatically via window.__loadInfluenceTests().
// Covers: the 12-token limit, static placements, discard-to-supply spends,
// regain-from-supply benefits, token conservation, and serialization.

import { createInfluencePool, TOKENS_PER_PLAYER } from "./influence.js";

export function runInfluenceTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const throws = fn => {
    try { fn(); return false; } catch (e) { return true; }
  };

  // ── creation ──
  const p = createInfluencePool({ playerIds: ["A", "B", "C"] });
  ok("each player starts with exactly 12 tokens", p.availableOf("A") === TOKENS_PER_PLAYER && p.availableOf("B") === TOKENS_PER_PLAYER && p.availableOf("C") === TOKENS_PER_PLAYER);
  ok("tokensPerPlayer is exported and applied", TOKENS_PER_PLAYER === 12 && p.tokensPerPlayer === 12);
  ok("totals reflect the full pool", JSON.stringify(p.totals()) === JSON.stringify({ total: 36, inHand: 36, placed: 0, supply: 0 }));
  ok("unknown player is rejected", throws(() => p.availableOf("ZZZ")) && throws(() => p.place("ZZZ", "x")));
  ok("empty players is allowed", createInfluencePool({}).totals().total === 0);
  ok("duplicate player ids are rejected", throws(() => createInfluencePool({ playerIds: ["A", "A"] })));
  ok("bad tokensPerPlayer is rejected", throws(() => createInfluencePool({ playerIds: ["A"], tokensPerPlayer: 0 })));

  // ── static placements ──
  const st = createInfluencePool({ playerIds: ["A"] });
  const placed = st.place("A", "objective:c1");
  ok("placing on a card consumes one token", placed.ok && placed.available === 11 && st.availableOf("A") === 11);
  ok("placement is recorded on its target", st.placedOn("A", "objective:c1") === 1 && st.placements("A").length === 1);
  ok("placement is static — no removal method exists", typeof st.place !== "undefined" && typeof st.unplace === "undefined" && typeof st.removePlacement === "undefined");
  st.place("A", "reputation:4");
  st.place("A", "reputation:4");
  ok("repeated placement on one target accumulates", st.placedOn("A", "reputation:4") === 2 && st.placedTotal("A") === 3 && st.availableOf("A") === 9);
  ok("placements stay out of the available supply", st.availableOf("A") + st.placedTotal("A") === TOKENS_PER_PLAYER);

  // ── spends & the 13th token ──
  const sp = createInfluencePool({ playerIds: ["A"] });
  for (let i = 0; i < 12; i++) {
    const res = sp.spend("A", 1);
    if (!res.ok) break;
  }
  const thirteenth = sp.spend("A", 1);
  ok("a 13th spend in one game is rejected", !thirteenth.ok && thirteenth.reason === "insufficient" && sp.availableOf("A") === 0);
  ok("spending discards the token to the general supply", sp.spentCount("A") === 12 && sp.supply() === 12);
  const noInfluencePlace = sp.place("A", "reputation:5");
  ok("placing with 0 available tokens is rejected", !noInfluencePlace.ok && noInfluencePlace.reason === "no_influence");
  const overSpend = sp.spend("A", 3);
  ok("over-spending reports the missing amount", !overSpend.ok && overSpend.missing === 3);

  // ── regain from the supply ──
  const rg = createInfluencePool({ playerIds: ["A", "B"] });
  rg.spend("A", 1);
  rg.spend("A", 2);
  rg.spend("B", 3);
  ok("spent tokens land in the shared supply", rg.supply() === 6 && rg.availableOf("A") === 9);
  const regain = rg.gain("A", 1);
  ok("a regain benefit restores exactly one token", regain.ok && regain.granted === 1 && rg.availableOf("A") === 10 && !regain.hasShortfall);
  const regain2 = rg.gain("A", 2);
  ok("regain can restore several tokens at once", regain2.granted === 2 && rg.availableOf("A") === 12);
  const capped = rg.gain("A", 1);
  ok("regain never exceeds 12 tokens", capped.granted === 0 && capped.hasShortfall && rg.availableOf("A") === 12);
  ok("supply is conserved through spend and regain",
    rg.totals().total === 24 && rg.totals().inHand + rg.totals().placed + rg.totals().supply === 24);

  // ── serialization ──
  const ser = createInfluencePool({ playerIds: ["A", "B"] });
  ser.place("A", "quota:q2");
  ser.spend("A", 2);
  ser.gain("A", 1);
  ser.place("B", "reputation:4");
  const sJSON = ser.toJSON();
  const ser2 = createInfluencePool({ playerIds: ["A", "B"] });
  ser2.fromJSON(sJSON);
  ok("influence round-trips identically", JSON.stringify(ser2.toJSON()) === JSON.stringify(sJSON));
  ok("influence restore keeps placements, spends and availability",
    ser2.availableOf("A") === 10 && ser2.placedOn("A", "quota:q2") === 1 &&
    ser2.spentCount("A") === 2 && ser2.placedOn("B", "reputation:4") === 1 && ser2.supply() === 1);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "influence", pass, fail, results };
}
