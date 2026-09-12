import { suite, test, assert, assertEquals, assertThrows } from "./harness.js";
import { createHub } from "../core/hub.js";
import { createPermissions } from "../core/permissions.js";
import { TOOL_ROLE_MAPS } from "../core/catalog.js";
import { createProtocolClient, createLoopbackTransport, encodeData, decodeData, parseEnvelope } from "../core/openrpa/protocol.js";
import { createEmulator } from "../core/openrpa/emulator.js";
import { createProfileStore, validateProfile, parseEndpoint, endpointOf } from "../core/openrpa/profiles.js";
import { createSessionManager, mintJwt, decodeJwt } from "../core/openrpa/session.js";
import { createOpenRpaConnector } from "../core/openrpa/connector.js";
import { OPENRPA_ID, OPENRPA_DESCRIPTOR, OPENRPA_CAPABILITIES, OPENRPA_CONNECTION_FIELDS } from "../core/openrpa/constants.js";

function replyTo(envelope, command, data) {
  return { id: `rep_${Math.random().toString(36).slice(2)}`, replyto: envelope.id, command, data: encodeData(data) };
}

function request(command, data, id = "req_test01") {
  return { id, replyto: null, command, data: encodeData(data) };
}

suite("OpenRPA registry & identity", () => {
  test("the OpenRPA descriptor declares its brand, capability set and connection fields", () => {
    assertEquals(OPENRPA_DESCRIPTOR.id, OPENRPA_ID);
    assertEquals(OPENRPA_DESCRIPTOR.name, "OpenRPA");
    assert(OPENRPA_DESCRIPTOR.accent.match(/^#[0-9a-f]{6}$/i), "the connector needs a brand colour");
    assert(OPENRPA_CAPABILITIES.length >= 5, "expected a capability set");
    assert(OPENRPA_CONNECTION_FIELDS.some((entry) => entry.key === "host"), "host is a required connection field");
    assertEquals(OPENRPA_DESCRIPTOR.connectionState, "disconnected");
  });

  test("the hub registers OpenRPA as a first-class connector", async () => {
    const hub = await createHub({ kv: null }).ready();
    const connector = hub.registry.connector("openrpa");
    assert(connector, "OpenRPA should be in the integration registry");
    assertEquals(connector.name, "OpenRPA");
    assert(hub.permissions.toolRoles("openrpa").length >= 3, "OpenRPA roles should be mapped");
    assertEquals(hub.registry.validate().counts.error, 0);
    assertEquals(hub.permissions.validate().counts.error, 0);
  });

  test("OpenFlow roles translate onto the canonical permission model", () => {
    const permissions = createPermissions();
    assertEquals(permissions.canonicalRolesFor("openrpa", "Administrator"), ["admin"]);
    assertEquals(permissions.canonicalRolesFor("openrpa", "Robot Operator"), ["technician"]);
    assert(permissions.hasCapability({ connector: "openrpa", toolRole: "Administrator" }, "registry.write"));
    assert(!permissions.hasCapability({ connector: "openrpa", toolRole: "Viewer" }, "device.control"));
  });

  test("the event bus accepts OpenRPA as an event source and the monitor probes it", async () => {
    const hub = await createHub({ kv: null }).ready();
    const published = await hub.publish("connector.health", { connector: "openrpa", status: "up" }, { source: "openrpa" });
    assert(published.ok, "an OpenRPA-sourced envelope should validate");
    assertEquals(published.issues.filter((issue) => issue.code === "unknown-source").length, 0);
    const probe = hub.monitor.connector("openrpa");
    assert(probe, "the connector monitor should know OpenRPA");
    assertEquals(probe.status, "up");
    assert(probe.latencyMs > 0);
  });

  test("new OpenRPA collections live under the hub namespace", async () => {
    const hub = await createHub({ kv: null }).ready();
    const collections = hub.db.collections();
    for (const name of ["openrpa_profiles", "openrpa_session", "openrpa_emulator", "openrpa_bridge", "openrpa_links", "openrpa_sync", "openrpa_bundles"]) {
      assert(collections.includes(name), `expected collection ${name}`);
    }
  });
});

suite("OpenRPA connection profiles", () => {
  test("validation reports precise, field-level errors", () => {
    const empty = validateProfile({});
    assertEquals(empty.ok, false);
    assert(empty.errors.some((error) => error.code === "required" && error.field === "name"));
    assert(empty.errors.some((error) => error.code === "required" && error.field === "host"));

    assert(validateProfile({ name: "x", host: "h.example.com" }).errors.some((error) => error.code === "too-short"));
    assert(validateProfile({ name: "HQ", scheme: "ftp", host: "h.example.com" }).errors.some((error) => error.code === "invalid-scheme"));
    assert(validateProfile({ name: "HQ", host: "h.example.com", port: 99999 }).errors.some((error) => error.code === "invalid-port"));
    assert(validateProfile({ name: "HQ", host: "https://h.example.com" }).errors.some((error) => error.code === "invalid-host"));
    assert(validateProfile({ name: "HQ", host: "h.example.com", restBase: "not-a-url" }).errors.some((error) => error.code === "invalid-restbase"));
  });

  test("a full URL is decomposed into scheme, host, port and path", () => {
    const report = validateProfile({ name: "Head office", url: "wss://openflow.example.com:8443/ws/hub" });
    assert(report.ok, JSON.stringify(report.errors));
    assertEquals(report.profile.scheme, "wss");
    assertEquals(report.profile.host, "openflow.example.com");
    assertEquals(report.profile.port, 8443);
    assertEquals(report.profile.path, "/ws/hub");
    assertEquals(report.profile.url, "wss://openflow.example.com:8443/ws/hub");
    assertEquals(endpointOf(report.profile), "wss://openflow.example.com:8443/ws/hub");
  });

  test("scheme and host fill sensible defaults and normalise the path", () => {
    const ws = parseEndpoint({ scheme: "ws", host: "10.0.0.5" });
    assert(ws.ok);
    assertEquals(ws.endpoint.port, 80);
    assertEquals(ws.endpoint.url, "ws://10.0.0.5:80/");
    const bumped = parseEndpoint({ scheme: "wss", host: "openflow.example.com", path: "ws" });
    assertEquals(bumped.endpoint.path, "/ws");
    assertEquals(bumped.endpoint.port, 443);
    const insecure = validateProfile({ name: "Lab", host: "lab.local", insecure: true, organization: "Northwind" });
    assert(insecure.ok);
    assertEquals(insecure.profile.insecure, true);
    assertEquals(insecure.profile.organization, "Northwind");
  });

  test("the store creates, activates, updates and removes profiles", async () => {
    const store = createProfileStore({ db: null, clock: () => 1000 });
    const first = await store.create({ name: "Alpha", host: "alpha.example.com" });
    assert(first.ok, JSON.stringify(first.errors));
    assertEquals(store.active().id, first.profile.id, "the first profile becomes active");
    const second = await store.create({ name: "Beta", scheme: "ws", host: "beta.example.com", port: 8080 });
    assert(second.ok);
    assertEquals(store.list().length, 2);
    assert(await store.setActive(second.profile.id));
    assertEquals(store.active().name, "Beta");
    assertEquals(store.stats().schemes.ws, 1);
    assertEquals(store.stats().schemes.wss, 1);

    const updated = await store.update(first.profile.id, { name: "Alpha 2", host: "alpha.example.com" });
    assert(updated.ok);
    assertEquals(store.get(first.profile.id).name, "Alpha 2");
    assert(store.get(first.profile.id).createdAt, "createdAt should survive an update");

    const rejected = await store.create({ name: "", host: "" });
    assertEquals(rejected.ok, false);
    await store.remove(second.profile.id);
    assertEquals(store.active(), null, "removing the active profile clears the pointer");
    await store.reset();
    assertEquals(store.count(), 0);
  });
});

suite("OpenRPA wire protocol", () => {
  test("envelopes encode data and correlate by reply-to", async () => {
    assertEquals(decodeData(encodeData({ a: 1 })), { a: 1 });
    assertEquals(decodeData("plain text"), "plain text");
    const parsed = parseEnvelope('{"id":"req_1","command":"ping","data":"{}"}');
    assertEquals(parsed.command, "ping");
    assertThrows(() => parseEnvelope("not json"));

    let seen = null;
    const client = createProtocolClient({
      transport: createLoopbackTransport({
        handler: (envelope) => {
          seen = envelope;
          return replyTo(envelope, envelope.command, { pong: true, echo: decodeData(envelope.data).value });
        },
      }),
      maxAttempts: 1,
      baseBackoffMs: 1,
    });
    const connected = await client.connect();
    assert(connected.ok, connected.error);
    const data = await client.request("ping", { value: 42 });
    assertEquals(data, { pong: true, echo: 42 });
    assertEquals(seen.command, "ping");
    assertEquals(seen.replyto, null);
    assertEquals(client.stats().received, 1);
    client.disconnect();
  });

  test("a request times out and a protocol error does not retry", async () => {
    const silent = createProtocolClient({
      transport: createLoopbackTransport({ handler: () => null }),
      maxAttempts: 1,
      requestTimeoutMs: 30,
      baseBackoffMs: 1,
    });
    await silent.connect();
    let timedOut = null;
    try {
      await silent.request("ping", {});
    } catch (error) {
      timedOut = error;
    }
    assert(timedOut && timedOut.code === "timeout", "expected a timeout error");
    assertEquals(silent.stats().timeouts, 1);
    silent.disconnect();

    const failing = createProtocolClient({
      transport: createLoopbackTransport({ handler: (envelope) => replyTo(envelope, "error", "Simulated failure.") }),
      maxAttempts: 3,
      baseBackoffMs: 1,
    });
    await failing.connect();
    let protocolError = null;
    try {
      await failing.request("ping", {});
    } catch (error) {
      protocolError = error;
    }
    assert(protocolError && protocolError.code === "protocol-error");
    assertEquals(protocolError.message, "Simulated failure.");
    assertEquals(failing.stats().retried, 0, "a definitive error must not be retried");
    failing.disconnect();
  });

  test("transport failures retry with backoff and then recover", async () => {
    let attempts = 0;
    const client = createProtocolClient({
      transport: createLoopbackTransport({
        handler: (envelope) => {
          attempts += 1;
          if (attempts < 3) throw new Error("connection reset");
          return replyTo(envelope, envelope.command, { ok: true });
        },
      }),
      maxAttempts: 4,
      baseBackoffMs: 1,
      maxBackoffMs: 4,
    });
    await client.connect();
    const data = await client.request("ping", {});
    assertEquals(data, { ok: true });
    assertEquals(attempts, 3);
    assertEquals(client.stats().retried, 2);
    assertEquals(client.stats().received, 1);
    client.disconnect();
  });

  test("connection state changes are surfaced and the server ping is answered", async () => {
    let ponged = false;
    const transport = createLoopbackTransport({
      handler: (envelope) => {
        if (envelope.command === "pong") ponged = true;
        return null;
      },
    });
    const client = createProtocolClient({ transport, maxAttempts: 1, baseBackoffMs: 1 });
    const states = [];
    client.onState((event) => states.push(event.to));
    await client.connect();
    assert(states.includes("connecting") && states.includes("connected"));
    transport.push({ id: "srv_1", replyto: null, command: "ping", data: "{}" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(ponged, "the client should answer a server ping with pong");
    client.disconnect();
    assertEquals(client.state(), "disconnected");
  });
});

suite("OpenRPA offline emulator", () => {
  test("the fixture set covers workflows, queues, work items, robots and documents", () => {
    const emulator = createEmulator();
    const stats = emulator.stats();
    assert(stats.collections >= 6, "expected several collections");
    assert(stats.total >= 15, "expected a seeded document set");
    assert(stats.commands >= 20, "expected the OpenFlow command surface");
    assert(emulator.users().length >= 2, "expected demo users");
    const workflows = emulator.dataset().documents.workflows;
    assert(workflows.every((doc) => doc._id && doc._type === "workflow" && doc._version), "documents carry the OpenFlow shape");
  });

  test("query supports filters, projection, ordering and paging", () => {
    const emulator = createEmulator();
    const query = emulator.process(request("query", { collection: "openrpa_workitem", query: { state: "new" }, projection: ["_id", "state"], orderby: { _created: -1 } }));
    assertEquals(query.command, "query");
    const items = JSON.parse(query.data);
    assert(items.length >= 2, "expected pending work items");
    assert(items.every((item) => item.state === "new" && item._id && !item.payload), "projection should limit fields");
    const counts = emulator.process(request("count", { collection: "openrpa_queue" }));
    assertEquals(JSON.parse(counts.data).count, 3);
    const top = emulator.process(request("query", { collection: "workflows", top: 2, projection: ["_id"] }));
    assertEquals(JSON.parse(top.data).length, 2);
  });

  test("documents can be inserted, upserted, updated and deleted", () => {
    const emulator = createEmulator();
    const insert = emulator.process(request("insertone", { collection: "companies", item: { name: "Foo Ltd", domain: "foo.example" } }));
    const created = JSON.parse(insert.data);
    assert(created._id.startsWith("co_"), "inserted documents receive an id");
    assertEquals(created._version, 1);

    const upsert = emulator.process(request("insertorupdateone", { collection: "companies", uniq: { domain: "foo.example" }, item: { domain: "foo.example", name: "Foo Limited" } }));
    assertEquals(JSON.parse(upsert.data)._id, created._id);
    assertEquals(JSON.parse(upsert.data).name, "Foo Limited");

    const removed = emulator.process(request("deleteone", { collection: "companies", id: created._id }));
    assertEquals(JSON.parse(removed.data).deleted, 1);
  });

  test("work items flow through the queue lifecycle", () => {
    const emulator = createEmulator();
    const popped = emulator.process(request("popworkitem", { wiq: "qi_invoice" }));
    const item = JSON.parse(popped.data).item;
    assert(item, "the queue should hand out its oldest pending item");
    assertEquals(item.state, "processing");
    const update = emulator.process(request("updateworkitem", { item: { _id: item._id, state: "success", retries: 1, success_wiq: "success" } }));
    assertEquals(JSON.parse(update.data).state, "success");
    const processing = emulator.process(request("count", { collection: "openrpa_workitem", query: { state: "processing" } }));
    assertEquals(JSON.parse(processing.data).count, 1);
  });

  test("sign-in, JWT tokens and files are supported", () => {
    const emulator = createEmulator();
    const denied = emulator.process(request("signin", { username: "ada" }));
    assertEquals(denied.command, "error");
    const signed = emulator.process(request("signin", { username: "ada", password: "demo" }));
    const result = JSON.parse(signed.data);
    assert(result.token && result.user.username === "ada", "a token user should be returned");

    const token = mintJwt({ username: "vera", name: "Vera", roles: ["Viewer"], ttlSeconds: 60 });
    const viaJwt = emulator.process(request("signin", { jwt: token }));
    assertEquals(JSON.parse(viaJwt.data).user.username, "vera");

    const upload = emulator.process(request("uploadfile", { filename: "note.txt", content: "hello", refid: "wf_invoice", ref: "workflow" }));
    const file = JSON.parse(upload.data);
    assert(file._id.startsWith("file_"));
    const fetched = emulator.process(request("getfile", { id: file._id }));
    assertEquals(JSON.parse(fetched.data).content, "hello");
  });

  test("an unreachable endpoint and an injected failure are both reported", () => {
    const emulator = createEmulator();
    emulator.injectFailure("ping", "Boom.");
    const failed = emulator.process(request("ping", {}));
    assertEquals(failed.command, "error");
    assertEquals(failed.data, "Boom.");
    emulator.clearFailures();
    emulator.setOnline(false);
    assertThrows(() => emulator.process(request("ping", {})));
    emulator.setOnline(true);
    assertEquals(emulator.process(request("ping", {})).command, "ping");
  });

  test("the emulator can push server-initiated messages", async () => {
    const emulator = createEmulator();
    const client = createProtocolClient({ transportFactory: () => emulator.transport(), maxAttempts: 1, baseBackoffMs: 1 });
    const seen = [];
    client.onCommand("queueclosed", (data) => seen.push(data));
    await client.connect();
    emulator.emit("queueclosed", { queue: "openrpa.invoice" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assertEquals(seen.length, 1);
    assertEquals(seen[0].queue, "openrpa.invoice");
    client.disconnect();
  });
});

suite("OpenRPA session & authentication", () => {
  test("JWT helpers mint and decode a token", () => {
    const token = mintJwt({ username: "ada", name: "Ada", roles: ["Administrator"], ttlSeconds: 120, now: 1000000 });
    const decoded = decodeJwt(token, { clock: () => 1000000 });
    assert(decoded.ok, decoded.error);
    assertEquals(decoded.payload.username, "ada");
    assertEquals(decoded.payload.roles[0].name, "Administrator");
    assertEquals(decoded.expired, false);
    const expired = decodeJwt(token, { clock: () => 1000000 + 130000 });
    assertEquals(expired.expired, true);
    assertEquals(decodeJwt("nonsense").ok, false);
  });

  test("password and JWT sign-in map OpenFlow roles onto canonical roles", async () => {
    const emulator = createEmulator();
    const client = createProtocolClient({ transportFactory: () => emulator.transport(), maxAttempts: 1, baseBackoffMs: 1 });
    await client.connect();
    const session = createSessionManager({ resolveClient: () => client, permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS });

    const signed = await session.signIn({ username: "ada", password: "demo" });
    assert(signed.ok, signed.error);
    assertEquals(signed.info.canonicalRoles, ["admin"]);
    assert(session.hasCapability("bundle.publish"), "an OpenRPA administrator maps to full access");
    assert(session.isSignedIn());
    assertEquals(session.isExpired(0), false);

    const refreshed = await session.refresh();
    assert(refreshed.ok, refreshed.error);
    assert(session.secondsRemaining() > 0);

    await session.signOut();
    assertEquals(session.isSignedIn(), false);

    const jwt = mintJwt({ username: "nils", name: "Nils", roles: ["Workflow Designer", "Robot Operator"], ttlSeconds: 1 });
    const viaJwt = await session.signIn({ jwt });
    assert(viaJwt.ok, viaJwt.error);
    assert(viaJwt.info.canonicalRoles.includes("dispatcher"));
    assert(viaJwt.info.canonicalRoles.includes("technician"));

    const freshness = await session.ensureFresh({ skewSeconds: 30 });
    assert(freshness.ok && freshness.refreshed, "a nearly-expired session should refresh");
    client.disconnect();
  });

  test("bad credentials are rejected without storing a session", async () => {
    const emulator = createEmulator();
    const client = createProtocolClient({ transportFactory: () => emulator.transport(), maxAttempts: 1, baseBackoffMs: 1 });
    await client.connect();
    const session = createSessionManager({ resolveClient: () => client, permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS });
    const result = await session.signIn({ username: "ada", password: "" });
    assertEquals(result.ok, false);
    assertEquals(session.isSignedIn(), false);
    client.disconnect();
  });
});

suite("OpenRPA connector facade", () => {
  test("connect, probe and request work against the emulator", async () => {
    const emitted = [];
    const or = createOpenRpaConnector({
      permissions: createPermissions(),
      roleMaps: TOOL_ROLE_MAPS,
      emit: async (type, payload) => {
        emitted.push({ type, payload });
        return { ok: true };
      },
    });
    assertEquals(or.mode(), "emulator");
    const connected = await or.connect({ announce: true });
    assert(connected.ok, connected.error);
    assertEquals(or.protocol.connected(), true);
    assert(emitted.some((entry) => entry.type === "connector.health" && entry.payload.status === "up"), "connecting should announce health");

    const ping = await or.probe();
    assert(ping.ok && ping.latencyMs >= 0, "probe should measure a round trip");
    const collections = await or.request("listcollections", {});
    assert(Array.isArray(collections) && collections.includes("workflows"));

    const signed = await or.signIn({ username: "ada", password: "demo" });
    assert(signed.ok, signed.error);
    const status = or.status();
    assertEquals(status.connected, true);
    assertEquals(status.session.signedIn, true);
    assertEquals(status.mode, "emulator");
    assertEquals(status.registry.connectionState, "connected");

    or.disconnect();
    assertEquals(or.status().state, "disconnected");
    assertEquals(or.entry().connectionState, "disconnected");
  });

  test("a live connection needs a profile and switching mode disconnects", async () => {
    const or = createOpenRpaConnector({ permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS });
    const live = await or.connect({ mode: "live" });
    assertEquals(live.ok, false);
    assert(/profile/i.test(live.error), `unexpected error: ${live.error}`);
    const created = await or.profiles.create({ name: "Head office", host: "openflow.example.com" });
    assert(created.ok);
    assertEquals(or.status().profile.name, "Head office");
    const toEmulator = or.setMode("emulator");
    assert(toEmulator.ok);
    assertEquals(or.mode(), "emulator");
  });

  test("the connector resets its session and profiles", async () => {
    const or = createOpenRpaConnector({ permissions: createPermissions(), roleMaps: TOOL_ROLE_MAPS });
    await or.connect({ announce: false });
    await or.signIn({ username: "ada", password: "demo" });
    await or.profiles.create({ name: "Temp", host: "temp.example.com" });
    assertEquals(or.session.isSignedIn(), true);
    await or.reset();
    assertEquals(or.session.isSignedIn(), false);
    assertEquals(or.profiles.count(), 0);
    assertEquals(or.mode(), "emulator");
  });
});

suite("OpenRPA hub integration", () => {
  test("the ready hub exposes a hydrated OpenRPA connector", async () => {
    const hub = await createHub({ kv: null }).ready();
    assert(hub.openrpa, "hub.openrpa should exist");
    const status = hub.openrpa.status();
    assertEquals(status.mode, "emulator");
    assertEquals(status.state, "disconnected");
    assertEquals(hub.openrpa.profiles.count(), 0);
    assert(hub.openrpa.emulator.stats().total > 0);
  });

  test("OpenRPA participates in the hub without disturbing the baseline", async () => {
    const hub = await createHub({ kv: null }).ready();
    assertEquals(hub.registry.validate().counts.error, 0);
    assert(hub.audit.verify().ok, "the audit chain should stay valid");
    assert(hub.monitor.errors().total === 0, "the seeded baseline should be error-free");
    const before = hub.identity.stats().total;
    const connected = await hub.openrpa.connect({ announce: false });
    assert(connected.ok);
    await hub.openrpa.signIn({ username: "ada", password: "demo" });
    const collections = await hub.openrpa.request("listcollections", {});
    assert(collections.length >= 6);
    hub.openrpa.disconnect();
    assertEquals(hub.identity.stats().total, before, "the OpenRPA connector must not touch the canonical directory");
  });

  test("resetting the hub clears OpenRPA state", async () => {
    const hub = await createHub({ kv: null }).ready();
    await hub.openrpa.connect({ announce: false });
    await hub.openrpa.signIn({ username: "ada", password: "demo" });
    await hub.openrpa.profiles.create({ name: "Office", host: "office.example.com" });
    await hub.resetData();
    assertEquals(hub.openrpa.session.isSignedIn(), false);
    assertEquals(hub.openrpa.profiles.count(), 0);
    assertEquals(hub.openrpa.mode(), "emulator");
  });
});
