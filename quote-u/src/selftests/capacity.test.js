// quote-u — capacity reporting & guided archival tests (roadmap task 8)
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
    const ns = opts.ns || "ca" + QS.randHex(6);
    const modules = opts.modules || QS.DEFAULT_MODULES.slice();
    function build(kvMap, nsOverride) {
      const m = kvMap || new Map();
      const buildOpts = {
        ns: nsOverride || ns,
        modules,
        editable,
        kv: {
          get: async k => m.get(k),
          set: async (k, v) => { m.set(k, v); },
          delete: async k => { m.delete(k); }
        }
      };
      if (opts.budget) buildOpts.budget = opts.budget;
      return QS.create(buildOpts);
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

  function isoYearsAgo(years, extraMs) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    if (extraMs) d.setTime(d.getTime() + extraMs);
    return d.toISOString();
  }

  function quoteRec(id, title, createdAt) {
    return { id, title, value: 1000 * id, createdAt };
  }
  function oldQuotes() {
    return [quoteRec(1, "Old Corp A", isoYearsAgo(2, -60000)), quoteRec(2, "Old Corp B", isoYearsAgo(2, -120000))];
  }
  function freshQuotes() {
    return [quoteRec(3, "Fresh A", isoYearsAgo(0, -30 * 86400000)), quoteRec(4, "Fresh B", isoYearsAgo(0, -20 * 86400000))];
  }

  T.register("capacity: capacityInfo sizes live docs, files and archives for every module", async () => {
    const env = mockEnv({ modules: ["quotes", "line_items"] });
    const c1 = { records: [{ id: 1, name: "Acme" }] };
    await seedDoc(env.store, "quotes", c1);
    const info = await env.store.capacityInfo();
    if (!info.ok) return { pass: false, detail: JSON.stringify(info).slice(0, 200) };
    if (info.ceiling !== 5 * 1024 * 1024) return { pass: false, detail: "ceiling wrong: " + info.ceiling };
    const q = info.modules.quotes;
    if (!q.present || q.revision !== 1 || q.records !== 1 || q.parts !== 1 || q.liveBytes <= 0 || q.maxFileBytes !== q.liveBytes) {
      return { pass: false, detail: "quotes row wrong: " + JSON.stringify(q).slice(0, 220) };
    }
    const li = info.modules.line_items;
    if (li.present || li.state !== "none" || li.liveBytes !== 0 || li.archive) return { pass: false, detail: "empty module row wrong: " + JSON.stringify(li).slice(0, 220) };
    if (info.totals.present !== 1 || info.totals.liveFiles !== 1 || info.totals.liveBytes <= 0 || info.totals.records !== 1) {
      return { pass: false, detail: "totals wrong: " + JSON.stringify(info.totals) };
    }
    const h = headOf(env, env.store, "quotes");
    if (!h || h.revision !== 1) return { pass: false, detail: "seed missing from files" };
    if (q.liveBytes !== new TextEncoder().encode(env.files.get(env.store.fileName("quotes")).text).length) {
      return { pass: false, detail: "reported bytes do not match the actual file" };
    }
    return { pass: true, detail: "seeded document measured (rev 1, 1 record, 1 file, bytes match the real file); empty module reported present:false" };
  });

  T.register("capacity: a multi-part live document is reported with every file and summed bytes", async () => {
    const env = mockEnv({ modules: ["quotes"], budget: 4000 });
    const pad = "x".repeat(1500);
    const recs = [];
    for (let i = 1; i <= 4; i++) recs.push({ id: i, title: "Big quote " + i, pad, createdAt: isoYearsAgo(1) });
    await seedDoc(env.store, "quotes", { records: recs });
    const info = await env.store.capacityInfo();
    const row = info.modules.quotes;
    if (!row.present || row.parts < 2) return { pass: false, detail: "expected parts > 1, got " + row.parts };
    if (row.files.length !== row.parts) return { pass: false, detail: "file list length " + row.files.length + " != parts " + row.parts };
    if (row.records !== 4) return { pass: false, detail: "records wrong: " + row.records };
    const sumFiles = row.files.reduce((s, f) => s + f.bytes, 0);
    if (sumFiles !== row.liveBytes) return { pass: false, detail: "liveBytes != sum of file bytes" };
    const maxIdx = row.files.reduce((bi, f, i, a) => (f.bytes > a[bi].bytes ? i : bi), 0);
    if (row.maxFileBytes !== row.files[maxIdx].bytes) return { pass: false, detail: "maxFileBytes wrong" };
    if (info.totals.liveFiles !== row.parts) return { pass: false, detail: "total file count wrong" };
    return { pass: true, detail: row.parts + " files measured (" + row.files.map(f => f.kind).join("+") + "); bytes and largest file agree" };
  });

  T.register("capacity: previewArchive matches only records older than the cutoff, and guards its inputs", async () => {
    const env = mockEnv({ modules: ["quotes"] });
    const recs = oldQuotes().concat(freshQuotes());
    await seedDoc(env.store, "quotes", { records: recs });
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const pv = await env.store.previewArchive("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (!pv.ok) return { pass: false, detail: JSON.stringify(pv) };
    if (pv.count !== 2) return { pass: false, detail: "expected 2 old matches, got " + pv.count };
    if (!eq(pv.records.map(r => r.id).sort(), [1, 2])) return { pass: false, detail: "wrong records matched: " + JSON.stringify(pv.records.map(r => r.id)) };
    if (pv.bytes <= 0 || pv.field !== "createdAt" || !pv.before) return { pass: false, detail: "preview shape wrong" };
    const none = await env.store.previewArchive("quotes", { field: "stage", before: cutoff.toISOString() });
    if (!none.ok || none.count !== 0) return { pass: false, detail: "a non-date field should match nothing" };
    const badField = await env.store.previewArchive("quotes", { before: cutoff.toISOString() });
    if (badField.ok || badField.code !== "field_required") return { pass: false, detail: "missing field not refused" };
    const badBefore = await env.store.previewArchive("quotes", { field: "createdAt", before: "not-a-date" });
    if (badBefore.ok || badBefore.code !== "bad_before") return { pass: false, detail: "bad cutoff not refused" };
    const badMod = await env.store.previewArchive("widgets", { field: "createdAt", before: cutoff.toISOString() });
    if (badMod.ok || badMod.code !== "bad_module") return { pass: false, detail: "unknown module not refused" };
    const nested = await env.store.previewArchive("quotes", { field: "meta.decided_at", before: new Date().toISOString() });
    if (!nested.ok || nested.count !== 0) return { pass: false, detail: "nested path on records without it should match nothing" };
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 1 || h.content.records.length !== 4) return { pass: false, detail: "preview changed live data" };
    return { pass: true, detail: "2 of 4 records match a 1-year cutoff; bad field/before/module refused; nested path and non-date field match nothing" };
  });

  T.register("capacity: archiveRecords writes a read-only batch, prunes the live doc and never duplicates a batch", async () => {
    const env = mockEnv({ modules: ["quotes"] });
    const recs = oldQuotes().concat(freshQuotes());
    await seedDoc(env.store, "quotes", { records: recs });
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const beforeISO = cutoff.toISOString();
    const ar = await env.store.archiveRecords("quotes", { field: "createdAt", before: beforeISO });
    if (!ar.ok || ar.archived !== 2) return { pass: false, detail: "archive failed: " + JSON.stringify(ar).slice(0, 260) };
    if (!ar.batch || ar.batch.no !== 1 || ar.batch.reused) return { pass: false, detail: "batch meta wrong: " + JSON.stringify(ar.batch) };
    if (!ar.live || ar.live.action !== "pruned" || ar.live.revision !== 2) return { pass: false, detail: "prune wrong: " + JSON.stringify(ar.live) };
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 2 || h.content.records.length !== 2) return { pass: false, detail: "live doc not pruned to rev 2" };
    if (!eq(h.content.records.map(r => r.id).sort(), [3, 4])) return { pass: false, detail: "wrong records kept live" };
    const la = await env.store.listArchive("quotes");
    if (!la.ok || la.batches.length !== 1) return { pass: false, detail: "index entry missing: " + JSON.stringify(la).slice(0, 200) };
    const b = la.batches[0];
    if (b.no !== 1 || b.count !== 2 || b.rule.field !== "createdAt" || b.status !== "archived" || b.restoredAt !== null || !b.readOnly) {
      return { pass: false, detail: "index entry wrong: " + JSON.stringify(b) };
    }
    if (!env.files.has(env.store.archiveBatchName("quotes", 1))) return { pass: false, detail: "batch file not written" };
    const again = await env.store.archiveRecords("quotes", { field: "createdAt", before: beforeISO });
    if (!again.ok || again.archived !== 0) return { pass: false, detail: "second archive should find nothing: " + JSON.stringify(again) };
    const la2 = await env.store.listArchive("quotes");
    if (la2.batches.length !== 1) return { pass: false, detail: "duplicate batch appeared" };
    return { pass: true, detail: "batch b1 + index written, live pruned to the 2 fresh records at rev 2; re-running archives nothing" };
  });

  T.register("capacity: a large batch splits across part files and reads back whole", async () => {
    const env = mockEnv({ modules: ["quotes"], budget: 4000 });
    const pad = "y".repeat(1500);
    const recs = [];
    for (let i = 1; i <= 6; i++) recs.push({ id: i, title: "Ancient " + i, pad, createdAt: isoYearsAgo(3) });
    await seedDoc(env.store, "quotes", { records: recs });
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const ar = await env.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (!ar.ok || ar.archived !== 6) return { pass: false, detail: "archive failed: " + JSON.stringify(ar).slice(0, 240) };
    if (ar.batch.parts < 2) return { pass: false, detail: "expected a multi-part batch, parts=" + ar.batch.parts };
    const h = headOf(env, env.store, "quotes");
    if (h.content.records.length !== 0) return { pass: false, detail: "live not fully pruned" };
    const rb = await env.store.readArchiveBatch("quotes", 1);
    if (!rb.ok) return { pass: false, detail: JSON.stringify(rb).slice(0, 200) };
    if (rb.records.length !== 6 || !rb.readOnly || rb.parts !== ar.batch.parts) return { pass: false, detail: "readback wrong" };
    if (!eq(rb.records.map(r => r.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6])) return { pass: false, detail: "records mismatched across parts" };
    if (rb.sha !== ar.batch.sha) return { pass: false, detail: "sha mismatch between read and write" };
    return { pass: true, detail: "6 large records archived across " + ar.batch.parts + " files and read back byte-consistent" };
  });

  T.register("capacity: a corrupt archive index blocks archiving and leaves live data untouched", async () => {
    const env = mockEnv({ modules: ["quotes"] });
    const recs = oldQuotes().concat(freshQuotes());
    await seedDoc(env.store, "quotes", { records: recs });
    const idxName = env.store.archiveIndexName("quotes");
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const ar0 = await env.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (!ar0.ok || ar0.batch.no !== 1) return { pass: false, detail: "initial archive failed" };
    const goodText = env.files.get(idxName).text;
    const later = new Date(Date.now() + 86400000).toISOString();
    const wouldMatch = await env.store.previewArchive("quotes", { field: "createdAt", before: later });
    if (!wouldMatch.ok || wouldMatch.count !== 2) return { pass: false, detail: "precondition failed: the remaining records should match the new cutoff" };
    env.files.set(idxName, { text: "{not json", key: "ek." + idxName, count: 1 });
    const ar = await env.store.archiveRecords("quotes", { field: "createdAt", before: later });
    if (ar.ok || ar.code !== "corrupt_archidx") return { pass: false, detail: "corrupt index not refused: " + JSON.stringify(ar).slice(0, 200) };
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 2 || h.content.records.length !== 2) return { pass: false, detail: "live data changed under a corrupt index" };
    const la = await env.store.listArchive("quotes");
    if (la.ok || la.code !== "corrupt_archidx") return { pass: false, detail: "listArchive should surface the corruption" };
    env.files.set(idxName, { text: goodText, key: "ek." + idxName, count: 1 });
    const la2 = await env.store.listArchive("quotes");
    if (!la2.ok || la2.batches.length !== 1) return { pass: false, detail: "index not readable again after repair" };
    return { pass: true, detail: "corrupt index refused the archive with live data untouched and listArchive surfacing the error; repair restored reading" };
  });

  T.register("capacity: a device without write keys archives safely but cannot prune, and retries reuse the batch", async () => {
    const env = mockEnv({ modules: ["quotes"] });
    const recs = oldQuotes();
    await seedDoc(env.store, "quotes", { records: recs });
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const dev = env.freshDevice();
    const ar = await dev.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (ar.ok || ar.code !== "no_edit_key") return { pass: false, detail: "expected a no_edit_key result: " + JSON.stringify(ar).slice(0, 260) };
    if (!ar.batch || ar.batch.no !== 1) return { pass: false, detail: "batch meta missing from the failure result" };
    const la = await dev.store.listArchive("quotes");
    if (!la.ok || la.batches.length !== 1) return { pass: false, detail: "archive index entry missing despite failed prune" };
    if (!env.files.has(env.store.archiveBatchName("quotes", 1))) return { pass: false, detail: "batch file missing despite failed prune" };
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 1 || h.content.records.length !== 2) return { pass: false, detail: "live data should be untouched by a keyless device" };
    const ar2 = await dev.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (ar2.ok || ar2.code !== "no_edit_key") return { pass: false, detail: "second attempt wrong: " + JSON.stringify(ar2).slice(0, 200) };
    const la2 = await dev.store.listArchive("quotes");
    if (la2.batches.length !== 1 || env.files.has(env.store.archiveBatchName("quotes", 2))) {
      return { pass: false, detail: "retry duplicated the batch instead of reusing b1" };
    }
    return { pass: true, detail: "records are safe in b1 and the index, live data untouched; the retry reused batch b1 rather than writing a second one" };
  });

  T.register("capacity: restoreArchiveBatch merges records back into live data and marks the batch restored", async () => {
    const env = mockEnv({ modules: ["quotes"] });
    const recs = oldQuotes().concat(freshQuotes());
    await seedDoc(env.store, "quotes", { records: recs });
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const ar = await env.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (!ar.ok) return { pass: false, detail: "archive failed" };
    const rr = await env.store.restoreArchiveBatch("quotes", 1);
    if (!rr.ok || rr.restored !== 2) return { pass: false, detail: "restore failed: " + JSON.stringify(rr).slice(0, 240) };
    const h = headOf(env, env.store, "quotes");
    if (h.revision !== 3 || h.content.records.length !== 4) return { pass: false, detail: "live not restored: rev " + h.revision + ", " + h.content.records.length + " records" };
    const la = await env.store.listArchive("quotes");
    const b = la.batches.find(x => x.no === 1);
    if (!b || b.restoredAt === null || b.status !== "restored") return { pass: false, detail: "batch not marked restored" };
    const again = await env.store.restoreArchiveBatch("quotes", 1);
    if (!again.ok || !again.noop) return { pass: false, detail: "second restore should noop: " + JSON.stringify(again).slice(0, 200) };
    const h2 = headOf(env, env.store, "quotes");
    if (h2.revision !== 3 || h2.content.records.length !== 4) return { pass: false, detail: "noop restore changed data" };
    const rearc = await env.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (!rearc.ok || rearc.archived !== 2) return { pass: false, detail: "re-archiving the restored old records should archive them again: " + JSON.stringify(rearc).slice(0, 220) };
    if (!rearc.batch || rearc.batch.no !== 2 || rearc.batch.reused) return { pass: false, detail: "a restored batch must not be silently reused; expected a fresh batch b2: " + JSON.stringify(rearc.batch) };
    const h3 = headOf(env, env.store, "quotes");
    if (h3.revision !== 4 || h3.content.records.length !== 2 || h3.content.records.some(r => r.id === 1 || r.id === 2)) {
      return { pass: false, detail: "live not pruned again after the second archive" };
    }
    const la2 = await env.store.listArchive("quotes");
    if (la2.batches.length !== 2) return { pass: false, detail: "expected b1 (restored) and b2 (archived)" };
    if (!la2.batches.some(b => b.no === 1 && b.restoredAt) || !la2.batches.some(b => b.no === 2 && !b.restoredAt)) {
      return { pass: false, detail: "batch states wrong: " + JSON.stringify(la2.batches) };
    }
    const rb2 = await env.store.readArchiveBatch("quotes", 2);
    if (!rb2.ok || rb2.records.length !== 2) return { pass: false, detail: "batch b2 unreadable" };
    const missing = await env.store.restoreArchiveBatch("quotes", 9);
    if (missing.ok || missing.code !== "batch_not_found") return { pass: false, detail: "unknown batch not refused" };
    return { pass: true, detail: "records merged back at rev 3 with no duplicates; batch marked restored; repeat restore is a no-op; archiving again after a restore writes a fresh batch b2" };
  });

  T.register("capacity: reading a batch fails cleanly when a batch file was removed", async () => {
    const env = mockEnv({ modules: ["quotes"] });
    await seedDoc(env.store, "quotes", { records: oldQuotes() });
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const ar = await env.store.archiveRecords("quotes", { field: "createdAt", before: cutoff.toISOString() });
    if (!ar.ok) return { pass: false, detail: "archive failed" };
    env.files.delete(env.store.archiveBatchName("quotes", 1));
    const rb = await env.store.readArchiveBatch("quotes", 1);
    if (rb.ok || rb.state !== "none") return { pass: false, detail: "missing batch file should read as absent, not crash: " + JSON.stringify(rb).slice(0, 180) };
    return { pass: true, detail: "a vanished batch file surfaces as absent rather than a crash" };
  });

  T.register("capacity: capacity zone renders and archives records through the UI flow", async () => {
    if (!window.QU_CAPACITY || !window.QU_CAPACITY.renderZone) return { pass: true, skip: true, detail: "capacity UI not loaded" };
    const env = mockEnv({ modules: ["quotes"] });
    const recs = [];
    const old = [{ id: 1, name: "Dusty Co" }, { id: 2, name: "Musty Ltd" }];
    const fresh = [{ id: 3, name: "Active Inc" }, { id: 4, name: "New Corp" }];
    for (const r of old) recs.push({ id: r.id, name: r.name, industry: "retail", createdAt: isoYearsAgo(2, -90000) });
    for (const r of fresh) recs.push({ id: r.id, name: r.name, industry: "retail", createdAt: isoYearsAgo(0, -15 * 86400000) });
    await seedDoc(env.store, "quotes", { records: recs });
    const holder = document.createElement("div");
    holder.style.position = "absolute";
    holder.style.left = "-10000px";
    document.body.appendChild(holder);
    try {
      const zone = await window.QU_CAPACITY.renderZone(env.store);
      holder.appendChild(zone);
      const modSel = zone.querySelector("[data-cap-module]");
      const fieldSel = zone.querySelector("[data-cap-field]");
      const previewBtn = zone.querySelector("[data-cap-preview]");
      const archiveBtn = zone.querySelector("[data-cap-archive]");
      const statusEl = zone.querySelector("[data-cap-status]");
      if (!modSel || !fieldSel || !previewBtn || !archiveBtn || !statusEl) return { pass: false, detail: "zone controls missing" };
      modSel.value = "quotes";
      const fieldReady = await until(() => {
        return Array.from(fieldSel.options).some(o => o.value === "createdAt") ? "createdAt" : null;
      }, 6000, 120);
      if (!fieldReady) return { pass: false, detail: "createdAt never appeared in the field picker" };
      previewBtn.click();
      const previewText = await until(() => {
        const m = zone.querySelector(".cap-preview .bkp-panel-title");
        return m && m.textContent ? m.textContent : null;
      }, 6000, 120);
      if (!previewText || previewText.indexOf("2 records match") === -1) return { pass: false, detail: "preview text wrong: " + previewText };
      if (archiveBtn.hidden) return { pass: false, detail: "archive button should be visible after a preview with matches" };
      archiveBtn.click();
      const statusText = await until(() => {
        const m = statusEl && statusEl.querySelector(".bkp-msg.ok");
        if (!m || !m.textContent || m.textContent.indexOf("Archiving") !== -1) return null;
        return m.textContent;
      }, 10000, 150);
      if (!statusText || statusText.indexOf("archived") === -1) return { pass: false, detail: "no success status: " + statusText };
      const h = headOf(env, env.store, "quotes");
      if (!h || h.revision !== 2 || h.content.records.length !== 2 || h.content.records.some(r => r.id === 1 || r.id === 2)) {
        return { pass: false, detail: "live doc not pruned through the UI: " + JSON.stringify(h && h.content && h.content.records.map(r => r.id)) };
      }
      const la = await env.store.listArchive("quotes");
      if (!la.ok || la.batches.length !== 1 || la.batches[0].count !== 2) return { pass: false, detail: "archive not listed after UI archive" };
      const batchCard = await until(() => {
        const cards = zone.querySelectorAll(".arc-batch");
        for (const c of cards) if (c.textContent.indexOf("2 records") !== -1) return c;
        return null;
      }, 5000, 150);
      if (!batchCard) return { pass: false, detail: "batch card not rendered in the archives column" };
      const rb = await env.store.readArchiveBatch("quotes", 1);
      if (!rb.ok || rb.records.length !== 2) return { pass: false, detail: "archived records unreadable after UI archive" };
      return { pass: true, detail: "zone rendered; field auto-detected; preview listed 2; archive pruned the live doc to rev 2; batch card + read-back verified" };
    } finally {
      holder.remove();
    }
  });

  T.register("capacity: real archive → restore round-trip on live server files (needs saved generator)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin || !r.uploadPlugin.editable || !r.kv) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "cav" + Date.now().toString(36) + QS.randHex(4);
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
        const recs = h.content && Array.isArray(h.content.records) ? h.content.records : [];
        return { revision: h.revision || 0, records: recs.length, content: h.content };
      } catch (e) { return null; }
    };
    const seed = oldQuotes().concat(freshQuotes());
    const r1 = await store.saveChecked(m, { records: seed }, { expectedBase: 0 });
    if (r1.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (r1.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live capacity check skipped" };
    if (!r1.ok) return { pass: false, detail: "live create failed: " + JSON.stringify(r1) };
    try {
      const c1Seen = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 1 && h.records === 4) return h;
        return null;
      }, 45000, 1500);
      if (!c1Seen) return { pass: false, detail: "rev 1 never readable on the server" };
      const cap = await store.capacityInfo();
      const row = cap.modules[m];
      if (!row || !row.present || row.records !== 4 || row.revision < 1) return { pass: false, detail: "capacityInfo wrong live: " + JSON.stringify(row).slice(0, 200) };

      const waitA = 13000 - (Date.now() - t0);
      if (waitA > 0) await sleep(waitA);
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);
      const pv = await store.previewArchive(m, { field: "createdAt", before: cutoff.toISOString() });
      if (!pv.ok || pv.count !== 2) return { pass: false, detail: "live preview wrong: " + JSON.stringify(pv).slice(0, 200) };
      const tA = Date.now();
      const ar = await store.archiveRecords(m, { field: "createdAt", before: cutoff.toISOString() });
      if (!ar.ok) return { pass: false, detail: "live archive failed: " + JSON.stringify(ar).slice(0, 300) };
      if (ar.archived !== 2 || !ar.live || ar.live.action !== "pruned") return { pass: false, detail: "archive result wrong: " + JSON.stringify(ar).slice(0, 300) };
      const pruned = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 2 && h.records === 2 && h.content.records.every(x => x.id !== 1 && x.id !== 2)) return h;
        return null;
      }, 45000, 1500);
      if (!pruned) return { pass: false, detail: "live doc never settled at 2 records after archive" };
      const la = await store.listArchive(m);
      if (!la.ok || la.batches.length !== 1 || la.batches[0].count !== 2 || !la.batches[0].readOnly) {
        return { pass: false, detail: "live archive index wrong: " + JSON.stringify(la).slice(0, 220) };
      }
      const rb = await store.readArchiveBatch(m, 1);
      if (!rb.ok || rb.records.length !== 2 || !rb.readOnly) return { pass: false, detail: "live batch read wrong: " + JSON.stringify(rb).slice(0, 220) };

      const waitB = 13000 - (Date.now() - tA);
      if (waitB > 0) await sleep(waitB);
      const rr = await store.restoreArchiveBatch(m, 1);
      if (!rr.ok || rr.restored !== 2) return { pass: false, detail: "live restore failed: " + JSON.stringify(rr).slice(0, 300) };
      const restored = await until(async () => {
        const h = await readCanonical();
        if (h && h.revision >= 3 && h.records === 4) return h;
        return null;
      }, 45000, 1500);
      if (!restored) return { pass: false, detail: "live doc never settled at 4 records after restore" };
      const la2 = await store.listArchive(m);
      const b2 = la2.batches.find(x => x.no === 1);
      if (!b2 || !b2.restoredAt || b2.status !== "restored") return { pass: false, detail: "batch not marked restored live: " + JSON.stringify(b2) };
      const rr2 = await store.restoreArchiveBatch(m, 1);
      if (!rr2.ok || !rr2.noop) return { pass: false, detail: "repeat live restore should noop" };
      return { pass: true, detail: "seeded 4 quotes, archived the 2 created 2y ago into b1, live pruned to rev 2, batch read back read-only, restored to rev 3 and marked restored (" + Math.round((Date.now() - t0) / 1000) + "s incl. write throttles)" };
    } finally {
      await cleanup();
    }
  });
})();
