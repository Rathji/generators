/* ============================================================================
   PSA-U — public API, webhooks & the pipeline bus (Phase 12 · Task 55)

   PSA-U is a first-class citizen of the small-business pipeline: it publishes
   its domain events in the shared versioned envelope and consumes the same
   envelope from its neighbours.

     • API        — a versioned, permission-checked surface (ERP.api.call) over
                    the engines the app already owns. Every endpoint declares
                    the permission it needs; nothing is exposed implicitly.
                    `describe()` is the machine-readable catalogue.
     • EVENTS     — the catalogue of domain events (ticket created/closed,
                    agreement renewed, invoice posted, SLA breached, …) that
                    other tools may subscribe to.
     • WEBHOOKS   — subscriptions stored in the provider document (kind
                    "webhook"): a URL, a set of events, an active flag and a
                    signing secret. Each outbound POST is recorded as a
                    "webhookDelivery" with its attempts and result.
     • BUS        — `publish()` is called from the workflow funnel for every
                    domain event; it wraps the event in the shared envelope,
                    appends it to a bounded bus log (kind "pipelineEvent") and
                    delivers it to every matching webhook. `consume()` accepts
                    an inbound envelope from another tool and routes it to a
                    handler (create a ticket, record a payment, sync a
                    configuration, ingest an alert).

   Delivery is retried with the same exponential backoff the integration
   framework uses (`ERP.integrations.backoff`), and a failure to deliver never
   breaks the domain action that emitted the event.
   ============================================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const A = (ERP.api = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("api requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();

  A.API_VERSION = "v1";
  A.VERSION = "1.0.0";
  A.DOC_KINDS = { webhook: "webhook", delivery: "webhookDelivery", event: "pipelineEvent" };
  A.BUS_LIMIT = 500;

  /* ─────────────────────────── event catalogue ─────────────────────────── */

  A.EVENTS = [
    { id: "ticket.created", label: "Ticket created", entity: "ticket" },
    { id: "ticket.updated", label: "Ticket updated", entity: "ticket" },
    { id: "ticket.status_changed", label: "Ticket status changed", entity: "ticket" },
    { id: "ticket.assigned", label: "Ticket assigned", entity: "ticket" },
    { id: "ticket.closed", label: "Ticket closed", entity: "ticket" },
    { id: "ticket.reopened", label: "Ticket reopened", entity: "ticket" },
    { id: "ticket.note_added", label: "Internal note added", entity: "ticket" },
    { id: "ticket.customer_update", label: "Customer update sent", entity: "ticket" },
    { id: "ticket.merged", label: "Ticket merged", entity: "ticket" },
    { id: "ticket.breached", label: "SLA breached", entity: "ticket" },
    { id: "ticket.at_risk", label: "SLA at risk", entity: "ticket" },
    { id: "appointment.scheduled", label: "Appointment scheduled", entity: "appointment" },
    { id: "appointment.updated", label: "Appointment updated", entity: "appointment" },
    { id: "appointment.completed", label: "Appointment completed", entity: "appointment" },
    { id: "appointment.cancelled", label: "Appointment cancelled", entity: "appointment" },
    { id: "agreement.activated", label: "Agreement activated", entity: "agreement" },
    { id: "agreement.charge_posted", label: "Agreement charge posted", entity: "agreement" },
    { id: "agreement.renewed", label: "Agreement renewed", entity: "agreement" },
    { id: "agreement.expired", label: "Agreement expired", entity: "agreement" },
    { id: "agreement.terminated", label: "Agreement terminated", entity: "agreement" },
    { id: "invoice.created", label: "Invoice created", entity: "invoice" },
    { id: "invoice.posted", label: "Invoice posted", entity: "invoice" },
    { id: "invoice.void", label: "Invoice voided", entity: "invoice" },
    { id: "invoice.paid", label: "Invoice paid", entity: "invoice" },
    { id: "invoice.partially_paid", label: "Invoice partially paid", entity: "invoice" },
    { id: "payment.received", label: "Payment received", entity: "payment" },
    { id: "project.created", label: "Project created", entity: "project" },
    { id: "project.status_changed", label: "Project status changed", entity: "project" },
    { id: "project.activated", label: "Project activated", entity: "project" },
    { id: "project.on_hold", label: "Project on hold", entity: "project" },
    { id: "project.completed", label: "Project completed", entity: "project" },
    { id: "project.milestone_ready", label: "Project milestone ready", entity: "project" },
    { id: "project.milestone_invoiced", label: "Project milestone invoiced", entity: "project" },
    { id: "opportunity.created", label: "Opportunity created", entity: "opportunity" },
    { id: "opportunity.stage_changed", label: "Opportunity stage changed", entity: "opportunity" },
    { id: "opportunity.won", label: "Opportunity won", entity: "opportunity" },
    { id: "opportunity.lost", label: "Opportunity lost", entity: "opportunity" },
    { id: "configuration.created", label: "Configuration created", entity: "configuration" },
    { id: "configuration.updated", label: "Configuration updated", entity: "configuration" },
    { id: "configuration.drift", label: "Configuration drift", entity: "configuration" },
    { id: "kb.article_created", label: "Article created", entity: "article" },
    { id: "kb.article_updated", label: "Article updated", entity: "article" },
    { id: "kb.article_published", label: "Article published", entity: "article" },
    { id: "kb.article_archived", label: "Article archived", entity: "article" },
    { id: "kb.ticket_drafted", label: "Article drafted from ticket", entity: "article" },
    { id: "approval.requested", label: "Approval requested", entity: "approval" },
    { id: "approval.approved", label: "Approval approved", entity: "approval" },
    { id: "approval.rejected", label: "Approval rejected", entity: "approval" },
    { id: "approval.cancelled", label: "Approval cancelled", entity: "approval" },
    { id: "approval.expired", label: "Approval expired", entity: "approval" },
    { id: "approval.reminder", label: "Approval reminder", entity: "approval" },
    { id: "alert.received", label: "Monitoring alert received", entity: "alert" },
    { id: "alert.repeated", label: "Monitoring alert repeated", entity: "alert" },
    { id: "alert.ticket_created", label: "Alert raised a ticket", entity: "alert" },
    { id: "alert.resolved", label: "Monitoring alert resolved", entity: "alert" },
    { id: "report.delivered", label: "Report delivered", entity: "reportDelivery" },
  ];
  A.eventIds = () => A.EVENTS.map((e) => e.id);

  /* ─────────────────────────── API surface ─────────────────────────── */

  function endpoint(method, path, permission, desc, handler) {
    return { method: method, path: path, permission: permission, desc: desc, handler: handler };
  }

  A.ENDPOINTS = [
    endpoint("GET", "tickets.list", "tickets.view", "List tickets (optionally for one client).", (pid, p) => ERP.tickets.listAll(p || {})),
    endpoint("GET", "tickets.get", "tickets.view", "Fetch one ticket.", (pid, p) => ERP.tickets.get(p.companyId, p.id)),
    endpoint("POST", "tickets.create", "tickets.edit", "Create a ticket.", (pid, p) => ERP.tickets.save(p.companyId, ERP.tickets.newTicket(Object.assign({}, p, { companyId: p.companyId })))),
    endpoint("POST", "tickets.note", "tickets.edit", "Add a note to a ticket.", (pid, p) => ERP.tickets.addNote(p.companyId, p.ticketId, p)),
    endpoint("GET", "companies.list", "companies.view", "List client companies.", () => ERP.companies.list()),
    endpoint("GET", "agreements.list", "agreements.view", "List agreements.", (pid, p) => ERP.agreements.list(pid, p || {})),
    endpoint("POST", "agreements.renew", "agreements.edit", "Renew an agreement.", (pid, p) => ERP.agreements.renew(pid, p.id, p.opts || {})),
    endpoint("GET", "invoices.list", "billing.view", "List invoices.", (pid) => ERP.billing.all(pid)),
    endpoint("POST", "invoices.post", "billing.post", "Post a draft invoice.", (pid, p) => ERP.billing.post(pid, p.id, p.opts || {})),
    endpoint("POST", "payments.record", "payments.edit", "Record a payment against a posted invoice.", (pid, p) => ERP.payments.record(pid, p)),
    endpoint("GET", "projects.list", "projects.view", "List projects.", (pid, p) => ERP.projects.list(pid, p || {})),
    endpoint("GET", "opportunities.list", "sales.view", "List opportunities.", (pid, p) => ERP.sales.list(pid, p || {})),
    endpoint("GET", "catalog.list", "catalog.view", "List catalog items.", (pid) => ERP.catalog.items(pid)),
    endpoint("GET", "reports.sources", "reports.view", "List the report sources.", () => (ERP.reports.SOURCES || []).map((s) => ({ id: s.id, label: s.label }))),
    endpoint("POST", "reports.run", "reports.view", "Run a saved report.", (pid, p) => ERP.reports.runSaved(pid, p.id)),
    endpoint("GET", "bi.extract", "reports.view", "Produce the schema-stable BI extract.", (pid, p) => ERP.bi.extract(pid, p || {})),
    endpoint("GET", "integrity.lint", "integrity.view", "Run the data-integrity linter.", (pid, p) => ERP.integrity.lint(pid, p || {})),
    endpoint("GET", "events.catalog", "api.view", "List subscribable events.", () => A.EVENTS),
  ];

  A.endpoint = (path) => A.ENDPOINTS.find((e) => e.path === path) || null;
  A.describe = () => A.ENDPOINTS.map((e) => ({ method: e.method, path: e.path, permission: e.permission, desc: e.desc }));

  /* Call an endpoint. Returns { ok, result, envelope } or { error }. */
  A.call = async function (path, params, opts) {
    opts = opts || {};
    params = params || {};
    if (opts.version && opts.version !== A.API_VERSION) return { error: "unsupported_version", version: A.API_VERSION };
    const ep = A.endpoint(path);
    if (!ep) return { error: "not_found", path: path };
    if (opts.method && ep.method !== String(opts.method).toUpperCase()) return { error: "bad_method", expected: ep.method };
    if (ep.permission && !opts.system && !ERP.security.can(ep.permission, { companyId: params.companyId })) return { error: "forbidden", permission: ep.permission };
    const pid = opts.pid != null ? opts.pid : await ten().providerId();
    try {
      const result = await ep.handler(pid, params, opts);
      return {
        ok: true,
        result: result,
        envelope: ERP.envelope("api.response", { method: ep.method, path: ep.path, result: result }, { apiVersion: A.VERSION }),
      };
    } catch (e) {
      return { error: "handler_failed", message: (e && e.message) || String(e) };
    }
  };

  /* ─────────────────────────── webhooks ─────────────────────────── */

  function randomSecret() {
    const bytes = new Uint8Array(24);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  A.newWebhook = (over) => Object.assign({
    kind: A.DOC_KINDS.webhook, name: "", url: "", events: [], secret: randomSecret(),
    active: true, createdAt: nowIso(),
  }, over || {});

  A.webhooks = (pid) => ten().records("provider", pid, A.DOC_KINDS.webhook);
  A.webhook = async (pid, id) => (await A.webhooks(pid)).find((w) => String(w.id) === String(id)) || null;

  A.saveWebhook = async function (pid, rec, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("api.manage")) return { error: "forbidden" };
    const incoming = Object.assign(A.newWebhook(), rec);
    if (!incoming.name) return { error: "name_required" };
    if (!/^https?:\/\//i.test(incoming.url || "")) return { error: "url_required" };
    if (!Array.isArray(incoming.events) || !incoming.events.length) return { error: "events_required" };
    const bad = incoming.events.filter((e) => A.eventIds().indexOf(e) === -1);
    if (bad.length) return { error: "unknown_event", events: bad };
    if (!opts.system && !incoming.secret) incoming.secret = randomSecret();
    const existing = incoming.id != null ? await A.webhook(pid, incoming.id) : null;
    if (!existing && incoming.id == null) incoming.id = ten().nextId(await ten().records("provider", pid));
    await ten().upsert("provider", pid, incoming);
    return { record: incoming, created: !existing };
  };
  A.removeWebhook = (pid, id) => ten().remove("provider", pid, (r) => r.kind === A.DOC_KINDS.webhook && String(r.id) === String(id));
  A.toggleWebhook = async function (pid, id, on, opts) {
    const w = await A.webhook(pid, id);
    if (!w) return { error: "not_found" };
    return A.saveWebhook(pid, Object.assign({}, w, { active: on == null ? !w.active : !!on }), opts);
  };
  A.matchingWebhooks = async (pid, event) => (await A.webhooks(pid)).filter((w) => w.active && (w.events || []).indexOf(event) !== -1);

  /* ─────────────────────────── signing & delivery ─────────────────────────── */

  A.sign = async function (secret, timestamp, body) {
    const data = String(timestamp) + "." + String(body == null ? "" : body);
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(String(secret || "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
      return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      let h = 5381;
      for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) >>> 0;
      return "fallback-" + h.toString(16);
    }
  };

  A.deliveries = async (pid, query) => {
    query = query || {};
    let list = (await ten().records("provider", pid, A.DOC_KINDS.delivery)).slice().reverse();
    if (query.webhookId) list = list.filter((d) => String(d.webhookId) === String(query.webhookId));
    if (query.event) list = list.filter((d) => d.event === query.event);
    return query.limit ? list.slice(0, query.limit) : list;
  };

  async function defaultTransport(url, init) {
    const f = (window.root && root.superFetch) || window.fetch;
    if (!f) return { status: 0, error: "no_fetch" };
    const res = await f(url, init);
    return { status: res && res.status != null ? res.status : 200, ok: res ? res.ok !== false : true };
  }

  /* POST one envelope to one webhook, retried with backoff, and record it. */
  A.deliver = async function (pid, webhook, envelope, opts) {
    opts = opts || {};
    const body = JSON.stringify(envelope);
    const timestamp = Date.now();
    const signature = webhook.secret ? await A.sign(webhook.secret, timestamp, body) : "";
    const transport = opts.transport || defaultTransport;
    const policy = Object.assign({}, (ERP.integrations && ERP.integrations.RETRY) || {}, opts.policy || {});
    const res = await (ERP.integrations ? ERP.integrations.withRetry : fallbackRetry)(async () => {
      const r = await transport(webhook.url, {
        method: "POST", headers: { "Content-Type": "application/json", "X-PSA-Event": envelope.event || envelope.kind || "", "X-PSA-Signature": signature, "X-PSA-Timestamp": String(timestamp) },
        body: body,
      });
      if (r && (r.error || (r.status && r.status >= 400))) throw new Error((r && r.error) || ("http_" + r.status));
      return r;
    }, { policy: policy, sleep: opts.sleep });

    const rec = {
      kind: A.DOC_KINDS.delivery, webhookId: webhook.id, webhookName: webhook.name, url: webhook.url,
      event: envelope.event || envelope.kind || "", status: res.ok ? "delivered" : "failed", attempts: res.attempts,
      at: nowIso(), bytes: body.length, signature: signature ? signature.slice(0, 12) + "…" : "", error: res.ok ? null : String(res.error),
    };
    if (!opts.dryRun) {
      rec.id = ten().nextId(await ten().records("provider", pid));
      await ten().upsert("provider", pid, rec);
    }
    return rec;
  };

  function fallbackRetry(fn, opts) {
    const p = Object.assign({ maxAttempts: 3, baseDelayMs: 0 }, (opts && opts.policy) || {});
    return (async () => {
      let last = null;
      for (let i = 1; i <= p.maxAttempts; i++) {
        try { const v = await fn(i); return { ok: true, value: v, attempts: i }; } catch (e) { last = e; }
      }
      return { ok: false, error: (last && last.message) || "failed", attempts: p.maxAttempts };
    })();
  }

  /* ─────────────────────────── the bus ─────────────────────────── */

  A.busEvents = async (pid, query) => {
    query = query || {};
    let list = (await ten().records("provider", pid, A.DOC_KINDS.event)).slice().reverse();
    if (query.event) list = list.filter((e) => e.event === query.event);
    return query.limit ? list.slice(0, query.limit) : list;
  };
  A.clearBus = (pid) => ten().remove("provider", pid, (r) => r.kind === A.DOC_KINDS.event);

  function entityOf(ctx) {
    const keys = ["ticket", "invoice", "agreement", "payment", "project", "opportunity", "quote", "approval", "configuration", "article", "appointment"];
    for (const k of keys) if (ctx && ctx[k]) return { kind: k, id: ctx[k].id, number: ctx[k].number || null };
    return {};
  }

  /* Build the outbound envelope for a domain event. */
  A.eventEnvelope = function (event, ctx) {
    const entity = entityOf(ctx);
    return ERP.envelope("event", {
      event: event,
      entity: entity,
      entityKind: entity.kind || null,
      entityId: entity.id != null ? entity.id : null,
      companyId: (ctx && (ctx.companyId != null ? ctx.companyId : (ctx.company && ctx.company.id))) || null,
      actor: ctx && ctx.actor ? { memberId: ctx.actor.memberId, role: ctx.actor.role } : null,
      sla: (ctx && ctx.sla) || null,
    }, { event: event, apiVersion: A.VERSION });
  };

  /* Publish a domain event onto the bus. Called from ERP.workflow.emit, so it
     must never throw into the domain path. */
  A.publish = async function (event, ctx, opts) {
    opts = opts || {};
    try {
      if (!ERP.tenancy) return { skipped: "no_tenancy" };
      const pid = ctx && ctx.providerId != null ? ctx.providerId : await ten().providerId();
      if (pid == null) return { skipped: "no_provider" };
      const envelope = A.eventEnvelope(event, ctx || {});
      const payload = JSON.stringify(envelope);
      const rec = {
        kind: A.DOC_KINDS.event, event: event, entityKind: envelope.entityKind, entityId: envelope.entityId,
        companyId: envelope.companyId, at: envelope.generatedAt, bytes: payload.length, envelope: envelope,
      };
      rec.id = ten().nextId(await ten().records("provider", pid));
      await ten().upsert("provider", pid, rec);

      const subs = await A.matchingWebhooks(pid, event);
      const deliveries = [];
      for (const w of subs) deliveries.push(await A.deliver(pid, w, envelope, { sleep: () => Promise.resolve(), transport: opts.transport }));

      /* keep the bus log bounded */
      const all = await ten().records("provider", pid, A.DOC_KINDS.event);
      if (all.length > A.BUS_LIMIT) {
        const drop = all.slice(0, all.length - A.BUS_LIMIT).map((r) => String(r.id));
        await ten().remove("provider", pid, (r) => r.kind === A.DOC_KINDS.event && drop.indexOf(String(r.id)) !== -1);
      }
      return { event: event, published: true, subscribers: subs.length, deliveries: deliveries };
    } catch (e) {
      return { event: event, published: false, error: (e && e.message) || String(e) };
    }
  };

  /* ─────────────────────────── consume an inbound envelope ─────────────────────────── */

  A.validateEnvelope = function (obj) {
    if (!obj || typeof obj !== "object") return { ok: false, error: "not_object" };
    if (obj.schema !== "psa-envelope") return { ok: false, error: "bad_schema" };
    if (obj.schemaVersion == null || Number(obj.schemaVersion) > 1) return { ok: false, error: "unsupported_schema_version" };
    if (!obj.kind) return { ok: false, error: "no_kind" };
    return { ok: true };
  };

  A.HANDLERS = {
    "ticket.create": async (pid, env) => {
      const p = Object.assign({}, env.ticket || env.payload || {});
      if (!p.companyId) return { error: "company_required" };
      return ERP.tickets.save(p.companyId, ERP.tickets.newTicket(p), { system: true });
    },
    "payment.record": async (pid, env) => ERP.payments.record(pid, Object.assign({}, env.payment || env.payload || {})),
    "configuration.upsert": async (pid, env) => {
      const c = Object.assign({}, env.configuration || env.payload || {});
      return ERP.configurations.save(pid, c.companyId, c);
    },
    "rmm.alert": async (pid, env) => ERP.rmm.ingest(pid, [env.alert || env.payload || {}]),
    "pipeline.ping": async () => ({ pong: true, at: nowIso() }),
  };

  A.consume = async function (envelope, opts) {
    opts = opts || {};
    const v = A.validateEnvelope(envelope);
    if (!v.ok) return { accepted: false, error: v.error };
    /* An inbound envelope may name its operation in `kind` (a command from a
       peer tool) or, when relaying a domain event, carry it in `event`. */
    const key = A.HANDLERS[envelope.kind] ? envelope.kind : (envelope.event && A.HANDLERS[envelope.event] ? envelope.event : envelope.kind);
    const handler = A.HANDLERS[key];
    if (!handler) return { accepted: false, error: "unknown_kind", kind: envelope.kind, known: Object.keys(A.HANDLERS) };
    const pid = opts.pid != null ? opts.pid : await ten().providerId();
    try {
      const result = await handler(pid, envelope, opts);
      return { accepted: !(result && result.error), kind: envelope.kind, result: result, error: result && result.error ? result.error : null };
    } catch (e) {
      return { accepted: false, kind: envelope.kind, error: (e && e.message) || String(e) };
    }
  };

  /* ─────────────────────────── the Admin panel ─────────────────────────── */

  function rowsForWebhooks(list) {
    return list.map((w) => ({
      name: ui.esc(w.name),
      url: '<span class="erp-sub">' + ui.esc(w.url) + "</span>",
      events: (w.events || []).length + " event(s)",
      active: ui.badge(w.active ? "active" : "paused", w.active ? "success" : "muted"),
      secret: '<span class="erp-sub">' + ui.esc((w.secret || "").slice(0, 8)) + "…</span>",
      actions: ui.btn("Toggle", { small: true, act: "api-wh-toggle", arg: w.id, disabled: !ERP.security.can("api.manage") }) +
        " " + ui.btn("Delete", { small: true, danger: true, act: "api-wh-del", arg: w.id, disabled: !ERP.security.can("api.manage") }),
    }));
  }

  async function renderInto(panel, refresh) {
    const pid = await ten().providerId();
    if (pid == null) { ERP.states.empty(panel, { title: "No service provider yet", message: "Create your practice first." }); return; }
    const canManage = ERP.security.can("api.manage");
    const [hooks, deliveries, bus] = await Promise.all([
      A.webhooks(pid), A.deliveries(pid, { limit: 20 }), A.busEvents(pid, { limit: 25 }),
    ]);
    const state = panel.__apiState || (panel.__apiState = {});
    const apiRows = A.describe().map((e) => ({
      method: ui.badge(e.method, e.method === "GET" ? "info" : "warn"),
      path: "<code>" + ui.esc(A.API_VERSION + "/" + e.path) + "</code>",
      permission: '<span class="erp-sub">' + ui.esc(e.permission) + "</span>",
      desc: ui.esc(e.desc),
    }));

    const delRows = deliveries.map((d) => ({
      when: ui.dateTime(d.at), webhook: ui.esc(d.webhookName || d.webhookId), event: ui.esc(d.event),
      status: ui.badge(d.status, d.status === "delivered" ? "success" : "danger"),
      attempts: String(d.attempts || 1), detail: ui.esc(d.error || ""),
    }));

    const busRows = bus.map((e) => ({
      when: ui.dateTime(e.at), event: ui.esc(e.event),
      entity: e.entityKind ? ui.esc(e.entityKind) + (e.entityId != null ? " #" + ui.esc(String(e.entityId)) : "") : "—",
      bytes: String(e.bytes || 0),
      action: ui.btn("Envelope", { small: true, act: "api-env-view", arg: e.id, disabled: false }),
    }));

    panel.innerHTML =
      '<div class="erp-toolbar">' +
        (canManage ? ui.btn("New webhook", { act: "api-wh-new", primary: true, small: true }) + " " +
          ui.btn("Test all webhooks", { act: "api-wh-testall", small: true }) : "") +
      "</div>" +
      ui.card("Versioned API · " + A.API_VERSION, ui.table([
        { key: "method", label: "Method" }, { key: "path", label: "Endpoint" },
        { key: "permission", label: "Permission" }, { key: "desc", label: "Description" },
      ], apiRows, { emptyText: "No endpoints." })) +
      ui.card("Webhook subscriptions", ui.table([
        { key: "name", label: "Name" }, { key: "url", label: "URL" }, { key: "events", label: "Events" },
        { key: "active", label: "State" }, { key: "secret", label: "Secret" }, { key: "actions", label: "" },
      ], rowsForWebhooks(hooks), { emptyText: "No webhooks yet — subscribe a tool to PSA-U events." })) +
      ui.card("Recent deliveries", ui.table([
        { key: "when", label: "When" }, { key: "webhook", label: "Webhook" }, { key: "event", label: "Event" },
        { key: "status", label: "Result" }, { key: "attempts", label: "Tries", align: "right" }, { key: "detail", label: "Detail" },
      ], delRows, { emptyText: "Nothing delivered yet." })) +
      ui.card("Event bus", ui.table([
        { key: "when", label: "When" }, { key: "event", label: "Event" },
        { key: "entity", label: "Entity" }, { key: "bytes", label: "Bytes", align: "right" }, { key: "action", label: "" },
      ], busRows, { emptyText: "No events published yet." }));

    const root = panel;
    if (!panel.__apiBound) {
      panel.__apiBound = true;
      ui.bind(root, "click", "[data-act=api-wh-new]", async () => {
        openWebhookModal(pid, null, () => renderInto(panel, refresh));
      });
      ui.bind(root, "click", "[data-act=api-wh-toggle]", async (el, e, act, arg) => {
        await A.toggleWebhook(pid, arg);
        renderInto(panel, refresh);
      });
      ui.bind(root, "click", "[data-act=api-wh-del]", async (el, e, act, arg) => {
        if (!(await ui.confirm({ title: "Delete webhook?", message: "The subscription and its signing secret will be removed.", okLabel: "Delete", danger: true }))) return;
        await A.removeWebhook(pid, arg);
        renderInto(panel, refresh);
      });
      ui.bind(root, "click", "[data-act=api-wh-testall]", async () => {
        const env = ERP.envelope("event", { event: "pipeline.ping" }, { event: "pipeline.ping" });
        for (const w of await A.webhooks(pid)) await A.deliver(pid, w, env);
        ERP.toast("Test ping sent.", "success");
        renderInto(panel, refresh);
      });
      ui.bind(root, "click", "[data-act=api-env-view]", async (el, e, act, arg) => {
        const rec = (await A.busEvents(pid, {})).find((x) => String(x.id) === String(arg));
        if (!rec) return;
        ui.modal({ title: rec.event, size: "lg", body: '<pre class="erp-envelope">' + ui.esc(JSON.stringify(rec.envelope, null, 2)) + "</pre>", foot: ui.btn("Close", { act: "ui-close" }) });
      });
    }
  }

  async function openWebhookModal(pid, existing, refresh) {
    const w = existing || A.newWebhook({ events: ["ticket.created"] });
    const events = A.EVENTS.map((e) => ({ value: e.id, label: e.id }));
    const chosen = {};
    (w.events || []).forEach((e) => { chosen[e] = true; });
    const modal = ui.modal({
      title: existing ? "Edit webhook" : "New webhook",
      size: "lg",
      body: ui.form(
        ui.text("wh_name", "Name", w.name, "e.g. Reporting tool") +
        ui.text("wh_url", "Endpoint URL", w.url, "https://example.com/hooks/psa") +
        '<div class="field"><label>Events</label><div class="erp-check-grid">' +
          events.map((e) => '<label class="erp-check"><input type="checkbox" name="wh_ev_' + ui.esc(e.value) + '"' + (chosen[e.value] ? " checked" : "") + "> " + ui.esc(e.value) + "</label>").join("") +
        "</div></div>",
        ui.btn("Cancel", { act: "ui-close" }) + " " + ui.btn(existing ? "Save" : "Create", { primary: true, act: "wh-save" })
      ),
    });
    modal.querySelector("[data-act=wh-save]").onclick = async () => {
      const name = modal.querySelector('[name=wh_name]').value.trim();
      const url = modal.querySelector('[name=wh_url]').value.trim();
      const evs = A.EVENTS.map((e) => e.id).filter((id) => { const i = modal.querySelector('[name="wh_ev_' + id + '"]'); return i && i.checked; });
      const res = await A.saveWebhook(pid, Object.assign({}, existing || {}, { name: name, url: url, events: evs }));
      if (res.error) { ERP.toast("Could not save: " + res.error, "error"); return; }
      ui.closeModal();
      ERP.toast("Webhook saved.", "success");
      refresh();
    };
  }

  A.renderPanel = function (panel, refresh) {
    ERP.states.loading(panel, "Loading API & webhooks");
    renderInto(panel, refresh).catch((e) => {
      console.error("api tab failed", e);
      ERP.states.error(panel, { title: "API & webhooks hit a problem", message: (e && e.message) || "Unexpected error." });
    });
    return panel;
  };

  /* alias: the bus is also reachable as ERP.pipeline */
  ERP.pipeline = A;
})();
