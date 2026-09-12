import { homeView } from "./home.js";
import { identityView } from "./identity.js";
import { registryView } from "./registry.js";
import { permissionsView } from "./permissions.js";
import { linksView } from "./links.js";
import { searchView } from "./search.js";
import { syncView } from "./sync.js";
import { reconcileView } from "./reconcile.js";
import { conflictsView } from "./conflicts.js";
import { driftView } from "./drift.js";
import { bundlesView } from "./bundles.js";
import { auditView } from "./audit.js";
import { monitorView } from "./monitor.js";
import { openrpaView } from "./openrpa.js";
import { openrpaDataView } from "./openrpa-data.js";
import { openrpaWorkView } from "./openrpa-work.js";
import { openrpaAutomationView } from "./openrpa-automation.js";
import { openrpaEventsView } from "./openrpa-events.js";
import { openrpaSyncView } from "./openrpa-sync.js";
import { openrpaBundlesView } from "./openrpa-bundles.js";
import { openrpaGuideView } from "./openrpa-guide.js";
import { eventsView } from "./events.js";
import { accessView } from "./access.js";
import { oversightView } from "./oversight.js";
import { testsView } from "./tests.js";
import { helpView } from "./help.js";
import { routePermission } from "../core/identity/guards.js";

const BASE_ROUTES = [
  homeView,
  identityView,
  registryView,
  permissionsView,
  linksView,
  searchView,
  syncView,
  reconcileView,
  conflictsView,
  driftView,
  bundlesView,
  auditView,
  monitorView,
  openrpaView,
  openrpaDataView,
  openrpaWorkView,
  openrpaAutomationView,
  openrpaEventsView,
  openrpaSyncView,
  openrpaBundlesView,
  openrpaGuideView,
  eventsView,
  accessView,
  oversightView,
  testsView,
  helpView,
];

export const ROUTES = BASE_ROUTES.map((route) => ({
  ...route,
  permission: route.permission !== undefined ? route.permission : routePermission(route.id),
}));

export function routeIds() {
  return ROUTES.map((route) => route.id);
}
