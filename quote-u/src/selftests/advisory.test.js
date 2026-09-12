(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const AD = window.QU_ADVISORY;
  if (!T || !QS || !AD) return;

  const REP_MAILBOX = "alex.rivera@example.com";

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

  function codes(result) { return result.advisories.map(a => a.code).sort().join(","); }

  const NOW = Date.parse("2026-01-01T00:00:00Z");
  const LINES = [
    { id: "l1", kind: "one_time", description: "", quantity: 1, unit_sell_cents: 100, unit_cost_cents: 0, manufacturer_part_number: "", sku: "", optional: false },
    { id: "l2", kind: "one_time", description: "Widget", quantity: 0, unit_sell_cents: 100, unit_cost_cents: 500, manufacturer_part_number: "W1" },
    { id: "l3", kind: "mrr", description: "Support", quantity: 1, unit_sell_cents: 0, unit_cost_cents: 500, manufacturer_part_number: "S1", optional: true, selected_by_default: true },
    { id: "l4", kind: "one_time", description: "Snap", quantity: 1, unit_sell_cents: 100, unit_cost_cents: 500, manufacturer_part_number: "P1", price_snapshot_ref: "snap1" }
  ];
  const SNAPSHOTS = { snap1: { captured_at: "2020-01-01T00:00:00Z" } };

  T.register("advisory: each completeness problem is detected and reported with a severity", () => {
    const res = AD.check({ line_items: LINES, snapshots: SNAPSHOTS, stale_cost_days: 7, now: NOW });
    const bad = [];
    const c = codes(res);
    ["missing_description", "missing_part_number", "zero_quantity", "unpriced_optional", "missing_cost", "stale_cost"].forEach(code => {
      if (c.indexOf(code) === -1) bad.push("missing advisory: " + code + " (got " + c + ")");
    });
    if (res.blocking !== false) bad.push("advisories must never block");
    if (res.ok !== false) bad.push("a problem-laden quote reported ok");
    const l1 = res.advisories.find(a => a.line_id === "l1" && a.code === "missing_description");
    if (!l1 || l1.severity !== "warn") bad.push("missing_description severity/line not reported");
    const l4 = res.advisories.find(a => a.code === "stale_cost");
    if (!l4 || l4.line_id !== "l4") bad.push("stale_cost not tied to the snapshot line");
    if (l4 && !(l4.age_days > 2000)) bad.push("stale age: " + (l4 && l4.age_days));
    if (res.counts.missing_description !== 1) bad.push("counts.missing_description: " + res.counts.missing_description);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "missing description/part number, zero quantity, unpriced optional, missing cost and stale cost are all detected with severities" };
  });

  T.register("advisory: checks are advisory — never blocking — and produce a readable summary", () => {
    const bad = [];
    const res = AD.check({ line_items: LINES, snapshots: SNAPSHOTS, now: NOW });
    if (res.blocking !== false) bad.push("blocking must always be false");
    if (res.advisory_count < 5) bad.push("advisory_count: " + res.advisory_count);
    const summary = AD.summarize(res);
    if (!summary || summary === "No concerns found.") bad.push("summary: " + summary);
    const clean = AD.check({ line_items: [{ id: "x", kind: "one_time", description: "Fine", quantity: 1, unit_sell_cents: 100, unit_cost_cents: 50, manufacturer_part_number: "M1" }], now: NOW });
    if (!clean.ok || clean.advisory_count !== 0) bad.push("a clean quote was flagged: " + JSON.stringify(clean.advisories));
    if (AD.summarize(clean) !== "No concerns found.") bad.push("clean summary: " + AD.summarize(clean));
    const empty = AD.check({ line_items: [] });
    if (!empty.ok || empty.blocking !== false) bad.push("an empty check must be clean and non-blocking");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "advisories never block; a clean quote reports no concerns; summarize() renders a readable line" };
  });

  T.register("advisory: send preflight surfaces advisories without blocking (live)", async () => {
    const ns = "adv" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const advisory = AD.createService({ policy: { stale_cost_days: 7 } });
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, advisory, policy: { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX }, generatorName: "quote-u" });
    const bad = [];

    const created = await quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Advisory test", scope: "*" });
    const v = await versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    await versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 1, unit_cost_cents: 0, unit_sell_cents: 30000 });

    const pre = await send.preflight(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    if (!pre.ok) return { pass: false, detail: "preflight should pass (advisories never block): " + JSON.stringify(pre) };
    if (!pre.advisories || !pre.advisories.length) bad.push("no advisories reported although the line has no cost/part number");
    const pc = (pre.advisories || []).map(a => a.code).sort().join(",");
    if (pc.indexOf("missing_part_number") === -1) bad.push("missing_part_number not reported: " + pc);
    if (pc.indexOf("missing_cost") === -1) bad.push("missing_cost not reported: " + pc);
    if (!pre.warnings.some(w => w.code === "advisories")) bad.push("no advisory warning attached to preflight");
    if (pre.blockers.length) bad.push("advisories added a blocker: " + JSON.stringify(pre.blockers));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "preflight reports advisory findings (missing cost/part number) as warnings while still allowing the send" };
  });
})();
