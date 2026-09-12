(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const ID = window.QU_INVOICEPSA;
  const O = window.QU_OUTBOX;
  if (!T || !QS || !ID || !O) return;

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
    const ns = "invpsa" + QS.randHex(6);
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
    const revenue = window.QU_REVENUE.createService({ outbox, gateway, quotes, versions, audit, policy: approvalPolicy, scope: "*" });
    const invoiceIntents = window.QU_INVOICEINTENTS.createService({ store });
    const invoicePsa = ID.createService({ outbox, gateway, invoiceIntents, quotes, versions, audit, policy: opts.psaPolicy || null, scope: "*" });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, recompute, outbox, oppSync, oppNote, revenue });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, recompute, events, approvals, outbox, oppSync, oppNote, revenue, invoiceIntents, invoicePsa, actions };
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

  T.register("psa invoice: the approved selection becomes product records and a psa payload, and a missing version/opportunity/lines is refused", () => {
    const bad = [];
    const lines = [
      { id: "l1", sort_order: 0, kind: "one_time", description: "Router", quantity: 2, unit_sell_cents: 15000, sku: "HW-AP-MR46", manufacturer_part_number: "MR46", currency: "CAD" },
      { id: "l2", sort_order: 1, kind: "mrr", description: "Managed IT", quantity: 1, unit_sell_cents: 20000, currency: "CAD" },
      { id: "l3", sort_order: 2, kind: "one_time", description: "Extra cover", quantity: 1, unit_sell_cents: 5000, optional: true, selected_by_default: false, currency: "CAD" }
    ];
    const built = ID.buildRevenueLines({ line_items: lines, selection: ["l1", "l2"], currency: "CAD" });
    if (built.length !== 2) bad.push("records should be the accepted lines only: " + built.length);
    const r1 = built.find(r => r.description === "Router");
    if (!r1 || r1.amount_cents !== 30000 || r1.unit_price_cents !== 15000 || r1.recurring !== false || r1.sku !== "HW-AP-MR46") bad.push("Router record: " + JSON.stringify(r1));
    const r2 = built.find(r => r.description === "Managed IT");
    if (!r2 || r2.amount_cents !== 20000 || r2.recurring !== true || r2.kind !== "mrr") bad.push("Managed IT record: " + JSON.stringify(r2));

    const payload = ID.buildPayload({ version: { id: "v1" }, quote: { id: "q1", company_id: "c1", opportunity_id: "op1" }, line_items: lines, selection: ["l1", "l2"], totals: { currency: "CAD" } });
    if (!payload.ok) bad.push("valid payload refused: " + JSON.stringify(payload));
    else {
      if (payload.payload.idempotency_key !== "v1:invoice_psa") bad.push("key: " + payload.payload.idempotency_key);
      if (payload.payload.subtotal_cents !== 50000) bad.push("subtotal: " + payload.payload.subtotal_cents);
      if (payload.payload.tax_rate_bp !== 500) bad.push("tax rate: " + payload.payload.tax_rate_bp);
      if (payload.payload.path !== "psa") bad.push("path: " + payload.payload.path);
      if (payload.payload.opportunity_id !== "op1") bad.push("opportunity: " + payload.payload.opportunity_id);
      if (payload.payload.line_count !== 2) bad.push("line count: " + payload.payload.line_count);
    }
    const noVersion = ID.buildPayload({ quote: { id: "q1", company_id: "c1", opportunity_id: "op1" }, line_items: lines, selection: ["l1"] });
    if (noVersion.ok || noVersion.code !== "version_required") bad.push("missing version not refused: " + JSON.stringify(noVersion));
    const noOpp = ID.buildPayload({ version: { id: "v1" }, quote: { id: "q1", company_id: "c1" }, line_items: lines, selection: ["l1"] });
    if (noOpp.ok || noOpp.code !== "no_opportunity") bad.push("missing opportunity not refused: " + JSON.stringify(noOpp));
    const noLines = ID.buildPayload({ version: { id: "v1" }, quote: { id: "q1", company_id: "c1", opportunity_id: "op1" }, line_items: [lines[2]], selection: [] });
    if (noLines.ok || noLines.code !== "no_lines") bad.push("empty selection not refused: " + JSON.stringify(noLines));
    if (ID.normalizePolicy({ write_invoice: false }).enabled !== false) bad.push("write_invoice:false did not disable the path");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the accepted lines become product/revenue records, the payload carries the opportunity + tax rate, and a missing version/opportunity/lines is refused" };
  });

  T.register("psa invoice: approval → enqueue → psa.requestInvoice → intent reconciled, audited once, and idempotent", async () => {
    const env = makeEnv();
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };
    const approved = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9" });
    if (!approved.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(approved) };

    const enq = await env.invoicePsa.enqueueForVersion({ quote: approved.quote, version: s.version });
    if (!enq.ok || enq.deduped) bad.push("first enqueue should create a job: " + JSON.stringify(enq));
    const run = await env.outbox.runDue();
    if (!run.ok) bad.push("runDue failed: " + JSON.stringify(run));
    const entry = run.ran && run.ran.find(r => r.action === ID.ACTION);
    if (!entry || !entry.ok) bad.push("the psa job did not succeed: " + JSON.stringify(entry));

    const inv = await env.gateway.call("psa", "getPsaInvoice", { version_id: s.version.id }, { scope: "*" });
    if (!inv.ok || !inv.result) bad.push("no psa invoice created: " + JSON.stringify(inv));
    else {
      if (inv.result.subtotal_cents !== 50000) bad.push("invoice subtotal: " + inv.result.subtotal_cents);
      if (inv.result.tax_cents !== 2500) bad.push("invoice tax: " + inv.result.tax_cents);
      if (inv.result.total_cents !== 52500) bad.push("invoice total: " + inv.result.total_cents);
      if (inv.result.line_count !== 2) bad.push("invoice lines: " + inv.result.line_count);
      if (!inv.result.invoice_number || inv.result.invoice_number.indexOf("PSA-") !== 0) bad.push("invoice number: " + inv.result.invoice_number);
      if (inv.result.source !== "psa_accounting_sync") bad.push("invoice should come from the PSA accounting sync: " + inv.result.source);
    }

    const int = await env.invoiceIntents.getForVersion(s.version.id);
    if (!int.ok || !int.intent) bad.push("no intent row: " + JSON.stringify(int));
    else {
      if (int.intent.path !== "psa") bad.push("intent path: " + int.intent.path);
      if (int.intent.status !== "created") bad.push("intent status: " + int.intent.status);
      if (int.intent.external_system !== "psa") bad.push("intent external_system: " + int.intent.external_system);
      if (!int.intent.external_reference || int.intent.external_reference !== (inv.result && inv.result.id)) bad.push("intent reference: " + int.intent.external_reference);
      if (int.intent.amount_cents !== 50000) bad.push("intent amount: " + int.intent.amount_cents);
    }

    const log = await env.audit.forVersion(s.version.id);
    const evs = log.records.filter(r => r.event === "invoice_created");
    if (evs.length !== 1) bad.push("invoice_created audit events: " + evs.length);
    else if (evs[0].actor_type !== "system" || evs[0].detail.path !== "psa" || evs[0].detail.external_system !== "psa") bad.push("invoice_created audit shape: " + JSON.stringify(evs[0].detail));

    // Idempotency: a re-enqueue dedupes and a re-run cannot create a second invoice.
    const again = await env.invoicePsa.enqueueForVersion({ quote: approved.quote, version: s.version });
    if (!again.ok || !again.deduped) bad.push("re-enqueue was not deduped: " + JSON.stringify(again));
    await env.outbox.runDue({ now: Date.parse("2026-06-01T00:00:00Z") });
    const cnt = await env.gateway.call("psa", "psaInvoiceCount", {}, { scope: "*" });
    if (cnt.result !== 1) bad.push("a duplicate psa invoice was created: " + cnt.result);
    const skip = await env.invoicePsa.handler({ job: { payload: { version_id: s.version.id, opportunity_id: "op1", lines: [{ description: "x", amount_cents: 1 }] }, version_id: s.version.id } }, {});
    if (!skip.ok || skip.skipped !== true) bad.push("handler should skip an already-created intent: " + JSON.stringify(skip));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approval → psa enqueue → requestInvoice → the PSA accounting sync creates the invoice and the intent reconciles its reference; one invoice_created is audited and re-running creates no second invoice" };
  });

  T.register("psa invoice: the intent guard refuses a version already claimed on the direct path, and a disabled flag skips the path", async () => {
    const env = makeEnv();
    const bad = [];
    const claimed = await env.invoiceIntents.claim({ quote_id: "qr", version_id: "vr", path: "direct", amount_cents: 50000 });
    if (!claimed.ok) return { pass: false, detail: "seed claim failed: " + JSON.stringify(claimed) };
    const built = ID.buildPayload({ version: { id: "vr" }, quote: { id: "qr", company_id: "c1", opportunity_id: "op1" }, line_items: [{ id: "l1", description: "Router", quantity: 1, unit_sell_cents: 50000 }], selection: ["l1"] });
    if (!built.ok) return { pass: false, detail: "payload: " + JSON.stringify(built) };
    const enq = await env.outbox.enqueue({ version_id: "vr", action: ID.ACTION, quote_id: "qr", payload: built.payload });
    if (!enq.ok) bad.push("enqueue failed: " + JSON.stringify(enq));
    const run = await env.outbox.runDue();
    const entry = run.ran && run.ran.find(r => r.action === ID.ACTION);
    if (!entry || entry.ok) bad.push("the psa job should have failed: " + JSON.stringify(entry));
    const job = await env.outbox.getByKey("vr:" + ID.ACTION);
    if (!job.ok || !job.job || job.job.state !== "failed" || job.job.terminal !== true) bad.push("the refusal should be terminal: " + JSON.stringify(job.job && job.job.state));
    const cnt = await env.gateway.call("psa", "psaInvoiceCount", {}, { scope: "*" });
    if (cnt.result !== 0) bad.push("a psa invoice was created despite the guard: " + cnt.result);
    const gi = await env.invoiceIntents.getForVersion("vr");
    if (!gi.ok || !gi.intent || gi.intent.path !== "direct" || gi.intent.status !== "pending") bad.push("the winning intent changed: " + JSON.stringify(gi.intent));

    // A disabled policy skips enqueueing entirely.
    const off = makeEnv({ psaPolicy: { write_invoice: false } });
    const skipped = await off.invoicePsa.enqueueForVersion({ version: { id: "v-off" } });
    if (!skipped.ok || skipped.skipped !== true || skipped.reason !== "disabled") bad.push("disabled policy did not skip: " + JSON.stringify(skipped));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a version already claimed on the direct path makes the psa job fail terminally with no invoice created, and a disabled write_invoice flag skips the path entirely" };
  });
})();
