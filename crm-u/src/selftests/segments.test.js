(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const S = window.CRM_SEGMENTS;
  if (!T || !BS || !R || !S) return;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];

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
    const ns = "sg" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  T.register("segments: rule matching covers booleans, numbers, strings, arrays and set-tests", () => {
    const rec = {
      id: "c-1",
      name: "Acme Industries",
      isCustomer: true,
      active: true,
      employees: 250,
      industry: "Software / SaaS",
      tags: ["partner", "europe"],
      website: "acme.example"
    };
    const M = { module: "companies" };
    const t = (label, rules, expect) => {
      const hit = S.segMatches(Object.assign({ kind: "all", rules }, M), rec, null);
      if (hit !== expect) throw new Error(label + ": expected " + expect + " got " + hit);
    };
    try {
      t("bool eq", [{ f: "isCustomer", op: "eq", v: true }], true);
      t("bool ne", [{ f: "isCustomer", op: "ne", v: true }], false);
      t("num gte", [{ f: "employees", op: "gte", v: 200 }], true);
      t("num lt", [{ f: "employees", op: "lt", v: 200 }], false);
      t("between inclusive", [{ f: "employees", op: "between", from: 100, to: 300 }], true);
      t("between open-ended", [{ f: "employees", op: "between", from: 300 }], false);
      t("string contains", [{ f: "industry", op: "contains", v: "software" }], true);
      t("tag eq", [{ f: "tags", op: "eq", v: "partner" }], true);
      t("tag missing", [{ f: "tags", op: "eq", v: "vip" }], false);
      t("tag contains", [{ f: "tags", op: "contains", v: "euro" }], true);
      t("is_set on value", [{ f: "website", op: "is_set" }], true);
      t("is_empty missing", [{ f: "taxId", op: "is_empty" }], true);
      t("all rules combine", [{ f: "isCustomer", op: "eq", v: true }, { f: "employees", op: "gte", v: 200 }], true);
    } catch (e) {
      return { pass: false, detail: e.message };
    }
    const anySeg = Object.assign({ kind: "any", rules: [{ f: "employees", op: "lt", v: 10 }, { f: "tags", op: "eq", v: "partner" }] }, M);
    if (!S.segMatches(anySeg, rec, null)) return { pass: false, detail: "any-kind match failed" };
    return { pass: true, detail: "bool/num/string/array/range rules verified" };
  });

  T.register("segments: virtual days-since-last-activity resolves from the activities document", async () => {
    const env = mockEnv();
    const s = env.store;
    const DAY = 86400000;
    const old = new Date(Date.now() - 40 * DAY).toISOString();
    const recent = new Date(Date.now() - 5 * DAY).toISOString();
    await s.saveChecked("companies", { records: [
      { id: "c-1", name: "Quiet Co" },
      { id: "c-2", name: "Chatty Co" },
      { id: "c-3", name: "Silent Co" }
    ] }, { expectedBase: 0 });
    await s.saveChecked("activities", { records: [
      { id: "a-1", at: old, companyId: "c-1" },
      { id: "a-2", at: recent, companyId: "c-2" }
    ] }, { expectedBase: 0 });
    const aidx = await S.activityIndex(s);
    if (aidx.companies["c-1"] !== Date.parse(old) || aidx.companies["c-2"] !== Date.parse(recent)) {
      return { pass: false, detail: "activity index wrong: " + JSON.stringify(aidx.companies) };
    }
    const seg = { module: "companies", kind: "all", rules: [{ f: "daysSinceLastActivity", op: "gte", v: 30 }] };
    const members = await S.members(s, seg);
    const ids = members.map(m => m.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(["c-1", "c-3"])) {
      return { pass: false, detail: "expected c-1 (40d) and c-3 (none), got " + ids.join(",") };
    }
    return { pass: true, detail: "no-activity 40d + never-active both match ≥30d rule" };
  });

  T.register("segments: saved segments round-trip through the segments document (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const r1 = await S.saveSegment(s, { module: "companies", name: "Big firms", kind: "all", rules: [{ f: "employees", op: "gte", v: 500 }] });
    if (!r1.ok) return { pass: false, detail: "save failed: " + JSON.stringify(r1) };
    const list1 = await S.listSegments(s, "companies");
    if (list1.length !== 1 || list1[0].name !== "Big firms") return { pass: false, detail: "list mismatch" };
    const seg = list1[0];
    const r2 = await S.saveSegment(s, { id: seg.id, module: "companies", name: "Bigger firms", kind: "all", rules: [{ f: "employees", op: "gte", v: 1000 }] });
    if (!r2.ok) return { pass: false, detail: "update failed: " + JSON.stringify(r2) };
    const list2 = await S.listSegments(s);
    if (list2.length !== 1 || list2[0].name !== "Bigger firms") return { pass: false, detail: "update not applied" };
    const r3 = await S.deleteSegment(s, seg.id);
    if (!r3.ok) return { pass: false, detail: "delete failed: " + JSON.stringify(r3) };
    const list3 = await S.listSegments(s);
    if (list3.length !== 0) return { pass: false, detail: "delete not applied" };
    return { pass: true, detail: "create → rename → delete round-trip on the segments doc" };
  });

  T.register("segments: members() counts live records per module; deals stage rules match ids and labels", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveChecked("companies", { records: [
      { id: "c-1", name: "Acme", isCustomer: true, employees: 300 },
      { id: "c-2", name: "Beta", isCustomer: true, employees: 40 },
      { id: "c-3", name: "Gamma", employees: 900 }
    ] }, { expectedBase: 0 });
    const cust = await S.members(s, { module: "companies", kind: "all", rules: [{ f: "isCustomer", op: "eq", v: true }] });
    if (cust.length !== 2) return { pass: false, detail: "expected 2 customers, got " + cust.length };
    const big = await S.members(s, { module: "companies", kind: "all", rules: [{ f: "employees", op: "gte", v: 500 }] });
    if (big.length !== 1 || big[0].id !== "c-3") return { pass: false, detail: "size segment wrong" };

    await s.saveChecked("deals", {
      pipeline: { stages: [{ id: "qualification", label: "Qualification" }, { id: "negotiation", label: "Negotiation" }], wonStage: "won", lostStage: "lost" },
      records: [
        { id: "d-1", name: "Acme expansion", stage: "negotiation", expectedValue: 50000 },
        { id: "d-2", name: "Beta renewal", stage: "qualification", expectedValue: 20000 }
      ]
    }, { expectedBase: 0 });
    const negByLabel = await S.members(s, { module: "deals", kind: "all", rules: [{ f: "stage", op: "eq", v: "Negotiation" }] });
    if (negByLabel.length !== 1 || negByLabel[0].id !== "d-1") return { pass: false, detail: "stage label match failed" };
    const negById = await S.members(s, { module: "deals", kind: "all", rules: [{ f: "stage", op: "eq", v: "negotiation" }] });
    if (negById.length !== 1) return { pass: false, detail: "stage id match failed" };
    const hot = await S.members(s, { module: "deals", kind: "all", rules: [{ f: "expectedValue", op: "gte", v: 30000 }, { f: "stage", op: "eq", v: "Negotiation" }] });
    if (hot.length !== 1) return { pass: false, detail: "combined value+stage segment failed" };
    return { pass: true, detail: "2 customers, 1 big firm; stage rules match label or id" };
  });

  T.register("segments: default rules adapt to each module's fields", () => {
    const c = S.defaultRuleFor("companies");
    const d = S.defaultRuleFor("deals");
    const l = S.defaultRuleFor("leads");
    const checks = [];
    if (!c.f || c.f === "custom") checks.push("companies default not a real field");
    if (!d.f || d.f === "custom") checks.push("deals default not a real field");
    if (!l.f || l.f === "custom") checks.push("leads default not a real field");
    const cDef = S.fieldDefsFor("companies").find(x => x.f === c.f);
    const dDef = S.fieldDefsFor("deals").find(x => x.f === d.f);
    if (cDef && cDef.type === "num" && typeof c.v === "boolean") checks.push("numeric default should not be boolean");
    if (dDef && dDef.type === "string" && d.f !== "stage" && d.v !== "") checks.push("string default value should be empty");
    return checks.length ? { pass: false, detail: checks.join(" | ") } : { pass: true, detail: c.f + " / " + d.f + " / " + l.f };
  });
})();
