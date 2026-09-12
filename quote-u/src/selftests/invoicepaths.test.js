(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const P = window.QU_INVOICEPATHS;
  const M = window.QU_INVOICEMAPPING;
  if (!T || !QS || !P || !M) return;

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

  function makeStore(tag) {
    return QS.create({ ns: (tag || "paths") + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  T.register("invoice paths: the pure resolver honours explicit → company → default precedence and refuses a disabled or absent path", () => {
    const bad = [];
    const both = { default_path: "psa", paths: ["direct", "psa"] };
    const explicit = P.resolvePath(both, { path: "direct" });
    if (!explicit.ok || explicit.path !== "direct" || explicit.source !== "explicit") bad.push("explicit: " + JSON.stringify(explicit));
    const explicitWins = P.resolvePath(both, { path: "psa", company_id: "c1", mapping_path: "direct" });
    if (!explicitWins.ok || explicitWins.path !== "psa" || explicitWins.source !== "explicit") bad.push("explicit should beat the mapping: " + JSON.stringify(explicitWins));
    const company = P.resolvePath(both, { company_id: "c1", mapping_path: "direct" });
    if (!company.ok || company.path !== "direct" || company.source !== "company") bad.push("company: " + JSON.stringify(company));
    const dflt = P.resolvePath(both, { company_id: "c9" });
    if (!dflt.ok || dflt.path !== "psa" || dflt.source !== "default") bad.push("default: " + JSON.stringify(dflt));

    const disabledExplicit = P.resolvePath({ paths: ["psa"] }, { path: "direct" });
    if (disabledExplicit.ok || disabledExplicit.code !== "path_disabled") bad.push("a disabled explicit path should refuse: " + JSON.stringify(disabledExplicit));
    const disabledCompany = P.resolvePath({ paths: ["psa"] }, { company_id: "c1", mapping_path: "direct" });
    if (disabledCompany.ok || disabledCompany.code !== "path_disabled") bad.push("a disabled company preference should refuse: " + JSON.stringify(disabledCompany));
    const noPath = P.resolvePath({ paths: [] }, {});
    if (noPath.ok || noPath.code !== "no_path") bad.push("no enabled path should refuse with no_path: " + JSON.stringify(noPath));

    const only = P.enabledPaths({ paths: ["psa", "bogus"] });
    if (only.length !== 1 || only[0] !== "psa") bad.push("enabledPaths: " + JSON.stringify(only));
    const used = P.usedPath([{ version_id: "v1", path: "psa", status: "created", external_reference: "inv1" }], "v1");
    if (!used || used.path !== "psa" || used.status !== "created") bad.push("usedPath: " + JSON.stringify(used));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "explicit beats company beats default; a disabled explicit/company path refuses with path_disabled; an empty paths list refuses with no_path; enabledPaths filters to known paths" };
  });

  T.register("invoice mappings: a mapping upserts/resolves the customer key and PSA product id, replaces duplicates, and never stores a secret", async () => {
    const bad = [];
    const store = makeStore("map");
    const svc = M.createService({ store });
    const r = await svc.ready();
    if (!r.ok) return { pass: false, detail: "ready: " + JSON.stringify(r) };

    const co = await svc.upsert({ kind: "company_customer", company_id: "c1", accounting_customer_key: "acct-c1", preferred_path: "direct" });
    if (!co.ok || !co.mapping.id) bad.push("company upsert: " + JSON.stringify(co));
    const key = await svc.customerKey("c1");
    if (!key.ok || key.key !== "acct-c1") bad.push("customer key: " + JSON.stringify(key));
    const pref = await svc.pathFor("c1");
    if (!pref.ok || pref.preferred_path !== "direct") bad.push("preferred path: " + JSON.stringify(pref));

    const prod = await svc.upsert({ kind: "product_catalog", sku: "HW-AP-MR46", psa_product_id: "psa-prod-1" });
    if (!prod.ok) bad.push("product upsert: " + JSON.stringify(prod));
    const resolved = await svc.psaProduct({ sku: "hw-ap-mr46" });
    if (!resolved.ok || resolved.psa_product_id !== "psa-prod-1") bad.push("psa product (case-insensitive): " + JSON.stringify(resolved));
    const miss = await svc.psaProduct({ sku: "NOPE" });
    if (!miss.ok || miss.psa_product_id !== null) bad.push("unknown product should resolve null: " + JSON.stringify(miss));

    // A duplicate company mapping REPLACES the active row rather than accumulating.
    const again = await svc.upsert({ kind: "company_customer", company_id: "c1", accounting_customer_key: "acct-c1b" });
    if (!again.ok || !again.replaced) bad.push("duplicate upsert should replace: " + JSON.stringify(again));
    const coList = await svc.list({ kind: "company_customer", active: true });
    if (!coList.ok || coList.mappings.length !== 1) bad.push("active company mappings should be one: " + JSON.stringify(coList.mappings && coList.mappings.length));
    const key2 = await svc.customerKey("c1");
    if (key2.key !== "acct-c1b") bad.push("replaced key did not win: " + key2.key);

    const removed = await svc.remove(co.mapping.id);
    if (!removed.ok || removed.mapping.active !== false) bad.push("remove should deactivate: " + JSON.stringify(removed));
    const gone = await svc.customerKey("c1");
    if (gone.key !== null) bad.push("a removed mapping should not resolve: " + gone.key);

    let secretRefused = false;
    try { M.normalize({ kind: "company_customer", company_id: "c9", accounting_customer_key: "x", api_secret: "boom" }); }
    catch (e) { secretRefused = e.code === "secret_not_allowed"; }
    if (!secretRefused) bad.push("a secret-shaped field should be refused");
    const missing = M.validate({ kind: "company_customer" });
    if (missing.ok) bad.push("a company mapping with no company should be invalid");

    const v = await svc.verify();
    if (!v.ok) bad.push("verify: " + JSON.stringify(v.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "company↔customer and product↔PSA mappings upsert and resolve, a duplicate upsert replaces the active row, remove deactivates, secrets are refused, and verify passes" };
  });

  T.register("invoice paths: the router picks the mapped company path and delegates, and usedPathFor reads the claimed path back from the intent guard", async () => {
    const bad = [];
    const store = makeStore("router");
    const gateway = window.QU_CONNECTORS.createDefault();
    const audit = window.QU_AUDIT.createService({ store });
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const versions = window.QU_VERSIONS.createService({ store, audit });
    const mapping = M.createService({ store });
    await mapping.ready();
    await mapping.upsert({ kind: "company_customer", company_id: "c1", accounting_customer_key: "acct-c1", preferred_path: "direct" });
    const invoiceIntents = window.QU_INVOICEINTENTS.createService({ store });
    const outbox = window.QU_OUTBOX.createService({ store });
    const invoiceDirect = window.QU_INVOICEDIRECT.createService({ outbox, gateway, invoiceIntents, quotes, versions, audit, mapping, scope: "*" });
    const invoicePsa = window.QU_INVOICEPSA.createService({ outbox, gateway, invoiceIntents, quotes, versions, audit, mapping, scope: "*" });
    const router = P.createRouter({ invoiceDirect, invoicePsa, invoiceIntents, mapping, policy: { default_path: "psa", paths: ["direct", "psa"] } });

    const byCompany = await router.resolve({ company_id: "c1" });
    if (!byCompany.ok || byCompany.path !== "direct" || byCompany.source !== "company") bad.push("mapped company resolution: " + JSON.stringify(byCompany));
    const byDefault = await router.resolve({ company_id: "c3" });
    if (!byDefault.ok || byDefault.path !== "psa" || byDefault.source !== "default") bad.push("default resolution: " + JSON.stringify(byDefault));
    const byExplicit = await router.resolve({ path: "direct" });
    if (!byExplicit.ok || byExplicit.path !== "direct" || byExplicit.source !== "explicit") bad.push("explicit resolution: " + JSON.stringify(byExplicit));

    const lineItems = [
      { id: "l1", sort_order: 0, kind: "one_time", description: "Router", quantity: 2, unit_sell_cents: 15000, sku: "HW-AP-MR46" },
      { id: "l2", sort_order: 1, kind: "mrr", description: "Managed IT", quantity: 1, unit_sell_cents: 20000 }
    ];
    // c2 has no company preference → the router delegates to the PSA path.
    const psaEnq = await router.enqueueForVersion({
      quote: { id: "q1", company_id: "c2", status: "approved", opportunity_id: "op3" },
      version: { id: "v1", frozen_at: "2026-01-01T00:00:00Z" },
      line_items: lineItems,
      selection: ["l1", "l2"]
    });
    if (!psaEnq.ok || psaEnq.path !== "psa") bad.push("psa delegation: " + JSON.stringify(psaEnq));
    const psaJob = await outbox.getByKey("v1:" + window.QU_INVOICEPSA.ACTION);
    if (!psaJob.ok || !psaJob.job) bad.push("no psa job: " + JSON.stringify(psaJob));

    // c1 is mapped to the direct path → the router delegates to the accounting path.
    const directEnq = await router.enqueueForVersion({
      quote: { id: "q2", company_id: "c1", status: "approved", opportunity_id: "op1" },
      version: { id: "v2", frozen_at: "2026-01-01T00:00:00Z" },
      line_items: lineItems,
      selection: ["l1", "l2"]
    });
    if (!directEnq.ok || directEnq.path !== "direct") bad.push("direct delegation: " + JSON.stringify(directEnq));
    const directJob = await outbox.getByKey("v2:" + window.QU_INVOICEDIRECT.ACTION);
    if (!directJob.ok || !directJob.job) bad.push("no direct job: " + JSON.stringify(directJob));
    if (!directJob.job.payload.customer || directJob.job.payload.customer.external_key !== "acct-c1") bad.push("the direct job should carry the mapped customer key: " + JSON.stringify(directJob.job.payload.customer));

    const before = await router.usedPathFor("v1");
    if (!before.ok || before.used !== null) bad.push("no path should be used before running: " + JSON.stringify(before));
    const run = await outbox.runDue();
    if (!run.ok) bad.push("runDue: " + JSON.stringify(run));
    const after = await router.usedPathFor("v1");
    if (!after.ok || !after.used || after.used.path !== "psa" || after.used.status !== "created") bad.push("usedPathFor should read the claimed psa path: " + JSON.stringify(after));
    const cnt = await gateway.call("psa", "psaInvoiceCount", {}, { scope: "*" });
    if (cnt.result !== 1) bad.push("the psa path should have produced one invoice: " + cnt.result);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the router consults the company mapping, delegates to the chosen path (mapped company → direct with the mapped customer key, otherwise → psa), and usedPathFor reads the claimed path back from the intent guard" };
  });
})();
