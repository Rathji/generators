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

const RETRY_BASE = 1200;
const RETRY_MAX = 15000;

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
  const myTopics = new Set();

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
    if (!obj || obj.t !== "change") return;
    for (const cb of changeListeners) {
      try {
        cb(obj);
      } catch {}
    }
  }

  function onOpen() {
    retry = RETRY_BASE;
    reconnectTimer = null;
    loadToken()
      .then(async (t) => {
        if (t && socket && socket.readyState === 1) {
          try {
            const res = await rpc("auth", { token: t.token });
            authenticated = true;
            user = { username: res.username, isAdmin: !!res.isAdmin, roles: res.roles || [] };
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
    user = { username: res.username, isAdmin: !!res.isAdmin, roles: res.roles || [] };
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

  // ---- roles / authorization (task 38) --------------------------------------
  hub.roleFor = (categoryId) => {
    if (!user) return null;
    if (user.isAdmin) return "admin";
    const roles = user.roles || [];
    let found = null;
    for (const r of roles) if (r.cat === categoryId) found = r.role;
    if (found === null) for (const r of roles) if (r.cat === "*") found = r.role;
    const names = ["viewer", "editor", "reviewer", "admin"];
    return found === null ? "viewer" : names[found] || "viewer";
  };
  // ---- admin RPCs (task 38 — Users & roles tab) -------------------------------
  hub.listUsers = async () => {
    if (!hub.connected) return [];
    try {
      const res = await rpc("listUsers", {});
      return res.users || [];
    } catch {
      return [];
    }
  };
  hub.grantRole = async (username, categoryId, role) => {
    await rpc("grantRole", { target: username, cat: categoryId || "*", role });
  };
  hub.revokeRole = async (username, categoryId) => {
    await rpc("revokeRole", { target: username, cat: categoryId || "*" });
  };
  hub.setBanned = async (username, banned) => {
    await rpc("setBanned", { target: username, banned: !!banned });
  };
  // Offline = single-user local mode → unrestricted (backwards compatible).
  // Online = server-authoritative.
  hub.authorize = async (action, categoryId, articleId) => {
    if (!hub.connected || !authenticated) return { allow: true, reason: "local" };
    try {
      const res = await rpc("checkAction", { action, categoryId: categoryId || "", articleId: articleId || "" });
      return { allow: !!res.allow, reason: res.reason || "" };
    } catch (e) {
      return { allow: true, reason: "hub-error" };
    }
  };
  hub.require = async (action, categoryId, opts = {}) => {
    const res = await hub.authorize(action, categoryId);
    if (!res.allow && toast) {
      toast((opts.msg || "Your role doesn't allow this") + (res.reason ? ` — ${res.reason}` : ""), "warning", 4200);
    }
    return res.allow;
  };
  Object.defineProperty(hub, "canWrite", {
    get() {
      if (!authenticated) return false;
      if (user.isAdmin) return true;
      return (user.roles || []).some((r) => r.role >= 1);
    },
  });

  // ---- change notifications (tasks 39-40) ------------------------------------
  hub.onChange = (cb) => {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  };
  hub.subscribeCategory = (categoryId) => {
    if (!categoryId || myTopics.has(categoryId)) return;
    myTopics.add(categoryId);
    if (socket && socket.readyState === 1 && typeof socket.subscribe === "function") {
      try {
        socket.subscribe("cat:" + categoryId);
      } catch {}
    }
    if (hub.connected) rpc("subscribeCat", { categoryId }).catch(() => {});
  };
  hub.watchArticle = (articleId, categoryId, read, cb) => {
    const offChange = hub.onChange((evt) => {
      if (evt.articleId === articleId) cb(evt);
    });
    hub.subscribeCategory(categoryId);
    pollCtx = { articleId, read, lastSeen: null, cb };
    return () => {
      offChange();
      if (pollCtx && pollCtx.articleId === articleId) pollCtx = null;
    };
  };
  hub.catchUp = async (since, categoryId) => {
    if (!hub.connected) return [];
    try {
      const res = await rpc("getChanges", { since, categoryId: categoryId || "" });
      return res.changes || [];
    } catch {
      return [];
    }
  };
  hub.announce = (articleId, categoryId, version, updatedAt) => {
    if (!hub.connected || !authenticated || !hub.canWrite) return;
    rpc("announceChange", { articleId, categoryId, version, updatedAt }).catch(() => {});
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
