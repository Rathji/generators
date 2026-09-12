// ============================================================================
// quote-u — invoice path selection (roadmap task 37, part 2)
// ----------------------------------------------------------------------------
// Both invoicing paths (direct accounting, task 35; PSA, task 36) can be
// enabled at once; this module owns the POLICY that decides which one a given
// version uses, and the ROUTER that delegates to the chosen path's service.
//
// Resolution order (most specific first):
//   1. an explicit path on the request, if that path is enabled;
//   2. the company's mapped `preferred_path` (QU_INVOICEMAPPING), if enabled;
//   3. the policy's `default_path`, if enabled;
//   4. the only enabled path, when just one is enabled.
//
// If NO path is enabled the request is refused (`no_path`) rather than silently
// doing nothing. The intent guard (`QU_INVOICEINTENTS`) remains the authority on
// which path a version actually USED — `usedPath` reads it back, so the choice
// is recorded once and cannot be re-decided.
// ============================================================================
window.QU_INVOICEPATHS = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const ALL_PATHS = Object.freeze(["direct", "psa"]);
  const DEFAULT_POLICY = Object.freeze({ default_path: "psa", paths: ALL_PATHS.slice(), by_company: Object.freeze({}) });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    // An EXPLICIT `paths` array is honored as given (an empty array means "no
    // path enabled", which resolvePath refuses with `no_path`); when `paths` is
    // absent, both known paths are enabled.
    let paths = Array.isArray(p.paths) ? p.paths.map(String) : ALL_PATHS.slice();
    const byCompany = {};
    if (isPlainObject(p.by_company)) {
      for (const k of Object.keys(p.by_company)) {
        const v = p.by_company[k];
        if (v === null || v === undefined) continue;
        byCompany[String(k)] = String(v);
      }
    }
    let defaultPath = p.default_path !== undefined && p.default_path !== null ? String(p.default_path) : null;
    if (paths.length) {
      if (defaultPath && paths.indexOf(defaultPath) === -1) paths = paths.concat([defaultPath]);
      if (!defaultPath) defaultPath = paths.indexOf("psa") !== -1 ? "psa" : paths[0];
    } else {
      defaultPath = null;
    }
    return { default_path: defaultPath, paths: paths, by_company: byCompany };
  }

  function enabledPaths(policy) {
    const p = normalizePolicy(policy);
    return p.paths.filter(x => ALL_PATHS.indexOf(x) !== -1);
  }

  // Pure path resolution. Returns { ok, path, source } or { ok:false, code, detail }.
  function resolvePath(policy, context) {
    context = context || {};
    const p = normalizePolicy(policy);
    const enabled = p.paths;
    if (!enabled.length) {
      return { ok: false, code: "no_path", detail: "No invoicing path is enabled; enable one in the invoicing policy." };
    }
    const explicit = context.path ? String(context.path) : null;
    if (explicit && enabled.indexOf(explicit) !== -1) return { ok: true, path: explicit, source: "explicit" };
    if (explicit) return { ok: false, code: "path_disabled", detail: `The "${explicit}" invoicing path is not enabled.` };
    const companyId = context.company_id !== undefined && context.company_id !== null ? String(context.company_id) : null;
    const mapped = companyId && context.mapping_path ? String(context.mapping_path) : null;
    if (mapped && enabled.indexOf(mapped) !== -1) return { ok: true, path: mapped, source: "company" };
    if (mapped) return { ok: false, code: "path_disabled", detail: `The company "${companyId}" prefers the "${mapped}" path, which is not enabled.` };
    if (p.default_path && enabled.indexOf(p.default_path) !== -1) return { ok: true, path: p.default_path, source: "default" };
    if (enabled.length === 1) return { ok: true, path: enabled[0], source: "only" };
    return { ok: false, code: "no_path", detail: "The policy's default path is not enabled; set an enabled default or a per-company preference." };
  }

  // Pure: which path a version actually used, read back from the intent guard.
  function usedPath(records, versionId) {
    const rec = (Array.isArray(records) ? records : []).find(r => r && String(r.version_id) === String(versionId));
    return rec ? { path: rec.path, status: rec.status, external_reference: rec.external_reference || null, external_system: rec.external_system || null } : null;
  }

  function createRouter(opts) {
    opts = opts || {};
    const invoiceDirect = opts.invoiceDirect || null;
    const invoicePsa = opts.invoicePsa || null;
    const invoiceIntents = opts.invoiceIntents || null;
    const mapping = opts.mapping || null;
    const policy = normalizePolicy(opts.policy);
    const services = { direct: invoiceDirect, psa: invoicePsa };

    // Resolve the path for a request, consulting the mapping service (async)
    // for a company preference before falling back to the pure policy.
    async function resolve(input) {
      input = input || {};
      let companyId = input.company_id || (input.quote && input.quote.company_id) || null;
      let mappingPath = input.mapping_path || null;
      if (!mappingPath && mapping && typeof mapping.pathFor === "function" && companyId) {
        const mp = await mapping.pathFor(companyId);
        if (mp && mp.ok && mp.preferred_path) mappingPath = mp.preferred_path;
      }
      return resolvePath(policy, Object.assign({}, input, { company_id: companyId, mapping_path: mappingPath }));
    }

    async function enqueueForVersion(input) {
      input = input || {};
      const rp = await resolve(input);
      if (!rp.ok) return rp;
      const svc = services[rp.path];
      if (!svc || typeof svc.enqueueForVersion !== "function") {
        return { ok: false, code: "path_unavailable", detail: `The "${rp.path}" invoicing path is not available.` };
      }
      const enq = await svc.enqueueForVersion(input);
      if (enq && typeof enq === "object") return Object.assign({ path: rp.path, path_source: rp.source }, enq);
      return enq;
    }

    async function usedPathFor(versionId) {
      if (!invoiceIntents || typeof invoiceIntents.getForVersion !== "function") {
        return { ok: false, code: "no_intents", detail: "The router needs the invoice-intent guard to report a used path." };
      }
      const g = await invoiceIntents.getForVersion(versionId);
      if (!g.ok) return g;
      return { ok: true, used: g.intent ? { path: g.intent.path, status: g.intent.status, external_reference: g.intent.external_reference || null, external_system: g.intent.external_system || null } : null };
    }

    return {
      policy,
      enabledPaths: () => enabledPaths(policy),
      resolve,
      enqueueForVersion,
      enqueueForApproval: enqueueForVersion,
      usedPathFor,
      ready: () => Promise.resolve({ ok: true })
    };
  }

  return {
    VERSION,
    ALL_PATHS,
    DEFAULT_POLICY,
    normalizePolicy,
    enabledPaths,
    resolvePath,
    usedPath,
    createRouter
  };
})();
