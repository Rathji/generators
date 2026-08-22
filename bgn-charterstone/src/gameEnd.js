// src/gameEnd.js — Phase 16 end-of-game polish (Task 75).
// Winner animation + a score-breakdown modal. The modal lists each scoring
// source's VP (reputation, objective, building, crate) per player, exactly
// as scoreEndGame computed them, and crowns the winner(s). The animation
// respects prefers-reduced-motion (Task 76).

import { scoreEndGame } from "./scoring.js";

export const GAME_END_VERSION = 1;

export function scoreBreakdown(state, standings = null) {
  const rows = standings ?? scoreEndGame(state);
  return rows.map(r => ({
    playerId: r.playerId,
    rank: r.rank,
    total: r.total,
    sources: {
      reputation: r.reputationVp,
      objective: r.objectiveVp,
      building: r.buildingVp,
      crate: r.crateVp,
    },
  }));
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const s = document.createElement("style");
  s.id = "cs-endgame-styles";
  s.textContent =
    ".cs-endgame{position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;background:rgba(10,9,18,.78);backdrop-filter:blur(3px)}" +
    ".cs-end-card{width:min(620px,92vw);max-height:86vh;overflow:auto;background:linear-gradient(180deg,#1d1830,#141120);border:1px solid rgba(212,175,55,.55);border-radius:16px;padding:26px;box-shadow:0 24px 80px rgba(0,0,0,.6);text-align:center}" +
    ".cs-end-win{font-size:2rem;color:#f6e6a4;margin:0 0 6px}" +
    ".cs-end-win.animate{" + (reduced ? "" : "animation:cs-win-pop .8s ease-out") + "}" +
    (reduced ? "" : "@keyframes cs-win-pop{0%{transform:scale(.3);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}") +
    ".cs-end-sub{color:#a49bb4;margin:0 0 18px;font-size:.9rem}" +
    ".cs-end-tbl{width:100%;border-collapse:collapse;font-size:.9rem;margin-bottom:16px}" +
    ".cs-end-tbl th{color:#d4af37;text-transform:uppercase;font-size:.68rem;letter-spacing:.1em;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.15)}" +
    ".cs-end-tbl td{padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.07);color:#e7e1d2}" +
    ".cs-end-tbl td.src{color:#9fd8c4;font-size:.78rem}" +
    ".cs-end-tbl tr.win td{background:rgba(212,175,55,.14);font-weight:700}" +
    ".cs-end-x{position:absolute;top:18px;right:22px;background:none;border:none;color:#e7e1d2;font-size:1.4rem;cursor:pointer}";
  document.head.appendChild(s);
}

export function createEndGameModal({ container = document.body, standings, winnerIds, title, onClose } = {}) {
  injectStyles();
  const winners = winnerIds ?? (standings ? standings.filter(s => s.rank === 1).map(s => s.playerId) : []);
  const rows = standings ?? [];
  const overlay = document.createElement("div");
  overlay.className = "cs-endgame";
  const card = document.createElement("div");
  card.className = "cs-end-card";
  overlay.appendChild(card);

  const close = document.createElement("button");
  close.className = "cs-end-x";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close the game-end summary");
  close.addEventListener("click", () => { overlay.remove(); if (onClose) onClose(); });
  card.appendChild(close);

  const win = document.createElement("h2");
  win.className = "cs-end-win animate";
  win.textContent = "🏆 " + (title || (winners.length === 1 ? winners[0] + " wins!" : "It's a draw!"));
  card.appendChild(win);
  const sub = document.createElement("p");
  sub.className = "cs-end-sub";
  sub.textContent = "The village grows. Score breakdown by source —";
  card.appendChild(sub);

  const tbl = document.createElement("table");
  tbl.className = "cs-end-tbl";
  tbl.innerHTML =
    "<thead><tr><th>Player</th><th>Reputation</th><th>Objectives</th><th>Buildings</th><th>Crates</th><th>Total</th></tr></thead><tbody></tbody>";
  const tb = tbl.querySelector("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.rank === 1) tr.className = "win";
    tr.innerHTML =
      "<td>" + r.playerId + "</td>" +
      '<td class="src">' + r.reputationVp + " VP</td>" +
      '<td class="src">' + r.objectiveVp + " VP</td>" +
      '<td class="src">' + r.buildingVp + " VP</td>" +
      '<td class="src">' + r.crateVp + " VP</td>" +
      "<td><b>" + r.total + "</b></td>";
    tb.appendChild(tr);
  }
  card.appendChild(tbl);

  const again = document.createElement("button");
  again.className = "btn btn-gold";
  again.type = "button";
  again.textContent = "Continue";
  again.addEventListener("click", () => { overlay.remove(); if (onClose) onClose(); });
  card.appendChild(again);

  container.appendChild(overlay);
  return { overlay, rows, winners, close: () => overlay.remove() };
}
