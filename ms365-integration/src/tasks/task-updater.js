// src/tasks/task-updater.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const updateTask = (...a) => ms365Api().tasks.update.updateTask(...a);
export const buildTaskPatch = (...a) => ms365Api().tasks.update.buildTaskPatch(...a);
export const setTaskComplete = (...a) => ms365Api().tasks.update.setTaskComplete(...a);
export const setTaskDueDate = (...a) => ms365Api().tasks.update.setTaskDueDate(...a);
