(function () {
  const T = window.QU_SELFTEST;
  const S = window.QU_SEND;
  const C = window.QU_CONNECTORS;
  const QS = window.QU_STORE;
  if (!T || !S || !C || !QS) return;

  const NOW = "2026-08-10T09:00:00.000Z";
  const OLD = "2026-07-01T00:00:00.000Z";
  const CONTACT_EMAIL = "dana@northwind.example";
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

  function makeEnv(opts) {
    opts = opts || {};
    const ns = "snd" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
    const audit = window.QU_AUDIT.createService({ store });
    const gateway = C.createDefault();
    const quotes = window.QU_QUOTES.createService({ store, gateway, audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store });
    const versions = window.QU_VERSIONS.createService({ store, audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store });
    const policy = Object.assign({ expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX }, opts.policy || {});
    const send = S.createService({ quotes, versions, portalTokens, priceSnapshots: prices, gateway, audit, policy, generatorName: "quote-u" });
    return { ns, store, audit, gateway, quotes, prices, versions, portalTokens, send };
  }

  async function seedQuote(env, over) {
    over = over || {};
    const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", title: over.title || "Network refresh", scope: "*" });
    if (!created.ok) throw new Error("seed createQuote failed: " + JSON.stringify(created));
    const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
    if (!v.ok) throw new Error("seed createVersion failed: " + JSON.stringify(v));
    const line = await env.versions.addLine(v.version.id, Object.assign({ kind: "one_time", description: "Router", quantity: 2, unit_cost_cents: 9000, unit_sell_cents: 15000 }, over.line || {}));
    if (!line.ok) throw new Error("seed addLine failed: " + JSON.stringify(line));
    return { quoteId: created.quote.id, versionId: v.version.id, lineId: line.line.id, quote: created.quote };
  }

  function secretOf(link) {
    const i = String(link).indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(String(link).slice(i + 4));
  }

  T.register("send pipeline: policy, expiry, staleness and the email body are pure and configurable", () => {
    const bad = [];
    const def = S.normalizePolicy(null);
    if (def.expiry_days !== 30 || def.stale_cost_days !== 7) bad.push("defaults: " + JSON.stringify(def));
    const tuned = S.normalizePolicy({ expiry_days: 14, stale_cost_days: 3, default_from_mailbox: "x@y" });
    if (tuned.expiry_days !== 14 || tuned.stale_cost_days !== 3 || tuned.default_from_mailbox !== "x@y") bad.push("overrides: " + JSON.stringify(tuned));
    const junk = S.normalizePolicy({ expiry_days: -5, stale_cost_days: "nope" });
    if (junk.expiry_days !== 30 || junk.stale_cost_days !== 7) bad.push("junk fell through: " + JSON.stringify(junk));
    if (S.expiryFrom("2026-08-10T00:00:00.000Z", 30) !== "2026-09-09T00:00:00.000Z") bad.push("expiryFrom: " + S.expiryFrom("2026-08-10T00:00:00.000Z", 30));
    if (S.expiryFrom("2026-08-10T00:00:00.000Z", 0) !== "2026-08-10T00:00:00.000Z") bad.push("zero-day expiry");
    if (S.expiryFrom("2026-08-10T00:00:00.000Z", -1) !== null) bad.push("negative expiry should be null");

    const oldSnap = { id: "ps-old", captured_at: OLD, source: "distributor" };
    const freshSnap = { id: "ps-new", captured_at: "2026-08-09T00:00:00.000Z", source: "manual" };
    const lines = [
      { id: "li-old", price_snapshot_ref: "ps-old", description: "Old" },
      { id: "li-new", price_snapshot_ref: "ps-new", description: "New" },
      { id: "li-manual", price_snapshot_ref: null, description: "Manual" }
    ];
    const stale = S.staleLines({ lines, snapshots: { "ps-old": oldSnap, "ps-new": freshSnap }, stale_cost_days: 7, now: NOW });
    if (stale.length !== 1 || stale[0].line_id !== "li-old") bad.push("staleLines: " + JSON.stringify(stale));
    else if (Math.abs(stale[0].age_days - 40.4) > 0.2) bad.push("age_days: " + stale[0].age_days);
    if (S.staleLines({ lines, snapshots: { "ps-old": oldSnap, "ps-new": freshSnap }, stale_cost_days: 60, now: NOW }).length !== 0) bad.push("a wider window should clear staleness");

    const email = S.composeEmail({
      quote: { company_name: "Northwind Systems", contact_name: "Dana Whitfield", quote_number: "Q-0001", title: "Network refresh" },
      version: { id: "v-1" },
      contact_name: "Dana Whitfield",
      link: "https://perchance.org/quote-u#/q/abc",
      from: REP_MAILBOX,
      from_name: "Alex Rivera",
      expires_at: "2026-09-09T00:00:00.000Z"
    });
    if (email.to !== "" ) bad.push("composeEmail should leave `to` to the caller: " + JSON.stringify(email.to));
    if (email.subject.indexOf("Q-0001") === -1) bad.push("subject: " + email.subject);
    if (email.body.indexOf("https://perchance.org/quote-u#/q/abc") === -1) bad.push("body missing the link");
    if (email.body.indexOf("2026-09-09") === -1) bad.push("body missing the expiry");
    if (email.version_id !== "v-1" || email.from !== REP_MAILBOX) bad.push("composeEmail envelope: " + JSON.stringify(email));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "policy normalizes defaults/overrides/junk; expiry is day-accurate; staleness reports only snapshots older than the window; the email carries the link and expiry" };
  });

  T.register("send pipeline: send freezes, mints provenance, delivers as the rep and marks the quote sent last", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];

    const pre = await env.send.preflight(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!pre.ok) return { pass: false, detail: "preflight: " + JSON.stringify(pre) };
    if (pre.rep.mailbox !== REP_MAILBOX || pre.rep.source !== "directory") bad.push("rep resolution: " + JSON.stringify(pre.rep));
    if (pre.stale.length !== 0) bad.push("fresh quote reported stale");

    const res = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!res.ok) return { pass: false, detail: "send: " + JSON.stringify(res) };
    const secret = secretOf(res.link);
    if (!secret || !/^[0-9a-f]{64}$/.test(secret)) bad.push("link secret: " + res.link);
    if (res.link.indexOf("https://perchance.org/quote-u#/q/") !== 0) bad.push("link host/route: " + res.link);
    if (res.expires_at !== "2026-09-09T09:00:00.000Z") bad.push("expiry: " + res.expires_at);
    if (res.steps.map(s => s.step).join(",") !== "freeze,token,deliver,mark_sent") bad.push("step order: " + res.steps.map(s => s.step).join(","));
    if (!res.steps[0].minted || res.steps[0].minted !== 1) bad.push("freeze did not mint the hand-priced line: " + JSON.stringify(res.steps[0]));

    // Task 17: every hand-priced line now carries complete price provenance.
    const lines = await env.versions.listLines(seed.versionId);
    const line = lines.lines[0];
    if (!line.price_snapshot_ref || line.pricing_mode !== "snapshot") bad.push("line provenance not backfilled: " + JSON.stringify(line));
    const snap = await env.prices.get(line.price_snapshot_ref);
    if (!snap.ok || !snap.snapshot) bad.push("minted snapshot missing");
    else if (snap.snapshot.source !== "manual" || snap.snapshot.unit_cost_cents !== 9000 || snap.snapshot.list_price_cents !== 15000) bad.push("minted snapshot content: " + JSON.stringify(snap.snapshot));

    // The frozen version is immutable, sealed and still totals correctly.
    const v = await env.versions.getVersion(seed.versionId);
    if (!v.ok || !window.QU_VERSIONS.isFrozen(v.version) || !v.version.frozen_seal) bad.push("version not frozen/sealed");
    const verify = await env.versions.verify();
    if (!verify.ok || verify.count !== 1) bad.push("frozen verify: " + JSON.stringify(verify));

    // The portal token verifies and points at the frozen version.
    const tv = await env.portalTokens.verify(secret, NOW);
    if (!tv.ok || tv.token.version_id !== seed.versionId) bad.push("portal token verify: " + JSON.stringify(tv));

    // Exactly one email, sent from the rep's own mailbox, carrying the link.
    const outbox = env.gateway.call("mail", "list", { quote_id: seed.quoteId }, { scope: "*" });
    if (!outbox.ok || outbox.result.length !== 1) bad.push("outbox: " + JSON.stringify(outbox && outbox.result));
    else {
      const msg = outbox.result[0];
      if (msg.to !== CONTACT_EMAIL) bad.push("email recipient: " + msg.to);
      if (msg.from !== REP_MAILBOX) bad.push("email sender must be the rep: " + msg.from);
      if (msg.link !== res.link) bad.push("email link mismatch");
      if (String(msg.body).indexOf(res.link) === -1) bad.push("email body missing the link");
    }

    // The quote is marked sent LAST, pointing at the frozen version + live token.
    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (!q.ok || q.quote.status !== "sent") bad.push("quote status: " + JSON.stringify(q.quote && q.quote.status));
    else {
      if (q.quote.sent_version_id !== seed.versionId) bad.push("sent_version_id");
      if (q.quote.portal_token_id !== res.token_id) bad.push("portal_token_id");
      if (q.quote.delivered_to !== CONTACT_EMAIL || q.quote.delivered_from !== REP_MAILBOX) bad.push("delivery envelope");
      if (q.quote.expires_at !== res.expires_at) bad.push("quote expiry");
    }

    // The audit log remembers the send and the email.
    const log = await env.audit.list({ quote_id: seed.quoteId });
    const events = log.ok ? log.records.map(r => r.event) : [];
    if (events.indexOf("sent") === -1) bad.push("no sent event: " + events.join(","));
    if (events.indexOf("email_sent") === -1) bad.push("no email_sent event");

    // Re-sending a sent quote is refused; the link can be revoked.
    const again = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (again.ok || again.code !== "already_sent") bad.push("second send not refused: " + JSON.stringify(again.code));
    const link = await env.send.linkState(q.quote, NOW);
    if (!link.ok || link.state !== "active") bad.push("linkState: " + JSON.stringify(link));
    const rv = await env.send.revokeLinks(seed.quoteId, { actor: "rep1" });
    if (!rv.ok || rv.count !== 1) bad.push("revokeLinks: " + JSON.stringify(rv));
    const st = await env.send.linkState(q.quote, NOW);
    if (st.state !== "revoked") bad.push("revoked link still active: " + JSON.stringify(st));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "preflight resolves the rep; send freezes + mints provenance, mints a token, emails from the rep's mailbox, then marks the quote sent; the frozen bundle verifies; a sent quote cannot be re-sent and its link can be revoked" };
  });

  T.register("send pipeline: resend re-issues a fresh link and revokes the prior one", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];
    const first = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!first.ok) return { pass: false, detail: "send: " + JSON.stringify(first) };
    const firstSecret = secretOf(first.link);

    const second = await env.send.resend(seed.quoteId, { actor: "rep1", scope: "*", at: NOW });
    if (!second.ok) return { pass: false, detail: "resend: " + JSON.stringify(second) };
    const secondSecret = secretOf(second.link);
    if (secondSecret === firstSecret) bad.push("resend reused the secret");
    if (second.token_id === first.token_id) bad.push("resend reused the token id");

    const oldToken = await env.portalTokens.verify(firstSecret, NOW);
    if (oldToken.ok || oldToken.code !== "revoked") bad.push("prior link not revoked: " + JSON.stringify(oldToken.code));
    const newToken = await env.portalTokens.verify(secondSecret, NOW);
    if (!newToken.ok) bad.push("new link invalid: " + JSON.stringify(newToken));

    const outbox = env.gateway.call("mail", "list", { quote_id: seed.quoteId }, { scope: "*" });
    if (!outbox.ok || outbox.result.length !== 2) bad.push("outbox after resend: " + JSON.stringify(outbox && outbox.result && outbox.result.length));
    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (!q.ok || q.quote.portal_token_id !== second.token_id) bad.push("quote still points at the old token");

    const version = await env.versions.getVersion(seed.versionId);
    if (!version.ok || !window.QU_VERSIONS.isFrozen(version.version)) bad.push("resend changed the frozen version");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "resend revokes the prior token and emails a brand-new link without touching the frozen version" };
  });

  T.register("send pipeline: stale costs block the send until explicitly acknowledged", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];

    // Pin the line to an old snapshot so its provenance is stale but present.
    const oldSnap = await env.prices.capture({ source: "distributor", distributor_sku: "SKU-1", unit_cost_cents: 9000, list_price_cents: 15000, captured_at: OLD });
    if (!oldSnap.ok) return { pass: false, detail: "old snapshot: " + JSON.stringify(oldSnap) };
    const pinned = await env.versions.updateLine(seed.versionId, seed.lineId, { price_snapshot_ref: oldSnap.snapshot.id, pricing_mode: "snapshot" });
    if (!pinned.ok) return { pass: false, detail: "pin: " + JSON.stringify(pinned) };

    const pre = await env.send.preflight(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!pre.ok) bad.push("preflight should succeed with a warning: " + JSON.stringify(pre));
    if (pre.stale.length !== 1) bad.push("preflight stale: " + JSON.stringify(pre.stale));
    if (!pre.warnings.some(w => w.code === "stale_costs")) bad.push("no stale warning");

    const refused = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (refused.ok || refused.code !== "stale_costs") bad.push("stale send not refused: " + JSON.stringify(refused.code));
    if (refused.stale.length !== 1) bad.push("stale payload missing");
    const stillDraft = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (stillDraft.quote.status !== "draft") bad.push("stale send mutated the quote: " + stillDraft.quote.status);
    if (env.gateway.call("mail", "list", {}, { scope: "*" }).result.length !== 0) bad.push("stale send emailed anyway");

    const acked = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW, acknowledgeStale: true });
    if (!acked.ok) return { pass: false, detail: "acknowledged send: " + JSON.stringify(acked) };
    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (q.quote.status !== "sent") bad.push("acknowledged send did not send");
    if (!q.quote.stale_acknowledged) bad.push("stale_acknowledged not recorded");
    if (!Array.isArray(q.quote.stale_costs) || q.quote.stale_costs.indexOf(oldSnap.snapshot.id) === -1) bad.push("stale_costs not recorded: " + JSON.stringify(q.quote.stale_costs));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a cost snapshot older than the window warns at preflight, blocks the send until acknowledgeStale is set, and is then recorded on the quote rather than silently sent" };
  });

  T.register("send pipeline: a delivery failure leaves no half-sent quote", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];
    env.gateway.connectors.mail.functions.send = function () {
      const e = new Error("smtp is down");
      e.code = "smtp_down";
      throw e;
    };

    const res = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (res.ok) return { pass: false, detail: "send succeeded despite a delivery failure" };
    if (res.step !== "deliver" || res.code !== "smtp_down") bad.push("failure shape: " + JSON.stringify({ step: res.step, code: res.code }));

    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (q.quote.status !== "draft") bad.push("quote left half-sent: " + q.quote.status);
    if (q.quote.sent_version_id || q.quote.portal_token_id) bad.push("quote carries send markers after a failed send");

    // No link survives the failed attempt: the freshly-minted token is revoked.
    const tokens = await env.portalTokens.listForQuote(seed.quoteId);
    if (!tokens.ok || tokens.tokens.length !== 1) bad.push("token count: " + JSON.stringify(tokens && tokens.tokens && tokens.tokens.length));
    else if (!tokens.tokens[0].revoked_at) bad.push("failed send left a live token: " + JSON.stringify(tokens.tokens[0]));
    const active = await env.portalTokens.activeForVersion(seed.versionId, NOW);
    if (!active.ok || active.token !== null) bad.push("an active token remained after a failed send");

    const outbox = env.gateway.call("mail", "list", {}, { scope: "*" });
    if (outbox.result.length !== 0) bad.push("failed send recorded an email");
    const log = await env.audit.list({ quote_id: seed.quoteId });
    if (!log.ok || !log.records.some(r => r.event === "link_revoked")) bad.push("compensation not audited");

    // Retrying (once delivery is healthy) completes from the frozen version.
    env.gateway.connectors.mail.functions.send = C.createMockMail().functions.send;
    const retry = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!retry.ok) return { pass: false, detail: "retry: " + JSON.stringify(retry) };
    if (!retry.steps.some(s => s.step === "freeze" && s.skipped === "already_frozen")) bad.push("retry did not reuse the frozen version");
    const q2 = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (q2.quote.status !== "sent") bad.push("retry did not send");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "a delivery failure revokes the new token, audits it, leaves the quote a draft with no send markers, and a retry resumes from the frozen version" };
  });

  T.register("send pipeline: preflight blocks an unsendable quote before anything is written", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];
    const auditBefore = (await env.audit.list({ quote_id: seed.quoteId })).records.length;

    const noRepEnv = makeEnv({ policy: { default_from_mailbox: "" } });
    const seed2 = await seedQuote(noRepEnv);
    const noRep = await noRepEnv.send.preflight(seed2.quoteId, seed2.versionId, { actor: "nobody", scope: "*", at: NOW });
    if (noRep.ok || !noRep.blockers.some(b => b.code === "no_rep_mailbox")) bad.push("no_rep_mailbox: " + JSON.stringify(noRep.blockers));

    await env.quotes.updateQuote(seed.quoteId, { contact_email: null });
    const noEmail = await env.send.preflight(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (noEmail.ok || !noEmail.blockers.some(b => b.code === "no_contact_email")) bad.push("no_contact_email: " + JSON.stringify(noEmail.blockers));
    await env.quotes.updateQuote(seed.quoteId, { contact_email: CONTACT_EMAIL });

    const mismatch = await env.send.preflight(seed.quoteId, "v-ghost", { actor: "rep1", scope: "*", at: NOW });
    if (mismatch.ok || mismatch.code !== "version_not_found") bad.push("version_not_found: " + JSON.stringify(mismatch.code));

    const other = await env.versions.createVersion({ quote_id: "q-other", title: "Elsewhere" });
    const cross = await env.send.preflight(seed.quoteId, other.version.id, { actor: "rep1", scope: "*", at: NOW });
    if (cross.ok || cross.code !== "version_mismatch") bad.push("version_mismatch: " + JSON.stringify(cross.code));

    const empty = S.createService({ policy: { default_from_mailbox: REP_MAILBOX } });
    const notConfigured = await empty.preflight(seed.quoteId, seed.versionId, {});
    if (notConfigured.ok || notConfigured.code !== "not_configured") bad.push("not_configured: " + JSON.stringify(notConfigured.code));

    // A preflight refusal never writes an audit event or a quote change.
    const log = await env.audit.list({ quote_id: seed.quoteId });
    if (log.ok && log.records.length !== auditBefore) bad.push("preflight wrote audit events: " + log.records.length);
    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (q.quote.status !== "draft") bad.push("preflight changed the quote status");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "preflight reports no rep mailbox, no contact email, a missing/mismatched version and an unconfigured pipeline — all before writing anything" };
  });

  T.register("send pipeline: sending a revised version supersedes and revokes the prior link", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];
    const first = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!first.ok) return { pass: false, detail: "first send: " + JSON.stringify(first) };
    const firstSecret = secretOf(first.link);

    const rev = await env.versions.revise(seed.versionId, { actor: "rep1" });
    if (!rev.ok) return { pass: false, detail: "revise: " + JSON.stringify(rev) };
    if (rev.version.frozen_at) bad.push("revision should start as an editable draft");

    const second = await env.send.send(seed.quoteId, rev.version.id, { actor: "rep1", scope: "*", at: NOW, allowSupersede: true });
    if (!second.ok) return { pass: false, detail: "superseding send: " + JSON.stringify(second) };
    if (second.superseded_version_id !== seed.versionId) bad.push("superseded_version_id: " + second.superseded_version_id);
    if (!second.revoked_prior || second.revoked_prior.indexOf(first.token_id) === -1) bad.push("prior token not revoked: " + JSON.stringify(second.revoked_prior));
    if (!second.steps.some(s => s.step === "revoke_prior")) bad.push("no revoke_prior step");

    const oldToken = await env.portalTokens.verify(firstSecret, NOW);
    if (oldToken.ok || oldToken.code !== "revoked") bad.push("prior link still live: " + JSON.stringify(oldToken.code));
    const newSecret = secretOf(second.link);
    if (!newSecret || newSecret === firstSecret) bad.push("no fresh secret on the revision");
    const newToken = await env.portalTokens.verify(newSecret, NOW);
    if (!newToken.ok || newToken.token.version_id !== rev.version.id) bad.push("new link invalid: " + JSON.stringify(newToken));

    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (q.quote.sent_version_id !== rev.version.id || q.quote.portal_token_id !== second.token_id) bad.push("quote not repointed at the revision");

    // The prior version stays frozen and read-only for audit.
    const v1 = await env.versions.getVersion(seed.versionId);
    if (!v1.ok || !window.QU_VERSIONS.isFrozen(v1.version)) bad.push("prior version is no longer frozen");
    const srcLines = await env.versions.listLines(seed.versionId);
    if (!srcLines.ok || srcLines.lines.length !== 1) bad.push("prior version lines changed");
    const log = await env.audit.list({ quote_id: seed.quoteId });
    const events = log.ok ? log.records.map(r => r.event) : [];
    if (events.indexOf("revised") === -1) bad.push("revision not audited");

    // Re-sending the SAME current version is still refused (no silent re-send).
    const again = await env.send.send(seed.quoteId, rev.version.id, { actor: "rep1", scope: "*", at: NOW });
    if (again.ok || again.code !== "already_sent") bad.push("re-send of the current version not refused: " + JSON.stringify(again.code));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "sending a revised version re-issues a fresh link, revokes the prior version's link, repoints the quote, and leaves the prior frozen version + events intact for audit" };
  });

  T.register("send pipeline: reissue revises and re-issues the link in one ordered operation", async () => {
    const env = makeEnv();
    const seed = await seedQuote(env);
    const bad = [];
    const first = await env.send.send(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!first.ok) return { pass: false, detail: "first send: " + JSON.stringify(first) };
    const firstSecret = secretOf(first.link);

    const res = await env.send.reissue(seed.quoteId, seed.versionId, { actor: "rep1", scope: "*", at: NOW });
    if (!res.ok) return { pass: false, detail: "reissue: " + JSON.stringify(res) };
    if (res.revised_from !== seed.versionId) bad.push("revised_from: " + res.revised_from);
    if (!res.revision || res.revision.version_number !== 2) bad.push("revision version number: " + JSON.stringify(res.revision && res.revision.version_number));
    if (!window.QU_VERSIONS.isFrozen(res.version)) bad.push("reissued version not frozen");
    if (res.steps.map(s => s.step).join(",").indexOf("revise") !== 0) bad.push("steps do not start with revise: " + res.steps.map(s => s.step).join(","));

    const oldToken = await env.portalTokens.verify(firstSecret, NOW);
    if (oldToken.ok || oldToken.code !== "revoked") bad.push("prior link not revoked: " + JSON.stringify(oldToken.code));
    const newSecret = secretOf(res.link);
    if (!newSecret || newSecret === firstSecret) bad.push("reissue did not mint a fresh secret");
    const newToken = await env.portalTokens.verify(newSecret, NOW);
    if (!newToken.ok || newToken.token.version_id !== res.version.id) bad.push("reissued link invalid");
    const q = await env.quotes.getQuote(seed.quoteId, { scope: "*" });
    if (q.quote.status !== "sent" || q.quote.sent_version_id !== res.version.id) bad.push("quote not sent on the revision");

    // reissue on a quote with no sent version is refused.
    const fresh = await seedQuote(env);
    const notSent = await env.send.reissue(fresh.quoteId, null, { actor: "rep1", scope: "*", at: NOW });
    if (notSent.ok || notSent.code !== "not_sent") bad.push("reissue of an unsent quote: " + JSON.stringify(notSent.code));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "reissue performs revise → send in order, re-issuing the link and revoking the prior one, and refuses when there is no sent version" };
  });
})();
