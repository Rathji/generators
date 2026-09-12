import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { createDb } from "../core/db.js";
import { createPermissions } from "../core/permissions.js";
import { TOOL_ROLE_MAPS } from "../core/catalog.js";
import { createOpenRpaConnector } from "../core/openrpa/connector.js";
import {
  createEventBridge,
  translateOpenRpaCommand,
  OPENRPA_BRIDGE_DROP_POLICIES,
  OPENRPA_BRIDGE_COMMANDS,
} from "../core/openrpa/bridge.js";
import {
  OPENRPA_TAXONOMY_VERSION,
  OPENRPA_TOPICS,
  OPENRPA_EVENT_TYPES,
  OPENRPA_TOPIC_PATTERNS,
  topicFor,
  isOpenRpaTopic,
  registerOpenRpaTaxonomy,
  describeTaxonomy,
} from "../core/openrpa/taxonomy.js";
import { EVENT_TYPES, eventType } from "../core/event-catalog.js";
import { OPENRPA_BRIDGE_WATCH_COLLECTIONS } from "../core/openrpa/constants.js";

const BASE = Date.parse("2030-01-01T00:00:00.000Z");

function makeConnector({ clock = () => Date.now(), emit = null } = {}) {
  return createOpenRpaConnector({ permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS, clock, emit });
}

async function connected(options = {}) {
  const or = makeConnector(options);
  await or.connect({ announce: false });
  return or;
}

function tick(ms = 5) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, tries = 80) {
  for (let index = 0; index < tries; index += 1) {
    if (predicate()) return true;
    await tick();
  }
  return false;
}

function makeBridge(overrides = {}) {
  const events = [];
  const bridge = createEventBridge({
    emit: async (type, payload, options) => {
      events.push({ type, payload, options });
      return { ok: true, event: { id: "ev_test", type } };
    },
    ...overrides,
  });
  return { bridge, events };
}

suite("OpenRPA event taxonomy", () => {
  test("the taxonomy declares its topics, patterns and schema version", () => {
    assertEquals(OPENRPA_TAXONOMY_VERSION, 1);
    assertEquals(OPENRPA_TOPICS, ["workitem", "workflow", "robot", "collection"]);
    assertEquals(OPENRPA_TOPIC_PATTERNS, ["workitem.*", "workflow.*", "robot.*", "collection.*"]);
    assert(isOpenRpaTopic("workitem") && isOpenRpaTopic("collection"));
    assert(!isOpenRpaTopic("identity"));
    assertEquals(topicFor("workitem.enqueued"), "workitem");
    assertEquals(topicFor("collection.changed"), "collection");
    assertEquals(OPENRPA_EVENT_TYPES.length, 11);
    for (const entry of OPENRPA_EVENT_TYPES) {
      assertEquals(entry.version, 1);
      assertEquals(entry.category, "automation");
    }
  });

  test("every OpenRPA type is registered on the bus catalog with matching versions", () => {
    for (const entry of OPENRPA_EVENT_TYPES) {
      const catalogEntry = eventType(entry.type);
      assert(catalogEntry, `${entry.type} should be in the catalog`);
      assertEquals(catalogEntry.version, entry.version);
    }
    const report = registerOpenRpaTaxonomy({ catalog: EVENT_TYPES });
    assert(report.ok, JSON.stringify(report));
    assertEquals(report.missing, []);
    assertEquals(report.mismatched, []);
    assertEquals(report.topics, OPENRPA_TOPICS);
    assertEquals(report.types.length, OPENRPA_EVENT_TYPES.length);
    const described = describeTaxonomy();
    assertEquals(described.length, 4);
    assertEquals(described.map((entry) => entry.topic), OPENRPA_TOPICS);
  });

  test("work item pushes translate by lifecycle state", () => {
    assertEquals(translateOpenRpaCommand("workitem", { state: "new", wiqid: "q1", itemId: "wi_1" }).type, "workitem.enqueued");
    assertEquals(translateOpenRpaCommand("workitem", { state: "processing", wiqid: "q1", itemId: "wi_1" }).type, "workitem.claimed");
    assertEquals(translateOpenRpaCommand("workitem", { state: "success", itemId: "wi_1" }).type, "workitem.completed");
    assertEquals(translateOpenRpaCommand("workitem", { state: "failed", itemId: "wi_1" }).type, "workitem.failed");
    assertEquals(translateOpenRpaCommand("workitem", { state: "retry", itemId: "wi_1" }).type, "workitem.retried");
    assertEquals(translateOpenRpaCommand("queuemessage", { itemId: "wi_2", queue: "q1" }).type, "workitem.enqueued");
    assertEquals(translateOpenRpaCommand("workitem", { state: "mystery", itemId: "wi_1" }), null);
    const failed = translateOpenRpaCommand("workitem", { state: "failed", itemId: "wi_9" });
    assertEquals(failed.payload.itemId, "wi_9");
    assertEquals(typeof failed.payload.error, "string");
    assertEquals(failed.options.source, "openrpa");
    assertEquals(failed.options.subject.entityType, "workitem");
  });

  test("collection, robot and workflow pushes translate into normalized envelopes", () => {
    const changed = translateOpenRpaCommand("watchevent", { collection: "nodered", action: "inserted", id: "nr_1", docType: "nodered", version: 2, watchId: "watch_1" });
    assertEquals(changed.type, "collection.changed");
    assertEquals(changed.payload.action, "inserted");
    assertEquals(changed.payload.collection, "nodered");
    assertEquals(changed.payload.watchId, "watch_1");

    assertEquals(translateOpenRpaCommand("robot", { name: "R1", state: "offline" }).type, "robot.offline");
    assertEquals(translateOpenRpaCommand("robot", { name: "R1", state: "stale" }).type, "robot.stale");
    const beat = translateOpenRpaCommand("robot", { name: "R1", version: "1.4.21", metrics: { cpu: 4 } });
    assertEquals(beat.type, "robot.heartbeat");
    assertEquals(beat.coalesceKey, "robot.heartbeat:R1");
    assertEquals(beat.payload.version, "1.4.21");

    const progress = translateOpenRpaCommand("workflowinstance", { correlationId: "wf_1", state: "pending", progress: 0.5 });
    assertEquals(progress.type, "workflow.progress");
    assertEquals(progress.payload.correlationId, "wf_1");
    assertEquals(progress.payload.progress, 0.5);
    assertEquals(translateOpenRpaCommand("workflowinstance", { correlationId: "wf_1", state: "success" }), null);
    assertEquals(translateOpenRpaCommand("workflowinstance", { state: "pending" }), null);
    assertEquals(translateOpenRpaCommand("unknown", {}), null);
  });

  test("the bridge exposes its reversible command and policy vocabulary", () => {
    assertEquals(OPENRPA_BRIDGE_DROP_POLICIES, ["drop-oldest", "drop-newest", "coalesce"]);
    assert(OPENRPA_BRIDGE_COMMANDS.includes("workitem") && OPENRPA_BRIDGE_COMMANDS.includes("watchevent"));
    assert(OPENRPA_BRIDGE_COMMANDS.includes("robot") && OPENRPA_BRIDGE_COMMANDS.includes("workflowinstance"));
  });
});

suite("OpenRPA bridge translation and ordering", () => {
  test("delivered pushes are translated, buffered and emitted in order", async () => {
    const { bridge, events } = makeBridge({ clock: () => BASE });
    bridge.deliver("workitem", { state: "new", wiqid: "q1", itemId: "wi_1" });
    bridge.deliver("robot", { name: "R1", state: "stale" });
    bridge.deliver("workitem", { state: "failed", itemId: "wi_1", error: "boom" });
    const flushed = await bridge.flush();
    assertEquals(flushed, 3);
    assertEquals(events.map((entry) => entry.type), ["workitem.enqueued", "robot.stale", "workitem.failed"]);
    assertEquals(bridge.stats().emitted, 3);
    assertEquals(bridge.stats().translated, 3);
    assertEquals(bridge.stats().ignored, 0);
    const journal = bridge.journal();
    assertEquals(journal.map((entry) => entry.seq), [1, 2, 3]);
    assertEquals(journal.map((entry) => entry.topic), ["workitem", "robot", "workitem"]);
  });

  test("unknown pushes are ignored and terminal workflow pushes are left to the invocation service", async () => {
    const { bridge, events } = makeBridge();
    assertEquals(bridge.deliver("bogus", { a: 1 }), null);
    assertEquals(bridge.deliver("workflowinstance", { correlationId: "wf_1", state: "success" }), null);
    bridge.deliver("workflowinstance", { correlationId: "wf_1", state: "pending" });
    await bridge.flush();
    assertEquals(events.map((entry) => entry.type), ["workflow.progress"]);
    assertEquals(bridge.stats().ignored, 2);
    assertEquals(bridge.stats().received, 3);
  });

  test("handleServerCommand unpacks an envelope and honours the configured policy", async () => {
    const { bridge, events } = makeBridge();
    bridge.setDropPolicy("drop-newest");
    const result = bridge.handleServerCommand({ command: "robot", data: { name: "R2", state: "stale" } });
    assertEquals(result.type, "robot.stale");
    assertEquals(bridge.stats().dropPolicy, "drop-newest");
    await bridge.flush();
    assertEquals(events.length, 1);
  });
});

suite("OpenRPA bridge backpressure", () => {
  test("a bounded buffer drops the oldest entries under the drop-oldest policy", async () => {
    const { bridge } = makeBridge({ bufferLimit: 3 });
    for (let index = 0; index < 6; index += 1) bridge.deliver("workitem", { state: "new", itemId: `wi_${index}` });
    const stats = bridge.stats();
    assertEquals(stats.buffered, 3);
    assertEquals(stats.droppedOldest, 3);
    assertEquals(stats.droppedNewest, 0);
    await bridge.flush();
    assertEquals(bridge.stats().journal, 3);
    assertEquals(bridge.journal().map((entry) => entry.payload.itemId), ["wi_3", "wi_4", "wi_5"]);
  });

  test("the drop-newest policy refuses overflow and keeps the head", async () => {
    const { bridge } = makeBridge({ bufferLimit: 2, dropPolicy: "drop-newest" });
    for (let index = 0; index < 4; index += 1) bridge.deliver("workitem", { state: "new", itemId: `wi_${index}` });
    const stats = bridge.stats();
    assertEquals(stats.buffered, 2);
    assertEquals(stats.droppedNewest, 2);
    await bridge.flush();
    assertEquals(bridge.journal().map((entry) => entry.payload.itemId), ["wi_0", "wi_1"]);
  });

  test("the coalesce policy compacts repeated heartbeats when the buffer is full", async () => {
    const { bridge } = makeBridge({ bufferLimit: 2, dropPolicy: "coalesce" });
    bridge.deliver("robot", { name: "R1" });
    bridge.deliver("robot", { name: "R1" });
    bridge.deliver("workflowinstance", { correlationId: "wf_1", state: "pending" });
    bridge.deliver("robot", { name: "R1", metrics: { cpu: 9 } });
    assertEquals(bridge.stats().coalesced >= 1, true);
    assertEquals(bridge.stats().buffered <= 2, true);
    await bridge.flush();
    const heartbeats = bridge.journal().filter((entry) => entry.type === "robot.heartbeat");
    assertEquals(heartbeats[heartbeats.length - 1].payload.metrics.cpu, 9);
    assertEquals(bridge.stats().buffered, 0);
  });

  test("draining happens in bounded batches so the thread stays responsive", async () => {
    const { bridge, events } = makeBridge({ bufferLimit: 100, batchSize: 2 });
    for (let index = 0; index < 5; index += 1) bridge.deliver("workitem", { state: "new", itemId: `wi_${index}` });
    const first = await bridge.drain();
    assertEquals(first, 2);
    assertEquals(bridge.stats().buffered, 3);
    await bridge.flush();
    assertEquals(events.length, 5);
    assertEquals(bridge.stats().buffered, 0);
  });
});

suite("OpenRPA bridge lifecycle & streaming", () => {
  test("enabling the bridge registers the exchange and every queue", async () => {
    const or = await connected({ clock: () => BASE });
    const result = await or.bridge.enable({ collections: [] });
    assert(result.ok, JSON.stringify(result));
    assertEquals(result.queues.length, 3);
    const registration = or.bridge.registration();
    assertEquals(registration.exchange, "openrpa.bridge");
    assertEquals(registration.connected, true);
    assertEquals(registration.queues.length, 3);
    assertEquals(or.bridge.enabled(), true);
    const disabled = await or.bridge.disable();
    assertEquals(disabled.ok, true);
    assertEquals(or.bridge.enabled(), false);
    or.disconnect();
  });

  test("watches are registered and removed against the connector", async () => {
    const or = await connected({ clock: () => BASE });
    await or.bridge.enable({ collections: [] });
    const watch = await or.bridge.watch("openrpa_queue", { filter: { state: "new" } });
    assert(watch.ok, JSON.stringify(watch));
    assertEquals(or.bridge.watches().length, 1);
    assertEquals(or.bridge.watches()[0].collection, "openrpa_queue");
    const unwatched = await or.bridge.unwatch(watch.watch.watchId);
    assertEquals(unwatched.ok, true);
    assertEquals(or.bridge.watches().length, 0);
    assertEquals((await or.bridge.unwatch("missing")).ok, false);
    or.disconnect();
  });

  test("a reconnect re-registers the exchange and watches", async () => {
    const or = await connected({ clock: () => BASE });
    await or.bridge.enable({ collections: ["openrpa_robot"] });
    const before = or.bridge.stats().reconnects;
    or.protocol.reset();
    or.protocol.setTransport(null);
    const reconnected = await or.connect({ announce: false });
    assertEquals(reconnected.ok, true);
    await waitFor(() => or.bridge.stats().reconnects > before);
    assertEquals(or.bridge.stats().reconnects > before, true);
    assert(or.bridge.registration().connected, "the registration should be live after reconnect");
    or.disconnect();
  });

  test("streamed work-item, robot and collection mutations become hub events", async () => {
    const hub = await createHub({ kv: null }).ready();
    const or = hub.openrpa;
    await or.connect({ announce: false });
    const enabled = await or.bridge.enable({ collections: ["openrpa_queue", "nodered"] });
    assert(enabled.ok);
    await or.request("addworkitem", { item: { wiqid: "q-invoice", priority: "high", payload: { invoiceId: "iv_bridge" } } });
    assert(await waitFor(() => or.bridge.stats().received > 0));
    await or.robots.heartbeat("robot_01", { metrics: { cpu: 6, memory: 18 } });
    await or.request("insertone", { collection: "nodered", item: { _id: "nr_bridge", name: "flow-bridge", state: "running" } });
    await waitFor(() => or.bridge.journal().some((entry) => entry.type === "collection.changed"));
    await or.bridge.flush();
    const types = or.bridge.journal().map((entry) => entry.type);
    assert(types.includes("workitem.enqueued"), `expected workitem.enqueued in ${types.join(",")}`);
    assert(types.includes("robot.heartbeat"), `expected robot.heartbeat in ${types.join(",")}`);
    assert(types.includes("collection.changed"), `expected collection.changed in ${types.join(",")}`);
    const busTypes = hub.log.all().map((entry) => entry.type);
    assert(busTypes.includes("workitem.enqueued"));
    assert(busTypes.includes("robot.heartbeat"));
    assert(busTypes.includes("collection.changed"));
    assertEquals(hub.registry.validate().counts.error, 0);
    or.disconnect();
  });

  test("the invocation service owns terminal workflow events while the bridge reports progress", async () => {
    const hub = await createHub({ kv: null }).ready();
    const or = hub.openrpa;
    await or.connect({ announce: false });
    await or.bridge.enable({ collections: [] });
    or.bridge.deliver("workflowinstance", { correlationId: "wf_progress", state: "pending", progress: 0.25 });
    await or.bridge.flush();
    const result = await or.invocation.invoke({ workflowId: "wf_report", durationMs: 0 });
    assert(result.ok, JSON.stringify(result));
    await waitFor(() => or.bridge.stats().received > 1);
    await or.bridge.flush();
    const bridgeTypes = or.bridge.journal().map((entry) => entry.type);
    assertEquals(bridgeTypes.includes("workflow.progress"), true);
    assertEquals(bridgeTypes.includes("workflow.completed"), false);
    assertEquals(bridgeTypes.includes("workflow.failed"), false);
    const completed = hub.log.all().filter((entry) => entry.type === "workflow.completed");
    assertEquals(completed.length, 1);
    or.disconnect();
  });
});

suite("OpenRPA bridge replay, audit & persistence", () => {
  test("the journal filters by topic, type, correlation id and time range", async () => {
    let now = BASE;
    const { bridge } = makeBridge({ clock: () => now });
    bridge.deliver("workitem", { state: "new", itemId: "wi_1", wiqid: "q1" });
    bridge.deliver("robot", { name: "R1" });
    now += 60000;
    bridge.deliver("workitem", { state: "failed", itemId: "wi_1", error: "boom" });
    bridge.deliver("workflowinstance", { correlationId: "wf_a", state: "pending" });
    await bridge.flush();

    assertEquals(bridge.audit({ topic: "workitem" }).matched, 2);
    assertEquals(bridge.audit({ type: "workitem.*" }).matched, 2);
    assertEquals(bridge.audit({ type: "robot.heartbeat" }).matched, 1);
    assertEquals(bridge.audit({ correlationId: "wf_a" }).matched, 1);
    assertEquals(bridge.audit({ from: new Date(BASE + 30000).toISOString() }).matched, 2);
    assertEquals(bridge.audit({ to: new Date(BASE + 30000).toISOString() }).matched, 2);
    assertEquals(bridge.audit({ from: 3 }).matched, 2);
    assertEquals(bridge.audit({ from: 3, to: 3 }).matched, 1);
    assertEquals(bridge.recent(2).length, 2);
    assertEquals(bridge.stats().journal, 4);
    assertEquals(bridge.journal().map((entry) => entry.seq), [1, 2, 3, 4]);
  });

  test("replay walks the matching journal entries through a handler", async () => {
    const { bridge } = makeBridge();
    bridge.deliver("workitem", { state: "new", itemId: "wi_1", wiqid: "q1" });
    bridge.deliver("workitem", { state: "new", itemId: "wi_2", wiqid: "q1" });
    bridge.deliver("robot", { name: "R1" });
    await bridge.flush();
    const seen = [];
    const result = await bridge.replay({ topic: "workitem" }, (entry) => {
      seen.push(entry.payload.itemId);
    });
    assertEquals(result.matched, 2);
    assertEquals(result.replayed, 2);
    assertEquals(seen, ["wi_1", "wi_2"]);
    assertEquals(bridge.stats().replayed, 2);
    const all = await bridge.replay((entry) => seen.push(entry.type));
    assertEquals(all.matched, 3);
    assertEquals(all.replayed, 3);
  });

  test("a rejected emission is journaled but not marked delivered", async () => {
    const bridge = createEventBridge({
      emit: async () => ({ ok: false, issues: [{ message: "bad payload" }] }),
    });
    bridge.deliver("robot", { name: "R1" });
    await bridge.flush();
    assertEquals(bridge.stats().emitted, 0);
    assertEquals(bridge.stats().rejected, 1);
    assertEquals(bridge.journal()[0].delivered, false);
  });

  test("the journal hydrates from the database and keeps its sequence", async () => {
    const db = createDb({ kv: null, collections: ["openrpa_bridge"] });
    const first = makeBridge({ db });
    first.bridge.deliver("workitem", { state: "new", itemId: "wi_1", wiqid: "q1" });
    first.bridge.deliver("robot", { name: "R1" });
    await first.bridge.flush();
    assertEquals(first.bridge.stats().seq, 2);

    const second = makeBridge({ db });
    const hydrated = await second.bridge.ready();
    assertEquals(hydrated.hydrated, 2);
    assertEquals(second.bridge.stats().seq, 2);
    second.bridge.deliver("workitem", { state: "new", itemId: "wi_2", wiqid: "q1" });
    await second.bridge.flush();
    assertEquals(second.bridge.journal().map((entry) => entry.seq), [1, 2, 3]);

    await second.bridge.reset();
    assertEquals(second.bridge.stats().journal, 0);
    assertEquals(second.bridge.stats().seq, 0);
    const third = makeBridge({ db });
    assertEquals((await third.bridge.ready()).hydrated, 0);
  });
});

suite("OpenRPA bridge hub integration", () => {
  test("the ready hub exposes the bridge and its watch defaults", async () => {
    const hub = await createHub({ kv: null }).ready();
    assert(hub.openrpa.bridge, "hub.openrpa.bridge should exist");
    assertEquals(typeof hub.openrpa.bridge.enable, "function");
    assertEquals(hub.openrpa.bridge.watchCollections, OPENRPA_BRIDGE_WATCH_COLLECTIONS);
    assertEquals(hub.openrpa.status().bridge.exchange, "openrpa.bridge");
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("enabling the bridge registers queues and publishes normalized events onto the bus", async () => {
    const hub = await createHub({ kv: null }).ready();
    const enabled = await hub.openrpa.bridge.enable({ collections: ["openrpa_robot"] });
    assert(enabled.ok, JSON.stringify(enabled));
    assertEquals(enabled.queues.length, 3);
    await hub.openrpa.robots.heartbeatAll({ metricsFor: () => ({ cpu: 3, memory: 12 }) });
    await waitFor(() => hub.openrpa.bridge.stats().journal > 0);
    await hub.openrpa.bridge.flush();
    const types = hub.openrpa.bridge.journal().map((entry) => entry.type);
    assert(types.includes("robot.heartbeat"), `expected robot.heartbeat in ${types.join(",")}`);
    const busTypes = hub.log.all().map((entry) => entry.type);
    assert(busTypes.includes("robot.heartbeat"));
    assertEquals(hub.monitor.errors().total, 0);
  });

  test("resetting the hub clears the bridge journal and subscriptions", async () => {
    const hub = await createHub({ kv: null }).ready();
    await hub.openrpa.bridge.enable({ collections: ["openrpa_robot"] });
    await hub.openrpa.robots.heartbeat("robot_01", { metrics: { cpu: 2 } });
    await waitFor(() => hub.openrpa.bridge.stats().journal > 0);
    await hub.openrpa.bridge.flush();
    assert(hub.openrpa.bridge.stats().journal > 0);
    await hub.resetData();
    assertEquals(hub.openrpa.bridge.stats().journal, 0);
    assertEquals(hub.openrpa.bridge.watches().length, 0);
    assertEquals(hub.openrpa.bridge.enabled(), false);
    assertEquals(hub.registry.validate().counts.error, 0);
  });
});
