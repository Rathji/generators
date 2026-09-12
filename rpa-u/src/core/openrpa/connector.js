import { buildOpenRpaFixtures } from "./fixtures.js";
import { createEmulator } from "./emulator.js";
import { createProtocolClient, createWebSocketTransport } from "./protocol.js";
import { createProfileStore, endpointOf, validateProfile } from "./profiles.js";
import { createSessionManager } from "./session.js";
import { createDocumentService } from "./documents.js";
import { createAclMirror } from "./acl.js";
import { createWorkItemService } from "./workitems.js";
import { createFileStore } from "./files.js";
import { createInvocationService } from "./invocation.js";
import { createEventBridge } from "./bridge.js";
import { createRobotRegistry } from "./robots.js";
import { createNodeRedRegistry } from "./nodered.js";
import { createOpenRpaLinker } from "./linking.js";
import { createOpenRpaDriftMonitor } from "./drift.js";
import { createOpenRpaSyncService } from "./sync.js";
import { createOpenRpaConflictReview } from "./conflicts.js";
import { createOpenRpaBundleStore } from "./bundles.js";
import { OPENRPA_DESCRIPTOR, OPENRPA_HEALTH_THRESHOLDS, OPENRPA_ID, OPENRPA_MODES } from "./constants.js";

export function createOpenRpaConnector({
  db = null,
  clock = () => Date.now(),
  permissions = null,
  roleMaps = {},
  emit = null,
  identity = null,
  registry = null,
  fixtures = null,
  WebSocketImpl = undefined,
  tokenTtlSeconds = 3600,
} = {}) {
  const profiles = createProfileStore({ db, clock });
  const emulator = createEmulator({ fixtures: fixtures || buildOpenRpaFixtures({ now: clock() }), clock });
  let mode = "emulator";

  const client = createProtocolClient({
    clock,
    transportFactory: () => buildTransport(),
    autoReconnect: false,
  });

  const commandListeners = new Map();
  function onCommand(command, handler) {
    if (typeof handler !== "function") return () => {};
    let listeners = commandListeners.get(command);
    if (!listeners) {
      listeners = new Set();
      commandListeners.set(command, listeners);
      client.onCommand(command, (data, envelope) => {
        for (const listener of Array.from(listeners)) {
          try {
            listener(data, envelope);
          } catch (error) {}
        }
      });
    }
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  const session = createSessionManager({
    resolveClient: () => client,
    clock,
    roleMaps,
    permissions,
    db,
  });

  const documents = createDocumentService({ request: (command, data, options) => request(command, data, options), clock });
  const acl = createAclMirror({ request: (command, data, options) => request(command, data, options), clock });
  const workitems = createWorkItemService({ request: (command, data, options) => request(command, data, options), clock });
  const files = createFileStore({ request: (command, data, options) => request(command, data, options), clock });
  const invocation = createInvocationService({
    request: (command, data, options) => request(command, data, options),
    onCommand,
    clock,
    emit,
  });
  const bridge = createEventBridge({
    request: (command, data, options) => request(command, data, options),
    onCommand,
    emit,
    db,
    clock,
    streaming: (next) => (mode === "emulator" ? emulator.setStreaming(next) : next),
  });
  const robots = createRobotRegistry({ request: (command, data, options) => request(command, data, options), clock });
  const nodered = createNodeRedRegistry({ request: (command, data, options) => request(command, data, options), clock });
  const linking = createOpenRpaLinker({
    identity,
    db,
    documents,
    workitems,
    robots,
    nodered,
    invocation,
    clock,
  });
  const drift = createOpenRpaDriftMonitor({ identity, registry, linking, db, clock });
  const sync = createOpenRpaSyncService({ identity, registry, drift, linking, documents, db, clock });
  const conflicts = createOpenRpaConflictReview({ sync, drift, db, clock });
  const bundles = createOpenRpaBundleStore({
    identity,
    registry,
    profiles,
    linking,
    documents,
    files,
    getMode: () => mode,
    db,
    clock,
  });

  function resolveWebSocket() {
    if (WebSocketImpl !== undefined) return WebSocketImpl;
    return typeof WebSocket !== "undefined" ? WebSocket : null;
  }

  function buildTransport() {
    if (mode === "live") {
      const profile = profiles.active();
      if (!profile) throw new Error("No connection profile is selected. Create one first.");
      return createWebSocketTransport({ url: endpointOf(profile), WebSocketImpl: resolveWebSocket() });
    }
    return emulator.transport();
  }

  if (typeof client.onState === "function") {
    client.onState((event) => {
      bridge.handleState(event);
      if (!emit) return;
      if (event.to === "connected") {
        emit("connector.health", { connector: OPENRPA_ID, status: "up", checkedAt: event.at }, { source: OPENRPA_ID }).catch(() => {});
      } else if (event.to === "error") {
        emit("connector.health", { connector: OPENRPA_ID, status: "down", checkedAt: event.at }, { source: OPENRPA_ID }).catch(() => {});
      }
    });
  }

  function setMode(next) {
    if (!OPENRPA_MODES.includes(next)) return { ok: false, error: `Unknown mode "${next}".` };
    if (next === mode) return { ok: true, mode };
    if (client.connected()) disconnect();
    mode = next;
    return { ok: true, mode };
  }

  async function connect({ profileId = null, mode: nextMode = null, announce = true } = {}) {
    if (nextMode) {
      const switched = setMode(nextMode);
      if (!switched.ok) return switched;
    }
    if (mode === "live") {
      if (profileId && !(await profiles.setActive(profileId))) return { ok: false, error: `No profile with id "${profileId}".` };
      if (!profiles.active()) return { ok: false, error: "Create or select a connection profile before connecting." };
    }
    if (client.connected()) return { ok: true, mode, state: client.state() };
    client.setTransport(null);
    const result = await client.connect();
    if (!result.ok) return { ok: false, mode, state: client.state(), error: result.error || "The connection failed." };
    if (announce && session.isSignedIn()) {
      const fresh = await session.ensureFresh();
      if (!fresh.ok) return { ok: true, mode, state: client.state(), warning: fresh.error };
    }
    return { ok: true, mode, state: client.state() };
  }

  function disconnect() {
    const result = client.disconnect();
    client.setTransport(null);
    return { ok: result, state: client.state() };
  }

  async function request(command, data = null, options = {}) {
    if (!client.connected()) {
      const result = await connect({ announce: false });
      if (!result.ok) throw new Error(result.error || "Not connected to OpenFlow.");
    }
    return client.request(command, data, options);
  }

  function notify(command, data = null) {
    return client.notify(command, data);
  }

  async function signIn(credentials) {
    if (!client.connected()) {
      const result = await connect({ announce: false });
      if (!result.ok) return { ok: false, error: result.error || "Not connected to OpenFlow." };
    }
    return session.signIn(credentials);
  }

  function signOut() {
    return session.signOut();
  }

  async function probe() {
    const started = clock();
    try {
      await request("ping", {}, { attempts: 1, timeoutMs: 4000 });
      return { ok: true, latencyMs: Math.max(0, clock() - started), state: client.state() };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : String(error), state: client.state() };
    }
  }

  async function health() {
    const protocol = client.stats();
    const countsResult = await workitems.countsFor(null);
    const counts = countsResult.ok ? countsResult.counts : {};
    const total = countsResult.ok ? countsResult.total : 0;
    const attempts = protocol.received + protocol.failed;
    const errorRate = attempts > 0 ? protocol.failed / attempts : 0;
    const latencyMs = protocol.lastLatencyMs;
    let status = "down";
    if (protocol.connected) {
      if (errorRate >= OPENRPA_HEALTH_THRESHOLDS.errorRate || (latencyMs != null && latencyMs >= OPENRPA_HEALTH_THRESHOLDS.degradedMs)) status = "degraded";
      else status = "up";
    } else if (protocol.state === "connecting" || protocol.state === "reconnecting") {
      status = "degraded";
    }
    const recent = protocol.reconnectCount || protocol.reconnects || 0;
    return {
      connector: OPENRPA_ID,
      name: OPENRPA_DESCRIPTOR.name,
      mode,
      state: protocol.state,
      connected: protocol.connected,
      status,
      latencyMs,
      averageLatencyMs: latencyMs,
      reconnects: protocol.reconnects,
      reconnectCount: recent,
      reconnectWarning: recent >= OPENRPA_HEALTH_THRESHOLDS.reconnectWarn,
      queueDepths: counts,
      queueTotal: total,
      pendingQueue: counts.new || 0,
      processingQueue: counts.processing || 0,
      failedQueue: counts.failed || 0,
      sent: protocol.sent,
      received: protocol.received,
      failed: protocol.failed,
      timeouts: protocol.timeouts,
      retried: protocol.retried,
      errorCount: protocol.errors,
      errorRate,
      attempts,
      thresholds: OPENRPA_HEALTH_THRESHOLDS,
      checkedAt: new Date(clock()).toISOString(),
    };
  }

  function entry() {
    return { ...OPENRPA_DESCRIPTOR, connectionState: client.state(), mode };
  }

  function status() {
    const profile = profiles.active();
    return {
      id: OPENRPA_ID,
      name: OPENRPA_DESCRIPTOR.name,
      mode,
      state: client.state(),
      connected: client.connected(),
      endpoint: mode === "live" ? endpointOf(profile) : "in-browser OpenFlow emulator",
      profile,
      registry: entry(),
      session: session.sessionInfo(),
      protocol: client.stats(),
      profiles: profiles.stats(),
      emulator: mode === "emulator" ? emulator.stats() : null,
      documents: documents.stats(),
      acl: acl.stats(),
      workitems: workitems.stats(),
      files: files.stats(),
      invocation: invocation.stats(),
      robots: robots.stats(),
      nodered: nodered.stats(),
      bridge: bridge.stats(),
      linking: linking.stats(),
      drift: drift.stats(),
      sync: sync.stats(),
      conflicts: conflicts.stats(),
      bundles: bundles.stats(),
    };
  }

  async function ready() {
    const profileState = await profiles.ready();
    const sessionState = await session.ready();
    await bridge.ready();
    await linking.hydrate();
    await drift.hydrate();
    await sync.hydrate();
    await conflicts.hydrate();
    await bundles.hydrate();
    return { profiles: profileState.profiles, session: sessionState.session, bundles: bundles.stats().total };
  }

  async function reset() {
    await session.reset();
    await profiles.reset();
    documents.reset();
    acl.reset();
    workitems.reset();
    files.reset();
    invocation.reset();
    robots.reset();
    nodered.reset();
    await bridge.reset();
    await linking.reset();
    await drift.reset();
    await sync.reset();
    await conflicts.reset();
    await bundles.reset();
    emulator.reset();
    client.reset();
    mode = "emulator";
  }

  return {
    id: OPENRPA_ID,
    descriptor: OPENRPA_DESCRIPTOR,
    entry,
    mode: () => mode,
    setMode,
    connect,
    disconnect,
    request,
    notify,
    signIn,
    signOut,
    probe,
    health,
    status,
    validateProfile,
    parse: validateProfile,
    endpointOf,
    onState: client.onState,
    onMessage: client.onMessage,
    onCommand,
    profiles,
    session,
    emulator,
    protocol: client,
    ready,
    reset,
    stats: () => {
      const protocol = client.stats();
      return {
        state: protocol.state,
        mode,
        profiles: profiles.count(),
        collections: emulator.stats().collections,
        documents: emulator.stats().total,
        commands: emulator.stats().commands,
        sent: protocol.sent,
        received: protocol.received,
        retried: protocol.retried,
        timeouts: protocol.timeouts,
        signedIn: session.isSignedIn(),
        invocations: invocation.stats().invoked,
        pendingInvocations: invocation.stats().pending,
        robots: emulator.stats().documents.openrpa_robot || 0,
        nodered: emulator.stats().documents.nodered || 0,
        bridgeEvents: bridge.stats().emitted,
        bridgeBuffered: bridge.stats().buffered,
        bridgeJournal: bridge.stats().journal,
        links: linking.stats().links,
        linksUnresolved: linking.stats().unresolved,
        driftOpen: drift.stats().open,
        syncChanges: sync.stats().changes,
        decisions: conflicts.stats().decisions,
        bundles: bundles.stats().total,
      };
    },
    documents,
    acl,
    workitems,
    files,
    invocation,
    bridge,
    robots,
    nodered,
    linking,
    drift,
    sync,
    conflicts,
    bundles,
  };
}
