// ============================================================================
// quote-u — observability (roadmap task 65)
// ----------------------------------------------------------------------------
// The operational nervous system: a small set of health probes, alerts derived
// from them, portal rate-limit metrics and a bounded structured log, so a
// silent failure in the approval side effects cannot persist unnoticed.
//
//   • token-age health   — outstanding portal links: active/expiring/oldest,
//                          with an alert past the configured age ceiling
//   • outbox failure     — terminal-failed and stale-running jobs alert
//   • rate-limit metrics — live utilisation of the portal's IP/token limiters
//   • structured logs    — one record shape (level/source/event/detail) kept in
//                          a bounded in-memory ring, persisted to `ops_log`
//
// The probes are pure reads over the live services; `log()` records a fact and
// `flush()` persists the recent log tail. Nothing here writes to the system of
// record — observability never mutates the data it observes.
// ============================================================================
window.QU_OBSERVABILITY = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "ops_log";
  const LEVELS = Object.freeze(["debug", "info", "warn", "error"]);
  const STATUSES = Object.freeze(["ok", "warn", "fail"]);
  const DAY_MS = 86400000;

  const DEFAULT_POLICY = Object.freeze({
    token_age_alert_days: 30,
    token_expiry_warn_days: 7,
    outbox_backlog_alert: 25,
    outbox_stale_running_ms: 300000,
    rate_limit_alert_pct: 80,
    log_cap: 500,
    log_doc_cap: 2000,
    max_detail: 4000
  });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    const num = (k, def, min) => (Number.isFinite(Number(p[k])) && Number(p[k]) >= (min === undefined ? 0 : min) ? Number(p[k]) : def);
    return {
      token_age_alert_days: num("token_age_alert_days", DEFAULT_POLICY.token_age_alert_days, 1),
      token_expiry_warn_days: num("token_expiry_warn_days", DEFAULT_POLICY.token_expiry_warn_days, 0),
      outbox_backlog_alert: num("outbox_backlog_alert", DEFAULT_POLICY.outbox_backlog_alert, 1),
      outbox_stale_running_ms: num("outbox_stale_running_ms", DEFAULT_POLICY.outbox_stale_running_ms, 1000),
      rate_limit_alert_pct: num("rate_limit_alert_pct", DEFAULT_POLICY.rate_limit_alert_pct, 1),
      log_cap: num("log_cap", DEFAULT_POLICY.log_cap, 1),
      log_doc_cap: num("log_doc_cap", DEFAULT_POLICY.log_doc_cap, 1),
      max_detail: num("max_detail", DEFAULT_POLICY.max_detail, 200)
    };
  }

  function normalizeLevel(level) {
    const s = String(level === undefined || level === null ? "info" : level).toLowerCase();
    return LEVELS.indexOf(s) === -1 ? "info" : s;
  }

  function nowIso(clock) {
    if (typeof clock === "function") {
      const v = clock();
      return v instanceof Date ? v.toISOString() : String(v);
    }
    return new Date().toISOString();
  }

  function parseMs(v) {
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "number" && isFinite(v)) return v >= 1e12 ? v : (v >= 1e9 ? v * 1000 : null);
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  function randHex(n) {
    if (window.QU_STORE && window.QU_STORE.randHex) return window.QU_STORE.randHex(n);
    const arr = new Uint8Array(n);
    if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    let out = "";
    for (let i = 0; i < arr.length; i++) out += arr[i].toString(16).padStart(2, "0");
    return out.slice(0, n);
  }

  function clampText(v, max) {
    if (v === undefined || v === null) return "";
    const s = String(v);
    return s.length > max ? s.slice(0, max) : s;
  }

  // A structured log record: a level, a source module, an event name and a
  // detail payload. Ids are optional correlation keys (quote/version/job).
  function normalizeRecord(input, opts) {
    opts = opts || {};
    const r = isPlainObject(input) ? input : {};
    const at = r.at ? String(r.at) : nowIso(opts.clock);
    return {
      id: r.id ? String(r.id) : "obs-" + parseMs(at).toString(36) + "-" + randHex(6),
      at: at,
      level: normalizeLevel(r.level),
      source: clampText(r.source || "app", 64),
      event: clampText(r.event || "log", 96),
      quote_id: r.quote_id === undefined ? null : r.quote_id,
      version_id: r.version_id === undefined ? null : r.version_id,
      detail: r.detail === undefined ? null : r.detail
    };
  }

  // ---- the bounded in-memory ring ------------------------------------------

  function createLogSink(opts) {
    opts = opts || {};
    const cap = Number.isFinite(Number(opts.cap)) ? Math.max(1, Number(opts.cap)) : DEFAULT_POLICY.log_cap;
    let records = [];
    let seq = 0;

    function append(record) {
      const rec = Object.assign({}, record, { seq: ++seq });
      records.push(rec);
      if (records.length > cap) records = records.slice(records.length - cap);
      return rec;
    }

    function hydrate(list) {
      const incoming = (Array.isArray(list) ? list : []).filter(r => r && r.id);
      if (!incoming.length) return 0;
      const have = new Set(records.map(r => r.id));
      let added = 0;
      incoming.forEach(r => {
        if (have.has(r.id)) return;
        have.add(r.id);
        records.push(Object.assign({}, r, { seq: ++seq }));
        added++;
      });
      records.sort((a, b) => (parseMs(a.at) || 0) - (parseMs(b.at) || 0));
      if (records.length > cap) records = records.slice(records.length - cap);
      return added;
    }

    function recordsRaw() { return records.slice(); }

    function list(filter) {
      filter = isPlainObject(filter) ? filter : {};
      let out = records.slice();
      if (filter.level) out = out.filter(r => r.level === filter.level);
      if (filter.source) out = out.filter(r => r.source === filter.source);
      if (typeof filter.since === "string" && filter.since) {
        const at = parseMs(filter.since);
        if (at !== null) out = out.filter(r => (parseMs(r.at) || 0) >= at);
      }
      out.reverse(); // newest first
      if (Number.isFinite(Number(filter.limit)) && Number(filter.limit) > 0) out = out.slice(0, Number(filter.limit));
      return out;
    }

    function stats() {
      const byLevel = {};
      LEVELS.forEach(l => { byLevel[l] = 0; });
      records.forEach(r => { if (byLevel[r.level] !== undefined) byLevel[r.level]++; });
      return { count: records.length, cap: cap, by_level: byLevel };
    }

    return {
      cap: cap,
      append: append,
      hydrate: hydrate,
      records: recordsRaw,
      list: list,
      stats: stats,
      size: () => records.length,
      clear: () => { records = []; }
    };
  }

  // ---- the health probes ----------------------------------------------------

  function maxOf(nums) {
    return nums.length ? Math.max.apply(null, nums) : 0;
  }

  function rateSummary(limiter) {
    if (!limiter || typeof limiter.snapshot !== "function") return null;
    const snap = limiter.snapshot();
    const counts = Object.keys(snap).map(k => Number(snap[k]) || 0);
    const busiest = maxOf(counts);
    const max = Number(limiter.max) || 0;
    return {
      keys: counts.length,
      busiest: busiest,
      max: max,
      utilisation_pct: max > 0 ? Math.round((busiest * 100) / max) : 0,
      window_ms: Number(limiter.window_ms) || 0
    };
  }

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const portalTokens = opts.portalTokens || null;
    const outbox = opts.outbox || null;
    const portal = opts.portal || null;
    const policy = normalizePolicy(opts.policy);
    const clock = opts.clock || null;
    const sink = createLogSink({ cap: policy.log_cap });

    function log(level, source, event, detail) {
      return sink.append(normalizeRecord({ level: level, source: source, event: event, detail: detail, at: nowIso(clock) }, { clock: clock }));
    }

    function logs(filter) {
      return sink.list(filter);
    }

    function logStats() {
      return sink.stats();
    }

    // Token-age health: how many portal links are outstanding and how old.
    async function tokenHealth(at) {
      const atMs = parseMs(at) || Date.now();
      const out = {
        total: 0, active: 0, expired: 0, revoked: 0, used: 0,
        expiring_soon: 0, expired_active: 0, oldest_active_days: null,
        alert: false, warn: false
      };
      if (!portalTokens || typeof portalTokens.load !== "function") return out;
      let loaded;
      try { loaded = await portalTokens.load(); } catch (e) { return Object.assign(out, { error: (e && e.message) || String(e) }); }
      if (!loaded || !loaded.ok) return Object.assign(out, { error: (loaded && loaded.detail) || "could not read portal tokens" });
      const records = Array.isArray(loaded.records) ? loaded.records : [];
      out.total = records.length;
      for (const r of records) {
        if (!r) continue;
        let status;
        try { status = window.QU_PORTALTOKENS && window.QU_PORTALTOKENS.statusOf ? window.QU_PORTALTOKENS.statusOf(r, atMs) : null; }
        catch (e) { status = null; }
        if (status === "active") {
          out.active++;
          const created = parseMs(r.created_at);
          if (created !== null) {
            const ageDays = (atMs - created) / DAY_MS;
            if (out.oldest_active_days === null || ageDays > out.oldest_active_days) out.oldest_active_days = ageDays;
          }
          const expires = parseMs(r.expires_at);
          if (expires !== null && (expires - atMs) / DAY_MS <= policy.token_expiry_warn_days) out.expiring_soon++;
        } else if (status === "expired") { out.expired++; out.expired_active++; }
        else if (status === "revoked") out.revoked++;
        else if (status === "used") out.used++;
      }
      out.oldest_active_days = out.oldest_active_days === null ? null : Math.round(out.oldest_active_days * 10) / 10;
      out.alert = out.oldest_active_days !== null && out.oldest_active_days > policy.token_age_alert_days;
      out.warn = !out.alert && out.expiring_soon > 0;
      return out;
    }

    // Outbox health: terminal failures, stale runners and a growing backlog.
    async function outboxHealth() {
      const out = { total: 0, pending: 0, running: 0, done: 0, failed: 0, terminal_failed: 0, stale_running: 0, backlog: 0, alert: false, warn: false };
      if (!outbox || typeof outbox.list !== "function") return out;
      let l;
      try { l = await outbox.list({}); } catch (e) { return Object.assign(out, { error: (e && e.message) || String(e) }); }
      if (!l || !l.ok) return Object.assign(out, { error: (l && l.detail) || "could not read the outbox" });
      const jobs = l.jobs || [];
      const now = Date.now();
      out.total = jobs.length;
      for (const j of jobs) {
        if (!j) continue;
        if (j.state === "pending") out.pending++;
        else if (j.state === "running") {
          out.running++;
          const updated = parseMs(j.updated_at || j.started_at);
          if (updated !== null && now - updated > policy.outbox_stale_running_ms) out.stale_running++;
        } else if (j.state === "done") out.done++;
        else if (j.state === "failed") {
          out.failed++;
          const terminal = Number.isInteger(j.attempts) && j.attempts >= (opts.maxAttempts || 5);
          if (terminal) out.terminal_failed++;
        }
      }
      out.backlog = out.pending + out.failed;
      out.alert = out.terminal_failed > 0;
      out.warn = !out.alert && (out.failed > 0 || out.stale_running > 0 || out.backlog >= policy.outbox_backlog_alert);
      return out;
    }

    function rateLimitMetrics() {
      if (!portal) return { available: false };
      return {
        available: true,
        ip: rateSummary(portal.ipLimiter),
        token: rateSummary(portal.tokenLimiter)
      };
    }

    // Every probe: {name, status, detail, metrics}. status ∈ ok|warn|fail.
    async function probes(at) {
      const [th, oh] = await Promise.all([tokenHealth(at), outboxHealth()]);
      const rl = rateLimitMetrics();
      const out = [];
      out.push({
        name: "token_age",
        status: th.alert ? "fail" : (th.warn ? "warn" : "ok"),
        detail: th.alert
          ? `Oldest outstanding portal link is ${th.oldest_active_days}d old (ceiling ${policy.token_age_alert_days}d).`
          : `${th.active} active link(s), ${th.expiring_soon} expiring soon${th.oldest_active_days === null ? "" : ", oldest " + th.oldest_active_days + "d"}.`,
        metrics: th
      });
      out.push({
        name: "outbox",
        status: oh.alert ? "fail" : (oh.warn ? "warn" : "ok"),
        detail: oh.alert
          ? `${oh.terminal_failed} outbox job(s) failed permanently.`
          : `${oh.pending} pending, ${oh.failed} failed, ${oh.done} done${oh.stale_running ? ", " + oh.stale_running + " stale" : ""}.`,
        metrics: oh
      });
      let rlStatus = "ok";
      let rlDetail = "Portal rate limiters are idle.";
      if (rl.available) {
        const pcts = [rl.ip && rl.ip.utilisation_pct, rl.token && rl.token.utilisation_pct].filter(v => typeof v === "number");
        const peak = maxOf(pcts);
        rlStatus = peak >= 100 ? "fail" : (peak >= policy.rate_limit_alert_pct ? "warn" : "ok");
        rlDetail = peak > 0 ? `Peak rate-limit utilisation ${peak}% (alert at ${policy.rate_limit_alert_pct}%).` : "Portal rate limiters are idle.";
      }
      out.push({ name: "rate_limits", status: rlStatus, detail: rlDetail, metrics: rl });
      const ls = logStats();
      out.push({
        name: "logs",
        status: ls.by_level.error > 0 ? "warn" : "ok",
        detail: `${ls.count}/${ls.cap} log record(s) buffered, ${ls.by_level.error} error(s).`,
        metrics: ls
      });
      return out;
    }

    // Active alerts = the probes that are not ok, in severity order.
    async function alerts(at) {
      const ps = await probes(at);
      const order = { fail: 0, warn: 1, ok: 2 };
      return ps
        .filter(p => p.status !== "ok")
        .sort((a, b) => order[a.status] - order[b.status])
        .map(p => ({ id: p.name, severity: p.status, title: p.name, message: p.detail, metrics: p.metrics }));
    }

    async function health(at) {
      const ps = await probes(at);
      const failed = ps.filter(p => p.status === "fail").length;
      const warned = ps.filter(p => p.status === "warn").length;
      return { ok: failed === 0, at: at || nowIso(clock), probes: ps, failed: failed, warned: warned, alerts: ps.filter(p => p.status !== "ok").length };
    }

    // Persist the recent log tail to the durable `ops_log` document.
    async function flush() {
      if (!store || typeof store.saveChecked !== "function") return { ok: false, code: "no_store", detail: "No document store is attached." };
      const recs = sink.records().slice(-policy.log_doc_cap);
      let last = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const d = await store.loadDoc(DOC);
        const base = d && d.ok ? (d.revision || 0) : 0;
        const save = await store.saveChecked(DOC, { records: recs }, { expectedBase: base });
        if (save && save.ok) return { ok: true, count: recs.length, revision: save.revision };
        last = save;
        if (!save || (save.code !== "conflict" && save.code !== "conflict_stale" && save.code !== "server_lag")) break;
      }
      return Object.assign({ ok: false }, last || { code: "flush_failed", detail: "Could not persist the operations log." });
    }

    async function load() {
      if (!store || typeof store.loadDoc !== "function") return { ok: true, loaded: 0 };
      const d = await store.loadDoc(DOC);
      if (!d || !d.ok || !d.content) return { ok: true, loaded: 0 };
      const recs = Array.isArray(d.content.records) ? d.content.records : (Array.isArray(d.content) ? d.content : []);
      return { ok: true, loaded: sink.hydrate(recs), total: sink.size() };
    }

    function renderZone() {
      const card = document.createElement("section");
      card.className = "card";
      card.innerHTML =
        '<div class="card-title-row"><div><h2>Observability</h2>' +
        '<p class="hint" style="margin:2px 0 0">Health probes over portal-link age, the side-effect outbox and the portal rate limiters, plus a structured log. A silent failure in an approval side effect surfaces here.</p></div>' +
        '<span class="chip" data-obs-chip>…</span></div>' +
        '<div class="obs-probes" data-obs-probes><p class="hint">Reading health…</p></div>' +
        '<div class="obs-logs" data-obs-logs></div>' +
        '<div class="admin-actions"><button class="btn btn-ghost btn-sm" data-obs-refresh>Re-probe</button> <button class="btn btn-ghost btn-sm" data-obs-flush>Persist logs</button></div>';
      const chip = card.querySelector("[data-obs-chip]");
      const probeEl = card.querySelector("[data-obs-probes]");
      const logEl = card.querySelector("[data-obs-logs]");
      const refreshBtn = card.querySelector("[data-obs-refresh]");
      const flushBtn = card.querySelector("[data-obs-flush]");
      function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }
      function paintProbes(health) {
        chip.textContent = health.ok ? "All probes healthy" : health.failed + " failing";
        chip.className = "chip " + (health.ok ? "ok" : "warn");
        probeEl.innerHTML = health.probes.map(p =>
          '<div class="obs-row"><span class="int-chip ' + (p.status === "ok" ? "pass" : "fail") + '">' + esc(p.status) + '</span>' +
          '<div style="min-width:0"><div class="int-name">' + esc(p.name) + "</div>" +
          '<div class="int-detail">' + esc(p.detail) + "</div></div></div>"
        ).join("");
      }
      function paintLogs() {
        const recent = logs({ limit: 8 });
        logEl.innerHTML = recent.length
          ? '<div class="obs-log-head">Recent log</div>' + recent.map(r =>
              '<div class="obs-log-line"><span class="obs-lvl ' + esc(r.level) + '">' + esc(r.level) + '</span>' +
              '<span class="obs-log-src">' + esc(r.source) + "</span>" +
              '<span class="obs-log-ev">' + esc(r.event) + "</span>" +
              '<span class="obs-log-at">' + esc(String(r.at).slice(11, 19)) + "</span></div>"
            ).join("")
          : "";
      }
      async function refresh() {
        try { paintProbes(await health()); } catch (e) { probeEl.innerHTML = '<p class="hint">Probes failed: ' + esc((e && e.message) || e) + "</p>"; }
        paintLogs();
      }
      refreshBtn.addEventListener("click", refresh);
      flushBtn.addEventListener("click", async () => {
        flushBtn.disabled = true;
        try {
          const r = await flush();
          if (window.QU && window.QU.toast) window.QU.toast(r.ok ? "Persisted " + r.count + " log record(s)." : "Log persistence failed: " + (r.detail || r.code));
        } catch (e) { /* surfaced by the toast below */ }
        flushBtn.disabled = false;
      });
      refresh();
      return card;
    }

    function ready() {
      return load().catch(e => ({ ok: false, code: "ops_log_load_failed", detail: (e && e.message) || String(e) }));
    }

    return {
      policy: policy,
      log: log,
      logs: logs,
      logStats: logStats,
      tokenHealth: tokenHealth,
      outboxHealth: outboxHealth,
      rateLimitMetrics: rateLimitMetrics,
      probes: probes,
      alerts: alerts,
      health: health,
      flush: flush,
      load: load,
      renderZone: renderZone,
      ready: ready
    };
  }

  return {
    VERSION,
    DOC,
    LEVELS,
    STATUSES,
    DEFAULT_POLICY,
    normalizePolicy,
    normalizeLevel,
    normalizeRecord,
    createLogSink,
    createService
  };
})();
