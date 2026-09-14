// src/tasks/task-sync.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const listTaskLists = (...a) => ms365Api().tasks.sync.listTaskLists(...a);
export const listTasks = (...a) => ms365Api().tasks.sync.listTasks(...a);
export const getTask = (...a) => ms365Api().tasks.sync.getTask(...a);
export const normalizeTask = (...a) => ms365Api().tasks.sync.normalizeTask(...a);
export const normalizeTaskList = (...a) => ms365Api().tasks.sync.normalizeTaskList(...a);
