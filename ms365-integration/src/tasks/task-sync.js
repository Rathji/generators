// src/tasks/task-sync.js
// To Do Task Sync.
// Lists the user's Microsoft To Do task lists and the tasks within them, with
// OData filtering (completion state, importance, status), ordering and paging,
// plus a single-task reader. Uses the Graph /me/todo API.
//
// Requires scope: Tasks.Read (read) / Tasks.ReadWrite (create/update).

import { getAllPages, graphGet } from "../graph/graph-client.js";
import { escapeODataStr } from "../odata.js";

const TASK_SELECT = [
  "id", "title", "status", "importance", "percentComplete", "isReminderOn",
  "createdDateTime", "lastModifiedDateTime", "completedDateTime",
  "dueDateTime", "body", "categories",
].join(",");

const TASKLIST_SELECT = ["id", "displayName", "isOwner", "isShared"].join(",");

// List the user's task lists (POST /me/todo/lists). Options: { top, select }.
export async function listTaskLists(opts = {}) {
  const data = await getAllPages("/me/todo/lists", {
    query: { $select: opts.select || TASKLIST_SELECT, $top: opts.top || 50 },
    maxPages: opts.maxPages || 10,
    fetchImpl: opts.fetchImpl,
  });
  return {
    value: data.value.map(normalizeTaskList),
    count: data.count,
    totalCount: data.totalCount,
  };
}

// List tasks in a list. Options:
//   { listId, includeCompleted (default true), importance, status, top, orderBy }
// includeCompleted:false adds `status ne 'completed'` to the filter.
export async function listTasks(filters = {}, opts = {}) {
  if (!filters.listId) throw new Error("ms365.tasks: `listId` is required.");
  const q = { $select: opts.select || TASK_SELECT, $top: filters.top || opts.top || 50 };
  q.$orderby = filters.orderBy || "createdDateTime desc";
  const parts = [];
  if (filters.includeCompleted === false) parts.push("status ne 'completed'");
  if (filters.status) parts.push(`status eq '${escapeODataStr(filters.status)}'`);
  if (filters.importance) parts.push(`importance eq '${escapeODataStr(filters.importance)}'`);
  if (filters.title) parts.push(`contains(title, '${escapeODataStr(filters.title)}')`);
  if (parts.length) q.$filter = parts.join(" and ");
  const data = await getAllPages("/me/todo/lists/" + encodeURIComponent(filters.listId) + "/tasks", {
    query: q,
    maxPages: opts.maxPages || 10,
    fetchImpl: opts.fetchImpl,
  });
  return {
    value: data.value.map((t) => normalizeTask(t, filters.listId)),
    count: data.count,
    totalCount: data.totalCount,
  };
}

// Get a single task by ID. Graph task IDs are scoped to their list, so
// `listId` is required.
export async function getTask(taskId, opts = {}) {
  if (!opts.listId) throw new Error("ms365.tasks: `listId` is required.");
  const data = await graphGet("/me/todo/lists/" + encodeURIComponent(opts.listId) + "/tasks/" + encodeURIComponent(taskId), {
    query: { $select: TASK_SELECT },
    fetchImpl: opts.fetchImpl,
  });
  return normalizeTask(data, opts.listId);
}

export function normalizeTaskList(l) {
  if (!l) return null;
  return {
    id: l.id,
    name: l.displayName || "(unnamed list)",
    isOwner: !!l.isOwner,
    isShared: !!l.isShared,
    webLink: l.webLink || null,
  };
}

// Map a raw Graph todoTask to the standardized internal shape.
export function normalizeTask(t, listId) {
  if (!t) return null;
  return {
    id: t.id,
    listId: listId || null,
    title: t.title || "(untitled task)",
    status: t.status || "notStarted", // notStarted | inProgress | completed | ...
    importance: t.importance || "normal",
    percentComplete: t.percentComplete == null ? 0 : t.percentComplete,
    isReminderOn: !!t.isReminderOn,
    createdDateTime: t.createdDateTime || null,
    lastModifiedDateTime: t.lastModifiedDateTime || null,
    completedDateTime: t.completedDateTime || null,
    due: t.dueDateTime ? { dateTime: t.dueDateTime.dateTime || null, timeZone: t.dueDateTime.timeZone || "UTC" } : null,
    body: (t.body && t.body.content) || "",
    categories: t.categories || [],
  };
}
