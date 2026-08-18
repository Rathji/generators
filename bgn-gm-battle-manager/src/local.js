// GM Battle Manager — local table store. Single-user, no server, no network.
// The whole table (tokens, HP, initiative, round, effects) lives in the browser
// and auto-saves to localStorage; the App talks to it exactly like a socket.

const SAVE_KEY = "battleboard_local_table_v1";
const COLS = 22, ROWS = 17;
const MAX_TOKENS = 300;

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
function saneTypes(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    const s = String(x || "").toLowerCase().trim().slice(0, 20);
    if (s && out.indexOf(s) === -1) out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}
function saneSaves(v) {
  const def = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  if (!v || typeof v !== "object") return def;
  for (const k of Object.keys(def)) def[k] = clamp(Math.round(num(v[k], 0)), -20, 20);
  return def;
}
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const SKILL_KEYS = ["acrobatics", "animal handling", "arcana", "athletics", "deception", "history", "insight", "intimidation", "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight of hand", "stealth", "survival"];
function abilityMod(score) {
  const s = clamp(Math.round(num(score, 10)), 1, 30);
  return Math.floor((s - 10) / 2);
}
function saneAbilities(v) {
  const def = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  if (!v || typeof v !== "object") return def;
  for (const k of ABILITY_KEYS) def[k] = clamp(Math.round(num(v[k], 10)), 1, 30);
  return def;
}
function saneAbilitiesFromSaves(saves) {
  const s = saneSaves(saves);
  const ab = {};
  for (const k of ABILITY_KEYS) ab[k] = clamp(s[k] * 2 + 10, 1, 30);
  return ab;
}
function saneKeyList(v, allowed) {
  const out = [];
  if (!Array.isArray(v)) return out;
  for (const x of v) {
    const k = String(x || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (allowed.indexOf(k) !== -1 && out.indexOf(k) === -1) out.push(k);
  }
  return out;
}
function saneSkillProf(v) {
  const out = {};
  if (!v || typeof v !== "object") return out;
  for (const k of SKILL_KEYS) {
    const lv = num(v[k], 0);
    if (lv === 0.5 || lv === 1 || lv === 2) out[k] = lv;
  }
  return out;
}
function deriveSaves(t) {
  const ab = saneAbilities(t && t.abilities);
  const prof = clamp(Math.round(num(t && t.profBonus, 2)), 1, 20);
  const sp = saneKeyList(t && t.saveProf, ABILITY_KEYS);
  t.saves = {};
  for (const k of ABILITY_KEYS) t.saves[k] = clamp(abilityMod(ab[k]) + (sp.indexOf(k) !== -1 ? prof : 0), -20, 20);
}
function saneToken(t, idx) {
  const hasAb = !!(t && t.abilities && typeof t.abilities === "object");
  const abilities = hasAb ? saneAbilities(t.abilities) : saneAbilitiesFromSaves(t && t.saves);
  const profBonus = clamp(Math.round(num(t && t.profBonus, 2)), 1, 20);
  const token = {
    id: String((t && t.id) || ("t" + Math.floor(Math.random() * 1e15).toString(36) + idx)),
    name: cleanText(t && t.name) || "Token",
    owner: "GM",
    color: saneColor(t && t.color) || "#4a76d9",
    img: saneImg(t && t.img),
    hp: clamp(Math.round(num(t && t.hp, 0)), 0, 99999),
    maxHp: clamp(Math.round(num(t && t.maxHp, t && t.hp)), 0, 99999) || 0,
    w: clamp(Math.round(num(t && t.w, 1)) || 1, 1, 8),
    h: clamp(Math.round(num(t && t.h, 1)) || 1, 1, 8),
    x: clamp(Math.round(num(t && t.x, idx % COLS)), 0, COLS - 1),
    y: clamp(Math.round(num(t && t.y, Math.floor(idx / COLS))), 0, ROWS - 1),
    init: clamp(Math.round(num(t && t.init, 0)), 0, 999),
    inTracker: !!(t && t.inTracker),
    effects: Array.isArray(t && t.effects) ? t.effects.filter(e => e && e.id) : [],
    ac: clamp(Math.round(num(t && t.ac, 10)), 0, 99),
    atk: clamp(Math.round(num(t && t.atk, 0)), -20, 99),
    dmg: String((t && t.dmg) || "1d6").trim().slice(0, 24) || "1d6",
    abilities,
    profBonus,
    saveProf: saneKeyList(t && t.saveProf, ABILITY_KEYS),
    skillProf: saneSkillProf(t && t.skillProf),
    hd: String((t && t.hd) || "").replace(/\s+/g, "").toLowerCase().slice(0, 24),
    condImm: saneTypes(t && t.condImm),
    langs: cleanText(t && t.langs).slice(0, 80),
    imm: saneTypes(t && t.imm),
    res: saneTypes(t && t.res),
    vuln: saneTypes(t && t.vuln),
    group: cleanText(t && t.group).slice(0, 30),
    conc: cleanText(t && t.conc).slice(0, 40),
    deathF: clamp(Math.round(num(t && t.deathF, 0)), 0, 3),
    deathS: clamp(Math.round(num(t && t.deathS, 0)), 0, 3),
    deathStable: !!(t && t.deathStable)
  };
  deriveSaves(token);
  return token;
}
function normalizeDoc(p) {
  const doc = {
    tokens: Array.isArray(p.tokens) ? p.tokens.map(saneToken) : [],
    initCurrent: typeof p.initCurrent === "string" ? p.initCurrent : "",
    round: Number.isFinite(p.round) ? Math.max(0, p.round) : 0
  };
  if (doc.initCurrent && !doc.tokens.some(t => t.id === doc.initCurrent)) doc.initCurrent = "";
  for (const t of doc.tokens) t.inTracker = true;
  return doc;
}

export function makeLocalSocket({ resume } = {}) {
  const socket = new EventTarget();
  const name = "GM";
  let doc = null;

  if (resume) {
    try {
      const p = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (p && typeof p === "object") doc = normalizeDoc(p);
    } catch (e) { doc = null; }
  }
  if (!doc) doc = { tokens: [], initCurrent: "", round: 0 };

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(doc)); } catch (e) {}
  }
  function emit(obj) {
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(obj) }));
  }
  function emitState() { emit({ t: "state", doc }); }
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
        const hp = clamp(Math.round(num(ch.hp, 0)), 0, 99999);
        const hasAb = !!(ch.abilities && typeof ch.abilities === "object");
        const abilities = hasAb ? saneAbilities(ch.abilities) : saneAbilitiesFromSaves(ch.saves);
        doc.tokens.push({
          id: genId(), name: nm.slice(0, 40), owner: name,
          color: saneColor(ch.color) || "#4a76d9",
          img: saneImg(ch.img),
          hp,
          maxHp: clamp(Math.round(num(ch.maxHp, hp)), 0, 99999) || hp,
          w: clamp(Math.round(num(ch.w, 1)) || 1, 1, 8),
          h: clamp(Math.round(num(ch.h, 1)) || 1, 1, 8),
          x: rx, y: ry,
          init: 0,
          inTracker: true,
          effects: [],
          ac: clamp(Math.round(num(ch.ac, 10)), 0, 99),
          atk: clamp(Math.round(num(ch.atk, 0)), -20, 99),
          dmg: String((ch.dmg) || "1d6").trim().slice(0, 24) || "1d6",
          abilities,
          profBonus: clamp(Math.round(num(ch.profBonus, 2)), 1, 20),
          saveProf: saneKeyList(ch.saveProf, ABILITY_KEYS),
          skillProf: saneSkillProf(ch.skillProf),
          hd: String((ch.hd) || "").replace(/\s+/g, "").toLowerCase().slice(0, 24),
          condImm: saneTypes(ch.condImm),
          langs: cleanText(ch.langs).slice(0, 80),
          imm: saneTypes(ch.imm),
          res: saneTypes(ch.res),
          vuln: saneTypes(ch.vuln),
          group: cleanText(ch.group).slice(0, 30)
        });
        deriveSaves(doc.tokens[doc.tokens.length - 1]);
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
      t.init = clamp(Math.round(num(d && d.init, 0)), 0, 999);
      save(); emitState(); return Promise.resolve("ok");
    },
    setHp(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      if (d && d.maxHp != null) t.maxHp = clamp(Math.round(num(d.maxHp, t.maxHp)), 0, 99999);
      if (d && d.hp != null) t.hp = clamp(Math.round(num(d.hp, t.hp)), 0, 99999);
      if (t.hp > 0) { t.deathF = 0; t.deathS = 0; t.deathStable = false; }
      save(); emitState(); return Promise.resolve("ok");
    },
    setCombatStats(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      if (d.ac != null) t.ac = clamp(Math.round(num(d.ac, 10)), 0, 99);
      if (d.atk != null) t.atk = clamp(Math.round(num(d.atk, 0)), -20, 99);
      if (d.dmg != null) t.dmg = String(d.dmg).replace(/\s+/g, "").slice(0, 24) || "1d6";
      if (d.saves != null && d.abilities == null) t.abilities = saneAbilitiesFromSaves(d.saves);
      if (d.abilities != null) t.abilities = saneAbilities(d.abilities);
      if (d.profBonus != null) t.profBonus = clamp(Math.round(num(d.profBonus, 2)), 1, 20);
      if (d.saveProf != null) t.saveProf = saneKeyList(d.saveProf, ABILITY_KEYS);
      if (d.skillProf != null) t.skillProf = saneSkillProf(d.skillProf);
      if (d.hd != null) t.hd = String(d.hd).replace(/\s+/g, "").toLowerCase().slice(0, 24);
      if (d.condImm != null) t.condImm = saneTypes(d.condImm);
      if (d.langs != null) t.langs = cleanText(d.langs).slice(0, 80);
      if (d.saves != null || d.abilities != null || d.profBonus != null || d.saveProf != null) deriveSaves(t);
      if (d.imm != null) t.imm = saneTypes(d.imm);
      if (d.res != null) t.res = saneTypes(d.res);
      if (d.vuln != null) t.vuln = saneTypes(d.vuln);
      if (d.group != null) t.group = cleanText(d.group).slice(0, 30);
      if (d.conc != null) t.conc = cleanText(d.conc).slice(0, 40);
      save(); emitState(); return Promise.resolve("ok");
    },
    setDeathSaves(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      if (d.fails != null) t.deathF = clamp(Math.round(num(d.fails, 0)), 0, 3);
      if (d.successes != null) t.deathS = clamp(Math.round(num(d.successes, 0)), 0, 3);
      if (d.stable != null) t.deathStable = !!d.stable;
      save(); emitState(); return Promise.resolve("ok");
    },
    addEffect(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      if (!Array.isArray(t.effects)) t.effects = [];
      if (t.effects.length >= 20) return Promise.reject(new Error("too many effects"));
      const en = String((d && d.name) || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const type = String((d && d.type) || "").toLowerCase();
      if (type !== "ability" && type !== "skill" && type !== "save" && type !== "attack") return Promise.reject(new Error("invalid effect type"));
      const stat = String((d && d.stat) || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
      const bonus = clamp(Math.round(num(d && d.bonus, 0)), -20, 20);
      if (!en) return Promise.reject(new Error("invalid effect"));
      const eff = { id: genId(), name: en, type, stat, bonus, source: name, ts: Date.now() };
      if (d && d.cond) eff.cond = true;
      const durType = String((d && d.durType) || "").toLowerCase();
      const durValue = clamp(Math.round(num(d && d.durValue, 1)), 0, 9999);
      if (durType === "rounds" && durValue > 0) { eff.durRounds = Math.min(durValue, 999); eff.startRound = doc.round || 0; }
      t.effects.push(eff);
      save(); emitState(); return Promise.resolve("ok");
    },
    removeEffect(data) {
      const d = safeParse(data);
      const t = findToken(String(d && d.id));
      if (!t) return Promise.reject(new Error("token not found"));
      if (!Array.isArray(t.effects)) return Promise.reject(new Error("effect not found"));
      const before = t.effects.length;
      t.effects = t.effects.filter(e => e.id !== String(d && d.effectId));
      if (t.effects.length === before) return Promise.reject(new Error("effect not found"));
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
      const nextIdx = (idx + 1) % list.length;
      if (idx >= 0 && nextIdx === 0) doc.round = (doc.round || 0) + 1;
      doc.initCurrent = list[nextIdx].id;
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
    clearMap(data) { doc.tokens = []; doc.initCurrent = ""; doc.round = 0; save(); emitState(); return Promise.resolve("ok"); }
  };
  socket.rpc = rpcFns;

  setTimeout(() => {
    socket.dispatchEvent(new Event("open"));
    emit({ t: "welcome", code: "LOCAL", yourId: "local", doc });
  }, 25);

  return socket;
}

export function clearLocalSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}
export function hasLocalSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
}
