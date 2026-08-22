// src/campaignUI.test.js — Phase 11 campaign & Chronicle screens validation (Tasks 55-56).
// Run in-page via ?test=campaignui, or programmatically via window.__loadCampaignUITests().
// Task 55: the campaign progress screen renders a 12-game map with win markers,
// the unlocked components, and the next-game setup checklist — finishing game 3
// updates the map and renders game 4's checklist. Task 56: the in-app Chronicle
// reflects the active ruleset (every active rule flag has a searchable entry).

import { createCampaignScreen, createChronicleBrowser } from "./campaignUI.js";
import { createCampaignState, finishGame } from "./campaignState.js";
import { createChronicle, CHRONICLE_FLAG_ENTRIES } from "./chronicle.js";

export function runCampaignUITests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });
  const hosts = [];
  function mountHost() {
    const host = document.createElement("div");
    host.id = "campaignUITestHost";
    document.body.appendChild(host);
    hosts.push(host);
    return host;
  }

  // ── Task 55: the campaign progress screen ──
  const camp = createCampaignState({ players: [{ id: "P1" }, { id: "P2" }] });
  finishGame(camp, {
    winnerId: "P1",
    legacy: {
      constructedBuildings: [{ buildingId: "mine", ownerId: "P1", q: 0, r: 0 }],
      stickers: ["rule-income"],
      crates: [{ playerId: "P1", cardId: "cbldg-1", crateNumber: 1 }],
      archive: ["bldg-mine"],
    },
    revealedStories: ["story-2"],
    playerCapacities: { P1: 1, P2: 0 },
  });
  finishGame(camp, {
    winnerId: "P2",
    legacy: {
      constructedBuildings: [{ buildingId: "mill", ownerId: "P2", q: 0, r: 1 }],
      crates: [{ playerId: "P2", cardId: "cbldg-mine", crateNumber: 1 }],
      archive: [],
    },
    revealedStories: ["story-3"],
    playerCapacities: { P1: 1, P2: 1 },
  });
  finishGame(camp, {
    winnerId: "P1",
    legacy: { stickers: ["rule-drop-players"], archive: ["cbldg-1"] },
    revealedStories: ["story-4"],
    playerCapacities: { P1: 2, P2: 1 },
  });
  ok("three finished games leave the campaign at game 4", camp.gameNumber === 4 && camp.gameResults.length === 3);

  let startedWith = null;
  const host = mountHost();
  createCampaignScreen(camp, { container: host, onStartGame: n => { startedWith = n; } });
  ok("the map renders all 12 games", host.querySelectorAll(".gc-node").length === 12);
  ok("the first three games are marked done and game 4 is current",
    host.querySelectorAll('.gc-node[data-state="done"]').length === 3 &&
    host.querySelector('.gc-node[data-game="4"]').dataset.state === "current" &&
    host.querySelectorAll('.gc-node[data-state="future"]').length === 8);
  ok("win markers appear on finished games", 
    host.querySelector('.gc-node[data-game="1"] .gc-node-win')?.dataset.win === "P1" &&
    host.querySelector('.gc-node[data-game="2"] .gc-node-win')?.dataset.win === "P2" &&
    host.querySelector('.gc-node[data-game="3"] .gc-node-win')?.dataset.win === "P1" &&
    !host.querySelector('.gc-node[data-game="4"] .gc-node-win'));
  ok("the components panel accumulates buildings, stickers, crates and stories",
    host.querySelectorAll('.gc-chip[data-component="building"]').length === 2 &&
    host.querySelectorAll('.gc-chip[data-component="sticker"]').length === 2 &&
    host.querySelectorAll('.gc-chip[data-component="crate"]').length === 2 &&
    host.querySelectorAll('.gc-chip[data-component="story"]').length === 3);
  ok("active rule stickers appear as rule chips", 
    host.querySelector('.gc-chip[data-component="rule"][data-id="incomeEnabled"]') !== null &&
    host.querySelector('.gc-chip[data-component="rule"][data-id="dropPlayers"]') !== null);
  for (const name of ["buildings", "stickers", "crates", "archive", "stories", "players", "rules"]) {
    ok("the setup checklist carries a '" + name + "' item", host.querySelector('[data-setup="' + name + '"]') !== null);
  }
  ok("the checklist lists the carried buildings with positions",
    (host.querySelector('[data-setup="buildings"] .gc-setup-value')?.textContent ?? "").includes("mine@0,0"));
  ok("the checklist lists the applied rule stickers", 
    (host.querySelector('[data-setup="rules"] .gc-setup-value')?.textContent ?? "").includes("Income Enabled"));
  const startBtn = host.querySelector('.gc-start[data-action="start-game"]');
  ok("a Start button starts the next game", !!startBtn && startBtn.textContent.includes("4"));
  startBtn.click();
  ok("clicking Start invokes the callback with the next game number", startedWith === 4);

  // ── Task 56: the in-app Chronicle browser ──
  const chronicle = createChronicle({
    flags: { incomeEnabled: true, dropPlayers: true, campaignEnd: true },
  });
  const host2 = mountHost();
  const browser = createChronicleBrowser(chronicle, { container: host2 });
  ok("the Chronicle browser renders a search field", !!host2.querySelector("#chronicleSearch"));
  const flagChips = host2.querySelectorAll(".gc-chip[data-flag]");
  ok("every active rule flag renders a chip linked to its Chronicle entries",
    flagChips.length === 3 &&
    host2.querySelector('.gc-chip[data-flag="incomeEnabled"]')?.dataset.entries === "tracks-progress" &&
    host2.querySelector('.gc-chip[data-flag="dropPlayers"]')?.dataset.entries === "players-add-drop" &&
    host2.querySelector('.gc-chip[data-flag="campaignEnd"]')?.dataset.entries === "campaign-end");
  ok("inactive flags render no chips", host2.querySelector('.gc-chip[data-flag="guideposts"]') === null);
  let allLinked = true;
  let searchable = true;
  for (const flag of Object.keys(CHRONICLE_FLAG_ENTRIES)) {
    if (!chronicle.flag(flag)) continue;
    for (const entryId of CHRONICLE_FLAG_ENTRIES[flag]) {
      const entry = chronicle.entry(entryId);
      if (!entry) allLinked = false;
      if (chronicle.search(entry.title).length === 0) searchable = false;
      if (!host2.querySelector('.gc-entry[data-entry="' + entryId + '"]')) allLinked = false;
    }
  }
  ok("every active flag's mapped entry renders with its text", allLinked);
  ok("every active rule flag has a searchable entry", searchable);
  ok("an entry shows its mechanics terms as chips",
    host2.querySelector('.gc-entry[data-entry="players-add-drop"] .gc-chip-mech[data-mechanic="add-player"]') !== null);
  const searchEl = host2.querySelector("#chronicleSearch");
  searchEl.value = "Adding and dropping players";
  searchEl.dispatchEvent(new Event("input"));
  ok("searching filters the Chronicle to matching entries",
    host2.querySelectorAll(".gc-entry").length === 1 &&
    host2.querySelector('.gc-entry[data-entry="players-add-drop"]') !== null &&
    (host2.querySelector('.gc-entry[data-entry="players-add-drop"] .gc-entry-text')?.textContent ?? "").includes("inactive charter"));
  searchEl.value = "";
  searchEl.dispatchEvent(new Event("input"));
  ok("clearing the search restores the full Chronicle", host2.querySelectorAll(".gc-section").length >= 4);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "campaignUI", pass, fail, results };
}
