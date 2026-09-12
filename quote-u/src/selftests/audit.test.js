(function () {
  const T = window.QU_SELFTEST;
  const A = window.QU_AUDIT;
  const QS = window.QU_STORE;
  if (!T || !A || !QS) return;

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
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
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeStore(backend, ns, modules) {
    backend = backend || makeBackend();
    const kv = makeKv(backend.kvStore);
    const editable = makeEditable(backend.files);
    const store = QS.create({ ns: ns || "a" + QS.randHex(6), kv, editable, modules: modules || ["quote_events"] });
    return { store, ns: store.ns, kv, kvStore: backend.kvStore, editable, files: backend.files, backend };
  }

  function makeService(backend) {
    const env = makeStore(backend);
    return Object.assign(env, { svc: A.createService({ store: env.store }) });
  }

  // A fully valid base record, so fake-store tests don't depend on buildRecord.
  function baseRecord(over) {
    return Object.assign({
      quote_id: "q1", version_id: "v1", event: "created", actor_type: "system", actor: "system",
      token_id: null, ip: null, user_agent: null, detail: {}, at: "2026-01-01T00:00:00.000Z",
      seq: 1, id: "ev-base", prev_hash: A.GENESIS_HASH, hash: "h1"
    }, over || {});
  }

  T.register("audit: the catalog covers every required lifecycle and external event", () => {
    const bad = [];
    const required = [
      "created", "revised", "sent", "viewed", "option_changed", "approved", "declined", "expired", "link_revoked",
      "opp_created", "opp_updated", "note_written", "email_sent", "invoice_created", "invoice_reconciled", "products_written", "bus_published", "error"
    ];
    for (const e of required) if (!A.isEvent(e)) bad.push("missing " + e);
    if (A.isEvent("frozen")) bad.push("accepted an unknown event");
    if (A.eventCategory("approved") !== "lifecycle") bad.push("approved category");
    if (A.eventCategory("invoice_created") !== "external") bad.push("invoice category");
    if (A.eventCategory("invoice_reconciled") !== "external") bad.push("invoice_reconciled category");
    if (A.eventCategory("option_changed") !== "lifecycle") bad.push("option_changed category");
    const externalRequired = required.filter(e => A.eventCategory(e) === "external");
    if (A.events("external").length !== externalRequired.length) bad.push("external count " + A.events("external").length + " vs required " + externalRequired.length);
    const L = window.QU_LIFECYCLE;
    if (L) {
      const evs = new Set([L.CREATED_EVENT]);
      for (const s of L.STATES) {
        const row = L.TRANSITIONS[s] || {};
        for (const to of Object.keys(row)) evs.add(row[to]);
      }
      for (const e of evs) if (!A.isEvent(e)) bad.push("lifecycle transition event not recordable: " + e);
    }
    if (!A.acceptedAttrs().actorTypes || A.acceptedAttrs().actorTypes.join(",") !== "internal,portal,system") bad.push("actor types");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: required.length + " required events + every lifecycle transition event" };
  });

  T.register("audit: a sealed record carries the audit shape plus ordering and chain fields", async () => {
    const env = makeService();
    const res = await env.svc.append({
      quote_id: "q1", version_id: "v1", event: "sent", actor_type: "internal", actor: "rep@acme.test",
      ip: "1.2.3.4", user_agent: "UA/1", detail: { note: "hi" }, at: "2026-05-05T00:00:00.000Z"
    });
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    const r = res.record;
    const bad = [];
    for (const k of ["quote_id", "version_id", "event", "actor_type", "actor", "token_id", "ip", "user_agent", "detail", "at"]) {
      if (!(k in r)) bad.push("missing " + k);
    }
    for (const k of ["seq", "id", "prev_hash", "hash"]) if (!(k in r)) bad.push("missing chain field " + k);
    if (r.seq !== 1) bad.push("seq=" + r.seq);
    if (r.prev_hash !== A.GENESIS_HASH) bad.push("first record does not anchor to genesis");
    if (!/^[0-9a-f]{16,64}$/.test(r.hash)) bad.push("hash not hex: " + r.hash);
    if (String(r.id).indexOf("ev-") !== 0) bad.push("id=" + r.id);
    if (r.at !== "2026-05-05T00:00:00.000Z") bad.push("timestamp not preserved");
    if (r.detail.note !== "hi") bad.push("detail dropped");
    if (r.token_id !== null) bad.push("token_id should default to null");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "10 audit fields + seq/id/prev_hash/hash; anchored to genesis" };
  });

  T.register("audit: malformed and secret-bearing events are refused", () => {
    const bad = [];
    const e1 = throws(() => A.normalizeInput({ event: "nope" }), "unknown_event");
    if (e1) bad.push("unknown event: " + e1);
    const e2 = throws(() => A.normalizeInput({ event: "sent", actor_type: "robot" }), "bad_actor");
    if (e2) bad.push("bad actor: " + e2);
    const e3 = throws(() => A.normalizeInput({ event: "sent", actor_type: "portal", actor: "client" }), "portal_needs_token");
    if (e3) bad.push("portal without token: " + e3);
    const e4 = throws(() => A.normalizeInput({ event: "sent", detail: { token: "SECRET-PLAINTEXT" } }), "secret_in_event");
    if (e4) bad.push("detail token: " + e4);
    const e5 = throws(() => A.normalizeInput({ event: "sent", detail: { nested: [{ token_secret: "x" }] } }), "secret_in_event");
    if (e5) bad.push("nested secret: " + e5);
    const e6 = throws(() => A.normalizeInput({ event: "sent", token_secret: "x" }), "secret_in_event");
    if (e6) bad.push("top-level secret: " + e6);
    if (bad.length) return { pass: false, detail: bad.join(" | ") };
    return { pass: true, detail: "unknown events, bad actors, portal-without-token and token secrets all refused" };
  });

  T.register("audit: the log is append-only — records can only be added", async () => {
    const bad = [];
    const r1 = await A.buildRecord([], { event: "created", actor_type: "internal", actor: "rep" }, A.localDigest);
    const r2 = await A.buildRecord([r1], { event: "sent", actor_type: "internal", actor: "rep" }, A.localDigest);
    const r3 = await A.buildRecord([r1, r2], { event: "viewed", actor_type: "portal", actor: "client", token_id: "tk1" }, A.localDigest);
    const log0 = { records: [], meta: {} };
    const log1 = A.appendRecord(log0, r1);
    const log2 = A.appendRecord(log1, r2);
    const log3 = A.appendRecord(log2, r3);
    if (log0.records.length !== 0) bad.push("appendRecord mutated the source log");
    if (log1.records.length !== 1 || log3.records.length !== 3) bad.push("append lost records");
    const grow = A.verifyAppendOnly(log1, log3);
    if (!grow.ok || grow.appended !== 2 || grow.unchanged !== 1) bad.push("growth not verified: " + JSON.stringify(grow));
    const shrink = A.verifyAppendOnly(log3, log1);
    if (shrink.ok || shrink.code !== "log_shrunk") bad.push("removal not detected: " + JSON.stringify(shrink));
    const tampered = { records: [Object.assign({}, r1, { detail: { edited: true } }), r2, r3], meta: {} };
    const rewrite = A.verifyAppendOnly(log3, tampered);
    if (rewrite.ok || rewrite.code !== "log_rewritten") bad.push("edit not detected: " + JSON.stringify(rewrite));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "adds verified; removal and in-place edits both caught" };
  });

  T.register("audit: the hash chain detects a tampered or removed record", async () => {
    const bad = [];
    const r1 = await A.buildRecord([], { event: "created", actor_type: "internal", actor: "rep" }, A.localDigest);
    const r2 = await A.buildRecord([r1], { event: "sent", actor_type: "internal", actor: "rep" }, A.localDigest);
    const r3 = await A.buildRecord([r1, r2], { event: "approved", actor_type: "portal", actor: "client", token_id: "tk1" }, A.localDigest);
    const ok = await A.verifyChain([r1, r2, r3], A.localDigest);
    if (!ok.ok || ok.count !== 3) bad.push("intact log reported broken: " + JSON.stringify(ok.breaks));
    const edited = [r1, Object.assign({}, r2, { detail: { sneaky: true } }), r3];
    const broken = await A.verifyChain(edited, A.localDigest);
    if (broken.ok || !broken.breaks.some(b => b.indexOf("record 2") !== -1)) bad.push("edit not caught: " + JSON.stringify(broken.breaks));
    const removed = [r1, r3];
    const gone = await A.verifyChain(removed, A.localDigest);
    if (gone.ok) bad.push("removal not caught");
    const tail = A.verifyTail([r1, r2, r3]);
    if (!tail.ok) bad.push("tail check failed on a good log: " + JSON.stringify(tail));
    const badTail = A.verifyTail([r1, r2, Object.assign({}, r3, { prev_hash: "deadbeef" })]);
    if (badTail.ok) bad.push("tail check missed a broken link");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "intact chain verifies; edits, removals and broken links all detected" };
  });

  T.register("audit: appending to a log that was rewritten elsewhere is refused", async () => {
    const r1 = baseRecord({ hash: "h1" });
    const rX = baseRecord({ id: "ev-other", hash: "hX", detail: { rewritten: true } });
    const loads = [
      { ok: true, state: "canonical", revision: 1, content: { records: [r1], meta: {} } },
      { ok: true, state: "canonical", revision: 2, content: { records: [rX], meta: {} } }
    ];
    let li = 0;
    let saves = 0;
    const fake = {
      digestHex: s => A.localDigest(s),
      loadDoc: async () => loads[Math.min(li++, loads.length - 1)],
      saveChecked: async () => { saves++; return { ok: false, code: "conflict_stale" }; }
    };
    const res = await A.createService({ store: fake }).append({ event: "sent", actor_type: "internal", actor: "rep" });
    if (res.ok || res.code !== "log_rewritten") return { pass: false, detail: "expected log_rewritten, got " + JSON.stringify(res) };
    if (saves !== 1) return { pass: false, detail: "wrote after detecting the rewrite (saves=" + saves + ")" };
    return { pass: true, detail: "a diverged canonical log blocks the append; nothing overwritten" };
  });

  T.register("audit: a concurrent conflict retries and extends the remote tail", async () => {
    const r1 = baseRecord({ hash: "h1" });
    const r2 = await A.buildRecord([r1], { event: "sent", actor_type: "internal", actor: "rep" }, A.localDigest);
    const loads = [
      { ok: true, state: "canonical", revision: 1, content: { records: [r1], meta: {} } },
      { ok: true, state: "canonical", revision: 2, content: { records: [r1, r2], meta: {} } }
    ];
    let li = 0;
    const saved = [];
    const fake = {
      digestHex: s => A.localDigest(s),
      loadDoc: async () => loads[Math.min(li++, loads.length - 1)],
      saveChecked: async (m, content) => {
        saved.push(content);
        return saved.length === 1 ? { ok: false, code: "conflict" } : { ok: true, revision: 3 };
      }
    };
    const res = await A.createService({ store: fake }).append({ event: "viewed", actor_type: "portal", actor: "client", token_id: "tk1" });
    if (!res.ok) return { pass: false, detail: "append did not recover: " + JSON.stringify(res) };
    if (res.revision !== 3 || res.records_total !== 3) return { pass: false, detail: "bad retry result: " + JSON.stringify(res) };
    const last = saved[saved.length - 1];
    if (!last || last.records.length !== 3 || last.records[0].hash !== "h1" || last.records[1].hash !== r2.hash) {
      return { pass: false, detail: "retry did not preserve the remote tail" };
    }
    if (last.records[2].seq !== 3 || last.records[2].prev_hash !== r2.hash) return { pass: false, detail: "new record not linked to the remote tail" };
    return { pass: true, detail: "conflict retried, remote record preserved, new record linked as seq 3" };
  });

  T.register("audit: external-write events are recorded and categorised", async () => {
    const env = makeService();
    const ext = A.events("external");
    const res = await env.svc.appendMany(ext.map(e => ({ quote_id: "q1", version_id: "v1", event: e, actor_type: "system", detail: { step: e } })));
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    if (res.appended !== ext.length) return { pass: false, detail: "appended " + res.appended + " of " + ext.length };
    const forQ = await env.svc.forQuote("q1");
    if (forQ.records.length !== ext.length) return { pass: false, detail: "stored " + forQ.records.length };
    const s = await env.svc.stats();
    if (s.byCategory.external !== ext.length) return { pass: false, detail: "external category count " + s.byCategory.external };
    if (!s.byEvent.opp_updated || !s.byEvent.invoice_created || !s.byEvent.error) return { pass: false, detail: "missing external events in stats" };
    return { pass: true, detail: ext.length + " external-write events (opp, note, invoice, products, error) recorded" };
  });

  T.register("audit: a lifecycle transition feeds the log unchanged", async () => {
    const L = window.QU_LIFECYCLE;
    if (!L) return { pass: true, skip: true, detail: "no lifecycle module" };
    const env = makeService();
    const applied = L.apply({ id: "v1", quote_id: "q1", state: "draft" }, "sent", {
      actor_type: "internal", actor: "rep@acme.test", ip: "9.9.9.9", user_agent: "UA", at: "2026-02-02T00:00:00.000Z"
    });
    const res = await env.svc.append(A.extractRecord(applied));
    if (!res.ok) return { pass: false, detail: JSON.stringify(res) };
    const r = res.record;
    const bad = [];
    if (r.event !== "sent") bad.push("event=" + r.event);
    if (r.quote_id !== "q1" || r.version_id !== "v1") bad.push("ids not preserved");
    if (r.actor !== "rep@acme.test" || r.actor_type !== "internal") bad.push("actor not preserved");
    if (r.ip !== "9.9.9.9" || r.user_agent !== "UA") bad.push("context not preserved");
    if (r.at !== "2026-02-02T00:00:00.000Z") bad.push("timestamp changed");
    if (!r.hash || r.seq !== 1) bad.push("not sealed");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "lifecycle record stored verbatim, then sealed into the chain" };
  });

  T.register("audit: query filters, ordering and counts", async () => {
    const env = makeService();
    await env.svc.appendMany([
      { quote_id: "q1", version_id: "v1", event: "created", actor_type: "internal", actor: "rep" },
      { quote_id: "q1", version_id: "v1", event: "sent", actor_type: "internal", actor: "rep" },
      { quote_id: "q2", version_id: "v2", event: "created", actor_type: "internal", actor: "rep" },
      { quote_id: "q2", version_id: "v2", event: "viewed", actor_type: "portal", actor: "client", token_id: "tk2" }
    ]);
    const bad = [];
    const q1 = await env.svc.forQuote("q1");
    if (q1.records.length !== 2 || q1.records.some(r => r.quote_id !== "q1")) bad.push("forQuote");
    if (q1.total !== 4) bad.push("forQuote total");
    const v2 = await env.svc.forVersion("v2");
    if (v2.records.length !== 2 || v2.records.some(r => r.version_id !== "v2")) bad.push("forVersion");
    const since = await env.svc.sinceSeq(2);
    if (since.records.length !== 2 || since.records[0].seq !== 3) bad.push("sinceSeq");
    const c = await env.svc.count();
    if (!c.ok || c.count !== 4) bad.push("count");
    const desc = await env.svc.list({ order: "desc", limit: 2 });
    if (desc.records.length !== 2 || desc.records[0].seq !== 4) bad.push("descending/limit");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "quote/version filters, seq paging, ordering and count all correct" };
  });

  T.register("audit: stats summarise the log by event, category and actor", async () => {
    const env = makeService();
    await env.svc.appendMany([
      { quote_id: "q1", version_id: "v1", event: "created", actor_type: "internal", actor: "rep" },
      { quote_id: "q1", version_id: "v1", event: "sent", actor_type: "internal", actor: "rep" },
      { quote_id: "q1", version_id: "v1", event: "approved", actor_type: "portal", actor: "client", token_id: "tk1" },
      { quote_id: "q1", version_id: "v1", event: "invoice_created", actor_type: "system", detail: {} }
    ]);
    const s = await env.svc.stats();
    const bad = [];
    if (s.total !== 4) bad.push("total=" + s.total);
    if (s.byEvent.approved !== 1) bad.push("byEvent.approved");
    if (s.byActor.portal !== 1 || s.byActor.internal !== 2 || s.byActor.system !== 1) bad.push("byActor");
    if (s.byCategory.lifecycle !== 3 || s.byCategory.external !== 1) bad.push("byCategory");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "totals, per-event, per-category and per-actor counts correct" };
  });

  T.register("audit: the log round-trips through the real workspace store (live)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "audit" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.createDefault({ ns, modules: ["quote_events"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const svc = A.createService({ store });
    const res = await svc.append({ quote_id: "live-q", version_id: "live-v", event: "created", actor_type: "internal", actor: "live-test", at: new Date().toISOString() });
    if (res.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (res.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live audit check skipped" };
    if (!res.ok) return { pass: false, detail: "append failed: " + JSON.stringify(res) };
    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    const verified = await svc.verify();
    const finalClean = await folder.entries().catch(() => []);
    for (const pair of finalClean) {
      if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await folder.delete(pair[0]);
    }
    if (!verified.ok) return { pass: false, detail: "chain did not verify after a cache wipe: " + JSON.stringify(verified.breaks) };
    return { pass: true, detail: "appended to the canonical document, wiped the cache, re-read and verified " + verified.count + " record(s)" };
  });
})();
