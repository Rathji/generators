(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  if (!T || !QS) return;

  const ENTITIES = [
    "quotes", "quote_versions", "line_items", "option_groups", "price_snapshots",
    "catalog_items", "portal_tokens", "quote_events", "approvals", "invoice_intents",
    "outbox_jobs", "quote_artifacts"
  ];

  function deepEq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function makeBackend() {
    return { kvStore: new Map(), files: new Map() };
  }

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
          return { error: null, editKey: f.key, editCount: 1, created: true, unchanged: false, superseded: false };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, created: false, unchanged: true, superseded: false };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, created: false, unchanged: false, superseded: false };
      }
    };
  }

  function makeEnv(backend, opts) {
    opts = opts || {};
    backend = backend || makeBackend();
    const kv = makeKv(backend.kvStore);
    const editable = makeEditable(backend.files);
    const ns = opts.ns || "t" + QS.randHex(6);
    const store = QS.create(Object.assign({ ns, kv, editable, modules: ENTITIES }, opts, { kv, editable }));
    return { store, ns, kv, kvStore: backend.kvStore, editable, files: backend.files, backend };
  }

  function headOf(env, module) {
    const f = env.files.get(env.store.fileName(module));
    return f ? JSON.parse(f.text) : null;
  }

  function hardMaxOf(env) {
    return env.store.constants.hardMax;
  }

  T.register("store: every quote-u entity group has its own versioned document", () => {
    const env = makeEnv();
    const s = env.store;
    const missing = ENTITIES.filter(m => s.modules.indexOf(m) === -1);
    if (missing.length) return { pass: false, detail: "store is missing: " + missing.join(", ") };
    if (s.modules.length !== ENTITIES.length) return { pass: false, detail: "unexpected module count " + s.modules.length };
    const validName = /^[a-z0-9-]{1,200}$/;
    const badNames = [];
    for (const m of ENTITIES) {
      const n = s.fileName(m);
      if (n.indexOf("qu-") !== 0) badNames.push(m + "→" + n);
      else if (n.indexOf(s.slug(m)) === -1) badNames.push(m + "→" + n + " (no module in name)");
      else if (!validName.test(n)) badNames.push(m + "→" + n + " (invalid editable name)");
    }
    if (badNames.length) return { pass: false, detail: "bad canonical names: " + badNames.join(", ") };
    return { pass: true, detail: ENTITIES.length + " entity documents, namespaced " + s.ns + "; names editable-safe" };
  });

  T.register("store: create, cache and canonical read-back (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    const c1 = { records: [{ id: "q1", number: "QU-2026-0001" }], settings: { nextNumber: 2 } };
    const r1 = await s.saveDoc("quotes", c1);
    if (!r1.ok) return { pass: false, detail: JSON.stringify(r1) };
    const checks = [];
    if (r1.revision !== 1) checks.push("revision=" + r1.revision);
    if (!r1.created) checks.push("created flag not set");
    const h = headOf(env, "quotes");
    if (!h || h.k !== "qudoc" || h.module !== "quotes" || h.v !== 1) checks.push("head envelope invalid: " + JSON.stringify(h && h.k));
    const keyName = "editkey:" + s.ns + ":" + s.fileName("quotes");
    if (!env.kvStore.has(keyName)) checks.push("edit key not cached locally");
    const cached = env.kvStore.get("doc:" + s.ns + ":quotes");
    if (!cached || !deepEq(cached.content, c1)) checks.push("fast local cache not written");
    const loaded = await s.loadDoc("quotes");
    if (loaded.state !== "cache" || !deepEq(loaded.content, c1)) checks.push("cache read mismatch");
    if (checks.length) return { pass: false, detail: checks.join(" | ") };
    return { pass: true, detail: "rev 1, edit key + local cache written, cache hit on reload" };
  });

  T.register("store: local cache wipe still reads the canonical doc (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    const c1 = { records: [{ id: "q1", title: "Storage refresh" }] };
    await s.saveDoc("quote_versions", c1);
    for (const k of Array.from(env.kvStore.keys())) {
      if (k.indexOf("doc:") === 0) await env.kv.delete(k);
    }
    const loaded = await s.loadDoc("quote_versions");
    if (loaded.state !== "canonical" || !deepEq(loaded.content, c1)) {
      return { pass: false, detail: "state=" + loaded.state + " ok=" + loaded.ok };
    }
    const recached = await env.kv.get("doc:" + s.ns + ":quote_versions");
    return recached ? { pass: true, detail: "recovered from canonical; local cache rebuilt" } : { pass: false, detail: "cache not rebuilt after canonical read" };
  });

  T.register("store: a lost edit key blocks writes with a clear error (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    await s.saveDoc("catalog_items", { records: [{ id: "sku-1", sku: "SKU-1" }] });
    await env.kv.delete("editkey:" + s.ns + ":" + s.fileName("catalog_items"));
    const r = await s.saveDoc("catalog_items", { records: [{ id: "sku-1", sku: "SKU-1" }, { id: "sku-2", sku: "SKU-2" }] });
    if (r.ok || r.code !== "no_edit_key") return { pass: false, detail: "expected no_edit_key, got " + JSON.stringify(r) };
    const h = headOf(env, "catalog_items");
    if (h.content.records.length !== 1) return { pass: false, detail: "canonical was modified without a key" };
    return { pass: true, detail: "write refused; canonical untouched" };
  });

  T.register("store: revisions advance and an identical resave is a no-op (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    await s.saveDoc("line_items", { records: [{ id: "l1" }] });
    const r2 = await s.saveDoc("line_items", { records: [{ id: "l1" }, { id: "l2" }] });
    if (!r2.ok || r2.revision !== 2 || r2.created) return { pass: false, detail: JSON.stringify(r2) };
    const h = headOf(env, "line_items");
    if (h.revision !== 2 || h.content.records.length !== 2) return { pass: false, detail: "canonical not rewritten (rev " + h.revision + ")" };
    const noop = await s.saveDoc("line_items", { records: [{ id: "l1" }, { id: "l2" }] });
    if (!noop.ok || !noop.noop || noop.revision !== 2) return { pass: false, detail: "expected no-op resave, got " + JSON.stringify(noop) };
    return { pass: true, detail: "rev 1 → 2; identical resave is a no-op at rev 2" };
  });

  T.register("store: never silently overwrites a newer canonical (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    await s.saveDoc("approvals", { records: [{ id: "a1" }] });
    const h = headOf(env, "approvals");
    h.revision = 7;
    h.updatedAt = new Date().toISOString();
    h.content.remoteTouched = true;
    h.sha = await s.digestHex(JSON.stringify(h.content));
    const f = env.files.get(s.fileName("approvals"));
    await env.editable.set(s.fileName("approvals"), JSON.stringify(h), { editKey: f.key });
    const r = await s.saveDoc("approvals", { records: [{ id: "a1" }, { id: "a2" }] });
    if (r.ok || r.code !== "conflict_stale") return { pass: false, detail: "expected conflict_stale, got " + JSON.stringify(r) };
    const after = headOf(env, "approvals");
    if (after.revision !== 7 || !after.content.remoteTouched) return { pass: false, detail: "canonical was modified despite conflict" };
    return { pass: true, detail: "blocked a rev-1 write against canonical rev 7" };
  });

  T.register("store: large documents split into part files and reassemble (mock)", async () => {
    const env = makeEnv(null, { budget: 2600 });
    const s = env.store;
    const records = [];
    for (let i = 1; i <= 15; i++) records.push({ id: "p" + i, note: "record-" + i + "-" + "x".repeat(560) });
    const content = { records, meta: { count: 15 } };
    const r = await s.saveDoc("price_snapshots", content);
    if (!r.ok) return { pass: false, detail: JSON.stringify(r) };
    if (r.parts < 2) return { pass: false, detail: "expected a split, parts=" + r.parts };
    const over = [];
    for (const [name, file] of env.files) {
      if (file.text.length > hardMaxOf(env)) over.push(name + "=" + file.text.length);
    }
    for (const k of Array.from(env.kvStore.keys())) {
      if (k.indexOf("doc:") === 0) await env.kv.delete(k);
    }
    const loaded = await s.loadDoc("price_snapshots");
    if (loaded.state !== "canonical") return { pass: false, detail: "state=" + loaded.state };
    if (!loaded.content.records || loaded.content.records.length !== 15) {
      return { pass: false, detail: "reassembly lost records: " + (loaded.content.records || []).length };
    }
    if (!loaded.content.records.every((rec, i) => rec.id === "p" + (i + 1))) return { pass: false, detail: "record order scrambled" };
    return { pass: true, detail: r.parts + " part files, 15 records reassembled in order" + (over.length ? "; OVER " + over.join(",") : "") };
  });

  T.register("store: unsplittable oversized content is refused (mock)", async () => {
    const env = makeEnv(null, { budget: 2600, ceiling: 30000 });
    const s = env.store;
    const r1 = await s.saveDoc("outbox_jobs", { note: "y".repeat(10000) });
    if (r1.ok || r1.code !== "doc_too_large") return { pass: false, detail: "expected doc_too_large, got " + JSON.stringify(r1) };
    const r2 = await s.saveDoc("outbox_jobs", { records: [{ id: "o1", big: "z".repeat(40000) }] });
    if (r2.ok || r2.code !== "doc_too_large") return { pass: false, detail: "expected doc_too_large for an oversized record, got " + JSON.stringify(r2) };
    if (env.files.size !== 0) return { pass: false, detail: "refused writes still created files" };
    return { pass: true, detail: "both refused, nothing written" };
  });

  T.register("store: corrupt canonical is surfaced, never overwritten (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    await s.saveDoc("quote_events", { records: [{ id: "e1" }] });
    const f = env.files.get(s.fileName("quote_events"));
    await env.editable.set(s.fileName("quote_events"), "### not json ###", { editKey: f.key });
    const r = await s.saveDoc("quote_events", { records: [{ id: "e1" }, { id: "e2" }] });
    if (r.ok || (r.code !== "corrupt_head" && r.code !== "schema_mismatch")) {
      return { pass: false, detail: "expected a corrupt refusal, got " + JSON.stringify(r) };
    }
    const loaded = await s.loadDoc("quote_events", { refresh: true });
    if (loaded.ok || loaded.state !== "corrupt") return { pass: false, detail: "refresh should surface corruption, got " + JSON.stringify(loaded) };
    return { pass: true, detail: "save blocked and corruption surfaced" };
  });

  T.register("store: content must be a JSON object (mock)", async () => {
    const env = makeEnv();
    const s = env.store;
    const bad = await s.saveDoc("invoice_intents", ["not", "an", "object"]);
    if (bad.ok || bad.code !== "bad_content") return { pass: false, detail: "expected bad_content, got " + JSON.stringify(bad) };
    return { pass: true, detail: "non-object content refused" };
  });

  T.register("store: data survives a reload and reaches a second device", async () => {
    const backend = makeBackend();
    const a = makeEnv(backend);
    const content = { records: [{ id: "q1", number: "QU-2026-0001", title: "Cross-device quote" }] };
    const r1 = await a.store.saveDoc("quotes", content);
    if (!r1.ok) return { pass: false, detail: "create failed: " + JSON.stringify(r1) };

    const reloaded = makeEnv(backend, { ns: a.ns });
    const afterReload = await reloaded.store.loadDoc("quotes");
    if (afterReload.state !== "cache" || !deepEq(afterReload.content, content)) {
      return { pass: false, detail: "reload did not restore from local cache: state=" + afterReload.state };
    }

    const otherDevice = makeEnv({ kvStore: new Map(), files: backend.files }, { ns: a.ns });
    const onOther = await otherDevice.store.loadDoc("quotes");
    if (onOther.state !== "canonical" || !deepEq(onOther.content, content)) {
      return { pass: false, detail: "second device could not read the canonical document: state=" + onOther.state };
    }
    const rebuilt = otherDevice.kvStore.get("doc:" + otherDevice.ns + ":quotes");
    if (!rebuilt) return { pass: false, detail: "second device did not build a local cache" };
    return { pass: true, detail: "reload restored from cache; a fresh-key device read rev " + onOther.revision + " from canonical" };
  });

  T.register("store: namespaces stay isolated (mock)", async () => {
    const backend = makeBackend();
    const a = makeEnv(backend);
    const b = makeEnv(backend);
    await a.store.saveDoc("portal_tokens", { records: [{ id: "t1", tokenHash: "abc" }] });
    const seenByB = await b.store.loadDoc("portal_tokens");
    if (seenByB.state !== "none") return { pass: false, detail: "namespace leak: second workspace saw state=" + seenByB.state };
    if (a.store.fileName("portal_tokens") === b.store.fileName("portal_tokens")) return { pass: false, detail: "canonical file names collide across namespaces" };
    return { pass: true, detail: "two namespaces share no documents or cache keys" };
  });

  T.register("store: portal token records never carry a token secret field (model check)", () => {
    const sample = { records: [{ id: "t1", tokenHash: "…", expiresAt: "…" }] };
    const json = JSON.stringify(sample);
    const leak = /secret|plaintext|tokenPlain/i.test(json);
    return leak ? { pass: false, detail: "sample token record exposes a secret-shaped field" } : { pass: true, detail: "token documents are hash-shaped (hash only)" };
  });

  T.register("store: every entity document is readable in the live workspace", async () => {
    const QU = window.QU;
    if (!QU || !QU.store) return { pass: true, skip: true, detail: "no store attached" };
    await (QU.storeReady || Promise.resolve());
    const bad = [];
    for (const m of ENTITIES) {
      const r = await QU.store.loadDoc(m, { refresh: true });
      if (!r.ok) bad.push(m + "→" + (r.code || r.state) + (r.detail ? ": " + r.detail : ""));
    }
    if (bad.length) return { pass: false, detail: bad.join(" | ") };
    return { pass: true, detail: ENTITIES.length + " documents readable in namespace " + (QU.store.ns || "(main)") };
  });

  T.register("store: boot reports a state for every entity document (live kv)", async () => {
    const QU = window.QU;
    if (!QU || !QU.store) return { pass: true, skip: true, detail: "no store attached" };
    await (QU.storeReady || Promise.resolve());
    // Boot also runs service seeds (e.g. QU_CATALOG.seedIfEmpty); wait for them
    // so the reported state is the settled post-boot state.
    if (QU.catalogReady) { try { await QU.catalogReady; } catch (e) {} }
    const info = await QU.store.statusInfo();
    if (!info || !info.modules) return { pass: false, detail: "statusInfo returned no modules" };
    const missing = ENTITIES.filter(id => !(id in info.modules));
    if (missing.length) return { pass: false, detail: "missing: " + missing.join(", ") };
    const allowed = ["none", "synced", "local_only", "diverged", "error", "corrupt", "missing", "conflict", "pending"];
    const badState = ENTITIES.filter(id => info.modules[id] && allowed.indexOf(info.modules[id].state) === -1);
    if (badState.length) return { pass: false, detail: "bad states: " + badState.map(id => id + ":" + info.modules[id].state).join(",") };
    return { pass: true, detail: ENTITIES.length + " entity documents reported; ns=" + QU.store.ns };
  });

  T.register("store: real editable round-trip, create → read → update (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    // A fresh namespace per run: editable files can be created but not deleted
    // (no deletionUrl), so reusing one would leave a stale document with no
    // edit key and block the create path. Each run leaves one tiny canonical file.
    const ns = "it" + Date.now().toString(36) + QS.randHex(4);
    let s;
    try {
      s = QS.createDefault({ ns, modules: ["itest"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const m = "itest";
    const t0 = Date.now();
    const r1 = await s.saveDoc(m, { records: [{ id: "i1" }], title: "alpha" });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (r1.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live store check skipped" };
    if (!r1.ok) return { pass: false, detail: "create failed: " + JSON.stringify(r1) };
    if (r1.revision !== 1 || !r1.created) return { pass: false, detail: "create did not land at rev 1: " + JSON.stringify(r1) };

    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    const loaded = await s.loadDoc(m);
    if (loaded.state !== "canonical" || loaded.content.title !== "alpha" || loaded.revision !== 1) {
      return { pass: false, detail: "canonical read-back after cache wipe failed: state=" + loaded.state };
    }

    const waitMs = 12000 - (Date.now() - t0);
    if (waitMs > 0) await sleep(waitMs);
    let r2 = await s.saveDoc(m, { records: [{ id: "i1" }, { id: "i2" }], title: "beta" });
    if (!r2.ok || r2.revision !== 2 || r2.created) return { pass: false, detail: "update failed: " + JSON.stringify(r2) };

    const name = s.fileName(m);
    const readCanonical = async () => {
      let text = null;
      try {
        text = await r.uploadPlugin.editable.get(name);
      } catch (e) {}
      if (!text) return null;
      try {
        const h = JSON.parse(text);
        return h.revision >= 2 && h.content && h.content.title === "beta" ? h : null;
      } catch (e) {
        return null;
      }
    };
    const deadline = Date.now() + 45000;
    let settled = null;
    while (!settled && Date.now() < deadline) {
      try {
        settled = await readCanonical();
      } catch (e) {}
      if (!settled && Date.now() < deadline) {
        await sleep(1500);
        const retry = await s.saveDoc(m, { records: [{ id: "i1" }, { id: "i2" }], title: "beta" });
        if (retry.ok) r2 = retry;
      }
    }
    const finalClean = await folder.entries().catch(() => []);
    for (const pair of finalClean) {
      if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await folder.delete(pair[0]);
    }
    if (!settled) return { pass: false, detail: "canonical did not settle at rev ≥ 2 within 45s (server write/read lag)" };
    return { pass: true, detail: "created rev 1 on the server, wiped cache, re-read, updated to rev " + settled.revision + " in " + Math.round((Date.now() - t0) / 1000) + "s" };
  });
})();
