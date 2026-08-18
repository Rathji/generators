"use strict";

const CHAR = window.CHAR;
const KEY = "fnarkwarist-sheet-v1";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const modStr = m => (m >= 0 ? "+" : "") + m;
const d = n => Math.floor(Math.random() * n) + 1;

const AB = ["str", "dex", "con", "int", "wis", "cha"];
const ABNAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

const CONDITIONS = ["Blinded", "Charmed", "Concentrating", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious"];
const BACKSTORY = `Fnarkwarist Chronjob was born amidst the tangled rigging of the Windscreecher, a notorious spelljammer known for its lightning-fast raids in the Astral Sea. His parents were both adept artificers, harnessing the wild magic of the cosmos to fuel their inventions. Fnarkwarist inherited this affinity for arcane engineering, coupled with the innate agility and curiosity of his Deep Gnome lineage.

As he grew older, his ambitions outgrew the confines of the Windscreecher. His parents, recognizing his restless spirit, gifted him a small but capable spelljammer, which he affectionately named the Chronohopper.

During a fateful stop at the Rock of Bral, Fnarkwarist stumbled upon an ancient tome detailing the psychee — a concept of the mind's essence, transcending the physical form. This sparked an obsession that consumed the next decade of his life.

Retreating to a secluded asteroid, he poured over the tome, experimenting with alloys and essences, blending artifice with wild magic. After countless failures, the breakthrough came with the Chrono-Mind Conduit — an intricate helm, adorned with crystals and pulsing with arcane energy, allowing him to project his psyche beyond the confines of his body.

The first successful test was nothing short of miraculous. His consciousness soared across Wildspace, piercing the veil of the Material Plane, and found a new home within the mind of a deep gnome in Baldur's Gate. With Fnarkwarist's guidance, the gnome's madness subsided, replaced by a newfound clarity.

Yet the connection was a double-edged sword. The deep gnome's latent craziness seeped into Fnarkwarist's own thoughts, tainting them with paranoia and fear. Now, Fnarkwarist stands at a crossroads, his invention a gateway to untold possibilities and perilous pitfalls. Will he master the Chrono-Mind Conduit, or will it unravel the very fabric of his being?`;

/* ---------------- state ---------------- */
const defState = () => ({
  hpDmg: 0,
  hpTemp: 15,
  deathFail: 0,
  deathSuccess: 0,
  inspiration: false,
  slots: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  uses: Object.fromEntries(CHAR.features.map(f => [f.id, f.max])),
  trackers: Object.fromEntries(CHAR.trackers.map(t => [t.id, t.hp])),
  consumables: Object.fromEntries(CHAR.consumables.map(c => [c.id, c.count])),
  exhaustion: 0,
  conditions: {},
  acOverride: null,
  prepared: {},
  notes: ""
});
let S = load();
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defState();
    const s = JSON.parse(raw);
    return Object.assign(defState(), s);
  } catch (e) { return defState(); }
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }

/* ---------------- derived ---------------- */
const mod = ab => CHAR.mods[ab];
const saveBase = ab => {
  const sv = CHAR.saves.find(x => x.ab === ab);
  return mod(ab) + (sv.prof ? CHAR.prof : 0) + CHAR.magicSaveBonus;
};
const saveProf = ab => CHAR.saves.find(x => x.ab === ab).prof;
const skillBase = sk => mod(sk.ab) + (sk.prof ? CHAR.prof : 0);
const curHP = () => Math.max(0, CHAR.hp.max - S.hpDmg);
const ac = () => S.acOverride != null ? S.acOverride : CHAR.ac;
const spellPrepared = id => S.prepared[id] != null ? S.prepared[id] : CHAR.spells[id].prepared;

/* ---------------- roll overlay ---------------- */
let overlayTimer = null;
function showRoll(label, roll, total, opts = {}) {
  const ov = $("#rollOverlay");
  const core = $("#rollCoreEl");
  core.innerHTML =
    `<div class="rolllabel">${esc(label)}</div>` +
    `<div class="rollbig ${opts.crit ? "crit" : ""}">${roll}</div>` +
    `<div class="rolltotal">Total ${total}${opts.crit ? '<span class="bdg">CRIT</span>' : ""}${opts.fumble ? '<span class="bdg">FUMBLE</span>' : ""}</div>` +
    (opts.detail ? `<div class="rolldetail">${esc(opts.detail)}</div>` : "");
  ov.classList.remove("show");
  void ov.offsetWidth;
  ov.classList.add("show");
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => ov.classList.remove("show"), 1500);
}
function toast(text) {
  const ov = $("#rollOverlay");
  const core = $("#rollCoreEl");
  core.innerHTML = `<div class="rolllabel">${esc(text)}</div><div class="rollbig" style="font-size:44px">✦</div>`;
  ov.classList.remove("show");
  void ov.offsetWidth;
  ov.classList.add("show");
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => ov.classList.remove("show"), 1400);
}

/* ---------------- roll log ---------------- */
const LOGMAX = 40;
function addLog(label, detail, total, crit, fumble) {
  const log = (S.log = S.log || []);
  log.push({ label, detail, total, crit, fumble, t: Date.now() });
  while (log.length > LOGMAX) log.shift();
  save();
  renderLog();
}
function renderLog() {
  const el = $("#rollLogEl");
  if (!el) return;
  const log = S.log || [];
  if (!log.length) { el.innerHTML = '<div class="empty">No rolls yet — click any die to get started.</div>'; return; }
  el.innerHTML = log.slice().reverse().map(r =>
    `<div class="logrow ${r.crit ? "crit" : ""} ${r.fumble ? "fumble" : ""}">
      <span class="ll">${esc(r.label)}</span>
      <span class="ld">${esc(r.detail)}</span>
      <span class="lt">${r.total}</span>
      ${r.crit ? '<span class="badge">CRIT</span>' : ""}${r.fumble ? '<span class="badge">FUMBLE</span>' : ""}
    </div>`).join("");
}
function clearLog() { S.log = []; save(); renderLog(); }

/* ---------------- header ---------------- */
function renderHeader() {
  const M = CHAR.meta;
  $("#avatarImg").src = M.avatar;
  $("#avatarImg").alt = M.name;
  $("#nameEl").textContent = M.name;
  $("#lvlEl").textContent = `LVL ${M.level}`;
  $("#subEl").textContent = `${M.race} · ${M.classes.map(cl => `${cl.name} ${cl.level} (${cl.subclass})`).join(" · ")}`;
  $("#metaEl").innerHTML = `${esc(M.background)} · ${esc(M.alignment)} · <b>${M.xp.toLocaleString()} XP</b>`;
  $("#footName").textContent = M.name;

  const max = CHAR.hp.max;
  const hp = curHP();
  const temp = S.hpTemp;
  $("#hpNumEl").innerHTML =
    `<span>${hp}</span> <span class="max">/ ${max}</span>` +
    (temp > 0 ? `<span class="tempchip">+${temp} temp</span>` : "");
  const pct = Math.max(0, Math.min(1, hp / max));
  const fill = $("#hpFillEl");
  fill.style.width = (pct * 100) + "%";
  fill.style.background = pct > 0.5 ? "linear-gradient(90deg,#53c98a,#3fae74)" : pct > 0.2 ? "linear-gradient(90deg,#e0bc7c,#c99a4a)" : "linear-gradient(90deg,#e4574f,#b93a33)";
  const tpct = Math.max(0, Math.min(1, temp / max));
  $("#hpTempFillEl").style.width = (tpct * 100) + "%";
  $("#tempInput").value = S.hpTemp;

  const dsS = $("#dsSuccEl");
  dsS.innerHTML = [0, 1, 2].map(i => `<span class="dot ${i < S.deathSuccess ? "on" : ""}" data-act="death" data-kind="succ" data-i="${i}"></span>`).join("");
  const dsF = $("#dsFailEl");
  dsF.innerHTML = [0, 1, 2].map(i => `<span class="dot ${i < S.deathFail ? "on" : ""}" data-act="death" data-kind="fail" data-i="${i}"></span>`).join("");

  const tiles = [
    { k: "AC", html: `<input data-input="ac" type="number" value="${ac()}" min="1" max="40">` },
    { k: "Speed", v: `${CHAR.speed.walk}' <span class="v2">fly ${CHAR.speed.fly}'</span>` },
    { k: "Initiative", v: `+9 <span class="v2">DEX+INT</span>`, act: "roll" },
    { k: "Proficiency", v: `+${CHAR.prof}`, small: true },
    { k: "Spell DC", v: `${CHAR.spellSaveDC}`, small: true },
    { k: "Spell Atk", v: `+${CHAR.spellAttack}`, small: true },
    { k: "Pass. Perception", v: `${10 + mod("wis")}`, small: true },
    { k: "Pass. Insight", v: `${10 + mod("wis")}`, small: true },
    { k: "Pass. Investigation", v: `${10 + mod("int")}`, small: true },
    { k: "Inspiration", v: `<span class="insp-star ${S.inspiration ? "on" : ""}">✦</span>`, act: "insp" }
  ];
  $("#statgridEl").innerHTML = tiles.map(t =>
    `<div class="stat ${t.act ? "click" : ""}" ${t.act ? `data-act="tile" data-tile="${t.act}"` : ""}>
      <div class="k">${t.k}</div>
      <div class="val ${t.small ? "small" : ""}">${t.html != null ? t.html : t.v}</div>
    </div>`).join("");
}

/* ---------------- conditions ---------------- */
function renderConds() {
  const chips = CONDITIONS.map(c =>
    `<span class="cond ${S.conditions[c] ? "on" : ""}" data-act="cond" data-c="${c}">${c}</span>`).join("");
  $("#condEl").innerHTML =
    `<span class="cap">Conditions</span>` +
    `<span class="cond exh">Exhaustion <button class="exh-btn" data-act="exh" data-n="-1">−</button><b>${S.exhaustion}</b><button class="exh-btn" data-act="exh" data-n="1">+</button></span>` +
    chips;
}

/* ---------------- abilities tab ---------------- */
function renderAbilities() {
  const tab = $("#tab-abilities");

  const abCards = AB.map(ab => {
    const prof = saveProf(ab);
    return `<div class="ab-card ${prof ? "prof" : ""}">
      <div class="ab-name">${ABNAMES[ab]}${prof ? " ✓" : ""}</div>
      <div class="ab-score">${CHAR.stats[ab]}</div>
      <div class="ab-mod">${modStr(mod(ab))}</div>
      <div class="ab-tools"><button class="d20btn" data-act="roll" data-mod="${mod(ab)}" data-label="Check · ${ABNAMES[ab]}"><span class="die">⛊</span> +${mod(ab)}</button></div>
    </div>`;
  }).join("");

  const saveRows = CHAR.saves.map(sv =>
    `<div class="row-save">
      <span class="nm">${sv.name}</span>
      <span class="tag">${sv.prof ? "prof" : ""}</span>
      <span class="bs">${sv.note}</span>
      <span class="bn">${modStr(saveBase(sv.ab))}</span>
      <button class="d20btn" data-act="roll" data-mod="${saveBase(sv.ab)}" data-label="Save · ${sv.name}"><span class="die">⛊</span></button>
    </div>`).join("");

  const skillRows = CHAR.skills.map(sk =>
    `<div class="skill-row ${sk.prof ? "prof" : ""}">
      <span class="dot"></span>
      <span class="nm">${sk.name}</span>
      <span class="bn">${modStr(skillBase(sk))}</span>
      <button data-act="roll" data-mod="${skillBase(sk)}" data-label="Skill · ${sk.name}">d20</button>
    </div>`).join("");

  const atkCards = CHAR.attacks.map(a => {
    const hitBtn = a.toHit != null
      ? `<button class="hit" data-act="atk-hit" data-tohit="${a.toHit}" data-label="${a.name}">⛊ hit</button>`
      : (a.isSave ? `<button class="hit" data-act="save-target" data-dc="${a.saveDC}">DC ${a.saveDC}</button>` : "");
    const dmgBtn = a.noRoll ? "" : `<button class="dmg" data-act="atk-dmg" data-dice="${a.dice}" data-bonus="${a.bonus}" data-label="${a.name}">⚄ dmg</button>`;
    return `<div class="atk-card">
      <div class="hd"><span class="nm">${esc(a.name)}</span><span class="ty">${esc(a.type || "")}</span></div>
      <div class="stats">${a.toHit != null ? `To hit <b>+${a.toHit}</b> · ` : ""}Damage <b>${esc(a.dice)}${a.bonus ? modStr(a.bonus) : ""}</b></div>
      <div class="atk-btns">${hitBtn}${dmgBtn}</div>
      <div class="stats" style="margin-top:4px">${esc(a.note)}</div>
    </div>`;
  }).join("");

  const diceChips = [4, 6, 8, 10, 12, 20, 100].map(n =>
    `<button class="dicechip" data-act="die" data-sides="${n}">d${n}</button>`).join("");

  tab.innerHTML =
    `<div class="sechead">Ability Scores</div>
     <div class="ab-grid">${abCards}</div>
     <div class="two-col" style="margin-top:18px">
       <div class="panel">
         <div class="sechead" style="margin-top:0">Saving Throws</div>
         ${saveRows}
       </div>
       <div class="panel">
         <div class="sechead" style="margin-top:0">Skills</div>
         <div class="skill-grid">${skillRows}</div>
       </div>
     </div>
     <div class="sechead">Attacks & Damage</div>
     <div class="atk-grid">${atkCards}</div>
     <div class="two-col" style="margin-top:18px">
       <div class="panel">
         <div class="sechead" style="margin-top:0">Quick Dice</div>
         <div class="dicechips">${diceChips}</div>
       </div>
       <div class="panel">
         <div class="sechead" style="margin-top:0">Roll Log <button class="chip" data-act="clear-log" style="margin-left:auto">clear</button></div>
         <div id="rollLogEl"></div>
       </div>
     </div>`;
  renderLog();
}

/* ---------------- spells tab ---------------- */
const filters = { q: "", level: null, onlyPrepared: false, source: "all" };
const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7];
const lvlName = l => l === 0 ? "Cantrips" : (l === 1 ? "1st Level" : l === 2 ? "2nd Level" : l === 3 ? "3rd Level" : `${l}th Level`);
const srcName = s => s === "class" ? "Wizard/Artificer" : s === "race" ? "Deep Gnome" : s === "item" ? "Magic Item" : s;

function renderSpells() {
  const tab = $("#tab-spells");
  tab.innerHTML = `
    <div class="sechead">Spell Slots</div>
    <div class="slotbar" id="slotbarEl"></div>
    <div class="filterbar">
      <input type="search" id="spellSearchEl" placeholder="Search spells…" value="${esc(filters.q)}">
      <div id="filterChipsEl" style="display:contents"></div>
      <span class="chip ${filters.onlyPrepared ? "on" : ""}" data-act="prep-only">Prepared only</span>
    </div>
    <div id="spellsGroupsEl"></div>`;
  $("#spellSearchEl").addEventListener("input", e => { filters.q = e.target.value; renderGroups(); });

  const levels = CHAR.spellSlots.map(sl => {
    const used = S.slots[sl.level];
    const dots = Array.from({ length: sl.total }, (_, i) =>
      `<span class="dot ${i < used ? "on" : ""}" data-act="slot-set" data-level="${sl.level}" data-i="${i + 1}"></span>`).join("");
    return `<div class="slotlvl">
      <span class="lv">L${sl.level}</span>
      <span class="dots">${dots}</span>
      <span class="cnt">${used}/${sl.total}</span>
      <button data-act="slot-dec" data-level="${sl.level}">−</button>
      <button data-act="slot-inc" data-level="${sl.level}">+</button>
    </div>`;
  }).join("");
  $("#slotbarEl").innerHTML = levels;

  $("#filterChipsEl").innerHTML = ["all", ...LEVELS.map(String)].map(lv =>
    `<span class="chip ${filters.level == null && lv === "all" ? "on" : filters.level != null && String(filters.level) === lv ? "on" : ""}" data-act="filter-lvl" data-lvl="${lv}">${lv === "all" ? "All levels" : lv === "0" ? "Cantrips" : lv}</span>`).join("")
    + `<span style="width:1px;height:20px;background:var(--line)"></span>`
    + ["all", "class", "item", "race"].map(s =>
      `<span class="chip ${filters.source === s ? "on" : ""}" data-act="filter-src" data-src="${s}">${s === "all" ? "Any source" : srcName(s)}</span>`).join("");

  renderGroups();
}
function spellMatches(sp) {
  if (filters.source !== "all" && sp.source !== filters.source) return false;
  if (filters.level != null && sp.level !== filters.level) return false;
  if (filters.onlyPrepared && sp.level > 0 && !spellPrepared(sp.id) && !sp.alwaysPrepared) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    if (!(sp.name.toLowerCase().includes(q) || (sp.desc || "").toLowerCase().includes(q))) return false;
  }
  return true;
}
function renderGroups() {
  const el = $("#spellsGroupsEl");
  if (!el) return;
  const matched = CHAR.spells.filter(spellMatches);
  const byLevel = {};
  for (const sp of matched) (byLevel[sp.level] = byLevel[sp.level] || []).push(sp);
  const order = LEVELS.filter(l => byLevel[l]);
  if (!order.length) { el.innerHTML = '<div class="empty">No spells match your filters.</div>'; return; }
  el.innerHTML = order.map(lvl => {
    const list = byLevel[lvl];
    const preparedN = list.filter(sp => sp.level > 0 && sp.source === "class" && spellPrepared(sp.id)).length;
    const note = lvl > 0 ? `<span class="n">${list.filter(s => s.source === "class").length} known${preparedN > 0 ? ` · ${preparedN} prepared` : ""}</span>` : `<span class="n">${list.length} cantrips</span>`;
    const cards = list.map(sp => {
      const prep = sp.level > 0 && sp.source === "class";
      const prepDot = prep ? `<span class="prep-dot ${spellPrepared(sp.id) ? "on" : ""}" data-act="spell-prep" data-id="${sp.id}" title="prepared"></span>` : "";
      const pips = Array.from({ length: Math.min(6, Math.max(1, sp.level)) }, (_, i) =>
        `<i class="${i >= sp.level ? "off" : ""}"></i>`).join("");
      const meta = [
        sp.castingTime && `<span class="meta-chip">${esc(sp.castingTime)}</span>`,
        sp.range && `<span class="meta-chip">${esc(sp.range)}</span>`,
        sp.components && `<span class="meta-chip">${esc(sp.components)}</span>`,
        sp.material && `<span class="meta-chip mat" title="${esc(sp.material)}">M: ${esc(sp.material)}</span>`,
        sp.duration && `<span class="meta-chip">${esc(sp.duration)}</span>`,
        sp.concentration && '<span class="meta-chip conc">Concentration</span>',
        sp.ritual && '<span class="meta-chip rit">Ritual</span>'
      ].filter(Boolean).join("");
      return `<div class="spellcard ${spellPrepared(sp.id) ? "prepared" : ""}" data-act="spell-expand" data-id="${sp.id}">
        <div class="spell-top">
          <span class="pips">${pips}</span>
          <span class="spell-name">${esc(sp.name)}</span>
          <span class="spell-school">${esc(sp.school)}</span>
          <span class="spell-src">${srcName(sp.source)}</span>
          ${sp.alwaysPrepared && sp.level > 0 ? '<span class="spell-src" style="color:var(--hp2)">always</span>' : ""}
          ${prepDot}
        </div>
        <div class="spell-meta">${meta}</div>
        <div class="spell-desc">${esc(sp.desc)}</div>
      </div>`;
    }).join("");
    return `<div class="spellgroup">
      <div class="ghead"><span class="pips">${Array.from({ length: lvl || 1 }, () => '<i></i>').join("")}</span>${lvlName(lvl)} ${note}</div>
      <div class="spellgrid">${cards}</div>
    </div>`;
  }).join("");
}

/* ---------------- resources tab ---------------- */
function renderResources() {
  const tab = $("#tab-resources");
  const featCards = CHAR.features.map(f => {
    const cur = S.uses[f.id];
    const dots = Array.from({ length: f.max }, (_, i) => `<i class="${i < cur ? "on" : ""}"></i>`).join("");
    return `<div class="featcard">
      <div class="hd">
        <span class="feat-icon">${f.icon}</span>
        <span class="feat-name">${esc(f.name)}</span>
        <span class="feat-src">${esc(f.type)}</span>
        <span class="feat-uses">${cur}<span class="mx">/${f.max}</span></span>
        <span class="stepper">
          <button data-act="use-dec" data-id="${f.id}">−</button>
          <button data-act="use-inc" data-id="${f.id}">+</button>
        </span>
      </div>
      <div class="feat-text">${esc(f.text)}</div>
      <div class="dots-uses">${dots}</div>
    </div>`;
  }).join("");

  const trackerCards = CHAR.trackers.map(t => {
    const cur = S.trackers[t.id];
    return `<div class="featcard">
      <div class="hd">
        <span class="feat-icon">⚙</span>
        <span class="feat-name">${esc(t.name)}</span>
        <span class="feat-src">${esc(t.kind)}</span>
        <span class="feat-uses">${cur}<span class="mx">/${t.hp} HP</span></span>
        <span class="stepper">
          <button data-act="track-dec" data-id="${t.id}">−</button>
          <button data-act="track-inc" data-id="${t.id}">+</button>
        </span>
      </div>
      <div class="stats" style="font-size:12px;color:var(--blue);margin:4px 0">AC ${t.ac}</div>
      <div class="feat-text">${esc(t.text)}</div>
    </div>`;
  }).join("");

  const conCards = CHAR.consumables.map(cn => {
    const cur = S.consumables[cn.id];
    return `<div class="featcard">
      <div class="hd">
        <span class="feat-icon">${cn.group === "potion" ? "⚗" : cn.group === "scroll" ? "📜" : "✦"}</span>
        <span class="feat-name">${esc(cn.name)}</span>
        <span class="feat-uses">${cur}</span>
        <span class="stepper">
          <button data-act="con-dec" data-id="${cn.id}">−</button>
          <button data-act="con-inc" data-id="${cn.id}">+</button>
        </span>
      </div>
      <div class="feat-text">${esc(cn.text)}</div>
    </div>`;
  }).join("");

  const traitCards = CHAR.traits.map(t => card(t.name, t.text, "Deep Gnome")).join("");
  const featTxt = CHAR.feats.map(t => card(t.name, t.text, "Feat")).join("");
  const clsCards = CHAR.classFeatures.map(t => card(t.name, t.text, t.src)).join("");
  const bgCards = CHAR.backgroundInfo.map(t => card(t.name, t.text, t.src)).join("");

  tab.innerHTML = `
    <div class="sechead">Combat Resources</div>
    <div class="feat-grid">${featCards}</div>
    <div class="sechead">Companions & Cannon</div>
    <div class="feat-grid">${trackerCards}</div>
    <div class="sechead">Consumables</div>
    <div class="feat-grid">${conCards}</div>
    <div class="sechead">Race Traits</div>
    <div class="two-grid">${traitCards}</div>
    <div class="sechead">Feats</div>
    <div class="two-grid">${featTxt}</div>
    <div class="sechead">Class & Subclass Features</div>
    <div class="two-grid">${clsCards}</div>
    <div class="sechead">Background</div>
    <div class="two-grid">${bgCards}</div>`;
}
function card(name, text, src) {
  return `<div class="textcard">
    <div class="hd">${esc(name)}<span class="src">${esc(src)}</span></div>
    <div class="bd">${esc(text)}</div>
  </div>`;
}

/* ---------------- inventory tab ---------------- */
function renderInventory() {
  const tab = $("#tab-inventory");
  const magicCards = CHAR.magicItems.map(m =>
    `<div class="magic-card">
      <div class="hd"><span class="nm">${esc(m.name)}</span><span class="rarity ${esc(m.rarity.toLowerCase())}">${esc(m.rarity)}</span></div>
      <div class="bd">${esc(m.text)}</div>
    </div>`).join("");

  const excluded = new Set([
    ...CHAR.magicItems.map(m => m.name),
    ...CHAR.consumables.map(c => c.name),
    "Crystal Ball",
    "Potion of Healing",
    "Spell Scroll (Disintegrate)"
  ]);
  const merged = new Map();
  for (const i of CHAR.inventory) {
    if (excluded.has(i.name)) continue;
    const q = i.quantity || 1;
    const w = (i.weight || 0) * q;
    if (merged.has(i.name)) { const e = merged.get(i.name); e.q += q; e.w += w; }
    else merged.set(i.name, { name: i.name, q, w });
  }
  const gear = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalW = gear.reduce((s, i) => s + i.w, 0);
  const carryCap = CHAR.stats.str * 15;
  const load = totalW <= CHAR.stats.str * 5 ? "light" : totalW <= CHAR.stats.str * 10 ? "medium" : totalW <= carryCap ? "heavy" : "overloaded";
  const gearRows = gear.map(i =>
    `<tr><td>${esc(i.name)}</td><td class="q">×${i.q}</td><td class="w">${i.w.toFixed(1)} lb</td></tr>`).join("");

  const coins = [["pp", 0], ["gp", 0], ["ep", 0], ["sp", 0], ["cp", 0]].map(([k, v]) =>
    `<span class="chip" style="border-radius:8px">${k.toUpperCase()} ${v}</span>`).join("");

  const customs = CHAR.customItems.map(c => card(c.name, c.description || "—", "Belonging")).join("");

  tab.innerHTML = `
    <div class="sechead">Magic Items</div>
    <div class="magic-grid">${magicCards}</div>
    <div class="sechead">Coin Pouch</div>
    <div class="dicechips">${coins}</div>
    <div class="two-col" style="margin-top:18px">
      <div class="panel">
        <div class="sechead" style="margin-top:0">Equipment <span class="n" style="color:var(--dim);font-weight:400;text-transform:none;letter-spacing:0;font-size:12px">· ${totalW.toFixed(1)} lb total · ${load} load (cap ${carryCap} lb)</span></div>
        <table class="gear">
          <thead><tr><th>Item</th><th>Qty</th><th>Weight</th></tr></thead>
          <tbody>${gearRows}</tbody>
        </table>
      </div>
      <div>
        <div class="sechead">Belongings & Curios</div>
        <div class="two-grid">${customs}</div>
      </div>
    </div>`;
}

/* ---------------- journal tab ---------------- */
function renderJournal() {
  const tab = $("#tab-journal");
  const M = CHAR.meta;
  const jc = (t, p) => `<div class="jcard"><h3>${t}</h3><p>${esc(p)}</p></div>`;
  tab.innerHTML = `
    <div class="jgrid">
      ${jc("Appearance", M.appearance)}
      ${jc("Personality Trait", M.personalityTraits)}
      ${jc("Ideals", M.ideals)}
      ${jc("Bonds", M.bonds)}
      ${jc("Flaws", M.flaws)}
      ${jc("Allies", M.notes.allies)}
      ${jc("Organizations", M.notes.organizations)}
      ${jc("Enemies", M.notes.enemies)}
      ${jc("Personal Possessions", M.notes.personalPossessions + (M.notes.otherHoldings ? "\n" + M.notes.otherHoldings : ""))}
    </div>
    <div class="sechead">Companions</div>
    <div class="two-grid">${CHAR.trackers.map(t => card(t.name, t.text, t.kind)).join("")}</div>
    <div class="sechead">Campaign Notes</div>
    <div class="panel"><textarea id="notesEl" placeholder="Session notes, party plans, arcane discoveries…">${esc(S.notes)}</textarea></div>
    <div class="sechead">Backstory</div>
    <div class="panel" style="font-size:13.5px;color:var(--mut);line-height:1.65;white-space:pre-wrap">${esc(BACKSTORY)}</div>`;
  $("#notesEl").addEventListener("input", e => { S.notes = e.target.value; save(); });
}

/* ---------------- tab switching ---------------- */
function switchTab(name) {
  document.querySelectorAll(".tabbtn").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tabsec").forEach(s => s.classList.toggle("on", s.id === "tab-" + name));
  if (name === "abilities") renderAbilities();
  else if (name === "spells") renderSpells();
  else if (name === "resources") renderResources();
  else if (name === "inventory") renderInventory();
  else renderJournal();
}

/* ---------------- events ---------------- */
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case "tab": switchTab(el.dataset.tab); break;
    case "tile":
      if (el.dataset.tile === "roll") rollD20(9, "Initiative");
      else if (el.dataset.tile === "insp") { S.inspiration = !S.inspiration; save(); renderHeader(); }
      break;
    case "hp": {
      const n = parseInt(el.dataset.n, 10);
      if (n < 0) S.hpDmg = Math.min(CHAR.hp.max * 2, S.hpDmg + -n);
      else S.hpDmg = Math.max(0, S.hpDmg - n);
      save(); renderHeader();
      break;
    }
    case "death": {
      const i = parseInt(el.dataset.i, 10);
      const key = el.dataset.kind === "fail" ? "deathFail" : "deathSuccess";
      S[key] = S[key] === i + 1 ? i : i + 1;
      if (S.deathFail >= 3) toast("DEATH — three failed saves");
      else if (S.deathSuccess >= 3) toast("Stable");
      save(); renderHeader();
      break;
    }
    case "slot-inc": case "slot-dec": {
      const lvl = el.dataset.level;
      const total = CHAR.spellSlots.find(sl => sl.level == lvl).total;
      S.slots[lvl] = Math.max(0, Math.min(total, S.slots[lvl] + (act === "slot-inc" ? 1 : -1)));
      save(); renderSpells(); break;
    }
    case "slot-set": {
      S.slots[el.dataset.level] = parseInt(el.dataset.i, 10);
      save(); renderSpells(); break;
    }
    case "use-inc": case "use-dec": {
      const id = el.dataset.id;
      const f = CHAR.features.find(x => x.id === id);
      S.uses[id] = Math.max(0, Math.min(f.max, S.uses[id] + (act === "use-inc" ? 1 : -1)));
      save(); renderResources(); break;
    }
    case "track-inc": case "track-dec": {
      const id = el.dataset.id;
      const t = CHAR.trackers.find(x => x.id === id);
      S.trackers[id] = Math.max(0, Math.min(t.hp, S.trackers[id] + (act === "track-inc" ? 1 : -1)));
      if (S.trackers[id] === 0) toast(t.name + " is destroyed!");
      save(); renderResources(); break;
    }
    case "con-inc": case "con-dec": {
      const id = el.dataset.id;
      S.consumables[id] = Math.max(0, S.consumables[id] + (act === "con-inc" ? 1 : -1));
      save(); renderResources(); break;
    }
    case "exh": {
      S.exhaustion = Math.max(0, Math.min(6, S.exhaustion + parseInt(el.dataset.n, 10)));
      save(); renderConds(); break;
    }
    case "cond": {
      const c = el.dataset.c;
      S.conditions[c] = !S.conditions[c];
      save(); renderConds(); break;
    }
    case "roll": rollD20(parseInt(el.dataset.mod, 10), el.dataset.label || "Roll"); break;
    case "die": {
      const sides = parseInt(el.dataset.sides, 10);
      const r = sides === 100 ? (d(10) * 10 + d(10)) : d(sides);
      addLog(`d${sides}`, "plain roll", r);
      showRoll(`d${sides}`, r, r);
      break;
    }
    case "atk-hit": rollD20(parseInt(el.dataset.tohit, 10), "Attack · " + el.dataset.label); break;
    case "save-target": {
      const dc = parseInt(el.dataset.dc, 10);
      const r = d(20) + mod("dex");
      addLog(`DEX save vs DC ${dc}`, `d20${modStr(mod("dex"))}`, r);
      showRoll(`DEX Save (DC ${dc})`, r, r, { detail: "target's roll against your cannon" });
      break;
    }
    case "atk-dmg": rollDice(el.dataset.dice, parseInt(el.dataset.bonus, 10), "Damage · " + el.dataset.label); break;
    case "spell-expand": {
      const id = parseInt(el.dataset.id, 10);
      el.classList.toggle("open");
      break;
    }
    case "spell-prep": {
      const id = parseInt(el.dataset.id, 10);
      S.prepared[id] = !spellPrepared(id);
      save(); renderSpells(); break;
    }
    case "prep-only": filters.onlyPrepared = !filters.onlyPrepared; renderSpells(); break;
    case "filter-lvl": filters.level = el.dataset.lvl === "all" ? null : parseInt(el.dataset.lvl, 10); renderSpells(); break;
    case "filter-src": filters.source = el.dataset.src; renderSpells(); break;
    case "short-rest": doShortRest(); break;
    case "long-rest": doLongRest(); break;
    case "clear-log": clearLog(); break;
  }
});

document.addEventListener("change", e => {
  if (e.target.dataset.input === "ac") {
    const v = parseInt(e.target.value, 10);
    S.acOverride = v >= 1 && v <= 40 ? v : null;
    save(); renderHeader();
  }
});

function rollD20(mod, label) {
  const r = d(20);
  const total = r + mod;
  addLog(label, `d20${modStr(mod)}`, total, r === 20, r === 1);
  showRoll(label, r, total, { crit: r === 20, fumble: r === 1 });
  return total;
}
function rollDice(dice, bonus, label) {
  const [cnt, sides] = dice.split("d").map(Number);
  const rolls = [];
  let sum = 0;
  for (let i = 0; i < cnt; i++) { const r = d(sides); sum += r; rolls.push(r); }
  const total = sum + (bonus || 0);
  addLog(label, `${dice}${bonus ? modStr(bonus) : ""} → [${rolls.join(", ")}]`, total);
  showRoll(label, sum, total, { detail: `${dice}${bonus ? modStr(bonus) : ""} rolled ${rolls.join(" + ")}` });
  return total;
}

/* ---------------- rests ---------------- */
function doShortRest() {
  if (!confirm("Take a short rest? Regains Arcane Recovery.")) return;
  S.uses.arcaneRecovery = CHAR.features.find(f => f.id === "arcaneRecovery").max;
  save(); renderResources(); renderHeader();
  toast("Short rest — Arcane Recovery restored");
}
function doLongRest() {
  if (!confirm("Take a long rest? Restores HP, spell slots, all resources, and conditions.")) return;
  S.hpDmg = 0;
  S.hpTemp = 0;
  S.deathFail = 0;
  S.deathSuccess = 0;
  S.exhaustion = 0;
  S.conditions = {};
  for (const sl of CHAR.spellSlots) S.slots[sl.level] = 0;
  for (const f of CHAR.features) S.uses[f.id] = f.max;
  for (const t of CHAR.trackers) S.trackers[t.id] = t.hp;
  save(); renderHeader(); renderConds();
  toast("A restful night under the stars");
}

/* ---------------- init ---------------- */
function init() {
  document.querySelectorAll(".tabbtn").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#tempInput").addEventListener("change", e => {
    const v = parseInt(e.target.value, 10);
    S.hpTemp = Math.max(0, isNaN(v) ? 0 : v);
    save(); renderHeader();
  });
  renderHeader();
  renderConds();
  switchTab("abilities");
}
init();
