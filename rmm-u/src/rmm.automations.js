/* ============================================================
   RMM-U — automation engine  (Phase 4 · Task 22)

   A rule is trigger → conditions → action, stored on the provider
   aggregate (`provider.automationRules`) and targeted the same way
   policies and monitors are (the shared `G.matchTargets` resolver:
   device > tag > group > site > provider-wide).

     triggers   alert.fired · alert.cleared · monitor.state ·
                device.online · device.offline · schedule · manual ·
                webhook
     conditions the exact same field/operator engine the dynamic
                groups use (`G.FIELDS` / `G.evaluateCondition`), so a
                rule can say "CPU cores > 8 AND tag prod"
     actions    run-script · run-library-script (Task 23) ·
                restart-service · reboot · deploy-patch · deploy-software ·
                send-notification (NOT) · tag-device · add/remove-from-group ·
                call-webhook · create-ticket

   Three things make it safe to run unattended:

   • DRY RUN — `AUTO.dryRun` resolves the targets, evaluates every
     condition and lays out the action plan without touching a single
     endpoint.
   • APPROVAL GATING — a rule whose plan includes a destructive
     action (reboot / restart-service / deploy-patch / deploy-software)
     and that is flagged `requireApproval` is parked as a
     `pending-approval` run until a human approves it.
   • MAINTENANCE DEFERRAL — a target inside a maintenance window that
     suppresses alerts has its non-essential actions deferred (recorded
     by `SCH`) instead of firing; `allowDuringMaintenance` opts out.

   Every run — including skipped and pending ones — is stored on the
   rule (bounded by `config.rmm.automationRunHistory`) and appended to
   the master audit log, so there is a full history and audit trail.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const store = ERP.store;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const G = ERP.groups || null;
  const J = ERP.jobs || null;
  const M = ERP.masterConfig || null;
  const AUTO = (ERP.automations = {});
  const SCH = () => window.ERP.schedules || null;
  const LIB = () => window.ERP.scripts || null;
  const NOT = () => window.ERP.notify || null;

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 400);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const uniq = (a) => [...new Set(a)];
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const runHistory = () => Math.max(1, num(cfg("rmm.automationRunHistory", 20), 20));
  const condCap = () => Math.max(4, num(cfg("rmm.automationConditionCap", 24), 24));

  /* ═══════════════════════ trigger catalogue ═══════════════════════ */

  AUTO.TRIGGERS = [
    { id: "alert.fired", label: "Alert fired", category: "alert", desc: "A monitor's alert fires (after its “for N minutes” duration)." },
    { id: "alert.cleared", label: "Alert cleared", category: "alert", desc: "A previously firing alert auto-clears on recovery." },
    { id: "monitor.state", label: "Monitor state change", category: "monitor", desc: "Any monitor changes state (ok → warning/critical or back)." },
    { id: "device.online", label: "Device came online", category: "device", desc: "An agent resumes checking in." },
    { id: "device.offline", label: "Device went offline", category: "device", desc: "An agent stops checking in past the offline threshold." },
    { id: "compliance.drift", label: "Compliance drift", category: "compliance", desc: "A device's security/compliance posture drifts from its baseline (raised by the Security station)." },
    { id: "schedule", label: "On a schedule", category: "schedule", desc: "Runs on a named master-config schedule." },
    { id: "manual", label: "Manual / API", category: "manual", desc: "Started by hand from the console or over the API." },
    { id: "webhook", label: "Inbound webhook", category: "webhook", desc: "Started by an inbound webhook payload." },
  ];
  AUTO.TRIGGER_IDS = AUTO.TRIGGERS.map((t) => t.id);
  AUTO.trigger = (id) => AUTO.TRIGGERS.find((t) => t.id === id) || null;
  AUTO.triggerLabel = (id) => (AUTO.trigger(id) || {}).label || id;

  /* ═══════════════════════ action catalogue ═══════════════════════ */

  AUTO.ACTIONS = [
    { id: "run-script", label: "Run script", category: "Scripts", params: [
      { key: "language", label: "Language", type: "select", options: () => (J ? J.LANGUAGES : []).map((l) => ({ value: l.id, label: l.label })), default: "powershell" },
      { key: "script", label: "Script", type: "textarea", required: true, default: "" },
      { key: "args", label: "Arguments", type: "text", default: "", hint: "Space separated." },
      { key: "timeoutSeconds", label: "Timeout (s)", type: "number", default: 300 },
    ] },
    { id: "run-library-script", label: "Run library script", category: "Scripts", params: [
      { key: "scriptId", label: "Library script", type: "text", required: true, default: "", hint: "The id shown in the Script library tab." },
      { key: "values", label: "Parameter values (JSON)", type: "textarea", default: "{}" },
    ] },
    { id: "restart-service", label: "Restart a service", category: "Remediation", destructive: true, params: [
      { key: "name", label: "Service name", type: "text", required: true, default: "" },
    ] },
    { id: "reboot", label: "Reboot the device", category: "Remediation", destructive: true, params: [] },
    { id: "deploy-patch", label: "Deploy a patch", category: "Patching", destructive: true, phase: "Phase 6 · Task 30", params: [
      { key: "classification", label: "Classification", type: "text", default: "SecurityUpdates" },
    ] },
    { id: "deploy-software", label: "Deploy software", category: "Software", destructive: true, phase: "Phase 7 · Task 32", params: [
      { key: "packageId", label: "Package", type: "text", default: "" },
    ] },
    { id: "send-notification", label: "Send a notification", category: "Notify", params: [
      { key: "channelId", label: "Channel", type: "select", ref: "channels", default: "" },
      { key: "severityId", label: "Severity", type: "select", ref: "severities", default: "" },
      { key: "subject", label: "Subject", type: "text", default: "" },
      { key: "message", label: "Message", type: "textarea", default: "Automation {{rule}} fired on {{device}}." },
    ] },
    { id: "tag-device", label: "Tag a device", category: "Targeting", params: [
      { key: "tag", label: "Tag", type: "text", required: true, default: "" },
      { key: "mode", label: "Mode", type: "select", options: () => [{ value: "add", label: "Add" }, { value: "remove", label: "Remove" }], default: "add" },
    ] },
    { id: "add-to-group", label: "Add to a group", category: "Targeting", params: [
      { key: "groupId", label: "Group", type: "select", ref: "groups", default: "" },
    ] },
    { id: "remove-from-group", label: "Remove from a group", category: "Targeting", params: [
      { key: "groupId", label: "Group", type: "select", ref: "groups", default: "" },
    ] },
    { id: "webhook", label: "Call a webhook", category: "Integrate", params: [
      { key: "url", label: "URL", type: "text", required: true, default: "", ph: "https://…" },
      { key: "method", label: "Method", type: "select", options: () => ["POST", "PUT", "GET"], default: "POST" },
      { key: "body", label: "Body (JSON)", type: "textarea", default: '{"rule":"{{rule}}","device":"{{device}}","event":"{{event}}"}' },
    ] },
    { id: "create-ticket", label: "Create / update a psa-u ticket", category: "Integrate", params: [
      { key: "subject", label: "Subject", type: "text", default: "" },
    ] },
  ];
  AUTO.ACTION_IDS = AUTO.ACTIONS.map((a) => a.id);
  AUTO._masterCache = { channels: [], severities: [] };
  AUTO.refreshMasterCache = async function () {
    if (!M) return AUTO._masterCache;
    try {
      AUTO._masterCache = { channels: await M.section("channels"), severities: await M.section("severities") };
    } catch (e) {}
    return AUTO._masterCache;
  };
  AUTO.action = (id) => AUTO.ACTIONS.find((a) => a.id === id) || null;
  AUTO.actionLabel = (id) => (AUTO.action(id) || {}).label || id;
  AUTO.isDestructive = (id) => !!((AUTO.action(id) || {}).destructive);

  /* ═══════════════════════ normalisation ═══════════════════════ */

  function normalizeCondition(c) {
    return G ? G.normalizeCondition(c) : { field: "os.family", op: "is", value: "" };
  }

  function normalizeAction(raw) {
    raw = asObj(raw);
    const def = AUTO.action(raw.type);
    const type = def ? raw.type : (AUTO.ACTION_IDS[0]);
    const params = {};
    const src = asObj(raw.params);
    const schema = def ? def.params : [];
    schema.forEach((p) => { params[p.key] = src[p.key] === undefined ? (p.default === undefined ? "" : p.default) : src[p.key]; });
    Object.keys(src).forEach((k) => { if (!(k in params)) params[k] = src[k]; });
    return { type, params, essential: !!raw.essential };
  }

  const MATCH = ["all", "any"];

  function normalizeRule(data) {
    data = asObj(data);
    const trigger = asObj(data.trigger);
    const type = AUTO.TRIGGER_IDS.indexOf(trigger.type) !== -1 ? trigger.type : "manual";
    const filter = asObj(trigger.filter);
    const conditions = asObj(data.conditions);
    const target = asObj(data.target);
    return {
      kind: "automationRule",
      id: data.id || T.newItemId("automationRules"),
      name: S(data.name, 120) || "Untitled rule",
      description: S(data.description, 600),
      enabled: data.enabled === undefined ? true : !!data.enabled,
      trigger: {
        type,
        filter: {
          monitorId: filter.monitorId ? String(filter.monitorId) : "",
          severityAtLeast: filter.severityAtLeast ? String(filter.severityAtLeast) : "",
          tag: filter.tag ? String(filter.tag) : "",
          groupId: filter.groupId ? String(filter.groupId) : "",
          deviceId: filter.deviceId ? String(filter.deviceId) : "",
          scheduleId: filter.scheduleId ? String(filter.scheduleId) : "",
        },
      },
      conditions: {
        match: MATCH.indexOf(conditions.match) !== -1 ? conditions.match : "all",
        items: asArr(conditions.items).slice(0, condCap()).map(normalizeCondition),
      },
      target: {
        groupIds: uniq(asArr(target.groupIds).map(String)),
        tags: uniq(asArr(target.tags).map(String)),
        deviceIds: uniq(asArr(target.deviceIds).map(String)),
        siteIds: uniq(asArr(target.siteIds).map(String)),
      },
      actions: asArr(data.actions).map(normalizeAction).filter((a) => AUTO.action(a.type)),
      requireApproval: !!data.requireApproval,
      cooldownMinutes: Math.max(0, num(data.cooldownMinutes, 0)),
      allowDuringMaintenance: !!data.allowDuringMaintenance,
      runs: asArr(data.runs).slice(0, runHistory()),
      lastRunAt: data.lastRunAt || "",
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };
  }
  AUTO.normalizeRule = normalizeRule;
  AUTO.newRule = normalizeRule;

  AUTO.validateRule = function (rule) {
    const errors = [];
    if (!rule || typeof rule !== "object") return { valid: false, errors: ["rule is not an object"] };
    if (!String(rule.name || "").trim()) errors.push("name is required");
    if (AUTO.TRIGGER_IDS.indexOf(asObj(rule.trigger).type) === -1) errors.push("unknown trigger: " + asObj(rule.trigger).type);
    const conds = asArr(asObj(rule.conditions).items);
    if (conds.length && !G) errors.push("the condition engine is unavailable");
    if (G) conds.forEach((c, i) => {
      if (!G.field(c.field)) errors.push("condition " + (i + 1) + ": unknown field " + c.field);
      else if (!G.operatorsFor(c.field).some((o) => o.id === c.op)) errors.push("condition " + (i + 1) + ": invalid operator " + c.op);
    });
    const actions = asArr(rule.actions);
    if (!actions.length) errors.push("at least one action is required");
    actions.forEach((a, i) => {
      const def = AUTO.action(a.type);
      if (!def) { errors.push("action " + (i + 1) + ": unknown type " + a.type); return; }
      def.params.forEach((p) => {
        const v = asObj(a.params)[p.key];
        if (p.required && (v == null || v === "")) errors.push("action " + (i + 1) + " (" + def.label + "): " + p.label + " is required");
      });
    });
    return { valid: errors.length === 0, errors };
  };

  AUTO.describeTrigger = function (rule) {
    const t = asObj(asObj(rule).trigger);
    const f = asObj(t.filter);
    const bits = [AUTO.triggerLabel(t.type)];
    if (f.monitorId) bits.push("monitor " + f.monitorId);
    if (f.severityAtLeast) bits.push("≥ " + f.severityAtLeast);
    if (f.tag) bits.push("tag " + f.tag);
    if (f.groupId) bits.push("group " + f.groupId);
    if (f.scheduleId) bits.push("schedule " + f.scheduleId);
    return bits.join(" · ");
  };

  AUTO.describeActions = function (rule) {
    return asArr(asObj(rule).actions).map((a) => AUTO.actionLabel(a.type)).join(" + ") || "—";
  };

  /* ═══════════════════════ matching & targets ═══════════════════════ */

  const EVENT_SCOPED = ["alert.fired", "alert.cleared", "monitor.state", "device.online", "device.offline", "compliance.drift"];

  AUTO.matches = function (rule, event, ctx) {
    ctx = ctx || {};
    rule = asObj(rule); event = asObj(event);
    if (rule.enabled === false) return false;
    const type = asObj(rule.trigger).type;
    if (!type) return false;
    if (type === "monitor.state") { if (String(event.type || "").indexOf("monitor") !== 0) return false; }
    else if (type !== String(event.type || "")) return false;
    const f = asObj(asObj(rule.trigger).filter);
    if (f.monitorId && String(event.monitorId || "") !== String(f.monitorId)) return false;
    if (f.deviceId && String(event.deviceId || "") !== String(f.deviceId)) return false;
    if (f.tag) {
      const dev = ctx.device;
      if (!dev || asArr(dev.tags).map(low).indexOf(low(f.tag)) === -1) return false;
    }
    if (f.groupId) {
      const dev = ctx.device, provider = ctx.provider;
      if (!dev || !provider || !G) return false;
      const ids = G.membershipIds(provider, dev, ctx.gctx || { provider });
      if (ids.map(String).indexOf(String(f.groupId)) === -1) return false;
    }
    if (f.severityAtLeast && ctx.rankOf && event.severityId) {
      const r = ctx.rankOf(event.severityId);
      const min = ctx.rankOf(f.severityAtLeast);
      if (r != null && min != null && r < min) return false;
    }
    const conds = asArr(asObj(rule.conditions).items);
    if (conds.length) {
      const dev = ctx.device;
      if (!dev || !G) return false;
      const gctx = ctx.gctx || { provider: ctx.provider, soft: {}, svc: {} };
      const results = conds.map((c) => G.evaluateCondition(c, dev, gctx));
      const ok = asObj(rule.conditions).match === "any" ? results.some(Boolean) : results.every(Boolean);
      if (!ok) return false;
    }
    return true;
  };

  function emptyTarget(spec) { return !asArr(spec.groupIds).length && !asArr(spec.tags).length && !asArr(spec.deviceIds).length && !asArr(spec.siteIds).length; }

  AUTO.resolveTargets = function (provider, rule, event, ctx, opts) {
    ctx = ctx || { provider };
    opts = opts || {};
    const all = asArr(provider.devices).map(D.normalizeDevice);
    const t = asObj(rule.trigger);
    const spec = asObj(rule.target);
    let candidates = all;
    if (!opts.allTargets && EVENT_SCOPED.indexOf(t.type) !== -1) {
      if (!event || !event.deviceId) return [];
      candidates = all.filter((d) => String(d.id) === String(event.deviceId));
    }
    const out = [];
    candidates.forEach((d) => {
      if (emptyTarget(spec)) { out.push({ device: d, matchedBy: EVENT_SCOPED.indexOf(t.type) !== -1 ? "event" : "provider", specificity: 0 }); return; }
      if (!G) return;
      const m = G.matchTargets(provider, spec, d, ctx.gctx || { provider });
      if (m.match) out.push({ device: d, matchedBy: m.matchedBy, specificity: m.specificity });
    });
    return out;
  };

  /* ═══════════════════════ context & plan ═══════════════════════ */

  async function loadCtx(provider, event) {
    let gctx = { provider, soft: {}, svc: {}, patches: {} };
    if (G && typeof G.loadIndex === "function") {
      try { const idx = await G.loadIndex(provider.id); gctx = { provider, soft: idx.soft || {}, svc: idx.svc || {}, patches: idx.patches || {} }; } catch (e) {}
    }
    const device = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(asObj(event).deviceId)) || null;
    const ranks = {};
    if (M) { const list = await M.section("severities"); list.forEach((s) => { ranks[s.id] = num(s.rank, 0); }); }
    return { provider, gctx, device, rankOf: (id) => (id == null ? null : (ranks[id] == null ? null : ranks[id])) };
  }
  AUTO.loadCtx = loadCtx;

  /* Build the action plan for one rule+event. Pure of side effects. */
  AUTO.plan = async function (provider, rule, event, ctx, opts) {
    opts = opts || {};
    rule = normalizeRule(rule);
    event = asObj(event);
    ctx = ctx || await loadCtx(provider, event);
    const at = event.at || now();
    const targets = AUTO.resolveTargets(provider, rule, event, ctx, opts);
    const Sch = SCH();
    const rows = [];
    for (const t of targets) {
      let suppressed = false, windowIds = [];
      if (Sch && !rule.allowDuringMaintenance && typeof Sch.scopeFor === "function") {
        try {
          const scope = await Sch.scopeFor(provider.id, t.device.id);
          const s = await Sch.isSuppressed(provider.id, scope, at, event.severityId);
          suppressed = !!(s && s.suppressed);
          windowIds = asArr(s && s.windows);
        } catch (e) {}
      }
      const actions = rule.actions.map((a) => {
        const def = AUTO.action(a.type) || {};
        const skip = suppressed && !a.essential;
        return {
          type: a.type, label: def.label || a.type, essential: !!a.essential,
          destructive: !!def.destructive, phase: def.phase || null,
          params: Object.assign({}, asObj(a.params)),
          status: skip ? "deferred" : "planned",
          detail: skip ? "deferred — maintenance window" : "",
        };
      });
      rows.push({
        deviceId: String(t.device.id), hostname: t.device.hostname || t.device.displayName || String(t.device.id),
        os: (t.device.os && t.device.os.family) || "", matchedBy: t.matchedBy, suppressed, windowIds, actions,
      });
    }
    const destructive = rule.actions.some((a) => AUTO.isDestructive(a.type));
    const byType = {};
    rows.forEach((r) => r.actions.forEach((a) => { byType[a.status] = (byType[a.status] || 0) + 1; }));
    return {
      providerId: provider.id,
      rule: { id: rule.id, name: rule.name },
      triggerType: rule.trigger.type,
      event: clone(event),
      at,
      targets: rows,
      counts: byType,
      destructive,
      requiresApproval: rule.requireApproval && destructive,
      phases: uniq(rule.actions.map((a) => (AUTO.action(a.type) || {}).phase).filter(Boolean)),
      summary: rows.length + " target device(s); " + rule.actions.length + " action(s)" + (destructive ? " (includes a destructive action)" : ""),
    };
  };

  /* ═══════════════════════ action execution ═══════════════════════ */

  function renderTemplate(text, vars) {
    return String(text == null ? "" : text).replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }

  function familyOf(dev) {
    if (J && typeof J.familyOf === "function") return J.familyOf(dev);
    const fam = String(asObj(dev && dev.os).family || "");
    return fam || "Windows";
  }

  function serviceScript(name, family) {
    const lit = (s) => (LIB() && LIB().safeLiteral ? LIB().safeLiteral(s, LIB().shellForLanguage(family === "Windows" ? "powershell" : "bash")) : "'" + String(s).replace(/'/g, "''") + "'");
    if (family === "Windows") return { language: "powershell", script: "Restart-Service -Name " + lit(name) + " -Force\nWrite-Output \"restarted " + name + "\"", args: [] };
    if (family === "macOS") return { language: "bash", script: "launchctl kickstart -k system/" + lit(name) + "\necho \"restarted " + name + "\"", args: [] };
    return { language: "bash", script: "systemctl restart " + lit(name) + "\necho \"restarted " + name + "\"", args: [] };
  }
  function rebootScript(family) {
    if (family === "Windows") return { language: "powershell", script: "Restart-Computer -Force", args: [] };
    return { language: "bash", script: "shutdown -r now", args: [] };
  }
  AUTO.serviceScript = serviceScript;
  AUTO.rebootScript = rebootScript;

  /* Swap-in point so tests never hit the network. */
  AUTO.sender = async function (d) {
    const fn = (window.root && typeof window.root.superFetch === "function") ? window.root.superFetch : (typeof fetch === "function" ? fetch : null);
    if (!fn) return { ok: false, error: "no_transport" };
    const res = await fn(d.url, { method: d.method || "POST", headers: { "Content-Type": "application/json" }, body: d.body });
    return { ok: res.ok !== false, status: res.status };
  };

  async function enqueue(providerId, deviceId, name, spec, opts) {
    const DSP = window.ERP.dispatch;
    const payload = {
      providerId, deviceIds: [String(deviceId)], name: S(name, 160), language: spec.language, script: spec.script,
      args: asArr(spec.args), source: opts.source || "automation", correlation: opts.correlation, timeoutSeconds: spec.timeoutSeconds,
    };
    if (DSP && typeof DSP.enqueue === "function") return DSP.enqueue(payload);
    if (J && typeof J.enqueue === "function") return J.enqueue(payload);
    return { error: "no_dispatcher" };
  }

  async function executeAction(provider, rule, action, dev, run, at) {
    const def = AUTO.action(action.type) || {};
    const params = asObj(action.params);
    const vars = { rule: rule.name, ruleId: rule.id, device: dev.hostname || dev.displayName || dev.id, deviceId: dev.id, event: asObj(run).triggerType || "", at };
    try {
      if (def.phase) return { type: action.type, status: "skipped", detail: "Not implemented until " + def.phase };
      switch (action.type) {
        case "run-script": {
          const script = renderTemplate(params.script, vars);
          if (!String(script).trim()) return { type: action.type, status: "skipped", detail: "empty script" };
          const r = await enqueue(provider.id, dev.id, rule.name, { language: params.language, script, args: String(params.args || "").split(/\s+/).filter(Boolean), timeoutSeconds: num(params.timeoutSeconds, 300) }, { correlation: { ruleId: rule.id, runId: asObj(run).id } });
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          return { type: action.type, status: "queued", detail: "job " + (r.job ? r.job.id : ""), jobId: r.job ? r.job.id : null };
        }
        case "run-library-script": {
          const L = LIB();
          if (!L) return { type: action.type, status: "skipped", detail: "script library unavailable" };
          let values = {};
          try { values = JSON.parse(params.values || "{}"); } catch (e) { return { type: action.type, status: "failed", detail: "parameter values are not valid JSON" }; }
          const r = await L.runOn(provider.id, [dev.id], params.scriptId, values, { source: "automation", correlation: { ruleId: rule.id, runId: asObj(run).id } });
          if (r.error) return { type: action.type, status: "failed", detail: r.error + (r.errors && r.errors.length ? ": " + r.errors.map((x) => x.error).join(", ") : "") };
          const jobs = asArr(r.jobs);
          return { type: action.type, status: jobs.length ? "queued" : "failed", detail: jobs.length + " job(s)", jobId: jobs[0] ? jobs[0].jobId : null };
        }
        case "restart-service": {
          if (!params.name) return { type: action.type, status: "skipped", detail: "no service name" };
          const spec = serviceScript(params.name, familyOf(dev));
          const r = await enqueue(provider.id, dev.id, "Restart " + params.name, spec, { correlation: { ruleId: rule.id, runId: asObj(run).id } });
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          return { type: action.type, status: "queued", detail: "restart " + params.name, jobId: r.job ? r.job.id : null };
        }
        case "reboot": {
          const r = await enqueue(provider.id, dev.id, "Reboot " + (dev.hostname || dev.id), rebootScript(familyOf(dev)), { correlation: { ruleId: rule.id, runId: asObj(run).id } });
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          return { type: action.type, status: "queued", detail: "reboot queued", jobId: r.job ? r.job.id : null };
        }
        case "send-notification": {
          const N = NOT();
          if (!N) return { type: action.type, status: "skipped", detail: "notification service unavailable" };
          const r = await N.send({
            providerId: provider.id, channelId: params.channelId || null, severityId: params.severityId || null,
            subject: renderTemplate(params.subject || rule.name, vars), message: renderTemplate(params.message, vars),
            deviceId: dev.id, at,
          });
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          const status = r.notification && r.notification.status;
          return { type: action.type, status: status === "sent" ? "sent" : status === "queued" ? "queued" : "suppressed", detail: (r.notification && r.notification.reason) || status || "recorded" };
        }
        case "tag-device": {
          if (!G) return { type: action.type, status: "skipped", detail: "group engine unavailable" };
          const r = params.mode === "remove" ? await G.removeTag(provider.id, params.tag, [dev.id]) : await G.applyTag(provider.id, params.tag, [dev.id]);
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          return { type: action.type, status: "done", detail: (params.mode === "remove" ? "removed tag " : "tagged ") + params.tag };
        }
        case "add-to-group": case "remove-from-group": {
          if (!G || !params.groupId) return { type: action.type, status: "skipped", detail: "no group" };
          if (action.type === "add-to-group") { const r = await G.addMember(provider.id, params.groupId, dev.id); if (r.error) return { type: action.type, status: "failed", detail: r.error }; return { type: action.type, status: "done", detail: "added to " + params.groupId }; }
          const r = await G.removeMember(provider.id, params.groupId, dev.id);
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          return { type: action.type, status: "done", detail: "removed from " + params.groupId };
        }
        case "create-ticket": {
          const P = window.ERP.psa;
          if (!P || typeof P.createTicketFromEvent !== "function") return { type: action.type, status: "skipped", detail: "psa bridge unavailable" };
          const ev = asObj(run).event;
          const subject = renderTemplate(params.subject || (rule.name + " on " + (dev.hostname || dev.id)), vars);
          const r = await P.createTicketFromEvent(provider.id, {
            deviceId: dev.id, severityId: ev.severityId || null, alertId: ev.alertId || null, monitorId: ev.monitorId || null, ruleName: rule.name,
          }, { subject });
          if (r.error) return { type: action.type, status: "failed", detail: r.error };
          if (r.skipped) return { type: action.type, status: "skipped", detail: r.reason || "skipped" };
          return { type: action.type, status: "done", detail: "ticket " + (r.ticket ? (r.ticket.externalId || r.ticket.id) : "") };
        }
        case "webhook": {
          if (!params.url) return { type: action.type, status: "skipped", detail: "no URL" };
          const url = renderTemplate(params.url, vars);
          const body = renderTemplate(params.body, vars);
          const res = await AUTO.sender({ url, method: params.method || "POST", body });
          if (!res || res.ok === false) return { type: action.type, status: "failed", detail: (res && res.error) || "transport error" };
          return { type: action.type, status: "sent", detail: "HTTP " + (res.status || 200) };
        }
        default:
          return { type: action.type, status: "skipped", detail: "unknown action" };
      }
    } catch (e) {
      return { type: action.type, status: "failed", detail: (e && e.message) || String(e) };
    }
  }
  AUTO.executeAction = executeAction;

  async function executeRun(provider, rule, run, opts) {
    const at = run.startedAt || now();
    let queued = 0, failed = 0, deferred = 0, done = 0, skipped = 0, sent = 0;
    for (const target of asArr(run.targets)) {
      const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(target.deviceId));
      if (!dev) { target.actions = asArr(target.actions).map((a) => Object.assign({}, a, { status: "skipped", detail: "device not found" })); continue; }
      const executed = [];
      for (const planned of asArr(target.actions)) {
        if (planned.status === "deferred") { deferred++; executed.push(planned); continue; }
        const res = await executeAction(provider, rule, planned, dev, run, at);
        if (res.status === "queued") queued++;
        else if (res.status === "failed") failed++;
        else if (res.status === "skipped") skipped++;
        else if (res.status === "sent" || res.status === "suppressed") sent++;
        else if (res.status === "done") done++;
        executed.push(Object.assign({}, planned, res));
      }
      target.actions = executed;
      /* record the suppression for this target so there is an audit trail */
      if (target.suppressed && asArr(target.windowIds).length) {
        const Sch = SCH();
        if (Sch && typeof Sch.recordSuppression === "function") {
          await Sch.recordSuppression({ providerId: provider.id, deviceId: target.deviceId, windowIds: target.windowIds, reason: "automation rule deferred/limited", source: "automation", at, meta: { ruleId: rule.id, runId: run.id } });
        }
      }
    }
    const total = queued + failed + done + sent;
    run.status = failed && !total ? "failed" : failed ? "partial" : "succeeded";
    if (!asArr(run.targets).length) run.status = "skipped";
    run.endedAt = now();
    run.counts = { queued, failed, done, sent, deferred, skipped };
    run.summary = asArr(run.targets).length
      ? (asArr(run.targets).length + " device(s): " + queued + " queued, " + done + " applied, " + sent + " sent" + (failed ? ", " + failed + " failed" : "") + (deferred ? ", " + deferred + " deferred" : "") + (skipped ? ", " + skipped + " skipped" : ""))
      : "No matching devices.";
    return run;
  }
  AUTO.executeRun = executeRun;

  async function storeRun(providerId, ruleId, run) {
    const r = await T.updateItem(providerId, "automationRules", ruleId, (it) => {
      it.runs = [clone(run)].concat(asArr(it.runs)).slice(0, runHistory());
      it.lastRunAt = run.startedAt;
    });
    return r;
  }

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "automation", targetId, summary }); } catch (e) {}
  }

  function actorName() {
    try {
      const tm = ERP.team && ERP.team.me;
      const me = typeof tm === "function" ? tm() : tm;
      if (me && me.displayName) return String(me.displayName);
    } catch (e) {}
    return ERP.role || "owner";
  }

  /* ═══════════════════════ run ═══════════════════════ */

  /* opts: { event, dryRun, approved, actor, at, ignoreCooldown } */
  AUTO.run = async function (providerId, ruleId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const raw = asArr(g.provider.automationRules).find((r) => String(r.id) === String(ruleId));
    if (!raw) return { error: "not_found", ruleId };
    const rule = normalizeRule(raw);
    const event = asObj(opts.event);
    const at = opts.at || event.at || now();

    if (opts.dryRun || opts.planOnly) {
      const ctx = await loadCtx(g.provider, event);
      const plan = await AUTO.plan(g.provider, rule, event, ctx, { allTargets: !!opts.allTargets });
      plan.dryRun = true;
      return plan;
    }

    if (rule.cooldownMinutes > 0 && opts.ignoreCooldown !== true) {
      const last = asArr(rule.runs)[0];
      if (last && last.status !== "pending-approval" && String(last.triggerType) === String(rule.trigger.type) && (Date.parse(at) - Date.parse(last.startedAt)) < rule.cooldownMinutes * 60000) {
        return { skipped: true, reason: "cooldown", lastAt: last.startedAt, ruleId };
      }
    }

    const ctx = await loadCtx(g.provider, event);
    const plan = await AUTO.plan(g.provider, rule, event, ctx, { allTargets: !!opts.allTargets });
    const run = {
      id: rid("run"), ruleId: rule.id, ruleName: rule.name, providerId,
      triggerType: rule.trigger.type, event: clone(event),
      status: "running", dryRun: false, actor: opts.actor || actorName(),
      startedAt: at, endedAt: "", targets: plan.targets,
      destructive: plan.destructive, requiresApproval: plan.requiresApproval,
      counts: {}, summary: "", approval: null,
    };
    if (rule.requireApproval && plan.destructive && !opts.approved) {
      run.status = "pending-approval";
      run.summary = "Waiting for approval — the plan includes a destructive action.";
      run.counts = plan.counts;
      await storeRun(providerId, rule.id, run);
      await audit("automation_pending", rule.id, "Automation \"" + rule.name + "\" is waiting for approval (" + plan.summary + ").");
      return { pending: true, run: clone(run) };
    }
    run.approval = opts.approved ? { by: opts.actor || actorName(), at } : null;
    await executeRun(g.provider, rule, run, opts);
    await storeRun(providerId, rule.id, run);
    await audit("automation_run", rule.id, "Automation \"" + rule.name + "\" → " + run.status + " (" + run.summary + ").");
    return { ok: true, run: clone(run) };
  };

  AUTO.dryRun = async function (providerId, ruleId, event, opts) {
    return AUTO.run(providerId, ruleId, Object.assign({ event: event || {}, dryRun: true }, opts || {}));
  };

  AUTO.approve = async function (providerId, ruleId, runId, actor) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const raw = asArr(g.provider.automationRules).find((r) => String(r.id) === String(ruleId));
    if (!raw) return { error: "not_found", ruleId };
    const rule = normalizeRule(raw);
    const run = asArr(raw.runs).find((r) => String(r.id) === String(runId));
    if (!run) return { error: "run_not_found", runId };
    if (run.status !== "pending-approval") return { error: "not_pending", status: run.status };
    run.actor = actor || actorName();
    run.approval = { by: run.actor, at: now() };
    run.status = "running";
    await executeRun(g.provider, rule, run, { approved: true, actor: run.actor });
    await T.updateItem(providerId, "automationRules", ruleId, (it) => {
      const i = asArr(it.runs).findIndex((r) => String(r.id) === String(runId));
      if (i >= 0) it.runs[i] = clone(run);
    });
    await audit("automation_approve", ruleId, "Approved automation \"" + rule.name + "\" run → " + run.status + ".");
    return { ok: true, run: clone(run) };
  };

  AUTO.reject = async function (providerId, ruleId, runId, actor) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const raw = asArr(g.provider.automationRules).find((r) => String(r.id) === String(ruleId));
    if (!raw) return { error: "not_found", ruleId };
    const run = asArr(raw.runs).find((r) => String(r.id) === String(runId));
    if (!run) return { error: "run_not_found", runId };
    if (run.status !== "pending-approval") return { error: "not_pending", status: run.status };
    run.status = "rejected";
    run.endedAt = now();
    run.summary = "Rejected by " + (actor || actorName());
    await T.updateItem(providerId, "automationRules", ruleId, (it) => {
      const i = asArr(it.runs).findIndex((r) => String(r.id) === String(runId));
      if (i >= 0) it.runs[i] = clone(run);
    });
    await audit("automation_reject", ruleId, "Rejected automation run.");
    return { ok: true, run: clone(run) };
  };

  /* ═══════════════════════ ingest (event router) ═══════════════════════ */

  /* The entry point the alert lifecycle (Task 24) and the event stream
     (Task 16) call: route one event through every enabled rule. */
  AUTO.ingest = async function (providerId, event) {
    event = asObj(event);
    if (!event.type) return { error: "no_event_type" };
    const g = await T.get(providerId);
    if (g.error) return g;
    const ctx = await loadCtx(g.provider, event);
    const triggered = [], runs = [];
    for (const raw of asArr(g.provider.automationRules)) {
      const rule = normalizeRule(raw);
      if (rule.enabled === false) continue;
      if (["schedule", "manual", "webhook"].indexOf(rule.trigger.type) !== -1) continue;
      if (!AUTO.matches(rule, event, ctx)) continue;
      triggered.push(rule.id);
      const r = await AUTO.run(providerId, rule.id, { event, at: event.at || now() });
      if (r && r.run) runs.push(r.run);
      else if (r && r.skipped) runs.push({ ruleId: rule.id, status: "skipped", reason: r.reason });
      else if (r && r.error) runs.push({ ruleId: rule.id, status: "error", reason: r.error });
    }
    return { triggered, runs };
  };

  /* Schedule trigger: rules with a `schedule` trigger whose schedule is due. */
  AUTO.scheduleDue = async function (providerId, at) {
    const Sch = SCH();
    if (!Sch || !M) return { error: "schedules_unavailable" };
    const g = await T.get(providerId);
    if (g.error) return g;
    const windowMinutes = Math.max(1, num(cfg("rmm.scheduleDueWindowMinutes", 5), 5));
    const due = [], runs = [];
    for (const raw of asArr(g.provider.automationRules)) {
      const rule = normalizeRule(raw);
      if (rule.enabled === false || rule.trigger.type !== "schedule" || !rule.trigger.filter.scheduleId) continue;
      const sched = await M.schedule(rule.trigger.filter.scheduleId);
      if (!sched || sched.enabled === false) continue;
      if (!Sch.isDue(sched, at || now(), sched.timezone, windowMinutes)) continue;
      due.push(rule.id);
      const r = await AUTO.run(providerId, rule.id, { event: { type: "schedule", at: at || now(), scheduleId: sched.id } });
      if (r && r.run) runs.push(r.run);
    }
    return { due, runs };
  };

  /* ═══════════════════════ CRUD ═══════════════════════ */

  AUTO.get = async function (providerId, ruleId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const rec = asArr(g.provider.automationRules).find((r) => String(r.id) === String(ruleId));
    if (!rec) return { error: "not_found", ruleId };
    return { rule: normalizeRule(rec), provider: g.provider, rev: g.rev };
  };
  AUTO.list = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(g.provider.automationRules).map(normalizeRule);
  };
  AUTO.listOf = (provider) => asArr(provider && provider.automationRules).map(normalizeRule);

  AUTO.add = async function (providerId, data) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const rule = normalizeRule(data);
    const v = AUTO.validateRule(rule);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await T.addItem(providerId, "automationRules", rule);
    if (r.error) return r;
    return { rule: normalizeRule(r.item), rev: r.rev };
  };

  AUTO.update = async function (providerId, ruleId, patch) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const raw = asArr(g.provider.automationRules).find((r) => String(r.id) === String(ruleId));
    if (!raw) return { error: "not_found", ruleId };
    const before = normalizeRule(raw);
    const merged = normalizeRule(Object.assign({}, before, asObj(patch), { id: before.id, createdAt: before.createdAt, runs: before.runs, lastRunAt: before.lastRunAt }));
    const v = AUTO.validateRule(merged);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await T.updateItem(providerId, "automationRules", ruleId, (it) => {
      Object.assign(it, merged, { id: before.id, kind: "automationRule", createdAt: before.createdAt });
    });
    if (r.error) return r;
    return { rule: normalizeRule(merged), rev: r.rev };
  };

  AUTO.remove = async function (providerId, ruleId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const r = await T.removeItem(providerId, "automationRules", ruleId);
    if (r.error) return r;
    return { removed: ruleId };
  };

  AUTO.setEnabled = (providerId, ruleId, enabled) => AUTO.update(providerId, ruleId, { enabled: !!enabled });

  AUTO.duplicate = async function (providerId, ruleId) {
    const g = await AUTO.get(providerId, ruleId);
    if (g.error) return g;
    return AUTO.add(providerId, Object.assign({}, g.rule, { id: null, name: g.rule.name + " (copy)", runs: [], lastRunAt: "", createdAt: null }));
  };

  AUTO.runs = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return [];
    let runs = [];
    AUTO.listOf(g.provider).forEach((rule) => {
      if (opts.ruleId && String(rule.id) !== String(opts.ruleId)) return;
      asArr(rule.runs).forEach((run) => runs.push(Object.assign({}, run, { ruleName: run.ruleName || rule.name, triggerLabel: AUTO.triggerLabel(run.triggerType) })));
    });
    runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    if (opts.status) runs = runs.filter((r) => r.status === opts.status);
    if (opts.limit) runs = runs.slice(0, opts.limit);
    return clone(runs);
  };

  AUTO.pending = async function (providerId) { return AUTO.runs(providerId, { status: "pending-approval" }); };

  AUTO.statsOf = function (provider) {
    const rules = AUTO.listOf(provider);
    const byTrigger = {}, byAction = {};
    let runs = 0, pending = 0, failed = 0;
    rules.forEach((r) => {
      byTrigger[r.trigger.type] = (byTrigger[r.trigger.type] || 0) + 1;
      r.actions.forEach((a) => { byAction[a.type] = (byAction[a.type] || 0) + 1; });
      runs += asArr(r.runs).length;
      pending += asArr(r.runs).filter((x) => x.status === "pending-approval").length;
      failed += asArr(r.runs).filter((x) => x.status === "failed" || x.status === "partial").length;
    });
    return {
      total: rules.length, enabled: rules.filter((r) => r.enabled !== false).length,
      byTrigger, byAction, runs, pending, destructive: rules.filter((r) => r.actions.some((a) => AUTO.isDestructive(a.type))).length,
      requiresApproval: rules.filter((r) => r.requireApproval).length, failed, scheduled: rules.filter((r) => r.trigger.type === "schedule").length,
    };
  };
  AUTO.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return AUTO.statsOf(g.provider);
  };

  /* ═══════════════════════ seed ═══════════════════════ */

  AUTO.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.automationEnabled", true) === false) return { skipped: true, reason: "disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    const existing = new Set(AUTO.listOf(g.provider).map((r) => low(r.name)));
    const created = [];
    const seed = [
      {
        name: "Disk alert → run disk report", description: "When a disk-space monitor fires, queue the standard disk report on the device.",
        trigger: { type: "alert.fired", filter: {} }, allowDuringMaintenance: true,
        actions: [{ type: "run-script", params: { language: "powershell", script: "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free", timeoutSeconds: 60 } }],
      },
      {
        name: "Critical outage → notify NOC", description: "Notify the on-call channel whenever an alert escalates to critical.",
        trigger: { type: "alert.fired", filter: { severityAtLeast: "sev-critical" } },
        actions: [{ type: "send-notification", params: { subject: "Critical alert", message: "{{device}} raised a critical alert." } }],
      },
      {
        name: "Nightly maintenance sweep", description: "A scheduled example rule that tags every server each night.",
        trigger: { type: "schedule", filter: { scheduleId: "sched-monthly-1" } }, allowDuringMaintenance: true,
        target: { tags: ["server"] },
        actions: [{ type: "tag-device", params: { tag: "nightly-swept", mode: "add" }, essential: true }],
      },
    ];
    for (const data of seed) {
      if (!opts.force && existing.has(low(data.name))) continue;
      const r = await AUTO.add(demo.id, data);
      if (r.error) continue;
      created.push(r.rule.id);
    }
    return { providerId: demo.id, created };
  };

  let readyResolve;
  AUTO.ready = new Promise((res) => { readyResolve = res; });
  AUTO.init = async function () { try { await T.ready; await AUTO.seedDemo(); } catch (e) { console.error("automation seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", AUTO.init);
  else AUTO.init();

  /* ═══════════════════════ station UI ═══════════════════════ */

  AUTO.currentProviderId = null;

  function scopedShowTab(el, id) {
    el.querySelectorAll(":scope > .erp-tabs > [data-tab]").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === id));
    el.querySelectorAll(":scope > .erp-tabs-content > [data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === id));
  }

  function runStatusBadge(status) {
    const ui = ERP.ui;
    const tone = status === "succeeded" ? "success" : status === "pending-approval" ? "warn" : status === "running" ? "info"
      : status === "partial" ? "warn" : status === "failed" ? "danger" : status === "skipped" || status === "rejected" ? "muted" : "muted";
    return ui.badge(status, tone);
  }

  function actionStatusBadge(status) {
    const ui = ERP.ui;
    const tone = status === "queued" ? "info" : status === "done" || status === "sent" ? "success" : status === "failed" ? "danger"
      : status === "deferred" ? "warn" : status === "skipped" || status === "suppressed" ? "muted" : "muted";
    return ui.badge(status, tone);
  }

  /* ── rules panel ── */
  function rulesPanel(provider) {
    const ui = ERP.ui, esc = ui.esc;
    const rules = AUTO.listOf(provider);
    const stats = AUTO.statsOf(provider);
    const rows = rules.map((r) => {
      const tg = asObj(r.target);
      const hasTarget = asArr(tg.groupIds).length || asArr(tg.tags).length || asArr(tg.deviceIds).length || asArr(tg.siteIds).length;
      return {
      name: '<b>' + esc(r.name) + "</b>" + (r.enabled === false ? " " + ui.badge("disabled", "muted") : "") + (r.requireApproval ? " " + ui.badge("approval", "warn") : "")
        + (r.description ? '<div class="erp-sub">' + esc(r.description) + "</div>" : ""),
      trigger: ui.badge(AUTO.triggerLabel(r.trigger.type), "info") + '<div class="erp-sub">' + esc(AUTO.describeTrigger(r)) + "</div>",
      target: '<span class="erp-sub">' + esc(hasTarget ? AUTO.targetSummary(provider, r) : (EVENT_SCOPED.indexOf(r.trigger.type) !== -1 ? "the triggering device" : "every device")) + "</span>",
      actions: esc(AUTO.describeActions(r)) + (r.actions.some((a) => AUTO.isDestructive(a.type)) ? " " + ui.badge("destructive", "danger") : ""),
      last: r.lastRunAt ? esc(ui.dateTime(r.lastRunAt)) + (asArr(r.runs)[0] ? " " + runStatusBadge(asArr(r.runs)[0].status) : "") : '<span class="erp-sub">never</span>',
      state: ui.badge(r.enabled === false ? "disabled" : "enabled", r.enabled === false ? "muted" : "success"),
      actionsCol: ui.btn("Run now", { small: true, primary: true, act: "auto-run", arg: r.id }) + " " +
        ui.btn("Dry run", { small: true, act: "auto-dry", arg: r.id }) + " " +
        ui.btn("Edit", { small: true, act: "auto-edit", arg: r.id }) + " " +
        ui.btn("Duplicate", { small: true, act: "auto-dup", arg: r.id }) + " " +
        ui.btn(r.enabled === false ? "Enable" : "Disable", { small: true, act: "auto-toggle", arg: r.id }) + " " +
        ui.btn("Delete", { small: true, danger: true, act: "auto-del", arg: r.id }),
      };
    });
    return ui.summary([
      { label: "Rules", value: String(stats.total) },
      { label: "Enabled", value: String(stats.enabled) },
      { label: "Scheduled", value: String(stats.scheduled) },
      { label: "Destructive", value: String(stats.destructive) },
      { label: "Runs recorded", value: String(stats.runs) },
      { label: "Awaiting approval", value: String(stats.pending) },
    ]) +
      ui.table([
        { key: "name", label: "Rule", render: (r) => r.name },
        { key: "trigger", label: "Trigger", render: (r) => r.trigger },
        { key: "target", label: "Targets", render: (r) => r.target },
        { key: "actions", label: "Actions", render: (r) => r.actions },
        { key: "last", label: "Last run", render: (r) => r.last },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "actionsCol", label: "", render: (r) => r.actionsCol },
      ], rows, { scroll: true, emptyText: "No automations yet — create a trigger → condition → action rule." });
  }

  AUTO.targetSummary = function (provider, rule) {
    if (!G) return "—";
    return G.targetSummary(provider, asObj(rule.target), { provider });
  };

  /* ── runs panel ── */
  async function runsPanel(provider) {
    const ui = ERP.ui, esc = ui.esc;
    const runs = await AUTO.runs(provider.id, { limit: 200 });
    const pending = runs.filter((r) => r.status === "pending-approval");
    const rows = runs.map((r) => ({
      at: esc(ui.dateTime(r.startedAt)),
      rule: esc(r.ruleName || r.ruleId),
      trigger: ui.badge(r.triggerLabel || AUTO.triggerLabel(r.triggerType), "info"),
      status: runStatusBadge(r.status),
      targets: String(asArr(r.targets).length),
      summary: '<span class="erp-sub">' + esc(r.summary || "") + "</span>",
      actions: (r.status === "pending-approval" ? ui.btn("Approve", { small: true, primary: true, act: "auto-approve", arg: r.ruleId + "|" + r.id }) + " " + ui.btn("Reject", { small: true, danger: true, act: "auto-reject", arg: r.ruleId + "|" + r.id }) + " " : "") +
        ui.btn("Detail", { small: true, act: "auto-run-detail", arg: r.ruleId + "|" + r.id }),
    }));
    return ui.summary([
      { label: "Runs", value: String(runs.length) },
      { label: "Succeeded", value: String(runs.filter((r) => r.status === "succeeded").length) },
      { label: "Failed / partial", value: String(runs.filter((r) => r.status === "failed" || r.status === "partial").length) },
      { label: "Awaiting approval", value: String(pending.length) },
    ]) +
      (pending.length ? ui.alert(pending.length + " run(s) are waiting for approval before destructive actions execute.", "warn") : "") +
      ui.table([
        { key: "at", label: "When", render: (r) => r.at },
        { key: "rule", label: "Rule", render: (r) => r.rule },
        { key: "trigger", label: "Trigger", render: (r) => r.trigger },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "targets", label: "Targets", render: (r) => r.targets },
        { key: "summary", label: "Summary", render: (r) => r.summary },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No automation runs yet." });
  }

  /* ── rule form ── */
  function openRuleForm(provider, rule) {
    const ui = ERP.ui, esc = ui.esc;
    const isEdit = !!rule;
    const fs = {
      conditions: isEdit ? clone(asObj(rule.conditions).items) : [],
      match: isEdit ? asObj(rule.conditions).match : "all",
      actions: isEdit ? clone(rule.actions) : [{ type: "send-notification", params: {}, essential: false }],
      target: isEdit ? clone(asObj(rule.target)) : { groupIds: [], tags: [], deviceIds: [], siteIds: [] },
    };
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const groups = asArr(provider.deviceGroups);
    const sites = asArr(provider.sites);

    function fieldOpts(sel, attr) { return G.FIELDS.map((f) => '<option value="' + esc(f.id) + '"' + (f.id === sel ? " selected" : "") + ">" + esc(f.group + " · " + f.label) + "</option>").join(""); }

    function conditionsHtml() {
      return asArr(fs.conditions).map((c, i) =>
        '<div class="rmm-cond-row" data-cond-row="' + i + '">' +
        '<select data-cond-field="' + i + '">' + fieldOpts(c.field) + "</select>" +
        '<select data-cond-op="' + i + '">' + (G ? G.operatorsFor(c.field).map((o) => '<option value="' + esc(o.id) + '"' + (o.id === c.op ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") : "") + "</select>" +
        condValueControl(i, c) +
        ui.btn("✕", { small: true, danger: true, act: "auto-cond-del", arg: String(i) }) +
        "</div>").join("") +
        '<div class="erp-btn-row">' + ui.btn("Add condition", { small: true, act: "auto-cond-add" }) +
        ' <label class="erp-check" style="margin-left:12px">Match <select data-cond-match>' + MATCH.map((m) => '<option value="' + m + '"' + (m === fs.match ? " selected" : "") + ">" + m.toUpperCase() + "</option>").join("") + "</select> of the conditions</label></div>" +
        (G ? '<div class="rmm-rule-preview" data-rule-preview>' + esc(fs.conditions.length ? G.ruleSummary({ match: fs.match, conditions: fs.conditions }, { provider }) : "No conditions — every targeted device matches.") + "</div>" : "");
    }
    function condValueControl(idx, cond) {
      const f = (G && G.field(cond.field)) || { type: "text" };
      if (f.type === "bool") return '<select data-cond-field-val="' + idx + '"><option value="true"' + (cond.value === true ? " selected" : "") + ">true</option><option value=\"false\"" + (cond.value === false ? " selected" : "") + ">false</option></select>";
      if (f.type === "number") return '<input type="number" data-cond-field-val="' + idx + '" value="' + esc(cond.value) + '">';
      if (f.type === "select" || f.type === "site") {
        const opts = f.type === "site" ? sites.map((s) => ({ value: s.id, label: s.name })) : (f.options ? f.options() : []).map((v) => ({ value: v, label: v }));
        return '<select data-cond-field-val="' + idx + '"><option value="">— value —</option>' + opts.map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(cond.value) ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select>";
      }
      return '<input type="text" data-cond-field-val="' + idx + '" value="' + esc(cond.value) + '" placeholder="value">';
    }

    function actionParamControl(aIdx, def, p) {
      const name = "ap" + aIdx + "_" + p.key;
      const cur = asObj(fs.actions[aIdx].params)[p.key];
      const val = cur === undefined ? (p.default === undefined ? "" : p.default) : cur;
      if (p.type === "textarea") return ui.textarea(name, p.label + (p.required ? " *" : ""), val);
      if (p.type === "number") return ui.number(name, p.label, val, { hint: p.hint });
      if (p.type === "bool") return ui.check(name, p.label, !!val);
      if (p.type === "select") return ui.select(name, p.label, refOptions(p, val), val);
      return ui.text(name, p.label, val == null ? "" : val, p.hint || "");
    }
    function refOptions(p, val) {
      let opts = [];
      if (p.ref === "channels") opts = asArr(AUTO._masterCache.channels).map((c) => ({ value: c.id, label: c.label || c.id }));
      else if (p.ref === "severities") opts = asArr(AUTO._masterCache.severities).map((s) => ({ value: s.id, label: s.label || s.id }));
      else if (p.ref === "groups") opts = [{ value: "", label: "— choose group —" }].concat(groups.map((g) => ({ value: g.id, label: g.name })));
      else if (typeof p.options === "function") opts = p.options().map((o) => (typeof o === "object" ? o : { value: o, label: o }));
      if (p.ref && !opts.length) opts = [{ value: "", label: "— none —" }];
      return opts.length ? opts : [{ value: val || "", label: val || "—" }];
    }

    function actionsHtml() {
      return asArr(fs.actions).map((a, i) => {
        const def = AUTO.action(a.type) || { label: a.type, params: [] };
        return '<div class="rmm-auto-action" data-action="' + i + '">' +
          '<div class="erp-btn-row">' +
          '<select data-a-type="' + i + '">' + AUTO.ACTIONS.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === a.type ? " selected" : "") + ">" + esc(x.label) + "</option>").join("") + "</select> " +
          '<label class="erp-check"><input type="checkbox" data-a-essential="' + i + '"' + (a.essential ? " checked" : "") + "> essential (runs during maintenance)</label> " +
          (def.destructive ? ui.badge("destructive", "danger") : "") +
          (def.phase ? ui.badge(def.phase, "muted") : "") +
          ui.btn("✕", { small: true, danger: true, act: "auto-a-del", arg: String(i) }) +
          "</div>" +
          def.params.map((p) => actionParamControl(i, def, p)).join("") +
          "</div>";
      }).join("") + '<div class="erp-btn-row">' + ui.btn("Add action", { small: true, act: "auto-a-add" }) + "</div>";
    }

    function targetHtml() {
      return ui.form(
        ui.text("tg_tags", "Tags", asArr(fs.target.tags).join(", "), "comma separated — e.g. prod, server") +
        '<div class="field"><label>Groups</label><div class="rmm-check-list">' + (groups.length ? groups.map((g) => '<label class="erp-check"><input type="checkbox" data-tg-group="' + esc(g.id) + '"' + (asArr(fs.target.groupIds).map(String).indexOf(String(g.id)) !== -1 ? " checked" : "") + "> " + esc(g.name) + "</label>").join("") : '<span class="erp-sub">No groups.</span>') + "</div></div>" +
        '<div class="field"><label>Sites</label><div class="rmm-check-list">' + (sites.length ? sites.map((s) => '<label class="erp-check"><input type="checkbox" data-tg-site="' + esc(s.id) + '"' + (asArr(fs.target.siteIds).map(String).indexOf(String(s.id)) !== -1 ? " checked" : "") + "> " + esc(s.name) + "</label>").join("") : '<span class="erp-sub">No sites.</span>') + "</div></div>" +
        '<div class="field"><label>Devices</label><div class="rmm-check-list">' + devices.map((d) => '<label class="erp-check"><input type="checkbox" data-tg-dev="' + esc(d.id) + '"' + (asArr(fs.target.deviceIds).map(String).indexOf(String(d.id)) !== -1 ? " checked" : "") + "> " + esc(d.hostname || d.displayName) + "</label>").join("") + "</div></div>",
        ""
      );
    }

    const body = ui.form(
      ui.text("name", "Rule name", isEdit ? rule.name : "") +
      ui.text("description", "Description", isEdit ? rule.description : "") +
      ui.select("trigger_type", "Trigger", AUTO.TRIGGERS.map((t) => ({ value: t.id, label: t.label })), isEdit ? rule.trigger.type : "alert.fired") +
      '<div class="field"><label>Trigger filter (optional)</label><div class="erp-btn-row">' +
      '<input type="text" name="f_monitorId" placeholder="monitor id" value="' + esc(isEdit ? rule.trigger.filter.monitorId : "") + '">' +
      '<input type="text" name="f_severity" placeholder="severity id (at least)" value="' + esc(isEdit ? rule.trigger.filter.severityAtLeast : "") + '">' +
      '<input type="text" name="f_tag" placeholder="device tag" value="' + esc(isEdit ? rule.trigger.filter.tag : "") + '">' +
      '<input type="text" name="f_schedule" placeholder="schedule id (for schedule trigger)" value="' + esc(isEdit ? rule.trigger.filter.scheduleId : "") + '">' +
      "</div></div>" +
      '<h4 class="rmm-section-title">Conditions</h4><div data-conditions>' + conditionsHtml() + "</div>" +
      '<h4 class="rmm-section-title">Target devices</h4><div data-target>' + targetHtml() + "</div>" +
      '<h4 class="rmm-section-title">Actions</h4><div data-actions>' + actionsHtml() + "</div>" +
      '<h4 class="rmm-section-title">Safety</h4><div class="erp-btn-row">' +
      '<label class="erp-check"><input type="checkbox" name="requireApproval"' + (isEdit && rule.requireApproval ? " checked" : "") + "> require approval for destructive actions</label>" +
      '<label class="erp-check"><input type="checkbox" name="allowDuringMaintenance"' + (isEdit && rule.allowDuringMaintenance ? " checked" : "") + "> run during maintenance windows</label>" +
      ui.number("cooldownMinutes", "Cooldown (min)", isEdit ? rule.cooldownMinutes : 0, { hint: "0 = no cooldown" }) +
      "</div>",
      ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isEdit ? "Save rule" : "Create rule", { small: true, primary: true, act: "auto-save" })
    );
    const m = ui.modal({ title: isEdit ? "Edit " + rule.name : "New automation rule", size: "lg", body });
    if (!m) return;

    function readConditions() {
      return [...m.querySelectorAll("[data-cond-row]")].map((row) => {
        const f = row.querySelector("[data-cond-field]").value;
        const o = row.querySelector("[data-cond-op]").value;
        const vEl = row.querySelector("[data-cond-field-val]");
        let value = vEl ? vEl.value : "";
        if (((G && G.field(f)) || {}).type === "bool") value = value === "true";
        return { field: f, op: o, value };
      });
    }
    function readActions() {
      return [...m.querySelectorAll("[data-action]")].map((row, i) => {
        const type = row.querySelector("[data-a-type]").value;
        const def = AUTO.action(type) || { params: [] };
        const params = {};
        def.params.forEach((p) => {
          const el = row.querySelector('[name="ap' + i + "_" + p.key + '"]');
          if (!el) return;
          params[p.key] = el.type === "checkbox" ? el.checked : el.value;
          if (p.type === "number") params[p.key] = num(params[p.key], 0);
        });
        return { type, params, essential: row.querySelector("[data-a-essential]").checked };
      });
    }
    function readTarget() {
      return {
        tags: String(m.querySelector('[name="tg_tags"]').value || "").split(",").map((x) => x.trim()).filter(Boolean),
        groupIds: [...m.querySelectorAll("[data-tg-group]")].filter((i) => i.checked).map((i) => i.getAttribute("data-tg-group")),
        siteIds: [...m.querySelectorAll("[data-tg-site]")].filter((i) => i.checked).map((i) => i.getAttribute("data-tg-site")),
        deviceIds: [...m.querySelectorAll("[data-tg-dev]")].filter((i) => i.checked).map((i) => i.getAttribute("data-tg-dev")),
      };
    }
    function syncFromDom() { fs.conditions = readConditions(); fs.actions = readActions(); fs.target = readTarget(); const mm = m.querySelector("[data-cond-match]"); if (mm) fs.match = mm.value; }

    m.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-act]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      const arg = Number(t.getAttribute("data-arg"));
      if (act === "auto-cond-add") { syncFromDom(); if (fs.conditions.length >= condCap()) return; fs.conditions.push({ field: "os.family", op: "is", value: "" }); m.querySelector("[data-conditions]").innerHTML = conditionsHtml(); return; }
      if (act === "auto-cond-del") { syncFromDom(); fs.conditions.splice(arg, 1); m.querySelector("[data-conditions]").innerHTML = conditionsHtml(); return; }
      if (act === "auto-a-add") { syncFromDom(); fs.actions.push({ type: "send-notification", params: {}, essential: false }); m.querySelector("[data-actions]").innerHTML = actionsHtml(); return; }
      if (act === "auto-a-del") { syncFromDom(); fs.actions.splice(arg, 1); m.querySelector("[data-actions]").innerHTML = actionsHtml(); return; }
    });
    m.addEventListener("change", (e) => {
      if (e.target.hasAttribute && e.target.hasAttribute("data-a-type")) { syncFromDom(); m.querySelector("[data-actions]").innerHTML = actionsHtml(); return; }
      if (e.target.hasAttribute && e.target.hasAttribute("data-cond-field")) { syncFromDom(); const idx = Number(e.target.getAttribute("data-cond-field")); const ops = G ? G.operatorsFor(e.target.value) : []; if (ops.length) fs.conditions[idx] = { field: e.target.value, op: ops[0].id, value: "" }; m.querySelector("[data-conditions]").innerHTML = conditionsHtml(); return; }
      if (e.target.hasAttribute && (e.target.hasAttribute("data-cond-match") || e.target.hasAttribute("data-cond-op") || e.target.hasAttribute("data-cond-field-val"))) {
        syncFromDom();
        const pv = m.querySelector("[data-rule-preview]");
        if (pv && G) pv.textContent = fs.conditions.length ? G.ruleSummary({ match: fs.match, conditions: fs.conditions }, { provider }) : "No conditions — every targeted device matches.";
      }
    });
    m.querySelector("[data-act=auto-save]").onclick = async () => {
      syncFromDom();
      const v = ui.collect(m, ["name", "description", "trigger_type", "f_monitorId", "f_severity", "f_tag", "f_schedule", "cooldownMinutes"]);
      const payload = {
        name: v.name, description: v.description, requireApproval: m.querySelector('[name="requireApproval"]').checked,
        allowDuringMaintenance: m.querySelector('[name="allowDuringMaintenance"]').checked, cooldownMinutes: v.cooldownMinutes,
        trigger: { type: v.trigger_type, filter: { monitorId: v.f_monitorId, severityAtLeast: v.f_severity, tag: v.f_tag, scheduleId: v.f_schedule } },
        conditions: { match: fs.match, items: fs.conditions },
        target: fs.target,
        actions: fs.actions,
      };
      const r = isEdit ? await AUTO.update(provider.id, rule.id, payload) : await AUTO.add(provider.id, payload);
      if (r.error) { ctxToast("Save failed: " + (r.error === "invalid" ? (r.errors || []).join("; ") : r.error), "error"); return; }
      ui.closeModal();
      ctxToast(isEdit ? "Rule saved" : "Rule created");
      ctxPaint();
    };
  }

  /* ── run detail modal ── */
  async function openRunDetail(provider, ruleId, runId) {
    const ui = ERP.ui, esc = ui.esc;
    const runs = await AUTO.runs(provider.id, { ruleId });
    const run = runs.find((r) => String(r.id) === String(runId));
    if (!run) return;
    const rows = asArr(run.targets).map((t) => ({
      device: '<b>' + esc(t.hostname || t.deviceId) + "</b>" + (t.suppressed ? " " + ui.badge("maintenance", "warn") : ""),
      actions: asArr(t.actions).map((a) => actionStatusBadge(a.status) + " " + esc(a.label || a.type) + (a.detail ? ' <span class="erp-sub">' + esc(a.detail) + "</span>" : "")).join("<br>") || '<span class="erp-sub">none</span>',
    }));
    const body = '<div class="rmm-status-line">' + runStatusBadge(run.status) + " " + ui.badge(AUTO.triggerLabel(run.triggerType), "info") + (run.dryRun ? " " + ui.badge("dry run", "muted") : "") + "</div>" +
      '<p class="erp-sub">' + esc(run.summary || "") + " · started " + esc(ui.dateTime(run.startedAt)) + (run.endedAt ? " · ended " + esc(ui.dateTime(run.endedAt)) : "") + "</p>" +
      (run.approval ? ui.alert("Approved by " + run.approval.by + " at " + ui.dateTime(run.approval.at), "info") : "") +
      ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "actions", label: "Actions", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "This run matched no devices." });
    ui.modal({ title: "Run " + run.id, size: "lg", body });
  }

  /* ── mount ── */
  let ctxToast = ERP.toast, ctxPaint = () => {};

  async function mount(host, ctx, opts) {
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { host.innerHTML = '<div class="erp-alert">No service providers yet.</div>'; return; }
    const TABS = ["rules", "runs", "schedules", "library"];
    const state = {
      pid: (AUTO.currentProviderId && providers.some((p) => p.id === AUTO.currentProviderId)) ? AUTO.currentProviderId : (opts.providerId || providers[0].id),
      tab: TABS.indexOf(opts.tab) !== -1 ? opts.tab : "rules",
    };
    AUTO.currentProviderId = state.pid;
    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    async function paint() {
      const p = await prov();
      if (!p) { host.innerHTML = '<div class="erp-alert">This tenant could not be loaded.</div>'; return; }
      await AUTO.refreshMasterCache();
      const stats = AUTO.statsOf(p);
      const tabs = ui.tabs([
        { id: "rules", label: "Rules", badge: String(stats.total) },
        { id: "runs", label: "Run history", badge: String(stats.runs) },
        { id: "schedules", label: "Schedules & windows" },
        { id: "library", label: "Script library" },
      ], state.tab);
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = (opts.headHtml || "") + tabs.html + picker;
      host.querySelector('[data-panel="rules"]').innerHTML = rulesPanel(p);
      host.querySelector('[data-panel="runs"]').innerHTML = await runsPanel(p);
      host.querySelector('[data-panel="schedules"]').innerHTML = "";
      host.querySelector('[data-panel="library"]').innerHTML = "";
      scopedShowTab(host, state.tab);
      if (state.tab === "schedules") {
        const Sch = SCH();
        if (Sch && Sch.renderInto) await Sch.renderInto(host.querySelector('[data-panel="schedules"]'), { providers, providerId: state.pid, embedded: true, toast: ctx.toast });
      }
      if (state.tab === "library") {
        const L = LIB();
        if (L && L.renderInto) await L.renderInto(host.querySelector('[data-panel="library"]'), { providers, providerId: state.pid, embedded: true, toast: ctx.toast });
      }
    }

    ctxToast = ctx.toast || ERP.toast;
    ctxPaint = paint;

    ui.bind(host, "click", "[data-tab]", (t) => {
      const ctn = t.parentElement && t.parentElement.parentElement;
      if (!ctn) return;
      scopedShowTab(ctn, t.getAttribute("data-tab"));
      state.tab = t.getAttribute("data-tab");
      if (state.tab === "schedules" || state.tab === "library") paint();
    });

    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      const p = await prov();
      if (!p) return;
      const toast = ctx.toast || ERP.toast;
      if (act === "auto-add") return openRuleForm(p, null);
      if (act === "auto-edit") { const r = AUTO.listOf(p).find((x) => String(x.id) === String(arg)); if (r) return openRuleForm(p, r); return; }
      if (act === "auto-dup") { const r = await AUTO.duplicate(state.pid, arg); if (r.error) return toast("Duplicate failed: " + r.error, "error"); toast("Duplicated"); return paint(); }
      if (act === "auto-toggle") { const r = AUTO.listOf(p).find((x) => String(x.id) === String(arg)); const w = await AUTO.setEnabled(state.pid, arg, !(r && r.enabled !== false)); if (w.error) return toast("Update failed: " + w.error, "error"); return paint(); }
      if (act === "auto-del") {
        const r = AUTO.listOf(p).find((x) => String(x.id) === String(arg));
        const ok = await ui.confirm({ title: "Delete automation", message: "Delete “" + (r ? r.name : arg) + "” and its run history?", okLabel: "Delete", danger: true });
        if (!ok) return;
        const w = await AUTO.remove(state.pid, arg);
        if (w.error) return toast("Delete failed: " + w.error, "error");
        toast("Deleted"); return paint();
      }
      if (act === "auto-run") {
        const r = await AUTO.run(state.pid, arg, { allTargets: true, event: { type: "manual", at: now() } });
        if (r.error) return toast("Run failed: " + r.error, "error");
        if (r.pending) toast("Run is waiting for approval", "warn");
        else if (r.run) toast("Run " + r.run.status + " — " + r.run.summary);
        return paint();
      }
      if (act === "auto-dry") {
        const r = await AUTO.dryRun(state.pid, arg, { type: "manual", at: now() }, { allTargets: true });
        if (r.error) return toast("Dry run failed: " + r.error, "error");
        return dryRunModal(p, r);
      }
      if (act === "auto-run-detail") { const [rid, runId] = String(arg).split("|"); return openRunDetail(p, rid, runId); }
      if (act === "auto-approve") { const [rid, runId] = String(arg).split("|"); const r = await AUTO.approve(state.pid, rid, runId, ERP.role); if (r.error) return toast("Approve failed: " + r.error, "error"); toast("Approved — run " + r.run.status); return paint(); }
      if (act === "auto-reject") { const [rid, runId] = String(arg).split("|"); const r = await AUTO.reject(state.pid, rid, runId, ERP.role); if (r.error) return toast("Reject failed: " + r.error, "error"); toast("Rejected"); return paint(); }
    });
    host.addEventListener("change", (e) => { if (e.target && e.target.name === "pid") { state.pid = e.target.value; AUTO.currentProviderId = state.pid; paint(); } });

    await paint();
    return state;
  }

  function dryRunModal(provider, plan) {
    const ui = ERP.ui, esc = ui.esc;
    const rows = asArr(plan.targets).map((t) => ({
      device: '<b>' + esc(t.hostname) + "</b>" + (t.suppressed ? " " + ui.badge("maintenance", "warn") : ""),
      actions: asArr(t.actions).map((a) => actionStatusBadge(a.status) + " " + esc(a.label || a.type)).join(" ") || '<span class="erp-sub">none</span>',
    }));
    const body = '<div class="rmm-status-line">' + ui.badge("dry run — nothing was executed", "info") + (plan.destructive ? " " + ui.badge("includes a destructive action", "danger") : "") + (plan.requiresApproval ? " " + ui.badge("approval required", "warn") : "") + "</div>" +
      '<p class="erp-sub">' + esc(plan.summary) + "</p>" +
      (asArr(plan.phases).length ? ui.alert("Some actions are not implemented until: " + asArr(plan.phases).join(", ") + ". They are reported as skipped.", "warn") : "") +
      ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "actions", label: "Planned actions", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No devices match this rule." });
    ui.modal({ title: "Dry run · " + (plan.rule ? plan.rule.name : ""), size: "lg", body });
  }

  AUTO.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "rmm-automations";
    host.innerHTML = "";
    host.appendChild(wrap);
    const head = opts.headHtml || ERP.ui.pageHead("Automations",
      "Trigger → condition → action rules over your fleet: alerts, monitor state, device presence, schedules and webhooks drive scripts, remediations, notifications, tagging and webhooks — with dry-run preview, approval gating for destructive actions and a full run history.",
      ERP.ui.btn("New rule", { primary: true, act: "auto-add" }));
    return mount(wrap, { toast: opts.toast || ERP.toast }, Object.assign({}, opts, { headHtml: head }));
  };

  AUTO.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const tab = ["rules", "runs", "schedules", "library"].indexOf(el.__tab) !== -1 ? el.__tab : "rules";
    const pid = (AUTO.currentProviderId && providers.some((p) => p.id === AUTO.currentProviderId)) ? AUTO.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-automations";
    el.innerHTML = "";
    el.appendChild(root);
    const head = ERP.ui.pageHead("Automations",
      "Trigger → condition → action rules over your fleet: alerts, monitor state, device presence, schedules and webhooks drive scripts, remediations, notifications, tagging and webhooks — with dry-run preview, approval gating for destructive actions and a full run history.",
      ERP.ui.btn("New rule", { primary: true, act: "auto-add" }));
    await mount(root, ctx, { providers, providerId: pid, tab, headHtml: head });
    return { pid };
  };
})();
