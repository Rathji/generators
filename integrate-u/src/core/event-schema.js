import { EVENT_TYPES, EVENT_TYPE_MAP } from "./event-catalog.js";

const CONNECTOR_IDS = new Set(["crm-u", "psa-u", "it-u", "rmm-u", "iu"]);

function issue(level, code, path, message) {
  return { level, code, path, message };
}

function checkType(value, schema) {
  const expected = schema.type || "any";
  if (expected === "any") return true;
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === expected;
}

export function validateValue(value, schema = {}, path = "") {
  const issues = [];
  const at = path || "value";

  if (value == null) {
    if (schema.required) issues.push(issue("error", "required", at, `"${at}" is required.`));
    return issues;
  }

  if (!checkType(value, schema)) {
    issues.push(issue("error", "type", at, `"${at}" should be ${schema.type}, got ${Array.isArray(value) ? "array" : typeof value}.`));
    return issues;
  }

  if (schema.type === "string" || typeof value === "string") {
    if (schema.enum && !schema.enum.includes(value)) {
      issues.push(issue("error", "enum", at, `"${at}" must be one of: ${schema.enum.join(", ")}.`));
    }
    if (schema.minLength != null && value.length < schema.minLength) {
      issues.push(issue("error", "minLength", at, `"${at}" must be at least ${schema.minLength} characters.`));
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      issues.push(issue("error", "maxLength", at, `"${at}" must be at most ${schema.maxLength} characters.`));
    }
    if (schema.pattern) {
      const re = schema.pattern instanceof RegExp ? schema.pattern : new RegExp(schema.pattern);
      if (!re.test(value)) issues.push(issue("error", "pattern", at, `"${at}" does not match ${re}.`));
    }
  }

  if (typeof value === "number") {
    if (schema.min != null && value < schema.min) issues.push(issue("error", "min", at, `"${at}" must be >= ${schema.min}.`));
    if (schema.max != null && value > schema.max) issues.push(issue("error", "max", at, `"${at}" must be <= ${schema.max}.`));
    if (!Number.isFinite(value)) issues.push(issue("error", "finite", at, `"${at}" must be a finite number.`));
  }

  if (schema.type === "object") {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (value[key] == null) issues.push(issue("error", "required", path ? `${path}.${key}` : key, `"${key}" is required.`));
      }
    }
    for (const [key, fieldSchema] of Object.entries(schema.fields || {})) {
      issues.push(...validateValue(value[key], fieldSchema, path ? `${path}.${key}` : key));
    }
  }

  if (schema.type === "array" && schema.items) {
    value.forEach((item, index) => {
      issues.push(...validateValue(item, schema.items, `${at}[${index}]`));
    });
  }

  return issues;
}

export function validatePayload(type, payload) {
  const entry = EVENT_TYPE_MAP.get(type);
  if (!entry) return [issue("error", "unknown-type", "type", `Unknown event type "${type}".`)];
  return validateValue(payload, entry.payload, "payload");
}

export function validateEnvelope(envelope, { connectors = null } = {}) {
  const issues = [];
  const connectorsKnown = connectors ? new Set(connectors.map((c) => c.id)) : CONNECTOR_IDS;

  if (!envelope || typeof envelope !== "object") {
    return { ok: false, issues: [issue("error", "no-envelope", "", "An event envelope is required.")], counts: { error: 1, warn: 0, info: 0 } };
  }

  const required = ["id", "type", "version", "source", "time", "seq", "payload"];
  for (const key of required) {
    if (envelope[key] == null || envelope[key] === "") {
      issues.push(issue("error", "missing-field", key, `Envelope is missing "${key}".`));
    }
  }

  if (envelope.id != null && !/^ev_[0-9a-z]{3,}$/.test(String(envelope.id))) {
    issues.push(issue("error", "bad-id", "id", `"id" must look like ev_xxx, got "${envelope.id}".`));
  }
  if (envelope.type != null && typeof envelope.type !== "string") {
    issues.push(issue("error", "bad-type", "type", `"type" must be a string.`));
  }
  if (envelope.version != null && (!Number.isInteger(envelope.version) || envelope.version < 1)) {
    issues.push(issue("error", "bad-version", "version", `"version" must be a positive integer.`));
  }
  if (envelope.seq != null && (!Number.isInteger(envelope.seq) || envelope.seq < 0)) {
    issues.push(issue("error", "bad-seq", "seq", `"seq" must be a non-negative integer.`));
  }
  if (envelope.time != null && Number.isNaN(Date.parse(envelope.time))) {
    issues.push(issue("error", "bad-time", "time", `"time" must be an ISO timestamp.`));
  }
  if (envelope.source != null && !connectorsKnown.has(envelope.source)) {
    issues.push(issue("warn", "unknown-source", "source", `"${envelope.source}" is not a known connector.`));
  }

  const entry = envelope.type ? EVENT_TYPE_MAP.get(envelope.type) : null;
  if (envelope.type && !entry) {
    issues.push(issue("error", "unknown-type", "type", `Unknown event type "${envelope.type}".`));
  } else if (entry) {
    if (envelope.version != null && envelope.version !== entry.version) {
      issues.push(issue("warn", "version-mismatch", "version", `Event "${entry.type}" is at version ${entry.version}, envelope says ${envelope.version}.`));
    }
    issues.push(...validatePayload(entry.type, envelope.payload));
  }

  if (envelope.subject != null) {
    if (typeof envelope.subject !== "object" || Array.isArray(envelope.subject)) {
      issues.push(issue("error", "bad-subject", "subject", `"subject" must be an object.`));
    } else if (!envelope.subject.entityType && !envelope.subject.entityId) {
      issues.push(issue("warn", "empty-subject", "subject", `"subject" provides no entityType or entityId.`));
    }
  }

  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.level] = (counts[i.level] || 0) + 1;
  return { ok: counts.error === 0, issues, counts };
}

export function knownEventTypes() {
  return EVENT_TYPES.map((entry) => entry.type);
}

const SAMPLE_VALUES = {
  entityId: "co_demo01",
  companyId: "co_demo01",
  customerId: "ct_demo01",
  ticketId: "tk_demo01",
  deviceId: "dv_demo01",
  invoiceId: "iv_demo01",
  jobId: "job_demo01",
  bundleId: "bundle_demo01",
  subscriptionId: "sub_demo01",
  connector: "psa-u",
  entityType: "company",
  serial: "SN-0001",
  hostname: "ws-0001",
  at: () => new Date().toISOString(),
  checkedAt: () => new Date().toISOString(),
  subject: "Printer offline in reception",
  message: "Manual audit note",
  actor: "operator",
  resolution: "resolved",
  priority: "normal",
  currency: "USD",
  format: "json",
  target: "ai-assistant",
};

function sampleFor(fieldKey, schema) {
  if (schema.enum && schema.enum.length) return schema.enum[0];
  if (schema.type === "boolean") return true;
  if (schema.type === "number") return schema.min != null ? schema.min : 1;
  if (schema.type === "array") return [];
  if (schema.type === "object") return {};
  if (fieldKey in SAMPLE_VALUES) {
    const value = SAMPLE_VALUES[fieldKey];
    return typeof value === "function" ? value() : value;
  }
  return `<${fieldKey}>`;
}

export function samplePayload(type) {
  const entry = EVENT_TYPE_MAP.get(type);
  if (!entry) return {};
  const schema = entry.payload || {};
  const out = {};
  for (const [key, fieldSchema] of Object.entries(schema.fields || {})) {
    out[key] = sampleFor(key, fieldSchema);
  }
  return out;
}

export function describePayload(type) {
  const entry = EVENT_TYPE_MAP.get(type);
  if (!entry) return [];
  return Object.entries(entry.payload?.fields || {}).map(([key, schema]) => ({
    key,
    type: schema.type || "any",
    required: !!schema.required,
    enum: schema.enum || null,
  }));
}

