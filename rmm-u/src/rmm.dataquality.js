/* ============================================================
   RMM-U — data-quality linter  (Phase 10 · Task 43)

   A real RMM accumulates rot: agents that stopped reporting months
   ago, devices nobody owns, monitors whose alerts reach no one,
   duplicate records from two enrollment attempts, groups pointing
   at a deleted site, alerts that can never auto-clear, and scripts
   whose parameters accept anything. None of it breaks the console;
   all of it quietly degrades the service.

   The linter scans one client's aggregate (or every client) and
   reports each problem **with the offending record**, so it can be
   opened, inspected and fixed. It is strictly read-only — the only
   thing it changes is your understanding of the estate.

   Eight checks (see `DQ.CHECKS`):

     agent-stale        liveness      offline past threshold / never seen
     device-unassigned  ownership     no site and no owner
     no-policy          configuration no enabled policy targets it
     duplicate-device   hygiene       shared hostname / serial / MAC
     orphan-group       hygiene       dangling site, or matches nothing
     unrouted-monitor   alerting      no enabled route would deliver it
     alert-stuck        alerting      active but can never auto-clear
     unsafe-script      safety        parameters with no validation bounds

   `DQ.scanProvider(provider, opts)` is a pure, synchronous scan of an
   in-memory provider; `DQ.scan(providerId)` loads state (including the
   notification routes, which live outside the provider aggregate) and
   calls it. The pure helpers (`DQ.duplicateGroups`, `DQ.monitorRouted`,
   `DQ.alertStuck`, `DQ.unsafeParameters`, …) are exposed so the checks
   can be reasoned about and tested in isolation.

   The console is the "Data quality" tab of the Reports station's
   continuity console, wired in `src/rmm.continuity.js`.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy || !ERP.devices) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const G = ERP.groups || null;
  const P = ERP.policies || null;
  const MON = ERP.monitors || null;
  const RT = ERP.routing || null;
  const AL = ERP.alerts || null;
  const LIB = ERP.scripts || null;
  const MC = ERP.masterConfig || null;

  const DQ = (ERP.dataQuality = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const DAY = 86400000;

  const enabled = () => cfg("rmm.dataQualityEnabled", true) !== false;
  const offlineDays = () => Math.max(1, num(cfg("rmm.dqOfflineDays", 7), 7));
  const manualAlertDays = () => Math.max(1, num(cfg("rmm.dqManualAlertDays", 30), 30));
  const duplicateFields = () => String(cfg("rmm.dqDuplicateFields", "hostname,serial") || "")
    .split(",").map(low).filter(Boolean);

  DQ.VERSION = 1;
  DQ.SEVERITY_TONE = { critical: "danger", warning: "warn", info: "info" };
  DQ.SEVERITY_WEIGHT = { critical: 3, warning: 2, info: 1 };
  DQ.DEFAULT_RANKS = { "sev-info": 10, "sev-warning": 20, "sev-critical": 30, "sev-emergency": 40 };

  /* ─────────────────────── the check catalogue ─────────────────────── */

  DQ.CHECKS = [
    { id: "agent-stale", label: "Stale or offline agents", category: "Liveness", severity: "critical",
      desc: "Devices whose agent has not reported within the offline threshold, or has never reported." },
    { id: "device-unassigned", label: "Unassigned devices", category: "Ownership", severity: "warning",
      desc: "Devices with no site and no owner, so nothing ties them to a location or a person." },
    { id: "no-policy", label: "Devices without a policy", category: "Configuration", severity: "info",
      desc: "Devices that no enabled policy targets — they run on schema defaults alone." },
    { id: "duplicate-device", label: "Duplicate device records", category: "Hygiene", severity: "warning",
      desc: "Device records that share a hostname, serial or MAC — usually a re-enrollment that forked a record." },
    { id: "orphan-group", label: "Orphaned groups", category: "Hygiene", severity: "warning",
      desc: "Groups that point at a missing site, or that match no devices at all." },
    { id: "unrouted-monitor", label: "Unrouted monitors", category: "Alerting", severity: "warning",
      desc: "Enabled monitors whose alerts no enabled notification route would deliver, or which match no devices." },
    { id: "alert-stuck", label: "Alerts that can never clear", category: "Alerting", severity: "warning",
      desc: "Active alerts whose monitor or device is gone or disabled, and manual alerts left open too long." },
    { id: "unsafe-script", label: "Scripts with unsafe parameters", category: "Safety", severity: "warning",
      desc: "Script parameters with no validation bounds: an unbounded string or number, or an empty enum." },
  ];

  const CHECK_ORDER = {};
  DQ.CHECKS.forEach((c, i) => { CHECK_ORDER[c.id] = i; });
  DQ.check = (id) => DQ.CHECKS.find((c) => c.id === id) || null;
  DQ.checkLabel = (id) => (DQ.check(id) || {}).label || id;

  DQ.STATIONS = {
    devices: { route: "#/devices", label: "Devices" },
    groups: { route: "#/groups", label: "Groups" },
    policies: { route: "#/policies", label: "Policies" },
    monitors: { route: "#/monitors", label: "Monitors" },
    alerts: { route: "#/alerts", label: "Alerts" },
    automations: { route: "#/automations:library", label: "Script library" },
  };
  DQ.ENTITY_STATION = { device: "devices", group: "groups", monitor: "monitors", alert: "alerts", script: "automations" };
  DQ.stationFor = (type) => DQ.STATIONS[DQ.ENTITY_STATION[type]] || null;

  /* ─────────────────────── small pure helpers ─────────────────────── */

  function devName(dev) { dev = dev || {}; return dev.hostname || dev.displayName || String(dev.id || ""); }

  function ageMsOf(dev, atMs) {
    if (!dev || !dev.lastSeenAt) return null;
    const t = Date.parse(dev.lastSeenAt);
    return isFinite(t) ? Math.max(0, atMs - t) : null;
  }

  function humanDur(ms) {
    ms = Math.max(0, num(ms, 0));
    const m = Math.round(ms / 60000);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60), rm = m % 60;
    if (h < 48) return h + "h" + (rm ? " " + rm + "m" : "");
    const d = ms / DAY;
    return (d >= 10 ? Math.round(d) : d.toFixed(1)) + "d";
  }
  DQ.humanDur = humanDur;

  /* Owner has no first-class field in the device schema: the documented
     conventions are `custom.owner` and a top-level `owner`. Either counts. */
  DQ.ownerOf = function (dev) {
    dev = asObj(dev);
    const c = asObj(dev.custom);
    return String(c.owner || dev.owner || "").trim();
  };

  /* ── duplicate records ── */

  DQ.DUP_FIELD_LABELS = { hostname: "hostname", serial: "serial number", mac: "MAC address", domain: "domain", displayName: "display name" };

  const DUP_GETTERS = {
    hostname: (d) => d.hostname || "",
    displayName: (d) => d.displayName || "",
    serial: (d) => d.serial || "",
    mac: (d) => { try { return D.primaryMac(d) || ""; } catch (e) { return ""; } },
    domain: (d) => d.domain || "",
  };

  /* Group devices by each configured field; return groups of 2+ that
     share a non-empty, normalised value. Pure and deterministic. */
  DQ.duplicateGroups = function (devices, fields) {
    const out = [];
    asArr(fields).forEach((field) => {
      const get = DUP_GETTERS[field];
      if (!get) return;
      const byVal = {};
      asArr(devices).forEach((d) => {
        const v = low(get(d));
        if (!v) return;
        (byVal[v] = byVal[v] || []).push(d);
      });
      Object.keys(byVal).sort().forEach((v) => {
        if (byVal[v].length < 2) return;
        out.push({ field, value: v, devices: byVal[v] });
      });
    });
    return out;
  };

  /* ── monitor → route coverage ── */

  function severityRankFn(rankOf) {
    return (id) => {
      if (!id) return null;
      let r = null;
      try { r = rankOf ? rankOf(id) : null; } catch (e) { r = null; }
      if (r == null) r = DQ.DEFAULT_RANKS[id] == null ? null : DQ.DEFAULT_RANKS[id];
      return r;
    };
  }

  /* The ranks an alert from this monitor can carry: its declared
     severity, and the escalated critical rank a critical state maps to. */
  function ranksForMonitor(monitor, rank) {
    const base = rank(monitor && monitor.severity);
    const crit = rank("sev-critical");
    const set = [];
    if (base != null) set.push(base);
    if (base == null || (crit != null && crit > base)) set.push(crit == null ? 30 : crit);
    return set.length ? set : [20];
  }

  function severityCompatible(route, ranks) {
    const rank = route.__rank || (() => null);
    return ranks.some((r) => {
      if (route.severityAtLeast) { const min = rank(route.severityAtLeast); if (min != null && r < min) return false; }
      if (route.severityAtMost) { const max = rank(route.severityAtMost); if (max != null && r > max) return false; }
      return true;
    });
  }

  function overlap(a, b, norm) {
    const set = asArr(b).map((x) => (norm ? norm(x) : String(x)));
    return asArr(a).some((x) => set.indexOf(norm ? norm(x) : String(x)) !== -1);
  }

  function ints(a) { return asArr(a).map(String).filter(Boolean); }

  /* Could this route deliver an alert raised by this monitor?
     `ctx` = { provider, devices, rankOf }. Returns the route matches
     (optionally including disabled routes for better diagnostics). */
  DQ.monitorRouted = function (monitor, routes, ctx) {
    ctx = ctx || {};
    const provider = ctx.provider || {};
    const devices = asArr(ctx.devices).length ? ctx.devices : asArr(provider.devices);
    const rank = severityRankFn(ctx.rankOf);
    monitor = asObj(monitor);
    const mt = asObj(monitor.targets);

    /* Devices the monitor actually applies to — if none, nothing can fire. */
    const covered = devices.filter((d) => {
      if (d.status === "retired") return false;
      if (G && typeof G.matchTargets === "function") return G.matchTargets(provider, mt, d, { provider }).match;
      const empty = !asArr(mt.groupIds).length && !asArr(mt.tags).length && !asArr(mt.deviceIds).length && !asArr(mt.siteIds).length;
      if (empty) return true;
      if (ints(mt.deviceIds).indexOf(String(d.id)) !== -1) return true;
      if (overlap(mt.tags, d.tags, low)) return true;
      if (ints(mt.siteIds).indexOf(String(d.siteId)) !== -1) return true;
      return overlap(mt.groupIds, d.groupIds, String);
    });

    const coveredIds = covered.map((d) => String(d.id));
    if (!covered.length) return { routed: false, enabledMatches: [], disabledMatches: [], covered: 0 };
    const coveredGroups = [];
    const coveredTags = [];
    const coveredSites = [];
    covered.forEach((d) => {
      let gids = asArr(d.groupIds).map(String);
      if (G && typeof G.membershipIds === "function") { try { gids = G.membershipIds(provider, d, { provider }).map(String); } catch (e) {} }
      gids.forEach((g) => coveredGroups.push(g));
      asArr(d.tags).forEach((t) => coveredTags.push(low(t)));
      if (d.siteId != null && d.siteId !== "") coveredSites.push(String(d.siteId));
    });
    asArr(mt.groupIds).forEach((g) => coveredGroups.push(String(g)));
    asArr(mt.tags).forEach((t) => coveredTags.push(low(t)));
    asArr(mt.siteIds).forEach((s) => coveredSites.push(String(s)));

    const ranks = ranksForMonitor(monitor, rank);
    const matches = { enabled: [], disabled: [] };

    asArr(routes).forEach((raw) => {
      const route = Object.assign({}, asObj(raw));
      route.__rank = rank;
      if (!severityCompatible(route, ranks)) return;
      const ids = ints(route.monitorIds);
      if (ids.length && ids.indexOf(String(monitor.id)) === -1) return;
      const deviceIds = ints(route.deviceIds);
      if (deviceIds.length && !deviceIds.some((id) => coveredIds.indexOf(id) !== -1)) return;
      if (asArr(route.groupIds).length && !overlap(route.groupIds, coveredGroups, String)) return;
      if (asArr(route.tags).length && !overlap(route.tags, coveredTags, low)) return;
      if (asArr(route.siteIds).length && !overlap(route.siteIds, coveredSites, String)) return;
      (route.enabled === false ? matches.disabled : matches.enabled).push(route);
    });

    return { routed: matches.enabled.length > 0, enabledMatches: matches.enabled, disabledMatches: matches.disabled, covered: covered.length };
  };

  /* ── stuck alerts ── */

  /* Reasons a single active alert can never auto-clear. Pure. */
  DQ.alertStuck = function (alert, ctx) {
    ctx = ctx || {};
    alert = asObj(alert);
    const monitorsById = asObj(ctx.monitorsById);
    const devicesById = asObj(ctx.devicesById);
    const atMs = ctx.at ? Date.parse(ctx.at) : Date.now();
    const manualDays = ctx.manualDays == null ? 30 : num(ctx.manualDays, 30);
    const reasons = [];

    const mid = alert.monitorId ? String(alert.monitorId) : "";
    if (mid && !monitorsById[mid]) {
      reasons.push({ code: "monitor-missing", severity: "warning", message: "Its monitor (“" + mid + "”) no longer exists, so nothing can clear it." });
    } else if (mid && monitorsById[mid].enabled === false) {
      reasons.push({ code: "monitor-disabled", severity: "warning", message: "Its monitor “" + (monitorsById[mid].name || mid) + "” is disabled, so nothing will clear it." });
    }
    const did = alert.deviceId ? String(alert.deviceId) : "";
    if (did && !devicesById[did]) {
      reasons.push({ code: "device-missing", severity: "warning", message: "Its device (“" + did + "”) no longer exists in the estate." });
    }
    if (!mid) {
      const fired = Date.parse(alert.firstFiredAt || alert.lastSeenAt || alert.createdAt || "");
      if (isFinite(fired) && atMs - fired > manualDays * DAY) {
        reasons.push({ code: "manual-stale", severity: "info", message: "Manual alert open for " + humanDur(atMs - fired) + " (threshold " + manualDays + "d)." });
      }
    }
    return reasons;
  };

  /* ── unsafe script parameters ── */

  /* Does a single (normalised) parameter leave its value unbounded? */
  DQ.isUnsafeParameter = function (p) {
    p = asObj(p);
    if (p.type === "string") {
      const bounded = !!(p.pattern) || (p.maxLength != null && num(p.maxLength, 0) > 0);
      if (!bounded) return { code: "unbounded-string", severity: "warning", reason: "unbounded string (no pattern or maxLength)" };
      if (typeof p.default === "string" && /[;&|`$()<>]/.test(p.default)) {
        return { code: "metachar-default", severity: "info", reason: "default contains shell metacharacters" };
      }
      return null;
    }
    if (p.type === "enum") {
      if (!asArr(p.options).length) return { code: "empty-enum", severity: "warning", reason: "enum has no options" };
      return null;
    }
    if (p.type === "number") {
      if (p.min == null && p.max == null) return { code: "unbounded-number", severity: "warning", reason: "unbounded number (no min or max)" };
      return null;
    }
    return null;
  };

  DQ.unsafeParameters = function (script) {
    const out = [];
    asArr(asObj(script).parameters).forEach((p) => {
      const r = DQ.isUnsafeParameter(p);
      if (r) out.push({ name: p.name, label: p.label || p.name, type: p.type, code: r.code, reason: r.reason, severity: r.severity });
    });
    return out;
  };

  /* ─────────────────────── context & checks ─────────────────────── */

  function contextOf(provider, opts) {
    opts = opts || {};
    const devices = asArr(provider.devices).map((d) => D.normalizeDevice(d)).filter(Boolean);
    const monitors = MON ? MON.listOf(provider) : asArr(provider.monitorDefinitions);
    const alerts = asArr(provider.alerts);
    return {
      provider,
      at: opts.at || now(),
      devices,
      sites: asArr(provider.sites),
      groups: G ? G.listOf(provider) : asArr(provider.deviceGroups),
      policies: P ? P.listOf(provider) : asArr(provider.policies),
      monitors,
      scripts: LIB ? LIB.listOf(provider) : asArr(provider.scriptLibrary),
      alerts,
      routes: asArr(opts.routes),
      rankOf: opts.rankOf || ((id) => (DQ.DEFAULT_RANKS[id] == null ? null : DQ.DEFAULT_RANKS[id])),
      devicesById: (() => { const m = {}; devices.forEach((d) => { m[String(d.id)] = d; }); return m; })(),
      monitorsById: (() => { const m = {}; monitors.forEach((x) => { m[String(x.id)] = x; }); return m; })(),
    };
  }
  DQ.contextOf = contextOf;

  function mk(check, severity, message, entity, record, hint, station) {
    return {
      check, severity, message,
      entity: { type: entity.type, id: String(entity.id == null ? "" : entity.id), name: S(entity.name, 160) || String(entity.id == null ? "" : entity.id) },
      hint: hint || "",
      station: station || null,
      record: clone(record),
    };
  }

  function checkAgentStale(ctx) {
    const out = [];
    const threshold = offlineDays();
    ctx.devices.forEach((dev) => {
      if (dev.status === "retired") return;
      const live = D.effectiveStatus(dev);
      if (live === "maintenance" || live === "online") return;
      const age = ageMsOf(dev, Date.parse(ctx.at));
      const ageDays = age == null ? null : age / DAY;
      let severity, message;
      if (live === "unknown") {
        severity = "warning";
        message = "Agent has never reported (no last-seen timestamp).";
      } else if (live === "stale") {
        severity = "info";
        message = "Agent heartbeat is stale" + (age != null ? " (" + humanDur(age) + " since last contact)" : "") + ".";
      } else if (ageDays != null && ageDays >= threshold) {
        severity = "critical";
        message = "Agent offline for " + humanDur(age) + " — past the " + threshold + " day threshold.";
      } else {
        severity = "warning";
        message = "Agent offline" + (age != null ? " for " + humanDur(age) : "") + ".";
      }
      out.push(mk("agent-stale", severity, message,
        { type: "device", id: dev.id, name: devName(dev) }, dev,
        "Investigate or re-enroll the agent, or retire the device if it is gone for good.", "devices"));
    });
    return out;
  }

  function checkUnassigned(ctx) {
    const out = [];
    ctx.devices.forEach((dev) => {
      if (dev.status === "retired") return;
      const site = dev.siteId == null || dev.siteId === "" ? "" : String(dev.siteId);
      if (site || DQ.ownerOf(dev)) return;
      out.push(mk("device-unassigned", "warning", "Device has neither a site nor an owner.",
        { type: "device", id: dev.id, name: devName(dev) }, dev,
        "Assign a site on the device, or set custom.owner to name the person responsible.", "devices"));
    });
    return out;
  }

  function checkNoPolicy(ctx) {
    if (!P || typeof P.orderForDevice !== "function") return [];
    const out = [];
    ctx.devices.forEach((dev) => {
      if (dev.status === "retired") return;
      let ordered = [];
      try { ordered = P.orderForDevice(ctx.provider, dev, { provider: ctx.provider }) || []; } catch (e) { ordered = []; }
      if (ordered.length) return;
      out.push(mk("no-policy", "info", "No policy applies — this device runs on schema defaults only.",
        { type: "device", id: dev.id, name: devName(dev) }, dev,
        "Create or retarget a policy so backups, patching and security are governed.", "policies"));
    });
    return out;
  }

  function checkDuplicates(ctx) {
    const out = [];
    DQ.duplicateGroups(ctx.devices, duplicateFields()).forEach((grp) => {
      const label = DQ.DUP_FIELD_LABELS[grp.field] || grp.field;
      grp.devices.forEach((dev) => {
        const peers = grp.devices.filter((x) => String(x.id) !== String(dev.id)).map(devName);
        out.push(mk("duplicate-device", "warning",
          "Shares " + label + " “" + grp.value + "” with " + peers.join(", ") + ".",
          { type: "device", id: dev.id, name: devName(dev) }, dev,
          "Confirm which record is live, then merge or remove the duplicates and the other fields they carry.", "devices"));
      });
    });
    return out;
  }

  function checkGroups(ctx) {
    const out = [];
    const siteIds = {};
    ctx.sites.forEach((s) => { siteIds[String(s.id)] = true; });
    ctx.groups.forEach((grp) => {
      if (grp.siteId != null && grp.siteId !== "" && !siteIds[String(grp.siteId)]) {
        out.push(mk("orphan-group", "warning", "Group points at missing site “" + grp.siteId + "”.",
          { type: "group", id: grp.id, name: grp.name }, grp,
          "Reassign the group to an existing site, or delete it if the site is gone.", "groups"));
      }
      let members = [];
      try {
        members = G ? G.devicesInGroup(ctx.provider, grp, { devices: ctx.devices, ctx: { provider: ctx.provider } }) : [];
      } catch (e) { members = []; }
      if (!members.length) {
        out.push(mk("orphan-group", "info",
          "Group matches no devices" + (grp.kind === "dynamic" ? " (its rule currently selects nothing)" : "") + ".",
          { type: "group", id: grp.id, name: grp.name }, grp,
          "Add members or widen the rule, or delete the group if it is obsolete.", "groups"));
      }
    });
    return out;
  }

  function checkUnrouted(ctx) {
    if (!MON) return [];
    const out = [];
    const anyRoute = ctx.routes.filter((r) => r.enabled !== false);
    ctx.monitors.forEach((mon) => {
      if (!mon.enabled) return;
      const cov = DQ.monitorRouted(mon, ctx.routes, { provider: ctx.provider, devices: ctx.devices, rankOf: ctx.rankOf });
      const entity = { type: "monitor", id: mon.id, name: mon.name };
      if (!cov.covered) {
        out.push(mk("unrouted-monitor", "warning", "Monitor matches no devices, so it can never fire.",
          entity, mon, "Retarget the monitor at a group, tag, site or device that exists.", "monitors"));
        return;
      }
      if (cov.routed) return;
      if (cov.disabledMatches.length) {
        out.push(mk("unrouted-monitor", "warning",
          "Alerts can only reach disabled route(s): " + cov.disabledMatches.map((r) => r.label || r.id).join(", ") + ".",
          entity, mon, "Enable one of the matching routes, or add a new route for this monitor.", "monitors"));
      } else {
        out.push(mk("unrouted-monitor", "warning",
          "No enabled route would deliver alerts from this monitor" + (anyRoute.length ? "" : " (no routes are configured at all)") + ".",
          entity, mon, "Add a route whose severity window and targets cover this monitor.", "monitors"));
      }
    });
    return out;
  }

  function checkStuckAlerts(ctx) {
    if (!AL) return [];
    const out = [];
    const manualDays = manualAlertDays();
    ctx.alerts.forEach((a) => {
      if (AL.ACTIVE.indexOf(a.state) === -1) return;
      const reasons = DQ.alertStuck(a, { monitorsById: ctx.monitorsById, devicesById: ctx.devicesById, at: ctx.at, manualDays });
      if (!reasons.length) return;
      const severity = reasons.reduce((acc, r) => (DQ.SEVERITY_WEIGHT[r.severity] > DQ.SEVERITY_WEIGHT[acc] ? r.severity : acc), "info");
      out.push(mk("alert-stuck", severity, reasons.map((r) => r.message).join(" "),
        { type: "alert", id: a.id, name: a.subject || a.monitorName || a.hostname || a.id }, a,
        "Resolve it manually, or restore the monitor / device so the alert can auto-clear.", "alerts"));
    });
    return out;
  }

  function checkScripts(ctx) {
    if (!LIB) return [];
    const out = [];
    ctx.scripts.forEach((scr) => {
      const bad = DQ.unsafeParameters(scr);
      if (!bad.length) return;
      const active = scr.enabled !== false;
      const severity = bad.some((b) => b.severity === "warning") && active ? "warning" : "info";
      const detail = bad.map((b) => (b.label || b.name) + " — " + b.reason).join("; ");
      out.push(mk("unsafe-script", severity, "Parameter safety gaps: " + detail + ".",
        { type: "script", id: scr.id, name: scr.name }, scr,
        "Bound every parameter: a pattern or maxLength for strings, options for enums, min/max for numbers. Values are still shell-escaped at run time.", "automations"));
    });
    return out;
  }

  const RUNNERS = {
    "agent-stale": checkAgentStale,
    "device-unassigned": checkUnassigned,
    "no-policy": checkNoPolicy,
    "duplicate-device": checkDuplicates,
    "orphan-group": checkGroups,
    "unrouted-monitor": checkUnrouted,
    "alert-stuck": checkStuckAlerts,
    "unsafe-script": checkScripts,
  };

  /* ─────────────────────── scan ─────────────────────── */

  function sortFindings(findings) {
    return findings.map((f, i) => ({ f, i })).sort((a, b) => {
      const w = (DQ.SEVERITY_WEIGHT[b.f.severity] || 0) - (DQ.SEVERITY_WEIGHT[a.f.severity] || 0);
      if (w) return w;
      const c = (CHECK_ORDER[a.f.check] || 0) - (CHECK_ORDER[b.f.check] || 0);
      if (c) return c;
      const n = String(a.f.entity.name).localeCompare(String(b.f.entity.name));
      return n || a.i - b.i;
    }).map((x) => x.f);
  }

  /* Pure, synchronous scan of an in-memory provider aggregate. */
  DQ.scanProvider = function (provider, opts) {
    opts = opts || {};
    provider = asObj(provider);
    const ctx = contextOf(provider, opts);
    const findings = [];
    DQ.CHECKS.forEach((c) => {
      const fn = RUNNERS[c.id];
      if (!fn) return;
      let list = [];
      try { list = fn(ctx) || []; } catch (e) { list = []; }
      findings.push.apply(findings, list);
    });
    const sorted = sortFindings(findings);
    const byCheck = {}, bySeverity = { critical: 0, warning: 0, info: 0 };
    sorted.forEach((f) => {
      byCheck[f.check] = (byCheck[f.check] || 0) + 1;
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    });
    return {
      providerId: provider.id || null,
      providerName: provider.name || String(provider.id || ""),
      at: ctx.at,
      findings: sorted,
      counts: { total: sorted.length, byCheck, bySeverity },
      checks: DQ.CHECKS.map((c) => ({
        id: c.id, label: c.label, category: c.category, severity: c.severity, desc: c.desc,
        count: byCheck[c.id] || 0,
      })),
      scanned: {
        devices: ctx.devices.length, sites: ctx.sites.length, groups: ctx.groups.length,
        policies: ctx.policies.length, monitors: ctx.monitors.length, routes: ctx.routes.length,
        alerts: ctx.alerts.length, scripts: ctx.scripts.length,
      },
    };
  };

  async function severityRanks() {
    if (!MC || typeof MC.section !== "function") return (id) => (DQ.DEFAULT_RANKS[id] == null ? null : DQ.DEFAULT_RANKS[id]);
    try {
      const list = await MC.section("severities");
      const map = {};
      asArr(list).forEach((s) => { if (s && s.enabled !== false && s.id) map[s.id] = num(s.rank, 0); });
      if (!Object.keys(map).length) throw new Error("empty");
      return (id) => (map[id] == null ? (DQ.DEFAULT_RANKS[id] == null ? null : DQ.DEFAULT_RANKS[id]) : map[id]);
    } catch (e) {
      return (id) => (DQ.DEFAULT_RANKS[id] == null ? null : DQ.DEFAULT_RANKS[id]);
    }
  }
  DQ.severityRanks = severityRanks;

  async function loadRoutes(providerId) {
    if (!RT || typeof RT.list !== "function") return [];
    try { return await RT.list("route", providerId); } catch (e) { return []; }
  }
  DQ.loadRoutes = loadRoutes;

  DQ.scan = async function (providerId, opts) {
    opts = opts || {};
    if (!enabled() && opts.force !== true) return { error: "data_quality_disabled" };
    let provider = opts.provider || null;
    if (!provider) {
      if (!providerId) return { error: "no_provider" };
      const g = await T.get(providerId);
      if (g.error) return { error: g.error, providerId };
      provider = g.provider;
    }
    const routes = opts.routes ? asArr(opts.routes) : await loadRoutes(provider.id);
    const rankOf = opts.rankOf || await severityRanks();
    return DQ.scanProvider(provider, Object.assign({}, opts, { routes, rankOf }));
  };

  DQ.scanAll = async function (opts) {
    opts = opts || {};
    if (!enabled() && opts.force !== true) return { error: "data_quality_disabled" };
    const providers = asArr(opts.providers).length ? asArr(opts.providers)
      : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    const rankOf = opts.rankOf || await severityRanks();
    const at = opts.at || now();
    const scans = [];
    for (const p of providers) {
      const g = await T.get(p.id);
      if (g.error) continue;
      scans.push(DQ.scanProvider(g.provider, { routes: await loadRoutes(p.id), rankOf, at }));
    }
    const bySeverity = { critical: 0, warning: 0, info: 0 }, byCheck = {};
    let total = 0;
    scans.forEach((s) => {
      total += s.counts.total;
      Object.keys(s.counts.bySeverity).forEach((k) => { bySeverity[k] = (bySeverity[k] || 0) + s.counts.bySeverity[k]; });
      Object.keys(s.counts.byCheck).forEach((k) => { byCheck[k] = (byCheck[k] || 0) + s.counts.byCheck[k]; });
    });
    return { at, providers: scans.length, total, bySeverity, byCheck, scans };
  };

  DQ.summaryText = function (scan) {
    if (!scan || scan.error) return "Scan unavailable.";
    const c = scan.counts;
    if (!c.total) return "No issues found across " + scan.scanned.devices + " devices.";
    return c.total + " finding(s): " + c.bySeverity.critical + " critical, " + c.bySeverity.warning + " warning, " + c.bySeverity.info + " info.";
  };

  /* ─────────────────────── console ─────────────────────── */

  DQ.renderPanel = async function (panel, opts) {
    if (!panel) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});

    if (!enabled()) {
      panel.innerHTML = ui.alert("The data-quality linter is turned off (set rmm.dataQualityEnabled = true).", "info");
      return null;
    }
    if (!opts.providerId) {
      panel.innerHTML = ui.alert("No service provider selected.", "info");
      return null;
    }

    const state = { scan: null, severity: "all", check: "all", visible: [] };
    const sevBadge = (s) => ui.badge(s, DQ.SEVERITY_TONE[s] || "muted");

    function filtered() {
      const scan = state.scan;
      if (!scan || !scan.findings) return [];
      return scan.findings.filter((f) =>
        (state.severity === "all" || f.severity === state.severity) &&
        (state.check === "all" || f.check === state.check));
    }

    function summaryHtml() {
      const c = state.scan.counts, s = state.scan.scanned;
      const withHits = state.scan.checks.filter((x) => x.count).length;
      return ui.grid([
        ui.statCard({ label: "Findings", value: String(c.total), tone: c.total ? "warn" : "success", sub: c.total ? "need attention" : "all clear" }),
        ui.statCard({ label: "Critical", value: String(c.bySeverity.critical || 0), tone: c.bySeverity.critical ? "danger" : null, sub: "breaks a guarantee" }),
        ui.statCard({ label: "Warning", value: String(c.bySeverity.warning || 0), tone: c.bySeverity.warning ? "warn" : null, sub: "should be fixed" }),
        ui.statCard({ label: "Info", value: String(c.bySeverity.info || 0), sub: "worth a look" }),
        ui.statCard({ label: "Devices scanned", value: String(s.devices), sub: s.groups + " groups · " + s.monitors + " monitors" }),
        ui.statCard({ label: "Checks", value: String(state.scan.checks.length), sub: withHits + " found something" }),
      ], "erp-kpi-grid");
    }

    function controlsHtml() {
      const pidOpts = asArr(opts.providers).map((p) =>
        '<option value="' + esc(p.id) + '"' + (String(p.id) === String(opts.providerId) ? " selected" : "") + ">" + esc(p.name) + "</option>").join("");
      const sevOpts = ["all", "critical", "warning", "info"].map((v) =>
        '<option value="' + v + '"' + (state.severity === v ? " selected" : "") + ">" + (v === "all" ? "All severities" : v.charAt(0).toUpperCase() + v.slice(1)) + "</option>").join("");
      const checkOpts = ['<option value="all">All checks</option>'].concat(state.scan.checks.map((c) =>
        '<option value="' + esc(c.id) + '"' + (state.check === c.id ? " selected" : "") + ">" + esc(c.label) + " (" + c.count + ")</option>")).join("");
      return '<div class="rmm-dq-controls">' +
        (asArr(opts.providers).length > 1 ? '<label class="rmm-dq-ctl"><span>Client</span><select data-dq-pid>' + pidOpts + "</select></label>" : "") +
        '<label class="rmm-dq-ctl"><span>Severity</span><select data-dq-sev>' + sevOpts + "</select></label>" +
        '<label class="rmm-dq-ctl"><span>Check</span><select data-dq-check>' + checkOpts + "</select></label>" +
        '<div class="erp-btn-row">' + ui.btn("Rescan", { small: true, primary: true, act: "dq-rescan" }) + "</div>" +
        '<p class="erp-sub rmm-dq-stamp">Scanned ' + esc(ui.dateTime(state.scan.at)) + "</p>" +
        "</div>";
    }

    function findingsHtml() {
      const scan = state.scan;
      if (!scan.counts.total) {
        return ui.card("Findings", ui.alert(
          "No data-quality issues found. Scanned " + scan.scanned.devices + " devices, " + scan.scanned.groups + " groups, " +
          scan.scanned.monitors + " monitors, " + scan.scanned.alerts + " alerts and " + scan.scanned.scripts +
          " scripts; every check passed.", "success"));
      }
      const rows = state.visible.map((f, i) => ({
        sev: sevBadge(f.severity),
        check: "<b>" + esc(DQ.checkLabel(f.check)) + '</b><div class="erp-sub">' + esc((DQ.check(f.check) || {}).category || "") + "</div>",
        entity: "<b>" + esc(f.entity.name || f.entity.id) + '</b><div class="erp-sub">' + esc(f.entity.type) + " " + esc(f.entity.id) + "</div>",
        finding: esc(f.message),
        actions: ui.btn("View", { small: true, act: "dq-view", arg: String(i) }),
      }));
      const body = rows.length
        ? ui.table([
            { key: "sev", label: "Severity", width: "100px", render: (r) => r.sev },
            { key: "check", label: "Check", width: "180px", render: (r) => r.check },
            { key: "entity", label: "Record", width: "220px", render: (r) => r.entity },
            { key: "finding", label: "Finding", render: (r) => r.finding },
            { key: "actions", label: "", width: "80px", render: (r) => r.actions },
          ], rows, { scroll: true })
        : ui.alert("No findings match the current filter. Clear the filters to see all " + scan.counts.total + ".", "info");
      return ui.card("Findings (" + rows.length + " of " + scan.counts.total + ")", body);
    }

    function checksHtml() {
      const rows = state.scan.checks.map((c) => ({
        sev: sevBadge(c.severity),
        check: "<b>" + esc(c.label) + '</b><div class="erp-sub">' + esc(c.id) + "</div>",
        category: ui.badge(c.category, "muted"),
        desc: esc(c.desc),
        found: c.count ? ui.badge(String(c.count), "warn") : '<span class="erp-sub">none</span>',
      }));
      return ui.card("Checks (" + rows.length + ")",
        '<p class="erp-sub">Every check is read-only: the linter names the offending record, it never changes it.</p>' +
        ui.table([
          { key: "sev", label: "Default", width: "100px", render: (r) => r.sev },
          { key: "check", label: "Check", width: "220px", render: (r) => r.check },
          { key: "category", label: "Category", width: "130px", render: (r) => r.category },
          { key: "desc", label: "What it looks for", render: (r) => r.desc },
          { key: "found", label: "Found", width: "90px", align: "right", render: (r) => r.found },
        ], rows, { scroll: true }));
    }

    function paint() {
      const scan = state.scan;
      if (!scan || scan.error) {
        panel.innerHTML = ui.alert("Scan failed: " + ((scan && scan.error) || "unknown error") + ".", "danger");
        return;
      }
      state.visible = filtered();
      panel.innerHTML = summaryHtml() + controlsHtml() + findingsHtml() + checksHtml();
      bind();
    }

    function bind() {
      panel.onclick = (e) => {
        const a = e.target.closest && e.target.closest("[data-act]");
        if (!a || !panel.contains(a)) return;
        e.preventDefault();
        const act = a.getAttribute("data-act"), arg = a.getAttribute("data-arg");
        if (act === "dq-rescan") return reload();
        if (act === "dq-view") return openFinding(num(arg, 0));
      };
      const pid = panel.querySelector("[data-dq-pid]");
      if (pid) pid.onchange = () => { opts.providerId = pid.value; if (opts.onProvider) opts.onProvider(pid.value); reload(); };
      const sev = panel.querySelector("[data-dq-sev]");
      if (sev) sev.onchange = () => { state.severity = sev.value; paint(); };
      const ck = panel.querySelector("[data-dq-check]");
      if (ck) ck.onchange = () => { state.check = ck.value; paint(); };
    }

    function openFinding(i) {
      const f = state.visible[i];
      if (!f) return;
      const station = f.station ? (DQ.STATIONS[f.station] || null) : null;
      const recordText = JSON.stringify(f.record == null ? {} : f.record, null, 2);
      ui.modal({
        title: DQ.checkLabel(f.check) + " · " + (f.entity.name || f.entity.id),
        size: "lg",
        body: '<p class="erp-modal-note">' + sevBadge(f.severity) + " <b>" + esc(DQ.checkLabel(f.check)) + "</b> — " + esc(f.message) + "</p>" +
          (f.hint ? '<p class="erp-sub">' + esc(f.hint) + "</p>" : "") +
          '<div class="rmm-dq-record"><div class="rmm-dq-record-head">Offending record · ' + esc(f.entity.type) + " <code>" + esc(f.entity.id) + '</code></div><pre>' + esc(recordText) + "</pre></div>",
        foot: (station ? ui.btn("Go to " + station.label, { small: true, primary: true, act: "dq-goto" }) + " " : "") +
          ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
      });
      const m = document.querySelector("#uiModal");
      if (!m) return;
      const go = m.querySelector('[data-act="dq-goto"]');
      if (go && station) go.onclick = () => { ui.closeModal(); location.hash = station.route; };
    }

    async function reload() {
      ui.loading(panel, "Scanning for data-quality issues");
      try { state.scan = await DQ.scan(opts.providerId, {}); }
      catch (e) { state.scan = { error: (e && e.message) || "scan_failed" }; }
      paint();
      if (state.scan && !state.scan.error) toast(DQ.summaryText(state.scan));
      return state.scan;
    }

    await reload();
    return { state, paint, reload, host: panel };
  };

  DQ.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui;
    if (!asArr(opts.providers).length) {
      opts = Object.assign({}, opts, { providers: (await T.list({ force: true })).filter((p) => p.status !== "archived") });
    }
    if (!opts.providerId && asArr(opts.providers).length) {
      opts = Object.assign({}, opts, { providerId: opts.providers[0].id });
    }
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-dataquality";
    host.appendChild(wrap);
    if (!opts.providerId) { wrap.innerHTML = ui.alert("No service providers yet.", "info"); return null; }
    return DQ.renderPanel(wrap, opts);
  };

  /* ─────────────────────── boot ─────────────────────── */

  DQ.currentProviderId = null;
  let readyResolve;
  DQ.ready = new Promise((res) => { readyResolve = res; });
  DQ.init = function () { try { readyResolve(); } catch (e) {} return DQ; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", DQ.init);
  else DQ.init();
})();
