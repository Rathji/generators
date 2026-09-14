// src/files/permission-auditor.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const getPermissions = (...a) => ms365Api().files.auditor.getPermissions(...a);
export const checkAccess = (...a) => ms365Api().files.auditor.checkAccess(...a);
export const analyzePermissions = (...a) => ms365Api().files.auditor.analyzePermissions(...a);
export const describeAccess = (...a) => ms365Api().files.auditor.describeAccess(...a);
export const normalizePermission = (...a) => ms365Api().files.auditor.normalizePermission(...a);
