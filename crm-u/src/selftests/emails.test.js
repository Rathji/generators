(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const R = window.CRM_RECORDS;
  const E = window.CRM_EMAILS;
  if (!T || !BS || !R || !E) return;

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
    const ns = "em" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ALL_MODULES.slice() }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  async function seedWorld(store) {
    await store.saveChecked("companies", { records: [
      { id: "c-1", name: "Acme Industries", industry: "Logistics" }
    ] }, { expectedBase: 0 });
    await store.saveChecked("contacts", { records: [
      { id: "ct-1", name: "Pat Smith", companyId: "c-1", email: "pat@acme.example", role: "Procurement lead" }
    ] }, { expectedBase: 0 });
    await store.saveChecked("deals", { records: [
      { id: "d-1", name: "Acme licence", companyId: "c-1", expectedValue: 24000, closeDate: "2026-12-31", stage: "proposal" }
    ] }, { expectedBase: 0 });
  }

  T.register("emails: template validation and id generation", () => {
    const none = E.validateTemplate({});
    if (none.ok || !none.errors.name || !none.errors.subject) return { pass: false, detail: "blank template accepted" };
    const long = E.validateTemplate({ name: "x", subject: "s", body: "y".repeat(13000) });
    if (long.ok || !long.errors.body) return { pass: false, detail: "oversized body accepted" };
    const good = E.validateTemplate({ name: "  Follow-up  ", subject: "Re: {{company.name}}", body: "Hi {{contact.first_name}},\n\nbody" });
    if (!good.ok) return { pass: false, detail: "valid template rejected: " + JSON.stringify(good.errors) };
    if (good.values.name !== "Follow-up") return { pass: false, detail: "name not trimmed" };
    const t1 = E.applyTemplate(null, good.values);
    const t2 = E.applyTemplate(null, good.values);
    if (!/^t-[a-f0-9]{6}$/.test(t1.id)) return { pass: false, detail: "template id malformed: " + t1.id };
    if (t1.id === t2.id) return { pass: false, detail: "template ids collide" };
    if (!t1.createdAt || t1.subject !== good.values.subject) return { pass: false, detail: "template fields wrong" };
    return { pass: true, detail: "validate + id verified" };
  });

  T.register("emails: templates persist, edit and delete through the store", async () => {
    const env = mockEnv();
    const tpl = E.applyTemplate(null, E.validateTemplate({ name: "Intro", subject: "Hello {{contact.first_name}}", body: "Welcome" }).values);
    const created = await E.upsertTemplate(env.store, tpl);
    if (!created || !created.ok) return { pass: false, detail: "create failed: " + JSON.stringify(created) };
    let list = await E.listTemplates(env.store);
    if (list.length !== 1 || list[0].name !== "Intro") return { pass: false, detail: "list wrong after create" };
    const edited = Object.assign({}, tpl, { name: "Intro v2", body: "Welcome back" });
    const upd = await E.upsertTemplate(env.store, edited);
    if (!upd || !upd.ok) return { pass: false, detail: "update failed: " + JSON.stringify(upd) };
    list = await E.listTemplates(env.store);
    if (list.length !== 1 || list[0].name !== "Intro v2" || list[0].body !== "Welcome back") return { pass: false, detail: "edit not applied" };
    const tpl3 = E.applyTemplate(null, E.validateTemplate({ name: "Second", subject: "S", body: "B" }).values);
    await E.upsertTemplate(env.store, tpl3);
    list = await E.listTemplates(env.store);
    if (list.length !== 2) return { pass: false, detail: "second template missing" };
    const del = await E.deleteTemplate(env.store, tpl.id);
    if (!del || !del.ok) return { pass: false, detail: "delete failed" };
    list = await E.listTemplates(env.store);
    if (list.length !== 1 || list[0].id === tpl.id) return { pass: false, detail: "delete wrong" };
    const doc = await env.store.loadDoc("emails", { refresh: true });
    if (!doc.content.templates) return { pass: false, detail: "emails doc lost templates array" };
    return { pass: true, detail: "template CRUD verified" };
  });

  T.register("emails: merge replaces known tokens and leaves unknown literal", async () => {
    const out = E.renderMerge("Hi {{contact.first_name}} at {{company.name}}, {{missing.thing}} today is {{today}}.", {
      company: { name: "Acme" },
      contact: { first_name: "Pat" }
    });
    if (!out.startsWith("Hi Pat at Acme, ")) return { pass: false, detail: "merge wrong: " + out };
    if (!out.includes("{{missing.thing}}")) return { pass: false, detail: "unknown token was swallowed: " + out };
    if (!/today is \w{3,9} \d{1,2}, \d{4}/.test(out)) return { pass: false, detail: "today token not filled: " + out };
    const withToday = E.renderMerge("d {{today}}", {});
    if (withToday.includes("{{today}}")) return { pass: false, detail: "today token not filled: " + withToday };
    const nested = E.renderMerge("{{a.b.c}}", { a: { b: { c: "deep" } } });
    if (nested !== "deep") return { pass: false, detail: "nested lookup failed" };
    return { pass: true, detail: "merge tokens verified" };
  });

  T.register("emails: scope builds company, contact and deal context with fallbacks", async () => {
    const env = mockEnv();
    await seedWorld(env.store);
    const byContact = await E.buildScope(env.store, { contactId: "ct-1" });
    if (byContact.company.name !== "Acme Industries" || byContact.contact.full_name !== "Pat Smith") return { pass: false, detail: "contact scope wrong: " + JSON.stringify(byContact) };
    if (byContact.contact.first_name !== "Pat" || byContact.contact.last_name !== "Smith" || byContact.contact.email !== "pat@acme.example" || byContact.contact.role !== "Procurement lead") {
      return { pass: false, detail: "contact fields wrong: " + JSON.stringify(byContact.contact) };
    }
    const byCompany = await E.buildScope(env.store, { companyId: "c-1" });
    if (byCompany.company.industry !== "Logistics" || byCompany.contact !== undefined) return { pass: false, detail: "company scope wrong" };
    const byDeal = await E.buildScope(env.store, { dealId: "d-1" });
    if (byDeal.deal.name !== "Acme licence" || byDeal.deal.expected_value !== "$24,000" || byDeal.company.name !== "Acme Industries") {
      return { pass: false, detail: "deal scope wrong: " + JSON.stringify(byDeal) };
    }
    return { pass: true, detail: "scope building verified" };
  });

  T.register("emails: logEmail writes an email activity with default outcome", async () => {
    const env = mockEnv();
    await seedWorld(env.store);
    const res = await E.logEmail(env.store, {
      subject: "Hello Pat", at: new Date().toISOString(), to: "pat@acme.example",
      notes: "Body text", companyId: "c-1", contactId: "ct-1", dealId: "d-1"
    });
    if (!res || !res.ok) return { pass: false, detail: "logEmail failed: " + JSON.stringify(res) };
    const doc = await env.store.loadDoc("activities", { refresh: true });
    const rec = doc.content.records[0];
    if (!rec || rec.type !== "email" || rec.outcome !== "sent") return { pass: false, detail: "email record wrong: " + JSON.stringify(rec) };
    if (rec.to !== "pat@acme.example" || rec.companyId !== "c-1" || rec.contactId !== "ct-1" || rec.dealId !== "d-1") return { pass: false, detail: "links wrong" };
    const bad = await E.logEmail(env.store, { to: "pat@acme.example" });
    if (bad.ok || !bad.errors.subject) return { pass: false, detail: "subjectless email accepted" };
    const replied = await E.logEmail(env.store, { subject: "Re", at: new Date().toISOString(), to: "pat@acme.example", outcome: "replied" });
    if (!replied.ok) return { pass: false, detail: "replied outcome rejected" };
    const doc2 = await env.store.loadDoc("activities", { refresh: true });
    const rec2 = doc2.content.records.find(r => r.subject === "Re");
    if (rec2.outcome !== "replied" || !rec2.repliedAt) return { pass: false, detail: "reply flags wrong" };
    return { pass: true, detail: "logEmail verified" };
  });
})();
