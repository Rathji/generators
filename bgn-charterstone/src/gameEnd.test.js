// src/gameEnd.test.js — Phase 16 end-of-game polish validation (Task 75).
// Run in-page via ?test=gameend, or via window.__loadGameEndTests().
// Task 75: winner animation and a score-breakdown modal that lists each
// scoring source's VP per player.

import { scoreEndGame } from "./scoring.js";
import { createGameState } from "./serialization.js";
import { STARTING_SETUP } from "./indexGuide.js";
import { scoreBreakdown, createEndGameModal, GAME_END_VERSION } from "./gameEnd.js";

function buildState() {
  const players = [0, 1, 2].map(i => ({ id: "P" + (i + 1), charterId: i, startingCoins: 4 }));
  const g = createGameState({ players, firstPlayer: "P1", rng: Math.random });
  // give P1 some scored sources so every row is non-trivial
  g.player("P1").addVp(5);
  g.reputation.place("P1");
  g.reputation.place("P1");
  g.reputation.place("P1");
  g.reputation.place("P1");
  return g;
}

export function runGameEndTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const g = buildState();
  const standings = scoreEndGame(g);
  ok("gameEnd exposes version + scoreBreakdown", GAME_END_VERSION === 1 && typeof scoreBreakdown === "function");
  ok("standings list one row per player with all four sources",
    standings.length === 3 && standings.every(r =>
      typeof r.reputationVp === "number" && typeof r.objectiveVp === "number" &&
      typeof r.buildingVp === "number" && typeof r.crateVp === "number" && typeof r.total === "number"));

  const breakdown = scoreBreakdown(g, standings);
  ok("scoreBreakdown mirrors the standings' sources",
    breakdown.every((b, i) =>
      b.sources.reputation === standings[i].reputationVp &&
      b.sources.objective === standings[i].objectiveVp &&
      b.sources.building === standings[i].buildingVp &&
      b.sources.crate === standings[i].crateVp &&
      b.total === standings[i].total && b.rank === standings[i].rank));

  // ── modal lists each scoring source's VP ──
  const div = document.createElement("div");
  div.id = "gameEndTestHost";
  document.body.appendChild(div);
  const modal = createEndGameModal({ container: div, standings, winnerIds: standings.filter(s => s.rank === 1).map(s => s.playerId) });
  const table = div.querySelector(".cs-end-tbl");
  ok("modal renders the score table", !!table);
  const rows = table.querySelectorAll("tbody tr");
  ok("the table lists every player", rows.length === standings.length);
  ok("the table lists each scoring source's VP per player",
    [...rows].every((tr, i) => {
      const tds = tr.querySelectorAll("td");
      const cells = [tds[1].textContent, tds[2].textContent, tds[3].textContent, tds[4].textContent];
      return cells[0] === standings[i].reputationVp + " VP" &&
        cells[1] === standings[i].objectiveVp + " VP" &&
        cells[2] === standings[i].buildingVp + " VP" &&
        cells[3] === standings[i].crateVp + " VP";
    }));
  const totals = [...rows].map(tr => parseInt(tr.querySelector("td:last-child b").textContent, 10));
  ok("table totals match the standings", totals.every((t, i) => t === standings[i].total));
  const winnerRow = table.querySelector("tbody tr.win");
  ok("the winner row is highlighted", !!winnerRow && winnerRow.textContent.indexOf(standings[0].playerId) !== -1);
  ok("the winner banner crowns the winner", modal.winners.length === 1 && modal.winners[0] === standings[0].playerId &&
    div.querySelector(".cs-end-win").textContent.indexOf("wins") !== -1);
  const winEl = div.querySelector(".cs-end-win");
  ok("the winner banner carries the animation class", winEl.className.indexOf("animate") !== -1);
  modal.close();
  ok("modal closes cleanly", !div.querySelector(".cs-endgame"));
  div.remove();

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "gameend", pass, fail, results };
}
