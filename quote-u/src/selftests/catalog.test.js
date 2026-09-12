(function () {
  const T = window.QU_SELFTEST;
  const C = window.QU_CATALOG;
  const LI = window.QU_LINEITEMS;
  const M = window.QU_MONEY;
  const QS = window.QU_STORE;
  if (!T || !C || !LI || !M || !QS) return;

  const SEED = [
    { id: "cat-ap", sku: "HW-AP-WIFI6", manufacturer_part_number: "MR46", description: "Meraki MR46 Wi-Fi 6 access point", category: "hardware", default_kind: "one_time", unit_cost_cents: 95000, default_markup_bp: 2400 },
    { id: "cat-fiber", sku: "INT-FIB500", manufacturer_part_number: "FIB500", description: "Business Fibre 500/500 Mbps circuit", category: "internet", default_kind: "mrr", unit_cost_cents: 95000, default_markup_bp: 3500 },
    { id: "cat-seat", sku: "VOIP-SEAT", manufacturer_part_number: "SEAT", description: "Hosted PBX seat", category: "voip", default_kind: "mrr", unit_cost_cents: 1200, default_markup_bp: 4500 }
  ];

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function codes(violations) {
    return violations.map(v => v.code).sort().join(",");
  }

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => {
        const f = files.get(name);
        return f ? f.text : null;
      },
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

  function makeEnv() {
    const kvStore = new Map();
    const files = new Map();
    const store = QS.create({ ns: "cat" + QS.randHex(6), kv: makeKv(kvStore), editable: makeEditable(files), modules: ["catalog_items"] });
    const svc = C.createService({ store });
    return { store, files, svc };
  }

  T.register("catalog: the model declares its fields and fills defaults without mutation", () => {
    const bad = [];
    ["sku", "manufacturer_part_number", "description", "category", "default_kind", "unit_cost_cents", "default_markup_bp", "currency", "content_provider", "content_ref", "active"].forEach(f => {
      if (C.MODEL_FIELD_NAMES.indexOf(f) === -1) bad.push("missing field " + f);
    });
    const input = { description: "Managed switch" };
    const item = C.normalize(input, { id: "cat-1" });
    if (item.id !== "cat-1") bad.push("id");
    if (item.category !== "other") bad.push("category default: " + item.category);
    if (item.default_kind !== "one_time") bad.push("kind default");
    if (item.unit_cost_cents !== 0 || item.default_markup_bp !== 0) bad.push("cents defaults");
    if (item.currency !== "CAD") bad.push("currency");
    if (item.content_provider !== "none") bad.push("provider default: " + item.content_provider);
    if (item.content_ref !== null) bad.push("content_ref default");
    if (item.active !== true) bad.push("active default");
    if (input.category !== undefined) bad.push("normalize mutated input");
    const e1 = throws(() => C.normalize({}), "bad_description");
    if (e1) bad.push("missing description: " + e1);
    const e2 = throws(() => C.normalize({ description: "x", default_kind: "annual" }), "bad_default_kind");
    if (e2) bad.push("bad kind: " + e2);
    const e3 = throws(() => C.normalize({ description: "x", unit_cost_cents: 1.5 }), "fractional_cents");
    if (e3) bad.push("fractional cost: " + e3);
    const e4 = throws(() => C.normalize({ description: "x", default_markup_bp: 12.5 }), "bad_default_markup_bp");
    if (e4) bad.push("fractional markup: " + e4);
    const v = C.validate({ default_kind: "mrr" });
    if (v.ok) bad.push("validate accepted an item with no description");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "full field set declared; defaults filled; bad description/kind/fractional cents refused" };
  });

  T.register("catalog: default sell price is cost + markup, exact integer cents", () => {
    const bad = [];
    const item = C.normalize({ description: "AP", unit_cost_cents: 95000, default_markup_bp: 2400 }, { id: "c1" });
    if (C.sellPriceCents(item) !== 117800) bad.push("sell=" + C.sellPriceCents(item));
    if (C.sellPriceCents(item, { default_markup_bp: 0 }) !== 95000) bad.push("zero markup");
    if (C.sellPriceCents(item, { unit_cost_cents: 10000, default_markup_bp: 3500 }) !== 13500) bad.push("override");
    const neg = C.normalize({ description: "clearance", unit_cost_cents: 10000, default_markup_bp: -2000 }, { id: "c2" });
    if (C.sellPriceCents(neg) !== 8000) bad.push("negative markup (discount)=" + C.sellPriceCents(neg));
    const exact = C.sellPriceCents(C.normalize({ description: "x", unit_cost_cents: 3333, default_markup_bp: 3333 }, { id: "c3" }));
    if (!Number.isSafeInteger(exact)) bad.push("non-integer sell");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "cost + basis-point markup exact; discounts and zero markup handled" };
  });

  T.register("catalog: search matches sku, MPN, description and category", () => {
    const items = SEED.map(s => C.normalize(s));
    const bad = [];
    if (C.search(items, "mr46").length !== 1) bad.push("mpn search");
    if (C.search(items, "HW-AP").length !== 1) bad.push("sku search");
    if (C.search(items, "fibre 500").length !== 1) bad.push("multi-term description search");
    if (C.search(items, "hosted").length !== 1) bad.push("description search");
    if (C.search(items, "hardware").length !== 1) bad.push("category search");
    if (C.search(items, "zzz").length !== 0) bad.push("non-match");
    if (C.search(items, "").length !== 3) bad.push("empty query matches all");
    if (C.search(items, "", { category: "voip" }).length !== 1) bad.push("category filter");
    if (C.search(items, "", { kind: "mrr" }).length !== 2) bad.push("kind filter");
    const inactive = items.concat([C.normalize({ id: "cat-off", description: "Retired router", active: false })]);
    if (C.search(inactive, "retired").length !== 0) bad.push("inactive offered by default");
    if (C.search(inactive, "retired", { includeInactive: true }).length !== 1) bad.push("includeInactive");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "whitespace terms AND across sku/mpn/description/category; filters + inactive handling" };
  });

  T.register("catalog: add-to-quote builds a valid line item with pricing provenance", () => {
    const item = C.normalize(SEED[0]);
    const bad = [];
    const built = C.buildLineItem(item, { quantity: 2 });
    if (!built.ok) return { pass: false, detail: JSON.stringify(built) };
    const line = built.line;
    if (line.kind !== "one_time") bad.push("kind");
    if (line.description !== item.description) bad.push("description");
    if (line.manufacturer_part_number !== "MR46" || line.sku !== "HW-AP-WIFI6") bad.push("sku/mpn");
    if (line.quantity !== 2) bad.push("quantity");
    if (line.unit_cost_cents !== 95000) bad.push("cost");
    if (line.unit_sell_cents !== 117800) bad.push("sell=" + line.unit_sell_cents);
    if (line.catalog_ref !== "cat-ap") bad.push("catalog_ref");
    if (line.pricing_mode !== "manual" || line.price_snapshot_ref !== null) bad.push("manual pricing");
    const snapped = C.buildLineItem(item, { price_snapshot_ref: "snap-9" });
    if (!snapped.ok || snapped.line.pricing_mode !== "snapshot" || snapped.line.price_snapshot_ref !== "snap-9") bad.push("snapshot pricing: " + JSON.stringify(snapped.line));
    const asOption = C.buildLineItem(item, { optional: true, option_group_id: "g1", selected_by_default: true });
    if (!asOption.ok || asOption.line.optional !== true || asOption.line.option_group_id !== "g1") bad.push("option flags");
    const input = C.toLineItemInput(item, {});
    if (input.unit_cost_cents !== 95000 || input.unit_sell_cents !== 117800) bad.push("toLineItemInput");
    const fv = LI.validate(built.line);
    if (!fv.ok) bad.push("built line failed line-item validation: " + JSON.stringify(fv.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "catalog item → validated line with catalog_ref, derived sell, manual/snapshot provenance and option flags" };
  });

  T.register("catalog: content providers are pluggable and default to none", async () => {
    const bad = [];
    if (C.listProviders().filter(p => p.name === "none").length !== 1) bad.push("default provider missing");
    const none = await C.resolveContent(C.normalize({ description: "x" }));
    if (!none.ok || none.content !== null || none.provider !== "none") bad.push("none: " + JSON.stringify(none));
    C.registerProvider("acme", async ({ item, ref }) => ({ title: item.description, image: "https://x/" + ref }));
    const item = C.normalize({ description: "Switch", content_provider: "acme", content_ref: "abc" });
    const enriched = await C.resolveContent(item);
    if (!enriched.ok || enriched.content.title !== "Switch" || enriched.content.image !== "https://x/abc") bad.push("enrich: " + JSON.stringify(enriched));
    const missing = await C.resolveContent(C.normalize({ description: "x", content_provider: "ghost" }));
    if (missing.ok || missing.code !== "provider_not_found") bad.push("unknown provider: " + JSON.stringify(missing));
    C.registerProvider("boom", () => { throw new Error("nope"); });
    const err = await C.resolveContent(C.normalize({ description: "x", content_provider: "boom" }));
    if (err.ok || err.code !== "provider_error") bad.push("provider error: " + JSON.stringify(err));
    if (C.listProviders().filter(p => p.name === "acme").length !== 1) bad.push("registered provider not listed");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "none resolves null; a registered provider enriches; unknown/throwing providers refused cleanly" };
  });

  T.register("catalog: the service seeds once, then reads, searches, upserts and removes", async () => {
    const env = makeEnv();
    const bad = [];
    const first = await env.svc.seedIfEmpty(SEED);
    if (!first.ok || first.seeded !== 3) return { pass: false, detail: "seed: " + JSON.stringify(first) };
    const second = await env.svc.seedIfEmpty(SEED);
    if (!second.ok || second.seeded !== 0) bad.push("second seed not idempotent: " + JSON.stringify(second));
    const all = await env.svc.list();
    if (!all.ok || all.items.length !== 3) bad.push("list: " + JSON.stringify(all.items && all.items.length));
    const got = await env.svc.get("cat-fiber");
    if (!got.ok || !got.item || got.item.default_kind !== "mrr") bad.push("get");
    const found = await env.svc.search("hosted");
    if (!found.ok || found.items.length !== 1 || found.items[0].id !== "cat-seat") bad.push("search");
    const up = await env.svc.upsert({ id: "cat-new", sku: "HW-RTR", description: "Security router", category: "hardware", unit_cost_cents: 42000, default_markup_bp: 2600 });
    if (!up.ok || !up.item || up.item.id !== "cat-new") bad.push("upsert: " + JSON.stringify(up));
    const reread = await env.svc.get("cat-new");
    if (!reread.ok || !reread.item) bad.push("upserted item not persisted");
    if (C.sellPriceCents(reread.item) !== 52920) bad.push("sell after upsert: " + C.sellPriceCents(reread.item));
    const badItem = await env.svc.upsert({ description: "" });
    if (badItem.ok || badItem.code !== "bad_description") bad.push("invalid upsert accepted: " + JSON.stringify(badItem));
    const removed = await env.svc.remove("cat-new");
    if (!removed.ok) bad.push("remove: " + JSON.stringify(removed));
    const gone = await env.svc.get("cat-new");
    if (!gone.ok || gone.item !== null) bad.push("removed item still present");
    const missing = await env.svc.remove("cat-new");
    if (missing.ok || missing.code !== "catalog_item_not_found") bad.push("removing a missing item: " + JSON.stringify(missing));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "seed once (idempotent), list/get/search, upsert + re-read, invalid refused, remove + not-found" };
  });

  T.register("catalog: seed ids are stable and derived from the item", () => {
    const bad = [];
    if (C.seedIdFor({ sku: "INT-FIB500" }) !== "cat-int-fib500") bad.push("sku slug: " + C.seedIdFor({ sku: "INT-FIB500" }));
    if (C.seedIdFor({ manufacturer_part_number: "MR 46" }) !== "cat-mr-46") bad.push("mpn slug");
    if (C.seedIdFor({ description: "Hosted PBX Seat" }) !== "cat-hosted-pbx-seat") bad.push("description slug");
    if (C.seedIdFor({}, 3) !== "cat-item-3") bad.push("fallback: " + C.seedIdFor({}, 3));
    if (C.seedIdFor({ sku: "INT-FIB500" }) !== C.seedIdFor({ sku: "INT-FIB500" })) bad.push("not deterministic");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "seed ids are deterministic slugs (sku → mpn → description), stable across runs" };
  });

  T.register("catalog: seed → read back through the real workspace store (live)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "cat" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.createDefault({ ns, modules: ["catalog_items"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const svc = C.createService({ store });
    const res = await svc.seedIfEmpty(SEED);
    if (res.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (res.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live catalog check skipped" };
    if (!res.ok) return { pass: false, detail: "seed failed: " + JSON.stringify(res) };
    const back = await svc.list();
    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    if (!back.ok || back.items.length !== SEED.length) return { pass: false, detail: "catalog not readable back" };
    return { pass: true, detail: "seeded " + back.items.length + " catalog items on the canonical store and read them back" };
  });
})();
