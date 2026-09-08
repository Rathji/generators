// src/tasks/task-updater.js
// Task Updater.
// Updates the properties of an existing To Do task: completion state, status,
// title, importance, due date and percent-complete. PATCHes
// /me/todo/lists/{listId}/tasks/{taskId}.
//
// Requires scope: Tasks.ReadWrite.

import { graphPatch } from "../graph/graph-client.js";
import { toGraphDateTime } from "../odata.js";
import { normalizeTask } from "./task-sync.js";

// Update a task. Options:
//   { listId, taskId, complete, status, title, importance, dueDateTime,
//     percentComplete, body, categories }
//   complete:true → status "completed"; complete:false → "notStarted"
//   (only when `status` isn't given explicitly).
//   dueDateTime: Date | epoch-ms | ISO string | { dateTime, timeZone } | null
//   (null clears the due date).
// Returns the updated task (normalized).
export async function updateTask(opts = {}) {
  if (!opts.listId || !opts.taskId) throw new Error("ms365.tasks: `listId` and `taskId` are required.");
  const patch = buildTaskPatch(opts);
  if (!Object.keys(patch).length) throw new Error("ms365.tasks: nothing to update — pass at least one property.");
  const data = await graphPatch("/me/todo/lists/" + encodeURIComponent(opts.listId) + "/tasks/" + encodeURIComponent(opts.taskId), {
    body: patch,
    fetchImpl: opts.fetchImpl,
  });
  return normalizeTask(data, opts.listId);
}

// Build the PATCH body from a subset of writable task properties.
export function buildTaskPatch({ complete, status, title, importance, dueDateTime, percentComplete, body, categories } = {}) {
  const p = {};
  if (status) p.status = status;
  else if (complete !== undefined && complete !== null) p.status = complete ? "completed" : "notStarted";
  if (title !== undefined && title !== null) p.title = title;
  if (importance) p.importance = importance; // low | normal | high
  if (dueDateTime !== undefined) p.dueDateTime = dueDateTime === null ? null : toGraphDateTime(dueDateTime);
  if (percentComplete !== undefined && percentComplete !== null) p.percentComplete = Math.max(0, Math.min(100, Number(percentComplete)));
  if (body !== undefined && body !== null) p.body = { content: body };
  if (categories && categories.length) p.categories = categories;
  return p;
}

// Convenience: mark a task complete/incomplete. complete defaults to true.
export async function setTaskComplete({ listId, taskId, complete = true }, opts = {}) {
  return updateTask({ listId, taskId, complete, fetchImpl: opts.fetchImpl });
}

// Convenience: set (or clear, with null) a task's due date.
export async function setTaskDueDate({ listId, taskId, dueDateTime }, opts = {}) {
  return updateTask({ listId, taskId, dueDateTime, fetchImpl: opts.fetchImpl });
}
