// src/exports.js — Export to other formats (Roadmap task 89).
//
// Pure builders return the file text (CSV / Markdown / iCalendar); the
// download* helpers write them to a local file. Nothing leaves the browser —
// it's a plain download, the same as the JSON backup path.
//
//  89: CSV (tasks/events), Markdown (notes/checklists), .ics calendar file
//      (Google Calendar / Outlook / Apple Calendar import).
//
// Pure builders covered by runPhase12Tests().

import { todayLocal } from "./dates.js";
import { downloadText } from "./notes.js";

// ── CSV ──────────────────────────────────────────────────────────
function csvField(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(fields) { return fields.map(csvField).join(","); }

// Milestone name for a task (searched across all projects' milestone lists).
function milestoneName(store, id) {
  if (!id) return "";
  for (const p of store.all("project")) {
    const m = (p.milestones || []).find((x) => x.id === id);
    if (m) return m.name;
  }
  return "";
}

export function tasksToCSV(store) {
  const pmap = new Map(store.all("project").map((p) => [p.id, p.name]));
  const rows = [csvRow(["title", "project", "status", "priority", "due", "tags", "milestone", "dependsOn", "notes", "created", "updated", "completedAt"])];
  for (const t of store.all("task")) {
    rows.push(csvRow([
      t.title || "",
      pmap.get(t.projectId) || "",
      t.status || "",
      t.priority || "",
      t.due || "",
      (t.tags || []).join("; "),
      milestoneName(store, t.milestoneId),
      (t.dependsOn || []).join("; "),
      t.notes || "",
      t.created ? new Date(t.created).toISOString() : "",
      t.updated ? new Date(t.updated).toISOString() : "",
      t.completedAt ? new Date(t.completedAt).toISOString() : "",
    ]));
  }
  return rows.join("\r\n");
}

export function eventsToCSV(store) {
  const rows = [csvRow(["title", "date", "startTime", "endTime", "color", "notes"])];
  for (const e of store.all("event")) {
    rows.push(csvRow([e.title || "", e.date || "", e.startTime || "", e.endTime || "", e.color || "", e.notes || ""]));
  }
  return rows.join("\r\n");
}

// ── Markdown ─────────────────────────────────────────────────────
export function notesToMD(store) {
  const parts = ["# Project Master — Notes export", ""];
  const notes = store.all("note").slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updated || b.created || 0) - (a.updated || a.created || 0);
  });
  for (const n of notes) {
    parts.push("## " + (n.title || "Untitled note"));
    const meta = [];
    if (n.pinned) meta.push("pinned");
    if (n.tags && n.tags.length) meta.push("tags: " + n.tags.join(", "));
    const updated = new Date(n.updated || n.created || Date.now()).toLocaleDateString();
    meta.push(updated);
    parts.push("_" + meta.join(" · ") + "_", "");
    if (n.body) parts.push(n.body, "");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function checklistsToMD(store) {
  const parts = ["# Project Master — Checklists export", ""];
  for (const cl of store.all("checklist")) {
    const items = cl.items || [];
    const done = items.filter((i) => i.done).length;
    parts.push("## " + (cl.name || "Untitled checklist") + " (" + done + "/" + items.length + " done)", "");
    if (!items.length) parts.push("_Empty checklist._", "");
    for (const i of items) parts.push("- [" + (i.done ? "x" : " ") + "] " + (i.text || ""), "");
    parts.push("");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── iCalendar (.ics) ─────────────────────────────────────────────
// Events become VEVENTs (floating local times so they import into the
// user's own timezone); tasks with a due date become VTODOs (all-day DUE).
function icsEscape(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
function icsDate(iso) { return String(iso).replace(/-/g, ""); }
function icsDateTime(iso, time) { return icsDate(iso) + "T" + String(time || "").replace(/:/g, "") + "00"; }
function icsStamp() { return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"; }

export function icsCalendar(store) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Project Master//Project Master v1//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const stamp = icsStamp();
  for (const e of store.all("event")) {
    if (!e.date) continue;
    lines.push("BEGIN:VEVENT");
    lines.push("UID:pm-event-" + e.id + "@project-master");
    lines.push("DTSTAMP:" + stamp);
    lines.push("DTSTART:" + icsDateTime(e.date, e.startTime));
    if (e.endTime) lines.push("DTEND:" + icsDateTime(e.date, e.endTime));
    lines.push("SUMMARY:" + icsEscape(e.title || "Event"));
    if (e.notes) lines.push("DESCRIPTION:" + icsEscape(e.notes));
    lines.push("END:VEVENT");
  }
  for (const t of store.all("task")) {
    if (!t.due) continue;
    lines.push("BEGIN:VTODO");
    lines.push("UID:pm-task-" + t.id + "@project-master");
    lines.push("DTSTAMP:" + stamp);
    lines.push("DUE;VALUE=DATE:" + icsDate(t.due));
    lines.push("SUMMARY:" + icsEscape(t.title || "Task"));
    lines.push("STATUS:" + (t.status === "Done" ? "COMPLETED" : "NEEDS-ACTION"));
    const notes = [];
    if (t.priority) notes.push("priority " + t.priority);
    if (t.tags && t.tags.length) notes.push("tags: " + t.tags.join(", "));
    if (t.notes) notes.push(t.notes);
    if (notes.length) lines.push("DESCRIPTION:" + icsEscape(notes.join(" — ")));
    if (t.status === "Done" && t.completedAt) lines.push("COMPLETED:" + new Date(t.completedAt).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z");
    lines.push("END:VTODO");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ── download helpers ─────────────────────────────────────────────
export function downloadTasksCSV(store) {
  downloadText("tasks-" + todayLocal() + ".csv", tasksToCSV(store));
}
export function downloadEventsCSV(store) {
  downloadText("events-" + todayLocal() + ".csv", eventsToCSV(store));
}
export function downloadNotesMD(store) {
  downloadText("notes-" + todayLocal() + ".md", notesToMD(store));
}
export function downloadChecklistsMD(store) {
  downloadText("checklists-" + todayLocal() + ".md", checklistsToMD(store));
}
export function downloadICS(store) {
  downloadText("project-master-" + todayLocal() + ".ics", icsCalendar(store));
}
