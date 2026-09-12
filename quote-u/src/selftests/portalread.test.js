(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const R = window.QU_PORTALREAD;
  if (!T || !QS || !R) return;

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
    const ns = "prd" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const read = R.createService({ quotes, versions, portalTokens });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, read };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  // Send a quote with one required line and one single-select option line off by
  // default; returns the frozen version, the group, the option line and the link.
  async function seedSent(env) {
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Network refresh", scope: "*" });
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    const base = await env.versions.addLine(v.version.id, { kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 });
    const g = await env.versions.addGroup(v.version.id, { name: "Warranty", selection_type: "single" });
    const opt = await env.versions.addLine(v.version.id, { kind: "one_time", description: "3yr cover", quantity: 1, unit_cost_cents: 1000, unit_sell_cents: 5000, optional: true, option_group_id: g.group.id, selected_by_default: false });
    const sent = await env.send.send(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    return { created, version: v.version, base: base.line, group: g.group, opt: opt.line, sent, secret: secretOf(sent.link) };
  }

  T.register("portal read: returns the frozen client-safe view and a token DTO with no secret/hash", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];
    if (!s.sent.ok) return { pass: false, detail: "seed send failed: " + JSON.stringify(s.sent).slice(0, 200) };
    const res = await env.read.read(s.secret);
    if (!res.ok) return { pass: false, detail: "read failed: " + JSON.stringify(res) };
    const view = res.view;
    if (view.totals.one_time_cents !== 30000) bad.push("one_time=" + view.totals.one_time_cents);
    if (view.totals.mrr_cents !== 0) bad.push("mrr=" + view.totals.mrr_cents);
    if (!res.quote || res.quote.status !== "sent") bad.push("quote status: " + JSON.stringify(res.quote));
    const json = JSON.stringify(res);
    ["unit_cost_cents", "unit_cost", "margin", "markup", "price_snapshot_ref", "token_hash"].forEach(k => {
      if (json.indexOf('"' + k + '"') !== -1) bad.push("response contains " + k);
    });
    if (Object.prototype.hasOwnProperty.call(res.token, "token_hash")) bad.push("token DTO carries token_hash");
    if (res.token.id === undefined || res.token.id === null) bad.push("token DTO missing id");
    if (res.version.frozen_at === null || res.version.frozen_at === undefined) bad.push("version not reported frozen");
    if (JSON.stringify(res).indexOf(s.secret) !== -1) bad.push("response echoed the plaintext secret");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the frozen client view is returned with shared totals; cost/margin/snapshot/hash are all absent and the plaintext secret is never echoed" };
  });

  T.register("portal read: revoked, expired, unknown and single-use links are refused with the right status", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];

    const unknown = await env.read.read("definitely-not-a-token");
    if (unknown.ok || unknown.status !== 404) bad.push("unknown secret: " + JSON.stringify(unknown));

    const first = await env.read.read(s.secret);
    if (!first.ok) bad.push("initial read failed");
    const rv = await env.portalTokens.revoke(first.token.id, { actor: "rep" });
    if (!rv.ok) bad.push("revoke failed");
    const revoked = await env.read.read(s.secret);
    if (revoked.ok || revoked.status !== 410 || revoked.code !== "revoked") bad.push("revoked: " + JSON.stringify(revoked));

    // Expired: mint a token that is already past its expiry.
    const past = new Date(Date.now() - 3600000).toISOString();
    const m = await env.portalTokens.mint({ quote_id: s.created.quote.id, version_id: s.version.id, expires_at: past });
    const expired = await env.read.read(m.secret);
    if (expired.ok || expired.status !== 410 || expired.code !== "expired") bad.push("expired: " + JSON.stringify(expired));

    // Single-use: the first open consumes it; the second is refused.
    const su = await env.portalTokens.mint({ quote_id: s.created.quote.id, version_id: s.version.id, expires_at: null, single_use: true });
    const suFirst = await env.read.read(su.secret);
    if (!suFirst.ok || suFirst.consumed !== true) bad.push("single-use first open: " + JSON.stringify(suFirst));
    const suSecond = await env.read.read(su.secret);
    if (suSecond.ok || suSecond.status !== 410 || suSecond.code !== "used") bad.push("single-use second open: " + JSON.stringify(suSecond));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "unknown → 404; revoked/expired → 410; a single-use link is consumed by its first open and refused afterwards" };
  });

  T.register("portal read: refuses an unfrozen version and the GET /view route serves the same DTO", async () => {
    const env = makeEnv();
    const bad = [];
    // An editable draft must never be exposed, even if a token somehow points at it.
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Draft only", scope: "*" });
    const draft = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    await env.versions.addLine(draft.version.id, { kind: "one_time", description: "X", quantity: 1, unit_sell_cents: 100 });
    const dm = await env.portalTokens.mint({ quote_id: created.quote.id, version_id: draft.version.id, expires_at: null });
    const draftRead = await env.read.read(dm.secret);
    if (draftRead.ok || draftRead.status !== 409 || draftRead.code !== "not_frozen") bad.push("unfrozen version: " + JSON.stringify(draftRead));

    // The read route returns the same client-safe DTO through the API dispatcher.
    const s = await seedSent(env);
    const api = window.QU_PORTAL.createApi({ verify: (secret, at) => env.portalTokens.verify(secret, at), ipRate: { max: 100 }, tokenRate: { max: 100 } });
    api.mountService(env.read);
    const res = await api.handle({ method: "GET", path: "/view", secret: s.secret, meta: {} });
    if (res.status !== 200 || !res.body.ok || !res.body.view) bad.push("GET /view: " + JSON.stringify(res).slice(0, 200));
    else if (res.body.view.totals.one_time_cents !== 30000) bad.push("route totals: " + res.body.view.totals.one_time_cents);
    else if (JSON.stringify(res.body).indexOf('"unit_cost_cents"') !== -1) bad.push("route leaked cost");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "an unfrozen version is refused (409 not_frozen); the GET /view API route serves the identical client-safe DTO" };
  });
})();
