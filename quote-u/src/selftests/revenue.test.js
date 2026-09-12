(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const R = window.QU_REVENUE;
  const O = window.QU_OUTBOX;
  if (!T || !QS || !R || !O) return;

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
    const ns = "rev" + QS.randHex(6);
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
    const approvalPolicy = Object.assign({ auto_close: true, won_stage: "won", fallback_stage: "closed_pending" }, opts.policy || {});
    const oppSync = window.QU_OPPSYNC.createService({ outbox, gateway, quotes, audit, policy: approvalPolicy, scope: "*" });
    const oppNote = window.QU_OPPNOTE.createService({ outbox, gateway, quotes, versions, priceSnapshots: prices, audit, policy: approvalPolicy, scope: "*" });
    const revenue = R.createService({ outbox, gateway, quotes, versions, audit, policy: approvalPolicy, scope: "*" });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, recompute, outbox, oppSync, oppNote, revenue });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, recompute, events, approvals, outbox, oppSync, oppNote, revenue, read, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

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

  T.register("revenue write: the accepted selection becomes product/revenue rows, and an unlinked quote is refused", () => {
    const bad = [];
    const lines = [
      { id: "l1", sort_order: 0, kind: "one_time", description: "Router", quantity: 2, unit_sell_cents: 15000, sku: "HW-AP-MR46", manufacturer_part_number: "MR46", currency: "CAD" },
      { id: "l2", sort_order: 1, kind: "mrr", description: "Managed IT", quantity: 1, unit_sell_cents: 20000, currency: "CAD" },
      { id: "l3", sort_order: 2, kind: "one_time", description: "Extra cover", quantity: 1, unit_sell_cents: 5000, optional: true, selected_by_default: false, currency: "CAD" }
    ];
    const built = R.buildLines({ line_items: lines, selection: ["l1", "l2"], currency: "CAD" });
    if (built.length !== 2) bad.push("rows should be the accepted lines only: " + built.length);
    const r1 = built.find(r => r.description === "Router");
    if (!r1) bad.push("Router missing");
    else {
      if (r1.amount_cents !== 30000) bad.push("Router amount: " + r1.amount_cents);
      if (r1.unit_price_cents !== 15000) bad.push("Router unit_price: " + r1.unit_price_cents);
      if (r1.recurring !== false) bad.push("Router should be one-time");
      if (r1.mpn !== "MR46" || r1.sku !== "HW-AP-MR46") bad.push("Router product identity: " + JSON.stringify(r1));
    }
    const r2 = built.find(r => r.description === "Managed IT");
    if (!r2 || r2.recurring !== true || r2.kind !== "mrr") bad.push("Managed IT should be recurring: " + JSON.stringify(r2));

    const payload = R.buildPayload({ version: { id: "v1" }, quote: { id: "q1", company_id: "c1", opportunity_id: "op1" }, line_items: lines, selection: ["l1", "l2"], totals: { one_time_cents: 30000, mrr_cents: 20000, twelve_month_value_cents: 270000, currency: "CAD" } });
    if (!payload.ok) bad.push("valid payload refused: " + JSON.stringify(payload));
    else {
      if (payload.payload.idempotency_key !== "v1:revenue_write") bad.push("key: " + payload.payload.idempotency_key);
      if (payload.payload.lines_total_cents !== 50000) bad.push("lines_total_cents: " + payload.payload.lines_total_cents);
      if (payload.payload.deal_value_cents !== 270000) bad.push("deal_value_cents: " + payload.payload.deal_value_cents);
    }
    const none = R.buildPayload({ version: { id: "v1" }, quote: { id: "q1", opportunity_id: null }, line_items: lines, selection: ["l1"] });
    if (none.ok || none.code !== "no_opportunity") bad.push("unlinked quote not refused: " + JSON.stringify(none));
    if (R.normalizePolicy({ write_revenue: false }).enabled !== false) bad.push("write_revenue:false did not disable the write");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the accepted lines become revenue rows with product identity and recurring flags, and an unlinked quote is refused" };
  });

  T.register("revenue write: approval writes the selected product lines once, audits it, and a retry cannot double-write", async () => {
    const env = makeEnv();
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };

    const res = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.revenue_write || res.revenue_write.external_ok !== true) bad.push("revenue write did not run: " + JSON.stringify(res.revenue_write));

    const got = await env.gateway.call("psa", "getRevenueLines", { id: "op1" }, { scope: "*" });
    if (!got.ok) bad.push("revenue lines unreadable: " + JSON.stringify(got));
    else {
      if (got.result.line_count !== 2) bad.push("line_count: " + got.result.line_count);
      if (got.result.revenue_total_cents !== 50000) bad.push("revenue_total_cents: " + got.result.revenue_total_cents);
      const router = got.result.lines.find(l => l.description === "Router");
      if (!router || router.amount_cents !== 30000) bad.push("Router revenue row: " + JSON.stringify(router));
    }
    const opp = await env.gateway.call("psa", "getOpportunity", { id: "op1" }, { scope: "*" });
    if (!opp.ok || opp.result.revenue_lines !== 2) bad.push("opportunity should carry the revenue lines: " + JSON.stringify(opp.result));

    const log = await env.audit.forVersion(s.version.id);
    const evs = log.records.filter(r => r.event === "products_written");
    if (evs.length !== 1) bad.push("products_written audit events: " + evs.length);
    else if (evs[0].actor_type !== "system") bad.push("products_written actor_type: " + evs[0].actor_type);

    const enq = await env.revenue.enqueueForApproval({ quote: s.created.quote, version: s.version, selection: [] });
    if (!enq.ok || !enq.deduped) bad.push("re-enqueue was not deduped");
    await env.outbox.runDue({ now: Date.parse("2026-06-01T00:00:00Z") });
    const after = await env.gateway.call("psa", "getRevenueLines", { id: "op1" }, { scope: "*" });
    if (after.result.revenue_write_count !== 1) bad.push("a duplicate revenue write reached the connector: " + after.result.revenue_write_count);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approval writes the accepted product lines once (line count + revenue total), audits products_written, and dedupe keeps it to exactly one write" };
  });

  T.register("revenue write: a disabled write_revenue flag skips the write entirely", async () => {
    const env = makeEnv({ policy: { write_revenue: false } });
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed" };
    const res = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana" }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.revenue_write || res.revenue_write.skipped !== true) bad.push("revenue_write should be skipped when disabled: " + JSON.stringify(res.revenue_write));
    const got = await env.gateway.call("psa", "getRevenueLines", { id: "op1" }, { scope: "*" });
    if (!got.ok || got.result.line_count !== 0) bad.push("revenue lines were written despite the flag: " + JSON.stringify(got));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "with write_revenue disabled no revenue write is enqueued or performed" };
  });
})();
