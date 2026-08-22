// src/howToPlay.js — Phase 15 in-app how-to-play guide (Task 70).
// A modal covering the turn structure, The Commons, the tracks, and the
// legacy flow. Every section carries chronicleEntryIds linking to its
// ACTIVE Chronicle entry (the same entries the in-app Chronicle and the
// rule-sticker flags reference), so the guide stays in sync with the
// live ruleset as legacy stickers mutate it.

export const HOW_TO_PLAY_VERSION = 1;

export const HOW_TO_PLAY_SECTIONS = [
  {
    id: "turns",
    title: "Turn Structure",
    icon: "🎲",
    chronicleEntryIds: ["turns-actions", "turns-bump", "turns-cost-benefit", "turns-round", "turns-no-influence"],
    body:
      "<p>On your turn you must do exactly one of two things: <b>place a worker</b> from your personal supply onto any building, or <b>retrieve all of your workers</b> back from the board.</p>" +
      "<p>Placing onto an occupied building <b>bumps</b> its worker home first. Pay the building's cost from your personal supply, then gain its benefit. A round ends when every player has taken the same number of turns, and play returns to the first player.</p>" +
      "<p>A player who begins their turn with <b>0 influence tokens</b> must first advance the progress token one space.</p>",
  },
  {
    id: "commons",
    title: "The Commons",
    icon: "🏛️",
    chronicleEntryIds: ["commons-zeppelin", "commons-charterstone", "commons-grandstand", "commons-treasury", "commons-market", "commons-cloudport"],
    body:
      "<p>The six hexes in the centre of the board are The Commons — shared actions anyone may use:</p>" +
      "<p><b>Zeppelin</b> constructs a building · <b>Charterstone</b> unlocks a crate · <b>Grandstand</b> scores a completed objective · <b>Treasury</b> trades 1 resource for $1 · <b>Market</b> gains a face-up advancement card · <b>Cloud Port</b> sells a commodity for quota VP.</p>" +
      "<p>Buildings you construct stay on the board permanently — a new shared action for the rest of the campaign.</p>",
  },
  {
    id: "tracks",
    title: "The Tracks",
    icon: "📏",
    chronicleEntryIds: ["tracks-progress", "tracks-reputation", "tracks-quota", "tracks-influence", "setup-tracks"],
    body:
      "<p><b>Progress</b> is the game timer: it advances with every construction, crate unlock and objective score, and on the forced 0-influence advance. Bonus spaces grant reputation or income; the final space ends the game.</p>" +
      "<p><b>Reputation</b> costs 1 influence token per step; the highest reputations score 10/7/4 VP at game end (ties share).</p>" +
      "<p><b>Quota</b> spaces reward selling commodities at the Cloud Port for VP plus a bonus.</p>" +
      "<p><b>Influence</b> is your personal pool of 12 tokens — spent to construct, score objectives and fill quota spaces, and placed statically on reputation and objective cards.</p>",
  },
  {
    id: "legacy",
    title: "The Legacy Flow",
    icon: "📜",
    chronicleEntryIds: ["endgame-scoring", "endgame-legacy", "crates-unlock", "crates-sticker", "campaign-end"],
    body:
      "<p>Charterstone is a <b>legacy</b> game: constructed buildings, applied stickers and unlocked crates persist into the next game's setup, permanently changing the board and rules.</p>" +
      "<p>Each game ends when the progress token reaches the final space and the round finishes. Score reputation VP, objective VP, building VP and crate VP — the most VP wins that game, and the victory feeds the campaign.</p>" +
      "<p>After <b>12 games</b> the campaign is scored for glory, victories, personas, capacity and building value, and the ultimate winner is crowned.</p>",
  },
];

export function createHowToPlayGuide({ chronicle, sections = HOW_TO_PLAY_SECTIONS } = {}) {
  return {
    version: HOW_TO_PLAY_VERSION,
    sections: sections.map(s => ({
      id: s.id,
      title: s.title,
      icon: s.icon ?? "📖",
      body: s.body,
      chronicleEntries: s.chronicleEntryIds
        .map(id => (chronicle ? chronicle.entry(id) : null))
        .filter(Boolean)
        .map(e => ({ id: e.id, title: e.title, mechanics: e.mechanics, text: e.text })),
      missingEntries: s.chronicleEntryIds.filter(id => !(chronicle && chronicle.entry(id))),
    })),
  };
}

// ── modal UI ──
let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const s = document.createElement("style");
  s.id = "cs-howto-styles";
  s.textContent =
    ".cs-howto{position:fixed;inset:0;z-index:9400;display:flex;align-items:center;justify-content:center;background:rgba(10,9,18,.72);backdrop-filter:blur(3px)}" +
    ".cs-howto-card{width:min(680px,92vw);max-height:86vh;overflow:auto;background:#171422;border:1px solid rgba(212,175,55,.45);border-radius:14px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.5)}" +
    ".cs-howto-nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}" +
    ".cs-howto-tab{border:1px solid #55506e;background:#221e31;color:#e7e1d2;border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.85rem}" +
    ".cs-howto-tab.on{background:#d4af37;border-color:#d4af37;color:#1a1420;font-weight:600}" +
    ".cs-howto-body{color:#e7e1d2;font-size:.95rem;line-height:1.6;margin-bottom:16px}" +
    ".cs-howto-links{border-top:1px solid rgba(255,255,255,.1);padding-top:12px}" +
    ".cs-howto-links h4{margin:0 0 8px;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:#a49bb4}" +
    ".cs-howto-entry{background:#12231f;border:1px solid rgba(47,174,140,.35);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:.85rem}" +
    ".cs-howto-entry b{color:#9fd8c4;display:block;margin-bottom:2px}" +
    ".cs-howto-entry .mech{color:#7d7599;font-size:.72rem}" +
    ".cs-howto-x{position:absolute;top:18px;right:22px;background:none;border:none;color:#e7e1d2;font-size:1.4rem;cursor:pointer}";
  document.head.appendChild(s);
}

export function createHowToPlayModal({ container = document.body, chronicle, onClose } = {}) {
  injectStyles();
  const guide = createHowToPlayGuide({ chronicle });
  const overlay = document.createElement("div");
  overlay.className = "cs-howto";
  const card = document.createElement("div");
  card.className = "cs-howto-card";
  overlay.appendChild(card);

  const close = document.createElement("button");
  close.className = "cs-howto-x";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close the how-to-play guide");
  close.addEventListener("click", () => { overlay.remove(); if (onClose) onClose(); });
  card.appendChild(close);

  const nav = document.createElement("div");
  nav.className = "cs-howto-nav";
  card.appendChild(nav);
  const body = document.createElement("div");
  body.className = "cs-howto-body";
  card.appendChild(body);
  const links = document.createElement("div");
  links.className = "cs-howto-links";
  card.appendChild(links);

  let active = 0;
  function renderSection(i) {
    active = i;
    const sec = guide.sections[i];
    nav.innerHTML = "";
    guide.sections.forEach((s, idx) => {
      const b = document.createElement("button");
      b.className = "cs-howto-tab" + (idx === i ? " on" : "");
      b.type = "button";
      b.textContent = s.icon + " " + s.title;
      b.addEventListener("click", () => renderSection(idx));
      nav.appendChild(b);
    });
    body.innerHTML = sec.body;
    links.innerHTML = "<h4>In the Chronicle</h4>";
    if (sec.chronicleEntries.length === 0) {
      links.innerHTML += '<div class="cs-howto-entry">No Chronicle entries linked for this section.</div>';
    }
    for (const e of sec.chronicleEntries) {
      const d = document.createElement("div");
      d.className = "cs-howto-entry";
      d.innerHTML = "<b>" + e.title + "</b>" + (e.mechanics && e.mechanics.length ? '<span class="mech">' + e.mechanics.join(" · ") + "</span>" : "") + "<span>" + e.text + "</span>";
      links.appendChild(d);
    }
  }
  renderSection(0);
  container.appendChild(overlay);
  return { guide, overlay, close: () => overlay.remove(), goTo: renderSection };
}
