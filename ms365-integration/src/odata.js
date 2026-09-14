// src/odata.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "./runtime.js";
export const escapeODataStr = (...a) => ms365Api().odata.escapeODataStr(...a);
export const toODataDate = (...a) => ms365Api().odata.toODataDate(...a);
export const toGraphDateTime = (...a) => ms365Api().odata.toGraphDateTime(...a);
export const anyOf = (...a) => ms365Api().odata.anyOf(...a);
