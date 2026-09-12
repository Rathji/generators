// quote-u — full backup & validated restore tests (roadmap task 8)
(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  if (!T || !QS) return;

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function until(fn, timeoutMs, stepMs) {
    const t0 = Date.now();
    const limit = timeoutMs || 5000;
    const step = stepMs || 150;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > limit) return null;
      await sleep(step);
    }
  }

  function eq(a, b) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!(k in b)) return false;
      if (!eq(a[k], b[k])) return false;
    }
    return true;
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function mockEnv(opts) {
    opts = opts || {};
    const kvStore = new Map();
    const files = new Map();
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
    const ns = opts.ns || "bk" + QS.randHex(6);
    const modules = opts.modules || QS.DEFAULT_MODULES.slice();
    function build(kvMap, nsOverride) {
      const m = kvMap || new Map();
      return QS.create({
        ns: nsOverride || ns,
        modules,
        editable,
        kv: {
          get: async k => m.get(k),
          set: async (k, v) => { m.set(k, v); },
          delete: async k => { m.delete(k); }
        }
      });
    }
    const store = build(kvStore);
    return {
      ns,
      kvStore,
      editable,
      files,
      modules,
      store,
      freshDevice: () => ({ kvStore: new Map(), store: build(new Map()) }),
      freshNs: ns2 => ({ ns: ns2, kvStore: new Map(), store: build(new Map(), ns2) })
    };
  }

  function headOf(env, store, module) {
    const f = env.files.get(store.fileName(module));
    return f ? JSON.parse(f.text) : null;
  }

  async function seedDoc(store, module, content) {
    const res = await store.saveDoc(module, content);
    assert(res.ok, "seed " + module + " failed: " + JSON.stringify(res));
  }

  T.register("backup: build captures every entity document, its revision and this device's write keys", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1, name: "Acme" }], settings: { nextNumber: 2 } };
    await seedDoc(env.store, "quotes", c1);
    await seedDoc(env.store, "line_items", { records: [] });
    const built = await env.store.buildBackup();
    if (!built.ok) return { pass: false, detail: JSON.stringify(built) };
    const snap = built.snapshot;
    if (snap.k !== "qubak" || snap.kind !== "full" || snap.modules.length !== QS.DEFAULT_MODULES.length) return { pass: false, detail: "snapshot shape wrong" };
    const q = snap.modules.find(m => m.module === "quotes");
    if (!q || !q.present || q.revision !== 1 || !eq(q.content, c1)) return { pass: false, detail: "quotes entry wrong" };
    const absent = snap.modules.filter(m => !m.present);
    if (absent.length !== QS.DEFAULT_MODULES.length - 2 || absent.some(m => m.revision !== 0)) return { pass: false, detail: "absent entries wrong: " + absent.length };
    const headName = env.store.fileName("quotes");
    if (typeof snap.editKeys[headName] !== "string" || !snap.editKeys[headName]) return { pass: false, detail: "edit key not captured" };
    if (built.summary.present !== 2) return { pass: false, detail: "summary.present=" + built.summary.present };
    return { pass: true, detail: QS.DEFAULT_MODULES.length + " entity documents, 2 present (quotes+line_items), key captured for " + headName };
  });

  T.register("backup: validate accepts the JSON file and rejects tampering", async () => {
    const env = mockEnv();
    await seedDoc(env.store, "quotes", { records: [{ id: 1 }] });
    const built = await env.store.buildBackup();
    if (!built.ok) return { pass: false, detail: "build failed" };
    const json = JSON.stringify(built.snapshot);
    const v = await env.store.validateBackup(json);
    if (!v.ok || v.snapshot.kind !== "full") return { pass: false, detail: "valid json rejected: " + JSON.stringify(v) };
    const g1 = await env.store.validateBackup("hello");
    if (g1.ok || g1.code !== "invalid_json") return { pass: false, detail: "garbage accepted" };
    const g2 = await env.store.validateBackup("{}");
    if (g2.ok || g2.code !== "not_a_backup") return { pass: false, detail: "empty object accepted" };
    const tampered = JSON.parse(json);
    tampered.modules.find(m => m.module === "quotes").content.records.push({ id: 99, sneaky: true });
    const g3 = await env.store.validateBackup(JSON.stringify(tampered));
    if (g3.ok || g3.code !== "invalid_backup" || !g3.problems.join(" ").match(/hash/i)) {
      return { pass: false, detail: "tampered content accepted: " + JSON.stringify(g3) };
    }
    return { pass: true, detail: "valid file passes; garbage, wrong marker and a content edit are all refused" };
  });

  T.register("backup: publish writes document files + index and is idempotent", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    const d1 = { records: [{ id: 1, amount: 10 }], title: "pipe" };
    await seedDoc(env.store, "quotes", c1);
    await seedDoc(env.store, "line_items", d1);
    const pub = await env.store.publishBackup();
    if (!pub.ok) return { pass: false, detail: "publish failed: " + JSON.stringify(pub) };
    if (!env.files.has(env.store.backupIndexName())) return { pass: false, detail: "index file missing" };
    for (const m of ["quotes", "line_items"]) {
      if (!env.files.has(env.store.backupHeadName(m))) return { pass: false, detail: m + " backup file missing" };
    }
    if (env.files.has(env.store.backupHeadName("catalog_items"))) return { pass: false, detail: "catalog_items backup published though absent" };
    const rp = await env.store.readPublishedBackup();
    if (!rp.ok) return { pass: false, detail: "readPublished failed: " + JSON.stringify(rp) };
    const q = rp.snapshot.modules.find(m => m.module === "quotes");
    if (!q || q.revision !== 1 || !eq(q.content, c1)) return { pass: false, detail: "published quotes wrong" };
    const pub2 = await env.store.publishBackup();
    if (!pub2.ok || !pub2.noop) return { pass: false, detail: "unchanged re-publish was not a no-op: " + JSON.stringify(pub2) };
    if (pub2.published.id !== pub.published.id) return { pass: false, detail: "noop publish replaced the index" };
    const liBefore = env.files.get(env.store.backupHeadName("line_items")).text;
    const c2 = { records: [{ id: 1, name: "Acme" }, { id: 2, name: "Beta" }] };
    const upd = await env.store.saveDoc("quotes", c2);
    if (!upd.ok) return { pass: false, detail: "quotes update failed" };
    const pub3 = await env.store.publishBackup();
    if (!pub3.ok || pub3.changed !== 1) return { pass: false, detail: "publish of the changed module failed: " + JSON.stringify(pub3) };
    const q3 = JSON.parse(env.files.get(env.store.backupHeadName("quotes")).text);
    if (q3.revision !== 2 || !eq(q3.content, c2)) return { pass: false, detail: "quotes backup not updated to rev 2" };
    if (env.files.get(env.store.backupHeadName("line_items")).text !== liBefore) return { pass: false, detail: "unchanged line_items backup was rewritten" };
    const pub4 = await env.store.publishBackup();
    if (!pub4.ok || !pub4.noop) return { pass: false, detail: "second no-op expected" };
    return { pass: true, detail: "published 2 documents; unchanged re-publish is a no-op; one document update republishes just that document" };
  });

  T.register("backup: readPublished on a fresh store reports none", async () => {
    const env = mockEnv();
    const rp = await env.store.readPublishedBackup();
    if (rp.ok || rp.code !== "no_published_backup") return { pass: false, detail: JSON.stringify(rp) };
    return { pass: true, detail: "no_published_backup before any publish" };
  });

  T.register("backup: preview flags rollback, noop and pending blocks", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1 }] };
    await seedDoc(env.store, "quotes", c1);
    const built = await env.store.buildBackup();
    const c2 = { records: [{ id: 1 }, { id: 2 }] };
    await env.store.saveDoc("quotes", c2);
    const pv = await env.store.previewBackup(built.snapshot);
    if (!pv.ok) return { pass: false, detail: JSON.stringify(pv) };
    const row = pv.rows.find(r => r.module === "quotes");
    if (!row || row.action !== "replace" || !row.rollback || row.liveRev !== 2 || row.snapRev !== 1) {
      return { pass: false, detail: "rollback row wrong: " + JSON.stringify(row) };
    }
    const now = await env.store.buildBackup();
    const pv2 = await env.store.previewBackup(now.snapshot);
    const row2 = pv2.rows.find(r => r.module === "quotes");
    if (!row2 || row2.action !== "noop") return { pass: false, detail: "current backup should preview as noop: " + JSON.stringify(row2) };
    await env.store.stageEdit("quotes", { records: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    const pv3 = await env.store.previewBackup(built.snapshot);
    if (!pv3.blocking || pv3.blocking.indexOf("quotes") === -1) return { pass: false, detail: "pending edit not flagged: " + JSON.stringify(pv3.blocking) };
    return { pass: true, detail: "rollback flagged at live rev 2 vs backup rev 1; current content noops; a staged edit blocks restore" };
  });

  T.register("backup: restore replaces live docs at a new revision and archives the old", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    await seedDoc(env.store, "quotes", c1);
    const built = await env.store.buildBackup();
    const c2 = { records: [{ id: 1, name: "Acme" }, { id: 2, name: "Beta" }] };
    await env.store.saveDoc("quotes", c2);
    const res = await env.store.restoreBackup(built.snapshot);
    if (!res.ok) return { pass: false, detail: "restore failed: " + JSON.stringify(res) };
    const row = res.results["quotes"];
    if (!row || row.action !== "replace" || row.revision !== 3 || row.previousRevision !== 2) {
      return { pass: false, detail: "restore row wrong: " + JSON.stringify(row) };
    }
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 3 || !eq(h.content, c1)) return { pass: false, detail: "canonical not replaced with backup content at rev 3" };
    const hist = await env.store.listHistory("quotes");
    if (!hist.length || hist[0].kind !== "restore" || hist[0].previous.revision !== 2 || !eq(hist[0].previous.content, c2)) {
      return { pass: false, detail: "pre-restore content not archived" };
    }
    const ld = await env.store.loadDoc("quotes");
    if (ld.state !== "cache" || !eq(ld.content, c1) || ld.revision !== 3) return { pass: false, detail: "cache not refreshed: " + JSON.stringify(ld).slice(0, 160) };
    const res2 = await env.store.restoreBackup(built.snapshot);
    if (!res2.ok || res2.results["quotes"].action !== "noop") return { pass: false, detail: "second restore should be a no-op" };
    const h2 = headOf(env, env.store, "quotes");
    const hist2 = await env.store.listHistory("quotes");
    if (h2.revision !== 3 || hist2.length !== 1) return { pass: false, detail: "no-op restore wrote or archived again" };
    return { pass: true, detail: "restored backup content at rev 3, archived the rev-2 version, cache refreshed; re-restore is a pure no-op" };
  });

  T.register("backup: restore is refused while a staged edit is pending", async () => {
    const env = mockEnv();
    await seedDoc(env.store, "quotes", { records: [{ id: 1 }] });
    const built = await env.store.buildBackup();
    await env.store.stageEdit("quotes", { records: [{ id: 1 }, { id: 2 }] });
    const res = await env.store.restoreBackup(built.snapshot);
    if (res.ok || res.code !== "pending_changes" || (res.modules || []).indexOf("quotes") === -1) {
      return { pass: false, detail: JSON.stringify(res).slice(0, 240) };
    }
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 1) return { pass: false, detail: "canonical changed during a refused restore" };
    return { pass: true, detail: "restore refused while an edit is staged; canonical untouched" };
  });

  T.register("backup: restore creates documents in a fresh namespace", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1, name: "Acme" }], settings: { nextNumber: 2 } };
    await seedDoc(env.store, "quotes", c1);
    const built = await env.store.buildBackup();
    const other = env.freshNs("bkz" + QS.randHex(6));
    const res = await other.store.restoreBackup(built.snapshot);
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    const row = res.results["quotes"];
    if (!row || row.action !== "create" || row.revision !== 1) return { pass: false, detail: JSON.stringify(row) };
    const h = headOf(env, other.store, "quotes");
    if (!h || h.revision !== 1 || !eq(h.content, c1)) return { pass: false, detail: "document not created in the other namespace" };
    return { pass: true, detail: "backup content created as a fresh rev-1 document in another namespace" };
  });

  T.register("backup: a downloaded backup hands write ownership to a keyless device", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    await seedDoc(env.store, "quotes", c1);
    const built = await env.store.buildBackup();
    if (!built.ok) return { pass: false, detail: "build failed" };
    const dev = env.freshDevice();
    const res = await dev.store.restoreBackup(built.snapshot);
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    if (res.results["quotes"].action !== "noop" || res.keysApplied < 1) {
      return { pass: false, detail: "expected noop with keys recovered: " + JSON.stringify(res).slice(0, 240) };
    }
    const upd = await dev.store.saveChecked("quotes", { records: [{ id: 1, name: "Acme" }, { id: 2 }] }, { expectedBase: 1 });
    if (!upd.ok) return { pass: false, detail: "device could not write after restore: " + JSON.stringify(upd) };
    return { pass: true, detail: "keys recovered from the downloaded backup; the device published rev 2 itself" };
  });

  T.register("backup: a published backup carries no write keys", async () => {
    const env = mockEnv();
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    await seedDoc(env.store, "quotes", c1);
    const pub = await env.store.publishBackup();
    if (!pub.ok) return { pass: false, detail: JSON.stringify(pub) };
    const rp = await env.store.readPublishedBackup();
    if (!rp.ok) return { pass: false, detail: JSON.stringify(rp) };
    if (rp.snapshot.editKeys && Object.keys(rp.snapshot.editKeys).length) return { pass: false, detail: "published backup leaked edit keys" };
    const dev = env.freshDevice();
    const res = await dev.store.restoreBackup(rp.snapshot);
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    if (res.keysApplied !== 0) return { pass: false, detail: "published backup somehow granted keys" };
    const upd = await dev.store.saveChecked("quotes", { records: [{ id: 1 }, { id: 2 }] }, { expectedBase: 1 });
    if (upd.ok || upd.code !== "no_edit_key") return { pass: false, detail: "keyless device wrote after published restore: " + JSON.stringify(upd) };
    return { pass: true, detail: "published backup restores data only — writing still requires the downloaded backup's keys" };
  });

  T.register("backup: backup zone renders on the admin station and rejects a bad file", async () => {
    if (!window.QU_BACKUP || !window.QU || !window.QU.store) return { pass: true, skip: true, detail: "backup UI not loaded" };
    await window.QU.go("admin");
    await window.QU.ready();
    const zone = await until(() => document.querySelector(".backup-zone"), 8000, 150);
    if (!zone) return { pass: true, skip: true, detail: "no store on the admin station" };
    const fullBtn = Array.from(zone.querySelectorAll("button")).find(b => b.textContent.indexOf("Full backup") !== -1);
    if (!fullBtn) return { pass: false, detail: "Full backup button missing" };
    const chip = zone.querySelector("[data-bkp-chip]");
    if (!chip || chip.textContent.indexOf(window.QU.store.modules.length + " modules") === -1) return { pass: false, detail: "module chip wrong: " + (chip && chip.textContent) };
    const fileBtn = zone.querySelector("[data-bkp-filerestore]");
    if (!fileBtn) return { pass: false, detail: "restore-from-file button missing" };
    const input = zone.querySelector("[data-bkp-file]");
    const dt = new DataTransfer();
    dt.items.add(new File(["this is not json"], "junk.json", { type: "application/json" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
    const statusEl = zone.querySelector("[data-bkp-status]");
    const errText = await until(() => {
      const m = statusEl && statusEl.querySelector(".bkp-msg.err");
      return m && m.textContent ? m.textContent : null;
    }, 5000, 150);
    if (!errText) return { pass: false, detail: "no inline error appeared for a bad file" };
    return { pass: true, detail: "zone rendered with " + window.QU.store.modules.length + " documents; bad file rejected inline" };
  });

  T.register("backup: real publish → newer edit → restore round-trip (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin || !r.uploadPlugin.editable || !r.kv) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "bkv" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.create({
        ns,
        modules: ["quotes"],
        kv: { get: k => r.kv.qu.get(k), set: (k, v) => r.kv.qu.set(k, v), delete: k => r.kv.qu.delete(k) },
        editable: { get: n => r.uploadPlugin.editable.get(n), set: (n, t, o) => r.uploadPlugin.editable.set(n, t, o || {}) },
        generatorName: window.generatorName || null,
        token: QS.tokenFrom(window.generatorPublicId || window.generatorName || "qu")
      });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const m = "quotes";
    const headName = store.fileName(m);
    const t0 = Date.now();
    const cleanup = async () => {
      const entries = await r.kv.qu.entries().catch(() => []);
      for (const pair of entries) {
        if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await r.kv.qu.delete(pair[0]);
      }
    };
    const readCanonical = async () => {
      let text = null;
      try { text = await r.uploadPlugin.editable.get(headName); } catch (e) {}
      if (!text) return null;
      try {
        const h = JSON.parse(text);
        return { revision: h.revision || 0, records: h.content && Array.isArray(h.content.records) ? h.content.records.length : 0, content: h.content };
      } catch (e) { return null; }
    };
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    const r1 = await store.saveChecked(m, c1, { expectedBase: 0 });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (r1.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live backup check skipped" };
    if (!r1.ok) return { pass: false, detail: "live create failed: " + JSON.stringify(r1) };
    try {
      const c1Seen = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 1 && h.records === 1 && h.content.records[0].name === "Acme") return h;
        return null;
      }, 45000, 1500);
      if (!c1Seen) return { pass: false, detail: "rev 1 never readable on the server" };
      const pub = await store.publishBackup();
      if (!pub.ok) return { pass: false, detail: "publish failed: " + JSON.stringify(pub) };
      let rp = null;
      for (let i = 0; i < 14; i++) {
        rp = await store.readPublishedBackup();
        if (rp.ok) break;
        await sleep(2500);
      }
      if (!rp || !rp.ok) return { pass: false, detail: "published backup never readable: " + JSON.stringify(rp).slice(0, 200) };
      const pQ = rp.snapshot.modules.find(x => x.module === m);
      if (!pQ || !pQ.present || pQ.revision !== 1 || !eq(pQ.content, c1)) return { pass: false, detail: "published content mismatch: " + JSON.stringify(pQ).slice(0, 200) };

      const waitA = 13000 - (Date.now() - t0);
      if (waitA > 0) await sleep(waitA);
      const c2 = { records: [{ id: 1, name: "Acme" }, { id: 2, name: "Beta" }] };
      let r2 = null;
      for (let i = 0; i < 6; i++) {
        r2 = await store.saveChecked(m, c2, { expectedBase: 1 });
        if (r2.ok) break;
        if (r2.code !== "server_lag" && r2.code !== "conflict_stale") break;
        await sleep(2500);
      }
      if (!r2 || !r2.ok) return { pass: false, detail: "live rev-2 update failed: " + JSON.stringify(r2) };
      const t1 = Date.now();
      const c2Seen = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 2 && h.records === 2) return h;
        return null;
      }, 45000, 1500);
      if (!c2Seen) return { pass: false, detail: "rev 2 never readable on the server" };
      const waitB = 13000 - (Date.now() - t1);
      if (waitB > 0) await sleep(waitB);

      const res = await store.restoreBackup(rp.snapshot);
      if (!res.ok) return { pass: false, detail: "live restore failed: " + JSON.stringify(res).slice(0, 300) };
      const row = res.results[m];
      if (!row || row.action !== "replace" || row.revision !== 3) return { pass: false, detail: "restore row wrong: " + JSON.stringify(row) };
      const restored = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 3 && h.records === 1) return h;
        return null;
      }, 45000, 1500);
      if (!restored) return { pass: false, detail: "canonical never settled at restored rev 3" };
      const hist = await store.listHistory(m);
      if (!hist.length || hist[0].kind !== "restore" || hist[0].previous.revision !== 2) return { pass: false, detail: "pre-restore live version not archived" };
      return { pass: true, detail: "published rev 1, live advanced to rev 2, restore wrote rev 3 and archived rev 2 (" + Math.round((Date.now() - t0) / 1000) + "s incl. write throttles)" };
    } finally {
      await cleanup();
    }
  });
})();
