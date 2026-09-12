(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const D = window.QU_DISTRIBUTORS;
  const A = window.QU_DISTRIBUTORA;
  if (!T || !QS || !D || !A) return;

  const WIRE_ITEM = { sku: "RX-MR46", mpn: "MR46", upc: "012345678901", desc: "Meraki MR46", cat: "wireless", cost: "412.50", list: "599.00", on_hand: 12, whse: "YYZ", cur: "CAD" };
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
    return QS.create({ ns: "distA" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function mockPriceTransport(over) {
    return Object.assign({ live: false, request: () => Promise.resolve({ ok: true, captured_at: ISO, product: WIRE_ITEM }) }, over || {});
  }

  T.register("distributor A: the mock wire shape normalizes to exactly the canonical record with exact integer cents", async () => {
    const bad = [];
    const conn = A.create();

    const search = await conn.functions.searchCatalog({ query: "MR46" });
    if (!Array.isArray(search) || search.length !== 1) return { pass: false, detail: "search should return one record: " + JSON.stringify(search) };
    const rec = search[0];
    const keys = Object.keys(rec).sort().join(",");
    const want = D.RECORD_FIELDS.slice().sort().join(",");
    if (keys !== want) bad.push("record keys: " + keys);
    if (rec.source !== "distributor_a") bad.push("source: " + rec.source);
    if (rec.distributor_sku !== "RX-MR46" || rec.manufacturer_part_number !== "MR46") bad.push("sku/mpn: " + rec.distributor_sku + "/" + rec.manufacturer_part_number);
    if (rec.unit_cost_cents !== 41250) bad.push("unit_cost_cents: " + rec.unit_cost_cents);
    if (rec.list_price_cents !== 59900) bad.push("list_price_cents: " + rec.list_price_cents);
    if (rec.currency !== "CAD") bad.push("currency: " + rec.currency);
    if (rec.quantity_available !== 12 || rec.warehouse !== "YYZ") bad.push("availability: " + rec.quantity_available + "/" + rec.warehouse);
    if (!rec.raw_response || rec.raw_response.sku !== "RX-MR46") bad.push("raw_response not preserved");
    if (typeof rec.captured_at !== "string" || isNaN(Date.parse(rec.captured_at))) bad.push("captured_at: " + rec.captured_at);

    const price = await conn.functions.getPrice({ part: "MR46" });
    if (price.unit_cost_cents !== 41250 || price.list_price_cents !== 59900) bad.push("price cents: " + price.unit_cost_cents);
    const byMpn = await conn.functions.getPrice({ part: "mr46" });
    if (byMpn.unit_cost_cents !== 41250) bad.push("case-insensitive lookup failed");

    const avail = await conn.functions.getAvailability({ part: "MR46" });
    if (avail.quantity_available !== 12) bad.push("availability qty: " + avail.quantity_available);
    if (avail.unit_cost_cents !== 0) bad.push("an availability-only read must not invent a cost: " + avail.unit_cost_cents);

    const all = await conn.functions.searchCatalog({});
    if (all.length !== 4) bad.push("catalog size: " + all.length);
    if (all[0].unit_cost_cents !== 41250) bad.push("search order/cents: " + all[0].unit_cost_cents);

    const env = await conn.client.price("RX-MR46");
    if (!env.ok || env.result.unit_cost_cents !== 41250) bad.push("client envelope: " + JSON.stringify(env));

    let notFound = null;
    try { await conn.functions.getPrice({ part: "NOPE" }); } catch (e) { notFound = e; }
    if (!notFound || notFound.code !== "not_found" || notFound.retryable !== false) bad.push("unknown part should throw a non-retryable not_found: " + JSON.stringify(notFound && { code: notFound.code, retryable: notFound.retryable }));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "distributor A's wire items become the one canonical record (41250c cost, 59900c list, CAD, raw payload preserved), availability reads carry no cost, and an unknown part is a non-retryable not_found" };
  });

  T.register("distributor A: the request engine paces start-to-start, caps concurrency, retries retryable failures with backoff, and never retries not_found", async () => {
    const bad = [];

    // Deterministic throttle: virtual clock + synchronous wait.
    let vt = 0;
    const waits = [];
    const now = () => vt;
    const wait = ms => { waits.push(ms); return new Promise(r => { vt += ms; r(); }); };

    const th = D.createThrottle({ policy: { min_interval_ms: 400, max_concurrent: 1 }, now, wait });
    const order = [];
    const mk = label => th.run(() => { order.push({ label, at: now() }); return Promise.resolve(label); });
    await Promise.all([mk("a"), mk("b"), mk("c")]);
    if (order.length !== 3) bad.push("throttle ran " + order.length + " jobs");
    for (let i = 1; i < order.length; i++) if (order[i].at - order[i - 1].at < 400) bad.push("spacing " + i + ": " + (order[i].at - order[i - 1].at));

    // Concurrency ceiling.
    let active = 0, peak = 0;
    const pending = [];
    const transport = {
      live: false,
      request: () => { active += 1; peak = Math.max(peak, active); return new Promise(res => { pending.push(() => { active -= 1; res({ ok: true, captured_at: ISO, product: WIRE_ITEM }); }); }); }
    };
    const conc = A.create({ transport, policy: { min_interval_ms: 0, max_concurrent: 2 } });
    const ps = [conc.client.price("a"), conc.client.price("b"), conc.client.price("c"), conc.client.price("d")];
    for (let i = 0; i < 6 && pending.length < 2; i++) await new Promise(r => setTimeout(r, 0));
    if (peak > 2) bad.push("concurrency ceiling exceeded: " + peak);
    while (pending.length) { pending.shift()(); await new Promise(r => setTimeout(r, 0)); }
    await Promise.all(ps);
    if (peak !== 2) bad.push("peak concurrency expected 2, got " + peak);

    // Retryable failures are retried with exponential backoff.
    let fails = 2;
    const backoff = [];
    const flaky = D.createMockTransport(() => {
      if (fails > 0) { fails -= 1; const e = new Error("upstream exploded"); e.code = "server_error"; return Promise.reject(e); }
      return Promise.resolve({ ok: true, captured_at: ISO, product: WIRE_ITEM });
    });
    const flakyConn = D.createDistributor({
      name: "flaky", source: "flaky", transport: flaky,
      parse: { searchCatalog: A.parseSearch, getPrice: A.parsePrice, getAvailability: A.parseAvailability },
      policy: { min_interval_ms: 0, max_retries: 3, base_backoff_ms: 200, max_backoff_ms: 4000 },
      wait: ms => { backoff.push(ms); return Promise.resolve(); }
    });
    const retried = await flakyConn.client.price("MR46");
    if (!retried.ok || retried.attempts !== 3) bad.push("retry attempts: " + JSON.stringify(retried));
    if (backoff.indexOf(200) === -1 || backoff.indexOf(400) === -1) bad.push("backoff waits: " + JSON.stringify(backoff));

    // A non-retryable failure is attempted once.
    let calls = 0;
    const strict = D.createMockTransport(() => { calls += 1; const e = new Error("nope"); e.code = "not_found"; e.retryable = false; return Promise.reject(e); });
    const strictConn = D.createDistributor({ name: "strict", source: "strict", transport: strict, parse: { searchCatalog: A.parseSearch, getPrice: A.parsePrice, getAvailability: A.parseAvailability }, policy: { max_retries: 3 } });
    const hard = await strictConn.client.price("MR46");
    if (hard.ok || hard.attempts !== 1 || calls !== 1) bad.push("not_found should not retry: " + JSON.stringify({ ok: hard.ok, attempts: hard.attempts, calls: calls }));

    // The read-only guarantee is executable.
    let thrown = null;
    try { D.assertReadOnly("createOrder"); } catch (e) { thrown = e; }
    if (!thrown || thrown.code !== "destructive_call") bad.push("assertReadOnly should refuse a write: " + JSON.stringify(thrown && thrown.code));
    if (!D.isReadOnly("getPrice") || D.isReadOnly("createOrder")) bad.push("isReadOnly misclassifies");
    let transportThrew = null;
    try { await D.createMockTransport(() => Promise.resolve({})).request("deleteCatalog", {}); } catch (e) { transportThrew = e; }
    if (!transportThrew || transportThrew.code !== "destructive_call") bad.push("the transport should refuse a non-read: " + JSON.stringify(transportThrew && transportThrew.code));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "start-to-start spacing >= 400ms, concurrency capped at 2, two retryable failures retried with 200/400ms backoff to success, a not_found attempted once, and every write refused with destructive_call" };
  });

  T.register("distributor A: the live transport is GET-only with the API key on header + query, and a captured record seals to an immutable snapshot", async () => {
    const bad = [];
    let seen = null;
    const fakeFetch = (url, init) => {
      seen = { url: url, init: init };
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, captured_at: ISO, product: WIRE_ITEM }) });
    };
    const t = A.createHttpTransport({ baseUrl: "https://api.example.com/", apiKey: "key-abc", fetchImpl: fakeFetch });
    if (t.method !== "GET" || t.live !== true) bad.push("transport flags: " + t.method + "/" + t.live);
    const conn = D.createDistributor({ name: A.NAME, source: A.SOURCE, transport: t, parse: { searchCatalog: A.parseSearch, getPrice: A.parsePrice, getAvailability: A.parseAvailability }, policy: { min_interval_ms: 0 } });
    const rec = await conn.functions.getPrice({ part: "MR46", method: "POST", url: "http://evil.example" });
    if (!seen) return { pass: false, detail: "the fetch was never called" };
    if (seen.init.method !== "GET") bad.push("method leaked: " + seen.init.method);
    if (seen.init.headers["X-Api-Key"] !== "key-abc") bad.push("api key header missing: " + JSON.stringify(seen.init.headers));
    if (seen.url.indexOf("api_key=key-abc") === -1) bad.push("api key query missing: " + seen.url);
    if (seen.url.indexOf("/v1/catalog/price") === -1) bad.push("price path: " + seen.url);
    if (seen.url.indexOf("method=") !== -1 || seen.url.indexOf("url=") !== -1) bad.push("a non-whitelisted param reached the wire: " + seen.url);
    if (rec.unit_cost_cents !== 41250) bad.push("live parse cents: " + rec.unit_cost_cents);

    let noKey = null;
    try { A.createHttpTransport({ baseUrl: "https://api.example.com", fetchImpl: fakeFetch }); } catch (e) { noKey = e; }
    if (!noKey || noKey.code !== "no_api_key") bad.push("missing api key should be refused: " + JSON.stringify(noKey && noKey.code));

    // Snapshot mapping: the canonical record seals into an immutable snapshot.
    const store = makeStore();
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const snap = await prices.capture(D.toSnapshotInput(rec, {}));
    if (!snap.ok || !snap.snapshot) return { pass: false, detail: "snapshot capture failed: " + JSON.stringify(snap) };
    if (snap.snapshot.unit_cost_cents !== 41250 || snap.snapshot.source !== A.SOURCE) bad.push("snapshot record: " + JSON.stringify({ c: snap.snapshot.unit_cost_cents, s: snap.snapshot.source }));
    const v = window.QU_PRICESNAPSHOTS.verify(snap.snapshot);
    if (!v.ok) bad.push("snapshot not sealed: " + JSON.stringify(v));
    const upd = await prices.update(snap.snapshot.id, { unit_cost_cents: 1 });
    if (upd.ok || upd.code !== "immutable") bad.push("a snapshot should be immutable: " + JSON.stringify(upd));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the live transport issues GET with the X-Api-Key header and api_key query (a payload cannot force POST or leak extra params), a missing key is refused, and the record seals into an immutable verified snapshot" };
  });
})();
