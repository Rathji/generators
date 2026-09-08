// src/psa/hub.js — Phase 10 realtime hub client.
//
// A thin client over the server-plugin realtime hub (see the
// <script type="text/x-server-plugin"> block in index.html, which is the
// authoritative multi-user layer). It:
//   - keeps a persistent identity (name) in localStorage so users rejoin as
//     themselves without prompting every load;
//   - connects + joins the hub, subscribes to per-collection change topics,
//     presence and audit (the server subscribes connections in its onopen);
//   - authorizes every sensitive action server-side via rpc.act (role-based
//     PERMS table mirrored from the server), but degrades to permissive
//     single-user mode when offline/unjoined so a lone owner is never blocked;
//   - broadcasts local writes as change events (fire-and-forget) and reacts to
//     remote change events by refreshing the document store — which routes
//     through the existing version-checked conflict layer, so concurrent edits
//     surface as inline keep-mine / keep-theirs / merge conflicts;
//   - records a local audit trail (the "audit" collection) alongside the
//     server's durable ring buffer;
//   - polls the store periodically as a fallback whenever the hub is
//     unreachable, so sessions still converge without the hub.

import store, { refresh, getDocInfo, isCloud } from "./store.js";
import { toast } from "./core.js";

const IDENTITY_KEY = "psaRealtimeIdentity";
const MAX_EVENTS = 50;
const MAX_AUDIT = 200;
const PING_MS = 25000;
const POLL_MS = 60000;
const NO_BROADCAST = new Set(["conflicts", "audit"]);

// Mirrors the server's PERMS map exactly (see index.html server script).
export const PERMS = {
  "timesheet.submit": ["consultant", "manager", "admin"],
  "expense.submit": ["consultant", "manager", "admin"],
  "edit.timesheets": ["consultant", "manager", "admin"],
  "edit.expenses": ["consultant", "manager", "admin"],
  "edit.clients": ["manager", "admin"],
  "edit.projects": ["manager", "admin"],
  "edit.resources": ["manager", "admin"],
  "edit.catalog": ["manager", "admin"],
  "edit.sows": ["manager", "admin"],
  "edit.workplans": ["manager", "admin"],
  "edit.templates": ["manager", "admin"],
  "edit.allocations": ["manager", "admin"],
  "edit.scopechanges": ["manager", "admin"],
  "edit.opportunities": ["manager", "admin"],
  "edit.billing": ["manager", "admin"],
  "edit.reports": ["manager", "admin"],
  "edit.ratecards": ["admin"],
  "timesheet.approve": ["manager", "admin"],
  "timesheet.reject": ["manager", "admin"],
  "timesheet.return": ["manager", "admin"],
  "sow.approve": ["manager", "admin"],
  "invoice.create": ["manager", "admin"],
  "invoice.mark_sent": ["manager", "admin"],
  "invoice.record_payment": ["manager", "admin"],
  "invoice.void": ["manager", "admin"],
  "creditnote.issue": ["manager", "admin"],
  "audit.view": ["manager", "admin"],
  "pipeline.publish": ["manager", "admin"],
  "backup.download": ["manager", "admin"],
  "backup.publish": ["manager", "admin"],
  "ratecard.edit": ["admin"],
  "project.close": ["admin"],
  "backup.restore": ["admin"],
  "archive.manage": ["admin"],
  "setrole": ["admin"],
};

export function can(action, role) {
  const roles = PERMS[action];
  if (!roles) return true;
  if (!role) return false;
  return roles.includes(role);
}

const state = {
  status: "idle",            // idle | connecting | connected | reconnecting | blocked
  me: null,                  // {name, role, connId, joined}
  roster: [],
  online: [],
  recentEvents: [],
  audit: [],
  mode: "off",               // off | emulator | live
  lastError: null,
  connectedAt: null,
  listeners: [],
  _sock: null,
  _ping: null,
  _poll: null,
  _intentional: false,
  _attempt: 0,
  _lastToastAt: 0,
};

function emit() {
  for (const fn of state.listeners) {
    try { fn(state); } catch (e) {}
  }
}

function setStatus(status, err) {
  state.status = status;
  if (err) state.lastError = err;
  emit();
}

function savedName() {
  try { const n = localStorage.getItem(IDENTITY_KEY); return n ? n.trim() : ""; } catch (e) { return ""; }
}

// ---- connection lifecycle ----

export async function connect(name) {
  if (state._sock) {
    state._intentional = true;
    try { state._sock.close(); } catch (e) {}
    state._sock = null;
  }
  const clean = String(name || "").trim();
  if (!clean) return { ok: false, reason: "Enter a name first." };
  try { localStorage.setItem(IDENTITY_KEY, clean); } catch (e) {}
  state.me = { name: clean, role: null, connId: null, joined: false };
  state._intentional = false;
  state._attempt = 0;
  state.lastError = null;
  state.mode = window.generatorIsUnsaved ? "emulator" : "live";
  setStatus("connecting");
  openSocket();
  return { ok: true };
}

export function disconnect() {
  state._intentional = true;
  if (state._ping) { clearInterval(state._ping); state._ping = null; }
  if (state._poll) { clearInterval(state._poll); state._poll = null; }
  if (state._sock) { try { state._sock.close(); } catch (e) {} state._sock = null; }
  state.me = null;
  state._attempt = 0;
  state.lastError = null;
  setStatus("idle");
}

function openSocket() {
  if (state._sock) return;
  const sock = window.root.createServerSocket();
  sock.binaryType = "arraybuffer";
  state._sock = sock;
  sock.onopen = () => { if (state._sock !== sock) return; onOpen(); };
  sock.onmessage = (evt) => { if (state._sock !== sock) return; onMessage(evt); };
  sock.onerror = () => {};
  sock.onclose = (evt) => { if (state._sock !== sock) return; onClose(evt); };
}

async function onOpen() {
  const name = state.me && state.me.name;
  if (!name) { setStatus("idle"); return; }
  try {
    const raw = await state._sock.rpc.join(JSON.stringify({ name, role: "consultant", proof: "" }));
    const j = JSON.parse(raw);
    if (!j.ok) { setStatus("reconnecting", "join rejected: " + (j.reason || "unknown")); scheduleReconnect(); return; }
    state.me = { name: j.name, role: j.role, connId: j.id, joined: true };
    state.roster = Array.isArray(j.roster) ? j.roster : [];
    state.online = [];
    state.connectedAt = Date.now();
    state.lastError = null;
    try {
      const p = JSON.parse(await state._sock.rpc.presence(""));
      if (p.ok) {
        if (Array.isArray(p.roster)) state.roster = p.roster;
        if (Array.isArray(p.online)) state.online = p.online;
      }
    } catch (e) {}
    try {
      const v = JSON.parse(await state._sock.rpc.versions(""));
      if (v.ok) state.versions = v.versions || [];
    } catch (e) {}
    try {
      const a = JSON.parse(await state._sock.rpc.getAudit("100"));
      if (a.ok && Array.isArray(a.entries)) state.audit = a.entries.slice().reverse();
    } catch (e) {}
    setStatus("connected");
    startPing();
    startPoll();
  } catch (e) {
    setStatus("reconnecting", "join failed: " + e);
    scheduleReconnect();
  }
}

function onClose(evt) {
  if (state._ping) { clearInterval(state._ping); state._ping = null; }
  state._sock = null;
  if (state._intentional) return;
  if (state.me) state.me.joined = false;
  const code = evt && evt.code;
  if (code === 4403) {
    setStatus("blocked", "Realtime is only available on perchance.org — this page is embedded elsewhere, so the hub can't connect here. Data still syncs via the document store.");
    return;
  }
  setStatus("reconnecting", (code ? "hub disconnected (" + code + ")" : "hub disconnected"));
  scheduleReconnect();
}

function scheduleReconnect() {
  if (state._intentional) return;
  if (state._retryTimer) return;
  const delay = Math.min(30000, 600 * Math.pow(2, Math.min(state._attempt, 6))) + Math.random() * 400;
  state._retryTimer = setTimeout(() => {
    state._retryTimer = null;
    state._attempt += 1;
    if (state.status === "reconnecting" && !state._intentional) openSocket();
  }, delay);
}

function startPing() {
  if (state._ping) clearInterval(state._ping);
  state._ping = setInterval(() => {
    if (state._sock && state._sock.readyState === 1) {
      try { state._sock.send(JSON.stringify({ t: "ping" })); } catch (e) {}
    }
  }, PING_MS);
}

function startPoll() {
  if (state._poll) clearInterval(state._poll);
  state._poll = setInterval(() => {
    if (isCloud()) refresh().catch(() => {});
  }, POLL_MS);
}

// ---- inbound messages ----

function onMessage(evt) {
  const data = evt.data;
  let m = null;
  try {
    if (typeof data === "string") m = JSON.parse(data);
    else if (data instanceof ArrayBuffer) m = JSON.parse(new TextDecoder().decode(data));
  } catch (e) {}
  if (!m || typeof m !== "object") return;

  if (m.t === "presence") {
    state.roster = Array.isArray(m.roster) ? m.roster : [];
    state.online = Array.isArray(m.online) ? m.online : [];
    emit();
  } else if (m.t === "audit") {
    if (m.entry) {
      state.audit.push(m.entry);
      if (state.audit.length > MAX_AUDIT) state.audit.splice(0, state.audit.length - MAX_AUDIT);
      emit();
    }
  } else if (m.t === "change") {
    const self = !!(state.me && m.connId === state.me.connId);
    state.recentEvents.unshift({
      kind: "change", actor: m.actor, role: m.role, col: m.col, id: m.id, op: m.op, at: m.at, self,
    });
    if (state.recentEvents.length > MAX_EVENTS) state.recentEvents.length = MAX_EVENTS;
    if (!self) {
      const now = Date.now();
      if (now - state._lastToastAt > 3000) {
        state._lastToastAt = now;
        toast("↻ " + (m.actor || "Someone") + " updated " + labelFor(m.col) + (m.id ? " — " + String(m.id).slice(0, 22) : ""), "ok", 2600);
      }
      refresh().catch(() => {});
    }
    emit();
  }
}

function labelFor(col) {
  const map = { clients: "a client", projects: "a project", resources: "a resource", timesheets: "a timesheet", expenses: "an expense", billing: "an invoice", workplans: "a work plan", sows: "an SOW", ratecards: "a rate card", catalog: "the catalog", allocations: "an allocation", opportunities: "an opportunity", pipeline: "the pipeline", templates: "a template", scopechanges: "a scope change", reports: "a report" };
  return map[col] || "a record";
}

// ---- outbound ----

export function publishChange(col, id, op) {
  if (state.status !== "connected" || !state.me || !state.me.joined) return;
  if (NO_BROADCAST.has(col)) return;
  if (op !== "put" && op !== "delete") return;
  if (!state._sock || state._sock.readyState !== 1) return;
  let rev = 0;
  try {
    const info = getDocInfo(col);
    for (const s of info.shards) rev = Math.max(rev, s.rev);
  } catch (e) {}
  const msg = { t: "change", col, id, op, rev };
  try { state._sock.send(JSON.stringify(msg)); } catch (e) {}
}

// ---- authorization (server-verified when connected) ----

export async function authorize(action, detail) {
  if (state.status !== "connected" || !state.me || !state.me.joined || !state._sock) {
    return { ok: true, local: true, actor: state.me ? state.me.name : "local", role: state.me ? state.me.role : null };
  }
  try {
    const raw = await state._sock.rpc.act(JSON.stringify({ action, detail: detail || "" }));
    const r = JSON.parse(raw);
    if (r.ok) {
      if (r.actor) state.me.actor = r.actor;
      if (r.role) state.me.role = r.role;
      return { ok: true, actor: r.actor, role: r.role, at: r.at };
    }
    return { ok: false, reason: r.reason || "Not allowed", actor: r.actor, role: r.role };
  } catch (e) {
    return { ok: false, reason: "Could not reach the hub: " + e };
  }
}

export async function requireAction(action, detail) {
  const auth = await authorize(action, detail);
  if (!auth.ok) toast(auth.reason || "You don't have permission to do that.", "err");
  return auth;
}

export function uiCan(action) {
  if (state.status !== "connected" || !state.me || !state.me.role) return true;
  return can(action, state.me.role);
}

export async function recordAudit(action, detail, actor) {
  try {
    const id = "aud-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    await store.saveRecord("audit", {
      id,
      action,
      detail: detail || "",
      actor: actor || (state.me && state.me.name) || "local",
      role: (state.me && state.me.role) || null,
      at: new Date().toISOString(),
      origin: state.status === "connected" ? "hub" : "local",
    });
    return true;
  } catch (e) {
    return false;
  }
}

// ---- admin / role management ----

export async function claimAdmin(proof) {
  if (state.status !== "connected" || !state._sock) return { ok: false, reason: "Not connected." };
  try {
    const raw = await state._sock.rpc.claimAdmin(String(proof || ""));
    const r = JSON.parse(raw);
    if (r.ok && r.role && state.me) {
      state.me.role = "admin";
      emit();
    }
    return r;
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

export async function setRole(name, role) {
  if (state.status !== "connected" || !state._sock) return { ok: false, reason: "Not connected." };
  try {
    const raw = await state._sock.rpc.setRole(JSON.stringify({ name, role }));
    return JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// ---- introspection ----

export function getState() { return state; }

export function subscribe(fn) {
  state.listeners.push(fn);
  return () => {
    const i = state.listeners.indexOf(fn);
    if (i >= 0) state.listeners.splice(i, 1);
  };
}

export async function init() {
  const name = savedName();
  if (name) connect(name);
  return hub;
}

export const hub = {
  init, connect, disconnect, authorize, requireAction, uiCan, recordAudit, claimAdmin, setRole,
  publishChange, can, getState, subscribe, PERMS,
};

window.__psaHub = hub;
export default hub;
