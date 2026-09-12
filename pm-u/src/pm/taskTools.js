// src/taskTools.js — Task model power-ups (Phase 11: tasks 80–82).
//
//  80: recurring tasks — a task with a `recurrence` field
//      ({freq:"daily"|"weekly"|"monthly", interval, count}) spawns the next
//      instance when it's completed. All instances share `recurringSeriesId`.
//  81: task dependencies — `dependsOn:[taskId]`; a task is shown Blocked while
//      any prerequisite is open, and completing the last open prerequisite
//      auto-unblocks its dependents (Blocked -> Active).
//  82: time tracking — per-task running timers (`tracking`) and completed
//      sessions (`timeLog:[{id,start,end,note}]`) plus manually logged time
//      (`loggedMs`). Totals via taskTimeMs/formatMs.
//
// Pure helpers are covered by runPhase11Tests. `markTaskDone` (projects.js)
// and the board's status drag call onTaskCompleted / blockDependents so
// recurring + deps stay in sync from every completion path.

import { uid } from "./store.js";
import { todayLocal, parseIso, isoDay } from "./dates.js";

// ── recurring (task 80) ─────────────────────────────────────────
// Next due date for a recurrence, based on the current instance's due date
// (falls back to today when the task has no due date).
export function nextRecurrenceDate(due, rec) {
  const freq = rec && rec.freq ? rec.freq : "daily";
  const interval = Math.max(1, Number((rec && rec.interval) || 1));
  const d = parseIso(due || todayLocal());
  if (freq === "weekly") {
    d.setDate(d.getDate() + 7 * interval);
  } else if (freq === "monthly") {
    const targetDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + interval);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(targetDay, lastDay));
  } else {
    d.setDate(d.getDate() + interval);
  }
  return isoDay(d);
}

export function recurrenceLabel(rec) {
  if (!rec || !rec.freq) return "";
  const interval = Math.max(1, Number(rec.interval) || 1);
  const f = { daily: "day", weekly: "week", monthly: "month" }[rec.freq] || "day";
  return interval === 1 ? "Every " + f : "Every " + interval + " " + f + "s";
}

// Completing a recurring task creates the next instance (same series, next due
// date, same project/priority/tags/milestone/notes/deps). Returns the new task
// or null when the task isn't recurring.
export function spawnNextInstance(store, task) {
  if (!task || !task.recurrence || !task.recurrence.freq) return null;
  const rec = Object.assign({}, task.recurrence, { count: Number(task.recurrence.count || 1) + 1 });
  return store.create("task", {
    title: task.title,
    projectId: task.projectId || null,
    milestoneId: task.milestoneId || null,
    priority: task.priority || "med",
    status: "Active",
    due: nextRecurrenceDate(task.due, task.recurrence),
    tags: Array.isArray(task.tags) ? task.tags.slice() : [],
    notes: task.notes || "",
    subtasks: [],
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.slice() : [],
    recurrence: rec,
    recurringSeriesId: task.recurringSeriesId || task.id,
  });
}

// ── dependencies (task 81) ───────────────────────────────────────
export function depRecords(store, task) {
  const ids = Array.isArray(task && task.dependsOn) ? task.dependsOn : [];
  return ids.map((id) => store.get("task", id)).filter(Boolean);
}
// Prerequisite tasks that are still open (not Done).
export function openDeps(store, task) {
  return depRecords(store, task).filter((d) => d.status !== "Done");
}
// A task is blocked while any of its prerequisites is open.
export function isBlocked(store, task) {
  return !!task && task.status !== "Done" && openDeps(store, task).length > 0;
}

// Called when `task` completes: any dependent whose prerequisites are now all
// done and who was auto-blocked flips back to Active.
export function unblockDependents(store, task) {
  for (const other of store.all("task")) {
    const deps = Array.isArray(other.dependsOn) ? other.dependsOn : [];
    if (!deps.includes(task.id)) continue;
    if (other.status !== "Blocked") continue;
    if (openDeps(store, other).length === 0) {
      store.upsert("task", other.id, { status: "Active", autoBlocked: false });
    }
  }
}

// Called when `task` is reopened: dependents flip to Blocked (flagged
// autoBlocked so they can be restored automatically later).
export function blockDependents(store, task) {
  for (const other of store.all("task")) {
    const deps = Array.isArray(other.dependsOn) ? other.dependsOn : [];
    if (!deps.includes(task.id)) continue;
    if (other.status === "Done" || other.status === "Blocked") continue;
    store.upsert("task", other.id, { status: "Blocked", autoBlocked: true });
  }
}

// Lifecycle hook for any path that completes a task (done-toggle, board drag).
export function onTaskCompleted(store, task) {
  spawnNextInstance(store, task);
  unblockDependents(store, task);
}

// ── time tracking (task 82) ──────────────────────────────────────
export function timeEntries(task) {
  return Array.isArray(task && task.timeLog) ? task.timeLog : [];
}
// Total tracked time on a task: closed sessions + manually logged minutes.
export function taskTimeMs(task) {
  if (!task) return 0;
  let total = Number(task.loggedMs || 0);
  for (const e of timeEntries(task)) {
    if (e && e.start && e.end) total += Math.max(0, e.end - e.start);
  }
  return Math.max(0, Math.round(total));
}
export function formatMs(ms) {
  const s = Math.round(Math.max(0, Number(ms) || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m";
  return s > 0 ? s + "s" : "0m";
}
export function addTimeEntry(store, taskId, { start, end, note = "" } = {}) {
  const tk = store.get("task", taskId);
  if (!tk) return null;
  const e = { id: uid(), start, end, note };
  store.upsert("task", taskId, { timeLog: [...timeEntries(tk), e] });
  return e;
}
export function logManualTime(store, taskId, minutes, note = "") {
  const ms = Math.max(1, Math.round(Number(minutes) || 0)) * 60000;
  const tk = store.get("task", taskId);
  if (!tk) return;
  store.upsert("task", taskId, { loggedMs: Number(tk.loggedMs || 0) + ms });
}
export function startTracking(store, taskId, note = "") {
  const tk = store.get("task", taskId);
  if (!tk) return null;
  store.upsert("task", taskId, { tracking: { start: Date.now(), note } });
  return tk.tracking;
}
export function stopTracking(store, taskId) {
  const tk = store.get("task", taskId);
  if (!tk || !tk.tracking) return null;
  const end = Date.now();
  addTimeEntry(store, taskId, { start: tk.tracking.start, end, note: tk.tracking.note || "" });
  store.upsert("task", taskId, { tracking: null });
  return { ms: end - tk.tracking.start };
}
export function runningTrackers(store) {
  return store.all("task").filter((t) => t && t.tracking);
}
