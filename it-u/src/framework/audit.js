// src/framework/audit.js — the multi-user audit & rate-control model (task 56).
//
// The hub server keeps a durable audit ring (who did what, with the actor taken
// from the server session so a remote change records its TRUE actor) and a set
// of ephemeral rate-limit buckets grouped by a coarse network signal. This
// module is the PURE reading of both: it turns a raw action string like
// "action:edit" or "denied:delete" into a labelled, grouped, toned entry a
// human can scan, and summarises a run of entries and a rate snapshot.
//
// It has no DOM and no network — only the action catalog from ./roles.js — so a
// surface (the Settings activity card) and the tests share one definition.

import { actionDef } from "./roles.js";

// The fixed actions the server records directly (matching index.html's
// auditLog() call sites). "action:<id>" and "denied:<id>" are recorded for the
// scope-aware action checks; those verbs resolve through the IT-U action
// catalog so their labels never drift from ./roles.js.
export const AUDIT_ACTIONS = [
  { id: "register", label: "Registered", group: "account", tone: "info" },
  { id: "login", label: "Signed in", group: "account", tone: "info" },
  { id: "auth", label: "Reconnected", group: "account", tone: "muted" },
  { id: "logout", label: "Signed out", group: "account", tone: "muted" },
  { id: "change-password", label: "Changed password", group: "account", tone: "warn" },
  { id: "grant-role", label: "Granted a role", group: "access", tone: "ok" },
  { id: "revoke-role", label: "Revoked a role", group: "access", tone: "warn" },
  { id: "ban", label: "Disabled an account", group: "access", tone: "danger" },
  { id: "unban", label: "Enabled an account", group: "access", tone: "ok" },
  { id: "announce", label: "Published a change", group: "change", tone: "info" },
];

// The groups a filter chip offers, in scan order.
export const AUDIT_GROUPS = [
  { id: "all", label: "All", tone: "muted" },
  { id: "change", label: "Changes", tone: "info" },
  { id: "action", label: "Actions", tone: "muted" },
  { id: "denied", label: "Denied", tone: "danger" },
  { id: "access", label: "Access", tone: "ok" },
  { id: "account", label: "Accounts", tone: "muted" },
];

// Rate-limit bucket prefixes -> a readable label for the summary.
export const RATE_LABELS = {
  reg: "Registrations",
  login: "Sign-in attempts",
  auth: "Reconnects",
  ann: "Change broadcasts",
  act: "Action checks",
  ed: "Editing claims",
  chg: "Change lookups",
  ek: "Edit-key writes",
  ekg: "Edit-key reads",
  grant: "Role grants",
  aud: "Audit reads",
  ses: "Session reads",
  rst: "Rate snapshots",
};

export function rateLabel(prefix) {
  return RATE_LABELS[prefix] || String(prefix || "other");
}

const ACTION_LOOKUP = new Map(AUDIT_ACTIONS.map((a) => [a.id, a]));

function titleCase(s) {
  const t = String(s == null ? "" : s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Activity";
}

// A readable label for an action verb ("edit" -> "Edit", "manageGroups" ->
// "Manage groups"), using the IT-U action catalog when the verb is one of them.
export function actionLabel(verb) {
  const def = actionDef(verb);
  if (def) return def.label;
  return titleCase(verb);
}

// Classify a raw action string from the audit ring into
// `{key, group, tone, label, verb, kind}`. Unknown actions degrade to a muted
// "action" entry rather than crashing.
export function classifyAudit(action) {
  const raw = String(action == null ? "" : action);
  const i = raw.indexOf(":");
  if (i > 0) {
    const kind = raw.slice(0, i);
    const verb = raw.slice(i + 1);
    if (kind === "action") return { key: raw, group: "action", tone: "muted", label: actionLabel(verb), verb, kind: "action" };
    if (kind === "denied") return { key: raw, group: "denied", tone: "danger", label: actionLabel(verb), verb, kind: "denied" };
    return { key: raw, group: "change", tone: "muted", label: raw, verb: raw, kind: "change" };
  }
  const known = ACTION_LOOKUP.get(raw);
  if (known) return { key: raw, group: known.group, tone: known.tone, label: known.label, verb: raw, kind: "action" };
  return { key: raw, group: "action", tone: "muted", label: titleCase(raw) || "Activity", verb: raw, kind: "action" };
}

// A one-line human sentence for an audit record.
export function describeAudit(rec) {
  if (!rec) return "";
  const actor = rec.actor || "someone";
  const target = rec.target ? " “" + rec.target + "”" : "";
  const scope = rec.scope ? " at " + rec.scope : "";
  switch (rec.action) {
    case "register": return actor + " registered";
    case "login": return actor + " signed in";
    case "auth": return actor + " reconnected";
    case "logout": return actor + " signed out";
    case "change-password": return actor + " changed their password";
    case "grant-role": return actor + " granted a role to" + target + scope;
    case "revoke-role": return actor + " revoked a role from" + target + scope;
    case "ban": return actor + " disabled" + target;
    case "unban": return actor + " enabled" + target;
    case "announce": return actor + " published a change to" + (target || " a document") + scope;
  }
  const info = classifyAudit(rec.action);
  if (info.kind === "denied") return actor + " was denied " + info.label.toLowerCase() + target;
  if (info.kind === "action") return actor + " " + info.label.toLowerCase() + target + scope;
  return actor + " " + info.label.toLowerCase();
}

// Roll a run of records into counts for the summary line.
export function summarizeAudit(records = []) {
  const byGroup = { change: 0, action: 0, denied: 0, access: 0, account: 0 };
  const byActor = {};
  let denied = 0;
  for (const r of records) {
    const info = classifyAudit(r && r.action);
    byGroup[info.group] = (byGroup[info.group] || 0) + 1;
    if (info.group === "denied") denied++;
    const a = (r && r.actor) || "?";
    byActor[a] = (byActor[a] || 0) + 1;
  }
  const topActors = Object.entries(byActor)
    .map(([actor, count]) => ({ actor, count }))
    .sort((a, b) => b.count - a.count || a.actor.localeCompare(b.actor));
  return { total: Array.isArray(records) ? records.length : 0, byGroup, denied, byActor, topActors };
}

// Filter records by group, actor and a free-text query.
export function filterAudit(records = [], { group = "all", actor = "", query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (!r) return false;
    const info = classifyAudit(r.action);
    if (group && group !== "all" && info.group !== group) return false;
    if (actor && r.actor !== actor) return false;
    if (q) {
      const hay = (r.actor + " " + r.action + " " + r.scope + " " + r.target + " " + info.label).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// Anonymised network label — the server already truncates the platform's
// network hash, so this only shortens it further for a chip.
export function networkLabel(net) {
  const s = String(net == null ? "" : net) || "local";
  return "net " + s.slice(0, 8);
}

// Summarise the rate-limit snapshot the server returns.
export function rateSummary(stats = {}) {
  const src = stats && typeof stats === "object" ? stats : {};
  const groups = Object.entries(src.byPrefix || {})
    .map(([prefix, events]) => ({ prefix, label: rateLabel(prefix), events }))
    .sort((a, b) => b.events - a.events || a.prefix.localeCompare(b.prefix));
  const byNetwork = Object.entries(src.byNetwork || {})
    .map(([net, events]) => ({ net, label: networkLabel(net), events }))
    .sort((a, b) => b.events - a.events);
  const openNetworks = Object.entries(src.openNetworks || {})
    .map(([net, connections]) => ({ net, label: networkLabel(net), connections }))
    .sort((a, b) => b.connections - a.connections);
  return {
    buckets: src.buckets || 0,
    events: src.events || 0,
    groups,
    byNetwork,
    openNetworks,
    topNetwork: openNetworks[0] || null,
  };
}
