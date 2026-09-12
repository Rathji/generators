// quote-u — quote lifecycle state machine (roadmap task 5)
//
// ONE service owns the lifecycle of a quote VERSION:
//
//     draft ─▶ sent ─▶ viewed ─▶ approved
//          └──▶ declined / expired (terminal)
// `internal_review` remains a legal (but DEPRECATED, task 56) state for old
// data; the ratified flow is the direct draft → sent path.
//
// Every transition is validated in exactly one place (`attempt`), and every
// accepted transition produces a `quote_events` record (task 6 persists it
// append-only). The module is pure: it never mutates the version it is given,
// never reads the clock unless the caller omits `at`, and never touches storage
// or the network.
//
// Server authority: the same table lives in the server-plugin script, which
// validates transitions authoritatively. `attachServerValidator(fn)` makes
// `applyChecked` route every transition through the server first and refuse
// whenever the server refuses (the client is never the authority). If the
// server is unreachable the result is marked `authority:"local", degraded:true`
// rather than silently pretending to be authoritative. `verifyAgainst()` proves
// the two tables have not drifted.
(function () {
  "use strict";

  const VERSION = "1.0.0";
  const INITIAL_STATE = "draft";
  const STATES = Object.freeze(["draft", "internal_review", "sent", "viewed", "approved", "declined", "expired"]);
  const TERMINAL_STATES = Object.freeze(["approved", "declined", "expired"]);
  // Task 56: the optional `internal_review` state is SUPERSEDED — quote-u's
  // ratified flow is the direct draft → sent path. The state stays in the
  // machine (frozen/decided versions and old audit events may still reference
  // it; deleting it would rewrite history) but is marked deprecated. No new
  // quote enters it, and QU_MIGRATE returns any mutable version parked in it
  // to `draft` so the concept stops lingering in live data.
  const DEPRECATED_STATES = Object.freeze({ internal_review: "superseded by the direct draft → sent path (task 56)" });
  const ACTOR_TYPES = Object.freeze(["internal", "portal", "system"]);
  const CREATED_EVENT = "created";

  // state → { target state: event name }. An empty object means terminal.
  const TRANSITIONS = Object.freeze({
    draft: Object.freeze({ internal_review: "internal_review_started", sent: "sent" }),
    internal_review: Object.freeze({ draft: "internal_review_returned", sent: "sent" }),
    sent: Object.freeze({ viewed: "viewed", approved: "approved", declined: "declined", expired: "expired" }),
    viewed: Object.freeze({ approved: "approved", declined: "declined", expired: "expired" }),
    approved: Object.freeze({}),
    declined: Object.freeze({}),
    expired: Object.freeze({})
  });

  const TIMESTAMP_FIELD = {
    internal_review: "internal_review_at",
    draft: "draft_at",
    sent: "sent_at",
    viewed: "viewed_at",
    approved: "approved_at",
    declined: "declined_at",
    expired: "expired_at"
  };

  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class LifecycleError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "LifecycleError";
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new LifecycleError(code, message);
  }

  function isState(state) {
    return typeof state === "string" && STATES.indexOf(state) !== -1;
  }

  function isTerminal(state) {
    return TERMINAL_STATES.indexOf(state) !== -1;
  }

  function allowedFrom(state) {
    const row = TRANSITIONS[state];
    return row ? Object.keys(row) : [];
  }

  function canTransition(from, to) {
    const row = TRANSITIONS[from];
    return !!(row && Object.prototype.hasOwnProperty.call(row, to));
  }

  function eventFor(from, to) {
    const row = TRANSITIONS[from];
    return row ? row[to] || null : null;
  }

  function assertTransition(from, to) {
    if (!isState(from)) fail("unknown_state", `Unknown lifecycle state "${from}".`);
    if (!isState(to)) fail("unknown_state", `Unknown lifecycle state "${to}".`);
    if (!canTransition(from, to)) fail("illegal_transition", `A quote version cannot go from ${from} to ${to}.`);
    return eventFor(from, to);
  }

  function nowIso(ctx) {
    if (ctx && ctx.at) return String(ctx.at);
    return new Date().toISOString();
  }

  function checkForbiddenKeys(obj, path) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => checkForbiddenKeys(v, `${path}[${i}]`));
      return;
    }
    for (const key of Object.keys(obj)) {
      if (SECRET_KEY_RE.test(key)) fail("secret_in_event", `Refusing to record a secret-shaped field "${path}${key}" in the audit event.`);
      checkForbiddenKeys(obj[key], `${path}${key}.`);
    }
  }

  // ------------------------------------------------------------- transitions

  // Validate one transition WITHOUT touching a version.
  // → { ok:true, from, to, state, event, terminal } | { ok:false, code, detail }
  function attempt(from, to, ctx) {
    ctx = ctx || {};
    if (!isState(from)) return { ok: false, code: "unknown_state", detail: `Unknown lifecycle state "${from}".` };
    if (!isState(to)) return { ok: false, code: "unknown_state", detail: `Unknown lifecycle state "${to}".` };
    if (!canTransition(from, to)) {
      return { ok: false, code: "illegal_transition", detail: `A quote version cannot go from ${from} to ${to}.` };
    }
    if (ctx.actor_type !== undefined && ACTOR_TYPES.indexOf(ctx.actor_type) === -1) {
      return { ok: false, code: "bad_actor", detail: `actor_type must be one of ${ACTOR_TYPES.join(", ")}.` };
    }
    if (ctx.actor_type === "portal" && !ctx.token_id) {
      return { ok: false, code: "portal_needs_token", detail: "A portal transition must carry the token id (never the token secret)." };
    }
    const event = eventFor(from, to);
    return { ok: true, from, to, state: to, event, terminal: isTerminal(to) };
  }

  // Build the append-only audit record for a transition (shape consumed by the
  // quote_events document). Never contains a token secret.
  function createEvent(input) {
    input = input || {};
    const actorType = input.actor_type === undefined ? "system" : input.actor_type;
    if (ACTOR_TYPES.indexOf(actorType) === -1) fail("bad_actor", `actor_type must be one of ${ACTOR_TYPES.join(", ")}.`);
    if (actorType === "portal" && !input.token_id) fail("portal_needs_token", "A portal event must carry the token id.");
    const event = input.event;
    if (typeof event !== "string" || !event) fail("bad_event", "An audit event needs a non-empty event name.");
    const actor = input.actor === undefined ? actorType : input.actor;
    if (typeof actor !== "string" || !actor) fail("bad_actor", "An audit event needs a non-empty actor.");
    checkForbiddenKeys(input.detail, "detail.");
    const record = {
      quote_id: input.quote_id === undefined ? null : input.quote_id,
      version_id: input.version_id === undefined ? null : input.version_id,
      event,
      actor_type: actorType,
      actor,
      token_id: input.token_id === undefined ? null : input.token_id,
      ip: input.ip === undefined ? null : input.ip,
      user_agent: input.user_agent === undefined ? null : input.user_agent,
      detail: input.detail === undefined || input.detail === null ? {} : input.detail,
      at: nowIso(input)
    };
    return record;
  }

  // Create a fresh version in the draft state + its "created" event.
  function beginVersion(version, ctx) {
    version = version || {};
    if (isState(version.state)) return { ok: false, code: "already_started", detail: `This version is already in the ${version.state} state.` };
    ctx = ctx || {};
    const at = nowIso(ctx);
    const next = Object.assign({}, version, { state: INITIAL_STATE, created_at: version.created_at || at });
    const event = createEvent({
      quote_id: ctx.quote_id !== undefined ? ctx.quote_id : version.quote_id,
      version_id: ctx.version_id !== undefined ? ctx.version_id : version.id,
      event: CREATED_EVENT,
      actor_type: ctx.actor_type === undefined ? "internal" : ctx.actor_type,
      actor: ctx.actor,
      token_id: ctx.token_id,
      ip: ctx.ip,
      user_agent: ctx.user_agent,
      detail: ctx.detail,
      at
    });
    return { ok: true, state: INITIAL_STATE, version: next, event: CREATED_EVENT, record: event, terminal: false };
  }

  // Apply a transition to a version. Pure: returns a NEW version object.
  function apply(version, to, ctx) {
    version = version || {};
    ctx = ctx || {};
    const result = attempt(version.state, to, ctx);
    if (!result.ok) return result;
    const at = nowIso(ctx);
    const updates = { state: to };
    const stamp = TIMESTAMP_FIELD[to];
    if (stamp && version[stamp] === undefined) updates[stamp] = at;
    const next = Object.assign({}, version, updates);
    const event = createEvent({
      quote_id: ctx.quote_id !== undefined ? ctx.quote_id : version.quote_id,
      version_id: ctx.version_id !== undefined ? ctx.version_id : version.id,
      event: result.event,
      actor_type: ctx.actor_type === undefined ? "system" : ctx.actor_type,
      actor: ctx.actor,
      token_id: ctx.token_id,
      ip: ctx.ip,
      user_agent: ctx.user_agent,
      detail: ctx.detail,
      at
    });
    return { ok: true, from: result.from, state: to, to, event: result.event, terminal: result.terminal, version: next, record: event };
  }

  // Record a portal view. The state only changes on the FIRST view (sent →
  // viewed); later views still produce a "viewed" audit event.
  function noteView(version, ctx) {
    version = version || {};
    const state = version.state;
    if (state !== "sent" && state !== "viewed" && !isTerminal(state)) {
      return { ok: false, code: "not_sent", detail: `A version in ${state} cannot be viewed by a client.` };
    }
    if (state === "sent") {
      const res = apply(version, "viewed", ctx);
      if (res.ok) res.transitioned = true;
      return res;
    }
    const at = nowIso(ctx);
    const event = createEvent({
      quote_id: ctx && ctx.quote_id !== undefined ? ctx.quote_id : version.quote_id,
      version_id: ctx && ctx.version_id !== undefined ? ctx.version_id : version.id,
      event: "viewed",
      actor_type: ctx && ctx.actor_type !== undefined ? ctx.actor_type : "portal",
      actor: ctx && ctx.actor,
      token_id: ctx && ctx.token_id,
      ip: ctx && ctx.ip,
      user_agent: ctx && ctx.user_agent,
      detail: ctx && ctx.detail,
      at
    });
    return { ok: true, state, to: state, event: "viewed", version, record: event, transitioned: false };
  }

  // ------------------------------------------------------- server authority

  let serverValidator = null;

  function attachServerValidator(fn) {
    if (typeof fn !== "function") fail("bad_validator", "attachServerValidator expects a function.");
    serverValidator = fn;
    return true;
  }

  function detachServerValidator() {
    serverValidator = null;
  }

  // Validate + apply, consulting the authoritative server first when one is
  // attached. The server is the authority on EVERY transition: it may veto one
  // the client believed legal, and a client that believes a transition illegal
  // when the server allows it is refused (fail closed) as table drift.
  async function applyChecked(version, to, ctx) {
    version = version || {};
    const local = attempt(version.state, to, ctx);
    if (!serverValidator) {
      return local.ok ? Object.assign({}, local, { authority: "local" }) : local;
    }
    try {
      const request = { from: version.state, to, actor_type: ctx && ctx.actor_type, token_id: ctx && ctx.token_id };
      const remote = await serverValidator(request);
      if (!remote || typeof remote !== "object") throw new Error("unreadable server reply");
      if (remote.ok === false) {
        return { ok: false, code: remote.code || "server_refused", detail: remote.detail || "The server refused this transition.", authority: "server" };
      }
      if (!local.ok) {
        return { ok: false, code: local.code, detail: `${local.detail} (the server disagrees, so the client table has drifted)`, authority: "server", server: remote, server_disagrees: true };
      }
      if (remote.event && remote.event !== local.event) {
        return { ok: false, code: "server_disagrees", detail: `The server maps ${version.state} → ${to} to "${remote.event}", the client to "${local.event}".`, authority: "server" };
      }
      return Object.assign({}, local, { authority: "server", server: remote });
    } catch (err) {
      if (!local.ok) return local;
      return Object.assign({}, local, { authority: "local", degraded: true, degraded_reason: (err && err.message) || String(err) });
    }
  }

  // Compare a server-reported lifecycle table with this module's. Detects drift
  // between the public server copy and the client copy of the machine.
  function verifyAgainst(remote) {
    const diffs = [];
    if (!remote || typeof remote !== "object") return { ok: false, diffs: ["no server table"] };
    const remoteStates = Array.isArray(remote.states) ? remote.states.slice() : [];
    const missingStates = STATES.filter(s => remoteStates.indexOf(s) === -1);
    const extraStates = remoteStates.filter(s => STATES.indexOf(s) === -1);
    if (missingStates.length) diffs.push("server is missing states: " + missingStates.join(", "));
    if (extraStates.length) diffs.push("server has unknown states: " + extraStates.join(", "));
    const remoteTransitions = remote.transitions || {};
    for (const state of STATES) {
      const localTargets = TRANSITIONS[state] || {};
      const remoteTargets = remoteTransitions[state] || {};
      const localKeys = Object.keys(localTargets).sort();
      const remoteKeys = Object.keys(remoteTargets).sort();
      if (localKeys.join(",") !== remoteKeys.join(",")) {
        diffs.push(`${state}: targets differ (client ${localKeys.join("|") || "∅"} vs server ${remoteKeys.join("|") || "∅"})`);
        continue;
      }
      for (const target of localKeys) {
        if (localTargets[target] !== remoteTargets[target]) {
          diffs.push(`${state}→${target}: event differs (client ${localTargets[target]} vs server ${remoteTargets[target]})`);
        }
      }
    }
    const remoteTerminal = Array.isArray(remote.terminal)
      ? remote.terminal.slice()
      : Object.keys(remote.terminal || {}).filter(k => remote.terminal[k]);
    const localTerminal = TERMINAL_STATES.slice();
    if (localTerminal.slice().sort().join(",") !== remoteTerminal.slice().sort().join(",")) {
      diffs.push(`terminal states differ (client ${localTerminal.join("|")} vs server ${remoteTerminal.join("|")})`);
    }
    const remoteActors = Array.isArray(remote.actor_types) ? remote.actor_types : [];
    if (remoteActors.length && remoteActors.slice().sort().join(",") !== ACTOR_TYPES.slice().sort().join(",")) {
      diffs.push(`actor types differ (client ${ACTOR_TYPES.join("|")} vs server ${remoteActors.join("|")})`);
    }
    return { ok: diffs.length === 0, diffs };
  }

  window.QU_LIFECYCLE = {
    VERSION,
    STATES,
    INITIAL_STATE,
    TERMINAL_STATES,
    DEPRECATED_STATES,
    ACTOR_TYPES,
    TRANSITIONS,
    CREATED_EVENT,
    LifecycleError,
    isState,
    isTerminal,
    initialState: () => INITIAL_STATE,
    allowedFrom,
    canTransition,
    eventFor,
    assertTransition,
    attempt,
    createEvent,
    beginVersion,
    apply,
    noteView,
    attachServerValidator,
    detachServerValidator,
    hasServerValidator: () => !!serverValidator,
    getServerValidator: () => serverValidator,
    applyChecked,
    verifyAgainst
  };
})();
