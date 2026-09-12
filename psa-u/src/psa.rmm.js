/* ============================================================
   PSA-U — RMM / monitoring integration (Phase 10 · Task 48)

   The monitoring system sees a disk fill up at 02:00; PSA-U should
   not need a human to notice. This module ingests device/alert
   events from an RMM and turns the ones that matter into tickets
   automatically — without flooding the desk.

     • rmmAlert      — one monitored condition on one device, with
                       its severity, message, a first/last-seen span
                       and a count, plus the ticket it became.
     • rmmRule       — an ordered rule (match on severity / alert
                       type / device type) that decides whether an
                       alert creates a ticket and with what priority,
                       board and type.
     • rmmSettings   — global switches: auto-create, auto-resolve and
                       the de-duplication window.

   De-duplication. Re-firing the same alert (same external id, or
   same device + type while still open) updates the existing alert
   and its ticket instead of opening a second one. Auto-resolution:
   when the monitoring system reports the condition cleared, the
   alert is closed and — if the setting is on — the linked ticket is
   resolved with an explanatory note.

   Device linkage. Every alert is tied to the client's configuration
   record (Phase 10, Task 47) by external id, serial, hostname or
   name, so the service desk is looking at the real device.

   Storage: provider-document records (kinds "rmmAlert" / "rmmRule" /
   "rmmSettings"). Tickets are created through ERP.tickets, which
   keeps numbering, SLA stamping and the workflow engine intact.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const ui = ERP.ui;
  const R = (ERP.rmm = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("rmm requires the tenancy service");
    return ERP.tenancy;
  }
  const nowIso = () => new Date().toISOString();
  function actor() { return ERP.security ? ERP.security.actor() : { role: ERP.role, memberId: null, member: null }; }
  function actorName() {
    const a = actor();
    return a.member ? a.member.name : (ERP.ROLE_LABELS && ERP.ROLE_LABELS[a.role]) || ERP.role || "—";
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const providerRecords = (pid, kind) => ten().records("provider", pid, kind);

  /* ─────────────────────────── vocabulary ─────────────────────────── */

  R.SEVERITIES = [
    { id: "critical", label: "Critical", tone: "danger", priority: "p1" },
    { id: "warning", label: "Warning", tone: "warn", priority: "p2" },
    { id: "info", label: "Info", tone: "muted", priority: "p3" },
  ];
  R.ALERT_STATUSES = [
    { id: "open", label: "Open", tone: "warn" },
    { id: "resolved", label: "Resolved", tone: "success" },
    { id: "cleared", label: "Cleared", tone: "muted" },
    { id: "ignored", label: "Ignored", tone: "muted" },
  ];
  R.severityLabel = (id) => (R.SEVERITIES.find((s) => s.id === id) || {}).label || id || "—";
  R.severityTone = (id) => (R.SEVERITIES.find((s) => s.id === id) || {}).tone || "muted";
  R.statusLabel = (id) => (R.ALERT_STATUSES.find((s) => s.id === id) || {}).label || id || "—";
  R.statusTone = (id) => (R.ALERT_STATUSES.find((s) => s.id === id) || {}).tone || "muted";

  R.DEFAULT_SETTINGS = {
    enabled: true,
    autoCreate: true,
    autoResolve: true,
    dedupeWindowMinutes: 30,
    resolveStatus: "",
    ticketSource: "monitoring",
  };

  /* ─────────────────────────── factories & settings ─────────────────────────── */

  R.newAlert = (over) => Object.assign({
    kind: "rmmAlert", id: null, providerId: null, externalId: "",
    companyId: null, configId: null, deviceName: "", deviceType: "",
    alertType: "", severity: "warning", message: "", status: "open",
    firstSeen: null, lastSeen: null, count: 1, acked: false,
    ticketId: null, ticketNumber: "", ticketCompanyId: null,
    resolvedAt: null, resolvedBy: "", clearedAt: null, notes: [],
  }, over || {});

  R.newRule = (over) => Object.assign({
    kind: "rmmRule", id: null, providerId: null, name: "",
    match: "severity", value: "critical", order: 0,
    createTicket: true, priority: "p1", board: "", type: "", autoResolve: true,
  }, over || {});

  R.settings = async function (pid) {
    const rec = (await providerRecords(pid, "rmmSettings"))[0];
    return Object.assign({}, R.DEFAULT_SETTINGS, rec || {});
  };
  R.saveSettings = async function (pid, patch) {
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    const rec = Object.assign({ kind: "rmmSettings", id: "settings", providerId: pid }, await R.settings(pid), patch || {});
    await ten().upsert("provider", pid, rec);
    return { record: rec };
  };

  R.rules = async function (pid) {
    const list = (await providerRecords(pid, "rmmRule")).slice();
    list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
    return list;
  };
  R.rule = async (pid, id) => (await R.rules(pid)).find((r) => String(r.id) === String(id)) || null;
  R.saveRule = async function (pid, rec) {
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    const list = await providerRecords(pid, "rmmRule");
    const existing = rec.id != null ? list.find((r) => String(r.id) === String(rec.id)) : null;
    const out = Object.assign(R.newRule(), existing || {}, rec);
    if (!out.name || !String(out.name).trim()) return { error: "name_required", message: "Give the rule a name." };
    out.providerId = pid;
    if (!existing) out.id = ten().nextId(list);
    await ten().upsert("provider", pid, out);
    return { record: out, created: !existing };
  };
  R.removeRule = async function (pid, id) {
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    await ten().remove("provider", pid, (r) => r.kind === "rmmRule" && String(r.id) === String(id));
    return { ok: true, id: id };
  };

  /* the first rule matching an event (rules are ordered) */
  R.matchRule = async function (pid, event) {
    const rules = await R.rules(pid);
    for (const r of rules) {
      if (r.match === "any") return r;
      if (r.match === "severity" && String(event.severity) === String(r.value)) return r;
      if (r.match === "alertType" && String(event.alertType) === String(r.value)) return r;
      if (r.match === "deviceType" && String(event.deviceType) === String(r.value)) return r;
    }
    return null;
  };

  /* ─────────────────────────── device linkage ─────────────────────────── */

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

  /* Find the client + configuration record an event refers to. */
  R.locateDevice = async function (pid, event) {
    const companies = await ERP.companies.list(pid);
    let fallback = null;
    for (const e of companies) {
      const items = await ERP.configurations.forCompany(e.id);
      for (const r of items) {
        const hit =
          (event.externalId && (String(r.externalId) === String(event.externalId))) ||
          (event.serialNumber && norm(r.serialNumber) === norm(event.serialNumber)) ||
          (event.hostname && norm(r.hostname) === norm(event.hostname)) ||
          (event.deviceName && (norm(r.name) === norm(event.deviceName) || norm(r.hostname) === norm(event.deviceName)));
        if (hit) return { companyId: e.id, configId: r.id, config: r };
      }
      if (!fallback && event.companyId != null && String(e.id) === String(event.companyId)) fallback = { companyId: e.id, configId: null, config: null };
      if (!fallback && e.id != null && event.companyId == null) fallback = { companyId: e.id, configId: null, config: null };
    }
    if (event.companyId != null) return { companyId: event.companyId, configId: null, config: null };
    return fallback || { companyId: null, configId: null, config: null };
  };

  /* ─────────────────────────── ingest ─────────────────────────── */

  function openAlertKey(a) { return [a.companyId, a.configId || a.deviceName, norm(a.alertType)].join("|"); }

  R.ingest = async function (pid, events, opts) {
    opts = opts || {};
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    const settings = await R.settings(pid);
    if (settings.enabled === false && !opts.force) return { error: "disabled" };
    const list = events && events.records ? events.records : (Array.isArray(events) ? events : [events]);
    const report = { received: 0, created: [], updated: [], resolved: [], tickets: [], skipped: [] };
    for (const raw of list || []) {
      if (!raw) continue;
      report.received += 1;
      const ev = {
        externalId: raw.externalId != null ? String(raw.externalId) : (raw.id != null ? String(raw.id) : ""),
        companyId: raw.companyId != null ? raw.companyId : null,
        configId: raw.configId != null ? raw.configId : null,
        deviceName: raw.deviceName || raw.device || raw.hostname || "",
        deviceType: raw.deviceType || raw.type || "",
        serialNumber: raw.serialNumber || "",
        hostname: raw.hostname || "",
        alertType: raw.alertType || raw.alert || raw.name || "alert",
        severity: R.SEVERITIES.some((s) => s.id === raw.severity) ? raw.severity : "warning",
        message: raw.message || raw.detail || "",
        status: raw.status === "resolved" || raw.status === "clear" || raw.cleared === true ? "resolved" : "open",
      };
      const loc = ev.configId != null || ev.companyId != null ? { companyId: ev.companyId, configId: ev.configId, config: null } : await R.locateDevice(pid, ev);
      const companyId = loc.companyId != null ? loc.companyId : ev.companyId;
      const configId = ev.configId != null ? ev.configId : loc.configId;
      const now = nowIso();
      const all = await providerRecords(pid, "rmmAlert");
      const existing = all.find((a) =>
        (ev.externalId && a.externalId === ev.externalId) ||
        (String(a.companyId) === String(companyId) && String(a.configId) === String(configId) && norm(a.alertType) === norm(ev.alertType) && String(a.deviceName) === String(ev.deviceName)));
      const windowMs = num(settings.dedupeWindowMinutes, 30) * 60000;
      const withinWindow = existing && existing.lastSeen && (Date.now() - Date.parse(existing.lastSeen)) <= Math.max(windowMs, 60000);

      if (ev.status === "resolved") {
        await resolveOrClear(pid, settings, existing, ev, now, report);
        continue;
      }

      if (existing && existing.status === "open" && (withinWindow || ev.externalId)) {
        existing.count = (Number(existing.count) || 1) + 1;
        existing.lastSeen = now;
        if (ev.message) existing.message = ev.message;
        existing.severity = ev.severity;
        if (configId != null && existing.configId == null) existing.configId = configId;
        await ten().upsert("provider", pid, existing);
        report.updated.push(existing);
        await appendTicketNote(pid, settings, existing, ev, now);
        await emit(pid, "alert.received", { alert: existing, event: ev, deduped: true });
        if (ERP.workflow && ev.severity === "critical") { try { await ERP.workflow.emit("alert.repeated", { providerId: pid, alert: existing, event: ev }); } catch (e) {} }
        continue;
      }

      let alert = Object.assign(R.newAlert(), {
        providerId: pid, externalId: ev.externalId, companyId: companyId, configId: configId,
        deviceName: ev.deviceName, deviceType: ev.deviceType, alertType: ev.alertType,
        severity: ev.severity, message: ev.message, status: "open",
        firstSeen: now, lastSeen: now, count: 1,
      });
      alert.id = ten().nextId(all);
      const rule = await R.matchRule(pid, ev);
      // if the same condition already has an open alert, don't create a duplicate
      const dup = all.find((a) => a.status === "open" && openAlertKey(a) === openAlertKey(alert));
      if (dup && !opts.noDedup) {
        dup.count = (Number(dup.count) || 1) + 1; dup.lastSeen = now;
        await ten().upsert("provider", pid, dup);
        report.updated.push(dup);
        await appendTicketNote(pid, settings, dup, ev, now);
        continue;
      }
      await ten().upsert("provider", pid, alert);
      report.created.push(alert);

      const shouldCreate = rule ? rule.createTicket : (ev.severity !== "info");
      if (shouldCreate && settings.autoCreate !== false) {
        const made = await createTicket(pid, settings, alert, rule, ev, loc.config);
        if (made && made.ticket) { alert = made.alert; report.tickets.push(made.ticket); }
        else if (made && made.error) report.skipped.push({ alertId: alert.id, reason: made.error });
      }
      await emit(pid, "alert.received", { alert: alert, event: ev, deduped: false });
    }
    return { report: report };
  };

  function string(o, k) { const v = o[k]; return v == null ? "" : String(v); }
  function num(v, d) { const n = Number(v); return isFinite(n) ? n : (d || 0); }
  async function emit(pid, event, ctx) {
    if (!ERP.workflow) return;
    try { await ERP.workflow.emit(event, Object.assign({ providerId: pid }, ctx || {})); } catch (e) {}
  }

  async function createTicket(pid, settings, alert, rule, ev, config) {
    if (alert.companyId == null) return { error: "no_company" };
    const rec = {
      companyId: alert.companyId,
      summary: "[" + R.severityLabel(alert.severity) + "] " + alert.alertType + (alert.deviceName ? " — " + alert.deviceName : ""),
      detail: "Monitoring alert" + (config ? " on " + config.name : (alert.deviceName ? " on " + alert.deviceName : "")) + ".\n\n" + (alert.message || ""),
      source: settings.ticketSource || "monitoring",
      priority: alert.severity === "critical" ? "p1" : alert.severity === "warning" ? "p2" : "p3",
      tags: ["monitoring", alert.alertType].filter(Boolean),
      board: rule && rule.board ? rule.board : "",
      type: rule && rule.type ? rule.type : "",
    };
    const res = await ERP.tickets.save(alert.companyId, rec, { system: true });
    if (res.error) return { error: res.error, message: res.message };
    const t = res.record;
    alert.ticketId = t.id; alert.ticketNumber = t.number; alert.ticketCompanyId = t.companyId;
    if (rule && rule.autoResolve === false) alert.noAutoResolve = true;
    await ten().upsert("provider", pid, alert);
    await emit(pid, "alert.ticket_created", { alert: alert, ticket: t, event: ev });
    return { alert: alert, ticket: t };
  }

  async function appendTicketNote(pid, settings, alert, ev, now) {
    if (alert.ticketId == null) return;
    const cid = alert.ticketCompanyId != null ? alert.ticketCompanyId : alert.companyId;
    try {
      await ERP.tickets.addNote(cid, alert.ticketId, {
        body: "Monitoring update (" + ui.dateTime(now) + "): " + (ev.message || alert.alertType) + " · " + R.severityLabel(alert.severity),
        internal: true, system: true,
      });
    } catch (e) {}
  }

  async function resolveOrClear(pid, settings, alert, ev, now, report) {
    if (!alert) { report.skipped.push({ event: ev, reason: "no_open_alert" }); return; }
    if (alert.status !== "open") { report.skipped.push({ alertId: alert.id, reason: "already_" + alert.status }); return; }
    alert.status = "resolved";
    alert.resolvedAt = now; alert.resolvedBy = ev.resolvedBy || "monitoring"; alert.lastSeen = now;
    const rule = await R.matchRule(pid, Object.assign({ severity: alert.severity, alertType: alert.alertType, deviceType: alert.deviceType })); 
    const autoResolve = alert.noAutoResolve ? false : (settings.autoResolve !== false && (!rule || rule.autoResolve !== false));
    let resolvedTicket = null;
    if (alert.ticketId != null && autoResolve) {
      const cid = alert.ticketCompanyId != null ? alert.ticketCompanyId : alert.companyId;
      const t = await ERP.tickets.get(cid, alert.ticketId);
      if (t) {
        const codes = ERP.tickets.closedCodes ? await ERP.tickets.closedCodes(pid) : [];
        const target = settings.resolveStatus || codes[0] || "closed";
        const codesNow = codes.map(String);
        if (codesNow.indexOf(String(t.status)) === -1) {
          await ERP.tickets.addNote(cid, t.id, { body: "Monitoring reports this alert cleared. Auto-resolving.", internal: false, system: true });
          const res = await ERP.tickets.save(cid, Object.assign({}, t, { status: target }), { system: true });
          if (!res.error) { resolvedTicket = res.record; alert.ticketResolved = true; }
        }
      }
    }
    await ten().upsert("provider", pid, alert);
    report.resolved.push(alert);
    await emit(pid, "alert.resolved", { alert: alert, event: ev, ticket: resolvedTicket });
    return alert;
  }

  /* ─────────────────────────── queries ─────────────────────────── */

  R.alerts = async function (pid, query) {
    query = query || {};
    let list = (await providerRecords(pid, "rmmAlert")).slice();
    if (query.status) list = list.filter((a) => a.status === query.status);
    if (query.severity) list = list.filter((a) => a.severity === query.severity);
    if (query.companyId) list = list.filter((a) => String(a.companyId) === String(query.companyId));
    if (query.configId) list = list.filter((a) => String(a.configId) === String(query.configId));
    if (query.openOnly) list = list.filter((a) => a.status === "open");
    if (query.q) { const q = String(query.q).toLowerCase(); list = list.filter((a) => [a.deviceName, a.alertType, a.message].join(" ").toLowerCase().indexOf(q) !== -1); }
    list.sort((a, b) => String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")));
    return list;
  };
  R.alert = async (pid, id) => (await providerRecords(pid, "rmmAlert")).find((a) => String(a.id) === String(id)) || null;
  R.openAlerts = (pid, query) => R.alerts(pid, Object.assign({}, query || {}, { openOnly: true }));
  R.forDevice = async (pid, configId) => R.alerts(pid, { configId: configId });

  R.acknowledge = async function (pid, id, by) {
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    const a = await R.alert(pid, id);
    if (!a) return { error: "not_found" };
    a.acked = true; a.ackedBy = by || actorName(); a.ackedAt = nowIso();
    await ten().upsert("provider", pid, a);
    return { record: a };
  };
  R.resolve = async function (pid, id, opts) {
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    const a = await R.alert(pid, id);
    if (!a) return { error: "not_found" };
    await resolveOrClear(pid, await R.settings(pid), a, { message: (opts && opts.note) || "Manually resolved" }, nowIso(), { resolved: [], skipped: [] });
    return { record: a };
  };
  R.ignore = async function (pid, id, reason) {
    if (!ERP.security.enforce("rmm.edit")) return { error: "forbidden" };
    const a = await R.alert(pid, id);
    if (!a) return { error: "not_found" };
    a.status = "ignored"; a.notes = (a.notes || []).concat([{ at: nowIso(), by: actorName(), text: reason || "Ignored" }]);
    await ten().upsert("provider", pid, a);
    return { record: a };
  };

  R.stats = async function (pid) {
    const list = await providerRecords(pid, "rmmAlert");
    const today = ui.today();
    const seen = {};
    list.forEach((a) => { const k = a.configId != null ? "c" + a.configId : "n" + norm(a.deviceName); if (k !== "n") seen[k] = 1; });
    return {
      total: list.length,
      open: list.filter((a) => a.status === "open").length,
      critical: list.filter((a) => a.status === "open" && a.severity === "critical").length,
      resolvedToday: list.filter((a) => a.status === "resolved" && String(a.resolvedAt || "").slice(0, 10) === today).length,
      tickets: list.filter((a) => a.ticketId != null).length,
      devices: Object.keys(seen).length,
    };
  };

  R.ensure = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const seeded = { settings: 0, rules: 0 };
    if (!(await providerRecords(pid, "rmmSettings")).length) {
      await ten().upsert("provider", pid, Object.assign({ kind: "rmmSettings", id: "settings", providerId: pid }, R.DEFAULT_SETTINGS));
      seeded.settings = 1;
    }
    if (!(await providerRecords(pid, "rmmRule")).length) {
      const seed = [
        { name: "Critical alerts page the desk", match: "severity", value: "critical", order: 1, createTicket: true, priority: "p1", autoResolve: true },
        { name: "Warnings raise a normal ticket", match: "severity", value: "warning", order: 2, createTicket: true, priority: "p2", autoResolve: true },
        { name: "Info events are recorded only", match: "severity", value: "info", order: 3, createTicket: false, priority: "p3", autoResolve: false },
      ];
      let id = 0;
      for (const r of seed) { id += 1; await ten().upsert("provider", pid, Object.assign(R.newRule(r), { id: id, providerId: pid })); seeded.rules += 1; }
    }
    return seeded;
  };

  /* ═══════════════════════════ station tab ═══════════════════════════ */

  function esc(s) { return ui.esc(s); }

  R.renderMonitoring = async function (panel, pid, refresh) {
    if (!ERP.security.enforce("rmm.view")) { panel.innerHTML = ui.alert("Your role cannot view monitoring.", "warn"); return; }
    const state = panel.__rmmState || (panel.__rmmState = { status: "open", severity: "" });
    if (!state.status) state.status = "open";
    const [alerts, stats, settings, rules, companies] = await Promise.all([
      R.alerts(pid, state), R.stats(pid), R.settings(pid), R.rules(pid), ERP.companies.optionList(),
    ]);
    const companyName = {}; companies.forEach((c) => { companyName[String(c.value)] = c.label; });
    const canEdit = ERP.security.can("rmm.edit");

    const rows = alerts.map((a) => ({
      severity: ui.badge(R.severityLabel(a.severity), R.severityTone(a.severity)),
      device: esc(a.deviceName || "—") + (a.configId != null ? ' <span class="erp-sub">asset</span>' : ""),
      company: esc(a.companyId != null ? (companyName[String(a.companyId)] || "—") : "—"),
      type: esc(a.alertType),
      message: esc(a.message || "—"),
      seen: esc(ui.dateTime(a.lastSeen)) + (a.count > 1 ? ' <span class="erp-sub">×' + a.count + "</span>" : ""),
      status: ui.badge(R.statusLabel(a.status), R.statusTone(a.status)),
      ticket: a.ticketNumber ? "#" + esc(a.ticketNumber) : "—",
      actions: (canEdit && a.status === "open" ? ui.btn("Resolve", { small: true, act: "rm-resolve", arg: a.id }) + " " + ui.btn("Ignore", { small: true, act: "rm-ignore", arg: a.id }) : ""),
    }));

    const ruleRows = rules.map((r) => ({
      name: esc(r.name),
      match: esc(r.match) + " = " + esc(r.value),
      creates: r.createTicket ? ui.badge("Creates ticket", "success") : ui.badge("Record only", "muted"),
      priority: esc(r.priority || "—"),
      autoResolve: r.autoResolve === false ? "No" : "Yes",
      actions: canEdit ? ui.btn("Edit", { small: true, act: "rmr-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rmr-del", arg: r.id }) : "",
    }));

    panel.innerHTML =
      '<div class="erp-summary">' +
        '<div class="erp-summary-item"><span>Open alerts</span><b>' + stats.open + "</b></div>" +
        '<div class="erp-summary-item"><span>Critical open</span><b>' + stats.critical + "</b></div>" +
        '<div class="erp-summary-item"><span>Resolved today</span><b>' + stats.resolvedToday + "</b></div>" +
        '<div class="erp-summary-item"><span>Linked to tickets</span><b>' + stats.tickets + "</b></div>" +
      "</div>" +
      '<div class="erp-toolbar">' +
        ui.select("rm-status", "", [{ value: "", label: "Any status" }, { value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "ignored", label: "Ignored" }], state.status, null, "Filter by status") +
        ui.select("rm-sev", "", [{ value: "", label: "Any severity" }].concat(R.SEVERITIES.map((s) => ({ value: s.id, label: s.label }))), state.severity, null, "Filter by severity") +
        (canEdit ? ui.btn("Ingest events", { small: true, act: "rm-ingest" }) + " " + ui.btn("New rule", { small: true, act: "rmr-new" }) : "") +
      "</div>" +
      ui.table([
        { key: "severity", label: "Severity" }, { key: "device", label: "Device" }, { key: "company", label: "Client" },
        { key: "type", label: "Alert" }, { key: "message", label: "Message" }, { key: "seen", label: "Last seen" },
        { key: "status", label: "Status" }, { key: "ticket", label: "Ticket" }, { key: "actions", label: "", align: "right" },
      ], rows, { emptyText: "No alerts match these filters." }) +
      '<div class="erp-sep"></div>' +
      ui.card("Ingestion rules", ui.table([
        { key: "name", label: "Rule" }, { key: "match", label: "When" }, { key: "creates", label: "Action" },
        { key: "priority", label: "Priority" }, { key: "autoResolve", label: "Auto-resolve" }, { key: "actions", label: "", align: "right" },
      ], ruleRows, { emptyText: "No rules — every non-info alert creates a ticket." })) +
      ui.card("Settings", ui.form(
        '<div class="erp-form-row">' +
          ui.check("enabled", "Ingestion enabled", settings.enabled !== false) +
          ui.check("autoCreate", "Create tickets automatically", settings.autoCreate !== false) +
        "</div>" +
        '<div class="erp-form-row">' +
          ui.check("autoResolve", "Resolve tickets when the alert clears", settings.autoResolve !== false) +
          ui.number("dedupeWindowMinutes", "De-duplication window (minutes)", settings.dedupeWindowMinutes, { min: 0, step: 5 }) +
        "</div>",
        canEdit ? ui.btn("Save settings", { small: true, primary: true, act: "rm-save" }) : ui.alert("Your role cannot change monitoring settings.", "warn")
      ));

    const sel = (s, k) => { const el = panel.querySelector(s); if (el) el.addEventListener("change", () => { state[k] = el.value; refresh(); }); };
    sel("[name=rm-status]", "status"); sel("[name=rm-sev]", "severity");

    const saveBtn = panel.querySelector("[data-act=rm-save]");
    if (saveBtn) saveBtn.onclick = async () => {
      const f = panel.querySelector("[data-ui-form]");
      const v = ui.collect(f, ["enabled", "autoCreate", "autoResolve", "dedupeWindowMinutes"]);
      const r = await R.saveSettings(pid, v);
      if (r.error) return ERP.toast(r.message || r.error, "error");
      ERP.toast("Monitoring settings saved.", "success"); refresh();
    };

    ui.bind(panel, "click", "[data-act]", async (el, e, act, arg) => {
      if (act === "rm-resolve") { const r = await R.resolve(pid, arg, {}); if (r.error) return ERP.toast(r.message || r.error, "error"); ERP.toast("Alert resolved.", "success"); refresh(); }
      if (act === "rm-ignore") { const r = await R.ignore(pid, arg, "Ignored from the console"); if (r.error) return ERP.toast(r.message || r.error, "error"); refresh(); }
      if (act === "rm-ingest") return openIngestModal(pid, refresh);
      if (act === "rmr-new") return openRuleModal(pid, null, refresh);
      if (act === "rmr-edit") return openRuleModal(pid, await R.rule(pid, arg), refresh);
      if (act === "rmr-del") {
        const ok = await ui.confirm({ title: "Delete rule", message: "Delete this ingestion rule?", danger: true });
        if (!ok) return;
        await R.removeRule(pid, arg); ERP.toast("Rule deleted.", "success"); refresh();
      }
    });
  };

  async function openRuleModal(pid, rec, refresh) {
    if (!ERP.security.enforce("rmm.edit")) return;
    const r = rec || R.newRule();
    const boards = await ERP.taxonomy.optionList(pid, "board");
    const types = await ERP.taxonomy.optionList(pid, "type");
    const m = ui.modal({
      title: rec ? "Edit rule" : "New ingestion rule",
      body: ui.form(
        ui.text("name", "Rule name", r.name) +
        '<div class="erp-form-row">' +
          ui.select("match", "Match on", [{ value: "severity", label: "Severity" }, { value: "alertType", label: "Alert type" }, { value: "deviceType", label: "Device type" }, { value: "any", label: "Any alert" }], r.match) +
          ui.text("value", "Value", r.value) +
        "</div>" +
        '<div class="erp-form-row">' + ui.number("order", "Order", r.order, { step: 1 }) + ui.check("createTicket", "Create a ticket", r.createTicket !== false) + "</div>" +
        '<div class="erp-form-row">' + ui.select("priority", "Priority", ["p1", "p2", "p3", "p4"].map((p) => ({ value: p, label: p.toUpperCase() })), r.priority) + ui.check("autoResolve", "Auto-resolve the ticket", r.autoResolve !== false) + "</div>" +
        '<div class="erp-form-row">' + ui.select("board", "Board", [{ value: "", label: "— default —" }].concat(boards), r.board) + ui.select("type", "Type", [{ value: "", label: "— default —" }].concat(types), r.type) + "</div>"
      ),
      foot: ui.btn("Cancel", { small: true, act: "rmr-cancel" }) + " " + ui.btn("Save", { small: true, primary: true, act: "rmr-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=rmr-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=rmr-save]").onclick = async () => {
      const v = ui.collect(f, ["name", "match", "value", "order", "createTicket", "priority", "autoResolve", "board", "type"]);
      if (v.match === "any") v.value = "";
      const res = await R.saveRule(pid, Object.assign({}, r, v));
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal(); ERP.toast("Rule saved.", "success"); refresh();
    };
  }

  async function openIngestModal(pid, refresh) {
    if (!ERP.security.enforce("rmm.edit")) return;
    const companies = await ERP.companies.list(pid);
    const sampleAssets = companies.length ? await ERP.configurations.items(pid, companies[0].id, {}) : [];
    const dev = sampleAssets[0];
    const sample = [
      {
        externalId: "rmm-" + Date.now(),
        companyId: companies.length ? companies[0].id : null,
        deviceName: dev ? dev.name : "NAS-01",
        deviceType: dev ? dev.type : "hardware",
        serialNumber: dev ? dev.serialNumber : "",
        hostname: dev ? dev.hostname : "",
        alertType: "disk_space", severity: "critical",
        message: "Volume C: is 96% full", status: "open",
      },
      {
        externalId: "rmm-clear-" + Date.now(), companyId: companies.length ? companies[0].id : null,
        deviceName: dev ? dev.name : "NAS-01", alertType: "disk_space", severity: "critical",
        message: "Volume C: is 41% full", status: "resolved",
      },
    ];
    const m = ui.modal({
      title: "Ingest monitoring events",
      size: "lg",
      body: ui.form(
        ui.alert("Events are de-duplicated against open alerts; a resolved event closes the linked ticket when auto-resolve is on.", "info") +
        '<div class="field"><label>Events (JSON array)</label><textarea name="events" rows="12">' + esc(JSON.stringify(sample, null, 2)) + "</textarea></div>"
      ),
      foot: ui.btn("Cancel", { small: true, act: "rmi-cancel" }) + " " + ui.btn("Ingest", { small: true, primary: true, act: "rmi-save" }),
    });
    const f = m.querySelector("[data-ui-form]");
    m.querySelector("[data-act=rmi-cancel]").onclick = () => ui.closeModal();
    m.querySelector("[data-act=rmi-save]").onclick = async () => {
      let events;
      try { events = JSON.parse(f.querySelector("[name=events]").value || "[]"); }
      catch (e) { return ERP.toast("That is not valid JSON.", "error"); }
      const res = await R.ingest(pid, events);
      if (res.error) return ERP.toast(res.message || res.error, "error");
      ui.closeModal();
      const rep = res.report;
      ERP.toast("Ingested " + rep.received + " · " + rep.created.length + " new alert(s), " + rep.tickets.length + " ticket(s), " + rep.resolved.length + " resolved.", "success");
      refresh();
    };
  }
})();
