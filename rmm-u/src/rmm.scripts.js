/* ============================================================
   RMM-U — script & component library  (Phase 4 · Task 23)

   A reusable library of scripts and components stored on each
   provider aggregate in `provider.scriptLibrary`. A library script
   is not a blob of text: it is a versioned artefact with

     • typed parameters   string / number / bool / enum, each with a
                          label, required flag, default, and validation
                          constraints (enum options, regex pattern,
                          min/max, max length);
     • per-OS variants    windows / macos / linux / any — the library
                          picks the right variant for a device;
     • components         `{{component:id}}` includes another library
                          entry, with cycle detection and a size cap;
     • versions           a bounded snapshot history with restore.

   THE SAFETY RULE (the headline of Task 23): a library script can
   never be used to run unsafe input on an endpoint. Parameters are
   validated (type, required, enum, pattern, range, length) and then
   substituted ONLY as shell-escaped quoted literals — PowerShell
   `'…'` with `'`→`''`, POSIX `'…'` with `'`→`'\''`, cmd `"…"` with
   quote/`%` escaping. Unknown parameter tokens are refused rather
   than silently emitted. So a value like
       ; rm -rf /    or    '; Stop-Computer #
   becomes an inert quoted string, not a second command.

   window.ERP.scripts is both the service and the Script library
   console (standalone station or embedded in Automations).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.store || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const J = ERP.jobs || null;
  const M = ERP.masterConfig || null;
  const LIB = (ERP.scripts = {});

  LIB.PARAM_TYPES = ["string", "number", "bool", "enum"];
  LIB.OS = ["windows", "macos", "linux", "any"];
  LIB.KINDS = ["script", "component"];
  LIB.SCHEMA = "rmm-script/v1";
  LIB.BUNDLE_SCHEMA = "rmm-script-bundle/v1";

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
  const versionCap = () => Math.max(2, num(cfg("rmm.scriptVersionHistory", 10), 10));
  const depthCap = () => Math.max(1, num(cfg("rmm.scriptMaxComponentDepth", 4), 4));
  const sizeCap = () => Math.max(4096, num(cfg("rmm.scriptComponentMaxBytes", 262144), 262144));

  const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  const TOKEN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const INCLUDE = /\{\{\s*component\s*:\s*([a-zA-Z0-9_\-]+)\s*\}\}/g;

  /* ═══════════════════════ escaping (the safety core) ═══════════════════════ */

  LIB.shellForLanguage = function (language) {
    const l = low(language);
    if (l === "powershell" || l === "ps1" || l === "pwsh") return "powershell";
    if (l === "cmd" || l === "batch" || l === "bat") return "cmd";
    if (l === "bash" || l === "sh" || l === "posix" || l === "zsh") return "bash";
    if (l === "python" || l === "py") return "python";
    return "generic";
  };

  /* A parameter value → one inert, quoted literal for the target shell. */
  LIB.safeLiteral = function (value, shell) {
    const s = value == null ? "" : String(value);
    const sh = low(shell);
    if (sh === "powershell") return "'" + s.replace(/'/g, "''") + "'";
    if (sh === "cmd") return '"' + s.replace(/"/g, '""').replace(/%/g, "%%") + '"';
    if (sh === "bash") return "'" + s.replace(/'/g, "'\\''") + "'";
    if (sh === "python") return JSON.stringify(s);
    return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  };
  LIB.escapeArg = LIB.safeLiteral;

  /* ═══════════════════════ normalisation ═══════════════════════ */

  function normalizeParameter(raw) {
    raw = asObj(raw);
    let name = String(raw.name || "").trim();
    if (!IDENT.test(name)) name = ("p_" + name.replace(/[^a-zA-Z0-9_]/g, "")).slice(0, 40) || "p";
    const type = LIB.PARAM_TYPES.indexOf(raw.type) !== -1 ? raw.type : "string";
    return {
      name,
      label: S(raw.label, 80) || name,
      type,
      required: !!raw.required,
      default: raw.default === undefined ? (type === "bool" ? false : type === "number" ? "" : "") : raw.default,
      options: type === "enum" ? asArr(raw.options).map((o) => S(o, 80)).filter(Boolean) : [],
      pattern: type === "string" ? S(raw.pattern, 200) : "",
      min: type === "number" && raw.min != null && raw.min !== "" ? num(raw.min, 0) : null,
      max: type === "number" && raw.max != null && raw.max !== "" ? num(raw.max, 0) : null,
      maxLength: type === "string" && raw.maxLength != null && raw.maxLength !== "" ? Math.max(0, num(raw.maxLength, 0)) : null,
      description: S(raw.description, 240),
    };
  }
  LIB.normalizeParameter = normalizeParameter;

  function normalizeVariant(raw) {
    raw = asObj(raw);
    const os = LIB.OS.indexOf(low(raw.os)) !== -1 ? low(raw.os) : "any";
    const language = J && J.language(raw.language) ? String(raw.language) : (J ? "powershell" : "powershell");
    return {
      os,
      language,
      script: S(raw.script, sizeCap() || 262144),
      args: asArr(raw.args).map((a) => S(a, 300)),
      timeoutSeconds: Math.max(10, num(raw.timeoutSeconds, 300)),
    };
  }
  LIB.normalizeVariant = normalizeVariant;

  function normalizeScript(data) {
    data = asObj(data);
    const kind = LIB.KINDS.indexOf(data.kind) !== -1 ? data.kind : "script";
    const variants = asArr(data.variants).map(normalizeVariant);
    return {
      kind,
      id: data.id || T.newItemId("scriptLibrary"),
      name: S(data.name, 120) || "Untitled script",
      description: S(data.description, 600),
      category: S(data.category, 60),
      tags: uniq(asArr(data.tags).map((t) => S(t, 40)).filter(Boolean)),
      language: data.language || (variants[0] ? variants[0].language : "powershell"),
      variants,
      parameters: asArr(data.parameters).map(normalizeParameter),
      version: Math.max(1, num(data.version, 1)),
      versions: asArr(data.versions).slice(0, versionCap()),
      requiresApproval: !!data.requiresApproval,
      timeoutSeconds: Math.max(10, num(data.timeoutSeconds, (variants[0] && variants[0].timeoutSeconds) || 300)),
      enabled: data.enabled === undefined ? true : !!data.enabled,
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };
  }
  LIB.normalizeScript = normalizeScript;
  LIB.newScript = normalizeScript;

  LIB.validateScript = function (script) {
    const errors = [];
    if (!script || typeof script !== "object") return { valid: false, errors: ["script is not an object"] };
    if (!String(script.name || "").trim()) errors.push("name is required");
    if (LIB.KINDS.indexOf(script.kind) === -1) errors.push("invalid kind: " + script.kind);
    if (!asArr(script.variants).length) errors.push("at least one OS variant is required");
    asArr(script.variants).forEach((v, i) => {
      if (LIB.OS.indexOf(v.os) === -1) errors.push("variant " + (i + 1) + ": invalid OS " + v.os);
      if (J && !J.language(v.language)) errors.push("variant " + (i + 1) + ": unsupported language " + v.language);
      if (!String(v.script || "").trim()) errors.push("variant " + (i + 1) + ": script is empty");
    });
    const seen = {};
    asArr(script.parameters).forEach((p, i) => {
      if (!IDENT.test(p.name)) errors.push("parameter " + (i + 1) + ": invalid name " + p.name);
      if (seen[p.name]) errors.push("parameter " + (i + 1) + ": duplicate name " + p.name);
      seen[p.name] = true;
      if (p.type === "enum" && !asArr(p.options).length) errors.push("parameter " + p.label + ": an enum needs at least one option");
      if (p.type === "number" && p.min != null && p.max != null && p.min > p.max) errors.push("parameter " + p.label + ": min exceeds max");
      if (p.type === "string" && p.pattern) { try { new RegExp(p.pattern); } catch (e) { errors.push("parameter " + p.label + ": invalid pattern"); } }
    });
    return { valid: errors.length === 0, errors };
  };

  LIB.validateParameters = function (script, values) {
    values = asObj(values);
    const params = asArr(script && script.parameters);
    const out = {};
    const errors = [];
    const seen = {};
    params.forEach((p) => {
      seen[p.name] = true;
      const has = Object.prototype.hasOwnProperty.call(values, p.name);
      let raw = has ? values[p.name] : p.default;
      if (raw === undefined || raw === null || raw === "") {
        if (p.required) errors.push((p.label || p.name) + " is required");
        out[p.name] = p.type === "bool" ? false : (p.default === undefined || p.default === null ? "" : p.default);
        return;
      }
      if (p.type === "number") {
        const n = Number(raw);
        if (!isFinite(n)) { errors.push((p.label || p.name) + " must be a number"); out[p.name] = p.default === "" ? 0 : p.default; return; }
        if (p.min != null && n < p.min) errors.push((p.label || p.name) + " must be ≥ " + p.min);
        if (p.max != null && n > p.max) errors.push((p.label || p.name) + " must be ≤ " + p.max);
        out[p.name] = n;
      } else if (p.type === "bool") {
        out[p.name] = raw === true || raw === 1 || /^(true|1|on|yes)$/i.test(String(raw));
      } else if (p.type === "enum") {
        const v = String(raw);
        if (asArr(p.options).length && asArr(p.options).indexOf(v) === -1) errors.push((p.label || p.name) + " must be one of: " + asArr(p.options).join(", "));
        out[p.name] = v;
      } else {
        let s = String(raw);
        if (p.maxLength != null && s.length > p.maxLength) { errors.push((p.label || p.name) + " must be at most " + p.maxLength + " characters"); s = s.slice(0, p.maxLength); }
        if (p.pattern) { let re = null; try { re = new RegExp(p.pattern); } catch (e) {} if (re && !re.test(s)) errors.push((p.label || p.name) + " does not match the required format"); }
        out[p.name] = s;
      }
    });
    Object.keys(values).forEach((k) => { if (!seen[k]) errors.push("unknown parameter: " + k); });
    return { valid: errors.length === 0, errors, values: out };
  };

  /* ═══════════════════════ variants & components ═══════════════════════ */

  LIB.variantFor = function (script, os) {
    const variants = asArr(script && script.variants);
    if (!variants.length) return null;
    const want = os ? low(os) : "";
    if (want) {
      const exact = variants.find((v) => low(v.os) === want);
      if (exact) return exact;
    }
    return variants.find((v) => low(v.os) === "any") || variants[0];
  };

  LIB.componentOf = function (provider, id) {
    return asArr(provider && provider.scriptLibrary).map(normalizeScript).find((s) => String(s.id) === String(id)) || null;
  };

  /* Expand {{component:id}} includes (recursively). Pure given a provider. */
  LIB.expandComponents = function (provider, script, opts) {
    opts = opts || {};
    const os = opts.os || null;
    const variant = LIB.variantFor(script, os);
    if (!variant) return { error: "no_variant" };
    const text0 = String(variant.script || "");
    const seen = [String(script.id)];
    let bytes = text0.length;
    let text = text0;
    for (let depth = 0; depth < depthCap(); depth++) {
      let changed = false;
      const missing = [];
      text = text.replace(INCLUDE, (m, id) => {
        if (seen.indexOf(String(id)) !== -1) { missing.push("cycle: " + id); return m; }
        const comp = LIB.componentOf(provider, id);
        if (!comp) { missing.push("missing component " + id); return m; }
        const cv = LIB.variantFor(comp, os);
        if (!cv) { missing.push("component " + id + " has no variant"); return m; }
        seen.push(String(id));
        changed = true;
        bytes += String(cv.script || "").length;
        return String(cv.script || "");
      });
      if (missing.length) return { error: "component_error", errors: missing };
      if (!changed) break;
    }
    if (/\{\{\s*component\s*:/.test(text)) return { error: "component_depth", errors: ["component includes nested deeper than " + depthCap()] };
    if (bytes > sizeCap()) return { error: "component_too_large", errors: ["expanded script exceeds " + sizeCap() + " bytes"] };
    return { script: text, os: variant.os, language: variant.language };
  };

  /* ═══════════════════════ apply (safe substitution) ═══════════════════════ */

  /* Returns { language, script, args, timeoutSeconds, command, values, os }
     or { error, errors }. */
  LIB.prepareRun = function (provider, script, values, os) {
    const norm = normalizeScript(script);
    const variant = LIB.variantFor(norm, os);
    if (!variant) return { error: "no_variant", errors: ["no script variant for " + (os || "the target OS")] };
    const val = LIB.validateParameters(norm, values);
    if (!val.valid) return { error: "invalid_parameters", errors: val.errors };
    let text = String(variant.script || "");
    const expanded = LIB.expandComponents(provider, norm, { os });
    if (expanded.error) return expanded;
    text = expanded.script;
    const declared = {};
    asArr(norm.parameters).forEach((p) => { declared[p.name] = true; });
    const shell = LIB.shellForLanguage(variant.language);
    const unknown = [];
    text = text.replace(TOKEN, (m, name) => {
      if (!declared[name]) { unknown.push(name); return m; }
      return LIB.safeLiteral(val.values[name], shell);
    });
    if (unknown.length) return { error: "unknown_token", errors: ["unknown parameter token(s): " + uniq(unknown).join(", ")] };
    const args = asArr(variant.args).map((a) => String(a));
    const timeoutSeconds = Math.max(10, num(variant.timeoutSeconds, num(norm.timeoutSeconds, 300)));
    return {
      language: variant.language,
      script: text,
      args,
      timeoutSeconds,
      workingDir: "",
      command: J ? J.commandLine({ language: variant.language, args, workingDir: "" }, os === "windows" ? "Windows" : os === "macos" ? "macOS" : "Linux") : "",
      values: val.values,
      os: variant.os,
      scriptId: norm.id,
      name: norm.name,
    };
  };

  LIB.applyParameters = function (script, values, opts) {
    opts = opts || {};
    const provider = opts.provider || { scriptLibrary: [] };
    return LIB.prepareRun(provider, script, values, opts.os);
  };

  /* ═══════════════════════ persistence / CRUD ═══════════════════════ */

  LIB.get = async function (providerId, scriptId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const rec = asArr(g.provider.scriptLibrary).find((s) => String(s.id) === String(scriptId));
    if (!rec) return { error: "not_found", scriptId };
    return { script: normalizeScript(rec), provider: g.provider, rev: g.rev };
  };

  LIB.list = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return [];
    return asArr(g.provider.scriptLibrary).map(normalizeScript);
  };
  LIB.listOf = (provider) => asArr(provider && provider.scriptLibrary).map(normalizeScript);

  LIB.statsOf = function (provider) {
    const scripts = LIB.listOf(provider);
    const byKind = {}, byCategory = {}, byLanguage = {};
    scripts.forEach((s) => {
      byKind[s.kind] = (byKind[s.kind] || 0) + 1;
      byCategory[s.category || "uncategorised"] = (byCategory[s.category || "uncategorised"] || 0) + 1;
      byLanguage[s.language] = (byLanguage[s.language] || 0) + 1;
    });
    return {
      total: scripts.length,
      scripts: scripts.filter((s) => s.kind !== "component").length,
      components: scripts.filter((s) => s.kind === "component").length,
      enabled: scripts.filter((s) => s.enabled !== false).length,
      parameters: scripts.reduce((n, s) => n + s.parameters.length, 0),
      osVariants: scripts.reduce((n, s) => n + s.variants.length, 0),
      byKind, byCategory, byLanguage,
    };
  };
  LIB.stats = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return LIB.statsOf(g.provider);
  };

  function actorName() {
    try {
      const tm = ERP.team && ERP.team.me;
      const me = typeof tm === "function" ? tm() : tm;
      if (me && me.displayName) return String(me.displayName);
    } catch (e) {}
    return ERP.role || "owner";
  }

  function snapshotOf(script) {
    return {
      version: script.version,
      at: now(),
      author: actorName(),
      note: "",
      snapshot: {
        name: script.name, description: script.description, category: script.category, tags: asArr(script.tags),
        language: script.language, variants: clone(script.variants), parameters: clone(script.parameters),
        timeoutSeconds: script.timeoutSeconds, requiresApproval: script.requiresApproval,
      },
    };
  }

  LIB.add = async function (providerId, data) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const script = normalizeScript(data);
    const v = LIB.validateScript(script);
    if (!v.valid) return { error: "invalid", errors: v.errors };
    script.versions = [snapshotOf(script)];
    const r = await T.addItem(providerId, "scriptLibrary", script);
    if (r.error) return r;
    return { script: normalizeScript(r.item), rev: r.rev };
  };

  LIB.update = async function (providerId, scriptId, patch, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    let out = null;
    const r = await T.updateItem(providerId, "scriptLibrary", scriptId, (it) => {
      const before = normalizeScript(it);
      const merged = normalizeScript(Object.assign({}, before, asObj(patch), { id: before.id, kind: before.kind, createdAt: before.createdAt, version: before.version, versions: before.versions }));
      if (opts.bump) {
        merged.version = before.version + 1;
        const snap = snapshotOf(merged);
        snap.note = S(opts.note, 200) || "Updated";
        merged.versions = [snap].concat(asArr(before.versions)).slice(0, versionCap());
      }
      Object.assign(it, merged, { id: before.id, kind: before.kind, createdAt: before.createdAt });
      out = it;
    });
    if (r.error) return r;
    if (!out) return { error: "not_found", scriptId };
    return { script: normalizeScript(out), rev: r.rev };
  };

  LIB.bumpVersion = async function (providerId, scriptId, note) {
    const g = await LIB.get(providerId, scriptId);
    if (g.error) return g;
    return LIB.update(providerId, scriptId, { version: g.script.version + 1 }, { bump: true, note: note || "Version bumped" });
  };

  LIB.restore = async function (providerId, scriptId, version) {
    const g = await LIB.get(providerId, scriptId);
    if (g.error) return g;
    const entry = asArr(g.script.versions).find((v) => num(v.version, 0) === num(version, 0));
    if (!entry) return { error: "version_not_found", version };
    const snap = asObj(entry.snapshot);
    const next = normalizeScript(Object.assign({}, g.script, snap, { id: g.script.id, version: g.script.version + 1 }));
    const r = await LIB.update(providerId, scriptId, next, { bump: true, note: "Restored v" + version });
    return r;
  };

  LIB.diffVersions = function (script, vA, vB) {
    const vers = asArr(script && script.versions);
    const a = vers.find((v) => num(v.version, 0) === num(vA, 0));
    const b = vers.find((v) => num(v.version, 0) === num(vB, 0));
    if (!a || !b) return { error: "version_not_found" };
    const lines = (snap) => JSON.stringify(asObj(snap), null, 2).split("\n");
    const la = lines(a.snapshot), lb = lines(b.snapshot);
    let added = 0, removed = 0;
    const max = Math.max(la.length, lb.length);
    for (let i = 0; i < max; i++) { if (la[i] === lb[i]) continue; if (la[i] !== undefined) removed++; if (lb[i] !== undefined) added++; }
    const paramDelta = asArr(asObj(b.snapshot).parameters).length - asArr(asObj(a.snapshot).parameters).length;
    const variantDelta = asArr(asObj(b.snapshot).variants).length - asArr(asObj(a.snapshot).variants).length;
    return {
      from: num(vA, 0), to: num(vB, 0), linesAdded: added, linesRemoved: removed,
      paramDelta, variantDelta,
      summary: "v" + vA + " → v" + vB + ": " + added + " line(s) added, " + removed + " removed, " + (paramDelta >= 0 ? "+" : "") + paramDelta + " parameter(s), " + (variantDelta >= 0 ? "+" : "") + variantDelta + " variant(s)",
    };
  };

  LIB.remove = async function (providerId, scriptId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const r = await T.removeItem(providerId, "scriptLibrary", scriptId);
    if (r.error) return r;
    return { removed: scriptId };
  };

  LIB.setEnabled = (providerId, scriptId, enabled) => LIB.update(providerId, scriptId, { enabled: !!enabled });

  LIB.duplicate = async function (providerId, scriptId) {
    const g = await LIB.get(providerId, scriptId);
    if (g.error) return g;
    const copy = normalizeScript(Object.assign({}, g.script, {
      id: null, name: g.script.name + " (copy)", version: 1, versions: [], createdAt: null,
    }));
    return LIB.add(providerId, copy);
  };

  /* ═══════════════════════ execution ═══════════════════════ */

  LIB.validateRun = async function (providerId, scriptId, values, os) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const script = LIB.componentOf(g.provider, scriptId);
    if (!script) return { error: "not_found", scriptId };
    if (script.enabled === false) return { error: "disabled", errors: ["this library script is disabled"] };
    const prep = LIB.prepareRun(g.provider, script, values, os);
    if (prep.error) return prep;
    prep.requiresApproval = !!script.requiresApproval;
    return prep;
  };

  /* Run one script on many devices, grouping by OS family so each group
     receives the correct variant. */
  LIB.runOn = async function (providerId, deviceIds, scriptId, values, opts) {
    opts = opts || {};
    if (!J || typeof J.enqueue !== "function") return { error: "no_job_engine" };
    const g = await T.get(providerId);
    if (g.error) return g;
    const script = LIB.componentOf(g.provider, scriptId);
    if (!script) return { error: "not_found", scriptId };
    if (script.enabled === false) return { error: "disabled" };
    const ids = asArr(deviceIds).map(String).filter(Boolean);
    if (!ids.length) return { error: "no_targets" };
    const devices = asArr(g.provider.devices).map(D.normalizeDevice).filter((d) => ids.indexOf(String(d.id)) !== -1);
    const groups = {};
    devices.forEach((d) => {
      const fam = J.familyOf ? J.familyOf(d) : "Windows";
      (groups[fam] = groups[fam] || []).push(String(d.id));
    });
    const jobs = [], errors = [], skipped = [];
    for (const fam of Object.keys(groups)) {
      const prep = LIB.prepareRun(g.provider, script, values, fam.toLowerCase() === "macos" ? "macos" : fam.toLowerCase());
      if (prep.error) { errors.push({ family: fam, error: prep.error, errors: prep.errors || [] }); continue; }
      const r = await J.enqueue({
        providerId, deviceIds: groups[fam], name: (opts.name || script.name) + " · " + fam,
        language: prep.language, script: prep.script, args: prep.args, timeoutSeconds: prep.timeoutSeconds,
        source: opts.source || "library", createdBy: opts.createdBy, correlation: opts.correlation,
      });
      if (r.error) errors.push({ family: fam, error: r.error });
      else jobs.push({ family: fam, deviceIds: groups[fam], jobId: r.job.id, command: prep.command });
    }
    return { ok: errors.length === 0, jobs, errors, skipped, script: { id: script.id, name: script.name } };
  };

  /* ═══════════════════════ import / export ═══════════════════════ */

  LIB.exportScript = function (script) {
    return { schema: LIB.SCHEMA, exportedAt: now(), script: normalizeScript(script) };
  };

  LIB.importScript = async function (providerId, data, opts) {
    opts = opts || {};
    let obj = data;
    if (typeof data === "string") { try { obj = JSON.parse(data); } catch (e) { return { error: "invalid_json" }; } }
    const rec = asObj(obj).schema === LIB.SCHEMA ? asObj(obj).script : (asObj(obj).script && !asObj(obj).variants ? asObj(obj).script : obj);
    if (!rec || typeof rec !== "object") return { error: "invalid_payload" };
    const existing = await LIB.list(providerId);
    let name = S(asObj(rec).name, 120) || "Imported script";
    if (!opts.force) {
      let n = 2;
      const base = name;
      while (existing.some((s) => low(s.name) === low(name))) { name = base + " (" + n + ")"; n++; }
    }
    const r = await LIB.add(providerId, Object.assign({}, asObj(rec), { id: opts.keepIds ? asObj(rec).id : null, name, version: 1, versions: [] }));
    return r;
  };

  LIB.exportBundle = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    return {
      schema: LIB.BUNDLE_SCHEMA,
      exportedAt: now(),
      provider: g.provider.name,
      scripts: LIB.listOf(g.provider).map((s) => normalizeScript(s)),
    };
  };

  LIB.importBundle = async function (providerId, data, opts) {
    opts = opts || {};
    let obj = data;
    if (typeof data === "string") { try { obj = JSON.parse(data); } catch (e) { return { error: "invalid_json" }; } }
    const list = asArr(asObj(obj).scripts);
    if (!list.length) return { error: "empty_bundle" };
    const added = [], errors = [];
    for (const rec of list) {
      const r = await LIB.importScript(providerId, rec, opts);
      if (r.error) errors.push({ name: asObj(rec).name, error: r.error, errors: r.errors });
      else added.push(r.script.id);
    }
    return { ok: errors.length === 0, added, errors };
  };

  /* ═══════════════════════ seed ═══════════════════════ */

  LIB.seedDemo = async function (opts) {
    opts = opts || {};
    if (!opts.force && cfg("rmm.scriptLibraryEnabled", true) === false) return { skipped: true, reason: "disabled" };
    const demo = (await T.list()).find((p) => p.demo);
    if (!demo) return { skipped: true, reason: "no_demo_provider" };
    const g = await T.get(demo.id);
    if (g.error) return { error: g.error };
    const existing = new Set(LIB.listOf(g.provider).map((s) => low(s.name)));
    const created = [];
    const seed = [
      {
        kind: "component", name: "Standard header", category: "Diagnostics", language: "powershell",
        description: "A reusable prelude included by other scripts with {{component:...}}.",
        variants: [{ os: "any", language: "powershell", script: "$ErrorActionPreference = 'Stop'\n$hostname = $env:COMPUTERNAME\nWrite-Output \"== $hostname ==\"" }],
      },
      {
        kind: "script", name: "Restart a service", category: "Remediation", requiresApproval: true,
        description: "Restarts one named service, validated and shell-escaped.",
        parameters: [{ name: "service", label: "Service name", type: "string", required: true, pattern: "^[A-Za-z0-9_.\\- ]{1,64}$", description: "The short service name." }],
        variants: [
          { os: "windows", language: "powershell", script: "Restart-Service -Name {{service}} -Force\nWrite-Output \"restarted {{service}}\"", timeoutSeconds: 120 },
          { os: "linux", language: "bash", script: "systemctl restart {{service}}\necho \"restarted {{service}}\"", timeoutSeconds: 120 },
          { os: "macos", language: "bash", script: "launchctl kickstart -k system/{{service}}\necho \"restarted {{service}}\"", timeoutSeconds: 120 },
        ],
      },
      {
        kind: "script", name: "Disk free report", category: "Diagnostics",
        description: "Reports free space on every volume.",
        variants: [
          { os: "windows", language: "powershell", script: "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | Format-Table -AutoSize", timeoutSeconds: 60 },
          { os: "linux", language: "bash", script: "df -h", timeoutSeconds: 60 },
          { os: "macos", language: "bash", script: "df -h", timeoutSeconds: 60 },
        ],
      },
    ];
    for (const data of seed) {
      if (!opts.force && existing.has(low(data.name))) continue;
      const r = await LIB.add(demo.id, data);
      if (r.error) continue;
      created.push(r.script.id);
    }
    return { providerId: demo.id, created };
  };

  let readyResolve;
  LIB.ready = new Promise((res) => { readyResolve = res; });
  LIB.init = async function () { try { await T.ready; await LIB.seedDemo(); } catch (e) { console.error("script library seed failed", e); } finally { readyResolve(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", LIB.init);
  else LIB.init();

  /* ═══════════════════════ station UI ═══════════════════════ */

  LIB.currentProviderId = null;

  function scopedShowTab(el, id) {
    el.querySelectorAll(":scope > .erp-tabs > [data-tab]").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === id));
    el.querySelectorAll(":scope > .erp-tabs-content > [data-panel]").forEach((p) => p.classList.toggle("active", p.getAttribute("data-panel") === id));
  }

  function paramSummary(script) {
    if (!script.parameters.length) return '<span class="erp-sub">none</span>';
    return script.parameters.map((p) => ERP.ui.badge(p.name + ":" + p.type, "muted")).join(" ");
  }

  async function libraryPanel(provider, state) {
    const ui = ERP.ui, esc = ui.esc;
    const scripts = LIB.listOf(provider);
    const stats = LIB.statsOf(provider);
    const rows = scripts.map((s) => ({
      name: '<b>' + esc(s.name) + "</b> " + (s.kind === "component" ? ui.badge("component", "info") : "") + (s.enabled === false ? " " + ui.badge("disabled", "muted") : "")
        + (s.requiresApproval ? " " + ui.badge("approval", "warn") : "")
        + (s.description ? '<div class="erp-sub">' + esc(s.description) + "</div>" : ""),
      category: ui.badge(s.category || "—", "muted"),
      os: s.variants.map((v) => ui.badge(v.os, "info")).join(" "),
      params: paramSummary(s),
      version: "v" + s.version + (s.versions.length ? ' <span class="erp-sub">(' + s.versions.length + ")</span>" : ""),
      actions: (s.kind === "component" ? "" : ui.btn("Run", { small: true, primary: true, act: "lib-run", arg: s.id })) +
        " " + ui.btn("Edit", { small: true, act: "lib-edit", arg: s.id }) +
        " " + ui.btn("Duplicate", { small: true, act: "lib-dup", arg: s.id }) +
        " " + ui.btn("Export", { small: true, act: "lib-export", arg: s.id }) +
        " " + ui.btn("Delete", { small: true, danger: true, act: "lib-del", arg: s.id }),
    }));
    return ui.summary([
      { label: "Entries", value: String(stats.total) },
      { label: "Scripts", value: String(stats.scripts) },
      { label: "Components", value: String(stats.components) },
      { label: "Parameters", value: String(stats.parameters) },
      { label: "OS variants", value: String(stats.osVariants) },
      { label: "Enabled", value: String(stats.enabled) },
    ]) +
      ui.table([
        { key: "name", label: "Script", render: (r) => r.name },
        { key: "category", label: "Category", render: (r) => r.category },
        { key: "os", label: "OS variants", render: (r) => r.os },
        { key: "params", label: "Parameters", render: (r) => r.params },
        { key: "version", label: "Version", render: (r) => r.version },
        { key: "actions", label: "", render: (r) => r.actions },
      ], rows, { scroll: true, emptyText: "No library scripts yet — create one or import a bundle." }) +
      '<p class="erp-sub">Parameters are substituted only as shell-escaped quoted literals, so a library script cannot be used to inject commands. Components are included with <code>{{component:id}}</code> and share the host script\'s parameters.</p>';
  }

  async function bundlesPanel(provider) {
    const ui = ERP.ui, esc = ui.esc;
    return ui.card("Import / export", ui.form(
      ui.textarea("bundle", "Bundle JSON", "", 10) +
      '<p class="erp-sub">Export the whole provider library as a schema-tagged JSON bundle, or paste one and import it. Names are de-duplicated on import.</p>',
      ui.btn("Export bundle", { small: true, act: "lib-export-all" }) + " " + ui.btn("Import bundle", { small: true, primary: true, act: "lib-import-all" })
    )) +
      '<div data-export-out></div>';
  }

  async function mount(host, ctx, opts) {
    opts = opts || {};
    const ui = ERP.ui, esc = ui.esc;
    const providers = asArr(opts.providers).length ? opts.providers : (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { host.innerHTML = '<div class="erp-alert">No service providers yet.</div>'; return; }
    const TABS = ["library", "bundles"];
    const state = {
      pid: (LIB.currentProviderId && providers.some((p) => p.id === LIB.currentProviderId)) ? LIB.currentProviderId : (opts.providerId || providers[0].id),
      tab: TABS.indexOf(opts.tab) !== -1 ? opts.tab : "library",
    };
    LIB.currentProviderId = state.pid;
    const prov = async () => { const g = await T.get(state.pid); return g.error ? null : g.provider; };

    async function paint() {
      const p = await prov();
      if (!p) { host.innerHTML = '<div class="erp-alert">This tenant could not be loaded.</div>'; return; }
      const tabs = ui.tabs([{ id: "library", label: "Library", badge: String(LIB.listOf(p).length) }, { id: "bundles", label: "Bundles" }], state.tab);
      const picker = providers.length > 1
        ? '<div class="erp-inline-form"><div class="field" style="flex:1 1 240px"><label>Service provider</label><select name="pid">' +
          providers.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === state.pid ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</select></div></div>"
        : "";
      host.innerHTML = (opts.headHtml || "") + tabs.html + picker;
      host.querySelector('[data-panel="library"]').innerHTML = await libraryPanel(p, state);
      host.querySelector('[data-panel="bundles"]').innerHTML = await bundlesPanel(p);
      scopedShowTab(host, state.tab);
    }

    ui.bind(host, "click", "[data-tab]", (t) => {
      const ctn = t.parentElement && t.parentElement.parentElement;
      if (!ctn) return;
      scopedShowTab(ctn, t.getAttribute("data-tab"));
      state.tab = t.getAttribute("data-tab");
    });

    /* ── editor ── */
    function openForm(script) {
      const isEdit = !!script;
      const fs = {
        kind: isEdit ? script.kind : "script",
        category: isEdit ? script.category : "",
        variants: isEdit ? clone(script.variants) : [{ os: "any", language: "powershell", script: "", args: [], timeoutSeconds: 300 }],
        parameters: isEdit ? clone(script.parameters) : [],
      };
      const langOpts = (J ? J.LANGUAGES : [{ id: "powershell", label: "PowerShell" }]);

      function variantsHtml() {
        return fs.variants.map((v, i) =>
          '<div class="rmm-variant" data-variant="' + i + '">' +
          '<div class="erp-btn-row">' +
          '<select data-v-os="' + i + '">' + LIB.OS.map((o) => '<option value="' + o + '"' + (o === v.os ? " selected" : "") + ">" + o + "</option>").join("") + "</select> " +
          '<select data-v-lang="' + i + '">' + langOpts.map((l) => '<option value="' + esc(l.id) + '"' + (l.id === v.language ? " selected" : "") + ">" + esc(l.label) + "</option>").join("") + "</select> " +
          ui.btn("✕", { small: true, danger: true, act: "lib-v-del", arg: String(i) }) +
          "</div>" +
          '<textarea data-v-script="' + i + '" rows="5" placeholder="script body — use {{param}} for parameters">' + esc(v.script || "") + "</textarea>" +
          '<div class="erp-btn-row"><input type="number" data-v-timeout="' + i + '" value="' + num(v.timeoutSeconds, 300) + '" placeholder="timeout s" style="max-width:130px">' +
          '<input type="text" data-v-args="' + i + '" value="' + esc(asArr(v.args).join(" ")) + '" placeholder="extra args (space separated)"></div>' +
          "</div>").join("") + '<div class="erp-btn-row">' + ui.btn("Add OS variant", { small: true, act: "lib-v-add" }) + "</div>";
      }
      function paramsHtml() {
        return fs.parameters.map((p, i) =>
          '<div class="rmm-param" data-param="' + i + '">' +
          '<div class="erp-btn-row">' +
          '<input type="text" data-p-name="' + i + '" value="' + esc(p.name) + '" placeholder="name"> ' +
          '<select data-p-type="' + i + '">' + LIB.PARAM_TYPES.map((t) => '<option value="' + t + '"' + (t === p.type ? " selected" : "") + ">" + t + "</option>").join("") + "</select> " +
          '<label class="erp-check"><input type="checkbox" data-p-req="' + i + '"' + (p.required ? " checked" : "") + "> required</label> " +
          ui.btn("✕", { small: true, danger: true, act: "lib-p-del", arg: String(i) }) +
          "</div>" +
          '<input type="text" data-p-label="' + i + '" value="' + esc(p.label) + '" placeholder="label"> ' +
          '<input type="text" data-p-default="' + i + '" value="' + esc(p.default) + '" placeholder="default"> ' +
          '<input type="text" data-p-options="' + i + '" value="' + esc(asArr(p.options).join(", ")) + '" placeholder="enum options (comma separated)"> ' +
          '<input type="text" data-p-pattern="' + i + '" value="' + esc(p.pattern) + '" placeholder="regex pattern (string)"> ' +
          '<input type="number" data-p-min="' + i + '" value="' + (p.min == null ? "" : p.min) + '" placeholder="min"> ' +
          '<input type="number" data-p-max="' + i + '" value="' + (p.max == null ? "" : p.max) + '" placeholder="max">' +
          "</div>").join("") + '<div class="erp-btn-row">' + ui.btn("Add parameter", { small: true, act: "lib-p-add" }) + "</div>";
      }
      function bodyHtml() {
        return ui.form(
          ui.text("name", "Name", isEdit ? script.name : "") +
          ui.text("description", "Description", isEdit ? script.description : "") +
          ui.select("kind", "Kind", [{ value: "script", label: "Script" }, { value: "component", label: "Component (include with {{component:id}})" }], fs.kind) +
          ui.text("category", "Category", fs.category, "e.g. Diagnostics, Remediation") +
          ui.text("tags", "Tags", isEdit ? asArr(script.tags).join(", ") : "", "comma separated") +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' + ui.check("requiresApproval", "Requires approval before running", isEdit ? script.requiresApproval : false) + "</div>" +
          '<h4 class="rmm-section-title">OS variants</h4><div data-variants>' + variantsHtml() + "</div>" +
          '<h4 class="rmm-section-title">Parameters</h4><div data-params>' + paramsHtml() + "</div>",
          ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn(isEdit ? "Save" : "Create", { small: true, primary: true, act: "lib-save" })
        );
      }

      const m = ui.modal({ title: isEdit ? "Edit " + script.name : "New library entry", size: "lg", body: bodyHtml() });
      if (!m) return;
      const readVariants = () => asArr(fs.variants).map((v, i) => ({
        os: m.querySelector('[data-v-os="' + i + '"]').value,
        language: m.querySelector('[data-v-lang="' + i + '"]').value,
        script: m.querySelector('[data-v-script="' + i + '"]').value,
        args: String(m.querySelector('[data-v-args="' + i + '"]').value || "").split(/\s+/).filter(Boolean),
        timeoutSeconds: num(m.querySelector('[data-v-timeout="' + i + '"]').value, 300),
      })).filter((v) => String(v.script).trim());
      const readParams = () => asArr(fs.parameters).map((p, i) => ({
        name: m.querySelector('[data-p-name="' + i + '"]').value.trim(),
        label: m.querySelector('[data-p-label="' + i + '"]').value.trim(),
        type: m.querySelector('[data-p-type="' + i + '"]').value,
        required: m.querySelector('[data-p-req="' + i + '"]').checked,
        default: m.querySelector('[data-p-default="' + i + '"]').value,
        options: m.querySelector('[data-p-options="' + i + '"]').value.split(",").map((x) => x.trim()).filter(Boolean),
        pattern: m.querySelector('[data-p-pattern="' + i + '"]').value.trim(),
        min: m.querySelector('[data-p-min="' + i + '"]').value === "" ? null : Number(m.querySelector('[data-p-min="' + i + '"]').value),
        max: m.querySelector('[data-p-max="' + i + '"]').value === "" ? null : Number(m.querySelector('[data-p-max="' + i + '"]').value),
      })).filter((p) => p.name);
      m.addEventListener("click", (e) => {
        const t = e.target.closest && e.target.closest("[data-act]");
        if (!t) return;
        const act = t.getAttribute("data-act");
        const arg = Number(t.getAttribute("data-arg"));
        if (act === "lib-v-add") { fs.variants = readVariants().concat([{ os: "any", language: "powershell", script: "", args: [], timeoutSeconds: 300 }]); fs.parameters = readParams(); m.querySelector("[data-variants]").innerHTML = variantsHtml(); return; }
        if (act === "lib-v-del") { const v = readVariants(); const p = readParams(); v.splice(arg, 1); fs.variants = v.length ? v : [{ os: "any", language: "powershell", script: "", args: [], timeoutSeconds: 300 }]; fs.parameters = p; m.querySelector("[data-variants]").innerHTML = variantsHtml(); return; }
        if (act === "lib-p-add") { fs.variants = readVariants(); fs.parameters = readParams().concat([{ name: "", label: "", type: "string", required: false, default: "", options: [], pattern: "", min: null, max: null }]); m.querySelector("[data-params]").innerHTML = paramsHtml(); return; }
        if (act === "lib-p-del") { fs.variants = readVariants(); const p = readParams(); p.splice(arg, 1); fs.parameters = p; m.querySelector("[data-params]").innerHTML = paramsHtml(); return; }
      });
      m.querySelector("[data-act=lib-save]").onclick = async () => {
        const vals = ui.collect(m, ["name", "description", "kind", "category", "tags"]);
        const payload = {
          name: vals.name, description: vals.description, kind: vals.kind, category: vals.category,
          tags: String(vals.tags || "").split(",").map((x) => x.trim()).filter(Boolean),
          requiresApproval: m.querySelector('[name="requiresApproval"]').checked,
          variants: readVariants(), parameters: readParams(),
        };
        const r = isEdit
          ? await LIB.update(state.pid, script.id, payload, { bump: true, note: "Edited in console" })
          : await LIB.add(state.pid, payload);
        if (r.error) { ctx.toast("Save failed: " + (r.error === "invalid" ? (r.errors || []).join("; ") : r.error), "error"); return; }
        ui.closeModal();
        ctx.toast(isEdit ? "Script saved" : "Script created");
        paint();
      };
    }

    /* ── run dialog ── */
    async function openRun(script) {
      const p = await prov();
      if (!p) return;
      const devices = asArr(p.devices).map(D.normalizeDevice);
      const body = ui.form(
        '<div class="field"><label>Devices</label><div class="rmm-check-list">' +
        devices.map((d) => '<label class="erp-check"><input type="checkbox" data-run-dev="' + esc(d.id) + '"> ' + esc(d.hostname || d.displayName) + ' <span class="erp-sub">' + esc(d.os.family || d.os.name || "") + "</span></label>").join("") +
        "</div></div>" +
        script.parameters.map((prm) => {
          if (prm.type === "bool") return ui.check("p_" + prm.name, prm.label + (prm.required ? " *" : ""), !!prm.default);
          if (prm.type === "enum") return ui.select("p_" + prm.name, prm.label + (prm.required ? " *" : ""), asArr(prm.options).map((o) => ({ value: o, label: o })), prm.default);
          if (prm.type === "number") return ui.number("p_" + prm.name, prm.label + (prm.required ? " *" : ""), prm.default, { min: prm.min, hint: prm.description });
          return ui.text("p_" + prm.name, prm.label + (prm.required ? " *" : ""), prm.default, prm.description);
        }).join(""),
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Validate & run", { small: true, primary: true, act: "lib-run-go", arg: script.id })
      );
      const m = ui.modal({ title: "Run " + script.name, size: "lg", body });
      if (!m) return;
      m.querySelector("[data-act=lib-run-go]").onclick = async () => {
        const deviceIds = [...m.querySelectorAll("[data-run-dev]")].filter((i) => i.checked).map((i) => i.getAttribute("data-run-dev"));
        if (!deviceIds.length) { ctx.toast("Select at least one device", "error"); return; }
        const values = {};
        script.parameters.forEach((prm) => {
          const el = m.querySelector('[name="p_' + prm.name + '"]');
          if (!el) return;
          values[prm.name] = el.type === "checkbox" ? el.checked : el.value;
        });
        const r = await LIB.runOn(state.pid, deviceIds, script.id, values, { source: "library" });
        if (r.error) { ctx.toast("Run failed: " + r.error, "error"); return; }
        if (r.errors && r.errors.length) { ctx.toast("Some variants failed: " + r.errors.map((e) => e.error).join(", "), "error"); }
        else ctx.toast("Queued " + r.jobs.length + " job(s)");
        ui.closeModal();
        paint();
      };
    }

    ui.bind(host, "click", "[data-act]", async (t, e, act, arg) => {
      const p = await prov();
      if (!p) return;
      if (act === "lib-add") return openForm(null);
      if (act === "lib-edit") { const s = LIB.componentOf(p, arg); if (s) return openForm(s); return; }
      if (act === "lib-run") { const s = LIB.componentOf(p, arg); if (s) return openRun(s); return; }
      if (act === "lib-dup") { const r = await LIB.duplicate(state.pid, arg); if (r.error) return ctx.toast("Duplicate failed: " + r.error, "error"); ctx.toast("Duplicated"); return paint(); }
      if (act === "lib-del") {
        const s = LIB.componentOf(p, arg);
        const ok = await ui.confirm({ title: "Delete library entry", message: "Delete “" + (s ? s.name : arg) + "”? Scripts that include it lose the component.", okLabel: "Delete", danger: true });
        if (!ok) return;
        const r = await LIB.remove(state.pid, arg);
        if (r.error) return ctx.toast("Delete failed: " + r.error, "error");
        ctx.toast("Deleted"); return paint();
      }
      if (act === "lib-export") {
        const s = LIB.componentOf(p, arg);
        const out = host.querySelector("[data-export-out]");
        const text = JSON.stringify(LIB.exportScript(s), null, 2);
        if (out) out.innerHTML = ui.card("Exported " + esc(s.name), '<textarea rows="10" readonly>' + esc(text) + "</textarea>");
        state.tab = "library";
        try {
          const blob = new Blob([text], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = s.name.replace(/[^a-z0-9_-]+/gi, "-") + ".json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } catch (err) {}
        ctx.toast("Exported " + s.name);
        return;
      }
      if (act === "lib-export-all") {
        const bundle = await LIB.exportBundle(state.pid);
        if (bundle.error) return ctx.toast("Export failed: " + bundle.error, "error");
        const ta = host.querySelector('[name="bundle"]');
        if (ta) ta.value = JSON.stringify(bundle, null, 2);
        ctx.toast("Bundle exported to the text area");
        return;
      }
      if (act === "lib-import-all") {
        const ta = host.querySelector('[name="bundle"]');
        const r = await LIB.importBundle(state.pid, ta ? ta.value : "");
        if (r.error) return ctx.toast("Import failed: " + r.error, "error");
        ctx.toast("Imported " + r.added.length + " entr(ies)" + (r.errors.length ? " (" + r.errors.length + " failed)" : ""));
        return paint();
      }
    });
    host.addEventListener("change", (e) => { if (e.target && e.target.name === "pid") { state.pid = e.target.value; LIB.currentProviderId = state.pid; paint(); } });

    await paint();
    return state;
  }

  LIB.renderInto = async function (host, opts) {
    if (!host) return null;
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "rmm-library";
    host.innerHTML = "";
    host.appendChild(wrap);
    const head = opts.headHtml || ERP.ui.pageHead("Script & component library",
      "Reusable, versioned scripts and components with typed parameters and per-OS variants. Parameters are validated and then substituted only as shell-escaped quoted literals, so a library script can never be used to run unsafe input on an endpoint.",
      ERP.ui.btn("New entry", { primary: true, act: "lib-add" }));
    return mount(wrap, { toast: opts.toast || ERP.toast }, Object.assign({}, opts, { headHtml: head }));
  };

  LIB.render = async function (ctx) {
    const el = ctx.el;
    const providers = (await T.list({ force: true })).filter((p) => p.status !== "archived");
    if (!providers.length) { if (ctx.empty) ctx.empty(); return; }
    const tab = ["library", "bundles"].indexOf(el.__tab) !== -1 ? el.__tab : "library";
    const pid = (LIB.currentProviderId && providers.some((p) => p.id === LIB.currentProviderId)) ? LIB.currentProviderId : providers[0].id;
    const root = document.createElement("div");
    root.className = "rmm-library";
    el.innerHTML = "";
    el.appendChild(root);
    const head = ERP.ui.pageHead("Script & component library",
      "Reusable, versioned scripts and components with typed parameters and per-OS variants. Parameters are validated and then substituted only as shell-escaped quoted literals, so a library script can never be used to run unsafe input on an endpoint.",
      ERP.ui.btn("New entry", { primary: true, act: "lib-add" }));
    await mount(root, ctx, { providers, providerId: pid, tab, headHtml: head });
    return { pid };
  };
})();
