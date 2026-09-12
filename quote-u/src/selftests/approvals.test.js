(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const A = window.QU_APPROVALS;
  if (!T || !QS || !A) return;

  const REP_MAILBOX = "alex.rivera@example.com";

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

  function makeEnv() {
    const ns = "apr" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const events = window.QU_PORTALEVENTS.createService({ audit });
    const approvals = A.createService({ store });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, events, approvals, read, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  async function seedSent(env) {
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Network refresh", scope: "*" });
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    await env.versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 });
    const g = await env.versions.addGroup(v.version.id, { name: "Warranty", selection_type: "single" });
    const opt1 = await env.versions.addLine(v.version.id, { kind: "one_time", description: "3yr cover", quantity: 1, unit_cost_cents: 1000, unit_sell_cents: 5000, optional: true, option_group_id: g.group.id, selected_by_default: false });
    const opt2 = await env.versions.addLine(v.version.id, { kind: "one_time", description: "5yr cover", quantity: 1, unit_cost_cents: 1500, unit_sell_cents: 7000, optional: true, option_group_id: g.group.id, selected_by_default: false });
    const sent = await env.send.send(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    return { created, version: v.version, group: g.group, opt1: opt1.line, opt2: opt2.line, sent, secret: secretOf(sent.link) };
  }

  T.register("approval record: validate/normalize reject a missing name, fractional cents and any secret-shaped field", async () => {
    const bad = [];
    const v = A.validate({ quote_id: "q1", version_id: "v1", approver_name: "", token_id: "t1", one_time_cents: 1.5, mrr_cents: 0, twelve_month_value_cents: 500 });
    if (v.ok) bad.push("an empty approver name was accepted");
    else {
      const codes = v.violations.map(x => x.code);
      if (codes.indexOf("approver_required") === -1) bad.push("approver_required missing: " + codes.join(","));
      if (codes.indexOf("fractional_cents") === -1) bad.push("fractional_cents missing: " + codes.join(","));
    }
    const sec = A.validate({ quote_id: "q", version_id: "v", approver_name: "Dana", token_id: "t", one_time_cents: 1, mrr_cents: 0, twelve_month_value_cents: 1, token_secret: "hunter2" });
    if (sec.ok || sec.violations[0].code !== "secret_not_allowed") bad.push("a secret field was allowed: " + JSON.stringify(sec));

    let threw = null;
    try { A.normalize({ quote_id: "q", version_id: "v", approver_name: "", token_id: "t", one_time_cents: 1, mrr_cents: 0, twelve_month_value_cents: 1 }); }
    catch (e) { threw = e.code; }
    if (threw !== "approver_required") bad.push("normalize did not throw approver_required: " + threw);

    const ok = A.validate({ quote_id: "q1", version_id: "v1", approver_name: "Dana Whitfield", token_id: "tok-1", one_time_cents: 35000, mrr_cents: 0, twelve_month_value_cents: 35000 });
    if (!ok.ok) bad.push("a valid record was rejected: " + JSON.stringify(ok.violations));
    else {
      if (ok.record.currency !== "CAD") bad.push("default currency: " + ok.record.currency);
      if (ok.record.decision !== "approved") bad.push("default decision: " + ok.record.decision);
      if (!Number.isInteger(ok.record.one_time_cents)) bad.push("one_time_cents is not an integer");
      if (ok.record.selection.length !== 0) bad.push("empty selection should stay empty");
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the acceptance record requires a typed name and integer cents, refuses any secret-shaped key, and is pure (validate reports, normalize throws)" };
  });

  T.register("approval record: exactly one approval per version (invariant I2), integer cents, no secret, verify() is clean", async () => {
    const env = makeEnv();
    const appr = env.approvals;
    const bad = [];
    const base = { quote_id: "q1", version_id: "v1", approver_name: "Dana", token_id: "tok-1", one_time_cents: 35000, mrr_cents: 0, twelve_month_value_cents: 35000 };
    const r1 = await appr.record(base);
    if (!r1.ok) return { pass: false, detail: "first record failed: " + JSON.stringify(r1) };
    if (!r1.approval || !r1.approval.id) bad.push("no approval id");
    const r2 = await appr.record(Object.assign({}, base, { token_id: "tok-2" }));
    if (r2.ok || r2.code !== "already_approved") bad.push("a second approval for the same version was accepted: " + JSON.stringify(r2));
    const cnt = await appr.count();
    if (!cnt.ok || cnt.count !== 1) bad.push("count: " + JSON.stringify(cnt));
    const has = await appr.has("v1");
    if (!has.ok || !has.has) bad.push("has(v1) should be true");
    const g = await appr.getForVersion("v1");
    if (!g.ok || !g.approval) bad.push("getForVersion returned nothing");
    else {
      if (g.approval.one_time_cents !== 35000) bad.push("stored one_time_cents: " + g.approval.one_time_cents);
      if (!Number.isInteger(g.approval.mrr_cents)) bad.push("mrr_cents not an integer");
      const json = JSON.stringify(g.approval).toLowerCase();
      ["secret", "token_hash", "unit_cost", "margin", "snapshot"].forEach(k => { if (json.indexOf(k) !== -1) bad.push("approval stores " + k); });
    }
    const list = await appr.list({ quote_id: "q1" });
    if (!list.ok || list.approvals.length !== 1) bad.push("list by quote_id: " + JSON.stringify(list).slice(0, 120));
    const ver = await appr.verify();
    if (!ver.ok) bad.push("verify violations: " + JSON.stringify(ver.violations));

    // A DIFFERENT version is allowed its own approval.
    const r3 = await appr.record(Object.assign({}, base, { version_id: "v2" }));
    if (!r3.ok) bad.push("a second version was refused: " + JSON.stringify(r3));
    const cnt2 = await appr.count();
    if (cnt2.count !== 2) bad.push("count after second version: " + cnt2.count);

    // The pure I2 detector catches a doctored duplicate.
    const dup = A.uniqueByVersion([{ version_id: "x" }, { version_id: "x" }]);
    if (dup.ok || dup.duplicates.length !== 1) bad.push("uniqueByVersion missed a duplicate");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "one approval per version is enforced under the revision-guarded write, a distinct version is allowed, and the stored row holds integer cents with no secret" };
  });

  T.register("approval record: approve() writes exactly one row with the server-recomputed totals and the token id", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];
    if (!s.sent.ok) return { pass: false, detail: "seed send failed" };
    const res = await env.actions.approve(s.secret, { selection: [s.opt1.id], approver_name: "Dana Whitfield" }, { ip: "203.0.113.9", user_agent: "UA/1" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (!res.approval_id) bad.push("approve returned no approval_id");
    const g = await env.approvals.getForVersion(s.version.id);
    if (!g.ok || !g.approval) bad.push("no approval row was written");
    else {
      if (g.approval.id !== res.approval_id) bad.push("approve's id disagrees with the stored row");
      if (g.approval.one_time_cents !== 35000) bad.push("one_time_cents: " + g.approval.one_time_cents);
      if (g.approval.mrr_cents !== 0) bad.push("mrr_cents: " + g.approval.mrr_cents);
      if (g.approval.twelve_month_value_cents !== 35000) bad.push("twelve_month_value_cents: " + g.approval.twelve_month_value_cents);
      if (g.approval.approver_name !== "Dana Whitfield") bad.push("approver_name: " + g.approval.approver_name);
      if (!g.approval.token_id) bad.push("token_id missing");
      if (g.approval.selection.indexOf(s.opt1.id) === -1) bad.push("selection missing: " + JSON.stringify(g.approval.selection));
      if (JSON.stringify(g.approval).indexOf(s.secret) !== -1) bad.push("the approval row leaked the plaintext secret");
    }
    const ver = await env.approvals.verify();
    if (!ver.ok) bad.push("verify: " + JSON.stringify(ver.violations));
    const cnt = await env.approvals.count();
    if (cnt.count !== 1) bad.push("count: " + cnt.count);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approve() persists exactly one acceptance row carrying the server-recomputed totals, the approver name and the token id (never the secret)" };
  });
})();
