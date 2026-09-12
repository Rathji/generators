/* ============================================================
   RMM-U — policy engine  (Phase 4 · Task 19)

   A policy is a named bundle of monitoring, patch, software and
   automation settings applied to devices. Policies live on the
   provider aggregate (`provider.policies`) and are SPARSE: a policy
   only stores the settings it explicitly overrides, so a setting it
   does not mention is inherited from a lower-precedence policy (or,
   failing that, from the schema default).

   Precedence (highest wins) is fully deterministic:

     1. priority            — higher number wins
     2. specificity         — device > tag > group > site > provider-wide
     3. updatedAt           — the more recently edited wins
     4. id                  — a final, stable tie-breaker

   A device's EFFECTIVE policy is produced by walking the applicable
   policies in that order and taking the first that sets each field —
   `P.effective()` returns both the ordered chain and, per setting, the
   policy it came from, which is exactly what the console's
   effective-policy preview shows ("what will this device receive, and
   from where?").

   Targeting is shared with device groups and monitors: `groupIds`,
   `tags` and `deviceIds` are resolved through `ERP.groups.matchTargets`,
   so a dynamic group, a tag and an explicit device all mean the same
   thing here as they do everywhere else.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const G = ERP.groups || null;
  const P = (ERP.policies = {});

  P.MODULE = "policies";
  P.ID_PREFIX = "pol";
  P.DEFAULT_PRIORITY = 100;

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const uniq = (a) => [...new Set(a)];

  const SEV_LABELS = { "sev-info": "Info", "sev-warning": "Warning", "sev-critical": "Critical", "sev-emergency": "Emergency" };
  P.severityLabel = (id) => SEV_LABELS[id] || id;

  /* ─────────────────────── the setting schema ───────────────────────

     Each category is a flat group of typed fields. `type` drives the
     editor control and how a stored value is normalised:
       bool    true/false
       number  numeric (with optional min/unit)
       select  one of `options`
       list    comma-separated string list
       text    free text                                                        */

  const SCHEMA = [
    {
      id: "monitoring", label: "Monitoring", icon: "monitors",
      desc: "What the agent collects, how often, and when it is considered offline.",
      fields: [
        { key: "collectInventory", label: "Collect hardware & software inventory", type: "bool", default: true },
        { key: "collectMetrics", label: "Collect performance metrics", type: "bool", default: true },
        { key: "metricsIntervalSeconds", label: "Metrics interval", type: "number", unit: "seconds", default: 60, min: 10 },
        { key: "inventoryIntervalHours", label: "Inventory interval", type: "number", unit: "hours", default: 24, min: 1 },
        { key: "serviceMonitorEnabled", label: "Monitor critical services", type: "bool", default: true },
        { key: "agentOfflineMinutes", label: "Agent offline after", type: "number", unit: "minutes", default: 15, min: 1 },
      ],
    },
    {
      id: "patch", label: "Patch management", icon: "patches",
      desc: "Patch approval, deployment and the reboot the device may take.",
      fields: [
        { key: "autoApprove", label: "Auto-approve patches", type: "bool", default: false },
        { key: "classifications", label: "Approved classifications", type: "list", default: ["CriticalUpdates", "SecurityUpdates", "DefinitionUpdates"], ph: "vendor classification codes, comma-separated" },
        { key: "rebootPolicy", label: "Reboot policy", type: "select", options: ["never", "if-required", "always", "in-window"], default: "if-required" },
        { key: "rebootGraceMinutes", label: "Reboot grace period", type: "number", unit: "minutes", default: 30, min: 0 },
        { key: "missingPatchGraceDays", label: "Missing-patch grace", type: "number", unit: "days", default: 14, min: 0 },
        { key: "patchWindow", label: "Patch window", type: "text", default: "", ph: "e.g. nightly 01:00-05:00" },
      ],
    },
    {
      id: "software", label: "Software deployment", icon: "software",
      desc: "How packages are installed, updated and reported.",
      fields: [
        { key: "allowUserInstall", label: "Allow end users to install software", type: "bool", default: false },
        { key: "autoUpdate", label: "Auto-update managed software", type: "bool", default: true },
        { key: "deploymentWindow", label: "Deployment window", type: "text", default: "", ph: "e.g. after hours" },
        { key: "packageRepo", label: "Package repository", type: "text", default: "", ph: "URL or UNC share" },
      ],
    },
    {
      id: "automation", label: "Automation & remote access", icon: "automations",
      desc: "Remote tooling, script policy and the alerting default.",
      fields: [
        { key: "remoteAccess", label: "Allow remote access sessions", type: "bool", default: true },
        { key: "scriptPolicy", label: "Script execution policy", type: "select", options: ["allow", "approve", "deny"], default: "approve" },
        { key: "maintenanceWindowsEnabled", label: "Honour maintenance windows", type: "bool", default: true },
        { key: "notifyOnAlert", label: "Notify on alert", type: "bool", default: true },
        { key: "alertSeverityFloor", label: "Minimum alert severity", type: "select", options: ["sev-info", "sev-warning", "sev-critical", "sev-emergency"], severity: true, default: "sev-warning" },
      ],
    },
  ];

  const FIELD_INDEX = {};
  SCHEMA.forEach((c) => c.fields.forEach((f) => { FIELD_INDEX[c.id + "." + f.key] = { category: c.id, field: f }; }));

  P.SCHEMA = SCHEMA;
  P.CATEGORIES = SCHEMA.map((c) => c.id);
  P.fieldKey = (cat, key) => cat + "." + key;
  P.fieldDef = (cat, key) => FIELD_INDEX[cat + "." + key] || null;
  P.category = (id) => SCHEMA.find((c) => c.id === id) || null;
  P.defaultFor = (cat, key) => { const d = P.fieldDef(cat, key); return d ? clone(d.field.default) : undefined; };
  P.fieldLabel = (key) => { const d = FIELD_INDEX[key]; return d ? d.field.label : key; };

  /* ─────────────────────── normalisation ─────────────────────── */

  /* Keep only the keys a policy actually sets, coerced to the schema
     type — that sparseness is what makes inheritance work. */
  function normalizeSettings(raw) {
    raw = asObj(raw);
    const out = {};
    SCHEMA.forEach((c) => {
      const cat = asObj(raw[c.id]);
      const rec = {};
      c.fields.forEach((f) => {
        if (!Object.prototype.hasOwnProperty.call(cat, f.key)) return;
        const v = cat[f.key];
        if (v == null || v === "") return;
        if (f.type === "bool") rec[f.key] = !!v;
        else if (f.type === "number") rec[f.key] = num(v, f.default);
        else if (f.type === "list") rec[f.key] = uniq((Array.isArray(v) ? v : String(v).split(",")).map((x) => S(x, 60).trim()).filter(Boolean));
        else rec[f.key] = S(v, 200);
      });
      if (Object.keys(rec).length) out[c.id] = rec;
    });
    return out;
  }
  P.normalizeSettings = normalizeSettings;

  function normalizePolicy(data) {
    data = asObj(data);
    const targets = asObj(data.targets);
    return {
      kind: "policy",
      id: data.id || T.newItemId("policies"),
      name: S(data.name, 120) || "Untitled policy",
      description: S(data.description, 600),
      enabled: data.enabled === undefined ? true : !!data.enabled,
      priority: num(data.priority, P.DEFAULT_PRIORITY),
      siteId: data.siteId != null && data.siteId !== "" ? String(data.siteId) : null,
      targets: {
        groupIds: uniq(asArr(targets.groupIds).map(String)),
        tags: uniq(asArr(targets.tags).map(String)),
        deviceIds: uniq(asArr(targets.deviceIds).map(String)),
      },
      settings: normalizeSettings(data.settings),
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };
  }
  P.normalizePolicy = normalizePolicy;
  P.newPolicy = normalizePolicy;

  P.countSettings = function (policy) {
    let n = 0;
    Object.keys(asObj(asObj(policy).settings)).forEach((c) => { n += Object.keys(asObj(asObj(policy).settings)[c]).length; });
    return n;
  };

  P.validate = function (policy) {
    const errors = [];
    if (!policy || typeof policy !== "object") return { valid: false, errors: ["policy is not an object"] };
    if (!String(policy.name || "").trim()) errors.push("name is required");
    if (!isFinite(Number(policy.priority))) errors.push("priority must be a number");
    if (policy.siteId != null && !["string", "number"].includes(typeof policy.siteId)) errors.push("siteId must be a string");
    Object.keys(asObj(policy.settings)).forEach((cat) => {
      if (P.CATEGORIES.indexOf(cat) === -1) { errors.push("unknown setting category: " + cat); return; }
      Object.keys(asObj(policy.settings)[cat]).forEach((k) => { if (!P.fieldDef(cat, k)) errors.push("unknown setting: " + cat + "." + k); });
    });
    return { valid: errors.length === 0, errors };
  };

  /* ─────────────────────── applicability & precedence ─────────────────────── */

  function isTargeted(policy) {
    const t = asObj(policy.targets);
    return asArr(t.groupIds).length + asArr(t.tags).length + asArr(t.deviceIds).length > 0;
  }
  P.isTargeted = isTargeted;

  /* Does a policy apply to this device, and why? */
  P.applies = function (provider, policy, dev, ctx) {
    if (!policy || !dev || !policy.enabled) return { match: false, matchedBy: null, specificity: 0 };
    if (policy.siteId != null && String(dev.siteId || "") !== String(policy.siteId)) return { match: false, matchedBy: null, specificity: 0 };
    if (G && typeof G.matchTargets === "function") return G.matchTargets(provider, policy.targets, dev, ctx || { provider });
    const t = asObj(policy.targets);
    const empty = !asArr(t.groupIds).length && !asArr(t.tags).length && !asArr(t.deviceIds).length;
    return empty ? { match: true, matchedBy: "provider", specificity: 0 } : { match: false, matchedBy: null, specificity: 0 };
  };

  /* Every enabled, applicable policy for a device, ordered strongest-first. */
  P.orderForDevice = function (provider, dev, ctx) {
    ctx = ctx || { provider };
    const rows = [];
    asArr(provider && provider.policies).map(normalizePolicy).forEach((pol) => {
      const m = P.applies(provider, pol, dev, ctx);
      if (!m.match) return;
      rows.push({ policy: pol, matchedBy: m.matchedBy, specificity: m.specificity, groupId: m.groupId, tag: m.tag, reason: m });
    });
    rows.sort((a, b) => {
      if (b.policy.priority !== a.policy.priority) return b.policy.priority - a.policy.priority;
      if (b.specificity !== a.specificity) return b.specificity - a.specificity;
      const u = String(b.policy.updatedAt || "").localeCompare(String(a.policy.updatedAt || ""));
      if (u) return u;
      return String(a.policy.id).localeCompare(String(b.policy.id));
    });
    return rows;
  };

  /* The resolved settings for a device: the precedence chain plus, per
     setting, the value and the policy (or schema default) it came from. */
  P.effectiveOf = function (provider, dev, ctx) {
    ctx = ctx || { provider };
    const ordered = P.orderForDevice(provider, dev, ctx);
    const values = {};
    const counts = { policy: 0, default: 0 };
    SCHEMA.forEach((c) => {
      c.fields.forEach((f) => {
        const key = c.id + "." + f.key;
        let hit = null;
        for (const row of ordered) {
          const cat = asObj(row.policy.settings[c.id]);
          if (Object.prototype.hasOwnProperty.call(cat, f.key) && cat[f.key] != null) { hit = { value: clone(cat[f.key]), row }; break; }
        }
        if (hit) {
          values[key] = {
            value: hit.value, source: "policy", policyId: hit.row.policy.id, policyName: hit.row.policy.name,
            priority: hit.row.policy.priority, specificity: hit.row.specificity, matchedBy: hit.row.matchedBy,
          };
          counts.policy++;
        } else {
          values[key] = { value: clone(f.default), source: "default", policyId: null, policyName: "Schema default", priority: null, specificity: -1, matchedBy: null };
          counts.default++;
        }
      });
    });
    return {
      deviceId: dev.id, hostname: dev.hostname || dev.displayName,
      ordered: ordered.map((r) => ({
        policyId: r.policy.id, name: r.policy.name, priority: r.policy.priority, specificity: r.specificity,
        matchedBy: r.matchedBy, groupId: r.groupId || null, tag: r.tag || null, settingsCount: P.countSettings(r.policy),
      })),
      applied: ordered.map((r) => r.policy.id),
      values, counts,
    };
  };

  P.effective = async function (providerId, deviceId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = asArr(g.provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "device_not_found", deviceId };
    const idx = await loadIndex(providerId);
    const ctx = { provider: g.provider, soft: idx.soft, svc: idx.svc, patches: idx.patches };
    return Object.assign({ provider: g.provider }, P.effectiveOf(g.provider, dev, ctx));
  };

  let _indexCache = null;
  async function loadIndex(providerId) {
    if (G && typeof G.loadIndex === "function") return G.loadIndex(providerId);
    return { soft: {}, svc: {}, patches: {} };
  }
  P.loadIndex = loadIndex;

  /* ─────────────────────── reads ─────────────────────── */

  P.get = async function (providerId, policyId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const pol = asArr(g.provider.policies).find((x) => String(x.id) === String(policyId));
    if (!pol) return { error: "not_found", policyId };
    return { policy: normalizePolicy(pol), provider: g.provider, rev: g.rev };
  };

  P.list = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(g.provider.policies).map(normalizePolicy);
  };

  P.listOf = (provider) => asArr(provider && provider.policies).map(normalizePolicy);

  P.forGroup = (provider, groupId) => asArr(provider && provider.policies).map(normalizePolicy).filter((p) => asArr(p.targets.groupIds).some((g) => String(g) === String(groupId)));
  P.forTag = (provider, tag) => asArr(provider && provider.policies).map(normalizePolicy).filter((p) => asArr(p.targets.tags).map(low).indexOf(low(tag)) !== -1);

  P.statsOf = function (provider) {
    const policies = P.listOf(provider);
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const coverage = {};
    SCHEMA.forEach((c) => { coverage[c.id] = 0; });
    const targeted = new Set();
    policies.forEach((p) => {
      Object.keys(asObj(p.settings)).forEach((c) => { if (coverage[c] != null) coverage[c]++; });
      asArr(p.targets.groupIds).forEach((g) => targeted.add("g:" + g));
      asArr(p.targets.tags).forEach((t) => targeted.add("t:" + t));
      asArr(p.targets.deviceIds).forEach((d) => targeted.add("d:" + d));
    });
    const withPolicy = devices.filter((dev) => P.orderForDevice(provider, dev, { provider }).length).length;
    return {
      total: policies.length,
      enabled: policies.filter((p) => p.enabled).length,
      disabled: policies.filter((p) => !p.enabled).length,
      providerWide: policies.filter((p) => !isTargeted(p)).length,
      targeted: policies.filter(isTargeted).length,
      coverage, targetedRefs: targeted.size,
      devices: devices.length, withPolicy, withoutPolicy: devices.length - withPolicy,
    };
  };

  P.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return P.statsOf(g.provider);
  };

  /* ─────────────────────── CRUD ─────────────────────── */

  function siteCheck(provider, siteId) {
    if (siteId == null || siteId === "") return true;
    return asArr(provider.sites).some((s) => String(s.id) === String(siteId));
  }

  P.add = async function (providerId, data) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const pol = normalizePolicy(data);
    if (!siteCheck(g.provider, pol.siteId)) return { error: "unknown_site", siteId: pol.siteId };
    const v = P.validate(pol);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await T.addItem(providerId, "policies", pol);
    if (r.error) return r;
    return { policy: normalizePolicy(r.item), rev: r.rev };
  };

  P.update = async function (providerId, policyId, patch) {
    const g = await T.get(providerId);
    if (g.error) return g;
    if (patch && patch.siteId != null && patch.siteId !== "" && !siteCheck(g.provider, patch.siteId)) return { error: "unknown_site", siteId: patch.siteId };
    let out = null;
    const r = await T.updateItem(providerId, "policies", policyId, (it) => {
      const merged = Object.assign({}, it, asObj(patch), { id: it.id, kind: "policy", createdAt: it.createdAt });
      const norm = normalizePolicy(merged);
      Object.assign(it, norm, { id: it.id, kind: "policy", createdAt: it.createdAt });
      out = it;
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", policyId };
    return { policy: normalizePolicy(out), rev: r.rev };
  };

  P.remove = async function (providerId, policyId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const r = await T.removeItem(providerId, "policies", policyId);
    if (r.error) return r;
    return { removed: policyId };
  };

  P.setEnabled = (providerId, policyId, enabled) => P.update(providerId, policyId, { enabled: !!enabled });

  P.duplicate = async function (providerId, policyId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const src = asArr(g.provider.policies).find((x) => String(x.id) === String(policyId));
    if (!src) return { error: "not_found", policyId };
    const copy = normalizePolicy(Object.assign({}, src, { id: null, name: src.name + " (copy)", createdAt: null }));
    return P.add(providerId, copy);
  };

  /* ─────────────────────── seed / boot ─────────────────────── */

  P.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.policyEnabled", true) === false) return { skipped: true, reason: "policy_disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    const existing = new Set(asArr(g.provider.policies).map((p) => low(p.name)));
    const created = [];
    const seed = [
      {
        name: "Standard workstation baseline", priority: 100,
        description: "Provider-wide defaults every managed device inherits unless a more specific policy overrides them.",
        settings: {
          monitoring: { collectInventory: true, collectMetrics: true, metricsIntervalSeconds: 120, inventoryIntervalHours: 24 },
          patch: { autoApprove: true, rebootPolicy: "if-required", missingPatchGraceDays: 21 },
          software: { autoUpdate: true, allowUserInstall: false },
          automation: { scriptPolicy: "approve", notifyOnAlert: true },
        },
      },
      {
        name: "Production servers", priority: 200, targets: { tags: ["prod"] },
        description: "Tighter monitoring and an in-window reboot policy for anything tagged prod.",
        settings: {
          monitoring: { metricsIntervalSeconds: 30, agentOfflineMinutes: 5 },
          patch: { rebootPolicy: "in-window", rebootGraceMinutes: 60, missingPatchGraceDays: 7 },
          automation: { remoteAccess: true, alertSeverityFloor: "sev-info" },
        },
      },
    ];
    for (const data of seed) {
      if (!opts.force && existing.has(low(data.name))) continue;
      const r = await P.add(demo.id, data);
      if (r.error) continue;
      created.push(r.policy.id);
    }
    return { providerId: demo.id, created };
  };

  P.init = async function () { try { await T.ready; await P.seedDemo(); } catch (e) { console.error("policies seed failed", e); } };

  /* ═══════════════════════ Policies station ═══════════════════════ */

  P.currentProviderId = null;

  P.render = async function (ctx) {
    const ui = ERP.ui, esc = ui.esc;
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { ctx.empty(); return; }

    const TABS = ["policies", "effective"];
    const state = {
      pid: (P.currentProviderId && providers.some((p) => p.id === P.currentProviderId)) ? P.currentProviderId : providers[0].id,
      tab: TABS.indexOf(el.__tab) !== -1 ? el.__tab : "policies",
      effDev: null,
    };
    P.currentProviderId = state.pid;

    const root = document.createElement("div");
    root.className = "rmm-policies";
    el.innerHTML = "";
    el.appendChild(root);

    const cache = { provider: null, ctx: null, stats: null };
    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    async function loadCtx(p) {
      const idx = await loadIndex(state.pid);
      return { provider: p, soft: idx.soft, svc: idx.svc, patches: idx.patches };
    }

    function deviceChip(d) {
      const tone = D.statusMeta(D.effectiveStatus(d)).tone;
      return '<span class="rmm-dev-chip is-static"><span class="rmm-dot tone-' + tone + '"></span><span class="rmm-dev-chip-name">' + esc(d.hostname || d.displayName) + "</span></span>";
    }

    async function paint() {
      const p = await prov();
      if (!p) { ctx.error({ title: "Provider not found", message: "This tenant's document could not be loaded." }); return; }
      cache.provider = p;
      cache.ctx = await loadCtx(p);
      const policies = P.listOf(p);
      const stats = P.statsOf(p);
      cache.stats = stats;
      const tabs = ui.tabs([
        { id: "policies", label: "Policies", badge: String(policies.length) },
        { id: "effective", label: "Effective preview" },
      ], state.tab);
      const head = ui.pageHead("Policy engine",
        "A policy is a named set of monitoring, patch, software and automation settings. Policies are sparse — a setting a policy omits is inherited from a lower-precedence policy, or from the schema default.",
        ui.btn("New policy", { primary: true, act: "pol-add" }));
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 260px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") +
          "</select></div></div>"
        : "";
      root.innerHTML = head + picker + tabs.html;
      root.querySelector('[data-panel="policies"]').innerHTML = policiesPanelHtml(p, policies, stats);
      root.querySelector('[data-panel="effective"]').innerHTML = await effectivePanelHtml(p);
      ui.showTab(root, state.tab);
    }

    function policiesPanelHtml(p, policies, stats) {
      const rows = policies.slice().sort((a, b) => b.priority - a.priority || String(a.name).localeCompare(String(b.name))).map((pol) => {
        const n = P.countSettings(pol);
        return {
          name: "<b>" + esc(pol.name) + "</b>" + (pol.description ? '<div class="erp-sub">' + esc(pol.description) + "</div>" : ""),
          priority: '<span class="erp-sub">priority ' + pol.priority + "</span>",
          targets: '<span class="erp-sub">' + esc(G ? G.targetSummary(p, pol.targets, cache.ctx) : "every device") + (pol.siteId ? " · site scope" : "") + "</span>",
          settings: "<b>" + n + "</b>",
          state: pol.enabled ? ui.badge("enabled", "success") : ui.badge("disabled", "muted"),
          actions: ui.btn("Preview", { small: true, act: "pol-preview", arg: pol.id }) + " " +
            ui.btn("Edit", { small: true, act: "pol-edit", arg: pol.id }) + " " +
            ui.btn("Duplicate", { small: true, act: "pol-dup", arg: pol.id }) + " " +
            ui.btn("Delete", { small: true, danger: true, act: "pol-del", arg: pol.id }),
        };
      });
      const cov = P.SCHEMA.map((c) => ({ label: c.label, value: String(stats.coverage[c.id]) })).slice(0, 4);
      return ui.summary([
        { label: "Policies", value: String(stats.total) },
        { label: "Enabled", value: String(stats.enabled) },
        { label: "Targeted", value: String(stats.targeted) + " / " + stats.total },
        { label: "Devices covered", value: String(stats.withPolicy) + " / " + stats.devices },
      ]) +
        ui.card("Policy coverage", ui.grid(cov.map((c) => ui.statCard({ label: c.label, value: c.value + " policies set" })), "erp-kpi-grid")) +
        ui.card("Policies (" + policies.length + ")",
          ui.table([
            { key: "name", label: "Policy", render: (r) => r.name },
            { key: "priority", label: "Priority", render: (r) => r.priority },
            { key: "targets", label: "Applies to", render: (r) => r.targets },
            { key: "settings", label: "Settings", align: "right", render: (r) => r.settings },
            { key: "state", label: "State", render: (r) => r.state },
            { key: "actions", label: "", render: (r) => r.actions },
          ], rows, { scroll: true, emptyText: "No policies yet — create one, or seed the demo tenant." })) +
        '<p class="erp-sub">Precedence, highest first: <b>priority</b> → <b>specificity</b> (device › tag › group › site › provider-wide) → most recently edited → id. A policy only stores what it overrides.</p>';
    }

    async function effectivePanelHtml(p) {
      const devices = asArr(p.devices).map(D.normalizeDevice);
      if (!devices.length) return ui.card("Effective policy", '<p class="erp-sub">No devices to preview. Enroll a device first.</p>');
      if (!devices.some((d) => String(d.id) === String(state.effDev))) state.effDev = devices[0].id;
      const dev = devices.find((d) => String(d.id) === String(state.effDev));
      const eff = P.effectiveOf(p, dev, await loadCtx(p));
      const options = devices.map((d) => '<option value="' + esc(d.id) + '"' + (String(d.id) === String(dev.id) ? " selected" : "") + ">" + esc(d.hostname || d.displayName) + " · " + esc(d.os.family || d.os.name || "") + "</option>").join("");
      const chain = eff.ordered.length
        ? "<ol class=\"rmm-precedence\">" + eff.ordered.map((o, i) =>
            "<li><b>" + esc(o.name) + "</b> " + ui.badge("#" + (i + 1), "info") +
            ' <span class="erp-sub">priority ' + o.priority + " · matched by " + esc(o.matchedBy) + " · sets " + o.settingsCount + " setting(s)</span></li>").join("") + "</ol>"
        : '<p class="erp-sub">No policy applies to this device — every setting falls back to its schema default.</p>';
      const catBlocks = P.SCHEMA.map((c) => {
        const rows = c.fields.map((f) => {
          const v = eff.values[c.id + "." + f.key];
          return {
            setting: esc(f.label) + (f.unit ? ' <span class="erp-sub">(' + esc(f.unit) + ")</span>" : ""),
            value: "<b>" + esc(formatValue(f, v.value)) + "</b>",
            source: v.source === "policy"
              ? ui.badge(v.policyName, "info") + ' <span class="erp-sub">priority ' + v.priority + " · " + esc(v.matchedBy) + "</span>"
              : ui.badge("schema default", "muted"),
          };
        });
        return ui.card(c.label,
          ui.table([
            { key: "setting", label: "Setting", render: (r) => r.setting },
            { key: "value", label: "Effective value", render: (r) => r.value },
            { key: "source", label: "From", render: (r) => r.source },
          ], rows));
      }).join("");
      return ui.card("Effective policy for " + esc(dev.hostname || dev.displayName),
        '<div class="erp-inline-form"><div class="field" style="flex:1 1 300px"><label>Device</label><select name="effDev">' + options + "</select></div>" +
        '<div class="erp-inline-form-actions">' + ui.btn("Open device", { small: true, act: "pol-open-dev" }) + "</div></div>" +
        ui.summary([
          { label: "Policies in chain", value: String(eff.ordered.length) },
          { label: "Settings from policy", value: String(eff.counts.policy) },
          { label: "Settings from default", value: String(eff.counts.default) },
        ]) +
        '<h4 class="rmm-section-title">Precedence chain</h4>' + chain) +
        '<h4 class="rmm-section-title">Resolved settings</h4>' + catBlocks;
    }

    function formatValue(f, v) {
      if (v == null || v === "") return "—";
      if (f.type === "bool") return v ? "Yes" : "No";
      if (f.severity) return P.severityLabel(v);
      if (f.type === "list") return asArr(v).join(", ") || "—";
      return String(v);
    }

    /* ── policy form ── */

    function settingControl(cat, f, current) {
      const has = current && Object.prototype.hasOwnProperty.call(current, f.key) && current[f.key] != null;
      const val = has ? current[f.key] : "";
      const attr = ' data-pcat="' + esc(cat.id) + '" data-pkey="' + esc(f.key) + '" data-ptype="' + esc(f.type) + '"';
      if (f.type === "bool") {
        return '<select' + attr + '><option value="">— inherit —</option><option value="true"' + (has && val === true ? " selected" : "") + ">Yes</option><option value=\"false\"" + (has && val === false ? " selected" : "") + ">No</option></select>";
      }
      if (f.type === "select") {
        return '<select' + attr + '><option value="">— inherit —</option>' + f.options.map((o) => '<option value="' + esc(o) + '"' + (has && String(val) === String(o) ? " selected" : "") + ">" + esc(f.severity ? P.severityLabel(o) : o) + "</option>").join("") + "</select>";
      }
      if (f.type === "number") return '<input type="number"' + attr + ' value="' + (has ? esc(val) : "") + '" placeholder="inherit"' + (f.min != null ? ' min="' + esc(f.min) + '"' : "") + ">";
      if (f.type === "list") return '<input type="text"' + attr + ' value="' + (has ? esc(asArr(val).join(", ")) : "") + '" placeholder="inherit">';
      return '<input type="text"' + attr + ' value="' + (has ? esc(val) : "") + '" placeholder="' + (has ? "" : "inherit") + '"' + (f.ph ? ' title="' + esc(f.ph) + '"' : "") + ">";
    }

    function openPolicyForm(policy) {
      const p = cache.provider;
      const isEdit = !!policy;
      const cur = isEdit ? policy : normalizePolicy({ name: "", settings: {} });
      const settings = clone(cur.settings || {});
      const deviceList = asArr(p.devices).map(D.normalizeDevice);
      const groupList = (G ? G.listOf(p) : asArr(p.deviceGroups));
      const tagNames = G ? G.tagsOf(p).map((t) => t.name) : [];
      const targetDev = new Set(asArr(cur.targets.deviceIds).map(String));
      const targetGrp = new Set(asArr(cur.targets.groupIds).map(String));

      const catHtml = P.SCHEMA.map((c) => {
        const rows = c.fields.map((f) => '<div class="rmm-setting-row"><div class="rmm-setting-label"><b>' + esc(f.label) + "</b>" + (f.unit ? ' <span class="erp-sub">' + esc(f.unit) + "</span>" : "") + (f.ph ? '<div class="erp-sub">' + esc(f.ph) + "</div>" : "") + "</div><div class=\"rmm-setting-control\">" + settingControl(c, f, settings[c.id]) + "</div></div>").join("");
        return '<section class="rmm-policy-cat"><header><h4>' + esc(c.label) + "</h4><p class=\"erp-sub\">" + esc(c.desc) + "</p></header>" + rows + "</section>";
      }).join("");

      const siteOpts = [{ value: "", label: "— provider-wide —" }].concat(asArr(p.sites).map((s) => ({ value: s.id, label: s.name })));
      const body = ui.form(
        ui.text("name", "Policy name", cur.name) +
        ui.text("description", "Description", cur.description) +
        ui.number("priority", "Priority (higher wins)", cur.priority) +
        ui.select("enabled", "State", [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }], cur.enabled ? "true" : "false") +
        ui.select("siteId", "Site scope", siteOpts, cur.siteId || "") +
        '<div class="rmm-targets">' +
          '<h4 class="rmm-section-title">Targeting</h4>' +
          '<p class="erp-sub">Leave every target blank to apply provider-wide. A device matches on the strongest reason: explicit device, then tag, then group, then site.</p>' +
          '<div class="field"><label>Tags</label><input type="text" name="tags" value="' + esc(asArr(cur.targets.tags).join(", ")) + '" placeholder="prod, critical" list="rmmTagList"><datalist id="rmmTagList">' + tagNames.map((t) => '<option value="' + esc(t) + '"></option>').join("") + "</datalist></div>" +
          '<div class="field"><label>Devices (hostname or id, comma-separated)</label><input type="text" name="devices" value="' + esc(asArr(cur.targets.deviceIds).map((id) => { const d = deviceList.find((x) => String(x.id) === String(id)); return d ? (d.hostname || d.displayName) : id; }).join(", ")) + '" placeholder="blank = none"></div>' +
          '<div class="field"><label>Groups</label><div class="rmm-check-list">' + groupList.map((g) => '<label class="erp-check"><input type="checkbox" data-tgt-group="' + esc(g.id) + '"' + (targetGrp.has(String(g.id)) ? " checked" : "") + "> " + esc(g.name) + " " + (g.kind === "dynamic" ? ui.badge("dynamic", "info") : ui.badge("static", "muted")) + "</label>").join("") + "</div></div>" +
        "</div>" +
        '<h4 class="rmm-section-title">Settings</h4>' +
        '<p class="erp-sub">Only fill in what this policy should override. Blank fields inherit from a lower-precedence policy (or the schema default).</p>' +
        catHtml,
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isEdit ? "Save policy" : "Create policy", { small: true, primary: true, act: "pol-save" })
      );
      const m = ui.modal({ title: isEdit ? "Edit policy" : "New policy", size: "lg", body });

      function readSettings() {
        const out = {};
        m.querySelectorAll("[data-pcat]").forEach((inp) => {
          const cat = inp.getAttribute("data-pcat"), key = inp.getAttribute("data-pkey"), type = inp.getAttribute("data-ptype");
          const raw = inp.value;
          if (raw === "" || raw == null) return;
          if (!out[cat]) out[cat] = {};
          if (type === "bool") out[cat][key] = raw === "true";
          else if (type === "number") { const n = Number(raw); if (isFinite(n)) out[cat][key] = n; }
          else if (type === "list") out[cat][key] = raw.split(",").map((x) => x.trim()).filter(Boolean);
          else out[cat][key] = raw;
        });
        return out;
      }

      m.querySelector("[data-act=pol-save]").onclick = async () => {
        const v = ui.collect(m, ["name", "description", "priority", "enabled", "siteId", "tags", "devices"]);
        if (!String(v.name || "").trim()) { ctx.toast("Policy name is required", "error"); return; }
        const tagList = String(v.tags || "").split(",").map((x) => x.trim()).filter(Boolean);
        const devTokens = String(v.devices || "").split(",").map((x) => x.trim()).filter(Boolean);
        const devIds = devTokens.map((tok) => { const d = deviceList.find((x) => String(x.id) === tok || low(x.hostname) === low(tok) || low(x.displayName) === low(tok)); return d ? String(d.id) : tok; });
        const groupIds = [...m.querySelectorAll("[data-tgt-group]")].filter((i) => i.checked).map((i) => i.getAttribute("data-tgt-group"));
        const payload = {
          name: v.name.trim(), description: v.description || "",
          priority: v.priority == null ? P.DEFAULT_PRIORITY : Number(v.priority),
          enabled: v.enabled !== "false",
          siteId: v.siteId || null,
          targets: { groupIds, tags: tagList, deviceIds: devIds },
          settings: readSettings(),
        };
        const r = isEdit ? await P.update(state.pid, policy.id, payload) : await P.add(state.pid, payload);
        if (r.error) { ctx.toast("Save failed: " + (r.error === "invalid" ? (r.errors || []).join("; ") : r.error), "error"); return; }
        ui.closeModal();
        ctx.toast(isEdit ? "Policy updated" : "Policy created");
        paint();
      };
      return m;
    }

    function openEffectivePreview(policy) {
      const p = cache.provider;
      const devices = asArr(p.devices).map(D.normalizeDevice);
      const hits = devices.map((d) => ({ d, eff: P.effectiveOf(p, d, cache.ctx) })).filter((x) => x.eff.applied.indexOf(policy.id) !== -1);
      const rows = hits.map((x) => {
        const idx = x.eff.applied.indexOf(policy.id);
        return {
          host: "<b>" + esc(x.d.hostname || x.d.displayName) + "</b>",
          rank: ui.badge("#" + (idx + 1), idx === 0 ? "success" : "info"),
          reason: esc((x.eff.ordered[idx] || {}).matchedBy || ""),
          overrides: String((x.eff.ordered[idx] || {}).settingsCount || 0),
        };
      });
      const body = ui.table([
        { key: "host", label: "Device", render: (r) => r.host },
        { key: "rank", label: "Precedence", render: (r) => r.rank },
        { key: "reason", label: "Matched by", render: (r) => r.reason },
        { key: "overrides", label: "Settings", align: "right", render: (r) => r.overrides },
      ], rows, { scroll: true, emptyText: "No device currently matches this policy." });
      ui.modal({ title: policy.name + " · affected devices (" + hits.length + ")", size: "lg", body, foot: ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }) });
    }

    /* ── events ── */
    ui.bind(root, "click", "[data-act]", async (t) => {
      const p = cache.provider;
      const arg = t.getAttribute("data-arg");
      if (t.getAttribute("data-act") === "pol-add") return openPolicyForm(null);
      if (t.getAttribute("data-act") === "pol-edit") { const pol = P.listOf(p).find((x) => x.id === arg); if (pol) return openPolicyForm(pol); return; }
      if (t.getAttribute("data-act") === "pol-preview") { const pol = P.listOf(p).find((x) => x.id === arg); if (pol) return openEffectivePreview(pol); return; }
      if (t.getAttribute("data-act") === "pol-dup") { const r = await P.duplicate(state.pid, arg); if (r.error) { ctx.toast("Duplicate failed: " + r.error, "error"); return; } ctx.toast("Policy duplicated"); return paint(); }
      if (t.getAttribute("data-act") === "pol-open-dev") { ERP.navigate("devices"); return; }
      if (t.getAttribute("data-act") === "pol-del") {
        const pol = P.listOf(p).find((x) => x.id === arg);
        const ok = await ui.confirm({ title: "Delete policy", message: "Delete “" + (pol ? pol.name : arg) + "”? Devices it covered fall back to the next applicable policy.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await P.remove(state.pid, arg);
        if (r.error) { ctx.toast("Delete failed: " + r.error, "error"); return; }
        ctx.toast("Policy deleted");
        return paint();
      }
    });
    ui.bind(root, "click", "[data-tab]", (t) => { state.tab = t.getAttribute("data-tab"); ui.showTab(root, state.tab); });
    root.addEventListener("change", async (e) => {
      if (e.target && e.target.name === "pid") { state.pid = e.target.value; P.currentProviderId = state.pid; state.effDev = null; return paint(); }
      if (e.target && e.target.name === "effDev") { state.effDev = e.target.value; root.querySelector('[data-panel="effective"]').innerHTML = await effectivePanelHtml(cache.provider); }
    });

    await paint();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", P.init);
  else P.init();
})();
