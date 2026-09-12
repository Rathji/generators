/* ============================================================
   PSA-U — roles, scopes & enforced permissions (Phase 1 · Task 4)
   Two layers of access control, both enforced in code (never by a
   hidden button):

     1. system role — owner / manager / staff. Server-authorised
        when the realtime hub is online (see the team hub client);
        the local "Acting as" selector is only a fallback.
     2. functional role + record scopes — carried on each member
        record: a functional role (administrator, dispatcher, account
        manager, finance, technician) plus scopes that restrict which
        client companies a member may see and whether they may see
        financial figures at all.

   Every controller asks this service before it mutates anything
   (`ERP.security.require(perm, ctx)`), and `canViewCompany()` gates
   individual records, so a restricted member cannot be shown or
   change a record outside their scope even by calling the
   controller directly.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const S = (ERP.security = {});

  const LS = { member: "psa.security.actorMember" };
  const readLS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const writeLS = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };

  /* functional roles a member record can carry */
  S.FUNCTIONAL_ROLES = [
    { id: "administrator", label: "Administrator", desc: "Full access to every module and every company." },
    { id: "dispatcher", label: "Dispatcher", desc: "Schedules work; sees every company's service queue." },
    { id: "account_manager", label: "Account manager", desc: "Owns client relationships and commercial detail." },
    { id: "finance", label: "Finance", desc: "Billing, invoicing and financial reporting." },
    { id: "technician", label: "Technician", desc: "Delivers service work; no financial visibility by default." },
  ];
  S.functionalRole = (id) => S.FUNCTIONAL_ROLES.find((r) => r.id === id) || S.FUNCTIONAL_ROLES[S.FUNCTIONAL_ROLES.length - 1];

  /* system-role permission matrix. `[]` means "every role". */
  S.PERMS = {
    "dashboard.view": [],
    "companies.view": [],
    "companies.edit": ["owner", "manager"],
    "companies.delete": ["owner"],
    "sites.edit": ["owner", "manager"],
    "contacts.edit": ["owner", "manager"],
    "members.view": [],
    "members.edit": ["owner"],
    "teams.edit": ["owner", "manager"],
    "calendars.edit": ["owner", "manager"],
    "taxonomy.view": [],
    "taxonomy.edit": ["owner"],
    "financials.view": ["owner", "manager"],
    "data.view": ["owner", "manager"],
    "data.manage": ["owner"],
    "sync.manage": ["owner", "manager"],
    "backup.manage": ["owner"],
    "portal.view": [],
    "security.view": ["owner", "manager"],
    "security.edit": ["owner"],
    "tickets.view": [],
    "tickets.edit": ["owner", "manager", "staff"],
    "tickets.delete": ["owner", "manager"],
    "tickets.merge": ["owner", "manager"],
    "boards.edit": ["owner", "manager"],
    "routing.edit": ["owner", "manager"],
    "sla.view": [],
    "sla.edit": ["owner", "manager"],
    "templates.view": [],
    "templates.edit": ["owner", "manager"],
    "workflow.view": ["owner", "manager"],
    "workflow.edit": ["owner", "manager"],
    "notifications.view": ["owner", "manager"],
    "notifications.edit": ["owner", "manager"],
    "dispatch.view": [],
    "dispatch.edit": ["owner", "manager"],
    "appointments.view": [],
    "appointments.edit": ["owner", "manager", "staff"],
    "schedule.view": [],
    "schedule.edit": ["owner", "manager"],
    "timeoff.view": [],
    "timeoff.edit": ["owner", "manager", "staff"],
    "time.view": [],
    "time.edit": ["owner", "manager", "staff"],
    "time.delete": ["owner", "manager"],
    "time.approve": ["owner", "manager"],
    "expenses.view": [],
    "expenses.edit": ["owner", "manager", "staff"],
    "expenses.approve": ["owner", "manager"],
    "rates.view": ["owner", "manager"],
    "rates.edit": ["owner"],
    "agreements.view": [],
    "agreements.edit": ["owner", "manager"],
    "agreements.bill": ["owner", "manager"],
    "agreements.terminate": ["owner", "manager"],
    "billing.view": [],
    "billing.edit": ["owner", "manager"],
    "billing.post": ["owner", "manager"],
    "payments.view": [],
    "payments.edit": ["owner", "manager"],
    "payments.void": ["owner", "manager"],
    "projects.view": [],
    "projects.edit": ["owner", "manager"],
    "projects.bill": ["owner", "manager"],
    "sales.view": [],
    "sales.edit": ["owner", "manager"],
    "sales.activity": ["owner", "manager", "staff"],
    "sales.convert": ["owner", "manager"],
    "catalog.view": [],
    "catalog.edit": ["owner", "manager"],
    "catalog.margins": ["owner"],
    "procurement.view": [],
    "procurement.edit": ["owner", "manager"],
    "procurement.approve": ["owner", "manager"],
    "procurement.receive": ["owner", "manager", "staff"],
    "inventory.view": [],
    "inventory.edit": ["owner", "manager"],
    "inventory.adjust": ["owner", "manager"],
    "kb.view": [],
    "kb.edit": ["owner", "manager"],
    "configuration.view": [],
    "configuration.edit": ["owner", "manager"],
    "rmm.view": [],
    "rmm.edit": ["owner", "manager"],
    "approvals.view": [],
    "approvals.request": ["owner", "manager", "staff"],
    "approvals.decide": ["owner", "manager"],
    "approvals.manage": ["owner", "manager"],
    "portal.manage": ["owner", "manager"],
    "reports.view": [],
    "reports.build": ["owner", "manager"],
    "reports.schedule": ["owner", "manager"],
    "reports.export": ["owner", "manager"],
    "reports.financial": ["owner", "manager"],
    "integrations.view": [],
    "integrations.edit": ["owner", "manager"],
    "integrations.run": ["owner", "manager"],
    "api.view": [],
    "api.manage": ["owner", "manager"],
    "integrity.view": [],
  };

  S.PERM_LABELS = {
    "companies.view": "View clients",
    "companies.edit": "Add & edit clients",
    "companies.delete": "Delete clients",
    "members.edit": "Manage members",
    "taxonomy.edit": "Edit system configuration",
    "financials.view": "View financial figures",
    "data.manage": "Manage data & backups",
    "security.edit": "Manage roles & scopes",
    "tickets.view": "View tickets",
    "tickets.edit": "Add & edit tickets",
    "tickets.delete": "Delete tickets",
    "tickets.merge": "Merge tickets",
    "boards.edit": "Configure service boards",
    "routing.edit": "Configure inbound routing",
    "sla.view": "View SLAs",
    "sla.edit": "Edit SLA policies & calendars",
    "templates.view": "View ticket templates",
    "templates.edit": "Edit ticket templates & recurring tickets",
    "workflow.view": "View automation rules",
    "workflow.edit": "Edit automation rules",
    "notifications.view": "View notification settings",
    "notifications.edit": "Edit notification rules & preferences",
    "dispatch.view": "View the dispatch board",
    "dispatch.edit": "Schedule & dispatch work",
    "appointments.view": "View appointments",
    "appointments.edit": "Book & complete appointments",
    "schedule.edit": "Edit working hours & skills",
    "timeoff.edit": "Manage time off",
    "time.view": "View time & expenses",
    "time.edit": "Capture & edit time entries",
    "time.delete": "Delete time entries",
    "time.approve": "Approve timesheets & write-offs",
    "expenses.view": "View expenses",
    "expenses.edit": "Capture & edit expenses",
    "expenses.approve": "Approve & reimburse expenses",
    "rates.view": "View billing-rate rules",
    "rates.edit": "Edit billing-rate rules",
    "agreements.view": "View agreements & coverage",
    "agreements.edit": "Add & edit agreements",
    "agreements.bill": "Run agreement billing",
    "agreements.terminate": "Terminate agreements",
    "billing.view": "View invoices",
    "billing.edit": "Create & edit invoices",
    "billing.post": "Post or void invoices",
    "payments.view": "View payments & credits",
    "payments.edit": "Record payments & credits",
    "payments.void": "Void payments & credits",
    "projects.view": "View projects",
    "projects.edit": "Add & edit projects",
    "projects.bill": "Release & bill project milestones",
    "sales.view": "View the sales pipeline",
    "sales.edit": "Add & edit opportunities, quotes & leads",
    "sales.activity": "Log sales activities",
    "sales.convert": "Convert quotes & leads",
    "catalog.view": "View the product & service catalog",
    "catalog.edit": "Add & edit catalog items & prices",
    "catalog.margins": "Edit margin floors & record overrides",
    "procurement.view": "View purchase orders & vendors",
    "procurement.edit": "Raise & edit purchase orders",
    "procurement.approve": "Approve purchase orders",
    "procurement.receive": "Receive goods",
    "inventory.view": "View inventory",
    "inventory.edit": "Manage warehouses & transfer stock",
    "inventory.adjust": "Adjust & write off stock",
    "kb.view": "View the knowledge base",
    "kb.edit": "Author & publish articles",
    "configuration.view": "View configuration records",
    "configuration.edit": "Add & edit configuration records",
    "rmm.view": "View monitoring alerts",
    "rmm.edit": "Ingest alerts & manage monitoring rules",
    "approvals.view": "View approval requests",
    "approvals.request": "Raise approval requests",
    "approvals.decide": "Approve or reject requests",
    "approvals.manage": "Configure approval workflows",
    "portal.manage": "Sign in to the client portal",
    "reports.view": "View dashboards & reports",
    "reports.build": "Build & save reports",
    "reports.schedule": "Schedule report delivery",
    "reports.export": "Export data & publish to BI",
    "reports.financial": "View financial reports",
    "integrations.view": "View integrations",
    "integrations.edit": "Configure connectors",
    "integrations.run": "Run connector syncs",
    "api.view": "View the API & webhooks",
    "api.manage": "Manage API access & webhooks",
    "integrity.view": "View the data-integrity report",
  };

  /* ─────────────────────────── actor ─────────────────────────── */

  let membersCache = null;

  async function loadMembers(force) {
    if (membersCache && !force) return membersCache;
    if (ERP.members && typeof ERP.members.members === "function") {
      membersCache = await ERP.members.members();
    } else if (ERP.members && typeof ERP.members.list === "function") {
      membersCache = await ERP.members.list("member");
    } else {
      membersCache = [];
    }
    return membersCache;
  }
  S.refresh = async function (force) { membersCache = null; return loadMembers(force); };

  S.actorMemberId = () => readLS(LS.member);
  S.setActorMember = function (id) {
    writeLS(LS.member, id == null ? null : String(id));
    S.notify();
  };

  S.actor = function () {
    /* While the hub is online its identity is authoritative: the server role,
       functional role, financial flag and record scopes win over the local
       "acting as" selector. */
    if (ERP.collab && ERP.collab.authoritative && ERP.collab.authoritative()) {
      const sm = ERP.collab.serverMember();
      const sa = ERP.collab.serverActor();
      if (sm && sa) return { role: sa.roleLabel, memberId: sa.userId, member: sm, server: true };
    }
    const id = S.actorMemberId();
    const member = id && membersCache ? membersCache.find((m) => String(m.id) === String(id)) || null : null;
    return { role: ERP.role || "staff", memberId: id || null, member };
  };

  S.actorLabel = function () {
    if (ERP.collab && ERP.collab.authoritative && ERP.collab.authoritative()) {
      const sa = ERP.collab.serverActor();
      if (sa) return sa.displayName;
    }
    const a = S.actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || a.role;
  };

  /* ─────────────────────────── decisions ─────────────────────────── */

  S.can = function (perm, ctx) {
    ctx = ctx || {};
    /* Server-authoritative decision first: the hub's capability + scope +
       financial model is the boundary, so the UI agrees with it. */
    if (ERP.collab && ERP.collab.authoritative && ERP.collab.authoritative()) {
      const server = ERP.collab.serverCan(perm, ctx);
      if (server !== null) return server;
    }
    const a = S.actor();
    const allowed = S.PERMS[perm];
    if (allowed === undefined) return false;             // unknown permission → fail closed
    if (allowed.length && allowed.indexOf(a.role) === -1) return false;

    const scopes = (a.member && a.member.scopes) || null;
    if (scopes) {
      if (perm === "financials.view" && scopes.financials === false) return false;
      if (ctx.companyId != null && !scopeAllowsCompany(scopes, ctx.companyId)) return false;
      if (ctx.boardId != null && Array.isArray(scopes.boards) && scopes.boards.length && scopes.boards.indexOf(String(ctx.boardId)) === -1) return false;
    }
    return true;
  };

  S.require = function (perm, ctx) {
    if (S.can(perm, ctx)) return { ok: true };
    const a = S.actor();
    return {
      ok: false,
      perm,
      message:
        "The " + (S.actorLabel()) + " role isn't allowed to " +
        (S.PERM_LABELS[perm] || perm) + ".",
      role: a.role,
    };
  };

  /* Enforcement helper: returns true when allowed; otherwise reports the
     denial (toast + optional error state) and returns false. */
  S.enforce = function (perm, ctx, onDeny) {
    const r = S.require(perm, ctx);
    if (r.ok) return true;
    if (typeof onDeny === "function") onDeny(r.message, r);
    else ERP.toast(r.message, "error");
    return false;
  };

  function scopeAllowsCompany(scopes, companyId) {
    if (!scopes || !Array.isArray(scopes.companies) || !scopes.companies.length) return true;
    return scopes.companies.map(String).indexOf(String(companyId)) !== -1;
  }
  S.scopeAllowsCompany = scopeAllowsCompany;

  S.canViewCompany = function (companyId) {
    if (companyId == null) return true;
    if (!S.can("companies.view", { companyId })) return false;
    const a = S.actor();
    return scopeAllowsCompany(a.member && a.member.scopes, companyId);
  };

  S.visibleCompanies = function (list) {
    return (list || []).filter((c) => S.canViewCompany(c.id));
  };

  S.canSeeFinancials = function () {
    return S.can("financials.view");
  };

  /* Hide financial figures from roles without financial visibility. The
     figure still exists in the data — this only masks it at render time. */
  S.money = function (value, cur) {
    if (!S.canSeeFinancials()) return "•••";
    return ERP.ui ? ERP.ui.money(value, cur) : String(value);
  };

  S.scopeSummary = function (member) {
    const scopes = (member && member.scopes) || {};
    const companies = Array.isArray(scopes.companies) ? scopes.companies : [];
    const financials = scopes.financials !== false;
    return {
      companies: companies.length ? companies.length + " selected" : "All clients",
      financials,
    };
  };

  /* ─────────────────────────── notification ─────────────────────────── */

  const listeners = new Set();
  S.subscribe = function (fn) { if (typeof fn === "function") listeners.add(fn); return () => listeners.delete(fn); };
  S.notify = function () { listeners.forEach((fn) => { try { fn(); } catch (e) {} }); };

  /* keep the member cache fresh when a member is added/edited */
  S.invalidateMembers = () => { membersCache = null; };

  async function boot() {
    try { await S.refresh(true); } catch (e) {}
    if (ERP.tenancy && ERP.tenancy.subscribe) ERP.tenancy.subscribe(() => { membersCache = null; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
