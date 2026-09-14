// src/files/file-discovery.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const resolveDrive = (...a) => ms365Api().files.discover.resolveDrive(...a);
export const listFiles = (...a) => ms365Api().files.discover.listFiles(...a);
export const searchFiles = (...a) => ms365Api().files.discover.searchFiles(...a);
export const getFileMeta = (...a) => ms365Api().files.discover.getFileMeta(...a);
export const getFileByPath = (...a) => ms365Api().files.discover.getFileByPath(...a);
export const normalizeItem = (...a) => ms365Api().files.discover.normalizeItem(...a);
