import { buildOpenRpaFixtures } from "./fixtures.js";
import { createLoopbackTransport, decodeData, encodeData } from "./protocol.js";
import { decodeJwt, mintJwt } from "./session.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function contentLength(text, encoding) {
  if (encoding !== "base64") return text.length;
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const padding = (clean.match(/=+$/) || [""])[0].length;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function looseEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function getPath(doc, path) {
  let cursor = doc;
  for (const part of String(path).split(".")) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function matchesCondition(value, condition) {
  if (condition === null || condition === undefined) return value == null;
  if (typeof condition !== "object" || Array.isArray(condition)) return looseEqual(value, condition);
  for (const [op, expected] of Object.entries(condition)) {
    switch (op) {
      case "$eq":
        if (!looseEqual(value, expected)) return false;
        break;
      case "$ne":
        if (looseEqual(value, expected)) return false;
        break;
      case "$gt":
        if (!(value > expected)) return false;
        break;
      case "$gte":
        if (!(value >= expected)) return false;
        break;
      case "$lt":
        if (!(value < expected)) return false;
        break;
      case "$lte":
        if (!(value <= expected)) return false;
        break;
      case "$in":
        if (!Array.isArray(expected) || !expected.some((entry) => looseEqual(value, entry))) return false;
        break;
      case "$nin":
        if (Array.isArray(expected) && expected.some((entry) => looseEqual(value, entry))) return false;
        break;
      case "$exists":
        if ((value !== undefined && value !== null) !== !!expected) return false;
        break;
      case "$regex": {
        const re = new RegExp(expected);
        if (!re.test(String(value == null ? "" : value))) return false;
        break;
      }
      case "$not":
        if (matchesCondition(value, expected)) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

function matchDoc(doc, query) {
  if (!query || typeof query !== "object") return true;
  for (const [key, condition] of Object.entries(query)) {
    if (key === "$and") {
      if (!Array.isArray(condition) || !condition.every((sub) => matchDoc(doc, sub))) return false;
      continue;
    }
    if (key === "$or") {
      if (!Array.isArray(condition) || !condition.some((sub) => matchDoc(doc, sub))) return false;
      continue;
    }
    if (key === "$nor") {
      if (Array.isArray(condition) && condition.some((sub) => matchDoc(doc, sub))) return false;
      continue;
    }
    if (key.startsWith("$")) return false;
    if (!matchesCondition(getPath(doc, key), condition)) return false;
  }
  return true;
}

function projectDoc(doc, projection) {
  if (!projection) return doc;
  if (Array.isArray(projection)) {
    const out = {};
    for (const key of projection) if (key in doc) out[key] = doc[key];
    return out;
  }
  const keys = Object.keys(projection);
  const inclusive = keys.some((key) => projection[key]);
  if (inclusive) {
    const out = {};
    for (const key of keys) if (projection[key] && key in doc) out[key] = doc[key];
    if (!("_id" in projection) && "_id" in doc) out._id = doc._id;
    return out;
  }
  const out = { ...doc };
  for (const key of keys) if (!projection[key]) delete out[key];
  return out;
}

function sortDocs(docs, orderby) {
  if (!orderby) return docs;
  const entries = typeof orderby === "string" ? [[orderby, 1]] : Object.entries(orderby);
  return docs.slice().sort((a, b) => {
    for (const [key, direction] of entries) {
      const av = getPath(a, key);
      const bv = getPath(b, key);
      if (looseEqual(av, bv)) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : 1) * (direction < 0 ? -1 : 1);
    }
    return 0;
  });
}

export function createEmulator({ fixtures = buildOpenRpaFixtures(), clock = () => Date.now(), delayMs = 0, failureRate = 0 } = {}) {
  let data = clone(fixtures);
  let online = true;
  let activeTransport = null;
  let counter = 0;
  let injectedRate = failureRate;
  const failures = new Map();
  const calls = [];
  const instances = [];
  let sweepTimer = null;
  let streaming = false;
  const watches = [];

  const iso = () => new Date(clock()).toISOString();
  const newId = (prefix) => `${prefix}_${(++counter).toString(36)}${Math.floor(clock() % 4096).toString(36)}`;

  function hashSeed(text) {
    let h = 2166136261;
    const str = String(text);
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function defaultDurationMs(workflowid, queue) {
    return 90 + (hashSeed(`${workflowid || ""}:${queue || ""}`) % 240);
  }

  function sweep() {
    const now = clock();
    const due = instances.filter((instance) => instance.state === "pending" && instance.completeAt <= now);
    for (const instance of due) {
      const failed = !!instance.error;
      instance.state = failed ? "failed" : "success";
      instance.finishedAt = iso();
      emit("workflowinstance", {
        correlationId: instance.correlationId,
        instanceId: instance.instanceId,
        workflowid: instance.workflowid,
        queue: instance.queue,
        state: instance.state,
        durationMs: instance.durationMs,
        ...(failed ? { error: instance.error } : { result: instance.result }),
      });
    }
    return { swept: due.length, at: iso() };
  }

  function scheduleSweep() {
    if (typeof setTimeout !== "function") return false;
    if (sweepTimer) return true;
    const pending = instances.filter((instance) => instance.state === "pending");
    if (!pending.length) return false;
    const earliest = Math.min(...pending.map((instance) => instance.completeAt));
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      sweep();
      scheduleSweep();
    }, Math.max(0, earliest - clock()));
    return true;
  }

  function collection(name) {
    if (!data.documents[name]) data.documents[name] = [];
    return data.documents[name];
  }

  function userFor(username) {
    return data.users.find((user) => user.username === username) || null;
  }

  function reply(envelope, value) {
    return { id: newId(`em`), replyto: envelope.id || null, command: envelope.command, data: encodeData(value === undefined ? {} : value) };
  }

  function errorReply(envelope, message) {
    return { id: newId("em"), replyto: envelope.id || null, command: "error", data: message };
  }

  function bump(doc) {
    doc._modified = iso();
    doc._version = (Number(doc._version) || 0) + 1;
    return doc;
  }

  function findByUnique(name, unique) {
    if (!unique) return null;
    return collection(name).find((doc) => Object.entries(unique).every(([key, value]) => looseEqual(getPath(doc, key), value))) || null;
  }

  const handlers = {
    ping() {
      return { pong: true, at: iso() };
    },
    pong() {
      return { ok: true };
    },
    signin(payload) {
      if (payload.jwt) {
        const decoded = decodeJwt(payload.jwt, { clock });
        if (!decoded.ok) throw new Error(decoded.error || "The token could not be decoded.");
        if (decoded.expired) throw new Error("That token has expired.");
        const user = userFor(decoded.payload.username) || { _id: decoded.payload.sub || null, name: decoded.payload.name || decoded.payload.username || "OpenFlow user", username: decoded.payload.username || null, roles: decoded.payload.roles || [] };
        return { token: payload.jwt, user, expiresAt: decoded.expiresAt };
      }
      const user = userFor(payload.username);
      if (!user || !payload.password) throw new Error("Invalid username or password.");
      const token = mintJwt({ username: user.username, name: user.name, roles: user.roles, ttlSeconds: 3600, now: clock() });
      const refreshToken = mintJwt({ username: user.username, name: user.name, roles: user.roles, ttlSeconds: 7200, now: clock() });
      return { token, refreshToken, user, expiresAt: decodeJwt(token, { clock }).expiresAt };
    },
    refreshtoken(payload) {
      const decoded = decodeJwt(payload.token, { clock });
      const user = (decoded.ok && userFor(decoded.payload.username)) || (decoded.ok ? { _id: decoded.payload.sub, name: decoded.payload.name, username: decoded.payload.username, roles: decoded.payload.roles } : null);
      if (!user) throw new Error("The token could not be refreshed.");
      const token = mintJwt({ username: user.username, name: user.name, roles: user.roles, ttlSeconds: 3600, now: clock() });
      return { token, user, expiresAt: decodeJwt(token, { clock }).expiresAt };
    },
    signout() {
      return { ok: true };
    },
    listcollections() {
      return Object.keys(data.documents);
    },
    query(payload) {
      const name = payload.collection;
      if (!name) throw new Error("A collection name is required.");
      let docs = collection(name).map(clone);
      if (payload.query) docs = docs.filter((doc) => matchDoc(doc, payload.query));
      docs = sortDocs(docs, payload.orderby);
      if (payload.skip) docs = docs.slice(payload.skip);
      if (payload.top != null) docs = docs.slice(0, payload.top);
      if (payload.projection) docs = docs.map((doc) => projectDoc(doc, payload.projection));
      return docs;
    },
    count(payload) {
      let docs = collection(payload.collection);
      if (payload.query) docs = docs.filter((doc) => matchDoc(doc, payload.query));
      return { count: docs.length };
    },
    getmachines() {
      return collection("openrpa_robot").map(clone);
    },
    getusers() {
      return clone(data.users);
    },
    getroles() {
      return clone(data.roles);
    },
    insertone(payload) {
      const item = clone(payload.item || payload.document || {});
      const name = payload.collection;
      if (!name) throw new Error("A collection name is required.");
      if (!item._id) item._id = newId(name.slice(0, 2));
      item._created = item._created || iso();
      item._modified = iso();
      item._version = item._version || 1;
      collection(name).push(item);
      notify("collection", { collection: name, action: "inserted", id: item._id, docType: item._type || null, version: item._version, _doc: item });
      return item;
    },
    insertorupdateone(payload) {
      const name = payload.collection;
      const item = clone(payload.item || payload.document || {});
      const existing = item._id ? collection(name).find((doc) => doc._id === item._id) : findByUnique(name, payload.uniq);
      if (existing) {
        Object.assign(existing, item);
        bump(existing);
        notify("collection", { collection: name, action: "updated", id: existing._id, docType: existing._type || null, version: existing._version, _doc: existing });
        return existing;
      }
      return handlers.insertone(payload);
    },
    insertmany(payload) {
      const name = payload.collection;
      const items = payload.items || payload.documents || [];
      for (const item of items) handlers.insertone({ collection: name, item });
      return { inserted: items.length };
    },
    updateone(payload) {
      const name = payload.collection;
      const item = clone(payload.item || payload.document || payload);
      const existing = collection(name).find((doc) => doc._id === item._id);
      if (!existing) throw new Error(`Document "${item._id}" was not found.`);
      if (item._version != null && existing._version != null && Number(item._version) !== Number(existing._version)) {
        throw new Error(`Version conflict: the stored document is at version ${existing._version}.`);
      }
      Object.assign(existing, item);
      bump(existing);
      notify("collection", { collection: name, action: "updated", id: existing._id, docType: existing._type || null, version: existing._version, _doc: existing });
      return existing;
    },
    deleteone(payload) {
      const name = payload.collection;
      const id = payload.id || payload._id;
      const list = collection(name);
      const index = list.findIndex((doc) => doc._id === id);
      if (index === -1) return { deleted: 0 };
      const [removed] = list.splice(index, 1);
      notify("collection", { collection: name, action: "deleted", id, docType: removed && removed._type || null, version: removed && removed._version != null ? removed._version : null, _doc: removed || null });
      return { deleted: 1 };
    },
    deletemany(payload) {
      const name = payload.collection;
      const ids = payload.ids || [];
      const list = collection(name);
      let deleted = 0;
      for (const id of ids) {
        const index = list.findIndex((doc) => doc._id === id);
        if (index !== -1) {
          const [removed] = list.splice(index, 1);
          notify("collection", { collection: name, action: "deleted", id, docType: removed && removed._type || null, version: removed && removed._version != null ? removed._version : null, _doc: removed || null });
          deleted += 1;
        }
      }
      return { deleted };
    },
    addworkitem(payload) {
      const item = clone(payload.item || payload);
      item._id = item._id || newId("wi");
      item._type = "workitem";
      item.state = item.state || "new";
      item.payload = typeof item.payload === "string" ? item.payload : JSON.stringify(item.payload || {});
      item.retries = item.retries || 0;
      item.files = item.files || [];
      item._created = item._created || iso();
      item._modified = iso();
      item._version = 1;
      collection("openrpa_workitem").push(item);
      notify("workitem", { queueId: item.wiqid || item.wiq || null, itemId: item._id, state: item.state, priority: item.priority || null, retries: item.retries || 0, _doc: item });
      return item;
    },
    addworkitems(payload) {
      const items = payload.items || [];
      for (const item of items) handlers.addworkitem({ item });
      return { inserted: items.length };
    },
    popworkitem(payload) {
      const wiq = payload.wiq || payload.wiqid;
      const list = collection("openrpa_workitem");
      const now = clock();
      const rank = { high: 0, normal: 1, low: 2 };
      const candidates = list
        .filter((doc) => {
          if (!(doc.wiqid === wiq || doc.wiq === wiq)) return false;
          if (doc.state !== "new") return false;
          if (doc.nextrun) {
            const due = Date.parse(doc.nextrun);
            if (!Number.isNaN(due) && due > now) return false;
          }
          return true;
        })
        .sort((a, b) => {
          const ar = rank[a.priority] == null ? 1 : rank[a.priority];
          const br = rank[b.priority] == null ? 1 : rank[b.priority];
          if (ar !== br) return ar - br;
          return String(a._created).localeCompare(String(b._created));
        });
      const item = candidates[0] || null;
      if (!item) return { item: null };
      item.state = "processing";
      item.lastrun = iso();
      item.username = payload.username || item.username || null;
      bump(item);
      notify("workitem", { queueId: item.wiqid || item.wiq || null, itemId: item._id, state: item.state, worker: item.username || null, priority: item.priority || null, retries: item.retries || 0, _doc: item });
      return { item };
    },
    updateworkitem(payload) {
      const item = clone(payload.item || payload);
      const list = collection("openrpa_workitem");
      const existing = list.find((doc) => doc._id === item._id);
      if (!existing) throw new Error(`Work item "${item._id}" was not found.`);
      Object.assign(existing, item);
      if (item.retries != null) existing.retries = Number(item.retries);
      bump(existing);
      notify("workitem", { queueId: existing.wiqid || existing.wiq || null, itemId: existing._id, state: existing.state, worker: existing.username || null, priority: existing.priority || null, retries: existing.retries || 0, error: existing.error || null, _doc: existing });
      return existing;
    },
    deleteworkitem(payload) {
      return handlers.deleteone({ collection: "openrpa_workitem", id: payload.id || payload._id });
    },
    addworkitemqueue(payload) {
      const item = clone(payload.item || payload);
      item._id = item._id || newId("qi");
      item._type = "workitemqueue";
      item._created = item._created || iso();
      item._modified = iso();
      item._version = 1;
      collection("openrpa_queue").push(item);
      return item;
    },
    updateworkitemqueue(payload) {
      const item = clone(payload.item || payload);
      const existing = collection("openrpa_queue").find((doc) => doc._id === item._id);
      if (!existing) throw new Error(`Queue "${item._id}" was not found.`);
      Object.assign(existing, item);
      bump(existing);
      return existing;
    },
    deleteworkitemqueue(payload) {
      return handlers.deleteone({ collection: "openrpa_queue", id: payload.id || payload._id });
    },
    registerqueue(payload) {
      return { amqpqueue: `openrpa.${payload.name || "queue"}`, registered: true };
    },
    registerexchange(payload) {
      return { exchange: `openrpa.${payload.name || "exchange"}`, registered: true };
    },
    queuemessage(payload) {
      return { queued: true, queue: payload.queue || null };
    },
    createworkflowinstance(payload) {
      const workflowid = payload.workflowid || payload.workflowId || null;
      const queue = payload.queue || payload.wiq || null;
      const correlationId = payload.correlationId || payload.correlationid || null;
      const instanceId = newId("wfinst");
      const failed = payload.simulateError === true || payload.simulateFailure === true;
      const errorMessage = failed ? payload.errorMessage || payload.error || `Workflow "${workflowid || queue || instanceId}" failed during execution.` : null;
      const durationMs = payload.durationMs != null ? Math.max(0, Number(payload.durationMs)) : defaultDurationMs(workflowid, queue);
      const inputs = payload.payload && typeof payload.payload === "object" ? payload.payload : {};
      const instance = {
        instanceId,
        workflowid,
        queue,
        correlationId,
        state: "pending",
        startedAt: iso(),
        completeAt: clock() + durationMs,
        durationMs,
        error: errorMessage,
        inputs,
        result: failed ? null : { workflowId: workflowid, queue, completedBy: "openflow-emulator", payload: inputs },
      };
      instances.push(instance);
      scheduleSweep();
      return { instanceId, workflowid, state: "pending", correlationId, durationMs };
    },
    watch(payload) {
      const entry = { watchId: newId("watch"), collection: payload.collection || null, filter: payload.filter || null, at: iso() };
      watches.push(entry);
      return { watchId: entry.watchId, collection: entry.collection, filter: entry.filter };
    },
    unwatch(payload) {
      const watchId = payload.watchId || payload.id || null;
      const index = watchId ? watches.findIndex((entry) => entry.watchId === watchId) : -1;
      if (index !== -1) watches.splice(index, 1);
      return { ok: true, removed: index !== -1 ? 1 : 0 };
    },
    ensureNoderedInstance(payload) {
      const name = payload.name || "nodered";
      const list = collection("nodered");
      let instance = list.find((doc) => doc.instance === name || doc.name === name);
      if (!instance) {
        instance = { _id: newId("nr"), _type: "nodered", name, instance: name, url: payload.url || null, state: "running", version: "3.1.0", _created: iso(), _modified: iso(), _version: 1 };
        list.push(instance);
      }
      return instance;
    },
    restartNoderedInstance(payload) {
      const instance = collection("nodered").find((doc) => doc.instance === payload.name || doc.name === payload.name);
      if (!instance) throw new Error(`Node-RED instance "${payload.name}" was not found.`);
      instance.state = "running";
      return bump(instance);
    },
    deleteNoderedInstance(payload) {
      const list = collection("nodered");
      const index = list.findIndex((doc) => doc.instance === payload.name || doc.name === payload.name);
      if (index !== -1) list.splice(index, 1);
      return { deleted: index !== -1 ? 1 : 0 };
    },
    uploadfile(payload) {
      const content = payload.content == null ? "" : String(payload.content);
      const encoding = payload.encoding === "base64" ? "base64" : "utf8";
      const file = {
        _id: newId("file"),
        _type: "file",
        name: payload.filename || payload.name || "upload.bin",
        filename: payload.filename || payload.name || "upload.bin",
        contenttype: payload.contenttype || "application/octet-stream",
        encoding,
        length: payload.length != null ? Number(payload.length) : contentLength(content, encoding),
        checksum: payload.checksum || null,
        refid: payload.refid || null,
        ref: payload.ref || null,
        version: 1,
        _created: iso(),
        _modified: iso(),
        _version: 1,
      };
      collection("files").push(file);
      if (!data.fileContent) data.fileContent = {};
      data.fileContent[file._id] = content;
      return clone(file);
    },
    getfile(payload) {
      const file = collection("files").find((doc) => doc._id === payload.id || doc.name === payload.id);
      if (!file) throw new Error(`File "${payload.id}" was not found.`);
      return { ...clone(file), content: (data.fileContent || {})[file._id] || "" };
    },
    listfiles() {
      return collection("files").map(clone);
    },
    deletefile(payload) {
      if (data.fileContent) delete data.fileContent[payload.id];
      return handlers.deleteone({ collection: "files", id: payload.id });
    },
    pushmetrics(payload) {
      const robot = collection("openrpa_robot").find((doc) => doc.name === payload.name || doc._id === payload.robotid);
      if (robot) {
        robot.lastseen = iso();
        robot.metrics = payload.metrics || robot.metrics;
        bump(robot);
        notify("robot", { name: robot.name || null, id: robot._id, version: robot.version || null, hostname: robot.hostname || null, lastseen: robot.lastseen, metrics: clone(robot.metrics || null), _doc: robot });
      }
      return { ok: true };
    },
  };

  function process(envelope) {
    calls.push({ command: envelope.command, at: iso() });
    if (!online) {
      const error = new Error("OpenFlow endpoint is unreachable (emulator offline).");
      error.transport = true;
      throw error;
    }
    const injected = failures.get(envelope.command);
    if (injected) {
      if (!injected.persistent) failures.delete(envelope.command);
      return errorReply(envelope, injected.message);
    }
    if (injectedRate > 0 && Math.random() < injectedRate) {
      return errorReply(envelope, "Emulator injected a random failure.");
    }
    if (typeof handlers[envelope.command] !== "function") {
      return errorReply(envelope, `Unknown command "${envelope.command}".`);
    }
    const payload = decodeData(envelope.data) || {};
    try {
      const result = handlers[envelope.command](typeof payload === "object" ? payload : {}, envelope);
      return reply(envelope, result === undefined ? {} : result);
    } catch (error) {
      return errorReply(envelope, error && error.message ? error.message : String(error));
    }
  }

  function transport() {
    const t = createLoopbackTransport({ handler: (envelope) => process(envelope), delayMs, clock });
    activeTransport = t;
    return t;
  }

  function emit(command, payload = null) {
    if (!activeTransport) return false;
    activeTransport.push({ id: newId("srv"), replyto: null, command, data: encodeData(payload) });
    return true;
  }

  function notify(kind, payload = {}) {
    const record = { kind, ...payload };
    if (!streaming) return record;
    const { _doc, ...clean } = record;
    clean.at = clean.at || iso();
    if (kind === "collection") {
      for (const watch of watches) {
        if (watch.collection && watch.collection !== clean.collection) continue;
        if (watch.filter && !matchDoc(_doc || {}, watch.filter)) continue;
        emit("watchevent", {
          watchId: watch.watchId,
          collection: clean.collection,
          action: clean.action,
          id: clean.id || null,
          docType: clean.docType || null,
          version: clean.version != null ? clean.version : null,
          at: clean.at,
        });
      }
      return record;
    }
    if (kind === "workitem") emit("workitem", clean);
    else if (kind === "robot") emit("robot", clean);
    return record;
  }

  function setStreaming(next) {
    streaming = !!next;
    return streaming;
  }

  function setOnline(next) {
    online = !!next;
    return online;
  }

  function injectFailure(command, message = "Emulator injected failure.", { persistent = false } = {}) {
    failures.set(command, { message, persistent });
    return true;
  }

  function clearFailures() {
    failures.clear();
    return true;
  }

  function setDelay(ms) {
    delayMs = Math.max(0, Number(ms) || 0);
    return delayMs;
  }

  function setFailureRate(rate) {
    injectedRate = Math.max(0, Math.min(1, Number(rate) || 0));
    return injectedRate;
  }

  function reset() {
    data = clone(fixtures);
    online = true;
    counter = 0;
    injectedRate = failureRate;
    failures.clear();
    calls.length = 0;
    instances.length = 0;
    streaming = false;
    watches.length = 0;
    if (sweepTimer && typeof clearTimeout === "function") clearTimeout(sweepTimer);
    sweepTimer = null;
  }

  function stats() {
    const documents = {};
    let total = 0;
    for (const [name, list] of Object.entries(data.documents)) {
      documents[name] = list.length;
      total += list.length;
    }
    return {
      online,
      users: data.users.length,
      roles: data.roles.length,
      collections: Object.keys(data.documents).length,
      documents,
      total,
      calls: calls.length,
      commands: Object.keys(handlers).length,
      failures: failures.size,
      instances: instances.length,
      pendingInstances: instances.filter((instance) => instance.state === "pending").length,
      streaming,
      watching: watches.length,
    };
  }

  return {
    transport,
    process,
    emit,
    setOnline,
    setDelay,
    setFailureRate,
    injectFailure,
    clearFailures,
    statistics: stats,
    stats,
    dataset: () => clone(data),
    users: () => clone(data.users),
    collections: () => Object.keys(data.documents),
    calls: () => calls.slice(),
    online: () => online,
    commands: () => Object.keys(handlers),
    instances: () => clone(instances),
    setStreaming,
    streaming: () => streaming,
    watches: () => clone(watches),
    sweep,
    reset,
  };
}
