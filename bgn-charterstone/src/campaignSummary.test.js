// src/campaignSummary.test.js — Phase 17 campaign summary validation (Task 79).
// Run in-page via ?test=campaignsummary, or via window.__loadCampaignSummaryTests().
// Task 79: a retrospective screen (wins, glory, buildings built, crates
// unlocked per player) with a shareable/exportable view. The summary data
// must match the campaign state history exactly.

import { createCampaignState, finishGame, playerRecord } from "./campaignState.js";
import { DEFAULT_BUILDING_TILES } from "./buildingTiles.js";
import {
  CAMPAIGN_SUMMARY_VERSION, buildCampaignSummary, campaignSummaryText, createCampaignSummaryScreen,
} from "./campaignSummary.js";

function buildCampaign() {
  const campaign = createCampaignState({ players: [{ id: "p1", charterId: 0 }, { id: "p2", charterId: 1 }, { id: "p3", charterId: 2 }] });
  finishGame(campaign, {
    winnerId: "p1",
    legacy: {
      constructedBuildings: [{ buildingId: "bldg-mine", ownerId: "p1", q: 2, r: 0 }, { buildingId: "bldg-mill", ownerId: "p1", q: -2, r: 0 }],
      stickers: ["sticker-a", "sticker-b"],
    },
    usedPersonas: { p1: ["persona-1"] },
  });
  finishGame(campaign, {
    winnerId: "p2",
    legacy: {
      constructedBuildings: [{ buildingId: "bldg-quarry", ownerId: "p2", q: 0, r: 2 }],
      crates: [{ playerId: "p2", cardId: "cbldg-quarry", crateNumber: 2 }],
      stickers: ["sticker-c"],
    },
    usedPersonas: { p2: ["persona-2", "persona-3"] },
  });
  finishGame(campaign, {
    winnerId: "p1",
    legacy: {
      crates: [{ playerId: "p1", cardId: "cbldg-mine", crateNumber: 1 }],
    },
  });
  return campaign;
}

export function runCampaignSummaryTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const campaign = buildCampaign();
  const summary = buildCampaignSummary(campaign, { buildingTiles: DEFAULT_BUILDING_TILES });

  ok("summary exposes version + a row per player", CAMPAIGN_SUMMARY_VERSION === 1 && summary.players.length === 3);

  // ── summary matches the campaign state history exactly ──
  for (const row of summary.players) {
    const rec = playerRecord(campaign, row.playerId);
    const wins = campaign.gameResults.filter(r => r.winnerId === row.playerId).length;
    const buildings = campaign.constructedBuildings.filter(b => b.ownerId === row.playerId);
    const crates = campaign.crates.filter(c => c.playerId === row.playerId);
    const vp = buildings.reduce((s, b) => s + (DEFAULT_BUILDING_TILES[b.buildingId]?.vp ?? 0), 0);
    ok("player " + row.playerId + " wins match history", row.wins === wins && wins === rec.wins);
    ok("player " + row.playerId + " glory matches the record", row.glory === rec.glory);
    ok("player " + row.playerId + " buildings built match history", row.buildingsBuilt === buildings.length);
    ok("player " + row.playerId + " building VP matches printed tile VP", row.buildingVp === vp);
    ok("player " + row.playerId + " crates unlocked match history", row.cratesUnlocked === crates.length);
    ok("player " + row.playerId + " personas used match the record", row.personasUsed === rec.usedPersonas.length);
    ok("player " + row.playerId + " capacity matches the record", row.capacity === rec.capacity);
  }
  const p1 = summary.players.find(p => p.playerId === "p1");
  const p2 = summary.players.find(p => p.playerId === "p2");
  ok("p1 won two games", p1.wins === 2);
  ok("p2 unlocked crate 2", p2.crateNumbers.includes(2) && p2.cratesUnlocked === 1);
  ok("p1 built two buildings and unlocked crate 1", p1.buildingsBuilt === 2 && p1.crateNumbers.includes(1));
  ok("summary totals match the campaign state",
    summary.totals.gamesPlayed === campaign.gameResults.length &&
    summary.totals.stickers === campaign.stickers.length &&
    summary.totals.constructedBuildings === campaign.constructedBuildings.length &&
    summary.totals.crates === campaign.crates.length);

  // ── shareable / exportable view ──
  const text = campaignSummaryText(summary);
  ok("the summary exports as readable text", text.indexOf("p1: 2 wins") !== -1 && text.indexOf("p2: 1 win") !== -1);
  const json = JSON.parse(JSON.stringify(summary));
  ok("the summary round-trips through JSON", json.players.length === summary.players.length && json.totals.crates === summary.totals.crates);

  // ── screen renders the retrospective with the export actions ──
  const div = document.createElement("div");
  div.id = "campaignSummaryTestHost";
  document.body.appendChild(div);
  const screen = createCampaignSummaryScreen({ campaign, container: div, buildingTiles: DEFAULT_BUILDING_TILES });
  ok("summary screen renders a row per player", div.querySelectorAll(".cs-sum-row").length === 3);
  const p1Row = div.querySelector('.cs-sum-row[data-player="p1"]');
  ok("the screen's p1 row lists wins, glory, buildings and crates",
    p1Row.textContent.indexOf("2 wins") !== -1 && p1Row.textContent.indexOf(p1.glory + " glory") !== -1 &&
    p1Row.textContent.indexOf("2 buildings") !== -1 && p1Row.textContent.indexOf("1 crates") !== -1);
  ok("the screen lists building VP per player", p1Row.textContent.indexOf(p1.buildingVp + " bldg VP") !== -1);
  const totalsEl = div.querySelector(".cs-sum-tot");
  ok("the screen shows the totals from history", totalsEl && totalsEl.dataset.totals && JSON.parse(totalsEl.dataset.totals).crates === campaign.crates.length);
  ok("the screen offers copy + JSON export",
    [...div.querySelectorAll(".cs-sum-actions button")].map(b => b.textContent).join(",") === "Copy summary,Export JSON");
  screen.close();
  ok("summary screen closes cleanly", !div.querySelector(".cs-summary"));
  div.remove();

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "campaignsummary", pass, fail, results };
}
