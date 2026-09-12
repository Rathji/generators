/* ============================================================
   RMM-U — operational dashboards  (Phase 10 · Task 40)

   The fleet, at a glance. One screen answers the questions an
   operator opens the console with:

     • Are the endpoints up?     devices online / stale / offline
     • Are the agents healthy?   version spread, outdated agents,
                                 pending updates, never-seen devices
     • What is on fire?          active alerts by severity and by age
     • Are we compliant?         patch compliance, security posture,
                                 backup verification
     • Is automation working?    job success rate

   Everything is derived from the real modules — devices
   (D.effectiveStatus), the patch engine (PA), security (SEC),
   alerts (AL), monitors (MON), jobs (J) and the event stream (EV) —
   never a separate set of numbers that could drift from them.

   Every tile is a drill-down: clicking it lists the exact devices
   (or alerts / jobs) behind the number, so a dashboard never hides
   the thing it is reporting.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy || !ERP.devices) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const M = ERP.masterConfig || null;
  const PA = ERP.patch || null;
  const SEC = ERP.security || null;
  const AL = ERP.alerts || null;
  const J = ERP.jobs || null;
  const MON = ERP.monitors || null;
  const AG = ERP.agent || null;
  const EV = ERP.events || null;

  const FL = (ERP.fleet = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const now = () => new Date().toISOString();
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const enabled = () => cfg("rmm.dashboardEnabled", true) !== false;
  const alertActive = () => (AL && AL.ACTIVE) ? AL.ACTIVE : ["firing", "acknowledged"];

  /* ─────────────────────── agent health (Task 40) ─────────────────── */

  FL.agentVersionOf = function (dev) {
    const a = asObj(dev && dev.agent);
    return String(a.version || (dev && dev.agentVersion) || "");
  };

  /* Compare dotted versions; returns -1 / 0 / 1. Non-numeric parts sort as 0. */
  FL.compareVersions = function (a, b) {
    const pa = String(a || "").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const pb = String(b || "").split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  };

  FL.latestAgentVersion = function (provider, devices) {
    const list = devices || asArr(asObj(provider).devices).map(D.normalizeDevice);
    const candidates = [];
    const override = cfg("rmm.agentLatestVersion", "");
    if (override) candidates.push(String(override));
    if (AG && typeof AG.VERSION === "function") { try { candidates.push(String(AG.VERSION())); } catch (e) {} }
    list.forEach((d) => { const v = FL.agentVersionOf(d); if (v) candidates.push(v); });
    if (!candidates.length) return "";
    return candidates.reduce((best, v) => (FL.compareVersions(v, best) > 0 ? v : best), candidates[0]);
  };

  FL.agentHealth = function (provider) {
    const devices = asArr(asObj(provider).devices).map(D.normalizeDevice);
    const latest = FL.latestAgentVersion(provider, devices);
    const groups = {};
    const outdated = [], pending = [], unknown = [];
    devices.forEach((d) => {
      const v = FL.agentVersionOf(d) || "unknown";
      groups[v] = (groups[v] || 0) + 1;
      if (!FL.agentVersionOf(d)) unknown.push(d);
      else if (latest && FL.compareVersions(v, latest) < 0) outdated.push(d);
      if (asObj(d.agent).updatePending) pending.push(d);
    });
    const versions = Object.keys(groups).map((v) => ({
      version: v, count: groups[v],
      latest: !!latest && v === latest,
    })).sort((a, b) => (b.latest ? 1 : 0) - (a.latest ? 1 : 0) || FL.compareVersions(b.version, a.version));
    return {
      devices: devices.length, latest, versions,
      current: devices.length - outdated.length - unknown.length,
      outdated: outdated.length, pending: pending.length, unknownVersion: unknown.length,
      outdatedList: outdated.map(devRow), pendingList: pending.map(devRow),
    };
  };

  /* ─────────────────────── alerts (Task 40) ─────────────────────── */

  FL.AGE_BUCKETS = [
    { id: "0-1h", label: "< 1 hour", maxMs: HOUR },
    { id: "1-24h", label: "1–24 hours", maxMs: DAY },
    { id: "1-7d", label: "1–7 days", maxMs: 7 * DAY },
    { id: "7d+", label: "over 7 days", maxMs: Infinity },
  ];
  FL.ageBucketId = function (ms) {
    const x = Math.max(0, num(ms, 0));
    const b = FL.AGE_BUCKETS.find((k) => x < k.maxMs);
    return b ? b.id : "7d+";
  };

  FL.alertStats = function (provider) {
    const rows = asArr(asObj(provider).alerts);
    const ACTIVE = alertActive();
    const active = rows.filter((a) => ACTIVE.indexOf(a.state) !== -1);
    const sevMap = {};
    const ageCount = {};
    FL.AGE_BUCKETS.forEach((b) => { ageCount[b.id] = 0; });
    let oldest = null;
    active.forEach((a) => {
      const sid = a.severityId || "sev-warning";
      if (!sevMap[sid]) sevMap[sid] = { id: sid, label: a.severityLabel || sid, rank: num(a.severityRank, 0), count: 0 };
      sevMap[sid].count += 1;
      const from = Date.parse(a.firstFiredAt || a.at || a.lastSeenAt);
      if (isFinite(from)) {
        const age = Date.now() - from;
        ageCount[FL.ageBucketId(age)] += 1;
        if (oldest == null || age > oldest) oldest = age;
      }
    });
    const bySeverity = Object.keys(sevMap).map((k) => sevMap[k]).sort((a, b) => b.rank - a.rank);
    return {
      total: rows.length, active: active.length,
      firing: active.filter((a) => a.state === "firing").length,
      acknowledged: active.filter((a) => a.state === "acknowledged").length,
      critical: active.filter((a) => num(a.severityRank, 0) >= 30).length,
      unacknowledged: active.filter((a) => a.state === "firing").length,
      resolved: rows.filter((a) => a.state === "resolved").length,
      oldestAgeMs: oldest == null ? 0 : oldest,
      bySeverity, byAge: FL.AGE_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: ageCount[b.id] })),
    };
  };

  function devRow(dev) {
    return {
      deviceId: String(dev.id),
      hostname: dev.hostname || dev.displayName || String(dev.id),
      siteName: "",
      osFamily: asObj(dev.os).family || "",
      status: D.effectiveStatus(dev),
    };
  }

  /* ─────────────────────── compliance / jobs (Task 40) ─────────────────── */

  FL.patchSummary = async function (providerId) {
    if (!PA) return null;
    const r = await PA.rollup(providerId, { by: "provider" });
    if (!r || r.error) return null;
    const s = asObj(r.summary);
    return {
      devices: num(s.devices, 0), compliant: num(s.compliant, 0), nonCompliant: num(s.nonCompliant, 0),
      unknown: num(s.unknown, 0), missingRequired: num(s.missingRequired, 0), missingTotal: num(s.missingTotal, 0),
      overdue: num(s.overdue, 0), oldestAgeDays: num(s.oldestAgeDays, 0),
    };
  };

  FL.securitySummary = async function (providerId) {
    if (!SEC) return null;
    const comp = await SEC.compliance(providerId, { record: false });
    const backs = await SEC.backupRows(providerId, {});
    const posture = await SEC.postureRows(providerId, {});
    const cs = asObj(comp && comp.summary);
    const bs = asObj(backs && backs.summary);
    const ps = asObj(posture && posture.summary);
    return {
      devices: num(cs.devices, 0), compliant: num(cs.compliant, 0), nonCompliant: num(cs.nonCompliant, 0),
      postureFail: num(ps.fail, 0),
      backup: {
        devices: num(bs.devices, 0), ok: num(bs.ok, 0), failed: num(bs.failed, 0),
        missed: num(bs.missed, 0), never: num(bs.never, 0),
        problems: num(bs.failed, 0) + num(bs.missed, 0) + num(bs.never, 0),
      },
    };
  };

  FL.monitorSummary = async function (providerId) {
    if (!MON) return null;
    const s = await MON.stats(providerId);
    if (!s || s.error) return null;
    return { total: num(s.total, 0), enabled: num(s.enabled, 0), covered: num(s.covered, 0), uncovered: num(s.uncovered, 0), devices: num(s.devices, 0) };
  };

  FL.jobSummary = async function (providerId) {
    if (!J) return null;
    const s = await J.stats(providerId);
    if (!s || s.error) return null;
    return {
      jobs: num(s.jobs, 0), targets: num(s.targets, 0), succeeded: num(s.succeeded, 0), failed: num(s.failed, 0),
      queued: num(s.queued, 0), running: num(s.running, 0), successRate: num(s.successRate, 0),
    };
  };

  /* ─────────────────────── the snapshot ─────────────────────── */

  FL.snapshot = async function (providerId, opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { error: "dashboard_disabled" };
    const g = await T.get(providerId);
    if (g.error) return { error: "not_found", providerId };
    const provider = g.provider;
    const devices = D.statsOf(provider);
    return {
      providerId, providerName: provider.name || providerId, at: now(),
      devices,
      agent: FL.agentHealth(provider),
      alerts: FL.alertStats(provider),
      patch: await FL.patchSummary(providerId),
      security: await FL.securitySummary(providerId),
      monitors: await FL.monitorSummary(providerId),
      jobs: await FL.jobSummary(providerId),
      stream: { mode: EV ? EV.mode() : "offline", label: EV ? EV.modeLabel() : "offline" },
    };
  };
  FL.stats = FL.snapshot;

  /* ─────────────────────── drill-down ─────────────────────── */

  function siteName(provider, id) {
    const s = asArr(provider.sites).find((x) => String(x.id) === String(id));
    return s ? (s.name || id) : "";
  }

  /* Return the devices (or alert/job rows) behind a tile. `kind` selects
     the tile; `arg` narrows it (a status, a severity id, an age bucket…). */
  FL.affected = async function (providerId, kind, arg) {
    const g = await T.get(providerId);
    if (g.error) return { error: "not_found", providerId, rows: [] };
    const provider = g.provider;
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const rows = [];
    const add = (dev, detail) => rows.push(Object.assign(devRow(dev), { siteName: siteName(provider, dev.siteId), detail: detail || "" }));

    if (kind === "status") {
      devices.forEach((d) => { if (!arg || D.effectiveStatus(d) === arg) add(d); });
    } else if (kind === "agent-outdated") {
      const latest = FL.latestAgentVersion(provider, devices);
      devices.forEach((d) => { const v = FL.agentVersionOf(d); if (v && FL.compareVersions(v, latest) < 0) add(d, "agent " + v + " → " + latest); });
    } else if (kind === "agent-pending") {
      devices.forEach((d) => { if (asObj(d.agent).updatePending) add(d, "update pending"); });
    } else if (kind === "agent-unknown") {
      devices.forEach((d) => { if (!FL.agentVersionOf(d)) add(d, "no version reported"); });
    } else if (kind === "alert-severity" || kind === "alert-age") {
      const ACTIVE = alertActive();
      const seen = {};
      asArr(provider.alerts).filter((a) => ACTIVE.indexOf(a.state) !== -1).forEach((a) => {
        const match = kind === "alert-severity"
          ? String(a.severityId) === String(arg)
          : FL.ageBucketId(Date.now() - Date.parse(a.firstFiredAt || a.at || a.lastSeenAt)) === arg;
        if (!match) return;
        const key = String(a.deviceId);
        if (seen[key]) { seen[key].detail += " · "; return; }
        const dev = devices.find((d) => String(d.id) === key);
        const row = { deviceId: key, hostname: a.hostname || (dev && dev.hostname) || key, siteName: a.siteName || (dev ? siteName(provider, dev.siteId) : ""), osFamily: dev ? asObj(dev.os).family : "", status: dev ? D.effectiveStatus(dev) : a.state, detail: a.subject || a.monitorName || "" };
        seen[key] = row; rows.push(row);
      });
    } else if (kind === "patch-noncompliant") {
      if (PA) {
        const dr = await PA.deviceRows(providerId, {});
        asArr(dr.rows).filter((r) => r.complianceStatus === "non-compliant").forEach((r) => rows.push({
          deviceId: r.deviceId, hostname: r.hostname, siteName: r.siteName || "", osFamily: r.osFamily || "", status: r.status || "",
          detail: num(r.missingRequired, 0) + " required missing" + (num(r.overdue, 0) ? " · " + r.overdue + " overdue" : ""),
        }));
      }
    } else if (kind === "security-noncompliant") {
      if (SEC) {
        const comp = await SEC.compliance(providerId, { record: false });
        asArr(comp.rows).filter((r) => !r.compliant).forEach((r) => rows.push({
          deviceId: r.deviceId, hostname: r.hostname, siteName: "", osFamily: "", status: "",
          detail: asArr(r.failing).length + " failing check(s)",
        }));
      }
    } else if (kind === "backup-problem") {
      if (SEC) {
        const backs = await SEC.backupRows(providerId, {});
        asArr(backs.rows).filter((r) => ["failed", "missed", "never", "stale", "overdue"].indexOf(r.status) !== -1).forEach((r) => rows.push({
          deviceId: r.deviceId, hostname: r.hostname, siteName: r.siteName || "", osFamily: "", status: r.status,
          detail: r.lastSuccessAt ? "last success " + r.lastSuccessAt.slice(0, 10) : "never backed up",
        }));
      }
    } else if (kind === "job-failed") {
      if (J) {
        const list = await J.list(providerId, {});
        const seen = {};
        asArr(list).forEach((job) => {
          const results = asObj(job.results);
          asArr(job.targets).forEach((tid) => {
            const res = asObj(results[tid]);
            if (["failed", "timed-out", "unsupported", "expired"].indexOf(res.state) === -1) return;
            const key = String(tid);
            if (seen[key]) return;
            seen[key] = true;
            const dev = devices.find((d) => String(d.id) === key);
            rows.push({ deviceId: key, hostname: (dev && dev.hostname) || key, siteName: dev ? siteName(provider, dev.siteId) : "", osFamily: dev ? asObj(dev.os).family : "", status: dev ? D.effectiveStatus(dev) : "", detail: (job.name || job.id) + " · " + res.state });
          });
        });
      }
    } else if (kind === "monitor-uncovered") {
      if (MON && ERP.groups) {
        const G = ERP.groups;
        const mon = asArr(provider.monitorDefinitions);
        devices.forEach((d) => { if (!mon.some((m) => G.matchTargets(provider, m.targets, d, { provider }).match)) add(d, "no monitor targets this device"); });
      }
    } else if (kind === "device") {
      const dev = devices.find((d) => String(d.id) === String(arg));
      if (dev) add(dev);
    }
    return { providerId, kind, arg: arg == null ? "" : String(arg), rows };
  };

  /* The tiles, as data (so tests and the UI share one definition). */
  FL.tiles = function (snap) {
    const d = asObj(snap.devices), a = asObj(snap.alerts), ag = asObj(snap.agent);
    const p = asObj(snap.patch), sec = asObj(snap.security), jobs = asObj(snap.jobs);
    const backup = asObj(sec.backup);
    const t = [];
    const push = (o) => t.push(o);
    push({ id: "devices", label: "Managed devices", value: d.total, sub: d.online + " online", kind: "status", arg: "", tone: "" });
    push({ id: "online", label: "Online", value: d.online, sub: d.total ? Math.round((d.online / d.total) * 100) + "% of fleet" : "—", kind: "status", arg: "online", tone: "success" });
    push({ id: "offline", label: "Offline", value: d.offline, sub: d.stale + " stale", kind: "status", arg: "offline", tone: d.offline ? "danger" : "" });
    push({ id: "stale", label: "Stale", value: d.stale, sub: "no check-in in window", kind: "status", arg: "stale", tone: d.stale ? "warn" : "" });
    push({ id: "agent-versions", label: "Agent versions", value: asArr(ag.versions).length, sub: ag.latest ? "latest " + ag.latest : "no version data", kind: "agent-outdated", arg: "", tone: "" });
    push({ id: "agent-outdated", label: "Agents outdated", value: ag.outdated, sub: ag.current + " current", kind: "agent-outdated", arg: "", tone: ag.outdated ? "warn" : "" });
    push({ id: "agent-pending", label: "Update pending", value: ag.pending, sub: "staged for next check-in", kind: "agent-pending", arg: "", tone: ag.pending ? "info" : "" });
    push({ id: "alerts-active", label: "Active alerts", value: a.active, sub: a.firing + " unacknowledged", kind: "alert-severity", arg: "", tone: a.active ? "warn" : "" });
    push({ id: "alerts-critical", label: "Critical alerts", value: a.critical, sub: a.oldestAgeMs ? "oldest " + Math.round(a.oldestAgeMs / HOUR) + "h" : "none", kind: "alert-severity", arg: (asArr(a.bySeverity)[0] || {}).id || "", tone: a.critical ? "danger" : "" });
    push({ id: "patch", label: "Patch non-compliant", value: p ? p.nonCompliant : "—", sub: p ? p.missingRequired + " required missing" : "patch engine off", kind: "patch-noncompliant", arg: "", tone: p && p.nonCompliant ? "danger" : "" });
    push({ id: "security", label: "Security non-compliant", value: sec ? sec.nonCompliant : "—", sub: sec ? sec.compliant + " compliant" : "security engine off", kind: "security-noncompliant", arg: "", tone: sec && sec.nonCompliant ? "warn" : "" });
    push({ id: "backup", label: "Backup problems", value: backup.problems == null ? "—" : backup.problems, sub: backup.never != null ? backup.never + " never backed up" : "backup monitor off", kind: "backup-problem", arg: "", tone: backup.problems ? "danger" : "" });
    push({ id: "jobs", label: "Job success rate", value: jobs.successRate == null ? "—" : jobs.successRate + "%", sub: jobs.failed != null ? jobs.failed + " failed target(s)" : "no jobs yet", kind: "job-failed", arg: "", tone: jobs.failed ? "warn" : "success" });
    return t;
  };

  /* ─────────────────────── console (Task 40) ─────────────────────── */

  FL.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});
    const state = { tab: "overview", snap: null, q: "", live: false };
    let unsub = null, refreshTimer = null;

    async function load() { return (await T.get(opts.providerId)).provider; }

    async function compute() {
      state.snap = await FL.snapshot(opts.providerId, {});
      if (state.snap.error) throw new Error(state.snap.error);
      return state.snap;
    }

    function tileHtml(t) {
      const drillable = !!t.kind;
      const tag = drillable ? "button" : "div";
      const attrs = drillable ? ' type="button" data-act="dash-drill" data-arg="' + esc(t.kind + "|" + (t.arg || "")) + '"' : "";
      return "<" + tag + ' class="rmm-tile' + (t.tone ? " tone-" + t.tone : "") + (drillable ? " drillable" : "") + '"' + attrs + ">" +
        '<span class="rmm-tile-label">' + esc(t.label) + "</span>" +
        '<span class="rmm-tile-value">' + esc(String(t.value == null ? "—" : t.value)) + "</span>" +
        (t.sub ? '<span class="rmm-tile-sub">' + esc(t.sub) + "</span>" : "") +
        (drillable ? '<span class="rmm-tile-cta">Drill down ›</span>' : "") +
        "</" + tag + ">";
    }

    function overviewTab() {
      const s = state.snap;
      const tiles = FL.tiles(s);
      const stream = asObj(s.stream);
      const bars = asArr(s.alerts.bySeverity).map((x) => '<div class="rmm-bar-row"><span>' + esc(x.label) + '</span><b>' + x.count + "</b></div>").join("") || '<p class="erp-sub">No active alerts.</p>';
      const ages = asArr(s.alerts.byAge).map((x) => '<div class="rmm-bar-row"><span>' + esc(x.label) + '</span><b>' + x.count + "</b></div>").join("");
      const recent = EV ? EV.recent(null, 8) : [];
      const recentHtml = recent.length
        ? ui.table([
            { key: "at", label: "When", render: (r) => '<span class="erp-sub">' + esc(ui.dateTime(r.at)) + "</span>" },
            { key: "kind", label: "Kind", render: (r) => ui.badge(r.kind, "muted") },
            { key: "ref", label: "Subject", render: (r) => esc(r.deviceId || r.jobId || r.alert || "") },
            { key: "state", label: "Change", render: (r) => esc(r.to || r.state || r.alert || "") },
          ], recent, { scroll: true, emptyText: "No events seen since this console opened." })
        : "";
      return '<div class="erp-grid erp-kpi-grid">' + tiles.map(tileHtml).join("") + "</div>" +
        '<div class="rmm-dash-cols">' +
          ui.card("Active alerts by severity", bars) +
          ui.card("Active alerts by age", ages) +
        "</div>" +
        ui.card("Event stream", '<p class="erp-sub">Mode: <b>' + esc(stream.label || "offline") + "</b> · " + (recent.length ? recent.length + " event(s) seen" : "waiting for the hub") + "</p>" + recentHtml,
          { actions: ui.btn("Refresh", { small: true, act: "dash-refresh" }) + " " + ui.btn(state.live ? "Live on" : "Live off", { small: true, primary: state.live, act: "dash-live" }) });
    }

    function agentsTab() {
      const ag = asObj(state.snap.agent);
      const rows = asArr(ag.versions).map((v) => ({
        version: "<b>" + esc(v.version) + "</b>" + (v.latest ? " " + ui.badge("latest", "success") : ""),
        count: String(v.count),
        pct: state.snap.devices.total ? Math.round((v.count / state.snap.devices.total) * 100) + "%" : "—",
        act: v.latest ? "" : ui.btn("View devices", { small: true, act: "dash-drill", arg: "agent-outdated|" }),
      }));
      const outdated = asArr(ag.outdatedList).map((d) => deviceRow(d));
      return ui.card("Agent version spread (" + asArr(ag.versions).length + ")",
        '<p class="erp-sub">Latest published agent: <b>' + esc(ag.latest || "unknown") + "</b> · " + ag.outdated + " outdated · " + ag.pending + " update(s) staged.</p>" +
        ui.table([
          { key: "version", label: "Version", render: (r) => r.version },
          { key: "count", label: "Devices", align: "right", render: (r) => r.count },
          { key: "pct", label: "Share", align: "right", render: (r) => r.pct },
          { key: "act", label: "", render: (r) => r.act },
        ], rows, { scroll: true, emptyText: "No enrolled devices yet." })) +
        ui.card("Agents needing an update (" + outdated.length + ")", ui.table(deviceCols(), outdated, { scroll: true, emptyText: "Every agent is on the latest version." }));
    }

    function deviceCols() {
      return [
        { key: "hostname", label: "Device", render: (r) => "<b>" + esc(r.hostname) + "</b>" + (r.siteName ? '<div class="erp-sub">' + esc(r.siteName) + "</div>" : "") },
        { key: "osFamily", label: "OS", render: (r) => esc(r.osFamily || "—") },
        { key: "status", label: "Status", render: (r) => ui.badge(r.status || "—", r.status === "online" ? "success" : r.status === "offline" ? "danger" : r.status === "stale" ? "warn" : "muted") },
        { key: "detail", label: "Detail", render: (r) => esc(r.detail || "") },
      ];
    }
    function deviceRow(d) { return { deviceId: d.deviceId, hostname: d.hostname, siteName: d.siteName || "", osFamily: d.osFamily || "", status: d.status || "", detail: d.detail || "" }; }

    async function paint() {
      ui.loading(host, "Loading dashboards");
      await compute();
      const tabs = ui.tabs([
        { id: "overview", label: "Overview", badge: asObj(state.snap.alerts).active || null },
        { id: "agents", label: "Agent health", badge: asObj(state.snap.agent).outdated || null },
      ], state.tab);
      const picker = asArr(opts.providers).length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="dash_pid">' + asArr(opts.providers).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === opts.providerId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = '<div class="rmm-dash-inner">' + tabs.html + picker + "</div>";
      const panelEl = host.querySelector('.erp-tab-panel[data-panel="' + state.tab + '"]');
      if (panelEl) panelEl.innerHTML = '<div class="rmm-dash-body">' + (state.tab === "agents" ? agentsTab() : overviewTab()) + "</div>";
    }

    async function openDrill(arg) {
      const parts = String(arg || "").split("|");
      const kind = parts[0], a = parts.slice(1).join("|");
      const res = await FL.affected(opts.providerId, kind, a);
      const rows = asArr(res.rows).map(deviceRow);
      const titles = {
        status: "Devices " + (a || ""), "agent-outdated": "Agents needing an update", "agent-pending": "Updates staged",
        "alert-severity": "Devices with alerts", "alert-age": "Devices with " + a + " alerts",
        "patch-noncompliant": "Patch non-compliant devices", "security-noncompliant": "Security non-compliant devices",
        "backup-problem": "Devices with backup problems", "job-failed": "Devices with failed jobs", "monitor-uncovered": "Devices with no monitor",
      };
      ui.modal({
        title: titles[kind] || "Affected devices",
        size: "lg",
        body: '<p class="erp-modal-note">' + rows.length + " device(s) behind this number.</p>" +
          (rows.length ? ui.table(deviceCols(), rows, { scroll: true }) : '<p class="erp-sub">No affected devices.</p>'),
        foot: ui.btn("Open Devices", { small: true, primary: true, act: "dash-open-devices" }) + " " + ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
      });
      const m = document.querySelector("#uiModal");
      const b = m && m.querySelector("[data-act=dash-open-devices]");
      if (b) b.onclick = () => { ui.closeModal(); ERP.navigate("devices"); };
    }

    function scheduleRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { paint().catch(() => {}); }, 1500);
    }
    function setLive(on) {
      state.live = !!on;
      if (unsub) { unsub(); unsub = null; }
      if (state.live && EV) unsub = EV.on(() => scheduleRefresh());
      paint();
    }

    ui.bind(host, "change", "[name='dash_pid']", (t) => { opts.providerId = t.value; if (opts.onProvider) opts.onProvider(t.value); paint(); });
    ui.bind(host, "click", "[data-tab]", (t) => { const id = t.getAttribute("data-tab"); if (id === "overview" || id === "agents") { state.tab = id; paint(); } });
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      e.preventDefault();
      if (act === "dash-refresh") return paint();
      if (act === "dash-live") return setLive(!state.live);
      if (act === "dash-drill") return openDrill(arg);
      if (act === "dash-open-devices") { ui.closeModal(); return ERP.navigate("devices"); }
    });

    await paint();
    FL.currentProviderId = opts.providerId;
    return {
      state, paint,
      destroy() { if (unsub) unsub(); clearTimeout(refreshTimer); host.innerHTML = ""; },
    };
  };

  FL.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-dash";
    host.appendChild(wrap);
    if (!providers.length) { wrap.innerHTML = ERP.ui.alert("No service providers yet.", "info"); return null; }
    const providerId = opts.providerId || providers[0].id;
    return FL.renderPanel(wrap, { providerId, providers, embedded: true, toast: opts.toast || (() => {}), onProvider: opts.onProvider });
  };

  FL.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const pid = (FL.currentProviderId && providers.some((p) => p.id === FL.currentProviderId)) ? FL.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-dash";
    el.innerHTML = "";
    el.appendChild(root);
    root.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Dashboard", "Live operations dashboard — devices up / down / offline / stale, agent health and version spread, alert load by severity and age, patch / security / backup compliance and job success, with drill-down from every tile to the affected devices."));
    await FL.renderPanel(root, { providerId: pid, providers, embedded: true, toast: ctx.toast, onProvider: () => {} });
    return { pid };
  };

  /* ─────────────────────── boot ─────────────────────── */

  FL.currentProviderId = null;
  let readyResolve;
  FL.ready = new Promise((res) => { readyResolve = res; });
  FL.init = function () { readyResolve(); return FL; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", FL.init);
  else FL.init();
})();
