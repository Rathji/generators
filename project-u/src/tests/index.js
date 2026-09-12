// ============================================================================
//  Project U — test suite registry
//  Export each new suite from SUITE_FACTORIES so it runs with the rest.
// ============================================================================

import { runSuites } from "./harness.js";
import { identitySuite } from "./identity.test.js";
import { membersSuite } from "./members.test.js";
import { launchSuite } from "./launch.test.js";
import { commandsSuite } from "./commands.test.js";
import { stateSuite } from "./state.test.js";
import { preferencesSuite } from "./preferences.test.js";
import { activitySuite } from "./activity.test.js";
import { polishSuite } from "./polish.test.js";
import { utilsSuite } from "./utils.test.js";
import { frameworkSuite } from "./framework.test.js";
import { themeSuite } from "./theme.test.js";
import { componentsSuite } from "./components.test.js";

export const SUITE_FACTORIES = [
  identitySuite,
  membersSuite,
  launchSuite,
  commandsSuite,
  stateSuite,
  preferencesSuite,
  activitySuite,
  polishSuite,
  utilsSuite,
  frameworkSuite,
  themeSuite,
  componentsSuite,
];

export function createSuites() {
  return SUITE_FACTORIES.map((factory) => factory());
}

export function runAll() {
  return runSuites(createSuites());
}
