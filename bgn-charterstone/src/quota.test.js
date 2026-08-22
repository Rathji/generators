// src/quota.test.js — Task 10 validation suite for src/quota.js.
// Run in-page via ?test=quota, or programmatically via window.__loadQuotaTests().
// Covers: paying the exact commodity, placing 1 influence on the quota space,
// the building's VP benefit plus the optional space bonus (+1 VP or +1
// reputation), closed/insufficient/no-influence rejections, and serialization.

import { createQuotaTrack, QUOTA_BONUS } from "./quota.js";
import { createEconomy } from "./economy.js";
import { createInfluencePool } from "./influence.js";
import { createReputationTrack } from "./reputation.js";
import { createPlayer } from "./player.js";

export function runQuotaTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  function rig() {
    const eco = createEconomy();
    for (const id of ["A", "B"]) eco.addPlayer(id);
    eco.gain("A", { grain: 3, wood: 2, clay: 3 });
    eco.gain("B", { grain: 3, wood: 2, coal: 3 });
    const infl = createInfluencePool({ playerIds: ["A", "B"] });
    const rep = createReputationTrack({ playerCount: 4, playerIds: ["A", "B"], influence: infl });
    const players = {
      A: createPlayer({ id: "A", charterId: 0, economy: eco }),
      B: createPlayer({ id: "B", charterId: 1, economy: eco }),
    };
    const quota = createQuotaTrack({
      influence: infl,
      economy: eco,
      reputation: rep,
      playerOf: id => players[id] ?? null,
      vpBenefit: 3,
    });
    return { eco, infl, rep, quota, players };
  }

  // ── the +1-reputation space ──
  const r = rig();
  const sell = r.quota.sell("A", "q2"); // q2 = grain 2, +1 reputation
  ok("selling on the +1-reputation space awards 3 VP and exactly 1 reputation",
    sell.ok && sell.vpGained === 3 && sell.reputationGained === 1 && sell.bonusTaken);
  ok("the seller's VP is credited", r.players.A.vp === 3);
  ok("reputation lands on the next open reputation space", r.rep.tokensOf("A") === 1 && r.rep.occupied()[0].space === 4);
  ok("the exact commodity is consumed", r.eco.amountOf("A", "grain") === 1);
  ok("both placements are static (quota + reputation)",
    r.infl.placedOn("A", "quota:q2") === 1 && r.infl.placedOn("A", "reputation:4") === 1 && r.infl.availableOf("A") === 10);
  ok("influence is conserved", r.infl.totals().inHand + r.infl.totals().placed + r.infl.totals().supply === r.infl.totals().total);
  ok("the quota space is now closed", !r.quota.isOpen("q2") && r.quota.occupant("q2") === "A");

  // ── the +1-VP space ──
  const sellVp = r.quota.sell("B", "q1"); // q1 = wood 2, +1 VP
  ok("the +1-VP space awards 3 VP plus 1 bonus VP",
    sellVp.ok && sellVp.vpGained === 4 && sellVp.reputationGained === 0 && sellVp.bonusTaken);
  ok("B's VP is credited and the commodity consumed", r.players.B.vp === 4 && r.eco.amountOf("B", "wood") === 0);

  // ── rejections ──
  const poor = r.quota.sell("B", "q3"); // q3 = clay 2; B has no clay
  ok("an unpayable commodity blocks the sale", !poor.ok && poor.reason === "insufficient");
  ok("a rejected sale consumes nothing",
    r.quota.isOpen("q3") && r.infl.availableOf("B") === 11 && r.players.B.vp === 4 && r.eco.totals().coal === 12);
  const again = r.quota.sell("A", "q2");
  ok("an occupied space cannot be sold again", !again.ok && again.reason === "space_closed");
  const unknown = r.quota.sell("A", "nope");
  ok("unknown quota spaces are rejected", !unknown.ok && unknown.reason === "no_such_space");

  const r2 = rig();
  for (let i = 0; i < 12; i++) r2.infl.spend("B", 1);
  const noInf = r2.quota.sell("B", "q1");
  ok("selling with 0 influence tokens is rejected", !noInf.ok && noInf.reason === "no_influence");
  ok("the rejected sale leaves the space open and the commodity unspent",
    r2.quota.isOpen("q1") && r2.eco.amountOf("B", "wood") === 2 && r2.players.B.vp === 0);

  // ── the track fills ──
  const r3 = rig();
  const filled = [
    r3.quota.sell("A", "q1"), // A wood 2
    r3.quota.sell("B", "q2"), // B grain 2
    r3.quota.sell("A", "q3"), // A clay 3
    r3.quota.sell("B", "q4"), // B coal 3
  ];
  const overflow = r3.quota.sell("A", "q1");
  ok("the four spaces fill and further sales are rejected",
    filled.every(x => x.ok) && !overflow.ok && overflow.reason === "space_closed" &&
    r3.quota.spaces().every(s => s.occupiedBy !== null));

  // ── config validation ──
  const badBonus = { id: "qX", commodity: { type: "wood", quantity: 1 }, bonus: "money" };
  const dup = { id: "q1", commodity: { type: "wood", quantity: 1 }, bonus: QUOTA_BONUS.VP };
  const badQty = { id: "qY", commodity: { type: "wood", quantity: 0 }, bonus: QUOTA_BONUS.VP };
  let threw1 = false, threw2 = false, threw3 = false;
  try { createQuotaTrack({ spaces: [dup, dup] }); } catch (e) { threw1 = true; }
  try { createQuotaTrack({ spaces: [badBonus] }); } catch (e) { threw2 = true; }
  try { createQuotaTrack({ spaces: [badQty] }); } catch (e) { threw3 = true; }
  ok("invalid quota configs are rejected", threw1 && threw2 && threw3);

  // ── serialization ──
  const sr = rig();
  sr.quota.sell("A", "q2");
  const sJSON = sr.quota.toJSON();
  const sr2 = rig();
  sr2.quota.fromJSON(sJSON);
  ok("quota round-trips identically", JSON.stringify(sr2.quota.toJSON()) === JSON.stringify(sJSON));
  ok("quota restore keeps occupancy and stays live",
    sr2.quota.occupant("q2") === "A" && !sr2.quota.isOpen("q2") && sr2.quota.sell("B", "q1").ok);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "quota", pass, fail, results };
}
