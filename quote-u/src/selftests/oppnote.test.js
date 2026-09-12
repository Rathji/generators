(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const N = window.QU_OPPNOTE;
  const O = window.QU_OUTBOX;
  if (!T || !QS || !N || !O) return;

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
    const ns = "note" + QS.randHex(6);
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
    const oppNote = N.createService({ outbox, gateway, quotes, versions, priceSnapshots: prices, audit, policy: approvalPolicy, scope: "*" });
    const revenue = window.QU_REVENUE.createService({ outbox, gateway, quotes, versions, audit, policy: approvalPolicy, scope: "*" });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, recompute, outbox, oppSync, oppNote, revenue });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, recompute, events, approvals, outbox, oppSync, oppNote, revenue, read, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  // A quote LINKED to op1 (c1): a $300 one-time line and a $200/mo MRR line.
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

  T.register("oppnote: the products/costs/part-numbers block is built from the frozen lines and their snapshots, and an unlinked quote is refused", () => {
    const bad = [];
    const lines = [
      { id: "l1", sort_order: 0, kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000, manufacturer_part_number: "MR46", sku: "HW-AP-MR46", price_snapshot_ref: "snap1" },
      { id: "l2", sort_order: 1, kind: "mrr", description: "Managed IT", quantity: 1, unit_cost_cents: 10000, unit_sell_cents: 20000 },
      { id: "l3", sort_order: 2, kind: "one_time", description: "Extra cover", quantity: 1, unit_cost_cents: 1000, unit_sell_cents: 5000, optional: true, selected_by_default: false }
    ];
    const snapshots = [{ id: "snap1", source: "distributor-a", distributor_sku: "DA-99", unit_cost_cents: 8500, list_price_cents: 12000, quantity_available: 42, warehouse: "YYZ", captured_at: "2026-05-01T00:00:00Z" }];
    const rows = N.buildRows({ line_items: lines, snapshots: snapshots, selection: ["l1", "l2"] });
    if (rows.length !== 2) bad.push("rows should list only the accepted lines, got " + rows.length);
    const r1 = rows.find(r => r.line_id === "l1");
    if (!r1) bad.push("l1 missing");
    else {
      if (r1.amount_cents !== 30000) bad.push("l1 amount: " + r1.amount_cents);
      if (r1.unit_cost_cents !== 8500 || r1.cost_source !== "snapshot") bad.push("l1 cost should come from the snapshot: " + JSON.stringify({ c: r1.unit_cost_cents, s: r1.cost_source }));
      if (!r1.snapshot || r1.snapshot.warehouse !== "YYZ" || r1.snapshot.quantity_available !== 42) bad.push("l1 snapshot detail: " + JSON.stringify(r1.snapshot));
      if (r1.mpn !== "MR46") bad.push("l1 MPN: " + r1.mpn);
    }
    const r2 = rows.find(r => r.line_id === "l2");
    if (r2 && (r2.cost_source !== "line" || r2.unit_cost_cents !== 10000)) bad.push("l2 should fall back to the line cost: " + JSON.stringify(r2));

    const text = N.renderText({ rows: rows, quote: { quote_number: "Q-0001", title: "Network refresh" }, totals: { one_time_cents: 30000, mrr_cents: 20000, twelve_month_value_cents: 270000, currency: "CAD" }, approver_name: "Dana", approved_at: "2026-06-01T00:00:00Z", opportunity_id: "op1" });
    if (text.indexOf("MPN MR46") === -1) bad.push("note text lacks the MPN");
    if (text.indexOf("snapshot snap1") === -1) bad.push("note text lacks the snapshot provenance");
    if (text.indexOf("12-month value") === -1) bad.push("note text lacks the totals");

    // The optional line is off, so only the two required lines are noted even
    // though the selection names just l1.
    const built = N.buildPayload({ version: { id: "v1" }, quote: { id: "q1", company_id: "c1", opportunity_id: "op1" }, line_items: lines, snapshots: snapshots, selection: ["l1"], totals: { currency: "CAD" } });
    if (!built.ok) bad.push("valid payload refused: " + JSON.stringify(built));
    else {
      if (built.payload.idempotency_key !== "v1:note_write") bad.push("key: " + built.payload.idempotency_key);
      if (built.payload.structured.line_count !== 2) bad.push("structured.line_count: " + built.payload.structured.line_count);
    }
    const none = N.buildPayload({ version: { id: "v1" }, quote: { id: "q1", opportunity_id: null }, line_items: lines });
    if (none.ok || none.code !== "no_opportunity") bad.push("unlinked quote not refused: " + JSON.stringify(none));
    if (N.normalizePolicy({ write_note: false }).enabled !== false) bad.push("write_note:false did not disable the note");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the note lists only the accepted lines with their MPN/SKU, joins each to its snapshot provenance and cost, and refuses an unlinked quote" };
  });

  T.register("oppnote: approval writes the note once to the linked opportunity, audits it, and a retry cannot attach a second note", async () => {
    const env = makeEnv();
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(s.created) };

    const res = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.note_write || res.note_write.external_ok !== true) bad.push("note write did not run: " + JSON.stringify(res.note_write));

    const got = await env.gateway.call("psa", "getOpportunityNotes", { id: "op1" }, { scope: "*" });
    if (!got.ok) bad.push("notes unreadable: " + JSON.stringify(got));
    else {
      if (got.result.note_count !== 1) bad.push("note_count: " + got.result.note_count);
      const body = (got.result.notes[0] && got.result.notes[0].body) || "";
      if (body.indexOf("Router") === -1 || body.indexOf("Managed IT") === -1) bad.push("note body missing the sold items");
      if (body.indexOf("Approved by Dana Whitfield") === -1) bad.push("note body missing the approver");
    }

    const log = await env.audit.forVersion(s.version.id);
    const evs = log.records.filter(r => r.event === "note_written");
    if (evs.length !== 1) bad.push("note_written audit events: " + evs.length);
    else if (evs[0].actor_type !== "system") bad.push("note_written actor_type: " + evs[0].actor_type);

    // Re-enqueue the same version and run the worker: the key dedupes and the
    // adapter is idempotent, so no second note reaches the opportunity (I5).
    const enq = await env.oppNote.enqueueForApproval({ quote: s.created.quote, version: s.version, selection: [] });
    if (!enq.ok || !enq.deduped) bad.push("re-enqueue was not deduped");
    await env.outbox.runDue({ now: Date.parse("2026-06-01T00:00:00Z") });
    const after = await env.gateway.call("psa", "getOpportunityNotes", { id: "op1" }, { scope: "*" });
    if (after.result.note_count !== 1) bad.push("a duplicate note reached the connector: " + after.result.note_count);

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approval enqueues note_write, the worker attaches one note (products + costs + provenance) to the linked deal and audits it, and dedupe keeps it to exactly one" };
  });

  T.register("oppnote: a disabled write_note flag skips the note entirely", async () => {
    const env = makeEnv({ policy: { write_note: false } });
    const s = await seedLinked(env);
    const bad = [];
    if (!s.ok) return { pass: false, detail: "seed failed" };
    const res = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana" }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.note_write || res.note_write.skipped !== true) bad.push("note_write should be skipped when disabled: " + JSON.stringify(res.note_write));
    const got = await env.gateway.call("psa", "getOpportunityNotes", { id: "op1" }, { scope: "*" });
    if (!got.ok || got.result.note_count !== 0) bad.push("a note was written despite the flag: " + JSON.stringify(got));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "with write_note disabled no note is enqueued or written" };
  });
})();
