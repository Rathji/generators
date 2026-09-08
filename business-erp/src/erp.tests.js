/* ============================================================
   BUSINESS ERP — Task 1 validation tests (module shell)
   Run via page_eval:  await window.ERPTest()
   Returns { passed, failed, results:[{name, ok, detail}] }.
   Tests cover: module registration, navigation rendering,
   router, role-aware visibility + route guard, consistent
   loading/empty/error states, and responsive drawer behaviour.
   ============================================================ */

(function () {
  "use strict";

  const results = [];
  function check(name, ok, detail) {
    results.push({ name, ok: !!ok, detail: detail || "" });
  }

  window.ERPTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    const id = () => new Date().valueOf() + "_" + Math.floor(Math.random() * 1e6);

    try {
      /* ── 0. Initial boot state (no navigation yet) ── */
      ERP.role = "owner";
      await new Promise((r) => setTimeout(r, 300));
      check("boot: nav rendered without any test navigation", $$(".erp-nav-link").length === 8, "got " + $$(".erp-nav-link").length);
      check("boot: initial route is a real module", $(".erp-content").getAttribute("data-module") !== "");

      /* ── 1. Module registration ── */
      const required = ["dashboard", "crm", "sales", "purchasing", "inventory", "projects", "finance", "reports"];
      check("all 8 modules registered", required.every((x) => ERP.getModule(x)), "missing: " + required.filter((x) => !ERP.getModule(x)).join(","));
      check("modules carry label/icon/group/roles", required.every((x) => {
        const m = ERP.getModule(x);
        return m && m.label && m.icon && (m.group === null || typeof m.group === "string") && Array.isArray(m.roles);
      }));
      check("nav shows 8 module links", $$(".erp-nav-link").length === 8, "got " + $$(".erp-nav-link").length);
      check("nav grouped (Operations / Finance)", $$(".erp-nav-group").length >= 3 && $$(".erp-nav-group-label").length === 2);

      /* ── 2. Router renders each module ── */
      for (const mod of required) {
        await ERP.navigate(mod);
        const el = $(".erp-content");
        check("navigate → " + mod, el && el.getAttribute("data-module") === mod && $("#pageTitle").textContent === ERP.getModule(mod).label);
        check(mod + " finished in content state", el && !el.querySelector(".erp-state[data-state=error]") && (el.querySelector(".erp-state[data-state=empty]") || el.querySelector(".erp-page-head, .erp-summary, .erp-grid, .erp-tabs, .card")));
      }

      /* ── 3. Role-aware visibility ── */
      ERP.role = "staff";
      check("staff sees operational modules", ["crm", "sales", "purchasing", "inventory", "projects"].every((m) => ERP.canAccess(m)));
      check("staff hidden from finance/reports", !ERP.canAccess("finance") && !ERP.canAccess("reports"));
      check("staff nav hides finance/reports", $$(".erp-nav-link[data-module-link='finance']").length === 0 && $$(".erp-nav-link[data-module-link='reports']").length === 0);
      check("staff nav keeps 6 links", $$(".erp-nav-link").length === 6, "got " + $$(".erp-nav-link").length);

      await ERP.navigate("finance");
      check("role-guard redirects staff away from finance", $(".erp-content").getAttribute("data-module") !== "finance");

      ERP.role = "manager";
      check("manager can access finance/reports", ERP.canAccess("finance") && ERP.canAccess("reports"));
      await ERP.navigate("finance");
      check("manager renders finance", $(".erp-content").getAttribute("data-module") === "finance");

      ERP.role = "owner";
      check("owner sees all 8", required.every((m) => ERP.canAccess(m)));
      ERP.role = "owner";

      /* ── 4. Consistent states ── */
      const probe = document.createElement("main");
      probe.className = "erp-content";
      document.body.appendChild(probe);

      ERP.states.loading(probe, "Testing");
      check("loading state markup", probe.querySelector("[data-state='loading']") && probe.querySelector(".spinner"));

      ERP.states.empty(probe, { icon: "crm", title: "Empty here", message: "Nothing yet", phase: "Phase 9" });
      check("empty state markup", probe.querySelector("[data-state='empty']") && probe.querySelector(".erp-phase-note"));

      ERP.states.error(probe, { title: "Boom", message: "It failed", retry: { label: "Retry", onClick: () => {} } });
      check("error state markup", probe.querySelector("[data-state='error']") && probe.querySelector("[data-error-retry]"));
      probe.remove();

      await ERP.navigate("does-not-exist");
      check("unknown route → error state", $(".erp-content").querySelector("[data-state='error']") && $(".erp-content").querySelector("[data-error-retry]"));
      await ERP.navigate("dashboard");

      /* ── 5. Responsive drawer ── */
      const sb = $("#sidebar");
      const hb = $("#hamburgerBtn");
      const isDesktop = window.innerWidth >= 1024;
      check("hamburger present", !!hb);
      if (isDesktop) {
        check("desktop: sidebar visible", sb.getBoundingClientRect().width > 200);
        check("desktop: hamburger hidden", getComputedStyle(hb).display === "none");
      } else {
        check("mobile: hamburger visible", getComputedStyle(hb).display !== "none");
        hb.click();
        await new Promise((r) => setTimeout(r, 300));
        check("mobile: drawer opens", sb.classList.contains("open") && !$("#overlay").hidden);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await new Promise((r) => setTimeout(r, 300));
        check("mobile: Escape closes drawer", !sb.classList.contains("open"));
      }

      /* ── 6. Module framework API ── */
      const testId = "test_" + id();
      const sentinel = "sentinel-" + id();
      ERP.registerModule({
        id: testId,
        label: "Test Module",
        group: "ops",
        icon: "crm",
        roles: [],
        render(ctx) { ctx.el.innerHTML = '<div class="' + sentinel + '"></div>'; },
      });
      await ERP.navigate(testId);
      check("registerModule + render hook", $(".erp-content").querySelector("." + sentinel));
      await ERP.navigate("dashboard");
      const before = ERP.modules.length;
      let threw = false;
      try { ERP.registerModule({ id: testId, label: "Dup" }); } catch (e) { threw = true; }
      check("duplicate module id rejected", threw);
      ERP.modules.splice(ERP.modules.indexOf(ERP.getModule(testId)), 1);
      check("unregister via registry splice", ERP.modules.length === before - 1);
      await ERP.navigate("dashboard");
    } catch (e) {
      check("test harness did not crash", false, (e && e.stack) || String(e));
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 2 validation tests — canonical document store
     Run via page_eval:  await window.ERPStoreTest()
     Covers: doc naming & declaration per module, fiscal-year
     splitting, versioned envelopes, fast local cache, cached
     edit keys, cross-device survival via the canonical editable
     copy, idempotent identical writes, and the write ceiling.
     Uses dedicated test documents (erp-v1-test-*) plus temporary
     test modules so the real module documents stay untouched.
     ============================================================ */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  window.ERPStoreTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const mark = (s) => { if (opts.debug) console.log("[ERPStoreTest]", s); };
    const tick = (s) => { try { localStorage.setItem("erp.test.progress", s + " @" + Date.now()); } catch (e) {} };
    let quotaDown = false;
    const cap = (res) => { if (res && res.error === "over_daily_allowance") { quotaDown = true; return null; } return res; };
    const qcheck = (name, ok, detail) => {
      if (quotaDown) results.push({ name, ok: true, skipped: true, detail: "SKIPPED — editable layer over_daily_allowance (rate/quota limit)" });
      else check(name, ok, detail);
    };

    try {
      /* ── 1. API + per-module document declarations ── */
      mark("1 declarations");
      tick("1");
      check("store: ERP.store exposed", !!store && typeof store.saveDoc === "function" && typeof store.loadDoc === "function");
      check("store: canonical editable layer available", store.canonicalAvailable() === true);

      const withDocs = ["crm", "sales", "purchasing", "inventory", "projects", "finance", "reports"];
      check("store: every data module declares a document", withDocs.every((m) => {
        const d = store.docConfig(m);
        return d && d.name === m && typeof d.splitByYear === "boolean";
      }));
      check("store: dashboard declares no document", !ERP.getModule("dashboard").doc);
      check("store: split-by-year flagged on inventory & finance",
        store.docConfig("inventory").splitByYear === true && store.docConfig("finance").splitByYear === true &&
        ["crm", "sales", "purchasing", "projects", "reports"].every((m) => store.docConfig(m).splitByYear === false));
      check("store: namespaced + versioned doc names",
        store.docName("crm") === "erp-v1-crm" && store.docName("inventory", 2025) === "erp-v1-inventory-2025");
      check("store: index name reserved", store.indexName.indexOf("erp-v1-") === 0 && store.indexName.indexOf("index") !== -1);

      /* ── 2. Write → read roundtrip + cross-device survival ── */
      mark("2 roundtrip");
      tick("2");
      const rName = "erp-v1-test-r" + uid;
      const recsA = [{ id: 1, name: "Acme", since: "2025-01-10" }, { id: 2, name: "Globex", since: "2025-03-22" }];
      store.resetLocal();
      const w1 = cap(await store.set(rName, recsA));
      qcheck("store: first write commits (no error)", !!w1 && !w1.error && w1.noop !== true, JSON.stringify(w1));
      qcheck("store: first write is revision 1", !!w1 && w1.rev === 1, "rev=" + (w1 && w1.rev));

      const r1 = await store.get(rName);
      check("store: read returns written records", r1.doc && r1.doc.schema === "erp-doc" && JSON.stringify(r1.doc.records) === JSON.stringify(recsA));

      const keyPresent = (() => {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf("erp.store.v1.keys.") === 0 && k.indexOf(rName) !== -1) return true;
          }
          return false;
        } catch (e) { return false; }
      })();
      qcheck("store: edit key cached locally on create", keyPresent);

      store.resetLocal(); // simulate a fresh device (no cache, no key)
      mark("2b fresh-device read");
      const r2 = await store.get(rName);
      qcheck("store: records survive to a fresh device via canonical", !!r2.doc && JSON.stringify(r2.doc.records) === JSON.stringify(recsA), "source=" + r2.source);
      qcheck("store: fresh device sees the committed revision", !!r2.doc && r2.doc.rev === 1, "rev=" + (r2.doc && r2.doc.rev));

      /* ── 3. Rewrite with cached edit key ── */
      mark("3 rewrite");
      tick("3");
      const w2Name = "erp-v1-test-rw" + uid;
      store.resetLocal();
      await store.set(w2Name, [{ id: 1 }]);
      const w2 = cap(await store.set(w2Name, [{ id: 1 }, { id: 2 }])); // same doc, new content → rewrite using cached key
      qcheck("store: existing document rewritten via cached edit key", !!w2 && !w2.error && w2.noop !== true, JSON.stringify(w2));
      qcheck("store: revision increments on rewrite", !!w2 && w2.rev === 2, "rev=" + (w2 && w2.rev));

      /* ── 4. Idempotent identical write ── */
      mark("4 idempotent");
      tick("4");
      const nName = "erp-v1-test-n" + uid;
      store.resetLocal();
      const n1 = cap(await store.set(nName, [{ id: 7 }]));
      const n2 = cap(await store.set(nName, [{ id: 7 }]));
      qcheck("store: identical re-save is a no-op", !!n1 && !!n2 && n1.error == null && n2.error == null && n2.noop === true, "n2=" + JSON.stringify(n2));

      /* ── 5. Write ceiling enforced ── */
      mark("5 ceiling");
      tick("5");
      const origCeiling = store.maxDocBytes;
      store.maxDocBytes = 2048;
      const bigRecs = Array.from({ length: 400 }, (_, i) => ({ id: i, txt: "x".repeat(80) }));
      const wBig = await store.set("erp-v1-test-big" + uid, bigRecs);
      check("store: oversized write refused with document_too_large", wBig.error === "document_too_large", JSON.stringify(wBig));
      store.maxDocBytes = origCeiling;

      /* ── 6. Fast local cache (no network on a cache hit) ── */
      mark("6 cache");
      tick("6");
      const cName = "erp-v1-test-c" + uid;
      await store.set(cName, [{ id: 1, v: "cached" }]);
      await sleep(300); // let any background refresh settle
      store.useBackend({
        get: async () => { throw new Error("offline"); },
        set: async () => ({ error: "offline" }),
      });
      const c1 = await store.get(cName);
      check("store: cache hit serves records while canonical is offline", c1.source === "cache" && JSON.stringify(c1.doc.records) === JSON.stringify([{ id: 1, v: "cached" }]), "source=" + c1.source);
      check("store: offline path never surfaces an error", !c1.error);
      store.useBackend(null);

      /* ── 7. Fiscal-year splitting (split-by-year module) ── */
      mark("7 split");
      tick("7");
      const modId = "testmov_" + uid;
      ERP.registerModule({
        id: modId, label: "Test Movements", group: "ops", icon: "inventory", roles: [],
        doc: { name: "testmov" + uid, splitByYear: true },
      });
      const allRecs = [
        { id: 1, date: "2025-03-10" },
        { id: 2, date: "2025-11-02" },
        { id: 3, date: "2026-02-14" },
      ];
      check("store: fiscalYearOf derives the year", store.fiscalYearOf({ date: "2025-03-10" }) === 2025 && store.fiscalYearOf({ date: "2025-11-02" }) === 2025);
      const sp = cap(await store.saveDoc(modId, allRecs));
      qcheck("store: split save writes one doc per fiscal year", !!sp && !sp.error && sp.years && sp.years.length === 2 && sp.years.indexOf(2025) !== -1 && sp.years.indexOf(2026) !== -1, JSON.stringify(sp && sp.years));
      const y25 = await store.loadDoc(modId, { year: 2025 });
      const y26 = await store.loadDoc(modId, { year: 2026 });
      check("store: year-scoped load returns that year's records", y25.records.length === 2 && y26.records.length === 1);
      const allBack = await store.loadDoc(modId, { all: true });
      qcheck("store: load({all:true}) merges every year", !quotaDown && allBack.records.length === 3);
      ERP.modules.splice(ERP.modules.indexOf(ERP.getModule(modId)), 1);

      /* ── 8. Non-split module keeps a single document ── */
      mark("8 nonsplit");
      tick("8");
      const modId2 = "testns_" + uid;
      ERP.registerModule({
        id: modId2, label: "Test NoSplit", group: "ops", icon: "sales", roles: [],
        doc: { name: "testns" + uid, splitByYear: false },
      });
      const ns = cap(await store.saveDoc(modId2, [{ id: 1, date: "2025-05-01" }, { id: 2, date: "2026-05-01" }]));
      const nsBack = await store.loadDoc(modId2);
      qcheck("store: non-split module holds all records in one doc", !!ns && !ns.error && nsBack.records.length === 2 && nsBack.doc.year === null, JSON.stringify(ns));
      ERP.modules.splice(ERP.modules.indexOf(ERP.getModule(modId2)), 1);

      /* ── 9. Index reflects written documents (local index is updated
             synchronously; the canonical index propagates with the
             editable layer's ~10s delay, so assert on the local copy) ── */
      mark("9 index");
      tick("9");
      const idx = await store.getIndex();
      const entries = Object.keys(idx.index.documents || {}).map((n) => idx.index.documents[n]);
      const movEntries = entries.filter((e) => e.name === "testmov" + uid);
      const nsEntry = entries.find((e) => e.name === "testns" + uid);
      qcheck("store: index tracks one entry per split-year doc", movEntries.length === 2 && movEntries.map((e) => e.year).sort().join(",") === "2025,2026" && movEntries.every((e) => typeof e.bytes === "number" && e.bytes > 0), JSON.stringify(movEntries));
      qcheck("store: split-year index entries sum to the record total", movEntries.reduce((s, e) => s + (e.recordCount || 0), 0) === 3, "counts=" + movEntries.map((e) => e.recordCount).join(","));
      qcheck("store: index has an entry for a plain doc", !!nsEntry && nsEntry.recordCount === 2);
      const st = await store.status();
      check("store: status reports canonical availability + capacity", st.canonical === true && Array.isArray(st.docs) && st.maxDocBytes === origCeiling);

      /* ── 10. Lazy empty doc for a real module (no data yet) ── */
      mark("10 empty");
      tick("10");
      const e = await store.loadDoc("crm");
      check("store: empty module loads without error", Array.isArray(e.records) && e.records.length === 0 && !e.error);
    } catch (e) {
      check("store: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      tick("done");
      try { ERP.store.useBackend(null); } catch (e) {}
      try { ERP.store.resetLocal(); } catch (e) {}
      await sleep(250);
    }

    const passed = results.filter((r) => r.ok && !r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;
    const skipped = results.filter((r) => r.skipped).length;
    return { passed, failed, skipped, results };
  };

  /* ============================================================
     Task 4+5 validation tests — backup/restore + capacity/archival
     Run via page_eval:  await window.ERPBackupTest()
     Uses an in-memory fake backend so the editable layer's ~10s
     read lag can't interfere. Covers: bundle assembly, validation
     (malformed docs skipped), restore roundtrip, published backup
     (idempotent no-op), capacity accounting, archival of a closed
     period to the read-only archive, and restoring it back.
     ============================================================ */

  window.ERPBackupTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const backup = ERP.backup;
    const master = ERP.master;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const mark = (s) => { if (opts.debug) console.log("[ERPBackupTest]", s); };

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }
    const env = (records, rev, name) => JSON.stringify({
      schema: "erp-doc", schemaVersion: 1, doc: name || "", year: null, rev: rev || 1,
      updatedAt: new Date().toISOString(), updatedBy: "owner", records,
    });

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();

      /* ── 1. Bundle assembly includes written docs ── */
      mark("1 bundle");
      const nA = store.docName("crm"), nB = store.docName("purchasing");
      await store.set(nA, [{ id: 1, name: "Acme" }]);
      await store.set(nB, [{ id: 1, name: "Globex" }, { id: 2, name: "Initech" }]);
      master.flush();
      const bundle = await backup.backupBundle();
      check("backup: bundle has the erp-backup schema", bundle.schema === "erp-backup" && bundle.version === 1 && !!bundle.exportedAt);
      check("backup: bundle contains written documents", bundle.docs[nA] && bundle.docs[nB] && bundle.docs[nA].records[0].name === "Acme", JSON.stringify(Object.keys(bundle.docs || {})));
      check("backup: bundle never contains the backup doc itself", !bundle.docs["erp-v1-backup"]);

      /* ── 2. Validation ── */
      mark("2 validate");
      const bad = backup.validateBundle({ schema: "nope" });
      check("backup: rejects a non-backup bundle", bad.valid === false && bad.errors.length >= 1);
      const mixed = {
        schema: "erp-backup", version: 1, exportedAt: new Date().toISOString(),
        docs: { good: JSON.parse(env([{ id: 1 }], 1)), bad: { schema: "erp-doc", records: "nope" }, notdoc: { x: 1 } },
      };
      const mv = backup.validateBundle(mixed);
      check("backup: validates good docs, flags malformed ones", !!mv.docs.good && !mv.docs.bad && !mv.docs.notdoc && mv.errors.length === 2, JSON.stringify(mv.errors));

      /* ── 3. Restore roundtrip ── */
      mark("3 restore");
      const restored = await backup.restoreBundle(bundle, { allowPartial: true });
      check("backup: restore writes every doc", restored.written.length === 2 && !restored.errors.length, JSON.stringify({ w: restored.written.length, e: restored.errors }));
      const chk = await store.readCanonical(nB);
      check("backup: restored content is byte-faithful", chk.doc && chk.doc.records.length === 2 && chk.doc.records[1].name === "Initech");

      /* ── 4. Publish + idempotent re-publish ── */
      mark("4 publish");
      const pub1 = await backup.publishBackup();
      check("backup: published backup written to the namespace", !pub1.error && !!srv.files["erp-v1-backup"]);
      const pub2 = await backup.publishBackup();
      check("backup: identical re-publish is a safe no-op", pub2.noop === true, JSON.stringify(pub2));
      const published = await backup.publishedBackup();
      check("backup: publishedBackup reads back the bundle", published && published.schema === "erp-backup" && !!published.docs[nA]);

      /* ── 5. Capacity accounting ── */
      mark("5 capacity");
      await sleep(750); // let the canonical index write (600ms debounce) land for status()
      const cap = await backup.capacity();
      check("backup: capacity lists docs with sizes vs ceiling", cap.rows.length >= 2 && cap.total > 0 && cap.ceiling === store.maxDocBytes, JSON.stringify({ rows: cap.rows.length, total: cap.total }));
      const rowA = cap.rows.find((r) => r.module === "crm");
      check("backup: capacity rows carry recordCount + bytes", !!rowA && rowA.recordCount === 1 && rowA.bytes > 0, JSON.stringify(rowA));

      /* ── 6. Archive a closed period ── */
      mark("6 archive");
      const invId = "testinv_" + uid;
      ERP.registerModule({ id: invId, label: "Test Inv", group: null, icon: "inventory", roles: [], hidden: true, doc: { name: "testinv" + uid, splitByYear: true } });
      const movs = [
        { id: 1, date: (store.currentFiscalYear() - 2) + "-03-10", type: "receipt", productId: 1, qty: 10 },
        { id: 2, date: (store.currentFiscalYear() - 2) + "-04-02", type: "issue", productId: 1, qty: -3 },
      ];
      const ar = await store.saveDoc(invId, movs);
      check("backup: archived setup writes the closed-year doc", !ar.error && ar.years && ar.years.length === 1 && ar.years[0] === store.currentFiscalYear() - 2, JSON.stringify(ar && ar.years));
      const archRes = await backup.archiveDoc(invId, store.currentFiscalYear() - 2);
      check("backup: archive moves records to the archive", archRes.ok === true && archRes.archived === 2, JSON.stringify(archRes));
      const archList = await backup.archivedDocs();
      check("backup: archive lists the archived period", archList.length === 1 && archList[0].originModule === invId && archList[0].recordCount === 2, JSON.stringify(archList && archList[0] && { m: archList[0].originModule, n: archList[0].recordCount }));
      const liveAfter = await store.readCanonical(store.docName(invId, store.currentFiscalYear() - 2));
      check("backup: live document emptied after archival", liveAfter.doc && liveAfter.doc.records.length === 0, "records=" + (liveAfter.doc && liveAfter.doc.records.length));
      const vw = await backup.viewArchived(archList[0].id);
      check("backup: archived records stay viewable (read-only)", vw && vw.records.length === 2);
      const back = await backup.restoreArchive(archList[0].id);
      check("backup: archive can be restored to the live document", back.ok === true && back.restored === 2, JSON.stringify(back));
      const liveBack = await store.readCanonical(store.docName(invId, store.currentFiscalYear() - 2));
      check("backup: records are back in the live document", liveBack.doc && liveBack.doc.records.length === 2, "records=" + (liveBack.doc && liveBack.doc.records.length));
      check("backup: archive entry removed after restore", (await backup.archivedDocs()).length === 0);
      const ix = ERP.modules.indexOf(ERP.getModule(invId));
      if (ix !== -1) ERP.modules.splice(ix, 1);
    } catch (e) {
      check("backup: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 6+7+8+9 validation tests — master data & configuration
     Run via page_eval:  await window.ERPMasterTest()
     Covers: party directory + merge-updates-everywhere, catalog,
     chart of accounts, tax rates, posting defaults, fiscal profile
     + document numbering that never reuses a number, and the
     idempotent seed.
     ============================================================ */

  window.ERPMasterTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const mark = (s) => { if (opts.debug) console.log("[ERPMasterTest]", s); };

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();

      /* ── 1. Seed is idempotent + complete ── */
      mark("1 seed");
      const settings = await master.settings();
      check("master: profile seeded with fiscal defaults", settings.profile && settings.profile.currency === "USD" && settings.profile.fiscalYearStartMonth === 1);
      check("master: numbering prefixes seeded per type", settings.numbering && settings.numbering.prefixes.invoice === "INV" && settings.numbering.prefixes.quote === "QT");
      const chart = await master.chart();
      check("master: chart of accounts seeded with classes", chart.length >= 10 && chart.some((a) => a.type === "asset") && chart.some((a) => a.type === "income"));
      const taxes = await master.taxes();
      check("master: tax rates seeded", taxes.some((t) => t.code === "VAT20" && t.rate === 20));
      const defs = await master.defaultsMap();
      check("master: posting defaults map to account codes", defs.ar === "1100" && defs.cogs === "5000" && defs.taxCollected === "2100");
      await master.seed();
      const settings2 = await master.settings();
      check("master: re-seed is a no-op (idempotent)", settings2.profile.currency === "USD");

      /* ── 2. Party directory CRUD + type fields ── */
      mark("2 parties");
      const parties = await master.parties();
      const pA = { id: master.nextId(parties), name: "Acme Corp", type: "both", taxId: "TAX-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [{ name: "Bob", email: "bob@acme.com", primary: true }], addresses: [{ label: "HQ", city: "Springfield" }] };
      const pB = { id: master.nextId(parties.concat([pA])), name: "Globex", type: "supplier", taxId: "TAX-2", paymentTerms: "net60", creditLimit: 0, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pA, pB]));
      const p = await master.party(pA.id);
      check("master: party created with full profile", p && p.name === "Acme Corp" && p.type === "both" && p.creditLimit === 5000 && Array.isArray(p.contacts) && p.contacts[0].email === "bob@acme.com");

      /* ── 3. Rename/merge updates the whole system ── */
      mark("3 merge");
      await store.set("erp-v1-crm", [{ id: 1, partyId: pA.id, status: "open" }, { id: 2, partyId: pB.id, status: "open" }]);
      await store.set("erp-v1-purchasing", [{ id: 1, supplierId: pA.id }]);
      await master.mergeParties(pA.id, pB.id);
      const refs = await store.readCanonical("erp-v1-crm");
      check("master: merge rewrites partyId references", refs.doc.records[0].partyId === pB.id && refs.doc.records[1].partyId === pB.id, JSON.stringify(refs.doc.records));
      const refs2 = await store.readCanonical("erp-v1-purchasing");
      check("master: merge rewrites supplierId references", refs2.doc.records[0].supplierId === pB.id, JSON.stringify(refs2.doc.records));
      const after = await master.parties();
      check("master: merged party removed from directory", after.length === 1 && after[0].id === pB.id);

      /* ── 4. Catalog ── */
      mark("4 catalog");
      const catalog = await master.catalog();
      const cA = { id: master.nextId(catalog), sku: "WID-001", name: "Widget", type: "product", uom: "ea", salePrice: 12.5, cost: 4.2, taxCode: "VAT20", active: true };
      await master.saveCatalog(catalog.concat([cA]));
      const it = await master.catalogItem(cA.id);
      check("master: catalog item stored with prices/tax", it && it.name === "Widget" && it.salePrice === 12.5 && it.taxCode === "VAT20");

      /* ── 5. Numbering never reuses a number ── */
      mark("5 numbering");
      const n1 = await master.allocateNumber("quote");
      const n2 = await master.allocateNumber("quote");
      const n3 = await master.allocateNumber("invoice");
      check("master: allocated numbers are sequential + prefixed", n1 === "QT-0001" && n2 === "QT-0002" && n3 === "INV-0001", JSON.stringify([n1, n2, n3]));
      check("master: numbers are never reused", n1 !== n2);
      const sAfter = await master.settings();
      check("master: counters persisted in settings", sAfter.numbering.counters.quote === 2 && sAfter.numbering.counters.invoice === 1);

      /* ── 6. Chart / taxes / defaults editable ── */
      mark("6 chart");
      const chart2 = await master.chart();
      chart2.push({ id: master.nextId(chart2), code: "5200", name: "Rent", type: "expense", active: true, parent: null });
      await master.saveChart(chart2);
      const rent = await master.account("5200");
      check("master: new account persisted + findable by code", !!rent && rent.name === "Rent");
      const tax = await master.tax("VAT10");
      check("master: tax lookup by code", tax && tax.rate === 10);

      /* ── 7. Audit log records actions (Task 36 prereq) ── */
      mark("7 audit");
      await master.audit({ action: "test", targetType: "party", targetId: pB.id, summary: "Test audit entry" });
      const log = await master.auditLog();
      check("master: audit log records an entry with actor/timestamp", log.length >= 1 && log[log.length - 1].summary === "Test audit entry" && !!log[log.length - 1].ts && log[log.length - 1].actor === "owner");
    } catch (e) {
      check("master: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  window.ERPSyncTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const mark = (s) => { if (opts.debug) console.log("[ERPSyncTest]", s); };

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          const created = prev === undefined;
          const unchanged = prev === json;
          files[name] = json;
          return { created, unchanged, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }
    const env = (records, rev) => JSON.stringify({
      schema: "erp-doc", schemaVersion: 1, doc: "", year: null, rev: rev || 1,
      updatedAt: new Date().toISOString(), updatedBy: "owner", records,
    });
    const setServer = (srv, name, records, rev) => { srv.files[name] = env(records, rev); };
    const recsOf = (srv, name) => JSON.parse(srv.files[name]).records;

    try {
      store.resetAllLocal();

      /* ── 1. Clean fast-forward: canonical ahead, local untouched ── */
      mark("1 fast-forward");
      const s1 = makeServer();
      store.useBackend(s1);
      const n1 = "erp-v1-test-sy1" + uid;
      await store.set(n1, [{ id: 1 }]);
      setServer(s1, n1, [{ id: 1 }, { id: 2 }], 2); // "another device" wrote rev 2
      const r1 = await store.sync();
      check("sync: clean doc fast-forwards to the newer canonical", store.cachedDoc(n1) && store.cachedDoc(n1).rev === 2 && store.cachedDoc(n1).records.length === 2);
      check("sync: fast-forward reported", r1.synced === 1 && r1.conflicted === 0, JSON.stringify({ s: r1.synced, c: r1.conflicted }));

      /* ── 2. Local ahead (offline edit) pushed on reconnect ── */
      mark("2 push-on-reconnect");
      const s2 = makeServer();
      store.useBackend(s2);
      const n2 = "erp-v1-test-sy2" + uid;
      await store.set(n2, [{ id: 1 }]);
      store.useBackend({ get: async (n) => (s2.files[n] == null ? null : s2.files[n]), set: async () => ({ error: "offline" }) });
      const w2 = await store.set(n2, [{ id: 1 }, { id: 2 }]); // fails → dirty, local rev 2
      check("sync: offline edit kept locally while canonical write fails", w2.local === true && store.cachedDoc(n2).records.length === 2);
      store.useBackend(s2);
      const r2 = await store.sync();
      check("sync: offline edit pushed to canonical on reconnect", r2.pushed === 1 && recsOf(s2, n2).length === 2 && store.conflicts().length === 0, JSON.stringify({ p: r2.pushed, recs: recsOf(s2, n2).length }));

      /* ── 3. Conflict on write: never silently overwrite ── */
      mark("3 conflict-on-write");
      const s3 = makeServer();
      store.useBackend(s3);
      const n3 = "erp-v1-test-sy3" + uid;
      await store.set(n3, [{ id: 1, v: "a" }]);
      setServer(s3, n3, [{ id: 1, v: "b" }], 2); // another device changed it
      const w3 = await store.set(n3, [{ id: 1, v: "c" }]);
      check("sync: write on a stale base is refused with conflict", w3.error === "conflict", JSON.stringify(w3));
      check("sync: my edit is preserved in the local cache", store.cachedDoc(n3).records[0].v === "c");
      check("sync: canonical is untouched", recsOf(s3, n3)[0].v === "b");
      check("sync: a pending conflict was recorded", store.conflicts().some((c) => c.name === n3));

      /* ── 4. Conflict persists across sync (no silent discard) ── */
      mark("4 conflict-persistence");
      const r4 = await store.sync();
      check("sync: re-sync keeps both sides (mine in cache, theirs in canonical)", store.cachedDoc(n3).records[0].v === "c" && recsOf(s3, n3)[0].v === "b" && store.conflicts().length === 1 && r4.conflicted === 1);

      /* ── 5. Keep mine ── */
      mark("5 keep-mine");
      const k1 = await store.resolveConflict(n3, "keep_mine");
      check("sync: keep-mine commits my version to canonical", !k1.error && recsOf(s3, n3)[0].v === "c", JSON.stringify(k1));
      check("sync: keep-mine clears the conflict", store.conflicts().length === 0 && store.cachedDoc(n3).records[0].v === "c");

      /* ── 6. Keep theirs ── */
      mark("6 keep-theirs");
      const s4 = makeServer();
      store.useBackend(s4);
      const n4 = "erp-v1-test-sy4" + uid;
      await store.set(n4, [{ id: 1, v: "a" }]);
      setServer(s4, n4, [{ id: 1, v: "b" }], 2);
      await store.set(n4, [{ id: 1, v: "c" }]);
      const k2 = await store.resolveConflict(n4, "keep_theirs");
      check("sync: keep-theirs adopts the other device's version", !k2.error && store.cachedDoc(n4).records[0].v === "b" && recsOf(s4, n4)[0].v === "b" && store.conflicts().length === 0);

      /* ── 7. Auto-merge when each side touched different fields ── */
      mark("7 merge-unambiguous");
      const s5 = makeServer();
      store.useBackend(s5);
      const n5 = "erp-v1-test-sy5" + uid;
      await store.set(n5, [{ id: 1, a: 1, b: 1, c: 1 }]);
      setServer(s5, n5, [{ id: 1, a: 5, b: 1, c: 1 }], 2); // theirs changed a
      await store.set(n5, [{ id: 1, a: 1, b: 9, c: 1 }]);  // mine changed b
      const m1 = await store.resolveConflict(n5, "merge");
      const mRec = recsOf(s5, n5)[0];
      check("sync: unambiguous merge auto-commits both sides' field changes", !m1.error && mRec.a === 5 && mRec.b === 9 && mRec.c === 1 && store.conflicts().length === 0, JSON.stringify(mRec));

      /* ── 8. Real field conflict → needs_decisions → per-field pick ── */
      mark("8 merge-field-conflict");
      const s6 = makeServer();
      store.useBackend(s6);
      const n6 = "erp-v1-test-sy6" + uid;
      await store.set(n6, [{ id: 1, a: 1 }]);
      setServer(s6, n6, [{ id: 1, a: 2 }], 2); // theirs changed a
      await store.set(n6, [{ id: 1, a: 3 }]);  // mine changed a too
      const m2 = await store.resolveConflict(n6, "merge");
      check("sync: conflicting field returns needs_decisions", m2.status === "needs_decisions" && m2.fieldConflicts.length === 1 && m2.fieldConflicts[0].field === "a", JSON.stringify(m2 && m2.fieldConflicts));
      check("sync: nothing committed while a field conflict is open", recsOf(s6, n6)[0].a === 2 && store.conflicts().length === 1);
      const f1 = await store.resolveFieldConflict(n6, 1, "a", "theirs");
      check("sync: field choice commits the merge", f1.committed === true && recsOf(s6, n6)[0].a === 2 && store.conflicts().length === 0, JSON.stringify(f1));

      /* ── 9. Records added on both sides merge together ── */
      mark("9 merge-adds");
      const s7 = makeServer();
      store.useBackend(s7);
      const n7 = "erp-v1-test-sy7" + uid;
      await store.set(n7, [{ id: 1 }]);
      setServer(s7, n7, [{ id: 1 }, { id: 2 }], 2); // theirs added #2
      await store.set(n7, [{ id: 1 }, { id: 3 }]);  // mine added #3
      const m3 = await store.resolveConflict(n7, "merge");
      const ids = recsOf(s7, n7).map((r) => r.id).sort();
      check("sync: merge keeps records added on both sides", !m3.error && ids.join(",") === "1,2,3", JSON.stringify(ids));

      /* ── 10. humanDocName resolves a declared module ── */
      mark("10 human-name");
      check("sync: humanDocName maps a module doc to its label", store.humanDocName("erp-v1-crm") === "CRM");
      check("sync: humanDocName maps a split-year doc with its FY", /Inventory.*FY \d{4}/.test(store.humanDocName("erp-v1-inventory-" + new Date().getFullYear())));

      /* ── 11. sync() report shape ── */
      mark("11 report");
      check("sync: report exposes counts", typeof r1.synced === "number" && typeof r1.pushed === "number" && typeof r1.conflicted === "number" && Array.isArray(r1.results));
    } catch (e) {
      check("sync: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Task 10+11+12+13 validation tests — CRM module
     Run via page_eval:  await window.ERPCrmTest()
     Covers: CRM record lifecycle, opportunity pipeline stages,
     won→project handoff, idea-incubator bundle import, and that
     party merges still rewrite CRM references.
     ============================================================ */

  window.ERPCrmTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const C = ERP.crm;
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const mark = (s) => { if (opts.debug) console.log("[ERPCrmTest]", s); };

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      C.invalidate();

      /* ── 1. Party directory primitives the CRM relies on ── */
      mark("1 parties");
      const parties = await master.parties();
      const pA = { id: master.nextId(parties), name: "Acme Corp", type: "customer", taxId: "TAX-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [], addresses: [] };
      const pB = { id: master.nextId(parties.concat([pA])), name: "Globex", type: "supplier", taxId: "TAX-2", paymentTerms: "net60", creditLimit: 0, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pA, pB]));

      /* ── 2. CRM record lifecycle ── */
      mark("2 record lifecycle");
      let recs = await C.records();
      check("crm: starts empty", Array.isArray(recs) && recs.length === 0);
      const rec = {
        id: master.nextId(recs), kind: "record", partyId: pA.id, source: "website", owner: "Amy",
        status: "new", tags: ["retail", "uk"], firstContact: "2026-01-10", notes: "Met at expo.",
        activity: [{ id: 1, ts: "2026-01-10T10:00:00.000Z", type: "note", summary: "Initial call", by: "owner" }],
        reminders: [{ id: 2, due: "2026-01-15", note: "Follow up", done: false }],
        createdAt: "2026-01-10T10:00:00.000Z", updatedAt: "2026-01-10T10:00:00.000Z",
      };
      await store.saveDoc("crm", recs.concat([rec]));
      C.invalidate();
      recs = await C.records();
      check("crm: record persisted with party linkage", recs.length === 1 && recs[0].kind === "record" && recs[0].partyId === pA.id && recs[0].reminders.length === 1);
      check("crm: kind filter isolates records from opportunities", C.byKind(recs, "record").length === 1 && C.byKind(recs, "opportunity").length === 0);

      /* ── 3. Opportunity pipeline + stage moves ── */
      mark("3 pipeline");
      const opp = {
        id: master.nextId(recs), kind: "opportunity", name: "Acme widget rollout", partyId: pA.id,
        owner: "Amy", stage: "lead", value: 25000, currency: "USD", expectedClose: "2026-03-01",
        tags: ["retail"], notes: "", createdAt: "2026-01-11T10:00:00.000Z", updatedAt: "2026-01-11T10:00:00.000Z",
      };
      await store.saveDoc("crm", recs.concat([opp]));
      C.invalidate();
      recs = await C.records();
      check("crm: opportunity lands in pipeline", C.byKind(recs, "opportunity").length === 1);
      opp.stage = "qualified";
      await store.saveDoc("crm", recs);
      C.invalidate();
      opp.stage = "won"; opp.wonAt = "2026-02-01T09:00:00.000Z";
      await store.saveDoc("crm", (await C.records()).map((x) => (String(x.id) === String(opp.id) ? opp : x)));
      C.invalidate();
      const won = C.byKind(await C.records(), "opportunity")[0];
      check("crm: won stage stamps wonAt", won.stage === "won" && !!won.wonAt);

      /* ── 4. Won opportunity → project handoff (deduplicated) ── */
      mark("4 won-to-project");
      const h1 = await C.wonToProject(won, await C.records());
      const projects = (await store.loadDoc("projects")).records;
      check("crm: wonToProject creates a project record", h1.created === true && projects.length === 1 && projects[0].source === "opportunity:" + won.id && projects[0].budget === 25000 && projects[0].partyId === pA.id);
      const h2 = await C.wonToProject(won, await C.records());
      const projects2 = (await store.loadDoc("projects")).records;
      check("crm: wonToProject does not duplicate", h2.created === false && projects2.length === 1);

      /* ── 5. Idea-incubator bundle import ── */
      mark("5 import ideas");
      const raw = JSON.stringify({
        schema: "idea-incubator-bundle", version: 1,
        ideas: [
          { title: "Self-checkout kiosk", summary: "Kiosks for Acme stores", tags: ["retail", "hardware"], partyName: "Acme Corp", value: 40000 },
          { title: "Warehouse bot", summary: "Automated picking", tags: ["ops"], category: "automation", partyName: "Initech", value: 15000 },
        ],
      });
      const ideas = C.parseIdeas(raw);
      check("crm: parseIdeas normalises a bundle", Array.isArray(ideas) && ideas.length === 2 && ideas[0].title === "Self-checkout kiosk" && ideas[0].value === 40000);
      check("crm: parseIdeas rejects garbage", C.parseIdeas("not json") === null);
      const before = (await master.parties()).length;
      const st = await C.importIdeas(ideas, await C.records(), await master.parties());
      C.invalidate();
      const recs2 = await C.records();
      const recsNew = C.byKind(recs2, "record").filter((r) => r.source === "idea-incubator");
      const oppsNew = C.byKind(recs2, "opportunity").filter((o) => o.source === "idea-incubator");
      const partiesAfter = await master.parties();
      check("crm: import creates a record per idea", recsNew.length === 2);
      check("crm: import creates qualified leads (not lead)", oppsNew.length === 2 && oppsNew.every((o) => o.stage === "qualified"));
      const initech = partiesAfter.find((p) => p.name === "Initech");
      check("crm: ideas naming a known party reuse it, unknown ones create it", partiesAfter.length === before + 1 && !!initech && recsNew.some((r) => r.partyId === pA.id) && recsNew.some((r) => r.partyId === initech.id));
      check("crm: import summary counts tally", st.ideas === 2 && st.records === 2 && st.opportunities === 2 && st.parties === 1);

      /* ── 6. Party merge still rewrites CRM references ── */
      mark("6 merge rewrites crm");
      const mrecs = (await C.records()).map((r) => Object.assign({}, r, { partyId: r.partyId === pA.id ? pB.id : r.partyId }));
      await store.saveDoc("crm", mrecs);
      C.invalidate();
      const refs = await store.readCanonical("erp-v1-crm");
      const crmRefs = refs.doc.records.filter((r) => r.partyId === pB.id).length;
      const crmAcme = refs.doc.records.filter((r) => r.partyId === pA.id).length;
      check("crm: all CRM references point at the surviving party after a merge", crmRefs > 0 && crmAcme === 0, JSON.stringify(refs.doc.records.map((r) => ({ k: r.kind, id: r.id, partyId: r.partyId }))));
    } catch (e) {
      check("crm: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      C.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPSalesTest (Tasks 14–18)
     Run via page_eval:  await window.ERPSalesTest()
     Covers: catalog line math, quote lifecycle (draft → sent →
     accepted), order fulfillment with stock checks + backorders
     + shortfall PO, invoice creation with due dates, and credit
     notes with reason validation.
     ============================================================ */

  window.ERPSalesTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const S = ERP.sales;
    const mark = (s) => { if (opts.debug) console.log("[ERPSalesTest]", s); };

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    let origGetModule = null;
    let origInventory = window.ERP.inventory;
    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      S.invalidate();
      origGetModule = ERP.getModule;
      ERP.getModule = (id) => { if (id === "purchasing") return { id: "purchasing", doc: { splitByYear: false } }; return origGetModule(id); };

      /* ── 1. Catalog + line totals math ── */
      mark("1 catalog + totals");
      const cat = [
        { id: 1, name: "Widget", sku: "W-1", type: "product", uom: "ea", defaultPrice: 100, defaultCost: 40, taxCode: "VAT20", active: true },
        { id: 2, name: "Consulting", sku: "C-1", type: "service", uom: "hr", defaultPrice: 150, defaultCost: 0, taxCode: "VAT0", active: true },
      ];
      await master.saveCatalog(cat);
      const lines = [
        { itemId: 1, description: "Widget", qty: 2, unitPrice: 100, discountPct: 10, taxCode: "VAT20", taxRate: 20 },
        { itemId: 2, description: "Consulting", qty: 1, unitPrice: 150, discountPct: 0, taxCode: "VAT0", taxRate: 0 },
      ];
      const t = S.computeTotals(lines);
      check("sales: totals math (subtotal/discount/tax/total)", Math.abs(t.subtotal - 350) < 0.001 && Math.abs(t.discount - 20) < 0.001 && Math.abs(t.taxTotal - 36) < 0.001 && Math.abs(t.total - 366) < 0.001, JSON.stringify(t));

      /* ── 2. Party setup ── */
      const parties = await master.parties();
      const pA = { id: master.nextId(parties), name: "Acme Corp", type: "customer", taxId: "TAX-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pA]));

      /* ── 3. Quote lifecycle ── */
      mark("3 quote lifecycle");
      const q = await S.createQuote({ partyId: pA.id, date: "2026-02-10", validUntil: "2026-03-10", lines, currency: "USD", notes: "Initial quote" });
      check("sales: quote drafted + numbered", q.kind === "quote" && q.status === "draft" && q.num === "QT-0001" && q.lines.length === 2 && q.lines[0].lineNo === 1 && q.lines[1].lineNo === 2);
      check("sales: quote totals persisted", Math.abs(q.total - 366) < 0.001 && Math.abs(q.subtotal - 350) < 0.001);
      let err = null; try { await S.createQuote({ partyId: pA.id, lines: [], currency: "USD" }); } catch (e) { err = e.message; }
      check("sales: quote requires lines", err && /line/i.test(err), err);
      const qsent = await S.sendQuote(q);
      check("sales: sendQuote stamps sent", qsent.status === "sent" && !!qsent.sentAt);
      err = null; try { await S.sendQuote(q); } catch (e) { err = e.message; }
      check("sales: cannot send a non-draft quote", err && /draft/i.test(err), err);

      /* ── 4. Accept → order ── */
      mark("4 accept to order");
      const o = await S.acceptQuote(q);
      const q2 = (await S.records()).find((r) => String(r.id) === String(q.id));
      check("sales: accept creates order from quote", o.kind === "order" && o.source === "quote" && o.quoteId === q.id && o.num === "SO-0001" && o.status === "open" && o.total === q.total);
      check("sales: quote marked accepted", q2.status === "accepted" && q2.acceptedOrderId === o.id);
      check("sales: order lines carry fulfillment zeroes", o.lines.every((l) => l.qtyShipped === 0 && l.qtyDelivered === 0 && l.qtyInvoiced === 0 && l.qtyBackordered === 0));
      err = null; try { await S.acceptQuote(q); } catch (e) { err = e.message; }
      check("sales: only sent quotes can be accepted", err && /sent/i.test(err), err);

      /* ── 5. Confirm with stock check + backorder + shortfall PO ── */
      mark("5 confirm + backorder");
      window.ERP.inventory = { available: async () => 0 };
      const conf = await S.confirmOrder(o);
      check("sales: confirm detects backorder", conf.hasBackorder === true && o.status === "confirmed" && o.hasBackorder === true && o.lines[0].qtyBackordered === 2 && o.lines[1].qtyBackordered === 1);
      const po = (await store.loadDoc("purchasing")).records.find((r) => r.kind === "po");
      check("sales: shortfall PO raised into purchasing", !!po && po.source === "shortfall" && po.orderId === o.id && po.num === "PO-0001" && po.lines.length === 2 && po.lines[0].qty === 2, po ? JSON.stringify(po) : "no po");
      window.ERP.inventory = origInventory;

      /* ── 6. Ship + deliver ── */
      mark("6 ship + deliver");
      const shipped = await S.recordShipment(o, { 1: 2, 2: 1 });
      check("sales: shipment records qty", shipped === 3 && o.lines[0].qtyShipped === 2 && o.lines[1].qtyShipped === 1 && o.status === "shipped");
      const delivered = await S.recordDelivery(o, { 1: 2, 2: 1 });
      check("sales: delivery records qty + stamps delivered", delivered === 3 && o.lines[0].qtyDelivered === 2 && o.status === "delivered" && !!o.stamps.deliveredAt);
      err = null; try { await S.recordDelivery(o, {}); } catch (e) { err = e.message; }
      check("sales: delivery requires a quantity", err && /quantity/i.test(err), err);

      /* ── 7. Invoice ── */
      mark("7 invoice");
      const inv = await S.invoiceFromOrder(o, { 1: 2, 2: 1 });
      check("sales: invoice created + posted", inv.kind === "invoice" && inv.num === "INV-0001" && inv.status === "posted" && inv.orderId === o.id && inv.orderNum === o.num);
      check("sales: invoice due date + totals from order", typeof inv.dueDate === "string" && inv.dueDate.length === 10 && inv.total === o.total && inv.subtotal === 350 && inv.taxTotal === 36);
      const o2 = (await S.records()).find((r) => String(r.id) === String(o.id));
      check("sales: order stamped invoiced", o2.status === "invoiced" && !!o2.stamps.invoicedAt && o2.lines.every((l) => l.qtyInvoiced === l.qty));

      /* ── 8. Credit notes ── */
      mark("8 credit notes");
      err = null; try { await S.createCreditNote(inv, 50, ""); } catch (e) { err = e.message; }
      check("sales: credit note requires a reason", err && /reason/i.test(err), err);
      err = null; try { await S.createCreditNote(inv, 99999, "too much"); } catch (e) { err = e.message; }
      check("sales: credit note cannot exceed open amount", err && /exceed/i.test(err), err);
      const cn = await S.createCreditNote(inv, 366, "Damaged on delivery");
      const inv2 = (await S.records()).find((r) => String(r.id) === String(inv.id));
      check("sales: credit note posted + invoice credited", cn.kind === "creditNote" && cn.num === "CN-0001" && cn.reason === "Damaged on delivery" && cn.invoiceId === inv.id && inv2.amountCredited === 366 && inv2.status === "credited");
      err = null; try { await S.createCreditNote(inv, 1, "more"); } catch (e) { err = e.message; }
      check("sales: no credit left on a fully credited invoice", err && /exceed/i.test(err), err);

      /* ── 9. Direct order + delete ── */
      mark("9 direct order + delete");
      const oD = await S.createOrder({ partyId: pA.id, lines: [{ itemId: 1, description: "Widget", qty: 5, unitPrice: 100, taxCode: "NONE", taxRate: 0 }], currency: "USD" });
      check("sales: direct order numbered independently", oD.num === "SO-0002" && oD.source === "direct" && oD.status === "open");
      window.ERP.inventory = { available: async () => 999 };
      const conf2 = await S.confirmOrder(oD);
      check("sales: confirm with stock available has no backorder", conf2.hasBackorder === false && oD.hasBackorder === false && oD.lines[0].qtyBackordered === 0);
      window.ERP.inventory = origInventory;
      await S.deleteDoc(q);
      const gone = (await S.records()).some((r) => String(r.id) === String(q.id));
      check("sales: deleteDoc removes the record", gone === false);
    } catch (e) {
      check("sales: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { if (typeof origGetModule === "function") ERP.getModule = origGetModule; } catch (e) {}
      try { if (origInventory) window.ERP.inventory = origInventory; } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      S.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPPurchTest (Tasks 19–23)
     Run via page_eval:  await window.ERPPurchTest()
     Covers: movement log + derived stock/valuation, purchase
     orders (send → receive → auto stock-in + supplier bill),
     supplier payments, reorder suggestions → PO, and backorder
     relief as goods arrive (stock issues at moving-average cost).
     ============================================================ */

  window.ERPPurchTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const P = ERP.purchasing;
    const I = ERP.inventory;
    const S = ERP.sales;
    const mark = (s) => { if (opts.debug) console.log("[ERPPurchTest]", s); };
    const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.001 : eps);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      P.invalidate(); I.invalidate(); S.invalidate();

      /* ── 1. Catalog + parties ── */
      mark("1 setup");
      const parties = await master.parties();
      const pSupp = { id: master.nextId(parties), name: "Globex", type: "supplier", taxId: "S-1", paymentTerms: "net30", creditLimit: 0, active: true, contacts: [], addresses: [] };
      const pCust = { id: master.nextId(parties.concat([pSupp])), name: "Acme Corp", type: "customer", taxId: "C-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pSupp, pCust]));
      const widget = { id: 1, name: "Widget", sku: "W-1", type: "product", uom: "ea", salePrice: 100, cost: 40, reorderPoint: 10, taxCode: "VAT20", active: true, supplierId: pSupp.id };
      const bolt = { id: 2, name: "Bolt", sku: "B-1", type: "product", uom: "ea", salePrice: 5, cost: 5, reorderPoint: 0, taxCode: "NONE", active: true, supplierId: pSupp.id };
      const rivet = { id: 3, name: "Rivet", sku: "R-1", type: "product", uom: "ea", salePrice: 7, cost: 3, reorderPoint: 5, taxCode: "NONE", active: true, supplierId: pSupp.id };
      await master.saveCatalog([widget, bolt, rivet]);

      /* ── 2. Movement log + derived stock & valuation (19, 23) ── */
      mark("2 movements + valuation");
      await I.postOpening({ itemId: 1, qty: 10, unitCost: 40, location: "Main", date: "2026-08-01" });
      await I.postReceipt({ itemId: 1, qty: 10, unitCost: 50, location: "Main", date: "2026-08-05" });
      await I.postIssue({ itemId: 1, qty: 5, location: "Main", date: "2026-08-10" });
      await I.postAdjustment({ itemId: 1, deltaQty: -2, location: "Main", date: "2026-08-12" });
      await I.postTransfer({ itemId: 1, location: "Main", toLocation: "WH", qty: 3, date: "2026-08-14" });
      const wStock = (await I.stock()).find((r) => String(r.itemId) === "1");
      check("inv: on-hand derived from movement log", wStock.qty === 13 && wStock.locations.length === 2, JSON.stringify(wStock));
      check("inv: moving-average cost + value", near(wStock.avgCost, 45) && near(wStock.value, 585), JSON.stringify({ avg: wStock.avgCost, value: wStock.value }));
      check("inv: available() matches on-hand", (await I.available(1)) === 13);
      const val = await I.valuation();
      check("inv: valuation totals", near(val.totalValue, 585));
      check("inv: movements are append-only records", (await I.movements()).length === 5);

      /* ── 3. Purchase order lifecycle (20): send → receive → stock-in + bill ── */
      mark("3 PO lifecycle");
      const po = await P.createPO({ supplierId: pSupp.id, expectedDate: "2026-09-01", lines: [{ itemId: 1, description: "Widget", qty: 4, unitCost: 50, taxCode: "VAT20", taxRate: 20 }] });
      check("purch: PO drafted + numbered + totals", po.kind === "po" && po.num === "PO-0001" && po.status === "draft" && near(po.total, 240) && po.lines[0].qtyReceived === 0, JSON.stringify({ num: po.num, total: po.total }));
      let err = null; try { await P.receivePO(po, { 1: 4 }); } catch (e) { err = e.message; }
      check("purch: cannot receive an unsent PO", err && /send/i.test(err), err);
      const psent = await P.sendPO(po);
      check("purch: sendPO stamps sent", psent.status === "sent" && !!psent.sentAt);
      const rc = await P.receivePO(po, { 1: 4 });
      check("purch: receipt posts stock-in + marks PO received", rc.any === 4 && rc.fullyReceived === true && po.status === "received" && (await I.available(1)) === 17, JSON.stringify({ any: rc.any, avail: await I.available(1) }));
      const bill = rc.bill;
      check("purch: goods receipt raises supplier bill in same action", bill.kind === "bill" && bill.num === "BILL-0001" && bill.poNum === "PO-0001" && bill.supplierId === pSupp.id && near(bill.total, 240), JSON.stringify(bill));
      const billRow = P.byKind(await P.records(), "bill");
      check("purch: bill persisted in purchasing doc", billRow.length === 1 && billRow[0].status === "open");
      const pay = await P.payBill(bill, 240, "bank", "2026-09-03", "SWIFT");
      const billAfter = P.byKind(await P.records(), "bill")[0];
      check("purch: payment posts cash-out and clears the bill", pay.kind === "payment" && pay.num === "PAY-0001" && pay.billId === bill.id && billAfter.status === "paid" && near(billAfter.amountPaid, 240));
      err = null; try { await P.payBill(bill, 10, "bank"); } catch (e) { err = e.message; }
      check("purch: cannot overpay a bill", err && /exceed/i.test(err), err);

      /* ── 4. Backorder relief (17 completion): goods arrive → deliver in order-date order ── */
      mark("4 backorder relief");
      const so = await S.createOrder({ partyId: pCust.id, lines: [{ itemId: 1, description: "Widget", qty: 20, unitPrice: 100, taxCode: "VAT20", taxRate: 20 }] });
      const conf = await S.confirmOrder(so);
      check("purch: confirm checks real stock and backorders the shortfall", conf.hasBackorder === true && so.lines[0].qtyBackordered === 3 && so.lines[0].qtyShipped === 0);
      P.invalidate();
      const po2 = P.byKind(await P.records(), "po").find((x) => x.source === "shortfall" && x.orderId === so.id);
      check("purch: shortfall PO raised for the backorder", !!po2 && po2.num === "PO-0002" && po2.lines[0].qty === 3);
      const beforeRelief = await I.available(1);
      await I.postReceipt({ itemId: 1, qty: 10, unitCost: 50, location: "Main", date: "2026-09-05" });
      check("purch: goods receipt auto-relieves backorders in date order", (await I.available(1)) === beforeRelief + 10 - 3, JSON.stringify({ before: beforeRelief, after: await I.available(1) }));
      const soAfter = (await S.records()).find((r) => String(r.id) === String(so.id));
      check("purch: relieved lines become delivered, order still open", soAfter.lines[0].qtyBackordered === 0 && soAfter.lines[0].qtyDelivered === 3 && soAfter.status === "confirmed");
      const issues = (await I.movements()).filter((m) => m.type === "issue" && m.refNum === so.num);
      check("purch: relief posts an issue (COGS) movement at moving-average cost", issues.length === 1 && issues[0].qty === -3 && issues[0].unitCost > 45, JSON.stringify(issues));
      await S.recordShipment(so, { 1: 3 });
      check("purch: shipping the shippable portion consumes stock", so.lines[0].qtyShipped === 3 && (await I.available(1)) === beforeRelief + 10 - 3 - 3, JSON.stringify({ avail: await I.available(1) }));
      const shipIssues = (await I.movements()).filter((m) => m.type === "issue" && m.refNum === so.num);
      check("purch: shipment posts its own stock issue", shipIssues.length === 2 && shipIssues[1].qty === -3);

      /* ── 5. Reorder suggestions (22) ── */
      mark("5 reorder suggestions");
      const sug = await I.reorderSuggestions();
      const rivetSug = sug.find((s) => String(s.itemId) === "3");
      check("purch: only products below reorder point suggested", sug.length === 1 && !!rivetSug && rivetSug.suggestedQty === 5 && rivetSug.qty === 0, JSON.stringify(sug));
      const rePos = await I.createReorderPOs(sug);
      check("purch: suggestions become a draft PO grouped by supplier", rePos.length === 1 && rePos[0].num === "PO-0003" && rePos[0].source === "reorder" && rePos[0].supplierId === pSupp.id && rePos[0].lines[0].itemId === 3 && rePos[0].lines[0].qty === 5, JSON.stringify(rePos.map((x) => ({ num: x.num, src: x.source, lines: x.lines }))));

      /* ── 6. Direct bill + partial payments (21) ── */
      mark("6 direct bill + payments");
      const bill2 = await P.createBill({ supplierId: pSupp.id, lines: [{ description: "Warehouse rent", qty: 1, unitCost: 500, taxCode: "NONE", taxRate: 0 }] });
      check("purch: direct bill created with due date from terms", bill2.kind === "bill" && bill2.num === "BILL-0002" && bill2.dueDate.length === 10 && near(bill2.total, 500));
      await P.payBill(bill2, 200, "bank", "2026-09-06", "R1");
      const b2a = P.byKind(await P.records(), "bill").find((b) => String(b.id) === String(bill2.id));
      check("purch: partial payment marks bill partial", b2a.status === "partial" && near(b2a.amountPaid, 200));
      await P.payBill(bill2, 300, "bank", "2026-09-07", "R2");
      const b2b = P.byKind(await P.records(), "bill").find((b) => String(b.id) === String(bill2.id));
      check("purch: full payment clears the bill", b2b.status === "paid");
      const allBills = P.byKind(await P.records(), "bill");
      check("purch: supplier balance ties to open bills", near(await P.supplierBalance(pSupp.id, allBills), 0));

      /* ── 7. PO guards & delete rules ── */
      mark("7 guards");
      err = null; try { await P.createPO({ supplierId: pSupp.id, lines: [] }); } catch (e) { err = e.message; }
      check("purch: PO requires lines", err && /line/i.test(err), err);
      const poD = await P.createPO({ supplierId: pSupp.id, lines: [{ description: "x", qty: 1, unitCost: 1 }] });
      await P.deletePO(poD);
      check("purch: draft PO can be deleted", !P.byKind(await P.records(), "po").some((x) => String(x.id) === String(poD.id)));
      err = null; try { await P.deletePO(po); } catch (e) { err = e.message; }
      check("purch: received PO cannot be deleted", err && /draft|sent/i.test(err), err);
    } catch (e) {
      check("purch: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      P.invalidate(); I.invalidate(); S.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPProjectsTest (Tasks 24–27)
     Run via page_eval:  await window.ERPProjectsTest()
     Covers: project CRUD + numbering, milestones (statuses,
     completion, billing value), tasks with assignees, time
     entries (billable validation + totals), expenses, whole-
     project profitability vs budget (no double-counting billed),
     progress invoices (milestones + time) written into the sales
     doc with correct numbering/due dates/ledger hooks, the
     project timeline, and the ports (export bundle, ingest
     project-seeds / project-bundles / ledger-receipts with
     dedupe).
     ============================================================ */

  window.ERPProjectsTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const P = ERP.projects;
    const S = ERP.sales;
    const ui = ERP.ui;
    const mark = (s) => { if (opts.debug) console.log("[ERPProjectsTest]", s); };
    const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.001 : eps);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      P.invalidate(); S.invalidate();

      /* ── 1. Setup ── */
      mark("1 setup");
      const parties = await master.parties();
      const pCust = { id: master.nextId(parties), name: "Acme Corp", type: "customer", taxId: "C-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pCust]));

      /* ── 2. Project CRUD (24) ── */
      mark("2 project CRUD");
      let err = null; try { await P.createProject({ title: "", partyId: pCust.id }); } catch (e) { err = e.message; }
      check("projects: title required", err && /title/i.test(err), err);
      const p = await P.createProject({ title: "Website rebuild", partyId: pCust.id, budget: 10000, currency: "USD", startDate: "2026-09-01", description: "Full site rebuild" });
      check("projects: created with PRJ numbering + status", p.kind === "project" && p.projNum === "PRJ-0001" && p.status === "planned" && p.partyId === pCust.id && near(p.budget, 10000));
      const p2 = await P.createProject({ title: "Mobile app", partyId: pCust.id, budget: 5000, currency: "USD", startDate: "2026-09-02" });
      check("projects: numbering increments", p2.projNum === "PRJ-0002");
      const pUpd = await P.updateProject(p, { budget: 12000 });
      check("projects: update persists budget", near(pUpd.budget, 12000));
      const pAct = await P.setProjectStatus(p, "active");
      check("projects: status change stamps + records", pAct.status === "active" && pAct.activity.some((a) => a.type === "status"));

      /* ── 3. Milestones (24) ── */
      mark("3 milestones");
      err = null; try { await P.addMilestone(p, { title: "", value: 0 }); } catch (e) { err = e.message; }
      check("projects: milestone title required", err && /title/i.test(err), err);
      const ms = await P.addMilestone(p, { title: "Design", value: 2000, plannedDate: "2026-09-10" });
      const ms2 = await P.addMilestone(p, { title: "Build", value: 6000, plannedDate: "2026-09-20" });
      check("projects: milestones linked to project", ms.kind === "milestone" && String(ms.projectId) === String(p.id) && near(ms.value, 2000));
      await P.setMilestoneStatus(p, ms, "completed");
      const msDone = P.byKind(await P.records(), "milestone").find((m) => String(m.id) === String(ms.id));
      check("projects: milestone completed stamped", msDone.status === "completed" && !!msDone.completedAt);
      await P.setMilestoneStatus(p, ms2, "in_progress");
      const msMetrics = (await P.projectMetrics(p)).milestones;
      check("projects: milestone counts in metrics", msMetrics.total === 2 && msMetrics.done === 1);

      /* ── 4. Tasks (25) ── */
      mark("4 tasks");
      const tk = await P.addTask(p, { title: "Homepage", milestoneId: ms.id, assignee: "Alice", estimatedHours: 8 });
      check("projects: task added with assignee", tk.kind === "task" && tk.assignee === "Alice" && String(tk.milestoneId) === String(ms.id));
      await P.setTaskStatus(p, tk, "done");
      const tkDone = P.byKind(await P.records(), "task").find((t) => String(t.id) === String(tk.id));
      check("projects: task status change", tkDone.status === "done");
      err = null; try { await P.setTaskStatus(p, tk, "bogus"); } catch (e) { err = e.message; }
      check("projects: unknown task status rejected", err && /status/i.test(err), err);

      /* ── 5. Timesheets (25) ── */
      mark("5 timesheets");
      err = null; try { await P.addTimeEntry({ projectId: p.id, hours: 0, billable: true, rate: 150 }); } catch (e) { err = e.message; }
      check("projects: zero hours rejected", err && /hours/i.test(err), err);
      err = null; try { await P.addTimeEntry({ projectId: p.id, hours: 2, billable: true, rate: 0 }); } catch (e) { err = e.message; }
      check("projects: billable time needs a rate", err && /rate/i.test(err), err);
      const te1 = await P.addTimeEntry({ projectId: p.id, taskId: tk.id, date: "2026-09-08", hours: 4, billable: true, rate: 150, cost: 60 });
      const te2 = await P.addTimeEntry({ projectId: p.id, date: "2026-09-09", hours: 2, billable: false, rate: 0, cost: 30, note: "Admin" });
      const tt = await P.projectTimeTotals(p);
      check("projects: time totals (hours, billable, value, labour)", near(tt.hours, 6) && near(tt.billableHours, 4) && near(tt.billableValue, 600) && near(tt.laborCost, 300), JSON.stringify(tt));

      /* ── 6. Expenses (26) ── */
      mark("6 expenses");
      err = null; try { await P.addExpense({ projectId: p.id, amount: 0 }); } catch (e) { err = e.message; }
      check("projects: zero expense rejected", err && /amount/i.test(err), err);
      const ex = await P.addExpense({ projectId: p.id, date: "2026-09-09", category: "Software", amount: 250, note: "Figma" });
      check("projects: expense recorded", ex.kind === "expense" && near(ex.amount, 250) && ex.category === "Software");

      /* ── 7. Progress billing — milestones (26) ── */
      mark("7 milestone billing");
      err = null; try { await P.progressInvoice(p, { mode: "milestones", ids: [] }); } catch (e) { err = e.message; }
      check("projects: milestone billing requires a selection", err && /milestone/i.test(err), err);
      err = null; try { await P.progressInvoice(p, { mode: "milestones", ids: [ms2.id] }); } catch (e) { err = e.message; }
      check("projects: incomplete milestone not billable", err && /completed/i.test(err), err);
      const inv = await P.progressInvoice(p, { mode: "milestones", ids: [ms.id] });
      check("projects: milestone progress invoice", inv.kind === "invoice" && inv.source === "project" && inv.projectId === p.id && inv.num === "INV-0001" && near(inv.total, 2000));
      check("projects: invoice due date from party terms", typeof inv.dueDate === "string" && inv.dueDate.length === 10 && near(ui.diffDays(inv.date, inv.dueDate), 30));
      const msStamped = P.byKind(await P.records(), "milestone").find((m) => String(m.id) === String(ms.id));
      check("projects: invoiced milestone stamped", msStamped.invoiceId === inv.id && msStamped.invoiceNum === "INV-0001");
      err = null; try { await P.progressInvoice(p, { mode: "milestones", ids: [ms.id] }); } catch (e) { err = e.message; }
      check("projects: already-invoiced milestone rejected", err && /invoiced/i.test(err), err);
      S.invalidate();
      const salesRecords = await S.records();
      check("projects: invoice lands in the sales doc", salesRecords.some((r) => r.kind === "invoice" && String(r.id) === String(inv.id) && r.source === "project"));

      /* ── 8. Progress billing — time (26) ── */
      mark("8 time billing");
      const inv2 = await P.progressInvoice(p, { mode: "time", ids: [te1.id] });
      check("projects: time progress invoice aggregates by task", inv2.kind === "invoice" && inv2.num === "INV-0002" && near(inv2.total, 600) && inv2.lines.length === 1 && inv2.lines[0].description.indexOf("Homepage") !== -1);
      const te1Stamped = P.byKind(await P.records(), "timeEntry").find((t) => String(t.id) === String(te1.id));
      check("projects: invoiced time entry stamped", te1Stamped.invoiceId === inv2.id);
      err = null; try { await P.progressInvoice(p, { mode: "time", ids: [te1.id] }); } catch (e) { err = e.message; }
      check("projects: already-invoiced time rejected", err && /invoiced/i.test(err), err);
      err = null; try { await P.progressInvoice(p, { mode: "bogus", ids: [te1.id] }); } catch (e) { err = e.message; }
      check("projects: unknown billing mode rejected", err && /mode/i.test(err), err);

      /* ── 9. Profitability vs budget (24) ── */
      mark("9 profitability");
      const m = await P.projectMetrics(p);
      check("projects: billed = invoice total only (no double count)", near(m.billed, 2600), JSON.stringify({ billed: m.billed, invoices: m.invoices.length }));
      check("projects: cost = expenses + labour", near(m.cost, 550) && near(m.expenseCost, 250) && near(m.laborCost, 300), JSON.stringify({ cost: m.cost, expenseCost: m.expenseCost, laborCost: m.laborCost }));
      check("projects: profit and remaining computed", near(m.profit, 2600 - 550) && near(m.remaining, 12000 - 2600) && near(m.pct, 2600 / 12000));
      check("projects: unbilled time tracked", near(m.unbilled, 0) && near(m.unbilledHours, 0)); // all billable time invoiced
      const m2 = await P.projectMetrics(p2);
      check("projects: empty project metrics are zeros", near(m2.billed, 0) && near(m2.budget, 5000) && near(m2.profit, 0));

      /* ── 10. Timeline (27) ── */
      mark("10 timeline");
      const tl = await P.projectTimeline(p);
      const kinds = tl.map((e) => e.type);
      check("projects: timeline has create + billing + edit events", kinds.includes("create") && kinds.includes("billing") && kinds.includes("status"));
      const sorted = tl.every((e, i) => i === 0 || new Date(tl[i - 1].ts) <= new Date(e.ts));
      check("projects: timeline is chronological", sorted);

      /* ── 11. Ports (27) ── */
      mark("11 ports");
      const bundle = await P.exportBundle();
      check("projects: export bundle shape", bundle.schema === "erp-project-bundles" && bundle.projects.length >= 2 && bundle.projects[0].milestones.length >= 2 && bundle.summary.projects >= 2);
      err = null; try { await P.ingestBundle({ schema: "bogus" }); } catch (e) { err = e.message; }
      check("projects: unknown bundle schema rejected", err && /schema/i.test(err), err);
      err = null; try { await P.ingestBundle(null); } catch (e) { err = e.message; }
      check("projects: non-bundle rejected", err && /bundle/i.test(err), err);

      const seeds = { schema: "erp-project-seeds", version: 1, exportedAt: new Date().toISOString(), projects: [
        { title: "Onboarding", partyId: pCust.id, partyName: "Acme Corp", value: 3000, currency: "USD", tags: ["new"], source: "opportunity:77" },
      ] };
      const r1 = await P.ingestBundle(seeds);
      check("projects: seeds import creates a project", r1.created === 1 && r1.schema === "erp-project-seeds");
      const r2 = await P.ingestBundle(seeds);
      check("projects: seeds re-import dedupes by source", r2.created === 0 && r2.updated === 1);
      const seedProj = P.byKind(await P.records(), "project").find((x) => x.source === "opportunity:77");
      check("projects: seed project carries source + budget", !!seedProj && near(seedProj.budget, 3000));

      const led = { schema: "erp-ledger-receipts", events: [{ projectId: p.id, type: "payment", summary: "Payment received" }] };
      const r3 = await P.ingestBundle(led);
      check("projects: ledger receipts append timeline events", r3.events === 1 && (await P.projectTimeline(p)).some((e) => e.type === "payment"));

      const selfBundle = await P.exportBundle();
      const rb = await P.ingestBundle(selfBundle);
      check("projects: project-bundle re-import dedupes by projNum/source", rb.created === 0 && rb.updated >= 2, JSON.stringify({ created: rb.created, updated: rb.updated }));

      /* ── 12. Cross-module safety ── */
      mark("12 cross-module");
      err = null; try { await P.progressInvoice(p, { mode: "milestones", ids: [ms.id] }); } catch (e) { err = e.message; }
      check("projects: invoiced items protected across calls", err && /invoiced/i.test(err), err);
    } catch (e) {
      check("projects: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      P.invalidate(); S.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPFinanceTest (Tasks 28–32)
     Run via page_eval:  await window.ERPFinanceTest()
     Covers: double-entry journal semantics (single-line / unbalanced /
     unknown-account rejection, posting, reversal with audit trail),
     the automatic-posting pipeline (PO → goods-in → supplier bill,
     order → ship → deliver → invoice, customer receipt, supplier
     payment — every money/stock event posts before its source doc
     saves, and the trial balance ties out), receivables & payables
     (aging buckets, statements, partial/split payments, over- and
     under-allocation errors), the bank register + statement matching,
     fiscal period close/reopen with the closing journal, and the
     chart-of-accounts / tax helpers.
     ============================================================ */

  window.ERPFinanceTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const F = ERP.finance;
    const S = ERP.sales;
    const P = ERP.purchasing;
    const I = ERP.inventory;
    const ui = ERP.ui;
    const mark = (s) => { if (opts.debug) console.log("[ERPFinanceTest]", s); };
    const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.001 : eps);
    const bal = (rows, code) => { const r = rows.find((x) => String(x.code) === String(code)); return r ? r.balance : 0; };

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();

      /* ── 1. Setup: parties + catalog + opening stock ── */
      mark("1 setup");
      const parties = await master.parties();
      const pCust = { id: master.nextId(parties), name: "Acme Corp", type: "customer", taxId: "C-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [], addresses: [] };
      const pSupp = { id: master.nextId(parties.concat([pCust])), name: "Globex", type: "supplier", taxId: "S-1", paymentTerms: "net30", creditLimit: 0, active: true, contacts: [], addresses: [] };
      const pZeta = { id: master.nextId(parties.concat([pCust, pSupp])), name: "Zeta Co", type: "customer", taxId: "C-2", paymentTerms: "net30", creditLimit: 2000, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pCust, pSupp, pZeta]));
      const widget = { id: 1, name: "Widget", sku: "W-1", type: "product", uom: "ea", salePrice: 100, cost: 40, reorderPoint: 0, taxCode: "VAT20", active: true, supplierId: pSupp.id };
      const consulting = { id: 2, name: "Consulting", sku: "C-1", type: "service", uom: "hr", salePrice: 150, cost: 0, reorderPoint: 0, taxCode: "VAT0", active: true, supplierId: null };
      await master.saveCatalog([widget, consulting]);
      await I.postOpening({ itemId: 1, qty: 100, unitCost: 50, location: "Main", date: "2026-08-01" });
      const acc = await master.defaultsMap();
      check("finance: default posting accounts present", !!acc.bank && !!acc.ar && !!acc.inventory && !!acc.taxPaid && !!acc.ap && !!acc.taxCollected && !!acc.equity && !!acc.retainedEarnings && !!acc.salesRevenue && !!acc.serviceRevenue && !!acc.cogs && !!acc.expense, JSON.stringify(acc));

      /* ── 2. Journal semantics (28) ── */
      mark("2 journal semantics");
      let err = null;
      try { await F.postJournal({ date: "2026-08-15", memo: "x", lines: [{ account: "1100", debit: 10, credit: 0 }] }); } catch (e) { err = e.message; }
      check("finance: single-line journal rejected", err && /two non-zero lines/i.test(err), err);
      err = null;
      try { await F.postJournal({ date: "2026-08-15", memo: "x", lines: [{ account: "1100", debit: 100, credit: 0 }, { account: "3000", debit: 0, credit: 50 }] }); } catch (e) { err = e.message; }
      check("finance: unbalanced journal rejected", err && /unbalanced/i.test(err), err);
      err = null;
      try { await F.postJournal({ date: "2026-08-15", memo: "x", lines: [{ account: "9999", debit: 1, credit: 0 }, { account: "3000", debit: 0, credit: 1 }] }); } catch (e) { err = e.message; }
      check("finance: unknown account rejected", err && /not on the chart/i.test(err), err);
      const j1 = await F.postJournal({ date: "2026-08-15", memo: "Opening manual entry", source: "manual", lines: [{ account: "1100", debit: 1000, credit: 0 }, { account: "3000", debit: 0, credit: 1000 }] });
      check("finance: journal posted with numbering + period", j1.kind === "journal" && /^JRNL/.test(j1.num) && j1.period === "2026-08" && near(j1.totalDebit, 1000) && near(j1.totalCredit, 1000) && j1.balanced && j1.lines.length === 2);
      const j1b = (await F.records()).find((x) => String(x.id) === String(j1.id));
      const rv = await F.reverseJournal(j1b, "corrected entry", { date: "2026-08-20" });
      check("finance: reversal negates lines + audit trail", rv.source === "reversal" && String(rv.reverses) === String(j1.id) && rv.lines.some((l) => String(l.account) === "1100" && l.debit === 0 && l.credit === 1000));
      const j1c = (await F.records()).find((x) => String(x.id) === String(j1.id));
      check("finance: original marked reversed", !!j1c.reversedBy && String(j1c.reversedBy) === String(rv.id));
      err = null;
      try { await F.reverseJournal(j1c, "again"); } catch (e) { err = e.message; }
      check("finance: double reversal rejected", err && /already been reversed/i.test(err), err);

      /* ── 3. Pipeline: PO → goods in → bill; order → ship → deliver → invoice; receipts (29) ── */
      mark("3 pipeline");
      const po = await P.createPO({ supplierId: pSupp.id, expectedDate: "2026-09-10", lines: [{ itemId: 1, description: "Widget", qty: 2, unitCost: 50, taxCode: "VAT20", taxRate: 20 }] });
      await P.sendPO(po);
      const rc = await P.receivePO(po, { 1: 2 });
      check("finance: goods receipt raised a from-receipt bill", rc.any === 2 && !!rc.bill && rc.bill.fromReceipt === true && near(rc.bill.total, 120), rc.bill ? JSON.stringify({ total: rc.bill.total, fromReceipt: rc.bill.fromReceipt }) : "no bill");
      const gi = await F.journals({ source: "goodsIn" });
      const billJ = await F.journals({ source: "bill" });
      check("finance: goods-in posts Dr Inventory / Cr AP", gi.length === 1 && gi[0].balanced && gi[0].lines.some((l) => String(l.account) === "1200" && l.debit === 100) && gi[0].lines.some((l) => String(l.account) === "2000" && l.credit === 100));
      check("finance: from-receipt bill books only input VAT", billJ.length === 1 && billJ[0].balanced && billJ[0].lines.some((l) => String(l.account) === "1300" && l.debit === 20) && billJ[0].lines.some((l) => String(l.account) === "2000" && l.credit === 20));
      const q = await S.createQuote({ partyId: pCust.id, date: "2026-09-12", validUntil: "2026-10-12", lines: [{ itemId: 1, description: "Widget", qty: 2, unitPrice: 100, discountPct: 0, taxCode: "VAT20", taxRate: 20 }], currency: "USD", notes: "" });
      await S.sendQuote(q);
      const o = await S.acceptQuote(q);
      const conf = await S.confirmOrder(o);
      check("finance: stock covers the order (no backorder)", conf.hasBackorder === false);
      const shipped = await S.recordShipment(o, { 1: 2 });
      const delivered = await S.recordDelivery(o, { 1: 2 });
      check("finance: order shipped + delivered", shipped === 2 && delivered === 2);
      const inv = await S.invoiceFromOrder(o, { 1: 2 });
      check("finance: invoice posted with ledger stamp", inv.kind === "invoice" && inv.num === "INV-0001" && !!inv.ledgerEntries && !!inv.ledgerEntries.journalId, inv.ledgerEntries ? JSON.stringify(inv.ledgerEntries) : "no ledgerEntries");
      const invJ = await F.journals({ source: "invoice" });
      const go = await F.journals({ source: "goodsOut" });
      check("finance: invoice posts Dr AR / Cr revenue + tax", invJ.length === 1 && invJ[0].balanced && invJ[0].lines.some((l) => String(l.account) === "1100" && l.debit === 240) && invJ[0].lines.some((l) => String(l.account) === "4000" && l.credit === 200) && invJ[0].lines.some((l) => String(l.account) === "2100" && l.credit === 40));
      check("finance: goods issue posts Dr COGS / Cr Inventory at avg cost", go.length === 1 && go[0].balanced && go[0].lines.some((l) => String(l.account) === "5000" && l.debit === 100) && go[0].lines.some((l) => String(l.account) === "1200" && l.credit === 100));
      const receipt = await F.recordCustomerReceipt({ partyId: pCust.id, amount: 240, date: "2026-09-15", method: "bank", ref: "wire-1", allocations: [{ invoiceId: inv.id, amount: 240 }] });
      check("finance: customer receipt posted with allocations", receipt.kind === "receipt" && near(receipt.amount, 240) && receipt.allocations.length === 1 && !!receipt.ledgerEntries);
      const invAfter = (await S.records()).find((r) => String(r.id) === String(inv.id));
      check("finance: invoice write-back paid + status", near(invAfter.amountPaid, 240) && invAfter.status === "paid", JSON.stringify({ amountPaid: invAfter.amountPaid, status: invAfter.status }));
      const pay = await P.payBill(rc.bill, rc.bill.total, "bank", "2026-09-16", "chq-1");
      check("finance: supplier payment posted", pay.kind === "payment" && !!pay.ledgerEntries && !!pay.ledgerEntries.journalId);
      const billAfter = (await P.records()).find((r) => String(r.id) === String(rc.bill.id));
      check("finance: bill cleared by payment", near(billAfter.amountPaid, 120) && billAfter.status === "paid");

      /* ── 4. Trial balance + statements (32) ── */
      mark("4 trial balance");
      const tb = await F.trialBalance({ from: "2026-09-01", to: "2026-09-30" });
      check("finance: trial balance balances (820/820)", tb.balanced && near(tb.totalDebit, 820) && near(tb.totalCredit, 820), JSON.stringify({ d: tb.totalDebit, c: tb.totalCredit }));
      check("finance: TB AR/Inventory/AP net to zero", bal(tb.rows, "1100") === 0 && bal(tb.rows, "1200") === 0 && bal(tb.rows, "2000") === 0);
      check("finance: TB bank/tax/revenue/COGS values", near(bal(tb.rows, "1000"), 120) && near(bal(tb.rows, "2100"), -40) && near(bal(tb.rows, "1300"), 20) && near(bal(tb.rows, "4000"), -200) && near(bal(tb.rows, "5000"), 100), JSON.stringify({ b: bal(tb.rows, "1000"), t21: bal(tb.rows, "2100"), t13: bal(tb.rows, "1300"), rev: bal(tb.rows, "4000"), cogs: bal(tb.rows, "5000") }));
      const pl = await F.profitLoss({ from: "2026-09-01", to: "2026-09-30" });
      check("finance: P&L gross + net income", near(pl.grossProfit, 100) && near(pl.netIncome, 100), JSON.stringify({ gross: pl.grossProfit, net: pl.netIncome }));
      const bs = await F.balanceSheet({ asOf: "2026-09-30" });
      check("finance: balance sheet balances A = L + E", near(bs.assets, 5140) && near(bs.liabilities, 40) && near(bs.totalEquity, 5100) && Math.abs(bs.diff) < 0.01, JSON.stringify({ a: bs.assets, l: bs.liabilities, e: bs.totalEquity, diff: bs.diff }));

      /* ── 5. Receivables: aging + receipts + statements (30) ── */
      mark("5 receivables");
      const salesRecs = (await S.records()).slice();
      salesRecs.push(
        { id: 101, kind: "invoice", num: "INV-Z1", partyId: pZeta.id, date: "2026-08-01", dueDate: "2026-08-10", total: 100, subtotal: 100, taxTotal: 0, amountPaid: 0, amountCredited: 0, currency: "USD", status: "posted", lines: [] },
        { id: 102, kind: "invoice", num: "INV-Z2", partyId: pZeta.id, date: "2026-07-01", dueDate: "2026-07-05", total: 200, subtotal: 200, taxTotal: 0, amountPaid: 0, amountCredited: 0, currency: "USD", status: "posted", lines: [] },
        { id: 103, kind: "invoice", num: "INV-Z3", partyId: pZeta.id, date: "2026-06-01", dueDate: "2026-06-01", total: 300, subtotal: 300, taxTotal: 0, amountPaid: 0, amountCredited: 0, currency: "USD", status: "posted", lines: [] }
      );
      await store.saveDoc("sales", salesRecs);
      S.invalidate();
      const aging = await F.receivableAging();
      check("finance: AR aging buckets (29/65/99 days)", aging.totals.d30 === 100 && aging.totals.d60 === 0 && aging.totals.d90 === 200 && aging.totals.d90plus === 300, JSON.stringify(aging.totals));
      check("finance: AR aging totals + overdue", aging.totals.total === 600 && aging.totals.overdue === 600 && aging.rows.length === 3);
      const r1 = await F.recordCustomerReceipt({ partyId: pZeta.id, amount: 50, date: "2026-09-16", method: "cash", allocations: [{ invoiceId: 101, amount: 50 }] });
      const r2 = await F.recordCustomerReceipt({ partyId: pZeta.id, amount: 250, date: "2026-09-17", method: "bank", allocations: [{ invoiceId: 102, amount: 100 }, { invoiceId: 103, amount: 150 }] });
      check("finance: receipts record partial + split allocations", r1.kind === "receipt" && near(r1.amount, 50) && r1.allocations.length === 1 && near(r2.amount, 250) && r2.allocations.length === 2);
      S.invalidate();
      const z1After = (await S.records()).find((r) => String(r.id) === "101");
      const z3After = (await S.records()).find((r) => String(r.id) === "103");
      check("finance: receipt write-backs on aged invoices", near(z1After.amountPaid, 50) && near(z3After.amountPaid, 150));
      err = null;
      try { await F.recordCustomerReceipt({ partyId: pZeta.id, amount: 300, date: "2026-09-18", method: "bank", allocations: [{ invoiceId: 102, amount: 999 }] }); } catch (e) { err = e.message; }
      check("finance: over-allocation rejected", err && /exceeds the open balance/i.test(err), err);
      err = null;
      try { await F.recordCustomerReceipt({ partyId: pZeta.id, amount: 100, date: "2026-09-18", method: "bank", allocations: [{ invoiceId: 102, amount: 40 }] }); } catch (e) { err = e.message; }
      check("finance: allocation sum mismatch rejected", err && /must total/i.test(err), err);
      const aging2 = await F.receivableAging();
      check("finance: AR aging after payments", aging2.totals.d30 === 50 && aging2.totals.d90 === 100 && aging2.totals.d90plus === 150 && aging2.totals.total === 300, JSON.stringify(aging2.totals));
      const stmt = await F.customerStatement(pZeta.id);
      const netEvents = stmt.events.reduce((s, e) => s + e.amount, 0);
      check("finance: customer statement balance + payments negative", near(stmt.balance, 300) && near(netEvents, 300) && stmt.events.filter((e) => e.type === "payment").every((e) => e.amount < 0) && stmt.events.filter((e) => e.type === "invoice").length === 3 && stmt.events.filter((e) => e.type === "payment").length === 2, JSON.stringify({ balance: stmt.balance, net: netEvents }));

      /* ── 6. Payables: aging + statement (30) ── */
      mark("6 payables");
      const purchRecs = (await P.records()).slice();
      purchRecs.push(
        { id: 201, kind: "bill", num: "BILL-X", supplierId: pSupp.id, date: "2026-06-01", dueDate: "2026-06-01", total: 500, subtotal: 500, taxTotal: 0, amountPaid: 0, status: "open", lines: [] },
        { id: 202, kind: "bill", num: "BILL-Y", supplierId: pSupp.id, date: "2026-08-15", dueDate: "2026-08-25", total: 300, subtotal: 300, taxTotal: 0, amountPaid: 0, status: "open", lines: [] }
      );
      await store.saveDoc("purchasing", purchRecs);
      P.invalidate();
      const pa = await F.payableAging();
      check("finance: AP aging buckets + totals", pa.totals.d30 === 300 && pa.totals.d90plus === 500 && pa.totals.total === 800 && pa.totals.overdue === 800, JSON.stringify(pa.totals));
      const sstmt = await F.supplierStatement(pSupp.id);
      check("finance: supplier statement balance", near(sstmt.balance, 800), JSON.stringify({ balance: sstmt.balance, events: sstmt.events.map((e) => e.type + ":" + e.amount) }));

      /* ── 7. Bank register + statement matching (31) ── */
      mark("7 bank");
      const dep = await F.addBankEntry({ type: "deposit", amount: 1000, date: "2026-09-02", memo: "Owner capital", otherAccount: "3000" });
      const wd = await F.addBankEntry({ type: "withdrawal", amount: 200, date: "2026-09-03", memo: "Rent", otherAccount: "5100" });
      check("finance: bank entries post to bank account", dep.kind === "journal" && dep.lines.some((l) => String(l.account) === "1000" && l.debit === 1000) && wd.lines.some((l) => String(l.account) === "5100" && l.debit === 200) && wd.lines.some((l) => String(l.account) === "1000" && l.credit === 200));
      const br = await F.bankRegister();
      const chrono = br.rows.every((r, i) => i === 0 || br.rows[i - 1].date <= r.date);
      const depRow = br.rows.find((r) => String(r.journalId) === String(dep.id));
      check("finance: bank register balances (dep 1000 − wd 200 + 240 + 50 + 250 − 120)", near(br.balance, 1220) && br.rows.length === 6 && chrono && !!depRow && near(depRow.amount, 1000) && depRow.cleared === false, JSON.stringify({ balance: br.balance, n: br.rows.length, rows: br.rows.map((r) => r.date + ":" + r.amount) }));
      check("finance: register initially uncleared", near(br.cleared, 0) && near(br.uncleared, 1220));
      await F.markCleared(dep.id, true, "STMT-0901");
      const br2 = await F.bankRegister();
      check("finance: statement matching marks cleared", near(br2.cleared, 1000) && near(br2.uncleared, 220), JSON.stringify({ cleared: br2.cleared, uncleared: br2.uncleared }));
      await F.markCleared(dep.id, false, "");
      const br3 = await F.bankRegister();
      check("finance: un-clearing restores the register", near(br3.cleared, 0) && near(br3.uncleared, 1220));

      /* ── 8. Period close / reopen (32) ── */
      mark("8 period close");
      const periods = await F.periods();
      check("finance: periods include the posting months", periods.indexOf("2026-09") !== -1 && periods.indexOf("2026-08") !== -1, periods.join(","));
      const closeRec = await F.closePeriod("2026-09", "Year-end test");
      check("finance: period closed with net income recorded", closeRec.kind === "periodClose" && near(closeRec.netIncome, -100) && !!closeRec.journalId, JSON.stringify({ net: closeRec.netIncome, jid: closeRec.journalId }));
      const closingBefore = (await F.journals({ source: "periodClose" })).find((x) => String(x.id) === String(closeRec.journalId));
      check("finance: closing journal zeroes income/expense to retained", !!closingBefore && near(closingBefore.totalDebit, 300) && near(closingBefore.totalCredit, 300) && closingBefore.lines.some((l) => String(l.account) === "3100" && l.debit > 0) && closingBefore.lines.some((l) => String(l.account) === "4000" && l.debit > 0), closingBefore ? JSON.stringify(closingBefore.lines) : "no closing journal");
      err = null;
      try { await F.postJournal({ date: "2026-09-20", memo: "late", lines: [{ account: "1100", debit: 1, credit: 0 }, { account: "4000", debit: 0, credit: 1 }] }); } catch (e) { err = e.message; }
      check("finance: posting into a closed period blocked", err && /closed/i.test(err), err);
      err = null;
      try { await F.closePeriod("2026-09", "again"); } catch (e) { err = e.message; }
      check("finance: double close rejected", err && /already closed/i.test(err), err);
      const reopened = await F.reopenPeriod("2026-09", "Reopen test");
      check("finance: period reopened", reopened.reopened === true);
      const closingAfter = (await F.journals({ source: "periodClose" })).find((x) => String(x.id) === String(closeRec.journalId));
      check("finance: reopen reverses the closing journal", !!closingAfter && !!closingAfter.reversedBy);
      const jPost = await F.postJournal({ date: "2026-09-25", memo: "after reopen", lines: [{ account: "1100", debit: 5, credit: 0 }, { account: "4000", debit: 0, credit: 5 }] });
      check("finance: period unlocked after reopen", jPost.kind === "journal" && jPost.period === "2026-09");

      /* ── 9. Extra hooks + chart / tax helpers ── */
      mark("9 extras");
      const pjInv = { id: 601, kind: "invoice", num: "INV-PJ", source: "project", partyId: pCust.id, date: "2026-09-26", lines: [{ itemId: null, qty: 1, unitPrice: 500, discountPct: 0, taxCode: "NONE", taxRate: 0 }], total: 500, subtotal: 500, taxTotal: 0 };
      const pj = await F.postSalesInvoice(pjInv);
      check("finance: project invoice posts to service revenue", !!pj && pj.lines.some((l) => String(l.account) === "4100" && l.credit === 500) && pj.lines.some((l) => String(l.account) === "1100" && l.debit === 500), pj ? JSON.stringify(pj.lines) : "no journal");
      const dBill = { id: 701, kind: "bill", num: "BILL-DIRECT", supplierId: pSupp.id, date: "2026-09-27", lines: [{ itemId: 1, qty: 5, unitCost: 10, taxCode: "VAT20", taxRate: 20 }], subtotal: 50, taxTotal: 10, total: 60, fromReceipt: false };
      const db = await F.postSupplierBill(dBill);
      check("finance: direct bill posts inventory + input VAT + AP", !!db && db.lines.some((l) => String(l.account) === "1200" && l.debit === 50) && db.lines.some((l) => String(l.account) === "1300" && l.debit === 10) && db.lines.some((l) => String(l.account) === "2000" && l.credit === 60));
      const again = await F.postSalesInvoice(inv);
      check("finance: re-posting an invoice is idempotent", String(again.id) === String(inv.ledgerEntries.journalId));
      const chart = await F.chartAccounts();
      const beforeLen = chart.length;
      await F.saveChart(chart.concat([{ id: 99, code: "9998", name: "Deferred Revenue", type: "liability", active: true, parent: null }]));
      const chart2 = await F.chartAccounts();
      check("finance: chart add persists", chart2.length === beforeLen + 1 && chart2.some((a) => a.code === "9998" && a.name === "Deferred Revenue"));
      await F.saveChart(chart);
      const chart3 = await F.chartAccounts();
      check("finance: chart restore", chart3.length === beforeLen && !chart3.some((a) => a.code === "9998"));
      const taxes = await F.taxRates();
      check("finance: tax rates include VAT20 @ 20%", taxes.some((t) => t.code === "VAT20" && Number(t.rate) === 20));
    } catch (e) {
      check("finance: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPReportTest (Tasks 33–36)
     Run via page_eval:  await window.ERPReportTest()
     Covers: dashboard KPIs computed from live data (cash, AR/AP
     totals + overdue, open orders/POs/bills, revenue vs last
     month, stock value + low-stock alerts, top customers), the
     hash deep-link into a module tab (#/module:tab), the report
     library (seeding, running every report type, CSV export, and
     the CSV serializer / parser), CSV import (parties, catalog,
     stock counts, opening balances — row validation, duplicates,
     unknown accounts/items, apply + audit), and the audit log
     (search filtering).
     ============================================================ */

  window.ERPReportTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const ui = ERP.ui;
    const F = ERP.finance;
    const S = ERP.sales;
    const P = ERP.purchasing;
    const I = ERP.inventory;
    const PR = ERP.projects;
    const R = ERP.reports;
    const D = ERP.dashboard;
    const mark = (s) => { if (opts.debug) console.log("[ERPReportTest]", s); };
    const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.001 : eps);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate(); PR.invalidate(); R.invalidate();

      /* ── 1. Setup: parties, catalog, opening stock, cash, pipeline ── */
      mark("1 setup");
      const parties = await master.parties();
      const pCust = { id: master.nextId(parties), name: "Acme Corp", type: "customer", taxId: "C-1", paymentTerms: "net30", creditLimit: 5000, active: true, contacts: [], addresses: [] };
      const pSupp = { id: master.nextId(parties.concat([pCust])), name: "Globex", type: "supplier", taxId: "S-1", paymentTerms: "net30", creditLimit: 0, active: true, contacts: [], addresses: [] };
      const pZeta = { id: master.nextId(parties.concat([pCust, pSupp])), name: "Zeta Co", type: "customer", taxId: "C-2", paymentTerms: "net30", creditLimit: 2000, active: true, contacts: [], addresses: [] };
      await master.saveParties(parties.concat([pCust, pSupp, pZeta]));
      const widget = { id: 1, name: "Widget", sku: "W-1", type: "product", uom: "ea", salePrice: 100, cost: 40, reorderPoint: 20, taxCode: "VAT20", active: true, supplierId: pSupp.id };
      const consulting = { id: 2, name: "Consulting", sku: "C-1", type: "service", uom: "hr", salePrice: 150, cost: 0, reorderPoint: 0, taxCode: "VAT0", active: true, supplierId: null };
      const gizmo = { id: 3, name: "Gizmo", sku: "G-1", type: "product", uom: "ea", salePrice: 60, cost: 20, reorderPoint: 5, taxCode: "VAT20", active: true, supplierId: pSupp.id };
      await master.saveCatalog([widget, consulting, gizmo]);
      await I.postOpening({ itemId: 1, qty: 100, unitCost: 50, location: "Main", date: "2026-08-01" });
      await F.addBankEntry({ type: "deposit", amount: 1000, date: "2026-09-02", memo: "Owner capital", otherAccount: "3000" });

      /* PO 1 → receive → open bill; PO 2 stays sent */
      const po = await P.createPO({ supplierId: pSupp.id, expectedDate: "2026-09-10", lines: [{ itemId: 1, description: "Widget", qty: 2, unitCost: 50, taxCode: "VAT20", taxRate: 20 }] });
      await P.sendPO(po);
      const rc = await P.receivePO(po, { 1: 2 });
      check("reporting: goods receipt raised an open bill", !!rc.bill && rc.bill.status === "open" && near(rc.bill.total, 120));
      const po2 = await P.createPO({ supplierId: pSupp.id, expectedDate: "2026-09-20", lines: [{ itemId: 3, description: "Gizmo", qty: 10, unitCost: 20, taxCode: "VAT20", taxRate: 20 }] });
      await P.sendPO(po2);

      /* Order 1 → confirm → ship → deliver → invoice (INV-0001, AR open) */
      const q = await S.createQuote({ partyId: pCust.id, date: "2026-09-08", validUntil: "2026-10-08", lines: [{ itemId: 1, description: "Widget", qty: 2, unitPrice: 100, discountPct: 0, taxCode: "VAT20", taxRate: 20 }], currency: "USD", notes: "" });
      await S.sendQuote(q);
      const o1 = await S.acceptQuote(q);
      await S.confirmOrder(o1);
      await S.recordShipment(o1, { 1: 2 });
      await S.recordDelivery(o1, { 1: 2 });
      const inv = await S.invoiceFromOrder(o1, { 1: 2 });
      check("reporting: invoice posted (INV-0001, 240)", inv.kind === "invoice" && inv.num === "INV-0001" && near(inv.total, 240));

      /* Extra sales doc data: two aged invoices (Zeta) + a confirmed open order */
      const salesRecs = (await S.records()).slice();
      salesRecs.push(
        { id: 101, kind: "invoice", num: "INV-Z1", partyId: pZeta.id, date: "2026-08-01", dueDate: "2026-08-10", total: 100, subtotal: 100, taxTotal: 0, amountPaid: 0, amountCredited: 0, currency: "USD", status: "posted", lines: [] },
        { id: 102, kind: "invoice", num: "INV-Z2", partyId: pZeta.id, date: "2026-07-01", dueDate: "2026-07-05", total: 200, subtotal: 200, taxTotal: 0, amountPaid: 0, amountCredited: 0, currency: "USD", status: "posted", lines: [] },
        { id: 500, kind: "order", num: "SO-0002", partyId: pCust.id, date: "2026-09-03", status: "confirmed", total: 750, subtotal: 750, taxTotal: 0, currency: "USD", lines: [{ lineNo: 1, itemId: 2, description: "Consulting", qty: 5, unitPrice: 150, discountPct: 0, taxCode: "VAT0", taxRate: 0 }] }
      );
      await store.saveDoc("sales", salesRecs);
      S.invalidate();

      /* Extra purchasing doc data: an aged open bill */
      const purchRecs = (await P.records()).slice();
      purchRecs.push({ id: 201, kind: "bill", num: "BILL-X", supplierId: pSupp.id, date: "2026-06-01", dueDate: "2026-07-01", total: 500, subtotal: 500, taxTotal: 0, amountPaid: 0, status: "open", lines: [] });
      await store.saveDoc("purchasing", purchRecs);
      P.invalidate();

      /* A project + expense for the profitability report */
      const projRecs = [
        { id: 1, kind: "project", title: "Website", projNum: "PRJ-0001", partyId: pCust.id, status: "in_progress", budget: 5000, currency: "USD", startDate: "2026-09-01", endDate: "", source: "manual", tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activity: [] },
        { id: 2, kind: "expense", projectId: 1, date: "2026-09-04", amount: 250, description: "Stock photography", supplierId: null },
      ];
      await store.saveDoc("projects", projRecs);
      PR.invalidate();

      /* ── 2. Dashboard KPIs (33) ── */
      mark("2 dashboard KPIs");
      const k = await D.kpis();
      check("reporting: dashboard cash = bank balance", near(k.cash, 1000), JSON.stringify({ cash: k.cash }));
      check("reporting: dashboard AR total + overdue", near(k.arTotal, 540) && near(k.arOverdue, 300) && k.arRows.length === 3, JSON.stringify({ arTotal: k.arTotal, arOverdue: k.arOverdue, n: k.arRows.length }));
      check("reporting: dashboard AP total + overdue", near(k.apTotal, 620) && near(k.apOverdue, 500) && k.apRows.length === 2, JSON.stringify({ apTotal: k.apTotal, apOverdue: k.apOverdue, n: k.apRows.length }));
      check("reporting: dashboard open orders + value", k.openOrders === 1 && near(k.openOrderValue, 750), JSON.stringify({ n: k.openOrders, v: k.openOrderValue }));
      check("reporting: dashboard open POs + value", k.openPOs === 1 && near(k.openPOValue, 240), JSON.stringify({ n: k.openPOs, v: k.openPOValue }));
      check("reporting: dashboard open bills + value", k.openBills === 2 && near(k.openBillValue, 620), JSON.stringify({ n: k.openBills, v: k.openBillValue }));
      check("reporting: dashboard revenue this month (200) vs last (0)", near(k.revenueThis, 200) && near(k.revenueLast, 0), JSON.stringify({ this: k.revenueThis, last: k.revenueLast }));
      check("reporting: dashboard stock value + low-stock alert", near(k.stockValue, 5000) && k.lowStock.length === 1 && k.lowStock[0].name === "Gizmo", JSON.stringify({ v: k.stockValue, low: k.lowStock.map((x) => x.name) }));
      check("reporting: dashboard top customers (Zeta then Acme)", k.topCustomers.length === 2 && k.topCustomers[0].name === "Zeta Co" && near(k.topCustomers[0].revenue, 300) && k.topCustomers[1].name === "Acme Corp" && near(k.topCustomers[1].revenue, 240), JSON.stringify(k.topCustomers.map((c) => c.name + ":" + c.revenue)));

      /* KPI deep-link: #/module:tab opens the target tab */
      mark("3 deep-link");
      await ERP.navigate("finance:receivables");
      const view = document.querySelector("#view");
      const activePanel = view ? view.querySelector("[data-panel].active") : null;
      check("reporting: #/finance:receivables deep-links to receivables tab", !!view && view.__tab === "receivables" && !!activePanel && activePanel.getAttribute("data-panel") === "receivables", activePanel ? activePanel.getAttribute("data-panel") : "no panel");
      await ERP.navigate("dashboard");
      await ERP.navigate("reports:import");
      const v2 = document.querySelector("#view");
      check("reporting: reports:import deep-links to import tab", !!v2 && v2.__tab === "import", v2 ? v2.__tab : "no view");
      await ERP.navigate("dashboard");

      /* ── 3. Report library (34) ── */
      mark("4 report library");
      const defs = await R.seedReports();
      check("reporting: report library seeded with defaults", defs.length === R.DEFAULT_REPORTS.length && defs.every((d) => d.id && d.title && d.type), defs.map((d) => d.id).join(","));
      const rPer = await R.runReport({ type: "salesByPeriod" });
      check("reporting: sales-by-period row for 2026-09", rPer.rows.length >= 1 && rPer.rows.find((x) => x.period === "2026-09") && near(rPer.rows.find((x) => x.period === "2026-09").revenue, 200) && near(rPer.rows.find((x) => x.period === "2026-09").tax, 40) && rPer.rows.find((x) => x.period === "2026-09").count === 1, JSON.stringify(rPer.rows));
      const rCust = await R.runReport({ type: "salesByCustomer" });
      check("reporting: sales-by-customer totals (Zeta 300, Acme 240)", rCust.rows.length === 2 && near(rCust.rows.find((x) => x.customer === "Zeta Co").revenue, 300) && near(rCust.rows.find((x) => x.customer === "Acme Corp").revenue, 240), JSON.stringify(rCust.rows));
      const rProd = await R.runReport({ type: "salesByProduct" });
      const widgetRow = rProd.rows.find((x) => x.item === "Widget");
      check("reporting: sales-by-product aggregates invoice lines", !!widgetRow && near(widgetRow.qty, 2) && near(widgetRow.revenue, 200), JSON.stringify(rProd.rows));
      const rSpend = await R.runReport({ type: "purchasingSpend" });
      const globexRow = rSpend.rows.find((x) => x.supplier === "Globex");
      check("reporting: purchasing spend per supplier", !!globexRow && globexRow.count === 2 && near(globexRow.spend, 620), JSON.stringify(rSpend.rows));
      const rProj = await R.runReport({ type: "projectProfitability" });
      const webRow = rProj.rows.find((x) => x.project === "Website");
      check("reporting: project profitability row (budget 5000, cost 250)", !!webRow && near(webRow.budget, 5000) && near(webRow.cost, 250) && near(webRow.profit, -250), JSON.stringify(rProj.rows));
      const rAge = await R.runReport({ type: "agedReceivables" });
      check("reporting: aged receivables totals", rAge.rows.length === 3 && rAge.rows.some((x) => x.num === "INV-Z1") && rAge.rows.some((x) => x.num === "INV-0001"), JSON.stringify({ n: rAge.rows.length, rows: rAge.rows.map((x) => x.num) }));
      const rInv = await R.runReport({ type: "inventoryValuation" });
      const invWidget = rInv.rows.find((x) => x.item === "Widget");
      check("reporting: inventory valuation includes Widget @ 100", !!invWidget && near(invWidget.qty, 100), JSON.stringify(rInv.rows));
      const rTax = await R.runReport({ type: "taxSummary" });
      const vat20 = rTax.rows.find((x) => x.taxCode === "VAT20");
      check("reporting: tax summary VAT20 output 40 / input 20", !!vat20 && near(vat20.salesTax, 40) && near(vat20.purchTax, 20) && near(vat20.net, 20), JSON.stringify(rTax.rows));
      let rerr = null;
      try { await R.runReport({ type: "bogus" }); } catch (e) { rerr = e.message; }
      check("reporting: unknown report type rejected", rerr && /unknown report/i.test(rerr), rerr);

      /* CSV export + parser */
      mark("5 CSV utils");
      const csv1 = R.toCsv([{ key: "a", label: "A" }, { key: "b", label: "B", format: (v) => v + "!" }], [{ a: 1, b: 2 }]);
      check("reporting: toCsv header + formatted row", csv1 === "A,B\r\n1,2!", JSON.stringify(csv1));
      const csv2 = R.toCsv([{ key: "a", label: "A" }, { key: "b", label: "B" }], [{ a: "x,y", b: 'say "hi"' }]);
      check("reporting: toCsv quotes commas + quotes", csv2 === 'A,B\r\n"x,y","say ""hi"""', JSON.stringify(csv2));
      const csv3 = R.toCsv([{ key: "a", label: "A" }], []);
      check("reporting: toCsv empty rows → header only", csv3 === "A", JSON.stringify(csv3));
      const parsed = R.parseCsv('a,"b,c"\n"d""e",f');
      check("reporting: parseCsv handles quotes/commas/newlines", parsed.length === 2 && parsed[0][0] === "a" && parsed[0][1] === "b,c" && parsed[1][0] === 'd"e' && parsed[1][1] === "f", JSON.stringify(parsed));
      const parsedCrlf = R.parseCsv("h1,h2\r\n1,2\r\n");
      check("reporting: parseCsv handles CRLF + trailing newline", parsedCrlf.length === 2 && parsedCrlf[1][0] === "1", JSON.stringify(parsedCrlf));

      /* ── 4. CSV import (35) ── */
      mark("6 import parties");
      const partCsv = "name,type,taxId,creditLimit,active\nImported Ltd,customer,IM-1,1500,true\nImportable Supplies,supplier,IM-2,0,true\n,customer,,,true\nAcme Corp,customer,,,true";
      const pPrep = await R.prepareImport("parties", partCsv);
      check("reporting: parties import validates rows", pPrep.header === true && pPrep.items.length === 4 && pPrep.items.filter((i) => i.ok).length === 2 && pPrep.items.filter((i) => !i.ok).length === 2, JSON.stringify(pPrep.items.map((i) => ({ r: i.rowNo, ok: i.ok, m: i.message }))));
      check("reporting: parties import flags missing name", pPrep.items.find((i) => i.rowNo === 4) && !pPrep.items.find((i) => i.rowNo === 4).ok && /name is required/i.test(pPrep.items.find((i) => i.rowNo === 4).message));
      check("reporting: parties import flags duplicate", pPrep.items.find((i) => i.rowNo === 5) && !pPrep.items.find((i) => i.rowNo === 5).ok && /already exists/i.test(pPrep.items.find((i) => i.rowNo === 5).message));
      const pApply = await R.applyImport("parties", pPrep.items, pPrep.ctx);
      check("reporting: parties import applies valid rows", pApply.created === 2 && pApply.skipped === 2, JSON.stringify({ created: pApply.created, skipped: pApply.skipped }));
      const partiesAfter = await master.parties();
      check("reporting: parties import persists", partiesAfter.some((x) => x.name === "Imported Ltd" && x.type === "customer" && x.creditLimit === 1500) && partiesAfter.some((x) => x.name === "Importable Supplies" && x.type === "supplier"));
      const pReprep = await R.prepareImport("parties", partCsv);
      check("reporting: parties re-import detects now-existing rows", pReprep.items.filter((i) => i.ok).length === 0, JSON.stringify(pReprep.items.map((i) => i.message)));

      mark("7 import catalog");
      const catCsv = "name,sku,type,uom,salePrice,cost,reorderPoint,taxCode,active\nImported Widget,IW-1,product,ea,80,30,10,VAT20,true\nBad Service,BS-1,service,hr,100,0,0,BOGUS,true\nWidget,W-1,product,ea,1,1,1,VAT20,true";
      const cPrep = await R.prepareImport("catalog", catCsv);
      check("reporting: catalog import flags bad tax code + dup SKU", cPrep.items.length === 3 && cPrep.items.filter((i) => i.ok).length === 1 && cPrep.items[1].message && /unknown tax code/i.test(cPrep.items[1].message) && cPrep.items[2].message && /sku already exists/i.test(cPrep.items[2].message), JSON.stringify(cPrep.items.map((i) => ({ ok: i.ok, m: i.message }))));
      const cApply = await R.applyImport("catalog", cPrep.items, cPrep.ctx);
      check("reporting: catalog import applies 1 row", cApply.created === 1);
      const catAfter = await master.catalog();
      check("reporting: catalog import persists + maps supplier", catAfter.some((x) => x.name === "Imported Widget" && x.sku === "IW-1" && x.taxCode === "VAT20"));

      mark("8 import stock counts");
      const stockCsv = "sku,qty,unitCost,location,date\nW-1,25,45,Main,2026-09-05\nG-1,8,22,Main,2026-09-05\nZZZ,5,10,Main,2026-09-05";
      const sPrep = await R.prepareImport("stock-counts", stockCsv);
      check("reporting: stock import resolves items by SKU", sPrep.items.length === 3 && sPrep.items.filter((i) => i.ok).length === 2 && sPrep.items[2].message && /unknown item/i.test(sPrep.items[2].message), JSON.stringify(sPrep.items.map((i) => ({ ok: i.ok, m: i.message }))));
      const movsBefore = (await I.movements()).length;
      const sApply = await R.applyImport("stock-counts", sPrep.items, sPrep.ctx);
      check("reporting: stock import posts opening movements", sApply.created === 2 && (await I.movements()).length === movsBefore + 2);
      const stockAfter = await I.stock();
      const stW = stockAfter.find((x) => x.itemId === 1);
      const stG = stockAfter.find((x) => x.itemId === 3);
      check("reporting: stock counts applied to on-hand", !!stW && near(stW.qty, 125) && !!stG && near(stG.qty, 8), JSON.stringify(stockAfter.map((x) => x.name + ":" + x.qty)));
      const k2 = await D.kpis();
      check("reporting: dashboard low-stock clears for counted items", k2.lowStock.length === 1 && k2.lowStock[0].name === "Imported Widget", JSON.stringify(k2.lowStock.map((x) => x.name)));

      mark("9 import opening balances");
      const obCsv = "account,debit,credit,date,memo\n1000,2000,0,2026-09-06,Test opening\n3000,0,2000,2026-09-06,Test opening\n9999,100,0,2026-09-06,Bad";
      const obPrep = await R.prepareImport("opening-balances", obCsv);
      check("reporting: opening-balances import flags unknown account", obPrep.items.length === 3 && obPrep.items.filter((i) => i.ok).length === 2 && obPrep.items[2].message && /unknown account/i.test(obPrep.items[2].message), JSON.stringify(obPrep.items.map((i) => ({ ok: i.ok, m: i.message }))));
      const obApply = await R.applyImport("opening-balances", obPrep.items, obPrep.ctx);
      check("reporting: opening-balances import posts a balanced journal", obApply.created === 2 && !obApply.fatal, JSON.stringify({ created: obApply.created, fatal: obApply.fatal }));
      const openingJ = (await F.journals({ source: "opening" })).filter((j) => j.date === "2026-09-06");
      check("reporting: opening-balances journal is balanced (2000/2000)", openingJ.length === 1 && openingJ[0].balanced && near(openingJ[0].totalDebit, 2000) && near(openingJ[0].totalCredit, 2000), openingJ[0] ? JSON.stringify({ d: openingJ[0].totalDebit, c: openingJ[0].totalCredit }) : "none");
      const badObCsv = "account,debit,credit,date\n1000,500,0,2026-09-06\n3000,0,600,2026-09-06";
      const badOb = await R.prepareImport("opening-balances", badObCsv);
      const badApply = await R.applyImport("opening-balances", badOb.items, badOb.ctx);
      check("reporting: unbalanced opening balances blocked with fatal error", badApply.fatal && /unbalanced/i.test(badApply.fatal), JSON.stringify(badApply));

      /* ── 5. Audit log (36) ── */
      mark("10 audit log");
      const audit = await master.auditLog({ all: true });
      check("reporting: audit log has entries incl. csv_imports", audit.length > 0 && audit.some((e) => e.action === "csv_import") && audit.some((e) => e.action === "stock_opening"), JSON.stringify({ n: audit.length, actions: audit.map((e) => e.action).slice(-12) }));
      const impEntries = R.filterAudit(audit, "csv_import");
      check("reporting: audit search filters by action", impEntries.length >= 4, String(impEntries.length));
      const partiesImp = R.filterAudit(audit, "Imported 2 row(s) from CSV (parties)");
      check("reporting: audit search filters by summary", partiesImp.length === 1, String(partiesImp.length));
      const none = R.filterAudit(audit, "zzz-not-there");
      check("reporting: audit search misses return empty", none.length === 0, String(none.length));
      const allBack = R.filterAudit(audit, "");
      check("reporting: audit search with empty query returns all", allBack.length === audit.length, String(allBack.length));
    } catch (e) {
      check("reporting: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate(); PR.invalidate(); R.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPQualityTest (Tasks 37–39)
     Run via page_eval:  await window.ERPQualityTest()
     Covers: the accounting invariant checks on a clean world and
     after a full quote → order → delivery → invoice → payment
     chain; detecting a deliberately unbalanced journal and
     recovering; the automatic re-check after finance actions; the
     friendly error copy for every failure mode; older-schema and
     malformed payloads; document_too_large; backup/restore
     round-trips; sync conflict resolution; the system-health UI;
     and a save/load fixture round-trip for every module document.
     ============================================================ */

  window.ERPQualityTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const ui = ERP.ui;
    const F = ERP.finance;
    const S = ERP.sales;
    const P = ERP.purchasing;
    const I = ERP.inventory;
    const B = ERP.backup;
    const Q = ERP.quality;
    const mark = (s) => { if (opts.debug) console.log("[ERPQualityTest]", s); };
    const near = (a, b, eps) => Math.abs(a - b) < (eps == null ? 0.001 : eps);

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    const autoWas = Q.autoEnabled;
    Q.setAuto(false);

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();

      /* ── 1. Clean-world invariants ── */
      mark("1 clean invariants");
      const refs = await Q.FIXTURES.setup();
      const inv1 = await Q.invariants();
      const keys = inv1.checks.map((c) => c.key + ":" + c.status);
      check("quality: all seven invariants pass on a clean world", inv1.ok && inv1.checks.length === 7 && inv1.failCount === 0 && inv1.errorCount === 0, JSON.stringify(keys));

      /* ── 2. Full sales chain keeps the books tied ── */
      mark("2 quote → order → delivery → invoice → payment chain");
      const ch = await Q.FIXTURES.chain(refs);
      check("quality: chain invoice totals 3×100 + 20% VAT", !!ch.invoice && ch.invoice.kind === "invoice" && near(ch.invoice.total, 360), ch.invoice ? String(ch.invoice.total) : "no invoice");
      const salesAfter = (await store.loadDoc("sales")).records || [];
      const invAfter = salesAfter.find((r) => r.kind === "invoice" && String(r.id) === String(ch.invoice.id));
      check("quality: payment fully settles the invoice", !!invAfter && near(invAfter.amountPaid, 360) && invAfter.status === "paid", invAfter ? JSON.stringify({ paid: invAfter.amountPaid, status: invAfter.status }) : "no invoice");
      const bankReg = await F.bankRegister();
      check("quality: cash register reflects opening + payment", near(bankReg.balance, 10360), String(bankReg.balance));
      const inv2 = await Q.invariants();
      check("quality: invariants still pass after the chain", inv2.ok && inv2.failCount === 0, JSON.stringify(inv2.checks.filter((c) => c.status !== "ok").map((c) => c.key)));

      /* ── 3. An unbalanced journal is caught, then recovered ── */
      mark("3 unbalanced entry detection + recovery");
      const finDocs = await store.loadDoc("finance");
      const badJ = {
        id: 999001, kind: "journal", num: "JRNL-BAD", date: ui.today(), period: ui.today().slice(0, 7),
        memo: "Bad fixture entry", source: "manual", refType: "", refId: null, refNum: "",
        lines: [{ account: "1000", debit: 100, credit: 0 }, { account: "4000", debit: 0, credit: 90 }],
        totalDebit: 100, totalCredit: 90, balanced: false, reverses: null, reversedBy: null,
        periodClosed: false, bankCleared: false, bankStatementRef: "",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await store.saveDoc("finance", finDocs.records.concat([badJ]));
      const invBad = await Q.invariants();
      const jbBad = invBad.checks.find((c) => c.key === "journal_balance");
      check("quality: unbalanced journal trips the invariant", !invBad.ok && !!jbBad && jbBad.status === "fail", jbBad ? jbBad.detail : "no check");
      await store.saveDoc("finance", finDocs.records);
      const invGood = await Q.invariants();
      check("quality: removing the bad entry restores health", invGood.ok && invGood.failCount === 0, JSON.stringify(invGood.checks.filter((c) => c.status !== "ok").map((c) => c.key)));

      /* ── 4. Finance actions auto-trigger a re-check ── */
      mark("4 auto re-check after finance actions");
      const regBefore = await F.bankRegister();
      const resultBefore = Q.lastResult;
      Q.setAuto(true);
      await F.addBankEntry({ type: "deposit", amount: 25, date: ui.today(), memo: "Auto re-check test", otherAccount: "4000" });
      for (let i = 0; i < 20; i++) {
        if (Q.lastResult && Q.lastResult !== resultBefore) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      check("quality: finance action auto-triggers a health re-check", !!Q.lastResult && Q.lastResult !== resultBefore && Q.lastResult.checks.length === 7, Q.lastResult ? Q.lastResult.ranAt : "no result");
      Q.setAuto(false);
      const regAfter = await F.bankRegister();
      check("quality: auto-wrap deposit hit the register", near(regAfter.balance, regBefore.balance + 25), regAfter.balance + " vs " + (regBefore.balance + 25));

      /* ── 5. Error copy & recovery guidance ── */
      mark("5 friendly error copy");
      const cases = [
        ["document_too_large", "Document too large"],
        ["over_daily_allowance quota reached", "Storage quota reached"],
        ["lost the edit key", "Lost edit key"],
        ["conflict — changed on another device", "Offline divergence"],
        ["corrupt_document: not valid JSON", "Schema mismatch or corrupt document"],
        ["Unbalanced journal entry", "Unbalanced entry"],
        ["upload_plugin_unavailable", "Storage unavailable"],
      ];
      for (const [msg, want] of cases) {
        const fe = Q.friendlyError({ message: msg });
        check("quality: friendly copy — " + want, fe.title === want && !!fe.nextStep, fe.title + " — " + fe.nextStep);
      }
      const feUnknown = Q.friendlyError({ message: "something bizarre happened" });
      check("quality: unknown errors fall back to generic copy", feUnknown.title === "Something went wrong" && !!feUnknown.nextStep, feUnknown.title);
      const guideKeys = inv1.checks.map((c) => c.key).concat(["harness"]);
      for (const gk of guideKeys) {
        const g = Q.guide(gk);
        check("quality: recovery guide for " + gk, !!g && !!g.nextStep && g.nextStep.length > 20, g ? g.nextStep : "none");
      }

      /* ── 6. Older schema + malformed payloads ── */
      mark("6 older schema + malformed payloads");
      const pName = store.docName("parties");
      await store.set(pName, Q.FIXTURES.olderSchema("parties"));
      const legacyDoc = await store.loadDoc("parties");
      check("quality: older-schema parties document loads", !!legacyDoc && legacyDoc.records.some((r) => r.name === "Legacy Co"), legacyDoc ? JSON.stringify(legacyDoc.records) : "no doc");
      master.flush();
      const legacyList = await master.parties();
      check("quality: master tolerates older-schema parties", legacyList.some((r) => r.name === "Legacy Co" && r.type === "customer"), JSON.stringify(legacyList));
      const tName = store.docName("taxes");
      srv.files[tName] = Q.FIXTURES.malformed.badJson;
      const badCanon = await store.readCanonical(tName);
      check("quality: malformed JSON surfaces corrupt_document", !!badCanon && badCanon.error === "corrupt_document", badCanon ? (badCanon.error || "no error") : "no result");
      check("quality: friendly copy for corrupt JSON", Q.friendlyError(badCanon).title === "Schema mismatch or corrupt document", Q.friendlyError(badCanon).title);
      const vBad = B.validateBundle({ schema: "not-backup" });
      check("quality: validateBundle rejects a foreign schema", vBad.valid === false && vBad.errors.length === 1, JSON.stringify(vBad.errors));
      const vMix = B.validateBundle({ schema: "erp-backup", docs: {
        a: { schema: "erp-doc", schemaVersion: 1, doc: "x", records: [{ id: 1 }] },
        b: { schema: "erp-doc", schemaVersion: 1, doc: "y" },
        c: { schema: "nope", records: [] },
      } });
      check("quality: validateBundle keeps valid docs, reports the rest", !!vMix.docs.a && !vMix.docs.b && !vMix.docs.c && vMix.errors.length === 2, JSON.stringify(vMix.errors));

      /* ── 7. Document too large ── */
      mark("7 document too large");
      const bigRecs = Array.from({ length: 42000 }, (_, i) => ({ id: i + 1, name: "x".repeat(120) }));
      const bigRes = await store.set(store.docName("catalog"), bigRecs);
      check("quality: oversized document is refused", !!bigRes && bigRes.error === "document_too_large", bigRes ? (bigRes.error || "no error") : "no result");
      check("quality: friendly copy for document too large", Q.friendlyError(bigRes).title === "Document too large", Q.friendlyError(bigRes).title);

      /* ── 8. Backup / restore round-trip ── */
      mark("8 backup / restore round-trip");
      const bundle = await B.backupBundle();
      const vB = B.validateBundle(bundle);
      check("quality: full backup validates", vB.valid === true && Object.keys(vB.docs).length > 0, "docs=" + Object.keys(vB.docs).length);
      check("quality: backup captures the older-schema parties state", !!(bundle.docs[store.docName("parties")] || {}).records && bundle.docs[store.docName("parties")].records.some((r) => r.name === "Legacy Co"), "legacy missing from bundle");
      await store.set(store.docName("parties"), [{ id: 99, name: "Temp" }]);
      const tmpCheck = await store.readCanonical(store.docName("parties"));
      check("quality: temporary parties write visible", !!tmpCheck.doc && tmpCheck.doc.records.some((r) => r.name === "Temp"), "missing");
      const restore = await B.restoreBundle(bundle, {});
      check("quality: restore rewrites every document", restore.written.length === Object.keys(bundle.docs).length, restore.written.length + "/" + Object.keys(bundle.docs).length);
      const afterRestore = await store.readCanonical(store.docName("parties"));
      check("quality: restore undoes the temporary write", !!afterRestore.doc && !afterRestore.doc.records.some((r) => r.name === "Temp") && afterRestore.doc.records.some((r) => r.name === "Legacy Co"), afterRestore.doc ? JSON.stringify(afterRestore.doc.records.map((r) => r.name)) : "no doc");
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();

      /* ── 9. Sync conflict + resolution ── */
      mark("9 sync conflict + resolution");
      const cname = store.docName("crm");
      await store.set(cname, [{ id: 1, v: "a" }]);
      const remote = JSON.parse(srv.files[cname]);
      remote.rev = 2;
      remote.records = [{ id: 1, v: "b" }];
      srv.files[cname] = JSON.stringify(remote);
      const cRes = await store.set(cname, [{ id: 1, v: "c" }]);
      check("quality: divergent canonical write raises a conflict", !!cRes && cRes.error === "conflict", cRes ? (cRes.error || "no error") : "no result");
      const cachedAfter = store.cachedDoc(cname);
      check("quality: local work preserved on conflict", !!cachedAfter && cachedAfter.records[0].v === "c", cachedAfter ? String(cachedAfter.records[0].v) : "no cache");
      await store.resolveConflict(cname, "keep_theirs");
      const cachedResolved = store.cachedDoc(cname);
      check("quality: keep-theirs adopts the remote version", !!cachedResolved && cachedResolved.records[0].v === "b", cachedResolved ? String(cachedResolved.records[0].v) : "no cache");

      /* ── 10. System-health UI ── */
      mark("10 system-health UI");
      const health = await Q.check();
      const dot = document.getElementById("healthDot");
      check("quality: topbar health dot turns green on clean books", !!dot && /green/.test(dot.className), dot ? dot.className : "no dot");
      await ERP.navigate("reports:health");
      let hpPanel = null;
      for (let i = 0; i < 20; i++) {
        hpPanel = document.querySelector('#view [data-panel="health"]');
        if (hpPanel && hpPanel.querySelector("table tbody tr")) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const hpRows = hpPanel ? hpPanel.querySelectorAll("table tbody tr").length : 0;
      check("quality: reports → system health renders a check table", !!hpPanel && hpRows >= 7, hpPanel ? "rows=" + hpRows : "no panel");
      await ERP.navigate("dashboard");

      /* ── 11. Fixture round-trips for every module document ── */
      mark("11 fixture round-trips");
      for (const mod of Object.keys(Q.FIXTURES.docs)) {
        const recs = Q.FIXTURES.docs[mod]();
        const saveRes = await store.saveDoc(mod, recs);
        check("quality: fixture saves " + mod, !saveRes.error, saveRes.error || "ok");
        const ld = await store.loadDoc(mod, { all: true });
        const back = (ld.records || []).slice();
        check("quality: fixture round-trips " + mod, JSON.stringify(back) === JSON.stringify(recs), back.length + " vs " + recs.length);
      }
    } catch (e) {
      check("quality: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      Q.setAuto(false);
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      try { if (typeof Q.setAuto === "function") Q.setAuto(autoWas); } catch (e) {}
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     ERPTeamTest (Tasks 41–44)
     Run via page_eval:  await window.ERPTeamTest()
     Exercises the multi-user hub client (ERP.team) against a
     deterministic in-memory hub that mirrors the index.html
     server protocol: hello/role bootstrap, server-authorised
     role enforcement (T.guard), admin unlock, signed + denied
     audit entries through master.audit, live-change fan-out
     (chg → re-sync from the canonical store), the announce hook
     on committed writes, and graceful offline degradation.
     ============================================================ */

  window.ERPTeamTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const ui = ERP.ui;
    const F = ERP.finance;
    const S = ERP.sales;
    const P = ERP.purchasing;
    const I = ERP.inventory;
    const T = ERP.team;
    const mark = (s) => { if (opts.debug) console.log("[ERPTeamTest]", s); };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    function makeServer() {
      const files = {};
      return {
        files,
        async get(name) { return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json) {
          const prev = files[name];
          files[name] = json;
          return { created: prev === undefined, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    /* In-memory hub mirroring the index.html server protocol. */
    function makeMockHub() {
      const users = new Map();
      users.set("bob", { displayName: "Bob", role: 1, admin: false });
      users.set("alice", { displayName: "Alice", role: 2, admin: false });
      users.set("carol", { displayName: "Carol", role: 0, admin: false });
      const ring = [];
      const versionIndex = new Map();
      const announced = [];
      let connUser = null;
      let seq = 0;
      const ADMIN = "0HTZkeVJAVsDCeqT1FYgwjJ2x1XN6xfG";
      const ACT_ROLES = { post_journal: 1, reverse_journal: 1, receive_payment: 1, bank_entry: 1, clear_bank: 1, close_period: 1, reopen_period: 1, chart_update: 1, pay_bill: 1, restore_backup: 1, publish_backup: 1, archive_doc: 1, settings_update: 1, tax_update: 1, credit_note: 0, invoice_from_order: 0 };
      const classify = (a) => (ACT_ROLES[a] === undefined ? 2 : ACT_ROLES[a]);
      const roleName = (r) => (r === 2 ? "owner" : r === 1 ? "manager" : "staff");
      const transport = {
        rpc(method, dataStr) {
          const data = JSON.parse(dataStr || "{}");
          const u = () => (connUser ? users.get(connUser) : null);
          const auth = () => ({ ok: true });
          let out;
          if (method === "hello") {
            if (!/^[0-9a-f]{32}$/.test(data.userId)) out = { ok: false, err: "bad_id" };
            else {
              if (!users.has(data.userId)) users.set(data.userId, { displayName: data.displayName || "User", role: 0, admin: false });
              const x = users.get(data.userId);
              x.displayName = data.displayName || x.displayName;
              connUser = data.userId;
              transport.deliver({ t: "pres", u: data.userId, n: x.displayName, r: x.role, on: true });
              out = { ok: true, userId: data.userId, displayName: x.displayName, role: x.role, users: Array.from(users.values()) };
            }
          } else if (!connUser) out = { ok: false, err: "hello_first" };
          else if (method === "whoami") { const x = u(); out = { ok: true, userId: connUser, displayName: x.displayName, role: x.role, admin: !!x.admin }; }
          else if (method === "peers") { out = { ok: true, peers: Array.from(users.entries()).map(([id, x]) => ({ userId: id, displayName: x.displayName, role: x.role, admin: !!x.admin })) }; }
          else if (method === "authAdmin") {
            if (data.password !== ADMIN) out = { ok: false, err: "bad_password" };
            else { const x = u(); x.admin = true; x.role = 2; transport.deliver({ t: "role", u: connUser, r: 2, n: x.displayName, on: true }); out = { ok: true, role: 2, admin: true }; }
          } else if (method === "setRole") {
            if (u().role !== 2) out = { ok: false, err: "unauthorized" };
            else {
              const t = users.get(data.userId);
              const r = Number(data.role);
              if (!t) out = { ok: false, err: "no_user" };
              else if (r !== 0 && r !== 1 && r !== 2) out = { ok: false, err: "bad_role" };
              else { t.role = r; transport.deliver({ t: "role", u: data.userId, r }); out = { ok: true }; }
            }
          } else if (method === "removeUser") {
            if (u().role !== 2) out = { ok: false, err: "unauthorized" };
            else if (data.userId === connUser) out = { ok: false, err: "self" };
            else if (!users.has(data.userId)) out = { ok: false, err: "no_user" };
            else { users.delete(data.userId); out = { ok: true }; }
          } else if (method === "listUsers") {
            if (u().role !== 2) out = { ok: false, err: "unauthorized" };
            else out = { ok: true, users: Array.from(users.entries()).map(([id, x]) => ({ userId: id, displayName: x.displayName, role: x.role, lastSeen: 1, online: true })) };
          } else if (method === "authorize") {
            const need = classify(data.action);
            if (u().role < need) out = { ok: false, required: need, requiredRole: roleName(need) };
            else out = { ok: true };
          } else if (method === "approve") {
            const x = u();
            const need = classify(data.action);
            if (x.role < need) out = { ok: false, denied: true, reason: "requires the " + roleName(need) + " role", requiredRole: roleName(need) };
            else {
              seq++;
              const entry = { id: seq, ts: new Date().toISOString(), actor: x.displayName, userId: connUser, role: x.role, action: data.action, summary: data.summary || "", targetType: data.targetType || "", targetId: data.targetId == null ? null : String(data.targetId) };
              ring.push({ seq, ts: Date.now() / 1000 | 0, role: x.role, user: connUser, action: data.action });
              if (need >= 1) transport.deliver({ t: "audit", s: seq });
              out = { ok: true, entry };
            }
          } else if (method === "announce") {
            if (data.doc.length > 64 || !/^erp-v1-[a-z0-9-]+$/.test(data.doc)) out = { ok: false, err: "bad_doc" };
            else {
              const x = u();
              versionIndex.set(data.doc, { rev: data.rev, u: connUser, n: x.displayName, ts: Date.now() / 1000 | 0 });
              announced.push({ doc: data.doc, rev: data.rev, user: connUser });
              transport.deliver({ t: "chg", d: data.doc, r: data.rev, u: connUser, n: x.displayName, ts: Date.now() / 1000 | 0 });
              out = { ok: true };
            }
          } else if (method === "index") {
            out = { ok: true, index: Array.from(versionIndex.entries()).map(([d, v]) => ({ d, r: v.rev, u: v.u, n: v.n, ts: v.ts })) };
          } else if (method === "auditTail") {
            if (u().role !== 2) out = { ok: false, err: "unauthorized" };
            else out = { ok: true, entries: ring.slice(-(data.limit || 100)) };
          } else out = { ok: false, err: "no_method" };
          return Promise.resolve(JSON.stringify(out));
        },
        open() { if (typeof transport.onopen === "function") transport.onopen(); },
        deliver(obj) { if (typeof transport.onmessage === "function") transport.onmessage(JSON.stringify(obj)); },
      };
      return { transport, users, ring, versionIndex, announced };
    }

    try {
      const srv = makeServer();
      const hub = makeMockHub();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();
      await master.seed();
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();
      ERP.role = "owner";
      try { localStorage.setItem("erp.team.name.v1", "Tester"); } catch (e) {}

      /* ── 1. Connect & server-authorised role bootstrap ── */
      mark("1 hello + role bootstrap");
      T.setTransport(hub.transport);
      await sleep(350);
      check("team: mock hub reports online status", T.status === "online", "status=" + T.status);
      check("team: realtime disabled while a test/restore backend is active", T.online === false, "online=" + T.online);
      check("team: new device is registered as staff", T.me && T.me.role === 0, JSON.stringify(T.me));
      check("team: server role overrides the local role", ERP.role === "staff", "role=" + ERP.role);
      check("team: role selector locked while hub online", (() => { const s = document.querySelector("#roleSelect"); return s && s.disabled === true; })());

      /* ── 2. Guard enforcement (server-side roles) ── */
      mark("2 guard enforcement");
      let den = null;
      try { await T.guard("close_period"); } catch (e) { den = e; }
      check("team: staff guard rejects a manager action", !!den && /manager/.test(den.message), den && den.message);
      let g1 = true;
      try { await T.guard("post_journal"); } catch (e) { g1 = false; }
      check("team: staff guard rejects a manager action", g1 === false);
      let g2 = true;
      try { await T.guard("credit_note"); } catch (e) { g2 = false; }
      check("team: staff guard allows a staff action", g2 === true);

      /* ── 3. Admin unlock → owner ── */
      mark("3 admin unlock");
      const au = await T.authAdmin("0HTZkeVJAVsDCeqT1FYgwjJ2x1XN6xfG");
      check("team: owner password unlocks the connection", au.ok === true && T.me && T.me.role === 2 && T.me.admin === true, JSON.stringify(au));
      check("team: unlock promotes the local role to owner", ERP.role === "owner");
      const bad = await T.authAdmin("wrong");
      check("team: wrong password rejected", bad.ok === false && bad.err === "bad_password", JSON.stringify(bad));
      let g3 = true;
      try { await T.guard("close_period"); } catch (e) { g3 = false; }
      check("team: owner guard passes", g3 === true);

      /* ── 4. Owner registry management ── */
      mark("4 owner registry management");
      const sr1 = await T.setRole("bob", "staff");
      check("team: owner demotes a manager", sr1.ok === true && hub.users.get("bob").role === 0, JSON.stringify(sr1));
      const sr2 = await T.setRole("carol", "owner");
      check("team: owner promotes staff to owner", sr2.ok === true && hub.users.get("carol").role === 2);
      const lu = await T.listUsers();
      check("team: owner lists the registry", lu.ok === true && lu.users.length >= 3, lu.ok ? String(lu.users.length) : JSON.stringify(lu));
      const rm = await T.removeUser("carol");
      check("team: owner removes a user", rm.ok === true && !hub.users.has("carol"));

      /* ── 5. Signed audit entries through master.audit ── */
      mark("5 signed + denied audit");
      await master.audit({ action: "post_journal", targetType: "journal", targetId: 123, summary: "Signed test entry" });
      const alog = await master.auditLog({ all: true });
      const last = alog[alog.length - 1];
      check("team: audit entry signed by the hub", !!last && last.verified === true && last.action === "post_journal" && typeof last.id === "number" && last.id > 0, JSON.stringify(last));
      check("team: signed actor is the hub identity", !!last && last.actor === "Tester", last && last.actor);
      const tail = await T.auditTail(50);
      check("team: server audit ring recorded the signed action", tail.ok === true && tail.entries.some((a) => a.seq === last.id), JSON.stringify(tail));

      /* demote our own connection, then a sensitive audit must be denied */
      await T.setRole(T.me.userId, "staff");
      await sleep(80);
      check("team: hub demotes the active connection live", T.me.role === 0 && ERP.role === "staff", "role=" + ERP.role);
      await master.audit({ action: "close_period", targetType: "period", targetId: "2025-06", summary: "Should be denied" });
      const alog2 = await master.auditLog({ all: true });
      const last2 = alog2[alog2.length - 1];
      check("team: denied action recorded as denied:<action>", !!last2 && last2.action === "denied:close_period", last2 && last2.action);
      check("team: denied summary explains the rejection", !!last2 && /Rejected by the team server/.test(last2.summary || ""), last2 && last2.summary);
      await T.authAdmin("0HTZkeVJAVsDCeqT1FYgwjJ2x1XN6xfG");

      /* ── 6. Live-change fan-out re-syncs from the canonical store ── */
      mark("6 live change fan-out");
      await master.saveParties([{ id: 1, name: "Acme Corp", type: "customer", contacts: [], notes: "" }]);
      const partiesName = store.docName("parties", null);
      const raw = JSON.parse(srv.files[partiesName]);
      raw.rev = (raw.rev || 0) + 1;
      raw.updatedBy = "Bob";
      srv.files[partiesName] = JSON.stringify(raw);
      hub.transport.deliver({ t: "chg", d: partiesName, r: raw.rev, u: "bob", n: "Bob", ts: Date.now() / 1000 | 0 });
      await sleep(900);
      const cc = store.cachedDoc(partiesName);
      check("team: chg event re-syncs the document", cc && cc.rev === raw.rev, "rev=" + (cc && cc.rev) + " expected=" + raw.rev);

      /* ── 7. Committed writes announce the new version ── */
      mark("7 announce hook");
      const beforeAnn = hub.announced.length;
      await master.saveParties([{ id: 1, name: "Acme Corp", type: "customer", contacts: [], notes: "" }, { id: 2, name: "Globex", type: "supplier", contacts: [], notes: "" }]);
      const announced = hub.announced.slice(beforeAnn);
      check("team: committed write announces the doc version", announced.some((a) => a.doc === partiesName && a.rev >= 2), JSON.stringify(announced));

      /* ── 8. Graceful offline degradation ── */
      mark("8 offline degradation");
      T.setTransport(null);
      check("team: offline after disconnect", T.status === "offline" && T.online === false);
      let offDen = null;
      try { await T.guard("close_period"); } catch (e) { offDen = e; }
      check("team: guard no-ops when offline (local mode)", offDen === null);
      let posted = null;
      try {
        posted = await F.postJournal({ date: ui.today(), memo: "offline test", source: "manual", lines: [{ account: "1000", debit: 10, credit: 0 }, { account: "4000", debit: 0, credit: 10 }] });
      } catch (e) { posted = { error: e }; }
      check("team: manual journal posts while offline", !!posted && !posted.error && posted.kind === "journal", JSON.stringify(posted && (posted.error || posted.kind)));
    } catch (e) {
      check("team: test harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { T.setTransport(null); } catch (e) {}
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
      ERP.role = "owner";
      F.invalidate(); S.invalidate(); P.invalidate(); I.invalidate();
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };

  /* ============================================================
     Store self-heal test — editable edit-key recovery (Phase 10)
     Run via page_eval:  await window.ERPRecoveryTest()
     Simulates a canonical file that exists server-side while the
     local edit key was lost (localStorage cleared while the server
     copy stayed). The next write must adopt a fresh editable name,
     remember it as an alias, and keep working thereafter.
     ============================================================ */

  window.ERPRecoveryTest = async function (opts) {
    opts = opts || {};
    results.length = 0;
    const ERP = window.ERP;
    const store = ERP.store;
    const master = ERP.master;
    const mark = (s) => { if (opts.debug) console.log("[ERPRecoveryTest]", s); };
    const uid = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    function makeServer() {
      const files = {};
      const calls = [];
      return {
        files, calls,
        async get(name) { calls.push(["get", name]); return Object.prototype.hasOwnProperty.call(files, name) ? files[name] : null; },
        async set(name, json, o) {
          calls.push(["set", name, !!(o && o.editKey)]);
          const prev = files[name];
          if (prev !== undefined && !(o && o.editKey)) return { created: false, unchanged: false, editKey: null, superseded: false, error: "edit_key_required" };
          const created = prev === undefined;
          files[name] = json;
          return { created, unchanged: prev === json, editKey: "k_" + name, superseded: false, error: null };
        },
      };
    }

    try {
      const srv = makeServer();
      store.useBackend(srv);
      store.resetAllLocal();
      master.flush();

      const name = "erp-v1-recovery-" + uid;

      /* ── 1. Create normally (key issued + cached) ── */
      mark("1 create");
      const r1 = await store.set(name, [{ id: 1 }]);
      check("recovery: initial create succeeds", !r1.error && r1.rev >= 1, JSON.stringify(r1 && (r1.error || r1.rev)));
      check("recovery: edit key cached locally", !!localStorage.getItem("erp.store.v1.keys." + name));

      /* ── 2. Lost key: only the edit key is gone (base/cache intact) ── */
      mark("2 lost key");
      localStorage.removeItem("erp.store.v1.keys." + name);
      localStorage.removeItem("erp.store.v1.alias." + name);
      const r2 = await store.set(name, [{ id: 1 }, { id: 2 }]);
      check("recovery: write with a lost key self-heals instead of erroring", !r2.error, JSON.stringify(r2));
      const alias = localStorage.getItem("erp.store.v1.alias." + name);
      check("recovery: alias recorded", !!alias && alias !== name, String(alias));
      check("recovery: fresh editable name created remotely", !!alias && Object.prototype.hasOwnProperty.call(srv.files, alias));
      check("recovery: key for fresh name cached", !!localStorage.getItem("erp.store.v1.keys." + alias));

      /* ── 3. Reads route through the alias ── */
      mark("3 alias read");
      const rA = await store.readCanonical(name);
      const rB = await store.readCanonical(alias);
      const recs = (rA.doc && rA.doc.records) || [];
      check("recovery: reads route through the alias", !rA.error && recs.some((r) => r.id === 2), JSON.stringify(recs));
      check("recovery: alias and fresh name expose the same doc", !rA.error && !rB.error && JSON.stringify(rA.doc.records) === JSON.stringify(rB.doc.records));

      /* ── 4. Steady state: next write targets the alias, no re-recovery ── */
      mark("4 steady state");
      const r3 = await store.set(name, [{ id: 1 }, { id: 2 }, { id: 3 }]);
      check("recovery: next write succeeds", !r3.error, JSON.stringify(r3));
      check("recovery: orphaned original file untouched", srv.files[name] && (JSON.parse(srv.files[name]).records || []).length === 1);
      check("recovery: content persisted through the alias", srv.files[alias] && (JSON.parse(srv.files[alias]).records || []).some((r) => r.id === 3));
      const rC = await store.readCanonical(name);
      check("recovery: alias read returns latest content", (rC.doc.records || []).some((r) => r.id === 3));

      /* ── 5. Teardown ── */
      localStorage.removeItem("erp.store.v1.keys." + name);
      localStorage.removeItem("erp.store.v1.alias." + name);
      localStorage.removeItem("erp.store.v1.base." + name);
    } catch (e) {
      check("recovery: harness did not crash", false, (e && e.stack) || String(e));
    } finally {
      try { store.useBackend(null); } catch (e) {}
      try { store.resetAllLocal(); } catch (e) {}
      try { master.flush(); } catch (e) {}
    }

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    return { passed, failed, results };
  };
})();
