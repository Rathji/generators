import { hash36 } from "../ids.js";
import { classifyError } from "./documents.js";

export const OPENRPA_INVOCATION_STATES = ["pending", "success", "failed", "timeout", "cancelled"];
export const OPENRPA_INVOCATION_TERMINAL = ["success", "failed", "timeout", "cancelled"];
export const DEFAULT_INVOKE_TIMEOUT_MS = 15000;

export const OPENRPA_INVOCATION_LABELS = {
  pending: "Pending",
  success: "Completed",
  failed: "Failed",
  timeout: "Timed out",
  cancelled: "Cancelled",
};

export const OPENRPA_INVOCATION_TONES = {
  pending: "warn",
  success: "ok",
  failed: "fail",
  timeout: "fail",
  cancelled: "warn",
};

export function isTerminalInvocation(state) {
  return OPENRPA_INVOCATION_TERMINAL.includes(state);
}

export function makeCorrelationId(seed = "") {
  return `wf_${hash36(`${seed}|${Date.now()}|${Math.random()}`)}`;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function invalid(code, message, context = {}) {
  return {
    ok: false,
    error: {
      kind: "validation",
      code,
      message,
      retryable: false,
      operation: context.operation || "invoke",
      collection: null,
    },
  };
}

export function normalizeState(value) {
  const state = value == null ? "" : String(value).toLowerCase();
  if (state === "succeeded" || state === "complete" || state === "completed" || state === "success") return "success";
  if (state === "error" || state === "failed" || state === "failure" || state === "faulted") return "failed";
  if (state === "canceled" || state === "cancelled") return "cancelled";
  if (state === "timeout" || state === "timedout") return "timeout";
  return "pending";
}

export function normalizeInvocation(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const state = normalizeState(source.state);
  const payload = isPlainObject(source.payload) ? source.payload : isPlainObject(source.inputs) ? source.inputs : {};
  return {
    correlationId: source.correlationId || source.correlationid || null,
    workflowId: source.workflowId || source.workflowid || null,
    queue: source.queue || null,
    instanceId: source.instanceId || source.instanceid || null,
    state,
    stateLabel: OPENRPA_INVOCATION_LABELS[state] || state,
    tone: OPENRPA_INVOCATION_TONES[state] || "",
    terminal: isTerminalInvocation(state),
    actor: source.actor || null,
    payload,
    result: source.result !== undefined ? source.result : null,
    error: source.error != null ? String(source.error) : source.errorMessage != null ? String(source.errorMessage) : null,
    invokedAt: source.invokedAt || source.startedAt || null,
    completedAt: source.completedAt || source.finishedAt || null,
    durationMs: toNumber(source.durationMs, null),
    serverDurationMs: toNumber(source.serverDurationMs, null),
    waited: source.waited !== false,
    detail: source.detail != null ? source.detail : null,
  };
}

export function createInvocationService({
  request = null,
  onCommand = null,
  clock = () => Date.now(),
  emit = null,
  replyTimeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
  dispatchTimeoutMs = 12000,
  historyLimit = 100,
} = {}) {
  const pending = new Map();
  const history = [];
  const counters = { invoked: 0, completed: 0, failed: 0, timeouts: 0, cancelled: 0, errors: 0, unsolicited: 0 };
  let lastAt = null;

  const iso = () => new Date(clock()).toISOString();
  const call = (command, data, options) => (typeof request === "function" ? request(command, data, options) : Promise.reject(new Error("No OpenFlow connection is available.")));

  function remember(record) {
    history.unshift(record);
    if (history.length > historyLimit) history.length = historyLimit;
    return record;
  }

  function findRecord(correlationId) {
    if (!correlationId) return null;
    const entry = pending.get(correlationId);
    if (entry) return entry.record;
    return history.find((record) => record.correlationId === correlationId) || null;
  }

  async function emitEvent(type, payload) {
    if (typeof emit !== "function") return null;
    try {
      return await emit(type, payload, { source: "openrpa", subject: { entityType: "workflow", entityId: payload && payload.correlationId ? payload.correlationId : null } });
    } catch (error) {
      return null;
    }
  }

  function noteResult(record) {
    if (record.state === "success") counters.completed += 1;
    else if (record.state === "failed") counters.failed += 1;
    else if (record.state === "timeout") counters.timeouts += 1;
    else if (record.state === "cancelled") counters.cancelled += 1;
  }

  function finalize(record, patch) {
    Object.assign(record, patch);
    record.state = patch.state;
    record.stateLabel = OPENRPA_INVOCATION_LABELS[patch.state] || patch.state;
    record.tone = OPENRPA_INVOCATION_TONES[patch.state] || "";
    record.terminal = isTerminalInvocation(patch.state);
    lastAt = iso();
    return record;
  }

  async function handleServerCommand(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    const correlationId = data.correlationId || data.correlationid || null;
    const entry = correlationId ? pending.get(correlationId) : null;
    const state = normalizeState(data.state);
    const serverDurationMs = toNumber(data.durationMs, null);
    const result = data.result !== undefined ? data.result : null;
    const error = data.error != null ? String(data.error) : data.errorMessage != null ? String(data.errorMessage) : null;

    if (!entry) {
      const existing = findRecord(correlationId);
      if (existing) {
        existing.serverDurationMs = serverDurationMs;
        existing.detail = { ...(existing.detail || {}), late: true, ...data };
        return existing;
      }
      counters.unsolicited += 1;
      const record = normalizeInvocation({ ...data, correlationId, completedAt: data.completedAt || iso() });
      if (record.terminal) {
        remember(record);
        noteResult(record);
      }
      return record;
    }

    clearTimeout(entry.timer);
    pending.delete(correlationId);
    const record = entry.record;
    const completedAt = iso();
    const measured = Math.max(0, clock() - entry.startedAt);
    finalize(record, {
      state: state === "pending" ? "success" : state,
      result: state === "failed" ? null : result,
      error: state === "failed" ? error || "The workflow failed." : error,
      completedAt,
      durationMs: serverDurationMs != null ? serverDurationMs : measured,
      serverDurationMs,
      detail: { ...(record.detail || {}), ...data },
    });
    noteResult(record);
    if (record.state === "success") {
      await emitEvent("workflow.completed", {
        correlationId: record.correlationId,
        workflowId: record.workflowId,
        queue: record.queue,
        instanceId: record.instanceId,
        durationMs: record.durationMs != null ? record.durationMs : 0,
        result: isPlainObject(record.result) ? record.result : {},
      });
    } else {
      await emitEvent("workflow.failed", {
        correlationId: record.correlationId,
        workflowId: record.workflowId,
        queue: record.queue,
        instanceId: record.instanceId,
        durationMs: record.durationMs != null ? record.durationMs : 0,
        error: record.error || "The workflow failed.",
        detail: {},
      });
    }
    entry.resolve({ ok: true, invocation: record });
    return record;
  }

  if (typeof onCommand === "function") onCommand("workflowinstance", (data) => handleServerCommand(data));

  async function invoke(options = {}) {
    const input = options && typeof options === "object" ? options : {};
    const workflowId = input.workflowId || input.workflowid || null;
    const queue = input.queue || input.wiq || null;
    if (!workflowId && !queue) return invalid("missing-target", "Choose a workflow id or a queue to invoke.");
    const payload = input.payload == null ? {} : input.payload;
    if (!isPlainObject(payload)) return invalid("invalid-payload", "An invocation payload must be a JSON object.");
    const timeoutMs = Math.max(250, toNumber(input.timeoutMs, replyTimeoutMs));
    const correlationId = input.correlationId || makeCorrelationId(workflowId || queue);
    if (pending.has(correlationId)) return invalid("duplicate-correlation", `Correlation id "${correlationId}" is already awaiting a reply.`);

    const record = normalizeInvocation({
      correlationId,
      workflowId,
      queue,
      state: "pending",
      actor: input.actor || null,
      payload,
      invokedAt: iso(),
      waited: input.wait !== false,
    });
    remember(record);

    const entry = { correlationId, record, startedAt: clock(), timer: null, resolve: null };
    const promise = new Promise((resolve) => {
      entry.resolve = resolve;
      entry.timer = setTimeout(() => {
        if (!pending.has(correlationId)) return;
        pending.delete(correlationId);
        finalize(record, { state: "timeout", error: `The workflow did not complete within ${timeoutMs} ms.`, completedAt: iso(), durationMs: Math.max(0, clock() - entry.startedAt) });
        noteResult(record);
        emitEvent("workflow.failed", {
          correlationId,
          workflowId,
          queue,
          instanceId: record.instanceId,
          durationMs: record.durationMs != null ? record.durationMs : 0,
          error: record.error,
          detail: { timedOut: true },
        });
        resolve({ ok: true, invocation: record, timedOut: true });
      }, timeoutMs);
    });
    pending.set(correlationId, entry);
    counters.invoked += 1;

    await emitEvent("workflow.invoked", { correlationId, workflowId, queue, instanceId: null, actor: record.actor, payload });

    let dispatch;
    try {
      dispatch = await call(
        "createworkflowinstance",
        {
          workflowid: workflowId,
          queue,
          correlationId,
          payload,
          ...(input.simulateError ? { simulateError: true } : {}),
          ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
          ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
        },
        { timeoutMs: Math.min(timeoutMs, dispatchTimeoutMs), attempts: 1 }
      );
    } catch (error) {
      counters.errors += 1;
      clearTimeout(entry.timer);
      pending.delete(correlationId);
      finalize(record, { state: "failed", error: error && error.message ? error.message : String(error), completedAt: iso(), durationMs: Math.max(0, clock() - entry.startedAt) });
      noteResult(record);
      entry.resolve({ ok: false, invocation: record });
      const classified = classifyError(error, { operation: "invoke" });
      return { ...classified, correlationId, invocation: record };
    }

    if (record.state === "pending") {
      record.instanceId = (dispatch && dispatch.instanceId) || record.instanceId;
      record.durationEstimateMs = dispatch && dispatch.durationMs != null ? dispatch.durationMs : null;
      lastAt = iso();
    }
    if (input.wait === false) return { ok: true, invocation: record, awaiting: true };

    const outcome = await promise;
    return { ok: true, invocation: outcome.invocation, timedOut: !!outcome.timedOut };
  }

  async function cancel(correlationId, { reason = "Cancelled by an operator." } = {}) {
    if (!correlationId) return invalid("missing-id", "A correlation id is required.", { operation: "cancel" });
    const entry = pending.get(correlationId);
    if (!entry) {
      return {
        ok: false,
        error: { kind: "not-found", code: "not-pending", message: `No pending invocation has correlation id "${correlationId}".`, retryable: false, operation: "cancel", collection: null },
      };
    }
    clearTimeout(entry.timer);
    pending.delete(correlationId);
    finalize(entry.record, { state: "cancelled", error: reason, completedAt: iso(), durationMs: Math.max(0, clock() - entry.startedAt) });
    noteResult(entry.record);
    await emitEvent("workflow.failed", {
      correlationId,
      workflowId: entry.record.workflowId,
      queue: entry.record.queue,
      instanceId: entry.record.instanceId,
      durationMs: entry.record.durationMs != null ? entry.record.durationMs : 0,
      error: reason,
      detail: { cancelled: true },
    });
    entry.resolve({ ok: true, invocation: entry.record, cancelled: true });
    return { ok: true, invocation: entry.record };
  }

  function pendingList() {
    return Array.from(pending.values()).map((entry) => entry.record);
  }

  function historyList({ limit = null, state = null } = {}) {
    const filtered = state ? history.filter((record) => record.state === state) : history.slice();
    return limit != null ? filtered.slice(0, Math.max(0, limit)) : filtered;
  }

  function stats() {
    return { ...counters, pending: pending.size, history: history.length, lastAt };
  }

  function reset() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, invocation: entry.record, reset: true });
    }
    pending.clear();
    history.length = 0;
    counters.invoked = 0;
    counters.completed = 0;
    counters.failed = 0;
    counters.timeouts = 0;
    counters.cancelled = 0;
    counters.errors = 0;
    counters.unsolicited = 0;
    lastAt = null;
  }

  return {
    states: OPENRPA_INVOCATION_STATES,
    terminalStates: OPENRPA_INVOCATION_TERMINAL,
    invoke,
    cancel,
    handleServerCommand,
    pending: pendingList,
    history: historyList,
    get: findRecord,
    stats,
    reset,
  };
}
