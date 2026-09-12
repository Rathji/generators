// ============================================================================
// quote-u — distributor connector A: the primary distributor (roadmap task 40)
// ----------------------------------------------------------------------------
// The primary distributor's read-only connector: catalog search, price lookup
// and availability lookup. It is a thin wire/auth adapter over
// QU_DISTRIBUTORS.createDistributor, so it shares the polite request engine
// (start-to-start spacing + concurrency ceiling + bounded retries) and the one
// canonical record shape with the secondary connector (src/distributorb.js).
//
// Auth model (this distributor's own): an API key, sent both as the `X-Api-Key`
// header and as an `api_key` query parameter — the account-level key every read
// request must carry. The key is supplied by the caller (from the fleet secret
// store) and is never persisted or embedded in the app.
//
// Wire format (distributor A):
//   { ok, captured_at, items:[{ sku, mpn, upc, desc, cat, cost, list, on_hand, whse, cur }] }
//   { ok, captured_at, product:{ ...same... } }
//   { ok, captured_at, availability:{ sku, mpn, on_hand, whse, cur } }
//
// The mock transport returns exactly that shape, so the parsers under test are
// the same ones a live endpoint exercises.
// ============================================================================
window.QU_DISTRIBUTORA = (function () {
  "use strict";

  const D = window.QU_DISTRIBUTORS;
  if (!D) throw new Error("quote-u distributor A requires window.QU_DISTRIBUTORS (load src/distributors.js first)");

  const VERSION = "1.0.0";
  const NAME = "distributor_a";
  const SOURCE = "distributor_a";
  const LABEL = "Primary distributor";

  // This distributor is slower to answer than the secondary, so it is paced a
  // little more gently.
  const DEFAULT_POLICY = Object.freeze({
    min_interval_ms: 400,
    max_concurrent: 1,
    max_retries: 3,
    base_backoff_ms: 250,
    max_backoff_ms: 4000,
    timeout_ms: 12000
  });

  const DEFAULT_SEED = Object.freeze({
    items: [
      { sku: "RX-MR46", mpn: "MR46", upc: "012345678901", desc: "Meraki MR46 cloud-managed access point", cat: "wireless", cost: "412.50", list: "599.00", on_hand: 12, whse: "YYZ", cur: "CAD" },
      { sku: "RX-MR56", mpn: "MR56", upc: "012345678902", desc: "Meraki MR56 cloud-managed access point", cat: "wireless", cost: "655.00", list: "899.00", on_hand: 4, whse: "YYZ", cur: "CAD" },
      { sku: "RX-C9300-48P", mpn: "C9300-48P", upc: "012345678903", desc: "Catalyst 9300 48-port PoE+ switch", cat: "switching", cost: "4210.00", list: "5600.00", on_hand: 2, whse: "YVR", cur: "CAD" },
      { sku: "RX-UNIFI6P", mpn: "U6-Pro", upc: "012345678904", desc: "UniFi 6 Pro access point", cat: "wireless", cost: "180.00", list: "249.00", on_hand: 30, whse: "YYC", cur: "CAD" }
    ]
  });

  function normalizePolicy(input) {
    return D.normalizePolicy(Object.assign({}, DEFAULT_POLICY, input || {}));
  }

  function matches(item, query) {
    const terms = String(query == null ? "" : query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = [item.sku, item.mpn, item.upc, item.desc, item.cat].filter(Boolean).join(" ").toLowerCase();
    return terms.every(t => hay.indexOf(t) !== -1);
  }

  function findItem(items, part) {
    const want = String(part == null ? "" : part).trim().toLowerCase();
    if (!want) return null;
    return items.find(it => String(it.sku).toLowerCase() === want || String(it.mpn).toLowerCase() === want || String(it.upc).toLowerCase() === want) || null;
  }

  function capturedAtOf(clock) {
    return typeof clock === "function" ? String(clock()) : new Date().toISOString();
  }

  // The wire -> canonical mapping. The shared schema resolves A's wire keys
  // (`sku`, `mpn`, `desc`, `cost`, `on_hand`, `whse`, `cur`, …) into the one
  // distributor-agnostic record shape; all money math happens in QU_MONEY.
  function fromWireItem(it, raw, opts) {
    opts = opts || {};
    return D.normalizeWire(Object.assign({}, it), Object.assign({}, opts, {
      source: SOURCE,
      captured_at: raw && raw.captured_at,
      raw: it
    }));
  }

  function parseSearch(raw, payload) {
    if (!raw || raw.ok === false) throw new D.DistributorError("connector_error", (raw && raw.error) || "The primary distributor search failed.");
    const items = Array.isArray(raw.items) ? raw.items : [];
    return items.map(it => fromWireItem(it, raw));
  }

  function parsePrice(raw, payload) {
    const it = raw && raw.product ? raw.product : null;
    if (!it) throw new D.DistributorError("bad_response", "The primary distributor returned no product.");
    return fromWireItem(it, raw);
  }

  function parseAvailability(raw, payload) {
    const it = raw && raw.availability ? raw.availability : null;
    if (!it) throw new D.DistributorError("bad_response", "The primary distributor returned no availability.");
    return fromWireItem(it, raw, { require_cost: false });
  }

  // A seeded in-memory endpoint that speaks distributor A's wire format.
  function createMockTransport(seed, opts) {
    opts = opts || {};
    const clock = opts.clock || null;
    const db = JSON.parse(JSON.stringify(seed || DEFAULT_SEED));
    const items = Array.isArray(db.items) ? db.items : [];
    return D.createMockTransport((fn, payload) => {
      const captured_at = capturedAtOf(clock);
      if (fn === "searchCatalog") {
        const limit = Number.isInteger(payload.limit) && payload.limit > 0 ? payload.limit : items.length;
        return { ok: true, captured_at: captured_at, items: items.filter(it => matches(it, payload.query)).slice(0, limit).map(it => Object.assign({}, it)) };
      }
      if (fn === "getPrice") {
        const it = findItem(items, payload.part !== undefined ? payload.part : payload.mpn);
        if (!it) throw new D.DistributorError("not_found", `The primary distributor has no part "${payload.part}".`, { retryable: false });
        return { ok: true, captured_at: captured_at, product: Object.assign({}, it) };
      }
      if (fn === "getAvailability") {
        const it = findItem(items, payload.part !== undefined ? payload.part : payload.mpn);
        if (!it) throw new D.DistributorError("not_found", `The primary distributor has no part "${payload.part}".`, { retryable: false });
        return { ok: true, captured_at: captured_at, availability: { sku: it.sku, mpn: it.mpn, on_hand: it.on_hand, whse: it.whse, cur: it.cur } };
      }
      throw new D.DistributorError("destructive_call", `"${fn}" is not allowed.`);
    }, { live: false });
  }

  // The live transport: GET-only read paths with the API key attached. No
  // credentials are hard-coded — the caller passes the key in.
  function createHttpTransport(opts) {
    opts = opts || {};
    const apiKey = opts.apiKey !== undefined && opts.apiKey !== null ? String(opts.apiKey) : "";
    if (!apiKey) throw new D.DistributorError("no_api_key", "Distributor A's live transport needs its API key (from the secret store).");
    return D.createHttpTransport({
      baseUrl: opts.baseUrl,
      paths: Object.assign({
        searchCatalog: "/v1/catalog/search",
        getPrice: "/v1/catalog/price",
        getAvailability: "/v1/catalog/availability"
      }, opts.paths || {}),
      policy: normalizePolicy(opts.policy),
      fetchImpl: opts.fetchImpl || null,
      auth: () => ({ headers: { "X-Api-Key": apiKey }, query: { api_key: apiKey } })
    });
  }

  function create(opts) {
    opts = opts || {};
    const transport = opts.transport || createMockTransport(opts.seed, { clock: opts.clock });
    return D.createDistributor({
      name: NAME,
      label: opts.label || LABEL,
      source: SOURCE,
      live: opts.live !== undefined ? !!opts.live : !!transport.live,
      transport: transport,
      policy: normalizePolicy(opts.policy),
      parse: { searchCatalog: parseSearch, getPrice: parsePrice, getAvailability: parseAvailability },
      now: opts.now,
      wait: opts.wait,
      throttle: opts.throttle
    });
  }

  return {
    VERSION,
    NAME,
    SOURCE,
    LABEL,
    DEFAULT_POLICY,
    DEFAULT_SEED,
    normalizePolicy,
    fromWireItem,
    parseSearch,
    parsePrice,
    parseAvailability,
    createMockTransport,
    createHttpTransport,
    create
  };
})();
