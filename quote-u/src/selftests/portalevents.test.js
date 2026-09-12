(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const E = window.QU_PORTALEVENTS;
  if (!T || !QS || !E) return;

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
    const ns = "pev" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX };
    const send = window.QU_SEND.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    const events = E.createService({ audit });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, events, read, actions };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  // One required line ($300) plus a single-select group with two options.
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

  T.register("portal events: the first open records one viewed event with the token id, IP and user agent — never the secret", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];
    if (!s.sent.ok) return { pass: false, detail: "seed send failed: " + JSON.stringify(s.sent).slice(0, 200) };
    const meta = { ip: "203.0.113.9", user_agent: "Mozilla/5.0 (abuse-suite)" };
    const r1 = await env.read.read(s.secret, meta);
    if (!r1.ok) return { pass: false, detail: "read failed: " + JSON.stringify(r1) };
    const r2 = await env.read.read(s.secret, meta);
    if (!r2.ok) bad.push("second open failed");

    const log = await env.audit.forVersion(s.version.id, { event: "viewed" });
    if (!log.ok) bad.push("audit read failed");
    else if (log.records.length !== 1) bad.push("viewed events: " + log.records.length + " (expected 1)");
    else {
      const v = log.records[0];
      if (String(v.token_id) !== String(r1.token.id)) bad.push("token id mismatch: " + v.token_id);
      if (v.actor_type !== "portal") bad.push("actor_type: " + v.actor_type);
      if (v.ip !== "203.0.113.9") bad.push("ip: " + v.ip);
      if (String(v.user_agent).indexOf("abuse-suite") === -1) bad.push("user agent not recorded");
      if (JSON.stringify(v).indexOf(s.secret) !== -1) bad.push("the audit event echoed the plaintext secret");
      if (Object.prototype.hasOwnProperty.call(v, "token")) bad.push("the audit event carries a token field");
    }

    const sum = await env.events.summary(s.version.id);
    if (!sum.ok) bad.push("summary failed");
    else {
      if (sum.events !== 1) bad.push("summary events: " + sum.events);
      const t = sum.tokens[String(r1.token.id)];
      if (!t || t.view_count !== 1) bad.push("summary view_count: " + JSON.stringify(sum.tokens));
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "opening a link emits exactly one viewed event (deduped across re-opens) carrying the token id, IP and user agent, and never the secret" };
  });

  T.register("portal events: option changes are recorded and an unchanged selection is deduped", async () => {
    const env = makeEnv();
    const s = await seedSent(env);
    const bad = [];
    const e1 = await env.actions.select(s.secret, [s.opt1.id], { ip: "198.51.100.4", user_agent: "UA/2" });
    if (!e1.ok) return { pass: false, detail: "select failed: " + JSON.stringify(e1) };
    const e2 = await env.actions.select(s.secret, [s.opt1.id], { ip: "198.51.100.4", user_agent: "UA/2" });
    if (!e2.ok) bad.push("second select failed");
    const e3 = await env.actions.select(s.secret, [s.opt2.id], { ip: "198.51.100.4", user_agent: "UA/2" });
    if (!e3.ok) bad.push("third select failed");

    const log = await env.audit.forVersion(s.version.id, { event: "option_changed" });
    if (!log.ok) bad.push("audit read failed");
    else if (log.records.length !== 2) bad.push("option_changed events: " + log.records.length + " (expected 2; the repeat must be deduped)");
    else {
      const last = log.records[log.records.length - 1];
      if (!last.token_id) bad.push("option_changed event has no token id");
      if (!last.detail || !Array.isArray(last.detail.selection) || last.detail.selection.indexOf(s.opt2.id) === -1) bad.push("selection detail: " + JSON.stringify(last.detail));
      if (JSON.stringify(log.records).indexOf(s.secret) !== -1) bad.push("an option_changed event echoed the secret");
    }

    const sum = await env.events.summary(s.version.id);
    if (!sum.ok) bad.push("summary failed");
    else {
      const t = sum.tokens[String(e1.token.id)];
      if (!t || t.option_changes !== 2) bad.push("summary option_changes: " + JSON.stringify(sum.tokens));
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "each real change to the selection emits one option_changed event with the token id and selected ids; resending an unchanged selection records nothing" };
  });

  T.register("portal events: helpers bound hostile metadata and compare selections order-independently", async () => {
    const bad = [];
    if (E.clampText("  hi  ", 10) !== "hi") bad.push("clampText should trim: " + JSON.stringify(E.clampText("  hi  ", 10)));
    if (E.clampText("", 10) !== null) bad.push("clampText('') should be null");
    if (E.clampText(null, 10) !== null) bad.push("clampText(null) should be null");
    if (E.clampText("x".repeat(500), E.MAX_UA_LEN).length !== E.MAX_UA_LEN) bad.push("clampText did not truncate to MAX_UA_LEN");
    if (E.selectionOf("not-an-array").length !== 0) bad.push("a non-array selection should be empty");
    const sel = E.selectionOf(["b", "a", "b", null, "a", "c"]);
    if (sel.join(",") !== "a,b,c") bad.push("selectionOf should dedupe + sort: " + sel.join(","));
    if (!E.sameSelection(["b", "a"], ["a", "b"])) bad.push("sameSelection should ignore order");
    if (E.sameSelection(["a"], ["a", "b"])) bad.push("sameSelection should catch differing lengths");
    const meta = E.cleanMeta({ ip: "1.2.3.4", userAgent: "UA" });
    if (meta.ip !== "1.2.3.4" || meta.user_agent !== "UA") bad.push("cleanMeta: " + JSON.stringify(meta));
    const ev = E.eventFor(E.VIEWED, { quote_id: "q", version_id: "v", token_id: "t" }, { ip: "1.1.1.1", user_agent: "UA" });
    if (ev.event !== "viewed" || ev.actor_type !== "portal" || ev.token_id !== "t") bad.push("eventFor viewed: " + JSON.stringify(ev));
    const oc = E.eventFor(E.OPTION_CHANGED, { quote_id: "q", version_id: "v", token_id: "t", selection: ["l2", "l1"] }, { ip: "1.1.1.1" });
    if (oc.event !== "option_changed" || !oc.detail || oc.detail.count !== 2) bad.push("eventFor option_changed: " + JSON.stringify(oc));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "metadata is trimmed/truncated, selections are deduped + order-independent, and eventFor builds a portal event carrying the token id" };
  });
})();
