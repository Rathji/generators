(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const P = window.QU_PROSPECT;
  if (!T || !QS || !P) return;

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

  function makeStore(prefix) {
    return QS.create({ ns: prefix + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function makeEnv() {
    const store = makeStore("prs");
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const artifacts = window.QU_ARTIFACTS.createService({ store });
    const prospect = P.createService({ quotes, versions, artifacts, audit });
    return { store, audit, gateway, quotes, versions, artifacts, prospect };
  }

  T.register("prospect mode: bespoke lines and template lines are derived purely", () => {
    const bad = [];
    const b = P.bespokeInput({ description: "Custom rack", kind: "mrr", quantity: 2, unit_sell_cents: 20000, unit_cost_cents: 12000, term_months: 24, something: "kept" }, {});
    if (b.bespoke !== true) bad.push("bespoke flag");
    if (b.kind !== "mrr") bad.push("kind: " + b.kind);
    if (b.quantity !== 2) bad.push("quantity");
    if (b.unit_sell_cents !== 20000) bad.push("sell");
    if (b.term_months !== 24) bad.push("term");
    if (b.section !== "Bespoke") bad.push("default section: " + b.section);
    const nullIn = P.bespokeInput({ description: "x", quantity: "3", unit_sell_cents: "100", term_months: -1 });
    if (nullIn.quantity !== 1) bad.push("bad quantity should default to 1");
    if (nullIn.unit_sell_cents !== 0) bad.push("bad sell should default to 0");
    if (nullIn.term_months !== null) bad.push("negative term should be null");
    if (P.bespokeInput(null) !== null) bad.push("a null input should stay null");

    const artifact = { id: "art-1", view: { lines: [
      { description: "Router", kind: "one_time", quantity: 1, unit_sell_cents: 15000, section: "HW", manufacturer_part_number: "R1" },
      { description: "Support", kind: "mrr", quantity: 1, unit_sell_cents: 5000 }
    ] } };
    const t = P.templateLines(artifact);
    if (t.length !== 2) bad.push("template line count: " + t.length);
    if (!t.every(x => x.bespoke === true)) bad.push("template lines are not marked bespoke");
    if (!t.every(x => x.template_ref === "art-1")) bad.push("template_ref not set");
    if (t[0].unit_sell_cents !== 15000 || t[1].kind !== "mrr") bad.push("template fields not carried");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "bespoke input is normalized + tagged; an artifact's client-safe lines become bound bespoke template lines" };
  });

  T.register("prospect mode: create a prospect and add bespoke lines", async () => {
    const env = makeEnv();
    const bad = [];
    const created = await env.prospect.createProspect({ company_id: "c1", contact_id: "ct1", title: "Early prospect", scope: "*" });
    if (!created.ok) return { pass: false, detail: "createProspect failed: " + JSON.stringify(created) };
    if (created.quote.mode !== "prospect") bad.push("quote mode: " + created.quote.mode);
    if (!P.isProspect(created.quote)) bad.push("isProspect false");
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    const add = await env.prospect.addBespoke(v.version.id, { kind: "one_time", description: "Custom rack", quantity: 2, unit_cost_cents: 10000, unit_sell_cents: 20000 });
    if (!add.ok) bad.push("addBespoke failed: " + JSON.stringify(add));
    else {
      if (add.line.bespoke !== true) bad.push("stored bespoke flag");
      if (add.line.quantity !== 2 || add.line.unit_sell_cents !== 20000) bad.push("stored bespoke line values");
    }
    const noDesc = await env.prospect.addBespoke(v.version.id, { description: "" });
    if (noDesc.ok || noDesc.code !== "bad_description") bad.push("a descriptionless bespoke line was accepted: " + JSON.stringify(noDesc));
    const lines = await env.versions.listLines(v.version.id);
    if (!lines.ok || lines.lines.length !== 1) bad.push("stored line count: " + (lines.ok && lines.lines.length));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a prospect quote is created in prospect mode and accepts normalized bespoke lines (a blank description is refused)" };
  });

  T.register("prospect mode: bind an accepted artifact as a template, then promote the prospect", async () => {
    const env = makeEnv();
    const bad = [];
    // An accepted artifact to use as the template.
    const srcQuote = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Source", scope: "*" });
    const srcV = await env.versions.createVersion({ quote_id: srcQuote.quote.id, quote_number: srcQuote.quote.quote_number, title: srcQuote.quote.title });
    const rec = await env.artifacts.record({
      version: { id: srcV.version.id, frozen_seal: "seal-src", quote_id: srcQuote.quote.id },
      quote: srcQuote.quote,
      approval: { approver_name: "Dana", approved_at: "2026-01-01T00:00:00Z", one_time_cents: 15000, mrr_cents: 0, twelve_month_value_cents: 15000, currency: "CAD" },
      totals: { one_time_cents: 15000, mrr_cents: 0, twelve_month_value_cents: 15000, deal_value_cents: 15000, currency: "CAD" },
      selection: [],
      view: { lines: [{ description: "Router", kind: "one_time", quantity: 1, unit_sell_cents: 15000, manufacturer_part_number: "R1" }] },
      approved_at: "2026-01-01T00:00:00Z"
    });
    if (!rec.ok) return { pass: false, detail: "artifact seed failed: " + JSON.stringify(rec) };

    const created = await env.prospect.createProspect({ company_id: "c1", contact_id: "ct1", title: "From template", scope: "*" });
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    const bound = await env.prospect.bindTemplate(v.version.id, rec.artifact.id, { quote_id: created.quote.id, actor: "tester" });
    if (!bound.ok) bad.push("bindTemplate failed: " + JSON.stringify(bound));
    else {
      if (bound.line_count !== 1) bad.push("bound line count: " + bound.line_count);
      if (bound.lines[0].template_ref !== rec.artifact.id) bad.push("template_ref not set on the bound line");
      if (bound.lines[0].bespoke !== true) bad.push("bound line not marked bespoke");
    }
    const again = await env.prospect.bindTemplate(v.version.id, rec.artifact.id);
    if (!again.ok || !again.deduped) bad.push("a repeated bind was not deduped: " + JSON.stringify(again));

    const prom = await env.prospect.promote(created.quote.id, { actor: "tester" });
    if (!prom.ok) bad.push("promote failed: " + JSON.stringify(prom));
    else if (prom.quote.mode !== "quote") bad.push("promoted mode: " + prom.quote.mode);
    const q = await env.quotes.getQuote(created.quote.id, { scope: "*" });
    if (!q.ok || q.quote.mode !== "quote") bad.push("the stored quote is not a normal quote after promotion");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "an accepted artifact binds as a template once (idempotent), its lines become bespoke lines, and the prospect promotes to a normal quote" };
  });
})();
