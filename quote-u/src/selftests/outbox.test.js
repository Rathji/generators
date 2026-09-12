(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const O = window.QU_OUTBOX;
  if (!T || !QS || !O) return;

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
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

  function makeEnv(opts) {
    opts = opts || {};
    const ns = "obx" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const outbox = O.createService({ store, maxAttempts: opts.maxAttempts, baseBackoffMs: opts.baseBackoffMs });
    return { ns, store, outbox };
  }

  T.register("outbox: the pure state machine — key, backoff, due, I5 dup detection", () => {
    const bad = [];
    if (O.keyOf("v1", "opp_update") !== "v1:opp_update") bad.push("keyOf: " + O.keyOf("v1", "opp_update"));
    if (O.backoffMs(1, { baseBackoffMs: 1000, maxBackoffMs: 10000 }) !== 1000) bad.push("backoff attempt 1");
    if (O.backoffMs(2, { baseBackoffMs: 1000, maxBackoffMs: 10000 }) !== 2000) bad.push("backoff attempt 2");
    if (O.backoffMs(9, { baseBackoffMs: 1000, maxBackoffMs: 5000 }) !== 5000) bad.push("backoff cap");

    const t = Date.parse("2026-01-01T00:00:00Z");
    const recs = [
      { id: "a", key: "v1:opp_update", state: "pending" },
      { id: "b", key: "v1:note", state: "done", completed_at: "2026-01-01T00:00:01Z" },
      { id: "c", key: "v2:opp_update", state: "failed", attempts: 1, next_attempt_at: new Date(t + 5000).toISOString() },
      { id: "d", key: "v3:opp_update", state: "failed", attempts: 9, next_attempt_at: null, terminal: true }
    ];
    const dueNow = O.dueJobs(recs, t).map(j => j.id);
    if (dueNow.indexOf("a") === -1) bad.push("pending job not due");
    if (dueNow.indexOf("c") !== -1) bad.push("a job still in backoff was due");
    if (dueNow.indexOf("b") !== -1) bad.push("a done job was due");
    if (dueNow.indexOf("d") !== -1) bad.push("a terminal job was due");
    const dueLater = O.dueJobs(recs, t + 6000).map(j => j.id);
    if (dueLater.indexOf("c") === -1) bad.push("a past-backoff job was not due");

    const uniq = O.uniqueByKey([{ key: "k" }, { key: "k" }]);
    if (uniq.ok || uniq.duplicates.length !== 1) bad.push("uniqueByKey missed a duplicate");
    const audit = O.auditRecords([{ key: "k", state: "done", attempts: 1, completed_at: "x" }, { key: "k", state: "done", attempts: 1, completed_at: "x" }]);
    if (audit.ok) bad.push("auditRecords missed a duplicate key");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "backoff doubles and caps, a done/terminal/backoff job is never due, and duplicate idempotency keys are detected" };
  });

  T.register("outbox: enqueue is idempotent by version+action key (invariant I5)", async () => {
    const env = makeEnv();
    const bad = [];
    const first = await env.outbox.enqueue({ version_id: "v1", action: "opp_update", quote_id: "q1", payload: { amount_cents: 100 } });
    if (!first.ok || first.deduped) bad.push("first enqueue: " + JSON.stringify(first));
    const again = await env.outbox.enqueue({ version_id: "v1", action: "opp_update", quote_id: "q1", payload: { amount_cents: 999 } });
    if (!again.ok || !again.deduped) bad.push("second enqueue was not deduped: " + JSON.stringify(again));
    if (again.job && first.job && again.job.id !== first.job.id) bad.push("dedupe returned a different job");
    const cnt = await env.outbox.count();
    if (!cnt.ok || cnt.count !== 1) bad.push("count after duplicate: " + JSON.stringify(cnt));
    // A different action on the same version is its own job.
    const other = await env.outbox.enqueue({ version_id: "v1", action: "note_written", quote_id: "q1", payload: {} });
    if (!other.ok || other.deduped) bad.push("a distinct action was deduped");
    const cnt2 = await env.outbox.count();
    if (cnt2.count !== 2) bad.push("count after distinct action: " + cnt2.count);
    const ver = await env.outbox.verify();
    if (!ver.ok) bad.push("verify: " + JSON.stringify(ver.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "re-enqueueing the same version+action returns the existing job and creates no second row; a different action is a distinct job" };
  });

  T.register("outbox: the worker retries with backoff, completes once, and never re-runs a done job", async () => {
    const env = makeEnv();
    const bad = [];
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    let calls = 0;
    env.outbox.registerHandler("opp_update", async () => {
      calls++;
      if (calls === 1) return { ok: false, code: "transient", detail: "the connector was busy" };
      return { ok: true, wrote: true };
    });
    await env.outbox.enqueue({ version_id: "v1", action: "opp_update", quote_id: "q1", payload: {} });

    const r1 = await env.outbox.runDue({ now: t0 });
    if (r1.failed !== 1 || calls !== 1) bad.push("first tick: " + JSON.stringify({ failed: r1.failed, calls: calls }));
    const j1 = await env.outbox.getByKey(O.keyOf("v1", "opp_update"));
    if (!j1.ok || !j1.job || j1.job.state !== "failed" || j1.job.attempts !== 1) bad.push("job after failure: " + JSON.stringify(j1.job));
    else if (!j1.job.last_error || !j1.job.next_attempt_at) bad.push("failure did not record error/backoff");

    // Inside the backoff window nothing runs.
    const r2 = await env.outbox.runDue({ now: t0 + 500 });
    if (r2.due !== 0 || calls !== 1) bad.push("backoff window ran the job: " + JSON.stringify({ due: r2.due, calls: calls }));

    // Past the backoff it runs again and completes exactly once.
    const r3 = await env.outbox.runDue({ now: t0 + 2001 });
    if (r3.succeeded !== 1 || calls !== 2) bad.push("retry tick: " + JSON.stringify({ succeeded: r3.succeeded, calls: calls }));
    const j3 = await env.outbox.getByKey(O.keyOf("v1", "opp_update"));
    if (!j3.ok || j3.job.state !== "done" || !j3.job.completed_at) bad.push("job did not complete: " + JSON.stringify(j3.job));

    // A done job is never due again, so the handler cannot run a third time.
    const r4 = await env.outbox.runDue({ now: t0 + 999999 });
    if (calls !== 2) bad.push("a completed job ran again: calls=" + calls);
    if (r4.due !== 0) bad.push("a done job was due: " + r4.due);
    const ver = await env.outbox.verify();
    if (!ver.ok) bad.push("verify: " + JSON.stringify(ver.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a transient failure records the error and a backoff, never runs inside the window, retries and completes exactly once, and a done job is never executed again" };
  });

  T.register("outbox: a persistently failing job becomes terminal and stops being due", async () => {
    const env = makeEnv({ maxAttempts: 1 });
    const bad = [];
    const t0 = Date.parse("2026-01-02T00:00:00Z");
    let calls = 0;
    env.outbox.registerHandler("opp_update", async () => { calls++; return { ok: false, code: "connector_error", detail: "down" }; });
    await env.outbox.enqueue({ version_id: "v1", action: "opp_update", payload: {} });
    const r1 = await env.outbox.runDue({ now: t0 });
    if (r1.failed !== 1) bad.push("first tick failed count: " + r1.failed);
    const j = await env.outbox.getByKey(O.keyOf("v1", "opp_update"));
    if (!j.ok || j.job.terminal !== true || j.job.next_attempt_at !== null) bad.push("job not terminal: " + JSON.stringify(j.job));
    const r2 = await env.outbox.runDue({ now: t0 + 99999999 });
    if (calls !== 1) bad.push("a terminal job ran again: calls=" + calls);
    if (r2.due !== 0) bad.push("a terminal job was due: " + r2.due);
    // A missing handler fails terminally too.
    const env2 = makeEnv();
    await env2.outbox.enqueue({ version_id: "v9", action: "unknown_action", payload: {} });
    const r3 = await env2.outbox.runDue({ now: t0 });
    if (r3.failed !== 1) bad.push("no-handler job did not fail: " + JSON.stringify(r3));
    const j3 = await env2.outbox.getByKey(O.keyOf("v9", "unknown_action"));
    if (!j3.ok || j3.job.terminal !== true || j3.job.last_error.toLowerCase().indexOf("no handler") === -1) bad.push("no-handler job not terminal: " + JSON.stringify(j3.job));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "once the attempt cap is reached a job is terminal (attempt count + last error retained, no next attempt); a job with no handler fails terminally" };
  });
})();
