// src/tasks/task-sync.test.js
// Validation suite for the To Do Task Sync.
// Run via ?test=tasks, or: await (await import("src/tasks/task-sync.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep, makeEnv } from "../test-helpers.js";
import * as ts from "./task-sync.js";

const { test, runAll } = makeSuite();
export { runAll };

const LIST = { id: "list1", displayName: "Work", isOwner: true, isShared: false };

const TASK = {
  id: "t1", title: "Write report", status: "inProgress", importance: "high",
  percentComplete: 40, isReminderOn: true,
  createdDateTime: "2026-09-01T08:00:00Z",
  lastModifiedDateTime: "2026-09-05T09:30:00Z",
  completedDateTime: null,
  dueDateTime: { dateTime: "2026-09-10T17:00:00", timeZone: "UTC" },
  body: { content: "Cover Q3 numbers" },
  categories: ["reporting"],
};

test("listTaskLists: returns normalized lists", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists": { payload: { value: [LIST] } } } });
  const res = await ts.listTaskLists();
  const url = env.calls.graph[0].url;
  assert(/\/me\/todo\/lists/.test(url.split("?")[0]), "endpoint");
  assert(/\$select=id,displayName,isOwner,isShared/.test(decodeURIComponent(url)), "select");
  const l = res.value[0];
  assertEq(l.id, "list1");
  assertEq(l.name, "Work");
  assertEq(l.isOwner, true);
  assertEq(l.isShared, false);
});

test("listTasks: filter for open tasks only (includeCompleted:false)", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks": { payload: { value: [TASK] } } } });
  const res = await ts.listTasks({ listId: "list1", includeCompleted: false });
  const url = env.calls.graph[0].url;
  assert(/\/me\/todo\/lists\/list1\/tasks/.test(url.split("?")[0]), "endpoint");
  assert(/status ne 'completed'/.test(decodeURIComponent(url)), "open-only filter");
  assert(/createdDateTime desc/.test(decodeURIComponent(url)), "default order");
  const t = res.value[0];
  assertEq(t.id, "t1");
  assertEq(t.listId, "list1");
  assertEq(t.title, "Write report");
  assertEq(t.status, "inProgress");
  assertEq(t.importance, "high");
  assertEq(t.percentComplete, 40);
  assertDeep(t.due, { dateTime: "2026-09-10T17:00:00", timeZone: "UTC" });
  assertEq(t.body, "Cover Q3 numbers");
  assertDeep(t.categories, ["reporting"]);
});

test("listTasks: importance + title filters compose with and", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks": { payload: { value: [] } } } });
  await ts.listTasks({ listId: "list1", importance: "high", title: "report" });
  const url = decodeURIComponent(env.calls.graph[0].url);
  assert(/importance eq 'high'/.test(url), "importance");
  assert(/contains\(title, 'report'\)/.test(url), "title");
  assert(/ and /.test(url), "combined with and");
});

test("listTasks: apostrophe in title is escaped", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks": { payload: { value: [] } } } });
  await ts.listTasks({ listId: "list1", title: "O'Brien" });
  const url = decodeURIComponent(env.calls.graph[0].url);
  assert(/contains\(title, 'O''Brien'\)/.test(url), "doubled quote");
});

test("listTasks: pagination walks nextLink via getAllPages", async () => {
  let calls = 0;
  const routes = {
    "/me/todo/lists/list1/tasks": ({ url }) => {
      calls++;
      if (!url.includes("nextLink1")) {
        return { payload: { value: [TASK], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists/list1/tasks?nextLink1" } };
      }
      return { payload: { value: [{ ...TASK, id: "t2" }] } };
    },
  };
  const env = makeEnv({ routes });
  const res = await ts.listTasks({ listId: "list1", top: 1 });
  assertEq(calls, 2, "two pages fetched");
  assertEq(res.count, 2);
  assertEq(res.value[1].id, "t2");
});

test("listTasks: missing listId throws", async () => {
  let threw = false;
  try { await ts.listTasks({}); } catch (e) { threw = true; }
  assert(threw, "listId required");
});

test("getTask: single task by id + listId", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: TASK } } });
  const t = await ts.getTask("t1", { listId: "list1" });
  assert(/\/me\/todo\/lists\/list1\/tasks\/t1/.test(env.calls.graph[0].url.split("?")[0]));
  assertEq(t.id, "t1");
  assertEq(t.listId, "list1");
});

test("getTask: missing listId throws", async () => {
  let threw = false;
  try { await ts.getTask("t1"); } catch (e) { threw = true; }
  assert(threw, "listId required for getTask");
});

test("normalizeTask: bare task maps to safe defaults", () => {
  const t = ts.normalizeTask({ id: "x" }, "list1");
  assertEq(t.title, "(untitled task)");
  assertEq(t.status, "notStarted");
  assertEq(t.percentComplete, 0);
  assertEq(t.due, null);
  assertEq(ts.normalizeTask(null), null);
});
