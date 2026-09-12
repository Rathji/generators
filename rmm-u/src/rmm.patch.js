/* ============================================================
   RMM-U — patch policy, scanning & compliance  (Phase 6 · Tasks 28–29)

   Two questions, one engine:

     • Task 28 — WHAT is allowed to install? A **patch policy** states,
       per OS and per patch classification, whether a patch is approved,
       denied, or deferred (with a deferral window and a deadline),
       which maintenance windows install and reboot inside, the reboot
       behaviour and grace period, and whether deadlines are enforced.
       There is always a **clearly stated default** (provider-wide, every
       OS, deny-by-default with sensible per-classification decisions)
       and any number of **per-group / per-site / per-device overrides**
       that layer on top with the same precedence the rest of the console
       uses (priority → specificity → recency). The effective policy for
       a device is shown with per-classification provenance.

     • Task 29 — WHO is out of date? A **scan** turns "what the agent
       reports installed" and "what updates the tenant knows about" into
       a per-device list of missing patches, classifies each one through
       the device's effective policy (required now / deferred / denied),
       computes the deadline, and records per-device compliance and how
       long the device has been non-compliant. It rolls up per device,
       group, site and provider.

   The engine is `window.ERP.patch` (`PA`, this file). Policies live on
   the provider aggregate (`provider.patchState.policies`); scan records
   live in the hidden `rmm-v1-patchscan` document, with a compact
   compliance summary mirrored onto each device (`custom.patchCompliance`)
   so the device table and other stations can read it cheaply.

   Nothing here is a simulation of the agent: the missing set comes from
   an agent scan report when one exists, and otherwise is DERIVED from
   the tenant's own installed-patch index (a patch other devices have but
   this device does not) — so the numbers are always traceable.
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
  const PA = (ERP.patch = {});

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
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;

  const enabled = () => cfg("rmm.patchEnabled", true) !== false;
  const scanEnabled = () => cfg("rmm.patchScanEnabled", true) !== false;
  const policyEnabled = () => cfg("rmm.patchPolicyEnabled", true) !== false;

  PA.MODULE = "patchscan";
  PA.DEFAULT_POLICY_ID = "patch-default";
  PA.DECISIONS = ["inherit", "approve", "deny", "defer"];
  PA.REBOOT_POLICIES = ["inherit", "never", "if-required", "always", "in-window"];
  PA.OS_FAMILIES = ["all"].concat(asArr(D.OS_FAMILIES).map((f) => low(f)));
  PA.DECISION_LABEL = { inherit: "Inherit", approve: "Approve", deny: "Deny", defer: "Defer" };
  PA.REBOOT_LABEL = { inherit: "Inherit", never: "Never reboot", "if-required": "Reboot if required", always: "Always reboot", "in-window": "Reboot only in window" };

  /* ═══════════════════════ the default policy ═══════════════════════

     Stated plainly: unless a policy overrides it, every device in the
     tenant receives THIS. Unclassified updates are denied, critical and
     security updates are approved with a deadline, feature packs and
     service packs/upgrades are deferred, drivers are denied by default,
     and reboots happen only when an approved patch requires one. */

  PA.defaultPolicy = function () {
    return {
      id: PA.DEFAULT_POLICY_ID, kind: "patchpolicy", name: "Default patch policy", isDefault: true,
      description: "The tenant-wide baseline. Deny by default; approve critical, security, definition and rollup updates with a deadline; defer feature packs and service packs; deny drivers until an override approves them.",
      enabled: true, priority: 0, osFamily: "all", siteId: null,
      targets: { groupIds: [], tags: [], deviceIds: [] },
      installWindowId: "", rebootWindowId: "",
      rebootPolicy: "if-required", rebootGraceMinutes: 30,
      enforceDeadline: true,
      missingGraceDays: num(cfg("rmm.patchMissingGraceDays", 14), 14),
      default: { decision: "deny", deferralDays: 0, deadlineDays: 0, requiresReboot: true },
      classifications: {
        "pc-critical": { decision: "approve", deferralDays: 0, deadlineDays: 3, requiresReboot: true },
        "pc-security": { decision: "approve", deferralDays: 0, deadlineDays: 7, requiresReboot: true },
        "pc-definition": { decision: "approve", deferralDays: 0, deadlineDays: 1, requiresReboot: false },
        "pc-feature": { decision: "defer", deferralDays: 14, deadlineDays: 30, requiresReboot: true },
        "pc-driver": { decision: "deny", deferralDays: 0, deadlineDays: 0, requiresReboot: true },
        "pc-servicepack": { decision: "defer", deferralDays: 14, deadlineDays: 45, requiresReboot: true },
        "pc-tools": { decision: "approve", deferralDays: 0, deadlineDays: 7, requiresReboot: false },
        "pc-updates": { decision: "approve", deferralDays: 0, deadlineDays: 14, requiresReboot: true },
        "pc-upgrades": { decision: "defer", deferralDays: 30, deadlineDays: 90, requiresReboot: true },
      },
      createdAt: "", updatedAt: "",
    };
  };

  /* ═══════════════════════ normalisation ═══════════════════════ */

  function normClassRule(c) {
    c = asObj(c);
    const d = pick(c.decision, PA.DECISIONS, "inherit");
    return {
      decision: d,
      deferralDays: num(c.deferralDays, 0),
      deadlineDays: num(c.deadlineDays, 0),
      requiresReboot: c.requiresReboot == null ? null : !!c.requiresReboot,
    };
  }

  PA.normalizePolicy = function (p) {
    p = asObj(p);
    const base = PA.defaultPolicy();
    const out = {
      id: p.id || PA.DEFAULT_POLICY_ID,
      kind: "patchpolicy",
      name: S(p.name, 160) || "Patch policy",
      description: S(p.description, 400),
      isDefault: !!p.isDefault,
      demo: !!p.demo,
      enabled: p.enabled !== false,
      priority: num(p.priority, base.priority),
      osFamily: pick(low(p.osFamily || "all"), PA.OS_FAMILIES, "all"),
      siteId: p.siteId != null && p.siteId !== "" ? String(p.siteId) : null,
      targets: {
        groupIds: asArr(asObj(p.targets).groupIds).map(String),
        tags: asArr(asObj(p.targets).tags).map(String),
        deviceIds: asArr(asObj(p.targets).deviceIds).map(String),
      },
      installWindowId: S(p.installWindowId, 80),
      rebootWindowId: S(p.rebootWindowId, 80),
      rebootPolicy: pick(p.rebootPolicy, PA.REBOOT_POLICIES, base.rebootPolicy),
      rebootGraceMinutes: Math.max(0, num(p.rebootGraceMinutes, base.rebootGraceMinutes)),
      enforceDeadline: p.enforceDeadline !== false,
      missingGraceDays: Math.max(0, num(p.missingGraceDays, base.missingGraceDays)),
      default: normClassRule(Object.assign({}, base.default, asObj(p.default))),
      classifications: {},
      createdAt: S(p.createdAt, 40), updatedAt: S(p.updatedAt, 40),
    };
    const src = asObj(p.classifications);
    Object.keys(src).forEach((id) => { out.classifications[id] = normClassRule(src[id]); });
    return out;
  };

  function pick(v, list, fallback) { return list.indexOf(v) !== -1 ? v : fallback; }

  PA.validatePolicy = function (p) {
    const errors = [];
    const pol = PA.normalizePolicy(p);
    if (!pol.name) errors.push("name is required");
    if (PA.OS_FAMILIES.indexOf(pol.osFamily) === -1) errors.push("unknown OS family");
    if (pol.priority < 0) errors.push("priority cannot be negative");
    Object.keys(pol.classifications).forEach((id) => {
      const c = pol.classifications[id];
      if (PA.DECISIONS.indexOf(c.decision) === -1) errors.push("classification " + id + ": unknown decision");
      if (c.decision === "defer" && c.deadlineDays < c.deferralDays) errors.push("classification " + id + ": deadline is before the deferral ends");
    });
    return { valid: errors.length === 0, errors, policy: pol };
  };

  PA.classificationRule = normClassRule;

  /* ═══════════════════════ classification matching ═══════════════════════ */

  const nrm = (v) => low(v).replace(/[^a-z0-9]/g, "");

  PA.classifications = async function () {
    if (!M) return [];
    const rows = asArr(await M.section("patchClassifications"));
    return rows.filter((c) => c.enabled !== false).map((c) => ({
      id: String(c.id), label: c.label || c.id, vendor: c.vendor || "",
      categoryCode: c.categoryCode || "", severity: c.severity || "",
      autoApprove: !!c.autoApprove, autoDeploy: !!c.autoDeploy,
      requiresReboot: c.requiresReboot !== false, deferralDays: num(c.deferralDays, 0),
    }));
  };

  /* Match a patch's vendor classification string to a master-config
     classification record (exact, then contains). Falls back to a
     synthetic "__default" row the policy's own default block governs. */
  PA.classificationFor = function (patch, list) {
    const p = nrm(asObj(patch).classification);
    const rows = asArr(list);
    if (p) {
      for (const c of rows) {
        if (nrm(c.id) === p || nrm(c.categoryCode) === p || nrm(c.label) === p) return c;
      }
      for (const c of rows) {
        const cands = [c.categoryCode, c.label, c.id].map(nrm).filter(Boolean);
        for (const cand of cands) {
          if (Math.min(cand.length, p.length) >= 4 && (cand.indexOf(p) !== -1 || p.indexOf(cand) !== -1)) return c;
        }
      }
    }
    return { id: "__default", label: asObj(patch).classification || "Unclassified", categoryCode: "", severity: "", requiresReboot: asObj(patch).requiresReboot !== false, unclassified: true };
  };
  PA.classify = PA.classificationFor;

  /* ═══════════════════════ targeting & precedence ═══════════════════════ */

  const familyOf = (dev) => low(asObj(asObj(dev).os).family || asObj(dev).osFamily);

  PA.applies = function (provider, policy, dev, ctx) {
    const pol = asObj(policy);
    if (!pol.enabled) return null;
    if (pol.osFamily && pol.osFamily !== "all" && pol.osFamily !== familyOf(dev)) return null;
    if (pol.siteId && String(pol.siteId) !== String(asObj(dev).siteId || "")) return null;
    const targets = asObj(pol.targets);
    const has = asArr(targets.groupIds).length || asArr(targets.tags).length || asArr(targets.deviceIds).length;
    if (!has) return { match: true, matchedBy: "provider-wide", specificity: 0 };
    if (G && typeof G.matchTargets === "function") {
      const r = G.matchTargets(provider, targets, dev, ctx || { provider });
      return r && r.match ? r : null;
    }
    if (asArr(targets.deviceIds).map(String).indexOf(String(asObj(dev).id)) !== -1) return { match: true, matchedBy: "device", specificity: 4 };
    return null;
  };

  /* Normalised, enabled-or-not custom policies, de-duplicated by id (a
     defensive guard so a malformed/legacy provider can never double-apply
     the same policy). The synthetic default is excluded here. */
  PA.customPolicies = function (provider) {
    const seen = {};
    return asArr(asObj(asObj(provider).patchState).policies)
      .map(PA.normalizePolicy)
      .filter((p) => !p.isDefault && p.id !== PA.DEFAULT_POLICY_ID)
      .filter((p) => { if (seen[p.id]) return false; seen[p.id] = true; return true; });
  };

  PA.orderForDevice = function (provider, dev, ctx) {
    const customs = PA.customPolicies(provider);
    const chain = [];
    customs.forEach((p) => {
      const m = PA.applies(provider, p, dev, ctx);
      if (m) chain.push({ policy: p, match: m, specificity: num(m.specificity, 0), osSpecific: p.osFamily !== "all" ? 1 : 0 });
    });
    chain.sort((a, b) =>
      (b.policy.priority - a.policy.priority) ||
      (b.osSpecific - a.osSpecific) ||
      (b.specificity - a.specificity) ||
      (String(b.policy.updatedAt || "").localeCompare(String(a.policy.updatedAt || ""))) ||
      String(a.policy.id).localeCompare(String(b.policy.id)));
    const dflt = PA.defaultPolicy();
    chain.push({ policy: dflt, match: { matchedBy: "default", specificity: -1 }, specificity: -1, osSpecific: 0 });
    return chain;
  };

  function pickField(chain, key, fallback) {
    for (const link of chain) {
      const v = link.policy[key];
      if (v == null) continue;
      if (typeof v === "string" && (v === "" || v === "inherit")) continue;
      return { value: v, source: link.policy.name || link.policy.id, policyId: link.policy.id };
    }
    return { value: fallback, source: "default", policyId: null };
  }

  function mergeClass(chain, cid) {
    const out = { decision: null, deferralDays: null, deadlineDays: null, requiresReboot: null, source: "default", policyId: null };
    for (const link of chain) {
      const c = asObj(asObj(link.policy.classifications)[cid]);
      if (!Object.keys(c).length) continue;
      if (out.decision == null && c.decision && c.decision !== "inherit") { out.decision = c.decision; out.source = link.policy.name || link.policy.id; out.policyId = link.policy.id; }
      if (out.deferralDays == null && c.deferralDays != null) out.deferralDays = num(c.deferralDays, 0);
      if (out.deadlineDays == null && c.deadlineDays != null) out.deadlineDays = num(c.deadlineDays, 0);
      if (out.requiresReboot == null && c.requiresReboot != null) out.requiresReboot = !!c.requiresReboot;
      if (out.decision != null && out.deferralDays != null && out.deadlineDays != null && out.requiresReboot != null) break;
    }
    return out;
  }

  function mergeDefaultBlock(chain) {
    const out = { decision: null, deferralDays: null, deadlineDays: null, requiresReboot: null, source: "default", policyId: null };
    for (const link of chain) {
      const c = asObj(link.policy.default);
      if (!Object.keys(c).length) continue;
      if (out.decision == null && c.decision && c.decision !== "inherit") { out.decision = c.decision; out.source = link.policy.name || link.policy.id; out.policyId = link.policy.id; }
      if (out.deferralDays == null && c.deferralDays != null) out.deferralDays = num(c.deferralDays, 0);
      if (out.deadlineDays == null && c.deadlineDays != null) out.deadlineDays = num(c.deadlineDays, 0);
      if (out.requiresReboot == null && c.requiresReboot != null) out.requiresReboot = !!c.requiresReboot;
      if (out.decision != null && out.deferralDays != null && out.deadlineDays != null && out.requiresReboot != null) break;
    }
    return out;
  }

  /* The effective policy for a device: the ordered chain, the resolved
     top-level fields (with their source policy), and one row per
     classification (plus `__default`) with its decision + provenance. */
  PA.effectiveOf = async function (provider, dev, ctx) {
    const chain = PA.orderForDevice(provider, dev, ctx);
    const list = await PA.classifications();
    const byId = {};
    list.forEach((c) => {
      const merged = mergeClass(chain, c.id);
      byId[c.id] = Object.assign({
        classificationId: c.id, label: c.label, categoryCode: c.categoryCode,
        severity: c.severity, requiresRebootPatchHint: c.requiresReboot,
        decision: merged.decision || "inherit",
      }, merged);
    });
    const dflt = mergeDefaultBlock(chain);
    byId.__default = Object.assign({ classificationId: "__default", label: "Unclassified", categoryCode: "", severity: "" }, dflt, { decision: dflt.decision || "deny" });
    const fields = {
      installWindowId: pickField(chain, "installWindowId", ""),
      rebootWindowId: pickField(chain, "rebootWindowId", ""),
      rebootPolicy: pickField(chain, "rebootPolicy", "if-required"),
      rebootGraceMinutes: pickField(chain, "rebootGraceMinutes", 30),
      enforceDeadline: pickField(chain, "enforceDeadline", true),
      missingGraceDays: pickField(chain, "missingGraceDays", 14),
    };
    const rows = Object.keys(byId).filter((k) => k !== "__default").map((k) => byId[k]);
    return {
      deviceId: String(asObj(dev).id || ""),
      osFamily: familyOf(dev),
      policyId: chain[0].policy.id,
      policyName: chain[0].policy.name,
      chain: chain.map((l) => ({ policyId: l.policy.id, name: l.policy.name, priority: l.policy.priority, osFamily: l.policy.osFamily, specificity: l.specificity, matchedBy: asObj(l.match).matchedBy, isDefault: !!l.policy.isDefault })),
      fields, byId, rows,
    };
  };

  /* ═══════════════════════ missing-patch sourcing ═══════════════════════ */

  async function loadScans() { const r = await store.loadDoc(PA.MODULE); return asArr(r.error ? [] : r.records); }
  PA.loadScans = loadScans;
  async function saveScans(list) { return store.saveDoc(PA.MODULE, list); }

  const keyOf = (p) => nrm(asObj(p).id || asObj(p).title);

  function normalizeMissing(m, atFallback) {
    m = asObj(m);
    const id = S(m.id || m.kb || m.patchId, 80);
    return {
      id: id || S(m.title, 80),
      title: S(m.title || m.name || id, 240),
      classification: S(m.classification || m.category, 80),
      vendor: S(m.vendor, 80),
      severity: S(m.severity, 40),
      requiresReboot: m.requiresReboot == null ? true : !!m.requiresReboot,
      sizeBytes: num(m.sizeBytes, 0),
      releasedAt: S(m.releasedAt, 40),
      detectedAt: S(m.detectedAt, 40) || atFallback || now(),
      source: S(m.source, 40),
    };
  }
  PA.normalizeMissing = normalizeMissing;

  /* Is a patch plausibly applicable to this device's OS? Used when the
     missing set is derived from the tenant's installed-patch index, so a
     Windows KB only counts against a Windows device, a USN- against
     Linux, a macOS- against macOS. */
  PA.applicableToDevice = function (patch, dev) {
    const fam = familyOf(dev);
    const id = String(asObj(patch).id || "");
    if (/^KB\d/i.test(id)) return fam === "windows";
    if (/^USN-/i.test(id)) return fam === "linux";
    if (/^macos|^osx|^apple/i.test(id) || /macos|sonoma|ventura|monterey/i.test(String(asObj(patch).title || ""))) return fam === "macos";
    return true;
  };

  PA.patchCatalogue = async function (providerId) {
    if (!INV || typeof INV.patchIndex !== "function") return [];
    try { return await INV.patchIndex(providerId); } catch (e) { return []; }
  };

  /* Derived missing set: every update the tenant knows about that this
     device does not have installed (and that is applicable to its OS). */
  PA.deriveMissing = async function (providerId, dev, opts) {
    opts = opts || {};
    const catalogue = asArr(opts.catalogue).length ? asArr(opts.catalogue) : await PA.patchCatalogue(providerId);
    if (!catalogue.length) return { missing: [], installedCount: 0 };
    const snap = INV && typeof INV.snapshot === "function" ? await INV.snapshot(asObj(dev).id) : null;
    const installed = new Set();
    asArr(asObj(asObj(snap).sections).patches).forEach((p) => installed.add(keyOf(p)));
    const at = opts.at || now();
    const missing = catalogue
      .filter((p) => !installed.has(keyOf(p)))
      .filter((p) => PA.applicableToDevice(p, dev))
      .map((p) => normalizeMissing({ id: p.id, title: p.title, classification: p.classification, detectedAt: at, source: "derived" }, at));
    return { missing, installedCount: installed.size, catalogueCount: catalogue.length };
  };

  /* The missing set for a device, by precedence: an explicit scan probe
     → the persisted scan record → the raw report on the device record →
     a set derived from the tenant's installed-patch index. */
  PA.missingForDevice = async function (providerId, dev, opts) {
    opts = opts || {};
    const deviceId = String(asObj(dev).id || opts.deviceId || "");
    const probe = asObj(opts.probes)[deviceId];
    let raw = null, source = null;
    if (probe && Array.isArray(probe.missing)) { raw = probe.missing; source = "probe"; }
    else if (opts.scans && opts.scans.length) {
      const rec = opts.scans.find((s) => String(s.deviceId) === deviceId);
      if (rec && Array.isArray(rec.missing)) { raw = rec.missing; source = rec.source || "scan"; }
    }
    if (raw == null) {
      const cs = asObj(asObj(asObj(dev).custom).patchScan);
      if (Array.isArray(cs.missing)) { raw = cs.missing; source = cs.source || "report"; }
    }
    if (raw == null) {
      const derived = await PA.deriveMissing(providerId, dev, opts);
      return { deviceId, missing: asArr(derived.missing), source: "derived", catalogueCount: derived.catalogueCount };
    }
    const at = opts.at || now();
    return { deviceId, missing: asArr(raw).map((m) => normalizeMissing(m, at)), source };
  };

  /* ═══════════════════════ scanning & compliance ═══════════════════════ */

  function deadlineFor(row, detectedMs, effRow) {
    const defer = num(effRow.deferralDays, 0);
    const installAfter = effRow.decision === "defer" && defer > 0 ? iso(detectedMs + defer * DAY) : iso(detectedMs);
    const deadlineAt = num(effRow.deadlineDays, 0) > 0 ? iso(detectedMs + num(effRow.deadlineDays, 0) * DAY) : "";
    return { installAfter, deadlineAt };
  }

  function classifyRows(missing, eff, classifications, atMs, prev) {
    const prevByKey = {};
    asArr(prev && prev.missing).forEach((m) => { prevByKey[keyOf(m)] = m; });
    return asArr(missing).map((m) => {
      const cls = PA.classificationFor(m, classifications);
      const effRow = asObj(eff.byId[cls.id]) && eff.byId[cls.id].decision ? eff.byId[cls.id] : eff.byId.__default;
      const prevRow = prevByKey[keyOf(m)];
      const detectedAt = (prevRow && prevRow.detectedAt) || m.detectedAt || iso(atMs);
      const detectedMs = msOf(detectedAt) || atMs;
      const { installAfter, deadlineAt } = deadlineFor(m, detectedMs, effRow);
      const requiredNow = effRow.decision === "approve" || (effRow.decision === "defer" && atMs >= msOf(installAfter));
      const denied = effRow.decision === "deny";
      const overdue = requiredNow && !!deadlineAt && atMs > msOf(deadlineAt) && eff.fields.enforceDeadline.value !== false;
      const critical = num(effRow.requiresReboot !== false && /critical|security/i.test(cls.label + " " + cls.categoryCode), 0) || (effRow.classificationId && /critical/i.test(m.classification || ""));
      return {
        id: m.id, title: m.title, classification: m.classification,
        classificationId: cls.id, classificationLabel: cls.label, categoryCode: cls.categoryCode,
        severity: m.severity || cls.severity || "",
        requiresReboot: effRow.requiresReboot == null ? m.requiresReboot !== false : !!effRow.requiresReboot,
        decision: effRow.decision || "deny",
        decisionSource: effRow.source || "default",
        deferralDays: num(effRow.deferralDays, 0),
        deadlineDays: num(effRow.deadlineDays, 0),
        detectedAt, installAfter, deadlineAt,
        requiredNow, denied, overdue, critical: !!critical,
        ageDays: Math.round(((atMs - detectedMs) / DAY) * 10) / 10,
      };
    }).sort((a, b) => (Number(b.requiredNow) - Number(a.requiredNow)) || (Number(b.overdue) - Number(a.overdue)) || (b.ageDays - a.ageDays));
  }

  function complianceOf(rows, atMs, prevCompliance, missingGraceDays) {
    const required = rows.filter((r) => r.requiredNow);
    const counts = {
      missingTotal: rows.length,
      missingRequired: required.length,
      missingCritical: rows.filter((r) => r.requiredNow && r.critical).length,
      missingDeferred: rows.filter((r) => r.decision === "defer" && !r.requiredNow).length,
      missingDenied: rows.filter((r) => r.decision === "deny").length,
      overdue: rows.filter((r) => r.overdue).length,
    };
    const compliant = counts.missingRequired === 0;
    let nonCompliantSince = "";
    if (!compliant) {
      const earliest = required.reduce((a, r) => { const t = msOf(r.detectedAt) || atMs; return (!a || t < a) ? t : a; }, null);
      const prevSince = prevCompliance && prevCompliance.nonCompliantSince ? prevCompliance.nonCompliantSince : "";
      nonCompliantSince = prevSince || (earliest ? iso(earliest) : iso(atMs));
    }
    const ageDays = nonCompliantSince ? Math.round(((atMs - (msOf(nonCompliantSince) || atMs)) / DAY) * 10) / 10 : 0;
    return {
      status: compliant ? "compliant" : "non-compliant",
      compliant, counts, nonCompliantSince, ageDays,
      withinGrace: !compliant && num(missingGraceDays, 0) > 0 && ageDays <= num(missingGraceDays, 0),
      evaluatedAt: iso(atMs),
    };
  }

  async function computeDevice(provider, dev, ctx) {
    const at = ctx.at;
    const atMs = msOf(at) || Date.now();
    const eff = await PA.effectiveOf(provider, dev, { provider });
    const miss = await PA.missingForDevice(asObj(provider).id, dev, ctx);
    const prev = asArr(ctx.scans).find((s) => String(s.deviceId) === String(asObj(dev).id));
    const rows = classifyRows(miss.missing, eff, ctx.classifications, atMs, prev);
    const compliance = complianceOf(rows, atMs, prev && prev.compliance, eff.fields.missingGraceDays.value);
    const record = {
      kind: "scan", id: "pscan-" + String(asObj(dev).id), providerId: String(asObj(provider).id),
      deviceId: String(asObj(dev).id), hostname: asObj(dev).hostname || asObj(dev).displayName || "",
      siteId: asObj(dev).siteId || null, groupIds: asArr(asObj(dev).groupIds).map(String),
      osFamily: familyOf(dev), at, source: miss.source, catalogueCount: num(miss.catalogueCount, 0),
      policyId: eff.policyId, policyName: eff.policyName,
      missing: rows, counts: compliance.counts, compliance, updatedAt: at,
    };
    return {
      deviceId: record.deviceId, hostname: record.hostname, osFamily: record.osFamily,
      source: miss.source, at, policyId: eff.policyId, policyName: eff.policyName,
      missing: rows, counts: compliance.counts, compliance, record, effective: eff,
    };
  }

  /* Run a scan for one device or many. Persists one scan record per
     device (hidden `patchscan` doc), mirrors a compact compliance summary
     onto each device (`custom.patchCompliance`) and appends a run to
     `provider.patchState.scanRuns` — all in a single provider write. */
  PA.scan = async function (providerId, opts) {
    opts = opts || {};
    if (!scanEnabled() && !opts.force) return { skipped: true, reason: "patch_scan_disabled" };
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const at = opts.at || now();
    const scans = asArr(opts.scans).length ? asArr(opts.scans) : await loadScans();
    const classifications = await PA.classifications();
    const catalogue = await PA.patchCatalogue(providerId);
    let devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
    if (opts.deviceId) devices = devices.filter((d) => String(d.id) === String(opts.deviceId));
    if (asArr(opts.deviceIds).length) { const w = opts.deviceIds.map(String); devices = devices.filter((d) => w.indexOf(String(d.id)) !== -1); }
    const ctx = { at, scans, classifications, catalogue, probes: opts.probes };
    const results = [];
    for (const dev of devices) results.push(await computeDevice(provider, dev, ctx));

    if (results.length) {
      const next = scans.filter((s) => !results.some((r) => String(r.deviceId) === String(s.deviceId)));
      results.forEach((r) => next.push(r.record));
      await saveScans(next);
      await T.update(providerId, (p) => applyScan(p, results, at, catalogue.length));
      if (opts.raiseAlerts) {
        for (const r of results) { try { await syncComplianceAlert(providerId, r, at, provider); } catch (e) {} }
      }
    }
    return { providerId, at, scanned: results.length, summary: summarize(results), scans: results.map((r) => r.record) };
  };

  PA.scanDevice = async function (providerId, deviceId, opts) {
    return PA.scan(providerId, Object.assign({}, opts || {}, { deviceId }));
  };

  function applyScan(p, results, at, catalogueCount) {
    p.patchState = asObj(p.patchState);
    p.patchState.policies = asArr(p.patchState.policies);
    p.patchState.scanRuns = asArr(p.patchState.scanRuns);
    const devices = asArr(p.devices);
    results.forEach((r) => {
      const dev = devices.find((d) => String(d.id) === String(r.deviceId));
      if (!dev) return;
      dev.custom = asObj(dev.custom);
      dev.custom.patchScan = { at: r.at, source: r.source, missing: r.record.missing };
      dev.custom.patchCompliance = clone(r.compliance);
      dev.updatedAt = at;
      p.patchState.scanRuns.push({
        at: r.at, deviceId: r.deviceId, hostname: r.hostname, osFamily: r.osFamily, source: r.source,
        missing: r.counts.missingTotal, required: r.counts.missingRequired, overdue: r.counts.overdue,
        compliant: r.compliance.compliant, policyId: r.policyId, policyName: r.policyName, catalogueCount: num(catalogueCount, 0),
      });
    });
    const cap = Math.max(10, num(cfg("rmm.patchScanHistory", 200), 200));
    if (p.patchState.scanRuns.length > cap) p.patchState.scanRuns = p.patchState.scanRuns.slice(-cap);
    p.updatedAt = at;
  }

  function summarize(results) {
    const out = { devices: results.length, compliant: 0, nonCompliant: 0, missingTotal: 0, missingRequired: 0, overdue: 0, sources: {} };
    results.forEach((r) => {
      out[r.compliance.compliant ? "compliant" : "nonCompliant"] += 1;
      out.missingTotal += r.counts.missingTotal;
      out.missingRequired += r.counts.missingRequired;
      out.overdue += r.counts.overdue;
      out.sources[r.source] = (out.sources[r.source] || 0) + 1;
    });
    return out;
  }

  /* Ingest an agent scan report (the raw missing set) and persist it on
     the device so the next scan evaluates it. */
  PA.reportScan = async function (providerId, deviceId, report) {
    report = asObj(report);
    const at = report.at || now();
    const missing = asArr(report.missing).map((m) => normalizeMissing(m, at));
    const r = await T.update(providerId, (p) => {
      const dev = asArr(p.devices).find((d) => String(d.id) === String(deviceId));
      if (!dev) return;
      dev.custom = asObj(dev.custom);
      dev.custom.patchScan = { at, source: "agent", missing };
      dev.updatedAt = at;
    });
    if (r.error) return r;
    return { ok: true, deviceId: String(deviceId), at, missing: missing.length };
  };

  /* ── compliance → alert (optional, off by default) ── */
  async function syncComplianceAlert(providerId, result, at, provider) {
    const AL = window.ERP.alerts;
    if (!AL || cfg("rmm.patchAlertEnabled", false) !== true) return null;
    const key = "patch-compliance|" + result.deviceId;
    const active = asArr(asObj(provider).alerts).find((a) => String(a.dedupeKey) === key && AL.ACTIVE.indexOf(a.state) !== -1);
    if (result.compliance.compliant) {
      if (active) return AL.autoClear(providerId, active.id, { at });
      return null;
    }
    const sevId = result.counts.overdue ? "sev-critical" : "sev-warning";
    return AL.fire(providerId, {
      monitorId: "mon-patch-compliance", monitorName: "Patch compliance", monitorType: "patch",
      deviceId: result.deviceId, severityId: sevId, severityRank: result.counts.overdue ? 30 : 20,
      state: "warning", subject: "Patch compliance",
      message: result.counts.missingRequired + " missing required update(s)" + (result.counts.overdue ? "; " + result.counts.overdue + " overdue" : ""),
      dedupeKey: key, at,
    }, { provider, silent: true });
  }
  PA.syncComplianceAlert = syncComplianceAlert;

  /* ═══════════════════════ reads ═══════════════════════ */

  PA.scanOf = async function (deviceId) {
    const scans = await loadScans();
    return scans.find((s) => String(s.deviceId) === String(deviceId)) || null;
  };
  PA.scans = async function (providerId) {
    const scans = await loadScans();
    return providerId ? scans.filter((s) => String(s.providerId) === String(providerId)) : scans;
  };

  PA.complianceFor = async function (providerId, deviceId) {
    const rec = await PA.scanOf(deviceId);
    if (rec) return { deviceId: String(deviceId), ...clone(rec.compliance), source: "scan", policyName: rec.policyName, at: rec.at, counts: clone(rec.counts) };
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = asArr(g.provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    const c = dev ? asObj(asObj(dev.custom).patchCompliance) : {};
    if (Object.keys(c).length) return Object.assign({ deviceId: String(deviceId), source: "device" }, c);
    return { deviceId: String(deviceId), status: "unknown", compliant: null, counts: null, nonCompliantSince: "", ageDays: 0, source: "none" };
  };

  function siteNameOf(provider, id) { const s = asArr(provider.sites).find((x) => String(x.id) === String(id)); return s ? (s.name || id) : ""; }
  function groupNamesOf(provider, ids) {
    const groups = asArr(provider.deviceGroups);
    return asArr(ids).map((id) => { const g = groups.find((x) => String(x.id) === String(id)); return g ? (g.name || id) : id; });
  }
  PA.groupNames = groupNamesOf;

  /* Per-device compliance rows (the table everything else rolls up). */
  PA.deviceRows = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const scans = opts.scans || (await loadScans());
    const byDevice = {};
    scans.forEach((s) => { if (String(s.providerId) === String(providerId)) byDevice[String(s.deviceId)] = s; });
    let rows = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived").map((dev) => {
      const rec = byDevice[String(dev.id)];
      const comp = rec ? rec.compliance : asObj(asObj(dev.custom).patchCompliance);
      const has = !!(rec || Object.keys(comp).length);
      const counts = rec ? rec.counts : (comp.counts || null);
      return {
        deviceId: dev.id, hostname: dev.hostname || dev.displayName || dev.id,
        siteId: dev.siteId || null, siteName: siteNameOf(provider, dev.siteId),
        groupIds: asArr(dev.groupIds), groupNames: groupNamesOf(provider, dev.groupIds),
        osFamily: familyOf(dev), role: dev.role, status: dev.status,
        complianceStatus: has ? (comp.compliant ? "compliant" : "non-compliant") : "unknown",
        compliant: has ? !!comp.compliant : null,
        counts, missingTotal: counts ? num(counts.missingTotal, 0) : 0,
        missingRequired: counts ? num(counts.missingRequired, 0) : 0,
        overdue: counts ? num(counts.overdue, 0) : 0,
        nonCompliantSince: has ? (comp.nonCompliantSince || "") : "",
        ageDays: has ? num(comp.ageDays, 0) : 0,
        withinGrace: has ? !!comp.withinGrace : false,
        policyName: rec ? rec.policyName : "", lastScanAt: rec ? rec.at : "", source: rec ? rec.source : "",
      };
    });
    if (opts.status) rows = rows.filter((r) => r.complianceStatus === opts.status);
    if (opts.siteId) rows = rows.filter((r) => String(r.siteId) === String(opts.siteId));
    if (opts.groupId) rows = rows.filter((r) => asArr(r.groupIds).map(String).indexOf(String(opts.groupId)) !== -1);
    if (opts.osFamily) rows = rows.filter((r) => low(r.osFamily) === low(opts.osFamily));
    if (opts.q) { const q = low(opts.q); rows = rows.filter((r) => [r.hostname, r.siteName, r.osFamily, r.policyName, asArr(r.groupNames).join(" ")].some((x) => low(x).indexOf(q) !== -1)); }
    const rank = { "non-compliant": 2, unknown: 1, compliant: 0 };
    rows.sort((a, b) => (rank[b.complianceStatus] - rank[a.complianceStatus]) || (b.overdue - a.overdue) || (b.ageDays - a.ageDays) || String(a.hostname).localeCompare(String(b.hostname)));
    return { providerId, rows, summary: summarizeRows(rows) };
  };

  function summarizeRows(rows) {
    const out = { devices: rows.length, compliant: 0, nonCompliant: 0, unknown: 0, missingTotal: 0, missingRequired: 0, overdue: 0, oldestAgeDays: 0 };
    rows.forEach((r) => {
      out[r.complianceStatus === "compliant" ? "compliant" : r.complianceStatus === "non-compliant" ? "nonCompliant" : "unknown"] += 1;
      out.missingTotal += num(r.missingTotal, 0);
      out.missingRequired += num(r.missingRequired, 0);
      out.overdue += num(r.overdue, 0);
      if (num(r.ageDays, 0) > out.oldestAgeDays) out.oldestAgeDays = num(r.ageDays, 0);
    });
    return out;
  }
  PA.summarizeRows = summarizeRows;

  /* Roll the device rows up per group, site, OS family or provider. A
     device in several groups counts in each group's bucket. */
  PA.rollup = async function (providerId, opts) {
    opts = opts || {};
    const by = opts.by || "group";
    const dr = await PA.deviceRows(providerId, opts);
    if (dr.error) return dr;
    const rows = dr.rows;
    const buckets = new Map();
    const add = (key, label, r) => {
      const k = String(key == null ? "none" : key);
      let b = buckets.get(k);
      if (!b) { b = { key: k, label: label || k, devices: 0, compliant: 0, nonCompliant: 0, unknown: 0, missingRequired: 0, overdue: 0, oldestAgeDays: 0 }; buckets.set(k, b); }
      b.devices += 1;
      b[r.complianceStatus === "compliant" ? "compliant" : r.complianceStatus === "non-compliant" ? "nonCompliant" : "unknown"] += 1;
      b.missingRequired += num(r.missingRequired, 0);
      b.overdue += num(r.overdue, 0);
      if (num(r.ageDays, 0) > b.oldestAgeDays) b.oldestAgeDays = num(r.ageDays, 0);
    };
    rows.forEach((r) => {
      if (by === "site") add(r.siteId || "none", r.siteName || "No site", r);
      else if (by === "os") add(low(r.osFamily) || "none", r.osFamily || "Unknown OS", r);
      else if (by === "provider") add(providerId, "All devices", r);
      else if (asArr(r.groupIds).length) r.groupIds.forEach((id, i) => add(id, asArr(r.groupNames)[i] || id, r));
      else add("none", "No device group", r);
    });
    const list = [...buckets.values()].map((b) => Object.assign(b, {
      compliancePct: b.devices ? Math.round((b.compliant / b.devices) * 100) : 0,
    })).sort((a, b) => (b.nonCompliant - a.nonCompliant) || (b.missingRequired - a.missingRequired) || String(a.label).localeCompare(String(b.label)));
    return { providerId, by, buckets: list, summary: dr.summary };
  };

  PA.stats = async function (providerId) {
    const dr = await PA.deviceRows(providerId, {});
    if (dr.error) return dr;
    const runs = await PA.scanRuns(providerId);
    const last = runs.length ? runs[0].at : "";
    const policies = (await PA.listPolicies(providerId)).length;
    return Object.assign({ providerId, policies, scanRuns: runs.length, lastScanAt: last, scannedDevices: dr.rows.filter((r) => r.complianceStatus !== "unknown").length }, dr.summary);
  };

  PA.scanRuns = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(asObj(g.provider.patchState).scanRuns).slice().reverse();
  };

  /* ═══════════════════════ policy CRUD ═══════════════════════ */

  PA.listPolicies = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return PA.customPolicies(g.provider);
  };
  PA.allPolicies = async function (providerId) {
    return [PA.defaultPolicy()].concat(await PA.listPolicies(providerId));
  };
  PA.getPolicy = async function (providerId, id) {
    if (id === PA.DEFAULT_POLICY_ID) return clone(PA.defaultPolicy());
    const list = await PA.listPolicies(providerId);
    return list.find((p) => String(p.id) === String(id)) || null;
  };

  /* ── role gate (Task 48) ──
     Denying patches and deploying them are gated separately: a policy that
     explicitly sets a deny decision needs `patch.deny`, and a deployment
     needs `patch.deploy` scoped to the target devices. When the access
     module is absent, the gate is a no-op (older builds). */
  async function patchGate(cap, target) {
    const A = ERP.access;
    if (!A || typeof A.require !== "function") return { ok: true };
    return await A.require(cap, target);
  }
  function explicitDeny(pol) {
    const p = asObj(pol);
    if (asObj(p.default).decision === "deny") return true;
    const c = asObj(p.classifications);
    for (const id in c) if (asObj(c[id]).decision === "deny") return true;
    return false;
  }

  PA.addPolicy = async function (providerId, data) {
    data = asObj(data);
    if (!policyEnabled() && !data.force) return { error: "patch_policy_disabled" };
    if (explicitDeny(data)) {
      const gate = await patchGate("patch.deny", null);
      if (!gate.ok) return { error: "forbidden", reason: gate.reason, message: gate.message };
    }
    const pol = PA.normalizePolicy(Object.assign({}, data, { id: data.id || rid("patchpol"), isDefault: false, createdAt: now(), updatedAt: now() }));
    const v = PA.validatePolicy(pol);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      p.patchState.policies = asArr(p.patchState.policies);
      p.patchState.policies.push(pol);
    });
    if (r.error) return r;
    await audit("patch_policy_add", pol.id, "Added patch policy \"" + pol.name + "\".");
    return { policy: clone(pol) };
  };

  PA.updatePolicy = async function (providerId, id, patch) {
    if (id === PA.DEFAULT_POLICY_ID) return { error: "default_is_readonly" };
    if (explicitDeny(patch)) {
      const gate = await patchGate("patch.deny", null);
      if (!gate.ok) return { error: "forbidden", reason: gate.reason, message: gate.message };
    }
    let found = null;
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      const list = asArr(p.patchState.policies);
      const i = list.findIndex((x) => String(x.id) === String(id));
      if (i === -1) return;
      const merged = PA.normalizePolicy(Object.assign({}, list[i], asObj(patch), { id: list[i].id, isDefault: false, createdAt: list[i].createdAt, updatedAt: now() }));
      list[i] = merged;
      p.patchState.policies = list;
      found = merged;
    });
    if (r.error) return r;
    if (!found) return { error: "not_found", id };
    await audit("patch_policy_update", id, "Updated patch policy \"" + found.name + "\".");
    return { policy: clone(found) };
  };

  PA.removePolicy = async function (providerId, id) {
    if (id === PA.DEFAULT_POLICY_ID) return { error: "default_is_readonly" };
    let removed = null;
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      const list = asArr(p.patchState.policies);
      removed = list.find((x) => String(x.id) === String(id)) || null;
      p.patchState.policies = list.filter((x) => String(x.id) !== String(id));
    });
    if (r.error) return r;
    if (!removed) return { error: "not_found", id };
    await audit("patch_policy_remove", id, "Removed patch policy \"" + (removed.name || id) + "\".");
    return { removed: String(id) };
  };

  PA.duplicatePolicy = async function (providerId, id) {
    const pol = await PA.getPolicy(providerId, id);
    if (!pol) return { error: "not_found", id };
    const copy = PA.normalizePolicy(Object.assign({}, pol, { id: rid("patchpol"), name: (pol.name || "Policy") + " (copy)", isDefault: false, createdAt: now(), updatedAt: now() }));
    return PA.addPolicy(providerId, copy);
  };

  PA.setEnabled = async function (providerId, id, on) {
    if (id === PA.DEFAULT_POLICY_ID) return { error: "default_is_readonly" };
    return PA.updatePolicy(providerId, id, { enabled: on !== false });
  };

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "patchpolicy", targetId, summary }); } catch (e) {}
  }

  /* ═══════════════════════ deployment & audit ═══════════════════════

     Task 30 turns an *approved* patch set into work:

       plan ──▶ deploy ──▶ (agent job per device) ──▶ reconcile
                                                          │
                                       parse per-patch results, retry
                                       failures with backoff, capture
                                       before/after compliance, queue a
                                       reboot when the policy says so,
                                       and keep an auditable record.

     A deployment lives on the provider aggregate
     (`provider.patchState.deployments`); required reboots live alongside
     in `patchState.reboots`. Every action is audited through
     `master.audit` and the whole run can be rendered/exported as a
     per-client patch-compliance report.

     Deployment windows are honoured through the schedule engine: a
     "in-window" reboot policy only fires inside an active maintenance
     window covering the device. */

  PA.DEPLOY_SOURCE = "patch-deploy";
  PA.DEPLOY_STATES = ["planned", "running", "succeeded", "partial", "failed", "cancelled"];
  PA.PATCH_STATES = ["pending", "installed", "failed", "skipped"];
  PA.REBOOT_STATES = ["none", "pending", "scheduled", "rebooting", "done", "skipped"];
  PA.RESULT_LINE = "PATCHRESULT";

  const deployEnabled = () => cfg("rmm.patchDeployEnabled", true) !== false;
  const rebootEnabled = () => cfg("rmm.patchRebootEnabled", true) !== false;
  const retryMax = () => Math.max(0, num(cfg("rmm.patchRetryMax", 2), 2));
  const retryBackoffMs = () => Math.max(1, num(cfg("rmm.patchRetryBackoffMinutes", 30), 30)) * MIN;
  const deployHistory = () => Math.max(10, num(cfg("rmm.patchDeployHistory", 100), 100));
  const maxPerJob = () => Math.max(1, num(cfg("rmm.patchDeployMaxPerJob", 25), 25));
  const deployTimeout = () => Math.max(30, num(cfg("rmm.patchDeployTimeoutSeconds", 3600), 3600));

  function deployActor() { try { return ERP.role || "owner"; } catch (e) { return "owner"; } }

  async function auditDeploy(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "patchdeploy", targetId, summary }); } catch (e) {}
  }

  /* ── the install script the agent runs ──
     One job per device carries every approved patch for that device;
     the script installs each one and prints one machine-readable
     `PATCHRESULT <id> ok|failed [message]` line per patch, so the
     reconcile step can attribute success and failure precisely. */

  function safeId(id) { return String(id == null ? "" : id).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80); }
  function psQuote(s) { return "'" + String(s == null ? "" : s).replace(/'/g, "''").slice(0, 240) + "'"; }
  function shQuote(s) { return "'" + String(s == null ? "" : s).replace(/'/g, "'\\''").slice(0, 200) + "'"; }

  PA.deployScript = function (family, patches, meta) {
    meta = meta || {};
    const list = asArr(patches).map((p) => ({ id: safeId(p.id || p.title || p.kb), title: S(p.title || p.id, 120) })).filter((p) => p.id);
    const line = PA.RESULT_LINE;
    if (low(family) === "windows") {
      const script = [
        "# RMM-U patch deployment — " + list.length + " approved update(s)",
        "# deployment " + safeId(meta.deploymentId || "") + " · device " + safeId(meta.hostname || ""),
        "$ErrorActionPreference = 'Continue'",
        "$targets = @(",
        list.map((p) => "  @{ id = " + psQuote(p.id) + "; title = " + psQuote(p.title) + " }").join(",\n"),
        ")",
        "foreach ($t in $targets) {",
        "  try {",
        "    Install-WindowsUpdate -KBArticleID $t.id -AcceptAll -IgnoreReboot -ErrorAction Stop | Out-Null",
        "    Write-Output ('" + line + " ' + $t.id + ' ok')",
        "  } catch {",
        "    Write-Output ('" + line + " ' + $t.id + ' failed ' + $_.Exception.Message)",
        "  }",
        "}",
        "Write-Output 'PATCHDONE'",
      ].join("\n");
      return { language: "powershell", script };
    }
    const isMac = low(family) === "macos";
    const lines = [
      "#!/usr/bin/env bash",
      "# RMM-U patch deployment — " + list.length + " approved update(s)",
      "for id in " + list.map((p) => shQuote(p.id)).join(" ") + "; do",
      "  if " + (isMac ? "softwareupdate -i \"$id\" --no-restart" : "apt-get install --assume-yes --only-upgrade \"$id\"") + " >/dev/null 2>&1; then",
      "    echo \"" + line + " $id ok\"",
      "  else",
      "    echo \"" + line + " $id failed\"",
      "  fi",
      "done",
      "echo PATCHDONE",
    ];
    return { language: "bash", script: lines.join("\n") + "\n" };
  };

  PA.parseResultOutput = function (stdout) {
    const out = [];
    String(stdout == null ? "" : stdout).split(/\r?\n/).forEach((raw) => {
      const m = /^\s*PATCHRESULT\s+(\S+)\s+(\S+)\s*(.*)$/.exec(raw);
      if (!m) return;
      const ok = low(m[2]) === "ok";
      out.push({ id: m[1], ok, state: ok ? "installed" : "failed", message: S(m[3], 200) });
    });
    return out;
  };

  /* ── what is ready to deploy for one device? ── */

  PA.planForDevice = function (dev, rec, opts) {
    opts = opts || {};
    const atMs = msOf(opts.at) || Date.now();
    const want = asArr(opts.patchIds).map(String);
    const base = {
      deviceId: String(asObj(dev).id), hostname: asObj(dev).hostname || asObj(dev).displayName || String(asObj(dev).id),
      osFamily: familyOf(dev), scanned: !!rec, policyId: rec ? rec.policyId : "", policyName: rec ? rec.policyName : "",
      at: rec ? rec.at : "", before: rec ? { at: rec.at, compliant: !!(asObj(rec.compliance).compliant), missingTotal: num(asObj(rec.counts).missingTotal, 0), missingRequired: num(asObj(rec.counts).missingRequired, 0), overdue: num(asObj(rec.counts).overdue, 0) } : null,
      patches: [], blocked: [],
    };
    if (!rec) return base;
    asArr(rec.missing).forEach((m) => {
      const id = String(asObj(m).id);
      if (!id) return;
      if (want.length && want.indexOf(id) === -1) return;
      const decision = asObj(m).decision;
      const installMs = msOf(asObj(m).installAfter);
      if (decision === "deny") { base.blocked.push({ id, title: asObj(m).title, reason: "denied" }); return; }
      if (decision === "defer" && (installMs == null || installMs > atMs)) { base.blocked.push({ id, title: asObj(m).title, reason: "deferred", installAfter: asObj(m).installAfter }); return; }
      if (decision !== "approve" && decision !== "defer") { base.blocked.push({ id, title: asObj(m).title, reason: "not_approved" }); return; }
      base.patches.push({ id, title: asObj(m).title || id, classification: asObj(m).classification || "", requiresReboot: asObj(m).requiresReboot !== false, decision, deadlineAt: asObj(m).deadlineAt || "", overdue: !!asObj(m).overdue });
    });
    return base;
  };

  /* The fleet plan: every device with at least one approved patch that is
     not still inside its deferral window. Denied and not-yet-due patches
     are reported under `blocked` (with the reason) so the console can be
     honest about what it is holding back. */
  PA.plan = async function (providerId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const scans = asArr(opts.scans).length ? asArr(opts.scans) : await loadScans();
    const byDev = {};
    scans.forEach((s) => { if (String(s.providerId) === String(providerId)) byDev[String(s.deviceId)] = s; });
    let devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
    if (opts.deviceId) devices = devices.filter((d) => String(d.id) === String(opts.deviceId));
    if (asArr(opts.deviceIds).length) { const w = opts.deviceIds.map(String); devices = devices.filter((d) => w.indexOf(String(d.id)) !== -1); }
    if (opts.siteId) devices = devices.filter((d) => String(d.siteId) === String(opts.siteId));
    if (opts.groupId) devices = devices.filter((d) => asArr(d.groupIds).map(String).indexOf(String(opts.groupId)) !== -1);
    const plans = devices.map((d) => PA.planForDevice(d, byDev[String(d.id)], { at, patchIds: opts.patchIds }));
    const totals = { devices: 0, patches: 0, reboots: 0, blocked: 0 };
    plans.forEach((p) => {
      if (p.patches.length) { totals.devices += 1; totals.patches += p.patches.length; }
      if (p.patches.some((x) => x.requiresReboot)) totals.reboots += 1;
      totals.blocked += p.blocked.length;
    });
    return { providerId, at, devices: plans, totals };
  };

  function summarizeDeployment(dep) {
    const out = { devices: 0, patches: 0, installed: 0, failed: 0, pending: 0, skipped: 0, reboots: 0, state: "planned" };
    const tstates = [];
    Object.keys(asObj(dep.targets)).forEach((id) => {
      const t = asObj(dep.targets)[id];
      out.devices += 1;
      asArr(t.patches).forEach((p) => {
        out.patches += 1;
        out[p.state === "installed" ? "installed" : p.state === "failed" ? "failed" : p.state === "skipped" ? "skipped" : "pending"] += 1;
      });
      if (asObj(t.reboot).required) out.reboots += 1;
      tstates.push(t.state);
    });
    if (!tstates.length) out.state = "planned";
    else if (tstates.every((s) => s === "cancelled")) out.state = "cancelled";
    else if (tstates.every((s) => s === "succeeded")) out.state = "succeeded";
    else if (tstates.some((s) => s === "running")) out.state = "running";
    else if (tstates.every((s) => s === "failed")) out.state = "failed";
    else if (tstates.some((s) => s === "succeeded" || s === "partial")) out.state = "partial";
    else out.state = "failed";
    return out;
  }
  PA.summarizeDeployment = summarizeDeployment;

  /* ── deploy: create one agent job per device ── */
  PA.deploy = async function (providerId, opts) {
    opts = opts || {};
    if (!deployEnabled() && !opts.force) return { error: "patch_deploy_disabled", message: "Patch deployment is disabled." };
    const J = window.ERP.jobs;
    if (!J || typeof J.enqueue !== "function") return { error: "jobs_unavailable", message: "The job engine is not available." };
    const at = opts.at || now();
    const plan = await PA.plan(providerId, Object.assign({}, opts, { at }));
    if (plan.error) return plan;
    const devs = plan.devices.filter((d) => d.patches.length);
    if (opts.dryRun) return { dryRun: true, providerId, at, plan: Object.assign({}, plan, { devices: devs }) };
    if (!devs.length) return { error: "nothing_to_deploy", message: "No approved patches are ready to deploy." };

    const deployGate = await patchGate("patch.deploy", devs.length === 1 ? devs[0].deviceId : null);
    if (!deployGate.ok) return { error: "forbidden", reason: deployGate.reason, message: deployGate.message };
    const ACCESS = ERP.access;
    if (ACCESS && typeof ACCESS.can === "function") {
      for (const d of devs) if (!ACCESS.can("patch.deploy", d.deviceId)) return { error: "out_of_scope", message: "This deployment includes devices outside your assigned scope." };
    }

    const deploymentId = rid("patchdep");
    const name = S(opts.name || ("Patch run " + at.slice(0, 16).replace("T", " ")), 160);
    const createdBy = opts.createdBy || deployActor();
    const cap = maxPerJob();
    const targets = {};
    const jobIds = [];
    for (const d of devs) {
      const picked = d.patches.slice(0, cap);
      const overflow = d.patches.slice(cap);
      const built = PA.deployScript(d.osFamily, picked, { deploymentId, hostname: d.hostname });
      const enq = await J.enqueue({
        providerId, deviceIds: [d.deviceId],
        name: "Patch " + d.hostname + " (" + picked.length + " update" + (picked.length === 1 ? "" : "s") + ")",
        language: built.language, script: built.script,
        source: PA.DEPLOY_SOURCE + ":" + deploymentId, createdBy,
        timeoutSeconds: deployTimeout(), maxAttempts: retryMax() + 1,
      });
      const patches = picked.map((p) => ({ id: p.id, title: p.title, classification: p.classification, requiresReboot: p.requiresReboot, deadlineAt: p.deadlineAt, overdue: p.overdue, state: "pending", attempts: 0, error: "", installedAt: "" }))
        .concat(overflow.map((p) => ({ id: p.id, title: p.title, classification: p.classification, requiresReboot: p.requiresReboot, deadlineAt: p.deadlineAt, overdue: p.overdue, state: "skipped", attempts: 0, error: "over the per-job cap", installedAt: "" })));
      if (enq.error) {
        patches.forEach((p) => { if (p.state === "pending") { p.state = "failed"; p.error = S(enq.error, 120); } });
        targets[d.deviceId] = { deviceId: d.deviceId, hostname: d.hostname, osFamily: d.osFamily, jobId: "", state: "failed", attempts: 0, patches, blocked: d.blocked, before: d.before, after: null, reboot: { required: false, state: "none" }, updatedAt: at };
        continue;
      }
      jobIds.push(enq.job.id);
      targets[d.deviceId] = {
        deviceId: d.deviceId, hostname: d.hostname, osFamily: d.osFamily, jobId: enq.job.id, state: "running", attempts: 1,
        patches, blocked: d.blocked, before: d.before, after: null, reboot: { required: false, state: "none" }, updatedAt: at,
      };
    }
    const dep = { kind: "deployment", id: deploymentId, providerId: String(providerId), name, at, createdBy, source: S(opts.source || "manual", 40), targets, jobIds, updatedAt: at };
    dep.summary = summarizeDeployment(dep);
    dep.state = dep.summary.state;
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      p.patchState.deployments = asArr(p.patchState.deployments);
      p.patchState.deployments.push(dep);
      const capH = deployHistory();
      if (p.patchState.deployments.length > capH) p.patchState.deployments = p.patchState.deployments.slice(-capH);
    });
    if (r.error) return r;
    await auditDeploy("patch_deploy", deploymentId, "Deployed " + dep.summary.patches + " approved patch(es) to " + dep.summary.devices + " device(s).");
    return { ok: true, deployment: clone(dep), jobs: jobIds };
  };

  /* ── reboot queue ── */

  PA.rebootTone = (s) => (s === "done" ? "success" : s === "rebooting" ? "info" : s === "pending" || s === "scheduled" ? "warn" : "muted");
  PA.deployTone = (s) => (s === "succeeded" ? "success" : s === "partial" ? "warn" : s === "failed" ? "danger" : s === "cancelled" ? "muted" : "info");

  async function queueReboot(provider, dev, t, dep, at) {
    const atMs = msOf(at) || Date.now();
    const installedReboot = asArr(t.patches).filter((p) => p.state === "installed" && p.requiresReboot).map((p) => p.id);
    if (!rebootEnabled() || !installedReboot.length) { t.reboot = { required: false, state: "none" }; return null; }
    let eff = null;
    try { eff = await PA.effectiveOf(provider, dev); } catch (e) {}
    const fields = asObj(eff && eff.fields);
    const policy = (fields.rebootPolicy && fields.rebootPolicy.value) || "if-required";
    const grace = num(fields.rebootGraceMinutes && fields.rebootGraceMinutes.value, 30);
    const base = {
      kind: "reboot", id: rid("patchreboot"), providerId: String(provider.id), deviceId: String(dev.id),
      hostname: dev.hostname || dev.id, deploymentId: dep ? dep.id : "", policy,
      scheduledAt: "", completedAt: "", jobId: "", reason: installedReboot.join(", "), createdAt: at, updatedAt: at,
    };
    if (policy === "never") { t.reboot = { required: true, state: "skipped", policy, dueAt: "", at }; return Object.assign(base, { state: "skipped", windowId: "", dueAt: "" }); }
    let state = "pending", dueAt = iso(atMs + grace * MIN), windowId = "";
    if (policy === "in-window") {
      windowId = (fields.rebootWindowId && fields.rebootWindowId.value) || "";
      let active = false;
      try {
        const SCH = window.ERP.schedules;
        if (SCH && SCH.windowsCovering && SCH.scopeFor) {
          const scope = await SCH.scopeFor(provider.id, dev.id);
          active = (await SCH.windowsCovering(provider.id, scope, at)).length > 0;
        }
      } catch (e) {}
      state = active ? "scheduled" : "pending";
      dueAt = active ? at : "";
    }
    t.reboot = { required: true, state, policy, dueAt, windowId, at };
    return Object.assign(base, { state, windowId, dueAt });
  }

  PA.reboots = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return [];
    let list = asArr(asObj(g.provider.patchState).reboots).slice().reverse();
    if (opts.deviceId) list = list.filter((r) => String(r.deviceId) === String(opts.deviceId));
    if (opts.state) list = list.filter((r) => r.state === opts.state);
    if (opts.active) list = list.filter((r) => ["pending", "scheduled", "rebooting"].indexOf(r.state) !== -1);
    return list;
  };

  PA.scheduleReboot = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      p.patchState.reboots = asArr(p.patchState.reboots);
      const rb = p.patchState.reboots.find((x) => String(x.deviceId) === String(deviceId) && ["pending", "scheduled", "rebooting"].indexOf(x.state) !== -1);
      if (!rb) return;
      rb.state = "scheduled";
      rb.scheduledAt = at;
      rb.dueAt = opts.dueAt || rb.dueAt || at;
      rb.updatedAt = at;
    });
    if (r.error) return r;
    await auditDeploy("patch_reboot_schedule", deviceId, "Scheduled a reboot for " + deviceId + ".");
    return { ok: true, deviceId: String(deviceId), at };
  };

  PA.performReboot = async function (providerId, deviceId, opts) {
    opts = opts || {};
    if (!rebootEnabled() && !opts.force) return { error: "patch_reboot_disabled" };
    const J = window.ERP.jobs;
    if (!J || typeof J.enqueue !== "function") return { error: "jobs_unavailable" };
    const at = opts.at || now();
    const g = await T.get(providerId);
    if (g.error) return g;
    const dev = asArr(g.provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
    if (!dev) return { error: "unknown_device" };
    const fam = low(familyOf(dev));
    const script = fam === "windows" ? "Restart-Computer -Force"

      : "shutdown -r +1";
    const enq = await J.enqueue({
      providerId, deviceIds: [String(deviceId)], name: "Reboot " + (dev.hostname || deviceId),
      language: fam === "windows" ? "powershell" : "bash", script,
      source: PA.DEPLOY_SOURCE + ":reboot", createdBy: deployActor(), timeoutSeconds: 120, maxAttempts: 1,
    });
    if (enq.error) return enq;
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      p.patchState.reboots = asArr(p.patchState.reboots);
      const rb = p.patchState.reboots.find((x) => String(x.deviceId) === String(deviceId) && ["pending", "scheduled"].indexOf(x.state) !== -1);
      if (rb) { rb.state = "rebooting"; rb.jobId = enq.job.id; rb.updatedAt = at; }
    });
    if (r.error) return r;
    await auditDeploy("patch_reboot", deviceId, "Reboot dispatched to " + (dev.hostname || deviceId) + ".");
    return { ok: true, deviceId: String(deviceId), jobId: enq.job.id };
  };

  PA.completeReboot = async function (providerId, deviceId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const skipped = opts.state === "skipped";
    const r = await T.update(providerId, (p) => {
      p.patchState = asObj(p.patchState);
      p.patchState.reboots = asArr(p.patchState.reboots);
      const rb = p.patchState.reboots.find((x) => String(x.deviceId) === String(deviceId) && ["pending", "scheduled", "rebooting"].indexOf(x.state) !== -1);
      if (rb) { rb.state = skipped ? "skipped" : "done"; rb.completedAt = at; rb.updatedAt = at; }
    });
    if (r.error) return r;
    await auditDeploy(skipped ? "patch_reboot_skip" : "patch_reboot_complete", deviceId, (skipped ? "Skipped" : "Completed") + " the pending reboot for " + deviceId + ".");
    return { ok: true, deviceId: String(deviceId), at };
  };
  PA.skipReboot = (providerId, deviceId, opts) => PA.completeReboot(providerId, deviceId, Object.assign({}, opts || {}, { state: "skipped" }));

  /* ── reconcile: read the jobs back ── */

  async function jobTargetResult(J, providerId, jobId, deviceId) {
    if (!J || !jobId || typeof J.get !== "function") return null;
    let r;
    try { r = await J.get(providerId, jobId); } catch (e) { return null; }
    if (!r || r.error) return null;
    const res = asObj(asObj(r.job).results)[deviceId];
    if (!res || !res.state) return null;
    return { state: res.state, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, error: res.error || "" };
  }
  const JOB_TERMINAL = ["succeeded", "failed", "timed-out", "unsupported", "expired", "cancelled"];

  /* Reconcile a deployment against its jobs. `opts.results` can inject a
     per-device result ({state, exitCode, stdout, error}) instead of reading
     the job (used by tests and by an agent-side shortcut); `opts.force`
     bypasses the retry backoff. */
  PA.reconcileDeployment = async function (providerId, deploymentId, opts) {
    opts = opts || {};
    const J = window.ERP.jobs || null;
    const at = opts.at || now();
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const list = asArr(asObj(provider.patchState).deployments);
    const dep = list.find((d) => String(d.id) === String(deploymentId));
    if (!dep) return { error: "not_found" };
    const scans = await loadScans();
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const newReboots = [];
    const retried = [];
    let changed = false;

    for (const deviceId of Object.keys(asObj(dep.targets))) {
      const t = asObj(dep.targets)[deviceId];
      const dev = devices.find((d) => String(d.id) === String(deviceId));
      if (!dev) continue;
      const injected = asObj(opts.results)[deviceId];
      const res = injected
        ? { state: injected.state || "succeeded", exitCode: injected.exitCode == null ? 0 : injected.exitCode, stdout: injected.stdout || "", stderr: injected.stderr || "", error: injected.error || "" }
        : await jobTargetResult(J, providerId, t.jobId, deviceId);
      if (!res) { if (t.state !== "running") { t.state = "running"; changed = true; } continue; }
      if (JOB_TERMINAL.indexOf(res.state) === -1) { if (t.state !== "running") { t.state = "running"; changed = true; } continue; }

      const parsed = PA.parseResultOutput(res.stdout);
      const byId = {};
      parsed.forEach((p) => { byId[p.id] = p; });
      const jobFailed = res.state !== "succeeded";
      asArr(t.patches).forEach((p) => {
        if (p.state === "installed") return;
        const hit = byId[String(p.id)];
        if (hit) { p.state = hit.ok ? "installed" : "failed"; p.error = hit.ok ? "" : (hit.message || "install failed"); if (hit.ok) p.installedAt = at; }
        else if (jobFailed) { p.state = "failed"; p.error = S(res.error || ("job " + res.state), 200); }
        else if (parsed.length) { p.state = "skipped"; p.error = "not reported"; }
        else { p.state = "installed"; p.installedAt = at; }
      });
      t.attempts = Math.max(1, num(t.attempts, 1));

      if (!t.after) {
        const rec = scans.find((s) => String(s.deviceId) === String(deviceId));
        const installedIds = asArr(t.patches).filter((p) => p.state === "installed").map((p) => String(p.id));
        const curMissing = rec ? asArr(rec.missing).map((m) => ({ id: m.id, title: m.title, classification: m.classification, requiresReboot: m.requiresReboot, detectedAt: m.detectedAt })) : [];
        const nextMissing = curMissing.filter((m) => installedIds.indexOf(String(m.id)) === -1);
        const probe = {};
        probe[String(deviceId)] = { missing: nextMissing };
        let sr = null;
        try { sr = await PA.scan(providerId, { deviceId, at, probes: probe }); } catch (e) {}
        const after = sr && asArr(sr.scans)[0] ? asArr(sr.scans)[0] : null;
        t.after = after ? { at, compliant: !!(asObj(after.compliance).compliant), missingTotal: num(asObj(after.counts).missingTotal, 0), missingRequired: num(asObj(after.counts).missingRequired, 0), overdue: num(asObj(after.counts).overdue, 0) } : null;
        changed = true;
      }

      const installed = asArr(t.patches).filter((p) => p.state === "installed").length;
      const failed = asArr(t.patches).filter((p) => p.state === "failed").length;
      const lastAt = msOf(t.updatedAt) || 0;
      const canRetry = failed > 0 && t.attempts <= retryMax() && !t.retryPending && (opts.force || (at && msOf(at) - lastAt >= retryBackoffMs()));
      if (canRetry && J && typeof J.enqueue === "function") {
        const fails = asArr(t.patches).filter((p) => p.state === "failed");
        const built = PA.deployScript(t.osFamily, fails, { deploymentId, hostname: t.hostname });
        const enq = await J.enqueue({
          providerId, deviceIds: [String(deviceId)], name: "Patch retry " + t.hostname + " (" + fails.length + ")",
          language: built.language, script: built.script, source: PA.DEPLOY_SOURCE + ":" + deploymentId + ":retry",
          createdBy: dep.createdBy, timeoutSeconds: deployTimeout(), maxAttempts: 1,
        });
        if (!enq.error) {
          fails.forEach((p) => { p.state = "pending"; p.error = ""; });
          t.jobId = enq.job.id; t.attempts += 1; t.retryPending = true; t.state = "running"; t.updatedAt = at; changed = true;
          retried.push({ deviceId, jobId: enq.job.id, patches: fails.map((p) => p.id) });
          continue;
        }
      }
      t.retryPending = false;
      const total = asArr(t.patches).length;
      t.state = installed && installed === total ? "succeeded" : (installed > 0 ? "partial" : "failed");
      t.updatedAt = at;
      changed = true;

      if (installed > 0) {
        const rb = await queueReboot(provider, dev, t, dep, at);
        if (rb) newReboots.push(rb);
      }
    }

    dep.summary = summarizeDeployment(dep);
    dep.state = dep.summary.state;
    dep.updatedAt = at;
    if (changed) {
      const r = await T.update(providerId, (p) => {
        p.patchState = asObj(p.patchState);
        p.patchState.deployments = asArr(p.patchState.deployments);
        const i = p.patchState.deployments.findIndex((d) => String(d.id) === String(deploymentId));
        if (i !== -1) p.patchState.deployments[i] = clone(dep);
        p.patchState.reboots = asArr(p.patchState.reboots);
        newReboots.forEach((rb) => {
          if (!p.patchState.reboots.some((x) => String(x.deviceId) === String(rb.deviceId) && String(x.deploymentId) === String(rb.deploymentId))) p.patchState.reboots.push(rb);
        });
      });
      if (r.error) return r;
    }
    if (retried.length) await auditDeploy("patch_deploy_retry", deploymentId, "Retried failed patches on " + retried.length + " device(s).");
    return { ok: true, deployment: clone(dep), changed, retried };
  };

  PA.reconcileAll = async function (providerId, opts) {
    opts = opts || {};
    const list = await PA.deployments(providerId);
    const out = [];
    for (const d of list) {
      if (!opts.recheck && ["succeeded", "failed", "partial", "cancelled"].indexOf(d.state) !== -1) continue;
      const r = await PA.reconcileDeployment(providerId, d.id, opts);
      out.push({ id: d.id, changed: !!r.changed, error: r.error || null });
    }
    return { providerId, reconciled: out.length, results: out };
  };

  PA.deployments = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(asObj(g.provider.patchState).deployments).slice().reverse();
  };
  PA.deployment = async function (providerId, id) {
    const list = await PA.deployments(providerId);
    return list.find((d) => String(d.id) === String(id)) || null;
  };

  /* ── the auditable per-client compliance report ── */

  PA.complianceReport = async function (providerId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const from = opts.from || "";
    const to = opts.to || at;
    const fromMs = msOf(from), toMs = msOf(to) || Date.now();
    const inRange = (t) => { const ms = msOf(t); return ms != null && (fromMs == null || ms >= fromMs) && ms <= toMs; };
    const dr = await PA.deviceRows(providerId, {});
    const allDeps = asArr(asObj(provider.patchState).deployments);
    const deps = allDeps.filter((d) => inRange(d.at));
    const allReboots = asArr(asObj(provider.patchState).reboots);
    const reboots = allReboots.filter((r) => inRange(r.createdAt || r.updatedAt));
    const runs = await PA.scanRuns(providerId);
    const scans = runs.filter((r) => inRange(r.at));

    const devices = dr.rows.map((r) => {
      const forDev = allDeps.filter((d) => asObj(d.targets)[r.deviceId]);
      let installed = 0, failed = 0;
      forDev.forEach((d) => { asArr(asObj(asObj(d.targets)[r.deviceId]).patches).forEach((p) => { if (p.state === "installed") installed += 1; else if (p.state === "failed") failed += 1; }); });
      const latest = forDev.length ? asObj(asObj(forDev[forDev.length - 1]).targets)[r.deviceId] : null;
      const rb = allReboots.find((x) => String(x.deviceId) === String(r.deviceId) && ["pending", "scheduled", "rebooting"].indexOf(x.state) !== -1);
      return {
        deviceId: r.deviceId, hostname: r.hostname, siteName: r.siteName, osFamily: r.osFamily, policyName: r.policyName,
        status: r.complianceStatus, compliant: r.compliant, missingTotal: r.missingTotal, missingRequired: r.missingRequired, overdue: r.overdue, ageDays: r.ageDays,
        deployments: forDev.length, installed, failed,
        before: latest ? latest.before : null, after: latest ? latest.after : null,
        reboot: rb ? rb.state : "none",
      };
    });

    let audit = [];
    try {
      const log = ERP.master && typeof ERP.master.auditLog === "function" ? await ERP.master.auditLog({ all: true }) : [];
      audit = asArr(log).filter((e) => /patch/i.test(String(e.targetType || "")) || /^patch/.test(String(e.action || "")))
        .slice(-200).map((e) => ({ ts: e.ts, actor: e.actor, action: e.action, targetId: e.targetId, summary: e.summary }));
    } catch (e) {}

    const totals = { deployedDevices: 0, deployedPatches: 0, installed: 0, failed: 0, rebootsPending: 0, rebootsDone: 0 };
    deps.forEach((d) => {
      totals.deployedDevices += num(asObj(d.summary).devices, 0);
      totals.deployedPatches += num(asObj(d.summary).patches, 0);
      totals.installed += num(asObj(d.summary).installed, 0);
      totals.failed += num(asObj(d.summary).failed, 0);
    });
    reboots.forEach((r) => { if (["pending", "scheduled", "rebooting"].indexOf(r.state) !== -1) totals.rebootsPending += 1; else if (r.state === "done") totals.rebootsDone += 1; });

    return {
      kind: "patchcompliance", providerId: String(providerId), providerName: provider.name || "", from, to, generatedAt: at,
      summary: dr.summary, totals, devices,
      deployments: deps.map((d) => ({ id: d.id, at: d.at, name: d.name, state: d.state, summary: clone(d.summary) })),
      reboots: reboots.map((r) => clone(r)),
      scans: scans.length, audit,
    };
  };

  PA.exportReport = function (report) { return JSON.stringify(report || {}, null, 2); };

  PA.download = function (filename, text) {
    try {
      const blob = new Blob([String(text == null ? "" : text)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename || "download.json";
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 1000);
      return true;
    } catch (e) { return false; }
  };

  /* Render an auditable compliance report (module-scope so it can be used
     by the console and by any other surface). */
  PA.renderReport = function (rep) {
    const ui = ERP.ui, esc = ui.esc;
    if (!rep || rep.error) return '<p class="erp-sub">No report generated yet.</p>';
    const s = asObj(rep.summary), t = asObj(rep.totals);
    const kv = (label, value) => '<div class="rmm-kv-row"><span>' + esc(label) + "</span><b>" + value + "</b></div>";
    const rows = asArr(rep.devices).map((d) => ({
      device: "<b>" + esc(d.hostname) + "</b>" + (d.siteName ? '<div class="erp-sub">' + esc(d.siteName) + "</div>" : ""),
      os: esc(d.osFamily || "—"),
      status: complianceBadge(d.status),
      missing: String(num(d.missingRequired, 0)) + " / " + String(num(d.missingTotal, 0)),
      overdue: num(d.overdue, 0) ? badge(String(d.overdue), "danger") : "0",
      deployed: d.deployments ? String(num(d.installed, 0)) + " ok / " + String(num(d.failed, 0)) + " failed" : "—",
      before: d.before ? (d.before.compliant ? "compliant" : "missing " + num(d.before.missingRequired, 0)) : "—",
      after: d.after ? (d.after.compliant ? "compliant" : "missing " + num(d.after.missingRequired, 0)) : "—",
      reboot: badge(d.reboot || "none", PA.rebootTone(d.reboot)),
    }));
    const auditRows = asArr(rep.audit).slice().reverse().map((e) => ({ ts: e.ts, actor: e.actor, action: e.action, summary: e.summary }));
    return '<div class="rmm-patch-report">' +
      '<div class="rmm-kv">' +
        kv("Client", esc(rep.providerName || rep.providerId)) +
        kv("Window", esc((rep.from || "…") + " → " + String(rep.to).slice(0, 10))) +
        kv("Generated", esc(ui.dateTime(rep.generatedAt))) +
        kv("Devices", String(num(s.devices, 0))) +
        kv("Compliant", String(num(s.compliant, 0))) +
        kv("Non-compliant", String(num(s.nonCompliant, 0))) +
        kv("Missing required", String(num(s.missingRequired, 0))) +
        kv("Overdue", String(num(s.overdue, 0))) +
        kv("Patches installed", String(num(t.installed, 0))) +
        kv("Patches failed", String(num(t.failed, 0))) +
        kv("Reboots pending", String(num(t.rebootsPending, 0))) +
        kv("Scans in window", String(num(rep.scans, 0))) +
      "</div>" +
      '<h4 class="rmm-section-title">Per-device compliance</h4>' +
      ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "os", label: "OS", render: (r) => r.os },
        { key: "status", label: "Status", render: (r) => r.status },
        { key: "missing", label: "Missing req/all", render: (r) => r.missing },
        { key: "overdue", label: "Overdue", render: (r) => r.overdue },
        { key: "deployed", label: "Deployed", render: (r) => r.deployed },
        { key: "before", label: "Before", render: (r) => r.before },
        { key: "after", label: "After", render: (r) => r.after },
        { key: "reboot", label: "Reboot", render: (r) => r.reboot },
      ], rows, { scroll: true, emptyText: "No devices." }) +
      (auditRows.length ? '<h4 class="rmm-section-title">Audit trail</h4>' + ui.table([
        { key: "ts", label: "When", render: (r) => esc(ui.dateTime(r.ts)) },
        { key: "actor", label: "Actor", render: (r) => esc(r.actor) },
        { key: "action", label: "Action", render: (r) => esc(r.action) },
        { key: "summary", label: "Detail", render: (r) => esc(r.summary) },
      ], auditRows, { scroll: true }) : "") +
      "</div>";
  };

  /* ═══════════════════════ demo seed ═══════════════════════ */

  const DEMO_MISSING = {
    windows: [
      { id: "KB5034765", title: "2024-02 Cumulative Update for Windows", classification: "Security Updates", requiresReboot: true, agoDays: 9 },
      { id: "KB5031539", title: "Servicing stack update", classification: "Critical Updates", requiresReboot: true, agoDays: 3 },
      { id: "KB5034441", title: "Security Update for Windows Recovery Environment", classification: "Security Updates", requiresReboot: true, agoDays: 15 },
      { id: "KB5036893", title: "2024-04 Feature update for Windows", classification: "Feature Packs", requiresReboot: true, agoDays: 5 },
      { id: "KB4023057", title: "Update for Windows Update Service components", classification: "Updates", requiresReboot: false, agoDays: 21 },
    ],
    linux: [
      { id: "USN-6666-1", title: "linux-image-generic security update", classification: "Security", requiresReboot: true, agoDays: 12 },
      { id: "USN-6616-1", title: "openssh security update", classification: "Security", requiresReboot: true, agoDays: 30 },
      { id: "USN-6644-1", title: "libssl3 security update", classification: "Security", requiresReboot: true, agoDays: 6 },
    ],
    macos: [
      { id: "macOS-14.4", title: "macOS Sonoma 14.4", classification: "OS Update", requiresReboot: true, agoDays: 20 },
      { id: "macOS-14.4.1", title: "macOS Sonoma 14.4.1 security update", classification: "Security Update", requiresReboot: true, agoDays: 4 },
    ],
  };
  PA.DEMO_MISSING = DEMO_MISSING;

  /* The demo override's id is stable so an idempotency check survives a
     round-trip through `normalizePolicy` (which drops unknown fields). */
  const DEMO_OVERRIDE_ID = "patchpol-demo-servers";
  PA.DEMO_OVERRIDE_ID = DEMO_OVERRIDE_ID;

  async function seedDemoRun(opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { skipped: true, reason: "patch_disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };

    /* rmm.devices.js seeds the demo fleet on the same boot; both seeds await
       `T.ready`, so wait briefly for devices to exist before computing the
       missing set — otherwise an empty fleet gets seeded and must be re-run. */
    let g = await T.get(demo.id);
    let provider = g.error ? {} : g.provider;
    for (let i = 0; i < 16 && !asArr(provider.devices).length; i++) {
      await new Promise((res) => setTimeout(res, 300));
      g = await T.get(demo.id);
      if (!g.error) provider = g.provider;
    }

    const runs = asArr(asObj(provider.patchState).scanRuns);
    const policies = asArr(asObj(provider.patchState).policies);
    const demoCount = policies.filter((p) => p.demo || p.id === DEMO_OVERRIDE_ID).length;
    const already = demoCount === 1 && runs.some((r) => r.deviceId);
    /* demoCount > 1 means an older seed duplicated the override — fall
       through to the write below, which de-duplicates and heals it. */
    if (already && !opts.force) return { skipped: true, reason: "patch_demo_exists", providerId: demo.id };

    const ran = Date.now();
    const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
    const seeded = {};
    devices.forEach((d) => {
      const fam = familyOf(d);
      const list = DEMO_MISSING[fam] || [];
      if (!list.length) return;
      seeded[String(d.id)] = list.map((m) => normalizeMissing({
        id: m.id, title: m.title, classification: m.classification, requiresReboot: m.requiresReboot,
        detectedAt: iso(ran - m.agoDays * DAY), source: "agent",
      }, iso(ran)));
    });

    /* the per-group override the task asks to demonstrate */
    const override = PA.normalizePolicy({
      id: DEMO_OVERRIDE_ID, kind: "patchpolicy", demo: true,
      name: "Servers — patch ring", description: "Demo override: Windows servers get a shorter deadline and approve driver updates, rebooting only in the maintenance window.",
      enabled: true, priority: 200, osFamily: "windows",
      targets: { groupIds: ["grp-demo-servers"], tags: [], deviceIds: [] },
      rebootPolicy: "in-window", rebootGraceMinutes: 15, enforceDeadline: true,
      classifications: { "pc-driver": { decision: "approve", deferralDays: 0, deadlineDays: 14, requiresReboot: true }, "pc-feature": { decision: "defer", deferralDays: 30, deadlineDays: 60, requiresReboot: true } },
      createdAt: iso(ran), updatedAt: iso(ran),
    });

    let wrote = false;
    for (let attempt = 0; attempt < 6 && !wrote; attempt++) {
      const r = await T.update(demo.id, (p) => {
        p.patchState = asObj(p.patchState);
        /* Heal any duplicate demo policies left by an earlier seed, then add
           the override only if it is genuinely absent. */
        let list = asArr(p.patchState.policies);
        let seen = false;
        list = list.filter((x) => {
          if (x && x.id === DEMO_OVERRIDE_ID) { if (seen) return false; seen = true; }
          return true;
        });
        if (!seen) list.push(clone(override));
        p.patchState.policies = list;
        asArr(p.devices).forEach((dev) => {
          const list2 = seeded[String(dev.id)];
          if (!list2) return;
          dev.custom = asObj(dev.custom);
          if (!asObj(dev.custom.patchScan).missing) dev.custom.patchScan = { at: iso(ran), source: "agent", missing: clone(list2) };
        });
        p.updatedAt = iso(ran);
      });
      if (!r.error) wrote = true; else await new Promise((res) => setTimeout(res, 50));
    }
    if (!wrote) return { error: "seed_write_failed", providerId: demo.id };
    const scanRes = await PA.scan(demo.id, { force: true });
    PA.__seeded = { providerId: demo.id, at: iso(ran), devices: Object.keys(seeded).length };
    return { providerId: demo.id, policies: 1, devices: Object.keys(seeded).length, scan: scanRes.summary };
  }

  /* Concurrent callers — the boot seed and a manual/UI call — share one run
     so the demo provider is never written twice in parallel. */
  PA.seedDemo = function (opts) {
    if (PA.__seedPromise) return PA.__seedPromise;
    PA.__seedPromise = seedDemoRun(opts).catch((e) => {
      console.error("patch seed failed", e);
      return { error: "seed_failed", message: String((e && e.message) || e) };
    });
    const clear = () => { PA.__seedPromise = null; };
    PA.__seedPromise.then(clear, clear);
    return PA.__seedPromise;
  };

  /* ═══════════════════════ UI ═══════════════════════ */

  const STATUS_TONE = { compliant: "success", "non-compliant": "danger", unknown: "muted" };
  PA.statusTone = (s) => STATUS_TONE[s] || "muted";
  PA.decisionTone = (d) => (d === "approve" ? "success" : d === "deny" ? "danger" : d === "defer" ? "warn" : "muted");

  PA.currentProviderId = null;

  const esc2 = (v) => ERP.ui.esc(v);

  function badge(text, tone) { return ERP.ui.badge(text, tone); }

  function complianceBadge(status) { return badge(status === "non-compliant" ? "Non-compliant" : status === "compliant" ? "Compliant" : "Not scanned", STATUS_TONE[status] || "muted"); }

  function windowLabel(provider, id) {
    if (!id) return "—";
    return id;
  }

  function barChart(points, opts) {
    const ui = ERP.ui, esc = ui.esc;
    opts = opts || {};
    if (!points.length) return '<div class="rmm-chart-empty">No data.</div>';
    const max = Math.max(1, ...points.map((p) => num(p.count, 0)));
    return '<div class="rmm-chart" role="img" aria-label="' + esc(opts.label || "chart") + '">' +
      points.map((p) => {
        const h = Math.max(2, Math.round((num(p.count, 0) / max) * 100));
        return '<div class="rmm-chart-col" title="' + esc(p.date + ": " + p.count) + '"><span class="rmm-chart-bar" style="height:' + h + '%"></span><span class="rmm-chart-x">' + esc(String(p.date).slice(5)) + "</span></div>";
      }).join("") + "</div>";
  }

  /* Fills `host` with the patch console. opts: {provider, providerId,
     providers, embedded, toast, onChange}. */
  PA.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});
    const state = { tab: "compliance", rollupBy: "group", status: "", q: "", previewDevice: "", stats: null, rows: [], rollups: {}, plan: null, deployments: [], reboots: [], report: null };

    async function load() { const g = await T.get(opts.providerId); return g.error ? (opts.provider || {}) : g.provider; }

    async function compute() {
      const provider = await load();
      state.stats = await PA.stats(opts.providerId).catch(() => null);
      const dr = await PA.deviceRows(opts.providerId, { status: state.status, q: state.q });
      state.rows = dr.error ? [] : dr.rows;
      state.rollups = { group: (await PA.rollup(opts.providerId, { by: "group" })).buckets || [], site: (await PA.rollup(opts.providerId, { by: "site" })).buckets || [], os: (await PA.rollup(opts.providerId, { by: "os" })).buckets || [] };
      state.policies = await PA.allPolicies(opts.providerId);
      state.runs = await PA.scanRuns(opts.providerId);
      state.catalogue = await PA.patchCatalogue(opts.providerId);
      state.plan = await PA.plan(opts.providerId, {});
      state.deployments = await PA.deployments(opts.providerId);
      state.reboots = await PA.reboots(opts.providerId);
      state.lastScan = state.stats && state.stats.lastScanAt;
      return provider;
    }

    function statCards() {
      const s = state.stats || {};
      return ui.grid([
        ui.statCard({ label: "Devices", value: String(num(s.devices, 0)), sub: num(s.scannedDevices, 0) + " scanned" }),
        ui.statCard({ label: "Compliant", value: String(num(s.compliant, 0)), tone: "success", sub: num(s.devices, 0) ? Math.round((num(s.compliant, 0) / num(s.devices, 0)) * 100) + "% of fleet" : "—" }),
        ui.statCard({ label: "Non-compliant", value: String(num(s.nonCompliant, 0)), tone: num(s.nonCompliant, 0) ? "danger" : "muted", sub: num(s.unknown, 0) + " not scanned" }),
        ui.statCard({ label: "Missing required", value: String(num(s.missingRequired, 0)), sub: num(s.missingTotal, 0) + " missing in total" }),
        ui.statCard({ label: "Overdue", value: String(num(s.overdue, 0)), tone: num(s.overdue, 0) ? "danger" : "muted", sub: "past policy deadline" }),
        ui.statCard({ label: "Oldest", value: num(s.oldestAgeDays, 0) + "d", sub: "longest non-compliant" }),
      ], "rmm-tri-metrics");
    }

    const ROLLUP_LABEL = { group: "Device group", site: "Site", os: "OS family" };
    const DEPLOY_LABEL = { planned: "Planned", running: "Running", succeeded: "Succeeded", partial: "Partial", failed: "Failed", cancelled: "Cancelled" };
    const PATCH_LABEL = { pending: "Pending", installed: "Installed", failed: "Failed", skipped: "Skipped" };
    const REBOOT_LABEL = { none: "—", pending: "Pending", scheduled: "Scheduled", rebooting: "Rebooting", done: "Done", skipped: "Skipped" };
    const deployBadge = (s) => badge(DEPLOY_LABEL[s] || s || "—", PA.deployTone(s));
    const patchStateBadge = (s) => badge(PATCH_LABEL[s] || s || "—", s === "installed" ? "success" : s === "failed" ? "danger" : s === "skipped" ? "muted" : "info");

    function rollupCard(by, actions) {
      const buckets = asArr(state.rollups[by]);
      const rows = buckets.map((b) => ({
        label: "<b>" + esc(b.label) + "</b>",
        devices: String(b.devices),
        compliance: badge(b.compliancePct + "%", b.compliancePct >= 90 ? "success" : b.compliancePct >= 60 ? "warn" : "danger"),
        non: String(b.nonCompliant),
        required: String(b.missingRequired),
        overdue: num(b.overdue, 0) ? String(b.overdue) : "—",
        oldest: b.oldestAgeDays ? b.oldestAgeDays + "d" : "—",
      }));
      const body = ui.table([
        { key: "label", label: ROLLUP_LABEL[by] || by, render: (r) => r.label },
        { key: "devices", label: "Devices", render: (r) => r.devices },
        { key: "compliance", label: "Compliant", render: (r) => r.compliance },
        { key: "non", label: "Non-compliant", render: (r) => r.non },
        { key: "required", label: "Missing", render: (r) => r.required },
        { key: "overdue", label: "Overdue", render: (r) => r.overdue },
        { key: "oldest", label: "Oldest", render: (r) => r.oldest },
      ], rows, { scroll: true, emptyText: "No devices." });
      return ui.card("Compliance by " + (ROLLUP_LABEL[by] || by).toLowerCase(), body, { actions: actions || "" });
    }

    function rollupPicker() {
      return '<span style="display:flex;align-items:center;gap:6px"><label class="erp-sub">Roll up by</label><select name="pa_by">' +
        ["group", "site", "os"].map((v) => '<option value="' + v + '"' + (state.rollupBy === v ? " selected" : "") + ">" + ROLLUP_LABEL[v] + "</option>").join("") +
        "</select></span>";
    }

    function deviceTable() {
      const rows = state.rows.map((r) => ({
        device: "<b>" + esc(r.hostname) + "</b>" + (r.siteName ? '<div class="erp-sub">' + esc(r.siteName) + "</div>" : ""),
        os: esc(r.osFamily || "—") + (asArr(r.groupNames).length ? '<div class="erp-sub">' + esc(asArr(r.groupNames).join(", ")) + "</div>" : ""),
        status: complianceBadge(r.complianceStatus),
        counts: r.counts ? String(num(r.counts.missingRequired, 0)) + " required / " + String(num(r.counts.missingTotal, 0)) + " total" + (num(r.counts.overdue, 0) ? " " + badge(num(r.counts.overdue, 0) + " overdue", "danger") : "") : '<span class="erp-sub">—</span>',
        age: r.complianceStatus === "non-compliant" ? esc(num(r.ageDays, 0) + "d") + (r.withinGrace ? " " + badge("in grace", "warn") : "") : "—",
        policy: '<span class="erp-sub">' + esc(r.policyName || "—") + "</span>",
        actions: ui.btn("Scan", { small: true, act: "pa-scan-device", arg: r.deviceId }) + " " + ui.btn("View", { small: true, act: "pa-device", arg: r.deviceId }),
      }));
      return ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "os", label: "OS / groups", render: (r) => r.os },
        { key: "status", label: "Compliance", render: (r) => r.status },
        { key: "counts", label: "Missing", render: (r) => r.counts },
        { key: "age", label: "Non-compliant for", render: (r) => r.age },
        { key: "policy", label: "Policy", render: (r) => r.policy },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No devices match this view." });
    }

    function complianceTab() {
      return statCards() +
        '<div class="erp-inline-form rmm-patch-filters">' +
        '<div class="field"><label>Status</label><select name="pa_status"><option value="">All</option>' + ["non-compliant", "compliant", "unknown"].map((s) => '<option value="' + s + '"' + (state.status === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select></div>" +
        '<div class="field" style="flex:1 1 180px"><label>Search</label><input type="text" name="pa_q" value="' + esc(state.q) + '" placeholder="hostname, site, policy…"></div>' +
        '<div class="field" style="flex:0 0 auto;align-self:flex-end">' + ui.btn("Scan all now", { primary: true, act: "pa-scan-all" }) + "</div>" +
        "</div>" +
        '<div class="rmm-patch-rollups">' + rollupCard(state.rollupBy, rollupPicker()) + "</div>" +
        '<h4 class="rmm-section-title">Devices</h4>' + deviceTable();
    }

    function policyTable() {
      const rows = asArr(state.policies).map((p) => ({
        name: "<b>" + esc(p.name) + "</b>" + (p.isDefault ? " " + badge("default", "info") : "") + '<div class="erp-sub">' + esc(p.description || "") + "</div>",
        os: esc(p.osFamily === "all" ? "Any OS" : p.osFamily),
        scope: esc(scopeLabel(p)),
        priority: p.isDefault ? "—" : String(p.priority),
        state: p.enabled ? badge("enabled", "success") : badge("disabled", "muted"),
        actions: p.isDefault
          ? '<span class="erp-sub">read-only baseline</span>'
          : ui.btn("Edit", { small: true, act: "pa-policy-edit", arg: p.id }) + " " + ui.btn(p.enabled ? "Disable" : "Enable", { small: true, act: "pa-policy-toggle", arg: p.id }) + " " + ui.btn("Duplicate", { small: true, act: "pa-policy-dup", arg: p.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "pa-policy-del", arg: p.id }),
      }));
      return ui.card("Patch policies", ui.table([
        { key: "name", label: "Policy", render: (r) => r.name },
        { key: "os", label: "OS", render: (r) => r.os },
        { key: "scope", label: "Applies to", render: (r) => r.scope },
        { key: "priority", label: "Priority", render: (r) => r.priority },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true }), { actions: ui.btn("New policy", { small: true, primary: true, act: "pa-policy-new" }) });
    }

    function scopeLabel(p) {
      const parts = [];
      if (p.osFamily && p.osFamily !== "all") parts.push("OS: " + p.osFamily);
      if (p.siteId) parts.push("site " + p.siteId);
      const t = asObj(p.targets);
      if (asArr(t.groupIds).length) parts.push(asArr(t.groupIds).length + " group(s)");
      if (asArr(t.tags).length) parts.push("tags: " + asArr(t.tags).join(", "));
      if (asArr(t.deviceIds).length) parts.push(asArr(t.deviceIds).length + " device(s)");
      if (!parts.length) return "Every device (provider-wide)";
      return parts.join(" · ");
    }

    async function effectivePreview() {
      const provider = await load();
      const devices = asArr(provider.devices).map(D.normalizeDevice);
      const dev = devices.find((d) => String(d.id) === String(state.previewDevice)) || devices[0];
      if (!dev) return '<p class="erp-sub">No devices.</p>';
      state.previewDevice = String(dev.id);
      const eff = await PA.effectiveOf(provider, dev);
      const fieldRows = [
        ["Install window", windowLabel(provider, eff.fields.installWindowId.value), eff.fields.installWindowId.source],
        ["Reboot window", windowLabel(provider, eff.fields.rebootWindowId.value), eff.fields.rebootWindowId.source],
        ["Reboot policy", PA.REBOOT_LABEL[eff.fields.rebootPolicy.value] || eff.fields.rebootPolicy.value, eff.fields.rebootPolicy.source],
        ["Reboot grace", num(eff.fields.rebootGraceMinutes.value, 0) + " min", eff.fields.rebootGraceMinutes.source],
        ["Enforce deadlines", eff.fields.enforceDeadline.value !== false ? "Yes" : "No", eff.fields.enforceDeadline.source],
        ["Missing-patch grace", num(eff.fields.missingGraceDays.value, 0) + " days", eff.fields.missingGraceDays.source],
      ].map(([k, v, s]) => ({ k: esc(k), v: esc(v), s: '<span class="erp-sub">' + esc(s) + "</span>" }));
      const classRows = asArr(eff.rows).map((r) => ({
        cls: esc(r.label) + (r.categoryCode ? '<div class="erp-sub">' + esc(r.categoryCode) + "</div>" : ""),
        decision: badge(PA.DECISION_LABEL[r.decision] || r.decision, PA.decisionTone(r.decision)),
        defer: r.decision === "defer" ? num(r.deferralDays, 0) + "d" : "—",
        deadline: num(r.deadlineDays, 0) > 0 ? num(r.deadlineDays, 0) + "d" : "none",
        reboot: r.requiresReboot ? "yes" : "no",
        source: '<span class="erp-sub">' + esc(r.source) + "</span>",
      }));
      return '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Effective policy for</label><select name="pa_preview">' +
        devices.map((d) => '<option value="' + esc(d.id) + '"' + (String(d.id) === String(dev.id) ? " selected" : "") + ">" + esc(d.hostname || d.displayName || d.id) + "</option>").join("") +
        "</select></div></div>" +
        ui.grid([
          ui.card("Resolved settings", ui.table([{ key: "k", label: "Setting", render: (r) => r.k }, { key: "v", label: "Value", render: (r) => r.v }, { key: "s", label: "From", render: (r) => r.s }], fieldRows)),
          ui.card("Precedence", ui.table([{ key: "name", label: "Policy", render: (r) => r.name }, { key: "priority", label: "Priority", render: (r) => r.priority }, { key: "matchedBy", label: "Matched by", render: (r) => r.matchedBy }], asArr(eff.chain).map((c) => ({ name: esc(c.name) + (c.isDefault ? " " + badge("baseline", "info") : ""), priority: String(c.priority), matchedBy: esc(c.matchedBy) })), { emptyText: "—" })),
        ], "rmm-patch-preview") +
        '<h4 class="rmm-section-title">Per-classification decisions <span class="erp-sub">· ' + esc(dev.hostname || "") + "</span></h4>" +
        ui.table([
          { key: "cls", label: "Classification", render: (r) => r.cls },
          { key: "decision", label: "Decision", render: (r) => r.decision },
          { key: "defer", label: "Defer", render: (r) => r.defer },
          { key: "deadline", label: "Deadline", render: (r) => r.deadline },
          { key: "reboot", label: "Reboot", render: (r) => r.reboot },
          { key: "source", label: "From", render: (r) => r.source },
        ], classRows, { scroll: true });
    }

    async function policyTab() {
      return '<div class="rmm-patch-effective">' + (await effectivePreview()) + "</div>" + policyTable();
    }

    function catalogueTab() {
      const runs = asArr(state.runs).map((r) => ({
        at: esc(ui.dateTime(r.at)), device: esc(r.hostname || r.deviceId), source: esc(r.source || ""),
        missing: String(num(r.missing, 0)), required: String(num(r.required, 0)), overdue: num(r.overdue, 0) ? badge(String(num(r.overdue, 0)), "danger") : "0",
        status: r.compliant ? badge("compliant", "success") : badge("non-compliant", "danger"),
      }));
      const pat = asArr(state.catalogue).map((p) => ({
        title: esc(p.title), id: esc(p.id), cls: esc(p.classification), devices: String(num(p.deviceCount, 0)),
      }));
      return ui.grid([
        ui.card("Scan history (" + runs.length + ")", ui.table([
          { key: "at", label: "When", render: (r) => r.at },
          { key: "device", label: "Device", render: (r) => r.device },
          { key: "source", label: "Source", render: (r) => r.source },
          { key: "missing", label: "Missing", render: (r) => r.missing },
          { key: "required", label: "Required", render: (r) => r.required },
          { key: "overdue", label: "Overdue", render: (r) => r.overdue },
          { key: "status", label: "Result", render: (r) => r.status },
        ], runs, { scroll: true, emptyText: "No scans yet." })),
        ui.card("Known updates (" + pat.length + ")", ui.table([
          { key: "title", label: "Update", render: (r) => r.title },
          { key: "id", label: "ID", render: (r) => r.id },
          { key: "cls", label: "Classification", render: (r) => r.cls },
          { key: "devices", label: "Installed on", render: (r) => r.devices },
        ], pat, { scroll: true, emptyText: "No installed-patch inventory yet." })),
      ], "rmm-patch-catalogue");
    }

    function deploySummary() {
      const plan = asObj(state.plan);
      const totals = asObj(plan.totals);
      const deps = asArr(state.deployments);
      const active = deps.filter((d) => ["planned", "running"].indexOf(d.state) !== -1).length;
      const pendReboots = asArr(state.reboots).filter((r) => ["pending", "scheduled", "rebooting"].indexOf(r.state) !== -1).length;
      let installed = 0, failed = 0;
      deps.forEach((d) => { installed += num(asObj(d.summary).installed, 0); failed += num(asObj(d.summary).failed, 0); });
      return ui.grid([
        ui.statCard({ label: "Ready to deploy", value: String(num(totals.devices, 0)), sub: num(totals.patches, 0) + " approved patch(es)" }),
        ui.statCard({ label: "Blocked", value: String(num(totals.blocked, 0)), tone: num(totals.blocked, 0) ? "warn" : "muted", sub: "denied or deferred" }),
        ui.statCard({ label: "Active runs", value: String(active), sub: deps.length + " deployment(s) total" }),
        ui.statCard({ label: "Reboots queued", value: String(pendReboots), tone: pendReboots ? "warn" : "muted", sub: "awaiting dispatch" }),
        ui.statCard({ label: "Installed", value: String(installed), tone: "success", sub: "across all runs" }),
        ui.statCard({ label: "Failed", value: String(failed), tone: failed ? "danger" : "muted", sub: "across all runs" }),
      ], "rmm-tri-metrics");
    }

    function planCard() {
      const plan = asObj(state.plan);
      const devs = asArr(plan.devices).filter((d) => asArr(d.patches).length || asArr(d.blocked).length);
      const rows = devs.map((d) => ({
        device: "<b>" + esc(d.hostname) + '</b><div class="erp-sub">' + esc(d.osFamily || "") + " · " + esc(d.policyName || "no policy") + "</div>",
        ready: asArr(d.patches).length ? String(asArr(d.patches).length) : '<span class="erp-sub">—</span>',
        reboot: asArr(d.patches).some((p) => p.requiresReboot) ? badge("reboot", "warn") : '<span class="erp-sub">—</span>',
        blocked: asArr(d.blocked).length ? asArr(d.blocked).map((b) => badge(S(b.reason, 40).replace(/_/g, " "), "muted")).join(" ") : '<span class="erp-sub">—</span>',
        before: d.before ? (d.before.compliant ? badge("compliant", "success") : badge(num(d.before.missingRequired, 0) + " missing", "danger")) : '<span class="erp-sub">not scanned</span>',
      }));
      const ready = num(asObj(plan.totals).devices, 0);
      const body = ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "ready", label: "Approved", render: (r) => r.ready },
        { key: "reboot", label: "Reboot", render: (r) => r.reboot },
        { key: "blocked", label: "Held back", render: (r) => r.blocked },
        { key: "before", label: "Compliance before", render: (r) => r.before },
      ], rows, { scroll: true, emptyText: "Nothing approved and ready to deploy." });
      return ui.card("Ready to deploy", body, { actions: ui.btn("Deploy ready (" + ready + ")", { small: true, primary: true, disabled: !ready, act: "pa-deploy-run" }) });
    }

    function deploymentsCard() {
      const rows = asArr(state.deployments).map((d) => {
        const s = asObj(d.summary);
        return {
          name: "<b>" + esc(d.name) + '</b><div class="erp-sub">' + esc(ui.dateTime(d.at)) + " · " + esc(d.createdBy || "") + "</div>",
          state: deployBadge(d.state),
          devices: String(num(s.devices, 0)),
          progress: badge(num(s.installed, 0) + " ok", "success") + " " + badge(num(s.failed, 0) + " failed", num(s.failed, 0) ? "danger" : "muted") + " " + badge(num(s.pending, 0) + " pending", "info"),
          reboots: num(s.reboots, 0) ? badge(String(num(s.reboots, 0)), "warn") : '<span class="erp-sub">—</span>',
          actions: ui.btn("Reconcile", { small: true, act: "pa-deploy-reconcile", arg: d.id }) + " " + ui.btn("View", { small: true, act: "pa-deploy-view", arg: d.id }),
        };
      });
      return ui.card("Deployments (" + rows.length + ")", ui.table([
        { key: "name", label: "Run", render: (r) => r.name },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "devices", label: "Devices", render: (r) => r.devices },
        { key: "progress", label: "Patch progress", render: (r) => r.progress },
        { key: "reboots", label: "Reboots", render: (r) => r.reboots },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No deployments yet." }));
    }

    function rebootsCard() {
      const rows = asArr(state.reboots).map((r) => ({
        device: "<b>" + esc(r.hostname || r.deviceId) + '</b><div class="erp-sub">' + esc(r.policy || "") + (r.reason ? " · " + esc(r.reason) : "") + "</div>",
        state: badge(REBOOT_LABEL[r.state] || r.state, PA.rebootTone(r.state)),
        due: r.dueAt ? esc(ui.dateTime(r.dueAt)) : '<span class="erp-sub">—</span>',
        created: '<span class="erp-sub">' + esc(ui.dateTime(r.createdAt)) + "</span>",
        actions: ["pending", "scheduled"].indexOf(r.state) !== -1
          ? ui.btn("Reboot now", { small: true, primary: true, act: "pa-reboot-now", arg: r.deviceId }) + " " + ui.btn("Skip", { small: true, act: "pa-reboot-skip", arg: r.deviceId })
          : (r.state === "rebooting" ? ui.btn("Mark done", { small: true, act: "pa-reboot-done", arg: r.deviceId }) : '<span class="erp-sub">—</span>'),
      }));
      const active = asArr(state.reboots).filter((r) => ["pending", "scheduled", "rebooting"].indexOf(r.state) !== -1).length;
      return ui.card("Reboot queue (" + active + " active / " + rows.length + " total)", ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "state", label: "State", render: (r) => r.state },
        { key: "due", label: "Due", render: (r) => r.due },
        { key: "created", label: "Created", render: (r) => r.created },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No reboots queued." }));
    }

    function reportCard() {
      const body = state.report
        ? PA.renderReport(state.report)
        : '<p class="erp-sub">Generate a point-in-time patch-compliance report for this client — fleet compliance, per-device before/after, deployments, the reboot queue and the patch audit trail.</p>';
      const actions = ui.btn("Generate report", { small: true, primary: true, act: "pa-report-gen" }) + " " + ui.btn("Export JSON", { small: true, act: "pa-report-export" });
      return ui.card("Compliance report", body, { actions });
    }

    function deployTab() {
      return deploySummary() + planCard() + deploymentsCard() + rebootsCard() + reportCard();
    }

    async function openDeployment(id) {
      const dep = await PA.deployment(opts.providerId, id);
      if (!dep) return toast("Deployment not found", "error");
      const s = asObj(dep.summary);
      const kv = (k, v) => '<div class="rmm-kv-row"><span>' + esc(k) + "</span><b>" + v + "</b></div>";
      const headers = '<div class="rmm-kv">' +
        kv("State", deployBadge(dep.state)) +
        kv("Started", esc(ui.dateTime(dep.at))) +
        kv("By", esc(dep.createdBy || "—")) +
        kv("Devices", String(num(s.devices, 0))) +
        kv("Installed", String(num(s.installed, 0))) +
        kv("Failed", String(num(s.failed, 0))) +
        kv("Pending", String(num(s.pending, 0))) +
        kv("Reboots", String(num(s.reboots, 0))) +
        "</div>";
      const cards = Object.keys(asObj(dep.targets)).map((devId) => {
        const t = asObj(dep.targets)[devId];
        const rows = asArr(t.patches).map((p) => ({
          patch: "<b>" + esc(p.title) + '</b><div class="erp-sub">' + esc(p.id) + "</div>",
          state: patchStateBadge(p.state),
          reboot: p.requiresReboot ? "yes" : "no",
          attempts: String(num(p.attempts, 0)),
          note: p.error ? '<span class="erp-sub">' + esc(p.error) + "</span>" : (p.installedAt ? '<span class="erp-sub">' + esc(ui.dateTime(p.installedAt)) + "</span>" : '<span class="erp-sub">—</span>'),
        }));
        const head = '<div class="rmm-status-line">' + deployBadge(t.state) +
          (t.jobId ? ' <span class="erp-sub">job ' + esc(t.jobId) + "</span>" : "") +
          (asObj(t.reboot).required ? " " + badge("reboot " + asObj(t.reboot).state, PA.rebootTone(asObj(t.reboot).state)) : "") + "</div>";
        const blocked = asArr(t.blocked).length ? '<p class="erp-sub">Held back: ' + esc(asArr(t.blocked).map((b) => b.id + " (" + String(b.reason).replace(/_/g, " ") + ")").join(", ")) + "</p>" : "";
        return ui.card(esc(t.hostname || devId), head + blocked + ui.table([
          { key: "patch", label: "Update", render: (r) => r.patch },
          { key: "state", label: "State", render: (r) => r.state },
          { key: "reboot", label: "Reboot", render: (r) => r.reboot },
          { key: "attempts", label: "Tries", render: (r) => r.attempts },
          { key: "note", label: "Detail", render: (r) => r.note },
        ], rows, { scroll: true }));
      }).join("");
      ui.modal({ title: dep.name, size: "lg", body: '<div class="rmm-patch-report">' + headers + '<div class="rmm-patch-deploy-targets">' + cards + "</div></div>" });
    }

    async function panelFor(tab) {
      if (tab === "policy") return await policyTab();
      if (tab === "catalogue") return catalogueTab();
      if (tab === "deploy") return deployTab();
      return complianceTab();
    }

    async function paint() {
      await compute();
      const deployActive = asArr(state.deployments).filter((d) => ["planned", "running"].indexOf(d.state) !== -1).length;
      const tabs = ui.tabs([
        { id: "compliance", label: "Compliance", badge: state.stats ? (num(state.stats.nonCompliant, 0) ? String(num(state.stats.nonCompliant, 0)) : null) : null },
        { id: "policy", label: "Patch policy", badge: String(asArr(state.policies).length) },
        { id: "deploy", label: "Deployment & audit", badge: deployActive ? String(deployActive) : null },
        { id: "catalogue", label: "Scan history & catalogue" },
      ], state.tab);
      const p = await load();
      const picker = asArr(opts.providers).length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pa_pid">' + asArr(opts.providers).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === opts.providerId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = '<div class="rmm-patch-inner">' + tabs.html + picker + "</div>";
      const panelEl = host.querySelector('.erp-tab-panel[data-panel="' + state.tab + '"]');
      if (panelEl) panelEl.innerHTML = '<div class="rmm-patch-body">' + (await panelFor(state.tab)) + "</div>";
    }

    /* policy editor */
    async function openPolicyEditor(id) {
      const provider = await load();
      const isNew = id === "__new";
      const pol = isNew ? PA.normalizePolicy({ name: "", priority: 150, osFamily: "all" }) : await PA.getPolicy(opts.providerId, id);
      if (!pol) return;
      const list = await PA.classifications();
      const classRow = (c) => {
        const cur = asObj(pol.classifications[c.id]);
        const d = cur.decision || "inherit";
        return '<tr><td>' + esc(c.label) + (c.categoryCode ? '<div class="erp-sub">' + esc(c.categoryCode) + "</div>" : "") + "</td>" +
          '<td><select name="cls_' + esc(c.id) + '_decision">' + PA.DECISIONS.map((x) => '<option value="' + x + '"' + (d === x ? " selected" : "") + ">" + esc(PA.DECISION_LABEL[x]) + "</option>").join("") + "</select></td>" +
          '<td><input type="number" min="0" name="cls_' + esc(c.id) + '_deferralDays" value="' + num(cur.deferralDays, c.deferralDays || 0) + '" style="width:70px"></td>' +
          '<td><input type="number" min="0" name="cls_' + esc(c.id) + '_deadlineDays" value="' + num(cur.deadlineDays, 0) + '" style="width:70px"></td>' +
          '<td><input type="checkbox" name="cls_' + esc(c.id) + '_requiresReboot"' + (cur.requiresReboot == null ? c.requiresReboot : cur.requiresReboot ? " checked" : "") + "></td></tr>";
      };
      const body = ui.form(
        ui.text("p_name", "Name", pol.name, "e.g. Servers — patch ring") +
        ui.text("p_description", "Description", pol.description, "what this policy does") +
        '<div class="rmm-patch-grid">' +
        ui.number("p_priority", "Priority", pol.priority, { min: 0, hint: "higher wins" }) +
        ui.select("p_os", "OS family", PA.OS_FAMILIES.map((f) => ({ value: f, label: f === "all" ? "Any OS" : f })), pol.osFamily) +
        ui.select("p_site", "Site", asArr(provider.sites).map((s) => ({ value: s.id, label: s.name || s.id })), pol.siteId || "", "Any site") +
        ui.select("p_rebootPolicy", "Reboot policy", PA.REBOOT_POLICIES.map((f) => ({ value: f, label: PA.REBOOT_LABEL[f] })), pol.rebootPolicy) +
        ui.number("p_rebootGraceMinutes", "Reboot grace (min)", pol.rebootGraceMinutes, { min: 0 }) +
        ui.number("p_missingGraceDays", "Missing-patch grace (days)", pol.missingGraceDays, { min: 0 }) +
        ui.text("p_installWindowId", "Install window id", pol.installWindowId, "maintenance window id") +
        ui.text("p_rebootWindowId", "Reboot window id", pol.rebootWindowId, "maintenance window id") +
        "</div>" +
        ui.check("p_enforceDeadline", "Enforce deadlines (flag overdue patches)", pol.enforceDeadline) +
        ui.check("p_enabled", "Enabled", pol.enabled) +
        ui.text("p_groupIds", "Target device-group ids", asArr(pol.targets.groupIds).join(", "), "comma-separated; blank = provider-wide") +
        ui.text("p_tags", "Target tags", asArr(pol.targets.tags).join(", "), "comma-separated") +
        ui.text("p_deviceIds", "Target device ids", asArr(pol.targets.deviceIds).join(", "), "comma-separated") +
        '<h4 class="rmm-section-head">Unclassified updates</h4><div class="rmm-patch-grid">' +
        ui.select("p_default_decision", "Decision", PA.DECISIONS.map((x) => ({ value: x, label: PA.DECISION_LABEL[x] })), pol.default.decision) +
        ui.number("p_default_deferralDays", "Defer (days)", pol.default.deferralDays, { min: 0 }) +
        ui.number("p_default_deadlineDays", "Deadline (days)", pol.default.deadlineDays, { min: 0 }) +
        ui.check("p_default_requiresReboot", "Requires reboot", pol.default.requiresReboot) +
        "</div>" +
        '<h4 class="rmm-section-head">Per-classification rules</h4>' +
        '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Classification</th><th>Decision</th><th>Defer</th><th>Deadline</th><th>Reboot</th></tr></thead><tbody>' +
        list.map(classRow).join("") + "</tbody></table></div>",
        ui.btn("Save", { primary: true, act: "pa-policy-save", arg: isNew ? "__new" : pol.id }) + " " + ui.btn("Cancel", { act: "pa-policy-cancel" })
      );
      const m = ui.modal({ title: (isNew ? "New patch policy" : "Edit " + pol.name), size: "lg", body });
      if (!m) return;
      m.addEventListener("click", async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        if (act === "pa-policy-cancel") return ui.closeModal();
        if (act === "pa-policy-save") {
          const collected = ui.collect(m, ["p_name", "p_description", "p_priority", "p_os", "p_site", "p_rebootPolicy", "p_rebootGraceMinutes", "p_missingGraceDays", "p_installWindowId", "p_rebootWindowId", "p_enforceDeadline", "p_enabled", "p_groupIds", "p_tags", "p_deviceIds", "p_default_decision", "p_default_deferralDays", "p_default_deadlineDays", "p_default_requiresReboot"]);
          const classifications = {};
          list.forEach((c) => {
            const decision = (m.querySelector('[name="cls_' + c.id + '_decision"]') || {}).value || "inherit";
            const deferralDays = Number((m.querySelector('[name="cls_' + c.id + '_deferralDays"]') || {}).value || 0);
            const deadlineDays = Number((m.querySelector('[name="cls_' + c.id + '_deadlineDays"]') || {}).value || 0);
            const requiresReboot = !!(m.querySelector('[name="cls_' + c.id + '_requiresReboot"]') || {}).checked;
            if (decision !== "inherit") classifications[c.id] = { decision, deferralDays, deadlineDays, requiresReboot };
          });
          const data = {
            name: collected.p_name, description: collected.p_description, priority: collected.p_priority,
            osFamily: collected.p_os, siteId: collected.p_site || null, rebootPolicy: collected.p_rebootPolicy,
            rebootGraceMinutes: collected.p_rebootGraceMinutes, missingGraceDays: collected.p_missingGraceDays,
            installWindowId: collected.p_installWindowId, rebootWindowId: collected.p_rebootWindowId,
            enforceDeadline: collected.p_enforceDeadline, enabled: collected.p_enabled,
            targets: { groupIds: splitCsv(collected.p_groupIds), tags: splitCsv(collected.p_tags), deviceIds: splitCsv(collected.p_deviceIds) },
            default: { decision: collected.p_default_decision, deferralDays: collected.p_default_deferralDays, deadlineDays: collected.p_default_deadlineDays, requiresReboot: collected.p_default_requiresReboot },
            classifications,
          };
          const r = isNew ? await PA.addPolicy(opts.providerId, data) : await PA.updatePolicy(opts.providerId, pol.id, data);
          if (r.error) return toast("Failed: " + (r.errors ? r.errors.join("; ") : r.error), "error");
          ui.closeModal();
          toast(isNew ? "Policy created" : "Policy saved");
          if (opts.onChange) opts.onChange(); else paint();
        }
      });
    }

    async function openDevice(deviceId) {
      const provider = await load();
      const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
      if (!dev) return;
      const scan = await PA.scanOf(deviceId);
      const eff = await PA.effectiveOf(provider, dev);
      const rows = asArr(scan && scan.missing).map((m) => ({
        title: "<b>" + esc(m.title) + "</b>" + (m.id ? '<div class="erp-sub">' + esc(m.id) + "</div>" : ""),
        cls: esc(m.classificationLabel || m.classification || "—"),
        decision: badge(PA.DECISION_LABEL[m.decision] || m.decision, PA.decisionTone(m.decision)),
        required: m.requiredNow ? badge("required", m.overdue ? "danger" : "warn") : badge("not yet", "muted"),
        install: esc(ui.dateTime(m.installAfter)), deadline: m.deadlineAt ? esc(ui.dateTime(m.deadlineAt)) : "none",
        age: num(m.ageDays, 0) + "d",
        reboot: m.requiresReboot ? "yes" : "no",
      }));
      const comp = scan ? scan.compliance : null;
      const body = '<div class="rmm-status-line">' + complianceBadge(comp ? (comp.compliant ? "compliant" : "non-compliant") : "unknown") +
        (comp && !comp.compliant ? " " + badge(num(comp.ageDays, 0) + "d non-compliant", "danger") : "") +
        (comp && comp.withinGrace ? " " + badge("within grace", "warn") : "") + "</div>" +
        '<p class="erp-sub">' + esc(dev.hostname) + " · " + esc(eff.osFamily || "") + " · policy " + esc(eff.policyName || "—") + "</p>" +
        '<div class="erp-btn-row">' + ui.btn("Rescan this device", { small: true, primary: true, act: "pa-scan-device-modal", arg: dev.id }) + "</div>" +
        '<h4 class="rmm-section-title">Missing patches (' + rows.length + ")</h4>" +
        ui.table([
          { key: "title", label: "Update", render: (r) => r.title },
          { key: "cls", label: "Classification", render: (r) => r.cls },
          { key: "decision", label: "Decision", render: (r) => r.decision },
          { key: "required", label: "Status", render: (r) => r.required },
          { key: "install", label: "Install after", render: (r) => r.install },
          { key: "deadline", label: "Deadline", render: (r) => r.deadline },
          { key: "age", label: "Age", render: (r) => r.age },
          { key: "reboot", label: "Reboot", render: (r) => r.reboot },
        ], rows, { scroll: true, emptyText: "No scan for this device yet." });
      const m = ui.modal({ title: "Patch compliance · " + dev.hostname, size: "lg", body });
      if (!m) return;
      m.addEventListener("click", async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        if (t.getAttribute("data-act") === "pa-scan-device-modal") {
          ui.closeModal();
          const r = await PA.scan(opts.providerId, { deviceId: dev.id });
          if (r.error) return toast("Scan failed: " + r.error, "error");
          toast("Scanned " + dev.hostname);
          if (opts.onChange) opts.onChange(); else paint();
        }
      });
    }

    async function runScan(ids, label) {
      const r = await PA.scan(opts.providerId, { deviceIds: ids });
      if (r.error) return toast("Scan failed: " + r.error, "error");
      const s = r.summary || {};
      toast("Scanned " + s.devices + " device(s) — " + num(s.nonCompliant, 0) + " non-compliant, " + num(s.missingRequired, 0) + " missing required");
      if (opts.onChange) opts.onChange(); else paint();
    }

    ui.bind(host, "change", "[name='pa_by']", (t) => { state.rollupBy = t.value; paint(); });
    ui.bind(host, "change", "[name='pa_status']", (t) => { state.status = t.value; paint(); });
    ui.bind(host, "change", "[name='pa_preview']", (t) => { state.previewDevice = t.value; paint(); });
    ui.bind(host, "change", "[name='pa_pid']", (t) => { opts.providerId = t.value; if (opts.onProvider) opts.onProvider(t.value); paint(); });
    host.addEventListener("input", (e) => { if (e.target && e.target.name === "pa_q") state.q = e.target.value; });
    host.addEventListener("keyup", (e) => { if (e.target && e.target.name === "pa_q" && e.key === "Enter") paint(); });
    ui.bind(host, "click", "[data-tab]", (t) => { const id = t.getAttribute("data-tab"); if (["compliance", "policy", "deploy", "catalogue"].indexOf(id) !== -1) { state.tab = id; paint(); } });
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      e.preventDefault();
      if (act === "pa-scan-all") return runScan(null, "all");
      if (act === "pa-scan-device") return runScan([arg]);
      if (act === "pa-device") return openDevice(arg);
      if (act === "pa-policy-new") return openPolicyEditor("__new");
      if (act === "pa-policy-edit") return openPolicyEditor(arg);
      if (act === "pa-policy-dup") { const r = await PA.duplicatePolicy(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Duplicated"); return paint(); }
      if (act === "pa-policy-toggle") { const pol = await PA.getPolicy(opts.providerId, arg); const r = await PA.setEnabled(opts.providerId, arg, !(pol && pol.enabled)); if (r.error) return toast("Failed: " + r.error, "error"); toast("Updated"); return paint(); }
      if (act === "pa-policy-del") {
        const ok = await ERP.ui.confirm({ title: "Delete patch policy?", message: "This cannot be undone.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await PA.removePolicy(opts.providerId, arg);
        if (r.error) return toast("Failed: " + r.error, "error");
        toast("Deleted"); return paint();
      }
      if (act === "pa-deploy-run") {
        const plan = asObj(state.plan), totals = asObj(plan.totals);
        const ready = num(totals.devices, 0), patches = num(totals.patches, 0);
        if (!ready) return toast("No approved patches are ready to deploy", "error");
        const ok = await ERP.ui.confirm({ title: "Deploy patches?", message: "Deploy " + patches + " approved patch(es) to " + ready + " device(s)? Agents install them on their next check-in.", okLabel: "Deploy", primary: true });
        if (!ok) return;
        const r = await PA.deploy(opts.providerId);
        if (r.error) return toast("Failed: " + (r.message || r.error), "error");
        const sm = asObj(r.deployment.summary);
        toast("Deployment started — " + num(sm.patches, 0) + " patch(es) across " + num(sm.devices, 0) + " device(s)");
        return paint();
      }
      if (act === "pa-deploy-reconcile") {
        const r = await PA.reconcileDeployment(opts.providerId, arg, { force: true });
        if (r.error) return toast("Failed: " + r.error, "error");
        toast(r.changed ? ("Reconciled" + (asArr(r.retried).length ? " — " + asArr(r.retried).length + " retry job(s) queued" : "")) : "Nothing to reconcile yet");
        return paint();
      }
      if (act === "pa-deploy-view") return openDeployment(arg);
      if (act === "pa-reboot-now") { const r = await PA.performReboot(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Reboot dispatched"); return paint(); }
      if (act === "pa-reboot-done") { const r = await PA.completeReboot(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Reboot marked done"); return paint(); }
      if (act === "pa-reboot-skip") { const r = await PA.skipReboot(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Reboot skipped"); return paint(); }
      if (act === "pa-report-gen") {
        const r = await PA.complianceReport(opts.providerId);
        if (r.error) return toast("Failed: " + r.error, "error");
        state.report = r; toast("Report generated"); return paint();
      }
      if (act === "pa-report-export") {
        const r = state.report || await PA.complianceReport(opts.providerId);
        if (r.error) return toast("Failed: " + r.error, "error");
        state.report = r;
        const fname = "patch-compliance-" + String(r.providerName || r.providerId || "client").replace(/[^A-Za-z0-9_-]/g, "-") + "-" + String(now()).slice(0, 10) + ".json";
        const ok = PA.download(fname, PA.exportReport(r));
        toast(ok ? "Report exported" : "Export failed", ok ? undefined : "error");
        return paint();
      }
    });

    await paint();
    PA.currentProviderId = opts.providerId;
    return state;
  };

  function splitCsv(v) { return String(v == null ? "" : v).split(",").map((s) => s.trim()).filter(Boolean); }
  PA.splitCsv = splitCsv;

  PA.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-patch";
    host.appendChild(wrap);
    if (!providers.length) { wrap.innerHTML = ERP.ui.alert("No service providers yet.", "info"); return null; }
    const providerId = opts.providerId || providers[0].id;
    if (!opts.headHtml && !opts.embedded) wrap.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Patches", "Patch policy per OS and classification, agent-driven scanning, per-device compliance and the aging of missing patches."));
    return PA.renderPanel(wrap, { providerId, providers, embedded: true, toast: opts.toast || (() => {}), onChange: opts.onChange, onProvider: opts.onProvider });
  };

  PA.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const pid = (PA.currentProviderId && providers.some((p) => p.id === PA.currentProviderId)) ? PA.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-patch";
    el.innerHTML = "";
    el.appendChild(root);
    root.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Patches", "Patch policy per OS and classification, agent-driven scanning, per-device compliance and the aging of missing patches.", ERP.ui.btn("Scan all now", { primary: true, act: "pa-scan-all" })));
    await PA.renderPanel(root, { providerId: pid, providers, embedded: true, toast: ctx.toast, onChange: () => PA.render(ctx) });
    return { pid };
  };

  /* Standalone mount used by the validation suite. */
  PA.renderPanelInto = PA.renderPanel;

  let readyResolve;
  PA.ready = new Promise((res) => { readyResolve = res; });
  PA.init = async function () { try { await T.ready; await PA.seedDemo(); } catch (e) { console.error("patch seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", PA.init);
  else PA.init();
})();
