import { normalizeAcl } from "./acl.js";

export const OPENRPA_CORE_KEYS = ["_id", "_type", "name", "_created", "_modified", "_createdby", "_modifiedby", "_version", "_encrypt", "_acl"];

function field(key, label, kind, extra = {}) {
  return { key, label, kind, ...extra };
}

export const OPENRPA_DOCUMENT_TYPES = [
  {
    id: "workflow",
    label: "Workflow",
    plural: "Workflows",
    collection: "workflows",
    summaryKeys: ["filename", "queue", "rpa", "web"],
    large: ["xaml"],
    fields: [
      field("filename", "File name", "text"),
      field("queue", "Queue binding", "ref", { ref: "workitemqueue" }),
      field("rpa", "RPA agent", "boolean"),
      field("web", "Web / headless", "boolean"),
      field("background", "Background", "boolean"),
      field("Serializable", "Serializable", "boolean"),
      field("priority", "Priority", "enum", { values: ["low", "normal", "high"] }),
      field("parameters", "Parameters", "parameters"),
      field("xaml", "Workflow source", "blob", { large: true }),
    ],
  },
  {
    id: "workitemqueue",
    label: "Work item queue",
    plural: "Work item queues",
    collection: "openrpa_queue",
    summaryKeys: ["workflowid", "maxretries", "retrydelay"],
    fields: [
      field("workflowid", "Workflow binding", "ref", { ref: "workflow" }),
      field("robotqueue", "Robot queue", "text"),
      field("amqpqueue", "AMQP queue", "text"),
      field("maxretries", "Max retries", "number"),
      field("retrydelay", "Retry delay (s)", "number"),
      field("initialdelay", "Initial delay (s)", "number"),
      field("success_wiqid", "Success queue id", "ref", { ref: "workitemqueue" }),
      field("failed_wiqid", "Failed queue id", "ref", { ref: "workitemqueue" }),
      field("success_wiq", "Success route", "text"),
      field("failed_wiq", "Failed route", "text"),
    ],
  },
  {
    id: "workitem",
    label: "Work item",
    plural: "Work items",
    collection: "openrpa_workitem",
    summaryKeys: ["state", "priority", "retries"],
    fields: [
      field("wiqid", "Queue id", "ref", { ref: "workitemqueue" }),
      field("wiq", "Queue", "text"),
      field("state", "State", "enum", { values: ["new", "processing", "success", "failed", "abandoned"] }),
      field("payload", "Payload", "json"),
      field("retries", "Retries", "number"),
      field("priority", "Priority", "enum", { values: ["low", "normal", "high"] }),
      field("files", "Attachments", "list"),
      field("username", "Locked by", "text"),
      field("userid", "Locked by id", "text"),
      field("lastrun", "Last run", "datetime"),
      field("nextrun", "Next run", "datetime"),
      field("errormessage", "Error", "text"),
      field("errorsource", "Error source", "text"),
      field("errortype", "Error type", "text"),
    ],
  },
  {
    id: "robot",
    label: "Robot",
    plural: "Robots",
    collection: "openrpa_robot",
    summaryKeys: ["hostname", "version", "lastseen"],
    fields: [
      field("hostname", "Hostname", "text"),
      field("version", "Version", "text"),
      field("os", "Operating system", "text"),
      field("lastseen", "Last seen", "datetime"),
      field("robotqueue", "Robot queue", "text"),
      field("metrics", "Metrics", "json"),
    ],
  },
  {
    id: "nodered",
    label: "Node-RED instance",
    plural: "Node-RED instances",
    collection: "nodered",
    summaryKeys: ["instance", "state", "version"],
    fields: [
      field("url", "URL", "text"),
      field("instance", "Instance", "text"),
      field("state", "State", "enum", { values: ["running", "stopped"] }),
      field("version", "Version", "text"),
    ],
  },
  {
    id: "company",
    label: "Company",
    plural: "Companies",
    collection: "companies",
    summaryKeys: ["domain"],
    fields: [field("domain", "Domain", "text")],
  },
  {
    id: "file",
    label: "Stored file",
    plural: "Stored files",
    collection: "files",
    summaryKeys: ["filename", "contenttype", "length"],
    large: ["content", "data"],
    fields: [
      field("filename", "File name", "text"),
      field("contenttype", "Content type", "text"),
      field("length", "Length (bytes)", "number"),
      field("refid", "Referenced id", "text"),
      field("ref", "Referenced type", "text"),
      field("version", "File version", "number"),
      field("content", "Content", "blob", { large: true }),
      field("data", "Content (base64)", "blob", { large: true }),
    ],
  },
];

export const OPENRPA_GENERIC_TYPE = { id: "document", label: "Document", plural: "Documents", collection: null, summaryKeys: [], fields: [] };

const TYPE_BY_ID = new Map(OPENRPA_DOCUMENT_TYPES.map((type) => [type.id, type]));
const TYPE_BY_COLLECTION = new Map(OPENRPA_DOCUMENT_TYPES.map((type) => [type.collection, type]));

export function documentType(id) {
  return (id && TYPE_BY_ID.get(String(id))) || null;
}

export function documentTypeForCollection(collection) {
  return (collection && TYPE_BY_COLLECTION.get(String(collection))) || null;
}

export function collectionForType(id) {
  const type = documentType(id);
  return type ? type.collection : null;
}

export function knownKeysFor(typeId) {
  const type = documentType(typeId);
  return type ? type.fields.map((entry) => entry.key) : [];
}

export function normalizeDocument(raw, { collection = null } = {}) {
  const doc = raw && typeof raw === "object" ? raw : {};
  const type = documentType(doc._type) || documentTypeForCollection(collection) || OPENRPA_GENERIC_TYPE;
  const known = new Map((type.fields || []).map((entry) => [entry.key, entry]));
  const values = {};
  const extra = {};
  for (const [key, value] of Object.entries(doc)) {
    if (OPENRPA_CORE_KEYS.includes(key)) continue;
    if (known.has(key)) values[key] = value;
    else extra[key] = value;
  }
  return {
    id: doc._id || null,
    type: type.id,
    typeLabel: type.label,
    collection: collection || type.collection || null,
    name: doc.name || null,
    created: doc._created || null,
    modified: doc._modified || null,
    createdBy: doc._createdby || null,
    modifiedBy: doc._modifiedby || null,
    version: Number(doc._version) || 1,
    encrypt: !!doc._encrypt,
    acl: normalizeAcl(doc._acl),
    values,
    extra,
    unknownKeys: Object.keys(extra),
    fields: (type.fields || []).map((entry) => ({ ...entry, value: values[entry.key], present: entry.key in values })),
    raw: doc,
  };
}

export function serializeDocument(record) {
  const raw = record && record.raw ? record.raw : (record && record.document) || {};
  const out = { ...raw };
  if (record && record.id != null) out._id = record.id;
  if (record && record.name != null) out.name = record.name;
  if (record && record.version != null) out._version = record.version;
  Object.assign(out, (record && record.values) || {});
  Object.assign(out, (record && record.extra) || {});
  return out;
}

function formatValue(value, kind) {
  if (value == null) return "—";
  if (kind === "boolean") return value ? "yes" : "no";
  if (kind === "json") {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }
  if (kind === "list") return Array.isArray(value) ? `${value.length} entry(ies)` : String(value);
  if (kind === "parameters") return Array.isArray(value) ? `${value.length} parameter(s)` : String(value);
  if (kind === "blob") return typeof value === "string" ? `${value.length} characters` : "binary";
  return String(value);
}

export function describeDocument(record) {
  const normalized = record && record.raw ? record : normalizeDocument(record);
  const rows = [
    { label: "Id", value: normalized.id, kind: "text" },
    { label: "Type", value: normalized.typeLabel, kind: "text" },
    { label: "Name", value: normalized.name, kind: "text" },
    { label: "Version", value: normalized.version, kind: "number" },
    { label: "Created", value: normalized.created, kind: "datetime" },
    { label: "Modified", value: normalized.modified, kind: "datetime" },
    { label: "Created by", value: normalized.createdBy, kind: "text" },
    { label: "Modified by", value: normalized.modifiedBy, kind: "text" },
    { label: "Encrypted", value: normalized.encrypt, kind: "boolean" },
  ];
  const fields = normalized.fields.map((entry) => ({
    key: entry.key,
    label: entry.label,
    kind: entry.kind,
    present: entry.present,
    display: formatValue(entry.value, entry.kind),
    value: entry.value,
    large: !!entry.large,
  }));
  return { record: normalized, rows, fields };
}

export function summarizeDocument(record) {
  const type = documentType(record.type) || OPENRPA_GENERIC_TYPE;
  const parts = [];
  for (const key of type.summaryKeys || []) {
    if (!(key in (record.values || {}))) continue;
    const descriptor = (type.fields || []).find((entry) => entry.key === key) || { kind: "text" };
    parts.push(`${key}: ${formatValue(record.values[key], descriptor.kind)}`);
  }
  return parts.join(" · ");
}

export const NAMED_QUERIES = [
  { id: "all", collection: "*", label: "All documents", note: "Every document in the collection, newest first.", query: {}, orderby: { _modified: -1 } },
  { id: "workflows-all", collection: "workflows", label: "All workflows", orderby: { _modified: -1 } },
  { id: "workflows-bound", collection: "workflows", label: "Workflows with a queue binding", query: { queue: { $exists: true } } },
  { id: "workflows-unbound", collection: "workflows", label: "Workflows without a queue binding", query: { queue: { $exists: false } } },
  { id: "workflows-web", collection: "workflows", label: "Web / headless workflows", query: { web: true } },
  { id: "workflows-rpa", collection: "workflows", label: "RPA agent workflows", query: { rpa: true } },
  { id: "workflows-priority", collection: "workflows", label: "High-priority workflows", query: { priority: "high" } },
  { id: "queues-all", collection: "openrpa_queue", label: "All work-item queues", orderby: { name: 1 } },
  { id: "queues-retries", collection: "openrpa_queue", label: "Queues with 3+ retries", query: { maxretries: { $gte: 3 } } },
  { id: "workitems-new", collection: "openrpa_workitem", label: "Pending work items", query: { state: "new" }, orderby: { _created: -1 } },
  { id: "workitems-processing", collection: "openrpa_workitem", label: "Work items in flight", query: { state: "processing" } },
  { id: "workitems-failed", collection: "openrpa_workitem", label: "Failed work items", query: { state: "failed" } },
  { id: "workitems-high", collection: "openrpa_workitem", label: "High-priority work items", query: { priority: "high" } },
  { id: "robots-all", collection: "openrpa_robot", label: "All robots", orderby: { lastseen: -1 } },
  { id: "nodered-running", collection: "nodered", label: "Running Node-RED instances", query: { state: "running" } },
  { id: "companies-restricted", collection: "companies", label: "Companies with a restricted ACL", query: { "_acl.name": { $ne: "Default" } } },
  { id: "files-by-size", collection: "files", label: "Stored files, largest first", orderby: { length: -1 } },
];

export function namedQueries(collection = null) {
  return NAMED_QUERIES.filter((entry) => entry.collection === "*" || entry.collection === collection).map((entry) => ({ ...entry }));
}

export function namedQuery(id) {
  return NAMED_QUERIES.find((entry) => entry.id === id) || null;
}

export function parseQueryText(text) {
  const source = text == null ? "" : String(text).trim();
  if (!source) return { ok: true, query: null };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: { code: "invalid-json", message: `The query is not valid JSON: ${error.message}` } };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: { code: "invalid-query", message: 'A query must be a JSON object, e.g. {"state":"new"}.' } };
  }
  return { ok: true, query: parsed };
}

export function parseOrderbyText(text) {
  const source = text == null ? "" : String(text).trim();
  if (!source) return { ok: true, orderby: null };
  const orderby = {};
  for (const piece of source.split(",")) {
    let token = piece.trim();
    if (!token) continue;
    let direction = 1;
    if (token.startsWith("-")) {
      direction = -1;
      token = token.slice(1).trim();
    } else if (token.startsWith("+")) {
      token = token.slice(1).trim();
    }
    const colon = token.lastIndexOf(":");
    if (colon > 0) {
      const modifier = token.slice(colon + 1).trim().toLowerCase();
      if (/^-?\d+$/.test(modifier)) direction = Number(modifier) === 0 ? 1 : Number(modifier);
      else if (["asc", "up"].includes(modifier)) direction = 1;
      else if (["desc", "down"].includes(modifier)) direction = -1;
      else return { ok: false, error: { code: "invalid-orderby", message: `"${modifier}" is not an ordering direction. Use asc or desc.` } };
      token = token.slice(0, colon).trim();
    }
    if (!token) return { ok: false, error: { code: "invalid-orderby", message: "An ordering needs a field name." } };
    orderby[token] = direction;
  }
  return { ok: true, orderby: Object.keys(orderby).length ? orderby : null };
}

export function parseProjectionText(text) {
  const source = text == null ? "" : String(text).trim();
  if (!source) return { ok: true, projection: null };
  const keys = source
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { ok: true, projection: keys.length ? keys : null };
}

export function buildQuery({ queryText = "", orderbyText = "", projectionText = "" } = {}) {
  const query = parseQueryText(queryText);
  if (!query.ok) return query;
  const orderby = parseOrderbyText(orderbyText);
  if (!orderby.ok) return orderby;
  const projection = parseProjectionText(projectionText);
  if (!projection.ok) return projection;
  return { ok: true, query: query.query, orderby: orderby.orderby, projection: projection.projection };
}

export function paginate({ total = 0, page = 1, pageSize = 10 } = {}) {
  const size = Math.max(1, Math.trunc(Number(pageSize) || 0) || 10);
  const count = Math.max(0, Math.trunc(Number(total) || 0));
  const pageCount = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(1, Math.trunc(Number(page) || 1)), pageCount);
  return {
    page: current,
    pageSize: size,
    pageCount,
    total: count,
    from: count === 0 ? 0 : (current - 1) * size + 1,
    to: Math.min(count, current * size),
    hasPrev: current > 1,
    hasNext: current < pageCount,
  };
}

export function templateFor(collection, { id = null } = {}) {
  const type = documentTypeForCollection(collection);
  if (!type) return { _id: id || "", name: "" };
  const sample = { _id: id || "", _type: type.id, name: "" };
  for (const entry of type.fields) {
    if (entry.large) continue;
    if (entry.kind === "boolean") sample[entry.key] = false;
    else if (entry.kind === "number") sample[entry.key] = 0;
    else if (entry.kind === "json") sample[entry.key] = {};
    else if (entry.kind === "parameters") sample[entry.key] = [];
    else sample[entry.key] = "";
  }
  return sample;
}

const TRANSPORT_CODES = new Set(["timeout", "transport-error", "transport-unavailable", "transport-closed", "disconnected", "reset", "socket-closed", "socket-error", "bad-envelope", "no-websocket", "no-url"]);

export function classifyError(error, context = {}) {
  const message = (error && error.message) || (error == null ? "The operation failed." : String(error));
  const code = (error && error.code) || null;
  let kind = "server";
  let retryable = false;
  if (TRANSPORT_CODES.has(code)) {
    kind = "transport";
    retryable = code !== "no-websocket" && code !== "no-url";
  } else if (/version conflict/i.test(message)) {
    kind = "conflict";
  } else if (/was not found|no document|not found/i.test(message)) {
    kind = "not-found";
  } else if (/required|invalid|malformed|must |cannot|does not look|not a /i.test(message)) {
    kind = "validation";
  } else if (/not connected|connection|profile|unreachable|offline|websocket/i.test(message)) {
    kind = "transport";
  }
  return {
    ok: false,
    error: {
      kind,
      code,
      message,
      retryable,
      operation: context.operation || null,
      collection: context.collection || null,
    },
  };
}

function invalid(code, message, context) {
  return { ok: false, error: { kind: "validation", code, message, retryable: false, operation: context.operation || null, collection: context.collection || null } };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function createDocumentService({ request, clock = () => Date.now() } = {}) {
  const counters = { queries: 0, counts: 0, writes: 0, deletions: 0, errors: 0 };
  let lastAt = null;

  const call = (command, data) => (typeof request === "function" ? request(command, data) : Promise.reject(new Error("No OpenFlow connection is available.")));

  async function guarded(operation, context, task) {
    try {
      const result = await task();
      lastAt = new Date(clock()).toISOString();
      return result;
    } catch (error) {
      counters.errors += 1;
      return classifyError(error, { ...context, operation });
    }
  }

  async function listCollections() {
    return guarded("listcollections", {}, async () => {
      const names = await call("listcollections", {});
      counters.queries += 1;
      const out = [];
      for (const name of Array.isArray(names) ? names : []) {
        let count = null;
        try {
          count = (await call("count", { collection: name })).count;
          counters.counts += 1;
        } catch (error) {
          count = null;
        }
        const type = documentTypeForCollection(name);
        out.push({ name, count, type: type ? type.id : null, label: type ? type.plural : name });
      }
      return out;
    });
  }

  async function count(collection, query = null) {
    return guarded("count", { collection }, async () => {
      const payload = { collection };
      if (query) payload.query = query;
      const result = await call("count", payload);
      counters.counts += 1;
      return result && typeof result.count === "number" ? result.count : 0;
    });
  }

  async function query(collection, options = {}) {
    return guarded("query", { collection }, async () => {
      const payload = { collection };
      if (options.query) payload.query = options.query;
      if (options.projection) payload.projection = options.projection;
      if (options.orderby) payload.orderby = options.orderby;
      if (options.top != null) payload.top = options.top;
      if (options.skip != null) payload.skip = options.skip;
      const docs = await call("query", payload);
      counters.queries += 1;
      return (Array.isArray(docs) ? docs : []).map((doc) => normalizeDocument(doc, { collection }));
    });
  }

  async function page(collection, { page: pageNumber = 1, pageSize = 10, query: filter = null, orderby = null, projection = null } = {}) {
    const totalResult = await count(collection, filter);
    if (totalResult && totalResult.ok === false) return totalResult;
    const info = paginate({ total: totalResult, page: pageNumber, pageSize });
    const documentsResult = await query(collection, { query: filter, orderby, projection, top: info.pageSize, skip: (info.page - 1) * info.pageSize });
    if (documentsResult && documentsResult.ok === false) return documentsResult;
    return { ok: true, documents: documentsResult, ...info };
  }

  async function get(collection, id) {
    const result = await query(collection, { query: { _id: id }, top: 1 });
    if (result && result.ok === false) return result;
    return { ok: true, document: result[0] || null };
  }

  async function insert(collection, item) {
    if (!isPlainObject(item)) return invalid("invalid-document", "A document must be a JSON object.", { operation: "insert", collection });
    return guarded("insert", { collection }, async () => {
      const document = await call("insertone", { collection, item });
      counters.writes += 1;
      return { ok: true, document: normalizeDocument(document, { collection }), operation: "insert" };
    });
  }

  async function insertMany(collection, items) {
    if (!Array.isArray(items) || !items.length) return invalid("empty-batch", "A bulk insert needs a non-empty array of documents.", { operation: "insertMany", collection });
    return guarded("insertMany", { collection }, async () => {
      const result = await call("insertmany", { collection, items });
      counters.writes += items.length;
      return { ok: true, inserted: (result && result.inserted) || items.length, operation: "insertMany" };
    });
  }

  async function upsert(collection, item, { uniq = null } = {}) {
    if (!isPlainObject(item)) return invalid("invalid-document", "A document must be a JSON object.", { operation: "upsert", collection });
    if (uniq != null && !isPlainObject(uniq)) return invalid("invalid-key", "A uniqueness key must be a JSON object.", { operation: "upsert", collection });
    if (uniq == null && !item._id) return invalid("missing-key", "An upsert needs a document _id or a uniqueness key.", { operation: "upsert", collection });
    return guarded("upsert", { collection }, async () => {
      const payload = { collection, item };
      if (uniq) payload.uniq = uniq;
      const document = await call("insertorupdateone", payload);
      counters.writes += 1;
      const normalized = normalizeDocument(document, { collection });
      return { ok: true, document: normalized, operation: "upsert", created: normalized.version <= 1 };
    });
  }

  async function update(collection, item, { expectedVersion = null, adoptVersion = true } = {}) {
    if (!isPlainObject(item)) return invalid("invalid-document", "A document must be a JSON object.", { operation: "update", collection });
    if (!item._id) return invalid("missing-id", "An update needs the document's _id.", { operation: "update", collection });
    const version = expectedVersion != null ? Number(expectedVersion) : adoptVersion && item._version != null ? Number(item._version) : null;
    const payload = { ...item };
    if (version != null) payload._version = version;
    return guarded("update", { collection }, async () => {
      const document = await call("updateone", { collection, item: payload });
      counters.writes += 1;
      return { ok: true, document: normalizeDocument(document, { collection }), operation: "update" };
    });
  }

  async function remove(collection, id) {
    if (!id) return invalid("missing-id", "A delete needs the document's _id.", { operation: "delete", collection });
    return guarded("delete", { collection }, async () => {
      const result = await call("deleteone", { collection, id });
      const deleted = (result && result.deleted) || 0;
      counters.deletions += deleted;
      return { ok: true, deleted, operation: "delete" };
    });
  }

  async function removeMany(collection, ids) {
    if (!Array.isArray(ids) || !ids.length) return invalid("empty-batch", "A bulk delete needs a non-empty array of ids.", { operation: "deleteMany", collection });
    return guarded("deleteMany", { collection }, async () => {
      const result = await call("deletemany", { collection, ids });
      const deleted = (result && result.deleted) || 0;
      counters.deletions += deleted;
      return { ok: true, deleted, operation: "deleteMany" };
    });
  }

  function stats() {
    return { ...counters, lastAt };
  }

  function reset() {
    counters.queries = 0;
    counters.counts = 0;
    counters.writes = 0;
    counters.deletions = 0;
    counters.errors = 0;
    lastAt = null;
  }

  return {
    types: OPENRPA_DOCUMENT_TYPES,
    listCollections,
    count,
    query,
    page,
    get,
    insert,
    insertMany,
    upsert,
    update,
    remove,
    removeMany,
    normalize: normalizeDocument,
    serialize: serializeDocument,
    templateFor,
    stats,
    reset,
  };
}
