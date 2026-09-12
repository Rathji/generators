/* ============================================================
   RMM-U — console station definitions  (Task 1)
   Registers every station the console navigates to. The 13
   visible stations are the RMM-U console's top-level
   destinations. Until a station's phase lands it renders the
   framework's shared empty/phase state; when it lands, its
   `render` delegates to a station controller on window.ERP.<id>
   (the same migration path the ERP modules used).

   Hidden modules carry framework / system documents only and
   never appear in the navigation.
   ============================================================ */

(function () {
  "use strict";

  const STATIONS = {
    dashboard: {
      id: "dashboard",
      label: "Dashboard",
      group: null,
      icon: "dashboard",
      roles: [],
      desc: "Fleet health at a glance",
      render: function (ctx) { return window.ERP.fleet.render(ctx); },
      empty: {
        icon: "dashboard",
        title: "Your fleet at a glance",
        message: "Live devices up / down / offline / stale, agent health and version spread, alert counts by severity and age, patch and security compliance, and job success rate — every tile drilling down to the affected devices.",
        phase: "Phase 10 · Task 40",
      },
    },

    devices: {
      id: "devices",
      label: "Devices",
      group: "endpoints",
      icon: "devices",
      roles: [],
      desc: "Every managed endpoint and its inventory",
      render: function (ctx) { return window.ERP.devices.render(ctx); },
      empty: {
        icon: "devices",
        title: "No devices enrolled yet",
        message: "The provider → site → device-group → device hierarchy and the rich device record (OS, hardware, disks, network, logged-in users, agent version and last-seen) live here — the anchor every other station attaches to.",
        phase: "Phase 1 · Task 3",
      },
    },

    groups: {
      id: "groups",
      label: "Groups",
      group: "endpoints",
      icon: "groups",
      roles: [],
      desc: "Static and rule-based device groups",
      render: function (ctx) { return window.ERP.groups.render(ctx); },
      empty: {
        icon: "groups",
        title: "No device groups yet",
        message: "Static groups and rule-based dynamic groups (by OS, tag, site, installed software or attribute). Tags are the primary way policies and automations are targeted.",
        phase: "Phase 4 · Task 18",
      },
    },

    policies: {
      id: "policies",
      label: "Policies",
      group: "endpoints",
      icon: "policies",
      roles: [],
      desc: "Monitoring, patch, software & automation policy",
      render: function (ctx) { return window.ERP.policies.render(ctx); },
      empty: {
        icon: "policies",
        title: "No policies defined",
        message: "A policy is a named collection of monitoring, patch, software and automation settings applied to one or more groups, with a defined inheritance order and an effective-policy preview per device.",
        phase: "Phase 4 · Task 19",
      },
    },

    monitors: {
      id: "monitors",
      label: "Monitors",
      group: "monitoring",
      icon: "monitors",
      roles: [],
      desc: "Threshold, service, event-log and network monitors",
      render: function (ctx) { return window.ERP.monitors.render(ctx); },
      empty: {
        icon: "monitors",
        title: "No monitors configured",
        message: "The monitor catalogue — up/down, CPU / memory / disk thresholds, service and process state, Windows event log, application / port / web checks, custom script monitors, SNMP and patch / AV / backup monitors — each with thresholds, a “for N minutes” duration and severity.",
        phase: "Phase 4 · Task 20",
      },
    },

    alerts: {
      id: "alerts",
      label: "Alerts",
      group: "monitoring",
      icon: "alerts",
      roles: [],
      desc: "Alert lifecycle, triage and escalation",
      render: function (ctx) { return window.ERP.alerts.render(ctx); },
      empty: {
        icon: "alerts",
        title: "No alerts",
        message: "The alert record and its lifecycle (fired → acknowledged → resolved / auto-cleared) with de-duplication, flapping suppression, snooze, escalation and a prioritized triage queue.",
        phase: "Phase 5 · Task 24",
      },
    },

    automations: {
      id: "automations",
      label: "Automations",
      group: "monitoring",
      icon: "automations",
      roles: [],
      desc: "Trigger → condition → action rules",
      render: function (ctx) { return window.ERP.automations.render(ctx); },
      empty: {
        icon: "automations",
        title: "No automations yet",
        message: "Trigger → condition → action rules (alert fired / cleared, monitor state change, device online / offline, schedule, manual or webhook) with dry-run preview, approval gating for destructive actions and a full run history.",
        phase: "Phase 4 · Task 22",
      },
    },

    patches: {
      id: "patches",
      label: "Patches",
      group: "deploy",
      icon: "patches",
      roles: [],
      desc: "Patch policy, scanning, deployment & compliance",
      render: function (ctx) { return window.ERP.patch.render(ctx); },
      empty: {
        icon: "patches",
        title: "No patch data yet",
        message: "Patch policy per OS and classification, agent-driven scanning, per-device compliance and aging of missing patches, deployment as agent jobs and an auditable compliance report per client.",
        phase: "Phase 6 · Task 28",
      },
    },

    software: {
      id: "software",
      label: "Software",
      group: "deploy",
      icon: "software",
      roles: [],
      desc: "Software catalog, deployment and licensing",
      render: function (ctx) { return window.ERP.software.render(ctx); },
      empty: {
        icon: "software",
        title: "No software catalog yet",
        message: "A catalog of deployable software with silent install / uninstall / update templates, per-OS variants and detection rules, assignment to devices or groups, and licence reconciliation per client.",
        phase: "Phase 7 · Task 31",
      },
    },

    security: {
      id: "security",
      label: "Security",
      group: "deploy",
      icon: "security",
      roles: [],
      desc: "Security posture, compliance baselines & backup verification",
      render: function (ctx) { return window.ERP.security.render(ctx); },
      empty: {
        icon: "security",
        title: "No security data yet",
        message: "Endpoint security posture (AV/EDR, firewall, disk encryption, OS patch currency, local admin changes), compliance baselines with drift detection and remediation, and backup-verification monitoring.",
        phase: "Phase 8 · Task 34",
      },
    },

    reports: {
      id: "reports",
      label: "Reports",
      group: "insight",
      icon: "reports",
      roles: [],
      desc: "Backup, versioning, client reports & data quality",
      render: function (ctx) { return window.ERP.continuity.render(ctx); },
      empty: {
        icon: "reports",
        title: "No reports yet",
        message: "Scheduled and on-demand reports per client — device health, patch and monitor compliance, alert summary and response times, asset inventory and backup status — plus the data-quality linter.",
        phase: "Phase 10 · Task 41",
      },
    },

    integrations: {
      id: "integrations",
      label: "Integrations",
      group: "insight",
      icon: "integrations",
      roles: [],
      desc: "psa-u, the documentation tool, APIs & webhooks",
      render: function (ctx) { return window.ERP.integrations.render(ctx); },
      empty: {
        icon: "integrations",
        title: "No integrations configured",
        message: "Two-way integration with psa-u (tickets) and the documentation tool (device configuration records) with explicit field ownership and drift detection, plus the shared event bus, outbound webhooks and the BI analytics extract.",
        phase: "Phase 10 · Task 42",
      },
    },

    admin: {
      id: "admin",
      label: "Admin",
      group: "system",
      icon: "admin",
      roles: [],
      desc: "Master configuration, tenants, roles & audit",
      render: function (ctx) { return window.ERP.masterConfig.render(ctx); },
      empty: {
        icon: "admin",
        title: "Master configuration",
        message: "Monitor types, severity levels, notification channels, schedules and business-hours calendars, maintenance windows, patch classifications, software categories, tag/group taxonomies and script categories — editable in one place with change history.",
        phase: "Phase 1 · Task 4",
      },
    },
  };

  /* ── hidden framework / system documents (never in nav) ──
     These carry the master-data documents the shared store,
     backup and master-config framework depend on. `providers` is
     the tenancy registry: one summary record per managed-service
     provider, while each provider's full aggregate lives in its own
     document (rmm-v1-provider-<id>). `versions` holds the bounded
     per-document version history (Task 5). The ERP master-config set
     is retained until Task 4 replaces it with the RMM master config. */
  const SYSTEM = {
    providers: { id: "providers", label: "Service providers", group: null, icon: "groups", roles: [], hidden: true, doc: { name: "providers", splitByYear: false } },
    parties: { id: "parties", label: "Parties", group: null, icon: "groups", roles: [], hidden: true, doc: { name: "parties", splitByYear: false } },
    catalog: { id: "catalog", label: "Catalog", group: null, icon: "software", roles: [], hidden: true, doc: { name: "catalog", splitByYear: false } },
    chart: { id: "chart", label: "Chart of accounts", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "chart", splitByYear: false } },
    taxes: { id: "taxes", label: "Tax rates", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "taxes", splitByYear: false } },
    defaults: { id: "defaults", label: "Posting defaults", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "defaults", splitByYear: false } },
    settings: { id: "settings", label: "Settings", group: null, icon: "admin", roles: [], hidden: true, doc: { name: "settings", splitByYear: false } },
    config: { id: "config", label: "Master configuration", group: null, icon: "admin", roles: [], hidden: true, doc: { name: "config", splitByYear: false } },
    enrollment: { id: "enrollment", label: "Enrollment & credentials", group: null, icon: "security", roles: [], hidden: true, doc: { name: "enrollment", splitByYear: false } },
    inventory: { id: "inventory", label: "Device inventory", group: null, icon: "devices", roles: [], hidden: true, doc: { name: "inventory", splitByYear: false } },
    metrics: { id: "metrics", label: "Performance metrics", group: null, icon: "monitors", roles: [], hidden: true, doc: { name: "metrics", splitByYear: false } },
    jobs: { id: "jobs", label: "Jobs & script execution", group: null, icon: "automations", roles: [], hidden: true, doc: { name: "jobs", splitByYear: false } },
    updates: { id: "updates", label: "Agent releases", group: null, icon: "patches", roles: [], hidden: true, doc: { name: "updates", splitByYear: false } },
    diagnostics: { id: "diagnostics", label: "Agent diagnostics", group: null, icon: "monitors", roles: [], hidden: true, doc: { name: "diagnostics", splitByYear: false } },
    dispatch: { id: "dispatch", label: "Job dispatch & correlation", group: null, icon: "automations", roles: [], hidden: true, doc: { name: "dispatch", splitByYear: false } },
    suppressions: { id: "suppressions", label: "Suppression log & deferrals", group: null, icon: "automations", roles: [], hidden: true, doc: { name: "suppressions", splitByYear: false } },
    notifications: { id: "notifications", label: "Notifications", group: null, icon: "integrations", roles: [], hidden: true, doc: { name: "notifications", splitByYear: false } },
    alertstate: { id: "alertstate", label: "Alert assessment state", group: null, icon: "alerts", roles: [], hidden: true, doc: { name: "alertstate", splitByYear: false } },
    routing: { id: "routing", label: "Notification routing", group: null, icon: "integrations", roles: [], hidden: true, doc: { name: "routing", splitByYear: false } },
    psa: { id: "psa", label: "psa-u ticket bridge", group: null, icon: "integrations", roles: [], hidden: true, doc: { name: "psa", splitByYear: false } },
    reportschedules: { id: "reportschedules", label: "Report schedules", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "reportschedules", splitByYear: false } },
    reportdeliveries: { id: "reportdeliveries", label: "Report deliveries", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "reportdeliveries", splitByYear: false } },
    patchscan: { id: "patchscan", label: "Patch scans & compliance", group: null, icon: "patches", roles: [], hidden: true, doc: { name: "patchscan", splitByYear: false } },
    versions: { id: "versions", label: "Version history", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "versions", splitByYear: false } },
    audit: { id: "audit", label: "Audit log", group: null, icon: "reports", roles: [], hidden: true, doc: { name: "audit", splitByYear: true } },
    archive: { id: "archive", label: "Archive", group: null, icon: "software", roles: [], hidden: true, doc: { name: "archive", splitByYear: true } },
  };

  Object.keys(STATIONS).forEach((id) => window.ERP.registerModule(STATIONS[id]));
  Object.keys(SYSTEM).forEach((id) => window.ERP.registerModule(SYSTEM[id]));
})();
