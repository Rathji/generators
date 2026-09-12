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

  function fail(msg) {
    throw new Error(msg);
  }
  function assert(cond, msg) {
    if (!cond) fail(msg);
  }

  function mockTransport(opts) {
    opts = opts || {};
    const mapsA = new Map();
    const mapsB = new Map();
    const files = new Map();
    function kvOf(store) {
      return {
        get: async k => store.get(k),
        set: async (k, v) => { store.set(k, v); },
        delete: async k => { store.delete(k); }
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
    const ns = opts.ns || "sd" + BS.randHex(6);
    const mods = ["companies"];
    const base = { ns, editable, modules: mods };
    const storeA = BS.create(Object.assign({}, base, { kv: kvOf(mapsA) }, opts));
    const storeB = BS.create(Object.assign({}, base, { kv: kvOf(mapsB) }));
    function exportKeysToB() {
      for (const k of mapsA.keys()) if (k.startsWith("editkey:")) mapsB.set(k, mapsA.get(k));
    }
    return { ns, files, mapsA, mapsB, kvA: kvOf(mapsA), kvB: kvOf(mapsB), editable, storeA, storeB, exportKeysToB };
  }

  function headOf(files, store, module) {
    const f = files.get(store.fileName(module));
    return f ? JSON.parse(f.text) : null;
  }

  async function makeConflict(p, mineContent) {
    const A = p.storeA;
    const B = p.storeB;
    const c1 = { records: [{ id: 1, stage: "new", name: "Acme" }] };
    const r1 = await A.saveChecked("companies", c1, { expectedBase: 0 });
    assert(r1.ok && r1.revision === 1 && r1.created, "A create failed: " + JSON.stringify(r1));
    p.exportKeysToB();
    const bl = await B.loadDoc("companies");
    assert(bl.ok && bl.revision === 1, "B initial load failed: " + JSON.stringify(bl));
    const c2 = { records: [{ id: 1, stage: "won", name: "Acme" }, { id: 2, name: "Beta" }] };
    const r2 = await A.saveChecked("companies", c2, { expectedBase: 1 });
    assert(r2.ok && r2.revision === 2, "A second write failed: " + JSON.stringify(r2));
    const mine = mineContent || { records: [{ id: 1, stage: "new", name: "Acme", note: "local" }] };
    const cr = await B.saveChecked("companies", mine, { expectedBase: 1 });
    assert(!cr.ok && cr.code === "conflict", "expected conflict, got " + JSON.stringify(cr).slice(0, 220));
    assert(cr.conflict && cr.conflict.theirs.revision === 2, "conflict theirs revision wrong");
    assert(eq(cr.conflict.mine.content, mine), "conflict mine content wrong");
    const head = headOf(p.files, A, "companies");
    assert(head.revision === 2 && head.content.records.length === 2, "canonical was modified by the losing save");
    return { mine, theirs: c2 };
  }

  T.register("sync: saveChecked requires the loaded revision (expectedBase)", async () => {
    const p = mockTransport();
    const r = await p.storeA.saveChecked("companies", { records: [] }, {});
    if (r.ok || r.code !== "expected_base_required") return { pass: false, detail: "got " + JSON.stringify(r) };
    return { pass: true, detail: "missing expectedBase refused" };
  });

  T.register("sync: two-device divergence stages mine, keeps canonical, reports conflict", async () => {
    const p = mockTransport();
    const { mine } = await makeConflict(p);
    const B = p.storeB;
    const dirty = await B.loadDoc("companies");
    if (dirty.state !== "dirty" || !eq(dirty.content, mine)) return { pass: false, detail: "loadDoc did not surface the staged edit: " + JSON.stringify(dirty).slice(0, 200) };
    const conflicts = await B.listConflicts();
    if (conflicts.length !== 1) return { pass: false, detail: "listConflicts=" + conflicts.length };
    const sum = await B.statusSummary();
    if (sum.counts.conflict !== 1) return { pass: false, detail: "statusSummary counts wrong: " + JSON.stringify(sum.counts) };
    return { pass: true, detail: "mine staged at base 1, canonical untouched at rev 2, state=conflict" };
  });

  T.register("sync: keep-mine publishes the local version and archives theirs", async () => {
    const p = mockTransport();
    const { mine, theirs } = await makeConflict(p);
    const rr = await p.storeB.resolveConflict("companies", "keepMine");
    if (!rr.ok) return { pass: false, detail: JSON.stringify(rr) };
    const head = headOf(p.files, p.storeA, "companies");
    if (head.revision !== 3 || !eq(head.content, mine)) return { pass: false, detail: "canonical is not mine at rev 3" };
    const conflicts = await p.storeB.listConflicts();
    const hist = await p.storeB.listHistory("companies");
    if (conflicts.length) return { pass: false, detail: "conflict not cleared" };
    if (hist.length !== 1 || hist[0].choice !== "keepMine" || !eq(hist[0].theirs.content, theirs)) {
      return { pass: false, detail: "resolution history missing the losing side" };
    }
    const ld = await p.storeB.loadDoc("companies");
    if (ld.state !== "cache" || !eq(ld.content, mine)) return { pass: false, detail: "cache not refreshed after keep-mine" };
    return { pass: true, detail: "published rev 3, theirs archived, conflict cleared" };
  });

  T.register("sync: keep-theirs keeps canonical and archives mine", async () => {
    const p = mockTransport();
    const { mine, theirs } = await makeConflict(p);
    const rr = await p.storeB.resolveConflict("companies", "keepTheirs");
    if (!rr.ok || rr.revision !== 2) return { pass: false, detail: JSON.stringify(rr) };
    const head = headOf(p.files, p.storeA, "companies");
    if (head.revision !== 2 || !eq(head.content, theirs)) return { pass: false, detail: "canonical changed by keep-theirs" };
    const hist = await p.storeB.listHistory("companies");
    if (hist.length !== 1 || !eq(hist[0].mine.content, mine)) return { pass: false, detail: "history did not archive mine" };
    const ld = await p.storeB.loadDoc("companies");
    if (!eq(ld.content, theirs)) return { pass: false, detail: "cache not updated to theirs" };
    return { pass: true, detail: "canonical untouched at rev 2, mine archived" };
  });

  T.register("sync: startup reconciliation auto-publishes a fast-forward staged edit", async () => {
    const p = mockTransport();
    const A = p.storeA;
    const B = p.storeB;
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    await A.saveChecked("companies", c1, { expectedBase: 0 });
    p.exportKeysToB();
    await B.loadDoc("companies");
    const mine = { records: [{ id: 1, name: "Acme" }, { id: 2, name: "Offline add" }] };
    const st = await B.stageEdit("companies", mine);
    if (!st.ok || st.state !== "pending") return { pass: false, detail: "stage failed: " + JSON.stringify(st) };
    const B2 = BS.create({ ns: p.ns, kv: p.kvB, editable: p.editable, modules: ["companies"] });
    await B2.ready();
    const head = headOf(p.files, A, "companies");
    if (head.revision !== 2 || !eq(head.content, mine)) return { pass: false, detail: "staged edit was not published on boot" };
    const ld = await B2.loadDoc("companies");
    if (ld.state === "dirty") return { pass: false, detail: "ledger not cleared after publish" };
    const sum = await B2.statusSummary();
    if (sum.counts.synced !== 1) return { pass: false, detail: "expected synced after publish" };
    return { pass: true, detail: "boot reconciled and published rev 2 automatically" };
  });

  T.register("sync: startup reconciliation flags a cross-device conflict and writes nothing", async () => {
    const p = mockTransport();
    const A = p.storeA;
    const B = p.storeB;
    const c1 = { records: [{ id: 1, stage: "new" }] };
    await A.saveChecked("companies", c1, { expectedBase: 0 });
    p.exportKeysToB();
    await B.loadDoc("companies");
    const mine = { records: [{ id: 1, stage: "new", note: "offline note" }] };
    await B.stageEdit("companies", mine);
    const c2 = { records: [{ id: 1, stage: "won" }, { id: 2 }] };
    await A.saveChecked("companies", c2, { expectedBase: 1 });
    const B2 = BS.create({ ns: p.ns, kv: p.kvB, editable: p.editable, modules: ["companies"] });
    const boot = await B2.ready();
    if (!boot.ok) return { pass: false, detail: "boot failed" };
    const head = headOf(p.files, A, "companies");
    if (head.revision !== 2 || !eq(head.content, c2)) return { pass: false, detail: "canonical was touched during a conflicting boot" };
    const conflicts = await B2.listConflicts();
    if (conflicts.length !== 1) return { pass: false, detail: "no conflict materialized on boot" };
    const sum = await B2.statusSummary();
    if (sum.counts.conflict !== 1) return { pass: false, detail: "state not conflict: " + JSON.stringify(sum.counts) };
    return { pass: true, detail: "conflict surfaced; canonical stayed at rev 2" };
  });

  T.register("sync: field-level merge combines both sides with per-field picks", async () => {
    const p = mockTransport();
    const A = p.storeA;
    const B = p.storeB;
    const c1 = { records: [{ id: 1, name: "Acme", stage: "new", note: "" }], settings: { nextId: 2 }, theme: "light" };
    const r1 = await A.saveChecked("companies", c1, { expectedBase: 0 });
    if (!r1.ok) return { pass: false, detail: JSON.stringify(r1) };
    p.exportKeysToB();
    await B.loadDoc("companies");
    const c2 = { records: [{ id: 1, name: "Acme", stage: "won", note: "closed" }], settings: { nextId: 3 }, theme: "dark" };
    await A.saveChecked("companies", c2, { expectedBase: 1 });
    const mine = { records: [{ id: 1, name: "Acme Ltd", stage: "qualified", note: "" }, { id: 2, name: "Beta" }], settings: { nextId: 2 }, theme: "light" };
    const cr = await B.saveChecked("companies", mine, { expectedBase: 1 });
    if (!cr.conflict) return { pass: false, detail: "expected conflict, got " + JSON.stringify(cr).slice(0, 200) };
    const md = await B.mergeDiff("companies");
    if (!md.ok) return { pass: false, detail: JSON.stringify(md) };
    const changedId1 = md.diff.records.changed.find(r => r.id === "1");
    if (!changedId1) return { pass: false, detail: "record 1 not flagged as changed on both sides" };
    const stageF = changedId1.fields.find(f => f.key === "stage");
    if (!stageF || !stageF.conflict) return { pass: false, detail: "stage field should be a real conflict" };
    const picks = { top: { theme: "theirs" }, recs: { "1": { name: "theirs", stage: "theirs" } } };
    const built = await B.buildMerged("companies", picks);
    if (!built.ok) return { pass: false, detail: JSON.stringify(built) };
    const m = built.merged;
    if (m.theme !== "dark") return { pass: false, detail: "theme pick ignored: " + JSON.stringify(m.theme) };
    if (!eq(m.settings, { nextId: 3 })) return { pass: false, detail: "settings merge wrong: " + JSON.stringify(m.settings) };
    if (m.records.length !== 2) return { pass: false, detail: "records length " + m.records.length };
    const rec1 = m.records.find(r => r.id === 1);
    if (rec1.name !== "Acme" || rec1.stage !== "won" || rec1.note !== "closed") return { pass: false, detail: "record 1 merge wrong: " + JSON.stringify(rec1) };
    const rec2 = m.records.find(r => r.id === 2);
    if (!rec2 || rec2.name !== "Beta") return { pass: false, detail: "record 2 (mine-only) lost" };
    const rr = await B.resolveConflict("companies", "merge", { merged: m, picks });
    if (!rr.ok || rr.revision !== 3) return { pass: false, detail: "merge resolve failed: " + JSON.stringify(rr) };
    const head = headOf(p.files, A, "companies");
    if (!eq(head.content, m)) return { pass: false, detail: "canonical does not hold the merged document" };
    const hist = await B.listHistory("companies");
    if (hist.length !== 1 || !eq(hist[0].merged, m)) return { pass: false, detail: "merged version not archived" };
    return { pass: true, detail: "merged rev 3 with per-field picks; both sides preserved" };
  });

  T.register("sync: a conflict that moved while under review is never overwritten", async () => {
    const p = mockTransport();
    const { mine } = await makeConflict(p);
    const A = p.storeA;
    await A.saveChecked("companies", { records: [{ id: 9, stage: "third-writer" }] }, { expectedBase: 2 });
    const rr = await p.storeB.resolveConflict("companies", "keepMine");
    if (rr.ok || rr.code !== "conflict_moved") return { pass: false, detail: "expected conflict_moved, got " + JSON.stringify(rr).slice(0, 200) };
    const head = headOf(p.files, A, "companies");
    if (head.revision !== 3 || head.content.records[0].id !== 9) return { pass: false, detail: "a moved conflict was overwritten" };
    const conflicts = await p.storeB.listConflicts();
    if (!conflicts.length) return { pass: false, detail: "conflict record lost after conflict_moved" };
    const dirty = await p.storeB.loadDoc("companies");
    if (dirty.state !== "dirty" || !eq(dirty.content, mine)) return { pass: false, detail: "staged edit lost after conflict_moved" };
    return { pass: true, detail: "refused to write over the moved document; edit still staged" };
  });

  T.register("sync: resolution UI renders a conflict and keep-mine resolves it", async () => {
    const p = mockTransport();
    const { mine } = await makeConflict(p);
    if (!window.CRM_SYNC) return { pass: true, skip: true, detail: "syncpanel not loaded" };
    const zone = await window.CRM_SYNC.conflictBlocks(p.storeB, { onChange: null });
    if (!zone) return { pass: false, detail: "no conflict zone rendered" };
    const blocks = zone.querySelectorAll(".conflict-block");
    if (blocks.length !== 1) return { pass: false, detail: "expected 1 conflict block, got " + blocks.length };
    const modTxt = zone.textContent;
    if (modTxt.indexOf("Companies") === -1) return { pass: false, detail: "module label missing" };
    const keepMineBtn = Array.from(zone.querySelectorAll("button")).find(b => b.textContent.indexOf("Keep this device's changes") !== -1);
    if (!keepMineBtn) return { pass: false, detail: "keep-mine button missing" };
    keepMineBtn.click();
    const cleared = await until(async () => (await p.storeB.listConflicts()).length === 0 ? true : null, 5000, 150);
    if (!cleared) return { pass: false, detail: "conflict not cleared after UI keep-mine" };
    const head = headOf(p.files, p.storeA, "companies");
    if (!eq(head.content, mine)) return { pass: false, detail: "UI keep-mine did not publish mine" };
    return { pass: true, detail: "conflict block rendered; keep-mine published through the UI" };
  });

  T.register("sync: field-level merge flow works through the UI", async () => {
    const p = mockTransport();
    const A = p.storeA;
    const B = p.storeB;
    const c1 = { records: [{ id: 1, name: "Acme", stage: "new", note: "" }], theme: "light" };
    await A.saveChecked("companies", c1, { expectedBase: 0 });
    p.exportKeysToB();
    await B.loadDoc("companies");
    const c2 = { records: [{ id: 1, name: "Acme", stage: "won", note: "closed" }], theme: "dark" };
    await A.saveChecked("companies", c2, { expectedBase: 1 });
    const mine = { records: [{ id: 1, name: "Acme Ltd", stage: "qualified", note: "" }, { id: 2, name: "Beta" }], theme: "light" };
    const cr = await B.saveChecked("companies", mine, { expectedBase: 1 });
    if (!cr.conflict) return { pass: false, detail: "expected conflict" };
    if (!window.CRM_SYNC) return { pass: true, skip: true, detail: "syncpanel not loaded" };
    const zone = await window.CRM_SYNC.conflictBlocks(B, { onChange: null });
    const mergeBtn = Array.from(zone.querySelectorAll("button")).find(b => b.textContent.indexOf("Merge field by field") !== -1);
    mergeBtn.click();
    const box = await until(() => zone.querySelector(".merge-box") ? zone.querySelector(".merge-box") : null, 4000, 120);
    if (!box) return { pass: false, detail: "merge box did not render" };
    const recPicks = box.querySelectorAll("input[data-role='rec-pick']");
    if (!recPicks.length) return { pass: false, detail: "no record field picks rendered" };
    const stageRadio = Array.from(box.querySelectorAll("input[data-role='rec-pick']")).find(i => i.dataset.field === "stage" && i.value === "theirs");
    if (!stageRadio) return { pass: false, detail: "stage picker missing" };
    stageRadio.click();
    const applyBtn = Array.from(zone.querySelectorAll("button")).find(b => b.textContent === "Apply merged changes");
    applyBtn.click();
    const cleared = await until(async () => (await B.listConflicts()).length === 0 ? true : null, 5000, 150);
    if (!cleared) return { pass: false, detail: "conflict not cleared after UI merge" };
    const head = headOf(p.files, A, "companies");
    const rec1 = (head.content.records || []).find(r => r.id === 1);
    if (head.revision !== 3 || rec1.stage !== "won") return { pass: false, detail: "merged canonical wrong: " + JSON.stringify(head.content).slice(0, 220) };
    if (!head.content.records.find(r => r.id === 2)) return { pass: false, detail: "mine-only record lost through UI merge" };
    return { pass: true, detail: "per-field pick applied; both sides' records kept" };
  });

  T.register("sync: statusSummary tracks pending and synced states", async () => {
    const p = mockTransport();
    const A = p.storeA;
    const B = p.storeB;
    const c1 = { records: [{ id: 1 }] };
    await A.saveChecked("companies", c1, { expectedBase: 0 });
    p.exportKeysToB();
    await B.loadDoc("companies");
    await B.stageEdit("companies", { records: [{ id: 1 }, { id: 2 }] });
    const sum = await B.statusSummary();
    if (sum.counts.pending !== 1) return { pass: false, detail: "expected pending=1, got " + JSON.stringify(sum.counts) };
    await B.reconcileAll();
    const sum2 = await B.statusSummary();
    if (sum2.counts.synced !== 1 || sum2.counts.pending !== 0) return { pass: false, detail: "after reconcile: " + JSON.stringify(sum2.counts) };
    return { pass: true, detail: "pending before reconcile, synced after" };
  });

  T.register("sync: real two-device conflict + keep-theirs (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin || !r.uploadPlugin.editable) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "syl" + Date.now().toString(36) + BS.randHex(4);
    const genToken = BS.tokenFrom(window.generatorPublicId || window.generatorName || "bcrm");
    const genName = window.generatorName || null;
    const edReal = {
      get: name => r.uploadPlugin.editable.get(name),
      set: (name, text, o) => r.uploadPlugin.editable.set(name, text, o || {})
    };
    let A, B;
    try {
      A = BS.create({ ns, kv: { get: k => r.kv.bcrm.get(k), set: (k, v) => r.kv.bcrm.set(k, v), delete: k => r.kv.bcrm.delete(k) }, editable: edReal, modules: ["livesync"], generatorName: genName, token: genToken });
      B = BS.create({ ns, kv: { get: k => r.kv.bcrmb.get(k), set: (k, v) => r.kv.bcrmb.set(k, v), delete: k => r.kv.bcrmb.delete(k) }, editable: edReal, modules: ["livesync"], generatorName: genName, token: genToken });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const m = "livesync";
    const c1 = { records: [{ id: 1, stage: "new" }] };
    const headName = A.fileName(m);
    const t0 = Date.now();
    const r1 = await A.saveChecked(m, c1, { expectedBase: 0 });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (!r1.ok) return { pass: false, detail: "live create failed: " + JSON.stringify(r1) };

    const readRev = async () => {
      let text = null;
      try { text = await r.uploadPlugin.editable.get(headName); } catch (e) {}
      if (!text) return 0;
      try { const h = JSON.parse(text); return h.revision || 0; } catch (e) { return 0; }
    };
    let rev = await until(readRev, 15000, 1000);
    if (!rev) {
      const retry = await A.saveChecked(m, c1, { expectedBase: 0 });
      if (!retry.ok) return { pass: false, detail: "live create did not settle: " + JSON.stringify(retry) };
      rev = await until(readRev, 15000, 1000);
    }
    if (!rev) return { pass: false, detail: "canonical create never visible" };

    const keysA = await r.kv.bcrm.entries().catch(() => []);
    for (const pair of keysA) {
      const k = pair[0];
      if (k.startsWith("editkey:" + ns + ":")) await r.kv.bcrmb.set(k, pair[1]);
    }

    const mine = { records: [{ id: 1, stage: "new", note: "offline note" }] };
    const staged = await B.stageEdit(m, mine);
    if (!staged.ok || staged.baseRevision !== 1) {
      return { pass: false, detail: "B stage failed (base=" + (staged.baseRevision) + "): " + JSON.stringify(staged).slice(0, 200) };
    }

    const waitMs = 13000 - (Date.now() - t0);
    if (waitMs > 0) await sleep(waitMs);
    const c2 = { records: [{ id: 1, stage: "won" }, { id: 2, name: "Beta" }] };
    const r2 = await A.saveChecked(m, c2, { expectedBase: 1 });
    if (!r2.ok) return { pass: false, detail: "A update failed: " + JSON.stringify(r2) };

    const settled = await until(async () => {
      const v = await readRev();
      if (v >= 2) {
        const ld = await A.loadDoc(m, { refresh: true }).catch(() => null);
        return ld && ld.ok && ld.content && ld.content.records.length === 2 ? true : null;
      }
      return null;
    }, 45000, 1500);
    if (!settled) return { pass: false, detail: "canonical rev 2 never readable within 45s" };

    const recon = await B.reconcileAll().catch(() => null);
    const st = recon && recon[m];
    if (!st || st.state !== "conflict") {
      const conflicts = await B.listConflicts();
      if (!conflicts.length) return { pass: false, detail: "live conflict not detected: " + JSON.stringify(st) + " conflicts=" + conflicts.length };
    }
    const rr = await B.resolveConflict(m, "keepTheirs");
    if (!rr.ok || rr.revision !== 2) return { pass: false, detail: "keep-theirs failed: " + JSON.stringify(rr) };
    const still2 = await until(async () => {
      const v = await readRev();
      if (v !== 2) return null;
      const ld = await B.loadDoc(m).catch(() => null);
      return ld && ld.content && ld.content.records.length === 2 ? true : null;
    }, 20000, 1200);
    if (!still2) return { pass: false, detail: "canonical did not stay at rev 2 with their content" };
    const hist = await B.listHistory(m);
    if (!hist.length || !eq(hist[0].mine.content, mine)) return { pass: false, detail: "history missing archived mine" };
    const cleanup = async () => {
      for (const folder of [r.kv.bcrm, r.kv.bcrmb]) {
        const entries = await folder.entries().catch(() => []);
        for (const pair of entries) {
          if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await folder.delete(pair[0]);
        }
      }
    };
    await cleanup();
    return { pass: true, detail: "two live devices diverged; keep-theirs kept rev 2 and archived mine (" + Math.round((Date.now() - t0) / 1000) + "s)" };
  });
})();
