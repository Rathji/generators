/* ============================================================
   RMM-U — agent resilience, self-update & safety  (Phase 2 · Task 12)

   An agent that only works on a perfect network is not an agent an MSP
   can trust. This module is the console side of the agent's durability:

     • Offline buffering — a check-in/post that fails is spooled on the
       endpoint and replayed on the next successful contact. The agent
       reports its spool depth on each heartbeat so the console can see
       which endpoints are backed up.
     • Backoff & jitter — reconnects use exponential backoff with jitter
       so a collector outage does not become a reconnect storm. The exact
       schedule is defined once here (`RS.backoffMs`) and mirrored by the
       generated agent (src/rmm.agent.js) and the collector (Task 14).
     • Collector identity — every agent verifies the collector's TLS
       identity (system trust store by default, optional SHA-256 pin).
       Plain HTTP is only allowed when explicitly opted into.
     • Self-update with rollback — the console publishes a signed agent
       build, rolls it out to one device, a group or the fleet, and the
       agent downloads it, verifies the SHA-256, backs up its current
       program and rolls back automatically if the new build fails its
       self-test (`RS.recordUpdate` receives the outcome).
     • Resource caps — CPU nice/io priority, memory and log/spool caps so
       the agent can never materially impact the endpoint.
     • Clean uninstall — the generated agent removes its service, data,
       logs and spool and tells the collector it is going away.

   Releases live in the hidden `updates` document (rmm-v1-updates):
     { kind:"release", id, providerId, platform, version, channel, url,
       sha256, sizeBytes, notes, mandatory, status, publishedAt,
       publishedBy, payloadB64? }

   Per-device update state lives on the device:
     custom.updateRequested  the pending update handed to the agent
     agent.updateHistory[]   a bounded log of applied / rolled-back builds

   window.ERP.resilience is the service (aliased RS).
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const RS = (ERP.resilience = {});

  RS.MODULE = "updates";

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();
  const S = (v, cap) => String(v == null ? "" : v).slice(0, cap || 200);
  const rid = (p) => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ─────────────────────── policy ─────────────────────── */

  /* The resilience policy the console shows and the generated agent
     embeds. Every value is overridable from config.rmm.* so a provider
     can tune it without touching code. */
  RS.POLICY_VERSION = 1;

  RS.policy = function () {
    return {
      version: RS.POLICY_VERSION,
      backoff: {
        baseSeconds: Math.max(1, num(cfg("rmm.backoffBaseSeconds", 5), 5)),
        maxSeconds: Math.max(5, num(cfg("rmm.backoffMaxSeconds", 900), 900)),
        factor: Math.max(1.1, num(cfg("rmm.backoffFactor", 2), 2)),
        jitter: Math.min(1, Math.max(0, num(cfg("rmm.backoffJitter", 0.25), 0.25))),
        maxAttempts: Math.max(1, num(cfg("rmm.retryMaxAttempts", 8), 8)),
      },
      spool: {
        maxBytes: Math.max(65536, num(cfg("rmm.spoolMaxBytes", 26214400), 26214400)),
        maxItems: Math.max(16, num(cfg("rmm.spoolMaxItems", 5000), 5000)),
        flushPerCycle: Math.max(1, num(cfg("rmm.spoolFlushPerCycle", 50), 50)),
      },
      caps: {
        maxCpuPercent: Math.min(100, Math.max(1, num(cfg("rmm.agentMaxCpuPercent", 25), 25))),
        cpuNice: Math.max(0, Math.min(19, num(cfg("rmm.agentCpuNice", 10), 10))),
        ioNice: Math.max(0, Math.min(7, num(cfg("rmm.agentIoNice", 6), 6))),
        maxMemMB: Math.max(32, num(cfg("rmm.agentMaxMemMB", 256), 256)),
        maxJobSeconds: Math.max(10, num(cfg("rmm.jobTimeoutSeconds", 300), 300)),
        maxConcurrentJobs: Math.max(1, num(cfg("rmm.agentMaxConcurrentJobs", 1), 1)),
        logMaxBytes: Math.max(65536, num(cfg("rmm.agentLogMaxBytes", 2097152), 2097152)),
        logKeep: Math.max(1, num(cfg("rmm.agentLogKeep", 3), 3)),
      },
      tls: {
        mode: String(cfg("rmm.tlsMode", "system") || "system").toLowerCase(),
        pinSha256: String(cfg("rmm.tlsPinSha256", "") || "").trim().toLowerCase(),
        allowInsecure: cfg("rmm.tlsAllowInsecure", false) === true || String(cfg("rmm.tlsAllowInsecure", false)) === "true",
      },
      selfUpdate: {
        enabled: cfg("rmm.selfUpdateEnabled", true) === true || String(cfg("rmm.selfUpdateEnabled", true)) === "true",
        channel: String(cfg("rmm.selfUpdateChannel", "stable") || "stable"),
        keepVersions: Math.max(1, num(cfg("rmm.selfUpdateKeepVersions", 2), 2)),
        rollbackOnFailure: cfg("rmm.selfUpdateRollbackOnFailure", true) === true || String(cfg("rmm.selfUpdateRollbackOnFailure", true)) === "true",
        deliveryRetryMinutes: Math.max(1, num(cfg("rmm.updateDeliveryRetryMinutes", 15), 15)),
        historyLimit: Math.max(2, num(cfg("rmm.updateHistoryLimit", 20), 20)),
      },
    };
  };

  /* ─────────────────────── backoff schedule ───────────────────────
     attempt 1..n → a delay in milliseconds. delay = min(max, base *
     factor^(n-1)), then multiplied by (1 + jitter * u) where u is in
     [-1, 0) so jitter only ever shortens (never exceeds the cap). The
     agent adds its own entropy; this function is the canonical shape. */

  RS.backoffMs = function (attempt, opts) {
    const p = (opts && opts.policy) ? opts.policy : RS.policy();
    const b = p.backoff;
    const n = Math.max(1, num(attempt, 1));
    const raw = b.baseSeconds * 1000 * Math.pow(b.factor, n - 1);
    const capped = Math.min(b.maxSeconds * 1000, raw);
    const u = num((opts && opts.u != null) ? opts.u : Math.random(), Math.random());
    const jittered = capped * (1 + b.jitter * (u - 1));
    return Math.max(0, Math.round(jittered));
  };

  /* The full 1..maxAttempts schedule (bounded, for display + tests). */
  RS.backoffSchedule = function (opts) {
    const p = (opts && opts.policy) ? opts.policy : RS.policy();
    const out = [];
    for (let i = 1; i <= p.backoff.maxAttempts; i++) out.push(RS.backoffMs(i, { policy: p, u: 1 }));
    return out;
  };

  RS.shouldRetry = function (attempt, opts) {
    const p = (opts && opts.policy) ? opts.policy : RS.policy();
    return num(attempt, 1) < p.backoff.maxAttempts;
  };

  /* ─────────────────────── TLS / collector identity ─────────────────────── */

  /* Decide how the agent should treat the collector's certificate. A
     non-TLS address is refused unless allowInsecure is explicitly set. */
  RS.tlsConfig = function (collectorUrl) {
    const url = String(collectorUrl || "");
    const p = RS.policy().tls;
    const https = /^https:\/\//i.test(url) || /^wss:\/\//i.test(url);
    const http = /^http:\/\//i.test(url) || /^ws:\/\//i.test(url);
    const out = { url, mode: p.mode, pinSha256: p.pinSha256, secure: https, allowInsecure: p.allowInsecure, warnings: [] };
    if (http) {
      out.mode = "insecure";
      if (!p.allowInsecure) out.warnings.push("The collector address is not TLS-secured. Set rmm.tlsAllowInsecure only for a trusted lab network.");
    } else if (p.mode === "pinned" && p.pinSha256) {
      out.mode = "pinned";
    } else {
      out.mode = "system";
    }
    return out;
  };

  /* ─────────────────────── resource caps ─────────────────────── */

  RS.resourceCaps = function () { return RS.policy().caps; };

  /* ─────────────────────── version compare ─────────────────────── */

  function parts(v) {
    return String(v == null ? "" : v).replace(/^v/i, "").split(/[.\-+]/).slice(0, 4).map((x) => {
      const n = parseInt(x, 10);
      return isFinite(n) ? n : x;
    });
  }

  /* -1 / 0 / 1 — numeric-aware, so 1.10.0 > 1.9.0 and 2.0.0 > 2.0.0-beta. */
  RS.compareVersions = function (a, b) {
    const A = parts(a), B = parts(b);
    const n = Math.max(A.length, B.length);
    for (let i = 0; i < n; i++) {
      let x = A[i], y = B[i];
      if (x === undefined) x = 0;
      if (y === undefined) y = 0;
      const xn = typeof x === "number", yn = typeof y === "number";
      if (xn && yn) { if (x !== y) return x < y ? -1 : 1; continue; }
      if (xn !== yn) return xn ? 1 : -1; /* a prerelease of the same core sorts lower */
      const s = String(x).localeCompare(String(y));
      if (s !== 0) return s < 0 ? -1 : 1;
    }
    return 0;
  };
  RS.isNewer = (a, b) => RS.compareVersions(a, b) > 0;

  /* ─────────────────────── release registry ─────────────────────── */

  async function load() {
    const r = await ERP.store.loadDoc(RS.MODULE);
    return asArr(r.error ? [] : r.records);
  }
  async function save(list) { return ERP.store.saveDoc(RS.MODULE, list); }
  RS.load = load;

  function findRelease(records, id) { return records.find((r) => r.kind === "release" && String(r.id) === String(id)) || null; }

  const listeners = [];
  RS.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  async function audit(action, targetId, summary) {
    try { if (ERP.master && typeof ERP.master.audit === "function") await ERP.master.audit({ action, targetType: "agent_release", targetId, summary }); } catch (e) {}
  }

  function actorName() {
    try { if (ERP.team && ERP.team.me) { const me = ERP.team.me(); if (me && me.displayName) return String(me.displayName); } } catch (e) {}
    return ERP.role || "owner";
  }

  /* Publish an agent build. opts: { providerId, platform, version, url?,
     sha256?, payload?, notes?, channel?, mandatory?, status? }. When a
     payload (the script text) is supplied its SHA-256 is computed here so
     the release and the built script can never disagree. */
  RS.publishRelease = async function (opts) {
    opts = opts || {};
    const providerId = String(opts.providerId || "");
    if (!providerId) return { error: "no_provider", message: "A release belongs to a provider." };
    const platform = String(opts.platform || "").toLowerCase();
    if (["windows", "linux", "macos"].indexOf(platform) === -1) return { error: "unknown_platform", message: "Choose windows, linux or macos." };
    const version = String(opts.version || "").trim();
    if (!/^[0-9]+(\.[0-9]+)*/.test(version)) return { error: "bad_version", message: "Give the release a numeric version such as 1.2.0." };
    let url = String(opts.url || "").trim();
    let sha256 = String(opts.sha256 || "").trim().toLowerCase();
    let sizeBytes = num(opts.sizeBytes, 0);
    const payload = opts.payload == null ? "" : String(opts.payload);
    if (payload) {
      sha256 = E && E.sha256Hex ? E.sha256Hex(payload) : sha256;
      sizeBytes = payload.length;
    }
    if (!url && !payload) return { error: "no_source", message: "Provide the build's download URL, or upload the script itself." };
    if (!sha256) return { error: "no_checksum", message: "A SHA-256 checksum is required so the agent can verify the build." };

    const records = await load();
    /* one active release per provider+platform+version+channel */
    records.forEach((r) => {
      if (r.kind === "release" && String(r.providerId) === providerId && r.platform === platform && r.version === version && r.channel === (opts.channel || "stable")) {
        r.status = "superseded";
      }
    });
    const rec = {
      kind: "release",
      id: rid("rel"),
      providerId,
      platform,
      version,
      channel: S(opts.channel || "stable", 24),
      url: S(url, 600),
      sha256,
      sizeBytes,
      notes: S(opts.notes || "", 400),
      mandatory: !!opts.mandatory,
      status: "active",
      publishedAt: now(),
      publishedBy: actorName(),
    };
    if (payload && payload.length <= 512 * 1024) rec.payload = payload;
    records.push(rec);
    const w = await save(records);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("release", { release: clone(rec) });
    await audit("publish_agent_release", rec.id, "Published agent build " + platform + " " + version + " (" + (rec.url || "inline") + ").");
    return { ok: true, release: clone(rec) };
  };

  RS.listReleases = async function (opts) {
    opts = opts || {};
    let list = (await load()).filter((r) => r.kind === "release");
    if (opts.providerId) list = list.filter((r) => String(r.providerId) === String(opts.providerId));
    if (opts.platform) list = list.filter((r) => r.platform === opts.platform);
    if (opts.channel) list = list.filter((r) => r.channel === opts.channel);
    if (opts.status) list = list.filter((r) => r.status === opts.status);
    list.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    return list.map(clone);
  };

  RS.getRelease = async function (id) {
    const r = findRelease(await load(), id);
    return r ? clone(r) : null;
  };

  RS.removeRelease = async function (id) {
    const records = await load();
    const i = records.findIndex((r) => r.kind === "release" && String(r.id) === String(id));
    if (i < 0) return { error: "not_found" };
    records.splice(i, 1);
    const w = await save(records);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("release_removed", { id });
    return { ok: true };
  };

  /* The newest active release for a platform that is newer than the
     agent's current version (and, when given, matches the channel). */
  RS.latestRelease = async function (providerId, platform, currentVersion, opts) {
    opts = opts || {};
    const channel = opts.channel || RS.policy().selfUpdate.channel;
    let list = (await load()).filter((r) => r.kind === "release" && r.status === "active"
      && String(r.providerId) === String(providerId) && r.platform === platform
      && (opts.anyChannel || r.channel === channel));
    list.sort((a, b) => RS.compareVersions(b.version, a.version));
    const hit = list.find((r) => !currentVersion || RS.isNewer(r.version, currentVersion));
    return hit ? clone(hit) : null;
  };

  RS.releaseFor = async function (providerId, platform, version) {
    const list = (await load()).filter((r) => r.kind === "release" && String(r.providerId) === String(providerId) && r.platform === platform && r.version === version);
    return list.length ? clone(list[list.length - 1]) : null;
  };

  /* ─────────────────────── rollout ─────────────────────── */

  const SUPPORTS_SELF_UPDATE = (dev) => {
    const caps = asArr(asObj(asObj(dev).agent).capabilities);
    return !caps.length || caps.indexOf("self-update") !== -1;
  };

  /* Ask one or many devices to update to a release (or to roll back to a
     version they already hold a backup for). Returns per-device outcome. */
  RS.pushUpdate = async function (opts) {
    opts = opts || {};
    const providerId = String(opts.providerId || "");
    if (!providerId) return { error: "no_provider" };
    const deviceIds = [...new Set(asArr(opts.deviceIds).map(String).filter(Boolean))];
    if (!deviceIds.length) return { error: "no_targets", message: "Select at least one device." };
    let release = null;
    if (!opts.rollback) {
      if (opts.releaseId) release = await RS.getRelease(opts.releaseId);
      else if (opts.version) release = await RS.releaseFor(providerId, opts.platform, opts.version);
      if (!release) return { error: "no_release", message: "Publish a build first." };
      if (String(release.providerId) !== providerId) return { error: "wrong_provider" };
    } else if (opts.version) {
      release = { version: String(opts.version), url: "", sha256: "", rollback: true, providerId, platform: opts.platform || "" };
    }
    let queued = 0, skipped = 0;
    const at = now();
    for (const id of deviceIds) {
      const g = await D.get(providerId, id);
      if (g.error) { skipped++; continue; }
      const dev = g.device;
      if (!SUPPORTS_SELF_UPDATE(dev)) {
        const custom = Object.assign({}, asObj(dev.custom));
        custom.updateError = "This agent does not support self-update.";
        await D.update(providerId, id, { custom, agent: Object.assign({}, asObj(dev.agent), { updatePending: false, updateError: custom.updateError }) });
        skipped++;
        continue;
      }
      const custom = Object.assign({}, asObj(dev.custom));
      custom.updateRequested = {
        requestId: rid("upd"),
        releaseId: release ? release.id : "",
        version: release ? release.version : "",
        platform: release ? release.platform : "",
        url: release ? release.url : "",
        sha256: release ? release.sha256 : "",
        sizeBytes: release ? num(release.sizeBytes, 0) : 0,
        mandatory: !!(release && release.mandatory),
        rollback: !!opts.rollback,
        reason: S(opts.reason || (opts.rollback ? "Rollback requested from the console" : "Update requested from the console"), 200),
        requestedAt: at,
        requestedBy: opts.requestedBy || actorName(),
        attempt: 0,
        deliveredAt: "",
      };
      delete custom.updateError;
      const agent = Object.assign({}, asObj(dev.agent), { updatePending: true, updateRequestedAt: at, updateError: "" });
      const u = await D.update(providerId, id, { custom, agent });
      if (!u.error) queued++;
    }
    notify("update_push", { providerId, count: queued, rollback: !!opts.rollback });
    await audit("push_agent_update", providerId,
      (opts.rollback ? "Requested rollback on " : "Requested update to " + (release ? release.version : "?") + " on ") + queued + " device(s).");
    return { ok: true, queued, skipped, release: release ? clone(release) : null };
  };

  RS.cancelUpdate = async function (providerId, deviceIds) {
    let n = 0;
    for (const id of [...new Set(asArr(deviceIds).map(String))]) {
      const g = await D.get(providerId, id);
      if (g.error) continue;
      const custom = Object.assign({}, asObj(g.device.custom));
      if (!custom.updateRequested) continue;
      delete custom.updateRequested;
      delete custom.updateInFlight;
      await D.update(providerId, id, { custom, agent: Object.assign({}, asObj(g.device.agent), { updatePending: false, updateRequestedAt: "" }) });
      n++;
    }
    return { ok: true, cancelled: n };
  };

  /* The update, if any, to hand back with a device's heartbeat. Marks the
     delivery so a device that never reports is re-offered after the retry
     window, without re-delivering on every single heartbeat. */
  RS.deliverUpdate = async function (providerId, deviceId, dev) {
    const custom = asObj(dev && dev.custom);
    const req = asObj(custom.updateRequested);
    if (!req.releaseId && !req.rollback && !req.version) return null;
    if (!SUPPORTS_SELF_UPDATE(dev)) return null;
    if (!RS.policy().selfUpdate.enabled) return null;
    const retryMs = RS.policy().selfUpdate.deliveryRetryMinutes * 60000;
    if (req.deliveredAt && Date.now() - Date.parse(req.deliveredAt) < retryMs) return null;
    const at = now();
    const next = Object.assign({}, req, { attempt: num(req.attempt, 0) + 1, deliveredAt: at });
    const newCustom = Object.assign({}, custom, { updateRequested: next });
    const r = await D.update(providerId, deviceId, { custom: newCustom });
    if (r.error) return null;
    return {
      requestId: next.requestId,
      releaseId: next.releaseId,
      version: next.version,
      platform: next.platform,
      url: next.url,
      sha256: next.sha256,
      sizeBytes: num(next.sizeBytes, 0),
      mandatory: !!next.mandatory,
      rollback: !!next.rollback,
      reason: next.reason,
      attempt: next.attempt,
      keepVersions: RS.policy().selfUpdate.keepVersions,
      caps: RS.resourceCaps(),
    };
  };

  /* The agent reports the outcome of a self-update (or rollback). */
  RS.recordUpdate = async function (req) {
    req = req || {};
    const deviceId = String(req.deviceId || "");
    if (!deviceId) return { ok: false, error: "no_device" };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason, message: H_reason(auth.reason) };
    const providerId = auth.providerId || req.providerId || "";
    const g = await D.get(providerId, deviceId);
    if (g.error) return { ok: false, error: "unknown_device" };
    const dev = g.device;
    const custom = Object.assign({}, asObj(dev.custom));
    const reqd = asObj(custom.updateRequested);
    const agent = Object.assign({}, asObj(dev.agent));
    const at = now();
    const fromVersion = String(req.fromVersion || dev.agentVersion || "");
    const version = String(req.version || agent.version || fromVersion);
    const ok = req.ok !== false;
    const rolledBack = req.rolledBack === true || req.rollback === true || (ok === false && req.rolledBack !== false && RS.policy().selfUpdate.rollbackOnFailure);
    const entry = {
      at,
      requestId: reqd.requestId || req.requestId || "",
      fromVersion,
      version: rolledBack ? fromVersion : version,
      targetVersion: reqd.version || req.version || "",
      ok,
      rolledBack,
      error: S(req.error || "", 300),
    };
    const hist = asArr(agent.updateHistory);
    hist.push(entry);
    agent.updateHistory = hist.slice(-RS.policy().selfUpdate.historyLimit);
    agent.updatePending = false;
    agent.updateRequestedAt = "";
    agent.rolledBack = rolledBack;
    delete custom.updateRequested;
    delete custom.updateInFlight;
    custom.lastUpdate = entry;
    if (rolledBack) custom.updateError = S(req.error || ("The build failed and the agent rolled back to " + fromVersion + "."), 300);
    else delete custom.updateError;
    if (ok && !rolledBack && version) { agent.version = version; dev.agentVersion = version; }
    const r = await D.update(providerId, deviceId, { custom, agent, agentVersion: (ok && !rolledBack && version) ? version : dev.agentVersion });
    if (r.error) return { ok: false, error: r.error, message: r.message };
    notify("update_result", { deviceId, providerId, ok, rolledBack });
    await audit("agent_update_result", deviceId,
      (rolledBack ? "Rolled back" : ok ? "Updated" : "Update failed on") + " " + (dev.hostname || deviceId) + (version ? " (" + fromVersion + " → " + version + ")" : "") + ".");
    return { ok: true, deviceId, state: rolledBack ? "rolled-back" : (ok ? "updated" : "failed"), entry: clone(entry) };
  };

  function H_reason(r) {
    return ({ no_device: "No device id was supplied.", no_credential: "This device has never enrolled.", revoked: "This device's credential has been revoked.", invalid_credential: "The credential did not match this device." })[r] || "The device was not authenticated.";
  }

  /* Re-offer updates whose delivery was never acknowledged, and clear
     requests that have exhausted their attempts. Called by the console. */
  RS.reapUpdates = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const retryMs = RS.policy().selfUpdate.deliveryRetryMinutes * 60000;
    const out = { offered: 0, abandoned: 0 };
    for (const dev of asArr(g.provider.devices).map(D.normalizeDevice)) {
      const req = asObj(asObj(dev.custom).updateRequested);
      if (!req.requestId) continue;
      const stale = req.deliveredAt && Date.now() - Date.parse(req.deliveredAt) > retryMs * 4;
      if (stale && num(req.attempt, 0) >= RS.policy().backoff.maxAttempts) {
        const custom = Object.assign({}, asObj(dev.custom));
        delete custom.updateRequested;
        custom.updateError = "The agent never reported the update outcome; the request was abandoned.";
        await D.update(providerId, dev.id, { custom, agent: Object.assign({}, asObj(dev.agent), { updatePending: false }) });
        out.abandoned++;
      } else if (stale) {
        out.offered++;
      }
    }
    return Object.assign({ ok: true }, out);
  };

  /* ─────────────────────── reporting ─────────────────────── */

  RS.spoolSummary = function (dev) {
    const sp = asObj(asObj(dev && dev.custom).spool);
    return {
      pending: num(sp.pending, 0),
      bytes: num(sp.bytes, 0),
      oldestAt: String(sp.oldestAt || ""),
      updatedAt: String(sp.updatedAt || ""),
      backedUp: num(sp.pending, 0) > 0,
    };
  };

  RS.pendingCount = function (dev) {
    const req = asObj(asObj(dev && dev.custom).updateRequested);
    return req.requestId ? 1 : 0;
  };

  RS.rolloutStatus = async function (providerId) {
    const g = await T.get(providerId);
    if (g.error) return g;
    const releases = await RS.listReleases({ providerId });
    const devices = asArr(g.provider.devices).map(D.normalizeDevice);
    const byVersion = {};
    let pending = 0, rolledBack = 0, backedUp = 0;
    const rows = devices.map((d) => {
      const v = d.agentVersion || "—";
      byVersion[v] = (byVersion[v] || 0) + 1;
      const p = RS.pendingCount(d);
      pending += p;
      const rb = !!(asObj(d.agent).rolledBack);
      if (rb) rolledBack++;
      const spool = RS.spoolSummary(d);
      if (spool.backedUp) backedUp++;
      return {
        deviceId: d.id,
        hostname: d.hostname || d.displayName,
        os: d.os && (d.os.family || d.os.name),
        version: v,
        pending: p,
        rolledBack: rb,
        spoolPending: spool.pending,
        spoolBytes: spool.bytes,
        lastUpdate: asObj(asObj(d.custom).lastUpdate),
        updateError: S(asObj(d.custom).updateError || "", 200),
      };
    });
    return {
      providerId,
      releases: releases.length,
      activeReleases: releases.filter((r) => r.status === "active").length,
      devices: rows,
      byVersion,
      pending,
      rolledBack,
      backedUp,
      latest: releases.filter((r) => r.status === "active").sort((a, b) => RS.compareVersions(b.version, a.version))[0] || null,
    };
  };

  /* ─────────────────────── display ─────────────────────── */

  RS.deviceSection = function (dev) {
    const ui = ERP.ui;
    const req = asObj(asObj(dev && dev.custom).updateRequested);
    const spool = RS.spoolSummary(dev);
    const agent = asObj(dev && dev.agent);
    const rows = [
      ["Agent version", ERP.ui.esc(dev && dev.agentVersion || "—")],
      ["Update", req.requestId ? ui.badge("pending " + (req.version || ""), "warn") : (agent.rolledBack ? ui.badge("rolled back", "danger") : ui.badge("current", "success"))],
      ["Last update", asObj(asObj(dev && dev.custom).lastUpdate).at ? ui.dateTime(asObj(dev.custom).lastUpdate.at) : "—"],
      ["Offline buffer", spool.pending ? ui.badge(spool.pending + " item(s) · " + D.bytesHuman(spool.bytes), "warn") : ui.badge("empty", "muted")],
    ];
    const err = asObj(dev && dev.custom).updateError;
    return '<h4 class="rmm-section-title">Resilience &amp; updates</h4>' +
      '<div class="rmm-kv">' + rows.map((x) => '<div class="rmm-kv-row"><span>' + ERP.ui.esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>" +
      (err ? '<div class="erp-alert tone-warn">' + ERP.ui.esc(err) + "</div>" : "");
  };

  function versionSpreadRows(status) {
    return Object.keys(status.byVersion).sort((a, b) => RS.compareVersions(b, a)).map((v) => ({ version: v, count: String(status.byVersion[v]) }));
  }

  /* The Devices → Updates console: publish builds, roll them out, watch
     the version spread and the offline-buffer backlog. */
  RS.renderUpdates = async function (panel, opts) {
    if (!panel) return;
    const ui = ERP.ui, esc = ui.esc;
    const providerId = opts.providerId;
    const provider = opts.provider;
    const toast = opts.toast || (() => {});
    const refresh = opts.refresh || (() => {});
    let lastRelease = null;

    try { await RS.reapUpdates(providerId); } catch (e) {}
    const releases = await RS.listReleases({ providerId });
    const status = await RS.rolloutStatus(providerId);
    const policy = RS.policy();
    const tls = RS.tlsConfig(ERP.agent ? ERP.agent.defaultCollectorUrl() : "");
    const platformOpts = (ERP.agent ? ERP.agent.platforms() : []).map((p) => ({ value: p.id, label: p.label }));

    const releaseRows = releases.map((r) => ({
      id: "<code>" + esc(r.id) + "</code>",
      version: "<b>" + esc(r.version) + "</b> " + (r.mandatory ? ui.badge("mandatory", "warn") : ""),
      platform: esc(r.platform),
      channel: ui.badge(r.channel, "muted"),
      source: r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">link</a>' : (r.payload ? '<span class="erp-sub">inline ' + D.bytesHuman((r.payload || "").length) + "</span>" : "—"),
      checksum: '<code class="erp-sub">' + esc(String(r.sha256 || "").slice(0, 16)) + "…</code>",
      status: ui.badge(r.status, r.status === "active" ? "success" : "muted"),
      published: ui.dateTime(r.publishedAt),
      actions: (r.status === "active" ? ui.btn("Roll out…", { small: true, act: "rs-push", arg: r.id }) + " " : "") +
        ui.btn("Remove", { small: true, danger: true, act: "rs-remove", arg: r.id }),
    }));

    const deviceRows = status.devices.map((d) => ({
      host: "<b>" + esc(d.hostname || d.deviceId) + "</b>" + (d.os ? '<div class="erp-sub">' + esc(d.os) + "</div>" : ""),
      version: esc(d.version),
      pending: d.pending ? ui.badge(d.pending + " pending", "warn") : (d.rolledBack ? ui.badge("rolled back", "danger") : ui.badge("current", "success")),
      spool: d.spoolPending ? ui.badge(d.spoolPending + " · " + D.bytesHuman(d.spoolBytes), "warn") : '<span class="erp-sub">empty</span>',
      lastUpdate: d.lastUpdate && d.lastUpdate.at ? ui.dateTime(d.lastUpdate.at) + (d.lastUpdate.rolledBack ? " " + ui.badge("rollback", "danger") : "") : '<span class="erp-sub">—</span>',
      actions: ui.btn("Update…", { small: true, act: "rs-push-device", arg: d.deviceId }) +
        (d.pending ? " " + ui.btn("Cancel", { small: true, danger: true, act: "rs-cancel", arg: d.deviceId }) : ""),
    }));

    panel.innerHTML =
      ui.grid([
        ui.statCard({ label: "Releases", value: String(status.releases), sub: status.activeReleases + " active" }),
        ui.statCard({ label: "Updates pending", value: String(status.pending), tone: status.pending ? "warn" : null, sub: "awaiting agent report" }),
        ui.statCard({ label: "Rolled back", value: String(status.rolledBack), tone: status.rolledBack ? "danger" : null, sub: "bad build caught by the agent" }),
        ui.statCard({ label: "Offline-buffered", value: String(status.backedUp), tone: status.backedUp ? "warn" : null, sub: "agents replaying a spool" }),
      ], "erp-kpi-grid") +
      ui.card("Publish an agent build", ui.form(
        '<div class="erp-inline-form">' +
          '<div class="field"><label>Platform</label><select name="rsPlatform">' + platformOpts.map((o) => '<option value="' + esc(o.value) + '">' + esc(o.label) + "</option>").join("") + "</select></div>" +
          '<div class="field"><label>Version</label><input type="text" name="rsVersion" placeholder="1.1.0"></div>' +
          '<div class="field"><label>Channel</label><input type="text" name="rsChannel" value="' + esc(policy.selfUpdate.channel) + '"></div>' +
        "</div>" +
        ui.text("rsUrl", "Build download URL", "", "https://…/rmm-u-agent-1.1.0.ps1") +
        ui.text("rsSha", "SHA-256 checksum", "", "leave blank when uploading a file") +
        ui.check("rsMandatory", "Mandatory update", false) +
        ui.textarea("rsNotes", "Release notes", "", 2) +
        '<p class="erp-sub">Security: a build is only installed when its SHA-256 matches. Publish a URL, or upload the script and the checksum is computed for you.</p>',
        ui.btn("Upload &amp; publish…", { small: true, act: "rs-upload" }) + " " + ui.btn("Publish", { small: true, primary: true, act: "rs-publish" })
      )) +
      ui.card("Releases (" + releases.length + ")",
        ui.table([
          { key: "version", label: "Version", render: (r) => r.version },
          { key: "platform", label: "Platform" },
          { key: "channel", label: "Channel", render: (r) => r.channel },
          { key: "source", label: "Source" },
          { key: "checksum", label: "SHA-256" },
          { key: "status", label: "Status", render: (r) => r.status },
          { key: "published", label: "Published" },
          { key: "actions", label: "", render: (r) => r.actions },
        ], releaseRows, { scroll: true, emptyText: "No agent builds published yet." })) +
      ui.card("Fleet versions", ui.table([
        { key: "device", label: "Device", render: (r) => r.host },
        { key: "version", label: "Agent" },
        { key: "pending", label: "Update", render: (r) => r.pending },
        { key: "spool", label: "Offline buffer", render: (r) => r.spool },
        { key: "lastUpdate", label: "Last update", render: (r) => r.lastUpdate },
        { key: "actions", label: "", render: (r) => r.actions },
      ], deviceRows, { scroll: true, emptyText: "No devices enrolled yet." })) +
      ui.card("Version spread", ui.table([
        { key: "version", label: "Agent version" },
        { key: "count", label: "Devices", align: "right" },
      ], versionSpreadRows(status), { emptyText: "No agents reporting yet." })) +
      ui.card("Resilience policy", '<div class="rmm-kv">' +
        kvRow("Backoff", policy.backoff.baseSeconds + "s base · ×" + policy.backoff.factor + " · " + policy.backoff.jitter * 100 + "% jitter · cap " + policy.backoff.maxSeconds + "s · " + policy.backoff.maxAttempts + " attempts") +
        kvRow("Offline buffer", D.bytesHuman(policy.spool.maxBytes) + " · " + policy.spool.maxItems + " items · flush " + policy.spool.flushPerCycle + "/cycle") +
        kvRow("Resource caps", "nice " + policy.caps.cpuNice + " · ionice " + policy.caps.ioNice + " · CPU " + policy.caps.maxCpuPercent + "% · mem " + policy.caps.maxMemMB + " MB · " + policy.caps.maxConcurrentJobs + " concurrent job(s)") +
        kvRow("Logs", D.bytesHuman(policy.caps.logMaxBytes) + " × " + policy.caps.logKeep + " rotations") +
        kvRow("Collector identity", ui.badge(tls.mode, tls.mode === "pinned" ? "success" : tls.mode === "insecure" ? "danger" : "info") + (tls.pinSha256 ? ' <code class="erp-sub">' + esc(tls.pinSha256.slice(0, 16)) + "…</code>" : "")) +
        kvRow("Self-update", policy.selfUpdate.enabled ? ui.badge("enabled", "success") + " " + esc(policy.selfUpdate.channel) : ui.badge("disabled", "muted")) +
        "</div>" +
        (tls.warnings.length ? '<div class="erp-alert tone-warn">' + esc(tls.warnings.join(" ")) + "</div>" : ""));

    function kvRow(k, v) { return '<div class="rmm-kv-row"><span>' + esc(k) + "</span><b>" + v + "</b></div>"; }

    function readForm() {
      const val = (n) => { const el = panel.querySelector('[name="' + n + '"]'); return el ? el.value : ""; };
      const chk = (n) => { const el = panel.querySelector('[name="' + n + '"]'); return !!(el && el.checked); };
      return { platform: val("rsPlatform"), version: val("rsVersion"), channel: val("rsChannel") || "stable", url: val("rsUrl"), sha256: val("rsSha"), mandatory: chk("rsMandatory"), notes: val("rsNotes") };
    }

    async function pushModal(release, presetDeviceId) {
      const targets = [{ value: "all", label: "Every device" }, { value: "online", label: "Every online device" }]
        .concat(status.devices.map((d) => ({ value: d.deviceId, label: (d.hostname || d.deviceId) + " — " + d.version })));
      const body = ui.form(
        (release ? '<p class="erp-modal-note">Roll out <b>' + esc(release.version) + "</b> (" + esc(release.platform) + "). The agent verifies the build's SHA-256 and rolls back automatically if it fails.</p>" : "") +
        ui.select("rsTarget", "Target", targets, presetDeviceId || "online") +
        ui.check("rsForce", "Include devices that do not support self-update (they will be skipped)", false),
        ui.btn("Cancel", { small: true, attrs: { "data-ui-close": "1" } }) + " " + ui.btn("Roll out", { small: true, primary: true, act: "rs-push-do" })
      );
      ui.modal({ title: release ? "Roll out " + release.version : "Roll out update", body });
      const m = document.querySelector("#uiModal");
      m.querySelector("[data-act=rs-push-do]").onclick = async () => {
        const v = ui.collect(m, ["rsTarget", "rsForce"]);
        const all = status.devices.map((d) => d.deviceId);
        let ids;
        if (v.rsTarget === "all") ids = all;
        else if (v.rsTarget === "online") {
          const g = await T.get(providerId);
          ids = asArr(g.provider.devices).filter((d) => D.effectiveStatus(D.normalizeDevice(d)) === "online").map((d) => d.id);
        } else ids = [v.rsTarget];
        if (!ids.length) { toast("No devices match that target.", "warn"); return; }
        const r = await RS.pushUpdate({ providerId, deviceIds: ids, releaseId: release ? release.id : undefined });
        ui.closeModal();
        toast(r.error ? "Update failed: " + (r.message || r.error) : "Update queued for " + r.queued + " device(s)" + (r.skipped ? " (" + r.skipped + " skipped)" : "") + ".", r.error ? "error" : "success");
        refresh();
      };
    }

    ui.bind(panel, "click", "[data-act]", async (t, e, act, arg) => {
      if (act === "rs-publish") {
        const f = readForm();
        if (!f.platform || !f.version) { toast("Choose a platform and version.", "warn"); return; }
        t.disabled = true;
        const r = await RS.publishRelease(Object.assign({ providerId }, f));
        t.disabled = false;
        if (r.error) { toast("Publish failed: " + (r.message || r.error), "error"); return; }
        lastRelease = r.release;
        toast("Published " + r.release.platform + " " + r.release.version + ".");
        refresh();
        return;
      }
      if (act === "rs-upload") {
        const f = readForm();
        if (!f.version) { toast("Give the build a version first.", "warn"); return; }
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".ps1,.sh,.txt,.js";
        input.onchange = async () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const text = await file.text();
          let url = "";
          try {
            if (root.uploadPlugin) {
              const up = await root.uploadPlugin(file, { expires: Date.now() + 365 * 24 * 3600 * 1000 });
              if (up && up.url) url = up.url;
            }
          } catch (err) { url = ""; }
          const r = await RS.publishRelease({ providerId, platform: f.platform, version: f.version, channel: f.channel, url, payload: text, notes: f.notes, mandatory: f.mandatory });
          if (r.error) { toast("Publish failed: " + (r.message || r.error), "error"); return; }
          toast("Published " + r.release.version + " (" + D.bytesHuman(text.length) + ", checksum " + r.release.sha256.slice(0, 10) + "…).");
          refresh();
        };
        input.click();
        return;
      }
      if (act === "rs-push") { const rel = releases.find((r) => r.id === arg); return pushModal(rel, ""); }
      if (act === "rs-push-device") { return pushModal(status.latest, arg); }
      if (act === "rs-cancel") { const r = await RS.cancelUpdate(providerId, [arg]); toast(r.cancelled ? "Update request cancelled." : "Nothing to cancel.", r.cancelled ? "success" : "warn"); return refresh(); }
      if (act === "rs-remove") {
        const ok = await ui.confirm({ title: "Remove release", message: "Agents already holding this build keep it; it can no longer be rolled out.", okLabel: "Remove", danger: true });
        if (!ok) return;
        const r = await RS.removeRelease(arg);
        toast(r.error ? "Remove failed: " + r.error : "Release removed.", r.error ? "error" : "success");
        return refresh();
      }
    });
  };

  RS.init = function () { return RS; };
})();
