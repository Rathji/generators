/* ============================================================
   RMM-U — alert triage workspace  (Phase 5 · Task 27)

   The alert station answers "what is broken"; the triage workspace
   answers "what should I work on next, and am I getting faster at it".

   Every active alert is scored by a transparent, deterministic
   priority model — severity, how long it has been firing, whether it
   is unacknowledged, flapping, recurring, suppressed or already owned
   — so the queue order is explainable rather than a black box. Each
   row can show exactly which factors produced its score.

   The queue groups by device, site, monitor, severity, device-group
   or assignee, filters down to a single site/monitor/owner, and
   supports bulk acknowledge / assign / resolve / snooze across the
   whole selection (or every row in a group).

   It also keeps the numbers that tell you whether the process works:
   alert volume over time, mean time to acknowledge (MTTA), mean time
   to resolve (MTTR), the share acknowledged inside the target, and
   the worst offenders by device and monitor — all drawn from the
   alert records' own timestamps, so nothing is estimated.

   `TR` is read-only over `provider.alerts`; every mutation goes
   through the alert lifecycle (`ERP.alerts`) so the timeline, hooks,
   notifications and PSA bridge all still run.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.alerts || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const AL = ERP.alerts;
  const TR = (ERP.triage = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 300);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const msOf = (v) => { const t = Date.parse(v); return isFinite(t) ? t : null; };
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const windowDays = () => Math.max(1, num(cfg("rmm.triageWindowDays", 30), 30));
  const ackTargetMinutes = () => Math.max(1, num(cfg("rmm.triageAckTargetMinutes", 15), 15));

  /* ═══════════════════════ priority model ═══════════════════════ */

  TR.GROUPINGS = [
    { id: "none", label: "No grouping" },
    { id: "device", label: "Device" },
    { id: "site", label: "Site" },
    { id: "monitor", label: "Monitor" },
    { id: "severity", label: "Severity" },
    { id: "group", label: "Device group" },
    { id: "assignee", label: "Assignee" },
  ];
  TR.groupingIds = () => TR.GROUPINGS.map((g) => g.id);
  TR.groupingLabel = (id) => (TR.GROUPINGS.find((g) => g.id === id) || TR.GROUPINGS[0]).label;

  TR.SORTS = [
    { id: "priority", label: "Priority" },
    { id: "severity", label: "Severity" },
    { id: "newest", label: "Newest first" },
    { id: "oldest", label: "Oldest first" },
    { id: "updated", label: "Recently seen" },
  ];
  TR.sortIds = () => TR.SORTS.map((s) => s.id);

  /* Weights, not magic numbers. A critical unacknowledged alert starts
     at 70 (45 severity + 25 unacknowledged) and climbs with age, which
     lands it in P1; an acknowledged informational alert sits in P4. */
  TR.WEIGHTS = {
    severity: 1.5, unacknowledged: 25, agePerHour: 1, ageCap: 20,
    flapping: 10, occurrence: 2, occurrenceCap: 10,
    assigned: -6, snoozed: -40, suppressed: -15, ticket: 4,
  };

  TR.priorityBand = function (score) {
    if (score >= 70) return "P1";
    if (score >= 45) return "P2";
    if (score >= 25) return "P3";
    return "P4";
  };
  TR.bandTone = function (band) {
    return band === "P1" ? "danger" : band === "P2" ? "warn" : band === "P3" ? "info" : "muted";
  };
  TR.bandLabel = function (band) {
    return band === "P1" ? "P1 · immediate" : band === "P2" ? "P2 · high" : band === "P3" ? "P3 · normal" : "P4 · low";
  };

  /* Returns { score, band, factors:[{label, points}] }. Deterministic:
     the same alert and instant always score the same. */
  TR.priority = function (alert, at) {
    const a = asObj(alert);
    const atMs = msOf(at) || Date.now();
    const w = asObj(TR.WEIGHTS);
    const factors = [];
    const push = (label, points) => { if (points) factors.push({ label, points: Math.round(points * 10) / 10 }); };
    const rank = num(a.severityRank, 0);
    push("Severity · " + (a.severityLabel || a.severityId || "—"), rank * num(w.severity, 0));
    if (a.state === "firing") push("Unacknowledged", num(w.unacknowledged, 0));
    const fired = msOf(a.firstFiredAt);
    const hours = fired ? Math.max(0, (atMs - fired) / HOUR) : 0;
    push("Age · " + (hours < 48 ? hours.toFixed(1) + "h" : (hours / 24).toFixed(1) + "d"), Math.min(num(w.ageCap, 0), hours * num(w.agePerHour, 0)));
    if (a.flapping) push("Flapping", num(w.flapping, 0));
    const occ = num(a.occurrences, 1);
    if (occ > 1) push("Recurring · " + occ + "×", Math.min(num(w.occurrenceCap, 0), (occ - 1) * num(w.occurrence, 0)));
    if (a.ticketId && !/resolved|closed/.test(low(a.ticketStatus))) push("Open ticket", num(w.ticket, 0));
    if (a.assignedToName) push("Already assigned", num(w.assigned, 0));
    if (AL.isSnoozed(a, at)) push("Snoozed", num(w.snoozed, 0));
    if (a.suppressed) push("Maintenance-suppressed", num(w.suppressed, 0));
    let score = factors.reduce((s, f) => s + f.points, 0);
    score = Math.max(0, Math.round(score * 10) / 10);
    return { score, band: TR.priorityBand(score), factors };
  };

  /* ═══════════════════════ assignees ═══════════════════════ */

  TR.normalizeAssignee = (v) => AL.normalizeAssignee(v);

  /* Everyone who can be picked as an owner: the signed-in teammate,
     any connected peers, names already used on alerts, plus extras. */
  TR.assignees = function (provider, opts) {
    opts = opts || {};
    const out = new Map();
    const put = (id, name) => {
      const nm = S(name || id, 120);
      if (!nm) return;
      const key = low(id || nm);
      if (!out.has(key)) out.set(key, { id: S(id || nm, 120), name: nm });
    };
    try {
      const tm = ERP.team;
      if (tm) {
        const me = tm.me;
        if (me) put(me.userId, me.displayName || me.userId);
        asArr(typeof tm.peersList === "function" ? tm.peersList() : tm.peersList).forEach((p) => put(p.userId, p.displayName || p.userId));
      }
    } catch (e) {}
    asArr(opts.extra).forEach((x) => put(asObj(x).id, asObj(x).name));
    asArr(asObj(provider).alerts).forEach((a) => { if (a.assignedTo || a.assignedToName) put(a.assignedTo || a.assignedToName, a.assignedToName || a.assignedTo); });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  /* ═══════════════════════ the queue ═══════════════════════ */

  function compare(sort, at) {
    return function (a, b) {
      if (sort === "severity") return (num(b.severityRank, 0) - num(a.severityRank, 0)) || ((msOf(a.firstFiredAt) || 0) - (msOf(b.firstFiredAt) || 0));
      if (sort === "newest") return (msOf(b.firstFiredAt) || 0) - (msOf(a.firstFiredAt) || 0);
      if (sort === "oldest") return (msOf(a.firstFiredAt) || 0) - (msOf(b.firstFiredAt) || 0);
      if (sort === "updated") return (msOf(b.lastSeenAt) || 0) - (msOf(a.lastSeenAt) || 0);
      return (num(b.priorityScore, 0) - num(a.priorityScore, 0)) || ((msOf(a.firstFiredAt) || 0) - (msOf(b.firstFiredAt) || 0));
    };
  }

  TR.countsOf = function (provider) {
    const rows = asArr(asObj(provider).alerts);
    const active = rows.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
    const bySeverity = {};
    active.forEach((a) => { bySeverity[a.severityId] = (bySeverity[a.severityId] || 0) + 1; });
    return {
      total: rows.length, active: active.length,
      firing: active.filter((a) => a.state === "firing").length,
      acknowledged: active.filter((a) => a.state === "acknowledged").length,
      unassigned: active.filter((a) => !a.assignedToName).length,
      assigned: active.filter((a) => !!a.assignedToName).length,
      critical: active.filter((a) => num(a.severityRank, 0) >= 30).length,
      snoozed: active.filter((a) => !!a.snoozeUntil).length,
      suppressed: active.filter((a) => a.suppressed).length,
      flapping: active.filter((a) => a.flapping).length,
      bySeverity,
    };
  };

  /* The prioritized queue. opts: { at, state|active, severityId, siteId,
     groupId, deviceId, monitorId, assignee ("" | "__unassigned__" | id),
     q, sort, limit }. Every row carries priorityScore / priorityBand /
     priorityFactors so the UI can explain the order. */
  TR.queue = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const at = opts.at || now();
    let rows = asArr(provider.alerts).map((a) => Object.assign({ kind: "alert" }, a));
    if (opts.state) rows = rows.filter((a) => a.state === opts.state);
    else if (opts.active !== false) rows = rows.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
    if (opts.severityId) rows = rows.filter((a) => String(a.severityId) === String(opts.severityId));
    if (opts.siteId) rows = rows.filter((a) => String(a.siteId || "") === String(opts.siteId));
    if (opts.groupId) rows = rows.filter((a) => asArr(a.groupIds).map(String).indexOf(String(opts.groupId)) !== -1);
    if (opts.deviceId) rows = rows.filter((a) => String(a.deviceId) === String(opts.deviceId));
    if (opts.monitorId) rows = rows.filter((a) => String(a.monitorId) === String(opts.monitorId));
    if (opts.assignee === "__unassigned__") rows = rows.filter((a) => !a.assignedToName);
    else if (opts.assignee) rows = rows.filter((a) => String(a.assignedTo || "") === String(opts.assignee) || low(a.assignedToName) === low(opts.assignee));
    if (opts.q) {
      const q = low(opts.q);
      rows = rows.filter((a) => [a.hostname, a.subject, a.monitorName, a.siteName, a.message, a.severityLabel, a.assignedToName].some((x) => low(x).indexOf(q) !== -1));
    }
    const scored = rows.map((a) => {
      const p = TR.priority(a, at);
      return Object.assign({}, a, { priorityScore: p.score, priorityBand: p.band, priorityFactors: p.factors });
    });
    scored.sort(compare(opts.sort || "priority", at));
    if (opts.limit) scored.splice(Math.max(0, num(opts.limit, scored.length)));
    return { provider, at, rows: scored, counts: TR.countsOf(provider) };
  };

  /* Bucket prioritized rows for display. `group` expands an alert into
     each of its device groups; everything else uses a single key. */
  TR.group = function (rows, by) {
    by = by || "none";
    rows = asArr(rows);
    if (by === "none") return rows.length ? [{ key: "all", label: "All alerts", rows: rows.slice() }] : [];
    const map = new Map();
    const add = (key, label, row) => {
      const k = String(key == null ? "none" : key);
      let g = map.get(k);
      if (!g) { g = { key: k, label: S(label, 160) || k, rows: [] }; map.set(k, g); }
      g.rows.push(row);
    };
    rows.forEach((r) => {
      if (by === "device") add(r.deviceId, r.hostname || r.deviceId, r);
      else if (by === "site") add(r.siteId || "none", r.siteName || "No site", r);
      else if (by === "monitor") add(r.monitorId || "none", r.monitorName || r.subject || "Unknown monitor", r);
      else if (by === "severity") add(r.severityId || "none", r.severityLabel || r.severityId || "—", r);
      else if (by === "assignee") add(r.assignedTo || "none", r.assignedToName || "Unassigned", r);
      else if (by === "group") {
        const names = asArr(r.groupNames), ids = asArr(r.groupIds);
        if (!names.length) add("none", "No device group", r);
        else names.forEach((nm, i) => add(ids[i] || nm, nm, r));
      } else add("all", "All alerts", r);
    });
    return [...map.values()].map((g) => Object.assign(g, {
      count: g.rows.length,
      worstRank: g.rows.reduce((m, r) => Math.max(m, num(r.severityRank, 0)), 0),
      topScore: g.rows.reduce((m, r) => Math.max(m, num(r.priorityScore, 0)), 0),
      oldestAt: g.rows.reduce((a, r) => { const t = msOf(r.firstFiredAt) || 0; return (!a || (t && t < a)) ? t : a; }, null),
    })).sort((a, b) => b.topScore - a.topScore || b.count - a.count || String(a.label).localeCompare(String(b.label)));
  };

  /* ═══════════════════════ bulk actions ═══════════════════════ */

  TR.ACTIONS = ["acknowledge", "assign", "unassign", "resolve", "snooze", "unsnooze"];

  /* Apply one action to many alerts through the lifecycle. Returns a
     per-alert result so the UI can report partial success honestly. */
  TR.bulk = async function (providerId, alertIds, action, opts) {
    opts = opts || {};
    const ids = asArr(alertIds).map(String).filter(Boolean);
    if (!ids.length) return { error: "no_alerts", action, requested: 0 };
    if (TR.ACTIONS.indexOf(action) === -1) return { error: "unknown_action", action };
    if (action === "assign" && !AL.normalizeAssignee(opts.assignee)) return { error: "no_assignee", action };
    const actor = opts.actor || AL.actorName();
    const out = { ok: true, action, requested: ids.length, succeeded: 0, failed: 0, results: [] };
    for (const id of ids) {
      let r;
      try {
        if (action === "acknowledge") r = await AL.acknowledge(providerId, id, actor);
        else if (action === "resolve") r = await AL.resolve(providerId, id, { actor, note: opts.note });
        else if (action === "assign") r = await AL.assign(providerId, id, opts.assignee, actor);
        else if (action === "unassign") r = await AL.unassign(providerId, id, actor);
        else if (action === "snooze") r = await AL.snooze(providerId, id, opts.minutes || opts.until || 60, actor);
        else if (action === "unsnooze") r = await AL.unsnooze(providerId, id, actor);
      } catch (e) { r = { error: (e && e.message) || String(e) }; }
      const ok = !!(r && !r.error);
      if (ok) out.succeeded += 1; else out.failed += 1;
      out.results.push({ id, ok, error: (r && r.error) || null });
    }
    out.ok = out.failed === 0;
    return out;
  };

  /* ═══════════════════════ metrics ═══════════════════════ */

  function percentile(sorted, p) {
    if (!sorted.length) return null;
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function durationStats(samples) {
    const s = asArr(samples).filter((v) => isFinite(v) && v >= 0).sort((a, b) => a - b);
    if (!s.length) return { count: 0, avg: null, median: null, p90: null, min: null, max: null };
    return {
      count: s.length,
      avg: s.reduce((a, b) => a + b, 0) / s.length,
      median: percentile(s, 0.5),
      p90: percentile(s, 0.9),
      min: s[0], max: s[s.length - 1],
    };
  }
  TR.durationStats = durationStats;

  /* Volume + response-time metrics. Window defaults to the last
     `config.rmm.triageWindowDays` days; pass opts.days / opts.from /
     opts.to to override. All figures come from the alert records'
     own fired / acknowledged / resolved timestamps. */
  TR.metrics = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const at = opts.at || now();
    const atMs = msOf(at) || Date.now();
    const days = Math.max(1, num(opts.days, windowDays()));
    const fromMs = msOf(opts.from) || (atMs - days * DAY);
    const toMs = msOf(opts.to) || atMs;
    const target = num(opts.ackTargetMinutes, ackTargetMinutes()) * MIN;

    const all = asArr(provider.alerts);
    const inWindow = all.filter((a) => { const t = msOf(a.firstFiredAt); return t != null && t >= fromMs && t <= toMs; });

    const ackSamples = [], resSamples = [], bySeverity = {}, bySite = {}, byDevice = {}, byMonitor = {}, byDay = {};
    let ackWithinSla = 0, ackEligible = 0;

    inWindow.forEach((a) => {
      const fired = msOf(a.firstFiredAt);
      const sev = a.severityId || "unknown";
      const site = a.siteId || "none";
      const dev = a.deviceId || "none";
      const mon = a.monitorId || "none";
      const day = new Date(fired).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;

      const bump = (obj, key, extra) => {
        let e = obj[key];
        if (!e) { e = { key, count: 0, label: extra.label || key }; obj[key] = e; }
        e.count += 1;
        if (extra.rank != null) e.rank = Math.max(num(e.rank, 0), extra.rank);
        if (extra.siteName) e.label = extra.siteName;
        if (extra.hostname) e.label = extra.hostname;
        if (extra.monitorName) e.label = extra.monitorName;
      };
      bump(bySeverity, sev, { label: a.severityLabel || sev, rank: num(a.severityRank, 0) });
      bump(bySite, site, { label: a.siteName || "No site" });
      bump(byDevice, dev, { label: a.hostname || dev });
      bump(byMonitor, mon, { label: a.monitorName || a.subject || mon });

      const ack = msOf(a.acknowledgedAt);
      if (ack != null && ack >= fired) {
        ackSamples.push(ack - fired);
        ackEligible += 1;
        if (ack - fired <= target) ackWithinSla += 1;
        const e = bySeverity[sev]; if (e) { e.ackSum = (e.ackSum || 0) + (ack - fired); e.ackCount = (e.ackCount || 0) + 1; }
      }
      const res = msOf(a.resolvedAt);
      if (res != null && res >= fired) {
        resSamples.push(res - fired);
        const e = bySeverity[sev]; if (e) { e.resSum = (e.resSum || 0) + (res - fired); e.resCount = (e.resCount || 0) + 1; }
      }
    });

    const active = all.filter((a) => AL.ACTIVE.indexOf(a.state) !== -1);
    active.sort((a, b) => (msOf(a.firstFiredAt) || 0) - (msOf(b.firstFiredAt) || 0));
    const oldest = active[0] || null;
    const mtta = durationStats(ackSamples);
    const mttr = durationStats(resSamples);

    const dayKeys = Object.keys(byDay).sort();
    const volume = { byDay: dayKeys.map((d) => ({ date: d, count: byDay[d] })), total: inWindow.length };
    const ranked = (obj, n) => Object.values(obj).sort((a, b) => b.count - a.count).slice(0, n || 5);

    return {
      providerId, at, window: { days, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      volume,
      backlog: {
        total: all.length, active: active.length,
        unassigned: active.filter((a) => !a.assignedToName).length,
        firing: active.filter((a) => a.state === "firing").length,
        critical: active.filter((a) => num(a.severityRank, 0) >= 30).length,
        flapping: active.filter((a) => a.flapping).length,
        oldest: oldest ? { id: oldest.id, hostname: oldest.hostname, subject: oldest.subject, firstFiredAt: oldest.firstFiredAt, ageMinutes: Math.round((atMs - (msOf(oldest.firstFiredAt) || atMs)) / MIN) } : null,
      },
      mtta: Object.assign({}, mtta, { targetMinutes: target / MIN, withinSla: ackWithinSla, eligible: ackEligible, slaPercent: ackEligible ? Math.round((ackWithinSla / ackEligible) * 100) : null }),
      mttr,
      bySeverity: Object.values(bySeverity).sort((a, b) => num(b.rank, 0) - num(a.rank, 0)).map((e) => ({
        severityId: e.key, label: e.label, count: e.count,
        mtta: e.ackCount ? e.ackSum / e.ackCount : null, mttr: e.resCount ? e.resSum / e.resCount : null,
      })),
      topDevices: ranked(byDevice, 5),
      topMonitors: ranked(byMonitor, 5),
      bySite: ranked(bySite, 20),
    };
  };

  TR.formatDuration = function (ms) {
    if (ms == null || !isFinite(ms)) return "—";
    const m = Math.max(0, Math.round(ms / MIN));
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return h + "h" + (r ? " " + r + "m" : "");
    return Math.floor(h / 24) + "d " + (h % 24) + "h";
  };

  /* ═══════════════════════ station panel ═══════════════════════ */

  TR.currentProviderId = null;

  const BAND_TONE = { P1: "danger", P2: "warn", P3: "info", P4: "muted" };

  TR.priorityBadge = function (row) {
    const band = row.priorityBand || "P4";
    return ERP.ui.badge(band + " " + (row.priorityScore != null ? Math.round(row.priorityScore) : ""), BAND_TONE[band] || "muted");
  };

  function ageText(iso, at) {
    if (!iso) return "—";
    const t = msOf(iso);
    if (t == null) return "—";
    const d = (msOf(at) || Date.now()) - t;
    const m = Math.max(0, Math.round(d / MIN));
    if (m < 60) return m + "m";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h";
    return Math.round(h / 24) + "d";
  }

  function barChart(points, opts) {
    const ui = ERP.ui, esc = ui.esc;
    opts = opts || {};
    const max = Math.max(1, ...points.map((p) => num(p.count, 0)));
    if (!points.length) return '<div class="rmm-chart-empty">No alerts in this window.</div>';
    return '<div class="rmm-chart" role="img" aria-label="' + esc(opts.label || "alert volume") + '">' +
      points.map((p) => {
        const h = Math.max(2, Math.round((num(p.count, 0) / max) * 100));
        return '<div class="rmm-chart-col" title="' + esc(p.date + ": " + p.count) + '">' +
          '<span class="rmm-chart-bar" style="height:' + h + '%"></span>' +
          '<span class="rmm-chart-x">' + esc(String(p.date).slice(5)) + "</span>" +
          "</div>";
      }).join("") + "</div>";
  }
  TR.barChart = barChart;

  function factorList(row) {
    const f = asArr(row.priorityFactors);
    if (!f.length) return "—";
    return f.map((x) => '<span class="rmm-factor">' + ERP.ui.esc(x.label) + ' <b>' + (x.points > 0 ? "+" : "") + x.points + "</b></span>").join(" ");
  }

  function ruleRow(provider, r, state, at) {
    const ui = ERP.ui, esc = ui.esc;
    const active = AL.ACTIVE.indexOf(r.state) !== -1;
    const actions = [];
    if (r.state === "firing") actions.push(ui.btn("Ack", { small: true, act: "tri-ack", arg: r.id }));
    if (active) {
      actions.push(ui.btn("Resolve", { small: true, act: "tri-resolve", arg: r.id }));
      actions.push(ui.btn(r.assignedToName ? "Reassign" : "Assign", { small: true, act: "tri-assign", arg: r.id }));
    }
    const checked = state.selected.has(String(r.id)) ? " checked" : "";
    return {
      pick: '<input type="checkbox" class="rmm-pick" data-pick="' + esc(r.id) + '"' + checked + ' aria-label="Select alert">',
      pri: TR.priorityBadge(r) + '<div class="erp-sub">' + esc(TR.bandLabel(r.priorityBand)) + "</div>",
      what: '<b>' + esc(r.subject || r.monitorName || "—") + "</b>" +
        '<div class="erp-sub">' + esc(r.hostname || r.deviceId) + (r.siteName ? " · " + esc(r.siteName) : "") + "</div>" +
        (r.message ? '<div class="erp-sub">' + esc(S(r.message, 120)) + "</div>" : ""),
      state: AL.stateBadge(r.state) + (r.severityLabel ? " " + AL.severityBadge(r) : ""),
      owner: r.assignedToName ? '<span class="erp-badge tone-info">@' + esc(r.assignedToName) + "</span>" : '<span class="erp-sub">Unassigned</span>',
      age: esc(ageText(r.firstFiredAt, at)),
      factors: '<a href="#" data-act="tri-why" data-arg="' + esc(r.id) + '" class="erp-sub">' + esc(asArr(r.priorityFactors).length + " factors") + "</a>",
      actions: actions.join(" "),
    };
  }

  function queueTable(provider, rows, state, at) {
    const ui = ERP.ui;
    const cols = [
      { key: "pick", label: "", width: "34px", render: (r) => r.pick },
      { key: "pri", label: "Priority", render: (r) => r.pri },
      { key: "what", label: "Alert", render: (r) => r.what },
      { key: "state", label: "State / severity", render: (r) => r.state },
      { key: "owner", label: "Owner", render: (r) => r.owner },
      { key: "age", label: "Age", render: (r) => r.age },
      { key: "factors", label: "", render: (r) => r.factors },
      { key: "actions", label: "", render: (r) => r.actions },
    ];
    return ui.table(cols, rows.map((r) => ruleRow(provider, r, state, at)), { scroll: true, emptyText: "Nothing in the triage queue matches this view." });
  }

  function groupHeaderHtml(g, state) {
    const ui = ERP.ui, esc = ui.esc;
    const all = g.rows.every((r) => state.selected.has(String(r.id)));
    const tone = g.worstRank >= 30 ? "danger" : g.worstRank >= 20 ? "warn" : "muted";
    return '<div class="rmm-tri-group-head">' +
      '<label class="rmm-tri-group-pick"><input type="checkbox" data-pick-all="' + esc(g.key) + '"' + (all ? " checked" : "") + ' aria-label="Select group"> </label>' +
      '<span class="rmm-tri-group-label">' + esc(g.label) + "</span> " +
      ui.badge(g.count + (g.count === 1 ? " alert" : " alerts"), tone) + " " +
      ui.badge("top " + Math.round(g.topScore), BAND_TONE[TR.priorityBand(g.topScore)] || "muted") +
      "</div>";
  }

  /* Fills `host` with the triage workspace. opts: { provider, providerId,
     providers, embedded, toast, onChange }. */
  TR.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});
    const state = {
      by: "device",
      sort: "priority",
      severityId: "", siteId: "", monitorId: "", assignee: "", q: "",
      selected: new Set(),
      metrics: null,
      lastData: null,
    };

    async function load() {
      const g = await T.get(opts.providerId);
      return g.error ? (opts.provider || {}) : g.provider;
    }

    async function compute() {
      const provider = await load();
      const q = await TR.queue(opts.providerId, {
        sort: state.sort, severityId: state.severityId, siteId: state.siteId,
        monitorId: state.monitorId, assignee: state.assignee, q: state.q,
      });
      state.lastData = q;
      state.metrics = await TR.metrics(opts.providerId, {});
      return { provider, q };
    }

    function filterBar(provider) {
      const devices = asArr(provider.devices).map(D.normalizeDevice);
      const monitors = asArr(provider.monitorDefinitions);
      const sites = asArr(provider.sites);
      const sevIds = Object.keys(asArr(provider.alerts).reduce((m, a) => { if (AL.ACTIVE.indexOf(a.state) !== -1) m[a.severityId] = 1; return m; }, {}));
      const people = TR.assignees(provider);
      const opt = (val, label, cur) => '<option value="' + esc(val) + '"' + (String(cur) === String(val) ? " selected" : "") + ">" + esc(label) + "</option>";
      return '<div class="erp-inline-form rmm-tri-filters">' +
        '<div class="field"><label>Group by</label><select name="tri_by">' + TR.GROUPINGS.map((g) => opt(g.id, g.label, state.by)).join("") + "</select></div>" +
        '<div class="field"><label>Sort</label><select name="tri_sort">' + TR.SORTS.map((s) => opt(s.id, s.label, state.sort)).join("") + "</select></div>" +
        '<div class="field"><label>Severity</label><select name="tri_sev"><option value="">All</option>' + sevIds.map((s) => opt(s, s, state.severityId)).join("") + "</select></div>" +
        '<div class="field"><label>Site</label><select name="tri_site"><option value="">All sites</option>' + sites.map((s) => opt(s.id, s.name || s.id, state.siteId)).join("") + "</select></div>" +
        '<div class="field"><label>Monitor</label><select name="tri_mon"><option value="">All monitors</option>' + monitors.map((m) => opt(m.id, m.name || m.id, state.monitorId)).join("") + "</select></div>" +
        '<div class="field"><label>Owner</label><select name="tri_owner"><option value="">Anyone</option>' + opt("__unassigned__", "Unassigned", state.assignee) + people.map((p) => opt(p.id, p.name, state.assignee)).join("") + "</select></div>" +
        '<div class="field" style="flex:1 1 180px"><label>Search</label><input type="text" name="tri_q" value="' + esc(state.q) + '" placeholder="hostname, alert, monitor…"></div>' +
        "</div>";
    }

    function bulkBar(visible) {
      const n = state.selected.size;
      const allVisible = visible.length > 0 && visible.every((r) => state.selected.has(String(r.id)));
      return '<div class="rmm-tri-bulk">' +
        '<label class="rmm-tri-bulk-all"><input type="checkbox" data-pick-all-visible="1"' + (allVisible ? " checked" : "") + "> Select all " + visible.length + "</label>" +
        '<span class="rmm-tri-bulk-count">' + n + " selected</span>" +
        ERP.ui.btn("Acknowledge", { small: true, act: "tri-bulk-ack", disabled: !n }) +
        ERP.ui.btn("Assign…", { small: true, act: "tri-bulk-assign", disabled: !n }) +
        ERP.ui.btn("Resolve", { small: true, act: "tri-bulk-resolve", disabled: !n }) +
        ERP.ui.btn("Snooze 1h", { small: true, act: "tri-bulk-snooze", disabled: !n }) +
        ERP.ui.btn("Clear", { small: true, act: "tri-clear", disabled: !n }) +
        "</div>";
    }

    function metricsHtml(m) {
      if (!m) return "";
      const ui2 = ERP.ui, e = ui2.esc;
      const sevRows = asArr(m.bySeverity).map((s) => ({
        sev: e(s.label),
        vol: String(s.count),
        mtta: e(TR.formatDuration(s.mtta)),
        mttr: e(TR.formatDuration(s.mttr)),
      }));
      const devRows = asArr(m.topDevices).map((d) => ({ name: e(d.label), count: String(d.count) }));
      const monRows = asArr(m.topMonitors).map((d) => ({ name: e(d.label), count: String(d.count) }));
      return '<h4 class="rmm-section-title">Response metrics <span class="erp-sub">· last ' + m.window.days + " days</span></h4>" +
        '<div class="erp-grid rmm-tri-metrics">' +
        ui2.statCard({ label: "Volume", value: String(m.volume.total), sub: m.window.from.slice(0, 10) + " → " + m.window.to.slice(0, 10) }) +
        ui2.statCard({ label: "MTTA", value: e(TR.formatDuration(m.mtta.avg)), sub: m.mtta.count + " acked · target " + m.mtta.targetMinutes + "m", tone: m.mtta.avg != null && m.mtta.avg <= m.mtta.targetMinutes * MIN ? "success" : "warn" }) +
        ui2.statCard({ label: "MTTR", value: e(TR.formatDuration(m.mttr.avg)), sub: m.mttr.count + " resolved" }) +
        ui2.statCard({ label: "Ack within target", value: (m.mtta.slaPercent == null ? "—" : m.mtta.slaPercent + "%"), sub: m.mtta.withinSla + " of " + m.mtta.eligible, tone: m.mtta.slaPercent != null && m.mtta.slaPercent >= 90 ? "success" : "warn" }) +
        "</div>" +
        barChart(m.volume.byDay, { label: "alert volume per day" }) +
        ui2.grid([
          ui2.card("By severity", ui2.table([
            { key: "sev", label: "Severity", render: (r) => r.sev },
            { key: "vol", label: "Volume", render: (r) => r.vol },
            { key: "mtta", label: "MTTA", render: (r) => r.mtta },
            { key: "mttr", label: "MTTR", render: (r) => r.mttr },
          ], sevRows, { emptyText: "No alerts in the window." })),
          ui2.card("Top devices", ui2.table([
            { key: "name", label: "Device", render: (r) => r.name },
            { key: "count", label: "Alerts", render: (r) => r.count },
          ], devRows, { emptyText: "No alerts in the window." })),
          ui2.card("Top monitors", ui2.table([
            { key: "name", label: "Monitor", render: (r) => r.name },
            { key: "count", label: "Alerts", render: (r) => r.count },
          ], monRows, { emptyText: "No alerts in the window." })),
        ], "rmm-tri-metric-grid");
    }

    async function paint() {
      const { provider, q } = await compute();
      const counts = q.counts;
      const rows = q.rows;
      // prune the selection to alerts still present
      const present = new Set(rows.map((r) => String(r.id)));
      [...state.selected].forEach((id) => { if (!present.has(id)) state.selected.delete(id); });

      const summary = ERP.ui.summary([
        { label: "Queued", value: String(rows.length) },
        { label: "Unacknowledged", value: String(counts.firing) },
        { label: "Critical", value: String(counts.critical) },
        { label: "Unassigned", value: String(counts.unassigned) },
        { label: "Flapping", value: String(counts.flapping) },
        { label: "Snoozed", value: String(counts.snoozed) },
      ]);

      let queueHtml;
      if (!rows.length) queueHtml = ERP.ui.alert("The triage queue is clear — nothing active matches this view.", "success");
      else {
        const groups = TR.group(rows, state.by);
        queueHtml = bulkBar(rows) + groups.map((g) => (
          "<section class=\"rmm-tri-group\">" + groupHeaderHtml(g, state) + queueTable(provider, g.rows, state, q.at) + "</section>"
        )).join("");
      }

      host.innerHTML = '<div class="rmm-triage-inner">' + summary + filterBar(provider) +
        queueHtml + metricsHtml(state.metrics) + "</div>";
    }

    /* selection handling is event-local so checking a box doesn't rebuild
       the DOM (and lose the rest of the selection) */
    function updateBulkCount() {
      const el = host.querySelector(".rmm-tri-bulk-count");
      if (el) el.textContent = state.selected.size + " selected";
      host.querySelectorAll("[data-act^='tri-bulk']").forEach((b) => { b.disabled = state.selected.size === 0; });
    }

    host.addEventListener("change", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.hasAttribute && t.hasAttribute("data-pick")) {
        const id = t.getAttribute("data-pick");
        if (t.checked) state.selected.add(String(id)); else state.selected.delete(String(id));
        updateBulkCount();
      } else if (t.hasAttribute && t.hasAttribute("data-pick-all-visible")) {
        (state.lastData ? state.lastData.rows : []).forEach((r) => { if (t.checked) state.selected.add(String(r.id)); else state.selected.delete(String(r.id)); });
        paint();
      } else if (t.hasAttribute && t.hasAttribute("data-pick-all")) {
        const key = t.getAttribute("data-pick-all");
        const groups = TR.group(state.lastData ? state.lastData.rows : [], state.by);
        const g = groups.find((x) => String(x.key) === String(key));
        if (g) g.rows.forEach((r) => { if (t.checked) state.selected.add(String(r.id)); else state.selected.delete(String(r.id)); });
        paint();
      }
    });

    host.addEventListener("input", (e) => { if (e.target && e.target.name === "tri_q") state.q = e.target.value; });
    host.addEventListener("keyup", (e) => { if (e.target && e.target.name === "tri_q" && e.key === "Enter") paint(); });

    ERP.ui.bind(host, "change", "[name^='tri_']", (t) => {
      const n = t.getAttribute("name");
      if (n === "tri_by") state.by = t.value;
      else if (n === "tri_sort") state.sort = t.value;
      else if (n === "tri_sev") state.severityId = t.value;
      else if (n === "tri_site") state.siteId = t.value;
      else if (n === "tri_mon") state.monitorId = t.value;
      else if (n === "tri_owner") state.assignee = t.value;
      paint();
    });

    async function runBulk(action, extra) {
      const ids = [...state.selected];
      if (!ids.length) return toast("Select one or more alerts first", "warn");
      const r = await TR.bulk(opts.providerId, ids, action, extra);
      if (r.error) return toast("Failed: " + r.error, "error");
      state.selected = new Set();
      const verb = { acknowledge: "Acknowledged", assign: "Assigned", unassign: "Unassigned", resolve: "Resolved", snooze: "Snoozed", unsnooze: "Unsnoozed" }[action] || "Updated";
      toast(verb + " " + r.succeeded + " alert" + (r.succeeded === 1 ? "" : "s") + (r.failed ? " · " + r.failed + " failed" : ""));
      if (opts.onChange) opts.onChange(); else paint();
    }

    function openAssignModal(ids) {
      const provider = (state.lastData && state.lastData.provider) || opts.provider || {};
      const people = TR.assignees(provider);
      const current = ids.length === 1 ? (asArr(provider.alerts).find((a) => String(a.id) === String(ids[0])) || {}) : {};
      const body = ERP.ui.form(
        ERP.ui.select("assignee", "Assign to", people.map((p) => ({ value: p.id, label: p.name })), current.assignedTo || "", "— nobody —") +
        ERP.ui.text("assignee_name", "…or type a name", "", "e.g. night shift"),
        ERP.ui.btn("Assign", { primary: true, act: "tri-assign-do" }) + " " + ERP.ui.btn("Cancel", { act: "tri-assign-cancel" })
      );
      const m = ERP.ui.modal({ title: "Assign " + ids.length + " alert" + (ids.length === 1 ? "" : "s"), size: "sm", body });
      if (!m) return;
      const doIt = async () => {
        const typed = (m.querySelector('[name="assignee_name"]') || {}).value || "";
        const picked = (m.querySelector('[name="assignee"]') || {}).value || "";
        const assignee = typed.trim() ? typed.trim() : picked;
        if (!assignee) return toast("Choose or type a name", "warn");
        ERP.ui.closeModal();
        await runBulk("assign", { assignee });
      };
      m.addEventListener("click", (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        if (act === "tri-assign-do") doIt();
        else if (act === "tri-assign-cancel") ERP.ui.closeModal();
      });
      const nameInput = m.querySelector('[name="assignee_name"]');
      if (nameInput) nameInput.addEventListener("keyup", (e) => { if (e.key === "Enter") doIt(); });
    }

    function openWhyModal(id) {
      const row = ((state.lastData && state.lastData.rows) || []).find((r) => String(r.id) === String(id));
      if (!row) return;
      const body = '<div class="rmm-status-line">' + TR.priorityBadge(row) + " " + AL.stateBadge(row.state) + " " + AL.severityBadge(row) + "</div>" +
        '<p><b>' + esc(row.subject || row.monitorName) + "</b> on " + esc(row.hostname || row.deviceId) + "</p>" +
        '<h4 class="rmm-section-title">Priority factors</h4><div class="rmm-factors">' + factorList(row) + "</div>" +
        '<p class="erp-sub">Score ' + Math.round(row.priorityScore) + " → " + esc(TR.bandLabel(row.priorityBand)) + ". The model weights severity, time-to-acknowledge, age, flapping, recurrence, ownership and suppression; a snoozed or maintenance-suppressed alert is pushed to the back.</p>";
      ERP.ui.modal({ title: "Why this alert ranks here", size: "sm", body });
    }

    ERP.ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      e.preventDefault();
      if (act === "tri-ack") return runBulk0("acknowledge", [arg]);
      if (act === "tri-resolve") return runBulk0("resolve", [arg]);
      if (act === "tri-assign") return openAssignModal([arg]);
      if (act === "tri-why") return openWhyModal(arg);
      if (act === "tri-clear") { state.selected = new Set(); return paint(); }
      if (act === "tri-bulk-ack") return runBulk("acknowledge");
      if (act === "tri-bulk-resolve") return runBulk("resolve");
      if (act === "tri-bulk-snooze") return runBulk("snooze", { minutes: 60 });
      if (act === "tri-bulk-assign") return openAssignModal([...state.selected]);
    });

    async function runBulk0(action, ids) {
      const r = await TR.bulk(opts.providerId, ids, action, {});
      if (r.error) return toast("Failed: " + r.error, "error");
      toast(action === "resolve" ? "Resolved" : "Acknowledged");
      if (opts.onChange) opts.onChange(); else paint();
    }

    await paint();
    TR.currentProviderId = opts.providerId;
    return state;
  };

  /* Standalone mount used by the validation suite and any embed. */
  TR.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { host.innerHTML = ERP.ui.alert("No service providers yet.", "info"); return null; }
    const providerId = opts.providerId || providers[0].id;
    const g = await T.get(providerId);
    if (g.error) { host.innerHTML = ERP.ui.alert("This tenant could not be loaded.", "danger"); return null; }
    const wrap = document.createElement("div");
    wrap.className = "rmm-triage";
    host.innerHTML = "";
    host.appendChild(wrap);
    if (!opts.headHtml && !opts.embedded) {
      wrap.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Triage queue", "A prioritized, explainable queue of active alerts with grouping, bulk action and response-time metrics."));
    }
    return TR.renderPanel(wrap, { provider: g.provider, providerId, providers, embedded: true, toast: opts.toast || (() => {}) });
  };

  TR.render = TR.renderInto;
})();
