// ============================================================================
// quote-u — gated writes framework (roadmap task 47)
// ----------------------------------------------------------------------------
// Every OUTBOUND write is gated: before an external write may leave the app it
// must (a) have been individually approved by the write policy — a reviewed
// allowlist, so a brand-new write is refused until someone approves it — and
// (b) carry an explicit confirmation from the actor performing it. The gate
// WRAPS the (already feature/data-mode-guarded) connector gateway, so a write
// flows gate → feature guard → connector, and reads pass straight through.
//
//   write policy  — the reviewed allowlist. One entry per write function
//                   ("<connector>.<fn>"), each carrying who approved it, when
//                   and why. An unlisted function is NOT approved (fail closed):
//                   `write_not_approved`.
//   confirmation  — `ctx.confirm` = { by, at?, note? } supplied by the caller.
//                   A missing confirmation is `confirmation_required`.
//   ledger        — every gated attempt (performed or refused) is recorded with
//                   its full context: who, what, which key/role/scope, the
//                   decision and the outcome. Persisted in the `gated_writes`
//                   document; the in-memory view is authoritative for the UI.
//
// The policy and ledger live in versioned documents (durable, revision-guarded)
// and are editable from the Connectors station. The policy is seeded from
// main.pjs `quoteWritePolicy` so the already-reviewed writes keep working.
// ============================================================================
window.QU_GATED = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "write_policy";
  const LEDGER_DOC = "gated_writes";
  const LEDGER_CAP = 500;

  // Outbox action → the write function it performs. Documentation/labelling
  // only: the gate keys on the connector function, not the action.
  const ACTION_FUNCTION = Object.freeze({
    opp_create: "psa.createOpportunity",
    opp_update: "psa.updateOpportunity",
    note_write: "psa.writeNote",
    revenue_write: "psa.writeRevenueLines",
    email_send: "mail.send",
    invoice_direct: "accounting.createInvoice",
    invoice_psa: "psa.requestInvoice"
  });

  const REFUSAL_CODES = Object.freeze(["write_not_approved", "confirmation_required"]);

  class GateError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "GateError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function trimOrNull(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  // A function key is "<connector>.<fn>" — both halves are names.
  const FUNCTION_KEY_RE = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;
  function functionKey(connector, fn) {
    return String(connector) + "." + String(fn);
  }
  function parseKey(key) {
    const s = String(key || "");
    const i = s.indexOf(".");
    if (i === -1) return { connector: s, fn: null };
    return { connector: s.slice(0, i), fn: s.slice(i + 1) };
  }
  function isValidKey(key) { return FUNCTION_KEY_RE.test(String(key || "")); }

  function normalizeEntry(v) {
    const p = isPlainObject(v) ? v : {};
    return {
      approved: p.approved === true,
      approved_by: trimOrNull(p.approved_by),
      approved_at: trimOrNull(p.approved_at),
      note: trimOrNull(p.note)
    };
  }

  // The pure policy: a map of approved write functions. Absence is denial.
  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    const functions = {};
    const src = isPlainObject(p.functions) ? p.functions : {};
    Object.keys(src).forEach(k => {
      if (!isValidKey(k)) return;
      functions[k] = normalizeEntry(src[k]);
    });
    return {
      functions,
      require_confirmation: p.require_confirmation !== false,
      updated_at: trimOrNull(p.updated_at),
      updated_by: trimOrNull(p.updated_by)
    };
  }

  function isApproved(policy, key) {
    const cfg = normalizePolicy(policy);
    const e = cfg.functions[String(key)];
    return !!(e && e.approved === true);
  }

  // Extract the explicit confirmation from the caller's context. Only an object
  // with a non-empty `by` counts — a bare `true` is not an actor.
  function confirmationOf(ctx) {
    const c = ctx && ctx.confirm;
    if (!isPlainObject(c)) return null;
    const by = trimOrNull(c.by);
    if (!by) return null;
    return { by, at: trimOrNull(c.at) || null, note: trimOrNull(c.note) };
  }

  // The pure gate over one write attempt. `effect` is advisory; the caller must
  // only invoke this for writes. Returns { ok:true } or a refusal.
  function checkWrite(policy, key, ctx) {
    const cfg = normalizePolicy(policy);
    const k = String(key);
    if (!isValidKey(k)) return { ok: false, code: "bad_function_key", detail: `"${k}" is not a connector.function key.` };
    const entry = cfg.functions[k];
    if (!entry || entry.approved !== true) {
      return { ok: false, code: "write_not_approved", policy: true, detail: `The external write "${k}" has not been approved by the write policy.` };
    }
    if (cfg.require_confirmation) {
      const c = confirmationOf(ctx);
      if (!c) return { ok: false, code: "confirmation_required", policy: true, detail: `The external write "${k}" requires an explicit confirmation.` };
      return { ok: true, approved: entry, confirmation: c };
    }
    return { ok: true, approved: entry, confirmation: confirmationOf(ctx) };
  }

  function isRefusal(code) { return REFUSAL_CODES.indexOf(String(code)) !== -1; }

  // ---- persistence + the gate service ---------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const clock = opts.clock || null;
    const actor = opts.actor || "admin";
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;

    // The effect classifier: the loaded feature catalog when present (one source
    // of truth), else fail closed as a write.
    function classifyEffect(connector, fn) {
      if (window.QU_FEATURES && typeof window.QU_FEATURES.classify === "function") {
        const cls = window.QU_FEATURES.classify(connector, fn);
        if (cls && cls.kind) return cls.kind;
      }
      return "write";
    }

    let current = normalizePolicy(opts.policy);
    let ledgerArr = [];
    let baseGateway = opts.gateway || null;
    let loaded = false;
    let saveQueue = Promise.resolve();

    if (store && (typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function")) {
      throw new GateError("no_store", "QU_GATED needs a document store with loadDoc/saveChecked.");
    }

    async function loadPolicy() {
      if (!store) return { ok: true, config: current, revision: 0 };
      const d = await store.loadDoc(DOC);
      if (!d.ok) return d;
      const content = isPlainObject(d.content) ? d.content : {};
      // An absent/empty document (state "none", or a doc with no config) must
      // NOT clear the seeded policy — a fresh install keeps the reviewed seed.
      const cfg = isPlainObject(content.config) ? normalizePolicy(content.config) : current;
      return { ok: true, revision: d.revision, content, config: cfg };
    }

    async function loadLedger() {
      if (!store) return { ok: true, records: ledgerArr.slice() };
      const d = await store.loadDoc(LEDGER_DOC);
      if (!d.ok) return d;
      const content = isPlainObject(d.content) ? d.content : {};
      return { ok: true, revision: d.revision, records: Array.isArray(content.records) ? content.records.slice() : [] };
    }

    async function ready() {
      const p = await loadPolicy();
      if (p.ok) { current = p.config; loaded = true; }
      const l = await loadLedger();
      if (l.ok) {
        // Merge any entries adopted before the load (e.g. a refusal logged during
        // boot) with the persisted ones, de-duplicated by id.
        const byId = new Map();
        l.records.concat(ledgerArr).forEach(r => { if (r && (r.id || r.at)) byId.set(String(r.id || r.at + r.connector + r.fn), r); });
        ledgerArr = Array.from(byId.values()).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-LEDGER_CAP);
      }
      return p.ok ? { ok: true, doc: DOC, config: current, ledger: ledgerArr.length } : p;
    }

    function config() { return current; }
    function requireConfirmation() { return current.require_confirmation !== false; }

    // Persist the whole policy doc under a revision guard (mirrors QU_FEATURES).
    async function update(patch) {
      patch = patch || {};
      if (store) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const l = await loadPolicy();
          if (!l.ok) return l;
          const merged = normalizePolicy(Object.assign({}, l.config, patch, {
            functions: Object.assign({}, l.config.functions, isPlainObject(patch.functions) ? patch.functions : {}),
            updated_at: nowIso(clock),
            updated_by: actor
          }));
          const content = Object.assign({}, l.content, { records: Array.isArray(l.content.records) ? l.content.records : [], config: merged });
          const save = await store.saveChecked(DOC, content, { expectedBase: l.revision });
          if (save.ok) { current = merged; loaded = true; return { ok: true, config: current, revision: save.revision }; }
          if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
          return save;
        }
        return { ok: false, code: "write_policy_conflict", detail: `Could not write the ${DOC} document after ${maxRetries + 1} attempts.` };
      }
      current = normalizePolicy(Object.assign({}, current, patch, {
        functions: Object.assign({}, current.functions, isPlainObject(patch.functions) ? patch.functions : {}),
        updated_at: nowIso(clock),
        updated_by: actor
      }));
      return { ok: true, config: current, revision: 0 };
    }

    function approve(key, meta) {
      meta = meta || {};
      const k = String(key || "");
      if (!isValidKey(k)) return Promise.resolve({ ok: false, code: "bad_function_key", detail: `"${k}" is not a connector.function key.` });
      const entry = { approved: true, approved_by: trimOrNull(meta.by) || actor, approved_at: trimOrNull(meta.at) || nowIso(clock), note: trimOrNull(meta.note) };
      const functions = {};
      functions[k] = entry;
      return update({ functions });
    }

    function revoke(key, meta) {
      meta = meta || {};
      const k = String(key || "");
      if (!isValidKey(k)) return Promise.resolve({ ok: false, code: "bad_function_key", detail: `"${k}" is not a connector.function key.` });
      const functions = {};
      functions[k] = { approved: false, approved_by: trimOrNull(meta.by) || actor, approved_at: nowIso(clock), note: trimOrNull(meta.note) || "revoked" };
      return update({ functions });
    }

    function setRequireConfirmation(on) {
      return update({ require_confirmation: on !== false });
    }

    // ---- the gate wrapper ---------------------------------------------------

    function ledgerPush(entry) {
      ledgerArr.push(entry);
      if (ledgerArr.length > LEDGER_CAP) ledgerArr = ledgerArr.slice(-LEDGER_CAP);
      return entry;
    }

    // Best-effort persistence of the ledger: the in-memory view is authoritative
    // for the UI, so a failed save never blocks or loses the local record.
    function persistLedger() {
      if (!store) return saveQueue;
      saveQueue = saveQueue.then(async () => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const d = await store.loadDoc(LEDGER_DOC);
          if (!d.ok && d.state !== "none") return;
          const base = d.ok ? d.revision : 0;
          const remote = d.ok && isPlainObject(d.content) && Array.isArray(d.content.records) ? d.content.records : [];
          const byId = new Map();
          remote.concat(ledgerArr).forEach(r => { if (r) byId.set(String(r.id || (r.at || "") + (r.connector || "") + (r.fn || "")), r); });
          const records = Array.from(byId.values()).sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-LEDGER_CAP);
          const save = await store.saveChecked(LEDGER_DOC, { records, updated_at: nowIso(clock) }, { expectedBase: base });
          if (save.ok) return;
          if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
          return;
        }
      }).catch(() => {});
      return saveQueue;
    }

    function flush() { return saveQueue; }

    function makeLedgerEntry(connector, fn, ctx, decision, extra) {
      const role = (ctx && ctx.role) || null;
      const scope = (ctx && ctx.scope) || null;
      const confirm = confirmationOf(ctx);
      return Object.assign({
        id: "gw-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36),
        at: nowIso(clock),
        connector: String(connector),
        fn: String(fn),
        key: functionKey(connector, fn),
        decision: decision,
        by: confirm ? confirm.by : null,
        confirmed_at: confirm ? (confirm.at || nowIso(clock)) : null,
        note: confirm ? confirm.note : null,
        role: role,
        scope: scope
      }, extra || {});
    }

    // Forward every other gateway method so the wrapped gateway is a drop-in.
    function forward(gateway) {
      const pass = {};
      ["has", "list", "allowedFunctions", "callLog", "clearLog", "blockedLog", "clearBlockedLog", "effectOf",
        "manifest", "isEnabled", "setEnabled", "enable", "disable", "roles", "assignRole", "defaultRole",
        "setKeystore", "keyName", "setLogSink", "verify"].forEach(name => {
        if (typeof gateway[name] === "function") pass[name] = gateway[name].bind(gateway);
      });
      return pass;
    }

    function wrap(gateway) {
      if (!gateway) throw new GateError("no_gateway", "QU_GATED.wrap needs a connector gateway.");
      baseGateway = gateway;
      const wrapped = Object.assign({}, forward(gateway), {
        connectors: gateway.connectors,
        register(name, connector) {
          if (typeof gateway.register === "function") return gateway.register(name, connector);
          if (gateway.connectors) gateway.connectors[name] = connector;
          return connector;
        },
        call(connector, fn, payload, ctx) {
          const effect = (typeof gateway.effectOf === "function" ? gateway.effectOf(connector, fn) : null) || classifyEffect(connector, fn);
          if (effect !== "write") return gateway.call(connector, fn, payload, ctx);
          const check = checkWrite(current, functionKey(connector, fn), ctx);
          if (!check.ok) {
            ledgerPush(makeLedgerEntry(connector, fn, ctx, "refused", { code: check.code, effect: effect }));
            persistLedger();
            return { ok: false, code: check.code, detail: check.detail, policy: true };
          }
          const res = gateway.call(connector, fn, payload, ctx);
          const ok = !!(res && res.ok !== false);
          ledgerPush(makeLedgerEntry(connector, fn, ctx, ok ? "performed" : "failed", {
            effect: effect,
            code: ok ? null : (res && res.code) || null,
            result_code: ok ? (res && res.result && res.result.code) || null : null
          }));
          persistLedger();
          return res;
        },
        callAsync(connector, fn, payload, ctx) {
          const effect = (typeof gateway.effectOf === "function" ? gateway.effectOf(connector, fn) : null) || classifyEffect(connector, fn);
          if (effect !== "write") {
            if (typeof gateway.callAsync !== "function") return Promise.resolve({ ok: false, code: "not_supported", detail: "The wrapped gateway cannot make async calls." });
            return gateway.callAsync(connector, fn, payload, ctx);
          }
          const check = checkWrite(current, functionKey(connector, fn), ctx);
          if (!check.ok) {
            ledgerPush(makeLedgerEntry(connector, fn, ctx, "refused", { code: check.code, effect: effect }));
            return Promise.resolve(persistLedger()).then(() => ({ ok: false, code: check.code, detail: check.detail, policy: true }));
          }
          if (typeof gateway.callAsync !== "function") return Promise.resolve({ ok: false, code: "not_supported", detail: "The wrapped gateway cannot make async calls." });
          return gateway.callAsync(connector, fn, payload, ctx).then(res => {
            const ok = !!(res && res.ok !== false);
            ledgerPush(makeLedgerEntry(connector, fn, ctx, ok ? "performed" : "failed", { effect: effect, code: ok ? null : (res && res.code) || null }));
            persistLedger();
            return res;
          });
        }
      });
      return wrapped;
    }

    // The declared write functions across every registered connector, with
    // their approval state — what the policy panel lists.
    function declaredWrites() {
      const gateway = baseGateway;
      if (!gateway || !gateway.connectors) return [];
      const out = [];
      Object.keys(gateway.connectors).forEach(name => {
        const connector = gateway.connectors[name];
        const fns = (connector && connector.functions) || {};
        Object.keys(fns).forEach(fn => {
          const effect = (typeof gateway.effectOf === "function" ? gateway.effectOf(name, fn) : null) || classifyEffect(name, fn);
          if (effect !== "write") return;
          const k = functionKey(name, fn);
          const e = current.functions[k];
          out.push({ key: k, connector: name, fn: fn, approved: !!(e && e.approved === true), approved_by: e ? e.approved_by : null, approved_at: e ? e.approved_at : null, note: e ? e.note : null });
        });
      });
      return out;
    }

    function pending() { return declaredWrites().filter(w => !w.approved); }

    function ledger(filter) {
      filter = filter || {};
      let rows = ledgerArr.slice();
      if (filter.key) rows = rows.filter(r => r.key === filter.key);
      if (filter.decision) rows = rows.filter(r => r.decision === filter.decision);
      if (filter.connector) rows = rows.filter(r => r.connector === filter.connector);
      if (filter.limit) rows = rows.slice(-filter.limit);
      return rows;
    }
    function clearLedger() { ledgerArr = []; return persistLedger().then(() => ({ ok: true })); }

    function verify() {
      const violations = [];
      Object.keys(current.functions).forEach(k => {
        if (!isValidKey(k)) violations.push({ code: "bad_function_key", detail: `"${k}" is not a connector.function key.` });
      });
      const writes = declaredWrites();
      const declared = {};
      writes.forEach(w => { declared[w.key] = true; });
      Object.keys(current.functions).forEach(k => {
        if (!declared[k]) violations.push({ code: "unknown_function", detail: `The write policy approves "${k}", which no registered connector exposes.` });
      });
      return { ok: violations.length === 0, violations, pending: writes.filter(w => !w.approved).map(w => w.key) };
    }

    return {
      VERSION,
      DOC,
      LEDGER_DOC,
      ready,
      config,
      isApproved: key => isApproved(current, key),
      requireConfirmation,
      setRequireConfirmation,
      approve,
      revoke,
      update,
      wrap,
      flush,
      classifyEffect,
      declaredWrites,
      pending,
      ledger,
      clearLedger,
      verify,
      isLoaded: () => loaded
    };
  }

  return {
    VERSION,
    DOC,
    LEDGER_DOC,
    LEDGER_CAP,
    ACTION_FUNCTION,
    REFUSAL_CODES,
    GateError,
    functionKey,
    parseKey,
    isValidKey,
    normalizePolicy,
    normalizeEntry,
    isApproved,
    confirmationOf,
    checkWrite,
    isRefusal,
    createService
  };
})();
