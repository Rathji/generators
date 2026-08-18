/* ════════════════════════════════════════════════════════════════
   D&D CHARACTER FORGE — app shell: routing, roster, lobby wiring
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  const D = window.DND;
  const C = window.CF;
  const $ = (id) => document.getElementById(id);

  C.cur = C.cur || { ruleset: "2024" };

  /* ─── toast + sfx + scroll ─── */
  let toastTimer;
  C.flash = function (msg) {
    let t = $("flashToast");
    if (!t) { t = document.createElement("div"); t.id = "flashToast"; t.className = "flash-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  };
  C.sfx = function (name) { try { if (window.BGN && BGN.sfx) BGN.sfx.play(name); } catch (e) {} };
  C.gotoTop = function () { try { window.scrollTo({ top: 0, behavior: "auto" }); } catch (e) { window.scrollTo(0, 0); } };

  /* ─── roster ─── */
  C.roster = [];
  let prefs = {};

  async function loadRoster() {
    C.roster = await C.loadChars();
    prefs = await C.loadSettings();
    if (!prefs.ruleset) prefs.ruleset = "2024";
    renderRoster();
  }

  function renderRoster() {
    const el = $("rosterList");
    el.innerHTML = "";
    if (!C.roster.length) {
      el.innerHTML = `
        <div class="panel center" style="grid-column:1/-1; padding:48px 26px">
          <div style="font-size:2.4rem">🎲</div>
          <h2 class="goldtext" style="margin:10px 0 6px">Your party awaits</h2>
          <p class="muted" style="max-width:480px; margin:0 auto 18px">Create your first hero — choose a rules edition (2014 Legacy or 2024), pick a species, class, and background, and let the AI help fill in the rest. Your heroes live in this browser and travel with you to the Party Table.</p>
          <button class="btn btn-gold" onclick="CF.newCharacter()">⚔️ Create your first hero</button>
        </div>`;
      return;
    }
    C.roster.forEach((c) => {
      const kl = c.klass ? D.classes[c.klass] : null;
      const sp = c.species ? D.species[c.species] : null;
      const bg = c.background ? D.backgrounds[c.background] : null;
      const hpMax = C.maxHP(c);
      const card = document.createElement("div");
      card.className = "card char-card";
      card.innerHTML = `
        <div class="card-cover">
          ${c.portrait ? `<img class="char-portrait" src="${c.portrait}" alt="">` : `<div class="cover-glyph">${kl ? kl.icon : "❓"}</div>`}
          <span class="card-players">${D.ED[c.ruleset].label}</span>
        </div>
        <div class="card-body">
          <div class="card-title">${C.esc(c.name || "Unnamed")}</div>
          <div class="card-blurb">${kl ? kl.name : "?"} ${c.level}${c.subclass ? " · " + cap(c.subclass) : ""}<br>${sp ? sp.name : "?"}${bg ? " · " + bg.name : ""}</div>
          <div class="char-hpbar"><div style="width:${hpMax ? Math.max(0, Math.min(100, (c.hp.current / hpMax) * 100)) : 0}%"></div></div>
          ${c.gameRoom ? `<div class="muted small">🔗 Table ${C.esc(c.gameRoom)}${c.mapRoom ? " · Map " + C.esc(c.mapRoom) : ""}</div>` : ""}
          <div class="muted small">HP ${c.hp.current != null ? c.hp.current : "?"}/${hpMax} · AC ${C.ACFor(c)} · Init ${C.signed(C.initiative(c))}</div>
          <div class="card-actions">
            <button class="btn btn-gold btn-sm" onclick="CF.openSheet('${c.id}')">Open sheet</button>
            <button class="btn btn-ghost btn-sm" onclick="CF.openEdit('${c.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm danger" onclick="CF.deleteChar('${c.id}')">Delete</button>
          </div>
        </div>`;
      el.appendChild(card);
    });
  }

  function cap(s) { return String(s).split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }

  /* ─── routing ─── */
  C.showLobby = function () {
    $("forgeCtn").hidden = true;
    $("tableCtn").hidden = true;
    $("lobbyCtn").hidden = false;
    refreshContinue();
    C.gotoTop();
  };
  C.showRoster = async function () {
    await loadRoster();
    $("lobbyCtn").hidden = true;
    $("tableCtn").hidden = true;
    $("forgeCtn").hidden = false;
    $("wizardScreen").hidden = true;
    $("sheetScreen").hidden = true;
    $("rosterScreen").hidden = false;
    renderRoster();
    C.gotoTop();
  };
  C.openSheet = async function (id) {
    let ch = C.roster.find((c) => c.id === id);
    if (!ch) { await loadRoster(); ch = C.roster.find((c) => c.id === id); }
    if (!ch) { C.flash("Character not found."); C.showRoster(); return; }
    localStorage.setItem("dndforge_last", id);
    refreshContinue();
    C.sheet.render(ch);
  };
  C.openEdit = function (id) {
    const ch = C.roster.find((c) => c.id === id);
    if (!ch) return;
    C.wizard.open(JSON.parse(JSON.stringify(ch)), id);
  };
  C.newCharacter = function () {
    const c = C.newChar(prefs.ruleset || "2024");
    C.wizard.open(c, null);
  };
  C.deleteChar = async function (id) {
    if (!confirm("Delete this character permanently?")) return;
    await C.deleteChar(id);
    C.sfx("discard");
    await loadRoster();
  };

  /* continue panel on lobby */
  function refreshContinue() {
    const el = $("continuePanel");
    if (!el) return;
    const last = localStorage.getItem("dndforge_last");
    const found = last && C.roster.find((c) => c.id === last);
    if (found) {
      el.hidden = false;
      $("continueInfoEl").textContent = "Continue with " + found.name + " — " + (found.klass ? D.classes[found.klass].name : "?") + " " + found.level + ".";
      $("continueBtn").onclick = () => C.openSheet(found.id);
      $("deleteSaveBtn").onclick = () => { localStorage.removeItem("dndforge_last"); refreshContinue(); };
    } else el.hidden = true;
  }

  /* ─── help modal ─── */
  const HELP_HTML = `
    <h2 class="goldtext">D&amp;D Character Forge</h2>
    <p class="muted">Create, manage, and play Dungeons &amp; Dragons 5th Edition characters — for the <b>2014 Legacy</b> and <b>2024</b> rules. Your heroes are stored privately in your browser.</p>
    <h3>Character Forge</h3>
    <p>Step through the guided creator: rules edition, identity, species, class, background, ability scores, skills, appearance (with an <b>AI-generated portrait</b>), personality, and equipment. Almost every field has an <b>✨ AI</b> button and a <b>🎲</b> dice button — or just hit a big <b>"Suggest / Compose / Write"</b> button to have the AI fill whole sections at once.</p>
    <h3>The sheet</h3>
    <p>Your character sheet is live during play: tap <b>−5/+5</b> to track damage and healing, click <b>●</b> spell-slot dots to spend them, roll a <b>hit die</b> on a short rest, track <b>death saves</b>, and take a <b>🌙 long rest</b> to reset everything. ✏ Edit reopens the creator with everything preserved.</p>
    <h3>Party Table (online)</h3>
    <p>Create a table and share the 5-letter code. Each player brings one of their heroes to a seat — the whole party sees live name, class, level, HP and AC cards, with table chat included. Link a hero to your table (🔗 on the table or on the sheet) and to its Battle Map table — joining a linked room brings that hero straight to your seat.</p>
    <h3>Notes</h3>
    <p>This is a curated rules reference, not a replacement for the sourcebooks — exact class features, spell lists, and 2024 revisions vary. Always confirm with your table.</p>
    <button class="btn btn-gold" id="helpDoneBtn">Got it</button>`;
  function openHelp() {
    $("helpBody").innerHTML = HELP_HTML;
    $("helpDoneBtn").addEventListener("click", closeHelp);
    $("helpOverlay").hidden = false;
  }
  function closeHelp() { $("helpOverlay").hidden = true; }

  /* ─── welcome intro (popup on first load) ─── */
  const INTRO_HTML = `
    <div class="intro-hero">
      <div class="intro-icon">⚔️</div>
      <h2 style="color:var(--bgn-accent2); font-family:var(--bgn-serif); font-weight:700; font-size:1.35rem; margin:4px 0 2px">Welcome to the D&amp;D Character Forge</h2>
      <p class="muted" style="margin-top:4px">Create, manage, and play D&amp;D 5e heroes — 2014 Legacy or 2024 rules — all in this browser.</p>
    </div>
    <div class="intro-step"><span class="intro-num">1</span><div><b>Forge your hero</b><br><span class="muted">Walk through the 10-step creator. Every field has an <b>✨ AI</b> button and a <b>🎲</b> dice button — or hit a big <b>Suggest / Compose</b> button to fill whole sections at once, including an AI portrait.</span></div></div>
    <div class="intro-step"><span class="intro-num">2</span><div><b>Play with the live sheet</b><br><span class="muted">Track HP with <b>−5/+5</b>, spend <b>●</b> spell-slot dots, roll hit dice on a short rest, mark death saves, level up, and take a long rest to reset everything.</span></div></div>
    <div class="intro-step"><span class="intro-num">3</span><div><b>Gather at the Party Table</b><br><span class="muted">Create a table, share the 5-letter code, and bring your hero to a seat. The whole party sees live HP/AC cards, with table chat included.</span></div></div>
    <p class="muted" style="font-size:.78rem; text-align:center; margin-top:14px">Tap <b>❓ How it works</b> in the menu for the full guide anytime.</p>
    <button class="btn btn-gold" id="helpDoneBtn" style="width:100%">Got it — let's roll! 🎲</button>`;
  function openIntro() {
    $("helpBody").innerHTML = INTRO_HTML;
    $("helpDoneBtn").addEventListener("click", closeHelp);
    $("helpOverlay").hidden = false;
  }

  /* ─── share / export ─── */
  function setupShare() {
    if (!window.bgnShare) return;
    const shareBtn = $("shareBtn");
    if (!shareBtn) return;
    const panel = window.bgnShare.openPanel({
      tpl: "dnd-character-forge",
      gameName: "D&D Character Forge",
      exportData() {
        if (!C.roster.length) return null;
        return { chars: C.roster.map((c) => JSON.parse(JSON.stringify(c))) };
      },
      async applySave(o) {
        if (!o || !Array.isArray(o.chars)) return false;
        for (const c of o.chars) { if (c && c.id) await C.saveChar(c); }
        await loadRoster();
        return true;
      },
      source() {
        return $("sheetScreen") && !$("sheetScreen").hidden ? $("sheetScreen") : ($("rosterScreen") && !$("rosterScreen").hidden ? $("rosterScreen") : $("lobbyCtn"));
      },
      title() { return "D&D CHARACTER FORGE"; },
      subtitle() { return C.roster.length + " hero" + (C.roster.length === 1 ? "" : "es") + " · " + new Date().toLocaleDateString(); },
      filenameBase: "dnd-character-forge",
    });
    shareBtn.addEventListener("click", () => panel.open());
  }

  /* ─── lobby wiring ─── */
  function wireLobby() {
    document.querySelectorAll(".bgn-mode").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.dataset.mode;
        if (m === "party") { C.party.enter(); return; }
        try { C.party.exit(); } catch (e) {}
        C.showRoster();
        C.sfx("deal");
      });
    });
    $("helpBtn").addEventListener("click", openHelp);
    $("helpCloseBtn").addEventListener("click", closeHelp);
    $("helpOverlay").addEventListener("click", (e) => { if (e.target === $("helpOverlay")) closeHelp(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("helpOverlay").hidden) closeHelp(); });
  }

  /* ─── boot ─── */
  async function boot() {
    wireLobby();
    C.wizard.init();
    C.party.init();
    refreshContinue();
    setupShare();
    // prefetch roster so cards & continue panel work immediately
    await loadRoster();
    refreshContinue();
    C.sheet; // ensure sheet module loaded
    if (!sessionStorage.getItem("dndforge_intro_seen")) { try { sessionStorage.setItem("dndforge_intro_seen", "1"); } catch (e) {} openIntro(); }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
