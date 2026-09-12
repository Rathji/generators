// ============================================================================
// quote-u — internal role & access model (roadmap task 68)
// ----------------------------------------------------------------------------
// Phase 12 replaces the flat `quoteAccessScope` account list with a proper
// internal identity model. Two dimensions are kept deliberately separate:
//
//   ROLE   — what a person is allowed to DO (create, price, discount, send,
//            revoke, invoice, administer). The role model is owner / manager /
//            viewer; the hub (src/hub.js) authenticates a person to one of
//            these, and the authoritative server derives it from the connection
//            rather than trusting the client.
//   SCOPE  — WHICH accounts a person can see (the IDOR guard), still the
//            `quoteAccessScope` sentinel list, now per-member.
//
// The client portal is a SEPARATE, tokenized regime: a portal visitor holds a
// token, never an internal role, and `can()` refuses every internal action for a
// portal-regime identity (and `canPortal()` refuses a token for an internal
// action). There is no path by which approving through a link grants internal
// authority.
//
// Enforcement is fail-closed and layered:
//   1. `can()` / `assert()` gate the action UI and direct calls;
//   2. `registerGuards(store)` installs storage-layer guards, so a write that
//      bypasses the UI is still refused (a viewer cannot mutate anything, a
//      manager cannot discount below the floor, a non-sender cannot send);
//   3. `wrapGateway()` injects the AUTHENTICATED role + scope into every
//      outbound connector call, so the gateway's own role allowlist enforces
//      external writes (price reads, mail, invoicing) against the real identity;
//   4. the hub server refuses and audits any write reported by a role that may
//      not perform it.
//
// Policy lives in `main.pjs` as `quoteRolePolicy`; the accounts a member may
// see still come from `quoteAccessScope`.
// ============================================================================
window.QU_ROLES = (function () {
  "use strict";

  const VERSION = "1.0.0";

  // The internal roles. `owner` is the administrative role (one is created when
  // the hub is first set up); `manager` runs the day-to-day; `viewer` is
  // read-only. A few common synonyms are accepted and normalized.
  const ROLES = Object.freeze(["owner", "manager", "viewer"]);
  const ROLE_LABELS = Object.freeze({ owner: "Owner", manager: "Manager", viewer: "Viewer" });
  const ROLE_ALIASES = Object.freeze({ admin: "owner", administrator: "owner", user: "viewer", member: "viewer", read_only: "viewer", readonly: "viewer" });

  // The separate portal regime. Its actions are token-scoped and never internal.
  const PORTAL_REGIME = "portal";
  const INTERNAL_REGIME = "internal";
  const PORTAL_ACTIONS = Object.freeze(["view", "toggle_options", "approve", "decline"]);

  // Every action a person can attempt. The matrix below is the single source of
  // truth; the gateway role assignments in `quoteGatewayPolicy` mirror it for
  // external connectors.
  const ACTIONS = Object.freeze([
    "view",
    "create_quote",
    "edit_draft",
    "price",
    "discount",
    "send",
    "revoke",
    "approve_internal",
    "invoice",
    "manage_members",
    "manage_policy"
  ]);
  const ACTION_LABELS = Object.freeze({
    view: "View quotes",
    create_quote: "Create quotes",
    edit_draft: "Edit draft versions",
    price: "Set prices from sources",
    discount: "Discount below the floor",
    send: "Send to the client",
    revoke: "Revoke portal links",
    approve_internal: "Mark internal review",
    invoice: "Raise invoices",
    manage_members: "Manage the team",
    manage_policy: "Change policy & flags"
  });

  // role → allowed actions. Owner is a superset of manager; viewer only reads.
  const MATRIX = Object.freeze({
    owner: ACTIONS.slice(),
    manager: Object.freeze([
      "view", "create_quote", "edit_draft", "price", "send", "revoke", "approve_internal", "invoice"
    ]),
    viewer: Object.freeze(["view"])
  });

  // Which role a module write requires. A module not listed needs `edit_draft`;
  // the system documents (audit, outbox, bus) are ordinary writer actions, never
  // viewer actions.
  const MODULE_ACTION = Object.freeze({
    quotes: "edit_draft",
    quote_versions: "edit_draft",
    line_items: "edit_draft",
    option_groups: "edit_draft",
    price_snapshots: "price",
    catalog_items: "edit_draft",
    portal_tokens: "edit_draft",
    quote_events: "edit_draft",
    approvals: "edit_draft",
    invoice_intents: "invoice",
    invoice_mappings: "manage_policy",
    feature_flags: "manage_policy",
    outbox_jobs: "edit_draft",
    quote_artifacts: "edit_draft",
    esignature: "manage_policy",
    legacy_migrations: "edit_draft",
    write_policy: "manage_policy",
    gated_writes: "manage_policy",
    mail_permission: "manage_policy",
    bus_events: "edit_draft",
    verification_gates: "manage_policy",
    ops_log: "edit_draft"
  });

  class RoleError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "RoleError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new RoleError(code, message, meta); }

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }

  function normalizeRole(role) {
    const key = String(role == null ? "" : role).trim().toLowerCase();
    if (ROLES.indexOf(key) !== -1) return key;
    if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
    return null;
  }

  function roleLabel(role) { return ROLE_LABELS[normalizeRole(role)] || String(role == null ? "" : role); }

  function isRole(role) { return normalizeRole(role) !== null; }

  // The pure permission check. An unknown role is denied (fail closed); a portal
  // identity is denied every internal action regardless of any claimed role.
  function can(role, action, ctx) {
    const identity = isPlainObject(role) ? role : { role: role };
    if (identity && identity.regime === PORTAL_REGIME) return false;
    const r = normalizeRole(identity && identity.role);
    if (!r) return false;
    const list = MATRIX[r];
    return !!list && list.indexOf(String(action)) !== -1;
  }

  function assert(role, action, ctx) {
    if (can(role, action, ctx)) return true;
    const id = isPlainObject(role) ? role : { role: role };
    fail("forbidden", `The ${roleLabel(id && id.role) || "unknown"} role may not ${String(action).replace(/_/g, " ")}.`, { action: action, role: id && id.role });
  }

  function capabilities(role) {
    const r = normalizeRole(isPlainObject(role) ? role.role : role);
    if (!r) return [];
    return MATRIX[r].slice();
  }

  // A portal token may only do portal things, and never an internal action.
  function canPortal(action) { return PORTAL_ACTIONS.indexOf(String(action)) !== -1; }

  // Managers may discount down to the floor; owners may discount anywhere. The
  // floor is basis points of margin (sell vs cost): 1500 = 15%.
  function canDiscount(role, marginBp, floorBp) {
    const r = normalizeRole(role);
    if (!r) return false;
    if (r === "owner") return true;
    if (r !== "manager") return false;
    const floor = Number(floorBp) || 0;
    if (floor <= 0) return true;
    const m = Number(marginBp);
    if (!isFinite(m)) return false;
    return m >= floor;
  }

  function normalizeScopeValue(scope, globalScope) {
    const src = scope === undefined || scope === null ? globalScope : scope;
    if (src === undefined || src === null) return ["*"];
    if (src === "*") return ["*"];
    if (Array.isArray(src)) {
      if (src.length === 1 && src[0] === "*") return ["*"];
      const out = src.map(String);
      return out.length ? out : ["*"];
    }
    return [String(src)];
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    const members = [];
    if (Array.isArray(p.members)) {
      p.members.forEach(m => {
        if (!isPlainObject(m)) return;
        const name = String(m.name == null ? "" : m.name).trim();
        if (!name) return;
        const role = normalizeRole(m.role) || "viewer";
        members.push({ name: name, role: role, scope: m.scope === undefined ? null : normalizeScopeValue(m.scope, null) });
      });
    }
    const defaultRole = normalizeRole(p.default_role) || "owner";
    const floorRaw = p.discount_floor_bp === undefined || p.discount_floor_bp === null ? 0 : Number(p.discount_floor_bp);
    return {
      default_role: defaultRole,
      discount_floor_bp: isFinite(floorRaw) && floorRaw > 0 ? Math.floor(floorRaw) : 0,
      members: members,
      portal_regime: PORTAL_REGIME
    };
  }

  // Resolve an identity against the policy: its role is normalized and its scope
  // falls back to the global `quoteAccessScope`. A member listed in the policy
  // may pin its role and scope (a hub-authenticated name is matched here too).
  function resolveIdentity(policy, input, globalScope) {
    const pol = normalizePolicy(policy);
    const src = isPlainObject(input) ? input : {};
    const name = String(src.name == null ? "" : src.name).trim() || "admin";
    const member = pol.members.find(m => m.name.toLowerCase() === name.toLowerCase());
    let role = normalizeRole(src.role);
    if (!role && member) role = member.role;
    if (!role) role = pol.default_role;
    let scope = src.scope;
    if (scope === undefined && member) scope = member.scope;
    return {
      name: name,
      role: role,
      scope: normalizeScopeValue(scope, globalScope),
      regime: src.regime === PORTAL_REGIME ? PORTAL_REGIME : INTERNAL_REGIME,
      source: src.source === "hub" ? "hub" : (src.source === "portal" ? "portal" : "local")
    };
  }

  function scopeAllows(scope, companyId) {
    const s = normalizeScopeValue(scope, null);
    if (s.indexOf("*") !== -1) return true;
    if (companyId === undefined || companyId === null) return true;
    return s.indexOf(String(companyId)) !== -1;
  }

  // ---- the pure write verdict -------------------------------------------------
  // Shared by the service's store guard and directly testable on its own. `caps`
  // describes the acting identity for one write: { regime, role, write,
  // canCreate, canSend, canRevoke, discountFloorBp, canDiscount }.
  // Returns null to allow, or a refusal { ok:false, code, detail }.
  const SENT_STATES = Object.freeze(["sent", "viewed", "approved", "declined", "expired"]);

  function indexRecords(content) {
    const out = {};
    const recs = content && Array.isArray(content.records) ? content.records : [];
    for (const r of recs) { if (r && r.id !== undefined && r.id !== null) out[String(r.id)] = r; }
    return out;
  }

  // The fields that decide whether a line's price is what the discount floor
  // governs. A write that changes only descriptive fields (a typo in a
  // description, a section move) does not re-price a line, so it can neither
  // introduce a discount nor be unfairly blocked by a legacy below-floor line
  // that it never touched.
  function pricingSignature(li) {
    return [li.unit_sell_cents, li.unit_cost_cents, li.quantity, li.currency].join("|");
  }

  function writeVerdict(caps, module, content, previous) {
    caps = caps || {};
    const next = content && typeof content === "object" ? content : {};
    if (caps.regime === PORTAL_REGIME) {
      return { ok: false, code: "portal_regime", detail: "A portal token may not write internal documents." };
    }
    if (!caps.write) {
      return { ok: false, code: "forbidden", detail: `The ${roleLabel(caps.role)} role may not write the ${module} document.` };
    }
    if (module === "quotes") {
      const prevN = previous && Array.isArray(previous.records) ? previous.records.length : 0;
      const nextN = Array.isArray(next.records) ? next.records.length : 0;
      if (prevN === 0 && nextN > 0 && !caps.canCreate) {
        return { ok: false, code: "forbidden", detail: `The ${roleLabel(caps.role)} role may not create quotes.` };
      }
    }
    if (module === "quote_versions") {
      const prevById = indexRecords(previous);
      const nextRecs = Array.isArray(next.records) ? next.records : [];
      for (const v of nextRecs) {
        if (!v || v.id === undefined) continue;
        const prev = prevById[String(v.id)];
        const wasSent = prev && SENT_STATES.indexOf(prev.state) !== -1;
        const isSent = SENT_STATES.indexOf(v.state) !== -1;
        if (!wasSent && isSent && !caps.canSend) {
          return { ok: false, code: "forbidden", detail: `The ${roleLabel(caps.role)} role may not send a quote to the client.` };
        }
      }
    }
    if (module === "portal_tokens") {
      const prevById = indexRecords(previous);
      const nextRecs = Array.isArray(next.records) ? next.records : [];
      for (const t of nextRecs) {
        if (!t || t.id === undefined) continue;
        const prev = prevById[String(t.id)];
        const wasRevoked = !!(prev && prev.revoked_at);
        if (!wasRevoked && t.revoked_at && !caps.canRevoke) {
          return { ok: false, code: "forbidden", detail: `The ${roleLabel(caps.role)} role may not revoke portal links.` };
        }
      }
    }
    if (module === "line_items" && Number(caps.discountFloorBp) > 0 && caps.role !== "owner") {
      const prevById = indexRecords(previous);
      const nextRecs = Array.isArray(next.records) ? next.records : [];
      const M = (typeof window !== "undefined" && window.QU_MONEY) || null;
      for (const li of nextRecs) {
        if (!li || li.kind === "note" || li.kind === "heading") continue;
        const id = li.id === undefined || li.id === null ? null : String(li.id);
        const prev = id === null ? undefined : prevById[id];
        // Only a line whose PRICE changed (or a brand new line) is subject to the
        // floor; an untouched legacy line must not block an unrelated edit.
        if (prev !== undefined && pricingSignature(prev) === pricingSignature(li)) continue;
        const qty = Number(li.quantity) || 0;
        const cost = Number(li.unit_cost_cents);
        const sell = Number(li.unit_sell_cents);
        if (!isFinite(cost) || !isFinite(sell) || cost <= 0 || qty <= 0) continue;
        let margin;
        if (M && typeof M.marginBp === "function") {
          try { margin = M.marginBp(sell, cost); } catch (e) { margin = null; }
        } else {
          margin = sell !== 0 ? Math.round(((sell - cost) / sell) * 10000) : null;
        }
        if (margin === null || !isFinite(margin)) margin = -10000;
        const allowed = typeof caps.canDiscount === "function" ? caps.canDiscount(margin) : true;
        if (!allowed) {
          return { ok: false, code: "discount_floor", detail: `"${li.description || li.id}" prices at ${(margin / 100).toFixed(1)}% margin, below the ${(Number(caps.discountFloorBp) / 100).toFixed(1)}% floor — that discount needs an owner.` };
        }
      }
    }
    return null;
  }

  // ---- the live service -----------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    let policy = normalizePolicy(opts.policy);
    const globalScope = opts.scope === undefined ? "*" : opts.scope;
    let identity = resolveIdentity(policy, opts.identity || null, globalScope);
    const listeners = [];
    let unregisterGuards = [];

    function current() { return Object.assign({}, identity); }
    function currentRole() { return identity.role; }
    function currentScope() { return normalizeScopeValue(identity.scope, globalScope); }
    function regime() { return identity.regime; }

    function notify() { listeners.slice().forEach(fn => { try { fn(current()); } catch (e) {} }); }

    function setIdentity(next) {
      identity = resolveIdentity(policy, next, globalScope);
      notify();
      return current();
    }

    // Drop back to a NON-hub identity. When the hub is enabled but unauthenticated
    // (a sign-out, or a dropped connection), the fallback is the LEAST privileged
    // role — never the policy default, which is normally an owner. A client that
    // signs out of a live hub must not be quietly promoted to owner. Genuinely
    // local-only use (no hub configured) still gets the policy default.
    function clearIdentity(opts) {
      opts = opts || {};
      const fallback = opts.hubConfigured ? "viewer" : policy.default_role;
      const role = normalizeRole(opts.role) || normalizeRole(fallback) || "viewer";
      identity = resolveIdentity(policy, { name: "admin", role: role, source: "local" }, globalScope);
      notify();
      return current();
    }

    function setPolicy(next) {
      policy = normalizePolicy(next);
      identity = resolveIdentity(policy, identity, globalScope);
      return policySnapshot();
    }

    function policySnapshot() { return JSON.parse(JSON.stringify(policy)); }
    function members() { return policySnapshot().members; }
    function defaultRole() { return policy.default_role; }
    function discountFloor() { return policy.discount_floor_bp; }

    function canAction(action) { return can(identity, action); }
    function assertAction(action) { return assert(identity, action); }

    function scope() { return currentScope(); }
    function allows(companyId) { return scopeAllows(identity.scope, companyId); }

    // The module write decision used by the store guard.
    function moduleAction(module) { return MODULE_ACTION[module] || "edit_draft"; }
    function canWrite(module) {
      if (identity.regime === PORTAL_REGIME) return false;
      if (module === "feature_flags" && identity.role === "owner") return true;
      return canAction(moduleAction(module));
    }

    function assertWrite(module) {
      if (canWrite(module)) return true;
      fail("forbidden", `The ${roleLabel(identity.role)} role may not write the ${module} document.`, { module: module });
    }

    // ---- storage-layer guards ----------------------------------------------
    // Installed on the versioned document store so a write that bypasses the UI
    // is still refused. `previous` is the canonical content (or null) the write
    // was based on, which lets the guard see a transition (draft → sent).
    //
    // The decision itself is the pure `writeVerdict` below, driven by a small
    // capabilities object — so the same rule is directly testable and the layer
    // that enforces it (roles.can, the store guard, the gateway allowlist, the
    // hub server) all agree on one matrix.
    function guard(module, content, previous) {
      const caps = {
        regime: identity.regime,
        role: identity.role,
        write: canWrite(module),
        canCreate: canAction("create_quote"),
        canSend: canAction("send"),
        canRevoke: canAction("revoke"),
        discountFloorBp: policy.discount_floor_bp,
        canDiscount: (marginBp) => canDiscount(identity.role, marginBp, policy.discount_floor_bp)
      };
      return writeVerdict(caps, module, content, previous);
    }

    function registerGuards(target) {
      unregisterGuards.forEach(fn => fn());
      unregisterGuards = [];
      const s = target || store;
      if (!s || typeof s.registerGuard !== "function") return function () {};
      const un = s.registerGuard((module, content, previous) => guard(module, content, previous));
      unregisterGuards.push(un);
      return un;
    }

    // ---- gateway boundary ----------------------------------------------------
    // Inject the authenticated role + scope into every connector call. The
    // gateway's own role allowlist (quoteGatewayPolicy) then enforces reads vs
    // writes for the REAL identity; a client cannot pass its own role.
    function wrapGateway(gateway) {
      if (!gateway) return gateway;
      function inject(ctx) {
        return Object.assign({}, ctx || {}, { role: identity.role, scope: currentScope() });
      }
      const wrapped = {
        connectors: gateway.connectors,
        has: name => gateway.has(name),
        list: () => gateway.list(),
        allowedFunctions: name => gateway.allowedFunctions(name),
        callLog: () => gateway.callLog(),
        clearLog: () => gateway.clearLog(),
        blockedLog: () => (typeof gateway.blockedLog === "function" ? gateway.blockedLog() : []),
        clearBlockedLog: () => (typeof gateway.clearBlockedLog === "function" ? gateway.clearBlockedLog() : null),
        effectOf: (name, fn) => (typeof gateway.effectOf === "function" ? gateway.effectOf(name, fn) : null),
        manifest: () => (typeof gateway.manifest === "function" ? gateway.manifest() : []),
        isEnabled: name => gateway.isEnabled(name),
        setEnabled: (name, on) => gateway.setEnabled(name, on),
        enable: name => gateway.enable(name),
        disable: name => gateway.disable(name),
        roles: () => gateway.roles(),
        assignRole: (role, cfg) => gateway.assignRole(role, cfg),
        defaultRole: () => gateway.defaultRole(),
        setKeystore: k => (typeof gateway.setKeystore === "function" ? gateway.setKeystore(k) : null),
        keyName: name => (typeof gateway.keyName === "function" ? gateway.keyName(name) : null),
        setLogSink: fn => (typeof gateway.setLogSink === "function" ? gateway.setLogSink(fn) : null),
        verify: () => (typeof gateway.verify === "function" ? gateway.verify() : { ok: true, violations: [] }),
        call: (name, fn, payload, ctx) => gateway.call(name, fn, payload, inject(ctx)),
        callAsync: (name, fn, payload, ctx) => (typeof gateway.callAsync === "function"
          ? gateway.callAsync(name, fn, payload, inject(ctx))
          : Promise.resolve({ ok: false, code: "not_supported", detail: "The wrapped gateway cannot make async calls." })),
        register: (name, connector) => (typeof gateway.register === "function" ? gateway.register(name, connector) : (gateway.connectors ? (gateway.connectors[name] = connector) : connector))
      };
      return wrapped;
    }

    // ---- introspection -------------------------------------------------------
    function capabilityRows() {
      return ROLES.map(r => ({ role: r, label: ROLE_LABELS[r], actions: MATRIX[r].slice(), viewer: r === "viewer" }));
    }

    function verify() {
      const violations = [];
      if (!isRole(policy.default_role)) violations.push({ code: "bad_default_role", detail: policy.default_role });
      if (!isRole(identity.role)) violations.push({ code: "bad_identity_role", detail: identity.role });
      ROLES.forEach(r => { if (!MATRIX[r] || !MATRIX[r].length) violations.push({ code: "empty_role", detail: r }); });
      return { ok: violations.length === 0, violations: violations, role: identity.role, members: policy.members.length };
    }

    function renderZone() {
      const wrap = document.createElement("section");
      wrap.className = "card";
      wrap.innerHTML =
        '<div class="card-title-row"><div><h2>Roles &amp; access</h2>' +
        '<p class="hint" style="margin:2px 0 0">Who may create, price, discount, send and revoke. A viewer is read-only; managers run the day-to-day; the owner administers the team and policy. Client-portal visitors hold a token, never an internal role.</p></div>' +
        '<span class="chip" data-roles-chip>…</span></div>' +
        '<div class="sys-grid" data-roles-now></div>' +
        '<div data-roles-matrix style="margin-top:10px"></div>' +
        '<p class="hint" data-roles-floor style="margin-top:8px"></p>';

      function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

      function paint() {
        const id = current();
        wrap.querySelector("[data-roles-chip]").textContent = roleLabel(id.role) + (id.source === "hub" ? " · live" : "");
        wrap.querySelector("[data-roles-now]").innerHTML =
          '<div class="sys-row"><span class="sys-k">Signed in as</span><span class="sys-v">' + esc(id.name) + (id.source === "hub" ? "" : " (local)") + '</span></div>' +
          '<div class="sys-row"><span class="sys-k">Role</span><span class="sys-v">' + esc(roleLabel(id.role)) + '</span></div>' +
          '<div class="sys-row"><span class="sys-k">Account scope</span><span class="sys-v mono">' + esc(id.scope.join(", ")) + '</span></div>' +
          '<div class="sys-row"><span class="sys-k">Default role</span><span class="sys-v">' + esc(roleLabel(policy.default_role)) + '</span></div>';
        wrap.querySelector("[data-roles-matrix]").innerHTML = capabilityRows().map(r =>
          '<div class="hub-row"><span class="chip ' + (r.role === "owner" ? "ok" : r.role === "manager" ? "pending" : "") + '">' + esc(r.label) + '</span>' +
          '<span class="hint">' + r.actions.filter(a => a !== "view").map(a => esc(ACTION_LABELS[a] || a)).join(" · ") + '</span></div>'
        ).join("");
        const floor = policy.discount_floor_bp;
        wrap.querySelector("[data-roles-floor]").textContent = floor > 0
          ? "A manager may discount down to " + (floor / 100).toFixed(1) + "% margin; anything below needs an owner."
          : "No discount floor is configured — managers may discount freely.";
      }

      paint();
      listeners.push(paint);
      return wrap;
    }

    return {
      VERSION,
      current,
      regime,
      setIdentity,
      clearIdentity,
      setPolicy,
      policy: policySnapshot,
      defaultRole,
      discountFloor,
      members,
      can: canAction,
      assert: assertAction,
      canDiscount: (marginBp) => canDiscount(identity.role, marginBp, policy.discount_floor_bp),
      capabilities: () => capabilities(identity.role),
      scope,
      allows,
      moduleAction,
      canWrite,
      assertWrite,
      guard: (module, content, previous) => guard(module, content, previous),
      registerGuards,
      wrapGateway,
      capabilityRows,
      roleLabel,
      verify,
      renderZone,
      onIdentityChange(fn) { if (typeof fn === "function") { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); }; } return () => {}; }
    };
  }

  return {
    VERSION,
    ROLES,
    ROLE_LABELS,
    ROLE_ALIASES,
    PORTAL_REGIME,
    INTERNAL_REGIME,
    PORTAL_ACTIONS,
    ACTIONS,
    ACTION_LABELS,
    MATRIX,
    MODULE_ACTION,
    RoleError,
    normalizeRole,
    roleLabel,
    isRole,
    can,
    assert,
    capabilities,
    canPortal,
    canDiscount,
    writeVerdict,
    SENT_STATES,
    normalizeScopeValue,
    normalizePolicy,
    resolveIdentity,
    scopeAllows,
    createService
  };
})();
