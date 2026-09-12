// ============================================================================
// quote-u — pluggable product content (roadmap task 45)
// ----------------------------------------------------------------------------
// A catalog item can be enriched (a longer description, an image, specs) from a
// product-content source. The contentProvider interface is deliberately tiny so
// the system is never coupled to a paid provider:
//
//   { name, label, description, license, free, resolve({item, ref, opts}) }
//
// The DEFAULT provider is "none": the catalog stays entirely self-contained.
// Shipping with quote-u are two genuinely FREE, OPEN sources, both reachable
// with no API key:
//
//   wikidata      — Wikidata / Wikimedia Commons (CC0). Name/MPN → entity →
//                   label, description and the P18 image. Good for branded
//                   hardware and services.
//   openfoodfacts — Open Food Facts (ODbL). GTIN/UPC barcode → product name,
//                   image, brand, quantity, categories. Good for retail goods.
//
// Every provider resolves through the CONNECTOR GATEWAY (the `content`
// connector), so product-content reads are allowlisted, centralized, logged and
// gated exactly like every other cross-system call (roadmap task 46) — the
// provider layer never touches the network directly.
//
// Escalation: if the free sources leave gaps that hurt (thin/no imagery for a
// niche SKU), ESCALATION records the paid options — Icecat, Digi-Key/Mouser
// product APIs, UPCitemdb PRO — and the trigger for adopting one. See
// `escalationPlan()`; the paid providers are intentionally NOT wired in, so
// adopting one is a deliberate, reviewed change.
// ============================================================================
window.QU_CONTENT = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DEFAULT_PROVIDER = "none";
  const CONNECTOR = "content";

  // The normalized enrichment shape every provider resolves to. A provider may
  // return fewer fields; `normalizeEnrichment` fills the rest with null.
  const ENRICHMENT_FIELDS = Object.freeze([
    "provider", "ref", "title", "description", "image_url",
    "source_url", "license", "attribution", "specs", "fetched_at"
  ]);

  // The recorded escalation options (roadmap task 45: "record the escalation
  // option for richer content if gaps hurt"). None of these is wired in: they
  // exist so the decision to pay for content is explicit and reviewable.
  const ESCALATION = Object.freeze([
    {
      provider: "icecat",
      label: "Icecat",
      license: "Commercial (per-seat / per-request)",
      covers: "Broad branded-hardware specs, imagery, datasheets and MPN-level normalization.",
      trigger: "Adopt when the free sources leave material imagery/spec gaps on the SKUs that drive most quote value.",
      tradeoff: "Paid, vendor-locked, and its terms restrict redistribution — so it stays behind the connector gateway like any other source."
    },
    {
      provider: "digikey",
      label: "Digi-Key Product Information API",
      license: "Commercial (API key, usage terms)",
      covers: "Electronic components: parameters, datasheets, lifecycle/obsolescence status.",
      trigger: "Adopt only if component-level specs become quote-relevant (the current catalog is systems, not components).",
      tradeoff: "Requires a credential in the fleet secret store; the connector would carry the gateway key, never the app."
    },
    {
      provider: "mouser",
      label: "Mouser Product Search API",
      license: "Commercial (API key)",
      covers: "Component pricing/availability and attributes (overlaps the distributor connectors).",
      trigger: "Adopt if a second/third priced source is needed — more a distibutor connector than a content source.",
      tradeoff: "Overlaps existing distributor connectors; prefer reusing them over adding another content vendor."
    },
    {
      provider: "upcitemdb_pro",
      label: "UPCitemdb PRO",
      license: "Commercial (API key)",
      covers: "Retail GTIN/UPC → title, brand and image lookups with higher rate limits than the free tier.",
      trigger: "Adopt if the free Open Food Facts coverage is too narrow for a retail-heavy catalog.",
      tradeoff: "Paid; the free OFF source already covers the barcode-keyed case for food/retail."
    }
  ]);

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function trimOrNull(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }

  // Fold a provider's raw answer into the one shared enrichment shape so every
  // consumer (catalog UI, builder line description, print/portal copy) reads the
  // same fields no matter which source answered.
  function normalizeEnrichment(input, meta) {
    meta = meta || {};
    const p = isPlainObject(input) ? input : {};
    const specs = isPlainObject(p.specs) ? p.specs : {};
    const out = {
      provider: trimOrNull(p.provider) || trimOrNull(meta.provider) || DEFAULT_PROVIDER,
      ref: trimOrNull(p.ref) || trimOrNull(meta.ref),
      title: trimOrNull(p.title),
      description: trimOrNull(p.description),
      image_url: trimOrNull(p.image_url),
      source_url: trimOrNull(p.source_url),
      license: trimOrNull(p.license) || trimOrNull(meta.license),
      attribution: trimOrNull(p.attribution) || trimOrNull(meta.attribution),
      specs: Object.assign({}, specs),
      fetched_at: trimOrNull(p.fetched_at) || trimOrNull(meta.fetched_at) || new Date().toISOString()
    };
    // Drop empty spec keys so "no specs" is null-ish and never a stray blank.
    Object.keys(out.specs).forEach(k => { if (out.specs[k] === undefined || out.specs[k] === null || out.specs[k] === "") delete out.specs[k]; });
    if (!Object.keys(out.specs).length) out.specs = null;
    return out;
  }

  function hasContent(content) {
    return !!(content && (content.title || content.description || content.image_url));
  }

  // ---- the two free, open sources -------------------------------------------

  // Wikidata: search by name/MPN, then read the entity. CC0, no key.
  function wikidataSearchUrl(query) {
    return "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*" +
      "&language=en&uselang=en&limit=5&search=" + encodeURIComponent(String(query == null ? "" : query));
  }
  function wikidataEntityUrl(id) {
    return "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*" +
      "&languages=en&props=labels|descriptions|claims|sitelinks&ids=" + encodeURIComponent(String(id == null ? "" : id));
  }
  function commonsImageUrl(fileName) {
    const name = String(fileName || "").replace(/^.*[\\/]/, "").replace(/ /g, "_");
    if (!name) return null;
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(name) + "?width=640";
  }
  // Pull the first value of a Wikidata claim property (e.g. P18 image).
  function claimString(entity, prop) {
    const claims = entity && entity.claims;
    const list = claims && claims[prop];
    if (!Array.isArray(list) || !list.length) return null;
    for (const c of list) {
      const dv = c && c.mainsnak && c.mainsnak.datavalue;
      if (dv && dv.value !== undefined && dv.value !== null) {
        if (typeof dv.value === "string") return dv.value;
        if (typeof dv.value === "object" && dv.value.text) return dv.value.text;
      }
    }
    return null;
  }

  function normalizeWikidata(entity, ref, meta) {
    if (!entity) return null;
    const label = entity.labels && entity.labels.en ? entity.labels.en.value : null;
    const desc = entity.descriptions && entity.descriptions.en ? entity.descriptions.en.value : null;
    const imageFile = claimString(entity, "P18");
    const website = claimString(entity, "P856");
    const home = entity.sitelinks && entity.sitelinks.enwiki ? "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(entity.sitelinks.enwiki.title || "").replace(/ /g, "_")) : null;
    return normalizeEnrichment({
      provider: "wikidata",
      ref: entity.id || ref,
      title: label,
      description: desc,
      image_url: imageFile ? commonsImageUrl(imageFile) : null,
      source_url: website || home || (entity.id ? "https://www.wikidata.org/wiki/" + entity.id : null),
      license: "CC0 (Wikidata; images via Wikimedia Commons)",
      attribution: "Wikidata / Wikimedia Commons",
      specs: { instance_of: claimString(entity, "P31"), image_file: imageFile }
    }, meta);
  }

  // Open Food Facts: look a product up by GTIN/UPC. ODbL, no key.
  function openFoodFactsUrl(gtin) {
    const code = String(gtin == null ? "" : gtin).replace(/[^0-9]/g, "");
    return "https://world.openfoodfacts.org/api/v2/product/" + encodeURIComponent(code) +
      ".json?fields=code,product_name,generic_name,brands,quantity,categories,image_front_url,nutriscore_grade,ingredients_text";
  }

  function normalizeOpenFoodFacts(product, ref, meta) {
    if (!product) return null;
    const code = product.code || ref;
    return normalizeEnrichment({
      provider: "openfoodfacts",
      ref: code,
      title: product.product_name || product.generic_name,
      description: product.generic_name || (product.brands ? "Brand: " + product.brands : null),
      image_url: product.image_front_url,
      source_url: code ? "https://world.openfoodfacts.org/product/" + code : null,
      license: "ODbL (Open Food Facts)",
      attribution: "Open Food Facts contributors",
      specs: {
        brands: product.brands || null,
        quantity: product.quantity || null,
        categories: product.categories || null,
        nutriscore_grade: product.nutriscore_grade || null
      }
    }, meta);
  }

  // The connector's read-only function set. Each fn builds its own provider URL
  // from semantic arguments (never an arbitrary caller-supplied URL), so the
  // gateway allowlist exposes three named reads, not an open fetch proxy.
  function createConnector(opts) {
    opts = opts || {};
    const transport = opts.transport;
    if (typeof transport !== "function") throw new Error("QU_CONTENT.createConnector needs a transport(url) function.");
    async function json(url) {
      const out = await transport(url);
      if (typeof out === "string") return JSON.parse(out);
      return out;
    }
    const functions = {
      async wikidataSearch(payload) {
        const query = String((payload && payload.query) || "").trim();
        if (!query) throw Object.assign(new Error("wikidataSearch needs a query."), { code: "query_required" });
        const data = await json(wikidataSearchUrl(query));
        const hits = (data && data.search) || [];
        return { query, results: hits.map(h => ({ id: h.id, label: h.label || null, description: h.description || null, url: h.concepturi || null })) };
      },
      async wikidataEntity(payload) {
        const id = String((payload && (payload.id || payload.ref)) || "").trim();
        if (!/^Q\d+$/.test(id)) throw Object.assign(new Error(`"${id}" is not a Wikidata entity id (Q…).`), { code: "bad_id" });
        const data = await json(wikidataEntityUrl(id));
        const entity = data && data.entities && data.entities[id];
        if (!entity || entity.missing !== undefined) return { id, found: false, entity: null };
        return { id, found: true, entity };
      },
      async openFoodFactsProduct(payload) {
        const gtin = String((payload && (payload.gtin || payload.upc || payload.ref)) || "").trim();
        if (!/^[0-9]{6,14}$/.test(gtin)) throw Object.assign(new Error(`"${gtin}" is not a GTIN/UPC barcode.`), { code: "bad_gtin" });
        const data = await json(openFoodFactsUrl(gtin));
        const product = data && data.status === 1 ? data.product : null;
        return { gtin, found: !!product, product };
      }
    };
    return {
      name: CONNECTOR,
      functions,
      readOnly: true,
      live: opts.live === true,
      descriptor: {
        label: "Product content",
        kind: "read",
        gateway_key: opts.gatewayKey || null,
        roles: ["owner", "manager", "viewer"],
        functions: {
          wikidataSearch: { effect: "read" },
          wikidataEntity: { effect: "read" },
          openFoodFactsProduct: { effect: "read" }
        }
      }
    };
  }

  // ---- the provider registry -------------------------------------------------

  function providerMeta(provider) {
    return {
      name: provider.name,
      label: provider.label || provider.name,
      description: provider.description || "",
      license: provider.license || null,
      free: provider.free === true,
      kind: provider.kind || "source",
      note: provider.note || null
    };
  }

  // Build the enrichment from a catalog item using a provider's already-
  // normalized answer. `resolve` may be async.
  function providerResolvers(opts) {
    opts = opts || {};
    const call = opts.call || null; // async (fn, payload) => result
    const now = opts.now || (() => new Date().toISOString());

    async function viaConnector(fn, payload, meta) {
      if (typeof call !== "function") return { ok: false, code: "no_connector", detail: "No content connector is available." };
      const res = await call(fn, payload);
      if (!res || !res.ok) return { ok: false, code: (res && res.code) || "content_read_failed", detail: (res && res.detail) || "The content source refused the lookup." };
      return { ok: true, data: res.result, meta };
    }

    return {
      none: async () => ({ ok: true, content: null, provider: "none", selfContained: true }),

      wikidata: async ({ item, ref }) => {
        const query = ref || (item && (item.manufacturer_part_number || item.sku || item.description));
        if (!query) return { ok: false, code: "no_ref", detail: "This item has no reference (MPN/SKU) to look up on Wikidata." };
        let id = /^Q\d+$/.test(String(query)) ? String(query) : null;
        if (!id) {
          const s = await viaConnector("wikidataSearch", { query });
          if (!s.ok) return s;
          const hits = (s.data && s.data.results) || [];
          if (!hits.length) return { ok: true, content: null, provider: "wikidata", miss: true };
          id = hits[0].id;
        }
        const e = await viaConnector("wikidataEntity", { id });
        if (!e.ok) return e;
        if (!e.data || !e.data.found) return { ok: true, content: null, provider: "wikidata", miss: true, ref: id };
        const content = normalizeWikidata(e.data.entity, id, { fetched_at: now() });
        return { ok: true, content, provider: "wikidata", ref: id };
      },

      openfoodfacts: async ({ item, ref }) => {
        const gtin = ref || (item && (item.upc || item.gtin || item.manufacturer_part_number));
        if (!gtin) return { ok: false, code: "no_ref", detail: "This item has no GTIN/UPC to look up on Open Food Facts." };
        const r = await viaConnector("openFoodFactsProduct", { gtin });
        if (!r.ok) return r;
        if (!r.data || !r.data.found) return { ok: true, content: null, provider: "openfoodfacts", miss: true, ref: String(gtin) };
        const content = normalizeOpenFoodFacts(r.data.product, String(gtin), { fetched_at: now() });
        return { ok: true, content, provider: "openfoodfacts", ref: String(gtin) };
      }
    };
  }

  function createService(opts) {
    opts = opts || {};
    const catalog = opts.catalog || window.QU_CATALOG || null;
    const gateway = opts.gateway || null;
    const call = opts.call || (gateway && typeof gateway.callAsync === "function"
      ? (fn, payload) => gateway.callAsync(CONNECTOR, fn, payload, { scope: "*" })
      : null);
    const now = opts.now || (() => new Date().toISOString());
    const resolvers = providerResolvers({ call, now });
    const registered = new Map();

    function register(name, resolve, meta) {
      if (!name || typeof name !== "string") throw new Error("A content provider needs a name.");
      if (typeof resolve !== "function") throw new Error(`Provider "${name}" needs a resolve function.`);
      registered.set(name, Object.assign({ name, label: name, resolve }, meta || {}));
      if (catalog && typeof catalog.registerProvider === "function") {
        // The catalog's provider contract is raw content (or null) — NOT this
        // service's `{ok, content, ...}` envelope. Unwrap so a delegated
        // resolver (e.g. the self-contained "none") returns the content
        // directly; otherwise `catalog.resolveContent` would nest the envelope
        // as if it were the content.
        catalog.registerProvider(name, info => Promise.resolve(resolve(info)).then(r => {
          if (!r || r.ok === false) return null;
          return r.content === undefined ? null : r.content;
        }), meta || {});
      }
      return registered.get(name);
    }

    // Register the built-ins (none + the two free sources). Re-registering is
    // idempotent, so a reload or a second service never stacks duplicates.
    register("none", resolvers.none, { label: "None", description: "The catalog is self-contained; no external content is fetched.", free: true, kind: "none" });
    register("wikidata", resolvers.wikidata, { label: "Wikidata", description: "Free/open (CC0) entity descriptions and Commons imagery, searched by MPN/SKU/name.", free: true, license: "CC0", kind: "source" });
    register("openfoodfacts", resolvers.openfoodfacts, { label: "Open Food Facts", description: "Free/open (ODbL) retail product records looked up by GTIN/UPC barcode.", free: true, license: "ODbL", kind: "source" });

    function listProviders() {
      return Array.from(registered.values()).map(providerMeta);
    }

    // Resolve enrichment for a catalog item through its named provider. Never
    // throws; a provider failure is a refusal the UI can show.
    async function resolve(item, o) {
      if (!item) return { ok: false, code: "bad_catalog_item", detail: "No catalog item." };
      const name = item.content_provider || DEFAULT_PROVIDER;
      const provider = registered.get(name);
      if (!provider) return { ok: false, code: "provider_not_found", provider: name, detail: `No content provider named "${name}" is registered.` };
      try {
        const ref = (o && o.ref !== undefined) ? o.ref : (item.content_ref === undefined ? null : item.content_ref);
        const res = await provider.resolve({ item, ref, opts: o || {} });
        if (!res || res.ok === false) return { ok: false, provider: name, code: (res && res.code) || "provider_error", detail: (res && res.detail) || "The content provider failed." };
        const content = res.content ? normalizeEnrichment(res.content, { provider: name, ref: res.ref || ref, fetched_at: now() }) : null;
        return { ok: true, provider: name, content, miss: !content && res.miss === true, selfContained: res.selfContained === true, ref: res.ref || ref || null };
      } catch (e) {
        return { ok: false, provider: name, code: "provider_error", detail: (e && e.message) || String(e) };
      }
    }

    // Resolve and merge into the item without persisting — the caller decides
    // whether to save the enriched item back into the catalog.
    async function enrich(item, o) {
      const r = await resolve(item, o);
      if (!r.ok) return r;
      return Object.assign({}, r, { merged: applyToItem(item, r.content) });
    }

    function escalationPlan() {
      return ESCALATION.map(e => Object.assign({}, e));
    }

    return {
      VERSION,
      CONNECTOR,
      DEFAULT_PROVIDER,
      ESCALATION,
      providers: () => Array.from(registered.keys()),
      register,
      listProviders,
      resolve,
      enrich,
      escalationPlan,
      normalizeEnrichment,
      connectorReady: () => !!call
    };
  }

  // Pure merge: stamp the enrichment onto a catalog item (never touching cost or
  // pricing fields). Used to preview an enriched item before saving.
  function applyToItem(item, content) {
    if (!item) return item;
    if (!content) return Object.assign({}, item);
    const out = Object.assign({}, item);
    if (content.title && (!out.description || content.description)) out.description = content.description || content.title;
    else if (content.description) out.description = content.description;
    out.content_enrichment = {
      provider: content.provider,
      ref: content.ref,
      title: content.title,
      image_url: content.image_url,
      source_url: content.source_url,
      license: content.license,
      fetched_at: content.fetched_at
    };
    return out;
  }

  return {
    VERSION,
    CONNECTOR,
    DEFAULT_PROVIDER,
    ENRICHMENT_FIELDS,
    ESCALATION,
    normalizeEnrichment,
    hasContent,
    wikidataSearchUrl,
    wikidataEntityUrl,
    openFoodFactsUrl,
    commonsImageUrl,
    normalizeWikidata,
    normalizeOpenFoodFacts,
    createConnector,
    createService,
    applyToItem
  };
})();
