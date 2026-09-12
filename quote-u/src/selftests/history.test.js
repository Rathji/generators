// quote-u — document version history with restore tests (roadmap task 8)
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
    const step = stepMs || 120;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > limit) return null;
      await sleep(step);
    }
  }
  function eq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  function mockEnv() {
    const mapsA = new Map();
    const mapsB = new Map();
    const files = new Map();
    const kvOf = map => ({
      get: async k => map.get(k),
      set: async (k, v) => { map.set(k, v); },
      delete: async k => { map.delete(k); }
    });
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
    const ns = "hi" + QS.randHex(6);
    const mods = ["quotes"];
    const storeA = QS.create({ ns, editable, modules: mods, kv: kvOf(mapsA) });
    const storeB = QS.create({ ns, editable, modules: mods, kv: kvOf(mapsB) });
    const storeC = QS.create({ ns, editable, modules: mods, kv: kvOf(new Map()) });
    function exportKeysToB() {
      for (const k of mapsA.keys()) if (k.startsWith("editkey:")) mapsB.set(k, mapsA.get(k));
    }
    return { ns, files, editable, mapsA, mapsB, storeA, storeB, storeC, exportKeysToB };
  }

  function headOf(files, store, module) {
    const f = files.get(store.fileName(module));
    return f ? JSON.parse(f.text) : null;
  }

  async function conflictThenResolve(env) {
    const A = env.storeA;
    const B = env.storeB;
    const c1 = { records: [{ id: 1, stage: "new", name: "Acme" }] };
    await A.saveChecked("quotes", c1, { expectedBase: 0 });
    env.exportKeysToB();
    await B.loadDoc("quotes");
    const theirs = { records: [{ id: 1, stage: "won", name: "Acme" }, { id: 2, name: "Beta" }] };
    await A.saveChecked("quotes", theirs, { expectedBase: 1 });
    const mine = { records: [{ id: 1, stage: "new", name: "Acme", note: "local" }] };
    const cr = await B.saveChecked("quotes", mine, { expectedBase: 1 });
    assert(cr.conflict, "expected a conflict: " + JSON.stringify(cr).slice(0, 200));
    const rr = await B.resolveConflict("quotes", "keepMine");
    assert(rr.ok && rr.revision === 3, "keepMine failed: " + JSON.stringify(rr));
    return { mine, theirs };
  }

  T.register("history: describeEntry labels conflict, merge and restore entries", async () => {
    if (!window.QU_HISTORY) return { pass: true, skip: true, detail: "history module not loaded" };
    const H = window.QU_HISTORY;
    if (H.entryKind({ choice: "keepMine" }) !== "conflict") return { pass: false, detail: "keepMine kind wrong" };
    if (!/keeping this device/i.test(H.describeEntry({ choice: "keepMine", revision: 3 }))) return { pass: false, detail: "keepMine label wrong" };
    if (!/keeping the other device/i.test(H.describeEntry({ choice: "keepTheirs", revision: 2 }))) return { pass: false, detail: "keepTheirs label wrong" };
    if (H.entryKind({ kind: "restore" }) !== "backup-restore") return { pass: false, detail: "restore kind wrong" };
    if (H.entryKind({ kind: "history-restore" }) !== "history-restore") return { pass: false, detail: "history-restore kind wrong" };
    if (!/restored to rev 5/i.test(H.describeEntry({ kind: "history-restore", restoredRevision: 5, previous: { revision: 4 } }))) return { pass: false, detail: "history-restore label wrong" };
    return { pass: true, detail: "kinds and labels distinguish conflict / merge / backup-restore / history-restore" };
  });

  T.register("history: versionsOf offers the archived losing side of a conflict", async () => {
    if (!window.QU_HISTORY) return { pass: true, skip: true, detail: "history module not loaded" };
    const H = window.QU_HISTORY;
    const vMine = H.versionsOf({ choice: "keepMine", mine: { content: { a: 1 }, revision: 1 }, theirs: { content: { b: 2 }, revision: 2 } });
    if (vMine.length !== 1 || vMine[0].key !== "theirs" || !eq(vMine[0].content, { b: 2 })) return { pass: false, detail: "keepMine versions wrong: " + JSON.stringify(vMine) };
    const vTheirs = H.versionsOf({ choice: "keepTheirs", mine: { content: { a: 1 }, revision: 1 }, theirs: { content: { b: 2 }, revision: 2 } });
    if (vTheirs.length !== 1 || vTheirs[0].key !== "mine") return { pass: false, detail: "keepTheirs versions wrong" };
    const vMerge = H.versionsOf({ choice: "merge", revision: 3, mine: { content: { a: 1 }, revision: 1 }, theirs: { content: { b: 2 }, revision: 2 }, merged: { c: 3 } });
    if (vMerge.length !== 3) return { pass: false, detail: "merge versions wrong: " + vMerge.length };
    const vRestore = H.versionsOf({ kind: "restore", previous: { content: { old: true }, revision: 2 } });
    if (vRestore.length !== 1 || !eq(vRestore[0].content, { old: true })) return { pass: false, detail: "restore versions wrong" };
    return { pass: true, detail: "each entry exposes exactly the separately-restorable content" };
  });

  T.register("history: restoreHistoryVersion refuses non-object content", async () => {
    const env = mockEnv();
    const r = await env.storeA.restoreHistoryVersion("quotes", { content: [1, 2, 3] });
    if (r.ok || r.code !== "bad_content") return { pass: false, detail: "got " + JSON.stringify(r) };
    return { pass: true, detail: "an array is not a document and was refused" };
  });

  T.register("history: restoring an archived version publishes it at a new revision and archives the replaced one", async () => {
    const env = mockEnv();
    const { theirs } = await conflictThenResolve(env);
    const B = env.storeB;
    const hist = await B.listHistory("quotes");
    assert(hist.length === 1 && eq(hist[0].theirs.content, theirs), "history did not archive the losing side");
    const res = await B.restoreHistoryVersion("quotes", { content: theirs, label: "archived other-device version" });
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    if (res.revision !== 4 || res.previousRevision !== 3) return { pass: false, detail: "expected rev 4 replacing rev 3, got " + JSON.stringify(res) };
    const head = headOf(env.files, env.storeA, "quotes");
    if (head.revision !== 4 || !eq(head.content, theirs)) return { pass: false, detail: "canonical does not hold the restored version at rev 4" };
    const hist2 = await B.listHistory("quotes");
    if (hist2.length !== 2 || hist2[0].kind !== "history-restore") return { pass: false, detail: "history-restore entry missing: " + JSON.stringify(hist2.map(h => h.kind)) };
    if (hist2[0].previous.revision !== 3) return { pass: false, detail: "replaced version not archived" };
    const ld = await B.loadDoc("quotes");
    if (!eq(ld.content, theirs) || ld.revision !== 4) return { pass: false, detail: "cache not refreshed after restore" };
    return { pass: true, detail: "restored an archived version at rev 4; the replaced rev 3 is now archived" };
  });

  T.register("history: restoreHistoryVersion refuses while a sync item is pending", async () => {
    const env = mockEnv();
    const A = env.storeA;
    const B = env.storeB;
    await A.saveChecked("quotes", { records: [{ id: 1, stage: "new" }] }, { expectedBase: 0 });
    env.exportKeysToB();
    await B.loadDoc("quotes");
    await B.stageEdit("quotes", { records: [{ id: 1, stage: "new", note: "offline" }] });
    const res = await B.restoreHistoryVersion("quotes", { content: { records: [] } });
    if (res.ok || res.code !== "pending_changes") return { pass: false, detail: "expected pending_changes, got " + JSON.stringify(res).slice(0, 200) };
    const head = headOf(env.files, A, "quotes");
    if (head.revision !== 1) return { pass: false, detail: "canonical changed during a refused restore" };
    return { pass: true, detail: "restore refused while an edit is staged; canonical untouched" };
  });

  T.register("history: restoreHistoryVersion refuses without a write key", async () => {
    const env = mockEnv();
    await env.storeA.saveChecked("quotes", { records: [{ id: 1 }] }, { expectedBase: 0 });
    const res = await env.storeC.restoreHistoryVersion("quotes", { content: { records: [{ id: 9 }] } });
    if (res.ok || res.code !== "no_edit_key") return { pass: false, detail: "expected no_edit_key, got " + JSON.stringify(res).slice(0, 200) };
    const head = headOf(env.files, env.storeA, "quotes");
    if (head.revision !== 1) return { pass: false, detail: "canonical changed by a keyless restore" };
    return { pass: true, detail: "a keyless device cannot publish a restore" };
  });

  T.register("history: history zone renders entries and restores through the UI", async () => {
    if (!window.QU_HISTORY || !window.QU_HISTORY.renderZone) return { pass: true, skip: true, detail: "history UI not loaded" };
    const env = mockEnv();
    const { theirs } = await conflictThenResolve(env);
    const B = env.storeB;
    const zone = await window.QU_HISTORY.renderZone(B, { module: "quotes" });
    if (!zone) return { pass: false, detail: "no history zone rendered" };
    const holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-10000px";
    holder.appendChild(zone);
    document.body.appendChild(holder);
    try {
      if (!zone.querySelector(".bkp-loading") && !zone.querySelector(".arc-batch")) {
        const arrived = await until(() => zone.querySelector(".arc-batch") ? true : null, 5000, 120);
        if (!arrived) return { pass: false, detail: "history entries never rendered" };
      }
      const restBtn = Array.from(zone.querySelectorAll("button")).find(b => b.textContent.indexOf("Restore this version") !== -1);
      if (!restBtn) return { pass: false, detail: "restore button missing" };
      restBtn.click();
      const done = await until(async () => {
        const h = await B.listHistory("quotes");
        return h.length >= 2 && h[0].kind === "history-restore" ? h[0] : null;
      }, 6000, 150);
      if (!done) return { pass: false, detail: "UI restore did not archive a history-restore entry" };
      const head = headOf(env.files, env.storeA, "quotes");
      if (!eq(head.content, theirs)) return { pass: false, detail: "UI restore did not republish the archived version" };
      return { pass: true, detail: "zone listed the archived version; the restore button republished it at a new revision" };
    } finally {
      holder.remove();
    }
  });

  T.register("history: real published restore then history restore on live files (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin || !r.uploadPlugin.editable || !r.kv) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "hiv" + Date.now().toString(36) + QS.randHex(4);
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
    if (r1.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live history check skipped" };
    if (!r1.ok) return { pass: false, detail: "live create failed: " + JSON.stringify(r1) };
    try {
      const c1Seen = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 1 && h.records === 1) return h;
        return null;
      }, 45000, 1500);
      if (!c1Seen) return { pass: false, detail: "rev 1 never readable on the server" };
      const waitA = 13000 - (Date.now() - t0);
      if (waitA > 0) await sleep(waitA);
      const c2 = { records: [{ id: 1, name: "Acme" }, { id: 2, name: "Beta" }] };
      const r2 = await store.saveChecked(m, c2, { expectedBase: 1 });
      if (!r2.ok) return { pass: false, detail: "live rev-2 update failed: " + JSON.stringify(r2) };
      const c2Seen = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 2 && h.records === 2) return h;
        return null;
      }, 45000, 1500);
      if (!c2Seen) return { pass: false, detail: "rev 2 never readable on the server" };
      const waitB = 13000 - (Date.now() - t0);
      if (waitB > 0) await sleep(waitB);
      const res = await store.restoreHistoryVersion(m, { content: c1, label: "live history test" });
      if (!res.ok || res.revision !== 3) return { pass: false, detail: "live history restore failed: " + JSON.stringify(res) };
      const settled = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 3 && h.records === 1) return h;
        return null;
      }, 45000, 1500);
      if (!settled) return { pass: false, detail: "canonical never settled at restored rev 3" };
      const hist = await store.listHistory(m);
      if (!hist.length || hist[0].kind !== "history-restore" || hist[0].previous.revision !== 2) return { pass: false, detail: "live history-restore entry missing" };
      return { pass: true, detail: "live rev 2 replaced by a history restore at rev 3, with rev 2 archived (" + Math.round((Date.now() - t0) / 1000) + "s incl. write throttles)" };
    } finally {
      await cleanup();
    }
  });
})();
