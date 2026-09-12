// ============================================================================
// quote-u — distributor connector B: the secondary distributor (roadmap task 41)
// ----------------------------------------------------------------------------
// The secondary distributor's read-only connector. It exposes exactly the same
// interface as the primary (QU_DISTRIBUTORS.createDistributor → searchCatalog /
// getPrice / getAvailability + the same canonical record), so the builder and
// the pricing service treat the two interchangeably — only the wire format and
// the authentication model differ.
//
// Auth model (this distributor's own): a bearer token plus a required API
// version header, sent on every request. There is no query-string key, and the
// token is supplied by the caller (from the fleet secret store) — never
// persisted or embedded in the app.
//
// Wire format (distributor B):
//   { status:"success", ts, payload:{ results:[{ part_number, vendor_sku, upc, title, group, net, msrp, qty, location, currency }] } }
//   { status:"success", ts, payload:{ product:{ ... } } }
//   { status:"success", ts, payload:{ stock:{ part_number, qty, location, currency } } }
// ============================================================================
window.QU_DISTRIBUTORB = (function () {
  "use strict";

  const D = window.QU_DISTRIBUTORS;
  if (!D) throw new Error("quote-u distributor B requires window.QU_DISTRIBUTORS (load src/distributors.js first)");

  const VERSION = "1.0.0";
  const NAME = "distributor_b";
  const SOURCE = "distributor_b";
  const LABEL = "Secondary distributor";
  const API_VERSION = "2026-01-01";

  // The secondary distributor answers faster, so the pacing is tighter.
  const DEFAULT_POLICY = Object.freeze({
    min_interval_ms: 150,
    max_concurrent: 3,
    max_retries: 2,
    base_backoff_ms: 120,
    max_backoff_ms: 2000,
    timeout_ms: 8000
  });

  const DEFAULT_SEED = Object.freeze({
    items: [
      { vendor_sku: "HL-MR46", part_number: "MR46", upc: "012345678901", title: "Meraki MR46 cloud-managed access point", group: "wireless", net: 405, msrp: 599, qty: 6, location: "YVR", currency: "CAD" },
      { vendor_sku: "HL-U6PRO", part_number: "U6-Pro", upc: "012345678904", title: "UniFi 6 Pro access point", group: "wireless", net: 172, msrp: 249, qty: 40, location: "SEA", currency: "CAD" },
      { vendor_sku: "HL-9300-48P", part_number: "C9300-48P", upc: "012345678903", title: "Catalyst 9300 48-port PoE+ switch", group: "switching", net: 4088, msrp: 5600, qty: 1, location: "YVR", currency: "CAD" }
    ]
  });

  function normalizePolicy(input) {
    return D.normalizePolicy(Object.assign({}, DEFAULT_POLICY, input || {}));
  }

  function resultItems(raw) {
    const results = raw && raw.payload && Array.isArray(raw.payload.results) ? raw.payload.results : [];
    return results;
  }

  function matches(item, query) {
    const terms = String(query == null ? "" : query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = [item.vendor_sku, item.part_number, item.upc, item.title, item.group].filter(Boolean).join(" ").toLowerCase();
    return terms.every(t => hay.indexOf(t) !== -1);
  }

  function findItem(items, part) {
    const want = String(part == null ? "" : part).trim().toLowerCase();
    if (!want) return null;
    return items.find(it => String(it.vendor_sku).toLowerCase() === want || String(it.part_number).toLowerCase() === want || String(it.upc).toLowerCase() === want) || null;
  }

  function fromWireItem(it, raw, opts) {
    opts = opts || {};
    return D.normalizeWire(Object.assign({}, it), Object.assign({}, opts, {
      source: SOURCE,
      captured_at: raw && raw.ts,
      raw: it
    }));
  }

  function parseSearch(raw, payload) {
    if (!raw || raw.status !== "success") throw new D.DistributorError("connector_error", (raw && raw.message) || "The secondary distributor search failed.");
    return resultItems(raw).map(it => fromWireItem(it, raw));
  }

  function parsePrice(raw, payload) {
    const it = raw && raw.payload && raw.payload.product ? raw.payload.product : null;
    if (!it) throw new D.DistributorError("bad_response", "The secondary distributor returned no product.");
    return fromWireItem(it, raw);
  }

  function parseAvailability(raw, payload) {
    const it = raw && raw.payload && raw.payload.stock ? raw.payload.stock : null;
    if (!it) throw new D.DistributorError("bad_response", "The secondary distributor returned no stock.");
    return D.normalizeWire(Object.assign({}, it), {
      source: SOURCE,
      captured_at: raw && raw.ts,
      raw: it,
      require_cost: false
    });
  }

  function createMockTransport(seed, opts) {
    opts = opts || {};
    const clock = opts.clock || null;
    const db = JSON.parse(JSON.stringify(seed || DEFAULT_SEED));
    const items = Array.isArray(db.items) ? db.items : [];
    const ts = () => (typeof clock === "function" ? String(clock()) : new Date().toISOString());
    return D.createMockTransport((fn, payload) => {
      if (fn === "searchCatalog") {
        const limit = Number.isInteger(payload.limit) && payload.limit > 0 ? payload.limit : items.length;
        return { status: "success", ts: ts(), payload: { results: items.filter(it => matches(it, payload.query)).slice(0, limit).map(it => Object.assign({}, it)) } };
      }
      if (fn === "getPrice") {
        const it = findItem(items, payload.part !== undefined ? payload.part : payload.mpn);
        if (!it) throw new D.DistributorError("not_found", `The secondary distributor has no part "${payload.part}".`, { retryable: false });
        return { status: "success", ts: ts(), payload: { product: Object.assign({}, it) } };
      }
      if (fn === "getAvailability") {
        const it = findItem(items, payload.part !== undefined ? payload.part : payload.mpn);
        if (!it) throw new D.DistributorError("not_found", `The secondary distributor has no part "${payload.part}".`, { retryable: false });
        return { status: "success", ts: ts(), payload: { stock: { vendor_sku: it.vendor_sku, part_number: it.part_number, qty: it.qty, location: it.location, currency: it.currency } } };
      }
      throw new D.DistributorError("destructive_call", `"${fn}" is not allowed.`);
    }, { live: false });
  }

  // The live transport: GET-only read paths authenticated with a bearer token
  // and the required API version header.
  function createHttpTransport(opts) {
    opts = opts || {};
    const token = opts.token !== undefined && opts.token !== null ? String(opts.token) : "";
    if (!token) throw new D.DistributorError("no_token", "Distributor B's live transport needs its bearer token (from the secret store).");
    const apiVersion = opts.apiVersion ? String(opts.apiVersion) : API_VERSION;
    return D.createHttpTransport({
      baseUrl: opts.baseUrl,
      paths: Object.assign({
        searchCatalog: "/api/catalog/search",
        getPrice: "/api/catalog/product",
        getAvailability: "/api/catalog/stock"
      }, opts.paths || {}),
      policy: normalizePolicy(opts.policy),
      fetchImpl: opts.fetchImpl || null,
      auth: () => ({ headers: { Authorization: "Bearer " + token, "X-Api-Version": apiVersion } })
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
    API_VERSION,
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
