// ============================================================================
// quote-u — realtime collaboration hub (roadmap tasks 69–70)
// ----------------------------------------------------------------------------
// An OPTIONAL companion hub over the server-plugin socket (see index.html's
// `type="text/x-server-plugin"` script). When it is switched on it:
//
//   * authenticates each internal user to a ROLE (owner / manager / viewer) on
//     the authoritative server, which derives that role from the connection —
//     never from client-supplied data;
//   * streams quote / approval / invoice document changes to every open session
//     within seconds (the `hqc:<module>` topics), and pushes presence updates
//     (`hqp`) so collaborators see who else is online and on which record;
//   * lets several internal users edit a draft together with presence markers;
//   * reports every successful local write to the server, where it is recorded
//     in the hub's append-only activity ring attributed to the AUTHENTICATED
//     member, and re-broadcast — so an approval or invoice write is never
//     attributed to the wrong user (the true actor is the connection's identity);
//   * degrades GRACEFULLY to silent polling refresh when the hub is unreachable,
//     and reports every refused / rate-limited write.
//
// The client is not an authority: it never grants itself a role. It only mirrors
// the server's verdict into QU_ROLES (the access model from task 68), which then
// enforces the same rules locally (UI + storage guards + gateway identity).
//
// Everything is injectable for testing: pass a `socketFactory` (a fake socket in
// tests), an explicit `kv`, and a `store`. Nothing here touches the network
// until `boot()` / `enable()` is called.
// ============================================================================
window.QU_HUB = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const CFG_KEY = "hub:cfg";
  const POLL_MS = 30000;
  const CONTEXT_MS = 4000;
  const WRITER_ROLES = { owner: 1, manager: 1 };
  const STATES = ["off", "connecting", "open", "needs_auth", "degraded"];

  const MODULES = [
    "quotes", "quote_versions", "line_items", "option_groups", "price_snapshots",
    "catalog_items", "portal_tokens", "quote_events", "approvals", "invoice_intents",
    "invoice_mappings", "feature_flags", "outbox_jobs", "quote_artifacts", "esignature",
    "legacy_migrations", "write_policy", "gated_writes", "mail_permission", "bus_events",
    "verification_gates", "ops_log"
  ];

  const ERR_MAP = {
    exists: "That name is already a team member.",
    weak_pw: "Passwords must be 12-64 printable characters.",
    bad_name: "Use 1-20 letters, numbers, spaces, dots, dashes or apostrophes.",
    denied: "Name and password do not match a team member — or ask the hub owner to add you first.",
    rate_limited: "Too many attempts. Wait a minute, then try again.",
    forbidden: "Your role does not allow this action.",
    full: "The team is at its member limit.",
    owner_fixed: "The owner role is fixed at setup and cannot be changed or removed.",
    bad_role: "Role must be manager or viewer.",
    not_found: "No such member.",
    self: "You cannot remove your own membership here.",
    mismatch: "The two passwords do not match — this is the first sign-in, so your password creates the hub.",
    connect_failed: "Could not reach the live hub — try again in a moment."
  };

  function errMsg(code) {
    return ERR_MAP[code] || (code === "no_hub" ? "This generator's live hub has not been set up yet." : "The live hub request failed — try again.");
  }

  function parseMsg(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  const PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+?";

  function genPassword() {
    let s = "";
    const c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : (typeof self !== "undefined" ? self.crypto : null);
    if (c && c.getRandomValues) {
      const b = new Uint8Array(16);
      c.getRandomValues(b);
      for (let i = 0; i < b.length; i++) s += PASSWORD_CHARS[b[i] % PASSWORD_CHARS.length];
    } else {
      for (let i = 0; i < 16; i++) s += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
    }
    return s;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function createService(opts) {
    opts = opts || {};

    const roles = opts.roles || null;
    const audit = opts.audit || null;
    const pollMs = opts.pollMs || POLL_MS;
    const contextMs = opts.contextMs || CONTEXT_MS;
    const socketFactory = opts.socketFactory || defaultSocketFactory;
    let kv = opts.kv || null;
    let store = opts.store || null;
    if (!kv) kv = defaultKv();

    // ---- mutable state -----------------------------------------------------
    let state = "off";
    let me = null;              // { id, name, role }
    let people = [];
    let online = 0;
    let cfg = { enabled: false, name: "" };
    let sessionPw = "";         // in memory only — NEVER persisted
    let socket = null;
    let backoff = 3000;
    let closedByUs = false;
    let permanentFail = false;
    let pollTimer = null;
    let reconnectTimer = null;
    let contextTimer = null;
    let contextDirty = false;
    let lastContext = { page: "", module: "", recordId: "" };
    let pendingContext = null;
    let activeModule = "quotes";
    let writeWrap = null;
    const snapshots = new Map();
    const listeners = {};
    const activity = [];        // last N remote changes we observed (client-side)
    const RECENT_CAP = 40;

    // ---- tiny emitter ------------------------------------------------------
    function on(ev, fn) {
      if (typeof fn !== "function") return () => {};
      (listeners[ev] = listeners[ev] || []).push(fn);
      return () => off(ev, fn);
    }
    function off(ev, fn) {
      const a = listeners[ev]; if (!a) return;
      const i = a.indexOf(fn); if (i !== -1) a.splice(i, 1);
    }
    function emit(ev, payload) {
      (listeners[ev] || []).slice().forEach(fn => { try { fn(payload); } catch (e) {} });
    }

    function setState(s) {
      if (STATES.indexOf(s) === -1) return;
      if (state === s) { emit("state", snapshot()); return; }
      state = s;
      emit("state", snapshot());
    }

    function snapshot() {
      return {
        state,
        hasHub: cfg.enabled,
        name: cfg.name,
        me: me ? { id: me.id, name: me.name, role: me.role } : null,
        role: me ? me.role : null,
        online,
        people: people.slice()
      };
    }

    function pushActivity(entry) {
      activity.unshift(entry);
      if (activity.length > RECENT_CAP) activity.length = RECENT_CAP;
    }

    // ---- config ------------------------------------------------------------
    async function loadCfg() {
      try {
        if (kv) cfg = Object.assign({ enabled: false, name: "" }, (await kv.get(CFG_KEY)) || {});
      } catch (e) { cfg = { enabled: false, name: "" }; }
      cfg.enabled = !!cfg.enabled;
      cfg.name = String(cfg.name || "");
      return cfg;
    }
    async function saveCfg() {
      try { if (kv) await kv.set(CFG_KEY, cfg); } catch (e) {}
    }

    async function clearCfg() {
      cfg = { enabled: false, name: "" };
      try { if (kv) await kv.delete(CFG_KEY); } catch (e) {}
    }

    // ---- identity wiring ---------------------------------------------------
    // Mirror the server's verdict into the access model. The hub is the ONLY
    // place that sets a "hub" identity; a signed-out client falls back to the
    // policy's default local role.
    function applyIdentity() {
      if (!roles) { syncRolePill(); return; }
      try {
        if (me && roles.setIdentity) roles.setIdentity({ name: me.name, role: me.role, source: "hub" });
        // An unauthenticated client on an ENABLED hub falls back to the least
        // privileged role — losing a connection or signing out must never leave a
        // viewer holding owner powers (the client-side mirror of the server's
        // authoritative role). Local-only mode keeps the policy default.
        else if (roles.clearIdentity) roles.clearIdentity({ hubConfigured: !!cfg.enabled });
      } catch (e) {}
      syncRolePill();
      emit("identity", me ? { name: me.name, role: me.role, source: "hub" } : null);
    }

    // A small topbar pill showing the signed-in hub member + role, and a body
    // class that dims primary actions for a read-only viewer (the storage guard
    // is the real enforcement — this is only an affordance).
    function syncRolePill() {
      if (typeof document === "undefined" || !document.body) return;
      let pill = document.getElementById("hubRolePill");
      if (me) {
        if (!pill) {
          pill = document.createElement("span");
          pill.id = "hubRolePill";
          const anchor = document.querySelector(".topbar .topbar-spacer");
          if (anchor) anchor.insertAdjacentElement("afterend", pill);
        }
        pill.className = "env-pill hub-role-pill " + (me.role === "viewer" ? "viewer" : "writer");
        pill.textContent = me.role + " · " + me.name;
        pill.title = "Signed in to the live hub as " + me.name + " (" + me.role + ").";
      } else if (pill) {
        pill.remove();
      }
      document.body.classList.toggle("role-viewer", !!(me && me.role === "viewer"));
    }

    // ---- socket ------------------------------------------------------------
    function defaultSocketFactory() {
      if (typeof window === "undefined" || !window.root || typeof window.root.createServerSocket !== "function") return null;
      try { return window.root.createServerSocket(); } catch (e) { return null; }
    }

    function defaultKv() {
      const k = (typeof window !== "undefined" && window.root && window.root.kv && window.root.kv.qu);
      return k || null;
    }

    async function jrpc(name, obj) {
      if (!socket || !socket.rpc || typeof socket.rpc[name] !== "function") {
        throw new Error("hub: rpc " + name + " unavailable");
      }
      const raw = await socket.rpc[name](obj === undefined ? "" : JSON.stringify(obj));
      return parseMsg(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) || { ok: false, code: "bad_reply", detail: "The hub returned an unreadable reply." };
    }

    function openSocket() {
      if (socket || permanentFail) return;
      const sock = socketFactory();
      if (!sock) { setState("degraded"); startPoller(); return; }
      setState("connecting");
      socket = sock;
      try { sock.binaryType = "arraybuffer"; } catch (e) {}
      try {
        sock.addEventListener("open", () => onSocketOpen(sock));
        sock.addEventListener("message", e => onSocketMessage(sock, e));
        sock.addEventListener("close", e => onSocketClose(sock, e));
        sock.addEventListener("error", () => {});
      } catch (e) {
        socket = null;
        setState("degraded");
        startPoller();
      }
      // Some socket implementations expose a promise too; use it as a backstop.
      if (sock.opened && typeof sock.opened.then === "function") {
        sock.opened.catch(() => onSocketClose(sock, { code: 0 }));
      }
    }

    function connect() {
      if (socket || permanentFail || !cfg.enabled) return;
      openSocket();
    }

    async function onSocketOpen(sock) {
      if (socket !== sock) return;
      try {
        const info = await jrpc("hubInfo");
        if (!info || !info.ok) throw new Error("hubInfo failed");
        if (cfg.name && sessionPw) {
          const a = await jrpc("hubAuth", { name: cfg.name, password: sessionPw });
          if (socket !== sock) return;
          if (a && a.ok) {
            me = a.me;
          } else {
            setState("needs_auth");
            startPoller();
            return;
          }
        } else if (cfg.name) {
          setState("needs_auth");
          startPoller();
          return;
        }
        if (socket !== sock) return;
        applyIdentity();
        setState("open");
        lastContext = { page: "", module: activeModule, recordId: "" };
        contextDirty = true;
        flushContext(true);
        stopPoller();
        backoff = 3000;
        refreshModule(activeModule);
      } catch (e) {
        if (socket !== sock) return;
        socket = null;
        setState("degraded");
        applyIdentity();
        startPoller();
        scheduleReconnect();
      }
    }

    function onSocketMessage(sock, e) {
      if (socket !== sock) return;
      const m = parseMsg(String(e && e.data !== undefined ? e.data : ""));
      if (!m) return;
      if (m.t === "pres") {
        people = Array.isArray(m.people) ? m.people : [];
        online = typeof m.online === "number" ? m.online : people.length;
        if (me && me.id) {
          const mine = people.find(p => p.id === me.id);
          if (mine && mine.role && mine.role !== me.role) {
            const old = me.role;
            me.role = mine.role;
            applyIdentity();
            toast("Your hub role changed from " + old + " to " + mine.role + ".");
          }
        }
        emit("presence", { online, people: people.slice() });
      } else if (m.t === "chg") {
        if (me && m.actorId === me.id) return;
        handleRemoteChange(m);
      }
    }

    function onSocketClose(sock, e) {
      if (socket !== sock) return;
      const code = e && e.code;
      socket = null;
      people = [];
      online = 0;
      emit("presence", { online: 0, people: [] });
      if (closedByUs || code === 4403) {
        if (code === 4403) permanentFail = true;
        me = null;
        applyIdentity();
        setState("off");
        return;
      }
      me = null;
      applyIdentity();
      setState("degraded");
      startPoller();
      scheduleReconnect();
    }

    function scheduleReconnect() {
      if (permanentFail) return;
      if (reconnectTimer) return;
      const delay = backoff;
      backoff = Math.min(30000, backoff * 2);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!socket && !permanentFail && cfg.enabled) openSocket();
      }, delay);
    }

    function closeSocket(reason) {
      if (!socket) return;
      const s = socket;
      socket = null;
      try { s.close(1000, reason || "bye"); } catch (e) {}
    }

    // ---- remote change handling --------------------------------------------
    // A snapshot of a module's canonical records: the revision plus a per-record
    // body fingerprint. Comparing bodies (not just id sets) is what lets the hub
    // and the poll fallback notice an IN-PLACE EDIT or a DELETE — an added id is
    // only one of the three ways a document can change.
    function snapshotOf(content) {
      const recs = (content && Array.isArray(content.records)) ? content.records : [];
      const ids = [];
      const map = {};
      for (const r of recs) {
        if (!r || r.id === undefined || r.id === null) continue;
        const id = String(r.id);
        ids.push(id);
        try { map[id] = JSON.stringify(r); } catch (e) { map[id] = String(r); }
      }
      return { ids: ids, map: map, rev: null };
    }

    function changedIdsBetween(prev, next) {
      const out = [];
      const seen = {};
      const beforeMap = prev && prev.map ? prev.map : {};
      (next ? next.ids : []).forEach(id => {
        seen[id] = true;
        if (beforeMap[id] !== next.map[id]) out.push(id);
      });
      if (prev && Array.isArray(prev.ids)) prev.ids.forEach(id => { if (!seen[id]) out.push(id); });
      return out;
    }

    function putSnapshot(module, doc) {
      const snap = snapshotOf(doc && doc.content);
      snap.rev = doc && doc.revision !== undefined ? doc.revision : null;
      snapshots.set(module, snap);
      return snap;
    }

    async function handleRemoteChange(m) {
      const module = String(m.module || "");
      if (MODULES.indexOf(module) === -1) return;
      const prev = snapshots.get(module) || null;
      let next = null;
      try {
        const doc = await loadDoc(module, { refresh: true });
        next = putSnapshot(module, doc);
      } catch (e) {
        return;
      }
      const changed = changedIdsBetween(prev, next);
      const entry = {
        module, rev: m.rev || (next && next.rev) || null, at: m.at || Math.floor(Date.now() / 1000),
        actorId: m.actorId, actorName: m.actorName || "", changedIds: changed, via: "hub"
      };
      pushActivity(entry);
      emit("change", entry);
      if (module === activeModule && window.QU && window.QU.rerender) {
        try { window.QU.rerender(); } catch (e) {}
      }
    }

    // ---- polling fallback --------------------------------------------------
    function startPoller() {
      if (pollTimer) return;
      if (typeof setInterval !== "function") return;
      pollTimer = setInterval(() => { pollOnce().catch(() => {}); }, pollMs);
    }
    function stopPoller() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    async function loadDoc(module, o) {
      if (!store || typeof store.loadDoc !== "function") return { ok: false, code: "no_store" };
      return store.loadDoc(module, o);
    }

    async function pollOnce() {
      if (state === "open" && me) return { ok: true, skipped: "live" };
      const module = activeModule;
      if (!module) return { ok: true, skipped: "no_module" };
      const prev = snapshots.get(module);
      if (prev === undefined) {
        try { const d = await loadDoc(module); putSnapshot(module, d); } catch (e) {}
        return { ok: true, baseline: true };
      }
      try {
        const doc = await loadDoc(module, { refresh: true });
        const next = putSnapshot(module, doc);
        const changed = changedIdsBetween(prev, next);
        const revChanged = prev.rev !== next.rev;
        if (changed.length || revChanged) {
          const entry = { module, changedIds: changed, rev: next.rev, at: Math.floor(Date.now() / 1000), actorName: "", via: "poll" };
          pushActivity(entry);
          emit("change", entry);
          if (window.QU && window.QU.rerender) { try { window.QU.rerender(); } catch (e) {} }
          return { ok: true, changed };
        }
      } catch (e) { return { ok: false, code: "poll_failed", detail: (e && e.message) || String(e) }; }
      return { ok: true, changed: [] };
    }

    async function refreshModule(module) {
      if (!module) return;
      try { const d = await loadDoc(module, { refresh: true }); putSnapshot(module, d); } catch (e) {}
    }

    // ---- write reporting ---------------------------------------------------
    // Wrap the store's two write entry points so a successful local write is
    // reported to the server, which re-attributes it to the authenticated
    // connection and rebroadcasts it. A refused write never reports.
    function installWriteReporter() {
      if (!store) return;
      if (writeWrap && writeWrap.store === store) return;
      removeWriteReporter();
      const origChecked = store.saveChecked;
      const origDoc = store.saveDoc;
      const wrapOne = orig => async function () {
        const module = arguments[0];
        const res = await orig.apply(store, arguments);
        try {
          if (res && res.ok && !res.noop && res.revision) {
            if (state === "open" && me && WRITER_ROLES[me.role] && MODULES.indexOf(module) !== -1) {
              reportWrite(module, res.revision).catch(() => {});
            }
          }
        } catch (e) {}
        return res;
      };
      const patch = {};
      if (typeof origChecked === "function") { patch.saveChecked = wrapOne(origChecked); store.saveChecked = patch.saveChecked; }
      if (typeof origDoc === "function") { patch.saveDoc = wrapOne(origDoc); store.saveDoc = patch.saveDoc; }
      writeWrap = { store, origChecked, origDoc, patch };
    }

    function removeWriteReporter() {
      if (!writeWrap) return;
      const { store: s, origChecked, origDoc } = writeWrap;
      if (s) {
        if (origChecked) s.saveChecked = origChecked;
        if (origDoc) s.saveDoc = origDoc;
      }
      writeWrap = null;
    }

    async function reportWrite(module, rev) {
      if (!socket || state !== "open") return { ok: false, code: "offline" };
      try {
        const r = await jrpc("hubReportWrite", { module, rev });
        if (r && r.ok === false) {
          pushActivity({ module, action: "write_refused", detail: r.detail || r.code, at: Math.floor(Date.now() / 1000), via: "hub" });
          emit("refused", { module, rev, code: r.code, detail: r.detail });
        }
        return r;
      } catch (e) {
        return { ok: false, code: "report_failed" };
      }
    }

    // ---- context / presence markers ----------------------------------------
    function setContext(ctx) {
      ctx = ctx || {};
      activeModule = String(ctx.module || activeModule || "quotes");
      const next = {
        page: String(ctx.page || "").slice(0, 60),
        module: activeModule.slice(0, 40),
        recordId: String(ctx.recordId === undefined || ctx.recordId === null ? "" : ctx.recordId).slice(0, 60)
      };
      pendingContext = next;
      contextDirty = true;
      scheduleContext();
    }

    function scheduleContext() {
      if (contextTimer) return;
      if (typeof setTimeout !== "function") { flushContext(); return; }
      contextTimer = setTimeout(() => { contextTimer = null; flushContext(); }, contextMs);
    }

    function flushContext(force) {
      if (!contextDirty && !force) return;
      const next = pendingContext || lastContext;
      if (!next) return;
      if (!force && next.page === lastContext.page && next.module === lastContext.module && next.recordId === lastContext.recordId) { contextDirty = false; return; }
      lastContext = Object.assign({}, next);
      contextDirty = false;
      if (state === "open" && socket && (next.page || next.module || next.recordId)) {
        jrpc("hubContext", next).catch(() => {});
      }
    }

    // Presence markers: other people whose context is this module+record.
    function presenceFor(module, recordId) {
      const rec = recordId === undefined || recordId === null ? "" : String(recordId);
      return people.filter(p => {
        if (!p || !p.name) return false;
        if (me && p.name === me.name) return false;
        if (module && String(p.module || "") !== String(module)) return false;
        if (rec && String(p.recordId || "") !== rec) return false;
        return true;
      });
    }

    function renderPresenceMarker(module, recordId) {
      const others = presenceFor(module, recordId);
      if (!others.length) return null;
      const wrap = el("div", "hub-presence-marker");
      wrap.setAttribute("data-hub-presence", "1");
      const dot = el("span", "hub-live-dot on");
      wrap.appendChild(dot);
      wrap.appendChild(el("span", "hint", others.length + " other" + (others.length === 1 ? "" : "s") + " here: " + others.map(p => p.name).join(", ")));
      return wrap;
    }

    // ---- lifecycle ---------------------------------------------------------
    function waitHubInfo() {
      return new Promise((resolve, reject) => {
        let tries = 0;
        const iv = setInterval(async () => {
          tries++;
          if (tries > 30) { clearInterval(iv); reject(new Error("timeout")); return; }
          if (!socket || (state !== "open" && state !== "needs_auth")) return;
          try {
            const info = await jrpc("hubInfo");
            clearInterval(iv);
            resolve(info);
          } catch (e) {}
        }, 120);
      });
    }

    async function enable(o) {
      o = o || {};
      const name = String(o.name || "").trim();
      const password = String(o.password || "");
      const confirm = o.confirm === undefined ? "" : String(o.confirm);
      if (!name) return { ok: false, code: "bad_name", detail: errMsg("bad_name") };
      if (password.length < 12 || password.length > 64) return { ok: false, code: "weak_pw", detail: errMsg("weak_pw") };
      closedByUs = false;
      permanentFail = false;
      backoff = 3000;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      closeSocket("reconfigure");
      cfg.enabled = true;
      cfg.name = name;
      await saveCfg();
      sessionPw = password;
      openSocket();
      try {
        const info = await waitHubInfo();
        if (!info.setup) {
          if (confirm && confirm !== password) {
            sessionPw = "";
            closedByUs = true;
            closeSocket("mismatch");
            await clearCfg();
            setState("off");
            return { ok: false, code: "mismatch", detail: errMsg("mismatch") };
          }
          const r = await jrpc("hubSetupOwner", { name, password });
          if (!r.ok) { sessionPw = ""; closedByUs = true; closeSocket("setup_failed"); await clearCfg(); setState("off"); return { ok: false, code: r.code, detail: r.detail || errMsg(r.code) }; }
          me = r.me;
        } else if (state === "open" && me) {
          // The socket's own `open` handler already authenticated this connection
          // (cfg.name + sessionPw were set before we opened it), so do not burn a
          // second auth attempt against the server's rate limit.
        } else {
          const a = await jrpc("hubAuth", { name, password });
          if (!a.ok) { sessionPw = ""; closedByUs = true; closeSocket("auth_failed"); await clearCfg(); setState("off"); return { ok: false, code: a.code, detail: a.detail || errMsg(a.code) }; }
          me = a.me;
        }
        cfg.name = me.name;
        await saveCfg();
        applyIdentity();
        setState("open");
        stopPoller();
        contextDirty = true;
        flushContext(true);
        refreshModule(activeModule);
        return { ok: true, me: { id: me.id, name: me.name, role: me.role } };
      } catch (e) {
        sessionPw = "";
        closedByUs = true;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        closeSocket("connect_failed");
        await clearCfg();
        setState("off");
        return { ok: false, code: "connect_failed", detail: errMsg("connect_failed") };
      }
    }

    function waitForAuth() {
      return new Promise(resolve => {
        let tries = 0;
        const iv = setInterval(() => {
          tries++;
          if (me) { clearInterval(iv); resolve({ ok: true, me: { id: me.id, name: me.name, role: me.role } }); return; }
          if (tries > 40) { clearInterval(iv); resolve({ ok: false, code: "timeout", detail: "Sign-in timed out — try again." }); }
        }, 120);
      });
    }

    async function signIn(password) {
      if (!cfg.name) return { ok: false, code: "bad_name", detail: "Enter your member name first." };
      const pw = String(password || "");
      if (pw.length < 12) return { ok: false, code: "weak_pw", detail: errMsg("weak_pw") };
      sessionPw = pw;
      if (!socket) {
        closedByUs = false;
        permanentFail = false;
        openSocket();
        return waitForAuth();
      }
      try {
        const a = await jrpc("hubAuth", { name: cfg.name, password: pw });
        if (!a.ok) { sessionPw = ""; return { ok: false, code: a.code, detail: a.detail || errMsg(a.code) }; }
        me = a.me;
        applyIdentity();
        setState("open");
        stopPoller();
        contextDirty = true;
        flushContext(true);
        return { ok: true, me: { id: me.id, name: me.name, role: me.role } };
      } catch (e) {
        return { ok: false, code: "connect_failed", detail: errMsg("connect_failed") };
      }
    }

    async function signout() {
      try { if (socket && state === "open") await jrpc("hubSignout"); } catch (e) {}
      me = null;
      sessionPw = "";
      applyIdentity();
      setState("open");
    }

    async function disable() {
      closedByUs = true;
      permanentFail = false;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      sessionPw = "";
      me = null;
      closeSocket("disable");
      people = [];
      online = 0;
      stopPoller();
      await clearCfg();
      applyIdentity();
      emit("presence", { online: 0, people: [] });
      setState("off");
      return { ok: true };
    }

    // ---- team administration (proxied to the authoritative server) ----------
    async function memberAdd(name, role, password) { return jrpc("hubMemberAdd", { name, role, password }); }
    async function memberRemove(id) { return jrpc("hubMemberRemove", { id }); }
    async function memberRole(id, role) { return jrpc("hubMemberRole", { id, role }); }
    async function memberResetPw(id, password) { return jrpc("hubMemberResetPw", { id, password }); }
    async function team() { return jrpc("hubTeam"); }
    async function auditTail(n) { return jrpc("hubAuditTail", n || 20); }
    async function presenceList() { return jrpc("hubPresence"); }

    // ---- boot --------------------------------------------------------------
    async function boot(s) {
      if (s) store = s;
      await loadCfg();
      installWriteReporter();
      // Settle the identity BEFORE any connection: an enabled-but-unauthenticated
      // hub starts at least privilege rather than the default local role.
      applyIdentity();
      if (cfg.enabled && cfg.name) {
        connect();
      } else {
        setState("off");
      }
      return snapshot();
    }

    function _setStore(s) { store = s; if (s) installWriteReporter(); }
    function _setSocket(sock) { socket = sock; }

    // ---- toast helper ------------------------------------------------------
    function toast(msg) {
      try { if (window.QU && typeof window.QU.toast === "function") window.QU.toast(msg); } catch (e) {}
    }

    // ---- admin zone --------------------------------------------------------
    function renderZone(s, o) {
      o = o || {};
      const storeArg = s || store;
      if (storeArg && storeArg !== store) { store = storeArg; }
      const card = el("section", "card hub-card");
      const head = el("div", "card-title-row");
      const headL = el("div");
      headL.appendChild(el("h2", null, "Team & live hub"));
      headL.appendChild(el("p", "hint", "Sign the team into the live hub to stream quote and approval changes between open sessions, edit drafts together, and record every change against the real actor. Personal data stays local; the hub stores only a password hash, never the password. The hub is optional — everything works without it."));
      head.appendChild(headL);
      const chip = el("span", "chip", "…");
      head.appendChild(chip);
      card.appendChild(head);
      const body = el("div");
      card.appendChild(body);

      function paintChip() {
        const m = { off: ["chip", "Disabled"], connecting: ["chip pending", "Connecting…"], open: ["chip ok", "Live"], needs_auth: ["chip pending", "Sign-in needed"], degraded: ["chip fail", "Offline · polling"] };
        const v = m[state] || m.off;
        chip.className = v[0];
        chip.textContent = v[1];
      }

      async function paint() {
        paintChip();
        body.innerHTML = "";
        if (!cfg.enabled) { body.appendChild(buildDisabled()); return; }
        if (state === "connecting") { body.appendChild(el("p", "hint", "Connecting to the live hub…")); return; }
        if ((state === "needs_auth") || (state === "open" && !me)) { body.appendChild(buildNeedsAuth()); return; }
        if (!me) { body.appendChild(buildNeedsAuth()); return; }
        body.appendChild(buildStatus());
        const presBox = el("div");
        body.appendChild(presBox);
        renderPresence(presBox);
        if (me.role === "viewer") body.appendChild(el("p", "hint", "You are signed in as a viewer — quote-u is read-only for you. Owners and managers make the changes."));
        else if (state === "degraded") body.appendChild(el("p", "hint", "The live hub is unreachable right now — quote-u is refreshing from the server on a timer until it returns."));
        const teamBox = el("div");
        body.appendChild(teamBox);
        renderTeam(teamBox);
        if (WRITER_ROLES[me.role]) {
          const actBox = el("div");
          body.appendChild(actBox);
          renderActivity(actBox);
        }
      }

      function buildDisabled() {
        const wrap = el("div");
        wrap.appendChild(el("p", "hint", "The first person to sign in creates the hub and becomes its owner; they then add the rest of the team from this card. Your password is never stored by quote-u — it only travels to the hub to prove who you are."));
        const form = el("form", "frm");
        const nRow = el("div", "fld full");
        const nLab = el("label"); nLab.htmlFor = "hub-name"; nLab.textContent = "Your name"; nRow.appendChild(nLab);
        const nIn = el("input"); nIn.id = "hub-name"; nIn.className = "inp"; nIn.type = "text"; nIn.maxLength = 20; nIn.autocomplete = "off"; nIn.placeholder = "e.g. Dana"; nRow.appendChild(nIn);
        form.appendChild(nRow);
        const pRow = el("div", "fld full");
        const pLab = el("label"); pLab.htmlFor = "hub-pw"; pLab.textContent = "Password (12+ characters)"; pRow.appendChild(pLab);
        const pIn = el("input"); pIn.id = "hub-pw"; pIn.className = "inp"; pIn.type = "password"; pIn.autocomplete = "new-password"; pRow.appendChild(pIn);
        form.appendChild(pRow);
        const cRow = el("div", "fld full");
        const cLab = el("label"); cLab.htmlFor = "hub-pw2"; cLab.textContent = "Confirm password (only needed the first time)"; cRow.appendChild(cLab);
        const cIn = el("input"); cIn.id = "hub-pw2"; cIn.className = "inp"; cIn.type = "password"; cIn.autocomplete = "new-password"; cRow.appendChild(cIn);
        form.appendChild(cRow);
        const gen = el("button", "btn btn-ghost btn-sm", "Suggest a strong password"); gen.type = "button";
        gen.addEventListener("click", () => { pIn.value = genPassword(); cIn.value = pIn.value; });
        form.appendChild(gen);
        const msg = el("p", "hint"); form.appendChild(msg);
        const foot = el("div", "frm-foot full");
        const sub = el("button", "btn btn-primary", "Sign in / set up hub"); sub.type = "submit";
        foot.appendChild(sub); form.appendChild(foot);
        form.addEventListener("submit", async ev => {
          ev.preventDefault();
          sub.disabled = true; sub.textContent = "Connecting…";
          const res = await enable({ name: nIn.value, password: pIn.value, confirm: cIn.value });
          sub.disabled = false; sub.textContent = "Sign in / set up hub";
          if (!res.ok) { msg.textContent = res.detail || errMsg(res.code); msg.classList.add("err"); return; }
          toast("Signed in to the live hub as " + res.me.name + " (" + res.me.role + ").");
          paint();
        });
        wrap.appendChild(form);
        return wrap;
      }

      function buildNeedsAuth() {
        const wrap = el("div");
        wrap.appendChild(el("p", "hint", "You are signed out of the live hub (quote-u remembers your name but never your password). Enter your password to rejoin."));
        const form = el("form", "frm");
        const row = el("div", "fld full");
        const lab = el("label"); lab.htmlFor = "hub-rejoin-pw"; lab.textContent = "Password for " + (cfg.name || "your member"); row.appendChild(lab);
        const pIn = el("input"); pIn.id = "hub-rejoin-pw"; pIn.className = "inp"; pIn.type = "password"; pIn.autocomplete = "current-password"; row.appendChild(pIn);
        form.appendChild(row);
        const msg = el("p", "hint"); form.appendChild(msg);
        const foot = el("div", "frm-foot full");
        const sub = el("button", "btn btn-primary", "Sign in"); sub.type = "submit";
        const dis = el("button", "btn btn-ghost", "Disable hub"); dis.type = "button";
        dis.addEventListener("click", async () => { await disable(); paint(); });
        foot.appendChild(sub); foot.appendChild(dis); form.appendChild(foot);
        form.addEventListener("submit", async ev => {
          ev.preventDefault();
          sub.disabled = true;
          const res = await signIn(pIn.value);
          sub.disabled = false;
          if (!res.ok) { msg.textContent = res.detail || errMsg(res.code); msg.classList.add("err"); return; }
          toast("Signed in to the live hub as " + res.me.name + " (" + res.me.role + ").");
          paint();
        });
        wrap.appendChild(form);
        return wrap;
      }

      function buildStatus() {
        const row = el("div", "hub-status");
        row.appendChild(el("span", "chip " + (me.role === "owner" ? "ok" : me.role === "manager" ? "pending" : ""), me.role));
        row.appendChild(el("strong", null, me.name));
        row.appendChild(el("span", "hint", me.role === "owner" ? "You own this hub — change roles, reset passwords, remove members." : me.role === "manager" ? "You can edit, send and invoice, and read the activity log." : "Read-only — ask an owner or manager to make changes."));
        const out = el("button", "btn btn-ghost btn-sm", "Sign out"); out.type = "button";
        out.addEventListener("click", async () => { await signout(); paint(); });
        const dis = el("button", "btn btn-ghost btn-sm", "Disable hub"); dis.type = "button";
        dis.addEventListener("click", async () => { await disable(); paint(); });
        row.appendChild(out); row.appendChild(dis);
        return row;
      }

      function renderPresence(box) {
        box.innerHTML = "";
        box.appendChild(el("p", "hint", "Online now: " + online + (online === 1 ? " person" : " people") + (me ? " (you)" : "") + ". Presence updates live as people move between records."));
        const list = el("div", "rel-list");
        if (!people.length) list.appendChild(el("p", "hint", "No one else is connected right now."));
        people.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).forEach(p => {
          const row = el("div", "hub-row");
          row.appendChild(el("span", "hub-live-dot on"));
          row.appendChild(el("span", "chip " + (p.role === "owner" ? "ok" : p.role === "manager" ? "pending" : ""), p.role || "?"));
          let nm = String(p.name || "?");
          if (me && p.name === me.name) nm += " (you)";
          row.appendChild(el("span", null, nm));
          if (p.page) row.appendChild(el("span", "hint", "viewing " + String(p.page)));
          list.appendChild(row);
        });
        box.appendChild(list);
      }

      async function renderTeam(box) {
        box.innerHTML = "";
        const hr = el("div", "card-title-row");
        hr.appendChild(el("h3", null, "Team"));
        box.appendChild(hr);
        const t = await team().catch(() => null);
        if (!t || !t.ok) { box.appendChild(el("p", "hint", "The team list is unavailable right now.")); return; }
        const list = el("div", "rel-list");
        (t.members || []).forEach(m => {
          const row = el("div", "hub-row");
          row.appendChild(el("span", "chip " + (m.role === "owner" ? "ok" : m.role === "manager" ? "pending" : ""), m.role));
          row.appendChild(el("span", null, String(m.name)));
          if (me.role === "owner" && m.role !== "owner") {
            const sel = el("select", "inp hub-role-sel");
            sel.innerHTML = '<option value="manager">manager</option><option value="viewer">viewer</option>';
            sel.value = m.role;
            sel.addEventListener("change", async () => { const r = await memberRole(m.id, sel.value); toast(r.ok ? m.name + " is now a " + sel.value + "." : (r.detail || errMsg(r.code))); renderTeam(box); });
            row.appendChild(sel);
            const rp = el("button", "btn btn-ghost btn-sm", "Reset password"); rp.type = "button";
            rp.addEventListener("click", async () => {
              const pw = window.prompt ? window.prompt("New password for " + m.name + " (12+ characters)") : null;
              if (!pw) return;
              const r = await memberResetPw(m.id, pw);
              toast(r.ok ? "Password reset for " + m.name + "." : (r.detail || errMsg(r.code)));
            });
            row.appendChild(rp);
            const rm = el("button", "btn btn-ghost btn-sm hub-danger", "Remove"); rm.type = "button";
            rm.addEventListener("click", async () => {
              if (window.confirm && !window.confirm("Remove " + m.name + " from the team?")) return;
              const r = await memberRemove(m.id);
              if (!r.ok) { toast(r.detail || errMsg(r.code)); return; }
              toast(m.name + " removed from the team."); renderTeam(box);
            });
            row.appendChild(rm);
          }
          list.appendChild(row);
        });
        box.appendChild(list);
        if (me.role === "owner") {
          const form = el("form", "frm hub-add");
          const nIn = el("input", "inp"); nIn.type = "text"; nIn.maxLength = 20; nIn.placeholder = "New member name";
          const roleSel = el("select", "inp");
          roleSel.innerHTML = '<option value="manager">manager</option><option value="viewer">viewer</option>';
          const pIn = el("input", "inp"); pIn.type = "text"; pIn.placeholder = "One-time password (12+ chars)";
          const add = el("button", "btn btn-primary btn-sm", "Add member"); add.type = "submit";
          const msg = el("p", "hint");
          form.appendChild(nIn); form.appendChild(roleSel); form.appendChild(pIn); form.appendChild(add); form.appendChild(msg);
          form.addEventListener("submit", async ev => {
            ev.preventDefault();
            const r = await memberAdd(nIn.value.trim(), roleSel.value, pIn.value);
            msg.textContent = "";
            if (!r.ok) { msg.textContent = r.detail || errMsg(r.code); msg.classList.add("err"); return; }
            toast(nIn.value.trim() + " added as " + roleSel.value + ".");
            nIn.value = ""; pIn.value = "";
            renderTeam(box);
          });
          box.appendChild(form);
        }
      }

      async function renderActivity(box) {
        box.innerHTML = "";
        const hr = el("div", "card-title-row");
        hr.appendChild(el("h3", null, "Recent activity"));
        box.appendChild(hr);
        const t = await auditTail(12).catch(() => null);
        if (!t || !t.ok) { box.appendChild(el("p", "hint", "The activity log is unavailable right now.")); return; }
        const list = el("div", "rel-list");
        if (!t.audit || !t.audit.length) list.appendChild(el("p", "hint", "No activity recorded yet."));
        (t.audit || []).forEach(a => {
          const row = el("div", "hub-row");
          row.appendChild(el("span", "chip", a.action));
          row.appendChild(el("span", null, a.actorName || "—"));
          if (a.target) row.appendChild(el("span", "hint", String(a.target)));
          if (a.detail) row.appendChild(el("span", "hint", String(a.detail)));
          row.appendChild(el("span", "mono", a.at ? new Date(a.at * 1000).toLocaleString() : "—"));
          list.appendChild(row);
        });
        box.appendChild(list);
      }

      const onState = () => paint();
      const onPres = () => paint();
      on("state", onState);
      on("presence", onPres);
      paint();
      return card;
    }

    // ---- public surface ----------------------------------------------------
    return {
      VERSION,
      STATES,
      MODULES,
      ERR_MAP,
      errMsg,
      genPassword,
      boot,
      // state
      get state() { return state; },
      get me() { return me ? { id: me.id, name: me.name, role: me.role } : null; },
      get cfg() { return Object.assign({}, cfg); },
      get online() { return online; },
      get people() { return people.slice(); },
      get activity() { return activity.slice(); },
      get store() { return store; },
      snapshot,
      // events
      on, off,
      // lifecycle
      enable, signIn, signout, disable,
      // collaboration
      setContext, flushContext, presenceFor, renderPresenceMarker, pollOnce,
      reportWrite,
      // team
      memberAdd, memberRemove, memberRole, memberResetPw, team, auditTail, presenceList,
      // ui
      renderZone,
      // testing seams
      _setStore, _setSocket,
      _snapshots: snapshots,
      _viewerBlocked: () => !!(store && state !== "off" && me && !WRITER_ROLES[me.role])
    };
  }

  return { VERSION, STATES, MODULES, ERR_MAP, errMsg, genPassword, createService };
})();
