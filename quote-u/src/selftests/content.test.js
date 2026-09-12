(function () {
  const T = window.QU_SELFTEST;
  const C = window.QU_CONNECTORS;
  const CT = window.QU_CONTENT;
  if (!T || !C || !CT) return;

  T.register("content: enrichment normalizes to one shape, the provider catalog is honest, and the paid escalation options are recorded (not enabled)", () => {
    const bad = [];
    const n = CT.normalizeEnrichment({ title: " Widget ", description: "", specs: { weight: "", size: "10cm", empty: null } }, { provider: "wikidata", ref: "Q1" });
    if (n.provider !== "wikidata") bad.push("provider: " + n.provider);
    if (n.title !== "Widget") bad.push("title trim: " + n.title);
    if (n.description !== null) bad.push("empty description should be null");
    if (!n.specs || n.specs.size !== "10cm" || "weight" in n.specs || "empty" in n.specs) bad.push("specs cleanup: " + JSON.stringify(n.specs));
    if (typeof n.fetched_at !== "string" || !n.fetched_at) bad.push("fetched_at");
    const none = CT.normalizeEnrichment(null);
    if (none.provider !== "none") bad.push("default provider should be none: " + none.provider);

    if (!CT.hasContent({ title: "x" }) || CT.hasContent({ specs: { a: 1 } })) bad.push("hasContent misclassifies");
    if (!CT.hasContent(n)) bad.push("hasContent should be true for a title");

    const providers = CT.createService({ call: null }).listProviders();
    const names = providers.map(p => p.name).sort().join(",");
    if (names !== "none,openfoodfacts,wikidata") bad.push("registered providers: " + names);
    const noneP = providers.find(p => p.name === "none");
    if (!noneP || !noneP.free) bad.push("none should be free/self-contained");
    const wd = providers.find(p => p.name === "wikidata");
    const off = providers.find(p => p.name === "openfoodfacts");
    if (!wd || wd.license !== "CC0") bad.push("wikidata should be CC0");
    if (!off || off.license !== "ODbL") bad.push("openfoodfacts should be ODbL");

    const plan = CT.createService({ call: null }).escalationPlan();
    const ids = plan.map(e => e.provider).sort().join(",");
    if (ids !== "digikey,icecat,mouser,upcitemdb_pro") bad.push("escalation ids: " + ids);
    if (!plan.every(e => e.license && e.covers && e.trigger)) bad.push("every escalation option records license/covers/trigger");
    if (!CT.wikidataSearchUrl("a b").startsWith("https://www.wikidata.org/")) bad.push("wikidata search url");
    if (CT.openFoodFactsUrl("1234567890123").indexOf("/product/1234567890123.json") === -1) bad.push("openfoodfacts url");
    if (CT.commonsImageUrl("Foo bar.jpg").indexOf("Foo_bar.jpg") === -1) bad.push("commons url should underscore spaces");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "enrichment normalizes to the shared shape, the default provider is none with two free/open sources (CC0 + ODbL), and the four paid escalation options are recorded with their trigger" };
  });

  T.register("content: the content connector exposes named read functions only (no open fetch proxy) and resolves through the gateway", async () => {
    const bad = [];
    const transport = async url => {
      if (url.indexOf("action=wbsearchentities") !== -1) {
        return JSON.stringify({ search: url.indexOf("Widget") !== -1 ? [{ id: "Q42", label: "Widget", description: "a thing" }] : [] });
      }
      if (url.indexOf("action=wbgetentities") !== -1) {
        return JSON.stringify({ entities: { Q42: { id: "Q42", labels: { en: { value: "Widget" } }, descriptions: { en: { value: "A widget" } }, claims: { P18: [{ mainsnak: { datavalue: { value: "Widget.jpg" } } }] }, sitelinks: {} } } });
      }
      if (url.indexOf("openfoodfacts.org/api/v2/product/") !== -1) {
        return JSON.stringify({ status: 1, product: { code: "1234567890123", product_name: "Test Bar", brands: "Acme", image_front_url: "https://img.example/x.jpg" } });
      }
      throw new Error("unexpected url " + url);
    };
    const connector = CT.createConnector({ transport, live: false });
    if (!connector.readOnly) bad.push("the content connector must be read-only");
    const fns = Object.keys(connector.functions).sort().join(",");
    if (fns !== "openFoodFactsProduct,wikidataEntity,wikidataSearch") bad.push("function allowlist: " + fns);
    if (Object.keys(connector.functions).some(f => /url|fetch|get/i.test(f))) bad.push("no arbitrary fetch function may be exposed");

    const gw = C.createGateway({ connectors: { content: connector } });
    const s = await gw.callAsync("content", "wikidataSearch", { query: "Widget" }, { scope: "*" });
    if (!s.ok || !s.result.results.length || s.result.results[0].id !== "Q42") bad.push("search: " + JSON.stringify(s));
    const e = await gw.callAsync("content", "wikidataEntity", { id: "Q42" }, { scope: "*" });
    if (!e.ok || !e.result || !e.result.found) bad.push("entity: " + JSON.stringify(e));
    const norm = e.result ? CT.normalizeWikidata(e.result.entity, "Q42") : null;
    if (!norm || norm.title !== "Widget") bad.push("normalizeWikidata title: " + JSON.stringify(norm));
    if (!norm.image_url || norm.image_url.indexOf("commons.wikimedia.org") === -1 || norm.image_url.indexOf("Widget.jpg") === -1) bad.push("image url: " + norm.image_url);
    if (!norm.license || norm.license.indexOf("CC0") === -1) bad.push("license: " + norm.license);

    const miss = await gw.callAsync("content", "wikidataSearch", { query: "Nothing" }, { scope: "*" });
    if (!miss.ok || miss.result.results.length !== 0) bad.push("a search with no hits should be an empty result, not an error");

    const off = await gw.callAsync("content", "openFoodFactsProduct", { gtin: "1234567890123" }, { scope: "*" });
    if (!off.ok || !off.result || !off.result.found) bad.push("off lookup: " + JSON.stringify(off));
    const offN = off.result ? CT.normalizeOpenFoodFacts(off.result.product, "1234567890123") : null;
    if (!offN || offN.title !== "Test Bar" || offN.specs.brands !== "Acme") bad.push("normalizeOpenFoodFacts: " + JSON.stringify(offN));

    const badId = await gw.callAsync("content", "wikidataEntity", { id: "not-an-id" }, { scope: "*" });
    if (badId.ok || badId.code !== "bad_id") bad.push("a non-Q id should be refused: " + JSON.stringify(badId));
    const badGtin = await gw.callAsync("content", "openFoodFactsProduct", { gtin: "abc" }, { scope: "*" });
    if (badGtin.ok || badGtin.code !== "bad_gtin") bad.push("a non-numeric gtin should be refused: " + JSON.stringify(badGtin));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the content connector exposes only three named reads (each building its own provider URL), resolves Wikidata search/entity (with a Commons image) and Open Food Facts through the gateway, returns an empty result for a miss, and refuses a bad id/gtin" };
  });

  T.register("content: the provider registry resolves per item through a connector call, refuses unknown providers, and enrich never touches cost", async () => {
    const bad = [];
    const seen = [];
    const call = async (fn, payload) => {
      seen.push(fn);
      if (fn === "wikidataSearch") return { ok: true, result: { query: payload.query, results: [{ id: "Q7", label: "Thing" }] } };
      if (fn === "wikidataEntity") return { ok: true, result: { id: payload.id, found: true, entity: { id: payload.id, labels: { en: { value: "Thing" } }, descriptions: { en: { value: "A resolved thing" } }, claims: {} } } };
      if (fn === "openFoodFactsProduct") return { ok: true, result: { gtin: payload.gtin, found: false, product: null } };
      return { ok: false, code: "bad_fn" };
    };
    const svc = CT.createService({ call, now: () => "2026-01-01T00:00:00.000Z" });

    const none = await svc.resolve({ id: "a", content_provider: "none" });
    if (!none.ok || none.content !== null || none.selfContained !== true) bad.push("none should resolve self-contained null: " + JSON.stringify(none));

    const missing = await svc.resolve({ id: "a", content_provider: "does_not_exist" });
    if (missing.ok || missing.code !== "provider_not_found") bad.push("unknown provider: " + JSON.stringify(missing));

    const wd = await svc.resolve({ id: "c", content_provider: "wikidata", manufacturer_part_number: "Thing" });
    if (!wd.ok || !wd.content || wd.content.title !== "Thing" || wd.content.description !== "A resolved thing") bad.push("wikidata resolve: " + JSON.stringify(wd));
    if (wd.content.fetched_at !== "2026-01-01T00:00:00.000Z") bad.push("fetched_at should come from the injected clock");
    if (seen.indexOf("wikidataSearch") === -1 || seen.indexOf("wikidataEntity") === -1) bad.push("wikidata should search then read the entity");

    const off = await svc.resolve({ id: "d", content_provider: "openfoodfacts", content_ref: "000111" });
    if (!off.ok || off.content !== null || off.miss !== true) bad.push("openfoodfacts miss: " + JSON.stringify(off));

    const item = { id: "e", content_provider: "wikidata", manufacturer_part_number: "Thing", unit_cost_cents: 12345, default_markup_bp: 2400 };
    const enr = await svc.enrich(item);
    if (!enr.ok || !enr.merged) bad.push("enrich: " + JSON.stringify(enr && enr.code));
    else {
      if (enr.merged.description !== "A resolved thing") bad.push("merged description: " + enr.merged.description);
      if (enr.merged.unit_cost_cents !== 12345 || enr.merged.default_markup_bp !== 2400) bad.push("enrich must never touch cost/pricing fields");
      if (!enr.merged.content_enrichment || enr.merged.content_enrichment.provider !== "wikidata") bad.push("content_enrichment stamp missing");
      if (item.description !== undefined) bad.push("the source item must not be mutated");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the registry resolves none (self-contained), refuses an unknown provider, resolves Wikidata via search→entity and records a miss for Open Food Facts, and enrich stamps content_enrichment without ever touching cost" };
  });
})();
