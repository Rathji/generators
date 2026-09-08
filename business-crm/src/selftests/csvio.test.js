(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  const CSV = window.CRM_CSV;
  if (!T || !BS || !CSV) return;

  const ALL_MODULES = ["companies", "contacts", "leads", "deals", "activities", "emails", "segments", "rules", "bus", "reports"];

  function mockEnv(ns) {
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
    const store = BS.create({ ns: ns || "csv" + BS.randHex(6), kv, editable, modules: ALL_MODULES.slice() });
    return { kv, kvStore, editable, store };
  }

  T.register("csv: parser handles quotes, commas, newlines and blank rows", async () => {
    const text = "name,notes,country\n\"Acme, Inc.\",\"Line 1\nLine 2\",USA\nBeta Works,simple,UK\n\n\"O\"\"Brien & Co\",x,\n";
    const r = CSV.parseCSV(text);
    if (!r.ok) return { pass: false, detail: "parse failed: " + r.error };
    if (r.headers.join("|") !== "name|notes|country") return { pass: false, detail: "headers wrong: " + r.headers.join("|") };
    if (r.data.length !== 3) return { pass: false, detail: "expected 3 data rows, got " + r.data.length };
    if (r.data[0][0] !== "Acme, Inc.") return { pass: false, detail: "quoted comma lost" };
    if (r.data[0][1] !== "Line 1\nLine 2") return { pass: false, detail: "embedded newline lost" };
    if (r.data[2][0] !== "O\"Brien & Co") return { pass: false, detail: "escaped quote mangled" };
    return { pass: true, detail: "3 rows parsed with quotes/newlines intact" };
  });

  T.register("csv: ragged rows and empty input are reported as errors", async () => {
    const ragged = CSV.parseCSV("a,b\n1,2\n3");
    if (ragged.ok) return { pass: false, detail: "ragged row accepted" };
    const empty = CSV.parseCSV(",,,\n");
    if (empty.ok) return { pass: false, detail: "blank file accepted" };
    return { pass: true, detail: "both rejected" };
  });

  T.register("csv: round-trip quoting via toCSV", async () => {
    const rows = [["a", "b", "c", "d"], ["a,b", "x\"y", "plain", "line\nbreak"]];
    const out = CSV.toCSV(rows);
    const back = CSV.parseCSV(out);
    if (!back.ok || back.data.length !== 1) return { pass: false, detail: "round-trip failed: " + (back.error || back.data.length) };
    if (back.data[0][0] !== "a,b" || back.data[0][1] !== "x\"y" || back.data[0][2] !== "plain" || back.data[0][3] !== "line\nbreak") {
      return { pass: false, detail: "round-trip mismatch: " + JSON.stringify(back.data[0]) };
    }
    return { pass: true, detail: "quotes/commas/newlines round-trip" };
  });

  T.register("csv: header guessing maps synonyms for companies and contacts", async () => {
    const cm = CSV.guessHeaderMap("companies", ["Organisation", "Sector", "Headcount", "Web site", "Zip", "Customer"]);
    if (cm.name !== 0 || cm.industry !== 1 || cm.employees !== 2 || cm.website !== 3 || cm.postalCode !== 4) {
      return { pass: false, detail: "company guess wrong: " + JSON.stringify(cm) };
    }
    const ct = CSV.guessHeaderMap("contacts", ["Full name", "Job title", "E-mail", "Company"]);
    if (ct.name !== 0 || ct.role !== 1 || ct.email !== 2 || ct.company !== 3) {
      return { pass: false, detail: "contact guess wrong: " + JSON.stringify(ct) };
    }
    return { pass: true, detail: "synonym headers mapped" };
  });

  T.register("csv: row validation reports missing names, bad emails and unknown companies", async () => {
    const rows = [
      ["Acme Industries", "acme.example"],
      ["", "acme.example"],
      ["Beta Works", "not-an-email"]
    ];
    const headers = ["name", "website"];
    const fm = { name: 0, website: 1 };
    const ok1 = CSV.validateRaw("companies", CSV.buildRaw("companies", fm, headers, rows[0]));
    const badName = CSV.validateRaw("companies", CSV.buildRaw("companies", fm, headers, rows[1]));
    const badWeb = CSV.validateRaw("companies", CSV.buildRaw("companies", fm, headers, rows[2]));
    if (!ok1.ok) return { pass: false, detail: "valid row rejected" };
    if (badName.ok) return { pass: false, detail: "missing name accepted" };
    if (badWeb.ok) return { pass: false, detail: "bad website accepted" };
    const contactRaw = CSV.buildRaw("contacts", { name: 0, company: 1 }, ["name", "company"], ["Ada", "GhostCorp"], { companyByName: () => null });
    const unk = CSV.validateRaw("contacts", contactRaw);
    if (unk.ok) return { pass: false, detail: "unknown company accepted for contact" };
    return { pass: true, detail: "row-level errors surfaced" };
  });

  T.register("csv: company rows resolve on import, duplicates and invalid rows are skipped", async () => {
    const env = mockEnv();
    await env.store.saveChecked("companies", { records: [{ id: "c-x", name: "Existing Co", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] }, { expectedBase: 0 });
    const R = window.CRM_RECORDS;
    const mod = window.CRM_COMPANIES;
    const mk = (name, website) => ({ name, website, active: true });
    const res = await window.CRM_REPORTS.importRows(env.store, "companies", [
      mk("New Co", "new.example"),
      mk("Existing Co", "dup.example"),
      mk("", "bad.example")
    ]);
    if (!res.ok) return { pass: false, detail: "import failed: " + JSON.stringify(res) };
    if (res.imported !== 1 || res.skippedDup !== 1 || res.skippedBad !== 1) {
      return { pass: false, detail: "counts wrong: " + JSON.stringify(res) };
    }
    const doc = await env.store.loadDoc("companies");
    const recs = R.recordsOf(doc.content);
    const names = recs.map(c => c.name);
    if (names.indexOf("New Co") === -1 || names.indexOf("Existing Co") === -1 || names.length !== 2) {
      return { pass: false, detail: "records wrong: " + names.join(",") };
    }
    return { pass: true, detail: "1 imported, duplicate + invalid skipped" };
  });

  T.register("csv: contact import maps company names to company ids", async () => {
    const env = mockEnv();
    await env.store.saveChecked("companies", { records: [{ id: "c-1", name: "Acme Industries", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] }, { expectedBase: 0 });
    const R = window.CRM_RECORDS;
    const raw = { name: "Pat Smith", email: "pat@acme.example", companyId: "c-1", active: true };
    const res = await window.CRM_REPORTS.importRows(env.store, "contacts", [raw]);
    if (!res.ok || res.imported !== 1) return { pass: false, detail: "contact import failed: " + JSON.stringify(res) };
    const doc = await env.store.loadDoc("contacts");
    const c = R.recordsOf(doc.content)[0];
    if (c.companyId !== "c-1" || c.email !== "pat@acme.example") return { pass: false, detail: "fields wrong: " + JSON.stringify(c) };
    return { pass: true, detail: "contact linked to company by id" };
  });

  T.register("csv: buildRaw turns size text into an employee band and consent text into a flag", async () => {
    const raw = CSV.buildRaw("companies", { name: 0, employees: 1, isCustomer: 2 }, ["name", "employees", "isCustomer"], ["Acme", "11-50", "yes"]);
    const addr0 = CSV.buildRaw("companies", { street: 0, city: 1 }, ["street", "city"], ["", ""]);
    const cons = CSV.buildRaw("contacts", { name: 0, consent: 1 }, ["name", "consent"], ["Ada", "yes"]);
    const n = CSV.employeesOf("11-50");
    if (n !== 50) return { pass: false, detail: "size band 11-50 → " + n };
    if (CSV.employeesOf("5,000+") !== 5000) return { pass: false, detail: "5,000+ not parsed" };
    if (raw.employees !== 50 || raw.isCustomer !== true || cons.consent !== true) return { pass: false, detail: "mapping wrong: " + JSON.stringify({ e: raw.employees, c: raw.isCustomer, g: cons.consent }) };
    if (Object.keys(addr0.address || {}).length) return { pass: false, detail: "empty address kept" };
    return { pass: true, detail: "defaults and coercions correct" };
  });
})();
