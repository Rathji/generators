// src/framework/renewals.js — renewal / expiry tracking for Flexible Assets
// (roadmap task 16, "licensing & subscriptions … expiry dates, and any
// associated alerting").
//
// A licence, subscription, support contract or circuit records the date it
// renews or expires. Rather than fix one field name, this module finds the
// record's expiry date by two rules, in order:
//   1. the template field flagged `expiry` in the designer (authoritative), or
//   2. a date field whose label reads like an expiry/renewal/contract end.
// It then classifies the date as overdue / due-soon / upcoming / ok against a
// per-record alert window (`renewalAlertDays`, else the default), and folds a
// set of records into a soonest-first renewals report for the Assets board.

import { assetFieldsOf } from "./flexible.js";

export const DEFAULT_ALERT_DAYS = 60;
export const DUE_SOON_DAYS = 14;

const EXPIRY_LABEL = /expir|renew|contract\s*end|end\s*of\s*(term|contract)|term\s*end|due|valid\s*(to|until)/i;

export const RENEWAL_STATES = [
  { id: "overdue", label: "Overdue", tone: "danger" },
  { id: "due-soon", label: "Due soon", tone: "warn" },
  { id: "upcoming", label: "Upcoming", tone: "info" },
  { id: "ok", label: "OK", tone: "ok" },
  { id: "none", label: "No date", tone: "muted" },
];

export const renewalStateDef = (id) => RENEWAL_STATES.find((s) => s.id === id) || null;

// The template field holding this asset type's expiry date, if any.
export function expiryFieldOf(type) {
  const fields = (type && type.fields) || [];
  const flagged = fields.find((f) => f.expiry);
  if (flagged) return flagged;
  return fields.find((f) => f.type === "date" && EXPIRY_LABEL.test(String(f.label || ""))) || null;
}

// Parse an ISO date, a timestamp or any Date-parseable string to a local Date.
export function parseDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const startOfDay = (ts) => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export const isoDate = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// The alert window for a record: its `renewalAlertDays` field if present and
// numeric, else the default.
export function alertDaysFor(record, type) {
  const field = ((type && type.fields) || []).find((f) => f.key === "renewalAlertDays");
  if (field) {
    const n = Number(assetFieldsOf(record)[field.key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return DEFAULT_ALERT_DAYS;
}

// Classify one record's renewal. `now` is a timestamp (default Date.now()).
export function renewalStatus(record, type, { now = Date.now(), alertDays } = {}) {
  const field = expiryFieldOf(type);
  if (!field) return { field: null, date: null, iso: null, daysUntil: null, alert: null, state: "none" };
  const date = parseDate(assetFieldsOf(record)[field.key]);
  if (!date) return { field, date: null, iso: null, daysUntil: null, alert: alertDaysFor(record, type), state: "none" };
  const alert = alertDays != null ? alertDays : alertDaysFor(record, type);
  const daysUntil = Math.round((date.getTime() - startOfDay(now)) / 86400000);
  let state;
  if (daysUntil < 0) state = "overdue";
  else if (daysUntil <= Math.min(alert, DUE_SOON_DAYS)) state = "due-soon";
  else if (daysUntil <= alert) state = "upcoming";
  else state = "ok";
  return { field, date, iso: isoDate(date), daysUntil, alert, state };
}

// Fold a list of {setId, setName, archived, record} entries into a renewals
// report. `typeOf(record)` resolves the record's template. Returns the items
// that need attention (overdue / due-soon / upcoming) soonest first, the full
// per-record list, and counts per state.
export function renewalsReport(entries, typeOf, opts = {}) {
  const { now = Date.now(), includeOk = false } = opts;
  const items = [];
  const counts = { overdue: 0, "due-soon": 0, upcoming: 0, ok: 0, none: 0, tracked: 0 };
  for (const entry of entries || []) {
    const type = typeof typeOf === "function" ? typeOf(entry.record) : null;
    const status = renewalStatus(entry.record, type, { now });
    counts[status.state] = (counts[status.state] || 0) + 1;
    if (status.state !== "none") counts.tracked += 1;
    items.push({ ...entry, type, status });
  }
  const attention = items
    .filter((i) => i.status.state === "overdue" || i.status.state === "due-soon" || i.status.state === "upcoming" || (includeOk && i.status.state === "ok"))
    .sort((a, b) => (a.status.daysUntil == null ? 1 : 0) - (b.status.daysUntil == null ? 1 : 0) || (a.status.daysUntil || 0) - (b.status.daysUntil || 0));
  return { items, attention, counts, total: items.length };
}

// A short human phrase for a status ("in 12 days", "3 days ago").
export function renewalPhrase(status) {
  if (!status || status.daysUntil == null) return "no date";
  if (status.daysUntil === 0) return "today";
  if (status.daysUntil < 0) {
    const n = -status.daysUntil;
    return n + " day" + (n === 1 ? "" : "s") + " ago";
  }
  return "in " + status.daysUntil + " day" + (status.daysUntil === 1 ? "" : "s");
}
