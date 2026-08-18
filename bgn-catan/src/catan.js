/* ═════════════════════════════════════════════════════════════════
   SETTLERS OF CATAN — 4-player engine + board renderer + AI
   Built on the BGN blank template. window.CatanGame is loaded BEFORE
   the template's main script, which delegates turn logic to it.
   Online play syncs via the server-plugin snapshot string (serialize).
   ═════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

/* ── helpers ─────────────────────────────────────────────── */
const rr = (v) => Math.round(v * 1e3) / 1e3;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
const randInt = (n) => Math.floor(Math.random() * n);
const choice = (arr) => arr[randInt(arr.length)];

/* ── board geometry (deterministic; identical on both clients) ── */
const SQ3 = Math.sqrt(3);
const HEX_S = 46;
const ROW_LEN = [3, 4, 5, 4, 3];
const HEX_N = 19;
const TERRAIN = ["wood", "brick", "sheep", "wheat", "ore", "desert"];
const TERRAIN_EMOJI = { wood: "🌲", brick: "🧱", sheep: "🐑", wheat: "🌾", ore: "⛏️", desert: "🏜️" };
const TERRAIN_COLOR = { wood: "#2f7d4f", brick: "#c46a43", sheep: "#8fbf4e", wheat: "#d4b23c", ore: "#8b8b9c", desert: "#e0c98a" };
const NUM_ORDER = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];
const SPIRAL = [0, 1, 2, 6, 11, 15, 18, 17, 16, 12, 7, 3, 4, 5, 10, 14, 13, 8, 9];

let hexes = [], verts = [], edges = [];
let hexVerts = [], hexEdges = [], hexAdj = [];
let vHex = [], vEdges = [], vVerts = [];
function buildGeometry() {
  hexes = []; verts = []; edges = [];
  hexVerts = []; hexEdges = [];
  const vmap = new Map(), emap = new Map();
  for (let r = 0; r < 5; r++) for (let c = 0; c < ROW_LEN[r]; c++) {
    hexes.push({ r, c, x: SQ3 * HEX_S * (c - (ROW_LEN[r] - 1) / 2), y: 1.5 * HEX_S * (r - 2) });
  }
  hexAdj = hexes.map(() => []);
  const getV = (x, y) => {
    const k = rr(x) + "," + rr(y);
    if (vmap.has(k)) return vmap.get(k);
    const id = verts.length; verts.push({ x: rr(x), y: rr(y) }); vmap.set(k, id); return id;
  };
  const getE = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), k = lo + "," + hi;
    if (emap.has(k)) return emap.get(k);
    const id = edges.length; edges.push([lo, hi]); emap.set(k, id); return id;
  };
  for (let i = 0; i < HEX_N; i++) {
    const h = hexes[i], vc = [], ec = [];
    for (let k = 0; k < 6; k++) {
      const a = (30 + 60 * k) * Math.PI / 180;
      vc.push(getV(h.x + HEX_S * Math.cos(a), h.y + HEX_S * Math.sin(a)));
    }
    for (let k = 0; k < 6; k++) ec.push(getE(vc[k], vc[(k + 1) % 6]));
    hexVerts.push(vc); hexEdges.push(ec);
  }
  vHex = verts.map(() => []); vEdges = verts.map(() => []); vVerts = verts.map(() => []);
  hexVerts.forEach((vc, h) => vc.forEach((v) => vHex[v].push(h)));
  edges.forEach((e, id) => { const [a, b] = e; vEdges[a].push(id); vEdges[b].push(id); vVerts[a].push(b); vVerts[b].push(a); });
  for (let i = 0; i < HEX_N; i++) for (let j = i + 1; j < HEX_N; j++) {
    if (Math.abs(Math.hypot(hexes[i].x - hexes[j].x, hexes[i].y - hexes[j].y) - SQ3 * HEX_S) < 1) { hexAdj[i].push(j); hexAdj[j].push(i); }
  }
}
buildGeometry();

/* ── state ──────────────────────────────────────────────── */
const WIN_VP = 10;
const COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { ore: 3, wheat: 2 },
  dev: { sheep: 1, wheat: 1, ore: 1 },
};
const RES_NAMES = ["wood", "brick", "sheep", "wheat", "ore"];
const RES_EMOJI = { wood: "🪵", brick: "🧱", sheep: "🐑", wheat: "🌾", ore: "⛏️" };
const P_COLOR = ["#e0533d", "#3fae5a", "#3f7fd9", "#f0a030"];
const P_COLOR_DARK = ["#8f2b1c", "#1f6e33", "#1f4d9e", "#a86b12"];
const P_NAME = ["Red", "Green", "Blue", "Orange"];
const PLAYERS = 4;
const PHASES = ["setup", "roll", "discard", "rob", "action", "over"];

let S = null;
let identity = { mode: null, me: 0 };
let sel = null;
let canvas = null, ctx = null, dpr = 1;
let canvasW = 700, canvasH = 520;
let rafQueued = false, discardOpen = false;
let DEV_DECK = [];
function resetDeck() { DEV_DECK.splice(0, DEV_DECK.length, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4); }
resetDeck();
let deckLeft = 25;

const hooks = { addLog: null, sfx: null, flashBanner: null, onGameOver: null, requestCommit: null, isOnline: null, myRole: null, chrome: null };

function freshPlayer() {
  return { res: [0, 0, 0, 0, 0], dev: [0, 0, 0, 0], vpCards: 0, knights: 0, devBlocked: false, roads: [], settles: [], cities: [] };
}
function freshState() {
  return {
    phase: "setup", setupStep: 0, active: 0, turn: 0, first: 0,
    dice: null, discardTarget: -1, discardNeed: 0, robTarget: -1,
    pendingDev: null, ended: false, winner: null, reason: null,
    board: { types: new Array(HEX_N).fill(0), nums: new Array(HEX_N).fill(0), robber: -1 },
    p: Array.from({ length: PLAYERS }, () => freshPlayer()),
  };
}

/* ── random board ───────────────────────────────────────── */
function genBoard() {
  for (let tries = 0; tries < 900; tries++) {
    const t = new Array(HEX_N).fill(0);
    const deck = [];
    for (const tn of ["wood", "wood", "wood", "wood", "brick", "brick", "brick", "brick", "sheep", "sheep", "sheep", "sheep", "wheat", "wheat", "wheat", "wheat", "ore", "ore", "ore", "ore", "desert"]) deck.push(TERRAIN.indexOf(tn));
    shuffle(deck);
    for (let i = 0; i < HEX_N; i++) t[SPIRAL[i]] = deck[i];
    const n = new Array(HEX_N).fill(0);
    let k = 0;
    for (let i = 0; i < HEX_N; i++) {
      if (t[SPIRAL[i]] === 5) { n[SPIRAL[i]] = 0; continue; }
      n[SPIRAL[i]] = NUM_ORDER[k++];
    }
    let bad = false;
    for (let i = 0; i < HEX_N && !bad; i++) {
      if (n[i] !== 6 && n[i] !== 8) continue;
      for (const j of hexAdj[i]) if (n[j] === 6 || n[j] === 8) { bad = true; break; }
    }
    if (!bad) return { types: t, nums: n, robber: t.indexOf(5) };
  }
  const t = new Array(HEX_N).fill(0);
  for (let i = 0; i < HEX_N; i++) t[i] = i % 5;
  t[18] = 5;
  const n = new Array(HEX_N).fill(0);
  for (let i = 0, k = 0; i < HEX_N; i++) if (t[i] !== 5) n[i] = NUM_ORDER[k++];
  return { types: t, nums: n, robber: t.indexOf(5) };
}

/* ── actor helpers ──────────────────────────────────────── */
function me() { return identity.me; }
function uiActor() { return S.phase === "discard" ? S.discardTarget : S.active; }
function setupActor() { return [0, 1, 2, 3, 3, 2, 1, 0][S.setupStep]; }
function canAct(pi) { if (S.ended) return false; if (identity.mode === "online") return pi === me(); return true; }
function uiCanInteract() {
  if (!S || S.ended) return false;
  if (identity.mode === "online" || identity.mode === "ai") return uiActor() === me();
  return true;
}
function isMyAction() {
  if (!S || S.ended) return false;
  if (identity.mode === "online") {
    if (S.phase === "discard") return S.discardTarget === me();
    return S.active === me();
  }
  if (identity.mode === "ai") {
    if (S.phase === "discard") return S.discardTarget === me();
    return S.active === me();
  }
  return true;
}
function isBotTurn() {
  if (!S || S.ended) return false;
  if (identity.mode !== "ai") return false;
  if (S.phase === "setup") return setupActor() !== 0;
  if (S.phase === "discard") return S.discardTarget !== 0;
  return S.active !== 0;
}

/* ── game logic ─────────────────────────────────────────── */
function ownerOfVertex(v) {
  for (let pi = 0; pi < PLAYERS; pi++) if (S.p[pi].settles.indexOf(v) !== -1 || S.p[pi].cities.indexOf(v) !== -1) return pi;
  return -1;
}
function vertexBlocked(v) {
  if (ownerOfVertex(v) !== -1) return true;
  for (const nv of vVerts[v]) if (ownerOfVertex(nv) !== -1) return true;
  return false;
}
function legalSettlementVertex(v, pi, setup) {
  if (v < 0 || v >= verts.length) return false;
  if (vertexBlocked(v)) return false;
  if (setup) return true;
  for (const e of vEdges[v]) if (S.p[pi].roads.indexOf(e) !== -1) return true;
  return false;
}
function legalRoadEdge(e, pi, setup) {
  if (e < 0 || e >= edges.length) return false;
  if (S.p[pi].roads.indexOf(e) !== -1) return false;
  const [a, b] = edges[e];
  if (setup) return true;
  if (ownerOfVertex(a) === pi || ownerOfVertex(b) === pi) return true;
  for (const ne of vEdges[a]) if (S.p[pi].roads.indexOf(ne) !== -1) return true;
  for (const ne of vEdges[b]) if (S.p[pi].roads.indexOf(ne) !== -1) return true;
  return false;
}
function canAfford(pi, cost) { for (let i = 0; i < 5; i++) if (S.p[pi].res[i] < (cost[RES_NAMES[i]] || 0)) return false; return true; }
function pay(pi, cost) { for (let i = 0; i < 5; i++) S.p[pi].res[i] -= cost[RES_NAMES[i]] || 0; }
function handCount(pi) { return S.p[pi].res.reduce((a, b) => a + b, 0); }
function devCount(pi) { return S.p[pi].dev.reduce((a, b) => a + b, 0) + S.p[pi].vpCards; }
function rollDice() { return [1 + randInt(6), 1 + randInt(6)]; }
function grantInitial(pi, v) { for (const h of vHex[v]) if (S.board.types[h] !== 5) S.p[pi].res[S.board.types[h]]++; }
function produceForRoll(total) {
  const gains = Array.from({ length: PLAYERS }, () => [0, 0, 0, 0, 0]);
  for (let h = 0; h < HEX_N; h++) {
    const t = S.board.types[h];
    if (t === 5 || S.board.nums[h] !== total || h === S.board.robber) continue;
    for (let pi = 0; pi < PLAYERS; pi++) {
      for (const v of S.p[pi].settles) if (vHex[v].indexOf(h) !== -1) gains[pi][t]++;
      for (const v of S.p[pi].cities) if (vHex[v].indexOf(h) !== -1) gains[pi][t] += 2;
    }
  }
  for (let pi = 0; pi < PLAYERS; pi++) for (let i = 0; i < 5; i++) S.p[pi].res[i] += gains[pi][i];
  return gains;
}
function armyVp(pi) {
  if (S.p[pi].knights < 2) return 0;
  for (let q = 0; q < PLAYERS; q++) if (q !== pi && S.p[q].knights >= S.p[pi].knights) return 0;
  return 2;
}
function roadVp(pi) {
  const mine = longestRoad(pi);
  if (mine < 5) return 0;
  for (let q = 0; q < PLAYERS; q++) if (q !== pi && longestRoad(q) >= mine) return 0;
  return 2;
}
function totalVp(pi) { return S.p[pi].settles.length + S.p[pi].cities.length * 2 + S.p[pi].vpCards + armyVp(pi) + roadVp(pi); }
function longestRoad(pi) {
  const owned = S.p[pi].roads;
  let best = 0;
  for (const e0 of owned) {
    const visited = new Set([e0]);
    const stack = [[e0, edges[e0][0], 1], [e0, edges[e0][1], 1]];
    while (stack.length) {
      const [e, cameFromV, len] = stack.pop();
      if (len > best) best = len;
      const nxt = edges[e][0] === cameFromV ? edges[e][1] : edges[e][0];
      for (const ne of vEdges[nxt]) {
        if (visited.has(ne) || S.p[pi].roads.indexOf(ne) === -1) continue;
        visited.add(ne);
        stack.push([ne, nxt, len + 1]);
      }
      // note: edges share visited set; branching handled by pushing both directions from e0
    }
  }
  return best;
}
function checkWinner(pi) {
  if (S.ended) return;
  if (totalVp(pi) >= WIN_VP) {
    S.phase = "over"; S.ended = true; S.winner = pi; S.reason = "end";
    if (hooks.onGameOver) hooks.onGameOver(pi);
  }
}

/* ── actions (pi = acting player) ───────────────────────── */
function logFor(pi, msg) { if (hooks.addLog) hooks.addLog(P_NAME[pi], msg); }
function doRoll(pi) {
  if (S.phase !== "roll" || S.active !== pi || !canAct(pi)) return false;
  const [a, b] = rollDice();
  S.dice = [a, b];
  const total = a + b;
  hooks.sfx && hooks.sfx("roll");
  if (total === 7) {
    logFor(pi, "rolled 7 — the robber! 🦹");
    S.phase = "discard";
    const d = nextDiscarder(-1);
    if (d !== -1) { S.discardTarget = d; S.discardNeed = Math.floor(handCount(d) / 2); }
    else { S.phase = "rob"; S.robTarget = S.active; }
  } else {
    logFor(pi, "rolled " + total);
    const gains = produceForRoll(total);
    const msgs = [];
    for (let p = 0; p < PLAYERS; p++) for (let i = 0; i < 5; i++) if (gains[p][i]) msgs.push(P_NAME[p] + " +" + gains[p][i] + " " + RES_NAMES[i]);
    logFor(pi, msgs.length ? msgs.join(", ") : "no production");
    S.phase = "action";
  }
  return true;
}
function nextDiscarder(after) {
  for (let k = 1; k <= PLAYERS; k++) {
    const q = (after + k + PLAYERS) % PLAYERS;
    if (handCount(q) > 7) return q;
  }
  return -1;
}
function doDiscard(pi, remove) {
  if (S.phase !== "discard" || S.discardTarget !== pi || !canAct(pi)) return false;
  let sum = 0;
  for (let i = 0; i < 5; i++) { if (remove[i] > S.p[pi].res[i]) return false; sum += remove[i]; }
  if (sum !== S.discardNeed) return false;
  for (let i = 0; i < 5; i++) S.p[pi].res[i] -= remove[i];
  logFor(pi, "discarded " + S.discardNeed + " cards");
  S.discardTarget = -1;
  const nd = nextDiscarder(pi);
  if (nd !== -1) { S.discardTarget = nd; S.discardNeed = Math.floor(handCount(nd) / 2); }
  else { S.phase = "rob"; S.robTarget = S.active; }
  return true;
}
function hasBuildingAtHex(pi, h) {
  for (const v of S.p[pi].settles) if (vHex[v].indexOf(h) !== -1) return true;
  for (const v of S.p[pi].cities) if (vHex[v].indexOf(h) !== -1) return true;
  return false;
}
function doRobberMove(pi, hex) {
  if (S.phase !== "rob" || S.robTarget !== pi || hex === S.board.robber || !canAct(pi)) return false;
  S.board.robber = hex;
  logFor(pi, "moved the robber");
  const victims = [];
  for (let q = 0; q < PLAYERS; q++) if (q !== pi && handCount(q) > 0 && hasBuildingAtHex(q, hex)) victims.push(q);
  const opp = victims.length ? choice(victims) : -1;
  let res = [];
  if (opp !== -1) {
    for (let i = 0; i < 5; i++) for (let k = 0; k < S.p[opp].res[i]; k++) res.push(i);
    const r = choice(res);
    S.p[opp].res[r]--;
    S.p[pi].res[r]++;
    logFor(pi, "stole 1 " + RES_NAMES[r] + " from " + P_NAME[opp] + "!");
  } else {
    logFor(pi, "nothing to steal");
  }
  S.pendingDev = null;
  S.phase = "action";
  return true;
}
function doBuildRoad(pi, e) {
  if (S.phase === "setup") {
    if (setupActor() !== pi || !canAct(pi)) return false;
    if (!legalRoadEdge(e, pi, true) || !sel || sel.v == null) return false;
    const [a, b] = edges[e];
    if (a !== sel.v && b !== sel.v) return false;
    S.p[pi].roads.push(e);
    sel.roadDone = true;
    logFor(pi, "placed a road");
    finishSetupStep(pi);
    return true;
  }
  if (S.phase !== "action" || S.active !== pi || !canAct(pi)) return false;
  if (!legalRoadEdge(e, pi, false)) return false;
  if (S.pendingDev && S.pendingDev.type === 1) {
    S.p[pi].roads.push(e);
    logFor(pi, "placed a road (Road Builder)");
    S.pendingDev.n--;
    if (S.pendingDev.n <= 0) S.pendingDev = null;
    checkWinner(pi);
    return true;
  }
  if (S.p[pi].roads.length >= 15 || !canAfford(pi, COSTS.road)) return false;
  pay(pi, COSTS.road);
  S.p[pi].roads.push(e);
  logFor(pi, "built a road");
  hooks.sfx && hooks.sfx("turn");
  checkWinner(pi);
  return true;
}
function finishSetupStep(pi) {
  if (!sel) return;
  const settleCount = sel.setNo;
  S.setupStep++;
  sel = null;
  if (settleCount === 1) {
    const v = S.p[pi].settles[S.p[pi].settles.length - 1];
    grantInitial(pi, v);
    logFor(pi, "collected initial resources");
  }
  if (S.setupStep >= PLAYERS * 2) { S.phase = "roll"; S.active = S.first; }
  else S.active = setupActor();
}
function doBuildSettlement(pi, v) {
  if (S.phase === "setup") {
    if (setupActor() !== pi || !canAct(pi)) return false;
    if (!legalSettlementVertex(v, pi, true)) return false;
    S.p[pi].settles.push(v);
    sel = { v, roadDone: false, setNo: S.p[pi].settles.length - 1 };
    logFor(pi, "placed settlement " + (S.setupStep < 2 ? "1" : "2"));
    hooks.sfx && hooks.sfx("place");
    return true;
  }
  if (S.phase !== "action" || S.active !== pi || !canAct(pi)) return false;
  if (S.p[pi].settles.length >= 5 || !legalSettlementVertex(v, pi, false) || !canAfford(pi, COSTS.settlement)) return false;
  pay(pi, COSTS.settlement);
  S.p[pi].settles.push(v);
  logFor(pi, "built a settlement");
  hooks.sfx && hooks.sfx("place");
  checkWinner(pi);
  return true;
}
function doBuildCity(pi, v) {
  if (S.phase !== "action" || S.active !== pi || !canAct(pi)) return false;
  const idx = S.p[pi].settles.indexOf(v);
  if (idx === -1 || S.p[pi].cities.length >= 4 || !canAfford(pi, COSTS.city)) return false;
  pay(pi, COSTS.city);
  S.p[pi].settles.splice(idx, 1);
  S.p[pi].cities.push(v);
  logFor(pi, "upgraded to a city 🏙️");
  hooks.sfx && hooks.sfx("place");
  checkWinner(pi);
  return true;
}
function doBuyDev(pi) {
  if (S.phase !== "action" || S.active !== pi || !canAct(pi)) return false;
  if (deckLeft <= 0 || !canAfford(pi, COSTS.dev)) return false;
  const idx = randInt(deckLeft);
  const t = DEV_DECK[idx];
  DEV_DECK.splice(idx, 1);
  deckLeft--;
  pay(pi, COSTS.dev);
  if (t === 4) S.p[pi].vpCards++;
  else S.p[pi].dev[t]++;
  S.p[pi].devBlocked = true;
  logFor(pi, "bought a dev card");
  hooks.sfx && hooks.sfx("deal");
  checkWinner(pi);
  return true;
}
function doPlayDev(pi, type) {
  if (S.phase !== "action" || S.active !== pi || !canAct(pi)) return false;
  if (!S.p[pi].dev[type] || S.p[pi].devBlocked) return false;
  S.p[pi].dev[type]--;
  if (type === 0) {
    S.p[pi].knights++;
    logFor(pi, "played a Knight ⚔️");
    if (S.p[pi].knights === 2) logFor(pi, "claims Largest Army!");
    S.pendingDev = { type: 0, n: 0 };
    S.phase = "rob"; S.robTarget = pi;
  } else if (type === 1) { S.pendingDev = { type: 1, n: 2 }; logFor(pi, "played Road Builder 🛤️"); }
  else if (type === 2) { S.pendingDev = { type: 2, n: 2 }; logFor(pi, "played Year of Plenty 🎁"); }
  else { S.pendingDev = { type: 3, n: 0 }; logFor(pi, "played Monopoly 🃏"); }
  hooks.sfx && hooks.sfx("draw");
  checkWinner(pi);
  return true;
}
function doPickYop(pi, res) {
  if (S.phase !== "action" || !S.pendingDev || S.pendingDev.type !== 2 || !canAct(pi)) return false;
  S.p[pi].res[res]++;
  S.pendingDev.n--;
  if (S.pendingDev.n <= 0) S.pendingDev = null;
  return true;
}
function doPickMono(pi, res) {
  if (S.phase !== "action" || !S.pendingDev || S.pendingDev.type !== 3 || !canAct(pi)) return false;
  let n = 0;
  for (let q = 0; q < PLAYERS; q++) {
    if (q === pi) continue;
    const t = S.p[q].res[res];
    if (t > 0) { S.p[q].res[res] = 0; S.p[pi].res[res] += t; n += t; }
  }
  if (n > 0) logFor(pi, "took " + n + " " + RES_NAMES[res] + " via Monopoly!");
  S.pendingDev = null;
  return true;
}
function doTrade(pi, give, take) {
  if (S.phase !== "action" || S.active !== pi || !canAct(pi)) return false;
  if (give === take || S.p[pi].res[give] < 4) return false;
  S.p[pi].res[give] -= 4;
  S.p[pi].res[take]++;
  logFor(pi, "traded 4 " + RES_NAMES[give] + " → 1 " + RES_NAMES[take]);
  hooks.sfx && hooks.sfx("deal");
  return true;
}
function endTurn(pi) {
  if (S.ended || (S.phase !== "action" && S.phase !== "roll") || S.active !== pi || S.pendingDev) return false;
  logFor(pi, "ended turn");
  S.p[(pi + 1) % PLAYERS].devBlocked = false;
  S.active = (pi + 1) % PLAYERS;
  S.turn++;
  S.dice = null;
  S.phase = "roll";
  return true;
}
function pass() {
  if (!S || S.ended) return { committed: false };
  if (S.phase === "setup") return { committed: false, needPlacement: true };
  if (S.phase === "discard") return { committed: false, needDiscard: true };
  if (S.phase === "rob") return { committed: false, needRobber: true };
  const pi = uiActor();
  if (!endTurn(pi)) return { committed: false };
  return { committed: true };
}

/* ── labels ─────────────────────────────────────────────── */
function turnLabel() {
  if (!S) return "";
  if (S.ended) return "Match over";
  const n = P_NAME[S.active];
  if (S.phase === "setup") return "Setup · " + P_NAME[setupActor()] + " · " + (S.setupStep < PLAYERS ? "1st" : "2nd") + " settlement";
  if (S.phase === "roll") return n + " — roll the dice";
  if (S.phase === "discard") return P_NAME[S.discardTarget] + " — discard " + S.discardNeed;
  if (S.phase === "rob") return "Robber · " + P_NAME[S.active];
  if (S.phase === "action") return n + " — build & trade";
  return "";
}
function bannerText() {
  if (!S) return "";
  if (S.ended) return "";
  const n = P_NAME[S.active];
  const meTurn = isMyAction();
  if (S.phase === "setup") {
    const who = P_NAME[setupActor()];
    const which = S.setupStep < PLAYERS ? "1st" : "2nd";
    const note = which === "2nd" ? " — collecting its resources" : "";
    if (meTurn) return "Your turn · place your " + which + " settlement + road" + note + ".";
    return "Waiting for " + who + " — place " + which + " settlement + road" + note + ".";
  }
  if (S.phase === "roll") return meTurn ? n + " — roll the dice to start your turn 🎲" : "Waiting for " + n + " to roll…";
  if (S.phase === "discard") {
    if (S.discardTarget === me()) return "A 7 was rolled — discard " + S.discardNeed + " card" + (S.discardNeed > 1 ? "s" : "") + " (click resources to remove, then Discard).";
    return "Waiting for " + P_NAME[S.discardTarget] + " to discard " + S.discardNeed + " cards…";
  }
  if (S.phase === "rob") {
    if (meTurn) return "Move the robber to a new hex — then steal a card from a rival with buildings there.";
    return "Waiting for " + n + " to move the robber…";
  }
  if (S.phase === "action") {
    if (S.pendingDev) {
      if (S.pendingDev.type === 1) return "Road Builder — place road " + (S.pendingDev.n === 2 ? "1" : "2") + " of 2 on the board.";
      if (S.pendingDev.type === 2) return "Year of Plenty — pick " + S.pendingDev.n + " resource" + (S.pendingDev.n > 1 ? "s" : "") + ".";
      if (S.pendingDev.type === 3) return "Monopoly — pick the resource to take ALL of from every rival.";
      return "Knight — move the robber, then steal.";
    }
    if (S.dice && S.dice[0] + S.dice[1] === 7) return meTurn ? "7 rolled — production blocked. Build, trade, or end your turn." : "Waiting for " + n + " to finish…";
    return meTurn ? (S.dice ? "You rolled " + (S.dice[0] + S.dice[1]) + ". Build, trade, play dev cards, or end your turn." : "Roll the dice to start.") : "Waiting for " + n + " to finish their turn…";
  }
  return "";
}

/* ── state serialization (compact) ──────────────────────── */
function serialize() {
  const out = { arr: [], cur: 0, n: 0 };
  const u = (v, n) => {
    for (let i = 0; i < n; i++) {
      out.cur |= ((v >> i) & 1) << out.n;
      out.n++;
      if (out.n === 8) { out.arr.push(out.cur); out.cur = 0; out.n = 0; }
    }
  };
  u(3, 2);
  u(S.first, 2);
  u(PHASES.indexOf(S.phase), 3);
  u(S.active, 2);
  u(S.setupStep, 4);
  u(S.turn, 8);
  u(S.dice ? (S.dice[0] - 1) * 6 + (S.dice[1] - 1) : 0, 6);
  u(S.discardTarget + 1, 3);
  u(S.discardNeed, 4);
  u(S.robTarget + 1, 3);
  u(S.pendingDev ? S.pendingDev.type + 1 : 0, 3);
  u(S.pendingDev ? S.pendingDev.n : 0, 3);
  for (let i = 0; i < HEX_N; i++) u(S.board.types[i], 3);
  for (let i = 0; i < HEX_N; i++) u(S.board.nums[i], 4);
  u(S.board.robber + 1, 5);
  for (let pi = 0; pi < PLAYERS; pi++) {
    const p = S.p[pi];
    for (let i = 0; i < 5; i++) u(p.res[i], 4);
    for (let i = 0; i < 4; i++) u(p.dev[i], 4);
    u(p.vpCards, 3);
    u(p.knights, 3);
    u(p.devBlocked ? 1 : 0, 1);
    u(p.roads.length, 4);
    for (const e of p.roads) u(e, 7);
    u(p.settles.length, 4);
    for (const v of p.settles) u(v, 6);
    u(p.cities.length, 4);
    for (const v of p.cities) u(v, 6);
  }
  if (out.n > 0) out.arr.push(out.cur);
  return btoa(String.fromCharCode.apply(null, out.arr));
}
function deserialize(str) {
  let bytes;
  try { const bin = atob(str); bytes = new Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
  catch (e) { return null; }
  let bitPos = 0;
  const ru = (nb) => { let v = 0; for (let i = 0; i < nb; i++) { v |= ((bytes[bitPos >> 3] >> (bitPos & 7)) & 1) << i; bitPos++; } return v; };
  const st = freshState();
  if (ru(2) !== 3) return null;
  st.first = ru(2);
  st.phase = PHASES[ru(3)];
  st.active = ru(2);
  st.setupStep = ru(4);
  st.turn = ru(8);
  const dc = ru(6);
  st.dice = dc ? [Math.floor(dc / 6) + 1, (dc % 6) + 1] : null;
  st.discardTarget = ru(3) - 1;
  st.discardNeed = ru(4);
  st.robTarget = ru(3) - 1;
  const pd = ru(3), pdn = ru(3);
  st.pendingDev = pd ? { type: pd - 1, n: pdn } : null;
  for (let i = 0; i < HEX_N; i++) st.board.types[i] = ru(3);
  for (let i = 0; i < HEX_N; i++) st.board.nums[i] = ru(4);
  st.board.robber = ru(5) - 1;
  for (let pi = 0; pi < PLAYERS; pi++) {
    const p = st.p[pi];
    for (let i = 0; i < 5; i++) p.res[i] = ru(4);
    for (let i = 0; i < 4; i++) p.dev[i] = ru(4);
    p.vpCards = ru(3);
    p.knights = ru(3);
    p.devBlocked = ru(1) === 1;
    const rn = ru(4);
    for (let i = 0; i < rn; i++) p.roads.push(ru(7));
    const sn = ru(4);
    for (let i = 0; i < sn; i++) p.settles.push(ru(6));
    const cn = ru(4);
    for (let i = 0; i < cn; i++) p.cities.push(ru(6));
  }
  return st;
}

/* ── AI ─────────────────────────────────────────────────── */
function aiScoreVertex(v) {
  let sc = 0;
  for (const h of vHex[v]) {
    const n = S.board.nums[h];
    if (n) { sc += n; if (S.board.types[h] === 0 || S.board.types[h] === 1) sc += 2; }
  }
  return sc;
}
function aiBestSettlement(pi) {
  let best = -1, bestV = -1;
  for (let v = 0; v < verts.length; v++) {
    if (!legalSettlementVertex(v, pi, false)) continue;
    const sc = aiScoreVertex(v);
    if (sc > best) { best = sc; bestV = v; }
  }
  return bestV;
}
function aiBestCity(pi) {
  let best = -1, bestV = -1;
  for (const v of S.p[pi].settles) {
    let sc = 0;
    for (const h of vHex[v]) sc += S.board.nums[h] || 0;
    if (sc > best) { best = sc; bestV = v; }
  }
  return bestV;
}
function aiBestRoad(pi) {
  let best = -1, bestE = -1;
  for (let e = 0; e < edges.length; e++) {
    if (!legalRoadEdge(e, pi, false)) continue;
    let sc = 1;
    const [a, b] = edges[e];
    for (const v of [a, b]) sc += ownerOfVertex(v) === pi ? 8 : aiScoreVertex(v) * 0.4;
    if (sc > best) { best = sc; bestE = e; }
  }
  return bestE;
}
function aiPickRobberHex(pi) {
  let best = -1, bestH = -1;
  for (let h = 0; h < HEX_N; h++) {
    if (h === S.board.robber) continue;
    let sc = S.board.nums[h] || 0;
    for (let q = 0; q < PLAYERS; q++) if (q !== pi && hasBuildingAtHex(q, h) && handCount(q) > 0) sc += 30;
    if (sc > best) { best = sc; bestH = h; }
  }
  return bestH;
}
function aiSetupMove() {
  const pi = S.active;
  let best = -1, bestV = -1;
  for (let v = 0; v < verts.length; v++) {
    if (!legalSettlementVertex(v, pi, true)) continue;
    const sc = aiScoreVertex(v);
    if (sc > best) { best = sc; bestV = v; }
  }
  if (bestV === -1) return;
  doBuildSettlement(pi, bestV);
  let bestE = -1, bestRS = -1;
  for (const e of vEdges[bestV]) {
    if (!legalRoadEdge(e, pi, true)) continue;
    const ov = edges[e][0] === bestV ? edges[e][1] : edges[e][0];
    const rs = aiScoreVertex(ov);
    if (rs > bestRS) { bestRS = rs; bestE = e; }
  }
  if (bestE !== -1) doBuildRoad(pi, bestE);
}
function aiNeedScore(pi, res) {
  let score = 0;
  if (S.p[pi].settles.length < 5 && !canAfford(pi, COSTS.settlement)) score += COSTS.settlement[RES_NAMES[res]] || 0;
  if (S.p[pi].settles.length) score += (COSTS.city[RES_NAMES[res]] || 0) * 2;
  if (S.p[pi].roads.length < 15) score += COSTS.road[RES_NAMES[res]] || 0;
  return score;
}
function aiAnyOppHands(pi) { for (let q = 0; q < PLAYERS; q++) if (q !== pi && handCount(q) > 0) return true; return false; }
function aiGameTurn() {
  const pi = S.phase === "discard" && S.discardTarget !== -1 ? S.discardTarget : S.active;
  const diff = (window.__bgn_ai_diff ? window.__bgn_ai_diff() : "normal");
  const sloppy = diff === "easy";
  if (S.phase === "roll") doRoll(pi);
  if (S.phase === "discard" && S.discardTarget === pi) {
    const rem = [0, 0, 0, 0, 0];
    let need = S.discardNeed;
    for (let i = 0; i < 5 && need > 0; i++) { const t = Math.min(S.p[pi].res[i], need); rem[i] = t; need -= t; }
    doDiscard(pi, rem);
  }
  if (S.phase === "rob" && S.robTarget === pi) {
    const h = aiPickRobberHex(pi);
    if (h !== -1) doRobberMove(pi, h);
  }
  if (S.phase !== "action") return;
  if (S.pendingDev) {
    const pd = S.pendingDev;
    if (pd.type === 1) { const r = aiBestRoad(pi); if (r !== -1) doBuildRoad(pi, r); else S.pendingDev = null; }
    else if (pd.type === 2) { let r = -1, b = 99; for (let j = 0; j < 5; j++) if (S.p[pi].res[j] < b) { b = S.p[pi].res[j]; r = j; } if (r !== -1) doPickYop(pi, r); else S.pendingDev = null; }
    else if (pd.type === 3) { let r = 0, b = -1; for (let j = 0; j < 5; j++) { let t = 0; for (let q = 0; q < PLAYERS; q++) if (q !== pi) t += S.p[q].res[j]; if (t > b) { b = t; r = j; } } doPickMono(pi, r); }
  }
  if (S.p[pi].dev[0] && !sloppy && aiAnyOppHands(pi)) {
    doPlayDev(pi, 0);
    if (S.pendingDev && S.pendingDev.type === 0) {
      const h = aiPickRobberHex(pi);
      if (h !== -1) doRobberMove(pi, h);
      else S.pendingDev = null;
    }
  }
  let budget = 14;
  while (budget-- > 0 && S.phase === "action" && !S.ended) {
    if (S.pendingDev) {
      const pd = S.pendingDev;
      if (pd.type === 1) { const r = aiBestRoad(pi); if (r === -1) S.pendingDev = null; else doBuildRoad(pi, r); }
      else if (pd.type === 2) { let r = -1, b = 99; for (let j = 0; j < 5; j++) if (S.p[pi].res[j] < b) { b = S.p[pi].res[j]; r = j; } if (r !== -1) doPickYop(pi, r); else S.pendingDev = null; }
      else if (pd.type === 3) { let r = 0, b = -1; for (let j = 0; j < 5; j++) { let t = 0; for (let q = 0; q < PLAYERS; q++) if (q !== pi) t += S.p[q].res[j]; if (t > b) { b = t; r = j; } } doPickMono(pi, r); }
      continue;
    }
    if (sloppy && Math.random() < 0.35) break;
    if (canAfford(pi, COSTS.city) && S.p[pi].settles.length) { const v = aiBestCity(pi); if (v !== -1) { doBuildCity(pi, v); continue; } }
    if (canAfford(pi, COSTS.settlement) && S.p[pi].settles.length < 5) { const v = aiBestSettlement(pi); if (v !== -1) { doBuildSettlement(pi, v); continue; } }
    if (canAfford(pi, COSTS.road) && S.p[pi].roads.length < 15) { const r = aiBestRoad(pi); if (r !== -1) { doBuildRoad(pi, r); continue; } }
    if (!sloppy && canAfford(pi, COSTS.dev) && deckLeft > 0) { doBuyDev(pi); continue; }
    let traded = false;
    for (let i = 0; i < 5; i++) {
      if (S.p[pi].res[i] >= 4) {
        let take = -1, b = 99;
        for (let j = 0; j < 5; j++) {
          if (j === i) continue;
          const need = aiNeedScore(pi, j);
          if (need < b) { b = need; take = j; }
        }
        if (take !== -1) { doTrade(pi, i, take); traded = true; break; }
      }
    }
    if (!traded) break;
  }
  if (S.phase === "action" && !S.ended) endTurn(pi);
}
function aiTurn() {
  if (!S || S.ended) return;
  const prev = identity.me;
  identity.me = S.active;
  try {
    if (S.phase === "setup") { if (setupActor() !== 0) aiSetupMove(); return; }
    aiGameTurn();
  } finally {
    identity.me = prev;
  }
}

/* ── rendering ──────────────────────────────────────────── */
function boardBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of verts) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); }
  return { x0, y0, x1, y1 };
}
function computeDims() {
  const bb = boardBounds();
  const margin = 62;
  canvasW = bb.x1 - bb.x0 + margin * 2;
  canvasH = bb.y1 - bb.y0 + margin * 2;
  return bb;
}
function draw() {
  if (!canvas || !ctx || !S) return;
  const bb = computeDims();
  const cw = canvas.width / (dpr || 1), ch = canvas.height / (dpr || 1);
  const scale = Math.min(cw / canvasW, ch / canvasH);
  ctx.setTransform(scale * (dpr || 1), 0, 0, scale * (dpr || 1), 0, 0);
  ctx.clearRect(0, 0, cw / scale, ch / scale);
  const cx = cw / scale / 2, cy = ch / scale / 2;
  ctx.translate(cx - bb.x0 - (bb.x1 - bb.x0) / 2, cy - bb.y0 - (bb.y1 - bb.y0) / 2);
  // sea
  ctx.fillStyle = "#1b5e86";
  ctx.fillRect(bb.x0 - 36, bb.y0 - 36, bb.x1 - bb.x0 + 72, bb.y1 - bb.y0 + 72);
  ctx.fillStyle = "rgba(255,255,255,.06)";
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(bb.x0 - 22 + ((i * 53) % (bb.x1 - bb.x0 + 44)), bb.y0 - 14 + ((i * 97) % (bb.y1 - bb.y0 + 28)), 5, 0, 7); ctx.fill(); }
  // hexes
  for (let h = 0; h < HEX_N; h++) drawHex(h, S.board.robber === h);
  for (let h = 0; h < HEX_N; h++) if (S.board.nums[h]) drawPip(h);
  for (let pi = 0; pi < PLAYERS; pi++) for (const e of S.p[pi].roads) drawRoad(e, pi);
  for (let pi = 0; pi < PLAYERS; pi++) {
    for (const v of S.p[pi].settles) drawBuilding(v, pi, false);
    for (const v of S.p[pi].cities) drawBuilding(v, pi, true);
  }
  if (S.board.robber >= 0) drawRobber(S.board.robber);
  drawSelection();
}
function drawHex(h, robbed) {
  const c = hexes[h];
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (30 + 60 * k) * Math.PI / 180;
    const x = c.x + HEX_S * Math.cos(a), y = c.y + HEX_S * Math.sin(a);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = robbed ? "#5a5a5a" : TERRAIN_COLOR[TERRAIN[S.board.types[h]]];
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,.45)";
  ctx.stroke();
  ctx.fillStyle = robbed ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.30)";
  ctx.font = HEX_S * 0.58 + "px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(TERRAIN_EMOJI[TERRAIN[S.board.types[h]]], c.x, c.y + HEX_S * 0.32);
}
function drawPip(h) {
  const c = hexes[h];
  const r = HEX_S * 0.42;
  const n = S.board.nums[h];
  const hot = n === 6 || n === 8;
  ctx.beginPath();
  ctx.arc(c.x, c.y - HEX_S * 0.1, r, 0, Math.PI * 2);
  ctx.fillStyle = hot ? "#ffece4" : "#f7f2e4";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = hot ? "#c0392b" : "#a8862a";
  ctx.stroke();
  ctx.fillStyle = hot ? "#c0392b" : "#5b4a12";
  ctx.font = "bold " + (r * 1.15) + "px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(n, c.x, c.y - HEX_S * 0.1);
  if (hot) {
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.arc(c.x - r * 0.48, c.y - HEX_S * 0.1 + r * 1.25, r * 0.1, 0, 7);
    ctx.arc(c.x + r * 0.48, c.y - HEX_S * 0.1 + r * 1.25, r * 0.1, 0, 7);
    ctx.fill();
  }
}
function drawRoad(e, pi) {
  const [a, b] = edges[e];
  const va = verts[a], vb = verts[b];
  const dx = vb.x - va.x, dy = vb.y - va.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = 7;
  ctx.strokeStyle = P_COLOR[pi];
  ctx.lineCap = "round";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(va.x - dy / len * off + dx * 0.06, va.y + dx / len * off + dy * 0.06);
  ctx.lineTo(vb.x - dy / len * off - dx * 0.06, vb.y + dx / len * off - dy * 0.06);
  ctx.stroke();
}
function drawBuilding(v, pi, city) {
  const p = verts[v];
  const s = city ? 15 : 10;
  ctx.fillStyle = P_COLOR[pi];
  ctx.strokeStyle = P_COLOR_DARK[pi];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - s * 1.2);
  ctx.lineTo(p.x + s, p.y - s * 0.3);
  ctx.lineTo(p.x + s, p.y + s * 0.9);
  ctx.lineTo(p.x - s, p.y + s * 0.9);
  ctx.lineTo(p.x - s, p.y - s * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (city) {
    ctx.beginPath();
    ctx.rect(p.x - s * 0.55, p.y - s * 1.9, s * 1.1, s * 0.9);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.55, p.y - s * 1.9);
    ctx.lineTo(p.x, p.y - s * 2.45);
    ctx.lineTo(p.x + s * 0.55, p.y - s * 1.9);
    ctx.fill();
    ctx.stroke();
  }
}
function drawRobber(h) {
  const c = hexes[h];
  const r = HEX_S * 0.5;
  ctx.fillStyle = "#151515";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y + HEX_S * 0.32, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x, c.y + HEX_S * 0.32 - r * 0.62);
  ctx.lineTo(c.x - r * 0.36, c.y + HEX_S * 0.32 - r * 1.2);
  ctx.lineTo(c.x + r * 0.36, c.y + HEX_S * 0.32 - r * 1.2);
  ctx.closePath();
  ctx.fillStyle = "#151515";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c.x, c.y + HEX_S * 0.32, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = "#e8c96a";
  ctx.fill();
}
function drawSelection() {
  if (!sel) return;
  if (sel.mode === "settlement") drawHintVerts();
  else if (sel.mode === "city") drawHintVerts();
  else if (sel.mode === "road") drawHintEdges();
  else if (sel.v !== undefined && !sel.roadDone) {
    const p = verts[sel.v];
    ctx.fillStyle = "rgba(255,255,255,.7)";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.font = "bold 13px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("place road", p.x, p.y + 3);
  }
}
function drawHintVerts() {
  const pi = uiActor();
  const city = sel.mode === "city";
  for (let v = 0; v < verts.length; v++) {
    const legal = city ? S.p[pi].settles.indexOf(v) !== -1 : legalSettlementVertex(v, pi, false);
    if (!legal) continue;
    const p = verts[v];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = city ? "#ffd54f" : "rgba(255,255,255,.75)";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
function drawHintEdges() {
  const pi = uiActor();
  for (let e = 0; e < edges.length; e++) {
    if (!legalRoadEdge(e, pi, false)) continue;
    const [a, b] = edges[e];
    const va = verts[a], vb = verts[b];
    const mx = (va.x + vb.x) / 2, my = (va.y + vb.y) / 2;
    const dx = vb.x - va.x, dy = vb.y - va.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(mx - dx / len * 18, my - dy / len * 18);
    ctx.lineTo(mx + dx / len * 18, my + dy / len * 18);
    ctx.stroke();
  }
}

/* ── interaction ────────────────────────────────────────── */
function canvasPos(ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}
function toBoard(p) {
  const bb = computeDims();
  const cw = canvas.width / (dpr || 1), ch = canvas.height / (dpr || 1);
  const scale = Math.min(cw / canvasW, ch / canvasH);
  const cx = cw / scale / 2, cy = ch / scale / 2;
  const ox = cx - bb.x0 - (bb.x1 - bb.x0) / 2;
  const oy = cy - bb.y0 - (bb.y1 - bb.y0) / 2;
  return { x: p.x / scale - ox, y: p.y / scale - oy };
}
function hitVertex(bp, tol) {
  let best = -1, bestD = tol;
  for (let v = 0; v < verts.length; v++) {
    const d = Math.hypot(verts[v].x - bp.x, verts[v].y - bp.y);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}
function hitEdge(bp, tol) {
  let best = -1, bestD = tol;
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e];
    const d = Math.hypot((verts[a].x + verts[b].x) / 2 - bp.x, (verts[a].y + verts[b].y) / 2 - bp.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
function hitHex(bp) {
  for (let h = 0; h < HEX_N; h++) if (Math.hypot(hexes[h].x - bp.x, hexes[h].y - bp.y) < HEX_S * 0.78) return h;
  return -1;
}
function onClick(ev) {
  if (!S || S.ended) return;
  const bp = toBoard(canvasPos(ev));
  if (S.phase === "rob" && uiActor() === me()) {
    const h = hitHex(bp);
    if (h !== -1 && h !== S.board.robber && doRobberMove(me(), h)) { requestCommit(); uiUpdate(); }
    return;
  }
  if (S.phase === "setup") {
    const pi = uiActor();
    if (setupActor() !== pi) return;
    if (!sel || sel.roadDone) {
      const v = hitVertex(bp, 20);
      if (v !== -1 && doBuildSettlement(pi, v)) { uiUpdate(); }
    } else {
      const e = hitEdge(bp, 20);
      if (e !== -1 && doBuildRoad(pi, e)) { requestCommit(); uiUpdate(); }
    }
    return;
  }
  if (S.phase !== "action") return;
  const pi = uiActor();
  if (!uiCanInteract()) return;
  if (S.pendingDev) {
    const pd = S.pendingDev;
    if (pd.type === 1) { const e = hitEdge(bp, 20); if (e !== -1 && doBuildRoad(pi, e)) { requestCommit(); uiUpdate(); } }
    else if (pd.type === 0) { const h = hitHex(bp); if (h !== -1 && h !== S.board.robber && doRobberMove(pi, h)) { requestCommit(); uiUpdate(); } }
    return;
  }
  if (!sel) return;
  if (sel.mode === "road") {
    const e = hitEdge(bp, 20);
    if (e !== -1 && doBuildRoad(pi, e)) { sel = null; requestCommit(); uiUpdate(); }
  } else if (sel.mode === "settlement" || sel.mode === "city") {
    const v = hitVertex(bp, 20);
    if (v !== -1 && (sel.mode === "settlement" ? doBuildSettlement(pi, v) : doBuildCity(pi, v))) { sel = null; requestCommit(); uiUpdate(); }
  }
}
function setSelect(mode) {
  if (!S || S.ended || S.phase !== "action" || !uiCanInteract() || S.pendingDev) return;
  sel = { mode };
  uiUpdate();
}
function cancelSelect() { sel = null; uiUpdate(); }
function requestCommit() { if (hooks.requestCommit) hooks.requestCommit(); }

/* ── UI ─────────────────────────────────────────────────── */
let els = {};
function el(id) { return els[id] || (els[id] = document.getElementById(id)); }
function uiUpdate() {
  if (!S) return;
  ensureCanvasVisible();
  draw();
  updateResBar();
  updateDevBar();
  updateActionButtons();
  const de = el("diceEl");
  if (de) de.textContent = S.dice ? "🎲 " + S.dice[0] + " + " + S.dice[1] + " = " + (S.dice[0] + S.dice[1]) : "";
  if (S.phase === "discard" && !discardOpen && (identity.mode === "local" || S.discardTarget === me())) openDiscardUI();
  if (hooks.chrome) hooks.chrome();
}
function resChips(pi) {
  return RES_NAMES.map((name, i) => '<span class="res-chip"><span class="res-ico">' + RES_EMOJI[name] + '</span><b>' + S.p[pi].res[i] + '</b></span>').join("");
}
function handRow(pi, countOnly) {
  const label = '<span class="hand-label" style="color:' + P_COLOR[pi] + '">' + P_NAME[pi] + "</span>";
  return '<div class="catan-hand">' + label + (countOnly ? "<b>" + handCount(pi) + "</b> cards" : resChips(pi)) + "</div>";
}
function updateResBar() {
  const my = el("myResEl"), opp = el("oppResEl");
  if (!my) return;
  if (identity.mode === "local") {
    my.innerHTML = handRow(0) + handRow(1);
    if (opp) opp.innerHTML = handRow(2) + handRow(3);
  } else {
    const pi = me();
    my.innerHTML = handRow(pi);
    let o = "";
    for (let q = 0; q < PLAYERS; q++) if (q !== pi) o += handRow(q, true);
    if (opp) opp.innerHTML = o;
  }
}
function vpTag(pi) {
  return '<span style="color:' + P_COLOR[pi] + '">' + P_NAME[pi] + ": " + totalVp(pi) + " VP" + (armyVp(pi) ? " ⚔️" : "") + (roadVp(pi) ? " 🛤️" : "") + "</span>";
}
function updateDevBar() {
  const mine = el("myDevEl");
  if (mine) {
    const pi = identity.mode === "local" ? uiActor() : me();
    const p = S.p[pi];
    mine.innerHTML = '<span class="hand-label" style="color:' + P_COLOR[pi] + '">' + P_NAME[pi] + " dev</span>"
      + ['<span class="dev-chip' + (p.dev[0] ? "" : " empty") + '">⚔️' + p.dev[0] + "</span>",
        '<span class="dev-chip' + (p.dev[1] ? "" : " empty") + '">🛤️' + p.dev[1] + "</span>",
        '<span class="dev-chip' + (p.dev[2] ? "" : " empty") + '">🎁' + p.dev[2] + "</span>",
        '<span class="dev-chip' + (p.dev[3] ? "" : " empty") + '">🃏' + p.dev[3] + "</span>",
        '<span class="dev-chip vp">⭐' + p.vpCards + "</span>"].join("");
  }
  const mv = el("myVpEl"), ov = el("oppVpEl");
  if (mv && ov) {
    if (identity.mode === "local") {
      mv.innerHTML = vpTag(0) + vpTag(1);
      ov.innerHTML = vpTag(2) + vpTag(3);
    } else {
      const pi = me();
      mv.innerHTML = '<span style="color:' + P_COLOR[pi] + '">You: ' + totalVp(pi) + " VP" + (armyVp(pi) ? " ⚔️" : "") + (roadVp(pi) ? " 🛤️" : "") + "</span>";
      let o = "";
      for (let q = 0; q < PLAYERS; q++) if (q !== pi) o += vpTag(q);
      ov.innerHTML = o;
    }
  }
}
function updateActionButtons() {
  const r = el("rollBtn"), rd = el("roadBtn"), st = el("settleBtn"), ct = el("cityBtn"),
    dv = el("devBtn"), tr = el("tradeBtn"), cn = el("cancelBtn");
  const pi = uiActor();
  const interact = uiCanInteract();
  const act = S.phase === "action" && interact;
  const show = (x, v, dis) => { if (x) { x.style.display = v ? "" : "none"; x.disabled = !!dis; } };
  show(r, S.phase === "roll" && interact, !interact);
  show(rd, act && !S.pendingDev, !canAfford(pi, COSTS.road));
  show(st, act && !S.pendingDev, !canAfford(pi, COSTS.settlement));
  show(ct, act && !S.pendingDev, !S.p[pi].settles.length || !canAfford(pi, COSTS.city));
  show(dv, act && !S.pendingDev, !canAfford(pi, COSTS.dev));
  show(tr, act && !S.pendingDev, false);
  show(cn, !!sel && act, false);
  const pk = el("playKnightBtn"), pr = el("playRoadBtn"), py = el("playYopBtn"), pm = el("playMonoBtn");
  show(pk, act && !S.pendingDev, !S.p[pi].dev[0] || S.p[pi].devBlocked);
  show(pr, act && !S.pendingDev, !S.p[pi].dev[1] || S.p[pi].devBlocked);
  show(py, act && !S.pendingDev, !S.p[pi].dev[2] || S.p[pi].devBlocked);
  show(pm, act && !S.pendingDev, !S.p[pi].dev[3] || S.p[pi].devBlocked);
}

/* ── discard / trade / picker overlays ──────────────────── */
function overlay() { return { ov: el("catanOverlay"), body: el("catanOverlayBody") }; }
function monoCount(pi, res) { let n = 0; for (let q = 0; q < PLAYERS; q++) if (q !== pi) n += S.p[q].res[res]; return n; }
function openDiscardUI() {
  const { ov, body } = overlay();
  if (!ov || !body) return;
  const pi = S.discardTarget;
  const p = S.p[pi];
  const chosen = [0, 0, 0, 0, 0];
  const paint = () => {
    const rem = Math.max(0, S.discardNeed - chosen.reduce((a, b) => a + b, 0));
    body.innerHTML = "<p class='catan-modal-title'>Discard " + S.discardNeed + " card" + (S.discardNeed > 1 ? "s" : "") + " (" + P_NAME[pi] + ")</p>"
      + "<p class='muted small'>Click resources to remove — " + rem + " left to discard.</p>"
      + '<div class="discard-grid">' + RES_NAMES.map((name, i) => {
        const used = chosen[i];
        const max = p.res[i] - used + (rem > 0 ? 1 : 0);
        return '<button class="discard-card' + (used ? " chosen" : "") + '" data-i="' + i + '"' + (max <= 0 ? " disabled" : "") + '>'
          + RES_EMOJI[name] + " " + name + " <b>" + (p.res[i] - used) + "</b>" + (used ? " <span>(−" + used + ")</span>" : "") + "</button>";
      }).join("")
      + '<div class="discard-actions"><button class="btn btn-ghost" id="discardCancelBtn">Cancel</button>'
      + '<button class="btn btn-gold" id="discardOkBtn"' + (rem > 0 ? " disabled" : "") + '>Discard</button></div>';
    body.querySelectorAll(".discard-card").forEach((b2) => {
      b2.addEventListener("click", () => {
        const i = +b2.dataset.i;
        const total = chosen.reduce((a, b) => a + b, 0);
        if (chosen[i] > 0) chosen[i]--;
        else if (total < S.discardNeed && chosen[i] < p.res[i]) chosen[i]++;
        paint();
      });
    });
    const ok = body.querySelector("#discardOkBtn");
    if (ok) ok.addEventListener("click", () => {
      if (rem > 0) return;
      ov.hidden = true;
      discardOpen = false;
      doDiscard(pi, chosen);
      hooks.sfx && hooks.sfx("flip");
      requestCommit();
      uiUpdate();
    });
    const cn = body.querySelector("#discardCancelBtn");
    if (cn) cn.addEventListener("click", () => { ov.hidden = true; discardOpen = false; });
  };
  ov.hidden = false;
  discardOpen = true;
  paint();
}
function openTradeUI() {
  const { ov, body } = overlay();
  if (!ov || !body) return;
  const pi = uiActor();
  const p = S.p[pi];
  const giveable = RES_NAMES.map((n, i) => i).filter((i) => p.res[i] >= 4);
  const opts = (list) => list.map((r) => '<option value="' + r + '">' + RES_EMOJI[RES_NAMES[r]] + " " + RES_NAMES[r] + "</option>").join("");
  body.innerHTML = "<p class='catan-modal-title'>Bank trade — 4:1</p>"
    + "<p class='muted small'>Give 4 of one resource for 1 of another. (Ports aren't in this 2-player version.)</p>"
    + "<div class='trade-row'><span>Give 4 ×</span>" + (giveable.length ? '<select id="giveSel">' + opts(giveable) + "</select>" : "<b class='muted'>you need 4 of a resource to trade</b>") + "</div>"
    + "<div class='trade-row'><span>Receive 1 ×</span><select id='takeSel'>" + opts([0, 1, 2, 3, 4]) + "</select></div>"
    + '<div class="discard-actions"><button class="btn btn-ghost" id="tradeCancelBtn">Cancel</button>'
    + '<button class="btn btn-gold" id="tradeOkBtn"' + (giveable.length ? "" : " disabled") + '>Trade</button></div>';
  const ok = body.querySelector("#tradeOkBtn");
  if (ok) ok.addEventListener("click", () => {
    ov.hidden = true;
    doTrade(pi, +body.querySelector("#giveSel").value, +body.querySelector("#takeSel").value);
    requestCommit();
    uiUpdate();
  });
  const cn = body.querySelector("#tradeCancelBtn");
  if (cn) cn.addEventListener("click", () => { ov.hidden = true; });
  ov.hidden = false;
}
function openResPicker() {
  const { ov, body } = overlay();
  if (!ov || !body || !S.pendingDev) return;
  const pi = uiActor();
  const pd = S.pendingDev;
  const pick = pd.type === 2;
  body.innerHTML = "<p class='catan-modal-title'>" + (pick ? "Year of Plenty — pick " + pd.n + " resource(s)" : "Monopoly — pick a resource to take") + "</p>"
    + '<div class="discard-grid">' + RES_NAMES.map((name, i) =>
      '<button class="discard-card respick" data-i="' + i + '">' + RES_EMOJI[name] + " " + name + (pick ? "" : " <span class='muted'>(rivals: " + monoCount(pi, i) + ")</span>") + "</button>").join("") + "</div>"
    + '<div class="discard-actions"><button class="btn btn-ghost" id="tradeCancelBtn">' + (pick ? "Done" : "Cancel") + "</button></div>";
  body.querySelectorAll(".respick").forEach((b2) => {
    b2.addEventListener("click", () => {
      const i = +b2.dataset.i;
      if (pick) { doPickYop(pi, i); if (!S.pendingDev) ov.hidden = true; }
      else { doPickMono(pi, i); ov.hidden = true; }
      requestCommit();
      uiUpdate();
    });
  });
  const cn = body.querySelector("#tradeCancelBtn");
  if (cn) cn.addEventListener("click", () => { if (pick) S.pendingDev = null; ov.hidden = true; uiUpdate(); });
  ov.hidden = false;
}

/* ── lifecycle ──────────────────────────────────────────── */
let firstRoller = 0;   // the seat (0-3) whose turn starts the main game after setup
function setFirst(pi) { firstRoller = (typeof pi === "number" && pi >= 0 && pi < PLAYERS) ? pi : 0; if (S) S.first = firstRoller; }
function newGame() {
  S = freshState();
  S.first = firstRoller;
  S.board = genBoard();
  sel = null;
  discardOpen = false;
  resetDeck();
  deckLeft = 25;
  const ov = el("catanOverlay"); if (ov) ov.hidden = true;
  uiUpdate();
}
function applySnapshot(str, quiet) {
  const st = deserialize(str);
  if (!st) return false;
  S = st;
  sel = null;
  discardOpen = false;
  const ov = el("catanOverlay"); if (ov) ov.hidden = true;
  deckLeft = Math.max(0, 25 - devCount(0) - devCount(1));
  uiUpdate();
  return true;
}
function resizeCanvas() {
  if (!canvas) return;
  computeDims();
  const parent = canvas.parentElement;
  const availW = (parent ? parent.clientWidth : 0) || 640;
  const availH = parent ? parent.clientHeight : 0;
  dpr = window.devicePixelRatio || 1;
  const isFs = !!(window.bgnFullscreen && window.bgnFullscreen.isOpen && window.bgnFullscreen.isOpen());
  let cssW, cssH;
  if (isFs && availH > 0) {
    cssW = availW; cssH = availH;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
  } else {
    cssW = Math.min(availW, canvasW);
    cssH = cssW * (canvasH / canvasW);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
  }
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  draw();
}
function ensureCanvasVisible() {
  if (!canvas) return;
  const w = canvas.getBoundingClientRect().width;
  const pw = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
  if (w < 50 && pw > 50) resizeCanvas();
}
function setIdentity(mode, meIdx) { identity.mode = mode; identity.me = meIdx; }

function init() {
  canvas = document.getElementById("catanCanvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  const bind = (id, fn) => { const e = document.getElementById(id); if (e) e.addEventListener("click", fn); };
  bind("rollBtn", () => { if (doRoll(uiActor())) { requestCommit(); uiUpdate(); } });
  bind("roadBtn", () => setSelect("road"));
  bind("settleBtn", () => setSelect("settlement"));
  bind("cityBtn", () => setSelect("city"));
  bind("devBtn", () => { if (doBuyDev(uiActor())) { requestCommit(); uiUpdate(); } });
  bind("tradeBtn", openTradeUI);
  bind("cancelBtn", cancelSelect);
  bind("playKnightBtn", () => { if (doPlayDev(uiActor(), 0)) { requestCommit(); uiUpdate(); } });
  bind("playRoadBtn", () => { if (doPlayDev(uiActor(), 1)) { sel = { mode: "road" }; requestCommit(); uiUpdate(); } });
  bind("playYopBtn", () => { if (doPlayDev(uiActor(), 2)) { openResPicker(); requestCommit(); uiUpdate(); } });
  bind("playMonoBtn", () => { if (doPlayDev(uiActor(), 3)) { openResPicker(); requestCommit(); uiUpdate(); } });
  canvas.addEventListener("pointerdown", onClick);
  window.addEventListener("resize", () => { if (rafQueued) return; rafQueued = true; requestAnimationFrame(() => { rafQueued = false; resizeCanvas(); }); });
  resizeCanvas();
}

window.CatanGame = {
  init, newGame, serialize, deserialize, applySnapshot, pass, uiUpdate, draw, resizeCanvas,
  setIdentity, setFirst, setHooks: (h) => Object.assign(hooks, h),
  isMyAction, isBotTurn, uiCanInteract, turnLabel, bannerText, phase: () => S ? S.phase : null,
  active: () => S ? S.active : -1, isOver: () => !!(S && S.ended), getWinner: () => S && S.ended ? S.winner : -1,
  getState: () => S, setSelect, cancelSelect, openDiscardUI, openTradeUI, openResPicker, aiTurn,
  totalVp, longestRoad, handCount, deckLeft, uiActor,
  constants: { RES_NAMES, RES_EMOJI, P_NAME, P_COLOR, WIN_VP },
  _test: { doBuildSettlement, doBuildRoad, doRoll, doDiscard, doRobberMove, doBuildCity, doBuyDev, doPlayDev, doPickYop, doPickMono, doTrade, endTurn, setupActor, uiActor, legalSettlementVertex, legalRoadEdge, canAfford, handCount, genBoard, serialize, deserialize, vEdges, edges, verts, vHex, hexes, HEX_N, getSel: () => sel, getIdentity: () => identity, canAct },
};
})();
