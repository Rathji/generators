/* ============================================================
   RMM-U — security posture, compliance baselines & backup verification
   (Phase 8 · Tasks 34–36)

   Three questions, one engine:

     • Task 34 — HOW secure is the endpoint right now? A **posture scan**
       evaluates every applicable item in the check catalogue against the
       device's own inventory — anti-malware present and up to date,
       real-time protection, host firewall, disk encryption (BitLocker /
       FileVault / LUKS), Secure Boot and TPM, pending reboots, OS patch
       currency (from the patch engine) and **local-administrator
       changes** — and stores a per-device posture with the exact failing
       checks, rolled up per device, group, site and client. A change in
       posture can raise or clear an alert through the alert pipeline.

     • Task 35 — WHAT does "compliant" mean here? A **compliance baseline**
       is a policy: a named set of required checks targeted at devices,
       groups, sites or tags with a defined precedence order (priority,
       then target specificity, then recency). Drift is the distance
       between a device and its effective baseline, reported with the
       exact failing checks; **accepted deviations** are recorded
       explicitly, and remediation is offered through the automation
       engine (a `compliance.drift` event runs a chosen rule scoped to
       that one device).

     • Task 36 — IS the data safe? **Backup expectations** describe how
       often each class of device should back up and from which product.
       Backup jobs are ingested from the agent inventory or reported by a
       product, the age of the last successful backup and any missed
       window are tracked, failures escalate through the alert pipeline,
       and periodic **recovery-test** confirmation is prompted and
       audited.

   Everything lives on the provider aggregate in `provider.securityState`:

     securityState = { checks, baselines, posture, scans, deviations,
                       backupExpectations, backupJobs, backupState,
                       recoveryTests }

   Nothing here is simulated: posture is read from the real inventory
   snapshot (INV.snapshot → sections.security / sections.users), patch
   currency from the patch engine (PA.complianceFor), remediation from the
   automation engine (AUTO.run) and alerts from the alert lifecycle
   (AL.fire / AL.autoClear). Deleting a baseline or an expectation never
   touches the posture history it produced.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const M = ERP.masterConfig || null;
  const G = ERP.groups || null;
  const INV = ERP.rmmInventory || null;
  const PA = ERP.patch || null;
  const AL = ERP.alerts || null;
  const AUTO = ERP.automations || null;
  const SEC = (ERP.security = {});

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const msOf = (v) => { const t = Date.parse(v); return isFinite(t) ? t : null; };
  const iso = (ms) => new Date(ms).toISOString();
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const uniq = (a) => [...new Set(asArr(a).filter((x) => x !== "" && x != null))];
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const enabled = () => cfg("rmm.securityEnabled", true) !== false;
  const scanEnabled = () => cfg("rmm.securityScanEnabled", true) !== false;
  const alertEnabled = () => cfg("rmm.securityAlertEnabled", false) === true;
  const trackAdmins = () => cfg("rmm.securityTrackAdmins", true) !== false;
  const backupEnabled = () => cfg("rmm.backupMonitorEnabled", true) !== false;
  const backupAlertEnabled = () => cfg("rmm.backupAlertEnabled", true) !== false;
  const recoveryEnabled = () => cfg("rmm.backupRecoveryTestEnabled", true) !== false;
  const scanHistory = () => Math.max(10, num(cfg("rmm.securityScanHistory", 200), 200));
  const driftHistory = () => Math.max(10, num(cfg("rmm.securityDriftHistory", 500), 500));
  const backupJobHistory = () => Math.max(10, num(cfg("rmm.backupJobHistory", 500), 500));
  const defaultMaxAgeHours = () => Math.max(1, num(cfg("rmm.backupDefaultMaxAgeHours", 26), 26));
  const defaultGraceHours = () => Math.max(0, num(cfg("rmm.backupDefaultGraceHours", 4), 4));
  const recoveryDays = () => Math.max(1, num(cfg("rmm.backupRecoveryTestDays", 90), 90));

  const stateOf = (p) => asObj(asObj(p).securityState);
  const providerOf = async (providerId) => { const g = await T.get(providerId); return g.error ? null : g.provider; };
  const actor = () => { try { return ERP.role || "owner"; } catch (e) { return "owner"; } };

  async function audit(action, targetId, summary, targetType) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: targetType || "security", targetId, summary }); } catch (e) {}
  }
  async function auditDevice(action, deviceId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "device", targetId: String(deviceId), summary }); } catch (e) {}
  }
  SEC.auditDevice = auditDevice;

  /* Write provider.securityState under the store's compare-and-set guard,
     retrying the read-modify-write a few times so concurrent module seeds
     (which also write the aggregate) cannot silently drop our change. */
  async function writeState(providerId, mutate, attempts) {
    const tries = Math.max(1, num(attempts, 4));
    let last = null;
    for (let i = 0; i < tries; i++) {
      const r = await T.update(providerId, (p) => { p.securityState = asObj(p.securityState); mutate(p.securityState, p); });
      if (!r.error) return r;
      last = r;
      await new Promise((res) => setTimeout(res, 40));
    }
    return last;
  }
  SEC.writeState = writeState;

  /* ═══════════════════════ check catalogue (Task 34) ═══════════════════════ */

  SEC.STATES = ["pass", "fail", "warn", "na", "unknown"];
  SEC.STATE_LABEL = { pass: "Pass", fail: "Fail", warn: "Warning", na: "N/A", unknown: "Unknown" };
  SEC.STATE_TONE = { pass: "success", fail: "danger", warn: "warn", na: "muted", unknown: "muted" };
  SEC.stateLabel = (s) => SEC.STATE_LABEL[s] || s || "—";
  SEC.stateTone = (s) => SEC.STATE_TONE[s] || "muted";

  SEC.CHECK_CATEGORIES = [
    { id: "antimalware", label: "Anti-malware" },
    { id: "firewall", label: "Firewall" },
    { id: "encryption", label: "Encryption" },
    { id: "hardware", label: "Boot & hardware" },
    { id: "patching", label: "Patching" },
    { id: "accounts", label: "Accounts" },
    { id: "services", label: "Services" },
    { id: "custom", label: "Custom" },
  ];
  SEC.categoryLabel = (id) => { const c = SEC.CHECK_CATEGORIES.find((x) => x.id === id); return c ? c.label : (id || "—"); };

  /* Each entry is a self-describing check. `kind` selects the evaluator;
     `params` provides any per-check settings; `os` restricts it to a
     platform; `default` marks it as part of the built-in fallback
     baseline when no baseline targets the device. */
  SEC.CHECK_CATALOGUE = [
    { id: "av-present", label: "Anti-malware present & enabled", category: "antimalware", kind: "av-present", severityId: "sev-critical", default: true, desc: "At least one anti-malware / EDR product reports as enabled." },
    { id: "av-up-to-date", label: "Anti-malware definitions current", category: "antimalware", kind: "av-up-to-date", severityId: "sev-warning", default: true, desc: "Every enabled anti-malware product reports its definitions up to date." },
    { id: "av-realtime", label: "Real-time protection on", category: "antimalware", kind: "av-realtime", os: ["windows"], severityId: "sev-warning", default: true, desc: "Windows Defender real-time protection is enabled." },
    { id: "defender-signature-age", label: "Defender signatures recent", category: "antimalware", kind: "field-value", os: ["windows"], severityId: "sev-warning", default: true, params: { path: "security.defender.signatureAgeDays", op: "lte", value: 3 }, desc: "Defender signature age is within the allowed window." },
    { id: "firewall-enabled", label: "Host firewall enabled", category: "firewall", kind: "firewall-enabled", severityId: "sev-critical", default: true, desc: "The host firewall is enabled on every profile." },
    { id: "disk-encryption", label: "System disk encrypted", category: "encryption", kind: "disk-encryption", severityId: "sev-critical", default: true, desc: "The system drive is encrypted (BitLocker / FileVault / LUKS)." },
    { id: "encryption-percent", label: "Disk fully encrypted", category: "encryption", kind: "field-value", severityId: "sev-warning", default: false, params: { path: "security.encryption.percentEncrypted", op: "gte", value: 100 }, desc: "Encryption has completed to 100%." },
    { id: "secure-boot", label: "Secure Boot enabled", category: "hardware", kind: "secure-boot", severityId: "sev-warning", default: true, desc: "UEFI Secure Boot is enabled." },
    { id: "tpm", label: "TPM present & enabled", category: "hardware", kind: "tpm", severityId: "sev-warning", default: true, desc: "A Trusted Platform Module is present and enabled." },
    { id: "pending-reboot", label: "No pending reboot", category: "patching", kind: "pending-reboot", severityId: "sev-info", default: true, desc: "No reboot is pending, so patches can complete." },
    { id: "os-patch-currency", label: "OS patch currency", category: "patching", kind: "patch-currency", severityId: "sev-warning", default: true, desc: "The device has no missing required patches under its patch policy." },
    { id: "local-admins", label: "Local administrator set unchanged", category: "accounts", kind: "local-admins", severityId: "sev-critical", default: true, desc: "The set of local administrator accounts has not changed since the last scan." },
    { id: "service-running", label: "Required service running", category: "services", kind: "service-state", severityId: "sev-warning", default: false, params: { serviceName: "" }, desc: "A named service must be running (configure the service name)." },
  ];
  SEC.CHECK_IDS = SEC.CHECK_CATALOGUE.map((c) => c.id);
  SEC.check = (id) => SEC.CHECK_CATALOGUE.find((c) => String(c.id) === String(id)) || null;
  SEC.checkLabel = (id) => (SEC.check(id) || {}).label || id;
  SEC.DEFAULT_CHECKS = () => SEC.CHECK_CATALOGUE.filter((c) => c.default !== false).map((c) => c.id);

  /* Merge a stored check id (or override object) with the catalogue entry. */
  SEC.normalizeCheck = function (raw) {
    const base = typeof raw === "string" ? { id: raw } : asObj(raw);
    const def = SEC.check(base.id) || {};
    return {
      id: String(base.id || def.id || ""), label: S(base.label || def.label || base.id, 160),
      category: base.category || def.category || "custom", kind: base.kind || def.kind || "field-value",
      severityId: base.severityId || def.severityId || "sev-warning", os: asArr(base.os || def.os).map(low),
      params: Object.assign({}, asObj(def.params), asObj(base.params)), default: base.default === undefined ? def.default !== false : !!base.default,
    };
  };

  function getPath(obj, path) {
    return String(path || "").split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function cmp(op, actual, expected) {
    if (actual == null) return null;
    switch (op) {
      case "eq": return String(actual) === String(expected);
      case "neq": return String(actual) !== String(expected);
      case "gte": return num(actual, -Infinity) >= num(expected, 0);
      case "lte": return num(actual, Infinity) <= num(expected, 0);
      case "gt": return num(actual, -Infinity) > num(expected, 0);
      case "lt": return num(actual, Infinity) < num(expected, 0);
      case "contains": return low(actual).indexOf(low(expected)) !== -1;
      case "present": return String(actual) !== "";
      case "absent": return String(actual) === "";
      case "truthy": return !!actual;
      case "falsy": return !actual;
      default: return null;
    }
  }

  /* Evaluate one check against one device context. Pure. */
  SEC.evaluateCheck = function (rawCheck, ctx) {
    ctx = asObj(ctx);
    const check = SEC.normalizeCheck(rawCheck);
    const sections = asObj(ctx.sections);
    const sec = asObj(sections.security);
    const fam = low(asObj(asObj(ctx.device).os).family);
    const finding = {
      checkId: check.id, label: check.label, category: check.category, kind: check.kind,
      severityId: check.severityId, state: "unknown", detail: "",
    };
    if (asArr(check.os).length && check.os.indexOf(fam) === -1) {
      finding.state = "na"; finding.detail = "Not applicable to " + (fam || "this platform");
      return finding;
    }
    const set = (state, detail) => { finding.state = state; finding.detail = detail || ""; return finding; };
    switch (check.kind) {
      case "av-present": {
        if (!ctx.collected) return set("unknown", "No inventory collected yet");
        const av = asArr(sec.antivirus);
        if (!av.length) return set("fail", "No anti-malware product reported");
        const on = av.filter((a) => asObj(a).enabled !== false);
        if (!on.length) return set("fail", av.length + " product(s) reported, none enabled");
        return set("pass", on.map((a) => S(asObj(a).name, 60)).join(", "));
      }
      case "av-up-to-date": {
        if (!ctx.collected) return set("unknown", "No inventory collected yet");
        const av = asArr(sec.antivirus);
        if (!av.length) return set("fail", "No anti-malware product reported");
        const stale = av.filter((a) => asObj(a).enabled !== false && asObj(a).upToDate === false);
        if (stale.length) return set("fail", stale.map((a) => S(asObj(a).name, 60)).join(", ") + " out of date");
        const on = av.filter((a) => asObj(a).enabled !== false);
        if (!on.length) return set("na", "No enabled product to assess");
        return set("pass", on.length + " product(s) current");
      }
      case "av-realtime": {
        const def = asObj(sec.defender);
        if (def.realtimeEnabled == null) return set("unknown", "Real-time protection not reported");
        return def.realtimeEnabled ? set("pass", "Real-time protection on") : set("fail", "Real-time protection is off");
      }
      case "firewall-enabled": {
        if (!ctx.collected) return set("unknown", "No inventory collected yet");
        const fw = asObj(sec.firewall);
        if (fw.enabled == null) return set("unknown", "Firewall state not reported");
        if (!fw.enabled) return set("fail", "Firewall is disabled");
        const off = asArr(fw.profiles).filter((p) => asObj(p).enabled === false);
        return off.length ? set("warn", off.length + " firewall profile(s) off") : set("pass", "Firewall on");
      }
      case "disk-encryption": {
        if (!ctx.collected) return set("unknown", "No inventory collected yet");
        const enc = asObj(sec.encryption);
        if (enc.systemDrive == null) return set("unknown", "Encryption state not reported");
        if (!enc.systemDrive) return set("fail", "System disk is not encrypted" + (enc.method ? " (" + enc.method + ")" : ""));
        if (enc.percentEncrypted != null && num(enc.percentEncrypted, 100) < 100) return set("warn", (enc.method || "Encryption") + " " + num(enc.percentEncrypted, 0) + "% complete");
        return set("pass", (enc.method || "Encrypted") + (enc.percentEncrypted != null ? " (" + num(enc.percentEncrypted, 0) + "%)" : ""));
      }
      case "secure-boot": {
        if (sec.secureBoot == null) return set("unknown", "Secure Boot state not reported");
        return sec.secureBoot ? set("pass", "Secure Boot enabled") : set("fail", "Secure Boot disabled");
      }
      case "tpm": {
        const tpm = asObj(sec.tpm);
        if (tpm.present == null && tpm.enabled == null) return set("unknown", "TPM state not reported");
        if (!tpm.present) return set("fail", "No TPM reported");
        if (tpm.enabled === false) return set("fail", "TPM present but disabled" + (tpm.version ? " (" + tpm.version + ")" : ""));
        return set("pass", "TPM " + (tpm.version || "present"));
      }
      case "pending-reboot": {
        if (sec.pendingReboot == null) return set("unknown", "Reboot state not reported");
        return sec.pendingReboot ? set("warn", "A reboot is pending") : set("pass", "No pending reboot");
      }
      case "patch-currency": {
        if (!PA) return set("unknown", "Patch engine unavailable");
        const pc = asObj(ctx.patch);
        if (pc.compliant == null) return set("unknown", pc.source === "none" ? "No patch scan yet" : "Patch compliance unknown");
        if (pc.compliant) return set("pass", "Patch compliant");
        const c = asObj(pc.counts);
        return set(num(c.overdue, 0) ? "fail" : "warn", num(c.missingRequired, 0) + " missing required update(s)" + (num(c.overdue, 0) ? "; " + num(c.overdue, 0) + " overdue" : ""));
      }
      case "local-admins": {
        if (!ctx.collected) return set("unknown", "No inventory collected yet");
        if (!trackAdmins()) return set("na", "Administrator change tracking disabled");
        const cur = asArr(ctx.admins).map(String).slice().sort();
        if (!ctx.prev || !Array.isArray(ctx.prev.admins)) return set("pass", cur.length + " administrator(s); baseline established");
        const before = asArr(ctx.prev.admins).map(String).slice().sort();
        const added = cur.filter((x) => before.indexOf(x) === -1);
        const removed = before.filter((x) => cur.indexOf(x) === -1);
        if (added.length || removed.length) {
          return set("fail", [added.length ? "added: " + added.join(", ") : "", removed.length ? "removed: " + removed.join(", ") : ""].filter(Boolean).join("; "));
        }
        return set("pass", cur.length + " administrator(s) unchanged");
      }
      case "service-state": {
        const name = low(asObj(check.params).serviceName);
        if (!name) return set("na", "No service name configured");
        const svc = asArr(sections.services).find((s) => low(asObj(s).name) === name || low(asObj(s).displayName) === name);
        if (!svc) return set("warn", "Service not found: " + name);
        return low(asObj(svc).state) === "running" ? set("pass", name + " running") : set("fail", name + " is " + low(asObj(svc).state));
      }
      case "field-value": {
        const p = asObj(check.params);
        const actual = getPath(sections, p.path);
        const ok = cmp(p.op, actual, p.value);
        if (ok == null) return set("unknown", (p.path || "value") + " not reported");
        return ok ? set("pass", (p.path || "value") + " " + (p.op || "") + " " + p.value)
          : set("fail", (p.path || "value") + " is " + JSON.stringify(actual) + (p.op ? " (expected " + p.op + " " + p.value + ")" : ""));
      }
      default: return set("na", "Unknown check kind");
    }
  };

  function countStates(findings) {
    const out = { pass: 0, fail: 0, warn: 0, na: 0, unknown: 0 };
    asArr(findings).forEach((f) => { out[f.state] = (out[f.state] || 0) + 1; });
    return out;
  }
  SEC.countStates = countStates;
  SEC.postureState = (counts) => {
    counts = asObj(counts);
    if (num(counts.fail, 0)) return "fail";
    if (num(counts.warn, 0)) return "warn";
    if (num(counts.pass, 0)) return "pass";
    return "unknown";
  };
  function scoreOf(counts) {
    counts = asObj(counts);
    const denom = num(counts.pass, 0) + num(counts.fail, 0) + num(counts.warn, 0);
    return denom ? Math.round((num(counts.pass, 0) / denom) * 100) : null;
  }
  SEC.scoreOf = scoreOf;

  /* ═══════════════════════ device evaluation (Task 34) ═══════════════════════ */

  async function snapshotSections(deviceId) {
    if (!INV || typeof INV.snapshot !== "function") return null;
    try { const snap = await INV.snapshot(deviceId); return asObj(asObj(snap).sections); } catch (e) { return null; }
  }

  async function contextFor(provider, dev) {
    const sections = await snapshotSections(dev.id);
    const st = stateOf(provider);
    const prev = asObj(asObj(st.posture)[String(dev.id)]);
    let patch = null;
    if (PA && typeof PA.complianceFor === "function") { try { patch = await PA.complianceFor(provider.id, dev.id); } catch (e) { patch = null; } }
    const admins = asArr(asObj(sections).users).filter((u) => asObj(u).admin).map((u) => S(asObj(u).name, 120)).filter(Boolean);
    return {
      provider, device: dev, sections: asObj(sections), security: asObj(asObj(sections).security),
      users: asArr(asObj(sections).users), admins, patch, prev, backup: asObj(asObj(sections).backup), collected: !!sections,
    };
  }

  function deviationSet(provider, deviceId) {
    const set = new Set();
    asArr(stateOf(provider).deviations).forEach((d) => { if (String(d.deviceId) === String(deviceId)) set.add(String(d.checkId)); });
    return set;
  }

  /* Evaluate a device against a set of checks (default: the catalogue's
     built-in check set), applying any accepted deviations. Pure of writes. */
  SEC.evaluateDevice = async function (provider, dev, opts) {
    opts = opts || {};
    const ctx = await contextFor(provider, dev);
    const ids = asArr(opts.checkIds).length ? asArr(opts.checkIds) : SEC.DEFAULT_CHECKS();
    const checks = ids.map((id) => SEC.check(id) || id).filter(Boolean);
    const deviations = deviationSet(provider, dev.id);
    const findings = checks.map((c) => {
      const f = SEC.evaluateCheck(c, ctx);
      if (deviations.has(String(f.checkId)) && (f.state === "fail" || f.state === "warn")) {
        f.accepted = true; f.originalState = f.state;
        f.state = "pass"; f.detail = (f.detail || "") + " — accepted deviation";
      }
      return f;
    });
    const counts = countStates(findings);
    return {
      deviceId: String(dev.id), hostname: dev.hostname || dev.displayName || String(dev.id),
      at: opts.at || now(), findings, counts, state: SEC.postureState(counts), score: scoreOf(counts),
      admins: ctx.admins, collected: ctx.collected, patch: ctx.patch, backup: ctx.backup, prev: ctx.prev,
    };
  };

  /* Compact snapshot of one device's posture, for the scan history. */
  function posturePoint(p) {
    return {
      deviceId: String(p.deviceId), hostname: p.hostname, state: p.state, score: p.score, counts: p.counts,
      failing: asArr(p.findings).filter((f) => f.state === "fail" && !f.accepted).map((f) => f.checkId),
      warning: asArr(p.findings).filter((f) => f.state === "warn" && !f.accepted).map((f) => f.checkId),
    };
  }

  function summarizePoints(points) {
    const out = { devices: points.length, pass: 0, warn: 0, fail: 0, unknown: 0, na: 0, failChecks: 0, worst: "" };
    points.forEach((p) => {
      out[p.state === "pass" ? "pass" : p.state === "warn" ? "warn" : p.state === "fail" ? "fail" : p.state === "na" ? "na" : "unknown"] += 1;
      out.failChecks += asArr(p.failing).length;
    });
    out.worst = out.fail ? "fail" : out.warn ? "warn" : out.pass ? "pass" : "unknown";
    return out;
  }
  SEC.summarizePoints = summarizePoints;

  /* Run a posture scan across the provider (or a device subset) and store
     the per-device posture plus a scan record. Optionally syncs alerts. */
  SEC.scan = async function (providerId, opts) {
    opts = opts || {};
    if (!scanEnabled() && !opts.force) return { error: "security_scan_disabled", message: "Security scanning is disabled." };
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const at = opts.at || now();
    const only = asArr(opts.deviceIds).length ? new Set(asArr(opts.deviceIds).map(String)) : null;
    const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived" && (!only || only.has(String(d.id))));
    const checkIds = asArr(opts.checkIds).length ? opts.checkIds : SEC.DEFAULT_CHECKS();
    const results = [];
    for (const dev of devices) results.push(await SEC.evaluateDevice(provider, dev, { checkIds, at }));
    const points = results.map(posturePoint);
    const rec = { id: rid("secscan"), kind: "posture", providerId, at, checkIds: checkIds.slice(), deviceCount: points.length, summary: summarizePoints(points), devices: points };
    const w = await writeState(providerId, (st) => {
      const posture = asObj(st.posture);
      results.forEach((r) => {
        posture[String(r.deviceId)] = {
          deviceId: String(r.deviceId), hostname: r.hostname, at, state: r.state, score: r.score,
          counts: r.counts, findings: r.findings, admins: r.admins, collected: r.collected,
        };
      });
      st.posture = posture;
      st.scans = asArr(st.scans).concat([rec]).slice(-scanHistory());
    });
    if (w && w.error) return w;
    if (opts.alerts !== false && alertEnabled()) {
      for (const r of results) { try { await syncPostureAlert(providerId, r, { provider }); } catch (e) {} }
    }
    await audit("security_scan", providerId, "Security posture scan across " + results.length + " device(s) — " + rec.summary.fail + " failing, " + rec.summary.warn + " warning.");
    return { ok: true, providerId, at, scanId: rec.id, devices: results.length, summary: rec.summary, results, points };
  };

  SEC.storedPosture = async function (providerId, deviceId) {
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const rec = asObj(asObj(stateOf(provider).posture)[String(deviceId)]);
    return rec.deviceId ? rec : { error: "no_posture", deviceId };
  };

  /* Freshly evaluate one device (never throws on missing inventory). */
  SEC.postureFor = async function (providerId, deviceId, opts) {
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "not_found", deviceId };
    return SEC.evaluateDevice(provider, dev, opts || {});
  };

  SEC.scans = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let list = asArr(stateOf(provider).scans);
    if (opts.kind) list = list.filter((s) => s.kind === opts.kind);
    list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return opts.limit ? list.slice(0, opts.limit) : list;
  };

  /* Per-device posture rows — the table everything else rolls up. Uses the
     last stored scan, recomputing a device that has never been scanned. */
  SEC.postureRows = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const stored = asObj(stateOf(provider).posture);
    const rows = [];
    for (const dev of asArr(provider.devices).map(D.normalizeDevice)) {
      let p = asObj(stored[String(dev.id)]);
      if (!p.deviceId || opts.live) { if (opts.live) p = await SEC.evaluateDevice(provider, dev, {}); }
      const findings = asArr(p.findings);
      rows.push({
        deviceId: String(dev.id), hostname: dev.hostname || dev.displayName || String(dev.id),
        siteId: dev.siteId || null, siteName: siteNameOf(provider, dev.siteId),
        groupIds: asArr(dev.groupIds), groupNames: groupNamesOf(provider, dev.groupIds),
        osFamily: low(asObj(dev.os).family), role: dev.role, status: dev.status,
        at: p.at || "", state: p.state || "unknown", score: p.score == null ? null : p.score,
        counts: asObj(p.counts), collected: !!p.collected,
        failing: findings.filter((f) => f.state === "fail" && !f.accepted),
        warning: findings.filter((f) => f.state === "warn" && !f.accepted),
        accepted: findings.filter((f) => f.accepted),
        failCount: findings.filter((f) => f.state === "fail" && !f.accepted).length,
        warnCount: findings.filter((f) => f.state === "warn" && !f.accepted).length,
      });
    }
    return finishRows(providerId, provider, rows, opts, summarizePoints(storedPoints(stored)));
  };

  function storedPoints(stored) { return Object.keys(asObj(stored)).map((k) => { const p = asObj(stored[k]); return { state: p.state, counts: p.counts, failing: asArr(p.findings).filter((f) => f.state === "fail" && !f.accepted).map((f) => f.checkId) }; }); }

  function finishRows(providerId, provider, rows, opts, summary) {
    let out = rows;
    if (opts.state) out = out.filter((r) => r.state === opts.state);
    if (opts.siteId) out = out.filter((r) => String(r.siteId) === String(opts.siteId));
    if (opts.groupId) out = out.filter((r) => asArr(r.groupIds).map(String).indexOf(String(opts.groupId)) !== -1);
    if (opts.osFamily) out = out.filter((r) => low(r.osFamily) === low(opts.osFamily));
    if (opts.q) { const q = low(opts.q); out = out.filter((r) => [r.hostname, r.siteName, r.osFamily, asArr(r.groupNames).join(" ")].some((x) => low(x).indexOf(q) !== -1)); }
    const rank = { fail: 3, warn: 2, unknown: 1, pass: 0 };
    out.sort((a, b) => ((rank[b.state] || 0) - (rank[a.state] || 0)) || ((a.score == null ? 101 : a.score) - (b.score == null ? 101 : b.score)) || String(a.hostname).localeCompare(String(b.hostname)));
    return { providerId, providerName: provider.name, rows: out, summary: summary || summarizeRows(out) };
  }

  function summarizeRows(rows) {
    const out = { devices: rows.length, pass: 0, warn: 0, fail: 0, unknown: 0, failChecks: 0, worst: "" };
    rows.forEach((r) => {
      out[r.state === "pass" ? "pass" : r.state === "warn" ? "warn" : r.state === "fail" ? "fail" : "unknown"] += 1;
      out.failChecks += num(r.failCount, 0);
    });
    out.worst = out.fail ? "fail" : out.warn ? "warn" : out.pass ? "pass" : "unknown";
    return out;
  }
  SEC.summarizeRows = summarizeRows;

  SEC.rollup = async function (providerId, opts) {
    opts = opts || {};
    const by = opts.by || "group";
    const dr = await SEC.postureRows(providerId, opts);
    if (dr.error) return dr;
    const buckets = new Map();
    const add = (key, label, r) => {
      const k = String(key == null ? "none" : key);
      let b = buckets.get(k);
      if (!b) { b = { key: k, label: label || k, devices: 0, pass: 0, warn: 0, fail: 0, unknown: 0, failChecks: 0 }; buckets.set(k, b); }
      b.devices += 1;
      b[r.state === "pass" ? "pass" : r.state === "warn" ? "warn" : r.state === "fail" ? "fail" : "unknown"] += 1;
      b.failChecks += num(r.failCount, 0);
    };
    dr.rows.forEach((r) => {
      if (by === "site") return add(r.siteId, r.siteName || "Unassigned", r);
      if (by === "os") return add(r.osFamily || "unknown", r.osFamily || "unknown", r);
      if (by === "role") return add(r.role || "unknown", r.role || "unknown", r);
      if (by === "provider") return add("provider", dr.providerName, r);
      const ids = asArr(r.groupIds).length ? asArr(r.groupIds) : ["none"];
      ids.forEach((gid) => add(gid, (asArr(r.groupNames)[asArr(r.groupIds).map(String).indexOf(String(gid))] || gid), r));
    });
    const rows = [...buckets.values()].sort((a, b) => b.failChecks - a.failChecks || b.fail - a.fail || String(a.label).localeCompare(String(b.label)));
    return { providerId, by, rows, summary: dr.summary };
  };

  function siteNameOf(provider, id) { const s = asArr(provider.sites).find((x) => String(x.id) === String(id)); return s ? (s.name || id) : ""; }
  function groupNamesOf(provider, ids) {
    const groups = asArr(provider.deviceGroups);
    return asArr(ids).map((id) => { const g = groups.find((x) => String(x.id) === String(id)); return g ? (g.name || id) : id; });
  }
  SEC.siteNameOf = siteNameOf;
  SEC.groupNamesOf = groupNamesOf;

  /* ═══════════════════════ posture alerts (Task 34) ═══════════════════════ */

  async function syncPostureAlert(providerId, posture, opts) {
    if (!AL) return null;
    const provider = asObj(opts).provider || await providerOf(providerId);
    const key = "security-posture|" + posture.deviceId;
    const active = asArr(asObj(provider).alerts).find((a) => String(a.dedupeKey) === key && AL.ACTIVE.indexOf(a.state) !== -1);
    const failing = asArr(posture.findings).filter((f) => f.state === "fail" && !f.accepted);
    if (!failing.length) { if (active) return AL.autoClear(providerId, active.id, { at: posture.at }); return null; }
    const ranks = { "sev-emergency": 40, "sev-critical": 30, "sev-warning": 20, "sev-info": 10 };
    const maxRank = failing.reduce((m, f) => Math.max(m, ranks[f.severityId] || 20), 0);
    const sevId = maxRank >= 30 ? "sev-critical" : "sev-warning";
    return AL.fire(providerId, {
      monitorId: "mon-security-posture", monitorName: "Security posture", monitorType: "security",
      deviceId: posture.deviceId, severityId: sevId, severityRank: maxRank, state: "warning",
      subject: "Security posture", dedupeKey: key, at: posture.at,
      message: failing.length + " baseline check(s) failing: " + failing.slice(0, 4).map((f) => f.label).join("; "),
    }, { provider, silent: true });
  }
  SEC.syncPostureAlert = syncPostureAlert;

  /* ═══════════════════════ baselines & drift (Task 35) ═══════════════════════ */

  SEC.normalizeBaseline = function (raw) {
    raw = asObj(raw);
    const t = asObj(raw.targets);
    const checks = asArr(raw.checks).map(String).filter((id) => !!SEC.check(id));
    return {
      kind: "securitybaseline", id: raw.id || T.newId("secbase"),
      name: S(raw.name || "Untitled baseline", 200), description: S(raw.description, 600),
      enabled: raw.enabled !== false, priority: num(raw.priority, 0), siteId: raw.siteId ? String(raw.siteId) : null,
      targets: { groupIds: asArr(t.groupIds).map(String), tags: asArr(t.tags).map(String), deviceIds: asArr(t.deviceIds).map(String), siteIds: asArr(t.siteIds).map(String) },
      checks: checks.length ? uniq(checks) : SEC.DEFAULT_CHECKS(),
      severityId: raw.severityId || "sev-warning", remediationRuleId: raw.remediationRuleId ? String(raw.remediationRuleId) : null,
      createdAt: raw.createdAt || now(), updatedAt: now(),
    };
  };

  SEC.validateBaseline = function (b) {
    const errors = [];
    if (!b || !b.name) errors.push("A name is required.");
    asArr(asObj(b).checks).forEach((id) => { if (!SEC.check(id)) errors.push("Unknown check: " + id); });
    return { valid: errors.length === 0, errors };
  };
  SEC.baselines = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let list = asArr(stateOf(provider).baselines).map(SEC.normalizeBaseline);
    if (!opts.includeDisabled) list = list.filter((b) => b.enabled !== false);
    return list.sort((a, b) => num(b.priority, 0) - num(a.priority, 0) || String(a.name).localeCompare(String(b.name)));
  };
  SEC.getBaseline = async function (providerId, id) {
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const rec = asArr(stateOf(provider).baselines).find((b) => String(b.id) === String(id));
    return rec ? { baseline: SEC.normalizeBaseline(rec) } : { error: "not_found", id };
  };

  async function saveBaselines(providerId, fn) {
    return writeState(providerId, (st) => { st.baselines = fn(asArr(st.baselines).map(SEC.normalizeBaseline)); });
  }
  SEC.addBaseline = async function (providerId, data) {
    const b = SEC.normalizeBaseline(data);
    const v = SEC.validateBaseline(b);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const w = await writeState(providerId, (st) => { st.baselines = asArr(st.baselines).concat([b]); });
    if (w && w.error) return w;
    await audit("security_baseline_add", b.id, "Created compliance baseline \"" + b.name + "\".");
    return { baseline: b };
  };
  SEC.updateBaseline = async function (providerId, id, patch) {
    let saved = null;
    const w = await writeState(providerId, (st) => {
      st.baselines = asArr(st.baselines).map((raw) => {
        if (String(raw.id) !== String(id)) return SEC.normalizeBaseline(raw);
        saved = SEC.normalizeBaseline(Object.assign({}, SEC.normalizeBaseline(raw), asObj(patch), { id: raw.id, createdAt: raw.createdAt, updatedAt: now() }));
        return saved;
      });
    });
    if (w && w.error) return w;
    if (!saved) return { error: "not_found", id };
    const v = SEC.validateBaseline(saved);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    await audit("security_baseline_update", id, "Updated compliance baseline \"" + saved.name + "\".");
    return { baseline: saved };
  };
  SEC.removeBaseline = async function (providerId, id) {
    const w = await writeState(providerId, (st) => { st.baselines = asArr(st.baselines).map(SEC.normalizeBaseline).filter((b) => String(b.id) !== String(id)); });
    if (w && w.error) return w;
    await audit("security_baseline_remove", id, "Removed a compliance baseline.");
    return { removed: String(id) };
  };

  /* Baseline precedence: higher priority wins, then the stronger target
     specificity, then the more recently updated, then the id (stable). */
  SEC.effectiveBaseline = function (provider, dev, opts) {
    opts = opts || {};
    const cands = [];
    asArr(stateOf(provider).baselines).map(SEC.normalizeBaseline).filter((b) => b.enabled !== false).forEach((b) => {
      if (b.siteId && String(dev.siteId) !== String(b.siteId)) return;
      const m = G ? G.matchTargets(provider, b.targets, dev, opts.ctx || { provider }) : { match: false };
      if (!m.match) return;
      cands.push({ baseline: b, specificity: num(m.specificity, 0), matchedBy: m.matchedBy });
    });
    cands.sort((a, b) =>
      (num(b.baseline.priority, 0) - num(a.baseline.priority, 0)) ||
      (b.specificity - a.specificity) ||
      (num(msOf(b.baseline.updatedAt), 0) - num(msOf(a.baseline.updatedAt), 0)) ||
      String(a.baseline.id).localeCompare(String(b.baseline.id)));
    return cands.length ? cands[0] : null;
  };
  SEC.baselinesFor = function (provider, dev, opts) {
    const cands = [];
    asArr(stateOf(provider).baselines).map(SEC.normalizeBaseline).filter((b) => b.enabled !== false).forEach((b) => {
      if (b.siteId && String(dev.siteId) !== String(b.siteId)) return;
      const m = G ? G.matchTargets(provider, b.targets, dev, opts && opts.ctx) : { match: false };
      if (!m.match) return;
      cands.push({ baseline: b, specificity: num(m.specificity, 0), matchedBy: m.matchedBy });
    });
    cands.sort((a, b) => (num(b.baseline.priority, 0) - num(a.baseline.priority, 0)) || (b.specificity - a.specificity));
    return cands;
  };
  SEC.requiredChecks = function (provider, dev, opts) {
    const eff = SEC.effectiveBaseline(provider, dev, opts);
    return eff ? eff.baseline.checks : SEC.DEFAULT_CHECKS();
  };

  async function driftForDevice(provider, dev, opts) {
    opts = opts || {};
    const eff = opts.baseline ? { baseline: SEC.normalizeBaseline(opts.baseline), specificity: 0, matchedBy: "override" } : SEC.effectiveBaseline(provider, dev, opts);
    const required = opts.checkIds && asArr(opts.checkIds).length ? asArr(opts.checkIds) : (eff ? eff.baseline.checks : SEC.DEFAULT_CHECKS());
    const posture = await SEC.evaluateDevice(provider, dev, { checkIds: required, at: opts.at });
    const failing = posture.findings.filter((f) => f.state === "fail");
    const warning = posture.findings.filter((f) => f.state === "warn");
    const unknown = posture.findings.filter((f) => f.state === "unknown");
    return {
      deviceId: String(dev.id), hostname: posture.hostname, at: posture.at,
      baseline: eff ? { id: eff.baseline.id, name: eff.baseline.name, priority: eff.baseline.priority, severityId: eff.baseline.severityId } : null,
      appliedBy: eff ? eff.matchedBy : null, unbaselined: !eff, required,
      findings: posture.findings, failing, warning, unknown,
      counts: posture.counts, state: posture.state, score: posture.score,
      compliant: failing.length === 0, collected: posture.collected,
      remediationRuleId: eff ? eff.baseline.remediationRuleId : null,
    };
  }
  SEC.driftForDevice = driftForDevice;

  SEC.driftFor = async function (providerId, deviceId, opts) {
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "not_found", deviceId };
    return driftForDevice(provider, dev, opts || {});
  };

  function driftPoint(d) {
    return {
      deviceId: d.deviceId, hostname: d.hostname, state: d.compliant ? "pass" : "fail",
      score: d.score, counts: d.counts, baselineId: d.baseline ? d.baseline.id : null,
      failing: asArr(d.failing).map((f) => f.checkId), warning: asArr(d.warning).map((f) => f.checkId),
    };
  }

  /* Provider-wide compliance: every device against its effective baseline,
     with the exact failing checks. */
  SEC.compliance = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const at = opts.at || now();
    const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
    const rows = [];
    for (const dev of devices) rows.push(await driftForDevice(provider, dev, { at }));
    const summary = { devices: rows.length, compliant: 0, nonCompliant: 0, unbaselined: 0, failingChecks: 0, worst: "" };
    rows.forEach((r) => {
      if (r.compliant) summary.compliant += 1; else summary.nonCompliant += 1;
      if (r.unbaselined) summary.unbaselined += 1;
      summary.failingChecks += asArr(r.failing).length;
    });
    summary.worst = summary.nonCompliant ? "fail" : summary.compliant ? "pass" : "unknown";
    const rank = { fail: 2, unknown: 1, pass: 0 };
    rows.sort((a, b) => ((rank[(b.compliant ? "pass" : "fail")] || 0) - (rank[(a.compliant ? "pass" : "fail")] || 0)) || (asArr(b.failing).length - asArr(a.failing).length) || String(a.hostname).localeCompare(String(b.hostname)));
    if (opts.record !== false) {
      const points = rows.map(driftPoint);
      const rec = { id: rid("secdrift"), kind: "drift", providerId, at, deviceCount: points.length, summary: { devices: summary.devices, pass: summary.compliant, warn: 0, fail: summary.nonCompliant, unknown: 0, na: 0, failChecks: summary.failingChecks }, devices: points };
      await writeState(providerId, (st) => { st.scans = asArr(st.scans).concat([rec]).slice(-Math.max(scanHistory(), driftHistory())); });
    }
    return { providerId, providerName: provider.name, at, rows, summary };
  };

  SEC.driftHistory = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    const points = [];
    asArr(stateOf(provider).scans).forEach((s) => {
      if (opts.kind && s.kind !== opts.kind) return;
      const d = asArr(s.devices).find((x) => String(x.deviceId) === String(deviceId));
      if (d) points.push({ at: s.at, kind: s.kind, state: d.state, score: d.score == null ? null : d.score, failing: asArr(d.failing), warning: asArr(d.warning), baselineId: d.baselineId || null });
    });
    points.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return opts.limit ? points.slice(0, opts.limit) : points;
  };

  /* ── accepted deviations ── */

  SEC.deviations = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let list = asArr(stateOf(provider).deviations);
    if (opts.deviceId) list = list.filter((d) => String(d.deviceId) === String(opts.deviceId));
    return list.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  };
  SEC.acceptDeviation = async function (providerId, input) {
    input = asObj(input);
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(input.deviceId));
    if (!dev) return { error: "not_found", deviceId: input.deviceId };
    if (!SEC.check(input.checkId)) return { error: "unknown_check", checkId: input.checkId };
    const at = input.at || now();
    const rec = {
      kind: "securitydeviation", id: input.id || rid("secdev"), providerId, deviceId: String(dev.id),
      hostname: dev.hostname || dev.displayName || String(dev.id), checkId: String(input.checkId),
      baselineId: input.baselineId ? String(input.baselineId) : null, note: S(input.note, 400),
      by: input.by || actor(), at, createdAt: at,
    };
    await writeState(providerId, (st) => {
      const list = asArr(st.deviations).filter((d) => !(String(d.deviceId) === String(rec.deviceId) && String(d.checkId) === String(rec.checkId)));
      list.push(rec); st.deviations = list;
    });
    await auditDevice("security_deviation", rec.deviceId, "Accepted deviation for check \"" + SEC.checkLabel(rec.checkId) + "\"" + (rec.note ? " — " + rec.note : "") + ".");
    return { deviation: rec };
  };
  SEC.clearDeviation = async function (providerId, deviationId) {
    let removed = null;
    await writeState(providerId, (st) => {
      st.deviations = asArr(st.deviations).filter((d) => { if (String(d.id) === String(deviationId)) { removed = d; return false; } return true; });
    });
    if (!removed) return { error: "not_found", deviationId };
    await auditDevice("security_deviation_clear", removed.deviceId, "Cleared the accepted deviation for \"" + SEC.checkLabel(removed.checkId) + "\".");
    return { removed: String(deviationId) };
  };

  /* ── remediation through the automation engine ── */

  SEC.remediationOptions = async function (providerId, deviceId) {
    if (!AUTO) return [];
    const provider = await providerOf(providerId);
    const dev = provider ? asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId)) : null;
    const eff = provider && dev ? SEC.effectiveBaseline(provider, dev, {}) : null;
    const preferred = eff && eff.baseline.remediationRuleId ? String(eff.baseline.remediationRuleId) : null;
    return asArr(provider && provider.automationRules)
      .filter((r) => asObj(asObj(r).trigger).type === "compliance.drift")
      .map((r) => ({
        ruleId: String(r.id), name: S(r.name, 160), enabled: r.enabled !== false,
        destructive: asArr(r.actions).some((a) => AUTO.isDestructive(a.type)),
        requiresApproval: !!r.requireApproval, preferred: preferred === String(r.id),
      }));
  };

  SEC.remediate = async function (providerId, deviceId, opts) {
    opts = opts || {};
    if (!AUTO) return { error: "automation_unavailable", message: "The automation engine is unavailable." };
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "not_found", deviceId };
    const drift = await driftForDevice(provider, dev, { at: opts.at });
    let ruleId = opts.ruleId ? String(opts.ruleId) : drift.remediationRuleId;
    if (!ruleId) return { error: "no_remediation_rule", message: "No remediation rule is configured for this device's baseline." };
    const rule = asArr(provider.automationRules).find((r) => String(r.id) === ruleId);
    if (!rule) return { error: "rule_not_found", ruleId };
    if (!drift.failing.length && !opts.force) return { skipped: true, reason: "compliant", deviceId: String(deviceId) };
    const at = opts.at || now();
    const event = {
      type: "compliance.drift", at, deviceId: String(deviceId),
      checkIds: asArr(opts.checkIds).length ? asArr(opts.checkIds) : drift.failing.map((f) => f.checkId),
      baselineId: drift.baseline ? drift.baseline.id : null,
      severityId: opts.severityId || (drift.baseline && drift.baseline.severityId) || "sev-warning",
    };
    const r = await AUTO.run(providerId, ruleId, { event, dryRun: !!opts.dryRun, approved: !!opts.approved, actor: opts.actor || actor() });
    if (r && !r.error && !r.skipped) {
      await auditDevice("security_remediate", deviceId, "Ran remediation rule \"" + (rule.name || ruleId) + "\" for " + drift.failing.length + " failing check(s).");
    }
    return Object.assign({ ruleId, deviceId: String(deviceId), failing: drift.failing.map((f) => f.checkId) }, r || {});
  };

  /* ═══════════════════════ backup verification (Task 36) ═══════════════════════ */

  SEC.BACKUP_PRODUCTS = [
    { id: "veeam", label: "Veeam" },
    { id: "windows-backup", label: "Windows Server Backup" },
    { id: "acronis", label: "Acronis Cyber Protect" },
    { id: "backup-exec", label: "Veritas Backup Exec" },
    { id: "datto", label: "Datto SIRIS / Alto" },
    { id: "msp360", label: "MSP360 Backup" },
    { id: "restic", label: "restic" },
    { id: "rsync", label: "rsync / rsnapshot" },
    { id: "timemachine", label: "macOS Time Machine" },
    { id: "azure-backup", label: "Azure Backup" },
    { id: "other", label: "Other" },
  ];
  SEC.productLabel = (id) => { const p = SEC.BACKUP_PRODUCTS.find((x) => x.id === id); return p ? p.label : (id || "—"); };
  SEC.JOB_STATES = ["success", "failed", "warning", "running", "no-run"];
  SEC.JOB_STATE_LABEL = { success: "Success", failed: "Failed", warning: "Warning", running: "Running", "no-run": "No run" };
  SEC.BACKUP_STATES = ["ok", "warning", "failed", "missed", "running", "never", "not-configured", "unknown"];
  SEC.BACKUP_STATE_LABEL = { ok: "OK", warning: "Warning", failed: "Failed", missed: "Missed", running: "Running", never: "Never backed up", "not-configured": "Not configured", unknown: "Unknown" };
  SEC.backupTone = (s) => (s === "ok" ? "success" : s === "failed" || s === "missed" ? "danger" : s === "warning" || s === "never" ? "warn" : "muted");
  SEC.backupLabel = (s) => SEC.BACKUP_STATE_LABEL[s] || s || "—";

  SEC.normalizeBackupExpectation = function (raw) {
    raw = asObj(raw);
    const t = asObj(raw.targets);
    return {
      kind: "backupexpectation", id: raw.id || T.newId("bkexp"),
      name: S(raw.name || "Untitled backup expectation", 200), description: S(raw.description, 600),
      enabled: raw.enabled !== false, priority: num(raw.priority, 0), siteId: raw.siteId ? String(raw.siteId) : null,
      targets: { groupIds: asArr(t.groupIds).map(String), tags: asArr(t.tags).map(String), deviceIds: asArr(t.deviceIds).map(String), siteIds: asArr(t.siteIds).map(String) },
      productId: raw.productId || "other", frequency: raw.frequency || "daily",
      maxAgeHours: Math.max(1, num(raw.maxAgeHours, defaultMaxAgeHours())), graceHours: Math.max(0, num(raw.graceHours, defaultGraceHours())),
      severityId: raw.severityId || "sev-warning", required: raw.required !== false,
      recoveryDays: Math.max(1, num(raw.recoveryDays, recoveryDays())),
      createdAt: raw.createdAt || now(), updatedAt: now(),
    };
  };
  SEC.validateExpectation = function (e) {
    const errors = [];
    if (!e || !e.name) errors.push("A name is required.");
    if (e && !SEC.BACKUP_PRODUCTS.some((p) => p.id === e.productId)) errors.push("Unknown backup product: " + e.productId);
    if (e && !(num(e.maxAgeHours, 0) >= 1)) errors.push("Max age must be at least one hour.");
    return { valid: errors.length === 0, errors };
  };

  SEC.expectations = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let list = asArr(stateOf(provider).backupExpectations).map(SEC.normalizeBackupExpectation);
    if (!opts.includeDisabled) list = list.filter((e) => e.enabled !== false);
    return list.sort((a, b) => num(b.priority, 0) - num(a.priority, 0) || String(a.name).localeCompare(String(b.name)));
  };
  SEC.getExpectation = async function (providerId, id) {
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const rec = asArr(stateOf(provider).backupExpectations).find((e) => String(e.id) === String(id));
    return rec ? { expectation: SEC.normalizeBackupExpectation(rec) } : { error: "not_found", id };
  };
  SEC.addExpectation = async function (providerId, data) {
    const e = SEC.normalizeBackupExpectation(data);
    const v = SEC.validateExpectation(e);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    await writeState(providerId, (st) => { st.backupExpectations = asArr(st.backupExpectations).concat([e]); });
    await audit("backup_expectation_add", e.id, "Created backup expectation \"" + e.name + "\".");
    return { expectation: e };
  };
  SEC.updateExpectation = async function (providerId, id, patch) {
    let saved = null;
    await writeState(providerId, (st) => {
      st.backupExpectations = asArr(st.backupExpectations).map((raw) => {
        if (String(raw.id) !== String(id)) return SEC.normalizeBackupExpectation(raw);
        saved = SEC.normalizeBackupExpectation(Object.assign({}, SEC.normalizeBackupExpectation(raw), asObj(patch), { id: raw.id, createdAt: raw.createdAt, updatedAt: now() }));
        return saved;
      });
    });
    if (!saved) return { error: "not_found", id };
    const v = SEC.validateExpectation(saved);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    await audit("backup_expectation_update", id, "Updated backup expectation \"" + saved.name + "\".");
    return { expectation: saved };
  };
  SEC.removeExpectation = async function (providerId, id) {
    await writeState(providerId, (st) => { st.backupExpectations = asArr(st.backupExpectations).map(SEC.normalizeBackupExpectation).filter((e) => String(e.id) !== String(id)); });
    await audit("backup_expectation_remove", id, "Removed a backup expectation.");
    return { removed: String(id) };
  };
  SEC.effectiveExpectation = function (provider, dev, opts) {
    const cands = [];
    asArr(stateOf(provider).backupExpectations).map(SEC.normalizeBackupExpectation).filter((e) => e.enabled !== false).forEach((e) => {
      if (e.siteId && String(dev.siteId) !== String(e.siteId)) return;
      const m = G ? G.matchTargets(provider, e.targets, dev, (opts && opts.ctx) || { provider }) : { match: false };
      if (!m.match) return;
      cands.push({ expectation: e, specificity: num(m.specificity, 0), matchedBy: m.matchedBy });
    });
    cands.sort((a, b) => (num(b.expectation.priority, 0) - num(a.expectation.priority, 0)) || (b.specificity - a.specificity) || String(a.expectation.id).localeCompare(String(b.expectation.id)));
    return cands.length ? cands[0] : null;
  };

  /* ── backup jobs ── */

  SEC.normalizeBackupJob = function (raw) {
    raw = asObj(raw);
    const st = low(raw.status);
    const status = SEC.JOB_STATES.indexOf(st) !== -1 ? st : (st === "ok" ? "success" : st === "error" ? "failed" : "no-run");
    return {
      kind: "backupjob", id: raw.id || rid("bkjob"), deviceId: raw.deviceId ? String(raw.deviceId) : null,
      hostname: S(raw.hostname, 200), productId: raw.productId || "other", jobName: S(raw.jobName || raw.name, 200),
      status, at: raw.at || now(), lastSuccessAt: raw.lastSuccessAt || "", detail: S(raw.detail || raw.message, 400),
      sizeBytes: Math.max(0, num(raw.sizeBytes, 0)), durationSeconds: Math.max(0, num(raw.durationSeconds, 0)),
      source: raw.source || "report",
    };
  };

  async function syncBackupAlert(providerId, state, opts) {
    if (!AL) return null;
    const provider = asObj(opts).provider || await providerOf(providerId);
    const key = "backup-verify|" + state.deviceId;
    const active = asArr(asObj(provider).alerts).find((a) => String(a.dedupeKey) === key && AL.ACTIVE.indexOf(a.state) !== -1);
    const good = state.status === "ok" || (!state.expected && (state.status === "not-configured" || state.status === "unknown"));
    if (good) { if (active) return AL.autoClear(providerId, active.id, { at: state.at }); return null; }
    const serious = state.status === "failed" || state.status === "missed";
    const msg = state.status === "missed"
      ? "No successful backup for " + Math.round(num(state.ageHours, 0)) + "h (expected every " + state.maxAgeHours + "h)."
      : state.status === "never" ? "No successful backup has ever been recorded."
        : state.status === "failed" ? "The last backup failed: " + (state.lastResult || "unknown error")
          : "Backup status is " + SEC.backupLabel(state.status) + ".";
    return AL.fire(providerId, {
      monitorId: "mon-backup-verification", monitorName: "Backup verification", monitorType: "backup",
      deviceId: state.deviceId, severityId: serious ? "sev-critical" : "sev-warning", severityRank: serious ? 30 : 20,
      state: "warning", subject: "Backup verification", dedupeKey: key, at: state.at, message: msg,
    }, { provider, silent: true });
  }
  SEC.syncBackupAlert = syncBackupAlert;

  async function computeBackupState(provider, dev, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const st = stateOf(provider);
    const eff = opts.expectation ? { expectation: SEC.normalizeBackupExpectation(opts.expectation) } : SEC.effectiveExpectation(provider, dev, opts);
    const expectation = eff ? eff.expectation : null;
    const jobs = asArr(st.backupJobs).filter((j) => String(j.deviceId) === String(dev.id)).map(SEC.normalizeBackupJob).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const sections = opts.sections !== undefined ? asObj(opts.sections) : await snapshotSections(dev.id);
    const inventory = asObj(asObj(sections).backup);
    const last = jobs[0] || null;
    let lastRunAt = last ? last.at : (inventory.lastRunAt || "");
    let lastResult = last ? (last.detail || SEC.JOB_STATE_LABEL[last.status]) : (inventory.lastResult || "");
    let lastSuccessAt = (jobs.find((j) => j.status === "success") || {}).at || "";
    if (!lastSuccessAt && low(inventory.status) === "ok") lastSuccessAt = inventory.lastRunAt || "";
    const maxAgeHours = expectation ? expectation.maxAgeHours : defaultMaxAgeHours();
    const graceHours = expectation ? expectation.graceHours : defaultGraceHours();
    const ageHours = lastSuccessAt ? (num(msOf(at), Date.now()) - num(msOf(lastSuccessAt), 0)) / HOUR : null;
    const dueAt = lastSuccessAt ? iso(num(msOf(lastSuccessAt), 0) + maxAgeHours * HOUR) : (lastRunAt ? iso(num(msOf(lastRunAt), 0) + maxAgeHours * HOUR) : "");
    let status = "unknown";
    if (last && last.status === "running") status = "running";
    else if (last && last.status === "failed") status = "failed";
    else if (!expectation) {
      /* Without an expectation there is no cadence to miss; report only
         what the last run (or the inventory) actually said. */
      if (last) status = last.status === "success" ? "ok" : "warning";
      else if (low(inventory.status) === "not-configured") status = "not-configured";
      else if (low(inventory.status) === "failed" || low(inventory.status) === "warning") status = "failed";
      else if (lastRunAt) status = "ok";
      else status = "never";
    }
    else if (!lastRunAt && low(inventory.status) === "not-configured") status = "not-configured";
    else if (!lastSuccessAt) status = lastRunAt ? (last && last.status === "success" ? "ok" : "failed") : (low(inventory.status) === "not-configured" ? "not-configured" : "never");
    else if (ageHours != null && ageHours > maxAgeHours + graceHours) status = "missed";
    else if (ageHours != null && ageHours > maxAgeHours) status = "warning";
    else if (low(inventory.status) === "warning") status = "warning";
    else status = "ok";
    return {
      deviceId: String(dev.id), hostname: dev.hostname || dev.displayName || String(dev.id), at,
      status, expected: !!expectation && expectation.required !== false,
      expectationId: expectation ? expectation.id : null, expectationName: expectation ? expectation.name : "",
      productId: (last && last.productId) || (expectation && expectation.productId) || inventory.provider || "other",
      maxAgeHours, graceHours, lastRunAt, lastSuccessAt, lastResult, ageHours, dueAt,
      jobCount: jobs.length, source: last ? "report" : (inventory.lastRunAt ? "inventory" : "none"),
    };
  }
  SEC.computeBackupState = computeBackupState;

  /* Ingest the backup section of every device's inventory as a job (also
   used to reconcile a device that reports through its agent). */
  SEC.ingestBackups = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const at = opts.at || now();
    const existing = asArr(stateOf(provider).backupJobs);
    const seen = new Set(existing.map((j) => String(j.deviceId) + "|" + S(j.lastRunAtHint || j.at, 40) + "|" + S(j.detail, 60)));
    const fresh = [];
    for (const dev of asArr(provider.devices).map(D.normalizeDevice)) {
      const sections = await snapshotSections(dev.id);
      const bk = asObj(asObj(sections).backup);
      if (!bk || !bk.lastRunAt) continue;
      const key = String(dev.id) + "|" + String(bk.lastRunAt) + "|" + S(bk.lastResult, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(SEC.normalizeBackupJob({
        deviceId: dev.id, hostname: dev.hostname || dev.displayName, productId: SEC.productIdFor(bk.provider),
        jobName: "Inventory-reported backup", status: bk.status, at: bk.lastRunAt, detail: bk.lastResult, source: "inventory",
      }));
    }
    if (fresh.length) {
      await writeState(providerId, (st) => { st.backupJobs = asArr(st.backupJobs).concat(fresh).slice(-backupJobHistory()); });
    }
    return { ok: true, ingested: fresh.length, jobs: fresh.map((j) => ({ deviceId: j.deviceId, status: j.status, at: j.at, productId: j.productId })) };
  };

  SEC.productIdFor = function (name) {
    const n = low(name);
    const hit = SEC.BACKUP_PRODUCTS.find((p) => n && (n.indexOf(p.id) !== -1 || n.indexOf(low(p.label)) !== -1));
    return hit ? hit.id : (n ? "other" : "other");
  };

  /* Record a backup result (from a product integration or a manual report). */
  SEC.reportBackup = async function (providerId, input) {
    input = asObj(input);
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(input.deviceId));
    if (!dev) return { error: "not_found", deviceId: input.deviceId };
    const job = SEC.normalizeBackupJob(Object.assign({}, input, { deviceId: dev.id, hostname: dev.hostname || dev.displayName, source: input.source || "report" }));
    const state = await computeBackupState(provider, dev, { at: input.at, sections: await snapshotSections(dev.id) });
    job.lastSuccessAt = state.lastSuccessAt;
    await writeState(providerId, (st) => {
      st.backupJobs = asArr(st.backupJobs).concat([job]).slice(-backupJobHistory());
      st.backupState = Object.assign(asObj(st.backupState), { [String(dev.id)]: Object.assign({}, state, { lastJobId: job.id }) });
    });
    const nextState = await computeBackupState(await providerOf(providerId), dev, { at: input.at });
    await writeState(providerId, (st) => { st.backupState = Object.assign(asObj(st.backupState), { [String(dev.id)]: nextState }); });
    if (input.alerts !== false && backupAlertEnabled()) { try { await syncBackupAlert(providerId, nextState, { provider: await providerOf(providerId) }); } catch (e) {} }
    await auditDevice("backup_report", dev.id, "Recorded a backup job (" + job.status + ") from " + SEC.productLabel(job.productId) + ".");
    return { job, state: nextState };
  };

  SEC.backupJobs = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let jobs = asArr(stateOf(provider).backupJobs).map(SEC.normalizeBackupJob);
    if (opts.deviceId) jobs = jobs.filter((j) => String(j.deviceId) === String(opts.deviceId));
    jobs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return opts.limit ? jobs.slice(0, opts.limit) : jobs;
  };

  /* Per-device backup state, computed live from jobs + inventory. */
  SEC.backupRows = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const stored = asObj(stateOf(provider).backupState);
    const rows = [];
    for (const dev of asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived")) {
      let st = asObj(stored[String(dev.id)]);
      st = await computeBackupState(provider, dev, { at: opts.at });
      st.siteId = dev.siteId || null; st.siteName = siteNameOf(provider, dev.siteId);
      st.groupIds = asArr(dev.groupIds); st.groupNames = groupNamesOf(provider, dev.groupIds);
      st.osFamily = low(asObj(dev.os).family); st.role = dev.role; st.status2 = dev.status;
      rows.push(st);
    }
    let out = rows;
    if (opts.state) out = out.filter((r) => r.status === opts.state);
    if (opts.siteId) out = out.filter((r) => String(r.siteId) === String(opts.siteId));
    if (opts.groupId) out = out.filter((r) => asArr(r.groupIds).map(String).indexOf(String(opts.groupId)) !== -1);
    if (opts.q) { const q = low(opts.q); out = out.filter((r) => [r.hostname, r.siteName, r.productId, r.expectationName].some((x) => low(x).indexOf(q) !== -1)); }
    const rank = { failed: 6, missed: 5, never: 4, warning: 3, running: 2, unknown: 1, "not-configured": 0, ok: -1 };
    out.sort((a, b) => ((rank[b.status] == null ? 1 : rank[b.status]) - (rank[a.status] == null ? 1 : rank[a.status])) || (num(b.ageHours, -1) - num(a.ageHours, -1)) || String(a.hostname).localeCompare(String(b.hostname)));
    const summary = { devices: out.length, ok: 0, warning: 0, failed: 0, missed: 0, never: 0, running: 0, "not-configured": 0, unknown: 0 };
    out.forEach((r) => { summary[r.status] = (summary[r.status] || 0) + 1; });
    return { providerId, providerName: provider.name, rows: out, summary };
  };

  SEC.scanBackups = async function (providerId, opts) {
    opts = opts || {};
    if (!backupEnabled() && !opts.force) return { error: "backup_disabled", message: "Backup monitoring is disabled." };
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const at = opts.at || now();
    const rows = [];
    for (const dev of asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived")) {
      rows.push(await computeBackupState(provider, dev, { at }));
    }
    await writeState(providerId, (st) => {
      const map = asObj(st.backupState);
      rows.forEach((r) => { map[String(r.deviceId)] = r; });
      st.backupState = map;
    });
    if (opts.alerts !== false && backupAlertEnabled()) {
      for (const r of rows) { try { await syncBackupAlert(providerId, r, { provider }); } catch (e) {} }
    }
    const summary = { devices: rows.length, ok: 0, warning: 0, failed: 0, missed: 0, never: 0, running: 0, "not-configured": 0, unknown: 0 };
    rows.forEach((r) => { summary[r.status] = (summary[r.status] || 0) + 1; });
    await audit("backup_scan", providerId, "Backup verification across " + rows.length + " device(s) — " + (summary.failed + summary.missed) + " failing/missed.");
    return { ok: true, providerId, at, rows, summary };
  };

  /* ── recovery tests ── */

  SEC.recoveryTests = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let list = asArr(stateOf(provider).recoveryTests).map((t) => Object.assign({}, t, { overdue: t.status === "due" && t.dueAt && num(msOf(t.dueAt), 0) < Date.now() }));
    if (opts.deviceId) list = list.filter((t) => String(t.deviceId) === String(opts.deviceId));
    if (opts.status) list = list.filter((t) => t.status === opts.status || (opts.status === "overdue" && t.overdue));
    return list.slice().sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
  };
  SEC.recoveryDue = async function (providerId, opts) {
    const list = await SEC.recoveryTests(providerId, { status: "due" });
    return list.filter((t) => !t.confirmedAt);
  };

  async function ensureRecoveryRun(providerId, opts) {
    opts = opts || {};
    if (!recoveryEnabled() && !opts.force) return { skipped: true, reason: "recovery_tests_disabled" };
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const at = opts.at || now();
    const existing = asArr(stateOf(provider).recoveryTests);
    const created = [];
    for (const dev of asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived")) {
      const eff = SEC.effectiveExpectation(provider, dev, {});
      if (!eff) continue;
      const days = eff.expectation.recoveryDays || recoveryDays();
      const mine = existing.filter((t) => String(t.deviceId) === String(dev.id));
      const lastConfirmed = mine.filter((t) => t.status === "confirmed").sort((a, b) => String(b.confirmedAt || "").localeCompare(String(a.confirmedAt || "")))[0];
      const openDue = mine.find((t) => t.status === "due");
      if (openDue) continue;
      if (lastConfirmed && (num(msOf(at), Date.now()) - num(msOf(lastConfirmed.confirmedAt), 0)) < days * DAY) continue;
      created.push({
        kind: "recoverytest", id: rid("rectest"), providerId, deviceId: String(dev.id),
        hostname: dev.hostname || dev.displayName || String(dev.id), expectationId: eff.expectation.id,
        status: "due", requestedAt: at, dueAt: iso(num(msOf(at), Date.now()) + 7 * DAY), confirmedAt: "", confirmedBy: "", result: "", note: "", createdAt: at, updatedAt: at,
      });
    }
    if (created.length) {
      await writeState(providerId, (st) => { st.recoveryTests = asArr(st.recoveryTests).concat(created).slice(-driftHistory()); });
      await audit("recovery_test_request", providerId, "Requested " + created.length + " recovery test confirmation(s).");
    }
    return { created: created.length, tests: created };
  }
  SEC.ensureRecoveryTests = (providerId, opts) => ensureRecoveryRun(providerId, opts);

  SEC.requestRecoveryTest = async function (providerId, input) {
    input = asObj(input);
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(input.deviceId));
    if (!dev) return { error: "not_found", deviceId: input.deviceId };
    const at = input.at || now();
    const eff = SEC.effectiveExpectation(provider, dev, {});
    const rec = {
      kind: "recoverytest", id: rid("rectest"), providerId, deviceId: String(dev.id),
      hostname: dev.hostname || dev.displayName || String(dev.id), expectationId: eff ? eff.expectation.id : null,
      status: "due", requestedAt: at, dueAt: input.dueAt || iso(num(msOf(at), Date.now()) + 7 * DAY),
      confirmedAt: "", confirmedBy: "", result: "", note: S(input.note, 400), createdAt: at, updatedAt: at,
    };
    await writeState(providerId, (st) => { st.recoveryTests = asArr(st.recoveryTests).concat([rec]); });
    await auditDevice("recovery_test_request", dev.id, "Requested a recovery-test confirmation.");
    return { test: rec };
  };

  SEC.confirmRecoveryTest = async function (providerId, testId, input) {
    input = asObj(input);
    const provider = await providerOf(providerId);
    if (!provider) return { error: "not_found", providerId };
    const at = input.at || now();
    let saved = null;
    await writeState(providerId, (st) => {
      st.recoveryTests = asArr(st.recoveryTests).map((t) => {
        if (String(t.id) !== String(testId)) return t;
        saved = Object.assign({}, t, { status: "confirmed", confirmedAt: at, confirmedBy: input.by || actor(), result: S(input.result || "pass", 60), note: S(input.note || t.note, 400), updatedAt: at });
        return saved;
      });
    });
    if (!saved) return { error: "not_found", testId };
    await auditDevice("recovery_test", saved.deviceId, "Confirmed a recovery test (" + saved.result + ") for \"" + (saved.hostname || saved.deviceId) + "\".");
    return { test: saved };
  };

  /* ═══════════════════════ device drill-down ═══════════════════════ */

  SEC.deviceSection = async function (dev, providerId) {
    const ui = ERP.ui, esc = ui.esc;
    if (!dev) return "";
    const provider = await providerOf(providerId);
    if (!provider) return "";
    const posture = await SEC.evaluateDevice(provider, dev, {});
    const drift = await SEC.driftForDevice(provider, dev, {});
    const backup = await computeBackupState(provider, dev, {});
    const badge = (s) => ui.badge(SEC.stateLabel(s), SEC.stateTone(s));
    const rows = asArr(posture.findings).map((f) => ({
      check: "<b>" + esc(f.label) + "</b>", cat: '<span class="erp-sub">' + esc(SEC.categoryLabel(f.category)) + "</span>",
      state: badge(f.state) + (f.accepted ? " " + ui.badge("accepted", "info") : ""),
      detail: '<span class="erp-sub">' + esc(f.detail || "—") + "</span>",
    }));
    const table = rows.length ? ui.table([
      { key: "check", label: "Check", render: (r) => r.check },
      { key: "cat", label: "Category", render: (r) => r.cat },
      { key: "state", label: "Result", render: (r) => r.state },
      { key: "detail", label: "Detail", render: (r) => r.detail },
    ], rows, { scroll: true }) : '<p class="erp-sub">No checks to evaluate.</p>';
    const devPoints = await SEC.driftHistory(providerId, dev.id, { limit: 5 });
    const hist = devPoints.length ? ui.table([
      { key: "at", label: "When", render: (r) => '<span class="erp-sub">' + esc(ui.dateTime(r.at)) + "</span>" },
      { key: "kind", label: "Run", render: (r) => esc(r.kind) },
      { key: "state", label: "Result", render: (r) => badge(r.state) },
      { key: "failing", label: "Failing", render: (r) => asArr(r.failing).length ? asArr(r.failing).map((c) => ui.badge(SEC.checkLabel(c), "danger")).join(" ") : "—" },
    ], devPoints) : "";
    const devRecovery = (await SEC.recoveryTests(providerId, { deviceId: dev.id })).slice(0, 3);
    return '<h4 class="rmm-section-title">Security posture</h4>' +
      '<div class="rmm-status-line">' + badge(posture.state) + (posture.score == null ? "" : " " + ui.badge(posture.score + "% score", "muted")) + " " + ui.badge(drift.unbaselined ? "no baseline — default checks" : "baseline: " + (drift.baseline.name || "—"), drift.compliant ? "success" : "warn") + "</div>" +
      (posture.collected ? "" : '<p class="erp-sub">No inventory has been collected for this device yet.</p>') +
      table +
      '<h5 class="rmm-section-title">Backup verification</h5>' +
      ui.table([
        { key: "l", label: "Expected", render: () => esc(backup.expectationName || (backup.expected ? "—" : "not configured")) },
        { key: "p", label: "Product", render: () => esc(SEC.productLabel(backup.productId)) },
        { key: "s", label: "Status", render: () => ui.badge(SEC.backupLabel(backup.status), SEC.backupTone(backup.status)) },
        { key: "last", label: "Last success", render: () => backup.lastSuccessAt ? esc(ui.dateTime(backup.lastSuccessAt)) : '<span class="erp-sub">never</span>' },
        { key: "age", label: "Age", render: () => backup.ageHours == null ? "—" : Math.round(backup.ageHours) + "h / " + backup.maxAgeHours + "h" },
      ], [backup]) +
      (devRecovery.length ? '<h5 class="rmm-section-title">Recovery tests</h5>' + ui.table([
        { key: "due", label: "Due", render: (r) => esc(r.dueAt ? ui.dateTime(r.dueAt) : "—") },
        { key: "s", label: "Status", render: (r) => ui.badge(r.overdue ? "overdue" : r.status, r.status === "confirmed" ? "success" : r.overdue ? "danger" : "warn") },
        { key: "by", label: "Confirmed by", render: (r) => esc(r.confirmedBy || "—") },
      ], devRecovery) : "") +
      (hist ? '<h5 class="rmm-section-title">Recent drift</h5>' + hist : "");
  };

  /* ═══════════════════════ console (Tasks 34–36) ═══════════════════════ */

  SEC.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});
    const state = { tab: "posture", posture: null, compliance: null, backups: null, recovery: null, q: "", stateFilter: "" };

    async function load() { return (await providerOf(opts.providerId)) || opts.provider || {}; }

    async function compute() {
      state.provider = await load();
      state.baselines = await SEC.baselines(opts.providerId, { includeDisabled: true });
      state.expectations = await SEC.expectations(opts.providerId, { includeDisabled: true });
      state.posture = await SEC.postureRows(opts.providerId, { q: state.q, state: state.stateFilter });
      state.compliance = await SEC.compliance(opts.providerId, { record: false });
      state.backups = await SEC.backupRows(opts.providerId, {});
      state.recovery = await SEC.recoveryTests(opts.providerId, {});
      return state.provider;
    }

    function badge(s) { return ui.badge(SEC.stateLabel(s), SEC.stateTone(s)); }
    function backupBadge(s) { return ui.badge(SEC.backupLabel(s), SEC.backupTone(s)); }

    function statCards() {
      const ps = asObj(state.posture).summary || {};
      const cs = asObj(state.compliance).summary || {};
      const bs = asObj(state.backups).summary || {};
      const due = asArr(state.recovery).filter((t) => t.status === "due").length;
      return ui.grid([
        ui.statCard({ label: "Devices scanned", value: String(num(ps.devices, 0)), sub: num(ps.pass, 0) + " passing" }),
        ui.statCard({ label: "Posture failures", value: String(num(ps.fail, 0)), tone: num(ps.fail, 0) ? "danger" : "muted", sub: num(ps.failChecks, 0) + " failing check(s)" }),
        ui.statCard({ label: "Non-compliant", value: String(num(cs.nonCompliant, 0)), tone: num(cs.nonCompliant, 0) ? "warn" : "muted", sub: num(cs.devices, 0) + " device(s)" }),
        ui.statCard({ label: "Backup problems", value: String(num(bs.failed, 0) + num(bs.missed, 0)), tone: (num(bs.failed, 0) + num(bs.missed, 0)) ? "danger" : "muted", sub: num(bs.never, 0) + " never backed up" }),
        ui.statCard({ label: "Recovery due", value: String(due), tone: due ? "warn" : "muted", sub: asArr(state.recovery).length + " test(s)" }),
        ui.statCard({ label: "Baselines", value: String(asArr(state.baselines).length), sub: asArr(state.expectations).length + " backup expectation(s)" }),
      ], "rmm-tri-metrics");
    }

    function postureTab() {
      const rows = asArr(asObj(state.posture).rows).map((r) => ({
        device: "<b>" + esc(r.hostname) + "</b>" + (r.siteName ? '<div class="erp-sub">' + esc(r.siteName) + "</div>" : ""),
        os: esc(r.osFamily || "—"),
        groups: asArr(r.groupNames).map((g) => ui.badge(g, "muted")).join(" ") || '<span class="erp-sub">—</span>',
        state: badge(r.state),
        score: r.score == null ? "—" : r.score + "%",
        failing: asArr(r.failing).length ? asArr(r.failing).map((f) => ui.badge(SEC.checkLabel(f.checkId), "danger")).join(" ") : '<span class="erp-sub">none</span>',
        at: '<span class="erp-sub">' + esc(r.at ? ui.dateTime(r.at) : "never") + "</span>",
        actions: ui.btn("View", { small: true, act: "sec-dev-view", arg: r.deviceId }),
      }));
      const filter = '<div class="erp-inline-form rmm-patch-filters">' +
        '<div class="field" style="flex:1 1 200px"><label>Search</label><input type="text" name="sec_q" value="' + esc(state.q) + '" placeholder="device, site, group…"></div>' +
        '<div class="field"><label>State</label><select name="sec_state"><option value="">All</option>' + SEC.STATES.map((s) => '<option value="' + s + '"' + (state.stateFilter === s ? " selected" : "") + ">" + esc(SEC.stateLabel(s)) + "</option>").join("") + "</select></div>" +
        "</div>";
      return filter + ui.card("Device posture (" + rows.length + ")", ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "os", label: "OS", render: (r) => r.os },
        { key: "groups", label: "Groups", render: (r) => r.groups },
        { key: "state", label: "Posture", render: (r) => r.state },
        { key: "score", label: "Score", render: (r) => r.score },
        { key: "failing", label: "Failing checks", render: (r) => r.failing },
        { key: "at", label: "Last scan", render: (r) => r.at },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No devices enrolled yet." }), { actions: ui.btn("Run posture scan", { small: true, primary: true, act: "sec-scan" }) });
    }

    function baselineTab() {
      const rows = asArr(state.baselines).map((b) => ({
        name: "<b>" + esc(b.name) + "</b>" + (b.description ? '<div class="erp-sub">' + esc(b.description) + "</div>" : ""),
        priority: esc(String(b.priority)),
        targets: esc(G && G.targetSummary ? G.targetSummary(state.provider, b.targets) : ""),
        checks: asArr(b.checks).length ? ui.badge(String(asArr(b.checks).length) + " checks", "info") : '<span class="erp-sub">default</span>',
        remediate: b.remediationRuleId ? ui.badge(b.remediationRuleId, "muted") : '<span class="erp-sub">—</span>',
        state: b.enabled ? ui.badge("enabled", "success") : ui.badge("disabled", "muted"),
        actions: ui.btn("Edit", { small: true, act: "sec-base-edit", arg: b.id }) + " " +
          ui.btn(b.enabled ? "Disable" : "Enable", { small: true, act: "sec-base-toggle", arg: b.id }) + " " +
          ui.btn("Delete", { small: true, danger: true, act: "sec-base-del", arg: b.id }),
      }));
      const crow = asObj(state.compliance).rows || [];
      const compTable = ui.table([
        { key: "device", label: "Device", render: (r) => "<b>" + esc(r.hostname) + "</b>" },
        { key: "baseline", label: "Baseline", render: (r) => r.unbaselined ? ui.badge("default checks", "muted") : esc((r.baseline || {}).name || "—") },
        { key: "state", label: "Compliance", render: (r) => (r.compliant ? ui.badge("compliant", "success") : ui.badge("drift", "danger")) + (r.appliedBy ? ' <span class="erp-sub">by ' + esc(r.appliedBy) + "</span>" : "") },
        { key: "failing", label: "Failing checks", render: (r) => asArr(r.failing).length ? asArr(r.failing).map((f) => ui.badge(f.label, "danger")).join(" ") : '<span class="erp-sub">none</span>' },
        { key: "actions", label: "", render: (r) => ui.btn("Remediate", { small: true, act: "sec-remediate", arg: r.deviceId }) + " " + ui.btn("Accept…", { small: true, act: "sec-dev-view", arg: r.deviceId }) },
      ], crow.map((r) => ({ deviceId: r.deviceId, hostname: r.hostname, baseline: r.baseline, unbaselined: r.unbaselined, compliant: r.compliant, appliedBy: r.appliedBy, failing: r.failing })), { scroll: true, emptyText: "No devices." });
      return ui.card("Compliance baselines (" + rows.length + ")", ui.table([
        { key: "name", label: "Baseline", render: (r) => r.name },
        { key: "priority", label: "Priority", render: (r) => r.priority },
        { key: "targets", label: "Applies to", render: (r) => r.targets },
        { key: "checks", label: "Checks", render: (r) => r.checks },
        { key: "remediate", label: "Remediates with", render: (r) => r.remediate },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No baselines yet — every device falls back to the built-in check set." }), { actions: ui.btn("New baseline", { small: true, primary: true, act: "sec-base-new" }) }) +
        ui.card("Compliance & drift (" + crow.length + ")", compTable, { actions: ui.btn("Recompute drift", { small: true, act: "sec-drift" }) });
    }

    function backupTab() {
      const rows = asArr(asObj(state.backups).rows).map((r) => ({
        device: "<b>" + esc(r.hostname) + "</b>" + (r.siteName ? '<div class="erp-sub">' + esc(r.siteName) + "</div>" : ""),
        expected: esc(r.expectationName || (r.expected ? "—" : "not configured")),
        product: esc(SEC.productLabel(r.productId)),
        state: backupBadge(r.status),
        last: r.lastSuccessAt ? esc(ui.dateTime(r.lastSuccessAt)) : '<span class="erp-sub">never</span>',
        age: r.ageHours == null ? "—" : Math.round(num(r.ageHours, 0)) + "h / " + num(r.maxAgeHours, 0) + "h",
        due: r.dueAt ? esc(ui.dateTime(r.dueAt)) : "—",
        actions: ui.btn("Report", { small: true, act: "sec-backup-report", arg: r.deviceId }),
      }));
      const exRows = asArr(state.expectations).map((e) => ({
        name: "<b>" + esc(e.name) + "</b>" + (e.description ? '<div class="erp-sub">' + esc(e.description) + "</div>" : ""),
        product: esc(SEC.productLabel(e.productId)),
        every: esc(e.frequency) + " · " + num(e.maxAgeHours, 0) + "h (+" + num(e.graceHours, 0) + "h grace)",
        targets: esc(G && G.targetSummary ? G.targetSummary(state.provider, e.targets) : ""),
        recover: num(e.recoveryDays, 0) + "d",
        state: e.enabled ? ui.badge("enabled", "success") : ui.badge("disabled", "muted"),
        actions: ui.btn("Edit", { small: true, act: "sec-exp-edit", arg: e.id }) + " " +
          ui.btn(e.enabled ? "Disable" : "Enable", { small: true, act: "sec-exp-toggle", arg: e.id }) + " " +
          ui.btn("Delete", { small: true, danger: true, act: "sec-exp-del", arg: e.id }),
      }));
      const recRows = asArr(state.recovery).map((t) => ({
        device: "<b>" + esc(t.hostname) + "</b>",
        due: esc(t.dueAt ? ui.dateTime(t.dueAt) : "—"),
        state: ui.badge(t.overdue ? "overdue" : t.status, t.status === "confirmed" ? "success" : t.overdue ? "danger" : "warn"),
        by: esc(t.confirmedBy || "—"), result: esc(t.result || "—"),
        actions: t.status === "confirmed" ? "" : ui.btn("Confirm…", { small: true, act: "sec-recovery-confirm", arg: t.id }),
      }));
      return ui.card("Backup verification (" + rows.length + ")", ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "expected", label: "Expectation", render: (r) => r.expected },
        { key: "product", label: "Product", render: (r) => r.product },
        { key: "state", label: "Status", render: (r) => r.state },
        { key: "last", label: "Last success", render: (r) => r.last },
        { key: "age", label: "Age / max", render: (r) => r.age },
        { key: "due", label: "Next due", render: (r) => r.due },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No devices enrolled yet." }), { actions: ui.btn("Recheck", { small: true, primary: true, act: "sec-backup-scan" }) + " " + ui.btn("Import from inventory", { small: true, act: "sec-backup-ingest" }) }) +
        ui.card("Backup expectations (" + exRows.length + ")", ui.table([
          { key: "name", label: "Expectation", render: (r) => r.name },
          { key: "product", label: "Product", render: (r) => r.product },
          { key: "every", label: "Cadence", render: (r) => r.every },
          { key: "targets", label: "Applies to", render: (r) => r.targets },
          { key: "recover", label: "Recovery test", render: (r) => r.recover },
          { key: "state", label: "State", render: (r) => r.state },
          { key: "actions", label: "", render: (r) => r.actions },
        ], exRows, { scroll: true, emptyText: "No backup expectations yet." }), { actions: ui.btn("New expectation", { small: true, primary: true, act: "sec-exp-new" }) }) +
        ui.card("Recovery tests (" + recRows.length + ")", ui.table([
          { key: "device", label: "Device", render: (r) => r.device },
          { key: "due", label: "Due", render: (r) => r.due },
          { key: "state", label: "Status", render: (r) => r.state },
          { key: "by", label: "Confirmed by", render: (r) => r.by },
          { key: "result", label: "Result", render: (r) => r.result },
          { key: "actions", label: "", render: (r) => r.actions },
        ], recRows, { scroll: true, emptyText: "No recovery tests outstanding." }), { actions: ui.btn("Request due tests", { small: true, act: "sec-recovery-due" }) });
    }

    async function panelFor(tab) {
      if (tab === "baselines") return baselineTab();
      if (tab === "backup") return backupTab();
      return postureTab();
    }

    function tabBadge(n) {
      n = num(n, 0);
      return n > 0 ? n : null;
    }

    async function paint() {
      await compute();
      const tabs = ui.tabs([
        { id: "posture", label: "Security posture", badge: tabBadge(asObj(asObj(state.posture).summary).fail) },
        { id: "baselines", label: "Baselines & drift", badge: tabBadge(asObj(asObj(state.compliance).summary).nonCompliant) },
        { id: "backup", label: "Backup verification", badge: tabBadge(num(asObj(asObj(state.backups).summary).failed, 0) + num(asObj(asObj(state.backups).summary).missed, 0)) },
      ], state.tab);
      const picker = asArr(opts.providers).length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="sec_pid">' + asArr(opts.providers).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === opts.providerId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = '<div class="rmm-security-inner">' + tabs.html + picker + "</div>";
      const panelEl = host.querySelector('.erp-tab-panel[data-panel="' + state.tab + '"]');
      if (panelEl) panelEl.innerHTML = '<div class="rmm-security-body">' + statCards() + (await panelFor(state.tab)) + "</div>";
    }

    function splitCsv(v) { return String(v == null ? "" : v).split(",").map((s) => s.trim()).filter(Boolean); }

    let modalHandler = null;
    function bindModal(fn) {
      const m = document.querySelector("#uiModal");
      if (!m) return null;
      if (modalHandler) m.removeEventListener("click", modalHandler);
      modalHandler = typeof fn === "function" ? fn : null;
      if (modalHandler) m.addEventListener("click", modalHandler);
      return m;
    }
    function unbindModal() {
      const m = document.querySelector("#uiModal");
      if (m && modalHandler) m.removeEventListener("click", modalHandler);
      modalHandler = null;
    }

    function targetFields(prefix, targets) {
      targets = asObj(targets);
      return '<div class="rmm-patch-grid">' +
        ui.text(prefix + "_groupIds", "Groups (comma-separated ids)", asArr(targets.groupIds).join(", ")) +
        ui.text(prefix + "_tags", "Tags", asArr(targets.tags).join(", ")) +
        ui.text(prefix + "_siteIds", "Sites (ids)", asArr(targets.siteIds).join(", ")) +
        "</div>";
    }

    async function openBaselineEditor(id) {
      const isNew = id === "__new";
      const existing = isNew ? null : (await SEC.getBaseline(opts.providerId, id)).baseline;
      const draft = clone(existing || SEC.normalizeBaseline({ name: "", checks: [] }));
      const rules = AUTO ? asArr((await load()).automationRules).filter((r) => asObj(asObj(r).trigger).type === "compliance.drift") : [];
      const checkBoxes = SEC.CHECK_CATALOGUE.map((c) => '<label class="erp-check"><input type="checkbox" name="b_check_' + esc(c.id) + '"' + (draft.checks.indexOf(c.id) !== -1 ? " checked" : "") + "> " + esc(c.label) + ' <span class="erp-sub">(' + esc(SEC.categoryLabel(c.category)) + ")</span></label>").join("");
      const body = ui.form(
        ui.text("b_name", "Name", draft.name) +
        ui.textarea("b_desc", "Description", draft.description, 2) +
        '<div class="rmm-patch-grid">' +
        ui.number("b_priority", "Priority (higher wins)", draft.priority) +
        ui.select("b_severity", "Severity", (M ? await M.section("severities") : []).map((s) => ({ value: s.id, label: s.label || s.id })), draft.severityId) +
        ui.select("b_remediation", "Remediation rule", [{ value: "", label: "— none —" }].concat(rules.map((r) => ({ value: r.id, label: r.name }))), draft.remediationRuleId || "") +
        "</div>" +
        ui.text("b_site", "Restrict to site (optional id)", draft.siteId || "") +
        targetFields("b", draft.targets) +
        '<div class="field"><label>Required checks</label><div class="rmm-check-list">' + checkBoxes + "</div></div>",
        ui.btn("Save", { primary: true, act: "sec-base-save", arg: isNew ? "__new" : draft.id }) + " " + ui.btn("Cancel", { act: "sec-cancel" })
      );
      ui.modal({ title: isNew ? "New compliance baseline" : "Edit " + draft.name, size: "lg", body });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sec-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sec-base-save") {
          const c = ui.collect(m, ["b_name", "b_desc", "b_priority", "b_severity", "b_remediation", "b_site", "b_groupIds", "b_tags", "b_siteIds"]);
          const checks = SEC.CHECK_IDS.filter((cid) => { const el = m.querySelector('[name="b_check_' + cid + '"]'); return el && el.checked; });
          const patch = {
            name: c.b_name, description: c.b_desc, priority: c.b_priority, severityId: c.b_severity,
            remediationRuleId: c.b_remediation || null, siteId: c.b_site || null,
            targets: { groupIds: splitCsv(c.b_groupIds), tags: splitCsv(c.b_tags), siteIds: splitCsv(c.b_siteIds) }, checks,
          };
          const r = isNew ? await SEC.addBaseline(opts.providerId, patch) : await SEC.updateBaseline(opts.providerId, draft.id, patch);
          if (r.error) return toast("Failed: " + (r.errors ? r.errors.join("; ") : r.error), "error");
          unbindModal(); ui.closeModal(); toast("Baseline saved"); return paint();
        }
      });
    }

    async function openExpectationEditor(id) {
      const isNew = id === "__new";
      const existing = isNew ? null : (await SEC.getExpectation(opts.providerId, id)).expectation;
      const draft = clone(existing || SEC.normalizeBackupExpectation({ name: "", targets: {} }));
      const body = ui.form(
        ui.text("e_name", "Name", draft.name) +
        ui.textarea("e_desc", "Description", draft.description, 2) +
        '<div class="rmm-patch-grid">' +
        ui.select("e_product", "Backup product", SEC.BACKUP_PRODUCTS.map((p) => ({ value: p.id, label: p.label })), draft.productId) +
        ui.select("e_frequency", "Cadence", ["hourly", "daily", "weekly", "monthly"].map((f) => ({ value: f, label: f })), draft.frequency) +
        ui.number("e_maxAge", "Max hours since success", draft.maxAgeHours) +
        ui.number("e_grace", "Grace hours", draft.graceHours) +
        ui.number("e_priority", "Priority (higher wins)", draft.priority) +
        ui.select("e_severity", "Severity", (M ? await M.section("severities") : []).map((s) => ({ value: s.id, label: s.label || s.id })), draft.severityId) +
        ui.number("e_recovery", "Recovery test every (days)", draft.recoveryDays) +
        "</div>" +
        ui.check("e_required", "Required (a missing backup is a compliance failure)", draft.required) +
        ui.text("e_site", "Restrict to site (optional id)", draft.siteId || "") +
        targetFields("e", draft.targets),
        ui.btn("Save", { primary: true, act: "sec-exp-save", arg: isNew ? "__new" : draft.id }) + " " + ui.btn("Cancel", { act: "sec-cancel" })
      );
      ui.modal({ title: isNew ? "New backup expectation" : "Edit " + draft.name, size: "lg", body });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sec-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sec-exp-save") {
          const c = ui.collect(m, ["e_name", "e_desc", "e_product", "e_frequency", "e_maxAge", "e_grace", "e_priority", "e_severity", "e_recovery", "e_required", "e_site", "e_groupIds", "e_tags", "e_siteIds"]);
          const patch = {
            name: c.e_name, description: c.e_desc, productId: c.e_product, frequency: c.e_frequency,
            maxAgeHours: c.e_maxAge, graceHours: c.e_grace, priority: c.e_priority, severityId: c.e_severity,
            recoveryDays: c.e_recovery, required: c.e_required, siteId: c.e_site || null,
            targets: { groupIds: splitCsv(c.e_groupIds), tags: splitCsv(c.e_tags), siteIds: splitCsv(c.e_siteIds) },
          };
          const r = isNew ? await SEC.addExpectation(opts.providerId, patch) : await SEC.updateExpectation(opts.providerId, draft.id, patch);
          if (r.error) return toast("Failed: " + (r.errors ? r.errors.join("; ") : r.error), "error");
          unbindModal(); ui.closeModal(); toast("Expectation saved"); return paint();
        }
      });
    }

    async function openBackupReport(deviceId) {
      const provider = await load();
      const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
      const body = ui.form(
        ui.select("r_device", "Device", asArr(provider.devices).map(D.normalizeDevice).map((d) => ({ value: d.id, label: d.hostname || d.displayName || d.id })), deviceId) +
        '<div class="rmm-patch-grid">' +
        ui.select("r_product", "Product", SEC.BACKUP_PRODUCTS.map((p) => ({ value: p.id, label: p.label })), "other") +
        ui.select("r_status", "Result", SEC.JOB_STATES.map((s) => ({ value: s, label: SEC.JOB_STATE_LABEL[s] })), "success") +
        ui.text("r_job", "Job name", "") +
        ui.number("r_size", "Size (bytes)", 0) +
        "</div>" +
        ui.textarea("r_detail", "Detail / message", "", 2),
        ui.btn("Record", { primary: true, act: "sec-backup-save" }) + " " + ui.btn("Cancel", { act: "sec-cancel" })
      );
      ui.modal({ title: "Report a backup job", size: "lg", body: body + (dev ? "" : "") });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sec-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sec-backup-save") {
          const c = ui.collect(m, ["r_device", "r_product", "r_status", "r_job", "r_size", "r_detail"]);
          const r = await SEC.reportBackup(opts.providerId, { deviceId: c.r_device, productId: c.r_product, status: c.r_status, jobName: c.r_job, sizeBytes: c.r_size, detail: c.r_detail, at: now() });
          if (r.error) return toast("Failed: " + r.error, "error");
          unbindModal(); ui.closeModal(); toast("Backup recorded"); return paint();
        }
      });
    }

    async function openRemediate(deviceId) {
      const options = await SEC.remediationOptions(opts.providerId, deviceId);
      const drift = await SEC.driftFor(opts.providerId, deviceId, {});
      const list = asArr(drift.failing).map((f) => '<li>' + esc(f.label) + ' <span class="erp-sub">' + esc(f.detail || "") + "</span></li>").join("");
      const opts2 = options.filter((o) => o.enabled);
      const body = '<p class="erp-modal-note">' + (asArr(drift.failing).length ? "This device has " + asArr(drift.failing).length + " failing check(s):" : "This device is currently compliant.") + "</p>" +
        (list ? "<ul>" + list + "</ul>" : "") +
        (opts2.length
          ? ui.form(ui.select("rm_rule", "Remediation rule", opts2.map((o) => ({ value: o.ruleId, label: o.name + (o.preferred ? " (baseline default)" : "") + (o.destructive ? " · destructive" : "") })), (opts2.find((o) => o.preferred) || {}).ruleId || opts2[0].ruleId),
            ui.btn("Run", { primary: true, act: "sec-remediate-run", arg: deviceId }) + " " + ui.btn("Cancel", { act: "sec-cancel" }))
          : '<p class="erp-sub">No enabled automation rule uses the “Compliance drift” trigger. Create one on the Automations station.</p>');
      ui.modal({ title: "Remediate drift", body });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sec-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sec-remediate-run") {
          const c = ui.collect(m, ["rm_rule"]);
          const r = await SEC.remediate(opts.providerId, deviceId, { ruleId: c.rm_rule });
          if (r.error) return toast("Failed: " + (r.message || r.error), "error");
          if (r.pending) toast("Remediation is waiting for approval");
          unbindModal(); ui.closeModal(); toast("Remediation requested"); return paint();
        }
      });
    }

    async function openRecoveryConfirm(testId) {
      const body = ui.form(
        ui.select("rc_result", "Result", [{ value: "pass", label: "Passed" }, { value: "fail", label: "Failed" }, { value: "partial", label: "Partially restored" }], "pass") +
        ui.text("rc_note", "Note", ""),
        ui.btn("Confirm", { primary: true, act: "sec-recovery-save", arg: testId }) + " " + ui.btn("Cancel", { act: "sec-cancel" })
      );
      ui.modal({ title: "Confirm recovery test", body });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sec-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sec-recovery-save") {
          const c = ui.collect(m, ["rc_result", "rc_note"]);
          const r = await SEC.confirmRecoveryTest(opts.providerId, testId, { result: c.rc_result, note: c.rc_note });
          if (r.error) return toast("Failed: " + r.error, "error");
          unbindModal(); ui.closeModal(); toast("Recovery test recorded"); return paint();
        }
      });
    }

    async function openDevice(deviceId) {
      const provider = await load();
      const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
      if (!dev) return;
      const sec = await SEC.deviceSection(dev, opts.providerId);
      const deviations = await SEC.deviations(opts.providerId, { deviceId });
      const devTable = asArr(deviations).length ? ui.table([
        { key: "check", label: "Check", render: (r) => esc(SEC.checkLabel(r.checkId)) },
        { key: "note", label: "Note", render: (r) => esc(r.note || "—") },
        { key: "by", label: "By", render: (r) => esc(r.by || "—") },
        { key: "actions", label: "", render: (r) => ui.btn("Clear", { small: true, danger: true, act: "sec-dev-clear", arg: r.id + "|" + deviceId }) },
      ], deviations) : "";
      const drift = await SEC.driftFor(opts.providerId, deviceId, {});
      const acceptRows = asArr(drift.failing).map((f) => ({ label: f.label, id: f.checkId })).concat(asArr(drift.warning).map((f) => ({ label: f.label, id: f.checkId })));
      const acceptSel = acceptRows.length
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Accept a deviation</label><select name="sec_dev_check">' + acceptRows.map((r) => '<option value="' + esc(r.id) + '">' + esc(r.label) + "</option>").join("") + '</select></div><div class="field" style="flex:0 0 120px"><label>&nbsp;</label>' + ui.btn("Accept", { small: true, act: "sec-dev-accept", arg: deviceId }) + "</div></div>"
        : "";
      ui.modal({ title: "Security · " + (dev.hostname || dev.id), size: "lg", body: sec + (devTable ? '<h4 class="rmm-section-title">Accepted deviations</h4>' + devTable : "") + (acceptSel ? '<h4 class="rmm-section-title">Governance</h4>' + acceptSel : "") });
    }

    ui.bind(host, "change", "[name='sec_pid']", (t) => { opts.providerId = t.value; if (opts.onProvider) opts.onProvider(t.value); paint(); });
    ui.bind(host, "change", "[name='sec_state']", (t) => { state.stateFilter = t.value; paint(); });
    host.addEventListener("input", (e) => { const n = e.target && e.target.name; if (n === "sec_q") state.q = e.target.value; });
    host.addEventListener("keyup", (e) => { if (e.target && e.target.name === "sec_q" && e.key === "Enter") paint(); });
    ui.bind(host, "click", "[data-tab]", (t) => { const id = t.getAttribute("data-tab"); if (["posture", "baselines", "backup"].indexOf(id) !== -1) { state.tab = id; paint(); } });
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      e.preventDefault();
      if (act === "sec-scan") { const r = await SEC.scan(opts.providerId, {}); if (r.error) return toast("Failed: " + (r.message || r.error), "error"); toast("Scanned " + r.devices + " device(s) — " + r.summary.fail + " failing"); return paint(); }
      if (act === "sec-drift") { const r = await SEC.compliance(opts.providerId, {}); if (r.error) return toast("Failed: " + r.error, "error"); toast(r.summary.nonCompliant + " device(s) in drift"); return paint(); }
      if (act === "sec-dev-view") return openDevice(arg);
      if (act === "sec-dev-accept") {
        const sel = host.querySelector("[name='sec_dev_check']");
        const checkId = sel ? sel.value : "";
        if (!checkId) return toast("No failing check to accept", "error");
        const note = await ERP.ui.confirm({ title: "Accept deviation?", message: "This device will be treated as compliant for the selected check until the deviation is cleared.", okLabel: "Accept", primary: true });
        if (!note) return;
        const r = await SEC.acceptDeviation(opts.providerId, { deviceId: arg, checkId, note: "accepted from the Security console" });
        if (r.error) return toast("Failed: " + r.error, "error");
        toast("Deviation accepted"); return openDevice(arg);
      }
      if (act === "sec-dev-clear") { const parts = String(arg).split("|"); const r = await SEC.clearDeviation(opts.providerId, parts[0]); if (r.error) return toast("Failed: " + r.error, "error"); toast("Deviation cleared"); return openDevice(parts[1]); }
      if (act === "sec-base-new") return openBaselineEditor("__new");
      if (act === "sec-base-edit") return openBaselineEditor(arg);
      if (act === "sec-base-toggle") { const b = (await SEC.getBaseline(opts.providerId, arg)).baseline; const r = await SEC.updateBaseline(opts.providerId, arg, { enabled: !(b && b.enabled) }); if (r.error) return toast("Failed: " + r.error, "error"); toast("Updated"); return paint(); }
      if (act === "sec-base-del") { const ok = await ERP.ui.confirm({ title: "Delete baseline?", message: "Devices will fall back to their next matching baseline (or the default check set).", okLabel: "Delete", danger: true }); if (!ok) return; const r = await SEC.removeBaseline(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Deleted"); return paint(); }
      if (act === "sec-exp-new") return openExpectationEditor("__new");
      if (act === "sec-exp-edit") return openExpectationEditor(arg);
      if (act === "sec-exp-toggle") { const ex = (await SEC.getExpectation(opts.providerId, arg)).expectation; const r = await SEC.updateExpectation(opts.providerId, arg, { enabled: !(ex && ex.enabled) }); if (r.error) return toast("Failed: " + r.error, "error"); toast("Updated"); return paint(); }
      if (act === "sec-exp-del") { const ok = await ERP.ui.confirm({ title: "Delete expectation?", message: "Backup jobs already recorded are unaffected.", okLabel: "Delete", danger: true }); if (!ok) return; const r = await SEC.removeExpectation(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Deleted"); return paint(); }
      if (act === "sec-backup-scan") { const r = await SEC.scanBackups(opts.providerId, {}); if (r.error) return toast("Failed: " + (r.message || r.error), "error"); toast((r.summary.failed + r.summary.missed) + " backup problem(s)"); return paint(); }
      if (act === "sec-backup-ingest") { const r = await SEC.ingestBackups(opts.providerId, {}); if (r.error) return toast("Failed: " + r.error, "error"); toast(r.ingested + " job(s) imported"); return paint(); }
      if (act === "sec-backup-report") return openBackupReport(arg);
      if (act === "sec-remediate") return openRemediate(arg);
      if (act === "sec-recovery-confirm") return openRecoveryConfirm(arg);
      if (act === "sec-recovery-due") { const r = await SEC.ensureRecoveryTests(opts.providerId, {}); if (r.error) return toast("Failed: " + r.error, "error"); toast(r.created + " test(s) requested"); return paint(); }
    });

    await paint();
    SEC.currentProviderId = opts.providerId;
    return state;
  };

  SEC.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-security";
    host.appendChild(wrap);
    if (!providers.length) { wrap.innerHTML = ERP.ui.alert("No service providers yet.", "info"); return null; }
    const providerId = opts.providerId || providers[0].id;
    if (!opts.headHtml && !opts.embedded) wrap.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Security", "Endpoint security posture (AV/EDR, firewall, disk encryption, OS patch currency, local-admin changes), compliance baselines with drift detection and remediation through the automation engine, and backup-verification monitoring."));
    return SEC.renderPanel(wrap, { providerId, providers, embedded: true, toast: opts.toast || (() => {}), onChange: opts.onChange, onProvider: opts.onProvider });
  };

  SEC.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const pid = (SEC.currentProviderId && providers.some((p) => p.id === SEC.currentProviderId)) ? SEC.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-security";
    el.innerHTML = "";
    el.appendChild(root);
    root.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Security", "Endpoint security posture (AV/EDR, firewall, disk encryption, OS patch currency, local-admin changes), compliance baselines with drift detection and remediation through the automation engine, and backup-verification monitoring."));
    await SEC.renderPanel(root, { providerId: pid, providers, embedded: true, toast: ctx.toast, onChange: () => SEC.render(ctx) });
    return { pid };
  };

  /* ═══════════════════════ demo seed ═══════════════════════ */

  const DEMO_BASELINES = [
    {
      id: "secbase-demo-workstation", name: "Workstation hardening baseline", priority: 10, severityId: "sev-warning",
      description: "Minimum security posture for managed workstations.", targets: { groupIds: ["grp-demo-workstations"] },
      checks: ["av-present", "av-up-to-date", "av-realtime", "firewall-enabled", "disk-encryption", "secure-boot", "pending-reboot", "os-patch-currency", "local-admins"],
    },
    {
      id: "secbase-demo-server", name: "Server hardening baseline", priority: 20, severityId: "sev-critical",
      description: "Stricter posture for servers, including TPM.", targets: { groupIds: ["grp-demo-servers"] },
      checks: ["av-present", "av-up-to-date", "firewall-enabled", "disk-encryption", "secure-boot", "tpm", "pending-reboot", "os-patch-currency", "local-admins"],
    },
    {
      id: "secbase-demo-all", name: "Everyone: baseline", priority: 0, severityId: "sev-warning",
      description: "Provider-wide minimum applied to every managed device.", targets: {},
      checks: ["av-present", "firewall-enabled", "os-patch-currency", "local-admins"],
    },
  ];
  const DEMO_EXPECTATIONS = [
    { id: "bkexp-demo-server", name: "Nightly server backup", productId: "veeam", frequency: "daily", maxAgeHours: 26, graceHours: 4, recoveryDays: 90, severityId: "sev-critical", targets: { groupIds: ["grp-demo-servers"] } },
    { id: "bkexp-demo-workstation", name: "Daily workstation backup", productId: "windows-backup", frequency: "daily", maxAgeHours: 26, graceHours: 4, recoveryDays: 90, severityId: "sev-warning", targets: { groupIds: ["grp-demo-workstations"] } },
    { id: "bkexp-demo-all", name: "Everyone: at least weekly backup", productId: "other", frequency: "weekly", maxAgeHours: 192, graceHours: 12, recoveryDays: 120, severityId: "sev-warning", targets: {} },
  ];

  async function seedDemoRun(opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { skipped: true, reason: "security_disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    let g = await T.get(demo.id);
    let provider = g.error ? {} : g.provider;
    for (let i = 0; i < 16 && !asArr(provider.devices).length; i++) {
      await new Promise((res) => setTimeout(res, 300));
      g = await T.get(demo.id);
      if (!g.error) provider = g.provider;
    }
    const st = stateOf(provider);
    const baseIds = asArr(st.baselines).map((b) => String(b.id));
    const expIds = asArr(st.backupExpectations).map((e) => String(e.id));
    const needBase = DEMO_BASELINES.filter((b) => baseIds.indexOf(b.id) === -1);
    const needExp = DEMO_EXPECTATIONS.filter((e) => expIds.indexOf(e.id) === -1);
    if (!needBase.length && !needExp.length && !opts.force) return { skipped: true, reason: "security_demo_exists", providerId: demo.id };
    const at = now();
    const baselines = (opts.force ? DEMO_BASELINES : needBase).map((b) => SEC.normalizeBaseline(Object.assign({ enabled: true, createdAt: at, updatedAt: at }, b)));
    const expectations = (opts.force ? DEMO_EXPECTATIONS : needExp).map((e) => SEC.normalizeBackupExpectation(Object.assign({ enabled: true, required: true, createdAt: at, updatedAt: at }, e)));
    const r = await writeState(demo.id, (s) => {
      const byId = {};
      asArr(s.baselines).map(SEC.normalizeBaseline).forEach((b) => { byId[String(b.id)] = b; });
      baselines.forEach((b) => { byId[String(b.id)] = clone(b); });
      s.baselines = Object.keys(byId).map((k) => byId[k]);
      const byExp = {};
      asArr(s.backupExpectations).map(SEC.normalizeBackupExpectation).forEach((e) => { byExp[String(e.id)] = e; });
      expectations.forEach((e) => { byExp[String(e.id)] = clone(e); });
      s.backupExpectations = Object.keys(byExp).map((k) => byExp[k]);
    }, 6);
    if (r && r.error) return { error: "seed_write_failed", providerId: demo.id };
    SEC.__seeded = { providerId: demo.id, at, baselines: baselines.length, expectations: expectations.length };
    return { providerId: demo.id, baselines: baselines.length, expectations: expectations.length };
  }

  SEC.seedDemo = function (opts) {
    if (SEC.__seedPromise) return SEC.__seedPromise;
    SEC.__seedPromise = seedDemoRun(opts).catch((e) => {
      console.error("security seed failed", e);
      return { error: "seed_failed", message: String((e && e.message) || e) };
    });
    const clear = () => { SEC.__seedPromise = null; };
    SEC.__seedPromise.then(clear, clear);
    return SEC.__seedPromise;
  };

  /* ═══════════════════════ boot ═══════════════════════ */

  SEC.renderPanelInto = SEC.renderPanel;

  let readyResolve;
  SEC.ready = new Promise((res) => { readyResolve = res; });
  SEC.init = async function () { try { await T.ready; await SEC.seedDemo(); } catch (e) { console.error("security seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", SEC.init);
  else SEC.init();
})();
