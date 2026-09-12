// ============================================================================
// quote-u — operational flags & data mode (roadmap task 38)
// ----------------------------------------------------------------------------
// The single operational control surface over every external effect:
//
//   kill_switch            — a global "stop all external writes" switch;
//   write_flags.<feature>  — a per-feature write flag (opportunity update,
//                            note, revenue, direct invoice, PSA invoice, email);
//   data_mode              — live | mock | lockdown:
//                              live      — normal operation;
//                              mock      — no LIVE external call may happen, so
//                                          an adapter marked live is refused
//                                          (mocks still work);
//                              lockdown  — every external WRITE is blocked;
//   require_internal_review— sends are gated on the version having passed
//                            through the `internal_review` state.
//
// Enforcement is at ONE boundary — `wrapGateway` wraps the connector gateway,
// so every outbound call is classified (write vs read) and checked before it
// leaves. A blocked call returns a policy refusal (`policy: true`) that the
// outbox treats as terminal, so a disabled write is not retried forever.
//
// The config lives in the versioned `feature_flags` document (durable),
// mirroring the `quoteFeaturePolicy` default in main.pjs; the Admin station
// renders a control panel for it.
// ============================================================================
window.QU_FEATURES = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "feature_flags";
  const MODES = Object.freeze(["live", "mock", "lockdown"]);

  // The feature catalog. `write: true` marks a write feature (a blocked write
  // is a policy refusal); the read feature gates external reads.
  const FEATURES = Object.freeze([
    { key: "opp_create", label: "Create opportunity", write: true, default: true },
    { key: "opp_update", label: "Update opportunity on approval", write: true, default: true },
    { key: "note_write", label: "Write opportunity note on approval", write: true, default: true },
    { key: "revenue_write", label: "Write revenue/product lines on approval", write: true, default: true },
    { key: "email_send", label: "Send quote link email", write: true, default: true },
    { key: "invoice_direct", label: "Direct accounting invoice", write: true, default: true },
    { key: "invoice_psa", label: "PSA invoice", write: true, default: true },
    { key: "distributor_read", label: "Distributor price reads", write: false, default: true },
    { key: "content_read", label: "Product-content reads", write: false, default: true },
    { key: "bus_publish", label: "Publish quote events to the pipeline bus", write: true, default: true },
    { key: "webhook_out", label: "Deliver quote events to outbound webhooks", write: true, default: true }
  ]);
  const FEATURE_KEYS = FEATURES.map(f => f.key);

  // Which connector function performs which feature. Anything not listed is
  // treated as a WRITE (fail closed) so a new function cannot slip past the
  // guard unnoticed.
  const FUNCTION_FEATURE = Object.freeze({
    "psa.createOpportunity": "opp_create",
    "psa.updateOpportunity": "opp_update",
    "psa.writeNote": "note_write",
    "psa.writeRevenueLines": "revenue_write",
    "psa.requestInvoice": "invoice_psa",
    "mail.send": "email_send",
    "accounting.upsertCustomer": "invoice_direct",
    "accounting.createInvoice": "invoice_direct",
    "bus.publish": "bus_publish",
    "bus.webhookPost": "webhook_out"
  });
  const READ_FUNCTIONS = Object.freeze({
    psa: ["getCompany", "listCompanies", "getContact", "listContacts", "getOpportunity", "listOpportunities", "opportunityWriteCount", "getOpportunityNotes", "getRevenueLines", "getPsaInvoice", "psaInvoiceCount"],
    mail: ["listReps", "resolveRep", "get", "list", "outboxSize"],
    accounting: ["getCustomer", "getInvoice", "invoiceCount", "customerCount"],
    distributor_a: ["searchCatalog", "getPrice", "getAvailability"],
    distributor_b: ["searchCatalog", "getPrice", "getAvailability"],
    content: ["wikidataSearch", "wikidataEntity", "openFoodFactsProduct"],
    quoteread: ["search", "getQuote", "getQuoteEvents"],
    bus: ["list", "streamSize", "deliveries", "deliveryCount"]
  });

  // Reads that are gated by a feature flag (the distributor price reads share
  // the `distributor_read` flag, so turning it off stops every distributor
  // quote without touching the individual adapters).
  const READ_FEATURE = Object.freeze({
    distributor_a: "distributor_read",
    distributor_b: "distributor_read",
    content: "content_read"
  });

  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class FeatureError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "FeatureError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new FeatureError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function normalizeConfig(input, opts) {
    opts = opts || {};
    const p = isPlainObject(input) ? input : {};
    const flags = {};
    FEATURES.forEach(f => { flags[f.key] = f.default; });
    if (isPlainObject(p.write_flags)) {
      for (const k of Object.keys(p.write_flags)) {
        if (FEATURE_KEYS.indexOf(k) !== -1) flags[k] = p.write_flags[k] !== false;
      }
    }
    // A `disabled_features` array is the convenient inverse form.
    if (Array.isArray(p.disabled_features)) {
      p.disabled_features.forEach(k => { if (FEATURE_KEYS.indexOf(String(k)) !== -1) flags[String(k)] = false; });
    }
    const mode = p.data_mode === undefined || p.data_mode === null ? "live" : String(p.data_mode);
    const dataMode = MODES.indexOf(mode) !== -1 ? mode : "live";
    return {
      kill_switch: p.kill_switch === true,
      data_mode: dataMode,
      require_internal_review: p.require_internal_review === true,
      write_flags: flags,
      updated_at: p.updated_at === undefined || p.updated_at === null ? null : String(p.updated_at),
      updated_by: p.updated_by === undefined || p.updated_by === null ? null : String(p.updated_by)
    };
  }

  function assertNoSecret(config) {
    const check = obj => {
      if (!isPlainObject(obj)) return;
      for (const k of Object.keys(obj)) {
        if (SECRET_KEY_RE.test(k)) fail("secret_not_allowed", `A feature config must never carry a secret-shaped field ("${k}").`);
      }
    };
    check(config);
    check(config && config.write_flags);
    return config;
  }

  function featureOn(config, key) {
    const cfg = normalizeConfig(config);
    if (FEATURE_KEYS.indexOf(String(key)) === -1) return false;
    return cfg.write_flags[String(key)] !== false;
  }

  // Classify a connector function: a known write feature, a known read, or an
  // unknown function (fail closed → treated as a write with no feature key).
  function classify(connector, fn) {
    const key = String(connector) + "." + String(fn);
    if (FUNCTION_FEATURE[key]) return { kind: "write", feature: FUNCTION_FEATURE[key], known: true };
    const reads = READ_FUNCTIONS[connector];
    if (reads && reads.indexOf(String(fn)) !== -1) return { kind: "read", feature: READ_FEATURE[connector] || null, known: true };
    return { kind: "write", feature: null, known: false };
  }

  // Pure guard over one external call. Returns { ok:true } or a refusal
  // { ok:false, code, detail, policy:true }.
  function guardCall(config, call) {
    call = call || {};
    const cfg = normalizeConfig(config);
    const cls = call.kind ? { kind: call.kind, feature: call.feature || null } : classify(call.connector, call.fn);
    const live = call.live === true;

    // Data mode first: mock forbids every live call; lockdown forbids writes.
    if (cfg.data_mode === "mock" && live) {
      return { ok: false, code: "mock_mode_live_blocked", policy: true, detail: "The data mode is \"mock\": live external calls are disabled." };
    }
    if (cfg.data_mode === "lockdown" && cls.kind === "write") {
      return { ok: false, code: "lockdown", policy: true, detail: "The data mode is \"lockdown\": all external writes are blocked." };
    }
    if (cls.kind === "write" && cfg.kill_switch) {
      return { ok: false, code: "kill_switch", policy: true, detail: "The external-write kill switch is on: no external writes may happen." };
    }
    if (cls.feature && cfg.write_flags[cls.feature] === false) {
      return { ok: false, code: "feature_disabled", policy: true, detail: `The "${cls.feature}" write feature is disabled by policy.` };
    }
    if (cls.kind === "read" && cls.feature && cfg.write_flags[cls.feature] === false) {
      return { ok: false, code: "feature_disabled", policy: true, detail: `The "${cls.feature}" feature is disabled by policy.` };
    }
    return { ok: true, kind: cls.kind, feature: cls.feature, live: live };
  }

  const POLICY_CODES = Object.freeze(["mock_mode_live_blocked", "lockdown", "kill_switch", "feature_disabled"]);
  function isPolicyRefusal(code) { return POLICY_CODES.indexOf(String(code)) !== -1; }

  // Pure send gate for the internal-review requirement.
  function sendGate(config, context) {
    context = context || {};
    const cfg = normalizeConfig(config);
    if (!cfg.require_internal_review) return { ok: true };
    const version = context.version || {};
    const state = version.state || context.state || "draft";
    if (state === "internal_review") return { ok: true };
    return { ok: false, code: "internal_review_required", detail: "This quote must pass through internal review before it can be sent." };
  }

  // Wrap the connector gateway so every call is checked at the one boundary.
  function wrapGateway(gateway, configOrService, opts) {
    opts = opts || {};
    const blocked = [];
    const maxBlocked = opts.maxBlocked === undefined ? 200 : opts.maxBlocked;
    function cfg() {
      if (configOrService && typeof configOrService.config === "function") return configOrService.config();
      return normalizeConfig(configOrService);
    }
    function record(name, fn, refusal, live) {
      blocked.push({ at: new Date().toISOString(), connector: name, fn: fn, code: refusal.code, live: !!live });
      if (blocked.length > maxBlocked) blocked.shift();
    }
    const wrapped = {
      connectors: gateway.connectors,
      has: name => gateway.has(name),
      list: () => gateway.list(),
      allowedFunctions: name => gateway.allowedFunctions(name),
      callLog: () => gateway.callLog(),
      clearLog: () => gateway.clearLog(),
      blockedLog: () => blocked.slice(),
      clearBlockedLog: () => { blocked.length = 0; },
      // Forward the task-46 governance surface so the Connectors station can
      // read the manifest, toggle connectors, inspect roles and run verify()
      // through the SAME wrapped gateway the app calls through.
      effectOf: (name, fn) => (typeof gateway.effectOf === "function" ? gateway.effectOf(name, fn) : null),
      manifest: () => (typeof gateway.manifest === "function" ? gateway.manifest() : []),
      isEnabled: name => (typeof gateway.isEnabled === "function" ? gateway.isEnabled(name) : true),
      setEnabled: (name, on) => (typeof gateway.setEnabled === "function" ? gateway.setEnabled(name, on) : { ok: false, code: "not_supported" }),
      enable: name => (typeof gateway.enable === "function" ? gateway.enable(name) : { ok: false, code: "not_supported" }),
      disable: name => (typeof gateway.disable === "function" ? gateway.disable(name) : { ok: false, code: "not_supported" }),
      roles: () => (typeof gateway.roles === "function" ? gateway.roles() : {}),
      assignRole: (role, cfg) => (typeof gateway.assignRole === "function" ? gateway.assignRole(role, cfg) : { ok: false, code: "not_supported" }),
      defaultRole: () => (typeof gateway.defaultRole === "function" ? gateway.defaultRole() : "owner"),
      setKeystore: k => (typeof gateway.setKeystore === "function" ? gateway.setKeystore(k) : null),
      keyName: name => (typeof gateway.keyName === "function" ? gateway.keyName(name) : null),
      setLogSink: fn => (typeof gateway.setLogSink === "function" ? gateway.setLogSink(fn) : null),
      verify: () => (typeof gateway.verify === "function" ? gateway.verify() : { ok: true, violations: [] }),
      call(name, fn, payload, ctx) {
        const connector = gateway.connectors ? gateway.connectors[name] : null;
        const live = !!((ctx && ctx.live) || (connector && connector.live));
        const g = guardCall(cfg(), { connector: name, fn: fn, live: live });
        if (!g.ok) { record(name, fn, g, live); return { ok: false, code: g.code, detail: g.detail, policy: true }; }
        return gateway.call(name, fn, payload, ctx);
      },
      callAsync(name, fn, payload, ctx) {
        const connector = gateway.connectors ? gateway.connectors[name] : null;
        const live = !!((ctx && ctx.live) || (connector && connector.live));
        const g = guardCall(cfg(), { connector: name, fn: fn, live: live });
        if (!g.ok) { record(name, fn, g, live); return Promise.resolve({ ok: false, code: g.code, detail: g.detail, policy: true }); }
        if (typeof gateway.callAsync !== "function") return Promise.resolve({ ok: false, code: "not_supported", detail: "The wrapped gateway cannot make async calls." });
        return gateway.callAsync(name, fn, payload, ctx);
      },
      register(name, connector) {
        if (typeof gateway.register === "function") return gateway.register(name, connector);
        if (gateway.connectors) gateway.connectors[name] = connector;
        return connector;
      }
    };
    return wrapped;
  }

  // ---- persistence + the Admin panel ---------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const clock = opts.clock || null;
    const actor = opts.actor || null;
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;
    let current = normalizeConfig(opts.policy);
    let loaded = false;

    if (store && (typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function")) {
      fail("no_store", "QU_FEATURES needs a document store with loadDoc/saveChecked.");
    }

    async function load() {
      if (!store) return { ok: true, config: current, revision: 0, content: { records: [], config: null } };
      const d = await store.loadDoc(DOC);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const cfg = content.config ? normalizeConfig(content.config) : current;
      return { ok: true, state: d.state, revision: d.revision, content, config: cfg };
    }

    async function ready() {
      const l = await load();
      if (l.ok) { current = l.config; loaded = true; }
      return l.ok ? { ok: true, doc: DOC, config: current } : l;
    }

    function config() { return current; }

    async function update(patch) {
      patch = patch || {};
      if (store) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const l = await load();
          if (!l.ok) return l;
          const merged = normalizeConfig(Object.assign({}, l.config, patch, {
            write_flags: Object.assign({}, l.config.write_flags, isPlainObject(patch.write_flags) ? patch.write_flags : {}),
            updated_at: nowIso(clock),
            updated_by: actor || l.config.updated_by
          }));
          assertNoSecret(merged);
          const content = Object.assign({}, l.content, { records: Array.isArray(l.content.records) ? l.content.records : [], config: merged });
          const save = await store.saveChecked(DOC, content, { expectedBase: l.revision });
          if (save.ok) { current = merged; loaded = true; return { ok: true, config: current, revision: save.revision }; }
          if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
          return save;
        }
        return { ok: false, code: "feature_conflict", detail: `Could not write the ${DOC} document after ${maxRetries + 1} attempts.` };
      }
      current = normalizeConfig(Object.assign({}, current, patch, {
        write_flags: Object.assign({}, current.write_flags, isPlainObject(patch.write_flags) ? patch.write_flags : {}),
        updated_at: nowIso(clock)
      }));
      assertNoSecret(current);
      return { ok: true, config: current, revision: 0 };
    }

    function setFeature(key, on) {
      if (FEATURE_KEYS.indexOf(String(key)) === -1) return Promise.resolve({ ok: false, code: "unknown_feature", detail: `No feature "${key}".` });
      const patch = { write_flags: {} };
      patch.write_flags[String(key)] = on !== false;
      return update(patch);
    }

    function setMode(mode) {
      if (MODES.indexOf(String(mode)) === -1) return Promise.resolve({ ok: false, code: "bad_mode", detail: `Unknown data mode "${mode}"; expected one of ${MODES.join(", ")}.` });
      return update({ data_mode: String(mode) });
    }

    function setKillSwitch(on, ctx) {
      return update({ kill_switch: on !== false, ...(ctx && ctx.require_internal_review !== undefined ? { require_internal_review: !!ctx.require_internal_review } : {}) });
    }

    function guard(call) { return guardCall(current, call); }
    function wrap(gateway, o) { return wrapGateway(gateway, { config: () => current }, o); }
    function gate(context) { return sendGate(current, context); }

    async function verify() {
      const l = await load();
      if (!l.ok) return l;
      const violations = [];
      if (MODES.indexOf(l.config.data_mode) === -1) violations.push({ code: "bad_mode", detail: `unknown data mode ${l.config.data_mode}` });
      FEATURE_KEYS.forEach(k => { if (typeof l.config.write_flags[k] !== "boolean") violations.push({ code: "bad_flag", detail: `feature ${k} is not boolean` }); });
      return { ok: violations.length === 0, violations, config: l.config, revision: l.revision };
    }

    function renderZone() {
      const wrap = document.createElement("section");
      wrap.className = "card";
      wrap.innerHTML =
        '<div class="card-title-row"><div><h2>Operational flags</h2>' +
        '<p class="hint" style="margin:2px 0 0">The kill switch, per-feature write flags and data mode. The data-mode guard blocks live calls in mock and all writes in lockdown.</p></div>' +
        '<span class="chip" data-feat-chip>…</span></div>' +
        '<div class="sys-grid" data-feat-mode></div>' +
        '<div data-feat-flags style="margin-top:10px"></div>' +
        '<div data-feat-msg class="hint" style="margin-top:8px"></div>';

      function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

      async function refresh() {
        const l = await load();
        const cfg = l.ok ? l.config : current;
        wrap.querySelector("[data-feat-chip]").textContent = cfg.data_mode;
        const modeSel = MODES.map(m => `<option value="${m}"${m === cfg.data_mode ? " selected" : ""}>${m}</option>`).join("");
        wrap.querySelector("[data-feat-mode]").innerHTML =
          '<div class="sys-row"><span class="sys-k">Data mode</span><span class="sys-v"><select data-feat-mode-sel>' + modeSel + "</select></span></div>" +
          '<div class="sys-row"><span class="sys-k">Kill switch</span><span class="sys-v"><label><input type="checkbox" data-feat-kill' + (cfg.kill_switch ? " checked" : "") + '> block all external writes</label></span></div>' +
          '<div class="sys-row"><span class="sys-k">Internal review</span><span class="sys-v"><label><input type="checkbox" data-feat-review' + (cfg.require_internal_review ? " checked" : "") + '> require internal review before send</label></span></div>';
        wrap.querySelector("[data-feat-flags]").innerHTML = FEATURES.map(f =>
          '<label style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="checkbox" data-feat-flag="' + f.key + '"' + (cfg.write_flags[f.key] !== false ? " checked" : "") + "> " + esc(f.label) + (f.write ? "" : " (read)") + "</label>"
        ).join("");

        const msg = wrap.querySelector("[data-feat-msg]");
        const save = async patch => {
          const r = await update(patch);
          msg.textContent = r.ok ? "Saved." : "Could not save: " + (r.detail || r.code);
          if (r.ok) refresh();
        };
        wrap.querySelector("[data-feat-mode-sel]").addEventListener("change", e => save({ data_mode: e.target.value }));
        wrap.querySelector("[data-feat-kill]").addEventListener("change", e => save({ kill_switch: e.target.checked }));
        wrap.querySelector("[data-feat-review]").addEventListener("change", e => save({ require_internal_review: e.target.checked }));
        wrap.querySelectorAll("[data-feat-flag]").forEach(cb => cb.addEventListener("change", e => {
          const patch = { write_flags: {} };
          patch.write_flags[e.target.dataset.featFlag] = e.target.checked;
          save(patch);
        }));
      }

      refresh();
      return wrap;
    }

    return {
      DOC,
      MODES,
      FEATURES,
      FEATURE_KEYS,
      ready, load, config, update, setFeature, setMode, setKillSwitch,
      guard, wrap, gate, verify, renderZone,
      isLoaded: () => loaded
    };
  }

  return {
    VERSION,
    DOC,
    MODES,
    FEATURES,
    FEATURE_KEYS,
    FUNCTION_FEATURE,
    READ_FUNCTIONS,
    READ_FEATURE,
    FeatureError,
    normalizeConfig,
    assertNoSecret,
    featureOn,
    classify,
    guardCall,
    isPolicyRefusal,
    POLICY_CODES,
    sendGate,
    wrapGateway,
    createService
  };
})();
