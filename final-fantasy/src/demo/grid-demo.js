// Dev demo harness for Tasks #1, #2 & #12: grid movement, layered map
// rendering, and NPC patrol/idle behaviors.
// Loaded automatically with the page; launch via window.startGridDemo()
// or by opening the generator with ?demo=grid.

import { TileMap, DIRS } from "../engine/grid.js";
import { GridEntity, MovementSystem } from "../engine/movement.js";
import { MapRenderer } from "../engine/renderer.js";
import { NpcController } from "../engine/npc.js";

const CELL = 40;
const START = { x: 7, y: 5 };
const ROWS = [
  "##############",
  "#............#",
  "#....##......#",
  "#....##......#",
  "#............#",
  "#......@.....#",
  "#............#",
  "##############",
];
const OVERHEAD = [
  "##############",
  "#..........TT#",
  "#..........TT#",
  "#............#",
  "#............#",
  "#............#",
  "#............#",
  "##############",
];

let map = null;
let sys = null;
let hero = null;
let npc = null;
let npcController = null;
let canvas = null;
let ctx = null;
let statusEl = null;
let renderer = null;
let tickTimer = null;

function build() {
  map = TileMap.fromAscii(ROWS, {
    tiles: { "#": 1 },
    overhead: OVERHEAD,
    overheadTiles: { T: 4 },
  });
  renderer = new MapRenderer({ tileSize: CELL, palette: { 0: "#10142a", 1: "#39456e", 4: "#2a7a3a" } });
  sys = new MovementSystem(map);
  hero = new GridEntity(START.x, START.y, { facing: "N", id: "hero" });
  npc = new GridEntity(2, 4, { facing: "S", id: "npc" });
  sys.addEntity(hero);
  sys.addEntity(npc);
  npcController = new NpcController(sys, npc, {
    type: "patrol",
    waypoints: [{ x: 2, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 6 }, { x: 2, y: 6 }],
    pauseAtWaypoint: 1,
  });
  mount();
  Object.assign(window.gridDemo, { map, sys, hero, npc, npcController, render, reset });
}

function mount() {
  if (document.getElementById("gridDemo")) return;
  const style = document.createElement("style");
  style.textContent = `
    #gridDemo { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: #05060f; z-index: 10; }
    #gridDemo canvas { border: 2px solid #39456e; image-rendering: pixelated; }
    #gridDemo .status { color: #aebff0; font-family: monospace; font-size: 14px; }
    #gridDemo .resetBtn { background: #1b2440; color: #cfe0ff; border: 1px solid #39456e; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-family: monospace; }
    #gridDemo .resetBtn:hover { background: #2a3b6e; }
  `;
  document.head.appendChild(style);
  const el = document.createElement("div");
  el.id = "gridDemo";
  el.hidden = true;
  el.innerHTML = `
    <canvas id="gridDemoCanvas" width="${map.width * CELL}" height="${map.height * CELL}"></canvas>
    <div class="status" id="gridDemoStatus">Arrows / WASD to move &middot; R to reset &middot; blue NPC patrols</div>
    <button class="resetBtn" id="gridDemoReset">Reset</button>
  `;
  document.body.appendChild(el);
  canvas = el.querySelector("canvas");
  ctx = canvas.getContext("2d");
  statusEl = el.querySelector(".status");
  el.querySelector(".resetBtn").addEventListener("click", reset);
  document.addEventListener("keydown", onKey);
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderer.renderAll(ctx, map, { x: 0, y: 0, w: map.width, h: map.height }, () => {
    for (const e of sys.entities) drawEntity(e);
  });
}

function drawEntity(e) {
  const isHero = e === hero;
  ctx.fillStyle = isHero ? "#ffd24a" : "#6fb7ff";
  ctx.fillRect(e.x * CELL + 5, e.y * CELL + 5, CELL - 10, CELL - 10);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  const cx = e.x * CELL + CELL / 2;
  const cy = e.y * CELL + CELL / 2;
  ctx.beginPath();
  if (e.facing === "N") { ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy - 8); }
  else if (e.facing === "S") { ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.lineTo(cx, cy + 8); }
  else if (e.facing === "E") { ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx + 8, cy); }
  else { ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx - 8, cy); }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = isHero ? "#3a2d00" : "#00314d";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(e.id.toUpperCase(), cx, e.y * CELL - 2);
}

function blockReason(dir) {
  const { dx, dy } = DIRS[dir];
  const tx = hero.x + dx;
  const ty = hero.y + dy;
  if (!map.canStand(tx, ty)) return "wall";
  const occ = sys.entityAt(tx, ty);
  return occ ? "blocked by " + occ.id : "unknown";
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}

function reset() {
  sys.removeEntity(hero);
  hero.x = START.x;
  hero.y = START.y;
  hero.facing = "N";
  sys.addEntity(hero);
  setStatus("Reset to start");
  render();
}

const KEYMAP = {
  ArrowUp: "N", ArrowDown: "S", ArrowLeft: "W", ArrowRight: "E",
  w: "N", s: "S", a: "W", d: "E",
};

function onKey(e) {
  const el = document.getElementById("gridDemo");
  if (!el || el.hidden) return;
  if (e.key.toLowerCase() === "r") { reset(); return; }
  const dir = KEYMAP[e.key];
  if (!dir) return;
  e.preventDefault();
  const moved = sys.move(hero, dir);
  npcController.update();
  setStatus(moved ? "Moved " + dir : "Blocked " + dir + " (" + blockReason(dir) + ")");
  render();
}

function tick() {
  if (!sys) return;
  npcController.update();
  render();
}

export function startGridDemo() {
  if (!sys) build();
  const title = document.getElementById("titleScreen");
  if (title) title.hidden = true;
  document.getElementById("gridDemo").hidden = false;
  render();
  if (!tickTimer) tickTimer = setInterval(tick, 600);
}

window.gridDemo = {};
window.startGridDemo = startGridDemo;

if (new URLSearchParams(location.search).get("demo") === "grid") {
  startGridDemo();
}
