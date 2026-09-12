import { GRID, TOWERS, ENEMIES, PLANETS, DIFFICULTIES, ABILITIES, HERO, ACCENTS } from "./config.js";
import { Game } from "./game.js";
import { draw, CANVAS_W, CANVAS_H, invalidateTerrain } from "./render.js";
import * as save from "./save.js";
import * as audio from "./audio.js";

const $ = (id) => document.getElementById(id);

export function createApp({ canvas, ctx }) {
  const els = {
    hud: $("hud"), stage: $("stage"), wrap: $("canvasWrap"),
    credits: $("statCredits"), lives: $("statLives"), livesStat: $("livesStat"),
    wave: $("statWave"), score: $("statScore"), brandPlanet: $("brandPlanet"),
    buildBar: $("buildBar"), abilityBar: $("abilityBar"), towerPanel: $("towerPanel"),
    waveTag: $("waveTag"), nextWaveBtn: $("nextWaveBtn"), toasts: $("toasts"),
    menu: $("menuScreen"), select: $("selectScreen"), brief: $("briefScreen"),
    pause: $("pauseScreen"), result: $("resultScreen"), settings: $("settingsScreen"), tutorial: $("tutorialScreen"),
    totals: $("totals"), planetGrid: $("planetGrid"), difficultyRow: $("difficultyRow"),
    resultTitle: $("resultTitle"), resultSub: $("resultSub"), resultStars: $("resultStars"),
    resultStats: $("resultStats"), resultBtns: $("resultBtns"),
    briefTitle: $("briefTitle"), briefSub: $("briefSub"), briefEnemies: $("briefEnemies"), briefInfo: $("briefInfo"),
    endlessNote: $("endlessNote"), selectTitle: $("selectTitle"),
    accentSwatches: $("accentSwatches"),
    speedBtn: $("btnSpeed"), soundBtn: $("btnSound"),
  };

  const OVERLAYS = { menu: els.menu, select: els.select, brief: els.brief, pause: els.pause, result: els.result, settings: els.settings, tutorial: els.tutorial };

  let game = null;
  let currentOverlay = "menu";
  let transientReturn = null;
  let wasRunning = false;
  let mode = "idle";
  let ghostType = null;
  let pendingAbility = null;
  let hover = { c: -1, r: -1 };
  let settings = save.getSettings();
  let selectedPlanet = 0;
  let selectedDifficulty = "normal";
  let endless = false;
  let heroSelected = false;
  let lastPhase = null;

  function hexToRgb(h) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 72, g: 180, b: 255 };
  }
  function lighten(h, amt) {
    const c = hexToRgb(h);
    const f = (v) => Math.round(v + (255 - v) * amt);
    return "rgb(" + f(c.r) + "," + f(c.g) + "," + f(c.b) + ")";
  }

  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.motion = settings.motion ? "off" : "on";
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--accent2", lighten(settings.accent, 0.4));
    root.style.fontSize = "16px";
    audio.applySettings(settings);
    if (els.soundBtn) els.soundBtn.textContent = settings.muted ? "🔇" : "🔊";
    document.querySelectorAll("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === settings.theme));
    document.querySelectorAll("#qualitySeg button").forEach((b) => b.classList.toggle("on", b.dataset.q === settings.quality));
    document.querySelectorAll("#speedSeg button").forEach((b) => b.classList.toggle("on", +b.dataset.s === settings.defaultSpeed));
    const mo = $("motionToggle"); if (mo) mo.checked = !!settings.motion;
    const vm = $("volMaster"); if (vm) vm.value = settings.master;
    const vmu = $("volMusic"); if (vmu) vmu.value = settings.music;
    const vs = $("volSfx"); if (vs) vs.value = settings.sfx;
    document.querySelectorAll("#accentSwatches button").forEach((b) => b.classList.toggle("on", b.dataset.accent === settings.accent));
    if (game) { invalidateTerrain(); }
  }

  function toast(msg, kind) {
    const d = document.createElement("div");
    d.className = "toast " + (kind || "");
    d.textContent = msg;
    els.toasts.appendChild(d);
    setTimeout(() => { d.style.opacity = "0"; d.style.transition = "opacity .3s"; }, 2200);
    setTimeout(() => d.remove(), 2600);
  }

  function showOverlay(name) {
    Object.values(OVERLAYS).forEach((o) => { if (o) o.hidden = true; });
    currentOverlay = name;
    if (name && OVERLAYS[name]) OVERLAYS[name].hidden = false;
  }

  function pauseGame() { if (game && game.phase === "running") { game.phase = "paused"; wasRunning = true; } }
  function resumeGame() { if (game && game.phase === "paused") { game.phase = "running"; wasRunning = false; } }

  function openPause() {
    if (!game || (game.phase !== "running" && game.phase !== "paused")) return;
    pauseGame();
    showOverlay("pause");
  }
  function openTransient(name) {
    if (currentOverlay !== "settings" && currentOverlay !== "tutorial") transientReturn = currentOverlay;
    if (game && game.phase === "running") { pauseGame(); transientReturn = transientReturn || "pause"; }
    showOverlay(name);
  }
  function closeTransient() {
    const target = transientReturn;
    transientReturn = null;
    if (target) showOverlay(target);
    else { showOverlay(null); resumeGame(); }
  }

  function openSettings() { openTransient("settings"); }
  function openTutorial() { openTransient("tutorial"); }

  /* ── Music ─────────────────────────────────────────── */
  function updateMusic() {
    if (settings.muted) { audio.music("off"); return; }
    if (game && (game.phase === "running" || game.phase === "paused")) audio.music("combat");
    else audio.music("menu");
  }

  /* ── Screen builders ───────────────────────────────── */
  function buildTotals() {
    const t = save.data().totals;
    els.totals.innerHTML =
      "<div><b>" + t.wins + "</b>Victories</div>" +
      "<div><b>" + t.kills + "</b>Kills</div>" +
      "<div><b>" + t.credits + "</b>Credits Earned</div>";
  }

  function buildDifficultyRow() {
    els.difficultyRow.innerHTML = "";
    Object.values(DIFFICULTIES).forEach((d) => {
      const b = document.createElement("button");
      b.className = "seg-btn" + (d.key === selectedDifficulty ? " on" : "");
      b.textContent = d.name;
      b.onclick = () => { selectedDifficulty = d.key; buildDifficultyRow(); };
      els.difficultyRow.appendChild(b);
    });
  }

  function buildPlanetGrid() {
    els.planetGrid.innerHTML = "";
    PLANETS.forEach((p, i) => {
      const unlocked = save.isUnlocked(p.id, i);
      const stars = save.data().stars[p.id] || 0;
      const best = save.data().best[p.id];
      const card = document.createElement("button");
      card.className = "pcard" + (i === selectedPlanet ? " selected" : "") + (unlocked ? "" : " locked");
      card.innerHTML =
        '<div class="pc-swatch" style="background:linear-gradient(135deg,' + p.palette.accent + ',' + p.palette.bg + ')"></div>' +
        '<div class="pc-name">' + p.name + "</div>" +
        '<div class="pc-sub">' + p.subtitle + "</div>" +
        '<div class="pc-tag">' + p.tag + "</div>" +
        '<div class="pc-stars">' + [0, 1, 2].map((s) => (s < stars ? "★" : "☆")).join("") + "</div>" +
        '<div class="pc-best">' + (best ? "Best: " + best.score.toLocaleString() + " pts · wave " + best.wave : "Not yet cleared") + "</div>" +
        (unlocked ? "" : '<div class="pc-lock">🔒</div>');
      if (unlocked) card.onclick = () => { selectedPlanet = i; buildPlanetGrid(); };
      els.planetGrid.appendChild(card);
    });
  }

  function openSelect(isEndless) {
    endless = !!isEndless;
    els.selectTitle.textContent = endless ? "Endless Survival" : "Choose Your Battlefield";
    els.endlessNote.hidden = !endless;
    buildDifficultyRow();
    buildPlanetGrid();
    showOverlay("select");
  }

  function openBrief() {
    const p = PLANETS[selectedPlanet];
    els.briefTitle.textContent = endless ? "Endless — " + p.name : p.name;
    els.briefSub.textContent = p.tag;
    const seen = new Set();
    const types = p.pool.map((x) => x.type);
    els.briefEnemies.innerHTML = types.filter((t) => { if (seen.has(t)) return false; seen.add(t); return true; })
      .map((t) => { const e = ENEMIES[t]; return '<span class="echip"><i style="--ec:' + e.accent + '"></i>' + e.name + "</span>"; }).join("");
    els.briefInfo.innerHTML = "Difficulty: <b>" + DIFFICULTIES[selectedDifficulty].name + "</b> · " +
      (endless ? "Unlimited waves" : (p.waves + " waves")) + " · Base lives: " + DIFFICULTIES[selectedDifficulty].lives +
      (p.boss ? " · Boss: <b>" + ENEMIES[p.boss].name + "</b>" : "");
    showOverlay("brief");
  }

  /* ── Dock ──────────────────────────────────────────── */
  function buildDock() {
    els.buildBar.innerHTML = "";
    TOWERS.forEach((def, i) => {
      const card = document.createElement("button");
      card.className = "tcard";
      card.dataset.id = def.id;
      card.innerHTML =
        '<span class="tc-key">' + (i + 1) + "</span>" +
        '<div class="tc-top"><span class="tc-icon" style="color:' + def.color + '">' + def.icon + "</span>" +
        '<span class="tc-name">' + def.short + '</span><span class="tc-cost">' + def.tiers[0].cost + "</span></div>" +
        '<div class="tc-desc">' + def.desc + "</div>" +
        '<div class="tc-stats" data-stats></div>';
      card.onclick = () => selectTowerType(def.id);
      els.buildBar.appendChild(card);
    });
    const hero = document.createElement("button");
    hero.className = "tcard";
    hero.id = "heroCard";
    hero.dataset.hero = "1";
    hero.innerHTML =
      '<span class="tc-key">H</span>' +
      '<div class="tc-top"><span class="tc-icon" style="color:#57e08a">' + HERO.icon + "</span>" +
      '<span class="tc-name">Jedi Hero</span><span class="tc-cost">' + HERO.cost + "</span></div>" +
      '<div class="tc-desc">Deploy the hero, then click the map to reposition her.</div>' +
      '<div class="tc-stats" data-stats>DMG ' + HERO.damage + " · RNG " + HERO.range + "</div>";
    hero.onclick = () => selectHeroType();
    els.buildBar.appendChild(hero);

    els.abilityBar.innerHTML = "";
    Object.values(ABILITIES).forEach((a) => {
      const b = document.createElement("button");
      b.className = "abtn"; b.dataset.id = a.id;
      b.innerHTML = '<div class="ab-fill" style="height:0"></div>' +
        '<div class="ab-icon">' + a.icon + "</div>" +
        '<div class="ab-name">' + a.name + "</div>" +
        '<div class="ab-cd ready" data-cd>Ready</div>';
      b.onclick = () => armAbility(a.id);
      els.abilityBar.appendChild(b);
    });
    const hb = document.createElement("button");
    hb.className = "abtn"; hb.id = "heroAbilityBtn";
    hb.innerHTML = '<div class="ab-fill" style="height:0"></div>' +
      '<div class="ab-icon">' + HERO.ability.icon + "</div>" +
      '<div class="ab-name">Saber Sweep</div>' +
      '<div class="ab-cd" data-cd>No hero</div>';
    hb.onclick = () => { if (game && game.hero && game.hero.alive) game.useHeroAbility(); };
    els.abilityBar.appendChild(hb);
  }

  function selectTowerType(id) {
    if (!game || game.phase !== "running") return;
    ghostType = id; mode = "build"; pendingAbility = null; heroSelected = false;
    game.selectedTowerId = null; renderTowerPanel();
    syncDock();
    audio.play("click");
  }
  function selectHeroType() {
    if (!game || game.phase !== "running") return;
    if (game.hero && game.hero.alive) { heroSelected = true; mode = "idle"; ghostType = null; syncDock(); if (game.hero.tcol != null) toast("Click the map to move the Jedi", "info"); return; }
    ghostType = "__hero"; mode = "build"; pendingAbility = null; syncDock(); audio.play("click");
  }

  function syncDock() {
    els.buildBar.querySelectorAll(".tcard").forEach((c) => {
      const id = c.dataset.id;
      const isHero = c.dataset.hero;
      if (id) {
        const def = TOWERS.find((t) => t.id === id);
        c.classList.toggle("selected", ghostType === id);
        c.classList.toggle("disabled", !!game && !game.canAfford(def.tiers[0].cost));
        const s = def.tiers[0];
        const st = c.querySelector("[data-stats]");
        if (st) st.textContent = "DMG " + s.damage + " · RNG " + Math.round(s.range) + " · " + s.fireRate.toFixed(1) + "/s";
      } else if (isHero) {
        c.classList.toggle("selected", ghostType === "__hero" || heroSelected);
        c.classList.toggle("disabled", !!game && (!!(game.hero && game.hero.alive) || !game.canAfford(HERO.cost)));
      }
    });
    els.abilityBar.querySelectorAll(".abtn[data-id]").forEach((b) => {
      b.classList.toggle("armed", pendingAbility === b.dataset.id);
    });
  }

  function armAbility(id) {
    if (!game || game.phase !== "running") return;
    if (!game.abilities[id].ready) { audio.play("error"); return; }
    pendingAbility = pendingAbility === id ? null : id;
    ghostType = null; mode = pendingAbility ? "ability" : "idle";
    game.selectedTowerId = null; renderTowerPanel();
    syncDock();
    if (pendingAbility) toast(ABILITIES[id].name + " armed — click the battlefield", "info");
  }

  function cancelModes() {
    ghostType = null; pendingAbility = null; mode = "idle"; heroSelected = false;
    if (game) game.selectedTowerId = null;
    syncDock(); renderTowerPanel();
  }

  /* ── Tower panel ───────────────────────────────────── */
  function renderTowerPanel() {
    if (!game || !game.selectedTowerId) { els.towerPanel.hidden = true; return; }
    const t = game.towers.find((x) => x.id === game.selectedTowerId);
    if (!t) { els.towerPanel.hidden = true; return; }
    const def = TOWERS.find((d) => d.id === t.typeId);
    const s = def.tiers[t.level];
    const next = def.tiers[t.level + 1];
    const upCost = game.upgradeCost(t);
    els.towerPanel.hidden = false;
    els.towerPanel.innerHTML =
      '<button class="tp-close" id="tpClose">×</button>' +
      "<h3>" + def.name + "</h3>" +
      '<div class="tp-lvl">Tier ' + (t.level + 1) + " / 4</div>" +
      '<div class="tp-stats">' +
        "<div><span>Damage</span><b>" + s.damage + (next ? " → " + next.damage : "") + "</b></div>" +
        "<div><span>Range</span><b>" + Math.round(s.range) + (next ? " → " + Math.round(next.range) : "") + "</b></div>" +
        "<div><span>Rate</span><b>" + s.fireRate.toFixed(2) + "/s</b></div>" +
        "<div><span>Kills</span><b>" + t.kills + "</b></div>" +
      "</div>" +
      '<div class="tp-seg" data-seg>' +
        ["first", "closest", "strongest"].map((m) =>
          '<button data-m="' + m + '" class="' + (t.targeting === m ? "on" : "") + '">' + m.charAt(0).toUpperCase() + m.slice(1) + "</button>").join("") +
      "</div>" +
      '<div class="tp-actions">' +
        '<button class="tp-btn up" id="tpUp" ' + (upCost == null || game.credits < upCost ? "disabled" : "") + ">" + (upCost == null ? "Max Tier" : "Upgrade " + upCost + "⬡") + "</button>" +
        '<button class="tp-btn sell" id="tpSell">Sell ' + game.sellValue(t) + "⬡</button>" +
      "</div>";
    positionTowerPanel();
    const close = $("tpClose"); if (close) close.onclick = () => { game.selectedTowerId = null; renderTowerPanel(); };
    const up = $("tpUp"); if (up) up.onclick = () => { if (game.upgradeTower(t)) { renderTowerPanel(); syncDock(); } };
    const sell = $("tpSell"); if (sell) sell.onclick = () => { game.sellTower(t); renderTowerPanel(); syncDock(); };
    els.towerPanel.querySelectorAll("[data-seg] button").forEach((b) => {
      b.onclick = () => { game.setTargeting(t, b.dataset.m); renderTowerPanel(); };
    });
  }
  function positionTowerPanel() {
    const rect = els.hud.getBoundingClientRect();
    els.towerPanel.style.top = (rect.bottom + 12) + "px";
    els.towerPanel.style.right = "16px";
    els.towerPanel.style.left = "auto";
  }

  /* ── Canvas input ──────────────────────────────────── */
  function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (CANVAS_W / r.width);
    const y = (e.clientY - r.top) * (CANVAS_H / r.height);
    return { c: Math.floor(x / GRID.cell), r: Math.floor(y / GRID.cell), x, y };
  }

  function onMove(e) {
    const p = cellFromEvent(e);
    hover = { c: p.c, r: p.r, x: p.x, y: p.y };
  }

  function onClick(e) {
    audio.initAudio();
    if (!game || game.phase !== "running") return;
    const p = cellFromEvent(e);
    if (p.c < 0 || p.r < 0 || p.c >= GRID.cols || p.r >= GRID.rows) return;
    const cx = (p.c + 0.5) * GRID.cell, cy = (p.r + 0.5) * GRID.cell;

    if (mode === "ability" && pendingAbility) {
      game.castAbility(pendingAbility, cx, cy);
      pendingAbility = null; mode = "idle"; syncDock();
      return;
    }
    if (mode === "build" && ghostType) {
      const occupied = game.towerAt(p.c, p.r);
      if (occupied) {
        game.selectedTowerId = occupied.id; mode = "idle"; ghostType = null; heroSelected = false;
        syncDock(); renderTowerPanel(); audio.play("click");
        return;
      }
      if (ghostType === "__hero") game.buildHero(p.c, p.r);
      else game.placeTower(ghostType, p.c, p.r);
      renderTowerPanel(); syncDock();
      return;
    }
    if (game.hero && game.hero.alive && heroSelected) {
      game.moveHero(p.c, p.r);
      toast("Jedi en route", "info");
      return;
    }
    const t = game.towerAt(p.c, p.r);
    if (t) {
      game.selectedTowerId = t.id; heroSelected = false; mode = "idle"; syncDock(); renderTowerPanel();
      audio.play("click");
    } else if (game.hero && game.hero.alive && Math.abs(game.hero.col - p.c) <= 0 && Math.abs(game.hero.row - p.r) <= 0) {
      heroSelected = true; game.selectedTowerId = null; renderTowerPanel();
    } else {
      game.selectedTowerId = null; heroSelected = false; renderTowerPanel();
    }
    if (game.hero && game.hero.alive && !heroSelected && !game.selectedTowerId) {
      const hx = Math.floor(game.hero.x / GRID.cell), hy = Math.floor(game.hero.y / GRID.cell);
      if (hx === p.c && hy === p.r) { heroSelected = true; toast("Jedi selected — click the map to move her", "info"); }
    }
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onClick);
  canvas.addEventListener("pointerleave", () => { hover = { c: -1, r: -1 }; });
  canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); cancelModes(); });

  /* ── HUD ───────────────────────────────────────────── */
  function updateHud() {
    if (!game) return;
    els.credits.textContent = game.credits;
    els.lives.textContent = game.lives;
    els.livesStat.classList.toggle("low", game.lives <= 5);
    els.wave.textContent = game.wave + "/" + (game.endless ? "∞" : game.totalWaves);
    els.score.textContent = game.score.toLocaleString();
    els.brandPlanet.textContent = game.planet.name + " · " + game.difficulty.name + (game.endless ? " · Endless" : "");
    els.speedBtn.textContent = game.speed + "×";

    if (!game.waveActive && game.phase === "running" && game.wave < game.totalWaves) {
      els.waveTag.hidden = false;
      const secs = Math.max(0, Math.ceil(game.countdown));
      els.waveTag.classList.remove("boss");
      els.waveTag.textContent = "WAVE " + (game.wave + 1) + " IN " + secs + "s";
      els.nextWaveBtn.hidden = false;
      els.nextWaveBtn.innerHTML = "SEND NEXT WAVE <span class='cd'>(+25⬡)</span>";
    } else if (game.waveActive) {
      els.waveTag.hidden = false;
      const boss = game.isBossWave(game.wave);
      els.waveTag.classList.toggle("boss", boss);
      const alive = game.enemies.length + game.queue.length;
      els.waveTag.textContent = (boss ? "★ BOSS WAVE " : "WAVE ") + game.wave + (game.endless ? "" : "/" + game.totalWaves) + " · " + alive + " left";
      els.nextWaveBtn.hidden = true;
    } else {
      els.waveTag.hidden = true;
      els.nextWaveBtn.hidden = true;
    }

    els.abilityBar.querySelectorAll(".abtn[data-id]").forEach((b) => {
      const a = game.abilities[b.dataset.id];
      const cd = b.querySelector("[data-cd]");
      const fill = b.querySelector(".ab-fill");
      if (a.cd > 0) { cd.textContent = Math.ceil(a.cd) + "s"; cd.classList.remove("ready"); fill.style.height = Math.round((a.cd / ABILITIES[b.dataset.id].cooldown) * 100) + "%"; }
      else { cd.textContent = "Ready"; cd.classList.add("ready"); fill.style.height = "0"; }
    });
    const hb = $("heroAbilityBtn");
    if (hb) {
      const cd = hb.querySelector("[data-cd]");
      const fill = hb.querySelector(".ab-fill");
      if (game.hero && game.hero.alive) {
        if (game.hero.abilityCd > 0) { cd.textContent = Math.ceil(game.hero.abilityCd) + "s"; cd.classList.remove("ready"); fill.style.height = Math.round((game.hero.abilityCd / HERO.ability.cooldown) * 100) + "%"; }
        else { cd.textContent = "Ready"; cd.classList.add("ready"); fill.style.height = "0"; }
      } else { cd.textContent = "No hero"; cd.classList.remove("ready"); fill.style.height = "0"; }
    }
  }

  /* ── Game lifecycle ────────────────────────────────── */
  function launch() {
    invalidateTerrain();
    game = new Game(selectedPlanet, selectedDifficulty, { endless });
    game.speed = settings.defaultSpeed || 1;
    lastPhase = game.phase;
    mode = "idle"; ghostType = null; pendingAbility = null; heroSelected = false;
    buildDock(); syncDock(); renderTowerPanel();
    showOverlay(null);
    updateMusic();
    toast("Deploy turrets before the first wave", "info");
    setTimeout(() => { if (game && game.phase === "running" && game.wave === 0) { game.countdown = 6; } }, 0);
  }

  function handleEnd() {
    if (!game) return;
    const s = game.summary();
    save.recordResult(game.planet.id, game.planetIndex, s.stars, s.score, s.wave, s.kills, s.creditsEarned, s.won, game.nextPlanetId());
    els.resultTitle.textContent = s.won ? (s.endless ? "Run Complete" : "Victory") : "Base Overrun";
    els.resultSub.textContent = s.won
      ? game.planet.name + " secured. The Rebellion thanks you, commander."
      : "Your base has fallen on " + game.planet.name + ".";
    els.resultStars.innerHTML = [0, 1, 2].map((i) => '<span class="' + (i < s.stars ? "" : "star-off") + '">★</span>').join("");
    els.resultStats.innerHTML = [
      ["Score", s.score.toLocaleString()],
      ["Waves", s.wave + (s.endless ? "" : "/" + s.totalWaves)],
      ["Kills", s.kills],
      ["Credits", s.creditsEarned.toLocaleString()],
      ["Damage", s.damage.toLocaleString()],
      ["Accuracy", s.accuracy + "%"],
      ["Lives Left", s.lives + "/" + s.maxLives],
      ["Time", Math.floor(s.elapsed / 60) + "m " + (s.elapsed % 60) + "s"],
    ].map(([k, v]) => '<div class="stat-box"><b>' + v + "</b><span>" + k + "</span></div>").join("");

    const btns = [];
    const nextIdx = selectedPlanet + 1;
    if (s.won && !s.endless && PLANETS[nextIdx]) {
      btns.push('<button class="btn" data-act="next">▶ Next World: ' + PLANETS[nextIdx].name + "</button>");
    }
    btns.push('<button class="btn ' + (s.won ? "ghost" : "") + '" data-act="retry">↻ Retry</button>');
    btns.push('<button class="btn ghost" data-act="select">◉ Mission Select</button>');
    if (s.endless) btns.push('<button class="btn ghost" data-act="menu">⌂ Main Menu</button>');
    els.resultBtns.innerHTML = btns.join("");
    els.resultBtns.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        const act = b.dataset.act;
        if (act === "next") { selectedPlanet = nextIdx; launch(); }
        else if (act === "retry") launch();
        else if (act === "select") { game = null; openSelect(false); updateMusic(); }
        else { game = null; buildTotals(); showOverlay("menu"); updateMusic(); }
      };
    });
    showOverlay("result");
    updateMusic();
  }

  /* ── Loop ──────────────────────────────────────────── */
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;
  let tagTimer = 0;

  function frame(now) {
    const dt = Math.min(0.06, (now - last) / 1000);
    last = now;

    if (game) {
      if (game.phase === "running") {
        acc += dt * game.speed;
        let guard = 0;
        while (acc >= STEP && guard++ < 12) { game.update(STEP); acc -= STEP; }
        if (acc > STEP * 12) acc = 0;
        const events = game.drainEvents();
        for (const ev of events) {
          if (ev.type === "toast") toast(ev.payload.msg, ev.payload.kind);
        }
      } else { acc = 0; }
      if (game.phase !== lastPhase) {
        if (game.phase === "victory" || game.phase === "gameover") handleEnd();
        lastPhase = game.phase;
      }
    }

    updateHud();
    drawFrame();
    requestAnimationFrame(frame);
  }

  function drawFrame() {
    if (!game) { ctx.clearRect(0, 0, CANVAS_W, CANVAS_H); return; }
    const view = {
      hover, quality: settings.quality,
      ghostType: mode === "build" ? ghostType : null,
      ghostValid: mode === "build" && ghostType && hover.c >= 0 && (ghostType === "__hero" ? game.isBuildable(hover.c, hover.r) && game.canAfford(HERO.cost) && !(game.hero && game.hero.alive) : game.canPlace(ghostType, hover.c, hover.r)),
      heroMove: mode === "idle" && !!game.hero && game.hero.alive && heroSelected,
    };
    draw(ctx, game, view);
    if (mode === "ability" && pendingAbility && hover.c >= 0) {
      const a = ABILITIES[pendingAbility];
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#c084fc";
      ctx.beginPath(); ctx.arc((hover.c + 0.5) * GRID.cell, (hover.r + 0.5) * GRID.cell, a.radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "#c084fc"; ctx.lineWidth = 2; ctx.setLineDash([7, 7]);
      ctx.beginPath(); ctx.arc((hover.c + 0.5) * GRID.cell, (hover.r + 0.5) * GRID.cell, a.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function fitCanvas() {
    const pad = 20;
    const availW = els.stage.clientWidth - pad;
    const availH = els.stage.clientHeight - pad;
    const scale = Math.max(0.2, Math.min(availW / CANVAS_W, availH / CANVAS_H));
    const w = Math.floor(CANVAS_W * scale), h = Math.floor(CANVAS_H * scale);
    els.wrap.style.width = w + "px";
    els.wrap.style.height = h + "px";
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
  }

  window.addEventListener("resize", fitCanvas);
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(els.stage);

  /* ── Buttons ───────────────────────────────────────── */
  els.speedBtn.onclick = () => {
    if (!game) return;
    game.speed = game.speed >= 3 ? 1 : game.speed + 1;
    save.setSetting("defaultSpeed", game.speed);
    toast("Speed " + game.speed + "×", "info");
    audio.play("click");
  };
  $("btnPause").onclick = () => { audio.initAudio(); openPause(); audio.play("click"); };
  $("btnSound").onclick = () => { settings.muted = !settings.muted; save.setSetting("muted", settings.muted); applySettings(); updateMusic(); audio.play("click"); };
  $("btnTutorial").onclick = openTutorial;
  $("btnSettings").onclick = openSettings;
  $("btnMenu").onclick = () => { if (game && (game.phase === "running" || game.phase === "paused")) openPause(); else { buildTotals(); showOverlay("menu"); updateMusic(); } };

  els.nextWaveBtn.onclick = () => { if (game && !game.waveActive) game.readyNextWave(); };

  $("btnPlay").onclick = () => { audio.initAudio(); openSelect(false); };
  $("btnEndless").onclick = () => { audio.initAudio(); openSelect(true); };
  $("btnTutorial2").onclick = () => { transientReturn = "menu"; showOverlay("tutorial"); };
  $("btnSettings2").onclick = () => { transientReturn = "menu"; showOverlay("settings"); };
  $("btnLaunch").onclick = () => { audio.play("click"); openBrief(); };
  $("btnBriefBack").onclick = () => showOverlay("select");
  $("btnBegin").onclick = () => { audio.initAudio(); launch(); };
  $("btnBackMenu").onclick = () => { buildTotals(); showOverlay("menu"); updateMusic(); };
  $("btnResume").onclick = () => { closeTransient(); if (currentOverlay === "pause") { showOverlay(null); resumeGame(); } };
  $("btnPauseSettings").onclick = openSettings;
  $("btnPauseTutorial").onclick = openTutorial;
  $("btnQuit").onclick = () => { game = null; buildTotals(); showOverlay("menu"); updateMusic(); };
  $("btnCloseSettings").onclick = closeTransient;
  $("btnCloseTutorial").onclick = closeTransient;
  $("btnResetProgress").onclick = () => { save.resetProgress(); settings = save.getSettings(); applySettings(); buildTotals(); buildPlanetGrid(); toast("Progress reset", "warn"); };

  document.querySelectorAll("#themeSeg button").forEach((b) => {
    b.onclick = () => { settings.theme = b.dataset.theme; save.setSetting("theme", settings.theme); applySettings(); };
  });
  document.querySelectorAll("#qualitySeg button").forEach((b) => {
    b.onclick = () => { settings.quality = b.dataset.q; save.setSetting("quality", settings.quality); applySettings(); };
  });
  document.querySelectorAll("#speedSeg button").forEach((b) => {
    b.onclick = () => { settings.defaultSpeed = +b.dataset.s; save.setSetting("defaultSpeed", settings.defaultSpeed); if (game) game.speed = settings.defaultSpeed; applySettings(); };
  });
  ["volMaster:master", "volMusic:music", "volSfx:sfx"].forEach((pair) => {
    const [id, key] = pair.split(":");
    $(id).oninput = (e) => { settings[key] = +e.target.value; save.setSetting(key, settings[key]); applySettings(); };
  });
  $("motionToggle").onchange = (e) => { settings.motion = e.target.checked; save.setSetting("motion", settings.motion); applySettings(); };
  document.querySelectorAll("#accentSwatches button").forEach((b) => {
    b.onclick = () => { settings.accent = b.dataset.accent; save.setSetting("accent", settings.accent); applySettings(); audio.play("click"); };
  });

  /* ── Keyboard ──────────────────────────────────────── */
  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if (k === "escape") {
      if (currentOverlay === "settings" || currentOverlay === "tutorial") closeTransient();
      else if (currentOverlay === "brief") showOverlay("select");
      else cancelModes();
      return;
    }
    if (currentOverlay) return;
    if (!game) return;
    if (k === " ") { e.preventDefault(); if (game.phase === "running") openPause(); else if (game.phase === "paused") { showOverlay(null); resumeGame(); } }
    else if (k >= "1" && k <= "4") selectTowerType(TOWERS[+k - 1].id);
    else if (k === "h") selectHeroType();
    else if (k === "q") armAbility("lightning");
    else if (k === "w") armAbility("push");
    else if (k === "e") armAbility("orbital");
    else if (k === "r") { if (game.hero && game.hero.alive) game.useHeroAbility(); }
    else if (k === "n") { if (!game.waveActive && game.phase === "running") game.readyNextWave(); }
  });

  window.addEventListener("pointerdown", () => { audio.initAudio(); }, { once: true });

  /* ── Boot ──────────────────────────────────────────── */
  function init() {
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    ctx.imageSmoothingEnabled = true;
    settings = save.getSettings();
    els.accentSwatches.innerHTML = ACCENTS.map((a) =>
      '<button data-accent="' + a.color + '" style="--sw:' + a.color + '" title="' + a.name + '"></button>').join("");
    document.querySelectorAll("#accentSwatches button").forEach((b) => {
      b.onclick = () => { settings.accent = b.dataset.accent; save.setSetting("accent", settings.accent); applySettings(); audio.play("click"); };
    });
    applySettings();
    buildTotals();
    buildDock();
    fitCanvas();
    showOverlay("menu");
    last = performance.now();
    requestAnimationFrame(frame);
  }

  return { init, draw: drawFrame, step: (dt) => { if (game && game.phase === "running") game.update(dt); }, get game() { return game; } };
}
