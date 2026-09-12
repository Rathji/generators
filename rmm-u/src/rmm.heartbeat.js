/* ============================================================
   RMM-U — heartbeat, presence & capabilities  (Phase 2 · Task 8)

   Once a device is enrolled (src/rmm.enrollment.js), it check-ins on
   a configurable interval. Each heartbeat is authenticated per device
   against its stored credential hash, and carries enough context for
   the console to reason about the endpoint:

     • where it is now — hostname, network interfaces, primary IP/MAC;
     • how healthy it is — agent version and reported capabilities;
     • how its clock compares with the collector's — clock-skew, so a
       monitoring engine never trusts a skewed timestamp blindly;
     • whether its network changed — the console keeps a bounded
       network-change history per device.

   The collector side owns liveness: a device is online while it has
   reported within the stale threshold, stale within a grace multiple,
   and offline beyond it (see src/rmm.devices.js `liveness`, driven by
   config.rmm.staleAfterMinutes). `H.sweep` walks a tenant, derives the
   state of every device, records presence transitions and reports
   them — the input the alert pipeline (Phase 5) fires agent-offline
   monitors from.

   window.ERP.heartbeat is the service. The Phase-3 collector
   (Task 14) mirrors the same rules server-side; the engine here is
   what the console uses to validate and to present device presence.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = ERP.enrollment;
  const H = (ERP.heartbeat = {});

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d || 0); };
  const now = () => new Date().toISOString();

  H.DEFAULT_INTERVAL = () => Math.max(30, num(cfg("rmm.heartbeatSeconds", 300), 300));
  H.intervalSeconds = (opts) => Math.max(30, num((opts || {}).intervalSeconds, H.DEFAULT_INTERVAL()));
  H.NETWORK_HISTORY = 12;

  const REASONS = {
    no_device: "No device id was supplied.",
    no_credential: "This device has never enrolled.",
    revoked: "This device's credential has been revoked.",
    invalid_credential: "The credential did not match this device.",
  };
  H.reasonText = (r) => REASONS[r] || "The device was not authenticated.";

  let listeners = [];
  H.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  /* ─────────────────────── network fingerprint ─────────────────────── */

  /* A stable, order-independent signature of an endpoint's network
     identity: every interface's MAC, sorted IPv4 set and gateway. Used
     to detect a move between networks (laptop on a different LAN, a
     server re-addressed) without trusting any single field. */
  H.fingerprint = function (x) {
    if (!x) return "";
    const ifs = asArr(asObj(x).interfaces || x.interfaces);
    if (ifs.length) {
      return ifs.map((i) => {
        const o = asObj(i);
        return [(o.mac || "").toLowerCase(), asArr(o.ip4).map(String).sort().join("|"), o.gateway || ""].join(":");
      }).sort().join(";");
    }
    const o = asObj(x);
    const mac = String(o.mac || o.primaryMac || "").toLowerCase();
    const ip = String(o.primaryIp || "");
    return (mac || ip) ? mac + "|" + ip : "";
  };

  /* ─────────────────────── capabilities ─────────────────────── */

  function normalizeCapabilities(list) {
    const raw = asArr(list).map(String).filter(Boolean);
    if (ERP.agent && typeof ERP.agent.normalizeCapabilities === "function") return ERP.agent.normalizeCapabilities(raw);
    return [...new Set(raw)].sort();
  }
  H.normalizeCapabilities = normalizeCapabilities;

  /* ─────────────────────── heartbeat ─────────────────────── */

  /* req: { deviceId, credential, payload:{
            agentVersion, capabilities[], clientTime, intervalSeconds,
            hostname, uptimeSeconds, interfaces[], primaryIp, mac,
            loggedInUsers[], metrics{} } }
     Authenticates, stamps the device, updates reported version /
     capabilities, computes clock skew, records a network change, and
     returns the interval the agent should use next plus its state. */
  H.heartbeat = async function (req) {
    req = req || {};
    const deviceId = req.deviceId;
    if (!deviceId) return { ok: false, error: "no_device", message: H.reasonText("no_device") };
    const auth = await E.authenticate(deviceId, req.credential);
    if (!auth.ok) return { ok: false, error: auth.reason, message: H.reasonText(auth.reason), deviceId };
    const providerId = auth.providerId || req.providerId || "";
    const g = await D.get(providerId, deviceId);
    if (g.error) return { ok: false, error: "unknown_device", message: "The authenticated device record no longer exists.", deviceId };
    const dev = g.device;
    const payload = asObj(req.payload || req.data);
    const serverTime = now();
    const serverMs = Date.parse(serverTime);
    const interval = H.intervalSeconds({ intervalSeconds: payload.intervalSeconds });

    /* clock skew — how far the endpoint's clock is from the collector's */
    let skew = null;
    if (payload.clientTime) {
      const t = Date.parse(payload.clientTime);
      if (isFinite(t)) skew = Math.round(((t - serverMs) / 1000) * 10) / 10;
    }

    /* network change detection — compare fingerprints, keep a bounded log */
    const prevFp = H.fingerprint(dev);
    const nextFp = payload.interfaces ? H.fingerprint(payload) : prevFp;
    const networkChanged = !!payload.interfaces && !!prevFp && prevFp !== nextFp;

    const agent = Object.assign({}, asObj(dev.agent), {
      reportedAt: serverTime,
      intervalSeconds: interval,
      clockSkewSeconds: skew,
      presence: "online",
    });
    if (payload.agentVersion) agent.version = String(payload.agentVersion);
    if (payload.capabilities) agent.capabilities = normalizeCapabilities(payload.capabilities);
    if (payload.channel) agent.channel = String(payload.channel);

    const custom = Object.assign({}, asObj(dev.custom));
    /* the endpoint reports how deep its offline replay spool is (Task 12) */
    if (payload.spool) {
      custom.spool = {
        pending: num(asObj(payload.spool).pending, 0),
        bytes: num(asObj(payload.spool).bytes, 0),
        oldestAt: String(asObj(payload.spool).oldestAt || "").slice(0, 40),
        updatedAt: serverTime,
      };
    }
    if (networkChanged) {
      const hist = asArr(custom.networkHistory);
      hist.push({
        at: serverTime,
        from: { fingerprint: prevFp, ips: D.allIps(dev), macs: D.allMacs(dev) },
        to: { fingerprint: nextFp, ips: flattenIps(payload.interfaces), macs: flattenMacs(payload.interfaces) },
      });
      custom.networkHistory = hist.slice(-H.NETWORK_HISTORY);
      notify("network_change", { deviceId, providerId, from: prevFp, to: nextFp });
    }

    /* A check-in is also the agent's command-and-control channel: hand
       back queued jobs (Task 11) and any pending collection request
       (Tasks 9/10), clearing the request as it is delivered. */
    const wanted = {
      collectInventory: !!asObj(dev.custom).inventoryRequestedAt,
      collectMetrics: !!asObj(dev.custom).metricsRequestedAt,
    };
    if (wanted.collectInventory) custom.inventoryRequestedAt = "";
    if (wanted.collectMetrics) custom.metricsRequestedAt = "";
    let jobs = [];
    if (ERP.jobs && typeof ERP.jobs.claim === "function") {
      try {
        const claim = await ERP.jobs.claim({ deviceId, credential: req.credential });
        if (claim && claim.ok) jobs = asArr(claim.jobs);
      } catch (e) { /* a queue failure must never break the heartbeat */ }
    }

    const patch = { lastSeenAt: serverTime, status: "online", agent, custom };
    if (payload.agentVersion) patch.agentVersion = String(payload.agentVersion);
    if (payload.interfaces) patch.interfaces = payload.interfaces;
    if (payload.hostname && !dev.hostname) patch.hostname = String(payload.hostname);
    if (payload.loggedInUsers) patch.loggedInUsers = payload.loggedInUsers;
    if (!dev.firstSeenAt) patch.firstSeenAt = serverTime;
    if (!dev.enrolledAt) patch.enrolledAt = serverTime;

    const r = await D.update(providerId, deviceId, patch);
    if (r.error) return { ok: false, error: r.error, message: r.message, deviceId };
    const updated = r.device;

    /* A pending self-update (Task 12) and any log/self-test request
       (Task 13) ride the same response. Delivered after the device write
       so their own bookkeeping is not clobbered. */
    let update = null;
    if (ERP.resilience && typeof ERP.resilience.deliverUpdate === "function") {
      try { update = await ERP.resilience.deliverUpdate(providerId, deviceId, updated); } catch (e) {}
    }
    let diagnostics = null;
    if (ERP.diagnostics && typeof ERP.diagnostics.deliver === "function") {
      try { diagnostics = await ERP.diagnostics.deliver(providerId, deviceId, updated); } catch (e) {}
    }

    notify("heartbeat", { deviceId, providerId, networkChanged, clockSkewSeconds: skew });
    return {
      ok: true,
      deviceId,
      providerId,
      serverTime,
      intervalSeconds: interval,
      nextHeartbeatAt: new Date(serverMs + interval * 1000).toISOString(),
      clockSkewSeconds: skew,
      networkChanged,
      agentVersion: updated.agentVersion,
      capabilities: asArr(updated.agent.capabilities),
      liveness: D.liveness(updated),
      status: D.effectiveStatus(updated),
      jobs: jobs,
      collectInventory: wanted.collectInventory,
      collectMetrics: wanted.collectMetrics,
      collectLogs: diagnostics ? diagnostics.collectLogs || null : null,
      selfTest: diagnostics ? diagnostics.selfTest || null : null,
      update: update,
      config: {
        heartbeatSeconds: interval,
        staleAfterMinutes: num(cfg("rmm.staleAfterMinutes", 15), 15),
        metricsSampleSeconds: num(cfg("rmm.metricsSampleSeconds", 60), 60),
      },
    };
  };

  function flattenIps(ifs) { return asArr(ifs).reduce((a, i) => a.concat(asArr(asObj(i).ip4)), []); }
  function flattenMacs(ifs) { return asArr(ifs).map((i) => asObj(i).mac).filter(Boolean); }

  /* ─────────────────────── presence & liveness ─────────────────────── */

  H.liveness = (dev, opts) => D.liveness(dev, opts);

  /* Three-state presence for display: online / stale / offline, with the
     manual maintenance & retired overrides the device record carries. */
  H.presence = function (dev, opts) {
    const s = D.effectiveStatus(dev, opts);
    const tone = s === "online" ? "success" : s === "stale" ? "warn" : s === "offline" ? "danger" : s === "maintenance" ? "info" : "muted";
    const last = dev && dev.lastSeenAt ? Date.parse(dev.lastSeenAt) : NaN;
    const ageMin = isFinite(last) ? Math.round(((opts && opts.now) || Date.now()) - last) / 60000 : null;
    return { state: s, tone, ageMinutes: ageMin == null ? null : Math.round(ageMin), reportedAt: (dev && dev.agent && dev.agent.reportedAt) || (dev && dev.lastSeenAt) || "" };
  };

  /* Walk a tenant and report every device's presence, recording a
     transition whenever it changes from the last known state (the
     input Phase 5 turns into agent-offline alerts). */
  H.sweep = async function (providerId, opts) {
    opts = opts || {};
    const g = await T.get(providerId);
    if (g.error) return g;
    const devices = asArr(g.provider.devices).map(D.normalizeDevice);
    const out = { providerId, checked: devices.length, online: 0, stale: 0, offline: 0, unknown: 0, maintenance: 0, retired: 0, transitions: [], at: now() };
    for (const d of devices) {
      const state = D.liveness(d, opts);
      if (out[state] != null) out[state] += 1; else out[state] = (out[state] || 0) + 1;
      const agent = asObj(d.agent);
      const prev = agent.presence || "";
      if (prev !== state) {
        if (prev) out.transitions.push({ deviceId: d.id, hostname: d.hostname || d.displayName, from: prev, to: state });
        await D.update(providerId, d.id, { agent: Object.assign({}, agent, { presence: state }) });
      }
    }
    if (out.transitions.length) notify("presence", { providerId, transitions: out.transitions });
    return out;
  };

  /* ─────────────────────── display helpers ─────────────────────── */

  H.summary = function (dev) {
    const p = H.presence(dev);
    const agent = asObj(dev && dev.agent);
    return {
      state: p.state, tone: p.tone, ageMinutes: p.ageMinutes,
      reportedAt: agent.reportedAt || (dev && dev.lastSeenAt) || "",
      intervalSeconds: num(agent.intervalSeconds, H.DEFAULT_INTERVAL()),
      clockSkewSeconds: agent.clockSkewSeconds == null ? null : num(agent.clockSkewSeconds, 0),
      capabilities: asArr(agent.capabilities),
      networkChanges: asArr(asObj(dev && dev.custom).networkHistory).length,
    };
  };

  /* The "Heartbeat & presence" section appended to the device modal. */
  H.deviceSection = function (dev) {
    const s = H.summary(dev);
    const skew = s.clockSkewSeconds;
    const skewBadge = skew == null ? "" : (Math.abs(skew) >= 60 ? " " + ERP.ui.badge("clock " + (skew > 0 ? "+" : "") + skew + "s", "warn") : " " + ERP.ui.badge("clock ok", "muted"));
    const rows = [
      ["Presence", ERP.ui.badge(s.state, s.tone) + skewBadge],
      ["Last heartbeat", s.reportedAt ? ERP.ui.dateTime(s.reportedAt) : "never"],
      ["Interval", s.intervalSeconds + "s"],
      ["Capabilities", s.capabilities.length ? s.capabilities.map((c) => ERP.ui.badge(c, "muted")).join(" ") : "—"],
      ["Network changes", String(s.networkChanges)],
    ];
    return '<h4 class="rmm-section-title">Heartbeat &amp; presence</h4>' +
      '<div class="rmm-kv">' + rows.map((x) => '<div class="rmm-kv-row"><span>' + ERP.ui.esc(x[0]) + "</span><b>" + x[1] + "</b></div>").join("") + "</div>";
  };

  H.init = function () { return H; };
})();
