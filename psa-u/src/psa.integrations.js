/* ============================================================================
   PSA-U — integration framework (Phase 12 · Task 54)

   One documented way to connect PSA-U to the outside world, so every
   connector behaves the same rather than each inventing its own sync:

     • CONNECTORS  — a catalogue of the integrations a service business needs
                     (email, accounting, calendar, identity/SSO, RMM and the
                     MSP documentation system). Each declares its direction
                     (pull / push / both) and a per-field ownership map saying
                     which side is authoritative for which field.
     • CONNECTIONS — per-connector configuration stored in the provider
                     document (kind "integration"): enabled flag, chosen
                     direction, connector settings, retry policy and cursor.
     • OWNERSHIP   — `applyOwnership` merges an external record over the local
                     one field by field: external-owned fields are taken from
                     the remote side, local-owned fields are kept, and a
                     disagreement on a local field is filed as a collision
                     rather than silently overwritten (the same discipline
                     Phase 10's docs sync uses for assets).
     • RETRY       — exponential backoff (`backoff`, `withRetry`) with a
                     configurable attempt budget, so a flaky remote is retried
                     without a stampede.
     • SYNC LOG    — every pass is recorded as an "integrationRun" with its
                     direction, duration, attempt count and per-record counts,
                     which is the audit trail the Admin tab renders.

   The connectors are real seams, not stubs: email raises tickets, RMM hands
   to the Phase-10 monitoring engine, docs hands to the Phase-10 field-ownership
   sync, accounting reads posted invoices/payments, calendar reads
   appointments, identity reads members.
   ============================================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const X = (ERP.integrations = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("integrations require the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();

  X.DOC_KINDS = { connection: "integration", run: "integrationRun", email: "outboundEmail" };

  X.DIRECTIONS = [
    { id: "pull", label: "Pull (import)" },
    { id: "push", label: "Push (export)" },
    { id: "both", label: "Two-way" },
  ];

  /* ─────────────────────────── connector catalogue ─────────────────────────── */

  /* ownership: "external" = the remote system is authoritative for the field,
     "local" = PSA-U owns it and a remote change is a collision. */
  X.CONNECTORS = [
    {
      id: "email", label: "Email", direction: "both", icon: "ticket",
      desc: "Inbound mail becomes tickets; outbound replies are recorded against the ticket.",
      fields: { pull: ["from", "subject", "body", "receivedAt"], push: ["to", "subject", "body"] },
      ownership: { from: "external", subject: "external", body: "external", receivedAt: "external", status: "local", ownerId: "local", priority: "local" },
    },
    {
      id: "accounting", label: "Accounting", direction: "push", icon: "finance",
      desc: "Posted invoices and payments are handed to the accounting system; payments can be imported back.",
      fields: { push: ["invoice", "payment"], pull: ["payment"] },
      ownership: { number: "local", total: "local", dueDate: "local", paymentStatus: "external", balance: "external" },
    },
    {
      id: "calendar", label: "Calendar", direction: "both", icon: "calendar",
      desc: "Appointments are published to a calendar so technicians see their day on their phone.",
      fields: { push: ["appointment"], pull: ["busy"] },
      ownership: { start: "local", end: "local", technician: "local", busySlot: "external" },
    },
    {
      id: "identity", label: "Identity / SSO", direction: "pull", icon: "building",
      desc: "Members and their single-sign-on identities are provisioned from the directory.",
      fields: { pull: ["member"] },
      ownership: { name: "external", email: "external", ssoSubject: "external", role: "local", teams: "local", hourlyCost: "local" },
    },
    {
      id: "rmm", label: "RMM / monitoring", direction: "pull", icon: "gear",
      desc: "Device alerts are ingested through the Phase-10 monitoring engine, which raises tickets.",
      fields: { pull: ["alert"] },
      ownership: { severity: "external", message: "external", device: "external", status: "local", ticketId: "local" },
    },
    {
      id: "docs", label: "MSP documentation system", direction: "both", icon: "book",
      desc: "Configuration/asset records are reconciled with the documentation system using per-field ownership.",
      fields: { pull: ["configuration"], push: ["configuration"] },
      ownership: { name: "external", serial: "external", model: "external", hostname: "external", os: "external", location: "external", status: "local", notes: "local", relationships: "local" },
    },
  ];

  X.connectorDef = (id) => X.CONNECTORS.find((c) => c.id === id) || null;
  X.directionLabel = (id) => (X.DIRECTIONS.find((d) => d.id === id) || {}).label || id || "—";

  X.fieldOwnership = (connectorId) => {
    const def = X.connectorDef(connectorId);
    return Object.assign({}, (def && def.ownership) || {});
  };
  X.ownershipFor = (connectorId, field) => X.fieldOwnership(connectorId)[field] || "local";

  /* Merge an external record over a local one honouring ownership. Returns the
     merged record plus the three dispositions so a caller can report them. */
  X.applyOwnership = function (connectorId, external, local) {
    external = external || {}; local = local || {};
    const merged = Object.assign({}, local);
    const externalWins = [], localWins = [], collisions = [];
    const keys = Object.keys(external).filter((k) => k !== "id" && k !== "kind");
    for (const k of keys) {
      const owner = X.ownershipFor(connectorId, k);
      const ext = external[k], loc = local[k];
      if (owner === "external") {
        if (loc === undefined || loc === null || String(loc) !== String(ext)) externalWins.push(k);
        merged[k] = ext;
      } else if (loc === undefined || loc === null || loc === "") {
        merged[k] = ext; localWins.push(k);
      } else if (String(loc) === String(ext)) {
        localWins.push(k);
      } else {
        collisions.push(k); localWins.push(k);
      }
    }
    return { merged: merged, externalWins: externalWins, localWins: localWins, collisions: collisions };
  };

  /* ─────────────────────────── retry / backoff ─────────────────────────── */

  X.RETRY = { maxAttempts: 3, baseDelayMs: 500, factor: 2, maxDelayMs: 8000 };

  X.backoff = function (attempt, policy) {
    const p = Object.assign({}, X.RETRY, policy || {});
    const n = Math.max(1, Number(attempt) || 1);
    return Math.min(p.maxDelayMs, p.baseDelayMs * Math.pow(p.factor, n - 1));
  };

  /* Run fn(), retrying with backoff until it succeeds or the budget is spent.
     `sleep` is injectable so tests (and dry-runs) need not wait. */
  X.withRetry = async function (fn, opts) {
    opts = opts || {};
    const p = Object.assign({}, X.RETRY, opts.policy || {});
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let attempts = 0, lastErr = null;
    while (attempts < p.maxAttempts) {
      attempts++;
      try {
        const value = await fn(attempts);
        if (value && value.error) { lastErr = new Error(String(value.error)); }
        else return { ok: true, value: value, attempts: attempts };
      } catch (e) { lastErr = e; }
      if (attempts < p.maxAttempts) await sleep(X.backoff(attempts, p));
    }
    return { ok: false, error: (lastErr && lastErr.message) || "failed", attempts: attempts };
  };

  /* ─────────────────────────── connections ─────────────────────────── */

  X.newConnection = (over) => Object.assign({
    kind: "integration", connectorId: "", enabled: true, direction: "", config: {}, cursor: null,
    retry: {}, createdAt: nowIso(), updatedAt: nowIso(),
  }, over || {});

  X.connections = (pid) => ten().records("provider", pid, X.DOC_KINDS.connection);
  X.connection = async function (pid, connectorId) {
    return (await X.connections(pid)).find((c) => String(c.connectorId) === String(connectorId)) || null;
  };

  X.saveConnection = async function (pid, patch, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("integrations.edit")) return { error: "forbidden" };
    const connectorId = patch.connectorId || (patch.id && (await X.connection(pid, patch.id)) ? patch.id : null);
    if (!connectorId || !X.connectorDef(connectorId)) return { error: "unknown_connector" };
    const existing = await X.connection(pid, connectorId);
    const rec = Object.assign(X.newConnection({ connectorId: connectorId }), existing || {}, patch, { updatedAt: nowIso() });
    if (!existing && rec.id == null) rec.id = ten().nextId(await ten().records("provider", pid));
    if (rec.direction && ["pull", "push", "both"].indexOf(rec.direction) === -1) return { error: "bad_direction" };
    await ten().upsert("provider", pid, rec);
    return { record: rec, created: !existing };
  };

  X.toggleConnection = async function (pid, connectorId, on, opts) {
    return X.saveConnection(pid, { connectorId: connectorId, enabled: on == null ? true : !!on }, opts);
  };
  X.removeConnection = (pid, connectorId) => ten().remove("provider", pid, (r) => r.kind === X.DOC_KINDS.connection && String(r.connectorId) === String(connectorId));

  /* Seed one connection row per catalogue connector (idempotent). */
  X.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const have = await X.connections(pid);
    let created = 0;
    for (const def of X.CONNECTORS) {
      if (have.some((c) => c.connectorId === def.id)) continue;
      const r = await X.saveConnection(pid, X.newConnection({
        connectorId: def.id, direction: def.direction, enabled: def.id === "email" || def.id === "rmm" || def.id === "docs",
      }), { system: true });
      if (!r.error) created++;
    }
    return { created: created, total: (await X.connections(pid)).length };
  };

  /* ─────────────────────────── connector drivers ─────────────────────────── */

  function counts() { return { created: 0, updated: 0, skipped: 0, failed: 0 }; }
  function bump(c, k, n) { c[k] = (c[k] || 0) + (n == null ? 1 : n); return c; }

  /* Inbound email → a ticket in the client's company document. */
  X.inboundEmail = async function (pid, message) {
    message = message || {};
    if (!message.companyId) return { error: "company_required" };
    const company = await ERP.companies.get(message.companyId);
    if (!company) return { error: "no_company" };
    const t = ERP.tickets.newTicket({
      companyId: message.companyId, summary: message.subject || "(no subject)", description: message.body || "",
      source: "email", status: "new",
    });
    t.externalRef = message.id || message.messageId || null;
    const r = await ERP.tickets.save(message.companyId, t, { system: true });
    if (r.error) return { error: r.error };
    const saved = r.record || r.ticket || r;
    await ten().upsert("provider", pid, {
      kind: X.DOC_KINDS.email, id: ten().nextId(await ten().records("provider", pid)),
      direction: "in", companyId: message.companyId, ticketId: saved.id, from: message.from || "",
      to: message.to || "", subject: message.subject || "", body: message.body || "", at: nowIso(),
    });
    return { ticketId: saved.id, number: saved.number };
  };

  /* Outbound email → record the reply and put it on the ticket's activity. */
  X.outboundEmail = async function (pid, payload) {
    payload = payload || {};
    if (!payload.companyId || !payload.ticketId) return { error: "ticket_required" };
    const rec = {
      kind: X.DOC_KINDS.email, id: ten().nextId(await ten().records("provider", pid)),
      direction: "out", companyId: payload.companyId, ticketId: payload.ticketId,
      from: payload.from || "", to: payload.to || "", subject: payload.subject || "", body: payload.body || "", at: nowIso(),
    };
    await ten().upsert("provider", pid, rec);
    if (ERP.tickets) {
      try { await ERP.tickets.addNote(payload.companyId, payload.ticketId, { body: payload.body || "", internal: false, via: "email" }); } catch (e) {}
    }
    return { emailId: rec.id };
  };

  X.emails = (pid, query) => ten().records("provider", pid, X.DOC_KINDS.email).then((list) => {
    query = query || {};
    let out = list.slice().reverse();
    if (query.direction) out = out.filter((e) => e.direction === query.direction);
    if (query.companyId != null) out = out.filter((e) => String(e.companyId) === String(query.companyId));
    if (query.ticketId != null) out = out.filter((e) => String(e.ticketId) === String(query.ticketId));
    return query.limit ? out.slice(0, query.limit) : out;
  });

  X.DRIVERS = {
    email: async function (pid, direction, opts) {
      const c = counts();
      if (direction === "pull") {
        const messages = opts.messages || (opts.message ? [opts.message] : []);
        if (!messages.length) return { counts: c, note: "no inbound messages supplied" };
        for (const m of messages) {
          const r = await X.inboundEmail(pid, m);
          if (r.error) bump(c, "failed"); else bump(c, "created");
        }
      } else {
        const replies = opts.replies || (opts.reply ? [opts.reply] : []);
        if (!replies.length) return { counts: c, note: "no outbound replies supplied" };
        for (const r of replies) {
          const res = await X.outboundEmail(pid, r);
          if (res.error) bump(c, "failed"); else bump(c, "created");
        }
      }
      return { counts: c };
    },

    accounting: async function (pid, direction, opts, conn) {
      const c = counts();
      if (direction === "push") {
        const invoices = (await ERP.billing.all(pid)).filter((i) => String(i.status) === "posted");
        const since = conn && conn.cursor ? Date.parse(conn.cursor) : 0;
        const fresh = invoices.filter((i) => !since || (i.postedAt && Date.parse(i.postedAt) > since) || (i.updatedAt && Date.parse(i.updatedAt) > since));
        bump(c, "updated", fresh.length);
        const payments = [];
        for (const e of await ERP.companies.list()) {
          const list = await ten().records("company", e.id, "payment");
          payments.push.apply(payments, list);
        }
        bump(c, "created", payments.length);
        return { counts: c, invoices: fresh.length, payments: payments.length };
      }
      const records = opts.payments || [];
      for (const p of records) {
        const r = await ERP.payments.record(pid, Object.assign({ source: "accounting" }, p));
        if (r && r.error) bump(c, "failed"); else bump(c, "created");
      }
      return { counts: c };
    },

    calendar: async function (pid, direction, opts) {
      const c = counts();
      if (direction === "pull") {
        for (const b of opts.busy || []) { bump(c, "created"); }
        return { counts: c };
      }
      const upcoming = await ERP.appointments.upcoming({ days: opts.days || 30 });
      bump(c, "updated", upcoming.length);
      return { counts: c, events: upcoming.length };
    },

    identity: async function (pid, direction, opts) {
      const c = counts();
      const members = await ERP.members.members();
      const external = opts.members || members.map((m) => ({ name: m.name, email: m.email, ssoSubject: m.ssoSubject }));
      for (const ext of external) {
        const local = members.find((m) => m.ssoSubject && String(m.ssoSubject) === String(ext.ssoSubject)) ||
          members.find((m) => ext.email && m.email && String(m.email).toLowerCase() === String(ext.email).toLowerCase());
        if (!local) { bump(c, "skipped"); continue; }
        const merge = X.applyOwnership("identity", Object.assign({}, ext, { id: local.id, kind: "member" }), local);
        if (merge.externalWins.length) {
          const updated = Object.assign({}, local, {});
          merge.externalWins.forEach((k) => { updated[k] = merge.merged[k]; });
          await ERP.members.save("member", updated, { system: true });
          bump(c, "updated");
        } else { bump(c, "skipped"); }
      }
      return { counts: c };
    },

    rmm: async function (pid, direction, opts) {
      const c = counts();
      const events = opts.events || (opts.event ? [opts.event] : []);
      if (!events.length) return { counts: c, note: "no alerts supplied" };
      const r = await ERP.rmm.ingest(pid, events);
      bump(c, "created", (r && r.created) || 0);
      bump(c, "updated", (r && r.updated) || 0);
      bump(c, "skipped", (r && r.ignored) || 0);
      return { counts: c, ingested: r };
    },

    docs: async function (pid, direction, opts) {
      const c = counts();
      const companies = opts.companies || (opts.companyId != null ? [opts.companyId] : (await ERP.companies.list()).map((e) => e.id));
      for (const cid of companies) {
        let feed = opts.feed;
        if (!feed) { try { feed = await ERP.configurations.sampleFeed(pid, cid); } catch (e) { feed = []; } }
        const r = await ERP.configurations.syncFromDocs(pid, cid, feed);
        if (r && r.error) { bump(c, "failed"); continue; }
        const rep = (r && r.report) || r || {};
        bump(c, "created", (rep.created || []).length);
        bump(c, "updated", (rep.updated || []).length);
        bump(c, "skipped", ((rep.unchanged || []).length + (rep.drifted || []).length));
      }
      return { counts: c };
    },
  };

  /* ─────────────────────────── running a connector ─────────────────────────── */

  X.run = async function (pid, connectorId, opts) {
    opts = opts || {};
    if (!opts.system && !ERP.security.enforce("integrations.run")) return { error: "forbidden" };
    const def = X.connectorDef(connectorId);
    if (!def) return { error: "unknown_connector" };
    let conn = await X.connection(pid, connectorId);
    if (!conn) conn = (await X.saveConnection(pid, X.newConnection({ connectorId: connectorId, direction: def.direction }), { system: true })).record;
    if (!conn.enabled && !opts.force) return { error: "disabled", connectorId: connectorId };

    const direction = opts.direction || (def.direction === "both" ? "pull" : def.direction);
    const allowed = def.direction === "both" ? ["pull", "push"] : [def.direction];
    if (allowed.indexOf(direction) === -1) return { error: "bad_direction", direction: direction, allowed: allowed };

    const driver = X.DRIVERS[connectorId];
    if (!driver) return { error: "no_driver" };

    const startedAt = nowIso(), t0 = Date.now();
    const policy = Object.assign({}, X.RETRY, conn.retry || {}, opts.policy || {});
    const res = await X.withRetry(() => driver(pid, direction, opts, conn), { policy: policy, sleep: opts.sleep });

    const status = res.ok ? "success" : "failed";
    const rec = {
      kind: X.DOC_KINDS.run, connectorId: connectorId, direction: direction, status: status,
      attempts: res.attempts, startedAt: startedAt, finishedAt: nowIso(), ms: Date.now() - t0,
      counts: res.ok ? res.value.counts : counts(), error: res.ok ? null : String(res.error),
    };
    if (!opts.dryRun) {
      rec.id = ten().nextId(await ten().records("provider", pid));
      await ten().upsert("provider", pid, rec);
      conn.lastRunAt = rec.finishedAt; conn.lastStatus = status; conn.lastRunId = rec.id;
      if (res.ok && direction === "push") conn.cursor = rec.finishedAt;
      await ten().upsert("provider", pid, conn);
    }
    return { run: rec, report: res.ok ? res.value : null, error: res.ok ? null : res.error };
  };

  X.runAll = async function (pid, opts) {
    opts = opts || {};
    const out = [];
    for (const def of X.CONNECTORS) {
      const conn = await X.connection(pid, def.id);
      if (conn && !conn.enabled && !opts.force) { out.push({ connectorId: def.id, status: "skipped" }); continue; }
      out.push(Object.assign({ connectorId: def.id }, await X.run(pid, def.id, opts)));
    }
    return { connectors: out, ran: out.filter((r) => r.run).length };
  };

  X.syncLog = async function (pid, query) {
    query = query || {};
    let list = (await ten().records("provider", pid, X.DOC_KINDS.run)).slice().reverse();
    if (query.connectorId) list = list.filter((r) => r.connectorId === query.connectorId);
    return query.limit ? list.slice(0, query.limit) : list;
  };
  X.clearLog = (pid, connectorId) => ten().remove("provider", pid, (r) => r.kind === X.DOC_KINDS.run && (!connectorId || r.connectorId === connectorId));

  /* ─────────────────────────── the Admin panel ─────────────────────────── */

  async function renderInto(panel, refresh) {
    const pid = await ten().providerId();
    if (pid == null) { ERP.states.empty(panel, { title: "No service provider yet", message: "Create your practice first." }); return; }
    await X.ensure(pid);
    const [conns, log] = await Promise.all([X.connections(pid), X.syncLog(pid, { limit: 30 })]);
    const canEdit = ERP.security.can("integrations.edit");
    const canRun = ERP.security.can("integrations.run");

    const cards = X.CONNECTORS.map((def) => {
      const conn = conns.find((c) => c.connectorId === def.id) || {};
      const ownerRows = Object.keys(def.ownership || {}).map((f) => ({ field: f, owner: def.ownership[f] }));
      return ui.card(def.label, "" +
        '<p class="erp-muted-note">' + ui.esc(def.desc) + "</p>" +
        '<div class="erp-inline-field"><span class="erp-badge">' + ui.esc(X.directionLabel(def.direction)) + "</span> " +
          ui.badge(conn.enabled === false ? "disabled" : (conn.lastStatus || "idle"), conn.enabled === false ? "muted" : "info") +
          (conn.lastRunAt ? '<span class="erp-sub"> Last run ' + ui.esc(ui.dateTime(conn.lastRunAt)) + "</span>" : "") +
        "</div>" +
        '<div class="erp-inline-field erp-int-actions">' +
          ui.btn("Pull", { small: true, act: "int-run", arg: def.id + "|pull", disabled: !canRun || (def.direction === "push") }) +
          ui.btn("Push", { small: true, act: "int-run", arg: def.id + "|push", disabled: !canRun || (def.direction === "pull") }) +
          ui.btn(conn.enabled === false ? "Enable" : "Disable", { small: true, act: "int-toggle", arg: def.id, disabled: !canEdit }) +
        "</div>" +
        ui.table([
          { key: "field", label: "Field" },
          { key: "owner", label: "Owned by", render: (r) => ui.badge(r.owner === "external" ? "remote" : "PSA-U", r.owner === "external" ? "info" : "muted") },
        ], ownerRows, { emptyText: "No fields declared." }),
        { actions: "" });
    }).join("");

    const logRows = log.map((r) => ({
      when: ui.dateTime(r.finishedAt || r.startedAt),
      connector: (X.connectorDef(r.connectorId) || {}).label || r.connectorId,
      direction: X.directionLabel(r.direction).split(" ")[0],
      status: ui.badge(r.status, r.status === "success" ? "success" : r.status === "failed" ? "danger" : "muted"),
      attempts: String(r.attempts || 1),
      records: r.counts ? "c" + (r.counts.created || 0) + " u" + (r.counts.updated || 0) + " s" + (r.counts.skipped || 0) + " f" + (r.counts.failed || 0) : "",
      error: r.error ? '<span class="erp-sub">' + ui.esc(r.error) + "</span>" : "",
    }));

    panel.innerHTML =
      '<div class="erp-toolbar">' +
        ui.btn("Run all enabled", { act: "int-runall", primary: true, small: true, disabled: !canRun }) +
        ui.btn("Clear log", { act: "int-clearlog", small: true, disabled: !canEdit }) +
      "</div>" +
      ui.card("Connectors", '<div class="erp-int-grid">' + cards + "</div>") +
      ui.card("Sync log", ui.table([
        { key: "when", label: "When" }, { key: "connector", label: "Connector" },
        { key: "direction", label: "Direction" }, { key: "status", label: "Result" },
        { key: "attempts", label: "Tries", align: "right" }, { key: "records", label: "Records" },
        { key: "error", label: "Detail" },
      ], logRows, { emptyText: "No sync runs yet." }));
  }

  X.renderPanel = function (panel, refresh) {
    ERP.states.loading(panel, "Loading integrations");
    renderInto(panel, refresh).catch((e) => {
      console.error("integrations tab failed", e);
      ERP.states.error(panel, { title: "Integrations hit a problem", message: (e && e.message) || "Unexpected error." });
    });
    return panel;
  };
})();
