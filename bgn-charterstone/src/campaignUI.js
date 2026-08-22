// src/campaignUI.js — Phase 11 campaign & Chronicle screens (Tasks 55-56).
// createCampaignScreen renders the 12-game campaign map (win markers from
// gameResults, a highlighted "current" game, dimmed future games), the
// unlocked-components panel (constructed buildings, applied stickers, unlocked
// crates, revealed stories, active rule flags) and a setup checklist for the
// next game with a Start button. createChronicleBrowser renders the searchable
// in-app Chronicle: an active-rule-flags chip row (each flag links to the
// Chronicle entries that document it via CHRONICLE_FLAG_ENTRIES) plus the
// sections/entries filtered live by chronicle.search(). Both reuse the `.g-game`
// container-query class so they reflow with their host like the in-game table.

import { STICKER_DEFS } from "./stickers.js";
import { STORY_CARDS } from "./indexGuide.js";
import { CHRONICLE_FLAG_ENTRIES } from "./chronicle.js";

function el(tag, attrs = {}, text = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.setAttribute("class", v);
    else if (k === "hidden") e.hidden = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v);
  }
  if (text) e.textContent = text;
  return e;
}

function stickerNameForFlag(flag) {
  for (const def of Object.values(STICKER_DEFS)) {
    if (def.ruleFlag === flag) return def.name;
  }
  return flag;
}

function titleCase(flag) {
  return flag.replace(/([A-Z])/g, " $1").replace(/^./, ch => ch.toUpperCase());
}

// ── Task 55: campaign progress screen ──
export function createCampaignScreen(campaign, config = {}) {
  const container = config.container ?? document.body;
  container.classList.add("g-game", "g-campaign");
  const onStartGame = config.onStartGame ?? null;
  const gameNumber = campaign.gameNumber;
  const winnersByGame = {};
  for (const r of campaign.gameResults) winnersByGame[r.gameNumber] = r.winnerId;

  const screen = el("div", { class: "g-campaign", dataset: { campaign: "screen" } });
  screen.appendChild(el("div", { class: "gc-head" }, "Campaign Progress"));
  screen.appendChild(el("div", { class: "gc-sub" },
    "Game " + Math.min(gameNumber, 12) + " of 12" + (campaign.campaignComplete ? " · campaign complete" : "")));

  // ── the 12-node map ──
  const map = el("div", { class: "gc-map", dataset: { campaignMap: "true" } });
  for (let n = 1; n <= 12; n++) {
    const state = n < gameNumber ? "done" : n === gameNumber ? "current" : "future";
    const node = el("div", { class: "gc-node gc-node-" + state, dataset: { game: n, state } });
    node.appendChild(el("div", { class: "gc-node-num" }, String(n)));
    if (winnersByGame[n]) {
      const winner = campaign.players.find(p => p.id === winnersByGame[n]);
      node.appendChild(el("div", { class: "gc-node-win", dataset: { win: winnersByGame[n] } }, "🏆"));
      if (winner) node.title = "Won by " + winner.id;
    }
    if (state === "current") node.appendChild(el("div", { class: "gc-node-current-mark" }, "▶"));
    map.appendChild(node);
  }
  screen.appendChild(map);

  // ── unlocked components panel ──
  const components = el("div", { class: "gc-components" });
  components.appendChild(el("div", { class: "gc-panel-title" }, "Unlocked Components"));
  const compList = el("div", { class: "gc-comp-grid" });
  for (const b of campaign.constructedBuildings) {
    compList.appendChild(el("span", { class: "gc-chip gc-chip-building", dataset: { component: "building", id: b.buildingId } }, b.buildingId));
  }
  for (const id of campaign.stickers) {
    const def = STICKER_DEFS[id];
    compList.appendChild(el("span", { class: "gc-chip gc-chip-sticker", dataset: { component: "sticker", id } }, def ? def.name : id));
  }
  for (const c of campaign.crates) {
    compList.appendChild(el("span", { class: "gc-chip gc-chip-crate", dataset: { component: "crate", id: c.cardId } }, "Crate #" + c.crateNumber));
  }
  for (const id of campaign.storyUnlocks) {
    const story = STORY_CARDS[id];
    compList.appendChild(el("span", { class: "gc-chip gc-chip-story", dataset: { component: "story", id } }, story ? story.title : id));
  }
  const activeRules = [];
  for (const flag of Object.keys(CHRONICLE_FLAG_ENTRIES)) {
    if (campaign.stickers.some(sid => STICKER_DEFS[sid] && STICKER_DEFS[sid].ruleFlag === flag)) activeRules.push(flag);
  }
  for (const flag of activeRules) {
    compList.appendChild(el("span", { class: "gc-chip gc-chip-rule", dataset: { component: "rule", id: flag } }, stickerNameForFlag(flag)));
  }
  if (compList.childNodes.length === 0) compList.appendChild(el("span", { class: "gc-hint" }, "Nothing unlocked yet."));
  components.appendChild(compList);
  screen.appendChild(components);

  // ── next-game setup checklist ──
  const checklist = el("div", { class: "gc-checklist" });
  checklist.appendChild(el("div", { class: "gc-panel-title" }, "Setup Checklist — Game " + gameNumber));
  const ul = el("ul", { class: "gc-list" });
  const row = (name, value) => {
    const li = el("li", { dataset: { setup: name } });
    li.appendChild(el("span", { class: "gc-setup-name" }, name + ": "));
    li.appendChild(el("span", { class: "gc-setup-value" }, value));
    ul.appendChild(li);
  };
  row("buildings", campaign.constructedBuildings.length > 0
    ? campaign.constructedBuildings.map(b => b.buildingId + "@" + b.q + "," + b.r + "(" + b.ownerId + ")").join(", ")
    : "none");
  row("stickers", campaign.stickers.length > 0 ? campaign.stickers.map(id => STICKER_DEFS[id] ? STICKER_DEFS[id].name : id).join(", ") : "none");
  row("crates", campaign.crates.length > 0 ? campaign.crates.map(c => "#" + c.crateNumber + " on " + c.cardId).join(", ") : "none");
  row("archive", campaign.archive.length > 0 ? campaign.archive.join(", ") : "none");
  row("stories", campaign.storyUnlocks.length > 0 ? campaign.storyUnlocks.map(id => STORY_CARDS[id] ? STORY_CARDS[id].title : id).join(", ") : "none");
  row("players", campaign.players.map(p => p.id + " (capacity " + p.capacity + (p.grantedCard ? ", card " + p.grantedCard : "") + ")").join(", "));
  row("rules", activeRules.length > 0 ? activeRules.map(titleCase).join(", ") : "starting rules");
  checklist.appendChild(ul);
  if (!campaign.campaignComplete) {
    const startBtn = el("button", { class: "g-btn g-btn-primary gc-start", dataset: { action: "start-game" } }, "Start Game " + gameNumber);
    startBtn.addEventListener("click", () => {
      if (typeof onStartGame === "function") onStartGame(gameNumber);
    });
    checklist.appendChild(startBtn);
  } else {
    checklist.appendChild(el("div", { class: "gc-hint" }, "The campaign is complete — score it to crown the winner."));
  }
  screen.appendChild(checklist);

  container.appendChild(screen);
  return { campaign, container, screen };
}

// ── Task 56: the in-app Chronicle browser ──
export function createChronicleBrowser(chronicle, config = {}) {
  const container = config.container ?? document.body;
  container.classList.add("g-game", "g-chronicle");

  const browser = el("div", { class: "g-chronicle", dataset: { chronicle: "browser" } });
  browser.appendChild(el("div", { class: "gc-head" }, "The Chronicle"));
  const search = el("input", {
    id: "chronicleSearch",
    class: "gc-search",
    placeholder: "Search the Chronicle…",
    dataset: { search: "input" },
  });
  search.setAttribute("aria-label", "Search the Chronicle");
  browser.appendChild(search);

  // ── active rule flags ──
  const flagsRow = el("div", { class: "gc-flags" });
  let hasActiveFlags = false;
  for (const flag of Object.keys(CHRONICLE_FLAG_ENTRIES)) {
    if (!chronicle.flag(flag)) continue;
    hasActiveFlags = true;
    const entries = CHRONICLE_FLAG_ENTRIES[flag];
    const chip = el("span", {
      class: "gc-chip gc-chip-rule",
      dataset: { flag, entries: entries.join(",") },
      title: "Active rule: documented in " + entries.join(", "),
    }, "● " + stickerNameForFlag(flag));
    flagsRow.appendChild(chip);
  }
  if (!hasActiveFlags) flagsRow.appendChild(el("span", { class: "gc-hint" }, "No rule stickers applied yet."));
  flagsRow.dataset.flagsRow = "true";
  browser.appendChild(flagsRow);

  // ── sections / entries ──
  const entriesBox = el("div", { class: "gc-entries", dataset: { entries: "box" } });
  browser.appendChild(entriesBox);

  function renderEntries() {
    entriesBox.innerHTML = "";
    const q = search.value.trim();
    const hits = q ? new Set(chronicle.search(q).map(h => h.entryId)) : null;
    const sections = chronicle.sections();
    for (const s of sections) {
      const visible = s.entries.filter(e => hits ? hits.has(e.id) : true);
      if (hits && visible.length === 0) continue;
      const secEl = el("div", { class: "gc-section", dataset: { section: s.id } });
      secEl.appendChild(el("div", { class: "gc-section-title" }, s.title));
      for (const e of visible) {
        const full = chronicle.entry(e.id) ?? e;
        const entryEl = el("div", { class: "gc-entry", dataset: { entry: e.id } });
        entryEl.appendChild(el("div", { class: "gc-entry-title" }, e.title));
        const mechRow = el("div", { class: "gc-entry-mechanics" });
        for (const m of e.mechanics) {
          mechRow.appendChild(el("span", { class: "gc-chip gc-chip-mech", dataset: { mechanic: m } }, m));
        }
        entryEl.appendChild(mechRow);
        entryEl.appendChild(el("div", { class: "gc-entry-text" }, full.text ?? ""));
        secEl.appendChild(entryEl);
      }
      entriesBox.appendChild(secEl);
    }
    if (hits && entriesBox.childNodes.length === 0) {
      entriesBox.appendChild(el("div", { class: "gc-hint" }, "No Chronicle entries match \"" + q + "\"."));
    }
  }

  search.addEventListener("input", renderEntries);
  renderEntries();

  container.appendChild(browser);
  return { chronicle, container, browser, search, entriesBox };
}
