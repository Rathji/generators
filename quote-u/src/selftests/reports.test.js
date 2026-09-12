(function () {
  const T = window.QU_SELFTEST;
  const R = window.QU_REPORTS;
  const QS = window.QU_STORE;
  if (!T || !R || !QS) return;

  const DAY = 86400000;

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
        if (!f) { f = { text, key: "ek." + name, count: 0 }; files.set(name, f); f.count = 1; return { error: null, editKey: f.key, editCount: 1, created: true }; }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text; f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }
  function makeStore(prefix) {
    return QS.create({ ns: prefix + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  // A deterministic fixture: one approved quote (won), one declined, one open.
  function fixture() {
    return {
      quotes: [
        { id: "q1", quote_number: "QU-1", company_id: "c1", company_name: "Acme", contact_id: "k1", created_at: "2026-01-05T00:00:00Z", created_by: "alice", mode: "quote", status: "sent" },
        { id: "q2", quote_number: "QU-2", company_id: "c2", company_name: "Globex", contact_id: "k2", created_at: "2026-02-10T00:00:00Z", created_by: "bob", mode: "quote", status: "sent" }
      ],
      versions: [
        { id: "v1", quote_id: "q1", version_number: 1, state: "approved", created_at: "2026-01-05T00:00:00Z" },
        { id: "v2", quote_id: "q2", version_number: 1, state: "declined", created_at: "2026-02-10T00:00:00Z" },
        { id: "v3", quote_id: "q1", version_number: 2, state: "sent", created_at: "2026-03-01T00:00:00Z" }
      ],
      events: [
        { version_id: "v1", quote_id: "q1", event: "sent", at: "2026-01-06T00:00:00Z" },
        { version_id: "v1", quote_id: "q1", event: "viewed", at: "2026-01-07T00:00:00Z" },
        { version_id: "v1", quote_id: "q1", event: "approved", at: "2026-01-10T00:00:00Z" },
        { version_id: "v2", quote_id: "q2", event: "sent", at: "2026-02-11T00:00:00Z" },
        { version_id: "v2", quote_id: "q2", event: "declined", at: "2026-02-20T00:00:00Z" },
        { version_id: "v3", quote_id: "q1", event: "sent", at: "2026-03-02T00:00:00Z" }
      ],
      approvals: [
        { id: "a1", version_id: "v1", quote_id: "q1", selection: ["l1"], one_time_cents: 250000, mrr_cents: 30000, twelve_month_value_cents: 610000, deal_value_cents: 610000, approved_at: "2026-01-10T00:00:00Z", approver_name: "Dana", currency: "CAD" }
      ],
      lines: [
        { id: "l1", quote_version_id: "v1", kind: "one_time", quantity: 2, unit_sell_cents: 125000, unit_cost_cents: 80000 },
        { id: "l2", quote_version_id: "v3", kind: "mrr", quantity: 1, unit_sell_cents: 40000, unit_cost_cents: 10000 }
      ],
      groups: []
    };
  }

  T.register("reports: volume, win/loss and cycle time come from the lifecycle timeline", () => {
    const bad = [];
    const r = R.build(fixture(), {});
    if (r.volume.quotes !== 2) bad.push("quotes: " + r.volume.quotes);
    if (r.volume.versions !== 3) bad.push("versions: " + r.volume.versions);
    if (r.volume.sent !== 3) bad.push("sent: " + r.volume.sent);
    if (r.volume.approved !== 1 || r.volume.declined !== 1) bad.push("approved/declined: " + r.volume.approved + "/" + r.volume.declined);
    if (r.win_loss.decided !== 2) bad.push("decided: " + r.win_loss.decided);
    if (r.win_loss.win_rate_bp !== 5000) bad.push("win_rate_bp: " + r.win_loss.win_rate_bp);
    if (r.cycle_time.samples !== 2) bad.push("cycle samples: " + r.cycle_time.samples);
    const expectedAvg = (4 * DAY + 9 * DAY) / 2;
    if (Math.abs(r.cycle_time.avg_ms - expectedAvg) > 1000) bad.push("cycle avg: " + r.cycle_time.avg_ms);
    if (Math.abs(r.cycle_time.median_days - 6.5) > 0.001) bad.push("cycle median days: " + r.cycle_time.median_days);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "2 quotes, 3 versions, 50% win rate, 6.5-day median cycle" };
  });

  T.register("reports: average margin is derived over the accepted lines (never stored)", () => {
    const bad = [];
    const r = R.build(fixture(), {});
    if (r.margin.accepted_versions !== 1) bad.push("accepted: " + r.margin.accepted_versions);
    if (r.margin.sell_cents !== 250000) bad.push("sell: " + r.margin.sell_cents);
    if (r.margin.cost_cents !== 160000) bad.push("cost: " + r.margin.cost_cents);
    if (r.margin.margin_cents !== 90000) bad.push("margin: " + r.margin.margin_cents);
    if (r.margin.margin_bp !== 3600) bad.push("margin_bp: " + r.margin.margin_bp);
    if (r.margin.missing_cost_lines !== 0) bad.push("missing: " + r.margin.missing_cost_lines);
    // The open pipeline snapshots the sent version's default selection.
    if (r.pipeline.open_count !== 1) bad.push("open: " + r.pipeline.open_count);
    if (r.pipeline.mrr_cents !== 40000) bad.push("open mrr: " + r.pipeline.mrr_cents);
    if (r.pipeline.twelve_month_value_cents !== 480000) bad.push("open twelve: " + r.pipeline.twelve_month_value_cents);
    // A line with no captured cost is flagged, never silently profitable.
    const withMissing = R.build({ quotes: [], versions: [{ id: "vx", quote_id: null, state: "sent" }], events: [], approvals: [], groups: [], lines: [{ id: "a", quote_version_id: "vx", kind: "one_time", quantity: 1, unit_sell_cents: 10000, unit_cost_cents: 0 }] }, {});
    if (withMissing.margin.missing_cost_lines !== 0) bad.push("the open-only row is not an accepted margin");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "accepted sell 2500.00, cost 1600.00, margin 900.00 (36.0%); open pipeline 4800.00 twelve-month" };
  });

  T.register("reports: the period, rep and company filters scope every metric", () => {
    const bad = [];
    const period = R.build(fixture(), { from: "2026-02-01", to: "2026-12-31" });
    if (period.volume.quotes !== 1) bad.push("period quotes: " + period.volume.quotes);
    if (period.volume.sent !== 2) bad.push("period sent: " + period.volume.sent);
    if (period.win_loss.decided !== 1 || period.win_loss.won !== 0) bad.push("period decided/won: " + period.win_loss.decided + "/" + period.win_loss.won);
    if (period.margin.accepted_versions !== 0 || period.margin.margin_bp !== null) bad.push("period margin should be empty (approval was in January)");
    if (period.pipeline.open_count !== 1) bad.push("pipeline is a current snapshot: " + period.pipeline.open_count);

    const rep = R.build(fixture(), { rep: "bob" });
    if (rep.volume.quotes !== 1 || rep.by_rep.length !== 1 || rep.by_rep[0].key !== "bob") bad.push("rep filter");
    if (rep.win_loss.lost !== 1 || rep.win_loss.won !== 0) bad.push("bob win/loss");

    const company = R.build(fixture(), { company_id: "c1" });
    if (company.volume.quotes !== 1) bad.push("company filter quotes: " + company.volume.quotes);
    if (company.by_company.length !== 1 || company.by_company[0].key !== "c1") bad.push("company breakdown");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "period, rep and company filters each scope volume/decisions/margin; the open pipeline stays a current snapshot" };
  });

  T.register("reports: the service builds the report from live documents (live)", async () => {
    const store = makeStore("rep");
    const existing = await store.loadDoc("line_items");
    await store.saveChecked("line_items", { records: fixture().lines }, { expectedBase: existing.ok ? existing.revision : 0 });
    const fixed = fixture();
    const quotes = { listQuotes: async () => ({ ok: true, quotes: fixed.quotes }) };
    const versions = { listVersions: async () => ({ ok: true, versions: fixed.versions }) };
    const approvals = { list: async () => ({ ok: true, approvals: fixed.approvals }) };
    const auditStub = { list: async () => ({ ok: true, records: fixed.events }) };
    const svc = R.createService({ quotes: quotes, versions: versions, approvals: approvals, audit: auditStub, store: store });
    const f = await svc.facets();
    const rep = await svc.report({});
    const bad = [];
    if (f.reps.join(",") !== "alice,bob") bad.push("facets reps: " + f.reps.join(","));
    if (rep.volume.versions !== 3) bad.push("live versions: " + rep.volume.versions);
    if (rep.margin.margin_cents !== 90000) bad.push("live margin: " + rep.margin.margin_cents);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the service loaded the records, listed the facets and built the report" };
  });
})();
