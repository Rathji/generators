(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const D = window.QU_DISTRIBUTORS;
  const A = window.QU_DISTRIBUTORA;
  const B = window.QU_DISTRIBUTORB;
  const G = window.QU_CONNECTORS;
  const P = window.QU_PRICING;
  if (!T || !QS || !D || !A || !B || !G || !P) return;

  const ISO = "2026-01-01T00:00:00.000Z";
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

  function record(over, capturedAt) {
    return D.normalizeWire(Object.assign({
      sku: "RX-MR46", mpn: "MR46", upc: "012345678901", desc: "Meraki MR46 cloud-managed access point",
      cat: "wireless", cost: "412.50", list: "599.00", on_hand: 12, whse: "YYZ", cur: "CAD"
    }, over || {}), { source: A.SOURCE, captured_at: capturedAt || ISO });
  }

  function snapshot(over) {
    return Object.assign({
      id: "snap-" + QS.randHex(6), source: A.SOURCE, distributor_sku: "RX-MR46",
      manufacturer_part_number: "MR46", unit_cost_cents: 41250, list_price_cents: 59900,
      quantity_available: 12, warehouse: "YYZ", currency: "CAD", captured_at: ISO
    }, over || {});
  }

  T.register("pricing: a distributor offer becomes a snapshot-priced line at cost + markup in exact cents", () => {
    const bad = [];

    // 41250c cost + 2400bp (24%) = 9900c markup → 51150c sell.
    if (P.sellCents(41250, 2400) !== 51150) bad.push("sellCents(41250, 2400) = " + P.sellCents(41250, 2400));
    if (P.sellCents(10000, 0) !== 10000) bad.push("zero markup should not change the cost");

    const rec = record();
    const snap = snapshot();
    const input = P.buildLineInput(rec, snap, { policy: { default_markup_bp: 2400, default_kind: "one_time" } });
    if (input.unit_cost_cents !== 41250) bad.push("line cost: " + input.unit_cost_cents);
    if (input.unit_sell_cents !== 51150) bad.push("line sell: " + input.unit_sell_cents);
    if (input.kind !== "one_time") bad.push("default kind: " + input.kind);
    if (input.pricing_mode !== "snapshot" || input.price_snapshot_ref !== snap.id) bad.push("snapshot binding: " + input.pricing_mode + "/" + input.price_snapshot_ref);
    if (input.description !== "Meraki MR46 cloud-managed access point") bad.push("description: " + input.description);
    if (input.manufacturer_part_number !== "MR46") bad.push("mpn: " + input.manufacturer_part_number);
    if (input.sku !== "RX-MR46") bad.push("sku: " + input.sku);
    if (input.quantity !== 1) bad.push("default quantity: " + input.quantity);
    if (input.currency !== "CAD") bad.push("currency: " + input.currency);
    if (input.snapshot_source !== A.SOURCE) bad.push("snapshot provenance: " + input.snapshot_source);
    if ("markup_bp" in input || "margin_bp" in input) bad.push("a derived field must not be written onto the line");

    // Overrides: explicit sell price, kind and quantity.
    const custom = P.buildLineInput(rec, snap, { kind: "mrr", quantity: 3, unit_sell_cents: 60000 });
    if (custom.unit_sell_cents !== 60000 || custom.kind !== "mrr" || custom.quantity !== 3) bad.push("overrides: " + JSON.stringify(custom));

    // A record that is not the canonical shape is refused, and a missing
    // snapshot is refused.
    const stray = Object.assign({}, rec, { margin_cents: 100 });
    let threw = null;
    try { P.buildLineInput(stray, snap, {}); } catch (e) { threw = e; }
    if (!threw || threw.code !== "extra_field") bad.push("stray field should be refused: " + (threw && threw.code));
    const miss = Object.assign({}, rec); delete miss.warehouse;
    if (P.tryBuildLineInput(miss, snap, {}).ok) bad.push("an incomplete record should be refused");
    const noSnap = P.tryBuildLineInput(rec, null, {});
    if (noSnap.ok || noSnap.code !== "snapshot_required") bad.push("a missing snapshot should be refused: " + JSON.stringify(noSnap));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "41250c cost + 24% markup → 51150c sell (exact cents), the line is snapshot-priced and carries no derived field, and a non-canonical record or a missing snapshot is refused" };
  });

  T.register("pricing: staleness measures a captured cost against the configured threshold", () => {
    const bad = [];
    const now = Date.parse("2026-01-20T00:00:00.000Z");
    const tenDaysAgo = new Date(now - 10 * DAY).toISOString();

    const s1 = P.staleness({ captured_at: tenDaysAgo }, { stale_cost_days: 7, now: now });
    if (!s1.ok || s1.stale !== true) bad.push("10d old vs 7d threshold should be stale: " + JSON.stringify(s1));
    if (Math.round(s1.age_days) !== 10) bad.push("age_days: " + s1.age_days);
    if (s1.threshold_days !== 7) bad.push("threshold: " + s1.threshold_days);

    const s2 = P.staleness({ captured_at: tenDaysAgo }, { stale_cost_days: 30, now: now });
    if (!s2.ok || s2.stale !== false) bad.push("10d old vs 30d threshold should not be stale: " + JSON.stringify(s2));

    const s3 = P.staleness(tenDaysAgo, { stale_cost_days: 7, now: now });
    if (!s3.ok || s3.stale !== true) bad.push("an ISO string should work: " + JSON.stringify(s3));

    const none = P.staleness({}, { now: now });
    if (none.ok || none.stale !== null) bad.push("no captured_at should be inconclusive: " + JSON.stringify(none));

    const pol = P.normalizePolicy({ default_markup_bp: -5, default_kind: "nonsense", stale_cost_days: "x" });
    if (pol.default_markup_bp !== P.DEFAULT_POLICY.default_markup_bp) bad.push("bad markup should fall back: " + pol.default_markup_bp);
    if (pol.default_kind !== "one_time") bad.push("bad kind should fall back: " + pol.default_kind);
    if (pol.stale_cost_days !== P.DEFAULT_POLICY.stale_cost_days) bad.push("bad stale days should fall back: " + pol.stale_cost_days);
    const pol2 = P.normalizePolicy({ default_markup_bp: 1500, default_kind: "mrr", stale_cost_days: 14 });
    if (pol2.default_markup_bp !== 1500 || pol2.default_kind !== "mrr" || pol2.stale_cost_days !== 14) bad.push("valid policy: " + JSON.stringify(pol2));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "staleness reports age vs threshold (10d is stale past 7d, fresh before 30d), accepts an ISO string, is inconclusive without a capture time, and normalizePolicy falls back on invalid input" };
  });

  T.register("pricing: add-to-quote captures the price, writes the snapshot-priced line, dedupes and refuses frozen versions", async () => {
    const bad = [];
    const store = QS.create({ ns: "pricing" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const gateway = G.createGateway({ connectors: {} });
    gateway.register(A.NAME, A.create());
    gateway.register(B.NAME, B.create());
    const distributors = D.createService({ gateway: gateway, names: [A.NAME, B.NAME], priceSnapshots: prices });
    const pricing = P.createService({ versions: versions, distributors: distributors, policy: { default_markup_bp: 2400, default_kind: "one_time", stale_cost_days: 7 } });

    const created = await versions.createVersion({ quote_id: "q1", quote_number: "Q-00001", title: "Pricing" });
    if (!created.ok) return { pass: false, detail: "createVersion: " + JSON.stringify(created) };
    const vid = created.version.id;

    const rec = record({}, new Date().toISOString());
    const add = await pricing.addToQuote(vid, { record: rec, source: A.SOURCE }, { quantity: 2 });
    if (!add.ok) return { pass: false, detail: "addToQuote: " + JSON.stringify(add) };
    if (add.line.unit_cost_cents !== 41250) bad.push("line cost: " + add.line.unit_cost_cents);
    if (add.line.unit_sell_cents !== 51150) bad.push("line sell: " + add.line.unit_sell_cents);
    if (add.line.quantity !== 2) bad.push("line qty: " + add.line.quantity);
    if (add.line.kind !== "one_time") bad.push("line kind: " + add.line.kind);
    if (add.line.pricing_mode !== "snapshot" || !add.line.price_snapshot_ref) bad.push("line not snapshot-priced: " + JSON.stringify({ m: add.line.pricing_mode, r: add.line.price_snapshot_ref }));
    if (add.line.manufacturer_part_number !== "MR46") bad.push("line mpn: " + add.line.manufacturer_part_number);
    if (add.deduped) bad.push("the first add should not be deduped");
    if (add.stale !== false) bad.push("a fresh capture should not be stale: " + add.stale);

    const g1 = await prices.get(add.line.price_snapshot_ref);
    if (!g1.ok || !g1.snapshot) bad.push("the snapshot was not persisted");
    else {
      if (g1.snapshot.unit_cost_cents !== 41250 || g1.snapshot.source !== A.SOURCE) bad.push("snapshot record: " + JSON.stringify({ c: g1.snapshot.unit_cost_cents, s: g1.snapshot.source }));
      if (!window.QU_PRICESNAPSHOTS.verify(g1.snapshot).ok) bad.push("the snapshot is not sealed");
    }

    // Re-adding the identical capture dedupes to the SAME sealed snapshot.
    const add2 = await pricing.addToQuote(vid, { record: rec, source: A.SOURCE }, { quantity: 1 });
    if (!add2.ok) bad.push("second add: " + JSON.stringify(add2));
    else {
      if (!add2.deduped) bad.push("an identical capture should be deduped");
      if (add2.line.price_snapshot_ref !== add.line.price_snapshot_ref) bad.push("dedupe should reuse the same snapshot id");
    }
    const lines = await versions.listLines(vid);
    if (lines.lines.length !== 2) bad.push("lines after two adds: " + lines.lines.length);
    const snaps = await prices.list({});
    if (snaps.snapshots.length !== 1) bad.push("snapshots should dedupe to one: " + snaps.snapshots.length);

    // A non-canonical record is refused before anything is written.
    const badRec = Object.assign({}, rec, { margin_cents: 1 });
    const refused = await pricing.addToQuote(vid, { record: badRec });
    if (refused.ok || refused.code !== "extra_field") bad.push("bad record refusal: " + JSON.stringify({ ok: refused.ok, code: refused.code }));
    if ((await versions.listLines(vid)).lines.length !== 2) bad.push("a refused add must not write a line");

    // Freezing the version makes it immutable: further adds are refused (I1).
    const frozen = await versions.freeze(vid, { actor: "rep" });
    if (!frozen.ok) bad.push("freeze: " + JSON.stringify(frozen));
    const frozenAdd = await pricing.addToQuote(vid, { record: rec, source: A.SOURCE });
    if (frozenAdd.ok || frozenAdd.code !== "frozen_version_immutable") bad.push("frozen add: " + JSON.stringify({ ok: frozenAdd.ok, code: frozenAdd.code }));
    if ((await versions.listLines(vid)).lines.length !== 2) bad.push("a frozen version must not gain a line");
    if ((await prices.list({})).snapshots.length !== 1) bad.push("a refused add must not mint a snapshot");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "addToQuote captures the price, seals it, and writes a snapshot-priced line (41250c cost → 51150c sell, qty 2); an identical re-add dedupes to the same snapshot; a non-canonical record is refused before any write; and a frozen version refuses new lines (I1)" };
  });
})();
