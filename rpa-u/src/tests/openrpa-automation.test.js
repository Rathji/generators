import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { createPermissions } from "../core/permissions.js";
import { TOOL_ROLE_MAPS } from "../core/catalog.js";
import { createOpenRpaConnector } from "../core/openrpa/connector.js";
import { eventType } from "../core/event-catalog.js";
import { samplePayload, validateEnvelope } from "../core/event-schema.js";
import { OPENRPA_HEALTH_THRESHOLDS } from "../core/openrpa/constants.js";
import {
  OPENRPA_INVOCATION_STATES,
  OPENRPA_INVOCATION_TERMINAL,
  isTerminalInvocation,
  makeCorrelationId,
  normalizeState,
  normalizeInvocation,
} from "../core/openrpa/invocation.js";
import { OPENRPA_ROBOT_PRESENCE, presenceFor, formatAge, normalizeRobot } from "../core/openrpa/robots.js";
import { OPENRPA_NODERED_STATES, normalizeInstance } from "../core/openrpa/nodered.js";

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

async function waitFor(predicate, tries = 60) {
  for (let index = 0; index < tries; index += 1) {
    if (predicate()) return true;
    await tick();
  }
  return false;
}

suite("OpenRPA invocation helpers", () => {
  test("invocation states, terminality and correlation ids are declared", () => {
    assertEquals(OPENRPA_INVOCATION_STATES, ["pending", "success", "failed", "timeout", "cancelled"]);
    assertEquals(OPENRPA_INVOCATION_TERMINAL, ["success", "failed", "timeout", "cancelled"]);
    assert(isTerminalInvocation("success") && isTerminalInvocation("timeout") && isTerminalInvocation("cancelled"));
    assert(!isTerminalInvocation("pending"));
    const id = makeCorrelationId("wf_invoice");
    assert(/^wf_[0-9a-z]{4,}$/.test(id), `unexpected correlation id: ${id}`);
  });

  test("server states normalise and a record carries the audit fields", () => {
    assertEquals(normalizeState("completed"), "success");
    assertEquals(normalizeState("Faulted"), "failed");
    assertEquals(normalizeState("timedout"), "timeout");
    assertEquals(normalizeState("pending"), "pending");
    const record = normalizeInvocation({ correlationId: "wf_1", workflowid: "wf_invoice", state: "success", durationMs: "42", result: { ok: true } });
    assertEquals(record.correlationId, "wf_1");
    assertEquals(record.workflowId, "wf_invoice");
    assertEquals(record.state, "success");
    assertEquals(record.terminal, true);
    assertEquals(record.durationMs, 42);
    assertEquals(record.result, { ok: true });
  });

  test("robot presence is derived from the last-seen age", () => {
    assertEquals(OPENRPA_ROBOT_PRESENCE, ["online", "stale", "offline", "unknown"]);
    assertEquals(presenceFor(null), "unknown");
    assertEquals(presenceFor(1000), "online");
    assertEquals(presenceFor(200000), "stale");
    assertEquals(presenceFor(900000), "offline");
    assert(formatAge(45000).includes("s"));
    const robot = normalizeRobot({ _id: "robot_01", name: "ROBOT-A", lastseen: new Date(BASE - 45000).toISOString(), version: "1.4.21", metrics: { cpu: 12, memory: 41 } }, { now: BASE });
    assertEquals(robot.presence, "online");
    assertEquals(robot.version, "1.4.21");
    assertEquals(robot.cpu, 12);
    assertEquals(normalizeRobot({ name: "x" }, { now: BASE }).presence, "unknown");
  });

  test("a Node-RED instance normalises its state and link", () => {
    assertEquals(OPENRPA_NODERED_STATES, ["running", "stopped", "error", "unknown"]);
    const instance = normalizeInstance({ _id: "nr_1", name: "flow", state: "running", version: "3.1.0", connectorId: "openrpa", _version: 3 });
    assertEquals(instance.state, "running");
    assertEquals(instance.version, "3.1.0");
    assertEquals(instance.docVersion, 3);
    assertEquals(instance.linked, true);
    assertEquals(instance.linkedToExpected, true);
    assertEquals(normalizeInstance({ state: "bogus" }).state, "unknown");
  });

  test("the workflow event types are registered and their samples validate", () => {
    for (const type of ["workflow.invoked", "workflow.completed", "workflow.failed"]) {
      const entry = eventType(type);
      assert(entry, `${type} should be in the catalog`);
      assertEquals(entry.category, "automation");
      const report = validateEnvelope({ id: "ev_test01", type, version: 1, source: "openrpa", time: new Date().toISOString(), seq: 1, payload: samplePayload(type) });
      assert(report.ok, `${type} sample failed: ${JSON.stringify(report.issues)}`);
    }
  });
});

suite("OpenRPA workflow invocation", () => {
  test("invoke awaits the correlated completion and emits audit events", async () => {
    let now = BASE;
    const events = [];
    const or = await connected({ clock: () => now, emit: async (type, payload) => { events.push({ type, payload }); return { ok: true }; } });

    const promise = or.invocation.invoke({ workflowId: "wf_invoice", payload: { invoiceId: "iv_9001" }, actor: "tester", durationMs: 60000 });
    assert(await waitFor(() => or.emulator.instances().length > 0), "the emulator should have scheduled an instance");
    assertEquals(or.invocation.pending().length, 1);

    now += 60500;
    or.emulator.sweep();
    const result = await promise;
    assert(result.ok, JSON.stringify(result));
    assertEquals(result.invocation.state, "success");
    assertEquals(result.invocation.actor, "tester");
    assertEquals(result.invocation.payload.invoiceId, "iv_9001");
    assert(result.invocation.instanceId, "the reply should carry the instance id");
    assertEquals(result.invocation.durationMs, 60000);
    assertEquals(or.invocation.pending().length, 0);

    const types = events.map((entry) => entry.type);
    assert(types.includes("workflow.invoked"), "invoked should be emitted");
    assert(types.includes("workflow.completed"), "completed should be emitted");
    const completed = events.find((entry) => entry.type === "workflow.completed");
    assertEquals(completed.payload.correlationId, result.invocation.correlationId);
    assertEquals(or.invocation.get(result.invocation.correlationId).state, "success");
    assertEquals(or.invocation.stats().completed, 1);
    or.disconnect();
  });

  test("a simulated failure resolves as failed with the error detail", async () => {
    let now = BASE;
    const events = [];
    const or = await connected({ clock: () => now, emit: async (type, payload) => { events.push({ type, payload }); return { ok: true }; } });
    const promise = or.invocation.invoke({ workflowId: "wf_onboard", simulateError: true, errorMessage: "AD group missing", durationMs: 60000 });
    assert(await waitFor(() => or.emulator.instances().length > 0));
    now += 61000;
    or.emulator.sweep();
    const result = await promise;
    assertEquals(result.invocation.state, "failed");
    assertEquals(result.invocation.error, "AD group missing");
    assertEquals(result.invocation.result, null);
    assert(events.some((entry) => entry.type === "workflow.failed" && entry.payload.error === "AD group missing"));
    assertEquals(or.invocation.stats().failed, 1);
    or.disconnect();
  });

  test("an invocation that never completes times out and stays correlatable", async () => {
    const or = await connected();
    const result = await or.invocation.invoke({ workflowId: "wf_backup", durationMs: 60000, timeoutMs: 250 });
    assertEquals(or.emulator.instances().length >= 0, true);
    assertEquals(result.invocation.state, "timeout");
    assert(result.timedOut);
    assert(/did not complete/i.test(result.invocation.error));
    assertEquals(or.invocation.stats().timeouts, 1);
    assertEquals(or.invocation.get(result.invocation.correlationId).state, "timeout");
    or.disconnect();
  });

  test("dispatch only returns immediately and can be cancelled", async () => {
    const or = await connected();
    const dispatched = await or.invocation.invoke({ workflowId: "wf_report", wait: false, correlationId: "wf_manual01", durationMs: 60000 });
    assert(dispatched.ok, JSON.stringify(dispatched));
    assertEquals(dispatched.awaiting, true);
    assertEquals(dispatched.invocation.state, "pending");
    assertEquals(or.invocation.pending().length, 1);
    assert(await waitFor(() => or.emulator.instances().length > 0), "the instance should be dispatched");

    const duplicate = await or.invocation.invoke({ workflowId: "wf_report", wait: false, correlationId: "wf_manual01" });
    assertEquals(duplicate.error.code, "duplicate-correlation");

    const cancelled = await or.invocation.cancel("wf_manual01");
    assert(cancelled.ok, JSON.stringify(cancelled));
    assertEquals(cancelled.invocation.state, "cancelled");
    assertEquals(or.invocation.stats().cancelled, 1);
    assertEquals((await or.invocation.cancel("wf_manual01")).error.code, "not-pending");
    assertEquals((await or.invocation.cancel("")).error.code, "missing-id");
    or.disconnect();
  });

  test("invalid invocations are rejected before dispatch", async () => {
    const or = await connected();
    assertEquals((await or.invocation.invoke({})).error.code, "missing-target");
    assertEquals((await or.invocation.invoke({ workflowId: "wf_invoice", payload: [1, 2] })).error.code, "invalid-payload");
    assertEquals((await or.invocation.invoke({ queue: "", workflowId: "" })).error.code, "missing-target");
    or.disconnect();
  });

  test("stats and reset clear invocation state", async () => {
    let now = BASE;
    const or = await connected({ clock: () => now });
    const promise = or.invocation.invoke({ workflowId: "wf_invoice", durationMs: 60000 });
    assert(await waitFor(() => or.emulator.instances().length > 0));
    now += 61000;
    or.emulator.sweep();
    await promise;
    assert(or.invocation.stats().invoked >= 1);
    assert(or.invocation.history({ limit: 5 }).length >= 1);
    or.invocation.reset();
    assertEquals(or.invocation.stats().invoked, 0);
    assertEquals(or.invocation.stats().pending, 0);
    assertEquals(or.invocation.history().length, 0);
    or.disconnect();
  });
});

suite("OpenRPA robots & Node-RED", () => {
  test("robots are discovered with derived presence and metrics", async () => {
    const or = await connected();
    const result = await or.robots.list();
    assert(result.ok, JSON.stringify(result));
    assert(result.robots.length >= 3, "expected the seeded fleet");
    const byId = new Map(result.robots.map((robot) => [robot.id, robot]));
    assertEquals(byId.get("robot_01").presence, "online");
    assertEquals(byId.get("robot_02").presence, "stale");
    assertEquals(byId.get("robot_03").presence, "offline");
    assertEquals(byId.get("robot_01").version, "1.4.21");

    const summary = or.robots.summarize(result.robots);
    assert(summary.online >= 1 && summary.stale >= 1 && summary.offline >= 1, JSON.stringify(summary));
    assertEquals(summary.total, result.robots.length);

    const one = await or.robots.get("robot_02");
    assertEquals(one.robot.id, "robot_02");
    assertEquals((await or.robots.get("nope")).robot, null);
    or.disconnect();
  });

  test("a heartbeat brings an offline robot back online", async () => {
    const or = await connected();
    const before = await or.robots.get("robot_03");
    assertEquals(before.robot.presence, "offline");
    const beat = await or.robots.heartbeat("robot_03", { metrics: { cpu: 5, memory: 20 } });
    assert(beat.ok, JSON.stringify(beat));
    assertEquals(beat.robot.presence, "online");
    assertEquals(beat.robot.cpu, 5);
    assertEquals(or.robots.stats().heartbeats, 1);

    const all = await or.robots.heartbeatAll({ metricsFor: () => ({ cpu: 8, memory: 22 }) });
    assertEquals(all.ok, true);
    assertEquals(all.total >= 3, true);
    assertEquals((await or.robots.list()).robots.every((robot) => robot.presence === "online"), true);
    or.disconnect();
  });

  test("Node-RED instances can be listed, ensured, restarted, linked and removed", async () => {
    const or = await connected();
    const listed = await or.nodered.list();
    assert(listed.ok, JSON.stringify(listed));
    assertEquals(listed.instances.length, 2);
    const invoice = listed.instances.find((entry) => entry.name === "flow-invoice");
    assertEquals(invoice.state, "running");
    assertEquals(listed.instances.find((entry) => entry.name === "flow-notify").state, "stopped");

    const ensured = await or.nodered.ensure("flow-new", { url: "https://nodered.example.com/new" });
    assert(ensured.ok, JSON.stringify(ensured));
    assertEquals(ensured.instance.name, "flow-new");
    assertEquals(ensured.instance.state, "running");
    assertEquals((await or.nodered.list()).instances.length, 3);

    const restarted = await or.nodered.restart("flow-notify");
    assertEquals(restarted.instance.state, "running");

    const linked = await or.nodered.link("flow-invoice", { connectorId: "openrpa" });
    assert(linked.ok, JSON.stringify(linked));
    assertEquals(linked.instance.connectorId, "openrpa");
    assertEquals((await or.nodered.links()).links.some((entry) => entry.name === "flow-invoice"), true);
    const unlinked = await or.nodered.unlink("flow-invoice");
    assertEquals(unlinked.instance.linked, false);

    const removed = await or.nodered.remove("flow-new");
    assertEquals(removed.deleted, 1);
    assertEquals((await or.nodered.list()).instances.length, 2);
    assertEquals((await or.nodered.restart("ghost")).error.kind, "not-found");
    assertEquals((await or.nodered.ensure("")).error.code, "missing-name");
    assertEquals(or.nodered.summarize(listed.instances).running, 1);
    or.disconnect();
  });
});

suite("OpenRPA connector health", () => {
  test("health composes protocol counters, queue depths and thresholds", async () => {
    let now = BASE;
    const or = await connected({ clock: () => now });
    await or.probe();
    const health = await or.health();
    assertEquals(health.connector, "openrpa");
    assertEquals(health.connected, true);
    assertEquals(health.status, "up");
    assertEquals(health.mode, "emulator");
    assert(health.latencyMs >= 0);
    assertEquals(typeof health.queueDepths.new, "number");
    assert(health.queueTotal >= 3, "expected seeded work items in the depths");
    assertEquals(health.thresholds.degradedMs, OPENRPA_HEALTH_THRESHOLDS.degradedMs);
    assertEquals(health.errorRate, 0);
    or.disconnect();
    const down = await or.health();
    assertEquals(down.connected, false);
    assertEquals(down.status, "down");
  });
});

suite("OpenRPA automation hub integration", () => {
  test("the ready hub exposes invocation, robots, Node-RED and health", async () => {
    const hub = await createHub({ kv: null }).ready();
    for (const key of ["invocation", "robots", "nodered", "health"]) {
      assert(hub.openrpa[key], `hub.openrpa.${key} should exist`);
    }
    assertEquals(hub.registry.validate().counts.error, 0);
    const robots = await hub.openrpa.robots.list();
    assert(robots.ok && robots.robots.length >= 3);
    const nodered = await hub.openrpa.nodered.list();
    assert(nodered.ok && nodered.instances.length >= 2);
    const health = await hub.openrpa.health();
    assert(health && typeof health.status === "string");
    const status = hub.openrpa.status();
    assert(status.invocation && status.robots && status.nodered, "status should report the automation subsystems");
  });

  test("invoking a workflow through the hub records correlated events on the bus", async () => {
    const hub = await createHub({ kv: null }).ready();
    const result = await hub.openrpa.invocation.invoke({ workflowId: "wf_invoice", payload: { invoiceId: "iv_9002" }, actor: "ada" });
    assert(result.ok, JSON.stringify(result));
    assertEquals(result.invocation.state, "success");
    const correlationId = result.invocation.correlationId;
    const types = hub.log.all().map((entry) => entry.type);
    assert(types.includes("workflow.invoked"), "the bus should carry workflow.invoked");
    assert(types.includes("workflow.completed"), "the bus should carry workflow.completed");
    const completed = hub.log.all().find((entry) => entry.type === "workflow.completed");
    assertEquals(completed.payload.correlationId, correlationId);
    assertEquals(hub.monitor.errors().total, 0);
    assertEquals(hub.registry.validate().counts.error, 0);
  });

  test("resetting the hub clears invocation and robot counters", async () => {
    const hub = await createHub({ kv: null }).ready();
    await hub.openrpa.robots.heartbeatAll();
    await hub.openrpa.invocation.invoke({ workflowId: "wf_report", durationMs: 0 });
    assert(hub.openrpa.robots.stats().heartbeats > 0);
    assert(hub.openrpa.invocation.stats().invoked > 0);
    await hub.resetData();
    assertEquals(hub.openrpa.robots.stats().heartbeats, 0);
    assertEquals(hub.openrpa.invocation.stats().invoked, 0);
    assertEquals(hub.openrpa.invocation.history().length, 0);
  });
});
