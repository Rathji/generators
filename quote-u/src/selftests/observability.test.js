(function () {
  const T = window.QU_SELFTEST;
  const OB = window.QU_OBSERVABILITY;
  const QS = window.QU_STORE;
  if (!T || !OB || !QS) return;

  const DAY = 86400000;
  function iso(ms) { return new Date(ms).toISOString(); }

  function makeKv(map) {
    return {
      get: async k => map.get(k),
      set: async (k, v) => { map.set(k, v); },
      delete: async k => { map.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => { const f = files.get(name); return f ? f.text : null; },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeStore() {
    return QS.create({ ns: "obs" + QS.randHex(6), kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: QS.DEFAULT_MODULES });
  }

  function limiter(max, window_ms, counts) {
    return { max: max, window_ms: window_ms, snapshot: () => Object.assign({}, counts) };
  }

  T.register("observability: token-age and outbox probes raise the right alerts", async () => {
    const bad = [];
    const now = Date.now();
    const tokens = {
      load: async () => ({ ok: true, records: [
        { id: "t1", created_at: iso(now - 40 * DAY), expires_at: null, revoked_at: null },
        { id: "t2", created_at: iso(now - 2 * DAY), expires_at: iso(now + 2 * DAY), revoked_at: null },
        { id: "t3", created_at: iso(now - 1 * DAY), expires_at: iso(now - DAY), revoked_at: null },
        { id: "t4", created_at: iso(now - 3 * DAY), expires_at: null, revoked_at: iso(now - DAY) }
      ] })
    };
    const outbox = {
      list: async () => ({ ok: true, jobs: [
        { id: "j1", state: "failed", attempts: 5 },
        { id: "j2", state: "done", attempts: 1 },
        { id: "j3", state: "pending", attempts: 0 }
      ] })
    };
    const svc = OB.createService({ portalTokens: tokens, outbox: outbox, policy: { token_age_alert_days: 30, outbox_backlog_alert: 25 }, maxAttempts: 5 });

    const th = await svc.tokenHealth(now);
    if (th.total !== 4) bad.push("token total = " + th.total);
    if (th.active !== 2) bad.push("active = " + th.active);
    if (th.expired !== 1) bad.push("expired = " + th.expired);
    if (th.revoked !== 1) bad.push("revoked = " + th.revoked);
    if (th.expiring_soon !== 1) bad.push("expiring_soon = " + th.expiring_soon);
    if (!th.alert) bad.push("an outstanding link past the age ceiling did not alert");

    const oh = await svc.outboxHealth();
    if (oh.total !== 3 || oh.terminal_failed !== 1 || !oh.alert) bad.push("outbox health = " + JSON.stringify(oh));

    const ps = await svc.probes(now);
    const byName = {};
    ps.forEach(p => { byName[p.name] = p; });
    if (byName.token_age.status !== "fail") bad.push("token_age status = " + byName.token_age.status);
    if (byName.outbox.status !== "fail") bad.push("outbox status = " + byName.outbox.status);
    const alerts = await svc.alerts(now);
    if (alerts.length < 2) bad.push("alerts = " + alerts.length);
    const health = await svc.health(now);
    if (health.ok) bad.push("health.ok true despite failing probes");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "token-age alert past the ceiling, terminal outbox failure alerts, probes + alerts + health agree" };
  });

  T.register("observability: rate-limit metrics track portal limiter utilisation", async () => {
    const bad = [];
    const portal = {
      ipLimiter: limiter(100, 60000, { "203.0.113.9": 85 }),
      tokenLimiter: limiter(600, 60000, { abc: 12 })
    };
    const svc = OB.createService({ portal: portal, policy: { rate_limit_alert_pct: 80 } });
    const rl = svc.rateLimitMetrics();
    if (!rl.available) bad.push("rate limiters reported unavailable");
    else {
      if (rl.ip.utilisation_pct !== 85) bad.push("ip utilisation = " + rl.ip.utilisation_pct);
      if (rl.ip.max !== 100) bad.push("ip max = " + rl.ip.max);
      if (rl.token.utilisation_pct !== 2) bad.push("token utilisation = " + rl.token.utilisation_pct);
    }
    const ps = await svc.probes();
    const rlProbe = ps.find(p => p.name === "rate_limits");
    if (!rlProbe || rlProbe.status !== "warn") bad.push("rate_limits status = " + (rlProbe && rlProbe.status));

    const idle = OB.createService({ portal: { ipLimiter: limiter(100, 60000, {}), tokenLimiter: limiter(600, 60000, {}) } });
    const idleHealth = await idle.health();
    const idleProbes = await idle.probes();
    const idleRl = idleProbes.find(p => p.name === "rate_limits");
    if (idleRl.status !== "ok") bad.push("idle rate_limits = " + idleRl.status);
    if (!idleHealth.ok) bad.push("idle health reported a failure");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "85% IP utilisation warns, an idle limiter is ok, and the probe set reflects both" };
  });

  T.register("observability: the structured log is bounded, filterable and persists to ops_log", async () => {
    const bad = [];
    const store = makeStore();
    const svc = OB.createService({ store: store, policy: { log_cap: 5, log_doc_cap: 50 } });
    svc.log("info", "approval", "side_effect_0", { i: 0 });
    svc.log("info", "approval", "side_effect_1", { i: 1 });
    svc.log("error", "outbox", "job_failed", { job: "j1" });
    const recent = svc.logs({});
    if (recent.length !== 3) bad.push("logged " + recent.length);
    if (recent[0].event !== "job_failed") bad.push("logs are not newest-first");
    const stats = svc.logStats();
    if (stats.by_level.error !== 1 || stats.by_level.info !== 2) bad.push("level stats = " + JSON.stringify(stats.by_level));
    if (svc.logs({ level: "error" }).length !== 1) bad.push("level filter broken");
    if (svc.logs({ source: "approval" }).length !== 2) bad.push("source filter broken");

    const f = await svc.flush();
    if (!f.ok) bad.push("flush failed: " + JSON.stringify(f));
    const svc2 = OB.createService({ store: store, policy: { log_cap: 5 } });
    const l = await svc2.load();
    if (!l.ok || l.loaded !== 3) bad.push("reload loaded " + JSON.stringify(l));
    if (svc2.logStats().count !== 3) bad.push("rehydrated count = " + svc2.logStats().count);

    for (let i = 0; i < 10; i++) svc2.log("info", "x", "e" + i);
    if (svc2.logStats().count !== 5) bad.push("ring cap = " + svc2.logStats().count);

    const rec = OB.normalizeRecord({ level: "NOPE", source: "s", event: "e", at: "2026-05-01T00:00:00.000Z" });
    if (rec.level !== "info") bad.push("unknown level not normalized to info");
    if (!rec.id) bad.push("a log record has no id");

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "log ring is capped at 5, filters by level/source, and a flush/reload round-trips the tail" };
  });
})();
