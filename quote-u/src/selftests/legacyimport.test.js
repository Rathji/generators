(function () {
  const T = window.QU_SELFTEST;
  const L = window.QU_LEGACY;
  const QS = window.QU_STORE;
  const A = window.QU_ANALYTICS;
  if (!T || !L || !QS || !A) return;

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
  function makeStore(prefix) {
    return QS.create({ ns: prefix + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  const CATALOG_CSV = [
    "sku,description,category,kind,unit_cost,markup_bp,currency",
    'RTR-1,"Router, 24-port",hardware,one_time,800.00,3000,CAD',
    "SUP-1,Support plan,services,mrr,100.00,5000,CAD"
  ].join("\n") + "\n";

  const QUOTES_CSV = [
    "quote_number,company,contact,title,rep,status,created_at,total,currency",
    "LEG-100,Acme Ltd,Dana,Acme refresh,alice,won,2026-01-05,2000.00,CAD",
    "LEG-101,Globex,Sam,Globex phones,bob,sent,2026-02-01,500.00,CAD"
  ].join("\n") + "\n";

  const LINES_CSV = [
    "quote_number,description,quantity,unit_price,unit_cost,kind",
    'LEG-100,"Router, 24-port",2,1000.00,800.00,one_time',
    "LEG-101,Phones,1,500.00,400.00,one_time"
  ].join("\n") + "\n";

  const HISTORY_CSV = [
    "quote_number,company,rep,decision,sent_at,decided_at,one_time,total,sell,cost,currency",
    "LEG-090,Initech,alice,won,2025-11-01,2025-11-10,1500.00,1500.00,1500.00,1000.00,CAD",
    "LEG-091,Umbrella,bob,lost,2025-12-01,2025-12-05,0,0,900.00,700.00,CAD"
  ].join("\n") + "\n";

  function makeEnv() {
    const store = makeStore("leg");
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const catalog = window.QU_CATALOG.createService({ store });
    const legacy = L.createService({ store, catalog, quotes, versions, audit });
    return { store, audit, gateway, quotes, versions, catalog, legacy };
  }

  T.register("legacy import: the CSV adapter handles quoted fields and maps money to integer cents", () => {
    const bad = [];
    const parsed = L.parseCsv(CATALOG_CSV);
    if (parsed.rows.length !== 2) bad.push("rows: " + parsed.rows.length);
    if (parsed.rows[0]["description"] !== "Router, 24-port") bad.push("embedded comma: " + parsed.rows[0]["description"]);
    if (L.moneyToCents("800.00") !== 80000) bad.push("money 800.00: " + L.moneyToCents("800.00"));
    if (L.moneyToCents("$1,234.56") !== 123456) bad.push("money with symbol/comma: " + L.moneyToCents("$1,234.56"));
    if (L.moneyToCents("") !== null) bad.push("empty money should be null");
    const item = L.mapCatalogRow(parsed.rows[0]);
    if (item.id !== "cat-legacy-rtr-1") bad.push("id: " + item.id);
    if (item.default_kind !== "one_time") bad.push("kind: " + item.default_kind);
    if (item.unit_cost_cents !== 80000 || item.default_markup_bp !== 3000) bad.push("cost/markup");
    if (item.currency !== "CAD") bad.push("currency: " + item.currency);
    const mrr = L.mapCatalogRow(parsed.rows[1]);
    if (mrr.default_kind !== "mrr") bad.push("mrr kind: " + mrr.default_kind);
    // Quotes/lines too.
    const qRows = L.parseCsv(QUOTES_CSV).rows;
    const lRows = L.parseCsv(LINES_CSV).rows;
    const lines = L.groupLines(lRows);
    const quote = L.mapQuoteRow(qRows[0], lines.get("LEG-100"));
    if (quote.company_name !== "Acme Ltd" || quote.created_by !== "alice") bad.push("quote mapping");
    if (quote.legacy_total_cents !== 200000) bad.push("legacy total: " + quote.legacy_total_cents);
    if (quote.lines.length !== 1 || quote.lines[0].unit_sell_cents !== 100000) bad.push("line mapping");
    if (quote.lines[0].quantity !== 2) bad.push("line quantity");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "CSV quoted fields survive; money → cents; catalog/quote/line rows map to quote-u inputs" };
  });

  T.register("legacy import: reconciliation reports counts and totals with an explicit variance", () => {
    const bad = [];
    const src = [
      { legacy_ref: "A", legacy_total_cents: 100000 },
      { legacy_ref: "B", legacy_total_cents: 50000 }
    ];
    const ok = L.reconcile({
      source_quotes: src,
      imported_quotes: [{ legacy_ref: "A", imported_total_cents: 100000 }, { legacy_ref: "B", imported_total_cents: 50000 }],
      source_catalog: [{}, {}], imported_catalog: [{}, {}],
      source_history: [{}], exported_history: [{}]
    });
    if (!ok.ok) bad.push("a matched run should reconcile");
    if (ok.counts.source_quotes !== 2 || ok.counts.imported_quotes !== 2) bad.push("counts");
    if (ok.totals.source_cents !== 150000 || ok.totals.imported_cents !== 150000 || ok.totals.variance_cents !== 0) bad.push("matched totals: " + JSON.stringify(ok.totals));
    const drift = L.reconcile({
      source_quotes: src,
      imported_quotes: [{ legacy_ref: "A", imported_total_cents: 99000 }],
      source_catalog: [], imported_catalog: [],
      source_history: [], exported_history: []
    });
    if (drift.ok) bad.push("a drifted run reconciled as ok");
    if (drift.refs.missing.join(",") !== "B") bad.push("missing refs: " + drift.refs.missing.join(","));
    if (drift.totals.variance_cents !== -51000) bad.push("variance: " + drift.totals.variance_cents);
    const checks = {};
    drift.checks.forEach(c => { checks[c.key] = c; });
    if (!checks.quotes_count || checks.quotes_count.ok) bad.push("quotes_count should fail");
    if (!checks.open_quote_totals || checks.open_quote_totals.ok) bad.push("open_quote_totals should fail");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a matched run reconciles; a missing quote and a −10.00 variance are both surfaced as failed checks" };
  });

  T.register("legacy import: run imports the catalog, re-keys open quotes and exports history (live)", async () => {
    const env = makeEnv();
    const bad = [];
    const res = await env.legacy.run({ catalog: CATALOG_CSV, quotes: QUOTES_CSV, lines: LINES_CSV, history: HISTORY_CSV, by: "tester" });
    if (!res.ok) return { pass: false, detail: "run failed: " + JSON.stringify(res).slice(0, 500) };
    if (!res.reconciliation.ok) bad.push("reconciliation: " + JSON.stringify(res.reconciliation.refs));
    if (res.record.counts.imported_quotes !== 2) bad.push("imported quotes: " + res.record.counts.imported_quotes);
    // The quotes now exist as quote-u quotes with fresh ids and preserved numbers.
    const q = await env.quotes.listQuotes({ scope: "*" }, {});
    if (!q.ok || q.quotes.length !== 2) bad.push("stored quotes: " + (q.ok && q.quotes.length));
    const leg100 = q.quotes.find(x => x.quote_number === "LEG-100");
    if (!leg100) bad.push("LEG-100 not preserved");
    else if (leg100.id === "LEG-100" || !leg100.imported) bad.push("LEG-100 was not re-keyed/imported");
    // The catalog was imported.
    const cat = await env.catalog.list();
    if (!cat.ok || cat.items.length !== 2) bad.push("catalog items: " + (cat.ok && cat.items.length));
    // The migration record is durable.
    const listed = await env.legacy.list();
    if (!listed.ok || listed.total !== 1) bad.push("migration records: " + (listed.ok && listed.total));
    if (listed.ok && listed.migrations[0].legacy_system !== "legacy") bad.push("record system");
    // The history export is a schema-valid analytics extract.
    if (!res.history) bad.push("no history extract");
    else {
      const v = A.verify(res.history);
      if (!v.ok) bad.push("history extract invalid: " + JSON.stringify(v.violations).slice(0, 200));
      if (res.history.tables.decisions.length !== 2) bad.push("history decisions: " + res.history.tables.decisions.length);
      const won = res.history.tables.decisions.find(d => d.quote_number === "LEG-090");
      if (!won || won.decision !== "approved") bad.push("LEG-090 decision");
      if (!res.history.tables.margins.some(m => m.quote_number === "LEG-090" && m.margin_cents === 50000)) bad.push("LEG-090 margin not exported");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "2 quotes re-keyed with legacy numbers preserved, 2 catalog items, 1 durable record, and a schema-valid history extract (2 decisions, margin 500.00)" };
  });

  T.register("legacy import: cutover records the legacy tool as read-only", async () => {
    const env = makeEnv();
    const bad = [];
    const cut = await env.legacy.cutover({ by: "tester", note: "frozen at cutover" });
    if (!cut.ok) return { pass: false, detail: "cutover failed: " + JSON.stringify(cut) };
    if (cut.record.read_only !== true) bad.push("not marked read-only");
    if (!cut.record.cutover_at) bad.push("no cutover timestamp");
    const listed = await env.legacy.list();
    if (!listed.ok || listed.total !== 1) bad.push("records: " + (listed.ok && listed.total));
    if (listed.ok && listed.migrations[0].kind !== "cutover") bad.push("kind: " + listed.migrations[0].kind);
    const st = env.legacy.status();
    if (st.read_only !== true) bad.push("status not read-only");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the cutover appends a read-only marker record; the adapter itself only ever reads the legacy source" };
  });
})();
