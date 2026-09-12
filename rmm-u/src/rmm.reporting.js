/* ============================================================
   RMM-U — reporting  (Phase 10 · Task 41)

   Per-client reports that can be run on demand or scheduled, in a
   stable export format.

   Six reports are defined against the real engines — never a
   second copy of the data:

     • Device health summary      (D / H — status, agent, last-seen)
     • Patch compliance           (PA.deviceRows)
     • Monitor compliance         (monitors × groups coverage + alerts)
     • Alert summary & response   (AL.list — MTTA / MTTR)
     • Asset inventory            (device record)
     • Backup status              (SEC.backupRows)
     • Security posture           (SEC.postureRows)

   A report is a plain object:

     { schema: "rmm.report", version: 1, reportId, title, generatedAt,
       providerId, providerName, columns:[{key,label}], rows:[…],
       summary:[{label,value}], totals:{rows} }

   Export is deterministic: JSON is the object verbatim; CSV is the
   columns in declared order. A **schedule** names one or more reports,
   a cadence and a delivery method (an in-app **link** and/or **email**
   through the notification pipeline). Every delivery is recorded with
   the report it carried, so "what did we send, and when" is auditable.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy || !ERP.devices) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const AL = ERP.alerts || null;
  const PA = ERP.patch || null;
  const SEC = ERP.security || null;
  const MON = ERP.monitors || null;
  const NOT = ERP.notify || null;
  const G = ERP.groups || null;

  const RP = (ERP.rmmReports = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const enabled = () => cfg("rmm.reportsEnabled", true) !== false;
  RP.MODULE = "reportschedules";
  RP.DELIVERY_MODULE = "reportdeliveries";
  RP.DELIVERY_CAP = () => Math.max(20, num(cfg("rmm.reportDeliveryHistory", 200), 200));

  async function loadSchedules() { const r = await store.loadDoc(RP.MODULE); return asArr(r.error ? [] : r.records); }
  async function saveSchedules(list) { return store.saveDoc(RP.MODULE, list); }
  async function loadDeliveries() { const r = await store.loadDoc(RP.DELIVERY_MODULE); return asArr(r.error ? [] : r.records); }
  async function saveDeliveries(list) { return store.saveDoc(RP.DELIVERY_MODULE, list.slice(-RP.DELIVERY_CAP())); }

  const providerOf = async (providerId) => { const g = await T.get(providerId); return g.error ? null : g.provider; };
  const actor = () => { try { return ERP.role || "owner"; } catch (e) { return "owner"; } };
  function siteName(provider, id) { const s = asArr(provider.sites).find((x) => String(x.id) === String(id)); return s ? (s.name || id) : ""; }
  function groupNames(provider, ids) { return asArr(ids).map((id) => { const gr = asArr(provider.deviceGroups).find((x) => String(x.id) === String(id)); return gr ? (gr.name || id) : id; }); }

  async function audit(action, providerId, summary, targetType) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: targetType || "report", targetId: providerId, summary }); } catch (e) {}
  }

  /* ═══════════════════════ report definitions ═══════════════════════ */

  RP.REPORTS = [
    { id: "device-health", label: "Device health summary", desc: "Every managed device: status, OS, agent version, last check-in and disk use." },
    { id: "patch-compliance", label: "Patch compliance", desc: "Per-device patch state against the applicable policy, with ageing and overdue counts." },
    { id: "monitor-compliance", label: "Monitor compliance", desc: "Which devices are covered by a monitor, and their current alert load." },
    { id: "alert-summary", label: "Alert summary & response times", desc: "Alert volume by severity/state plus mean time to acknowledge and resolve." },
    { id: "asset-inventory", label: "Asset inventory", desc: "Hardware, OS, network identity, purchase and warranty for every device." },
    { id: "backup-status", label: "Backup status", desc: "Last successful backup, expectation, age vs maximum and next due." },
    { id: "security-posture", label: "Security posture", desc: "Security score, state and failing baseline checks per device." },
  ];
  RP.REPORT_IDS = RP.REPORTS.map((r) => r.id);
  RP.report = (id) => RP.REPORTS.find((r) => r.id === id) || null;
  RP.reportLabel = (id) => (RP.report(id) || {}).label || id;

  const cols = (...pairs) => pairs.map((p) => ({ key: p[0], label: p[1] }));

  function base(providerId, provider, reportId, columns, rows, summary) {
    const meta = RP.report(reportId) || { label: reportId };
    return {
      schema: "rmm.report", version: 1, reportId, title: meta.label,
      generatedAt: now(), providerId, providerName: (provider && provider.name) || providerId,
      columns, rows: asArr(rows), summary: asArr(summary), totals: { rows: asArr(rows).length },
    };
  }

  const RUNNERS = {
    async "device-health"(providerId, provider) {
      const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
      const rows = devices.map((d) => ({
        hostname: d.hostname || d.displayName || d.id,
        site: siteName(provider, d.siteId) || "Unassigned",
        os: asObj(d.os).name || asObj(d.os).family || "",
        osFamily: asObj(d.os).family || "",
        role: d.role || "",
        status: D.effectiveStatus(d),
        agentVersion: String(asObj(d.agent).version || d.agentVersion || ""),
        lastSeenAt: d.lastSeenAt || "",
        diskUsedPct: D.diskUsedPct(d),
        ram: D.ramHuman(d) || "",
        groups: groupNames(provider, d.groupIds).join(", "),
      }));
      const byStatus = {};
      rows.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
      return base(providerId, provider, "device-health",
        cols(["hostname", "Device"], ["site", "Site"], ["os", "OS"], ["osFamily", "OS family"], ["role", "Role"], ["status", "Status"], ["agentVersion", "Agent"], ["lastSeenAt", "Last seen"], ["diskUsedPct", "Disk used %"], ["ram", "RAM"], ["groups", "Groups"]),
        rows,
        [
          { label: "Devices", value: rows.length },
          { label: "Online", value: byStatus.online || 0 },
          { label: "Offline", value: byStatus.offline || 0 },
          { label: "Stale", value: byStatus.stale || 0 },
        ]);
    },

    async "patch-compliance"(providerId, provider) {
      if (!PA) return base(providerId, provider, "patch-compliance", cols(["hostname", "Device"]), [], [{ label: "Patch engine", value: "unavailable" }]);
      const dr = await PA.deviceRows(providerId, {});
      const rows = asArr(dr.rows).filter((r) => r.status !== "archived").map((r) => ({
        hostname: r.hostname, site: r.siteName || "Unassigned", osFamily: r.osFamily || "",
        status: r.complianceStatus, missingRequired: num(r.missingRequired, 0), missingTotal: num(r.missingTotal, 0),
        overdue: num(r.overdue, 0), ageDays: num(r.ageDays, 0), withinGrace: !!r.withinGrace,
        policy: r.policyName || "", lastScanAt: r.lastScanAt || "",
      }));
      const s = asObj(dr.summary);
      return base(providerId, provider, "patch-compliance",
        cols(["hostname", "Device"], ["site", "Site"], ["osFamily", "OS family"], ["status", "Compliance"], ["missingRequired", "Required missing"], ["missingTotal", "Missing total"], ["overdue", "Overdue"], ["ageDays", "Age (days)"], ["withinGrace", "In grace"], ["policy", "Policy"], ["lastScanAt", "Last scan"]),
        rows,
        [
          { label: "Devices", value: num(s.devices, rows.length) },
          { label: "Compliant", value: num(s.compliant, 0) },
          { label: "Non-compliant", value: num(s.nonCompliant, 0) },
          { label: "Required missing", value: num(s.missingRequired, 0) },
          { label: "Overdue", value: num(s.overdue, 0) },
        ]);
    },

    async "monitor-compliance"(providerId, provider) {
      const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
      const monitors = MON ? MON.listOf(provider) : asArr(provider.monitorDefinitions);
      const activeByDevice = {};
      if (AL) {
        (await AL.active(providerId, {})).forEach((a) => { activeByDevice[String(a.deviceId)] = (activeByDevice[String(a.deviceId)] || 0) + 1; });
      }
      const rows = devices.map((d) => {
        const applying = monitors.filter((m) => (G && G.matchTargets ? G.matchTargets(provider, m.targets, d, { provider }).match : false));
        const enabledApplying = applying.filter((m) => m.enabled !== false);
        return {
          hostname: d.hostname || d.displayName || d.id, site: siteName(provider, d.siteId) || "Unassigned",
          osFamily: asObj(d.os).family || "", status: D.effectiveStatus(d),
          monitors: applying.length, enabledMonitors: enabledApplying.length,
          covered: enabledApplying.length > 0 ? "yes" : "no",
          activeAlerts: activeByDevice[String(d.id)] || 0,
        };
      });
      const covered = rows.filter((r) => r.covered === "yes").length;
      const withAlerts = rows.filter((r) => r.activeAlerts > 0).length;
      return base(providerId, provider, "monitor-compliance",
        cols(["hostname", "Device"], ["site", "Site"], ["osFamily", "OS family"], ["status", "Status"], ["monitors", "Monitors"], ["enabledMonitors", "Enabled"], ["covered", "Covered"], ["activeAlerts", "Active alerts"]),
        rows,
        [
          { label: "Devices", value: rows.length },
          { label: "Covered by a monitor", value: covered },
          { label: "Uncovered", value: rows.length - covered },
          { label: "With active alerts", value: withAlerts },
        ]);
    },

    async "alert-summary"(providerId, provider) {
      const list = AL ? await AL.list(providerId, {}) : asArr(provider.alerts);
      const rows = asArr(list).map((a) => {
        const t0 = Date.parse(a.firstFiredAt || a.at || a.createdAt);
        const tAck = Date.parse(a.acknowledgedAt || "");
        const tRes = Date.parse(a.resolvedAt || "");
        return {
          subject: a.subject || a.monitorName || "", device: a.hostname || a.deviceId || "", site: a.siteName || "",
          severity: a.severityLabel || a.severityId || "", state: a.state || "",
          firstFiredAt: a.firstFiredAt || a.at || "", acknowledgedAt: a.acknowledgedAt || "", resolvedAt: a.resolvedAt || "",
          mttaMinutes: isFinite(tAck) && isFinite(t0) ? Math.round((tAck - t0) / MIN) : "",
          mttrMinutes: isFinite(tRes) && isFinite(t0) ? Math.round((tRes - t0) / MIN) : "",
          occurrences: num(a.occurrences, 1), flapping: !!a.flapping,
        };
      });
      const mean = (key) => { const vals = rows.map((r) => r[key]).filter((v) => v !== "" && isFinite(v)); return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0; };
      const bySeverity = {};
      rows.forEach((r) => { if (AL && AL.ACTIVE.indexOf(r.state) !== -1) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1; });
      const active = rows.filter((r) => AL && AL.ACTIVE.indexOf(r.state) !== -1).length;
      return base(providerId, provider, "alert-summary",
        cols(["subject", "Alert"], ["device", "Device"], ["site", "Site"], ["severity", "Severity"], ["state", "State"], ["firstFiredAt", "First fired"], ["acknowledgedAt", "Acknowledged"], ["resolvedAt", "Resolved"], ["mttaMinutes", "MTTA (min)"], ["mttrMinutes", "MTTR (min)"], ["occurrences", "Occurrences"], ["flapping", "Flapping"]),
        rows,
        [
          { label: "Alerts", value: rows.length },
          { label: "Active", value: active },
          { label: "Mean time to acknowledge", value: mean("mttaMinutes") + " min" },
          { label: "Mean time to resolve", value: mean("mttrMinutes") + " min" },
          ...Object.keys(bySeverity).map((k) => ({ label: "Active · " + k, value: bySeverity[k] })),
        ]);
    },

    async "asset-inventory"(providerId, provider) {
      const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
      const rows = devices.map((d) => ({
        hostname: d.hostname || d.displayName || d.id, site: siteName(provider, d.siteId) || "Unassigned",
        manufacturer: d.manufacturer || "", model: d.model || "", serial: d.serial || "",
        os: asObj(d.os).name || "", osVersion: asObj(d.os).version || "", arch: asObj(d.os).arch || "",
        cpu: asObj(d.cpu).model || "", cores: num(asObj(d.cpu).cores, 0), ram: D.ramHuman(d) || "",
        disksBytes: D.totalDiskBytes(d), freeBytes: D.freeDiskBytes(d),
        ip: D.primaryIp(d), mac: D.primaryMac(d), domain: d.domain || "", role: d.role || "",
        purchaseDate: d.purchaseDate || "", warrantyExpiresAt: d.warrantyExpiresAt || "", supportExpiresAt: d.supportExpiresAt || "",
        tags: asArr(d.tags).join(", "),
      }));
      const totalRam = devices.reduce((a, d) => a + num(d.ramBytes, 0), 0);
      const totalDisk = devices.reduce((a, d) => a + D.totalDiskBytes(d), 0);
      return base(providerId, provider, "asset-inventory",
        cols(["hostname", "Device"], ["site", "Site"], ["manufacturer", "Make"], ["model", "Model"], ["serial", "Serial"], ["os", "OS"], ["osVersion", "OS version"], ["arch", "Arch"], ["cpu", "CPU"], ["cores", "Cores"], ["ram", "RAM"], ["disksBytes", "Disk bytes"], ["freeBytes", "Free bytes"], ["ip", "IP"], ["mac", "MAC"], ["domain", "Domain"], ["role", "Role"], ["purchaseDate", "Purchased"], ["warrantyExpiresAt", "Warranty ends"], ["supportExpiresAt", "Support ends"], ["tags", "Tags"]),
        rows,
        [
          { label: "Assets", value: rows.length },
          { label: "Total RAM", value: D.bytesHuman(totalRam) },
          { label: "Total disk", value: D.bytesHuman(totalDisk) },
        ]);
    },

    async "backup-status"(providerId, provider) {
      if (!SEC) return base(providerId, provider, "backup-status", cols(["hostname", "Device"]), [], [{ label: "Backup monitor", value: "unavailable" }]);
      const backs = await SEC.backupRows(providerId, {});
      const rows = asArr(backs.rows).map((r) => ({
        hostname: r.hostname, site: r.siteName || "", expectation: r.expectationName || (r.expected ? "" : "not configured"),
        product: SEC.productLabel ? SEC.productLabel(r.productId) : r.productId || "",
        status: r.status || "", lastSuccessAt: r.lastSuccessAt || "",
        ageHours: r.ageHours == null ? "" : Math.round(num(r.ageHours, 0)), maxAgeHours: num(r.maxAgeHours, 0),
        dueAt: r.dueAt || "",
      }));
      const s = asObj(backs.summary);
      return base(providerId, provider, "backup-status",
        cols(["hostname", "Device"], ["site", "Site"], ["expectation", "Expectation"], ["product", "Product"], ["status", "Status"], ["lastSuccessAt", "Last success"], ["ageHours", "Age (h)"], ["maxAgeHours", "Max (h)"], ["dueAt", "Next due"]),
        rows,
        [
          { label: "Devices", value: num(s.devices, rows.length) },
          { label: "OK", value: num(s.ok, 0) },
          { label: "Failed", value: num(s.failed, 0) },
          { label: "Missed", value: num(s.missed, 0) },
          { label: "Never backed up", value: num(s.never, 0) },
        ]);
    },

    async "security-posture"(providerId, provider) {
      if (!SEC) return base(providerId, provider, "security-posture", cols(["hostname", "Device"]), [], [{ label: "Security engine", value: "unavailable" }]);
      const pr = await SEC.postureRows(providerId, {});
      const rows = asArr(pr.rows).map((r) => ({
        hostname: r.hostname, site: r.siteName || "", osFamily: r.osFamily || "", state: r.state || "",
        score: r.score == null ? "" : r.score,
        failing: asArr(r.failing).map((f) => f.label || f.checkId).join("; "),
        warn: asArr(r.warning).map((f) => f.label || f.checkId).join("; "),
        lastScanAt: r.at || "",
      }));
      const s = asObj(pr.summary);
      return base(providerId, provider, "security-posture",
        cols(["hostname", "Device"], ["site", "Site"], ["osFamily", "OS family"], ["state", "Posture"], ["score", "Score"], ["failing", "Failing checks"], ["warn", "Warnings"], ["lastScanAt", "Last scan"]),
        rows,
        [
          { label: "Devices", value: num(s.devices, rows.length) },
          { label: "Passing", value: num(s.pass, 0) },
          { label: "Failing", value: num(s.fail, 0) },
          { label: "Failing checks", value: num(s.failChecks, 0) },
        ]);
    },
  };

  RP.run = async function (providerId, reportId, opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { error: "reports_disabled" };
    if (!RP.report(reportId)) return { error: "unknown_report", reportId };
    const provider = opts.provider || await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const run = RUNNERS[reportId];
    if (!run) return { error: "no_runner", reportId };
    return run(providerId, provider, opts);
  };

  RP.summaryText = function (report) {
    return asArr(asObj(report).summary).map((s) => s.label + ": " + s.value).join(" · ");
  };

  /* ─────────────────────── stable export (Task 41) ─────────────────── */

  function csvCell(v) {
    if (v == null) return "";
    const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  RP.toCsv = function (report) {
    report = asObj(report);
    const columns = asArr(report.columns);
    const head = columns.map((c) => csvCell(c.label || c.key)).join(",");
    const body = asArr(report.rows).map((r) => columns.map((c) => csvCell(r[c.key])).join(",")).join("\n");
    return head + (body ? "\n" + body : "") + "\n";
  };

  RP.toJson = function (report) { return JSON.stringify(report, null, 2); };

  RP.export = function (report, format) {
    return String(format || "json").toLowerCase() === "csv" ? RP.toCsv(report) : RP.toJson(report);
  };

  RP.download = function (filename, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      return { ok: true };
    } catch (e) { return { error: "download_failed", message: String((e && e.message) || e) }; }
  };

  function slug(s) { return String(s || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report"; }
  RP.slug = slug;

  /* ─────────────────────── schedules (Task 41) ─────────────────────── */

  RP.FREQUENCIES = ["daily", "weekly", "monthly"];
  RP.normalizeSchedule = function (raw) {
    raw = asObj(raw);
    return {
      kind: "report-schedule",
      id: raw.id || rid("rsched"),
      providerId: String(raw.providerId || ""),
      name: S(raw.name || "Untitled schedule", 160),
      reportIds: asArr(raw.reportIds).map(String).filter((id) => !!RP.report(id)),
      frequency: RP.FREQUENCIES.indexOf(raw.frequency) !== -1 ? raw.frequency : "weekly",
      timeOfDay: /^\d{2}:\d{2}$/.test(String(raw.timeOfDay)) ? String(raw.timeOfDay) : "07:00",
      daysOfWeek: asArr(raw.daysOfWeek).map((d) => low(d)).filter(Boolean),
      dayOfMonth: Math.min(28, Math.max(1, num(raw.dayOfMonth, 1))),
      recipients: asArr(raw.recipients).map((r) => S(r, 200)).filter(Boolean),
      channelId: raw.channelId ? String(raw.channelId) : null,
      delivery: ["link", "email", "both"].indexOf(raw.delivery) !== -1 ? raw.delivery : "link",
      enabled: raw.enabled !== false,
      lastRunAt: raw.lastRunAt || "",
      nextRunAt: raw.nextRunAt || "",
      createdAt: raw.createdAt || now(), updatedAt: now(),
    };
  };

  const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  /* Next occurrence of a schedule strictly after `fromMs` (UTC clock). */
  RP.nextRun = function (schedule, fromMs) {
    const s = RP.normalizeSchedule(schedule);
    const from = new Date(fromMs == null ? Date.now() : fromMs);
    const [hh, mm] = s.timeOfDay.split(":").map((x) => parseInt(x, 10) || 0);
    const at = (d) => { const x = new Date(d); x.setUTCHours(hh, mm, 0, 0); return x; };
    if (s.frequency === "daily") {
      let d = at(from);
      if (d.getTime() <= from.getTime()) d = at(new Date(from.getTime() + DAY));
      return d.toISOString();
    }
    if (s.frequency === "weekly") {
      const days = s.daysOfWeek.length ? s.daysOfWeek : ["mon"];
      for (let i = 0; i < 14; i++) {
        const d = at(new Date(from.getTime() + i * DAY));
        if (days.indexOf(WEEKDAYS[d.getUTCDay()]) !== -1 && d.getTime() > from.getTime()) return d.toISOString();
      }
    }
    if (s.frequency === "monthly") {
      for (let i = 0; i < 62; i++) {
        const d = at(new Date(from.getTime() + i * DAY));
        if (d.getUTCDate() === s.dayOfMonth && d.getTime() > from.getTime()) return d.toISOString();
      }
    }
    return at(new Date(from.getTime() + DAY)).toISOString();
  };

  RP.addSchedule = async function (providerId, data) {
    const rec = RP.normalizeSchedule(Object.assign({}, data, { providerId }));
    if (!rec.name) return { error: "name_required" };
    if (!rec.reportIds.length) return { error: "no_reports" };
    rec.nextRunAt = RP.nextRun(rec);
    const list = await loadSchedules();
    list.push(rec);
    const w = await saveSchedules(list);
    if (w && w.error) return { error: w.error, message: w.message };
    await audit("report_schedule_add", providerId, "Created report schedule \"" + rec.name + "\".");
    return { ok: true, schedule: clone(rec) };
  };

  RP.updateSchedule = async function (providerId, id, patch) {
    const list = await loadSchedules();
    const i = list.findIndex((s) => String(s.id) === String(id));
    if (i === -1) return { error: "not_found", id };
    const merged = RP.normalizeSchedule(Object.assign({}, list[i], asObj(patch), { id: list[i].id, providerId: list[i].providerId, createdAt: list[i].createdAt }));
    if (patch && patch.nextRunAt === undefined) merged.nextRunAt = RP.nextRun(merged, Date.parse(list[i].lastRunAt || "") || undefined);
    list[i] = merged;
    const w = await saveSchedules(list);
    if (w && w.error) return { error: w.error, message: w.message };
    await audit("report_schedule_update", providerId, "Updated report schedule \"" + merged.name + "\".");
    return { ok: true, schedule: clone(merged) };
  };

  RP.removeSchedule = async function (providerId, id) {
    const list = await loadSchedules();
    const next = list.filter((s) => String(s.id) !== String(id));
    if (next.length === list.length) return { error: "not_found", id };
    const w = await saveSchedules(next);
    if (w && w.error) return { error: w.error, message: w.message };
    await audit("report_schedule_remove", providerId, "Deleted a report schedule.");
    return { ok: true, removed: id };
  };

  RP.listSchedules = async function (providerId, opts) {
    opts = opts || {};
    let list = (await loadSchedules()).filter((s) => !providerId || String(s.providerId) === String(providerId));
    if (!opts.includeDisabled) list = list.filter((s) => s.enabled !== false);
    list.sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)));
    return clone(list);
  };

  RP.getSchedule = async function (id) {
    const rec = (await loadSchedules()).find((s) => String(s.id) === String(id));
    return rec ? clone(rec) : null;
  };

  RP.dueSchedules = async function (providerId, at) {
    const when = at ? Date.parse(at) : Date.now();
    const list = await RP.listSchedules(providerId, {});
    return list.filter((s) => s.nextRunAt && Date.parse(s.nextRunAt) <= when);
  };

  RP.runSchedule = async function (providerId, scheduleId, opts) {
    opts = opts || {};
    const sched = await RP.getSchedule(scheduleId);
    if (!sched) return { error: "not_found", scheduleId };
    const reports = [];
    for (const reportId of sched.reportIds) {
      const rep = await RP.run(providerId, reportId, opts);
      if (!rep || rep.error) { reports.push({ reportId, error: (rep && rep.error) || "run_failed" }); continue; }
      reports.push(rep);
    }
    const ok = reports.filter((r) => !r.error);
    const delivery = await RP.deliver(providerId, sched, ok, opts);
    await RP.updateSchedule(providerId, scheduleId, { lastRunAt: now(), nextRunAt: RP.nextRun(sched) });
    await audit("report_schedule_run", providerId, "Ran report schedule \"" + sched.name + "\" (" + ok.length + " report(s)).");
    return { ok: !delivery.error, scheduleId, reports: ok.length, failed: reports.length - ok.length, delivery: delivery.delivery || null, error: delivery.error };
  };

  RP.runDue = async function (providerId, opts) {
    const due = await RP.dueSchedules(providerId, opts && opts.at);
    const out = [];
    for (const s of due) out.push(await RP.runSchedule(providerId, s.id, opts));
    return { ok: true, ran: out.length, results: out };
  };

  /* ─────────────────────── delivery (Task 41) ─────────────────────── */

  RP.linkFor = function (deliveryId) {
    const name = (window.generatorName || "rmm-u");
    return "https://perchance.org/" + name + "#/reports:reports" + (deliveryId ? "?delivery=" + encodeURIComponent(deliveryId) : "");
  };

  RP.deliver = async function (providerId, schedule, reports, opts) {
    opts = opts || {};
    const list = asArr(reports);
    const link = RP.linkFor();
    const compact = list.map((r) => ({ reportId: r.reportId, title: r.title, rows: r.totals ? r.totals.rows : asArr(r.rows).length, summary: clone(r.summary) }));
    const method = (schedule && schedule.delivery) || "link";
    const recipients = asArr(schedule && schedule.recipients);
    const rec = {
      kind: "report-delivery", id: rid("rdel"), providerId: String(providerId),
      scheduleId: schedule ? schedule.id : null, scheduleName: schedule ? schedule.name : "On-demand",
      reportIds: list.map((r) => r.reportId), reports: compact,
      method, recipients, at: now(), by: actor(), status: "prepared", link, channelId: schedule ? schedule.channelId : null, error: "",
    };
    if ((method === "link" || method === "both") && list.length) rec.status = "linked";
    if (method === "email" || method === "both") {
      if (!NOT) { rec.status = list.length ? rec.status : "failed"; rec.error = "notifications_unavailable"; }
      else {
        const subject = "RMM report: " + (schedule ? schedule.name : "on-demand") + " · " + (list[0] ? list[0].providerName : providerId);
        const body = list.map((r) => r.title + "\n" + RP.summaryText(r)).join("\n\n") + "\n\nOpen: " + link;
        const send = await NOT.send({ providerId, channelId: opts.channelId || (schedule && schedule.channelId) || "ch-email", severityId: "sev-info", subject, message: body, force: true, meta: { reportIds: rec.reportIds, link } });
        if (send && send.error) { rec.status = rec.status === "linked" ? "linked" : "failed"; rec.error = send.error; }
        else { rec.status = "sent"; if (send && send.notification) rec.notificationId = send.notification.id; }
      }
    }
    if (!list.length) { rec.status = "failed"; rec.error = "no_reports"; }
    const rows = await loadDeliveries();
    rows.push(rec);
    const w = await saveDeliveries(rows);
    if (w && w.error) return { error: w.error, delivery: rec };
    return { ok: rec.status !== "failed", delivery: clone(rec) };
  };

  RP.deliverReport = async function (providerId, reportId, opts) {
    opts = opts || {};
    const rep = await RP.run(providerId, reportId, opts);
    if (rep.error) return rep;
    const sched = { id: null, name: rep.title + " (on-demand)", delivery: opts.delivery || "link", recipients: asArr(opts.recipients), channelId: opts.channelId };
    return RP.deliver(providerId, sched, [rep], opts);
  };

  RP.listDeliveries = async function (providerId, opts) {
    opts = opts || {};
    let list = (await loadDeliveries()).filter((d) => !providerId || String(d.providerId) === String(providerId));
    list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (opts.limit) list = list.slice(0, opts.limit);
    return clone(list);
  };
  RP.getDelivery = async function (id) {
    const rec = (await loadDeliveries()).find((d) => String(d.id) === String(id));
    return rec ? clone(rec) : null;
  };

  /* ═══════════════════════ console (Task 41) ═══════════════════════ */

  function bindPanel(el, handler) {
    if (!el) return;
    el.onclick = (e) => {
      const a = e.target.closest && e.target.closest("[data-act]");
      if (!a || !el.contains(a)) return;
      e.preventDefault();
      handler(a.getAttribute("data-act"), a.getAttribute("data-arg"), a, e);
    };
  }

  /* Prepend a provider picker when the console is scoped to one client. */
  function withPicker(panel, opts, rerender) {
    if (asArr(opts.providers).length <= 1) return;
    const ui = ERP.ui, esc = ui.esc;
    panel.insertAdjacentHTML("afterbegin",
      '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select data-rp-pid>' +
      asArr(opts.providers).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === opts.providerId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") +
      "</select></div></div>");
    const sel = panel.querySelector("[data-rp-pid]");
    if (sel) sel.onchange = () => { opts.providerId = sel.value; if (opts.onProvider) opts.onProvider(sel.value); rerender(); };
  }

  RP.renderLibrary = async function (panel, opts) {
    if (!panel) return;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || (() => {});
    const rowProviders = asArr(opts.providers);
    const scheds = await RP.listSchedules(opts.providerId, { includeDisabled: true });
    const rows = RP.REPORTS.map((def) => ({
      id: def.id,
      name: "<b>" + esc(def.label) + "</b><div class=\"erp-sub\">" + esc(def.desc) + "</div>",
      actions: ui.btn("Run", { small: true, primary: true, act: "rp-run", arg: def.id }) + " " +
        ui.btn("CSV", { small: true, act: "rp-export", arg: def.id + "|csv" }) + " " +
        ui.btn("JSON", { small: true, act: "rp-export", arg: def.id + "|json" }) + " " +
        ui.btn("Deliver", { small: true, act: "rp-deliver", arg: def.id }),
    }));
    panel.innerHTML = ui.card("Report library (" + rows.length + ")",
      '<p class="erp-sub">Run a report for the selected client, export it in a stable format, or deliver it now.</p>' +
      ui.table([
        { key: "name", label: "Report", render: (r) => r.name },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true }),
      { actions: ui.btn("Run all", { small: true, act: "rp-run-all" }) }) +
      ui.card("Scheduled reports (" + scheds.length + ")",
        ui.alert("Schedules are managed on the Report schedules tab.", "info"));
    withPicker(panel, opts, () => RP.renderLibrary(panel, opts));

    async function output(defId, format) {
      const rep = await RP.run(opts.providerId, defId, {});
      if (rep.error) return toast("Failed: " + rep.error, "error");
      const text = RP.export(rep, format);
      const fname = slug((rep.providerName || "client") + "-" + rep.reportId) + "." + (format === "csv" ? "csv" : "json");
      RP.download(fname, text, format === "csv" ? "text/csv" : "application/json");
      toast(rep.title + " exported (" + rep.totals.rows + " row(s))");
      return rep;
    }

    bindPanel(panel, async (act, arg) => {
      if (act === "rp-run") { const rep = await RP.run(opts.providerId, arg, {}); if (rep.error) return toast("Failed: " + rep.error, "error"); toast(rep.title + " · " + RP.summaryText(rep)); return; }
      if (act === "rp-run-all") { const out = []; for (const d of RP.REPORTS) { const r = await RP.run(opts.providerId, d.id, {}); if (!r.error) out.push(r.title); } toast(out.length + " report(s) run"); return; }
      if (act === "rp-export") { const [id, fmt] = String(arg).split("|"); return output(id, fmt); }
      if (act === "rp-deliver") { const r = await RP.deliverReport(opts.providerId, arg, {}); if (r.error) return toast("Failed: " + r.error, "error"); toast("Report delivered (link prepared)"); return; }
    });
  };

  RP.renderSchedules = async function (panel, opts) {
    if (!panel) return;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || (() => {});
    const list = await RP.listSchedules(opts.providerId, { includeDisabled: true });
    const rows = list.map((s) => ({
      id: s.id,
      name: "<b>" + esc(s.name) + "</b>" + (s.enabled ? "" : " " + ui.badge("disabled", "muted")),
      reports: asArr(s.reportIds).map((id) => ui.badge(RP.reportLabel(id), "muted")).join(" ") || '<span class="erp-sub">—</span>',
      cadence: esc(s.frequency) + " · " + esc(s.timeOfDay) + (s.frequency === "weekly" && asArr(s.daysOfWeek).length ? " · " + esc(asArr(s.daysOfWeek).join(",")) : ""),
      delivery: ui.badge(s.delivery, "info") + (asArr(s.recipients).length ? ' <span class="erp-sub">' + esc(asArr(s.recipients).join(", ")) + "</span>" : ""),
      next: esc(s.nextRunAt ? ui.dateTime(s.nextRunAt) : "—"),
      last: esc(s.lastRunAt ? ui.dateTime(s.lastRunAt) : "never"),
      actions: ui.btn("Run now", { small: true, primary: true, act: "rp-sched-run", arg: s.id }) + " " +
        ui.btn("Edit", { small: true, act: "rp-sched-edit", arg: s.id }) + " " +
        ui.btn(s.enabled ? "Disable" : "Enable", { small: true, act: "rp-sched-toggle", arg: s.id }) + " " +
        ui.btn("Delete", { small: true, danger: true, act: "rp-sched-del", arg: s.id }),
    }));
    panel.innerHTML = ui.card("Report schedules (" + rows.length + ")",
      '<p class="erp-sub">A schedule runs its reports and delivers them by link and/or email. Next runs are computed on the UTC clock.</p>' +
      ui.table([
        { key: "name", label: "Schedule", render: (r) => r.name },
        { key: "reports", label: "Reports", render: (r) => r.reports },
        { key: "cadence", label: "Cadence", render: (r) => r.cadence },
        { key: "delivery", label: "Delivery", render: (r) => r.delivery },
        { key: "next", label: "Next run", render: (r) => r.next },
        { key: "last", label: "Last run", render: (r) => r.last },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No scheduled reports yet." }),
      { actions: ui.btn("New schedule", { small: true, primary: true, act: "rp-sched-new" }) });
    withPicker(panel, opts, () => RP.renderSchedules(panel, opts));

    function openEditor(id) {
      const isNew = id === "__new";
      const s = isNew ? RP.normalizeSchedule({ name: "", reportIds: [RP.REPORTS[0].id] }) : list.find((x) => String(x.id) === String(id));
      if (!s) return;
      const checks = RP.REPORTS.map((d) => '<label class="erp-check"><input type="checkbox" name="s_rep_' + esc(d.id) + '"' + (asArr(s.reportIds).indexOf(d.id) !== -1 ? " checked" : "") + "> " + esc(d.label) + "</label>").join("");
      const body = ui.form(
        ui.text("s_name", "Name", s.name) +
        '<div class="rmm-patch-grid">' +
        ui.select("s_frequency", "Frequency", RP.FREQUENCIES.map((f) => ({ value: f, label: f })), s.frequency) +
        ui.text("s_time", "Time of day (UTC HH:MM)", s.timeOfDay) +
        ui.text("s_days", "Weekdays (comma-separated: mon,tue…)", asArr(s.daysOfWeek).join(",")) +
        ui.number("s_dom", "Day of month (monthly)", s.dayOfMonth) +
        ui.select("s_delivery", "Delivery", [{ value: "link", label: "Link" }, { value: "email", label: "Email" }, { value: "both", label: "Link + email" }], s.delivery) +
        ui.select("s_channel", "Email channel", [{ value: "", label: "— default —" }].concat(asArr(opts.channels).map((c) => ({ value: c.id, label: c.label || c.id }))), s.channelId || "") +
        ui.text("s_recipients", "Recipients (comma-separated)", asArr(s.recipients).join(", ")) +
        "</div>" +
        '<div class="field"><label>Reports</label><div class="rmm-check-list">' + checks + "</div></div>" +
        ui.check("s_enabled", "Enabled", s.enabled !== false),
        ui.btn("Save", { primary: true, act: "rp-sched-save", arg: isNew ? "__new" : s.id }) + " " + ui.btn("Cancel", { act: "rp-cancel" })
      );
      ui.modal({ title: isNew ? "New report schedule" : "Edit " + s.name, size: "lg", body });
      const m = document.querySelector("#uiModal");
      m.onclick = async (e) => {
        const a = e.target.closest && e.target.closest("[data-act]");
        if (!a) return;
        const act = a.getAttribute("data-act");
        if (act === "rp-cancel") { m.onclick = null; return ui.closeModal(); }
        if (act === "rp-sched-save") {
          const c = ui.collect(m, ["s_name", "s_frequency", "s_time", "s_days", "s_dom", "s_delivery", "s_channel", "s_recipients", "s_enabled"]);
          const reportIds = RP.REPORT_IDS.filter((rid2) => { const el = m.querySelector('[name="s_rep_' + rid2 + '"]'); return el && el.checked; });
          const patch = {
            name: c.s_name, frequency: c.s_frequency, timeOfDay: c.s_time,
            daysOfWeek: String(c.s_days || "").split(",").map((x) => x.trim()).filter(Boolean),
            dayOfMonth: c.s_dom, delivery: c.s_delivery, channelId: c.s_channel || null,
            recipients: String(c.s_recipients || "").split(",").map((x) => x.trim()).filter(Boolean),
            reportIds, enabled: c.s_enabled,
          };
          const r = isNew ? await RP.addSchedule(opts.providerId, patch) : await RP.updateSchedule(opts.providerId, id, patch);
          if (r.error) return toast("Failed: " + (r.errors ? r.errors.join("; ") : r.error), "error");
          m.onclick = null; ui.closeModal(); toast("Schedule saved");
          return paint();
        }
      };
    }

    async function paint() { return RP.renderSchedules(panel, opts); }

    bindPanel(panel, async (act, arg) => {
      if (act === "rp-sched-new") return openEditor("__new");
      if (act === "rp-sched-edit") return openEditor(arg);
      if (act === "rp-sched-run") { const r = await RP.runSchedule(opts.providerId, arg, { channelId: null }); if (r.error) return toast("Failed: " + (r.error), "error"); toast("Schedule ran — " + r.reports + " report(s) delivered"); return paint(); }
      if (act === "rp-sched-toggle") { const s = await RP.getSchedule(arg); const r = await RP.updateSchedule(opts.providerId, arg, { enabled: !(s && s.enabled) }); if (r.error) return toast("Failed: " + r.error, "error"); return paint(); }
      if (act === "rp-sched-del") { const ok = await ERP.ui.confirm({ title: "Delete schedule?", message: "Reports already delivered are unaffected.", okLabel: "Delete", danger: true }); if (!ok) return; const r = await RP.removeSchedule(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Deleted"); return paint(); }
      if (act === "rp-cancel") return ui.closeModal();
    });
  };

  RP.renderDeliveries = async function (panel, opts) {
    if (!panel) return;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || (() => {});
    const list = await RP.listDeliveries(opts.providerId, { limit: 100 });
    const rows = list.map((d) => ({
      id: d.id,
      at: esc(ui.dateTime(d.at)),
      source: esc(d.scheduleName || "On-demand") + '<div class="erp-sub">' + esc(asArr(d.reports).map((r) => r.title).join(", ")) + "</div>",
      method: ui.badge(d.method, "info"),
      status: ui.badge(d.status, d.status === "failed" ? "danger" : d.status === "sent" ? "success" : "muted"),
      recipients: esc(asArr(d.recipients).join(", ") || "—"),
      actions: (d.link ? ui.btn("Open link", { small: true, act: "rp-link", arg: d.id }) : "") + " " +
        ui.btn("Copy link", { small: true, act: "rp-copy", arg: d.id }) + " " +
        ui.btn("View", { small: true, act: "rp-view", arg: d.id }),
    }));
    panel.innerHTML = ui.card("Deliveries (" + rows.length + ")",
      '<p class="erp-sub">Every scheduled or on-demand delivery is recorded with the reports it carried.</p>' +
      ui.table([
        { key: "at", label: "When", render: (r) => r.at },
        { key: "source", label: "Source", render: (r) => r.source },
        { key: "method", label: "Method", render: (r) => r.method },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "recipients", label: "Recipients", render: (r) => r.recipients },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No reports delivered yet." }),
      { actions: ui.btn("Run due schedules", { small: true, primary: true, act: "rp-run-due" }) });
    withPicker(panel, opts, () => RP.renderDeliveries(panel, opts));

    bindPanel(panel, async (act, arg) => {
      if (act === "rp-run-due") { const r = await RP.runDue(opts.providerId, {}); toast("Ran " + r.ran + " due schedule(s)"); return RP.renderDeliveries(panel, opts); }
      if (act === "rp-copy") { const d = await RP.getDelivery(arg); if (d && d.link) { try { await navigator.clipboard.writeText(d.link); toast("Link copied"); } catch (e) { toast("Copy failed", "error"); } } return; }
      if (act === "rp-link") { const d = await RP.getDelivery(arg); if (d && d.link) window.open(d.link, "_blank"); return; }
      if (act === "rp-view") { const d = await RP.getDelivery(arg); if (!d) return; ui.modal({ title: "Delivery · " + d.scheduleName, size: "lg", body: '<p class="erp-modal-note">' + esc(ui.dateTime(d.at)) + " · " + esc(d.method) + " · " + esc(d.status) + "</p>" + asArr(d.reports).map((r) => "<h5 class=\"rmm-section-title\">" + esc(r.title) + "</h5>" + ui.table([{ key: "label", label: "Metric", render: (x) => esc(x.label) }, { key: "value", label: "Value", render: (x) => esc(String(x.value)) }], asArr(r.summary), { emptyText: "No summary." })).join(""), foot: ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }) }); return; }
    });
  };

  RP.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui;
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-reports";
    host.appendChild(wrap);
    if (!providers.length) { wrap.innerHTML = ui.alert("No service providers yet.", "info"); return null; }
    const providerId = opts.providerId || providers[0].id;
    const state = { tab: opts.tab || "library" };
    const tabs = ui.tabs([
      { id: "library", label: "Report library" },
      { id: "schedules", label: "Report schedules" },
      { id: "deliveries", label: "Deliveries" },
    ], state.tab);
    wrap.innerHTML = '<div class="rmm-reports-inner">' + tabs.html + "</div>";
    const panelOf = (id) => wrap.querySelector('.erp-tab-panel[data-panel="' + id + '"]');
    async function renderTab(id) {
      state.tab = id;
      ui.showTab(wrap, id);
      const p = panelOf(id);
      if (!p) return;
      if (id === "schedules") return RP.renderSchedules(p, Object.assign({}, opts, { providerId }));
      if (id === "deliveries") return RP.renderDeliveries(p, Object.assign({}, opts, { providerId }));
      return RP.renderLibrary(p, Object.assign({}, opts, { providerId }));
    }
    wrap.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-tab]");
      if (t && wrap.contains(t)) renderTab(t.getAttribute("data-tab"));
    });
    await renderTab(state.tab);
    return { state, renderTab, host: wrap };
  };

  /* ─────────────────────── boot ─────────────────────── */

  RP.currentProviderId = null;
  let readyResolve;
  RP.ready = new Promise((res) => { readyResolve = res; });
  RP.init = function () { readyResolve(); return RP; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", RP.init);
  else RP.init();
})();
