/* ============================================================
   BI realtime hub client (tasks 35–38).

   The hub (server script in index.html) is a REFLECTOR: it holds
   no bundle payloads. Clients report the source edit-count index
   after a pull; the hub broadcasts per-tool refresh events and
   document updates. Open BI sessions therefore learn of new data
   within seconds while the payloads stay in cache and bus.

   Roles: viewer (read) < analyst (create/edit reports, dashboards,
   views, schedules, exports) < admin (sources, catalog, backup,
   restore, roles). The role is verified server-side by hashing a
   token against the embedded admin hash; the hub authorizes +
   rate-limits every privileged announce. Local role is persisted
   in localStorage; the auth token only in sessionStorage.

   Degradation: when the hub is unreachable (or the generator is
   unsaved with the emulator unavailable), the client falls back to
   polling-based refresh (bus.refreshAll + store.reconcileAll) and
   reports mode "polling" so the UI shows it honestly.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const realtime = (BI.realtime = {});
  const ROLE_KEY = "bi.role";
  const TOKEN_KEY = "bi.authToken"; // sessionStorage — cleared when the tab closes

  const ROLES = ["viewer", "analyst", "admin"];
  const ACTION_ROLE = {
    view: "viewer",
    export: "analyst",
    create_report: "analyst",
    edit_report: "analyst",
    delete_report: "analyst",
    create_dashboard: "analyst",
    edit_dashboard: "analyst",
    delete_dashboard: "analyst",
    save_view: "analyst",
    create_schedule: "analyst",
    manage_sources: "admin",
    manage_catalog: "admin",
    backup: "admin",
    restore: "admin",
    manage_roles: "admin",
  };

  let socket = null;
  let mode = "off";             // off | connecting | live | polling
  let pollTimer = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let _closing = false;         // intentional close — don't treat as failure
  let presence = { viewer: 0, analyst: 0, admin: 0 };
  let remoteIndex = {};         // tool -> editCount (from hub)
  let hubEnabled = true;
  let pollFallbackMs = 45000;

  realtime.role = function () {
    const r = localStorage.getItem(ROLE_KEY);
    return ROLES.includes(r) ? r : "viewer";
  };
  realtime.setRole = function (role) {
    if (!ROLES.includes(role)) role = "viewer";
    localStorage.setItem(ROLE_KEY, role);
    return role;
  };
  realtime.can = function (action) {
    const need = ACTION_ROLE[action] || "viewer";
    const rank = (r) => ROLES.indexOf(r);
    return rank(realtime.role()) >= rank(need);
  };
  realtime.requiredRole = (action) => ACTION_ROLE[action] || "viewer";

  realtime.mode = function () { return mode; };
  realtime.status = function () {
    return {
      mode,
      role: realtime.role(),
      hubEnabled,
      pollFallbackMs,
      presence,
      remoteIndex: Object.assign({}, remoteIndex),
      socketState: socket ? socket.readyState : null,
    };
  };

  /* ---------- RPC helper ---------- */
  async function rpc(method, payload) {
    if (!socket || socket.readyState !== 1) throw new Error("socket not open");
    const data = typeof payload === "string" ? payload : JSON.stringify(payload || {});
    const reply = await socket.rpc[method](data);
    if (typeof reply === "string") {
      try { return JSON.parse(reply); } catch (e) { return reply; }
    }
    return reply;
  }
  realtime.rpc = rpc;

  /* ---------- polling fallback ---------- */
  function startPolling() {
    if (pollTimer) return;
    mode = "polling";
    pollTimer = setInterval(async () => {
      try {
        await BI.bus.refreshAll();
        await BI.store.reconcileAll();
        if (BI.integrity) BI.integrity.refresh();
      } catch (e) { /* keep polling */ }
    }, pollFallbackMs);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ---------- hub message handling ---------- */
  function onMessage(ev) {
    let msg = null;
    try { msg = typeof ev.data === "string" ? JSON.parse(ev.data) : null; } catch (e) { return; }
    if (!msg || !msg.t) return;
    if (msg.t === "index") {
      remoteIndex = msg.index || {};
      for (const tool of Object.keys(remoteIndex)) {
        const remoteEc = remoteIndex[tool];
        const h = BI.bus.healthOf(tool, "ledger"); // any bundle type exposes editCount per tool
        const localEc = h.editCount;
        if (remoteEc != null && (localEc == null || remoteEc > localEc)) {
          BI.bus.refresh(tool).then(() => {
            reportIndex();
            if (BI.integrity) BI.integrity.refresh();
          }).catch(() => { /* source may be mid-flight */ });
        }
      }
      return;
    }
    if (msg.t === "refresh" && msg.tool) {
      BI.bus.refresh(msg.tool).then(() => {
        reportIndex();
        if (BI.integrity) BI.integrity.refresh();
      }).catch(() => { /* noop */ });
      return;
    }
    if (msg.t === "doc" && msg.id) {
      BI.store.refresh(msg.id).then(() => {
        if (BI.integrity) BI.integrity.refresh();
        BI.ui.toast("Updated '" + msg.id + "' by " + msg.actor + " on another device", "warn");
        if (BI.state && BI.state.current) BI.navigate(BI.state.current);
      }).catch(() => { /* noop */ });
    }
    if (msg.t === "hi") {
      remoteIndex = msg.index || {};
      return;
    }
  }

  /* ---------- source index reporting ---------- */
  function reportIndex() {
    if (mode !== "live" || !socket || socket.readyState !== 1) return;
    const tools = {};
    for (const t of BI.bus.tools || []) {
      for (const b of t.bundles || []) {
        const h = BI.bus.healthOf(t.id, b.type);
        if (h.editCount != null && (tools[t.id] == null || h.editCount > tools[t.id])) tools[t.id] = h.editCount;
      }
    }
    rpc("reportIndex", { tools }).catch(() => { /* noop */ });
  }
  realtime.reportIndex = reportIndex;

  /* ---------- document-change announce (post-write broadcast) ---------- */
  realtime.announceDoc = function (info) {
    if (mode !== "live" || !socket || socket.readyState !== 1) return;
    rpc("announceDoc", info).catch(() => { /* noop */ });
  };

  /* ---------- auth ---------- */
  realtime.auth = async function (token) {
    const res = await rpc("auth", { token });
    if (res && res.ok && res.role) {
      realtime.setRole(res.role);
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* noop */ }
      presenceRefresh();
    }
    return res;
  };

  realtime.auditTail = async function () {
    return rpc("auditTail", {});
  };

  function presenceRefresh() {
    if (mode !== "live") return;
    rpc("presence", {}).then((p) => { if (p && p.counts) presence = p.counts; }).catch(() => { /* noop */ });
  }
  realtime.presenceRefresh = presenceRefresh;

  /* ---------- lifecycle ---------- */
  function teardown() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (socket) {
      try { socket.onclose = null; socket.onmessage = null; socket.close(); } catch (e) { /* noop */ }
      socket = null;
    }
  }

  realtime.connect = async function (force) {
    _closing = false;
    if (mode === "live" && socket && !force) return { ok: true, mode };
    teardown();
    stopPolling();
    if (!hubEnabled) { startPolling(); return { ok: false, mode, reason: "hub_disabled" }; }
    if (!window.root || !root.createServerSocket) { startPolling(); return { ok: false, mode, reason: "no_server_plugin" }; }
    mode = "connecting";
    try {
      const s = (socket = root.createServerSocket());
      s.addEventListener("message", onMessage);
      s.addEventListener("close", (ev) => {
        if (socket !== s) return; /* stale socket — superseded by a newer connect */
        onClose(ev);
      });
      await Promise.race([
        s.opened,
        new Promise((_, rej) => setTimeout(() => rej(new Error("open_timeout")), 8000)),
      ]);
      mode = "live";
      reconnectAttempts = 0;
      /* re-auth with the token from this tab's session, if any */
      const token = (() => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } })();
      if (token) rpc("auth", { token }).then((r) => { if (r && r.ok) realtime.setRole(r.role); presenceRefresh(); }).catch(() => { /* noop */ });
      reportIndex();
      presenceRefresh();
      return { ok: true, mode };
    } catch (e) {
      socket = null;
      mode = "off";
      fallbackAfterFailure();
      return { ok: false, mode, reason: "connect_failed" };
    }
  };

  function onClose(ev) {
    const code = ev && ev.code;
    if (_closing || code === 4403 || code === 1000) {
      mode = "polling";
      startPolling();
      return;
    }
    mode = "off";
    socket = null;
    fallbackAfterFailure();
  }

  function fallbackAfterFailure() {
    if (reconnectAttempts >= 3) { startPolling(); return; }
    const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 16000) + Math.random() * 1500;
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      if (mode === "live") return;
      BI.realtime.connect(false).then((r) => { if (!r.ok && mode !== "polling") startPolling(); });
    }, delay);
  }

  realtime.disconnect = function () {
    _closing = true;
    teardown();
    mode = "polling";
    startPolling();
  };

  /* ---------- init (called from app.js boot) ---------- */
  realtime.init = function (opts) {
    opts = opts || {};
    if (opts.hubEnabled != null) hubEnabled = !!opts.hubEnabled;
    if (opts.pollFallbackMs > 0) pollFallbackMs = opts.pollFallbackMs;
    if (!hubEnabled) { startPolling(); return realtime.status(); }
    BI.realtime.connect(false);
    return realtime.status();
  };
})();
