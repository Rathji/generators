import { suite, test, assert, assertEquals } from "./harness.js";
import { createEventBus } from "../core/event-bus.js";
import { createSubscriptionManager, DEFAULT_SUBSCRIPTIONS } from "../core/subscriptions.js";
import { CONNECTORS } from "../core/catalog.js";

function makePair() {
  const bus = createEventBus({ connectors: CONNECTORS });
  const subscriptions = createSubscriptionManager({
    bus,
    connectors: CONNECTORS,
    emit: (type, payload, options) => bus.publish(type, payload, options),
  });
  return { bus, subscriptions };
}

suite("Subscription manager", () => {
  test("a registered subscription receives matching events", async () => {
    const { bus, subscriptions } = makePair();
    const result = await subscriptions.register({ connector: "psa-u", topic: "device.*", label: "ticket on offline" });
    assert(result.ok);
    const seen = [];
    await bus.subscribe("device.offline", () => seen.push("direct"));
    const published = await bus.publish("device.offline", { deviceId: "dv_1", minutes: 10 });
    const record = subscriptions.recordFor(result.record.id);
    assertEquals(record.delivered, 1);
    assertEquals(record.lastSeq, published.event.seq);
    assertEquals(seen.length, 1);
  });

  test("unknown connectors and topics are rejected", async () => {
    const { subscriptions } = makePair();
    const badConnector = await subscriptions.register({ connector: "nope-u", topic: "device.*" });
    assert(!badConnector.ok);
    assert(badConnector.issues.some((i) => i.code === "unknown-connector"));
    const badTopic = await subscriptions.register({ connector: "psa-u", topic: "weather.forecast" });
    assert(!badTopic.ok);
    assert(badTopic.issues.some((i) => i.code === "unknown-topic"));
    const empty = await subscriptions.register({ connector: "psa-u" });
    assert(empty.issues.some((i) => i.code === "missing-topic"));
    assertEquals(subscriptions.list().length, 0);
  });

  test("the same connector cannot subscribe to the same topic twice", async () => {
    const { subscriptions } = makePair();
    const first = await subscriptions.register({ connector: "psa-u", topic: "device.*" });
    assert(first.ok);
    const dupe = await subscriptions.register({ connector: "psa-u", topic: "device.*" });
    assert(!dupe.ok);
    assert(dupe.issues.some((i) => i.code === "duplicate-subscription"));
    assertEquals(subscriptions.list().length, 1);
  });

  test("unregister removes the subscription and stops delivery", async () => {
    const { bus, subscriptions } = makePair();
    const { record } = await subscriptions.register({ connector: "it-u", topic: "identity.*" });
    await bus.publish("identity.upserted", { entityType: "company", entityId: "co_1", connector: "crm-u", created: true });
    assertEquals(subscriptions.recordFor(record.id).delivered, 1);
    await subscriptions.unregister(record.id);
    await bus.publish("identity.upserted", { entityType: "company", entityId: "co_2", connector: "crm-u", created: true });
    assertEquals(subscriptions.recordFor(record.id), null);
    assertEquals(subscriptions.list().length, 0);
  });

  test("matching finds every subscriber interested in an event type", async () => {
    const { subscriptions } = makePair();
    await subscriptions.register({ connector: "psa-u", topic: "device.*" });
    await subscriptions.register({ connector: "rmm-u", topic: "device.checkin" });
    await subscriptions.register({ connector: "crm-u", topic: "ticket.*" });
    const offline = subscriptions.matching("device.offline").map((r) => r.connector);
    assertEquals(offline, ["psa-u"]);
    const checkin = subscriptions.matching("device.checkin").map((r) => r.connector).sort();
    assertEquals(checkin, ["psa-u", "rmm-u"]);
    assertEquals(subscriptions.countFor("psa-u"), 1);
  });

  test("seedDefaults installs the default subscription matrix", async () => {
    const { subscriptions } = makePair();
    await subscriptions.seedDefaults();
    assertEquals(subscriptions.list().length, DEFAULT_SUBSCRIPTIONS.length);
    const hub = subscriptions.list().find((r) => r.topic === "*");
    assertEquals(hub.connector, "iu");
    await subscriptions.seedDefaults();
    assertEquals(subscriptions.list().length, DEFAULT_SUBSCRIPTIONS.length);
  });

  test("registering and removing a subscription emits config events", async () => {
    const { bus, subscriptions } = makePair();
    const { record } = await subscriptions.register({ connector: "crm-u", topic: "identity.*" });
    const registered = bus.recentPublished(10).filter((e) => e.type === "subscription.registered");
    assertEquals(registered.length, 1);
    assertEquals(registered[0].payload.subscriptionId, record.id);
    await subscriptions.unregister(record.id);
    const removed = bus.recentPublished(10).filter((e) => e.type === "subscription.removed");
    assertEquals(removed.length, 1);
    assertEquals(removed[0].payload.connector, "crm-u");
  });
});
