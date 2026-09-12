// ============================================================================
// quote-u — distributor read interface & polite request engine (roadmap task 40)
// ----------------------------------------------------------------------------
// A distributor connector is a READ-ONLY adapter: it can search a catalog and
// look up a part's price and availability. It can do nothing else. That is not
// a convention — `assertReadOnly` refuses any function that is not on the
// allowlist, the HTTP transport hard-codes GET, and only a whitelist of read
// parameters ever reaches the wire, so no code path can turn a price lookup
// into a destructive call against a live production endpoint.
//
// This module is the SHARED half of the distributor layer (task 40/41): the
// request engine (polite throttling + bounded retries with backoff), the
// canonical record shape every adapter normalises into (task 42 formalises it
// across sources), the snapshot mapping that lets the builder capture a price
// as an immutable `price_snapshot` (QU_PRICESNAPSHOTS), and the service the
// rest of the app uses. The two concrete connectors (`src/distributora.js`,
// `src/distributorb.js`) are thin wire/auth adapters over `createDistributor`,
// so the builder treats them interchangeably.
//
// Everything is async (network reads); the connector's `functions` are the
// gateway-facing allowlist (thrown errors become `{ok:false, code}`), while
// `client` returns the `{ok, result}` envelope directly.
//
// Money is integer cents (QU_MONEY); a decimal wire price is parsed exactly.
// ============================================================================
window.QU_DISTRIBUTORS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u distributors require window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const INTERFACE_VERSION = "1.0.0";

  // The whole surface a distributor connector may ever expose. Anything else is
  // a programming error and is refused before it can reach a transport.
  const READ_FUNCTIONS = Object.freeze(["searchCatalog", "getPrice", "getAvailability"]);

  // The canonical, distributor-agnostic record shape (task 42). Adapters may
  // NOT invent extra fields; normaliseRecord copies only these.
  const RECORD_FIELDS = Object.freeze([
    "source", "distributor_sku", "manufacturer_part_number", "upc", "description", "category",
    "currency", "unit_cost_cents", "list_price_cents", "quantity_available", "warehouse",
    "captured_at", "raw_response"
  ]);

  // The declarative schema behind the canonical record (task 42). Every field
  // declares its type and the wire aliases any adapter's payload may use, so
  // ONE function (`normalizeWire`) turns ANY distributor's response into the
  // shared shape. A "money" field accepts a major-unit alias (`cost`, `net`,
  // `list`, … parsed exactly by QU_MONEY) or an explicit integer-cents alias
  // (`unit_cost_cents`, … used as-is); camelCase, snake_case and the raw wire
  // spellings all resolve to the same canonical key.
  const SCHEMA = Object.freeze([
    { field: "source", type: "string", required: true, label: "Source",
      aliases: ["source", "distributor", "vendor"] },
    { field: "distributor_sku", type: "string", required: false, label: "Distributor SKU",
      aliases: ["distributor_sku", "vendor_sku", "supplier_sku", "sku"] },
    { field: "manufacturer_part_number", type: "string", required: false, label: "Manufacturer part number",
      aliases: ["manufacturer_part_number", "mfr_part_number", "mpn", "part_number", "mfr_sku"] },
    { field: "upc", type: "string", required: false, label: "UPC",
      aliases: ["upc", "gtin", "ean"] },
    { field: "description", type: "string", required: false, label: "Description",
      aliases: ["description", "desc", "title"] },
    { field: "category", type: "string", required: false, label: "Category",
      aliases: ["category", "cat", "group"] },
    { field: "currency", type: "string", required: false, label: "Currency",
      aliases: ["currency", "cur"] },
    { field: "unit_cost_cents", type: "money", required: true, label: "Unit cost",
      aliases: ["unit_cost", "cost", "net", "net_cost", "dealer_cost"],
      cents_aliases: ["unit_cost_cents", "cost_cents", "net_cents"] },
    { field: "list_price_cents", type: "money", required: false, label: "List price",
      aliases: ["list_price", "list", "msrp", "retail"],
      cents_aliases: ["list_price_cents", "list_cents", "msrp_cents"] },
    { field: "quantity_available", type: "count", required: false, label: "Quantity available",
      aliases: ["quantity_available", "on_hand", "qty"] },
    { field: "warehouse", type: "string", required: false, label: "Warehouse",
      aliases: ["warehouse", "whse", "location"] },
    { field: "captured_at", type: "string", required: false, label: "Captured at",
      aliases: ["captured_at", "as_of"] },
    { field: "raw_response", type: "raw", required: false, label: "Raw response",
      aliases: ["raw_response", "raw"] }
  ]);

  // Case- and separator-insensitive key: "ManufacturerPartNumber",
  // "manufacturer_part_number" and "mpn" collapse to their canonical matches.
  function canonicalKey(name) {
    return String(name === undefined || name === null ? "" : name).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  const FIELD_ALIASES = (function () {
    const map = {};
    SCHEMA.forEach(spec => {
      const list = (spec.aliases || []).concat(spec.cents_aliases || []).concat([spec.field]);
      map[spec.field] = Object.freeze(Array.from(new Set(list)));
    });
    return Object.freeze(map);
  })();

  // alias-key -> { field, isCents, spec }. Built once, so normalisation is a
  // single map lookup per wire field and a duplicate alias is a schema error.
  const ALIAS_INDEX = (function () {
    const idx = new Map();
    function claim(alias, entry) {
      const key = canonicalKey(alias);
      if (!key) return;
      const prev = idx.get(key);
      if (prev) {
        // The same field re-claiming an alias (e.g. its canonical name also
        // appears in its alias list) is a no-op; an explicit-cents alias
        // upgrades a major-unit claim.
        if (prev.field === entry.field) {
          if (entry.isCents && !prev.isCents) idx.set(key, entry);
          return;
        }
        // A genuine cross-field collision is a schema bug. Use a plain Error
        // (not DistributorError, which is declared later and would be in TDZ
        // during this one-time schema build).
        const err = new Error(`Distributor schema alias "${alias}" is claimed by both "${prev.field}" and "${entry.field}".`);
        err.code = "bad_schema";
        throw err;
      }
      idx.set(key, entry);
    }
    SCHEMA.forEach(spec => {
      (spec.aliases || []).concat([spec.field]).forEach(a => claim(a, { field: spec.field, isCents: false, spec: spec }));
      if (spec.type === "money") (spec.cents_aliases || []).forEach(a => claim(a, { field: spec.field, isCents: true, spec: spec }));
    });
    return idx;
  })();

  // A live distributor is throttled politely: requests are spaced at least
  // `min_interval_ms` apart (start-to-start), at most `max_concurrent` are in
  // flight, and a retryable failure is retried with exponential backoff.
  const DEFAULT_POLICY = Object.freeze({
    min_interval_ms: 250,
    max_concurrent: 2,
    max_retries: 3,
    base_backoff_ms: 200,
    max_backoff_ms: 4000,
    timeout_ms: 10000
  });

  // Only these keys are ever put on a read request's query string.
  const QUERY_PARAMS = Object.freeze(["query", "part", "sku", "mpn", "upc", "quantity", "limit"]);

  const RETRYABLE_CODES = Object.freeze(["timeout", "rate_limited", "server_error", "transport_error", "bad_response"]);

  class DistributorError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "DistributorError";
      this.code = code;
      if (meta) {
        if (meta.retryable !== undefined) this.retryable = meta.retryable;
        if (meta.retry_after_ms !== undefined) this.retry_after_ms = meta.retry_after_ms;
        if (meta.source !== undefined) this.source = meta.source;
        if (meta.attempts !== undefined) this.attempts = meta.attempts;
      }
    }
  }

  function fail(code, message, meta) { throw new DistributorError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function intOr(value, def) {
    return Number.isInteger(value) && value >= 0 ? value : def;
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    const minInterval = intOr(p.min_interval_ms, DEFAULT_POLICY.min_interval_ms);
    const maxConcurrent = Number.isInteger(p.max_concurrent) && p.max_concurrent >= 1 ? p.max_concurrent : DEFAULT_POLICY.max_concurrent;
    const maxRetries = intOr(p.max_retries, DEFAULT_POLICY.max_retries);
    const baseBackoff = intOr(p.base_backoff_ms, DEFAULT_POLICY.base_backoff_ms);
    const maxBackoff = intOr(p.max_backoff_ms, DEFAULT_POLICY.max_backoff_ms);
    const timeout = intOr(p.timeout_ms, DEFAULT_POLICY.timeout_ms);
    return {
      min_interval_ms: minInterval,
      max_concurrent: maxConcurrent,
      max_retries: maxRetries,
      base_backoff_ms: baseBackoff,
      max_backoff_ms: Math.max(baseBackoff, maxBackoff),
      timeout_ms: timeout
    };
  }

  // ---- the read-only guarantee ----------------------------------------------

  function isReadOnly(fnName) {
    return READ_FUNCTIONS.indexOf(String(fnName)) !== -1;
  }

  // Refuse anything that is not a read. This is the executable form of "no
  // destructive calls against a live production endpoint".
  function assertReadOnly(fnName) {
    const fn = String(fnName);
    if (!isReadOnly(fn)) {
      fail("destructive_call", `"${fn}" is not a read-only distributor function. A distributor connector may only perform: ${READ_FUNCTIONS.join(", ")}.`);
    }
    return fn;
  }

  // ---- normalisation --------------------------------------------------------

  function centsFrom(value, label) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("bad_money", `${label} is not a finite amount.`);
      return M.parse(String(value));
    }
    if (typeof value === "string") {
      try { return M.parse(value); }
      catch (e) { fail("bad_money", `${label} is not a valid amount: "${value}".`); }
    }
    fail("bad_money", `${label} must be a decimal string or number.`);
  }

  function centsOf(value, label) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      fail("bad_money", `${label} must be integer cents.`);
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      fail("bad_money", `${label} must be integer cents.`);
    }
    return value;
  }

  function countOf(value, label) {
    if (value === undefined || value === null || value === "") return 0;
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) fail("bad_count", `${label} must be a non-negative integer.`);
      return value;
    }
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) fail("bad_count", `${label} must be a non-negative integer.`);
    return Number(text);
  }

  function stringOf(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function nullableString(value) {
    const s = stringOf(value).trim();
    return s ? s : null;
  }

  function normalizeCurrency(value) {
    if (value === undefined || value === null || value === "") return M.DEFAULT_CURRENCY;
    try { return M.normalizeCurrency(value); }
    catch (e) { fail("bad_currency", (e && e.message) || String(e)); }
  }

  // Normalise ANY adapter's raw wire shape into the one canonical record. The
  // adapter supplies major-unit money (`unit_cost`/`list_price`) OR already-exact
  // integer cents (`unit_cost_cents`); a cost may be optional (availability
  // reads carry no price) when `require_cost:false`.
  function normalizeRecord(input, opts) {
    opts = opts || {};
    input = input || {};
    const source = stringOf(input.source || opts.source).trim();
    if (!source) fail("bad_record", "A distributor record needs a source.");

    const costCents = input.unit_cost_cents !== undefined
      ? centsOf(input.unit_cost_cents, "unit_cost_cents")
      : centsFrom(input.unit_cost !== undefined ? input.unit_cost : input.cost, "unit_cost");
    if (costCents === null && opts.require_cost !== false) {
      fail("bad_money", `A ${source} record needs a unit cost.`);
    }
    const listCents = input.list_price_cents !== undefined
      ? centsOf(input.list_price_cents, "list_price_cents")
      : centsFrom(input.list_price !== undefined ? input.list_price : input.list, "list_price");

    return {
      source: source,
      distributor_sku: stringOf(input.distributor_sku),
      manufacturer_part_number: stringOf(input.manufacturer_part_number),
      upc: stringOf(input.upc),
      description: stringOf(input.description),
      category: stringOf(input.category),
      currency: normalizeCurrency(input.currency),
      unit_cost_cents: costCents === null ? 0 : costCents,
      list_price_cents: listCents === null ? 0 : listCents,
      quantity_available: countOf(input.quantity_available, "quantity_available"),
      warehouse: stringOf(input.warehouse),
      captured_at: nullableString(input.captured_at) || nowIso(opts.clock),
      raw_response: input.raw_response === undefined ? null : input.raw_response
    };
  }

  function tryNormalizeRecord(input, opts) {
    try { return { ok: true, record: normalizeRecord(input, opts) }; }
    catch (e) { return { ok: false, code: e.code || "bad_record", detail: e.message }; }
  }

  // Turn ANY adapter's raw wire object into the one canonical record, resolving
  // each wire key through the shared schema's alias index (task 42). Unknown
  // keys are dropped (never copied onto the record); a money value given in
  // cents is used as-is, one given in major units is parsed exactly. This is
  // what makes the pricing UI and the snapshots distributor-agnostic: two
  // connectors with completely different wire formats land on the same shape.
  function normalizeWire(input, opts) {
    opts = opts || {};
    input = isPlainObject(input) ? input : {};
    const chosen = {};
    const unknown = [];
    Object.keys(input).forEach(k => {
      const hit = ALIAS_INDEX.get(canonicalKey(k));
      if (!hit) { unknown.push(k); return; }
      const prev = chosen[hit.field];
      if (!prev || (hit.isCents && !prev.hit.isCents)) chosen[hit.field] = { key: k, hit: hit };
    });
    const resolved = {};
    SCHEMA.forEach(spec => {
      const c = chosen[spec.field];
      if (!c) return;
      const value = input[c.key];
      if (spec.type === "money") resolved[spec.field] = c.hit.isCents ? centsOf(value, spec.field) : centsFrom(value, spec.field);
      else if (spec.type === "count") resolved[spec.field] = countOf(value, spec.field);
      else resolved[spec.field] = value;
    });
    if (opts.source !== undefined && opts.source !== null && opts.source !== "") resolved.source = opts.source;
    if (opts.captured_at !== undefined && opts.captured_at !== null && opts.captured_at !== "") resolved.captured_at = opts.captured_at;
    if (opts.raw !== undefined) resolved.raw_response = opts.raw;
    if (unknown.length && opts.strict === true) {
      fail("unknown_fields", `The wire payload carried fields no schema entry claims: ${unknown.join(", ")}.`);
    }
    return normalizeRecord(resolved, opts);
  }

  function tryNormalizeWire(input, opts) {
    try { return { ok: true, record: normalizeWire(input, opts) }; }
    catch (e) { return { ok: false, code: e.code || "bad_record", detail: e.message }; }
  }

  // Look a canonical (or alias) field name up in the schema.
  function resolveField(name) {
    const hit = ALIAS_INDEX.get(canonicalKey(name));
    if (hit) return hit.spec;
    const key = canonicalKey(name);
    return SCHEMA.find(s => canonicalKey(s.field) === key) || null;
  }

  function aliasFor(field) {
    return FIELD_ALIASES[String(field)] ? FIELD_ALIASES[String(field)].slice() : null;
  }

  // Prove a record is EXACTLY the canonical shape: every field present, no
  // strays, integer cents, non-negative counts. The pricing UI calls
  // `toDisplay` (which calls this), so a source that leaks a field is caught.
  function validateRecord(record) {
    const violations = [];
    if (!isPlainObject(record)) {
      return { ok: false, violations: [{ field: null, code: "bad_record", detail: "A canonical distributor record must be an object." }] };
    }
    RECORD_FIELDS.forEach(f => {
      if (!Object.prototype.hasOwnProperty.call(record, f)) violations.push({ field: f, code: "missing_field", detail: `the canonical record is missing "${f}"` });
    });
    Object.keys(record).forEach(k => {
      if (RECORD_FIELDS.indexOf(k) === -1) violations.push({ field: k, code: "extra_field", detail: `"${k}" is not a canonical distributor field` });
    });
    ["source", "distributor_sku", "manufacturer_part_number", "upc", "description", "category", "warehouse"].forEach(f => {
      if (f in record && typeof record[f] !== "string") violations.push({ field: f, code: "bad_field", detail: `${f} must be a string.` });
    });
    if ("source" in record && !String(record.source).trim()) violations.push({ field: "source", code: "bad_source", detail: "source is required." });
    ["unit_cost_cents", "list_price_cents"].forEach(f => {
      if (f in record && (!Number.isSafeInteger(record[f]) || record[f] < 0)) violations.push({ field: f, code: "bad_money", detail: `${f} must be non-negative integer cents.` });
    });
    if ("quantity_available" in record && (!Number.isInteger(record.quantity_available) || record.quantity_available < 0)) {
      violations.push({ field: "quantity_available", code: "bad_count", detail: "quantity_available must be a non-negative integer." });
    }
    if ("currency" in record && (typeof record.currency !== "string" || !record.currency)) {
      violations.push({ field: "currency", code: "bad_currency", detail: "currency must be a non-empty string." });
    }
    return { ok: violations.length === 0, violations: violations };
  }

  function assertRecord(record) {
    const v = validateRecord(record);
    if (!v.ok) fail(v.violations[0].code, v.violations[0].detail, { violations: v.violations });
    return record;
  }

  // The distributor-agnostic view the pricing UI and snapshot layer consume:
  // the roadmap's camelCase field names over the canonical record. Money stays
  // integer cents (`unitCost`/`listPrice`); a display layer formats it.
  function toDisplay(record) {
    assertRecord(record);
    return {
      source: record.source,
      distributorSku: record.distributor_sku,
      mfrPartNumber: record.manufacturer_part_number,
      upc: record.upc,
      description: record.description,
      category: record.category,
      currency: record.currency,
      unitCost: record.unit_cost_cents,
      listPrice: record.list_price_cents,
      quantityAvailable: record.quantity_available,
      warehouse: record.warehouse,
      capturedAt: record.captured_at
    };
  }

  // The immutable price-snapshot input for a canonical record — what the
  // builder hands to QU_PRICESNAPSHOTS so a captured price is sealed forever.
  function toSnapshotInput(record, opts) {
    opts = opts || {};
    if (!record) fail("bad_record", "No distributor record to snapshot.");
    assertHasCents(record.unit_cost_cents, "unit_cost_cents");
    return {
      source: stringOf(opts.source || record.source),
      distributor_sku: stringOf(record.distributor_sku),
      manufacturer_part_number: stringOf(record.manufacturer_part_number),
      unit_cost_cents: record.unit_cost_cents,
      list_price_cents: record.list_price_cents === undefined || record.list_price_cents === null ? 0 : record.list_price_cents,
      quantity_available: record.quantity_available === undefined ? 0 : record.quantity_available,
      warehouse: stringOf(record.warehouse),
      currency: normalizeCurrency(record.currency),
      captured_at: nullableString(opts.captured_at) || record.captured_at || nowIso(opts.clock),
      raw_response: record.raw_response === undefined ? null : record.raw_response
    };
  }

  function assertHasCents(value, label) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("bad_money", `${label} must be integer cents.`);
    return value;
  }

  // The cheapest record (ties broken by source name), for "best source".
  function bestRecord(records) {
    const list = (Array.isArray(records) ? records : []).filter(r => r && typeof r.unit_cost_cents === "number");
    if (!list.length) return null;
    return list.slice().sort((a, b) => a.unit_cost_cents - b.unit_cost_cents || String(a.source).localeCompare(String(b.source)))[0];
  }

  // ---- side-by-side part grouping (task 43) ---------------------------------

  // The identity a part is grouped across distributors by: a shared UPC is the
  // strongest key, then the manufacturer part number, then the source SKU.
  // Keys are case/separator-insensitive so "MR-46" and "mr46" group together.
  function partKey(record) {
    if (!record) return "";
    const upc = canonicalKey(record.upc);
    if (upc) return "upc:" + upc;
    const mpn = canonicalKey(record.manufacturer_part_number);
    if (mpn) return "mpn:" + mpn;
    const sku = canonicalKey(record.distributor_sku);
    if (sku) return "sku:" + sku;
    return "desc:" + canonicalKey(record.description);
  }

  function offerOf(record) {
    return {
      source: record.source,
      unit_cost_cents: record.unit_cost_cents,
      list_price_cents: record.list_price_cents,
      quantity_available: record.quantity_available,
      warehouse: record.warehouse,
      currency: record.currency,
      captured_at: record.captured_at,
      in_stock: record.quantity_available > 0,
      record: record
    };
  }

  function costOf(offer) {
    return offer.unit_cost_cents === null || offer.unit_cost_cents === undefined ? Infinity : offer.unit_cost_cents;
  }

  // Cheapest first; an in-stock source beats an out-of-stock one at equal cost.
  function compareOffers(a, b) {
    const ac = costOf(a);
    const bc = costOf(b);
    if (ac !== bc) return ac - bc;
    if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
    return String(a.source).localeCompare(String(b.source));
  }

  // Merge every source's records into parts, each with its side-by-side offers
  // (price + quantity + warehouse), cheapest first. This is the shape the
  // pricing UI renders and the rep chooses from before adding a line.
  function groupParts(records) {
    const byKey = new Map();
    (Array.isArray(records) ? records : []).forEach(r => {
      if (!r) return;
      const key = partKey(r);
      let part = byKey.get(key);
      if (!part) {
        part = {
          key: key,
          description: r.description,
          manufacturer_part_number: r.manufacturer_part_number,
          upc: r.upc,
          distributor_sku: r.distributor_sku,
          category: r.category,
          currency: r.currency,
          offers: []
        };
        byKey.set(key, part);
      } else {
        if (!part.description && r.description) part.description = r.description;
        if (!part.manufacturer_part_number && r.manufacturer_part_number) part.manufacturer_part_number = r.manufacturer_part_number;
        if (!part.upc && r.upc) part.upc = r.upc;
      }
      part.offers.push(offerOf(r));
    });
    const parts = Array.from(byKey.values());
    parts.forEach(part => {
      part.offers.sort(compareOffers);
      part.offers.forEach((o, i) => { o.cheapest = i === 0; });
      part.best = part.offers[0] ? part.offers[0].record : null;
      part.sources = part.offers.map(o => o.source);
      part.best_unit_cost_cents = part.offers[0] ? part.offers[0].unit_cost_cents : null;
      part.total_available = part.offers.reduce((n, o) => n + (Number.isInteger(o.quantity_available) ? o.quantity_available : 0), 0);
    });
    parts.sort((a, b) => {
      const ac = a.best_unit_cost_cents === null || a.best_unit_cost_cents === undefined ? Infinity : a.best_unit_cost_cents;
      const bc = b.best_unit_cost_cents === null || b.best_unit_cost_cents === undefined ? Infinity : b.best_unit_cost_cents;
      if (ac !== bc) return ac - bc;
      return String(a.description || a.manufacturer_part_number || a.key).localeCompare(String(b.description || b.manufacturer_part_number || b.key));
    });
    return parts;
  }

  // ---- polite throttling + retries ------------------------------------------

  // A start-to-start rate gate with a concurrency ceiling. `now`/`wait` are
  // injectable so the pacing is deterministic under test.
  function createThrottle(opts) {
    opts = opts || {};
    const policy = normalizePolicy(opts.policy || opts);
    const minInterval = policy.min_interval_ms;
    const maxConcurrent = policy.max_concurrent;
    const now = typeof opts.now === "function" ? opts.now : () => Date.now();
    const wait = typeof opts.wait === "function" ? opts.wait : ms => new Promise(r => setTimeout(r, ms));
    let lastStart = null;
    let active = 0;
    let started = 0;
    let pumping = false;
    let scheduled = false;
    const pending = [];
    const waits = [];

    function nextDelay() {
      if (lastStart === null) return 0;
      return Math.max(0, (lastStart + minInterval) - now());
    }

    function kick() {
      if (scheduled || pumping) return;
      scheduled = true;
      Promise.resolve().then(() => { scheduled = false; pump(); });
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (pending.length && active < maxConcurrent) {
          const delay = nextDelay();
          if (delay > 0) { waits.push(delay); await wait(delay); }
          if (!pending.length) break;
          const job = pending.shift();
          lastStart = now();
          started += 1;
          active += 1;
          Promise.resolve().then(job.task).then(
            value => { active -= 1; job.resolve(value); kick(); },
            err => { active -= 1; job.reject(err); kick(); }
          );
        }
      } finally {
        pumping = false;
      }
    }

    function run(task) {
      return new Promise((resolve, reject) => {
        pending.push({ task: task, resolve: resolve, reject: reject });
        kick();
      });
    }

    return {
      policy: { min_interval_ms: minInterval, max_concurrent: maxConcurrent },
      run: run,
      stats: () => ({ active: active, pending: pending.length, started: started }),
      waits: () => waits.slice()
    };
  }

  function retryableOf(err) {
    if (!err) return false;
    if (err.retryable === false) return false;
    if (err.retryable === true) return true;
    return RETRYABLE_CODES.indexOf(String(err.code)) !== -1;
  }

  // Throttle + bounded retry around a transport's `request(fn, payload)`. The
  // transport throws a DistributorError (with a `code`); a retryable failure is
  // retried after exponential backoff (honouring a Retry-After hint).
  function createReadEngine(opts) {
    opts = opts || {};
    const policy = normalizePolicy(opts.policy || opts);
    const transport = opts.transport;
    if (!transport || typeof transport.request !== "function") {
      fail("bad_transport", "A read engine needs a transport with a request function.");
    }
    const throttle = opts.throttle || createThrottle(opts);
    const wait = typeof opts.wait === "function" ? opts.wait : ms => new Promise(r => setTimeout(r, ms));
    const calls = [];

    async function run(fnName, payload) {
      assertReadOnly(fnName);
      let last = null;
      let attempts = 0;
      for (let i = 0; i <= policy.max_retries; i++) {
        attempts = i + 1;
        try {
          const result = await throttle.run(() => transport.request(fnName, payload || {}));
          calls.push({ fn: fnName, attempts: attempts, ok: true });
          return { ok: true, result: result, attempts: attempts, fn: fnName };
        } catch (e) {
          last = e;
          calls.push({ fn: fnName, attempts: attempts, ok: false, code: (e && e.code) || "transport_error" });
          if (!retryableOf(e) || i === policy.max_retries) break;
          const backoff = Math.min(policy.max_backoff_ms, policy.base_backoff_ms * Math.pow(2, i));
          const retryAfter = e && Number.isFinite(e.retry_after_ms) ? e.retry_after_ms : 0;
          await wait(Math.max(backoff, retryAfter));
        }
      }
      return {
        ok: false,
        fn: fnName,
        attempts: attempts,
        code: (last && last.code) || "transport_error",
        detail: (last && last.message) || String(last),
        retryable: retryableOf(last)
      };
    }

    return {
      policy: policy,
      run: run,
      throttle: throttle,
      stats: () => ({ calls: calls.slice(), throttle: throttle.stats() })
    };
  }

  // ---- the generic adapter --------------------------------------------------

  // Build a connector from a transport + per-function parsers. The result is
  // the one interface both distributors share (`functions` for the gateway,
  // `client` for direct callers).
  function createDistributor(spec) {
    spec = spec || {};
    const name = stringOf(spec.name).trim();
    if (!name) fail("bad_distributor", "A distributor connector needs a name.");
    const policy = normalizePolicy(spec.policy);
    const transport = spec.transport;
    if (!transport || typeof transport.request !== "function") {
      fail("bad_distributor", `Distributor "${name}" needs a transport with a request function.`);
    }
    const parse = spec.parse || {};
    READ_FUNCTIONS.forEach(fn => {
      if (typeof parse[fn] !== "function") fail("bad_distributor", `Distributor "${name}" needs a parse.${fn} function.`);
    });
    const engine = createReadEngine({
      transport: transport,
      policy: policy,
      throttle: spec.throttle,
      wait: spec.wait,
      now: spec.now
    });

    const source = spec.source || name;

    async function fetchRecord(fnName, payload) {
      const r = await engine.run(fnName, payload || {});
      if (!r.ok) throw new DistributorError(r.code, r.detail, { attempts: r.attempts, source: name, retryable: r.retryable });
      return parse[fnName](r.result, payload || {}, { source: source });
    }

    const functions = {};
    READ_FUNCTIONS.forEach(fn => {
      functions[fn] = payload => fetchRecord(fn, payload);
    });

    // The non-throwing facade: same request engine, but the raw wire result is
    // normalized through the adapter's parser before it comes back, so a direct
    // caller and the gateway see the SAME canonical record.
    async function runParsed(fnName, payload) {
      const r = await engine.run(fnName, payload || {});
      if (!r.ok) return r;
      try {
        return Object.assign({}, r, { result: parse[fnName](r.result, payload || {}, { source: source }) });
      } catch (e) {
        return { ok: false, fn: fnName, attempts: r.attempts, code: (e && e.code) || "bad_response", detail: (e && e.message) || String(e), retryable: false };
      }
    }

    const client = {
      source: source,
      search: (query, opts) => runParsed("searchCatalog", Object.assign({}, opts || {}, { query: query })),
      price: (part, opts) => runParsed("getPrice", Object.assign({}, opts || {}, { part: part })),
      availability: (part, opts) => runParsed("getAvailability", Object.assign({}, opts || {}, { part: part }))
    };

    return {
      name: name,
      label: spec.label || name,
      source: source,
      live: !!spec.live,
      readOnly: true,
      policy: policy,
      interface: { version: INTERFACE_VERSION, functions: READ_FUNCTIONS.slice(), record_fields: RECORD_FIELDS.slice() },
      functions: functions,
      client: client,
      stats: () => engine.stats()
    };
  }

  // ---- transports -----------------------------------------------------------

  function createMockTransport(handler, opts) {
    opts = opts || {};
    if (typeof handler !== "function") fail("bad_transport", "A mock transport needs a handler.");
    return {
      live: opts.live === true,
      readOnly: true,
      request: (fnName, payload) => {
        assertReadOnly(fnName);
        return Promise.resolve().then(() => handler(fnName, payload || {}));
      }
    };
  }

  function withTimeout(promise, ms) {
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    let timer = null;
    return Promise.race([
      promise.then(value => { if (timer) clearTimeout(timer); return value; },
        err => { if (timer) clearTimeout(timer); throw err; }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new DistributorError("timeout", `The distributor did not answer within ${ms}ms.`, { retryable: true })), ms);
      })
    ]);
  }

  function buildReadUrl(baseUrl, path, payload, authQuery) {
    const usp = new URLSearchParams();
    QUERY_PARAMS.forEach(k => {
      if (payload && payload[k] !== undefined && payload[k] !== null && payload[k] !== "") usp.set(k, String(payload[k]));
    });
    if (isPlainObject(authQuery)) {
      Object.keys(authQuery).forEach(k => {
        if (authQuery[k] !== undefined && authQuery[k] !== null) usp.set(k, String(authQuery[k]));
      });
    }
    const qs = usp.toString();
    return baseUrl + path + (qs ? "?" + qs : "");
  }

  // A live HTTP transport: GET only, auth applied by the adapter's `auth`
  // callback, and only whitelisted read params ever reach the query string.
  function createHttpTransport(opts) {
    opts = opts || {};
    const policy = normalizePolicy(opts.policy);
    const baseUrl = stringOf(opts.baseUrl).replace(/\/+$/, "");
    if (!baseUrl) fail("bad_transport", "An http transport needs a baseUrl.");
    const paths = Object.assign({ searchCatalog: "/catalog/search", getPrice: "/catalog/price", getAvailability: "/catalog/availability" }, opts.paths || {});
    const auth = typeof opts.auth === "function" ? opts.auth : () => ({});
    const fetchImpl = opts.fetchImpl || null;

    function resolveFetch() {
      if (fetchImpl) return fetchImpl;
      const root = typeof window !== "undefined" ? window.root : null;
      if (root && typeof root.superFetch === "function") return root.superFetch;
      if (typeof fetch === "function") return fetch.bind(window);
      return null;
    }

    async function request(fnName, payload) {
      assertReadOnly(fnName);
      const path = paths[fnName];
      if (!path) fail("bad_transport", `No read path is configured for "${fnName}".`);
      const impl = resolveFetch();
      if (!impl) fail("no_fetch", "No fetch implementation is available for the live distributor.");
      const authBits = auth(fnName, payload || {}) || {};
      const url = buildReadUrl(baseUrl, path, payload || {}, authBits.query);
      const init = {
        method: "GET",
        headers: Object.assign({ "Accept": "application/json" }, authBits.headers || {}),
        credentials: "omit"
      };
      let res;
      try {
        res = await withTimeout(Promise.resolve(impl(url, init)), policy.timeout_ms);
      } catch (e) {
        if (e && e.code) throw e;
        throw new DistributorError("transport_error", (e && e.message) || "The distributor request failed.", { retryable: true });
      }
      if (!res || !res.ok) {
        const status = res ? res.status : 0;
        const code = status === 401 || status === 403 ? "unauthorized"
          : status === 404 ? "not_found"
            : status === 429 ? "rate_limited"
              : status >= 500 ? "server_error" : "http_error";
        const err = new DistributorError(code, `HTTP ${status} from ${url}`, {
          retryable: status === 429 || status >= 500
        });
        if (status === 429 && res.headers && typeof res.headers.get === "function") {
          const ra = Number(res.headers.get("retry-after"));
          if (Number.isFinite(ra) && ra > 0) err.retry_after_ms = ra * 1000;
        }
        throw err;
      }
      try {
        return await res.json();
      } catch (e) {
        throw new DistributorError("bad_response", "The distributor returned a non-JSON response.", { retryable: true });
      }
    }

    return { live: true, readOnly: true, method: "GET", policy: policy, request: request };
  }

  // ---- service --------------------------------------------------------------

  // The app-facing service: every read goes through the gated connector gateway
  // (so the feature flags / data mode apply), results merge into side-by-side
  // comparisons, and `capture` seals the chosen price as a snapshot.
  function createService(opts) {
    opts = opts || {};
    const gateway = opts.gateway || null;
    const names = Array.isArray(opts.names) ? opts.names.map(String) : [];
    const priceSnapshots = opts.priceSnapshots || null;
    const scope = opts.scope === undefined ? "*" : opts.scope;

    function callOne(name, fnName, payload) {
      if (!gateway || typeof gateway.callAsync !== "function") {
        return Promise.resolve({ ok: false, source: name, code: "no_gateway", detail: "The distributor service needs a connector gateway with callAsync." });
      }
      return gateway.callAsync(name, fnName, payload, { scope: scope }).then(r => {
        if (r && r.ok) return { ok: true, source: name, result: r.result };
        return { ok: false, source: name, code: (r && r.code) || "connector_error", detail: (r && r.detail) || "" };
      });
    }

    async function each(fnName, payload) {
      const settled = await Promise.all(names.map(n => callOne(n, fnName, payload)));
      const bySource = {};
      const errors = [];
      settled.forEach(r => {
        if (r.ok) bySource[r.source] = r.result;
        else errors.push({ source: r.source, code: r.code, detail: r.detail });
      });
      return { by_source: bySource, errors: errors };
    }

    async function search(query, o) {
      const payload = Object.assign({}, o || {}, { query: query });
      const res = await each("searchCatalog", payload);
      const results = [];
      names.forEach(n => {
        const list = res.by_source[n];
        if (Array.isArray(list)) list.forEach(r => results.push(r));
      });
      return { ok: Object.keys(res.by_source).length > 0, by_source: res.by_source, results: results, errors: res.errors };
    }

    // Task 43: search every distributor at once and merge the hits into parts,
    // each carrying its side-by-side offers (unit cost, list price, quantity
    // available, warehouse) with the cheapest source first.
    async function searchParts(query, o) {
      const payload = Object.assign({}, o || {}, { query: query });
      const res = await each("searchCatalog", payload);
      const records = [];
      names.forEach(n => {
        const list = res.by_source[n];
        if (Array.isArray(list)) list.forEach(r => { if (r) records.push(r); });
      });
      return {
        ok: Object.keys(res.by_source).length > 0,
        parts: groupParts(records),
        records: records,
        by_source: res.by_source,
        errors: res.errors
      };
    }

    async function compare(part, o) {
      const payload = Object.assign({}, o || {}, { part: part });
      const price = await each("getPrice", payload);
      const avail = await each("getAvailability", payload);
      const rows = names
        .filter(n => price.by_source[n] || avail.by_source[n])
        .map(n => {
          const p = price.by_source[n] || null;
          const a = avail.by_source[n] || null;
          const record = p || a;
          const cost = p ? p.unit_cost_cents : null;
          const qty = a ? a.quantity_available : (p ? p.quantity_available : 0);
          return {
            source: n,
            record: record,
            unit_cost_cents: cost,
            list_price_cents: (p && p.list_price_cents) || (record && record.list_price_cents) || 0,
            currency: (p && p.currency) || (record && record.currency) || null,
            quantity_available: qty,
            in_stock: qty > 0,
            warehouse: (a && a.warehouse) || (p && p.warehouse) || null,
            cheapest: false
          };
        });
      rows.sort(compareOffers);
      const priced = rows.filter(r => r.unit_cost_cents !== null && r.unit_cost_cents !== undefined);
      if (priced.length) priced[0].cheapest = true;
      return {
        ok: rows.length > 0,
        rows: rows,
        best: rows.length ? (priced.length ? priced[0].record : rows[0].record) : null,
        errors: price.errors.concat(avail.errors)
      };
    }

    function price(part, o) { return each("getPrice", Object.assign({}, o || {}, { part: part })); }
    function availability(part, o) { return each("getAvailability", Object.assign({}, o || {}, { part: part })); }

    // Capture a distributor price as an immutable snapshot. By default the
    // cheapest distributor wins; `opts.source` forces a source and `opts.record`
    // supplies an already-fetched record (no extra read).
    async function capture(part, o) {
      o = o || {};
      if (!priceSnapshots || typeof priceSnapshots.capture !== "function") {
        return { ok: false, code: "no_snapshots", detail: "The distributor service needs the price-snapshot service to capture." };
      }
      let record = o.record || null;
      let source = o.source || null;
      let errors = [];
      if (!record) {
        const cmp = await compare(part, o);
        errors = cmp.errors;
        if (!cmp.ok) return { ok: false, code: "no_price", detail: `No distributor returned a price for "${part}".`, errors: errors };
        const row = source ? cmp.rows.find(r => r.source === source) : cmp.rows[0];
        if (!row) return { ok: false, code: "source_not_found", detail: `No price for "${part}" from "${source}".`, errors: errors };
        record = row.record;
        source = row.source;
      }
      const cap = await priceSnapshots.capture(toSnapshotInput(record, { captured_at: o.captured_at }));
      if (!cap.ok) return cap;
      return { ok: true, snapshot: cap.snapshot, record: record, source: source || record.source, deduped: !!cap.deduped, errors: errors };
    }

    async function ready() {
      return { ok: true, names: names.slice() };
    }

    return {
      names: names.slice(),
      list: () => names.slice(),
      search: search,
      searchParts: searchParts,
      compare: compare,
      price: price,
      availability: availability,
      capture: capture,
      snapshotInput: toSnapshotInput,
      ready: ready
    };
  }

  // A thin offline facade over concrete connectors (used by tests and by any
  // caller that already holds the connector objects).
  function createRegistry(distributors) {
    const list = (Array.isArray(distributors) ? distributors : []).slice();
    const byName = new Map(list.map(d => [d.name, d]));
    return {
      list: () => list.slice(),
      names: list.map(d => d.name),
      get: name => byName.get(String(name)) || null,
      search: async (query, opts) => {
        const bySource = {};
        const errors = [];
        for (const d of list) {
          const r = await d.client.search(query, opts);
          if (r.ok) bySource[d.name] = r.result;
          else errors.push({ source: d.name, code: r.code, detail: r.detail });
        }
        return { ok: true, by_source: bySource, errors: errors };
      }
    };
  }

  return {
    VERSION,
    INTERFACE_VERSION,
    READ_FUNCTIONS,
    RECORD_FIELDS,
    SCHEMA,
    FIELD_ALIASES,
    DEFAULT_POLICY,
    QUERY_PARAMS,
    RETRYABLE_CODES,
    DistributorError,
    canonicalKey,
    normalizePolicy,
    isReadOnly,
    assertReadOnly,
    normalizeRecord,
    tryNormalizeRecord,
    normalizeWire,
    tryNormalizeWire,
    resolveField,
    aliasFor,
    validateRecord,
    assertRecord,
    toDisplay,
    toSnapshotInput,
    bestRecord,
    partKey,
    groupParts,
    compareOffers,
    createThrottle,
    createReadEngine,
    createDistributor,
    createMockTransport,
    createHttpTransport,
    createService,
    createRegistry
  };
})();
