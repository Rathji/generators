// src/framework/checklist.js — checklists (roadmap Phase 2, task 11).
//
// A checklist is a DOCUMENT-model record holding an ORDERED list of steps. Each
// step carries its own completion state, an optional assignee (delegation), an
// optional due date and notes, and the who/when it was ticked — so a checklist
// can be handed to assigned personnel, shared as plain text/CSV, tracked to
// completion, and reused (cloned) across clients or deployments.
//
// This module is the single source of truth for the step shape, the progress
// roll-up, the display line, the validation (blank step text / duplicate ids)
// and the integrity audit; ./standardized.js folds it into the combined
// registry, and ./docsets.js exposes the mutation API on the documentation-set
// service.
//
// Step shape:
//   { id, text, done, assignee, dueDate, notes, doneAt, doneBy, createdAt }

import { StoreError, CODES } from "./store/errors.js";
import { newId } from "./ids.js";

export const CHECKLIST_ITEM_STATUS = [
  { id: "todo", label: "To do" },
  { id: "done", label: "Done" },
];

export const CHECKLIST_STATUS_LABELS = Object.fromEntries(CHECKLIST_ITEM_STATUS.map((s) => [s.id, s.label]));

export const CHECKLIST_ITEM_FIELDS = [
  { key: "text", label: "Step", type: "text", required: true },
  { key: "assignee", label: "Assigned to", type: "text" },
  { key: "dueDate", label: "Due", type: "date" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const str = (v) => String(v == null ? "" : v).trim();

export function checklistItems(record) {
  return record && Array.isArray(record.items) ? record.items : [];
}

// Mint a normalized step. Always carries an id and trimmed text; done steps
// carry the who/when they completed.
export function makeChecklistItem(input = {}, now = Date.now()) {
  const done = !!input.done;
  return {
    id: input.id || newId("step"),
    text: str(input.text),
    done,
    assignee: str(input.assignee),
    dueDate: input.dueDate ? String(input.dueDate) : "",
    notes: str(input.notes),
    doneAt: done ? input.doneAt || now : null,
    doneBy: done ? str(input.doneBy) : "",
    createdAt: input.createdAt || now,
  };
}

// Like makeChecklistItem, but preserves any EXTRA fields on the input (e.g. a
// cutover step's `phase`/`check`/`hint`). Used by docs.addChecklist() so a
// generated cutover checklist keeps its phase grouping through the store.
export function normalizeChecklistStep(input = {}, now = Date.now()) {
  const base = makeChecklistItem(input, now);
  for (const [k, v] of Object.entries(input)) {
    if (k in base) continue;
    base[k] = v;
  }
  return base;
}

// Progress roll-up: works on a record or a bare items array.
export function checklistProgress(recordOrItems) {
  const items = Array.isArray(recordOrItems) ? recordOrItems : checklistItems(recordOrItems);
  const total = items.length;
  let done = 0;
  for (const it of items) if (it && it.done) done += 1;
  const remaining = total - done;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { total, done, remaining, percent, complete: total > 0 && done === total, empty: total === 0 };
}

// The distinct people a checklist touches — its default assignee plus every
// step's assignee, in first-seen order.
export function checklistAssignees(record) {
  const out = [];
  const push = (v) => {
    const s = str(v);
    if (s && !out.includes(s)) out.push(s);
  };
  if (record) push(record.defaultAssignee);
  for (const it of checklistItems(record)) push(it && it.assignee);
  return out;
}

// The people with at least one still-open step.
export function checklistOutstandingAssignees(record) {
  const out = [];
  for (const it of checklistItems(record)) {
    if (it && !it.done) {
      const s = str(it.assignee);
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}

export function checklistDetailLine(record) {
  const p = checklistProgress(record);
  if (!p.total) return "No steps yet";
  const bits = [p.done + " of " + p.total + " complete"];
  const who = checklistOutstandingAssignees(record);
  if (who.length) bits.push(who.length === 1 ? "assigned to " + who[0] : who.length + " assignees");
  else if (p.complete) bits.push("complete");
  return bits.join(" · ");
}

// Validate a checklist record's structure. Never throws — the docs service
// turns the errors into a refused save. An empty checklist is VALID (steps can
// be added later); an empty checklist is only an integrity WARNING.
export function validateChecklist(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A checklist must be an object."] };
  if (record.items != null && !Array.isArray(record.items)) {
    return { ok: false, errors: ["A checklist's items must be an array of steps."] };
  }
  const seen = new Set();
  for (const item of checklistItems(record)) {
    if (!item || typeof item !== "object") {
      errors.push("Every checklist step must be an object.");
      continue;
    }
    if (!str(item.text)) errors.push("Every checklist step needs text.");
    const id = item.id;
    if (!id) errors.push("A checklist step is missing its id.");
    else if (seen.has(id)) errors.push(`Duplicate checklist step id “${id}”.`);
    else seen.add(id);
  }
  return { ok: errors.length === 0, errors };
}

export function requireChecklist(record) {
  const { ok, errors } = validateChecklist(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this checklist";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// Integrity audit for a set's checklists (folded into standardizedIssues).
export function checklistIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.checklists || []) {
    const v = validateChecklist(r);
    for (const message of v.errors) {
      issues.push({ level: "error", code: "invalid-checklist", recordId: r.id, message: `Checklist “${r.name}”: ${message}` });
    }
    if (!checklistItems(r).length) {
      issues.push({ level: "warning", code: "empty-checklist", recordId: r.id, message: `Checklist “${r.name}” has no steps yet.` });
    }
    if (r.dueDate && !str(r.dueDate)) {
      issues.push({ level: "warning", code: "invalid-checklist-due", recordId: r.id, message: `Checklist “${r.name}” has a malformed due date.` });
    }
  }
  return issues;
}

// A shareable plain-text/markdown rendering of a checklist — for handing to
// assigned personnel or pasting into a ticket. `clientName` names the set the
// checklist belongs to.
export function formatChecklistText(record, set, { includeNotes = true, includeIds = false } = {}) {
  const lines = [];
  lines.push("# " + (str(record && record.name) || "Checklist"));
  const client = set && set.name;
  if (client) lines.push("Client: " + client);
  if (record && str(record.description)) lines.push("", str(record.description));
  const p = checklistProgress(record);
  const who = checklistAssignees(record);
  lines.push("", `Progress: ${p.done}/${p.total} complete${p.complete ? " ✓" : ""}`);
  if (who.length) lines.push("Assigned to: " + who.join(", "));
  if (record && record.dueDate) lines.push("Due: " + record.dueDate);
  lines.push("");
  if (!p.total) {
    lines.push("_No steps yet._");
    return lines.join("\n");
  }
  for (const item of checklistItems(record)) {
    const box = item.done ? "[x]" : "[ ]";
    const meta = [];
    if (item.assignee) meta.push("@" + item.assignee);
    if (item.dueDate) meta.push("due " + item.dueDate);
    if (item.done && item.doneAt) meta.push("done");
    let line = `- ${box} ${item.text}`;
    if (meta.length) line += ` (${meta.join(", ")})`;
    if (includeIds && item.id) line += ` {${item.id}}`;
    lines.push(line);
    if (includeNotes && item.notes) lines.push("    - " + item.notes);
  }
  return lines.join("\n");
}

// The rows a checklist exports as CSV.
export function checklistCsvRows(record, set) {
  const rows = [["Step", "Done", "Assigned to", "Due", "Done at", "Notes"]];
  for (const item of checklistItems(record)) {
    rows.push([
      item.text,
      item.done ? "yes" : "no",
      item.assignee || "",
      item.dueDate || "",
      item.done && item.doneAt ? new Date(item.doneAt).toISOString() : "",
      item.notes || "",
    ]);
  }
  if (set && set.name) rows.push([], ["Client", set.name]);
  return rows;
}

// A cloning helper shared by the docs service: fresh ids, progress optionally
// reset so a reusable template checklist starts clean.
export function cloneChecklistItems(record, { resetProgress = true, now = () => Date.now() } = {}) {
  return checklistItems(record).map((item) =>
    makeChecklistItem(
      {
        text: item.text,
        assignee: item.assignee,
        dueDate: item.dueDate,
        notes: item.notes,
        done: resetProgress ? false : item.done,
        doneAt: resetProgress ? null : item.doneAt,
        doneBy: resetProgress ? "" : item.doneBy,
      },
      now(),
    ),
  );
}
