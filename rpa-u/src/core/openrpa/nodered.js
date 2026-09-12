import { classifyError } from "./documents.js";

export const OPENRPA_NODERED_STATES = ["running", "stopped", "error", "unknown"];

export const OPENRPA_NODERED_LABELS = { running: "Running", stopped: "Stopped", error: "Error", unknown: "Unknown" };
export const OPENRPA_NODERED_TONES = { running: "ok", stopped: "warn", error: "fail", unknown: "" };

function toNumber(value, fallback = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function invalid(code, message, context = {}) {
  return { ok: false, error: { kind: "validation", code, message, retryable: false, operation: context.operation || null, collection: "nodered" } };
}

export function normalizeInstance(raw, { connectorId = "openrpa" } = {}) {
  const doc = raw && typeof raw === "object" ? raw : {};
  const state = OPENRPA_NODERED_STATES.includes(doc.state) ? doc.state : "unknown";
  const linkedTo = doc.connectorId || doc.hub || null;
  return {
    id: doc._id || doc.id || null,
    name: doc.name || doc.instance || doc._id || "(unnamed instance)",
    instance: doc.instance || doc.name || null,
    url: doc.url || null,
    state,
    stateLabel: OPENRPA_NODERED_LABELS[state] || state,
    tone: OPENRPA_NODERED_TONES[state] || "",
    version: doc.version || null,
    docVersion: toNumber(doc._version, 1),
    connectorId: linkedTo,
    linked: !!linkedTo,
    linkedToExpected: linkedTo === connectorId,
    created: doc._created || null,
    modified: doc._modified || null,
    raw: doc,
  };
}

export function createNodeRedRegistry({ request = null, clock = () => Date.now(), connectorId = "openrpa" } = {}) {
  const counters = { listed: 0, ensured: 0, restarted: 0, removed: 0, linked: 0, errors: 0 };
  let lastAt = null;

  const iso = () => new Date(clock()).toISOString();
  const call = (command, data) => (typeof request === "function" ? request(command, data) : Promise.reject(new Error("No OpenFlow connection is available.")));

  async function guarded(operation, task) {
    try {
      const result = await task();
      lastAt = iso();
      return result;
    } catch (error) {
      counters.errors += 1;
      return classifyError(error, { operation, collection: "nodered" });
    }
  }

  function normalize(raw) {
    return normalizeInstance(raw, { connectorId });
  }

  async function list() {
    return guarded("listNodeRed", async () => {
      const docs = await call("query", { collection: "nodered", orderby: { name: 1 } });
      counters.listed += 1;
      return { ok: true, instances: (Array.isArray(docs) ? docs : []).map(normalize) };
    });
  }

  async function get(name) {
    if (!name) return invalid("missing-name", "A Node-RED instance name is required.", { operation: "getNodeRed" });
    const result = await list();
    if (!result.ok) return result;
    return { ok: true, instance: result.instances.find((entry) => entry.name === name || entry.instance === name || entry.id === name) || null };
  }

  async function ensure(name, { url = null } = {}) {
    if (!name || !String(name).trim()) return invalid("missing-name", "A Node-RED instance needs a name.", { operation: "ensureNodeRed" });
    return guarded("ensureNodeRed", async () => {
      const doc = await call("ensureNoderedInstance", { name: String(name).trim(), url: url || null });
      counters.ensured += 1;
      return { ok: true, instance: normalize(doc), created: true, operation: "ensureNodeRed" };
    });
  }

  async function restart(name) {
    if (!name) return invalid("missing-name", "A Node-RED instance name is required.", { operation: "restartNodeRed" });
    return guarded("restartNodeRed", async () => {
      const doc = await call("restartNoderedInstance", { name });
      counters.restarted += 1;
      return { ok: true, instance: normalize(doc), operation: "restartNodeRed" };
    });
  }

  async function remove(name) {
    if (!name) return invalid("missing-name", "A Node-RED instance name is required.", { operation: "deleteNodeRed" });
    return guarded("deleteNodeRed", async () => {
      const result = await call("deleteNoderedInstance", { name });
      const deleted = (result && result.deleted) || 0;
      counters.removed += deleted;
      return { ok: true, deleted, operation: "deleteNodeRed" };
    });
  }

  async function link(name, { connectorId: target = connectorId, linked = true } = {}) {
    if (!name) return invalid("missing-name", "A Node-RED instance name is required.", { operation: "linkNodeRed" });
    const found = await get(name);
    if (!found.ok) return found;
    if (!found.instance) return { ok: false, error: { kind: "not-found", code: "instance-not-found", message: `No Node-RED instance named "${name}".`, retryable: false, operation: "linkNodeRed", collection: "nodered" } };
    return guarded("linkNodeRed", async () => {
      const item = { _id: found.instance.id, _version: found.instance.docVersion, connectorId: linked ? target : null };
      const doc = await call("updateone", { collection: "nodered", item });
      counters.linked += 1;
      return { ok: true, instance: normalize(doc), operation: "linkNodeRed" };
    });
  }

  async function unlink(name) {
    return link(name, { linked: false });
  }

  async function links() {
    const result = await list();
    if (!result.ok) return result;
    return { ok: true, links: result.instances.filter((entry) => entry.linked).map((entry) => ({ name: entry.name, connectorId: entry.connectorId, id: entry.id })) };
  }

  function summarize(instances) {
    const list = Array.isArray(instances) ? instances : [];
    const counts = { running: 0, stopped: 0, error: 0, unknown: 0 };
    for (const entry of list) counts[entry.state] = (counts[entry.state] || 0) + 1;
    return { total: list.length, ...counts, linked: list.filter((entry) => entry.linked).length };
  }

  async function summary() {
    const result = await list();
    if (!result.ok) return result;
    return { ok: true, summary: summarize(result.instances), operation: "summary" };
  }

  function stats() {
    return { ...counters, lastAt };
  }

  function reset() {
    counters.listed = 0;
    counters.ensured = 0;
    counters.restarted = 0;
    counters.removed = 0;
    counters.linked = 0;
    counters.errors = 0;
    lastAt = null;
  }

  return {
    states: OPENRPA_NODERED_STATES,
    connectorId,
    list,
    get,
    ensure,
    restart,
    remove,
    link,
    unlink,
    links,
    summary,
    summarize,
    stats,
    reset,
  };
}
