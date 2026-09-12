(function () {
  const T = window.QU_SELFTEST;
  const N = window.QU_NUMBERING;
  const QS = window.QU_STORE;
  if (!T || !N || !QS) return;

  const AT26 = "2026-01-02T03:04:05.000Z";
  const AT27 = "2027-01-02T03:04:05.000Z";

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
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

  function makeStore(ns) {
    const kvStore = new Map();
    const files = new Map();
    const store = QS.create({ ns: ns || "n" + QS.randHex(6), kv: makeKv(kvStore), editable: makeEditable(files), modules: ["quotes"] });
    return { store, ns: store.ns };
  }

  function svcFor(env) {
    return N.createService({ store: env.store });
  }

  async function writeRecords(env, records) {
    const d = await env.store.loadDoc("quotes");
    return env.store.saveChecked("quotes", Object.assign({}, d.content, { records }), { expectedBase: d.revision });
  }

  T.register("numbering: the scheme parser accepts the default and rejects malformed schemes", () => {
    const bad = [];
    const d = N.normalizeScheme(N.DEFAULT_PATTERN);
    if (d.pattern !== N.DEFAULT_PATTERN) bad.push("default pattern");
    if (d.seqWidth !== 4) bad.push("seqWidth=" + d.seqWidth);
    if (d.tokens.indexOf("YYYY") === -1) bad.push("date tokens not collected");
    if (N.normalizeScheme({ pattern: "Q-{YY}-{##}" }).seqWidth !== 2) bad.push("object form");
    const e1 = throws(() => N.normalizeScheme("QU-{YYYY}"), "bad_scheme"); if (e1) bad.push("no sequence: " + e1);
    const e2 = throws(() => N.normalizeScheme("QU-{YYYY}-{####}-{##}"), "bad_scheme"); if (e2) bad.push("two sequences: " + e2);
    const e3 = throws(() => N.normalizeScheme("QU-{QQQQ}-{####}"), "bad_scheme"); if (e3) bad.push("unknown token: " + e3);
    const e4 = throws(() => N.normalizeScheme("QU-{YYYY}-{####"), "bad_scheme"); if (e4) bad.push("unmatched brace: " + e4);
    const e5 = throws(() => N.normalizeScheme("QU-2026"), "bad_scheme"); if (e5) bad.push("no token: " + e5);
    const e6 = throws(() => N.normalizeScheme(42), "bad_scheme"); if (e6) bad.push("non-string: " + e6);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "default + {YY} sequence-width read; six malformed schemes refused" };
  });

  T.register("numbering: rendering honours date tokens, sequence padding and overflow", () => {
    const bad = [];
    const at = "2026-03-04T12:00:00.000Z";
    if (N.render(N.DEFAULT_PATTERN, at, 7) !== "QU-2026-0007") bad.push("default: " + N.render(N.DEFAULT_PATTERN, at, 7));
    if (N.render("A{YY}{MM}{DD}-{#}", at, 5) !== "A260304-5") bad.push("date parts");
    if (N.render("QU-{YYYY}-{##}", at, 123) !== "QU-2026-123") bad.push("overflow not kept whole: " + N.render("QU-{YYYY}-{##}", at, 123));
    if (N.render("QU-{YYYY}-{####}", at, 10000) !== "QU-2026-10000") bad.push("width overflow");
    if (N.render(N.DEFAULT_PATTERN, at, 1) !== "QU-2026-0001") bad.push("padding");
    const bt = throws(() => N.render(N.DEFAULT_PATTERN, at, -1), "bad_seq"); if (bt) bad.push("negative seq: " + bt);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "YYYY/YY/MM/DD render; sequence zero-pads and never truncates on overflow" };
  });

  T.register("numbering: the sequence is bucketed by the rendered prefix", () => {
    const bad = [];
    const a = N.bucketKey(N.DEFAULT_PATTERN, AT26);
    const b = N.bucketKey(N.DEFAULT_PATTERN, AT27);
    if (a === b) bad.push("a new year did not open a new bucket");
    if (a !== N.bucketKey(N.DEFAULT_PATTERN, "2026-12-31T23:59:59.000Z")) bad.push("the same year produced two buckets");
    const m1 = N.bucketKey("INV-{YYYY}{MM}-{####}", AT26);
    const m2 = N.bucketKey("INV-{YYYY}{MM}-{####}", "2026-02-01T00:00:00.000Z");
    if (m1 === m2) bad.push("a month token did not open a new bucket");
    const y1 = N.bucketKey("Q-{####}", AT26);
    const y2 = N.bucketKey("Q-{####}", AT27);
    if (y1 !== y2) bad.push("a pattern with no date token should not reset");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "year/month tokens open buckets; a date-free pattern keeps one" };
  });

  T.register("numbering: minting issues unique sequential numbers and records them", async () => {
    const env = makeStore();
    const svc = svcFor(env);
    const bad = [];
    const r1 = await svc.mint({ at: AT26, quote_id: "q1" });
    const r2 = await svc.mint({ at: AT26, quote_id: "q2" });
    const r3 = await svc.mint({ at: AT26, quote_id: "q3" });
    if (!r1.ok || r1.number !== "QU-2026-0001") bad.push("first: " + JSON.stringify(r1));
    if (!r2.ok || r2.number !== "QU-2026-0002" || r2.seq !== 2) bad.push("second: " + JSON.stringify(r2));
    if (!r3.ok || r3.number !== "QU-2026-0003") bad.push("third: " + JSON.stringify(r3));
    const s = await svc.state();
    if (s.issuedCount !== 3) bad.push("issuedCount=" + s.issuedCount);
    const l = await svc.lookup("QU-2026-0002");
    if (!l.entry || l.entry.quote_id !== "q2") bad.push("ledger lookup");
    const byQuote = await svc.list({ quote_id: "q3" });
    if (byQuote.entries.length !== 1 || byQuote.entries[0].number !== "QU-2026-0003") bad.push("list by quote");
    const c = await svc.count();
    if (c.count !== 3) bad.push("count=" + c.count);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "0001→0003 issued, ledger + counters + lookups agree" };
  });

  T.register("numbering: a deleted quote's number is never reissued", async () => {
    const env = makeStore();
    const svc = svcFor(env);
    await svc.mint({ at: AT26, quote_id: "q1" });
    await svc.mint({ at: AT26, quote_id: "q2" });
    await svc.mint({ at: AT26, quote_id: "q3" });
    await writeRecords(env, [
      { id: "q1", quote_number: "QU-2026-0001" },
      { id: "q2", quote_number: "QU-2026-0002" },
      { id: "q3", quote_number: "QU-2026-0003" }
    ]);
    await writeRecords(env, [{ id: "q1", quote_number: "QU-2026-0001" }, { id: "q3", quote_number: "QU-2026-0003" }]);
    const next = await svc.mint({ at: AT26, quote_id: "q4" });
    const bad = [];
    if (!next.ok || next.number !== "QU-2026-0004") bad.push("next number after a delete: " + JSON.stringify(next));
    const gone = await svc.lookup("QU-2026-0002");
    if (!gone.issued || gone.entry.quote_id !== "q2") bad.push("the deleted quote's number was freed");
    const v = await svc.verify();
    if (!v.ok) bad.push("verify after a delete: " + JSON.stringify(v.breaks));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "deleting a quote does not free its number; the sequence moves on" };
  });

  T.register("numbering: a concurrent document conflict retries without duplicating a number", async () => {
    const at = AT26;
    const bucket = N.bucketKey(N.DEFAULT_PATTERN, at);
    const first = { ok: true, state: "canonical", revision: 1, content: { records: [], numbering: { scheme: { pattern: N.DEFAULT_PATTERN }, counters: {}, issued: {} } } };
    const second = {
      ok: true, state: "canonical", revision: 2,
      content: {
        records: [], numbering: {
          scheme: { pattern: N.DEFAULT_PATTERN }, counters: { [bucket]: 1 },
          issued: { "QU-2026-0001": { number: "QU-2026-0001", seq: 1, bucket, at, quote_id: null } }
        }
      }
    };
    const loads = [first, second];
    let li = 0;
    const saved = [];
    const fake = {
      loadDoc: async () => loads[Math.min(li++, loads.length - 1)],
      saveChecked: async (m, c) => { saved.push(c); return saved.length === 1 ? { ok: false, code: "conflict" } : { ok: true, revision: 3 }; }
    };
    const res = await N.createService({ store: fake }).mint({ at });
    const bad = [];
    if (!res.ok || res.number !== "QU-2026-0002" || res.seq !== 2) bad.push("retry result: " + JSON.stringify(res));
    const last = saved[saved.length - 1];
    if (!last || !last.numbering.issued["QU-2026-0001"]) bad.push("the other writer's number was clobbered");
    if (!last || !last.numbering.issued["QU-2026-0002"]) bad.push("the retried number was not saved");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "conflict re-read the winner's revision and minted the next number" };
  });

  T.register("numbering: ensure/attach are idempotent and numbers are stable", async () => {
    const env = makeStore();
    const svc = svcFor(env);
    const e1 = await svc.ensure("q1", { at: AT26 });
    const e2 = await svc.ensure("q1", { at: AT27 });
    const bad = [];
    if (!e1.ok || e1.number !== "QU-2026-0001" || e1.existing) bad.push("first ensure: " + JSON.stringify(e1));
    if (!e2.ok || e2.number !== "QU-2026-0001" || !e2.existing) bad.push("second ensure was not idempotent: " + JSON.stringify(e2));
    const a1 = await svc.attach({ id: "q1", title: "Widgets" }, { at: AT26 });
    if (!a1.ok || a1.number !== "QU-2026-0001" || a1.quote.quote_number !== "QU-2026-0001") bad.push("attach: " + JSON.stringify(a1));
    const a2 = await svc.attach({ id: "q1", quote_number: "QU-2026-0001" }, { at: AT27 });
    if (!a2.ok || a2.number !== "QU-2026-0001" || !a2.existing) bad.push("re-attach changed the number: " + JSON.stringify(a2));
    const c = await svc.count();
    if (c.count !== 1) bad.push("a repeat ensure minted a second number (count=" + c.count + ")");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one quote → one number, stable across repeat calls" };
  });

  T.register("numbering: changing the scheme only affects future numbers", async () => {
    const env = makeStore();
    const svc = svcFor(env);
    const bad = [];
    const before = await svc.mint({ at: AT26, quote_id: "q1" });
    if (before.number !== "QU-2026-0001") bad.push("pre-change number: " + before.number);
    const set = await svc.setScheme("INV-{YY}-{###}");
    if (!set.ok) bad.push("setScheme failed: " + JSON.stringify(set));
    const after = await svc.mint({ at: AT26, quote_id: "q2" });
    if (!after.ok || after.number !== "INV-26-001") bad.push("post-change number: " + JSON.stringify(after));
    const old = await svc.lookup("QU-2026-0001");
    if (!old.issued) bad.push("the old number was lost when the scheme changed");
    const gs = await svc.getScheme();
    if (gs.scheme.pattern !== "INV-{YY}-{###}") bad.push("scheme not persisted: " + JSON.stringify(gs.scheme));
    const badScheme = throws(() => N.normalizeScheme("nope"), "bad_scheme");
    if (badScheme) bad.push("setScheme accepted a bad pattern");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "new scheme applies forward; issued numbers stay valid" };
  });

  T.register("numbering: the ledger prevents reuse even if a counter is lost", async () => {
    const env = makeStore();
    const svc = svcFor(env);
    const at = AT26;
    const bucket = N.bucketKey(N.DEFAULT_PATTERN, at);
    const d = await env.store.loadDoc("quotes");
    await env.store.saveChecked("quotes", {
      records: [],
      numbering: {
        scheme: { pattern: N.DEFAULT_PATTERN },
        counters: { [bucket]: 0 },
        issued: { "QU-2026-0001": { number: "QU-2026-0001", seq: 1, bucket, at, quote_id: null } }
      }
    }, { expectedBase: d.revision });
    const res = await svc.mint({ at });
    const bad = [];
    if (!res.ok || res.number !== "QU-2026-0002") bad.push("a lost counter allowed reuse: " + JSON.stringify(res));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "an already-issued number is skipped even with a reset counter" };
  });

  T.register("numbering: verify detects duplicate and unrecorded numbers", async () => {
    const env = makeStore();
    const svc = svcFor(env);
    await svc.mint({ at: AT26, quote_id: "q1" });
    await svc.mint({ at: AT26, quote_id: "q2" });
    const bad = [];
    await writeRecords(env, [{ id: "q1", quote_number: "QU-2026-0001" }, { id: "q2", quote_number: "QU-2026-0002" }]);
    const ok = await svc.verify();
    if (!ok.ok) bad.push("a consistent ledger failed verify: " + JSON.stringify(ok.breaks));
    await writeRecords(env, [{ id: "q1", quote_number: "QU-2026-0001" }, { id: "q2", quote_number: "QU-2026-9999" }]);
    const unrecorded = await svc.verify();
    if (unrecorded.ok || !unrecorded.breaks.some(b => b.indexOf("9999") !== -1)) bad.push("unrecorded number not caught: " + JSON.stringify(unrecorded.breaks));
    await writeRecords(env, [{ id: "q1", quote_number: "QU-2026-0001" }, { id: "q2", quote_number: "QU-2026-0001" }]);
    const dup = await svc.verify();
    if (dup.ok || !dup.breaks.some(b => b.indexOf("more than one") !== -1)) bad.push("duplicate not caught: " + JSON.stringify(dup.breaks));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "verify clears a good ledger and flags unrecorded + duplicate numbers" };
  });

  T.register("numbering: the numbering state round-trips through the real workspace store (live)", async () => {
    const r = window.root;
    if (!r || !r.uploadPlugin) return { pass: true, skip: true, detail: "upload-plugin unavailable" };
    const ns = "num" + Date.now().toString(36) + QS.randHex(4);
    let store;
    try {
      store = QS.createDefault({ ns, modules: ["quotes"] });
    } catch (e) {
      return { pass: true, skip: true, detail: e.message };
    }
    const svc = N.createService({ store });
    const res = await svc.mint({ at: "2031-01-01T00:00:00.000Z", quote_id: "live-q" });
    if (res.code === "requires_saved_generator") return { pass: true, skip: true, detail: "editable uploads need a saved generator" };
    if (res.code === "over_daily_allowance") return { pass: true, skip: true, detail: "upload daily allowance exhausted — live numbering check skipped" };
    if (!res.ok) return { pass: false, detail: "mint failed: " + JSON.stringify(res) };
    const folder = r.kv.qu;
    const entries = await folder.entries().catch(() => []);
    for (const pair of entries) {
      const k = pair[0];
      if ((k.indexOf("doc:") === 0 || k.indexOf("sync:") === 0) && k.indexOf(":" + ns + ":") !== -1) await folder.delete(k);
    }
    const svc2 = N.createService({ store });
    const again = await svc2.ensure("live-q");
    const finalClean = await folder.entries().catch(() => []);
    for (const pair of finalClean) {
      if (pair[0].indexOf(":" + ns + ":") !== -1 || pair[0] === "recon:" + ns) await folder.delete(pair[0]);
    }
    const bad = [];
    if (res.number !== "QU-2031-0001") bad.push("first number: " + res.number);
    if (!again.ok || again.number !== "QU-2031-0001" || !again.existing) bad.push("number did not survive a cache wipe: " + JSON.stringify(again));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "allocated, wiped the cache, re-read and kept the same number" };
  });
})();
