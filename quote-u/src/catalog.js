// ============================================================================
// quote-u — internal product catalog (roadmap task 12)
// ----------------------------------------------------------------------------
// The catalog is quote-u's own book of sellable things: hardware, circuits,
// licences and services. A rep searches it and adds an item to a quote; the
// item carries everything a line needs (SKU, manufacturer part number,
// description, category, default kind) plus the pricing defaults (unit cost,
// default markup in basis points) used to propose a sell price.
//
// Content is pluggable: every item names a `content_provider` (default "none")
// and an optional `content_ref`. A provider is a registered adapter that can
// enrich an item (description copy, images, specs) without coupling the system
// to any paid source — register one at runtime with `registerProvider`, or
// leave it as "none" and the catalog is entirely self-contained.
//
// The pure model (fields, validation, search, markup math, add-to-quote) lives
// here; the `createService` layer persists items into the `catalog_items`
// system-of-record document through the revision-guarded store, and
// `seedIfEmpty` installs the bundled pipeline catalog (main.pjs `catalogSeed`)
// exactly once.
// ============================================================================
window.QU_CATALOG = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u catalog requires window.QU_MONEY (load src/money.js first)");
  const LI = window.QU_LINEITEMS || null;

  const VERSION = "1.0.0";
  const DOC = "catalog_items";
  const DEFAULT_MAX_RETRIES = 4;
  const DEFAULT_PROVIDER = "none";

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable catalog-item id" },
    { name: "sku", required: false, default: "", note: "seller/internal SKU" },
    { name: "manufacturer_part_number", required: false, default: "", note: "MPN" },
    { name: "description", required: true, note: "default client-facing description" },
    { name: "category", required: false, default: "other", note: "catalog category id" },
    { name: "default_kind", required: false, default: "one_time", note: "one_time | mrr" },
    { name: "unit_cost_cents", required: false, default: 0, note: "integer cents; internal only" },
    { name: "default_markup_bp", required: false, default: 0, note: "default markup over cost, in basis points" },
    { name: "currency", required: false, default: M.DEFAULT_CURRENCY, note: "reserved currency column (v1: CAD)" },
    { name: "content_provider", required: false, default: DEFAULT_PROVIDER, note: "content enrichment adapter name" },
    { name: "content_ref", required: false, default: null, note: "provider-specific content reference" },
    { name: "active", required: false, default: true, note: "inactive items stay for history but are not offered" }
  ];

  class CatalogError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "CatalogError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new CatalogError(code, message, meta);
  }

  function genId(rand) {
    return "cat-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function slug(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }

  function asString(value, name, violations) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string` });
      return "";
    }
    return value;
  }

  function asNullableString(value, name, violations) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be a string or null` });
      return null;
    }
    return value;
  }

  function asCents(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      if (violations) violations.push({ field: name, code: "fractional_cents", detail: `${name} must be integer cents, got ${value}` });
      return def;
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be integer cents` });
      return def;
    }
    return value;
  }

  function asBp(value, name, def, violations) {
    if (value === undefined || value === null) return def;
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      if (violations) violations.push({ field: name, code: "bad_" + name, detail: `${name} must be an integer basis-point rate` });
      return def;
    }
    return value;
  }

  // ---- the item record ------------------------------------------------------

  function collect(input, opts) {
    opts = opts || {};
    const violations = [];
    if (!isPlainObject(input)) {
      return { violations: [{ field: null, code: "bad_catalog_item", detail: "A catalog item must be an object" }], record: null };
    }

    let id = input.id;
    if (id === undefined || id === null || id === "") id = opts.id || genId(opts.rand);
    else if (typeof id !== "string") {
      violations.push({ field: "id", code: "bad_id", detail: "id must be a string" });
      id = String(id);
    }

    const description = asString(input.description, "description", violations);
    if (!description.trim()) violations.push({ field: "description", code: "bad_description", detail: "A catalog item needs a description." });

    const kind = input.default_kind === undefined || input.default_kind === null || input.default_kind === "" ? "one_time" : String(input.default_kind);
    const kinds = LI && LI.KINDS ? LI.KINDS : ["one_time", "mrr"];
    if (kinds.indexOf(kind) === -1) violations.push({ field: "default_kind", code: "bad_default_kind", detail: `default_kind "${kind}" is not one of ${kinds.join(" | ")}` });

    let currency = input.currency === undefined || input.currency === null || input.currency === "" ? M.DEFAULT_CURRENCY : input.currency;
    try {
      currency = M.normalizeCurrency(currency);
    } catch (e) {
      violations.push({ field: "currency", code: "bad_currency", detail: (e && e.message) || String(e) });
      currency = M.DEFAULT_CURRENCY;
    }

    const active = input.active === undefined || input.active === null ? true : input.active;
    if (typeof active !== "boolean") violations.push({ field: "active", code: "bad_active", detail: "active must be true or false" });

    const record = {
      id,
      sku: asString(input.sku, "sku", violations),
      manufacturer_part_number: asString(input.manufacturer_part_number, "manufacturer_part_number", violations),
      description,
      category: input.category === undefined || input.category === null || input.category === "" ? "other" : asString(input.category, "category", violations),
      default_kind: kind,
      unit_cost_cents: asCents(input.unit_cost_cents, "unit_cost_cents", 0, violations),
      default_markup_bp: asBp(input.default_markup_bp, "default_markup_bp", 0, violations),
      currency,
      content_provider: input.content_provider === undefined || input.content_provider === null || input.content_provider === "" ? DEFAULT_PROVIDER : asString(input.content_provider, "content_provider", violations),
      content_ref: asNullableString(input.content_ref, "content_ref", violations),
      active: active === false ? false : true
    };

    Object.keys(input).forEach(k => {
      if (!Object.prototype.hasOwnProperty.call(record, k)) record[k] = input[k];
    });

    return { violations, record };
  }

  function validate(input, opts) {
    const out = collect(input, opts);
    return { ok: out.violations.length === 0, violations: out.violations, record: out.record };
  }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (out.violations.length) {
      const v = out.violations[0];
      fail(v.code, v.detail, { violations: out.violations });
    }
    return out.record;
  }

  // ---- pricing & search -----------------------------------------------------

  // The default sell price for an item: cost + default markup (basis points).
  // Exact integer cents through QU_MONEY — never a float.
  function sellPriceCents(item, opts) {
    opts = opts || {};
    if (!item) fail("bad_catalog_item", "No catalog item.");
    const cost = opts.unit_cost_cents !== undefined ? opts.unit_cost_cents : item.unit_cost_cents;
    M.assertCents(cost, "catalog unit cost");
    const bp = opts.default_markup_bp !== undefined ? opts.default_markup_bp : item.default_markup_bp;
    M.assertBp(bp, "catalog markup");
    return M.add(cost, M.applyBp(cost, bp));
  }

  function termsOf(query) {
    return String(query == null ? "" : query).toLowerCase().split(/\s+/).filter(Boolean);
  }

  function haystackOf(item) {
    return [item && item.sku, item && item.manufacturer_part_number, item && item.description, item && item.category]
      .filter(Boolean).join(" ").toLowerCase();
  }

  // Every whitespace-separated term must appear somewhere in the item. An
  // empty query matches everything.
  function matches(item, query) {
    const terms = termsOf(query);
    if (!terms.length) return true;
    const hay = haystackOf(item);
    return terms.every(t => hay.indexOf(t) !== -1);
  }

  function search(items, query, filter) {
    filter = filter || {};
    let out = (items || []).filter(it => it && matches(it, query));
    if (filter.includeInactive !== true) out = out.filter(it => it.active !== false);
    if (filter.category) out = out.filter(it => it.category === filter.category);
    if (filter.kind) out = out.filter(it => it.default_kind === filter.kind);
    return out.sort((a, b) => {
      const sa = String(a.sku || "");
      const sb = String(b.sku || "");
      if (sa !== sb) return sa.localeCompare(sb);
      return String(a.description || "").localeCompare(String(b.description || ""));
    });
  }

  // ---- add-to-quote ---------------------------------------------------------

  // Map a catalog item into the line-item vocabulary. The catalog reference is
  // always recorded so a line can be traced back to its source item; the price
  // is manual (derived from cost + markup) unless the caller supplies a
  // price_snapshot_ref, in which case the line is snapshot-priced.
  function toLineItemInput(item, opts) {
    opts = opts || {};
    if (!item) fail("bad_catalog_item", "No catalog item to add.");
    const snapshotRef = opts.price_snapshot_ref || null;
    const sell = opts.unit_sell_cents !== undefined ? opts.unit_sell_cents : sellPriceCents(item, opts);
    const input = {
      kind: opts.kind || item.default_kind,
      description: opts.description || item.description,
      manufacturer_part_number: opts.manufacturer_part_number !== undefined ? opts.manufacturer_part_number : item.manufacturer_part_number,
      sku: opts.sku !== undefined ? opts.sku : item.sku,
      quantity: opts.quantity === undefined ? 1 : opts.quantity,
      unit_cost_cents: opts.unit_cost_cents !== undefined ? opts.unit_cost_cents : item.unit_cost_cents,
      unit_sell_cents: sell,
      optional: opts.optional === true,
      option_group_id: opts.option_group_id === undefined ? null : opts.option_group_id,
      selected_by_default: opts.selected_by_default === true,
      catalog_ref: item.id,
      price_snapshot_ref: snapshotRef,
      pricing_mode: snapshotRef ? "snapshot" : "manual",
      currency: opts.currency || item.currency
    };
    if (opts.section !== undefined) input.section = opts.section;
    if (opts.sort_order !== undefined) input.sort_order = opts.sort_order;
    if (opts.quote_version_id !== undefined) input.quote_version_id = opts.quote_version_id;
    return input;
  }

  // One-call add: build a validated line item from a catalog item. Returns
  // {ok:true, line} or {ok:false, code, violations} — never throws.
  function buildLineItem(item, opts) {
    opts = opts || {};
    const input = toLineItemInput(item, opts);
    if (!LI || typeof LI.validate !== "function") return { ok: false, code: "no_lineitems", detail: "QU_LINEITEMS is not loaded.", input };
    const v = LI.validate(input, opts.id ? { id: opts.id } : undefined);
    if (!v.ok) return { ok: false, code: "bad_line_item", violations: v.violations, detail: v.violations[0].detail, input };
    return { ok: true, line: v.record, input };
  }

  // ---- pluggable content providers -----------------------------------------

  const providers = new Map();
  providers.set(DEFAULT_PROVIDER, {
    name: DEFAULT_PROVIDER,
    label: "None",
    description: "The catalog is self-contained; no external content is fetched.",
    resolve: () => null
  });

  function registerProvider(name, resolve, meta) {
    if (!name || typeof name !== "string") fail("bad_provider", "A content provider needs a name.");
    if (typeof resolve !== "function") fail("bad_provider", `Provider "${name}" needs a resolve function.`);
    providers.set(name, Object.assign({ name, label: name, resolve }, meta || {}));
    return providers.get(name);
  }

  function listProviders() {
    return Array.from(providers.values()).map(p => ({ name: p.name, label: p.label, description: p.description || "" }));
  }

  // Resolve an item's provider content (async-capable). "none" → null.
  async function resolveContent(item, opts) {
    if (!item) return { ok: false, code: "bad_catalog_item", detail: "No catalog item." };
    const name = item.content_provider || DEFAULT_PROVIDER;
    const provider = providers.get(name);
    if (!provider) return { ok: false, code: "provider_not_found", provider: name, detail: `No content provider named "${name}" is registered.` };
    try {
      const content = await provider.resolve({ item, ref: item.content_ref === undefined ? null : item.content_ref, opts: opts || {} });
      return { ok: true, provider: name, content: content === undefined ? null : content };
    } catch (e) {
      return { ok: false, code: "provider_error", provider: name, detail: (e && e.message) || String(e) };
    }
  }

  // ---- persistence (system-of-record document) ------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_CATALOG needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const rand = opts.rand || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;

    async function loadCatalog() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    // Revision-guarded read-modify-write: `mutate(records)` returns the next
    // array (or null for a no-op). Retries while the document moves under us.
    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await loadCatalog();
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision, records: l.records };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "catalog_conflict", detail: `Could not write the catalog after ${maxRetries + 1} attempts; the document kept moving.` };
    }

    async function list(filter) {
      const l = await loadCatalog();
      if (!l.ok) return l;
      let records = l.records;
      if (filter && filter.includeInactive !== true) records = records.filter(r => r && r.active !== false);
      if (filter && filter.category) records = records.filter(r => r.category === filter.category);
      return { ok: true, items: records.slice(), revision: l.revision };
    }

    async function searchItems(query, filter) {
      const l = await loadCatalog();
      if (!l.ok) return l;
      return { ok: true, items: search(l.records, query, filter), revision: l.revision };
    }

    async function get(id) {
      const l = await loadCatalog();
      if (!l.ok) return l;
      return { ok: true, item: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function upsert(input) {
      let item;
      try {
        item = normalize(input, { rand });
      } catch (e) {
        return { ok: false, code: e.code || "bad_catalog_item", detail: e.message };
      }
      const res = await mutate(records => {
        const idx = records.findIndex(r => r && r.id === item.id);
        if (idx === -1) return records.concat([item]);
        records[idx] = item;
        return records;
      });
      if (!res.ok) return res;
      return { ok: true, item, revision: res.revision, created: !!res.created, noop: !!res.noop };
    }

    async function remove(id) {
      const res = await mutate(records => {
        const idx = records.findIndex(r => r && r.id === id);
        if (idx === -1) return null;
        records.splice(idx, 1);
        return records;
      });
      if (!res.ok) return res;
      if (res.noop) return { ok: false, code: "catalog_item_not_found", detail: `No catalog item ${id}.` };
      return { ok: true, revision: res.revision };
    }

    // Install a bundled seed list. `seedIfEmpty` writes the whole list only when
    // the document has no records (the steady-state boot path); `seed` adds any
    // item whose id is not already present (idempotent).
    async function seed(seedList, options) {
      options = options || {};
      const list = Array.isArray(seedList) ? seedList : [];
      if (!list.length) return { ok: true, seeded: 0, skipped: true };
      const prepared = [];
      const invalid = [];
      list.forEach((raw, i) => {
        let id = raw && raw.id;
        if (id === undefined || id === null || id === "") id = seedIdFor(raw, i);
        try {
          prepared.push(normalize(Object.assign({}, raw, { id })));
        } catch (e) {
          invalid.push({ index: i, code: e.code || "bad_catalog_item", detail: e.message });
        }
      });
      let addedIds = [];
      const res = await mutate(records => {
        addedIds = [];
        const have = new Set(records.map(r => r && r.id));
        if (options.onlyIfEmpty && records.length) return null;
        const add = prepared.filter(p => !have.has(p.id));
        if (!add.length) return null;
        addedIds = add.map(p => p.id);
        return records.concat(add);
      });
      if (!res.ok) return res;
      return { ok: true, seeded: addedIds.length, invalid, revision: res.revision, skipped: !!res.noop };
    }

    function seedIfEmpty(seedList) {
      return seed(seedList, { onlyIfEmpty: true });
    }

    async function count(filter) {
      const l = await list(filter);
      if (!l.ok) return l;
      return { ok: true, count: l.items.length };
    }

    function ready() {
      return Promise.resolve({ ok: true, doc }).then(r => r);
    }

    return {
      doc,
      ready,
      load: loadCatalog,
      list,
      search: searchItems,
      get,
      upsert,
      remove,
      seed,
      seedIfEmpty,
      count
    };
  }

  function seedIdFor(raw, index) {
    const base = raw && (raw.sku || raw.manufacturer_part_number || raw.description);
    const s = slug(base);
    return "cat-" + (s || "item-" + index);
  }

  return {
    VERSION,
    DOC,
    DEFAULT_PROVIDER,
    FIELDS,
    MODEL_FIELD_NAMES: FIELDS.map(f => f.name),
    CatalogError,
    genId,
    slug,
    validate,
    normalize,
    sellPriceCents,
    matches,
    search,
    toLineItemInput,
    buildLineItem,
    registerProvider,
    listProviders,
    resolveContent,
    seedIdFor,
    createService
  };
})();
