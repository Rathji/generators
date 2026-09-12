import { hash36 } from "../ids.js";

export const PROTOCOL_STATES = ["disconnected", "connecting", "connected", "reconnecting", "error"];

let envelopeCounter = 0;

export function nextEnvelopeId(prefix = "req", clock = () => Date.now()) {
  envelopeCounter += 1;
  return `${prefix}_${hash36(`${clock()}:${envelopeCounter}`)}`;
}

export function encodeData(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function decodeData(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const first = trimmed[0];
  if (first !== "{" && first !== "[" && first !== '"') return value;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    return value;
  }
}

export function createEnvelope({ id = null, replyto = null, command, data = null } = {}) {
  if (!command) throw new Error("An OpenFlow command is required.");
  return { id, replyto, command, data: encodeData(data) };
}

export function parseEnvelope(raw) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value) || !value.command) {
    throw new Error("Malformed OpenFlow envelope.");
  }
  return value;
}

export function errorText(value) {
  const decoded = decodeData(value);
  if (decoded == null) return "OpenFlow reported an error.";
  if (typeof decoded === "string") return decoded;
  if (typeof decoded === "object" && decoded.message) return String(decoded.message);
  return JSON.stringify(decoded);
}

function makeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createLoopbackTransport({ handler, delayMs = 0, jitterMs = 0, clock = () => Date.now() } = {}) {
  let messageHandler = null;
  let openHandler = null;
  let closeHandler = null;
  let errorHandler = null;
  let closed = false;
  let opened = false;
  let sent = 0;

  const schedule = (fn, ms) => (typeof setTimeout === "function" ? setTimeout(fn, ms) : Promise.resolve().then(fn));

  function deliver(envelope) {
    if (closed) return;
    const raw = typeof envelope === "string" ? envelope : JSON.stringify(envelope);
    const wait = delayMs + (jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0);
    schedule(() => {
      if (closed || !messageHandler) return;
      messageHandler(raw);
    }, wait);
  }

  return {
    kind: "loopback",
    open() {
      schedule(() => {
        if (closed || opened) return;
        opened = true;
        if (openHandler) openHandler();
      }, delayMs);
    },
    send(raw) {
      if (closed) return Promise.reject(makeError("transport-closed", "The transport is closed."));
      sent += 1;
      let envelope;
      try {
        envelope = JSON.parse(raw);
      } catch (error) {
        return Promise.reject(makeError("bad-envelope", "The envelope could not be encoded."));
      }
      let result;
      try {
        result = handler(envelope);
      } catch (error) {
        result = Promise.reject(error);
      }
      return Promise.resolve(result).then((reply) => {
        if (reply && !closed) deliver(reply);
      });
    },
    push(envelope) {
      deliver(envelope);
    },
    close() {
      if (closed) return;
      closed = true;
      if (closeHandler) closeHandler({ code: 1000, reason: "closed" });
    },
    onMessage(fn) {
      messageHandler = fn;
    },
    onOpen(fn) {
      openHandler = fn;
    },
    onClose(fn) {
      closeHandler = fn;
    },
    onError(fn) {
      errorHandler = fn;
    },
    emitError(error) {
      if (errorHandler) errorHandler(error);
    },
    stats() {
      return { sent, opened, closed, clock: clock() };
    },
    get closed() {
      return closed;
    },
  };
}

export function createWebSocketTransport({ url, WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : null, protocols = [] } = {}) {
  if (!WebSocketImpl) throw makeError("no-websocket", "WebSocket is unavailable, so a live OpenFlow connection cannot be opened.");
  if (!url) throw makeError("no-url", "A WebSocket URL is required.");
  let socket;
  try {
    socket = new WebSocketImpl(url, protocols);
  } catch (error) {
    throw makeError("socket-error", error && error.message ? error.message : String(error));
  }
  let messageHandler = null;
  let openHandler = null;
  let closeHandler = null;
  let errorHandler = null;
  socket.onopen = () => openHandler && openHandler();
  socket.onmessage = (event) => messageHandler && messageHandler(event.data);
  socket.onclose = (event) => closeHandler && closeHandler({ code: event.code, reason: event.reason });
  socket.onerror = (event) => errorHandler && errorHandler(event);
  return {
    kind: "websocket",
    url,
    open() {
      if (socket.readyState === 1 && openHandler) openHandler();
    },
    send(raw) {
      if (socket.readyState !== 1) throw makeError("socket-closed", "The WebSocket is not open.");
      socket.send(raw);
    },
    close() {
      try {
        socket.close();
      } catch (error) {}
    },
    onMessage(fn) {
      messageHandler = fn;
    },
    onOpen(fn) {
      openHandler = fn;
    },
    onClose(fn) {
      closeHandler = fn;
    },
    onError(fn) {
      errorHandler = fn;
    },
    stats() {
      return { kind: "websocket", url, readyState: socket.readyState };
    },
    get readyState() {
      return socket.readyState;
    },
  };
}

export function createProtocolClient({
  transport = null,
  transportFactory = null,
  clock = () => Date.now(),
  requestTimeoutMs = 15000,
  connectTimeoutMs = 8000,
  maxAttempts = 3,
  baseBackoffMs = 200,
  maxBackoffMs = 4000,
  autoReconnect = false,
  maxReconnects = 5,
} = {}) {
  let current = transport;
  let factory = transportFactory;
  let state = "disconnected";
  let deliberate = false;
  let reconnectTimer = null;
  let reconnectCount = 0;

  const counters = { sent: 0, received: 0, failed: 0, retried: 0, timeouts: 0, reconnects: 0, errors: 0 };
  let lastLatencyMs = null;
  const pending = new Map();
  const stateHandlers = new Set();
  const messageHandlers = new Set();
  const commandHandlers = new Map();
  const sentLog = [];

  function iso() {
    return new Date(clock()).toISOString();
  }

  function setState(next, detail = {}) {
    if (!PROTOCOL_STATES.includes(next)) return;
    if (state === next && !detail.force) return;
    const from = state;
    state = next;
    const event = { from, to: next, at: iso(), ...detail };
    for (const fn of stateHandlers) {
      try {
        fn(event);
      } catch (error) {}
    }
  }

  function onState(fn) {
    if (typeof fn !== "function") return () => {};
    stateHandlers.add(fn);
    return () => stateHandlers.delete(fn);
  }

  function onMessage(fn) {
    if (typeof fn !== "function") return () => {};
    messageHandlers.add(fn);
    return () => messageHandlers.delete(fn);
  }

  function onCommand(command, fn) {
    commandHandlers.set(command, fn);
    return () => commandHandlers.delete(command);
  }

  function settle(entry, payload) {
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(entry.id);
    counters.received += 1;
    lastLatencyMs = Math.max(0, clock() - entry.startedAt);
    entry.resolve(payload.data);
  }

  function rejectEntry(entry, error) {
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(entry.id);
    entry.reject(error);
  }

  function handleRaw(raw) {
    let envelope;
    try {
      envelope = parseEnvelope(raw);
    } catch (error) {
      counters.errors += 1;
      return;
    }
    const key = envelope.replyto || envelope.id;
    const entry = key ? pending.get(key) : null;

    if (envelope.command === "error") {
      counters.errors += 1;
      const error = makeError("protocol-error", errorText(envelope.data));
      if (entry) rejectEntry(entry, error);
      return;
    }

    if (entry) {
      settle(entry, { data: decodeData(envelope.data), envelope });
      return;
    }

    if (envelope.command === "ping") {
      counters.received += 1;
      notify("pong", { at: iso() });
      return;
    }

    counters.received += 1;
    const handler = commandHandlers.get(envelope.command);
    if (handler) {
      try {
        handler(decodeData(envelope.data), envelope);
      } catch (error) {}
    }
    for (const fn of messageHandlers) {
      try {
        fn(envelope, decodeData(envelope.data));
      } catch (error) {}
    }
  }

  function wire(t) {
    t.onMessage((raw) => handleRaw(raw));
    t.onOpen(() => {
      reconnectCount = 0;
      setState("connected");
    });
    t.onClose((info) => {
      if (deliberate) {
        setState("disconnected");
        return;
      }
      if (autoReconnect && reconnectCount < maxReconnects) {
        reconnectCount += 1;
        counters.reconnects += 1;
        setState("reconnecting", { reason: info && info.reason ? info.reason : "transport closed" });
        scheduleReconnect();
      } else {
        setState("error", { reason: info && info.reason ? info.reason : "The transport closed unexpectedly." });
      }
    });
    if (typeof t.onError === "function") {
      t.onError((error) => {
        counters.errors += 1;
        setState("error", { reason: error && error.message ? error.message : "Transport error." });
      });
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, reconnectCount - 1)));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect({ reconnect: true }).catch(() => {});
    }, delay);
  }

  function attemptSend(command, data, options, attemptNumber, resolve, reject) {
    if (!current) {
      reject(makeError("transport-unavailable", "No OpenFlow transport is connected."));
      return;
    }
    const id = nextEnvelopeId("req", clock);
    const envelopepayload = { id, replyto: null, command, data: encodeData(data) };
    const entry = { id, command, resolve, reject, attemptNumber, startedAt: clock(), timer: null };
    entry.timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      counters.timeouts += 1;
      handleFailure(command, data, options, attemptNumber, resolve, reject, makeError("timeout", `"${command}" did not reply within ${options.timeoutMs} ms.`));
    }, options.timeoutMs);
    pending.set(id, entry);
    counters.sent += 1;
    sentLog.push({ id, command, at: iso() });
    if (sentLog.length > 50) sentLog.shift();

    let result;
    try {
      result = current.send(JSON.stringify(envelopepayload));
    } catch (error) {
      pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      handleFailure(command, data, options, attemptNumber, resolve, reject, makeError("transport-error", error && error.message ? error.message : String(error)));
      return;
    }
    Promise.resolve(result).then(
      () => {
        if (pending.has(id) && entry.latencyMs == null) entry.latencyMs = clock() - entry.startedAt;
      },
      (error) => {
        if (!pending.has(id)) return;
        pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        handleFailure(command, data, options, attemptNumber, resolve, reject, makeError("transport-error", error && error.message ? error.message : String(error)));
      }
    );
  }

  function handleFailure(command, data, options, attemptNumber, resolve, reject, error) {
    counters.failed += 1;
    if (attemptNumber < options.maxTry) {
      counters.retried += 1;
      const delay = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, attemptNumber - 1));
      setTimeout(() => attemptSend(command, data, options, attemptNumber + 1, resolve, reject), delay);
      return;
    }
    reject(error);
  }

  function request(command, data = null, options = {}) {
    const opts = {
      timeoutMs: options.timeoutMs != null ? options.timeoutMs : requestTimeoutMs,
      maxTry: options.attempts != null ? Math.max(1, options.attempts) : maxAttempts,
    };
    return new Promise((resolve, reject) => attemptSend(command, data, opts, 1, resolve, reject));
  }

  function notify(command, data = null) {
    if (!current) return false;
    try {
      current.send(JSON.stringify({ id: nextEnvelopeId("ntf", clock), replyto: null, command, data: encodeData(data) }));
      counters.sent += 1;
      return true;
    } catch (error) {
      counters.errors += 1;
      return false;
    }
  }

  function connect(options = {}) {
    if (options.reconnect !== true) deliberate = false;
    if (state === "connected") return Promise.resolve({ ok: true, state });
    return new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        resolve(payload);
      };
      const timer = setTimeout(() => finish({ ok: false, state, error: `Connection did not open within ${connectTimeoutMs} ms.` }), connectTimeoutMs);
      const unsubscribe = onState((event) => {
        if (event.to === "connected") finish({ ok: true, state });
        else if (event.to === "error") finish({ ok: false, state, error: event.reason || "Connection failed." });
      });

      if (!current && factory) {
        try {
          current = factory();
        } catch (error) {
          current = null;
          setState("error", { reason: error && error.message ? error.message : "The transport could not be created." });
          finish({ ok: false, state, error: state });
          return;
        }
      }
      if (!current) {
        setState("error", { reason: "No transport is available for this connection mode." });
        finish({ ok: false, state, error: "No transport is available for this connection mode." });
        return;
      }
      wire(current);
      if (!options.reconnect) setState("connecting");
      try {
        const opened = current.open ? current.open() : null;
        if (opened && typeof opened.catch === "function") opened.catch((error) => setState("error", { reason: error && error.message ? error.message : "The connection failed." }));
      } catch (error) {
        setState("error", { reason: error && error.message ? error.message : "The connection failed." });
      }
    });
  }

  function disconnect() {
    deliberate = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    for (const entry of pending.values()) rejectEntry(entry, makeError("disconnected", "The connection was closed."));
    pending.clear();
    if (current && typeof current.close === "function") {
      try {
        current.close();
      } catch (error) {}
    }
    setState("disconnected", { reason: "closed by the operator" });
    return true;
  }

  function setTransport(next) {
    current = next || null;
    return current;
  }

  function setTransportFactory(fn) {
    factory = fn || null;
    return factory;
  }

  function ping(options = {}) {
    return request("ping", {}, { attempts: 1, timeoutMs: 4000, ...options }).then((data) => ({ ok: true, data }));
  }

  function stats() {
    return {
      state,
      connected: state === "connected",
      ...counters,
      pending: pending.size,
      reconnectCount,
      lastLatencyMs,
      transport: current ? current.kind || "unknown" : null,
    };
  }

  function reset() {
    deliberate = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    for (const entry of pending.values()) rejectEntry(entry, makeError("reset", "The client was reset."));
    pending.clear();
    current = null;
    counters.sent = 0;
    counters.received = 0;
    counters.failed = 0;
    counters.retried = 0;
    counters.timeouts = 0;
    counters.reconnects = 0;
    counters.errors = 0;
    reconnectCount = 0;
    lastLatencyMs = null;
    sentLog.length = 0;
    state = "disconnected";
    deliberate = false;
  }

  return {
    request,
    notify,
    connect,
    disconnect,
    ping,
    setTransport,
    setTransportFactory,
    onState,
    onMessage,
    onCommand,
    stats,
    reset,
    state: () => state,
    connected: () => state === "connected",
    pending: () => Array.from(pending.keys()),
    recent: () => sentLog.slice(),
  };
}
