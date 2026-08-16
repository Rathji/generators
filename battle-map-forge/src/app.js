// Battleboard client — rendering, input, networking, UI.
// Map backgrounds, default characters, fog of war, DM mode.
import { MAP_W, MAP_H, computeVisibility } from "./los.js";
import { SocketClient } from "./net.js";
import { makeLocalSocket, clearLocalSave } from "./local.js";

const GUT_X = 1.25, GUT_Y = 0.8, PAD = 0.5;
const MIN_SCALE = 6, MAX_SCALE = 220;
const FOG_CELL = 16;
const SAMPLE_IMPORT = `[{"name":"Gandalf","color":"#4a76d9","hp":45,"vision":14},
{"name":"Aragorn","color":"#45a968","hp":60,"vision":12},
{"name":"Orc1","color":"#d05454","hp":11,"vision":10},
{"name":"Orc2","color":"#d05454","hp":11,"vision":10}]`;

const BUILTIN_MAPS = [
  { id: "dungeon", name: "Dungeon", url: "" },
  { id: "plains", name: "Grass Plains", url: "https://user.uploads.dev/file/488fd03978436a2b3520def0b17990f2.webp" },
  { id: "meadow", name: "Meadow Clearing", url: "https://user.uploads.dev/file/39101e4a3f53aa05692d8ed51c38ee0f.webp" },
  { id: "caves", name: "Underground Caves", url: "https://user.uploads.dev/file/3efff4f844c5c46a7b84d96ad86b8fd5.webp" },
  { id: "avernus", name: "Avernus Hellscape", url: "https://user.uploads.dev/file/3e1b039a26c32c4ed3c3299f45d5e1aa.webp" }
];

const DEFAULT_CHARACTERS = [
  { id: "fighter", race: "Human", klass: "Fighter", color: "#d05454", hp: 45, vision: 12,
    male: { name: "Aldric", img: "https://user.uploads.dev/file/9b22173ce4bc819ccc495b4dbe1b4e1a.webp" },
    female: { name: "Sigrun", img: "https://user.uploads.dev/file/0147ba876ed8d70819f1422c1b759cf3.webp" } },
  { id: "ranger", race: "Elf", klass: "Ranger", color: "#45a968", hp: 38, vision: 14,
    male: { name: "Thalion", img: "https://user.uploads.dev/file/cfb022807d6717a48592864d44902c31.webp" },
    female: { name: "Sylva", img: "https://user.uploads.dev/file/d7278e164834d29dc7e5122b8013a7fb.webp" } },
  { id: "cleric", race: "Dwarf", klass: "Cleric", color: "#b8792f", hp: 40, vision: 12,
    male: { name: "Borin", img: "https://user.uploads.dev/file/248690a8a504fcfbd48da7e35b7d3c36.webp" },
    female: { name: "Freydis", img: "https://user.uploads.dev/file/605722da6594ff10a12c2ac80a6d49d7.webp" } },
  { id: "barbarian", race: "Half-Orc", klass: "Barbarian", color: "#9a6ec4", hp: 60, vision: 10,
    male: { name: "Grok", img: "https://user.uploads.dev/file/fe6d514dc2409b6d0d162cf56a40a89f.webp" },
    female: { name: "Ugga", img: "https://user.uploads.dev/file/925b14663efb9793d670b30548c1b54d.webp" } },
  { id: "wizard", race: "Halfling", klass: "Wizard", color: "#4a76d9", hp: 30, vision: 12,
    male: { name: "Pip", img: "https://user.uploads.dev/file/f798dba782068ee90d076a3122d9c1d6.webp" },
    female: { name: "Marnie", img: "https://user.uploads.dev/file/d1bac5cf1ebf7732d22f9bfe3c67f6b5.webp" } }
];

const NPC_CHARACTERS = [
  { id: "npc-marcus", name: "Marcus", gender: "♂ male", role: "Dwarf Blacksmith", color: "#c96f2e", hp: 22, vision: 12, img: "https://user.uploads.dev/file/5c66a68ca4982ca5ac17a1c1c5f10385.jpg" },
  { id: "npc-elias", name: "Elias", gender: "♂ male", role: "Human Merchant", color: "#4a76d9", hp: 18, vision: 12, img: "https://user.uploads.dev/file/69d54fbd81efb7fc57dec05a4e286e0b.jpg" },
  { id: "npc-rosalind", name: "Rosalind", gender: "♀ female", role: "Human Innkeeper", color: "#d05454", hp: 20, vision: 12, img: "https://user.uploads.dev/file/23d39a77820f47a955cd570f98794eb7.jpg" },
  { id: "npc-alba", name: "Alba", gender: "♀ female", role: "Elf Herbalist", color: "#45a968", hp: 19, vision: 14, img: "https://user.uploads.dev/file/feddcbfaf4ca77620e283ec0be3ac136.jpg" }
];

const MONSTERS = [
  { id: "mon-goblin", name: "Goblin", color: "#5a9e3f", hp: 7, vision: 10, img: "https://user.uploads.dev/file/aaa15886dba405352f6e5d2ce0c9970f.jpg" },
  { id: "mon-orc", name: "Orc", color: "#3f7a5a", hp: 15, vision: 10, img: "https://user.uploads.dev/file/a31b50e7a74974f135bff880d306a04c.jpg" },
  { id: "mon-kobold", name: "Kobold", color: "#c99b3f", hp: 5, vision: 10, img: "https://user.uploads.dev/file/7d18ad824e3f650682dd120ee2b6991e.jpg" },
  { id: "mon-rat", name: "Giant Rat", color: "#8a8a8a", hp: 2, vision: 8, img: "https://user.uploads.dev/file/720035b8cea6a4057e4ccbd30d25a6f9.jpg" },
  { id: "mon-wolf", name: "Wolf", color: "#7a7d8f", hp: 13, vision: 12, img: "https://user.uploads.dev/file/961814cb1fb9ff04f464e24ec3baec15.jpg" },
  { id: "mon-skeleton", name: "Skeleton", color: "#cfcfcf", hp: 13, vision: 10, img: "https://user.uploads.dev/file/80afb8c2380db568ef8c42f79a6c88e1.jpg" },
  { id: "mon-zombie", name: "Zombie", color: "#7a9e5f", hp: 22, vision: 8, img: "https://user.uploads.dev/file/12666abd324f3df13d1d203e3a6f99c0.jpg" },
  { id: "mon-bandit", name: "Bandit", color: "#8f5a3a", hp: 11, vision: 10, img: "https://user.uploads.dev/file/275b82e106747916dcd01d1affe6f079.jpg" },
  { id: "mon-hobgoblin", name: "Hobgoblin", color: "#a34f2f", hp: 11, vision: 12, img: "https://user.uploads.dev/file/4586eca36153546b87e7ad03bb8b08ad.jpg" },
  { id: "mon-cultist", name: "Cultist", color: "#6f4f9f", hp: 9, vision: 12, img: "https://user.uploads.dev/file/815dd5b08c7de7a6d6ec4b5e840921ec.jpg" }
];

const BOSSES = [
  { id: "boss-dragon", name: "Dragon", color: "#d64545", hp: 200, vision: 16, w: 3, h: 3, img: "https://user.uploads.dev/file/20164fde855e243e54a901dcc5b443cc.jpg" },
  { id: "boss-spider", name: "Huge Spider", color: "#8a4fa8", hp: 80, vision: 12, w: 3, h: 3, img: "https://user.uploads.dev/file/c87dd08fc54fdd8575df58596622a045.jpg" },
  { id: "boss-giant", name: "Storm Giant", color: "#4a7ab9", hp: 162, vision: 14, w: 2, h: 2, img: "https://user.uploads.dev/file/1c71a7c3b576b5c7a6c846b6fccad1aa.jpg" }
];

function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
function hexToRgba(hex, a) {
  let h = (hex || "#4a76d9").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function hashHue(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x % 360; }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function fmtTime(ts) { const d = new Date(ts); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clampNum(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function parseImport(text) {
  text = (text || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    let arr;
    try { arr = JSON.parse(text); } catch (e) { throw new Error("invalid JSON: " + e.message); }
    if (!Array.isArray(arr)) throw new Error("JSON must be an array of characters");
    return arr.map(c => ({
      name: String(c.name || "").trim().slice(0, 40),
      hp: Number(c.hp) || 0,
      vision: c.vision != null ? Number(c.vision) : 12,
      color: String(c.color || "").trim(),
      img: String(c.img || "").trim(),
      w: Number(c.w) || 1,
      h: Number(c.h) || 1,
      x: c.x != null ? Number(c.x) : null,
      y: c.y != null ? Number(c.y) : null
    })).filter(c => c.name);
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const p = l.split("|").map(s => s.trim());
    if (!p[0]) continue;
    out.push({
      name: p[0].slice(0, 40),
      hp: Number(p[1]) || 0,
      vision: p[2] ? Number(p[2]) : 12,
      color: p[3] || "",
      img: p[4] || ""
    });
  }
  return out;
}

export class App {
  constructor(root, ui, opts) {
    this.root = root;
    this.ui = ui;
    this.canvas = ui.canvas;
    this.ctx = this.canvas.getContext("2d");
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.tableMode = (opts && opts.mode) || "local";
    this.roomCode = (opts && opts.code) || null;
    this.resume = !!(opts && opts.resume);
    this.destroyed = false;
    this._raf = 0;

    this.state = { walls: [], tokens: [], dmId: "", chat: [], enforceLos: false, mapImage: "", initCurrent: "" };
    this.initSortDir = "desc";
    this._initSig = "";
    this.players = [];
    this.myId = "";
    this.myName = localStorage.getItem("battleboard_name") || (localStorage.getItem("bgn_name") || ("Player-" + Math.floor(1000 + Math.random() * 9000)));
    this.mode = "move";
    this.camera = { scale: 40, ox: 40, oy: 20 };
    this.hoverId = null;
    this.selectedId = null;
    this.playerView = false;
    this.drag = null;
    this.pinch = null;
    this.activePointers = new Map();

    this.vis = new Uint8Array(MAP_W * MAP_H);
    this.losDirty = true;
    this.losScheduled = false;
    this.fog = document.createElement("canvas");
    this.fogCtx = this.fog.getContext("2d");
    this.fogBuilt = false;

    this.chatLog = [];
    this.imgCache = new Map();
    this.toastTimer = 0;

    this.net = null;
    this._openPoll = null;

    this.bindUi();
    this.resize();
    this.updateModeUi();
    this.ui.nameInput.value = this.myName;
    this.ui.importInput.value = SAMPLE_IMPORT;
    this.loop();
    if (this.tableMode === "local") this.connect();
  }

  // ---------- networking ----------

  connect() {
    if (this.destroyed) return;
    if (this.net) { if (!this.net.connected && !this.net.closed) this.net.connect(); return; }
    this.net = new SocketClient({
      create: this.tableMode === "local"
        ? () => makeLocalSocket({ resume: this.resume })
        : () => (this.root && this.root.createServerSocket ? this.root.createServerSocket() : null),
      onMessage: (m) => this.onMessage(m),
      onStatus: (s) => this.setStatus(s)
    });
    this.net.connect();
  }

  waitOpen(timeoutMs) {
    if (this.net && this.net.connected) return Promise.resolve();
    return new Promise((res, rej) => {
      const t0 = Date.now();
      const poll = () => {
        if (this.net && this.net.connected) return res();
        if (Date.now() - t0 > (timeoutMs || 8000)) return rej(new Error("socket timeout"));
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  async openRoom(create, code) {
    this.connect();
    await this.waitOpen();
    const r = await this.net.rpc(create ? "createRoom" : "joinRoom", create ? {} : { code });
    let msg = r;
    if (typeof r === "string" && r.startsWith("{")) { try { msg = JSON.parse(r); } catch (e) {} }
    if (msg && msg.t === "welcome") this.onWelcome(msg);
    else if (msg && msg.err) throw new Error(msg.err);
    else throw new Error("couldn't join table");
    return msg;
  }

  leaveTable() {
    if (this.net && this.net.connected) this.net.rpc("leave", {}).catch(() => {});
  }

  setStatus(s) {
    if (this.destroyed) return;
    const dot = this.ui.connDot, txt = this.ui.connText;
    dot.className = "dot";
    if (s === "connected") { dot.classList.add("on"); txt.textContent = "connected"; }
    else if (s === "connecting") { txt.textContent = "connecting…"; }
    else if (s === "reconnecting") { txt.textContent = "reconnecting…"; }
    else if (s === "blocked") { dot.classList.add("err"); txt.textContent = "unavailable off perchance"; }
    if (s === "connected" && this.tableMode === "online" && this.roomCode && this.net) {
      this.net.rpc("joinRoom", { code: this.roomCode }).then(r => {
        let msg = r;
        if (typeof r === "string" && r.startsWith("{")) { try { msg = JSON.parse(r); } catch (e) {} }
        if (msg && msg.t === "welcome") this.onWelcome(msg);
      }).catch(() => {});
    }
    this.updateRoomUi();
  }

  onMessage(msg) {
    if (this.destroyed) return;
    if (msg.t === "welcome") this.onWelcome(msg);
    else if (msg.t === "state") {
      this.applyDoc(msg.doc);
    } else if (msg.t === "presence") {
      this.players = msg.players || [];
      this.updateDmUi();
      this.renderPlayers();
    } else if (msg.t === "chat") {
      this.pushChat(msg, false);
    } else if (msg.t === "closed") {
      if (this.ui.toast) this.toast("This table was recycled by the network. Start a fresh one from the lobby.");
    }
  }

  onWelcome(msg) {
    this.myId = msg.yourId;
    this.players = msg.players || [];
    if (msg.code) this.roomCode = msg.code;
    this.applyDoc(msg.doc);
    this.renderPlayers();
    this.updateRoomUi();
    this.net.rpc("setName", { name: this.myName }).catch(() => {});
  }

  applyDoc(doc) {
    if (!doc) return;
    if (Array.isArray(doc.walls)) this.state.walls = doc.walls;
    if (Array.isArray(doc.tokens)) this.mergeTokens(doc.tokens);
    if (typeof doc.dmId === "string") this.state.dmId = doc.dmId;
    if (Array.isArray(doc.chat)) this.syncChat(doc.chat);
    if (typeof doc.enforceLos === "boolean" && doc.enforceLos !== this.state.enforceLos) {
      this.state.enforceLos = doc.enforceLos;
      if (!doc.enforceLos && this.playerView) {
        this.playerView = false;
        if (this.ui.playerViewBtn) this.ui.playerViewBtn.classList.remove("active");
      }
      this.renderPlayers();
    }
    if (typeof doc.mapImage === "string" && doc.mapImage !== this.state.mapImage) {
      this.state.mapImage = doc.mapImage;
      if (doc.mapImage) this.ensureMapImg(doc.mapImage);
      this.updateMapUi();
    }
    if (typeof doc.initCurrent === "string" && doc.initCurrent !== this.state.initCurrent) {
      this.state.initCurrent = doc.initCurrent;
      this.renderInit();
    }
    this.updateDmUi();
    this.renderInit();
    this.scheduleLos();
  }

  mergeTokens(serverTokens) {
    const byId = new Map(this.state.tokens.map(t => [t.id, t]));
    const next = [];
    for (const st of serverTokens) {
      const ex = byId.get(st.id);
      if (ex) {
        ex.x = st.x; ex.y = st.y; ex.w = st.w; ex.h = st.h;
        ex.owner = st.owner; ex.name = st.name; ex.color = st.color;
        ex.img = st.img; ex.hp = st.hp; ex.vision = st.vision;
        ex.init = st.init || 0; ex.inTracker = !!st.inTracker;
        next.push(ex);
      } else {
        const nt = { px: st.x, py: st.y, ...st };
        this.ensureImg(nt.img);
        next.push(nt);
      }
    }
    this.state.tokens = next;
    if (this.selectedId && !byId.has(this.selectedId)) this.selectToken(null);
  }

  syncChat(msgs) {
    let changed = false;
    for (const m of msgs) if (this.pushChat(m, true)) changed = true;
    if (changed) this.renderChat();
  }

  pushChat(m, silent) {
    const key = (m.n || "") + "\u0000" + (m.x || m.t || "") + "\u0000" + (m.ts || 0);
    for (const x of this.chatLog) {
      if ((x.n + "\u0000" + x.t + "\u0000" + (x.ts || 0)) === key) return false;
    }
    this.chatLog.push({ n: m.n, t: m.x || m.t, ts: m.ts || Date.now() });
    if (this.chatLog.length > 200) this.chatLog.shift();
    if (!silent) this.renderChat();
    return true;
  }

  rpc(name, payload) {
    return this.net.rpc(name, payload).then(r => {
      if (typeof r === "string" && r.startsWith("ok")) {
        const n = Number(r.split(":").pop());
        return Number.isFinite(n) && r.includes(":") ? n : true;
      }
      return r;
    }).catch(err => {
      const em = (err && err.message) || String(err || "");
      if (this.tableMode === "online" && em.indexOf("not_at_table") !== -1 && this.roomCode && !this._rejoining) {
        this._rejoining = true;
        return this.net.rpc("joinRoom", { code: this.roomCode })
          .then(r => {
            let msg = r;
            if (typeof r === "string" && r.startsWith("{")) { try { msg = JSON.parse(r); } catch (e) {} }
            if (msg && msg.t === "welcome") this.onWelcome(msg);
            return this.net.rpc(name, payload);
          })
          .then(r => {
            this._rejoining = false;
            return typeof r === "string" && r.startsWith("ok") ? true : r;
          })
          .catch(e2 => { this._rejoining = false; throw e2; });
      }
      throw err;
    });
  }

  // ---------- roles / DM ----------

  isDm() {
    return this.state.dmId === this.myId || !!this.players.find(p => p.id === this.myId && p.isDm);
  }
  dmName() { const p = this.players.find(p => p.isDm); return p ? p.name : null; }
  myViewerCount() { let n = 0; for (const t of this.state.tokens) if (t.owner === this.myName) n++; return n; }

  onClaimDm() {
    this.rpc("claimDM", {}).then(() => {
      this.state.dmId = this.myId;
      this.updateDmUi();
      this.renderPlayers();
      this.toast("You are now the DM. You see the full map.");
    }).catch(e => this.toast("Could not claim DM: " + ((e && e.message) || e)));
  }
  onReleaseDm() {
    this.rpc("releaseDM", {}).then(() => {
      this.state.dmId = "";
      this.updateDmUi();
      this.renderPlayers();
      this.scheduleLos();
    }).catch(() => {});
  }

  // ---------- line of sight ----------

  scheduleLos() {
    this.losDirty = true;
    if (this.losScheduled) return;
    this.losScheduled = true;
    requestAnimationFrame(() => {
      this.losScheduled = false;
      if (this.losDirty) {
        this.losDirty = false;
        this.recomputeLos();
      }
    });
  }

  recomputeLos() {
    const dm = this.isDm();
    if (this.playerView && this.state.enforceLos) {
      const sel = this.selectedId ? this.tokenById(this.selectedId) : null;
      const ids = sel ? [sel.id] : this.state.tokens.map(t => t.id);
      this.vis = computeVisibility(this.state.tokens, this.state.walls, ids, MAP_W, MAP_H);
      this.buildFog();
      return;
    }
    if (dm || !this.state.enforceLos) {
      this.vis.fill(1);
      return;
    }
    const mine = this.state.tokens.filter(t => t.owner === this.myName);
    this.vis = computeVisibility(this.state.tokens, this.state.walls, mine.map(t => t.id), MAP_W, MAP_H);
    this.buildFog();
  }

  buildFog() {
    this.fog.width = MAP_W * FOG_CELL;
    this.fog.height = MAP_H * FOG_CELL;
    const f = this.fogCtx;
    f.clearRect(0, 0, this.fog.width, this.fog.height);
    f.fillStyle = "rgba(7,9,14,1)";
    f.fillRect(0, 0, this.fog.width, this.fog.height);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (this.vis[y * MAP_W + x]) f.clearRect(x * FOG_CELL, y * FOG_CELL, FOG_CELL, FOG_CELL);
      }
    }
    f.filter = "blur(12px)";
    f.drawImage(this.fog, 0, 0);
    f.filter = "none";
    this.fogBuilt = true;
  }

  tokenVisible(t) {
    for (let y = t.y; y < t.y + t.h; y++) {
      for (let x = t.x; x < t.x + t.w; x++) {
        if (x >= 0 && x < MAP_W && y >= 0 && y < MAP_H && this.vis[y * MAP_W + x]) return true;
      }
    }
    return false;
  }

  mapImageLoaded() {
    const url = this.state.mapImage;
    if (!url) return null;
    const img = this.imgCache.get(url);
    if (img && img.complete && img.naturalWidth > 0) return img;
    return null;
  }

  // ---------- camera ----------

  w2s(gx, gy) { return [this.camera.ox + (gx + GUT_X) * this.camera.scale, this.camera.oy + (gy + GUT_Y) * this.camera.scale]; }
  s2w(sx, sy) { return { gx: (sx - this.camera.ox) / this.camera.scale - GUT_X, gy: (sy - this.camera.oy) / this.camera.scale - GUT_Y }; }

  fit() {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw < 60 || ch < 60) return;
    const sc = clampNum(Math.min(cw / (GUT_X + MAP_W + PAD), ch / (GUT_Y + MAP_H + PAD)), MIN_SCALE, 60);
    this.camera.scale = sc;
    this.camera.ox = (cw - (GUT_X + MAP_W) * sc) / 2;
    this.camera.oy = (ch - (GUT_Y + MAP_H) * sc) / 2;
    this.fitted = true;
    this.fitW = cw; this.fitH = ch;
  }

  zoomAt(sx, sy, factor) {
    const w = this.s2w(sx, sy);
    const ns = clampNum(this.camera.scale * factor, MIN_SCALE, MAX_SCALE);
    this.camera.scale = ns;
    this.camera.ox = sx - (w.gx + GUT_X) * ns;
    this.camera.oy = sy - (w.gy + GUT_Y) * ns;
  }

  selectToken(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    if (this.ui.zoomTokenBtn) this.ui.zoomTokenBtn.disabled = !id;
    if (this.playerView) this.scheduleLos();
  }

  onPlayerViewToggle() {
    this.playerView = !this.playerView;
    if (this.ui.playerViewBtn) this.ui.playerViewBtn.classList.toggle("active", this.playerView);
    this.scheduleLos();
    const sel = this.selectedId ? this.tokenById(this.selectedId) : null;
    this.toast(this.playerView
      ? "Player view: " + (sel ? "seeing from “" + sel.name + "”" : "showing what the party can see") + " — select a token to change the viewpoint"
      : "Player view off — back to the full DM map");
  }

  zoomToSelected() {
    const t = this.selectedId ? this.tokenById(this.selectedId) : null;
    if (!t) { this.toast("Click a token to select it first"); return; }
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    const ns = clampNum(this.camera.scale * 2, MIN_SCALE, MAX_SCALE);
    const gx = t.x + t.w / 2, gy = t.y + t.h / 2;
    this.camera.scale = ns;
    this.camera.ox = cw / 2 - (gx + GUT_X) * ns;
    this.camera.oy = ch / 2 - (gy + GUT_Y) * ns;
  }

  // ---------- input ----------

  bindUi() {
    const ui = this.ui;
    ui.modeBtns = [...document.querySelectorAll(".modeBtn")];
    for (const b of ui.modeBtns) b.addEventListener("click", () => this.setMode(b.dataset.mode));
    ui.zoomInBtn.addEventListener("click", () => this.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 1.3));
    ui.zoomOutBtn.addEventListener("click", () => this.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 0.77));
    ui.fitBtn.addEventListener("click", () => this.fit());
    ui.zoomTokenBtn.addEventListener("click", () => this.zoomToSelected());
    if (ui.playerViewBtn) ui.playerViewBtn.addEventListener("click", () => this.onPlayerViewToggle());
    ui.importBtn.addEventListener("click", () => this.onImport());
    ui.chatSendBtn.addEventListener("click", () => this.onChatSend());
    ui.chatInput.addEventListener("keydown", e => { if (e.key === "Enter") this.onChatSend(); });
    ui.nameSaveBtn.addEventListener("click", () => this.onNameSave());
    for (const b of ui.tabBtns) b.addEventListener("click", () => this.setTab(b.dataset.tab));
    ui.sidebarToggle.addEventListener("click", () => this.toggleSidebar());
    ui.sidebarFloatBtn.addEventListener("click", () => this.openSidebar());
    ui.sidebarBackdrop.addEventListener("click", () => this.closeSidebar());
    ui.initAddBtn.addEventListener("click", () => this.onInitAdd());
    ui.initNextBtn.addEventListener("click", () => this.rpc("initNext", {}).catch(e => this.toast("Initiative: " + ((e && e.message) || e))));
    ui.initSortBtn.addEventListener("click", () => {
      this.initSortDir = this.initSortDir === "desc" ? "asc" : "desc";
      this._initSig = "";
      this.renderInit();
    });

    this.canvas.addEventListener("pointerdown", e => this.onPointerDown(e));
    this.canvas.addEventListener("pointermove", e => this.onPointerMove(e));
    this.canvas.addEventListener("pointerup", e => this.onPointerUp(e));
    this.canvas.addEventListener("pointercancel", e => this.onPointerUp(e));
    this.canvas.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("keydown", e => this.onKeyDown(e));

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(ui.container);
    this.buildMapUi();
    this.buildDefaultCharsUi();
    this.buildLibraryUi();
    this.fit();
  }

  resize() {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (cw < 30 || ch < 30) return;
    const w = Math.round(cw * this.dpr), h = Math.round(ch * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (!this.fitted ||
        (this.fitW && (Math.abs(cw - this.fitW) > this.fitW * 0.25 || Math.abs(ch - this.fitH) > this.fitH * 0.25))) {
      this.fit();
    }
  }

  setMode(m) {
    this.mode = m;
    this.updateModeUi();
  }

  updateModeUi() {
    for (const b of this.ui.modeBtns) b.classList.toggle("active", b.dataset.mode === this.mode);
    const hints = {
      move: "Drag a token to move it (snaps to grid) · drag its corner to resize · right-drag to pan",
      wall: "Drag across the map to draw a wall (snaps to grid corners) · right-drag to pan",
      erase: "Click a wall to remove it · right-drag to pan"
    };
    this.ui.hintText.textContent = this.isDm() ? hints[this.mode] : "";
  }

  updateDmUi() {
    const dm = this.isDm();
    document.body.classList.toggle("isDm", dm);
    if (!dm && this.playerView) {
      this.playerView = false;
      if (this.ui.playerViewBtn) this.ui.playerViewBtn.classList.remove("active");
      this.scheduleLos();
    }
    if (!dm && this.mode !== "move") this.mode = "move";
    this.updateModeUi();
    this.updateMapUi();
  }

  setTab(name) {
    for (const b of this.ui.tabBtns) b.classList.toggle("active", b.dataset.tab === name);
    for (const p of this.ui.panels) p.classList.toggle("active", p.id === "panel-" + name);
  }

  openSidebar() { this.ui.sidebar.classList.add("open"); this.ui.sidebarBackdrop.hidden = false; }
  closeSidebar() { this.ui.sidebar.classList.remove("open"); this.ui.sidebarBackdrop.hidden = true; }
  toggleSidebar() { this.ui.sidebar.classList.toggle("open"); this.ui.sidebarBackdrop.hidden = !this.ui.sidebar.classList.contains("open"); }

  onPointerDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    this.activePointers.set(e.pointerId, { sx, sy });
    if (this.activePointers.size >= 2) { this.startPinch(); return; }

    if (e.button === 1 || e.button === 2 || e.ctrlKey) {
      this.drag = { kind: "pan", sx, sy, ox: this.camera.ox, oy: this.camera.oy };
      return;
    }
    if (e.button !== 0) return;

    const w = this.s2w(sx, sy);
    const dm = this.isDm();

    if (dm && this.mode === "wall") {
      this.drag = { kind: "wall", x1: Math.round(w.gx), y1: Math.round(w.gy), curX: Math.round(w.gx), curY: Math.round(w.gy), moved: false };
      return;
    }
    if (dm && this.mode === "erase") {
      const hit = this.hitWall(sx, sy);
      if (hit) this.rpc("deleteWall", { id: hit.id }).catch(e => this.toast("Erase failed: " + ((e && e.message) || e)));
      return;
    }

    const t = this.hitToken(sx, sy);
    if (t) {
      this.selectToken(t.id);
      if (dm || t.owner === this.myName) {
        if (this.nearHandle(t, sx, sy)) {
          this.drag = { kind: "resize", id: t.id, lx: t.x, ly: t.y, sx, sy, gw: t.w, gh: t.h, moved: false };
          this.canvas.style.cursor = "nesw-resize";
          return;
        }
        const w0 = this.s2w(sx, sy);
        this.drag = { kind: "token", id: t.id, offX: w0.gx - t.x, offY: w0.gy - t.y, gx: t.x, gy: t.y, sx, sy, moved: false };
        this.canvas.style.cursor = "grabbing";
        return;
      }
      return;
    }
    this.selectToken(null);
    this.drag = { kind: "pan", sx, sy, ox: this.camera.ox, oy: this.camera.oy };
  }

  startPinch() {
    const pts = [...this.activePointers.values()];
    if (pts.length < 2) return;
    this.pinch = {
      dist: Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy),
      scale: this.camera.scale
    };
    this.drag = null;
  }

  onPointerMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const p = this.activePointers.get(e.pointerId);
    if (p) { p.sx = sx; p.sy = sy; }

    if (this.activePointers.size >= 2 && this.pinch) {
      const pts = [...this.activePointers.values()];
      const d = Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy);
      const midX = (pts[0].sx + pts[1].sx) / 2, midY = (pts[0].sy + pts[1].sy) / 2;
      const w = this.s2w(midX, midY);
      const ns = clampNum(this.pinch.scale * d / Math.max(1, this.pinch.dist), MIN_SCALE, MAX_SCALE);
      this.camera.scale = ns;
      this.camera.ox = midX - (w.gx + GUT_X) * ns;
      this.camera.oy = midY - (w.gy + GUT_Y) * ns;
      return;
    }

    const d = this.drag;
    if (d) {
      if (d.kind === "pan") {
        this.camera.ox = d.ox + (sx - d.sx);
        this.camera.oy = d.oy + (sy - d.sy);
      } else if (d.kind === "token") {
        const w = this.s2w(sx, sy);
        const t = this.tokenById(d.id);
        if (!t) { this.drag = null; return; }
        const gx = clampNum(Math.round(w.gx - d.offX), 0, MAP_W - t.w);
        const gy = clampNum(Math.round(w.gy - d.offY), 0, MAP_H - t.h);
        if (gx !== d.gx || gy !== d.gy) { d.gx = gx; d.gy = gy; d.moved = true; }
      } else if (d.kind === "resize") {
        const w = this.s2w(sx, sy);
        const t = this.tokenById(d.id);
        if (!t) { this.drag = null; return; }
        const gw = clampNum(Math.round(w.gx - d.lx), 1, 8);
        const gh = clampNum(Math.round(w.gy - d.ly), 1, 8);
        if (gw !== d.gw || gh !== d.gh) { d.gw = gw; d.gh = gh; d.moved = true; }
      } else if (d.kind === "wall") {
        const w = this.s2w(sx, sy);
        d.curX = clampNum(Math.round(w.gx), 0, MAP_W);
        d.curY = clampNum(Math.round(w.gy), 0, MAP_H);
        if (d.curX !== d.x1 || d.curY !== d.y1) d.moved = true;
      }
      return;
    }

    const t = this.hitToken(sx, sy);
    this.hoverId = t ? t.id : null;
    if (t && (this.isDm() || t.owner === this.myName)) {
      this.canvas.style.cursor = this.nearHandle(t, sx, sy) ? "nesw-resize" : "grab";
    } else if (this.isDm() && this.mode === "wall") {
      this.canvas.style.cursor = "crosshair";
    } else if (this.isDm() && this.mode === "erase") {
      this.canvas.style.cursor = "pointer";
    } else {
      this.canvas.style.cursor = "";
    }
  }

  onPointerUp(e) {
    this.activePointers.delete(e.pointerId);
    if (this.activePointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (d) {
      if (d.kind === "token") {
        const t = this.tokenById(d.id);
        if (t && d.moved) {
          t.x = d.gx; t.y = d.gy;
          this.rpc("moveToken", { id: t.id, x: d.gx, y: d.gy }).catch(err => this.toast("Move rejected: " + ((err && err.message) || err)));
          this.scheduleLos();
        }
      } else if (d.kind === "resize") {
        const t = this.tokenById(d.id);
        if (t && d.moved) {
          t.w = d.gw; t.h = d.gh;
          t.x = clampNum(t.x, 0, MAP_W - t.w); t.y = clampNum(t.y, 0, MAP_H - t.h);
          this.rpc("resizeToken", { id: t.id, w: d.gw, h: d.gh }).catch(err => this.toast("Resize rejected: " + ((err && err.message) || err)));
        }
      } else if (d.kind === "wall") {
        if (d.moved) this.rpc("addWall", { x1: d.x1, y1: d.y1, x2: d.curX, y2: d.curY }).catch(err => this.toast("Wall failed: " + ((err && err.message) || err)));
      }
      this.drag = null;
    }
    this.canvas.style.cursor = "";
  }

  onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0013));
  }

  onKeyDown(e) {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (this.hoverId) {
        const t = this.tokenById(this.hoverId);
        if (t && (this.isDm() || t.owner === this.myName)) {
          e.preventDefault();
          this.rpc("deleteToken", { id: t.id }).catch(() => {});
        }
      }
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      this.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 1.25);
    } else if (e.key === "-") {
      e.preventDefault();
      this.zoomAt(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2, 0.8);
    } else if (e.key === "f" || e.key === "F") {
      this.fit();
    }
  }

  // ---------- hit testing ----------

  hitToken(sx, sy) {
    const w = this.s2w(sx, sy);
    for (let i = this.state.tokens.length - 1; i >= 0; i--) {
      const t = this.state.tokens[i];
      let gx = t.x, gy = t.y;
      if (this.drag && this.drag.kind === "token" && this.drag.id === t.id) { gx = this.drag.gx; gy = this.drag.gy; }
      else if (t.px != null) { gx = t.px; gy = t.py; }
      if (w.gx >= gx && w.gx < gx + t.w && w.gy >= gy && w.gy < gy + t.h) return t;
    }
    return null;
  }

  tokenById(id) { return this.state.tokens.find(t => t.id === id) || null; }

  nearHandle(t, sx, sy) {
    const gx = t.px != null ? t.px : t.x, gy = t.py != null ? t.py : t.y;
    const [px, py] = this.w2s(gx + t.w, gy + t.h);
    return Math.hypot(sx - px, sy - py) <= 14;
  }

  hitWall(sx, sy) {
    const w = this.s2w(sx, sy);
    let best = null, bestD = 0.35;
    for (const wall of this.state.walls) {
      const d = distToSeg(w.gx, w.gy, wall.x1, wall.y1, wall.x2, wall.y2);
      if (d < bestD) { bestD = d; best = wall; }
    }
    return best;
  }

  // ---------- UI actions ----------

  onImport() {
    let chars;
    try { chars = parseImport(this.ui.importInput.value); }
    catch (err) { this.toast("Import error: " + err.message); return; }
    if (!chars.length) { this.toast("No characters found — check the format"); return; }
    this.rpc("importChars", { chars }).then(n => {
      this.toast("Added " + n + " token" + (n === 1 ? "" : "s") + " to the map");
      this.ui.importInput.value = "";
    }).catch(err => this.toast("Import failed: " + ((err && err.message) || err)));
  }

  onChatSend() {
    const text = this.ui.chatInput.value.trim();
    if (!text) return;
    this.rpc("chat", { text }).then(() => { this.ui.chatInput.value = ""; })
      .catch(err => this.toast("Chat: " + ((err && err.message) || "try again")));
  }

  onNameSave() {
    const name = this.ui.nameInput.value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24);
    if (!name) { this.toast("Name can't be empty"); return; }
    this.myName = name;
    localStorage.setItem("battleboard_name", name);
    this.net.rpc("setName", { name }).catch(() => {});
    this.renderPlayers();
    this.scheduleLos();
    this.toast("Name set");
  }

  buildDefaultCharsUi() {
    const wrap = this.ui.defaultChars;
    wrap.innerHTML = "";
    for (const c of DEFAULT_CHARACTERS) {
      for (const gender of ["male", "female"]) {
        const v = c[gender];
        const b = el("button", "defChar");
        b.dataset.id = c.id;
        b.dataset.gender = gender;
        const img = new Image();
        img.src = v.img;
        img.alt = "";
        img.decoding = "async";
        img.className = "defImg";
        const info = el("span", "defInfo");
        info.appendChild(el("span", "defTitle", c.race + " " + c.klass));
        info.appendChild(el("span", "defSub", v.name + " · " + (gender === "male" ? "♂ male" : "♀ female")));
        b.append(img, info);
        b.addEventListener("click", () => this.addDefaultChar(c.id, gender));
        wrap.appendChild(b);
      }
    }
  }

  addDefaultChar(id, gender) {
    const c = DEFAULT_CHARACTERS.find(x => x.id === id);
    if (!c) return;
    const v = c[gender];
    this.rpc("importChars", { chars: [{ name: v.name, color: c.color, hp: c.hp, vision: c.vision, img: v.img }] })
      .then(n => this.toast("Added " + v.name + " (" + c.race + " " + c.klass + ")"))
      .catch(e => this.toast("Couldn't add character: " + ((e && e.message) || e)));
  }

  buildLibraryUi() {
    const build = (list, wrap, sub) => {
      wrap.innerHTML = "";
      for (const c of list) {
        const b = el("button", "defChar");
        const img = new Image();
        img.src = c.img;
        img.alt = "";
        img.decoding = "async";
        img.className = "defImg";
        const info = el("span", "defInfo");
        info.appendChild(el("span", "defTitle", c.name));
        info.appendChild(el("span", "defSub", sub(c)));
        b.append(img, info);
        b.addEventListener("click", () => this.addLibraryEntry(c));
        wrap.appendChild(b);
      }
    };
    build(NPC_CHARACTERS, this.ui.npcChars, c => c.gender + " · " + c.role);
    build(MONSTERS, this.ui.monsterChars, c => "HP " + c.hp);
    build(BOSSES, this.ui.bossChars, c => "HP " + c.hp + " · " + c.w + "×" + c.h + " cells");
  }

  addLibraryEntry(c) {
    this.rpc("importChars", { chars: [{ name: c.name, color: c.color, hp: c.hp, vision: c.vision, img: c.img, w: c.w, h: c.h }] })
      .then(n => this.toast("Added " + c.name + " to the map"))
      .catch(e => this.toast("Couldn't add: " + ((e && e.message) || e)));
  }

  // ---------- initiative tracker ----------

  initSignature() {
    const sig = this.state.initCurrent + "|" + this.initSortDir + "|" + (this.isDm() ? "D" : "P") + "|" + this.myName + "|";
    return sig + this.state.tokens.map(t => t.id + ":" + (t.inTracker ? 1 : 0) + ":" + (t.init || 0)).join(",");
  }

  renderInit() {
    const sig = this.initSignature();
    if (this._initSig === sig) return;
    this._initSig = sig;
    const dm = this.isDm();
    const canEdit = t => dm || t.owner === this.myName;
    const list = this.state.tokens.filter(t => t.inTracker);
    const dir = this.initSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => (a.init || 0) * dir - (b.init || 0) * dir);

    const u = this.ui;
    u.initList.innerHTML = "";
    if (!list.length) {
      u.initList.appendChild(el("div", "initEmpty", "No tokens in the initiative yet. Add tokens below, then set each one's roll."));
    }
    for (const t of list) {
      const row = el("div", "initRow" + (t.id === this.state.initCurrent ? " current" : ""));
      const turn = el("span", "initTurn", "▶");
      const inp = el("input", "initVal");
      inp.type = "number";
      inp.min = 0; inp.max = 999;
      inp.value = t.init || 0;
      inp.disabled = !canEdit(t);
      inp.title = canEdit(t) ? "Edit initiative roll" : "Only the token's owner or the DM can set this";
      inp.addEventListener("click", e => e.stopPropagation());
      inp.addEventListener("keydown", e => e.stopPropagation());
      inp.addEventListener("change", () => this.setTokenInit(t.id, inp.value));
      const nameWrap = el("div", "initNameWrap");
      nameWrap.appendChild(el("span", "initName", t.name));
      nameWrap.appendChild(el("span", "initSub", "HP " + (t.hp || 0) + (t.w > 1 ? " · " + t.w + "×" + t.h : "")));
      const del = el("button", "initDel", "✕");
      del.title = "Remove from initiative";
      del.disabled = !dm;
      del.addEventListener("click", e => {
        e.stopPropagation();
        this.rpc("initRemove", { id: t.id }).catch(e2 => this.toast("Initiative: " + ((e2 && e2.message) || e2)));
      });
      if (dm) {
        row.title = "Set as current turn";
        row.style.cursor = "pointer";
        row.addEventListener("click", () => this.rpc("initGoto", { id: t.id }).catch(e2 => this.toast("Initiative: " + ((e2 && e2.message) || e2))));
      }
      row.append(turn, inp, nameWrap, del);
      u.initList.appendChild(row);
    }

    const cur = list.find(t => t.id === this.state.initCurrent) || null;
    u.initNowRow.hidden = !cur;
    u.initNowEl.textContent = cur ? "Now: " + cur.name : "";
    u.initNowEl.style.borderColor = cur ? (cur.color || "#4a76d9") : "";

    const avail = this.state.tokens.filter(t => !t.inTracker);
    u.initAddSel.innerHTML = "";
    for (const t of avail) u.initAddSel.appendChild(new Option(t.name, t.id));
    const canAdd = dm && avail.length > 0;
    u.initAddSel.disabled = !canAdd;
    u.initAddBtn.disabled = !canAdd;
    u.initNextBtn.disabled = !dm || !list.length;
    u.initSortBtn.textContent = dir === 1 ? "↑ Low first" : "↓ High first";
  }

  onInitAdd() {
    const id = this.ui.initAddSel.value;
    if (!id) return;
    this.rpc("initAdd", { id }).catch(e => this.toast("Initiative: " + ((e && e.message) || e)));
  }

  setTokenInit(id, val) {
    const n = clampNum(Math.round(Number(val) || 0), 0, 999);
    this.rpc("setTokenInit", { id, init: n }).catch(e => this.toast("Couldn't set initiative: " + ((e && e.message) || e)));
  }

  buildMapUi() {
    const picker = this.ui.mapPicker;
    picker.innerHTML = "";
    for (const m of BUILTIN_MAPS) {
      const b = el("button", "mapBtn");
      b.dataset.url = m.url;
      const thumb = el("span", "mapThumb");
      if (m.url) {
        const img = new Image();
        img.src = m.url;
        img.alt = "";
        img.decoding = "async";
        thumb.appendChild(img);
      } else {
        thumb.style.background = "#e7dbbd";
      }
      b.append(thumb, el("span", "mapName", m.name));
      b.addEventListener("click", () => this.onMapSelect(m.url));
      picker.appendChild(b);
    }
    this.ui.mapFileInput.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) this.onMapUpload(f);
      e.target.value = "";
    });
    this.ui.mapUploadBtn.addEventListener("click", () => this.ui.mapFileInput.click());
    this.updateMapUi();
  }

  updateMapUi() {
    if (!this.ui.mapPicker || !this.ui.mapPicker.children.length) return;
    const dm = this.isDm();
    const cur = this.state.mapImage || "";
    for (const b of this.ui.mapPicker.children) {
      b.classList.toggle("selected", (b.dataset.url || "") === cur);
      b.disabled = !dm;
      b.title = dm ? "" : "Only the DM can change the map";
    }
    this.ui.mapUploadBtn.disabled = !dm;
  }

  onMapSelect(url) {
    if (!this.isDm()) { this.toast("Only the DM can change the map"); return; }
    this.rpc("setMap", { image: url || "" }).then(() => {
      this.toast("Map changed");
    }).catch(e => this.toast("Couldn't change map: " + ((e && e.message) || e)));
  }

  async onMapUpload(file) {
    if (!file) return;
    if (!this.isDm()) { this.toast("Only the DM can change the map"); return; }
    if (file.size > 8 * 1024 * 1024) { this.toast("Map too large (max 8 MB)"); return; }
    const btn = this.ui.mapUploadBtn;
    btn.disabled = true;
    btn.textContent = "Converting…";
    try {
      const webp = await this.fileToWebp(file);
      btn.textContent = "Uploading…";
      let result = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        result = await this.root.uploadPlugin(webp);
        if (result && !result.error) break;
        await new Promise(r => setTimeout(r, 1200));
      }
      if (result && result.error) throw new Error(result.error);
      if (!result || !result.url) throw new Error("upload returned no url");
      await this.rpc("setMap", { image: result.url });
      this.toast("Map uploaded and applied");
    } catch (err) {
      this.toast("Upload failed: " + ((err && err.message) || err));
    } finally {
      btn.disabled = !this.isDm();
      btn.textContent = "Upload map image";
    }
  }

  async fileToWebp(file) {
    const bmp = await createImageBitmap(file);
    const target = MAP_W / MAP_H;
    let w = bmp.width, h = bmp.height;
    if (w / h > target) w = Math.round(h * target);
    else h = Math.round(w / target);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, (bmp.width - w) / 2, (bmp.height - h) / 2, w, h, 0, 0, w, h);
    return new Promise((res, rej) => {
      canvas.toBlob(b => (b ? res(b) : rej(new Error("webp encode failed"))), "image/webp", 0.85);
    });
  }

  toast(msg) {
    const t = this.ui.toast;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  renderPlayers() {
    const list = this.ui.playerList;
    list.innerHTML = "";
    for (const p of this.players) {
      const row = el("div", "player-row");
      row.appendChild(el("span", "pdot"));
      row.appendChild(el("span", "name", p.name + (p.id === this.myId ? " (you)" : "")));
      if (p.isDm) row.appendChild(el("span", "badge dm", "DM"));
      list.appendChild(row);
    }

    const box = this.ui.dmBox;
    box.innerHTML = "";
    const row = el("div", "dmRow");
    if (this.isDm()) {
      row.appendChild(el("strong", null, "You are the DM"));
      const rel = el("button", "btn danger", "Release DM");
      rel.onclick = () => this.onReleaseDm();
      const clear = el("button", "btn", "Clear map");
      clear.onclick = () => { if (confirm("Remove all tokens and walls?")) this.rpc("clearMap", {}).catch(e => this.toast("Failed: " + e.message)); };
      row.append(rel, clear);
      const losRow = el("label", "losToggle");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = this.state.enforceLos === true;
      cb.onchange = () => {
        this.rpc("toggleLos", { on: cb.checked }).catch(e => { cb.checked = !cb.checked; this.toast("Failed: " + ((e && e.message) || e)); });
      };
      losRow.append(cb, document.createTextNode("Enforce fog of war (players see only line of sight)"));
      row.appendChild(losRow);
    } else {
      const dm = this.dmName();
      if (dm) {
        row.appendChild(el("strong", null, "DM: " + dm));
        row.appendChild(el("span", "hint", " (released when the DM disconnects)"));
      } else {
        row.appendChild(el("span", "hint", "First player to claim becomes the DM and sees the whole map."));
        const claim = el("button", "btn primary", "Claim DM");
        claim.onclick = () => this.onClaimDm();
        row.appendChild(claim);
      }
    }
    box.appendChild(row);
    this.updateRoomUi();
  }

  updateRoomUi() {
    const dm = this.dmName();
    const isDm = this.isDm();
    const u = this.ui;
    if (u.hostNameEl) u.hostNameEl.textContent = isDm ? "You" : (dm || "—");
    if (u.hostSubEl) u.hostSubEl.textContent = "dungeon master";
    if (u.guestNameEl) u.guestNameEl.textContent = this.myName || "You";
    if (u.guestSubEl) u.guestSubEl.textContent = isDm ? "dungeon master" : "player";
    if (u.turnEl) {
      u.turnEl.textContent = this.tableMode === "local"
        ? "Local table"
        : (this.roomCode ? "Table " + this.roomCode : "Connecting…");
    }
    if (u.roomCodeEl) u.roomCodeEl.textContent = this.roomCode || "—";
    if (u.newGameBtn) u.newGameBtn.disabled = !isDm;
  }

  async loadDemo() {
    try { await this.waitOpen(8000); } catch (e) {}
    try {
      await this.net.rpc("setMap", { image: "https://user.uploads.dev/file/39101e4a3f53aa05692d8ed51c38ee0f.webp" });
    } catch (e) {}
    const spots = [[2, 2], [7, 4], [11, 6], [4, 10], [14, 12]];
    const chars = DEFAULT_CHARACTERS.map((c, i) => ({
      name: c.male.name, color: c.color, hp: c.hp, vision: c.vision, img: c.male.img,
      x: spots[i][0], y: spots[i][1]
    }));
    try {
      await this.net.rpc("importChars", { chars });
      this.toast("Demo table loaded — 5 heroes on the meadow.");
    } catch (e) {
      this.toast("Demo load: " + ((e && e.message) || e));
    }
  }

  destroy() {
    this.destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.net) this.net.close();
  }

  renderChat() {
    const log = this.ui.chatLog;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.innerHTML = "";
    for (const m of this.chatLog) {
      const row = el("div", "chatRow");
      const who = el("span", "who", m.n);
      who.style.color = `hsl(${hashHue(m.n)} 75% 70%)`;
      const tm = el("span", "tm", fmtTime(m.ts));
      row.append(who, document.createTextNode(": "), el("span", null, m.t), tm);
      log.appendChild(row);
    }
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  ensureImg(url) {
    if (!url || this.imgCache.has(url)) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {};
    img.onerror = () => {};
    img.src = url;
    this.imgCache.set(url, img);
  }

  ensureMapImg(url) {
    if (!url) return;
    const cached = this.imgCache.get(url);
    if (cached) {
      if (cached.crossOrigin === "anonymous") return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {};
    img.onerror = () => {};
    img.src = url;
    this.imgCache.set(url, img);
  }

  // ---------- rendering ----------

  loop() {
    if (this.destroyed) return;
    this._raf = requestAnimationFrame(() => this.loop());
    const d = this.drag;
    for (const t of this.state.tokens) {
      if (d && d.kind === "token" && d.id === t.id) continue;
      if (t.px == null) { t.px = t.x; t.py = t.y; continue; }
      t.px += (t.x - t.px) * 0.22;
      t.py += (t.y - t.py) * 0.22;
      if (Math.abs(t.x - t.px) < 0.02 && Math.abs(t.y - t.py) < 0.02) { t.px = t.x; t.py = t.y; }
    }
    try { this.draw(); } catch (e) {}
  }

  draw() {
    const ctx = this.ctx;
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#14171f";
    ctx.fillRect(0, 0, cw, ch);

    const sc = this.camera.scale, ox = this.camera.ox, oy = this.camera.oy;
    const fx0 = ox + GUT_X * sc, fy0 = oy + GUT_Y * sc;
    const fw = MAP_W * sc, fh = MAP_H * sc;
    if (fx0 + fw < 0 || fy0 + fh < 0 || fx0 > cw || fy0 > ch) return;

    const c0x = clampNum(Math.floor((0 - ox) / sc - GUT_X), 0, MAP_W);
    const c1x = clampNum(Math.ceil((cw - ox) / sc - GUT_X), 0, MAP_W);
    const c0y = clampNum(Math.floor((0 - oy) / sc - GUT_Y), 0, MAP_H);
    const c1y = clampNum(Math.ceil((ch - oy) / sc - GUT_Y), 0, MAP_H);

    const mapImg = this.mapImageLoaded();
    if (mapImg) {
      ctx.imageSmoothingEnabled = true;
      const iw = mapImg.naturalWidth, ih = mapImg.naturalHeight;
      const s = Math.max(fw / iw, fh / ih);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(mapImg, fx0 + (fw - dw) / 2, fy0 + (fh - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = "#e7dbbd";
      ctx.fillRect(fx0, fy0, fw, fh);
      ctx.fillStyle = "rgba(80,60,35,0.08)";
      for (let y = c0y; y < c1y; y++) for (let x = c0x; x < c1x; x++) if (((x + y) & 1) === 0) ctx.fillRect(fx0 + x * sc, fy0 + y * sc, sc, sc);
    }

    ctx.lineWidth = 1;
    for (let gx = c0x; gx <= c1x; gx++) {
      ctx.strokeStyle = gx % 5 === 0 ? "rgba(70,55,30,0.7)" : "rgba(80,65,40,0.3)";
      ctx.beginPath(); ctx.moveTo(fx0 + gx * sc, fy0); ctx.lineTo(fx0 + gx * sc, fy0 + fh); ctx.stroke();
    }
    for (let gy = c0y; gy <= c1y; gy++) {
      ctx.strokeStyle = gy % 5 === 0 ? "rgba(70,55,30,0.7)" : "rgba(80,65,40,0.3)";
      ctx.beginPath(); ctx.moveTo(fx0, fy0 + gy * sc); ctx.lineTo(fx0 + fw, fy0 + gy * sc); ctx.stroke();
    }

    if (sc >= 15) {
      ctx.font = `600 ${clampNum(sc * 0.36, 9, 13)}px system-ui`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(214,220,230,0.9)";
      for (let gx = c0x; gx < c1x; gx++) ctx.fillText(String.fromCharCode(65 + gx), fx0 + gx * sc + sc / 2, oy + GUT_Y * sc / 2);
      for (let gy = c0y; gy < c1y; gy++) ctx.fillText(String(gy + 1), ox + GUT_X * sc / 2, fy0 + gy * sc + sc / 2);
    }

    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const wallW = Math.max(3, sc * 0.15);
    for (const wall of this.state.walls) {
      const [x1, y1] = this.w2s(wall.x1, wall.y1), [x2, y2] = this.w2s(wall.x2, wall.y2);
      ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.lineWidth = wallW + 2;
      ctx.beginPath(); ctx.moveTo(x1 + 1.5, y1 + 1.5); ctx.lineTo(x2 + 1.5, y2 + 1.5); ctx.stroke();
      ctx.strokeStyle = "#5b4126";
      ctx.lineWidth = wallW;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    const enforce = this.state.enforceLos === true;
    const dm = this.isDm();
    const asPlayer = !dm || this.playerView === true;
    const drawList = [];
    for (const t of this.state.tokens) {
      if (this.drag && this.drag.kind === "token" && this.drag.id === t.id) continue;
      if (asPlayer && enforce && !this.tokenVisible(t)) continue;
      drawList.push(t);
    }
    if (this.drag && this.drag.kind === "token") {
      const t = this.tokenById(this.drag.id);
      if (t) drawList.push({ ...t, x: this.drag.gx, y: this.drag.gy, __ghost: true });
    }
    for (const t of drawList) this.drawToken(t);
    const labelPass = [];
    for (const t of drawList) labelPass.push(this.labelMetrics(t));
    const placed = [];
    const sc2 = sc;
    for (const it of labelPass) {
      const [px, py] = this.w2s(it.t.x, it.t.y);
      const gap = Math.max(2, sc2 * 0.1);
      const mkRect = above => above
        ? { x: px + it.t.w * sc2 / 2 - it.pillW / 2, y: py - gap - it.totalH, w: it.pillW, h: it.totalH }
        : { x: px + it.t.w * sc2 / 2 - it.pillW / 2, y: py + it.t.h * sc2 + gap, w: it.pillW, h: it.totalH };
      const collides = r => {
        for (const t2 of drawList) {
          if (t2 === it.t) continue;
          const [ox, oy] = this.w2s(t2.x, t2.y);
          const ow = t2.w * sc2, oh = t2.h * sc2;
          if (r.x < ox + ow && r.x + r.w > ox && r.y < oy + oh && r.y + r.h > oy) return true;
        }
        for (const p of placed) {
          if (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y) return true;
        }
        return false;
      };
      let dir = "below";
      if (collides(mkRect(false))) {
        dir = "above";
        if (collides(mkRect(true))) dir = "below";
      }
      it.dir = dir;
      placed.push(mkRect(dir));
    }
    for (const it of labelPass) this.drawTokenLabel(it);
    if (this.drag && this.drag.kind === "resize") {
      const t = this.tokenById(this.drag.id);
      if (t) {
        const [px, py] = this.w2s(t.px != null ? t.px : t.x, t.py != null ? t.py : t.y);
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "#ffd76a"; ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, this.drag.gw * sc, this.drag.gh * sc);
        ctx.restore();
      }
    }
    if (this.drag && this.drag.kind === "wall") {
      const [x1, y1] = this.w2s(this.drag.x1, this.drag.y1), [x2, y2] = this.w2s(this.drag.curX, this.drag.curY);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(255,215,106,0.9)"; ctx.lineWidth = wallW;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    }

    if (asPlayer && enforce) {
      if (!this.fogBuilt) this.buildFog();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fog, fx0, fy0, fw, fh);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.028)";
      for (let gx = c0x; gx <= c1x; gx++) {
        ctx.beginPath(); ctx.moveTo(fx0 + gx * sc, fy0); ctx.lineTo(fx0 + gx * sc, fy0 + fh); ctx.stroke();
      }
      for (let gy = c0y; gy <= c1y; gy++) {
        ctx.beginPath(); ctx.moveTo(fx0, fy0 + gy * sc); ctx.lineTo(fx0 + fw, fy0 + gy * sc); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 2;
      ctx.strokeRect(fx0, fy0, fw, fh);
    } else {
      ctx.strokeStyle = "rgba(70,55,30,0.9)"; ctx.lineWidth = 2;
      ctx.strokeRect(fx0, fy0, fw, fh);
    }

    if (this.hoverId && !this.drag) {
      const t = this.tokenById(this.hoverId);
      if (t && (dm || t.owner === this.myName)) {
        const [px, py] = this.w2s(t.px != null ? t.px : t.x, t.py != null ? t.py : t.y);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = dm ? "#ffd76a" : "#8fc7ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 1.5, py - 1.5, t.w * sc + 3, t.h * sc + 3);
        ctx.setLineDash([]);
        const hs = 11;
        ctx.fillStyle = "#ffd76a";
        ctx.fillRect(px + t.w * sc - hs / 2, py + t.h * sc - hs / 2, hs, hs);
        ctx.strokeStyle = "#20242c"; ctx.lineWidth = 1.5;
        ctx.strokeRect(px + t.w * sc - hs / 2, py + t.h * sc - hs / 2, hs, hs);
        ctx.restore();
      }
    }

    if (this.selectedId) {
      const t = this.tokenById(this.selectedId);
      if (t) {
        const [px, py] = this.w2s(t.px != null ? t.px : t.x, t.py != null ? t.py : t.y);
        ctx.save();
        ctx.setLineDash([10, 6]);
        ctx.strokeStyle = "#ffd76a";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(px - 3, py - 3, t.w * sc + 6, t.h * sc + 6);
        ctx.setLineDash([]);
        ctx.strokeStyle = "#ffe9a8";
        ctx.lineWidth = 2;
        const L = Math.min(13, t.w * sc * 0.35);
        const xs = [px - 3, px + t.w * sc + 3, px + t.w * sc + 3, px - 3];
        const ys = [py - 3, py - 3, py + t.h * sc + 3, py + t.h * sc + 3];
        const dx = [1, -1, -1, 1];
        const dy = [1, 1, -1, -1];
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(xs[i] + dx[i] * L, ys[i]);
          ctx.lineTo(xs[i], ys[i]);
          ctx.lineTo(xs[i], ys[i] + dy[i] * L);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        this.selectToken(null);
      }
    }

    if (this.state.initCurrent && !this.drag) {
      const t = this.tokenById(this.state.initCurrent);
      if (t && t.inTracker) {
        const [px, py] = this.w2s(t.px != null ? t.px : t.x, t.py != null ? t.py : t.y);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
        ctx.save();
        ctx.strokeStyle = "rgba(255,215,106," + (0.5 + 0.4 * pulse) + ")";
        ctx.lineWidth = 2 + pulse;
        ctx.strokeRect(px - 5, py - 5, t.w * sc + 10, t.h * sc + 10);
        const cx = px + t.w * sc / 2, cy = py - 10;
        ctx.fillStyle = "#ffd76a";
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy - 7); ctx.lineTo(cx + 9, cy - 7); ctx.lineTo(cx, cy + 5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#20242c";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    const banner = this.ui.banner;
    if (!dm && enforce && this.myViewerCount() === 0) {
      banner.style.display = "block";
      banner.textContent = "You can't see anything yet — you have no tokens on the map. Import your character (Import tab) or ask the DM.";
    } else {
      banner.style.display = "none";
    }
  }

  drawToken(t) {
    const ctx = this.ctx;
    const sc = this.camera.scale;
    const [px, py] = this.w2s(t.x, t.y);
    const pw = t.w * sc, ph = t.h * sc;
    if (pw <= 0 || ph <= 0) return;

    const color = t.color && t.color.startsWith("#") ? t.color : "#4a76d9";
    const ghost = t.__ghost === true;

    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;

    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
    this.roundRect(px + 1.5, py + 2.5, pw, ph, Math.min(9, sc * 0.16));
    ctx.fillStyle = hexToRgba(color, 0.28);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, sc * 0.06);
    this.roundRect(px, py, pw, ph, Math.min(9, sc * 0.16));
    ctx.stroke();

    const inset = Math.max(2, sc * 0.07);
    const rx = px + inset, ry = py + inset, rw = pw - 2 * inset, rh = ph - 2 * inset;
    if (rw > 0 && rh > 0) {
      let drewImg = false;
      if (t.img && this.imgCache.has(t.img)) {
        const img = this.imgCache.get(t.img);
        if (img.complete && img.naturalWidth > 0) {
          this.roundRect(rx, ry, rw, rh, Math.min(7, sc * 0.12));
          ctx.save();
          ctx.clip();
          this.drawImageCover(img, rx, ry, rw, rh);
          ctx.restore();
          drewImg = true;
        }
      }
      if (!drewImg) this.drawInitial(t, rx, ry, rw, rh, color);
    }

    if (ghost) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, py, pw, ph);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  labelMetrics(t) {
    const sc = this.camera.scale;
    const pw = t.w * sc, ph = t.h * sc;
    const maxW = Math.max(pw + 10, 84);
    let label = t.name;
    let fp = clampNum(sc * 0.34, 9, 16);
    const ctx = this.ctx;
    ctx.font = `700 ${fp}px system-ui`;
    while (fp > 6.5 && ctx.measureText(label).width > maxW) {
      fp -= 0.5;
      ctx.font = `700 ${fp}px system-ui`;
    }
    if (ctx.measureText(label).width > maxW && label.length > 1) {
      while (label.length > 1 && ctx.measureText(label + "…").width > maxW) label = label.slice(0, -1);
      label += "…";
    }
    const hpText = t.hp > 0 ? "HP " + t.hp : null;
    const hpF = hpText ? clampNum(fp * 0.85, 7, 13) : 0;
    ctx.font = `700 ${fp}px system-ui`;
    const nameW = ctx.measureText(label).width;
    let hpW = 0;
    if (hpText) { ctx.font = `600 ${hpF}px system-ui`; hpW = ctx.measureText(hpText).width; }
    const padX = Math.max(3, fp * 0.3);
    const pillW = Math.max(nameW, hpW) + padX * 2;
    const nameH = fp * 1.3;
    const totalH = nameH + (hpText ? 1 + hpF * 1.25 : 0);
    return { t, fp, label, hpText, hpF, pillW, nameH, totalH };
  }

  drawTokenLabel(it) {
    const ctx = this.ctx;
    const sc = this.camera.scale;
    const t = it.t;
    const [px, py] = this.w2s(t.x, t.y);
    const pw = t.w * sc, ph = t.h * sc;
    const gap = Math.max(2, sc * 0.1);
    const top = it.dir === "above" ? py - gap - it.totalH : py + ph + gap;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    this.roundRect(px + pw / 2 - it.pillW / 2, top, it.pillW, it.totalH, Math.min(6, it.totalH / 2));
    ctx.fill();

    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = `700 ${it.fp}px system-ui`;
    ctx.fillStyle = "#fff";
    ctx.fillText(it.label, px + pw / 2, top + (it.nameH - it.fp) / 2 + 0.5);
    if (it.hpText) {
      ctx.font = `600 ${it.hpF}px system-ui`;
      ctx.fillStyle = "#cfe8cf";
      ctx.fillText(it.hpText, px + pw / 2, top + it.nameH + 1 + (it.hpF * 1.25 - it.hpF) / 2 + 0.5);
    }
  }

  drawInitial(t, x, y, w, h, color) {
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    const cx = x + w / 2, cy = y + h / 2;
    const r = Math.min(w, h) * 0.32;
    ctx.fillStyle = hexToRgba(color, 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${clampNum(this.camera.scale * 0.34, 7, 16)}px system-ui`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((t.name || "?").trim().charAt(0).toUpperCase(), cx, cy + 1);
  }

  drawImageCover(img, x, y, w, h) {
    const ctx = this.ctx;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rr); return; }
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
