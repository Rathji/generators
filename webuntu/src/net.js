// Webuntu OS — Online presence + chat (POST-52, Task 57)
// server-plugin client. Talks to the <script type="text/x-server-plugin"> block
// in index.html and powers two surfaces:
//   - a tray button (#trayOnline): live "N users online" dot + an unread badge
//   - the Perch Chat app (AppContent["chat"]): history, live messages, editable
//     display name, rate-limit feedback
// Production sockets only run on perchance.org pages (else the server closes
// them with 4403 — treated as permanent offline, no reconnect loop). While the
// code is unsaved, the plugin's one-tab emulator serves this same API.

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";
  const RETRY_BASE = 1200, RETRY_MAX = 30000;
  const NAME_MAX = 24, TEXT_MAX = 240;

  const state = {
    socket: null,
    opened: false,
    permanent: false,
    connecting: false,
    onlineCount: 0,
    users: new Set(),
    myName: null,
    unread: 0,
    attempts: 0,
    reconnectTimer: null,
    history: [],
    subs: new Set(),
    chatSubs: new Set(),
    historySubs: new Set(),
    noticeSubs: new Set(),
  };

  // ---------- settings / name ----------
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try {
      const s = Object.assign(loadSettings(), patch);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {}
  }
  function byteTruncate(s, maxBytes) {
    const enc = new TextEncoder();
    let bytes = enc.encode(s);
    if (bytes.length <= maxBytes) return s;
    while (s.length > 0) {
      s = s.slice(0, -1);
      bytes = enc.encode(s);
      if (bytes.length <= maxBytes) break;
    }
    return s;
  }
  function defaultName() {
    let name = "";
    try {
      const acct = window.OS && window.OS.currentUser;
      if (acct) {
        const accounts = JSON.parse(localStorage.getItem("webuntu.accounts") || "{}");
        name = (accounts[acct] && accounts[acct].displayName) || acct;
      }
    } catch (e) {}
    name = String(name || "").trim();
    return name || ("Guest" + Math.floor(100 + Math.random() * 900));
  }
  function myName() {
    if (state.myName) return state.myName;
    state.myName = String(loadSettings().chatName || "").trim() || defaultName();
    return state.myName;
  }
  function setName(raw) {
    let name = String(raw || "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
    name = byteTruncate(name, NAME_MAX);
    if (!name || name === state.myName) return;
    state.myName = name;
    saveSettings({ chatName: name });
    rpcJoin();
    emit();
  }

  // ---------- eventing ----------
  function subscribe(fn) { state.subs.add(fn); return () => state.subs.delete(fn); }
  function subscribeChat(fn) { state.chatSubs.add(fn); return () => state.chatSubs.delete(fn); }
  function subscribeHistory(fn) { state.historySubs.add(fn); return () => state.historySubs.delete(fn); }
  function emit() { for (const fn of state.subs) { try { fn(); } catch (e) {} } }
  function emitChat(item) { for (const fn of state.chatSubs) { try { fn(item); } catch (e) {} } }
  function emitHistory() { for (const fn of state.historySubs) { try { fn(); } catch (e) {} } }

  // ---------- socket lifecycle ----------
  function backoffDelay() {
    const exp = Math.min(RETRY_MAX, RETRY_BASE * Math.pow(2, Math.min(state.attempts, 6)));
    return Math.round(exp * (0.6 + Math.random() * 0.8));
  }
  function scheduleReconnect(delay) {
    if (state.permanent || state.reconnectTimer) return;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }
  function connect() {
    if (state.connecting) return;
    if (!root || !root.createServerSocket) {
      state.permanent = true;
      renderAll();
      return;
    }
    state.connecting = true;
    let socket;
    try { socket = root.createServerSocket(); }
    catch (e) {
      state.connecting = false;
      state.permanent = true;
      renderAll();
      return;
    }
    state.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => onOpen(socket));
    socket.addEventListener("message", (ev) => onMessage(ev.data));
    socket.addEventListener("close", (ev) => onClose(ev));
    // A failed initial connection rejects `opened` — swallow it; onClose drives
    // the retry/offline path so no app hangs on a pending connection.
    if (socket.opened && socket.opened.catch) socket.opened.catch(() => {});
    renderAll();
  }

  function onOpen(socket) {
    if (state.socket !== socket) return; // stale socket (superceded reconnect)
    state.connecting = false;
    state.opened = true;
    state.permanent = false;
    state.attempts = 0;
    rpcJoin();
    rpcGetHistory();
    rpcGetUsers();
    renderAll();
  }

  function onClose(ev) {
    state.opened = false;
    state.connecting = false;
    if (state.socket) state.socket = null;
    // 4403 = perchance.org-only restriction: permanent, do not retry.
    if (ev && ev.code === 4403) { state.permanent = true; renderAll(); return; }
    let delay = backoffDelay();
    if (ev && ev.reason) {
      const m = /retry[^0-9]*([0-9]+)/i.exec(String(ev.reason));
      if (m) delay = Math.max(delay, Number(m[1]) * 1000);
    }
    state.attempts++;
    scheduleReconnect(delay);
    renderAll();
  }

  // ---------- rpc ----------
  function rpcCall(method, payload) {
    const s = state.socket;
    if (!s || !s.rpc || !state.opened) return null;
    try {
      const p = s.rpc[method](payload || "");
      if (p && p.catch) p.catch(() => {});
      return p || null;
    } catch (e) { return null; }
  }
  function rpcJoin() { rpcCall("join", JSON.stringify({ name: myName() })); }
  function rpcGetHistory() {
    const p = rpcCall("getHistory");
    if (!p || !p.then) return;
    p.then((reply) => {
      try {
        const data = JSON.parse(reply);
        if (data && Array.isArray(data.msgs)) {
          state.history = data.msgs.map((m) => ({
            from: String(m.from || ""), text: String(m.text || ""), ts: Number(m.ts) || 0,
          }));
          emitHistory();
        }
      } catch (e) {}
    }).catch(() => {});
  }
  function rpcGetUsers() {
    const p = rpcCall("getUsers");
    if (!p || !p.then) return;
    p.then((reply) => {
      try {
        const data = JSON.parse(reply);
        if (data && data.ok) {
          state.onlineCount = Number(data.n) || 0;
          state.users = new Set((data.names || []).map(String));
          renderAll();
        }
      } catch (e) {}
    }).catch(() => {});
  }

  // ---------- incoming ----------
  function onMessage(data) {
    if (typeof data !== "string") return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "online") {
      state.onlineCount = Number(msg.n) || 0;
      renderAll();
    } else if (msg.t === "join") {
      if (msg.name) { state.users.add(String(msg.name)); renderAll(); }
    } else if (msg.t === "leave") {
      if (msg.name) { state.users.delete(String(msg.name)); renderAll(); }
    } else if (msg.t === "resync") {
      // server rebuilt its globals while our socket survived — re-announce + refetch
      rpcJoin();
      rpcGetHistory();
      rpcGetUsers();
    } else if (msg.t === "chat") {
      onChatMessage(String(msg.from || "?"), String(msg.text || ""), Number(msg.ts) || 0);
    } else if (msg.t === "notice") {
      emitNotice(String(msg.msg || ""));
    }
  }

  function onChatMessage(from, text, ts) {
    const item = { from, text, ts };
    state.history.push(item);
    if (state.history.length > 200) state.history.shift();
    emitChat(item);
    if (window.Sounds && chatOpen()) window.Sounds.play("notify");
    if (!chatFocused()) { state.unread++; }
    if (!chatFocused() && window.Notify) {
      // Desktop notification for messages that arrive while chat isn't focused.
      window.Notify.push({
        app: "Perch Chat", icon: "💬", title: from, body: text,
        onClick() { if (window.Net) window.Net.openChat(); },
      });
    }
    renderAll();
  }

  function emitNotice(msg) { for (const fn of state.noticeSubs) { try { fn(msg); } catch (e) {} } }

  // ---------- focus helpers ----------
  function chatOpen() { return !!(window.WM && window.WM.findByAppId("chat")); }
  function chatFocused() {
    const w = window.WM && window.WM.findByAppId("chat");
    const f = window.WM && window.WM.getFocused && window.WM.getFocused();
    return !!(w && f && f.id === w.id);
  }

  // ---------- tray widget ----------
  const trayBtn = document.getElementById("trayOnline");
  const trayDot = trayBtn && trayBtn.querySelector(".to-dot");
  const trayCount = trayBtn && trayBtn.querySelector(".to-count");
  const trayBadge = trayBtn && trayBtn.querySelector(".to-badge");

  function renderTray() {
    if (!trayBtn) return;
    if (state.permanent) {
      trayBtn.classList.remove("online", "connecting");
      trayBtn.classList.add("offline");
      trayBtn.title = "Perch Chat — online features are unavailable on this page";
      if (trayDot) trayDot.style.background = "var(--danger)";
      if (trayCount) trayCount.textContent = "—";
    } else if (state.opened) {
      const n = state.onlineCount;
      trayBtn.classList.add("online");
      trayBtn.classList.remove("offline", "connecting");
      trayBtn.title = "Perch Chat — " + n + (n === 1 ? " user online" : " users online");
      if (trayDot) trayDot.style.background = "var(--success)";
      if (trayCount) trayCount.textContent = n;
    } else {
      trayBtn.classList.add("connecting");
      trayBtn.classList.remove("online", "offline");
      trayBtn.title = "Perch Chat — connecting…";
      if (trayDot) trayDot.style.background = "var(--warning)";
      if (trayCount) trayCount.textContent = "…";
    }
    if (trayBadge) {
      trayBadge.textContent = state.unread > 9 ? "9+" : state.unread || "";
      trayBadge.hidden = state.unread === 0;
    }
  }

  function openChat() {
    if (window.StartMenu) window.StartMenu.close();
    state.unread = 0;
    renderTray();
    if (window.Apps) window.Apps.launch("chat");
  }
  if (trayBtn) trayBtn.addEventListener("click", openChat);

  // WM has no event bus — poll focus so a newly focused chat window clears its badge.
  setInterval(() => {
    if (chatFocused() && state.unread) { state.unread = 0; renderTray(); }
  }, 400);

  // ---------- chat window ----------
  function buildChatWindow() {
    const rootEl = document.createElement("div");
    rootEl.className = "chat-app";

    const head = document.createElement("div");
    head.className = "chat-head";
    const title = document.createElement("div");
    title.className = "chat-title";
    title.textContent = "💬 Perch Chat";
    const pill = document.createElement("div");
    pill.className = "chat-pill";
    const dot = document.createElement("span");
    dot.className = "chat-pill-dot";
    const pillTxt = document.createElement("span");
    pillTxt.className = "chat-pill-txt";
    pill.append(dot, pillTxt);
    head.append(title, pill);
    rootEl.appendChild(head);

    const status = document.createElement("div");
    status.className = "chat-status";
    status.hidden = true;
    rootEl.appendChild(status);

    const youRow = document.createElement("div");
    youRow.className = "chat-you";
    const youLabel = document.createElement("span");
    youLabel.className = "muted";
    youLabel.textContent = "You:";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "chat-name-input";
    nameInput.maxLength = NAME_MAX;
    nameInput.value = myName();
    nameInput.title = "Display name shown to other users";
    nameInput.setAttribute("aria-label", "Your display name");
    const nameSave = document.createElement("button");
    nameSave.type = "button";
    nameSave.className = "set-btn";
    nameSave.textContent = "Set name";
    youRow.append(youLabel, nameInput, nameSave);
    rootEl.appendChild(youRow);

    const listWrap = document.createElement("div");
    listWrap.className = "chat-list-wrap";
    const list = document.createElement("div");
    list.className = "chat-list";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chat-chip";
    chip.textContent = "▼ New messages";
    chip.hidden = true;
    chip.addEventListener("click", () => { list.scrollTop = list.scrollHeight; chip.hidden = true; });
    listWrap.append(list, chip);
    rootEl.appendChild(listWrap);

    const foot = document.createElement("div");
    foot.className = "chat-foot";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-input";
    input.placeholder = "Message…";
    input.maxLength = 120;
    input.setAttribute("aria-label", "Chat message");
    const send = document.createElement("button");
    send.type = "button";
    send.className = "chat-send";
    send.textContent = "Send";
    foot.append(input, send);
    rootEl.appendChild(foot);

    // ---------- rendering ----------
    function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 60; }
    function scrollBottom() { list.scrollTop = list.scrollHeight; }

    function renderPresence() {
      const n = state.onlineCount;
      const open = state.opened && !state.permanent;
      dot.style.background = state.permanent ? "var(--danger)"
        : state.opened ? "var(--success)" : "var(--warning)";
      pillTxt.textContent = state.permanent ? "Offline" : open ? n + " online" : "Connecting…";
      if (open) {
        const others = [...state.users].filter((x) => x !== state.myName);
        pill.title = others.length
          ? n + " online — " + others.slice(0, 8).join(", ") + (others.length > 8 ? "…" : "")
          : n + " online";
      } else {
        pill.title = state.permanent ? "Online features are only available on the perchance.org page"
          : "Connecting to Perch servers…";
      }
      if (state.permanent) {
        status.textContent = "Online features are only available on the perchance.org page.";
        status.hidden = false;
      } else if (!state.opened) {
        status.textContent = "Connecting to Perch servers…";
        status.hidden = false;
      } else {
        status.hidden = true;
      }
      const disabled = !state.opened || state.permanent;
      input.disabled = disabled;
      send.disabled = disabled;
      input.placeholder = state.permanent ? "Offline" : !state.opened ? "Connecting…" : "Message…";
    }

    function timeStr(ts) {
      return ts ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    }

    function appendMessage(from, text, ts, isBulk) {
      const own = from === state.myName;
      const row = document.createElement("div");
      row.className = "chat-msg " + (own ? "own" : "other");
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble";
      if (!own) {
        const who = document.createElement("div");
        who.className = "chat-msg-from";
        who.textContent = from;
        bubble.appendChild(who);
      }
      const body = document.createElement("div");
      body.className = "chat-msg-text";
      body.textContent = text; // textContent, never innerHTML — untrusted input
      bubble.appendChild(body);
      const when = document.createElement("div");
      when.className = "chat-msg-when";
      when.textContent = timeStr(ts);
      bubble.appendChild(when);
      row.appendChild(bubble);
      list.appendChild(row);
      if (isBulk) return;
      if (nearBottom()) scrollBottom();
      else chip.hidden = false;
    }

    function renderHistory() {
      list.textContent = "";
      for (const m of state.history) appendMessage(m.from, m.text, m.ts, true);
      chip.hidden = true;
      scrollBottom();
    }

    list.addEventListener("scroll", () => { if (nearBottom()) chip.hidden = true; });

    function showNotice(msg) {
      status.textContent = msg;
      status.hidden = false;
      setTimeout(() => {
        if (status.textContent === msg) status.hidden = true;
      }, 4000);
    }

    // ---------- actions ----------
    function sendMessage() {
      const text = byteTruncate(input.value, TEXT_MAX).trim();
      if (!text) return;
      const s = state.socket;
      if (!s || !state.opened) return;
      try { s.send(JSON.stringify({ t: "chat", text })); input.value = ""; input.focus(); }
      catch (e) {}
    }
    function commitName() {
      setName(nameInput.value);
      nameInput.value = state.myName;
    }

    send.addEventListener("click", sendMessage);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); sendMessage(); }
    });
    nameSave.addEventListener("click", commitName);
    nameInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commitName(); }
    });
    nameInput.addEventListener("blur", commitName);

    // ---------- wiring ----------
    const offChat = subscribeChat((item) => appendMessage(item.from, item.text, item.ts, false));
    const offHistory = subscribeHistory(renderHistory);
    const offPresence = subscribe(renderPresence);
    const offNotice = subscribeNotice(showNotice);

    state.unread = 0;
    renderPresence();
    renderHistory();

    return {
      root: rootEl,
      onCloseRequest() {
        offChat(); offHistory(); offPresence(); offNotice();
      },
    };
  }

  window.AppContent = window.AppContent || {};
  window.AppContent["chat"] = function () {
    const built = buildChatWindow();
    return { content: built.root, w: 460, h: 560, minW: 320, minH: 380, onCloseRequest: built.onCloseRequest };
  };

  // ---------- notices (rate-limit feedback) ----------
  function subscribeNotice(fn) { state.noticeSubs.add(fn); return () => state.noticeSubs.delete(fn); }

  function renderAll() {
    renderTray();
    emit();
  }

  function refresh() {
    rpcJoin();
    rpcGetHistory();
    rpcGetUsers();
  }

  // ---------- public ----------
  window.Net = {
    connect,
    openChat,
    refresh,
    setName,
    send(text) {
      text = byteTruncate(String(text || ""), TEXT_MAX).trim();
      if (!text || !state.opened) return false;
      try { state.socket.send(JSON.stringify({ t: "chat", text })); return true; }
      catch (e) { return false; }
    },
    subscribe,
    subscribeChat,
    subscribeHistory,
    subscribeNotice,
    get status() { return state.permanent ? "offline" : state.opened ? "online" : "connecting"; },
    get onlineCount() { return state.onlineCount; },
    get users() { return [...state.users]; },
    get myName() { return myName(); },
    get unread() { return state.unread; },
    get history() { return state.history; },
  };

  connect();
})();
