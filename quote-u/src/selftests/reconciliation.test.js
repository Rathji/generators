(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const R = window.QU_RECONCILIATION;
  if (!T || !QS || !R) return;

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
    const ns = "recon" + QS.randHex(6);
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
    const outbox = window.QU_OUTBOX.createService({ store });
    const approvalPolicy = Object.assign({ auto_close: true, won_stage: "won", fallback_stage: "closed_pending" }, opts.policy || {});
    const oppSync = window.QU_OPPSYNC.createService({ outbox, gateway, quotes, audit, policy: approvalPolicy, scope: "*" });
    const oppNote = window.QU_OPPNOTE.createService({ outbox, gateway, quotes, versions, priceSnapshots: prices, audit, policy: approvalPolicy, scope: "*" });
    const revenue = window.QU_REVENUE.createService({ outbox, gateway, quotes, versions, audit, policy: approvalPolicy, scope: "*" });
    const invoiceIntents = window.QU_INVOICEINTENTS.createService({ store });
    const invoiceDirect = window.QU_INVOICEDIRECT.createService({ outbox, gateway, invoiceIntents, quotes, versions, audit, policy: opts.invoicePolicy || null, scope: "*" });
    const invoicePsa = window.QU_INVOICEPSA.createService({ outbox, gateway, invoiceIntents, quotes, versions, audit, policy: opts.psaPolicy || null, scope: "*" });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, recompute, outbox, oppSync, oppNote, revenue });
    const reconciliation = R.createService({ gateway, invoiceIntents, approvals, audit, scope: "*" });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, recompute, events, approvals, outbox, oppSync, oppNote, revenue, invoiceIntents, invoiceDirect, invoicePsa, actions, reconciliation };
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

  function approval(over) {
    return Object.assign({
      version_id: "v1", quote_id: "q1", selection: ["l1", "l2"],
      one_time_cents: 30000, mrr_cents: 20000, twelve_month_value_cents: 270000,
      currency: "CAD", approver_name: "Dana Whitfield", approved_at: "2026-05-01T12:00:00.000Z"
    }, over || {});
  }
  function intent(over) {
    return Object.assign({
      id: "i1", version_id: "v1", quote_id: "q1", path: "direct", status: "created",
      amount_cents: 50000, currency: "CAD", external_reference: "inv-1", external_system: "accounting"
    }, over || {});
  }
  function invoice(over) {
    return Object.assign({
      id: "inv-1", invoice_number: "INV-00001", subtotal_cents: 50000, tax_cents: 2500, total_cents: 52500,
      tax_rate_bp: 500, line_count: 2, currency: "CAD", status: "open", source: "quote-u"
    }, over || {});
  }

  T.register("reconciliation: the pure report classifies no-approval / awaiting / pending / failed / unverified / matched / mismatch with checks", () => {
    const bad = [];

    const none = R.buildReport({ version_id: "v1", intent: intent(), invoice: invoice() });
    if (none.status !== "no_approval") bad.push("no approval: " + none.status);

    const awaiting = R.buildReport({ version_id: "v1", approval: approval(), invoice: null });
    if (awaiting.status !== "awaiting_invoice") bad.push("awaiting: " + awaiting.status);
    if (awaiting.approved.subtotal_cents !== 50000) bad.push("approved subtotal: " + awaiting.approved.subtotal_cents);
    if (awaiting.approved.line_count !== 2) bad.push("approved line count: " + awaiting.approved.line_count);

    const pending = R.buildReport({ version_id: "v1", approval: approval(), intent: intent({ status: "pending" }) });
    if (pending.status !== "pending") bad.push("pending: " + pending.status);

    const failed = R.buildReport({ version_id: "v1", approval: approval(), intent: intent({ status: "failed", external_reference: null }) });
    if (failed.status !== "failed" || !failed.needs_attention) bad.push("failed: " + failed.status);

    const unverified = R.buildReport({ version_id: "v1", approval: approval(), intent: intent() });
    if (unverified.status !== "unverified" || !unverified.needs_attention) bad.push("unverified: " + unverified.status);

    const matched = R.buildReport({ version_id: "v1", approval: approval(), intent: intent(), invoice: invoice() });
    if (matched.status !== "matched") bad.push("matched: " + matched.status);
    if (matched.failed_checks.length) bad.push("matched has failed checks: " + JSON.stringify(matched.failed_checks));
    if (matched.needs_attention) bad.push("matched flagged for attention");
    if (matched.variance_cents !== 0) bad.push("variance: " + matched.variance_cents);
    if (matched.invoiced.tax_cents !== 2500 || matched.invoiced.total_cents !== 52500) bad.push("invoiced summary: " + JSON.stringify(matched.invoiced));

    const tampered = R.buildReport({ version_id: "v1", approval: approval(), intent: intent(), invoice: invoice({ subtotal_cents: 49900 }) });
    if (tampered.status !== "mismatch") bad.push("mismatch: " + tampered.status);
    if (tampered.failed_checks.indexOf("subtotal_matches") === -1) bad.push("subtotal check not failed: " + JSON.stringify(tampered.failed_checks));
    if (tampered.variance_cents !== -100) bad.push("variance: " + tampered.variance_cents);

    const wrongRef = R.buildReport({ version_id: "v1", approval: approval(), intent: intent({ external_reference: "inv-999" }), invoice: invoice() });
    if (wrongRef.failed_checks.indexOf("reference_matches") === -1) bad.push("reference check: " + JSON.stringify(wrongRef.failed_checks));

    const tolerant = R.buildReport({ version_id: "v1", approval: approval(), intent: intent({ amount_cents: 49950 }), invoice: invoice({ subtotal_cents: 49950 }) }, { policy: { tolerance_cents: 100 } });
    if (tolerant.status !== "matched") bad.push("tolerance should absorb a 50c drift: " + tolerant.status);

    const sum = R.summarize([matched, tampered, failed, awaiting, none]);
    if (sum.total !== 5) bad.push("summary total: " + sum.total);
    if (sum.counts.matched !== 1 || sum.counts.mismatch !== 1 || sum.counts.failed !== 1 || sum.counts.awaiting_invoice !== 1 || sum.counts.no_approval !== 1) bad.push("summary counts: " + JSON.stringify(sum.counts));
    if (sum.needs_attention !== 2) bad.push("summary attention: " + sum.needs_attention);

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the pure report derives every status, the checks catch a tampered subtotal and a wrong reference, tolerance absorbs a small drift, and summarize counts the verdicts" };
  });

  T.register("reconciliation: a real approved + direct-invoiced version reconciles matched, marks reconciled, and audits invoice_reconciled exactly once", async () => {
    const env = makeEnv();
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };
    const approved = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9" });
    if (!approved.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(approved) };

    const enq = await env.invoiceDirect.enqueueForVersion({ quote: approved.quote, version: s.version });
    if (!enq.ok) bad.push("direct enqueue: " + JSON.stringify(enq));
    const run = await env.outbox.runDue();
    if (!run.ok || run.succeeded < 1) bad.push("direct run: " + JSON.stringify(run));

    const f = await env.reconciliation.forVersion(s.version.id);
    if (!f.ok) return { pass: false, detail: "forVersion: " + JSON.stringify(f) };
    if (f.report.status !== "matched") bad.push("status: " + f.report.status + " failed=" + JSON.stringify(f.report.failed_checks));
    if (f.report.approved.subtotal_cents !== 50000) bad.push("approved subtotal: " + f.report.approved.subtotal_cents);
    if (f.report.invoiced.subtotal_cents !== 50000) bad.push("invoiced subtotal: " + f.report.invoiced.subtotal_cents);
    if (f.report.reconciled) bad.push("should not be reconciled before reconcile()");

    const list = await env.reconciliation.list({});
    if (!list.ok || list.total !== 1) bad.push("list: " + JSON.stringify(list.summary));
    else if (list.summary.counts.matched !== 1) bad.push("summary matched: " + JSON.stringify(list.summary.counts));

    const rec = await env.reconciliation.reconcile(s.version.id, { actor: "finance" });
    if (!rec.ok || !rec.reconciled) bad.push("reconcile: " + JSON.stringify(rec));
    const gi = await env.invoiceIntents.getForVersion(s.version.id);
    if (!gi.ok || !gi.intent || gi.intent.status !== "reconciled") bad.push("intent not reconciled: " + JSON.stringify(gi.intent && gi.intent.status));

    const log = await env.audit.forVersion(s.version.id);
    const events = log.records.filter(r => r.event === "invoice_reconciled");
    if (events.length !== 1) bad.push("invoice_reconciled events: " + events.length);
    else if (events[0].detail.path !== "direct" || events[0].detail.approved_cents !== 50000) bad.push("audit detail: " + JSON.stringify(events[0].detail));

    const again = await env.reconciliation.reconcile(s.version.id, { actor: "finance" });
    if (!again.ok || !again.already) bad.push("second reconcile should be idempotent: " + JSON.stringify(again));
    const log2 = await env.audit.forVersion(s.version.id);
    if (log2.records.filter(r => r.event === "invoice_reconciled").length !== 1) bad.push("a second reconcile audited twice");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "an approved, direct-invoiced version reconciles matched, reconcile() flips the intent to reconciled and audits invoice_reconciled once, and a repeat is an idempotent no-op" };
  });

  T.register("reconciliation: the double-billing guard lets exactly one invoice exist across both paths for one version", async () => {
    const env = makeEnv();
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };
    const approved = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9" });
    if (!approved.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(approved) };

    // The direct path wins.
    await env.invoiceDirect.enqueueForVersion({ quote: approved.quote, version: s.version });
    await env.outbox.runDue();
    const acct1 = await env.gateway.call("accounting", "invoiceCount", {}, { scope: "*" });
    if (acct1.result !== 1) bad.push("direct invoice count: " + acct1.result);

    // The PSA path then tries the SAME version. It must be refused.
    const psaEnq = await env.invoicePsa.enqueueForVersion({ quote: approved.quote, version: s.version });
    if (!psaEnq.ok) bad.push("psa enqueue: " + JSON.stringify(psaEnq));
    const run2 = await env.outbox.runDue();
    const psaEntry = run2.ran && run2.ran.find(r => r.action === window.QU_INVOICEPSA.ACTION);
    if (!psaEntry || psaEntry.ok) bad.push("the psa job should have failed: " + JSON.stringify(psaEntry));

    const psaCnt = await env.gateway.call("psa", "psaInvoiceCount", {}, { scope: "*" });
    const acct2 = await env.gateway.call("accounting", "invoiceCount", {}, { scope: "*" });
    if (psaCnt.result !== 0) bad.push("the PSA produced a second invoice: " + psaCnt.result);
    if (acct2.result + psaCnt.result !== 1) bad.push("double billing! total invoices = " + (acct2.result + psaCnt.result));

    // The direct handler on an already-created intent is a clean skip.
    const skip = await env.invoiceDirect.handler({ job: { payload: { version_id: s.version.id, lines: [{ description: "x", amount_cents: 1 }] }, version_id: s.version.id } }, {});
    if (!skip.ok || skip.skipped !== true) bad.push("direct re-run should skip: " + JSON.stringify(skip));
    const skipPsa = await env.invoicePsa.handler({ job: { payload: { version_id: s.version.id, opportunity_id: "op1", lines: [{ description: "x", amount_cents: 1 }] }, version_id: s.version.id } }, {});
    if (skipPsa.ok || skipPsa.code !== "already_invoiced" || skipPsa.terminal !== true) bad.push("psa handler should refuse terminally: " + JSON.stringify(skipPsa));

    const gi = await env.invoiceIntents.getForVersion(s.version.id);
    if (!gi.ok || !gi.intent || gi.intent.path !== "direct" || gi.intent.status !== "created") bad.push("the winning intent changed: " + JSON.stringify(gi.intent));

    const list = await env.invoiceIntents.list({});
    if (!list.ok || list.intents.length !== 1) bad.push("intent rows: " + (list.intents && list.intents.length));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one version, both invoicing paths attempted: exactly one external invoice exists (accounting), the PSA is refused terminally with already_invoiced, and the intent row stays direct/created" };
  });
})();
