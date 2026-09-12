(function () {
  const T = window.QU_SELFTEST;
  const D = window.QU_DISTRIBUTORS;
  const A = window.QU_DISTRIBUTORA;
  const B = window.QU_DISTRIBUTORB;
  const G = window.QU_CONNECTORS;
  if (!T || !D || !A || !B || !G) return;

  const ISO = "2026-01-01T00:00:00.000Z";
  const CANON = D.RECORD_FIELDS.slice().sort().join(",");

  function wireA(over) {
    return Object.assign({ sku: "RX-MR46", mpn: "MR46", upc: "012345678901", desc: "Meraki MR46 cloud-managed access point", cat: "wireless", cost: "412.50", list: "599.00", on_hand: 12, whse: "YYZ", cur: "CAD" }, over || {});
  }
  function wireB(over) {
    return Object.assign({ vendor_sku: "HL-MR46", part_number: "MR46", upc: "012345678901", title: "Meraki MR46 cloud-managed access point", group: "wireless", net: 405, msrp: 599, qty: 6, location: "YVR", currency: "CAD" }, over || {});
  }

  T.register("distributor schema: one alias index turns any source's wire shape into the one canonical record", () => {
    const bad = [];

    // The schema declares exactly the canonical record's fields.
    const fields = D.SCHEMA.map(s => s.field).sort().join(",");
    if (fields !== CANON) bad.push("schema fields: " + fields);
    if (!D.FIELD_ALIASES || !D.FIELD_ALIASES.unit_cost_cents) bad.push("FIELD_ALIASES missing");

    // Alias resolution is case- and separator-insensitive, across both sources.
    const cases = [
      ["vendor_sku", "distributor_sku"], ["ManufacturerPartNumber", "manufacturer_part_number"],
      ["part_number", "manufacturer_part_number"], ["net", "unit_cost_cents"], ["cost", "unit_cost_cents"],
      ["msrp", "list_price_cents"], ["on_hand", "quantity_available"], ["qty", "quantity_available"],
      ["whse", "warehouse"], ["location", "warehouse"], ["title", "description"], ["group", "category"], ["cur", "currency"]
    ];
    cases.forEach(c => {
      const s = D.resolveField(c[0]);
      if (!s || s.field !== c[1]) bad.push("resolveField(" + c[0] + ") = " + (s && s.field));
    });
    const al = D.aliasFor("unit_cost_cents") || [];
    if (al.indexOf("cost") === -1 || al.indexOf("net") === -1) bad.push("unit_cost aliases: " + al.join("|"));

    // Two completely different wire shapes land on the SAME canonical record.
    const ra = D.normalizeWire(wireA(), { source: A.SOURCE, captured_at: ISO, raw: wireA() });
    const rb = D.normalizeWire(wireB(), { source: B.SOURCE, captured_at: ISO, raw: wireB() });
    if (ra.unit_cost_cents !== 41250 || ra.list_price_cents !== 59900) bad.push("A cents: " + ra.unit_cost_cents + "/" + ra.list_price_cents);
    if (rb.unit_cost_cents !== 40500 || rb.list_price_cents !== 59900) bad.push("B cents: " + rb.unit_cost_cents + "/" + rb.list_price_cents);
    const keysA = Object.keys(ra).sort().join(",");
    const keysB = Object.keys(rb).sort().join(",");
    if (keysA !== CANON) bad.push("A record keys: " + keysA);
    if (keysB !== CANON) bad.push("B record keys: " + keysB);
    if (ra.source !== A.SOURCE || rb.source !== B.SOURCE) bad.push("sources: " + ra.source + "/" + rb.source);
    if (ra.currency !== "CAD" || rb.currency !== "CAD") bad.push("currency");
    if (ra.quantity_available !== 12 || rb.quantity_available !== 6) bad.push("qty");
    if (ra.warehouse !== "YYZ" || rb.warehouse !== "YVR") bad.push("warehouse");
    if (!ra.raw_response || !rb.raw_response) bad.push("raw payloads not preserved");
    if (ra.captured_at !== ISO || rb.captured_at !== ISO) bad.push("captured_at override");

    // An explicit integer-cents alias wins as-is (no double conversion).
    const rc = D.normalizeWire({ source: "x", sku: "S1", cost_cents: 41250, list_cents: 59900, on_hand: "3" }, {});
    if (rc.unit_cost_cents !== 41250 || rc.list_price_cents !== 59900) bad.push("cents alias: " + rc.unit_cost_cents + "/" + rc.list_price_cents);
    if (rc.quantity_available !== 3) bad.push("string qty: " + rc.quantity_available);

    // Unknown wire keys are dropped, and strict mode refuses them.
    const dropped = D.normalizeWire({ source: "x", sku: "S1", cost: 1, secret: "nope" }, {});
    if ("secret" in dropped) bad.push("an unknown wire key leaked onto the record");
    let strict = null;
    try { D.normalizeWire({ source: "x", sku: "S1", cost: 1, secret: "nope" }, { strict: true }); } catch (e) { strict = e; }
    if (!strict || strict.code !== "unknown_fields") bad.push("strict mode should refuse unknown fields: " + (strict && strict.code));

    // validateRecord proves the exact shape; toDisplay is the camelCase view.
    if (!D.validateRecord(ra).ok) bad.push("a canonical record failed validation: " + JSON.stringify(D.validateRecord(ra).violations));
    const stray = Object.assign({}, ra, { margin_cents: 100 });
    if (D.validateRecord(stray).ok) bad.push("a stray field should fail validation");
    const missing = Object.assign({}, ra); delete missing.upc;
    if (D.validateRecord(missing).ok) bad.push("a missing field should fail validation");
    const disp = D.toDisplay(ra);
    if (disp.unitCost !== 41250 || disp.listPrice !== 59900 || disp.mfrPartNumber !== "MR46" || disp.quantityAvailable !== 12 || disp.distributorSku !== "RX-MR46") {
      bad.push("toDisplay: " + JSON.stringify(disp));
    }
    let threw = null;
    try { D.toDisplay(stray); } catch (e) { threw = e; }
    if (!threw || threw.code !== "extra_field") bad.push("toDisplay should refuse a stray field: " + (threw && threw.code));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the shared schema resolves A's and B's aliases (case/separator-insensitive) to the SAME 13-field canonical record with exact integer cents, cents-aliases used as-is, unknown keys dropped (refused in strict mode), and validateRecord/toDisplay proving the shape" };
  });

  T.register("distributor parts: offers group across sources by UPC/MPN/SKU, cheapest and in-stock first", () => {
    const bad = [];
    const a = D.normalizeWire(wireA(), { source: A.SOURCE, captured_at: ISO });
    const b = D.normalizeWire(wireB(), { source: B.SOURCE, captured_at: ISO });
    const a2 = D.normalizeWire(wireA({ sku: "RX-MR56", mpn: "MR56", upc: "012345678902", desc: "Meraki MR56 cloud-managed access point", cost: "655.00", list: "899.00", on_hand: 4 }), { source: A.SOURCE, captured_at: ISO });

    if (D.partKey(a) !== "upc:012345678901") bad.push("partKey: " + D.partKey(a));
    if (D.partKey(a) !== D.partKey(b)) bad.push("a shared UPC did not group: " + D.partKey(a) + " vs " + D.partKey(b));
    const noUpc1 = D.normalizeWire({ sku: "X1", mpn: "MR-46", desc: "x", cost: 1 }, { source: A.SOURCE });
    const noUpc2 = D.normalizeWire({ sku: "Y1", part_number: "mr46", desc: "y", net: 2 }, { source: B.SOURCE });
    if (D.partKey(noUpc1) !== D.partKey(noUpc2)) bad.push("MPN grouping failed: " + D.partKey(noUpc1) + " vs " + D.partKey(noUpc2));
    if (D.partKey(noUpc1) !== "mpn:mr46") bad.push("MPN key: " + D.partKey(noUpc1));

    const parts = D.groupParts([a, a2, b]);
    if (parts.length !== 2) bad.push("parts: " + parts.length);
    if (parts[0].key !== "upc:012345678901") bad.push("parts should be ordered by best cost: " + parts.map(p => p.key).join(","));
    const mr46 = parts.find(p => p.key === "upc:012345678901");
    if (!mr46) bad.push("no MR46 part");
    else {
      if (mr46.offers.length !== 2) bad.push("offers: " + mr46.offers.length);
      if (mr46.offers[0].source !== B.SOURCE) bad.push("cheapest first: " + mr46.offers[0].source);
      if (mr46.offers[0].unit_cost_cents !== 40500 || mr46.offers[0].cheapest !== true) bad.push("cheapest flag/cost: " + JSON.stringify({ c: mr46.offers[0].unit_cost_cents, f: mr46.offers[0].cheapest }));
      if (mr46.offers[1].cheapest) bad.push("a non-cheapest offer was flagged");
      if (mr46.offers[0].warehouse !== "YVR" || mr46.offers[0].quantity_available !== 6 || mr46.offers[0].in_stock !== true) bad.push("B offer context: " + JSON.stringify(mr46.offers[0]));
      if (mr46.best_unit_cost_cents !== 40500) bad.push("best cost: " + mr46.best_unit_cost_cents);
      if (mr46.total_available !== 18) bad.push("total available: " + mr46.total_available);
      if (mr46.sources.length !== 2) bad.push("sources: " + mr46.sources.join(","));
    }

    // Equal cost: an in-stock source sorts before an out-of-stock one.
    if (D.compareOffers({ source: "a", unit_cost_cents: 100, in_stock: false }, { source: "b", unit_cost_cents: 100, in_stock: true }) <= 0) {
      bad.push("in-stock should sort before out-of-stock at equal cost");
    }
    // A record with no price at all sorts last (never treated as free).
    if (D.compareOffers({ source: "a", unit_cost_cents: null, in_stock: true }, { source: "b", unit_cost_cents: 999999, in_stock: false }) <= 0) {
      bad.push("a cost-less offer must not sort ahead of a priced one");
    }

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "records sharing a UPC/MPN group into one part, offers are cheapest-first (in-stock breaking ties, cost-less last) with a cheapest flag, best cost and summed availability" };
  });

  T.register("distributor service: one search fans out to every source and returns side-by-side offers", async () => {
    const bad = [];
    const gateway = G.createGateway({ connectors: {} });
    gateway.register(A.NAME, A.create());
    gateway.register(B.NAME, B.create());
    const svc = D.createService({ gateway: gateway, names: [A.NAME, B.NAME] });

    const res = await svc.searchParts("MR46");
    if (!res.ok) bad.push("search failed: " + JSON.stringify(res.errors));
    if (!res.parts || res.parts.length !== 1) bad.push("parts: " + (res.parts && res.parts.length));
    const part = res.parts[0];
    if (part.offers.length !== 2) bad.push("offers: " + part.offers.length);
    const sources = part.offers.map(o => o.source).sort().join(",");
    if (sources !== A.SOURCE + "," + B.SOURCE) bad.push("sources: " + sources);
    if (part.offers[0].source !== B.SOURCE || part.offers[0].unit_cost_cents !== 40500 || part.offers[0].cheapest !== true) {
      bad.push("cheapest offer: " + JSON.stringify({ s: part.offers[0].source, c: part.offers[0].unit_cost_cents }));
    }
    if (!part.offers.every(o => typeof o.quantity_available === "number" && typeof o.warehouse === "string" && o.record)) {
      bad.push("offers lack availability context or their record");
    }

    const all = await svc.searchParts("");
    if (all.parts.length !== 4) bad.push("all parts: " + all.parts.length);
    if (all.records.length !== 7) bad.push("all records: " + all.records.length);

    // compare() returns explicit list price, currency, stock and one cheapest flag.
    const cmp = await svc.compare("MR46", {});
    if (!cmp.ok || cmp.rows.length !== 2) bad.push("compare rows: " + (cmp.rows && cmp.rows.length));
    const rowB = cmp.rows.find(r => r.source === B.SOURCE);
    const rowA = cmp.rows.find(r => r.source === A.SOURCE);
    if (!rowB || !rowA) bad.push("compare missing a source");
    else {
      if (rowB.unit_cost_cents !== 40500 || rowB.list_price_cents !== 59900) bad.push("B row money: " + JSON.stringify(rowB));
      if (rowB.in_stock !== true || rowB.quantity_available !== 6 || rowB.warehouse !== "YVR") bad.push("B row stock: " + JSON.stringify(rowB));
      if (rowB.cheapest !== true) bad.push("B row should be cheapest");
      if (rowA.cheapest) bad.push("A row should not be cheapest");
      if (rowA.currency !== "CAD") bad.push("row currency: " + rowA.currency);
      const cheapestRows = cmp.rows.filter(r => r.cheapest);
      if (cheapestRows.length !== 1) bad.push("exactly one row must be cheapest: " + cheapestRows.length);
      if (!cmp.best || cmp.best.source !== B.SOURCE) bad.push("best record: " + (cmp.best && cmp.best.source));
    }

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one searchParts call reads both connectors, groups by UPC and returns MR46's two offers side by side (B cheapest at 40500c), and compare() exposes list price, currency, stock, warehouse and a single cheapest flag" };
  });
})();
