/* ============================================================
   BUSINESS ERP — team hub client (Tasks 41–44)
   Realtime companion to the server script in index.html:
   - a stable per-device identity (userId + display name)
   - presence / online peers
   - server-authorised role enforcement (T.guard) and signed
     audit entries (T.signAudit) — only when the hub is online;
     offline the app degrades to local roles + local audit
   - live document-change fan-out: when another device saves, we
     re-sync that document from the canonical store (idempotent,
     version-checked), so two people editing the same records see
     each other's saved changes without overwriting
   Works with the real server socket (root.createServerSocket) or
   a mock transport (T.setTransport) for deterministic tests.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const store = window.ERP && window.ERP.store;
  if (!store) return;

  const T = (ERP.team = {});
  const $ = (s) => document.querySelector(s);
  const ui = window.ERP.ui;
  const esc = ui ? ui.esc : ERP.escapeHtml;

  const LS = { userId: "erp.team.userId.v1", name: "erp.team.name.v1" };

  let socket = null;
  let transport = null; // mock transport (tests)
  let forceOnline = false; // tests: pretend the hub is online
  let status = "offline"; // offline | connecting | online
  let me = null; // {userId, displayName, role, admin}
  let peers = []; // [{userId, displayName, role, admin}]
  let hubIndex = []; // [{d, r, u, n, ts}]
  let panelRefresh = null;
  let retryTimer = null;
  let retryDelay = 1000;
  let started = false;
  let modalOpen = false;
  const syncTimers = {};

  Object.defineProperty(T, "online", { get() { return status === "online" && !store.backendOverridden(); } });
  Object.defineProperty(T, "status", { get() { return status; } });
  Object.defineProperty(T, "me", { get() { return me; } });
  T.peersList = peers;
  T.hubIndex = hubIndex;

  function active() { return (status === "online" && !store.backendOverridden()) || forceOnline; }

  function persist(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : v; } catch (e) { return fb; } }

  /* ─────────────────── identity ─────────────────── */

  function userId() {
    let id = load(LS.userId, "");
    if (!/^[0-9a-f]{32}$/.test(id)) {
      const bytes = new Uint8Array(16);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
      id = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      persist(LS.userId, id);
    }
    return id;
  }
  function displayName() {
    const n = load(LS.name, "").replace(/[^\x20-\x7e]/g, "").trim();
    return n ? n.slice(0, 24) : "User";
  }
  function saveName(n) {
    n = String(n || "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 24);
    if (!n) n = "User";
    persist(LS.name, n);
    return n;
  }

  function roleLabel(r) { return r === 2 ? "owner" : r === 1 ? "manager" : "staff"; }
  function roleIndex(r) { return r === "owner" ? 2 : r === "manager" ? 1 : 0; }
  function roleBadge(r) { return '<span class="erp-badge tone-' + (r === 2 ? "danger" : r === 1 ? "info" : "muted") + '">' + roleLabel(r) + "</span>"; }

  /* ─────────────────── transport / socket ─────────────────── */

  function makeSocket() {
    let s = null;
    try {
      const r = window.root;
      s = r && typeof r.createServerSocket === "function" ? r.createServerSocket() : null;
    } catch (e) { s = null; }
    if (!s) {
      try { s = typeof window.createServerSocket === "function" ? window.createServerSocket() : null; } catch (e) { s = null; }
    }
    return s;
  }

  async function rpc(method, payload) {
    const data = JSON.stringify(payload || {});
    if (transport) return JSON.parse(await transport.rpc(method, data));
    if (!socket || socket.readyState !== 1) throw new Error("team hub not connected");
    return JSON.parse(await socket.rpc[method](data));
  }

  function doHello() {
    rpc("hello", { userId: userId(), displayName: displayName() })
      .then((res) => {
        if (res && res.ok) {
          me = { userId: res.userId, displayName: res.displayName, role: res.role, admin: !!res.admin };
          applyServerRole();
          setStatus("online");
          return rpc("index", {}).then((idx) => {
            if (idx && idx.ok) hubIndex = idx.index || [];
          }).catch(() => {}).then(() => rpc("peers", {})).then((pl) => {
            if (pl && pl.ok) peers = pl.peers || [];
          }).catch(() => {});
        } else {
          setStatus("offline");
        }
      })
      .catch(() => setStatus("offline"))
      .then(() => { updateIndicator(); reRender(); });
  }

  function scheduleReconnect(code) {
    if (code === 4403 || code === 4400 || code === 4429) return; // permanent
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (transport) return;
      connect();
    }, retryDelay + Math.random() * 500);
    retryDelay = Math.min(retryDelay * 2, 15000);
  }

  function connect() {
    if (transport) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    try {
      socket = makeSocket();
    } catch (e) { socket = null; }
    if (!socket) { setStatus("offline"); scheduleReconnect(); return; }
    setStatus("connecting");
    socket.addEventListener("open", () => { retryDelay = 1000; doHello(); });
    socket.addEventListener("message", (ev) => {
      try { onHubMessage(JSON.parse(ev.data)); } catch (e) {}
    });
    socket.addEventListener("close", (ev) => {
      setStatus("offline");
      scheduleReconnect(ev && ev.code);
    });
  }

  T.start = function () {
    if (started) return;
    started = true;
    if (transport) return;
    if (store.backendOverridden()) return; // suites/restores control the hub themselves
    connect();
  };

  T.stop = function () {
    clearTimeout(retryTimer);
    if (socket) { try { socket.close(); } catch (e) {} socket = null; }
    setStatus("offline");
  };

  /* Test seam: swap in a mock transport (must expose rpc(method, data)→Promise<string>,
     and call transport.onopen / transport.onmessage(string) / transport.onclose). */
  T.setTransport = function (t) {
    clearTimeout(retryTimer);
    if (socket) { try { socket.close(); } catch (e) {} socket = null; }
    transport = t || null;
    forceOnline = !!t;
    if (transport) {
      transport.onopen = () => { setStatus("online"); doHello(); };
      transport.onmessage = (raw) => { try { onHubMessage(JSON.parse(raw)); } catch (e) {} };
      transport.onclose = () => { setStatus("offline"); };
      try { transport.open(); } catch (e) {}
    } else {
      setStatus("offline");
      if (started && !store.backendOverridden()) connect();
    }
    updateIndicator();
    reRender();
  };

  T.setForceOnline = function (v) { forceOnline = !!v; updateIndicator(); };

  /* ─────────────────── status / indicators ─────────────────── */

  function applyServerRole() {
    if (!me) return;
    if (me.role !== roleIndex(ERP.role)) ERP.role = roleLabel(me.role);
    const wrap = $("#roleSelectWrap"), sel = $("#roleSelect");
    if (wrap && sel) {
      sel.disabled = true;
      sel.value = roleLabel(me.role);
      wrap.classList.add("locked");
      wrap.title = "Role is server-authorised while the team hub is online";
    }
  }

  function releaseRoleSelect() {
    const wrap = $("#roleSelectWrap"), sel = $("#roleSelect");
    if (wrap && sel) {
      sel.disabled = false;
      wrap.classList.remove("locked");
      wrap.title = "Local role demo — when the team hub is online the server role overrides this";
    }
  }

  function setStatus(s) {
    status = s;
    if (s !== "online") releaseRoleSelect();
    updateIndicator();
  }

  function updateIndicator() {
    const dot = $("#teamDot"), txt = $("#teamStateText");
    const on = T.online;
    const cls = on ? "green" : status === "connecting" ? "amber" : "gray";
    if (dot) dot.className = "erp-team-dot " + cls;
    if (txt) txt.textContent = on ? "online" : status === "connecting" ? "connecting…" : "offline";
    const btn = $("#teamBtn");
    if (btn) btn.classList.toggle("online", on);
  }

  /* ─────────────────── hub messages ─────────────────── */

  function logicalName(name) {
    try { if (store.humanDocName) return store.humanDocName(name); } catch (e) {}
    return name;
  }

  function scheduleSync(name) {
    clearTimeout(syncTimers[name]);
    syncTimers[name] = setTimeout(() => {
      delete syncTimers[name];
      store.syncDoc(name)
        .then((res) => {
          if (res && (res.state === "fast_forwarded" || res.state === "pushed")) {
            const by = T.lastChange ? T.lastChange.by : "a teammate";
            ERP.toast("Live update — " + logicalName(name) + " changed by " + by + ".", "success");
          } else if (res && res.state === "conflict") {
            ERP.toast("Live update caused a conflict in " + logicalName(name) + " — review it.", "error");
          }
        })
        .catch((e) => { console.error("team sync failed", name, e); });
    }, 450);
  }

  function bumpIndex(d, r, u, n, ts) {
    const i = hubIndex.findIndex((x) => x.d === d);
    if (i >= 0) hubIndex[i] = { d, r, u, n, ts };
    else hubIndex.push({ d, r, u, n, ts });
    hubIndex.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    hubIndex = hubIndex.slice(0, 50);
  }

  function onHubMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "chg") {
      T.lastChange = { name: msg.d, by: msg.n || msg.u, ts: msg.ts };
      bumpIndex(msg.d, msg.r, msg.u, msg.n, msg.ts);
      if (active()) scheduleSync(msg.d);
    } else if (msg.t === "pres") {
      const idx = peers.findIndex((p) => p.userId === msg.u);
      if (msg.on) {
        const rec = { userId: msg.u, displayName: msg.n || msg.u, role: msg.r, admin: false };
        if (idx >= 0) peers[idx] = rec; else peers.push(rec);
      } else if (idx >= 0) {
        peers.splice(idx, 1);
      }
      if (me && msg.u === me.userId && msg.on) me.role = msg.r;
    } else if (msg.t === "role") {
      if (me && msg.u === me.userId) {
        me.role = msg.r;
        if (active()) { applyServerRole(); }
      }
      const idx = peers.findIndex((p) => p.userId === msg.u);
      if (idx >= 0) peers[idx].role = msg.r;
    } else if (msg.t === "audit") {
      T.lastAuditSeq = msg.s;
    }
    reRender();
  }

  let rerenderTimer = null;
  function reRender() {
    if (modalOpen) renderModal();
    if (panelRefresh && document.querySelector('#view [data-panel="team"]')) {
      clearTimeout(rerenderTimer);
      rerenderTimer = setTimeout(panelRefresh, 250);
    }
  }

  /* ─────────────────── RPC API ─────────────────── */

  T.guard = async function (action) {
    if (!active()) return;
    const res = await rpc("authorize", { action });
    if (!res || !res.ok) {
      if (res && res.err === "rate") throw new Error("The team hub is busy right now — try again in a moment.");
      const need = (res && res.requiredRole) || "a higher role";
      throw new Error("This action needs the " + need + " role on the team hub (your server role: " + (me ? roleLabel(me.role) : "unknown") + ").");
    }
  };

  T.signAudit = async function (entry) {
    if (!active()) return null;
    const res = await rpc("approve", {
      action: entry.action || "updated",
      summary: entry.summary || "",
      targetType: entry.targetType || "",
      targetId: entry.targetId == null ? null : String(entry.targetId),
    });
    if (!res) return null;
    if (res.ok && res.entry) return { entry: res.entry };
    if (res.denied) return { denied: res.reason || "not authorised" };
    if (res.err === "rate") return { denied: "the hub is busy — try again in a moment" };
    return { denied: res.err || "not authorised" };
  };

  T.authAdmin = async function (password) {
    const res = await rpc("authAdmin", { password: String(password || "") });
    if (res && res.ok) {
      if (me) { me.admin = true; me.role = 2; }
      applyServerRole();
      return { ok: true, role: res.role, admin: true };
    }
    return { ok: false, err: (res && res.err) || "failed" };
  };

  T.setRole = async function (userId, role) {
    const res = await rpc("setRole", { userId: userId, role: roleIndex(role) });
    return res || { ok: false, err: "no reply" };
  };

  T.removeUser = async function (userId) {
    const res = await rpc("removeUser", { userId: userId });
    return res || { ok: false, err: "no reply" };
  };

  T.listUsers = async function () { return await rpc("listUsers", {}); };
  T.peers = async function () { const r = await rpc("peers", {}); return r || { ok: false }; };
  T.whoami = async function () { return await rpc("whoami", {}); };
  T.auditTail = async function (limit) { return await rpc("auditTail", { limit: limit || 100 }); };
  T.index = async function () { return await rpc("index", {}); };

  /* Fire-and-forget change announce (called by the store after a committed write). */
  T.announceChange = function (name, rev) {
    if (!active()) return;
    rpc("announce", { doc: name, rev: rev }).catch(() => {});
  };

  /* ─────────────────── rendering ─────────────────── */

  function statusHtml(showAction) {
    const on = T.online;
    const role = me ? roleLabel(me.role) : (ERP.role || "owner");
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Hub status</h3><div class="erp-card-actions">' + roleBadge(role) + "</div></header>" +
      '<div class="erp-card-body">' +
      '<div class="erp-team-statusline"><span class="erp-team-dot ' + (on ? "green" : status === "connecting" ? "amber" : "gray") + '"></span>' +
      "<b>" + (on ? "Online — server-authorised mode" : status === "connecting" ? "Connecting…" : "Offline — local demo mode") + "</b></div>" +
      "<p class=\"erp-sub\">" + (on
        ? "Roles are enforced by the hub, saved changes are announced to teammates, and sensitive actions are recorded in the server audit ring. Everything is signed with your server identity."
        : "The hub is unreachable, so this device uses its local role selector and local audit log. Your changes still sync through the document store, and the hub will re-authorise you the next time it connects.") + "</p>" +
      (showAction ? '<div class="erp-btn-row">' + ui.btn(on ? "Reconnect" : "Connect", { small: true, act: "tm-reconnect" }) + "</div>" : "") +
      "</div></section>"
    );
  }

  function identityHtml() {
    const id = userId();
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Your identity</h3><div class="erp-card-actions">' + (me && me.admin ? '<span class="erp-badge tone-danger">admin</span>' : "") + "</div></header>" +
      '<div class="erp-card-body">' +
      ui.form(
        '<div class="erp-grid erp-grid-2">' +
        ui.field("Display name (shown to teammates)", '<input type="text" name="displayName" maxlength="24" value="' + esc(displayName()) + '">') +
        "</div>",
        ui.btn("Save name", { small: true, primary: true, act: "tm-save-name" })
      ) +
      '<p class="erp-sub">Device id <code>' + esc(id.slice(0, 8) + "…" + id.slice(-4)) + "</code> · full id " + esc(id) + "</p>" +
      "</div></section>"
    );
  }

  function adminLoginHtml() {
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Owner unlock</h3></header>' +
      '<div class="erp-card-body">' +
      '<p class="erp-sub">Enter the first-time owner password to claim the owner role on this connection. It must be re-entered after each reload (the hub never stores the password — only its hash).</p>' +
      ui.form(
        '<div class="erp-grid erp-grid-2">' + ui.field("Owner password", '<input type="password" name="adminPw" autocomplete="off">') + "</div>",
        ui.btn("Unlock owner", { small: true, primary: true, act: "tm-auth-admin" })
      ) +
      "</div></section>"
    );
  }

  function peersHtml() {
    const rows = peers.length
      ? peers.map((p) =>
        '<tr><td>' + esc(p.displayName || p.userId) + "</td><td>" + roleBadge(p.role) + (p.admin ? ' <span class="erp-badge tone-danger">admin</span>' : "") + "</td><td><code>" + esc((p.userId || "").slice(0, 8)) + "</code></td></tr>"
      ).join("")
      : '<tr class="erp-empty-row"><td colspan="3">No other teammates online right now.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Online now</h3><div class="erp-card-actions"><span class="erp-badge tone-info">' + peers.length + "</span></div></header>" +
      '<div class="erp-card-body">' +
      '<div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Name</th><th>Role</th><th>Id</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function changesHtml() {
    const rows = hubIndex.length
      ? hubIndex.slice(0, 8).map((c) =>
        '<tr><td>' + esc(logicalName(c.d)) + "</td><td>rev " + (c.r || 0) + "</td><td>" + esc(c.n || c.u || "?") + "</td><td>" + ui.dateTime(new Date((c.ts || 0) * 1000).toISOString()) + "</td></tr>"
      ).join("")
      : '<tr class="erp-empty-row"><td colspan="4">No live changes yet. When a teammate saves a document you will see it here and it will re-sync automatically.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Live changes</h3><div class="erp-card-actions">' + ui.btn("Refresh", { small: true, act: "tm-refresh" }) + "</div></header>" +
      '<div class="erp-card-body">' +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Document</th><th>Version</th><th>By</th><th>When</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function usersHtml(users) {
    const rows = users.length
      ? users.map((u) =>
        '<tr><td>' + esc(u.displayName || u.userId) + "</td><td><code>" + esc(u.userId) + "</code></td><td>" +
        '<select data-act="tm-set-role" data-arg="' + esc(u.userId) + '" aria-label="Role for ' + esc(u.displayName) + '">' +
        '<option value="owner"' + (u.role === 2 ? " selected" : "") + ">Owner</option>" +
        '<option value="manager"' + (u.role === 1 ? " selected" : "") + ">Manager</option>" +
        '<option value="staff"' + (u.role === 0 ? " selected" : "") + ">Staff</option>" +
        "</select></td><td>" + (u.online ? '<span class="erp-badge tone-info">online</span>' : '<span class="erp-badge tone-muted">offline</span>') + "</td><td>" +
        (u.userId === userId() ? '<span class="erp-sub">you</span>' : ui.btn("Remove", { small: true, danger: true, act: "tm-remove-user", arg: u.userId })) +
        "</td></tr>"
      ).join("")
      : '<tr class="erp-empty-row"><td colspan="5">No registered users yet.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Users &amp; roles (server registry)</h3><div class="erp-card-actions">' + ui.btn("Refresh", { small: true, act: "tm-refresh" }) + "</div></header>" +
      '<div class="erp-card-body">' +
      '<p class="erp-sub">Assigning a role here is enforced by the hub on every guarded action. The first user to ever connect was made owner; the owner password upgrades any connection.</p>' +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Name</th><th>User id</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function auditHtml(tail) {
    const rows = tail.length
      ? tail.map((a) =>
        '<tr><td>' + a.seq + "</td><td>" + ui.dateTime(new Date((a.ts || 0) * 1000).toISOString()) + "</td><td>" + roleBadge(a.role) + "</td><td><code>" + esc(a.user) + "</code></td><td>" + esc(a.action) + "</td></tr>"
      ).join("")
      : '<tr class="erp-empty-row"><td colspan="5">No server-signed actions yet. Sensitive changes (postings, payments, closes, chart/tax/settings edits, backups) are recorded here by the hub.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Server audit ring</h3><div class="erp-card-actions">' + ui.btn("Refresh", { small: true, act: "tm-refresh" }) + "</div></header>" +
      '<div class="erp-card-body">' +
      '<p class="erp-sub">The hub records the true server identity for every approved sensitive action (ring of the last 4096). Full detail lives in the per-module audit log.</p>' +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Seq</th><th>When</th><th>Role</th><th>User</th><th>Action</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  T.renderTeam = async function (p, refresh) {
    panelRefresh = refresh;
    let users = [], tail = [];
    if (T.online) {
      try { const u = await T.listUsers(); if (u && u.ok) users = u.users || []; } catch (e) {}
      try { const a = await T.auditTail(100); if (a && a.ok) tail = a.entries || []; } catch (e) {}
    }
    const canManage = T.online && me && (me.admin || me.role === 2);
    const parts = [statusHtml(true), identityHtml()];
    if (T.online && me && !me.admin && me.role !== 2) parts.push(adminLoginHtml());
    parts.push(changesHtml());
    if (T.online) parts.push(peersHtml());
    if (canManage) { parts.push(usersHtml(users)); parts.push(auditHtml(tail)); }
    p.innerHTML = ui.pageHead("Team & access", "Realtime hub: server-authorised roles, presence, live document changes and the multi-user audit.", "") +
      '<div class="erp-team-grid">' + parts.join("") + "</div>";

    ui.bind(p, "click", "[data-act=tm-reconnect]", () => { T.stop(); T.start(); });
    ui.bind(p, "click", "[data-act=tm-save-name]", () => {
      const inp = p.querySelector('[name="displayName"]');
      const n = saveName(inp && inp.value);
      me = me || { userId: userId() };
      me.displayName = n;
      rpc("hello", { userId: userId(), displayName: n }).then((res) => {
        if (res && res.ok) me.role = res.role;
        ERP.toast("Display name saved as “" + n + "”.", "success");
        reRender();
      }).catch(() => ERP.toast("Saved locally — will apply when the hub reconnects.", "success"));
    });
    ui.bind(p, "click", "[data-act=tm-auth-admin]", async () => {
      const pw = p.querySelector('[name="adminPw"]');
      const r = await T.authAdmin(pw && pw.value);
      if (r.ok) { ERP.toast("Owner unlocked on this connection.", "success"); reRender(); }
      else if (r.err === "rate") ERP.toast("Too many attempts — wait a minute.", "error");
      else ERP.toast("That password isn't the owner password.", "error");
    });
    ui.bind(p, "click", "[data-act=tm-refresh]", () => reRender());
    ui.bind(p, "click", "[data-act=tm-remove-user]", async (t, e, act, arg) => {
      const ok = await ui.confirm({ title: "Remove user?", message: "This removes the user from the hub registry and disconnects them.", okLabel: "Remove", danger: true });
      if (!ok) return;
      const r = await T.removeUser(arg);
      if (r.ok) { ERP.toast("User removed.", "success"); reRender(); }
      else ERP.toast((r.err === "self" ? "You can't remove yourself." : "Could not remove user."), "error");
    });
    ui.bind(p, "change", "[data-act=tm-set-role]", async (sel) => {
      const r = await T.setRole(sel.getAttribute("data-arg"), sel.value);
      if (r.ok) { ERP.toast("Role updated and enforced by the hub.", "success"); reRender(); }
      else ERP.toast("Could not update role (" + (r.err || "unauthorized") + ").", "error");
    });
  };

  /* ─────────────────── topbar modal (all roles) ─────────────────── */

  function wireModalButtons(root) {
    const save = root.querySelector("[data-act=tm-save-name]");
    if (save) save.addEventListener("click", () => {
      const inp = root.querySelector('[name="displayName"]');
      const n = saveName(inp && inp.value);
      if (me) me.displayName = n;
      rpc("hello", { userId: userId(), displayName: n }).then((res) => {
        if (res && res.ok && me) me.role = res.role;
        ERP.toast("Display name saved as “" + n + "”.", "success");
        reRender();
      }).catch(() => ERP.toast("Saved locally — will apply when the hub reconnects.", "success"));
    });
    const auth = root.querySelector("[data-act=tm-auth-admin]");
    if (auth) auth.addEventListener("click", async () => {
      const pw = root.querySelector('[name="adminPw"]');
      const r = await T.authAdmin(pw && pw.value);
      if (r.ok) { ERP.toast("Owner unlocked on this connection.", "success"); reRender(); }
      else if (r.err === "rate") ERP.toast("Too many attempts — wait a minute.", "error");
      else ERP.toast("That password isn't the owner password.", "error");
    });
    const rec = root.querySelector("[data-act=tm-reconnect]");
    if (rec) rec.addEventListener("click", () => { T.stop(); T.start(); });
  }

  function renderModal() {
    const m = $("#uiModal");
    if (!m || !modalOpen) return;
    const body = $("#uiModalBody");
    if (!body) return;
    const on = T.online;
    let html = '<div class="erp-team-modal">' + statusHtml(false) + "</div>";
    if (on) {
      html += '<div class="erp-team-modal">' + identityHtml() + "</div>";
      if (me && !me.admin && me.role !== 2) html += '<div class="erp-team-modal">' + adminLoginHtml() + "</div>";
      html += '<div class="erp-team-modal">' + peersHtml() + "</div>";
    }
    html += '<p class="erp-modal-note">Full management — users &amp; roles, live changes and the server audit ring — lives in <b>Reports → Team &amp; access</b>.</p>';
    body.innerHTML = html;
    wireModalButtons(body);
  }

  T.openTeamModal = function () {
    modalOpen = true;
    ui.modal({
      title: "Team hub",
      body: '<div class="erp-team-modal"><p class="erp-sub">Loading hub state…</p></div>',
      foot: ui.btn("Close", { small: true, act: "tm-modal-close" }),
    });
    const m = $("#uiModal");
    if (m) {
      const closeBtn = m.querySelector("[data-act=tm-modal-close]");
      if (closeBtn) closeBtn.addEventListener("click", () => ui.closeModal());
    }
    renderModal();
  };

  /* ─────────────────── boot ─────────────────── */

  function boot() {
    const btn = $("#teamBtn");
    if (btn) btn.addEventListener("click", () => T.openTeamModal());
    if (ui && typeof ui.closeModal === "function") {
      const orig = ui.closeModal.bind(ui);
      ui.closeModal = function () { modalOpen = false; return orig(); };
    }
    T.start();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
