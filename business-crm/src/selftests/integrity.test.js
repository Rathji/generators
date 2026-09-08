(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const H = window.CRM_HEALTH;
  if (!T || !BS || !H) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];
  const DAY = 86400000;

  function mockEnv(opts) {
    opts = opts || {};
    const kvStore = new Map();
    const files = new Map();
    const kv = {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
    const editable = {
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
          f.text = text;
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true, unchanged: false, superseded: false };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, created: false, unchanged: true, superseded: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false, unchanged: false, superseded: false };
      },
      files
    };
    const ns = "hi" + BS.randHex(6);
    const store = BS.create(Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts));
    return { kv, kvStore, editable, store };
  }

  function daysAgo(n) {
    return new Date(Date.now() - n * DAY).toISOString();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function cleanDocs() {
    return {
      companies: [
        { id: "c-1", name: "Acme Corp", active: true, isCustomer: true, customerSince: daysAgo(25) },
        { id: "c-2", name: "Beta Ltd", active: true }
      ],
      contacts: [
        { id: "ct-1", name: "Pat Smith", companyId: "c-1", email: "pat@acme.example", active: true },
        { id: "ct-2", name: "Solo Dolo", email: "solo@example.com", active: true }
      ],
      leads: [
        { id: "l-1", name: "Acme pilot", status: "qualified", companyId: "c-1", owner: "Sam" },
        { id: "l-2", name: "Beta renewal", status: "converted", convertedToDealId: "d-1", convertedAt: daysAgo(5) }
      ],
      deals: [
        { id: "d-1", name: "Acme licence", stage: "won", wonAt: daysAgo(4), companyId: "c-1", owner: "Sam", convertedToCustomerAt: daysAgo(4) },
        { id: "d-2", name: "Beta licence", stage: "open", companyId: "c-2", owner: "Sam" }
      ],
      activities: [
        { id: "a-1", type: "call", at: daysAgo(3), companyId: "c-1", contactId: "ct-1", dealId: "d-1" }
      ]
    };
  }

  T.register("health: a clean data set reports no issues", async () => {
    const res = H.problemsFor(cleanDocs());
    if (!res.ok) return { pass: false, detail: "clean set flagged problems: " + JSON.stringify(res.problems.map(p => p.code)) };
    if (res.problems.length !== 0) return { pass: false, detail: "expected no problems, got " + res.problems.length };
    return { pass: true };
  });

  T.register("health: dangling references are errors", async () => {
    const docs = cleanDocs();
    docs.contacts.push({ id: "ct-9", name: "Ghost", companyId: "c-99", active: true });
    docs.deals.push({ id: "d-9", name: "Ghost deal", stage: "open", companyId: "c-99", contactId: "ct-98", owner: "Sam" });
    docs.activities.push({ id: "a-9", type: "note", at: daysAgo(1), dealId: "d-88", companyId: "c-77" });
    const res = H.problemsFor(docs);
    const codes = res.problems.map(p => p.code);
    if (codes.indexOf("orphan_contact") === -1) return { pass: false, detail: "orphan contact not flagged: " + codes.join(",") };
    if (codes.indexOf("deal_no_company") === -1) return { pass: false, detail: "dangling deal company not flagged" };
    if (codes.indexOf("deal_no_contact") === -1) return { pass: false, detail: "dangling deal contact not flagged" };
    if (codes.indexOf("activity_orphan_ref") === -1) return { pass: false, detail: "dangling activity ref not flagged" };
    const errs = res.problems.filter(p => p.sev === "err");
    if (errs.length !== 4) return { pass: false, detail: "expected 4 errors, got " + errs.length + ": " + errs.map(p => p.code).join(",") };
    const oc = res.problems.find(p => p.code === "orphan_contact");
    if (oc.href !== "#/contacts/ct-9") return { pass: false, detail: "orphan contact should link to its record, got " + oc.href };
    return { pass: true };
  });

  T.register("health: date inconsistencies surface as warnings", async () => {
    const docs = cleanDocs();
    docs.deals.push({ id: "d-3", name: "No won date", stage: "won", companyId: "c-1", owner: "Sam" });
    docs.deals.push({ id: "d-4", name: "No lost date", stage: "lost", companyId: "c-1", owner: "Sam" });
    docs.deals.push({ id: "d-5", name: "Both dates", stage: "won", wonAt: daysAgo(3), lostAt: daysAgo(2), companyId: "c-1", owner: "Sam" });
    docs.deals.push({ id: "d-6", name: "Converted but open", stage: "open", convertedToCustomerAt: daysAgo(1), companyId: "c-1", owner: "Sam" });
    docs.deals.push({ id: "d-7", name: "Converted, company not flagged", stage: "won", wonAt: daysAgo(1), convertedToCustomerAt: daysAgo(1), companyId: "c-2", owner: "Sam" });
    docs.companies.push({ id: "c-8", name: "Zeta", customerSince: daysAgo(3), active: true });
    docs.leads.push({ id: "l-8", name: "Ghost conversion", status: "converted", convertedToDealId: "d-404", convertedAt: daysAgo(2) });
    docs.leads.push({ id: "l-9", name: "Bare disqualify", status: "disqualified" });
    const res = H.problemsFor(docs);
    const codes = res.problems.map(p => p.code);
    const want = ["deal_won_no_date", "deal_lost_no_date", "deal_terminal_conflict", "deal_converted_not_won", "deal_converted_customer_mismatch", "company_customer_flag_missing", "lead_converted_dangling", "lead_disqualified_bare"];
    for (const w of want) {
      if (codes.indexOf(w) === -1) return { pass: false, detail: "missing warning " + w + " in " + codes.join(",") };
    }
    if (res.problems.some(p => p.sev !== "warn")) return { pass: false, detail: "all date problems should be warnings" };
    if (res.ok) return { pass: false, detail: "warnings should set ok=false" };
    return { pass: true };
  });

  T.register("health: duplicate name/email pairs warn and dismissals suppress them", async () => {
    const docs = cleanDocs();
    docs.companies.push({ id: "c-3", name: "acme corp", active: true });
    docs.contacts.push({ id: "ct-3", name: "Pat S.", companyId: "c-1", email: "PAT@acme.example", active: true });
    const res = H.problemsFor(docs);
    const codes = res.problems.map(p => p.code);
    if (codes.indexOf("dup_companies") === -1) return { pass: false, detail: "dup company pair not flagged: " + codes.join(",") };
    if (codes.indexOf("dup_contacts") === -1) return { pass: false, detail: "dup contact pair not flagged" };
    docs.companies.find(c => c.id === "c-3").dupDismissed = ["c-1"];
    const res2 = H.problemsFor(docs);
    if (res2.problems.some(p => p.code === "dup_companies")) return { pass: false, detail: "dismissed company pair still flagged" };
    return { pass: true };
  });

  T.register("health: check() reads the store and flags records saved there", async () => {
    const env = mockEnv();
    const d = cleanDocs();
    d.contacts.push({ id: "ct-7", name: "Lost Contact", companyId: "c-404", active: true });
    await env.store.saveChecked("companies", { records: d.companies }, { expectedBase: 0 });
    await env.store.saveChecked("contacts", { records: d.contacts }, { expectedBase: 0 });
    await env.store.saveChecked("leads", { records: d.leads }, { expectedBase: 0 });
    await env.store.saveChecked("deals", { records: d.deals }, { expectedBase: 0 });
    await env.store.saveChecked("activities", { records: d.activities }, { expectedBase: 0 });
    const res = await H.check(env.store);
    if (!res || !res.ranAt) return { pass: false, detail: "check did not return a result" };
    if (!res.problems.some(p => p.code === "orphan_contact")) return { pass: false, detail: "saved orphan not found by check(): " + res.problems.map(p => p.code).join(",") };
    if (res.counts.err !== 1) return { pass: false, detail: "expected exactly 1 error, got " + JSON.stringify(res.counts) };
    return { pass: true };
  });

  T.register("health: a write notification re-runs the check (schedule path)", async () => {
    const env = mockEnv();
    await env.store.saveChecked("companies", { records: cleanDocs().companies }, { expectedBase: 0 });
    const before = await H.check(env.store);
    if (!before.ok) return { pass: false, detail: "clean store flagged problems before the write" };
    await env.store.saveChecked("contacts", { records: [{ id: "ct-5", name: "Later Contact", companyId: "c-404", active: true }] }, { expectedBase: 0 });
    H.schedule(env.store, 30);
    let got = null;
    for (let i = 0; i < 50; i++) {
      await sleep(60);
      const cur = H.last();
      if (cur && cur.ranAt !== before.ranAt) { got = cur; break; }
    }
    if (!got) return { pass: false, detail: "scheduled re-check never ran" };
    if (!got.problems.some(p => p.code === "orphan_contact")) return { pass: false, detail: "re-check missed the newly saved orphan" };
    return { pass: true };
  });

  T.register("health: the dashboard zone renders problems with fix links", async () => {
    const env = mockEnv();
    const d = cleanDocs();
    d.deals.push({ id: "d-9", name: "Broken deal", stage: "open", companyId: "c-404", owner: "Sam" });
    for (const m of ["companies", "contacts", "leads", "deals", "activities"]) {
      await env.store.saveChecked(m, { records: d[m] }, { expectedBase: 0 });
    }
    const card = await H.zone(env.store);
    const txt = card.textContent || "";
    if (txt.indexOf("Data integrity") === -1) return { pass: false, detail: "zone header missing" };
    if (txt.indexOf("1 error") === -1) return { pass: false, detail: "zone summary missing the error count: " + txt.slice(0, 200) };
    if (txt.indexOf("Broken deal") === -1) return { pass: false, detail: "problem detail not rendered" };
    const links = card.querySelectorAll("a[href]");
    if (![...links].some(a => a.getAttribute("href") === "#/deals/d-9")) return { pass: false, detail: "problem should link to its record page" };
    card.remove();
    return { pass: true };
  });
})();
