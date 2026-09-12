(function () {
  const T = window.QU_SELFTEST;
  const M = window.QU_MONEY;
  const TOT = window.QU_TOTALS;
  const L = window.QU_LIFECYCLE;
  const PT = window.QU_PORTALTOKENS;
  const PV = window.QU_PORTALVIEW;
  const OB = window.QU_OUTBOX;
  const II = window.QU_INVOICEINTENTS;
  const I = window.QU_INTEGRITY;
  const E = window.QU_E2E;
  if (!T || !M || !TOT || !L || !PT || !PV || !OB || !II) return;

  T.register("integration: money → totals keeps integer cents across mixed service terms", () => {
    const bad = [];
    const t = TOT.computeTotals({
      term_months: 12,
      currency: "CAD",
      line_items: [
        { id: "a", kind: "one_time", quantity: 2, unit_sell_cents: 15000, currency: "CAD" },
        { id: "b", kind: "mrr", quantity: 1, unit_sell_cents: 20000, currency: "CAD" },
        { id: "c", kind: "mrr", quantity: 1, unit_sell_cents: 5000, term_months: 36, currency: "CAD" }
      ]
    });
    const expect = { one_time_cents: 30000, mrr_cents: 25000, annual_mrr_cents: 300000, twelve_month_value_cents: 330000, deal_value_cents: 450000 };
    Object.keys(expect).forEach(k => { if (t[k] !== expect[k]) bad.push(k + "=" + t[k] + " (want " + expect[k] + ")"); });
    ["one_time_cents", "mrr_cents", "annual_mrr_cents", "twelve_month_value_cents", "deal_value_cents"].forEach(k => {
      if (!Number.isSafeInteger(t[k])) bad.push(k + " is not a safe integer");
    });
    const svcLine = t.services.find(s => s.id === "c");
    if (!svcLine || svcLine.term_months !== 36 || svcLine.deal_value_cents !== 180000) bad.push("per-service 36-month deal value is wrong");
    const audit = M.auditStoredMoney(t);
    if (!audit.ok) bad.push("totals failed the stored-money audit: " + JSON.stringify(audit.violations));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one-time + 12×MRR + per-service terms all land on exact integer cents; the totals survive the stored-money audit" };
  });

  T.register("integration: the lifecycle table gates transitions and never lets a portal act without a token", () => {
    const bad = [];
    if (!L.canTransition("draft", "sent")) bad.push("draft→sent not allowed");
    if (L.canTransition("approved", "sent")) bad.push("approved→sent allowed");
    const a = L.attempt("draft", "sent", { actor_type: "internal", actor: "rep" });
    if (!a.ok || a.event !== "sent") bad.push("attempt draft→sent: " + JSON.stringify(a));
    const illegal = L.attempt("approved", "sent", { actor_type: "internal" });
    if (illegal.ok || illegal.code !== "illegal_transition") bad.push("illegal transition code=" + (illegal && illegal.code));
    const untokened = L.attempt("viewed", "approved", { actor_type: "portal" });
    if (untokened.ok || untokened.code !== "portal_needs_token") bad.push("portal-without-token code=" + (untokened && untokened.code));
    const view = L.noteView({ state: "sent" }, { actor_type: "portal", token_id: "tk1", actor: "client" });
    if (!view.ok) bad.push("noteView on a sent version failed");
    const notSent = L.noteView({ state: "draft" }, { actor_type: "portal", token_id: "tk1" });
    if (notSent.ok || notSent.code !== "not_sent") bad.push("noteView on a draft code=" + (notSent && notSent.code));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "legal transitions pass, illegal ones and untokened portal transitions are refused" };
  });

  T.register("integration: a portal token stores only a hash and enforces expiry + revocation", () => {
    const bad = [];
    const minted = PT.mint({ quote_id: "q1", version_id: "v1", expires_days: 2, single_use: true });
    if (!minted.record.token_hash) bad.push("no token_hash stored");
    if (minted.secret && JSON.stringify(minted.record).indexOf(minted.secret) !== -1) bad.push("the plaintext secret leaked into the stored record");
    const now = Date.now();
    const ok = PT.verify(minted.secret, minted.record, now);
    if (!ok.ok) bad.push("the minted secret did not verify: " + JSON.stringify(ok));
    const wrong = PT.verify("deadbeef".repeat(8), minted.record, now);
    if (wrong.ok || wrong.code !== "hash_mismatch") bad.push("a wrong secret code=" + (wrong && wrong.code));
    const later = now + 3 * 86400000;
    const expired = PT.verify(minted.secret, minted.record, later);
    if (expired.ok || expired.code !== "expired") bad.push("an expired token code=" + (expired && expired.code));
    const revoked = PT.verify(minted.secret, Object.assign({}, minted.record, { revoked_at: new Date().toISOString() }), now);
    if (revoked.ok || revoked.code !== "revoked") bad.push("a revoked token code=" + (revoked && revoked.code));
    let threw = false;
    try { PT.assertNoSecret({ id: "x", token_hash: "h", secret: "oops" }); } catch (e) { threw = true; }
    if (!threw) bad.push("assertNoSecret allowed a plaintext secret field");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "hash-only storage, correct/incorrect/expired/revoked paths all behave, and a plaintext field is refused" };
  });

  T.register("integration: the client portal DTO excludes every cost and margin field", () => {
    const bad = [];
    const line = { id: "l1", quote_version_id: "v1", kind: "one_time", description: "AP", quantity: 1, unit_cost_cents: 9000, unit_sell_cents: 15000, optional: false, selected_by_default: true };
    const version = { id: "v1", quote_id: "q1", quote_number: "QU-2026-0001", version_number: 1, state: "sent", title: "T", currency: "CAD", frozen_at: "2026-05-01T00:00:00.000Z" };
    const dto = PV.serialize({ quote: { id: "q1", company_name: "Northwind" }, version: version, line_items: [line], option_groups: [] });
    const blob = JSON.stringify(dto);
    if (/cost|margin/i.test(blob)) bad.push("the client view carries a cost/margin key: " + blob.slice(0, 200));
    const scan = PV.audit(dto);
    if (!scan.ok) bad.push("audit flagged the client view: " + JSON.stringify(scan.violations));
    if (!dto.totals || !Number.isSafeInteger(dto.totals.deal_value_cents)) bad.push("the client view has no integer deal value");
    const leak = PV.audit({ lines: [{ id: "x", unit_cost_cents: 100 }] });
    if (leak.ok) bad.push("audit missed a doctored cost field");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the client DTO is cost/margin-free with an integer deal value, and a doctored cost field is still caught" };
  });

  T.register("integration: the outbox backs off, retries what is due and refuses a duplicate key", () => {
    const bad = [];
    if (OB.backoffMs(1, { baseBackoffMs: 1000, maxBackoffMs: 60000 }) !== 1000) bad.push("attempt 1 backoff");
    if (OB.backoffMs(2, { baseBackoffMs: 1000, maxBackoffMs: 60000 }) !== 2000) bad.push("attempt 2 backoff");
    if (OB.backoffMs(10, { baseBackoffMs: 1000, maxBackoffMs: 60000 }) !== 60000) bad.push("the backoff did not cap");
    const now = Date.now();
    const jobs = [
      { id: "a", state: "pending", key: "k1", attempts: 0 },
      { id: "b", state: "failed", key: "k2", attempts: 1, terminal: false, next_attempt_at: new Date(now - 1000).toISOString() },
      { id: "c", state: "failed", key: "k3", attempts: 1, terminal: true, next_attempt_at: new Date(now - 1).toISOString() },
      { id: "d", state: "failed", key: "k4", attempts: 1, terminal: false, next_attempt_at: new Date(now + 60000).toISOString() }
    ];
    const due = OB.dueJobs(jobs, now).map(j => j.id).sort().join(",");
    if (due !== "a,b") bad.push("due jobs = " + due + " (want a,b)");
    const uniq = OB.uniqueByKey([{ key: "x" }, { key: "x" }]);
    if (uniq.ok) bad.push("a duplicated key was not detected");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "exponential backoff caps, only the pending + retry-due jobs run, a duplicate key is refused" };
  });

  T.register("integration: direct invoicing claims exactly one intent for a version, and the live system passes every invariant", async () => {
    if (!E || !I) return { pass: true, skip: true, detail: "the E2E harness/integrity engine is unavailable" };
    const bad = [];
    const env = E.createHarness();
    const run = await E.runScenario({ env: env });
    if (!run.ok) return { pass: false, detail: "the seed scenario failed: " + JSON.stringify(run.steps.filter(s => !s.ok)) };
    const intentsOf = l => (l.intents || l.records || []);
    let list = await env.invoiceIntents.list({});
    if (intentsOf(list).length !== 1) bad.push("after one approval there are " + intentsOf(list).length + " intents");
    const first = intentsOf(list)[0];
    const gv = await env.versions.getVersion(first.version_id);
    if (!gv.ok) return { pass: false, detail: "could not reload the invoiced version: " + JSON.stringify(gv) };
    for (let i = 0; i < 2; i++) {
      const again = await env.invoiceDirect.enqueueForVersion({ quote_id: first.quote_id, version: gv.version });
      if (again.code === "not_frozen" || again.code === "not_approved") bad.push("a re-enqueue was refused as " + again.code);
      await env.outbox.runDue();
    }
    list = await env.invoiceIntents.list({});
    if (intentsOf(list).length !== 1) bad.push("re-enqueueing produced " + intentsOf(list).length + " intents");
    const inv = env.gateway.call("accounting", "invoiceCount", {}, { scope: "*" });
    if (inv.result !== 1) bad.push("accounting invoice count = " + inv.result);

    const svc = I.createService({ store: env.store });
    const ds = await svc.loadDataset();
    const frozen = I.checkFrozen(ds);
    if (!frozen.ok) bad.push("I1: " + JSON.stringify(frozen.failures));
    const unique = I.checkUnique(ds);
    if (!unique.ok) bad.push("I2: " + JSON.stringify(unique.failures));
    const events = await I.checkEvents(ds, { digest: t => env.store.digestHex(t) });
    if (!events.ok) bad.push("I3: " + JSON.stringify(events.failures));
    const leak = I.checkCostLeak(ds);
    if (!leak.ok) bad.push("I4: " + JSON.stringify(leak.failures));
    const box = I.checkOutbox(ds);
    if (!box.ok) bad.push("I5: " + JSON.stringify(box.failures));
    const money = I.checkStoredMoney(ds);
    if (!money.ok) bad.push("money: " + JSON.stringify(money.failures));
    const tokens = I.checkTokens(ds);
    if (!tokens.ok) bad.push("tokens: " + JSON.stringify(tokens.failures));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one intent per approved version under retries, one invoice, and all five invariants hold directly against the live documents" };
  });
})();
