// src/tasks/task-updater.test.js
// Validation suite for the Task Updater.
// Run via ?test=tasks-update, or: await (await import("src/tasks/task-updater.test.js")).runAll();

import { makeSuite, assert, assertEq, makeEnv } from "../test-helpers.js";
import * as tu from "./task-updater.js";

const { test, runAll } = makeSuite();
export { runAll };

const UPDATED = {
  id: "t1", title: "Write report", status: "completed", importance: "high",
  percentComplete: 100, isReminderOn: false,
  createdDateTime: "2026-09-01T08:00:00Z",
  lastModifiedDateTime: "2026-09-05T10:00:00Z",
  completedDateTime: "2026-09-05T10:00:00Z",
  dueDateTime: { dateTime: "2026-09-10T17:00:00", timeZone: "UTC" },
  body: { content: "Cover Q3 numbers" },
  categories: ["reporting"],
};

test("updateTask: complete:true PATCHes status completed", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: UPDATED } } });
  const t = await tu.updateTask({ listId: "list1", taskId: "t1", complete: true });
  const call = env.calls.graph[0];
  assert(/\/me\/todo\/lists\/list1\/tasks\/t1/.test(call.url.split("?")[0]), "endpoint");
  assertEq(call.init.method, "PATCH");
  assertEq(JSON.parse(call.init.body).status, "completed");
  assertEq(t.status, "completed");
});

test("updateTask: complete:false PATCHes status notStarted", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: { ...UPDATED, status: "notStarted" } } } });
  await tu.updateTask({ listId: "list1", taskId: "t1", complete: false });
  assertEq(JSON.parse(env.calls.graph[0].init.body).status, "notStarted");
});

test("updateTask: explicit status wins over complete", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: UPDATED } } });
  await tu.updateTask({ listId: "list1", taskId: "t1", complete: false, status: "inProgress" });
  assertEq(JSON.parse(env.calls.graph[0].init.body).status, "inProgress");
});

test("updateTask: sets title, importance, percentComplete, body, categories", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: UPDATED } } });
  await tu.updateTask({
    listId: "list1", taskId: "t1",
    title: "Renamed", importance: "low", percentComplete: 55,
    body: "new body", categories: ["home"],
  });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assertEq(body.title, "Renamed");
  assertEq(body.importance, "low");
  assertEq(body.percentComplete, 55);
  assertEq(body.body.content, "new body");
  assertEq(body.categories[0], "home");
});

test("updateTask: dueDateTime becomes dateTimeTimeZone", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: UPDATED } } });
  await tu.updateTask({ listId: "list1", taskId: "t1", dueDateTime: new Date("2026-09-20T09:00:00Z") });
  const dd = JSON.parse(env.calls.graph[0].init.body).dueDateTime;
  assertEq(dd.dateTime, "2026-09-20T09:00:00Z");
  assertEq(dd.timeZone, "UTC");
});

test("updateTask: dueDateTime:null clears the due date", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: UPDATED } } });
  await tu.updateTask({ listId: "list1", taskId: "t1", dueDateTime: null });
  const body = JSON.parse(env.calls.graph[0].init.body);
  assert("dueDateTime" in body, "dueDateTime key present");
  assertEq(body.dueDateTime, null);
});

test("updateTask: percentComplete clamped to 0..100", () => {
  const p = tu.buildTaskPatch({ percentComplete: 250 });
  assertEq(p.percentComplete, 100);
  const p2 = tu.buildTaskPatch({ percentComplete: -5 });
  assertEq(p2.percentComplete, 0);
});

test("updateTask: empty patch throws (nothing to update)", async () => {
  let threw = false;
  try { await tu.updateTask({ listId: "list1", taskId: "t1" }); } catch (e) { threw = true; }
  assert(threw, "empty patch throws");
});

test("updateTask: missing listId/taskId throws", async () => {
  let threw = false;
  try { await tu.updateTask({ listId: "list1" }); } catch (e) { threw = true; }
  assert(threw, "taskId required");
});

test("setTaskComplete + setTaskDueDate conveniences", async () => {
  const env = makeEnv({ routes: { "/me/todo/lists/list1/tasks/t1": { payload: UPDATED } } });
  await tu.setTaskComplete({ listId: "list1", taskId: "t1" });
  assertEq(JSON.parse(env.calls.graph[0].init.body).status, "completed");
  await tu.setTaskDueDate({ listId: "list1", taskId: "t1", dueDateTime: null });
  assertEq(JSON.parse(env.calls.graph[1].init.body).dueDateTime, null);
});
