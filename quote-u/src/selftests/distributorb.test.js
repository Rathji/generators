(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const D = window.QU_DISTRIBUTORS;
  const A = window.QU_DISTRIBUTORA;
  const B = window.QU_DISTRIBUTORB;
  const F = window.QU_FEATURES;
  const C = window.QU_CONNECTORS;
  if (!T || !QS || !D || !A || !B || !F || !C) return;

  const ISO = "2026-01-01T00:00:00.000Z";

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

  function makeStore() {
    return QS.create({ ns: "distB" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function gatewayWith(names) {
    const base = C.createDefault();
    base.register(A.NAME, A.create());
    base.register(B.NAME, B.create());
    return base;
  }

  T.register("distributor B: its own bearer/version auth model is applied GET-only, and its wire shape parses to the identical canonical record", async () => {
    const bad = [];

    let seenB = null;
    const fetchB = (url, init) => {
      seenB = { url: url, init: init };
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ status: "success", ts: ISO, payload: { product: { vendor_sku: "HL-MR46", part_number: "MR46", upc: "012345678901", title: "Meraki MR46", group: "wireless", net: 405, msrp: 599, qty: 6, location: "YVR", currency: "CAD" } } }) });
    };
    const tB = B.createHttpTransport({ baseUrl: "https://b.example.com", token: "tok-xyz", fetchImpl: fetchB });
    const connB = D.createDistributor({ name: B.NAME, source: B.SOURCE, transport: tB, parse: { searchCatalog: B.parseSearch, getPrice: B.parsePrice, getAvailability: B.parseAvailability }, policy: { min_interval_ms: 0 } });
    const recB = await connB.functions.getPrice({ part: "MR46" });
    if (seenB.init.method !== "GET") bad.push("B method: " + seenB.init.method);
    if (seenB.init.headers.Authorization !== "Bearer tok-xyz") bad.push("B bearer header: " + JSON.stringify(seenB.init.headers));
    if (seenB.init.headers["X-Api-Version"] !== B.API_VERSION) bad.push("B api-version header: " + JSON.stringify(seenB.init.headers));
    if (seenB.url.indexOf("api_key") !== -1) bad.push("B must not send a query api key: " + seenB.url);
    if (recB.unit_cost_cents !== 40500) bad.push("B unit_cost_cents: " + recB.unit_cost_cents);
    if (recB.list_price_cents !== 59900) bad.push("B list_price_cents: " + recB.list_price_cents);
    if (recB.raw_response.vendor_sku !== "HL-MR46") bad.push("B raw_response not preserved");

    let noToken = null;
    try { B.createHttpTransport({ baseUrl: "https://b.example.com", fetchImpl: fetchB }); } catch (e) { noToken = e; }
    if (!noToken || noToken.code !== "no_token") bad.push("missing token should be refused: " + JSON.stringify(noToken && noToken.code));

    // Distributor A's model is different: header + query key, never bearer.
    let seenA = null;
    const fetchA = (url, init) => {
      seenA = { url: url, init: init };
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, captured_at: ISO, product: { sku: "RX-MR46", mpn: "MR46", upc: "012345678901", desc: "Meraki MR46", cat: "wireless", cost: "412.50", list: "599.00", on_hand: 12, whse: "YYZ", cur: "CAD" } }) });
    };
    const tA = A.createHttpTransport({ baseUrl: "https://a.example.com", apiKey: "key-xyz", fetchImpl: fetchA });
    const connA = D.createDistributor({ name: A.NAME, source: A.SOURCE, transport: tA, parse: { searchCatalog: A.parseSearch, getPrice: A.parsePrice, getAvailability: A.parseAvailability }, policy: { min_interval_ms: 0 } });
    const recA = await connA.functions.getPrice({ part: "MR46" });
    if (seenA.init.headers["X-Api-Key"] !== "key-xyz" || seenA.url.indexOf("api_key=key-xyz") === -1) bad.push("A key header/query: " + JSON.stringify(seenA.init.headers) + " " + seenA.url);
    if (seenA.init.headers.Authorization) bad.push("A must not send a bearer token");
    if (recA.unit_cost_cents !== 41250) bad.push("A unit_cost_cents: " + recA.unit_cost_cents);

    // Despite different wire formats, both normalize to the identical key set.
    const ka = Object.keys(recA).sort().join(",");
    const kb = Object.keys(recB).sort().join(",");
    if (ka !== kb) bad.push("canonical keys differ: " + ka + " vs " + kb);
    if (ka !== D.RECORD_FIELDS.slice().sort().join(",")) bad.push("not the canonical record: " + ka);
    if (recA.source !== "distributor_a" || recB.source !== "distributor_b") bad.push("sources: " + recA.source + "/" + recB.source);

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "distributor B authenticates with Authorization: Bearer + X-Api-Version over GET (no query key), A uses X-Api-Key + api_key, and both wire shapes parse to the identical canonical key set" };
  });

  T.register("distributors: two sources are interchangeable behind one interface — search merges and compare ranks the cheaper source first", async () => {
    const bad = [];
    const base = gatewayWith();
    const store = makeStore();
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const svc = D.createService({ gateway: base, names: [A.NAME, B.NAME], priceSnapshots: prices });

    const names = svc.list();
    if (names.length !== 2 || names.indexOf(A.NAME) === -1 || names.indexOf(B.NAME) === -1) bad.push("service names: " + JSON.stringify(names));

    const search = await svc.search("wireless");
    if (Object.keys(search.by_source).length !== 2) bad.push("search should hit both sources: " + JSON.stringify(search.errors));
    if (search.results.length !== 5) bad.push("merged search results: " + search.results.length);
    if (search.errors.length) bad.push("search errors: " + JSON.stringify(search.errors));

    const cmp = await svc.compare("MR46");
    if (!cmp.ok || cmp.rows.length !== 2) return { pass: false, detail: "compare rows: " + JSON.stringify(cmp.rows && cmp.rows.length) + " errors=" + JSON.stringify(cmp.errors) };
    if (cmp.rows[0].source !== B.NAME || cmp.rows[0].unit_cost_cents !== 40500) bad.push("cheapest first: " + JSON.stringify(cmp.rows.map(r => ({ s: r.source, c: r.unit_cost_cents }))));
    if (cmp.rows[1].source !== A.NAME || cmp.rows[1].unit_cost_cents !== 41250) bad.push("second row: " + JSON.stringify(cmp.rows.map(r => ({ s: r.source, c: r.unit_cost_cents }))));
    if (!cmp.best || cmp.best.source !== B.NAME || cmp.best.unit_cost_cents !== 40500) bad.push("best: " + JSON.stringify(cmp.best && cmp.best.source));
    if (cmp.rows[0].record.quantity_available !== 6 || cmp.rows[1].record.quantity_available !== 12) bad.push("availability merged into rows: " + JSON.stringify(cmp.rows.map(r => r.quantity_available)));

    const shapeB = Object.keys(cmp.rows[0].record).sort().join(",");
    const shapeA = Object.keys(cmp.rows[1].record).sort().join(",");
    if (shapeB !== shapeA) bad.push("record shapes differ across sources");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "both distributors register in one gateway; search merges their catalogs and compare returns both sources cheapest-first (B 40500c < A 41250c) with an identical record shape" };
  });

  T.register("distributors: capture seals an immutable snapshot and the feature/data-mode guard gates every distributor read", async () => {
    const bad = [];
    const base = gatewayWith();
    const store = makeStore();
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const svc = D.createService({ gateway: base, names: [A.NAME, B.NAME], priceSnapshots: prices });

    const cap = await svc.capture("MR46");
    if (!cap.ok || !cap.snapshot) return { pass: false, detail: "capture: " + JSON.stringify(cap) };
    if (cap.source !== B.NAME || cap.snapshot.unit_cost_cents !== 40500) bad.push("cheapest should win the capture: " + JSON.stringify({ source: cap.source, cents: cap.snapshot.unit_cost_cents }));
    if (!window.QU_PRICESNAPSHOTS.verify(cap.snapshot).ok) bad.push("snapshot not sealed");

    const capA = await svc.capture("MR46", { source: A.NAME });
    if (!capA.ok || capA.source !== A.NAME || capA.snapshot.unit_cost_cents !== 41250) bad.push("a forced source should be honoured: " + JSON.stringify(capA && capA.snapshot && capA.snapshot.unit_cost_cents));
    if (!window.QU_PRICESNAPSHOTS.verify(capA.snapshot).ok) bad.push("forced snapshot not sealed");

    // The distributor_read flag gates the read functions at the gateway.
    const gated = F.wrapGateway(base, { write_flags: { distributor_read: false } });
    const gatedSvc = D.createService({ gateway: gated, names: [A.NAME, B.NAME], priceSnapshots: prices });
    const blocked = await gatedSvc.compare("MR46");
    if (blocked.rows.length !== 0) bad.push("distributor reads should be blocked: " + blocked.rows.length);
    if (!blocked.errors.length || blocked.errors.some(e => e.code !== "feature_disabled")) bad.push("blocked errors: " + JSON.stringify(blocked.errors));

    // Mock data mode refuses a LIVE connector but still lets a mock one work.
    const liveBase = C.createGateway({ connectors: { distributor_a: A.create({ live: true }) } });
    const liveWrapped = F.wrapGateway(liveBase, { data_mode: "mock" });
    const liveRes = await liveWrapped.callAsync(A.NAME, "getPrice", { part: "MR46" }, { scope: "*" });
    if (liveRes.ok || liveRes.code !== "mock_mode_live_blocked" || liveRes.policy !== true) bad.push("a live connector must be blocked in mock mode: " + JSON.stringify(liveRes));

    const mockBase = C.createGateway({ connectors: { distributor_a: A.create() } });
    const mockWrapped = F.wrapGateway(mockBase, { data_mode: "mock" });
    const okRes = await mockWrapped.callAsync(A.NAME, "getPrice", { part: "MR46" }, { scope: "*" });
    if (!okRes.ok || !okRes.result || okRes.result.unit_cost_cents !== 41250) bad.push("a mock connector should pass in mock mode: " + JSON.stringify(okRes));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "capture seals the cheapest source (or a forced one) as an immutable verified snapshot, the distributor_read flag blocks reads at the gateway, and mock mode blocks a live connector while a mock one still answers" };
  });
})();
