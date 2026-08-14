// Offline table: mirrors the room server in the browser so Local and
// Solo tables work with no socket at all. Same doc model, same message
// shapes, same rpc names — the App treats it exactly like the network.

const SAVE_KEY = "battleboard_local_table_v1";
const COLS = 22, ROWS = 17;
const MAX_TOKENS = 300, MAX_WALLS = 1000, MAX_CHAT = 60;

function cleanName(s) {
  return String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24) || "You";
}
function cleanText(s) {
  return String(s || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 500);
}
function num(v, def) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return def;
}
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function saneColor(col) {
  if (typeof col === "string") {
    const m = col.match(/^#([0-9a-fA-F]{6})$/);
    if (m) return "#" + m[1].toLowerCase();
    const m3 = col.match(/^#([0-9a-fA-F]{3})$/);
    if (m3) { const r = m3[1][0]; return "#" + r + r + m3[1][1] + m3[1][1] + m3[1][2] + m3[1][2]; }
  }
  return "";
}
function saneImg(url) {
  if (typeof url !== "string") return "";
  url = url.trim();
  if (/^https?:\/\//.test(url) || /^data:image\//.test(url)) return url.slice(0, 300);
  return "";
}
function safeParse(data) {
  try { return JSON.parse(data); } catch (e) { return null; }
}

export function makeLocalSocket({ resume } = {}) {
  const socket = new EventTarget();
  const myId = "local";
  let name = cleanName(localStorage.getItem("battleboard_name"));
  let doc = null;

  if (resume) {
    try {
      const p = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (p && typeof p === "object") doc = p;
    } catch (e) { doc = null; }
  }
  if (!doc) doc = { walls: [], tokens: [], chat: [], dmId: myId, enforceLos: false, mapImage: "", initCurrent: "" };
  doc.dmId = myId;
  if (!Array.isArray(doc.walls)) doc.walls = [];
  if (!Array.isArray(doc.tokens)) doc.tokens = [];
  if (!Array.isArray(doc.chat)) doc.chat = [];
  if (typeof doc.enforceLos !== "boolean") doc.enforceLos = false;
  if (typeof doc.mapImage !== "string") doc.mapImage = "";
  if (typeof doc.initCurrent !== "string") doc.initCurrent = "";

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(doc)); } catch (e) {}
  }
  function emit(obj) {
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(obj) }));
  }
  function emitState() { emit({ t: "state", doc }); }
  function players() { return [{ id: myId, name, isDm: true }]; }
  function genId() {
    let id;
    do { id = "t" + Math.floor(Math.random() * 1e15).toString(36); }
    while (doc.tokens.some(t => t.id === id));
    return id;
  }
  function freeCell() {
    const start = Math.floor(Math.random() * ROWS);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const yy = (y + start) % ROWS;
        let busy = false;
        for (const t of doc.tokens) {
          if (x >= t.x && x < t.x + t.w && yy >= t.y && yy < t.y + t.h) { busy = true; break; }
        }
        if (!busy) return { x, y: yy };
      }
    }
    return { x: 0, y: 0 };
  }
  function findToken(id) { return doc.tokens.find(t => t.id === id) || null; }

  const rpcFns = {
    setName(data) {
      const d = safeParse(data);
      const n = cleanName(d && d.name);
      if (n) { name = n; emit({ t: "presence", players: players() }); save(); }
      return Promise.resolve("ok");
    },
    claimDM(data) { doc.dmId = myId; save(); emitState(); return Promise.resolve("ok"); },
    releaseDM(data) { doc.dmId = ""; save(); emitState(); return Promise.resolve("ok"); },
    importChars(data) {
      const d = safeParse(data);
      const chars = (d && Array.isArray(d.chars)) ? d.chars : [];
      let made = 0;
      for (let i = 0; i < chars.length && doc.tokens.length < MAX_TOKENS; i++) {
        const ch = chars[i] || {};
        const nm = cleanText(ch.name || "") || "Token";
        let cell = freeCell();
        const rx = clamp(Math.round(num(ch.x, cell.x)), 0, COLS - 1);
        const ry = clamp(Math.round(num(ch.y, cell.y)), 0, ROWS - 1);
        doc.tokens.push({
          id: genId(), name: nm.slice(0, 40), owner: name,
          color: saneColor(ch.color) || "#4a76d9",
          img: saneImg(ch.img),
          hp: num(ch.hp, 0),
          vision: clamp(num(ch.vision, 12), 0, 60),
          w: clamp(Math.round(num(ch.w, 1)) || 1, 1, 8),
          h: clamp(Math.round(num(ch.h, 1)) || 1, 1, 8),
          x: rx, y: ry,
          init: 0,
          inTracker: false
        });
        made++;
      }
      if (!made) return Promise.reject(new Error("no tokens created"));
      save(); emitState();
      return Promise.resolve("ok:" + made);
    },
    moveToken(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      t.x = clamp(num(d.x, t.x), 0, COLS - t.w);
      t.y = clamp(num(d.y, t.y), 0, ROWS - t.h);
      save(); emitState(); return Promise.resolve("ok");
    },
    resizeToken(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      t.w = clamp(Math.round(num(d.w, t.w)) || 1, 1, 8);
      t.h = clamp(Math.round(num(d.h, t.h)) || 1, 1, 8);
      t.x = clamp(t.x, 0, COLS - t.w);
      t.y = clamp(t.y, 0, ROWS - t.h);
      save(); emitState(); return Promise.resolve("ok");
    },
    deleteToken(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      doc.tokens = doc.tokens.filter(k => k.id !== t.id);
      if (doc.initCurrent === t.id) doc.initCurrent = "";
      save(); emitState(); return Promise.resolve("ok");
    },
    setTokenInit(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      t.init = clamp(num(d && d.init, 0), 0, 999);
      save(); emitState(); return Promise.resolve("ok");
    },
    initAdd(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      if (t.inTracker) return Promise.resolve("ok");
      t.inTracker = true;
      if (!doc.initCurrent) doc.initCurrent = t.id;
      save(); emitState(); return Promise.resolve("ok");
    },
    initRemove(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      t.inTracker = false;
      t.init = 0;
      if (doc.initCurrent === t.id) doc.initCurrent = "";
      save(); emitState(); return Promise.resolve("ok");
    },
    initNext(data) {
      const list = [];
      for (let i = 0; i < doc.tokens.length; i++) if (doc.tokens[i].inTracker) list.push(doc.tokens[i]);
      list.sort((a, b) => num(b.init, 0) - num(a.init, 0));
      if (!list.length) { doc.initCurrent = ""; save(); emitState(); return Promise.resolve("ok"); }
      let idx = -1;
      for (let i = 0; i < list.length; i++) if (list[i].id === doc.initCurrent) { idx = i; break; }
      doc.initCurrent = list[(idx + 1) % list.length].id;
      save(); emitState(); return Promise.resolve("ok");
    },
    initGoto(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      t.inTracker = true;
      doc.initCurrent = t.id;
      save(); emitState(); return Promise.resolve("ok");
    },
    addWall(data) {
      const d = safeParse(data);
      const x1 = clamp(num(d && d.x1, 0), 0, COLS), y1 = clamp(num(d && d.y1, 0), 0, ROWS);
      const x2 = clamp(num(d && d.x2, 0), 0, COLS), y2 = clamp(num(d && d.y2, 0), 0, ROWS);
      if (Math.abs(x2 - x1) < 0.4 && Math.abs(y2 - y1) < 0.4) return Promise.reject(new Error("wall too short"));
      if (doc.walls.length >= MAX_WALLS) return Promise.reject(new Error("too many walls"));
      doc.walls.push({ id: genId(), x1, y1, x2, y2 });
      save(); emitState(); return Promise.resolve("ok");
    },
    deleteWall(data) {
      const d = safeParse(data);
      const before = doc.walls.length;
      doc.walls = doc.walls.filter(w => w.id !== String(d && d.id));
      if (doc.walls.length === before) return Promise.reject(new Error("wall not found"));
      save(); emitState(); return Promise.resolve("ok");
    },
    clearMap(data) { doc.walls = []; doc.tokens = []; doc.initCurrent = ""; save(); emitState(); return Promise.resolve("ok"); },
    toggleLos(data) {
      const d = safeParse(data);
      if (d && typeof d.on === "boolean") doc.enforceLos = d.on;
      else doc.enforceLos = !doc.enforceLos;
      save(); emitState(); return Promise.resolve("ok");
    },
    setMap(data) {
      const d = safeParse(data);
      const image = String((d && d.image) || "").trim().slice(0, 500);
      if (image && !/^https?:\/\//.test(image)) return Promise.reject(new Error("invalid image url"));
      doc.mapImage = image;
      save(); emitState(); return Promise.resolve("ok");
    },
    chat(data) {
      const d = safeParse(data);
      const text = cleanText(d && d.text);
      if (!text) return Promise.reject(new Error("empty message"));
      const msg = { n: name, x: text, ts: Date.now() };
      doc.chat.push(msg);
      if (doc.chat.length > MAX_CHAT) doc.chat.shift();
      save();
      emit({ t: "chat", n: name, x: text, ts: msg.ts });
      return Promise.resolve("ok");
    }
  };
  socket.rpc = rpcFns;

  setTimeout(() => {
    socket.dispatchEvent(new Event("open"));
    emit({ t: "welcome", code: "LOCAL", yourId: myId, doc, players: players() });
  }, 25);

  return socket;
}

export function clearLocalSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}
export function hasLocalSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
