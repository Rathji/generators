// src/gameUI.js — Phase 10 game UI (Tasks 45-52).
// Renders the Charterstone board (hex grid: commons centre, ring-1 Commons,
// rings 2-3 destinations + charter anchors), the three tracks (progress,
// reputation, quota), live player dashboards, and the action-flow UI (worker
// placement with legal-destination highlighting + preview/confirm, retrieval,
// and building construction with legal-cell highlighting and a "sticker"
// permanence animation). Income landings flash a banner for all players.
// Task 50 adds the crate-unlock reveal modal (Index-Guide components); the
// layout is responsive via container queries (Task 52).
//
// The module is pure DOM: it never mutates game state itself — every action
// goes through the engine, and render() re-reads the state. ui.act(action,
// payload) is the programmatic API the Phase-10 tests drive; the DOM click
// handlers call the same paths.
//
// Layout (axial → pixel, pointy-top):
//   x = size·√3·(q + r/2), y = size·1.5·r   with size = CELL_RADIUS (34).
//   Ring-3 hexes span x ∈ [-4.5,4.5]·√3·size and r ∈ [-3,3] → viewBox ≈
//   "-300 -190 600 380". The SVG scales to the container width (Task 52).

import { RESOURCE_TYPES } from "./economy.js";
import { CARD_TYPES } from "./cards.js";
import { WORKER_ACTIONS } from "./engine.js";
import { TOKENS_PER_PLAYER } from "./influence.js";
import { STARTING_SETUP, STORY_CARDS, crateContents } from "./indexGuide.js";
import { createGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";
import { shapeForCharter, accessibleTextColor } from "./accessibility.js";
import { memoize, gameRenderFingerprint } from "./perf.js";

export const CELL_RADIUS = 34;
export const BOARD_VIEWBOX = "-305 -195 610 390";

export const RESOURCE_ICONS = {
  coins: "🪙", metal: "⚙️", coal: "🪨", pumpkin: "🎃", grain: "🌾", clay: "🧱", wood: "🪵",
};

export const COMMONS_NAMES = {
  zeppelin: "Zeppelin", charterstone: "Charterstone", grandstand: "Grandstand",
  treasury: "Treasury", market: "Market", cloudport: "Cloud Port",
};

// One-line descriptions used in previews/tooltips (the engine's benefit
// objects are executable; this maps them to readable text).
export const COMMONS_BENEFIT_TEXT = {
  zeppelin: "Construct 1 building in your charter · +5 VP",
  charterstone: "Unlock a crate · +5 VP",
  grandstand: "Score a completed objective · +5 VP",
  treasury: "Gain $1",
  market: "Gain 1 face-up advancement card",
  cloudport: "Sell a commodity · +3 VP",
};

// Short one-line labels rendered inside the hex tiles.
const SUB_LINES = {
  zeppelin: "Construct · +5 VP",
  charterstone: "Crate · +5 VP",
  grandstand: "Score · +5 VP",
  treasury: "Gain $1",
  market: "Gain a card",
  cloudport: "Sell · +3 VP",
};

export function axialToPixel(q, r, size = CELL_RADIUS) {
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}

export function cellPixelPoints(q, r, size = CELL_RADIUS) {
  const c = axialToPixel(q, r, size);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI / 180 * (60 * i - 30);
    pts.push([+(c.x + size * Math.cos(ang)).toFixed(2), +(c.y + size * Math.sin(ang)).toFixed(2)]);
  }
  return pts;
}

export function pointsToString(pts) {
  return pts.map(p => p[0] + "," + p[1]).join(" ");
}

// ── readable text helpers ──
export function renderItems(items = {}) {
  if (!items || Object.keys(items).length === 0) return "";
  return Object.entries(items)
    .map(([k, n]) => (RESOURCE_ICONS[k] ? RESOURCE_ICONS[k] + (n > 1 ? n : "") : k + " ×" + n))
    .join(" ");
}

export function describeBuilding(state, cell, opts = {}) {
  const def = state.engine.defs[cell.buildingId];
  if (!def) return null;
  const ctx = { state, playerId: state.turns.currentPlayerId, cell, ...opts };
  let costItems = null;
  if (def.cost && typeof def.cost === "function") {
    try { costItems = def.cost(ctx) ?? null; } catch { costItems = null; }
  } else {
    costItems = def.cost ?? {};
  }
  let benefitText = "";
  if (COMMONS_BENEFIT_TEXT[cell.buildingId]) benefitText = COMMONS_BENEFIT_TEXT[cell.buildingId];
  else if (def.benefit && def.benefit.items) benefitText = renderItems(def.benefit.items);
  else if (def.benefit && typeof def.benefit === "object" && typeof def.benefit.apply === "function") {
    benefitText = "Use the building's benefit";
  } else if (def.benefit && typeof def.benefit === "function") benefitText = "Use the building's benefit";
  const ownerBenefit = def.ownerBenefit && Object.keys(def.ownerBenefit).length ? renderItems(def.ownerBenefit) : "";
  return {
    name: def.name,
    buildingId: cell.buildingId,
    cost: costItems ? { ...costItems } : {},
    influenceCost: def.influenceCost ?? 0,
    benefitText,
    ownerBenefit,
    vp: def.vp ?? 0,
    commons: cell.type === "commonsBuilding",
    ownerId: cell.ownerId,
    workerId: cell.workerId,
  };
}

// Build a default Game-1 state for the demo / tests: 2 players, the printed
// starting advancement deck, starting personas, 3 revealed objectives.
export function setupDemoGame(opts = {}) {
  const playerCount = opts.playerCount ?? 2;
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: "P" + (i + 1),
    charterId: i,
    startingCoins: 4,
  }));
  const g = createGameState({
    players,
    firstPlayer: "P1",
    advancementConfig: { deck: [...STARTING_SETUP.advancementDeck] },
    objectivesConfig: [...STARTING_SETUP.objectives],
    cards: DEFAULT_CARDS,
    buildingDefs: DEFAULT_ENGINE_DEFS,
    rng: opts.rng,
  });
  for (let i = 0; i < players.length; i++) {
    const personaId = STARTING_SETUP.personas[i];
    if (personaId) g.personas.add(players[i].id, personaId);
  }
  return g;
}

const REASON_TEXT = {
  game_ended: "The game has ended.",
  not_your_turn: "Not this player's turn.",
  no_workers: "No workers in supply.",
  no_building: "No building on this cell.",
  cannot_afford_cost: "Cannot afford the cost.",
  cannot_afford_influence: "Not enough influence tokens.",
  no_such_card: "A card is required for this action.",
  card_not_in_hand: "You do not hold that card.",
  not_constructable: "That card cannot be constructed.",
  illegal_construction_cell: "Not a legal construction cell.",
  no_such_mat_card: "Pick a face-up advancement card.",
  card_already_held: "You already hold that card.",
  no_such_objective: "Pick a revealed objective.",
  objective_not_completed: "That objective is not completed yet.",
  already_scored: "You already scored that objective.",
  no_influence: "No influence tokens available.",
  no_such_space: "Pick an open quota space.",
  space_closed: "That quota space is closed.",
  no_crate: "That card carries no crate.",
  already_unlocked: "That crate is already unlocked.",
  not_constructable: "Not a constructable building.",
  track_full: "The reputation track is full.",
  invalid_request: "Invalid request.",
};

export function reasonText(reason) {
  return REASON_TEXT[reason] ?? (reason ? String(reason) : "");
}

// ── the UI ──
export function createGameUI(state, config = {}) {
  const container = config.container ?? document.body;
  container.classList.add("g-game");
  const ui = { state, config };

  // selection state: mode "place" | "construct" | null; sel {cellKey, opts, cardId?}
  let mode = null;
  let sel = null;          // { cellKey, opts, cardId, constructionCell }
  let chooser = null;      // { type, options: [{key, label, reason?}] }
  let reason = "";
  let lastResult = null;
  let stickerCell = null;  // cell key of the most recently constructed building (Task 49 "sticker" animation)
  let revealedCrate = null; // { cardId, cardName, crateNumber, components } — Index-Guide reveal modal (Task 50)

  const stateRef = () => ui.state;

  // Task 77: memoized card data — describeBuilding's render-relevant fields
  // are pure per (state, buildingId), so cache them per state instance.
  const cardMemoCache = new WeakMap();
  function memoBuildingInfo(st, cell) {
    let m = cardMemoCache.get(st);
    if (!m) {
      m = memoize((s, c) => describeBuilding(s, c, {}), (s, c) => c.buildingId);
      cardMemoCache.set(st, m);
    }
    return m(st, cell);
  }

  function currentPlayerId() {
    return stateRef().turns.currentPlayerId;
  }
  function playerById(id) {
    return stateRef().player(id);
  }
  function playerForCharter(charterId) {
    return stateRef().players.find(p => p.charterId === charterId) ?? null;
  }

  function legalActions() {
    return stateRef().engine.legalActions(currentPlayerId());
  }

  // per-cell legal map for placement mode
  function placementCells() {
    const out = new Map(); // key -> { ok, reason, preview?, chooser? }
    const st = stateRef();
    const pid = currentPlayerId();
    for (const cell of st.board.commonsBuildings().concat(st.board.constructedBuildings()).map(b => b.cell)) {
      const chooserType = chooserNeeded(cell.buildingId);
      if (chooserType) {
        const options = chooserOptions(chooserType);
        out.set(cell.key, options.length > 0
          ? { ok: true, chooser: chooserType, options: options.length }
          : { ok: false, reason: "no options for this action" });
      } else {
        out.set(cell.key, st.engine.checkPlace(pid, cell.key, {}));
      }
    }
    return out;
  }

  // ── actions (the programmatic API the tests drive) ──
  const actions = {
    enterPlace() {
      mode = "place";
      sel = null;
      chooser = null;
      reason = "";
      render();
    },
    enterConstruct(cardId) {
      mode = "construct";
      sel = { cardId, constructionCell: null };
      chooser = null;
      reason = "";
      render();
    },
    cancel() {
      mode = null;
      sel = null;
      chooser = null;
      reason = "";
      render();
    },
    selectCell(cellKey) {
      const st = stateRef();
      const pid = currentPlayerId();
      const cell = st.board.cell(cellKey);
      if (!cell) { reason = "no_building"; render(); return; }
      if (mode === "construct") {
        if (cell.type === "destination" && st.engine.isLegalConstructionCellForPlayer(pid, cell)) {
          sel = { ...(sel ?? {}), constructionCell: cell.key };
          reason = "";
          render();
        } else {
          reason = "illegal_construction_cell";
          render();
        }
        return;
      }
      // placement mode: resolve chooser buildings before committing to a cell
      const chooserType = chooserNeeded(cell.buildingId);
      if (chooserType) {
        const options = chooserOptions(chooserType);
        if (options.length === 0) {
          reason = "no options for this action";
          chooser = { type: chooserType, options: [] };
          render();
          return;
        }
        if (options.length === 1 && options[0].auto) {
          sel = { cellKey, opts: options[0].opts };
          chooser = null;
          reason = "";
          render();
          return;
        }
        chooser = { type: chooserType, options };
        sel = { cellKey, opts: null };
        reason = "";
        render();
        return;
      }
      const check = st.engine.checkPlace(pid, cell, {});
      if (check.ok) {
        sel = { cellKey, opts: {} };
        chooser = null;
        reason = "";
      } else {
        sel = { cellKey, opts: null };
        reason = check.reason;
      }
      render();
    },
    chooseOption(optionKey) {
      if (!chooser) return;
      let opt = chooser.options.find(o => o.key === optionKey);
      if (!opt && /^\d+$/.test(String(optionKey))) opt = chooser.options[Number(optionKey)];
      if (!opt) return;
      sel = { ...(sel ?? {}), opts: { ...(opt.opts ?? {}) } };
      chooser = null;
      reason = "";
      render();
    },
    confirm() {
      const st = stateRef();
      const pid = currentPlayerId();
      if (mode === "construct" && sel && sel.cardId) {
        if (!sel.constructionCell) { reason = "pick a construction cell"; render(); return; }
        const zeppelin = st.board.commonsBuildings().find(b => b.buildingId === "zeppelin");
        lastResult = st.engine.placeWorker(pid, zeppelin.cell, {
          cardId: sel.cardId,
          constructionCell: sel.constructionCell,
        });
        stickerCell = lastResult && lastResult.ok ? (lastResult.benefit?.cell ?? null) : null;
      } else if (sel && sel.cellKey) {
        lastResult = st.engine.placeWorker(pid, sel.cellKey, sel.opts ?? {});
        stickerCell = null;
      }
      if (lastResult && lastResult.ok && lastResult.buildingId === "charterstone") {
        const cid = lastResult.benefit?.cardId ?? (sel && sel.opts && sel.opts.cardId) ?? null;
        const crateNum = lastResult.benefit?.crateNumber ?? (cid && st.cards[cid]?.crateNumber) ?? null;
        revealedCrate = {
          cardId: cid,
          cardName: cid ? (st.cards[cid]?.name ?? cid) : "Crate",
          crateNumber: crateNum,
          components: crateContents(crateNum),
        };
      }
      mode = null;
      sel = null;
      chooser = null;
      if (lastResult && !lastResult.ok) reason = lastResult.reason;
      render();
      return lastResult;
    },
    retrieve() {
      const st = stateRef();
      lastResult = st.engine.retrieveWorkers(currentPlayerId());
      mode = null;
      sel = null;
      chooser = null;
      if (lastResult && !lastResult.ok) reason = lastResult.reason;
      render();
      return lastResult;
    },
  };
  ui.act = (name, payload) => actions[name] && actions[name](payload);

  function chooserNeeded(buildingId) {
    switch (buildingId) {
      case "grandstand": return "grandstand";
      case "charterstone": return "charterstone";
      case "cloudport": return "cloudport";
      case "market": return "market";
      case "treasury": return "treasury";
      case "zeppelin": return "zeppelin";
      default: return null;
    }
  }

  function chooserOptions(type) {
    const st = stateRef();
    const pid = currentPlayerId();
    const p = playerById(pid);
    if (type === "grandstand") {
      return st.objectives.revealedIds()
        .filter(id => st.objectives.isCompleted(id) && !st.objectives.hasScored(id, pid))
        .map(id => ({ key: id, label: (st.cards[id]?.name ?? id) + " (score)", opts: { objectiveId: id } }));
    }
    if (type === "charterstone") {
      return (p ? p.cards : [])
        .filter(id => {
          const c = st.cards[id];
          return c && c.type === CARD_TYPES.CONSTRUCTED_BUILDING && c.crateNumber != null && !st.crates.isUnlocked(id);
        })
        .map(id => ({ key: id, label: (st.cards[id]?.name ?? id) + " — crate " + st.cards[id].crateNumber, opts: { cardId: id } }));
    }
    if (type === "cloudport") {
      return st.quota.spaces()
        .filter(s => s.occupiedBy === null)
        .map(s => ({
          key: s.id,
          label: renderItems({ [s.commodity.type]: s.commodity.quantity }) + " → +" + (st.quota.vpBenefit + (s.bonus === "vp" ? 1 : 0)) + " VP" + (s.bonus === "reputation" ? " + reputation" : ""),
          opts: { quotaSpaceId: s.id },
        }));
    }
    if (type === "market") {
      return st.advancement.mat()
        .filter(Boolean)
        .map(id => ({ key: id, label: (st.cards[id]?.name ?? id) + " (advancement)", opts: { matCardId: id } }));
    }
    if (type === "treasury") {
      return RESOURCE_TYPES.map(r => ({ key: r, label: RESOURCE_ICONS[r] + " " + r, opts: { resource: r } }));
    }
    if (type === "zeppelin") {
      return (p ? p.cards : [])
        .filter(id => st.cards[id] && st.cards[id].type === CARD_TYPES.UNCONSTRUCTED_BUILDING)
        .map(id => {
          const c = st.cards[id];
          return {
            key: id,
            label: c.name + " — " + renderItems(c.constructionCost),
            opts: { cardId: id },
            auto: true,
          };
        });
    }
    return [];
  }

  // ── rendering ──
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SVG_TAGS = new Set(["svg", "g", "polygon", "text", "circle", "title", "path", "rect"]);
  function el(tag, attrs = {}, text = "") {
    const e = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.setAttribute("class", v);
      else if (k === "hidden") e.hidden = v;
      else if (k === "dataset") Object.assign(e.dataset, v);
      else e.setAttribute(k, v);
    }
    if (text) e.textContent = text;
    return e;
  }

  function renderTracks(root) {
    root.innerHTML = "";
    const st = stateRef();

    // progress track
    const prog = st.progress;
    const progBox = el("div", { class: "g-track g-track-progress", dataset: { track: "progress" } });
    progBox.appendChild(el("div", { class: "g-track-title" }, "Progress"));
    const progRow = el("div", { class: "g-track-row" });
    prog.spaces().forEach((sp, i) => {
      const n = i + 1;
      const cell = el("div", {
        class: "g-space" + (sp.icon ? " g-space-" + sp.icon : "") + (n === prog.position ? " g-space-token" : ""),
        dataset: { space: n, icon: sp.icon ?? "" },
      }, (sp.icon === "reputation" ? "★" : sp.icon === "income" ? "$" : sp.icon === "end" ? "🏁" : n));
      if (n === prog.position) cell.title = "progress token";
      progRow.appendChild(cell);
    });
    progBox.appendChild(progRow);
    root.appendChild(progBox);

    // reputation track
    const rep = st.reputation;
    const repBox = el("div", { class: "g-track g-track-reputation", dataset: { track: "reputation" } });
    repBox.appendChild(el("div", { class: "g-track-title" }, "Reputation"));
    const repRow = el("div", { class: "g-track-row" });
    for (let s = rep.firstSpace; s <= rep.maxSpace; s++) {
      const cell = el("div", { class: "g-space g-space-rep", dataset: { space: s } }, s);
      const occ = rep.occupied().find(o => o.space === s);
      if (occ) {
        cell.dataset.occupant = occ.playerId;
        const dot = el("span", { class: "g-rep-token", style: "background:" + (playerById(occ.playerId)?.color ?? "#888") });
        cell.appendChild(dot);
      }
      repRow.appendChild(cell);
    }
    repBox.appendChild(repRow);
    root.appendChild(repBox);

    // quota track
    const q = st.quota;
    const qBox = el("div", { class: "g-track g-track-quota", dataset: { track: "quota" } });
    qBox.appendChild(el("div", { class: "g-track-title" }, "Quota"));
    const qRow = el("div", { class: "g-track-row" });
    for (const s of q.spaces()) {
      const cell = el("div", {
        class: "g-space g-space-quota" + (s.occupiedBy ? " g-space-closed" : ""),
        dataset: { space: s.id, occupiedBy: s.occupiedBy ?? "" },
      });
      cell.appendChild(el("div", { class: "g-q-commodity" }, RESOURCE_ICONS[s.commodity.type] + (s.commodity.quantity > 1 ? s.commodity.quantity : "")));
      cell.appendChild(el("div", { class: "g-q-bonus" }, s.bonus === "vp" ? "+1 VP" : "+1 reputation"));
      if (s.occupiedBy) {
        const dot = el("span", { class: "g-rep-token", style: "background:" + (playerById(s.occupiedBy)?.color ?? "#888") });
        cell.appendChild(dot);
      }
      qRow.appendChild(cell);
    }
    qBox.appendChild(qRow);
    root.appendChild(qBox);
  }

  function renderBoard(svg) {
    const st = stateRef();
    svg.innerHTML = "";
    svg.setAttribute("viewBox", BOARD_VIEWBOX);
    const pid = currentPlayerId();
    const legalMap = mode === "place" ? placementCells() : new Map();
    const constructCells = mode === "construct" ? new Set(st.engine.legalConstructionCellsForPlayer(pid).map(c => c.key)) : null;
    const selectedKey = sel ? (mode === "construct" ? sel.constructionCell : sel.cellKey) : null;
    const many = st.board.cells.size > 120; // Task 77: board culling for huge boards
    const bx = -305, by = -195, bw = 610, bh = 390;

    for (const [key, cell] of st.board.cells) {
      if (many) {
        const p = axialToPixel(cell.q, cell.r);
        if (p.x < bx - 40 || p.x > bx + bw + 40 || p.y < by - 40 || p.y > by + bh + 40) continue;
      }
      const pts = pointsToString(cellPixelPoints(cell.q, cell.r));
      const g = el("g", { class: "g-cell", dataset: { cell: key, type: cell.type } });
      const polygon = el("polygon", { points: pts, class: "g-hex" });
      let fill = "var(--hex-plot)";
      if (cell.type === "commons") fill = "var(--hex-center)";
      else if (cell.type === "commonsBuilding") fill = "var(--hex-commons)";
      else if (cell.type === "charter") fill = "var(--hex-charter)";
      else if (cell.buildingId) fill = playerById(cell.ownerId)?.color ?? "var(--hex-built)";
      polygon.setAttribute("fill", fill);
      g.appendChild(polygon);

      const isLegal = legalMap.has(key) && legalMap.get(key).ok;
      const isConstructLegal = constructCells && constructCells.has(key);
      if (isLegal) {
        polygon.setAttribute("class", "g-hex g-hex-legal");
        polygon.setAttribute("fill", "rgba(47,174,140,.4)");
        g.dataset.legal = "1";
        const reason = legalMap.get(key).reason || "";
        if (reason) g.dataset.reason = reason;
      } else if (legalMap.has(key)) {
        g.dataset.legal = "0";
        g.dataset.reason = legalMap.get(key).reason || "";
      }
      if (isConstructLegal) {
        polygon.setAttribute("class", "g-hex g-hex-construct-legal");
        polygon.setAttribute("fill", "rgba(212,175,55,.38)");
        g.dataset.legal = "1";
        g.dataset.constructLegal = "1";
      }
      if (selectedKey === key) {
        polygon.setAttribute("class", polygon.getAttribute("class") + " g-hex-selected");
        g.dataset.selected = "1";
      }
      if (stickerCell === key) {
        polygon.setAttribute("class", polygon.getAttribute("class") + " g-hex-sticker");
        g.dataset.sticker = "1";
      }
      if (cell.type === "charter") {
        const ch = el("text", { class: "g-label g-label-charter", "text-anchor": "middle", x: axialToPixel(cell.q, cell.r).x, y: axialToPixel(cell.q, cell.r).y + 4 },
          playerForCharter(cell.charterId)?.id ?? "");
        ch.setAttribute("fill", playerForCharter(cell.charterId)?.color ?? "#fff");
        g.appendChild(ch);
      } else if (cell.buildingId) {
        const def = st.engine.defs[cell.buildingId];
        const name = def ? def.name : cell.buildingId;
        const short = name.length > 12 ? name.slice(0, 11) + "…" : name;
        const fs = short.length > 10 ? 7 : short.length > 8 ? 8 : 9.5;
        g.appendChild(el("text", { class: "g-label", style: "font-size:" + fs + "px", "text-anchor": "middle", x: axialToPixel(cell.q, cell.r).x, y: axialToPixel(cell.q, cell.r).y - 3 }, short));
        const info = memoBuildingInfo(st, cell);
        if (info) {
          const subText = SUB_LINES[cell.buildingId] ??
            (info.vp ? "+" + info.vp + " VP" : (info.benefitText && info.benefitText !== "Use the building's benefit" ? info.benefitText.split("·")[0].trim().slice(0, 14) : ""));
          g.appendChild(el("text", { class: "g-label g-label-sub", style: "font-size:6.5px", "text-anchor": "middle", x: axialToPixel(cell.q, cell.r).x, y: axialToPixel(cell.q, cell.r).y + 8 }, subText));
        }
      } else if (cell.type === "commons") {
        g.appendChild(el("text", { class: "g-label g-label-center", "text-anchor": "middle", x: axialToPixel(cell.q, cell.r).x, y: axialToPixel(cell.q, cell.r).y + 3 }, "Village"));
      }
      if (cell.workerId) {
        const c = axialToPixel(cell.q, cell.r);
        const dot = el("circle", { cx: c.x, cy: c.y + 16, r: 6 });
        dot.setAttribute("fill", playerById(cell.workerId)?.color ?? "#fff");
        dot.setAttribute("stroke", "#0a0912");
        dot.setAttribute("stroke-width", "1.5");
        g.appendChild(dot);
        // color-blind-safe tokens: every worker also shows its charter's shape
        const wp = playerById(cell.workerId);
        const wc = playerById(cell.workerId)?.color ?? "#fff";
        g.appendChild(el("text", {
          class: "g-label g-worker-shape", "text-anchor": "middle",
          "font-size": "8", "font-weight": "700",
          x: c.x, y: c.y + 19,
        }, shapeForCharter(wp?.charterId ?? 0)))
          .setAttribute("fill", accessibleTextColor(wc));
      }
      if (cell.type === "commonsBuilding" || cell.buildingId) {
        const info = memoBuildingInfo(st, cell);
        const tip = el("title");
        tip.textContent = [info.name, "Cost: " + (renderItems(info.cost) || "—"), "Benefit: " + info.benefitText, info.vp ? "VP: " + info.vp : null, info.ownerBenefit ? "Owner benefit: " + info.ownerBenefit : null, info.influenceCost ? "Influence: " + info.influenceCost : null].filter(Boolean).join("\n");
        g.appendChild(tip);
        g.dataset.tooltip = tip.textContent;
      }
      svg.appendChild(g);
    }
  }

  function renderDashboard(dash, player) {
    const st = stateRef();
    const pid = player.id;
    const influence = st.influence;
    const available = influence ? influence.availableOf(pid) : 0;
    const placed = influence ? influence.placedTotal(pid) : 0;
    const onBoard = st.board.workerCellsOf(pid).length;
    const box = el("div", {
      class: "g-dash" + (pid === currentPlayerId() ? " g-dash-active" : ""),
      dataset: { playerId: pid },
    });
    box.style.borderLeftColor = player.color;
    const head = el("div", { class: "g-dash-head" });
    head.appendChild(el("span", { class: "g-dash-name", style: "color:" + player.color }, player.id));
    head.appendChild(el("span", { class: "g-dash-vp", dataset: { stat: "vp" } }, "VP " + player.vp));
    box.appendChild(head);

    const stats = el("div", { class: "g-dash-stats" });
    const coins = el("span", { class: "g-stat", dataset: { stat: "coins" } }, RESOURCE_ICONS.coins + " " + player.coins());
    stats.appendChild(coins);
    for (const r of RESOURCE_TYPES) {
      const n = player.resources()[r] ?? 0;
      stats.appendChild(el("span", { class: "g-stat" + (n === 0 ? " g-stat-zero" : ""), dataset: { resource: r } }, RESOURCE_ICONS[r] + (n || "")));
    }
    box.appendChild(stats);

    const inf = el("div", { class: "g-dash-inf" });
    inf.appendChild(el("span", { dataset: { stat: "influence-avail" } }, "Influence " + available + " available"));
    inf.appendChild(el("span", { dataset: { stat: "influence-placed" } }, "· placed " + placed));
    inf.appendChild(el("span", { dataset: { stat: "influence-spent" } }, "· spent " + (TOKENS_PER_PLAYER - available - placed)));
    box.appendChild(inf);

    const workers = el("div", { class: "g-dash-workers" });
    workers.appendChild(el("span", { dataset: { stat: "workers" } }, "Workers " + player.workers + " in supply"));
    workers.appendChild(el("span", { dataset: { stat: "workers-on-board" } }, "· " + onBoard + " on board"));
    workers.appendChild(el("span", { dataset: { stat: "capacity" } }, "· Capacity " + player.capacity));
    box.appendChild(workers);

    const cards = el("div", { class: "g-dash-cards", dataset: { stat: "cards" } });
    if (player.cards.length === 0) {
      cards.appendChild(el("span", { class: "g-muted" }, "no held cards"));
    }
    for (const cid of player.cards) {
      const c = st.cards[cid];
      if (!c) continue;
      const chip = el("button", {
        class: "g-card-chip" + (c.type === CARD_TYPES.UNCONSTRUCTED_BUILDING ? " g-card-constructable" : ""),
        dataset: { card: cid, cardType: c.type },
      }, c.name);
      chip.title = c.desc ?? "";
      if (c.type === CARD_TYPES.UNCONSTRUCTED_BUILDING && pid === currentPlayerId()) {
        chip.addEventListener("click", () => ui.act("enterConstruct", cid));
      }
      cards.appendChild(chip);
    }
    box.appendChild(cards);
    dash.appendChild(box);
  }

  function renderActionBar(bar) {
    const st = stateRef();
    const pid = currentPlayerId();
    const acts = legalActions();
    bar.innerHTML = "";
    const turnEl = el("div", { class: "g-turn", dataset: { currentPlayer: pid } });
    turnEl.appendChild(el("span", { class: "g-turn-name", style: "color:" + (playerById(pid)?.color ?? "#fff") }, playerById(pid)?.id + "'s turn"));
    turnEl.appendChild(el("span", { class: "g-turn-round" }, "· round " + st.turns.currentRound()));
    bar.appendChild(turnEl);

    const btns = el("div", { class: "g-actions" });
    const canPlace = acts.includes(WORKER_ACTIONS.PLACE);
    const canRetrieve = acts.includes(WORKER_ACTIONS.RETRIEVE);
    if (mode === null) {
      const placeBtn = el("button", { class: "g-btn g-btn-primary", dataset: { action: "place" } }, "Place Worker");
      placeBtn.disabled = !canPlace;
      if (canPlace) placeBtn.addEventListener("click", () => ui.act("enterPlace"));
      btns.appendChild(placeBtn);
      const retBtn = el("button", { class: "g-btn", dataset: { action: "retrieve" } }, "Retrieve Workers");
      retBtn.disabled = !canRetrieve;
      if (canRetrieve) retBtn.addEventListener("click", () => ui.act("retrieve"));
      btns.appendChild(retBtn);
    } else {
      const cancelBtn = el("button", { class: "g-btn g-btn-ghost", dataset: { action: "cancel" } }, "Cancel");
      cancelBtn.addEventListener("click", () => ui.act("cancel"));
      btns.appendChild(cancelBtn);
      if (mode === "construct" && sel && sel.cardId) {
        const hint = el("span", { class: "g-hint", dataset: { action: "construct-hint" } }, "Pick a highlighted cell to place " + (st.cards[sel.cardId]?.name ?? sel.cardId));
        btns.appendChild(hint);
      } else if (mode === "place") {
        const hint = el("span", { class: "g-hint", dataset: { action: "place-hint" } }, "Pick a highlighted building");
        btns.appendChild(hint);
      }
    }
    bar.appendChild(btns);
  }

  function renderConfirm(panel) {
    const st = stateRef();
    panel.innerHTML = "";
    if (!sel || chooser) {
      panel.hidden = true;
      return;
    }
    let info = null;
    let check = null;
    const pid = currentPlayerId();
    if (mode === "construct" && sel.cardId) {
      const card = st.cards[sel.cardId];
      const cellKey = sel.constructionCell;
      if (!cellKey) { panel.hidden = true; return; }
      const cell = st.board.cell(cellKey);
      const zeppelin = st.board.commonsBuildings().find(b => b.buildingId === "zeppelin");
      check = st.engine.checkPlace(pid, zeppelin.cell, { cardId: sel.cardId, constructionCell: cellKey });
      info = {
        name: card.name,
        cost: { ...(card.constructionCost ?? {}) },
        influenceCost: 3,
        benefitText: "Construct in your charter · +5 VP · " + renderItems(card.constructionCost),
        vp: 5,
        cell: cellKey,
      };
    } else {
      const cell = st.board.cell(sel.cellKey);
      info = describeBuilding(st, cell, sel.opts ?? {});
      if (info) check = st.engine.checkPlace(pid, cell, sel.opts ?? {});
    }
    panel.hidden = !info;
    if (!info) return;
    panel.appendChild(el("div", { class: "g-confirm-title" }, info.name));
    const rows = el("div", { class: "g-confirm-rows" });
    if (renderItems(info.cost)) rows.appendChild(el("div", { class: "g-confirm-row" }, "Cost: " + renderItems(info.cost)));
    if (info.influenceCost) rows.appendChild(el("div", { class: "g-confirm-row" }, "Influence: " + info.influenceCost));
    rows.appendChild(el("div", { class: "g-confirm-row" }, "Benefit: " + info.benefitText));
    if (info.vp) rows.appendChild(el("div", { class: "g-confirm-row" }, "VP: " + info.vp));
    if (info.ownerBenefit) rows.appendChild(el("div", { class: "g-confirm-row" }, "Owner benefit: " + info.ownerBenefit));
    panel.appendChild(rows);

    const ok = check && check.ok;
    if (!ok) {
      const r = el("div", { class: "g-confirm-reason", dataset: { reason: (check && check.reason) || reason } }, reasonText((check && check.reason) || reason));
      panel.appendChild(r);
      panel.dataset.legal = "0";
      return;
    }
    panel.dataset.legal = "1";
    const cell = st.board.cell(sel.cellKey ?? sel.constructionCell);
    if (cell && cell.workerId) {
      const owner = playerById(cell.workerId);
      panel.appendChild(el("div", { class: "g-confirm-row g-confirm-bump", dataset: { bump: cell.workerId } },
        "Occupied by " + cell.workerId + (owner ? " (" + owner.color + ")" : "") + " — they will be bumped back to their supply."));
    }
    const confirmBtn = el("button", { class: "g-btn g-btn-primary g-confirm-ok", dataset: { action: "confirm" } }, "Confirm");
    confirmBtn.addEventListener("click", () => ui.act("confirm"));
    panel.appendChild(confirmBtn);
  }

  function renderChooser(panel) {
    const st = stateRef();
    panel.innerHTML = "";
    if (!chooser) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.appendChild(el("div", { class: "g-confirm-title" }, "Choose"));
    if (chooser.options.length === 0) {
      panel.appendChild(el("div", { class: "g-confirm-reason" }, reasonText(reason) || "No choices available."));
      return;
    }
    for (const opt of chooser.options) {
      const b = el("button", { class: "g-btn g-btn-opt", dataset: { choice: opt.key } }, opt.label);
      b.addEventListener("click", () => ui.act("chooseOption", opt.key));
      panel.appendChild(b);
    }
  }

  function renderLog(box) {
    const st = stateRef();
    box.innerHTML = "";
    box.appendChild(el("div", { class: "g-log-title" }, "Turn Log"));
    const list = el("div", { class: "g-log-list" });
    for (const e of st.log().slice(-30)) {
      list.appendChild(el("div", { class: "g-log-entry", dataset: { event: e.event, playerId: e.playerId } }, e.playerId + " — " + e.event + (e.detail && e.detail.buildingId ? " (" + e.detail.buildingId + ")" : "")));
    }
    box.appendChild(list);
  }

  function renderIncomeNotice(head) {
    const st = stateRef();
    const h = st.progress.history();
    const last = h[h.length - 1];
    let triggered = false;
    let ignored = false;
    if (last) {
      const icon = st.progress.spaceAt(last.to)?.icon;
      triggered = icon === "income" && st.progress.isIncomeEnabled();
      ignored = icon === "income" && !st.progress.isIncomeEnabled();
    }
    const notice = el("div", { class: "g-income", dataset: { notice: triggered ? "income" : ignored ? "locked" : "none" } });
    if (triggered) {
      notice.textContent = "💰 INCOME! All players collect income.";
      notice.id = "incomeBanner";
      notice.classList.add("g-income-flash");
    } else if (ignored) {
      notice.textContent = "Income space reached — income is still locked in the campaign.";
      notice.id = "incomeNotice";
    } else {
      notice.hidden = true;
    }
    head.appendChild(notice);
  }

  function renderCrateModal(root) {
    const old = root.querySelector(".g-modal-backdrop");
    if (old) old.remove();
    if (!revealedCrate) return;
    const st = stateRef();
    const backdrop = el("div", { class: "g-modal-backdrop", dataset: { crate: String(revealedCrate.crateNumber ?? "") } });
    const modal = el("div", { class: "g-modal" });
    modal.appendChild(el("div", { class: "g-modal-title", dataset: { cardId: revealedCrate.cardId ?? "" } }, revealedCrate.cardName));
    modal.appendChild(el("div", { class: "g-modal-sub" },
      "Crate #" + revealedCrate.crateNumber + " unlocked · cost $4 + 2 influence"));
    const comp = revealedCrate.components;
    if (comp && comp.cardIds && comp.cardIds.length) {
      modal.appendChild(el("div", { class: "g-modal-comp-title" }, "Advancement cards"));
      const chips = el("div", { class: "g-modal-chips", dataset: { group: "cards" } });
      for (const id of comp.cardIds) chips.appendChild(el("span", { class: "g-modal-chip", dataset: { component: id } }, st.cards[id]?.name ?? id));
      modal.appendChild(chips);
    }
    if (comp && comp.personas && comp.personas.length) {
      modal.appendChild(el("div", { class: "g-modal-comp-title" }, "Persona"));
      const chips = el("div", { class: "g-modal-chips", dataset: { group: "personas" } });
      for (const id of comp.personas) chips.appendChild(el("span", { class: "g-modal-chip", dataset: { component: id } }, st.cards[id]?.name ?? id));
      modal.appendChild(chips);
    }
    if (comp && comp.stories && comp.stories.length) {
      modal.appendChild(el("div", { class: "g-modal-comp-title" }, "Story cards"));
      const chips = el("div", { class: "g-modal-chips", dataset: { group: "stories" } });
      for (const id of comp.stories) chips.appendChild(el("span", { class: "g-modal-chip", dataset: { component: id } }, STORY_CARDS[id]?.title ?? id));
      modal.appendChild(chips);
    }
    if (comp && comp.stickers && comp.stickers.length) {
      modal.appendChild(el("div", { class: "g-modal-comp-title" }, "Stickers"));
      const chips = el("div", { class: "g-modal-chips", dataset: { group: "stickers" } });
      for (const id of comp.stickers) chips.appendChild(el("span", { class: "g-modal-chip", dataset: { component: id } }, id));
      modal.appendChild(chips);
    }
    const close = el("button", { class: "g-btn g-btn-primary g-modal-close", dataset: { action: "close-crate-modal" } }, "Close");
    close.addEventListener("click", () => { revealedCrate = null; render(); });
    modal.appendChild(close);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
  }

  // Task 77: dirty-flag re-render — when nothing that affects the UI changed
  // (state fingerprint + interaction state identical), skip the rebuild.
  let lastFp = null;
  function render() {
    const st = stateRef();
    const fp = gameRenderFingerprint(st) + "|m" + (mode ?? "") + "|s" + JSON.stringify(sel) + "|c" + (chooser ? chooser.type : "") + "|r" + reason + "|x" + (revealedCrate ? revealedCrate.cardId : "");
    if (fp === lastFp && container.querySelector(".g-board")) {
      // nothing changed — the DOM is already correct; skip the rebuild
      return;
    }
    lastFp = fp;
    container.innerHTML = "";

    const head = el("div", { class: "g-head" });
    const bar = el("div", { class: "g-actionbar", dataset: { mode: mode ?? "idle" } });
    renderActionBar(bar);
    head.appendChild(bar);
    renderIncomeNotice(head);
    container.appendChild(head);

    const tracks = el("div", { class: "g-tracks" });
    renderTracks(tracks);
    container.appendChild(tracks);

    const layout = el("div", { class: "g-layout" });
    const boardBox = el("div", { class: "g-boardbox" });
    const svg = el("svg", { class: "g-board" });
    renderBoard(svg);
    boardBox.appendChild(svg);

    const confirmPanel = el("div", { class: "g-panel", id: "confirmPanel" });
    confirmPanel.hidden = true;
    boardBox.appendChild(confirmPanel);
    const chooserPanel = el("div", { class: "g-panel", id: "chooserPanel" });
    chooserPanel.hidden = true;
    boardBox.appendChild(chooserPanel);
    layout.appendChild(boardBox);

    const side = el("div", { class: "g-side" });
    const dash = el("div", { class: "g-dashes" });
    for (const p of st.players) renderDashboard(dash, p);
    side.appendChild(dash);
    const reasonBox = el("div", { class: "g-reason", id: "reasonText", dataset: { reason: reason || "" } });
    if (reason) reasonBox.textContent = reasonText(reason);
    else reasonBox.hidden = true;
    side.appendChild(reasonBox);
    const logBox = el("div", { class: "g-logbox", id: "logBox" });
    renderLog(logBox);
    side.appendChild(logBox);
    layout.appendChild(side);
    container.appendChild(layout);

    // events
    svg.addEventListener("click", (ev) => {
      const cellEl = ev.target.closest(".g-cell");
      if (!cellEl) return;
      ui.act("selectCell", cellEl.dataset.cell);
    });
    renderConfirm(confirmPanel);
    renderChooser(chooserPanel);
    renderCrateModal(container);
  }

  ui.render = render;
  ui.actions = actions;
  ui.state = state;
  ui.lastResult = () => lastResult;
  ui.getSel = () => sel;
  ui.getMode = () => mode;
  return ui;
}
