(function () {
  const T = window.QU_SELFTEST;
  const FM = window.QU_FIELDMAPS;
  const D = window.QU_DISTRIBUTORS;
  if (!T || !FM || !D) return;

  T.register("fieldmaps: a mapping is declared from the shared SCHEMA (so map and parser cannot drift) and requires a wire name for every field", () => {
    const bad = [];
    const map = FM.declareFromSchema(D.SCHEMA, { connector: "distributor_a", fn: "searchCatalog" });
    if (map.id !== "distributor_a.searchCatalog.in") bad.push("id: " + map.id);
    if (map.fields.length !== D.SCHEMA.length) bad.push("field count: " + map.fields.length + " vs " + D.SCHEMA.length);
    const cost = map.fields.find(f => f.canonical === "unit_cost_cents");
    if (!cost) bad.push("no unit_cost_cents field");
    else {
      if (cost.wire.indexOf("cost") === -1) bad.push("a money field should carry its major-unit alias");
      if (cost.wire.indexOf("unit_cost_cents") === -1) bad.push("a money field should carry its cents alias");
    }
    const man = map.fields.find(f => f.canonical === "manufacturer_part_number");
    if (!man || man.wire.indexOf("mpn") === -1 || man.wire.indexOf("part_number") === -1) bad.push("mpn aliases missing");
    let threw = false;
    try { FM.declare({ id: "x.in", fields: [] }); } catch (e) { threw = e.code === "bad_mapping"; }
    if (!threw) bad.push("a mapping with no fields must be refused");
    threw = false;
    try { FM.declare({ id: "x.in", fields: [{ canonical: "a", wire: [] }] }); } catch (e) { threw = e.code === "bad_field"; }
    if (!threw) bad.push("a field with no wire name must be refused");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one declaration derived from the shared SCHEMA carries every wire alias the parser knows, and an empty mapping or a wire-less field is refused" };
  });

  T.register("fieldmaps: a mapping may not be enabled until it is verified against a captured payload, and a capture that is missing a declared field fails the proof", () => {
    const bad = [];
    const reg = FM.createRegistry();
    const a = reg.add(FM.declareFromSchema(D.SCHEMA, { connector: "distributor_a", fn: "searchCatalog" }));
    const b = reg.add(FM.declareFromSchema(D.SCHEMA, { connector: "distributor_b", fn: "getPrice" }));

    if (reg.isVerified(a.id)) bad.push("nothing is verified before a capture");
    if (reg.enablement().ok) bad.push("enablement must be blocked while unverified");
    const gated = reg.assertVerified(a.id);
    if (gated.ok || gated.code !== "mapping_not_verified") bad.push("assertVerified: " + JSON.stringify(gated));

    // Distributor A's captured wire shape.
    const captureA = { source: "dist-a", sku: "SKU-1", mpn: "MR46", desc: "AP", cost: 950, on_hand: 4, whse: "TOR", cur: "CAD" };
    const vA = reg.verifyCapture(a.id, captureA, { payload_ref: "capture:dist-a:2026-09-12", captured_at: "2026-09-12T00:00:00Z" });
    if (!vA.ok) bad.push("capture A should verify: " + (vA.detail || JSON.stringify(vA)));
    if (!vA.verified || !vA.verified.by_capture || vA.verified.payload_ref !== "capture:dist-a:2026-09-12") bad.push("evidence not recorded: " + JSON.stringify(vA.verified));
    if (!reg.isVerified(a.id)) bad.push("a should be verified now");
    if (!reg.assertVerified(a.id).ok) bad.push("assertVerified should pass after the capture");

    // Distributor B's captured wire shape verifies the SAME declaration.
    const captureB = { distributor: "dist-b", vendor_sku: "V-9", part_number: "MR46", title: "AP", net: "9.50", qty: 2, location: "MISS", currency: "USD" };
    const vB = reg.verifyCapture(b.id, captureB, { source: "capture:dist-b" });
    if (!vB.ok) bad.push("capture B should verify: " + (vB.detail || JSON.stringify(vB)));

    // A capture missing a required field fails, and names it.
    const missing = reg.verifyCapture(b.id, { vendor_sku: "V-9" }, { source: "capture:bad" });
    if (missing.ok || missing.code !== "capture_mismatch") bad.push("a bad capture must fail: " + JSON.stringify(missing));
    if (!missing.missing.some(m => m.canonical === "source") || !missing.missing.some(m => m.canonical === "unit_cost_cents")) bad.push("missing must name source and unit_cost_cents: " + JSON.stringify(missing.missing));
    if (!missing.missing.every(m => m.required)) bad.push("only required fields are hard-missing by default");

    const en = reg.enablement();
    if (!en.ok || en.total !== 2 || en.blocked.length !== 0) bad.push("enablement after both verified: " + JSON.stringify(en));
    if (!reg.verify().ok) bad.push("verify: " + JSON.stringify(reg.verify().violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "an unverified map cannot be enabled, both distributor wire shapes verify the one schema-derived declaration against a captured payload with recorded evidence, and a capture missing a required field fails with the field named" };
  });
})();
