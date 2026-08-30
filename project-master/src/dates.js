// src/dates.js — small local-timezone-safe date helpers shared across views.
// ISO strings are "YYYY-MM-DD" (local calendar days, not UTC).

export function isoDay(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function todayLocal() { return isoDay(new Date()); }
export function parseIso(iso) {
  const [y, m, dd] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, dd || 1);
}
export function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
// bIso - aIso in whole days (local timezone).
export function dayDiff(aIso, bIso) {
  const a = parseIso(aIso), b = parseIso(bIso);
  return Math.round((b - a) / 86400000);
}
export function formatDay(iso) {
  return parseIso(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Convert a millisecond timestamp to a local ISO day (used for completedAt).
export function msToIso(ms) { return isoDay(new Date(ms)); }
export function formatWeekday(iso) {
  return parseIso(iso).toLocaleDateString(undefined, { weekday: "short" });
}
export function relDay(iso, today = todayLocal()) {
  const n = dayDiff(today, iso);
  return n < 0 ? -n + "d overdue" : n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + "d";
}
// Overdue / due-today highlighting (Roadmap task 30). Pure + shared by every view.
// done tasks and undated tasks get no highlight.
export function dueHighlight(due, done = false) {
  if (done || !due) return { over: false, today: false };
  const t = todayLocal();
  return { over: due < t, today: due === t };
}
