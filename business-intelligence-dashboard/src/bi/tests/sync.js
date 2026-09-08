/* ============================================================
   BI validation tests — roadmap task 3 (sync, conflict &
   concurrency handling).
   Run via: await BI.runTests("sync")  (page_eval harness).

   Hermetic by design: every scenario runs against a FakeBackend
   (an in-memory replica of upload-plugin editable semantics) under
   isolated localStorage prefixes (bi.store.t*.), and each device is
   a separate prefix + deviceId. The real store cache and the real
   editable host are never touched.

   What is being validated (roadmap task 3):
     - every startup reconcile reconciles the local cache vs the
       canonical docs (reconcile / reconcileAll)
     - a doc edited on two devices since last sync is surfaced as a
       conflict — never silently overwritten, never silently dropped
     - keep-mine / keep-theirs / field-level-merge resolution
     - decisions recorded in the audit trail
     - cross-device discovery of new docs (registry)
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const S = BI.store;

  /* in-memory replica of editable.set/get semantics */
  function FakeBackend() {
    const files = new Map();
    let seq = 0;
    const stats = { reads: 0, creates: 0, updates: 0 };
    return {
      name: "fake",
      stats,
      async create(name, text) {
        stats.creates++;
        if (files.has(name)) return { error: "exists" };
        const editKey = "fk-" + (++seq).toString(16).padStart(6, "0");
        files.set(name, { text, editKey, editCount: 1 });
        return { editKey, editCount: 1 };
      },
      async update(name, text, editKey) {
        stats.updates++;
        const f = files.get(name);
        if (!f) return { error: "not_found" };
        if (!editKey || editKey !== f.editKey) return { error: "invalid_edit_key" };
        if (f.text === text) return { editCount: f.editCount, superseded: true };
        f.text = text; f.editCount += 1;
        return { editCount: f.editCount, superseded: false };
      },
      async read(name) {
        stats.reads++;
        const f = files.get(name);
        return { text: f ? f.text : null };
      },
      _file(name) { return files.get(name) || null; },
    };
  }

  const mk = (id, data) => ({ id, kind: "report", label: id, data: data || { metric: "revenue" } });
  /* order-insensitive deep equality (object key order must not matter) */
  const deepEq = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEq(v, b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
  };

  /* share dev1's edit keys with dev2 (same shared backend) */
  const exportKeysOf = (fb) => {
    const reg = /^bi\.store\.[^.]+\.key\.(.*)$/;
    const keys = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(reg);
      if (m) keys[m[1]] = localStorage.getItem(k);
    }
    return { schema: "bi/editkeys/v1", keys };
  };

  BI.tests.sync = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });
      const fresh = (opts) => {
        const fb = FakeBackend();
        S.debugReset(Object.assign({ backend: fb, ceilingBytes: 65536 }, opts || {}));
        return fb;
      };

      /* ================ Scenario A: fast-forward (one side ahead, no conflict) ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tA1." });
        let r = await S.create(mk("ff", { n: 1 }));
        push("A: dev1 creates doc v1", r.ok && r.envelope.version === 1);
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tA2." });
        S.importEditKeys(keys);
        await S.refresh("ff");
        r = await S.update("ff", { n: 2 });
        push("A: dev2 pushes v2 (same id, second device)", r.ok && r.envelope.version === 2);

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tA1.", wipe: false });
        push("A: dev1 cache still stale v1", S.get("ff").version === 1);
        const rec = await S.reconcile("ff");
        push("A: reconcile fast-forwards to remote v2", rec.state === "fast_forward" && S.get("ff").version === 2 && S.get("ff").data.n === 2, rec.state);
        push("A: no conflict reported", rec.state !== "conflict");
        const aud = S.audit();
        push("A: fast_forward recorded in audit trail", aud.some((e) => e.action === "fast_forward" && e.id === "ff"));
      }

      /* ================ Scenario B: two-device edit since last sync → conflict ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tB1." });
        await S.create(mk("cf", { n: 1 }));
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tB2." });
        S.importEditKeys(keys);
        await S.refresh("cf");
        let r = await S.update("cf", { n: 2 });
        push("B: dev2 edits to v2", r.ok && r.envelope.version === 2);

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tB1.", wipe: false });
        r = await S.update("cf", { n: 3 });
        push("B: dev1's write refused (remote newer), not silently clobbered", !r.ok && r.error.code === "remote_newer" && r.error.conflict === true, r.error && r.error.code);
        push("B: local cache keeps dev1's stale data", S.get("cf").data.n === 1 && S.get("cf").version === 1);
        push("B: parked edit is surfaced as a pending conflict", S.pendingConflicts().some((c) => c.id === "cf" && deepEq(c.pendingData, { n: 3 })), JSON.stringify(S.pendingConflicts()));

        const rec = await S.reconcile("cf");
        push("B: reconcile reports both_sides_changed conflict", rec.state === "conflict" && rec.reason === "both_sides_changed" && rec.local === 1 && rec.remote === 2, rec.reason);
        push("B: reconcile leaves BOTH sides intact", S.get("cf").data.n === 1 && S.pendingConflicts().some((c) => c.id === "cf"));
        push("B: conflict recorded in audit trail", S.audit().some((e) => e.action === "conflict" && e.reason === "both_sides_changed" && e.id === "cf"));
      }

      /* ================ Scenario C: resolve keep-mine ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tC1." });
        await S.create(mk("km", { n: 1 }));
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tC2." });
        S.importEditKeys(keys);
        await S.refresh("km");
        await S.update("km", { n: 2 });

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tC1.", wipe: false });
        await S.update("km", { n: 3 });
        const res = await S.resolve("km", "mine");
        push("C: resolve(mine) pushes dev1's edit on top of remote", res.ok && res.applied === "pushed" && res.envelope.data.n === 3 && res.envelope.version === 3, JSON.stringify(res));
        push("C: conflict cleared after resolution", !S.pendingConflicts().some((c) => c.id === "km"));
        push("C: resolution recorded in audit trail", S.audit().some((e) => e.action === "resolved" && e.id === "km" && e.strategy === "mine" && e.applied === "pushed"));

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tC2.", wipe: false });
        const rr = await S.readRemote("km");
        push("C: second device reads the merged outcome v3/n:3", rr.ok && rr.doc.version === 3 && rr.doc.data.n === 3);
        const rec2 = await S.reconcile("km");
        push("C: second device fast-forwards to v3 cleanly", rec2.state === "fast_forward" && S.get("km").data.n === 3, rec2.state);
      }

      /* ================ Scenario D: resolve keep-theirs ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tD1." });
        await S.create(mk("kt", { n: 1 }));
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tD2." });
        S.importEditKeys(keys);
        await S.refresh("kt");
        await S.update("kt", { n: 2 });

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tD1.", wipe: false });
        await S.update("kt", { n: 3 });
        const res = await S.resolve("kt", "theirs");
        push("D: resolve(theirs) adopts remote, drops local edit", res.ok && res.applied === "adopted_remote" && res.envelope.data.n === 2 && res.envelope.version === 2, JSON.stringify(res));
        push("D: no pending conflict remains", !S.pendingConflicts().some((c) => c.id === "kt"));
        push("D: remote untouched by resolution", (await S.readRemote("kt")).doc.version === 2);
        push("D: theirs resolution recorded in audit trail", S.audit().some((e) => e.action === "resolved" && e.id === "kt" && e.strategy === "theirs"));
      }

      /* ================ Scenario E: field-level merge ================ */
      {
        /* E1 — conflicting field (both changed kpi) merges and reports the conflict */
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tE1." });
        await S.create(mk("fm", { title: "T", filters: { x: 1 }, kpi: "cash" }));
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tE2." });
        S.importEditKeys(keys);
        await S.refresh("fm");
        await S.update("fm", { title: "T2", filters: { x: 2 }, owner: "bob" });

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tE1.", wipe: false });
        await S.update("fm", { title: "T", filters: { x: 1 }, kpi: "gross" });
        const res = await S.resolve("fm", "field");
        const expected = { title: "T2", filters: { x: 2 }, owner: "bob", kpi: "gross" };
        push("E1: field merge combines both sides' edits", res.ok && deepEq(res.envelope.data, expected), JSON.stringify(res.envelope && res.envelope.data));
        push("E1: only the both-sides-changed field is reported", res.ok && deepEq(res.conflicts, ["kpi"]), JSON.stringify(res.conflicts));
        push("E1: merged doc version exceeds both sides", res.ok && res.envelope.version === 3);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tE2." });
        const rr = await S.readRemote("fm");
        push("E1: second device sees merged data + kpi survives", rr.ok && rr.doc.data.kpi === "gross" && rr.doc.data.owner === "bob" && rr.doc.data.title === "T2");

        /* E2 — non-overlapping edits merge cleanly with no conflicts */
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tE3." });
        await S.create(mk("fm2", { title: "T", kpi: "cash" }));
        const keys2 = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tE4." });
        S.importEditKeys(keys2);
        await S.refresh("fm2");
        await S.update("fm2", { title: "T2", kpi: "cash" });

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tE3.", wipe: false });
        await S.update("fm2", { title: "T", kpi: "gross" });
        const res2 = await S.resolve("fm2", "field");
        push("E2: non-overlapping field edits merge with zero conflicts", res2.ok && res2.conflicts.length === 0 && res2.envelope.data.title === "T2" && res2.envelope.data.kpi === "gross", JSON.stringify(res2.conflicts));
      }

      /* ================ Scenario F: cross-device discovery via registry ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tF1." });
        await S.create(mk("rega", { a: 1 }));
        await S.create(mk("regb", { b: 1 }));
        const keys = exportKeysOf(fb);
        const rreg1 = await S.readRemote("_registry");
        push("F: registry lists both docs", rreg1.ok && !!rreg1.doc.data.docs.rega && !!rreg1.doc.data.docs.regb, JSON.stringify(rreg1.doc && rreg1.doc.data));
        push("F: registry excluded from public list()", !S.list().some((e) => e.id === "_registry"));

        /* fresh device with no keys discovers both docs via reconcileAll */
        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tF2." });
        const recAll = await S.reconcileAll();
        push("F: fresh device adopts both discovered docs", recAll.ok && recAll.scanned.filter((s) => s.state === "adopted").length === 2 && !!S.get("rega") && !!S.get("regb"), JSON.stringify(recAll.summary));
        push("F: reconcileAll found zero conflicts", recAll.conflicts.length === 0);

        /* device without registry key can still write its own docs (resilience) */
        let r = await S.create(mk("regc", { c: 1 }));
        push("F: keyless device creates its own doc", r.ok);
        const rreg2 = await S.readRemote("_registry");
        push("F: registry unchanged by keyless device (cannot overwrite other device's registry)", rreg2.ok && !rreg2.doc.data.docs.regc);

        /* after importing keys, the registry is updated and the first device discovers regc */
        S.importEditKeys(keys);
        await S.update("regc", { c: 2 });
        const rreg3 = await S.readRemote("_registry");
        push("F: registry updated once device holds the registry key", rreg3.ok && rreg3.doc.data.docs.regc && rreg3.doc.data.docs.regc.version === 2);

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tF1.", wipe: false });
        const recAll2 = await S.reconcileAll();
        push("F: original device discovers regc on its next reconcile", recAll2.scanned.some((s) => s.id === "regc" && s.state === "adopted") && !!S.get("regc"), JSON.stringify(recAll2.summary));
        push("F: discovery recorded in audit trail", S.audit().some((e) => e.action === "discovered" && e.id === "regc"));
      }

      /* ================ Scenario G: removal propagates via registry + tombstone ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tG1." });
        await S.create(mk("gone2", { x: 1 }));
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tG2." });
        S.importEditKeys(keys);
        await S.reconcileAll();
        push("G: second device has adopted doc", !!S.get("gone2"));

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tG1.", wipe: false });
        await S.remove("gone2");
        const rreg = await S.readRemote("_registry");
        push("G: remove drops doc from the registry", rreg.ok && !rreg.doc.data.docs.gone2);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tG2.", wipe: false });
        const rec = await S.reconcileAll();
        push("G: second device adopts the deletion", rec.scanned.some((s) => s.id === "gone2" && s.state === "adopted_deletion") && S.get("gone2") == null, JSON.stringify(rec.summary));
      }

      /* ================ Scenario H: conflict vs remote deletion + restore ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tH1." });
        await S.create(mk("gone3", { n: 1 }));
        const keys = exportKeysOf(fb);

        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tH2." });
        S.importEditKeys(keys);
        await S.reconcileAll();
        await S.update("gone3", { n: 2 });
        push("H: dev2 holds v2 in its cache", S.get("gone3").version === 2);

        /* dev1 edits while dev3 deletes the doc */
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tH1.", wipe: false });
        await S.update("gone3", { n: 3 });
        push("H: dev1's edit parked", S.pendingConflicts().some((c) => c.id === "gone3"));

        S.debugReset({ backend: fb, deviceId: "dev3", lsPrefix: "bi.store.tH3." });
        S.importEditKeys(keys);
        await S.reconcileAll();
        push("H: dev3 adopts v2 before deleting", S.get("gone3").version === 2);
        await S.remove("gone3");

        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tH1.", wipe: false });
        const rec = await S.reconcile("gone3");
        push("H: local edit vs remote deletion is a surfaced conflict", rec.state === "conflict" && rec.reason === "local_edit_vs_remote_deletion", rec.reason);
        push("H: local edit is NOT dropped by the deletion", S.get("gone3") != null && S.pendingConflicts().some((c) => c.id === "gone3"));

        const res = await S.resolve("gone3", "mine");
        push("H: resolve(mine) restores the doc with dev1's data", res.ok && res.applied === "restored" && res.envelope.data.n === 3 && res.envelope.version === 3, JSON.stringify(res));
        push("H: restored version exceeds the deleted version", res.envelope.version === 3);

        /* dev2 still holds v2 — it must fast-forward to the restored v3, not keep stale data */
        S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tH2.", wipe: false });
        const rr = await S.readRemote("gone3");
        push("H: other device sees the restored doc", rr.ok && !rr.doc.deleted && rr.doc.data.n === 3 && rr.doc.version === 3);
        const rec2 = await S.reconcile("gone3");
        push("H: other device fast-forwards to restored version (no stale data)", rec2.state === "fast_forward" && S.get("gone3").data.n === 3, rec2.state);
      }

      /* ================ Scenario I: localOnly (unsaved) startup ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tI1.", mode: "localOnly" });
        await S.create(mk("loc", { x: 1 }));
        const readsBefore = fb.stats.reads;
        const rec = await S.reconcileAll();
        push("I: localOnly reconcile makes no network calls", rec.ok && rec.summary.localOnly === 1 && fb.stats.reads === readsBefore, JSON.stringify(rec.summary));
        push("I: single-doc reconcile reports localOnly", (await S.reconcile("loc")).state === "localOnly");
        push("I: localOnly reconcile finds no conflicts", rec.conflicts.length === 0);
      }

      /* ================ Scenario J: offline doc promoted once saved ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tJ1.", mode: "localOnly" });
        await S.create(mk("offline", { x: 1 }));
        push("J: offline doc created locally (status localOnly)", S.list()[0] && S.list()[0].status === "localOnly" && !fb._file(S.docName("offline")));

        /* generator saved: same cache, mode flips to remote (no wipe) */
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tJ1.", wipe: false, mode: "unknown" });
        const rec = await S.reconcile("offline");
        push("J: never-pushed local doc is promoted on reconcile", rec.state === "pushed" && !!fb._file(S.docName("offline")), rec.state);
        push("J: promoted doc now marked synced at v2", S.get("offline").version === 2 && S.list()[0].status === "synced");
      }

      /* ================ Scenario K: no-conflict startup paths ================ */
      {
        const fb = fresh({ deviceId: "dev1", lsPrefix: "bi.store.tK1." });
        await S.create(mk("sync", { s: 1 }));
        const rec = await S.reconcile("sync");
        push("K: unchanged doc reconciles in_sync", rec.state === "in_sync");
        const recNone = await S.reconcile("never-existed");
        push("K: unknown doc reconciles none", recNone.state === "none");
        const recAll = await S.reconcileAll();
        push("K: reconcileAll records a reconcile audit entry", S.audit().some((e) => e.action === "reconcile" && e.scanned === 1), JSON.stringify(S.audit().slice(-3)));
        push("K: reconcileAll over unchanged docs reports in_sync", recAll.summary.in_sync === 1 && recAll.conflicts.length === 0, JSON.stringify(recAll.summary));
      }

      /* restore the app store to a clean default state (real backend, real prefix) */
      S.init();
      return results;
    },
  };
})();
