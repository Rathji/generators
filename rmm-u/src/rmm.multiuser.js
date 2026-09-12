/* ============================================================
   RMM-U — multi-user audit & rate control  (Phase 12 · Task 50)

   Four guarantees on top of the single-user console:

     1. Authenticate console users to the hub *with their role*. Every
        session is identified by the hub's `hello` handshake and the role
        it returns is authoritative (Task 41); this module reads that
        identity and never trusts a client-supplied one.
     2. Rate-limit and *group* connections against abuse. Sessions are
        grouped by the hub's privacy-preserving network bucket
        (conn.net), a per-network session cap is enforced at the hub, and
        the console can show the live grouping and the limits in force.
     3. Log every remote action to the true actor's audit trail. Remote
        (device-affecting) actions are stamped by the hub against the
        hub-resolved identity; console-only actions go through
        `MU.auditRemote`, which delegates the stamp to the hub. A client
        cannot forge the actor.
     4. Never silently overwrite another user's change. The canonical
        document store refuses a stale write and records a conflict; the
        hub additionally mediates *claims* so a second technician editing
        the same records is told who holds them before saving, and a stale
        announce is broadcast as a conflict to every session.

   `MU` is the console surface for all four: it reads the hub's grouped
   connection stats and audit ring, mediates claims, and renders the
   "Multi-user & rate control" panel.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP) return;
  const T = ERP.team;
  const store = ERP.store;
  const MU = (ERP.multiuser = {});
  const ui = ERP.ui;
  const esc = ui ? ui.esc : ERP.escapeHtml;

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); };
  const asArr = (v) => (Array.isArray(v) ? v : []);
  const $ = (s) => document.querySelector(s);
  const roleLabel = (r) => (r === 2 ? "owner" : r === 1 ? "manager" : "staff");

  let started = false;
  let panelOpen = false;
  let lastAuditSeq = 0;

  MU.ENABLED = () => cfg("rmm.auditRemoteActions", true) !== false;

  /* ─────────────────────── identity & limits ─────────────────────── */

  MU.identity = function () {
    const me = T && T.me ? T.me : null;
    return me ? { userId: me.userId, displayName: me.displayName, role: me.role, admin: !!me.admin, authenticated: !!(T && T.online) } : { authenticated: false };
  };

  /* The limits that are actually in force (config-derived, so an operator
     can tighten them in main.pjs). Surfaced in the panel so the numbers are
     never a mystery. */
  MU.limits = function () {
    return {
      sessionsPerNet: num(cfg("rmm.rateLimitPerNetConnections", 10), 10),
      actionsPerMinute: num(cfg("rmm.rateLimitActionsPerMinute", 240), 240),
      claimsPerMinute: num(cfg("rmm.rateLimitClaimsPerMinute", 60), 60),
      claimTtlSeconds: num(cfg("rmm.docClaimTtlSeconds", 900), 900),
      claimsEnabled: cfg("rmm.docClaimsEnabled", true) !== false,
      auditRemote: cfg("rmm.auditRemoteActions", true) !== false,
    };
  };

  /* ─────────────────────── connections & rate ─────────────────────── */

  MU.connections = async function () {
    if (!T || !T.online) return { ok: false, error: "offline", groups: [], cap: MU.limits().sessionsPerNet, sessions: 0, sockets: 0 };
    try { const r = await T.rmmConnStats(); return r || { ok: false, error: "no_reply" }; }
    catch (e) { return { ok: false, error: "transport" }; }
  };

  /* ─────────────────────── document claims ─────────────────────── */

  MU.claims = async function () {
    if (!T || !T.online) return { ok: false, error: "offline", claims: [] };
    try { const r = await T.rmmClaims(); return r || { ok: false, claims: [] }; }
    catch (e) { return { ok: false, error: "transport", claims: [] }; }
  };

  /* Reserve a document for this session before editing it. Returns
     {ok:true} when the claim is held (or the hub is offline, so local
     editing is unaffected), or {ok:false, conflict:true, holder} when
     another technician holds it. */
  MU.claim = async function (doc, baseRev) {
    if (!doc) return { ok: false, error: "no_doc" };
    if (!MU.limits().claimsEnabled) return { ok: true, claim: null, disabled: true };
    if (!T || !T.online) return { ok: true, claim: null, offline: true };
    try { const r = await T.rmmClaim(doc, baseRev); return r || { ok: false, error: "no_reply" }; }
    catch (e) { return { ok: false, error: "transport" }; }
  };

  MU.release = async function (doc) {
    if (!doc || !T || !T.online) return { ok: true, offline: true };
    try { return (await T.rmmRelease(doc)) || { ok: true }; } catch (e) { return { ok: false, error: "transport" }; }
  };

  /* Guard a save: acquire the claim, and if it is held elsewhere refuse the
     write with a clear reason rather than clobbering the other user. */
  MU.editGuard = async function (doc, baseRev) {
    const c = await MU.claim(doc, baseRev);
    if (c && c.ok) return c;
    const who = (c && c.holder && (c.holder.displayName || c.holder.userId)) || "another technician";
    return { ok: false, conflict: true, holder: c && c.holder, message: who + " is editing this document — sync before saving so you don't overwrite their change." };
  };

  /* ─────────────────────── audit (true actor) ─────────────────────── */

  /* Record a console action against the hub-stamped identity. Returns the
     signed entry (with the true actor) or null when offline. */
  MU.auditRemote = async function (action, opts) {
    if (!MU.ENABLED()) return null;
    if (!T || !T.online) return null;
    try {
      const r = await T.rmmAudit(action, opts);
      if (r && r.ok && r.entry) { lastAuditSeq = r.entry.seq; return r.entry; }
      return null;
    } catch (e) { return null; }
  };

  MU.lastAuditSeq = () => lastAuditSeq;

  MU.auditTail = async function (limit) {
    if (!T || !T.online) return { ok: false, error: "offline", entries: [] };
    try { const r = await T.auditTail(limit || 100); return r || { ok: false, entries: [] }; }
    catch (e) { return { ok: false, error: "transport", entries: [] }; }
  };

  /* ─────────────────────── conflicts ─────────────────────── */

  MU.conflicts = function () {
    let pending = [];
    try { pending = store && store.conflicts ? asArr(store.conflicts()) : []; } catch (e) {}
    return { pending: pending.map((c) => ({ name: c.name, at: c.at, localRev: c.localRev, canonicalRev: c.canonicalRev })), last: T ? T.lastConflict : null };
  };
  MU.onConflict = function (fn) { return T && T.onConflict ? T.onConflict(fn) : () => {}; };

  /* ─────────────────────── rendering ─────────────────────── */

  function identityHtml() {
    const id = MU.identity();
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Authenticated session</h3><div class="erp-card-actions">' + (id.authenticated ? ui.badge("hub-authenticated", "success") : ui.badge("local", "muted")) + "</div></header>" +
      '<div class="erp-card-body">' +
      (id.authenticated
        ? '<div class="rmm-kv"><div class="rmm-kv-row"><span>Actor</span><b>' + esc(id.displayName) + '</b></div><div class="rmm-kv-row"><span>Role</span><b>' + esc(roleLabel(id.role)) + (id.admin ? " · admin" : "") + '</b></div><div class="rmm-kv-row"><span>User id</span><b><code>' + esc(id.userId) + "</code></b></div></div>"
        : '<p class="erp-sub">No authenticated console session — actions are recorded locally until the team hub reconnects.</p>') +
      '<p class="erp-sub">Roles and every remote action are stamped by the hub, so the audit trail always names the true actor.</p>' +
      "</div></section>"
    );
  }

  function connectionsHtml(conn) {
    const groups = asArr(conn && conn.groups);
    const rows = groups.length
      ? groups.map((g) => "<tr><td><code>" + esc(String(g.net)) + "</code></td><td>" + num(g.sessions, 0) + "</td><td>" + num(g.users, 0) + "</td><td>" + (g.proxy ? ui.badge("proxy", "warn") : '<span class="erp-sub">—</span>') + "</td></tr>").join("")
      : '<tr class="erp-empty-row"><td colspan="4">' + (conn && conn.ok ? "No console sessions." : "Connection stats need an online hub.") + "</td></tr>";
    const lim = MU.limits();
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Connections &amp; rate control</h3><div class="erp-card-actions">' + ui.badge(num(conn && conn.sessions, 0) + " session(s)", "info") + "</div></header>" +
      '<div class="erp-card-body">' +
      '<p class="erp-sub">Sessions are grouped by the hub\'s privacy-preserving network bucket and capped at <b>' + lim.sessionsPerNet + "</b> console sessions per network. Guarded actions are limited to <b>" + lim.actionsPerMinute + "</b>/min per connection and claims to <b>" + lim.claimsPerMinute + "</b>/min.</p>" +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Network bucket</th><th>Sessions</th><th>Users</th><th>Flag</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function claimsHtml(claims) {
    const lim = MU.limits();
    const list = asArr(claims && claims.claims);
    const rows = list.length
      ? list.map((c) => "<tr><td><code>" + esc(c.doc) + "</code></td><td>" + esc(c.displayName || c.userId) + "</td><td>" + num(c.baseRev, 0) + "</td><td>" + num(c.ageSeconds, 0) + "s</td></tr>").join("")
      : '<tr class="erp-empty-row"><td colspan="4">No documents are being edited right now.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Live edit claims</h3><div class="erp-card-actions">' + (lim.claimsEnabled ? ui.badge(list.length + " held", list.length ? "info" : "muted") : ui.badge("disabled", "muted")) + "</div></header>" +
      '<div class="erp-card-body">' +
      '<p class="erp-sub">A claim reserves a document for one session for ' + Math.round(lim.claimTtlSeconds / 60) + " minutes so two technicians editing the same records are told who holds it before saving.</p>" +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Document</th><th>Held by</th><th>Base rev</th><th>Age</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function conflictsHtml(conf) {
    const pending = asArr(conf && conf.pending);
    const last = conf && conf.last;
    const rows = pending.length
      ? pending.map((c) => "<tr><td><code>" + esc(c.name) + "</code></td><td>" + num(c.localRev, 0) + "</td><td>" + num(c.canonicalRev, 0) + "</td></tr>").join("")
      : '<tr class="erp-empty-row"><td colspan="3">No pending overwrite conflicts.</td></tr>';
    return (
      '<section class="erp-card">' +
      '<header class="erp-card-head"><h3>Overwrite safety</h3><div class="erp-card-actions">' + (pending.length ? ui.badge(pending.length + " pending", "danger") : ui.badge("in sync", "success")) + "</div></header>" +
      '<div class="erp-card-body">' +
      (last ? '<div class="erp-alert tone-danger">' + esc(last.by) + " saved a newer version of " + esc(last.name) + " (rev " + num(last.theirs, 0) + " over your rev " + num(last.mine, 0) + ") — nothing was overwritten.</div>" : "") +
      '<p class="erp-sub">The canonical store refuses a write whose base is behind the server, records a pending conflict, and the hub broadcasts it. Nothing is ever silently overwritten.</p>' +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Document</th><th>Your rev</th><th>Server rev</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  function auditHtml(tail) {
    const entries = asArr(tail && tail.entries);
    const rows = entries.length
      ? entries.map((a) => "<tr><td>" + num(a.seq, 0) + "</td><td>" + esc(ui.dateTime(new Date((a.ts || 0) * 1000).toISOString())) + "</td><td>" + esc(roleLabel(a.role)) + '</td><td><code>' + esc((a.user || "").slice(0, 10)) + "</code></td><td>" + esc(a.action) + "</td></tr>").join("")
      : '<tr class="erp-empty-row"><td colspan="5">' + (tail && tail.ok ? "No audited actions yet." : "The audit ring is visible to the owner role only.") + "</td></tr>";
    return (
      '<section class="erp-card" style="grid-column:1/-1">' +
      '<header class="erp-card-head"><h3>True-actor audit trail</h3><div class="erp-card-actions">' + ui.badge(entries.length + " entries", "muted") + "</div></header>" +
      '<div class="erp-card-body">' +
      '<p class="erp-sub">Every remote action (push job, remote shell, file transfer, patch deploy, revoke…) and every signed console action is written here against the hub-resolved identity. <code>rmm:</code> = remote action, <code>deny:</code> = refused, <code>act:</code> = console action.</p>' +
      '<div class="erp-table-wrap scroll"><table class="erp-table"><thead><tr><th>Seq</th><th>When</th><th>Role</th><th>Actor</th><th>Action</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "</div></section>"
    );
  }

  MU.render = async function (host, opts) {
    if (!host) return;
    opts = opts || {};
    const [conn, claims, tail] = await Promise.all([MU.connections(), MU.claims(), MU.auditTail(opts.auditLimit || 60)]);
    const conf = MU.conflicts();
    host.innerHTML =
      ui.pageHead("Multi-user & rate control", "Authenticated sessions, grouped connections, edit claims and the true-actor audit trail.", "") +
      ui.grid([identityHtml(), connectionsHtml(conn), claimsHtml(claims), conflictsHtml(conf), auditHtml(tail)], "erp-grid-2");
    return host;
  };

  function renderPanel() {
    const body = $("#uiModalBody");
    if (!body || !panelOpen) return;
    const wrap = document.createElement("div");
    wrap.className = "rmm-mu-panel";
    body.innerHTML = "";
    body.appendChild(wrap);
    MU.render(wrap, {}).catch(() => {});
  }

  MU.openPanel = function () {
    panelOpen = true;
    ui.modal({
      title: "Multi-user & rate control",
      size: "lg",
      body: '<div class="rmm-mu-panel"><p class="erp-sub">Loading multi-user state…</p></div>',
      foot: ui.btn("Refresh", { small: true, act: "mu-refresh" }) + " " + ui.btn("Close", { small: true, attrs: { "data-ui-close": "1" } }),
    });
    const m = $("#uiModal");
    if (m) {
      const rf = m.querySelector("[data-act=mu-refresh]");
      if (rf) rf.onclick = () => renderPanel();
    }
    renderPanel();
  };

  /* ─────────────────────── lifecycle ─────────────────────── */

  MU.init = function () {
    if (started) return;
    started = true;
    MU.onConflict(() => { if (panelOpen) renderPanel(); });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", MU.init);
  else MU.init();
})();
