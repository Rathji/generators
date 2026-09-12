/* ============================================================
   RMM-U — software catalog, deployment & licensing  (Phase 7 · Tasks 31–33)

   Three questions, one engine:

     • Task 31 — WHAT can we deploy? A **software package** is a
       deployable title with, per OS, the silent install / uninstall /
       update / rollback command templates, a source location and a
       checksum, typed **parameters** that are validated before they
       are ever interpolated into a command, and **detection rules**
       that decide — from the device's own software inventory — whether
       the title is already present and at which version, so an
       already-installed device is skipped instead of reinstalled.

     • Task 32 — WHO should get it, and did they? A package is
       **assigned** to devices, groups, sites or tags, then planned:
       each target is detected, an action is resolved (install, update,
       reinstall, uninstall, rollback, downgrade), and the resulting
       agent jobs report installed / not-installed / pending / failed
       per device. Retries, before/after detection and a per-device
       audit trail make every deployment action traceable.

     • Task 33 — ARE we allowed to run it? **Licences** reconcile the
       installed base against owned seats per client: utilisation,
       over-deployment, expiry and unsanctioned (uncatalogued) software,
       with an exportable inventory/licence report.

   The engine is `window.ERP.software` (`SW`, this file). Packages,
   deployments and licences live on the provider aggregate
   (`provider.softwareState`); detection reads the hidden inventory
   (`INV.snapshot` → `sections.software`) and falls back to the most
   recent successful deployment for the window between an install and
   the next inventory collection. Nothing here is simulated.

   Command templates use `{{placeholders}}`:
     {{source}} {{installerPath}} {{tempDir}} {{version}} {{targetVersion}}
     {{previousVersion}} {{name}} {{vendor}} {{arguments}} {{installType}}
     {{params.<name>}}  (or just {{<name>}} for a declared parameter)
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
  const SW = (ERP.software = {});

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
  const MIN = 60000, DAY = 86400000;

  const enabled = () => cfg("rmm.softwareEnabled", true) !== false;
  const deployEnabled = () => cfg("rmm.softwareDeployEnabled", true) !== false;
  const detectEnabled = () => cfg("rmm.softwareDetectEnabled", true) !== false;
  const licenseEnabled = () => cfg("rmm.softwareLicenseEnabled", true) !== false;

  SW.ACTIONS = ["auto", "install", "update", "reinstall", "uninstall", "rollback", "downgrade"];
  SW.ACTION_LABEL = { auto: "Automatic", install: "Install", update: "Update", reinstall: "Reinstall", uninstall: "Uninstall", rollback: "Rollback", downgrade: "Downgrade" };
  SW.ENFORCEMENT = ["skip-installed", "enforce"];
  SW.PACKAGE_STATES = ["pending", "installed", "uninstalled", "failed", "skipped"];
  SW.DEPLOY_STATES = ["planned", "running", "succeeded", "partial", "failed", "cancelled"];
  SW.OS_KEYS = ["windows", "linux", "macos"];
  SW.OS_LABEL = { windows: "Windows", linux: "Linux", macos: "macOS" };
  SW.INSTALL_TYPES = ["msi", "exe", "msix", "pkg", "dmg", "deb", "rpm", "script", "zip", "store", "other"];
  SW.DETECT_FIELDS = ["name", "publisher", "version", "installLocation"];
  SW.DETECT_FIELD_LABEL = { name: "Title", publisher: "Publisher", version: "Version", installLocation: "Install location" };
  SW.DETECT_OPS = ["contains", "eq", "starts", "ends", "regex", "gte", "lte", "gt", "lt", "present", "absent"];
  SW.DETECT_OP_LABEL = { contains: "contains", eq: "is exactly", starts: "starts with", ends: "ends with", regex: "matches regex", gte: "≥", lte: "≤", gt: ">", lt: "<", present: "is present", absent: "is absent" };
  SW.PARAM_TYPES = ["text", "number", "bool", "select", "password"];
  SW.RESULT_LINE = "SWSRESULT";
  SW.DETECT_LINE = "SWDETECT";
  SW.DEPLOY_SOURCE = "software-deploy";
  SW.CHECKSUM_ALGOS = ["sha256", "sha1", "md5"];

  SW.sourceTone = (s) => (s === "inventory" ? "success" : s === "deployment" ? "info" : "muted");
  SW.actionTone = (a) => (a === "uninstall" ? "danger" : a === "rollback" || a === "downgrade" ? "warn" : "info");
  SW.stateTone = (s) => (s === "installed" || s === "succeeded" ? "success" : s === "uninstalled" ? "muted" : s === "failed" ? "danger" : s === "partial" ? "warn" : "info");
  SW.licenseTone = (s) => (s === "expired" || s === "over" ? "danger" : s === "expiring" || s === "unused" ? "warn" : "success");

  /* ═══════════════════════ OS family ═══════════════════════ */

  function famKey(dev) {
    const J = ERP.jobs;
    const f = low(J && J.familyOf ? J.familyOf(dev) : asObj(asObj(dev).os).family);
    if (f === "macos") return "macos";
    if (f === "linux") return "linux";
    return "windows";
  }
  function famLabel(k) { return SW.OS_LABEL[k] || "Windows"; }
  function langFor(k) { return k === "windows" ? "powershell" : "bash"; }
  SW.familyOf = famKey;
  SW.familyLabel = famLabel;

  /* ═══════════════════════ version comparison ═══════════════════════ */

  function seg(v) { return String(v == null ? "" : v).split(/[.\-+_ ]/).filter((s) => s !== ""); }
  SW.compareVersions = function (a, b) {
    const pa = seg(a), pb = seg(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const x = pa[i] == null ? "0" : pa[i], y = pb[i] == null ? "0" : pb[i];
      const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) { const d = Number(x) - Number(y); if (d) return d < 0 ? -1 : 1; }
      else { const c = String(x).localeCompare(String(y)); if (c) return c < 0 ? -1 : 1; }
    }
    return 0;
  };
  SW.versionState = function (fromV, toV) {
    if (!fromV || !toV) return "unknown";
    const c = SW.compareVersions(fromV, toV);
    return c === 0 ? "same" : c < 0 ? "older" : "newer";
  };

  /* ═══════════════════════ normalisation ═══════════════════════ */

  const pick = (v, list, fallback) => (list.indexOf(v) !== -1 ? v : fallback);

  function normParameter(p) {
    p = asObj(p);
    const type = pick(low(p.type), SW.PARAM_TYPES, "text");
    return {
      name: S(p.name, 60).replace(/[^A-Za-z0-9_]/g, ""),
      label: S(p.label, 120),
      type, required: !!p.required,
      default: p.default == null ? "" : S(p.default, 400),
      options: asArr(p.options).map((o) => S(o, 120)).filter(Boolean),
      description: S(p.description, 300),
      sensitive: type === "password" || !!p.sensitive,
    };
  }
  SW.normalizeParameter = normParameter;

  function normRule(r) {
    r = asObj(r);
    const op = pick(low(r.op), SW.DETECT_OPS, "contains");
    return { field: pick(low(r.field), SW.DETECT_FIELDS, "name"), op, value: S(r.value, 200) };
  }
  function normDetection(d) {
    d = asObj(d);
    return {
      match: pick(low(d.match), ["all", "any"], "all"),
      rules: asArr(d.rules).map(normRule).filter((r) => r.value !== "" || r.op === "present" || r.op === "absent"),
    };
  }
  SW.normalizeDetection = normDetection;

  function normVariant(v, family) {
    v = asObj(v);
    return {
      os: family,
      language: pick(low(v.language), ["powershell", "cmd", "bash", "sh"], ""),
      installType: pick(low(v.installType), SW.INSTALL_TYPES, ""),
      source: S(v.source, 400),
      checksum: S(v.checksum, 200),
      checksumAlgo: pick(low(v.checksumAlgo), SW.CHECKSUM_ALGOS, "sha256"),
      arguments: S(v.arguments, 400),
      install: S(v.install, 4000),
      uninstall: S(v.uninstall, 4000),
      update: S(v.update, 4000),
      rollback: S(v.rollback, 4000),
      requiresReboot: v.requiresReboot == null ? null : !!v.requiresReboot,
      detectCommand: S(v.detectCommand, 4000),
      detection: normDetection(v.detection),
    };
  }

  function normAssignment(a) {
    a = asObj(a);
    const t = asObj(a.targets);
    return {
      id: a.id || rid("swasg"),
      targets: {
        all: !!t.all, deviceIds: asArr(t.deviceIds).map(String), groupIds: asArr(t.groupIds).map(String),
        siteIds: asArr(t.siteIds).map(String), tags: asArr(t.tags).map(String),
      },
      action: pick(low(a.action), SW.ACTIONS, "install"),
      targetVersion: S(a.targetVersion, 60),
      enforcement: pick(low(a.enforcement), SW.ENFORCEMENT, "skip-installed"),
      enabled: a.enabled !== false,
      note: S(a.note, 300),
      createdAt: S(a.createdAt, 40),
    };
  }
  SW.normalizeAssignment = normAssignment;

  SW.normalizePackage = function (p) {
    p = asObj(p);
    const variants = {};
    SW.OS_KEYS.forEach((k) => { const v = asObj(p.variants)[k]; if (v && Object.keys(v).length) variants[k] = normVariant(v, k); });
    return {
      id: p.id || rid("swpkg"), kind: "swpackage",
      name: S(p.name, 160) || "Untitled package",
      vendor: S(p.vendor, 160),
      categoryId: S(p.categoryId, 60),
      description: S(p.description, 600),
      version: S(p.version, 60),
      previousVersion: S(p.previousVersion, 60),
      installType: pick(low(p.installType), SW.INSTALL_TYPES, ""),
      source: S(p.source, 400),
      checksum: S(p.checksum, 200),
      checksumAlgo: pick(low(p.checksumAlgo), SW.CHECKSUM_ALGOS, "sha256"),
      arguments: S(p.arguments, 400),
      installTemplate: S(p.installTemplate, 4000),
      uninstallTemplate: S(p.uninstallTemplate, 4000),
      updateTemplate: S(p.updateTemplate, 4000),
      rollbackTemplate: S(p.rollbackTemplate, 4000),
      variants,
      detection: normDetection(p.detection),
      parameters: asArr(p.parameters).map(normParameter).filter((x) => x.name),
      supportsDowngrade: !!p.supportsDowngrade,
      supportsRollback: !!p.supportsRollback,
      requiresReboot: !!p.requiresReboot,
      enabled: p.enabled !== false,
      tags: asArr(p.tags).map((t) => S(t, 40)).filter(Boolean),
      assignments: asArr(p.assignments).map(normAssignment),
      createdAt: S(p.createdAt, 40), updatedAt: S(p.updatedAt, 40),
    };
  };

  SW.normalizeLicense = function (l) {
    l = asObj(l);
    return {
      id: l.id || rid("swlic"), kind: "swlicense",
      title: S(l.title, 160) || "Untitled licence",
      vendor: S(l.vendor, 160),
      packageId: S(l.packageId, 60),
      metric: pick(low(l.metric), ["per-device", "per-user", "subscription", "site"], "per-device"),
      seats: Math.max(0, num(l.seats, 0)),
      seatsUsed: l.seatsUsed == null ? null : Math.max(0, num(l.seatsUsed, 0)),
      expiresAt: S(l.expiresAt, 40),
      purchasedAt: S(l.purchasedAt, 40),
      unitCost: num(l.unitCost, 0),
      currency: S(l.currency, 8) || "USD",
      siteId: S(l.siteId, 60),
      notes: S(l.notes, 400),
      enabled: l.enabled !== false,
      createdAt: S(l.createdAt, 40), updatedAt: S(l.updatedAt, 40),
    };
  };

  SW.validatePackage = function (pkg) {
    const p = SW.normalizePackage(pkg);
    const errors = [];
    if (!p.name || low(p.name) === "untitled package") errors.push("A name is required.");
    const hasCommand = SW.OS_KEYS.some((k) => { const v = p.variants[k]; return v && (v.install || v.uninstall); }) || p.installTemplate || p.uninstallTemplate;
    if (!hasCommand) errors.push("At least one OS variant must define an install or uninstall command.");
    p.parameters.forEach((pr) => { if (!pr.name) errors.push("A parameter has no name."); if (pr.type === "select" && !asArr(pr.options).length) errors.push("Select parameter \"" + pr.name + "\" has no options."); });
    return { valid: errors.length === 0, errors, package: p };
  };

  /* ═══════════════════════ command templates ═══════════════════════ */

  SW.renderTemplate = function (tpl, ctx) {
    const missing = [];
    ctx = ctx || {};
    const params = asObj(ctx.params);
    const text = String(tpl == null ? "" : tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
      const k = key.indexOf("params.") === 0 ? key.slice(7) : key;
      if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null && params[k] !== "") return String(params[k]);
      if (Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] != null && ctx[key] !== "") return String(ctx[key]);
      if (Object.prototype.hasOwnProperty.call(ctx, k) && ctx[k] != null && ctx[k] !== "") return String(ctx[k]);
      missing.push(key);
      return "";
    });
    return { text, missing };
  };

  /* Validate caller-supplied parameter values against the package
     declaration BEFORE they reach a command. Required values must be
     present, numbers must parse, selects must be in range, and any
     undeclared key is rejected outright. */
  SW.validateParameters = function (pkg, raw) {
    raw = asObj(raw);
    const defs = asArr(asObj(pkg).parameters).map(normParameter).filter((d) => d.name);
    const errors = [];
    const out = {};
    const known = {};
    defs.forEach((d) => {
      known[d.name] = d;
      let v = Object.prototype.hasOwnProperty.call(raw, d.name) ? raw[d.name] : d.default;
      if (d.type === "bool") v = v === true || v === "true" || v === "1" || v === 1;
      if (d.required && (v == null || v === "")) { errors.push("Parameter \"" + (d.label || d.name) + "\" is required."); return; }
      if (v == null || v === "") { out[d.name] = ""; return; }
      if (d.type === "number") { const n = Number(v); if (!isFinite(n)) { errors.push("Parameter \"" + (d.label || d.name) + "\" must be a number."); return; } out[d.name] = n; return; }
      if (d.type === "select") { const s = String(v); if (asArr(d.options).indexOf(s) === -1) { errors.push("Parameter \"" + (d.label || d.name) + "\" must be one of: " + asArr(d.options).join(", ") + "."); return; } out[d.name] = s; return; }
      out[d.name] = String(v).slice(0, 400);
    });
    Object.keys(raw).forEach((k) => {
      if (k === "__targetVersion" || k === "__packageId") return;
      if (!known[k]) errors.push("Unknown parameter \"" + k + "\".");
    });
    return { valid: errors.length === 0, errors, params: out };
  };

  /* The resolved per-OS variant for a package. Variant values win over
     package-level defaults. */
  SW.variantFor = function (pkg, family) {
    const p = asObj(pkg);
    const v = asObj(asObj(p.variants)[family]);
    return {
      os: family,
      language: v.language || langFor(family),
      installType: v.installType || p.installType || "",
      source: v.source || p.source || "",
      checksum: v.checksum || p.checksum || "",
      checksumAlgo: v.checksumAlgo || p.checksumAlgo || "sha256",
      arguments: v.arguments || p.arguments || "",
      install: v.install || p.installTemplate || "",
      uninstall: v.uninstall || p.uninstallTemplate || "",
      update: v.update || p.updateTemplate || "",
      rollback: v.rollback || p.rollbackTemplate || "",
      requiresReboot: v.requiresReboot == null ? !!p.requiresReboot : !!v.requiresReboot,
      detectCommand: v.detectCommand || "",
      detection: SW.effectiveDetection(p, v),
    };
  };

  SW.supportsOs = function (pkg, family) {
    const p = asObj(pkg);
    const v = asObj(asObj(p.variants)[family]);
    return !!(v.install || v.uninstall || p.installTemplate || p.uninstallTemplate);
  };

  function templateFor(v, action) {
    if (action === "uninstall") return v.uninstall || "";
    if (action === "rollback") return v.rollback || v.update || v.install || "";
    if (action === "update" || action === "downgrade") return v.update || v.install || "";
    return v.install || "";
  }
  SW.templateFor = templateFor;

  SW.commandFor = function (pkg, family, action, params) {
    const v = SW.variantFor(pkg, family);
    const tpl = templateFor(v, action);
    const ctx = {
      name: asObj(pkg).name, vendor: asObj(pkg).vendor, version: asObj(pkg).version,
      targetVersion: asObj(params).__targetVersion || asObj(pkg).version,
      previousVersion: asObj(pkg).previousVersion,
      source: v.source, checksum: v.checksum, checksumAlgo: v.checksumAlgo,
      arguments: v.arguments, installType: v.installType,
      installerPath: family === "windows" ? "$rmmTarget" : "$RMM_TARGET",
      tempDir: family === "windows" ? "$rmmTmp" : "$RMM_TMP",
      params: asObj(params),
    };
    const r = SW.renderTemplate(tpl, ctx);
    return {
      language: v.language, script: r.text, template: tpl, missing: r.missing,
      requiresReboot: v.requiresReboot, source: v.source, checksum: v.checksum,
      checksumAlgo: v.checksumAlgo, detectCommand: v.detectCommand, installType: v.installType,
    };
  };

  /* ═══════════════════════ detection ═══════════════════════ */

  SW.effectiveDetection = function (pkg, variant) {
    const vd = asObj(asObj(variant).detection);
    if (asArr(vd.rules).length) return vd;
    const pd = asObj(asObj(pkg).detection);
    if (asArr(pd.rules).length) return pd;
    return { match: "all", rules: [{ field: "name", op: "contains", value: S(asObj(pkg).name, 120) }] };
  };

  function ruleMatches(item, r) {
    const v = String(asObj(item)[r.field] == null ? "" : asObj(item)[r.field]);
    const val = String(r.value == null ? "" : r.value);
    switch (r.op) {
      case "eq": return low(v) === low(val);
      case "contains": return val === "" || low(v).indexOf(low(val)) !== -1;
      case "starts": return low(v).indexOf(low(val)) === 0;
      case "ends": return low(val).length <= low(v).length && low(v).slice(-low(val).length) === low(val);
      case "regex": try { return new RegExp(val, "i").test(v); } catch (e) { return false; }
      case "gte": return SW.compareVersions(v, val) >= 0;
      case "lte": return SW.compareVersions(v, val) <= 0;
      case "gt": return SW.compareVersions(v, val) > 0;
      case "lt": return SW.compareVersions(v, val) < 0;
      case "present": return !!v;
      case "absent": return !v;
      default: return false;
    }
  }
  SW.ruleMatches = ruleMatches;

  SW.matchItem = function (det, item) {
    const rules = asArr(asObj(det).rules);
    if (!rules.length) return true;
    return asObj(det).match === "any" ? rules.some((r) => ruleMatches(item, r)) : rules.every((r) => ruleMatches(item, r));
  };

  /* Find the best-matching installed title for a package in a device's
     software list (highest version wins). */
  SW.findInstalled = function (pkg, software, variant) {
    const det = SW.effectiveDetection(pkg, variant);
    let best = null;
    asArr(software).forEach((it) => {
      if (!SW.matchItem(det, it)) return;
      if (!best || SW.compareVersions(it.version || "", best.version || "") > 0) best = it;
    });
    return best;
  };

  SW.detectIn = function (pkg, software, family) {
    if (!detectEnabled()) return { installed: false, version: "", item: null, source: "disabled", at: "" };
    const variant = SW.variantFor(pkg, family);
    const hit = SW.findInstalled(pkg, software, variant);
    if (hit) return { installed: true, version: hit.version || "", item: hit, source: "inventory", at: "" };
    return { installed: false, version: "", item: null, source: software ? "inventory" : "none", at: "" };
  };

  async function latestDeploymentFor(provider, deviceId, packageId) {
    let best = null;
    asArr(asObj(asObj(provider).softwareState).deployments).forEach((dep) => {
      const t = asObj(asObj(dep.targets)[deviceId]);
      if (!t) return;
      const p = asArr(t.packages).find((x) => String(x.packageId) === String(packageId));
      if (!p) return;
      const at = msOf(p.completedAt || t.updatedAt || dep.at) || 0;
      if (!best || at > best.at) best = { at, state: p.state, action: p.action, version: p.toVersion || p.version || "", target: t };
    });
    return best;
  }

  /* Detection for a device: inventory first, then the most recent
     successful deployment younger than the inventory snapshot (so a
     freshly installed/uninstalled package is reflected before the next
     collection lands). */
  SW.detectForDevice = async function (providerId, dev, pkg, opts) {
    opts = opts || {};
    const provider = opts.provider || (await T.get(providerId)).provider || {};
    const fam = famKey(dev);
    const inv = opts.snapshot !== undefined ? opts.snapshot : (INV && INV.snapshot ? await INV.snapshot(asObj(dev).id) : null);
    const software = asArr(asObj(asObj(inv).sections).software);
    const det = SW.detectIn(pkg, software, fam);
    det.at = asObj(inv).at || "";
    const overlay = opts.overlay === false ? null : await latestDeploymentFor(provider, asObj(dev).id, asObj(pkg).id);
    if (det.installed) { det.overlay = overlay; return det; }
    const invAt = msOf(asObj(inv).at) || 0;
    if (overlay && overlay.at > invAt) {
      if (overlay.state === "installed") return { installed: true, version: overlay.version || "", item: null, source: "deployment", at: iso(overlay.at), overlay };
      if (overlay.state === "uninstalled") return { installed: false, version: "", item: null, source: "deployment", at: iso(overlay.at), overlay };
    }
    det.overlay = overlay;
    return det;
  };

  /* ═══════════════════════ catalog CRUD ═══════════════════════ */

  async function providerOf(providerId) { const g = await T.get(providerId); return g.error ? null : g.provider; }
  SW.providerOf = providerOf;

  SW.listPackages = async function (providerId, opts) {
    opts = opts || {};
    const provider = await providerOf(providerId);
    if (!provider) return [];
    let list = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage);
    if (opts.q) { const q = low(opts.q); list = list.filter((p) => [p.name, p.vendor, p.description, asArr(p.tags).join(" ")].some((x) => low(x).indexOf(q) !== -1)); }
    if (opts.categoryId) list = list.filter((p) => p.categoryId === opts.categoryId);
    return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  };
  SW.allPackages = SW.listPackages;
  SW.getPackage = async function (providerId, id) {
    const list = await SW.listPackages(providerId);
    return list.find((p) => String(p.id) === String(id)) || null;
  };

  async function saveCatalog(providerId, fn) {
    let found = null;
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      p.softwareState.catalog = asArr(p.softwareState.catalog);
      found = fn(p.softwareState.catalog) || null;
      p.updatedAt = now();
    });
    if (r.error) return r;
    return { ok: true, found };
  }

  SW.addPackage = async function (providerId, data) {
    data = asObj(data);
    if (!enabled() && !data.force) return { error: "software_disabled" };
    const v = SW.validatePackage(Object.assign({}, data, { id: data.id || rid("swpkg"), createdAt: now(), updatedAt: now() }));
    if (!v.valid) return { error: "invalid", errors: v.errors };
    const r = await saveCatalog(providerId, (list) => { list.push(clone(v.package)); return clone(v.package); });
    if (r.error) return r;
    await audit("software_package_add", v.package.id, "Added software package \"" + v.package.name + "\".");
    return { package: r.found };
  };

  SW.updatePackage = async function (providerId, id, patch) {
    let out = null;
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      const list = asArr(p.softwareState.catalog);
      const i = list.findIndex((x) => String(x.id) === String(id));
      if (i === -1) return;
      const merged = SW.normalizePackage(Object.assign({}, list[i], asObj(patch), { id: list[i].id, createdAt: list[i].createdAt || now(), updatedAt: now() }));
      const v = SW.validatePackage(merged);
      if (!v.valid) { out = { error: "invalid", errors: v.errors }; return; }
      list[i] = merged; p.softwareState.catalog = list; out = clone(merged);
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", id };
    if (out.error) return out;
    await audit("software_package_update", id, "Updated software package \"" + out.name + "\".");
    return { package: out };
  };

  SW.removePackage = async function (providerId, id) {
    let removed = null;
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      const list = asArr(p.softwareState.catalog);
      removed = list.find((x) => String(x.id) === String(id)) || null;
      p.softwareState.catalog = list.filter((x) => String(x.id) !== String(id));
    });
    if (r.error) return r;
    if (!removed) return { error: "not_found", id };
    await audit("software_package_remove", id, "Removed software package \"" + (removed.name || id) + "\".");
    return { removed: String(id) };
  };

  SW.duplicatePackage = async function (providerId, id) {
    const pkg = await SW.getPackage(providerId, id);
    if (!pkg) return { error: "not_found", id };
    return SW.addPackage(providerId, Object.assign({}, pkg, { id: rid("swpkg"), name: (pkg.name || "Package") + " (copy)", assignments: [] }));
  };

  SW.setPackageEnabled = async function (providerId, id, on) {
    const r = await SW.updatePackage(providerId, id, { enabled: on !== false });
    if (r.error) return r;
    return { ok: true, package: r.package };
  };

  /* ═══════════════════════ assignments ═══════════════════════ */

  SW.listAssignments = async function (providerId) {
    const packages = await SW.listPackages(providerId);
    const out = [];
    packages.forEach((p) => asArr(p.assignments).forEach((a) => out.push(Object.assign({}, a, { packageId: p.id, packageName: p.name }))));
    return out;
  };

  SW.assignPackage = async function (providerId, packageId, assignment) {
    const pkg = await SW.getPackage(providerId, packageId);
    if (!pkg) return { error: "not_found", packageId };
    const a = normAssignment(Object.assign({}, assignment, { id: rid("swasg"), createdAt: now() }));
    pkg.assignments = asArr(pkg.assignments).concat([a]);
    const r = await SW.updatePackage(providerId, packageId, { assignments: pkg.assignments });
    if (r.error) return r;
    await audit("software_assign", packageId, "Assigned \"" + pkg.name + "\" to " + describeTargets(a.targets) + ".");
    return { ok: true, package: r.package, assignment: a };
  };

  SW.updateAssignment = async function (providerId, packageId, assignmentId, patch) {
    const pkg = await SW.getPackage(providerId, packageId);
    if (!pkg) return { error: "not_found", packageId };
    const list = asArr(pkg.assignments).map((a) => (String(a.id) === String(assignmentId) ? normAssignment(Object.assign({}, a, asObj(patch), { id: a.id })) : normAssignment(a)));
    const r = await SW.updatePackage(providerId, packageId, { assignments: list });
    if (r.error) return r;
    await audit("software_assign_update", packageId, "Updated assignment for \"" + pkg.name + "\".");
    return { ok: true, package: r.package };
  };

  SW.removeAssignment = async function (providerId, packageId, assignmentId) {
    const pkg = await SW.getPackage(providerId, packageId);
    if (!pkg) return { error: "not_found", packageId };
    const list = asArr(pkg.assignments).filter((a) => String(a.id) !== String(assignmentId));
    const r = await SW.updatePackage(providerId, packageId, { assignments: list });
    if (r.error) return r;
    await audit("software_unassign", packageId, "Removed an assignment for \"" + pkg.name + "\".");
    return { ok: true, package: r.package };
  };

  function describeTargets(t) {
    t = asObj(t);
    const parts = [];
    if (t.all) parts.push("every device");
    if (asArr(t.groupIds).length) parts.push(asArr(t.groupIds).length + " group(s)");
    if (asArr(t.siteIds).length) parts.push(asArr(t.siteIds).length + " site(s)");
    if (asArr(t.tags).length) parts.push("tags: " + asArr(t.tags).join(", "));
    if (asArr(t.deviceIds).length) parts.push(asArr(t.deviceIds).length + " device(s)");
    return parts.length ? parts.join(" · ") : "no targets";
  }
  SW.describeTargets = describeTargets;

  function inScope(provider, dev, targets, ctx) {
    const t = asObj(targets);
    if (t.all) return true;
    if (asArr(t.deviceIds).length && asArr(t.deviceIds).map(String).indexOf(String(dev.id)) !== -1) return true;
    if (asArr(t.siteIds).length && asArr(t.siteIds).map(String).indexOf(String(asObj(dev).siteId)) !== -1) return true;
    if (asArr(t.tags).length && asArr(asObj(dev).tags).some((x) => asArr(t.tags).map(low).indexOf(low(x)) !== -1)) return true;
    if (asArr(t.groupIds).length) {
      if (G && typeof G.matchTargets === "function") { if (G.matchTargets(provider, { groupIds: t.groupIds }, dev, ctx || { provider }).match) return true; }
      else if (asArr(asObj(dev).groupIds).some((g) => asArr(t.groupIds).map(String).indexOf(String(g)) !== -1)) return true;
    }
    return false;
  }
  SW.inScope = inScope;

  /* ═══════════════════════ action resolution ═══════════════════════ */

  SW.resolveAction = function (pkg, det, opts) {
    opts = opts || {};
    const req = pick(low(opts.action), SW.ACTIONS, "auto");
    const target = opts.targetVersion || asObj(pkg).version || "";
    const installed = !!asObj(det).installed;
    const from = asObj(det).version || "";
    if (req === "uninstall") return installed ? { action: "uninstall", state: "run", fromVersion: from } : { action: "uninstall", state: "skip", reason: "not installed" };
    if (req === "rollback") {
      if (!asObj(pkg).supportsRollback) return { action: "rollback", state: "blocked", reason: "package does not define rollback" };
      if (!installed) return { action: "rollback", state: "blocked", reason: "not installed" };
      const to = asObj(pkg).previousVersion;
      if (!to) return { action: "rollback", state: "blocked", reason: "no previous version defined" };
      return { action: "rollback", state: "run", fromVersion: from, toVersion: to };
    }
    if (req === "downgrade") {
      if (!asObj(pkg).supportsDowngrade) return { action: "downgrade", state: "blocked", reason: "package does not define downgrade" };
      if (!installed) return { action: "downgrade", state: "blocked", reason: "not installed" };
      if (!target) return { action: "downgrade", state: "blocked", reason: "no target version" };
      if (SW.compareVersions(from, target) <= 0) return { action: "downgrade", state: "skip", reason: "not newer than target " + target };
      return { action: "downgrade", state: "run", fromVersion: from, toVersion: target };
    }
    if (req === "reinstall") return installed ? { action: "reinstall", state: "run", fromVersion: from, toVersion: target || from } : { action: "install", state: "run", toVersion: target };
    if (!installed) {
      if (req === "update") return { action: "update", state: "skip", reason: "not installed" };
      return { action: "install", state: "run", toVersion: target };
    }
    if (!target) {
      if (opts.enforcement === "enforce") return { action: "reinstall", state: "run", fromVersion: from, toVersion: from };
      return { action: "install", state: "skip", reason: "already installed" };
    }
    const cmp = SW.compareVersions(from, target);
    if (cmp === 0) {
      if (opts.enforcement === "enforce") return { action: "reinstall", state: "run", fromVersion: from, toVersion: target };
      return { action: "install", state: "skip", reason: "already at " + target };
    }
    if (cmp < 0) return { action: "update", state: "run", fromVersion: from, toVersion: target };
    if (asObj(pkg).supportsDowngrade && (opts.action === "downgrade" || opts.allowDowngrade)) return { action: "downgrade", state: "run", fromVersion: from, toVersion: target };
    return { action: "install", state: "skip", reason: "newer version installed (" + (from || "unknown") + ")" };
  };

  /* ═══════════════════════ planning ═══════════════════════ */

  async function resolveTargetIds(providerId, provider, spec) {
    spec = spec || {};
    const DSP = ERP.dispatch;
    const explicit = asArr(spec.deviceIds).concat(spec.deviceId ? [spec.deviceId] : []);
    const hasScope = explicit.length || asArr(spec.groupIds).length || asArr(spec.siteIds).length || asArr(spec.tags).length || spec.all || spec.online;
    if (!hasScope) return asArr(provider.devices).map((d) => String(asObj(d).id));
    if (DSP && typeof DSP.resolveTargets === "function") { const r = await DSP.resolveTargets(providerId, spec); return asArr(r.deviceIds); }
    return asArr(provider.devices).map((d) => D.normalizeDevice(d)).filter((d) => inScope(provider, d, spec)).map((d) => String(d.id));
  }

  /* Which packages (and with what action / version / scope) is a plan
     built from? Explicit package ids, an assignment, every enabled
     assignment, or — as a fallback — the whole catalog. */
  async function entriesForPlan(provider, opts) {
    const all = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage).filter((p) => p.enabled !== false);
    const out = [];
    const mk = (p, a) => ({ pkg: p, action: a.action, targetVersion: a.targetVersion, enforcement: a.enforcement, assignmentId: a.id || "", scope: a.targets || null });
    if (asArr(opts.packageIds).length) {
      const want = opts.packageIds.map(String);
      all.filter((p) => want.indexOf(String(p.id)) !== -1).forEach((p) => out.push(mk(p, { action: opts.action || "auto", targetVersion: opts.targetVersion || "", enforcement: opts.enforcement || "skip-installed" })));
      return out;
    }
    if (opts.packageId) {
      const p = all.find((x) => String(x.id) === String(opts.packageId));
      if (p) out.push(mk(p, { action: opts.action || "auto", targetVersion: opts.targetVersion || "", enforcement: opts.enforcement || "skip-installed" }));
      return out;
    }
    if (opts.assignmentId || opts.useAssignments) {
      all.forEach((p) => asArr(p.assignments).filter((a) => a.enabled).forEach((a) => { if (!opts.assignmentId || String(a.id) === String(opts.assignmentId)) out.push(mk(p, a)); }));
      if (out.length) return out;
    }
    all.forEach((p) => out.push(mk(p, { action: opts.action || "auto", targetVersion: opts.targetVersion || "", enforcement: "skip-installed" })));
    return out;
  }

  SW.planForDevice = async function (providerId, provider, dev, entries, opts) {
    opts = opts || {};
    const fam = famKey(dev);
    const items = [], skipped = [], blocked = [];
    const ctx = { provider };
    for (const e of entries) {
      if (e.scope && !inScope(provider, dev, e.scope, ctx)) continue;
      const pkg = e.pkg;
      if (!SW.supportsOs(pkg, fam)) { blocked.push({ packageId: pkg.id, name: pkg.name, action: e.action, reason: "no " + famLabel(fam) + " variant" }); continue; }
      const pv = SW.validateParameters(pkg, opts.params);
      if (!pv.valid) { blocked.push({ packageId: pkg.id, name: pkg.name, action: e.action, reason: "parameters: " + pv.errors.join("; ") }); continue; }
      const det = await SW.detectForDevice(providerId, dev, pkg, { provider });
      const dec = SW.resolveAction(pkg, det, { action: e.action, targetVersion: e.targetVersion, enforcement: e.enforcement, allowDowngrade: opts.allowDowngrade });
      const row = {
        packageId: pkg.id, name: pkg.name, vendor: pkg.vendor, assignedBy: e.assignmentId || "",
        requested: e.action, action: dec.action, state: dec.state, reason: dec.reason || "",
        fromVersion: dec.fromVersion || det.version || "", toVersion: dec.toVersion || pkg.version || "",
        detected: { installed: !!det.installed, version: det.version || "", source: det.source || "none" },
        requiresReboot: !!SW.variantFor(pkg, fam).requiresReboot,
      };
      if (dec.state === "run") items.push(row);
      else if (dec.state === "skip") skipped.push(row);
      else blocked.push(Object.assign({}, row, { reason: row.reason }));
    }
    return {
      deviceId: String(dev.id), hostname: dev.hostname || dev.displayName || String(dev.id),
      osFamily: famLabel(fam), osKey: fam, siteId: dev.siteId || null,
      groupIds: asArr(dev.groupIds).map(String), items, skipped, blocked,
    };
  };

  SW.plan = async function (providerId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const entries = await entriesForPlan(provider, opts);
    if (!entries.length) return { providerId, at, devices: [], packages: [], totals: { devices: 0, items: 0, skipped: 0, blocked: 0, reboot: 0 } };
    const ids = await resolveTargetIds(providerId, provider, opts.targets || opts);
    const want = ids.map(String);
    const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived").filter((d) => want.indexOf(String(d.id)) !== -1);
    const rows = [];
    for (const dev of devices) rows.push(await SW.planForDevice(providerId, provider, dev, entries, opts));
    const totals = { devices: rows.length, withWork: 0, items: 0, skipped: 0, blocked: 0, reboot: 0 };
    rows.forEach((r) => {
      if (asArr(r.items).length) totals.withWork += 1;
      totals.items += asArr(r.items).length;
      totals.skipped += asArr(r.skipped).length;
      totals.blocked += asArr(r.blocked).length;
      if (asArr(r.items).some((i) => i.requiresReboot)) totals.reboot += 1;
    });
    return {
      providerId, at, devices: rows, totals,
      packages: entries.map((e) => ({ packageId: e.pkg.id, name: e.pkg.name, action: e.action, targetVersion: e.targetVersion || e.pkg.version, assignmentId: e.assignmentId || "" })),
    };
  };

  /* ═══════════════════════ deployment scripts ═══════════════════════ */

  function psQuote(s) { return "'" + String(s == null ? "" : s).replace(/'/g, "''").slice(0, 400) + "'"; }
  function shQuote(s) { return "'" + String(s == null ? "" : s).replace(/'/g, "'\\''").slice(0, 300) + "'"; }
  function safeId(id) { return String(id == null ? "" : id).replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 80); }

  SW.deployScript = function (family, items, meta) {
    meta = meta || {};
    const list = asArr(items);
    const L = SW.RESULT_LINE;
    if (family === "windows") {
      const lines = [
        "# RMM-U software deployment — " + list.length + " action(s)",
        "# deployment " + safeId(meta.deploymentId || "") + " · device " + safeId(meta.hostname || ""),
        "$ErrorActionPreference = 'Continue'",
        "$rmmTmp = Join-Path $env:TEMP ('rmm-sw-' + [System.Guid]::NewGuid().ToString('N'))",
        "New-Item -ItemType Directory -Force -Path $rmmTmp | Out-Null",
        "function Rmm-Result($id, $state, $msg) { Write-Output ('" + L + " ' + $id + ' ' + $state + $(if ($msg) { ' ' + $msg } else { '' })) }",
        "function Rmm-Fetch($url, $algo, $sum, $dest) {",
        "  try { Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -ErrorAction Stop } catch { throw ('download failed: ' + $_.Exception.Message) }",
        "  if ($sum) {",
        "    $lvl = switch ($algo.ToLower()) { 'sha1' { 'SHA1' } 'md5' { 'MD5' } default { 'SHA256' } }",
        "    $h = (Get-FileHash -Algorithm $lvl -Path $dest).Hash.ToLower()",
        "    if ($h -ne $sum.ToLower()) { throw ('checksum mismatch: expected ' + $sum + ' got ' + $h) }",
        "  }",
        "}",
      ];
      list.forEach((it) => {
        const cmd = asObj(it.command);
        const id = safeId(it.packageId);
        lines.push("");
        lines.push("# " + S(it.name, 120) + " (" + (it.action || "install") + ")");
        lines.push("try {");
        if (cmd.detectCommand) {
          lines.push("  $rmmDetected = $false");
          lines.push("  try { $rmmOut = & { " + String(cmd.detectCommand).replace(/\r?\n/g, "; ") + " } 2>$null; if ($rmmOut) { $rmmDetected = $true } } catch {}");
          lines.push("  Write-Output ('" + SW.DETECT_LINE + " ' + " + psQuote(id) + " + ' ' + $(if ($rmmDetected) { 'installed' } else { 'absent' }))");
        }
        if (cmd.source) {
          lines.push("  $rmmTarget = Join-Path $rmmTmp " + psQuote("rmm-" + id + "-installer"));
          lines.push("  Rmm-Fetch " + psQuote(cmd.source) + " " + psQuote(cmd.checksumAlgo || "sha256") + " " + psQuote(cmd.checksum || "") + " $rmmTarget");
        }
        String(cmd.script || "").split(/\r?\n/).forEach((ln) => { if (ln.trim()) lines.push("  " + ln); });
        lines.push("  Rmm-Result " + psQuote(id) + " ok");
        lines.push("} catch { Rmm-Result " + psQuote(id) + " failed $($_.Exception.Message) }");
      });
      return { language: "powershell", script: lines.join("\n") };
    }
    const plines = [
      "#!/bin/sh",
      "# RMM-U software deployment — " + list.length + " action(s)",
      "# deployment " + safeId(meta.deploymentId || "") + " · device " + safeId(meta.hostname || ""),
      "RMM_TMP=\"$(mktemp -d 2>/dev/null || echo /tmp/rmm-sw-$$)\"",
      "rmm_result() { echo \"" + L + " $1 $2 ${3:-}\"; }",
      "rmm_verify() { algo=\"$1\"; sum=\"$2\"; path=\"$3\"; [ -z \"$sum\" ] && return 0; case \"$algo\" in sha1) c=\"sha1sum\";; md5) c=\"md5sum\";; *) c=\"sha256sum\";; esac; echo \"$sum  $path\" | $c -c - >/dev/null 2>&1; }",
      "rmm_fetch() { url=\"$1\"; algo=\"$2\"; sum=\"$3\"; dest=\"$4\"; if command -v curl >/dev/null 2>&1; then curl -fsSL \"$url\" -o \"$dest\" || return 1; elif command -v wget >/dev/null 2>&1; then wget -qO \"$dest\" \"$url\" || return 1; else return 1; fi; rmm_verify \"$algo\" \"$sum\" \"$dest\"; }",
    ];
    list.forEach((it) => {
      const cmd = asObj(it.command);
      const id = safeId(it.packageId);
      plines.push("");
      plines.push("# " + S(it.name, 120) + " (" + (it.action || "install") + ")");
      plines.push("_id=" + shQuote(id));
      plines.push("_ok=1");
      if (cmd.detectCommand) {
        plines.push("if ( " + String(cmd.detectCommand).replace(/\r?\n/g, "; ") + " ) >/dev/null 2>&1; then echo \"" + SW.DETECT_LINE + " $_id installed\"; else echo \"" + SW.DETECT_LINE + " $_id absent\"; fi");
      }
      if (cmd.source) {
        plines.push("RMM_TARGET=\"$RMM_TMP/rmm-" + id + "-installer\"");
        plines.push("rmm_fetch " + shQuote(cmd.source) + " " + shQuote(cmd.checksumAlgo || "sha256") + " " + shQuote(cmd.checksum || "") + " \"$RMM_TARGET\" || _ok=0");
      }
      plines.push("if [ \"$_ok\" = 1 ]; then");
      String(cmd.script || "").split(/\r?\n/).forEach((ln) => { if (ln.trim()) plines.push("  " + ln); });
      plines.push("  if [ $? -eq 0 ]; then rmm_result \"$_id\" ok; else rmm_result \"$_id\" failed \"command failed\"; fi");
      plines.push("else");
      plines.push("  rmm_result \"$_id\" failed \"download or checksum failed\"");
      plines.push("fi");
    });
    return { language: "bash", script: plines.join("\n") };
  };

  SW.parseResultOutput = function (stdout) {
    const out = [];
    String(stdout == null ? "" : stdout).split(/\r?\n/).forEach((raw) => {
      const m = /^\s*SWSRESULT\s+(\S+)\s+(\S+)\s*(.*)$/.exec(raw);
      if (!m) return;
      const ok = low(m[2]) === "ok";
      out.push({ id: m[1], ok, state: ok ? "installed" : "failed", message: S(m[3], 200) });
    });
    return out;
  };

  SW.parseDetectOutput = function (stdout) {
    const out = [];
    String(stdout == null ? "" : stdout).split(/\r?\n/).forEach((raw) => {
      const m = /^\s*SWDETECT\s+(\S+)\s+(\S+)\s*(.*)$/.exec(raw);
      if (!m) return;
      out.push({ id: m[1], installed: low(m[2]) === "installed", version: S(m[3], 60) });
    });
    return out;
  };

  /* ═══════════════════════ deployment ═══════════════════════ */

  const retryMax = () => Math.max(0, num(cfg("rmm.softwareRetryMax", 2), 2));
  const retryBackoffMs = () => Math.max(1, num(cfg("rmm.softwareRetryBackoffMinutes", 30), 30)) * MIN;
  const deployHistory = () => Math.max(10, num(cfg("rmm.softwareDeployHistory", 100), 100));
  const maxPerJob = () => Math.max(1, num(cfg("rmm.softwareDeployMaxPerJob", 25), 25));
  const deployTimeout = () => Math.max(30, num(cfg("rmm.softwareDeployTimeoutSeconds", 3600), 3600));

  function actor() { try { return ERP.role || "owner"; } catch (e) { return "owner"; } }

  async function audit(action, targetId, summary, targetType) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: targetType || "softwaredeploy", targetId, summary }); } catch (e) {}
  }
  async function auditDevice(action, deviceId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "device", targetId: String(deviceId), summary }); } catch (e) {}
  }
  SW.auditDevice = auditDevice;

  function summarizeDeployment(dep) {
    const out = { devices: 0, packages: 0, installed: 0, uninstalled: 0, failed: 0, pending: 0, skipped: 0, blocked: 0, reboot: 0, state: "planned" };
    const states = [];
    Object.keys(asObj(dep.targets)).forEach((id) => {
      const t = asObj(dep.targets)[id];
      out.devices += 1;
      asArr(t.packages).forEach((p) => {
        out.packages += 1;
        out[p.state === "installed" ? "installed" : p.state === "uninstalled" ? "uninstalled" : p.state === "failed" ? "failed" : p.state === "skipped" ? "skipped" : "pending"] += 1;
        if (p.requiresReboot && p.state === "installed") out.reboot += 1;
      });
      out.blocked += asArr(t.blocked).length;
      states.push(t.state);
    });
    if (!states.length) out.state = "planned";
    else if (states.every((s) => s === "cancelled")) out.state = "cancelled";
    else if (states.every((s) => s === "succeeded")) out.state = "succeeded";
    else if (states.some((s) => s === "running")) out.state = "running";
    else if (states.every((s) => s === "failed")) out.state = "failed";
    else if (states.some((s) => s === "succeeded" || s === "partial")) out.state = "partial";
    else out.state = "failed";
    return out;
  }
  SW.summarizeDeployment = summarizeDeployment;

  async function itemsForEntries(provider, fam, entries, params) {
    const cat = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage);
    const items = [];
    for (const e of asArr(entries)) {
      const pkg = cat.find((p) => String(p.id) === String(e.packageId));
      if (!pkg) continue;
      const cmd = SW.commandFor(pkg, fam, e.action, Object.assign({}, params || {}, { __targetVersion: e.toVersion || "" }));
      items.push({ packageId: e.packageId, name: e.name, action: e.action, command: cmd });
    }
    return items;
  }

  SW.deploy = async function (providerId, opts) {
    opts = opts || {};
    if (!deployEnabled() && !opts.force) return { error: "software_deploy_disabled", message: "Software deployment is disabled." };
    const J = ERP.jobs;
    if (!J || typeof J.enqueue !== "function") return { error: "jobs_unavailable", message: "The job engine is not available." };
    const at = opts.at || now();
    const plan = opts.plan || await SW.plan(providerId, opts);
    if (plan.error) return plan;
    const devs = asArr(plan.devices).filter((d) => asArr(d.items).length);
    if (opts.dryRun) return { dryRun: true, providerId, at, plan: Object.assign({}, plan, { devices: devs }) };
    if (!devs.length) return { error: "nothing_to_deploy", message: "Nothing to deploy — every target is already in the desired state." };

    const provider = (await T.get(providerId)).provider;
    const deploymentId = rid("swdep");
    const name = S(opts.name || ("Software run " + at.slice(0, 16).replace("T", " ")), 160);
    const createdBy = opts.createdBy || actor();
    const cap = maxPerJob();
    const params = asObj(opts.params);
    const targets = {}, jobIds = [];
    for (const d of devs) {
      const fam = d.osKey || famKey(d);
      const picked = asArr(d.items).slice(0, cap);
      const overflow = asArr(d.items).slice(cap);
      const items = await itemsForEntries(provider, fam, picked, params);
      const built = SW.deployScript(fam, items, { deploymentId, hostname: d.hostname });
      const enq = await J.enqueue({
        providerId, deviceIds: [d.deviceId],
        name: "Software " + d.hostname + " (" + picked.length + " action" + (picked.length === 1 ? "" : "s") + ")",
        language: built.language, script: built.script,
        source: SW.DEPLOY_SOURCE + ":" + deploymentId, createdBy,
        timeoutSeconds: deployTimeout(), maxAttempts: retryMax() + 1,
      });
      const mk = (p, state, extra) => Object.assign({
        packageId: p.packageId, name: p.name, action: p.action, state, attempts: 0,
        fromVersion: p.fromVersion || "", toVersion: p.toVersion || "", version: p.toVersion || "",
        requiresReboot: !!p.requiresReboot, error: "", completedAt: "",
      }, extra || {});
      const packages = picked.map((p) => mk(p, "pending"))
        .concat(overflow.map((p) => mk(p, "skipped", { error: "over the per-job cap" })));
      if (enq.error) {
        packages.forEach((p) => { if (p.state === "pending") { p.state = "failed"; p.error = S(enq.error, 120); } });
        targets[d.deviceId] = { deviceId: d.deviceId, hostname: d.hostname, osFamily: d.osFamily, jobId: "", state: "failed", attempts: 0, packages, blocked: d.blocked, updatedAt: at };
        continue;
      }
      jobIds.push(enq.job.id);
      targets[d.deviceId] = { deviceId: d.deviceId, hostname: d.hostname, osFamily: d.osFamily, jobId: enq.job.id, state: "running", attempts: 1, packages, blocked: d.blocked, updatedAt: at };
    }
    const dep = { kind: "softwaredeployment", id: deploymentId, providerId: String(providerId), name, at, createdBy, source: S(opts.source || "manual", 40), params: clone(params), targets, jobIds, updatedAt: at };
    dep.summary = summarizeDeployment(dep);
    dep.state = dep.summary.state;
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      p.softwareState.deployments = asArr(p.softwareState.deployments);
      p.softwareState.deployments.push(dep);
      const capH = deployHistory();
      if (p.softwareState.deployments.length > capH) p.softwareState.deployments = p.softwareState.deployments.slice(-capH);
    });
    if (r.error) return r;
    await audit("software_deploy", deploymentId, "Deployed " + dep.summary.packages + " package action(s) to " + dep.summary.devices + " device(s).");
    return { ok: true, deployment: clone(dep), jobs: jobIds };
  };

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

  SW.reconcileDeployment = async function (providerId, deploymentId, opts) {
    opts = opts || {};
    const J = ERP.jobs || null;
    const at = opts.at || now();
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const list = asArr(asObj(provider.softwareState).deployments);
    const dep = list.find((d) => String(d.id) === String(deploymentId));
    if (!dep) return { error: "not_found" };
    const devices = asArr(provider.devices).map(D.normalizeDevice);
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

      const parsed = SW.parseResultOutput(res.stdout);
      const detects = SW.parseDetectOutput(res.stdout);
      const byId = {};
      parsed.forEach((p) => { byId[String(p.id)] = p; });
      const jobFailed = res.state !== "succeeded";
      asArr(t.packages).forEach((p) => {
        if (p.state === "installed" || p.state === "uninstalled") return;
        const hit = byId[String(p.packageId)];
        if (hit) { p.state = hit.ok ? (p.action === "uninstall" ? "uninstalled" : "installed") : "failed"; p.error = hit.ok ? "" : (hit.message || "failed"); if (hit.ok) { p.completedAt = at; p.version = p.toVersion || p.version; } }
        else if (jobFailed) { p.state = "failed"; p.error = S(res.error || ("job " + res.state), 200); }
        else if (parsed.length) { p.state = "skipped"; p.error = "not reported"; }
        else { p.state = p.action === "uninstall" ? "uninstalled" : "installed"; p.completedAt = at; }
      });
      t.detections = detects;
      t.attempts = Math.max(1, num(t.attempts, 1));

      const done = asArr(t.packages).filter((p) => p.state === "installed" || p.state === "uninstalled");
      if (done.length) await auditDevice("software_" + (done[done.length - 1].action || "deploy"), deviceId, done.map((p) => p.name + (p.toVersion ? " " + p.toVersion : "")).join(", ") + " on " + (t.hostname || deviceId));

      const failed = asArr(t.packages).filter((p) => p.state === "failed").length;
      const lastAt = msOf(t.updatedAt) || 0;
      const canRetry = failed > 0 && t.attempts <= retryMax() && !t.retryPending && (opts.force || (at && msOf(at) - lastAt >= retryBackoffMs()));
      if (canRetry && J && typeof J.enqueue === "function") {
        const fails = asArr(t.packages).filter((p) => p.state === "failed");
        const fam = t.osKey || famKey(dev);
        const items = await itemsForEntries(provider, fam, fails.map((f) => ({ packageId: f.packageId, name: f.name, action: f.action, toVersion: f.toVersion })), dep.params);
        if (items.length) {
          const built = SW.deployScript(fam, items, { deploymentId, hostname: t.hostname });
          const enq = await J.enqueue({
            providerId, deviceIds: [String(deviceId)], name: "Software retry " + t.hostname + " (" + fails.length + ")",
            language: built.language, script: built.script, source: SW.DEPLOY_SOURCE + ":" + deploymentId + ":retry",
            createdBy: dep.createdBy, timeoutSeconds: deployTimeout(), maxAttempts: 1,
          });
          if (!enq.error) {
            fails.forEach((p) => { p.state = "pending"; p.error = ""; });
            t.jobId = enq.job.id; t.attempts += 1; t.retryPending = true; t.state = "running"; t.updatedAt = at; changed = true;
            retried.push({ deviceId, jobId: enq.job.id, packages: fails.map((p) => p.packageId) });
            continue;
          }
        }
      }
      t.retryPending = false;
      const total = asArr(t.packages).length;
      const okCount = asArr(t.packages).filter((p) => p.state === "installed" || p.state === "uninstalled").length;
      t.state = okCount && okCount === total ? "succeeded" : (okCount > 0 ? "partial" : "failed");
      t.updatedAt = at;
      changed = true;
    }

    dep.summary = summarizeDeployment(dep);
    dep.state = dep.summary.state;
    dep.updatedAt = at;
    if (changed) {
      const r = await T.update(providerId, (p) => {
        p.softwareState = asObj(p.softwareState);
        p.softwareState.deployments = asArr(p.softwareState.deployments);
        const i = p.softwareState.deployments.findIndex((d) => String(d.id) === String(deploymentId));
        if (i !== -1) p.softwareState.deployments[i] = clone(dep);
      });
      if (r.error) return r;
    }
    if (retried.length) await audit("software_deploy_retry", deploymentId, "Retried failed package actions on " + retried.length + " device(s).");
    return { ok: true, deployment: clone(dep), changed, retried };
  };

  SW.reconcileAll = async function (providerId, opts) {
    opts = opts || {};
    const list = await SW.deployments(providerId);
    const out = [];
    for (const d of list) {
      if (!opts.recheck && ["succeeded", "failed", "partial", "cancelled"].indexOf(d.state) !== -1) continue;
      const r = await SW.reconcileDeployment(providerId, d.id, opts);
      out.push({ id: d.id, changed: !!r.changed, error: r.error || null });
    }
    return { providerId, reconciled: out.length, results: out };
  };

  SW.deployments = async function (providerId) {
    const provider = await providerOf(providerId);
    if (!provider) return [];
    return asArr(asObj(provider.softwareState).deployments).slice().reverse();
  };
  SW.deployment = async function (providerId, id) {
    const list = await SW.deployments(providerId);
    return list.find((d) => String(d.id) === String(id)) || null;
  };

  /* ═══════════════════════ per-device detection & status (Task 32) ═══════════════════════ */

  function siteNameOf(provider, id) { const s = asArr(provider.sites).find((x) => String(x.id) === String(id)); return s ? (s.name || id) : ""; }
  function groupNamesOf(provider, ids) {
    const groups = asArr(provider.deviceGroups);
    return asArr(ids).map((id) => { const g = groups.find((x) => String(x.id) === String(id)); return g ? (g.name || id) : id; });
  }
  SW.groupNames = groupNamesOf;

  function latestTargetFor(deps, deviceId) {
    let best = null;
    asArr(deps).forEach((dep) => {
      const t = asObj(asObj(dep.targets)[deviceId]);
      if (!t) return;
      const at = msOf(t.updatedAt || dep.at) || 0;
      if (!best || at > best.at) best = { at, atIso: t.updatedAt || dep.at, state: t.state, pending: asArr(t.packages).filter((p) => p.state === "pending").length, failed: asArr(t.packages).filter((p) => p.state === "failed").length, installed: asArr(t.packages).filter((p) => p.state === "installed").length, deploymentId: dep.id };
    });
    return best;
  }

  SW.deviceRows = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const catalog = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage).filter((p) => p.enabled !== false);
    const deps = asArr(asObj(provider.softwareState).deployments);
    const scope = asArr(opts.deviceIds).length ? opts.deviceIds.map(String) : null;
    let devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived").filter((d) => !scope || scope.indexOf(String(d.id)) !== -1);
    const rows = [];
    for (const dev of devices) {
      const snap = INV && INV.snapshot ? await INV.snapshot(asObj(dev).id) : null;
      const software = asArr(asObj(asObj(snap).sections).software);
      const installed = [], missing = [];
      catalog.forEach((pkg) => {
        const det = SW.detectIn(pkg, software, famKey(dev));
        if (det.installed) installed.push({ packageId: pkg.id, name: pkg.name, version: det.version || "—" });
        else missing.push({ packageId: pkg.id, name: pkg.name });
      });
      const last = latestTargetFor(deps, dev.id);
      rows.push({
        deviceId: dev.id, hostname: dev.hostname || dev.displayName || dev.id,
        siteId: dev.siteId || null, siteName: siteNameOf(provider, dev.siteId),
        groupIds: asArr(dev.groupIds), groupNames: groupNamesOf(provider, dev.groupIds),
        osFamily: famLabel(famKey(dev)), osKey: famKey(dev), status: dev.status,
        softwareCount: software.length, catalogSize: catalog.length,
        installedCount: installed.length, missingCount: missing.length,
        installed, missing,
        deployState: last ? last.state : "", lastDeployAt: last ? last.atIso : "", deploymentId: last ? last.deploymentId : "",
        pending: last ? last.pending : 0, failed: last ? last.failed : 0, trackedInstalled: last ? last.installed : 0,
        hasInventory: !!snap,
      });
    }
    if (opts.status) rows.splice(0, rows.length, ...rows.filter((r) => r.status === opts.status));
    if (opts.siteId) rows.splice(0, rows.length, ...rows.filter((r) => String(r.siteId) === String(opts.siteId)));
    if (opts.groupId) rows.splice(0, rows.length, ...rows.filter((r) => asArr(r.groupIds).map(String).indexOf(String(opts.groupId)) !== -1));
    if (opts.q) { const q = low(opts.q); rows.splice(0, rows.length, ...rows.filter((r) => [r.hostname, r.siteName, r.osFamily, asArr(r.groupNames).join(" ")].some((x) => low(x).indexOf(q) !== -1))); }
    return { providerId, rows };
  };

  /* Assignment compliance: for every assignment, how many of the scoped
     devices have the package installed / missing / pending / failed. */
  SW.assignmentRows = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const catalog = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage);
    const deps = asArr(asObj(provider.softwareState).deployments);
    const devices = asArr(provider.devices).map(D.normalizeDevice).filter((d) => d.status !== "archived");
    const rows = [];
    for (const pkg of catalog) {
      for (const a of asArr(pkg.assignments)) {
        if (!a.enabled) continue;
        let scoped = devices.filter((dev) => inScope(provider, dev, a.targets, { provider }));
        if (!scoped.length && (a.targets.all || asArr(devices).length === 0)) scoped = a.targets.all ? devices : scoped;
        let installed = 0, missing = 0, pending = 0, failed = 0;
        for (const dev of scoped) {
          const snap = INV && INV.snapshot ? await INV.snapshot(dev.id) : null;
          const software = asArr(asObj(asObj(snap).sections).software);
          const det = SW.detectIn(pkg, software, famKey(dev));
          const last = latestTargetFor(deps, dev.id);
          if (det.installed) installed += 1;
          else missing += 1;
          if (last) { pending += last.pending; failed += last.failed; }
        }
        rows.push({
          assignmentId: a.id, packageId: pkg.id, packageName: pkg.name, action: a.action,
          targetVersion: a.targetVersion || pkg.version, enforcement: a.enforcement,
          scope: describeTargets(a.targets), devices: scoped.length,
          installed, missing, pending, failed,
          compliant: scoped.length > 0 && missing === 0 && failed === 0 && pending === 0,
        });
      }
    }
    return { providerId, rows };
  };

  /* ═══════════════════════ licences & reconciliation (Task 33) ═══════════════════════ */

  SW.listLicenses = async function (providerId) {
    const provider = await providerOf(providerId);
    if (!provider) return [];
    return asArr(asObj(provider.softwareState).licenses).map(SW.normalizeLicense).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  };
  SW.getLicense = async function (providerId, id) {
    const list = await SW.listLicenses(providerId);
    return list.find((l) => String(l.id) === String(id)) || null;
  };
  SW.addLicense = async function (providerId, data) {
    if (!licenseEnabled() && !asObj(data).force) return { error: "software_license_disabled" };
    const lic = SW.normalizeLicense(Object.assign({}, data, { id: (data && data.id) || rid("swlic"), createdAt: now(), updatedAt: now() }));
    if (!lic.title || low(lic.title) === "untitled licence") return { error: "invalid", errors: ["A licence title is required."] };
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      p.softwareState.licenses = asArr(p.softwareState.licenses);
      p.softwareState.licenses.push(lic);
    });
    if (r.error) return r;
    await audit("software_license_add", lic.id, "Added licence \"" + lic.title + "\".");
    return { license: clone(lic) };
  };
  SW.updateLicense = async function (providerId, id, patch) {
    let out = null;
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      const list = asArr(p.softwareState.licenses);
      const i = list.findIndex((x) => String(x.id) === String(id));
      if (i === -1) return;
      const merged = SW.normalizeLicense(Object.assign({}, list[i], asObj(patch), { id: list[i].id, createdAt: list[i].createdAt || now(), updatedAt: now() }));
      list[i] = merged; p.softwareState.licenses = list; out = clone(merged);
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", id };
    await audit("software_license_update", id, "Updated licence \"" + out.title + "\".");
    return { license: out };
  };
  SW.removeLicense = async function (providerId, id) {
    let removed = null;
    const r = await T.update(providerId, (p) => {
      p.softwareState = asObj(p.softwareState);
      const list = asArr(p.softwareState.licenses);
      removed = list.find((x) => String(x.id) === String(id)) || null;
      p.softwareState.licenses = list.filter((x) => String(x.id) !== String(id));
    });
    if (r.error) return r;
    if (!removed) return { error: "not_found", id };
    await audit("software_license_remove", id, "Removed licence \"" + (removed.title || id) + "\".");
    return { removed: String(id) };
  };

  SW.setAllowList = async function (providerId, names) {
    const list = asArr(names).map((n) => S(n, 200)).filter(Boolean);
    const r = await T.update(providerId, (p) => { p.softwareState = asObj(p.softwareState); p.softwareState.allowList = list; });
    if (r.error) return r;
    return { ok: true, allowList: list };
  };
  SW.allowList = async function (providerId) {
    const provider = await providerOf(providerId);
    return provider ? asArr(asObj(provider.softwareState).allowList) : [];
  };

  function titleMatch(pkg, title) {
    return SW.matchItem(SW.effectiveDetection(pkg, null), { name: title.name, publisher: title.publisher, version: asArr(title.versions)[0] || "" });
  }

  /* The catalog ↔ installed-software coverage matrix: for every installed
     title, which catalog packages (if any) cover it, and for every
     package, how many devices it is installed on. */
  SW.coverage = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const provider = g.provider;
    const catalog = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage);
    const licenses = asArr(asObj(provider.softwareState).licenses).map(SW.normalizeLicense).filter((l) => l.enabled);
    const allow = asArr(asObj(provider.softwareState).allowList);
    const index = INV && INV.softwareIndex ? await INV.softwareIndex(providerId) : [];
    const titles = asArr(index).map((t) => {
      const hits = catalog.filter((p) => titleMatch(p, t));
      const licensed = licenses.filter((l) => hits.some((p) => String(p.id) === String(l.packageId)) || low(l.title).indexOf(low(t.name)) !== -1 || low(t.name).indexOf(low(l.title)) !== -1);
      const allowHit = allow.some((a) => low(t.name).indexOf(low(a)) !== -1);
      return {
        key: t.key, name: t.name, publisher: t.publisher || "", deviceCount: num(t.deviceCount, 0),
        deviceIds: asArr(t.deviceIds), versions: asArr(t.versions),
        coveredBy: hits.map((p) => p.id), packageNames: hits.map((p) => p.name),
        licensedBy: licensed.map((l) => l.id), allowListed: allowHit,
        sanctioned: hits.length > 0 || licensed.length > 0 || allowHit,
      };
    });
    const packages = catalog.map((p) => {
      const hits = titles.filter((t) => titleMatch(p, t));
      const deviceIds = new Set();
      hits.forEach((t) => asArr(t.deviceIds).forEach((id) => deviceIds.add(String(id))));
      const lic = licenses.filter((l) => String(l.packageId) === String(p.id));
      return {
        packageId: p.id, name: p.name, vendor: p.vendor, version: p.version, categoryId: p.categoryId,
        enabled: p.enabled !== false, requiresReboot: !!p.requiresReboot,
        detection: SW.effectiveDetection(p, null),
        titles: hits.map((t) => t.name), deviceIds: [...deviceIds], deviceCount: deviceIds.size,
        licensed: lic.length > 0, licenseIds: lic.map((l) => l.id),
      };
    });
    return { providerId, providerName: provider.name || "", catalog: catalog.length, titles, packages, allowList: allow };
  };

  SW.reconcile = async function (providerId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const cov = await SW.coverage(providerId);
    if (cov.error) return cov;
    const g = await T.get(providerId);
    const provider = g.error ? {} : g.provider;
    const licenses = asArr(asObj(provider.softwareState).licenses).map(SW.normalizeLicense);
    const atMs = msOf(at) || Date.now();
    const devices = asArr(provider.devices).map(D.normalizeDevice);
    const snaps = INV && INV.listSnapshots ? await INV.listSnapshots(providerId) : [];
    const snapByDev = {};
    asArr(snaps).forEach((s) => { snapByDev[String(s.deviceId)] = s; });

    const rows = licenses.map((l) => {
      const matched = asArr(cov.packages).filter((p) => {
        if (l.packageId && String(p.packageId) === String(l.packageId)) return true;
        return low(p.name).indexOf(low(l.title)) !== -1 || low(l.title).indexOf(low(p.name)) !== -1;
      });
      const devSet = new Set();
      matched.forEach((p) => asArr(p.deviceIds).forEach((id) => devSet.add(String(id))));
      let used = devSet.size;
      if (l.metric === "per-user") {
        const users = new Set();
        devSet.forEach((id) => { const dev = devices.find((d) => String(d.id) === id); asArr(asObj(dev).loggedInUsers).forEach((u) => users.add(low(asObj(u).name))); });
        used = users.size;
      }
      const seats = l.seatsUsed == null ? l.seats : l.seatsUsed;
      const over = seats > 0 && used > seats;
      const expMs = msOf(l.expiresAt);
      const expired = expMs != null && expMs < atMs;
      const expiresInDays = expMs == null ? null : Math.round((expMs - atMs) / DAY);
      let status = "ok";
      if (expired) status = "expired";
      else if (over) status = "over";
      else if (used === 0) status = "unused";
      else if (expiresInDays != null && expiresInDays <= 30) status = "expiring";
      return Object.assign({}, l, {
        used, seats, over, overBy: over ? used - seats : 0, expired, expiresInDays, status,
        utilization: seats > 0 ? Math.round((used / seats) * 100) : (used > 0 ? 100 : 0),
        matchedPackages: matched.map((p) => ({ packageId: p.packageId, name: p.name })),
        deviceIds: [...devSet],
      });
    });

    const unsanctioned = asArr(cov.titles).filter((t) => !t.sanctioned)
      .map((t) => ({ name: t.name, publisher: t.publisher, deviceCount: t.deviceCount, deviceIds: t.deviceIds, versions: t.versions }))
      .sort((a, b) => b.deviceCount - a.deviceCount || String(a.name).localeCompare(String(b.name)));

    const totals = {
      licenses: rows.length, seats: rows.reduce((a, l) => a + l.seats, 0), used: rows.reduce((a, l) => a + l.used, 0),
      over: rows.filter((l) => l.over).length, expired: rows.filter((l) => l.expired).length,
      expiring: rows.filter((l) => l.status === "expiring").length, unused: rows.filter((l) => l.status === "unused").length,
      titles: asArr(cov.titles).length, packaged: asArr(cov.packages).filter((p) => p.deviceCount > 0).length,
      devices: devices.length, withInventory: Object.keys(snapByDev).length,
      unsanctioned: unsanctioned.length, unsanctionedDevices: new Set(unsanctioned.reduce((a, u) => a.concat(asArr(u.deviceIds)), [])).size,
    };
    return {
      kind: "softwarelicense", providerId: String(providerId), providerName: provider.name || "",
      at, generatedAt: at, licenses: rows, packages: asArr(cov.packages), titles: asArr(cov.titles),
      unsanctioned, allowList: asArr(cov.allowList), totals,
    };
  };

  SW.inventoryReport = async function (providerId, opts) {
    opts = opts || {};
    const at = opts.at || now();
    const cov = await SW.coverage(providerId);
    if (cov.error) return cov;
    const dr = await SW.deviceRows(providerId, {});
    const devices = dr.error ? [] : dr.rows;
    const totals = {
      devices: devices.length, withInventory: devices.filter((d) => d.hasInventory).length,
      titles: asArr(cov.titles).length, installedTitles: asArr(cov.titles).length,
      packaged: asArr(cov.packages).filter((p) => p.deviceCount > 0).length,
      unsanctioned: asArr(cov.titles).filter((t) => !t.sanctioned).length,
      installs: asArr(cov.titles).reduce((a, t) => a + num(t.deviceCount, 0), 0),
    };
    return {
      kind: "softwareinventory", providerId: String(providerId), providerName: cov.providerName || "",
      at, generatedAt: at, totals,
      packages: asArr(cov.packages), titles: asArr(cov.titles), devices,
      unsanctioned: asArr(cov.titles).filter((t) => !t.sanctioned).map((t) => ({ name: t.name, publisher: t.publisher, deviceCount: t.deviceCount })),
    };
  };

  SW.exportReport = function (report) { return JSON.stringify(report || {}, null, 2); };

  SW.download = function (filename, text) {
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

  /* ═══════════════════════ UI ═══════════════════════ */

  function badge(text, tone) { return ERP.ui.badge(text, tone); }

  SW.currentProviderId = null;

  function actionBadge(a) { return badge(SW.ACTION_LABEL[a] || a || "—", SW.actionTone(a)); }
  function stateBadge(s) { return badge(SW.stateTone(s) === "success" ? s : s === "failed" ? "Failed" : s === "partial" ? "Partial" : s, SW.stateTone(s)); }
  function deployBadge(s) { return badge(s === "succeeded" ? "Succeeded" : s === "partial" ? "Partial" : s === "failed" ? "Failed" : s === "cancelled" ? "Cancelled" : s === "running" ? "Running" : "Planned", SW.stateTone(s)); }
  function platformBadge(k) { return badge(famLabel(k), "muted"); }

  function targetSummary(t) { return describeTargets(t); }

  SW.renderReport = function (rep) {
    const ui = ERP.ui, esc = ui.esc;
    if (!rep || rep.error) return '<p class="erp-sub">No report generated yet.</p>';
    const kv = (label, value) => '<div class="rmm-kv-row"><span>' + esc(label) + "</span><b>" + value + "</b></div>";
    const t = asObj(rep.totals);
    const licRows = asArr(rep.licenses).map((l) => ({
      title: "<b>" + esc(l.title) + "</b>" + (l.vendor ? '<div class="erp-sub">' + esc(l.vendor) + "</div>" : ""),
      metric: esc(l.metric), seats: String(num(l.seats, 0)), used: String(num(l.used, 0)),
      util: badge(l.utilization + "%", l.utilization > 100 ? "danger" : l.utilization >= 80 ? "warn" : "success"),
      expiry: l.expiresAt ? esc(ui.date(l.expiresAt)) + (l.expired ? " " + badge("expired", "danger") : l.expiresInDays != null ? ' <span class="erp-sub">' + l.expiresInDays + "d</span>" : "") : "—",
      status: badge(l.status, SW.licenseTone(l.status)),
    }));
    const unsan = asArr(rep.unsanctioned).map((u) => ({
      name: "<b>" + esc(u.name) + "</b>", publisher: esc(u.publisher || "—"),
      devices: badge(String(num(u.deviceCount, 0)), "warn"), versions: esc(asArr(u.versions).join(", ") || "—"),
    }));
    const pkgRows = asArr(rep.packages).map((p) => ({
      name: "<b>" + esc(p.name) + "</b>" + (p.vendor ? '<div class="erp-sub">' + esc(p.vendor) + "</div>" : ""),
      version: esc(p.version || "—"), devices: String(num(p.deviceCount, 0)),
      licensed: p.licensed ? badge("licensed", "success") : '<span class="erp-sub">—</span>',
    }));
    const titleRows = asArr(rep.titles).map((x) => ({
      name: "<b>" + esc(x.name) + "</b>", publisher: esc(x.publisher || "—"),
      devices: String(num(x.deviceCount, 0)), versions: esc(asArr(x.versions).join(", ") || "—"),
      coverage: asArr(x.coveredBy).length ? badge("packaged", "success") : (x.sanctioned ? badge("allowed", "info") : badge("unsanctioned", "warn")),
    }));
    const devRows = asArr(rep.devices).map((d) => ({
      device: "<b>" + esc(d.hostname) + "</b>" + (d.siteName ? '<div class="erp-sub">' + esc(d.siteName) + "</div>" : ""),
      os: esc(d.osFamily || "—"), titles: String(num(d.softwareCount, 0)),
      installed: String(num(d.installedCount, 0)), missing: num(d.missingCount, 0) ? badge(String(num(d.missingCount, 0)), "warn") : "0",
      pending: num(d.pending, 0) ? badge(String(num(d.pending, 0)), "info") : "0",
      failed: num(d.failed, 0) ? badge(String(num(d.failed, 0)), "danger") : "0",
    }));
    const licTab = asArr(rep.licenses).length ? ui.table([
      { key: "title", label: "Licence", render: (r) => r.title },
      { key: "metric", label: "Metric", render: (r) => r.metric },
      { key: "seats", label: "Seats", align: "right", render: (r) => r.seats },
      { key: "used", label: "Used", align: "right", render: (r) => r.used },
      { key: "util", label: "Utilisation", render: (r) => r.util },
      { key: "expiry", label: "Expiry", render: (r) => r.expiry },
      { key: "status", label: "Status", render: (r) => r.status },
    ], licRows, { scroll: true }) : "";
    return '<div class="rmm-software-report">' +
      '<div class="rmm-kv">' +
      kv("Client", esc(rep.providerName || rep.providerId)) +
      kv("Generated", esc(ui.dateTime(rep.generatedAt || rep.at))) +
      kv("Devices", String(num(t.devices, 0)) + " (" + String(num(t.withInventory, 0)) + " with inventory)") +
      kv("Installed titles", String(num(t.titles, 0))) +
      kv("Catalogued packages", String(num(t.packaged, 0))) +
      kv("Licences", String(num(t.licenses, 0))) +
      kv("Seats / used", String(num(t.seats, 0)) + " / " + String(num(t.used, 0))) +
      kv("Over-deployed", num(t.over, 0) ? badge(String(num(t.over, 0)), "danger") : "0") +
      kv("Expired", num(t.expired, 0) ? badge(String(num(t.expired, 0)), "danger") : "0") +
      kv("Unsanctioned titles", num(t.unsanctioned, 0) ? badge(String(num(t.unsanctioned, 0)), "warn") : "0") +
      "</div>" +
      (licTab ? '<h4 class="rmm-section-title">Licence reconciliation</h4>' + licTab : "") +
      '<h4 class="rmm-section-title">Catalogued packages</h4>' + ui.table([
        { key: "name", label: "Package", render: (r) => r.name },
        { key: "version", label: "Version", render: (r) => r.version },
        { key: "devices", label: "Installed on", render: (r) => r.devices },
        { key: "licensed", label: "Licensed", render: (r) => r.licensed },
      ], pkgRows, { scroll: true, emptyText: "No packages in the catalog." }) +
      '<h4 class="rmm-section-title">Installed software (' + titleRows.length + ")</h4>" + ui.table([
        { key: "name", label: "Title", render: (r) => r.name },
        { key: "publisher", label: "Publisher", render: (r) => r.publisher },
        { key: "devices", label: "Devices", render: (r) => r.devices },
        { key: "versions", label: "Versions", render: (r) => r.versions },
        { key: "coverage", label: "Coverage", render: (r) => r.coverage },
      ], titleRows, { scroll: true, emptyText: "No software inventory collected yet." }) +
      (unsan.length ? '<h4 class="rmm-section-title">Unsanctioned software</h4>' + ui.table([
        { key: "name", label: "Title", render: (r) => r.name },
        { key: "publisher", label: "Publisher", render: (r) => r.publisher },
        { key: "devices", label: "Devices", render: (r) => r.devices },
        { key: "versions", label: "Versions", render: (r) => r.versions },
      ], unsan, { scroll: true }) : "") +
      (devRows.length ? '<h4 class="rmm-section-title">Per-device deployment status</h4>' + ui.table([
        { key: "device", label: "Device", render: (r) => r.device },
        { key: "os", label: "OS", render: (r) => r.os },
        { key: "titles", label: "Titles", render: (r) => r.titles },
        { key: "installed", label: "Catalogued", render: (r) => r.installed },
        { key: "missing", label: "Missing", render: (r) => r.missing },
        { key: "pending", label: "Pending", render: (r) => r.pending },
        { key: "failed", label: "Failed", render: (r) => r.failed },
      ], devRows, { scroll: true }) : "") +
      "</div>";
  };

  /* ── device modal section (Task 32) ── */
  SW.deviceSection = async function (dev, providerId) {
    const ui = ERP.ui, esc = ui.esc;
    if (!dev) return "";
    const provider = await providerOf(providerId);
    if (!provider) return "";
    const catalog = asArr(asObj(provider.softwareState).catalog).map(SW.normalizePackage).filter((p) => p.enabled !== false);
    const snap = INV && INV.snapshot ? await INV.snapshot(dev.id) : null;
    const software = asArr(asObj(asObj(snap).sections).software);
    const rows = catalog.map((pkg) => {
      const det = SW.detectIn(pkg, software, famKey(dev));
      return {
        name: "<b>" + esc(pkg.name) + "</b>" + (pkg.vendor ? '<div class="erp-sub">' + esc(pkg.vendor) + "</div>" : ""),
        target: esc(pkg.version || "—"),
        detected: det.installed ? badge("installed " + (det.version || ""), "success") : badge("not installed", "muted"),
        source: '<span class="erp-sub">' + esc(det.source || "—") + "</span>",
      };
    });
    const deps = asArr(asObj(provider.softwareState).deployments);
    const recent = [];
    deps.forEach((dep) => {
      const t = asObj(asObj(dep.targets)[dev.id]);
      if (!t) return;
      asArr(t.packages).forEach((p) => recent.push({
        when: '<span class="erp-sub">' + esc(ui.dateTime(t.updatedAt || dep.at)) + "</span>",
        name: esc(p.name || p.packageId), action: actionBadge(p.action), state: stateBadge(p.state),
        version: esc(p.toVersion || p.version || "—"),
        note: p.error ? '<span class="erp-sub">' + esc(p.error) + "</span>" : (p.completedAt ? '<span class="erp-sub">' + esc(ui.dateTime(p.completedAt)) + "</span>" : ""),
      }));
    });
    recent.reverse();
    const table = rows.length ? ui.table([
      { key: "name", label: "Package", render: (r) => r.name },
      { key: "target", label: "Target", render: (r) => r.target },
      { key: "detected", label: "Detection", render: (r) => r.detected },
      { key: "source", label: "Source", render: (r) => r.source },
    ], rows, { scroll: true, emptyText: "No software packages in the catalog." }) : '<p class="erp-sub">No software packages in the catalog.</p>';
    const depTable = recent.length ? ui.table([
      { key: "when", label: "When", render: (r) => r.when },
      { key: "name", label: "Package", render: (r) => r.name },
      { key: "action", label: "Action", render: (r) => r.action },
      { key: "state", label: "Result", render: (r) => r.state },
      { key: "version", label: "Version", render: (r) => r.version },
      { key: "note", label: "Detail", render: (r) => r.note },
    ], recent.slice(0, 30), { scroll: true, emptyText: "No deployments for this device." }) : "";
    return "<h4 class=\"rmm-section-title\">Software &amp; deployment</h4>" +
      '<div class="rmm-status-line">' + badge(software.length + " installed title(s)", "muted") + (snap ? " " + badge("inventory " + ui.dateTime(asObj(snap).at), "info") : " " + badge("no inventory yet", "warn")) + "</div>" +
      "<p class=\"erp-sub\">Detection is read from this device's software inventory; a deployment younger than the last collection is shown as its source.</p>" +
      table +
      (depTable ? '<h5 class="rmm-section-title">Deployment history</h5>' + depTable : "");
  };

  /* ── the console ── */

  SW.renderPanel = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const toast = opts.toast || ERP.toast || (() => {});
    const state = { tab: "catalog", q: "", categoryId: "", plan: null, target: { mode: "all", deviceIds: "", groupIds: "", tags: "" }, pickPackage: "", pickAction: "auto", pickVersion: "", enforcement: "skip-installed", report: null };

    async function load() { const g = await T.get(opts.providerId); return g.error ? (opts.provider || {}) : g.provider; }

    async function compute() {
      const provider = await load();
      state.provider = provider;
      state.packages = await SW.listPackages(opts.providerId, { q: state.q, categoryId: state.categoryId });
      state.deployments = await SW.deployments(opts.providerId);
      state.licenses = await SW.listLicenses(opts.providerId);
      state.coverage = await SW.coverage(opts.providerId);
      state.assignmentRows = await SW.assignmentRows(opts.providerId);
      state.deviceRows = (await SW.deviceRows(opts.providerId, {})).rows || [];
      return provider;
    }

    function statCards() {
      const cov = asObj(state.coverage);
      const titles = asArr(cov.titles);
      const unsan = titles.filter((t) => !t.sanctioned).length;
      const deps = asArr(state.deployments);
      const active = deps.filter((d) => ["planned", "running"].indexOf(d.state) !== -1).length;
      const missing = asArr(state.deviceRows).reduce((a, d) => a + num(d.missingCount, 0), 0);
      return ui.grid([
        ui.statCard({ label: "Packages", value: String(asArr(state.packages).length), sub: "deployable titles" }),
        ui.statCard({ label: "Installed titles", value: String(titles.length), sub: num(cov.catalog, 0) + " catalogued" }),
        ui.statCard({ label: "Coverage gaps", value: String(missing), tone: missing ? "warn" : "muted", sub: "catalogued, missing on devices" }),
        ui.statCard({ label: "Active runs", value: String(active), sub: deps.length + " deployment(s)" }),
        ui.statCard({ label: "Licences", value: String(asArr(state.licenses).length), sub: "tracked entitlements" }),
        ui.statCard({ label: "Unsanctioned", value: String(unsan), tone: unsan ? "warn" : "muted", sub: "uncatalogued software" }),
      ], "rmm-tri-metrics");
    }

    function catalogTab() {
      const cats = asArr(state.categories);
      const rows = asArr(state.packages).map((p) => ({
        name: "<b>" + esc(p.name) + "</b>" + (p.vendor ? '<div class="erp-sub">' + esc(p.vendor) + "</div>" : ""),
        version: esc(p.version || "—"),
        cat: esc(categoryLabel(p)),
        os: SW.OS_KEYS.filter((k) => SW.supportsOs(p, k)).map((k) => platformBadge(k)).join(" ") || '<span class="erp-sub">—</span>',
        detect: '<span class="erp-sub">' + esc(detectionSummary(p)) + "</span>",
        params: asArr(p.parameters).length ? badge(String(asArr(p.parameters).length), "info") : '<span class="erp-sub">—</span>',
        assign: asArr(p.assignments).length ? badge(String(asArr(p.assignments).length) + " assignment(s)", "info") : '<span class="erp-sub">none</span>',
        state: p.enabled ? badge("enabled", "success") : badge("disabled", "muted"),
        actions: ui.btn("Edit", { small: true, act: "sw-pkg-edit", arg: p.id }) + " " +
          ui.btn("Duplicate", { small: true, act: "sw-pkg-dup", arg: p.id }) + " " +
          ui.btn(p.enabled ? "Disable" : "Enable", { small: true, act: "sw-pkg-toggle", arg: p.id }) + " " +
          ui.btn("Delete", { small: true, danger: true, act: "sw-pkg-del", arg: p.id }),
      }));
      return '<div class="erp-inline-form rmm-patch-filters">' +
        '<div class="field" style="flex:1 1 200px"><label>Search</label><input type="text" name="sw_q" value="' + esc(state.q) + '" placeholder="package, vendor, tag…"></div>' +
        '<div class="field"><label>Category</label><select name="sw_cat"><option value="">All</option>' + cats.map((c) => '<option value="' + esc(c.id) + '"' + (state.categoryId === c.id ? " selected" : "") + ">" + esc(c.label || c.id) + "</option>").join("") + "</select></div>" +
        "</div>" +
        ui.card("Software catalog (" + rows.length + ")", ui.table([
          { key: "name", label: "Package", render: (r) => r.name },
          { key: "version", label: "Version", render: (r) => r.version },
          { key: "cat", label: "Category", render: (r) => r.cat },
          { key: "os", label: "Platforms", render: (r) => r.os },
          { key: "detect", label: "Detection", render: (r) => r.detect },
          { key: "params", label: "Params", render: (r) => r.params },
          { key: "assign", label: "Assignments", render: (r) => r.assign },
          { key: "state", label: "State", render: (r) => r.state },
          { key: "actions", label: "", render: (r) => r.actions },
        ], rows, { scroll: true, emptyText: "No software packages yet." }), { actions: ui.btn("New package", { small: true, primary: true, act: "sw-pkg-new" }) });
    }

    function categoryLabel(p) {
      const c = asArr(state.categories).find((x) => String(x.id) === String(p.categoryId));
      return c ? (c.label || c.id) : (p.categoryId || "—");
    }

    function detectionSummary(p) {
      const det = SW.effectiveDetection(p, null);
      const rules = asArr(det.rules);
      if (!rules.length) return "—";
      return rules.map((r) => SW.DETECT_FIELD_LABEL[r.field] + " " + (SW.DETECT_OP_LABEL[r.op] || r.op) + (r.value ? " " + r.value : "")).join(det.match === "any" ? " OR " : " AND ");
    }

    function deployTab() {
      const plan = asObj(state.plan);
      const totals = asObj(plan.totals);
      const devs = asArr(plan.devices).filter((d) => asArr(d.items).length || asArr(d.blocked).length || asArr(d.skipped).length);
      const rows = devs.map((d) => ({
        device: "<b>" + esc(d.hostname) + '</b><div class="erp-sub">' + esc(d.osFamily || "") + "</div>",
        ready: asArr(d.items).length ? asArr(d.items).map((i) => badge((SW.ACTION_LABEL[i.action] || i.action) + " " + esc(i.name), SW.actionTone(i.action))).join(" ") : '<span class="erp-sub">—</span>',
        skip: asArr(d.skipped).length ? asArr(d.skipped).map((i) => badge(esc(i.name) + " · " + esc(i.reason || "skip"), "muted")).join(" ") : '<span class="erp-sub">—</span>',
        blocked: asArr(d.blocked).length ? asArr(d.blocked).map((i) => badge(esc(i.name) + " · " + esc(i.reason || "blocked"), "warn")).join(" ") : '<span class="erp-sub">—</span>',
      }));
      const ready = num(totals.withWork, 0);
      const picker = '<div class="erp-inline-form rmm-patch-filters">' +
        '<div class="field" style="flex:1 1 220px"><label>Package</label><select name="sw_pick">' + asArr(state.packages).map((p) => '<option value="' + esc(p.id) + '"' + (state.pickPackage === p.id ? " selected" : "") + ">" + esc(p.name) + (p.version ? " " + esc(p.version) : "") + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Action</label><select name="sw_action">' + SW.ACTIONS.map((a) => '<option value="' + a + '"' + (state.pickAction === a ? " selected" : "") + ">" + esc(SW.ACTION_LABEL[a]) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label>Target version</label><input type="text" name="sw_version" value="' + esc(state.pickVersion) + '" placeholder="package version"></div>' +
        '<div class="field"><label>If installed</label><select name="sw_enforce"><option value="skip-installed"' + (state.enforcement === "skip-installed" ? " selected" : "") + ">Skip</option><option value=\"enforce\"" + (state.enforcement === "enforce" ? " selected" : "") + ">Reinstall anyway</option></select></div>" +
        '<div class="field"><label>Targets</label><select name="sw_target_mode">' + [["all", "Whole fleet"], ["groupIds", "Device groups"], ["tags", "Tags"], ["deviceIds", "Specific devices"]].map((m) => '<option value="' + m[0] + '"' + (state.target.mode === m[0] ? " selected" : "") + ">" + m[1] + "</option>").join("") + "</select></div>" +
        (state.target.mode === "groupIds" ? '<div class="field" style="flex:1 1 200px"><label>Group ids</label><input type="text" name="sw_groupIds" value="' + esc(state.target.groupIds) + '" placeholder="comma-separated"></div>' : "") +
        (state.target.mode === "tags" ? '<div class="field" style="flex:1 1 200px"><label>Tags</label><input type="text" name="sw_tags" value="' + esc(state.target.tags) + '" placeholder="comma-separated"></div>' : "") +
        (state.target.mode === "deviceIds" ? '<div class="field" style="flex:1 1 200px"><label>Device ids</label><input type="text" name="sw_deviceIds" value="' + esc(state.target.deviceIds) + '" placeholder="comma-separated"></div>' : "") +
        '<div class="field" style="flex:0 0 auto;align-self:flex-end">' + ui.btn("Preview plan", { small: true, act: "sw-plan" }) + " " + ui.btn("Deploy (" + ready + ")", { small: true, primary: true, disabled: !ready, act: "sw-deploy" }) + "</div>" +
        "</div>";
      const deps = asArr(state.deployments).map((d) => {
        const s = asObj(d.summary);
        return {
          name: "<b>" + esc(d.name) + '</b><div class="erp-sub">' + esc(ui.dateTime(d.at)) + " · " + esc(d.createdBy || "") + "</div>",
          state: deployBadge(d.state),
          devices: String(num(s.devices, 0)),
          progress: badge(num(s.installed, 0) + " installed", "success") + " " + badge(num(s.failed, 0) + " failed", num(s.failed, 0) ? "danger" : "muted") + " " + badge(num(s.pending, 0) + " pending", "info") + (num(s.blocked, 0) ? " " + badge(num(s.blocked, 0) + " blocked", "warn") : ""),
          actions: ui.btn("Reconcile", { small: true, act: "sw-dep-reconcile", arg: d.id }) + " " + ui.btn("View", { small: true, act: "sw-dep-view", arg: d.id }),
        };
      });
      const assignRows = asArr(state.assignmentRows).map((a) => ({
        pkg: "<b>" + esc(a.packageName) + "</b>", action: actionBadge(a.action), scope: esc(a.scope),
        devices: String(num(a.devices, 0)), installed: String(num(a.installed, 0)),
        missing: num(a.missing, 0) ? badge(String(num(a.missing, 0)), "warn") : "0",
        pending: num(a.pending, 0) ? badge(String(num(a.pending, 0)), "info") : "0",
        failed: num(a.failed, 0) ? badge(String(num(a.failed, 0)), "danger") : "0",
        state: a.compliant ? badge("compliant", "success") : badge("not compliant", "warn"),
        actions: ui.btn("Unassign", { small: true, act: "sw-assign-del", arg: a.packageId + "|" + a.assignmentId }),
      }));
      return statCards() + ui.card("Assignment compliance (" + assignRows.length + ")", ui.table([
        { key: "pkg", label: "Package", render: (r) => r.pkg }, { key: "action", label: "Action", render: (r) => r.action },
        { key: "scope", label: "Targets", render: (r) => r.scope }, { key: "devices", label: "Devices", render: (r) => r.devices },
        { key: "installed", label: "Installed", render: (r) => r.installed }, { key: "missing", label: "Missing", render: (r) => r.missing },
        { key: "pending", label: "Pending", render: (r) => r.pending }, { key: "failed", label: "Failed", render: (r) => r.failed },
        { key: "state", label: "State", render: (r) => r.state }, { key: "actions", label: "", render: (r) => r.actions },
      ], assignRows, { scroll: true, emptyText: "No package assignments yet — edit a package to assign it." }), { actions: ui.btn("Assign a package", { small: true, act: "sw-assign-new" }) }) +
        ui.card("Deployment plan", picker + ui.table([
          { key: "device", label: "Device", render: (r) => r.device },
          { key: "ready", label: "Will run", render: (r) => r.ready },
          { key: "skip", label: "Skipped (already installed)", render: (r) => r.skip },
          { key: "blocked", label: "Held back", render: (r) => r.blocked },
        ], rows, { scroll: true, emptyText: "Preview a plan to see what will run." })) +
        ui.card("Deployments (" + deps.length + ")", ui.table([
          { key: "name", label: "Run", render: (r) => r.name }, { key: "state", label: "State", render: (r) => r.state },
          { key: "devices", label: "Devices", render: (r) => r.devices }, { key: "progress", label: "Progress", render: (r) => r.progress },
          { key: "actions", label: "", render: (r) => r.actions },
        ], deps, { scroll: true, emptyText: "No deployments yet." }));
    }

    function inventoryTab() {
      const rows = asArr(state.deviceRows).map((d) => ({
        device: "<b>" + esc(d.hostname) + '</b><div class="erp-sub">' + esc(d.siteName || "") + (asArr(d.groupNames).length ? " · " + esc(asArr(d.groupNames).join(", ")) : "") + "</div>",
        os: esc(d.osFamily || "—"),
        titles: String(num(d.softwareCount, 0)),
        catalogued: String(num(d.installedCount, 0)) + " / " + String(num(d.catalogSize, 0)),
        missing: num(d.missingCount, 0) ? badge(String(num(d.missingCount, 0)), "warn") : "0",
        last: d.lastDeployAt ? esc(ui.dateTime(d.lastDeployAt)) + " " + (d.deployState ? badge(d.deployState, SW.stateTone(d.deployState)) : "") : '<span class="erp-sub">—</span>',
        actions: ui.btn("View", { small: true, act: "sw-dev-view", arg: d.deviceId }),
      }));
      const titles = asArr(asObj(state.coverage).titles).map((t) => ({
        name: "<b>" + esc(t.name) + "</b>", publisher: esc(t.publisher || "—"),
        devices: String(num(t.deviceCount, 0)), versions: esc(asArr(t.versions).join(", ") || "—"),
        coverage: asArr(t.coveredBy).length ? badge("packaged", "success") : (t.sanctioned ? badge("allowed", "info") : badge("unsanctioned", "warn")),
      }));
      return ui.card("Device software (" + rows.length + ")", ui.table([
        { key: "device", label: "Device", render: (r) => r.device }, { key: "os", label: "OS", render: (r) => r.os },
        { key: "titles", label: "Titles", render: (r) => r.titles }, { key: "catalogued", label: "Catalogued", render: (r) => r.catalogued },
        { key: "missing", label: "Missing", render: (r) => r.missing }, { key: "last", label: "Last deploy", render: (r) => r.last },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No devices." })) +
        ui.card("Installed software index (" + titles.length + ")", ui.table([
          { key: "name", label: "Title", render: (r) => r.name }, { key: "publisher", label: "Publisher", render: (r) => r.publisher },
          { key: "devices", label: "Devices", render: (r) => r.devices }, { key: "versions", label: "Versions", render: (r) => r.versions },
          { key: "coverage", label: "Coverage", render: (r) => r.coverage },
        ], titles, { scroll: true, emptyText: "No software inventory collected yet." }));
    }

    function licenseTab() {
      const rows = asArr(state.licenses).map((l) => ({
        title: "<b>" + esc(l.title) + "</b>" + (l.vendor ? '<div class="erp-sub">' + esc(l.vendor) + "</div>" : ""),
        metric: esc(l.metric), seats: String(num(l.seats, 0)), expires: l.expiresAt ? esc(ui.date(l.expiresAt)) : "—",
        pkg: esc((asArr(state.packages).find((p) => String(p.id) === String(l.packageId)) || {}).name || "—"),
        state: l.enabled ? badge("enabled", "success") : badge("disabled", "muted"),
        actions: ui.btn("Edit", { small: true, act: "sw-lic-edit", arg: l.id }) + " " + ui.btn("Delete", { small: true, danger: true, act: "sw-lic-del", arg: l.id }),
      }));
      const report = asObj(state.report);
      const body = state.report ? SW.renderReport(report) : '<p class="erp-sub">Reconcile licences against the installed base — usage, over-deployment, expiry and unsanctioned software — and export an inventory/licence report.</p>';
      return ui.card("Licences (" + rows.length + ")", ui.table([
        { key: "title", label: "Licence", render: (r) => r.title }, { key: "metric", label: "Metric", render: (r) => r.metric },
        { key: "pkg", label: "Package", render: (r) => r.pkg }, { key: "seats", label: "Seats", align: "right", render: (r) => r.seats },
        { key: "expires", label: "Expires", render: (r) => r.expires }, { key: "state", label: "State", render: (r) => r.state },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No licences tracked yet." }), { actions: ui.btn("New licence", { small: true, primary: true, act: "sw-lic-new" }) }) +
        ui.card("Licence & inventory reconciliation", body, { actions: ui.btn("Reconcile now", { small: true, primary: true, act: "sw-recon" }) + " " + ui.btn("Export report", { small: true, act: "sw-report-export" }) });
    }

    async function panelFor(tab) {
      if (!state.categories) state.categories = M && M.section ? await M.section("softwareCategories") : [];
      if (tab === "deploy") return deployTab();
      if (tab === "inventory") return inventoryTab();
      if (tab === "licenses") return licenseTab();
      return catalogTab();
    }

    async function paint() {
      await compute();
      const tabs = ui.tabs([
        { id: "catalog", label: "Software catalog", badge: String(asArr(state.packages).length) },
        { id: "deploy", label: "Deployment & detection", badge: asArr(state.deployments).filter((d) => ["planned", "running"].indexOf(d.state) !== -1).length ? String(asArr(state.deployments).filter((d) => ["planned", "running"].indexOf(d.state) !== -1).length) : null },
        { id: "inventory", label: "Inventory" },
        { id: "licenses", label: "Licences & reconciliation" },
      ], state.tab);
      const picker = asArr(opts.providers).length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="sw_pid">' + asArr(opts.providers).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === opts.providerId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = '<div class="rmm-software-inner">' + tabs.html + picker + "</div>";
      const panelEl = host.querySelector('.erp-tab-panel[data-panel="' + state.tab + '"]');
      if (panelEl) panelEl.innerHTML = '<div class="rmm-software-body">' + (await panelFor(state.tab)) + "</div>";
    }

    function splitCsv(v) { return String(v == null ? "" : v).split(",").map((s) => s.trim()).filter(Boolean); }

    /* The shared #uiModal element outlives its contents, so editor click
       handlers are tracked and replaced rather than stacked. */
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

    /* package editor */
    async function openPackageEditor(id) {
      const provider = await load();
      const isNew = id === "__new";
      const existing = isNew ? null : await SW.getPackage(opts.providerId, id);
      const draft = clone(existing || SW.normalizePackage({ name: "", vendor: "", version: "", variants: { windows: { install: "" } } }));
      draft.variants = draft.variants || {};
      const cats = asArr(state.categories).length ? state.categories : (M && M.section ? await M.section("softwareCategories") : []);

      function collect(m) {
        const c = ui.collect(m, ["p_name", "p_vendor", "p_categoryId", "p_description", "p_version", "p_previousVersion", "p_installType", "p_requiresReboot", "p_supportsDowngrade", "p_supportsRollback", "p_enabled", "p_tags"]);
        draft.name = c.p_name; draft.vendor = c.p_vendor; draft.categoryId = c.p_categoryId; draft.description = c.p_description;
        draft.version = c.p_version; draft.previousVersion = c.p_previousVersion; draft.installType = c.p_installType;
        draft.requiresReboot = c.p_requiresReboot; draft.supportsDowngrade = c.p_supportsDowngrade; draft.supportsRollback = c.p_supportsRollback;
        draft.enabled = c.p_enabled; draft.tags = splitCsv(c.p_tags);
        SW.OS_KEYS.forEach((k) => {
          const names = [k + "_language", k + "_installType", k + "_source", k + "_checksum", k + "_checksumAlgo", k + "_arguments", k + "_install", k + "_uninstall", k + "_update", k + "_rollback", k + "_detectCommand"];
          const c2 = ui.collect(m, names);
          const contentFields = [k + "_source", k + "_checksum", k + "_arguments", k + "_install", k + "_uninstall", k + "_update", k + "_rollback", k + "_detectCommand"];
          const has = contentFields.some((n) => (m.querySelector('[name="' + n + '"]') || {}).value);
          const lang = (m.querySelector('[name="' + k + '_language"]') || {});
          const reboot = (m.querySelector('[name="' + k + '_requiresReboot"]') || {});
          if (!has && !lang.value) { delete draft.variants[k]; return; }
          draft.variants[k] = {
            language: c2[k + "_language"], installType: c2[k + "_installType"], source: c2[k + "_source"],
            checksum: c2[k + "_checksum"], checksumAlgo: c2[k + "_checksumAlgo"], arguments: c2[k + "_arguments"],
            install: c2[k + "_install"], uninstall: c2[k + "_uninstall"], update: c2[k + "_update"], rollback: c2[k + "_rollback"],
            detectCommand: c2[k + "_detectCommand"], requiresReboot: reboot.checked,
          };
        });
        draft.detection = { match: (m.querySelector('[name="det_match"]') || {}).value || "all", rules: [] };
        Array.from(m.querySelectorAll("[data-det-rule]")).forEach((row, i) => {
          const field = (row.querySelector('[name="det_' + i + '_field"]') || {}).value;
          const op = (row.querySelector('[name="det_' + i + '_op"]') || {}).value;
          const value = (row.querySelector('[name="det_' + i + '_value"]') || {}).value;
          if (field && op) draft.detection.rules.push({ field, op, value: value || "" });
        });
        draft.parameters = [];
        Array.from(m.querySelectorAll("[data-par-row]")).forEach((row, i) => {
          const name = (row.querySelector('[name="par_' + i + '_name"]') || {}).value;
          if (!name) return;
          draft.parameters.push({
            name, label: (row.querySelector('[name="par_' + i + '_label"]') || {}).value,
            type: (row.querySelector('[name="par_' + i + '_type"]') || {}).value,
            required: !!(row.querySelector('[name="par_' + i + '_required"]') || {}).checked,
            default: (row.querySelector('[name="par_' + i + '_default"]') || {}).value,
            options: splitCsv((row.querySelector('[name="par_' + i + '_options"]') || {}).value),
            description: (row.querySelector('[name="par_' + i + '_description"]') || {}).value,
          });
        });
      }

      function variantBlock(k) {
        const v = asObj(draft.variants[k]);
        const cmds = [
          ["install", "Install command template"], ["uninstall", "Uninstall command template"],
          ["update", "Update command template"], ["rollback", "Rollback command template"],
        ];
        return '<div class="erp-card rmm-sw-variant" style="margin:8px 0"><h4 class="rmm-section-title">' + esc(famLabel(k)) + "</h4>" +
          '<div class="rmm-patch-grid">' +
          ui.select(k + "_language", "Language", [{ value: "", label: "Auto (" + esc(langFor(k)) + ")" }, { value: "powershell", label: "PowerShell" }, { value: "cmd", label: "cmd" }, { value: "bash", label: "Bash" }, { value: "sh", label: "POSIX sh" }], v.language || "") +
          ui.select(k + "_installType", "Installer type", [{ value: "", label: "—" }].concat(SW.INSTALL_TYPES.map((x) => ({ value: x, label: x }))), v.installType || "") +
          ui.text(k + "_source", "Source location", v.source || "", "https:// or \\\\share\\file  ({{source}})") +
          ui.text(k + "_checksum", "Checksum", v.checksum || "", "hex digest; verified before running") +
          ui.select(k + "_checksumAlgo", "Checksum algorithm", SW.CHECKSUM_ALGOS.map((x) => ({ value: x, label: x })), v.checksumAlgo || "sha256") +
          ui.text(k + "_arguments", "Silent args", v.arguments || "", "/qn /norestart ({{arguments}})") +
          "</div>" +
          ui.check(k + "_requiresReboot", "Requires a reboot", v.requiresReboot === true) +
          cmds.map(([key, label]) => ui.textarea(k + "_" + key, label, v[key] || "", 2)).join("") +
          ui.textarea(k + "_detectCommand", "Detection command (optional, agent-side)", v.detectCommand || "", 2) +
          "</div>";
      }

      function detectionRows() {
        return asArr(draft.detection.rules).map((r, i) =>
          '<tr data-det-rule><td><select name="det_' + i + '_field">' + SW.DETECT_FIELDS.map((f) => '<option value="' + f + '"' + (r.field === f ? " selected" : "") + ">" + esc(SW.DETECT_FIELD_LABEL[f]) + "</option>").join("") + "</select></td>" +
          '<td><select name="det_' + i + '_op">' + SW.DETECT_OPS.map((o) => '<option value="' + o + '"' + (r.op === o ? " selected" : "") + ">" + esc(SW.DETECT_OP_LABEL[o]) + "</option>").join("") + "</select></td>" +
          '<td><input type="text" name="det_' + i + '_value" value="' + esc(r.value) + '"></td>' +
          '<td>' + ui.btn("×", { small: true, act: "sw-det-del", arg: String(i) }) + "</td></tr>").join("");
      }

      function parameterRows() {
        return asArr(draft.parameters).map((p, i) =>
          '<tr data-par-row><td><input type="text" name="par_' + i + '_name" value="' + esc(p.name) + '" style="width:110px"></td>' +
          '<td><input type="text" name="par_' + i + '_label" value="' + esc(p.label) + '" style="width:120px"></td>' +
          '<td><select name="par_' + i + '_type">' + SW.PARAM_TYPES.map((t) => '<option value="' + t + '"' + (p.type === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select></td>" +
          '<td><input type="text" name="par_' + i + '_default" value="' + esc(p.default) + '" style="width:100px"></td>' +
          '<td><input type="text" name="par_' + i + '_options" value="' + esc(asArr(p.options).join(",")) + '" style="width:130px" placeholder="select options"></td>' +
          '<td><input type="checkbox" name="par_' + i + '_required"' + (p.required ? " checked" : "") + "></td>" +
          '<td><input type="text" name="par_' + i + '_description" value="' + esc(p.description) + '" style="width:140px"></td>' +
          '<td>' + ui.btn("×", { small: true, act: "sw-par-del", arg: String(i) }) + "</td></tr>").join("");
      }

      function body() {
        return ui.form(
          '<div class="rmm-patch-grid">' +
          ui.text("p_name", "Name", draft.name, "e.g. 7-Zip") +
          ui.text("p_vendor", "Vendor", draft.vendor, "e.g. Igor Pavlov") +
          ui.select("p_categoryId", "Category", cats.map((c) => ({ value: c.id, label: c.label || c.id })), draft.categoryId, "— uncategorised —") +
          ui.text("p_version", "Target version", draft.version, "1.0.0") +
          ui.text("p_previousVersion", "Previous version (rollback)", draft.previousVersion, "0.9.0") +
          ui.select("p_installType", "Default installer type", [{ value: "", label: "—" }].concat(SW.INSTALL_TYPES.map((x) => ({ value: x, label: x }))), draft.installType) +
          ui.text("p_tags", "Tags", asArr(draft.tags).join(", "), "comma-separated") +
          "</div>" +
          ui.textarea("p_description", "Description", draft.description, 2) +
          ui.check("p_requiresReboot", "Package requires a reboot", draft.requiresReboot) +
          ui.check("p_supportsDowngrade", "Allow downgrade to an earlier version", draft.supportsDowngrade) +
          ui.check("p_supportsRollback", "Allow rollback to the previous version", draft.supportsRollback) +
          ui.check("p_enabled", "Enabled", draft.enabled) +
          '<h4 class="rmm-section-head">Per-OS variants <span class="erp-sub">— templates support {{source}} {{installerPath}} {{tempDir}} {{params.NAME}}</span></h4>' +
          SW.OS_KEYS.map(variantBlock).join("") +
          '<h4 class="rmm-section-head">Detection rules <span class="erp-sub">— match the device\'s installed software; already-installed targets are skipped</span></h4>' +
          '<div class="erp-inline-form"><div class="field"><label>Combine rules with</label><select name="det_match"><option value="all"' + (draft.detection.match === "all" ? " selected" : "") + ">ALL (AND)</option><option value=\"any\"" + (draft.detection.match === "any" ? " selected" : "") + ">ANY (OR)</option></select></div><div class=\"field\" style=\"align-self:flex-end\">" + ui.btn("Add rule", { small: true, act: "sw-det-add" }) + "</div></div>" +
          '<div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Field</th><th>Operator</th><th>Value</th><th></th></tr></thead><tbody>' + detectionRows() + "</tbody></table></div>" +
          '<h4 class="rmm-section-head">Parameters <span class="erp-sub">— validated before use</span></h4>' +
          '<div class="field" style="align-self:flex-start">' + ui.btn("Add parameter", { small: true, act: "sw-par-add" }) + "</div>" +
          '<div class="erp-table-wrap"><table class="erp-table"><thead><tr><th>Name</th><th>Label</th><th>Type</th><th>Default</th><th>Options</th><th>Req</th><th>Description</th><th></th></tr></thead><tbody>' + parameterRows() + "</tbody></table></div>",
          ui.btn("Save", { primary: true, act: "sw-pkg-save", arg: isNew ? "__new" : draft.id }) + " " + ui.btn("Cancel", { act: "sw-cancel" })
        );
      }

      function mount() {
        ui.modal({ title: (isNew ? "New software package" : "Edit " + draft.name), size: "lg", body: body() });
        bindModal(async (e) => {
          const t = e.target.closest && e.target.closest("[data-act]");
          if (!t) return;
          const act = t.getAttribute("data-act");
          const m = document.querySelector("#uiModal");
          if (!m) return;
          if (act === "sw-cancel") { unbindModal(); return ui.closeModal(); }
          if (act === "sw-det-add") { collect(m); draft.detection.rules.push({ field: "name", op: "contains", value: "" }); return mount(); }
          if (act === "sw-det-del") { collect(m); draft.detection.rules.splice(Number(t.getAttribute("data-arg")), 1); return mount(); }
          if (act === "sw-par-add") { collect(m); draft.parameters.push({ name: "", label: "", type: "text", required: false, default: "", options: [] }); return mount(); }
          if (act === "sw-par-del") { collect(m); draft.parameters.splice(Number(t.getAttribute("data-arg")), 1); return mount(); }
          if (act === "sw-pkg-save") {
            collect(m);
            const r = isNew ? await SW.addPackage(opts.providerId, draft) : await SW.updatePackage(opts.providerId, draft.id, draft);
            if (r.error) return toast("Failed: " + (r.errors ? r.errors.join("; ") : r.error), "error");
            unbindModal();
            ui.closeModal();
            toast(isNew ? "Package created" : "Package saved");
            return paint();
          }
        });
      }
      mount();
    }

    async function openAssignmentEditor() {
      const provider = await load();
      const pkgs = asArr(state.packages);
      if (!pkgs.length) return toast("Create a package first", "error");
      const groups = asArr(provider.deviceGroups).map((g) => ({ value: g.id, label: g.name || g.id }));
      const body = ui.form(
        ui.select("a_pkg", "Package", pkgs.map((p) => ({ value: p.id, label: p.name })), state.pickPackage || pkgs[0].id) +
        '<div class="rmm-patch-grid">' +
        ui.select("a_action", "Action", SW.ACTIONS.map((a) => ({ value: a, label: SW.ACTION_LABEL[a] })), "install") +
        ui.text("a_version", "Target version", "", "blank = package version") +
        ui.select("a_enforcement", "If installed", [{ value: "skip-installed", label: "Skip" }, { value: "enforce", label: "Reinstall anyway" }], "skip-installed") +
        "</div>" +
        '<div class="rmm-patch-grid">' +
        ui.check("a_all", "Every device in the client", false) +
        ui.select("a_group", "Device group", [{ value: "", label: "— none —" }].concat(groups), "") +
        ui.text("a_tags", "Tags", "", "comma-separated") +
        ui.text("a_sites", "Site ids", "", "comma-separated") +
        ui.text("a_devices", "Device ids", "", "comma-separated") +
        "</div>" +
        ui.textarea("a_note", "Note", "", 2),
        ui.btn("Assign", { primary: true, act: "sw-assign-save" }) + " " + ui.btn("Cancel", { act: "sw-cancel" })
      );
      ui.modal({ title: "Assign a package", size: "lg", body });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sw-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sw-assign-save") {
          const c = ui.collect(m, ["a_pkg", "a_action", "a_version", "a_enforcement", "a_all", "a_group", "a_tags", "a_sites", "a_devices", "a_note"]);
          const targets = { all: c.a_all, groupIds: c.a_group ? [c.a_group] : [], tags: splitCsv(c.a_tags), siteIds: splitCsv(c.a_sites), deviceIds: splitCsv(c.a_devices) };
          if (!targets.all && !targets.groupIds.length && !targets.tags.length && !targets.siteIds.length && !targets.deviceIds.length) return toast("Choose at least one target", "error");
          const r = await SW.assignPackage(opts.providerId, c.a_pkg, { targets, action: c.a_action, targetVersion: c.a_version, enforcement: c.a_enforcement, note: c.a_note });
          if (r.error) return toast("Failed: " + r.error, "error");
          unbindModal(); ui.closeModal(); toast("Assigned"); return paint();
        }
      });
    }

    async function openLicenseEditor(id) {
      const isNew = id === "__new";
      const lic = isNew ? SW.normalizeLicense({}) : await SW.getLicense(opts.providerId, id);
      if (!lic) return;
      const body = ui.form(
        '<div class="rmm-patch-grid">' +
        ui.text("l_title", "Title", lic.title, "e.g. 1Password Business") +
        ui.text("l_vendor", "Vendor", lic.vendor, "e.g. AgileBits") +
        ui.select("l_packageId", "Catalog package", [{ value: "", label: "— none —" }].concat(asArr(state.packages).map((p) => ({ value: p.id, label: p.name }))), lic.packageId) +
        ui.select("l_metric", "Metric", [{ value: "per-device", label: "Per device" }, { value: "per-user", label: "Per user" }, { value: "subscription", label: "Subscription" }, { value: "site", label: "Per site" }], lic.metric) +
        ui.number("l_seats", "Seats", lic.seats, { min: 0 }) +
        ui.number("l_seatsUsed", "Override used", lic.seatsUsed == null ? "" : lic.seatsUsed, { min: 0, hint: "blank = reconcile from inventory" }) +
        ui.dateInput("l_expiresAt", "Expires", lic.expiresAt ? String(lic.expiresAt).slice(0, 10) : "") +
        ui.dateInput("l_purchasedAt", "Purchased", lic.purchasedAt ? String(lic.purchasedAt).slice(0, 10) : "") +
        ui.number("l_unitCost", "Unit cost", lic.unitCost) +
        ui.text("l_currency", "Currency", lic.currency) +
        "</div>" +
        ui.check("l_enabled", "Enabled", lic.enabled) +
        ui.textarea("l_notes", "Notes", lic.notes, 2),
        ui.btn("Save", { primary: true, act: "sw-lic-save", arg: isNew ? "__new" : lic.id }) + " " + ui.btn("Cancel", { act: "sw-cancel" })
      );
      ui.modal({ title: isNew ? "New licence" : "Edit " + lic.title, size: "lg", body });
      bindModal(async (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const m = document.querySelector("#uiModal");
        if (!m) return;
        if (act === "sw-cancel") { unbindModal(); return ui.closeModal(); }
        if (act === "sw-lic-save") {
          const c = ui.collect(m, ["l_title", "l_vendor", "l_packageId", "l_metric", "l_seats", "l_seatsUsed", "l_expiresAt", "l_purchasedAt", "l_unitCost", "l_currency", "l_enabled", "l_notes"]);
          c.l_expiresAt = c.l_expiresAt ? new Date(c.l_expiresAt + "T00:00:00").toISOString() : "";
          c.l_purchasedAt = c.l_purchasedAt ? new Date(c.l_purchasedAt + "T00:00:00").toISOString() : "";
          const r = isNew ? await SW.addLicense(opts.providerId, c) : await SW.updateLicense(opts.providerId, lic.id, c);
          if (r.error) return toast("Failed: " + (r.errors ? r.errors.join("; ") : r.error), "error");
          unbindModal(); ui.closeModal(); toast("Licence saved"); return paint();
        }
      });
    }

    async function openDevice(deviceId) {
      const provider = await load();
      const dev = asArr(provider.devices).map(D.normalizeDevice).find((d) => String(d.id) === String(deviceId));
      if (!dev) return;
      const sec = await SW.deviceSection(dev, opts.providerId);
      ui.modal({ title: "Software · " + (dev.hostname || dev.id), size: "lg", body: sec });
    }

    async function openDeployment(id) {
      const dep = await SW.deployment(opts.providerId, id);
      if (!dep) return toast("Deployment not found", "error");
      const s = asObj(dep.summary);
      const kv = (k, v) => '<div class="rmm-kv-row"><span>' + esc(k) + "</span><b>" + v + "</b></div>";
      const headers = '<div class="rmm-kv">' +
        kv("State", deployBadge(dep.state)) + kv("Started", esc(ui.dateTime(dep.at))) + kv("By", esc(dep.createdBy || "—")) +
        kv("Devices", String(num(s.devices, 0))) + kv("Installed", String(num(s.installed, 0))) +
        kv("Failed", String(num(s.failed, 0))) + kv("Pending", String(num(s.pending, 0))) + kv("Skipped", String(num(s.skipped, 0))) +
        "</div>";
      const cards = Object.keys(asObj(dep.targets)).map((devId) => {
        const t = asObj(dep.targets)[devId];
        const rows = asArr(t.packages).map((p) => ({
          pkg: "<b>" + esc(p.name || p.packageId) + "</b>",
          action: actionBadge(p.action), state: stateBadge(p.state),
          from: esc(p.fromVersion || "—"), to: esc(p.toVersion || "—"), tries: String(num(p.attempts, 0)),
          note: p.error ? '<span class="erp-sub">' + esc(p.error) + "</span>" : (p.completedAt ? '<span class="erp-sub">' + esc(ui.dateTime(p.completedAt)) + "</span>" : '<span class="erp-sub">—</span>'),
        }));
        const head = '<div class="rmm-status-line">' + deployBadge(t.state) + (t.jobId ? ' <span class="erp-sub">job ' + esc(t.jobId) + "</span>" : "") + "</div>";
        return ui.card(esc(t.hostname || devId), head + ui.table([
          { key: "pkg", label: "Package", render: (r) => r.pkg }, { key: "action", label: "Action", render: (r) => r.action },
          { key: "state", label: "Result", render: (r) => r.state }, { key: "from", label: "From", render: (r) => r.from },
          { key: "to", label: "To", render: (r) => r.to }, { key: "tries", label: "Tries", render: (r) => r.tries },
          { key: "note", label: "Detail", render: (r) => r.note },
        ], rows, { scroll: true }));
      }).join("");
      ui.modal({ title: dep.name, size: "lg", body: '<div class="rmm-software-report">' + headers + '<div class="rmm-patch-deploy-targets">' + cards + "</div></div>" });
    }

    /* The plan controls are a mix of persisted state and uncontrolled
       inputs; read the live DOM values so Preview/Deploy reflect what the
       user actually sees (state.pickPackage stays "" until an interaction). */
    function buildPlanOpts() {
      const q = (n) => { const el = host.querySelector('[name="' + n + '"]'); return el ? el.value : ""; };
      const targets = {};
      const mode = q("sw_target_mode") || state.target.mode;
      if (mode === "groupIds") targets.groupIds = splitCsv(q("sw_groupIds"));
      else if (mode === "tags") targets.tags = splitCsv(q("sw_tags"));
      else if (mode === "deviceIds") targets.deviceIds = splitCsv(q("sw_deviceIds"));
      else targets.all = true;
      const pick = q("sw_pick") || state.pickPackage;
      return {
        targets, packageIds: pick ? [pick] : [], action: q("sw_action") || state.pickAction,
        targetVersion: q("sw_version"), enforcement: q("sw_enforce") || state.enforcement, pick,
      };
    }

    async function buildPlan() {
      const o = buildPlanOpts();
      state.planOpts = o;
      return SW.plan(opts.providerId, o);
    }

    ui.bind(host, "change", "[name='sw_pid']", (t) => { opts.providerId = t.value; if (opts.onProvider) opts.onProvider(t.value); paint(); });
    ui.bind(host, "change", "[name='sw_cat']", (t) => { state.categoryId = t.value; paint(); });
    ui.bind(host, "change", "[name='sw_pick']", (t) => { state.pickPackage = t.value; });
    ui.bind(host, "change", "[name='sw_action']", (t) => { state.pickAction = t.value; });
    ui.bind(host, "change", "[name='sw_enforce']", (t) => { state.enforcement = t.value; });
    ui.bind(host, "change", "[name='sw_target_mode']", (t) => { state.target.mode = t.value; paint(); });
    host.addEventListener("input", (e) => {
      const n = e.target && e.target.name;
      if (n === "sw_q") state.q = e.target.value;
      else if (n === "sw_version") state.pickVersion = e.target.value;
      else if (n === "sw_groupIds") state.target.groupIds = e.target.value;
      else if (n === "sw_tags") state.target.tags = e.target.value;
      else if (n === "sw_deviceIds") state.target.deviceIds = e.target.value;
    });
    host.addEventListener("keyup", (e) => { if (e.target && e.target.name === "sw_q" && e.key === "Enter") paint(); });
    ui.bind(host, "click", "[data-tab]", (t) => { const id = t.getAttribute("data-tab"); if (["catalog", "deploy", "inventory", "licenses"].indexOf(id) !== -1) { state.tab = id; paint(); } });
    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      e.preventDefault();
      if (act === "sw-pkg-new") return openPackageEditor("__new");
      if (act === "sw-pkg-edit") return openPackageEditor(arg);
      if (act === "sw-pkg-dup") { const r = await SW.duplicatePackage(opts.providerId, arg); if (r.error) return toast("Failed: " + r.error, "error"); toast("Duplicated"); return paint(); }
      if (act === "sw-pkg-toggle") { const p = await SW.getPackage(opts.providerId, arg); const r = await SW.setPackageEnabled(opts.providerId, arg, !(p && p.enabled)); if (r.error) return toast("Failed: " + r.error, "error"); toast("Updated"); return paint(); }
      if (act === "sw-pkg-del") {
        const ok = await ERP.ui.confirm({ title: "Delete package?", message: "This removes it from the catalog. Deployments already made are unaffected.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await SW.removePackage(opts.providerId, arg);
        if (r.error) return toast("Failed: " + r.error, "error");
        toast("Deleted"); return paint();
      }
      if (act === "sw-assign-new") return openAssignmentEditor();
      if (act === "sw-assign-del") { const parts = String(arg).split("|"); const r = await SW.removeAssignment(opts.providerId, parts[0], parts[1]); if (r.error) return toast("Failed: " + r.error, "error"); toast("Unassigned"); return paint(); }
      if (act === "sw-plan") { const plan = await buildPlan(); if (plan.error) return toast("Failed: " + (plan.message || plan.error), "error"); state.plan = plan; toast(num(asObj(plan.totals).items, 0) + " action(s) across " + num(asObj(plan.totals).withWork, 0) + " device(s)"); return paint(); }
      if (act === "sw-deploy") {
        const plan = await buildPlan();
        if (plan.error) return toast("Failed: " + (plan.message || plan.error), "error");
        state.plan = plan;
        const t2 = asObj(plan.totals);
        if (!num(t2.items, 0)) { await paint(); return toast("Nothing to deploy — every target is already in the desired state", "error"); }
        const pickId = (state.planOpts && state.planOpts.pick) || state.pickPackage;
        const pkgName = (asArr(state.packages).find((p) => String(p.id) === String(pickId)) || {}).name || "package";
        const ok = await ERP.ui.confirm({ title: "Deploy " + pkgName + "?", message: "Run " + num(t2.items, 0) + " action(s) on " + num(t2.withWork, 0) + " device(s)? Agents run them on their next check-in.", okLabel: "Deploy", primary: true });
        if (!ok) return;
        const r = await SW.deploy(opts.providerId, { plan });
        if (r.error) return toast("Failed: " + (r.message || r.error), "error");
        const sm = asObj(r.deployment.summary);
        toast("Deployment started — " + num(sm.packages, 0) + " action(s) across " + num(sm.devices, 0) + " device(s)");
        return paint();
      }
      if (act === "sw-dep-reconcile") { const r = await SW.reconcileDeployment(opts.providerId, arg, { force: true }); if (r.error) return toast("Failed: " + r.error, "error"); toast(r.changed ? ("Reconciled" + (asArr(r.retried).length ? " — " + asArr(r.retried).length + " retry job(s) queued" : "")) : "Nothing to reconcile yet"); return paint(); }
      if (act === "sw-dep-view") return openDeployment(arg);
      if (act === "sw-dev-view") return openDevice(arg);
      if (act === "sw-lic-new") return openLicenseEditor("__new");
      if (act === "sw-lic-edit") return openLicenseEditor(arg);
      if (act === "sw-lic-del") {
        const ok = await ERP.ui.confirm({ title: "Delete licence?", message: "This cannot be undone.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await SW.removeLicense(opts.providerId, arg);
        if (r.error) return toast("Failed: " + r.error, "error");
        toast("Deleted"); return paint();
      }
      if (act === "sw-recon") { const r = await SW.reconcile(opts.providerId); if (r.error) return toast("Failed: " + r.error, "error"); state.report = r; toast("Reconciled " + num(asObj(r.totals).licenses, 0) + " licence(s)"); return paint(); }
      if (act === "sw-report-export") {
        const r = state.report || await SW.reconcile(opts.providerId);
        if (r.error) return toast("Failed: " + r.error, "error");
        state.report = r;
        const fname = "software-licences-" + String(r.providerName || r.providerId || "client").replace(/[^A-Za-z0-9_-]/g, "-") + "-" + String(now()).slice(0, 10) + ".json";
        const ok = SW.download(fname, SW.exportReport(r));
        toast(ok ? "Report exported" : "Export failed", ok ? undefined : "error");
        return paint();
      }
    });

    await paint();
    SW.currentProviderId = opts.providerId;
    return state;
  };

  SW.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "rmm-software";
    host.appendChild(wrap);
    if (!providers.length) { wrap.innerHTML = ERP.ui.alert("No service providers yet.", "info"); return null; }
    const providerId = opts.providerId || providers[0].id;
    if (!opts.headHtml && !opts.embedded) wrap.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Software", "A deployable software catalog with silent install/uninstall/update templates, per-OS variants and detection rules, assignment to devices or groups, and licence reconciliation per client."));
    return SW.renderPanel(wrap, { providerId, providers, embedded: true, toast: opts.toast || (() => {}), onChange: opts.onChange, onProvider: opts.onProvider });
  };

  SW.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const pid = (SW.currentProviderId && providers.some((p) => p.id === SW.currentProviderId)) ? SW.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-software";
    el.innerHTML = "";
    el.appendChild(root);
    root.insertAdjacentHTML("beforebegin", ERP.ui.pageHead("Software", "A deployable software catalog with silent install/uninstall/update templates, per-OS variants and detection rules, assignment to devices or groups, and licence reconciliation per client."));
    await SW.renderPanel(root, { providerId: pid, providers, embedded: true, toast: ctx.toast, onChange: () => SW.render(ctx) });
    return { pid };
  };

  /* ═══════════════════════ demo seed ═══════════════════════ */

  const DEMO_PACKAGES = [
    {
      id: "swpkg-demo-7zip", name: "7-Zip", vendor: "Igor Pavlov", categoryId: "sc-utility", version: "24.09", installType: "msi",
      description: "File archiver with a high compression ratio.",
      supportsDowngrade: true, supportsRollback: true,
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "7-Zip" }] },
      variants: {
        windows: { installType: "msi", source: "https://www.7-zip.org/a/7z2409-x64.msi", checksumAlgo: "sha256", arguments: "/qn /norestart", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn /norestart' -Wait", uninstall: "Start-Process msiexec.exe -ArgumentList '/x \\\"{{installerPath}}\\\" /qn' -Wait" },
        linux: { installType: "script", install: "apt-get install -y p7zip-full", uninstall: "apt-get remove -y p7zip-full" },
        macos: { installType: "script", install: "brew install p7zip", uninstall: "brew uninstall p7zip" },
      },
    },
    {
      id: "swpkg-demo-chrome", name: "Google Chrome", vendor: "Google", categoryId: "sc-browser", version: "126.0.6478.127", installType: "msi",
      description: "Enterprise-managed web browser.",
      parameters: [{ name: "masterPrefs", label: "Master preferences URL", type: "text", required: false, default: "", description: "Optional enterprise master_preferences file." }],
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Google Chrome" }, { field: "publisher", op: "contains", value: "Google" }] },
      variants: {
        windows: { installType: "msi", source: "https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi", checksumAlgo: "sha256", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn /norestart' -Wait" },
        linux: { installType: "deb", source: "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb", install: "dpkg -i \"{{installerPath}}\" || apt-get install -fy" },
        macos: { installType: "pkg", source: "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.pkg", install: "installer -pkg \"{{installerPath}}\" -target /" },
      },
    },
    {
      id: "swpkg-demo-vlc", name: "VLC media player", vendor: "VideoLAN", categoryId: "sc-productivity", version: "3.0.21", installType: "msi",
      description: "Cross-platform multimedia player.",
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "VLC" }] },
      variants: {
        windows: { installType: "msi", source: "https://get.videolan.org/vlc/3.0.21/win64/vlc-3.0.21-win64.msi", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn /norestart' -Wait" },
        linux: { installType: "script", install: "apt-get install -y vlc" },
        macos: { installType: "script", install: "brew install --cask vlc" },
      },
    },
    {
      id: "swpkg-demo-firefox", name: "Mozilla Firefox", vendor: "Mozilla", categoryId: "sc-browser", version: "127.0.1", installType: "msi",
      description: "Mozilla's web browser.",
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Firefox" }] },
      variants: {
        windows: { installType: "msi", source: "https://download.mozilla.org/?product=firefox-msi-latest-ssl&os=win64&lang=en-US", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn /norestart' -Wait" },
        linux: { installType: "script", install: "apt-get install -y firefox-esr" },
        macos: { installType: "script", install: "brew install --cask firefox" },
      },
    },
    {
      id: "swpkg-demo-1password", name: "1Password", vendor: "AgileBits", categoryId: "sc-security", version: "8.10.36", installType: "msi",
      description: "Password manager (licensed per user).",
      requiresReboot: false,
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "1Password" }] },
      variants: {
        windows: { installType: "msi", source: "https://downloads.1password.com/win/1PasswordSetup-latest.msi", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn' -Wait" },
        macos: { installType: "pkg", install: "brew install --cask 1password" },
      },
    },
    {
      id: "swpkg-demo-zoom", name: "Zoom Workplace", vendor: "Zoom", categoryId: "sc-communication", version: "6.0.11", installType: "msi",
      description: "Video conferencing client.",
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Zoom" }] },
      variants: {
        windows: { installType: "msi", source: "https://zoom.us/client/latest/ZoomInstallerFull.msi", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn /norestart' -Wait" },
        macos: { installType: "pkg", install: "brew install --cask zoom" },
      },
    },
    {
      id: "swpkg-demo-office", name: "Microsoft 365 Apps", vendor: "Microsoft", categoryId: "sc-productivity", version: "16.0.17328", installType: "exe",
      description: "Microsoft 365 Apps for enterprise (Office).",
      requiresReboot: true,
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Microsoft 365" }, { field: "publisher", op: "contains", value: "Microsoft" }] },
      variants: {
        windows: { installType: "exe", source: "https://officecdn.microsoft.com/db/492350f6-3a01-4f97-b9c0-c7c6ddf67d60/media/en-us/O365ProPlusRetail.img", install: "Start-Process setup.exe -ArgumentList '/configure {{params.configXml}}' -Wait" },
      },
      parameters: [{ name: "configXml", label: "Configuration XML path", type: "text", required: true, default: "\\\\fileserver\\share\\office365.xml", description: "Path to the Office Deployment Tool configuration." }],
    },
    {
      id: "swpkg-demo-adobe", name: "Adobe Acrobat Reader", vendor: "Adobe", categoryId: "sc-productivity", version: "24.002.20736", installType: "msi",
      description: "PDF reader (retired licence demo).",
      detection: { match: "any", rules: [{ field: "name", op: "contains", value: "Adobe Acrobat" }] },
      variants: {
        windows: { installType: "msi", source: "https://ardownload2.adobe.com/pub/adobe/reader/win/AcrobatDC/2400220736/AcroRdrDC2400220736_en_US.msi", install: "Start-Process msiexec.exe -ArgumentList '/i \\\"{{installerPath}}\\\" /qn' -Wait" },
      },
    },
  ];

  const DEMO_LICENSES = [
    { id: "swlic-demo-1p", title: "1Password Business", vendor: "AgileBits", packageId: "swpkg-demo-1password", metric: "per-user", seats: 25, expiresAt: "2027-03-31T00:00:00Z", unitCost: 7.99, currency: "USD" },
    { id: "swlic-demo-zoom", title: "Zoom Workplace Business", vendor: "Zoom", packageId: "swpkg-demo-zoom", metric: "per-device", seats: 50, expiresAt: "2026-12-31T00:00:00Z", unitCost: 13.99, currency: "USD" },
    { id: "swlic-demo-office", title: "Microsoft 365 Apps", vendor: "Microsoft", packageId: "swpkg-demo-office", metric: "per-device", seats: 40, expiresAt: "2027-01-31T00:00:00Z", unitCost: 22.0, currency: "USD" },
    { id: "swlic-demo-adobe", title: "Adobe Acrobat Pro", vendor: "Adobe", packageId: "swpkg-demo-adobe", metric: "per-device", seats: 5, expiresAt: "2025-01-31T00:00:00Z", unitCost: 14.99, currency: "USD" },
  ];

  async function seedDemoRun(opts) {
    opts = opts || {};
    if (!enabled() && !opts.force) return { skipped: true, reason: "software_disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };

    let g = await T.get(demo.id);
    let provider = g.error ? {} : g.provider;
    for (let i = 0; i < 16 && !asArr(provider.devices).length; i++) {
      await new Promise((res) => setTimeout(res, 300));
      g = await T.get(demo.id);
      if (!g.error) provider = g.provider;
    }

    const catalog = asArr(asObj(provider.softwareState).catalog);
    const already = catalog.filter((p) => String(p.id).indexOf("swpkg-demo-") === 0).length === DEMO_PACKAGES.length;
    if (already && !opts.force) return { skipped: true, reason: "software_demo_exists", providerId: demo.id };

    const at = now();
    const packages = DEMO_PACKAGES.map((p) => SW.normalizePackage(Object.assign({}, p, { enabled: true, createdAt: at, updatedAt: at })));
    packages[0].assignments = [normAssignment({ id: "swasg-demo-7zip", targets: { all: true }, action: "install", enforcement: "skip-installed", createdAt: at })];
    packages[1].assignments = [normAssignment({ id: "swasg-demo-chrome", targets: { groupIds: ["grp-demo-workstations"] }, action: "install", enforcement: "skip-installed", createdAt: at })];
    const licenses = DEMO_LICENSES.map((l) => SW.normalizeLicense(Object.assign({}, l, { enabled: true, createdAt: at, updatedAt: at })));

    let wrote = false;
    for (let attempt = 0; attempt < 6 && !wrote; attempt++) {
      const r = await T.update(demo.id, (p) => {
        p.softwareState = asObj(p.softwareState);
        let list = asArr(p.softwareState.catalog);
        const byId = {};
        list.forEach((x) => { byId[String(x.id)] = x; });
        packages.forEach((pkg) => { byId[String(pkg.id)] = clone(pkg); });
        p.softwareState.catalog = Object.keys(byId).map((k) => byId[k]);
        let lics = asArr(p.softwareState.licenses);
        const byL = {};
        lics.forEach((x) => { byL[String(x.id)] = x; });
        licenses.forEach((l) => { byL[String(l.id)] = clone(l); });
        p.softwareState.licenses = Object.keys(byL).map((k) => byL[k]);
        p.updatedAt = at;
      });
      if (!r.error) wrote = true; else await new Promise((res) => setTimeout(res, 50));
    }
    if (!wrote) return { error: "seed_write_failed", providerId: demo.id };
    SW.__seeded = { providerId: demo.id, at, packages: packages.length, licenses: licenses.length };
    return { providerId: demo.id, packages: packages.length, licenses: licenses.length };
  }

  SW.seedDemo = function (opts) {
    if (SW.__seedPromise) return SW.__seedPromise;
    SW.__seedPromise = seedDemoRun(opts).catch((e) => {
      console.error("software seed failed", e);
      return { error: "seed_failed", message: String((e && e.message) || e) };
    });
    const clear = () => { SW.__seedPromise = null; };
    SW.__seedPromise.then(clear, clear);
    return SW.__seedPromise;
  };

  /* ═══════════════════════ boot ═══════════════════════ */

  SW.renderPanelInto = SW.renderPanel;

  let readyResolve;
  SW.ready = new Promise((res) => { readyResolve = res; });
  SW.init = async function () { try { await T.ready; await SW.seedDemo(); } catch (e) { console.error("software seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", SW.init);
  else SW.init();
})();
