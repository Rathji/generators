import { hash36 } from "./ids.js";
import { topicOf } from "./event-catalog.js";

export const MONITOR_STATUSES = ["up", "degraded", "down"];
export const HEARTBEAT_TRIGGERS = ["manual", "scheduled"];
export const ERROR_CATEGORIES = ["connectivity", "delivery", "validation", "sync"];
export const ERROR_SEVERITIES = ["error", "warning"];

export const DEFAULT_THRESHOLDS = { degradedMs: 600, downMs: 4000, degradeAtErrors: 2 };
export const DEFAULT_HEARTBEAT_MS = 15000;

const BASELINE_LATENCY = { "crm-u": 118, "psa-u": 205, "it-u": 262, "rmm-u": 92, iu: 3 };
const HASH_SPACE = Math.pow(36, 7);
const SEVERITY_RANK = { error: 2, warning: 1 };

export function fraction(seed) {
  return parseInt(hash36(seed), 36) / HASH_SPACE;
}

export function percentile(values, p) {
  if (!values || !values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function summarize(values) {
  const numbers = (values || []).filter((value) => Number.isFinite(value));
  if (!numbers.length) return null;
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return {
    count: numbers.length,
    min: Math.round(Math.min(...numbers)),
    max: Math.round(Math.max(...numbers)),
    avg: Math.round(total / numbers.length),
    p50: Math.round(percentile(numbers, 50)),
    p95: Math.round(percentile(numbers, 95)),
    last: Math.round(numbers[numbers.length - 1]),
    unit: "ms",
  };
}

export function defaultTransport({ connector, attempt, override = null }) {
  if (override) {
    return {
      ok: override.status !== "down",
      status: override.status,
      latencyMs: override.latencyMs != null ? override.latencyMs : null,
    };
  }
  const baseline = BASELINE_LATENCY[connector] || 150;
  const jitter = Math.round(fraction(`${connector}:${attempt}`) * 140);
  return { ok: true, latencyMs: baseline + jitter };
}

function cap(list, limit) {
  if (list.length > limit) list.splice(0, list.length - limit);
}

export function createMonitor({
  connectors = [],
  bus = null,
  log = null,
  db = null,
  collection = "monitor",
  emit = null,
  clock = () => Date.now(),
  transport = null,
  thresholds = DEFAULT_THRESHOLDS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  sampleLimit = 120,
  jobSampleLimit = 400,
  publishLimit = 600,
  errorLimit = 200,
} = {}) {
  const connectorList = (connectors || []).filter((entry) => entry && entry.id);
  const connectorById = new Map(connectorList.map((entry) => [entry.id, entry]));
  const members = connectorList.filter((entry) => !entry.hub);

  const health = new Map();
  const publishes = [];
  const jobSamples = [];
  const errors = [];
  const errorIndex = new Map();
  const overrides = new Map();

  let heartbeats = 0;
  let lastHeartbeatAt = null;
  let lastSweep = null;
  let observedSeq = 0;
  let timer = null;
  let intervalMs = heartbeatMs;

  const probe = transport || defaultTransport;

  function iso(at = clock()) {
    return new Date(at).toISOString();
  }

  function ensureRecord(connectorId) {
    let record = health.get(connectorId);
    if (!record) {
      const def = connectorById.get(connectorId) || { id: connectorId };
      record = {
        connector: connectorId,
        name: def.name || connectorId,
        status: "unknown",
        latencyMs: null,
        checkedAt: null,
        ok: null,
        error: null,
        attempts: 0,
        okCount: 0,
        badCount: 0,
        streak: 0,
        lastUpAt: null,
        lastChangeAt: null,
        samples: [],
      };
      health.set(connectorId, record);
    }
    return record;
  }

  function errorCount(connectorId) {
    let count = 0;
    for (const entry of errors) {
      if (entry.connector === connectorId || entry.source === connectorId) count += entry.count;
    }
    return count;
  }

  function resolveStatus(raw, latency, connectorId) {
    if (!raw || raw.ok === false) return "down";
    if (raw.status && MONITOR_STATUSES.includes(raw.status)) return raw.status;
    if (latency != null && latency >= thresholds.downMs) return "down";
    if ((latency != null && latency >= thresholds.degradedMs) || errorCount(connectorId) >= thresholds.degradeAtErrors) return "degraded";
    return "up";
  }

  async function probeOne(connectorId) {
    const def = connectorById.get(connectorId);
    if (!def) return null;
    const record = ensureRecord(connectorId);
    record.attempts += 1;
    const override = overrides.get(connectorId) || null;
    let raw;
    try {
      raw = await probe({ connector: connectorId, attempt: record.attempts, override, def });
    } catch (error) {
      raw = { ok: false, error: error && error.message ? error.message : String(error) };
    }
    const at = iso();
    const latency = raw && Number.isFinite(raw.latencyMs) ? Math.max(0, Math.round(raw.latencyMs)) : null;
    const status = resolveStatus(raw, latency, connectorId);
    const previous = record.status;
    record.status = status;
    record.latencyMs = latency;
    record.checkedAt = at;
    record.ok = !!(raw && raw.ok);
    record.error = raw && raw.error ? String(raw.error) : null;
    if (status === "up") {
      record.okCount += 1;
      record.streak = 0;
      record.lastUpAt = at;
    } else {
      record.badCount += 1;
      record.streak += 1;
    }
    if (latency != null) {
      record.samples.push(latency);
      cap(record.samples, sampleLimit);
    }
    const changed = previous !== status;
    if (changed) record.lastChangeAt = at;
    return {
      connector: connectorId,
      name: record.name,
      status,
      latencyMs: latency,
      checkedAt: at,
      ok: record.ok,
      error: record.error,
      changed,
      previousStatus: previous,
    };
  }

  async function heartbeat({ connectors: subset = null, announce = true, trigger = "manual", force = false } = {}) {
    const wanted = Array.isArray(subset) && subset.length ? subset.filter((id) => connectorById.has(id)) : members.map((entry) => entry.id);
    const started = clock();
    const results = [];
    for (const connectorId of wanted) {
      const sample = await probeOne(connectorId);
      if (sample) results.push(sample);
    }
    const at = iso();
    const latencies = results.map((sample) => sample.latencyMs).filter((value) => value != null);
    const summary = {
      at,
      trigger: HEARTBEAT_TRIGGERS.includes(trigger) ? trigger : "manual",
      probed: results.length,
      up: results.filter((sample) => sample.status === "up").length,
      degraded: results.filter((sample) => sample.status === "degraded").length,
      down: results.filter((sample) => sample.status === "down").length,
      changed: results.filter((sample) => sample.changed).length,
      averageLatencyMs: summarize(latencies)?.avg ?? null,
      durationMs: Math.max(0, clock() - started),
      results,
    };
    heartbeats += 1;
    lastHeartbeatAt = at;
    lastSweep = summary;

    if (announce && emit) {
      for (const sample of results) {
        if (!force && !sample.changed) continue;
        await emit(
          "connector.health",
          {
            connector: sample.connector,
            status: sample.status,
            ...(sample.latencyMs != null ? { latencyMs: sample.latencyMs } : {}),
            checkedAt: sample.checkedAt,
          },
          { source: "iu" }
        );
      }
      await emit(
        "monitor.heartbeat",
        {
          probed: summary.probed,
          up: summary.up,
          degraded: summary.degraded,
          down: summary.down,
          averageLatencyMs: summary.averageLatencyMs ?? 0,
          durationMs: summary.durationMs,
          trigger: summary.trigger,
        },
        { source: "iu" }
      );
    }
    await persistState();
    return summary;
  }

  function start({ intervalMs: every = intervalMs, announce = false } = {}) {
    if (timer) return { ok: false, error: "The monitor is already running." };
    if (typeof setInterval !== "function") return { ok: false, error: "Scheduling is unavailable." };
    intervalMs = Math.max(1000, Number(every) || heartbeatMs);
    timer = setInterval(() => {
      heartbeat({ announce, trigger: "scheduled" }).catch(() => {});
    }, intervalMs);
    return { ok: true, intervalMs };
  }

  function stop() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  }

  function recordPublish({ type = "event", ok = true, deliveries = null, durationMs = 0, at = null } = {}) {
    const list = Array.isArray(deliveries) ? deliveries : [];
    const failed = list.filter((delivery) => delivery && delivery.ok === false);
    publishes.push({
      type,
      topic: topicOf(type),
      ok: ok !== false,
      deliveries: Array.isArray(deliveries) ? list.length : Number(deliveries) || 0,
      failed: failed.length,
      durationMs: Math.max(0, Math.round(durationMs || 0)),
      at: at || iso(),
    });
    cap(publishes, publishLimit);
    if (ok === false) {
      recordError({
        key: `validation:${type}`,
        category: "validation",
        severity: "warning",
        title: `Rejected event "${type}"`,
        detail: "The event failed envelope or payload validation and was not persisted.",
        at,
      });
    }
    for (const delivery of failed) {
      recordError({
        key: `delivery:${delivery.subscriptionId || delivery.pattern || type}`,
        category: "delivery",
        severity: "error",
        title: `Subscriber ${delivery.pattern || delivery.subscriptionId || "unknown"} threw`,
        detail: `A subscriber failed while handling "${type}"${delivery.error ? `: ${delivery.error}` : "."}`,
        at,
      });
    }
  }

  function recordError({ key = null, category = "sync", severity = "warning", title, detail = "", at = null, source = "iu", connector = null, refs = [] } = {}) {
    if (!title) return null;
    const id = key || `${category}:${source}:${title}`;
    const when = at || iso();
    const existing = errorIndex.get(id);
    if (existing) {
      existing.count += 1;
      existing.lastAt = when;
      if (detail) existing.detail = detail;
      if (connector && !existing.connector) existing.connector = connector;
      return existing;
    }
    const entry = {
      id,
      category: ERROR_CATEGORIES.includes(category) ? category : "sync",
      severity: ERROR_SEVERITIES.includes(severity) ? severity : "warning",
      title,
      detail,
      source,
      connector,
      refs: Array.isArray(refs) ? refs : [],
      firstAt: when,
      lastAt: when,
      count: 1,
    };
    errors.push(entry);
    errorIndex.set(id, entry);
    while (errors.length > errorLimit) {
      const removed = errors.shift();
      if (removed) errorIndex.delete(removed.id);
    }
    return entry;
  }

  function processObservation(event) {
    if (!event || !event.type) return;
    const payload = event.payload || {};
    if (event.type === "sync.completed" || event.type === "sync.job") {
      if (Number.isFinite(payload.durationMs)) {
        jobSamples.push({
          kind: payload.kind || "sync",
          status: event.type === "sync.completed" ? "succeeded" : payload.status || "succeeded",
          durationMs: Math.max(0, Math.round(payload.durationMs)),
          connector: payload.connector || null,
          at: event.time,
        });
        cap(jobSamples, jobSampleLimit);
      }
      if (payload.status === "failed") {
        recordError({
          key: `job:${payload.jobId || event.id}`,
          category: "sync",
          severity: "error",
          source: event.source,
          connector: payload.connector || null,
          title: `Sync job "${payload.kind || "unknown"}" failed`,
          detail: payload.error || "The job exhausted its retries.",
          at: event.time,
          refs: payload.jobId ? [payload.jobId] : [],
        });
      } else if (payload.status === "retried") {
        recordError({
          key: `job:${payload.jobId || event.id}`,
          category: "sync",
          severity: "warning",
          source: event.source,
          connector: payload.connector || null,
          title: `Sync job "${payload.kind || "unknown"}" retried`,
          detail: payload.error || "The job will be attempted again.",
          at: event.time,
          refs: payload.jobId ? [payload.jobId] : [],
        });
      }
    } else if (event.type === "sync.failed") {
      recordError({
        key: `sync:${payload.jobId || event.id}`,
        category: "sync",
        severity: "error",
        source: event.source,
        connector: payload.connector || null,
        title: `Sync failed for ${payload.entityType || "a record"}`,
        detail: payload.error || "",
        at: event.time,
        refs: payload.jobId ? [payload.jobId] : [],
      });
    }
  }

  function observe(event) {
    if (event && Number.isFinite(event.seq) && event.seq > observedSeq) observedSeq = event.seq;
    processObservation(event);
  }

  async function catchUp() {
    if (!log) return 0;
    let processed = 0;
    for (const event of log.all()) {
      if (event && Number.isFinite(event.seq) && event.seq > observedSeq) {
        observedSeq = event.seq;
        processObservation(event);
        processed += 1;
      }
    }
    return processed;
  }

  if (bus && typeof bus.subscribe === "function") {
    bus.subscribe("sync.*", (event) => observe(event), { label: "monitor", connector: "iu", priority: -10 });
  }

  function connectorView(record) {
    const def = connectorById.get(record.connector) || {};
    const attempts = record.attempts || 0;
    return {
      id: record.connector,
      name: record.name || def.name || record.connector,
      label: def.label || "",
      accent: def.accent || "#64748b",
      entityTypes: def.entityTypes || [],
      status: record.status,
      latencyMs: record.latencyMs,
      checkedAt: record.checkedAt,
      error: record.error,
      attempts,
      okCount: record.okCount || 0,
      badCount: record.badCount || 0,
      streak: record.streak || 0,
      lastUpAt: record.lastUpAt,
      lastChangeAt: record.lastChangeAt,
      uptime: attempts ? Math.round(((record.okCount || 0) / attempts) * 100) : null,
      averageLatencyMs: summarize(record.samples)?.avg ?? null,
      errorCount: errorCount(record.connector),
    };
  }

  function connectorsView() {
    return members.map((def) => connectorView(ensureRecord(def.id)));
  }

  function summary() {
    const list = connectorsView();
    const up = list.filter((entry) => entry.status === "up").length;
    const degraded = list.filter((entry) => entry.status === "degraded").length;
    const down = list.filter((entry) => entry.status === "down").length;
    const known = list.filter((entry) => entry.status !== "unknown").length;
    return {
      total: list.length,
      known,
      up,
      degraded,
      down,
      unknown: list.length - known,
      availability: known ? Math.round((up / known) * 100) : null,
      averageLatencyMs: summarize(list.map((entry) => entry.latencyMs).filter((value) => value != null))?.avg ?? null,
      heartbeats,
      lastHeartbeatAt,
      running: !!timer,
      intervalMs,
      errors: errors.length,
      thresholds,
    };
  }

  function groupedSummaries(items, keyOf, valueOf) {
    const buckets = new Map();
    for (const item of items) {
      const key = keyOf(item);
      if (key == null) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(valueOf(item));
    }
    return Object.fromEntries(Array.from(buckets.entries()).map(([key, values]) => [key, summarize(values)]));
  }

  function latency() {
    return {
      bus: summarize(publishes.map((entry) => entry.durationMs)),
      busByTopic: groupedSummaries(publishes, (entry) => entry.topic, (entry) => entry.durationMs),
      jobs: summarize(jobSamples.map((entry) => entry.durationMs)),
      jobsByKind: groupedSummaries(jobSamples, (entry) => entry.kind, (entry) => entry.durationMs),
      probe: summarize(Array.from(health.values()).flatMap((record) => record.samples)),
      probeByConnector: Object.fromEntries(Array.from(health.entries()).map(([id, record]) => [id, summarize(record.samples)])),
      publishes: publishes.length,
      jobSamples: jobSamples.length,
    };
  }

  function errorsView({ category = null, severity = null, connector = null, limit = null } = {}) {
    const items = errors.map((entry) => ({ ...entry, derived: false }));
    for (const record of health.values()) {
      if (record.status === "up" || record.status === "unknown") continue;
      items.push({
        id: `connectivity:${record.connector}`,
        category: "connectivity",
        severity: record.status === "down" ? "error" : "warning",
        title: `${record.name} is ${record.status}`,
        detail: record.error || `Last probe returned ${record.latencyMs != null ? `${record.latencyMs} ms` : "no response"}.`,
        source: "iu",
        connector: record.connector,
        refs: [],
        firstAt: record.lastChangeAt || record.checkedAt,
        lastAt: record.checkedAt,
        count: record.streak || 1,
        derived: true,
      });
    }
    const filtered = items.filter(
      (entry) =>
        (!category || entry.category === category) &&
        (!severity || entry.severity === severity) &&
        (!connector || entry.connector === connector)
    );
    filtered.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || String(b.lastAt).localeCompare(String(a.lastAt)));
    const byCategory = {};
    const bySeverity = {};
    const byConnector = {};
    for (const entry of filtered) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.count;
      bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + entry.count;
      if (entry.connector) byConnector[entry.connector] = (byConnector[entry.connector] || 0) + entry.count;
    }
    return {
      total: filtered.reduce((sum, entry) => sum + entry.count, 0),
      entries: filtered.length,
      byCategory,
      bySeverity,
      byConnector,
      withErrors: filtered.filter((entry) => entry.severity === "error").length,
      items: limit != null ? filtered.slice(0, limit) : filtered,
    };
  }

  function injectIncident(connectorId, { status = "down", latencyMs = null } = {}) {
    if (!connectorById.has(connectorId)) return false;
    overrides.set(connectorId, { status: MONITOR_STATUSES.includes(status) ? status : "down", latencyMs });
    return true;
  }

  function clearIncident(connectorId) {
    return overrides.delete(connectorId);
  }

  function incidents() {
    return Array.from(overrides.entries()).map(([connector, override]) => ({ connector, ...override }));
  }

  function recordSyncFailure({ connector = null, title = "Simulated sync failure", detail = "", severity = "error" } = {}) {
    return recordError({ category: "sync", severity, connector, title, detail: detail || "Recorded from the monitor console." });
  }

  async function persistState() {
    if (!db) return;
    try {
      await db.put(collection, "health", { key: "health", entries: Array.from(health.values()) });
    } catch (error) {}
  }

  async function hydrate() {
    if (!db) return { health: 0, errors: 0 };
    for (const stored of db.all(collection)) {
      if (stored && stored.key === "health" && Array.isArray(stored.entries)) {
        for (const record of stored.entries) {
          if (record && record.connector) health.set(record.connector, record);
        }
      }
    }
    return { health: health.size, errors: errors.length };
  }

  async function reset() {
    stop();
    health.clear();
    publishes.length = 0;
    jobSamples.length = 0;
    errors.length = 0;
    errorIndex.clear();
    overrides.clear();
    heartbeats = 0;
    lastHeartbeatAt = null;
    lastSweep = null;
    observedSeq = 0;
    if (db) await db.clear(collection);
  }

  function stats() {
    const base = summary();
    return {
      ...base,
      byStatus: { up: base.up, degraded: base.degraded, down: base.down, unknown: base.unknown },
      publishes: publishes.length,
      jobSamples: jobSamples.length,
      errorEntries: errors.length,
      incidents: overrides.size,
      lastSweep: lastSweep ? { at: lastSweep.at, trigger: lastSweep.trigger, probed: lastSweep.probed, up: lastSweep.up, degraded: lastSweep.degraded, down: lastSweep.down, durationMs: lastSweep.durationMs } : null,
    };
  }

  return {
    collection,
    statuses: MONITOR_STATUSES,
    thresholds,
    probe: probeOne,
    heartbeat,
    start,
    stop,
    running: () => !!timer,
    intervalMs: () => intervalMs,
    recordPublish,
    recordError,
    recordSyncFailure,
    observe,
    catchUp,
    connectors: connectorsView,
    connector: (id) => (connectorById.has(id) ? connectorView(ensureRecord(id)) : null),
    samples: (id) => (health.get(id)?.samples || []).slice(),
    summary,
    stats,
    latency,
    errors: errorsView,
    injectIncident,
    clearIncident,
    incidents,
    hydrate,
    reset,
    lastSweep: () => lastSweep,
    overrides: incidents,
  };
}
