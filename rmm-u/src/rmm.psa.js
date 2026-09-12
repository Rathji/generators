/* ============================================================
   RMM-U — psa-u ticket integration  (Phase 5 · Task 26)

   Turns alerts into tickets — and back. A critical alert opens a
   ticket in the connected psa-u pipeline; a recurring alert does NOT
   open a second one, it updates the ticket that is already open
   (matched on the alert's own de-duplication key). The ticket carries
   a link to the device and to its configuration record in the
   documentation tool, and as the alert changes the ticket follows:
   acknowledgement adds a note, escalation raises priority, and an
   auto-cleared alert resolves the ticket. psa-u is the system of
   record for ticket STATUS, so a status change coming back over the
   inbound webhook is reflected onto the alert.

   Two modes:

     • local  — a faithful simulation of psa-u (used in the editor and
                by tests): ticket references are minted locally and
                every transition is auditable.
     • remote — POSTs to a configured psa-u base URL through the
                swappable `PSA.sender`. The API token lives in memory
                only (`PSA.setToken`) and is NEVER persisted, so it
                cannot leak through the public `rmm-v1-psa` document.

   The alert's `dedupeKey`, `deviceId` and severity are the join keys,
   which is why Task 24 de-duplicates alerts so carefully.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const M = ERP.masterConfig || null;
  const PSA = (ERP.psa = {});
  const AL = () => window.ERP.alerts || null;
  const NOT = () => window.ERP.notify || null;

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  PSA.MODULE = "psa";
  PSA.SETTINGS_ID = "psa-settings";
  PSA.STATUSES = ["new", "open", "in-progress", "pending", "resolved", "closed"];
  PSA.CLOSED = ["resolved", "closed"];

  const enabled = () => cfg("rmm.psaEnabled", true) !== false;
  const autoTicket = () => cfg("rmm.psaAutoTicket", true) !== false;

  /* The API token is held in memory for this page life only. */
  let token = "";
  PSA.setToken = function (t) { token = String(t == null ? "" : t); return { ok: true, hasToken: !!token }; };
  PSA.getToken = () => token;
  PSA.hasToken = () => !!token;

  /* ═══════════════════════ persistence ═══════════════════════ */

  async function load() { const r = await store.loadDoc(PSA.MODULE); return asArr(r.error ? [] : r.records); }
  async function save(list) { return store.saveDoc(PSA.MODULE, list); }

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "ticket", targetId, summary }); } catch (e) {}
  }
  PSA.load = load;

  function defaultSettings() {
    return {
      kind: "settings", id: PSA.SETTINGS_ID,
      enabled: true,
      mode: cfg("rmm.psaUrl", "") ? "remote" : "local",
      baseUrl: cfg("rmm.psaUrl", "") || "",
      defaultQueue: cfg("rmm.psaQueue", "") || "Service Desk",
      priorityMap: { "sev-emergency": 1, "sev-critical": 2, "sev-warning": 3, "sev-info": 4 },
      updatedAt: now(),
    };
  }

  PSA.settings = async function () {
    const rows = await load();
    const rec = rows.find((r) => r.kind === "settings" && r.id === PSA.SETTINGS_ID);
    return rec ? Object.assign(defaultSettings(), clone(rec)) : defaultSettings();
  };

  PSA.saveSettings = async function (patch) {
    const rows = await load();
    let rec = rows.find((r) => r.kind === "settings" && r.id === PSA.SETTINGS_ID);
    const merged = Object.assign(defaultSettings(), rec || {}, asObj(patch), { id: PSA.SETTINGS_ID, kind: "settings", updatedAt: now() });
    if (!rec) { rec = merged; rows.push(rec); } else Object.assign(rec, merged);
    const w = await save(rows);
    if (w && w.error) return { error: w.error, message: w.message };
    return { settings: clone(merged) };
  };

  /* ═══════════════════════ transport ═══════════════════════ */

  PSA.sender = async function (d) {
    const fn = (window.root && typeof window.root.superFetch === "function") ? window.root.superFetch : (typeof fetch === "function" ? fetch : null);
    if (!fn) return { ok: false, error: "no_transport" };
    try {
      const res = await fn(d.url, { method: d.method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}), body: d.body });
      let json = null;
      try { json = await res.json(); } catch (e) {}
      return { ok: res.ok !== false, status: res.status, json };
    } catch (e) { return { ok: false, error: (e && e.message) || "transport error" }; }
  };

  /* ═══════════════════════ helpers ═══════════════════════ */

  PSA.linkFor = function (device) {
    const d = asObj(asObj(device).documentation);
    return { configSystemId: S(d.systemId, 200), configRefId: S(d.refId, 200), configUrl: S(d.refUrl, 400) };
  };

  async function priorityFor(severityId, settings) {
    const map = asObj(asObj(settings).priorityMap);
    if (map[severityId] != null) return num(map[severityId], 3);
    if (!M) return 3;
    const s = (await M.section("severities")).find((x) => String(x.id) === String(severityId));
    const rank = s ? num(s.rank, 0) : 0;
    if (rank >= 40) return 1;
    if (rank >= 30) return 2;
    if (rank >= 20) return 3;
    return 4;
  }

  async function nextRef() {
    const rows = (await load()).filter((r) => r.kind === "ticket");
    const prefix = cfg("rmm.psaTicketPrefix", "PSA");
    let max = 0;
    rows.forEach((t) => { const m = new RegExp("^" + prefix + "-(\\d+)$").exec(t.externalId || ""); if (m) max = Math.max(max, Number(m[1])); });
    return prefix + "-" + (max + 1);
  }

  function normTicket(data) {
    data = asObj(data);
    return {
      kind: "ticket", id: data.id || rid("tkt"),
      providerId: data.providerId ? String(data.providerId) : null,
      externalId: S(data.externalId, 120),
      alertId: data.alertId ? String(data.alertId) : null,
      dedupeKey: S(data.dedupeKey, 300),
      monitorId: data.monitorId ? String(data.monitorId) : null,
      deviceId: data.deviceId ? String(data.deviceId) : null,
      deviceHostname: S(data.deviceHostname, 200),
      configSystemId: S(data.configSystemId, 200),
      configRefId: S(data.configRefId, 200),
      configUrl: S(data.configUrl, 400),
      subject: S(data.subject, 200) || "Alert ticket",
      description: S(data.description, 4000),
      status: PSA.STATUSES.indexOf(data.status) !== -1 ? data.status : "open",
      priority: num(data.priority, 3),
      severityId: data.severityId ? String(data.severityId) : null,
      severityLabel: S(data.severityLabel, 80),
      queue: S(data.queue, 120),
      assignee: S(data.assignee, 120),
      alertState: S(data.alertState, 40),
      createdAt: data.createdAt || now(), updatedAt: data.updatedAt || now(),
      resolvedAt: data.resolvedAt || "",
      updates: asArr(data.updates),
      meta: asObj(data.meta),
    };
  }
  PSA.normTicket = normTicket;

  /* ═══════════════════════ reads ═══════════════════════ */

  PSA.tickets = async function (providerId, opts) {
    opts = opts || {};
    let rows = (await load()).filter((r) => r.kind === "ticket").map(normTicket);
    if (providerId) rows = rows.filter((t) => !t.providerId || String(t.providerId) === String(providerId));
    if (opts.status) rows = rows.filter((t) => t.status === opts.status);
    if (opts.open) rows = rows.filter((t) => PSA.CLOSED.indexOf(t.status) === -1);
    if (opts.alertId) rows = rows.filter((t) => String(t.alertId) === String(opts.alertId));
    if (opts.deviceId) rows = rows.filter((t) => String(t.deviceId) === String(opts.deviceId));
    rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  };

  PSA.ticket = async function (id) {
    const rows = (await load()).filter((r) => r.kind === "ticket");
    const rec = rows.find((t) => String(t.id) === String(id) || String(t.externalId) === String(id));
    return rec ? clone(normTicket(rec)) : null;
  };

  PSA.forAlert = async function (providerId, alertId) {
    const rows = await PSA.tickets(providerId, { alertId });
    return rows.length ? rows[0] : null;
  };

  PSA.stats = async function (providerId) {
    const rows = await PSA.tickets(providerId, {});
    const byStatus = {};
    rows.forEach((t) => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
    const settings = await PSA.settings();
    return {
      total: rows.length, open: rows.filter((t) => PSA.CLOSED.indexOf(t.status) === -1).length,
      byStatus, linkedAlerts: rows.filter((t) => t.alertId).length, mode: settings.mode, hasToken: !!token,
      docName: store.docName(PSA.MODULE),
    };
  };

  /* ═══════════════════════ create / update / resolve ═══════════════════════ */

  async function reflectOnAlert(providerId, alertId, patch) {
    if (!alertId) return;
    try { await T.updateItem(providerId, "alerts", alertId, (it) => { Object.assign(it, patch); it.updatedAt = now(); }); } catch (e) {}
  }
  PSA.reflectOnAlert = reflectOnAlert;

  async function persistTicket(ticket) {
    const rows = await load();
    const i = rows.findIndex((r) => r.kind === "ticket" && String(r.id) === String(ticket.id));
    if (i === -1) rows.push(ticket); else rows[i] = ticket;
    const w = await save(rows);
    if (w && w.error) return { error: w.error, message: w.message, ticket: clone(ticket) };
    return { ok: true, ticket: clone(ticket) };
  }

  /* Create (or, when an open ticket already matches the alert's
     de-duplication key, update) a ticket for an alert. */
  PSA.createTicket = async function (providerId, alert, opts) {
    opts = opts || {};
    const settings = await PSA.settings();
    if (settings.enabled === false && !opts.force) return { skipped: true, reason: "disabled" };
    alert = asObj(alert);
    const device = asArr((opts.provider || {}).devices).map(D.normalizeDevice).find((d) => String(d.id) === String(alert.deviceId));
    const link = PSA.linkFor(device);
    const priority = await priorityFor(alert.severityId, settings);
    const subject = S((alert.severityLabel ? "[" + alert.severityLabel + "] " : "") + (alert.subject || alert.monitorName || "Alert") + " on " + (alert.hostname || alert.deviceId), 200);
    const description = [
      alert.message,
      "",
      "Device: " + (alert.hostname || alert.deviceId),
      alert.siteName ? "Site: " + alert.siteName : "",
      "Monitor: " + (alert.monitorName || alert.monitorId || ""),
      "Severity: " + (alert.severityLabel || alert.severityId || ""),
      link.configSystemId ? "Configuration record: " + link.configSystemId : (link.configRefId ? "Config ref: " + link.configRefId : ""),
      alert.id ? "RMM alert: " + alert.id : "",
    ].filter((x) => x !== null && x !== undefined && x !== "").join("\n");

    /* de-dup: an existing non-closed ticket for the same key is updated */
    const open = (await PSA.tickets(providerId, { open: true })).find((t) => t.dedupeKey && alert.dedupeKey && String(t.dedupeKey) === String(alert.dedupeKey));
    if (open) return PSA.updateTicket(providerId, open.id, { note: "Alert re-fired (occurrence " + num(alert.occurrences, 1) + ").", priority, alertState: alert.state, severityId: alert.severityId, deduped: true });

    const ticket = normTicket({
      providerId, externalId: "", alertId: alert.id || null, dedupeKey: alert.dedupeKey || "",
      monitorId: alert.monitorId || null, deviceId: alert.deviceId || null, deviceHostname: alert.hostname || "",
      configSystemId: link.configSystemId, configRefId: link.configRefId, configUrl: link.configUrl,
      subject, description, status: "open", priority, severityId: alert.severityId || null, severityLabel: alert.severityLabel || "",
      queue: settings.defaultQueue, alertState: alert.state || "firing",
      updates: [{ at: now(), actor: "system", note: "Ticket opened from RMM alert." }],
    });

    let externalError = "";
    if (settings.mode === "remote" && settings.baseUrl) {
      const res = await PSA.sender({ url: settings.baseUrl.replace(/\/$/, "") + "/api/tickets", method: "POST", body: JSON.stringify({ subject: ticket.subject, description: ticket.description, priority: ticket.priority, queue: ticket.queue, externalRef: ticket.alertId }) });
      if (res && res.ok && res.json && (res.json.id || res.json.externalId || res.json.ticketId)) ticket.externalId = S(res.json.id || res.json.externalId || res.json.ticketId, 120);
      else externalError = (res && (res.error || "HTTP " + res.status)) || "transport error";
    }
    if (!ticket.externalId) ticket.externalId = await nextRef();
    ticket.meta = { externalError };

    const w = await persistTicket(ticket);
    if (w.error) return w;
    await reflectOnAlert(providerId, alert.id, { ticketId: ticket.id, ticketRef: ticket.externalId, ticketStatus: ticket.status });
    await audit("psa_ticket_create", ticket.id, "Opened psa-u ticket " + ticket.externalId + " for \"" + ticket.subject + "\"." + (externalError ? " (remote delivery failed: " + externalError + ")" : ""));
    if (opts.notify) { const N = NOT(); if (N && N.send) { try { await N.send({ providerId, channelId: settings.defaultQueue === "Service Desk" ? "ch-psa" : null, subject: "Ticket " + ticket.externalId + " opened", message: ticket.subject, deviceId: ticket.deviceId, meta: { source: "psa", alertId: ticket.alertId } }); } catch (e) {} } }
    return { ok: true, ticket: clone(ticket), deduped: false, externalError };
  };

  /* change: { note, status, priority, assignee, subject, description, alertState, severityId, deduped } */
  PSA.updateTicket = async function (providerId, alertOrTicketId, change) {
    change = asObj(change);
    const rows = await load();
    const tickets = rows.filter((r) => r.kind === "ticket");
    let rec = tickets.find((t) => String(t.id) === String(alertOrTicketId) || String(t.externalId) === String(alertOrTicketId));
    if (!rec && alertOrTicketId && typeof alertOrTicketId === "object" && alertOrTicketId.id) rec = tickets.find((t) => String(t.alertId) === String(alertOrTicketId.id));
    if (!rec) return { error: "not_found", id: alertOrTicketId };
    const before = { status: rec.status, priority: rec.priority };
    if (change.status && PSA.STATUSES.indexOf(change.status) !== -1) rec.status = change.status;
    if (change.priority != null) rec.priority = num(change.priority, rec.priority);
    if (change.assignee != null) rec.assignee = S(change.assignee, 120);
    if (change.subject != null) rec.subject = S(change.subject, 200);
    if (change.description != null) rec.description = S(change.description, 4000);
    if (change.alertState != null) rec.alertState = S(change.alertState, 40);
    if (change.severityId != null) rec.severityId = String(change.severityId);
    rec.updatedAt = now();
    rec.updates = asArr(rec.updates).concat([{ at: now(), actor: change.actor || "system", note: S(change.note, 1000), status: rec.status, priority: rec.priority }]).slice(-100);
    const w = await persistTicket(rec);
    if (w.error) return w;
    await reflectOnAlert(providerId, rec.alertId, { ticketId: rec.id, ticketRef: rec.externalId, ticketStatus: rec.status });
    if (before.status !== rec.status || before.priority !== rec.priority) await audit("psa_ticket_update", rec.id, "psa-u ticket " + rec.externalId + " " + before.status + "→" + rec.status + ", priority " + before.priority + "→" + rec.priority + ".");
    return { ok: true, ticket: clone(rec), deduped: !!change.deduped };
  };

  PSA.resolveTicket = async function (providerId, alertOrTicketId, opts) {
    opts = opts || {};
    let id = alertOrTicketId;
    if (id && typeof id === "object") id = id.id;
    let rec = await PSA.ticket(id);
    if (!rec && (typeof alertOrTicketId === "object")) rec = await PSA.forAlert(providerId, alertOrTicketId.id);
    if (!rec) {
      const byAlert = await PSA.forAlert(providerId, typeof alertOrTicketId === "object" ? alertOrTicketId.id : alertOrTicketId);
      rec = byAlert;
    }
    if (!rec) return { error: "not_found", id };
    const rows = await load();
    const t = rows.find((r) => r.kind === "ticket" && String(r.id) === String(rec.id));
    if (!t) return { error: "not_found", id: rec.id };
    t.status = "resolved";
    t.resolvedAt = opts.at || now();
    t.alertState = "resolved";
    t.updatedAt = now();
    t.updates = asArr(t.updates).concat([{ at: t.resolvedAt, actor: opts.actor || "system", note: opts.note || "Alert cleared — ticket resolved automatically.", status: "resolved", priority: t.priority }]).slice(-100);
    const w = await persistTicket(t);
    if (w.error) return w;
    await reflectOnAlert(providerId, t.alertId, { ticketStatus: t.status });
    await audit("psa_ticket_resolve", t.id, "Resolved psa-u ticket " + t.externalId + ".");
    return { ok: true, ticket: clone(t) };
  };

  /* Inbound: reflect a psa-u status change back onto the ticket + alert. */
  PSA.syncStatus = async function (providerId, ticketId, status, opts) {
    opts = opts || {};
    if (PSA.STATUSES.indexOf(status) === -1) return { error: "bad_status", status };
    const rows = await load();
    const t = rows.find((r) => r.kind === "ticket" && (String(r.id) === String(ticketId) || String(r.externalId) === String(ticketId)));
    if (!t) return { error: "not_found", ticketId };
    const from = t.status;
    t.status = status;
    t.updatedAt = now();
    if (status === "resolved" || status === "closed") t.resolvedAt = opts.at || now();
    if (opts.assignee != null) t.assignee = S(opts.assignee, 120);
    if (opts.priority != null) t.priority = num(opts.priority, t.priority);
    t.updates = asArr(t.updates).concat([{ at: now(), actor: opts.actor || "psa-u", note: opts.note || ("Status " + from + " → " + status + " in psa-u."), status, priority: t.priority }]).slice(-100);
    const w = await persistTicket(t);
    if (w.error) return w;
    await reflectOnAlert(providerId, t.alertId, { ticketStatus: t.status });
    if (opts.acknowledge && t.alertId) { const ALx = AL(); if (ALx && ALx.acknowledge && status === "in-progress") { try { await ALx.acknowledge(providerId, t.alertId, opts.actor || "psa-u"); } catch (e) {} } }
    await audit("psa_ticket_sync", t.id, "psa-u ticket " + t.externalId + " status " + from + " → " + status + ".");
    return { ok: true, ticket: clone(t) };
  };

  /* Inbound webhook payload: { externalId, status, priority?, assignee?, note? } */
  PSA.ingest = async function (providerId, payload) {
    payload = asObj(payload);
    const ext = payload.externalId || payload.id || payload.ticketId;
    if (!ext) return { error: "no_external_id" };
    const rows = await load();
    const t = rows.find((r) => r.kind === "ticket" && String(r.externalId) === String(ext));
    if (!t) return { error: "not_found", externalId: ext };
    return PSA.syncStatus(providerId || t.providerId, t.id, payload.status, { note: payload.note, assignee: payload.assignee, priority: payload.priority, actor: payload.actor || "psa-u", acknowledge: payload.acknowledge });
  };

  /* ═══════════════════════ alert → ticket lifecycle ═══════════════════════ */

  PSA.onAlert = async function (providerId, alert, event, at) {
    if (!enabled() || !autoTicket()) return { skipped: true, reason: "disabled" };
    alert = asObj(alert);
    if (!alert.id) return { skipped: true, reason: "no_alert" };
    if (event === "fired") {
      const rank = await severityRank(alert.severityId);
      if (rank != null && rank < 30) return { skipped: true, reason: "below_auto_ticket_severity", rank };
      const g = await T.get(providerId);
      return PSA.createTicket(providerId, alert, { provider: g.error ? undefined : g.provider });
    }
    if (event === "escalated") return PSA.updateTicket(providerId, alert, { priority: Math.max(1, num(alert.escalationLevel, 0) >= 1 ? 1 : 2), alertState: alert.state, note: "Severity escalated to " + (alert.severityLabel || alert.severityId) + "." });
    if (event === "acknowledged") return PSA.updateTicket(providerId, alert, { status: "in-progress", note: "Acknowledged in RMM by " + (alert.acknowledgedBy || "operator") + ".", alertState: alert.state });
    if (event === "cleared") return PSA.resolveTicket(providerId, alert, {});
    return { skipped: true, reason: "event", event };
  };

  async function severityRank(id) {
    const ALx = AL();
    if (ALx && typeof ALx.rankOf === "function") { try { const r = await ALx.rankOf(id); return r; } catch (e) {} }
    if (!M) return null;
    const s = (await M.section("severities")).find((x) => String(x.id) === String(id));
    return s ? num(s.rank, 0) : null;
  }
  PSA.severityRank = severityRank;

  /* Used by the automation `create-ticket` action. When the event names
     an existing alert it rides that alert's ticket; otherwise it opens a
     standalone ticket for the device. */
  PSA.createTicketFromEvent = async function (providerId, event, opts) {
    opts = opts || {};
    event = asObj(event);
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    if (event.alertId) {
      const alert = asArr(provider.alerts).find((a) => String(a.id) === String(event.alertId));
      if (alert) return PSA.createTicket(providerId, alert, { provider, force: true });
    }
    const device = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(event.deviceId));
    const link = PSA.linkFor(device);
    const settings = await PSA.settings();
    if (settings.enabled === false && !opts.force) return { skipped: true, reason: "disabled" };
    const severityId = event.severityId || (asObj(await (M ? M.settings() : {})).defaultSeverity) || "sev-warning";
    const ticket = normTicket({
      providerId, externalId: await nextRef(),
      deviceId: event.deviceId || null, deviceHostname: device ? (device.hostname || device.id) : (event.deviceId || ""),
      configSystemId: link.configSystemId, configRefId: link.configRefId, configUrl: link.configUrl,
      subject: S(opts.subject || event.subject || ("Ticket for " + (device ? device.hostname : event.deviceId)), 200),
      description: S(opts.description || ("Created by an automation rule." + (event.ruleName ? " Rule: " + event.ruleName : "")), 4000),
      status: "open", priority: await priorityFor(severityId, settings), severityId, queue: settings.defaultQueue,
      updates: [{ at: now(), actor: "automation", note: "Ticket opened by an automation action." }],
    });
    const w = await persistTicket(ticket);
    if (w.error) return w;
    await audit("psa_ticket_create", ticket.id, "Opened psa-u ticket " + ticket.externalId + " from an automation.");
    return { ok: true, ticket: clone(ticket) };
  };

  /* ═══════════════════════ demo seed ═══════════════════════ */

  PSA.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && !enabled()) return { skipped: true, reason: "disabled" };
    const rows = await load();
    if (!rows.some((r) => r.kind === "settings")) {
      rows.push(defaultSettings());
      await save(rows);
    }
    return { ok: true };
  };

  let readyResolve;
  PSA.ready = new Promise((res) => { readyResolve = res; });
  PSA.init = async function () { try { await T.ready; await PSA.seedDemo(); } catch (e) { console.error("psa seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", PSA.init);
  else PSA.init();

  /* ═══════════════════════ UI ═══════════════════════ */

  function statusTone(s) { return s === "resolved" || s === "closed" ? "success" : s === "in-progress" ? "info" : s === "pending" ? "warn" : "muted"; }

  async function ticketsPanel(provider, opts) {
    const ui = ERP.ui, esc = ui.esc;
    const settings = await PSA.settings();
    const stats = await PSA.stats(provider.id);
    const tickets = await PSA.tickets(provider.id, { limit: 200 });
    const rows = tickets.map((t) => ({
      ref: "<b>" + esc(t.externalId || t.id) + "</b>" + (t.alertId ? ' <span class="erp-sub">alert</span>' : "") + '<div class="erp-sub">' + esc(t.subject) + "</div>",
      device: esc(t.deviceHostname || t.deviceId || "—") + (t.configSystemId || t.configRefId ? '<div class="erp-sub">config ' + esc(t.configSystemId || t.configRefId) + (t.configUrl ? ' · <a href="' + esc(t.configUrl) + '" target="_blank" rel="noopener">open</a>' : "") + "</div>" : '<div class="erp-sub">no config record</div>'),
      status: ui.badge(t.status, statusTone(t.status)) + '<div class="erp-sub">' + esc("P" + num(t.priority, 3)) + (t.assignee ? " · " + esc(t.assignee) : "") + "</div>",
      alert: t.alertId ? (AL() && AL().stateBadge ? AL().stateBadge(t.alertState || "firing") : ui.badge(t.alertState || "", "muted")) + '<div class="erp-sub">' + esc(t.alertId) + "</div>" : '<span class="erp-sub">standalone</span>',
      updated: esc(ui.dateTime(t.updatedAt)),
      actions: ui.btn("Sync status", { small: true, act: "psa-sync", arg: t.id }) + " " + (PSA.CLOSED.indexOf(t.status) === -1 ? ui.btn("Resolve", { small: true, act: "psa-resolve", arg: t.id }) + " " : "") + ui.btn("Detail", { small: true, act: "psa-detail", arg: t.id }),
    }));
    const modeBadge = ui.badge(settings.mode + (settings.mode === "remote" && settings.baseUrl ? " · " + settings.baseUrl : ""), settings.mode === "remote" ? "info" : "muted");
    return ui.summary([
      { label: "Tickets", value: String(stats.total) },
      { label: "Open", value: String(stats.open) },
      { label: "Linked to alerts", value: String(stats.linkedAlerts) },
      { label: "Mode", value: modeBadge },
      { label: "Token", value: PSA.hasToken() ? ui.badge("set (in memory)", "success") : ui.badge("not set", "muted") },
    ]) +
      '<div class="erp-btn-row">' + ui.btn("psa-u connection", { small: true, act: "psa-settings" }) + " " + ui.btn("Inbound webhook test", { small: true, act: "psa-ingest-test" }) + "</div>" +
      (settings.mode === "local" ? ui.alert("psa-u is simulated locally — ticket references are minted by the RMM. Configure a base URL to talk to a real psa-u.", "info") : "") +
      ui.table([
        { key: "ref", label: "Ticket", render: (r) => r.ref },
        { key: "device", label: "Device / configuration record", render: (r) => r.device },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "alert", label: "Alert", render: (r) => r.alert },
        { key: "updated", label: "Updated", render: (r) => r.updated },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No tickets yet — tickets open automatically from critical alerts, or from a create-ticket automation action." });
  }

  async function openSettings(provider, paint) {
    const ui = ERP.ui, esc = ui.esc;
    const s = await PSA.settings();
    const body = ui.form(
      '<div class="erp-btn-row">' + ui.check("enabled", "integration enabled", s.enabled !== false) + "</div>" +
      ui.select("mode", "Mode", [{ value: "local", label: "Local simulation" }, { value: "remote", label: "Remote psa-u" }], s.mode || "local") +
      ui.text("baseUrl", "psa-u base URL", s.baseUrl || "", "https://psa.example.com") +
      ui.text("defaultQueue", "Default queue", s.defaultQueue || "") +
      ui.text("token", "API token (kept in memory only)", "", "never stored") +
      '<p class="erp-sub">The token is held for this page load only and is never written to the public psa-u document.</p>' +
      '<div class="field"><label>Priority map (severity → psa-u priority)</label><div class="rmm-check-list">' +
      Object.keys(asObj(s.priorityMap)).map((k) => '<label class="erp-check">' + esc(k) + ' <input type="number" data-psa-pri="' + esc(k) + '" value="' + num(s.priorityMap[k], 3) + '" style="width:70px"></label>').join("") + "</div></div>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Save", { small: true, primary: true, act: "psa-save-settings" })
    );
    const m = ui.modal({ title: "psa-u connection", body });
    if (!m) return;
    m.querySelector("[data-act=psa-save-settings]").onclick = async () => {
      const v = ui.collect(m, ["enabled", "mode", "baseUrl", "defaultQueue", "token"]);
      if (v.token) PSA.setToken(v.token);
      const priorityMap = {};
      m.querySelectorAll("[data-psa-pri]").forEach((i) => { priorityMap[i.getAttribute("data-psa-pri")] = Number(i.value) || 3; });
      const payload = { enabled: !!v.enabled, mode: v.mode, baseUrl: v.baseUrl, defaultQueue: v.defaultQueue, priorityMap };
      const r = await PSA.saveSettings(payload);
      if (r.error) return (ERP.toast)("Save failed: " + r.error, "error");
      ui.closeModal(); (ERP.toast)("psa-u settings saved"); paint();
    };
  }

  async function openTicket(provider, id, paint) {
    const ui = ERP.ui, esc = ui.esc;
    const t = await PSA.ticket(id);
    if (!t) return;
    const upd = asArr(t.updates).slice().reverse().map((u) => ({
      at: esc(ui.dateTime(u.at)), actor: esc(u.actor || ""), status: ui.badge(u.status || "", statusTone(u.status || "")), note: '<span class="erp-sub">' + esc(u.note || "") + "</span>",
    }));
    const body =
      '<div class="rmm-status-line">' + ui.badge(t.status, statusTone(t.status)) + " " + ui.badge("P" + num(t.priority, 3), "info") + (t.assignee ? " " + ui.badge(t.assignee, "muted") : "") + "</div>" +
      '<h4 class="rmm-section-title">Ticket</h4><div class="rmm-kv">' +
      [["psa-u reference", esc(t.externalId)], ["Subject", esc(t.subject)], ["Device", esc(t.deviceHostname || t.deviceId || "—")],
       ["Configuration record", esc(t.configSystemId || t.configRefId || "—") + (t.configUrl ? ' · <a href="' + esc(t.configUrl) + '" target="_blank" rel="noopener">open</a>' : "")],
       ["Alert", t.alertId ? esc(t.alertId) + " " + (AL() && AL().stateBadge ? AL().stateBadge(t.alertState || "") : "") : "—"],
       ["Queue", esc(t.queue || "—")], ["Opened", esc(ui.dateTime(t.createdAt))], ["Updated", esc(ui.dateTime(t.updatedAt))],
       ["Resolved", t.resolvedAt ? esc(ui.dateTime(t.resolvedAt)) : "—"]]
        .map(([k, v]) => '<div class="rmm-kv-row"><span>' + esc(k) + "</span><b>" + v + "</b></div>").join("") + "</div>" +
      '<pre class="rmm-code">' + esc(t.description) + "</pre>" +
      '<h4 class="rmm-section-title">Activity</h4>' + ui.table([
        { key: "at", label: "When", render: (r) => r.at }, { key: "actor", label: "Actor", render: (r) => r.actor },
        { key: "status", label: "Status", render: (r) => r.status }, { key: "note", label: "Note", render: (r) => r.note },
      ], upd, { scroll: true });
    const m = ui.modal({ title: "psa-u ticket " + (t.externalId || t.id), size: "lg", body });
    if (!m) return;
    m.addEventListener("click", async (e) => {
      const btn = e.target.closest && e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "psa-detail-resolve") { const r = await PSA.resolveTicket(provider.id, t.id, {}); if (r.error) return (ERP.toast)("Failed: " + r.error, "error"); (ERP.toast)("Ticket resolved"); ui.closeModal(); paint(); }
      else if (act === "psa-detail-status") {
        const status = m.querySelector('[name="psa_new_status"]').value;
        const r = await PSA.syncStatus(provider.id, t.id, status, { actor: "console" });
        if (r.error) return (ERP.toast)("Failed: " + r.error, "error");
        (ERP.toast)("Status synced to alert"); ui.closeModal(); paint();
      }
    });
    const foot = ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }) + " " +
      '<select name="psa_new_status" style="width:auto">' + PSA.STATUSES.map((s) => '<option value="' + s + '"' + (s === t.status ? " selected" : "") + ">" + s + "</option>").join("") + "</select> " +
      ui.btn("Set status", { small: true, act: "psa-detail-status" }) + " " +
      (PSA.CLOSED.indexOf(t.status) === -1 ? ui.btn("Resolve", { small: true, primary: true, act: "psa-detail-resolve" }) : "");
    const fp = m.querySelector(".erp-modal-foot") || m.querySelector("#uiModalFoot");
    if (fp) { fp.innerHTML = foot; fp.hidden = false; }
  }

  PSA.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const provider = opts.provider;
    if (!provider) { host.innerHTML = ui.alert("No provider selected.", "warn"); return null; }
    async function paint() {
      host.innerHTML = await ticketsPanel(provider);
    }
    const toast = opts.toast || ERP.toast;
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "psa-settings") return openSettings(provider, paint);
      if (act === "psa-detail") return openTicket(provider, arg, paint);
      if (act === "psa-resolve") { const r = await PSA.resolveTicket(provider.id, arg, {}); if (r.error) return toast("Failed: " + r.error, "error"); toast("Ticket resolved"); return paint(); }
      if (act === "psa-sync") { const r = await PSA.syncStatus(provider.id, arg, "in-progress", { actor: "console", acknowledge: true }); if (r.error) return toast("Failed: " + r.error, "error"); toast("psa-u ticket moved to in-progress, alert acknowledged"); return paint(); }
      if (act === "psa-ingest-test") {
        const open = await PSA.tickets(provider.id, { open: true });
        const t0 = open[0];
        if (!t0) return toast("No open ticket to sync", "warn");
        const r = await PSA.ingest(provider.id, { externalId: t0.externalId, status: "in-progress", note: "Inbound webhook test." });
        if (r.error) return toast("Ingest failed: " + r.error, "error");
        toast("Inbound webhook applied to " + t0.externalId); return paint();
      }
    });
    await paint();
    return {};
  };

  PSA.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    host.innerHTML = "";
    return PSA.renderPanel(host, opts);
  };
})();
