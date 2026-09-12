(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const R = window.QU_RECOMPUTE;
  const TOT = window.QU_TOTALS;
  if (!T || !QS || !R || !TOT) return;

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
    const ns = "rec" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const recompute = R.createService({ versions });
    const events = window.QU_PORTALEVENTS.createService({ audit });
    const approvals = window.QU_APPROVALS.createService({ store });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals, recompute });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, recompute, events, approvals, read, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  // A frozen version: required one-time $300 line + a $200/mo MRR line.
  async function seedFrozen(env) {
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Network refresh", scope: "*" });
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    const a = await env.versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 });
    const b = await env.versions.addLine(v.version.id, { kind: "mrr", description: "Managed IT", quantity: 1, unit_cost_cents: 10000, unit_sell_cents: 20000 });
    const sent = await env.send.send(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    const g = await env.versions.getVersion(v.version.id);
    return { created, version: g.version, lineA: a.line, lineB: b.line, sent, secret: secretOf(sent.link) };
  }

  T.register("recompute: derives totals from frozen data and ignores any client-claimed money", () => {
    const bad = [];
    const v = { id: "v1", state: "sent", frozen_at: "2026-01-01T00:00:00.000Z" };
    const lines = [
      { id: "l1", quote_version_id: "v1", kind: "one_time", quantity: 2, unit_sell_cents: 15000 },
      { id: "l2", quote_version_id: "v1", kind: "mrr", quantity: 1, unit_sell_cents: 20000 }
    ];
    const r = R.recompute({ version: v, line_items: lines, option_groups: [], selection: [], claimed: { one_time_cents: 1, mrr_cents: 1, twelve_month_value_cents: 2 } });
    if (!r.ok) return { pass: false, detail: "recompute refused valid frozen data: " + JSON.stringify(r) };
    if (r.totals.one_time_cents !== 30000) bad.push("one_time: " + r.totals.one_time_cents);
    if (r.totals.mrr_cents !== 20000) bad.push("mrr: " + r.totals.mrr_cents);
    if (r.totals.twelve_month_value_cents !== 270000) bad.push("twelve_month_value: " + r.totals.twelve_month_value_cents);
    if (r.totals.deal_value_cents !== 270000) bad.push("deal_value: " + r.totals.deal_value_cents);
    if (!r.claimed_ignored) bad.push("the client claim was not flagged as ignored");
    if (!r.claimed_compared || !r.claimed_compared.differs) bad.push("the ignored claim difference was not reported");
    if (!Number.isSafeInteger(r.totals.one_time_cents)) bad.push("totals are not integer cents");

    // An unfrozen version can never produce approval totals.
    let unfrozen = null;
    try { R.recompute({ version: { id: "v9", state: "draft" }, line_items: [], option_groups: [], selection: [] }); }
    catch (e) { unfrozen = e.code; }
    if (unfrozen !== "not_frozen") bad.push("unfrozen version not refused: " + unfrozen);

    // A line from another version cannot be smuggled in.
    let foreign = null;
    try { R.recompute({ version: v, line_items: [{ id: "x", quote_version_id: "v2", kind: "one_time", unit_sell_cents: 1 }], option_groups: [], selection: [] }); }
    catch (e) { foreign = e.code; }
    if (foreign !== "foreign_line") bad.push("foreign line not refused: " + foreign);

    // Missing owner is foreign too.
    const m = R.membership(v, [{ id: "y", kind: "one_time", unit_sell_cents: 1 }], "line");
    if (m.ok || m.foreign.length !== 1) bad.push("membership missed an ownerless line");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "recompute reads only frozen line items, returns integer cents, ignores client-claimed money, and refuses an unfrozen version or a foreign line" };
  });

  T.register("recompute service: the stored frozen bundle recomputes to the shared totals engine's result", async () => {
    const env = makeEnv();
    const s = await seedFrozen(env);
    const bad = [];
    if (!s.sent.ok) return { pass: false, detail: "seed send failed" };
    if (!s.version || !s.version.frozen_at) return { pass: false, detail: "version did not freeze" };

    const rc = await env.recompute.computeForVersion(s.version.id, []);
    if (!rc.ok) return { pass: false, detail: "computeForVersion failed: " + JSON.stringify(rc) };
    const vt = await env.versions.totals(s.version.id, []);
    if (!vt.ok) return { pass: false, detail: "versions.totals failed" };
    if (!TOT.sameTotals(rc.totals, vt.totals)) bad.push("recompute disagreed with the shared totals engine");
    if (rc.totals.one_time_cents !== 30000 || rc.totals.mrr_cents !== 20000) bad.push("stored frozen totals: " + JSON.stringify({ o: rc.totals.one_time_cents, m: rc.totals.mrr_cents }));
    if (rc.line_count !== 2) bad.push("line_count: " + rc.line_count);

    // A draft version is refused by the service too.
    const draft = await env.versions.createVersion({ quote_id: s.created.quote.id, title: "Draft" });
    const refused = await env.recompute.computeForVersion(draft.version.id, []);
    if (refused.ok || refused.code !== "not_frozen") bad.push("draft recompute not refused: " + JSON.stringify(refused));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the service loads the frozen version's own lines/groups and reproduces the single shared totals engine result; a draft is refused" };
  });

  T.register("recompute: a tampered client total is ignored and the approval stores the recomputed value", async () => {
    const env = makeEnv();
    const s = await seedFrozen(env);
    const bad = [];
    if (!s.sent.ok) return { pass: false, detail: "seed send failed" };

    const res = await env.actions.approve(s.secret, {
      selection: [],
      approver_name: "Dana Whitfield",
      one_time_cents: 1,
      totals: { one_time_cents: 1, mrr_cents: 1, twelve_month_value_cents: 2, currency: "CAD" }
    }, { ip: "203.0.113.9" });
    if (!res.ok) return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (res.totals.one_time_cents !== 30000) bad.push("approve totals took the client number: " + res.totals.one_time_cents);
    if (res.totals.mrr_cents !== 20000) bad.push("approve mrr took the client number: " + res.totals.mrr_cents);
    if (res.client_totals_ignored !== true) bad.push("approve did not report the ignored client totals");

    const g = await env.approvals.getForVersion(s.version.id);
    if (!g.ok || !g.approval) bad.push("no approval row");
    else {
      if (g.approval.one_time_cents !== 30000) bad.push("stored one_time: " + g.approval.one_time_cents);
      if (g.approval.twelve_month_value_cents !== 270000) bad.push("stored 12mo: " + g.approval.twelve_month_value_cents);
    }
    const q = await env.quotes.getQuote(s.created.quote.id, { scope: "*" });
    if (!q.ok || q.quote.approved_totals.one_time_cents !== 30000) bad.push("quote approved_totals took the client number");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a client-supplied total on the approve body is ignored; the approval record and quote carry the server-recomputed frozen totals" };
  });
})();
