// src/graph/graph-client.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const graphRequest = (...a) => ms365Api().graph.graphRequest(...a);
export const graphGet = (...a) => ms365Api().graph.graphGet(...a);
export const graphPost = (...a) => ms365Api().graph.graphPost(...a);
export const graphPatch = (...a) => ms365Api().graph.graphPatch(...a);
export const graphPut = (...a) => ms365Api().graph.graphPut(...a);
export const graphDelete = (...a) => ms365Api().graph.graphDelete(...a);
export const getAllPages = (...a) => ms365Api().graph.getAllPages(...a);
export const configureGraph = (...a) => ms365Api().graph.configureGraph(...a);
export const resetGraphConfig = (...a) => ms365Api().graph.resetGraphConfig(...a);
export const getGraphSettings = (...a) => ms365Api().graph.getGraphSettings(...a);
export const getGraphStats = (...a) => ms365Api().graph.getGraphStats(...a);
export const resetGraphStats = (...a) => ms365Api().graph.resetGraphStats(...a);
