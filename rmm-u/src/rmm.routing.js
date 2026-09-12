/* ============================================================
   RMM-U — notification routing & escalation  (Phase 5 · Task 25)

   `rmm.notify` (Task 22) knows how to send *a* message to *a*
   channel. This module is the policy layer above it: given an alert,
   decide WHO is told, HOW, and when to escalate if nobody has
   acknowledged it.

   • ROUTE — a severity/site/group/tag/device/monitor match that
     chooses a set of channels and recipients. The highest-priority
     matching enabled route wins; with no route the master default
     channel is used, gated by the severity's own `notify` flag.
   • ESCALATION — an ordered list of steps ("after 15 minutes, page
     the on-call rota; after 60, page the service manager"). A still-
     unacknowledged alert advances through the steps as it ages;
     `repeatMinutes` / `maxRepeats` re-page the top step.
   • RECIPIENTS — a person with channels, a timezone, quiet hours and
     a digest preference. Quiet hours and non-immediate digests do not
     drop notifications; they are queued into a digest and delivered in
     one summary.
   • ON-CALL — a rotating rota; `RT.onCall(providerId, at)` answers
     "who is on call right now?" so an escalation can page the person
     rather than a fixed channel.
   • STRICT DE-DUPLICATION — a notification is never sent twice for
     the same alert + channel + recipient inside
     `config.rmm.notifyDedupeMinutes`, and a *flapping* alert is never
     paged at all, so a bouncing device cannot spam anyone.

   Everything is kept in the hidden `rmm-v1-routing` document so a
   tenant's routing policy travels with it.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const M = ERP.masterConfig || null;
  const RT = (ERP.routing = {});
  const AL = () => window.ERP.alerts || null;
  const SCH = () => window.ERP.schedules || null;
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

  RT.MODULE = "routing";
  RT.KINDS = ["route", "escalation", "recipient", "oncall", "digest"];

  const enabled = () => cfg("rmm.notifyEnabled", true) !== false;
  const routingEnabled = () => cfg("rmm.routingEnabled", true) !== false;
  const escalationEnabled = () => cfg("rmm.escalationEnabled", true) !== false;
  const dedupeMinutes = () => Math.max(0, num(cfg("rmm.notifyDedupeMinutes", 15), 15));
  const digestMax = () => Math.max(10, num(cfg("rmm.notifyDigestMax", 200), 200));
  const digestMinutes = () => Math.max(5, num(cfg("rmm.notifyDigestMinutes", 60), 60));

  /* ═══════════════════════ persistence ═══════════════════════ */

  async function load() { const r = await store.loadDoc(RT.MODULE); return asArr(r.error ? [] : r.records); }
  async function save(list) { return store.saveDoc(RT.MODULE, list); }
  RT.load = load;

  /* ═══════════════════════ normalisation ═══════════════════════ */

  const DIGESTS = ["immediate", "hourly", "daily"];

  function normalizeRecipient(d) {
    d = asObj(d);
    const qh = asObj(d.quietHours);
    return {
      kind: "recipient", id: d.id || rid("rcp"),
      providerId: d.providerId ? String(d.providerId) : null,
      name: S(d.name, 120) || "Recipient",
      email: S(d.email, 200), phone: S(d.phone, 60),
      channels: asArr(d.channels).map(String),
      timezone: S(d.timezone, 80) || "UTC",
      quietHours: {
        enabled: !!qh.enabled,
        start: S(qh.start || "22:00", 5),
        end: S(qh.end || "07:00", 5),
        days: asArr(qh.days).map(String),
      },
      digest: DIGESTS.indexOf(d.digest) !== -1 ? d.digest : "immediate",
      enabled: d.enabled === undefined ? true : !!d.enabled,
      createdAt: d.createdAt || now(), updatedAt: d.updatedAt || now(),
    };
  }

  function normalizeRoute(d) {
    d = asObj(d);
    return {
      kind: "route", id: d.id || rid("rte"),
      providerId: d.providerId ? String(d.providerId) : null,
      label: S(d.label, 120) || "Route",
      enabled: d.enabled === undefined ? true : !!d.enabled,
      severityAtLeast: d.severityAtLeast ? String(d.severityAtLeast) : "",
      severityAtMost: d.severityAtMost ? String(d.severityAtMost) : "",
      siteIds: asArr(d.siteIds).map(String),
      groupIds: asArr(d.groupIds).map(String),
      tags: asArr(d.tags).map(String),
      deviceIds: asArr(d.deviceIds).map(String),
      monitorIds: asArr(d.monitorIds).map(String),
      channelIds: asArr(d.channelIds).map(String),
      recipients: asArr(d.recipients).map(String),
      priority: num(d.priority, 0),
      createdAt: d.createdAt || now(), updatedAt: d.updatedAt || now(),
    };
  }

  function normalizeEscalation(d) {
    d = asObj(d);
    const steps = asArr(d.steps).map((s) => {
      s = asObj(s);
      return {
        afterMinutes: Math.max(0, num(s.afterMinutes, 0)),
        label: S(s.label, 120),
        channelIds: asArr(s.channelIds).map(String),
        recipients: asArr(s.recipients).map(String),
        useOnCall: !!s.useOnCall,
      };
    }).sort((a, b) => a.afterMinutes - b.afterMinutes);
    return {
      kind: "escalation", id: d.id || rid("esc"),
      providerId: d.providerId ? String(d.providerId) : null,
      label: S(d.label, 120) || "Escalation policy",
      enabled: d.enabled === undefined ? true : !!d.enabled,
      severityAtLeast: d.severityAtLeast ? String(d.severityAtLeast) : "",
      siteIds: asArr(d.siteIds).map(String),
      steps,
      repeatMinutes: Math.max(0, num(d.repeatMinutes, 0)),
      maxRepeats: Math.max(0, num(d.maxRepeats, 2)),
      createdAt: d.createdAt || now(), updatedAt: d.updatedAt || now(),
    };
  }

  function normalizeOnCall(d) {
    d = asObj(d);
    return {
      kind: "oncall", id: d.id || rid("onc"),
      providerId: d.providerId ? String(d.providerId) : null,
      label: S(d.label, 120) || "On-call rotation",
      enabled: d.enabled === undefined ? true : !!d.enabled,
      rotationMinutes: Math.max(5, num(d.rotationMinutes, 1440)),
      startsAt: d.startsAt || now(),
      members: asArr(d.members).map((m) => { m = asObj(m); return { name: S(m.name, 120), recipientId: m.recipientId ? String(m.recipientId) : "", contact: S(m.contact, 200) }; }),
      createdAt: d.createdAt || now(), updatedAt: d.updatedAt || now(),
    };
  }

  function normalizeDigest(d) {
    d = asObj(d);
    return {
      kind: "digest", id: d.id || rid("dgt"),
      providerId: d.providerId ? String(d.providerId) : null,
      recipientId: d.recipientId ? String(d.recipientId) : "",
      recipientName: S(d.recipientName, 120),
      channelId: d.channelId ? String(d.channelId) : "",
      period: S(d.period || "digest", 40),
      status: d.status || "pending",
      items: asArr(d.items),
      createdAt: d.createdAt || now(), sentAt: d.sentAt || "",
    };
  }

  RT.normalize = function (kind, data) {
    switch (kind) {
      case "recipient": return normalizeRecipient(data);
      case "route": return normalizeRoute(data);
      case "escalation": return normalizeEscalation(data);
      case "oncall": return normalizeOnCall(data);
      case "digest": return normalizeDigest(data);
      default: return null;
    }
  };

  RT.validate = function (kind, rec) {
    const errors = [];
    if (RT.KINDS.indexOf(kind) === -1) errors.push("unknown kind: " + kind);
    if (kind === "route" && !asArr(asObj(rec).channelIds).length && !asArr(asObj(rec).recipients).length) errors.push("a route needs at least one channel or recipient");
    if (kind === "oncall" && !asArr(asObj(rec).members).length) errors.push("a rotation needs at least one member");
    return { valid: errors.length === 0, errors };
  };

  /* ═══════════════════════ CRUD ═══════════════════════ */

  RT.list = async function (kind, providerId) {
    let rows = (await load()).filter((r) => r.kind === kind);
    if (providerId) rows = rows.filter((r) => !r.providerId || String(r.providerId) === String(providerId));
    return clone(rows);
  };

  RT.get = async function (kind, id) {
    const rows = await load();
    const rec = rows.find((r) => r.kind === kind && String(r.id) === String(id));
    return rec ? clone(rec) : null;
  };

  RT.add = async function (kind, data) {
    const rec = RT.normalize(kind, data);
    if (!rec) return { error: "unknown_kind", kind };
    const v = RT.validate(kind, rec);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const rows = await load();
    rows.push(rec);
    const w = await save(rows);
    if (w && w.error) return { error: w.error, message: w.message };
    return { record: clone(rec) };
  };

  RT.update = async function (kind, id, patch) {
    const rows = await load();
    const i = rows.findIndex((r) => r.kind === kind && String(r.id) === String(id));
    if (i === -1) return { error: "not_found", kind, id };
    const merged = RT.normalize(kind, Object.assign({}, rows[i], asObj(patch), { id: rows[i].id, createdAt: rows[i].createdAt }));
    const v = RT.validate(kind, merged);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    merged.updatedAt = now();
    rows[i] = merged;
    const w = await save(rows);
    if (w && w.error) return { error: w.error, message: w.message };
    return { record: clone(merged) };
  };

  RT.remove = async function (kind, id) {
    const rows = await load();
    const kept = rows.filter((r) => !(r.kind === kind && String(r.id) === String(id)));
    const w = await save(kept);
    if (w && w.error) return { error: w.error };
    return { removed: id };
  };

  RT.clear = async function (providerId) {
    const rows = await load();
    const kept = providerId ? rows.filter((r) => String(r.providerId) !== String(providerId)) : [];
    const w = await save(kept);
    if (w && w.error) return { error: w.error };
    return { ok: true, removed: rows.length - kept.length };
  };

  /* ═══════════════════════ time helpers ═══════════════════════ */

  function zonedParts(date, tz) {
    const SCHx = SCH();
    if (SCHx && typeof SCHx.zoned === "function") { try { return SCHx.zoned(date instanceof Date ? date : new Date(date), tz); } catch (e) {} }
    if (M && typeof M.zonedParts === "function") return M.zonedParts(date instanceof Date ? date : new Date(date), tz);
    return { weekday: "mon", date: "", time: "00:00", minutes: 0 };
  }
  function toMin(t) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }

  RT.inQuietHours = function (recipient, at) {
    const qh = asObj(asObj(recipient).quietHours);
    if (!qh.enabled) return false;
    const p = zonedParts(at || new Date(), asObj(recipient).timezone || "UTC");
    if (asArr(qh.days).length && asArr(qh.days).indexOf(String(p.weekday)) === -1) return false;
    const start = toMin(qh.start), end = toMin(qh.end), cur = num(p.minutes, 0);
    if (start === end) return false;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end;
  };

  RT.onCall = async function (providerId, at) {
    const rotas = (await RT.list("oncall", providerId)).filter((r) => r.enabled !== false);
    const rota = rotas[0];
    if (!rota || !asArr(rota.members).length) return null;
    const members = asArr(rota.members);
    const start = Date.parse(rota.startsAt || 0);
    const ms = (at ? Date.parse(at) : Date.now()) - (isFinite(start) ? start : 0);
    const period = Math.max(5, num(rota.rotationMinutes, 1440)) * 60000;
    const idx = ((Math.floor(ms / period) % members.length) + members.length) % members.length;
    const m = members[idx];
    return { rotaId: rota.id, rotaLabel: rota.label, index: idx, name: m.name, recipientId: m.recipientId || "", contact: m.contact || "" };
  };

  /* ═══════════════════════ matching ═══════════════════════ */

  async function severityMap() {
    if (!M) return {};
    try {
      const list = await M.section("severities");
      const map = {};
      list.forEach((s) => { map[s.id] = num(s.rank, 0); });
      return map;
    } catch (e) { return {}; }
  }
  function syncRank(map) { return (id) => { if (!id) return null; return map[id] == null ? null : map[id]; }; }

  async function rankOf(id) {
    const map = await severityMap();
    return map[id] == null ? null : map[id];
  }

  function routeMatches(route, alert, device, rank, alertRank) {
    if (route.enabled === false) return false;
    if (route.severityAtLeast) { const min = rank(route.severityAtLeast); if (min != null && alertRank != null && alertRank < min) return false; }
    if (route.severityAtMost) { const max = rank(route.severityAtMost); if (max != null && alertRank != null && alertRank > max) return false; }
    if (asArr(route.siteIds).length && asArr(route.siteIds).map(String).indexOf(String(alert.siteId || "")) === -1) return false;
    if (asArr(route.deviceIds).length && asArr(route.deviceIds).map(String).indexOf(String(alert.deviceId || "")) === -1) return false;
    if (asArr(route.monitorIds).length && asArr(route.monitorIds).map(String).indexOf(String(alert.monitorId || "")) === -1) return false;
    if (asArr(route.groupIds).length) {
      const groups = asArr(alert.groupIds).map(String);
      if (!asArr(route.groupIds).map(String).some((g) => groups.indexOf(g) !== -1)) return false;
    }
    if (asArr(route.tags).length) {
      const tags = asArr(device && device.tags).map(low);
      if (!asArr(route.tags).map(low).some((t) => tags.indexOf(t) !== -1)) return false;
    }
    return true;
  }

  function specificity(route) {
    return asArr(route.deviceIds).length * 8 + asArr(route.monitorIds).length * 6 + asArr(route.groupIds).length * 3
      + asArr(route.tags).length * 3 + asArr(route.siteIds).length * 2 + (route.severityAtLeast ? 1 : 0);
  }

  RT.resolveRoute = async function (provider, alert, device) {
    const routes = (await RT.list("route", provider && provider.id)).filter((r) => r.enabled !== false);
    const rank = syncRank(await severityMap());
    const alertRank = rank(alert && alert.severityId);
    const matches = routes.filter((r) => routeMatches(r, alert, device, rank, alertRank));
    matches.sort((a, b) => (num(b.priority, 0) - num(a.priority, 0)) || (specificity(b) - specificity(a)));
    if (matches.length) return matches[0];
    return null;
  };

  async function defaultChannelId() {
    if (!M) return null;
    try { return (await M.settings()).defaultChannel || null; } catch (e) { return null; }
  }

  /* ═══════════════════════ de-duplication ═══════════════════════ */

  RT.shouldSend = async function (providerId, alert, opts) {
    opts = opts || {};
    if (alert && alert.flapping && opts.force !== true) return { ok: false, reason: "flapping" };
    const mins = dedupeMinutes();
    if (opts.force === true || mins <= 0) return { ok: true };
    const N = NOT();
    if (!N || typeof N.list !== "function") return { ok: true };
    const atMs = opts.at ? Date.parse(opts.at) : Date.now();
    const since = atMs - mins * 60000;
    let rows = [];
    try { rows = await N.list(providerId, {}); } catch (e) { return { ok: true }; }
    const dup = rows.find((r) => r.meta && String(r.meta.alertId) === String(alert.id)
      && String(r.channelId || "") === String(opts.channelId || "")
      && String(r.meta.recipientId || "") === String(opts.recipientId || "")
      && r.status !== "suppressed" && Date.parse(r.at) >= since);
    if (dup) return { ok: false, reason: "dedupe", sinceAt: dup.at };
    return { ok: true };
  };

  /* ═══════════════════════ sending ═══════════════════════ */

  function alertSubject(alert, prefix) {
    return (prefix || "") + (alert.severityLabel ? "[" + alert.severityLabel + "] " : "") + (alert.subject || alert.monitorName || "Alert") + " on " + (alert.hostname || alert.deviceId);
  }
  function alertMessage(alert) {
    return [alert.message, "Device: " + (alert.hostname || alert.deviceId), alert.siteName ? "Site: " + alert.siteName : "", "Monitor: " + (alert.monitorName || alert.monitorId || ""), "State: " + alert.state].filter(Boolean).join("\n");
  }

  async function sendOne(providerId, alert, channelId, recipient, at, meta) {
    const N = NOT();
    if (!N || typeof N.send !== "function") return { status: "skipped", reason: "no_notify" };
    const m = Object.assign({ alertId: alert.id, recipientId: recipient ? recipient.id : "", recipientName: recipient ? recipient.name : "", source: "routing" }, asObj(meta));
    let r;
    try {
      r = await N.send({
        providerId, channelId, severityId: alert.severityId,
        subject: alertSubject(alert, meta && meta.prefix),
        message: alertMessage(alert), deviceId: alert.deviceId, at,
        meta: m,
      });
    } catch (e) { return { status: "failed", reason: (e && e.message) || "threw" }; }
    if (r && r.error) return { status: "failed", reason: r.error };
    const rec = r && r.notification;
    return {
      id: rec ? rec.id : null, at, channelId, channelType: rec ? rec.channelType : "",
      recipientId: recipient ? recipient.id : null, recipientName: recipient ? recipient.name : "",
      status: rec ? rec.status : "unknown", reason: rec ? rec.reason : "",
    };
  }

  async function recordOnAlert(providerId, alert, entries) {
    const list = asArr(entries);
    if (!list.length) return;
    await T.updateItem(providerId, "alerts", alert.id, (it) => {
      it.notifications = asArr(it.notifications).concat(list).slice(-100);
      it.updatedAt = now();
    });
  }
  RT.recordOnAlert = recordOnAlert;

  /* ═══════════════════════ digests ═══════════════════════ */

  RT.queueDigest = async function (providerId, alert, recipient, channelId, at) {
    const rows = await load();
    let rec = rows.find((r) => r.kind === "digest" && r.status === "pending"
      && String(r.providerId) === String(providerId)
      && String(r.recipientId) === String(recipient ? recipient.id : "")
      && String(r.channelId) === String(channelId || ""));
    const item = { alertId: alert.id, severityId: alert.severityId, severityLabel: alert.severityLabel, subject: alert.subject || alert.monitorName, hostname: alert.hostname, deviceId: alert.deviceId, at };
    if (rec) {
      rec.items = asArr(rec.items).concat([item]).slice(-digestMax());
    } else {
      rec = normalizeDigest({ providerId, recipientId: recipient ? recipient.id : "", recipientName: recipient ? recipient.name : "", channelId, period: "digest", status: "pending", items: [item] });
      rows.push(rec);
    }
    await save(rows);
    return { id: rec.id, recipientId: rec.recipientId, channelId: rec.channelId, items: rec.items.length, status: rec.status };
  };

  RT.pendingDigests = async function (providerId) {
    return (await RT.list("digest", providerId)).filter((d) => d.status === "pending");
  };

  RT.flushDigests = async function (providerId, at) {
    const rows = await load();
    const pending = rows.filter((r) => r.kind === "digest" && r.status === "pending" && (!providerId || String(r.providerId) === String(providerId)));
    const sent = [];
    for (const d of pending) {
      const items = asArr(d.items);
      if (!items.length) { d.status = "empty"; continue; }
      const lines = items.map((it) => "- [" + (it.severityLabel || it.severityId || "") + "] " + (it.subject || "alert") + " on " + (it.hostname || it.deviceId) + " (" + (it.at || "") + ")");
      const N = NOT();
      let res = { status: "skipped" };
      if (N && typeof N.send === "function") {
        try {
          res = await N.send({
            providerId: d.providerId, channelId: d.channelId, severityId: items[0] && items[0].severityId,
            subject: "Digest: " + items.length + " alert(s)", message: lines.join("\n"), at: at || now(),
            meta: { recipientId: d.recipientId, recipientName: d.recipientName, digest: true, source: "routing" },
          });
          if (res && res.error) res = { status: "failed", reason: res.error };
          else res = res && res.notification ? { status: res.notification.status, id: res.notification.id } : { status: "unknown" };
        } catch (e) { res = { status: "failed", reason: (e && e.message) || "threw" }; }
      }
      d.status = res.status === "sent" ? "sent" : res.status === "failed" ? "failed" : "skipped";
      d.sentAt = at || now();
      sent.push({ id: d.id, recipientId: d.recipientId, channelId: d.channelId, items: items.length, status: d.status });
    }
    await save(rows);
    return { ok: true, sent };
  };

  /* ═══════════════════════ routing an alert ═══════════════════════ */

  /* opts: { event, at, force, prefix } */
  RT.routeAlert = async function (providerId, alert, opts) {
    opts = opts || {};
    if (!enabled() || !routingEnabled()) return { skipped: true, reason: "disabled" };
    if (!alert || !alert.id) return { error: "no_alert" };
    const at = opts.at || now();
    if (alert.suppressed) return { skipped: true, reason: "suppressed" };
    const ALx = AL();
    if (ALx && typeof ALx.isSnoozed === "function" && ALx.isSnoozed(alert, at)) return { skipped: true, reason: "snoozed" };
    if (alert.flapping && opts.force !== true) return { skipped: true, reason: "flapping" };
    if (M) {
      const s = (await M.section("severities")).find((x) => String(x.id) === String(alert.severityId));
      if (s && s.notify === false) return { skipped: true, reason: "severity_silent" };
    }
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const device = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(alert.deviceId)) || null;
    let route = await RT.resolveRoute(provider, alert, device);
    let synthetic = false;
    if (!route) {
      const def = await defaultChannelId();
      if (!def) return { skipped: true, reason: "no_route" };
      route = normalizeRoute({ providerId, label: "Default", channelIds: [def], recipients: [], priority: -1 });
      synthetic = true;
    }

    const recipients = (await RT.list("recipient", providerId)).filter((r) => r.enabled !== false);
    const chosen = asArr(route.recipients).map(String).map((id) => recipients.find((r) => String(r.id) === id)).filter(Boolean);

    const sent = [], queued = [], suppressed = [], entries = [];
    const deliver = async (channelId, recipient) => {
      const dedup = await RT.shouldSend(providerId, alert, { channelId, recipientId: recipient ? recipient.id : "", at, force: opts.force });
      if (!dedup.ok) { suppressed.push({ channelId, recipientId: recipient ? recipient.id : "", reason: dedup.reason }); return; }
      const quiet = recipient && RT.inQuietHours(recipient, at);
      const digest = recipient && recipient.digest && recipient.digest !== "immediate";
      if (quiet || digest) {
        const q = await RT.queueDigest(providerId, alert, recipient, channelId, at);
        queued.push(q);
        entries.push({ at, channelId, channelType: "digest", recipientId: recipient ? recipient.id : null, recipientName: recipient ? recipient.name : "", status: "queued", reason: quiet ? "quiet hours" : "digest", identity: q.id });
        return;
      }
      const res = await sendOne(providerId, alert, channelId, recipient, at, { routeId: route.id, prefix: opts.prefix });
      sent.push(res);
      entries.push({ at: res.at, channelId: res.channelId, channelType: res.channelType, recipientId: res.recipientId, recipientName: res.recipientName, status: res.status, reason: res.reason, identity: res.id });
    };

    if (chosen.length) {
      for (const r of chosen) {
        const channels = asArr(r.channels).length ? asArr(r.channels) : asArr(route.channelIds);
        for (const ch of channels) await deliver(ch, r);
      }
    } else {
      for (const ch of asArr(route.channelIds)) await deliver(ch, null);
    }
    await recordOnAlert(providerId, alert, entries);
    return { route: { id: route.id, label: route.label, synthetic }, sent, queued, suppressed };
  };

  /* ═══════════════════════ escalation ═══════════════════════ */

  function escalationMatches(policy, alert, rank, alertRank) {
    if (policy.enabled === false) return false;
    if (policy.severityAtLeast) { const min = rank(policy.severityAtLeast); if (min != null && alertRank != null && alertRank < min) return false; }
    if (asArr(policy.siteIds).length && asArr(policy.siteIds).map(String).indexOf(String(alert.siteId || "")) === -1) return false;
    return true;
  }

  RT.escalate = async function (providerId, at, opts) {
    opts = opts || {};
    if (!escalationEnabled()) return { skipped: true, reason: "disabled" };
    at = at || now();
    const atMs = Date.parse(at);
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const policies = (await RT.list("escalation", providerId)).filter((p) => p.enabled !== false);
    const recipients = (await RT.list("recipient", providerId)).filter((r) => r.enabled !== false);
    const defChannel = await defaultChannelId();
    const rank = syncRank(await severityMap());
    const active = asArr(provider.alerts).filter((a) => AL() && AL().ACTIVE.indexOf(a.state) !== -1 && a.state === "firing");
    const results = [];
    for (const alert of active) {
      if (alert.suppressed) continue;
      if (AL() && AL().isSnoozed(alert, at)) continue;
      if (alert.flapping) continue;
      const sevRank = rank(alert.severityId);
      const policiesFor = policies.filter((p) => escalationMatches(p, alert, rank, sevRank));
      const ageMin = (atMs - Date.parse(alert.firstFiredAt)) / 60000;
      const level = num(alert.escalationLevel, 0);
      let step = null, stepIdx = -1, policy = policiesFor[0] || null;
      if (policy) {
        asArr(policy.steps).forEach((s, i) => { if (ageMin >= num(s.afterMinutes, 0)) { step = s; stepIdx = i; } });
      }
      let repeats = num(alert.escalationRepeats, 0);
      let repeat = false, fallback = false;
      if (policy) {
        if (stepIdx < 0) continue;
        if (stepIdx + 1 <= level) {
          const rep = num(policy.repeatMinutes, 0), maxRep = num(policy.maxRepeats, 0);
          const last = asArr(alert.escalations).slice(-1)[0];
          const since = last ? atMs - Date.parse(last.at) : Infinity;
          if (!(rep > 0 && repeats < maxRep && since >= rep * 60000)) continue;
          repeat = true;
        }
      } else {
        const s = M ? (await M.section("severities")).find((x) => String(x.id) === String(alert.severityId)) : null;
        const after = s ? num(s.escalateAfterMinutes, 0) : 0;
        if (after <= 0 || ageMin < after || level >= 1) continue;
        step = { afterMinutes: after, label: "sev " + alert.severityId, channelIds: [], recipients: [], useOnCall: true };
        stepIdx = 0;
        fallback = true;
      }

      const nextLevel = repeat ? level : Math.max(level, stepIdx + 1);
      let channels = asArr(step.channelIds).map(String).filter(Boolean);
      if (!channels.length) channels = defChannel ? [defChannel] : [];
      const onCall = (step.useOnCall || fallback) ? await RT.onCall(providerId, at) : null;
      let recips = asArr(step.recipients).map(String).map((id) => recipients.find((r) => String(r.id) === id)).filter(Boolean);
      if (onCall && onCall.recipientId) {
        const r = recipients.find((x) => String(x.id) === String(onCall.recipientId));
        if (r) recips = recips.concat([r]);
      }
      const sentEntries = [];
      const deliver = async (ch, recipient) => {
        const res = await sendOne(providerId, alert, ch, recipient, at, { routeId: policy ? policy.id : null, prefix: "ESCALATION L" + nextLevel + ": " });
        sentEntries.push({ at, level: nextLevel, step: stepIdx, channelId: ch, recipientId: recipient ? recipient.id : null, recipientName: recipient ? recipient.name : (onCall && onCall.name) || "", status: res.status, note: (repeat ? "repeat · " : "") + (fallback ? "severity default" : (step.label || "step " + (stepIdx + 1))), identity: res.id });
      };
      if (recips.length) {
        for (const r of recips) {
          const chs = channels.length ? channels : asArr(r.channels);
          for (const ch of chs) await deliver(ch, r);
        }
      } else {
        for (const ch of channels) await deliver(ch, null);
      }
      if (!sentEntries.length) sentEntries.push({ at, level: nextLevel, step: stepIdx, status: "skipped", note: repeat ? "repeat" : "step", recipientName: onCall ? onCall.name : "" });

      await T.updateItem(providerId, "alerts", alert.id, (it) => {
        it.escalations = asArr(it.escalations).concat(sentEntries).slice(-60);
        it.escalationLevel = nextLevel;
        it.escalationRepeats = repeat ? repeats + 1 : repeats;
        it.escalatedAt = at;
        it.updatedAt = at;
        it.history = asArr(it.history).concat([{ at, action: "escalated", actor: "system", note: "level " + nextLevel + (repeat ? " (repeat)" : "") + (onCall ? " → " + onCall.name : "") }]);
      });
      results.push({ alertId: alert.id, level: nextLevel, repeat, fallback, entries: sentEntries });
    }
    return { ok: true, at, triggered: results };
  };

  /* ═══════════════════════ stats ═══════════════════════ */

  RT.stats = async function (providerId) {
    const routes = await RT.list("route", providerId);
    const escalations = await RT.list("escalation", providerId);
    const recipients = await RT.list("recipient", providerId);
    const oncall = await RT.list("oncall", providerId);
    const digests = await RT.list("digest", providerId);
    let notif = { total: 0, byStatus: {} };
    const N = NOT();
    if (N && typeof N.stats === "function") { try { notif = await N.stats(providerId); } catch (e) {} }
    return {
      routes: routes.length, routesEnabled: routes.filter((r) => r.enabled !== false).length,
      escalations: escalations.length, recipients: recipients.length, oncall: oncall.length,
      digests: digests.length, digestsPending: digests.filter((d) => d.status === "pending").length,
      notifications: notif.total, byStatus: notif.byStatus || {},
    };
  };

  /* ═══════════════════════ demo seed ═══════════════════════ */

  RT.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && !enabled()) return { skipped: true, reason: "disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const existing = await RT.list("route", demo.id);
    if (existing.length && !opts.force) return { skipped: true, reason: "routes_exist" };
    const a1 = await RT.add("recipient", { providerId: demo.id, name: "NOC mailbox", email: "noc@example.com", channels: ["ch-email"], digest: "immediate" });
    if (a1.error) return { skipped: true, reason: a1.error };
    const a2 = await RT.add("recipient", { providerId: demo.id, name: "On-call engineer", phone: "+15550000", channels: ["ch-sms"], digest: "immediate", quietHours: { enabled: true, start: "22:00", end: "07:00" } });
    const a3 = await RT.add("recipient", { providerId: demo.id, name: "Ops digest", email: "ops@example.com", channels: ["ch-email"], digest: "hourly" });
    const rcp1 = a1.record, rcp2 = (a2 && a2.record) || rcp1, rcp3 = (a3 && a3.record) || rcp1;
    await RT.add("route", { providerId: demo.id, label: "Critical → NOC + on-call", priority: 20, severityAtLeast: "sev-critical", channelIds: ["ch-sms"], recipients: [rcp1.id, rcp2.id] });
    await RT.add("route", { providerId: demo.id, label: "Everything → console + digest", priority: 0, channelIds: ["ch-console"], recipients: [rcp3.id] });
    await RT.add("escalation", {
      providerId: demo.id, label: "Critical escalation", severityAtLeast: "sev-critical",
      steps: [
        { afterMinutes: 15, label: "Page on-call", useOnCall: true, channelIds: ["ch-sms"] },
        { afterMinutes: 60, label: "Notify service manager", channelIds: ["ch-email"], recipients: [rcp1.id] },
      ],
      repeatMinutes: 30, maxRepeats: 2,
    });
    await RT.add("oncall", { providerId: demo.id, label: "Primary rota", rotationMinutes: 1440, startsAt: now(), members: [{ name: "Alex Chen", recipientId: rcp2.id, contact: "+15550000" }, { name: "Priya Nair", recipientId: rcp1.id, contact: "noc@example.com" }] });
    return { providerId: demo.id, recipients: [rcp1.id, rcp2.id, rcp3.id] };
  };

  let readyResolve;
  RT.ready = new Promise((res) => { readyResolve = res; });
  RT.init = async function () { try { await T.ready; await RT.seedDemo(); } catch (e) { console.error("routing seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", RT.init);
  else RT.init();

  /* ═══════════════════════ UI ═══════════════════════ */

  RT.currentProviderId = null;

  function channelOptions(channels) { return asArr(channels).map((c) => ({ value: c.id, label: c.label || c.id })); }

  async function channelsOf() { if (!M) return []; try { return await M.section("channels"); } catch (e) { return []; } }
  async function severitiesOf() { if (!M) return []; try { return await M.section("severities"); } catch (e) { return []; } }

  async function routesPanel(provider, channels, recipients) {
    const ui = ERP.ui, esc = ui.esc;
    const routes = (await RT.list("route", provider.id)).sort((a, b) => num(b.priority, 0) - num(a.priority, 0));
    const chName = (id) => { const c = asArr(channels).find((x) => String(x.id) === String(id)); return c ? (c.label || c.id) : id; };
    const rcpName = (id) => { const r = asArr(recipients).find((x) => String(x.id) === String(id)); return r ? r.name : id; };
    const rows = routes.map((r) => ({
      label: '<b>' + esc(r.label) + "</b>" + (r.enabled === false ? " " + ui.badge("disabled", "muted") : "") + '<div class="erp-sub">priority ' + num(r.priority, 0) + "</div>",
      match: esc([r.severityAtLeast ? "≥ " + r.severityAtLeast : "", r.severityAtMost ? "≤ " + r.severityAtMost : "", asArr(r.siteIds).length ? asArr(r.siteIds).length + " site(s)" : "", asArr(r.groupIds).length ? asArr(r.groupIds).length + " group(s)" : "", asArr(r.tags).length ? "tags: " + asArr(r.tags).join(",") : ""].filter(Boolean).join(" · ") || "any alert"),
      targets: esc(asArr(r.channelIds).map(chName).join(", ")) + (asArr(r.recipients).length ? '<div class="erp-sub">' + esc(asArr(r.recipients).map(rcpName).join(", ")) + "</div>" : ""),
      actions: ui.btn("Edit", { small: true, act: "rt-route-edit", arg: r.id }) + " " + ui.btn(r.enabled === false ? "Enable" : "Disable", { small: true, act: "rt-route-toggle", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rt-route-del", arg: r.id }),
    }));
    return ui.table([
      { key: "label", label: "Route", render: (r) => r.label },
      { key: "match", label: "Matches", render: (r) => r.match },
      { key: "targets", label: "Notifies", render: (r) => r.targets },
      { key: "actions", label: "", render: (r) => r.actions },
    ], rows, { scroll: true, emptyText: "No routes yet — unrouted alerts fall back to the master default channel." });
  }

  async function escalationsPanel(provider, channels, recipients) {
    const ui = ERP.ui, esc = ui.esc;
    const list = await RT.list("escalation", provider.id);
    const chName = (id) => { const c = asArr(channels).find((x) => String(x.id) === String(id)); return c ? (c.label || c.id) : id; };
    const rcpName = (id) => { const r = asArr(recipients).find((x) => String(x.id) === String(id)); return r ? r.name : id; };
    const rows = list.map((p) => ({
      label: '<b>' + esc(p.label) + "</b>" + (p.enabled === false ? " " + ui.badge("disabled", "muted") : "") + '<div class="erp-sub">' + esc(p.severityAtLeast ? "≥ " + p.severityAtLeast : "any severity") + (p.repeatMinutes ? " · repeat every " + p.repeatMinutes + "m ×" + p.maxRepeats : "") + "</div>",
      steps: asArr(p.steps).map((s, i) => '<div>L' + (i + 1) + " · +" + num(s.afterMinutes, 0) + "m · " + esc(s.label || "") + " → " + esc((asArr(s.channelIds).map(chName).join(", ") || "default") + (asArr(s.recipients).length ? " · " + asArr(s.recipients).map(rcpName).join(", ") : "") + (s.useOnCall ? " · on-call" : "")) + "</div>").join("") || '<span class="erp-sub">no steps</span>',
      actions: ui.btn("Edit", { small: true, act: "rt-esc-edit", arg: p.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rt-esc-del", arg: p.id }),
    }));
    return ui.table([
      { key: "label", label: "Policy", render: (r) => r.label },
      { key: "steps", label: "Steps", render: (r) => r.steps },
      { key: "actions", label: "", render: (r) => r.actions },
    ], rows, { scroll: true, emptyText: "No escalation policies — alerts stay at their initial notification level." });
  }

  async function recipientsPanel(provider, channels) {
    const ui = ERP.ui, esc = ui.esc;
    const list = await RT.list("recipient", provider.id);
    const chName = (id) => { const c = asArr(channels).find((x) => String(x.id) === String(id)); return c ? (c.label || c.id) : id; };
    const rows = list.map((r) => ({
      name: '<b>' + esc(r.name) + "</b>" + (r.enabled === false ? " " + ui.badge("disabled", "muted") : "") + '<div class="erp-sub">' + esc(r.email || r.phone || "") + "</div>",
      channels: esc(asArr(r.channels).map(chName).join(", ") || "—"),
      quiet: r.quietHours.enabled ? ui.badge(r.quietHours.start + "–" + r.quietHours.end, "info") : '<span class="erp-sub">none</span>',
      digest: ui.badge(r.digest || "immediate", r.digest === "immediate" ? "muted" : "info"),
      actions: ui.btn("Edit", { small: true, act: "rt-rcp-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rt-rcp-del", arg: r.id }),
    }));
    return ui.table([
      { key: "name", label: "Recipient", render: (r) => r.name },
      { key: "channels", label: "Channels", render: (r) => r.channels },
      { key: "quiet", label: "Quiet hours", render: (r) => r.quiet },
      { key: "digest", label: "Delivery", render: (r) => r.digest },
      { key: "actions", label: "", render: (r) => r.actions },
    ], rows, { scroll: true, emptyText: "No recipients yet." });
  }

  async function oncallPanel(provider) {
    const ui = ERP.ui, esc = ui.esc;
    const rotas = await RT.list("oncall", provider.id);
    const cur = await RT.onCall(provider.id, now());
    const curHtml = cur
      ? ui.alert("On call now: " + cur.name + (cur.contact ? " (" + cur.contact + ")" : "") + " — rota “" + cur.rotaLabel + "”, slot " + (cur.index + 1) + ".", "info")
      : ui.alert("No on-call rotation is configured.", "warn");
    const rows = rotas.map((r) => ({
      label: '<b>' + esc(r.label) + "</b>" + (r.enabled === false ? " " + ui.badge("disabled", "muted") : "") + '<div class="erp-sub">rotates every ' + num(r.rotationMinutes, 0) + "m</div>",
      members: asArr(r.members).map((m, i) => '<div>' + (i + 1) + ". " + esc(m.name) + (m.contact ? ' <span class="erp-sub">' + esc(m.contact) + "</span>" : "") + (cur && cur.rotaId === r.id && i === cur.index ? " " + ui.badge("now", "success") : "") + "</div>").join(""),
      actions: ui.btn("Edit", { small: true, act: "rt-onc-edit", arg: r.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "rt-onc-del", arg: r.id }),
    }));
    return curHtml + ui.table([
      { key: "label", label: "Rotation", render: (r) => r.label },
      { key: "members", label: "Members", render: (r) => r.members },
      { key: "actions", label: "", render: (r) => r.actions },
    ], rows, { scroll: true, emptyText: "No rotations yet." });
  }

  async function logPanel(provider) {
    const ui = ERP.ui, esc = ui.esc;
    const N = NOT();
    const rows = N && N.list ? (await N.list(provider.id, { limit: 100 })) : [];
    const digests = await RT.pendingDigests(provider.id);
    const logRows = rows.map((r) => ({
      at: esc(ui.dateTime(r.at)),
      channel: ui.badge(r.channelType || r.channelId || "", "info"),
      recipient: esc((r.meta && r.meta.recipientName) || (r.meta && r.meta.recipientId) || "—"),
      alert: esc((r.meta && r.meta.alertId) || "—"),
      status: ui.badge(r.status || "", r.status === "sent" ? "success" : r.status === "failed" ? "danger" : "muted"),
      note: '<span class="erp-sub">' + esc(r.reason || "") + "</span>",
    }));
    const dRows = digests.map((d) => ({
      recipient: esc(d.recipientName || d.recipientId || "—"), channel: esc(d.channelId), items: String(asArr(d.items).length), since: esc(ui.dateTime(d.createdAt)),
    }));
    return ui.summary([
      { label: "Notifications", value: String(rows.length) },
      { label: "Sent", value: String(rows.filter((r) => r.status === "sent").length) },
      { label: "Suppressed", value: String(rows.filter((r) => r.status === "suppressed").length) },
      { label: "Pending digests", value: String(digests.length) },
    ]) +
      (digests.length ? '<div class="erp-btn-row">' + ui.btn("Flush digests now", { small: true, primary: true, act: "rt-flush" }) + "</div>" : "") +
      (dRows.length ? ui.card("Queued digests", ui.table([
        { key: "recipient", label: "Recipient", render: (r) => r.recipient }, { key: "channel", label: "Channel", render: (r) => r.channel },
        { key: "items", label: "Alerts", render: (r) => r.items }, { key: "since", label: "Held since", render: (r) => r.since },
      ], dRows, { scroll: true })) : "") +
      ui.table([
        { key: "at", label: "When", render: (r) => r.at },
        { key: "channel", label: "Channel", render: (r) => r.channel },
        { key: "recipient", label: "Recipient", render: (r) => r.recipient },
        { key: "alert", label: "Alert", render: (r) => r.alert },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "note", label: "Note", render: (r) => r.note },
      ], logRows, { scroll: true, emptyText: "No notifications sent yet." });
  }

  /* ── forms ── */

  function refOptions(list, labelKey) { return [{ value: "", label: "— none —" }].concat(asArr(list).map((x) => ({ value: x.id, label: x[labelKey] || x.id }))); }

  async function openRouteForm(provider, route, channels, recipients, sites, groups, severities) {
    const ui = ERP.ui, esc = ui.esc;
    const r = route || {};
    const sevOpts = [{ value: "", label: "— any —" }].concat(asArr(severities).map((s) => ({ value: s.id, label: s.label || s.id })));
    const body = ui.form(
      ui.text("label", "Label", r.label || "") +
      ui.number("priority", "Priority", r.priority == null ? 0 : r.priority, { hint: "Higher wins when several routes match." }) +
      ui.select("severityAtLeast", "Minimum severity", sevOpts, r.severityAtLeast || "") +
      ui.select("severityAtMost", "Maximum severity", sevOpts, r.severityAtMost || "") +
      '<div class="field"><label>Channels</label><div class="rmm-check-list">' + asArr(channels).map((c) => '<label class="erp-check"><input type="checkbox" data-rt-ch="' + esc(c.id) + '"' + (asArr(r.channelIds).map(String).indexOf(String(c.id)) !== -1 ? " checked" : "") + "> " + esc(c.label || c.id) + "</label>").join("") + "</div></div>" +
      '<div class="field"><label>Recipients</label><div class="rmm-check-list">' + asArr(recipients).map((x) => '<label class="erp-check"><input type="checkbox" data-rt-rcp="' + esc(x.id) + '"' + (asArr(r.recipients).map(String).indexOf(String(x.id)) !== -1 ? " checked" : "") + "> " + esc(x.name) + "</label>").join("") + "</div></div>" +
      '<div class="field"><label>Sites</label><div class="rmm-check-list">' + (asArr(sites).length ? asArr(sites).map((s) => '<label class="erp-check"><input type="checkbox" data-rt-site="' + esc(s.id) + '"' + (asArr(r.siteIds).map(String).indexOf(String(s.id)) !== -1 ? " checked" : "") + "> " + esc(s.name) + "</label>").join("") : '<span class="erp-sub">No sites.</span>') + "</div></div>" +
      '<div class="field"><label>Groups</label><div class="rmm-check-list">' + (asArr(groups).length ? asArr(groups).map((g) => '<label class="erp-check"><input type="checkbox" data-rt-grp="' + esc(g.id) + '"' + (asArr(r.groupIds).map(String).indexOf(String(g.id)) !== -1 ? " checked" : "") + "> " + esc(g.name) + "</label>").join("") : '<span class="erp-sub">No groups.</span>') + "</div></div>" +
      ui.text("tags", "Device tags", asArr(r.tags).join(", "), "comma separated") +
      '<div class="erp-btn-row">' + ui.check("enabled", "enabled", r.enabled !== false) + "</div>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(route ? "Save route" : "Create route", { small: true, primary: true, act: "rt-route-save" })
    );
    const m = ui.modal({ title: route ? "Edit route" : "New route", size: "lg", body });
    if (!m) return;
    m.querySelector("[data-act=rt-route-save]").onclick = async () => {
      const v = ui.collect(m, ["label", "priority", "severityAtLeast", "severityAtMost", "tags"]);
      const payload = {
        providerId: provider.id, label: v.label, priority: v.priority, severityAtLeast: v.severityAtLeast, severityAtMost: v.severityAtMost,
        tags: String(v.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
        channelIds: [...m.querySelectorAll("[data-rt-ch]")].filter((i) => i.checked).map((i) => i.getAttribute("data-rt-ch")),
        recipients: [...m.querySelectorAll("[data-rt-rcp]")].filter((i) => i.checked).map((i) => i.getAttribute("data-rt-rcp")),
        siteIds: [...m.querySelectorAll("[data-rt-site]")].filter((i) => i.checked).map((i) => i.getAttribute("data-rt-site")),
        groupIds: [...m.querySelectorAll("[data-rt-grp]")].filter((i) => i.checked).map((i) => i.getAttribute("data-rt-grp")),
        enabled: m.querySelector('[name="enabled"]').checked,
      };
      const res = route ? await RT.update("route", route.id, payload) : await RT.add("route", payload);
      if (res.error) return (ERP.toast)("Save failed: " + (res.error === "invalid" ? (res.errors || []).join("; ") : res.error), "error");
      ui.closeModal(); (ERP.toast)("Route saved"); paintHook();
    };
  }

  async function openRecipientForm(provider, rec, channels) {
    const ui = ERP.ui, esc = ui.esc;
    const r = rec || { quietHours: {} };
    const qh = asObj(r.quietHours);
    const body = ui.form(
      ui.text("name", "Name", r.name || "") +
      ui.text("email", "Email", r.email || "") +
      ui.text("phone", "Phone", r.phone || "") +
      ui.text("timezone", "Timezone", r.timezone || "UTC") +
      '<div class="field"><label>Channels</label><div class="rmm-check-list">' + asArr(channels).map((c) => '<label class="erp-check"><input type="checkbox" data-rt-ch="' + esc(c.id) + '"' + (asArr(r.channels).map(String).indexOf(String(c.id)) !== -1 ? " checked" : "") + "> " + esc(c.label || c.id) + "</label>").join("") + "</div></div>" +
      ui.select("digest", "Delivery", [{ value: "immediate", label: "Immediate" }, { value: "hourly", label: "Hourly digest" }, { value: "daily", label: "Daily digest" }], r.digest || "immediate") +
      '<div class="erp-btn-row">' + ui.check("qh_enabled", "quiet hours", !!qh.enabled) + ui.text("qh_start", "from", qh.start || "22:00") + ui.text("qh_end", "to", qh.end || "07:00") + "</div>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(rec ? "Save" : "Create", { small: true, primary: true, act: "rt-rcp-save" })
    );
    const m = ui.modal({ title: rec ? "Edit recipient" : "New recipient", body });
    if (!m) return;
    m.querySelector("[data-act=rt-rcp-save]").onclick = async () => {
      const v = ui.collect(m, ["name", "email", "phone", "timezone", "digest", "qh_enabled", "qh_start", "qh_end"]);
      const payload = {
        providerId: provider.id, name: v.name, email: v.email, phone: v.phone, timezone: v.timezone, digest: v.digest,
        channels: [...m.querySelectorAll("[data-rt-ch]")].filter((i) => i.checked).map((i) => i.getAttribute("data-rt-ch")),
        quietHours: { enabled: !!v.qh_enabled, start: v.qh_start, end: v.qh_end, days: asArr(qh.days) },
      };
      const res = rec ? await RT.update("recipient", rec.id, payload) : await RT.add("recipient", payload);
      if (res.error) return (ERP.toast)("Save failed: " + res.error, "error");
      ui.closeModal(); (ERP.toast)("Recipient saved"); paintHook();
    };
  }

  async function openEscalationForm(provider, policy, channels, recipients, severities) {
    const ui = ERP.ui, esc = ui.esc;
    const p = policy || { steps: [{ afterMinutes: 15, label: "", channelIds: [], recipients: [], useOnCall: true }] };
    const fs = { steps: clone(asArr(p.steps)) };
    function stepsHtml() {
      return asArr(fs.steps).map((s, i) =>
        '<div class="rmm-param" data-step="' + i + '"><div class="erp-btn-row"><b>Level ' + (i + 1) + "</b> " +
        '<input type="number" data-st-after="' + i + '" value="' + num(s.afterMinutes, 0) + '" style="width:90px" placeholder="minutes"> ' +
        '<input type="text" data-st-label="' + i + '" value="' + esc(s.label || "") + '" placeholder="what happens"> ' +
        '<label class="erp-check"><input type="checkbox" data-st-oncall="' + i + '"' + (s.useOnCall ? " checked" : "") + "> page on-call</label> " +
        ui.btn("✕", { small: true, danger: true, act: "rt-st-del", arg: String(i) }) + "</div>" +
        '<div class="field"><label>Channels</label><div class="rmm-check-list">' + asArr(channels).map((c) => '<label class="erp-check"><input type="checkbox" data-st-ch="' + i + "_" + esc(c.id) + '"' + (asArr(s.channelIds).map(String).indexOf(String(c.id)) !== -1 ? " checked" : "") + "> " + esc(c.label || c.id) + "</label>").join("") + "</div></div>" +
        '<div class="field"><label>Recipients</label><div class="rmm-check-list">' + asArr(recipients).map((x) => '<label class="erp-check"><input type="checkbox" data-st-rcp="' + i + "_" + esc(x.id) + '"' + (asArr(s.recipients).map(String).indexOf(String(x.id)) !== -1 ? " checked" : "") + "> " + esc(x.name) + "</label>").join("") + "</div></div></div>"
      ).join("") + '<div class="erp-btn-row">' + ui.btn("Add level", { small: true, act: "rt-st-add" }) + "</div>";
    }
    const body = ui.form(
      ui.text("label", "Label", p.label || "") +
      ui.select("severityAtLeast", "Applies at severity", [{ value: "", label: "— any —" }].concat(asArr(severities).map((s) => ({ value: s.id, label: s.label || s.id }))), p.severityAtLeast || "") +
      ui.number("repeatMinutes", "Repeat every (min)", p.repeatMinutes || 0, { hint: "0 = never repeat" }) +
      ui.number("maxRepeats", "Max repeats", p.maxRepeats == null ? 2 : p.maxRepeats) +
      '<h4 class="rmm-section-title">Escalation levels</h4><div data-steps>' + stepsHtml() + "</div>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(policy ? "Save" : "Create", { small: true, primary: true, act: "rt-esc-save" })
    );
    const m = ui.modal({ title: policy ? "Edit escalation policy" : "New escalation policy", size: "lg", body });
    if (!m) return;
    function sync() {
      fs.steps = [...m.querySelectorAll("[data-step]")].map((row, i) => ({
        afterMinutes: Number(row.querySelector("[data-st-after]").value) || 0,
        label: row.querySelector("[data-st-label]").value,
        useOnCall: row.querySelector("[data-st-oncall]").checked,
        channelIds: [...row.querySelectorAll("[data-st-ch]")].filter((x) => x.checked).map((x) => x.getAttribute("data-st-ch").split("_")[1]),
        recipients: [...row.querySelectorAll("[data-st-rcp]")].filter((x) => x.checked).map((x) => x.getAttribute("data-st-rcp").split("_")[1]),
      }));
    }
    m.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rt-st-add") { sync(); fs.steps.push({ afterMinutes: 60, label: "", channelIds: [], recipients: [], useOnCall: false }); m.querySelector("[data-steps]").innerHTML = stepsHtml(); }
      else if (act === "rt-st-del") { sync(); fs.steps.splice(Number(t.getAttribute("data-arg")), 1); m.querySelector("[data-steps]").innerHTML = stepsHtml(); }
    });
    m.querySelector("[data-act=rt-esc-save]").onclick = async () => {
      sync();
      const v = ui.collect(m, ["label", "severityAtLeast", "repeatMinutes", "maxRepeats"]);
      const payload = { providerId: provider.id, label: v.label, severityAtLeast: v.severityAtLeast, repeatMinutes: v.repeatMinutes, maxRepeats: v.maxRepeats, steps: fs.steps };
      const res = policy ? await RT.update("escalation", policy.id, payload) : await RT.add("escalation", payload);
      if (res.error) return (ERP.toast)("Save failed: " + res.error, "error");
      ui.closeModal(); (ERP.toast)("Escalation policy saved"); paintHook();
    };
  }

  async function openOnCallForm(provider, rota) {
    const ui = ERP.ui, esc = ui.esc;
    const r = rota || { members: [{ name: "", recipientId: "", contact: "" }] };
    const fs = { members: clone(asArr(r.members)) };
    function membersHtml() {
      return asArr(fs.members).map((mem, i) =>
        '<div class="erp-btn-row" data-onc-member="' + i + '"><input type="text" data-onc-name="' + i + '" value="' + esc(mem.name || "") + '" placeholder="name">' +
        '<input type="text" data-onc-rcp="' + i + '" value="' + esc(mem.recipientId || "") + '" placeholder="recipient id">' +
        '<input type="text" data-onc-contact="' + i + '" value="' + esc(mem.contact || "") + '" placeholder="contact"> ' +
        ui.btn("✕", { small: true, danger: true, act: "rt-onc-m-del", arg: String(i) }) + "</div>").join("") +
        '<div class="erp-btn-row">' + ui.btn("Add member", { small: true, act: "rt-onc-m-add" }) + "</div>";
    }
    const body = ui.form(
      ui.text("label", "Label", r.label || "") +
      ui.number("rotationMinutes", "Rotate every (min)", r.rotationMinutes || 1440, { hint: "1440 = one day per person" }) +
      ui.text("startsAt", "Rotation start (ISO)", r.startsAt || now()) +
      '<h4 class="rmm-section-title">Members</h4><div data-members>' + membersHtml() + "</div>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(rota ? "Save" : "Create", { small: true, primary: true, act: "rt-onc-save" })
    );
    const m = ui.modal({ title: rota ? "Edit rotation" : "New rotation", body });
    if (!m) return;
    function sync() {
      fs.members = [...m.querySelectorAll("[data-onc-member]")].map((row, i) => ({
        name: row.querySelector("[data-onc-name]").value, recipientId: row.querySelector("[data-onc-rcp]").value, contact: row.querySelector("[data-onc-contact]").value,
      }));
    }
    m.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (act === "rt-onc-m-add") { sync(); fs.members.push({ name: "", recipientId: "", contact: "" }); m.querySelector("[data-members]").innerHTML = membersHtml(); }
      else if (act === "rt-onc-m-del") { sync(); fs.members.splice(Number(t.getAttribute("data-arg")), 1); m.querySelector("[data-members]").innerHTML = membersHtml(); }
    });
    m.querySelector("[data-act=rt-onc-save]").onclick = async () => {
      sync();
      const v = ui.collect(m, ["label", "rotationMinutes", "startsAt"]);
      const payload = { providerId: provider.id, label: v.label, rotationMinutes: v.rotationMinutes, startsAt: v.startsAt, members: fs.members };
      const res = rota ? await RT.update("oncall", rota.id, payload) : await RT.add("oncall", payload);
      if (res.error) return (ERP.toast)("Save failed: " + res.error, "error");
      ui.closeModal(); (ERP.toast)("Rotation saved"); paintHook();
    };
  }

  /* ── mount ── */

  let paintHook = () => {};
  const SUBTABS = ["routes", "escalations", "recipients", "oncall", "log"];

  RT.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const provider = opts.provider;
    if (!provider) { host.innerHTML = ui.alert("No provider selected.", "warn"); return null; }
    const state = { tab: SUBTABS.indexOf(opts.tab) !== -1 ? opts.tab : "routes" };

    async function paint() {
      const chans = await channelsOf();
      const sevs = await severitiesOf();
      const recs = await RT.list("recipient", provider.id);
      const stats = await RT.stats(provider.id);
      const tabs = ui.tabs([
        { id: "routes", label: "Routes", badge: String(stats.routes) },
        { id: "escalations", label: "Escalation", badge: String(stats.escalations) },
        { id: "recipients", label: "Recipients", badge: String(stats.recipients) },
        { id: "oncall", label: "On-call" },
        { id: "log", label: "Notification log" },
      ], state.tab);
      host.innerHTML = '<div class="rmm-routing-inner">' + tabs.html + "</div>";
      ui.showTab(host.querySelector(".rmm-routing-inner"), state.tab);
      const panel = host.querySelector(".rmm-routing-inner").querySelector('[data-panel="' + state.tab + '"]');
      if (state.tab === "routes") {
        panel.innerHTML = '<div class="erp-btn-row">' + ui.btn("New route", { small: true, primary: true, act: "rt-route-add" }) + "</div>" + (await routesPanel(provider, chans, recs));
      } else if (state.tab === "escalations") {
        panel.innerHTML = '<div class="erp-btn-row">' + ui.btn("New policy", { small: true, primary: true, act: "rt-esc-add" }) + "</div>" + (await escalationsPanel(provider, chans, recs));
      } else if (state.tab === "recipients") {
        panel.innerHTML = '<div class="erp-btn-row">' + ui.btn("New recipient", { small: true, primary: true, act: "rt-rcp-add" }) + "</div>" + (await recipientsPanel(provider, chans));
      } else if (state.tab === "oncall") {
        panel.innerHTML = '<div class="erp-btn-row">' + ui.btn("New rotation", { small: true, primary: true, act: "rt-onc-add" }) + "</div>" + (await oncallPanel(provider));
      } else {
        panel.innerHTML = await logPanel(provider);
      }
    }
    paintHook = paint;

    ui.bind(host, "click", ".erp-tabs [data-tab]", (t) => { state.tab = t.getAttribute("data-tab"); paint(); });
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      const chans = await channelsOf();
      const sevs = await severitiesOf();
      const recs = await RT.list("recipient", provider.id);
      const toast = opts.toast || ERP.toast;
      if (act === "rt-route-add") return openRouteForm(provider, null, chans, recs, asArr(provider.sites), asArr(provider.deviceGroups), sevs);
      if (act === "rt-route-edit") return openRouteForm(provider, (await RT.get("route", arg)), chans, recs, asArr(provider.sites), asArr(provider.deviceGroups), sevs);
      if (act === "rt-route-toggle") { const r = await RT.get("route", arg); const w = await RT.update("route", arg, { enabled: !(r && r.enabled !== false) }); if (w.error) return toast("Failed: " + w.error, "error"); return paint(); }
      if (act === "rt-route-del") { const ok = await ui.confirm({ title: "Delete route", message: "Remove this routing rule?", danger: true, okLabel: "Delete" }); if (!ok) return; await RT.remove("route", arg); return paint(); }
      if (act === "rt-esc-add") return openEscalationForm(provider, null, chans, recs, sevs);
      if (act === "rt-esc-edit") return openEscalationForm(provider, (await RT.get("escalation", arg)), chans, recs, sevs);
      if (act === "rt-esc-del") { const ok = await ui.confirm({ title: "Delete policy", message: "Remove this escalation policy?", danger: true, okLabel: "Delete" }); if (!ok) return; await RT.remove("escalation", arg); return paint(); }
      if (act === "rt-rcp-add") return openRecipientForm(provider, null, chans);
      if (act === "rt-rcp-edit") return openRecipientForm(provider, (await RT.get("recipient", arg)), chans);
      if (act === "rt-rcp-del") { const ok = await ui.confirm({ title: "Delete recipient", message: "Remove this recipient?", danger: true, okLabel: "Delete" }); if (!ok) return; await RT.remove("recipient", arg); return paint(); }
      if (act === "rt-onc-add") return openOnCallForm(provider, null);
      if (act === "rt-onc-edit") return openOnCallForm(provider, (await RT.get("oncall", arg)));
      if (act === "rt-onc-del") { const ok = await ui.confirm({ title: "Delete rotation", message: "Remove this on-call rotation?", danger: true, okLabel: "Delete" }); if (!ok) return; await RT.remove("oncall", arg); return paint(); }
      if (act === "rt-flush") { const r = await RT.flushDigests(provider.id, now()); if (r.error) return toast("Flush failed: " + r.error, "error"); toast("Sent " + asArr(r.sent).length + " digest(s)"); return paint(); }
    });
    await paint();
    return state;
  };

  RT.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    host.innerHTML = "";
    return RT.renderPanel(host, opts);
  };
})();
