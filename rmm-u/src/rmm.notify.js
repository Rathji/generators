/* ============================================================
   RMM-U — notification primitive  (supports Phase 4 · Task 22; the
   full routing/escalation station lands in Phase 5 · Task 25)

   `window.ERP.notify` is the smallest thing the automation engine
   needs to "send a notification": it takes a message + a target
   channel from the master-config `channels` catalogue, applies the
   channel's own filters (minimum severity, business-hours-only,
   repeat cooldown) and the active maintenance windows, then records
   a notification in the hidden `rmm-v1-notifications` document.

   Delivery for a channel that has a URL target (webhook / Slack /
   Teams / in-console bridge) is a best-effort POST. The sender is
   swappable (`NOT.sender`) so tests never touch the network, and a
   delivery failure never throws — the record simply carries the
   error. This keeps the automation engine's action contract honest:
   "send a notification" always produces an auditable record, whether
   or not the transport was reachable.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store) return;
  const store = ERP.store;
  const NOT = (ERP.notify = {});

  NOT.MODULE = "notifications";

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const masterConfig = () => window.ERP.masterConfig || null;

  const CAP = () => Math.max(50, num(cfg("rmm.notificationHistory", 500), 500));

  async function load() {
    const r = await store.loadDoc(NOT.MODULE);
    return asArr(r.error ? [] : r.records);
  }
  async function save(list) { return store.saveDoc(NOT.MODULE, list); }
  NOT.load = load;

  /* ─────────────────────── transport ─────────────────────── */

  /* Swappable: tests install an in-memory sender. */
  NOT.sender = async function (d) {
    const fn = (window.root && typeof window.root.superFetch === "function")
      ? window.root.superFetch
      : (typeof fetch === "function" ? fetch : null);
    if (!fn) return { ok: false, error: "no_transport" };
    const res = await fn(d.url, { method: d.method || "POST", headers: d.headers || {}, body: d.body });
    return { ok: res.ok !== false, status: res.status };
  };

  /* ─────────────────────── severity helpers ─────────────────────── */

  async function severityRank(id) {
    const M = masterConfig();
    if (!M) return null;
    const list = await M.section("severities");
    const it = list.find((s) => String(s.id) === String(id));
    return it ? num(it.rank, 0) : null;
  }
  NOT.severityRank = severityRank;

  /* ─────────────────────── queue / send ─────────────────────── */

  /* opts: { providerId, channelId, severityId, subject, message, at,
            deviceId, scope, meta, force }
     Returns { ok, notification } or { error, reason }. */
  NOT.queue = async function (opts) {
    opts = opts || {};
    const providerId = opts.providerId;
    const M = masterConfig();
    if (!M) return { error: "no_master_config" };
    const channels = await M.section("channels");
    const channel = opts.channelId
      ? channels.find((c) => String(c.id) === String(opts.channelId))
      : channels.find((c) => c.enabled !== false);
    const record = {
      kind: "notification",
      id: rid("ntf"),
      providerId: providerId || null,
      channelId: channel ? channel.id : (opts.channelId || null),
      channelType: channel ? channel.type : "in-console",
      target: channel ? S(channel.target, 400) : "",
      severityId: opts.severityId || null,
      subject: S(opts.subject || "RMM notification", 200),
      message: S(opts.message, 2000),
      deviceId: opts.deviceId ? String(opts.deviceId) : null,
      at: opts.at || now(),
      queuedAt: now(),
      status: "queued",
      reason: "",
      attempts: 0,
      deliveredAt: "",
      meta: asObj(opts.meta),
    };
    if (!channel || channel.enabled === false) { record.status = "suppressed"; record.reason = "channel disabled or missing"; return finalize(record); }
    if (opts.force !== true) {
      /* minimum severity gate */
      const minRank = await severityRank(channel.minSeverity);
      const rank = await severityRank(record.severityId || (await M.settings()).defaultSeverity);
      if (minRank != null && rank != null && rank < minRank) { record.status = "suppressed"; record.reason = "below channel minimum severity"; return finalize(record); }
      /* business-hours filter */
      if (channel.onlyOutsideHours) {
        const inHours = await M.inBusinessHours(record.at, channel.calendarId || null);
        if (inHours) { record.status = "suppressed"; record.reason = "inside business hours"; return finalize(record); }
      }
      /* repeat cooldown */
      const cool = num(channel.rateLimitMinutes, 0);
      if (cool > 0) {
        const rows = await load();
        const since = Date.parse(record.at) - cool * 60000;
        const dup = rows.some((r) => r.kind === "notification" && String(r.channelId) === String(channel.id)
          && String(r.deviceId || "") === String(record.deviceId || "")
          && r.status !== "suppressed" && Date.parse(r.at) >= since);
        if (dup) { record.status = "suppressed"; record.reason = "within repeat cooldown"; return finalize(record); }
      }
      /* maintenance suppression */
      const SCH = window.ERP.schedules;
      if (SCH && typeof SCH.isSuppressed === "function" && record.deviceId) {
        try {
          const s = await SCH.isSuppressed(providerId, await SCH.scopeFor(providerId, record.deviceId), record.at, record.severityId);
          if (s && s.suppressed) { record.status = "suppressed"; record.reason = "maintenance window"; return finalize(record); }
        } catch (e) {}
      }
    }
    return finalize(record);
  };

  async function finalize(record) {
    const rows = await load();
    rows.push(record);
    const trimmed = rows.slice(Math.max(0, rows.length - CAP()));
    const w = await save(trimmed);
    if (w && w.error) return { error: w.error, message: w.message, notification: record };
    return { ok: true, notification: clone(record) };
  }

  /* Queue then attempt delivery. */
  NOT.send = async function (opts) {
    const q = await NOT.queue(opts);
    if (q.error || !q.notification) return q;
    const rec = q.notification;
    if (rec.status !== "queued") return q;
    return NOT.deliver(rec.id);
  };

  NOT.deliver = async function (id) {
    const rows = await load();
    const rec = rows.find((r) => r.kind === "notification" && String(r.id) === String(id));
    if (!rec) return { error: "not_found", id };
    rec.attempts = num(rec.attempts, 0) + 1;
    if (!rec.target || /in-console|push|email|sms|psa-ticket|pagerduty/.test(String(rec.channelType))) {
      rec.status = "sent";
      rec.deliveredAt = now();
      rec.reason = rec.target ? "" : "recorded in-console";
    } else {
      const body = JSON.stringify({ subject: rec.subject, message: rec.message, severity: rec.severityId, deviceId: rec.deviceId, providerId: rec.providerId, at: rec.at });
      try {
        const res = await NOT.sender({ url: rec.target, method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (res && res.ok) { rec.status = "sent"; rec.deliveredAt = now(); rec.reason = ""; }
        else { rec.status = "failed"; rec.reason = "transport error"; }
      } catch (e) {
        rec.status = "failed";
        rec.reason = (e && e.message) || "transport threw";
      }
    }
    const w = await save(rows);
    if (w && w.error) return { error: w.error, notification: rec };
    return { ok: true, notification: clone(rec) };
  };

  /* ─────────────────────── reads ─────────────────────── */

  NOT.list = async function (providerId, opts) {
    opts = opts || {};
    let rows = (await load()).filter((r) => r.kind === "notification");
    if (providerId) rows = rows.filter((r) => String(r.providerId) === String(providerId));
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return clone(rows);
  };

  NOT.get = async function (id) {
    const rows = await load();
    const rec = rows.find((r) => r.kind === "notification" && String(r.id) === String(id));
    return rec ? clone(rec) : null;
  };

  NOT.stats = async function (providerId) {
    const rows = await NOT.list(providerId, {});
    const byStatus = {};
    const byChannel = {};
    rows.forEach((r) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byChannel[r.channelType] = (byChannel[r.channelType] || 0) + 1;
    });
    return { total: rows.length, byStatus, byChannel, lastAt: rows.length ? rows[0].at : null, docName: store.docName(NOT.MODULE) };
  };

  NOT.ack = async function (id) {
    const rows = await load();
    const rec = rows.find((r) => r.kind === "notification" && String(r.id) === String(id));
    if (!rec) return { error: "not_found", id };
    rec.ackAt = now();
    await save(rows);
    return { ok: true, notification: clone(rec) };
  };

  NOT.clear = async function (providerId) {
    const rows = await load();
    const kept = providerId ? rows.filter((r) => String(r.providerId) !== String(providerId)) : [];
    const w = await save(kept);
    if (w && w.error) return { error: w.error };
    return { ok: true, removed: rows.length - kept.length };
  };

  /* A tiny panel used by the automation station's run detail. */
  NOT.renderList = function (items) {
    const ui = ERP.ui, esc = ui.esc;
    const rows = asArr(items).map((r) => ({
      at: esc(ui.dateTime(r.at)),
      channel: ui.badge(r.channelType || "—", "info"),
      subject: esc(r.subject || ""),
      status: ui.badge(r.status || "", r.status === "sent" ? "success" : r.status === "failed" ? "danger" : "muted"),
      reason: '<span class="erp-sub">' + esc(r.reason || "") + "</span>",
    }));
    return ui.table([
      { key: "at", label: "When", render: (r) => r.at },
      { key: "channel", label: "Channel", render: (r) => r.channel },
      { key: "subject", label: "Subject", render: (r) => r.subject },
      { key: "status", label: "Status", render: (r) => r.status },
      { key: "reason", label: "Note", render: (r) => r.reason },
    ], rows, { scroll: true, emptyText: "No notifications recorded." });
  };

  NOT.statsText = async function (providerId) {
    const s = await NOT.stats(providerId);
    return s.total + " notification(s) — " + Object.keys(s.byStatus).map((k) => s.byStatus[k] + " " + k).join(", ");
  };
})();
