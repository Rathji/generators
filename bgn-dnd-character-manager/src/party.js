/* ════════════════════════════════════════════════════════════════
   D&D CHARACTER FORGE — online Party Table
   Bring your hero to a shared table: up to 6 seats, live presence,
   table chat, and everyone's character cards visible to the party.
   The room shell (join panel, room box, turn indicator, log, action
   buttons, ⛶ fullscreen button) lives in index.html — this module
   drives it: sockets, RPCs, seat cards, chat, turns and the log.
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  const D = window.DND;
  const C = window.CF;

  const P = {};
  C.party = P;

  const $ = (id) => document.getElementById(id);

  const SEATS = 6;
  const state = {
    mode: null, roomCode: null, role: null, tag: null, socket: null, sockOpen: false, wantReconnect: false,
    retryDelay: 800, openResolvers: [], seats: [], status: 1, turn: -1, winner: null, _winLogged: false, myChar: null, lastCard: null,
  };
  let log = [];
  const cardDeb = C.debounce(() => pushCard(), 400);

  /* ─── entry points (from lobby) ─── */
  P.enter = function () {
    $("lobbyCtn").hidden = true;
    $("tableCtn").hidden = false;
    $("partyMenu").hidden = true;
    $("partyJoinPanel").hidden = false;
    $("partyRoomPanel").hidden = true;
    if (state.mode === "online" && state.roomCode && state.sockOpen) {
      $("partyJoinPanel").hidden = true;
      $("partyRoomPanel").hidden = false;
      updateTable();
      rejoin();
      return;
    }
    renderJoin();
  };
  P.exit = function () {
    state.mode = null;
    if (state.socket && state.sockOpen) {
      try { const p = state.socket.rpc.leave(state.roomCode); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
    teardownSocket();
    $("tableCtn").hidden = true;
    $("lobbyCtn").hidden = false;
    CF.gotoTop();
  };

  function teardownSocket() {
    if (state.socket) { state.wantReconnect = false; try { state.socket.close(1000, "bye"); } catch (e) {} state.socket = null; }
    state.sockOpen = false;
    state.roomCode = null; state.role = null; state.turn = -1; state.winner = null;
  }

  function tagKey(code) { return "dndparty_tag_" + code; }

  function connectSocket() {
    if (state.socket) return;
    if (!window.connectSocket && !root.createServerSocket) { partyMsg("Online unavailable on this page."); return; }
    let sock;
    try { sock = window.connectSocket ? window.connectSocket() : root.createServerSocket(); }
    catch (e) { sock = null; }
    if (!sock) { partyMsg("Online unavailable on this page."); return; }
    state.socket = sock;
    state.socket.addEventListener("open", () => {
      state.sockOpen = true; state.retryDelay = 800;
      state.openResolvers.splice(0).forEach((r) => r(true));
      partyMsg("");
      if (state.roomCode) rejoin();
    });
    state.socket.addEventListener("message", (ev) => { if (state.mode === "online") onMsg(ev.data); });
    state.socket.addEventListener("close", (ev) => {
      state.sockOpen = false;
      state.openResolvers.splice(0).forEach((r) => r(false));
      if (!state.wantReconnect || state.mode !== "online") return;
      if (ev.code === 4403) { state.wantReconnect = false; partyMsg("Online is unavailable on this page."); return; }
      setTimeout(() => {
        if (state.wantReconnect && state.mode === "online") {
          state.retryDelay = Math.min(state.retryDelay * 1.7, 8000);
          state.socket = null; connectSocket();
        }
      }, state.retryDelay);
    });
  }
  function rpc(method, data) {
    return new Promise((res, rej) => {
      if (!state.socket || !state.sockOpen) return rej(new Error("socket not open"));
      state.socket.rpc[method](data).then((r) => {
        try { res(JSON.parse(r)); } catch (e) { res({ ok: false, err: "parse" }); }
      }).catch(rej);
    });
  }
  function openedP() { return new Promise((r) => (state.sockOpen ? r(true) : state.openResolvers.push(r))); }
  function partyMsg(t) { const el = $("partyMsg"); if (el) el.textContent = t || ""; }
  P.msg = partyMsg;
  function esc(s) { return C.esc(s); }

  function cardFor(char) {
    if (!char) return null;
    return {
      n: char.name, k: char.klass, l: char.level, sp: char.species,
      hp: char.hp ? char.hp.current : null, mhp: char.hp ? (char.hp.maxSet ? char.hp.max : C.maxHP(char)) : null,
      ac: C.ACFor(char), align: char.alignment, status: char.hp && char.hp.current <= 0 ? "down" : "",
    };
  }
  function pushCard() {
    if (state.mode !== "online" || state.role == null || !state.sockOpen) return;
    const card = cardFor(state.myChar);
    if (!card) return;
    if (state.lastCard && JSON.stringify(state.lastCard) === JSON.stringify(card)) return;
    state.lastCard = card;
    rpc("move", JSON.stringify({ code: state.roomCode, seat: state.role, card })).catch(() => {});
  }

  /* attach a character to my seat */
  P.bringCharacter = function (char) {
    state.myChar = char;
    cardDeb();
    updateTable();
    CF.sfx("deal");
  };

  /* programmatic join (used by the sheet's "Join game room") */
  P.joinRoom = function (code) {
    code = String(code || "").trim().toUpperCase();
    if (code.length < 5) { CF.flash("Enter the 5-letter room code."); return; }
    state.wantReconnect = true;
    connectSocket();
    doJoin(code);
  };
  P.join = P.joinRoom;

  /* wired to the standard "Create room" button (createRoomBtn) */
  P.create = function () {
    state.wantReconnect = true;
    connectSocket();
    doCreate();
  };

  /* ─── join / create ─── */
  async function doCreate() {
    partyMsg("Creating room…");
    const ok = await openedP();
    if (!ok) { partyMsg("Couldn't reach the server."); return; }
    try {
      let r = await rpc("createRoom", "");
      if (!r.ok && r.err === "already_in_room") { await rpc("leave", "").catch(() => {}); r = await rpc("createRoom", ""); }
      if (!r.ok) { partyMsg("Couldn't create a room (" + r.err + ")."); return; }
      enterRoom(r);
    } catch (e) { partyMsg("Server error — please retry."); }
  }
  async function doJoin(code) {
    partyMsg("Joining room " + code + "…");
    const ok = await openedP();
    if (!ok) { partyMsg("Couldn't reach the server."); return; }
    try {
      const payload = JSON.stringify({ code, tag: localStorage.getItem(tagKey(code)) || undefined });
      let r = await rpc("joinRoom", payload);
      if (!r.ok && r.err === "already_in_room") { await rpc("leave", "").catch(() => {}); r = await rpc("joinRoom", payload); }
      if (!r.ok) { partyMsg("Couldn't join (" + r.err + ")."); return; }
      enterRoom(r);
    } catch (e) { partyMsg("Server error — please retry."); }
  }
  function enterRoom(r) {
    state.mode = "online";
    state.roomCode = r.code;
    state.role = r.role;
    state.tag = r.tag || null;
    if (r.tag) { try { localStorage.setItem(tagKey(r.code), r.tag); } catch (e) {} }
    $("partyJoinPanel").hidden = true;
    $("partyMenu").hidden = false;
    $("partyRoomPanel").hidden = false;
    if (r.snap) applySnap(r.snap);
    if (!state.myChar) {
      const linked = C.roster.find((c) => c && c.gameRoom === r.code);
      if (linked) { state.myChar = linked; CF.flash(linked.name + " is linked to this room — brought to your seat!"); }
    }
    logEntry("You joined table <b>" + esc(r.code) + "</b> at seat " + (r.role + 1) + ".");
    if (window.bgnFullscreen) {
      const boardEl = $("board");
      if (boardEl) window.bgnFullscreen.register({ canvas: boardEl });
    }
    updateTable();
    if (state.myChar) cardDeb();
    CF.sfx("deal");
  }
  function rejoin() {
    if (!state.roomCode) return;
    rpc("joinRoom", JSON.stringify({ code: state.roomCode, tag: state.tag || localStorage.getItem(tagKey(state.roomCode)) || undefined })).then((r) => {
      if (!r.ok) { partyMsg("Rejoin failed (" + r.err + ")."); return; }
      state.role = r.role;
      state.tag = r.tag || state.tag;
      if (r.snap) applySnap(r.snap);
      updateTable();
      partyMsg("");
    }).catch(() => {});
  }

  /* ─── server messages ─── */
  function onMsg(raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === "snap") { applySnap(m.snap); updateTable(); }
    else if (m.t === "chat") addChat(m.role, m.text, m.ts);
  }
  function applySnap(s) {
    const prevSeats = state.seats || [];
    const prevCount = prevSeats.filter((x) => x && x.card).length;
    const prevWinner = state.winner;
    state.status = s.status || 1;
    state.seats = s.seats || [];
    state.turn = s.turn != null ? s.turn : -1;
    state.winner = s.winner != null ? s.winner : null;
    const newCount = state.seats.filter((x) => x && x.card).length;
    if (state.winner != null && state.winner !== prevWinner && !state._winLogged) {
      state._winLogged = true;
      const who = state.winner === state.role ? "You" : "Player " + (state.winner + 1);
      logEntry("<b>" + esc(who) + "</b> claimed the win — session over!");
      CF.sfx("deal");
    }
    if (state.winner == null) state._winLogged = false;
    if (newCount > prevCount && prevCount > 0) logEntry("A hero joined the table (" + newCount + "/" + SEATS + ").");
    else if (newCount < prevCount && prevCount > 0) logEntry("A hero left the table (" + newCount + "/" + SEATS + ").");
    if (state.myChar) {
      const my = state.seats[state.role];
      if (my) { my.card = cardFor(state.myChar); }
    }
  }

  /* ─── chat ─── */
  function addChat(role, text, ts) {
    const el = $("partyChatMsgs");
    if (!el) return;
    const mine = role === state.role;
    const row = document.createElement("div");
    row.className = "chat-item" + (mine ? " mine" : "");
    const who = mine ? "You" : "Player " + (role + 1);
    row.innerHTML = "<b>" + esc(who) + "</b>" + esc(text) + '<span class="chat-time">' + fmtTime(ts) + "</span>";
    el.appendChild(row);
    el.scrollTop = el.scrollHeight;
  }
  function fmtTime(ts) {
    const d = new Date((ts || 0) * 1000);
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function sendChat() {
    const inp = $("partyChatInput");
    const t = inp.value.trim().slice(0, 160);
    if (!t || state.mode !== "online" || !state.sockOpen) return;
    inp.value = "";
    rpc("chat", JSON.stringify({ code: state.roomCode, text: t })).then((r) => {
      if (r && !r.ok) CF.flash("Chat blocked (" + r.err + ").");
    }).catch(() => {});
  }

  /* ─── game log ─── */
  function logEntry(t) {
    log.push(t);
    if (log.length > 80) log.shift();
    updateLog();
  }
  function updateLog() {
    const el = $("logEl");
    if (!el) return;
    el.innerHTML = log.map((l) => '<div class="log-item">' + l + "</div>").join("");
    el.scrollTop = el.scrollHeight;
  }

  /* ─── status / turn indicator ─── */
  function statusText() {
    if (!state.sockOpen) return "Connecting…";
    if (state.status === 3) {
      return state.winner != null
        ? (state.winner === state.role ? "You claimed the win — session over!" : "Player " + (state.winner + 1) + " claimed the win — session over!")
        : "Session over";
    }
    if (state.status === 1) return "Waiting for players… share the code " + (state.roomCode || "");
    return state.seats.filter((s) => s && s.card).length + "/" + SEATS + " heroes at the table";
  }
  function turnText() {
    if (!state.sockOpen) return "Connecting…";
    if (state.status === 3) return "Session complete";
    if (state.turn >= 0) {
      const sc = state.seats[state.turn];
      const who = sc && sc.card ? sc.card.n : "Player " + (state.turn + 1);
      return state.turn === state.role ? "🎲 Your turn — " + who : "🎲 " + who + "'s turn";
    }
    return "No turn yet";
  }

  /* ─── rendering ─── */
  function renderJoin() {
    const inp = $("joinCodeInput");
    if (inp) inp.value = "";
    partyMsg("");
  }

  function updateTable() {
    const seatsEl = $("partySeats");
    if (!seatsEl) return;
    const myRole = state.role;
    seatsEl.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => seatCard(i)).join("");

    const turnEl = $("turnEl");
    if (turnEl) turnEl.textContent = turnText();
    const nb = $("nextTurnBtn");
    if (nb) {
      nb.hidden = !(state.sockOpen && state.status !== 3);
      nb.disabled = !(state.turn === myRole || state.turn === -1);
    }
    const rc = $("roomCodeEl");
    if (rc) rc.textContent = state.roomCode || "—";
    const ce = $("partyConnEl");
    if (ce) ce.textContent = state.sockOpen ? "Connected" : "Connecting…";
    const lb = $("linkHeroBtn");
    if (lb) lb.hidden = !state.myChar;
    const cb = $("claimBtn");
    if (cb) cb.disabled = state.status === 3;
    if (window.updateBanner) window.updateBanner($("partyBanner"), statusText());
  }

  const seatCard = (i) => {
    const s = state.seats[i] || {};
    let card = s.card || null;
    const mine = i === state.role;
    if (mine && state.myChar && !card) card = cardFor(state.myChar);
    const occupied = !!card;
    const present = !!s.in;
    if (occupied) {
      const kl = card.k ? D.classes[card.k] : null;
      const sp = card.sp ? D.species[card.sp] : null;
      const down = card.hp <= 0;
      return `
      <div class="seat-card${mine ? " mine" : ""}${down ? " down" : ""}${!present ? " gone" : ""}">
        <span class="seat-presence" title="${present ? "at the table" : "away"}"></span>
        <div class="seat-avatar">${kl ? kl.icon : "❓"}</div>
        <div class="seat-name">${esc(card.n)}${mine ? " <span class='seat-you'>YOU</span>" : ""}${!present ? " <span class='seat-gone'>(away)</span>" : ""}</div>
        <div class="seat-line">${kl ? kl.name : "?"} ${card.l} · ${sp ? sp.name : "?"}</div>
        <div class="seat-line muted small">HP ${card.hp != null ? card.hp : "?"}/${card.mhp != null ? card.mhp : "?"} · AC ${card.ac != null ? card.ac : "?"}${card.align ? " · " + esc(card.align) : ""}</div>
        <div class="seat-hpbar"><div style="width:${card.mhp ? Math.max(0, Math.min(100, (card.hp / card.mhp) * 100)) : 0}%"></div></div>
      </div>`;
    }
    return `
    <div class="seat-card empty">
      ${mine ? `
        <div class="seat-empty-inner">
          <div class="seat-name">Your seat</div>
          ${state.myChar ? `
            <div class="seat-line muted small">Bringing: ${esc(state.myChar.name || "unnamed")}</div>
            <button class="btn btn-ghost btn-sm" onclick="CF.party.pickChar()">${state.myChar.name ? "Swap character" : "Choose character"}</button>` :
            `<button class="btn btn-gold btn-sm" onclick="CF.party.pickChar()">🎒 Bring a character</button>`}
        </div>` : `<div class="seat-empty-inner"><div class="seat-name">Open seat ${i + 1}</div><div class="muted small">Waiting…</div></div>`}
    </div>`;
  };

  /* character picker modal */
  P.pickChar = function () {
    const overlay = $("charPickOverlay");
    const list = $("charPickList");
    list.innerHTML = "";
    C.loadChars().then((chars) => {
      if (!chars.length) { list.innerHTML = `<p class="muted">No characters yet — create one in the Character Forge first.</p>`; }
      chars.forEach((c) => {
        const kl = c.klass ? D.classes[c.klass] : null;
        const row = document.createElement("button");
        row.className = "pick-row";
        row.innerHTML = `<span class="pick-icon">${kl ? kl.icon : "❓"}</span><span><b>${esc(c.name)}</b><br><small class="muted">${kl ? kl.name : "?"} ${c.level} · ${c.species ? D.species[c.species].name : "?"}</small></span><span class="pick-hp">HP ${c.hp ? c.hp.current : "?"}/${c.hp ? (c.hp.maxSet ? c.hp.max : C.maxHP(c)) : "?"} · AC ${C.ACFor(c)}</span>`;
        row.addEventListener("click", () => { P.bringCharacter(c); overlay.hidden = true; });
        list.appendChild(row);
      });
    });
    overlay.hidden = false;
  };
  P.closePick = function () { $("charPickOverlay").hidden = true; };
  P.copyCode = function () {
    try { navigator.clipboard.writeText(state.roomCode || ""); CF.flash("Table code copied!"); } catch (e) { CF.flash(state.roomCode || ""); }
  };
  /* save the current table code onto the hero at my seat */
  P.linkTable = function () {
    const ch = state.myChar;
    if (!ch || !state.roomCode) { CF.flash("Bring a hero to your seat first."); return; }
    ch.gameRoom = state.roomCode;
    C.saveChar(ch);
    CF.flash(ch.name + " is now linked to table " + state.roomCode + "."); CF.sfx("chip");
  };

  /* action buttons (BGN standard) */
  P.newGame = function () {
    if (state.mode !== "online" || !state.sockOpen) return;
    CF.flash("Starting a new table…"); CF.sfx("deal");
    state.mode = null;
    rpc("leave", "").catch(() => {}).then(() => {
      log = []; updateLog();
      state.turn = -1; state.winner = null; state._winLogged = false; state.seats = []; state.status = 1;
      doCreate();
    });
  };
  P.claimWin = function () {
    if (state.mode !== "online" || !state.sockOpen) return;
    if (state.status === 3) { CF.flash("This table has already ended."); return; }
    rpc("claimWin", "").then((r) => {
      if (!r || !r.ok) {
        if (r && r.err === "not_your_turn") CF.flash("Only the current turn holder can claim the win.");
        else CF.flash(r && r.err ? "Couldn't claim — " + r.err + "." : "Server error — please retry.");
        return;
      }
      CF.flash("Victory claimed — session over!");
    }).catch(() => { CF.flash("Server error — please retry."); });
  };
  P.menu = function () {
    const b = $("helpBtn");
    if (b) b.click();
  };
  P.nextTurn = function () {
    if (state.mode !== "online" || !state.sockOpen) return;
    rpc("nextTurn", "").then((r) => {
      if (!r || !r.ok) {
        if (r && r.err === "not_your_turn") CF.flash("It's not your turn.");
        else CF.flash(r && r.err ? "Next turn failed (" + r.err + ")." : "Server error — please retry.");
        return;
      }
      CF.sfx("chip");
    }).catch(() => { CF.flash("Server error — please retry."); });
  };

  P.status = function () {
    return { mode: state.mode, roomCode: state.roomCode, role: state.role, sockOpen: state.sockOpen, hasSocket: !!state.socket, wantReconnect: state.wantReconnect };
  };

  /* keep card in sync while attached */
  P.syncCard = function () { cardDeb(); };

  function wireJoin() {
    $("createRoomBtn").addEventListener("click", P.create);
    $("partyJoinBtn").addEventListener("click", () => {
      const c = ($("joinCodeInput").value || "").trim().toUpperCase();
      if (c.length < 5) { partyMsg("Enter the 5-letter room code."); return; }
      state.wantReconnect = true; connectSocket(); doJoin(c);
    });
    const code = $("joinCodeInput");
    code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5); });
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") $("partyJoinBtn").click(); });
  }
  function wireRoom() {
    $("copyCodeBtn").addEventListener("click", P.copyCode);
    $("leaveBtn").addEventListener("click", P.exit);
    $("partySwapBtn").addEventListener("click", () => P.pickChar());
    $("partyChatSend").addEventListener("click", sendChat);
    $("partyChatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
    $("linkHeroBtn").addEventListener("click", P.linkTable);
    $("newGameBtn").addEventListener("click", P.newGame);
    $("claimBtn").addEventListener("click", P.claimWin);
    $("menuBtn").addEventListener("click", P.menu);
    $("nextTurnBtn").addEventListener("click", P.nextTurn);
  }

  P.init = function () {
    wireJoin();
    wireRoom();
    $("partyMenu").addEventListener("click", () => P.exit());
    $("charPickOverlay").addEventListener("click", (e) => { if (e.target === $("charPickOverlay")) P.closePick(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("charPickOverlay").hidden) P.closePick(); });
  };
})();
