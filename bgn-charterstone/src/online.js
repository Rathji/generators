// src/online.js — Phase 14 client wrapper for the server-plugin room server.
// A small WebSocket-facade client: rooms (1-6 seats), join codes, presence,
// chat, the authoritative shared game snapshot + campaign string, and
// capped auto-reconnect. The server (the <script type="text/x-server-plugin">
// element in index.html) is authoritative for membership / turn counter /
// chat / persistence; game logic stays in the engine, so every move carries
// the full serialized snapshot (src/serialization.js) which the server
// stores and rebroadcasts — reconnects therefore re-sync an identical board.

export const ONLINE_VERSION = 1;

export function defaultSocketFactory() {
  const r = (typeof window !== "undefined" && window.root) || null;
  return r && typeof r.createServerSocket === "function" ? r.createServerSocket() : null;
}

export function createOnlineClient(opts = {}) {
  const name = String(opts.name || "Player").trim().slice(0, 24) || "Player";
  const factory = opts.socketFactory || defaultSocketFactory;
  const autoReconnect = opts.autoReconnect !== false;
  const maxRetries = opts.maxRetries ?? 8;
  const baseDelay = opts.connectDelay ?? 800;

  const listeners = new Map();
  let socket = null;
  let open = false;
  let roomCode = null;
  let seat = -1;
  let snap = null;
  let retries = 0;
  let wantReconnect = autoReconnect;
  let closed = false;
  let openResolvers = [];

  function emit(evt, data) {
    for (const fn of listeners.get(evt) || []) {
      try { fn(data); } catch (e) { /* listener errors must not break the client */ }
    }
  }
  function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return client;
  }
  function off(evt, fn) {
    const s = listeners.get(evt);
    if (s) s.delete(fn);
    return client;
  }
  function opened() {
    if (open) return Promise.resolve(true);
    return new Promise(res => { openResolvers.push(res); });
  }

  function handleMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "snap") { snap = msg.snap; emit("snap", msg.snap); }
    else if (msg.t === "presence") {
      if (snap) snap.seats = msg.seats;
      else snap = { code: msg.code, seats: msg.seats };
      emit("presence", msg);
    }
    else if (msg.t === "chat") emit("chat", msg);
    else if (msg.t === "on") emit("online", msg.n);
  }

  function scheduleReconnect(code) {
    if (closed || !wantReconnect) return;
    if (code === 4403 || code === 1000) { closed = true; return; }
    if (retries >= maxRetries) { closed = true; return; }
    retries++;
    const delay = Math.min(15000, baseDelay * Math.pow(1.7, retries - 1));
    setTimeout(() => { connect(); }, delay + Math.random() * 500);
  }

  function teardownSocket() {
    if (!socket) return;
    try { socket.removeEventListener("open", handleOpen); } catch (e) {}
    try { socket.removeEventListener("message", handleMessage); } catch (e) {}
    try { socket.removeEventListener("close", handleClose); } catch (e) {}
    socket = null;
  }

  function handleOpen() {
    open = true;
    retries = 0;
    const rs = openResolvers; openResolvers = [];
    for (const r of rs) r(true);
    emit("open");
    if (roomCode) {
      // reconnect path: re-bind to the old seat and re-sync the board
      rpc("joinRoom", JSON.stringify({ code: roomCode, name, seat }))
        .then(r => { if (r && r.snap) snap = r.snap; })
        .catch(() => {});
    }
  }

  function handleClose(ev) {
    open = false;
    const code = ev && ev.code;
    const rs = openResolvers; openResolvers = [];
    for (const r of rs) r(false);
    emit("close", { code });
    teardownSocket();
    scheduleReconnect(code);
  }

  function connect() {
    if (closed) return Promise.resolve(false);
    if (socket && (open || socket.readyState === 0)) return opened();
    teardownSocket();
    try { socket = factory(); } catch (e) { socket = null; }
    if (!socket) { closed = true; return Promise.resolve(false); }
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    return opened();
  }

  function close() {
    closed = true;
    wantReconnect = false;
    const s = socket;
    socket = null;
    if (s) {
      try { s.removeEventListener("open", handleOpen); } catch (e) {}
      try { s.removeEventListener("message", handleMessage); } catch (e) {}
      try { s.removeEventListener("close", handleClose); } catch (e) {}
      try { s.close(); } catch (e) {}
    }
    open = false;
  }

  function rpc(method, data) {
    if (!socket || !open) return Promise.reject(new Error("socket not open"));
    return Promise.resolve()
      .then(() => socket.rpc[method](data || ""))
      .then(raw => {
        try { return JSON.parse(raw); } catch (e) { return { ok: false, err: "parse" }; }
      });
  }
  function rawRpc(method, data) {
    if (!socket || !open) return Promise.reject(new Error("socket not open"));
    return Promise.resolve().then(() => socket.rpc[method](data || ""));
  }

  const client = {
    get name() { return name; },
    get seat() { return seat; },
    get roomCode() { return roomCode; },
    get snap() { return snap; },
    get isOpen() { return open; },
    get isClosed() { return closed; },
    on, off, connect, close, opened, rawRpc,

    async createRoom({ name: myName, maxSeats } = {}) {
      await opened();
      const r = await rpc("createRoom", JSON.stringify({ name: myName || name, maxSeats: Number(maxSeats) || 6 }));
      if (r && r.ok) { roomCode = r.code; seat = r.seat; snap = r.snap; }
      return r;
    },
    async joinRoom({ code, name: myName, seat: wantSeat } = {}) {
      await opened();
      const r = await rpc("joinRoom", JSON.stringify({ code, name: myName || name, seat: Number.isFinite(wantSeat) ? wantSeat : -1 }));
      if (r && r.ok) { roomCode = r.code || (r.snap && r.snap.code) || roomCode; seat = r.seat; snap = r.snap; }
      return r;
    },
    async getRoom(code) {
      const r = await rpc("getRoom", code || roomCode || "");
      if (r && r.snap) snap = r.snap;
      return r;
    },
    async startGame() {
      const r = await rpc("startGame", JSON.stringify({ code: roomCode }));
      if (r && r.snap) snap = r.snap;
      return r;
    },
    async submitMove({ turn, snapshot }) {
      return rpc("move", JSON.stringify({ code: roomCode, seat, turn: Number(turn), snapshot: String(snapshot) }));
    },
    async endGame({ winner }) {
      return rpc("endGame", JSON.stringify({ code: roomCode, winner }));
    },
    async resign() {
      return rpc("resign", JSON.stringify({ code: roomCode }));
    },
    async submitCampaign(campaign) {
      return rpc("submitCampaign", JSON.stringify({ code: roomCode, campaign: String(campaign) }));
    },
    async chat(text) {
      return rpc("chat", JSON.stringify({ code: roomCode, text: String(text) }));
    },
    async leave() {
      const r = await rpc("leave", roomCode || "");
      roomCode = null; seat = -1; snap = null;
      return r;
    },
    async online() {
      const r = await rpc("online", "");
      return r && r.ok ? r.n : 0;
    },
  };
  return client;
}
