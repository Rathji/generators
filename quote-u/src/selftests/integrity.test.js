(function () {
  const T = window.QU_SELFTEST;
  const I = window.QU_INTEGRITY;
  const V = window.QU_VERSIONS;
  const A = window.QU_AUDIT;
  const M = window.QU_MONEY;
  if (!T || !I || !V || !A || !M) return;

  function frozenVersion(id, over) {
    const v = Object.assign({
      id: id, quote_id: "q1", quote_number: "QU-2026-0001", version_number: 1,
      state: "sent", title: "T", frozen_at: "2026-05-01T00:00:00.000Z", frozen_by: "rep"
    }, over || {});
    v.frozen_seal = V.sealBundle(v, [], []);
    return v;
  }

  T.register("integrity: the pure checks detect a tampered freeze, a duplicate approval/intent and a duplicated outbox key", () => {
    const bad = [];
    const v = frozenVersion("v1");

    const clean = {
      versions: [v], lines: [], groups: [],
      approvals: [{ id: "a1", version_id: "v1" }],
      intents: [{ id: "i1", version_id: "v1" }],
      outbox: [{ id: "j1", version_id: "v1", action: "opp_update", state: "done", attempts: 1 }]
    };
    if (!I.checkFrozen(clean).ok) bad.push("a clean frozen version failed I1");
    if (!I.checkUnique(clean).ok) bad.push("a clean dataset failed I2");
    if (!I.checkOutbox(clean).ok) bad.push("a clean outbox failed I5");

    const tampered = Object.assign({}, v, { title: "Modified after freeze" });
    const f1 = I.checkFrozen({ versions: [tampered], lines: [], groups: [] });
    if (f1.ok) bad.push("a tampered frozen version passed I1");
    if (!f1.failures.length) bad.push("no I1 failure detail");
    if (!/seal no longer matches/.test(f1.failures[0].detail)) bad.push("I1 detail: " + f1.failures[0].detail);

    const unsealed = Object.assign({}, v); delete unsealed.frozen_seal;
    const f2 = I.checkFrozen({ versions: [unsealed] });
    if (f2.ok) bad.push("an unsealed frozen version passed I1");

    const dupA = I.checkUnique({ approvals: [{ id: "a1", version_id: "v1" }, { id: "a2", version_id: "v1" }], intents: [] });
    if (dupA.ok) bad.push("two approvals for one version passed I2");
    const dupI = I.checkUnique({ approvals: [], intents: [{ id: "i1", version_id: "v1" }, { id: "i2", version_id: "v1" }] });
    if (dupI.ok) bad.push("two intents for one version passed I2");

    const dupJ = I.checkOutbox({ outbox: [
      { id: "j1", version_id: "v1", action: "opp_update", state: "done", attempts: 1 },
      { id: "j2", version_id: "v1", action: "opp_update", state: "pending", attempts: 0 }
    ] });
    if (dupJ.ok) bad.push("a duplicated outbox key passed I5");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "clean data passes; a tampered seal, duplicate acceptance/intent and duplicated outbox key are each caught" };
  });

  T.register("integrity: the audit-chain check re-derives the hash chain and catches a rewritten record", async () => {
    const bad = [];
    let log = [];
    for (const e of ["created", "sent", "approved"]) {
      const rec = await A.buildRecord(log, { quote_id: "q1", version_id: "v1", event: e, actor_type: "system", actor: "t" });
      log = log.concat([rec]);
    }
    const ok = await I.checkEvents({ events: log });
    if (!ok.ok) bad.push("an intact chain failed I3: " + JSON.stringify(ok.failures));

    const edited = log.slice();
    edited[1] = Object.assign({}, edited[1], { actor: "attacker" });
    const rewritten = await I.checkEvents({ events: edited });
    if (rewritten.ok) bad.push("a rewritten record passed I3");

    const removed = await I.checkEvents({ events: [log[0], log[2]] });
    if (removed.ok) bad.push("a removed record passed I3");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the chain verifies intact, and both an edited record and a removed record are caught" };
  });

  T.register("integrity: the cost-leak scan holds every stored version's client DTO to I4", () => {
    const bad = [];
    const line = { id: "l1", quote_version_id: "v1", kind: "one_time", description: "AP", quantity: 1, unit_cost_cents: 9000, unit_sell_cents: 15000 };
    const version = { id: "v1", quote_id: "q1", quote_number: "QU-2026-0001", version_number: 1, state: "draft", title: "T", currency: "CAD" };
    const clean = I.checkCostLeak({ versions: [version], lines: [line], groups: [], quotes: [{ id: "q1", company_name: "Northwind" }] });
    if (!clean.ok) bad.push("a clean client DTO failed I4: " + JSON.stringify(clean.failures));
    // The scan flags a doctored artifact payload that carries a cost field.
    const leak = I.checkCostLeak({ artifacts: [{ id: "art1", version_id: "v1", view: { unit_cost_cents: 9000 } }] });
    if (leak.ok) bad.push("an artifact carrying unit_cost_cents passed I4");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the client DTO is clean and a doctored artifact carrying a cost field is caught" };
  });

  T.register("integrity: a live system of record with a frozen, approved, invoiced quote passes every check", async () => {
    if (!window.QU_E2E) return { pass: true, skip: true, detail: "the E2E harness is unavailable" };
    const env = window.QU_E2E.createHarness();
    const run = await window.QU_E2E.runScenario({ env: env });
    if (!run.ok) return { pass: false, detail: "the E2E seed failed: " + JSON.stringify(run.steps.filter(s => !s.ok)) };
    const svc = I.createService({ store: env.store });
    const report = await svc.check();
    if (!report.ok) return { pass: false, detail: "integrity failed: " + JSON.stringify(report.results.filter(r => !r.ok)) };
    if (report.passed !== report.results.length) return { pass: false, detail: "passed " + report.passed + "/" + report.results.length };
    // The stored money discipline is part of the same pass.
    const money = report.results.find(r => r.id === "money");
    if (!money.ok) return { pass: false, detail: "stored-money check failed" };
    const sums = I.summarize(report);
    if (!sums.ok || sums.failed !== 0) return { pass: false, detail: "summary disagrees: " + JSON.stringify(sums) };
    return { pass: true, detail: report.results.length + " checks over a live frozen/approved/invoiced system of record, all green" };
  });
})();
