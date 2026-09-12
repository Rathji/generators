import { classifyError } from "./documents.js";

export const OPENRPA_ROBOT_PRESENCE = ["online", "stale", "offline", "unknown"];
export const OPENRPA_STALE_AFTER_MS = 120000;
export const OPENRPA_OFFLINE_AFTER_MS = 600000;

export const OPENRPA_PRESENCE_LABELS = { online: "Online", stale: "Stale", offline: "Offline", unknown: "Unknown" };
export const OPENRPA_PRESENCE_TONES = { online: "ok", stale: "warn", offline: "fail", unknown: "" };

function toNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function invalid(code, message, context = {}) {
  return { ok: false, error: { kind: "validation", code, message, retryable: false, operation: context.operation || null, collection: context.collection || null } };
}

export function presenceFor(ageMs, { staleAfterMs = OPENRPA_STALE_AFTER_MS, offlineAfterMs = OPENRPA_OFFLINE_AFTER_MS } = {}) {
  if (ageMs == null || Number.isNaN(ageMs)) return "unknown";
  if (ageMs <= staleAfterMs) return "online";
  if (ageMs <= offlineAfterMs) return "stale";
  return "offline";
}

export function formatAge(ageMs) {
  if (ageMs == null || Number.isNaN(ageMs)) return "never seen";
  if (ageMs < 1000) return "just now";
  const seconds = Math.round(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function normalizeRobot(raw, { now = Date.now(), staleAfterMs = OPENRPA_STALE_AFTER_MS, offlineAfterMs = OPENRPA_OFFLINE_AFTER_MS } = {}) {
  const doc = raw && typeof raw === "object" ? raw : {};
  const lastSeen = doc.lastseen || doc.lastSeen || null;
  const parsed = lastSeen ? Date.parse(lastSeen) : NaN;
  const ageMs = Number.isNaN(parsed) ? null : Math.max(0, now - parsed);
  const presence = presenceFor(ageMs, { staleAfterMs, offlineAfterMs });
  const metrics = doc.metrics && typeof doc.metrics === "object" ? doc.metrics : {};
  return {
    id: doc._id || doc.id || null,
    name: doc.name || doc._id || "(unnamed robot)",
    hostname: doc.hostname || null,
    version: doc.version || null,
    os: doc.os || null,
    robotQueue: doc.robotqueue || doc.robotQueue || null,
    lastSeen,
    ageMs,
    ageLabel: formatAge(ageMs),
    presence,
    presenceLabel: OPENRPA_PRESENCE_LABELS[presence] || presence,
    tone: OPENRPA_PRESENCE_TONES[presence] || "",
    cpu: toNumber(metrics.cpu, null),
    memory: toNumber(metrics.memory, null),
    modified: doc._modified || null,
    raw: doc,
  };
}

export function createRobotRegistry({
  request = null,
  clock = () => Date.now(),
  staleAfterMs = OPENRPA_STALE_AFTER_MS,
  offlineAfterMs = OPENRPA_OFFLINE_AFTER_MS,
} = {}) {
  const counters = { refreshes: 0, heartbeats: 0, errors: 0 };
  let lastAt = null;

  const iso = () => new Date(clock()).toISOString();
  const call = (command, data) => (typeof request === "function" ? request(command, data) : Promise.reject(new Error("No OpenFlow connection is available.")));

  async function guarded(operation, context, task) {
    try {
      const result = await task();
      lastAt = iso();
      return result;
    } catch (error) {
      counters.errors += 1;
      return classifyError(error, { ...context, operation });
    }
  }

  function normalize(raw) {
    return normalizeRobot(raw, { now: clock(), staleAfterMs, offlineAfterMs });
  }

  async function list() {
    return guarded("listRobots", { collection: "openrpa_robot" }, async () => {
      const docs = await call("getmachines", {});
      counters.refreshes += 1;
      return { ok: true, robots: (Array.isArray(docs) ? docs : []).map(normalize) };
    });
  }

  async function get(id) {
    if (!id) return invalid("missing-id", "A robot id is required.", { operation: "getRobot", collection: "openrpa_robot" });
    const result = await list();
    if (!result.ok) return result;
    return { ok: true, robot: result.robots.find((robot) => robot.id === id || robot.name === id) || null };
  }

  async function heartbeat(id, { metrics = null } = {}) {
    if (!id) return invalid("missing-id", "A robot id is required.", { operation: "heartbeat", collection: "openrpa_robot" });
    return guarded("heartbeat", { collection: "openrpa_robot" }, async () => {
      await call("pushmetrics", { name: id, robotid: id, metrics: metrics || null, at: iso() });
      counters.heartbeats += 1;
      const result = await list();
      const robot = result.ok ? result.robots.find((entry) => entry.id === id || entry.name === id) || null : null;
      return { ok: true, robot, operation: "heartbeat" };
    });
  }

  async function heartbeatAll({ metricsFor = null } = {}) {
    const result = await list();
    if (!result.ok) return result;
    let sent = 0;
    for (const robot of result.robots) {
      const metrics = typeof metricsFor === "function" ? metricsFor(robot) : null;
      const beat = await heartbeat(robot.id, { metrics });
      if (beat.ok) sent += 1;
    }
    return { ok: true, sent, total: result.robots.length, operation: "heartbeatAll" };
  }

  function summarize(robots) {
    const list = Array.isArray(robots) ? robots : [];
    const counts = { online: 0, stale: 0, offline: 0, unknown: 0 };
    const versions = {};
    let oldest = null;
    for (const robot of list) {
      counts[robot.presence] = (counts[robot.presence] || 0) + 1;
      if (robot.version) versions[robot.version] = (versions[robot.version] || 0) + 1;
      if (robot.ageMs != null && (oldest == null || robot.ageMs > oldest)) oldest = robot.ageMs;
    }
    return { total: list.length, ...counts, versions, oldestAgeMs: oldest, oldestLabel: oldest == null ? null : formatAge(oldest) };
  }

  async function summary() {
    const result = await list();
    if (!result.ok) return result;
    return { ok: true, summary: summarize(result.robots), operation: "summary" };
  }

  function stats() {
    return { ...counters, lastAt, thresholds: { staleAfterMs, offlineAfterMs } };
  }

  function reset() {
    counters.refreshes = 0;
    counters.heartbeats = 0;
    counters.errors = 0;
    lastAt = null;
  }

  return {
    presenceStates: OPENRPA_ROBOT_PRESENCE,
    thresholds: { staleAfterMs, offlineAfterMs },
    list,
    get,
    heartbeat,
    heartbeatAll,
    summary,
    summarize,
    stats,
    reset,
  };
}
