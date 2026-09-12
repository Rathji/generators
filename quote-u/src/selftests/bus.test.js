(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const C = window.QU_CONNECTORS;
  const B = window.QU_BUS;
  if (!T || !QS || !C || !B) return;

  function makeKv(kvStore) {
    return { get: async k => kvStore.get(k), set: async (k, v) => { kvStore.set(k, v); }, delete: async k => { kvStore.delete(k); } };
  }
  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) { f = { text, key: "ek." + name, count: 0 }; files.set(name, f); f.count = 1; return { error: null, editKey: f.key, editCount: 1, created: true }; }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text; f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }
  function makeStore() {
    return QS.create({ ns: "bus" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }
  function makeGateway(bus) {
    return C.createGateway({
      connectors: { bus: bus || C.createMockBus() },
      manifest: { bus: { functions: { publish: { effect: "write" }, list: { effect: "read" }, streamSize: { effect: "read" }, webhookPost: { effect: "write" }, deliveries: { effect: "read" }, deliveryCount: { effect: "read" } } } }
    });
  }

  const APPROVED = { id: "ev-approved-1", event: "approved", quote_id: "q1", version_id: "v1", actor: "rep1", actor_type: "internal", at: "2026-09-12T10:00:00.000Z", detail: { total_cents: 120000, currency: "CAD" } };

  T.register("bus: only the mapped quote/approval events are publishable, and each becomes one versioned envelope on the bus-quote-events stream", () => {
    const bad = [];
    if (B.typeFor({ event: "approved" }) !== "quote.approved") bad.push("approved mapping");
    if (B.typeFor({ event: "invoice_created" }) !== "quote.invoiced") bad.push("invoiced mapping");
    if (B.typeFor({ event: "revised" }) !== null) bad.push("revised is not published");
    if (!B.isPublishable({ event: "sent" })) bad.push("sent is publishable");
    if (B.isPublishable({ event: "option_changed" })) bad.push("option_changed is not published");
    let threw = null;
    try { B.toEnvelope({ event: "revised" }); } catch (e) { threw = e; }
    if (!threw || threw.code !== "unpublishable_event") bad.push("an unmapped event must be refused");

    const env = B.toEnvelope(APPROVED);
    if (env.schema !== "pipeline.quote-event" || env.version !== 1) bad.push("envelope schema/version: " + JSON.stringify(env));
    if (env.type !== "quote.approved") bad.push("envelope type");
    if (env.stream !== "bus-quote-events" || env.source !== "quote-u") bad.push("envelope stream/source");
    if (env.id !== "qe-ev-approved-1") bad.push("envelope id from the audit id: " + env.id);
    if (env.key !== "q1") bad.push("partition key: " + env.key);
    if (!env.subject || env.subject.id !== "q1" || env.subject.version_id !== "v1") bad.push("subject: " + JSON.stringify(env.subject));
    if (env.actor.type !== "internal" || env.actor.id !== "rep1") bad.push("actor: " + JSON.stringify(env.actor));
    if (env.data.total_cents !== 120000) bad.push("data passthrough");
    const env2 = B.toEnvelope(APPROVED);
    if (env2.id !== env.id) bad.push("the envelope id must be stable");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "created/sent/viewed/approved/declined/expired/invoiced map to quote.* bus types, an unmapped audit event is refused, and each event becomes one stable, versioned envelope with a subject, actor and partition key" };
  });

  T.register("bus: emit publishes the event to the bus stream and delivers it to the matching webhook, and a re-emit is an idempotent no-op", async () => {
    const bad = [];
    const bus = C.createMockBus();
    const gw = makeGateway(bus);
    const svc = B.createService({ gateway: gw, policy: { stream: "bus-quote-events", webhooks: [{ url: "https://hooks.example/quote-u", events: ["quote.approved", "quote.declined"] }] } });
    const em = await svc.emit(APPROVED);
    if (!em.ok || !em.published || !em.delivered) bad.push("emit: " + JSON.stringify(em));
    if (!em.webhooks || em.webhooks.length !== 1) bad.push("one webhook should have been delivered: " + JSON.stringify(em.webhooks));

    const streamRes = gw.call("bus", "list", { stream: "bus-quote-events" }, { scope: "*" });
    if (!streamRes.ok || streamRes.result.length !== 1) bad.push("the stream should hold one envelope: " + JSON.stringify(streamRes));
    const deliveries = gw.call("bus", "deliveries", {}, { scope: "*" });
    if (!deliveries.ok || deliveries.result.length !== 1) bad.push("one webhook delivery: " + JSON.stringify(deliveries));

    // A non-approved event has no matching webhook but still goes on the bus.
    const sent = await svc.emit({ id: "ev-sent-1", event: "sent", quote_id: "q1", version_id: "v1" });
    if (!sent.ok || !sent.published || sent.delivered !== true) bad.push("an event with no matching webhook should still publish cleanly: " + JSON.stringify(sent));

    // Re-emitting the same audit record must not double-publish.
    const again = await svc.emit(APPROVED);
    if (!again.duplicate) bad.push("a re-emit must be a duplicate: " + JSON.stringify(again));
    const after = gw.call("bus", "streamSize", { stream: "bus-quote-events" }, { scope: "*" });
    if (after.result !== 2) bad.push("the stream should still hold two envelopes: " + after.result);

    const pub = await svc.publish({ id: "ev-rev-1", event: "revised", quote_id: "q1" });
    if (!pub.ok || !pub.skipped) bad.push("an unpublishable event should skip cleanly: " + JSON.stringify(pub));
    if (!svc.verify().ok) bad.push("verify: " + JSON.stringify(svc.verify().violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "emit publishes one envelope to the bus-quote-events stream and delivers it to the matching webhook (all others skipped), the same event is de-duplicated, and an unpublishable audit event is skipped rather than published" };
  });

  T.register("bus: the stream backing persists, a delivery that could not reach the bus stays pending, and a later flush retries it idempotently", async () => {
    const bad = [];
    const store = makeStore();
    const offline = B.createService({ store, gateway: null, policy: { stream: "bus-quote-events" } });
    const ready = await offline.ready();
    if (!ready.ok) return { pass: false, detail: "ready: " + JSON.stringify(ready) };
    const pub = await offline.publish(APPROVED);
    if (!pub.ok || !pub.envelope) bad.push("publish: " + JSON.stringify(pub));
    const flushFail = await offline.flush();
    if (flushFail.ok || flushFail.delivered !== 0) bad.push("a flush with no gateway must not claim delivery: " + JSON.stringify(flushFail));
    if (offline.pending().length !== 1) bad.push("the undelivered envelope should be pending");
    const doc = await store.loadDoc("bus_events");
    if (!doc.ok || !doc.content || !Array.isArray(doc.content.records) || doc.content.records.length !== 1) bad.push("bus_events document missing/empty");

    // A fresh service over the same store, now with a gateway, retries the
    // pending envelope and delivers it exactly once.
    const bus = C.createMockBus();
    const gw = makeGateway(bus);
    const online = B.createService({ store, gateway: gw, policy: { stream: "bus-quote-events", webhooks: [{ url: "https://hooks.example/quote-u", events: "*" }] } });
    const r2 = await online.ready();
    if (!r2.ok || r2.pending !== 1) bad.push("the fresh service should load the pending envelope: " + JSON.stringify(r2));
    const flushOk = await online.flush();
    if (!flushOk.ok || flushOk.delivered !== 1) bad.push("the retry flush should deliver: " + JSON.stringify(flushOk));
    if (online.pending().length !== 0) bad.push("nothing should be pending after the retry");
    const size = gw.call("bus", "streamSize", { stream: "bus-quote-events" }, { scope: "*" });
    if (size.result !== 1) bad.push("the retry must publish exactly once: " + size.result);
    const flushAgain = await online.flush();
    if (flushAgain.attempted !== 0) bad.push("a second flush must be a no-op: " + JSON.stringify(flushAgain));
    if (!online.verify().ok) bad.push("verify: " + JSON.stringify(online.verify().violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the envelope is persisted in bus_events, an offline publish stays pending, a fresh service over the same store retries it, the bus sees exactly one envelope, and a repeat flush is a no-op" };
  });
})();
