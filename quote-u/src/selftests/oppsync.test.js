(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const OS = window.QU_OPPSYNC;
  const O = window.QU_OUTBOX;
  if (!T || !QS || !OS || !O) return;

  const REP_MAILBOX = "alex.rivera@example.com";

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeEnv(opts) {
    opts = opts || {};
    const ns = "ops" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const recompute = window.QU_RECOMPUTE.createService({ versions });
    const events = window.QU_PORTALEVENTS.createService({ audit });
    const approvals = window.QU_APPROVALS.createService({ store });
    const outbox = O.createService({ store });
    const oppSync = OS.createService({ outbox, gateway, quotes, audit, policy: opts.policy || null, scope: "*" });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, recompute, outbox, oppSync });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, recompute, events, approvals, outbox, oppSync, read, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  // A quote LINKED to opportunity op1 (c1), with a $300 one-time line and a
  // $200/mo MRR line → twelve-month deal value = 30000 + 12×20000 = 270000.
  async function seedLinked(env) {
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", opportunity_id: "op1", title: "Network refresh", scope: "*" });
    if (!created.ok) return { ok: false, created };
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    await env.versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 });
    await env.versions.addLine(v.version.id, { kind: "mrr", description: "Managed IT", quantity: 1, unit_cost_cents: 10000, unit_sell_cents: 20000 });
    const sent = await env.send.send(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    const g = await env.versions.getVersion(v.version.id);
    return { ok: sent.ok, created, version: g.version, sent, secret: secretOf(sent.link) };
  }

  T.register("oppsync: the payload's deal value is one-time + 12 × MRR; a missing opportunity is a clean no-op", () => {
    const bad = [];
    const built = OS.buildPayload({
      version: { id: "v1" },
      quote: { id: "q1", company_id: "c1", opportunity_id: "op1" },
      approval: { selection: ["l1"], one_time_cents: 30000, mrr_cents: 20000, twelve_month_value_cents: 270000, currency: "CAD", approver_name: "Dana", approved_at: "2026-01-01T00:00:00Z" },
      approver_name: "Dana"
    });
    if (!built.ok) bad.push("valid payload refused: " + JSON.stringify(built));
    else {
      if (built.payload.amount_cents !== 270000) bad.push("amount: " + built.payload.amount_cents);
      if (built.payload.opportunity_id !== "op1") bad.push("opportunity_id: " + built.payload.opportunity_id);
      if (built.payload.idempotency_key !== "v1:opp_update") bad.push("key: " + built.payload.idempotency_key);
      if (built.payload.selection.join(",") !== "l1") bad.push("selection not carried");
    }
    const none = OS.buildPayload({ version: { id: "v1" }, quote: { id: "q1", company_id: "c1", opportunity_id: null }, approval: { twelve_month_value_cents: 100 } });
    if (none.ok || none.code !== "no_opportunity") bad.push("unlinked quote not refused: " + JSON.stringify(none));
    const noAmount = OS.buildPayload({ version: { id: "v1" }, quote: { id: "q1", opportunity_id: "op1" }, approval: {} });
    if (noAmount.ok || noAmount.code !== "bad_amount") bad.push("missing amount not refused: " + JSON.stringify(noAmount));
    if (OS.amountFromTotals({ one_time_cents: 100, mrr_cents: 5 }) !== 160) bad.push("amountFromTotals fallback: " + OS.amountFromTotals({ one_time_cents: 100, mrr_cents: 5 }));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the payload carries the linked opportunity and the twelve-month deal value; an unlinked quote or a missing amount is refused" };
  });

  T.register("oppsync: approval sets the linked opportunity to Won and the outbox write happens exactly once", async () => {
    const env = makeEnv();
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };

    const res = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.opp_update || res.opp_update.external_ok !== true) bad.push("opp update did not run: " + JSON.stringify(res.opp_update));

    const opp = await env.gateway.call("psa", "getOpportunity", { id: "op1" }, { scope: "*" });
    if (!opp.ok || !opp.result) bad.push("opportunity unreadable");
    else {
      if (opp.result.stage !== "won") bad.push("stage: " + opp.result.stage);
      if (opp.result.amount_cents !== 270000) bad.push("amount: " + opp.result.amount_cents);
      if (opp.result.write_count !== 1) bad.push("write_count after approval: " + opp.result.write_count);
    }

    // The acceptance is audited through the external event.
    const log = await env.audit.forVersion(s.version.id);
    const evs = log.records.filter(r => r.event === "opp_updated");
    if (evs.length !== 1) bad.push("opp_updated audit events: " + evs.length);
    else if (evs[0].actor_type !== "system") bad.push("opp_updated actor_type: " + evs[0].actor_type);
    else if (!evs[0].detail || evs[0].detail.stage !== "won") bad.push("opp_updated detail: " + JSON.stringify(evs[0].detail));

    // Re-enqueueing the same key and running the worker changes nothing (I5).
    const key = O.keyOf(s.version.id, "opp_update");
    const again = await env.outbox.enqueue({ version_id: s.version.id, action: "opp_update", quote_id: s.created.quote.id, payload: {} });
    if (!again.ok || !again.deduped) bad.push("re-enqueue was not deduped");
    await env.outbox.runDue({ now: Date.parse("2026-06-01T00:00:00Z") });
    const counted = await env.gateway.call("psa", "opportunityWriteCount", { id: "op1" }, { scope: "*" });
    if (!counted.ok || counted.result.write_count !== 1) bad.push("a duplicate write reached the connector: " + JSON.stringify(counted));

    // A direct retry with the same idempotency key is absorbed by the adapter.
    const direct = await env.gateway.call("psa", "updateOpportunity", { id: "op1", stage: "lost", amount_cents: 1, idempotency_key: key }, { scope: ["c1"] });
    if (!direct.ok) bad.push("idempotent retry failed: " + JSON.stringify(direct));
    else if (direct.result.stage !== "won" || direct.result.amount_cents !== 270000) bad.push("the idempotency key did not return the stored result: " + JSON.stringify(direct.result));
    const count2 = await env.gateway.call("psa", "opportunityWriteCount", { id: "op1" }, { scope: "*" });
    if (count2.result.write_count !== 1) bad.push("write_count after retry: " + count2.result.write_count);

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approval enqueues opp_update, the worker sets the deal Won at the 12-month value and audits it, and the dedupe + connector idempotency key keep the external write to exactly one" };
  });

  T.register("oppsync: with auto_close disabled the deal value is written but the stage is left for a human", async () => {
    const env = makeEnv({ policy: { auto_close: false, fallback_stage: "closed_pending" } });
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };
    const res = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana" }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    const opp = await env.gateway.call("psa", "getOpportunity", { id: "op1" }, { scope: "*" });
    if (!opp.ok || !opp.result) bad.push("opportunity unreadable");
    else {
      if (opp.result.stage !== "closed_pending") bad.push("stage: " + opp.result.stage);
      if (opp.result.amount_cents !== 270000) bad.push("amount: " + opp.result.amount_cents);
      if (opp.result.write_count !== 1) bad.push("write_count: " + opp.result.write_count);
    }
    const log = await env.audit.forVersion(s.version.id);
    const ev = log.records.filter(r => r.event === "opp_updated")[0];
    if (!ev || !ev.detail || ev.detail.auto_close !== false) bad.push("auto_close not recorded as false: " + JSON.stringify(ev && ev.detail));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "with auto_close off the deal value is still written but the stage stays at the fallback value, and the audit records auto_close:false" };
  });
})();
