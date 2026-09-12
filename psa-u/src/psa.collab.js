/* ============================================================
   PSA-U — collaboration: roles, capabilities, presence & polling
   (Phase 13 · Tasks 59–61)
   The client half of the optional realtime hub. It does four jobs:

     1. Capability model.  A functional role (administrator /
        dispatcher / account manager / finance / technician) maps to
        a set of capability bits (view, work, dispatch, sales,
        supply, finance, manage). Combined with the system-role
        floor and the per-user company / board scope + financial
        flag, this mirrors — exactly — the authorisation the hub
        performs server-side, so the UI's idea of "can I do this?"
        agrees with the authority that will actually decide.
        While the hub is online the server identity is
        authoritative: `ERP.security.can()` routes here.

     2. Presence & editing.  Peers carry a `focus` (what record they
        are editing). Controllers call `C.noteEditing(kind, id)`
        when they open a record and `C.clearEditing()` when they
        leave; `C.editorsChip(kind, id)` renders "also editing"
        chips that live-update as peers come and go.

     3. Realtime change fan-out.  When a teammate saves a document
        the hub broadcasts a `chg`; the store reconciles that one
        document (idempotent, version-checked) and the active
        station re-renders — unless a modal is open, in which case
        the user's edit is never yanked out from under them.

     4. Graceful degradation.  If the hub is unreachable the app
        polls the document store on a timer instead (`C.polling`),
        so multiple sessions still converge without the hub.

   Everything here is inert when the hub is offline: the app keeps
   working exactly as it did before Phase 13.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const C = (ERP.collab = {});
  const ui = ERP.ui;
  const store = ERP.store;

  /* ═══════════════════ capability model (mirrors the hub server script) ═══════════════════

     These tables are deliberately byte-for-byte equivalent in meaning to the
     server's: if you change one, change the other. `C.schema()` exposes them
     so the test-suite can assert the two agree on the wire. */

  const FUNC_IDS = ["administrator", "dispatcher", "account_manager", "finance", "technician"];
  const FUNC_LABELS = { administrator: "Administrator", dispatcher: "Dispatcher", account_manager: "Account manager", finance: "Finance", technician: "Technician" };
  const FUNC_DESCS = {
    administrator: "Full access to every module, every company and every financial figure.",
    dispatcher: "Sees the whole service queue and schedules work; no billing.",
    account_manager: "Owns client relationships and commercial detail; sees financials.",
    finance: "Billing, invoicing and financial reporting.",
    technician: "Delivers service work; no financial visibility by default.",
  };

  const CAP = { view: 1, work: 2, dispatch: 4, sell: 8, buy: 16, finance: 32, manage: 64 };
  const CAP_LABELS = { view: "view", work: "work", dispatch: "dispatch", sell: "sales", buy: "supply", finance: "finance", manage: "manage" };
  const CAP_ALL = 127;
  const FUNC_CAPS = {
    administrator: CAP_ALL,
    dispatcher: CAP.view | CAP.work | CAP.dispatch,
    account_manager: CAP.view | CAP.work | CAP.sell | CAP.finance,
    finance: CAP.view | CAP.finance,
    technician: CAP.view | CAP.work,
  };

  const SYSTEM_ROLE_LABELS = { 0: "staff", 1: "manager", 2: "owner" };
  const SYSTEM_ROLE_INDEX = { staff: 0, manager: 1, owner: 2 };

  const PERM_OWNER_ONLY = { "companies.delete": 1, "members.edit": 1, "taxonomy.edit": 1, "backup.manage": 1, "security.edit": 1, "rates.edit": 1, "catalog.margins": 1 };
  const PERM_STAFF_OK = { "tickets.edit": 1, "appointments.edit": 1, "timeoff.edit": 1, "time.edit": 1, "expenses.edit": 1, "sales.activity": 1, "procurement.receive": 1, "approvals.request": 1 };
  const PERM_MANAGER_VIEW = { "financials.view": 1, "rates.view": 1, "security.view": 1, "data.view": 1, "workflow.view": 1, "notifications.view": 1 };
  const PERM_FINANCIAL = {
    "financials.view": 1, "rates.view": 1, "rates.edit": 1,
    "billing.view": 1, "billing.edit": 1, "billing.post": 1,
    "payments.view": 1, "payments.edit": 1, "payments.void": 1,
    "reports.financial": 1, "agreements.bill": 1, "catalog.margins": 1,
  };
  const KNOWN_PREFIX = {
    dashboard: 1, companies: 1, sites: 1, contacts: 1, members: 1, teams: 1, calendars: 1, taxonomy: 1,
    financials: 1, data: 1, sync: 1, backup: 1, portal: 1, security: 1, tickets: 1, boards: 1, routing: 1,
    sla: 1, templates: 1, workflow: 1, notifications: 1, dispatch: 1, appointments: 1, schedule: 1,
    timeoff: 1, time: 1, expenses: 1, rates: 1, agreements: 1, billing: 1, payments: 1, projects: 1,
    sales: 1, catalog: 1, procurement: 1, inventory: 1, kb: 1, configuration: 1, rmm: 1, approvals: 1,
    reports: 1, integrations: 1, api: 1, integrity: 1,
  };

  /* legacy guarded-action names → permission (mirrors the server) */
  const ACTION_PERM = {
    post_journal: "billing.post", reverse_journal: "billing.post", receive_payment: "payments.edit",
    bank_entry: "payments.edit", clear_bank: "payments.edit", credit_note: "payments.edit",
    close_period: "data.manage", reopen_period: "data.manage",
    chart_update: "taxonomy.edit", tax_update: "taxonomy.edit", defaults_update: "taxonomy.edit",
    settings_update: "data.manage", pay_bill: "procurement.approve",
    restore_backup: "backup.manage", publish_backup: "backup.manage", archive_doc: "data.manage",
    restore_archive: "data.manage", invoice_from_order: "billing.edit",
  };

  C.FUNC_IDS = FUNC_IDS;
  C.FUNC_LABELS = FUNC_LABELS;
  C.FUNC_DESCS = FUNC_DESCS;
  C.CAP = CAP;
  C.CAP_LABELS = CAP_LABELS;
  C.FUNC_CAPS = FUNC_CAPS;
  C.PERM_FINANCIAL = PERM_FINANCIAL;

  C.funcId = (i) => FUNC_IDS[Number(i)] || "technician";
  C.funcIndex = (id) => { const i = FUNC_IDS.indexOf(String(id)); return i < 0 ? FUNC_IDS.length - 1 : i; };
  C.funcLabel = (i) => FUNC_LABELS[C.funcId(i)];
  C.systemRoleLabel = (n) => SYSTEM_ROLE_LABELS[Number(n)] || "staff";
  C.systemRoleIndex = (label) => (SYSTEM_ROLE_INDEX[label] == null ? 0 : SYSTEM_ROLE_INDEX[label]);
  C.capsOf = (func) => FUNC_CAPS[C.funcId(func)] || 0;

  C.hasCap = (func, bit) => (C.capsOf(func) & bit) === bit;
  C.capList = function (func) {
    const bits = C.capsOf(func);
    return Object.keys(CAP).filter((k) => (bits & CAP[k]) === CAP[k]).map((k) => CAP_LABELS[k]);
  };

  C.permKnown = function (perm) {
    perm = String(perm || "");
    const i = perm.indexOf(".");
    if (i <= 0) return false;
    if (KNOWN_PREFIX[perm.slice(0, i)]) return true;
    return !!(ERP.security && ERP.security.PERMS && ERP.security.PERMS[perm] !== undefined);
  };

  C.permSystemRole = function (perm) {
    if (PERM_OWNER_ONLY[perm]) return 2;
    if (PERM_MANAGER_VIEW[perm]) return 1;
    if (PERM_STAFF_OK[perm]) return 0;
    if (/\.view$/.test(perm) || perm === "dashboard.view") return 0;
    return 1;
  };

  C.requiredCap = function (perm) {
    perm = String(perm || "");
    if (/\.view$/.test(perm) || perm === "dashboard.view") return CAP.view;
    if (perm === "reports.financial") return CAP.finance;
    if (perm === "agreements.bill") return CAP.finance;
    if (perm === "agreements.edit") return CAP.sell;
    if (perm === "approvals.request") return CAP.work;
    const p = perm.split(".")[0];
    if (p === "tickets" || p === "time" || p === "expenses" || p === "appointments" || p === "timeoff") return CAP.work;
    if (p === "dispatch" || p === "schedule") return CAP.dispatch;
    if (p === "billing" || p === "payments" || p === "rates") return CAP.finance;
    if (p === "sales") return CAP.sell;
    if (p === "catalog" || p === "procurement" || p === "inventory") return CAP.buy;
    return CAP.manage;
  };

  C.permForAction = function (action) {
    const a = String(action || "");
    if (ACTION_PERM[a]) return ACTION_PERM[a];
    return a;
  };

  /* Deterministic board → bit index. Board codes are strings; the hub's board
     scope is a 128-bit field, so we hash the code to 0..127 with FNV-1a.
     Collisions are theoretically possible but negligible for the handful of
     boards a provider defines, and both sides use the same function. */
  C.boardBit = function (code) {
    let h = 2166136261;
    const s = String(code == null ? "" : code);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 128;
  };

  /* A quick, synchronous statement of what (systemRole, func, financials,
     scopes) may do — used by the panel, by tests, and as the fallback rule. */
  C.roleCan = function (spec, perm, ctx) {
    spec = spec || {};
    if (!C.permKnown(perm)) return false;
    const role = Number(spec.role) || 0;
    if (role < C.permSystemRole(perm)) return false;
    const func = spec.func == null ? 4 : spec.func;
    if (!C.hasCap(func, C.requiredCap(perm))) return false;
    ctx = ctx || {};
    const companies = spec.companies || [];
    if (ctx.companyId != null && companies.length && companies.map(Number).indexOf(Number(ctx.companyId)) === -1) return false;
    const boards = spec.boards || [];
    if (ctx.boardId != null && boards.length && boards.map(Number).indexOf(Number(ctx.boardId)) === -1) return false;
    if (PERM_FINANCIAL[perm] && !spec.financials) return false;
    return true;
  };

  /* ═══════════════════ identity & authority ═══════════════════ */

  function team() { return ERP.team; }

  C.active = function () {
    const T = team();
    return !!(T && typeof T.active === "function" && T.active());
  };

  C.serverActor = function () {
    const T = team();
    const m = T && T.me;
    if (!m) return null;
    return {
      userId: m.userId,
      displayName: m.displayName,
      role: Number(m.role) || 0,
      roleLabel: C.systemRoleLabel(m.role),
      func: m.func == null ? 4 : Number(m.func),
      funcId: C.funcId(m.func),
      financials: !!m.financials,
      companies: m.companies || [],
      boards: m.boards || [],
      caps: m.caps == null ? C.capsOf(m.func) : m.caps,
      admin: !!m.admin,
    };
  };

  /* True when the hub is online AND has identified us — the point at which
     the server's decision must override the local role selector. */
  C.authoritative = function () { return C.active() && !!C.serverActor(); };

  /* Returns true / false, or null when there is no server identity (in which
     case the caller falls back to the local model). */
  C.serverCan = function (perm, ctx) {
    const m = C.serverActor();
    if (!m) return null;
    return C.roleCan(m, perm, ctx);
  };

  /* A member-shaped view of the server identity so security.canViewCompany()
     and actorLabel() keep working unchanged. */
  C.serverMember = function () {
    const m = C.serverActor();
    if (!m) return null;
    return {
      id: m.userId,
      name: m.displayName,
      functionalRole: m.funcId,
      systemRole: m.roleLabel,
      scopes: { companies: (m.companies || []).map(String), financials: m.financials },
      server: true,
    };
  };

  /* ═══════════════════ change bus ═══════════════════ */

  const listeners = new Set();
  C.onChange = function (fn) { if (typeof fn === "function") listeners.add(fn); return () => listeners.delete(fn); };
  function emit(ev) { listeners.forEach((fn) => { try { fn(ev); } catch (e) {} }); }
  C.emit = emit;

  C.events = 0;
  C.lastChange = null;

  /* ═══════════════════ presence & editing ═══════════════════ */

  const focusTimers = {};
  let currentFocus = null;
  let keepAlive = null;

  C.peers = function () {
    const T = team();
    return (T && T.peersList) || [];
  };

  C.selfUserId = function () { const T = team(); return T && T.me ? T.me.userId : null; };

  C.editorsFor = function (kind, id) {
    const key = String(kind) + ":" + String(id);
    return C.peers().filter((p) => p.focus && String(p.focus.kind) + ":" + String(p.focus.id) === key);
  };

  C.editorsChip = function (kind, id) {
    return '<span class="erp-editor-chip" data-editor-chip="' + ERP.escapeHtml(kind) + ":" + ERP.escapeHtml(id) + '">' + editorsChipInner(kind, id) + "</span>";
  };

  function editorsChipInner(kind, id) {
    const eds = C.editorsFor(kind, id);
    if (!eds.length) return "";
    const names = eds.map((p) => p.displayName || p.userId).join(", ");
    const plural = eds.length > 1;
    return '<span class="erp-editor-chip-dot"></span>' + ERP.escapeHtml((plural ? "Editing now: " : "Editing now: ") + names);
  }

  C.refreshEditorChips = function (root) {
    const host = root || document;
    if (!host.querySelectorAll) return;
    host.querySelectorAll("[data-editor-chip]").forEach((el) => {
      const parts = String(el.getAttribute("data-editor-chip") || "").split(":");
      const inner = editorsChipInner(parts[0], parts.slice(1).join(":"));
      el.innerHTML = inner;
      el.hidden = !inner;
    });
  };

  /* Tell the hub (and therefore every teammate) that we're editing a record.
     Repeat calls for the same record are cheap no-ops. */
  C.noteEditing = function (kind, id) {
    if (!C.active()) { currentFocus = null; return; }
    const key = String(kind) + ":" + String(id);
    if (currentFocus === key) return;
    currentFocus = key;
    const T = team();
    if (T && T.focus) T.focus(kind, id, true).catch(() => {});
    clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      if (!currentFocus || !C.active()) { clearInterval(keepAlive); keepAlive = null; return; }
      const p = currentFocus.split(":");
      if (T && T.focus) T.focus(p[0], p.slice(1).join(":"), true).catch(() => {});
    }, 10000);
  };

  C.clearEditing = function () {
    clearInterval(keepAlive);
    keepAlive = null;
    if (!currentFocus) return;
    const parts = currentFocus.split(":");
    currentFocus = null;
    const T = team();
    if (C.active() && T && T.focus) T.focus(parts[0], parts.slice(1).join(":"), false).catch(() => {});
  };

  C.currentFocus = () => currentFocus;

  /* ═══════════════════ active-station refresh ═══════════════════ */

  C.autoRefresh = true;
  C.refreshCount = 0;
  C.lastRefresh = null;
  let refreshTimer = null;

  function modalOpen() {
    const m = document.getElementById("uiModal");
    return !!(m && m.classList.contains("open"));
  }

  /* Re-render the station the user is looking at — but never while a modal
     is open (that would discard an in-progress edit), and never more than
     once per debounce window. */
  C.refreshActive = function () {
    if (!C.autoRefresh) return false;
    const view = document.getElementById("view");
    if (!view) return false;
    if (modalOpen()) return false;
    const id = view.getAttribute("data-module");
    if (!id) return false;
    const mod = ERP.getModule(id);
    if (!mod || typeof mod.render !== "function") return false;
    C.refreshCount++;
    C.lastRefresh = Date.now();
    try {
      mod.render({ el: view, module: mod, navigate: ERP.navigate, toast: ERP.toast, empty() {}, error() {} });
    } catch (e) { /* a station re-render must never break the app */ }
    return true;
  };

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { C.refreshActive(); }, 700);
  }
  C.scheduleRefresh = scheduleRefresh;

  /* Called by the team client when a remote `chg` has been reconciled into
     the local store. */
  C.onDocSynced = function (name, res) {
    emit({ type: "synced", doc: name, res: res });
    if (res && res.state === "fast_forwarded") scheduleRefresh();
  };

  /* Called by the team client for every hub message. */
  C.onHubEvent = function (msg) {
    C.events++;
    if (msg && msg.t === "chg") C.lastChange = { doc: msg.d, by: msg.n || msg.u, ts: msg.ts };
    if (msg && (msg.t === "pres" || msg.t === "focus" || msg.t === "role")) {
      C.refreshEditorChips();
    }
    emit({ type: "hub", msg: msg });
    reRenderPanel();
  };

  C.onIdentity = function () {
    emit({ type: "identity", me: C.serverActor() });
    C.refreshEditorChips();
    reRenderPanel();
  };

  /* ═══════════════════ polling fallback (Task 60) ═══════════════════ */

  C.pollMs = 20000;
  C.maxPollDocs = 40;
  C.lastPoll = null;
  C._pollTimer = null;

  C.polling = function () { return !!C._pollTimer; };

  /* One poll pass. Online: refresh the peer/editor list. Offline: reconcile
     every cached document against canonical, so a session that can't reach
     the hub still converges with teammates over the document store. */
  C.pollOnce = async function () {
    if (!store) return { state: "no_store" };
    if (C.active()) {
      const T = team();
      try { if (T && T.peers) await T.peers(); } catch (e) {}
      C.lastPoll = { at: Date.now(), state: "online", docs: 0, changed: 0, conflicts: 0 };
      return { state: "online", changed: 0, conflicts: 0, docs: 0 };
    }
    let names = [];
    try { names = store.cachedDocNames ? store.cachedDocNames() : []; } catch (e) { names = []; }
    const limit = Math.min(names.length, C.maxPollDocs);
    let changed = 0, conflicts = 0;
    for (let i = 0; i < limit; i++) {
      let res;
      try { res = await store.syncDoc(names[i]); } catch (e) { continue; }
      if (res && res.state === "fast_forwarded") { changed++; C.onDocSynced(names[i], res); }
      else if (res && res.state === "conflict") conflicts++;
    }
    C.lastPoll = { at: Date.now(), state: "polled", docs: limit, changed: changed, conflicts: conflicts };
    return { state: "polled", changed: changed, conflicts: conflicts, docs: limit };
  };

  C.startPolling = function (ms) {
    if (ms) C.pollMs = ms;
    if (C._pollTimer) return;
    C._pollTimer = setInterval(() => { C.pollOnce().catch(() => {}); }, C.pollMs);
  };

  C.stopPolling = function () {
    clearInterval(C._pollTimer);
    C._pollTimer = null;
  };

  C.setPollMs = function (ms) { C.pollMs = Math.max(3000, Number(ms) || 20000); return C.pollMs; };

  /* ═══════════════════ admin panel (Admin → Collaboration) ═══════════════════ */

  function statusDot() {
    const T = team();
    const st = T ? T.status : "offline";
    const on = C.active();
    const cls = on ? "green" : st === "connecting" ? "amber" : "gray";
    const label = on ? "online" : st === "connecting" ? "connecting…" : "offline";
    return '<span class="erp-team-dot ' + cls + '"></span> <b>' + label + "</b>";
  }

  function scopeText(m) {
    const cs = m.companies || [], bs = m.boards || [];
    return (cs.length ? cs.length + " compan" + (cs.length === 1 ? "y" : "ies") : "All companies") +
      " · " + (bs.length ? bs.length + " board" + (bs.length === 1 ? "" : "s") : "All boards");
  }

  function identityCard() {
    const m = C.serverActor();
    if (!m) {
      return uiCard("Your hub identity", '<p class="erp-sub">This session isn\'t identified to the hub yet. While the hub is offline the local role selector and local record scopes apply, exactly as before Phase 13.</p>');
    }
    const caps = C.capList(m.func).map((c) => ui.badge(c, "info")).join(" ");
    return uiCard("Your hub identity", '<div class="erp-collab-id">' +
      '<div class="erp-collab-id-name">' + ERP.escapeHtml(m.displayName) + (m.admin ? " " + ui.badge("admin", "danger") : "") + "</div>" +
      '<div class="erp-sub"><code>' + ERP.escapeHtml(m.userId.slice(0, 8)) + "…</code></div></div>" +
      ui.summary([
        { label: "System role", value: ui.badge(m.roleLabel, m.role === 2 ? "danger" : m.role === 1 ? "warn" : "muted") },
        { label: "Functional role", value: ERP.escapeHtml(C.funcLabel(m.func)) },
        { label: "Financials", value: m.financials ? ui.badge("visible", "success") : ui.badge("hidden", "muted") },
        { label: "Scope", value: ERP.escapeHtml(scopeText(m)) },
      ]) +
      '<div class="erp-collab-caps"><span class="erp-sub">Capabilities</span><div>' + (caps || ui.badge("none", "muted")) + "</div></div>");
  }

  function peersCard() {
    const peers = C.peers();
    const rows = peers.map((p) => ({
      name: "<b>" + ERP.escapeHtml(p.displayName || p.userId) + "</b>" + (p.admin ? " " + ui.badge("admin", "danger") : ""),
      role: ui.badge(C.systemRoleLabel(p.role), p.role === 2 ? "danger" : p.role === 1 ? "warn" : "muted") + " " + ERP.escapeHtml(C.funcLabel(p.func)),
      editing: p.focus
        ? '<span class="erp-editor-chip"><span class="erp-editor-chip-dot"></span>' + ERP.escapeHtml(String(p.focus.kind) + " " + String(p.focus.id)) + "</span>"
        : '<span class="erp-sub">—</span>',
    }));
    return uiCard("Online now", uiTable([
      { key: "name", label: "Person" },
      { key: "role", label: "Role" },
      { key: "editing", label: "Editing" },
    ], rows, { emptyText: "No one else is connected right now." }), { actions: ui.badge(String(peers.length), "info") });
  }

  function changesCard() {
    const T = team();
    const idx = (T && T.hubIndex) || [];
    const rows = idx.slice(0, 10).map((c) => ({
      doc: logicalName(c.d),
      rev: "rev " + (c.r || 0),
      by: ERP.escapeHtml(c.n || c.u || "?"),
      when: ui.dateTime(new Date((c.ts || 0) * 1000).toISOString()),
    }));
    const poll = C.lastPoll
      ? "Last poll " + ui.dateTime(new Date(C.lastPoll.at).toISOString()) + " — " + (C.lastPoll.state === "online" ? "refreshed peers" : C.lastPoll.docs + " document(s), " + C.lastPoll.changed + " adopted, " + C.lastPoll.conflicts + " conflict(s)")
      : "No poll run yet.";
    return uiCard("Live change stream", uiTable([
      { key: "doc", label: "Document" },
      { key: "rev", label: "Version" },
      { key: "by", label: "By" },
      { key: "when", label: "When" },
    ], rows, { emptyText: "No live changes yet — teammate saves appear here." }) +
      '<p class="erp-sub">' + ERP.escapeHtml(poll) + " · Auto-refresh is " + (C.autoRefresh ? "on" : "off") + " (" + C.refreshCount + " applied).</p>");
  }

  function logicalName(name) {
    try { if (store && store.humanDocName) return ERP.escapeHtml(store.humanDocName(name)); } catch (e) {}
    return ERP.escapeHtml(name);
  }

  function usersCard(users) {
    const rows = users.map((u) => ({
      name: "<b>" + ERP.escapeHtml(u.displayName || u.userId) + "</b>" + (u.userId === C.selfUserId() ? ' <span class="erp-sub">you</span>' : ""),
      role: ui.badge(C.systemRoleLabel(u.role), u.role === 2 ? "danger" : u.role === 1 ? "warn" : "muted"),
      func: ERP.escapeHtml(C.funcLabel(u.func)),
      fin: u.financials ? ui.badge("visible", "success") : ui.badge("hidden", "muted"),
      scope: ERP.escapeHtml(scopeText(u)),
      online: u.online ? ui.badge("online", "info") : ui.badge("offline", "muted"),
      actions: ui.btn("Edit access", { small: true, act: "cl-edit", arg: u.userId }) +
        (u.userId === C.selfUserId() ? "" : " " + ui.btn("Remove", { small: true, danger: true, act: "cl-remove", arg: u.userId })),
    }));
    return uiCard("User registry", '<p class="erp-sub">Every guarded action is re-authorised on the hub against these values. The first user to ever connect was made owner/administrator.</p>' +
      uiTable([
        { key: "name", label: "Person" },
        { key: "role", label: "System" },
        { key: "func", label: "Function" },
        { key: "fin", label: "Financials" },
        { key: "scope", label: "Scope" },
        { key: "online", label: "Status" },
        { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No users registered yet." }), { actions: ui.btn("Refresh", { small: true, act: "cl-refresh" }) });
  }

  function auditCard(tail) {
    const rows = tail.map((a) => ({
      seq: a.seq,
      when: ui.dateTime(new Date((a.ts || 0) * 1000).toISOString()),
      role: ui.badge(C.systemRoleLabel(a.role), a.role === 2 ? "danger" : a.role === 1 ? "warn" : "muted") + " " + ERP.escapeHtml(C.funcLabel(a.func)),
      who: "<code>" + ERP.escapeHtml(String(a.user || "").slice(0, 8)) + "</code>",
      perm: "<code>" + ERP.escapeHtml(a.perm || a.action || "") + "</code>",
    }));
    return uiCard("Server audit ring", '<p class="erp-sub">The hub records the true server identity for every approved action (ring of the last ' + (C.maxAudit || 4096) + ").</p>" +
      uiTable([
        { key: "seq", label: "Seq" },
        { key: "when", label: "When" },
        { key: "role", label: "Actor" },
        { key: "who", label: "User" },
        { key: "perm", label: "Permission" },
      ], rows, { emptyText: "No server-signed actions yet." }), { actions: ui.btn("Refresh", { small: true, act: "cl-refresh" }) });
  }

  function rateCard(stats) {
    return uiCard("Connections & rate control", ui.summary([
      { label: "Connections", value: String(stats.connections) },
      { label: "Via proxy", value: String(stats.proxies) },
      { label: "Registered users", value: String(stats.users) },
      { label: "Audit ring", value: String(stats.maxAudit) },
    ]) + '<p class="erp-sub">Connections are rate-limited per connection and per coarse network signal (and tightened further when the connection arrives through a proxy).</p>');
  }

  function uiCard(title, body, opts) { return ERP.ui.card(title, body, opts); }
  function uiTable(cols, rows, opts) { return ERP.ui.table(cols, rows, opts); }

  let panelHost = null;
  let panelRefresh = null;
  let rerenderTimer = null;
  function reRenderPanel() {
    if (!panelHost || !panelHost.isConnected) return;
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => { if (panelRefresh) renderPanel(panelHost, panelRefresh); }, 250);
  }

  C.renderPanel = function (panel, refresh) {
    panelHost = panel;
    panelRefresh = refresh;
    return renderPanel(panel, refresh);
  };

  async function renderPanel(panel, refresh) {
    const T = team();
    const online = C.active();
    const m = C.serverActor();

    let users = [], tail = [], stats = null, companies = [], boards = [];
    const canManage = online && m && (m.admin || m.role === 2);
    if (canManage) {
      try { const u = await T.listUsers(); if (u && u.ok) users = u.users || []; } catch (e) {}
      try { const a = await T.auditTail(100); if (a && a.ok) tail = a.entries || []; } catch (e) {}
      try { const s = await T.rateStats(); if (s && s.ok) { stats = s; C.maxAudit = s.maxAudit; } } catch (e) {}
      try { companies = await ERP.companies.list(); } catch (e) {}
      try { boards = await ERP.tickets.boards(await ERP.tenancy.providerId()); } catch (e) {}
    }

    const statusBody =
      '<div class="erp-team-statusline">' + statusDot() + '</div>' +
      '<p class="erp-sub">' + (online
        ? "Server-authoritative mode: roles, capabilities, scopes and financial visibility are enforced on the hub, sensitive actions are signed into its audit ring, and teammate saves fan out within seconds."
        : "Hub unreachable — the app has degraded to polling: it reconciles the document store on a timer, and uses the local role selector and record scopes. Nothing is lost; the hub re-authorises everyone the moment it comes back.") + "</p>" +
      '<div class="erp-btn-row">' +
        (online ? ui.btn("Reconnect", { small: true, act: "cl-reconnect" }) : ui.btn("Connect", { small: true, primary: true, act: "cl-reconnect" })) +
        ui.btn(C.polling() ? "Stop polling" : "Start polling", { small: true, act: "cl-poll" }) +
        ui.btn(C.autoRefresh ? "Auto-refresh: on" : "Auto-refresh: off", { small: true, act: "cl-auto" }) +
        ui.btn("Poll now", { small: true, act: "cl-pollnow" }) +
      "</div>";

    panel.innerHTML =
      uiCard("Hub status", statusBody, { actions: ui.badge(online ? "online" : "offline", online ? "success" : "muted") }) +
      '<div class="erp-collab-grid">' + identityCard() + peersCard() + "</div>" +
      changesCard() +
      (canManage
        ? '<div class="erp-collab-grid">' + (stats ? rateCard(stats) : "") + "</div>" + usersCard(users) + auditCard(tail)
        : (online ? "" : uiCard("Access administration", '<p class="erp-sub">Connecting to the hub reveals the server user registry, the audit ring and connection rate control.</p>')));

    ERP.ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "cl-reconnect") { T.stop(); T.start(); setTimeout(() => renderPanel(panel, refresh), 500); return; }
      if (act === "cl-refresh") return renderPanel(panel, refresh);
      if (act === "cl-poll") { if (C.polling()) C.stopPolling(); else C.startPolling(); return renderPanel(panel, refresh); }
      if (act === "cl-auto") { C.autoRefresh = !C.autoRefresh; return renderPanel(panel, refresh); }
      if (act === "cl-pollnow") { await C.pollOnce(); ERP.toast("Poll complete.", "success"); return renderPanel(panel, refresh); }
      if (act === "cl-edit") return openAccessModal(String(arg), companies, boards, users, refresh);
      if (act === "cl-remove") {
        if (await ERP.ui.confirm({ title: "Remove user?", message: "The user is removed from the hub registry and disconnected. They can reconnect and will be re-registered as a technician.", danger: true, okLabel: "Remove" })) {
          const r = await T.removeUser(String(arg));
          ERP.toast(r && r.ok ? "User removed." : ("Could not remove user (" + ((r && r.err) || "unauthorized") + ")."), r && r.ok ? "success" : "error");
          renderPanel(panel, refresh);
        }
        return;
      }
    });
  }

  /* ═══════════════════ access editor modal (Task 59) ═══════════════════ */

  function openAccessModal(userId, companies, boards, users, refresh) {
    const u = (users || []).find((x) => x.userId === userId);
    if (!u) { ERP.toast("User not found.", "error"); return; }
    const selectedCompanies = (u.companies || []).map(Number);
    const boardBits = (u.boards || []).map(Number);

    const companyChecks = companies.length
      ? companies.map((c) => '<label><input type="checkbox" data-cl-company value="' + ERP.escapeHtml(c.id) + '"' + (selectedCompanies.indexOf(Number(c.id)) >= 0 ? " checked" : "") + "> " + ERP.escapeHtml(c.name) + "</label>").join("")
      : '<span class="erp-sub">No client companies defined.</span>';
    const boardChecks = boards.length
      ? boards.map((b) => { const bit = C.boardBit(b.code); return '<label><input type="checkbox" data-cl-board value="' + bit + '" data-code="' + ERP.escapeHtml(b.code) + '"' + (boardBits.indexOf(bit) >= 0 ? " checked" : "") + "> " + ERP.escapeHtml(b.label || b.code) + "</label>"; }).join("")
      : '<span class="erp-sub">No boards defined.</span>';

    const fields =
      '<div class="erp-defs"><dt>User</dt><dd>' + ERP.escapeHtml(u.displayName || u.userId) + ' <code>' + ERP.escapeHtml(String(u.userId).slice(0, 8)) + "…</code></dd></div>" +
      '<div class="erp-form-row">' +
        ERP.ui.select("systemRole", "System role (floor)", ERP.ROLES.map((r) => ({ value: r, label: ERP.ROLE_LABELS[r] })), C.systemRoleLabel(u.role)) +
        ERP.ui.select("func", "Functional role", FUNC_IDS.map((id) => ({ value: id, label: FUNC_LABELS[id] })), C.funcId(u.func)) +
      "</div>" +
      ERP.ui.check("financials", "May see financial figures", !!u.financials) +
      '<div class="field"><label>Company scope</label><div class="radio-group">' + companyChecks + '</div><div class="hint">Leave all unchecked for access to every client.</div></div>' +
      '<div class="field"><label>Board scope</label><div class="radio-group">' + boardChecks + '</div><div class="hint">Leave all unchecked for access to every board.</div></div>';

    const modal = ERP.ui.modal({
      title: "Access — " + (u.displayName || u.userId),
      size: "lg",
      body: ERP.ui.form(fields),
      foot: ERP.ui.btn("Cancel", { small: true, act: "cl-cancel" }) + " " + ERP.ui.btn("Save access", { small: true, primary: true, act: "cl-save" }),
    });
    const form = modal.querySelector("[data-ui-form]");
    modal.querySelector("[data-act=cl-cancel]").onclick = () => ERP.ui.closeModal();
    modal.querySelector("[data-act=cl-save]").onclick = async (btn) => {
      const v = ERP.ui.collect(form, ["systemRole", "func", "financials"]);
      btn.disabled = true;
      const T = team();
      const res = await T.setUser(userId, {
        role: C.systemRoleIndex(v.systemRole),
        func: C.funcIndex(v.func),
        financials: !!v.financials,
        companies: Array.from(form.querySelectorAll("[data-cl-company]:checked")).map((i) => Number(i.value)),
        boards: Array.from(form.querySelectorAll("[data-cl-board]:checked")).map((i) => Number(i.value)),
      });
      if (!res || !res.ok) { ERP.toast("Could not save access (" + ((res && res.err) || "unauthorized") + ").", "error"); btn.disabled = false; return; }
      ERP.ui.closeModal();
      ERP.toast("Access updated and enforced by the hub.", "success");
      if (refresh) refresh();
    };
  }

  /* ═══════════════════ boot ═══════════════════ */

  function boot() {
    C.startPolling();
    window.addEventListener("hashchange", () => C.clearEditing());
    window.addEventListener("beforeunload", () => C.clearEditing());
    if (ERP.ui && typeof ERP.ui.closeModal === "function" && !ERP.ui._collabPatched) {
      const orig = ERP.ui.closeModal.bind(ERP.ui);
      ERP.ui.closeModal = function () { C.clearEditing(); return orig(); };
      ERP.ui._collabPatched = true;
    }
    /* Subscribe to hub messages the instant the team client is up. */
    const T = team();
    if (T && T.setOnMessage && !T._collabWired) { T.setOnMessage(C.onHubEvent); T._collabWired = true; }
    C.ready = true;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* Exposed for the test-suite: the wire-level model the panel is built from. */
  C.schema = function () {
    return {
      funcIds: FUNC_IDS.slice(),
      funcCaps: FUNC_IDS.map((f) => FUNC_CAPS[f]),
      permFinancial: Object.keys(PERM_FINANCIAL),
      permOwnerOnly: Object.keys(PERM_OWNER_ONLY),
    };
  };
})();
