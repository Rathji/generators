/* ============================================================
   BI bus — the data integration layer.

     manifest discovery  — fetches the shared pipeline manifest,
                           enumerates every participating tool and
                           its published bundle types, stores the
                           registry. A new tool appears automatically
                           once it registers in the manifest.
     bundle puller      — fetches each tool's published bundles by
                           stable public URL, validates them against
                           their schemas, caches them locally keyed
                           by tool + bundleType + edit count.
     source health      — per source: last successful pull, edit
                           count, age vs cadence, status; manual
                           refresh-per-source and refresh-all that
                           obeys each source's cadence.
     failure tolerance  — older-schema bundles are flagged (gap),
                           malformed payloads are skipped with a
                           named error, tools that never published
                           show an empty-with-explanation state.
                           One broken source never takes down a
                           dashboard.

   Facts are re-derived from the cached bundles by the extractors
   after every pull, so BI.facts always mirrors the cache.
   ============================================================ */
(function () {
  "use strict";

  const BI = window.BI;

  const bus = (BI.bus = {});

  const cfg = {
    manifestUrl: "src/bi/fixtures/manifest.json",
    cadenceMs: 6 * 3600000,      /* default: how fresh data is expected to stay */
    stalenessMs: 30 * 3600000,   /* pull considered stale if cache older than this */
    lsPrefix: "bi.bus.",
  };
  let fetcher = null;

  const K = {
    manifest: () => cfg.lsPrefix + "manifest",
    health: () => cfg.lsPrefix + "health",
    cache: (tool, type) => cfg.lsPrefix + "cache." + tool + "." + type,
  };
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch { /* noop */ } }
  function nowISO() { return new Date().toISOString(); }
  function nowMs() { return Date.now(); }

  /* ---------- fetch (same-origin direct, cross-origin via superFetch) ---------- */
  async function defaultFetcher(url) {
    if (/^https?:\/\//.test(url)) {
      if (window.location && new URL(url).origin === window.location.origin) {
        const r = await fetch(url);
        if (r.ok) return r.text();
        throw new Error("HTTP " + r.status);
      }
      if (window.root && root.superFetch) return root.superFetch(url).then((r) => r.text());
      throw new Error("no_superfetch");
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }
  bus.fetcher = async (url) => (fetcher || defaultFetcher)(url);

  /* ---------- validation ---------- */
  const CURRENT_SCHEMA = 1;

  function validateBundle(b) {
    if (!b || typeof b !== "object") return { ok: false, error: { code: "malformed_bundle", message: "The bundle is not a JSON object." } };
    if (b.schema !== "bi/bundle/v1") return { ok: false, error: { code: "malformed_bundle", message: "The bundle does not declare schema 'bi/bundle/v1'." } };
    if (!(b.schemaVersion >= 0)) return { ok: false, error: { code: "malformed_bundle", message: "The bundle has no schema version." } };
    if (!b.tool || !b.bundleType) return { ok: false, error: { code: "malformed_bundle", message: "The bundle is missing tool or bundleType." } };
    if (!(b.editCount >= 0)) return { ok: false, error: { code: "malformed_bundle", message: "The bundle is missing its edit count." } };
    if (!b.data || typeof b.data !== "object") return { ok: false, error: { code: "malformed_bundle", message: "The bundle has no data payload." } };
    if (b.schemaVersion > CURRENT_SCHEMA) return { ok: false, error: { code: "unsupported_schema", message: "Bundle schema v" + b.schemaVersion + " is newer than this BI understands (v" + CURRENT_SCHEMA + ")." } };
    return { ok: true, gap: b.schemaVersion < CURRENT_SCHEMA };
  }

  function validateManifest(m) {
    if (!m || typeof m !== "object" || m.schema !== "bi/manifest/v1" || !Array.isArray(m.tools)) return null;
    return m;
  }

  /* ---------- cache & health ---------- */
  function cachedBundle(tool, type) {
    const c = lsGet(K.cache(tool, type), null);
    return c && c.bundle ? c : null;
  }
  function cacheBundle(tool, type, bundle, pulledAt) {
    lsSet(K.cache(tool, type), { tool, type, bundle, pulledAt });
  }
  function dropBundle(tool, type) { lsDel(K.cache(tool, type)); }
  function healthMap() { return lsGet(K.health(), {}); }
  function saveHealth(h) { lsSet(K.health(), h); }
  function healthOf(tool, type) {
    const h = healthMap();
    return h[tool + "." + type] || { tool, type, status: "never" };
  }
  function setHealth(tool, type, patch) {
    const h = healthMap();
    h[tool + "." + type] = Object.assign(healthOf(tool, type), patch, { tool, type });
    saveHealth(h);
  }

  function toolCachedBundles(tool) {
    const out = [];
    for (const bt of tool.bundles || []) {
      const c = cachedBundle(tool.id, bt.type);
      if (c) out.push(c.bundle);
    }
    return out;
  }
  bus.cachedBundles = function () {
    const out = [];
    for (const t of bus.tools || []) out.push(...toolCachedBundles(t));
    return out;
  };

  /* rebuild BI.facts from every cached bundle */
  function rebuildFacts() {
    const all = [];
    for (const t of bus.tools || []) {
      for (const b of toolCachedBundles(t)) {
        const r = BI.extractors.extract(b);
        if (r.ok) all.push(...r.facts);
      }
    }
    BI.facts.load(all);
    return all.length;
  }

  /* ---------- manifest discovery ---------- */
  bus.manifest = null;
  bus.tools = [];

  async function loadManifest() {
    const cached = lsGet(K.manifest(), null);
    if (cached && cached.manifest) bus.manifest = cached.manifest;
    let m = null;
    try {
      const text = await bus.fetcher(cfg.manifestUrl);
      m = validateManifest(JSON.parse(text));
    } catch (e) {
      m = null;
    }
    if (m) {
      bus.manifest = m;
      lsSet(K.manifest(), { manifest: m, pulledAt: nowISO() });
      return { ok: true, fromNetwork: true, tools: m.tools.length };
    }
    if (bus.manifest) return { ok: true, fromNetwork: false, fromCache: true, tools: bus.manifest.tools.length };
    return { ok: false, error: { code: "manifest_unreachable", message: "The shared pipeline manifest could not be fetched and no cached copy exists. Check the manifest URL in biConfig.bus." } };
  }

  function buildToolRegistry() {
    if (!bus.manifest) return [];
    bus.tools = bus.manifest.tools.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || "",
      bundles: (t.bundles || []).map((b) => ({ type: b.type, name: b.name || b.type, url: b.url })),
    }));
    return bus.tools;
  }

  /* ---------- pulling ---------- */
  function toolById(id) { return (bus.tools || []).find((t) => t.id === id) || null; }
  function bundleDef(tool, type) { return (tool.bundles || []).find((b) => b.type === type) || null; }

  /* Pull one bundle: fetch → validate → extract → cache. Returns
     {ok, changed, error} where changed=false means editCount unchanged
     (cache kept, no re-extract). */
  async function pullBundle(tool, type, opts) {
    opts = opts || {};
    const def = bundleDef(tool, type);
    if (!def) return { ok: false, error: { code: "no_bundle", message: "No bundle type '" + type + "' is registered for tool '" + tool.id + "'." } };
    let text;
    try {
      text = await bus.fetcher(def.url);
    } catch (e) {
      const code = String((e && e.message) || "").indexOf("HTTP") === 0 ? "source_http_error" : "network_error";
      const h = healthOf(tool.id, type);
      setHealth(tool.id, type, { status: "error", error: code, lastErrorAt: nowISO(), lastPull: h.lastPull });
      return { ok: false, error: { code, message: "Could not fetch '" + def.url + "': " + ((e && e.message) || e) } };
    }
    let raw;
    try { raw = JSON.parse(text); } catch (e) {
      setHealth(tool.id, type, { status: "error", error: "malformed_bundle", lastErrorAt: nowISO() });
      return { ok: false, error: { code: "malformed_bundle", message: "The bundle at '" + def.url + "' is not valid JSON." } };
    }
    const v = validateBundle(raw);
    if (!v.ok) {
      setHealth(tool.id, type, { status: "error", error: v.error.code, lastErrorAt: nowISO() });
      return { ok: false, error: v.error };
    }
    const prev = cachedBundle(tool.id, type);
    const changed = !prev || prev.bundle.editCount !== raw.editCount;
    let ex = null;
    if (changed) {
      ex = BI.extractors.extract(raw);
      if (!ex.ok) {
        setHealth(tool.id, type, { status: "error", error: ex.error.code, lastErrorAt: nowISO() });
        return { ok: false, error: ex.error };
      }
      cacheBundle(tool.id, type, raw, nowISO());
    }
    const status = (v.gap || (ex && ex.gap)) ? "gap" : "ok";
    setHealth(tool.id, type, {
      status,
      error: null,
      lastPull: nowISO(),
      editCount: raw.editCount,
      schemaVersion: raw.schemaVersion,
      url: def.url,
      publishedAt: raw.publishedAt || raw.asOf || null,
      changed,
    });
    return { ok: true, changed, gap: !!v.gap, editCount: raw.editCount, facts: ex ? ex.facts.length : 0 };
  }

  async function pullTool(tool, opts) {
    const out = [];
    for (const b of tool.bundles || []) out.push({ type: b.type, ...(await pullBundle(tool, b.type, opts)) });
    return out;
  }

  /* Refresh a single tool (manual refresh-per-source). */
  bus.refresh = async function (toolId) {
    const tool = toolById(toolId);
    if (!tool) return { ok: false, error: { code: "unknown_tool", message: "No tool '" + toolId + "' in the manifest." } };
    const res = await pullTool(tool, { force: true });
    rebuildFacts();
    return { ok: true, tool: toolId, bundles: res };
  };

  /* Refresh-all obeying each source's cadence: a source is re-fetched only
     when its last successful pull is older than its cadence (or forced);
     among those, only bundles whose edit count changed are re-extracted. */
  bus.refreshAll = async function (opts) {
    opts = opts || {};
    const out = [];
    let pulled = 0, changed = 0, errors = 0;
    for (const tool of bus.tools || []) {
      const per = { tool: tool.id, bundles: [] };
      for (const b of tool.bundles || []) {
        const h = healthOf(tool.id, b.type);
        const due = h.status !== "ok" || !h.lastPull || (nowMs() - new Date(h.lastPull).getTime()) > cfg.cadenceMs;
        if (!due && !opts.force) {
          per.bundles.push({ type: b.type, ok: true, due: false, changed: false });
          continue;
        }
        const r = await pullBundle(tool, b.type, { force: opts.force === true || h.status !== "ok" });
        per.bundles.push({ type: b.type, ...r });
        if (r.ok) { pulled++; if (r.changed) changed++; }
        else errors++;
      }
      out.push(per);
    }
    rebuildFacts();
    return { ok: true, scanned: bus.tools.length, pulled, changed, errors, tools: out };
  };

  /* ---------- health & staleness ---------- */
  bus.healthOf = healthOf;
  bus.toolHealth = function (toolId) {
    const tool = toolById(toolId);
    if (!tool) return { tool: toolId, status: "unknown", bundles: [] };
    return {
      tool: toolId,
      name: tool.name,
      status: toolStatus(tool),
      bundles: (tool.bundles || []).map((b) => healthOf(toolId, b.type)),
    };
  };
  bus.healthAll = function () {
    return (bus.tools || []).map((t) => bus.toolHealth(t.id));
  };

  function toolStatus(tool) {
    let anyError = false, anyOk = false, anyGap = false;
    for (const b of tool.bundles || []) {
      const h = healthOf(tool.id, b.type);
      if (h.status === "error") anyError = true;
      if (h.status === "ok" || h.status === "stale") anyOk = true;
      if (h.status === "gap") anyGap = true;
    }
    if (!anyOk && !anyError && !anyGap) return "never";
    if (anyError && !anyOk && !anyGap) return "error";
    return anyGap ? "gap" : "ok";
  }

  /* age (ms) of the freshest data for a tool+bundle: now - publishedAt */
  bus.ageMs = function (tool, type) {
    const h = healthOf(tool, type);
    if (h.status === "never") return null;
    const c = cachedBundle(tool, type);
    if (c && c.bundle && (c.bundle.publishedAt || c.bundle.asOf)) {
      return nowMs() - new Date((c.bundle.publishedAt || c.bundle.asOf + "T00:00:00Z")).getTime();
    }
    return h.lastPull ? nowMs() - new Date(h.lastPull).getTime() : null;
  };
  bus.isStale = function (tool, type) {
    const a = bus.ageMs(tool, type);
    return a != null && a > cfg.stalenessMs;
  };

  bus.status = function () {
    return {
      tools: (bus.tools || []).map((t) => bus.toolHealth(t.id)),
      factCount: BI.facts.records.length,
      manifestUrl: cfg.manifestUrl,
      cadenceMs: cfg.cadenceMs,
      stalenessMs: cfg.stalenessMs,
    };
  };

  /* ---------- lifecycle ---------- */
  bus.init = async function (opts) {
    opts = opts || {};
    if (opts.manifestUrl) cfg.manifestUrl = opts.manifestUrl;
    if (opts.cadenceMs > 0) cfg.cadenceMs = opts.cadenceMs;
    if (opts.stalenessMs > 0) cfg.stalenessMs = opts.stalenessMs;
    if (opts.lsPrefix) cfg.lsPrefix = opts.lsPrefix;
    const m = await loadManifest();
    if (!m.ok) return m;
    buildToolRegistry();
    const pull = await bus.refreshAll({ force: opts.force !== false });
    return { ok: true, manifest: m, pull };
  };

  /* ---------- test hooks ---------- */
  bus.debugFetcher = function (fn) { fetcher = fn; };
  bus.debugReset = function (opts) {
    opts = opts || {};
    cfg.lsPrefix = opts.lsPrefix || "bi.bus.";
    cfg.manifestUrl = opts.manifestUrl || "src/bi/fixtures/manifest.json";
    const doomed = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(cfg.lsPrefix) === 0) doomed.push(k); } } catch { /* noop */ }
    if (opts.wipe !== false) for (const k of doomed) lsDel(k);
    bus.manifest = null;
    bus.tools = [];
    BI.facts.clear();
  };
})();
