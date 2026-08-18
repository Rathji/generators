/* ════════════════════════════════════════════════════════════════
   D&D CHARACTER FORGE — character sheet (play view)
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  const D = window.DND;
  const C = window.CF;

  const S = {};
  C.sheet = S;

  const $ = (id) => document.getElementById(id);
  let ch = null;

  /* ─── entry ─── */
  S.render = function (char) {
    ch = char;
    C.cur = char;
    $("forgeCtn").hidden = false;
    $("sheetScreen").hidden = false;
    $("rosterScreen").hidden = true;
    $("wizardScreen").hidden = true;
    CF.gotoTop();
    draw();
  };

  S.current = function () { return ch; };

  function mutate(fn, redraw = true) {
    fn(ch);
    ch.updatedAt = Date.now();
    C.saveChar(ch);
    try { if (C.party && C.party.syncCard) C.party.syncCard(); } catch (e) {}
    if (redraw) draw();
  }

  /* ─── helpers ─── */
  function attackFor(w) {
    const mods = C.mods(ch.scores);
    let abil = "str";
    if (w.ranged) abil = "dex";
    else if (w.props && w.props.some((p) => p.toLowerCase().includes("finesse"))) abil = mods.dex > mods.str ? "dex" : "str";
    return { abil, bonus: C.pb(ch.level) + mods[abil], dmg: mods[abil] };
  }

  function spellsUI() {
    const info = C.castingInfo(ch);
    if (!info) return "";
    const limits = C.spellKnownLimits(ch);
    const slots = C.spellSlots(ch);
    const used = ch.slotsUsed || {};
    const known = ch.spellsKnown || { cantrips: [] };
    const spellbook = SPELLBOOK.forClass(ch.klass, ch.ruleset);
    const maxLvl = C.maxSpellLevel(ch);
    const ability = D.ABILITY_INFO[info.ability].short;
    const prepared = limits && limits.prepared;

    const levelRow = (lvl) => {
      const n = slots[lvl] || 0;
      const usedN = used[lvl] || 0;
      const knownL = known[lvl] || [];
      const opts = (spellbook[lvl] || []).filter((id) => !knownL.includes(id));
      return `
      <div class="spell-row">
        <div class="spell-head">
          <span class="spell-lvl">Level ${lvl}</span>
          <span class="slot-dots">${Array.from({ length: n }, (_, i) => `<button class="slot-dot${i < usedN ? " used" : ""}" onclick="CF.sheet.toggleSlot(${lvl},${i})" title="spent slot"></button>`).join("")}</span>
        </div>
        ${knownL.length ? `<div class="spell-klist">${knownL.map((id, i) => spellChip(id, lvl, i, knownL)).join("")}</div>` : `<div class="muted small">No ${lvl}st/nd/rd/th spells prepared yet.</div>`}
        ${opts.length ? `
          <div class="spell-add"><select class="field" onchange="CF.sheet.addSpell('${lvl}', this.value, this)">${`<option value="">+ Add a level ${lvl} spell…</option>` + opts.map((id) => `<option value="${id}">${SPELLBOOK.byId(id) ? SPELLBOOK.byId(id).n : id}</option>`).join("")}</select></div>` : ""}
      </div>`;
    };

    return `
    <div class="sheet-block">
      <div class="block-title">Spellcasting <span class="tag">${ability}</span> <span class="tag">DC ${C.spellDC(ch)}</span> <span class="tag">Atk +${C.signed(C.spellAttack(ch))}</span></div>
      ${prepared ? `<p class="small muted">Prepared ${C.preparedCount(ch)} / ${limits.limit} (${ch.klass === "wizard" ? "level + Int" : "half level + " + D.ABILITY_INFO[info.ability].label})</p>` : (limits && limits.knownLimit ? `<p class="small muted">Known ${known.cantrips.length ? (Object.values(known).reduce((a, l) => a + l.length, 0) - known.cantrips.length) : 0} / ${limits.knownLimit} spells + cantrips</p>` : "")}
      <div class="spell-ctn">
        <div class="spell-row">
          <div class="spell-head"><span class="spell-lvl">Cantrips</span></div>
          ${(known.cantrips || []).length ? `<div class="spell-klist">${(known.cantrips || []).map((id, i) => spellChip(id, "cantrips", i, known.cantrips)).join("")}</div>` : `<div class="muted small">No cantrips yet.</div>`}
          ${(spellbook.cantrips || []).filter((id) => !(known.cantrips || []).includes(id)).length ? `
            <div class="spell-add"><select class="field" onchange="CF.sheet.addSpell('cantrips', this.value, this)"><option value="">+ Add a cantrip…</option>${(spellbook.cantrips || []).filter((id) => !(known.cantrips || []).includes(id)).map((id) => `<option value="${id}">${SPELLBOOK.byId(id) ? SPELLBOOK.byId(id).n : id}</option>`).join("")}</select></div>` : ""}
        </div>
        ${Object.keys(slots).sort((a, b) => a - b).filter((l) => slots[l] > 0 && l <= maxLvl).map(levelRow).join("")}
      </div>
      <p class="small muted mt">Slots recharge on a long rest (click the ● dots to spend/restore).</p>
    </div>`;
  }

  function spellChip(id, lvl, i, arr) {
    const sp = SPELLBOOK.byId(id);
    if (!sp) return `<div class="spell-chip">${C.esc(id)}</div>`;
    const prepared = !!(ch.preparedList && ch.preparedList[id]);
    const prepToggle = lvl !== "cantrips" && C.spellKnownLimits(ch) && C.spellKnownLimits(ch).prepared
      ? `<button class="prep-toggle${prepared ? " on" : ""}" onclick="CF.sheet.togglePrepared('${id}')" title="prepared">${prepared ? "✓" : ""}</button>` : "";
    return `<div class="spell-chip" title="${C.esc(sp.desc)}">${prepToggle}<div class="spell-name">${C.esc(sp.n)}</div><div class="spell-meta">${SPELLBOOK.schoolName(sp.s)} · ${sp.t} · ${sp.r} · ${sp.c}${sp.x ? " · conc" : ""} · ${sp.d}</div><div class="spell-desc">${C.esc(sp.desc)}</div><button class="chip" onclick="CF.sheet.removeSpell('${lvl}',${i})">✕</button></div>`;
  }

  /* ─── main draw ─── */
  function draw() {
    if (!ch) return;
    const mods = C.mods(ch.scores);
    const saves = C.saves(ch);
    const skills = C.skills(ch);
    const pb = C.pb(ch.level);
    const sp = ch.species ? D.species[ch.species] : null;
    const kl = ch.klass ? D.classes[ch.klass] : null;
    const ke = ch.klass ? C.klassEd(ch.klass, ch.ruleset) : null;
    const bg = ch.background ? D.backgrounds[ch.background] : null;
    const maxHP = C.maxHP(ch);
    const hp = ch.hp || {};
    const hdTotal = kl ? ch.level : 0;
    const hdUsed = (ch.hitDice && ch.hitDice.used) || 0;
    const slots = C.spellSlots(ch);
    const ds = ch.deathSaves || { s: 0, f: 0 };

    const identityLine = [kl ? kl.name : "?", sp ? sp.name : "?", bg ? bg.name : "?"].join(" · ");
    const subclassLabel = ch.subclass && ch.level >= ke.subclassLevel ? cap(ch.subclass) + " " : "";

    $("sheetScreen").innerHTML = `
    <div class="sheet-top">
      <div class="sheet-id">
        <div class="sheet-name">${C.esc(ch.name || "Unnamed")}</div>
        <div class="sheet-line">${subclassLabel}${C.esc(identityLine)}</div>
        <div class="sheet-line muted">${C.esc(ch.player || "")}${ch.player ? " · " : ""}${C.esc(ch.alignment)} · Level ${ch.level} · ${D.ED[ch.ruleset].label}</div>
        <div class="sheet-line muted small">XP <input id="xpInput" class="xp-input" type="number" value="${ch.xp || 0}" onchange="CF.sheet.xp(this.value)"></div>
      </div>
      ${ch.portrait ? `<img class="sheet-portrait" src="${ch.portrait}" alt="Portrait">` : `<div class="sheet-portrait ph">🎭</div>`}
      <div class="sheet-actions">
        <button class="btn btn-ghost btn-sm" onclick="CF.sheet.longRest()" title="Reset HP, slots, hit dice, death saves">🌙 Long rest</button>
        <button class="btn btn-ghost btn-sm" onclick="CF.sheet.levelUp()">⬆ Level up</button>
        <button class="btn btn-ghost btn-sm" onclick="CF.sheet.edit()">✏ Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="CF.sheet.print()">🖨 Print</button>
        <button class="btn btn-ghost btn-sm" onclick="CF.showRoster()">← Party</button>
      </div>
    </div>

    <div class="sheet-grid">
      <div class="sheet-col left">
        <div class="sheet-block">
          <div class="block-title">Ability Scores <span class="tag">Prof +${pb}</span></div>
          <div class="abil-table">
            ${D.ABILITIES.map((a) => `
              <div class="abil-row">
                <div class="abil-score">${ch.scores[a]}<span class="abil-mod">${C.signed(mods[a])}</span></div>
                <div class="abil-label">${D.ABILITY_INFO[a].short}<br><small>${D.ABILITY_INFO[a].label}</small></div>
                <div class="abil-save">${saves[a].prof ? "✓" : ""}<b>${C.signed(saves[a].bonus)}</b><small>Save</small></div>
              </div>`).join("")}
          </div>
        </div>
        <div class="sheet-block">
          <div class="block-title">Skills</div>
          <div class="skill-table">
            ${skills.map((s) => `
              <div class="skill-row" onclick="CF.sheet.toggleSkill('${s.id}')">
                <span class="prof-mark">${s.prof === 1 ? "◉" : s.prof === 2 ? "◎" : "○"}</span>
                <span class="skill-label">${s.name}</span>
                <span class="skill-val">${C.signed(s.bonus)}</span>
              </div>`).join("")}
          </div>
          <div class="sub-stat"><span>Passive Perception</span><b>${C.passivePerception(ch)}</b></div>
        </div>
        <div class="sheet-block">
          <div class="block-title">Proficiencies &amp; Languages</div>
          <div class="detail-line"><b>Saves:</b> ${ke.saves.map((a) => D.ABILITY_INFO[a].label).join(", ")}</div>
          <div class="detail-line"><b>Armor:</b> ${ke.armor || "None"}</div>
          <div class="detail-line"><b>Weapons:</b> ${ke.weapons || "None"}</div>
          <div class="detail-line"><b>Languages:</b> ${(ch.languages || []).join(", ") || "Common"}</div>
          ${(ch.feats || []).length ? `<div class="detail-line"><b>Feats:</b> ${ch.feats.map((f) => C.feat(f).name).join(", ")}</div>` : ""}
        </div>
        <div class="sheet-block">
          <div class="block-title">Attacks</div>
          ${(ch.weapons || []).map((w, i) => {
            const atk = attackFor(w);
            return `<div class="attack-row"><div><b>${C.esc(w.name)}</b><br><small class="muted">${w.damage} ${w.type}${w.props && w.props.length ? " · " + w.props.join(", ") : ""}</small></div><div class="attack-nums"><span>${C.signed(atk.bonus)}</span><span>${C.esc(w.damage)}${atk.dmg ? "+" + atk.dmg : ""}</span><button class="chip" onclick="CF.sheet.removeWeapon(${i})">✕</button></div></div>`;
          }).join("") || `<div class="muted small">No weapons — add some in Edit.</div>`}
          <button class="btn btn-ghost btn-sm mt" onclick="CF.sheet.edit()">✏ Manage weapons</button>
        </div>
      </div>

      <div class="sheet-col mid">
        <div class="sheet-block">
          <div class="block-title">Combat</div>
          <div class="combat-grid">
            <div class="combat-box hp-box">
              <small>Hit Points</small>
              <div class="hp-main"><b id="hpCur">${hp.current != null ? hp.current : maxHP}</b><span>/</span><input id="hpMaxInput" class="hp-max-input" type="number" value="${hp.maxSet ? hp.max : maxHP}" onchange="CF.sheet.hpMax(this.value)"></div>
              <div class="hp-controls">
                <button class="chip" onclick="CF.sheet.hp(-1)">−1</button>
                <button class="chip" onclick="CF.sheet.hp(-5)">−5</button>
                <button class="chip" onclick="CF.sheet.hp(1)">+1</button>
                <button class="chip" onclick="CF.sheet.hp(5)">+5</button>
                <button class="chip" onclick="CF.sheet.hpMaxReset()">max</button>
              </div>
              <div class="hp-temp">Temp HP: <input class="hp-temp-input" type="number" value="${hp.temp || 0}" onchange="CF.sheet.hpTemp(this.value)"></div>
            </div>
            <div class="combat-box"><small>AC</small><b class="big-num">${C.ACFor(ch)}</b><small class="muted">${ch.armor ? D.armor[ch.armor].name : "unarmored"}${ch.shield ? " + shield" : ""}</small></div>
            <div class="combat-box"><small>Initiative</small><b class="big-num">${C.signed(C.initiative(ch))}</b></div>
            <div class="combat-box"><small>Speed</small><b class="big-num">${C.speedFor(ch)}</b><small class="muted">ft</small></div>
            <div class="combat-box"><small>Hit Dice (d${kl ? kl.hitDie : 8})</small><b class="big-num">${hdTotal - hdUsed}<span class="small-num">/${hdTotal}</span></b><button class="chip" onclick="CF.sheet.rollHD()">🎲 Short rest heal</button></div>
            <div class="combat-box">
              <small>Death Saves</small>
              <div class="ds-row">
                <span class="muted small">Success</span>${[0, 1, 2].map((i) => `<button class="ds-dot${i < ds.s ? " ok" : ""}" onclick="CF.sheet.ds('s',${i})">${i < ds.s ? "✓" : "○"}</button>`).join("")}
              </div>
              <div class="ds-row">
                <span class="muted small">Failure</span>${[0, 1, 2].map((i) => `<button class="ds-dot${i < ds.f ? " bad" : ""}" onclick="CF.sheet.ds('f',${i})">${i < ds.f ? "✕" : "○"}</button>`).join("")}
              </div>
            </div>
          </div>
        </div>
        <div class="sheet-block">
          <div class="block-title">Features &amp; Traits</div>
          <div class="feature-list">
            ${C.features(ch).map((t) => `<div class="feature-item">${t}</div>`).join("")}
          </div>
        </div>
        <div class="sheet-block">
          <div class="block-title">Personality</div>
          <div class="p-row"><b>Traits</b><span>${C.esc(ch.personality.traits || "—")}</span></div>
          <div class="p-row"><b>Ideals</b><span>${C.esc(ch.personality.ideals || "—")}</span></div>
          <div class="p-row"><b>Bonds</b><span>${C.esc(ch.personality.bonds || "—")}</span></div>
          <div class="p-row"><b>Flaws</b><span>${C.esc(ch.personality.flaws || "—")}</span></div>
          ${ch.personality.backstory ? `<div class="p-row"><b>Backstory</b><span>${C.esc(ch.personality.backstory)}</span></div>` : ""}
        </div>
        ${spellsUI()}
      </div>

      <div class="sheet-col right">
        <div class="sheet-block">
          <div class="block-title">Game &amp; Map Links</div>
          <div class="link-row">
            <small>BGN game room</small>
            <div class="link-controls">
              <input class="field link-input" value="${C.esc(ch.gameRoom || "")}" placeholder="CODE" maxlength="5" oninput="CF.sheet.gameRoomIn(this.value)">
              <button class="chip" onclick="CF.sheet.joinGameRoom()" title="Open the party table and join this room">Join</button>
              <button class="chip" onclick="CF.sheet.copyRoom()">Copy</button>
            </div>
            ${CF.party && CF.party.status && CF.party.status().roomCode ? `<button class="btn btn-ghost btn-sm mt" onclick="CF.sheet.useCurrentTable()">🔗 Use current table (${CF.party.status().roomCode})</button>` : ""}
          </div>
          <div class="link-row">
            <small>Battle map (battle-map-forge)</small>
            <div class="link-controls">
              <input class="field link-input" value="${C.esc(ch.mapRoom || "")}" placeholder="CODE" maxlength="5" oninput="CF.sheet.mapRoomIn(this.value)">
              <button class="chip" onclick="CF.sheet.openMap()" title="Open Battle Map and paste this code">Open map</button>
              <button class="chip" onclick="CF.sheet.copyMap()">Copy</button>
            </div>
          </div>
          <p class="small muted" style="margin-top:8px">Link your hero to the game's table room and to the Battle Map table for that game. Joining a linked room brings this hero to your seat automatically.</p>
        </div>
        <div class="sheet-block">
          <div class="block-title">Equipment</div>
          <div class="equip-sheet">
            ${(ch.equipment || []).map((e, i) => `<div class="equip-srow"><span>${C.esc(e.name)}</span><span class="qty">×${e.qty}</span><button class="chip" onclick="CF.sheet.removeEquip(${i})">✕</button></div>`).join("") || `<div class="muted small">No equipment listed.</div>`}
          </div>
          <div class="money-sheet">
            ${[["pp", "PP"], ["gp", "GP"], ["ep", "EP"], ["sp", "SP"], ["cp", "CP"]].map(([k, l]) => `<div><small>${l}</small><b>${ch.money[k]}</b></div>`).join("")}
          </div>
        </div>
        <div class="sheet-block">
          <div class="block-title">Notes</div>
          <textarea class="field notes" rows="5" placeholder="Session notes, loot, quests…" oninput="CF.sheet.notes(this.value)">${C.esc(ch.notes || "")}</textarea>
        </div>
      </div>
    </div>`;
  }

  function cap(s) { return String(s).split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }

  /* ─── interactions ─── */
  S.hp = function (d) {
    const hp = ch.hp;
    hp.current = C.clamp((hp.current == null ? C.maxHP(ch) : hp.current) + d, 0, hp.maxSet ? hp.max : C.maxHP(ch));
    mutate(() => {}, true);
  };
  S.hpMax = function (v) {
    ch.hp.maxSet = true;
    ch.hp.max = C.clamp(parseInt(v, 10) || 1, 1, 999);
    if (ch.hp.current == null || ch.hp.current > ch.hp.max) ch.hp.current = ch.hp.max;
    mutate(() => {}, true);
  };
  S.hpMaxReset = function () {
    ch.hp.maxSet = false;
    ch.hp.max = C.maxHP(ch);
    ch.hp.current = ch.hp.max;
    mutate(() => {}, true);
  };
  S.hpTemp = function (v) { ch.hp.temp = Math.max(0, parseInt(v, 10) || 0); mutate(() => {}, false); };
  S.xp = function (v) { ch.xp = Math.max(0, parseInt(v, 10) || 0); mutate(() => {}, false); };
  S.notes = function (v) { ch.notes = v; mutate(() => {}, false); };

  /* ─── game & map links ─── */
  function cleanCode(v) { return String(v || "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5); }
  S.gameRoomIn = function (v) { ch.gameRoom = cleanCode(v); mutate(() => {}, false); };
  S.mapRoomIn = function (v) { ch.mapRoom = cleanCode(v); mutate(() => {}, false); };
  S.useCurrentTable = function () {
    const code = CF.party.status().roomCode;
    if (!code) { CF.flash("You're not at a table right now."); return; }
    ch.gameRoom = code;
    CF.flash("Linked to table " + code + "."); CF.sfx("chip");
    mutate(() => {}, true);
  };
  S.joinGameRoom = function () {
    const code = cleanCode(ch.gameRoom);
    if (!code) { CF.flash("Set a game room code first."); return; }
    CF.party.joinRoom(code);
  };
  function copyText(t) {
    try { navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
  }
  S.copyRoom = function () {
    const code = cleanCode(ch.gameRoom);
    if (!code) { CF.flash("No game room code set."); return; }
    copyText(code); CF.flash("Room code " + code + " copied."); CF.sfx("chip");
  };
  S.copyMap = function () {
    const code = cleanCode(ch.mapRoom);
    if (!code) { CF.flash("No battle map code set."); return; }
    copyText(code); CF.flash("Map code " + code + " copied."); CF.sfx("chip");
  };
  S.openMap = function () {
    const code = cleanCode(ch.mapRoom);
    if (!code) { CF.flash("Set a battle map code first."); return; }
    copyText(code);
    window.open("https://perchance.org/battle-map-forge", "_blank");
    CF.flash("Opened Battle Map — map code " + code + " copied, paste it in the Join box.");
  };

  S.rollHD = function () {
    const total = ch.level, used = ch.hitDice.used || 0;
    if (used >= total) { CF.flash("No hit dice left — take a long rest."); return; }
    const die = C.klass(ch.klass).hitDie || 8;
    const roll = D.rollDie(1, die);
    ch.hitDice.used = used + 1;
    const con = C.mods(ch.scores).con;
    ch.hp.current = Math.min(ch.hp.maxSet ? ch.hp.max : C.maxHP(ch), (ch.hp.current == null ? C.maxHP(ch) : ch.hp.current) + roll + con);
    CF.flash(`Short rest: healed ${roll + con} HP (d${die} = ${roll} + ${con} Con).`);
    CF.sfx("dice");
    mutate(() => {}, true);
  };
  S.longRest = function () {
    ch.hp.current = ch.hp.maxSet ? ch.hp.max : C.maxHP(ch);
    ch.hp.temp = 0;
    ch.hitDice.used = 0;
    ch.slotsUsed = {};
    ch.deathSaves = { s: 0, f: 0 };
    CF.flash("Long rest — fully restored!");
    CF.sfx("tada");
    mutate(() => {}, true);
  };
  S.ds = function (k, i) {
    const ds = ch.deathSaves;
    ds[k] = i === (ds[k] - 1) ? i : i + 1;
    ds[k] = C.clamp(ds[k], 0, 3);
    mutate(() => {}, true);
  };
  S.toggleSlot = function (lvl, i) {
    const used = ch.slotsUsed || {};
    const n = C.spellSlots(ch)[lvl] || 0;
    let cur = used[lvl] || 0;
    // clicking dot i: if i < cur, spend down to i; else spend up to i+1
    cur = i < cur ? i : i + 1;
    used[lvl] = C.clamp(cur, 0, n);
    ch.slotsUsed = used;
    CF.sfx("chip");
    mutate(() => {}, true);
  };

  S.levelUp = function () {
    if (ch.level >= 20) { CF.flash("Level 20 is the cap."); return; }
    let gain = 0;
    if (!ch.hp.maxSet) {
      const oldMax = ch.hp.max || C.maxHP(ch);
      ch.level++;
      const newMax = C.maxHP(ch);
      gain = newMax - oldMax;
      ch.hp.max = newMax;
      ch.hp.current = (ch.hp.current == null ? 0 : ch.hp.current) + Math.max(0, gain);
    } else {
      ch.level++;
    }
    const ke = C.klassEd(ch.klass, ch.ruleset);
    if (ch.subclass && ch.level < ke.subclassLevel) ch.subclass = null;
    CF.flash(`Level up! Now level ${ch.level} (+${gain} HP).`);
    CF.sfx("tada");
    mutate(() => {}, true);
  };
  S.edit = function () {
    const tmp = { ...ch, id: ch.id };
    C.wizard.open(JSON.parse(JSON.stringify(ch)), ch.id);
  };
  S.print = function () { window.print(); };

  S.toggleSkill = function (id) {
    const canExpert = ch.klass === "rogue" || ch.klass === "bard";
    const cur = ch.skills[id] || 0;
    if (cur === 0) ch.skills[id] = 1;
    else if (cur === 1) ch.skills[id] = canExpert ? 2 : 0;
    else ch.skills[id] = 0;
    mutate(() => {}, true);
  };
  S.removeWeapon = function (i) { ch.weapons.splice(i, 1); mutate(() => {}, true); };
  S.removeEquip = function (i) { ch.equipment.splice(i, 1); mutate(() => {}, true); };

  S.addSpell = function (lvl, id, sel) {
    if (!id) return;
    if (!ch.spellsKnown) ch.spellsKnown = { cantrips: [] };
    if (!ch.spellsKnown[lvl]) ch.spellsKnown[lvl] = [];
    if (!ch.spellsKnown[lvl].includes(id)) ch.spellsKnown[lvl].push(id);
    mutate(() => {}, true);
  };
  S.removeSpell = function (lvl, i) {
    const arr = ch.spellsKnown[lvl] || [];
    const id = arr[i];
    arr.splice(i, 1);
    if (id && ch.preparedList) delete ch.preparedList[id];
    mutate(() => {}, true);
  };
  S.togglePrepared = function (id) {
    if (!ch.preparedList) ch.preparedList = {};
    if (ch.preparedList[id]) delete ch.preparedList[id];
    else ch.preparedList[id] = true;
    mutate(() => {}, true);
  };
})();
