/* ══════════════════════════════════════════════════════════════
   ALL ABOARD! — app / game-screen layer (Tasks 23–30, 32–41)
   Loaded via <script src="src/app.js"> after board.js.
   Exposes window.App. Owns the TtR game screen: board canvas +
   player legend (23), face-up cards & deck with draw interactions
   (24), player panels (25), route-claim interaction (26), the
   action UI + move log + AI thinking states (27), ticket-keep /
   game-over / how-to-play modals (28), hotseat mode with privacy
   (29), the end-of-game flow (30), local save/load (32), undo
   last turn (33), and the online 2-player client (34-35) built
   on the BGN room server's `move`/`endGame`/`rematch`/`resign`/
   `claimWin` rpcs — the acting player's compact state snapshot is
   authoritative and both clients rehydrate from it.
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var TtR = window.TtR;
  var Board = window.Board;

  var AI_NAMES = ["Casey", "Piper", "Riley", "Duke"];

  var App = {
    state: null,
    mode: null,          // "ai" | "local" | "online"
    players: null,       // descriptors used to build the current game
    difficulty: "normal",
    log: [],
    busy: false,
    aiTimer: null,
    humanIds: [0],
    selected: null,      // routeId being considered for a claim
    selPay: null,        // chosen payment for the selected route
    undoStack: [],       // bounded pre-turn snapshots for undo (Task 33)
    lbSubmitted: false,  // leaderboard submitted once per game (Task 36)
    _firstTurn: false,   // suppress the "turn" sound on the very first go
    hintsOn: false,      // route-hint helper toggle (Task 40)
    rules: null,         // house rules (Task 44); null = official rules
    _daily: null,        // daily-challenge bookkeeping (Task 46)
    replay: [],          // per-turn snapshots for the replay viewer (Task 49)
    aiDelay: 380,        // AI think delay ms (Task 50); 0 = instant
    _challenge: null,    // challenge-code bookkeeping (Task 51)
    _skipSnap: false,    // undo sets this so beginTurn doesn't record a replay frame
    // online (Tasks 34-35)
    socket: null,
    sockOpen: false,
    wantReconnect: true,
    retryDelay: 800,
    roomCode: null,
    myRole: null,        // "host" | "guest"
    roomTurn: 0,         // server turn counter (from room snaps)
    oppPresent: false
  };

  var els = {};
  var deckEl = null;
  var OVERLAY_IDS = ["ttrTicketModal", "ttrOverModal", "ttrHelpModal", "ttrSetupModal"];
  ["ttrCtn", "ttrTurnEl", "ttrThinkEl", "ttrLegendEl", "ttrCardsCtn",
   "ttrBoardWrap", "boardCanvas", "ttrPanelsCtn", "ttrMenuBtn", "ttrHelpBtn",
   "ttrActionsCtn", "ttrLogEl", "ttrCostTipEl", "ttrToastEl",
   "ttrTicketModal", "ttrTicketTitle", "ttrTicketHint", "ttrTicketPicksCtn", "ttrTicketOkBtn",
   "ttrOverModal", "ttrOverTitle", "ttrOverTableEl", "ttrAgainBtn", "ttrRematchBtn", "ttrOverLobbyBtn",
   "ttrRecordEl", "ttrOverDetailsBtn", "ttrOverDetailsCtn",
   "ttrHelpModal", "ttrHelpCloseBtn", "ttrHelpBody",
   "ttrSetupModal", "ttrSetupCount", "ttrSetupCountLabel", "ttrSetupNamesCtn",
   "ttrSetupStartBtn", "ttrSetupCancelBtn",
   "ttrRuleDouble", "ttrRuleEnd", "ttrRuleStart",
   "ttrRoomEl", "ttrOppEl", "ttrUndoBtn", "ttrSaveBtn", "ttrForfeitBtn", "ttrClaimWinCtn",
   "ttrHintsBtn",
   "ttrWaitPanel", "ttrWaitCodeEl", "ttrWaitMsg", "ttrWaitCancelBtn",
   "ttrContinuePanel", "ttrContinueInfoEl", "ttrContinueBtn", "ttrDeleteSaveBtn",
   "ttrShareBtn", "ttrShareModal", "ttrShareImg", "ttrShareTextBtn", "ttrShareImgBtn", "ttrShareNativeBtn", "ttrShareCloseBtn",
   "ttrStatsBtn", "ttrStatsModal", "ttrStatsBody", "ttrStatsClearBtn", "ttrStatsCloseBtn",
   "ttrDailyPanel", "ttrDailyDateEl", "ttrDailyParEl", "ttrDailyBestEl", "ttrDailyBtn", "ttrDailyListEl",
   "ttrAchBtn", "ttrAchModal", "ttrAchBody", "ttrAchCloseBtn", "ttrAchResetBtn",
   "ttrHistBtn", "ttrHistModal", "ttrHistBody", "ttrHistCloseBtn", "ttrHistClearBtn",
   "ttrReplayBtn", "ttrReplayOverlay", "ttrReplayCanvas", "ttrReplayLabel", "ttrReplayScores",
   "ttrReplayPrevBtn", "ttrReplayNextBtn", "ttrReplayPlayBtn", "ttrReplayExitBtn",
   "ttrSkipBtn", "ttrAiSpeedEl",
   "ttrChalBtn", "ttrChalModal", "ttrChalInput", "ttrChalStartBtn", "ttrChalGenBtn", "ttrChalCloseBtn",
   "ttrChalNoteEl"].forEach(grab);
  function grab(id) { els[id] = document.getElementById(id); }
  try { App.hintsOn = localStorage.getItem("ttr_hints") === "1"; } catch (e) {}

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  // ── helpers ─────────────────────────────────────────────────────
  function diffLevel() {
    try { if (window.__bgn_ai_diff) return window.__bgn_ai_diff(); } catch (e) {}
    try { if (window.__t && window.__t.AI_DIFF) return window.__t.AI_DIFF; } catch (e) {}
    return "normal";
  }
  function aiOpponents() {
    var out = [];
    for (var i = 0; i < 3; i++) out.push({ name: AI_NAMES[i], kind: "ai" });
    return out;
  }
  function activePlayerId() {
    var s = App.state;
    return s && s.phase === "playing" ? s.turn.active : -1;
  }
  // ── online helpers (Tasks 34-35) ────────────────────────────────
  function isOnline() { return App.mode === "online"; }
  function myPid() { return App.myRole === "guest" ? 1 : 0; }   // host = player 0, guest = player 1
  function oppId() { return myPid() === 0 ? 1 : 0; }
  function lbName() {
    try { var n = localStorage.getItem("bgn_lb_name"); if (n && n.trim()) return n.trim().slice(0, 24); } catch (e) {}
    return App.myRole === "guest" ? "Guest" : "Host";
  }
  function turnRoleFor(n, first) { return ((n + (first ? 1 : 0)) % 2) === 0 ? "host" : "guest"; }
  function roomFirst() {
    try { if (window.__t && window.__t.game) return window.__t.game.first === 1 ? 1 : 0; } catch (e) {}
    return 0;
  }
  // BGN audio (Task 37): BGN.sfx.play(name) is provided by bgn-audio.js
  // ("draw","deal","flip","place","turn","tada","win","lose","draw2"…).
  // Note: index.html's local `sfx()` helper is IIFE-scoped, not global.
  function sfxPlay(name) {
    try { if (window.BGN && window.BGN.sfx) window.BGN.sfx.play(name); } catch (e) {}
  }
  // Leaderboard submit (Task 36): the BGN template's submitScore/getScores
  // + top-10 lobby modal already exist — this hooks TtR's game over into it.
  function submitLeaderboard(winnerIds) {
    if (!winnerIds || !winnerIds.length) return;
    if (App.lbSubmitted) return;
    App.lbSubmitted = true;
    if (isOnline() && App.myRole !== "host") return;   // online: only the host submits
    try {
      if (!window.__t || !window.__t.lbSubmitScore) return;
      var s = App.state, bd = s.gameEnd.breakdown;
      if (!bd) return;
      var w = winnerIds[0];
      var name = displayName(s.players[w]);
      var total = bd.players[w].total;
      // Task 46: daily-challenge games are tagged with the day so the
      // daily panel can filter the shared leaderboard for today's board.
      var extra = App._daily && App._daily.day === dailyDay() ? "d" + App._daily.day : (App.mode || "");
      window.__t.lbSubmitScore(name, total, extra);
    } catch (e) { console.error("leaderboard submit failed", e); }
  }

  // ── overlays & toasts ───────────────────────────────────────────
  function closeOverlays() {
    OVERLAY_IDS.forEach(function (id) { if (els[id]) els[id].hidden = true; });
  }
  function openOverlay(id) {
    closeOverlays();
    els[id].hidden = false;
  }
  var toastTimer = null;
  function toast(msg) {
    if (!els.ttrToastEl) return;
    els.ttrToastEl.textContent = msg;
    els.ttrToastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.ttrToastEl.hidden = true; }, 2400);
  }

  // ── ticket-keep dialog (Task 28) ────────────────────────────────
  var ticketCb = null, ticketSel = {}, ticketMinKeep = 1;
  function askTicketKeep(pending, minKeep, title, hint) {
    return new Promise(function (resolve) {
      ticketCb = resolve;
      ticketSel = {};
      ticketMinKeep = Math.max(1, minKeep || 1);
      els.ttrTicketTitle.textContent = title;
      els.ttrTicketHint.textContent = hint;
      els.ttrTicketOkBtn.disabled = true;
      renderTicketPicks(pending);
      openOverlay("ttrTicketModal");
    });
  }
  function renderTicketPicks(pending) {
    var s = App.state;
    els.ttrTicketPicksCtn.innerHTML = pending.map(function (tid) {
      var t = s.tickets[tid];
      return '<div class="ttr-tp" data-tid="' + tid + '" role="button" tabindex="0">' +
        '<span class="ttr-tp-cities">' + esc(t.a) + " – " + esc(t.b) + "</span>" +
        '<span class="ttr-tp-val">+' + t.value + "</span></div>";
    }).join("");
    els.ttrTicketPicksCtn.querySelectorAll(".ttr-tp").forEach(function (el) {
      el.addEventListener("click", function () { toggleTicketPick(el); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTicketPick(el); }
      });
    });
  }
  function toggleTicketPick(el) {
    var tid = el.dataset.tid;
    if (ticketSel[tid]) delete ticketSel[tid]; else ticketSel[tid] = 1;
    el.classList.toggle("on", !!ticketSel[tid]);
    els.ttrTicketOkBtn.disabled = Object.keys(ticketSel).length < ticketMinKeep;
  }
  function onTicketOk() {
    var keep = Object.keys(ticketSel);
    if (keep.length < ticketMinKeep) return;
    closeOverlays();
    var cb = ticketCb; ticketCb = null;
    if (cb) cb(keep);
  }
  // Begin a mid-game ticket draw: enter the action, deal, show dialog.
  function startTicketDrawFlow() {
    var s = App.state;
    if (s.turn.substate !== "drawingTickets") return;
    try { TtR.beginTicketDraw(s); } catch (e) {
      try { TtR.completeTurn(s); } catch (e2) {}
      App.beginTurn();
      return;
    }
    var pending = s.pendingTickets.slice();
    var minKeep = pending.length >= 3 ? 1 : 1;
    setBanner("Choose your tickets");
    App.renderAll();
    askTicketKeep(pending, minKeep, "Draw destination tickets",
      "Keep at least 1 of your " + pending.length + " destination ticket(s) — click the ones you want, then Keep.").then(function (keep) {
      var st = App.state;
      try {
        TtR.resolveTicketDraw(st, keep);
        sfxPlay("deal");
        addLog(st.players[st.turn.active].name, "kept " + keep.length + " destination ticket" + (keep.length === 1 ? "" : "s"));
      } catch (e) { console.error(e); }
      TtR.completeTurn(st);
      App.renderAll();
      App.beginTurn();
    });
  }

  // ── how-to-play modal (Task 28) ─────────────────────────────────
  var HELP_HTML = '<h2>How to play All Aboard!</h2>'
    + "<p>An adaptation of the classic <b>Ticket to Ride</b> North America map. Connect cities with trains to complete destination tickets and build the longest route.</p>"
    + "<h3>Setup</h3>"
    + "<p>Each player starts with <b>4 train cards</b> and keeps at least <b>2 of 3 destination tickets</b>. 45 trains each.</p>"
    + "<h3>Your turn</h3>"
    + "<p>Choose exactly one of three actions:</p>"
    + "<p><b>1. Draw train cards</b> — take up to 2 from the face-up row or the blind deck. Face-up <b>locomotives</b> count as your whole turn (1 card), and a locomotive just revealed can't be taken immediately.</p>"
    + "<p><b>2. Claim a route</b> — pick a route and pay its length in cards of one matching color (gray routes take <b>any</b> single color; locomotives are wildcards). You also spend that many trains. Route points: 1→1, 2→2, 3→4, 4→7, 5→10, 6→15.</p>"
    + "<p><b>3. Draw destination tickets</b> — take 3, keep at least 1. Completed tickets score their value at the end; unfinished tickets <b>subtract</b> it.</p>"
    + "<h3>Special rules</h3>"
    + "<p><b>Double routes</b> — with 2–3 players only one of each parallel pair may be claimed (a house rule can open both).</p>"
    + "<p><b>Game end</b> — the moment a player is down to ≤2 trains at the end of their turn, everyone else gets one final turn (the threshold is a house-rule option).</p>"
    + "<h3>Scoring</h3>"
    + "<p>Final score = route points + completed tickets − unfinished tickets + <b>longest-path bonus (10)</b>. Highest total wins; ties break by completed tickets, then longest path, then shared victory.</p>"
    + "<h3>Keyboard shortcuts</h3>" 
    + "<p><b>1</b> draw cards · <b>2</b> claim a route · <b>3</b> draw tickets · <b>Enter</b> confirm the selected claim · <b>Esc</b> cancel/close · <b>S</b> save · <b>U</b> undo · <b>H</b> hints</p>"
    + "<h3>Progress & extras</h3>"
    + "<p><b>🏅 Achievements</b>, <b>📜 History</b> and <b>📊 My stats</b> (lobby buttons) track your career. The game-over <b>▶ Replay</b> button re-watches any finished match, and <b>⏩ Finish</b> (shown during AI turns) jumps straight to the result.</p>"
    + "<p><b>🔢 Challenge codes</b> — enter the same code as a friend to play the identical seeded board and compare scores. The daily challenge is one such seeded board, regenerated every day.</p>"
    + '<button class="btn btn-gold" id="ttrHelpDoneBtn">Got it</button>';

  // ── game-over summary (Tasks 28, 30 & 41) ───────────────────────
  // Per-device personal records keyed by display name (Task 41).
  var RECORDS_KEY = "ttr_records";
  function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}; } catch (e) { return {}; } }
  function saveRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {} }
  function recordOwnerPid() {
    var s = App.state;
    if (!s) return -1;
    if (isOnline()) return myPid();
    for (var i = 0; i < s.players.length; i++) if (s.players[i].kind === "human") return i;
    return -1;
  }
  function updateRecords() {
    var s = App.state, bd = s.gameEnd.breakdown;
    if (!bd) return;
    var pid = recordOwnerPid();
    if (pid < 0) return;
    var recs = loadRecords();
    var totals = {}, wins = {};
    bd.ranked.forEach(function (p) { totals[p.playerId] = p.total; });
    bd.winners.forEach(function (w) { wins[w] = 1; });
    var name = displayName(s.players[pid]);
    var r = recs[name] || { games: 0, wins: 0, best: 0 };
    r.games++;
    if (wins[pid]) r.wins++;
    if (totals[pid] > r.best) r.best = totals[pid];
    recs[name] = r;
    saveRecords(recs);
  }
  function recordLine() {
    var s = App.state;
    var pid = recordOwnerPid();
    if (pid < 0) return "";
    var r = loadRecords()[displayName(s.players[pid])];
    if (!r) return "";
    return "🏅 " + displayName(s.players[pid]) + " — " + r.games + " game" + (r.games === 1 ? "" : "s") +
      " · " + r.wins + " win" + (r.wins === 1 ? "" : "s") + " · best " + r.best;
  }
  function buildOverDetails(bd) {
    var s = App.state;
    return bd.ranked.map(function (p) {
      var pl = s.players[p.playerId];
      var routes = pl.claimedRoutes.map(function (rid) {
        var r = s.routes[rid];
        return '<span class="ttr-det-route">' + esc(r.a) + "–" + esc(r.b) + "</span>";
      }).join(" ");
      var tickets = p.tickets.map(function (tk) {
        return '<div class="ttr-det-ticket ' + (tk.satisfied ? "ok" : "miss") + '">' +
          (tk.satisfied ? "✓" : "✗") + " " + esc(tk.a) + " – " + esc(tk.b) +
          " <b>" + (tk.satisfied ? "+" : "−") + tk.value + "</b></div>";
      }).join("");
      return '<div class="ttr-det-block">' +
        '<div class="ttr-det-head">' + esc(displayName(pl)) + " · " + p.total + " pts · longest path " + p.longestPathLength + " trains</div>" +
        (routes ? '<div class="ttr-det-routes">' + routes + "</div>" : '<div class="ttr-det-empty">No routes claimed</div>') +
        (tickets ? '<div class="ttr-det-tickets">' + tickets + "</div>" : '<div class="ttr-det-empty">No tickets</div>') +
        "</div>";
    }).join("");
  }
  function toggleOverDetails() {
    var open = els.ttrOverDetailsCtn.hidden;
    if (open && !els.ttrOverDetailsCtn.dataset.built) {
      var bd = App.state && App.state.gameEnd && App.state.gameEnd.breakdown;
      if (bd) {
        els.ttrOverDetailsCtn.innerHTML = buildOverDetails(bd);
        els.ttrOverDetailsCtn.dataset.built = "1";
      }
    }
    els.ttrOverDetailsCtn.hidden = !open;
    if (els.ttrOverDetailsBtn) els.ttrOverDetailsBtn.textContent = open ? "Hide details" : "Show details";
  }

  // ── career statistics (Task 42) ─────────────────────────────────
  var STATS_KEY = "ttr_stats";
  function loadStats() { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; } }
  function saveStats(st) { try { localStorage.setItem(STATS_KEY, JSON.stringify(st)); } catch (e) {} }
  // Lifetime per-name stats, updated after every completed game for each
  // human player at the table.
  function updateStats() {
    var s = App.state, bd = s.gameEnd.breakdown;
    if (!bd) return;
    var stats = loadStats();
    bd.players.forEach(function (p) {
      var pl = s.players[p.playerId];
      if (pl.kind !== "human") return;
      var st = stats[p.name] || { games: 0, wins: 0, totalScore: 0, bestScore: 0,
        routesClaimed: 0, ticketsDrawn: 0, ticketsDone: 0, longestRoute: 0, longestPathEver: 0 };
      st.games++;
      if (bd.winners.indexOf(p.playerId) !== -1) st.wins++;
      st.totalScore += p.total;
      if (p.total > st.bestScore) st.bestScore = p.total;
      st.routesClaimed += pl.claimedRoutes.length;
      st.ticketsDrawn += pl.ticketIds.length;
      var done = p.tickets.filter(function (tk) { return tk.satisfied; }).length;
      st.ticketsDone += done;
      pl.claimedRoutes.forEach(function (rid) {
        if (s.routes[rid].length > st.longestRoute) st.longestRoute = s.routes[rid].length;
      });
      if (p.longestPathLength > st.longestPathEver) st.longestPathEver = p.longestPathLength;
      stats[p.name] = st;
    });
    saveStats(stats);
  }
  function openStats() {
    var stats = loadStats();
    var names = Object.keys(stats).sort(function (a, b) { return (stats[b].totalScore / Math.max(1, stats[b].games)) - (stats[a].totalScore / Math.max(1, stats[a].games)); });
    if (!names.length) {
      els.ttrStatsBody.innerHTML = '<p class="muted small" style="padding:14px 4px">No games finished yet — play a match to start building your career stats.</p>';
    } else {
      var rows = ['<div class="ttr-stats-row hd"><span>Player</span><span>Games</span><span>Wins</span><span>Win%</span><span>Avg</span><span>Best</span><span>Routes</span><span>Tickets ✓</span><span>Longest route</span><span>Longest path</span></div>'];
      names.forEach(function (nm) {
        var st = stats[nm];
        rows.push('<div class="ttr-stats-row"><span class="nm">' + esc(nm) + '</span>' +
          '<span>' + st.games + '</span>' +
          '<span>' + st.wins + '</span>' +
          '<span>' + Math.round(100 * st.wins / st.games) + '%</span>' +
          '<span>' + Math.round(st.totalScore / st.games) + '</span>' +
          '<span>' + st.bestScore + '</span>' +
          '<span>' + st.routesClaimed + '</span>' +
          '<span>' + st.ticketsDone + '/' + st.ticketsDrawn + '</span>' +
          '<span>' + st.longestRoute + '</span>' +
          '<span>' + st.longestPathEver + '</span></div>');
      });
      els.ttrStatsBody.innerHTML = rows.join("");
    }
    openOverlay("ttrStatsModal");
  }
  function clearStats() {
    try { localStorage.removeItem(STATS_KEY); } catch (e) {}
    toast("Career stats cleared.");
    openStats();
  }

  // ── shareable result card (Task 45) ─────────────────────────────
  function buildShareText(bd) {
    var s = App.state;
    var lines = ["🚂 ALL ABOARD! — Ticket to Ride (North America)",
      new Date().toLocaleDateString(),
      "─────────────────────"];
    bd.ranked.forEach(function (p) {
      lines.push((p.winner ? "🥇 " : (p.rank === 2 ? "🥈 " : p.rank === 3 ? "🥉 " : "   ")) +
        p.name + " — " + p.total + " pts" + (p.winner ? " 👑" : ""));
    });
    var lp = bd.players.filter(function (p) { return p.longestPathPoints > 0; }).map(function (p) { return p.name; });
    if (lp.length) lines.push("🚂 Longest path: " + lp.join(" & ") + " (+10)");
    if (App._challenge) lines.push("🔢 Challenge " + App._challenge.code + " — enter the code to replay this exact board");
    lines.push("─────────────────────");
    lines.push("Play on Perchance: https://perchance.org/" + (window.generatorName || "all-aboard"));
    return lines.join("\n");
  }
  function drawShareCard(bd) {
    var W = 1200, H = 630;
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var ctx = cv.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#241d2e"); g.addColorStop(1, "#14111c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(224,165,58,0.55)"; ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, W - 32, H - 32);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#e0a53a";
    ctx.font = "800 64px Georgia, serif";
    ctx.fillText("ALL ABOARD!", 70, 110);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 26px Georgia, serif";
    ctx.fillText("Ticket to Ride — North America · " + new Date().toLocaleDateString(), 70, 158);
    var y = 240;
    ctx.font = "700 40px Georgia, serif";
    bd.ranked.forEach(function (p) {
      ctx.fillStyle = p.winner ? "#ffd45e" : "rgba(255,255,255,0.92)";
      var rank = p.rank === 1 ? "🥇" : p.rank === 2 ? "🥈" : p.rank === 3 ? "🥉" : p.rank + ".";
      ctx.fillText(rank + "  " + p.name + (p.winner ? "  👑" : ""), 70, y);
      ctx.textAlign = "right";
      ctx.fillText(p.total + " pts", W - 70, y);
      ctx.textAlign = "left";
      y += 56;
    });
    var lp = bd.players.filter(function (p) { return p.longestPathPoints > 0; }).map(function (p) { return p.name; });
    if (lp.length) {
      ctx.fillStyle = "rgba(224,165,58,0.9)";
      ctx.font = "600 26px Georgia, serif";
      ctx.fillText("🚂 Longest path: " + lp.join(" & ") + "  (+10)", 70, y + 18);
    }
    ctx.strokeStyle = "rgba(224,165,58,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(70, H - 96); ctx.lineTo(W - 70, H - 96); ctx.stroke();
    ctx.fillStyle = "rgba(224,165,58,0.8)";
    ctx.font = "600 24px Georgia, serif";
    ctx.fillText("🚂 Play on Perchance — " + (window.generatorName || "all-aboard"), 70, H - 60);
    return cv;
  }
  function openShare() {
    var s = App.state;
    if (!s || !s.gameEnd || !s.gameEnd.breakdown) return;
    var bd = s.gameEnd.breakdown;
    var cv = drawShareCard(bd);
    if (els.ttrShareImg) els.ttrShareImg.src = cv.toDataURL("image/png");
    App._shareText = buildShareText(bd);
    openOverlay("ttrShareModal");
  }
  function copyShareText() {
    var txt = App._shareText || "";
    function done(ok) { toast(ok ? "Result copied to clipboard." : "Copy failed — your browser blocked it."); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { done(false); });
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = txt; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
        done(true);
      } catch (e) { done(false); }
    }
  }
  function downloadShareImg() {
    var img = els.ttrShareImg;
    if (!img || !img.src) return;
    var a = document.createElement("a");
    a.href = img.src;
    a.download = "all-aboard-result.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  function nativeShare() {
    if (!navigator.share) { toast("Web Share isn't available on this device — use Copy or Download."); return; }
    navigator.share({ title: "All Aboard! result", text: App._shareText || "" }).catch(function () {});
  }

  // ── daily challenge (Task 46) ───────────────────────────────────
  // One deterministic seed per UTC day, so everyone sees the same board.
  // Scores go through the BGN shared leaderboard tagged with the day
  // ("d<dayIndex>") — the lobby panel filters getScoresAll for today.
  var DAILY_KEY = "ttr_daily";
  var DAILY_PAR = 120;   // a par target you can try to beat (see showResult)
  function dailyDay() { return Math.floor(Date.now() / 86400000); }
  function loadDaily() { try { return JSON.parse(localStorage.getItem(DAILY_KEY)) || {}; } catch (e) { return {}; } }
  function saveDaily(d) { try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch (e) {} }
  function startDaily() {
    var day = dailyDay();
    App._daily = { day: day, seed: day };
    App.rules = null;   // official rules for the challenge
    startGame("ai", [{ name: "You", kind: "human" }].concat(aiOpponents()), { seed: day });
  }
  function dailyRenderList(entries) {
    var el = els.ttrDailyListEl;
    if (!el) return;
    var day = dailyDay();
    var tag = "d" + day;
    var rows = (entries || []).filter(function (x) { return x.extra === tag; })
      .sort(function (a, b) { return b.score - a.score || a.ts - b.ts; })
      .slice(0, 10);
    if (!rows.length) {
      el.innerHTML = '<p class="muted small">No scores on today\'s board yet — finish the challenge to be the first!</p>';
    } else {
      el.innerHTML = rows.map(function (r, i) {
        return '<div class="ttr-daily-row' + (i === 0 ? " top" : "") + '"><span class="rk">' + (i + 1) + "</span>" +
          '<span class="nm">' + esc(r.name || "Anonymous") + "</span>" +
          '<span class="sc">' + r.score + " pts</span></div>";
      }).join("");
    }
  }
  function refreshDailyList() {
    try {
      if (window.__t && window.__t.lbGetScoresAll) {
        window.__t.lbGetScoresAll(dailyRenderList);
        return;
      }
    } catch (e) {}
    // window.__t is defined by the template's script AFTER app.js runs —
    // retry until it exists.
    setTimeout(refreshDailyList, 800);
  }
  function refreshDailyPanel() {
    var panel = els.ttrDailyPanel;
    if (!panel) return;
    var day = dailyDay();
    if (els.ttrDailyDateEl) els.ttrDailyDateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    if (els.ttrDailyParEl) els.ttrDailyParEl.textContent = "Par " + DAILY_PAR;
    var d = loadDaily();
    var best = d[String(day)];
    if (els.ttrDailyBestEl) els.ttrDailyBestEl.textContent = best != null ? "Your best today: " + best + " pts" : "You haven't played today's challenge yet";
    refreshDailyList();
  }
  // Handle a finished daily-challenge game: update the local best (the
  // leaderboard submit in showResult carries today's day tag).
  function dailyResult() {
    var s = App.state;
    if (!s.gameEnd || !s.gameEnd.breakdown) return;
    var pid = -1;
    for (var i = 0; i < s.players.length; i++) if (s.players[i].kind === "human") { pid = i; break; }
    if (pid < 0) return;
    var bd = s.gameEnd.breakdown;
    var total = bd.players[pid].total;
    var day = dailyDay();
    var d = loadDaily();
    var prev = d[String(day)];
    if (prev == null || total > prev) {
      d[String(day)] = total;
      saveDaily(d);
      toast("🏆 New daily best: " + total + " pts!");
    } else {
      toast("Daily challenge complete — " + total + " pts (best " + prev + ").");
    }
    refreshDailyPanel();
    setTimeout(refreshDailyList, 2500);   // let the submit land first
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 13 — progress, replay & advanced modes (Tasks 47–51)
  // ═══════════════════════════════════════════════════════════════

  // ── 47. Achievements ───────────────────────────────────────────
  var ACH_KEY = "ttr_ach";
  var ACH = [
    { id: "first_game", icon: "🚂", name: "First steps", desc: "Finish your first game" },
    { id: "first_win", icon: "🥇", name: "First victory", desc: "Win a game" },
    { id: "win5", icon: "🎖️", name: "Rail baron", desc: "Win 5 games" },
    { id: "win25", icon: "👑", name: "Rail empire", desc: "Win 25 games" },
    { id: "first_route", icon: "🛤️", name: "On the rails", desc: "Claim your first route" },
    { id: "routes50", icon: "🚆", name: "Track layer", desc: "Claim 50 routes in total" },
    { id: "longest", icon: "📏", name: "Long haul", desc: "Earn the longest-path bonus" },
    { id: "ticket3", icon: "🎟️", name: "Ticket master", desc: "Complete 3 tickets in one game" },
    { id: "high200", icon: "💯", name: "Century club", desc: "Score 200+ in one game" },
    { id: "marathon", icon: "🛋️", name: "Full table", desc: "Finish a 5-player local game" },
    { id: "daily", icon: "🗓️", name: "Daily rider", desc: "Finish a daily challenge" },
    { id: "sharer", icon: "📤", name: "Show-off", desc: "Share a result card" }
  ];
  function loadAch() { try { return JSON.parse(localStorage.getItem(ACH_KEY)) || {}; } catch (e) { return {}; } }
  function saveAch(a) { try { localStorage.setItem(ACH_KEY, JSON.stringify(a)); } catch (e) {} }
  function unlockAch(id) {
    var a = loadAch();
    if (a[id]) return false;
    a[id] = { at: Date.now() };
    saveAch(a);
    var meta = null;
    ACH.forEach(function (x) { if (x.id === id) meta = x; });
    toast("🏅 Achievement unlocked: " + (meta ? meta.name : id));
    return true;
  }
  // Evaluate every achievement against the just-finished game + career stats.
  function checkAchievements() {
    var s = App.state, bd = s.gameEnd.breakdown;
    if (!bd) return;
    var stats = loadStats();
    var agg = { games: 0, wins: 0, routes: 0 };
    for (var k in stats) {
      agg.games += stats[k].games; agg.wins += stats[k].wins; agg.routes += stats[k].routesClaimed;
    }
    var humanIds = {};
    s.players.forEach(function (pl, i) { if (pl.kind === "human") humanIds[i] = 1; });
    var humanLp = false, humanTickets = 0, humanHigh = 0;
    bd.players.forEach(function (p) {
      if (humanIds[p.playerId]) {
        if (p.longestPathPoints > 0) humanLp = true;
        var done = p.tickets.filter(function (t) { return t.satisfied; }).length;
        if (done > humanTickets) humanTickets = done;
        if (p.total > humanHigh) humanHigh = p.total;
      }
    });
    var want = [];
    if (agg.games >= 1) want.push("first_game");
    if (agg.wins >= 1) want.push("first_win");
    if (agg.wins >= 5) want.push("win5");
    if (agg.wins >= 25) want.push("win25");
    if (agg.routes >= 1) want.push("first_route");
    if (agg.routes >= 50) want.push("routes50");
    if (humanLp) want.push("longest");
    if (humanTickets >= 3) want.push("ticket3");
    if (humanHigh >= 200) want.push("high200");
    if (App.mode === "local" && s.players.length === 5) want.push("marathon");
    if (App._daily && App._daily.day === dailyDay()) want.push("daily");
    want.forEach(unlockAch);
  }
  function renderAchBody() {
    var a = loadAch();
    els.ttrAchBody.innerHTML = '<div class="ttr-ach-grid">' + ACH.map(function (x) {
      var got = a[x.id];
      return '<div class="ttr-ach' + (got ? "" : " locked") + '" title="' + esc(x.desc) + '">' +
        '<span class="ttr-ach-icon">' + x.icon + "</span>" +
        '<span class="ttr-ach-name">' + esc(x.name) + "</span>" +
        '<span class="ttr-ach-desc">' + esc(x.desc) + "</span>" +
        (got ? '<span class="ttr-ach-date">' + new Date(got.at).toLocaleDateString() + "</span>" : "") +
        "</div>";
    }).join("") + "</div>";
  }
  function openAch() { renderAchBody(); openOverlay("ttrAchModal"); }
  function clearAch() {
    try { localStorage.removeItem(ACH_KEY); } catch (e) {}
    toast("Achievements reset.");
    renderAchBody();
  }

  // ── 48. Game history archive ───────────────────────────────────
  var HIST_KEY = "ttr_history";
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch (e) { return []; } }
  function saveHistory(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) {} }
  function pushHistory() {
    var s = App.state, bd = s.gameEnd.breakdown;
    if (!bd) return;
    var h = loadHistory();
    h.unshift({
      ts: Date.now(),
      mode: App.mode || "local",
      players: s.players.map(function (p) { return p.name; }),
      winners: bd.winners.map(function (w) { return s.players[w].name; }),
      ranked: bd.ranked.map(function (p) { return { name: p.name, total: p.total, rank: p.rank, winner: p.winner }; })
    });
    if (h.length > 50) h.length = 50;
    saveHistory(h);
  }
  function openHistory() {
    var h = loadHistory();
    var el = els.ttrHistBody;
    if (!h.length) {
      el.innerHTML = '<p class="muted small" style="padding:14px 4px">No finished games yet — your completed matches will appear here.</p>';
    } else {
      el.innerHTML = h.map(function (e) {
        var date = new Date(e.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
          " · " + new Date(e.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        var modeTxt = e.mode === "ai" ? "vs AI" : e.mode === "online" ? "online" : "local";
        var rows = e.ranked.map(function (p) {
          return '<div class="ttr-hist-row' + (p.winner ? " win" : "") + '">' +
            '<span class="rk">' + p.rank + "</span>" +
            '<span class="nm">' + esc(p.name) + (p.winner ? " 👑" : "") + "</span>" +
            '<span class="sc">' + p.total + " pts</span></div>";
        }).join("");
        return '<div class="ttr-hist-entry"><div class="ttr-hist-head">' +
          "<span>" + esc(date) + "</span><span class=\"mode\">" + modeTxt + "</span></div>" + rows + "</div>";
      }).join("");
    }
    openOverlay("ttrHistModal");
  }

  // ── 49. Replay viewer ──────────────────────────────────────────
  var REPLAY_CAP = 300;
  function snapReplay() {
    var s = App.state;
    if (!s || s.phase !== "playing" || isOnline()) return;
    if (App.replay.length >= REPLAY_CAP) App.replay.shift();
    App.replay.push(TtR.cloneState(s));
  }
  var replayState = null;   // { frames, idx, live, timer }
  function openReplay() {
    if (isOnline() || !App.replay || App.replay.length < 2) { toast("Not enough moves recorded for a replay."); return; }
    closeOverlays();
    replayState = { frames: App.replay.slice(), idx: App.replay.length - 1, live: App.state, timer: null };
    els.ttrReplayOverlay.hidden = false;
    renderReplayFrame();
  }
  function renderReplayFrame() {
    if (!replayState) return;
    var s = replayState.frames[replayState.idx];
    Board.render(els.ttrReplayCanvas, s, {});
    var i = replayState.idx, n = replayState.frames.length;
    if (els.ttrReplayLabel) els.ttrReplayLabel.textContent = "Turn " + (i + 1) + " / " + n;
    var scores = s.players.map(function (pl) {
      return '<span style="color:' + TtR.PLAYER_COLORS[pl.colorIndex] + '"><b>' + esc(pl.name) + "</b> " +
        pl.score + " pts · " + pl.trains + " trains</span>";
    }).join(" ");
    if (els.ttrReplayScores) els.ttrReplayScores.innerHTML = scores;
  }
  function replayStep(d) {
    if (!replayState) return;
    replayState.idx = Math.max(0, Math.min(replayState.frames.length - 1, replayState.idx + d));
    renderReplayFrame();
  }
  function replayTogglePlay() {
    if (!replayState) return;
    if (replayState.timer) {
      clearInterval(replayState.timer); replayState.timer = null;
      if (els.ttrReplayPlayBtn) els.ttrReplayPlayBtn.textContent = "▶ Play";
      return;
    }
    replayState.timer = setInterval(function () {
      if (!replayState) return;
      if (replayState.idx >= replayState.frames.length - 1) { replayTogglePlay(); return; }
      replayStep(1);
    }, 650);
    if (els.ttrReplayPlayBtn) els.ttrReplayPlayBtn.textContent = "⏸ Pause";
  }
  function exitReplay() {
    if (replayState && replayState.timer) clearInterval(replayState.timer);
    replayState = null;
    if (els.ttrReplayOverlay) els.ttrReplayOverlay.hidden = true;
  }

  // ── 50. AI speed + skip to end ─────────────────────────────────
  var AI_SPEEDS = { slow: 900, normal: 380, fast: 120, instant: 0 };
  function aiDelay() { return typeof App.aiDelay === "number" ? App.aiDelay : 380; }
  function setAiSpeed(speed) {
    App.aiDelay = AI_SPEEDS[speed] != null ? AI_SPEEDS[speed] : 380;
    try { localStorage.setItem("ttr_aiSpeed", speed); } catch (e) {}
    if (els.ttrAiSpeedEl) els.ttrAiSpeedEl.value = speed;
    toast("AI speed: " + speed);
  }
  function loadAiSpeedPref() {
    try {
      var v = localStorage.getItem("ttr_aiSpeed");
      if (v && AI_SPEEDS[v] != null) { App.aiDelay = AI_SPEEDS[v]; return v; }
    } catch (e) {}
    return "normal";
  }
  function skipToEnd() {
    var s = App.state;
    if (!s || s.phase !== "playing") return;
    if (isOnline()) return;
    if (s.players[s.turn.active].kind !== "ai") { toast("Finish is available while an AI is thinking."); return; }
    if (App.aiTimer) { clearTimeout(App.aiTimer); App.aiTimer = null; }
    App.busy = true;
    var guard = 0;
    while (App.state && App.state.phase === "playing" && guard++ < 6000 &&
           App.state.players[App.state.turn.active].kind === "ai") {
      runAiStep();
      if (App.aiTimer) { clearTimeout(App.aiTimer); App.aiTimer = null; }
    }
    App.busy = false;
    if (App.state && App.state.phase === "playing") App.beginTurn();
  }
  function showSkipBtn() {
    var el = els.ttrSkipBtn;
    if (!el) return;
    var s = App.state;
    var show = !isOnline() && App.mode === "ai" && s && s.phase === "playing" &&
      s.players[s.turn.active].kind === "ai";
    el.hidden = !show;
  }

  // ── 51. Challenge codes ────────────────────────────────────────
  // A 6-character code (base-31: no 0/O/1/I/L) encodes a PRNG seed, so
  // anyone entering the same code plays the exact same board.
  var CHAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function normCode(c) {
    return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      .replace(/[O0]/g, "A").replace(/[IL1]/g, "J").slice(0, 6);
  }
  function codeFromSeed(seed) {
    seed = Math.abs(Math.floor(seed)) % 887503681;
    var out = "";
    for (var i = 0; i < 6; i++) {
      out = CHAL_ALPHABET[seed % CHAL_ALPHABET.length] + out;
      seed = Math.floor(seed / CHAL_ALPHABET.length);
    }
    return out;
  }
  function seedFromCode(code) {
    code = normCode(code);
    if (code.length < 4) return null;
    var seed = 0;
    for (var i = 0; i < code.length; i++) {
      var d = CHAL_ALPHABET.indexOf(code[i]);
      if (d === -1) return null;
      seed = seed * CHAL_ALPHABET.length + d;
    }
    return seed;
  }
  function startChallenge(code) {
    var seed = seedFromCode(code);
    if (seed == null) { toast("That challenge code isn't valid (use the 🔢 button or letters A-Z, 2-9)."); return; }
    var c = codeFromSeed(seed);
    App.rules = null;   // official rules, like the daily
    startGame("ai", [{ name: "You", kind: "human" }].concat(aiOpponents()), { seed: seed, challenge: { code: c, seed: seed } });
  }
  function openChallenge() {
    if (els.ttrChalInput) els.ttrChalInput.value = codeFromSeed(Math.floor(Math.random() * 0x7fffffff));
    openOverlay("ttrChalModal");
  }
  function onChallengeStart() {
    startChallenge(els.ttrChalInput ? els.ttrChalInput.value : "");
  }

  function buildOverTable(bd) {
    var winners = bd.winners.map(function (w) { return App.state.players[w].name; });
    els.ttrOverTitle.textContent = "🏁 " + winners.join(" & ") + " win!";
    var rows = ['<div class="ttr-over-row hd"><span>#</span><span>Player</span><span>Routes</span><span>Tickets</span><span>Longest</span><span>Total</span></div>'];
    bd.ranked.forEach(function (p) {
      var t = p.ticketPoints >= 0 ? "+" + p.ticketPoints : p.ticketPoints;
      rows.push('<div class="ttr-over-row' + (p.winner ? " win" : "") + '">' +
        '<span>' + p.rank + '</span>' +
        '<span class="nm">' + esc(p.name) + (p.winner ? " 👑" : "") + "</span>" +
        '<span>' + p.routePoints + "</span>" +
        '<span class="' + (p.ticketPoints < 0 ? "neg" : "") + '">' + t + "</span>" +
        '<span>' + (p.longestPathPoints ? "+10" : "—") + "</span>" +
        '<span class="tot">' + p.total + "</span></div>");
    });
    var lp = bd.players.filter(function (p) { return p.longestPathPoints > 0; })
      .map(function (p) { return p.name; });
    if (lp.length) rows.push('<div class="ttr-over-note">🚂 Longest path: ' + esc(lp.join(" & ")) + " (+10 each)</div>");
    els.ttrOverTableEl.innerHTML = rows.join("");
  }
  function showResult() {
    var s = App.state, bd = s.gameEnd.breakdown;
    if (!bd) return;
    var names = bd.winners.map(function (w) { return displayName(s.players[w]); });
    setThinking(false);
    setBanner("🏁 Game over — " + names.join(" & ") + " win!");
    if (els.ttrAgainBtn) els.ttrAgainBtn.hidden = isOnline();
    if (els.ttrRematchBtn) els.ttrRematchBtn.hidden = !isOnline();
    buildOverTable(bd);
    updateRecords();
    updateStats();          // Task 42: lifetime career stats
    checkAchievements();    // Task 47: badges
    pushHistory();          // Task 48: game archive
    var rec = recordLine();
    if (els.ttrRecordEl) { els.ttrRecordEl.hidden = !rec; if (rec) els.ttrRecordEl.textContent = rec; }
    if (els.ttrOverDetailsBtn) { els.ttrOverDetailsBtn.hidden = false; els.ttrOverDetailsBtn.textContent = "Show details"; }
    if (els.ttrOverDetailsCtn) { els.ttrOverDetailsCtn.hidden = true; delete els.ttrOverDetailsCtn.dataset.built; }
    if (els.ttrShareBtn) els.ttrShareBtn.hidden = false;
    if (els.ttrReplayBtn) els.ttrReplayBtn.hidden = isOnline() || App.replay.length < 2;   // Task 49
    if (els.ttrChalNoteEl) {   // Task 51
      var showChal = !!App._challenge;
      els.ttrChalNoteEl.hidden = !showChal;
      if (showChal) els.ttrChalNoteEl.textContent = "🔢 Challenge " + App._challenge.code +
        " — everyone who enters this code plays the same board. Share it!";
    }
    openOverlay("ttrOverModal");
    App.renderAll();
    if (App._daily && App._daily.day === dailyDay()) dailyResult();   // Task 46
    // Task 36: submit the winner to the shared leaderboard.
    submitLeaderboard(bd.winners);
    // Task 37: end-of-game sound.
    if (isOnline()) {
      if (bd.winners.length === s.players.length) sfxPlay("draw2");
      else if (bd.winners.indexOf(myPid()) !== -1) sfxPlay("win");
      else sfxPlay("lose");
    } else {
      var humanWin = bd.winners.some(function (w) { return s.players[w].kind === "human"; });
      sfxPlay(humanWin ? "tada" : "lose");
    }
    if (!isOnline()) { deleteTtrSave(); refreshTtrContinuePanel(); }
  }

  // ── game start (async: humans pick setup tickets via dialog) ────
  async function startGame(mode, playersOpt, extra) {
    if (App.aiTimer) { clearTimeout(App.aiTimer); App.aiTimer = null; }
    closeOverlays();
    App.mode = mode;
    App.difficulty = diffLevel();
    App.log = [];
    App.selected = null;
    App.selPay = null;
    App.busy = false;
    App.replay = [];
    App._challenge = (extra && extra.challenge) || null;   // Task 51
    var players = playersOpt && playersOpt.length
      ? playersOpt
      : (mode === "ai" ? [{ name: "You", kind: "human" }].concat(aiOpponents()) : undefined);
    if (!players) players = [{ name: "Player 1", kind: "human" }, { name: "Player 2", kind: "human" }];
    App.players = players;
    var seed = (extra && typeof extra.seed === "number") ? extra.seed : Math.floor(Math.random() * 0x7fffffff);
    var rules = (extra && extra.rules) || App.rules || null;
    var s = TtR.newGame({ seed: seed, players: players, rules: rules });
    App.state = s;
    App.humanIds = [];
    s.players.forEach(function (pl, i) { if (pl.kind === "human") App.humanIds.push(i); });
    document.getElementById("lobbyCtn").hidden = true;
    document.getElementById("gameCtn").hidden = true;
    els.ttrCtn.hidden = false;
    App.renderAll();
    // Opening ticket dealing around the table (keep ≥ startTickets of 3).
    var startKeep = (s.rules && s.rules.startTickets) || 2;
    for (var p = 0; p < s.players.length; p++) {
      if (s.turn.active !== p) break;
      TtR.enterAction(s, "drawingTickets");
      TtR.beginTicketDraw(s);
      var pending = s.pendingTickets.slice();
      var keep;
      if (s.players[p].kind === "ai") {
        keep = aiOpeningKeep(s, p, startKeep);
      } else {
        var minKeep = Math.min(pending.length, startKeep);
        keep = await askTicketKeep(pending, minKeep,
          s.players[p].name + " — keep your tickets",
          "Keep at least " + minKeep + " of your " + pending.length + " destination ticket(s). Click to select, then Keep.");
      }
      TtR.resolveTicketDraw(s, keep);
      TtR.completeTurn(s);
      App.renderAll();
    }
    App._firstTurn = false;
    App.lbSubmitted = false;
    sfxPlay("deal");
    App.beginTurn();
  }

  // Opening-deal keep for AI opponents: the AI's own preferences, padded
  // up to the house-rule minimum (official = keep ≥2 of 3, Task 44).
  function aiOpeningKeep(s, pid, minKeep) {
    var keep = TtR.aiChooseTicketKeep(s, pid, App.difficulty);
    while (keep.length < minKeep) {
      var best = null, bestV = -1;
      s.pendingTickets.forEach(function (tid) {
        if (keep.indexOf(tid) === -1 && s.tickets[tid].value > bestV) { bestV = s.tickets[tid].value; best = tid; }
      });
      if (best == null) break;
      keep.push(best);
    }
    return keep;
  }

  function exitToLobby() {
    if (isOnline()) {
      if (App.socket && App.sockOpen && App.roomCode) onlineRpc("leave", App.roomCode).catch(function () {});
      exitOnline(true);
      refreshTtrContinuePanel();
      return;
    }
    saveGame();
    if (App.aiTimer) { clearTimeout(App.aiTimer); App.aiTimer = null; }
    closeOverlays();
    App.state = null;
    App.undoStack = [];
    els.ttrCtn.hidden = true;
    document.getElementById("lobbyCtn").hidden = false;
    refreshTtrContinuePanel();
  }

  // ── save & load (Task 32) ───────────────────────────────────────
  // Full state (catalogs included) is persisted locally with toJSON so
  // a restored game resumes identically — hands, deck order, seeded
  // PRNG state and all.
  var TTR_SAVE_KEY = "bgn_ttr_save";
  function saveGame() {
    var s = App.state;
    if (!s || isOnline() || s.phase === "gameOver") return false;
    if (s.turn.substate !== "chooseAction" || ticketCb) return false;  // only at turn boundaries
    try {
      localStorage.setItem(TTR_SAVE_KEY, JSON.stringify({
        v: 1, mode: App.mode, difficulty: App.difficulty, players: App.players,
        state: TtR.toJSON(s), log: App.log, savedAt: Date.now()
      }));
      return true;
    } catch (e) { return false; }
  }
  function hasTtrSave() {
    try { var o = JSON.parse(localStorage.getItem(TTR_SAVE_KEY)); return !!(o && o.state); } catch (e) { return false; }
  }
  function deleteTtrSave() { try { localStorage.removeItem(TTR_SAVE_KEY); } catch (e) {} }
  function refreshTtrContinuePanel() {
    var on = hasTtrSave();
    if (els.ttrContinuePanel) els.ttrContinuePanel.hidden = !on;
    if (on && els.ttrContinueInfoEl) {
      try {
        var o = JSON.parse(localStorage.getItem(TTR_SAVE_KEY));
        var when = o.savedAt ? new Date(o.savedAt).toLocaleTimeString() : "recently";
        var s = TtR.fromJSON(o.state);
        var at = s.players[s.turn.active].name + "'s turn";
        els.ttrContinueInfoEl.textContent = "Saved " + when + " · " + (o.mode === "ai" ? "vs AI" : "local table") + " · " + at + ".";
      } catch (e) { els.ttrContinueInfoEl.textContent = "A saved game was found."; }
    }
  }
  function continueGame() {
    var o;
    try { o = JSON.parse(localStorage.getItem(TTR_SAVE_KEY)); } catch (e) { o = null; }
    if (!o || !o.state) { toast("No saved game found."); return; }
    var s;
    try { s = TtR.fromJSON(o.state); } catch (e) { toast("That save is corrupted."); deleteTtrSave(); refreshTtrContinuePanel(); return; }
    if (App.aiTimer) { clearTimeout(App.aiTimer); App.aiTimer = null; }
    closeOverlays();
    App.mode = o.mode === "ai" ? "ai" : "local";
    App.difficulty = o.difficulty || "normal";
    App.players = o.players || null;
    App.log = Array.isArray(o.log) ? o.log : [];
    App.state = s;
    App.undoStack = [];
    App.busy = false;
    App.humanIds = [];
    s.players.forEach(function (pl, i) { if (pl.kind === "human") App.humanIds.push(i); });
    document.getElementById("lobbyCtn").hidden = true;
    els.ttrCtn.hidden = false;
    App.renderAll();
    if (s.phase === "gameOver") { showResult(); return; }
    if (s.pendingTickets.length && s.turn.substate === "drawingTickets" && s.players[s.turn.active].kind === "human") {
      resumeTicketDialog();
      return;
    }
    beginTurn();
  }

  // ── undo last turn (Task 33) ────────────────────────────────────
  // Bounded pre-turn snapshots; one snapshot per completed action
  // (card draws, route claims, ticket draws). Local/AI games only.
  function pushUndo() {
    if (isOnline() || !App.state) return;
    App.undoStack.push({ state: TtR.cloneState(App.state), logLen: App.log.length });
    if (App.undoStack.length > 20) App.undoStack.shift();
  }
  function undoTurn() {
    if (isOnline()) { toast("Undo isn't available in online matches."); return; }
    if (!App.undoStack.length) { toast("Nothing to undo."); return; }
    if (App.aiTimer) { clearTimeout(App.aiTimer); App.aiTimer = null; }
    var entry = App.undoStack.pop();
    App.state = entry.state;
    App.log.length = entry.logLen;
    App.busy = false;
    App.selected = null;
    App.selPay = null;
    hideCostTip();
    closeOverlays();
    App.renderAll();
    App._skipSnap = true;   // don't record the restored state as a replay frame
    beginTurn();
  }

  // ── online multiplayer (Tasks 34-35) ────────────────────────────
  // Protocol: the acting player runs the action through the local
  // engine, then submits the NEW full game state (compact JSON via
  // TtR.toCompact) as the authoritative snapshot through the `move`
  // rpc — `{code, evt: roomTurn, data}`. The server stores it, bumps
  // its own turn counter and broadcasts; BOTH clients rehydrate from
  // the snapshot, so the acting player's state is the source of truth
  // for the whole table. End of game: the final scored snapshot is
  // submitted, then `endGame` declares host/guest/draw. Rejoins fetch
  // the latest snapshot with `getRoom`/`joinRoom`; presence comes from
  // the snap's hostIn/guestIn flags.
  function onlineRpc(method, data) {
    return new Promise(function (res, rej) {
      if (!App.socket || !App.sockOpen) return rej(new Error("socket not open"));
      App.socket.rpc[method](data).then(function (r) {
        try { res(JSON.parse(r)); } catch (e) { res({ ok: false, err: "parse" }); }
      }).catch(rej);
    });
  }
  function openedOnline() {
    return new Promise(function (res) {
      if (App.sockOpen) return res(true);
      if (!App.socket) return res(false);
      var t0 = Date.now();
      var iv = setInterval(function () {
        if (App.sockOpen) { clearInterval(iv); res(true); }
        else if (Date.now() - t0 > 8000) { clearInterval(iv); res(false); }
      }, 60);
    });
  }
  function connectOnlineSocket() {
    if (App.socket) return;
    var rootRef = window.root || {};
    if (!rootRef.createServerSocket) { toast("Online play is unavailable right now."); return; }
    try { App.socket = rootRef.createServerSocket(); }
    catch (e) { toast("Online play is unavailable right now."); return; }
    App.socket.addEventListener("open", function () {
      App.sockOpen = true;
      App.retryDelay = 800;
      if (App.roomCode) rejoinOnlineRoom();
      setPresenceUI();
    });
    App.socket.addEventListener("message", function (ev) { if (isOnline()) onOnlineMsg(ev.data); });
    App.socket.addEventListener("close", function (ev) {
      App.sockOpen = false;
      if (!App.wantReconnect || !isOnline()) return;
      if (ev.code === 4403) { App.wantReconnect = false; toast("Online is unavailable on this page."); return; }
      setTimeout(function () {
        if (App.wantReconnect && isOnline()) {
          App.retryDelay = Math.min(App.retryDelay * 1.7, 8000);
          App.socket = null;
          connectOnlineSocket();
        }
      }, App.retryDelay);
    });
  }
  function onOnlineMsg(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.t === "snap") applyOnlineSnap(msg.snap);
  }
  function setPresenceUI() {
    if (!els.ttrOppEl) return;
    if (isOnline() && App.state) {
      els.ttrOppEl.hidden = false;
      els.ttrOppEl.textContent = (App.oppPresent ? "🟢 " : "🟡 ") + displayName(App.state.players[oppId()]) + (App.oppPresent ? " online" : " away");
      els.ttrOppEl.classList.toggle("away", !App.oppPresent);
    } else if (els.ttrOppEl && !els.ttrOppEl.hidden) {
      els.ttrOppEl.hidden = true;
    }
  }
  function applyOnlineSnap(snap) {
    App.roomTurn = snap.turn;
    App.roomFirst = snap.first;
    App.oppPresent = App.myRole === "host" ? snap.guestIn : snap.hostIn;
    setPresenceUI();
    if (snap.status === 1) {
      if (els.ttrWaitPanel) { els.ttrWaitPanel.hidden = false; }
      if (els.ttrWaitCodeEl) els.ttrWaitCodeEl.textContent = App.roomCode || "";
      if (els.ttrWaitMsg) els.ttrWaitMsg.textContent = "Waiting for your opponent to join…";
      setBanner("Waiting for your opponent to join");
      App.renderAll();
      return;
    }
    if (els.ttrWaitPanel) els.ttrWaitPanel.hidden = true;
    if (snap.status === 3) {
      if (snap.snapshot) {
        try {
          var s3 = TtR.fromCompact(snap.snapshot);
          adoptState(s3);
          if (s3.phase === "gameOver") { showResult(); return; }
        } catch (e) {}
      }
      showOnlineEnd(snap);
      return;
    }
    if (snap.snapshot) {
      var st;
      try { st = TtR.fromCompact(snap.snapshot); }
      catch (e) { toast("Received an invalid update from the server."); App.busy = false; App.renderAll(); return; }
      adoptState(st);
      return;
    }
    if (turnRoleFor(snap.turn, snap.first) === App.myRole) startOnlineGame(snap);
    else setBanner("Waiting for " + (App.myRole === "host" ? "Guest" : "Host") + " to deal destination tickets…");
  }
  function adoptState(s) {
    var prev = App.state;
    if (prev && prev.phase === "playing" && s.phase === "playing") {
      for (var i = 0; i < s.players.length; i++) {
        if (i === myPid()) continue;
        var plOld = prev.players[i], plNew = s.players[i];
        if (!plOld || !plNew) continue;
        plNew.claimedRoutes.forEach(function (rid) {
          if (plOld.claimedRoutes.indexOf(rid) === -1)
            addLog(displayName(plNew), "claimed " + rid + " (+" + TtR.ROUTE_POINTS[s.routes[rid].length] + ")");
        });
        if (plNew.ticketIds.length > plOld.ticketIds.length)
          addLog(displayName(plNew), "drew " + (plNew.ticketIds.length - plOld.ticketIds.length) + " destination ticket(s)");
        if (TtR.handSize(plNew) > TtR.handSize(plOld))
          addLog(displayName(plNew), "drew " + (TtR.handSize(plNew) - TtR.handSize(plOld)) + " train card(s)");
      }
    }
    App.state = s;
    App.busy = false;
    App.selected = null;
    App.selPay = null;
    hideCostTip();
    App.humanIds = [];
    s.players.forEach(function (pl, i) { if (pl.kind === "human") App.humanIds.push(i); });
    document.getElementById("lobbyCtn").hidden = true;
    els.ttrCtn.hidden = false;
    if (s.phase === "gameOver") { App.renderAll(); showResult(); return; }
    App.renderAll();
    var pid = s.turn.active;
    if (s.pendingTickets.length && s.turn.substate === "drawingTickets" && pid === myPid()) {
      resumeTicketDialog();
      return;
    }
    if (pid === myPid()) { sfxPlay("turn"); setBanner("Your turn — " + turnPrompt()); }
    else setBanner(displayName(s.players[pid]) + " is thinking…");
  }
  function startOnlineGame(snap) {
    var first = snap.first;
    var seed = Math.floor(Math.random() * 0x7fffffff);
    var s = TtR.newGame({ seed: seed, players: [
      { name: "Host", kind: "human", role: "host" },
      { name: "Guest", kind: "human", role: "guest" }
    ] });
    s.turn.active = turnRoleFor(0, first) === "guest" ? 1 : 0;
    App.state = s;
    App.players = [{ name: "Host", kind: "human" }, { name: "Guest", kind: "human" }];
    App.humanIds = [0, 1];
    App.roomTurn = snap.turn;
    App.log = [];
    App.undoStack = [];
    App.lbSubmitted = false;
    App.busy = false;
    document.getElementById("lobbyCtn").hidden = true;
    els.ttrCtn.hidden = false;
    closeOverlays();
    App.renderAll();
    setBanner("Keep your tickets");
    TtR.enterAction(s, "drawingTickets");
    TtR.beginTicketDraw(s);
    App.renderAll();
    var pending = s.pendingTickets.slice();
    askTicketKeep(pending, pending.length >= 3 ? 2 : 1, "Keep your tickets",
      "Keep at least 2 of your 3 destination tickets. Click to select, then Keep.").then(function (keep) {
      var st = App.state;
      try {
        TtR.resolveTicketDraw(st, keep);
        addLog(st.players[st.turn.active].name, "kept " + keep.length + " destination ticket" + (keep.length === 1 ? "" : "s"));
      } catch (e) { console.error(e); }
      TtR.completeTurn(st);
      App.renderAll();
      beginTurn();   // online → submits the snapshot
    });
  }
  function submitOnlineMove() {
    if (!isOnline() || !App.sockOpen || !App.roomCode || !App.state) return;
    App.busy = true;
    App.renderAll();
    var data = TtR.toCompact(App.state);
    if (data.length > 3400) { toast("Update too large to send — please report this."); App.busy = false; App.renderAll(); return; }
    onlineRpc("move", JSON.stringify({ code: App.roomCode, evt: App.roomTurn, data: data })).then(function (r) {
      if (!r || !r.ok) {
        App.busy = false;
        App.renderAll();
        if (r && r.err === "stale") { refreshOnlineRoom(); return; }
        toast("Couldn't send your move (" + (r && r.err ? r.err : "error") + ").");
        return;
      }
      refreshOnlineRoom();   // authoritative snap back → re-render + unlock
    }).catch(function () {
      App.busy = false;
      App.renderAll();
      toast("Lost connection — reconnecting…");
    });
  }
  function refreshOnlineRoom() {
    if (!App.roomCode || !App.sockOpen) return Promise.resolve();
    return onlineRpc("getRoom", App.roomCode).then(function (r) {
      if (r && r.snap) applyOnlineSnap(r.snap);
    }).catch(function () {});
  }
  function rejoinOnlineRoom() {
    if (!App.roomCode || !App.sockOpen) return;
    onlineRpc("joinRoom", App.roomCode).then(function (r) {
      if (!r || !r.ok) {
        if (r && r.err === "room_full") {
          setTimeout(function () { if (isOnline() && App.sockOpen) rejoinOnlineRoom(); }, 1500);
          return;
        }
        toast("Rejoin failed (" + (r && r.err ? r.err : "error") + ").");
        return;
      }
      App.myRole = r.role;
      if (r.snap) applyOnlineSnap(r.snap);
    }).catch(function () {});
  }
  function endOnlineGame() {
    if (!isOnline() || !App.sockOpen || !App.roomCode || !App.state) return;
    if (App.state.phase !== "gameOver" || !App.state.gameEnd.breakdown) return;
    var w = App.state.gameEnd.breakdown.winners;
    var winner = "draw";
    if (w && w.length === 1) winner = w[0] === 0 ? "host" : "guest";
    onlineRpc("endGame", JSON.stringify({ code: App.roomCode, winner: winner })).then(function (r) {
      if (r && !r.ok && r.err) toast("Couldn't record the result (" + r.err + ").");
    }).catch(function () {});
  }
  function showOnlineEnd(snap) {
    var winner = snap.winner, reason = snap.reason || "";
    var youWin = winner === App.myRole;
    var title, note;
    if (winner === "draw") { title = "🤝 It's a draw!"; note = "Both players share the victory."; }
    else if (youWin) { title = "🏁 You win!"; note = reason === "resign" ? "Your opponent resigned." : "Your opponent left — you win by forfeit."; }
    else { title = "🏁 " + (winner === "host" ? "Host" : "Guest") + " wins"; note = reason === "resign" ? "You resigned." : "You lost by forfeit."; }
    if (els.ttrOverTitle) els.ttrOverTitle.textContent = title;
    if (els.ttrOverTableEl) els.ttrOverTableEl.innerHTML = '<div class="ttr-over-note">' + esc(note) + "</div>";
    if (els.ttrAgainBtn) els.ttrAgainBtn.hidden = true;
    if (els.ttrRematchBtn) els.ttrRematchBtn.hidden = false;
    if (els.ttrRecordEl) els.ttrRecordEl.hidden = true;
    if (els.ttrOverDetailsBtn) els.ttrOverDetailsBtn.hidden = true;
    if (els.ttrOverDetailsCtn) els.ttrOverDetailsCtn.hidden = true;
    if (els.ttrShareBtn) els.ttrShareBtn.hidden = true;
    openOverlay("ttrOverModal");
    App.renderAll();
  }
  function updateClaimWinStrip() {
    var ctn = els.ttrClaimWinCtn;
    if (!ctn) return;
    if (!isOnline() || !App.state || App.state.phase !== "playing" || App.state.turn.substate !== "chooseAction" ||
        App.oppPresent || App.state.turn.active !== myPid()) {
      ctn.hidden = true;
      ctn.innerHTML = "";
      return;
    }
    ctn.hidden = false;
    ctn.innerHTML = '<span>Your opponent has disconnected.</span><button class="btn btn-ghost btn-sm" id="ttrClaimWinBtn">🏆 Claim the win</button>';
    var b = document.getElementById("ttrClaimWinBtn");
    if (b) b.addEventListener("click", claimWinOnline);
  }
  function claimWinOnline() {
    if (!isOnline() || !App.roomCode) return;
    onlineRpc("claimWin", App.roomCode).then(function (r) {
      if (r && r.ok) { toast("You win by forfeit!"); refreshOnlineRoom(); }
      else toast(r && r.err === "opp_present" ? "Your opponent came back!" : "Can't claim right now.");
    }).catch(function () {});
  }
  var resignArm = 0;
  function forfeitOnline() {
    if (!isOnline() || !App.roomCode) return;
    if (Date.now() - resignArm > 2500) { resignArm = Date.now(); toast("Click Resign again to confirm."); return; }
    onlineRpc("resign", App.roomCode).then(function (r) {
      if (r && r.ok) refreshOnlineRoom();
      else toast("Couldn't resign.");
    }).catch(function () {});
  }
  function rematchOnline() {
    if (!isOnline() || !App.roomCode) return;
    onlineRpc("rematch", App.roomCode).then(function (r) {
      if (r && r.ok) { closeOverlays(); refreshOnlineRoom(); }
      else toast(r && r.err ? r.err : "Couldn't start a rematch.");
    }).catch(function () {});
  }
  function createOnlineRoom() {
    App.mode = "online";
    App.wantReconnect = true;
    App.roomCode = null;
    App.myRole = null;
    connectOnlineSocket();
    openedOnline().then(function (ok) {
      if (!ok) { toast("Couldn't reach the server."); return; }
      var first = roomFirst();
      onlineRpc("createRoom", first === 1 ? "guestFirst" : "").then(function (r) {
        if (!r || !r.ok) { toast("Couldn't create a room (" + (r && r.err ? r.err : "error") + ")."); return; }
        App.roomCode = r.code;
        App.myRole = r.role;
        App.log = [];
        App.busy = false;
        document.getElementById("lobbyCtn").hidden = true;
        els.ttrCtn.hidden = false;
        closeOverlays();
        App.renderAll();
        if (r.snap) applyOnlineSnap(r.snap);
        else showOnlineWait(r.code);
        try { window.sfx("deal"); } catch (e) {}
      }).catch(function () { toast("Server error — please retry."); });
    });
  }
  function joinOnlineRoom(code) {
    App.mode = "online";
    App.wantReconnect = true;
    App.roomCode = null;
    App.myRole = null;
    connectOnlineSocket();
    openedOnline().then(function (ok) {
      if (!ok) { toast("Couldn't reach the server."); return; }
      onlineRpc("joinRoom", code).then(function (r) {
        if (!r || !r.ok) { toast("Couldn't join (" + (r && r.err ? r.err : "error") + ")."); return; }
        App.roomCode = code;
        App.myRole = r.role;
        App.log = [];
        App.busy = false;
        document.getElementById("lobbyCtn").hidden = true;
        els.ttrCtn.hidden = false;
        closeOverlays();
        App.renderAll();
        if (r.snap) applyOnlineSnap(r.snap);
        else showOnlineWait(code);
        try { window.sfx("deal"); } catch (e) {}
      }).catch(function () { toast("Server error — please retry."); });
    });
  }
  function showOnlineWait(code) {
    if (els.ttrWaitCodeEl) els.ttrWaitCodeEl.textContent = code || "";
    if (els.ttrWaitMsg) els.ttrWaitMsg.textContent = "Waiting for your opponent to join…";
    els.ttrWaitPanel.hidden = false;
  }
  function exitOnline(showLobby) {
    if (App.socket) { App.wantReconnect = false; try { App.socket.close(1000, "bye"); } catch (e) {} App.socket = null; }
    App.sockOpen = false;
    App.roomCode = null;
    App.myRole = null;
    App.roomTurn = 0;
    App.oppPresent = false;
    App.mode = null;
    App.state = null;
    App.undoStack = [];
    App.busy = false;
    closeOverlays();
    els.ttrCtn.hidden = true;
    if (showLobby) document.getElementById("lobbyCtn").hidden = false;
  }

  // Resume a mid-game ticket draw whose tickets are ALREADY pending
  // (used on load/rejoin — beginTicketDraw would reject on a second
  // draw). Mirrors startTicketDrawFlow's completion path.
  function resumeTicketDialog() {
    var s = App.state;
    if (s.turn.substate !== "drawingTickets" || !s.pendingTickets.length) return false;
    var pending = s.pendingTickets.slice();
    var minKeep = pending.length >= 3 ? 1 : 1;   // mid-game draws: keep at least 1
    setBanner("Choose your tickets");
    App.renderAll();
    askTicketKeep(pending, minKeep, "Draw destination tickets",
      "Keep at least 1 of your " + pending.length + " destination ticket(s) — click the ones you want, then Keep.").then(function (keep) {
      var st = App.state;
      try {
        TtR.resolveTicketDraw(st, keep);
        sfxPlay("deal");
        addLog(st.players[st.turn.active].name, "kept " + keep.length + " destination ticket" + (keep.length === 1 ? "" : "s"));
      } catch (e) { console.error(e); }
      TtR.completeTurn(st);
      App.renderAll();
      App.beginTurn();
    });
    return true;
  }

  // ── turn banner / thinking indicator (Task 27) ──────────────────
  function turnPrompt() {
    var s = App.state, st = s.turn.substate;
    if (st === "drawingCards") return "draw up to 2 train cards";
    if (st === "claimingRoute") return "click a route to claim it (Esc to cancel)";
    if (st === "drawingTickets") return "choose your destination tickets";
    return "choose an action below";
  }
  function setBanner(txt) { if (els.ttrTurnEl) els.ttrTurnEl.textContent = txt; }
  function setThinking(on) { if (els.ttrThinkEl) els.ttrThinkEl.hidden = !on; }

  function beginTurn() {
    App.selected = null;
    App.selPay = null;
    hideCostTip();
    if (!isOnline()) saveGame();
    App.renderAll();
    var s = App.state;
    if (!s) return;
    if (App._skipSnap) App._skipSnap = false; else snapReplay();   // Task 49
    if (s.phase === "gameOver") { showResult(); onlineFinish(); return; }
    if (TtR.isRoundComplete(s)) {
      TtR.finalScores(s);
      App.renderAll();
      showResult();
      onlineFinish();
      return;
    }
    var pid = s.turn.active;
    var pl = s.players[pid];
    if (pl.kind === "ai") {
      setThinking(true);
      setBanner(pl.name + " is thinking…");
      App.aiTimer = setTimeout(runAiStep, aiDelay());
    } else {
      if (isOnline()) {
        setThinking(false);
        App.busy = true;
        submitOnlineMove();
        return;
      }
      // Dead board: no action is executable (no cards, no affordable
      // route, no tickets) — complete an empty card-draw so completeTurn's
      // stall guard triggers the end of the game.
      if (s.turn.substate === "chooseAction" && TtR.legalActions(s).length === 0) {
        try {
          TtR.enterAction(s, "drawingCards");
          TtR.completeTurn(s);
          App.renderAll();
          beginTurn();
          return;
        } catch (e) { console.error("dead-board completion failed:", e); }
      }
      setThinking(false);
      if (App._firstTurn) sfxPlay("turn");
      App._firstTurn = true;
      setBanner(pl.name + "'s turn — " + turnPrompt());
      App.renderAll();
    }
  }

  // Online: after the local engine has finished the final turn, submit
  // the scored snapshot and record the result with endGame.
  function onlineFinish() {
    if (!isOnline()) return;
    if (!App.state || App.state.phase !== "gameOver") return;
    App.busy = true;
    submitOnlineMove();
    endOnlineGame();
  }

  function runAiStep() {
    App.aiTimer = null;
    var s = App.state;
    if (!s || s.phase === "gameOver") return;
    if (TtR.isRoundComplete(s)) { TtR.finalScores(s); showResult(); return; }
    var pid = s.turn.active;
    pushUndo();
    try {
      var sum = TtR.aiTakeTurn(s, pid, App.difficulty);
      if (sum.action !== "none") {
        addLog(s.players[pid].name, sum.action === "claimingRoute"
          ? "claimed " + sum.detail : sum.detail || sum.action);
      }
    } catch (e) {
      console.error("AI turn error:", e);
      try {
        if (TtR.canCompleteTurn(s)) TtR.completeTurn(s);
        else TtR.forceCompleteTurn(s);
      } catch (e2) { console.error("AI recovery failed:", e2); }
    }
    App.renderAll();
    if (s.phase === "gameOver") { showResult(); return; }
    if (TtR.isRoundComplete(s)) { TtR.finalScores(s); showResult(); return; }
    if (s.players[s.turn.active].kind === "ai") {
      App.aiTimer = setTimeout(runAiStep, aiDelay());
    } else {
      beginTurn();
    }
  }

  // ── action buttons (Task 27) ────────────────────────────────────
  function renderActions() {
    var bar = els.ttrActionsCtn;
    if (!bar) return;
    var s = App.state;
    if (!s) { bar.innerHTML = ""; return; }
    if (s.turn.substate !== "chooseAction" || s.phase !== "playing") {
      bar.innerHTML = "";
      return;
    }
    if (isOnline() && (App.busy || s.turn.active !== myPid())) {
      bar.innerHTML = "";
      return;
    }
    var legal = TtR.legalActions(s);
    var pilesEmpty = s.decks.train.draw.length + s.decks.train.discard.length === 0;
    var ticketsEmpty = s.decks.tickets.draw.length + s.decks.tickets.discard.length === 0;
    var anyClaim = false;
    for (var rid in s.routes) { if (TtR.claimEligible(s, rid)) { anyClaim = true; break; } }
    function can(a) { return legal.indexOf(a) !== -1; }
    var html = "";
    html += '<button class="btn btn-gold ttr-act" data-act="drawingCards"' + (can("drawingCards") && !pilesEmpty ? "" : " disabled") + '>🃏 Draw cards</button>';
    html += '<button class="btn btn-ghost ttr-act" data-act="claimingRoute"' + (can("claimingRoute") && anyClaim ? "" : " disabled") + '>🛤️ Claim route</button>';
    html += '<button class="btn btn-ghost ttr-act" data-act="drawingTickets"' + (can("drawingTickets") && !ticketsEmpty ? "" : " disabled") + '>🎟️ Draw tickets</button>';
    bar.innerHTML = html;
    bar.querySelectorAll(".ttr-act").forEach(function (b) {
      b.addEventListener("click", function () { onAction(b.dataset.act); });
    });
  }

  function onAction(act) {
    var s = App.state;
    if (!s || App.busy || s.phase !== "playing") return;
    if (s.turn.substate !== "chooseAction") return;
    var pid = s.turn.active;
    var pl = s.players[pid];
    if (pl.kind !== "human") return;
    if (isOnline() && pid !== myPid()) return;
    if (TtR.legalActions(s).indexOf(act) === -1) { toast("That action isn't available right now."); return; }
    pushUndo();
    try { TtR.enterAction(s, act); } catch (e) { toast(e.message); return; }
    App.selected = null;
    App.selPay = null;
    hideCostTip();
    if (act === "drawingTickets") {
      startTicketDrawFlow();
    } else {
      App.renderAll();
      setBanner(pl.name + "'s turn — " + turnPrompt());
    }
  }

  // ── route-claim interaction (Task 26) ───────────────────────────
  // Best legal payment: fewest locomotives, then largest leftover.
  function bestPayment(pl, route) {
    var opts = TtR.cardPaymentOptions(pl, route);
    if (!opts.length) return null;
    var best = opts[0], bestScore = -Infinity;
    opts.forEach(function (o) {
      var colorCards = route.length - o.locos;
      var surplus = o.color != null ? pl.hand[o.color] - colorCards : pl.hand.locomotive - o.locos;
      var sc = surplus * 10 - o.locos * 6;
      if (sc > bestScore) { bestScore = sc; best = o; }
    });
    return best;
  }

  function canClaimRoutes() {
    var s = App.state;
    if (!s || App.busy || s.phase !== "playing") return false;
    var pl = s.players[s.turn.active];
    if (pl.kind !== "human") return false;
    if (isOnline() && s.turn.active !== myPid()) return false;
    return s.turn.substate === "claimingRoute";
  }

  function onCanvasClick(e) {
    if (!canClaimRoutes()) return;
    var s = App.state;
    var rid = Board.hitTest(els.boardCanvas, s, e.offsetX, e.offsetY);
    if (!rid) { clearSelection(); App.renderAll(); return; }
    if (App.selected === rid) { confirmClaim(rid); return; }
    App.selected = rid;
    App.selPay = bestPayment(s.players[s.turn.active], s.routes[rid]);
    updateCostTip(e, rid);
    App.renderAll();
  }

  function onCanvasMove(e) {
    if (!canClaimRoutes()) return;
    var s = App.state;
    var rid = Board.hitTest(els.boardCanvas, s, e.offsetX, e.offsetY);
    els.boardCanvas.style.cursor = rid ? "pointer" : "";
  }

  function clearSelection() {
    App.selected = null;
    App.selPay = null;
    hideCostTip();
  }

  function updateCostTip(e, rid) {
    var s = App.state, r = s.routes[rid];
    var pay = App.selPay;
    var label = r.color === "gray" ? "any color" : r.color;
    if (pay && pay.color != null && r.color === "gray") label = pay.color;
    var costStr = r.length + "× " + label +
      (pay && pay.locos ? " + " + pay.locos + " loco" + (pay.locos > 1 ? "s" : "") : "");
    var tip = els.ttrCostTipEl;
    tip.innerHTML = "<b>" + esc(r.a) + " – " + esc(r.b) + "</b> · " + r.length + " trains · " + esc(costStr) +
      "<span class='ttr-cost-ok'>click again to claim · Esc cancels</span>";
    tip.hidden = false;
    var w = tip.offsetWidth;
    var x = Math.max(8, Math.min(window.innerWidth - w - 10, e.clientX + 14));
    tip.style.left = x + "px";
    tip.style.top = Math.max(8, e.clientY + 14) + "px";
  }
  function hideCostTip() { if (els.ttrCostTipEl) els.ttrCostTipEl.hidden = true; }

  function confirmClaim(rid) {
    var s = App.state;
    if (!canClaimRoutes()) return;
    var r = s.routes[rid];
    var pay = App.selPay || bestPayment(s.players[s.turn.active], r);
    if (!pay) { toast("You don't have enough matching cards for that route."); clearSelection(); App.renderAll(); return; }
    try {
      TtR.claimRoute(s, rid, pay);
      sfxPlay("place");
      addLog(s.players[s.turn.active].name, "claimed " + rid + " (+" + TtR.ROUTE_POINTS[r.length] + ")");
      TtR.completeTurn(s);
    } catch (e) { toast(e.message); clearSelection(); App.renderAll(); return; }
    clearSelection();
    App.renderAll();
    App.beginTurn();
  }

  // ── rendering ───────────────────────────────────────────────────
  function renderLegend() {
    if (!els.ttrLegendEl || !App.state) return;
    els.ttrLegendEl.innerHTML = App.state.players.map(function (pl, i) {
      var active = App.state.turn.active === i && App.state.phase !== "gameOver";
      return '<span class="ttr-legend-chip' + (active ? " on" : "") + '" style="--pc:' + TtR.PLAYER_COLORS[pl.colorIndex] + '">' +
        "<i></i>" + esc(pl.name) + "</span>";
    }).join("");
  }

  // ── route-hint helper (Task 40) ─────────────────────────────────
  // "💡 Hints": highlights the routes the current player should look at —
  // green dashed = claimable with their hand right now; gold glow =
  // on a shortest path between two cities of an uncompleted ticket.
  function hintsTarget() {
    var s = App.state;
    if (!s || s.phase !== "playing") return null;
    if (isOnline()) return myPid();
    var act = s.turn.active;
    if (s.players[act].kind === "human") return act;
    return 0;   // AI turns: the human operator still plans ahead
  }
  // Shortest (fewest-segment) path between two cities on the FULL board
  // graph — returns the route ids along one shortest path.
  function shortestPathRouteIds(s, a, b) {
    if (a === b) return [];
    var adj = {};
    for (var rid in s.routes) {
      var r = s.routes[rid];
      (adj[r.a] = adj[r.a] || []).push([rid, r.b]);
      (adj[r.b] = adj[r.b] || []).push([rid, r.a]);
    }
    var prev = {}, seen = {}, queue = [a];
    seen[a] = true;
    prev[a] = null;
    while (queue.length) {
      var c = queue.shift();
      if (c === b) break;
      (adj[c] || []).forEach(function (e) {
        if (!seen[e[1]]) { seen[e[1]] = true; prev[e[1]] = [e[0], c]; queue.push(e[1]); }
      });
    }
    if (!seen[b]) return [];
    var rids = [], cur = b;
    while (cur !== a) { var p = prev[cur]; rids.push(p[0]); cur = p[1]; }
    return rids;
  }
  function hintsFor(pid) {
    var s = App.state;
    var helpful = {}, claimable = {};
    var pl = s.players[pid];
    pl.ticketIds.forEach(function (tid) {
      if (pl.ticketState[tid] === "complete") return;
      var t = s.tickets[tid];
      shortestPathRouteIds(s, t.a, t.b).forEach(function (rid) {
        if (!TtR.routeOwner(s, rid)) helpful[rid] = 1;
      });
    });
    var isMyTurn = s.phase === "playing" && s.turn.active === pid && pl.kind === "human";
    if (isMyTurn && !App.busy) {
      for (var rid in s.routes) {
        if (TtR.claimEligible(s, rid)) claimable[rid] = 1;
      }
    }
    return { helpful: Object.keys(helpful), claimable: Object.keys(claimable) };
  }
  function toggleHints() {
    App.hintsOn = !App.hintsOn;
    try { localStorage.setItem("ttr_hints", App.hintsOn ? "1" : ""); } catch (e) {}
    if (App.hintsOn) toast("💡 Hints on — green = claimable now, gold = helps your tickets");
    App.renderAll();
  }
  function renderBoard() {
    if (els.boardCanvas && App.state) {
      var opts = { selected: App.selected };
      if (App.hintsOn) {
        var target = hintsTarget();
        if (target != null) opts.hints = hintsFor(target);
      }
      Board.render(els.boardCanvas, App.state, opts);
    }
  }

  function renderCards() {
    var ctn = els.ttrCardsCtn;
    if (!ctn) return;
    var s = App.state;
    if (!s) { ctn.innerHTML = ""; return; }
    var can = canHumanDraw();
    var drawIdx = s.turn.cardsDrawn;
    var drawCount = s.decks.train.draw.length;
    var discCount = s.decks.train.discard.length;
    var html = [];
    html.push('<div class="ttr-deck' + (can ? " can" : "") + '" id="ttrDeckEl" title="Draw a blind card from the deck">'
      + '<button class="ttr-deck-btn" type="button" tabindex="' + (can ? 0 : -1) + '">DRAW</button>'
      + '<div class="ttr-deck-count">' + drawCount + ' left</div></div>');
    html.push('<div class="ttr-discard" title="Discard pile">discard ' + discCount + '</div>');
    s.faceUp.forEach(function (card, i) {
      var fresh = !!s.faceUpFresh[i];
      var isLoco = card === TtR.LOCOMOTIVE;
      var clickable = can && !fresh && !(isLoco && drawIdx > 0);
      html.push('<div class="ttr-card ' + (isLoco ? "loco" : "col") + '" style="--cc:' + Board.COLOR_HEX[card] + '"'
        + (clickable ? ' data-idx="' + i + '" role="button" tabindex="0"' : '')
        + (fresh ? ' data-fresh="1"' : '') + '>'
        + '<span class="ttr-card-band"></span>'
        + '<span class="ttr-card-train">🚂</span>'
        + (fresh ? '<span class="ttr-card-fresh">NEW</span>' : '')
        + '</div>');
    });
    ctn.innerHTML = html.join("");
    deckEl = document.getElementById("ttrDeckEl");
    ctn.querySelectorAll(".ttr-card[data-idx]").forEach(function (el) {
      el.addEventListener("click", function () { onCardClick(Number(el.dataset.idx)); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCardClick(Number(el.dataset.idx)); }
      });
    });
    var deckBtn = deckEl && deckEl.querySelector(".ttr-deck-btn");
    if (deckBtn && can) deckBtn.addEventListener("click", onDeckClick);
  }

  // True when the active human player may draw a card right now.
  function canHumanDraw() {
    var s = App.state;
    if (!s || s.phase !== "playing" || App.busy) return false;
    var pl = s.players[s.turn.active];
    if (pl.kind !== "human") return false;
    if (isOnline() && s.turn.active !== myPid()) return false;
    if (s.turn.substate !== "drawingCards") return false;
    if (s.turn.locoLock || s.turn.cardsDrawn >= 2) return false;
    if (s.decks.train.draw.length + s.decks.train.discard.length === 0) return false;
    return true;
  }

  function humanPanelEl() {
    var s = App.state;
    if (!s) return null;
    return document.getElementById("ttrPanel_" + s.turn.active) || els.ttrLegendEl;
  }

  // Clone an element and animate it flying toward a target (e.g. the
  // drawing player's panel) before the board re-renders underneath.
  function flyClone(srcEl, tgtEl) {
    var src = srcEl.getBoundingClientRect();
    var tgt = tgtEl ? tgtEl.getBoundingClientRect() : null;
    var clone = srcEl.cloneNode(true);
    clone.classList.add("ttr-fly");
    clone.style.cssText = "position:fixed;left:" + src.left + "px;top:" + src.top + "px;width:" + src.width + "px;height:" + src.height + "px;margin:0;z-index:9990;pointer-events:none;";
    document.body.appendChild(clone);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (tgt) {
          clone.style.transform = "translate(" + (tgt.left - src.left + tgt.width / 2 - src.width / 2) + "px," +
            (tgt.top - src.top + tgt.height / 2 - src.height / 2) + "px) scale(0.32) rotate(7deg)";
        }
        clone.style.opacity = "0.7";
      });
    });
    setTimeout(function () { if (clone.parentNode) clone.parentNode.removeChild(clone); }, 440);
  }

  function flyFromRect(rect, tgtEl) {
    var tgt = tgtEl ? tgtEl.getBoundingClientRect() : null;
    var clone = document.createElement("div");
    clone.className = "ttr-card ttr-fly col";
    clone.style.setProperty("--cc", "#7a5b2e");
    clone.innerHTML = '<span class="ttr-card-band"></span><span class="ttr-card-train">🚂</span>';
    clone.style.cssText = "position:fixed;left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + rect.height + "px;margin:0;z-index:9990;pointer-events:none;";
    document.body.appendChild(clone);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (tgt) {
          clone.style.transform = "translate(" + (tgt.left - rect.left + tgt.width / 2 - rect.width / 2) + "px," +
            (tgt.top - rect.top + tgt.height / 2 - rect.height / 2) + "px) scale(0.32) rotate(7deg)";
        }
        clone.style.opacity = "0.7";
      });
    });
    setTimeout(function () { if (clone.parentNode) clone.parentNode.removeChild(clone); }, 440);
  }

  function onCardClick(idx) {
    if (!canHumanDraw()) return;
    var el = els.ttrCardsCtn.querySelector('.ttr-card[data-idx="' + idx + '"]');
    if (el) flyClone(el, humanPanelEl());
    App.tryTakeFaceUp(idx);
  }

  function onDeckClick() {
    if (!canHumanDraw()) return;
    if (deckEl) flyFromRect(deckEl.getBoundingClientRect(), humanPanelEl());
    App.tryDrawBlind();
    var d = document.getElementById("ttrDeckEl");
    if (d) { d.classList.remove("ttr-pop"); void d.offsetWidth; d.classList.add("ttr-pop"); }
  }

  // ── player panels (Tasks 25 & 29) ───────────────────────────────
  // Hotseat privacy (Task 29): in a local multi-human game only the
  // active player's hand & tickets are revealed; AI games show the
  // operator's own panel always. Online (Task 35): each client only
  // sees its OWN hand — the shared snapshot contains both.
  function showPrivate(pl) {
    if (pl.kind !== "human") return false;
    if (isOnline()) return pl.id === myPid();
    if (App.mode === "local") return pl.id === activePlayerId();
    return true;
  }

  var expanded = {};   // pid -> true when its ticket list is open

  function ticketListHtml(pl) {
    var s = App.state;
    var open = !!expanded[pl.id];
    var done = 0;
    var rows = pl.ticketIds.map(function (tid) {
      var t = s.tickets[tid];
      var st = pl.ticketState[tid];
      if (st === "complete") done++;
      var icon = st === "complete" ? "✓" : st === "connected" ? "~" : "○";
      var cls = st === "complete" ? "done" : st === "connected" ? "conn" : "";
      return '<div class="ttr-ticket-row ' + cls + '"><span class="t-state">' + icon + '</span>' +
        "<span>" + esc(t.a) + " – " + esc(t.b) + "</span>" +
        '<span class="t-val">+' + t.value + "</span></div>";
    }).join("");
    return '<div class="ttr-p-ticketbtn" data-toggle="' + pl.id + '" title="Toggle tickets">' +
      "🎟 " + pl.ticketIds.length + " ticket" + (pl.ticketIds.length === 1 ? "" : "s") +
      (done ? " <span class='ttr-p-dones'>(" + done + " ✓)</span>" : "") +
      (open ? " ▴" : " ▾") + "</div>" +
      (open ? '<div class="ttr-p-tlist">' + rows + "</div>" : "");
  }

  function cardChips(pl) {
    return TtR.CARD_TYPES.map(function (c) {
      var n = pl.hand[c];
      return '<span class="ttr-chip' + (n === 0 ? " zero" : "") + (c === TtR.LOCOMOTIVE ? " loco" : "") +
        '" style="--cc:' + Board.COLOR_HEX[c] + '" title="' + c + '"><i></i>' + n + "</span>";
    }).join("");
  }

  function displayName(pl) {
    if (isOnline() && pl.id === myPid()) return lbName();
    return pl.name;
  }
  function renderPanels() {
    var ctn = els.ttrPanelsCtn;
    if (!ctn) return;
    var s = App.state;
    if (!s) { ctn.innerHTML = ""; return; }
    var active = activePlayerId();
    ctn.innerHTML = s.players.map(function (pl) {
      var priv = showPrivate(pl);
      var handTotal = TtR.handSize(pl);
      var trainsPct = Math.max(0, Math.min(100, Math.round(pl.trains / TtR.TRAINS_START * 100)));
      return '<div class="ttr-panel' + (pl.id === active ? " on" : "") + '" id="ttrPanel_' + pl.id +
        '" style="--pc:' + TtR.PLAYER_COLORS[pl.colorIndex] + '">' +
        '<div class="ttr-p-head"><span class="ttr-p-dot"></span><span class="ttr-p-name">' + esc(displayName(pl)) + "</span>" +
        '<span class="ttr-p-score">★ ' + pl.score + "</span></div>" +
        '<div class="ttr-p-stats"><span title="Trains left">🚂 ' + pl.trains + "</span>" +
        '<span title="Train cards in hand">🃏 ' + handTotal + "</span></div>" +
        '<div class="ttr-p-trains"><i style="width:' + trainsPct + '%"></i></div>' +
        (priv ? '<div class="ttr-p-cards">' + cardChips(pl) + "</div>" : "") +
        '<div class="ttr-p-tickets">' +
        (priv ? ticketListHtml(pl) : '<span class="ttr-p-tickmuted">🎟 ' + pl.ticketIds.length + " tickets</span>") +
        "</div></div>";
    }).join("");
    ctn.querySelectorAll(".ttr-p-ticketbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        var pid = Number(b.dataset.toggle);
        expanded[pid] = !expanded[pid];
        renderPanels();
      });
    });
  }

  // ── move log (Task 27) ──────────────────────────────────────────
  function addLog(name, text) {
    App.log.push({ name: name, text: text });
    if (App.log.length > 80) App.log.shift();
    renderLog();
  }
  function renderLog() {
    var el = els.ttrLogEl;
    if (!el) return;
    if (!App.log.length) { el.innerHTML = ""; return; }
    el.innerHTML = App.log.slice(-40).map(function (l) {
      return '<div class="ttr-log-row"><b>' + esc(l.name) + "</b> " + esc(l.text) + "</div>";
    }).join("");
    el.scrollTop = el.scrollHeight;
  }

  // ── hotseat setup modal (Task 29) ───────────────────────────────
  function loadRulesPref() {
    try {
      var r = JSON.parse(localStorage.getItem("ttr_rules")) || null;
      return r;
    } catch (e) { return null; }
  }
  function openSetupModal() {
    App.rules = loadRulesPref();
    els.ttrSetupCount.value = 2;
    var r = App.rules || {};
    if (els.ttrRuleDouble) els.ttrRuleDouble.checked = !!r.allowDoubleFor23;
    if (els.ttrRuleEnd) els.ttrRuleEnd.value = String(r.endTrains == null ? 2 : r.endTrains);
    if (els.ttrRuleStart) els.ttrRuleStart.value = String(r.startTickets == null ? 2 : r.startTickets);
    syncSetupCount();
    openOverlay("ttrSetupModal");
  }
  function syncSetupCount() {
    var n = Number(els.ttrSetupCount.value);
    els.ttrSetupCountLabel.textContent = n + " players";
    var names = { "2": ["Player 1", "Player 2"], "3": ["Player 1", "Player 2", "Player 3"],
      "4": ["Player 1", "Player 2", "Player 3", "Player 4"], "5": ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5"] }[String(n)];
    els.ttrSetupNamesCtn.innerHTML = names.map(function (nm, i) {
      return '<label class="ttr-setup-name"><span>' + (i + 1) + "</span>" +
        '<input id="ttrSetupName' + i + '" maxlength="16" autocomplete="off" spellcheck="false" value="' + esc(nm) + '"></label>';
    }).join("");
    var first = els.ttrSetupNamesCtn.querySelector("input");
    if (first) first.focus();
  }
  function onSetupStart() {
    var inputs = els.ttrSetupNamesCtn.querySelectorAll("input");
    var players = [];
    inputs.forEach(function (inp, i) {
      var nm = inp.value.trim() || "Player " + (i + 1);
      players.push({ name: nm, kind: "human" });
    });
    var rules = {
      allowDoubleFor23: !!(els.ttrRuleDouble && els.ttrRuleDouble.checked),
      endTrains: els.ttrRuleEnd ? [0, 1, 2].indexOf(Number(els.ttrRuleEnd.value)) !== -1 ? Number(els.ttrRuleEnd.value) : 2 : 2,
      startTickets: els.ttrRuleStart ? [2, 3].indexOf(Number(els.ttrRuleStart.value)) !== -1 ? Number(els.ttrRuleStart.value) : 2 : 2
    };
    App.rules = rules;
    try { localStorage.setItem("ttr_rules", JSON.stringify(rules)); } catch (e) {}
    closeOverlays();
    startGame("local", players, { rules: rules });
  }

  // ── debug/test helpers ──────────────────────────────────────────
  function debugClaim(pid, rid, color) {
    var s = App.state;
    if (!s || s.phase !== "playing") return { ok: false, err: "not playing" };
    var r = s.routes[rid];
    if (!r) return { ok: false, err: "no such route" };
    var c = color || (r.color === "gray" ? "red" : r.color);
    function advanceOne() {
      var cur = s.turn.active;
      if (s.players[cur].kind === "ai") { TtR.aiTakeTurn(s, cur, App.difficulty); return; }
      if (s.turn.substate === "chooseAction") TtR.enterAction(s, "drawingCards");
      if (s.turn.substate === "drawingCards" && !s.turn.locoLock) {
        while (s.turn.cardsDrawn < 2 && s.decks.train.draw.length + s.decks.train.discard.length > 0) {
          TtR.drawBlindCard(s);
        }
      }
      if (s.turn.substate === "drawingTickets") {
        if (s.pendingTickets.length === 0) TtR.beginTicketDraw(s);
        TtR.resolveTicketDraw(s, [s.pendingTickets[0]]);
      }
      TtR.completeTurn(s);
    }
    var guard = 0;
    function isMyTurn() { return s.phase === "playing" && s.turn.active === pid && s.turn.substate === "chooseAction"; }
    while (!isMyTurn() && s.phase === "playing" && !TtR.isRoundComplete(s) && guard++ < 500) {
      advanceOne();
    }
    if (!isMyTurn()) return { ok: false, err: "not pid's turn" };
    if (TtR.routeOwner(s, rid)) return { ok: false, err: "already claimed" };
    var cards = [];
    for (var i = 0; i < r.length; i++) cards.push(c);
    try {
      TtR.testGiveCards(s, pid, cards);
      TtR.enterAction(s, "claimingRoute");
      TtR.claimRoute(s, rid, { color: c, locos: 0 });
      TtR.completeTurn(s);
    } catch (e) { return { ok: false, err: e.message }; }
    App.beginTurn();
    return { ok: true, routeId: rid };
  }

  // ── turn actions (card draws) ───────────────────────────────────
  function tryTakeFaceUp(idx) {
    var s = App.state;
    if (!s || s.phase !== "playing" || App.busy) return { ok: false, err: "busy" };
    if (s.players[s.turn.active].kind !== "human") return { ok: false, err: "not your turn" };
    if (isOnline() && s.turn.active !== myPid()) return { ok: false, err: "not your turn" };
    try {
      TtR.takeFaceUpCard(s, idx);
    } catch (e) { return { ok: false, err: e.message }; }
    sfxPlay("draw");
    App.renderAll();
    afterDraw();
    return { ok: true };
  }

  function tryDrawBlind() {
    var s = App.state;
    if (!s || s.phase !== "playing" || App.busy) return { ok: false, err: "busy" };
    if (s.players[s.turn.active].kind !== "human") return { ok: false, err: "not your turn" };
    if (isOnline() && s.turn.active !== myPid()) return { ok: false, err: "not your turn" };
    try {
      TtR.drawBlindCard(s);
    } catch (e) { return { ok: false, err: e.message }; }
    sfxPlay("draw");
    App.renderAll();
    afterDraw();
    return { ok: true };
  }

  function afterDraw() {
    var s = App.state;
    if (TtR.canCompleteTurn(s)) {
      var pl = s.players[s.turn.active];
      var drew = s.turn.cardsDrawn;
      TtR.completeTurn(s);
      addLog(pl.name, "drew " + drew + " train card" + (drew === 1 ? "" : "s"));
      App.renderAll();
      App.beginTurn();
    } else {
      setBanner(s.players[s.turn.active].name + "'s turn — " + turnPrompt());
    }
  }

  // ── wiring ───────────────────────────────────────────────────────
  function renderTopbar() {
    var on = isOnline();
    if (els.ttrRoomEl) {
      els.ttrRoomEl.hidden = !on;
      if (on) els.ttrRoomEl.textContent = App.roomCode || "";
    }
    if (els.ttrSaveBtn) els.ttrSaveBtn.hidden = on;
    if (els.ttrForfeitBtn) els.ttrForfeitBtn.hidden = !on;
    if (els.ttrUndoBtn) {
      els.ttrUndoBtn.hidden = on;
      els.ttrUndoBtn.disabled = on || !App.state || App.undoStack.length === 0 ||
        App.state.phase !== "playing" || App.state.turn.substate !== "chooseAction";
    }
    if (els.ttrHintsBtn) {
      els.ttrHintsBtn.classList.toggle("on", App.hintsOn);
      els.ttrHintsBtn.title = App.hintsOn ? "Hide route hints" : "Show route hints";
    }
    showSkipBtn();   // Task 50
    setPresenceUI();
  }
  function renderAll() {
    renderTopbar();
    renderBoard();
    renderLegend();
    renderCards();
    renderPanels();
    renderActions();
    updateClaimWinStrip();
    renderLog();
  }

  if (els.ttrMenuBtn) els.ttrMenuBtn.addEventListener("click", exitToLobby);
  if (els.ttrHelpBtn) els.ttrHelpBtn.addEventListener("click", function () {
    els.ttrHelpBody.innerHTML = HELP_HTML;
    var done = els.ttrHelpBody.querySelector("#ttrHelpDoneBtn");
    if (done) done.addEventListener("click", closeOverlays);
    openOverlay("ttrHelpModal");
  });
  if (els.ttrHelpCloseBtn) els.ttrHelpCloseBtn.addEventListener("click", closeOverlays);
  if (els.ttrTicketOkBtn) els.ttrTicketOkBtn.addEventListener("click", onTicketOk);
  if (els.ttrAgainBtn) els.ttrAgainBtn.addEventListener("click", function () {
    if (isOnline()) return;
    closeOverlays();
    if (App._challenge) {   // Task 51: replay the same challenge board
      startGame("ai", App.players, { seed: App._challenge.seed, challenge: App._challenge });
    } else if (App._daily && App._daily.day === dailyDay()) {
      startGame("ai", App.players, { seed: App._daily.seed });   // replay today's board
    } else {
      startGame(App.mode, App.players, { rules: App.rules });
    }
  });
  if (els.ttrOverLobbyBtn) els.ttrOverLobbyBtn.addEventListener("click", function () {
    closeOverlays();
    exitToLobby();
  });
  if (els.ttrSetupCancelBtn) els.ttrSetupCancelBtn.addEventListener("click", closeOverlays);
  if (els.ttrSetupCount) els.ttrSetupCount.addEventListener("input", syncSetupCount);
  if (els.ttrSetupStartBtn) els.ttrSetupStartBtn.addEventListener("click", onSetupStart);
  // Task 32: save / continue / delete
  if (els.ttrSaveBtn) els.ttrSaveBtn.addEventListener("click", function () {
    var ok = saveGame();
    if (ok) { toast("Game saved."); refreshTtrContinuePanel(); }
    else toast("You can save between turns.");
  });
  if (els.ttrContinueBtn) els.ttrContinueBtn.addEventListener("click", continueGame);
  if (els.ttrDeleteSaveBtn) els.ttrDeleteSaveBtn.addEventListener("click", function () {
    deleteTtrSave();
    refreshTtrContinuePanel();
    toast("Save deleted.");
  });
  // Task 33: undo
  if (els.ttrUndoBtn) els.ttrUndoBtn.addEventListener("click", undoTurn);
  // Tasks 34-35: online controls
  if (els.ttrForfeitBtn) els.ttrForfeitBtn.addEventListener("click", forfeitOnline);
  if (els.ttrHintsBtn) els.ttrHintsBtn.addEventListener("click", toggleHints);
  if (els.ttrOverDetailsBtn) els.ttrOverDetailsBtn.addEventListener("click", toggleOverDetails);
  // Task 45: shareable result card
  if (els.ttrShareBtn) els.ttrShareBtn.addEventListener("click", openShare);
  if (els.ttrShareCloseBtn) els.ttrShareCloseBtn.addEventListener("click", closeOverlays);
  if (els.ttrShareTextBtn) els.ttrShareTextBtn.addEventListener("click", copyShareText);
  if (els.ttrShareImgBtn) els.ttrShareImgBtn.addEventListener("click", downloadShareImg);
  if (els.ttrShareNativeBtn) els.ttrShareNativeBtn.addEventListener("click", nativeShare);
  // Task 42: career stats
  if (els.ttrStatsBtn) els.ttrStatsBtn.addEventListener("click", openStats);
  if (els.ttrStatsCloseBtn) els.ttrStatsCloseBtn.addEventListener("click", closeOverlays);
  if (els.ttrStatsClearBtn) els.ttrStatsClearBtn.addEventListener("click", clearStats);
  // Task 46: daily challenge
  if (els.ttrDailyBtn) els.ttrDailyBtn.addEventListener("click", function () {
    closeOverlays();
    startDaily();
  });
  // Task 47: achievements
  if (els.ttrAchBtn) els.ttrAchBtn.addEventListener("click", openAch);
  if (els.ttrAchCloseBtn) els.ttrAchCloseBtn.addEventListener("click", closeOverlays);
  if (els.ttrAchResetBtn) els.ttrAchResetBtn.addEventListener("click", clearAch);
  // Task 48: history archive
  if (els.ttrHistBtn) els.ttrHistBtn.addEventListener("click", openHistory);
  if (els.ttrHistCloseBtn) els.ttrHistCloseBtn.addEventListener("click", closeOverlays);
  if (els.ttrHistClearBtn) els.ttrHistClearBtn.addEventListener("click", function () {
    try { localStorage.removeItem(HIST_KEY); } catch (e) {}
    toast("History cleared.");
    openHistory();
  });
  // Task 49: replay viewer
  if (els.ttrReplayBtn) els.ttrReplayBtn.addEventListener("click", openReplay);
  if (els.ttrReplayExitBtn) els.ttrReplayExitBtn.addEventListener("click", exitReplay);
  if (els.ttrReplayPrevBtn) els.ttrReplayPrevBtn.addEventListener("click", function () { replayStep(-1); });
  if (els.ttrReplayNextBtn) els.ttrReplayNextBtn.addEventListener("click", function () { replayStep(1); });
  if (els.ttrReplayPlayBtn) els.ttrReplayPlayBtn.addEventListener("click", replayTogglePlay);
  // Task 50: AI speed + skip to end
  if (els.ttrAiSpeedEl) {
    els.ttrAiSpeedEl.value = loadAiSpeedPref();
    els.ttrAiSpeedEl.addEventListener("change", function () { setAiSpeed(els.ttrAiSpeedEl.value); });
  }
  if (els.ttrSkipBtn) els.ttrSkipBtn.addEventListener("click", skipToEnd);
  // Task 51: challenge codes
  if (els.ttrChalBtn) els.ttrChalBtn.addEventListener("click", openChallenge);
  if (els.ttrChalCloseBtn) els.ttrChalCloseBtn.addEventListener("click", closeOverlays);
  if (els.ttrChalGenBtn) els.ttrChalGenBtn.addEventListener("click", function () {
    if (els.ttrChalInput) els.ttrChalInput.value = codeFromSeed(Math.floor(Math.random() * 0x7fffffff));
  });
  if (els.ttrChalStartBtn) els.ttrChalStartBtn.addEventListener("click", onChallengeStart);
  if (els.ttrChalInput) els.ttrChalInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") onChallengeStart();
  });
  refreshDailyPanel();
  if (els.ttrRematchBtn) els.ttrRematchBtn.addEventListener("click", function () {
    closeOverlays();
    rematchOnline();
  });
  if (els.ttrWaitCancelBtn) els.ttrWaitCancelBtn.addEventListener("click", function () {
    exitOnline(true);
    refreshTtrContinuePanel();
  });
  // Rebind the lobby's online buttons to the TTR online client. The
  // template script (which attaches its own listeners) runs right after
  // app.js, so this rebind happens on DOMContentLoaded — cloning the
  // buttons drops the template's handlers.
  function initOnlineLobby() {
    var crBtn = document.getElementById("createRoomBtn");
    var jrBtn = document.getElementById("joinRoomBtn");
    var jcInput = document.getElementById("joinCodeInput");
    if (crBtn) {
      var crClone = crBtn.cloneNode(true);
      crBtn.parentNode.replaceChild(crClone, crBtn);
      crClone.addEventListener("click", createOnlineRoom);
    }
    if (jrBtn) {
      var jrClone = jrBtn.cloneNode(true);
      jrBtn.parentNode.replaceChild(jrClone, jrBtn);
      jrClone.addEventListener("click", function () {
        var c = jcInput ? jcInput.value.trim().toUpperCase() : "";
        if (c.length < 5) { toast("Enter the 5-letter room code."); return; }
        joinOnlineRoom(c);
      });
    }
    refreshTtrContinuePanel();
  }
  if (document.readyState === "complete") initOnlineLobby();
  else document.addEventListener("DOMContentLoaded", initOnlineLobby);
  if (els.boardCanvas) {
    els.boardCanvas.addEventListener("click", onCanvasClick);
    els.boardCanvas.addEventListener("mousemove", onCanvasMove);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (els.ttrTicketModal && !els.ttrTicketModal.hidden) return;   // must confirm a ticket keep
    var anyOpen = OVERLAY_IDS.some(function (id) { return els[id] && !els[id].hidden; });
    if (anyOpen) { closeOverlays(); return; }
    if (App.selected) { clearSelection(); App.renderAll(); }
  });

  window.addEventListener("resize", function () {
    if (App.state && !els.ttrCtn.hidden) {
      renderBoard();
      renderCards();
      if (App.selected) hideCostTip();
    }
  });

  // ── keyboard shortcuts (Task 43) ────────────────────────────────
  function isEditableEl(el) {
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" || el.isContentEditable);
  }
  function onShortcut(e) {
    if (isEditableEl(e.target)) return;
    var k = e.key;
    if (k === "Escape") {
      if (replayState) { exitReplay(); return; }   // Task 49
      clearSelection();
      closeOverlays();
      return;
    }
    if (!App.state || els.ttrCtn.hidden || App.state.phase !== "playing") return;
    if (App.busy) return;
    var s = App.state;
    if (s.players[s.turn.active].kind !== "human") return;
    var lower = String(k).toLowerCase();
    if (k === "1") { if (s.turn.substate === "chooseAction") onAction("drawingCards"); }
    else if (k === "2") { if (s.turn.substate === "chooseAction") onAction("claimingRoute"); }
    else if (k === "3") { if (s.turn.substate === "chooseAction") onAction("drawingTickets"); }
    else if (k === "Enter") { if (s.turn.substate === "claimingRoute" && App.selected) confirmClaim(App.selected); }
    else if (lower === "s") { if (!isOnline()) saveGame(); }
    else if (lower === "u") { if (!isOnline()) undoTurn(); }
    else if (lower === "h") { toggleHints(); }
  }
  window.addEventListener("keydown", onShortcut);

  // ── daily challenge comment channel (Task 46) ───────────────────
  // NOTE: the daily leaderboard is served by the shared BGN leaderboard
  // (day-tagged entries, see refreshDailyList) — no comments widget.
  window.App = {
    state: function () { return App.state; },
    startGame: startGame,
    exitToLobby: exitToLobby,
    openSetupModal: openSetupModal,
    openHelp: function () {
      els.ttrHelpBody.innerHTML = HELP_HTML;
      var done = els.ttrHelpBody.querySelector("#ttrHelpDoneBtn");
      if (done) done.addEventListener("click", closeOverlays);
      openOverlay("ttrHelpModal");
    },
    beginTurn: beginTurn,
    renderAll: renderAll,
    tryTakeFaceUp: tryTakeFaceUp,
    tryDrawBlind: tryDrawBlind,
    debugClaim: debugClaim,
    setDifficulty: function (d) { App.difficulty = d; },
    onAction: onAction,
    onCanvasClick: onCanvasClick,
    confirmClaim: confirmClaim,
    clearSelection: clearSelection,
    bestPayment: bestPayment,
    canClaimRoutes: canClaimRoutes,
    closeOverlays: closeOverlays,
    toast: toast,
    saveGame: saveGame,
    continueGame: continueGame,
    deleteTtrSave: deleteTtrSave,
    refreshTtrContinuePanel: refreshTtrContinuePanel,
    undo: undoTurn,
    pushUndo: pushUndo,
    createOnlineRoom: createOnlineRoom,
    joinOnlineRoom: joinOnlineRoom,
    exitOnline: exitOnline,
    rematchOnline: rematchOnline,
    forfeitOnline: forfeitOnline,
    claimWinOnline: claimWinOnline,
    refreshOnlineRoom: refreshOnlineRoom,
    submitOnlineMove: submitOnlineMove,
    applyOnlineSnap: applyOnlineSnap,
    startOnlineGame: startOnlineGame,
    myPid: myPid,
    isOnline: isOnline,
    openStats: openStats,
    clearStats: clearStats,
    openShare: openShare,
    copyShareText: copyShareText,
    downloadShareImg: downloadShareImg,
    nativeShare: nativeShare,
    startDaily: startDaily,
    dailyDay: dailyDay,
    refreshDailyPanel: refreshDailyPanel,
    refreshDailyList: refreshDailyList,
    openAch: openAch,
    clearAch: clearAch,
    achState: function () { return loadAch(); },
    openHistory: openHistory,
    historyCount: function () { return loadHistory().length; },
    openReplay: openReplay,
    replayStep: replayStep,
    replayTogglePlay: replayTogglePlay,
    exitReplay: exitReplay,
    replayCount: function () { return App.replay.length; },
    replayFrames: function () { return App.replay; },
    skipToEnd: skipToEnd,
    setAiSpeed: setAiSpeed,
    openChallenge: openChallenge,
    startChallenge: startChallenge,
    codeFromSeed: codeFromSeed,
    seedFromCode: seedFromCode,
    normCode: normCode,
    _app: App
  };
  // internal calls use App.* too — mirror the functions onto the object
  App.startGame = startGame;
  App.exitToLobby = exitToLobby;
  App.openSetupModal = openSetupModal;
  App.beginTurn = beginTurn;
  App.renderAll = renderAll;
  App.tryTakeFaceUp = tryTakeFaceUp;
  App.tryDrawBlind = tryDrawBlind;
  App.debugClaim = debugClaim;
  App.showResult = showResult;
  App.runAiStep = runAiStep;
  App.afterDraw = afterDraw;
  App.onAction = onAction;
  App.renderBoard = renderBoard;
  App.renderLegend = renderLegend;
  App.renderCards = renderCards;
  App.renderPanels = renderPanels;
  App.renderActions = renderActions;
  App.renderLog = renderLog;
  App.setBanner = setBanner;
  App.setThinking = setThinking;
  App.confirmClaim = confirmClaim;
  App.clearSelection = clearSelection;
  App.bestPayment = bestPayment;
  App.canClaimRoutes = canClaimRoutes;
  App.onCanvasClick = onCanvasClick;
  App.toast = toast;
  App.closeOverlays = closeOverlays;
  App.saveGame = saveGame;
  App.continueGame = continueGame;
  App.deleteTtrSave = deleteTtrSave;
  App.refreshTtrContinuePanel = refreshTtrContinuePanel;
  App.undo = undoTurn;
  App.pushUndo = pushUndo;
  App.createOnlineRoom = createOnlineRoom;
  App.joinOnlineRoom = joinOnlineRoom;
  App.exitOnline = exitOnline;
  App.rematchOnline = rematchOnline;
  App.forfeitOnline = forfeitOnline;
  App.claimWinOnline = claimWinOnline;
  App.refreshOnlineRoom = refreshOnlineRoom;
  App.submitOnlineMove = submitOnlineMove;
  App.applyOnlineSnap = applyOnlineSnap;
  App.startOnlineGame = startOnlineGame;
  App.myPid = myPid;
  App.isOnline = isOnline;
  App.renderTopbar = renderTopbar;
  App.updateClaimWinStrip = updateClaimWinStrip;
  App.setPresenceUI = setPresenceUI;
  App.openAch = openAch;
  App.clearAch = clearAch;
  App.openHistory = openHistory;
  App.openReplay = openReplay;
  App.replayStep = replayStep;
  App.replayTogglePlay = replayTogglePlay;
  App.exitReplay = exitReplay;
  App.skipToEnd = skipToEnd;
  App.setAiSpeed = setAiSpeed;
  App.openChallenge = openChallenge;
  App.startChallenge = startChallenge;
  App.codeFromSeed = codeFromSeed;
  App.seedFromCode = seedFromCode;
  App.normCode = normCode;
})();
