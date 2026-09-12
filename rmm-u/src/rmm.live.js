/* ============================================================
   RMM-U — realtime console  (Phase 12 · Task 49)

   Streams live device state, alert and job-progress changes to every
   connected console session so a team of technicians sees the same
   reality within seconds, tracks *presence* — which technician is
   looking at which device ("who else is on this device") — and falls
   back gracefully to polling when the realtime stream is unavailable.

   Three layers cooperate:
     • ERP.events (EV)  — the event transport: live socket when possible,
                          collector polling otherwise (Task 16).
     • ERP.team   (T)   — the authenticated console session & presence
                          registry on the hub (hello / role / viewers).
     • ERP.live   (LIVE) — this module: the console's realtime layer. It
                          holds the *focus* (the device a session is on),
                          fans viewer changes out to the current view,
                          throttles live re-renders, and renders the
                          "Realtime console" panel.

   Fallback: when the hub or stream is down, mode() reports "polling" or
   "offline", presence is reported as unavailable rather than stale, and
   watched views still refresh from the polling-derived event stream.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP) return;
  const T = ERP.team;
  const EV = ERP.events;
  const LIVE = (ERP.live = {});
  const ui = ERP.ui;
  const esc = ui ? ui.esc : ERP.escapeHtml;

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const $ = (s) => document.querySelector(s);
  const roleLabel = (r) => (r === 2 ? "owner" : r === 1 ? "manager" : "staff");

  /* ─────────────────────── state ─────────────────────── */

  let focused = null;        // {deviceId, providerId} — the device this session is viewing
  let watchers = [];         // [{fn, opts}] — active views that want live re-renders
  let viewerUnsub = null;
  let conflictUnsub = null;
  let refreshTimer = null;
  let lastEventAt = 0;
  let started = false;
  let panelOpen = false;

  LIVE.ENABLED = () => cfg("rmm.liveEnabled", true) !== false;
  LIVE.PRESENCE_ENABLED = () => cfg("rmm.livePresenceEnabled", true) !== false;
  LIVE.AUTO_REFRESH_MS = () => Math.max(1000, num(cfg("rmm.liveAutoRefreshSeconds", 3), 3) * 1000);
  LIVE.PANEL_HISTORY = () => Math.max(10, num(cfg("rmm.livePanelHistory", 50), 50));

  /* ─────────────────────── mode & presence ─────────────────────── */

  /* The realtime mode is the event transport's mode so it is honest even
     when the identity hub happens to be up. */
  LIVE.mode = function () { return EV ? EV.mode() : "offline"; };
  LIVE.modeLabel = function () { return LIVE.mode() === "live" ? "live" : LIVE.mode() === "polling" ? "polling" : "offline"; };
  LIVE.isLive = function () { return LIVE.mode() === "live"; };
  /* Presence needs an authenticated console session, which needs the hub. */
  LIVE.presenceAvailable = function () { return !!(T && T.online && LIVE.PRESENCE_ENABLED()); };
  LIVE.fallback = function () { return LIVE.mode() === "live" ? "" : "The realtime stream is unavailable — the console is falling back to polling every " + Math.round((EV ? EV.POLL_SECONDS() : 15)) + "s."; };

  LIVE.focused = function () { return focused ? Object.assign({}, focused) : null; };

  LIVE.focus = async function (deviceId, providerId) {
    if (!LIVE.ENABLED()) return { ok: false, error: "disabled" };
    const id = deviceId == null ? "" : String(deviceId);
    if (focused && focused.deviceId === id) return { ok: true, deviceId: id, viewers: LIVE.viewers(id) };
    focused = id ? { deviceId: id, providerId: providerId == null ? "" : String(providerId) } : null;
    paintIndicator();
    if (panelOpen) renderPanel();
    if (!id || !T || !T.online) return { ok: false, error: "offline", deviceId: id };
    try {
      const r = await T.rmmFocus(id, providerId || "");
      paintIndicator();
      return r || { ok: false, error: "no_reply" };
    } catch (e) { return { ok: false, error: "transport" }; }
  };

  LIVE.blur = function () {
    const had = !!(focused && focused.deviceId);
    focused = null;
    paintIndicator();
    if (had && T && T.online) { try { T.rmmFocus("", "").catch(() => {}); } catch (e) {} }
  };

  LIVE.viewers = function (deviceId) {
    const id = deviceId || (focused && focused.deviceId) || "";
    if (!id || !T) return [];
    return asArr(T.viewers(id)).map((v) => Object.assign({}, v));
  };
  LIVE.others = function (deviceId) {
    const meId = T && T.me ? T.me.userId : null;
    return LIVE.viewers(deviceId).filter((v) => v.userId !== meId);
  };
  LIVE.viewerCount = function (deviceId) { return LIVE.viewers(deviceId).length; };

  LIVE.onViewers = function (fn) {
    if (typeof fn !== "function") return () => {};
    const off = T && T.onViewers ? T.onViewers((deviceId) => { fn(deviceId, LIVE.viewers(deviceId)); paintIndicator(); if (panelOpen) renderPanel(); }) : () => {};
    return off;
  };

  LIVE.onEvent = function (kind, fn) { return EV ? EV.on(kind, fn) : () => {}; };

  /* ─────────────────────── live view refresh ─────────────────────── */

  /* Register the active view's re-render function. LIVE calls it (throttled)
     whenever a device state / alert / job event arrives, so a technician
     watching the fleet sees another session's action appear within seconds. */
  LIVE.watch = function (fn, opts) {
    if (typeof fn !== "function") return () => {};
    const rec = { fn: fn, opts: opts || {} };
    watchers.push(rec);
    if (panelOpen) renderPanel();
    return () => { const i = watchers.indexOf(rec); if (i >= 0) watchers.splice(i, 1); if (panelOpen) renderPanel(); };
  };
  LIVE.watchCount = () => watchers.length;

  function relevant(evt) {
    if (!evt || !evt.kind) return false;
    return evt.kind === "device-state" || evt.kind === "alert" || evt.kind === "job";
  }

  function scheduleRefresh(evt) {
    lastEventAt = Date.now();
    if (!watchers.length) { paintIndicator(); return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const list = watchers.slice();
      list.forEach((w) => { try { w.fn(evt); } catch (e) {} });
      paintIndicator();
      if (panelOpen) renderPanel();
    }, LIVE.AUTO_REFRESH_MS());
  }

  LIVE.refreshNow = function () { clearTimeout(refreshTimer); watchers.slice().forEach((w) => { try { w.fn(null); } catch (e) {} }); };

  /* ─────────────────────── status ─────────────────────── */

  LIVE.status = function () {
    return {
      enabled: LIVE.ENABLED(),
      mode: LIVE.mode(),
      label: LIVE.modeLabel(),
      presence: LIVE.presenceAvailable(),
      focused: LIVE.focused(),
      viewers: LIVE.viewerCount(),
      watchers: LIVE.watchCount(),
      autoRefreshSeconds: Math.round(LIVE.AUTO_REFRESH_MS() / 1000),
      pollSeconds: EV ? EV.POLL_SECONDS() : 0,
      events: EV ? EV.stats() : null,
      lastEventAt: lastEventAt,
    };
  };

  /* ─────────────────────── rendering ─────────────────────── */

  function deviceLabel(v) { return (v && (v.deviceId || "")) || "—"; }

  function modeHtml() {
    const mode = LIVE.modeLabel();
    const tone = mode === "live" ? "success" : mode === "polling" ? "warn" : "muted";
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Realtime console</h3><div class="erp-card-actions">' + ui.badge(mode, tone) + "</div></header>" +
      '<div class="erp-card-body">' +
      '<div class="rmm-live-line"><span class="erp-team-dot ' + (mode === "live" ? "green" : mode === "polling" ? "amber" : "gray") + '"></span><b>' +
      (mode === "live" ? "Live — events stream in as they happen" : mode === "polling" ? "Polling every " + Math.round(EV ? EV.POLL_SECONDS() : 15) + "s" : "Offline — no events arriving") + "</b></div>" +
      '<p class="erp-sub">' + esc(LIVE.fallback() || "Device state, alerts and job progress from every connected console session converge here within seconds.") + "</p>" +
      (LIVE.presenceAvailable() ? "" : '<p class="erp-sub">Presence is unavailable while the team hub is offline — the console cannot see who else is connected.</p>') +
      "</div></section>"
    );
  }

  function presenceHtml(sessions) {
    const rows = asArr(sessions);
    const meId = T && T.me ? T.me.userId : null;
    const body = rows.length
      ? rows.map((s) => {
        const focusTxt = s.focus && s.focus.deviceId ? esc(s.focus.deviceId) : '<span class="erp-sub">idle</span>';
        const you = s.userId === meId ? ' <span class="erp-sub">you</span>' : "";
        return "<tr><td>" + esc(s.displayName || s.userId) + you + "</td><td>" + esc(roleLabel(s.role)) + '</td><td><code>' + esc((s.userId || "").slice(0, 8)) + "</code></td><td>" + focusTxt + "</td></tr>";
      }).join("")
      : '<tr class="erp-empty-row"><td colspan="4">No console sessions online.</td></tr>';
    const others = rows.filter((s) => s.userId !== meId).length;
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Console sessions</h3><div class="erp-card-actions">' + ui.badge(others + " other" + (others === 1 ? "" : "s"), others ? "info" : "muted") + "</div></header>" +
      '<div class="erp-card-body">' +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Technician</th><th>Role</th><th>Session</th><th>Viewing</th></tr></thead><tbody>' + body + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function focusHtml() {
    if (!focused || !focused.deviceId) return "";
    const others = LIVE.others();
    const list = others.length
      ? others.map((v) => ui.badge(v.displayName || v.userId, v.admin ? "danger" : "info")).join(" ")
      : '<span class="erp-sub">no one else is on this device</span>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>On this device</h3><div class="erp-card-actions">' + ui.badge(focused.deviceId, "muted") + "</div></header>" +
      '<div class="erp-card-body"><div class="rmm-live-viewers">' + list + "</div>" +
      '<p class="erp-sub">Who else is viewing this device right now — presence is announced by the hub.</p></div></section>'
    );
  }

  function eventsHtml() {
    const ev = EV ? EV.recent(null, LIVE.PANEL_HISTORY()) : [];
    const stats = EV ? EV.stats() : { total: 0, byKind: {} };
    const rows = ev.length
      ? ev.slice().reverse().map((e) => {
        const what = e.kind + (e.to ? " → " + e.to : e.state ? " → " + e.state : e.alert ? " " + e.alert : e.op ? " " + e.op : "");
        return "<tr><td>" + esc(ui.dateTime(e.at)) + "</td><td>" + esc(e.kind) + "</td><td>" + esc(e.deviceId || e.jobId || "") + "</td><td>" + esc(what) + "</td></tr>";
      }).join("")
      : '<tr class="erp-empty-row"><td colspan="4">No events yet. Live device state, alerts and job progress will appear here.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Event stream</h3><div class="erp-card-actions">' + ui.badge(stats.total + " seen", "muted") + "</div></header>" +
      '<div class="erp-card-body">' +
      '<div class="rmm-live-kinds">' +
      asArr(EV ? EV.KINDS : []).map((k) => '<span class="erp-badge tone-muted">' + esc(k) + " " + num(stats.byKind[k], 0) + "</span>").join(" ") +
      "</div>" +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>When</th><th>Kind</th><th>Device / Job</th><th>Detail</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  LIVE.render = async function (host, opts) {
    if (!host) return;
    opts = opts || {};
    let sessions = [];
    if (LIVE.presenceAvailable()) {
      try { const r = await T.rmmPresenceList(); if (r && r.ok) sessions = r.sessions || []; } catch (e) {}
    }
    const parts = [modeHtml()];
    if (LIVE.presenceAvailable()) parts.push(presenceHtml(sessions));
    const f = focusHtml();
    if (f) parts.push(f);
    parts.push(eventsHtml());
    host.innerHTML = ui.grid(parts, "erp-grid-2");
    return host;
  };

  function renderPanel() {
    const body = $("#uiModalBody");
    if (!body || !panelOpen) return;
    const wrap = document.createElement("div");
    wrap.className = "rmm-live-panel";
    body.innerHTML = "";
    body.appendChild(wrap);
    LIVE.render(wrap, {}).catch(() => {});
  }

  LIVE.openPanel = function () {
    panelOpen = true;
    ui.modal({
      title: "Realtime console",
      size: "lg",
      body: '<div class="rmm-live-panel"><p class="erp-sub">Loading realtime state…</p></div>',
      foot: ui.btn("Refresh", { small: true, act: "live-refresh" }) + " " + ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
    });
    const m = $("#uiModal");
    if (m) {
      const rf = m.querySelector("[data-act=live-refresh]");
      if (rf) rf.onclick = () => renderPanel();
    }
    renderPanel();
  };

  /* ─────────────────────── topbar indicator ─────────────────────── */

  function paintIndicator() {
    const dot = document.getElementById("rmmLiveDot");
    const txt = document.getElementById("rmmLiveText");
    const wrap = document.getElementById("rmmLive");
    const mode = LIVE.modeLabel();
    const cls = mode === "live" ? "green" : mode === "polling" ? "amber" : "gray";
    if (dot) dot.className = "erp-team-dot " + cls;
    if (txt) {
      const n = T && T.online ? asArr(T.peersList).length : 0;
      txt.textContent = LIVE.presenceAvailable() ? (n <= 1 ? "solo" : n + " online") : mode;
    }
    if (wrap) {
      const view = focused && focused.deviceId ? " · viewing " + focused.deviceId : "";
      wrap.title = "Realtime console — " + mode + (LIVE.presenceAvailable() ? " · " + asArr(T.peersList).length + " session(s)" : "") + view;
    }
  }

  /* ─────────────────────── lifecycle ─────────────────────── */

  function wireIndicator() {
    const wrap = document.getElementById("rmmLive");
    if (wrap && !wrap.__wired) {
      wrap.__wired = true;
      wrap.style.cursor = "pointer";
      wrap.addEventListener("click", () => LIVE.openPanel());
    }
    if (ui && typeof ui.closeModal === "function" && !ui.__liveWrapped) {
      const orig = ui.closeModal.bind(ui);
      ui.__liveWrapped = true;
      ui.closeModal = function () {
        const wasPanel = panelOpen;
        if (panelOpen) panelOpen = false;
        if (wasPanel) LIVE.blur();
        return orig();
      };
    }
  }

  LIVE.init = function () {
    if (started) return;
    started = true;
    wireIndicator();
    if (EV) {
      EV.on((evt) => { if (relevant(evt)) { if (!evt.synthetic) scheduleRefresh(evt); } });
      EV.start();
    }
    paintIndicator();
  };

  if (T && T.onViewers) T.onViewers(() => paintIndicator());

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", LIVE.init);
  else LIVE.init();
})();
