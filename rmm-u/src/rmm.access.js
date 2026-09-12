/* ============================================================
   RMM-U — role & access model (Task 48)

   The collector holds the authoritative registry: every console user
   gets a role (read-only / technician / dispatcher / security-admin),
   an optional site & device scope, and optional per-capability
   overrides. The four destructive actions — script execution, patch
   denial, remote shell and file transfer — are gated one by one rather
   than as a single "admin" bit.

   This module is the CLIENT half. It:

     • mirrors the role/capability catalogue so the UI can grey out what
       a user may not do even before the server answers;
     • caches the registry (server-published via `T.rmmCatalog`) so the
       synchronous gates in other modules (`ACC.can`) stay cheap;
     • asks the hub to authorise a specific action+target (`T.rmmAuthorize`)
       for the authoritative answer; and
     • renders the "Roles & access" console tab where an admin assigns
       roles, scopes and capability overrides.

   The server always re-checks. Hiding a button is convenience; the
   enforcement lives in the collector's `guardAdmin` rule engine.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.team) return;
  const T = ERP.team;
  const COL = ERP.collector || null;
  const ui = ERP.ui;
  const esc = ui.esc;
  const ACC = (ERP.access = {});

  const TEAM_LS = { userId: "erp.team.userId.v1", name: "erp.team.name.v1" };

  /* ─────────────── mirrored catalogue ───────────────
     Kept in step with the collector core (Task 48). `RMMAccessTest`
     asserts the two catalogues agree, so drift is caught. */

  const ROLES = ["read-only", "technician", "dispatcher", "security-admin"];
  const ROLE_DESC = {
    "read-only": "Sees the fleet, devices, inventory and metrics. Changes nothing.",
    "technician": "Works devices: diagnostics, alert work, approved scripts and patch deployment.",
    "dispatcher": "Runs the desk: schedules, routing, dispatch, config pushes and agent updates.",
    "security-admin": "Full control, including the destructive remote actions and access management.",
  };
  const CAPS = {
    "fleet.view": { label: "View the fleet & devices", group: "view" },
    "device.diagnose": { label: "Request diagnostics, logs & self-tests", group: "operate" },
    "alert.work": { label: "Acknowledge, assign & resolve alerts", group: "operate" },
    "job.run": { label: "Run approved scripts & monitors", group: "operate" },
    "job.manage": { label: "Retry, cancel & requeue jobs", group: "operate" },
    "dispatch.manage": { label: "Manage schedules, routing & dispatch", group: "operate" },
    "patch.deploy": { label: "Approve & deploy patches", group: "deploy" },
    "config.push": { label: "Push agent config & queue updates", group: "deploy" },
    "enrollment.manage": { label: "Mint & revoke enrollment tokens", group: "security" },
    "device.revoke": { label: "Revoke device credentials", group: "security" },
    "script.execute": { label: "Execute arbitrary scripts & commands", group: "destructive", destructive: true },
    "patch.deny": { label: "Deny & block patches", group: "destructive", destructive: true },
    "remote.shell": { label: "Open an interactive remote shell", group: "destructive", destructive: true },
    "remote.file": { label: "Transfer files to & from devices", group: "destructive", destructive: true },
    "access.manage": { label: "Manage roles, scopes & capabilities", group: "admin" },
  };
  const DESTRUCTIVE = ["script.execute", "patch.deny", "remote.shell", "remote.file"];
  const ROLE_CAPS = {
    "read-only": ["fleet.view"],
    "technician": ["fleet.view", "device.diagnose", "alert.work", "job.run", "patch.deploy"],
    "dispatcher": ["fleet.view", "device.diagnose", "alert.work", "job.run", "job.manage", "dispatch.manage", "patch.deploy", "config.push"],
    "security-admin": ["fleet.view", "device.diagnose", "alert.work", "job.run", "job.manage", "dispatch.manage", "patch.deploy", "config.push", "enrollment.manage", "device.revoke", "script.execute", "patch.deny", "remote.shell", "remote.file", "access.manage"],
  };
  const CAP_ORDER = ["fleet.view", "device.diagnose", "alert.work", "job.run", "job.manage", "dispatch.manage", "patch.deploy", "config.push", "enrollment.manage", "device.revoke", "script.execute", "patch.deny", "remote.shell", "remote.file", "access.manage"];
  const GROUP_ORDER = ["view", "operate", "deploy", "security", "destructive", "admin"];

  function roleIndex(r) { return ROLES.indexOf(String(r)); }
  function roleLabel(r) { return roleIndex(r) >= 0 ? r : "read-only"; }
  function baseCaps(role) {
    const list = ROLE_CAPS[role] || ROLE_CAPS["read-only"], out = {};
    for (const c of list) out[c] = true;
    return out;
  }
  function derivedRole(teamRole) {
    const r = Number(teamRole);
    if (r === 2) return "security-admin";
    if (r === 1) return "dispatcher";
    return "read-only";
  }
  function capsForRole(role, rec) {
    const out = baseCaps(role);
    if (rec && Array.isArray(rec.allow)) for (const a of rec.allow) if (CAPS[a]) out[a] = true;
    if (rec && Array.isArray(rec.deny)) for (const d of rec.deny) delete out[d];
    return out;
  }
  function inScope(scope, siteId, deviceId) {
    if (!scope || scope.all) return true;
    const sid = siteId == null ? "" : String(siteId), did = deviceId == null ? "" : String(deviceId);
    if (did && (scope.devices || []).indexOf(did) !== -1) return true;
    if (sid && (scope.sites || []).indexOf(sid) !== -1) return true;
    return false;
  }
  function emptyScope() { return { all: true, sites: [], devices: [] }; }
  function scopeSummary(scope) {
    if (!scope || scope.all) return "All sites & devices";
    const s = (scope.sites || []).length, d = (scope.devices || []).length;
    if (!s && !d) return "No scope — nothing visible";
    const a = [];
    if (s) a.push(s + " site" + (s === 1 ? "" : "s"));
    if (d) a.push(d + " device" + (d === 1 ? "" : "s"));
    return a.join(" · ");
  }

  ACC.MODULE = "access";
  ACC.roles = ROLES.slice();
  ACC.caps = CAPS;
  ACC.roleCaps = ROLE_CAPS;
  ACC.destructive = DESTRUCTIVE.slice();
  ACC.capOrder = CAP_ORDER.slice();
  ACC.roleIndex = roleIndex;
  ACC.roleLabel = roleLabel;
  ACC.baseCaps = baseCaps;
  ACC.derivedRole = derivedRole;
  ACC.capsForRole = capsForRole;
  ACC.inScope = inScope;
  ACC.scopeSummary = scopeSummary;
  ACC.emptyScope = emptyScope;
  ACC.capLabel = (id) => (CAPS[id] ? CAPS[id].label : id);
  ACC.catalog = () => ({ roles: ROLES.map((r) => ({ id: r, label: r, description: ROLE_DESC[r] || "", capabilities: ROLE_CAPS[r].slice() })), capabilities: CAP_ORDER.map((id) => ({ id: id, label: CAPS[id].label, group: CAPS[id].group, destructive: !!CAPS[id].destructive })), destructive: DESTRUCTIVE.slice() });

  /* ─────────────── identity & cache ─────────────── */

  let cache = { at: 0, online: false, me: null, users: null, log: null, catalog: null };

  function userId() {
    try {
      const v = localStorage.getItem(TEAM_LS.userId);
      if (v && /^[0-9a-f]{32}$/.test(v)) return v;
    } catch (e) {}
    return "";
  }
  function displayName() {
    try { return localStorage.getItem(TEAM_LS.name) || ""; } catch (e) { return ""; }
  }

  ACC.identity = function () {
    const me = T && T.status === "online" ? T.me : null;
    if (me && me.userId) return { userId: me.userId, teamRole: Number(me.role), displayName: me.displayName || displayName(), source: "hub" };
    const role = ERP.role === "owner" ? 2 : ERP.role === "manager" ? 1 : 0;
    return { userId: userId(), teamRole: role, displayName: displayName(), source: "local" };
  };

  function localCore() {
    try { return COL && typeof COL.localCore === "function" ? COL.localCore() : null; } catch (e) { return null; }
  }

  /* Effective capability set for the signed-in user, preferring the hub's
     cached answer and falling back to the local registry / derived role. */
  function hubLive() { return !!(cache.online && T && T.status === "online"); }
  function effectiveCaps() {
    if (hubLive() && cache.me && Array.isArray(cache.me.caps)) {
      const o = {};
      for (const c of cache.me.caps) o[c] = true;
      return o;
    }
    const id = ACC.identity();
    const core = localCore();
    if (core) {
      try {
        const rec = core.state().access[id.userId] || null;
        return core.capsFor(core.resolveRole(id.userId, id.teamRole, rec), Number(id.teamRole) === 2 ? null : rec);
      } catch (e) {}
    }
    return baseCaps(derivedRole(id.teamRole));
  }
  function effectiveScope() {
    if (hubLive() && cache.me && cache.me.scope) return cache.me.scope;
    const id = ACC.identity();
    const core = localCore();
    if (core) { try { return core.scopeOf(id.userId, id.teamRole, core.state().access[id.userId] || null); } catch (e) {} }
    return emptyScope();
  }

  ACC.effectiveCaps = effectiveCaps;
  ACC.effectiveScope = effectiveScope;
  ACC.myRole = function () { return hubLive() && cache.me && cache.me.role ? cache.me.role : derivedRole(ACC.identity().teamRole); };

  function targetOf(target) {
    if (target == null) return {};
    if (typeof target === "string") return { deviceId: target };
    return { deviceId: target.deviceId == null ? "" : String(target.deviceId), siteId: target.siteId == null ? "" : String(target.siteId) };
  }

  /* Synchronous convenience check for UI gating. `device` may be an id or
     {deviceId, siteId}. A site-scoped user whose device we cannot resolve
     client-side is treated permissively here — the hub is the final
     authority (see `require`), which resolves the device's site itself. */
  ACC.can = function (action, target) {
    const caps = effectiveCaps();
    if (!caps[action]) return false;
    const t = targetOf(target);
    if (!t.deviceId && !t.siteId) return true;
    const scope = effectiveScope();
    if (!scope || scope.all) return true;
    const devices = scope.devices || [], sites = scope.sites || [];
    if (t.deviceId && devices.indexOf(t.deviceId) !== -1) return true;
    if (t.siteId && sites.indexOf(t.siteId) !== -1) return true;
    if (!t.siteId && sites.length && !(t.deviceId && devices.length)) return true;
    return inScope(scope, t.siteId, t.deviceId);
  };

  /* Authoritative check. With a hub connection this asks the server;
     offline it answers from the mirror. Resolves to
     {ok, reason, message, role, requiredRole, destructive, offline}. */
  ACC.require = async function (action, target) {
    const t = targetOf(target);
    if (T && T.status === "online" && typeof T.rmmAuthorize === "function") {
      try {
        const r = await T.rmmAuthorize({ action: action, deviceId: t.deviceId, siteId: t.siteId });
        if (r && (r.ok !== undefined || r.allowed !== undefined)) {
          return { ok: !!r.allowed, reason: r.reason || "", message: r.message || "", role: r.role || "", requiredRole: r.requiredRole || "", destructive: !!r.destructive, action: action };
        }
      } catch (e) {
        return { ok: false, reason: "unavailable", message: "The team hub is unreachable — access cannot be verified right now.", destructive: !!CAPS[action] && CAPS[action].destructive };
      }
    }
    const ok = ACC.can(action, target);
    return { ok: ok, reason: ok ? "" : "forbidden", message: ok ? "" : ("Your " + ACC.myRole() + " role may not " + ACC.capLabel(action).toLowerCase() + "."), role: ACC.myRole(), destructive: !!CAPS[action] && CAPS[action].destructive, offline: true };
  };

  /* ─────────────── load & registry management ─────────────── */

  ACC.load = async function (force) {
    if (!force && cache.at && Date.now() - cache.at < 15000) return cache;
    cache.catalog = ACC.catalog();
    if (T && T.status === "online" && typeof T.rmmCatalog === "function") {
      try {
        const r = await T.rmmCatalog();
        if (r && r.ok) {
          cache.online = true;
          cache.me = r.me || null;
          if (r.catalog) cache.catalog = r.catalog;
          if (r.access) { cache.users = r.access.users || []; cache.log = r.access.log || []; }
          else { cache.users = cache.users || []; cache.log = cache.log || []; }
          cache.at = Date.now();
          return cache;
        }
      } catch (e) {}
    }
    cache.online = false;
    const core = localCore();
    if (core) {
      try {
        cache.catalog = core.accessCatalog();
        const lst = core.admin.listAccess();
        cache.users = lst.users || [];
        cache.log = lst.log || [];
        const id = ACC.identity();
        const rec = core.state().access[id.userId] || null;
        const role = core.resolveRole(id.userId, id.teamRole, rec);
        cache.me = {
          userId: id.userId, teamRole: id.teamRole, role: role,
          caps: Object.keys(core.capsFor(role, Number(id.teamRole) === 2 ? null : rec)),
          scope: core.scopeOf(id.userId, id.teamRole, rec),
          canManage: core.authorize({ userId: id.userId, teamRole: id.teamRole, action: "access.manage" }).ok,
        };
      } catch (e) {}
    }
    cache.at = Date.now();
    return cache;
  };

  ACC.list = async function () { const c = await ACC.load(true); return { users: c.users || [], log: c.log || [], online: c.online }; };
  ACC.me = async function () { const c = await ACC.load(); return c.me; };

  async function manage(run) {
    if (T && T.status === "online" && typeof run === "function") {
      try { return await run(); } catch (e) { return { ok: false, error: "unavailable", message: "The team hub is unreachable." }; }
    }
    return { ok: false, error: "offline", message: "Access changes are enforced by the team hub — connect to change them." };
  }
  ACC.setRole = (userId, role) => manage(() => T.rmmSetRole(userId, role));
  ACC.setScopes = (userId, scopes) => manage(() => T.rmmSetScopes(userId, scopes));
  ACC.setCaps = (userId, allow, deny) => manage(() => T.rmmSetCaps(userId, allow, deny));
  ACC.remove = (userId) => manage(() => T.rmmRemoveAccess(userId));

  /* ─────────────── rendering ─────────────── */

  function chips(ids, toneMap) {
    return (ids || []).map((id) => {
      const t = CAPS[id] && CAPS[id].destructive ? "danger" : (toneMap && toneMap[id]) || "muted";
      return '<span class="erp-chip erp-cap-chip">' + ui.badge(id, t) + "</span>";
    }).join(" ");
  }

  function yourAccessHtml() {
    const role = ACC.myRole();
    const caps = Object.keys(effectiveCaps());
    const grantedDestructive = DESTRUCTIVE.filter((c) => caps.indexOf(c) !== -1);
    return ui.card("Your access", "" +
      ui.summary([
        { label: "Role", value: ui.badge(role, role === "security-admin" ? "danger" : role === "dispatcher" ? "info" : role === "technician" ? "success" : "muted") },
        { label: "Capabilities", value: String(caps.length) + " / " + CAP_ORDER.length },
        { label: "Destructive", value: grantedDestructive.length + " / " + DESTRUCTIVE.length },
        { label: "Scope", value: esc(scopeSummary(effectiveScope())) },
      ]) +
      '<p class="erp-sub" style="margin-top:10px">' + esc(ROLE_DESC[role] || "") + "</p>" +
      '<div class="erp-cap-cloud">' + CAP_ORDER.map((id) => '<span class="erp-cap-chip">' + ui.badge(id, caps.indexOf(id) !== -1 ? (CAPS[id].destructive ? "danger" : "success") : "muted") + "</span>").join(" ") + "</div>", { actions: cache.online ? ui.badge("Enforced by hub", "info") : ui.badge("Local / offline", "warn") });
  }

  function matrixHtml() {
    const cols = [{ key: "cap", label: "Capability", render: (r) => (r.destructive ? '<span class="erp-badge tone-danger">destructive</span> ' : "") + esc(r.label) + ' <code>' + esc(r.id) + "</code>" }];
    for (const role of ROLES) cols.push({ key: role, label: role === "security-admin" ? "security-admin" : role, align: "center", render: (r) => (ROLE_CAPS[role].indexOf(r.id) !== -1 ? '<span class="erp-yes">✓</span>' : '<span class="erp-no">—</span>') });
    const rows = CAP_ORDER.map((id) => ({ id: id, label: CAPS[id].label, destructive: !!CAPS[id].destructive, group: CAPS[id].group }))
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    return '<div class="rmm-mc-section-head"><div><h3>Role capabilities</h3><p class="erp-sub">What each role may do. The four destructive rows are gated separately, so a site can grant patch deployment without granting a remote shell.</p></div></div>' +
      ui.table(cols, rows, { scroll: true });
  }

  function scopeBadge(rec) {
    const s = rec.scopes || emptyScope();
    return ui.badge(scopeSummary(s), s.all ? "muted" : "info");
  }

  function usersHtml() {
    const users = cache.users || [];
    const cols = [
      { key: "userId", label: "User", render: (r) => esc(r.userId.slice(0, 10) + "…") + (r.userId === ACC.identity().userId ? ' <span class="erp-sub">you</span>' : "") },
      { key: "role", label: "Role", render: (r) => '<select data-acc="role" data-arg="' + esc(r.userId) + '" aria-label="Role">' + ROLES.map((role) => '<option value="' + esc(role) + '"' + (r.role === role ? " selected" : "") + ">" + esc(role) + "</option>").join("") + "</select>" },
      { key: "scopes", label: "Scope", render: (r) => scopeBadge(r) },
      { key: "destructive", label: "Destructive", render: (r) => { const e = capsForRole(r.role || "read-only", r); const g = DESTRUCTIVE.filter((c) => e[c]); return g.length ? g.map((c) => ui.badge(c, "danger")).join(" ") : '<span class="erp-sub">none</span>'; } },
      { key: "updatedAt", label: "Updated", render: (r) => esc(ui.dateTime(r.updatedAt)) },
      { key: "act", label: "", align: "right", render: (r) => ui.btn("Scope", { small: true, attrs: { "data-acc": "scope", "data-arg": r.userId } }) + " " + ui.btn("Capabilities", { small: true, attrs: { "data-acc": "caps", "data-arg": r.userId } }) + (r.userId === ACC.identity().userId ? "" : " " + ui.btn("Remove", { small: true, danger: true, attrs: { "data-acc": "remove", "data-arg": r.userId } })) },
    ];
    return '<div class="rmm-mc-section-head"><div><h3>Console access</h3><p class="erp-sub">Every team member gets a role, an optional site/device scope and optional per-capability overrides. The matching user record is created the first time you assign anything here.</p></div>' + ui.btn("Refresh", { small: true, attrs: { "data-acc": "refresh" } }) + "</div>" +
      ui.table(cols, users, { scroll: true, emptyText: "No per-user access records yet — everyone is on their role default." });
  }

  function logHtml() {
    const log = (cache.log || []).slice().reverse();
    const cols = [
      { key: "at", label: "When", render: (r) => esc(ui.dateTime(r.at)) },
      { key: "kind", label: "Change", render: (r) => ui.badge(r.kind || "", "info") },
      { key: "userId", label: "User", render: (r) => esc(String(r.userId || "").slice(0, 12)) },
      { key: "detail", label: "Detail", render: (r) => esc(r.detail || "") },
    ];
    return ui.card("Access changes", ui.table(cols, log, { scroll: true, emptyText: "No access changes recorded yet." }));
  }

  function panelHtml() {
    const st = cache;
    const online = st.online;
    const canManage = !!(st.me && st.me.canManage);
    const parts = [yourAccessHtml()];
    if (!online) parts.push(ui.alert("The team hub is offline, so this is the local (degraded) access model. Roles, scopes and overrides are enforced by the hub once it reconnects.", "warn"));
    else if (!ACC.identity().userId) parts.push(ui.alert("Connect to the team hub to see your console identity and access.", "warn"));
    parts.push(matrixHtml());
    if (canManage) { parts.push(usersHtml()); parts.push(logHtml()); }
    else if (online) parts.push(ui.alert("Managing roles, scopes and capability overrides needs the security-admin role.", "info"));
    parts.push('<p class="erp-sub">Enforcement is server-side: the collector refuses any action your role, scope or overrides do not allow, even if the request never went through this screen.</p>');
    return parts.join("");
  }

  function bind(el, ctx) {
    const toast = (m, t) => { try { ctx && ctx.toast ? ctx.toast(m, t) : ERP.toast(m, t); } catch (e) {} };
    ui.bind(el, "click", "[data-acc=refresh]", () => { cache.at = 0; ACC.paint(el, ctx); });
    ui.bind(el, "change", "[data-acc=role]", async (sel) => {
      const uid = sel.getAttribute("data-arg");
      const r = await ACC.setRole(uid, sel.value);
      if (r && r.ok) { toast("Role updated — enforced by the hub."); cache.at = 0; ACC.paint(el, ctx); }
      else toast("Could not update role (" + ((r && r.error) || "unauthorized") + ").", "error");
    });
    ui.bind(el, "click", "[data-acc=remove]", async (btn) => {
      const uid = btn.getAttribute("data-arg");
      const ok = await ui.confirm({ title: "Remove access record?", message: "This clears the user's role, scope and overrides, returning them to their derived role (" + derivedRole(teamRoleOf(uid)) + ").", okLabel: "Remove", danger: true });
      if (!ok) return;
      const r = await ACC.remove(uid);
      if (r && r.ok) { toast("Access record removed."); cache.at = 0; ACC.paint(el, ctx); }
      else toast("Could not remove (" + ((r && r.error) || "unauthorized") + ").", "error");
    });
    ui.bind(el, "click", "[data-acc=scope]", (btn) => openScope(btn.getAttribute("data-arg"), el, ctx));
    ui.bind(el, "click", "[data-acc=caps]", (btn) => openCaps(btn.getAttribute("data-arg"), el, ctx));
  }

  function teamRoleOf(userId) {
    const u = (cache.users || []).find((x) => x.userId === userId);
    if (u && roleIndex(u.role) >= 0) return roleIndex(u.role);
    return ACC.identity().teamRole;
  }

  function recordOf(userId) {
    const u = (cache.users || []).find((x) => x.userId === userId);
    return u || { userId: userId, role: null, scopes: emptyScope(), allow: [], deny: [] };
  }

  function parseList(v) {
    return String(v || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }

  function openScope(userId, el, ctx) {
    const rec = recordOf(userId);
    const s = rec.scopes || emptyScope();
    const body = ui.form(
      ui.field("Scope", ui.check("all", "Full scope — every site and device", s.all)) +
      ui.field("Site ids", '<textarea name="sites" rows="3" placeholder="site-hq site-br">' + esc((s.sites || []).join(" ")) + "</textarea>", "Space- or comma-separated. Leave both empty with full scope off to grant nothing.") +
      ui.field("Device ids", '<textarea name="devices" rows="3" placeholder="dev-… dev-…">' + esc((s.devices || []).join(" ")) + "</textarea>"),
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Save scope", { small: true, primary: true, id: "accScopeSave" })
    );
    const m = ui.modal({ title: "Scope for " + userId.slice(0, 10) + "…", body: body });
    if (!m) return;
    m.querySelector("#accScopeSave").onclick = async () => {
      const all = m.querySelector('[name="all"]').checked;
      const scopes = { all: all, sites: parseList(m.querySelector('[name="sites"]').value), devices: parseList(m.querySelector('[name="devices"]').value) };
      const r = await ACC.setScopes(userId, scopes);
      if (r && r.ok) { ui.closeModal(); try { (ctx && ctx.toast ? ctx.toast : ERP.toast)("Scope saved."); } catch (e) {} cache.at = 0; ACC.paint(el, ctx); }
      else try { (ctx && ctx.toast ? ctx.toast : ERP.toast)("Could not save scope (" + ((r && r.error) || "unauthorized") + ").", "error"); } catch (e) {}
    };
  }

  function openCaps(userId, el, ctx) {
    const rec = recordOf(userId);
    const role = rec.role || derivedRole(teamRoleOf(userId));
    const effective = capsForRole(role, rec);
    const rows = CAP_ORDER.map((id) => {
      const mode = (rec.allow || []).indexOf(id) !== -1 ? "grant" : (rec.deny || []).indexOf(id) !== -1 ? "revoke" : "inherit";
      return { id: id, label: CAPS[id].label, destructive: !!CAPS[id].destructive, mode: mode, inherited: !!effective[id] };
    });
    const cols = [
      { key: "cap", label: "Capability", render: (r) => (r.destructive ? '<span class="erp-badge tone-danger">destructive</span> ' : "") + esc(r.label) },
      { key: "mode", label: "Override", render: (r) => '<select data-cap="' + esc(r.id) + '" aria-label="Override">' + ["inherit", "grant", "revoke"].map((v) => '<option value="' + v + '"' + (r.mode === v ? " selected" : "") + ">" + v + "</option>").join("") + "</select>" },
      { key: "effective", label: "Effective", align: "center", render: (r) => (r.inherited ? '<span class="erp-yes">✓</span>' : '<span class="erp-no">—</span>') },
    ];
    const body = '<p class="erp-sub">Role default: <b>' + esc(role) + "</b>. Overrides add or remove individual capabilities on top of it — the destructive actions are the ones worth gating closely.</p>" +
      ui.table(cols, rows, { scroll: true }) +
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Save overrides", { small: true, primary: true, id: "accCapsSave" });
    const m = ui.modal({ title: "Capabilities for " + userId.slice(0, 10) + "…", body: body, size: "lg" });
    if (!m) return;
    m.querySelector("#accCapsSave").onclick = async () => {
      const allow = [], deny = [];
      m.querySelectorAll("[data-cap]").forEach((sel) => {
        if (sel.value === "grant") allow.push(sel.getAttribute("data-cap"));
        else if (sel.value === "revoke") deny.push(sel.getAttribute("data-cap"));
      });
      const r = await ACC.setCaps(userId, allow, deny);
      if (r && r.ok) { ui.closeModal(); try { (ctx && ctx.toast ? ctx.toast : ERP.toast)("Capability overrides saved."); } catch (e) {} cache.at = 0; ACC.paint(el, ctx); }
      else try { (ctx && ctx.toast ? ctx.toast : ERP.toast)("Could not save overrides (" + ((r && r.error) || "unauthorized") + ").", "error"); } catch (e) {}
    };
  }

  ACC.render = ACC.paint = async function (el, ctx) {
    if (!el) return;
    el.innerHTML = '<section class="erp-card"><div class="erp-card-body"><p class="erp-sub">Loading the access registry…</p></div></section>';
    try { await ACC.load(true); } catch (e) {}
    el.innerHTML = panelHtml();
    bind(el, ctx);
  };

  /* A one-line human description, mirroring the server's `describeAuth`. */
  ACC.describe = function (result) {
    if (!result) return "Not permitted.";
    if (result.ok) return "Permitted as " + (result.role || ACC.myRole()) + ".";
    if (result.message) return result.message;
    if (result.reason === "out_of_scope") return "This device or site is outside your assigned scope.";
    if (result.reason === "forbidden") return "Your role may not do that.";
    return "Not permitted.";
  };

  /* Called by the shell when the team hub changes role/presence so the
     cached registry does not go stale under an open panel. */
  ACC.invalidate = function () { cache.at = 0; cache.online = false; };
})();
