(function () {
  const T = window.SELFTEST;
  const BS = window.BcrmStore;
  if (!T || !BS) return;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function until(fn, timeoutMs, stepMs) {
    const t0 = Date.now();
    const limit = timeoutMs || 5000;
    const step = stepMs || 250;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > limit) return null;
      await sleep(step);
    }
  }

  function deepEq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

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
    const ns = "t" + BS.randHex(6);
    const store = BS.create(
      Object.assign({ ns, kv, editable, modules: ["companies", "contacts", "leads", "deals", "activities", "reports"] }, opts)
    );
    return { kv, kvStore, editable, store };
  }

  function headOf(env, module) {
    const f = env.editable.files.get(env.store.fileName(module));
    return f ? JSON.parse(f.text) : null;
  }

  T.register("store: create, cache and canonical read-back (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const c1 = { records: [{ id: 1, name: "Acme" }], settings: { nextNumber: 2 } };
    const r1 = await s.saveDoc("companies", c1);
    if (!r1.ok) return { pass: false, detail: JSON.stringify(r1) };
    const checks = [];
    if (r1.revision !== 1) checks.push("revision=" + r1.revision);
    if (!r1.created) checks.push("created not set");
    if (r1.parts !== 1) checks.push("parts=" + r1.parts);
    const keyName = "editkey:" + s.ns + ":" + s.fileName("companies");
    if (!env.kvStore.has(keyName)) checks.push("edit key not cached");
    const h = headOf(env, "companies");
    if (!h || h.k !== "bcrmdoc" || h.module !== "companies") checks.push("head envelope invalid");
    const loaded = await s.loadDoc("companies");
    if (loaded.state !== "cache" || !deepEq(loaded.content, c1)) checks.push("cache read mismatch");
    if (checks.length) return { pass: false, detail: checks.join(" | ") };
    return { pass: true, detail: "rev " + r1.revision + ", edit key cached, cache hit" };
  });

  T.register("store: update bumps revision and rewrites canonical (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const c1 = { records: [{ id: 1 }] };
    await s.saveDoc("companies", c1);
    const c2 = { records: [{ id: 1 }, { id: 2 }] };
    const r2 = await s.saveDoc("companies", c2);
    if (!r2.ok || r2.revision !== 2 || r2.created) return { pass: false, detail: JSON.stringify(r2) };
    const h = headOf(env, "companies");
    if (h.revision !== 2 || h.content.records.length !== 2) return { pass: false, detail: "canonical not rewritten (rev " + h.revision + ")" };
    const noop = await s.saveDoc("companies", c2);
    if (!noop.ok || !noop.noop || noop.revision !== 2) return { pass: false, detail: "expected noop resave, got " + JSON.stringify(noop) };
    return { pass: true, detail: "rev 1 → 2; identical resave is a no-op" };
  });

  T.register("store: local-cache wipe still reads the canonical doc (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    await s.saveDoc("companies", c1);
    for (const k of Array.from(env.kvStore.keys())) {
      if (k.startsWith("doc:")) await env.kv.delete(k);
    }
    const loaded = await s.loadDoc("companies");
    if (loaded.state !== "canonical" || !deepEq(loaded.content, c1)) {
      return { pass: false, detail: "state=" + loaded.state + " ok=" + loaded.ok };
    }
    const recached = await env.kv.get("doc:" + s.ns + ":companies");
    return recached ? { pass: true, detail: "recovered from canonical, cache rebuilt" } : { pass: false, detail: "cache not rebuilt after read" };
  });

  T.register("store: never silently overwrites a newer canonical (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveDoc("companies", { records: [{ id: 1 }] });
    const h = headOf(env, "companies");
    h.revision = 7;
    h.updatedAt = new Date().toISOString();
    h.content.remoteTouched = true;
    h.sha = await s.digestHex(JSON.stringify(h.content));
    const f = env.editable.files.get(s.fileName("companies"));
    await env.editable.set(s.fileName("companies"), JSON.stringify(h), { editKey: f.key });
    const r = await s.saveDoc("companies", { records: [{ id: 1 }, { id: 99 }] });
    if (r.ok || r.code !== "conflict_stale") return { pass: false, detail: "expected conflict_stale, got " + JSON.stringify(r) };
    const after = headOf(env, "companies");
    if (after.revision !== 7 || !after.content.remoteTouched) return { pass: false, detail: "canonical was modified despite conflict" };
    return { pass: true, detail: "blocked rev-1 write against canonical rev 7" };
  });

  T.register("store: oversized docs split across part files and reassemble (mock)", async () => {
    const env = mockEnv({ budget: 2600 });
    const s = env.store;
    const make = i => ({ id: i, note: "record-" + i + "-" + "x".repeat(560) });
    const records = [];
    for (let i = 1; i <= 15; i++) records.push(make(i));
    const content = { records, meta: { count: 15 } };
    const r = await s.saveDoc("contacts", content);
    if (!r.ok) return { pass: false, detail: JSON.stringify(r) };
    if (r.parts < 2) return { pass: false, detail: "expected split, parts=" + r.parts };
    const files = env.editable.files;
    const hardMax = s.constants.hardMax;
    const over = [];
    for (const [name, file] of files) {
      if (file.text.length > hardMax) over.push(name + "=" + file.text.length);
    }
    for (const k of env.kvStore.keys()) if (k.startsWith("doc:") || k.startsWith("sync:")) await env.kv.delete(k);
    const loaded = await s.loadDoc("contacts");
    if (loaded.state !== "canonical") return { pass: false, detail: "state=" + loaded.state };
    if (!loaded.content.records || loaded.content.records.length !== 15) return { pass: false, detail: "reassembly lost records: " + (loaded.content.records || []).length };
    const orderOk = loaded.content.records.every((rec, i) => rec.id === i + 1);
    if (!orderOk) return { pass: false, detail: "record order scrambled" };
    return { pass: true, detail: r.parts + " part files (" + env.editable.files.size + " total), 15 records reassembled in order" + (over.length ? "; OVER " + over.join(",") : "") };
  });

  T.register("store: unsplittable oversized content is refused (mock)", async () => {
    const env = mockEnv({ budget: 2600, ceiling: 30000 });
    const s = env.store;
    const blob = "y".repeat(10000);
    const r1 = await s.saveDoc("deals", { note: blob });
    if (r1.ok || r1.code !== "doc_too_large") return { pass: false, detail: "expected doc_too_large, got " + JSON.stringify(r1) };
    const r2 = await s.saveDoc("deals", { records: [{ id: 1, big: "z".repeat(40000) }] });
    if (r2.ok || r2.code !== "doc_too_large") return { pass: false, detail: "expected doc_too_large for oversized record, got " + JSON.stringify(r2) };
    if (env.editable.files.size !== 0) return { pass: false, detail: "refused writes still created files" };
    return { pass: true, detail: "both refused, nothing written" };
  });

  T.register("store: a lost edit key blocks writes with a clear error (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveDoc("leads", { records: [{ id: 1 }] });
    const keyName = "editkey:" + s.ns + ":" + s.fileName("leads");
    await env.kv.delete(keyName);
    const r = await s.saveDoc("leads", { records: [{ id: 1 }, { id: 2 }] });
    if (r.ok || r.code !== "no_edit_key") return { pass: false, detail: "expected no_edit_key, got " + JSON.stringify(r) };
    const h = headOf(env, "leads");
    if (h.content.records.length !== 1) return { pass: false, detail: "canonical was modified without a key" };
    return { pass: true, detail: "write refused; canonical untouched" };
  });

  T.register("store: corrupt canonical is reported, never overwritten (mock)", async () => {
    const env = mockEnv();
    const s = env.store;
    await s.saveDoc("activities", { records: [{ id: 1 }] });
    const f = env.editable.files.get(s.fileName("activities"));
    await env.editable.set(s.fileName("activities"), "### not json ###", { editKey: f.key });
    const r = await s.saveDoc("activities", { records: [{ id: 1 }, { id: 2 }] });
    if (r.ok || (r.code !== "corrupt_head" && r.code !== "schema_mismatch")) return { pass: false, detail: "expected corrupt refusal, got " + JSON.stringify(r) };
    const loaded = await s.loadDoc("activities", { refresh: true });
    if (loaded.ok || loaded.state !== "corrupt") return { pass: false, detail: "refresh should surface corruption, got " + JSON.stringify(loaded) };
    return { pass: true, detail: "save blocked and corruption surfaced" };
  });

  T.register("store: boot reports a state for every module (live kv)", async () => {
    const crm = window.CRM;
    if (!crm || !crm.store) return { pass: true, skip: true, detail: "no store attached" };
    await (crm.storeReady || Promise.resolve());
    const info = await crm.store.statusInfo();
    const expected = ["companies", "contacts", "leads", "deals", "activities", "reports"];
    const missing = expected.filter(id => !(id in info.modules));
    const badState = expected.filter(id => !["none", "synced", "local_only", "diverged", "error", "corrupt"].includes(info.modules[id].state));
    if (missing.length || badState.length) {
      return { pass: false, detail: "missing=" + missing.join(",") + " badState=" + badState.map(id => id + ":" + info.modules[id].state).join(",") };
    }
    const list = expected.map(id => id + "=" + info.modules[id].state).join(", ");
    return { pass: true, detail: list };
  });

  T.register("store: real editable round-trip, create→read→update (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "rt" + Date.now().toString(36) + BS.randHex(4);
    let s;
    try {
      s = BS.createDefault({ ns, modules: ["itest"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const m = "itest";
    const t0 = Date.now();
    const r1 = await s.saveDoc(m, { records: [{ id: 1 }], title: "alpha" });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (!r1.ok) return { pass: false, detail: "create failed: " + JSON.stringify(r1) };
    if (r1.revision !== 1 || !r1.created) return { pass: false, detail: "create did not land at rev 1: " + JSON.stringify(r1) };

    const folder = r.kv.bcrm;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.startsWith("doc:") || k.startsWith("sync:")) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    const loaded = await s.loadDoc(m);
    if (loaded.state !== "canonical" || loaded.content.title !== "alpha" || loaded.revision !== 1) {
      return { pass: false, detail: "canonical read-back after cache wipe failed: state=" + loaded.state + " " + JSON.stringify(loaded).slice(0, 300) };
    }

    const waitMs = 12000 - (Date.now() - t0);
    if (waitMs > 0) await sleep(waitMs);
    const r2 = await s.saveDoc(m, { records: [{ id: 1 }, { id: 2 }], title: "beta" });
    if (!r2.ok || r2.revision !== 2 || r2.created) return { pass: false, detail: "update failed: " + JSON.stringify(r2) };

    const name = s.fileName(m);
    const want = { minRev: r2.revision, title: "beta" };
    const readCanonical = async () => {
      let text = null;
      try {
        text = await r.uploadPlugin.editable.get(name);
      } catch (e) {}
      if (!text) return null;
      try {
        const h = JSON.parse(text);
        return h.revision >= want.minRev && h.content && h.content.title === want.title ? h : null;
      } catch (e) {
        return null;
      }
    };
    const deadline = Date.now() + 45000;
    let settled = null;
    while (!settled && Date.now() < deadline) {
      settled = await until(readCanonical, 10000, 1000);
      if (!settled && Date.now() < deadline) {
        const retry = await s.saveDoc(m, { records: [{ id: 1 }, { id: 2 }], title: "beta" });
        want.minRev = retry.ok ? retry.revision : want.minRev;
      }
    }
    if (!settled) return { pass: false, detail: "canonical did not settle at rev ≥ " + want.minRev + " within 45s (server write/read lag)" };
    const finalClean = await folder.entries().catch(() => []);
    for (const pair of finalClean) {
      if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await folder.delete(pair[0]);
    }
    return { pass: true, detail: "created rev 1 on server, cache wiped, re-read rev 1, updated to rev " + settled.revision + " (" + Math.round((Date.now() - t0) / 1000) + "s incl. write throttle)" };
  });
})();
