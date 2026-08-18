/* ════════════════════════════════════════════════════════════════
   D&D CHARACTER FORGE — creation wizard
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  const D = window.DND;
  const C = window.CF;

  const STEPS = [
    { id: "identity", label: "Basics" },
    { id: "species", label: "Species" },
    { id: "klass", label: "Class" },
    { id: "background", label: "Background" },
    { id: "scores", label: "Abilities" },
    { id: "profs", label: "Skills" },
    { id: "appearance", label: "Appearance" },
    { id: "personality", label: "Personality" },
    { id: "gear", label: "Equipment" },
    { id: "review", label: "Review" },
  ];

  const W = {
    char: null, step: 0, editingId: null, dirty: false,
    method: "standard", customOriginOn: false, customOriginBoosts: { p2: "str", p1: "dex" },
  };
  C.wizard = W;

  const $ = (id) => document.getElementById(id);

  /* ─── lifecycle ─── */
  W.open = function (char, editingId) {
    W.char = char;
    W.editingId = editingId || null;
    W.step = 0;
    W.method = "standard";
    render();
  };

  W.current = function () { return W.char; };

  function render() {
    $("forgeCtn").hidden = false;
    $("wizardScreen").hidden = false;
    $("rosterScreen").hidden = true;
    $("sheetScreen").hidden = true;
    renderNav();
    renderBody();
    renderFoot();
    CF.gotoTop();
  }

  function renderNav() {
    const nav = $("wizNav");
    nav.innerHTML = STEPS.map((s, i) =>
      `<button class="wiz-step${i === W.step ? " on" : ""}${i < W.step ? " done" : ""}" onclick="CF.wizard.go(${i})"><span class="ws-num">${i + 1}</span><span class="ws-label">${s.label}</span></button>`
    ).join("");
    const tag = $("wizEditionTag");
    if (tag) tag.textContent = D.ED[W.char.ruleset].label;
  }

  function renderFoot() {
    $("wizPrevBtn").hidden = W.step === 0;
    $("wizNextBtn").hidden = W.step === STEPS.length - 1;
    $("wizFinishBtn").hidden = W.step !== STEPS.length - 1;
  }

  W.go = function (n) {
    if (n < 0 || n >= STEPS.length) return;
    if (n > W.step) { if (!validateStep()) { CF.flash("Please finish this section first."); return; } }
    W.step = n;
    render();
  };
  W.next = function () { if (!validateStep()) { CF.flash("Please finish this section first."); return; } if (W.step < STEPS.length - 1) { W.step++; render(); } };
  W.prev = function () { if (W.step > 0) { W.step--; render(); } };

  function validateStep() {
    const id = STEPS[W.step].id;
    if (id === "identity" && !W.char.name.trim()) { flashEl("nameInput", "Give your hero a name."); return false; }
    if (id === "species" && !W.char.species) return false;
    if (id === "klass" && !W.char.klass) return false;
    if (id === "background" && !W.char.background) return false;
    return true;
  }
  function flashEl(id, msg) {
    const el = $(id);
    if (el) { el.style.borderColor = "#c0392b"; el.focus(); }
    CF.flash(msg);
  }

  /* ─── shared small helpers ─── */
  const AI_BTN = (fn, label) => `<button class="ai-btn" type="button" onclick="${fn}" title="AI suggestion">✨</button>`;
  const DICE_BTN = (fn, label) => `<button class="ai-btn dice" type="button" onclick="${fn}" title="Random">🎲</button>`;

  /* ════ STEP 1: identity ════ */
  function renderIdentity() {
    const ch = W.char;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Choose your rules edition, then give your hero a name.</div>
    <div class="ed-toggle">
      ${Object.keys(D.ED).map((k) => `
        <button class="ed-card${ch.ruleset === k ? " on" : ""}" onclick="CF.wizard.setRuleset('${k}')">
          <div class="ed-name">${D.ED[k].label}</div>
          <div class="ed-desc">${D.ED[k].desc}</div>
        </button>`).join("")}
    </div>
    <div class="grid-2 mt">
      <div>
        <label class="f-label">Character name</label>
        <div class="ai-row">
          <input id="nameInput" class="field" placeholder="e.g. Elowen Thorn" value="${C.esc(ch.name)}" oninput="CF.wizard.nameIn(this.value)">
          ${AI_BTN("CF.wizard.aiName()", "name")}
          ${DICE_BTN("CF.wizard.diceName()", "name")}
        </div>
      </div>
      <div>
        <label class="f-label">Player name (optional)</label>
        <input class="field" placeholder="Your name" value="${C.esc(ch.player)}" oninput="CF.wizard.playerIn(this.value)">
      </div>
      <div>
        <label class="f-label">Level</label>
        <div class="level-stepper">
          <button type="button" onclick="CF.wizard.level(-1)">−</button>
          <b id="levelVal">${ch.level}</b>
          <button type="button" onclick="CF.wizard.level(1)">+</button>
        </div>
      </div>
      <div>
        <label class="f-label">Alignment</label>
        <select class="field" onchange="CF.wizard.align(this.value)">
          ${D.ALIGNMENTS.map((a) => `<option ${ch.alignment === a ? "selected" : ""}>${a}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="wiz-ai-opt">
      <button class="btn btn-ghost btn-sm" onclick="CF.wizard.aiFullIdentity()">✨ Suggest a whole identity</button>
      <span class="muted small">AI picks a name that fits your later choices (species, class, rules).</span>
    </div>`;
  }

  W.setRuleset = function (rs) {
    if (W.char.ruleset === rs) return;
    W.char.ruleset = rs;
    if (W.char.species && !D.species[W.char.species].editions[rs]) { W.char.species = null; W.char.subclass = null; }
    if (W.char.klass) { const k = C.klass(W.char.klass); if (!k.subclasses[rs]) { W.char.subclass = null; } }
    if (W.char.background && !D.backgrounds[W.char.background][rs]) W.char.background = null;
    renderBody();
  };
  W.nameIn = function (v) { W.char.name = v; };
  W.playerIn = function (v) { W.char.player = v; };
  W.level = function (d) {
    const c = W.char;
    c.level = C.clamp(c.level + d, 1, 20);
    if (c.klass && c.subclass && c.level < C.klassEd(c.klass, c.ruleset).subclassLevel) c.subclass = null;
    if (c.level < 1) c.level = 1;
    $("levelVal").textContent = c.level;
    recomputeHP();
  };
  W.align = function (v) { W.char.alignment = v; };
  W.diceName = function () {
    const el = $("nameInput");
    let n;
    if (W.char.species) n = C.quickName(W.char.species);
    else if (root.nameSeed) n = root.nameSeed.selectOne.evaluateItem;
    else n = C.quickName("human");
    W.char.name = n;
    el.value = n;
    CF.sfx("dice");
  };
  W.aiName = async function () {
    const v = await C.aiFill({
      el: $("nameInput"), btn: event.currentTarget, char: W.char,
      task: "Invent a fantasy name for this character that fits the species, class, and ruleset. Return ONLY the name, no punctuation or explanation.",
      startWith: "",
    });
    if (v) W.char.name = v;
  };
  W.aiFullIdentity = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Summoning…"; }
    const task = "Suggest a name, alignment, and level (1-3) for this hero. Return them in this exact format on separate lines:\nName: <name>\nAlignment: <alignment>\nLevel: <number>";
    const result = await C.aiText(W.char, task);
    if (btn) { btn.disabled = false; btn.textContent = "✨ Suggest a whole identity"; }
    if (!result) return;
    const mName = result.match(/Name:\s*(.+)/i), mAl = result.match(/Alignment:\s*(.+)/i), mLvl = result.match(/Level:\s*(\d+)/i);
    if (mName) { W.char.name = mName[1].trim(); if ($("nameInput")) $("nameInput").value = W.char.name; }
    if (mAl && D.ALIGNMENTS.includes(mAl[1].trim())) { W.char.alignment = mAl[1].trim(); }
    if (mLvl) { W.char.level = C.clamp(parseInt(mLvl[1], 10) || 1, 1, 20); }
    CF.sfx("draw");
    renderBody();
  };

  /* ════ STEP 2: species ════ */
  function renderSpecies() {
    const ch = W.char;
    const list = Object.entries(D.species).filter(([id, s]) => s.editions[ch.ruleset]);
    const sel = ch.species ? D.species[ch.species] : null;
    const selEd = ch.species ? C.speciesEd(ch.species, ch.ruleset) : null;
    const sub = sel && selEd && selEd.subraces ? selEd.subraces : null;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Choose a species for the ${D.ED[ch.ruleset].label} rules. ${ch.ruleset === "2024" ? "In 2024, ability bonuses come from your background instead of your species." : "In 2014 your species grants ability score bonuses."}</div>
    <div class="wiz-ai-opt">
      <button class="btn btn-ghost btn-sm" onclick="CF.wizard.aiSpecies()">✨ Recommend a species</button>
      <span class="muted small">The AI picks a species that suits your class.</span>
    </div>
    <div class="opt-grid">
      ${list.map(([id, s]) => `
        <button class="opt-card${ch.species === id ? " on" : ""}" onclick="CF.wizard.pickSpecies('${id}')">
          <div class="opt-icon">${s.icon}</div>
          <div class="opt-name">${s.name}</div>
          <div class="opt-sub">${s.size} · ${(s.editions[ch.ruleset].speed || 30)} ft</div>
        </button>`).join("")}
    </div>
    ${sel ? `
    <div class="panel mt" style="text-align:left">
      <h3>${sel.name} <span class="tag">${sel.size} · ${selEd.speed || 30} ft${selEd.darkvision ? " · Darkvision " + selEd.darkvision + " ft" : ""}</span></h3>
      <ul class="trait-list">
        ${selEd.traits.map((t) => `<li>${t}</li>`).join("")}
      </ul>
      ${selEd.asi ? `<p class="small muted">Ability bonuses: ${Object.entries(selEd.asi).map(([a, n]) => D.ABILITY_INFO[a].short + " +" + n).join(", ")}${sub && ch.ruleset === "2014" ? " + subrace bonus" : ""}</p>` : ""}
      ${sub ? `
        <label class="f-label">Subrace (2014)</label>
        <select class="field" onchange="CF.wizard.pickSubrace(this.value)">
          <option value="">— choose subrace —</option>
          ${sub.map((s) => `<option value="${s.id}" ${ch.subrace === s.id ? "selected" : ""}>${s.name}${s.asi ? " (+" + Object.entries(s.asi).map(([a, n]) => D.ABILITY_INFO[a].short + " " + n).join(", ") + ")" : ""}</option>`).join("")}
        </select>` : ""}
      ${ch.species === "human" && ch.ruleset === "2014" ? `
        <label class="f-label" style="margin-top:12px">Human variant</label>
        <div class="flex">
          <button class="btn btn-ghost btn-sm ${!ch.humanVariant ? "on" : ""}" onclick="CF.wizard.humanVariant(false)">Standard (+1 all)</button>
          <button class="btn btn-ghost btn-sm ${ch.humanVariant ? "on" : ""}" onclick="CF.wizard.humanVariant(true)">Variant (+1/+1 + feat)</button>
        </div>
        ${ch.humanVariant ? `
          <div class="grid-2 mt">
            <div><label class="f-label">+1 to</label><select class="field" onchange="CF.wizard.humanBoost(0, this.value)">${abilOpts(ch.humanBoosts && ch.humanBoosts[0])}</select></div>
            <div><label class="f-label">+1 to</label><select class="field" onchange="CF.wizard.humanBoost(1, this.value)">${abilOpts(ch.humanBoosts && ch.humanBoosts[1])}</select></div>
            <div style="grid-column:1/-1"><label class="f-label">Variant human feat</label><select class="field" onchange="CF.wizard.addFeat(this.value)">${featOpts(ch.feats, ch.ruleset)}</select></div>
          </div>` : ""}` : ""}
      ${ch.species === "half-elf" && ch.ruleset === "2014" ? `
        <div class="grid-2 mt">
          <div><label class="f-label">+1 to</label><select class="field" onchange="CF.wizard.humanBoost(0, this.value)">${abilOpts(ch.humanBoosts && ch.humanBoosts[0])}</select></div>
          <div><label class="f-label">+1 to</label><select class="field" onchange="CF.wizard.humanBoost(1, this.value)">${abilOpts(ch.humanBoosts && ch.humanBoosts[1])}</select></div>
        </div>` : ""}
    </div>` : ""}`;
  }

  function abilOpts(sel) {
    return D.ABILITIES.map((a) => `<option value="${a}" ${sel === a ? "selected" : ""}>${D.ABILITY_INFO[a].label}</option>`).join("");
  }
  function featOpts(current, ruleset) {
    const feats = Object.entries(D.feats).filter(([, f]) => f.editions.includes(ruleset));
    return `<option value="">— none —</option>` + feats.map(([id, f]) => `<option value="${id}" ${(current || []).includes(id) ? "selected" : ""}>${f.name}</option>`).join("");
  }

  W.pickSpecies = function (id) {
    W.char.species = id;
    W.char.subrace = null;
    if (id === "human") { W.char.humanVariant = W.char.ruleset === "2024" ? false : (W.char.humanVariant || false); }
    recomputeSkills(true);
    renderBody();
  };
  W.pickSubrace = function (id) { W.char.subrace = id; renderBody(); };
  W.humanVariant = function (v) {
    W.char.humanVariant = v;
    if (v && !W.char.humanBoosts) W.char.humanBoosts = ["str", "dex"];
    if (!v) { W.char.feats = (W.char.feats || []).filter((f) => f !== (W.char.humanFeat)); }
    renderBody();
  };
  W.humanBoost = function (i, val) {
    if (!W.char.humanBoosts) W.char.humanBoosts = ["str", "dex"];
    W.char.humanBoosts[i] = val;
  };
  W.addFeat = function (id) {
    if (id) { W.char.feats = [id]; W.char.humanFeat = id; }
    else { W.char.feats = []; }
  };
  W.aiSpecies = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Choosing…"; }
    const ch = W.char;
    const task = ch.klass
      ? "Recommend a species for this character based on the class and ruleset. Return just the species name from this list, nothing else. Species list: " + Object.values(D.species).filter((s) => s.editions[ch.ruleset]).map((s) => s.name).join(", ") + "."
      : "Recommend a species for this character. Return just the species name, nothing else. Options: " + Object.values(D.species).filter((s) => s.editions[ch.ruleset]).map((s) => s.name).join(", ") + ".";
    const res = await C.aiText(ch, task);
    if (btn) { btn.disabled = false; btn.textContent = "✨ Recommend a species"; }
    const match = Object.entries(D.species).find(([id, s]) => s.editions[ch.ruleset] && res && res.toLowerCase().includes(s.name.toLowerCase()));
    if (match) { W.pickSpecies(match[0]); CF.flash("Suggested: " + match[1].name + " — change anytime."); CF.sfx("draw"); }
    else CF.flash("Couldn't parse a species — try again.");
  };

  /* ════ STEP 3: class ════ */
  function renderKlass() {
    const ch = W.char;
    const list = Object.entries(D.classes);
    const sel = ch.klass ? D.classes[ch.klass] : null;
    const ke = ch.klass ? C.klassEd(ch.klass, ch.ruleset) : null;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Choose a class. Subclass options depend on level and edition.</div>
    <div class="wiz-ai-opt">
      <button class="btn btn-ghost btn-sm" onclick="CF.wizard.aiClass()">✨ Recommend a class</button>
      <span class="muted small">The AI matches a class to your species and rules.</span>
    </div>
    <div class="opt-grid klass-grid">
      ${list.map(([id, k]) => `
        <button class="opt-card${ch.klass === id ? " on" : ""}" onclick="CF.wizard.pickKlass('${id}')">
          <div class="opt-icon">${k.icon}</div>
          <div class="opt-name">${k.name}</div>
          <div class="opt-sub">d${k.hitDie} hit die · ${k.casting ? "caster" : "martial"}</div>
        </button>`).join("")}
    </div>
    ${sel ? `
    <div class="panel mt" style="text-align:left">
      <h3>${sel.name} <span class="tag">Hit Die d${sel.hitDie} · Primary ${D.ABILITY_INFO[sel.primary].label}</span></h3>
      <div class="klass-detail grid-2">
        <div><b class="muted small">Saving throws</b><div class="detail-line">${ke.saves.map((a) => D.ABILITY_INFO[a].label).join(", ")}</div></div>
        <div><b class="muted small">Armor</b><div class="detail-line">${ke.armor || "None"}</div></div>
        <div><b class="muted small">Weapons</b><div class="detail-line">${ke.weapons || "None"}</div></div>
        <div><b class="muted small">Skills</b><div class="detail-line">Choose ${ke.skills.n} of ${ke.skills.options === "any" ? "any" : ke.skills.options.length + " options"}</div></div>
        ${sel.casting ? `<div><b class="muted small">Spellcasting</b><div class="detail-line">${sel.casting.kind === "full" ? "Full" : sel.casting.kind === "half" ? "Half" : sel.casting.kind === "third" ? "Third" : "Pact"} caster, ${D.ABILITY_INFO[sel.casting.ability].label}${sel.casting.ritual ? ", ritual casting" : ""}</div></div>` : ""}
        ${sel.tools && sel.tools.length ? `<div><b class="muted small">Tools</b><div class="detail-line">${sel.tools.join("; ")}</div></div>` : ""}
      </div>
      ${ke.subclasses.length ? `
        ${ch.level >= ke.subclassLevel ? `
        <label class="f-label" style="margin-top:14px">Subclass ${ch.ruleset === "2024" ? "(taken at 3rd level)" : ""}</label>
        <select class="field" onchange="CF.wizard.pickSubclass(this.value)">
          <option value="">— choose subclass —</option>
          ${ke.subclasses.map((s) => `<option value="${s.id}" ${ch.subclass === s.id ? "selected" : ""}>${s.name} — ${s.desc}</option>`).join("")}
        </select>` : `<p class="small muted">Subclass becomes available at level ${ke.subclassLevel}.</p>`}` : ""}
      ${ke.features[ch.level] ? `
        <div class="mt"><b class="muted small">Features at level ${ch.level}</b>
        <ul class="trait-list">${ke.features[ch.level].map((t) => `<li>${t}</li>`).join("")}</ul></div>` : ""}
    </div>` : ""}`;
  }

  W.pickKlass = function (id) {
    W.char.klass = id;
    W.char.subclass = null;
    W.char.weapons = [];
    recomputeSkills(true);
    renderBody();
  };
  W.pickSubclass = function (id) { W.char.subclass = id || null; renderBody(); };
  W.aiClass = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Choosing…"; }
    const ch = W.char;
    const task = "Recommend a class for this character based on species, ruleset, and any scores. Return just the class name, nothing else. Options: " + Object.values(D.classes).map((k) => k.name).join(", ") + ".";
    const res = await C.aiText(ch, task);
    if (btn) { btn.disabled = false; btn.textContent = "✨ Recommend a class"; }
    const match = Object.entries(D.classes).find(([id, k]) => res && res.toLowerCase().includes(k.name.toLowerCase()));
    if (match) { W.pickKlass(match[0]); CF.flash("Suggested: " + match[1].name + " — change anytime."); CF.sfx("draw"); }
    else CF.flash("Couldn't parse a class — try again.");
  };

  /* ════ STEP 4: background ════ */
  function renderBackground() {
    const ch = W.char;
    const list = Object.entries(D.backgrounds).filter(([id, b]) => b[ch.ruleset]);
    const sel = ch.background ? D.backgrounds[ch.background] : null;
    const be = ch.background ? C.backgroundEd(ch.background, ch.ruleset) : null;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Choose a background. ${ch.ruleset === "2024" ? "In 2024 backgrounds grant ability boosts and an Origin feat." : "In 2014 backgrounds grant skills, tools, and a feature."}</div>
    <div class="wiz-ai-opt">
      <button class="btn btn-ghost btn-sm" onclick="CF.wizard.aiBackground()">✨ Recommend a background</button>
      <span class="muted small">The AI matches a background to your class and species.</span>
    </div>
    <div class="opt-grid">
      ${list.map(([id, b]) => `
        <button class="opt-card${ch.background === id ? " on" : ""}" onclick="CF.wizard.pickBackground('${id}')">
          <div class="opt-icon">${b.icon}</div>
          <div class="opt-name">${b.name}</div>
          <div class="opt-sub">${(b[ch.ruleset].skills || []).map((s) => cap(s)).join(", ")}</div>
        </button>`).join("")}
    </div>
    ${sel && be ? `
    <div class="panel mt" style="text-align:left">
      <h3>${sel.name}</h3>
      <div class="klass-detail grid-2">
        <div><b class="muted small">Skill proficiencies</b><div class="detail-line">${(be.skills || []).map(cap).join(", ") || "None"}</div></div>
        ${ch.ruleset === "2024" ? `<div><b class="muted small">Ability boosts</b><div class="detail-line">${(be.abilities || []).map(cap).join(", ")} — choose +2/+1</div></div>` : ""}
        ${ch.ruleset === "2024" && be.feat ? `<div><b class="muted small">Origin feat</b><div class="detail-line">${cap(be.feat)}${be.featFocus ? " (" + be.featFocus + ")" : ""} — ${D.feats[be.feat] ? D.feats[be.feat].desc : ""}</div></div>` : ""}
        ${be.tool ? `<div><b class="muted small">Tools</b><div class="detail-line">${be.tool}</div></div>` : ""}
        ${ch.ruleset === "2014" && be.tools ? `<div><b class="muted small">Tools</b><div class="detail-line">${be.tools.join(", ")}</div></div>` : ""}
        ${be.gold ? `<div><b class="muted small">Starting gold</b><div class="detail-line">${be.gold} GP${ch.ruleset === "2024" ? " (plus class gear)" : ""}</div></div>` : ""}
      </div>
      <p class="small mt"><b class="muted">Feature:</b> ${be.feature}</p>
      ${ch.ruleset === "2024" && be.gear ? `<p class="small muted">Starting gear: ${be.gear.join(", ")}</p>` : ""}
    </div>` : ""}`;
  }

  function cap(s) { return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }

  W.pickBackground = function (id) {
    W.char.background = id;
    const be = C.backgroundEd(id, W.char.ruleset);
    if (W.char.ruleset === "2024" && be.abilities) {
      W.char.backgroundBoosts = { p2: be.abilities[0], p1: be.abilities[1] || be.abilities[0] };
      if (be.feat) { const feats = W.char.feats || []; if (!feats.includes(be.feat)) feats.push(be.feat); W.char.feats = feats; }
    }
    recomputeSkills(true);
    renderBody();
  };
  W.aiBackground = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Choosing…"; }
    const ch = W.char;
    const task = "Recommend a background for this character based on class, species, and ruleset. Return just the background name, nothing else. Options: " + Object.entries(D.backgrounds).filter(([id, b]) => b[ch.ruleset]).map(([id, b]) => b.name).join(", ") + ".";
    const res = await C.aiText(ch, task);
    if (btn) { btn.disabled = false; btn.textContent = "✨ Recommend a background"; }
    const match = Object.entries(D.backgrounds).find(([id, b]) => b[ch.ruleset] && res && res.toLowerCase().includes(b.name.toLowerCase()));
    if (match) { W.pickBackground(match[0]); CF.flash("Suggested: " + match[1].name + " — change anytime."); CF.sfx("draw"); }
    else CF.flash("Couldn't parse a background — try again.");
  };

  /* ════ STEP 5: ability scores ════ */
  function computeScores() {
    const ch = W.char;
    const base = { ...ch.scoreBase };
    if (ch.ruleset === "2024") {
      const b = ch.backgroundBoosts;
      if (b && b.p2) { base[b.p2] = (base[b.p2] || 10) + 2; }
      if (b && b.p1 && b.p1 !== b.p2) { base[b.p1] = (base[b.p1] || 10) + 1; }
    } else {
      if (W.customOriginOn) {
        base[W.customOriginBoosts.p2] = (base[W.customOriginBoosts.p2] || 10) + 2;
        base[W.customOriginBoosts.p1] = (base[W.customOriginBoosts.p1] || 10) + 1;
      } else {
        const spEd = C.speciesEd(ch.species, ch.ruleset);
        if (ch.species === "human" && ch.ruleset === "2014" && ch.humanVariant) {
          const hb = ch.humanBoosts || ["str", "dex"];
          base[hb[0]] = (base[hb[0]] || 10) + 1;
          base[hb[1]] = (base[hb[1]] || 10) + 1;
        } else if (spEd.asi) {
          for (const a in spEd.asi) base[a] = (base[a] || 10) + spEd.asi[a];
        }
        if (ch.subrace) {
          const sub = (spEd.subraces || []).find((s) => s.id === ch.subrace);
          if (sub && sub.asi) for (const a in sub.asi) base[a] = (base[a] || 10) + sub.asi[a];
        }
        if (ch.species === "half-elf") { const hb = ch.humanBoosts || ["str", "dex"]; base[hb[0]] = (base[hb[0]] || 10) + 1; base[hb[1]] = (base[hb[1]] || 10) + 1; }
      }
    }
    return base;
  }

  function renderScores() {
    const ch = W.char;
    if (!ch.scoreBase) ch.scoreBase = C.rollScores(W.method);
    if (!ch.scoresCustomized) ch.scores = computeScores();
    const mods = C.mods(ch.scores);
    const sel = ch.species ? D.species[ch.species] : null;
    const spEd = ch.species ? C.speciesEd(ch.species, ch.ruleset) : null;
    const be = ch.background ? C.backgroundEd(ch.background, ch.ruleset) : null;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Set your ability scores. ${ch.ruleset === "2024" ? "Your background boosts (+2/+1) apply automatically." : (spEd && spEd.asi ? "Your species ability bonuses apply automatically." : "")}</div>
    <div class="method-row">
      ${[["standard", "Standard Array"], ["4d6", "4d6 Drop Lowest"], ["pointbuy", "Point Buy"], ["ai", "✨ AI Build"]].map(([m, label]) =>
        `<button class="chip${W.method === m ? " on" : ""}" onclick="CF.wizard.scoreMethod('${m}')">${label}</button>`).join("")}
    </div>
    ${W.method === "ai" ? `
      <div class="panel mt center">
        <p class="small muted">The AI assigns scores that best fit your class and species.</p>
        <button class="btn btn-gold btn-sm" onclick="CF.wizard.aiScores()">✨ Build my scores</button>
      </div>` : ""}
    ${W.method === "pointbuy" ? `<p class="small muted mt">Simplified point-buy: 27 points, scores 8–15, cost: 8=0,9=1,10=2,11=3,12=4,13=5,14=7,15=9. Edit the numbers below and the total updates.</p>` : ""}
    <div class="stat-row mt">
      ${D.ABILITIES.map((a) => `
        <div class="stat score-stat">
          <small>${D.ABILITY_INFO[a].label}</small>
          <input class="score-input" id="score-${a}" type="number" min="1" max="30" value="${ch.scores[a]}" oninput="CF.wizard.scoreIn('${a}', this.value)">
          <b>${C.signed(mods[a])}</b>
          ${(ch.ruleset === "2024" && be && be.abilities && be.abilities.includes(a)) || (ch.ruleset === "2014" && spEd && spEd.asi && spEd.asi[a]) ? `<small class="boosted">boosted</small>` : ""}
        </div>`).join("")}
    </div>
    ${ch.ruleset === "2024" && be && be.abilities ? `
      <div class="panel mt" style="text-align:left">
        <h3>Background boosts</h3>
        <p class="small muted">Your ${cap(ch.background)} background boosts these abilities: ${be.abilities.map(cap).join(", ")}.</p>
        <div class="grid-2">
          <div><label class="f-label">+2 to</label><select class="field" onchange="CF.wizard.boostChange(2, this.value)">${be.abilities.map((a) => `<option value="${a}" ${ch.backgroundBoosts && ch.backgroundBoosts.p2 === a ? "selected" : ""}>${D.ABILITY_INFO[a].label}</option>`).join("")}</select></div>
          <div><label class="f-label">+1 to</label><select class="field" onchange="CF.wizard.boostChange(1, this.value)">${be.abilities.map((a) => `<option value="${a}" ${ch.backgroundBoosts && ch.backgroundBoosts.p1 === a ? "selected" : ""}>${D.ABILITY_INFO[a].label}</option>`).join("")}</select></div>
        </div>
      </div>` : ""}
    ${ch.ruleset === "2014" ? `
      <div class="panel mt" style="text-align:left">
        <h3>2014 species bonuses ${sel ? "· " + sel.name : ""}</h3>
        <label class="check-row"><input type="checkbox" ${W.customOriginOn ? "checked" : ""} onchange="CF.wizard.customOrigin(this.checked)"> Use Custom Origin (+2/+1 anywhere, ignoring species bonuses — Tasha's rule)</label>
        ${W.customOriginOn ? `
        <div class="grid-2 mt">
          <div><label class="f-label">+2 to</label><select class="field" onchange="CF.wizard.coBoost(2, this.value)">${abilOpts(W.customOriginBoosts.p2)}</select></div>
          <div><label class="f-label">+1 to</label><select class="field" onchange="CF.wizard.coBoost(1, this.value)">${abilOpts(W.customOriginBoosts.p1)}</select></div>
        </div>` : (spEd && spEd.asi ? `<p class="small muted">Applied: ${Object.entries(spEd.asi).map(([a, n]) => D.ABILITY_INFO[a].short + " +" + n).join(", ")}${ch.subrace && spEd.subraces ? " + subrace" : ""}${ch.species === "half-elf" ? " + two of your choice" : ""}</p>` : "")}
      </div>` : ""}
    <div class="wiz-ai-opt mt">
      <button class="btn btn-ghost btn-sm" onclick="CF.wizard.rerollScores()">🎲 Reroll</button>
      <span class="muted small">Manually editing a score locks it in. Reroll resets the method.</span>
    </div>`;
  }

  W.scoreMethod = function (m) {
    W.method = m;
    if (m === "ai") { renderBody(); return; }
    W.char.scoreBase = C.rollScores(m);
    W.char.scoresCustomized = false;
    W.char.scores = computeScores();
    renderBody();
  };
  W.scoreIn = function (a, v) {
    W.char.scores[a] = C.clamp(parseInt(v, 10) || 8, 1, 30);
    W.char.scoresCustomized = true;
    const modEl = document.querySelector(`#score-${a}`).parentElement.querySelector("b");
    modEl.textContent = C.signed(C.mod(W.char.scores[a]));
    recomputeHP();
  };
  W.rerollScores = function () {
    if (W.method === "ai") W.method = "standard";
    W.char.scoreBase = C.rollScores(W.method);
    W.char.scoresCustomized = false;
    W.char.scores = computeScores();
    CF.sfx("dice");
    renderBody();
  };
  W.customOrigin = function (v) { W.customOriginOn = v; W.char.scoresCustomized = false; W.char.scores = computeScores(); renderBody(); };
  W.coBoost = function (n, a) { W.customOriginBoosts[n === 2 ? "p2" : "p1"] = a; W.char.scoresCustomized = false; W.char.scores = computeScores(); renderBody(); };
  W.boostChange = function (n, a) {
    if (!W.char.backgroundBoosts) W.char.backgroundBoosts = { p2: "str", p1: "dex" };
    W.char.backgroundBoosts[n === 2 ? "p2" : "p1"] = a;
    W.char.scoresCustomized = false;
    W.char.scores = computeScores();
    renderBody();
  };
  W.aiScores = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Rolling…"; }
    const ch = W.char;
    const task = "Assign the six ability scores (using the standard array 8, 10, 12, 13, 14, 15) to best fit this character. Return them in exactly this single-line format with no extra text: str=15, dex=14, con=13, int=10, wis=8, cha=10";
    const res = await C.aiText(ch, task);
    if (btn) { btn.disabled = false; btn.textContent = "✨ Build my scores"; }
    const out = {};
    let ok = 0;
    for (const a of D.ABILITIES) {
      const m = res.match(new RegExp("\\b" + a + "\\s*=\\s*(\\d+)"));
      if (m) { out[a] = C.clamp(parseInt(m[1], 10), 3, 20); ok++; }
    }
    if (ok < 6) { CF.flash("Couldn't parse the scores — try again."); return; }
    ch.scores = out;
    ch.scoresCustomized = true;
    CF.sfx("draw");
    recomputeHP();
    renderBody();
  };

  function recomputeHP() {
    const ch = W.char;
    if (!ch.hp) ch.hp = { max: 0, current: 0, temp: 0 };
    ch.hp.max = C.maxHP(ch);
    if (!ch.hp.current || !ch.scoresCustomized) ch.hp.current = ch.hp.max;
  }

  /* ════ STEP 6: proficiencies ════ */
  function renderProfs() {
    const ch = W.char;
    const auto = C.automaticSkills(ch);
    const ke = C.klassEd(ch.klass, ch.ruleset);
    const req = ke.skills ? ke.skills.n : 0;
    const skills = C.skills(ch);
    const chosen = skills.filter((s) => s.prof > 0).length;
    const chosenNonAuto = skills.filter((s) => s.prof > 0 && !auto[s.id]).length;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Choose your skill proficiencies. Class skills are marked with a die. Background &amp; species skills are pre-selected.</div>
    <div class="panel mb" style="text-align:left">
      <h3>Class, armor &amp; weapon proficiencies</h3>
      <div class="klass-detail grid-2">
        <div><b class="muted small">Saving throws</b><div class="detail-line">${ke.saves.map((a) => D.ABILITY_INFO[a].label).join(", ")}</div></div>
        <div><b class="muted small">Armor</b><div class="detail-line">${ke.armor || "None"}</div></div>
        <div><b class="muted small">Weapons</b><div class="detail-line">${ke.weapons || "None"}</div></div>
        ${ke.skills ? `<div><b class="muted small">Skill choices</b><div class="detail-line">Choose ${req} of the offered list</div></div>` : ""}
      </div>
    </div>
    <div class="skill-grid">
      ${skills.map((s) => {
        const isAuto = !!auto[s.id];
        const isClassOpt = ke.skills.options === "any" ? true : ke.skills.options.includes(s.id);
        return `
        <button class="skill-chip${s.prof === 1 ? " prof" : ""}${s.prof === 2 ? " expert" : ""}" onclick="CF.wizard.toggleSkill('${s.id}')" title="${isAuto ? "From background/species" : ""}">
          <span class="skill-name">${s.name}${isAuto ? " ✓" : ""}${isClassOpt ? ` <span class="die">d${req}</span>` : ""}</span>
          <span class="skill-abil">(${D.ABILITY_INFO[s.ability].short})</span>
          <span class="skill-bonus">${C.signed(s.bonus)}</span>
        </button>`;
      }).join("")}
    </div>
    <p class="small muted mt" id="skillCount">${chosen} skill${chosen === 1 ? "" : "s"} marked${req ? " — class needs at least " + req : ""}${ch.klass === "rogue" || ch.klass === "bard" ? ". Rogue/Bard: click a trained skill twice for Expertise." : ""}</p>
    <div class="grid-2 mt">
      <div>
        <label class="f-label">Languages</label>
        <div class="lang-grid">
          ${D.LANGUAGES.map((l) => `<button class="chip${(ch.languages || []).includes(l) ? " on" : ""}" onclick="CF.wizard.toggleLang('${l}')">${l}</button>`).join("")}
        </div>
      </div>
      <div>
        <label class="f-label">Features &amp; feats</label>
        <div class="panel" style="max-height:220px; overflow:auto; text-align:left">
          ${C.features(ch).map((t) => `<div class="detail-line">• ${t}</div>`).join("") || "<span class='muted small'>Features will appear once species, class, background and feats are set.</span>"}
        </div>
        ${(ch.ruleset === "2014" && ch.klass === "fighter") || ch.klass === "rogue" || ch.klass === "bard" ? `<p class="small muted mt">${ch.klass === "rogue" || ch.klass === "bard" ? "Rogues and bards gain Expertise (double proficiency) — click a trained skill to cycle to it." : ""}</p>` : ""}
      </div>
    </div>`;
  }

  W.toggleSkill = function (id) {
    const ch = W.char;
    const cur = ch.skills[id] || 0;
    const canExpert = ch.klass === "rogue" || ch.klass === "bard";
    if (cur === 0) ch.skills[id] = 1;
    else if (cur === 1) ch.skills[id] = canExpert ? 2 : 0;
    else ch.skills[id] = 0;
    renderBody();
  };
  W.toggleLang = function (l) {
    const langs = W.char.languages || [];
    if (langs.includes(l)) W.char.languages = langs.filter((x) => x !== l);
    else W.char.languages = [...langs, l];
    renderBody();
  };

  function recomputeSkills(resetManual) {
    const ch = W.char;
    const auto = C.automaticSkills(ch);
    if (!ch.skills) ch.skills = {};
    const spEd = C.speciesEd(ch.species, ch.ruleset);
    if (spEd.languages && ch.ruleset === "2024") {
      const langs = ["Common", ...spEd.languages].filter((l, i, a) => a.indexOf(l) === i);
      ch.languages = langs;
    }
    if (resetManual) {
      // reset manual toggles to background/species defaults only
      for (const s of D.SKILLS) {
        if (auto[s.id]) { if (ch.skills[s.id] !== 2) ch.skills[s.id] = 1; }
        else if (ch.skills[s.id] === 1 || ch.skills[s.id] === 2) ch.skills[s.id] = 0;
      }
    }
  }

  /* ════ STEP 7: appearance ════ */
  function renderAppearance() {
    const ch = W.char;
    const ap = ch.appearance || {};
    const fields = [
      ["gender", "Gender", "e.g. male, female, nonbinary"],
      ["age", "Age", "e.g. 27"],
      ["height", "Height", "e.g. 5'10&quot;"],
      ["build", "Build", "e.g. lean, muscular, stocky"],
      ["eyes", "Eyes", "e.g. emerald green"],
      ["hair", "Hair", "e.g. long auburn"],
      ["skin", "Skin", "e.g. pale, bronze, blue-tinted"],
    ];
    return `
    <div class="sec-sub" style="margin-bottom:18px">Describe how your hero looks, and generate a portrait.</div>
    <div class="grid-2">
      <div class="center">
        <div class="portrait-frame">
          ${ch.portrait ? `<img id="portraitImg" src="${ch.portrait}" alt="Portrait">` : `<div class="portrait-placeholder">🎭</div>`}
        </div>
        <div class="flex center mt" style="justify-content:center">
          <button class="btn btn-gold btn-sm" onclick="CF.wizard.portrait()">${ch.portrait ? "✨ Regenerate" : "✨ Generate portrait"}</button>
          ${ch.portrait ? `<button class="btn btn-ghost btn-sm" onclick="CF.wizard.clearPortrait()">Remove</button>` : ""}
        </div>
        <p class="muted small mt">The portrait is generated from your appearance details — fill them in first for best results.</p>
      </div>
      <div>
        ${fields.map(([k, label, ph]) => `
          <label class="f-label">${label}</label>
          <div class="ai-row">
            <input class="field" placeholder="${ph}" value="${C.esc(ap[k])}" oninput="CF.wizard.apIn('${k}', this.value)">
            ${AI_BTN(`CF.wizard.aiField('${k}')`, label)}
          </div>`).join("")}
        <label class="f-label">Full description</label>
        <div class="ai-row">
          <textarea class="field" rows="3" placeholder="A paragraph describing your hero's look, scars, style, and presence…" oninput="CF.wizard.apIn('desc', this.value)">${C.esc(ap.desc)}</textarea>
        </div>
        <div class="wiz-ai-opt mt">
          <button class="btn btn-ghost btn-sm" onclick="CF.wizard.aiAppearance()">✨ Compose my whole appearance</button>
        </div>
      </div>
    </div>`;
  }

  W.apIn = function (k, v) {
    if (!W.char.appearance) W.char.appearance = {};
    W.char.appearance[k] = v;
  };
  W.aiField = async function (k) {
    const map = {
      gender: "gender identity", age: "age in years (just a number)", height: "height in feet and inches",
      build: "body build", eyes: "eye color and look", hair: "hair color/style", skin: "skin tone",
    };
    const v = await C.aiFill({ el: event.currentTarget.parentElement.querySelector("input"), btn: event.currentTarget, char: W.char, task: "Suggest the " + map[k] + " for this character. Return only the value, nothing else." });
    if (v) { W.char.appearance[k] = v; }
  };
  W.aiAppearance = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Composing…"; }
    const task = "Describe this character's appearance in a single rich paragraph (~40 words): build, face, hair, eyes, skin, scars or markings, clothing style, and general presence. Do not include a title or label.";
    const res = await C.aiText(W.char, task, { onChunk: (d) => { const el = document.querySelector('#wizardScreen textarea[placeholder*="paragraph"]'); if (el) el.value = d.fullTextSoFar; } });
    if (btn) { btn.disabled = false; btn.textContent = "✨ Compose my whole appearance"; }
    if (!res) return;
    if (!W.char.appearance) W.char.appearance = {};
    W.char.appearance.desc = res.trim();
    CF.sfx("draw");
    renderBody();
  };
  W.portrait = async function () {
    const img = $("portraitImg");
    await C.genPortrait(W.char, img, event.currentTarget);
    if (W.char.portrait) renderBody();
  };
  W.clearPortrait = function () { W.char.portrait = ""; renderBody(); };

  /* ════ STEP 8: personality ════ */
  function renderPersonality() {
    const ch = W.char;
    const p = ch.personality || {};
    const rows = [
      ["traits", "Personality traits", "e.g. \"I'm haunted by memories of war…\""],
      ["ideals", "Ideals", "e.g. \"Freedom. Chains are meant to be broken.\""],
      ["bonds", "Bonds", "e.g. \"I owe a debt I can never repay.\""],
      ["flaws", "Flaws", "e.g. \"I trust people too easily.\""],
    ];
    return `
    <div class="sec-sub" style="margin-bottom:18px">Bring your hero to life. Each field can be AI-written or filled by hand.</div>
    <div class="wiz-ai-opt mb">
      <button class="btn btn-ghost btn-sm" onclick="CF.wizard.aiPersonality()">✨ Write all of these</button>
    </div>
    ${rows.map(([k, label, ph]) => `
      <label class="f-label">${label}</label>
      <div class="ai-row">
        <textarea class="field" rows="2" placeholder="${ph}" oninput="CF.wizard.pIn('${k}', this.value)">${C.esc(p[k])}</textarea>
        ${AI_BTN(`CF.wizard.aiPersonalityField('${k}')`, label)}
      </div>`).join("")}
    <label class="f-label">Backstory</label>
    <div class="ai-row">
      <textarea class="field" rows="6" placeholder="Where are you from? What drives you? What have you lived through?" oninput="CF.wizard.pIn('backstory', this.value)">${C.esc(p.backstory)}</textarea>
    </div>
    <div class="wiz-ai-opt">
      <button class="btn btn-gold btn-sm" onclick="CF.wizard.aiBackstory()">✨ Write my backstory</button>
    </div>`;
  }

  W.pIn = function (k, v) {
    if (!W.char.personality) W.char.personality = {};
    W.char.personality[k] = v;
  };
  W.aiPersonalityField = async function (k) {
    const labels = { traits: "two personality traits", ideals: "one ideal", bonds: "one bond", flaws: "one flaw" };
    const v = await C.aiFill({
      el: event.currentTarget.parentElement.querySelector("textarea"), btn: event.currentTarget, char: W.char,
      task: "Write " + labels[k] + " for this character in the voice of a D&D player character. Return only the content, one line.",
    });
    if (v) W.char.personality[k] = v;
  };
  W.aiPersonality = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.textContent = "✨ Writing…"; }
    const task = `Write the four personality elements for this character. Return them in this exact format, one section per line:\nTRAITS: <two traits separated by a semicolon>\nIDEALS: <one ideal>\nBONDS: <one bond>\nFLAWS: <one flaw>`;
    const res = await C.aiText(W.char, task);
    if (btn) { btn.disabled = false; btn.textContent = "✨ Write all of these"; }
    if (!res) return;
    const grab = (key) => { const m = res.match(new RegExp(key + ":\\s*(.+)", "i")); return m ? m[1].trim() : ""; };
    W.char.personality = W.char.personality || {};
    W.char.personality.traits = grab("TRAITS");
    W.char.personality.ideals = grab("IDEALS");
    W.char.personality.bonds = grab("BONDS");
    W.char.personality.flaws = grab("FLAWS");
    CF.sfx("draw");
    renderBody();
  };
  W.aiBackstory = async function () {
    const btn = event.currentTarget; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="ai-spin"></span>'; }
    const el = document.querySelector('#wizardScreen textarea[rows="6"]');
    const res = await C.aiText(W.char, "Write a 2-3 sentence backstory for this character that ties together their species, class, and background.", { onChunk: (d) => { if (el) el.value = d.fullTextSoFar; } });
    if (btn) { btn.disabled = false; btn.textContent = "✨ Write my backstory"; }
    if (res) { W.char.personality.backstory = res.trim(); CF.sfx("draw"); }
  };

  /* ════ STEP 9: equipment ════ */
  function renderGear() {
    const ch = W.char;
    const is2024 = ch.ruleset === "2024";
    const be = ch.background ? C.backgroundEd(ch.background, ch.ruleset) : null;
    return `
    <div class="sec-sub" style="margin-bottom:18px">Pick starting gear. ${is2024 ? "2024 characters get class packages, background gear, and 50 GP." : "Choose a starting package, or use the catalog below. Backgrounds also give starting gold."}</div>
    <div class="grid-2">
      <div>
        <div class="panel" style="text-align:left">
          <h3>${is2024 ? "Class starting packages" : "Starting packages"}</h3>
          ${is2024 ? `
            ${(D.startingGear2024[ch.klass] || []).map((opt, i) => `
              <label class="check-row"><input type="checkbox" ${(ch.gearPicks || []).includes(opt) ? "checked" : ""} onchange="CF.wizard.toggleGearPick(${i}, this.checked)"> ${C.esc(opt)}</label>`).join("")}
            ${be && be.gear ? `<p class="small muted mt">Background gear: ${be.gear.join(", ")}</p>` : ""}
            <p class="small muted">Plus <b>50 GP</b> of spending money.</p>
            <button class="btn btn-ghost btn-sm mt" onclick="CF.wizard.takeGold()">Add 50 GP</button>
          ` : `
            <button class="btn btn-ghost btn-sm" onclick="CF.wizard.packageGear()">🎒 Take my class package</button>
            <div class="detail-line mt">${D.startingGear2014[ch.klass] || "No package defined."}</div>
            ${be && be.gold ? `<p class="small muted mt">Background: start with ${be.gold} GP (or roll 1d4 × ${be.gold} if you prefer).</p>` : ""}
            <button class="btn btn-ghost btn-sm mt" onclick="CF.wizard.takeGold()">💰 Take background gold (${be && be.gold ? be.gold : 10} GP)</button>
          `}
        </div>
        <div class="panel mt" style="text-align:left">
          <h3>Armor</h3>
          <select class="field" onchange="CF.wizard.setArmor(this.value)">
            <option value="">No armor</option>
            ${Object.entries(D.armor).map(([id, a]) => `<option value="${id}" ${ch.armor === id ? "selected" : ""}>${a.name} (AC ${a.ac}${a.maxDex === -1 ? " + Dex" : a.maxDex ? " max +" + a.maxDex : ""}${a.stealth ? ", stealth disadvantage" : ""})</option>`).join("")}
          </select>
          <label class="check-row mt"><input type="checkbox" ${ch.shield ? "checked" : ""} onchange="CF.wizard.setShield(this.checked)"> Shield (+2 AC)</label>
          <h3 class="mt">Weapons</h3>
          <div class="ai-row">
            <select id="weaponAddSel" class="field">
              ${Object.entries(D.weapons).map(([id, w]) => `<option value="${id}">${w.name} (${w.damage} ${w.type}${w.props.length ? ", " + w.props.join(", ") : ""})</option>`).join("")}
            </select>
            <button class="btn btn-ghost btn-sm" onclick="CF.wizard.addWeapon()">+ Add</button>
          </div>
          <div class="weapon-list" id="weaponList">
            ${(ch.weapons || []).map((w) => `<div class="gear-row"><span>${C.esc(w.name)} <span class="muted small">(${w.damage} ${w.type})</span></span><button class="chip" onclick="CF.wizard.removeWeapon(${(ch.weapons || []).indexOf(w)})">✕</button></div>`).join("")}
          </div>
        </div>
      </div>
      <div>
        <div class="panel" style="text-align:left">
          <h3>Adventuring gear</h3>
          <div class="gear-catalog">
            ${Object.entries(D.gear).map(([id, g]) => `<button class="chip" onclick="CF.wizard.addGear('${id}')">${g.name}</button>`).join("")}
          </div>
          <h3 class="mt">Your equipment</h3>
          <div class="equip-list" id="equipList">
            ${(ch.equipment || []).map((e, i) => `<div class="gear-row"><span>${C.esc(e.name)}</span><div><span class="qty-stepper"><button class="chip" onclick="CF.wizard.qty(${i},-1)">−</button>${e.qty}<button class="chip" onclick="CF.wizard.qty(${i},1)">+</button></span><button class="chip" onclick="CF.wizard.removeEquip(${i})">✕</button></div></div>`).join("")}
          </div>
        </div>
        <div class="panel mt" style="text-align:left">
          <h3>Money</h3>
          <div class="money-grid">
            ${[["pp", "Platinum"], ["gp", "Gold"], ["ep", "Electrum"], ["sp", "Silver"], ["cp", "Copper"]].map(([k, l]) => `
              <div><label class="f-label">${l}</label><input class="field" type="number" value="${ch.money[k]}" oninput="CF.wizard.moneyIn('${k}', this.value)"></div>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
  }

  W.toggleGearPick = function (i, on) {
    const opt = (D.startingGear2024[W.char.klass] || [])[i];
    if (!opt) return;
    const picks = W.char.gearPicks || [];
    if (on) { if (!picks.includes(opt)) picks.push(opt); } else W.char.gearPicks = picks.filter((p) => p !== opt);
    W.char.gearPicks = picks;
    syncEquipment();
  };
  W.packageGear = function () {
    const pkg = D.startingGear2014[W.char.klass] || "";
    addEquipmentText(pkg);
    CF.sfx("coin");
    renderBody();
  };
  W.takeGold = function () {
    const is2024 = W.char.ruleset === "2024";
    if (is2024) W.char.money.gp += 50;
    else {
      const be = C.backgroundEd(W.char.background, W.char.ruleset);
      W.char.money.gp += be && be.gold ? be.gold : 10;
    }
    CF.sfx("coin");
    renderBody();
  };
  W.setArmor = function (id) { W.char.armor = id || null; };
  W.setShield = function (v) { W.char.shield = v; };
  W.addWeapon = function () {
    const id = $("weaponAddSel").value;
    const w = D.weapons[id];
    if (!w) return;
    if (!W.char.weapons) W.char.weapons = [];
    W.char.weapons.push({ id, name: w.name, damage: w.damage, type: w.type, props: w.props, ranged: !!w.ranged });
    CF.sfx("place");
    renderBody();
  };
  W.removeWeapon = function (i) { W.char.weapons.splice(i, 1); renderBody(); };
  W.addGear = function (id) {
    const g = D.gear[id];
    if (!g) return;
    const eq = W.char.equipment || [];
    const found = eq.find((e) => e.name === g.name);
    if (found) found.qty++;
    else eq.push({ name: g.name, qty: 1 });
    W.char.equipment = eq;
    CF.sfx("place");
    renderBody();
  };
  W.qty = function (i, d) {
    const e = W.char.equipment[i];
    if (!e) return;
    e.qty = Math.max(1, e.qty + d);
    renderBody();
  };
  W.removeEquip = function (i) { W.char.equipment.splice(i, 1); renderBody(); };
  W.moneyIn = function (k, v) { W.char.money[k] = Math.max(0, parseInt(v, 10) || 0); };

  function addEquipmentText(text) {
    const items = text.split(/, | and /).map((s) => s.trim()).filter(Boolean);
    const eq = W.char.equipment || [];
    for (const it of items) {
      const name = it.replace(/^\d+\s*/, "").trim();
      const qty = parseInt(it, 10) || 1;
      const found = eq.find((e) => e.name.toLowerCase() === name.toLowerCase());
      if (found) found.qty += qty;
      else eq.push({ name, qty });
    }
    W.char.equipment = eq;
  }
  function syncEquipment() {
    // add 2024 gear picks as equipment lines
    const eq = W.char.equipment || [];
    for (const pick of (W.char.gearPicks || [])) {
      const name = pick.replace(/^[\w\d ]+?: /, "").split(/[,/]/)[0].trim();
      if (!eq.find((e) => e.name.toLowerCase() === name.toLowerCase())) eq.push({ name, qty: 1 });
    }
    W.char.equipment = eq;
  }

  /* ════ STEP 10: review ════ */
  function renderReview() {
    const ch = W.char;
    const sp = ch.species ? D.species[ch.species] : null;
    const kl = ch.klass ? D.classes[ch.klass] : null;
    const ke = ch.klass ? C.klassEd(ch.klass, ch.ruleset) : null;
    const bg = ch.background ? D.backgrounds[ch.background] : null;
    const skills = C.skills(ch).filter((s) => s.prof > 0);
    const slots = C.spellSlots(ch);
    const maxSpell = C.maxSpellLevel(ch);
    return `
    <div class="sec-sub" style="margin-bottom:18px">Review your hero, then save. Everything stays editable from the character sheet.</div>
    <div class="review-grid">
      <div class="panel">
        <h3>Identity</h3>
        <div class="review-row"><b>Name</b><span>${C.esc(ch.name)}</span></div>
        <div class="review-row"><b>Player</b><span>${C.esc(ch.player || "—")}</span></div>
        <div class="review-row"><b>Level</b><span>${ch.level}</span></div>
        <div class="review-row"><b>Alignment</b><span>${C.esc(ch.alignment)}</span></div>
        <div class="review-row"><b>Rules</b><span>${D.ED[ch.ruleset].label}</span></div>
        ${ch.portrait ? `<img class="review-portrait" src="${ch.portrait}" alt="Portrait">` : ""}
      </div>
      <div class="panel">
        <h3>Species, class &amp; background</h3>
        <div class="review-row"><b>Species</b><span>${sp ? sp.name : "—"}${ch.subrace ? " (" + cap(ch.subrace) + ")" : ""}</span></div>
        <div class="review-row"><b>Class</b><span>${kl ? kl.name : "—"}${ch.subclass ? " (" + cap(ch.subclass) + ")" : ""}</span></div>
        <div class="review-row"><b>Background</b><span>${bg ? bg.name : "—"}</span></div>
        <div class="review-row"><b>Hit Points</b><span>${C.maxHP(ch)} (d${kl ? kl.hitDie : 8})</span></div>
        <div class="review-row"><b>AC</b><span>${C.ACFor(ch)}</span></div>
        <div class="review-row"><b>Speed</b><span>${C.speedFor(ch)} ft</span></div>
        ${C.castingInfo(ch) ? `<div class="review-row"><b>Spell DC</b><span>${C.spellDC(ch)}</span></div>` : ""}
      </div>
      <div class="panel">
        <h3>Ability scores</h3>
        ${D.ABILITIES.map((a) => `<div class="review-row"><b>${D.ABILITY_INFO[a].short}</b><span>${ch.scores[a]} (${C.signed(C.mod(ch.scores[a]))})</span></div>`).join("")}
        ${ch.ruleset === "2024" && ch.backgroundBoosts ? `<div class="review-row"><b>Boosts</b><span>+2 ${D.ABILITY_INFO[ch.backgroundBoosts.p2].short}, +1 ${D.ABILITY_INFO[ch.backgroundBoosts.p1].short}</span></div>` : ""}
      </div>
      <div class="panel">
        <h3>Skills (${skills.length})</h3>
        ${skills.length ? skills.map((s) => `<div class="review-row"><b>${s.name}</b><span>${C.signed(s.bonus)}${s.prof === 2 ? " (expert)" : ""}</span></div>`).join("") : "<span class='muted small'>No skills chosen yet.</span>"}
        <div class="review-row mt"><b>Passive Perception</b><span>${C.passivePerception(ch)}</span></div>
      </div>
      <div class="panel">
        <h3>Features &amp; traits</h3>
        ${C.features(ch).slice(0, 10).map((t) => `<div class="detail-line">• ${t}</div>`).join("")}
        ${C.features(ch).length > 10 ? `<p class="small muted">…and ${C.features(ch).length - 10} more.</p>` : ""}
      </div>
      <div class="panel">
        <h3>Gear &amp; magic</h3>
        <div class="review-row"><b>Weapons</b><span>${(ch.weapons || []).map((w) => w.name).join(", ") || "—"}</span></div>
        <div class="review-row"><b>Armor</b><span>${ch.armor ? D.armor[ch.armor].name : "None"}${ch.shield ? " + shield" : ""}</span></div>
        <div class="review-row"><b>Equipment</b><span>${(ch.equipment || []).length} items</span></div>
        <div class="review-row"><b>Money</b><span>${ch.money.gp} GP</span></div>
        ${maxSpell ? `<div class="review-row"><b>Spell slots</b><span>${Object.entries(slots).map(([l, n]) => l + ":" + n).join("  ")}</span></div>` : ""}
        ${(ch.feats || []).length ? `<div class="review-row"><b>Feats</b><span>${ch.feats.map((f) => C.feat(f).name).join(", ")}</span></div>` : ""}
      </div>
    </div>
    <div class="center mt">
      <button class="btn btn-gold" style="font-size:1rem; padding:18px 44px" onclick="CF.wizard.finish()">⚔️ Save ${C.esc(ch.name || "Character")}</button>
    </div>`;
  }

  W.finish = async function () {
    const ch = W.char;
    if (!ch.name.trim()) { CF.flash("Give your hero a name first."); W.go(0); return; }
    if (!ch.species || !ch.klass || !ch.background) { CF.flash("Species, class, and background are required."); return; }
    if (!ch.scores) ch.scores = computeScores();
    ch.hp.max = C.maxHP(ch);
    if (!ch.hp.current) ch.hp.current = ch.hp.max;
    if (!ch.skills) ch.skills = {};
    await C.saveChar(ch);
    CF.sfx("tada");
    CF.openSheet(ch.id);
  };

  /* ─── body renderer ─── */
  function renderBody() {
    const id = STEPS[W.step].id;
    const fn = { identity: renderIdentity, species: renderSpecies, klass: renderKlass, background: renderBackground, scores: renderScores, profs: renderProfs, appearance: renderAppearance, personality: renderPersonality, gear: renderGear, review: renderReview }[id];
    $("wizBody").innerHTML = fn();
    CF.gotoTop();
  }

  /* ─── init wiring (called by app.js) ─── */
  W.init = function () {
    $("wizBackBtn").addEventListener("click", () => { CF.showRoster(); });
    $("wizPrevBtn").addEventListener("click", () => W.prev());
    $("wizNextBtn").addEventListener("click", () => W.next());
    $("wizFinishBtn").addEventListener("click", () => W.finish());
  };
})();
