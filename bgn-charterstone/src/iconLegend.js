// src/iconLegend.js — Phase 15 icon legend (Task 71).
// A single source of truth for every icon the game renders: resources,
// influence, VP, quota, reputation, income, crate, objective, campaign
// (plus workers/bump/progress). The legend powers tooltips and a legend
// modal, and the game UI's tooltips resolve back to these entries — so
// the guide, the Chronicle and the board never disagree about an icon.

import { RESOURCE_TYPES } from "./economy.js";
import { RESOURCE_ICONS } from "./gameUI.js";

export const ICON_LEGEND_VERSION = 1;

const RESOURCE_NAMES = {
  coins: "Coin", metal: "Metal", coal: "Coal", pumpkin: "Pumpkin",
  grain: "Grain", clay: "Clay", wood: "Wood",
};
const RESOURCE_DESCS = {
  coins: "The game's currency — pay building costs and unlock crates with it.",
  metal: "A basic resource gathered in The Commons and spent on construction.",
  coal: "A basic resource gathered in The Commons and spent on construction.",
  pumpkin: "A basic resource gathered in The Commons and spent on construction.",
  grain: "A basic resource gathered in The Commons and spent on construction.",
  clay: "A basic resource gathered in The Commons and spent on construction.",
  wood: "A basic resource gathered in The Commons and spent on construction.",
};

export const ICON_LEGEND = Object.freeze({
  coins: { id: "coins", icon: RESOURCE_ICONS.coins, name: "Coin", desc: "The game's currency — pay building costs and unlock crates with it." },
  ...Object.fromEntries(RESOURCE_TYPES.map(r => [
    r,
    { id: r, icon: RESOURCE_ICONS[r], name: RESOURCE_NAMES[r], desc: RESOURCE_DESCS[r] },
  ])),
  influence: { id: "influence", icon: "✦", name: "Influence", desc: "12 tokens per player each game — spend them to construct, score objectives and fill quota spaces; place them on reputation and objective cards." },
  vp: { id: "vp", icon: "⭐", name: "Victory Points", desc: "End-of-game score — reputation, objectives, buildings and crates all grant VP; the most VP wins the game." },
  quota: { id: "quota", icon: "🧺", name: "Quota", desc: "Sell a commodity at the Cloud Port on an open quota space for +3 VP and an optional bonus." },
  reputation: { id: "reputation", icon: "🗨️", name: "Reputation", desc: "Place 1 influence token per step; the highest reputation counts score 10/7/4 VP at game end (ties share)." },
  income: { id: "income", icon: "💰", name: "Income", desc: "Progress spaces marked with income grant every player 1 coin when the token reaches them." },
  crate: { id: "crate", icon: "📦", name: "Crate", desc: "Unlock via the Charterstone building to extract the components listed in the Index Guide." },
  objective: { id: "objective", icon: "🎯", name: "Objective", desc: "Revealed objective cards are completed during play; each player scores +5 VP once by placing 1 influence token at the Grandstand." },
  campaign: { id: "campaign", icon: "🌱", name: "Campaign", desc: "Twelve games tell one story: buildings, stickers, crates and stories persist into each next game." },
  worker: { id: "worker", icon: "🧍", name: "Worker", desc: "Place one worker from your personal supply onto a building on your turn; retrieve to bring them home." },
  bump: { id: "bump", icon: "↩️", name: "Bump", desc: "Placing on an occupied building returns the worker who was there to its owner." },
  progress: { id: "progress", icon: "🪜", name: "Progress", desc: "The game timer — advances per construction, crate unlock, objective score and forced 0-influence advance; the final space ends the game." },
});

export function legendFor(id) {
  return ICON_LEGEND[id] ?? null;
}

// The tooltip a rendered icon chip exposes; it must round-trip back to a
// legend entry (the test drives this contract).
export function tooltipFor(id) {
  const e = legendFor(id);
  return e ? e.name + " — " + e.desc : null;
}

export function legendIds() {
  return Object.keys(ICON_LEGEND);
}

// Render a row of icon chips; each chip carries the legend tooltip and a
// data-legend id so tests can resolve every rendered tooltip.
export function renderLegendChips(container, ids = legendIds()) {
  for (const id of ids) {
    const e = legendFor(id);
    if (!e) continue;
    const chip = document.createElement("span");
    chip.className = "cs-legend-chip";
    chip.dataset.legend = id;
    chip.title = tooltipFor(id);
    chip.setAttribute("role", "img");
    chip.setAttribute("aria-label", e.name);
    chip.textContent = e.icon + " " + e.name;
    container.appendChild(chip);
  }
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement("style");
  s.id = "cs-legend-styles";
  s.textContent =
    ".cs-legend{position:fixed;inset:0;z-index:9400;display:flex;align-items:center;justify-content:center;background:rgba(10,9,18,.72);backdrop-filter:blur(3px)}" +
    ".cs-legend-card{width:min(620px,92vw);max-height:86vh;overflow:auto;background:#171422;border:1px solid rgba(212,175,55,.45);border-radius:14px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.5)}" +
    ".cs-legend-row{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)}" +
    ".cs-legend-row .lg-ic{font-size:1.3rem;width:34px;text-align:center;flex:none}" +
    ".cs-legend-row .lg-nm{font-weight:600;color:#f6e6a4}" +
    ".cs-legend-row .lg-ds{color:#c9c2b2;font-size:.86rem;line-height:1.45}" +
    ".cs-legend-chip{display:inline-flex;align-items:center;gap:6px;background:#221e31;border:1px solid #55506e;border-radius:999px;padding:4px 12px;font-size:.82rem;color:#e7e1d2;margin:3px}" +
    ".cs-legend-x{position:absolute;top:18px;right:22px;background:none;border:none;color:#e7e1d2;font-size:1.4rem;cursor:pointer}";
  document.head.appendChild(s);
}

export function createIconLegendModal({ container = document.body, ids = legendIds(), onClose } = {}) {
  injectStyles();
  const overlay = document.createElement("div");
  overlay.className = "cs-legend";
  const card = document.createElement("div");
  card.className = "cs-legend-card";
  overlay.appendChild(card);
  const close = document.createElement("button");
  close.className = "cs-legend-x";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close the icon legend");
  close.addEventListener("click", () => { overlay.remove(); if (onClose) onClose(); });
  card.appendChild(close);
  const title = document.createElement("h3");
  title.textContent = "Icon Legend";
  title.style.margin = "0 0 12px";
  title.style.color = "#f6e6a4";
  card.appendChild(title);
  for (const id of ids) {
    const e = legendFor(id);
    if (!e) continue;
    const row = document.createElement("div");
    row.className = "cs-legend-row";
    row.dataset.legend = id;
    row.innerHTML = '<span class="lg-ic">' + e.icon + '</span><span><span class="lg-nm">' + e.name + '</span> — <span class="lg-ds">' + e.desc + "</span></span>";
    card.appendChild(row);
  }
  container.appendChild(overlay);
  return { overlay, close: () => overlay.remove() };
}
