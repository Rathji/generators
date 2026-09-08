/* ============================================================
   BI validation tests — roadmap task 4 (backup & restore).
   Run via: await BI.runTests("backup")  (page_eval harness).

   Hermetic: every scenario runs against a FakeBackend under an
   isolated localStorage prefix; the real store cache and editable
   host are never touched. The suite re-inits the app store at the
   end.

   Validated:
     - create() builds a schema-correct envelope with all docs
     - validate() accepts a good backup and reports size/docCount
     - validate() rejects bad backups (schema, id, kind, size)
       WITHOUT writing anything
     - restore() is idempotent and version-checked
     - restore() writes nothing when validation fails
     - restore() into a fresh store adopts via create()
     - restoreFromDoc reads a published backup doc
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;
  const S = BI.store;

  function FakeBackend() {
    const files = new Map();
    let seq = 0;
    return {
      async create(name, text) {
        if (files.has(name)) return { error: "exists" };
        const editKey = "fk-" + (++seq).toString(16).padStart(6, "0");
        files.set(name, { text, editKey, editCount: 1 });
        return { editKey, editCount: 1 };
      },
      async update(name, text, editKey) {
        const f = files.get(name);
        if (!f) return { error: "not_found" };
        if (!editKey || editKey !== f.editKey) return { error: "invalid_edit_key" };
        if (f.text === text) return { editCount: f.editCount, superseded: true };
        f.text = text; f.editCount += 1;
        return { editCount: f.editCount, superseded: false };
      },
      async read(name) {
        const f = files.get(name);
        return { text: f ? f.text : null };
      },
      _file(name) { return files.get(name) || null; },
    };
  }

  const mk = (id, data) => ({ id, kind: "report", label: id, data: data || { metric: "revenue", name: id } });
  const deepEq = (a, b) => {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEq(v, b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
  };

  BI.tests.backup = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });

      /* ---------- A: create() envelope ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tBK1.", ceilingBytes: 65536 });
        await S.create(mk("rep-a", { metric: "revenue" }));
        await S.create({ id: "dash-1", kind: "dashboard", label: "D", data: { name: "D", layout: [] } });
        const payload = BI.backup.create();
        push("A: envelope uses schema bi/backup/v1", payload.schema === "bi/backup/v1");
        push("A: docCount matches collected docs", payload.docCount === 2 && payload.docs.length === 2, "count " + payload.docCount);
        push("A: each doc carries id/kind/data", payload.docs.every((d) => d.id && d.kind && d.data && typeof d.data === "object"));
        push("A: envelope includes deviceId + generatedAt", !!payload.deviceId && !!payload.generatedAt);
      }

      /* ---------- B: validate() accepts a good backup ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tBK2.", ceilingBytes: 65536 });
        await S.create(mk("rep-b", { metric: "cash" }));
        const payload = BI.backup.create();
        const v = BI.backup.validate(payload);
        push("B: valid backup validates", v.ok === true && v.docCount === 1);
        push("B: validation reports sizeBytes", v.sizeBytes > 0);
        push("B: validation returns parsed docs", Array.isArray(v.docs) && v.docs.length === 1);
      }

      /* ---------- C: validate() rejects bad backups, writes nothing ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tBK3.", ceilingBytes: 65536 });
        await S.create(mk("rep-c", { metric: "revenue" }));
        const before = S.list().length;

        let v = BI.backup.validate({ schema: "nope/v9", docs: [] });
        push("C: wrong schema rejected", !v.ok && v.error.code === "invalid_backup");
        push("C: non-object rejected", !BI.backup.validate(null).ok && !BI.backup.validate("string").ok);

        const good = BI.backup.create();
        const badId = { ...good, docs: [{ id: "BAD ID!", kind: "report", data: {} }] };
        v = BI.backup.validate(badId);
        push("C: invalid doc id rejected", !v.ok && v.error.code === "backup_invalid_doc");

        const badKind = { ...good, docs: [{ id: "doc-1", kind: "gremlin", data: {} }] };
        v = BI.backup.validate(badKind);
        push("C: invalid kind rejected", !v.ok && v.error.code === "backup_invalid_doc");

        const noData = { ...good, docs: [{ id: "doc-1", kind: "report" }] };
        v = BI.backup.validate(noData);
        push("C: doc without data rejected", !v.ok && v.error.code === "backup_invalid_doc");

        const big = { ...good, docs: [{ id: "doc-big", kind: "report", data: { blob: "x".repeat(70000) } }] };
        v = BI.backup.validate(big);
        push("C: oversized restore rejected vs ceiling", !v.ok && v.error.code === "backup_invalid_doc", v.error && v.error.message);

        push("C: store unchanged after all bad validations", S.list().length === before);
      }

      /* ---------- D: restore() idempotent + version-checked ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tBK4.", ceilingBytes: 65536 });
        await S.create(mk("rep-d", { metric: "revenue", v: 1 }));
        const payload = BI.backup.create();

        const r1 = await BI.backup.restore(payload);
        push("D: restore succeeds", r1.ok && (r1.summary.restored + r1.summary.idempotent) >= 1, JSON.stringify(r1.summary));
        push("D: restore is idempotent on second pass", (await BI.backup.restore(payload)).summary.idempotent >= 1, JSON.stringify((await BI.backup.restore(payload)).summary));

        /* a remote-newer doc is protected unless force */
        await S.update("rep-d", { metric: "revenue", v: 2 });
        const r3 = await BI.backup.restore(payload);
        push("D: restore over newer local edit reports an error (not silently clobbered)", !r3.ok || r3.summary.errors.length > 0, JSON.stringify(r3.summary));
        const r4 = await BI.backup.restore(payload, { force: true });
        push("D: force restore overwrites the newer edit", r4.ok && r4.summary.restored >= 1, JSON.stringify(r4.summary));
        push("D: restored data matches backup payload", deepEq(S.get("rep-d").data, { metric: "revenue", v: 1 }));
      }

      /* ---------- E: restore() writes nothing on failed validation ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tBK5.", ceilingBytes: 65536 });
        await S.create(mk("rep-e", { metric: "revenue" }));
        const before = JSON.stringify(S.list());
        const r = await BI.backup.restore({ schema: "bogus", docs: [{ id: "evil", kind: "report", data: {} }] });
        push("E: failed-validation restore returns not ok", !r.ok);
        push("E: nothing written on failed restore", JSON.stringify(S.list()) === before && !S.get("evil"));
      }

      /* ---------- F: restore into a fresh store adopts via create() ---------- */
      {
        const src = FakeBackend();
        S.debugReset({ backend: src, deviceId: "dev2", lsPrefix: "bi.store.tBK6.", ceilingBytes: 65536 });
        await S.create(mk("rep-f", { metric: "revenue", tag: "orig" }));
        const payload = BI.backup.create();

        const dst = FakeBackend();
        S.debugReset({ backend: dst, deviceId: "dev3", lsPrefix: "bi.store.tBK7.", ceilingBytes: 65536 });
        const r = await BI.backup.restore(payload);
        push("F: fresh device restores the doc", r.ok && !!S.get("rep-f"), JSON.stringify(r.summary));
        push("F: restored data survives cross-device", deepEq(S.get("rep-f").data, { metric: "revenue", tag: "orig" }));
      }

      /* ---------- G: restoreFromDoc ---------- */
      {
        const fb = FakeBackend();
        S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tBK8.", ceilingBytes: 65536 });
        await S.create(mk("rep-g", { metric: "cash" }));
        const pub = await BI.backup.publish();
        push("G: publish creates a backup doc", pub.ok && !!pub.id && S.get(pub.id).kind === "backup", pub.error && pub.error.code);
        const rr = await BI.backup.restoreFromDoc(pub.id);
        push("G: restoreFromDoc restores from the published doc", rr.ok && (rr.summary.restored + rr.summary.idempotent) >= 1, JSON.stringify(rr.summary));
        const bad = await BI.backup.restoreFromDoc("no-such-backup");
        push("G: restoreFromDoc rejects unknown ids", !bad.ok && bad.error.code === "not_found");
      }

      /* restore the app store to a clean default state */
      S.init();
      return results;
    },
  };
})();
