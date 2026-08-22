// src/campaignSummary.js — Phase 17 campaign summary (Task 79).
// A retrospective screen: per player wins, glory, capacity, personas used,
// buildings built (+ VP), crates unlocked — derived ONLY from the campaign
// state history (gameResults, player records, constructedBuildings, crates)
// — plus a shareable/exportable text/JSON view.

export const CAMPAIGN_SUMMARY_VERSION = 1;

export function buildCampaignSummary(campaign, opts = {}) {
  const buildingTiles = opts.buildingTiles ?? null;
  const players = campaign.players.map(p => {
    const wins = campaign.gameResults.filter(r => r.winnerId === p.id).length;
    const buildings = campaign.constructedBuildings.filter(b => b.ownerId === p.id);
    const buildingVp = buildings.reduce((sum, b) =>
      sum + (buildingTiles && buildingTiles[b.buildingId] ? (buildingTiles[b.buildingId].vp ?? 0) : 0), 0);
    const crates = campaign.crates.filter(c => c.playerId === p.id);
    return {
      playerId: p.id,
      charterId: p.charterId,
      color: p.color,
      wins,
      glory: p.glory,
      capacity: p.capacity,
      personasUsed: p.usedPersonas.length,
      buildingsBuilt: buildings.length,
      buildingVp,
      cratesUnlocked: crates.length,
      crateNumbers: crates.map(c => c.crateNumber).sort((a, b) => a - b),
      buildingIds: buildings.map(b => b.buildingId).sort(),
    };
  });
  players.sort((a, b) =>
    b.wins - a.wins || b.glory - a.glory || b.buildingsBuilt - a.buildingsBuilt || a.playerId.localeCompare(b.playerId));
  return {
    version: CAMPAIGN_SUMMARY_VERSION,
    campaignId: campaign.id,
    gameNumber: campaign.gameNumber,
    campaignComplete: campaign.campaignComplete,
    totals: {
      gamesPlayed: campaign.gameResults.length,
      stickers: campaign.stickers.length,
      constructedBuildings: campaign.constructedBuildings.length,
      crates: campaign.crates.length,
      storyUnlocks: campaign.storyUnlocks.length,
    },
    players,
  };
}

export function campaignSummaryText(summary) {
  const lines = [];
  lines.push("Charterstone campaign summary — " + summary.campaignId);
  lines.push("Games played: " + summary.totals.gamesPlayed + (summary.campaignComplete ? " (complete)" : "") + " · buildings: " + summary.totals.constructedBuildings + " · crates: " + summary.totals.crates + " · stickers: " + summary.totals.stickers);
  for (const p of summary.players) {
    lines.push(p.playerId + ": " + p.wins + " win" + (p.wins === 1 ? "" : "s") + " · " + p.glory + " glory · " + p.capacity + " capacity · " + p.personasUsed + " persona" + (p.personasUsed === 1 ? "" : "s") + " · " + p.buildingsBuilt + " buildings (" + p.buildingVp + " VP) · " + p.cratesUnlocked + " crates");
  }
  return lines.join("\n");
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement("style");
  s.id = "cs-summary-styles";
  s.textContent =
    ".cs-summary{position:fixed;inset:0;z-index:9700;display:flex;align-items:center;justify-content:center;background:rgba(10,9,18,.78);backdrop-filter:blur(3px)}" +
    ".cs-sum-card{width:min(680px,92vw);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#1d1830,#141120);border:1px solid rgba(212,175,55,.55);border-radius:16px;padding:26px;box-shadow:0 24px 80px rgba(0,0,0,.6)}" +
    ".cs-sum-head{color:#f6e6a4;margin:0 0 4px;font-size:1.4rem}" +
    ".cs-sum-sub{color:#a49bb4;margin:0 0 16px;font-size:.85rem}" +
    ".cs-sum-row{display:flex;gap:10px;align-items:center;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.08)}" +
    ".cs-sum-row .sum-nm{font-weight:700;min-width:120px}" +
    ".cs-sum-row .sum-st{color:#e7e1d2;font-size:.88rem;flex:1}" +
    ".cs-sum-row .sum-tot{color:#d4af37;font-weight:700}" +
    ".cs-sum-tot{border-top:1px solid rgba(212,175,55,.4);padding:12px 8px;color:#a49bb4;font-size:.85rem}" +
    ".cs-sum-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}" +
    ".cs-sum-x{position:absolute;top:18px;right:22px;background:none;border:none;color:#e7e1d2;font-size:1.4rem;cursor:pointer}";
  document.head.appendChild(s);
}

export function createCampaignSummaryScreen({ campaign, container = document.body, buildingTiles = null, onClose } = {}) {
  injectStyles();
  const summary = buildCampaignSummary(campaign, { buildingTiles });
  const overlay = document.createElement("div");
  overlay.className = "cs-summary";
  const card = document.createElement("div");
  card.className = "cs-sum-card";
  overlay.appendChild(card);

  const close = document.createElement("button");
  close.className = "cs-sum-x";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close the campaign summary");
  close.addEventListener("click", () => { overlay.remove(); if (onClose) onClose(); });
  card.appendChild(close);

  const head = document.createElement("h3");
  head.className = "cs-sum-head";
  head.textContent = "Campaign Summary";
  card.appendChild(head);
  const sub = document.createElement("p");
  sub.className = "cs-sum-sub";
  sub.textContent = summary.campaignId + " · games played: " + summary.totals.gamesPlayed + (summary.campaignComplete ? " · campaign complete" : "");
  card.appendChild(sub);

  for (const p of summary.players) {
    const row = document.createElement("div");
    row.className = "cs-sum-row";
    row.dataset.player = p.playerId;
    row.innerHTML =
      '<span class="sum-nm">' + p.playerId + "</span>" +
      '<span class="sum-st">' + p.wins + " wins · " + p.glory + " glory · " + p.capacity + " capacity · " + p.personasUsed + " personas · " + p.buildingsBuilt + " buildings · " + p.cratesUnlocked + " crates</span>" +
      '<span class="sum-tot">' + p.buildingVp + " bldg VP</span>";
    card.appendChild(row);
  }
  const tot = document.createElement("div");
  tot.className = "cs-sum-tot";
  tot.dataset.totals = JSON.stringify(summary.totals);
  tot.textContent = "Total: " + summary.totals.constructedBuildings + " buildings · " + summary.totals.crates + " crates · " + summary.totals.stickers + " stickers applied";
  card.appendChild(tot);

  const actions = document.createElement("div");
  actions.className = "cs-sum-actions";
  const copy = document.createElement("button");
  copy.className = "btn btn-ghost";
  copy.type = "button";
  copy.textContent = "Copy summary";
  copy.addEventListener("click", () => {
    const text = campaignSummaryText(summary);
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    copy.textContent = "Copied ✓";
    setTimeout(() => { copy.textContent = "Copy summary"; }, 1500);
  });
  actions.appendChild(copy);
  const exportJson = document.createElement("button");
  exportJson.className = "btn btn-gold";
  exportJson.type = "button";
  exportJson.textContent = "Export JSON";
  exportJson.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "charterstone-summary-" + summary.campaignId + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  actions.appendChild(exportJson);
  card.appendChild(actions);

  container.appendChild(overlay);
  return { summary, overlay, close: () => overlay.remove() };
}
