// src/auth/tenant-validator.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const validateTenant = (...a) => ms365Api().tenantValidator.validateTenant(...a);
export const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
