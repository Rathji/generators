/* ============================================================
   RMM-U — agent diagnostics & support  (Phase 2 · Task 13)

   When an endpoint stops reporting, the console needs to answer three
   questions without a truck roll: is the agent running, can it reach the
   collector, and what does it say? This module is the console side of
   that story.

     • Rotating local log — the generated agent writes a timestamped log
       and rotates it at a bounded size, keeping N generations, so a
       device never fills its own disk with diagnostics.
     • Self-test — the agent can run a structured check (collector
       reachability, TLS/identity, enrollment, authentication, clock skew,
       spool depth, disk space, service registration, config validity) and
       report a pass/fail per check.
     • Pull logs / run a self-test — a console action sets a request on the
       device; the agent picks it up on its next check-in, reads its own
       log tail (or runs the self-test), and posts the result back
       authenticated. Results are stored in a bounded per-device ring.
     • Troubleshooting — a documented, in-console playbook for the classic
       "installed agent cannot reach the collector" failure modes.

   Reports live in the hidden `diagnostics` document (rmm-v1-diagnostics):
     { kind:"logs",     id, providerId, deviceId, requestId, requestedAt,
       receivedAt, lines, text, bytes, truncated }
     { kind:"selftest", id, providerId, deviceId, requestId, receivedAt,
       ok, agentVersion, checks:[{name, ok, detail}], context{} }

   window.ERP.diagnostics is the service (aliased DIAG).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const DIAG = (ERP.diagnostics = {});

  DIAG.MODULE = "diagnostics";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  DIAG.requestLines = () => Math.max(20, num(cfg("rmm.diagnosticRequestLines", 400), 400));
  DIAG.logMaxBytes = () => Math.max(4096, num(cfg("rmm.diagnosticLogMaxBytes", 262144), 262144));
  DIAG.logKeep = () => Math.max(1, num(cfg("rmm.diagnosticLogKeep", 10), 10));
  DIAG.selfTestKeep = () => Math.max(1, num(cfg("rmm.diagnosticSelfTestKeep", 20), 20));

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  DIAG.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "device", targetId, summary }); } catch (e) {}
  }
  function actorName() {
    try { if (ERP.team && ERP.team.me) { const me = ERP.team.me(); if (me && me.displayName) return String(me.displayName); } } catch (e) {}
    return ERP.role || "owner";
  }

  /* ─────────────────────── persistence ─────────────────────── */

  async function load() {
    const r = await ERP.store.loadDoc(DIAG.MODULE);
    return asArr(r.error ? [] : r.records);
  }
  async function save(list) { return ERP.store.saveDoc(DIAG.MODULE, list); }
  DIAG.load = load;

  /* ─────────────────────── self-test contract ─────────────────────── */

  /* The checks an agent self-test reports, in order. Both the generated
     agent and this console render from the same list so a new check is a
     data change in one place. */
  DIAG.SELF_TEST_CHECKS = [
    { id: "config", label: "Configuration", desc: "The embedded config parses and has a collector address + device record." },
    { id: "reachable", label: "Collector reachable", desc: "The collector address answers a request." },
    { id: "tls", label: "Collector identity", desc: "TLS is valid (or explicitly downgraded), and the pin matches when configured." },
    { id: "enrolled", label: "Enrolled", desc: "The endpoint holds a device id and a credential." },
    { id: "authenticated", label: "Authenticated", desc: "The stored credential is accepted by the collector." },
    { id: "clock", label: "Clock", desc: "The endpoint clock is within tolerance of the collector's." },
    { id: "service", label: "Service", desc: "The boot service / scheduled task / timer is registered." },
    { id: "spool", label: "Offline buffer", desc: "The replay spool is within its configured cap." },
    { id: "disk", label: "Disk space", desc: "The install volume has free space for logs and jobs." },
    { id: "jobs", label: "Job runtime", desc: "At least one supported script runner is present." },
  ];
  DIAG.selfTestShape = () => DIAG.SELF_TEST_CHECKS.map((c) => Object.assign({}, c));
  DIAG.selfTestCheck = (id) => DIAG.SELF_TEST_CHECKS.find((c) => c.id === id) || null;

  /* ─────────────────────── log policy ─────────────────────── */

  DIAG.logPolicy = function () {
    return {
      maxBytes: Math.max(65536, num(cfg("rmm.agentLogMaxBytes", 2097152), 2097152)),
      keep: Math.max(1, num(cfg("rmm.agentLogKeep", 3), 3)),
      requestLines: DIAG.requestLines(),
      requestMaxBytes: DIAG.logMaxBytes(),
    };
  };

  /* ─────────────────────── requests ─────────────────────── */

  const SUPPORTS = () => true;

  /* Ask one or many agents to send their recent log when they next check
     in. Returns the number of devices the request was set on. */
  DIAG.requestLogs = async function (opts) {
    opts = opts || {};
    const providerId = String(opts.providerId || "");
    if (!providerId) return { error: "no_provider" };
    const deviceIds = [...new Set(asArr(opts.deviceIds).map(String).filter(Boolean))];
    if (!deviceIds.length) return { error: "no_targets", message: "Select at least one device." };
    const lines = Math.max(20, num(opts.lines, DIAG.requestLines()));
    const at = now();
    let queued = 0;
    for (const id of deviceIds) {
      const g = await D.get(providerId, id);
      if (g.error) continue;
      const custom = Object.assign({}, asObj(g.device.custom));
      custom.logRequest = { requestId: rid("log"), lines, requestedAt: at, requestedBy: opts.requestedBy || actorName(), deliveredAt: "", attempt: 0 };
      const r = await D.update(providerId, id, { custom });
      if (!r.error) queued++;
    }
    notify("logs_requested", { providerId, count: queued });
    await audit("request_agent_logs", providerId, "Requested the last " + lines + " log lines from " + queued + " device(s).");
    return { ok: true, queued, lines };
  };

  /* Ask an agent to run its self-test on the next check-in. */
  DIAG.requestSelfTest = async function (opts) {
    opts = opts || {};
    const providerId = String(opts.providerId || "");
    if (!providerId) return { error: "no_provider" };
    const deviceIds = [...new Set(asArr(opts.deviceIds).map(String).filter(Boolean))];
    if (!deviceIds.length) return { error: "no_targets", message: "Select at least one device." };
    const at = now();
    let queued = 0;
    for (const id of deviceIds) {
      const g = await D.get(providerId, id);
      if (g.error) continue;
      const custom = Object.assign({}, asObj(g.device.custom));
      custom.selfTestRequest = { requestId: rid("st"), requestedAt: at, requestedBy: opts.requestedBy || actorName(), deliveredAt: "", attempt: 0 };
      const r = await D.update(providerId, id, { custom });
      if (!r.error) queued++;
    }
    notify("selftest_requested", { providerId, count: queued });
    await audit("request_agent_selftest", providerId, "Requested a self-test from " + queued + " device(s).");
    return { ok: true, queued };
  };

  /* The requests, if any, to hand back with a device's heartbeat. */
  DIAG.deliver = async function (providerId, deviceId, dev) {
    const custom = asObj(dev && dev.custom);
    const nextCustom = Object.assign({}, custom);
    const out = {};
    let changed = false;
    const logReq = asObj(custom.logRequest);
    if (logReq.requestId && !(logReq.deliveredAt && Date.now() - Date.parse(logReq.deliveredAt) < 60000)) {
      nextCustom.logRequest = Object.assign({}, logReq, { deliveredAt: now(), attempt: num(logReq.attempt, 0) + 1 });
      out.collectLogs = { requestId: nextCustom.logRequest.requestId, lines: num(logReq.lines, DIAG.requestLines()) };
      changed = true;
    }
    const stReq = asObj(custom.selfTestRequest);
    if (stReq.requestId && !(stReq.deliveredAt && Date.now() - Date.parse(stReq.deliveredAt) < 60000)) {
      nextCustom.selfTestRequest = Object.assign({}, stReq, { deliveredAt: now(), attempt: num(stReq.attempt, 0) + 1 });
      out.selfTest = { requestId: nextCustom.selfTestRequest.requestId };
      changed = true;
    }
    if (changed) { const r = await D.update(providerId, deviceId, { custom: nextCustom }); if (r.error) return null; }
    return Object.keys(out).length ? out : null;
  };

  /* ─────────────────────── submissions ─────────────────────── */

  const LOG_TRIM_MARK = "…[earlier lines omitted]…\n";
  function trimLog(text, maxBytes) {
    const s = String(text == null ? "" : text);
    if (s.length <= maxBytes) return { text: s, truncated: false };
    return { text: "…[earlier lines omitted]…\n" + s.slice(s.length - Math.max(0, maxBytes - LOG_TRIM_MARK.length)), truncated: true };
  }

  /* The agent posts its log tail: { deviceId, credential, requestId?,
     lines?, text, truncated?, source? }. */
  DIAG.submitLogs = async function (req) {
    req = req || {};
    const deviceId = String(req.deviceId || "");
    if (!deviceId) return { ok: false, error: "no_device" };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason };
    const providerId = auth.providerId || req.providerId || "";
    const cap = DIAG.logMaxBytes();
    const trimmed = trimLog(req.text == null && req.textB64 && ERP.jobs ? ERP.jobs.fromB64(req.textB64) : req.text, cap);
    const at = now();
    const records = await load();
    const rec = {
      kind: "logs", id: rid("log"), providerId, deviceId,
      requestId: S(req.requestId || "", 60),
      requestedAt: S(req.requestedAt || "", 40),
      receivedAt: at,
      lines: num(req.lines, trimmed.text ? trimmed.text.split("\n").length : 0),
      bytes: trimmed.text.length,
      truncated: trimmed.truncated || req.truncated === true,
      source: S(req.source || "agent", 40),
      text: trimmed.text,
    };
    records.push(rec);
    /* bounded per-device ring */
    const mine = records.filter((r) => r.kind === "logs" && String(r.deviceId) === deviceId).sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
    const drop = new Set(mine.slice(DIAG.logKeep()).map((r) => r.id));
    const kept = records.filter((r) => !drop.has(r.id));
    const w = await save(kept);
    if (w && w.error) return { ok: false, error: w.error, message: w.message };

    const g = await D.get(providerId, deviceId);
    if (!g.error) {
      const custom = Object.assign({}, asObj(g.device.custom));
      delete custom.logRequest;
      custom.lastLog = { at, bytes: trimmed.text.length, lines: rec.lines };
      await D.update(providerId, deviceId, { custom });
    }
    notify("logs", { deviceId, providerId });
    return { ok: true, id: rec.id, bytes: rec.bytes, lines: rec.lines, truncated: rec.truncated === true };
  };

  /* The agent posts a self-test report: { deviceId, credential, requestId?,
     ok, checks:[{id,name,ok,detail}], agentVersion, context{} }. */
  DIAG.submitSelfTest = async function (req) {
    req = req || {};
    const deviceId = String(req.deviceId || "");
    if (!deviceId) return { ok: false, error: "no_device" };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason };
    const providerId = auth.providerId || req.providerId || "";
    const checks = asArr(req.checks).map((c) => ({
      id: S(asObj(c).id || asObj(c).name || "", 40),
      name: S(asObj(c).name || asObj(c).id || "", 80),
      ok: asObj(c).ok === true,
      detail: S(asObj(c).detail || "", 300),
    })).slice(0, 32);
    const at = now();
    const records = await load();
    const rec = {
      kind: "selftest", id: rid("st"), providerId, deviceId,
      requestId: S(req.requestId || "", 60),
      receivedAt: at,
      ok: checks.length ? checks.every((c) => c.ok) : req.ok === true,
      agentVersion: S(req.agentVersion || "", 40),
      checks,
      context: {
        hostname: S(asObj(req.context).hostname || "", 120),
        spoolPending: num(asObj(req.context).spoolPending, 0),
        clockSkewSeconds: asObj(req.context).clockSkewSeconds == null ? null : num(asObj(req.context).clockSkewSeconds, 0),
        freeDiskBytes: asObj(req.context).freeDiskBytes == null ? null : num(asObj(req.context).freeDiskBytes, 0),
      },
    };
    records.push(rec);
    const mine = records.filter((r) => r.kind === "selftest" && String(r.deviceId) === deviceId).sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
    const drop = new Set(mine.slice(DIAG.selfTestKeep()).map((r) => r.id));
    const kept = records.filter((r) => !drop.has(r.id));
    const w = await save(kept);
    if (w && w.error) return { ok: false, error: w.error, message: w.message };

    const g = await D.get(providerId, deviceId);
    if (!g.error) {
      const custom = Object.assign({}, asObj(g.device.custom));
      delete custom.selfTestRequest;
      custom.diagnostics = Object.assign({}, asObj(custom.diagnostics), { lastSelfTestAt: at, lastSelfTestOk: rec.ok, lastSelfTestId: rec.id });
      await D.update(providerId, deviceId, { custom });
    }
    notify("selftest", { deviceId, providerId, ok: rec.ok });
    await audit("agent_selftest", deviceId, "Self-test on " + (rec.context.hostname || deviceId) + " → " + (rec.ok ? "passed" : "FAILED") + ".");
    return { ok: true, id: rec.id, passed: rec.ok, checks: checks.length };
  };

  /* ─────────────────────── reads ─────────────────────── */

  DIAG.listLogs = async function (opts) {
    opts = opts || {};
    let list = (await load()).filter((r) => r.kind === "logs");
    if (opts.providerId) list = list.filter((r) => String(r.providerId) === String(opts.providerId));
    if (opts.deviceId) list = list.filter((r) => String(r.deviceId) === String(opts.deviceId));
    list.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
    if (opts.limit) list = list.slice(0, opts.limit);
    return list.map((r) => Object.assign(clone(r), { text: undefined, preview: S((r.text || "").split("\n").slice(-3).join(" / "), 200) }));
  };

  DIAG.getLog = async function (id) {
    const r = (await load()).find((x) => x.kind === "logs" && String(x.id) === String(id));
    return r ? clone(r) : null;
  };

  DIAG.listSelfTests = async function (opts) {
    opts = opts || {};
    let list = (await load()).filter((r) => r.kind === "selftest");
    if (opts.providerId) list = list.filter((r) => String(r.providerId) === String(opts.providerId));
    if (opts.deviceId) list = list.filter((r) => String(r.deviceId) === String(opts.deviceId));
    list.sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
    if (opts.limit) list = list.slice(0, opts.limit);
    return list.map(clone);
  };

  DIAG.latestSelfTest = async function (deviceId) {
    const l = await DIAG.listSelfTests({ deviceId, limit: 1 });
    return l[0] || null;
  };

  DIAG.stats = async function (providerId) {
    const list = await load();
    const scope = (r) => !providerId || String(r.providerId) === String(providerId);
    const logs = list.filter((r) => r.kind === "logs" && scope(r));
    const sts = list.filter((r) => r.kind === "selftest" && scope(r));
    return {
      logs: logs.length,
      logsBytes: logs.reduce((a, r) => a + num(r.bytes, 0), 0),
      selfTests: sts.length,
      selfTestsPassed: sts.filter((r) => r.ok).length,
      selfTestsFailed: sts.filter((r) => !r.ok).length,
      devicesDiagnosed: new Set(logs.concat(sts).map((r) => String(r.deviceId))).size,
    };
  };

  /* ─────────────────────── troubleshooting playbook ─────────────────────── */

  DIAG.TROUBLESHOOTING = [
    {
      id: "unreachable",
      symptom: "The agent's self-test fails at “Collector reachable”.",
      cause: "DNS, a firewall/proxy, or a wrong collector address embedded in the installer.",
      fix: "From the endpoint, resolve and connect to the collector address (Test-NetConnection / curl -v). Confirm outbound TCP 443. If the address is wrong, re-issue an installer with the correct collector URL and re-enroll.",
    },
    {
      id: "tls",
      symptom: "Reachable but the handshake is rejected.",
      cause: "A TLS-intercepting proxy, an expired certificate, or a pin that no longer matches a rotated certificate.",
      fix: "Install the proxy's root CA on the endpoint, or rotate rmm.tlsPinSha256 to the new certificate's SPKI hash. Never set tlsAllowInsecure on a production network.",
    },
    {
      id: "not-enrolled",
      symptom: "“Enrolled” fails — the device holds no credential.",
      cause: "The installer's one-time token was already used, expired, or revoked.",
      fix: "Issue a fresh installer (or a re-enrollment token bound to this device) from Devices → Deploy and re-run it. The old token cannot be reused by design.",
    },
    {
      id: "revoked",
      symptom: "“Authenticated” fails with “this device's credential has been revoked”.",
      cause: "The device was revoked from the console (lost/stolen endpoint, or a deliberate rotation).",
      fix: "If the endpoint is legitimate, re-enroll it with a fresh token; otherwise leave it revoked. Check the audit trail for who revoked it.",
    },
    {
      id: "clock",
      symptom: "“Clock” fails or the device shows a large clock skew.",
      cause: "The endpoint's clock drifted (dead CMOS battery, blocked NTP).",
      fix: "Fix time sync (w32tm /resync, chronyc makestep, sntp -sS). Heartbeats are accepted but monitors must not trust a skewed timestamp.",
    },
    {
      id: "service",
      symptom: "“Service” fails — nothing runs on a schedule.",
      cause: "The scheduled task / systemd timer / launchd daemon was removed, disabled, or the install directory was moved.",
      fix: "Re-run the installer (it re-registers the service), or re-enable the unit. The agent must live in its install directory for self-update to work.",
    },
    {
      id: "spool",
      symptom: "The device shows a growing offline buffer.",
      cause: "The collector has been unreachable; the agent is replaying once it returns.",
      fix: "Restore connectivity. The spool replays with exponential backoff and is bounded, so it will not fill the disk; cancel stale update/log requests if the device is being retired.",
    },
    {
      id: "disk",
      symptom: "“Disk space” fails.",
      cause: "The install volume is full.",
      fix: "Free space, then reduce rmm.agentLogMaxBytes/agentLogKeep if the endpoint is very constrained. Logs and job output are already bounded.",
    },
    {
      id: "jobs",
      symptom: "“Job runtime” fails.",
      cause: "No supported script runner is installed (e.g. no PowerShell, bash, or python on the host).",
      fix: "Install the missing runtime, or restrict this endpoint's jobs to a supported language — jobs for an unsupported language fail with a clear message rather than running.",
    },
    {
      id: "no-heartbeat",
      symptom: "The agent is installed but the console shows it offline with no self-test.",
      cause: "The service is registered but the process is crashing at start-up (bad config, permissions).",
      fix: "Read the local rotating log at <install>/../Logs/agent.log (or /opt/rmm-u/logs), fix the reported error, and use Pull logs to confirm. Re-run the installer if the config file is corrupt.",
    },
  ];
  DIAG.troubleshooting = () => DIAG.TROUBLESHOOTING.map((t) => Object.assign({}, t));

  /* ─────────────────────── display ─────────────────────── */

  DIAG.deviceSection = async function (dev, providerId) {
    if (!dev) return "";
    const ui = ERP.ui;
    const st = await DIAG.latestSelfTest(dev.id);
    const custom = asObj(dev.custom);
    const rows = [];
    const stBadge = st ? (st.ok ? ui.badge("self-test passed", "success") : ui.badge("self-test FAILED", "danger")) : ui.badge("no self-test yet", "muted");
    rows.push(["Diagnostics", stBadge + (st ? " · " + ui.dateTime(st.receivedAt) : "")]);
    if (custom.lastLog) rows.push(["Last log pull", ui.dateTime(custom.lastLog.at) + " · " + D.bytesHuman(custom.lastLog.bytes)]);
    if (custom.logRequest) rows.push(["Log request", ui.badge("pending", "info")]);
    if (custom.selfTestRequest) rows.push(["Self-test request", ui.badge("pending", "info")]);
    if (st && !st.ok) {
      const failing = st.checks.filter((c) => !c.ok).map((c) => c.name || c.id).join(", ");
      rows.push(["Failing checks", '<span class="erp-sub">' + ui.esc(failing) + "</span>"]);
    }
    return '<h4 class="rmm-section-title">Diagnostics &amp; support</h4>' +
      '<div class="rmm-kv">' + rows.map((x) => '<div class="rmm-kv-row"><span>' + ui.esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>" +
      '<p class="erp-sub">Pull logs and run self-tests from Devices → Diagnostics.</p>';
  };

  function checkTone(ok) { return ok ? "success" : "danger"; }

  /* The Devices → Diagnostics console: request logs / self-tests, read the
     reports, and a troubleshooting playbook. */
  DIAG.renderDiagnostics = async function (panel, opts) {
    if (!panel) return;
    const ui = ERP.ui, esc = ui.esc;
    const providerId = opts.providerId;
    const toast = opts.toast || (() => {});
    const refresh = opts.refresh || (() => {});
    let logs = [], tests = [], stats = { logs: 0, logsBytes: 0, selfTests: 0, selfTestsPassed: 0, selfTestsFailed: 0, devicesDiagnosed: 0 }, devices = [];
    try {
      logs = await DIAG.listLogs({ providerId, limit: 50 });
      tests = await DIAG.listSelfTests({ providerId, limit: 50 });
      stats = await DIAG.stats(providerId);
      devices = await D.list(providerId);
    } catch (e) {}

    const deviceOpts = devices.map((d) => ({ value: d.id, label: d.hostname || d.displayName || d.id }));
    const logRows = logs.map((r) => ({
      device: "<b>" + esc((devices.find((d) => d.id === r.deviceId) || {}).hostname || r.deviceId) + "</b>",
      at: ui.dateTime(r.receivedAt),
      lines: String(r.lines),
      size: D.bytesHuman(r.bytes) + (r.truncated ? " " + ui.badge("truncated", "warn") : ""),
      preview: '<span class="erp-sub">' + esc(r.preview || "") + "</span>",
      actions: ui.btn("View", { small: true, act: "dg-log-view", arg: r.id }),
    }));
    const testRows = tests.map((r) => {
      const failed = asArr(r.checks).filter((c) => !c.ok).length;
      return {
        device: "<b>" + esc((devices.find((d) => d.id === r.deviceId) || {}).hostname || r.deviceId) + "</b>",
        at: ui.dateTime(r.receivedAt),
        result: ui.badge(r.ok ? "passed" : "failed", checkTone(r.ok)) + (failed ? " " + ui.badge(failed + " failing", "danger") : ""),
        checks: asArr(r.checks).map((c) => ui.badge(c.name || c.id, checkTone(c.ok))).join(" "),
        actions: ui.btn("Details", { small: true, act: "dg-test-view", arg: r.id }),
      };
    });

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Log pulls", value: String(stats.logs), sub: D.bytesHuman(stats.logsBytes) + " stored" }),
        ui.statCard({ label: "Self-tests", value: String(stats.selfTests), sub: stats.devicesDiagnosed + " device(s) diagnosed" }),
        ui.statCard({ label: "Passed", value: String(stats.selfTestsPassed), tone: "success" }),
        ui.statCard({ label: "Failed", value: String(stats.selfTestsFailed), tone: stats.selfTestsFailed ? "danger" : null }),
      ], "erp-kpi-grid") +
      ui.card("Request agent diagnostics", ui.form(
        '<div class="erp-inline-form">' +
          '<div class="field" style="flex:1 1 220px"><label>Device</label><select name="dgDevice"><option value="">— every enrolled device —</option>' + deviceOpts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("") + "</select></div>" +
          '<div class="field"><label>Log lines</label><input type="number" name="dgLines" value="' + DIAG.requestLines() + '" min="20"></div>' +
        "</div>" +
        '<p class="erp-sub">The agent picks the request up on its next check-in (every ' + num(cfg("rmm.heartbeatSeconds", 300), 300) + "s) and posts the result back authenticated.</p>",
        ui.btn("Pull logs", { small: true, primary: true, act: "dg-logs" }) + " " + ui.btn("Run self-test", { small: true, act: "dg-selftest" })
      )) +
      ui.card("Log pulls (" + logs.length + ")",
        ui.table([
          { key: "device", label: "Device", render: (r) => r.device },
          { key: "at", label: "Received" },
          { key: "lines", label: "Lines", align: "right" },
          { key: "size", label: "Size", render: (r) => r.size },
          { key: "preview", label: "Tail", render: (r) => r.preview },
          { key: "actions", label: "", render: (r) => r.actions },
        ], logRows, { scroll: true, emptyText: "No logs pulled yet." })) +
      ui.card("Self-tests (" + tests.length + ")",
        ui.table([
          { key: "device", label: "Device", render: (r) => r.device },
          { key: "at", label: "Received" },
          { key: "result", label: "Result", render: (r) => r.result },
          { key: "checks", label: "Checks", render: (r) => r.checks },
          { key: "actions", label: "", render: (r) => r.actions },
        ], testRows, { scroll: true, emptyText: "No self-tests yet." })) +
      ui.card("Troubleshooting", '<p class="erp-sub">The classic failure modes for an installed agent that cannot reach the collector.</p>' +
        DIAG.TROUBLESHOOTING.map((t) =>
          '<details class="rmm-diag"><summary>' + esc(t.symptom) + "</summary>" +
          "<p><b>Cause.</b> " + esc(t.cause) + "</p><p><b>Fix.</b> " + esc(t.fix) + "</p></details>").join(""));

    function targets() {
      const v = panel.querySelector('[name="dgDevice"]');
      const id = v ? v.value : "";
      return id ? [id] : devices.map((d) => d.id);
    }

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "dg-logs") {
        const ids = targets();
        if (!ids.length) { toast("No devices to ask.", "warn"); return; }
        const lines = num((panel.querySelector('[name="dgLines"]') || {}).value, DIAG.requestLines());
        const r = await DIAG.requestLogs({ providerId, deviceIds: ids, lines });
        toast(r.error ? "Request failed: " + (r.message || r.error) : "Log request queued on " + r.queued + " device(s).", r.error ? "error" : "success");
        return refresh();
      }
      if (act === "dg-selftest") {
        const ids = targets();
        if (!ids.length) { toast("No devices to ask.", "warn"); return; }
        const r = await DIAG.requestSelfTest({ providerId, deviceIds: ids });
        toast(r.error ? "Request failed: " + (r.message || r.error) : "Self-test queued on " + r.queued + " device(s).", r.error ? "error" : "success");
        return refresh();
      }
      if (act === "dg-log-view") {
        const rec = await DIAG.getLog(arg);
        if (!rec) { toast("Log not found.", "error"); return; }
        ui.modal({
          title: "Agent log · " + rec.deviceId, size: "lg",
          body: '<div class="erp-sub">' + esc(rec.lines + " lines · " + D.bytesHuman(rec.bytes)) + " · " + esc(ui.dateTime(rec.receivedAt)) + "</div>" +
            '<pre class="rmm-code">' + esc(rec.text || "(empty)") + "</pre>",
          foot: ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
        });
        return;
      }
      if (act === "dg-test-view") {
        const rec = (await DIAG.listSelfTests({ providerId, limit: 200 })).find((r) => r.id === arg);
        if (!rec) { toast("Self-test not found.", "error"); return; }
        const rows = asArr(rec.checks).map((c) => ({
          name: esc(c.name || c.id), result: ui.badge(c.ok ? "pass" : "fail", checkTone(c.ok)), detail: esc(c.detail || ""),
        }));
        ui.modal({
          title: "Self-test · " + rec.deviceId, size: "lg",
          body: (rec.ok ? ui.alert("All checks passed.", "success") : ui.alert("One or more checks failed.", "danger")) +
            ui.table([{ key: "name", label: "Check" }, { key: "result", label: "Result", render: (r) => r.result }, { key: "detail", label: "Detail" }], rows) +
            (rec.context && rec.context.spoolPending ? '<p class="erp-sub">Offline buffer: ' + rec.context.spoolPending + " item(s)</p>" : ""),
          foot: ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
        });
        return;
      }
    });
  };

  DIAG.init = function () { return DIAG; };
})();
