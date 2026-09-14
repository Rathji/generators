// src/auth/scoped-permissions.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const scopesForFeature = (...a) => ms365Api().scopedPermissions.scopesForFeature(...a);
export const missingScopes = (...a) => ms365Api().scopedPermissions.missingScopes(...a);
export const hasScopes = (...a) => ms365Api().scopedPermissions.hasScopes(...a);
export const ensureScopes = (...a) => ms365Api().scopedPermissions.ensureScopes(...a);
export const featureScopes = () => ms365Api().scopedPermissions.features();
export const featureLabels = () => ms365Api().scopedPermissions.labels();
