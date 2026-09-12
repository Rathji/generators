(function () {
  const T = window.QU_SELFTEST;
  const QS = window.QU_STORE;
  const PV = window.QU_PORTALVIEW;
  if (!T || !QS) return;

  const REP_MAILBOX = "alex.rivera@example.com";
  const FORBIDDEN = ["cost", "margin", "markup", "profit", "snapshot", "list_price", "wholesale", "supplier", "secret", "internal", "hash"];

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
    const ns = "pab" + QS.randHex(6);
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
    const approvals = window.QU_APPROVALS.createService({ store });
    const read = window.QU_PORTALREAD.createService({ quotes, versions, portalTokens, events });
    const actions = window.QU_PORTALACTIONS.createService({ quotes, versions, portalTokens, audit, lifecycle: window.QU_LIFECYCLE, events, approvals });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send, events, approvals, read, actions };
  }

  function apiFor(env) {
    const api = window.QU_PORTAL.createApi({
      verify: (secret, at) => env.portalTokens.verify(secret, at),
      ipRate: { window_ms: 60000, max: 100000 },
      tokenRate: { window_ms: 60000, max: 100000 }
    });
    api.mountService(env.read);
    api.mountService(env.actions);
    return api;
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  async function seedSent(env, description) {
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: "Network refresh", scope: "*" });
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    await env.versions.addLine(v.version.id, { kind: "one_time", description: description || "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 });
    const g = await env.versions.addGroup(v.version.id, { name: "Warranty", selection_type: "single" });
    const opt1 = await env.versions.addLine(v.version.id, { kind: "one_time", description: "3yr cover", quantity: 1, unit_cost_cents: 1000, unit_sell_cents: 5000, optional: true, option_group_id: g.group.id, selected_by_default: false });
    const opt2 = await env.versions.addLine(v.version.id, { kind: "one_time", description: "5yr cover", quantity: 1, unit_cost_cents: 1500, unit_sell_cents: 7000, optional: true, option_group_id: g.group.id, selected_by_default: false });
    const sent = await env.send.send(created.quote.id, v.version.id, { scope: "*", actor: "rep@example.com" });
    return { created, version: v.version, group: g.group, opt1: opt1.line, opt2: opt2.line, sent, secret: secretOf(sent.link) };
  }

  function collectKeys(node, out, depth) {
    if (depth > 10 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(v => collectKeys(v, out, depth + 1)); return; }
    for (const k of Object.keys(node)) { out.push(k); collectKeys(node[k], out, depth + 1); }
  }

  T.register("portal abuse: guessed, missing and revoked tokens are refused, echo nothing, and can never approve", async () => {
    const env = makeEnv();
    const api = apiFor(env);
    const bad = [];
    const guesses = ["", "not-a-real-token", "x".repeat(300), QS.randHex(40), "0".repeat(32)];
    for (const g of guesses) {
      const seen = await api.handle({ method: "GET", path: "/view", secret: g, meta: { ip: "203.0.113.7" } });
      if (seen.status !== 404) bad.push("GET /view guess accepted (" + JSON.stringify(g).slice(0, 24) + "): " + seen.status);
      const keys = []; collectKeys(seen.body, keys, 0);
      if (keys.some(k => /secret|token_hash|hash/i.test(k))) bad.push("refusal leaked a key for guess " + JSON.stringify(g).slice(0, 24));
      if (g && JSON.stringify(seen.body).indexOf(g) !== -1) bad.push("refusal echoed the presented secret");
      const app = await api.handle({ method: "POST", path: "/approve", secret: g, body: { selection: [], approver_name: "Mallory" }, meta: { ip: "203.0.113.7" } });
      if (app.status !== 404) bad.push("POST /approve guess accepted: " + app.status);
    }

    // A real token, then revoked: reads and approvals are both refused.
    const s = await seedSent(env);
    const live = await api.handle({ method: "GET", path: "/view", secret: s.secret, meta: { ip: "203.0.113.7" } });
    if (live.status !== 200) bad.push("valid token refused: " + live.status);
    const tokenId = live.body.token && live.body.token.id;
    await env.portalTokens.revoke(tokenId, { actor: "rep" });
    const revokedRead = await api.handle({ method: "GET", path: "/view", secret: s.secret, meta: { ip: "203.0.113.7" } });
    if (revokedRead.status !== 410 || revokedRead.body.code !== "revoked") bad.push("revoked read: " + JSON.stringify(revokedRead).slice(0, 120));
    const revokedApprove = await api.handle({ method: "POST", path: "/approve", secret: s.secret, body: { approver_name: "Mallory" }, meta: { ip: "203.0.113.7" } });
    if (revokedApprove.status !== 410) bad.push("revoked approve: " + revokedApprove.status);
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "every bad/guessed/revoked token is refused with 404/410, the refusals echo neither the secret nor a hash, and none of them can approve" };
  });

  T.register("portal abuse: hostile bodies and prototype pollution are contained and never crash the portal", async () => {
    const env = makeEnv();
    const api = apiFor(env);
    const s = await seedSent(env);
    const bad = [];
    const meta = { ip: "198.51.100.20" };

    const huge = await api.handle({ method: "POST", path: "/select", secret: s.secret, body: { selection: new Array(5000).fill("ghost-id") }, meta });
    if (huge.status === 500) bad.push("5000-id selection crashed the portal");
    if (huge.status !== 200 && huge.status !== 400) bad.push("5000-id selection odd status: " + huge.status);
    if (huge.status === 200 && huge.body.selection && huge.body.selection.length > 2000) bad.push("selection was not bounded: " + huge.body.selection.length);

    const strSel = await api.handle({ method: "POST", path: "/select", secret: s.secret, body: { selection: "not-an-array" }, meta });
    if (strSel.status === 500) bad.push("string selection crashed the portal");
    if (strSel.status !== 400) bad.push("string selection should be a 400: " + strSel.status);

    const junkSel = await api.handle({ method: "POST", path: "/select", secret: s.secret, body: { selection: [null, { a: 1 }, 123, 0, false] }, meta });
    if (junkSel.status === 500) bad.push("junk-typed selection crashed the portal");

    const nullBody = await api.handle({ method: "POST", path: "/select", secret: s.secret, body: null, meta });
    if (nullBody.status !== 200 && nullBody.status !== 400) bad.push("null body status: " + nullBody.status);

    const nested = await api.handle({ method: "POST", path: "/select", secret: s.secret, body: { selection: { deep: { deeper: [1, 2, 3] } } }, meta });
    if (nested.status === 500) bad.push("nested object selection crashed the portal");

    // Prototype pollution: a JSON payload with an own "__proto__" key must not
    // contaminate Object.prototype.
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"selection":[]}');
    const pol = await api.handle({ method: "POST", path: "/select", secret: s.secret, body: polluted, meta });
    if (pol.status === 500) bad.push("__proto__ payload crashed the portal");
    if (Object.prototype.polluted !== undefined || ({}).polluted !== undefined) bad.push("Object.prototype was polluted");

    // Approve with a hostile approver name / body never 500s and never succeeds silently.
    const appr = await api.handle({ method: "POST", path: "/approve", secret: s.secret, body: { selection: s.opt1.id, approver_name: { toString() { throw new Error("boom"); } } }, meta });
    if (appr.status === 500) bad.push("object approver name crashed the portal");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "oversized, mistyped, nested and __proto__ payloads are all contained (bounded, 400 or a harmless 200); nothing 500s and Object.prototype stays clean" };
  });

  T.register("portal abuse: the client view leaks no cost and hostile text is escaped when rendered", async () => {
    const env = makeEnv();
    const api = apiFor(env);
    const bad = [];
    const s = await seedSent(env, '<img src=x onerror=alert(1)>');
    if (!s.sent.ok) return { pass: false, detail: "seed send failed" };
    const res = await api.handle({ method: "GET", path: "/view", secret: s.secret, meta: { ip: "203.0.113.30", user_agent: "UA/x" } });
    if (res.status !== 200 || !res.body.view) return { pass: false, detail: "view failed: " + JSON.stringify(res).slice(0, 160) };

    // Deep-scan the client view for any internally-named field.
    const keys = [];
    collectKeys(res.body.view, keys, 0);
    const leaked = keys.filter(k => FORBIDDEN.some(f => k.toLowerCase().indexOf(f) !== -1));
    if (leaked.length) bad.push("client view keys leaked internals: " + leaked.join(","));
    const json = JSON.stringify(res.body.view);
    if (json.indexOf(s.secret) !== -1) bad.push("client view echoed the secret");

    // The token DTO at the top level must never carry the hash/secret.
    if (res.body.token && (Object.prototype.hasOwnProperty.call(res.body.token, "token_hash") || Object.prototype.hasOwnProperty.call(res.body.token, "secret"))) bad.push("token DTO leaked a hash/secret");

    // Rendering escapes the hostile description: never a live <img>, always the entity.
    let html = "";
    try { html = PV.renderHtml(res.body.view); } catch (e) { bad.push("renderHtml threw: " + e.message); }
    if (html.indexOf("<img") !== -1) bad.push("renderHtml emitted a live <img>");
    if (html.indexOf("&lt;img") === -1) bad.push("renderHtml did not escape the description");
    if (html.indexOf("onerror") !== -1 && html.indexOf("&lt;img") === -1) bad.push("renderHtml left an unescaped onerror");

    // And the raw view still carries the text as DATA (escaped only at render time).
    const line = (res.body.view.lines || []).find(l => String(l.description).indexOf("<img") !== -1);
    if (!line) bad.push("the hostile description did not survive as data in the client view");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the client view carries no cost/margin/snapshot/hash keys and no secret, and a hostile description renders fully escaped (no live markup)" };
  });

  T.register("portal abuse: replay and expiry are enforced — single-use is consumed, expired is refused, approval happens once", async () => {
    const env = makeEnv();
    const api = apiFor(env);
    const bad = [];

    // Single-use: the first open consumes it; the second is refused as used.
    const s1 = await seedSent(env);
    const su = await env.portalTokens.mint({ quote_id: s1.created.quote.id, version_id: s1.version.id, expires_at: null, single_use: true });
    const first = await api.handle({ method: "GET", path: "/view", secret: su.secret, meta: { ip: "203.0.113.40" } });
    if (first.status !== 200 || first.body.consumed !== true) bad.push("single-use first open: " + JSON.stringify(first).slice(0, 120));
    const second = await api.handle({ method: "GET", path: "/view", secret: su.secret, meta: { ip: "203.0.113.40" } });
    if (second.status !== 410 || second.body.code !== "used") bad.push("single-use replay not refused: " + JSON.stringify(second).slice(0, 120));
    const usedApprove = await api.handle({ method: "POST", path: "/approve", secret: su.secret, body: { approver_name: "Mallory" }, meta: { ip: "203.0.113.40" } });
    if (usedApprove.status !== 410) bad.push("a used token could approve: " + usedApprove.status);

    // Expired: mint a token already past its expiry.
    const s2 = await seedSent(env);
    const past = new Date(Date.now() - 3600000).toISOString();
    const ex = await env.portalTokens.mint({ quote_id: s2.created.quote.id, version_id: s2.version.id, expires_at: past });
    const expired = await api.handle({ method: "GET", path: "/view", secret: ex.secret, meta: { ip: "203.0.113.41" } });
    if (expired.status !== 410 || expired.body.code !== "expired") bad.push("expired token: " + JSON.stringify(expired).slice(0, 120));
    const expiredApprove = await api.handle({ method: "POST", path: "/approve", secret: ex.secret, body: { approver_name: "Mallory" }, meta: { ip: "203.0.113.41" } });
    if (expiredApprove.status !== 410) bad.push("an expired token could approve: " + expiredApprove.status);

    // Approval is once: a decided version refuses a fresh link, and exactly one row exists.
    const s3 = await seedSent(env);
    const ok1 = await api.handle({ method: "POST", path: "/approve", secret: s3.secret, body: { selection: [s3.opt1.id], approver_name: "Dana Whitfield" }, meta: { ip: "203.0.113.42" } });
    if (ok1.status !== 200 || ok1.body.decision !== "approved") bad.push("first approval: " + JSON.stringify(ok1).slice(0, 140));
    const fresh = await env.portalTokens.mint({ quote_id: s3.created.quote.id, version_id: s3.version.id, expires_at: null });
    const ok2 = await api.handle({ method: "POST", path: "/approve", secret: fresh.secret, body: { approver_name: "Mallory" }, meta: { ip: "203.0.113.43" } });
    if (ok2.status === 200 && ok2.body.ok) bad.push("a second approval succeeded");
    const cnt = await env.approvals.count();
    if (cnt.count !== 1) bad.push("approval rows: " + cnt.count + " (expected 1)");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a single-use link is consumed by its first open (and cannot approve afterwards), an expired link is refused, and a decided version accepts exactly one approval no matter how many links are minted" };
  });
})();
