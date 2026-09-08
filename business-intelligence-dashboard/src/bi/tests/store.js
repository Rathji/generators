/* ============================================================
   BI validation tests — roadmap task 2 (canonical document store).
   Run via: await BI.runTests("store")  (page_eval harness).

   Hermetic by design: every scenario runs against a FakeBackend
   (an in-memory replica of upload-plugin editable semantics) under
   an isolated localStorage prefix (bi.store.tN.), so the real
   store cache and the real editable host are never touched. The
   final scenario is a smoke test against the real backend which
   skips gracefully when the generator is local-only / unsaved.
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
      _simulateRemoteEdit(name, text) { const f = files.get(name); if (!f) return false; f.text = text; f.editCount += 1; return true; },
    };
  }

  const mk = (id, data, extra) => Object.assign({ id, kind: "report", label: id, data: data || { metric: "revenue" } }, extra || {});

  BI.tests.store = {
    async run() {
      const results = [];
      const push = (name, pass, detail) => results.push({ name, pass, detail: detail || "" });
      const fresh = (opts) => {
        const fb = FakeBackend();
        S.debugReset(Object.assign({ backend: fb, ceilingBytes: 65536, lsPrefix: "bi.store.tA." }, opts || {}));
        return fb;
      };

      /* ================ Scenario A: basics ================ */
      let fb = fresh();
      push("init yields device id", /^dev-[0-9a-f]{16}$/.test(S.deviceId()), S.deviceId());
      push("fresh store starts empty", S.list().length === 0 && S.capacity().docCount === 0);

      let r = await S.create(mk("rev", { metric: "revenue", period: "2026-Q3" }));
      push("create returns ok envelope v1", r.ok && r.envelope.version === 1 && r.envelope.schema === "bi/doc/v1", "v" + (r.envelope && r.envelope.version));
      push("envelope carries id/kind/label/data", r.ok && r.envelope.id === "rev" && r.envelope.kind === "report" && r.envelope.label === "rev" && r.envelope.data.metric === "revenue");
      push("createdAt equals updatedAt on create", r.ok && r.envelope.createdAt === r.envelope.updatedAt);
      push("create writes to backend", fb._file(S.docName("rev")) != null, S.docName("rev"));
      push("create flips mode to remote", S.storageMode() === "remote", S.storageMode());

      const readsBefore = fb.stats.reads;
      const cached = S.get("rev");
      push("get() serves from fast local cache", cached && cached.data.metric === "revenue" && fb.stats.reads === readsBefore, "backend reads " + readsBefore + " -> " + fb.stats.reads);

      r = await S.create(mk("rev", { metric: "revenue" }));
      push("create with existing id fails", !r.ok && r.error.code === "exists", r.error && r.error.code);
      r = await S.create(mk("Bad Id", {}));
      push("invalid id rejected", !r.ok && r.error.code === "invalid_id", r.error && r.error.code);
      r = await S.create(mk("nope", {}, { kind: "bogus" }));
      push("invalid kind rejected", !r.ok && r.error.code === "invalid_kind", r.error && r.error.code);
      push("list shows created doc", S.list().some((e) => e.id === "rev" && e.status === "synced"), JSON.stringify(S.list()));

      /* ================ Scenario B: update / version / idempotency ================ */
      const v1 = S.get("rev").version;
      const t1 = S.get("rev").updatedAt;
      await new Promise((res) => setTimeout(res, 5));
      r = await S.update("rev", { metric: "expenses", total: 42000 });
      push("update replaces data and bumps version", r.ok && r.changed && r.envelope.version === v1 + 1, "v" + v1 + " -> v" + r.envelope.version);
      push("update changes updatedAt, keeps createdAt", r.ok && r.envelope.updatedAt !== t1 && r.envelope.createdAt === S.get("rev").createdAt, "");
      push("update advances backend edit count", fb._file(S.docName("rev")).editCount === 2, "editCount " + fb._file(S.docName("rev")).editCount);
      push("update preserves kind", r.ok && r.envelope.kind === "report");

      const editsBefore = fb.stats.updates;
      r = await S.update("rev", { metric: "expenses", total: 42000 });
      push("identical update is an idempotent no-op", r.ok && r.changed === false && r.envelope.version === v1 + 1, "changed=" + r.changed);
      push("no-op makes no backend write", fb.stats.updates === editsBefore, "updates " + editsBefore + " -> " + fb.stats.updates);

      r = await S.update("rev", { metric: "cash" }, { baseVersion: 1 });
      push("update with stale baseVersion conflicts", !r.ok && r.error.code === "version_conflict", r.error && r.error.code);
      r = await S.update("rev", { metric: "cash" }, { baseVersion: S.get("rev").version });
      push("update with matching baseVersion succeeds", r.ok && r.changed && r.envelope.data.metric === "cash");
      r = await S.update("missing-doc", { x: 1 });
      push("update on unknown id fails", !r.ok && r.error.code === "not_found", r.error && r.error.code);

      /* ================ Scenario C: storage ceiling ================ */
      fresh({ ceilingBytes: 300, lsPrefix: "bi.store.tC." });
      r = await S.create(mk("tiny", { a: "x" }));
      push("small doc fits under ceiling", r.ok, r.error && r.error.code);
      r = await S.create(mk("huge", { blob: "z".repeat(900) }));
      push("oversized create refused by ceiling", !r.ok && r.error.code === "quota_exceeded", r.error && r.error.code);
      push("used bytes never exceed ceiling", S.capacity().usedBytes <= 300, "used " + S.capacity().usedBytes);
      r = await S.update("tiny", { blob: "y".repeat(900) });
      push("oversized update refused by ceiling", !r.ok && r.error.code === "quota_exceeded", r.error && r.error.code);
      push("capacity reports per-doc sizes", S.capacity().docs.length === 1 && S.capacity().docs[0].id === "tiny", JSON.stringify(S.capacity().docs));

      /* ================ Scenario D: second device / edit keys ================ */
      fb = FakeBackend();
      S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tD1.", ceilingBytes: 65536 });
      r = await S.create(mk("shared", { plan: 1 }));
      const exported = S.exportEditKeys();
      push("exportEditKeys carries doc key", !!exported.keys.shared && exported.schema === "bi/editkeys/v1", Object.keys(exported.keys).join(","));

      S.debugReset({ backend: fb, deviceId: "dev2", lsPrefix: "bi.store.tD2.", ceilingBytes: 65536 });
      const rr = await S.readRemote("shared");
      push("fresh device reads canonical doc by name", rr.ok && rr.doc && rr.doc.version === 1 && rr.doc.data.plan === 1, rr.error && rr.error.code);
      r = await S.refresh("shared");
      push("refresh populates local cache on fresh device", r.ok && !!S.get("shared"));
      r = await S.update("shared", { plan: 2 });
      push("fresh device cannot write without edit key", !r.ok && r.error.code === "need_edit_key", r.error && r.error.code);

      r = S.importEditKeys({ schema: "bi/editkeys/v1", keys: { shared: exported.keys.shared } });
      push("importEditKeys installs key", r.ok && r.imported === 1);
      r = await S.update("shared", { plan: 2 });
      push("write succeeds after importing key", r.ok && r.changed && r.envelope.version === 2 && r.envelope.data.plan === 2, r.error && r.error.code);

      r = S.importEditKeys({ schema: "bogus", keys: {} });
      push("importEditKeys rejects wrong schema", !r.ok && r.error.code === "invalid_keys", r.error && r.error.code);
      r = S.importEditKeys({ schema: "bi/editkeys/v1", keys: { shared: "wrong-key" } });
      r = await S.update("shared", { plan: 3 });
      push("wrong key surfaces invalid_edit_key", !r.ok && r.error.code === "invalid_edit_key", r.error && (r.error.code + ": " + r.error.message));

      /* ================ Scenario E: remote-newer guard ================ */
      fb = FakeBackend();
      S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tE1.", ceilingBytes: 65536 });
      await S.create(mk("gated", { n: 1 })); /* dev1: v1, key cached */
      const g1 = S.get("gated");
      const remoteV2 = JSON.stringify(Object.assign({}, g1, { version: 2, data: { n: 2 }, updatedAt: new Date().toISOString(), updatedByDevice: "devX" }));
      fb._simulateRemoteEdit(S.docName("gated"), remoteV2);
      push("simulated other-device edit lands on backend", fb._file(S.docName("gated")).editCount === 2, "editCount " + fb._file(S.docName("gated")).editCount);
      push("local cache still holds stale v1", S.get("gated").version === 1, "v" + S.get("gated").version);
      r = await S.update("gated", { n: 3 });
      push("refuses to clobber remote-newer doc", !r.ok && r.error.code === "remote_newer", r.error && (r.error.code + ": " + r.error.message));
      r = await S.refresh("gated");
      push("refresh picks up remote v2", r.ok && r.doc.version === 2 && S.get("gated").version === 2, "v" + (r.doc && r.doc.version));
      r = await S.update("gated", { n: 3 });
      push("write succeeds after refresh", r.ok && r.envelope.version === 3, "v" + r.envelope.version);

      /* ================ Scenario F: remove / tombstone ================ */
      fb = FakeBackend();
      S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tF1.", ceilingBytes: 65536 });
      await S.create(mk("gone", { x: 1 }));
      push("edit key cached at create", !!S.exportEditKeys().keys.gone);
      r = await S.remove("gone");
      push("remove succeeds", r.ok && r.removed);
      push("removed doc leaves no local trace", S.get("gone") == null && !S.list().some((e) => e.id === "gone"));
      const rem = await S.readRemote("gone");
      push("remove publishes a tombstone remotely", rem.ok && rem.doc && rem.doc.deleted === true, JSON.stringify(rem.doc));
      push("edit key survives remove", !!S.exportEditKeys().keys.gone);
      r = await S.remove("gone");
      push("removing twice reports not_found", !r.ok && r.error.code === "not_found", r.error && r.error.code);

      /* ================ Scenario G: localOnly (unsaved) mode ================ */
      fb = FakeBackend();
      S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tG1.", ceilingBytes: 65536, mode: "localOnly" });
      r = await S.create(mk("local-doc", { offline: true }));
      push("localOnly create works", r.ok && r.changed);
      push("localOnly makes no backend calls", fb.stats.creates === 0 && fb.stats.updates === 0 && fb.stats.reads === 0, "c" + fb.stats.creates + " u" + fb.stats.updates + " r" + fb.stats.reads);
      push("localOnly doc marked as such", S.list()[0] && S.list()[0].status === "localOnly", S.list()[0] && S.list()[0].status);
      r = await S.update("local-doc", { offline: false, note: "synced later" });
      push("localOnly update bumps version", r.ok && r.envelope.version === 2);

      S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tG2.", ceilingBytes: 300, mode: "localOnly" });
      const aG = await S.create(mk("ok", { s: "x" }));
      const bG = await S.create(mk("big", { s: "y".repeat(500) }));
      push("localOnly still enforces ceiling", aG.ok && !bG.ok && bG.error.code === "quota_exceeded", bG.error && bG.error.code);

      /* ================ Scenario H: corrupt local cache ================ */
      fb = FakeBackend();
      S.debugReset({ backend: fb, deviceId: "dev1", lsPrefix: "bi.store.tH1.", ceilingBytes: 65536 });
      localStorage.setItem("bi.store.tH1.doc.corrupt", "{not valid json!!");
      push("corrupt cache recovered gracefully", S.get("corrupt") == null && S.list().length === 0, "no throw");
      r = await S.create(mk("corrupt", { healed: true }));
      push("create works after cache corruption", r.ok && r.envelope.id === "corrupt");

      /* ================ Scenario I: real-backend smoke ================ */
      if (S.storageMode() === "localOnly") {
        push("real editable smoke — skipped (localOnly/unsaved)", true, "generator unsaved or editable unavailable");
      } else {
        const sid = "smoke-" + Math.random().toString(16).slice(2, 8);
        r = await S.create(mk(sid, { probe: 1 }));
        if (r.ok) {
          const u = await S.update(sid, { probe: 2 });
          await S.remove(sid);
          push("real editable round-trip (create/update/remove)", u.ok && u.changed && u.envelope.version === 2, "v" + u.envelope.version);
        } else {
          push("real editable round-trip (create/update/remove)", false, r.error && (r.error.code + ": " + r.error.message));
        }
      }

      /* restore the app store to a clean default state (real backend, real prefix) */
      S.init();
      return results;
    },
  };
})();
