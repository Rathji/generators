// src/framework/workflow.js — the expiry workflow & notification engine
// (roadmap task 27, "Expiry workflow & notification engine").
//
// framework/lifecycle.js answers "what expires, and when" (task 26). This module
// turns that data into work: DUE-SOON and OVERDUE queues, owner assignment,
// ESCALATION once an item has been overdue long enough, and a RECORD OF ACTION
// TAKEN — with lead times configurable per item kind and an exportable renewal
// schedule. It is PURE: it never touches storage or the network. The workflow
// state (config + assignments + the action log) is a plain object that the
// documentation-set service persists under `set.lifecycle` (docsets.js), so it
// version-travels with the rest of the client's documentation.
//
// Nothing here invents a notification transport: "notification" means the
// surfaces the Trackers station renders — the attention queues, the escalation
// markers and the renewal schedule you can export and hand to whoever renews.

import { newId } from "./ids.js";
import { LIFECYCLE_KINDS, lifecycleKind, lifecycleStateDef, isAttention } from "./lifecycle.js";

export const DEFAULT_ESCALATION_AFTER_DAYS = 14;
export const ACTION_LOG_MAX = 300;

// The actions a user can take against a lifecycle item, and the ones the engine
// records on its own. `resolves` marks an action that closes the item out.
export const LIFECYCLE_ACTIONS = [
  { id: "assigned", label: "Owner assigned", icon: "flag", own: true },
  { id: "unassigned", label: "Owner cleared", icon: "flag", own: true },
  { id: "noted", label: "Note added", icon: "article" },
  { id: "renewed", label: "Renewed", icon: "check", resolves: true },
  { id: "snoozed", label: "Snoozed", icon: "clock" },
  { id: "unsnoozed", label: "Snooze cleared", icon: "clock" },
  { id: "escalated", label: "Escalated", icon: "alert" },
  { id: "dismissed", label: "Dismissed", icon: "alert", resolves: true },
];

export const lifecycleActionDef = (id) => LIFECYCLE_ACTIONS.find((a) => a.id === id) || null;
const RESOLVING = new Set(LIFECYCLE_ACTIONS.filter((a) => a.resolves).map((a) => a.id));

const num = (v, min = 0) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : null);

// ---- config -----------------------------------------------------------------
// Per-kind lead-time overrides + one escalation rule. Everything else falls back
// to the kind catalog / these defaults.
export const DEFAULT_LIFECYCLE_CONFIG = {
  leadDays: {},
  dueSoonDays: {},
  escalation: { afterDays: DEFAULT_ESCALATION_AFTER_DAYS, to: "" },
};

export function normalizeLifecycleConfig(config) {
  const src = config && typeof config === "object" ? config : {};
  const leadDays = {};
  const dueSoonDays = {};
  for (const kind of LIFECYCLE_KINDS) {
    const lead = src.leadDays ? num(src.leadDays[kind.id]) : null;
    if (lead != null) leadDays[kind.id] = lead;
    const soon = src.dueSoonDays ? num(src.dueSoonDays[kind.id]) : null;
    if (soon != null) dueSoonDays[kind.id] = soon;
  }
  const esc = src.escalation && typeof src.escalation === "object" ? src.escalation : {};
  return {
    leadDays,
    dueSoonDays,
    escalation: {
      afterDays: num(esc.afterDays) != null ? num(esc.afterDays) : DEFAULT_ESCALATION_AFTER_DAYS,
      to: esc.to != null ? String(esc.to).trim() : "",
    },
    updatedAt: src.updatedAt != null ? src.updatedAt : null,
    updatedBy: src.updatedBy != null ? src.updatedBy : null,
  };
}

// ---- state ------------------------------------------------------------------
export function normalizeWorkflowState(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const assignments = {};
  if (src.assignments && typeof src.assignments === "object") {
    for (const [itemId, a] of Object.entries(src.assignments)) {
      if (a && typeof a === "object") assignments[itemId] = { ...a };
    }
  }
  const actions = Array.isArray(src.actions) ? src.actions.filter((a) => a && a.itemId && a.action).slice(-ACTION_LOG_MAX) : [];
  return {
    config: normalizeLifecycleConfig(src.config),
    assignments,
    actions,
    updatedAt: src.updatedAt != null ? src.updatedAt : null,
    updatedBy: src.updatedBy != null ? src.updatedBy : null,
  };
}

export function makeAction({ itemId, action, note = "", by = "system", now = Date.now(), meta = null } = {}) {
  return { id: newId("lca"), itemId, action, note: String(note || ""), by, at: now, meta: meta || null };
}

// Append an action to the log (bounded). Pure — returns a new state.
export function appendAction(state, entry) {
  const log = [...(state.actions || []), entry];
  return { ...state, actions: log.length > ACTION_LOG_MAX ? log.slice(-ACTION_LOG_MAX) : log };
}

// Assign (or clear) an item's owner, recording the action.
export function assignOwner(state, itemId, owner, { by = "system", now = Date.now(), dueAt = null, note = "" } = {}) {
  const next = { ...state, assignments: { ...state.assignments } };
  const clean = owner == null ? "" : String(owner).trim();
  let assignment;
  if (!clean) {
    delete next.assignments[itemId];
    assignment = null;
  } else {
    const prev = next.assignments[itemId] || {};
    assignment = { ...prev, owner: clean, assignedAt: now, assignedBy: by, ...(dueAt ? { dueAt } : {}) };
    next.assignments[itemId] = assignment;
  }
  const entry = makeAction({ itemId, action: clean ? "assigned" : "unassigned", note: clean ? note || clean : note, by, now, meta: clean ? { owner: clean } : null });
  return { state: { ...appendAction(next, entry), updatedAt: now, updatedBy: by }, assignment, action: entry };
}

// Snooze an item until a date (accepts a timestamp, an ISO string or days from
// now). Clearing with a falsy value.
export function snoozeItem(state, itemId, until, { by = "system", now = Date.now(), note = "" } = {}) {
  const next = { ...state, assignments: { ...state.assignments } };
  const prev = next.assignments[itemId] || {};
  let at = null;
  if (until) {
    if (typeof until === "number") at = until > 1e11 ? until : now + until * 86400000;
    else {
      const parsed = new Date(until).getTime();
      at = Number.isNaN(parsed) ? null : parsed;
    }
  }
  if (!at) {
    delete prev.snoozedUntil;
    delete prev.snoozedAt;
    delete prev.snoozedBy;
  } else {
    prev.snoozedUntil = at;
    prev.snoozedAt = now;
    prev.snoozedBy = by;
  }
  if (Object.keys(prev).length) next.assignments[itemId] = prev;
  else delete next.assignments[itemId];
  const entry = makeAction({ itemId, action: at ? "snoozed" : "unsnoozed", note: note || (at ? new Date(at).toISOString().slice(0, 10) : ""), by, now, meta: at ? { until: at } : null });
  return { state: { ...appendAction(next, entry), updatedAt: now, updatedBy: by }, assignment: next.assignments[itemId] || null, action: entry };
}

// Record a free-form action (renewed / dismissed / escalated / noted) against an
// item. A resolving action also clears any snooze.
export function recordItemAction(state, itemId, action, { by = "system", now = Date.now(), note = "", meta = null } = {}) {
  const def = lifecycleActionDef(action);
  if (!def) throw new Error(`Unknown lifecycle action “${action}”.`);
  let next = { ...state, assignments: { ...state.assignments } };
  if (RESOLVING.has(action) && next.assignments[itemId]) {
    const a = { ...next.assignments[itemId] };
    delete a.snoozedUntil;
    delete a.snoozedAt;
    delete a.snoozedBy;
    if (Object.keys(a).length) next.assignments[itemId] = a;
    else delete next.assignments[itemId];
  }
  if (action === "escalated") {
    const a = next.assignments[itemId] || {};
    next.assignments[itemId] = { ...a, escalatedAt: now, escalatedBy: by };
  }
  const entry = makeAction({ itemId, action, note, by, now, meta });
  next = appendAction(next, entry);
  next.updatedAt = now;
  next.updatedBy = by;
  return { state: next, action: entry };
}

// ---- derived views ----------------------------------------------------------
export function lastActionFor(state, itemId) {
  for (let i = (state.actions || []).length - 1; i >= 0; i -= 1) {
    if (state.actions[i].itemId === itemId) return state.actions[i];
  }
  return null;
}

export function isSnoozed(assignment, now = Date.now()) {
  return !!(assignment && assignment.snoozedUntil && new Date(assignment.snoozedUntil).getTime() > now);
}

// Should this item escalate? Only overdue items escalate, once they have been
// overdue at least `afterDays`, unless they are snoozed or already resolved.
export function escalationFor(item, state, now = Date.now()) {
  const cfg = state.config || DEFAULT_LIFECYCLE_CONFIG;
  const after = cfg.escalation && num(cfg.escalation.afterDays) != null ? num(cfg.escalation.afterDays) : DEFAULT_ESCALATION_AFTER_DAYS;
  if (item.state !== "overdue" || item.daysUntil == null) return null;
  const overdueBy = -item.daysUntil;
  if (overdueBy < after) return null;
  const assignment = state.assignments[item.id] || null;
  if (isSnoozed(assignment, now)) return null;
  const last = lastActionFor(state, item.id);
  if (last && RESOLVING.has(last.action)) return null;
  return { overdueBy, afterDays: after, to: (cfg.escalation && cfg.escalation.to) || "" };
}

// Enrich every item with its assignment, owner, snooze, escalation and last
// action so the queues and the UI have one shape to read.
export function enrichItems(items = [], state, now = Date.now()) {
  return items.map((item) => {
    const assignment = state.assignments[item.id] || null;
    return {
      ...item,
      assignment,
      owner: (assignment && assignment.owner) || "",
      snoozedUntil: (assignment && assignment.snoozedUntil) || null,
      snoozed: isSnoozed(assignment, now),
      escalation: escalationFor(item, state, now),
      lastAction: lastActionFor(state, item.id),
    };
  });
}

// Fold items + workflow state into the queues and counts the station shows.
export function buildWorkflow(items = [], state, { now = Date.now() } = {}) {
  const enriched = enrichItems(items, state, now);
  const active = enriched.filter((i) => i.state !== "none" && !i.snoozed);
  const queue = (fn) => active.filter(fn);
  const queues = {
    overdue: queue((i) => i.state === "overdue"),
    dueSoon: queue((i) => i.state === "due-soon"),
    upcoming: queue((i) => i.state === "upcoming"),
    unassigned: queue((i) => isAttention(i.state) && !i.owner),
    escalated: enriched.filter((i) => !!i.escalation),
    snoozed: enriched.filter((i) => i.snoozed),
    resolved: enriched.filter((i) => i.lastAction && RESOLVING.has(i.lastAction.action)),
  };
  const counts = {
    overdue: queues.overdue.length,
    dueSoon: queues.dueSoon.length,
    upcoming: queues.upcoming.length,
    unassigned: queues.unassigned.length,
    escalated: queues.escalated.length,
    snoozed: queues.snoozed.length,
    attention: queues.overdue.length + queues.dueSoon.length + queues.upcoming.length,
    tracked: enriched.filter((i) => i.daysUntil != null).length,
    total: enriched.length,
  };
  return { enriched, queues, counts };
}

// ---- renewal schedule export ------------------------------------------------
// A flat, human-and-spreadsheet-friendly row per dated item.
export function renewalScheduleRows(items = [], state, { now = Date.now(), includeOk = true } = {}) {
  const enriched = enrichItems(items, state, now);
  return enriched
    .filter((i) => i.daysUntil != null || i.state === "none")
    .filter((i) => includeOk || i.state !== "ok")
    .map((i) => {
      const def = lifecycleStateDef(i.state);
      return {
        itemId: i.id,
        kind: i.kindDef.label,
        subject: i.subject,
        asset: i.sourceName,
        assetType: i.sourceType,
        field: i.fieldLabel,
        dueDate: i.iso || "",
        daysUntil: i.daysUntil,
        state: i.state,
        status: def ? def.label : i.state,
        owner: i.owner || "",
        escalated: i.escalation ? "yes" : "",
        snoozedUntil: i.snoozedUntil ? new Date(i.snoozedUntil).toISOString().slice(0, 10) : "",
        lastAction: i.lastAction ? i.lastAction.action : "",
        lastActionAt: i.lastAction ? new Date(i.lastAction.at).toISOString().slice(0, 10) : "",
      };
    });
}

const csvCell = (v) => {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function scheduleToCsv(rows = []) {
  const header = ["Kind", "Subject", "Asset", "Asset type", "Field", "Due date", "Days until", "Status", "Owner", "Escalated", "Snoozed until", "Last action", "Last action date"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([r.kind, r.subject, r.asset, r.assetType, r.field, r.dueDate, r.daysUntil == null ? "" : r.daysUntil, r.status, r.owner, r.escalated, r.snoozedUntil, r.lastAction, r.lastActionAt].map(csvCell).join(","));
  }
  return lines.join("\n");
}

// A compact summary for a KPI strip.
export function workflowSummary(items = [], state, { now = Date.now() } = {}) {
  const { counts, enriched } = buildWorkflow(items, state, { now });
  const next = enriched.filter((i) => i.daysUntil != null).sort((a, b) => a.daysUntil - b.daysUntil)[0] || null;
  return { counts, next };
}
