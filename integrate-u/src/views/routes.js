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
import { eventsView } from "./events.js";
import { testsView } from "./tests.js";
import { helpView } from "./help.js";

export const ROUTES = [
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
  eventsView,
  testsView,
  helpView,
];

export function routeIds() {
  return ROUTES.map((route) => route.id);
}
