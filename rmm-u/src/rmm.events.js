/* ============================================================
   RMM-U — event stream & degraded mode  (Phase 3 · Task 16)

   The console should not have to poll to learn that a device went
   offline, an agent reported a job result, or an alert fired. The
   collector hub publishes those on the "rmm" pub/sub topic; this module
   listens, normalises them into one event bus, and — when the realtime
   socket is unavailable — falls back to polling the collector's own
   fleet/job views and synthesising the same events from the diff.

   Event shape:
     { kind: "device-state" | "job" | "alert" | "device-op" | "admin",
       deviceId?, providerId?, from?, to?, jobId?, state?, alert?,
       severity?, at }

   Modes (surfaced in the topbar indicator, so the user always knows
   which one they are in):
     • live    — subscribed to the hub's realtime topic
     • polling — no socket; the collector is polled every few seconds
     • offline — neither
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP) return;
  const COL = ERP.collector;
  const EV = (ERP.events = {});

  EV.CHANNEL = "rmm";
  EV.KINDS = ["device-state", "job", "alert", "device-op", "admin"];

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const now = () => new Date().toISOString();

  /* ─────────────────────── state ─────────────────────── */

  let started = false;
  let mode = "offline";
  let socket = null;
  let transport = null;
  let ring = [];
  let byKind = {};
  let pollTimer = null;
  let lastSnapshot = null;
  let retryAttempt = 0;
  let retryTimer = null;

  const listeners = [];
  EV.on = function (kind, fn) {
    if (typeof kind === "function") { fn = kind; kind = "*"; }
    if (typeof fn !== "function") return () => {};
    listeners.push({ kind: kind || "*", fn });
    return () => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); };
  };
  EV.off = function (fn) { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); };

  EV.HISTORY = () => Math.max(20, num(cfg("rmm.eventHistory", 200), 200));
  EV.POLL_SECONDS = () => Math.max(5, num(cfg("rmm.eventPollSeconds", 15), 15));

  /* ─────────────────────── event bus ─────────────────────── */

  EV.emit = function (evt, synthetic) {
    if (!evt || typeof evt !== "object") return null;
    const e = Object.assign({}, evt, { at: evt.at || now(), synthetic: !!synthetic });
    ring.push(e);
    while (ring.length > EV.HISTORY()) ring.shift();
    const k = String(e.kind || "unknown");
    byKind[k] = (byKind[k] || 0) + 1;
    updateIndicator();
    listeners.slice().forEach((l) => { if (l.kind === "*" || l.kind === k) { try { l.fn(e); } catch (err) {} } });
    return e;
  };

  EV.recent = function (kind, limit) {
    let list = ring;
    if (kind) list = list.filter((e) => e.kind === kind);
    list = list.slice(-(limit || 50));
    return list.map((e) => Object.assign({}, e));
  };

  EV.stats = function () {
    return { total: ring.length, byKind: Object.assign({}, byKind), mode: mode, polling: !!pollTimer, lastAt: ring.length ? ring[ring.length - 1].at : "" };
  };

  EV.mode = function () { return mode; };
  EV.modeLabel = function () { return mode === "live" ? "live" : mode === "polling" ? "polling" : "offline"; };

  function setMode(m) { mode = m; updateIndicator(); if (m !== "live") startPolling(); else stopPolling(); }

  /* ─────────────────────── realtime transport ─────────────────────── */

  function makeSocket() {
    let s = null;
    try { const r = window.root; s = r && typeof r.createServerSocket === "function" ? r.createServerSocket() : null; } catch (e) { s = null; }
    if (!s) { try { s = typeof window.createServerSocket === "function" ? window.createServerSocket() : null; } catch (e) { s = null; } }
    return s;
  }

  function handleMessage(raw) {
    let msg = raw;
    if (typeof raw === "string") { try { msg = JSON.parse(raw); } catch (e) { return; } }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "evt" || (msg.kind && EV.KINDS.indexOf(msg.kind) !== -1)) {
      const e = Object.assign({}, msg);
      delete e.t;
      EV.emit(e);
    }
  }

  function connect() {
    if (transport) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    let s = null;
    try { s = makeSocket(); } catch (e) { s = null; }
    if (!s) { setMode("offline"); scheduleReconnect(); return; }
    socket = s;
    const live = () => socket === s;
    s.addEventListener("open", () => { if (!live()) return; retryAttempt = 0; setMode("live"); });
    s.addEventListener("message", (ev) => { if (!live()) return; handleMessage(ev.data); });
    s.addEventListener("close", () => { if (!live()) return; socket = null; setMode("offline"); scheduleReconnect(); });
    s.addEventListener("error", () => { if (!live()) return; setMode("offline"); });
  }

  /* Exponential reconnect backoff with jitter. A fleet of consoles that
     all lose the hub at the same instant must not retry in lock-step and
     stampede it on recovery ("thundering herd"); each client instead waits
     a random 50–100% of the capped interval, spreading the retries out. */
  EV.RECONNECT_BASE_MS = 1000;
  EV.RECONNECT_MAX_MS = 20000;
  EV.reconnectDelayMs = function (attempt, u) {
    const n = Math.max(1, Math.floor(num(attempt, 1)));
    const base = Math.min(EV.RECONNECT_BASE_MS * Math.pow(2, n - 1), EV.RECONNECT_MAX_MS);
    const r = typeof u === "number" ? Math.min(1, Math.max(0, u)) : Math.random();
    return Math.max(1, Math.round(base * (0.5 + 0.5 * r)));
  };

  function scheduleReconnect() {
    clearTimeout(retryTimer);
    const delay = EV.reconnectDelayMs(retryAttempt + 1);
    retryAttempt += 1;
    retryTimer = setTimeout(() => { if (!transport) connect(); }, delay);
  }

  /* Test seam: a mock channel exposing open()/close() + onmessage()/onclose(). */
  EV.setTransport = function (t) {
    clearTimeout(retryTimer);
    if (socket) { try { socket.close(); } catch (e) {} socket = null; }
    transport = t || null;
    if (transport) {
      transport.onopen = () => setMode("live");
      transport.onmessage = (raw) => handleMessage(raw);
      transport.onclose = () => setMode("offline");
      try { transport.open(); } catch (e) {}
    } else {
      setMode("offline");
      if (started && !ERP.store.backendOverridden()) connect();
    }
    updateIndicator();
  };

  /* ─────────────────────── degraded polling ─────────────────────── */

  EV.setSnapshotFn = function (fn) { EV.snapshotFn = typeof fn === "function" ? fn : null; };

  async function defaultSnapshot(providerId) {
    if (!COL || typeof COL.fleet !== "function") return { devices: [], jobs: [] };
    const out = { devices: [], jobs: [] };
    try {
      const fleet = await COL.fleet(providerId);
      if (fleet && fleet.ok) out.devices = asArr(fleet.devices).map((d) => ({ deviceId: d.deviceId, status: d.status, hostname: d.hostname }));
    } catch (e) {}
    try {
      const jobs = await COL.jobs(providerId ? { providerId } : {});
      if (jobs && jobs.ok) out.jobs = asArr(jobs.jobs).map((j) => ({ jobId: j.id, state: j.state, deviceId: j.deviceId, ref: j.ref, correlation: j.correlation }));
    } catch (e) {}
    return out;
  }

  /* One poll cycle: compare the collector's current view with the previous
     one and synthesise the events the realtime stream would have sent. */
  EV.pollOnce = async function (providerId) {
    const snap = await (EV.snapshotFn || defaultSnapshot)(providerId);
    const prev = lastSnapshot;
    lastSnapshot = snap;
    if (!prev) return { ok: true, events: 0, baseline: true };
    const events = [];
    const prevDev = {};
    asArr(prev.devices).forEach((d) => { prevDev[d.deviceId] = d.status; });
    asArr(snap.devices).forEach((d) => {
      const p = prevDev[d.deviceId];
      if (p === undefined || p === d.status) return;
      events.push({ kind: "device-state", deviceId: d.deviceId, hostname: d.hostname, from: p, to: d.status, at: now() });
      if (d.status === "offline" || d.status === "stale") events.push({ kind: "alert", alert: d.status === "offline" ? "agent-offline" : "agent-stale", severity: d.status === "offline" ? "critical" : "warning", deviceId: d.deviceId, hostname: d.hostname, at: now() });
    });
    const prevJobs = {};
    asArr(prev.jobs).forEach((j) => { prevJobs[j.jobId] = j.state; });
    asArr(snap.jobs).forEach((j) => {
      const p = prevJobs[j.jobId];
      if (p === undefined || p === j.state) return;
      events.push({ kind: "job", jobId: j.jobId, deviceId: j.deviceId, state: j.state, ref: j.ref || "", correlation: j.correlation || "", at: now() });
    });
    events.forEach((e) => EV.emit(e, true));
    return { ok: true, events: events.length };
  };

  function startPolling() {
    if (pollTimer || !started || transport) return;
    if (ERP.store.backendOverridden()) return;
    pollTimer = setInterval(() => { EV.pollOnce().catch(() => {}); }, EV.POLL_SECONDS() * 1000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  EV.startPolling = startPolling;
  EV.stopPolling = stopPolling;

  /* ─────────────────────── lifecycle ─────────────────────── */

  EV.start = function () {
    if (started) return;
    started = true;
    if (transport) return;
    if (ERP.store && ERP.store.backendOverridden && ERP.store.backendOverridden()) return;
    connect();
  };

  EV.stop = function () {
    clearTimeout(retryTimer);
    retryAttempt = 0;
    stopPolling();
    if (socket) { try { socket.close(); } catch (e) {} socket = null; }
    setMode("offline");
  };

  /* ─────────────────────── topbar indicator ─────────────────────── */

  function updateIndicator() {
    const dot = document.getElementById("rmmStreamDot");
    const txt = document.getElementById("rmmStreamText");
    const wrap = document.getElementById("rmmStream");
    const cls = mode === "live" ? "green" : mode === "polling" ? "amber" : "gray";
    if (dot) dot.className = "erp-team-dot " + cls;
    if (txt) txt.textContent = mode === "live" ? "live" : mode === "polling" ? "polling" : "offline";
    if (wrap) wrap.title = "Device event stream: " + mode + (ring.length ? " · " + ring.length + " event(s) seen" : "");
  }

  EV.init = function () {
    const wrap = document.getElementById("rmmStream");
    if (wrap && !wrap.__wired) {
      wrap.__wired = true;
      wrap.style.cursor = "pointer";
      wrap.addEventListener("click", () => {
        const recent = EV.recent(null, 12);
        const body = recent.length
          ? '<pre class="rmm-code">' + ERP.ui.esc(recent.map((e) => e.at + "  " + e.kind + "  " + (e.deviceId || e.jobId || "") + (e.to ? " → " + e.to : e.state ? " → " + e.state : e.alert ? " " + e.alert : "")).join("\n")) + "</pre>"
          : '<p class="erp-sub">No events yet.</p>';
        ERP.ui.modal({ title: "Device event stream", size: "lg", body: '<p class="erp-sub">Mode: <b>' + EV.modeLabel() + "</b>. Events arrive in realtime when the hub is connected and are synthesised from polling otherwise.</p>" + body, foot: ERP.ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }) });
      });
    }
    EV.on("job", (e) => { try { if (ERP.dispatch && ERP.dispatch.sync) ERP.dispatch.sync(e.providerId); } catch (err) {} });
    EV.start();
    updateIndicator();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", EV.init);
  else EV.init();
})();
