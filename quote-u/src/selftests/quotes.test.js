(function () {
  const T = window.QU_SELFTEST;
  const C = window.QU_CONNECTORS;
  const Q = window.QU_QUOTES;
  const QS = window.QU_STORE;
  if (!T || !C || !Q || !QS) return;

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

  function makeEnv(scope) {
    const kvStore = new Map();
    const files = new Map();
    const store = QS.create({ ns: "q" + QS.randHex(6), kv: makeKv(kvStore), editable: makeEditable(files), modules: ["quotes", "quote_events"] });
    const psa = C.createMockPsa();
    const gateway = C.createGateway({ connectors: { psa } });
    const audit = window.QU_AUDIT ? window.QU_AUDIT.createService({ store }) : null;
    const numbering = window.QU_NUMBERING ? window.QU_NUMBERING.createService({ store }) : null;
    const svc = Q.createService({ store, gateway, numbering, audit, scope: scope === undefined ? "*" : scope });
    return { store, ns: store.ns, kvStore, files, psa, gateway, audit, numbering, svc };
  }

  T.register("quotes: the gateway only calls allowlisted connector functions", () => {
    const psa = C.createMockPsa();
    const gw = C.createGateway({ connectors: { psa } });
    const bad = [];
    const unknown = gw.call("nope", "getCompany", {}, { scope: "*" });
    if (unknown.ok || unknown.code !== "unknown_connector") bad.push("unknown connector: " + JSON.stringify(unknown));
    const notAllowed = gw.call("psa", "dropDatabase", {}, { scope: "*" });
    if (notAllowed.ok || notAllowed.code !== "function_not_allowed") bad.push("non-allowlisted fn: " + JSON.stringify(notAllowed));
    const ok = gw.call("psa", "getCompany", { id: "c1" }, { scope: "*" });
    if (!ok.ok || !ok.result || ok.result.name !== "Northwind Systems") bad.push("allowlisted call failed: " + JSON.stringify(ok));
    const log = gw.callLog();
    if (log.length !== 3 || log[0].ok !== false || log[2].ok !== true) bad.push("call log: " + JSON.stringify(log.map(e => [e.fn, e.ok, e.code])));
    if (gw.allowedFunctions("psa").indexOf("createOpportunity") === -1) bad.push("allowedFunctions missing createOpportunity");
    if (!gw.has("psa")) bad.push("has(psa) false");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "unknown connector + off-allowlist function refused; allowlisted call logged" };
  });

  T.register("quotes: scope guards every lookup (no cross-account IDOR)", () => {
    const psa = C.createMockPsa();
    const gw = C.createGateway({ connectors: { psa } });
    const s = ["c1"];
    const bad = [];
    const companies = gw.call("psa", "listCompanies", {}, { scope: s });
    if (!companies.ok || companies.result.length !== 1 || companies.result[0].id !== "c1") bad.push("listCompanies leaked: " + JSON.stringify(companies));
    const other = gw.call("psa", "getCompany", { id: "c2" }, { scope: s });
    if (!other.ok || other.result !== null) bad.push("getCompany(c2) leaked: " + JSON.stringify(other));
    const contacts = gw.call("psa", "listContacts", { company_id: "c2" }, { scope: s });
    if (!contacts.ok || contacts.result.length !== 0) bad.push("listContacts(c2) leaked: " + JSON.stringify(contacts));
    const ct = gw.call("psa", "getContact", { id: "ct3" }, { scope: s });
    if (!ct.ok || ct.result !== null) bad.push("getContact(ct3) leaked: " + JSON.stringify(ct));
    const opp = gw.call("psa", "getOpportunity", { id: "op3" }, { scope: s });
    if (!opp.ok || opp.result !== null) bad.push("getOpportunity(op3) leaked: " + JSON.stringify(opp));
    const mk = gw.call("psa", "createOpportunity", { company_id: "c2", name: "x" }, { scope: s });
    if (mk.ok || mk.code !== "not_found") bad.push("createOpportunity(c2) allowed: " + JSON.stringify(mk));
    const all = gw.call("psa", "listCompanies", {}, { scope: "*" });
    if (!all.ok || all.result.length !== 3) bad.push("all-scope listCompanies: " + JSON.stringify(all));
    const empty = C.scopeAllows([], "c1");
    if (empty) bad.push("empty scope allowed a company");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a c1-scoped caller reaches only c1; missing records return null/[] and an out-of-scope create is not_found" };
  });

  T.register("quotes: creating a quote validates company + contact, numbers it and audits it", async () => {
    const env = makeEnv();
    const bad = [];
    const res = await env.svc.createQuote({ company_id: "c1", contact_id: "ct1", actor: "rep@acme.test", at: "2026-01-02T03:04:05.000Z" });
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    const q = res.quote;
    if (!/^QU-\d{4}-\d{4}$/.test(String(res.number))) bad.push("number: " + res.number);
    if (q.quote_number !== res.number) bad.push("quote_number not set");
    if (q.company_id !== "c1" || q.company_name !== "Northwind Systems") bad.push("company not copied");
    if (q.contact_id !== "ct1" || q.contact_name !== "Dana Whitfield") bad.push("contact not copied");
    if (q.contact_email !== "dana@northwind.example") bad.push("contact email not copied");
    if (q.opportunity_id !== null) bad.push("opportunity_id should be null");
    if (q.status !== "draft") bad.push("status: " + q.status);
    const saved = await env.store.loadDoc("quotes");
    const stored = saved.content.records.find(r => r.id === q.id);
    if (!stored || stored.quote_number !== res.number) bad.push("quote not persisted");
    if (env.audit) {
      const log = await env.audit.forQuote(q.id);
      const created = log.records.filter(r => r.event === "created");
      if (created.length !== 1) bad.push("created audit events: " + created.length);
      else if (!created[0].detail || created[0].detail.quote_number !== res.number) bad.push("audit detail missing number");
    }
    const e1 = await env.svc.createQuote({});
    if (e1.ok || e1.code !== "company_required") bad.push("missing company: " + JSON.stringify(e1));
    const e2 = await env.svc.createQuote({ company_id: "c1" });
    if (e2.ok || e2.code !== "contact_required") bad.push("missing contact: " + JSON.stringify(e2));
    const e3 = await env.svc.createQuote({ company_id: "c1", contact_id: "ct3" });
    if (e3.ok || e3.code !== "contact_company_mismatch") bad.push("cross-company contact: " + JSON.stringify(e3));
    const e4 = await env.svc.createQuote({ company_id: "c9", contact_id: "ct1" });
    if (e4.ok || e4.code !== "company_not_found") bad.push("unknown company: " + JSON.stringify(e4));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "valid quote persisted with a QU-YYYY-#### number + created audit; four invalid inputs refused" };
  });

  T.register("quotes: scoped creation cannot reach another account", async () => {
    const env = makeEnv(["c1"]);
    const bad = [];
    const own = await env.svc.createQuote({ company_id: "c1", contact_id: "ct1" });
    if (!own.ok) bad.push("in-scope create failed: " + JSON.stringify(own));
    const foreign = await env.svc.createQuote({ company_id: "c2", contact_id: "ct3" });
    if (foreign.ok || foreign.code !== "company_not_found") bad.push("out-of-scope create: " + JSON.stringify(foreign));
    const foreignContact = await env.svc.createQuote({ company_id: "c1", contact_id: "ct3" });
    if (foreignContact.ok || foreignContact.code !== "contact_not_found") bad.push("out-of-scope contact: " + JSON.stringify(foreignContact));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a c1-scoped user can quote c1 only; a c2 company/contact is invisible" };
  });

  T.register("quotes: opportunities can be linked but never across accounts", async () => {
    const env = makeEnv();
    const bad = [];
    const a = await env.svc.createQuote({ company_id: "c1", contact_id: "ct1" });
    const link = await env.svc.linkOpportunity(a.quote.id, "op1");
    if (!link.ok || link.quote.opportunity_id !== "op1" || link.quote.opportunity_name !== "Northwind network refresh") bad.push("link: " + JSON.stringify(link));
    const again = await env.svc.linkOpportunity(a.quote.id, "op2");
    if (again.ok || again.code !== "already_linked") bad.push("re-link allowed: " + JSON.stringify(again));
    const b = await env.svc.createQuote({ company_id: "c1", contact_id: "ct2" });
    const cross = await env.svc.linkOpportunity(b.quote.id, "op3");
    if (cross.ok || cross.code !== "opportunity_company_mismatch") bad.push("cross-company link: " + JSON.stringify(cross));
    const missing = await env.svc.linkOpportunity(b.quote.id, "nope");
    if (missing.ok || missing.code !== "opportunity_not_found") bad.push("unknown opp: " + JSON.stringify(missing));
    const c = await env.svc.createQuote({ company_id: "c1", contact_id: "ct1", opportunity_id: "op2" });
    if (!c.ok || c.quote.opportunity_id !== "op2") bad.push("create with opportunity: " + JSON.stringify(c));
    const d = await env.svc.createQuote({ company_id: "c1", contact_id: "ct1", opportunity_id: "op3" });
    if (d.ok || d.code !== "opportunity_company_mismatch") bad.push("create with cross-company opp: " + JSON.stringify(d));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "same-account opportunity links; re-link, cross-account, unknown and mismatch all refused" };
  });

  T.register("quotes: createOpportunity writes once and links the new record back", async () => {
    const env = makeEnv();
    const bad = [];
    const before = env.psa.seed.opportunities.length;
    const a = await env.svc.createQuote({ company_id: "c2", contact_id: "ct3" });
    const res = await env.svc.createOpportunity(a.quote.id, { name: "Harborline add-on", stage: "qualified", amount_cents: 5000 });
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    if (env.psa.seed.opportunities.length !== before + 1) bad.push("opportunity not created in the PSA");
    if (res.opportunity.company_id !== "c2" || res.opportunity.name !== "Harborline add-on") bad.push("opportunity fields: " + JSON.stringify(res.opportunity));
    if (res.quote.opportunity_id !== res.opportunity.id || res.quote.opportunity_name !== res.opportunity.name) bad.push("quote not linked back");
    const reread = await env.svc.getQuote(a.quote.id);
    if (!reread.ok || reread.quote.opportunity_id !== res.opportunity.id) bad.push("link not persisted");
    const again = await env.svc.createOpportunity(a.quote.id, { name: "second" });
    if (again.ok || again.code !== "already_linked") bad.push("second opportunity allowed: " + JSON.stringify(again));
    if (env.audit) {
      const log = await env.audit.forQuote(a.quote.id);
      if (log.records.filter(r => r.event === "opp_created").length !== 1) bad.push("opp_created audit missing");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one PSA opportunity created, linked back and audited; a second is already_linked" };
  });

  T.register("quotes: quote reads are scope-filtered", async () => {
    const env = makeEnv("*");
    const bad = [];
    const a = await env.svc.createQuote({ company_id: "c1", contact_id: "ct1" });
    const b = await env.svc.createQuote({ company_id: "c2", contact_id: "ct3" });
    if (!a.ok || !b.ok) return { pass: false, detail: "setup failed" };
    const mine = await env.svc.listQuotes({ scope: ["c1"] });
    if (!mine.ok || mine.quotes.length !== 1 || mine.quotes[0].company_id !== "c1") bad.push("listQuotes leaked: " + JSON.stringify(mine.quotes && mine.quotes.map(q => q.company_id)));
    const hidden = await env.svc.getQuote(b.quote.id, { scope: ["c1"] });
    if (!hidden.ok || hidden.quote !== null) bad.push("getQuote leaked a foreign quote");
    const visible = await env.svc.getQuote(a.quote.id, { scope: ["c1"] });
    if (!visible.ok || !visible.quote) bad.push("in-scope getQuote failed");
    const all = await env.svc.listQuotes({ scope: ["*"] });
    if (!all.ok || all.quotes.length !== 2) bad.push("all-scope list: " + (all.quotes && all.quotes.length));
    const byCompany = await env.svc.listQuotes({ scope: ["*"] }, { company_id: "c2" });
    if (!byCompany.ok || byCompany.quotes.length !== 1) bad.push("company filter");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a c1-scoped user sees only c1 quotes; get/list both filter by scope" };
  });

  T.register("quotes: create → read back through the real workspace store (live)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "qte" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.createDefault({ ns, modules: ["quotes", "quote_events"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const gateway = C.createDefault();
    const numbering = window.QU_NUMBERING ? window.QU_NUMBERING.createService({ store }) : null;
    const audit = window.QU_AUDIT ? window.QU_AUDIT.createService({ store }) : null;
    const svc = Q.createService({ store, gateway, numbering, audit, scope: "*" });
    const res = await svc.createQuote({ company_id: "c1", contact_id: "ct1", actor: "live-test" });
    if (res.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (res.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live quotes check skipped" };
    if (!res.ok) return { pass: false, detail: "create failed: " + JSON.stringify(res) };
    const back = await svc.listQuotes({ scope: ["*"] });
    const found = back.quotes && back.quotes.find(q => q.id === res.quote.id);
    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    if (!found) return { pass: false, detail: "quote not readable back from the canonical document" };
    if (found.quote_number !== res.number) return { pass: false, detail: "number changed on read-back" };
    return { pass: true, detail: "created " + res.number + " on the canonical store and read it back" };
  });
})();
