/* ============================================================
   RMM-U — alert lifecycle  (Phase 5 · Task 24)

   An alert is the durable record of a monitor breach: it is created
   once, then carried through its whole life so the console, the
   automation engine and the PSA bridge all refer to the same object.

     firing  →  acknowledged  →  resolved            (human)
     firing  →  resolved                              (auto-cleared on recovery)
     firing  →  acknowledged  →  resolved             (human)

   Everything that makes unattended alerting tolerable lives here:

   • DE-DUPLICATION — one active alert per (monitor, device, subject)
     key. A repeat breach updates that record (occurrences++,
     last-seen, worst severity) instead of opening a second alert.
   • FLAPPING SUPPRESSION — an alert that resolves and re-fires within
     `config.rmm.alertFlapMinutes` reopens the *same* record and counts
     a flap; past `alertFlapThreshold` reopens it is flagged
     `flapping` so notification routing holds its pages.
   • SNOOZE — an operator can silence an alert until a moment in time.
   • SEVERITY MAPPING — a critical *state* never reports below the
     monitor's configured severity, and a monitor already at/above
     critical keeps its own (higher) severity.
   • ROOT CONTEXT — the alert snapshots device, hostname, site and
     group names, plus the monitor and (when one exists) policy that
     produced it, so an alert is diagnosable years later.
   • TIMELINE — every transition is appended to `history`.

   Assessment state (the per-monitor "since when / already fired"
   memory the "for N minutes" rule needs) lives in the hidden
   `rmm-v1-alertstate` document so it survives reloads.

   `AL.scan` walks a provider's devices, re-evaluates every applicable
   monitor and drives the lifecycle; it is also what emits the
   `monitor.state` / `alert.fired` / `alert.cleared` events the
   automation engine consumes. Alerts live on the provider aggregate
   (`provider.alerts`), so they travel with a tenant and its backups.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const G = ERP.groups || null;
  const M = ERP.masterConfig || null;
  const AL = (ERP.alerts = {});
  const MON = () => window.ERP.monitors || null;
  const SCH = () => window.ERP.schedules || null;
  const RT = () => window.ERP.routing || null;
  const PSA = () => window.ERP.psa || null;
  const AUTO = () => window.ERP.automations || null;
  const NOT = () => window.ERP.notify || null;

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const uniq = (a) => [...new Set(a)];
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ═══════════════════════ catalogue ═══════════════════════ */

  AL.STATES = ["firing", "acknowledged", "resolved"];
  AL.ACTIVE = ["firing", "acknowledged"];
  AL.MODULE = "alertstate";

  const enabled = () => cfg("rmm.alertEnabled", true) !== false;
  const flapMinutes = () => Math.max(0, num(cfg("rmm.alertFlapMinutes", 10), 10));
  const flapThreshold = () => Math.max(1, num(cfg("rmm.alertFlapThreshold", 3), 3));
  const historyCap = () => Math.max(50, num(cfg("rmm.alertHistory", 500), 500));
  const stateCap = () => Math.max(50, num(cfg("rmm.alertHistory", 500), 500));

  /* ═══════════════════════ hidden assessment state ═══════════════════════ */

  async function loadState() { const r = await store.loadDoc(AL.MODULE); return asArr(r.error ? [] : r.records); }
  async function saveState(list) { return store.saveDoc(AL.MODULE, list); }
  AL.loadState = loadState;
  AL.stateKey = (monitorId, deviceId) => String(monitorId) + "|" + String(deviceId);

  async function upsertState(providerId, deviceId, monitorId, assessment, at) {
    const key = AL.stateKey(monitorId, deviceId);
    const rows = await loadState();
    let rec = rows.find((r) => r.kind === "assessment" && String(r.key) === key);
    if (!rec) {
      rec = { kind: "assessment", id: rid("asr"), key, providerId: String(providerId), deviceId: String(deviceId), monitorId: String(monitorId) };
      rows.push(rec);
    }
    rec.state = assessment.state;
    rec.since = assessment.since || null;
    rec.fired = !!assessment.fired;
    rec.value = assessment.value == null ? null : assessment.value;
    rec.message = S(assessment.message, 300);
    rec.at = at || now();
    const trimmed = rows.slice(Math.max(0, rows.length - stateCap()));
    await saveState(trimmed);
    return rec;
  }
  AL.upsertState = upsertState;

  AL.pruneState = async function (providerId) {
    const rows = await loadState();
    const kept = providerId ? rows.filter((r) => String(r.providerId) !== String(providerId)) : [];
    const w = await saveState(kept);
    if (w && w.error) return { error: w.error };
    return { ok: true, removed: rows.length - kept.length };
  };

  /* ═══════════════════════ severity helpers ═══════════════════════ */

  async function severities() {
    if (!M) return [];
    try { return asArr(await M.section("severities")); } catch (e) { return []; }
  }
  AL.severities = severities;

  AL.severity = async function (id) {
    const list = await severities();
    return list.find((s) => String(s.id) === String(id)) || null;
  };

  AL.rankOf = async function (id) {
    const s = await AL.severity(id);
    return s ? num(s.rank, 0) : null;
  };

  /* The severity an alert should carry for a state. Critical states are
     mapped to master `sev-critical`, but a monitor already configured at
     or above critical (e.g. emergency) keeps its own severity. */
  AL.severityForState = function (monitorSeverity, state, list) {
    if (state !== "critical") return monitorSeverity || (list && list[0] && list[0].id) || "sev-warning";
    const byId = {};
    asArr(list).forEach((s) => { byId[s.id] = s; });
    const cur = byId[monitorSeverity];
    let crit = byId["sev-critical"];
    if (!crit) {
      const above = asArr(list).filter((s) => num(s.rank, 0) >= 30).sort((a, b) => num(a.rank, 0) - num(b.rank, 0));
      crit = above[0] || null;
    }
    if (!crit) return monitorSeverity || "sev-critical";
    if (cur && num(cur.rank, 0) >= num(crit.rank, 0)) return monitorSeverity;
    return crit.id;
  };

  AL.severityInfo = async function (id) {
    const SCHx = SCH();
    if (SCHx && typeof SCHx.severityInfo === "function") { try { return await SCHx.severityInfo(id); } catch (e) {} }
    const s = await AL.severity(id);
    if (!s) return null;
    return { id: s.id, label: s.label, rank: num(s.rank, 0), tone: s.tone || "info", notify: s.notify !== false, critical: num(s.rank, 0) >= 30 };
  };

  /* ═══════════════════════ identity ═══════════════════════ */

  AL.subjectOf = function (monitor) {
    monitor = asObj(monitor);
    const st = asObj(monitor.settings);
    const t = String(monitor.type || "");
    if (/service|process|application/.test(t) && st.name) return String(st.name);
    if (t === "disk" && (st.volume || st.mount)) return String(st.volume || st.mount);
    if (t === "port") return String((st.host ? st.host + ":" : "") + (st.port || ""));
    if (t === "web") return S(st.url, 200);
    if (t === "snmp") return S((st.host ? st.host + " " : "") + (st.oid || ""), 160);
    if (t === "eventlog") return S((st.log ? st.log + " " : "") + (st.source || st.eventId || ""), 160);
    return "";
  };

  /* One active alert per (monitor, device, subject). */
  AL.dedupeKey = function (monitor, deviceId) {
    monitor = asObj(monitor);
    const subject = AL.subjectOf(monitor);
    return String(monitor.id || monitor.monitorId || "") + "|" + String(deviceId) + (subject ? "|" + subject : "");
  };

  /* Snapshot the device's position in the hierarchy for the alert record. */
  AL.deviceContext = function (provider, device, ctx) {
    device = D.normalizeDevice(device) || {};
    provider = provider || {};
    let groupIds = asArr(device.groupIds).map(String);
    if (G && typeof G.membershipIds === "function") {
      try { groupIds = G.membershipIds(provider, device, ctx || { provider }).map(String); } catch (e) {}
    }
    const groups = asArr(provider.deviceGroups);
    const groupNames = groupIds.map((id) => {
      const g = groups.find((x) => String(x.id) === String(id));
      return g ? (g.name || id) : id;
    });
    const siteId = device.siteId != null && device.siteId !== "" ? String(device.siteId) : null;
    const site = asArr(provider.sites).find((s) => String(s.id) === String(siteId));
    return {
      device,
      deviceId: String(device.id || ""),
      hostname: device.hostname || device.displayName || String(device.id || ""),
      siteId,
      siteName: site ? (site.name || siteId) : "",
      groupIds,
      groupNames,
      osFamily: asObj(device.os).family || "",
    };
  };

  function findActive(list, key) {
    return asArr(list).find((a) => AL.ACTIVE.indexOf(a.state) !== -1 && String(a.dedupeKey) === String(key)) || null;
  }
  function findResolvedRecent(list, key, atMs, windowMs) {
    let best = null;
    asArr(list).forEach((a) => {
      if (a.state !== "resolved" || String(a.dedupeKey) !== String(key)) return;
      const t = Date.parse(a.resolvedAt || a.lastSeenAt || a.firstFiredAt);
      if (!isFinite(t)) return;
      if (atMs - t > windowMs) return;
      if (!best || t > Date.parse(best.resolvedAt || best.lastSeenAt || best.firstFiredAt)) best = a;
    });
    return best;
  }

  /* ═══════════════════════ change listeners ═══════════════════════ */

  const listeners = [];
  AL.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function emit(type, payload) {
    listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} });
    const EV = window.ERP.events;
    if (EV && typeof EV.emit === "function" && payload && payload.deviceId) {
      try {
        EV.emit({ kind: "alert", type, alert: payload.id || null, alertState: payload.state, severity: payload.severityId, deviceId: payload.deviceId, providerId: payload.providerId, hostname: payload.hostname, at: payload.at || now() });
      } catch (e) {}
    }
  }
  AL.emit = emit;

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "alert", targetId, summary }); } catch (e) {}
  }

  function actorName() {
    try {
      const tm = ERP.team && ERP.team.me;
      const me = typeof tm === "function" ? tm() : tm;
      if (me && me.displayName) return String(me.displayName);
    } catch (e) {}
    return ERP.role || "owner";
  }
  AL.actorName = actorName;

  /* ═══════════════════════ the lifecycle ═══════════════════════ */

  /* input: { monitorId, monitorName, monitorType, policyId, policyName,
              deviceId, hostname, siteId, siteName, groupIds, groupNames,
              severityId, severityRank, state, value, message, subject,
              dedupeKey, at, meta }
     opts:  { provider, device, actor, force, silent } */
  AL.fire = async function (providerId, input, opts) {
    opts = opts || {};
    input = asObj(input);
    if (!enabled() && !opts.force) return { skipped: true, reason: "alerts_disabled" };
    const at = input.at || opts.at || now();
    const atMs = Date.parse(at);
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const device = opts.device || asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(input.deviceId)) || null;
    const dc = device ? AL.deviceContext(provider, device, opts.ctx) : null;
    const deviceId = String(input.deviceId || (device && device.id) || "");
    const key = input.dedupeKey || (input.monitorId ? AL.dedupeKey({ id: input.monitorId, type: input.monitorType, settings: input.settings }, deviceId) : deviceId + "|" + S(input.subject, 100));
    const list = asArr(provider.alerts);
    const existing = findActive(list, key);

    const severityId = input.severityId || "sev-warning";
    const severityRank = input.severityRank != null ? num(input.severityRank, 0) : (await AL.rankOf(severityId));

    if (existing) {
      const before = num(existing.severityRank, 0);
      const escalated = severityRank != null && before != null && severityRank > before;
      const patch = {
        lastSeenAt: at,
        occurrences: num(existing.occurrences, 1) + 1,
        state: existing.state === "acknowledged" ? "acknowledged" : "firing",
        value: input.value == null ? existing.value : input.value,
        message: input.message != null ? S(input.message, 600) : existing.message,
        severityId,
        severityRank,
        monitorName: input.monitorName || existing.monitorName,
        updatedAt: at,
      };
      if (escalated) {
        patch.escalatedAt = at;
        patch.history = asArr(existing.history).concat([{ at, action: "escalated", actor: "system", from: existing.severityId, to: severityId, note: "severity raised while the alert was active" }]);
      }
      const r = await T.updateItem(providerId, "alerts", existing.id, (it) => { Object.assign(it, patch); });
      if (r.error) return r;
      const alert = r.item || Object.assign({}, existing, patch);
      if (!opts.silent) {
        emit(escalated ? "alert.escalated" : "alert.updated", alert);
        if (escalated) { await postHooks(providerId, alert, escalated ? "escalated" : "firing", at); }
      }
      return { alert: clone(alert), deduped: true, escalated };
    }

    const flap = findResolvedRecent(list, key, atMs, flapMinutes() * 60000);
    if (flap) {
      const flaps = num(flap.flaps, 0) + 1;
      const flapping = flaps >= flapThreshold();
      const hist = asArr(flap.history).concat([
        { at: flap.resolvedAt || flap.lastSeenAt, action: "resolved", actor: flap.resolvedBy || "system", note: flap.autoResolved ? "auto-cleared" : "" },
        { at, action: "reopened", actor: "system", note: "re-fired within " + flapMinutes() + "m (flap " + flaps + ")" },
      ]);
      const patch = {
        state: "firing", resolvedAt: "", resolvedBy: "", autoResolved: false,
        firstFiredAt: flap.firstFiredAt || at, lastSeenAt: at, acknowledgedAt: "", acknowledgedBy: "",
        occurrences: num(flap.occurrences, 0) + 1, flaps, flapping, snoozeUntil: "", snoozedBy: "",
        severityId, severityRank, stateValue: input.state || flap.stateValue, value: input.value == null ? flap.value : input.value,
        message: input.message != null ? S(input.message, 600) : flap.message, history: hist, updatedAt: at,
      };
      const r = await T.updateItem(providerId, "alerts", flap.id, (it) => { Object.assign(it, patch); });
      if (r.error) return r;
      const alert = Object.assign({}, flap, patch);
      if (!opts.silent) { emit("alert.fired", alert); await postHooks(providerId, alert, "fired", at); }
      return { alert: clone(alert), reopened: true, flapping };
    }

    const scope = dc ? { deviceId: dc.deviceId, siteId: dc.siteId, groupIds: dc.groupIds } : await SCHscope(providerId, deviceId);
    let suppressed = false, windowIds = [], suppressReason = "";
    const SCHx = SCH();
    if (SCHx && typeof SCHx.isSuppressed === "function") {
      try {
        const s = await SCHx.isSuppressed(providerId, scope, at, severityId);
        suppressed = !!(s && s.suppressed);
        windowIds = asArr(s && s.windows).map(String);
        suppressReason = s && s.reason ? s.reason : "";
      } catch (e) {}
    }
    if (suppressed && SCHx && typeof SCHx.recordSuppression === "function") {
      try {
        await SCHx.recordSuppression({ providerId, deviceId, scope, severityId, windowIds, reason: suppressReason || "maintenance window", source: "alert", at, meta: { monitorId: input.monitorId || null } });
      } catch (e) {}
    }

    const ctx = dc || (device ? AL.deviceContext(provider, device) : { deviceId, hostname: input.hostname || deviceId, siteId: null, siteName: "", groupIds: [], groupNames: [] });
    const record = {
      kind: "alert", id: T.newItemId("alerts"),
      providerId: String(providerId),
      monitorId: input.monitorId ? String(input.monitorId) : null,
      monitorName: S(input.monitorName, 160),
      monitorType: S(input.monitorType, 60),
      policyId: input.policyId ? String(input.policyId) : null,
      policyName: S(input.policyName, 160),
      deviceId: String(ctx.deviceId || deviceId),
      hostname: S(ctx.hostname || input.hostname || deviceId, 200),
      siteId: ctx.siteId,
      siteName: S(ctx.siteName, 160),
      groupIds: asArr(ctx.groupIds).map(String),
      groupNames: asArr(ctx.groupNames).map((x) => S(x, 160)),
      osFamily: S(ctx.osFamily, 60),
      severityId, severityRank,
      severityLabel: (await AL.severity(severityId) || {}).label || severityId,
      state: "firing",
      stateValue: S(input.state, 60),
      value: input.value == null ? null : input.value,
      message: S(input.message, 600),
      subject: S(input.subject || AL.subjectOf({ type: input.monitorType, settings: input.settings }), 200),
      firstFiredAt: at, lastSeenAt: at,
      acknowledgedAt: "", acknowledgedBy: "", resolvedAt: "", resolvedBy: "", autoResolved: false,
      occurrences: 1, flaps: 0, flapping: false,
      dedupeKey: key,
      snoozeUntil: "", snoozedBy: "",
      suppressed, suppressionWindowIds: windowIds, suppressionReason: S(suppressReason, 200),
      escalatedAt: "", escalationLevel: 0,
      assignedTo: "", assignedToName: "", assignedAt: "", assignedBy: "",
      ticketId: null, ticketStatus: "", ticketRef: "",
      history: [{ at, action: "fired", actor: "system", to: "firing", note: S(input.message, 300) }],
      notifications: [], escalations: [],
      meta: asObj(input.meta),
      createdAt: at, updatedAt: at,
    };
    const r = await T.addItem(providerId, "alerts", record);
    if (r.error) return r;
    const alert = r.item || record;
    if (!opts.silent) {
      emit("alert.fired", alert);
      await postHooks(providerId, alert, "fired", at);
    }
    return { alert: clone(alert), created: true, suppressed };
  };

  async function SCHscope(providerId, deviceId) {
    const SCHx = SCH();
    if (SCHx && typeof SCHx.scopeFor === "function") { try { return await SCHx.scopeFor(providerId, deviceId); } catch (e) {} }
    return { deviceId: String(deviceId), siteId: null, groupIds: [] };
  }

  /* Best-effort fan-out after an alert transition: routing, the PSA
     bridge and the automation engine all see the same event. */
  async function postHooks(providerId, alert, event, at) {
    const R = RT();
    if (R && typeof R.routeAlert === "function" && (event === "fired" || event === "escalated")) {
      try { await R.routeAlert(providerId, alert, { event, at }); } catch (e) {}
    }
    const P = PSA();
    if (P && typeof P.onAlert === "function") {
      try { await P.onAlert(providerId, alert, event, at); } catch (e) {}
    }
    const A = AUTO();
    if (A && typeof A.ingest === "function") {
      const type = event === "cleared" ? "alert.cleared" : "alert.fired";
      try { await A.ingest(providerId, { type, deviceId: alert.deviceId, monitorId: alert.monitorId, severityId: alert.severityId, alertId: alert.id, at }); } catch (e) {}
    }
  }
  AL.postHooks = postHooks;

  async function mutateAlert(providerId, alertId, mutate) {
    let found = null;
    const r = await T.updateItem(providerId, "alerts", alertId, (it) => { mutate(it); found = it; });
    if (r.error) return r;
    if (!found) return { error: "not_found", alertId };
    return { ok: true, alert: clone(found) };
  }
  AL.mutateAlert = mutateAlert;

  AL.acknowledge = async function (providerId, alertId, actor) {
    const at = now();
    const who = actor || actorName();
    const out = await mutateAlert(providerId, alertId, (it) => {
      if (it.state === "resolved") return;
      if (it.state === "acknowledged") return;
      it.state = "acknowledged";
      it.acknowledgedAt = at;
      it.acknowledgedBy = who;
      it.updatedAt = at;
      it.history = asArr(it.history).concat([{ at, action: "acknowledged", actor: who, from: "firing", to: "acknowledged" }]);
    });
    if (out.error) return out;
    if (out.alert.state === "acknowledged") {
      emit("alert.acknowledged", out.alert);
      await audit("alert_acknowledge", alertId, "Acknowledged alert \"" + out.alert.subject + "\" on " + out.alert.hostname + ".");
    }
    return out;
  };

  AL.resolve = async function (providerId, alertId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const who = opts.actor || (opts.auto ? "system" : actorName());
    const out = await mutateAlert(providerId, alertId, (it) => {
      if (it.state === "resolved") return;
      it.state = "resolved";
      it.resolvedAt = at;
      it.resolvedBy = who;
      it.autoResolved = !!opts.auto;
      it.updatedAt = at;
      it.history = asArr(it.history).concat([{ at, action: opts.auto ? "auto-cleared" : "resolved", actor: who, from: it.state, to: "resolved", note: S(opts.note, 300) }]);
    });
    if (out.error) return out;
    emit("alert.resolved", out.alert);
    await audit("alert_resolve", alertId, "Resolved alert \"" + out.alert.subject + "\" on " + out.alert.hostname + " (" + (opts.auto ? "auto-cleared" : "by " + who) + ").");
    await postHooks(providerId, out.alert, "cleared", at);
    return out;
  };

  AL.autoClear = function (providerId, alertId, opts) { return AL.resolve(providerId, alertId, Object.assign({ auto: true, note: "monitor recovered" }, opts || {})); };
  AL.clear = AL.autoClear;

  AL.snooze = async function (providerId, alertId, untilOrMinutes, actor) {
    let until;
    if (typeof untilOrMinutes === "number") until = new Date(Date.now() + untilOrMinutes * 60000).toISOString();
    else until = untilOrMinutes || new Date(Date.now() + 60 * 60000).toISOString();
    if (Date.parse(until) < Date.now()) until = new Date(Date.now() + 60000).toISOString();
    const who = actor || actorName();
    const out = await mutateAlert(providerId, alertId, (it) => {
      it.snoozeUntil = until;
      it.snoozedBy = who;
      it.updatedAt = now();
      it.history = asArr(it.history).concat([{ at: now(), action: "snoozed", actor: who, note: "until " + until }]);
    });
    if (!out.error) emit("alert.snoozed", out.alert);
    return out;
  };

  AL.unsnooze = async function (providerId, alertId, actor) {
    const who = actor || actorName();
    const out = await mutateAlert(providerId, alertId, (it) => {
      it.snoozeUntil = "";
      it.snoozedBy = "";
      it.updatedAt = now();
      it.history = asArr(it.history).concat([{ at: now(), action: "unsnoozed", actor: who }]);
    });
    if (!out.error) emit("alert.unsnoozed", out.alert);
    return out;
  };

  AL.isSnoozed = function (alert, at) {
    if (!alert || !alert.snoozeUntil) return false;
    const ms = at ? Date.parse(at) : Date.now();
    return Date.parse(alert.snoozeUntil) > ms;
  };

  /* Assignment — who owns this alert. An assignee is either a string or
     an object {id, name}; the id defaults to the name so a free-text
     owner still re-selects cleanly. */
  AL.normalizeAssignee = function (v) {
    if (v == null || v === "") return null;
    if (typeof v === "object") {
      const name = S(v.name || v.displayName || v.id, 120);
      if (!name) return null;
      return { id: S(v.id || v.userId || name, 120), name };
    }
    const s = S(v, 120);
    return s ? { id: s, name: s } : null;
  };

  AL.assign = async function (providerId, alertId, assignee, actor) {
    const who = actor || actorName();
    const a = AL.normalizeAssignee(assignee);
    if (!a) return { error: "no_assignee" };
    const at = now();
    const out = await mutateAlert(providerId, alertId, (it) => {
      const prev = it.assignedToName || "";
      it.assignedTo = a.id;
      it.assignedToName = a.name;
      it.assignedAt = at;
      it.assignedBy = who;
      it.updatedAt = at;
      it.history = asArr(it.history).concat([{ at, action: prev ? "reassigned" : "assigned", actor: who, from: prev || null, to: a.name }]);
    });
    if (out.error) return out;
    emit("alert.assigned", out.alert);
    await audit("alert_assign", alertId, "Assigned alert \"" + out.alert.subject + "\" on " + out.alert.hostname + " to " + a.name + ".");
    return out;
  };

  AL.unassign = async function (providerId, alertId, actor) {
    const who = actor || actorName();
    const at = now();
    const out = await mutateAlert(providerId, alertId, (it) => {
      const prev = it.assignedToName || "";
      it.assignedTo = "";
      it.assignedToName = "";
      it.assignedAt = "";
      it.assignedBy = "";
      it.updatedAt = at;
      it.history = asArr(it.history).concat([{ at, action: "unassigned", actor: who, from: prev || null, to: null }]);
    });
    if (out.error) return out;
    emit("alert.unassigned", out.alert);
    return out;
  };

  /* ═══════════════════════ assessment → lifecycle ═══════════════════════ */

  AL.scan = async function (providerId, opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { skipped: true, reason: "alerts_disabled" };
    if (!M) return { error: "no_master_config" };
    const g = await T.get(providerId);
    if (g.error) return g;
    const at = opts.at || now();
    const atMs = Date.parse(at);
    const provider = g.provider;
    const monitors = MON();
    if (!monitors || typeof monitors.forDevice !== "function") return { error: "no_monitors" };
    const ctx = { provider };
    let devices = asArr(provider.devices).map(D.normalizeDevice);
    if (asArr(opts.deviceIds).length) {
      const want = opts.deviceIds.map(String);
      devices = devices.filter((d) => want.indexOf(String(d.id)) !== -1);
    }
    const monById = {};
    try { asArr(monitors.listOf(provider)).forEach((m) => { monById[m.id] = m; }); } catch (e) {}
    const prevRows = (await loadState()).filter((r) => r.kind === "assessment" && String(r.providerId) === String(providerId));
    const prevByDevice = {};
    prevRows.forEach((r) => { (prevByDevice[String(r.deviceId)] = prevByDevice[String(r.deviceId)] || {})[String(r.monitorId)] = { state: r.state, since: r.since, fired: !!r.fired, value: r.value, message: r.message }; });

    const summary = { devices: devices.length, evaluated: 0, fired: 0, cleared: 0, deduped: 0, reopened: 0, suppressed: 0, errors: 0 };
    const probes = asObj(opts.probes);
    for (const dev of devices) {
      const prev = prevByDevice[String(dev.id)] || {};
      let res;
      try { res = await monitors.forDevice(providerId, dev.id, { prev, now: atMs, probes: asObj(probes[dev.id]) }); } catch (e) { summary.errors++; continue; }
      if (!res || res.error) { summary.errors++; continue; }
      for (const row of asArr(res.monitors)) {
        summary.evaluated++;
        const mon = monById[row.monitorId] || { id: row.monitorId, name: row.name, type: row.type, severity: row.severity, settings: {}, thresholds: {}, forMinutes: 0 };
        const r = await AL.ingestAssessment(providerId, mon, dev, row.assessment, { at, provider, ctx, prevState: prev[String(row.monitorId)] });
        if (r && r.fire && r.fire.created) summary.fired++;
        else if (r && r.fire && r.fire.reopened) { summary.reopened++; summary.fired++; }
        else if (r && r.fire && r.fire.deduped) summary.deduped++;
        else if (r && r.cleared) summary.cleared++;
        if (r && r.fire && r.fire.suppressed) summary.suppressed++;
        await upsertState(providerId, dev.id, row.monitorId, row.assessment, at);
      }
    }
    if (opts.prune) { try { await AL.prune(providerId); } catch (e) {} }
    return Object.assign({ ok: true, at }, summary);
  };

  /* Drive the lifecycle for one monitor assessment. Also emits a
     `monitor.state` event whenever the state changes, so automation
     rules with a monitor trigger see it even before an alert fires. */
  AL.ingestAssessment = async function (providerId, monitor, device, assessment, opts) {
    opts = opts || {};
    const at = opts.at || assessment.at || now();
    const provider = opts.provider || null;
    const a = asObj(assessment);
    const prev = asObj(opts.prevState);
    const key = AL.dedupeKey(monitor, device && device.id);
    const changed = prev.state !== a.state;
    if (changed) {
      const A = AUTO();
      if (A && typeof A.ingest === "function") {
        try { await A.ingest(providerId, { type: "monitor.state", deviceId: String(device && device.id), monitorId: String(monitor && monitor.id), state: a.state, from: prev.state || null, severityId: monitor && monitor.severity, at }); } catch (e) {}
      }
    }
    if (a.fired) {
      const list = await severities();
      const severityId = AL.severityForState(monitor && monitor.severity, a.state, list);
      const info = list.find((s) => String(s.id) === String(severityId));
      const policy = asObj(asObj(monitor).policy || {});
      const fire = await AL.fire(providerId, {
        monitorId: monitor && monitor.id, monitorName: monitor && monitor.name, monitorType: monitor && monitor.type,
        policyId: policy.id || asObj(monitor).policyId || null, policyName: policy.name || "",
        settings: asObj(monitor).settings,
        deviceId: String(device && device.id),
        severityId, severityRank: info ? num(info.rank, 0) : null,
        state: a.state, value: a.value, message: a.message, at, dedupeKey: key,
      }, { provider: provider || undefined, device: device || undefined, ctx: opts.ctx });
      return { key, fire };
    }
    /* not firing: auto-clear any active alert for this key */
    const g2 = await T.get(providerId);
    if (!g2.error) {
      const existing = findActive(g2.provider.alerts, key);
      if (existing) return { key, cleared: await AL.autoClear(providerId, existing.id, { at, reason: a.state === "ok" ? "recovered" : "monitor state " + a.state }) };
    }
    return { key, cleared: false };
  };

  /* ═══════════════════════ reads ═══════════════════════ */

  AL.list = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return [];
    let rows = asArr(g.provider.alerts).map((a) => Object.assign({ kind: "alert" }, a));
    if (opts.state) rows = rows.filter((a) => (opts.state === "active" ? AL.ACTIVE.indexOf(a.state) !== -1 : a.state === opts.state));
    if (opts.active) rows = rows.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
    if (opts.severityId) rows = rows.filter((a) => String(a.severityId) === String(opts.severityId));
    if (opts.deviceId) rows = rows.filter((a) => String(a.deviceId) === String(opts.deviceId));
    if (opts.siteId) rows = rows.filter((a) => String(a.siteId || "") === String(opts.siteId));
    if (opts.groupId) rows = rows.filter((a) => asArr(a.groupIds).map(String).indexOf(String(opts.groupId)) !== -1);
    if (opts.monitorId) rows = rows.filter((a) => String(a.monitorId) === String(opts.monitorId));
    if (opts.q) {
      const q = low(opts.q);
      rows = rows.filter((a) => [a.hostname, a.subject, a.monitorName, a.siteName, a.message, a.severityLabel].some((x) => low(x).indexOf(q) !== -1));
    }
    if (opts.at) rows = rows.filter((a) => AL.isSnoozed(a, opts.at) === !!opts.snoozed);
    rows.sort((a, b) => (num(b.severityRank, 0) - num(a.severityRank, 0)) || (Date.parse(b.lastSeenAt || b.firstFiredAt) - Date.parse(a.lastSeenAt || a.firstFiredAt)));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  };

  AL.get = async function (providerId, alertId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const a = asArr(g.provider.alerts).find((x) => String(x.id) === String(alertId));
    return a ? { alert: clone(a), provider: g.provider } : { error: "not_found", alertId };
  };

  AL.active = (providerId, opts) => AL.list(providerId, Object.assign({ active: true }, opts || {}));
  AL.forDevice = (providerId, deviceId, opts) => AL.list(providerId, Object.assign({ deviceId }, opts || {}));
  AL.forMonitor = (providerId, monitorId, opts) => AL.list(providerId, Object.assign({ monitorId }, opts || {}));

  AL.counts = function (provider) {
    const rows = asArr(asObj(provider).alerts);
    const active = rows.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
    const bySeverity = {}, byState = {};
    rows.forEach((a) => {
      bySeverity[a.severityId] = (bySeverity[a.severityId] || 0) + 1;
      byState[a.state] = (byState[a.state] || 0) + 1;
    });
    return {
      total: rows.length,
      active: active.length,
      firing: active.filter((a) => a.state === "firing").length,
      acknowledged: active.filter((a) => a.state === "acknowledged").length,
      resolved: rows.filter((a) => a.state === "resolved").length,
      critical: active.filter((a) => num(a.severityRank, 0) >= 30).length,
      snoozed: active.filter((a) => !!a.snoozeUntil).length,
      suppressed: active.filter((a) => a.suppressed).length,
      flapping: active.filter((a) => a.flapping).length,
      bySeverity, byState,
    };
  };

  AL.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return Object.assign(AL.counts(g.provider), { docName: store.docName(AL.MODULE) });
  };
  AL.statsOf = (provider) => AL.counts(provider);

  AL.history = async function (providerId, alertId) {
    const r = await AL.get(providerId, alertId);
    if (r.error) return r;
    const hist = asArr(r.alert.history).slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { alertId, history: clone(hist) };
  };

  /* ═══════════════════════ retention ═══════════════════════ */

  AL.prune = async function (providerId) {
    const days = Math.max(1, num(cfg("rmm.alertRetentionDays", 30), 30));
    const cap = historyCap();
    const cutoff = Date.now() - days * 86400000;
    let removed = 0;
    const r = await T.update(providerId, (p) => {
      const before = asArr(p.alerts);
      const active = before.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
      const resolved = before.filter((a) => AL.ACTIVE.indexOf(a.state) === -1).sort((a, b) => Date.parse(b.resolvedAt || b.lastSeenAt || b.firstFiredAt) - Date.parse(a.resolvedAt || a.lastSeenAt || a.firstFiredAt));
      const aged = resolved.filter((a) => Date.parse(a.resolvedAt || a.lastSeenAt || a.firstFiredAt) >= cutoff);
      const room = Math.max(0, cap - active.length);
      const keptResolved = aged.slice(0, room);
      const kept = active.concat(keptResolved);
      removed = before.length - kept.length;
      p.alerts = kept;
      return { alerts: kept };
    });
    if (r.error) return r;
    return { ok: true, removed };
  };

  /* ═══════════════════════ demo seed ═══════════════════════ */

  AL.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && !enabled()) return { skipped: true, reason: "disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    const existing = asArr(g.provider.alerts);
    if (existing.length && !opts.force) {
      const enriched = existing.some((a) => String(a.monitorId || "").indexOf("mon-hist-") === 0);
      if (enriched || existing.some((a) => !asObj(a.meta).demo)) return { skipped: true, reason: "alerts_exist" };
    }
    const devices = asArr(g.provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
    if (!devices.length) return { skipped: true, reason: "no_devices" };
    const list = await severities();
    const base = [
      { state: "critical", subject: "Disk free space", monitorName: "System disk free", monitorType: "disk", message: "At 6%.", value: 6, agoMin: 190 },
      { state: "warning", subject: "Memory utilisation", monitorName: "Memory utilisation", monitorType: "memory", message: "At 91%.", value: 91, agoMin: 45 },
      { state: "ok", subject: "Agent offline", monitorName: "Agent offline", monitorType: "agent", message: "Agent stale for 7 min.", value: 7, agoMin: 12 },
    ];
    const records = [];
    for (let i = 0; i < Math.min(3, devices.length); i++) {
      const d = devices[i];
      const b = base[i];
      if (b.state === "ok") continue;
      const severityId = AL.severityForState("sev-warning", b.state, list);
      const info = list.find((s) => String(s.id) === String(severityId));
      const dc = AL.deviceContext(g.provider, d);
      const at = new Date(Date.now() - (b.agoMin || 0) * 60000).toISOString();
      const rec = {
        kind: "alert", id: T.newItemId("alerts"), providerId: demo.id,
        monitorId: "mon-demo-" + (i + 1), monitorName: b.monitorName, monitorType: b.monitorType,
        policyId: null, policyName: "",
        deviceId: dc.deviceId, hostname: dc.hostname, siteId: dc.siteId, siteName: dc.siteName,
        groupIds: dc.groupIds, groupNames: dc.groupNames, osFamily: dc.osFamily,
        severityId, severityRank: info ? num(info.rank, 0) : 20, severityLabel: info ? info.label : severityId,
        state: "firing", stateValue: b.state, value: b.value, message: b.message, subject: b.subject,
        firstFiredAt: at, lastSeenAt: at, acknowledgedAt: "", acknowledgedBy: "", resolvedAt: "", resolvedBy: "", autoResolved: false,
        occurrences: i + 1, flaps: 0, flapping: false, dedupeKey: "mon-demo-" + (i + 1) + "|" + dc.deviceId,
        assignedTo: "", assignedToName: "", assignedAt: "", assignedBy: "",
        snoozeUntil: "", snoozedBy: "", suppressed: false, suppressionWindowIds: [], suppressionReason: "",
        escalatedAt: "", escalationLevel: 0, ticketId: null, ticketStatus: "", ticketRef: "",
        history: [{ at, action: "fired", actor: "system", to: "firing", note: b.message }],
        notifications: [], escalations: [], meta: { demo: true }, createdAt: at, updatedAt: at,
      };
      records.push(rec);
    }

    /* Already-handled alerts spread across the past fortnight so the
       triage metrics have a real distribution to summarise — volume
       over time, MTTA/MTTR, SLA share and the worst devices/monitors. */
    const techs = [{ id: "tech-a", name: "A. Nguyen" }, { id: "tech-j", name: "J. Patel" }, { id: "tech-m", name: "M. Okoro" }];
    const history = [
      { agoH: 5, dev: 0, state: "warning", sevRank: 20, subject: "CPU utilisation", monitorName: "CPU utilisation", monitorType: "cpu", ackH: 0.25, resH: 1.5, occurrences: 4, flapping: true },
      { agoH: 26, dev: 1, state: "critical", sevRank: 30, subject: "Service stopped", monitorName: "Service state", monitorType: "service", ackH: 0.5, resH: 3, occurrences: 2, assigned: 0 },
      { agoH: 49, dev: 2, state: "warning", sevRank: 20, subject: "Backup missed", monitorName: "Backup job", monitorType: "backup", ackH: 2, resH: 5, occurrences: 1 },
      { agoH: 73, dev: 0, state: "critical", sevRank: 30, subject: "Disk free space", monitorName: "System disk free", monitorType: "disk", ackH: 0.2, resH: 0.9, occurrences: 1 },
      { agoH: 96, dev: 3, state: "warning", sevRank: 20, subject: "Memory utilisation", monitorName: "Memory utilisation", monitorType: "memory", ackH: 0.75, resH: 2.5, occurrences: 3, assigned: 1, open: true },
      { agoH: 120, dev: 1, state: "info", sevRank: 10, subject: "Update pending", monitorName: "Patch status", monitorType: "patch", ackH: 4, resH: 8, occurrences: 1 },
      { agoH: 168, dev: 4, state: "critical", sevRank: 30, subject: "AV definitions old", monitorName: "AV status", monitorType: "av", ackH: 0.15, resH: 1.2, occurrences: 5 },
      { agoH: 192, dev: 2, state: "warning", sevRank: 20, subject: "Port check failed", monitorName: "Port check", monitorType: "port", ackH: 1, resH: 4, occurrences: 2, assigned: 2, open: true, snoozeH: 6 },
      { agoH: 240, dev: 5, state: "info", sevRank: 10, subject: "Uptime reset", monitorName: "Uptime", monitorType: "uptime", ackH: 6, resH: 12, occurrences: 1 },
    ];
    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      const d = devices[h.dev % devices.length];
      const dc = AL.deviceContext(g.provider, d);
      const firedMs = Date.now() - h.agoH * 3600000;
      const ackMs = firedMs + Math.round(h.ackH * 3600000);
      const resMs = firedMs + Math.round(h.resH * 3600000);
      const assigned = h.assigned != null ? techs[h.assigned % techs.length] : null;
      const sev = list.find((s) => num(s.rank, 0) === h.sevRank) || list[0];
      const state = h.open ? "acknowledged" : "resolved";
      const hist = [{ at: new Date(firedMs).toISOString(), action: "fired", actor: "system", to: "firing", note: h.subject }];
      hist.push({ at: new Date(ackMs).toISOString(), action: "acknowledged", actor: assigned ? assigned.name : "system", from: "firing", to: "acknowledged" });
      if (assigned) hist.push({ at: new Date(ackMs).toISOString(), action: "assigned", actor: "system", to: assigned.name });
      if (!h.open) hist.push({ at: new Date(resMs).toISOString(), action: "resolved", actor: assigned ? assigned.name : "system", from: "acknowledged", to: "resolved", note: "recovered" });
      const rec = {
        kind: "alert", id: T.newItemId("alerts"), providerId: demo.id,
        monitorId: "mon-hist-" + (i + 1), monitorName: h.monitorName, monitorType: h.monitorType,
        policyId: null, policyName: "",
        deviceId: dc.deviceId, hostname: dc.hostname, siteId: dc.siteId, siteName: dc.siteName,
        groupIds: dc.groupIds, groupNames: dc.groupNames, osFamily: dc.osFamily,
        severityId: sev ? sev.id : "sev-warning", severityRank: h.sevRank, severityLabel: sev ? sev.label : "Warning",
        state, stateValue: h.state, value: null, message: h.subject + " resolved.", subject: h.subject,
        firstFiredAt: new Date(firedMs).toISOString(), lastSeenAt: new Date(firedMs + 60000).toISOString(),
        acknowledgedAt: new Date(ackMs).toISOString(), acknowledgedBy: assigned ? assigned.name : "system",
        resolvedAt: h.open ? "" : new Date(resMs).toISOString(), resolvedBy: h.open ? "" : (assigned ? assigned.name : "system"), autoResolved: !h.open,
        occurrences: h.occurrences || 1, flaps: h.flapping ? 3 : 0, flapping: !!h.flapping, dedupeKey: "mon-hist-" + (i + 1) + "|" + dc.deviceId,
        assignedTo: assigned ? assigned.id : "", assignedToName: assigned ? assigned.name : "", assignedAt: assigned ? new Date(ackMs).toISOString() : "", assignedBy: assigned ? "system" : "",
        snoozeUntil: h.snoozeH ? new Date(Date.now() + h.snoozeH * 3600000).toISOString() : "", snoozedBy: h.snoozeH ? "demo" : "",
        suppressed: false, suppressionWindowIds: [], suppressionReason: "",
        escalatedAt: "", escalationLevel: 0, ticketId: null, ticketStatus: "", ticketRef: "",
        history: hist, notifications: [], escalations: [], meta: { demo: true },
        createdAt: new Date(firedMs).toISOString(), updatedAt: new Date(resMs).toISOString(),
      };
      records.push(rec);
    }

    /* One atomic write (a few retries for a concurrent boot-time seed)
       so a burst of per-record writes can't half-apply under the store's
       compare-and-set guard. Replaces only demo-seeded alerts; any
       user-created alerts are preserved. */
    let applied = false, alreadyThere = false;
    for (let attempt = 0; attempt < 6 && !applied; attempt++) {
      let changed = false;
      const res = await T.update(demo.id, (p) => {
        const has = asArr(p.alerts).some((a) => asObj(a.meta).demo && String(a.monitorId || "").indexOf("mon-hist-") === 0);
        if (has && !opts.force) return;
        p.alerts = asArr(p.alerts).filter((a) => !asObj(a.meta).demo).concat(records);
        changed = true;
      });
      if (!res.error) { applied = true; alreadyThere = !changed; }
      else await new Promise((r) => setTimeout(r, 50));
    }
    if (!applied) return { error: "seed_write_failed", providerId: demo.id };
    return { providerId: demo.id, created: alreadyThere ? [] : records.map((r) => r.id), skipped: alreadyThere };
  };

  let readyResolve;
  AL.ready = new Promise((res) => { readyResolve = res; });
  AL.init = async function () { try { await T.ready; await AL.seedDemo(); } catch (e) { console.error("alert seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", AL.init);
  else AL.init();

  /* ═══════════════════════ station UI ═══════════════════════ */

  AL.currentProviderId = null;

  const STATE_TONE = { firing: "danger", acknowledged: "warn", resolved: "success" };
  const STATE_LABEL = { firing: "Firing", acknowledged: "Acknowledged", resolved: "Resolved" };

  AL.stateBadge = function (state) { return ERP.ui.badge(STATE_LABEL[state] || state, STATE_TONE[state] || "muted"); };
  AL.severityBadge = function (a) {
    const tone = num(a.severityRank, 0) >= 30 ? "danger" : num(a.severityRank, 0) >= 20 ? "warn" : "info";
    return ERP.ui.badge(a.severityLabel || a.severityId || "—", tone);
  };

  function ageText(iso, at) {
    if (!iso) return "—";
    const ms = (at ? Date.parse(at) : Date.now()) - Date.parse(iso);
    if (!isFinite(ms)) return "—";
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + "m";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h";
    return Math.round(h / 24) + "d";
  }
  AL.ageText = ageText;

  function scopedShowTab(el, id) {
    el.querySelectorAll(":scope > .erp-tabs > [data-tab]").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === id));
    el.querySelectorAll(":scope > .erp-tabs-content > [data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === id));
  }

  function alertRow(provider, a, at) {
    const ui = ERP.ui, esc = ui.esc;
    const active = AL.ACTIVE.indexOf(a.state) !== -1;
    const flags = [];
    if (a.flapping) flags.push(ui.badge("flapping", "danger"));
    if (a.suppressed) flags.push(ui.badge("maintenance", "warn"));
    if (a.snoozeUntil && AL.isSnoozed(a, at)) flags.push(ui.badge("snoozed", "muted"));
    if (a.assignedToName) flags.push(ui.badge("@" + a.assignedToName, "info"));
    if (a.ticketId) flags.push(ui.badge("ticket " + (a.ticketRef || a.ticketStatus || ""), "info"));
    const actions = [];
    if (a.state === "firing") actions.push(ui.btn("Ack", { small: true, act: "al-ack", arg: a.id }));
    if (active) actions.push(ui.btn("Resolve", { small: true, act: "al-resolve", arg: a.id }));
    if (active && !(a.snoozeUntil && AL.isSnoozed(a, at))) actions.push(ui.btn("Snooze", { small: true, act: "al-snooze", arg: a.id }));
    actions.push(ui.btn("Detail", { small: true, act: "al-detail", arg: a.id }));
    return {
      sev: AL.severityBadge(a) + " " + AL.stateBadge(a.state),
      device: '<b>' + esc(a.hostname || a.deviceId) + "</b>" + (a.siteName ? '<div class="erp-sub">' + esc(a.siteName) + "</div>" : ""),
      what: esc(a.subject || a.monitorName || "—") + (a.message ? '<div class="erp-sub">' + esc(a.message) + "</div>" : ""),
      ctx: '<span class="erp-sub">' + esc(a.monitorName || "") + (asArr(a.groupNames).length ? " · " + esc(asArr(a.groupNames).join(", ")) : "") + "</span>",
      age: esc(ageText(a.firstFiredAt, at)) + '<div class="erp-sub">' + esc(a.occurrences > 1 ? a.occurrences + "×" : "") + "</div>",
      flags: flags.join(" ") || '<span class="erp-sub">—</span>',
      actions: actions.join(" "),
    };
  }

  function alertsPanel(provider, state) {
    const ui = ERP.ui, esc = ui.esc;
    const counts = AL.counts(provider);
    const at = now();
    let rows = asArr(provider.alerts);
    if (state.filterState === "active") rows = rows.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
    else if (state.filterState !== "all") rows = rows.filter((a) => a.state === state.filterState);
    if (state.filterSeverity) rows = rows.filter((a) => String(a.severityId) === String(state.filterSeverity));
    if (state.filterDevice) rows = rows.filter((a) => String(a.deviceId) === String(state.filterDevice));
    if (state.q) { const q = low(state.q); rows = rows.filter((a) => [a.hostname, a.subject, a.monitorName, a.message].some((x) => low(x).indexOf(q) !== -1)); }
    rows = rows.slice().sort((a, b) => (num(b.severityRank, 0) - num(a.severityRank, 0)) || (Date.parse(b.lastSeenAt || b.firstFiredAt) - Date.parse(a.lastSeenAt || a.firstFiredAt)));
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const sevList = Object.keys(counts.bySeverity);
    const filterBar = '<div class="erp-inline-form">' +
      '<div class="field"><label>State</label><select name="al_state">' +
      [["active", "Active (" + counts.active + ")"], ["all", "All (" + counts.total + ")"], ["firing", "Firing"], ["acknowledged", "Acknowledged"], ["resolved", "Resolved"]].map(([v, l]) => '<option value="' + v + '"' + (state.filterState === v ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label>Severity</label><select name="al_severity"><option value="">All severities</option>' + sevList.map((s) => '<option value="' + esc(s) + '"' + (state.filterSeverity === s ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label>Device</label><select name="al_device"><option value="">All devices</option>' + devices.map((d) => '<option value="' + esc(d.id) + '"' + (state.filterDevice === d.id ? " selected" : "") + ">" + esc(d.hostname || d.id) + "</option>").join("") + "</select></div>" +
      '<div class="field" style="flex:1 1 200px"><label>Search</label><input type="text" name="al_q" value="' + esc(state.q || "") + '" placeholder="hostname, subject, monitor…"></div>' +
      "</div>";
    return ui.summary([
      { label: "Active", value: String(counts.active) },
      { label: "Firing", value: String(counts.firing) },
      { label: "Acknowledged", value: String(counts.acknowledged) },
      { label: "Critical", value: String(counts.critical) },
      { label: "Snoozed", value: String(counts.snoozed) },
      { label: "Suppressed", value: String(counts.suppressed) },
      { label: "Flapping", value: String(counts.flapping) },
    ]) + filterBar +
      ui.table([
        { key: "sev", label: "Severity / state", render: (r) => r.sev },
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "what", label: "Alert", render: (r) => r.what },
        { key: "ctx", label: "Context", render: (r) => r.ctx },
        { key: "age", label: "Age", render: (r) => r.age },
        { key: "flags", label: "Flags", render: (r) => r.flags },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows.map((a) => alertRow(provider, a, at)), { scroll: true, emptyText: "No alerts match this view." });
  }

  function deviceNameOf(provider, id) {
    const d = asArr(provider.devices).map(D.normalizeDevice).find((x) => String(x.id) === String(id));
    return d ? (d.hostname || d.displayName || id) : id;
  }

  async function openDetail(provider, alertId, paint) {
    const ui = ERP.ui, esc = ui.esc;
    const a = asArr(provider.alerts).find((x) => String(x.id) === String(alertId));
    if (!a) return;
    const hist = asArr(a.history).slice().sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
    const histRows = hist.map((h) => ({
      at: esc(ui.dateTime(h.at)),
      action: ui.badge(h.action, h.action === "fired" ? "danger" : h.action === "resolved" || h.action === "auto-cleared" ? "success" : h.action === "acknowledged" ? "warn" : "muted"),
      actor: esc(h.actor || ""),
      change: esc((h.from ? h.from + " → " : "") + (h.to || "")),
      note: '<span class="erp-sub">' + esc(h.note || "") + "</span>",
    }));
    const ctxRows = [
      ["Hostname", esc(a.hostname || a.deviceId)],
      ["Site", esc(a.siteName || "—")],
      ["Groups", esc(asArr(a.groupNames).length ? asArr(a.groupNames).join(", ") : "—")],
      ["OS family", esc(a.osFamily || "—")],
      ["Subject", esc(a.subject || "—")],
      ["Value", esc(a.value == null ? "—" : String(a.value))],
      ["Occurrences", esc(String(num(a.occurrences, 1)))],
      ["Flaps", esc(String(num(a.flaps, 0))) + (a.flapping ? " " + ui.badge("flapping", "danger") : "")],
      ["Primary fired", esc(ui.dateTime(a.firstFiredAt))],
      ["Last seen", esc(ui.dateTime(a.lastSeenAt))],
      ["Acknowledged", a.acknowledgedAt ? esc(ui.dateTime(a.acknowledgedAt)) + " by " + esc(a.acknowledgedBy) : "—"],
      ["Resolved", a.resolvedAt ? esc(ui.dateTime(a.resolvedAt)) + " " + (a.autoResolved ? "(auto)" : "by " + esc(a.resolvedBy)) : "—"],
      ["Severity", AL.severityBadge(a)],
      ["Assignee", a.assignedToName ? esc(a.assignedToName) + ' <span class="erp-sub">' + esc(a.assignedAt ? ui.dateTime(a.assignedAt) + " by " + (a.assignedBy || "") : "") + "</span>" : "—"],
      ["Monitor", esc((a.monitorName || "—") + (a.monitorId ? " (" + a.monitorId + ")" : ""))],
      ["Policy", esc(a.policyName || a.policyId || "—")],
      ["Snoozed until", a.snoozeUntil && AL.isSnoozed(a, now()) ? esc(ui.dateTime(a.snoozeUntil)) + " by " + esc(a.snoozedBy) : "—"],
      ["Suppressed", a.suppressed ? ui.badge("yes", "warn") + ' <span class="erp-sub">' + esc(a.suppressionReason || "") + "</span>" : "no"],
      ["Ticket", a.ticketId ? esc((a.ticketRef || a.ticketId) + " · " + (a.ticketStatus || "")) : "—"],
    ];
    const noteRows = asArr(a.notifications).slice().reverse().map((n) => ({
      at: esc(ui.dateTime(n.at)), channel: esc(n.channelId || n.channelType || ""), recipient: esc(n.recipientName || n.recipientId || "—"),
      status: ui.badge(n.status || "", n.status === "sent" ? "success" : n.status === "suppressed" ? "muted" : n.status === "failed" ? "danger" : "info"),
    }));
    const escRows = asArr(a.escalations).slice().reverse().map((e) => ({
      at: esc(ui.dateTime(e.at)), level: String(num(e.level, 0)), who: esc(e.recipientName || e.recipientId || e.channelId || "—"), note: '<span class="erp-sub">' + esc(e.note || "") + "</span>",
    }));
    const body =
      '<div class="rmm-status-line">' + AL.severityBadge(a) + " " + AL.stateBadge(a.state) + (a.suppressed ? " " + ui.badge("maintenance-suppressed", "warn") : "") + (a.flapping ? " " + ui.badge("flapping", "danger") : "") + "</div>" +
      '<p class="erp-sub">' + esc(a.message || "") + "</p>" +
      '<div class="erp-btn-row">' +
      (a.state === "firing" ? ui.btn("Acknowledge", { small: true, primary: true, act: "al-detail-ack", arg: a.id }) + " " : "") +
      (AL.ACTIVE.indexOf(a.state) !== -1 ? ui.btn("Resolve", { small: true, act: "al-detail-resolve", arg: a.id }) + " " + ui.btn("Snooze 1h", { small: true, act: "al-detail-snooze", arg: a.id }) + " " : "") +
      ui.btn("Scan now", { small: true, act: "al-scan" }) +
      "</div>" +
      '<h4 class="rmm-section-title">Context</h4><div class="rmm-kv">' +
      ctxRows.map(([k, v]) => '<div class="rmm-kv-row"><span>' + esc(k) + "</span><b>" + v + "</b></div>").join("") + "</div>" +
      '<h4 class="rmm-section-title">Timeline</h4>' + ui.table([
        { key: "at", label: "When", render: (r) => r.at },
        { key: "action", label: "Action", render: (r) => r.action },
        { key: "actor", label: "Actor", render: (r) => r.actor },
        { key: "change", label: "Change", render: (r) => r.change },
        { key: "note", label: "Note", render: (r) => r.note },
      ], histRows, { scroll: true, emptyText: "No history." }) +
      (escRows.length ? '<h4 class="rmm-section-title">Escalations</h4>' + ui.table([
        { key: "at", label: "When", render: (r) => r.at }, { key: "level", label: "Level", render: (r) => r.level },
        { key: "who", label: "Notified", render: (r) => r.who }, { key: "note", label: "Note", render: (r) => r.note },
      ], escRows, { scroll: true }) : "") +
      (noteRows.length ? '<h4 class="rmm-section-title">Notifications</h4>' + ui.table([
        { key: "at", label: "When", render: (r) => r.at }, { key: "channel", label: "Channel", render: (r) => r.channel },
        { key: "recipient", label: "Recipient", render: (r) => r.recipient }, { key: "status", label: "Status", render: (r) => r.status },
      ], noteRows, { scroll: true }) : "");
    const m = ui.modal({ title: "Alert · " + (a.subject || a.monitorName || a.id), size: "lg", body });
    if (!m) return;
    const run = async (fn, msg) => { const r = await fn(); if (r && r.error) return (ERP.toast || (() => {}))("Failed: " + r.error, "error"); (ERP.toast || (() => {}))(msg || "Done"); ui.closeModal(); await paint(); };
    m.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act"), id = t.getAttribute("data-arg") || a.id;
      if (act === "al-detail-ack") run(() => AL.acknowledge(provider.id, id), "Acknowledged");
      else if (act === "al-detail-resolve") run(() => AL.resolve(provider.id, id), "Resolved");
      else if (act === "al-detail-snooze") run(() => AL.snooze(provider.id, id, 60), "Snoozed for 1 hour");
      else if (act === "al-scan") run(() => AL.scan(provider.id, { prune: true }), "Scan complete");
    });
  }

  async function mount(host, ctx, opts) {
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { host.innerHTML = '<div class="erp-alert">No service providers yet.</div>'; return; }
    const TABS = ["triage", "alerts", "routing", "tickets"];
    const state = {
      pid: (AL.currentProviderId && providers.some((p) => p.id === AL.currentProviderId)) ? AL.currentProviderId : (opts.providerId || providers[0].id),
      tab: TABS.indexOf(opts.tab) !== -1 ? opts.tab : "alerts",
      filterState: "active", filterSeverity: "", filterDevice: "", q: "",
    };
    AL.currentProviderId = state.pid;
    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    async function paint() {
      const p = await prov();
      if (!p) { host.innerHTML = '<div class="erp-alert">This tenant could not be loaded.</div>'; return; }
      const counts = AL.counts(p);
      const tabs = ui.tabs([
        { id: "triage", label: "Triage queue", badge: String(counts.active) },
        { id: "alerts", label: "All alerts", badge: String(counts.total) },
        { id: "routing", label: "Routing & escalation" },
        { id: "tickets", label: "psa-u tickets" },
      ], state.tab);
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = (opts.headHtml || "") + tabs.html + picker;
      scopedShowTab(host, state.tab);
      const panel = host.querySelector('[data-panel="' + state.tab + '"]');
      if (state.tab === "alerts") panel.innerHTML = alertsPanel(p, state);
      else if (state.tab === "triage") {
        const TRI = window.ERP.triage;
        if (TRI && TRI.renderPanel) await TRI.renderPanel(panel, { provider: p, providerId: state.pid, providers, embedded: true, toast: ctx.toast, onChange: paint });
        else panel.innerHTML = ui.alert("The triage workspace is still loading.", "info");
      } else if (state.tab === "routing") {
        const R = RT();
        if (R && R.renderPanel) await R.renderPanel(panel, { provider: p, providerId: state.pid, providers, embedded: true, toast: ctx.toast, onChange: paint });
        else panel.innerHTML = ui.alert("Notification routing is still loading.", "info");
      } else if (state.tab === "tickets") {
        const P = PSA();
        if (P && P.renderPanel) await P.renderPanel(panel, { provider: p, providerId: state.pid, providers, embedded: true, toast: ctx.toast, onChange: paint, onOpenAlert: (id) => openDetail(p, id, paint) });
        else panel.innerHTML = ui.alert("The psa-u bridge is still loading.", "info");
      }
    }

    ui.bind(host, "click", "[data-tab]", (t) => {
      const id = t.getAttribute("data-tab");
      if (TABS.indexOf(id) === -1) return;
      state.tab = id;
      paint();
    });

    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      const p = await prov();
      if (!p) return;
      const toast = ctx.toast || ERP.toast;
      if (act === "al-scan") {
        const r = await AL.scan(state.pid, { prune: true });
        if (r && r.error) return toast("Scan failed: " + r.error, "error");
        toast("Scan: " + r.evaluated + " assessment(s) — " + r.fired + " fired, " + r.cleared + " cleared");
        return paint();
      }
      if (act === "al-ack") { const r = await AL.acknowledge(state.pid, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Acknowledged"); return paint(); }
      if (act === "al-resolve") { const r = await AL.resolve(state.pid, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Resolved"); return paint(); }
      if (act === "al-snooze") {
        const until = new Date(Date.now() + 60 * 60000).toISOString();
        const r = await AL.snooze(state.pid, arg, until, AL.actorName());
        if (r.error) return toast("Failed: " + r.error, "error");
        toast("Snoozed for 1 hour"); return paint();
      }
      if (act === "al-detail") return openDetail(p, arg, paint);
    });

    host.addEventListener("change", (e) => {
      if (!e.target) return;
      if (e.target.name === "pid") { state.pid = e.target.value; AL.currentProviderId = state.pid; return paint(); }
      if (e.target.name === "al_state") { state.filterState = e.target.value; return paint(); }
      if (e.target.name === "al_severity") { state.filterSeverity = e.target.value; return paint(); }
      if (e.target.name === "al_device") { state.filterDevice = e.target.value; return paint(); }
    });
    host.addEventListener("input", (e) => {
      if (e.target && e.target.name === "al_q") { state.q = e.target.value; state.__q = true; }
    });
    host.addEventListener("keyup", (e) => {
      if (e.target && e.target.name === "al_q" && e.key === "Enter") paint();
    });

    await paint();
    return state;
  }

  AL.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "rmm-alerts";
    host.innerHTML = "";
    host.appendChild(wrap);
    const head = opts.headHtml || ERP.ui.pageHead("Alerts",
      "The alert lifecycle — fired → acknowledged → resolved / auto-cleared — with de-duplication and flapping suppression, snooze, severity mapping, root device/site/group context and a link to the monitor and policy that produced it.",
      ERP.ui.btn("Scan now", { primary: true, act: "al-scan" }));
    return mount(wrap, { toast: opts.toast || ERP.toast }, Object.assign({}, opts, { headHtml: head }));
  };

  AL.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const tab = ["alerts", "routing", "tickets"].indexOf(el.__tab) !== -1 ? el.__tab : "alerts";
    const pid = (AL.currentProviderId && providers.some((p) => p.id === AL.currentProviderId)) ? AL.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-alerts";
    el.innerHTML = "";
    el.appendChild(root);
    const head = ERP.ui.pageHead("Alerts",
      "The alert lifecycle — fired → acknowledged → resolved / auto-cleared — with de-duplication and flapping suppression, snooze, severity mapping, root device/site/group context and a link to the monitor and policy that produced it.",
      ERP.ui.btn("Scan now", { primary: true, act: "al-scan" }));
    await mount(root, ctx, { providers, providerId: pid, tab, headHtml: head });
    return { pid };
  };
})();
