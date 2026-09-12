// ============================================================================
// quote-u — idempotent side-effect outbox (roadmap task 30)
// ----------------------------------------------------------------------------
// Every external write quote-u performs on behalf of a decision (update the
// opportunity, write a note, create an invoice, write revenue lines) is queued
// as a JOB here rather than fired inline. The job's identity is its
// idempotency KEY — `version_id + ":" + action` — and uniqueness is enforced
// inside a revision-guarded read-check-append-save on the `outbox_jobs`
// document, so re-running an approval (or a retry after a partial failure)
// can never enqueue the same external write twice:
//
//   I5 — the outbox never performs the same external write twice.
//
// A job's life:
//
//   pending ──claim──▶ running ──complete──▶ done        (terminal, key consumed)
//                          │
//                          └──fail──▶ failed ──(backoff)──▶ (claimed again)
//
//   `failed` carries the attempt count, the last error and a `next_attempt_at`
//   backoff time; once attempts reach the cap the job is marked `terminal` and
//   stops being due. A job reaches `done` exactly once, and a claim on a `done`
//   job is refused, so a duplicate key cannot produce a second write even if a
//   caller re-enqueues it.
//
// The document lives in the same versioned store as everything else (durable,
// revision-guarded, append-friendly), so the job ledger is the persisted
// record. The interval worker (`start`/`stop`) is the driver; the server plugin
// can attach its own authoritative driver later through `runDue`, but the
// uniqueness constraint lives in the shared store either way.
// ============================================================================
window.QU_OUTBOX = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "outbox_jobs";
  const SEP = ":";
  const STATES = ["pending", "running", "done", "failed"];
  const DEFAULT_MAX_ATTEMPTS = 5;
  const DEFAULT_BASE_BACKOFF_MS = 2000;
  const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;
  const DEFAULT_STALE_RUNNING_MS = 5 * 60 * 1000;
  const DEFAULT_MAX_RETRIES = 4;

  function keyOf(versionId, action) {
    return String(versionId === undefined || versionId === null ? "" : versionId) + SEP + String(action === undefined || action === null ? "" : action);
  }

  function genId(rand) {
    return "job-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function ms(at, fallback) {
    if (at === undefined || at === null) return fallback === undefined ? Date.now() : fallback;
    if (typeof at === "number") return at;
    const t = Date.parse(at);
    return isNaN(t) ? (fallback === undefined ? Date.now() : fallback) : t;
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  class OutboxError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "OutboxError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new OutboxError(code, message, meta); }

  function clampText(v, max) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  // ---- pure assembly --------------------------------------------------------

  function collect(input, opts) {
    opts = opts || {};
    const violations = [];
    if (!isPlainObject(input)) {
      return { ok: false, violations: [{ field: null, code: "bad_job", detail: "An outbox job must be an object" }], record: null };
    }
    const versionId = input.version_id === undefined || input.version_id === null ? null : String(input.version_id);
    if (!versionId) violations.push({ field: "version_id", code: "version_required", detail: "An outbox job needs a version_id" });
    const action = clampText(input.action, 80);
    if (!action) violations.push({ field: "action", code: "action_required", detail: "An outbox job needs an action" });
    const quoteId = input.quote_id === undefined || input.quote_id === null ? null : String(input.quote_id);
    const key = input.key ? String(input.key) : keyOf(versionId || "", action || "");
    const record = {
      id: input.id || opts.id || genId(opts.rand),
      key,
      version_id: versionId,
      action: action || "",
      quote_id: quoteId,
      state: input.state === undefined || input.state === null ? "pending" : String(input.state),
      attempts: 0,
      last_error: null,
      next_attempt_at: null,
      terminal: false,
      payload: isPlainObject(input.payload) ? input.payload : (input.payload === undefined ? null : input.payload),
      result: null,
      created_at: clampText(input.created_at, 40) || nowIso(opts.clock),
      updated_at: null,
      started_at: null,
      completed_at: null
    };
    if (STATES.indexOf(record.state) === -1) violations.push({ field: "state", code: "bad_state", detail: `Unknown job state "${record.state}"` });
    return { ok: violations.length === 0, violations, record };
  }

  function validate(input, opts) { return collect(input, opts); }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (!out.ok) fail(out.violations[0].code, out.violations[0].detail, { violations: out.violations });
    return out.record;
  }

  // ---- pure state machine ---------------------------------------------------

  function backoffMs(attempts, opts) {
    opts = opts || {};
    const base = opts.baseBackoffMs === undefined ? DEFAULT_BASE_BACKOFF_MS : opts.baseBackoffMs;
    const cap = opts.maxBackoffMs === undefined ? DEFAULT_MAX_BACKOFF_MS : opts.maxBackoffMs;
    const n = Math.max(1, Math.floor(attempts || 1));
    const raw = base * Math.pow(2, n - 1);
    return Math.min(cap, Math.max(0, Math.round(raw)));
  }

  function isDue(job, now, opts) {
    opts = opts || {};
    if (!job || typeof job !== "object") return false;
    if (job.state === "done") return false;
    if (job.state === "pending") return true;
    if (job.state === "running") {
      const stale = opts.staleRunningMs === undefined ? DEFAULT_STALE_RUNNING_MS : opts.staleRunningMs;
      return ms(job.started_at, 0) + stale <= now;
    }
    if (job.state === "failed") {
      if (job.terminal === true) return false;
      const at = job.next_attempt_at;
      return at === null || at === undefined || ms(at, 0) <= now;
    }
    return false;
  }

  function dueJobs(records, now, opts) {
    const t = ms(now, Date.now());
    return (records || []).filter(j => isDue(j, t, opts));
  }

  // The pure I5 detector: no two jobs may share an idempotency key.
  function uniqueByKey(records) {
    const seen = Object.create(null);
    const duplicates = [];
    (records || []).forEach((j, i) => {
      if (!j || j.key === undefined || j.key === null) return;
      const k = String(j.key);
      if (seen[k] !== undefined) duplicates.push({ key: k, first: seen[k], second: i });
      else seen[k] = i;
    });
    return { ok: duplicates.length === 0, duplicates };
  }

  // Every job a completed approval can produce, keyed by version + action.
  function planForVersion(versionId, actions) {
    return (actions || []).map(action => ({ key: keyOf(versionId, action), version_id: versionId, action: action }));
  }

  function auditRecords(records) {
    const list = Array.isArray(records) ? records : [records];
    const violations = [];
    list.forEach((j, i) => {
      if (!isPlainObject(j)) { violations.push({ index: i, code: "bad_job", detail: "not an object" }); return; }
      if (STATES.indexOf(j.state) === -1) violations.push({ index: i, code: "bad_state", detail: `unknown state ${j.state}` });
      if (!j.key) violations.push({ index: i, code: "no_key", detail: "job has no idempotency key" });
      if (!Number.isInteger(j.attempts) || j.attempts < 0) violations.push({ index: i, code: "bad_attempts", detail: "attempts must be a non-negative integer" });
      if (j.state === "done" && !j.completed_at) violations.push({ index: i, code: "done_without_time", detail: "a done job needs completed_at" });
      if (j.state === "failed" && j.attempts < 1) violations.push({ index: i, code: "failed_without_attempt", detail: "a failed job needs at least one attempt" });
    });
    const uniq = uniqueByKey(list);
    uniq.duplicates.forEach(d => violations.push({ index: d.second, field: "key", code: "duplicate_key", detail: `key ${d.key} already exists` }));
    return { ok: violations.length === 0, violations, count: list.length, duplicates: uniq.duplicates };
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_OUTBOX needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const clock = opts.clock || null;
    const rand = opts.rand || null;
    const maxAttempts = opts.maxAttempts === undefined ? DEFAULT_MAX_ATTEMPTS : opts.maxAttempts;
    const baseBackoffMs = opts.baseBackoffMs === undefined ? DEFAULT_BASE_BACKOFF_MS : opts.baseBackoffMs;
    const maxBackoffMs = opts.maxBackoffMs === undefined ? DEFAULT_MAX_BACKOFF_MS : opts.maxBackoffMs;
    const staleRunningMs = opts.staleRunningMs === undefined ? DEFAULT_STALE_RUNNING_MS : opts.staleRunningMs;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;
    const handlers = Object.assign({}, opts.handlers || {});
    let timer = null;
    let inFlight = false;

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision, records: l.records };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "outbox_conflict", detail: `Could not write the ${doc} document after ${maxRetries + 1} attempts.` };
    }

    function registerHandler(action, fn) {
      if (!action || typeof fn !== "function") return false;
      handlers[String(action)] = fn;
      return true;
    }

    function hasHandler(action) { return typeof handlers[String(action)] === "function"; }

    // Enqueue a job, deduping by idempotency key. Re-enqueueing the same
    // version+action returns the EXISTING job and performs no second write
    // (invariant I5). The read-check-append happens under the document's
    // revision guard so a racing writer cannot create the duplicate.
    async function enqueue(input) {
      let built;
      try { built = normalize(input, { rand, clock: clock || undefined }); }
      catch (e) { return { ok: false, code: e.code || "bad_job", detail: e.message, violations: e.meta && e.meta.violations }; }
      let existing = null;
      const res = await mutate(records => {
        const found = records.find(j => j && String(j.key) === built.key);
        if (found) { existing = found; return null; }
        return records.concat([built]);
      });
      if (!res.ok) return res;
      if (existing) return { ok: true, deduped: true, job: existing, revision: res.revision };
      return { ok: true, job: built, revision: res.revision };
    }

    async function getByKey(key) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, job: l.records.find(j => j && String(j.key) === String(key)) || null, revision: l.revision };
    }

    async function get(id) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, job: l.records.find(j => j && j.id === id) || null, revision: l.revision };
    }

    async function list(filter) {
      const l = await load();
      if (!l.ok) return l;
      let recs = l.records.slice();
      if (filter) {
        if (filter.state !== undefined) recs = recs.filter(j => j.state === filter.state);
        if (filter.action !== undefined) recs = recs.filter(j => j.action === filter.action);
        if (filter.version_id !== undefined) recs = recs.filter(j => j.version_id === filter.version_id);
        if (filter.quote_id !== undefined) recs = recs.filter(j => j.quote_id === filter.quote_id);
        if (filter.limit !== undefined) recs = recs.slice(0, filter.limit);
      }
      return { ok: true, jobs: recs, total: l.records.length, revision: l.revision };
    }

    async function count() {
      const l = await load();
      return l.ok ? { ok: true, count: l.records.length, revision: l.revision } : l;
    }

    async function due(now) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, jobs: dueJobs(l.records, now, { staleRunningMs }), revision: l.revision };
    }

    // Claim a job for execution: pending|failed(stale-across-backoff)→running,
    // attempts+1. A done job (or one that is not yet due) is refused. A `running`
    // job is only reclaimed when it has gone stale (a crashed worker), so two
    // live workers cannot both run the same job.
    async function claim(id, now) {
      const t = ms(now, Date.now());
      let claimed = null;
      let refusal = null;
      const res = await mutate(records => records.map(j => {
        if (!j || j.id !== id) return j;
        if (j.state === "done") { refusal = { code: "already_done", detail: "This job has already completed." }; return j; }
        if (j.state === "running" && !isDue(j, t, { staleRunningMs })) { refusal = { code: "already_running", detail: "This job is already being run." }; return j; }
        if (j.state === "failed" && !isDue(j, t, { staleRunningMs })) { refusal = { code: "backoff", detail: `This job is waiting until ${j.next_attempt_at} before its next attempt.` }; return j; }
        claimed = Object.assign({}, j, { state: "running", attempts: (j.attempts || 0) + 1, started_at: nowIso(clock), updated_at: nowIso(clock) });
        return claimed;
      }));
      if (!res.ok) return res;
      if (refusal) return Object.assign({ ok: false }, refusal);
      if (!claimed) return { ok: false, code: "job_not_found", detail: `No outbox job ${id}.` };
      return { ok: true, job: claimed, revision: res.revision };
    }

    async function complete(id, result) {
      let done = null;
      const res = await mutate(records => records.map(j => {
        if (!j || j.id !== id) return j;
        done = Object.assign({}, j, { state: "done", result: result === undefined ? null : result, last_error: null, next_attempt_at: null, terminal: true, completed_at: nowIso(clock), updated_at: nowIso(clock) });
        return done;
      }));
      if (!res.ok) return res;
      if (!done) return { ok: false, code: "job_not_found", detail: `No outbox job ${id}.` };
      return { ok: true, job: done, revision: res.revision };
    }

    // Fail a job: record the error and schedule the next attempt with backoff.
    // Once the attempt cap is reached the job is terminal — it stays `failed`
    // with its last error, and is never due again.
    async function fail(id, error, ctx) {
      ctx = ctx || {};
      const now = nowIso(clock);
      const t = ms(ctx.now, Date.now());
      let failed = null;
      const res = await mutate(records => records.map(j => {
        if (!j || j.id !== id) return j;
        const attempts = j.attempts || 0;
        const terminal = ctx.terminal === true || attempts >= (ctx.maxAttempts === undefined ? maxAttempts : ctx.maxAttempts);
        const delay = terminal ? 0 : backoffMs(attempts, { baseBackoffMs, maxBackoffMs });
        failed = Object.assign({}, j, {
          state: "failed",
          terminal: terminal,
          last_error: clampText(error && error.detail ? error.detail : (error && error.message) || String(error), 500),
          next_attempt_at: terminal ? null : new Date(t + delay).toISOString(),
          updated_at: now
        });
        return failed;
      }));
      if (!res.ok) return res;
      if (!failed) return { ok: false, code: "job_not_found", detail: `No outbox job ${id}.` };
      return { ok: true, job: failed, revision: res.revision, retry_at: failed.next_attempt_at, terminal: failed.terminal };
    }

    // Run one due job through its registered handler. A done job is skipped
    // (never re-executed). A job with no handler fails terminally.
    async function runJob(id, ctx) {
      ctx = ctx || {};
      const g = await get(id);
      if (!g.ok) return g;
      if (!g.job) return { ok: false, code: "job_not_found", detail: `No outbox job ${id}.` };
      if (g.job.state === "done") return { ok: true, skipped: true, job: g.job, reason: "already_done" };
      const handler = handlers[g.job.action];
      if (typeof handler !== "function") {
        const f = await fail(id, { code: "no_handler", detail: `No handler is registered for action "${g.job.action}".` }, { terminal: true });
        return { ok: false, code: "no_handler", detail: `No handler is registered for action "${g.job.action}".`, job: f.job };
      }
      const c = await claim(id, ctx.now);
      if (!c.ok) return c;
      const job = c.job;
      let out;
      try {
        out = await handler({ job, service: api, ctx }, ctx);
      } catch (e) {
        out = { ok: false, code: (e && e.code) || "handler_threw", detail: (e && e.message) || String(e) };
      }
      if (out && out.ok === false) {
        const f = await fail(id, out, { now: ctx.now, maxAttempts: ctx.maxAttempts, terminal: out.terminal === true || out.policy === true });
        return { ok: false, code: out.code || "job_failed", detail: out.detail, job: f.job, retry_at: f.retry_at, terminal: f.terminal };
      }
      const done = await complete(id, out === undefined ? null : out);
      if (!done.ok) return done;
      return { ok: true, job: done.job, result: out === undefined ? null : out };
    }

    // The worker tick: reclaim stale running jobs, then run everything that is
    // due. Guarded so two interval ticks cannot overlap on the same service.
    async function runDue(ctx) {
      ctx = ctx || {};
      if (inFlight) return { ok: true, skipped: true, reason: "in_flight" };
      inFlight = true;
      try {
        const d = await due(ctx.now);
        if (!d.ok) return d;
        const ran = [];
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;
        for (const job of d.jobs) {
          const r = await runJob(job.id, ctx);
          ran.push({ id: job.id, key: job.key, action: job.action, ok: !!r.ok, code: r.code || null, skipped: !!r.skipped });
          if (r.skipped) skipped++;
          else if (r.ok) succeeded++;
          else failed++;
        }
        return { ok: true, ran, succeeded, failed, skipped, due: d.jobs.length };
      } finally {
        inFlight = false;
      }
    }

    // The interval driver (the client-side fallback worker; a server plugin can
    // call runDue on its own authoritative schedule instead).
    function start(ctx) {
      ctx = ctx || {};
      const intervalMs = ctx.intervalMs === undefined ? 5000 : ctx.intervalMs;
      if (timer) return { ok: true, already: true, intervalMs };
      if (typeof setInterval !== "function") return { ok: false, code: "no_timer", detail: "setInterval is not available in this environment." };
      timer = setInterval(() => { runDue(ctx).catch(() => null); }, intervalMs);
      if (timer && typeof timer.unref === "function") timer.unref();
      return { ok: true, running: true, intervalMs };
    }

    function stop() {
      if (!timer) return { ok: true, already: true };
      clearInterval(timer);
      timer = null;
      return { ok: true, running: false };
    }

    function isRunning() { return !!timer; }

    // Prove the ledger is coherent and I5 holds.
    async function verify() {
      const l = await load();
      if (!l.ok) return l;
      const out = auditRecords(l.records);
      out.revision = l.revision;
      return out;
    }

    function ready() {
      const p = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return p.then(() => ({ ok: true, doc }));
    }

    const api = {
      doc,
      ready,
      load,
      registerHandler,
      hasHandler,
      enqueue,
      get,
      getByKey,
      list,
      count,
      due,
      claim,
      complete,
      fail,
      runJob,
      runDue,
      start,
      stop,
      isRunning,
      verify
    };
    return api;
  }

  return {
    VERSION,
    DOC,
    SEP,
    STATES,
    DEFAULT_MAX_ATTEMPTS,
    DEFAULT_BASE_BACKOFF_MS,
    DEFAULT_MAX_BACKOFF_MS,
    OutboxError,
    keyOf,
    genId,
    validate,
    normalize,
    backoffMs,
    isDue,
    dueJobs,
    uniqueByKey,
    planForVersion,
    auditRecords,
    createService
  };
})();
