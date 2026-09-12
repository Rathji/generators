// src/framework/hub.js — Phase 9 realtime-hub client (server-plugin).
//
// Wraps the server socket: connect/reconnect, auth (register / login /
// token sessions), role-aware authorization checks (task 38), change
// subscriptions + live events for concurrent editing (tasks 39-40), shared
// edit-key sync so the document store is multi-writer, presence, and a
// polling fallback whenever the hub is unreachable (task 40 "degrade
// gracefully"). When the hub is unavailable the app stays fully usable in
// single-user local mode (roles only apply once connected).
//
// Session token + username persist in the `kb-hub` kv folder so a reload
// silently re-authenticates.
//
// Roadmap task 54: roles are the IT-U three (viewer / technician /
// administrator) and are SCOPED per client and per service. The server assigns
// them; this client reads them off login/auth, resolves them most-specific-wins
// for local gating, and asks the server (`checkAction`) before any sensitive
// action while connected.

import { GLOBAL_SCOPE, scopeFor, roleAtLeast, resolveRole as resolveScopedRole, can as roleCan } from "./roles.js";

const RETRY_BASE = 1200;
const RETRY_MAX = 15000;

const ROLE_FROM_ID = ["viewer", "technician", "technician", "administrator"];

// The server returns `roles:[{scope, cat, role:<int>, roleName}]`; normalize to
// the IT-U vocabulary the client speaks.
function normalizeServerRole(r) {
  if (!r) return null;
  const role = r.roleName || (typeof r.role === "number" ? ROLE_FROM_ID[r.role & 3] : r.role) || "viewer";
  const scope = String(r.scope || r.cat || GLOBAL_SCOPE);
  return {
    scope,
    cat: scope,
    role,
    roleId: typeof r.role === "number" ? r.role & 3 : ROLE_FROM_ID.indexOf(role),
    at: r.at || 0,
  };
}
function normalizeServerRoles(list) {
  return (Array.isArray(list) ? list : []).map(normalizeServerRole).filter((r) => r && r.scope);
}

export function createHub({ kv, toast, listEditKeys }) {
  const factory = (window.root && window.root.createServerSocket) ? window.root.createServerSocket.bind(window.root) : null;

  let socket = null;
  let retry = RETRY_BASE;
  let manualClose = false;
  let reconnectTimer = null;
  let authenticated = false;
  let user = null; // { username, isAdmin, roles:[{cat,role}] }
  let pollTimer = null;
  let pollCtx = null; // { articleId, lastSeen, cb }
  const changeListeners = new Set();
  let lastChangeSeq = 0; // de-dupes an event delivered on more than one channel
  const myTopics = new Set();
  const editRegistry = new Map(); // recordId -> { scope, editors:[...] }
  const editListeners = new Set();
  const myEdits = new Map(); // recordId -> { scope, label } — re-claimed on reconnect

  const kvFolder = kv ? kv["kb-hub"] : null;

  const hub = {
    get available() {
      return !!factory;
    },
    get connected() {
      return !!(socket && socket.readyState === 1);
    },
    get authenticated() {
      return authenticated;
    },
    get user() {
      return user;
    },
    get username() {
      return user ? user.username : "";
    },
    get isAdmin() {
      return !!(user && user.isAdmin);
    },
    get online() {
      return !!socket && socket.readyState === 1;
    },
  };

  // ---- persistence helpers -------------------------------------------------
  async function saveToken(token, username) {
    if (!kvFolder) return;
    try {
      await kvFolder.set("token", token);
      await kvFolder.set("username", username);
    } catch {}
  }
  async function loadToken() {
    if (!kvFolder) return null;
    try {
      const t = await kvFolder.get("token");
      const u = await kvFolder.get("username");
      return t && u ? { token: t, username: u } : null;
    } catch {
      return null;
    }
  }
  async function clearToken() {
    if (!kvFolder) return;
    try {
      await kvFolder.delete("token");
      await kvFolder.delete("username");
    } catch {}
  }

  // ---- socket / rpc plumbing ----------------------------------------------
  function parse(msg) {
    try {
      return JSON.parse(msg);
    } catch {
      return null;
    }
  }
  async function rpc(name, data) {
    if (!socket || socket.readyState !== 1) throw new Error("hub offline");
    const reply = await socket.rpc[name](data === undefined ? "" : JSON.stringify(data));
    const obj = parse(reply);
    if (obj && obj.ok) return obj;
    if (obj && obj.err) throw new Error(obj.err);
    throw new Error("bad reply");
  }

  function handleMessage(evt) {
    const obj = parse(evt.data);
    if (!obj) return;
    if (obj.t === "change") {
      // A change event is published on both the client's category channel and
      // the global channel, and the client may subscribe to the same store
      // category through two mechanisms, so the same event can arrive more
      // than once. Collapse repeats by sequence number so a remote edit
      // triggers at most one reload / conflict banner per commit.
      const seq = Number(obj.seq) || 0;
      if (seq && seq <= lastChangeSeq) return;
      if (seq) lastChangeSeq = seq;
      for (const cb of changeListeners) {
        try {
          cb(obj);
        } catch {}
      }
      return;
    }
    if (obj.t === "edit") {
      const entry = { scope: obj.scope, editors: Array.isArray(obj.editors) ? obj.editors : [] };
      editRegistry.set(obj.recordId, entry);
      emitEditors({ recordId: obj.recordId, scope: obj.scope, editors: entry.editors });
    }
  }

  function emitEditors(evt) {
    for (const cb of editListeners) {
      try {
        cb(evt);
      } catch {}
    }
  }

  function onOpen() {
    retry = RETRY_BASE;
    reconnectTimer = null;
    lastChangeSeq = 0; // a fresh connection starts a fresh sequence space
    loadToken()
      .then(async (t) => {
        if (t && socket && socket.readyState === 1) {
          try {
            const res = await rpc("auth", { token: t.token });
            authenticated = true;
            user = { username: res.username, isAdmin: !!res.isAdmin, roles: normalizeServerRoles(res.roles) };
            await saveToken(t.token, res.username);
          } catch {
            await clearToken();
            authenticated = false;
            user = null;
          }
        } else {
          authenticated = false;
          user = null;
        }
        for (const tp of myTopics) rpc("subscribeCat", { categoryId: tp }).catch(() => {});
        for (const [recordId, e] of myEdits) rpc("claimEdit", { recordId, scope: e.scope, label: e.label }).catch(() => {});
        emitAuthChanged();
        hub.syncEditKeys();
        startPolling();
      })
      .catch(() => {});
  }

  function scheduleReconnect(evt) {
    if (manualClose) return;
    stopPolling();
    const code = evt && evt.code;
    if (code === 4403) {
      // perchance.org-only restriction — permanent for this page context.
      authenticated = false;
      user = null;
      emitAuthChanged();
      return;
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, retry);
    retry = Math.min(RETRY_MAX, retry * 1.7);
  }

  function connect() {
    if (!factory || manualClose) return;
    try {
      const s = factory();
      socket = s;
      if (s.opened) s.opened.catch(() => {});
      s.addEventListener("open", onOpen);
      s.addEventListener("message", handleMessage);
      s.addEventListener("close", scheduleReconnect);
    } catch {
      scheduleReconnect({});
    }
  }

  function start() {
    if (!factory) {
      emitAuthChanged();
      startPolling();
      return;
    }
    manualClose = false;
    connect();
  }

  function stop() {
    manualClose = true;
    clearTimeout(reconnectTimer);
    stopPolling();
    if (socket) {
      try {
        socket.close(1000, "bye");
      } catch {}
    }
    socket = null;
  }

  // ---- polling fallback (task 40) -----------------------------------------
  // When the hub is unreachable, watch the document store directly so remote
  // saves still surface as "updated" events.
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      const c = pollCtx;
      if (!c) return;
      if (socket && socket.readyState === 1) return; // hub live — no polling needed
      try {
        const doc = await c.read();
        if (!doc) return;
        const key = (doc.updated && doc.updated.at) + ":" + (doc.versions ? doc.versions.length : 0);
        if (c.lastSeen !== null && key !== c.lastSeen) {
          c.lastSeen = key;
          c.cb({ articleId: doc.id, categoryId: doc.categoryId || "", version: doc.versions ? doc.versions.length : 0, by: (doc.updated && doc.updated.by) || "?", updatedAt: doc.updated && doc.updated.at, via: "poll" });
        } else {
          c.lastSeen = key;
        }
      } catch {}
    }, 12000);
  }
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ---- auth ----------------------------------------------------------------
  hub.register = async (username, password) => {
    await rpc("register", { u: username, p: password });
    await hub.login(username, password);
  };
  hub.login = async (username, password) => {
    const res = await rpc("login", { u: username, p: password });
    authenticated = true;
    user = { username: res.username, isAdmin: !!res.isAdmin, roles: normalizeServerRoles(res.roles) };
    await saveToken(res.token, res.username);
    emitAuthChanged();
    hub.syncEditKeys();
    return res;
  };
  hub.logout = async () => {
    try {
      await rpc("logout", {});
    } catch {}
    authenticated = false;
    user = null;
    await clearToken();
    emitAuthChanged();
  };
  hub.changePassword = async (password) => {
    return rpc("changePassword", { p: password });
  };
  hub.onAuthChanged = (cb) => {
    hub._authCbs = hub._authCbs || new Set();
    hub._authCbs.add(cb);
  };

  // ---- roles / authorization (task 54) ---------------------------------------
  // The IT-U role in force at a scope, most-specific-wins, from the scopes the
  // server assigned to this identity.
  hub.roleFor = (scope) => {
    if (!user) return null;
    if (user.isAdmin) return "administrator";
    const resolved = resolveScopedRole(user.roles, scopeFor({ scope }), null);
    return resolved ? resolved.role : "viewer";
  };
  hub.assignments = () => (user ? user.roles.map((r) => ({ scope: r.scope, role: r.role, at: r.at })) : []);
  hub.scopedRole = (scope) => ({ role: hub.roleFor(scope), scope: scopeFor({ scope }) });
  // The local (fast) decision from the server-assigned roles. The server still
  // re-checks via `authorize` before a sensitive action is performed.
  hub.can = (action, scope) => roleCan({ assignments: hub.assignments(), scope: scopeFor({ scope }), action, isAdmin: !!(user && user.isAdmin) });
  // ---- admin RPCs (task 54 — people & access) ---------------------------------
  hub.listUsers = async () => {
    if (!hub.connected) return [];
    try {
      const res = await rpc("listUsers", {});
      return (res.users || []).map((u) => ({ ...u, roles: normalizeServerRoles(u.roles) }));
    } catch {
      return [];
    }
  };
  hub.grantRole = async (username, scope, role) => {
    await rpc("grantRole", { target: username, scope: scopeFor({ scope }), role });
  };
  hub.revokeRole = async (username, scope) => {
    await rpc("revokeRole", { target: username, scope: scopeFor({ scope }) });
  };
  // Named clearly for the scoped model (aliases of the above).
  hub.setScopeRole = hub.grantRole;
  hub.removeScopeRole = hub.revokeRole;
  hub.setBanned = async (username, banned) => {
    await rpc("setBanned", { target: username, banned: !!banned });
  };
  // Offline = single-user local mode → unrestricted (backwards compatible).
  // Online = server-authoritative.
  hub.authorize = async (action, scope, articleId) => {
    if (!hub.connected || !authenticated) return { allow: true, reason: "local" };
    try {
      const res = await rpc("checkAction", { action, scope: scopeFor({ scope }), articleId: articleId || "" });
      return { allow: !!res.allow, reason: res.reason || "", role: res.role || null, scope: res.scope || null };
    } catch (e) {
      return { allow: true, reason: "hub-error" };
    }
  };
  hub.require = async (action, scope, opts = {}) => {
    const res = await hub.authorize(action, scope);
    if (!res.allow && toast) {
      toast((opts.msg || "Your role doesn't allow this") + (res.reason ? ` — ${res.reason}` : ""), "warning", 4200);
    }
    return res.allow;
  };
  Object.defineProperty(hub, "canWrite", {
    get() {
      if (!authenticated) return false;
      if (user.isAdmin) return true;
      return (user.roles || []).some((r) => roleAtLeast(r.role, "technician"));
    },
  });

  // ---- change notifications (tasks 39-40) ------------------------------------
  hub.onChange = (cb) => {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  };
  hub.subscribeCategory = (scope) => {
    if (!scope || myTopics.has(scope)) return;
    myTopics.add(scope);
    if (socket && socket.readyState === 1 && typeof socket.subscribe === "function") {
      try {
        socket.subscribe("cat:" + scope);
      } catch {}
    }
    if (hub.connected) rpc("subscribeCat", { scope }).catch(() => {});
  };
  hub.watchArticle = (articleId, scope, read, cb) => {
    const offChange = hub.onChange((evt) => {
      if (evt.articleId === articleId) cb(evt);
    });
    hub.subscribeCategory(scope);
    pollCtx = { articleId, read, lastSeen: null, cb };
    return () => {
      offChange();
      if (pollCtx && pollCtx.articleId === articleId) pollCtx = null;
    };
  };
  hub.catchUp = async (since, scope) => {
    if (!hub.connected) return [];
    try {
      const res = await rpc("getChanges", { since, scope: scope || "" });
      return res.changes || [];
    } catch {
      return [];
    }
  };
  hub.announce = (articleId, scope, version, updatedAt) => {
    if (!hub.connected || !authenticated || !hub.canWrite) return;
    rpc("announceChange", { articleId, scope, version, updatedAt }).catch(() => {});
  };

  // ---- editing presence (task 55) --------------------------------------------
  // Which records/runbooks other sessions have open right now. Purely
  // ephemeral: the server rebuilds it from live connections.
  hub.editors = (recordId) => {
    const e = editRegistry.get(recordId);
    return e ? e.editors : [];
  };
  hub.onEditors = (cb) => {
    editListeners.add(cb);
    return () => editListeners.delete(cb);
  };
  // Subscribe to change events for a scope. `cb` also fires for changes to any
  // document in that scope; the caller decides what to reload.
  hub.watchScope = (scope, cb) => {
    const s = scopeFor({ scope });
    // The server's change ring stores scopes in a fixed 32-byte field, so a
    // published event's scope may be truncated; match either form.
    const key = s.length > 32 ? s.slice(0, 32) : s;
    const off = hub.onChange((evt) => {
      if (!scope || evt.scope === s || evt.scope === key || evt.categoryId === s || evt.categoryId === key) cb(evt);
    });
    hub.subscribeCategory(s);
    return off;
  };
  hub.claimEdit = async (recordId, scope, label) => {
    const s = scopeFor({ scope });
    myEdits.set(recordId, { scope: s, label: label || "" });
    if (!hub.connected || !authenticated) return hub.editors(recordId);
    try {
      const res = await rpc("claimEdit", { recordId, scope: s, label: label || "" });
      editRegistry.set(recordId, { scope: s, editors: res.editors || [] });
      emitEditors({ recordId, scope: s, editors: res.editors || [] });
      return res.editors || [];
    } catch {
      return hub.editors(recordId);
    }
  };
  hub.releaseEdit = async (recordId) => {
    myEdits.delete(recordId);
    editRegistry.delete(recordId);
    if (!hub.connected || !authenticated) return;
    try {
      await rpc("releaseEdit", { recordId });
    } catch {}
  };
  hub.getEditors = async (scope) => {
    if (!hub.connected || !authenticated) return [];
    try {
      const res = await rpc("getEditors", { scope: scopeFor({ scope }) });
      return res.editors || [];
    } catch {
      return [];
    }
  };

  // ---- multi-user audit & rate control (task 56) -----------------------------
  // Admin-only reads of the server's durable audit ring, live sessions and the
  // rate-limit snapshot. Each degrades to an empty result when offline or when
  // the caller is not an administrator (the server is the gate either way).
  hub.audit = async (opts = {}) => {
    if (!hub.connected || !authenticated) return { records: [], max: 0 };
    try {
      const res = await rpc("getAudit", { limit: opts.limit || 200, since: opts.since || 0 });
      return { records: res.records || [], max: res.max || 0 };
    } catch {
      return { records: [], max: 0 };
    }
  };
  hub.sessions = async () => {
    if (!hub.connected || !authenticated) return { sessions: [], online: 0 };
    try {
      const res = await rpc("getSessions", {});
      return { sessions: res.sessions || [], online: res.online || 0 };
    } catch {
      return { sessions: [], online: 0 };
    }
  };
  hub.rateStats = async () => {
    if (!hub.connected || !authenticated) return null;
    try {
      return await rpc("getRateStats", {});
    } catch {
      return null;
    }
  };

  // ---- identity providers / SSO (task 58) ------------------------------------
  // The client never verifies an ID token — the server does. These calls move
  // the server half of the flow: fetch the configured providers, begin an
  // attempt (state + nonce), submit an ID token for verification, and let an
  // administrator store the provider configuration.
  hub.ssoConfig = async () => {
    if (!hub.connected) return { providers: [], simulator: null, canEdit: false, offline: true };
    try {
      const res = await rpc("ssoGetConfig", {});
      return { ...res, offline: false };
    } catch (e) {
      return { providers: [], simulator: null, canEdit: false, offline: true, error: String((e && e.message) || e) };
    }
  };
  hub.ssoBegin = async (providerId) => {
    const res = await rpc("ssoBegin", { providerId });
    return { state: res.state, nonce: res.nonce, providerId: res.providerId };
  };
  hub.ssoLogin = async ({ idToken, state }) => {
    const res = await rpc("ssoLogin", { idToken, state });
    authenticated = true;
    user = { username: res.username, isAdmin: !!res.isAdmin, roles: normalizeServerRoles(res.roles) };
    await saveToken(res.token, res.username);
    emitAuthChanged();
    hub.syncEditKeys();
    return res;
  };
  hub.ssoSetConfig = async (providers) => {
    const res = await rpc("ssoSetConfig", { providers });
    return res.providers || [];
  };

  // ---- presence ---------------------------------------------------------------
  hub.presence = async (topics) => {
    if (!hub.connected) return { online: 0, counts: {} };
    try {
      const res = await rpc("getPresence", { topics: topics || [] });
      return { online: res.online || 0, counts: res.counts || {} };
    } catch {
      return { online: 0, counts: {} };
    }
  };
  hub.onlineUsers = async () => {
    if (!hub.connected) return [];
    try {
      const res = await rpc("getOnlineUsers", {});
      return res.users || [];
    } catch {
      return [];
    }
  };

  // ---- shared edit keys (multi-writer document store) ---------------------------
  hub.getEditKey = async (name) => {
    if (!hub.connected || !hub.canWrite) return null;
    try {
      const res = await rpc("getEditKey", { name });
      return res.key || null;
    } catch {
      return null;
    }
  };
  hub.storeEditKey = (name, key) => {
    if (!hub.connected || !hub.canWrite) return;
    rpc("storeEditKey", { name, key }).catch(() => {});
  };
  // Report this device's known edit keys to the server so other sessions can
  // update the shared documents (called on connect/login).
  hub.syncEditKeys = async () => {
    if (!hub.connected || !hub.canWrite || !listEditKeys) return;
    try {
      const keys = await listEditKeys();
      for (const [name, key] of keys.slice(0, 60)) {
        rpc("storeEditKey", { name, key }).catch(() => {});
      }
    } catch {}
  };

  function emitAuthChanged() {
    if (hub._authCbs) {
      for (const cb of hub._authCbs) {
        try {
          cb();
        } catch {}
      }
    }
  }

  hub.start = start;
  hub.stop = stop;

  return hub;
}
