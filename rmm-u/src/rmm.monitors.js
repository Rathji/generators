/* ============================================================
   RMM-U — monitor catalogue  (Phase 4 · Task 20)

   A monitor definition lives on the provider aggregate
   (`provider.monitorDefinitions`) and pairs a TYPE with:
     • targets   — devices / tags / groups / sites (shared with groups
                   and policies via ERP.groups.matchTargets)
     • thresholds — the warning/critical boundaries
     • settings  — the type-specific configuration (which service,
                   which URL, which EventID, which OID …)
     • a "for N minutes" duration the condition must PERSIST before it
       fires, and the severity it raises
     • overrides — per-device or per-group threshold/setting tweaks

   The catalogue covers the whole RMM surface: up/down, CPU / memory /
   disk thresholds, service & process state, Windows event log,
   application / port / web checks, a custom script monitor that returns
   a status or a value, SNMP/network devices, agent-offline/stale, and
   patch / AV / backup monitors — each entry declaring its own settings
   schema and default thresholds, which drives both the editor and the
   validation.

   `MON.evaluate()` turns a reading into a state; `MON.assess()` adds the
   duration so a momentary blip never fires an alert, and reports when a
   condition fires or clears.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const G = ERP.groups || null;
  const MET = ERP.metrics || null;
  const INV = ERP.rmmInventory || null;
  const M = (ERP.monitors = {});

  const SEV_LABELS = { "sev-info": "Info", "sev-warning": "Warning", "sev-critical": "Critical", "sev-emergency": "Emergency" };
  const sevLabel = (id) => (ERP.policies && typeof ERP.policies.severityLabel === "function" ? ERP.policies.severityLabel(id) : (SEV_LABELS[id] || id));
  M.severityLabel = sevLabel;

  M.MODULE = "monitors";
  M.ID_PREFIX = "mon";
  M.STATES = ["ok", "warning", "critical", "unknown"];
  M.DEFAULT_SEVERITY = "sev-warning";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const uniq = (a) => [...new Set(a)];

  function defaultForMinutes() { return Math.max(0, num(cfg("rmm.monitorForMinutes", 5), 5)); }
  function defaultInterval() { return Math.max(10, num(cfg("rmm.monitorIntervalSeconds", 60), 60)); }
  M.defaultForMinutes = defaultForMinutes;
  M.defaultInterval = defaultInterval;

  /* ─────────────────────── the type catalogue ───────────────────────

     Each entry declares:
       category   matches the master-config monitor-type categories
       settings   the type-specific configuration fields
       thresholds the numeric boundaries (with a direction), or []
       probe      true when evaluation needs a live probe (web/port/
                  script/snmp) rather than a stored reading            */

  const TYPES = [
    {
      id: "updown", label: "Up / down", category: "availability", icon: "monitors",
      desc: "Is the device reachable? A failed-check count turns a blip into a down state.",
      settings: [
        { key: "check", label: "Check method", type: "select", options: ["icmp", "tcp", "agent"], default: "agent" },
        { key: "timeoutSeconds", label: "Timeout", type: "number", unit: "seconds", default: 5, min: 1 },
        { key: "retries", label: "Retries", type: "number", default: 2, min: 0 },
      ],
      thresholds: [{ key: "downChecks", label: "Failed checks before down", default: 1, direction: "above" }],
      defaults: { severity: "sev-critical", forMinutes: 0, intervalSeconds: 60 },
    },
    {
      id: "cpu", label: "CPU utilisation", category: "performance", icon: "monitors",
      desc: "Fires when total CPU utilisation stays above the warning / critical percentage.",
      settings: [{ key: "scope", label: "Scope", type: "select", options: ["total", "per-core"], default: "total" }],
      thresholds: [
        { key: "warning", label: "Warning at", unit: "%", default: 85, direction: "above" },
        { key: "critical", label: "Critical at", unit: "%", default: 95, direction: "above" },
      ],
      defaults: { severity: "sev-warning", forMinutes: 5, intervalSeconds: 60 },
    },
    {
      id: "memory", label: "Memory utilisation", category: "performance", icon: "monitors",
      desc: "Fires when used memory stays above the warning / critical percentage.",
      settings: [],
      thresholds: [
        { key: "warning", label: "Warning at", unit: "%", default: 85, direction: "above" },
        { key: "critical", label: "Critical at", unit: "%", default: 95, direction: "above" },
      ],
      defaults: { severity: "sev-warning", forMinutes: 5, intervalSeconds: 60 },
    },
    {
      id: "disk", label: "Disk space", category: "performance", icon: "monitors",
      desc: "Fires when volume usage stays above the warning / critical percentage.",
      settings: [{ key: "volume", label: "Volume", type: "text", default: "", ph: "blank = every volume" }],
      thresholds: [
        { key: "warning", label: "Warning at", unit: "%", default: 85, direction: "above" },
        { key: "critical", label: "Critical at", unit: "%", default: 95, direction: "above" },
      ],
      defaults: { severity: "sev-warning", forMinutes: 10, intervalSeconds: 300 },
    },
    {
      id: "service", label: "Service state", category: "service", icon: "monitors",
      desc: "Fires when a Windows service / systemd unit is not in the expected state.",
      settings: [
        { key: "name", label: "Service name", type: "text", default: "", required: true, ph: "e.g. Spooler" },
        { key: "expectedState", label: "Expected state", type: "select", options: ["running", "stopped"], default: "running" },
      ],
      thresholds: [],
      probe: false,
      defaults: { severity: "sev-critical", forMinutes: 5, intervalSeconds: 60 },
    },
    {
      id: "process", label: "Process state", category: "process", icon: "monitors",
      desc: "Fires when a process is missing (or, if stopped is expected, present).",
      settings: [
        { key: "name", label: "Process name", type: "text", default: "", required: true, ph: "e.g. chrome" },
        { key: "expected", label: "Expected", type: "select", options: ["present", "absent"], default: "present" },
        { key: "minCount", label: "Minimum instances", type: "number", default: 1, min: 0 },
      ],
      thresholds: [],
      defaults: { severity: "sev-warning", forMinutes: 5, intervalSeconds: 60 },
    },
    {
      id: "eventlog", label: "Windows event log", category: "eventlog", icon: "monitors",
      desc: "Matches events by log, source, EventID and level — fires when matches accumulate.",
      settings: [
        { key: "log", label: "Log", type: "select", options: ["System", "Application", "Security"], default: "System" },
        { key: "source", label: "Source", type: "text", default: "", ph: "blank = any" },
        { key: "eventId", label: "Event ID", type: "text", default: "", ph: "e.g. 6008" },
        { key: "level", label: "Level", type: "select", options: ["any", "Information", "Warning", "Error", "Critical"], default: "Error" },
      ],
      thresholds: [{ key: "count", label: "Matches before firing", default: 1, direction: "above" }],
      defaults: { severity: "sev-warning", forMinutes: 0, intervalSeconds: 300 },
    },
    {
      id: "application", label: "Application check", category: "application", icon: "monitors",
      desc: "Checks that an application is running as a process, a service or on a listening port.",
      settings: [
        { key: "check", label: "Check", type: "select", options: ["process", "service", "port"], default: "process" },
        { key: "name", label: "Application / service", type: "text", default: "", required: true, ph: "e.g. sqlservr" },
        { key: "port", label: "Port", type: "number", default: 0, min: 0, ph: "when checking a port" },
      ],
      thresholds: [],
      defaults: { severity: "sev-critical", forMinutes: 5, intervalSeconds: 120 },
    },
    {
      id: "port", label: "TCP / UDP port", category: "network", icon: "monitors",
      desc: "Opens a socket to a host and port and reports whether it accepts a connection.",
      settings: [
        { key: "host", label: "Host", type: "text", default: "127.0.0.1" },
        { key: "port", label: "Port", type: "number", default: 443, min: 1, required: true },
        { key: "protocol", label: "Protocol", type: "select", options: ["tcp", "udp"], default: "tcp" },
        { key: "timeoutSeconds", label: "Timeout", type: "number", unit: "seconds", default: 5, min: 1 },
      ],
      thresholds: [],
      probe: true,
      defaults: { severity: "sev-critical", forMinutes: 2, intervalSeconds: 60 },
    },
    {
      id: "web", label: "Web / HTTP check", category: "application", icon: "monitors",
      desc: "Requests a URL and checks the status code, body and response time.",
      settings: [
        { key: "url", label: "URL", type: "text", default: "", required: true, ph: "https://example.com/health" },
        { key: "method", label: "Method", type: "select", options: ["GET", "HEAD", "POST"], default: "GET" },
        { key: "expectStatus", label: "Expected status", type: "number", default: 200 },
        { key: "expectBody", label: "Expected body contains", type: "text", default: "" },
        { key: "timeoutSeconds", label: "Timeout", type: "number", unit: "seconds", default: 15, min: 1 },
        { key: "followRedirects", label: "Follow redirects", type: "bool", default: true },
      ],
      thresholds: [{ key: "responseMs", label: "Slow response over", unit: "ms", default: 3000, direction: "above", severity: "warning" }],
      probe: true,
      defaults: { severity: "sev-critical", forMinutes: 3, intervalSeconds: 120 },
    },
    {
      id: "script", label: "Custom script", category: "script", icon: "automations",
      desc: "Runs a script and evaluates its exit code and/or a numeric value it prints.",
      settings: [
        { key: "language", label: "Language", type: "select", options: ["bash", "powershell", "python"], default: "bash" },
        { key: "script", label: "Script", type: "textarea", default: "", required: true, ph: "exit non-zero or print a value" },
        { key: "expectExitCode", label: "Expected exit code", type: "number", default: 0 },
        { key: "expectOutput", label: "Expected output contains", type: "text", default: "" },
      ],
      thresholds: [
        { key: "warning", label: "Value warning above", default: null, direction: "above" },
        { key: "critical", label: "Value critical above", default: null, direction: "above" },
      ],
      probe: true,
      defaults: { severity: "sev-warning", forMinutes: 0, intervalSeconds: 300 },
    },
    {
      id: "snmp", label: "SNMP / network device", category: "snmp", icon: "monitors",
      desc: "Polls an OID on a network device and compares the numeric result to the thresholds.",
      settings: [
        { key: "host", label: "Host", type: "text", default: "", required: true, ph: "10.0.0.1" },
        { key: "version", label: "Version", type: "select", options: ["1", "2c", "3"], default: "2c" },
        { key: "community", label: "Community", type: "text", default: "public" },
        { key: "oid", label: "OID", type: "text", default: "", required: true, ph: "1.3.6.1.2.1.1.3.0" },
        { key: "operator", label: "Operator", type: "select", options: [">", ">=", "<", "<=", "==", "!="], default: ">" },
      ],
      thresholds: [
        { key: "warning", label: "Warning value", default: null, direction: "above" },
        { key: "critical", label: "Critical value", default: null, direction: "above" },
      ],
      probe: true,
      defaults: { severity: "sev-warning", forMinutes: 5, intervalSeconds: 300 },
    },
    {
      id: "agent", label: "Agent offline / stale", category: "availability", icon: "devices",
      desc: "Fires when the agent stops checking in — stale after N minutes, offline after M.",
      settings: [
        { key: "staleAfterMinutes", label: "Stale after", type: "number", unit: "minutes", default: 5, min: 1 },
        { key: "offlineAfterMinutes", label: "Offline after", type: "number", unit: "minutes", default: 15, min: 1 },
      ],
      thresholds: [],
      defaults: { severity: "sev-critical", forMinutes: 0, intervalSeconds: 60 },
    },
    {
      id: "patch", label: "Patch compliance", category: "patch", icon: "patches",
      desc: "Fires when the number of missing patches (optionally of given classifications) exceeds the threshold.",
      settings: [
        { key: "classifications", label: "Classifications", type: "list", default: ["CriticalUpdates", "SecurityUpdates"], ph: "comma-separated; blank = any" },
        { key: "graceDays", label: "Grace for new patches", type: "number", unit: "days", default: 0, min: 0 },
      ],
      thresholds: [{ key: "missingCount", label: "Missing patches over", default: 0, direction: "above" }],
      defaults: { severity: "sev-warning", forMinutes: 0, intervalSeconds: 3600 },
    },
    {
      id: "av", label: "Antivirus / EDR", category: "security", icon: "security",
      desc: "Fires when real-time protection is off or the definitions are older than the threshold.",
      settings: [
        { key: "product", label: "Product", type: "text", default: "", ph: "blank = any detected product" },
        { key: "requireRealTime", label: "Require real-time protection", type: "bool", default: true },
      ],
      thresholds: [{ key: "definitionAgeHours", label: "Definitions older than", unit: "hours", default: 48, direction: "above" }],
      defaults: { severity: "sev-critical", forMinutes: 0, intervalSeconds: 3600 },
    },
    {
      id: "backup", label: "Backup verification", category: "backup", icon: "reports",
      desc: "Fires when the last successful backup is older than the threshold, or the last run failed.",
      settings: [
        { key: "jobName", label: "Backup job", type: "text", default: "", ph: "blank = any" },
        { key: "requireSuccess", label: "Require success", type: "bool", default: true },
      ],
      thresholds: [{ key: "maxAgeHours", label: "No successful backup within", unit: "hours", default: 26, direction: "above" }],
      defaults: { severity: "sev-critical", forMinutes: 0, intervalSeconds: 3600 },
    },
  ];

  const TYPE_INDEX = {};
  TYPES.forEach((t) => { TYPE_INDEX[t.id] = t; });
  M.TYPES = TYPES;
  M.CATEGORIES = uniq(TYPES.map((t) => t.category));
  M.type = (id) => TYPE_INDEX[id] || null;
  M.typeLabel = (id) => (TYPE_INDEX[id] || {}).label || id;
  M.types = (category) => TYPES.filter((t) => !category || t.category === category).map((t) => ({ id: t.id, label: t.label, category: t.category, desc: t.desc, probe: !!t.probe }));
  M.settingDef = (type, key) => { const t = TYPE_INDEX[type]; return t ? (t.settings.find((f) => f.key === key) || null) : null; };
  M.thresholdDef = (type, key) => { const t = TYPE_INDEX[type]; return t ? (t.thresholds.find((f) => f.key === key) || null) : null; };

  function typeDefaults(id) {
    const t = TYPE_INDEX[id] || {};
    const d = Object.assign({ severity: M.DEFAULT_SEVERITY, forMinutes: defaultForMinutes(), intervalSeconds: defaultInterval() }, asObj(t.defaults));
    return {
      severity: d.severity, forMinutes: num(d.forMinutes, defaultForMinutes()), intervalSeconds: Math.max(10, num(d.intervalSeconds, defaultInterval())),
      settings: settingsDefaults(t),
      thresholds: thresholdsDefaults(t),
    };
  }
  M.typeDefaults = typeDefaults;

  function settingsDefaults(t) {
    const out = {};
    asArr(asObj(t).settings).forEach((f) => { if (f.default !== undefined) out[f.key] = clone(f.default); });
    return out;
  }
  function thresholdsDefaults(t) {
    const out = {};
    asArr(asObj(t).thresholds).forEach((f) => { if (f.default !== undefined) out[f.key] = clone(f.default); });
    return out;
  }

  /* ─────────────────────── normalisation ─────────────────────── */

  function normalizeThresholds(type, raw, defaults) {
    const t = TYPE_INDEX[type];
    const out = {};
    if (!t) return out;
    const r = asObj(raw);
    t.thresholds.forEach((f) => {
      const has = Object.prototype.hasOwnProperty.call(r, f.key);
      let v = has ? r[f.key] : (defaults ? f.default : undefined);
      if (v == null || v === "") return;
      if (f.type === "bool") v = !!v; else v = num(v, f.default);
      out[f.key] = v;
    });
    return out;
  }

  function normalizeSettingsFor(type, raw, defaults) {
    const t = TYPE_INDEX[type];
    const out = {};
    if (!t) return out;
    const r = asObj(raw);
    t.settings.forEach((f) => {
      const has = Object.prototype.hasOwnProperty.call(r, f.key);
      let v = has ? r[f.key] : (defaults ? f.default : undefined);
      if (v == null || v === "") return;
      if (f.type === "bool") v = !!v;
      else if (f.type === "number") v = num(v, f.default);
      else if (f.type === "list") v = uniq((Array.isArray(v) ? v : String(v).split(",")).map((x) => S(x, 60).trim()).filter(Boolean));
      else v = S(v, 2000);
      out[f.key] = v;
    });
    return out;
  }

  function normalizeOverride(type, raw) {
    raw = asObj(raw);
    const scope = raw.scope === "device" ? "device" : (raw.scope === "group" ? "group" : "device");
    const ov = { scope, id: String(raw.id || "") };
    if (raw.enabled !== undefined) ov.enabled = !!raw.enabled;
    if (raw.severity) ov.severity = S(raw.severity, 40);
    const th = normalizeThresholds(type, raw.thresholds, false);
    if (Object.keys(th).length) ov.thresholds = th;
    const st = normalizeSettingsFor(type, raw.settings, false);
    if (Object.keys(st).length) ov.settings = st;
    return ov;
  }

  function normalizeMonitor(data) {
    data = asObj(data);
    const type = M.type(data.type) ? data.type : "cpu";
    const defaults = typeDefaults(type);
    const targets = asObj(data.targets);
    return {
      kind: "monitor",
      id: data.id || T.newItemId("monitorDefinitions"),
      name: S(data.name, 120) || "Untitled monitor",
      type,
      description: S(data.description, 600),
      enabled: data.enabled === undefined ? true : !!data.enabled,
      severity: S(data.severity, 40) || defaults.severity,
      targets: {
        groupIds: uniq(asArr(targets.groupIds).map(String)),
        tags: uniq(asArr(targets.tags).map(String)),
        deviceIds: uniq(asArr(targets.deviceIds).map(String)),
        siteIds: uniq(asArr(targets.siteIds).map(String)),
      },
      intervalSeconds: Math.max(10, num(data.intervalSeconds, defaults.intervalSeconds)),
      forMinutes: Math.max(0, num(data.forMinutes, defaults.forMinutes)),
      thresholds: normalizeThresholds(type, data.thresholds, true),
      settings: normalizeSettingsFor(type, data.settings, true),
      overrides: asArr(data.overrides).map((o) => normalizeOverride(type, o)).filter((o) => o.id),
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };
  }
  M.normalizeMonitor = normalizeMonitor;
  M.newMonitor = normalizeMonitor;

  M.validate = function (monitor) {
    const errors = [];
    if (!monitor || typeof monitor !== "object") return { valid: false, errors: ["monitor is not an object"] };
    if (!String(monitor.name || "").trim()) errors.push("name is required");
    const t = M.type(monitor.type);
    if (!t) errors.push("unknown monitor type: " + monitor.type);
    else t.settings.forEach((f) => { if (f.required && (monitor.settings[f.key] == null || monitor.settings[f.key] === "")) errors.push("setting required: " + f.label); });
    if (monitor.severity && !/^sev-/.test(monitor.severity)) errors.push("invalid severity: " + monitor.severity);
    if (num(monitor.intervalSeconds, 0) < 10) errors.push("intervalSeconds must be >= 10");
    asArr(monitor.overrides).forEach((o, i) => {
      if (!o.id) errors.push("override " + (i + 1) + ": missing target id");
      if (o.scope !== "device" && o.scope !== "group") errors.push("override " + (i + 1) + ": invalid scope " + o.scope);
    });
    return { valid: errors.length === 0, errors };
  };

  M.summary = function (monitor) {
    const t = M.type(monitor && monitor.type) || {};
    const th = asObj(monitor && monitor.thresholds);
    const st = asObj(monitor && monitor.settings);
    const bits = [];
    Object.keys(th).forEach((k) => { if (th[k] != null && th[k] !== "") { const f = M.thresholdDef(monitor.type, k) || { label: k }; bits.push(f.label + " " + th[k] + (f.unit || "")); } });
    Object.keys(st).forEach((k) => { const v = st[k]; if (v == null || v === "" || v === false) return; const f = M.settingDef(monitor.type, k) || { label: k }; bits.push(f.label + ": " + (Array.isArray(v) ? v.join(", ") : v)); });
    return bits.length ? bits.join(" · ") : (t.desc || "");
  };

  /* ─────────────────────── reads ─────────────────────── */

  M.get = async function (providerId, monitorId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const mon = asArr(g.provider.monitorDefinitions).find((x) => String(x.id) === String(monitorId));
    if (!mon) return { error: "not_found", monitorId };
    return { monitor: normalizeMonitor(mon), provider: g.provider, rev: g.rev };
  };

  M.list = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(g.provider.monitorDefinitions).map(normalizeMonitor);
  };

  M.listOf = (provider) => asArr(provider && provider.monitorDefinitions).map(normalizeMonitor);
  M.forGroup = (provider, groupId) => M.listOf(provider).filter((m) => asArr(m.targets.groupIds).some((g) => String(g) === String(groupId)));
  M.forTag = (provider, tag) => M.listOf(provider).filter((m) => asArr(m.targets.tags).map(low).indexOf(low(tag)) !== -1);

  M.statsOf = function (provider) {
    const monitors = M.listOf(provider);
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const byType = {}, byCategory = {}, bySeverity = {};
    monitors.forEach((m) => {
      byType[m.type] = (byType[m.type] || 0) + 1;
      const t = M.type(m.type) || {};
      byCategory[t.category || "other"] = (byCategory[t.category || "other"] || 0) + 1;
      bySeverity[m.severity] = (bySeverity[m.severity] || 0) + 1;
    });
    let covered = 0;
    if (G) {
      devices.forEach((d) => { if (monitors.some((m) => G.matchTargets(provider, m.targets, d, { provider }).match)) covered++; });
    }
    return {
      total: monitors.length,
      enabled: monitors.filter((m) => m.enabled).length,
      disabled: monitors.filter((m) => !m.enabled).length,
      types: Object.keys(byType).length, byType, byCategory, bySeverity,
      overrides: monitors.reduce((a, m) => a + m.overrides.length, 0),
      devices: devices.length, covered, uncovered: devices.length - covered,
    };
  };

  M.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return M.statsOf(g.provider);
  };

  /* ─────────────────────── CRUD ─────────────────────── */

  M.add = async function (providerId, data) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const mon = normalizeMonitor(data);
    const v = M.validate(mon);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await T.addItem(providerId, "monitorDefinitions", mon);
    if (r.error) return r;
    return { monitor: normalizeMonitor(r.item), rev: r.rev };
  };

  M.update = async function (providerId, monitorId, patch) {
    const g = await T.get(providerId);
    if (g.error) return g;
    let out = null;
    const r = await T.updateItem(providerId, "monitorDefinitions", monitorId, (it) => {
      const merged = Object.assign({}, it, asObj(patch), { id: it.id, kind: "monitor", createdAt: it.createdAt });
      const norm = normalizeMonitor(merged);
      Object.assign(it, norm, { id: it.id, kind: "monitor", createdAt: it.createdAt });
      out = it;
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", monitorId };
    return { monitor: normalizeMonitor(out), rev: r.rev };
  };

  M.remove = async function (providerId, monitorId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const r = await T.removeItem(providerId, "monitorDefinitions", monitorId);
    if (r.error) return r;
    return { removed: monitorId };
  };

  M.setEnabled = (providerId, monitorId, enabled) => M.update(providerId, monitorId, { enabled: !!enabled });

  /* ─────────────────────── targeting & overrides ─────────────────────── */

  M.appliesTo = function (provider, monitor, dev, ctx) {
    if (!monitor || !monitor.enabled) return { match: false, matchedBy: null, specificity: 0 };
    if (G && typeof G.matchTargets === "function") return G.matchTargets(provider, monitor.targets, dev, ctx || { provider });
    return { match: true, matchedBy: "provider", specificity: 0 };
  };

  /* Resolve the thresholds/settings a given device actually sees, applying
     group overrides then device overrides on top of the monitor's own
     values. Returns where each value came from. */
  M.effective = function (monitor, device, provider, ctx) {
    const base = {
      enabled: monitor.enabled,
      severity: monitor.severity,
      intervalSeconds: monitor.intervalSeconds,
      forMinutes: monitor.forMinutes,
      thresholds: clone(monitor.thresholds || {}),
      settings: clone(monitor.settings || {}),
    };
    const sources = { thresholds: "monitor", settings: "monitor", severity: "monitor", enabled: "monitor" };
    const groups = provider && G ? G.membershipIds(provider, device, ctx || { provider }) : asArr(device && device.groupIds);
    const ovs = asArr(monitor.overrides).slice().sort((a, b) => (a.scope === "group" ? 0 : 1) - (b.scope === "group" ? 0 : 1));
    ovs.forEach((ov) => {
      const applies = ov.scope === "device" ? String(ov.id) === String(device && device.id) : groups.indexOf(String(ov.id)) !== -1;
      if (!applies) return;
      if (ov.enabled != null) { base.enabled = !!ov.enabled; sources.enabled = ov.scope; }
      if (ov.severity) { base.severity = ov.severity; sources.severity = ov.scope; }
      if (ov.thresholds && Object.keys(ov.thresholds).length) { base.thresholds = Object.assign({}, base.thresholds, ov.thresholds); sources.thresholds = ov.scope; }
      if (ov.settings && Object.keys(ov.settings).length) { base.settings = Object.assign({}, base.settings, ov.settings); sources.settings = ov.scope; }
    });
    return Object.assign(base, { sources });
  };
  M.effectiveThresholds = (monitor, device, provider, ctx) => M.effective(monitor, device, provider, ctx).thresholds;

  /* ─────────────────────── readings ─────────────────────── */

  M.latestReading = async function (providerId, device) {
    let dev = device;
    if (typeof device === "string" || typeof device === "number") {
      const r = await D.get(providerId, device);
      dev = r.error ? null : r.device;
    }
    if (!dev) return { error: "device_not_found" };
    const deviceId = String(dev.id);
    let metrics = null, services = [], patches = [], software = [];
    try { metrics = MET ? await MET.latest(deviceId) : null; } catch (e) {}
    try {
      if (INV && typeof INV.snapshot === "function") {
        const snap = await INV.snapshot(deviceId);
        if (snap && snap.sections) { services = asArr(snap.sections.services); patches = asArr(snap.sections.patches); software = asArr(snap.sections.software); }
      }
    } catch (e) {}
    const inv = asObj(asObj(dev.custom).inventory);
    return {
      deviceId, at: now(),
      status: D.effectiveStatus(dev), lastSeenAt: dev.lastSeenAt || "",
      metrics: asObj(metrics),
      processes: asArr(asObj(metrics).topProcesses),
      services, patches, software,
      security: asObj(inv.security), backup: asObj(inv.backup),
      custom: asObj(dev.custom),
    };
  };

  /* ─────────────────────── evaluation ─────────────────────── */

  function breach(value, threshold, direction) {
    if (value == null || threshold == null || threshold === "") return false;
    const v = Number(value), t = Number(threshold);
    if (!isFinite(v) || !isFinite(t)) return false;
    return direction === "below" ? v <= t : v >= t;
  }
  M.breach = breach;

  function numericState(value, th, direction) {
    if (value == null || value === "" || !isFinite(Number(value))) return { state: "unknown", value: null };
    const v = Number(value);
    if (breach(v, th.critical, direction)) return { state: "critical", value: v };
    if (breach(v, th.warning, direction)) return { state: "warning", value: v };
    return { state: "ok", value: v };
  }
  M.numericState = numericState;

  /* Turn a reading into a state. `opts` carries the effective thresholds,
     settings and (for probe types) the probe result. Pure — no I/O. */
  M.evaluate = function (type, reading, opts) {
    opts = opts || {};
    reading = asObj(reading);
    const th = asObj(opts.thresholds);
    const st = asObj(opts.settings);
    const probe = opts.probe ? asObj(opts.probe) : null;
    const metrics = asObj(reading.metrics);

    switch (type) {
      case "updown": {
        const s = reading.status;
        if (s === "online") return { state: "ok", value: s, message: "Device is up." };
        if (s === "maintenance") return { state: "ok", value: s, message: "In maintenance." };
        if (s === "stale") return { state: "warning", value: s, message: "Device has not checked in recently." };
        if (s === "offline") { const down = num(th.downChecks, 1); return { state: down <= 1 ? "critical" : "warning", value: s, message: "Device is down." }; }
        return { state: "unknown", value: s || "unknown", message: "Device state unknown." };
      }
      case "agent": {
        const last = reading.lastSeenAt ? Date.parse(reading.lastSeenAt) : NaN;
        const nowMs = opts.now || Date.now();
        if (!isFinite(last)) return { state: "unknown", value: null, message: "No heartbeat recorded." };
        const ageMin = (nowMs - last) / 60000;
        const off = num(st.offlineAfterMinutes, 15), stale = num(st.staleAfterMinutes, 5);
        if (ageMin >= off) return { state: "critical", value: Math.round(ageMin), message: "Agent offline for " + Math.round(ageMin) + " min." };
        if (ageMin >= stale) return { state: "warning", value: Math.round(ageMin), message: "Agent stale for " + Math.round(ageMin) + " min." };
        return { state: "ok", value: Math.round(ageMin), message: "Agent checking in." };
      }
      case "cpu": case "memory": case "disk": {
        const key = type === "cpu" ? "cpuPct" : type === "memory" ? "memPct" : "diskPct";
        const v = metrics[key];
        const r = numericState(v, th, "above");
        return { state: r.state, value: r.value, message: r.state === "unknown" ? "No " + key + " sample." : "At " + Math.round(r.value) + "%." };
      }
      case "service": {
        const name = low(st.name);
        if (!name) return { state: "unknown", value: null, message: "No service configured." };
        const list = asArr(reading.services);
        const hit = list.find((s) => low(asObj(s).name) === name || low(asObj(s).displayName) === name);
        const expected = String(st.expectedState || "running");
        if (!hit) return { state: "critical", value: "missing", message: "Service " + st.name + " not found." };
        const state = low(asObj(hit).state);
        const running = state.indexOf("run") !== -1;
        if (expected === "stopped") return running ? { state: "critical", value: state, message: "Service is running but should be stopped." } : { state: "ok", value: state, message: "Service stopped." };
        return running ? { state: "ok", value: state, message: "Service running." } : { state: "critical", value: state, message: "Service is " + (state || "not running") + "." };
      }
      case "process": {
        const name = low(st.name);
        if (!name) return { state: "unknown", value: null, message: "No process configured." };
        const procs = asArr(reading.processes);
        const matches = procs.filter((p) => low(asObj(p).name).indexOf(name) !== -1 || low(asObj(p).name) === name);
        const expected = String(st.expected || "present");
        const min = num(st.minCount, 1);
        if (expected === "absent") return matches.length ? { state: "critical", value: matches.length, message: "Process present but should be absent." } : { state: "ok", value: 0, message: "Process absent." };
        return matches.length >= Math.max(1, min) ? { state: "ok", value: matches.length, message: matches.length + " instance(s) running." } : { state: "critical", value: matches.length, message: "Process not running." };
      }
      case "eventlog": {
        const events = asArr(reading.events).filter((e) => {
          const o = asObj(e);
          if (st.log && low(o.log) !== low(st.log)) return false;
          if (st.source && low(o.source) !== low(st.source)) return false;
          if (st.eventId && String(o.eventId) !== String(st.eventId)) return false;
          if (st.level && st.level !== "any" && low(o.level) !== low(st.level)) return false;
          return true;
        });
        const before = num(th.count, 1);
        return events.length >= Math.max(1, before) ? { state: "warning", value: events.length, message: events.length + " matching event(s)." } : { state: "ok", value: events.length, message: "No matching events." };
      }
      case "application": {
        if (st.check === "service") return M.evaluate("service", reading, { thresholds: th, settings: { name: st.name, expectedState: "running" } });
        if (st.check === "port") return M.evaluate("port", reading, { settings: st, probe });
        return M.evaluate("process", reading, { thresholds: th, settings: { name: st.name, expected: "present", minCount: 1 } });
      }
      case "port": {
        if (!probe) return { state: "unknown", value: null, message: "No probe result — a port check is performed on demand." };
        return probe.ok ? { state: "ok", value: "open", message: "Port " + (st.port || "") + " is open." } : { state: "critical", value: "closed", message: "Port " + (st.port || "") + " is closed." };
      }
      case "web": {
        if (!probe) return { state: "unknown", value: null, message: "No probe result — a web check is performed on demand." };
        if (probe.ok === false) return { state: "critical", value: probe.status || null, message: probe.message || "Request failed." };
        const ms = probe.responseMs;
        const slow = breach(ms, th.responseMs, "above");
        return slow ? { state: "warning", value: ms, message: "Responded in " + ms + "ms (slow)." } : { state: "ok", value: ms == null ? (probe.status || 200) : ms, message: "HTTP " + (probe.status || 200) + (ms != null ? " in " + ms + "ms" : "") + "." };
      }
      case "script": {
        if (!probe) return { state: "unknown", value: null, message: "No probe result — the script is run on demand." };
        const wantExit = num(st.expectExitCode, 0);
        if (probe.exitCode != null && num(probe.exitCode, 0) !== wantExit) return { state: "critical", value: probe.exitCode, message: "Exit code " + probe.exitCode + " (expected " + wantExit + ")." };
        if (st.expectOutput && String(probe.stdout || "").indexOf(String(st.expectOutput)) === -1) return { state: "critical", value: probe.exitCode, message: "Expected output not found." };
        if (probe.state && M.STATES.indexOf(probe.state) !== -1) return { state: probe.state, value: probe.value == null ? null : probe.value, message: probe.message || "" };
        const num2 = numericState(probe.value, th, "above");
        return { state: num2.state, value: num2.value, message: num2.state === "unknown" ? (probe.message || "Script reported no value.") : "Value " + num2.value + "." };
      }
      case "snmp": {
        if (!probe) return { state: "unknown", value: null, message: "No probe result — the OID is polled on demand." };
        if (probe.ok === false) return { state: "critical", value: null, message: probe.message || "SNMP poll failed." };
        const op = String(st.operator || ">");
        const v = Number(probe.value);
        if (!isFinite(v)) return { state: "unknown", value: null, message: "OID returned no numeric value." };
        if (breach(v, th.critical, op === "<" || op === "<=" ? "below" : "above")) return { state: "critical", value: v, message: "OID value " + v + " " + op + " critical." };
        if (breach(v, th.warning, op === "<" || op === "<=" ? "below" : "above")) return { state: "warning", value: v, message: "OID value " + v + " " + op + " warning." };
        return { state: "ok", value: v, message: "OID value " + v + "." };
      }
      case "patch": {
        const want = asArr(st.classifications).map(low);
        const missing = asArr(reading.patches).filter((p) => {
          const o = asObj(p);
          if (String(o.status || "").toLowerCase() === "installed" || o.installed) return false;
          if (want.length && want.indexOf(low(o.classification || o.classificationCode)) === -1) return false;
          return true;
        });
        const over = num(th.missingCount, 0);
        return missing.length > over ? { state: "warning", value: missing.length, message: missing.length + " missing patch(es)." } : { state: "ok", value: missing.length, message: "Patch compliant." };
      }
      case "av": {
        const sec = asObj(reading.security);
        if (st.requireRealTime && sec.realTimeProtection === false) return { state: "critical", value: false, message: "Real-time protection is off." };
        const age = sec.definitionAgeHours != null ? num(sec.definitionAgeHours, 0) : (sec.definitionsAt ? (Date.now() - Date.parse(sec.definitionsAt)) / 3600000 : null);
        if (age != null && breach(age, th.definitionAgeHours, "above")) return { state: "warning", value: Math.round(age), message: "Definitions are " + Math.round(age) + "h old." };
        if (sec.enabled === false) return { state: "critical", value: false, message: "Antivirus is disabled." };
        return { state: "ok", value: sec.product || true, message: sec.product ? sec.product + " healthy." : "No AV data." };
      }
      case "backup": {
        const b = asObj(reading.backup);
        if (st.requireSuccess && b.lastResult && String(b.lastResult).toLowerCase() !== "success") return { state: "critical", value: b.lastResult, message: "Last backup " + b.lastResult + "." };
        const last = b.lastSuccessAt || b.completedAt || "";
        const age = last ? (Date.now() - Date.parse(last)) / 3600000 : null;
        if (age != null && breach(age, th.maxAgeHours, "above")) return { state: "critical", value: Math.round(age), message: "No successful backup for " + Math.round(age) + "h." };
        if (age == null) return { state: "unknown", value: null, message: "No backup data." };
        return { state: "ok", value: Math.round(age), message: "Last backup " + Math.round(age) + "h ago." };
      }
      default:
        return { state: "unknown", value: null, message: "No evaluator for type " + type + "." };
    }
  };

  /* ─────────────────────── duration ("for N minutes") ───────────────────────

     A monitor fires only once its state has held for `forMinutes`. The
     previous assessment carries `since` (when the current state began)
     and `fired`, so a momentary blip never alerts and a recovery clears. */

  M.assess = function (monitor, reading, prev, opts) {
    opts = opts || {};
    const nowMs = num(opts.now, Date.now());
    const at = new Date(nowMs).toISOString();
    const result = M.evaluate(monitor && monitor.type, reading, {
      thresholds: opts.thresholds || (monitor && monitor.thresholds) || {},
      settings: opts.settings || (monitor && monitor.settings) || {},
      probe: opts.probe || null,
      now: nowMs,
    });
    const state = result.state;
    const forMinutes = Math.max(0, num(opts.forMinutes != null ? opts.forMinutes : (monitor && monitor.forMinutes), defaultForMinutes()));
    prev = prev || null;

    if (state === "unknown") {
      return { state, value: result.value == null ? null : result.value, message: result.message, since: prev ? prev.since || null : null, held: 0, fired: !!(prev && prev.fired), cleared: false, forMinutes, changed: false, at };
    }
    const active = state === "warning" || state === "critical";
    if (!active) {
      const cleared = !!(prev && (prev.state === "warning" || prev.state === "critical"));
      return { state, value: result.value == null ? null : result.value, message: result.message, since: null, held: 0, fired: false, cleared, forMinutes, changed: cleared || !prev || prev.state !== state, at };
    }
    let since = prev && prev.since ? prev.since : at;
    let fired = !!(prev && prev.fired);
    const changed = !prev || prev.state !== state;
    if (changed) { since = at; fired = forMinutes <= 0; }
    else {
      const heldMs = nowMs - Date.parse(since);
      if (!fired && isFinite(heldMs) && heldMs >= forMinutes * 60000) fired = true;
    }
    const held = Math.max(0, nowMs - Date.parse(since));
    return { state, value: result.value == null ? null : result.value, message: result.message, since, held, fired, cleared: false, forMinutes, changed, at };
  };

  /* Evaluate every enabled monitor that applies to a device, resolving its
     effective thresholds/settings. `probes` may carry live results by
     monitor id (used by the simulate panel and the future poller). */
  M.forDevice = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = asArr(g.provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "device_not_found", deviceId };
    const reading = await M.latestReading(providerId, dev);
    const prev = asObj(opts.prev);
    const probes = asObj(opts.probes);
    const rows = [];
    for (const mon of M.listOf(g.provider)) {
      if (!mon.enabled) continue;
      const m = M.appliesTo(g.provider, mon, dev, { provider: g.provider });
      if (!m.match) continue;
      const eff = M.effective(mon, dev, g.provider, { provider: g.provider });
      const assessment = M.assess(mon, reading, prev[mon.id], { thresholds: eff.thresholds, settings: eff.settings, forMinutes: eff.forMinutes, probe: probes[mon.id], now: opts.now });
      rows.push({ monitorId: mon.id, name: mon.name, type: mon.type, severity: eff.severity, matchedBy: m.matchedBy, assessment });
    }
    return { deviceId: dev.id, hostname: dev.hostname || dev.displayName, reading, monitors: rows, counts: M.countStates(rows.map((r) => r.assessment)) };
  };

  M.countStates = function (assessments) {
    const c = { ok: 0, warning: 0, critical: 0, unknown: 0 };
    asArr(assessments).forEach((a) => { if (c[a.state] != null) c[a.state]++; });
    return c;
  };

  /* Simulate one monitor against one device — the console's "what would
     happen?" panel, and the test harness' entry point. */
  M.simulate = async function (providerId, monitorId, deviceId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const mon = asArr(g.provider.monitorDefinitions).find((x) => String(x.id) === String(monitorId));
    if (!mon) return { error: "monitor_not_found", monitorId };
    const device = asArr(g.provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!device) return { error: "device_not_found", deviceId };
    const norm = normalizeMonitor(mon);
    if (!M.appliesTo(g.provider, norm, device, { provider: g.provider }).match) return { applies: false, monitorId, deviceId, message: "This monitor does not target the device." };
    const eff = M.effective(norm, device, g.provider, { provider: g.provider });
    const reading = await M.latestReading(providerId, device);
    const assessment = M.assess(norm, reading, opts.prev || null, { thresholds: eff.thresholds, settings: eff.settings, forMinutes: eff.forMinutes, probe: opts.probe, now: opts.now });
    return { applies: true, monitorId, deviceId, hostname: device.hostname, severity: eff.severity, effective: { thresholds: eff.thresholds, settings: eff.settings, sources: eff.sources }, reading, assessment };
  };

  /* ─────────────────────── seed / boot ─────────────────────── */

  M.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.monitorEnabled", true) === false) return { skipped: true, reason: "monitors_disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    const existing = new Set(asArr(g.provider.monitorDefinitions).map((m) => low(m.name)));
    const created = [];
    const seed = [
      { name: "Agent offline", type: "agent", severity: "sev-critical", forMinutes: 0, settings: { staleAfterMinutes: 5, offlineAfterMinutes: 15 } },
      { name: "Disk nearly full", type: "disk", severity: "sev-warning", forMinutes: 10, thresholds: { warning: 85, critical: 92 } },
      { name: "Production CPU saturation", type: "cpu", targets: { tags: ["prod"] }, severity: "sev-warning", forMinutes: 5, thresholds: { warning: 85, critical: 95 } },
      { name: "Spooler service", type: "service", targets: { tags: ["workstation"] }, severity: "sev-critical", settings: { name: "Spooler", expectedState: "running" } },
    ];
    for (const data of seed) {
      if (!opts.force && existing.has(low(data.name))) continue;
      const r = await M.add(demo.id, data);
      if (r.error) continue;
      created.push(r.monitor.id);
    }
    return { providerId: demo.id, created };
  };

  M.init = async function () { try { await T.ready; await M.seedDemo(); } catch (e) { console.error("monitors seed failed", e); } };

  /* ═══════════════════════ Monitors station ═══════════════════════ */

  M.currentProviderId = null;

  M.render = async function (ctx) {
    const ui = ERP.ui, esc = ui.esc;
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { ctx.empty(); return; }

    const TABS = ["monitors", "catalogue"];
    const state = {
      pid: (M.currentProviderId && providers.some((p) => p.id === M.currentProviderId)) ? M.currentProviderId : providers[0].id,
      tab: TABS.indexOf(el.__tab) !== -1 ? el.__tab : "monitors",
    };
    M.currentProviderId = state.pid;

    const root = document.createElement("div");
    root.className = "rmm-monitors";
    el.innerHTML = "";
    el.appendChild(root);

    const cache = { provider: null, ctx: null, stats: null };
    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };
    async function loadCtx(p) {
      const idx = await M.loadIndex(state.pid);
      return { provider: p, soft: idx.soft || {}, svc: idx.svc || {}, patches: idx.patches || {} };
    }
    M.loadIndex = async function (providerId) { if (G && typeof G.loadIndex === "function") return G.loadIndex(providerId); return { soft: {}, svc: {}, patches: {} }; };

    async function paint() {
      const p = await prov();
      if (!p) { ctx.error({ title: "Provider not found", message: "This tenant's document could not be loaded." }); return; }
      cache.provider = p;
      cache.ctx = await loadCtx(p);
      const monitors = M.listOf(p);
      const stats = M.statsOf(p);
      cache.stats = stats;
      const tabs = ui.tabs([
        { id: "monitors", label: "Monitors", badge: String(monitors.length) },
        { id: "catalogue", label: "Catalogue", badge: String(M.TYPES.length) },
      ], state.tab);
      const head = ui.pageHead("Monitors",
        "The monitor catalogue: thresholds, service/process state, event-log, application/port/web, script, SNMP, agent-offline and patch/AV/backup checks — each with a “for N minutes” duration, a severity and per-device or per-group overrides.",
        ui.btn("New monitor", { primary: true, act: "mon-add" }));
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 260px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      root.innerHTML = head + picker + tabs.html;
      root.querySelector('[data-panel="monitors"]').innerHTML = monitorsPanelHtml(p, monitors, stats);
      root.querySelector('[data-panel="catalogue"]').innerHTML = cataloguePanelHtml(p);
      ui.showTab(root, state.tab);
    }

    function sevTone(sev) { return sev === "sev-emergency" || sev === "sev-critical" ? "danger" : sev === "sev-warning" ? "warn" : "info"; }

    function monitorsPanelHtml(p, monitors, stats) {
      const rows = monitors.map((mon) => {
        const t = M.type(mon.type) || {};
        const targets = G ? G.targetSummary(p, mon.targets, cache.ctx) : "every device";
        return {
          name: "<b>" + esc(mon.name) + "</b>" + (mon.description ? '<div class="erp-sub">' + esc(mon.description) + "</div>" : ""),
          type: ui.badge(t.label || mon.type, "info") + '<div class="erp-sub">' + esc(t.category || "") + "</div>",
          targets: '<span class="erp-sub">' + esc(targets) + "</span>",
          timing: esc(mon.intervalSeconds + "s") + '<div class="erp-sub">for ' + esc(mon.forMinutes) + " min</div>",
          severity: ui.badge(sevLabel(mon.severity), sevTone(mon.severity)),
          overrides: String(mon.overrides.length),
          state: mon.enabled ? ui.badge("enabled", "success") : ui.badge("disabled", "muted"),
          actions: ui.btn("Simulate", { small: true, act: "mon-sim", arg: mon.id }) + " " +
            ui.btn("Edit", { small: true, act: "mon-edit", arg: mon.id }) + " " +
            ui.btn("Delete", { small: true, danger: true, act: "mon-del", arg: mon.id }),
        };
      });
      return ui.summary([
        { label: "Monitors", value: String(stats.total) },
        { label: "Enabled", value: String(stats.enabled) },
        { label: "Types in use", value: String(stats.types) + " / " + M.TYPES.length },
        { label: "Overrides", value: String(stats.overrides) },
        { label: "Devices covered", value: String(stats.covered) + " / " + stats.devices },
      ]) +
        ui.card("Monitors (" + monitors.length + ")",
          ui.table([
            { key: "name", label: "Monitor", render: (r) => r.name },
            { key: "type", label: "Type", render: (r) => r.type },
            { key: "targets", label: "Applies to", render: (r) => r.targets },
            { key: "timing", label: "Schedule", render: (r) => r.timing },
            { key: "severity", label: "Severity", render: (r) => r.severity },
            { key: "overrides", label: "Overrides", align: "right", render: (r) => r.overrides },
            { key: "state", label: "State", render: (r) => r.state },
            { key: "actions", label: "", render: (r) => r.actions },
          ], rows, { scroll: true, emptyText: "No monitors yet — add one from the catalogue." })) +
        '<p class="erp-sub">A monitor fires only after its condition has <b>held for its “for N minutes”</b> duration, so a momentary blip never alerts. Thresholds resolve monitor → group override → device override.</p>';
    }

    function cataloguePanelHtml(p) {
      const cats = M.CATEGORIES;
      const blocks = cats.map((cat) => {
        const types = TYPES.filter((t) => t.category === cat);
        const cards = types.map((t) => {
          const defs = typeDefaults(t.id);
          const th = asArr(t.thresholds).map((f) => f.label + (f.default != null ? " " + f.default + (f.unit || "") : "")).join(", ");
          return ui.card(t.label,
            '<p class="erp-sub">' + esc(t.desc) + "</p>" +
            '<div class="rmm-cat-meta">' +
              ui.badge(cat, "muted") +
              (t.probe ? " " + ui.badge("probe", "info") : "") +
              " " + ui.badge("for " + defs.forMinutes + " min", "muted") +
              " " + ui.badge("every " + defs.intervalSeconds + "s", "muted") +
            "</div>" +
            (th ? '<div class="erp-sub rmm-cat-th">Defaults: ' + esc(th) + "</div>" : "") +
            '<div class="erp-btn-row" style="margin-top:8px">' + ui.btn("Add " + t.label, { small: true, act: "mon-add-type", arg: t.id }) + "</div>");
        });
        return '<h4 class="rmm-section-title">' + esc(cat.charAt(0).toUpperCase() + cat.slice(1)) + "</h4>" + ui.grid(cards, "rmm-cat-grid");
      }).join("");
      return ui.card("Type catalogue (" + M.TYPES.length + ")", '<p class="erp-sub">Every monitor type declares its own settings schema, default thresholds and duration. Picking a type seeds the editor; overrides let one device or group diverge.</p>' + blocks);
    }

    /* ── shared control builders ── */

    function control(f, val, attr, name) {
      const a = " " + attr + (name ? ' data-mname="' + esc(name) + '"' : "");
      if (f.type === "bool") return '<select' + a + '><option value="true"' + (val === true ? " selected" : "") + ">Yes</option><option value=\"false\"" + (val === false ? " selected" : "") + ">No</option></select>";
      if (f.type === "select") return '<select' + a + ">" + f.options.map((o) => '<option value="' + esc(o) + '"' + (String(val) === String(o) ? " selected" : "") + ">" + esc(o) + "</option>").join("") + "</select>";
      if (f.type === "number" || f.type == null) return '<input type="number"' + a + ' value="' + (val == null ? "" : esc(val)) + '"' + (f.min != null ? ' min="' + esc(f.min) + '"' : "") + ">";
      if (f.type === "list") return '<input type="text"' + a + ' value="' + esc(asArr(val).join(", ")) + '" placeholder="comma-separated">';
      if (f.type === "textarea") return '<textarea' + a + ' rows="3">' + esc(val || "") + "</textarea>";
      return '<input type="text"' + a + ' value="' + esc(val == null ? "" : val) + '"' + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : "") + ">";
    }

    function typeSchemaHtml(type, settings, thresholds) {
      const t = M.type(type);
      if (!t) return "";
      const thRows = asArr(t.thresholds).map((f) => '<div class="rmm-setting-row"><div class="rmm-setting-label"><b>' + esc(f.label) + "</b>" + (f.unit ? ' <span class="erp-sub">' + esc(f.unit) + "</span>" : "") + "</div><div class=\"rmm-setting-control\">" + control(f, asObj(thresholds)[f.key], "data-mth", f.key) + "</div></div>").join("");
      const setRows = asArr(t.settings).map((f) => '<div class="rmm-setting-row"><div class="rmm-setting-label"><b>' + esc(f.label) + "</b>" + (f.required ? ' <span class="erp-sub">required</span>' : "") + (f.unit ? ' <span class="erp-sub">' + esc(f.unit) + "</span>" : "") + (f.ph ? '<div class="erp-sub">' + esc(f.ph) + "</div>" : "") + '</div><div class="rmm-setting-control">' + control(f, asObj(settings)[f.key], "data-mkey", f.key) + "</div></div>").join("");
      return (thRows ? '<h5 class="rmm-sub-head">Thresholds</h5>' + thRows : "") + (setRows ? '<h5 class="rmm-sub-head">Settings</h5>' + setRows : "") + (!thRows && !setRows ? '<p class="erp-sub">This type has no extra configuration.</p>' : "");
    }

    function readSchema(m, selector, attr) {
      const out = {};
      m.querySelectorAll(selector).forEach((inp) => {
        const key = inp.getAttribute(attr);
        if (!key) return;
        const raw = inp.value;
        if (raw === "" || raw == null) return;
        const def = M.settingDef(m.__mtype, key) || M.thresholdDef(m.__mtype, key) || {};
        if (def.type === "bool") out[key] = raw === "true";
        else if (def.type === "number") { const n = Number(raw); if (isFinite(n)) out[key] = n; }
        else if (def.type === "list") out[key] = raw.split(",").map((x) => x.trim()).filter(Boolean);
        else out[key] = raw;
      });
      return out;
    }

    function overrideRowsHtml(mon) {
      return asArr(mon.overrides).map((ov, i) => {
        const t = M.type(mon.type);
        const thInputs = asArr(asObj(t).thresholds).map((f) => {
          const v = asObj(ov.thresholds)[f.key];
          return '<input type="number" data-ov-th="' + esc(f.key) + '" data-ov-row="' + i + '" value="' + (v == null ? "" : esc(v)) + '" placeholder="' + esc(f.label) + '" title="' + esc(f.label + (f.unit ? " (" + f.unit + ")" : "")) + '">';
        }).join(" ");
        return '<div class="rmm-override-row" data-ov-row="' + i + '">' +
          '<select data-ov-scope="' + i + '"><option value="device"' + (ov.scope === "device" ? " selected" : "") + ">Device</option><option value=\"group\"" + (ov.scope === "group" ? " selected" : "") + ">Group</option></select>" +
          targetSelectHtml(i, ov.scope, ov.id) +
          '<div class="rmm-override-th">' + (thInputs || '<span class="erp-sub">no thresholds</span>') + "</div>" +
          ui.btn("✕", { small: true, danger: true, act: "mon-ov-del", arg: String(i) }) +
          "</div>";
      }).join("");
    }

    function targetSelectHtml(i, scope, sel) {
      const p = cache.provider;
      if (scope === "group") return '<select data-ov-id="' + i + '">' + (G ? G.listOf(p) : asArr(p.deviceGroups)).map((g) => '<option value="' + esc(g.id) + '"' + (String(sel) === String(g.id) ? " selected" : "") + ">" + esc(g.name) + "</option>").join("") + "</select>";
      return '<select data-ov-id="' + i + '">' + asArr(p.devices).map(D.normalizeDevice).map((d) => '<option value="' + esc(d.id) + '"' + (String(sel) === String(d.id) ? " selected" : "") + ">" + esc(d.hostname || d.displayName) + "</option>").join("") + "</select>";
    }

    /* ── monitor form ── */

    function openMonitorForm(monitor, presetType) {
      const p = cache.provider;
      const isEdit = !!monitor;
      const type = monitor ? monitor.type : (M.type(presetType) ? presetType : "cpu");
      const mon = monitor || normalizeMonitor({ name: "", type });
      const deviceList = asArr(p.devices).map(D.normalizeDevice);
      const tagNames = G ? G.tagsOf(p).map((t) => t.name) : [];
      const overrides = clone(mon.overrides || []);

      function bodyHtml() {
        return ui.form(
          ui.text("name", "Monitor name", mon.name) +
          ui.text("description", "Description", mon.description) +
          ui.select("type", "Monitor type", TYPES.map((t) => ({ value: t.id, label: t.label + " (" + t.category + ")" })), type) +
          '<div class="erp-inline-form">' +
            ui.select("severity", "Severity", ["sev-info", "sev-warning", "sev-critical", "sev-emergency"].map((s) => ({ value: s, label: sevLabel(s) })), mon.severity) +
            ui.number("intervalSeconds", "Check every (seconds)", mon.intervalSeconds) +
            ui.number("forMinutes", "For (minutes) before firing", mon.forMinutes) +
            ui.select("enabled", "State", [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }], mon.enabled ? "true" : "false") +
          "</div>" +
          '<div class="rmm-targets">' +
            '<h4 class="rmm-section-title">Targeting</h4>' +
            '<p class="erp-sub">Blank targets = every device. A device matches on the strongest reason: explicit device › tag › group › site.</p>' +
            '<div class="field"><label>Tags</label><input type="text" name="tags" value="' + esc(asArr(mon.targets.tags).join(", ")) + '" list="rmmMonTagList"><datalist id="rmmMonTagList">' + tagNames.map((t) => '<option value="' + esc(t) + '"></option>').join("") + "</datalist></div>" +
            '<div class="field"><label>Devices (hostname or id)</label><input type="text" name="devices" value="' + esc(asArr(mon.targets.deviceIds).map((id) => { const d = deviceList.find((x) => String(x.id) === String(id)); return d ? (d.hostname || d.displayName) : id; }).join(", ")) + '"></div>' +
            '<div class="field"><label>Groups</label><div class="rmm-check-list">' + (G ? G.listOf(p) : asArr(p.deviceGroups)).map((g) => '<label class="erp-check"><input type="checkbox" data-mtgt-group="' + esc(g.id) + '"' + (asArr(mon.targets.groupIds).map(String).indexOf(String(g.id)) !== -1 ? " checked" : "") + "> " + esc(g.name) + "</label>").join("") + "</div></div>" +
          "</div>" +
          '<div data-type-schema>' + typeSchemaHtml(type, mon.settings, mon.thresholds) + "</div>" +
          '<h4 class="rmm-section-title">Overrides</h4>' +
          '<p class="erp-sub">Let a specific device or group diverge from the thresholds above.</p>' +
          '<div data-overrides>' + overrideRowsHtml({ overrides }) + "</div>" +
          '<div class="erp-btn-row">' + ui.btn("Add override", { small: true, act: "mon-ov-add" }) + "</div>",
          ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isEdit ? "Save monitor" : "Create monitor", { small: true, primary: true, act: "mon-save" })
        );
      }

      const m = ui.modal({ title: isEdit ? "Edit monitor" : "New monitor", size: "lg", body: bodyHtml() });
      m.__mtype = type;

      function rereadSchema() {
        const th = readSchema(m, "[data-mth]", "data-mth");
        const set = readSchema(m, "[data-mkey]", "data-mkey");
        mon.thresholds = th; mon.settings = set;
        const v = ui.collect(m, ["name", "type", "severity", "intervalSeconds", "forMinutes"]);
        if (v.name != null) mon.name = v.name;
        if (v.severity) mon.severity = v.severity;
        if (v.intervalSeconds != null) mon.intervalSeconds = Number(v.intervalSeconds);
        if (v.forMinutes != null) mon.forMinutes = Number(v.forMinutes);
      }
      function readOverrides() {
        const rows = [...m.querySelectorAll("[data-ov-row]")];
        return rows.map((row) => {
          const i = row.getAttribute("data-ov-row");
          const scopeEl = row.querySelector('[data-ov-scope="' + i + '"]');
          const idEl = row.querySelector('[data-ov-id="' + i + '"]');
          const th = {};
          row.querySelectorAll('[data-ov-th="' + i + '"]').forEach((inp) => { const k = inp.getAttribute("data-ov-th"); if (inp.value !== "" && isFinite(Number(inp.value))) th[k] = Number(inp.value); });
          return Object.assign({}, overrides[i], { scope: scopeEl ? scopeEl.value : "device", id: idEl ? idEl.value : "", thresholds: th });
        }).filter((o) => o.id);
      }
      function rerenderOverrides() { m.querySelector("[data-overrides]").innerHTML = overrideRowsHtml({ overrides }); }

      m.addEventListener("change", (e) => {
        if (e.target.name === "type") {
          rereadSchema();
          const nt = e.target.value;
          m.__mtype = nt;
          const defs = typeDefaults(nt);
          mon.type = nt; mon.settings = defs.settings; mon.thresholds = defs.thresholds;
          if (!isEdit) { mon.forMinutes = defs.forMinutes; mon.intervalSeconds = defs.intervalSeconds; mon.severity = defs.severity; const fm = m.querySelector('[name="forMinutes"]'); if (fm) fm.value = defs.forMinutes; const iv = m.querySelector('[name="intervalSeconds"]'); if (iv) iv.value = defs.intervalSeconds; const se = m.querySelector('[name="severity"]'); if (se) se.value = defs.severity; }
          m.querySelector("[data-type-schema]").innerHTML = typeSchemaHtml(nt, mon.settings, mon.thresholds);
          overrides.length = 0;
          rerenderOverrides();
          return;
        }
        if (e.target.hasAttribute && e.target.hasAttribute("data-ov-scope")) {
          const i = Number(e.target.getAttribute("data-ov-scope"));
          overrides[i] = overrides[i] || { scope: "device", id: "" };
          overrides[i].scope = e.target.value; overrides[i].id = "";
          rerenderOverrides();
        }
      });
      m.addEventListener("click", (e) => {
        const t = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
        if (!t) return;
        const act = t.getAttribute("data-act");
        if (act === "mon-ov-add") { overrides.push({ scope: "device", id: "", thresholds: {} }); rerenderOverrides(); }
        if (act === "mon-ov-del") { overrides.splice(Number(t.getAttribute("data-arg")), 1); rerenderOverrides(); }
      });
      m.querySelector("[data-act=mon-save]").onclick = async () => {
        rereadSchema();
        const v = ui.collect(m, ["name", "description", "enabled", "tags", "devices"]);
        const ovs = readOverrides();
        if (!String(v.name || "").trim()) { ctx.toast("Monitor name is required", "error"); return; }
        const devTokens = String(v.devices || "").split(",").map((x) => x.trim()).filter(Boolean);
        const devIds = devTokens.map((tok) => { const d = deviceList.find((x) => String(x.id) === tok || low(x.hostname) === low(tok) || low(x.displayName) === low(tok)); return d ? String(d.id) : tok; });
        const payload = {
          name: v.name.trim(), description: v.description || "", type: mon.type,
          severity: mon.severity, intervalSeconds: mon.intervalSeconds, forMinutes: mon.forMinutes,
          enabled: v.enabled !== "false",
          thresholds: mon.thresholds, settings: mon.settings,
          targets: {
            groupIds: [...m.querySelectorAll("[data-mtgt-group]")].filter((i) => i.checked).map((i) => i.getAttribute("data-mtgt-group")),
            tags: String(v.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
            deviceIds: devIds,
          },
          overrides: ovs,
        };
        const r = isEdit ? await M.update(state.pid, monitor.id, payload) : await M.add(state.pid, payload);
        if (r.error) { ctx.toast("Save failed: " + (r.error === "invalid" ? (r.errors || []).join("; ") : r.error), "error"); return; }
        ui.closeModal();
        ctx.toast(isEdit ? "Monitor updated" : "Monitor created");
        paint();
      };
      return m;
    }

    function openSimulate(monitor) {
      const p = cache.provider;
      const devices = asArr(p.devices).map(D.normalizeDevice);
      const body = ui.form(
        ui.select("simDev", "Device", devices.map((d) => ({ value: d.id, label: d.hostname || d.displayName })), devices[0] ? devices[0].id : "") +
        '<div data-sim-out><p class="erp-sub">Choose a device and run the simulation.</p></div>',
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Run simulation", { small: true, primary: true, act: "mon-run" })
      );
      const m = ui.modal({ title: monitor.name + " · simulate", size: "lg", body });
      m.querySelector("[data-act=mon-run]").onclick = async () => {
        const deviceId = m.querySelector('[name="simDev"]').value;
        const r = await M.simulate(state.pid, monitor.id, deviceId);
        const out = m.querySelector("[data-sim-out]");
        if (!r || r.error) { out.innerHTML = ui.alert((r && (r.message || r.error)) || "Simulation failed", "danger"); return; }
        if (!r.applies) { out.innerHTML = ui.alert(r.message, "warn"); return; }
        const a = r.assessment;
        const tone = a.state === "critical" ? "danger" : a.state === "warning" ? "warn" : a.state === "ok" ? "success" : "muted";
        out.innerHTML =
          '<div class="rmm-sim-result">' + ui.badge(a.state.toUpperCase(), tone) + " " + ui.badge("for " + a.forMinutes + " min", "muted") +
          (a.fired ? " " + ui.badge("FIRES", "danger") : "") + (a.cleared ? " " + ui.badge("clears", "success") : "") + "</div>" +
          '<p>' + esc(a.message) + "</p>" +
          ui.table([{ key: "k", label: "Effective value" }, { key: "v", label: "" }], [
            { k: "Value", v: a.value == null ? "—" : esc(String(a.value)) },
            { k: "Held since", v: a.since ? esc(a.since) : "—" },
            { k: "Held", v: Math.round(a.held / 1000) + "s" },
            { k: "Severity", v: esc(sevLabel(r.severity)) },
            { k: "Thresholds from", v: esc(r.effective.sources.thresholds) },
            { k: "Settings from", v: esc(r.effective.sources.settings) },
          ]) +
          '<div class="erp-sub">Resolved thresholds: ' + esc(JSON.stringify(r.effective.thresholds)) + "</div>";
      };
      return m;
    }

    /* ── events ── */
    ui.bind(root, "click", "[data-act]", async (t) => {
      const p = cache.provider;
      const act = t.getAttribute("data-act"), arg = t.getAttribute("data-arg");
      if (act === "mon-add") return openMonitorForm(null);
      if (act === "mon-add-type") return openMonitorForm(null, arg);
      if (act === "mon-edit") { const mon = M.listOf(p).find((x) => x.id === arg); if (mon) return openMonitorForm(mon); return; }
      if (act === "mon-sim") { const mon = M.listOf(p).find((x) => x.id === arg); if (mon) return openSimulate(mon); return; }
      if (act === "mon-del") {
        const mon = M.listOf(p).find((x) => x.id === arg);
        const ok = await ui.confirm({ title: "Delete monitor", message: "Delete “" + (mon ? mon.name : arg) + "”? Any alert history it produced is retained.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await M.remove(state.pid, arg);
        if (r.error) { ctx.toast("Delete failed: " + r.error, "error"); return; }
        ctx.toast("Monitor deleted"); return paint();
      }
    });
    ui.bind(root, "click", "[data-tab]", (t) => { state.tab = t.getAttribute("data-tab"); ui.showTab(root, state.tab); });
    root.addEventListener("change", (e) => {
      if (e.target && e.target.name === "pid") { state.pid = e.target.value; M.currentProviderId = state.pid; return paint(); }
    });

    await paint();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", M.init);
  else M.init();
})();
