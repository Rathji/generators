/* ============================================================
   RMM-U — master configuration (Phase 1 · Task 4)
   The system-wide catalogues every other station reads. All of it
   lives in ONE versioned document (rmm-v1-config) so it travels
   with the tenant data through the canonical store, sync/conflict
   handling and backups:

     severities            the severity ladder monitors, alerts and
                           policies map to (rank, tone, escalation)
     monitorTypes          the monitor catalogue — availability,
                           performance, service, process, event-log,
                           application, network, script, SNMP, patch,
                           security and backup monitors, each with a
                           default metric, operator, threshold,
                           duration, severity and interval
     channels              notification channels (in-console, email,
                           SMS, webhook, Slack, Teams, PSA ticket)
     schedules             named recurring schedules (interval /
                           daily / weekly / monthly / cron)
     calendars             business-hours calendars (timezone, work
                           days, hours, holidays)
     maintenanceWindows    named maintenance windows (recurrence,
                           scope, alert suppression)
     patchClassifications  vendor patch classifications and their
                           approval / reboot / deferral behaviour
     softwareCategories    software catalogue categories
     tagTaxonomy           the controlled tag vocabulary
     groupTaxonomy         the group kinds (static / dynamic / site /
                           provider-wide) and their behaviour
     scriptCategories      script categories with OS support and an
                           approval requirement

   Every mutation is written under the store's compare-and-set guard
   and appends a dated, attributed entry to the document's change
   history, so the Admin console can show exactly what changed and
   when. The module also answers the questions later phases ask of
   it (resolve a severity's tone, list a calendar's business hours,
   is a device inside a maintenance window right now), exposed as
   window.ERP.masterConfig for monitors, alerts, policies, patches
   and reporting to build on.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store) return;
  const ui = ERP.ui;
  const store = ERP.store;

  const M = (ERP.masterConfig = {});

  const CONFIG_MODULE = "config";
  const CONFIG_KIND = "rmm-config";
  const HISTORY_LIMIT = 500;
  const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const now = () => new Date().toISOString();
  const rand = (n) => { let s = ""; for (let i = 0; i < n; i++) s += ID_CHARS[(Math.random() * ID_CHARS.length) | 0]; return s; };
  const splitTags = (v) => (Array.isArray(v) ? v.map(String) : String(v == null ? "" : v).split(",").map((x) => x.trim()).filter(Boolean));

  const TONES = ["muted", "info", "success", "warn", "danger"];
  const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const OSES = ["windows", "macos", "linux"];

  /* ============================================================
     Section catalogue — the single source of truth for both the
     seed data, validation and the generic editor UI. Each section
     declares its fields once; add/edit forms, table columns and
     validation are all derived from them.
     ============================================================ */

  const SECTION_DEFS = [
    {
      id: "severities", tab: "Severity levels", singular: "severity level", icon: "alerts",
      idPrefix: "sev", labelKey: "label",
      desc: "The severity ladder every monitor, alert and policy maps to — rank, colour, whether it notifies, and how long before it escalates.",
      columns: ["rank", "tone", "notify", "escalateAfterMinutes"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Critical" },
        { key: "rank", type: "number", label: "Rank", default: 100, hint: "Higher = more severe." },
        { key: "tone", type: "select", label: "Tone", options: TONES, default: "info" },
        { key: "color", type: "color", label: "Colour", default: "#0a58ca" },
        { key: "notify", type: "bool", label: "Notifies", default: true },
        { key: "escalateAfterMinutes", type: "number", label: "Escalate after (min)", default: 0, hint: "0 = never auto-escalate." },
        { key: "isDefault", type: "bool", label: "Default severity", default: false },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "monitorTypes", tab: "Monitor types", singular: "monitor type", icon: "monitors",
      idPrefix: "mon", labelKey: "label",
      desc: "The monitor catalogue. Each entry declares what it watches, the metric it compares, the default operator/threshold/duration and the severity it raises.",
      columns: ["category", "defaultSeverity", "defaultThreshold", "collectionIntervalMinutes"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. CPU utilisation" },
        { key: "category", type: "select", label: "Category", options: ["availability", "performance", "service", "process", "eventlog", "application", "network", "script", "snmp", "patch", "security", "backup"], default: "performance" },
        { key: "target", type: "text", label: "Target", default: "device", hint: "What the monitor is pointed at (device, service, port, url…)." },
        { key: "metric", type: "text", label: "Metric", default: "", ph: "e.g. cpu.percent" },
        { key: "unit", type: "text", label: "Unit", default: "", ph: "%, ms, MB…" },
        { key: "operator", type: "select", label: "Operator", options: [">", ">=", "<", "<=", "==", "!=", "contains"], default: ">" },
        { key: "defaultThreshold", type: "number", label: "Default threshold", default: 0 },
        { key: "defaultDurationMinutes", type: "number", label: "For (minutes)", default: 5, hint: "How long the condition must hold before it fires." },
        { key: "defaultSeverity", type: "ref", ref: "severities", label: "Default severity", default: "sev-warning" },
        { key: "collectionIntervalMinutes", type: "number", label: "Check every (min)", default: 5 },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "channels", tab: "Notification channels", singular: "channel", icon: "integrations",
      idPrefix: "ch", labelKey: "label",
      desc: "Where alerts are delivered. Each channel filters by minimum severity, optionally only fires outside business hours, and rate-limits repeats.",
      columns: ["type", "target", "minSeverity", "rateLimitMinutes"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. NOC email" },
        { key: "type", type: "select", label: "Type", options: ["in-console", "email", "sms", "webhook", "slack", "teams", "pagerduty", "push", "psa-ticket"], default: "email" },
        { key: "target", type: "text", label: "Target", default: "", ph: "address / URL / queue" },
        { key: "minSeverity", type: "ref", ref: "severities", label: "Minimum severity", default: "sev-warning" },
        { key: "calendarId", type: "ref", ref: "calendars", label: "Calendar", default: "", hint: "Optional business-hours filter." },
        { key: "onlyOutsideHours", type: "bool", label: "Only outside business hours", default: false },
        { key: "rateLimitMinutes", type: "number", label: "Repeat cooldown (min)", default: 0, hint: "0 = every event." },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
        { key: "description", type: "textarea", label: "Description", default: "" },
      ],
    },
    {
      id: "schedules", tab: "Schedules", singular: "schedule", icon: "reports",
      idPrefix: "sched", labelKey: "label",
      desc: "Named recurring schedules referenced by monitors, scans, patch windows and reports — a fixed interval, a time of day, or a cron expression.",
      columns: ["kind", "intervalMinutes", "timeOfDay", "timezone"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Every 5 minutes" },
        { key: "kind", type: "select", label: "Kind", options: ["interval", "daily", "weekly", "monthly", "cron"], default: "interval" },
        { key: "intervalMinutes", type: "number", label: "Interval (min)", default: 15, hint: "Used by “interval”." },
        { key: "timeOfDay", type: "time", label: "Time of day", default: "02:00" },
        { key: "daysOfWeek", type: "tags", label: "Days", default: [], hint: "mon, tue, … (weekly)" },
        { key: "cron", type: "text", label: "Cron expression", default: "", ph: "0 2 * * *" },
        { key: "timezone", type: "text", label: "Timezone", default: "UTC" },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "calendars", tab: "Business hours", singular: "calendar", icon: "reports",
      idPrefix: "cal", labelKey: "label",
      desc: "Business-hours calendars (timezone, working days, opening hours and holidays). Alerts and automations treat “after hours” relative to these.",
      columns: ["timezone", "workdays", "startTime", "endTime"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Default business hours" },
        { key: "timezone", type: "text", label: "Timezone", default: "UTC" },
        { key: "workdays", type: "tags", label: "Working days", default: ["mon", "tue", "wed", "thu", "fri"] },
        { key: "startTime", type: "time", label: "Opens", default: "09:00" },
        { key: "endTime", type: "time", label: "Closes", default: "17:00" },
        { key: "holidays", type: "tags", label: "Holidays", default: [], hint: "ISO dates (YYYY-MM-DD), comma-separated" },
        { key: "isDefault", type: "bool", label: "Default calendar", default: false },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "maintenanceWindows", tab: "Maintenance windows", singular: "maintenance window", icon: "automations",
      idPrefix: "mw", labelKey: "label",
      desc: "Named windows during which alerts are suppressed (optionally except the most severe) — for patching, upgrades and planned work.",
      columns: ["recurrence", "startTime", "endTime", "scope", "suppressAlerts"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Nightly patching" },
        { key: "recurrence", type: "select", label: "Recurrence", options: ["once", "daily", "weekly", "monthly"], default: "daily" },
        { key: "startDate", type: "date", label: "Start date", default: "", hint: "For “once”." },
        { key: "endDate", type: "date", label: "End date", default: "", hint: "For “once”." },
        { key: "startTime", type: "time", label: "From", default: "01:00" },
        { key: "endTime", type: "time", label: "To", default: "05:00" },
        { key: "daysOfWeek", type: "tags", label: "Days", default: [], hint: "For “weekly”." },
        { key: "timezone", type: "text", label: "Timezone", default: "UTC" },
        { key: "scope", type: "select", label: "Scope", options: ["global", "provider", "site", "group", "device"], default: "global" },
        { key: "scopeId", type: "text", label: "Scope id", default: "", hint: "Blank for global scope." },
        { key: "suppressAlerts", type: "bool", label: "Suppress alerts", default: true },
        { key: "allowCritical", type: "bool", label: "Let critical alerts through", default: true },
        { key: "deferJobs", type: "bool", label: "Defer non-essential jobs", default: true, hint: "Hold agent jobs and automations until the window ends." },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "patchClassifications", tab: "Patch classifications", singular: "patch classification", icon: "patches",
      idPrefix: "pc", labelKey: "label",
      desc: "Vendor patch classifications and how each is handled: severity, auto-approval, auto-deployment, reboot behaviour and deferral.",
      columns: ["severity", "autoApprove", "autoDeploy", "deferralDays"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Critical security updates" },
        { key: "vendor", type: "text", label: "Vendor", default: "Microsoft" },
        { key: "categoryCode", type: "text", label: "Vendor code", default: "", ph: "e.g. SecurityUpdates" },
        { key: "severity", type: "ref", ref: "severities", label: "Severity", default: "sev-warning" },
        { key: "autoApprove", type: "bool", label: "Auto-approve", default: false },
        { key: "autoDeploy", type: "bool", label: "Auto-deploy", default: false },
        { key: "requiresReboot", type: "bool", label: "Requires reboot", default: true },
        { key: "deferralDays", type: "number", label: "Defer for (days)", default: 0 },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "softwareCategories", tab: "Software categories", singular: "software category", icon: "software",
      idPrefix: "sc", labelKey: "label",
      desc: "The categories the deployable-software catalogue is filed under.",
      columns: ["color"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Security" },
        { key: "color", type: "color", label: "Colour", default: "#0a58ca" },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "tagTaxonomy", tab: "Tag taxonomy", singular: "tag", icon: "groups",
      idPrefix: "tag", labelKey: "name",
      desc: "The controlled tag vocabulary. Tags are how policies, automations and dynamic groups are targeted, so the list is curated here.",
      columns: ["category", "color"],
      fields: [
        { key: "name", type: "text", label: "Tag", required: true, ph: "e.g. production" },
        { key: "category", type: "select", label: "Category", options: ["environment", "role", "location", "compliance", "custom"], default: "custom" },
        { key: "color", type: "color", label: "Colour", default: "#6c757d" },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "groupTaxonomy", tab: "Group taxonomy", singular: "group kind", icon: "groups",
      idPrefix: "gt", labelKey: "label",
      desc: "The group kinds the endpoint hierarchy understands and how each behaves — static membership, dynamic rules, site groups and provider-wide groups.",
      columns: ["kind", "autoAssignNewDevices"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Dynamic (rule-based)" },
        { key: "kind", type: "select", label: "Kind", options: ["static", "dynamic", "site", "provider"], default: "static" },
        { key: "rule", type: "text", label: "Default rule", default: "", ph: "e.g. os.family == \"Windows\"" },
        { key: "autoAssignNewDevices", type: "bool", label: "Auto-assign new devices", default: false },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
    {
      id: "scriptCategories", tab: "Script categories", singular: "script category", icon: "automations",
      idPrefix: "scr", labelKey: "label",
      desc: "Categories for the script library, each with the OSes it targets, whether it needs approval before it runs, and a default timeout.",
      columns: ["supportedOs", "requiresApproval", "defaultTimeoutSeconds"],
      fields: [
        { key: "label", type: "text", label: "Name", required: true, ph: "e.g. Diagnostics" },
        { key: "supportedOs", type: "tags", label: "Operating systems", default: ["windows", "macos", "linux"] },
        { key: "requiresApproval", type: "bool", label: "Requires approval", default: false },
        { key: "defaultTimeoutSeconds", type: "number", label: "Default timeout (s)", default: 300 },
        { key: "description", type: "textarea", label: "Description", default: "" },
        { key: "enabled", type: "bool", label: "Enabled", default: true },
      ],
    },
  ];

  M.SECTIONS = SECTION_DEFS.map((d) => d.id);
  M.SECTION_DEFS = {};
  SECTION_DEFS.forEach((d) => { M.SECTION_DEFS[d.id] = d; });

  function defOf(sectionId) { return M.SECTION_DEFS[sectionId] || null; }
  M.sectionDef = defOf;
  M.fieldDef = function (sectionId, key) { const d = defOf(sectionId); return d ? d.fields.find((f) => f.key === key) || null : null; };

  /* ============================================================
     Defaults — the seed every new console starts from.
     ============================================================ */

  const DEFAULT_SETTINGS = [
    { key: "defaultTimezone", type: "text", label: "Default timezone", default: "UTC" },
    { key: "defaultSeverity", type: "ref", ref: "severities", label: "Default severity", default: "sev-warning" },
    { key: "defaultCalendar", type: "ref", ref: "calendars", label: "Default business-hours calendar", default: "cal-default" },
    { key: "defaultChannel", type: "ref", ref: "channels", label: "Default notification channel", default: "ch-email" },
    { key: "defaultMonitorIntervalMinutes", type: "number", label: "Default monitor interval (min)", default: 5 },
    { key: "defaultScriptTimeoutSeconds", type: "number", label: "Default script timeout (s)", default: 300 },
    { key: "alertDedupeMinutes", type: "number", label: "Alert de-duplication window (min)", default: 30 },
    { key: "maintenanceSuppressSeverity", type: "ref", ref: "severities", label: "Maintenance suppresses below", default: "sev-warning" },
    { key: "patchWindow", type: "ref", ref: "maintenanceWindows", label: "Default patch window", default: "mw-nightly" },
  ];
  M.SETTINGS_DEFS = DEFAULT_SETTINGS;

  function seedRec(sectionId, data) {
    return normalizeRecord(sectionId, Object.assign({}, data));
  }

  function defaultSections() {
    const s = {};
    s.severities = [
      seedRec("severities", { id: "sev-info", label: "Info", rank: 10, tone: "info", color: "#0a58ca", notify: false, escalateAfterMinutes: 0, isDefault: true, description: "Informational — recorded, never pages anyone." }),
      seedRec("severities", { id: "sev-warning", label: "Warning", rank: 20, tone: "warn", color: "#f59e0b", notify: true, escalateAfterMinutes: 60, description: "Degraded but still working — investigate during business hours." }),
      seedRec("severities", { id: "sev-critical", label: "Critical", rank: 30, tone: "danger", color: "#dc2626", notify: true, escalateAfterMinutes: 15, description: "Service-affecting — notify on-call immediately." }),
      seedRec("severities", { id: "sev-emergency", label: "Emergency", rank: 40, tone: "danger", color: "#7f1d1d", notify: true, escalateAfterMinutes: 5, description: "Outage or security event — page and escalate at once." }),
    ];
    s.monitorTypes = [
      seedRec("monitorTypes", { id: "mon-ping", label: "Ping / availability", category: "availability", target: "device", metric: "reachability", operator: "==", defaultThreshold: 1, defaultSeverity: "sev-critical", defaultDurationMinutes: 3, collectionIntervalMinutes: 1, description: "Device must answer an ICMP/tunnel probe." }),
      seedRec("monitorTypes", { id: "mon-cpu", label: "CPU utilisation", category: "performance", target: "device", metric: "cpu.percent", unit: "%", operator: ">", defaultThreshold: 90, defaultSeverity: "sev-warning", defaultDurationMinutes: 5, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-memory", label: "Memory utilisation", category: "performance", target: "device", metric: "memory.percent", unit: "%", operator: ">", defaultThreshold: 90, defaultSeverity: "sev-warning", defaultDurationMinutes: 5, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-disk", label: "Disk free space", category: "performance", target: "device", metric: "disk.freePercent", unit: "%", operator: "<", defaultThreshold: 10, defaultSeverity: "sev-warning", defaultDurationMinutes: 10, collectionIntervalMinutes: 15 }),
      seedRec("monitorTypes", { id: "mon-diskio", label: "Disk I/O latency", category: "performance", target: "device", metric: "disk.latencyMs", unit: "ms", operator: ">", defaultThreshold: 50, defaultSeverity: "sev-info", defaultDurationMinutes: 10, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-service", label: "Service state", category: "service", target: "service", metric: "state", operator: "!=", defaultThreshold: 0, defaultSeverity: "sev-critical", defaultDurationMinutes: 2, collectionIntervalMinutes: 5, description: "A named service must be running (threshold text = expected state)." }),
      seedRec("monitorTypes", { id: "mon-process", label: "Process presence", category: "process", target: "process", metric: "count", operator: "<", defaultThreshold: 1, defaultSeverity: "sev-warning", defaultDurationMinutes: 5, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-eventlog", label: "Windows event log", category: "eventlog", target: "device", metric: "event.count", operator: ">", defaultThreshold: 0, defaultSeverity: "sev-warning", defaultDurationMinutes: 1, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-app-crash", label: "Application crash", category: "application", target: "device", metric: "crash.count", operator: ">", defaultThreshold: 0, defaultSeverity: "sev-critical", defaultDurationMinutes: 1, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-port", label: "TCP port check", category: "network", target: "port", metric: "open", operator: "==", defaultThreshold: 1, defaultSeverity: "sev-critical", defaultDurationMinutes: 2, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-http", label: "HTTP(S) check", category: "network", target: "url", metric: "statusCode", operator: "==", defaultThreshold: 200, defaultSeverity: "sev-critical", defaultDurationMinutes: 3, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-latency", label: "Network latency", category: "network", target: "device", metric: "roundTripMs", unit: "ms", operator: ">", defaultThreshold: 150, defaultSeverity: "sev-info", defaultDurationMinutes: 5, collectionIntervalMinutes: 5 }),
      seedRec("monitorTypes", { id: "mon-script", label: "Custom script monitor", category: "script", target: "device", metric: "exitCode", operator: "!=", defaultThreshold: 0, defaultSeverity: "sev-warning", defaultDurationMinutes: 2, collectionIntervalMinutes: 15 }),
      seedRec("monitorTypes", { id: "mon-snmp", label: "SNMP OID check", category: "snmp", target: "device", metric: "oid.value", operator: ">", defaultThreshold: 0, defaultSeverity: "sev-warning", defaultDurationMinutes: 5, collectionIntervalMinutes: 15 }),
      seedRec("monitorTypes", { id: "mon-patch", label: "Patch compliance", category: "patch", target: "device", metric: "missingCritical", operator: ">", defaultThreshold: 0, defaultSeverity: "sev-warning", defaultDurationMinutes: 60, collectionIntervalMinutes: 1440 }),
      seedRec("monitorTypes", { id: "mon-av", label: "Antivirus protection", category: "security", target: "device", metric: "protectionEnabled", operator: "==", defaultThreshold: 1, defaultSeverity: "sev-critical", defaultDurationMinutes: 5, collectionIntervalMinutes: 15 }),
      seedRec("monitorTypes", { id: "mon-backup", label: "Backup verification", category: "backup", target: "device", metric: "hoursSinceSuccess", unit: "h", operator: ">", defaultThreshold: 26, defaultSeverity: "sev-critical", defaultDurationMinutes: 60, collectionIntervalMinutes: 60 }),
    ];
    s.channels = [
      seedRec("channels", { id: "ch-console", label: "In-console", type: "in-console", target: "alerts", minSeverity: "sev-info", rateLimitMinutes: 0, description: "The alert timeline inside the console." }),
      seedRec("channels", { id: "ch-email", label: "NOC email", type: "email", target: "noc@example.com", minSeverity: "sev-warning", rateLimitMinutes: 10 }),
      seedRec("channels", { id: "ch-sms", label: "On-call SMS", type: "sms", target: "+15551234567", minSeverity: "sev-critical", rateLimitMinutes: 0 }),
      seedRec("channels", { id: "ch-webhook", label: "Webhook", type: "webhook", target: "https://hooks.example.com/rmm", minSeverity: "sev-warning", rateLimitMinutes: 1 }),
      seedRec("channels", { id: "ch-slack", label: "Slack #alerts", type: "slack", target: "#alerts", minSeverity: "sev-warning", rateLimitMinutes: 5 }),
      seedRec("channels", { id: "ch-teams", label: "Microsoft Teams", type: "teams", target: "MSP Ops", minSeverity: "sev-warning", rateLimitMinutes: 5 }),
      seedRec("channels", { id: "ch-psa", label: "PSA ticket (psa-u)", type: "psa-ticket", target: "psa-u", minSeverity: "sev-critical", rateLimitMinutes: 30, description: "Opens a ticket in the pipeline PSA." }),
    ];
    s.schedules = [
      seedRec("schedules", { id: "sched-1m", label: "Every minute", kind: "interval", intervalMinutes: 1, enabled: false }),
      seedRec("schedules", { id: "sched-5m", label: "Every 5 minutes", kind: "interval", intervalMinutes: 5 }),
      seedRec("schedules", { id: "sched-15m", label: "Every 15 minutes", kind: "interval", intervalMinutes: 15 }),
      seedRec("schedules", { id: "sched-1h", label: "Hourly", kind: "interval", intervalMinutes: 60 }),
      seedRec("schedules", { id: "sched-daily-2", label: "Daily 02:00", kind: "daily", timeOfDay: "02:00" }),
      seedRec("schedules", { id: "sched-weekly-sun", label: "Weekly (Sun 03:00)", kind: "weekly", daysOfWeek: ["sun"], timeOfDay: "03:00" }),
      seedRec("schedules", { id: "sched-monthly-1", label: "Monthly (1st 04:00)", kind: "monthly", timeOfDay: "04:00" }),
      seedRec("schedules", { id: "sched-bh", label: "Business hours (09:00)", kind: "daily", timeOfDay: "09:00" }),
    ];
    s.calendars = [
      seedRec("calendars", { id: "cal-default", label: "Default business hours", timezone: "UTC", workdays: ["mon", "tue", "wed", "thu", "fri"], startTime: "09:00", endTime: "17:00", isDefault: true }),
      seedRec("calendars", { id: "cal-24x7", label: "24×7 coverage", timezone: "UTC", workdays: WEEKDAYS.slice(), startTime: "00:00", endTime: "23:59", description: "Always in hours — for round-the-clock clients." }),
      seedRec("calendars", { id: "cal-extended", label: "Extended cover", timezone: "UTC", workdays: ["mon", "tue", "wed", "thu", "fri", "sat"], startTime: "08:00", endTime: "20:00" }),
    ];
    s.maintenanceWindows = [
      seedRec("maintenanceWindows", { id: "mw-nightly", label: "Nightly patching", recurrence: "daily", startTime: "01:00", endTime: "05:00", scope: "global", suppressAlerts: true, allowCritical: true }),
      seedRec("maintenanceWindows", { id: "mw-weekend", label: "Weekend maintenance", recurrence: "weekly", daysOfWeek: ["sat", "sun"], startTime: "00:00", endTime: "23:59", suppressAlerts: true, allowCritical: false }),
      seedRec("maintenanceWindows", { id: "mw-month-end", label: "Month-end close", recurrence: "monthly", startTime: "22:00", endTime: "23:59", suppressAlerts: true, allowCritical: true }),
    ];
    s.patchClassifications = [
      seedRec("patchClassifications", { id: "pc-critical", label: "Critical security updates", vendor: "Microsoft", categoryCode: "CriticalUpdates", severity: "sev-critical", autoApprove: true, autoDeploy: true, requiresReboot: true, deferralDays: 0 }),
      seedRec("patchClassifications", { id: "pc-security", label: "Security updates", vendor: "Microsoft", categoryCode: "SecurityUpdates", severity: "sev-warning", autoApprove: true, autoDeploy: true, requiresReboot: true, deferralDays: 3 }),
      seedRec("patchClassifications", { id: "pc-definition", label: "Definition updates", vendor: "Microsoft", categoryCode: "DefinitionUpdates", severity: "sev-info", autoApprove: true, autoDeploy: true, requiresReboot: false, deferralDays: 0 }),
      seedRec("patchClassifications", { id: "pc-feature", label: "Feature packs", vendor: "Microsoft", categoryCode: "FeaturePacks", severity: "sev-warning", autoApprove: false, autoDeploy: false, requiresReboot: true, deferralDays: 14 }),
      seedRec("patchClassifications", { id: "pc-driver", label: "Drivers", vendor: "Microsoft", categoryCode: "Drivers", severity: "sev-warning", autoApprove: false, autoDeploy: false, requiresReboot: true, deferralDays: 7 }),
      seedRec("patchClassifications", { id: "pc-servicepack", label: "Service packs", vendor: "Microsoft", categoryCode: "ServicePacks", severity: "sev-warning", autoApprove: false, autoDeploy: false, requiresReboot: true, deferralDays: 14 }),
      seedRec("patchClassifications", { id: "pc-tools", label: "Tools", vendor: "Microsoft", categoryCode: "Tools", severity: "sev-info", autoApprove: true, autoDeploy: true, requiresReboot: false, deferralDays: 0 }),
      seedRec("patchClassifications", { id: "pc-updates", label: "Update rollups", vendor: "Microsoft", categoryCode: "UpdateRollups", severity: "sev-warning", autoApprove: true, autoDeploy: false, requiresReboot: true, deferralDays: 7 }),
      seedRec("patchClassifications", { id: "pc-upgrades", label: "Upgrades", vendor: "Microsoft", categoryCode: "Upgrades", severity: "sev-info", autoApprove: false, autoDeploy: false, requiresReboot: true, deferralDays: 30 }),
    ];
    s.softwareCategories = [
      seedRec("softwareCategories", { id: "sc-productivity", label: "Productivity", color: "#0a58ca" }),
      seedRec("softwareCategories", { id: "sc-security", label: "Security", color: "#dc2626" }),
      seedRec("softwareCategories", { id: "sc-development", label: "Development", color: "#7c3aed" }),
      seedRec("softwareCategories", { id: "sc-browser", label: "Browsers", color: "#0891b2" }),
      seedRec("softwareCategories", { id: "sc-utility", label: "Utilities", color: "#475569" }),
      seedRec("softwareCategories", { id: "sc-communication", label: "Communication & collaboration", color: "#16a34a" }),
      seedRec("softwareCategories", { id: "sc-lob", label: "Line-of-business", color: "#b45309" }),
      seedRec("softwareCategories", { id: "sc-runtime", label: "Runtimes & frameworks", color: "#0f766e" }),
      seedRec("softwareCategories", { id: "sc-driver", label: "Drivers & firmware", color: "#9333ea" }),
      seedRec("softwareCategories", { id: "sc-backup", label: "Backup & recovery", color: "#334155" }),
    ];
    s.tagTaxonomy = [
      seedRec("tagTaxonomy", { id: "tag-production", name: "production", category: "environment", color: "#dc2626" }),
      seedRec("tagTaxonomy", { id: "tag-staging", name: "staging", category: "environment", color: "#f59e0b" }),
      seedRec("tagTaxonomy", { id: "tag-test", name: "test", category: "environment", color: "#6c757d" }),
      seedRec("tagTaxonomy", { id: "tag-server", name: "server", category: "role", color: "#0a58ca" }),
      seedRec("tagTaxonomy", { id: "tag-workstation", name: "workstation", category: "role", color: "#0891b2" }),
      seedRec("tagTaxonomy", { id: "tag-laptop", name: "laptop", category: "role", color: "#16a34a" }),
      seedRec("tagTaxonomy", { id: "tag-critical", name: "critical", category: "compliance", color: "#7f1d1d" }),
      seedRec("tagTaxonomy", { id: "tag-pci", name: "pci", category: "compliance", color: "#9333ea" }),
      seedRec("tagTaxonomy", { id: "tag-hipaa", name: "hipaa", category: "compliance", color: "#be123c" }),
      seedRec("tagTaxonomy", { id: "tag-backup", name: "backup", category: "role", color: "#475569" }),
      seedRec("tagTaxonomy", { id: "tag-managed", name: "managed", category: "custom", color: "#0f766e" }),
    ];
    s.groupTaxonomy = [
      seedRec("groupTaxonomy", { id: "gt-static", label: "Static group", kind: "static", autoAssignNewDevices: false, description: "Membership is managed by hand." }),
      seedRec("groupTaxonomy", { id: "gt-dynamic", label: "Dynamic (rule-based)", kind: "dynamic", rule: "os.family == \"Windows\"", autoAssignNewDevices: true, description: "Membership follows a rule evaluated against device attributes." }),
      seedRec("groupTaxonomy", { id: "gt-site", label: "Site group", kind: "site", autoAssignNewDevices: true, description: "Every device at one site." }),
      seedRec("groupTaxonomy", { id: "gt-provider", label: "Provider-wide group", kind: "provider", autoAssignNewDevices: false, description: "Spans every site in the tenant." }),
    ];
    s.scriptCategories = [
      seedRec("scriptCategories", { id: "scr-diagnostics", label: "Diagnostics", supportedOs: OSES.slice(), requiresApproval: false, defaultTimeoutSeconds: 300 }),
      seedRec("scriptCategories", { id: "scr-remediation", label: "Remediation", supportedOs: OSES.slice(), requiresApproval: true, defaultTimeoutSeconds: 600 }),
      seedRec("scriptCategories", { id: "scr-deployment", label: "Deployment", supportedOs: OSES.slice(), requiresApproval: true, defaultTimeoutSeconds: 900 }),
      seedRec("scriptCategories", { id: "scr-maintenance", label: "Maintenance", supportedOs: OSES.slice(), requiresApproval: true, defaultTimeoutSeconds: 900 }),
      seedRec("scriptCategories", { id: "scr-security", label: "Security", supportedOs: OSES.slice(), requiresApproval: true, defaultTimeoutSeconds: 600 }),
      seedRec("scriptCategories", { id: "scr-reporting", label: "Reporting", supportedOs: OSES.slice(), requiresApproval: false, defaultTimeoutSeconds: 300 }),
      seedRec("scriptCategories", { id: "scr-backup", label: "Backup & recovery", supportedOs: OSES.slice(), requiresApproval: true, defaultTimeoutSeconds: 1800 }),
      seedRec("scriptCategories", { id: "scr-networking", label: "Networking", supportedOs: OSES.slice(), requiresApproval: true, defaultTimeoutSeconds: 300 }),
    ];
    return s;
  }

  function defaultConfig() {
    const sections = defaultSections();
    const settings = {};
    DEFAULT_SETTINGS.forEach((f) => { settings[f.key] = f.default; });
    return {
      kind: CONFIG_KIND,
      id: "master",
      sections,
      settings,
      history: [],
      createdAt: now(),
      updatedAt: now(),
    };
  }

  /* ============================================================
     Record normalisation, coercion & validation
     ============================================================ */

  function newId(sectionId) {
    const d = defOf(sectionId);
    return (d ? d.idPrefix : "rec") + "-" + rand(6);
  }
  M.newId = newId;

  function coerce(f, v) {
    switch (f.type) {
      case "bool": return v == null ? !!f.default : !!v;
      case "number": {
        if (v == null || v === "") return f.default == null ? null : f.default;
        const n = Number(v);
        return isFinite(n) ? n : (f.default == null ? null : f.default);
      }
      case "tags": return Array.isArray(v) ? v.map(String) : splitTags(v);
      case "select": {
        const vals = (f.options || []).map((o) => (typeof o === "object" ? o.value : o));
        if (v == null || v === "") return f.default != null ? f.default : (vals[0] || "");
        return String(v);
      }
      case "ref": return v == null ? (f.default || "") : String(v);
      default: return v == null ? (f.default == null ? "" : f.default) : String(v);
    }
  }
  M.coerce = coerce;

  function normalizeRecord(sectionId, rec) {
    const d = defOf(sectionId);
    if (!d) return null;
    rec = asObj(rec);
    const out = { id: rec.id ? String(rec.id) : newId(sectionId) };
    d.fields.forEach((f) => { out[f.key] = coerce(f, rec[f.key]); });
    out.createdAt = rec.createdAt || now();
    out.updatedAt = rec.updatedAt || out.createdAt;
    return out;
  }
  M.normalizeRecord = normalizeRecord;

  function validateRecord(sectionId, rec) {
    const d = defOf(sectionId);
    const errors = [];
    if (!d) return { valid: false, errors: ["unknown section"] };
    if (!rec || typeof rec !== "object") return { valid: false, errors: ["record is not an object"] };
    if (!rec.id) errors.push("missing id");
    d.fields.forEach((f) => {
      const v = rec[f.key];
      if (f.required && (v == null || v === "" || (Array.isArray(v) && !v.length))) errors.push(f.label + " is required");
      if (f.type === "number" && v != null && v !== "" && !isFinite(Number(v))) errors.push(f.label + " must be a number");
      if (f.type === "select" && v) {
        const vals = (f.options || []).map((o) => (typeof o === "object" ? o.value : o));
        if (vals.indexOf(String(v)) === -1) errors.push(f.label + " has an unrecognised value: " + v);
      }
    });
    return { valid: errors.length === 0, errors };
  }
  M.validateRecord = validateRecord;

  function normalizeConfig(rec) {
    rec = asObj(rec);
    const src = asObj(rec.sections);
    const sections = {};
    SECTION_DEFS.forEach((d) => {
      const arr = Array.isArray(src[d.id]) ? src[d.id] : (Array.isArray(rec[d.id]) ? rec[d.id] : []);
      sections[d.id] = arr.map((r) => normalizeRecord(d.id, r)).filter(Boolean);
    });
    const settings = {};
    DEFAULT_SETTINGS.forEach((f) => {
      const raw = asObj(rec.settings)[f.key];
      settings[f.key] = raw == null ? f.default : raw;
    });
    return {
      kind: CONFIG_KIND,
      id: "master",
      sections,
      settings,
      history: asArr(rec.history).slice(0, HISTORY_LIMIT),
      createdAt: rec.createdAt || now(),
      updatedAt: rec.updatedAt || now(),
      updatedBy: rec.updatedBy || "owner",
    };
  }
  M.normalizeConfig = normalizeConfig;

  /* ============================================================
     Load / commit through the canonical store
     ============================================================ */

  let memo = { at: 0, config: null };

  function setMemo(config) { memo = { at: Date.now(), config: clone(config) }; }

  function readConfigFromDoc(r) {
    const rec = (r && r.records || []).find((x) => x && x.kind === CONFIG_KIND) || (r && r.records || [])[0] || null;
    return rec ? normalizeConfig(rec) : null;
  }

  M.all = async function (opts) {
    opts = opts || {};
    if (!opts.force && memo.config && Date.now() - memo.at < 1200) return clone(memo.config);
    const r = await store.loadDoc(CONFIG_MODULE);
    let config = r.error ? null : readConfigFromDoc(r);
    if (!config) config = null; // absence is meaningful — M.seed fills it
    if (config) setMemo(config);
    return config ? clone(config) : null;
  };
  M.get = M.all;

  /* The guaranteed-present config: never null (empty shell if unseeded). */
  M.current = async function (opts) {
    const c = await M.all(opts);
    if (c) return c;
    return emptyConfig();
  };

  function emptyConfig() {
    const sections = {};
    SECTION_DEFS.forEach((d) => { sections[d.id] = []; });
    const settings = {};
    DEFAULT_SETTINGS.forEach((f) => { settings[f.key] = f.default; });
    return { kind: CONFIG_KIND, id: "master", sections, settings, history: [], createdAt: now(), updatedAt: now() };
  }

  function commit(mutate) {
    return (async () => {
      const config = (await M.all({ force: true })) || emptyConfig();
      const entry = mutate(config);
      if (entry && entry.error) return entry;
      if (entry && entry.replaceHistory) config.history = [entry];
      else if (entry) config.history = [entry].concat(asArr(config.history)).slice(0, HISTORY_LIMIT);
      config.updatedAt = now();
      config.updatedBy = ERP.role || "owner";
      const payload = normalizeConfig(config);
      const res = await store.saveDoc(CONFIG_MODULE, [payload]);
      if (res.error) return { error: res.error, message: res.message, conflict: !!res.conflict };
      setMemo(payload);
      notify(entry && entry.action, { section: entry && entry.section, itemId: entry && entry.itemId });
      return { config: clone(payload), entry: entry || null };
    })();
  }

  function hist(section, itemId, action, summary) {
    return { id: "h-" + rand(6), ts: now(), actor: ERP.role || "owner", section, itemId: itemId || null, action, summary };
  }

  const labelOf = (d, rec) => (rec && (rec[d.labelKey] || rec.id)) || rec.id;

  /* ============================================================
     CRUD
     ============================================================ */

  M.add = function (sectionId, data) {
    const d = defOf(sectionId);
    if (!d) return Promise.resolve({ error: "unknown_section", section: sectionId });
    return commit((config) => {
      const rec = normalizeRecord(sectionId, data || {});
      if (!rec) return { error: "unknown_section" };
      const v = validateRecord(sectionId, rec);
      if (!v.valid) return { error: "invalid_record", errors: v.errors };
      if (config.sections[sectionId].some((x) => x.id === rec.id)) return { error: "duplicate_id", id: rec.id };
      config.sections[sectionId].push(rec);
      return hist(sectionId, rec.id, "add", "Added " + d.singular + " “" + labelOf(d, rec) + "”.");
    });
  };

  M.update = function (sectionId, id, patch) {
    const d = defOf(sectionId);
    if (!d) return Promise.resolve({ error: "unknown_section", section: sectionId });
    return commit((config) => {
      const rec = config.sections[sectionId].find((x) => x.id === id);
      if (!rec) return { error: "not_found", section: sectionId, id };
      const merged = normalizeRecord(sectionId, Object.assign({}, rec, clone(patch) || {}));
      const v = validateRecord(sectionId, merged);
      if (!v.valid) return { error: "invalid_record", errors: v.errors };
      merged.id = rec.id;
      merged.createdAt = rec.createdAt;
      merged.updatedAt = now();
      Object.assign(rec, merged);
      return hist(sectionId, id, "update", "Updated " + d.singular + " “" + labelOf(d, rec) + "”.");
    });
  };

  M.remove = function (sectionId, id) {
    const d = defOf(sectionId);
    if (!d) return Promise.resolve({ error: "unknown_section", section: sectionId });
    return commit((config) => {
      const rec = config.sections[sectionId].find((x) => x.id === id);
      if (!rec) return { error: "not_found", section: sectionId, id };
      const name = labelOf(d, rec);
      config.sections[sectionId] = config.sections[sectionId].filter((x) => x.id !== id);
      return hist(sectionId, id, "remove", "Removed " + d.singular + " “" + name + "”.");
    });
  };

  M.setEnabled = function (sectionId, id, enabled) {
    return M.update(sectionId, id, { enabled: !!enabled });
  };

  M.toggle = async function (sectionId, id) {
    const c = await M.current();
    const rec = (c.sections[sectionId] || []).find((x) => x.id === id);
    if (!rec) return { error: "not_found", section: sectionId, id };
    return M.setEnabled(sectionId, id, rec.enabled === false);
  };

  M.move = function (sectionId, id, delta) {
    const d = defOf(sectionId);
    if (!d) return Promise.resolve({ error: "unknown_section", section: sectionId });
    return commit((config) => {
      const list = config.sections[sectionId];
      const i = list.findIndex((x) => x.id === id);
      if (i === -1) return { error: "not_found", section: sectionId, id };
      const j = i + delta;
      if (j < 0 || j >= list.length) return { error: "out_of_range" };
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      return hist(sectionId, id, "reorder", "Moved " + d.singular + " “" + labelOf(d, list[j]) + "” " + (delta < 0 ? "up" : "down") + ".");
    });
  };

  M.reorder = function (sectionId, ids) {
    const d = defOf(sectionId);
    if (!d) return Promise.resolve({ error: "unknown_section", section: sectionId });
    return commit((config) => {
      const byId = {};
      config.sections[sectionId].forEach((r) => { byId[r.id] = r; });
      const next = asArr(ids).map((x) => byId[x]).filter(Boolean);
      config.sections[sectionId].forEach((r) => { if (next.indexOf(r) === -1) next.push(r); });
      config.sections[sectionId] = next;
      return hist(sectionId, null, "reorder", "Reordered " + d.tab + ".");
    });
  };

  /* Enforce a single default within any section that has an isDefault field. */
  M.setDefault = function (sectionId, id) {
    const d = defOf(sectionId);
    if (!d || !d.fields.some((f) => f.key === "isDefault")) return Promise.resolve({ error: "no_default_field", section: sectionId });
    return commit((config) => {
      const rec = config.sections[sectionId].find((x) => x.id === id);
      if (!rec) return { error: "not_found", section: sectionId, id };
      config.sections[sectionId].forEach((x) => { x.isDefault = x.id === id; });
      return hist(sectionId, id, "default", "Made “" + labelOf(d, rec) + "” the default " + d.singular + ".");
    });
  };

  /* ============================================================
     Settings
     ============================================================ */

  M.settings = async function () {
    const c = await M.current();
    return clone(c.settings);
  };

  M.saveSettings = function (patch) {
    return commit((config) => {
      DEFAULT_SETTINGS.forEach((f) => {
        if (patch && Object.prototype.hasOwnProperty.call(patch, f.key)) {
          const v = patch[f.key];
          if (f.type === "number") config.settings[f.key] = v === "" || v == null ? f.default : Number(v);
          else config.settings[f.key] = v == null ? "" : v;
        }
      });
      return hist("settings", null, "update", "Updated master-configuration defaults.");
    });
  };

  /* ============================================================
     Lookups & resolvers for later phases
     ============================================================ */

  M.section = async function (sectionId) {
    const c = await M.current();
    return clone(asArr((c.sections || {})[sectionId]));
  };

  M.item = async function (sectionId, id) {
    const list = await M.section(sectionId);
    return list.find((x) => x.id === id) || null;
  };

  M.severity = (id) => M.item("severities", id);
  M.monitorType = (id) => M.item("monitorTypes", id);
  M.channel = (id) => M.item("channels", id);
  M.schedule = (id) => M.item("schedules", id);
  M.calendar = (id) => M.item("calendars", id);
  M.maintenanceWindow = (id) => M.item("maintenanceWindows", id);
  M.patchClass = (id) => M.item("patchClassifications", id);
  M.softwareCategory = (id) => M.item("softwareCategories", id);
  M.scriptCategory = (id) => M.item("scriptCategories", id);

  M.severityTone = async function (id) {
    const s = await M.severity(id);
    return (s && s.tone) || "muted";
  };

  M.tags = async function () {
    const list = await M.section("tagTaxonomy");
    return list.filter((t) => t.enabled !== false).map((t) => t.name);
  };

  M.refOptions = async function (sectionId) {
    const list = await M.section(sectionId);
    const d = defOf(sectionId);
    return list.map((r) => ({ value: r.id, label: (d ? labelOf(d, r) : r.id) + (r.enabled === false ? " (disabled)" : "") }));
  };

  M.label = async function (sectionId, id) {
    if (!id) return "";
    const it = await M.item(sectionId, id);
    const d = defOf(sectionId);
    return it ? labelOf(d, it) : id;
  };

  M.enabled = async function (sectionId) {
    const list = await M.section(sectionId);
    return list.filter((r) => r.enabled !== false);
  };

  /* Reject any reference that does not point at a live record. */
  M.validate = async function () {
    const c = await M.current();
    const errors = [];
    SECTION_DEFS.forEach((d) => {
      const list = asArr(c.sections[d.id]);
      const seen = {};
      list.forEach((r) => {
        if (seen[r.id]) errors.push(d.tab + ": duplicate id " + r.id);
        seen[r.id] = true;
        const v = validateRecord(d.id, r);
        v.errors.forEach((e) => errors.push(d.tab + " — " + labelOf(d, r) + ": " + e));
      });
      d.fields.filter((f) => f.type === "ref").forEach((f) => {
        list.forEach((r) => {
          if (r[f.key] && !asArr(c.sections[f.ref]).some((x) => x.id === r[f.key])) {
            errors.push(d.tab + " — " + labelOf(d, r) + ": " + f.label + " points at a missing " + f.ref + " record (" + r[f.key] + ")");
          }
        });
      });
      if (d.fields.some((f) => f.key === "isDefault")) {
        const defaults = list.filter((r) => r.isDefault);
        if (defaults.length > 1) errors.push(d.tab + ": more than one entry is marked default");
      }
    });
    return { valid: errors.length === 0, errors };
  };

  M.stats = async function () {
    const c = await M.current();
    const bySection = {};
    SECTION_DEFS.forEach((d) => { bySection[d.id] = asArr(c.sections[d.id]).length; });
    return { sections: SECTION_DEFS.length, records: Object.keys(bySection).reduce((n, k) => n + bySection[k], 0), bySection, settings: DEFAULT_SETTINGS.length, history: asArr(c.history).length, docName: store.docName(CONFIG_MODULE) };
  };

  /* ============================================================
     Change history
     ============================================================ */

  M.history = async function (opts) {
    opts = opts || {};
    const c = await M.current();
    let list = asArr(c.history);
    if (opts.section) list = list.filter((h) => h.section === opts.section);
    if (opts.limit) list = list.slice(0, opts.limit);
    return clone(list);
  };

  M.clearHistory = function () {
    return commit(() => {
      const entry = hist("config", null, "clear-history", "Cleared the change history.");
      entry.replaceHistory = true;
      return entry;
    });
  };

  /* ============================================================
     Time helpers — "is this device in business hours / a window?"
     ============================================================ */

  function zonedParts(date, tz) {
    const d = date instanceof Date ? date : new Date(date);
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
    } catch (e) {
      parts = new Intl.DateTimeFormat("en-US", { hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
    }
    const p = {};
    parts.forEach((x) => { p[x.type] = x.value; });
    const hh = (p.hour === "24" ? "00" : p.hour) || "00";
    const mm = p.minute || "00";
    return { weekday: String(p.weekday || "").toLowerCase().slice(0, 3), date: (p.year || "0000") + "-" + (p.month || "01") + "-" + (p.day || "01"), time: hh + ":" + mm, minutes: Number(hh) * 60 + Number(mm) };
  }
  M.zonedParts = zonedParts;

  function timeInRange(time, start, end) {
    if (!start || !end) return true;
    return time >= start && time <= end;
  }

  M.inBusinessHours = async function (at, calendarId) {
    const c = await M.current();
    const cal = calendarId
      ? asArr(c.sections.calendars).find((x) => x.id === calendarId)
      : (asArr(c.sections.calendars).find((x) => x.isDefault) || asArr(c.sections.calendars)[0]);
    if (!cal || cal.enabled === false) return true; // no calendar → treated as always in hours
    const p = zonedParts(at || new Date(), cal.timezone);
    if (asArr(cal.workdays).length && asArr(cal.workdays).indexOf(p.weekday) === -1) return false;
    if (asArr(cal.holidays).indexOf(p.date) !== -1) return false;
    return timeInRange(p.time, cal.startTime, cal.endTime);
  };

  function maintenanceActive(w, at) {
    if (!w || w.enabled === false) return false;
    const p = zonedParts(at || new Date(), w.timezone);
    if (!timeInRange(p.time, w.startTime, w.endTime)) return false;
    switch (w.recurrence) {
      case "once": return w.startDate ? (p.date >= w.startDate && p.date <= (w.endDate || w.startDate)) : true;
      case "weekly": return asArr(w.daysOfWeek).indexOf(p.weekday) !== -1;
      case "monthly": {
        const day = w.startDate ? Number(String(w.startDate).slice(8, 10)) || 1 : 1;
        return Number(p.date.slice(8, 10)) === day;
      }
      case "daily":
      default: return true;
    }
  }
  M.maintenanceActive = maintenanceActive;

  /* Windows covering `at`, optionally filtered to a scope
     ({type:"site"|"group"|"device"|"provider", id}). */
  M.activeMaintenance = async function (at, scope) {
    const c = await M.current();
    return asArr(c.sections.maintenanceWindows).filter((w) => {
      if (scope) {
        const type = w.scope || "global";
        if (type !== "global") {
          const want = scope.type || scope.kind;
          if (String(type) !== String(want) || String(w.scopeId || "") !== String(scope.id || "")) return false;
        }
      }
      return maintenanceActive(w, at);
    });
  };

  /* Convenience used by monitors/alerts later: does this device fall
     inside any suppressing window right now? */
  M.isSuppressed = async function (at, scope) {
    const wins = await M.activeMaintenance(at, scope);
    return { suppressed: wins.length > 0, windows: wins.map((w) => w.id) };
  };

  /* ============================================================
     Seed & boot
     ============================================================ */

  M.seed = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.seedMasterConfig", true) === false) return { skipped: true, reason: "seed_disabled" };
    const current = await M.all({ force: true });
    if (current && !opts.force) return { skipped: true, reason: "config_present", sections: Object.keys(current.sections).length };
    const payload = defaultConfig();
    const res = await store.saveDoc(CONFIG_MODULE, [payload]);
    if (res.error) return { error: res.error, message: res.message };
    setMemo(payload);
    notify("seed", {});
    const counts = {};
    let records = 0;
    SECTION_DEFS.forEach((d) => { const n = defaultSections()[d.id].length; counts[d.id] = n; records += n; });
    return { seeded: true, sections: SECTION_DEFS.length, records, bySection: counts };
  };

  M.reseed = function () { return M.seed({ force: true }); };

  let readyResolve;
  M.ready = new Promise((res) => { readyResolve = res; });

  M.init = async function () {
    try { await M.seed(); } catch (e) { console.error("master configuration seed failed", e); } finally { readyResolve(); }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", M.init);
  else M.init();

  /* ============================================================
     Change notification
     ============================================================ */

  const listeners = [];
  M.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  /* ============================================================
     Admin console — the one place all of this is edited
     ============================================================ */

  let currentCfg = null;
  let nav = { section: null };

  function esc(s) { return ui.esc(s); }
  function sectionTab(id) { const d = defOf(id); return d ? d.tab : id; }

  function refLabel(sectionId, id) {
    if (!id || !currentCfg) return "";
    const list = asArr(currentCfg.sections[sectionId]);
    const it = list.find((x) => x.id === id);
    if (!it) return id;
    const d = defOf(sectionId);
    return labelOf(d, it);
  }

  function control(f, val) {
    switch (f.type) {
      case "textarea": return ui.textarea(f.key, f.label, val);
      case "number": return ui.number(f.key, f.label, val, { min: f.min, step: f.step, hint: f.hint });
      case "bool": return ui.check(f.key, f.label, !!val);
      case "select": return ui.select(f.key, f.label, (f.options || []).map((o) => (typeof o === "object" ? o : { value: o, label: o })), val);
      case "ref": return ui.select(f.key, f.label, refOptionsSync(f.ref), val);
      case "time": return ui.field(f.label, '<input type="time" name="' + esc(f.key) + '" value="' + esc(val || "") + '">', f.hint);
      case "date": return ui.field(f.label, '<input type="date" name="' + esc(f.key) + '" value="' + esc(val || "") + '">', f.hint);
      case "color": return ui.field(f.label, '<input type="color" name="' + esc(f.key) + '" value="' + esc(val || "#0a58ca") + '">', f.hint);
      case "tags": return ui.field(f.label, '<input type="text" name="' + esc(f.key) + '" value="' + esc(asArr(val).join(", ")) + '" placeholder="' + esc(f.hint || "comma-separated") + '">', f.hint ? null : "Comma-separated");
      default: return ui.text(f.key, f.label, val, f.ph);
    }
  }

  function refOptionsSync(sectionId) {
    const d = defOf(sectionId);
    return asArr(currentCfg && currentCfg.sections[sectionId]).map((r) => ({ value: r.id, label: labelOf(d, r) + (r.enabled === false ? " (disabled)" : "") }));
  }

  function readField(scope, f) {
    const i = scope.querySelector('[name="' + f.key + '"]');
    if (!i) return undefined;
    if (f.type === "bool") return !!i.checked;
    if (f.type === "number") return i.value === "" ? null : Number(i.value);
    if (f.type === "tags") return splitTags(i.value);
    return i.value;
  }

  function cellHtml(f, rec) {
    if (!f) return "";
    const v = rec[f.key];
    if (f.type === "bool") return v ? ui.badge("Yes", "success") : ui.badge("No", "muted");
    if (f.type === "tags") return asArr(v).length ? asArr(v).map((x) => ui.badge(x, "muted")).join(" ") : '<span class="erp-sub">—</span>';
    if (f.type === "ref") return esc(refLabel(f.ref, v) || "—");
    if (f.type === "color") return '<span class="rmm-mc-swatch" style="background:' + esc(v || "#000") + '"></span> <span class="erp-sub">' + esc(v || "") + "</span>";
    if (f.type === "number") return v == null || v === "" ? '<span class="erp-sub">—</span>' : esc(String(v)) + (f.unit ? " " + esc(f.unit) : "");
    return v === "" || v == null ? '<span class="erp-sub">—</span>' : esc(String(v));
  }

  function nameCell(d, rec) {
    const label = rec[d.labelKey] || "(unnamed)";
    const dot = rec.enabled === false ? "tone-muted" : (d.id === "severities" ? "tone-" + (rec.tone || "muted") : "tone-success");
    return '<span class="rmm-mc-name"><span class="rmm-dot ' + dot + '"></span><b>' + esc(label) + '</b> <span class="erp-sub">' + esc(rec.id) + "</span></span>";
  }

  function rowActions(d, rec, canEdit) {
    if (!canEdit) return "";
    const sec = esc(d.id), id = esc(rec.id);
    const b = (label, act, extra) => '<button class="btn btn-ghost btn-sm" data-act="' + act + '" data-section="' + sec + '" data-id="' + id + '"' + (extra || "") + ">" + esc(label) + "</button>";
    let out = b("Edit", "mc-edit");
    out += b(rec.enabled === false ? "Enable" : "Disable", "mc-toggle");
    out += b("↑", "mc-up", ' title="Move up"') + b("↓", "mc-down", ' title="Move down"');
    if (d.fields.some((f) => f.key === "isDefault")) out += rec.isDefault ? ui.badge("default", "info") : b("Make default", "mc-default");
    out += b("Delete", "mc-del");
    return '<div class="rmm-mc-actions">' + out + "</div>";
  }

  function sectionPanelHtml(d, config, canEdit) {
    const rows = asArr(asObj(config.sections)[d.id]);
    const cols = [{ key: d.labelKey, label: d.labelKey === "name" ? "Tag" : "Name", render: (r) => nameCell(d, r) }];
    (d.columns || []).forEach((k) => { const f = d.fields.find((x) => x.key === k); if (f) cols.push({ key: k, label: f.label, render: (r) => cellHtml(f, r) }); });
    cols.push({ key: "enabled", label: "State", render: (r) => ui.badge(r.enabled === false ? "Disabled" : "Enabled", r.enabled === false ? "muted" : "success") });
    if (canEdit) cols.push({ key: "actions", label: "", render: (r) => rowActions(d, r, canEdit) });
    const head =
      '<div class="rmm-mc-section-head"><div><h3>' + esc(d.tab) + '</h3><p class="erp-sub">' + esc(d.desc) + "</p></div>" +
      (canEdit ? ui.btn("Add " + d.singular, { small: true, primary: true, act: "mc-add", arg: d.id }) : "") +
      "</div>";
    return head +
      ui.summary([{ label: "Entries", value: String(rows.length) }, { label: "Enabled", value: String(rows.filter((r) => r.enabled !== false).length) }]) +
      ui.table(cols, rows, { scroll: true, emptyText: "No " + d.tab.toLowerCase() + " yet." });
  }

  function settingsPanelHtml(config, canEdit) {
    const f = ui.form(DEFAULT_SETTINGS.map((x) => control(x, asObj(config.settings)[x.key])).join(""),
      canEdit ? ui.btn("Save defaults", { small: true, primary: true, act: "mc-save-settings" }) : "");
    return '<div class="rmm-mc-section-head"><div><h3>Defaults</h3><p class="erp-sub">System-wide defaults other stations read — the fallback severity and calendar, monitor and script timings, alert de-duplication, and the default channels/window.</p></div></div>' +
      ui.card("Default values", f);
  }

  function historyPanelHtml(config, canEdit) {
    const rows = asArr(config.history);
    const cols = [
      { key: "ts", label: "When", render: (r) => esc(ui.dateTime(r.ts)) },
      { key: "actor", label: "Actor", render: (r) => ui.badge(r.actor || "system", "muted") },
      { key: "section", label: "Area", render: (r) => esc(sectionTab(r.section)) },
      { key: "action", label: "Action", render: (r) => esc(r.action || "") },
      { key: "summary", label: "Change", render: (r) => esc(r.summary || "") },
    ];
    return '<div class="rmm-mc-section-head"><div><h3>Change history</h3><p class="erp-sub">Every change to the master configuration, newest first — who changed what, and when.</p></div>' +
      (canEdit ? ui.btn("Clear history", { small: true, act: "mc-hist-clear" }) : "") + "</div>" +
      ui.table(cols, rows.slice(0, 400), { scroll: true, emptyText: "No changes recorded yet." });
  }

  M.render = async function (ctx) {
    const root = ctx.el;
    const canEdit = ERP.role === "owner" || ERP.role === "manager";
    nav = { section: validTab(root.__tab) || "defaults" };

    async function paint() {
      await M.ready;
      const config = await M.current();
      currentCfg = config;
      const tabs = ui.tabs(
        [{ id: "defaults", label: "Defaults" }]
          .concat(SECTION_DEFS.map((d) => ({ id: d.id, label: d.tab, badge: String(asArr(asObj(config.sections)[d.id]).length) })))
          .concat([{ id: "access", label: "Roles & access" }, { id: "history", label: "Change history", badge: String(asArr(config.history).length) }]),
        nav.section
      );
      root.innerHTML =
        ui.pageHead("Master configuration",
          "The system-wide catalogues every station reads — monitor types, severity levels, notification channels, schedules, business-hours calendars, maintenance windows, patch classifications, software, tag, group and script taxonomies — with a full change history.",
          canEdit ? ui.badge("Owner / manager", "info") : ui.badge("Read-only", "muted")) +
        (canEdit ? "" : ui.alert("You can view the master configuration, but only owners and managers can change it.", "warn")) +
        tabs.html;
      root.querySelector('[data-panel="defaults"]').innerHTML = settingsPanelHtml(config, canEdit);
      SECTION_DEFS.forEach((d) => { root.querySelector('[data-panel="' + d.id + '"]').innerHTML = sectionPanelHtml(d, config, canEdit); });
      root.querySelector('[data-panel="history"]').innerHTML = historyPanelHtml(config, canEdit);
      if (nav.section === "access" && ERP.access) renderAccessPanel(root, ctx);
      ui.showTab(root, nav.section);
    }

    function renderAccessPanel(root, ctx) {
      const panel = root.querySelector('[data-panel="access"]');
      if (!panel) return;
      panel.innerHTML = '<div class="rmm-access-slot"></div><div class="rmm-mu-slot"></div>';
      const a = panel.querySelector(".rmm-access-slot"), m = panel.querySelector(".rmm-mu-slot");
      if (a && ERP.access) { try { ERP.access.render(a, ctx); } catch (e) {} }
      if (m && ERP.multiuser) { try { ERP.multiuser.render(m, ctx); } catch (e) {} }
    }

    function validTab(id) {
      if (!id) return null;
      if (id === "defaults" || id === "history" || id === "access") return id;
      return defOf(id) ? id : null;
    }

    async function openForm(sectionId, rec) {
      const d = defOf(sectionId);
      if (!d) return;
      const isNew = !rec;
      const body = ui.form(d.fields.map((f) => control(f, rec ? rec[f.key] : coerce(f, null))).join(""),
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isNew ? "Add " + d.singular : "Save changes", { small: true, primary: true, act: "mc-save" }));
      const m = ui.modal({ title: (isNew ? "New " : "Edit ") + d.singular, body, size: "lg" });
      if (!m) return;
      m.querySelector("[data-act=mc-save]").onclick = async () => {
        const values = {};
        d.fields.forEach((f) => { values[f.key] = readField(m, f); });
        const res = isNew ? await M.add(sectionId, values) : await M.update(sectionId, rec.id, values);
        if (res.error) { ctx.toast("Save failed: " + (res.error === "invalid_record" ? (res.errors || []).join("; ") : res.error), "error"); return; }
        ui.closeModal();
        ctx.toast((isNew ? "Added " : "Saved ") + d.singular);
        paint();
      };
    }

    root.onclick = async (e) => {
      const tabEl = e.target.closest ? e.target.closest("[data-tab]") : null;
      if (tabEl && root.contains(tabEl)) { nav.section = tabEl.getAttribute("data-tab"); ui.showTab(root, nav.section); if (nav.section === "access" && ERP.access) renderAccessPanel(root, ctx); return; }
      const el = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!el || !root.contains(el)) return;
      const act = el.getAttribute("data-act");
      const section = el.getAttribute("data-section");
      const id = el.getAttribute("data-id");
      const arg = el.getAttribute("data-arg");
      if (!canEdit) { ctx.toast("Only owners and managers can change the master configuration.", "error"); return; }
      if (act === "mc-add") return openForm(arg);
      if (act === "mc-edit") return openForm(section, (await M.item(section, id)) || undefined);
      if (act === "mc-toggle") { const r = await M.toggle(section, id); if (r.error) return ctx.toast("Update failed: " + r.error, "error"); return paint(); }
      if (act === "mc-up") { const r = await M.move(section, id, -1); if (r.error && r.error !== "out_of_range") return ctx.toast("Move failed: " + r.error, "error"); return paint(); }
      if (act === "mc-down") { const r = await M.move(section, id, 1); if (r.error && r.error !== "out_of_range") return ctx.toast("Move failed: " + r.error, "error"); return paint(); }
      if (act === "mc-default") { const r = await M.setDefault(section, id); if (r.error) return ctx.toast("Update failed: " + r.error, "error"); return paint(); }
      if (act === "mc-del") {
        const d = defOf(section);
        const rec = await M.item(section, id);
        const ok = await ui.confirm({ title: "Delete " + (d ? d.singular : "entry"), message: "Delete “" + (rec ? (rec[d.labelKey] || rec.id) : id) + "”? Other records referencing it will be flagged by validation.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await M.remove(section, id);
        if (r.error) return ctx.toast("Delete failed: " + r.error, "error");
        ctx.toast("Deleted"); return paint();
      }
      if (act === "mc-save-settings") {
        const form = root.querySelector('[data-panel="defaults"] form');
        const values = {};
        DEFAULT_SETTINGS.forEach((f) => { values[f.key] = readField(form, f); });
        const r = await M.saveSettings(values);
        if (r.error) return ctx.toast("Save failed: " + r.error, "error");
        ctx.toast("Defaults saved"); return paint();
      }
      if (act === "mc-hist-clear") {
        const ok = await ui.confirm({ title: "Clear change history", message: "Remove every entry from the master-configuration change history? The configuration itself is untouched.", okLabel: "Clear", danger: true });
        if (!ok) return;
        await M.clearHistory();
        ctx.toast("History cleared"); return paint();
      }
    };

    await paint();
  };

  M.showTab = function (sectionId) { nav.section = sectionId; };
})();
