/* ════════════════════════════════════════════════════════════════
   DOMINION COMPLETE — src/ui.js  (Phase 3: Tabletop UI)
   Pure-engine code never touches this file. The UI reads the live
   game state object produced by engine.setup() and re-renders the
   whole table on every update() call.
   API:
     ui.mount(rootEl, state, { humanId, onRestart })
     ui.update(state)
     ui.renderCard(cardId, opts)
     ui.promptModal(prompt)      — render a modal for an engine prompt
     ui.humanDecide(state, prompt) — decide resolver wired to modals
     ui.openPlan(state, pid, cardId) — pre-play decision modal
     ui.demo(rootEl)             — ?test=cards harness
     ui.capture(targetEl)        — rasterize to a canvas
   ════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const Dominion = (global.Dominion = global.Dominion || {});
  const ui = {};
  Dominion.ui = ui;

  let current = null; // { state, humanId, rootEl, onRestart }
  const answerBuffer = []; // FIFO of { type, value } human answers

  /* ── small DOM helpers ── */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function def(id) { return (Dominion.cards && typeof Dominion.cards.get === "function") ? Dominion.cards.get(id) : null; }
  function playerOf(state, pid) { return state.players.find((p) => p.id === String(pid)); }
  function nameOf(state, pid) {
    const p = playerOf(state, pid);
    return p ? p.name : String(pid);
  }

  const EXP_LABEL = {
    base: "Base", "base-kingdom": "Base", intrigue: "Intrigue", alchemy: "Alchemy",
    cornucopia: "Cornucopia", prosperity: "Prosperity", darkages: "Dark Ages",
    guilds: "Guilds", adventures: "Adventures", empires: "Empires", nocturne: "Nocturne",
    renaissance: "Renaissance", menagerie: "Menagerie", allies: "Allies",
    plunder: "Plunder", seaside: "Seaside"
  };

  /* ════════════════ SETTINGS (Task 61) ════════════════
     Persisted in localStorage under "dominion.settings":
       theme            "dark" | "light"
       animations       bool — no-anim body class disables CSS motion
       sound            bool — WebAudio blips for key actions
       defaultExpansions string[] — pre-checked in the setup panel
     loadSettings() is DOM-free (tests run it headless);
     applySettings() syncs the body classes. */
  const SETTINGS_KEY = "dominion.settings";
  const DEFAULT_SETTINGS = { theme: "dark", animations: true, sound: false, defaultExpansions: ["base", "intrigue"] };
  ui.loadSettings = function () {
    const out = Object.assign({}, DEFAULT_SETTINGS, { defaultExpansions: DEFAULT_SETTINGS.defaultExpansions.slice() });
    if (typeof localStorage === "undefined") return out;
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return out;
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        for (const k of Object.keys(DEFAULT_SETTINGS)) if (s[k] !== undefined) out[k] = s[k];
        if (!Array.isArray(out.defaultExpansions)) out.defaultExpansions = DEFAULT_SETTINGS.defaultExpansions.slice();
      }
    } catch (e) { /* corrupt settings → defaults */ }
    return out;
  };
  ui.saveSettings = function (patch) {
    const next = Object.assign(ui.loadSettings(), patch || {});
    if (typeof localStorage !== "undefined") {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) {}
    }
    return next;
  };
  ui.applySettings = function () {
    const s = ui.loadSettings();
    if (typeof document === "undefined" || !document.body) return s;
    document.body.classList.toggle("theme-light", s.theme === "light");
    document.body.classList.toggle("no-anim", s.animations !== true);
    return s;
  };
  ui.openSettings = function () {
    let ctn = document.getElementById("settingsCtn");
    if (!ctn) { ctn = el("div", "modal-ctn"); ctn.id = "settingsCtn"; document.body.appendChild(ctn); }
    clear(ctn);
    ctn.classList.add("open");
    const box = el("div", "modal-box");
    box.appendChild(el("div", "modal-title", "Settings"));
    const s = ui.loadSettings();
    const mkRow = (label, ctl) => { const r = el("div", "setup-row"); r.appendChild(el("span", "setup-label", label)); r.appendChild(ctl); return r; };
    const themeSel = el("select");
    for (const [v, l] of [["dark", "Dark"], ["light", "Light"]]) { const o = el("option", null, l); o.value = v; themeSel.appendChild(o); }
    themeSel.value = s.theme;
    box.appendChild(mkRow("Theme", themeSel));
    const animCb = el("input"); animCb.type = "checkbox"; animCb.checked = s.animations;
    box.appendChild(mkRow("Animations", animCb));
    const soundCb = el("input"); soundCb.type = "checkbox"; soundCb.checked = s.sound;
    box.appendChild(mkRow("Sound effects", soundCb));
    const expRow = el("div", "setup-row");
    expRow.appendChild(el("span", "setup-label", "Default expansions "));
    const expBox = el("div");
    for (const opt of EXP_OPTIONS) {
      const lab = el("label", "setup-chk");
      const cb = el("input"); cb.type = "checkbox"; cb.value = opt.key; cb.checked = s.defaultExpansions.indexOf(opt.key) !== -1;
      lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + opt.label));
      expBox.appendChild(lab);
    }
    expRow.appendChild(expBox);
    box.appendChild(expRow);
    const apply = () => {
      const exps = [...expBox.querySelectorAll("input[type=checkbox]")].filter((cb) => cb.checked).map((cb) => cb.value);
      ui.saveSettings({ theme: themeSel.value, animations: animCb.checked, sound: soundCb.checked, defaultExpansions: exps });
      ui.applySettings();
      document.dispatchEvent(new Event("dominion:settings"));
    };
    for (const ctl of [themeSel, animCb, soundCb, ...expBox.querySelectorAll("input")]) ctl.addEventListener("change", apply);
    const row = el("div", "modal-btns");
    const close = el("button", "btn", "Close");
    close.addEventListener("click", () => { apply(); ctn.classList.remove("open"); });
    row.appendChild(close);
    box.appendChild(row);
    ctn.appendChild(box);
    return ctn;
  };

  /* Tiny WebAudio SFX. No-op when sound is off, AudioContext is
     unavailable, or running headless. */
  let audioCtx = null;
  function sfx(name) {
    if (!ui.loadSettings().sound) return;
    if (typeof window === "undefined" || !window.AudioContext) return;
    try {
      audioCtx = audioCtx || new window.AudioContext();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const t = audioCtx.currentTime;
      o.connect(g); g.connect(audioCtx.destination);
      const f = name === "buy" ? 660 : name === "win" ? 880 : 440;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (name === "win" ? 1.6 : 1.4), t + 0.08);
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    } catch (e) { /* audio is best-effort */ }
  }
  ui.sfx = sfx;

  /* ════════════════ KV ACCESS (Tasks 60/62) ════════════════
     All persistence goes through the "dominion" kv folder. kvFolder()
     returns null headless/without the plugin; tests inject a fake
     store by patching ui.kvFolder. */
  function kvFolder() { return (typeof root !== "undefined" && root.kv) ? root.kv.dominion : null; }
  ui.kvFolder = kvFolder;

  /* ════════════════ SAVED KINGDOMS (Task 62) ════════════════
     Favorite kingdoms live under the "kingdoms" key as an array of
     { name, kingdom, seed, savedAt }. */
  ui.favoriteKingdoms = async function () {
    const f = ui.kvFolder(); if (!f) return [];
    try { const raw = await f.get("kingdoms"); return (raw && Array.isArray(raw)) ? raw : []; }
    catch (e) { return []; }
  };
  ui.saveFavorite = async function (kingdom, seed) {
    const f = ui.kvFolder(); if (!f) return null;
    const list = await ui.favoriteKingdoms();
    const name = "Kingdom " + (list.length + 1);
    list.push({ name: name, kingdom: (kingdom || []).slice(), seed: seed == null ? null : seed, savedAt: Date.now() });
    await f.set("kingdoms", list);
    return name;
  };
  ui.loadFavorite = async function (name) {
    const list = await ui.favoriteKingdoms();
    return list.find((k) => k.name === name) || null;
  };
  ui.deleteFavorite = async function (name) {
    const f = ui.kvFolder(); if (!f) return;
    await f.set("kingdoms", (await ui.favoriteKingdoms()).filter((k) => k.name !== name));
  };

  /* ════════════════ PLAYER STATS (Task 62) ════════════════
     Every finished solo game appends a result line under "stats":
     { at, turn, difficulty, humanWon, humanScore, players[] }.
     ui.playerStats() aggregates win/loss and score history per
     difficulty. */
  ui.recordResult = async function (state) {
    const f = ui.kvFolder(); if (!f || !state || state.over !== true) return;
    try {
      const scores = Dominion.engine.scoreAll(state);
      const human = state.players.find((p) => !state.aiDifficulty || state.aiDifficulty[p.id] === undefined);
      if (!human) return;
      const max = scores.reduce((m, s) => (s.total > m ? s.total : m), -Infinity);
      const winners = scores.filter((s) => s.total === max).map((s) => s.player);
      const humanScore = (scores.find((s) => s.player === human.id) || {}).total || 0;
      const aiIds = Object.keys(state.aiDifficulty || {});
      const difficulty = aiIds.length ? state.aiDifficulty[aiIds[0]] : "none";
      const stats = (await f.get("stats")) || [];
      if (!Array.isArray(stats)) return;
      stats.push({ at: Date.now(), turn: state.turn || 0, difficulty: difficulty, humanWon: winners.indexOf(human.id) !== -1, humanScore: humanScore, players: scores.map((s) => ({ id: s.player, score: s.total })) });
      await f.set("stats", stats.slice(-200));
    } catch (e) { /* stats are best-effort */ }
  };
  ui.playerStats = async function () {
    const f = ui.kvFolder(); if (!f) return { games: 0, perDifficulty: {} };
    const stats = (await f.get("stats")) || [];
    if (!Array.isArray(stats)) return { games: 0, perDifficulty: {} };
    const per = {};
    for (const r of stats) {
      const d = r.difficulty || "none";
      per[d] = per[d] || { games: 0, wins: 0, losses: 0, avgScore: 0, best: 0 };
      const p = per[d];
      p.games++; if (r.humanWon) p.wins++; else p.losses++;
      p.avgScore += (r.humanScore || 0);
      if ((r.humanScore || 0) > p.best) p.best = r.humanScore;
    }
    for (const d of Object.keys(per)) per[d].avgScore = Math.round(per[d].avgScore / per[d].games);
    return { games: stats.length, perDifficulty: per };
  };

  /* ════════════════ EXPORT / IMPORT (Task 63) ════════════════
     Game state round-trips as JSON via the engine's canonical
     serialize/deserialize. exportJSON/gameFromJSON are DOM-free
     (headless-testable); exportGame downloads a file and importGame
     mounts the restored table. */
  ui.exportJSON = function (state) { return JSON.stringify(Dominion.engine.serialize(state), null, 2); };
  ui.gameFromJSON = function (str) {
    if (!str || typeof str !== "string") throw new Error("export requires a JSON string");
    let data = null;
    try { data = JSON.parse(str); } catch (e) { throw new Error("not valid JSON: " + e.message); }
    if (!data || data.version == null) throw new Error("not a Dominion game save (missing version)");
    return Dominion.engine.deserialize(data);
  };
  ui.exportGame = function () {
    if (!current) { flash("No game in progress to export."); return null; }
    const json = ui.exportJSON(current.state);
    if (typeof document === "undefined") return json;
    try {
      const blob = new Blob([json], { type: "application/json" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dominion-save-turn-" + (current.state.turn || 1) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      flash("Game exported.");
    } catch (e) { flash("Export failed: " + ((e && e.message) || e)); }
    return json;
  };
  ui.importGame = function (str) {
    const g = ui.gameFromJSON(str);
    const human = g.players.find((p) => !g.aiDifficulty || g.aiDifficulty[p.id] === undefined);
    const humanId = human ? human.id : (g.players[0] ? g.players[0].id : "p1");
    const solo = g.players.length - Object.keys(g.aiDifficulty || {}).length === 1;
    const gameCtn = document.getElementById("gameCtn");
    if (!gameCtn) throw new Error("game table container not found");
    Dominion.ui.mount(gameCtn, g, { humanId: humanId, onRestart: (typeof resetCtn === "function" ? resetCtn : null), autosave: solo });
    const setupCtn = document.getElementById("setupCtn");
    if (setupCtn) setupCtn.hidden = true;
    try { document.getElementById("game").scrollIntoView({ block: "start" }); } catch (e) {}
    if (solo) Dominion.ui.doSave(g);
    return g;
  };

  /* ════════════════ THE CARD COMPONENT (Task 39) ════════════════ */
  function costBadge(d) {
    const c = el("div", "dcard-cost");
    if (d.cost && d.cost.coins != null) {
      const b = el("span", "coin-badge", d.cost.coins);
      if (d.cost.coins === 0) b.classList.add("zero");
      c.appendChild(b);
    }
    if (d.cost && d.cost.potion) c.appendChild(el("span", "potion-badge", "P"));
    if (d.cost && d.cost.debt) c.appendChild(el("span", "debt-badge", "D"));
    return c;
  }

  ui.renderCard = function (cardId, opts) {
    opts = opts || {};
    const d = def(cardId);
    const card = el("div", "dcard" + (opts.cls ? " " + opts.cls : ""));
    card.dataset.card = String(cardId);
    if (!d) { card.classList.add("dcard-unknown"); card.textContent = "?"; return card; }
    for (const t of d.types) card.classList.add("type-" + t.toLowerCase());
    card.appendChild(costBadge(d));
    card.appendChild(el("div", "dcard-name", d.name));
    card.appendChild(el("div", "dcard-types", d.types.join(" · ")));
    card.appendChild(el("div", "dcard-text", d.text || ""));
    card.appendChild(el("div", "dcard-exp", EXP_LABEL[d.expansion] || d.expansion || ""));
    return card;
  };

  /* ── legality for disabled states (Task 41) ── */
  function handCardState(state, pid, id) {
    if (state.over || state.turnPlayer !== String(pid)) return "disabled";
    const p = playerOf(state, pid);
    const d = def(id);
    if (!d) return "disabled";
    if (d.types.indexOf("Action") !== -1) {
      return (state.phase === "action" && p.actions > 0) ? "playable" : "disabled";
    }
    if (d.types.indexOf("Treasure") !== -1) {
      if (state.phase === "action") return p.actions > 0 ? "playable" : "disabled";
      if (state.phase === "buy") return "playable";
    }
    return "disabled";
  }

  function supplyState(state, pid, id) {
    if (state.over || state.turnPlayer !== String(pid)) return "disabled";
    if (state.phase !== "buy") return "disabled";
    if (state.supply[id] <= 0) return "disabled";
    return Dominion.engine.canBuy(state, pid, id) ? "playable" : "disabled";
  }

  function renderHand(player, onCard, legality, animDraw) {
    const fan = el("div", "hand-fan");
    const from = animDraw ? player.hand.length - animDraw : player.hand.length;
    for (let i = 0; i < player.hand.length; i++) {
      const st = legality ? legality(player.hand[i], i) : "";
      const slot = el("div", "hand-slot" + (onCard ? " clickable" : "") + (st === "disabled" ? " disabled" : ""));
      const card = ui.renderCard(player.hand[i], { cls: "hand-card" });
      if (i >= from) card.classList.add("anim-draw");
      slot.appendChild(card);
      if (onCard && st !== "disabled") slot.addEventListener("click", () => onCard(player.hand[i], i));
      fan.appendChild(slot);
    }
    if (!player.hand.length) fan.appendChild(el("span", "zone-empty", "empty hand"));
    return fan;
  }

  const BASIC_ORDER = { copper: 0, silver: 1, gold: 2, estate: 3, duchy: 4, province: 5, curse: 6 };
  function supplySort(state, a, b) {
    const ka = BASIC_ORDER[a] != null ? BASIC_ORDER[a] : 100;
    const kb = BASIC_ORDER[b] != null ? BASIC_ORDER[b] : 100;
    return ka - kb || (a < b ? -1 : a > b ? 1 : 0);
  }
  function renderSupply(state, onPile, legality, animBuys, animEmpty) {
    const grid = el("div", "supply-grid");
    const ids = Object.keys(state.supply).sort((a, b) => supplySort(state, a, b));
    for (const id of ids) {
      const st = legality ? legality(id) : "";
      const pile = el("div", "supply-pile" + (onPile ? " clickable" : "") + (st === "disabled" ? " disabled" : ""));
      if (animBuys && animBuys[id]) pile.classList.add("anim-buy");
      pile.appendChild(ui.renderCard(id, { cls: "supply-card" }));
      const cnt = el("div", "pile-count", state.supply[id]);
      if (state.supply[id] <= 0) {
        cnt.classList.add("empty");
        if (animEmpty && animEmpty[id]) pile.classList.add("anim-empty");
      }
      pile.appendChild(cnt);
      if (onPile && st !== "disabled") pile.addEventListener("click", () => onPile(id));
      grid.appendChild(pile);
    }
    return grid;
  }

  function renderTrash(state, animTrashed) {
    const box = el("div", "trash-box");
    box.appendChild(el("div", "zone-title", "Trash"));
    const row = el("div", "mini-row");
    const from = animTrashed ? state.trash.length - animTrashed : state.trash.length;
    for (let i = 0; i < state.trash.length; i++) {
      const c = ui.renderCard(state.trash[i], { cls: "mini" });
      if (i >= from) c.classList.add("anim-trash");
      row.appendChild(c);
    }
    box.appendChild(row);
    return box;
  }

  function renderPiles(state, pid) {
    const p = playerOf(state, pid);
    const row = el("div", "piles-row");
    const deck = el("div", "pile-card", "Deck");
    deck.appendChild(el("b", null, String(p.deck.length)));
    const disc = el("div", "pile-card", "Discard");
    disc.appendChild(el("b", null, String(p.discard.length)));
    row.appendChild(deck);
    row.appendChild(disc);
    return row;
  }

  function renderZoneStrip(title, cards, cls) {
    const box = el("div", "zone-strip" + (cls ? " " + cls : ""));
    box.appendChild(el("div", "zone-title", title));
    const row = el("div", "mini-row");
    for (const c of cards) row.appendChild(ui.renderCard(c, { cls: "mini" }));
    if (!cards.length) row.appendChild(el("span", "zone-empty", "empty"));
    box.appendChild(row);
    return box;
  }

  /* ── expansion zone surfaces (Task 44): Duration / Reserve / Exile / tokens ── */
  function renderZones(state, pid) {
    const p = playerOf(state, pid);
    const wrap = el("div", "zones-row");
    const hasAny = p.duration.length || p.reserve.length || p.exile.length ||
      p.debt || p.coffers || p.villagers;
    if (!hasAny && !state.over) return null;
    if (p.duration.length) wrap.appendChild(renderZoneStrip("Duration", p.duration, "dur"));
    if (p.reserve.length) wrap.appendChild(renderZoneStrip("Tavern mat (Reserve)", p.reserve, "resv"));
    if (p.exile.length) wrap.appendChild(renderZoneStrip("Exile mat", p.exile, "exile"));
    const tokens = el("div", "token-tray");
    tokens.appendChild(el("div", "zone-title", "Token trays"));
    const row = el("div", "token-row");
    const tok = (label, val) => { const t = el("span", "token", label + " " + val); if (!val) t.classList.add("zero"); return t; };
    row.appendChild(tok("Debt", p.debt));
    row.appendChild(tok("Villagers", p.villagers));
    row.appendChild(tok("Coffers", p.coffers));
    row.appendChild(tok("VP", p.vpTokens));
    tokens.appendChild(row);
    wrap.appendChild(tokens);
    return wrap;
  }

  function renderPlayArea(state, pid, animPlayed) {
    const p = playerOf(state, pid);
    const box = el("div", "play-area");
    box.appendChild(el("div", "zone-title", "In play"));
    const row = el("div", "mini-row");
    const from = animPlayed ? p.play.length - animPlayed : p.play.length;
    for (let i = 0; i < p.play.length; i++) {
      const c = ui.renderCard(p.play[i], { cls: "mini" });
      if (i >= from) c.classList.add("anim-play");
      row.appendChild(c);
    }
    box.appendChild(row);
    return box;
  }

  /* ── status & opponent panels (Task 43) ── */
  function vpTotal(state, pid) {
    try { return Dominion.engine.score(state, pid).total; } catch (e) { return 0; }
  }
  function curseCount(p) {
    return p.hand.concat(p.deck, p.discard, p.play, p.duration, p.reserve, p.exile).filter((c) => c === "curse").length;
  }

  function renderStatus(state, pid) {
    const p = playerOf(state, pid);
    const res = el("div", "turn-res");
    const chip = (label, val) => el("span", "res-item", label + " " + val);
    res.appendChild(chip("Actions", p.actions));
    res.appendChild(chip("Buys", p.buys));
    res.appendChild(chip("Coins", p.coins));
    res.appendChild(chip("Potions", p.potions));
    res.appendChild(chip("VP", vpTotal(state, pid)));
    res.appendChild(chip("Curses", curseCount(p)));
    return res;
  }

  function renderOpponent(state, opp, activeId, humanId) {
    const row = el("div", "opp" + (opp.id === activeId ? " active" : ""));
    row.appendChild(el("span", "opp-name", opp.id === humanId ? opp.name + " (you)" : opp.name));
    row.appendChild(el("span", "opp-stat", "deck " + opp.deck.length));
    row.appendChild(el("span", "opp-stat", "discard " + opp.discard.length));
    row.appendChild(el("span", "opp-stat", "hand " + opp.hand.length));
    row.appendChild(el("span", "opp-stat", "VP " + vpTotal(state, opp.id)));
    row.appendChild(el("span", "opp-stat", "curse " + curseCount(opp)));
    return row;
  }

  /* ── live game log (Task 43) ── */
  function zoneName(z) {
    if (typeof z !== "string") return String(z);
    const short = { deck: "deck", hand: "hand", discard: "discard", play: "play", duration: "duration", reserve: "reserve", exile: "exile", setAside: "set-aside", trash: "trash" };
    const key = z.indexOf(".") !== -1 ? z.split(".").pop() : z;
    return short[key] || key;
  }
  function logText(state, e) {
    const n = (id) => { const d = def(id); return d ? d.name : id; };
    const who = nameOf(state, e.player);
    switch (e.t) {
      case "turnStart": return "Turn " + state.turn + " — " + who + "'s turn";
      case "draw": return who + " drew " + e.count;
      case "playAction": return who + " played " + n(e.card);
      case "playTreasure": return who + " played treasures, +" + e.coins + " coins";
      case "move": return (e.player ? who + ": " : "") + n(e.card) + " → " + zoneName(e.to);
      case "res": return who + " " + (e.delta >= 0 ? "+" : "") + e.delta + " " + e.res;
      case "reveal": return who + " revealed " + n(e.card);
      case "reshuffle": return who + " reshuffled (" + e.count + " cards)";
      case "buy": return who + " bought " + n(e.card) + " ($" + e.coins + (e.potion ? "+P" : "") + ")";
      case "decide": return who + " decided: " + (e.kind || "?");
      case "throneRoom": return who + " played " + n(e.card) + " twice";
      case "gameOver": return "Game over — winner(s): " + e.winners.map((w) => nameOf(state, w)).join(", ");
      case "setup": return "Set up: " + e.players + " players, " + e.kingdom + " kingdom piles";
      default: return e.t;
    }
  }
  function renderLog(state) {
    const box = el("div", "log-box");
    box.appendChild(el("div", "zone-title", "Game log"));
    const inner = el("div", "log-inner");
    for (const e of state.log) inner.appendChild(el("div", "log-line", logText(state, e)));
    inner.scrollTop = inner.scrollHeight;
    box.appendChild(inner);
    return box;
  }

  function flash(msg) {
    const f = document.getElementById("flashEl");
    if (!f) return;
    f.textContent = msg;
    setTimeout(() => { if (f.textContent === msg) f.textContent = ""; }, 2200);
  }

  /* ════════════════ THE MODAL / CHOICE SYSTEM (Task 42) ════════════ */
  const PLAN = {
    cellar: ["discardAny"],
    chapel: ["trashUpTo"],
    moneylender: ["trashCopper"],
    throne_room: ["playActionTwice"],
    remodel: ["trashAny"],
    mine: ["trashTreasure"],
    artisan: ["gainToHand"],
    harbinger: ["topdeckTop"],
    sentry: ["sentryLook"]
  };

  const PROMPT_TITLES = {
    react: "React to the attack?", discardDown: "Discard down to N cards",
    discardAny: "Discard any cards", discardPerEmpty: "Discard a card per empty pile",
    gainToHand: "Gain a card to your hand", gainTreasure: "Gain a Treasure",
    gainCard: "Gain a card", trashRevealed: "Trash a revealed card",
    trashUpTo: "Trash up to N cards", trashAny: "Trash a card",
    trashTreasure: "Trash a Treasure", trashCopper: "Trash a Copper?",
    topdeckVictory: "Top-deck a Victory card", topdeckTop: "Put this card on top of your deck?",
    setAsideAction: "Set this Action aside?", playActionTwice: "Play an Action twice",
    sentryLook: "Sentry — dispose of the looked cards", pickOpponent: "Choose an opponent",
    baronDiscard: "Baron", revealCard: "Reveal a card", courtierChoice: "Courtier — choose a bonus",
    courtyardTopdeck: "Put a card on top of your deck", diplomatDiscard: "Diplomat — discard",
    farmlandTrash: "Farmland",
    lurkerMode: "Lurker — choose an effect", lurkerTrashSupply: "Trash an Action from the Supply",
    lurkerGainTrash: "Gain an Action from the trash", masqueradePass: "Masquerade — pass a card",
    masqueradeTrash: "Masquerade — trash a card?", millDiscard: "Mill — discard 2 for +$2?",
    discardExactly: "Discard exactly 2 cards",
    miningVillageTrash: "Mining Village — trash it for +$2?",
    minionMode: "Minion — choose an effect", noblesChoice: "Nobles — choose a bonus",
    pawnChoices: "Pawn — choose two bonuses", patrolOrder: "Patrol — order the remaining cards",
    secretPassageCard: "Secret Passage — pick a card", secretPassageDepth: "Secret Passage — place it in your deck",
    stewardMode: "Steward — choose an effect", trashTwo: "Trash 2 cards",
    swindlerGain: "Swindler — choose the card they gain",
    torturerChoice: "Torturer — discard 2 cards or gain a Curse?",
    wishName: "Wishing Well — name a card", nativeVillageMode: "Native Village — choose one",
    havenSetAside: "Haven — set aside a card", islandSetAside: "Island — put a card on your mat",
    sailorPlay: "Sailor — play this Duration card?", piratePlay: "Pirate — play this from your hand?",
    alchemistTopdeck: "Alchemist — top-deck it?", treasuryTopdeck: "Treasury — put it on your deck?",
    herbalistReturn: "Herbalist — put a Treasure on your deck",
    scryingTop: "Scrying Pool — discard the revealed card?",
    golemOrder: "Golem — choose the play order", apothecaryOrder: "Apothecary — order the kept cards",
    lookoutDispose: "Lookout — trash, discard, and keep from the top 3",
    anvilDiscard: "Anvil — discard a Treasure to gain a card up to $4",
    crystalBallUse: "Crystal Ball — trash, play, or discard the revealed card?",
    investmentMode: "Investment — $4 or put this on your deck?",
    warChestName: "War Chest — name a card you won't gain",
    vaultDiscard: "Vault — discard Treasures for +$1 each",
    vaultOpp: "Vault — discard 2 Treasures to draw a card?",
    tiaraTopdeck: "Tiara — put the gained Treasure on your deck?",
    clerkPlay: "Clerk — play it again at the start of your next turn?",
    watchtowerUse: "Watchtower — trash or top-deck the gained card?",
    tiaraDouble: "Tiara — play a Treasure twice",
    mintCopy: "Mint — copy a Treasure from your hand",
    playActionThrice: "King's Court — play an Action three times"
  };

  function promptTitle(prompt) {
    return PROMPT_TITLES[prompt.type] || "Your decision";
  }

  function defaultAnswer(state, prompt) {
    try { return Dominion.engine.defaultDecide(state, prompt); } catch (e) { return null; }
  }

  function bufferPush(type, value) { answerBuffer.push({ type: type, value: value }); }
  function bufferTake(type) {
    const i = answerBuffer.findIndex((a) => a.type === type);
    if (i === -1) return undefined;
    const a = answerBuffer.splice(i, 1)[0];
    return a.value;
  }

  /* Build the interactive controls for a prompt. Appends into `ctn`. */
  function buildPromptControls(ctn, state, prompt, onDone) {
    const answer = { value: null };
    const finish = () => { if (answer.value !== null) onDone(answer.value); };
    const note = el("div", "modal-note", promptTitle(prompt));
    ctn.appendChild(note);

    const isPickIndex = ["trashAny", "trashTreasure", "trashCopper", "revealCard", "courtyardTopdeck", "masqueradePass", "secretPassageCard", "havenSetAside", "islandSetAside"].indexOf(prompt.type) !== -1;
    const isPick = ["gainToHand", "gainTreasure", "gainCard", "trashRevealed", "topdeckVictory", "playActionTwice", "pickOpponent", "lurkerTrashSupply", "lurkerGainTrash", "swindlerGain", "herbalistReturn", "wishName"].indexOf(prompt.type) !== -1;
    const isMulti = ["discardAny", "discardDown", "discardPerEmpty", "trashUpTo", "diplomatDiscard", "discardExactly", "trashTwo"].indexOf(prompt.type) !== -1;
    const isConfirm = ["topdeckTop", "setAsideAction", "sailorPlay", "piratePlay", "alchemistTopdeck", "treasuryTopdeck"].indexOf(prompt.type) !== -1;
    const isBaron = prompt.type === "baronDiscard" || prompt.type === "farmlandTrash" || prompt.type === "masqueradeTrash" || prompt.type === "millDiscard" || prompt.type === "miningVillageTrash";

    if (isPickIndex || isMulti) {
      const hand = prompt.hand || [];
      const max = (prompt.count != null ? prompt.count : (prompt.max != null ? prompt.max : (isPickIndex ? 1 : hand.length)));
      const chosen = [];
      const grid = el("div", "modal-options");
      const counter = el("div", "modal-counter", "0 / " + max);
      ctn.appendChild(counter);
      for (let i = 0; i < hand.length; i++) {
        const opt = el("button", "modal-opt" + (isPickIndex ? " opt-single" : ""));
        opt.appendChild(ui.renderCard(hand[i], { cls: "mini" }));
        opt.addEventListener("click", () => {
          const at = chosen.indexOf(i);
          if (at !== -1) { chosen.splice(at, 1); opt.classList.remove("sel"); }
          else if (isPickIndex) {
            if (chosen.length) { const old = chosen[0]; chosen.length = 0; grid.children[old].classList.remove("sel"); }
            chosen.push(i); opt.classList.add("sel");
          } else {
            if (chosen.length >= max) return;
            chosen.push(i); opt.classList.add("sel");
          }
          counter.textContent = chosen.length + " / " + max;
        });
        grid.appendChild(opt);
      }
      ctn.appendChild(grid);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { if (chosen.length) { answer.value = chosen.slice(); finish(); } });
      ctn.appendChild(go);
    } else if (isPick) {
      const options = prompt.options && prompt.options.length ? prompt.options : (prompt.hand || []);
      const grid = el("div", "modal-options");
      let sel = null;
      const cards = [];
      for (const id of options) {
        const opt = el("button", "modal-opt opt-single");
        opt.appendChild(ui.renderCard(id, { cls: "mini" }));
        opt.addEventListener("click", () => {
          if (sel) cards[sel].classList.remove("sel");
          sel = options.indexOf(id);
          opt.classList.add("sel");
        });
        cards.push(opt);
        grid.appendChild(opt);
      }
      ctn.appendChild(grid);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { if (sel !== null) { answer.value = options[sel]; finish(); } });
      ctn.appendChild(go);
    } else if (isConfirm || isBaron) {
      const q = el("div", "modal-confirm-line");
      if (isBaron) {
        const qTxt = prompt.type === "farmlandTrash"
          ? "Farmland — trash a card from hand for one costing up to $2 more?"
          : prompt.type === "masqueradeTrash"
            ? "Masquerade — trash a card from your hand?"
            : prompt.type === "millDiscard"
              ? "Mill — discard 2 cards for +$2?"
              : prompt.type === "miningVillageTrash"
                ? "Mining Village — trash this card for +$2?"
                : (prompt.canDiscard ? "Baron — discard an Estate for +$4?" : "Baron — you have no Estate in hand — gain one?");
        q.appendChild(el("span", null, qTxt));
      } else if (prompt.card) {
        q.appendChild(el("span", null, nameOf(state, "p1") + " " + (def(prompt.card) ? def(prompt.card).name : prompt.card) + " — proceed?"));
      } else {
        q.appendChild(el("span", null, "Proceed?"));
      }
      if (prompt.card) {
        const c = q.appendChild(ui.renderCard(prompt.card, { cls: "mini" }));
        c.classList.add("confirm-card");
      }
      ctn.appendChild(q);
      const row = el("div", "modal-btns");
      const yes = el("button", "btn btn-primary", prompt.yesLabel || "Yes");
      if (isBaron && prompt.type === "baronDiscard" && prompt.canDiscard !== true) yes.disabled = true;
      yes.addEventListener("click", () => { answer.value = true; finish(); });
      const no = el("button", "btn", prompt.noLabel || "No");
      no.addEventListener("click", () => { answer.value = false; finish(); });
      row.appendChild(yes);
      row.appendChild(no);
      ctn.appendChild(row);
    } else if (prompt.type === "courtierChoice" || prompt.type === "lurkerMode" || prompt.type === "minionMode" || prompt.type === "noblesChoice" || prompt.type === "stewardMode") {
      const labels = prompt.type === "courtierChoice"
        ? { action: "+1 Action", buy: "+1 Buy", coins: "+$3", gold: "Gain a Gold" }
        : prompt.type === "noblesChoice"
          ? { cards: "+3 Cards", actions: "+2 Actions" }
          : prompt.type === "stewardMode"
            ? { cards: "+2 Cards", coins: "+$2", trash: "Trash 2 cards" }
            : prompt.type === "minionMode"
              ? { coins: "+$2", draw: "Discard hand, draw 4, attack" }
              : { action: "+1 Action", buy: "+1 Buy", coins: "+$2", trashSupply: "Trash an Action from the Supply", gainTrash: "Gain an Action from the trash" };
      const note = prompt.type === "lurkerMode"
        ? "Choose one:"
        : prompt.type === "courtierChoice"
          ? "For the \u201c" + (prompt.cardType || "?") + "\u201d type, choose a bonus (each bonus only once):"
          : "Choose one:";
      ctn.appendChild(el("div", "modal-note", note));
      const grid = el("div", "modal-options courtier-opts");
      for (const o of prompt.options) {
        const b = el("button", "modal-opt opt-single");
        b.textContent = labels[o] || o;
        b.addEventListener("click", () => { answer.value = o; finish(); });
        grid.appendChild(b);
      }
      ctn.appendChild(grid);
    } else if (prompt.type === "pawnChoices") {
      const labels = { card: "+1 Card", action: "+1 Action", buy: "+1 Buy", coin: "+$1" };
      const opts = prompt.options && prompt.options.length ? prompt.options : ["card", "action", "buy", "coin"];
      const max = prompt.count != null ? prompt.count : 2;
      const chosen = [];
      const counter = el("div", "modal-counter", "0 / " + max);
      ctn.appendChild(counter);
      const grid = el("div", "modal-options courtier-opts");
      for (const o of opts) {
        const b = el("button", "modal-opt opt-single");
        b.textContent = labels[o] || o;
        b.addEventListener("click", () => {
          const at = chosen.indexOf(o);
          if (at !== -1) { chosen.splice(at, 1); b.classList.remove("sel"); }
          else {
            if (chosen.length >= max) return;
            chosen.push(o); b.classList.add("sel");
          }
          counter.textContent = chosen.length + " / " + max;
        });
        grid.appendChild(b);
      }
      ctn.appendChild(grid);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { if (chosen.length === max) { answer.value = chosen.slice(); finish(); } });
      ctn.appendChild(go);
    } else if (prompt.type === "patrolOrder" || prompt.type === "golemOrder" || prompt.type === "apothecaryOrder") {
      const cards = prompt.cards || [];
      const order = [];
      const grid = el("div", "modal-options");
      const out = el("div", "modal-note", "Click the cards in the order you want them (top of deck first):");
      ctn.appendChild(out);
      const seqEl = el("div", "modal-note patrol-seq");
      ctn.appendChild(seqEl);
      for (const c of cards) {
        const opt = el("button", "modal-opt opt-single");
        opt.appendChild(ui.renderCard(c, { cls: "mini" }));
        opt.addEventListener("click", () => {
          const at = order.indexOf(c);
          if (at !== -1) { order.splice(at, 1); opt.classList.remove("sel"); }
          else { order.push(c); opt.classList.add("sel"); }
          seqEl.textContent = "Order: " + order.map((id) => (def(id) ? def(id).name : id)).join(" → ") || "Order: (none)";
        });
        grid.appendChild(opt);
      }
      ctn.appendChild(grid);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { if (order.length === cards.length) { answer.value = order.slice(); finish(); } });
      ctn.appendChild(go);
    } else if (prompt.type === "secretPassageDepth") {
      const max = prompt.maxDepth != null ? prompt.maxDepth : 0;
      const label = el("div", "modal-note", "Cards above it in your deck (0 = top, " + max + " = bottom):");
      ctn.appendChild(label);
      const row = el("div", "modal-btns");
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = String(max);
      slider.value = "0";
      slider.style.cssText = "flex:1";
      const val = el("span", "modal-counter", "0");
      const show = () => { val.textContent = slider.value; };
      slider.addEventListener("input", show);
      row.appendChild(slider);
      row.appendChild(val);
      ctn.appendChild(row);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { answer.value = Number(slider.value); finish(); });
      ctn.appendChild(go);
    } else if (prompt.type === "sentryLook") {
      const looked = prompt.cards || [];
      const result = { trash: [], discard: [] };
      const row = el("div", "sentry-row");
      for (const c of looked) {
        const cell = el("div", "sentry-cell");
        cell.appendChild(ui.renderCard(c, { cls: "mini" }));
        const btns = el("div", "sentry-btns");
        const mk = (label, key) => {
          const b = el("button", "btn btn-sm", label);
          b.addEventListener("click", () => {
            if (key === "trash") { if (result.trash.indexOf(c) === -1) result.trash.push(c); result.discard = result.discard.filter((x) => x !== c); }
            else if (key === "discard") { if (result.discard.indexOf(c) === -1) result.discard.push(c); result.trash = result.trash.filter((x) => x !== c); }
            else { result.trash = result.trash.filter((x) => x !== c); result.discard = result.discard.filter((x) => x !== c); }
          });
          return b;
        };
        btns.appendChild(mk("Trash", "trash"));
        btns.appendChild(mk("Discard", "discard"));
        btns.appendChild(mk("Keep", "keep"));
        cell.appendChild(btns);
        row.appendChild(cell);
      }
      ctn.appendChild(row);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { answer.value = { trash: result.trash.slice(), discard: result.discard.slice() }; finish(); });
      ctn.appendChild(go);
    } else if (prompt.type === "lookoutDispose") {
      const cards = prompt.cards || [];
      const result = { trash: null, discard: null };
      const row = el("div", "sentry-row");
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const cell = el("div", "sentry-cell");
        cell.appendChild(ui.renderCard(c, { cls: "mini" }));
        const btns = el("div", "sentry-btns");
        const mk = (label, key) => {
          const b = el("button", "btn btn-sm", label);
          b.addEventListener("click", () => {
            if (key === "trash") { if (result.trash === null) result.trash = i; }
            else if (key === "discard") { if (result.discard === null) result.discard = i; }
            else {
              if (result.trash === i) result.trash = null;
              if (result.discard === i) result.discard = null;
            }
          });
          return b;
        };
        btns.appendChild(mk("Trash", "trash"));
        btns.appendChild(mk("Discard", "discard"));
        btns.appendChild(mk("Keep", "keep"));
        cell.appendChild(btns);
        row.appendChild(cell);
      }
      ctn.appendChild(row);
      const go = el("button", "btn btn-primary modal-go", "Confirm");
      go.addEventListener("click", () => { answer.value = { trash: result.trash, discard: result.discard }; finish(); });
      ctn.appendChild(go);
    } else if (prompt.type === "nativeVillageMode" || prompt.type === "torturerChoice" || prompt.type === "scryingTop") {
      const labels = prompt.type === "nativeVillageMode"
        ? { deck: "Put the top card on your mat", hand: "Take your mat cards into hand" }
        : prompt.type === "torturerChoice"
          ? { discard: "Discard 2 cards", curse: "Gain a Curse to your hand" }
          : { discard: "Discard it", keep: "Put it back" };
      const options = prompt.type === "nativeVillageMode" ? ["deck", "hand"] : (prompt.options && prompt.options.length ? prompt.options : Object.keys(labels));
      const grid = el("div", "modal-options courtier-opts");
      for (const o of options) {
        const b = el("button", "modal-opt opt-single");
        b.textContent = labels[o] || o;
        b.addEventListener("click", () => { answer.value = o; finish(); });
        grid.appendChild(b);
      }
      ctn.appendChild(grid);
    } else if (prompt.type === "crystalBallUse" || prompt.type === "investmentMode" || prompt.type === "watchtowerUse" || prompt.type === "vaultOpp" || prompt.type === "tiaraTopdeck" || prompt.type === "clerkPlay" || prompt.type === "warChestName" || prompt.type === "tiaraDouble" || prompt.type === "playActionThrice") {
      const labels = {
        crystalBallUse: { trash: "Trash it", play: "Play it", discard: "Discard it" },
        investmentMode: { coins: "Take $4", deck: "Put this on your deck" },
        watchtowerUse: { trash: "Trash the gained card", topdeck: "Put it on your deck", none: "Keep it" },
        vaultOpp: { "true": "Discard 2 Treasures, draw 1", "false": "Keep your hand" },
        tiaraTopdeck: { "true": "Put it on your deck", "false": "Keep it in discard" },
        clerkPlay: { "true": "Play it now, again next turn", "false": "Skip" },
        warChestName: { },
        tiaraDouble: { },
        playActionThrice: { }
      };
      const options = prompt.options && prompt.options.length ? prompt.options : Object.keys(labels[prompt.type] || {});
      const grid = el("div", "modal-options courtier-opts");
      for (const o of options) {
        const b = el("button", "modal-opt opt-single");
        b.textContent = (labels[prompt.type] && labels[prompt.type][o]) || o;
        b.addEventListener("click", () => { answer.value = o; finish(); });
        grid.appendChild(b);
      }
      if (prompt.type === "watchtowerUse") {
        const none = el("button", "modal-opt opt-single");
        none.textContent = "Keep it";
        none.addEventListener("click", () => { answer.value = null; finish(); });
        grid.appendChild(none);
      }
      ctn.appendChild(grid);
    } else {
      ctn.appendChild(el("div", "modal-note", "Auto-decision for " + prompt.type + "."));
      const go = el("button", "btn btn-primary modal-go", "OK");
      go.addEventListener("click", () => { answer.value = defaultAnswer(state, prompt); finish(); });
      ctn.appendChild(go);
    }
  }

  /* Render a modal for an engine prompt; on submit pushes the human's
     answer into the buffer (applies to the next occurrence, since the
     engine resolves synchronously). Returns the rendered element. */
  ui.promptModal = function (prompt) {
    let modalCtn = document.getElementById("modalCtn");
    if (!modalCtn) {
      modalCtn = el("div", "modal-ctn");
      modalCtn.id = "modalCtn";
      document.body.appendChild(modalCtn);
    }
    clear(modalCtn);
    modalCtn.classList.add("open");
    const box = el("div", "modal-box");
    box.appendChild(el("div", "modal-title", promptTitle(prompt)));
    buildPromptControls(box, current ? current.state : null, prompt, function (value) {
      if (prompt && prompt.player) bufferPush(prompt.type, value);
      modalCtn.classList.remove("open");
    });
    const dismiss = el("button", "modal-x", "×");
    dismiss.addEventListener("click", () => { modalCtn.classList.remove("open"); });
    box.appendChild(dismiss);
    modalCtn.appendChild(box);
    return box;
  };

  ui.closeModal = function () {
    const m = document.getElementById("modalCtn");
    if (m) m.classList.remove("open");
  };

  /* Index-pick prompts expect a bare integer from decide; the modal
     collects [i] arrays, so unwrap them when consuming armed answers. */
  const INDEX_PICK_TYPES = ["trashAny", "trashTreasure", "trashCopper", "revealCard", "courtyardTopdeck", "masqueradePass", "secretPassageCard", "havenSetAside", "islandSetAside", "anvilDiscard", "mintCopy"];
  function normalizeAnswer(prompt, value) {
    if (value === undefined || value === null) return value;
    if (INDEX_PICK_TYPES.indexOf(prompt.type) !== -1 && Array.isArray(value)) return value[0];
    return value;
  }

  /* Decide resolver wired into the game: armed answers win, otherwise
     the deterministic bot default. Bots always use the default. */
  ui.humanDecide = function (state, prompt) {
    if (!current || !prompt) return defaultAnswer(state, prompt);
    if (prompt.player !== current.humanId) return defaultAnswer(state, prompt);
    const armed = bufferTake(prompt.type);
    if (armed !== undefined) return normalizeAnswer(prompt, armed);
    const dflt = defaultAnswer(state, prompt);
    if (["topdeckTop", "setAsideAction", "baronDiscard", "farmlandTrash", "courtierChoice", "revealCard", "courtyardTopdeck", "diplomatDiscard", "sentryLook", "trashUpTo", "trashAny", "trashTreasure", "trashCopper", "discardDown", "discardAny", "lurkerMode", "lurkerTrashSupply", "lurkerGainTrash", "masqueradePass", "masqueradeTrash", "millDiscard", "discardExactly", "miningVillageTrash", "minionMode", "noblesChoice", "pawnChoices", "patrolOrder", "secretPassageCard", "secretPassageDepth", "stewardMode", "trashTwo", "swindlerGain", "torturerChoice", "wishName", "nativeVillageMode", "havenSetAside", "islandSetAside", "sailorPlay", "piratePlay", "alchemistTopdeck", "treasuryTopdeck", "herbalistReturn", "scryingTop", "golemOrder", "apothecaryOrder", "lookoutDispose", "anvilDiscard", "crystalBallUse", "investmentMode", "warChestName", "vaultDiscard", "vaultOpp", "tiaraTopdeck", "clerkPlay", "watchtowerUse", "tiaraDouble", "mintCopy", "playActionThrice"].indexOf(prompt.type) !== -1) {
      ui.promptModal(prompt);
    }
    return dflt;
  };

  /* Pre-play planning modal: for cards whose first decision is based on
     the hand/supply (known before the card resolves), collect the human's
     choices up front, arm the buffer, then play the card. */
  ui.openPlan = function (state, pid, cardId) {
    const plan = PLAN[cardId];
    if (!plan || !plan.length) return false;
    const playedIdx = playerOf(state, pid).hand.indexOf(cardId);
    const hand = playerOf(state, pid).hand.filter((_, i) => i !== playedIdx);
    const prompts = [];
    for (const type of plan) {
      if (type === "gainToHand") {
        const pickable = Object.keys(state.supply).filter((id) => state.supply[id] > 0 && def(id) && def(id).cost.coins <= 5 && !def(id).cost.potion);
        prompts.push({ type: type, player: pid, hand: hand, options: pickable });
      } else if (type === "topdeckTop") {
        const top = playerOf(state, pid).discard.length ? playerOf(state, pid).discard[playerOf(state, pid).discard.length - 1] : null;
        prompts.push({ type: type, player: pid, card: top });
      } else if (type === "sentryLook") {
        const deck = playerOf(state, pid).deck;
        const looked = [];
        for (let i = deck.length - 2; i >= 0 && looked.length < 2; i--) looked.push(deck[i]);
        prompts.push({ type: type, player: pid, cards: looked });
      } else {
        prompts.push({ type: type, player: pid, hand: hand });
      }
    }
    let step = 0;
    const ctn = document.getElementById("modalCtn") || (() => { const m = el("div", "modal-ctn"); m.id = "modalCtn"; document.body.appendChild(m); return m; })();
    clear(ctn);
    ctn.classList.add("open");
    const box = el("div", "modal-box modal-plan");
    box.appendChild(el("div", "modal-title", def(cardId).name + " — plan your moves"));
    const stepEl = el("div", "modal-note");
    box.appendChild(stepEl);
    const body = el("div", "modal-body");
    box.appendChild(body);
    const next = () => {
      if (step >= prompts.length) {
        ctn.classList.remove("open");
        playCard(state, pid, cardId);
        return;
      }
      clear(body);
      buildPromptControls(body, state, prompts[step], function (value) {
        bufferPush(prompts[step].type, value);
        step++;
        next();
      });
    };
    const cancel = el("button", "btn", "Cancel");
    cancel.addEventListener("click", () => { ctn.classList.remove("open"); });
    box.appendChild(cancel);
    ctn.appendChild(box);
    next();
    return true;
  };

  /* ════════════════ INTERACTION ════════════════ */
  function playCard(state, humanId, id) {
    const d = def(id);
    if (!d) return;
    try {
      if (d.types.indexOf("Action") !== -1) {
        if (state.phase !== "action") flash("Actions play in the Action phase");
        else { Dominion.engine.actions.play(state, humanId, { cardId: id }); ui.sfx("play"); }
      } else if (d.types.indexOf("Treasure") !== -1) {
        Dominion.engine.treasures.play(state, humanId, { cardIds: [id] });
        ui.sfx("play");
      } else {
        flash("That card can't be played");
      }
    } catch (e) { flash(e.message); }
    ui.update(state);
  }

  function onHandCard(state, humanId, id) {
    if (state.over || state.turnPlayer !== humanId) return;
    const d = def(id);
    if (!d) return;
    if (d.types.indexOf("Action") !== -1 && state.phase === "action") {
      if (ui.openPlan(state, humanId, id)) return; // plan modal will play the card on confirm
    }
    playCard(state, humanId, id);
  }

  function onSupplyClick(state, humanId, id) {
    if (state.over || state.turnPlayer !== humanId) return;
    if (state.phase !== "buy") { flash("Buying happens in the Buy phase"); return; }
    try { Dominion.engine.buy(state, humanId, id); ui.sfx("buy"); } catch (e) { flash(e.message); }
    ui.update(state);
  }

  async function botTurn(state, pid) {
    try {
      if (Dominion.ai && typeof Dominion.ai.playTurn === "function") await Dominion.ai.playTurn(state, pid);
    } catch (e) { flash(e.message); }
    ui.update(state);
  }

  function renderControls(state, humanId) {
    const bar = el("div", "controls");
    if (state.over) return bar;
    if (state.kingdom && state.kingdom.length) {
      const share = el("button", "btn", "Share kingdom");
      share.title = "Copy a link that re-creates this exact kingdom";
      share.addEventListener("click", () => ui.copyKingdomLink(state));
      bar.appendChild(share);
    }
    if (!state.over) {
      const ex = el("button", "btn", "⤓ Export");
      ex.title = "Download the current game state as a JSON file";
      ex.addEventListener("click", () => ui.exportGame());
      bar.appendChild(ex);
    }
    if (state.turnPlayer !== humanId) {
      const b = el("button", "btn", "Run " + nameOf(state, state.turnPlayer) + "'s turn");
      b.addEventListener("click", () => { botTurn(state, state.turnPlayer); });
      bar.appendChild(b);
      return bar;
    }
    if (state.phase === "action" || state.phase === "buy") {
      const hasTreasures = playerOf(state, humanId).hand.some((id) => { const d = def(id); return d && d.types.indexOf("Treasure") !== -1; });
      const pt = el("button", "btn" + (hasTreasures ? "" : " disabled"), "Play all Treasures");
      pt.addEventListener("click", () => {
        if (!hasTreasures) return;
        try { Dominion.engine.treasures.playAll(state, humanId); } catch (e) { flash(e.message); }
        ui.update(state);
      });
      bar.appendChild(pt);
      const adv = el("button", "btn btn-primary", state.phase === "action" ? "Go to Buy" : "End Turn");
      adv.addEventListener("click", () => {
        try { Dominion.engine.advancePhase(state); } catch (e) { flash(e.message); }
        ui.update(state);
      });
      bar.appendChild(adv);
    }
    return bar;
  }

  /* ════════════════ ANIMATIONS (Task 46) ════════════════
     The engine mutates state in place, so we snapshot zone arrays at
     each render and diff the previous snapshot against the current
     one. Newly appended play/trash/hand cards get movement classes;
     dropped supply piles pulse; turn changes fade the table in. All
     animations are no-ops under prefers-reduced-motion. */
  const motion = (() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  })();

  function snapshot(state) {
    return {
      turn: state.turn,
      players: state.players.map((p) => ({
        id: p.id,
        hand: p.hand.slice(),
        play: p.play.slice(),
        discard: p.discard.slice()
      })),
      trash: state.trash.slice(),
      supply: Object.assign({}, state.supply)
    };
  }

  function lcpLen(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  function diffSnap(prev, cur) {
    const anim = { played: {}, drawn: {}, trashed: 0, buys: {}, empty: {} };
    if (!motion) return anim;
    if (prev.turn !== cur.turn) anim.turn = true;
    for (const prevP of prev.players) {
      const curP = cur.players.find((p) => p.id === prevP.id);
      if (!curP) continue;
      const pl = lcpLen(prevP.play, curP.play);
      if (curP.play.length > pl) anim.played[prevP.id] = curP.play.length - pl;
      const hl = lcpLen(prevP.hand, curP.hand);
      if (curP.hand.length > hl) anim.drawn[prevP.id] = curP.hand.length - hl;
    }
    if (cur.trash.length > prev.trash.length) anim.trashed = cur.trash.length - prev.trash.length;
    for (const id of Object.keys(cur.supply)) {
      const a = prev.supply[id] || 0;
      const b = cur.supply[id] || 0;
      if (b < a) anim.buys[id] = true;
      if (a > 0 && b === 0) anim.empty[id] = true;
    }
    return anim;
  }

  /* ════════════════ END-GAME SCREEN (Task 45) ════════════════ */
  function renderGameOver(state) {
    const ov = el("div", "gameover");
    if (current && current.autosave) ui.recordResult(state);
    ui.sfx("win");
    const scores = Dominion.engine.scoreAll(state);
    const max = scores.reduce((m, s) => (s.total > m ? s.total : m), -Infinity);
    const winners = scores.filter((s) => s.total === max);
    ov.appendChild(el("h3", null, "Game Over"));
    const wl = el("div", "winner-line", winners.map((s) => nameOf(state, s.player)).join(" & ") + (winners.length > 1 ? " win" : " wins") + " with " + max + " VP" + (winners.length > 1 ? " each" : ""));
    ov.appendChild(wl);
    const table = el("div", "score-table");
    const head = el("div", "score-row score-head");
    head.appendChild(el("span", "score-cell", "Player"));
    head.appendChild(el("span", "score-cell", "Cards"));
    head.appendChild(el("span", "score-cell", "Breakdown"));
    head.appendChild(el("span", "score-cell", "Total"));
    table.appendChild(head);
    for (const s of scores.slice().sort((a, b) => b.total - a.total)) {
      const row = el("div", "score-row");
      row.appendChild(el("span", "score-cell", nameOf(state, s.player)));
      row.appendChild(el("span", "score-cell", String(s.breakdown.cardCount)));
      const parts = [];
      for (const key of Object.keys(s.breakdown)) {
        if (key === "cardCount" || key === "tokens") continue;
        const d = def(key);
        const label = d ? d.name : key;
        parts.push(label + " " + (s.breakdown[key] > 0 ? "+" : "") + s.breakdown[key]);
      }
      if (s.breakdown.tokens) parts.push("tokens +" + s.breakdown.tokens);
      row.appendChild(el("span", "score-cell score-parts", parts.join(" · ") || "—"));
      row.appendChild(el("span", "score-cell score-total", String(s.total)));
      table.appendChild(row);
    }
    ov.appendChild(table);
    if (current && current.onRestart) {
      const again = el("button", "btn btn-primary", "Play Again");
      again.addEventListener("click", () => current.onRestart());
      ov.appendChild(again);
    }
    return ov;
  }

  /* ════════════════ THE TABLE LAYOUT (Task 40) ═════════════════ */
  function renderTable(state, humanId) {
    const activeId = state.turnPlayer;
    const active = playerOf(state, activeId);
    const anim = (current && current.anim) || null;
    const wrap = el("div", "table");
    if (anim && anim.turn) wrap.classList.add("anim-table");

    const banner = el("div", "turn-banner");
    if (anim && anim.turn) banner.classList.add("anim-turn");
    const who = el("span", "turn-who", activeId === humanId ? "Your turn" : active.name + "'s turn");
    who.appendChild(el("span", "turn-no", " · turn " + state.turn));
    banner.appendChild(who);
    banner.appendChild(el("span", "phase-pill", state.phase.charAt(0).toUpperCase() + state.phase.slice(1) + " phase"));
    banner.appendChild(renderStatus(state, activeId));
    wrap.appendChild(banner);

    const opps = el("div", "opp-strip");
    for (const p of state.players) if (p.id !== humanId) opps.appendChild(renderOpponent(state, p, activeId, humanId));
    wrap.appendChild(opps);

    wrap.appendChild(renderSupply(state, (id) => onSupplyClick(state, humanId, id), (id) => supplyState(state, humanId, id), anim ? anim.buys : null, anim ? anim.empty : null));

    wrap.appendChild(renderTrash(state, anim ? anim.trashed : 0));

    const mid = el("div", "active-zone");
    mid.appendChild(renderPiles(state, activeId));
    mid.appendChild(renderPlayArea(state, activeId, anim ? anim.played[activeId] : 0));
    wrap.appendChild(mid);

    const zones = renderZones(state, activeId);
    if (zones) wrap.appendChild(zones);

    const handCtn = el("div", "hand-ctn");
    handCtn.appendChild(el("div", "zone-title", activeId === humanId ? "Your hand" : active.name + "'s hand"));
    handCtn.appendChild(renderHand(
      playerOf(state, activeId),
      state.turnPlayer === humanId ? (id) => onHandCard(state, humanId, id) : null,
      state.turnPlayer === humanId ? (id) => handCardState(state, humanId, id) : null,
      anim ? anim.drawn[activeId] : 0
    ));
    wrap.appendChild(handCtn);

    wrap.appendChild(renderControls(state, humanId));

    wrap.appendChild(renderLog(state));

    if (state.over) wrap.appendChild(renderGameOver(state));

    return wrap;
  }

  function resolveDecide(state, prompt) {
    if (!current || !prompt || prompt.player == null) return Dominion.ai.choose(state, prompt ? prompt.player : null, prompt);
    if (String(prompt.player) === current.humanId) return ui.humanDecide(state, prompt);
    return Dominion.ai.choose(state, prompt.player, prompt);
  }

  ui.mount = function (rootEl, state, opts) {
    opts = opts || {};
    current = { state: state, humanId: String(opts.humanId || state.players[0].id), rootEl: rootEl, onRestart: opts.onRestart || null, autosave: opts.autosave === true };
    state.decide = (s, p) => resolveDecide(s, p);
    current.lastSnap = snapshot(state);
    current.anim = null;
    rootEl.classList.add("table-root");
    clear(rootEl);
    rootEl.appendChild(renderTable(state, current.humanId));
  };

  ui.update = function (state) {
    if (!current) return;
    current.state = state;
    const snap = snapshot(state);
    current.anim = current.lastSnap ? diffSnap(current.lastSnap, snap) : null;
    current.lastSnap = snap;
    clear(current.rootEl);
    current.rootEl.appendChild(renderTable(state, current.humanId));
    if (ui._tut && typeof ui._tut.tick === "function") ui._tut.tick(state);
    scheduleAutosave(state);
  };

  /* ════════════════ AUTOSAVE (Task 60) ════════════════
     Only single-player (human-vs-AI) games opt in, via mount's
     autosave flag. Every table re-render schedules a debounced
     kv write; a finished game clears the save. All kv access is
     guarded so headless/worker contexts (no root.kv) no-op. */
  let autosaveTimer = null;
  function scheduleAutosave(state) {
    if (!current || !current.autosave) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { autosaveTimer = null; doAutosave(state); }, 400);
  }
  async function doAutosave(state) {
    if (typeof root === "undefined" || !root.kv || !current || !current.autosave) return;
    try {
      if (state.over) { await root.kv.dominion.delete("game"); return; }
      const rec = { saved: Dominion.engine.serialize(state), humanId: current.humanId, savedAt: Date.now() };
      await root.kv.dominion.set("game", rec);
    } catch (e) { /* autosave is best-effort */ }
  }
  ui.doSave = doAutosave;

  /* ════════════════ SETUP SCREEN (Task 54) ════════════════ */
  const EXP_OPTIONS = [
    { key: "base", label: "Base (2nd Ed)", pool: ["base", "base-kingdom"] },
    { key: "intrigue", label: "Intrigue", pool: ["intrigue"] },
    { key: "seaside", label: "Seaside (2nd Ed)", pool: ["seaside"] },
    { key: "alchemy", label: "Alchemy", pool: ["alchemy"] },
    { key: "prosperity", label: "Prosperity (2nd Ed)", pool: ["prosperity"] },
    { key: "cornucopia", label: "Cornucopia", pool: ["cornucopia"] }
  ];
  const AI_DIFFS = ["easy", "normal", "hard", "brutal"];

  /* Every card that can sit in a kingdom supply pile. */
  ui.pickableCards = function () {
    const eng = Dominion.engine;
    const out = [];
    for (const c of Dominion.cards.all()) {
      if (c.inSupply && eng.BASIC_PILES.indexOf(c.id) === -1 && c.id !== "potion" && c.id !== "colony" && c.id !== "platinum") out.push(c);
    }
    return out.sort((a, b) => (a.expansion === b.expansion ? ((a.cost.coins - b.cost.coins) || (a.name < b.name ? -1 : 1)) : (a.expansion < b.expansion ? -1 : 1)));
  };

  /* Required extras a picked kingdom forces into the supply. */
  ui.kingdomExtras = function (kingdom) {
    const needsPotion = kingdom.some((id) => { const d = def(id); return d && d.cost && d.cost.potion > 0; });
    return { potion: needsPotion, bane: null, heirlooms: [], count: kingdom.length };
  };

  /* Seeded random kingdom from the enabled expansions (exactly 10,
     or fewer if the pool is too small). */
  ui.randomKingdom = function (expansions, seed) {
    const eng = Dominion.engine;
    const rng = eng.rng(seed == null ? 1 : seed);
    const pool = [];
    for (const key of expansions || ["base"]) {
      const opt = EXP_OPTIONS.find((o) => o.key === key);
      if (!opt) continue;
      for (const exp of opt.pool) {
        for (const c of Dominion.cards.byExpansion(exp)) {
          if (c.inSupply && eng.BASIC_PILES.indexOf(c.id) === -1 && c.id !== "potion" && c.id !== "colony" && c.id !== "platinum") pool.push(c.id);
        }
      }
    }
    return rng.shuffle([...new Set(pool)]).slice(0, 10);
  };

  ui.setupPanel = function (container, opts) {
    opts = opts || {};
    const cfg = { kingdom: [] };
    const panel = el("div", "setup-panel");

    const row1 = el("div", "setup-row");
    row1.appendChild(el("span", "setup-label", "Players "));
    const countSel = el("select");
    for (let n = 2; n <= 6; n++) { const o = el("option", null, String(n)); o.value = String(n); countSel.appendChild(o); }
    countSel.value = "2";
    row1.appendChild(countSel);
    panel.appendChild(row1);

    const playerRows = el("div", "setup-players");
    panel.appendChild(playerRows);

    const expRow = el("div", "setup-row");
    expRow.appendChild(el("span", "setup-label", "Expansions "));
    const expChecks = {};
    const settings = ui.loadSettings();
    for (const opt of EXP_OPTIONS) {
      const lab = el("label", "setup-chk");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = settings.defaultExpansions.indexOf(opt.key) !== -1; cb.value = opt.key;
      lab.appendChild(cb); lab.appendChild(document.createTextNode(" " + opt.label));
      expChecks[opt.key] = cb;
      expRow.appendChild(lab);
    }
    document.addEventListener("dominion:settings", function syncDefaultExps() {
      const ss = ui.loadSettings();
      for (const k of Object.keys(expChecks)) expChecks[k].checked = ss.defaultExpansions.indexOf(k) !== -1;
    });
    panel.appendChild(expRow);

    const kmRow = el("div", "setup-row");
    kmRow.appendChild(el("span", "setup-label", "Kingdom "));
    const rndRadio = el("input"); rndRadio.type = "radio"; rndRadio.name = "kMode"; rndRadio.value = "random"; rndRadio.checked = true;
    kmRow.appendChild(rndRadio); kmRow.appendChild(el("label", "setup-inline", " Random "));
    const manRadio = el("input"); manRadio.type = "radio"; manRadio.name = "kMode"; manRadio.value = "manual";
    kmRow.appendChild(manRadio); kmRow.appendChild(el("label", "setup-inline", " Manual "));
    const pickBtn = el("button", "btn btn-sm", "Pick 10…");
    const pickLabel = el("span", "pick-label", "");
    kmRow.appendChild(pickBtn); kmRow.appendChild(pickLabel);
    panel.appendChild(kmRow);

    const linkRow = el("div", "setup-row setup-actions");
    const encBtn = el("button", "btn btn-sm", "📖 Encyclopedia");
    encBtn.addEventListener("click", () => ui.openEncyclopedia());
    const rulesBtn = el("button", "btn btn-sm", "❓ How to Play");
    rulesBtn.addEventListener("click", () => ui.openRules());
    const setBtn = el("button", "btn btn-sm", "⚙ Settings");
    setBtn.addEventListener("click", () => ui.openSettings());
    const importBtn = el("button", "btn btn-sm", "⤒ Import");
    const fileInput = el("input"); fileInput.type = "file"; fileInput.accept = ".json,application/json"; fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try { ui.importGame(String(rd.result)); }
        catch (e) { status.textContent = "Import failed: " + ((e && e.message) || e); }
        fileInput.value = "";
      };
      rd.readAsText(f);
    });
    importBtn.addEventListener("click", () => fileInput.click());
    linkRow.appendChild(encBtn);
    linkRow.appendChild(rulesBtn);
    linkRow.appendChild(setBtn);
    linkRow.appendChild(importBtn);
    panel.appendChild(linkRow);

    /* ── saved-kingdom favorites (Task 62) ── */
    const favRow = el("div", "setup-row setup-favs");
    favRow.appendChild(el("span", "setup-label", "Saved "));
    const favSel = el("select");
    const saveBtn = el("button", "btn btn-sm", "💾 Save current");
    const loadBtn = el("button", "btn btn-sm", "Load");
    const delBtn = el("button", "btn btn-sm", "Delete");
    const favStatus = el("span", "setup-status", "");
    favRow.appendChild(favSel); favRow.appendChild(saveBtn); favRow.appendChild(loadBtn); favRow.appendChild(delBtn);
    favRow.appendChild(favStatus);
    panel.appendChild(favRow);
    const refreshFavs = () => {
      ui.favoriteKingdoms().then((list) => {
        clear(favSel);
        if (!list.length) {
          favSel.appendChild(el("option", null, "— none saved —"));
          loadBtn.disabled = true; delBtn.disabled = true;
          return;
        }
        favSel.appendChild(el("option", null, "— saved kingdoms —"));
        for (const k of list) { const o = el("option", null, k.name); o.value = k.name; favSel.appendChild(o); }
        loadBtn.disabled = false; delBtn.disabled = false;
      }).catch(() => { loadBtn.disabled = true; delBtn.disabled = true; });
    };
    saveBtn.addEventListener("click", () => {
      if (cfg.kingdom.length !== 10) { favStatus.textContent = "Pick exactly 10 cards first."; return; }
      ui.saveFavorite(cfg.kingdom, cfg.seed).then((name) => { favStatus.textContent = "Saved “" + name + "”."; refreshFavs(); });
    });
    loadBtn.addEventListener("click", () => {
      const name = favSel.value;
      if (!name) return;
      ui.loadFavorite(name).then((k) => {
        if (!k) return;
        cfg.kingdom = (k.kingdom || []).slice();
        cfg.seed = k.seed == null ? undefined : k.seed;
        manRadio.checked = true; rndRadio.checked = false;
        updateKingdomLabel();
        favStatus.textContent = "Loaded “" + name + "”.";
      });
    });
    delBtn.addEventListener("click", () => {
      const name = favSel.value;
      if (!name) return;
      ui.deleteFavorite(name).then(() => { favStatus.textContent = "Deleted."; refreshFavs(); });
    });
    if (!ui.kvFolder()) favRow.hidden = true;
    refreshFavs();

    const startBtn = el("button", "btn btn-primary setup-start", "Start Game");
    panel.appendChild(startBtn);
    const status = el("div", "setup-status", "");
    panel.appendChild(status);

    const renderPlayers = () => {
      const n = parseInt(countSel.value, 10) || 2;
      clear(playerRows);
      for (let i = 0; i < n; i++) {
        const row = el("div", "setup-player");
        const name = el("input"); name.type = "text"; name.value = "Player " + (i + 1); name.maxLength = 16;
        const diff = el("select");
        diff.appendChild(el("option", null, "Human"));
        for (const d of AI_DIFFS) { const o = el("option", null, d.charAt(0).toUpperCase() + d.slice(1)); o.value = d; diff.appendChild(o); }
        diff.value = i === 0 ? "Human" : "normal";
        diff.addEventListener("change", () => {
          if (diff.value === "Human") {
            for (const r of playerRows.querySelectorAll(".setup-player select")) if (r !== diff) r.value = "normal";
          }
        });
        row.appendChild(el("span", "setup-pid", "p" + (i + 1) + " "));
        row.appendChild(name);
        row.appendChild(el("span", "setup-diff-label", " AI "));
        row.appendChild(diff);
        playerRows.appendChild(row);
      }
    };
    renderPlayers();
    countSel.addEventListener("change", renderPlayers);

    const updateKingdomLabel = () => {
      pickLabel.textContent = manRadio.checked ? (cfg.kingdom.length + " / 10 picked") : "";
    };
    pickBtn.addEventListener("click", () => {
      (opts.ensureCards || (async () => {}))().then(() => {
        ui.openPicker((kingdom) => { cfg.kingdom = kingdom; updateKingdomLabel(); });
      }).catch((e) => { status.textContent = "Catalog load failed: " + ((e && e.message) || e); });
    });
    rndRadio.addEventListener("change", updateKingdomLabel);
    manRadio.addEventListener("change", updateKingdomLabel);

    startBtn.addEventListener("click", () => {
      (opts.ensureCards || (async () => {}))().then(() => {
        const mode = manRadio.checked ? "manual" : "random";
        const expansions = EXP_OPTIONS.filter((o) => expChecks[o.key].checked).map((o) => o.key);
        if (mode === "manual" && cfg.kingdom.length !== 10) { status.textContent = "Pick exactly 10 kingdom cards."; return; }
        const kingdom = mode === "manual" ? cfg.kingdom.slice() : ui.randomKingdom(expansions, (Math.random() * 1e9) | 0);
        const players = [];
        for (const r of playerRows.querySelectorAll(".setup-player")) {
          const i = players.length;
          players.push({
            id: "p" + (i + 1),
            name: r.querySelector("input").value.trim() || "Player " + (i + 1),
            difficulty: r.querySelector("select").value
          });
        }
        if (!players.some((p) => p.difficulty === "Human")) players[0].difficulty = "Human";
        const humanId = players.find((p) => p.difficulty === "Human").id;
        const aiDifficulty = {};
        for (const p of players) if (p.difficulty !== "Human") aiDifficulty[p.id] = p.difficulty;
        opts.onStart({ players: players, humanId: humanId, aiDifficulty: aiDifficulty, expansions: expansions, kingdom: kingdom, seed: (Math.random() * 1e9) | 0 });
      }).catch((e) => { status.textContent = "Could not start: " + ((e && e.message) || e); });
    });

    clear(container);
    container.appendChild(panel);
    return panel;
  };

  /* ════════════════ KINGDOM PICKER (Task 55) ════════════════ */
  ui.openPicker = function (onDone) {
    let ctn = document.getElementById("pickerCtn");
    if (!ctn) { ctn = el("div", "modal-ctn"); ctn.id = "pickerCtn"; document.body.appendChild(ctn); }
    clear(ctn);
    ctn.classList.add("open");
    const box = el("div", "modal-box picker-box");
    box.appendChild(el("div", "modal-title", "Kingdom picker — choose exactly 10"));

    const search = el("input"); search.type = "search"; search.placeholder = "Search name…";
    const typeSel = el("select");
    const allTypesOpt = el("option", null, "All types"); allTypesOpt.value = ""; typeSel.appendChild(allTypesOpt);
    const costSel = el("select");
    for (const label of ["Any cost", "$0–1", "$2–3", "$4–5", "$6+"]) { const o = el("option", null, label); o.value = label === "Any cost" ? "" : label; costSel.appendChild(o); }
    const expSel = el("select");
    const allExpsOpt = el("option", null, "All expansions"); allExpsOpt.value = ""; expSel.appendChild(allExpsOpt);

    const cards = ui.pickableCards();
    const typeNames = new Set();
    for (const c of cards) for (const t of c.types) typeNames.add(t);
    for (const t of [...typeNames].sort()) { const o = el("option", null, t); o.value = t; typeSel.appendChild(o); }
    for (const e of [...new Set(cards.map((c) => c.expansion))].sort()) { const o = el("option", null, e); o.value = e; expSel.appendChild(o); }

    const filters = el("div", "picker-filters");
    filters.appendChild(search); filters.appendChild(typeSel); filters.appendChild(costSel); filters.appendChild(expSel);
    box.appendChild(filters);
    const countEl = el("div", "modal-counter", "0 / 10 selected");
    box.appendChild(countEl);
    const grid = el("div", "picker-grid");
    box.appendChild(grid);
    const extras = el("div", "picker-extras", "");
    box.appendChild(extras);
    const btns = el("div", "modal-btns");
    const confirm = el("button", "btn btn-primary", "Confirm");
    const cancel = el("button", "btn", "Cancel");
    btns.appendChild(confirm); btns.appendChild(cancel);
    box.appendChild(btns);
    ctn.appendChild(box);

    const sel = new Set();
    const refresh = () => {
      const q = search.value.trim().toLowerCase();
      const tp = typeSel.value;
      const cs = costSel.value;
      const ex = expSel.value;
      clear(grid);
      for (const c of cards) {
        if (q && c.name.toLowerCase().indexOf(q) === -1) continue;
        if (tp && c.types.indexOf(tp) === -1) continue;
        if (cs && cs !== "Any cost") {
          const coins = c.cost.coins;
          const inRange = cs === "$0–1" ? coins <= 1 : cs === "$2–3" ? (coins >= 2 && coins <= 3) : cs === "$4–5" ? (coins >= 4 && coins <= 5) : coins >= 6;
          if (!inRange) continue;
        }
        if (ex && c.expansion !== ex) continue;
        const cell = el("button", "pick-cell" + (sel.has(c.id) ? " sel" : ""));
        cell.appendChild(ui.renderCard(c.id, { cls: "mini" }));
        cell.appendChild(el("span", "pick-tick", "✓"));
        cell.addEventListener("click", () => {
          if (sel.has(c.id)) { sel.delete(c.id); cell.classList.remove("sel"); }
          else if (sel.size < 10) { sel.add(c.id); cell.classList.add("sel"); }
          countEl.textContent = sel.size + " / 10 selected";
          updateExtras();
          confirm.disabled = sel.size !== 10;
        });
        grid.appendChild(cell);
      }
      countEl.textContent = sel.size + " / 10 selected";
      updateExtras();
      confirm.disabled = sel.size !== 10;
    };
    const updateExtras = () => {
      const ex = ui.kingdomExtras([...sel]);
      const parts = [];
      if (ex.potion) parts.push("⚠ Requires the Potion card — it will be added to the supply.");
      if (sel.size === 10) parts.push("10 selected — ready.");
      extras.textContent = parts.join(" ");
    };
    search.addEventListener("input", refresh);
    typeSel.addEventListener("change", refresh);
    costSel.addEventListener("change", refresh);
    expSel.addEventListener("change", refresh);
    confirm.addEventListener("click", () => {
      if (sel.size !== 10) return;
      ctn.classList.remove("open");
      onDone([...sel]);
    });
    cancel.addEventListener("click", () => { ctn.classList.remove("open"); });
    refresh();
    return ctn;
  };

  /* ════════════════ SHAREABLE KINGDOM URLs (Task 59) ════════════
     A kingdom can be encoded as ?kingdom=<id1,id2,…> (optionally
     &seed=N) on the generator URL. ui.parseKingdomString validates
     a raw id list; ui.kingdomFromParams reads a search-or-hash
     string; ui.kingdomQuery builds the query; ui.kingdomLink builds
     the full public URL; ui.copyKingdomLink copies it. All parsing
     helpers are DOM-free so tests can run headless. */
  ui.parseKingdomString = function (str) {
    if (!str) return null;
    const ids = String(str).split(/[,;&\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!ids.length) return null;
    for (const id of ids) {
      const d = (Dominion.cards && typeof Dominion.cards.get === "function") ? Dominion.cards.get(id) : null;
      if (!d) return null;
      if (!d.inSupply) return null;
      if (Dominion.engine.BASIC_PILES.indexOf(id) !== -1 || id === "potion") return null;
    }
    if (new Set(ids).size !== ids.length) return null;
    return ids;
  };

  ui.kingdomFromParams = function (search) {
    const s = String(search || "").replace(/^[?#]/, "");
    let params = null;
    try { params = new URLSearchParams(s); } catch (e) { return { kingdom: null, seed: null }; }
    const seedRaw = params.get("seed");
    const seed = seedRaw != null && seedRaw !== "" && isFinite(Number(seedRaw)) ? Number(seedRaw) : null;
    return { kingdom: ui.parseKingdomString(params.get("kingdom")), seed: seed };
  };

  ui.kingdomQuery = function (cfg) {
    cfg = cfg || {};
    const parts = [];
    if (cfg.kingdom && cfg.kingdom.length) parts.push("kingdom=" + cfg.kingdom.map(encodeURIComponent).join(","));
    if (cfg.seed != null) parts.push("seed=" + cfg.seed);
    return parts.join("&");
  };

  ui.kingdomLink = function (state) {
    const base = (typeof window !== "undefined" && window.generatorName)
      ? "https://perchance.org/" + window.generatorName
      : ((typeof location !== "undefined" && location.origin) ? location.origin + location.pathname : "");
    return base + "?" + ui.kingdomQuery({ kingdom: state.kingdom || [], seed: state.seed });
  };

  ui.copyKingdomLink = async function (state) {
    const url = ui.kingdomLink(state);
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = url; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta);
        ta.select(); ok = document.execCommand("copy"); ta.remove();
      } catch (e2) { ok = false; }
    }
    flash(ok ? "Kingdom link copied!" : "Could not copy — link: " + url);
  };

  /* ════════════════ CARD ENCYCLOPEDIA (Task 56) ════════════════
     A searchable reference of every registered card with its full
     official text: filters by name/text, type, cost and expansion,
     with a click-for-details pane. ui.encyclopediaCards() is the
     DOM-free source of truth the tests validate against. */
  ui.encyclopediaCards = function () {
    return Dominion.cards.all().slice().sort((a, b) =>
      (a.expansion === b.expansion ? ((a.cost.coins - b.cost.coins) || (a.name < b.name ? -1 : 1)) : (a.expansion < b.expansion ? -1 : 1)));
  };

  ui.openEncyclopedia = function (opts) {
    opts = opts || {};
    let ctn = document.getElementById("encycCtn");
    if (!ctn) { ctn = el("div", "modal-ctn"); ctn.id = "encycCtn"; document.body.appendChild(ctn); }
    clear(ctn);
    ctn.classList.add("open");
    const box = el("div", "modal-box encyc-box");
    box.appendChild(el("div", "modal-title", "Card Encyclopedia — every implemented card"));

    const search = el("input"); search.type = "search"; search.placeholder = "Search name or text…";
    const typeSel = el("select");
    const allTypesOpt = el("option", null, "All types"); allTypesOpt.value = ""; typeSel.appendChild(allTypesOpt);
    const costSel = el("select");
    for (const label of ["Any cost", "$0–1", "$2–3", "$4–5", "$6+"]) { const o = el("option", null, label); o.value = label === "Any cost" ? "" : label; costSel.appendChild(o); }
    const expSel = el("select");
    const allExpsOpt = el("option", null, "All expansions"); allExpsOpt.value = ""; expSel.appendChild(allExpsOpt);

    const cards = ui.encyclopediaCards();
    const typeNames = new Set();
    for (const c of cards) for (const t of c.types) typeNames.add(t);
    for (const t of [...typeNames].sort()) { const o = el("option", null, t); o.value = t; typeSel.appendChild(o); }
    for (const e of [...new Set(cards.map((c) => c.expansion))].sort()) { const o = el("option", null, e); o.value = e; expSel.appendChild(o); }

    const filters = el("div", "picker-filters");
    filters.appendChild(search); filters.appendChild(typeSel); filters.appendChild(costSel); filters.appendChild(expSel);
    box.appendChild(filters);
    const countEl = el("div", "modal-counter", cards.length + " cards");
    box.appendChild(countEl);
    const grid = el("div", "encyc-grid");
    box.appendChild(grid);
    const detail = el("div", "encyc-detail");
    box.appendChild(detail);
    const closeRow = el("div", "modal-btns");
    const close = el("button", "btn", "Close");
    closeRow.appendChild(close);
    box.appendChild(closeRow);
    ctn.appendChild(box);

    const showDetail = (c) => {
      clear(detail);
      detail.classList.add("open");
      const head = el("div", "encyc-detail-head");
      head.appendChild(ui.renderCard(c.id));
      const info = el("div", "encyc-detail-info");
      info.appendChild(el("div", "encyc-detail-name", c.name));
      const costTxt = "$" + (c.cost ? c.cost.coins : 0) + (c.cost && c.cost.potion ? " + P" : "") + (c.cost && c.cost.debt ? " (debt)" : "");
      info.appendChild(el("div", "encyc-detail-meta", c.types.join(" · ") + " · " + costTxt + " · " + (EXP_LABEL[c.expansion] || c.expansion)));
      if (c.vp != null) info.appendChild(el("div", "encyc-detail-line", "VP: " + c.vp));
      if (c.treasure != null) info.appendChild(el("div", "encyc-detail-line", "Treasure value: " + c.treasure));
      if (c.pileSize != null) info.appendChild(el("div", "encyc-detail-line", "Pile size: " + c.pileSize));
      info.appendChild(el("div", "encyc-detail-text", c.text || ""));
      head.appendChild(info);
      detail.appendChild(head);
    };

    const refresh = () => {
      const q = search.value.trim().toLowerCase();
      const tp = typeSel.value, cs = costSel.value, ex = expSel.value;
      clear(grid);
      let shown = 0;
      for (const c of cards) {
        if (q && c.name.toLowerCase().indexOf(q) === -1 && (c.text || "").toLowerCase().indexOf(q) === -1) continue;
        if (tp && c.types.indexOf(tp) === -1) continue;
        if (cs) {
          const coins = c.cost.coins;
          const inRange = cs === "$0–1" ? coins <= 1 : cs === "$2–3" ? (coins >= 2 && coins <= 3) : cs === "$4–5" ? (coins >= 4 && coins <= 5) : coins >= 6;
          if (!inRange) continue;
        }
        if (ex && c.expansion !== ex) continue;
        const cell = el("button", "encyc-cell");
        cell.dataset.card = c.id;
        cell.appendChild(ui.renderCard(c.id));
        cell.addEventListener("click", () => showDetail(c));
        grid.appendChild(cell);
        shown++;
      }
      if (!shown) grid.appendChild(el("div", "zone-empty", "No cards match."));
      countEl.textContent = shown + " of " + cards.length + " cards";
    };
    search.addEventListener("input", refresh);
    typeSel.addEventListener("change", refresh);
    costSel.addEventListener("change", refresh);
    expSel.addEventListener("change", refresh);
    close.addEventListener("click", () => { ctn.classList.remove("open"); });
    const dismiss = el("button", "modal-x", "×");
    dismiss.addEventListener("click", () => { ctn.classList.remove("open"); });
    box.appendChild(dismiss);
    refresh();
    return ctn;
  };

  /* ════════════════ RULES & HOW TO PLAY (Task 57) ════════════════
     Turn structure + phases and a glossary of every engine keyword.
     ui.turnStructure() and ui.glossary() are DOM-free data so the
     tests can validate the content directly. */
  ui.turnStructure = function () {
    return [
      { id: "start", title: "Start of turn", body: "Effects that say \"at the start of your turn\" resolve now — including Duration cards you played last turn still sitting in play. Draw from your deck if you were out of cards." },
      { id: "action", title: "Action phase", body: "Play one Action card (or more if Actions remain). Treasures may also be played here, but saving them for the Buy phase is usually wise." },
      { id: "buy", title: "Buy phase", body: "Play Treasures to add Coins, then spend your buys on supply piles. You get 1 Buy each turn, and Coins don't carry over." },
      { id: "cleanup", title: "Cleanup phase", body: "Discard every card you have in play and your whole hand into your discard pile. Effects that say \"at the start of Cleanup\" resolve first." },
      { id: "draw", title: "Draw hand", body: "Draw 5 new cards. When your deck runs out, shuffle your discard pile into it. Then the next player's turn begins." }
    ];
  };

  ui.glossary = function () {
    return [
      { term: "Action", def: "A card type. Action cards give you cards, Actions, Coins, Buys or attacks when played in your Action phase." },
      { term: "Treasure", def: "A card type. Treasures produce Coins when played; you play them in your Buy phase to afford purchases." },
      { term: "Victory", def: "A card type. Victory cards are worth VP at game end (Estate 1, Duchy 3, Province 6, Curse −1)." },
      { term: "Curse", def: "A card type worth −1 VP. Curses are gained from the Curse pile by attacks like Witch." },
      { term: "Reaction", def: "A card type. Reactions may be revealed from your hand when an opponent plays an Attack — Moat makes you unaffected, for example." },
      { term: "Attack", def: "A card type. Attacks affect each other player in turn order, and open the reaction window." },
      { term: "Duration", def: "A card type. Durations stay in play after Cleanup and resolve a bonus at the start of your next turn, then leave play." },
      { term: "Reserve", def: "A card type. Reserves go to your Tavern mat instead of the play area; you may later \"call\" them for a one-shot effect." },
      { term: "+X Cards", def: "Draw X cards from your deck." },
      { term: "+X Actions", def: "You may play X extra Action cards this turn." },
      { term: "+X Buys", def: "You may buy X extra cards this turn." },
      { term: "+X Coins", def: "Spendable money this turn, shown in the Buy phase." },
      { term: "+X Potions", def: "Potion resource, needed to buy Alchemy cards that cost P." },
      { term: "Gain", def: "Take a card from a supply pile and put it into your discard pile (unless the card says otherwise)." },
      { term: "Trash", def: "Remove a card from the game — it goes to the Trash zone and can only return via cards that gain from the Trash." },
      { term: "Reveal", def: "Show a card; it stays where it is unless the effect says otherwise." },
      { term: "Topdeck", def: "Put a card on top of your deck, so you'll draw it next." },
      { term: "Discard", def: "Move a card from your hand to your discard pile. Discarding from a deck (as some cards do) goes to the discard pile too." },
      { term: "Draw", def: "Take the top card of your deck into your hand. If your deck is empty, shuffle your discard pile into it first." },
      { term: "Reshuffle", def: "When your deck empties, shuffle your discard pile into a new deck. A reshuffled discard never triggers discard effects." },
      { term: "Hand", def: "The cards you hold, played from during your turn. You start each turn with 5." },
      { term: "Deck", def: "The face-down pile you draw from. The top of the deck is the end of the pile." },
      { term: "Discard pile", def: "Where used, bought, and discarded cards go. It is shuffled into a new deck when you need to draw and your deck is empty." },
      { term: "Play area", def: "Where cards you play this turn sit until Cleanup." },
      { term: "Supply", def: "The piles of cards available to buy — the 10 kingdom piles plus Copper, Silver, Gold, Estate, Duchy, Province and Curse." },
      { term: "Pile", def: "A stack of identical cards in the Supply. You may buy from any pile that still has cards." },
      { term: "Empty pile", def: "A supply pile with no cards left. Emptying 3 piles ends the game; emptying the Province pile ends it too." },
      { term: "Cost", def: "A card's price in Coins (and Potions, if shown). Costs matter for trashing, gaining, and comparing cards." },
      { term: "Coffers", def: "Saved Coins (also called Coin tokens) that persist between turns and are spent in the Buy phase." },
      { term: "Villagers", def: "Saved +Actions that persist between turns and are spent in the Action phase." },
      { term: "Debt", def: "A cost you can pay later. Buying on Debt adds debt tokens; you must pay them off before buying more (a token is 1 Coin)." },
      { term: "VP tokens", def: "Points gained from effects that persist across turns and are added to your final score." },
      { term: "Each other player", def: "Applies to every player except the one who played the card, in turn order. Attacks resolve this way." },
      { term: "Set aside", def: "Remove a card from play temporarily; it returns later or stays out per the card's instructions." },
      { term: "Exile", def: "Cards you Exile go to your Exile mat, out of your deck; some cards let you gain cards from your Exile mat." },
      { term: "Mat", def: "A place for cards set aside from your deck (Tavern mat, Exile mat, Island mat). Cards on mats are out of play." },
      { term: "Call", def: "Activate a Reserve card on your Tavern mat for its one-shot effect, then put it back on the mat." },
      { term: "Night", def: "A card type played in a Night phase after the Buy phase, before Cleanup." },
      { term: "Looter", def: "A card type that gains Ruins instead of Curses from the Ruins pile." },
      { term: "Traveler", def: "A card type that upgrades — when you play it you exchange it for the next card in its chain." },
      { term: "Shelter", def: "A card type; in some setups Shelters replace the Estates in your starting deck." },
      { term: "Ruins", def: "Junk cards gained by Looter cards from a shared mixed pile." },
      { term: "Knight", def: "A special supply pile of 10 unique Knight cards — you gain the top card of the pile." },
      { term: "Prize", def: "Non-supply cards gained from Tournament; you gain them to your hand and they go to the Prize mat." },
      { term: "Heirloom", def: "A card that replaces a Copper in your starting deck when its card is in the kingdom." },
      { term: "Spirit", def: "A card type from Nocturne; Spirits are gained to your hand and used immediately or on later turns." },
      { term: "Zombie", def: "A card type from Nocturne — Zombies in your deck are played by other cards." },
      { term: "Shadow", def: "A card type from Nocturne's Shadows pile, used like Ruins but played at night." },
      { term: "Liaison", def: "A card type from Allies that grants Favors, spent on Ally cards." },
      { term: "Omen", def: "A card type from Allies that triggers Hexes." },
      { term: "Prophecy", def: "A card type from Plunder's Prophecies — their goal is met at game end for a bonus." },
      { term: "Fate", def: "A card type that gives Boons." },
      { term: "Doom", def: "A card type that gives Hexes." },
      { term: "When you gain / trash / buy", def: "Triggers that fire the moment a card enters that situation, before the rest of the effect continues." },
      { term: "Cleanup", def: "The phase where you discard all cards in play and your hand, then draw a fresh 5-card hand." },
      { term: "Game end", def: "The game ends when 3 supply piles are empty or the Province pile is empty; the player with the most VP wins." }
    ];
  };

  ui.openRules = function (opts) {
    opts = opts || {};
    let ctn = document.getElementById("rulesCtn");
    if (!ctn) { ctn = el("div", "modal-ctn"); ctn.id = "rulesCtn"; document.body.appendChild(ctn); }
    clear(ctn);
    ctn.classList.add("open");
    const box = el("div", "modal-box rules-box");
    box.appendChild(el("div", "modal-title", "How to Play — Dominion"));
    const body = el("div", "rules-body");
    const phaseSec = el("div", "rules-section");
    phaseSec.appendChild(el("div", "rules-sec-title", "Turn structure"));
    const tl = el("div", "rules-phases");
    for (const ph of ui.turnStructure()) {
      const row = el("div", "rules-phase");
      row.appendChild(el("span", "rules-phase-name", ph.title));
      row.appendChild(el("span", "rules-phase-body", ph.body));
      tl.appendChild(row);
    }
    phaseSec.appendChild(tl);
    body.appendChild(phaseSec);
    const glossSec = el("div", "rules-section");
    glossSec.appendChild(el("div", "rules-sec-title", "Keyword glossary"));
    const gl = el("div", "rules-glossary");
    for (const g of ui.glossary()) {
      const item = el("div", "glossary-item");
      item.appendChild(el("span", "rules-term", g.term));
      item.appendChild(el("span", "rules-def", g.def));
      gl.appendChild(item);
    }
    glossSec.appendChild(gl);
    body.appendChild(glossSec);
    box.appendChild(body);
    const closeRow = el("div", "modal-btns");
    const close = el("button", "btn", "Close");
    closeRow.appendChild(close);
    box.appendChild(closeRow);
    ctn.appendChild(box);
    close.addEventListener("click", () => { ctn.classList.remove("open"); });
    const dismiss = el("button", "modal-x", "×");
    dismiss.addEventListener("click", () => { ctn.classList.remove("open"); });
    box.appendChild(dismiss);
    return ctn;
  };

  /* ════════════════ FIRST-TURN ONBOARDING (Task 58) ════════════════
     A guided first turn: a spotlight highlights the zone the player
     should look at, a bubble explains it, and the guide advances as
     the player genuinely plays (a card played, coins, a buy) or by
     pressing Next. ui.onboardingSteps() is the DOM-free step data;
     ui.startOnboarding() returns a controller { tick, next, skip,
     done } that the table's update() drives. Completing the guide
     sets a localStorage flag so it only runs once. */
  ui.onboardingSteps = function () {
    return [
      { id: "intro", title: "Your first turn", target: ".turn-banner", body: "Welcome to Dominion! This banner shows whose turn it is and your live Actions, Buys, Coins and VP. The game ends when 3 supply piles empty — aim for the most Victory points. Press Next." },
      { id: "hand", title: "Play an Action", target: ".hand-ctn", body: "This is your hand. Click an Action card (bordered in red for Attacks, gold-bordered for Actions) to play it — cards like Village give you more Actions, Smithy draws cards. It helps to play Actions before Treasures." },
      { id: "treasures", title: "Play your Treasures", target: ".controls", body: "Copper, Silver and Gold are Treasures — they produce Coins. Press 'Play all Treasures', then 'Go to Buy' to move to the Buy phase." },
      { id: "buy", title: "Buy a card", target: ".supply-grid", body: "Buy phase. Click a supply pile to buy a card with your Coins (you have 1 Buy this turn). Cheap cards now, big cards later." },
      { id: "cleanup", title: "End your turn", target: ".controls", body: "Press 'End Turn'. Cleanup discards your played cards and hand, then you draw 5 new cards. That's the whole turn — tutorial complete!" }
    ];
  };

  function tutProgressSince(ctl, st) {
    const log = st.log.slice(ctl.logLen);
    return {
      anything: log.length > 0,
      playedAction: log.some((e) => e.t === "playAction"),
      bought: log.some((e) => e.t === "buy"),
      enteredBuy: st.phase === "buy",
      pastTurn: st.turn > ctl.startedAtTurn || st.over
    };
  }
  function tutStepDone(st, step, prog) {
    switch (step.id) {
      case "intro": return prog.anything || prog.pastTurn;
      case "hand": return prog.playedAction || st.phase !== "action" || prog.pastTurn;
      case "treasures": return prog.enteredBuy || prog.pastTurn;
      case "buy": return prog.bought || prog.pastTurn;
      case "cleanup": return prog.pastTurn;
      default: return true;
    }
  }

  ui.startOnboarding = function (rootEl, state, humanId, opts) {
    opts = opts || {};
    const steps = ui.onboardingSteps();
    let overlay = document.getElementById("tutOverlay");
    if (overlay) overlay.remove();
    overlay = el("div", "tut-overlay");
    overlay.id = "tutOverlay";
    document.body.appendChild(overlay);

    const ctl = {
      active: true, index: 0, finished: false, humanId: String(humanId),
      startedAtTurn: state.turn, logLen: state.log.length, rootEl: rootEl,
      step() { return steps[ctl.index]; },
      render() { renderTutOverlay(ctl); },
      next() {
        if (!ctl.active) return;
        if (ctl.index >= steps.length - 1) { ctl.finish(); return; }
        ctl.index++;
        renderTutOverlay(ctl);
      },
      skip() { ctl.finish(); },
      finish() {
        if (ctl.finished) return;
        ctl.active = false; ctl.finished = true;
        try { localStorage.setItem("dominion.tutorialDone", "1"); } catch (e) {}
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (ui._tut === ctl) ui._tut = null;
      },
      tick(st) {
        if (!ctl.active || ctl.finished) return;
        if (st.over) { ctl.finish(); return; }
        let cur = steps[ctl.index];
        while (cur && tutStepDone(st, cur, tutProgressSince(ctl, st))) {
          if (ctl.index >= steps.length - 1) { ctl.finish(); return; }
          ctl.index++;
          cur = steps[ctl.index];
        }
        renderTutOverlay(ctl);
      }
    };
    ui._tut = ctl;
    renderTutOverlay(ctl);
    return ctl;
  };

  function renderTutOverlay(ctl) {
    const ov = document.getElementById("tutOverlay");
    if (!ov) return;
    while (ov.firstChild) ov.removeChild(ov.firstChild);
    if (!ctl.active || !ctl.step()) return;
    const cur = ctl.step();
    const target = ctl.rootEl && ctl.rootEl.querySelector ? ctl.rootEl.querySelector(cur.target) : null;
    if (target && typeof target.getBoundingClientRect === "function") {
      const r = target.getBoundingClientRect();
      const spot = el("div", "tut-spot");
      spot.style.left = (r.left - 10) + "px";
      spot.style.top = (r.top - 10) + "px";
      spot.style.width = (r.width + 20) + "px";
      spot.style.height = (r.height + 20) + "px";
      ov.appendChild(spot);
    }
    const bubble = el("div", "tut-bubble");
    bubble.appendChild(el("div", "tut-title", (ctl.index + 1) + " of " + ui.onboardingSteps().length + " · " + cur.title));
    bubble.appendChild(el("div", "tut-body", cur.body));
    const btns = el("div", "tut-btns");
    const next = el("button", "btn btn-primary btn-sm", ctl.index >= ui.onboardingSteps().length - 1 ? "Done" : "Next");
    next.addEventListener("click", () => ctl.next());
    const skip = el("button", "btn btn-sm", "Skip tutorial");
    skip.addEventListener("click", () => ctl.skip());
    btns.appendChild(next);
    btns.appendChild(skip);
    bubble.appendChild(btns);
    ov.appendChild(bubble);
  }

  /* ── ?test=cards harness ── */
  ui.demo = function (rootEl) {
    const picks = ["gold", "silver", "copper", "estate", "duchy", "province", "curse", "witch", "moat", "gardens", "laboratory", "throne_room", "sentry", "merchant", "harbinger", "council_room"];
    const demoRow = (title, body) => {
      const row = el("div", "demo-row");
      row.appendChild(el("div", "zone-title", title));
      row.appendChild(body);
      return row;
    };
    const strip = el("div", "mini-row");
    for (const id of picks) { const d = def(id); if (d) strip.appendChild(ui.renderCard(d.id)); }
    rootEl.appendChild(demoRow("Card component — Treasures, Victories, Curses, Actions", strip));
    const fan = el("div", "mini-row");
    fan.appendChild(renderHand({ hand: ["witch", "silver", "estate", "copper", "smithy", "gold", "curse"] }, null, null));
    rootEl.appendChild(demoRow("Hand fan (hover to enlarge)", fan));
    const sup = renderSupply({ supply: { copper: 60, silver: 40, gold: 30, estate: 8, duchy: 8, province: 8, curse: 8, witch: 10, market: 0 } }, null, null);
    rootEl.appendChild(demoRow("Supply piles — cost on the card, count badge, empty pile", sup));
  };

  /* ── rasterize a DOM subtree to a canvas (for the vision tool) ── */
  ui.capture = async function (targetEl) {
    const mod = await import("https://esm.sh/html2canvas@1.4.1");
    const html2canvas = mod.default || mod;
    const canvas = await html2canvas(targetEl || document.body, { backgroundColor: "#0a0f0d", scale: 1.5, logging: false });
    canvas.id = "shotCanvas";
    canvas.style.cssText = "position:fixed;left:0;bottom:0;z-index:99999;max-width:min(100vw,1400px);box-shadow:0 -2px 14px rgba(0,0,0,.6);";
    document.body.appendChild(canvas);
    return canvas;
  };

})(typeof self !== "undefined" ? self : globalThis);
