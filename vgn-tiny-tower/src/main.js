import { Renderer } from "./render.js";
import * as E from "./engine.js";
import { BUSINESS_TYPES } from "./data.js";

const R = typeof root !== "undefined" ? root : window.root || window;

const canvas = document.getElementById("game");
const renderer = new Renderer(canvas);

const $ = (id) => document.getElementById(id);
const els = {
  coins: $("coinsEl"),
  bux: $("buxEl"),
  floors: $("floorsEl"),
  buildTiles: $("buildTiles"),
  defaultView: $("defaultView"),
  floorView: $("floorView"),
  floorBackBtn: $("floorBackBtn"),
  floorCtn: $("floorCtn"),
  waiting: $("waitingEl"),
  arrival: $("arrivalEl"),
  elevInfo: $("elevInfo"),
  upBtn: $("upBtn"),
  downBtn: $("downBtn"),
  summonBtn: $("summonBtn"),
  toastCtn: $("toastCtn"),
  boardOverlay: $("boardOverlay"),
  boardList: $("boardList"),
  boardBtn: $("boardBtn"),
  boardClose: $("boardCloseBtn"),
  nameInput: $("nameInput"),
  nameSave: $("nameSaveBtn"),
  online: $("onlineEl"),
};

let state = null;
let lastT = performance.now();
let saveAcc = 0;
let hudAcc = 0;
let selectedFloorId = null;
let socket = null;
let lbName = "";
let reconnectAttempt = 0;
let submitTimer = null;
let saving = false;

function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.floor(n).toString();
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  els.toastCtn.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 400);
  }, 2600);
}

function incomeRate(s) {
  let r = 0;
  for (const f of s.floors) {
    if (f.type === "residential") {
      r += E.CONFIG.rentBase * E.CONFIG.rentHappyMult * f.residents.length;
    } else {
      const matched = f.workers.filter((w) => {
        const b = E.byId(s, w);
        return b && b.dreamJob === f.businessType;
      }).length;
      r += E.CONFIG.sellRate * (1 + E.CONFIG.workerMult * matched) * E.unitValue(f);
    }
  }
  return r;
}

function offlineEarnings(s) {
  const now = Date.now();
  const elapsed = Math.min((now - (s.lastSeen || now)) / 1000, 2 * 3600);
  if (elapsed < 90) return 0;
  const earned = Math.round(incomeRate(s) * elapsed * 0.5);
  if (earned > 0) {
    s.coins += earned;
    s.dirty = true;
  }
  return earned;
}

function setPanel(which) {
  els.defaultView.hidden = which !== "default";
  els.floorView.hidden = which !== "floor";
}

function buildBuildTiles() {
  const kinds = [["residential", "🏠", "Residence"]];
  for (const [k, v] of Object.entries(BUSINESS_TYPES)) kinds.push([k, v.icon, v.label]);
  els.buildTiles.innerHTML = "";
  for (const [kind, icon, label] of kinds) {
    const b = document.createElement("button");
    b.className = "tile";
    const color = kind === "residential" ? "#f5a742" : BUSINESS_TYPES[kind].color;
    b.style.setProperty("--tile", color);
    b.innerHTML = `<span class="tile-icon">${icon}</span><span class="tile-label">${label}</span><span class="tile-cost"></span>`;
    b.onclick = () => buildFloor(kind);
    els.buildTiles.appendChild(b);
  }
}

function buildFloor(kind) {
  const res = E.buildFloor(state, kind);
  if (!res.ok) {
    toast("🪙 Not enough coins yet!");
    return;
  }
  const label = kind === "residential" ? "Residence" : BUSINESS_TYPES[kind].label;
  toast(`🏗 Built a new ${label} floor!`);
  if (selectedFloorId) closeFloorPanel();
  updateHUD();
  saveNow();
}

function openFloorPanel(index) {
  const f = state.floors[index - 1];
  if (!f) return;
  selectedFloorId = f.id;
  setPanel("floor");
  refreshFloorPanel();
}

function closeFloorPanel() {
  selectedFloorId = null;
  setPanel("default");
}

function refreshFloorPanel() {
  const f = state.floors.find((x) => x.id === selectedFloorId);
  if (!f) {
    closeFloorPanel();
    return;
  }
  const typeLabel = f.type === "residential" ? "Residence" : BUSINESS_TYPES[f.businessType].label;
  let html = "";
  html += `<div class="f-head"><span class="f-emoji">${f.type === "residential" ? "🏠" : BUSINESS_TYPES[f.businessType].icon}</span><div><div class="f-name">${esc(f.name || "Apartment")}</div><div class="f-sub">Floor ${f.index} · ${typeLabel}${f.type !== "residential" ? ` · Lv ${f.level}` : ""}</div></div></div>`;
  if (f.type === "residential") {
    html += `<div class="f-block-title">Residents (${f.residents.length}/${E.CONFIG.residentsPerFloor})</div>`;
    if (!f.residents.length) html += `<div class="f-empty">Deliver bitizens here via the elevator to start earning rent.</div>`;
    for (const rid of f.residents) {
      const b = E.byId(state, rid);
      if (!b) continue;
      const happy = b.favoriteColor === f.color;
      const job = b.workFloorId != null ? `<span class="badge">working</span>` : "";
      html += `<div class="res-row"><span class="res-avatar" style="background:${b.favoriteColor}"></span><div class="res-info"><div>${esc(b.name)} ${job}</div><div class="res-tags">💼 ${b.dreamJob} · 🍕 ${esc(b.favoriteFood)}</div></div>${happy ? `<span class="happy">😊 happy</span>` : ""}</div>`;
    }
  } else {
    const pct = Math.round((f.stock / f.capacity) * 100);
    html += `<div class="f-bar-row"><span>Stock</span><div class="f-bar"><div class="f-bar-fill" style="width:${pct}%"></div></div><span>${Math.round(f.stock)}/${f.capacity}</span></div>`;
    html += `<div class="f-actions"><button class="btn small" id="restockBtn">📦 Restock</button><button class="btn small" id="upgradeBtn">⬆ Upgrade 🪙${fmt(E.upgradeCost(f))}</button></div>`;
    html += `<div class="f-block-title">Workers (${f.workers.length}/${E.CONFIG.workersPerFloor})</div>`;
    for (const wid of f.workers) {
      const b = E.byId(state, wid);
      if (!b) continue;
      const match = b.dreamJob === f.businessType;
      html += `<div class="res-row"><span class="res-avatar" style="background:${b.favoriteColor}"></span><div class="res-info"><div>${esc(b.name)} <span class="badge ${match ? "gold" : ""}">${match ? "⭐ dream job" : "worker"}</span></div><div class="res-tags">💼 ${b.dreamJob}</div></div><button class="btn tiny danger" data-rm="${b.id}">✕</button></div>`;
    }
    if (f.workers.length < E.CONFIG.workersPerFloor) {
      html += `<button class="btn small ghost" id="addWorkerBtn">＋ Assign worker</button>`;
    }
  }
  els.floorCtn.innerHTML = html;
  els.floorCtn.querySelectorAll("[data-rm]").forEach((btn) => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      E.removeWorker(state, f.id, Number(btn.dataset.rm));
      refreshFloorPanel();
      saveNow();
    };
  });
  const rb = $("restockBtn");
  if (rb) rb.onclick = () => { E.restock(state, f.id); refreshFloorPanel(); toast("📦 Restocked!"); };
  const ub = $("upgradeBtn");
  if (ub) ub.onclick = () => {
    const r = E.upgrade(state, f.id);
    if (!r.ok) toast("🪙 Not enough coins!");
    else { toast("⬆ Business upgraded — more value per sale!"); refreshFloorPanel(); saveNow(); }
  };
  const aw = $("addWorkerBtn");
  if (aw) aw.onclick = () => {
    const r = E.assignBestWorker(state, f.id);
    if (!r.ok) toast("😴 No free residents to hire. Deliver more bitizens!");
    else { toast(`${r.bitizen.name} is now working here!`); refreshFloorPanel(); saveNow(); }
  };
}

function refreshLobbyInfo() {
  const n = state.lobby.length;
  els.waiting.textContent = `🚶 ${n} waiting`;
  els.arrival.textContent = n >= E.CONFIG.lobbyMax ? "(queue full)" : `next in ${Math.max(1, Math.ceil(state.nextArrival))}s`;
}

function updateHUD() {
  els.coins.textContent = `🪙 ${fmt(state.coins)}`;
  els.bux.textContent = `💎 ${state.bux}`;
  els.floors.textContent = `🏗 ${state.floors.length}`;
  const cost = E.floorCost(state);
  for (const t of els.buildTiles.children) {
    t.disabled = state.coins < cost;
    t.querySelector(".tile-cost").textContent = fmt(cost);
  }
  refreshLobbyInfo();
  const e = state.elevator;
  if (e.passengerId != null) {
    const b = E.byId(state, e.passengerId);
    const f = b && b.wantsFloorId != null ? E.floorById(state, b.wantsFloorId) : null;
    els.elevInfo.innerHTML = f ? `Deliver → <b>F${f.index}</b>` : "…";
  } else {
    els.elevInfo.textContent = "Idle";
  }
}

function boardPassenger(id) {
  const res = E.boardPassenger(state, id);
  if (!res.ok) {
    if (res.reason === "busy") toast("🚫 Elevator is busy delivering someone!");
    else if (res.reason === "noroom") toast("🏠 No room in any residence!");
    else toast("🚫 Can't board that bitizen.");
  } else {
    toast("🛗 Picking up " + (E.byId(state, id) ? E.byId(state, id).name : "") + "…");
    refreshLobbyInfo();
  }
}

function setElevatorTarget(f) {
  state.elevator.target = f;
  state.elevator.moving = true;
}

function nudge(d) {
  const e = state.elevator;
  const cur = e.moving ? e.target : e.floor;
  setElevatorTarget(Math.max(0, Math.min(state.floors.length, Math.round(cur) + d)));
}

function hold(el, fn) {
  let iv = null;
  const start = (ev) => {
    ev.preventDefault();
    fn();
    if (iv) clearInterval(iv);
    iv = setInterval(fn, 170);
  };
  const stop = () => {
    if (iv) { clearInterval(iv); iv = null; }
  };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointerleave", stop);
}

async function saveNow() {
  if (saving || !state) return;
  saving = true;
  try {
    state.lastSeen = Date.now();
    await R.kv.tinyTower.set("save", E.serialize(state));
    state.dirty = false;
  } catch (err) {
    console.warn("save failed", err);
  }
  saving = false;
}

function loop(t) {
  step(t, Math.min(0.05, Math.max(0.0001, (t - lastT) / 1000)));
  requestAnimationFrame(loop);
}

function step(t, dt) {
  lastT = t;
  E.tick(state, dt);
  renderer.updateEffects(dt);
  renderer.draw(state, t / 1000);
  hudAcc += dt;
  if (hudAcc > 0.25) {
    hudAcc = 0;
    updateHUD();
  }
  saveAcc += dt;
  if (saveAcc > 5) {
    saveAcc = 0;
    saveNow();
  }
  while (state.events.length) {
    const ev = state.events.shift();
    if (ev.type === "deliver") {
      const x = renderer.shaftX + renderer.shaftW / 2;
      const y = renderer.groundY - renderer.floorH * ev.floorIndex;
      toast(`✅ ${ev.bitizenName} moved in! +🪙${fmt(ev.pay)}${ev.bux ? " +💎1" : ""}`);
      renderer.addEffect(x, y - 24, `+${fmt(ev.pay)}`, "#ffd94d", 17);
      if (ev.bux) renderer.addEffect(x, y - 44, "+1 💎", "#8ee6ff", 15);
      if (selectedFloorId && ev.homeFloorId === selectedFloorId) refreshFloorPanel();
      refreshLobbyInfo();
    }
  }
}

setInterval(() => {
  if (!state) return;
  const now = performance.now();
  const dt = Math.min(5, Math.max(0.0001, (now - lastT) / 1000));
  if (dt < 0.05) return;
  step(now, dt);
}, 250);

function applyBoard(data) {
  let d;
  try {
    d = typeof data === "string" ? JSON.parse(data) : data;
  } catch (err) {
    return;
  }
  const entries = Array.isArray(d.entries) ? d.entries : [];
  if (!entries.length) {
    els.boardList.innerHTML = `<div class="f-empty">No towers yet — build yours!</div>`;
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  const rows = entries.slice(0, 10).map((en, i) => {
    const rank = medals[i] || (i + 1);
    return `<div class="lb-row"><span class="lb-rank">${rank}</span><span class="lb-name">${esc(en.n)}</span><span class="lb-floors">🏗 ${en.f}</span><span class="lb-coins">🪙 ${fmt(en.c)}</span></div>`;
  }).join("");
  els.boardList.innerHTML = rows;
}

function setOnline(n) {
  els.online.textContent = n > 0 ? `🟢 ${n} online` : "";
}

function submitScore() {
  if (!socket || !state || socket.readyState !== 1) return;
  try {
    socket.rpc.submit(JSON.stringify({ name: lbName, floors: state.floors.length, coins: Math.round(state.coins) }))
      .then(applyBoard)
      .catch(() => {});
  } catch (err) {}
}

function connectLeaderboard() {
  try {
    socket = R.createServerSocket();
  } catch (err) {
    els.online.textContent = "offline";
    return;
  }
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    setOnline(1);
    socket.rpc.getBoard("").then(applyBoard).catch(() => {});
    socket.rpc.getOnline("").then((n) => setOnline(parseInt(n) || 0)).catch(() => {});
    submitScore();
    if (submitTimer) clearInterval(submitTimer);
    submitTimer = setInterval(submitScore, 30000);
  });
  socket.addEventListener("message", (ev) => {
    let d;
    try {
      d = JSON.parse(ev.data);
    } catch (err) {
      return;
    }
    if (d.type === "board" && d.board) applyBoard(d.board);
    else if (d.type === "online") setOnline(d.online);
  });
  socket.addEventListener("close", (ev) => {
    setOnline(0);
    if (submitTimer) { clearInterval(submitTimer); submitTimer = null; }
    if (ev.code === 4403) return;
    const delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempt++));
    setTimeout(connectLeaderboard, delay);
  });
}

async function setupLeaderboard() {
  try {
    lbName = await R.kv.tinyTower.get("playerName");
  } catch (err) {}
  if (!lbName) lbName = "Tower" + Math.floor(1000 + Math.random() * 9000);
  els.nameInput.value = lbName;
  connectLeaderboard();
}

function saveName() {
  let v = els.nameInput.value.trim().replace(/[^a-zA-Z0-9 _\-]/g, "").slice(0, 20);
  if (!v) v = "Tower" + Math.floor(1000 + Math.random() * 9000);
  els.nameInput.value = v;
  lbName = v;
  R.kv.tinyTower.set("playerName", v).catch(() => {});
  toast("🏆 Name saved!");
  submitScore();
}

function openBoard(show) {
  els.boardOverlay.hidden = !show;
  if (show) submitScore();
}

function bindUI() {
  els.floorBackBtn.onclick = closeFloorPanel;
  els.boardBtn.onclick = () => openBoard(true);
  els.boardClose.onclick = () => openBoard(false);
  els.boardOverlay.onclick = (ev) => {
    if (ev.target === els.boardOverlay) openBoard(false);
  };
  els.nameSave.onclick = saveName;
  els.nameInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") saveName();
  });
  els.summonBtn.onclick = () => {
    const r = E.summonBitizen(state);
    if (!r.ok) {
      toast(r.reason === "bux" ? "💎 Not enough bux — deliver bitizens for bux!" : "🏠 No room in any residence!");
    } else {
      toast(`✨ ${r.bitizen.name} arrived at the lobby!`);
      refreshLobbyInfo();
      saveNow();
    }
  };
  hold(els.upBtn, () => nudge(1));
  hold(els.downBtn, () => nudge(-1));
  canvas.addEventListener("pointerdown", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const spots = renderer.lobbySpots(state);
    for (const sp of spots) {
      const pw = Math.max(18, renderer.floorH * 1.05);
      const ph = Math.max(11, renderer.floorH * 0.42);
      if (Math.abs(x - sp.x) < pw / 2 + 4 && Math.abs(y - sp.by) < ph / 2 + 6) {
        boardPassenger(sp.id);
        return;
      }
    }
    if (renderer.isShaft(x) && y > renderer.towerTop) {
      const target = Math.floor((renderer.groundY - y) / renderer.floorH);
      setElevatorTarget(Math.max(0, Math.min(state.floors.length, target)));
      return;
    }
    if (x >= renderer.towerX && x <= renderer.towerX + renderer.towerW && y > renderer.towerTop) {
      const i = renderer.floorFromY(y);
      if (i > 0) {
        openFloorPanel(i);
        return;
      }
    }
  });
}

async function boot() {
  let raw = null;
  try {
    raw = await R.kv.tinyTower.get("save");
  } catch (err) {
    console.warn("kv load failed", err);
  }
  state = E.loadGame(raw);
  window.__state = state;
  const earned = raw ? offlineEarnings(state) : 0;
  if (earned > 0) toast(`🛌 While you were away, your tower earned 🪙 ${fmt(earned)}`);
  state.lastSeen = Date.now();
  buildBuildTiles();
  setPanel("default");
  bindUI();
  renderer.resize();
  await setupLeaderboard();
  window.addEventListener("resize", () => renderer.resize());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });
  updateHUD();
  window.__game = { boardPassenger, setElevatorTarget, buildFloor, openFloorPanel, resetGame, get state() { return state; }, E };
  requestAnimationFrame(loop);
}

function resetGame() {
  state = E.newGame();
  window.__state = state;
  selectedFloorId = null;
  setPanel("default");
  buildBuildTiles();
  updateHUD();
  saveNow();
  toast("🔄 Fresh tower started!");
}

boot();
