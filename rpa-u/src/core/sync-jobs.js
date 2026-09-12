export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"];

function encode(value) {
  return String(value == null ? "" : value).replace(/\|/g, "%7C");
}

export function jobKey(kind, target = {}) {
  const parts = Object.keys(target || {})
    .filter((key) => target[key] != null && target[key] !== "")
    .sort()
    .map((key) => `${key}=${encode(target[key])}`);
  return [kind, ...parts].join("|");
}

export function isDeadLetter(job) {
  return !!job && job.status === "failed" && job.attempts >= job.maxAttempts;
}

export function createSyncJobRunner({
  db = null,
  collection = "jobs",
  effectsCollection = "effects",
  emit = null,
  clock = () => Date.now(),
  defaultMaxAttempts = 3,
  handlers = {},
} = {}) {
  const jobs = new Map();
  const effects = new Map();
  const registry = new Map();

  for (const [kind, handler] of Object.entries(handlers || {})) {
    if (typeof handler === "function") registry.set(kind, handler);
  }

  function iso(at = clock()) {
    return new Date(at).toISOString();
  }

  function persistJob(job) {
    if (!db) return Promise.resolve(job);
    return db.put(collection, job.key, job);
  }

  function persistEffect(record) {
    if (!db) return Promise.resolve(record);
    return db.put(effectsCollection, record.key, record);
  }

  async function hydrate() {
    if (!db) return { jobs: 0, effects: 0 };
    for (const stored of db.all(collection)) {
      if (!stored || !stored.key) continue;
      jobs.set(stored.key, stored);
    }
    for (const stored of db.all(effectsCollection)) {
      if (!stored || !stored.key) continue;
      effects.set(stored.key, stored);
    }
    return { jobs: jobs.size, effects: effects.size };
  }

  function register(kind, handler) {
    if (typeof handler !== "function") throw new Error("A job handler must be a function");
    registry.set(kind, handler);
    return kind;
  }

  function known(kind) {
    return registry.has(kind);
  }

  async function enqueue({ kind, target = {}, payload = {}, key = null, maxAttempts = defaultMaxAttempts, priority = 0, force = false, note = "" } = {}) {
    if (!registry.has(kind)) return { ok: false, error: `Unknown job kind "${kind}".`, job: null };
    const id = key || jobKey(kind, target);
    const now = iso();
    let job = jobs.get(id);

    if (job) {
      job.dedupeCount += 1;
      job.updatedAt = now;
      job.lastEnqueuedAt = now;
      if (note) job.note = note;
      if (job.status === "succeeded" && !force) {
        await persistJob(job);
        return { ok: true, job, deduped: true, skipped: true, reason: "already-succeeded" };
      }
      if (job.status === "running") {
        await persistJob(job);
        return { ok: true, job, deduped: true, skipped: true, reason: "already-running" };
      }
      if (job.status === "failed" || job.status === "cancelled") {
        job.status = "queued";
        job.error = null;
        job.finishedAt = null;
        await persistJob(job);
        return { ok: true, job, deduped: true, requeued: true };
      }
      await persistJob(job);
      return { ok: true, job, deduped: true, skipped: true, reason: "already-queued" };
    }

    job = {
      id,
      key: id,
      kind,
      target: { ...target },
      payload: { ...payload },
      status: "queued",
      priority,
      attempts: 0,
      maxAttempts,
      dedupeCount: 0,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      lastEnqueuedAt: now,
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      effect: null,
      lastRun: null,
      note,
    };
    jobs.set(id, job);
    await persistJob(job);
    return { ok: true, job, deduped: false };
  }

  async function applyOnce(effectKey, fn) {
    const existing = effects.get(effectKey);
    if (existing) {
      return { applied: false, cached: true, effectKey, result: existing.result, changes: existing.changes, at: existing.at };
    }
    const outcome = await fn();
    const record = {
      id: effectKey,
      key: effectKey,
      effectKey,
      result: outcome && typeof outcome === "object" && "result" in outcome ? outcome.result : outcome ?? null,
      changes: outcome && typeof outcome.changes === "number" ? outcome.changes : 0,
      at: iso(),
    };
    effects.set(effectKey, record);
    await persistEffect(record);
    return { applied: true, cached: false, effectKey, result: record.result, changes: record.changes, at: record.at };
  }

  function hasEffect(effectKey) {
    return effects.has(effectKey);
  }

  async function fail(job, error) {
    const message = error && error.message ? error.message : String(error);
    job.error = message;
    job.updatedAt = iso();
    const dead = job.attempts >= job.maxAttempts;
    job.status = dead ? "failed" : "queued";
    job.finishedAt = dead ? job.updatedAt : null;
    await persistJob(job);
    if (emit) {
      await emit(
        "sync.job",
        { jobId: job.key, kind: job.kind, status: dead ? "failed" : "retried", attempts: job.attempts, error: message.slice(0, 300) },
        { source: "ru", subject: subjectOf(job) }
      );
    }
    return { ok: false, job, error: message, dead, attempts: job.attempts };
  }

  function subjectOf(job) {
    const target = job.target || {};
    if (target.entityType && target.entityId) return { entityType: target.entityType, entityId: target.entityId };
    return null;
  }

  async function execute(key, { force = false } = {}) {
    const job = jobs.get(key);
    if (!job) return { ok: false, error: `Unknown job "${key}".`, job: null };
    if (job.status === "running") return { ok: false, error: "Job is already running.", job };
    if (job.status === "succeeded" && !force) return { ok: true, job, skipped: true, reused: true, applied: false, changes: 0 };

    const handler = registry.get(job.kind);
    if (!handler) return fail(job, new Error(`No handler registered for "${job.kind}".`));

    const started = clock();
    job.status = "running";
    job.startedAt = iso(started);
    job.attempts += 1;
    job.runCount += 1;
    job.updatedAt = job.startedAt;
    await persistJob(job);

    let outcome;
    let applied = true;
    try {
      if (force) {
        outcome = await handler(job);
      } else {
        const record = await applyOnce(job.key, () => handler(job));
        applied = record.applied;
        outcome = { result: record.result, changes: record.changes };
      }
    } catch (error) {
      return fail(job, error);
    }

    if (outcome && outcome.error) return fail(job, new Error(outcome.error));

    const changes = outcome && typeof outcome.changes === "number" ? outcome.changes : 0;
    const durationMs = Math.max(0, clock() - started);
    job.status = "succeeded";
    job.error = null;
    job.finishedAt = iso();
    job.updatedAt = job.finishedAt;
    job.result = outcome && "result" in outcome ? outcome.result : null;
    job.effect = { key: job.key, applied, at: job.finishedAt };
    job.lastRun = { at: job.finishedAt, applied, changes, durationMs, forced: !!force };
    await persistJob(job);

    if (emit) {
      await emit(
        "sync.job",
        { jobId: job.key, kind: job.kind, status: "succeeded", attempts: job.attempts, changes, durationMs, idempotent: !applied },
        { source: "ru", subject: subjectOf(job) }
      );
    }
    return { ok: true, job, applied, changes, durationMs, reused: !applied, forced: !!force };
  }

  function runnable() {
    return Array.from(jobs.values())
      .filter((job) => job.status === "queued")
      .sort((a, b) => (b.priority - a.priority) || String(a.createdAt).localeCompare(String(b.createdAt)) || a.key.localeCompare(b.key));
  }

  async function executeAll({ force = false, kinds = null, limit = Infinity } = {}) {
    const queue = runnable().filter((job) => !kinds || kinds.includes(job.kind)).slice(0, limit);
    const results = [];
    let succeeded = 0;
    let failed = 0;
    let reused = 0;
    for (const job of queue) {
      const result = await execute(job.key, { force });
      results.push(result);
      if (result.ok) succeeded += 1;
      else failed += 1;
      if (result.reused) reused += 1;
    }
    return { attempted: queue.length, succeeded, failed, reused, results };
  }

  async function retry(key, { resetAttempts = true } = {}) {
    const job = jobs.get(key);
    if (!job) return { ok: false, error: `Unknown job "${key}".`, job: null };
    if (job.status === "running") return { ok: false, error: "Job is already running.", job };
    if (resetAttempts) job.attempts = 0;
    job.status = "queued";
    job.error = null;
    job.finishedAt = null;
    job.updatedAt = iso();
    await persistJob(job);
    return { ok: true, job };
  }

  async function cancel(key) {
    const job = jobs.get(key);
    if (!job) return false;
    if (job.status === "succeeded") return false;
    job.status = "cancelled";
    job.updatedAt = iso();
    await persistJob(job);
    return true;
  }

  async function remove(key) {
    const job = jobs.get(key);
    if (!job) return false;
    jobs.delete(key);
    if (db) await db.remove(collection, key);
    return true;
  }

  function get(key) {
    return jobs.get(key) || null;
  }

  function has(key) {
    return jobs.has(key);
  }

  function list({ status = null, kind = null } = {}) {
    return Array.from(jobs.values())
      .filter((job) => (!status || (Array.isArray(status) ? status.includes(job.status) : job.status === status)) && (!kind || job.kind === kind))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.key.localeCompare(b.key));
  }

  function deadLetters() {
    return list().filter(isDeadLetter);
  }

  function effectsList() {
    return Array.from(effects.values()).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  async function reset() {
    jobs.clear();
    effects.clear();
    if (db) {
      await db.clear(collection);
      await db.clear(effectsCollection);
    }
  }

  function stats() {
    const byStatus = {};
    const byKind = {};
    let attempts = 0;
    let dedupes = 0;
    let reuse = 0;
    for (const job of jobs.values()) {
      byStatus[job.status] = (byStatus[job.status] || 0) + 1;
      byKind[job.kind] = (byKind[job.kind] || 0) + 1;
      attempts += job.attempts || 0;
      dedupes += job.dedupeCount || 0;
      if (job.lastRun && job.lastRun.applied === false) reuse += 1;
    }
    const dead = deadLetters().length;
    return {
      total: jobs.size,
      byStatus,
      byKind,
      queued: byStatus.queued || 0,
      running: byStatus.running || 0,
      succeeded: byStatus.succeeded || 0,
      failed: byStatus.failed || 0,
      cancelled: byStatus.cancelled || 0,
      deadLetters: dead,
      attempts,
      dedupes,
      reuse,
      effects: effects.size,
      kinds: Array.from(registry.keys()),
    };
  }

  return {
    collection,
    effectsCollection,
    statuses: JOB_STATUSES,
    jobKey,
    register,
    known,
    kinds: () => Array.from(registry.keys()),
    enqueue,
    execute,
    executeAll,
    applyOnce,
    hasEffect,
    retry,
    cancel,
    remove,
    get,
    has,
    list,
    runnable,
    deadLetters,
    effectsList,
    hydrate,
    reset,
    stats,
  };
}
