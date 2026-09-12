import { suite, test, assert, assertEquals } from "./harness.js";
import { createEventBus } from "../core/event-bus.js";
import { CONNECTORS } from "../core/catalog.js";

function makeBus() {
  return createEventBus({ connectors: CONNECTORS });
}

suite("Event bus", () => {
  test("publish wraps a payload in a versioned, sequenced envelope", async () => {
    const bus = makeBus();
    const first = await bus.publish("audit.note", { message: "hello" }, { source: "iu" });
    const second = await bus.publish("audit.note", { message: "again" }, { source: "iu" });
    assert(first.ok && second.ok);
    assert(/^ev_[0-9a-z]+$/.test(first.event.id), `unexpected id ${first.event.id}`);
    assertEquals(first.event.version, 1);
    assertEquals(first.event.seq, 1);
    assertEquals(second.event.seq, 2);
    assertEquals(first.event.type, "audit.note");
    assertEquals(first.event.payload.message, "hello");
  });

  test("wildcard subscriptions receive only what they asked for", async () => {
    const bus = makeBus();
    const deviceHits = [];
    const ticketHits = [];
    bus.subscribe("device.*", (e) => deviceHits.push(e.type));
    bus.subscribe("ticket.opened", (e) => ticketHits.push(e.type));
    await bus.publish("device.offline", { deviceId: "dv_1", minutes: 30 });
    await bus.publish("ticket.opened", { ticketId: "tk_1", companyId: "co_1", priority: "low" });
    await bus.publish("identity.upserted", { entityType: "company", entityId: "co_1", connector: "crm-u", created: true });
    assertEquals(deviceHits, ["device.offline"]);
    assertEquals(ticketHits, ["ticket.opened"]);
  });

  test("unsubscribe stops delivery", async () => {
    const bus = makeBus();
    let count = 0;
    const sub = bus.subscribe("audit.note", () => count++);
    await bus.publish("audit.note", { message: "1" });
    sub.unsubscribe();
    await bus.publish("audit.note", { message: "2" });
    assertEquals(count, 1);
    assertEquals(bus.stats().subscriberCount, 0);
  });

  test("once subscriptions fire exactly once", async () => {
    const bus = makeBus();
    let count = 0;
    bus.subscribe("audit.note", () => count++, { once: true });
    await bus.publish("audit.note", { message: "1" });
    await bus.publish("audit.note", { message: "2" });
    assertEquals(count, 1);
    assertEquals(bus.subscriberList().length, 0);
  });

  test("higher priority subscribers are delivered first", async () => {
    const bus = makeBus();
    const order = [];
    bus.subscribe("*", () => order.push("low"), { priority: 0 });
    bus.subscribe("*", () => order.push("high"), { priority: 5 });
    await bus.publish("audit.note", { message: "x" });
    assertEquals(order, ["high", "low"]);
  });

  test("invalid payloads are rejected and never delivered", async () => {
    const bus = makeBus();
    let count = 0;
    bus.subscribe("ticket.*", () => count++);
    const result = await bus.publish("ticket.opened", { ticketId: "tk_1" });
    assert(!result.ok);
    assert(result.issues.some((i) => i.code === "required"));
    assertEquals(count, 0);
    assertEquals(bus.stats().rejected, 1);
  });

  test("unknown event types are rejected", async () => {
    const bus = makeBus();
    const result = await bus.publish("ghost.event", {});
    assert(!result.ok);
    assert(result.event === null);
    assertEquals(result.issues[0].code, "unknown-type");
  });

  test("a throwing subscriber is reported but does not break delivery", async () => {
    const bus = makeBus();
    let survivor = 0;
    bus.subscribe("audit.note", () => {
      throw new Error("boom");
    });
    bus.subscribe("audit.note", () => survivor++);
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const result = await bus.publish("audit.note", { message: "x" });
      assert(result.ok);
      assertEquals(result.deliveries.filter((d) => d.ok).length, 1);
      assertEquals(result.deliveries.filter((d) => !d.ok).length, 1);
      assertEquals(survivor, 1);
      assertEquals(bus.stats().failureCount, 1);
    } finally {
      console.warn = originalWarn;
    }
  });

  test("history and stats summarise traffic", async () => {
    const bus = makeBus();
    await bus.publish("device.checkin", { deviceId: "dv_1", at: new Date().toISOString() });
    await bus.publish("device.offline", { deviceId: "dv_1", minutes: 5 });
    const recent = bus.recentPublished(5);
    assertEquals(recent.length, 2);
    assertEquals(recent[0].type, "device.checkin");
    const stats = bus.stats();
    assertEquals(stats.published, 2);
    assertEquals(stats.byTopic.device, 2);
    assertEquals(bus.subscribersOf("device.offline").length, 0);
  });

  test("resetStats clears counters but keeps subscribers delivering", async () => {
    const bus = makeBus();
    let seen = 0;
    bus.subscribe("device.*", () => seen++);
    await bus.publish("device.offline", { deviceId: "dv_9", minutes: 5 });
    assertEquals(bus.stats().published, 1);
    bus.resetStats();
    const cleared = bus.stats();
    assertEquals(cleared.published, 0);
    assertEquals(cleared.rejected, 0);
    assertEquals(cleared.subscriberCount, 1);
    assertEquals(bus.recentPublished(10).length, 0);
    await bus.publish("device.checkin", { deviceId: "dv_9", at: new Date().toISOString() });
    assertEquals(seen, 2);
    assertEquals(bus.stats().published, 1);
    assert(bus.lastSeq() >= 2);
  });

  test("reset tears down subscribers entirely", async () => {
    const bus = makeBus();
    let seen = 0;
    bus.subscribe("device.*", () => seen++);
    bus.reset();
    await bus.publish("device.offline", { deviceId: "dv_9", minutes: 5 });
    assertEquals(seen, 0);
    assertEquals(bus.stats().subscriberCount, 0);
  });
});
