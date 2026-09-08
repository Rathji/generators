(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const D = window.CRM_DEALS;
  const LEADS = window.CRM_LEADS;
  const BUS = window.CRM_BUS;
  const DUP = window.CRM_DUP;
  const H = window.CRM_HEALTH;
  if (!T || !BS || !R || !D || !LEADS || !BUS || !DUP || !H) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];
  const DAY = 86400000;

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
    const store = BS.create({ ns: "fx" + BS.randHex(6), kv, editable, modules: ALL_MODULES.slice() });
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

  function twoDevice() {
    const ns = "fxsync" + BS.randHex(6);
    const files = new Map();
    const mapsA = new Map();
    const mapsB = new Map();
    function kvOf(map) {
      return {
        get: async k => map.get(k),
        set: async (k, v) => { map.set(k, v); },
        delete: async k => { map.delete(k); }
      };
    }
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
    const base = { ns, editable, modules: ["companies"] };
    const storeA = BS.create(Object.assign({}, base, { kv: kvOf(mapsA) }));
    const storeB = BS.create(Object.assign({}, base, { kv: kvOf(mapsB) }));
    function exportKeysToB() {
      for (const k of mapsA.keys()) if (k.startsWith("editkey:")) mapsB.set(k, mapsA.get(k));
    }
    return { files, mapsA, mapsB, editable, storeA, storeB, exportKeysToB };
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

  function eq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function headOf(files, store, module) {
    const f = files.get(store.fileName(module));
    return f ? JSON.parse(f.text) : null;
  }

  function recOf(content, id) {
    return (content.records || []).find(r => r && r.id === id) || null;
  }

  function envelope(streamId, gen, bundles) {
    return JSON.stringify({ k: "bcrm-bus", v: 1, stream: streamId, generator: gen, updatedAt: new Date().toISOString(), bundles });
  }

  function peerWrite(env, gen, file, text) {
    env.peerFiles.set(gen + "/" + file, { text });
  }

  async function fileEnv(env, name) {
    const t = await env.editable.get(name);
    return t ? JSON.parse(t) : null;
  }

  const daysAgo = n => new Date(Date.now() - n * DAY).toISOString();

  function legacyFixtureDocs() {
    return {
      companies: {
        records: [
          { id: "c-1", name: "Acme Industries", email: "billing@acme.example", status: "customer", owner: "Sam", website: "acme.example", active: true },
          { id: "c-2", name: "Beta Works", status: "lead", phone: "+1 555 0101", active: true },
          null,
          "stray text",
          { id: "" },
          {}
        ]
      },
      contacts: {
        records: [
          { id: "ct-1", name: "Pat Smith", email: "pat@acme.example", companyId: "c-1", title: "Ops lead", active: true },
          { id: "ct-2", name: "Dana Lee", email: "dana@beta.example", companyId: "c-2", active: true },
          null,
          "stray contact"
        ]
      },
      leads: {
        records: [
          { id: "l-1", name: "Acme pilot", status: "qualified", companyId: "c-1", owner: "Sam", source: "Website", active: true },
          { id: "l-2", name: "Beta upsell", status: "qualified", companyId: "c-2", active: true }
        ]
      },
      deals: {
        records: [
          { id: "d-1", name: "Acme licence", companyId: "c-1", contactId: "ct-1", stage: "proposal", expectedValue: 24000, probability: "60", closeDate: "2026-12-20", owner: "Sam", createdAt: "2026-02-01T09:00:00.000Z", active: true },
          { id: "d-2", name: "Beta trial", companyId: "c-2", contactId: "ct-2", stage: "qualification", expectedValue: 0, probability: null, active: true }
        ]
      },
      activities: {
        records: [
          { id: "a-1", kind: "call", type: "call", at: "2026-03-01T10:00:00.000Z", companyId: "c-1", contactId: "ct-1", dealId: "d-1", note: "legacy activity", active: true },
          null,
          "stray activity",
          { id: 0 }
        ]
      },
      emails: {
        records: [
          { id: "em-1", to: "pat@acme.example", subject: "Proposal follow-up", at: "2026-03-02T10:00:00.000Z", active: true }
        ]
      },
      segments: {
        records: [
          { id: "sg-1", name: "Enterprise accounts", criteria: { industry: "Software" }, active: true }
        ]
      },
      rules: {
        records: [
          { id: "rl-1", name: "Tag big deals", when: "expectedValue>10000", then: "tag big", active: true }
        ]
      },
      bus: {
        records: [
          { id: "rcv-c-1", kind: "rcv", companyId: "c-1", status: "partial", at: "2026-03-03T10:00:00.000Z" }
        ]
      },
      reports: {
        records: [
          { id: "rp-1", kind: "snapshot", name: "Monthly", at: "2026-03-03T10:00:00.000Z" }
        ]
      }
    };
  }

  T.register("fixtures: legacy-schema and malformed rows round-trip byte-for-byte through save and load", async () => {
    const env = mockEnv();
    const docs = legacyFixtureDocs();
    for (const m of ALL_MODULES) {
      await save(env.store, m, docs[m]);
    }
    for (const m of ALL_MODULES) {
      const doc = await env.store.loadDoc(m, { refresh: true });
      if (!doc.ok || !doc.content) return { pass: false, detail: m + " did not reload: " + JSON.stringify(doc).slice(0, 160) };
      if (!eq(doc.content, docs[m])) return { pass: false, detail: m + " content changed across a save/load round trip: " + JSON.stringify(doc.content).slice(0, 300) };
      if (!(doc.revision >= 1)) return { pass: false, detail: m + " revision not tracked" };
    }
    const cDoc = await env.store.loadDoc("companies", { refresh: true });
    const rows = cDoc.content.records;
    if (rows.length !== 6) return { pass: false, detail: "companies junk rows were dropped: " + rows.length };
    if (rows[2] !== null || rows[3] !== "stray text") return { pass: false, detail: "null/string junk row not preserved verbatim" };
    const dDoc = await env.store.loadDoc("deals", { refresh: true });
    const d1 = recOf(dDoc.content, "d-1");
    if (d1.probability !== "60" || d1.closeDate !== "2026-12-20") return { pass: false, detail: "legacy string probability not preserved" };
    return { pass: true, detail: ALL_MODULES.length + " legacy documents round-trip byte-for-byte with junk rows intact" };
  });

  T.register("fixtures: a stale offline edit over a legacy document conflicts cleanly and field-merges both sides plus legacy fields", async () => {
    const p = twoDevice();
    const A = p.storeA;
    const B = p.storeB;
    const rev1 = { records: [{ id: "c-1", name: "Acme Industries", status: "customer", website: "acme.example", email: "billing@acme.example", owner: "Sam", active: true }] };
    const r1 = await A.saveChecked("companies", rev1, { expectedBase: 0 });
    if (!r1.ok || r1.revision !== 1) return { pass: false, detail: "A create failed: " + JSON.stringify(r1) };
    p.exportKeysToB();
    const bl = await B.loadDoc("companies");
    if (!bl.ok || bl.revision !== 1) return { pass: false, detail: "B initial load failed: " + JSON.stringify(bl) };
    const theirs = { records: [{ id: "c-1", name: "Acme Industries", status: "customer", website: "acme.example", email: "billing@acme.example", owner: "Samantha Jones", active: true, note: "renewal due 2026" }] };
    const r2 = await A.saveChecked("companies", theirs, { expectedBase: 1 });
    if (!r2.ok || r2.revision !== 2) return { pass: false, detail: "A second write failed: " + JSON.stringify(r2) };
    const mine = { records: [{ id: "c-1", name: "Acme Industries Inc", status: "customer", website: "acme.example", email: "billing@acme.example", owner: "Sam", active: true, phone: "+1 555 0100" }] };
    const cr = await B.saveChecked("companies", mine, { expectedBase: 1 });
    if (cr.ok || cr.code !== "conflict") return { pass: false, detail: "expected conflict, got " + JSON.stringify(cr).slice(0, 200) };
    if (!cr.conflict || !cr.conflict.theirs || cr.conflict.theirs.revision !== 2) return { pass: false, detail: "conflict record wrong" };
    const head = headOf(p.files, A, "companies");
    if (head.revision !== 2 || !eq(head.content, theirs)) return { pass: false, detail: "canonical was modified by the losing save" };
    const md = await B.mergeDiff("companies");
    if (!md.ok) return { pass: false, detail: "mergeDiff failed: " + JSON.stringify(md) };
    const changed = (md.diff.records.changed || []).find(r => String(r.id) === "c-1");
    if (!changed) return { pass: false, detail: "record not flagged as changed on both sides" };
    const built = await B.buildMerged("companies", {});
    if (!built.ok) return { pass: false, detail: "buildMerged failed: " + JSON.stringify(built) };
    const m = built.merged;
    const rec1 = recOf(m, "c-1");
    if (!rec1) return { pass: false, detail: "merged record missing" };
    if (rec1.name !== "Acme Industries Inc") return { pass: false, detail: "mine-only name change lost: " + JSON.stringify(rec1.name) };
    if (rec1.owner !== "Samantha Jones") return { pass: false, detail: "theirs-only owner change lost: " + rec1.owner };
    if (rec1.note !== "renewal due 2026" || rec1.phone !== "+1 555 0100") return { pass: false, detail: "single-side field lost: " + JSON.stringify({ note: rec1.note, phone: rec1.phone }) };
    if (rec1.status !== "customer" || rec1.website !== "acme.example" || rec1.active !== true) return { pass: false, detail: "untouched legacy fields dropped by the merge" };
    const rr = await B.resolveConflict("companies", "merge", { merged: m, picks: {} });
    if (!rr.ok || rr.revision !== 3) return { pass: false, detail: "merge resolve failed: " + JSON.stringify(rr) };
    const head2 = headOf(p.files, A, "companies");
    if (head2.revision !== 3 || !eq(head2.content, m)) return { pass: false, detail: "canonical does not hold the merged document" };
    const conflicts = await B.listConflicts();
    if (conflicts.length) return { pass: false, detail: "conflict not cleared after merge" };
    const ld = await B.loadDoc("companies");
    if (!ld.ok || !eq(ld.content, m)) return { pass: false, detail: "cache not refreshed to merged content" };
    return { pass: true, detail: "offline legacy edit conflicted, field-merged to rev 3 with both edits and legacy fields intact" };
  });

  T.register("fixtures: merging legacy duplicate companies rewrites every reference and keeps both records' data", async () => {
    const env = mockEnv();
    await save(env.store, "companies", { records: [
      { id: "c-1", name: "Acme Industries", status: "customer", email: "billing@acme.example", active: true },
      { id: "c-2", name: "acme industries", status: "lead", website: "acme.example", phone: "+1 555 0000", active: true }
    ] });
    await save(env.store, "contacts", { records: [
      { id: "ct-1", name: "Pat Smith", email: "pat@acme.example", companyId: "c-1", active: true },
      { id: "ct-2", name: "Dana Lee", email: "dana@acme.example", companyId: "c-2", active: true },
      { id: "ct-3", name: "Solo Dolo", email: "solo@example.com", active: true }
    ] });
    await save(env.store, "leads", { records: [
      { id: "l-1", name: "Acme pilot", status: "qualified", companyId: "c-1", active: true },
      { id: "l-2", name: "Acme renewals", status: "qualified", companyId: "c-2", active: true }
    ] });
    await save(env.store, "deals", { records: [
      { id: "d-1", name: "Acme licence", companyId: "c-2", stage: "open", expectedValue: 24000, active: true }
    ] });
    const cDoc0 = await env.store.loadDoc("companies", { refresh: true });
    const pairs = DUP.candidatePairs("companies", cDoc0.content.records);
    if (!pairs.length || pairs[0].reasons.indexOf("same name") === -1) return { pass: false, detail: "fixture duplicate not detected" };
    const res = await DUP.mergeRecords(env.store, { module: "companies", survivorId: "c-1", dupId: "c-2", note: "Legacy duplicate from import" });
    if (!res.ok) return { pass: false, detail: "merge failed: " + JSON.stringify(res) };
    const rw = {};
    for (const w of res.rewrites) rw[w.module] = w.count;
    if (rw.contacts !== 1 || rw.leads !== 1 || rw.deals !== 1) return { pass: false, detail: "rewrites wrong: " + JSON.stringify(res.rewrites) };
    const cDoc = await env.store.loadDoc("companies", { refresh: true });
    if (recOf(cDoc.content, "c-2")) return { pass: false, detail: "duplicate record still present" };
    const surv = recOf(cDoc.content, "c-1");
    if (!surv.merges || surv.merges[0].dupId !== "c-2") return { pass: false, detail: "merge journal missing" };
    if (surv.website !== "acme.example" || surv.phone !== "+1 555 0000") return { pass: false, detail: "legacy fields were not carried over" };
    if (surv.email !== "billing@acme.example") return { pass: false, detail: "survivor's own data was clobbered" };
    const ctDoc = await env.store.loadDoc("contacts", { refresh: true });
    const ct2 = recOf(ctDoc.content, "ct-2");
    const ct3 = recOf(ctDoc.content, "ct-3");
    if (!ct2 || ct2.companyId !== "c-1") return { pass: false, detail: "contact ref not rewritten" };
    if (!ct3 || ct3.companyId !== undefined) return { pass: false, detail: "standalone contact was touched" };
    const lDoc = await env.store.loadDoc("leads", { refresh: true });
    if (recOf(lDoc.content, "l-2").companyId !== "c-1") return { pass: false, detail: "lead ref not rewritten" };
    const dDoc = await env.store.loadDoc("deals", { refresh: true });
    if (recOf(dDoc.content, "d-1").companyId !== "c-1") return { pass: false, detail: "deal ref not rewritten" };
    const again = await DUP.mergeRecords(env.store, { module: "companies", survivorId: "c-1", dupId: "c-2" });
    if (again.ok || again.code !== "not_found") return { pass: false, detail: "second merge should not find the duplicate" };
    const prob = H.problemsFor({
      companies: cDoc.content.records,
      contacts: ctDoc.content.records,
      leads: lDoc.content.records,
      deals: dDoc.content.records,
      activities: []
    });
    if (!prob.problems || prob.problems.some(x => x.code === "dup_companies" || x.code === "orphan_contact")) return { pass: false, detail: "health still reports issues after merge: " + JSON.stringify((prob.problems || []).map(x => x.code)) };
    return { pass: true, detail: "legacy dup merged; refs rewritten across contacts/leads/deals; legacy data carried" };
  });

  T.register("fixtures: a full legacy backup survives total local data loss via validate and restore", async () => {
    const env = mockEnv();
    const docs = legacyFixtureDocs();
    for (const m of ALL_MODULES) {
      await save(env.store, m, docs[m]);
    }
    const built = await env.store.buildBackup();
    if (!built.ok) return { pass: false, detail: "buildBackup failed: " + JSON.stringify(built).slice(0, 300) };
    if (built.summary.present !== ALL_MODULES.length || built.summary.absent.length) return { pass: false, detail: "backup summary wrong: " + JSON.stringify(built.summary) };
    const raw = JSON.stringify(built.snapshot);
    const v = await env.store.validateBackup(raw);
    if (!v.ok) return { pass: false, detail: "validateBackup failed: " + JSON.stringify(v).slice(0, 300) };
    const pv = await env.store.previewBackup(raw);
    if (!pv.ok) return { pass: false, detail: "previewBackup failed: " + JSON.stringify(pv).slice(0, 300) };
    for (const m of ALL_MODULES) {
      env.editable.files.delete(env.store.fileName(m));
      for (const k of Array.from(env.kvStore.keys())) {
        if (k.startsWith("doc:")) env.kvStore.delete(k);
      }
    }
    const res = await env.store.restoreBackup(raw);
    if (!res.ok) return { pass: false, detail: "restoreBackup failed: " + JSON.stringify(res).slice(0, 400) };
    for (const m of ALL_MODULES) {
      const act = res.results && res.results[m] ? res.results[m].action : "?";
      if (act !== "create" && act !== "noop") return { pass: false, detail: m + " restore action " + act + ": " + JSON.stringify(res.results[m]) };
      const doc = await env.store.loadDoc(m, { refresh: true });
      if (!doc.ok) return { pass: false, detail: m + " unreadable after restore: " + JSON.stringify(doc).slice(0, 160) };
      if (!eq(doc.content, docs[m])) return { pass: false, detail: m + " content differs after restore: " + JSON.stringify(doc.content).slice(0, 300) };
    }
    const ctDoc = await env.store.loadDoc("contacts", { refresh: true });
    if (!ctDoc.ok) return { pass: false, detail: "contacts unreadable before rewrite" };
    const changed = JSON.parse(JSON.stringify(ctDoc.content));
    const ct1 = recOf(changed, "ct-1");
    ct1.phone = "+1 555 0100";
    const again = await env.store.saveChecked("contacts", changed, { expectedBase: ctDoc.revision });
    if (!again.ok) return { pass: false, detail: "restored store cannot accept new writes: " + JSON.stringify(again) };
    const reread = await env.store.loadDoc("contacts", { refresh: true });
    if (!reread.ok || !recOf(reread.content, "ct-1").phone) return { pass: false, detail: "rewritten doc not persisted" };
    return { pass: true, detail: "legacy backup validated and restored byte-for-byte after total local data loss" };
  });

  T.register("fixtures: a legacy lead converts through deal, won, customer and bus handoff exactly once", async () => {
    const env = mockEnv();
    await save(env.store, "companies", { records: [
      { id: "c-1", name: "Acme Industries", email: "billing@acme.example", status: "customer", owner: "Sam", website: "acme.example", active: true }
    ] });
    await save(env.store, "contacts", { records: [
      { id: "ct-1", name: "Pat Smith", email: "pat@acme.example", companyId: "c-1", active: true }
    ] });
    await save(env.store, "leads", { records: [
      { id: "l-1", name: "Acme pilot", status: "qualified", companyId: "c-1", owner: "Sam", source: "Website", active: true }
    ] });
    await save(env.store, "deals", { records: [] });
    return withBus(env, async () => {
      const lDoc0 = await env.store.loadDoc("leads", { refresh: true });
      const lead = recOf(lDoc0.content, "l-1");
      const conv = await LEADS.convertToDeal(env.store, lead, { note: "Converted from pilot" });
      if (!conv.ok || !conv.dealId) return { pass: false, detail: "convert failed: " + JSON.stringify(conv) };
      const dealId = conv.dealId;
      const lDoc = await env.store.loadDoc("leads", { refresh: true });
      const l1 = recOf(lDoc.content, "l-1");
      if (l1.status !== "converted" || l1.convertedToDealId !== dealId || !l1.convertedAt) return { pass: false, detail: "lead not marked converted: " + JSON.stringify(l1) };
      const dDoc0 = await env.store.loadDoc("deals", { refresh: true });
      const deal0 = recOf(dDoc0.content, dealId);
      if (!deal0 || deal0.stage !== "qualification" || deal0.leadId !== "l-1" || deal0.companyId !== "c-1") return { pass: false, detail: "created deal wrong: " + JSON.stringify(deal0) };
      const mv = await D.changeStage(env.store, dealId, "won", { note: "Signed" });
      if (!mv.ok || !mv.moved || mv.moved.to !== "won") return { pass: false, detail: "stage move failed: " + JSON.stringify(mv) };
      const cust = await D.convertWonToCustomer(env.store, dealId, {});
      if (!cust.ok || cust.companyId !== "c-1" || !cust.customerSince) return { pass: false, detail: "customer conversion failed: " + JSON.stringify(cust) };
      const cDoc = await env.store.loadDoc("companies", { refresh: true });
      const c1 = recOf(cDoc.content, "c-1");
      if (c1.isCustomer !== true || !c1.customerSince) return { pass: false, detail: "company not promoted: " + JSON.stringify(c1) };
      if (c1.email !== "billing@acme.example" || c1.website !== "acme.example") return { pass: false, detail: "legacy company fields lost on promotion" };
      const dDoc = await env.store.loadDoc("deals", { refresh: true });
      const wonDeal = recOf(dDoc.content, dealId);
      if (wonDeal.stage !== "won" || !wonDeal.wonAt || !wonDeal.convertedToCustomerAt) return { pass: false, detail: "deal final state wrong" };
      if (!(wonDeal.events || []).some(e => e.kind === "customer")) return { pass: false, detail: "customer event not journaled" };
      const pub = await BUS.publishProjectSeed(env.store, wonDeal);
      if (!pub.ok || pub.noop) return { pass: false, detail: "handoff publish failed: " + JSON.stringify(pub) };
      const f = await fileEnv(env, "bus-projects");
      if (!f || f.bundles.length !== 1) return { pass: false, detail: "no project-seed bundle in stream file" };
      const b = f.bundles[0];
      if (b.kind !== "project-seed" || b.opportunity.id !== dealId || b.opportunity.name !== "Acme pilot") return { pass: false, detail: "opportunity payload wrong: " + JSON.stringify(b.opportunity) };
      if (!b.company || b.company.id !== "c-1" || b.company.name !== "Acme Industries") return { pass: false, detail: "company snapshot wrong" };
      if (!b.contact || b.contact.email !== "pat@acme.example") return { pass: false, detail: "contact snapshot wrong" };
      const dDoc2 = await env.store.loadDoc("deals", { refresh: true });
      const flagged = recOf(dDoc2.content, dealId);
      if (!flagged.busHandoff || !flagged.busHandoff.bundleId) return { pass: false, detail: "deal not flagged with busHandoff" };
      const busDoc = await env.store.loadDoc("bus", { refresh: true });
      const outRecs = (busDoc.content.records || []).filter(r => r && r.kind === "out" && r.stream === "projects" && r.dealId === dealId);
      if (outRecs.length !== 1 || outRecs[0].status !== "mirrored") return { pass: false, detail: "out record wrong: " + JSON.stringify(outRecs) };
      const second = await BUS.publishProjectSeed(env.store, flagged);
      if (!second.noop) return { pass: false, detail: "second publish must noop" };
      const f2 = await fileEnv(env, "bus-projects");
      if (f2.bundles.length !== 1) return { pass: false, detail: "double-send: file has " + f2.bundles.length };
      const man = await fileEnv(env, "bus-manifest");
      if (!man || !man.streams.projects || man.streams.projects.file !== "bus-projects") return { pass: false, detail: "manifest missing the projects stream" };
      return { pass: true, detail: "legacy chain lead→deal→won→customer→handoff completed; single bundle published" };
    });
  });

  T.register("fixtures: junk rows and malformed peer payloads are tolerated by readers and the bus pull", async () => {
    const env = mockEnv();
    const companies = [
      { id: "c-1", name: "Acme Industries", taxId: "vat-1", active: true },
      null,
      "stray",
      {},
      { id: "" }
    ];
    const contacts = [
      { id: "ct-1", name: "Pat Smith", email: "pat@acme.example", companyId: "c-1", active: true },
      null,
      "stray",
      {}
    ];
    const got = R.getRecord({ records: companies }, "c-1");
    if (!got || got.name !== "Acme Industries") return { pass: false, detail: "getRecord failed among junk rows" };
    const sorted = R.sortByName(contacts.slice());
    if (!Array.isArray(sorted) || sorted.length !== 4) return { pass: false, detail: "sortByName choked on junk" };
    const filt = R.filterRecords(contacts, "pat");
    if (filt.length !== 1 || filt[0].id !== "ct-1") return { pass: false, detail: "filterRecords choked on junk" };
    const pairs = DUP.candidatePairs("companies", companies);
    if (!Array.isArray(pairs) || pairs.length) return { pass: false, detail: "candidatePairs flagged junk: " + JSON.stringify(pairs) };
    let health;
    try {
      health = H.problemsFor({ companies, contacts, leads: [], deals: [], activities: [null, "x", {}] });
    } catch (e) {
      return { pass: false, detail: "problemsFor threw on junk: " + (e && e.message) };
    }
    if (!health || !Array.isArray(health.problems)) return { pass: false, detail: "problemsFor did not return a result object with problems: " + JSON.stringify(health) };
    if (health.problems.some(x => x.code === "orphan_contact" || x.code === "dup_companies")) return { pass: false, detail: "problemsFor misread junk rows: " + health.problems.map(x => x.code).join(",") };
    await save(env.store, "companies", { records: companies });
    await save(env.store, "contacts", { records: contacts });
    return withBus(env, async () => {
      const b1 = { id: "rc-1", at: daysAgo(3), kind: "receivable", company: { id: "c-1", name: "Acme Industries" }, amount: 1000, paid: 600, dueDate: "2026-10-01" };
      const b2 = { id: "rc-2", at: daysAgo(2), kind: "receivable", company: { name: "acme industries" }, amount: 500, paid: 0, status: "overdue" };
      peerWrite(env, "the-ledger", "bus-receivables", envelope("receivables", "the-ledger", [b1, "junk-string", null, { no: "id" }, b2]));
      await BUS.saveConfig(env.store, { ideasPeer: "", receivablePeers: "the-ledger" });
      const pull = await BUS.pullReceivables(env.store);
      if (!pull.ok) return { pass: false, detail: "pull over malformed payload failed: " + JSON.stringify(pull) };
      if (pull.matched.length !== 2 || pull.unmatched.length !== 0) return { pass: false, detail: "match counts wrong: " + JSON.stringify({ matched: pull.matched, unmatched: pull.unmatched }) };
      const cDoc = await env.store.loadDoc("companies", { refresh: true });
      const c1 = recOf(cDoc.content, "c-1");
      if (!c1.busPayment || c1.busPayment.status !== "overdue" || c1.busPayment.source !== "the-ledger") return { pass: false, detail: "payment health wrong: " + JSON.stringify(c1.busPayment) };
      return { pass: true, detail: "junk rows and malformed peer bundles ignored without crashing; valid bundles still processed" };
    });
  });
})();
