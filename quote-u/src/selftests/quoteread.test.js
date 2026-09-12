(function () {
  const T = window.QU_SELFTEST;
  const QR = window.QU_QUOTEREAD;
  const QS = window.QU_STORE;
  if (!T || !QR || !QS) return;

  function makeKv(kvStore) {
    return { get: async k => kvStore.get(k), set: async (k, v) => { kvStore.set(k, v); }, delete: async k => { kvStore.delete(k); } };
  }
  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) { f = { text, key: "ek." + name, count: 0 }; files.set(name, f); f.count = 1; return { error: null, editKey: f.key, editCount: 1, created: true }; }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text; f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  const QUOTES = [
    { id: "q1", quote_number: "QU-2026-0001", title: "Acme network refresh", company_id: "c1", company_name: "Acme Ltd", contact_id: "k1", contact_name: "Dana", opportunity_id: "o1", opportunity_name: "Refresh", mode: "quote", status: "sent", created_at: "2026-01-05T00:00:00Z", created_by: "alice" },
    { id: "q2", quote_number: "QU-2026-0002", title: "Globex phones", company_id: "c2", company_name: "Globex", contact_id: "k2", contact_name: "Sam", mode: "prospect", status: "draft", created_at: "2026-02-01T00:00:00Z", created_by: "bob" }
  ];
  const VERSIONS = [
    { id: "v1", quote_id: "q1", version_number: 1, state: "approved", created_at: "2026-01-05T00:00:00Z" },
    { id: "v2", quote_id: "q1", version_number: 2, state: "sent", created_at: "2026-03-01T00:00:00Z" }
  ];
  const APPROVALS = [
    { id: "a1", quote_id: "q1", version_id: "v1", decision: "approved", approver_name: "Dana", approved_at: "2026-01-10T00:00:00Z", selection: ["l1"], one_time_cents: 250000, mrr_cents: 30000, twelve_month_value_cents: 610000, deal_value_cents: 610000, currency: "CAD", signature: { hash: "h" } }
  ];

  function makeService(extra) {
    return QR.createService(Object.assign({
      quotes: { listQuotes: async () => ({ ok: true, quotes: QUOTES }) },
      versions: {
        listVersions: async (qid) => ({ ok: true, versions: VERSIONS.filter(v => !qid || v.quote_id === qid) }),
        totals: async (vid) => ({ ok: true, totals: { one_time_cents: 250000, mrr_cents: 30000, twelve_month_value_cents: 610000, deal_value_cents: 610000 } })
      },
      approvals: { list: async (f) => ({ ok: true, approvals: APPROVALS.filter(a => !f || !f.quote_id || a.quote_id === f.quote_id) }) }
    }, extra || {}));
  }

  T.register("read-only API: search matches by number/title/company and respects filters", async () => {
    const svc = makeService();
    const bad = [];
    const all = await svc.search("", {});
    if (all.results.length !== 2) bad.push("all: " + all.results.length);
    const byNumber = await svc.search("QU-2026-0002", {});
    if (byNumber.results.length !== 1 || byNumber.results[0].id !== "q2") bad.push("number search");
    const byCompany = await svc.search("globex", {});
    if (byCompany.results.length !== 1 || byCompany.results[0].company_name !== "Globex") bad.push("company search");
    const byMode = await svc.search("", { mode: "prospect" });
    if (byMode.results.length !== 1 || byMode.results[0].id !== "q2") bad.push("mode filter");
    const limited = await svc.search("", { limit: 1 });
    if (limited.results.length !== 1 || limited.total !== 2) bad.push("limit/total");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "search matched by number, title and company; mode/limit filters applied" };
  });

  T.register("read-only API: getQuote returns the detail with the acceptance summary and NO cost/margin", async () => {
    const svc = makeService();
    const bad = [];
    const byId = await svc.getQuote("q1");
    const d = byId.quote;
    if (!d) return { pass: false, detail: "no detail" };
    if (d.quote.id !== "q1" || d.quote.quote_number !== "QU-2026-0001") bad.push("quote identity");
    if (d.versions.length !== 2) bad.push("versions: " + d.versions.length);
    if (d.latest_version.state !== "sent") bad.push("latest state");
    if (!d.approval || d.approval.one_time_cents !== 250000 || d.approval.approver_name !== "Dana") bad.push("approval summary");
    if (d.approval.signature_present !== true) bad.push("signature_present");
    const byNumber = await svc.getQuote("QU-2026-0001");
    if (!byNumber.quote || byNumber.quote.quote.id !== "q1") bad.push("lookup by number");
    const text = JSON.stringify(d);
    if (/unit_cost|margin/i.test(text)) bad.push("cost/margin leaked");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "detail carries versions + acceptance summary and never unit cost or margin" };
  });

  T.register("read-only API: the connector is read-only and every function is classified as a read", () => {
    const bad = [];
    const conn = QR.createConnector({ service: makeService() });
    if (conn.name !== "quoteread") bad.push("name: " + conn.name);
    if (conn.readOnly !== true) bad.push("not marked read-only");
    const fns = Object.keys(conn.functions);
    if (fns.sort().join(",") !== "getQuote,getQuoteEvents,search") bad.push("functions: " + fns.join(","));
    Object.keys(conn.functions).forEach(f => {
      const decl = conn.descriptor.functions[f];
      if (!decl || decl.effect !== "read") bad.push(f + " not declared read");
      if (window.QU_FEATURES && window.QU_FEATURES.classify("quoteread", f).kind !== "read") bad.push(f + " classified as write");
    });
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "quoteread exposes search/getQuote/getQuoteEvents, all declared and classified read; the adapter is read-only" };
  });

  T.register("read-only API: getQuoteEvents returns the append-only timeline (live)", async () => {
    const store = QS.create({ ns: "qr" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    await audit.append({ quote_id: "q1", version_id: "v1", event: "sent", actor_type: "internal", actor: "alice" });
    await audit.append({ quote_id: "q1", version_id: "v1", event: "viewed", actor_type: "portal", actor: "tok1", token_id: "tok1" });
    await audit.append({ quote_id: "q1", version_id: "v1", event: "approved", actor_type: "portal", actor: "tok1", token_id: "tok1" });
    const svc = makeService({ audit: audit });
    const res = await svc.getQuoteEvents("q1", {});
    const bad = [];
    if (!res.ok || res.events.length !== 3) return { pass: false, detail: "events: " + JSON.stringify(res) };
    if (res.events[0].event !== "sent" || res.events[2].event !== "approved") bad.push("order");
    if (res.events[1].token_id !== "tok1") bad.push("token id missing");
    if (JSON.stringify(res).indexOf("secret") !== -1) bad.push("secret leaked");
    const missing = await svc.getQuoteEvents("nope", {});
    if (!missing.ok || (missing.events || []).length !== 0) bad.push("unknown quote should return no events");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the read API paged the append-only timeline with token ids and no secret" };
  });
})();
