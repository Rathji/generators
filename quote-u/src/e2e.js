// ============================================================================
// quote-u — end-to-end harness (roadmap task 63)
// ----------------------------------------------------------------------------
// A Playwright-class end-to-end scenario that runs INSIDE the app on the
// self-test runner (there is no browser automation here): it builds a quote,
// sends it, opens the client portal, toggles an option group, approves, and
// then proves the downstream consequences and the portal's abuse posture.
//
// The scenario runs against a self-contained, mock-data environment (its own
// document-store namespace + the mock connector adapters), so it exercises the
// real service graph without touching the user's data. It is the "CI" gate:
// `runScenario()` on demand plus `bootSmoke()` against the live booted shell.
// ============================================================================
window.QU_E2E = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const REP_MAILBOX = "alex.rivera@example.com";

  const SCENARIO = Object.freeze([
    "build",
    "send",
    "open",
    "toggle",
    "approve",
    "downstream",
    "abuse"
  ]);

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
          f = { text: text, key: "ek." + name, count: 0 };
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

  function secretOf(link) {
    const s = String(link || "");
    const i = s.indexOf("#/q/");
    return i === -1 ? null : decodeURIComponent(s.slice(i + 4));
  }

  // Build the full service graph over an isolated namespace with the mock
  // connector adapters — the same wiring app.js performs, minus the platform.
  function createHarness(opts) {
    opts = opts || {};
    const QS = window.QU_STORE;
    const ns = opts.ns || "e2e-" + QS.randHex(8);
    const store = QS.create({
      ns: ns,
      kv: makeKv(new Map()),
      editable: makeEditable(new Map()),
      modules: QS.DEFAULT_MODULES
    });
    const audit = window.QU_AUDIT.createService({ store: store });
    const gateway = window.QU_CONNECTORS.createDefault();
    const quotes = window.QU_QUOTES.createService({ store: store, gateway: gateway, audit: audit, scope: "*" });
    const prices = window.QU_PRICESNAPSHOTS.createService({ store: store });
    const versions = window.QU_VERSIONS.createService({ store: store, audit: audit, priceSnapshots: prices });
    const portalTokens = window.QU_PORTALTOKENS.createService({ store: store });
    const send = window.QU_SEND.createService({
      quotes: quotes, versions: versions, portalTokens: portalTokens, priceSnapshots: prices,
      gateway: gateway, audit: audit,
      policy: { expiry_days: 30, stale_cost_days: 7, default_from_mailbox: REP_MAILBOX },
      generatorName: "quote-u"
    });
    const recompute = window.QU_RECOMPUTE.createService({ versions: versions });
    const events = window.QU_PORTALEVENTS.createService({ audit: audit });
    const approvals = window.QU_APPROVALS.createService({ store: store });
    const outbox = window.QU_OUTBOX.createService({ store: store });
    const approvalPolicy = { auto_close: true, won_stage: "won", fallback_stage: "closed_pending" };
    const oppSync = window.QU_OPPSYNC.createService({ outbox: outbox, gateway: gateway, quotes: quotes, audit: audit, policy: approvalPolicy, scope: "*" });
    const oppNote = window.QU_OPPNOTE.createService({ outbox: outbox, gateway: gateway, quotes: quotes, versions: versions, priceSnapshots: prices, audit: audit, policy: approvalPolicy, scope: "*" });
    const revenue = window.QU_REVENUE.createService({ outbox: outbox, gateway: gateway, quotes: quotes, versions: versions, audit: audit, policy: approvalPolicy, scope: "*" });
    const invoiceIntents = window.QU_INVOICEINTENTS.createService({ store: store });
    const invoiceDirect = window.QU_INVOICEDIRECT.createService({ outbox: outbox, gateway: gateway, invoiceIntents: invoiceIntents, quotes: quotes, versions: versions, audit: audit, scope: "*" });
    const portalApi = window.QU_PORTAL.createApi({ verify: (secret, at) => portalTokens.verify(secret, at) });
    const portalRead = window.QU_PORTALREAD.createService({ quotes: quotes, versions: versions, portalTokens: portalTokens, events: events });
    portalApi.mountService(portalRead);
    const portalActions = window.QU_PORTALACTIONS.createService({
      quotes: quotes, versions: versions, portalTokens: portalTokens, audit: audit, lifecycle: window.QU_LIFECYCLE,
      events: events, approvals: approvals, recompute: recompute, outbox: outbox,
      oppSync: oppSync, oppNote: oppNote, revenue: revenue
    });
    portalApi.mountService(portalActions);
    return {
      ns: ns, store: store, audit: audit, gateway: gateway, quotes: quotes, prices: prices, versions: versions,
      portalTokens: portalTokens, send: send, recompute: recompute, events: events, approvals: approvals,
      outbox: outbox, oppSync: oppSync, oppNote: oppNote, revenue: revenue, invoiceIntents: invoiceIntents,
      invoiceDirect: invoiceDirect, portalApi: portalApi, portalRead: portalRead, portalActions: portalActions
    };
  }

  function callPortal(env, method, path, secret, body) {
    return env.portalApi.handle({
      method: method,
      path: path,
      secret: secret,
      body: body || {},
      meta: { remote_addr: "203.0.113.9", user_agent: "quote-u-e2e/1.0" },
      at: new Date().toISOString()
    });
  }

  function hasCostLeak(value) {
    const PV = window.QU_PORTALVIEW;
    if (!PV || typeof PV.audit !== "function") return null;
    const a = PV.audit(value);
    return a.ok ? null : a.violations.map(v => v.path + " (" + v.reason + ")");
  }

  // Run the scenario. Returns { ok, steps:[{name,ok,detail}], summary }.
  async function runScenario(opts) {
    opts = opts || {};
    const env = opts.env || createHarness(opts);
    const steps = [];
    const state = {};
    function step(name, fn) {
      return Promise.resolve()
        .then(() => fn())
        .then(res => { steps.push({ name: name, ok: res.ok !== false, detail: res.detail || "" }); if (res.ok === false) throw new Error("step " + name + " failed: " + res.detail); return res; });
    }

    try {
      await step("build", async () => {
        const created = await env.quotes.createQuote({ company_id: "c1", contact_id: "ct1", opportunity_id: "op1", title: "E2E network refresh", scope: "*" });
        if (!created.ok) return { ok: false, detail: JSON.stringify(created) };
        const v = await env.versions.createVersion({ quote_id: created.quote.id, quote_number: created.quote.quote_number, title: created.quote.title });
        if (!v.ok) return { ok: false, detail: JSON.stringify(v) };
        await env.versions.addLine(v.version.id, { kind: "one_time", description: "Firewall", quantity: 1, unit_cost_cents: 78000, unit_sell_cents: 105000 });
        await env.versions.addLine(v.version.id, { kind: "mrr", description: "Managed IT", quantity: 1, unit_cost_cents: 10000, unit_sell_cents: 20000 });
        const group = await env.versions.addGroup(v.version.id, { name: "Support tier", selection_type: "bundle" });
        if (!group.ok) return { ok: false, detail: JSON.stringify(group) };
        const basic = await env.versions.addLine(v.version.id, { kind: "mrr", description: "Basic support", quantity: 1, unit_cost_cents: 2000, unit_sell_cents: 5000, optional: true, selected_by_default: true, option_group_id: group.group.id });
        const premium = await env.versions.addLine(v.version.id, { kind: "mrr", description: "Premium support", quantity: 1, unit_cost_cents: 6000, unit_sell_cents: 15000, optional: true, selected_by_default: false, option_group_id: group.group.id });
        if (!basic.ok || !premium.ok) return { ok: false, detail: "option-group line add failed" };
        state.quote = created.quote;
        state.versionId = v.version.id;
        state.groupId = group.group.id;
        state.basicId = basic.line.id;
        state.premiumId = premium.line.id;
        return { detail: "quote " + created.quote.quote_number + " with 4 lines and a bundle group" };
      });

      await step("send", async () => {
        const sent = await env.send.send(state.quote.id, state.versionId, { scope: "*", actor: REP_MAILBOX });
        if (!sent.ok) return { ok: false, detail: JSON.stringify(sent) };
        const secret = secretOf(sent.link);
        if (!secret) return { ok: false, detail: "no portal secret in the sent link" };
        const g = await env.versions.getVersion(state.versionId);
        if (!g.ok || !g.version.frozen_at) return { ok: false, detail: "the sent version is not frozen" };
        state.secret = secret;
        state.sentLink = sent.link;
        return { detail: "frozen + sent; link minted" };
      });

      await step("open", async () => {
        const res = await callPortal(env, "GET", "/view", state.secret);
        if (res.status !== 200 || !res.body || !res.body.view) return { ok: false, detail: "GET /view returned " + res.status };
        const leak = hasCostLeak(res.body.view);
        if (leak) return { ok: false, detail: "the portal view leaks " + leak.join(", ") };
        state.openedView = res.body.view;
        // The default selection should include Basic support (selected_by_default).
        const ids = (res.body.view.lines || []).map(l => l.id);
        if (ids.indexOf(state.basicId) === -1) return { ok: false, detail: "the default selection is missing the default option" };
        return { detail: "client view served, cost/margin clean, default option selected" };
      });

      await step("toggle", async () => {
        // The bundle group admits at most one member, so asking for both is
        // refused outright — a client cannot smuggle two bundle members in.
        const conflict = await callPortal(env, "POST", "/select", state.secret, { selection: [state.basicId, state.premiumId].filter(Boolean) });
        if (conflict.status !== 400) return { ok: false, detail: "an over-limit bundle selection returned " + conflict.status + " (expected 400)" };
        if (conflict.body && conflict.body.code !== "bundle_select_conflict") return { ok: false, detail: "over-limit code was " + (conflict.body && conflict.body.code) };
        // A real toggle switches the bundle to the other member and is accepted.
        const res = await callPortal(env, "POST", "/select", state.secret, { selection: [state.premiumId].filter(Boolean) });
        if (res.status !== 200) return { ok: false, detail: "POST /select returned " + res.status };
        const leak = hasCostLeak(res.body.view);
        if (leak) return { ok: false, detail: "the toggled view leaks " + leak.join(", ") };
        // The always-on lines stay selected; only the bundle membership moves.
        const selected = res.body.selection || [];
        if (selected.indexOf(state.premiumId) === -1) return { ok: false, detail: "premium is not selected after the switch: " + JSON.stringify(selected) };
        if (selected.indexOf(state.basicId) !== -1) return { ok: false, detail: "basic is still selected after switching to premium: " + JSON.stringify(selected) };
        state.toggledSelection = selected;
        return { detail: "an over-limit bundle selection was refused (400), a switch to premium was accepted" };
      });

      await step("approve", async () => {
        const res = await callPortal(env, "POST", "/approve", state.secret, { selection: state.toggledSelection, approver_name: "Dana Whitfield" });
        if (res.status !== 200 || res.body.ok === false) return { ok: false, detail: "POST /approve returned " + res.status + " " + JSON.stringify(res.body && res.body.code) };
        const q = await env.quotes.getQuote(state.quote.id, { scope: "*" });
        if (!q.ok || q.quote.status !== "approved") return { ok: false, detail: "the quote status is " + (q.quote && q.quote.status) };
        return { detail: "approved by typed name; quote status is approved" };
      });

      await step("downstream", async () => {
        await env.outbox.runDue();
        const problems = [];
        const list = await env.approvals.list({});
        if (!list.ok || list.approvals.length !== 1) problems.push("approvals=" + (list.approvals && list.approvals.length));
        const ver = await env.versions.verify();
        if (!ver.ok) problems.push("frozen verify failed: " + JSON.stringify(ver.breaks));
        const opp = env.gateway.call("psa", "getOpportunity", { id: "op1" }, { scope: "*" });
        if (!opp.ok || opp.result.stage !== "won") problems.push("opportunity stage=" + (opp.result && opp.result.stage));
        else if (!Number.isSafeInteger(opp.result.amount_cents) || opp.result.amount_cents <= 0) problems.push("opportunity amount=" + opp.result.amount_cents);
        const notes = env.gateway.call("psa", "getOpportunityNotes", { id: "op1" }, { scope: "*" });
        if (!notes.ok || !notes.result.note_count) problems.push("no opportunity note written");
        const rev = env.gateway.call("psa", "getRevenueLines", { id: "op1" }, { scope: "*" });
        if (!rev.ok || !rev.result.line_count) problems.push("no revenue lines written");
        const log = await env.audit.list({});
        const events = log.ok ? log.records.map(r => r.event) : [];
        ["created", "sent", "viewed", "approved", "opp_updated", "note_written", "products_written"].forEach(e => {
          if (events.indexOf(e) === -1) problems.push("missing audit event " + e);
        });
        const jobs = await env.outbox.list({});
        const failed = jobs.ok ? jobs.jobs.filter(j => j.state === "failed" || j.state === "pending") : [];
        if (failed.length) problems.push(failed.length + " outbox job(s) not done");
        // The direct invoicing path creates exactly one intent + invoice. It
        // only accepts the real frozen version record (a bare id is not proof).
        const frozenVersion = await env.versions.getVersion(state.versionId);
        const enq = await env.invoiceDirect.enqueueForVersion({ quote_id: state.quote.id, version: frozenVersion.version });
        if (!enq.ok) problems.push("invoice enqueue failed: " + JSON.stringify(enq));
        await env.outbox.runDue();
        const intents = await env.invoiceIntents.list({});
        if (!intents.ok || intents.intents.length !== 1) problems.push("invoice intents=" + (intents.intents && intents.intents.length));
        const invCnt = env.gateway.call("accounting", "invoiceCount", {}, { scope: "*" });
        if (invCnt.result !== 1) problems.push("accounting invoices=" + invCnt.result);
        return problems.length ? { ok: false, detail: problems.join(" | ") } : { detail: "one approval, seal intact, opportunity won, note + revenue written, invoice created, audit trail complete" };
      });

      await step("abuse", async () => {
        const problems = [];
        // The link was revoked on approval — a replay is dead.
        const replay = await callPortal(env, "GET", "/view", state.secret);
        if (replay.status !== 410 && replay.status !== 404) problems.push("replayed link returned " + replay.status);
        // A second approval is refused.
        const again = await callPortal(env, "POST", "/approve", state.secret, { approver_name: "Mallory" });
        if (again.status === 200) problems.push("a second approval was accepted");
        // A guessed secret is denied without echoing anything.
        const guess = await callPortal(env, "GET", "/view", "deadbeef".repeat(8));
        if (guess.status !== 404) problems.push("guessed token returned " + guess.status);
        return problems.length ? { ok: false, detail: problems.join(" | ") } : { detail: "replay refused, second approval refused, guessed token denied" };
      });
    } catch (e) {
      // A step failure is recorded (the throwing step already pushed its entry).
    }

    const failedSteps = steps.filter(s => !s.ok);
    return {
      ok: steps.length === SCENARIO.length && failedSteps.length === 0,
      engine: "QU_E2E",
      version: VERSION,
      ns: env.ns,
      steps: steps,
      summary: { total: steps.length, passed: steps.length - failedSteps.length, failed: failedSteps.length, expected: SCENARIO.length }
    };
  }

  // Boot smoke: the live shell rendered and offers every station.
  function bootSmoke(doc) {
    const d = doc || (typeof document !== "undefined" ? document : null);
    const problems = [];
    if (!window.QU) problems.push("window.QU is not defined");
    if (!d) return { ok: false, nav: 0, problems: ["no document"], generator: window.generatorName || null };
    const root = d.getElementById("viewRoot");
    if (!root) problems.push("the view root is missing");
    const nav = d.querySelectorAll("#sideNav .side-link").length;
    if (nav < 9) problems.push("expected at least 9 stations, found " + nav);
    if (root && root.dataset.state !== "ready") problems.push("the view root state is " + root.dataset.state);
    const store = window.QU && window.QU.store;
    if (!store) problems.push("the document store did not initialise");
    return { ok: problems.length === 0, nav: nav, problems: problems, generator: window.generatorName || null };
  }

  return {
    VERSION,
    SCENARIO,
    REP_MAILBOX,
    createHarness: createHarness,
    runScenario: runScenario,
    bootSmoke: bootSmoke,
    secretOf: secretOf,
    hasCostLeak: hasCostLeak
  };
})();
