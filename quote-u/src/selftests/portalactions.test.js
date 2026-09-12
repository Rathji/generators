(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const A = window.QU_PORTALACTIONS;
  const L = window.QU_LIFECYCLE;
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
    const ns = "pac" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const actions = A.createService({ quotes, versions, portalTokens, audit, lifecycle: L });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  // One required one-time line ($300), plus a single-select group with TWO
  // mutually exclusive options ($50 and $70, both off by default).
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

  T.register("portal select: validates single-select groups and recomputes display totals", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];
    if (!s.sent.ok) return { pass: false, detail: "seed send failed" };

    const none = await env.actions.select(s.secret, []);
    if (!none.ok || none.totals.one_time_cents !== 30000) bad.push("no options: " + JSON.stringify(none.totals));

    const one = await env.actions.select(s.secret, [s.opt1.id]);
    if (!one.ok || one.totals.one_time_cents !== 35000) bad.push("one option: " + JSON.stringify(one.totals));
    const viewLine = one.view && (one.view.lines || []).find(l => l.id === s.opt1.id);
    if (!viewLine || viewLine.selected !== true) bad.push("selected option not flagged in the view");

    const both = await env.actions.select(s.secret, [s.opt1.id, s.opt2.id]);
    if (both.ok || both.code !== "single_select_conflict") bad.push("single-select conflict not refused: " + JSON.stringify(both));
    if (!both.violations || !both.violations.length) bad.push("conflict carried no violations");

    const unknown = await env.actions.select("nope", []);
    if (unknown.ok || unknown.status !== 404) bad.push("unknown token: " + JSON.stringify(unknown));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "select recomputes display-only totals and refuses two lines from one single-select group" };
  });

  T.register("portal approve: typed name required, server-validated, audited, frozen version untouched", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];

    const noName = await env.actions.approve(s.secret, { selection: [s.opt1.id] });
    if (noName.ok || noName.code !== "approver_required") bad.push("missing name accepted: " + JSON.stringify(noName));

    const res = await env.actions.approve(s.secret, { selection: [s.opt1.id], approver_name: "Dana Whitfield" });
    if (!res.ok || res.decision !== "approved") return { pass: false, detail: "approve failed: " + JSON.stringify(res) };
    if (res.totals.one_time_cents !== 35000) bad.push("approved totals: " + res.totals.one_time_cents);

    const q = await env.quotes.getQuote(s.created.quote.id, { scope: "*" });
    if (!q.ok || !q.quote || q.quote.status !== "approved") bad.push("quote status: " + JSON.stringify(q.quote && q.quote.status));
    if (q.quote.approver_name !== "Dana Whitfield") bad.push("approver name not stored");

    // The frozen version must be byte-identical (the seal still verifies).
    const verify = await env.versions.verify();
    if (!verify.ok) bad.push("frozen seal broke: " + JSON.stringify(verify.breaks));
    const g = await env.versions.getVersion(s.version.id);
    if (!g.ok || !g.version.frozen_at || g.version.state !== s.version.state) bad.push("frozen version was mutated");

    // Audited as a portal event carrying the token id (never a secret).
    const log = await env.audit.forVersion(s.version.id);
    const approved = log.records.filter(r => r.event === "approved");
    if (!approved.length) bad.push("no approved audit event");
    else if (approved[0].actor_type !== "portal") bad.push("approved actor_type: " + approved[0].actor_type);
    else if (!approved[0].token_id) bad.push("approved event has no token id");
    else if (JSON.stringify(approved[0]).indexOf(s.secret) !== -1) bad.push("audit leaked the secret");

    // Once decided, the link is revoked and a second decision is refused.
    const token = await env.portalTokens.getById(approved[0].token_id);
    if (token.ok && token.token && !token.token.revoked_at) bad.push("link not revoked after approval");
    const again = await env.actions.approve(s.secret, { selection: [], approver_name: "Dana" });
    if (again.ok) bad.push("a second approval was accepted");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "approve requires a typed name, flips the quote to approved, audits a portal event with the token id, revokes the link, and leaves the frozen version sealed and untouched" };
  });

  T.register("portal approve: an authoritative server veto wins and the quote stays undecided", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];
    if (!L) return { pass: true, skip: true, detail: "QU_LIFECYCLE is not loaded" };
    const previous = typeof L.getServerValidator === "function" ? L.getServerValidator() : null;
    try {
      L.attachServerValidator(async () => ({ ok: false, code: "server_veto", detail: "The server refused this transition." }));
      const res = await env.actions.approve(s.secret, { selection: [s.opt1.id], approver_name: "Dana" });
      if (res.ok) bad.push("vetoed approval was accepted");
      else if (res.code !== "server_veto") bad.push("veto code: " + JSON.stringify(res));
      const q = await env.quotes.getQuote(s.created.quote.id, { scope: "*" });
      if (q.quote && q.quote.status !== "sent") bad.push("quote moved despite the veto: " + q.quote.status);
    } finally {
      if (previous) L.attachServerValidator(previous);
      else L.detachServerValidator();
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a server refusal stops the approval and no client state changes (fail-closed)" };
  });

  T.register("portal decline, expire and the API routes server-validate the decision", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];

    // Expire is refused before the expiry date, then honoured once past it.
    const early = await env.actions.expire(s.secret);
    if (early.ok || early.code !== "not_expired") bad.push("early expire: " + JSON.stringify(early));
    const late = await env.actions.expire(s.secret, { force: true });
    if (!late.ok || late.decision !== "expired") bad.push("forced expire: " + JSON.stringify(late));
    const qExp = await env.quotes.getQuote(s.created.quote.id, { scope: "*" });
    if (qExp.quote.status !== "expired") bad.push("quote not expired: " + qExp.quote.status);

    // A fresh quote declines through the API dispatcher (POST /decline).
    const s2 = await seedSent(env);
    const api = window.QU_PORTAL.createApi({ verify: (secret, at) => env.portalTokens.verify(secret, at), ipRate: { max: 100 }, tokenRate: { max: 100 } });
    api.mountService(env.actions);
    const declined = await api.handle({ method: "POST", path: "/decline", secret: s2.secret, body: { reason: "Too expensive" }, meta: {} });
    if (declined.status !== 200 || declined.body.decision !== "declined") bad.push("POST /decline: " + JSON.stringify(declined).slice(0, 200));
    const q = await env.quotes.getQuote(s2.created.quote.id, { scope: "*" });
    if (q.quote.status !== "declined" || q.quote.decline_reason !== "Too expensive") bad.push("decline not stored: " + JSON.stringify({ status: q.quote.status, reason: q.quote.decline_reason }));

    // Unknown token over the API still default-denies.
    const missing = await api.handle({ method: "POST", path: "/decline", secret: "nope", body: {}, meta: {} });
    if (missing.status !== 404) bad.push("unknown token: " + missing.status);

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "expire refuses early and succeeds past expiry; decline runs through the API route and is stored; an unknown token stays 404" };
  });
})();
