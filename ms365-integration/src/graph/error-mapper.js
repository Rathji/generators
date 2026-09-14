// src/graph/error-mapper.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const mapGraphError = (...a) => ms365Api().errorMapper.mapGraphError(...a);
export const toFriendlyError = (...a) => ms365Api().errorMapper.toFriendlyError(...a);
export const formatFriendlyError = (...a) => ms365Api().errorMapper.formatFriendlyError(...a);
