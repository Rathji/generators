(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const BUS = window.CRM_BUS;
  if (!T || !BS || !R || !BUS) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];

  function mockEnv() {
    const kvStore = new Map();
    const files = new Map();
    const peerFiles = new Map();
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
    const store = BS.create({ ns: "bs" + BS.randHex(6), kv, editable, modules: ALL_MODULES.slice() });
    const env = { kv, kvStore, editable, files, peerFiles, store, gen: "testgen" };
    env.transport = {
      kv,
      editable,
      genName: env.gen,
      readPeer: async (peer, file) => {
        const f = peerFiles.get(peer + "/" + file);
        if (!f) return { ok: false, code: "not_found", peer };
        return { ok: true, text: f.text, peer };
      }
    };
    return env;
  }

  async function withBus(env, fn) {
    BUS.setTransport(env.transport);
    try {
      return await fn();
    } finally {
      BUS.setTransport(null);
    }
  }

  async function save(store, module, content) {
    const r = await store.saveChecked(module, content, { expectedBase: 0 });
    if (!r.ok) throw new Error(module + " seed failed: " + JSON.stringify(r));
  }

  async function busDoc(env) {
    const d = await env.store.loadDoc("bus", { refresh: true });
    return d && d.ok ? d.content : { records: [] };
  }

  async function fileEnv(env, name) {
    const t = await env.editable.get(name);
    return t ? JSON.parse(t) : null;
  }

  function envelope(streamId, gen, bundles) {
    return JSON.stringify({ k: "bcrm-bus", v: 1, stream: streamId, generator: gen, updatedAt: new Date().toISOString(), bundles });
  }

  function peerWrite(env, gen, file, text) {
    env.peerFiles.set(gen + "/" + file, { text });
  }

  function recOf(content, id) {
    return (content.records || []).find(r => r && r.id === id) || null;
  }

  function outBundle(id, kind, extra) {
    return Object.assign({ id, at: new Date().toISOString(), kind }, extra || {});
  }

  const iso = d => d.toISOString();
  const daysFromNow = n => iso(new Date(Date.now() + n * 86400000));

  T.register("bus: stream-peer config round-trips through the bus document and status summary", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      const s1 = await BUS.saveConfig(env.store, { ideasPeer: "idea-incubator", receivablePeers: "the-ledger, erp" });
      if (!s1.ok) return { pass: false, detail: "saveConfig failed: " + JSON.stringify(s1) };
      const cfg = await BUS.ensureConfig(env.store);
      if (cfg.ideasPeer !== "idea-incubator") return { pass: false, detail: "ideasPeer lost: " + cfg.ideasPeer };
      if (cfg.receivablePeers !== "the-ledger, erp") return { pass: false, detail: "receivablePeers lost: " + cfg.receivablePeers };
      const st = await BUS.statusSummary(env.store);
      if (st.streams.ideas.peer !== "idea-incubator") return { pass: false, detail: "ideas peer not in summary" };
      if (st.streams.receivables.peer !== "the-ledger, erp") return { pass: false, detail: "receivables peers not in summary" };
      if (st.streams.projects.dir !== "out" || st.streams.customers.dir !== "out") return { pass: false, detail: "out stream dirs wrong" };
      return { pass: true, detail: "config round-trip + summary verified" };
    });
  });

  T.register("bus: materialize unions existing file bundles with queued out records, mirrors them and is idempotent", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      const b1 = outBundle("bs-aaaa", "project-seed", { opportunity: { id: "d-1", name: "Acme deal" }, company: { id: "c-1", name: "Acme" } });
      const b2 = outBundle("bs-bbbb", "project-seed", { opportunity: { id: "d-2", name: "Beta deal" }, company: { id: "c-2", name: "Beta" } });
      await env.editable.set("bus-projects", envelope("projects", "testgen", [b2]));
      await env.kv.set("bus-ek:bus-projects", "ek.bus-projects");
      await save(env.store, "bus", { records: [
        { id: "out-" + b1.id, kind: "out", stream: "projects", bundleId: b1.id, dealId: "d-1", at: b1.at, status: "pending", bundle: b1 },
        { id: "out-" + b2.id, kind: "out", stream: "projects", bundleId: b2.id, dealId: "d-2", at: b2.at, status: "pending", bundle: b2 }
      ] });
      const res = await BUS.materialize(env.store, "projects");
      if (!res.ok || res.added !== 1 || res.count !== 2) return { pass: false, detail: "union wrong: " + JSON.stringify(res) };
      const f = await fileEnv(env, "bus-projects");
      if (!f || f.bundles.length !== 2) return { pass: false, detail: "file bundle count wrong" };
      const ids = f.bundles.map(b => b.id).sort().join(",");
      if (ids !== "bs-aaaa,bs-bbbb") return { pass: false, detail: "file ids wrong: " + ids };
      const key = await env.kv.get("bus-ek:bus-projects");
      if (key !== "ek.bus-projects") return { pass: false, detail: "edit key not cached: " + key };
      const doc = await busDoc(env);
      const outRecs = doc.records.filter(r => r.kind === "out" && r.stream === "projects");
      if (outRecs.length !== 2 || outRecs.some(r => r.status !== "mirrored")) return { pass: false, detail: "out records not mirrored" };
      const again = await BUS.materialize(env.store, "projects");
      if (!again.ok || !again.noop) return { pass: false, detail: "second materialize not a noop: " + JSON.stringify(again) };
      const man = await fileEnv(env, "bus-manifest");
      if (!man || man.k !== "bcrm-bus-manifest") return { pass: false, detail: "manifest missing" };
      if (!man.streams.projects || man.streams.projects.file !== "bus-projects" || man.streams.projects.count !== 2) return { pass: false, detail: "manifest streams wrong: " + JSON.stringify(man.streams) };
      return { pass: true, detail: "union + mirror + noop + manifest verified" };
    });
  });

  T.register("bus: a missing edit key fails gracefully with a queued retry and recovers once the key is cached", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      const b1 = outBundle("bs-cccc", "project-seed", { opportunity: { id: "d-3", name: "Gamma deal" } });
      await env.editable.set("bus-projects", envelope("projects", "testgen", [b1]));
      const b2 = outBundle("bs-dddd", "project-seed", { opportunity: { id: "d-4", name: "Delta deal" } });
      await save(env.store, "bus", { records: [
        { id: "out-" + b2.id, kind: "out", stream: "projects", bundleId: b2.id, dealId: "d-4", at: b2.at, status: "pending", bundle: b2 }
      ] });
      const fail = await BUS.materialize(env.store, "projects");
      if (!fail || fail.ok || fail.code !== "no_edit_key") return { pass: false, detail: "expected no_edit_key, got: " + JSON.stringify(fail) };
      let doc = await busDoc(env);
      let rec = doc.records.find(r => r.id === "out-" + b2.id);
      if (rec.status === "mirrored" || !rec.lastError) return { pass: false, detail: "pending rec should carry lastError" };
      await env.kv.set("bus-ek:bus-projects", "ek.bus-projects");
      const ok = await BUS.materialize(env.store, "projects");
      if (!ok.ok || ok.added !== 1) return { pass: false, detail: "recovery failed: " + JSON.stringify(ok) };
      doc = await busDoc(env);
      rec = doc.records.find(r => r.id === "out-" + b2.id);
      if (rec.status !== "mirrored" || rec.lastError) return { pass: false, detail: "rec not healed after recovery" };
      return { pass: true, detail: "fail → lastError → recover verified" };
    });
  });

  T.register("bus: a won deal is handed off exactly once with a project-seed bundle", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      await save(env.store, "companies", { records: [{ id: "c-1", name: "Acme Industries", industry: "Software" }] });
      await save(env.store, "contacts", { records: [{ id: "ct-1", name: "Pat Smith", email: "pat@acme.example", companyId: "c-1" }] });
      const won = { id: "d-9", name: "Acme licence", stage: "won", expectedValue: 24000, closeDate: "2026-12-20", companyId: "c-1", owner: "Sam", createdAt: daysFromNow(-20) };
      await save(env.store, "deals", { records: [won] });
      const res = await BUS.publishProjectSeed(env.store, won);
      if (!res.ok || res.noop) return { pass: false, detail: "first publish failed: " + JSON.stringify(res) };
      const f = await fileEnv(env, "bus-projects");
      if (!f || f.bundles.length !== 1) return { pass: false, detail: "no bundle in stream file" };
      const b = f.bundles[0];
      if (b.kind !== "project-seed" || b.opportunity.id !== "d-9" || b.opportunity.name !== "Acme licence" || b.opportunity.expectedValue !== 24000) return { pass: false, detail: "opportunity payload wrong: " + JSON.stringify(b.opportunity) };
      if (!b.company || b.company.id !== "c-1" || !b.contact || b.contact.email !== "pat@acme.example") return { pass: false, detail: "company/contact snapshot wrong" };
      const doc = await busDoc(env);
      const outRecs = doc.records.filter(r => r.kind === "out" && r.stream === "projects" && r.dealId === "d-9");
      if (outRecs.length !== 1 || outRecs[0].status !== "mirrored" || !outRecs[0].bundle || !outRecs[0].bundleId) return { pass: false, detail: "out record wrong: " + JSON.stringify(outRecs) };
      const dealDoc = await env.store.loadDoc("deals", { refresh: true });
      const dealNow = recOf(dealDoc.content, "d-9");
      if (!dealNow.busHandoff) return { pass: false, detail: "deal not flagged" };
      const second = await BUS.publishProjectSeed(env.store, dealNow);
      if (!second.noop) return { pass: false, detail: "second publish must noop" };
      const f2 = await fileEnv(env, "bus-projects");
      if (f2.bundles.length !== 1) return { pass: false, detail: "double-send: file has " + f2.bundles.length };
      return { pass: true, detail: "single-send handoff verified" };
    });
  });

  T.register("bus: onModuleWrite publishes a project seed when a deal transitions to won", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      await save(env.store, "deals", { records: [{ id: "d-9b", name: "Acme renewal", stage: "won", expectedValue: 5000, companyId: "c-1", owner: "Sam" }] });
      const prevB = { id: "d-9b", name: "Acme renewal", stage: "proposal" };
      const nextB = { id: "d-9b", name: "Acme renewal", stage: "won", expectedValue: 5000, companyId: "c-1", owner: "Sam" };
      await BUS.onModuleWrite(env.store, { module: "deals", changes: [{ id: "d-9b", prev: prevB, next: nextB }] });
      const f = await fileEnv(env, "bus-projects");
      if (!f || f.bundles.length !== 1) return { pass: false, detail: "onModuleWrite did not publish: " + (f ? f.bundles.length : "no file") };
      await BUS.onModuleWrite(env.store, { module: "deals", changes: [{ id: "d-9b", prev: prevB, next: nextB }] });
      const f2 = await fileEnv(env, "bus-projects");
      if (f2.bundles.length !== 1) return { pass: false, detail: "onModuleWrite double-sent" };
      return { pass: true, detail: "deal write trigger verified" };
    });
  });

  T.register("bus: customers publish once, and onModuleWrite publishes newly flagged customers", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      const cust = { id: "c-7", name: "Northwind Traders", isCustomer: true, taxId: "VAT-77" };
      await save(env.store, "companies", { records: [cust] });
      const res = await BUS.publishCustomer(env.store, cust);
      if (!res.ok || res.noop) return { pass: false, detail: "first customer publish failed: " + JSON.stringify(res) };
      const f = await fileEnv(env, "bus-customers");
      if (!f || f.bundles.length !== 1 || f.bundles[0].kind !== "customer") return { pass: false, detail: "customer bundle wrong" };
      if (f.bundles[0].company.taxId !== "VAT-77") return { pass: false, detail: "customer snapshot wrong" };
      const doc = await busDoc(env);
      const outRecs = doc.records.filter(r => r.kind === "out" && r.stream === "customers" && r.companyId === "c-7");
      if (outRecs.length !== 1 || outRecs[0].status !== "mirrored") return { pass: false, detail: "out record wrong: " + JSON.stringify(outRecs) };
      const cDoc = await env.store.loadDoc("companies", { refresh: true });
      const cNow = recOf(cDoc.content, "c-7");
      if (!cNow.busCustomer || !cNow.busCustomer.bundleId) return { pass: false, detail: "company not flagged" };
      const second = await BUS.publishCustomer(env.store, cNow);
      if (!second.noop) return { pass: false, detail: "second customer publish must noop" };
      const f2 = await fileEnv(env, "bus-customers");
      if (f2.bundles.length !== 1) return { pass: false, detail: "customer double-send" };
      return { pass: true, detail: "customer single-send verified" };
    });
  });

  T.register("bus: onModuleWrite publishes a customer the moment isCustomer flips to true", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      await save(env.store, "companies", { records: [{ id: "c-8", name: "Globex", isCustomer: true, taxId: "VAT-88" }] });
      const prevC = { id: "c-8", name: "Globex", isCustomer: false };
      const nextC = { id: "c-8", name: "Globex", isCustomer: true, taxId: "VAT-88" };
      await BUS.onModuleWrite(env.store, { module: "companies", changes: [{ id: "c-8", prev: prevC, next: nextC }] });
      const f = await fileEnv(env, "bus-customers");
      if (!f || f.bundles.length !== 1 || f.bundles[0].company.id !== "c-8") return { pass: false, detail: "customer trigger did not publish" };
      await BUS.onModuleWrite(env.store, { module: "companies", changes: [{ id: "c-8", prev: prevC, next: nextC }] });
      const f2 = await fileEnv(env, "bus-customers");
      if (f2.bundles.length !== 1) return { pass: false, detail: "customer trigger double-sent" };
      return { pass: true, detail: "customer write trigger verified" };
    });
  });

  T.register("bus: ideas pull through the manifest, import as qualified leads with notes and dedupe forever", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      const idea = { id: "i-1", title: "Churn predictor", description: "Predict accounts at risk.", goals: ["Reduce churn 20%"], scope: ["Build model", "Ship alerting"] };
      const bundle = { id: "idea-1", at: daysFromNow(-1), kind: "idea", sourceGen: "idea-gen", payload: idea };
      peerWrite(env, "idea-gen", "bus-manifest", JSON.stringify({ k: "bcrm-bus-manifest", v: 1, generator: "idea-gen", streams: { ideas: { file: "ideas-2026", label: "Idea bundles", count: 1 } } }));
      peerWrite(env, "idea-gen", "ideas-2026", envelope("ideas", "idea-gen", [bundle]));
      await BUS.saveConfig(env.store, { ideasPeer: "idea-gen", receivablePeers: "" });
      const pull = await BUS.pullInbound(env.store, "ideas");
      if (!pull.ok || pull.bundles.length !== 1) return { pass: false, detail: "pull failed: " + JSON.stringify(pull) };
      const doc0 = await busDoc(env);
      const inlog = recOf(doc0, "inlog-ideas");
      if (!inlog || !inlog.ok || inlog.count !== 1 || inlog.stream !== "ideas") return { pass: false, detail: "inlog wrong: " + JSON.stringify(inlog) };
      const res = await BUS.importIdea(env.store, pull.bundles[0], { sourceGen: "idea-gen" });
      if (!res.ok || !res.leadId) return { pass: false, detail: "import failed: " + JSON.stringify(res) };
      const lDoc = await env.store.loadDoc("leads", { refresh: true });
      const leads = R.recordsOf(lDoc.content);
      if (leads.length !== 1) return { pass: false, detail: "lead count wrong: " + leads.length };
      const lead = leads[0];
      if (lead.name !== "Churn predictor" || lead.status !== "qualified" || lead.source !== "Idea incubator") return { pass: false, detail: "lead mapping wrong: " + JSON.stringify(lead) };
      if (!lead.busIdea || lead.busIdea.bundleId !== "idea-1" || lead.busIdea.ideaId !== "i-1") return { pass: false, detail: "busIdea ref wrong" };
      if (!lead.notes || lead.notes.indexOf("Predict accounts at risk.") === -1 || lead.notes.indexOf("Goals: Reduce churn 20%") === -1 || lead.notes.indexOf("• Build model") === -1 || lead.notes.indexOf("Suggested next steps") === -1) return { pass: false, detail: "notes composition wrong" };
      const evs = (lead.events || []).map(e => e.kind + ":" + (e.to || e.from || "")).join("|");
      if (evs.indexOf("create") === -1 || evs.indexOf("status:qualified") === -1) return { pass: false, detail: "lead events wrong: " + evs };
      const dup = await BUS.importIdea(env.store, pull.bundles[0]);
      if (dup.code !== "already_imported" || dup.leadId !== lead.id) return { pass: false, detail: "dedupe failed: " + JSON.stringify(dup) };
      const doc = await busDoc(env);
      if (!recOf(doc, "imp-idea-1")) return { pass: false, detail: "imp record missing" };
      const st = await BUS.importedState(env.store);
      if (!st.byBundle["idea-1"] || st.byBundle["idea-1"].leadId !== lead.id) return { pass: false, detail: "importedState wrong" };
      const lDoc2 = await env.store.loadDoc("leads", { refresh: true });
      if (R.recordsOf(lDoc2.content).length !== 1) return { pass: false, detail: "dedupe imported a second lead" };
      return { pass: true, detail: "manifest pull + lead mapping + dedupe verified" };
    });
  });

  T.register("bus: receivable pulls match by id and normalized name and set payment health per customer", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      await save(env.store, "companies", { records: [
        { id: "c-1", name: "Acme Industries", taxId: "vat-1" },
        { id: "c-2", name: "Beta Works" }
      ] });
      const b1 = outBundle("rc-1", "receivable", { at: daysFromNow(-3), company: { id: "c-1", name: "Acme Industries" }, amount: 1000, paid: 600, dueDate: "2026-10-01" });
      const b2 = outBundle("rc-2", "receivable", { at: daysFromNow(-2), company: { name: "beta works" }, amount: 500, paid: 0, status: "overdue", dueDate: "2026-09-01" });
      const b3 = outBundle("rc-3", "receivable", { at: daysFromNow(-1), company: { name: "Nope Corp" }, amount: 200, paid: 0 });
      peerWrite(env, "the-ledger", "bus-receivables", envelope("receivables", "the-ledger", [b1, b2, b3]));
      await BUS.saveConfig(env.store, { ideasPeer: "", receivablePeers: "the-ledger" });
      const res = await BUS.pullReceivables(env.store);
      if (!res.ok || res.matched.length !== 2 || res.unmatched.length !== 1) return { pass: false, detail: "pull counts wrong: " + JSON.stringify({ matched: res.matched, unmatched: res.unmatched }) };
      if (res.unmatched[0].reason !== "no matching customer" || res.unmatched[0].name !== "Nope Corp") return { pass: false, detail: "unmatched detail wrong" };
      const cDoc = await env.store.loadDoc("companies", { refresh: true });
      const c1 = recOf(cDoc.content, "c-1");
      const c2 = recOf(cDoc.content, "c-2");
      if (!c1.busPayment || c1.busPayment.status !== "partial" || c1.busPayment.label !== "Partially paid" || c1.busPayment.balance !== 400 || c1.busPayment.source !== "the-ledger") return { pass: false, detail: "c1 payment wrong: " + JSON.stringify(c1.busPayment) };
      if (!c2.busPayment || c2.busPayment.status !== "overdue" || c2.busPayment.dueDate !== "2026-09-01" || c2.busPayment.label !== "Overdue") return { pass: false, detail: "c2 payment wrong: " + JSON.stringify(c2.busPayment) };
      const single = await BUS.refreshCompanyPayment(env.store, "c-1");
      if (!single.pull.ok || single.pull.matched.length !== 1 || single.pull.matched[0].companyId !== "c-1") return { pass: false, detail: "single refresh wrong: " + JSON.stringify(single.pull) };
      if (!single.payment || single.payment.status !== "partial") return { pass: false, detail: "single payment missing: " + JSON.stringify(single.payment) };
      const doc = await busDoc(env);
      if (!recOf(doc, "rcv-c-1") || !recOf(doc, "inlog-receivables")) return { pass: false, detail: "rcv/inlog records missing" };
      return { pass: true, detail: "id+name matching, health + refresh verified" };
    });
  });

  T.register("bus: pulls without a configured peer fail gracefully and record the attempt", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      await BUS.saveConfig(env.store, { ideasPeer: "", receivablePeers: "" });
      const pull = await BUS.pullInbound(env.store, "ideas");
      if (!pull || pull.ok || pull.code !== "not_configured" || pull.bundles.length !== 0) return { pass: false, detail: "pull should be not_configured: " + JSON.stringify(pull) };
      const doc = await busDoc(env);
      const inlog = recOf(doc, "inlog-ideas");
      if (!inlog || inlog.ok !== false || inlog.code !== "not_configured") return { pass: false, detail: "inlog not recorded" };
      const rf = await BUS.readPeerFile("no-such-gen", "bus-ideas");
      if (!rf || rf.ok || rf.code !== "not_found") return { pass: false, detail: "readPeerFile not_found wrong: " + JSON.stringify(rf) };
      for (const code of ["not_configured", "not_found", "timeout", "bad_json", "bad_envelope", "no_edit_key", "requires_saved_generator", "file_too_big", "over_daily_allowance", "editable_error"]) {
        if (!BUS.describe(code)) return { pass: false, detail: "missing error copy for " + code };
      }
      return { pass: true, detail: "graceful failures + copy verified" };
    });
  });

  T.register("bus: resetStreamFile empties an outbound stream file and rejects inbound streams", async () => {
    const env = mockEnv();
    return withBus(env, async () => {
      const b1 = outBundle("bs-eeee", "project-seed", { opportunity: { id: "d-5", name: "Epsilon" } });
      await save(env.store, "bus", { records: [
        { id: "out-" + b1.id, kind: "out", stream: "projects", bundleId: b1.id, dealId: "d-5", at: b1.at, status: "mirrored", bundle: b1 }
      ] });
      const first = await BUS.materialize(env.store, "projects");
      if (!first.ok || first.added !== 1) return { pass: false, detail: "seed materialize failed" };
      const reset = await BUS.resetStreamFile(env.store, "projects");
      if (!reset.ok) return { pass: false, detail: "reset failed: " + JSON.stringify(reset) };
      const f = await fileEnv(env, "bus-projects");
      if (!f || f.bundles.length !== 0) return { pass: false, detail: "stream not emptied" };
      const again = await BUS.materialize(env.store, "projects");
      if (!again.ok || again.added !== 1) return { pass: false, detail: "re-publish after reset failed: " + JSON.stringify(again) };
      const inbound = await BUS.resetStreamFile(env.store, "ideas");
      if (!inbound || inbound.ok || inbound.code !== "not_out_stream") return { pass: false, detail: "inbound reset should fail" };
      return { pass: true, detail: "reset + re-publish verified" };
    });
  });

  T.register("bus: healthOf classifies paid, partial, overdue and open states with balances", () => {
    const paid = BUS.healthOf({ amount: 500, paid: 500 });
    if (paid.health !== "paid" || paid.label !== "Paid") return { pass: false, detail: "paid wrong: " + JSON.stringify(paid) };
    const partial = BUS.healthOf({ amount: 1000, paid: 250 });
    if (partial.health !== "partial" || partial.balance !== 750) return { pass: false, detail: "partial wrong: " + JSON.stringify(partial) };
    const overdue = BUS.healthOf({ amount: 100, paid: 0, status: "overdue", dueDate: "2026-08-01" });
    if (overdue.health !== "overdue" || overdue.dueDate !== "2026-08-01") return { pass: false, detail: "overdue wrong: " + JSON.stringify(overdue) };
    const open = BUS.healthOf({ amount: 100, paid: 0 });
    if (open.health !== "open" || open.label !== "Open") return { pass: false, detail: "open wrong: " + JSON.stringify(open) };
    const zeroBal = BUS.healthOf({ amount: 200, paid: 200, balance: 0 });
    if (zeroBal.health !== "paid") return { pass: false, detail: "zero balance not paid" };
    return { pass: true, detail: "four health states verified" };
  });
})();
