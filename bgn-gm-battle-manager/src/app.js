// GM Battle Manager client — local networking, initiative tracker, HP, effects.
// Single-user: the "network" is a local table store (src/local.js), so all
// state (combatants, HP, initiative, round, effects) is this browser's alone.
import { SocketClient } from "./net.js";
import { makeLocalSocket, clearLocalSave } from "./local.js";
import { COMPENDIUM } from "./compendium.js";

const SAMPLE_IMPORT = `[{"name":"Gandalf","color":"#4a76d9","hp":45},
{"name":"Aragorn","color":"#45a968","hp":60},
{"name":"Orc1","color":"#d05454","hp":11},
{"name":"Orc2","color":"#d05454","hp":11}]`;

const DEFAULT_CHARACTERS = [
  { id: "fighter", race: "Human", klass: "Fighter", color: "#d05454", hp: 45,
    male: { name: "Aldric", img: "https://user.uploads.dev/file/9b22173ce4bc819ccc495b4dbe1b4e1a.webp" },
    female: { name: "Sigrun", img: "https://user.uploads.dev/file/0147ba876ed8d70819f1422c1b759cf3.webp" } },
  { id: "ranger", race: "Elf", klass: "Ranger", color: "#45a968", hp: 38,
    male: { name: "Thalion", img: "https://user.uploads.dev/file/cfb022807d6717a48592864d44902c31.webp" },
    female: { name: "Sylva", img: "https://user.uploads.dev/file/d7278e164834d29dc7e5122b8013a7fb.webp" } },
  { id: "cleric", race: "Dwarf", klass: "Cleric", color: "#b8792f", hp: 40,
    male: { name: "Borin", img: "https://user.uploads.dev/file/248690a8a504fcfbd48da7e35b7d3c36.webp" },
    female: { name: "Freydis", img: "https://user.uploads.dev/file/605722da6594ff10a12c2ac80a6d49d7.webp" } },
  { id: "barbarian", race: "Half-Orc", klass: "Barbarian", color: "#9a6ec4", hp: 60,
    male: { name: "Grok", img: "https://user.uploads.dev/file/fe6d514dc2409b6d0d162cf56a40a89f.webp" },
    female: { name: "Ugga", img: "https://user.uploads.dev/file/925b14663efb9793d670b30548c1b54d.webp" } },
  { id: "wizard", race: "Halfling", klass: "Wizard", color: "#4a76d9", hp: 30,
    male: { name: "Pip", img: "https://user.uploads.dev/file/f798dba782068ee90d076a3122d9c1d6.webp" },
    female: { name: "Marnie", img: "https://user.uploads.dev/file/d1bac5cf1ebf7732d22f9bfe3c67f6b5.webp" } }
];

const NPC_CHARACTERS = [
  { id: "npc-marcus", name: "Marcus", gender: "♂ male", role: "Dwarf Blacksmith", color: "#c96f2e", hp: 22, img: "https://user.uploads.dev/file/5c66a68ca4982ca5ac17a1c1c5f10385.jpg" },
  { id: "npc-elias", name: "Elias", gender: "♂ male", role: "Human Merchant", color: "#4a76d9", hp: 18, img: "https://user.uploads.dev/file/69d54fbd81efb7fc57dec05a4e286e0b.jpg" },
  { id: "npc-rosalind", name: "Rosalind", gender: "♀ female", role: "Human Innkeeper", color: "#d05454", hp: 20, img: "https://user.uploads.dev/file/23d39a77820f47a955cd570f98794eb7.jpg" },
  { id: "npc-alba", name: "Alba", gender: "♀ female", role: "Elf Herbalist", color: "#45a968", hp: 19, img: "https://user.uploads.dev/file/feddcbfaf4ca77620e283ec0be3ac136.jpg" }
];

const BOSSES = [
  { id: "boss-dragon", name: "Dragon", color: "#d64545", hp: 200, w: 3, h: 3, img: "https://user.uploads.dev/file/20164fde855e243e54a901dcc5b443cc.jpg" },
  { id: "boss-spider", name: "Huge Spider", color: "#8a4fa8", hp: 80, w: 3, h: 3, img: "https://user.uploads.dev/file/c87dd08fc54fdd8575df58596622a045.jpg" },
  { id: "boss-giant", name: "Storm Giant", color: "#4a7ab9", hp: 162, w: 2, h: 2, img: "https://user.uploads.dev/file/1c71a7c3b576b5c7a6c846b6fccad1aa.jpg" }
];

const EFFECT_TYPES = {
  ability: { label: "Ability", color: "#6ab7ff" },
  skill: { label: "Skill", color: "#7ee0a1" },
  save: { label: "Save", color: "#ffb054" },
  attack: { label: "Attack", color: "#ff6b6b" }
};
const EFFECT_STATS = {
  ability: [["str", "Strength (STR)"], ["dex", "Dexterity (DEX)"], ["con", "Constitution (CON)"], ["int", "Intelligence (INT)"], ["wis", "Wisdom (WIS)"], ["cha", "Charisma (CHA)"], ["all", "All abilities"]],
  skill: [["acrobatics", "Acrobatics"], ["animal handling", "Animal Handling"], ["arcana", "Arcana"], ["athletics", "Athletics"], ["deception", "Deception"], ["history", "History"], ["insight", "Insight"], ["intimidation", "Intimidation"], ["investigation", "Investigation"], ["medicine", "Medicine"], ["nature", "Nature"], ["perception", "Perception"], ["performance", "Performance"], ["persuasion", "Persuasion"], ["religion", "Religion"], ["sleight of hand", "Sleight of Hand"], ["stealth", "Stealth"], ["survival", "Survival"], ["all", "All skills"]],
  save: [["str", "Strength save"], ["dex", "Dexterity save"], ["con", "Constitution save"], ["int", "Intelligence save"], ["wis", "Wisdom save"], ["cha", "Charisma save"], ["all", "All saves"]],
  attack: [["melee", "Melee"], ["ranged", "Ranged"], ["spell", "Spell"], ["all", "All attacks"]]
};

const CHECK_OPTIONS = [
  ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"],
  ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"],
  ["acrobatics", "Acrobatics"], ["animal handling", "Animal Handling"], ["arcana", "Arcana"],
  ["athletics", "Athletics"], ["deception", "Deception"], ["history", "History"],
  ["insight", "Insight"], ["intimidation", "Intimidation"], ["investigation", "Investigation"],
  ["medicine", "Medicine"], ["nature", "Nature"], ["perception", "Perception"],
  ["performance", "Performance"], ["persuasion", "Persuasion"], ["religion", "Religion"],
  ["sleight of hand", "Sleight of Hand"], ["stealth", "Stealth"], ["survival", "Survival"]
];

const ABILITY_LABELS = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };
const ABILITY_FULL = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const SKILL_ABILITIES = {
  acrobatics: "dex", "animal handling": "wis", arcana: "int", athletics: "str", deception: "cha",
  history: "int", insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis",
  nature: "int", perception: "wis", performance: "cha", persuasion: "cha", religion: "int",
  "sleight of hand": "dex", stealth: "dex", survival: "wis"
};
const SKILL_LEVEL_LABELS = { 1: "✧", 2: "✧✧", 0.5: "½" };

// Standard dnd5e conditions. Each bundles rules-backed modifiers expressed in
// the four effect types (flat −2 ≈ disadvantage, +2 ≈ advantage). Conditions
// with no bundle are pure status markers — their hard rules (no actions, save
// auto-fails, movement locks, crits) are excluded until the combat engine lands.
const CONDITIONS = {
  blinded: { label: "Blinded", color: "#a8b0bd", effects: [{ type: "attack", stat: "all", bonus: -2 }, { type: "skill", stat: "perception", bonus: -2 }] },
  charmed: { label: "Charmed", color: "#e67eb0", effects: [] },
  deafened: { label: "Deafened", color: "#c9a06a", effects: [{ type: "skill", stat: "perception", bonus: -2 }] },
  exhausted: { label: "Exhaustion", color: "#8f9aa8", effects: [{ type: "ability", stat: "all", bonus: -2 }] },
  frightened: { label: "Frightened", color: "#7d6fd0", effects: [{ type: "attack", stat: "all", bonus: -2 }, { type: "ability", stat: "all", bonus: -2 }] },
  grappled: { label: "Grappled", color: "#7a8b6f", effects: [] },
  incapacitated: { label: "Incapacitated", color: "#6b7280", effects: [] },
  invisible: { label: "Invisible", color: "#bfe3e8", effects: [{ type: "attack", stat: "all", bonus: 2 }] },
  paralyzed: { label: "Paralyzed", color: "#e8d5a8", effects: [] },
  petrified: { label: "Petrified", color: "#c9ccd1", effects: [] },
  poisoned: { label: "Poisoned", color: "#7ecf6a", effects: [{ type: "attack", stat: "all", bonus: -2 }, { type: "ability", stat: "all", bonus: -2 }] },
  prone: { label: "Prone", color: "#c98d5a", effects: [{ type: "attack", stat: "all", bonus: -2 }] },
  restrained: { label: "Restrained", color: "#5abfb5", effects: [{ type: "attack", stat: "all", bonus: -2 }, { type: "save", stat: "dex", bonus: -2 }, { type: "ability", stat: "dex", bonus: -2 }] },
  stunned: { label: "Stunned", color: "#e8d84f", effects: [] },
  unconscious: { label: "Unconscious", color: "#565c66", effects: [] }
};

function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
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
      maxHp: c.maxHp != null ? Number(c.maxHp) : null,
      color: String(c.color || "").trim(),
      img: String(c.img || "").trim(),
      w: Number(c.w) || 1,
      h: Number(c.h) || 1
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
      maxHp: null,
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
    this.resume = !!(opts && opts.resume);
    this.destroyed = false;

    this.state = { tokens: [], initCurrent: "", round: 0 };
    this.initSortDir = "desc";
    this._initSig = "";
    this._collapsedGroups = new Set();
    this.effTargetId = null;
    this.toastTimer = 0;

    this.net = null;
    this.getSocket = (opts && opts.getSocket) || null;

    this.bindUi();
    this.ui.importInput.value = SAMPLE_IMPORT;
    this.connect();
  }

  // ---------- "networking" ----------
  // Local mode wraps a local table store (src/local.js) over the same
  // socket shape the app expects. Online mode shares the server-plugin
  // socket owned by the table script: RPCs go through its `.rpc` methods
  // and the table script feeds `applyDoc` from the room's latestSnapshot.

  connect() {
    if (this.destroyed) return;
    if (this.getSocket) {
      this.net = {
        connected: true,
        rpc: (name, payload) => {
          const s = this.getSocket();
          if (!s || s.readyState !== 1) return Promise.reject(new Error("not connected"));
          return s.rpc[name](JSON.stringify(payload));
        }
      };
      return;
    }
    if (this.net) { if (!this.net.connected && !this.net.closed) this.net.connect(); return; }
    this.net = new SocketClient({
      create: () => makeLocalSocket({ resume: this.resume }),
      onMessage: (m) => this.onMessage(m),
      onStatus: () => {}
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

  onMessage(msg) {
    if (this.destroyed) return;
    if (msg.t === "welcome") this.onWelcome(msg);
    else if (msg.t === "state") this.applyDoc(msg.doc);
  }

  onWelcome(msg) {
    this.myId = msg.yourId;
    this.applyDoc(msg.doc);
  }

  applyDoc(doc) {
    if (!doc) return;
    if (Array.isArray(doc.tokens)) this.mergeTokens(doc.tokens);
    if (typeof doc.initCurrent === "string" && doc.initCurrent !== this.state.initCurrent) {
      this.state.initCurrent = doc.initCurrent;
    }
    if (typeof doc.round === "number" && doc.round !== this.state.round) {
      this.state.round = doc.round;
    }
    this.renderInitRound();
    this.checkEffectExpiry();
    this.renderInit();
  }

  mergeTokens(serverTokens) {
    const byId = new Map(this.state.tokens.map(t => [t.id, t]));
    const next = [];
    for (const st of serverTokens) {
      const ex = byId.get(st.id);
      if (ex) {
        ex.x = st.x; ex.y = st.y; ex.w = st.w; ex.h = st.h;
        ex.owner = st.owner; ex.name = st.name; ex.color = st.color;
        ex.img = st.img; ex.hp = st.hp; ex.maxHp = st.maxHp;
        ex.init = st.init || 0; ex.inTracker = !!st.inTracker;
        ex.effects = Array.isArray(st.effects) ? st.effects : [];
        ex.ac = st.ac; ex.atk = st.atk; ex.dmg = st.dmg;
        ex.saves = st.saves; ex.abilities = st.abilities; ex.profBonus = st.profBonus;
        ex.saveProf = st.saveProf || []; ex.skillProf = st.skillProf || {};
        ex.hd = st.hd || ""; ex.condImm = st.condImm || []; ex.langs = st.langs || "";
        ex.imm = st.imm || []; ex.res = st.res || []; ex.vuln = st.vuln || [];
        ex.group = st.group || ""; ex.conc = st.conc || "";
        ex.deathF = st.deathF || 0; ex.deathS = st.deathS || 0; ex.deathStable = !!st.deathStable;
        next.push(ex);
      } else {
        const nt = { ...st };
        if (!Array.isArray(nt.effects)) nt.effects = [];
        if (nt.maxHp == null) nt.maxHp = nt.hp || 0;
        next.push(nt);
      }
    }
    this.state.tokens = next;
    if (this.effTargetId && !byId.has(this.effTargetId)) this.closeEffectsDialog();
    else if (this.effTargetId && this.ui.effectsOverlay && !this.ui.effectsOverlay.hidden) {
      this.renderEffectsList();
      this.renderHpInputs();
      this.renderCombatStats();
    }
  }

  rpc(name, payload) {
    return this.net.rpc(name, payload).then(r => {
      if (typeof r === "string" && r.startsWith("ok")) {
        const n = Number(r.split(":").pop());
        return Number.isFinite(n) && r.includes(":") ? n : true;
      }
      return r;
    });
  }

  // ---------- hit points ----------

  renderHpInputs() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    if (document.activeElement !== this.ui.hpInput) this.ui.hpInput.value = t.hp;
    if (document.activeElement !== this.ui.maxHpInput) this.ui.maxHpInput.value = t.maxHp || t.hp;
  }

  onHpApply() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const hp = clampNum(Math.round(Number(this.ui.hpInput.value) || 0), 0, 99999);
    const maxHp = clampNum(Math.round(Number(this.ui.maxHpInput.value) || 0), 0, 99999);
    this.rpc("setHp", { id: t.id, hp, maxHp: maxHp || hp }).then(() => {
      this.toast(t.name + " HP set to " + hp + (maxHp ? " / " + maxHp : ""));
    }).catch(e => this.toast("HP failed: " + ((e && e.message) || e)));
  }

  onHpQuick(btn) {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    if (btn.dataset.full) {
      this.rpc("setHp", { id: t.id, hp: t.maxHp || t.hp }).then(() => {
        this.toast(t.name + " healed to full");
      }).catch(e => this.toast("HP failed: " + ((e && e.message) || e)));
      return;
    }
    if (btn.dataset.zero) { this.setHpZero(t); return; }
    const d = Number(btn.dataset.d) || 0;
    if (d >= 0) this.heal(t.id, d);
    else this.dealDamage(t.id, -d, "");
  }

  setHpZero(t) {
    const before = t.hp || 0;
    this.rpc("setHp", { id: t.id, hp: 0 }).then(() => {
      this.toast(t.name + " dropped to 0 HP — down!");
      this.onHpChanged(t.id, before);
      if (t.conc) this.rpc("setCombatStats", { id: t.id, conc: "" }).catch(() => {});
    }).catch(e => this.toast("HP failed: " + ((e && e.message) || e)));
  }

  quickHp(id, delta) {
    const t = this.tokenById(id);
    if (!t) return;
    if (delta >= 0) this.heal(id, delta);
    else this.dealDamage(id, -delta, "");
  }

  // ---------- combat stats ----------

  typeList(s) {
    const out = [];
    for (const raw of String(s || "").split(/[,\n;]/)) {
      const v = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 20);
      if (v && out.indexOf(v) === -1) out.push(v);
    }
    return out;
  }

  renderCombatStats() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t || this.ui.effectsOverlay.hidden) return;
    if (document.activeElement !== this.ui.csAc) this.ui.csAc.value = t.ac == null ? 10 : t.ac;
    if (document.activeElement !== this.ui.csAtk) this.ui.csAtk.value = t.atk || 0;
    if (document.activeElement !== this.ui.csDmg) this.ui.csDmg.value = t.dmg || "1d6";
    if (document.activeElement !== this.ui.csProf) this.ui.csProf.value = t.profBonus || 2;
    if (document.activeElement !== this.ui.csCondImm) this.ui.csCondImm.value = (t.condImm || []).join(", ");
    if (document.activeElement !== this.ui.csLangs) this.ui.csLangs.value = t.langs || "";
    if (document.activeElement !== this.ui.csHd) this.ui.csHd.value = t.hd || "";
    if (document.activeElement !== this.ui.csImm) this.ui.csImm.value = (t.imm || []).join(", ");
    if (document.activeElement !== this.ui.csRes) this.ui.csRes.value = (t.res || []).join(", ");
    if (document.activeElement !== this.ui.csVuln) this.ui.csVuln.value = (t.vuln || []).join(", ");
    if (document.activeElement !== this.ui.csGroup) this.ui.csGroup.value = t.group || "";
    if (document.activeElement !== this.ui.csConc) this.ui.csConc.value = t.conc || "";
    this.renderAbilities(t);
    this.renderSaveChips(t);
    this.renderSkillGrid(t);
    this.renderDeathSaves();
  }

  // ---------- ability scores → derived bonuses ----------

  abilityMod(t, stat) {
    return Math.floor(((((t.abilities && t.abilities[stat]) != null) ? t.abilities[stat] : 10) - 10) / 2);
  }

  saveBonus(t, stat) {
    return ((t.saves && t.saves[stat] != null) ? t.saves[stat] : 0) + this.effectBonusFor(t, "save", stat);
  }

  skillBase(t, skill) {
    return this.abilityMod(t, SKILL_ABILITIES[skill] || "dex");
  }

  skillBonus(t, skill) {
    const lv = (t.skillProf && t.skillProf[skill]) || 0;
    return this.skillBase(t, skill) + lv * (t.profBonus || 0) + this.effectBonusFor(t, "skill", skill);
  }

  checkBonus(t, key) {
    if (ABILITY_LABELS[key]) return this.abilityMod(t, key) + this.effectBonusFor(t, "ability", key);
    return this.skillBonus(t, key);
  }

  renderAbilities(t) {
    for (const k of Object.keys(ABILITY_LABELS)) {
      const inp = this.ui.abilScores[k];
      const mod = this.ui.abilMods[k];
      if (!inp || !mod) continue;
      if (document.activeElement !== inp) inp.value = ((t.abilities && t.abilities[k]) != null) ? t.abilities[k] : 10;
      const m = this.abilityMod(t, k);
      mod.textContent = (m >= 0 ? "+" : "") + m;
    }
  }

  renderSaveChips(t) {
    for (const chip of this.ui.saveChips) {
      const k = chip.dataset.s;
      const bonus = (t.saves && t.saves[k] != null) ? t.saves[k] : 0;
      chip.innerHTML = "";
      chip.append(el("span", null, ABILITY_LABELS[k]), document.createTextNode(" "), el("b", null, (bonus >= 0 ? "+" : "") + bonus));
      chip.classList.toggle("prof", (t.saveProf || []).includes(k));
      chip.title = ABILITY_FULL[k] + " save " + (bonus >= 0 ? "+" : "") + bonus + " = ability modifier " + (this.abilityMod(t, k) >= 0 ? "+" : "") + this.abilityMod(t, k)
        + ((t.saveProf || []).includes(k) ? " + proficiency " + (t.profBonus || 0) : "") + " — click to toggle proficiency";
    }
  }

  renderSkillGrid(t) {
    const grid = this.ui.skillGrid;
    if (!grid) return;
    grid.innerHTML = "";
    for (const [key, label] of CHECK_OPTIONS) {
      if (ABILITY_LABELS[key]) continue;
      const lv = (t.skillProf && t.skillProf[key]) || 0;
      const bonus = this.skillBonus(t, key);
      const chip = el("button", "skillChip" + (lv === 1 ? " lv1" : lv === 2 ? " lv2" : lv === 0.5 ? " lvhalf" : ""));
      chip.type = "button";
      chip.dataset.sk = key;
      chip.append(el("span", null, label), el("b", null, (bonus >= 0 ? "+" : "") + bonus + (lv ? " " + SKILL_LEVEL_LABELS[lv] : "")));
      chip.title = label + " (" + ABILITY_FULL[SKILL_ABILITIES[key]] + "): " + (bonus >= 0 ? "+" : "") + bonus + " — click to cycle none → proficient → expertise → half";
      chip.addEventListener("click", () => this.onSkillChip(key));
      grid.appendChild(chip);
    }
  }

  onAbilityChange(k) {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const abilities = {};
    for (const ab of Object.keys(ABILITY_LABELS)) abilities[ab] = clampNum(Math.round(Number(this.ui.abilScores[ab].value) || 0), 1, 30);
    this.rpc("setCombatStats", { id: t.id, abilities }).then(() => {
      const nt = this.tokenById(t.id) || t;
      this.renderAbilities(nt);
      this.renderSaveChips(nt);
      this.renderSkillGrid(nt);
      this.toast(t.name + " ability scores updated — saves & checks recalculated");
    }).catch(e => this.toast("Stats failed: " + ((e && e.message) || e)));
  }

  onProfChange() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const profBonus = clampNum(Math.round(Number(this.ui.csProf.value) || 2), 1, 20);
    this.rpc("setCombatStats", { id: t.id, profBonus }).then(() => {
      const nt = this.tokenById(t.id) || t;
      this.renderSaveChips(nt);
      this.renderSkillGrid(nt);
    }).catch(e => this.toast("Stats failed: " + ((e && e.message) || e)));
  }

  onSaveChip(k) {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const cur = (t.saveProf || []).slice();
    const i = cur.indexOf(k);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(k);
    this.rpc("setCombatStats", { id: t.id, saveProf: cur }).then(() => {
      this.renderSaveChips(this.tokenById(t.id) || t);
    }).catch(e => this.toast("Stats failed: " + ((e && e.message) || e)));
  }

  onSkillChip(key) {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const cur = { ...(t.skillProf || {}) };
    const lv = cur[key] || 0;
    const next = lv === 0 ? 1 : lv === 1 ? 2 : lv === 2 ? 0.5 : 0;
    if (next) cur[key] = next;
    else delete cur[key];
    this.rpc("setCombatStats", { id: t.id, skillProf: cur }).then(() => {
      this.renderSkillGrid(this.tokenById(t.id) || t);
    }).catch(e => this.toast("Stats failed: " + ((e && e.message) || e)));
  }

  onHdRoll() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const hd = String(t.hd || "").trim();
    if (!hd) { this.toast("No hit dice set — add e.g. 5d8 in Combat stats"); return; }
    const res = this.rollFormula(hd, false);
    const card = el("div", "diceCard dmgCard");
    card.appendChild(el("div", "diceTitle", "⏫ " + t.name + " rolls hit dice (" + hd + ")"));
    const top = el("div", "diceTop");
    top.appendChild(el("span", "diceFormula", hd));
    top.appendChild(this.formulaChips(res.rolled));
    top.appendChild(el("span", "diceTotal", "= " + res.total));
    card.appendChild(top);
    this.prependToLog(card);
    this.heal(t.id, res.total);
  }

  renderDeathSaves() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    const box = this.ui.csDeathBox;
    if (!box) return;
    if (!t || (t.hp > 0 && !(t.deathF || 0) && !(t.deathS || 0) && !t.deathStable)) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = "";
    const row = el("div", "deathBoxRow");
    const pips = (label, filled, cls) => {
      const g = el("span", "pipGroup");
      g.appendChild(el("span", "pipLabel", label));
      for (let i = 0; i < 3; i++) {
        const p = el("span", "pip " + cls + (i < filled ? " filled" : ""));
        g.appendChild(p);
      }
      return g;
    };
    row.appendChild(pips("Fails", t.deathF || 0, "fail"));
    row.appendChild(pips("Successes", t.deathS || 0, "success"));
    const btn = el("button", "btn btn-sm", "💀 Roll death save");
    btn.addEventListener("click", () => this.deathSave(t.id));
    row.appendChild(btn);
    box.appendChild(row);
    const status = el("div", "deathStatus");
    if (t.hp > 0) status.textContent = "Conscious at " + t.hp + " HP.";
    else if (t.deathStable) status.textContent = "Stable — death saves stop here. A heal brings them back to consciousness.";
    else if ((t.deathF || 0) >= 3) status.textContent = "Dead — three failed death saves.";
    else if (t.conc) status.textContent = "Down at 0 HP — concentration is lost.";
    else status.textContent = "Down at 0 HP — roll death saves: 3 fails is dead, 3 successes is stable. Damage while down counts as a failure.";
    box.appendChild(status);
  }

  onCsApply() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const payload = {
      id: t.id,
      ac: clampNum(Math.round(Number(this.ui.csAc.value) || 0), 0, 99),
      atk: clampNum(Math.round(Number(this.ui.csAtk.value) || 0), -20, 99),
      dmg: this.ui.csDmg.value.replace(/\s+/g, "").toLowerCase().slice(0, 24) || "1d6",
      imm: this.typeList(this.ui.csImm.value),
      res: this.typeList(this.ui.csRes.value),
      vuln: this.typeList(this.ui.csVuln.value),
      condImm: this.typeList(this.ui.csCondImm.value),
      langs: this.ui.csLangs.value.trim().slice(0, 80),
      hd: this.ui.csHd.value.replace(/\s+/g, "").toLowerCase().slice(0, 24) || "",
      group: this.ui.csGroup.value.replace(/\s+/g, " ").trim().slice(0, 30)
    };
    if (this.ui.csConc.value.trim()) payload.conc = this.ui.csConc.value.trim().slice(0, 40);
    else payload.conc = "";
    this.rpc("setCombatStats", payload).then(() => {
      this.toast(t.name + " combat stats updated");
    }).catch(e => this.toast("Stats failed: " + ((e && e.message) || e)));
  }

  // ---------- damage / healing / death & concentration ----------

  dealDamage(id, amt, type) {
    const t = this.tokenById(id);
    if (!t) { this.toast("Target is no longer on the tracker"); return; }
    const before = t.hp || 0;
    const typ = String(type || "").toLowerCase().trim();
    let applied = amt;
    let note = "";
    if (typ) {
      const imm = (t.imm || []).includes(typ);
      const res = (t.res || []).includes(typ);
      const vuln = (t.vuln || []).includes(typ);
      if (imm) { applied = 0; note = " — immune to " + typ + "!"; }
      else if (res) { applied = Math.ceil(amt / 2); note = " — resistance (halved)"; }
      else if (vuln) { applied = amt * 2; note = " — vulnerable (doubled)!"; }
    }
    const next = clampNum(Math.round((before || 0) - applied), 0, 99999);
    this.rpc("setHp", { id, hp: next }).then(() => {
      const after = this.tokenById(id) ? this.tokenById(id).hp : next;
      this.toast(t.name + " took " + applied + " damage" + note + " (" + before + " → " + after + (after <= 0 ? " — down!" : "") + ")");
      if (after > 0 && t.conc) this.concentrationCheck(id, applied);
      if (after <= 0 && t.conc) {
        this.rpc("setCombatStats", { id, conc: "" }).then(() => this.toast(t.name + " lost concentration")).catch(() => {});
      }
      this.onHpChanged(id, before, after <= 0 && before <= 0);
    }).catch(e => this.toast("Damage failed: " + ((e && e.message) || e)));
  }

  heal(id, amt) {
    const t = this.tokenById(id);
    if (!t) { this.toast("Target is no longer on the tracker"); return; }
    const before = t.hp || 0;
    let next = before + amt;
    if (t.maxHp > 0 && next > t.maxHp) next = t.maxHp;
    this.rpc("setHp", { id, hp: clampNum(Math.round(next), 0, 99999) }).then(() => {
      const after = this.tokenById(id) ? this.tokenById(id).hp : next;
      this.toast(t.name + " healed " + amt + " (" + before + " → " + after + ")");
      this.onHpChanged(id, before);
    }).catch(e => this.toast("Heal failed: " + ((e && e.message) || e)));
  }

  onHpChanged(id, before, damageAtZero) {
    const t = this.tokenById(id);
    if (!t) return;
    if (t.hp > 0) return;
    if (before > 0) {
      if (before >= (t.maxHp || before)) {
        this.rpc("setDeathSaves", { id, fails: 3, successes: t.deathS || 0, stable: false })
          .then(() => this.toast(t.name + " — massive damage kills outright!")).catch(() => {});
      }
    } else if (damageAtZero) {
      this.rpc("setDeathSaves", { id, fails: Math.min(3, (t.deathF || 0) + 1), successes: t.deathS || 0, stable: false })
        .then(() => this.toast(t.name + " — extra damage while down counts as a failed death save")).catch(() => {});
    }
  }

  concentrationCheck(id, dmg) {
    const t = this.tokenById(id);
    if (!t || !t.conc) return;
    const dc = Math.max(10, Math.floor(dmg / 2));
    const bonus = ((t.saves && t.saves.con != null) ? t.saves.con : 0) + this.effectBonusFor(t, "save", "con");
    const entry = this.rollDiceEntry(20, 1, bonus, "normal");
    const passed = entry.nat20 || (!entry.nat1 && entry.total >= dc);
    const card = this.cardShell(entry, "✺ " + t.name + " — concentration (" + t.conc + ")", this.rollFormulaText(entry));
    card.appendChild(el("div", "diceVerdict " + (passed ? "good" : "bad"),
      passed ? "Concentration holds — " + entry.total + " ≥ DC " + dc : "Concentration broken! — " + entry.total + " < DC " + dc));
    this.prependToLog(card);
    if (!passed) {
      this.rpc("setCombatStats", { id, conc: "" }).then(() => {
        this.toast(t.name + " lost concentration on " + t.conc);
      }).catch(() => {});
    }
  }

  deathSave(id) {
    const t = this.tokenById(id);
    if (!t) return;
    if (t.hp > 0 || t.deathStable) return;
    const entry = this.rollDiceEntry(20, 1, 0, "normal");
    const card = this.cardShell(entry, "💀 Death save — " + t.name, this.rollFormulaText(entry));
    let fails = t.deathF || 0, successes = t.deathS || 0, stable = false, reg = false;
    let verdict;
    if (entry.nat20) { reg = true; verdict = "Natural 20! Regains 1 HP and is conscious."; }
    else if (entry.nat1) { fails += 2; verdict = "Natural 1 — counts as two failures."; }
    else if (entry.total >= 10) { successes += 1; verdict = "Success — " + successes + " of 3."; }
    else { fails += 1; verdict = "Failure — " + fails + " of 3."; }
    if (!reg) {
      if (fails >= 3) { stable = false; verdict = "DEAD — three failed death saves."; }
      else if (successes >= 3) { stable = true; verdict = "Stable — three successful death saves."; }
    }
    card.appendChild(el("div", "diceVerdict " + (reg || stable ? "good" : fails >= 3 ? "bad" : entry.nat1 || entry.total < 10 ? "bad" : "good"), verdict));
    this.prependToLog(card);
    if (reg) {
      this.rpc("setHp", { id, hp: 1 }).then(() => this.toast(t.name + " regains 1 HP — conscious")).catch(() => {});
    } else if (fails >= 3) {
      this.rpc("setDeathSaves", { id, fails: 3, successes, stable: false }).then(() => this.toast(t.name + " is dead.")).catch(() => {});
    } else {
      this.rpc("setDeathSaves", { id, fails, successes, stable }).then(() => this.toast(t.name + " death save: " + verdict)).catch(() => {});
    }
  }

  // ---------- active effects ----------

  effStatLabel(stat) {
    if (!stat) return "";
    const map = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma", melee: "Melee", ranged: "Ranged", spell: "Spell", all: "All" };
    if (map[stat]) return map[stat];
    const words = stat.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1));
    return words.join(" ");
  }

  openEffectsDialog(id) {
    const t = this.tokenById(id);
    if (!t) return;
    this.effTargetId = id;
    this.ui.effTypeSel.value = "ability";
    this.populateStatOptions("ability");
    this.ui.effNameInput.value = "";
    this.ui.effBonusInput.value = "2";
    this.ui.effDurSel.value = "none";
    this.onEffDurChange();
    this.ui.effDurInput.value = "1";
    this.ui.effectsOverlay.hidden = false;
    this.renderEffectsList();
    this.renderHpInputs();
    this.renderCombatStats();
  }

  closeEffectsDialog() {
    this.ui.effectsOverlay.hidden = true;
    this.effTargetId = null;
  }

  populateStatOptions(type) {
    const sel = this.ui.effStatSel;
    sel.innerHTML = "";
    const opts = EFFECT_STATS[type] || EFFECT_STATS.ability;
    for (const [val, label] of opts) {
      const o = el("option", "", label);
      o.value = val;
      sel.appendChild(o);
    }
  }

  onEffTypeChange() { this.populateStatOptions(this.ui.effTypeSel.value); }

  onEffDurChange() {
    this.ui.effDurInput.hidden = this.ui.effDurSel.value === "none";
    if (!this.ui.effDurInput.hidden) this.ui.effDurInput.focus();
  }

  buildCondChips() {
    const wrap = this.ui.effCondsEl;
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const [id, c] of Object.entries(CONDITIONS)) {
      const chip = el("button", "condChip");
      chip.type = "button";
      chip.dataset.cond = id;
      const dot = el("span", "condDot");
      dot.style.background = c.color;
      chip.append(dot, document.createTextNode(c.label));
      chip.title = c.effects.length
        ? c.label + " applies: " + c.effects.map(e => (e.bonus > 0 ? "+" : "") + e.bonus + " " + this.effStatLabel(e.stat)).join(", ")
        : c.label + " — status marker only (its hard rules aren't enforced yet)";
      chip.addEventListener("click", () => this.applyCondition(id));
      wrap.appendChild(chip);
    }
  }

  condMetaFor(name) {
    for (const [, c] of Object.entries(CONDITIONS)) if (c.label === name) return c;
    return null;
  }

  condEffectsPayload(c) {
    const payload = [];
    for (const e of c.effects) {
      payload.push({ name: c.label, type: e.type, stat: e.stat, bonus: e.bonus, cond: 1 });
    }
    if (!payload.length) payload.push({ name: c.label, type: "ability", stat: "all", bonus: 0, cond: 1 });
    return payload;
  }

  applyCondition(id) {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const c = CONDITIONS[id];
    if (!c) return;
    const payloads = this.condEffectsPayload(c);
    const dur = this.durPayload();
    const chain = Promise.resolve();
    const run = payloads.reduce((p, pl) => p.then(() => this.rpc("addEffect", { ...pl, ...dur, id: t.id })), chain);
    run.then(() => {
      this.toast(c.label + " applied to " + t.name + (payloads.length > 1 ? " (" + payloads.length + " modifiers)" : ""));
    }).catch(err => this.toast("Condition failed: " + ((err && err.message) || err)));
  }

  durPayload() {
    if (this.ui.effDurSel.value !== "rounds") return {};
    const v = Math.round(Number(this.ui.effDurInput.value));
    return { durType: "rounds", durValue: Number.isFinite(v) && v >= 1 ? Math.min(v, 999) : 1 };
  }

  effRemaining(e) {
    if (!e.durRounds) return null;
    const left = (e.startRound || 0) + e.durRounds - (this.state.round || 0);
    return left > 0 ? left + " round" + (left === 1 ? "" : "s") + " left" : "expiring…";
  }

  checkEffectExpiry() {
    const round = this.state.round || 0;
    for (const t of this.state.tokens) {
      if (!t.effects || !t.effects.length) continue;
      const keep = [];
      for (const e of t.effects) {
        if (e.durRounds > 0 && round >= (e.startRound || 0) + e.durRounds) {
          this.rpc("removeEffect", { id: t.id, effectId: e.id }).catch(() => {});
        } else {
          keep.push(e);
        }
      }
      if (keep.length !== t.effects.length) t.effects = keep;
    }
  }

  renderEffectsList() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    const list = this.ui.effectsListEl;
    list.innerHTML = "";
    if (!t) return;
    this.ui.effectsTitleEl.textContent = t.name + " — active effects";
    const n = (t.effects || []).length;
    this.ui.effectsSubEl.textContent = n ? n + " effect" + (n === 1 ? "" : "s") + " on this combatant" : "No effects on this combatant yet.";
    if (!n) {
      const empty = el("div", "effEmpty");
      empty.textContent = "Nothing applied yet. Add your first effect below — e.g. +2 to Dexterity from a Bless spell.";
      list.appendChild(empty);
      return;
    }
    for (const e of t.effects) {
      const cond = e.cond ? this.condMetaFor(e.name) : null;
      const meta = cond || EFFECT_TYPES[e.type] || EFFECT_TYPES.ability;
      const card = el("div", "effCard");
      const badge = el("span", "effTypeBadge", cond ? "Status" : meta.label);
      badge.style.background = meta.color + "22";
      badge.style.color = meta.color;
      badge.style.border = "1px solid " + meta.color + "55";
      const name = el("span", "effName", e.name);
      const isMarker = cond && !e.bonus;
      const bonus = el("span", "effBonus" + (e.bonus < 0 ? " neg" : ""), isMarker ? "—" : (e.bonus > 0 ? "+" : "") + e.bonus);
      const remain = this.effRemaining(e);
      const detail = el("span", "effDetail", this.effStatLabel(e.stat) + " · by " + (e.source || "?") + (remain ? " · " + remain : ""));
      card.append(badge, name, bonus, detail);
      const del = el("button", "effDel", "✕");
      del.title = "Remove " + e.name;
      del.addEventListener("click", () => this.onEffRemove(e.id));
      card.appendChild(del);
      list.appendChild(card);
    }
  }

  onEffAdd() {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    const name = this.ui.effNameInput.value.replace(/\s+/g, " ").trim().slice(0, 40);
    const bonus = Number(this.ui.effBonusInput.value);
    if (!name) { this.toast("Give the effect a name"); return; }
    if (!Number.isFinite(bonus) || bonus < -20 || bonus > 20) { this.toast("Bonus must be a number between −20 and +20"); return; }
    const payload = { id: t.id, name, type: this.ui.effTypeSel.value, stat: this.ui.effStatSel.value, bonus: Math.round(bonus) };
    if (this.ui.effDurSel.value === "rounds") {
      const durValue = Number(this.ui.effDurInput.value);
      if (!Number.isFinite(durValue) || durValue < 1 || durValue > 999) { this.toast("Rounds must be between 1 and 999"); return; }
      payload.durType = "rounds";
      payload.durValue = Math.round(durValue);
    }
    this.rpc("addEffect", payload)
      .then(() => {
        this.ui.effNameInput.value = "";
        this.ui.effBonusInput.value = "2";
        this.ui.effDurSel.value = "none";
        this.onEffDurChange();
        this.ui.effDurInput.value = "1";
        this.toast("Effect applied to " + t.name);
      })
      .catch(err => this.toast("Effect failed: " + ((err && err.message) || err)));
  }

  onEffRemove(effectId) {
    const t = this.effTargetId ? this.tokenById(this.effTargetId) : null;
    if (!t) return;
    this.rpc("removeEffect", { id: t.id, effectId }).catch(err => this.toast("Remove failed: " + ((err && err.message) || err)));
  }

  // ---------- UI actions ----------

  bindUi() {
    const ui = this.ui;
    ui.initNextBtn.addEventListener("click", () => this.rpc("initNext", {}).catch(e => this.toast("Initiative: " + ((e && e.message) || e))));
    ui.initSortBtn.addEventListener("click", () => {
      this.initSortDir = this.initSortDir === "desc" ? "asc" : "desc";
      this._initSig = "";
      this.renderInit();
    });
    ui.addCombatantBtn.addEventListener("click", () => this.toggleAddPanel());
    ui.importBtn.addEventListener("click", () => this.onImport());
    ui.diceBtn.addEventListener("click", () => this.toggleDicePanel());
    ui.diceClearBtn.addEventListener("click", () => { this.ui.diceLog.innerHTML = ""; });
    for (const b of ui.dieBtns) b.addEventListener("click", () => this.onDieRoll(Number(b.dataset.d)));
    ui.attackBtn.addEventListener("click", () => { this.setDiceMode("attack"); this.attack(); });
    ui.saveBtn.addEventListener("click", () => { this.setDiceMode("save"); this.save(); });
    ui.checkBtn.addEventListener("click", () => { this.setDiceMode("check"); this.check(); });
    ui.csApplyBtn.addEventListener("click", () => this.onCsApply());
    ui.csDmg.addEventListener("keydown", e => { if (e.key === "Enter") this.onCsApply(); });
    ui.csProf.addEventListener("change", () => this.onProfChange());
    ui.hdRollBtn.addEventListener("click", () => this.onHdRoll());
    for (const k of Object.keys(ABILITY_LABELS)) {
      ui.abilScores[k].addEventListener("change", () => this.onAbilityChange(k));
    }
    for (const chip of ui.saveChips) {
      chip.addEventListener("click", () => this.onSaveChip(chip.dataset.s));
    }
    ui.encSaveBtn.addEventListener("click", () => this.onEncSave());
    ui.encAddBtn.addEventListener("click", () => this.onEncAdd());
    ui.encDelBtn.addEventListener("click", () => this.onEncDel());
    ui.encName.addEventListener("keydown", e => { if (e.key === "Enter") this.onEncSave(); });
    ui.compSearch.addEventListener("input", () => this.renderCompendium());
    ui.compFilter.addEventListener("change", () => this.renderCompendium());
    this.populateCheckOptions();
    this.setDiceMode("attack");
    ui.effectsCloseBtn.addEventListener("click", () => this.closeEffectsDialog());
    ui.effectsOverlay.addEventListener("click", e => { if (e.target === ui.effectsOverlay) this.closeEffectsDialog(); });
    ui.effTypeSel.addEventListener("change", () => this.onEffTypeChange());
    ui.effDurSel.addEventListener("change", () => this.onEffDurChange());
    ui.effAddBtn.addEventListener("click", () => this.onEffAdd());
    ui.effBonusInput.addEventListener("keydown", e => { if (e.key === "Enter") this.onEffAdd(); });
    ui.effNameInput.addEventListener("keydown", e => { if (e.key === "Enter") this.onEffAdd(); });
    ui.hpApplyBtn.addEventListener("click", () => this.onHpApply());
    ui.hpQuickBtns.forEach(b => b.addEventListener("click", () => this.onHpQuick(b)));
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (window.bgnFullscreen && window.bgnFullscreen.isOpen()) return;
      if (!ui.effectsOverlay.hidden) this.closeEffectsDialog();
    });
    this.buildDefaultCharsUi();
    this.buildLibraryUi();
    this.buildCondChips();
    this.renderEncounterSel();
  }

  setDiceMode(mode) {
    this.ui.diceSaveRow.hidden = mode !== "save";
    this.ui.diceCheckRow.hidden = mode !== "check";
    this.ui.diceCheckModRow.hidden = mode !== "check";
  }

  populateCheckOptions() {
    const sel = this.ui.diceCheckSel;
    sel.innerHTML = "";
    for (const [val, label] of CHECK_OPTIONS) sel.appendChild(new Option(label, val));
  }

  cap(s) {
    return s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  toggleAddPanel() {
    const open = this.ui.addPanel.hidden;
    this.ui.addPanel.hidden = !open;
    this.ui.addCombatantBtn.textContent = open ? "− Hide library" : "＋ Add combatant";
  }

  onImport() {
    let chars;
    try { chars = parseImport(this.ui.importInput.value); }
    catch (err) { this.toast("Import error: " + err.message); return; }
    if (!chars.length) { this.toast("No combatants found — check the format"); return; }
    this.rpc("importChars", { chars }).then(n => {
      this.toast("Added " + n + " combatant" + (n === 1 ? "" : "s") + " to the tracker");
      this.ui.importInput.value = "";
    }).catch(err => this.toast("Import failed: " + ((err && err.message) || err)));
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
    this.rpc("importChars", { chars: [{ name: v.name, color: c.color, hp: c.hp, maxHp: c.hp, img: v.img }] })
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
    build(BOSSES, this.ui.bossChars, c => "HP " + c.hp + " · " + c.w + "×" + c.h + " cells");
    this.renderCompendium();
  }

  // ---------- compendium browser ----------

  renderCompendium() {
    const grid = this.ui.compGrid;
    if (!grid) return;
    const q = (this.ui.compSearch.value || "").toLowerCase().trim();
    const filter = this.ui.compFilter.value;
    grid.innerHTML = "";
    let count = 0;
    for (const c of COMPENDIUM) {
      if (filter && c.type !== filter) continue;
      if (q) {
        const hay = (c.name + " " + c.type + " " + (c.note || "")).toLowerCase();
        if (!hay.includes(q)) continue;
      }
      count++;
      const card = el("button", "compCard");
      card.title = (c.note ? c.note + "\n" : "") + "Add " + c.name + " to the tracker";
      const tile = el("span", "compTile");
      if (c.img) {
        const im = new Image();
        im.src = c.img;
        im.alt = "";
        im.decoding = "async";
        tile.appendChild(im);
      } else {
        tile.textContent = c.name.charAt(0).toUpperCase();
        tile.style.background = c.color;
      }
      const info = el("span", "compInfo");
      info.appendChild(el("span", "compName", c.name));
      info.appendChild(el("span", "compSub", "CR " + c.cr + " · XP " + c.xp + " · HP " + c.hp + " · AC " + c.ac + " · " + this.cap(c.type)));
      card.append(tile, info);
      card.addEventListener("click", () => this.addCompendiumEntry(c));
      grid.appendChild(card);
    }
    if (!count) {
      grid.appendChild(el("div", "initEmpty", "No monsters match \"" + this.ui.compSearch.value + "\"."));
    }
  }

  addCompendiumEntry(c) {
    const char = {
      name: c.name, color: c.color, img: c.img || "",
      hp: c.hp, maxHp: c.hp,
      ac: c.ac, atk: c.atk, dmg: c.dmg,
      abilities: c.abilities, profBonus: c.profBonus || 2,
      saveProf: c.saveProf || [], skillProf: c.skillProf || {},
      hd: c.hd || "", condImm: c.condImm || [], langs: c.langs || "",
      imm: c.imm || [], res: c.res || [], vuln: c.vuln || []
    };
    this.rpc("importChars", { chars: [char] }).then(n => {
      this.toast("Added " + c.name + " (CR " + c.cr + ") to the tracker");
    }).catch(e => this.toast("Couldn't add " + c.name + ": " + ((e && e.message) || e)));
  }

  addLibraryEntry(c) {
    this.rpc("importChars", { chars: [{ name: c.name, color: c.color, hp: c.hp, maxHp: c.hp, img: c.img, w: c.w, h: c.h }] })
      .then(n => this.toast("Added " + c.name + " to the tracker"))
      .catch(e => this.toast("Couldn't add: " + ((e && e.message) || e)));
  }

  // ---------- initiative tracker ----------

  initSignature() {
    const sig = this.state.initCurrent + "|" + this.initSortDir + "|";
    return sig + this.state.tokens.map(t => t.id + ":" + (t.init || 0) + ":" + (t.hp || 0) + ":" + (t.maxHp || 0)
      + ":" + (t.group || "") + ":" + (t.conc || "") + ":" + (t.deathF || 0) + ":" + (t.deathS || 0) + ":" + (t.deathStable ? 1 : 0)
      + ":" + (t.effects || []).map(e => e.name).join("+")).join(",");
  }

  renderInitRound() {
    const el = this.ui.initRoundEl;
    if (!el) return;
    const round = (this.state.round || 0) + 1;
    el.textContent = "Round " + round;
    el.title = "Combat round " + round + " — advances when Next ▶ cycles past the last combatant in the tracker";
  }

  renderInit() {
    const sig = this.initSignature();
    if (this._initSig === sig) return;
    this._initSig = sig;
    const list = this.state.tokens.slice();
    const dir = this.initSortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const ag = (a.group || "").toLowerCase(), bg = (b.group || "").toLowerCase();
      if (ag && bg) {
        if (ag !== bg) return ag < bg ? -1 : 1;
        return (a.init || 0) * dir - (b.init || 0) * dir;
      }
      if (ag) return -1;
      if (bg) return 1;
      return (a.init || 0) * dir - (b.init || 0) * dir;
    });

    const u = this.ui;
    u.initList.innerHTML = "";
    if (!list.length) {
      u.initList.appendChild(el("div", "initEmpty", "No combatants yet. Press “＋ Add combatant” to drop in heroes, NPCs and monsters, then set their initiative rolls."));
    }
    let lastGroup = null;
    for (const t of list) {
      const g = t.group || "";
      if (g !== lastGroup) {
        lastGroup = g;
        if (g) {
          const members = list.filter(x => (x.group || "") === g);
          const header = el("div", "initGroup");
          const toggle = el("button", "initGroupToggle", this._collapsedGroups.has(g) ? "▸" : "▾");
          toggle.type = "button";
          toggle.title = (this._collapsedGroups.has(g) ? "Expand" : "Collapse") + " " + g;
          toggle.addEventListener("click", e => {
            e.stopPropagation();
            if (this._collapsedGroups.has(g)) this._collapsedGroups.delete(g);
            else this._collapsedGroups.add(g);
            this._initSig = "";
            this.renderInit();
          });
          const name = el("span", "initGroupName", g);
          const count = el("span", "initGroupCount", members.length + (members.length === 1 ? " combatant" : " combatants"));
          header.append(toggle, name, count);
          u.initList.appendChild(header);
        }
      }
      if (g && this._collapsedGroups.has(g)) continue;

      const isDown = (t.hp || 0) <= 0;
      const row = el("div", "initRow" + (t.id === this.state.initCurrent ? " current" : "") + (g ? " inGroup" : "") + (isDown ? " down" : ""));
      row.title = "Click to open " + t.name + " — HP, conditions, combat stats & effects";
      row.style.cursor = "pointer";
      row.addEventListener("click", () => this.openEffectsDialog(t.id));

      const turn = el("span", "initTurn", "▶");
      const inp = el("input", "initVal");
      inp.type = "number";
      inp.min = 0; inp.max = 999;
      inp.value = t.init || 0;
      inp.title = "Edit initiative roll";
      inp.addEventListener("click", e => e.stopPropagation());
      inp.addEventListener("keydown", e => e.stopPropagation());
      inp.addEventListener("change", () => this.setTokenInit(t.id, inp.value));

      const nameWrap = el("div", "initNameWrap");
      nameWrap.appendChild(el("span", "initName", t.name));
      const subBits = ["HP " + (t.hp || 0) + (t.maxHp > 0 ? " / " + t.maxHp : "")];
      if (t.w > 1) subBits.push(t.w + "×" + t.h + " cells");
      if (t.conc) subBits.push("✺ " + t.conc);
      if (isDown) {
        if (t.deathStable) subBits.push("🛌 stable");
        else if ((t.deathF || 0) >= 3) subBits.push("💀 dead");
        else subBits.push("💀 down · " + (t.deathF || 0) + "F/" + (t.deathS || 0) + "S");
      }
      nameWrap.appendChild(el("span", "initSub", subBits.join(" · ")));

      const hpQuick = el("div", "initHpQuick");
      for (const [lbl, d] of [["−10", -10], ["−5", -5], ["+5", 5], ["+10", 10]]) {
        const b = el("button", "initHpBtn", lbl);
        b.type = "button";
        b.dataset.d = d;
        b.title = (d < 0 ? "Deal " : "Heal ") + Math.abs(d) + " damage";
        b.addEventListener("click", e => { e.stopPropagation(); this.quickHp(t.id, d); });
        hpQuick.appendChild(b);
      }

      const dots = el("span", "condDots");
      const seen = [];
      const conds = [];
      for (const e of t.effects || []) {
        if (!e.cond || seen.includes(e.name)) continue;
        seen.push(e.name);
        conds.push(e);
      }
      dots.title = conds.length ? "Conditions: " + conds.map(c => c.name).join(", ") : "No conditions";
      for (const c of conds.slice(0, 6)) {
        const m = this.condMetaFor(c.name);
        const d = el("span", "condDot");
        d.style.background = m ? m.color : "#ffd76a";
        dots.appendChild(d);
      }

      let dsBtn = null;
      if (isDown && !t.deathStable && (t.deathF || 0) < 3) {
        dsBtn = el("button", "initDS", "💀");
        dsBtn.type = "button";
        dsBtn.title = "Roll a death save for " + t.name;
        dsBtn.addEventListener("click", e => { e.stopPropagation(); this.deathSave(t.id); });
      }

      const del = el("button", "initDel", "✕");
      del.title = "Remove " + t.name;
      del.addEventListener("click", e => {
        e.stopPropagation();
        this.rpc("deleteToken", { id: t.id }).catch(e2 => this.toast("Couldn't remove: " + ((e2 && e2.message) || e2)));
      });

      row.append(turn, inp, nameWrap, hpQuick, dots);
      if (dsBtn) row.appendChild(dsBtn);
      row.appendChild(del);
      u.initList.appendChild(row);
    }

    const cur = list.find(t => t.id === this.state.initCurrent) || null;
    u.initNowRow.hidden = !cur;
    u.initNowEl.textContent = cur ? "Now: " + cur.name : "";
    u.initNowEl.style.borderColor = cur ? (cur.color || "#4a76d9") : "";
    u.initNextBtn.disabled = !list.length;
    u.initSortBtn.textContent = dir === 1 ? "↑ Low first" : "↓ High first";
    this.syncDiceTargets();
  }

  setTokenInit(id, val) {
    const n = clampNum(Math.round(Number(val) || 0), 0, 999);
    this.rpc("setTokenInit", { id, init: n }).catch(e => this.toast("Couldn't set initiative: " + ((e && e.message) || e)));
  }

  // ---------- dice roller ----------

  toggleDicePanel() {
    const open = this.ui.dicePanel.hidden;
    this.ui.dicePanel.hidden = !open;
    this.ui.diceBtn.textContent = open ? "− Hide dice" : "🎲 Dice";
  }

  rollDiceEntry(sides, count, mod, adv) {
    const n = count + (adv === "normal" ? 0 : 1);
    const rolled = [];
    for (let i = 0; i < n; i++) rolled.push(1 + Math.floor(Math.random() * sides));
    const kept = rolled.slice();
    let dropped = null;
    if (adv === "adv") {
      const mi = kept.indexOf(Math.min(...kept));
      dropped = kept.splice(mi, 1)[0];
    } else if (adv === "dis") {
      const mi = kept.indexOf(Math.max(...kept));
      dropped = kept.splice(mi, 1)[0];
    }
    const total = kept.reduce((a, b) => a + b, 0) + mod;
    return {
      sides, count, mod, adv,
      rolled, kept, dropped,
      total,
      nat20: sides === 20 && kept.includes(20),
      nat1: sides === 20 && kept.includes(1)
    };
  }

  onDieRoll(sides) {
    const count = clampNum(Math.round(Number(this.ui.diceCount.value) || 1), 1, 10);
    const mod = Math.round(Number(this.ui.diceMod.value) || 0);
    const adv = this.ui.diceAdv.value;
    const card = this.buildRollCard(this.rollDiceEntry(sides, count, mod, adv));
    this.prependToLog(card);
  }

  // ---------- dice card helpers ----------

  prependToLog(card) {
    this.ui.diceLog.prepend(card);
    while (this.ui.diceLog.children.length > 40) this.ui.diceLog.lastChild.remove();
  }

  rollFormulaText(entry) {
    let s = (entry.count === 1 ? "" : entry.count) + "d" + entry.sides;
    if (entry.adv === "adv") s += " (advantage)";
    else if (entry.adv === "dis") s += " (disadvantage)";
    if (entry.mod) s += (entry.mod > 0 ? " + " + entry.mod : " − " + (-entry.mod));
    return s;
  }

  diceChipsFor(entry) {
    const droppedIdx = entry.dropped != null ? entry.rolled.indexOf(entry.dropped) : -1;
    const dice = el("span", "diceDice");
    for (let i = 0; i < entry.rolled.length; i++) {
      const r = entry.rolled[i];
      dice.appendChild(el("span", "die"
        + (entry.sides === 20 && r === 20 ? " nat20" : entry.sides === 20 && r === 1 ? " nat1" : "")
        + (i === droppedIdx ? " dropped" : ""), r));
    }
    return dice;
  }

  formulaChips(rolled) {
    const dice = el("span", "diceDice");
    for (const r of rolled) {
      dice.appendChild(el("span", "die"
        + (r.sides === 20 && r.value === 20 ? " nat20" : r.sides === 20 && r.value === 1 ? " nat1" : ""), r.value));
    }
    return dice;
  }

  cardShell(entry, title, formulaLabel) {
    const card = el("div", "diceCard" + (entry.nat20 ? " crit" : entry.nat1 ? " fumble" : ""));
    if (title) card.appendChild(el("div", "diceTitle", title));
    const top = el("div", "diceTop");
    top.appendChild(el("span", "diceFormula", formulaLabel || this.rollFormulaText(entry)));
    top.appendChild(this.diceChipsFor(entry));
    top.appendChild(el("span", "diceTotal" + (entry.nat20 ? " good" : entry.nat1 ? " bad" : ""),
      "= " + entry.total + (entry.nat20 ? " Natural 20!" : entry.nat1 ? " Natural 1" : "")));
    card.appendChild(top);
    return card;
  }

  applyBtn(label, cls, fn) {
    const b = el("button", "diceBtnApply " + cls, label);
    b.addEventListener("click", () => fn());
    return b;
  }

  diceTargetSelect() {
    const sel = el("select", "diceTarget");
    sel.title = "Apply this roll to…";
    for (const o of this.diceTargetOptions()) sel.appendChild(o);
    sel.value = this.state.initCurrent || (this.state.tokens[0] && this.state.tokens[0].id) || "";
    return sel;
  }

  damageTypeSelect() {
    const sel = el("select", "diceTarget");
    sel.title = "Damage type — checked against the target's immunities, resistances and vulnerabilities";
    for (const o of this.ui.diceTypeSel.options) sel.appendChild(new Option(o.value, o.value));
    sel.value = this.ui.diceTypeSel.value;
    return sel;
  }

  buildRollCard(entry) {
    const card = this.cardShell(entry, "", this.rollFormulaText(entry));
    const apply = el("div", "diceApply");
    const sel = this.diceTargetSelect();
    const dmg = this.applyBtn("Damage", "dmg", () => this.applyRoll(entry, sel.value, false));
    const heal = this.applyBtn("Heal", "heal", () => this.applyRoll(entry, sel.value, true));
    const again = this.applyBtn("↻", "again", () => {
      const ne = this.rollDiceEntry(entry.sides, entry.count, entry.mod, entry.adv);
      card.replaceWith(this.buildRollCard(ne));
    });
    again.title = "Roll the same dice again";
    apply.append(sel, dmg, heal, again);
    card.appendChild(apply);
    return card;
  }

  diceTargetOptions() {
    const out = [];
    for (const t of this.state.tokens) out.push(new Option(t.name, t.id));
    return out;
  }

  syncDiceTargets() {
    for (const sel of this.ui.diceLog.querySelectorAll(".diceTarget")) {
      const cur = sel.value;
      sel.innerHTML = "";
      for (const o of this.diceTargetOptions()) sel.appendChild(o);
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
      else sel.value = this.state.initCurrent || (this.state.tokens[0] && this.state.tokens[0].id) || "";
    }
    const selA = this.ui.diceActor, selB = this.ui.diceTargetSel;
    if (selA && selB) {
      const curA = selA.value, curB = selB.value;
      for (const sel of [selA, selB]) {
        sel.innerHTML = "";
        for (const o of this.diceTargetOptions()) sel.appendChild(o);
      }
      if ([...selA.options].some(o => o.value === curA)) selA.value = curA;
      else selA.value = this.state.initCurrent || (this.state.tokens[0] && this.state.tokens[0].id) || "";
      if ([...selB.options].some(o => o.value === curB)) selB.value = curB;
      else selB.value = this.state.initCurrent || (this.state.tokens[0] && this.state.tokens[0].id) || "";
    }
  }

  applyRoll(entry, id, isHeal) {
    const t = this.tokenById(id);
    if (!t) { this.toast("Target is no longer on the tracker"); return; }
    if (isHeal) this.heal(id, entry.total);
    else this.dealDamage(id, entry.total, this.ui.diceTypeSel.value);
  }

  // ---------- attack / save / check ----------

  effectBonusFor(t, type, stat) {
    let sum = 0;
    for (const e of t.effects || []) {
      if (e.type !== type) continue;
      const st = String(e.stat || "").toLowerCase().replace(/\s+/g, " ");
      if (st === stat || st === "all") sum += Number(e.bonus) || 0;
    }
    return sum;
  }

  parseFormula(formula) {
    const f = String(formula || "1d6").replace(/\s+/g, "").toLowerCase();
    const tokens = [];
    const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
    let m;
    while ((m = re.exec(f))) {
      if (m[2] !== undefined) tokens.push({ sign: m[1] || "+", dice: true, count: Math.max(1, parseInt(m[2], 10) || 1), sides: clampNum(parseInt(m[3], 10) || 1, 1, 1000) });
      else tokens.push({ sign: m[4] || "+", dice: false, val: parseInt(m[5], 10) || 0 });
    }
    return tokens;
  }

  rollFormula(formula, crit) {
    const tokens = this.parseFormula(formula);
    const rolled = [];
    let total = 0;
    for (const tok of tokens) {
      const sign = tok.sign === "-" ? -1 : 1;
      if (tok.dice) {
        const count = crit ? tok.count * 2 : tok.count;
        for (let i = 0; i < count; i++) {
          const r = 1 + Math.floor(Math.random() * tok.sides);
          rolled.push({ sides: tok.sides, value: r });
          total += sign * r;
        }
      } else {
        total += sign * tok.val;
      }
    }
    return { tokens, rolled, total };
  }

  attack() {
    const actor = this.tokenById(this.ui.diceActor.value);
    const target = this.tokenById(this.ui.diceTargetSel.value);
    if (!actor) { this.toast("Pick an attacker (Actor)"); return; }
    if (!target) { this.toast("Pick a target (Target)"); return; }
    const bonus = (actor.atk || 0) + this.effectBonusFor(actor, "attack", "all");
    const entry = this.rollDiceEntry(20, 1, bonus, this.ui.diceAdv.value);
    const ac = target.ac == null ? 10 : target.ac;
    const isCrit = entry.nat20;
    const isFumble = entry.nat1;
    const hit = isCrit || (!isFumble && entry.total >= ac);

    const card = this.cardShell(entry, "⚔ " + actor.name + " attacks " + target.name, this.rollFormulaText(entry));
    card.appendChild(el("div", "diceVerdict " + (hit ? "good" : "bad"),
      isCrit ? "Critical hit! Automatic — damage dice are doubled."
      : isFumble ? "Natural 1 — automatic miss."
      : hit ? "Hit! " + entry.total + " meets AC " + ac
      : "Miss — " + entry.total + " vs AC " + ac));
    const apply = el("div", "diceApply");
    if (hit) {
      apply.appendChild(this.applyBtn("⚔ Roll damage (" + actor.dmg + ")", "dmg", () => {
        this.rollAttackDamage(actor, target, entry, card);
      }));
    }
    card.appendChild(apply);
    this.prependToLog(card);
  }

  rollAttackDamage(actor, target, attackEntry, card) {
    const crit = !!attackEntry.nat20;
    const res = this.rollFormula(actor.dmg || "1d6", crit);
    const dmgCard = el("div", "diceCard dmgCard" + (crit ? " crit" : ""));
    dmgCard.appendChild(el("div", "diceTitle", "Damage vs " + target.name + (crit ? " (critical)" : "")));
    const top = el("div", "diceTop");
    top.appendChild(el("span", "diceFormula", actor.dmg + (crit ? " ×2 dice" : "")));
    top.appendChild(this.formulaChips(res.rolled));
    top.appendChild(el("span", "diceTotal", "= " + res.total));
    dmgCard.appendChild(top);
    const apply = el("div", "diceApply");
    const typeSel = this.damageTypeSelect();
    apply.appendChild(typeSel);
    apply.appendChild(this.applyBtn("Damage", "dmg", () => {
      this.dealDamage(target.id, res.total, typeSel.value);
    }));
    dmgCard.appendChild(apply);
    card.replaceWith(dmgCard);
  }

  save() {
    const t = this.tokenById(this.ui.diceActor.value);
    if (!t) { this.toast("Pick a combatant to roll for (Actor)"); return; }
    const stat = this.ui.diceSaveSel.value;
    const bonus = this.saveBonus(t, stat);
    const entry = this.rollDiceEntry(20, 1, bonus, this.ui.diceAdv.value);
    const card = this.cardShell(entry, "🛡 " + t.name + " — " + stat.toUpperCase() + " save", this.rollFormulaText(entry));
    card.appendChild(el("div", "diceVerdict " + (entry.nat20 ? "good" : entry.nat1 ? "bad" : "neutral"),
      entry.nat20 ? "Natural 20 — automatic success."
      : entry.nat1 ? "Natural 1 — automatic failure."
      : "Result " + entry.total + " — the DC is set by the DM."));
    this.prependToLog(card);
  }

  check() {
    const t = this.tokenById(this.ui.diceActor.value);
    if (!t) { this.toast("Pick a combatant to roll for (Actor)"); return; }
    const key = this.ui.diceCheckSel.value;
    const extra = clampNum(Math.round(Number(this.ui.diceCheckMod.value) || 0), -20, 20);
    const isSkill = !["str", "dex", "con", "int", "wis", "cha"].includes(key);
    const bonus = this.checkBonus(t, key) + extra;
    const entry = this.rollDiceEntry(20, 1, bonus, this.ui.diceAdv.value);
    const label = isSkill ? this.cap(key) : key.toUpperCase();
    const card = this.cardShell(entry, "📖 " + t.name + " — " + label + " check", this.rollFormulaText(entry));
    card.appendChild(el("div", "diceVerdict " + (entry.nat20 ? "good" : entry.nat1 ? "bad" : "neutral"),
      entry.nat20 ? "Natural 20!" : entry.nat1 ? "Natural 1." : "Result " + entry.total));
    this.prependToLog(card);
  }

  // ---------- encounters ----------

  loadEncounters() {
    try {
      const d = JSON.parse(localStorage.getItem("battleboard_encounters_v1") || "[]");
      return Array.isArray(d) ? d.filter(e => e && e.name) : [];
    } catch (e) { return []; }
  }

  saveEncounters(list) {
    try { localStorage.setItem("battleboard_encounters_v1", JSON.stringify(list)); } catch (e) {}
  }

  renderEncounterSel() {
    const sel = this.ui.encSel;
    if (!sel) return;
    const list = this.loadEncounters();
    sel.innerHTML = "";
    if (!list.length) {
      const o = new Option("No saved encounters", "");
      o.disabled = true;
      sel.appendChild(o);
      return;
    }
    for (const e of list) sel.appendChild(new Option(e.name, e.name));
  }

  onEncSave() {
    const name = this.ui.encName.value.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) { this.toast("Give the encounter a name"); return; }
    if (!this.state.tokens.length) { this.toast("The tracker is empty — nothing to save"); return; }
    const chars = this.state.tokens.map(t => ({
      name: t.name, color: t.color, img: t.img, hp: t.hp, maxHp: t.maxHp, w: t.w, h: t.h,
      ac: t.ac, atk: t.atk, dmg: t.dmg, abilities: t.abilities, profBonus: t.profBonus,
      saveProf: t.saveProf, skillProf: t.skillProf, hd: t.hd, condImm: t.condImm, langs: t.langs,
      imm: t.imm, res: t.res, vuln: t.vuln, group: t.group
    }));
    const list = this.loadEncounters();
    const ex = list.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
    if (ex >= 0) list.splice(ex, 1);
    list.unshift({ name, chars });
    list.length = Math.min(list.length, 60);
    this.saveEncounters(list);
    this.renderEncounterSel();
    this.ui.encSel.value = name;
    this.ui.encName.value = "";
    this.toast("Encounter \"" + name + "\" saved (" + chars.length + " combatants)");
  }

  onEncAdd() {
    const name = this.ui.encSel.value;
    if (!name) { this.toast("Pick a saved encounter"); return; }
    const enc = this.loadEncounters().find(e => e.name === name);
    if (!enc || !enc.chars || !enc.chars.length) { this.toast("That encounter is empty"); return; }
    this.rpc("importChars", { chars: enc.chars }).then(n => {
      this.toast("Added \"" + name + "\" — " + n + " combatants");
    }).catch(e => this.toast("Encounter failed: " + ((e && e.message) || e)));
  }

  onEncDel() {
    const name = this.ui.encSel.value;
    if (!name) return;
    const list = this.loadEncounters().filter(e => e.name !== name);
    this.saveEncounters(list);
    this.renderEncounterSel();
    this.toast("Encounter \"" + name + "\" deleted");
  }

  tokenById(id) { return this.state.tokens.find(t => t.id === id) || null; }

  toast(msg) {
    const t = this.ui.toast;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  destroy() {
    this.destroyed = true;
    if (this.net && this.net.close) this.net.close();
  }
}
