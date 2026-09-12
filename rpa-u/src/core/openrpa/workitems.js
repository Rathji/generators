import { classifyError } from "./documents.js";

export const OPENRPA_WORK_STATES = ["new", "processing", "success", "failed", "abandoned"];
export const OPENRPA_TERMINAL_STATES = ["success", "failed", "abandoned"];
export const OPENRPA_PRIORITIES = ["low", "normal", "high"];

export const OPENRPA_STATE_TRANSITIONS = {
  new: ["processing", "abandoned"],
  processing: ["success", "failed", "new", "abandoned"],
  success: ["new"],
  failed: ["new", "processing", "abandoned"],
  abandoned: ["new"],
};

export const OPENRPA_STATE_LABELS = {
  new: "New",
  processing: "Processing",
  success: "Success",
  failed: "Failed",
  abandoned: "Abandoned",
};

export const OPENRPA_STATE_TONES = {
  new: "warn",
  processing: "",
  success: "ok",
  failed: "fail",
  abandoned: "warn",
};

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function invalid(code, message, context = {}) {
  return { ok: false, error: { kind: "validation", code, message, retryable: false, operation: context.operation || null, collection: context.collection || null } };
}

export function isTerminalState(state) {
  return OPENRPA_TERMINAL_STATES.includes(state);
}

export function canTransition(from, to) {
  return (OPENRPA_STATE_TRANSITIONS[from] || []).includes(to);
}

export function transition(state, to, context = {}) {
  if (!canTransition(state, to)) {
    return invalid("invalid-transition", `A ${state} item cannot move to ${to}.`, context);
  }
  return { ok: true, from: state, to };
}

export function parsePayloadText(text) {
  const source = text == null ? "" : String(text).trim();
  if (!source) return { ok: true, value: {}, text: "{}" };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: { code: "invalid-json", message: `The payload is not valid JSON: ${error.message}` } };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: { code: "invalid-payload", message: "A work-item payload must be a JSON object." } };
  }
  return { ok: true, value: parsed, text: JSON.stringify(parsed) };
}

export function serializePayload(value) {
  if (value == null) return "{}";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function normalizeQueue(raw) {
  const queue = raw && typeof raw === "object" ? raw : {};
  return {
    id: queue._id || queue.id || null,
    name: queue.name || queue._id || "(unnamed queue)",
    workflowId: queue.workflowid || queue.workflowId || null,
    robotQueue: queue.robotqueue || queue.robotQueue || null,
    amqpQueue: queue.amqpqueue || queue.amqpQueue || null,
    maxRetries: toNumber(queue.maxretries != null ? queue.maxretries : queue.maxRetries, 0),
    retryDelay: toNumber(queue.retrydelay != null ? queue.retrydelay : queue.retryDelay, 0),
    initialDelay: toNumber(queue.initialdelay != null ? queue.initialdelay : queue.initialDelay, 0),
    successQueueId: queue.success_wiqid || null,
    failedQueueId: queue.failed_wiqid || null,
    successRoute: queue.success_wiq || null,
    failedRoute: queue.failed_wiq || null,
    encrypt: !!queue.encrypt,
    created: queue._created || null,
    modified: queue._modified || null,
    version: toNumber(queue._version, 1),
    raw: queue,
  };
}

export function normalizeAttachment(raw) {
  const file = raw && typeof raw === "object" ? raw : {};
  const filename = file.filename || file.name || "(unnamed file)";
  return {
    id: file._id || file.id || null,
    name: file.name || filename,
    filename,
    contentType: file.contenttype || file.contentType || null,
    length: toNumber(file.length, 0),
    refId: file.refid || file.refId || null,
    ref: file.ref || null,
  };
}

function itemError(raw) {
  const message = raw.errormessage || raw.errorMessage || null;
  const source = raw.errorsource || raw.errorSource || null;
  const type = raw.errortype || raw.errorType || null;
  const present = !!(message || source || type);
  const business = !!((type && /business|rule/i.test(type)) || (message && /business rule/i.test(message)));
  return { present, message, source, type, business };
}

export function normalizeWorkItem(raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  const payloadText = typeof item.payload === "string" ? item.payload : serializePayload(item.payload);
  let payload = null;
  let payloadValid = false;
  let payloadError = null;
  try {
    const parsed = JSON.parse(payloadText || "{}");
    if (isPlainObject(parsed)) {
      payload = parsed;
      payloadValid = true;
    } else {
      payloadError = "The payload is not a JSON object.";
    }
  } catch (error) {
    payloadError = "The payload is not valid JSON.";
  }
  const state = OPENRPA_WORK_STATES.includes(item.state) ? item.state : "new";
  return {
    id: item._id || item.id || null,
    name: item.name || item._id || null,
    type: item._type || "workitem",
    queueId: item.wiqid || item.wiq || null,
    queue: item.wiq || item.wiqid || null,
    state,
    stateLabel: OPENRPA_STATE_LABELS[state] || state,
    terminal: isTerminalState(state),
    priority: OPENRPA_PRIORITIES.includes(item.priority) ? item.priority : "normal",
    retries: toNumber(item.retries, 0),
    maxRetries: item.maxretries != null ? toNumber(item.maxretries) : null,
    payload,
    payloadText,
    payloadValid,
    payloadError,
    files: Array.isArray(item.files) ? item.files.map(normalizeAttachment) : [],
    lastRun: item.lastrun || null,
    nextRun: item.nextrun || null,
    createdBy: item._createdby || item.username || null,
    created: item._created || null,
    modified: item._modified || null,
    version: toNumber(item._version, 1),
    error: itemError(item),
    routing: {
      successQueueId: item.success_wiqid || null,
      failedQueueId: item.failed_wiqid || null,
      successRoute: item.success_wiq || null,
      failedRoute: item.failed_wiq || null,
    },
    raw: item,
  };
}

export function classifyOutcome({ error = null, businessRule = false } = {}) {
  if (!error) return { outcome: "success", terminal: true, business: false, message: null };
  const message = error && error.message ? error.message : String(error);
  const type = error && (error.type || error.errortype) ? error.type || error.errortype : null;
  const business = !!businessRule || !!((type && /business|rule/i.test(type)) || /business rule/i.test(message));
  return { outcome: business ? "fail" : "retry", terminal: business, business, message };
}

export function retryBudget(queue, item = {}) {
  const maxRetries = queue ? queue.maxRetries : toNumber(item.maxRetries, 0);
  const retries = toNumber(item.retries, 0);
  const retryDelay = queue ? queue.retryDelay : toNumber(item.retryDelay, 0);
  return { maxRetries, retries, retryDelay, remaining: Math.max(0, maxRetries - retries), exhausted: retries >= maxRetries };
}

export function routeFor(queue, outcome) {
  if (!queue) return null;
  if (outcome === "success") {
    return queue.successQueueId ? { queueId: queue.successQueueId, route: queue.successRoute || "success" } : null;
  }
  return queue.failedQueueId ? { queueId: queue.failedQueueId, route: queue.failedRoute || "failed" } : null;
}

export function planCompletion(item, queue, { error = null, businessRule = false, now = Date.now() } = {}) {
  const classification = classifyOutcome({ error, businessRule });
  if (classification.outcome === "success") {
    return { ok: true, state: "success", retries: toNumber(item.retries, 0), nextRun: null, route: routeFor(queue, "success"), classification, requeued: false, exhausted: false };
  }
  const budget = retryBudget(queue, item);
  if (classification.outcome === "fail" || budget.exhausted) {
    return { ok: true, state: "failed", retries: budget.retries, nextRun: null, route: routeFor(queue, "failed"), classification, requeued: false, exhausted: budget.exhausted || classification.business };
  }
  return {
    ok: true,
    state: "new",
    retries: budget.retries + 1,
    nextRun: new Date(now + budget.retryDelay * 1000).toISOString(),
    route: null,
    classification,
    requeued: true,
    exhausted: false,
  };
}

export function validateEnqueueInput(input) {
  if (!isPlainObject(input)) return invalid("invalid-item", "A work item must be a JSON object.", { operation: "enqueue" });
  if (input.priority != null && !OPENRPA_PRIORITIES.includes(input.priority)) {
    return invalid("invalid-priority", `Priority must be one of ${OPENRPA_PRIORITIES.join(", ")}.`, { operation: "enqueue" });
  }
  let payloadText = "{}";
  if (input.payload != null) {
    if (typeof input.payload === "string") {
      const parsed = parsePayloadText(input.payload);
      if (!parsed.ok) return invalid(parsed.error.code, parsed.error.message, { operation: "enqueue" });
      payloadText = parsed.text;
    } else if (isPlainObject(input.payload)) {
      payloadText = JSON.stringify(input.payload);
    } else {
      return invalid("invalid-payload", "A work-item payload must be a JSON object.", { operation: "enqueue" });
    }
  }
  let nextRun = null;
  if (input.nextRun != null && input.nextRun !== "") {
    const ms = Date.parse(input.nextRun);
    if (Number.isNaN(ms)) return invalid("invalid-nextrun", "The next-run time is not a valid date.", { operation: "enqueue" });
    nextRun = new Date(ms).toISOString();
  }
  if (input.files != null && !Array.isArray(input.files)) {
    return invalid("invalid-files", "Attachments must be a list of file metadata records.", { operation: "enqueue" });
  }
  const item = {
    payload: payloadText,
    priority: input.priority || "normal",
    files: (input.files || []).map(normalizeAttachment),
    nextrun: nextRun,
  };
  if (input.name) item.name = input.name;
  if (input.maxRetries != null) item.maxretries = toNumber(input.maxRetries);
  return { ok: true, item };
}

function matchSearch(item, needle) {
  if (!needle) return true;
  const haystack = [item.id, item.name, item.queueId, item.state, item.priority, item.payloadText, item.error.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function createWorkItemService({ request, clock = () => Date.now() } = {}) {
  const counters = { claims: 0, enqueued: 0, completions: 0, retries: 0, deletions: 0, errors: 0 };
  let lastAt = null;

  const nowIso = () => new Date(clock()).toISOString();
  const call = (command, data) => (typeof request === "function" ? request(command, data) : Promise.reject(new Error("No OpenFlow connection is available.")));

  async function guarded(operation, context, task) {
    try {
      const result = await task();
      lastAt = nowIso();
      return result;
    } catch (error) {
      counters.errors += 1;
      return classifyError(error, { ...context, operation });
    }
  }

  async function rawQueues() {
    return call("query", { collection: "openrpa_queue", orderby: { name: 1 } });
  }

  async function listQueues() {
    return guarded("listQueues", { collection: "openrpa_queue" }, async () => {
      const docs = await rawQueues();
      return { ok: true, queues: (Array.isArray(docs) ? docs : []).map(normalizeQueue) };
    });
  }

  async function getQueue(id) {
    if (!id) return invalid("missing-id", "A queue id is required.", { operation: "getQueue", collection: "openrpa_queue" });
    return guarded("getQueue", { collection: "openrpa_queue" }, async () => {
      const docs = await call("query", { collection: "openrpa_queue", query: { _id: id }, top: 1 });
      return { ok: true, queue: docs[0] ? normalizeQueue(docs[0]) : null };
    });
  }

  async function createQueue(input) {
    if (!isPlainObject(input)) return invalid("invalid-queue", "A queue must be a JSON object.", { operation: "createQueue", collection: "openrpa_queue" });
    if (!input.name || !String(input.name).trim()) return invalid("missing-name", "A queue needs a name.", { operation: "createQueue", collection: "openrpa_queue" });
    return guarded("createQueue", { collection: "openrpa_queue" }, async () => {
      const item = { ...input, name: String(input.name).trim() };
      const created = await call("addworkitemqueue", { item });
      return { ok: true, queue: normalizeQueue(created), operation: "createQueue" };
    });
  }

  async function updateQueue(id, input) {
    if (!id) return invalid("missing-id", "A queue id is required.", { operation: "updateQueue", collection: "openrpa_queue" });
    if (!isPlainObject(input)) return invalid("invalid-queue", "A queue update must be a JSON object.", { operation: "updateQueue", collection: "openrpa_queue" });
    return guarded("updateQueue", { collection: "openrpa_queue" }, async () => {
      const item = { ...input, _id: id };
      const updated = await call("updateworkitemqueue", { item });
      return { ok: true, queue: normalizeQueue(updated), operation: "updateQueue" };
    });
  }

  async function purgeQueue(id, { states = null } = {}) {
    return guarded("purgeQueue", { collection: "openrpa_workitem" }, async () => {
      const docs = await call("query", { collection: "openrpa_workitem", query: { wiqid: id }, projection: ["_id", "state"] });
      const targets = (Array.isArray(docs) ? docs : []).filter((doc) => !states || states.includes(doc.state));
      if (!targets.length) return { ok: true, purged: 0, operation: "purgeQueue" };
      const result = await call("deletemany", { collection: "openrpa_workitem", ids: targets.map((doc) => doc._id) });
      counters.deletions += targets.length;
      return { ok: true, purged: (result && result.deleted) || targets.length, operation: "purgeQueue" };
    });
  }

  async function deleteQueue(id, { purge = false } = {}) {
    if (!id) return invalid("missing-id", "A queue id is required.", { operation: "deleteQueue", collection: "openrpa_queue" });
    return guarded("deleteQueue", { collection: "openrpa_queue" }, async () => {
      let purged = 0;
      if (purge) {
        const purgeResult = await purgeQueue(id);
        purged = purgeResult.purged || 0;
      }
      const result = await call("deleteworkitemqueue", { id });
      counters.deletions += (result && result.deleted) || 0;
      return { ok: true, deleted: (result && result.deleted) || 0, purged, operation: "deleteQueue" };
    });
  }

  async function enqueue(queueId, input) {
    const validated = validateEnqueueInput(input);
    if (!validated.ok) return validated;
    if (!queueId) return invalid("missing-queue", "Choose a queue to enqueue into.", { operation: "enqueue", collection: "openrpa_workitem" });
    const queueResult = await getQueue(queueId);
    if (queueResult.ok && !queueResult.queue) return invalid("queue-not-found", `No queue "${queueId}" exists.`, { operation: "enqueue", collection: "openrpa_workitem" });
    return guarded("enqueue", { collection: "openrpa_workitem" }, async () => {
      const item = { ...validated.item, wiqid: queueId, wiq: queueResult.queue ? queueResult.queue.amqpQueue || queueId : queueId, state: "new", retries: 0 };
      const created = await call("addworkitem", { item });
      counters.enqueued += 1;
      return { ok: true, item: normalizeWorkItem(created), operation: "enqueue" };
    });
  }

  async function enqueueMany(queueId, inputs) {
    if (!Array.isArray(inputs) || !inputs.length) return invalid("empty-batch", "A bulk enqueue needs a non-empty array of work items.", { operation: "enqueueMany", collection: "openrpa_workitem" });
    const results = [];
    let inserted = 0;
    for (let index = 0; index < inputs.length; index += 1) {
      const result = await enqueue(queueId, inputs[index]);
      if (result.ok) inserted += 1;
      results.push(result.ok ? { ok: true, index, item: result.item } : { ok: false, index, error: result.error });
    }
    return { ok: true, inserted, failed: results.length - inserted, results, operation: "enqueueMany" };
  }

  async function claim(queueId, { worker = null } = {}) {
    if (!queueId) return invalid("missing-queue", "Choose a queue to claim from.", { operation: "claim", collection: "openrpa_workitem" });
    return guarded("claim", { collection: "openrpa_workitem" }, async () => {
      const result = await call("popworkitem", { wiq: queueId, wiqid: queueId, username: worker, at: nowIso() });
      const item = result && result.item ? normalizeWorkItem(result.item) : null;
      if (item) counters.claims += 1;
      return { ok: true, item, claimed: !!item, operation: "claim" };
    });
  }

  async function claimMany(queueId, count = 1) {
    const wanted = Math.max(1, Math.trunc(toNumber(count, 1)));
    const items = [];
    for (let index = 0; index < wanted; index += 1) {
      const result = await claim(queueId);
      if (!result.ok || !result.item) break;
      items.push(result.item);
    }
    return { ok: true, items, claimed: items.length, operation: "claimMany" };
  }

  async function patchItem(id, patch) {
    return guarded("updateItem", { collection: "openrpa_workitem" }, async () => {
      const updated = await call("updateworkitem", { item: { _id: id, ...patch } });
      return { ok: true, item: normalizeWorkItem(updated), operation: "updateItem" };
    });
  }

  async function complete(item, { error = null, businessRule = false, result = null } = {}) {
    if (!item || !item.id) return invalid("missing-item", "A work item is required.", { operation: "complete", collection: "openrpa_workitem" });
    const queueResult = await getQueue(item.queueId);
    const queue = queueResult.ok ? queueResult.queue : null;
    const plan = planCompletion(item, queue, { error, businessRule, now: clock() });
    if (plan.requeued) counters.retries += 1;
    counters.completions += 1;
    const patch = { state: plan.state, retries: plan.retries, nextrun: plan.nextRun, lastrun: nowIso() };
    if (error) {
      patch.errormessage = error.message || String(error);
      patch.errorsource = error.source || queue?.workflowId || null;
      patch.errortype = error.type || null;
    } else {
      patch.errormessage = null;
      patch.errorsource = null;
      patch.errortype = null;
    }
    if (plan.ok && plan.state === "success") {
      patch.success_wiq = plan.route ? plan.route.route : null;
      patch.success_wiqid = plan.route ? plan.route.queueId : null;
    }
    if (plan.ok && plan.state === "failed") {
      patch.failed_wiq = plan.route ? plan.route.route : null;
      patch.failed_wiqid = plan.route ? plan.route.queueId : null;
    }
    if (result !== null) patch.result = result;
    if (plan.route && plan.route.queueId) {
      patch.wiqid = plan.route.queueId;
      patch.wiq = plan.route.route || item.queue;
    }
    const applied = await patchItem(item.id, patch);
    if (!applied.ok) return applied;
    return { ok: true, item: applied.item, outcome: plan.classification.outcome, state: plan.state, requeued: plan.requeued, routed: !!plan.route, route: plan.route, exhausted: plan.exhausted, operation: "complete" };
  }

  async function setState(item, to, { reason = null } = {}) {
    if (!item || !item.id) return invalid("missing-item", "A work item is required.", { operation: "setState", collection: "openrpa_workitem" });
    const check = transition(item.state, to, { operation: "setState" });
    if (!check.ok) return check;
    const patch = { state: to };
    if (to === "new") patch.nextrun = nowIso();
    if (to === "abandoned" && reason) patch.errormessage = reason;
    const applied = await patchItem(item.id, patch);
    if (!applied.ok) return applied;
    return { ok: true, item: applied.item, from: item.state, to, operation: "setState" };
  }

  async function retry(item) {
    if (!item || !item.id) return invalid("missing-item", "A work item is required.", { operation: "retry", collection: "openrpa_workitem" });
    if (item.state === "new") return invalid("already-pending", "That item is already pending.", { operation: "retry", collection: "openrpa_workitem" });
    const patch = { state: "new", nextrun: nowIso() };
    const applied = await patchItem(item.id, patch);
    if (!applied.ok) return applied;
    counters.retries += 1;
    return { ok: true, item: applied.item, operation: "retry" };
  }

  async function requeue(item) {
    if (!item || !item.id) return invalid("missing-item", "A work item is required.", { operation: "requeue", collection: "openrpa_workitem" });
    const patch = { state: "new", nextrun: nowIso(), retries: 0, errormessage: null, errorsource: null, errortype: null };
    const applied = await patchItem(item.id, patch);
    if (!applied.ok) return applied;
    return { ok: true, item: applied.item, operation: "requeue" };
  }

  async function cancel(item, { reason = null } = {}) {
    return setState(item, "abandoned", { reason: reason || "Cancelled by an operator." });
  }

  async function updateItem(item, patch) {
    if (!item || !item.id) return invalid("missing-item", "A work item is required.", { operation: "updateItem", collection: "openrpa_workitem" });
    if (!isPlainObject(patch)) return invalid("invalid-patch", "An item update must be a JSON object.", { operation: "updateItem", collection: "openrpa_workitem" });
    if (patch.priority != null && !OPENRPA_PRIORITIES.includes(patch.priority)) return invalid("invalid-priority", `Priority must be one of ${OPENRPA_PRIORITIES.join(", ")}.`, { operation: "updateItem", collection: "openrpa_workitem" });
    if (patch.payload != null) {
      const serialized = serializePayload(patch.payload);
      const parsed = parsePayloadText(serialized);
      if (!parsed.ok) return invalid(parsed.error.code, parsed.error.message, { operation: "updateItem", collection: "openrpa_workitem" });
      patch = { ...patch, payload: parsed.text };
    }
    return patchItem(item.id, patch);
  }

  async function deleteItem(id) {
    if (!id) return invalid("missing-id", "A work item id is required.", { operation: "delete", collection: "openrpa_workitem" });
    return guarded("delete", { collection: "openrpa_workitem" }, async () => {
      const result = await call("deleteworkitem", { id });
      const deleted = (result && result.deleted) || 0;
      counters.deletions += deleted;
      return { ok: true, deleted, operation: "delete" };
    });
  }

  async function deleteMany(ids) {
    if (!Array.isArray(ids) || !ids.length) return invalid("empty-batch", "A bulk delete needs a non-empty array of ids.", { operation: "deleteMany", collection: "openrpa_workitem" });
    return guarded("deleteMany", { collection: "openrpa_workitem" }, async () => {
      const result = await call("deletemany", { collection: "openrpa_workitem", ids });
      const deleted = (result && result.deleted) || ids.length;
      counters.deletions += deleted;
      return { ok: true, deleted, operation: "deleteMany" };
    });
  }

  async function get(id) {
    if (!id) return invalid("missing-id", "A work item id is required.", { operation: "get", collection: "openrpa_workitem" });
    return guarded("get", { collection: "openrpa_workitem" }, async () => {
      const docs = await call("query", { collection: "openrpa_workitem", query: { _id: id }, top: 1 });
      return { ok: true, item: docs[0] ? normalizeWorkItem(docs[0]) : null };
    });
  }

  async function queryItems({ queueId = null, state = null, priority = null, search = "" } = {}) {
    return guarded("query", { collection: "openrpa_workitem" }, async () => {
      const query = {};
      if (queueId) query.wiqid = queueId;
      if (state) query.state = state;
      if (priority) query.priority = priority;
      const docs = await call("query", { collection: "openrpa_workitem", query, orderby: { _created: -1 } });
      const needle = search ? String(search).trim().toLowerCase() : "";
      return { ok: true, items: (Array.isArray(docs) ? docs : []).map(normalizeWorkItem).filter((item) => matchSearch(item, needle)) };
    });
  }

  async function countsFor(queueId = null) {
    const result = await queryItems({ queueId });
    if (!result.ok) return { ok: false, error: result.error };
    const counts = {};
    for (const state of OPENRPA_WORK_STATES) counts[state] = 0;
    for (const item of result.items) counts[item.state] = (counts[item.state] || 0) + 1;
    return { ok: true, counts, total: result.items.length };
  }

  async function board({ page = 1, pageSize = 15, ...filters } = {}) {
    const countsResult = await countsFor(filters.queueId || null);
    if (!countsResult.ok) return countsResult;
    const result = await queryItems(filters);
    if (!result.ok) return result;
    const total = result.items.length;
    const size = Math.max(1, Math.trunc(toNumber(pageSize, 15)));
    const pageCount = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(1, Math.trunc(toNumber(page, 1))), pageCount);
    const items = result.items.slice((current - 1) * size, current * size);
    return {
      ok: true,
      items,
      counts: countsResult.counts,
      totalScope: countsResult.total,
      page: current,
      pageSize: size,
      pageCount,
      total,
      from: total === 0 ? 0 : (current - 1) * size + 1,
      to: Math.min(total, current * size),
      hasPrev: current > 1,
      hasNext: current < pageCount,
      operation: "board",
    };
  }

  async function queueOverview() {
    const queuesResult = await listQueues();
    if (!queuesResult.ok) return queuesResult;
    const itemsResult = await queryItems({});
    if (!itemsResult.ok) return itemsResult;
    const byQueue = {};
    for (const item of itemsResult.items) {
      const bucket = byQueue[item.queueId] || (byQueue[item.queueId] = { id: item.queueId, total: 0, new: 0, processing: 0, success: 0, failed: 0, abandoned: 0 });
      bucket.total += 1;
      bucket[item.state] = (bucket[item.state] || 0) + 1;
    }
    return {
      ok: true,
      queues: queuesResult.queues.map((queue) => ({ ...queue, counts: byQueue[queue.id] || { id: queue.id, total: 0, new: 0, processing: 0, success: 0, failed: 0, abandoned: 0 } })),
      orphans: Object.values(byQueue).filter((bucket) => !queuesResult.queues.some((queue) => queue.id === bucket.id)),
      total: itemsResult.items.length,
    };
  }

  function stats() {
    return { ...counters, lastAt };
  }

  function reset() {
    counters.claims = 0;
    counters.enqueued = 0;
    counters.completions = 0;
    counters.retries = 0;
    counters.deletions = 0;
    counters.errors = 0;
    lastAt = null;
  }

  return {
    states: OPENRPA_WORK_STATES,
    priorities: OPENRPA_PRIORITIES,
    listQueues,
    getQueue,
    createQueue,
    updateQueue,
    deleteQueue,
    purgeQueue,
    queueOverview,
    enqueue,
    enqueueMany,
    claim,
    claimMany,
    complete,
    setState,
    retry,
    requeue,
    cancel,
    updateItem,
    deleteItem,
    deleteMany,
    get,
    queryItems,
    countsFor,
    board,
    stats,
    reset,
  };
}
