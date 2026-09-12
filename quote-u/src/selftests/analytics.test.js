(function () {
  const T = window.QU_SELFTEST;
  const A = window.QU_ANALYTICS;
  const R = window.QU_REPORTS;
  if (!T || !A || !R) return;

  const DAY = 86400000;

  // The same deterministic fixture the reports tests use: one approved quote
  // (won), one declined and one open version.
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

  T.register("analytics: the extract matches the frozen schema exactly and verifies", () => {
    const bad = [];
    const ex = A.extract(fixture());
    if (ex.schema !== "quote-u.analytics") bad.push("schema: " + ex.schema);
    if (ex.version !== A.SCHEMA_VERSION) bad.push("version: " + ex.version);
    if (ex.counts.quotes !== 2) bad.push("quotes: " + ex.counts.quotes);
    if (ex.counts.decisions !== 2) bad.push("decisions: " + ex.counts.decisions);
    if (ex.counts.margins !== 1) bad.push("margins: " + ex.counts.margins);
    const v = A.verify(ex);
    if (!v.ok) bad.push("verify: " + JSON.stringify(v.violations).slice(0, 200));
    Object.keys(A.TABLES).forEach(t => {
      const want = A.TABLES[t].join(",");
      (ex.tables[t] || []).forEach((row, i) => {
        if (Object.keys(row).join(",") !== want) bad.push(t + "[" + i + "] keys: " + Object.keys(row).join(","));
      });
    });
    const fp = A.fingerprint();
    if (typeof fp !== "string" || fp.indexOf("qax-") !== 0) bad.push("fingerprint: " + fp);
    if (A.fingerprint() !== fp) bad.push("fingerprint not stable");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "2 quotes, 2 decisions, 1 margin; every row carries exactly the frozen columns (" + fp + ")" };
  });

  T.register("analytics: decisions carry cycle time and margins carry the derived (never stored) margin", () => {
    const bad = [];
    const ex = A.extract(fixture());
    const d1 = ex.tables.decisions.find(r => r.version_id === "v1");
    const d2 = ex.tables.decisions.find(r => r.version_id === "v2");
    if (!d1 || !d2) return { pass: false, detail: "missing decision rows" };
    if (d1.decision !== "approved") bad.push("v1 decision: " + d1.decision);
    if (Math.abs(d1.cycle_days - 4) > 0.001) bad.push("v1 cycle_days: " + d1.cycle_days);
    if (d1.deal_value_cents !== 610000) bad.push("v1 deal: " + d1.deal_value_cents);
    if (d2.decision !== "declined") bad.push("v2 decision: " + d2.decision);
    if (Math.abs(d2.cycle_days - 9) > 0.001) bad.push("v2 cycle_days: " + d2.cycle_days);
    const m = ex.tables.margins[0];
    if (!m) return { pass: false, detail: "no margin row" };
    if (m.sell_cents !== 250000) bad.push("sell: " + m.sell_cents);
    if (m.cost_cents !== 160000) bad.push("cost: " + m.cost_cents);
    if (m.margin_cents !== 90000) bad.push("margin: " + m.margin_cents);
    if (m.margin_bp !== 3600) bad.push("margin_bp: " + m.margin_bp);
    if (m.currency !== "CAD") bad.push("currency: " + m.currency);
    if (m.missing_cost_lines !== 0) bad.push("missing: " + m.missing_cost_lines);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "decisions carry 4.0/9.0-day cycles; the margin row shows sell 2500.00 − cost 1600.00 = 900.00 (36.0%)" };
  });

  T.register("analytics: verify refuses a drifted row and the fingerprint is data-independent", () => {
    const bad = [];
    const ex = A.extract(fixture());
    if (!A.verify(ex).ok) bad.push("the baseline should verify");
    const dropped = JSON.parse(JSON.stringify(ex));
    delete dropped.tables.quotes[0].mode;
    const dv = A.verify(dropped);
    if (dv.ok || !dv.violations.some(x => x.code === "missing_column")) bad.push("a dropped column was not caught: " + JSON.stringify(dv.violations).slice(0, 200));
    const extra = JSON.parse(JSON.stringify(ex));
    extra.tables.decisions[0].surprise = 1;
    const ev = A.verify(extra);
    if (ev.ok || !ev.violations.some(x => x.code === "extra_column")) bad.push("an extra column was not caught");
    const renamed = JSON.parse(JSON.stringify(ex));
    renamed.tables.margins[0].cost_cents_x = renamed.tables.margins[0].cost_cents;
    delete renamed.tables.margins[0].cost_cents;
    if (A.verify(renamed).ok) bad.push("a renamed column was not caught");
    // Fingerprint depends only on the schema, not the data.
    const empty = A.extractFrom({ quotes: [], decisions: [], margins: [] });
    if (empty.fingerprint !== ex.fingerprint) bad.push("fingerprint changed with the data");
    if (A.verify(empty).ok !== true) bad.push("an empty extract should still verify");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "missing/extra/renamed columns are refused; the schema fingerprint is stable and data-independent" };
  });

  T.register("analytics: publish sends a versioned envelope through the gateway (never a raw write)", async () => {
    const bad = [];
    const calls = [];
    const gateway = { call: (name, fn, payload, opts) => { calls.push({ name: name, fn: fn, payload: payload, opts: opts }); return { ok: true, result: {} }; } };
    const svc = A.createService({ gateway: gateway, dataset: fixture(), generatorName: "quote-u" });
    const ex = await svc.buildExtract();
    const res = await svc.publish(ex, { by: "tester" });
    if (!res.ok) return { pass: false, detail: "publish failed: " + JSON.stringify(res) };
    if (calls.length !== 1) bad.push("gateway calls: " + calls.length);
    const c = calls[0] || {};
    if (c.name !== "bus" || c.fn !== "publish") bad.push("gateway route: " + c.name + "." + c.fn);
    if (!c.payload || c.payload.stream !== "bus-quote-analytics") bad.push("stream: " + (c.payload && c.payload.stream));
    const env = c.payload && c.payload.envelope;
    if (!env || env.schema !== "pipeline.analytics-extract") bad.push("envelope schema");
    if (!env || env.version !== A.SCHEMA_VERSION) bad.push("envelope version");
    if (!env || env.tables.quotes.length !== 2) bad.push("envelope tables");
    if (!c.opts || !c.opts.confirm) bad.push("publish was not confirmed");
    if (!svc.history() || svc.history().fingerprint !== ex.fingerprint) bad.push("history not recorded");
    // An invalid extract is refused BEFORE any gateway call.
    const before = calls.length;
    const badPub = await svc.publish({ schema: "nope", version: 99, tables: {} }, {});
    if (badPub.ok || badPub.code !== "extract_invalid") bad.push("an invalid extract was published");
    if (calls.length !== before) bad.push("an invalid extract reached the gateway");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the extract is published as a versioned pipeline.analytics-extract envelope on the bus with a confirm; invalid extracts never reach the gateway" };
  });
})();
