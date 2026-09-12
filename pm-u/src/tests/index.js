// ============================================================================
//  Project U — test suite registry
// ============================================================================

import { runSuites } from "./harness.js";
import { utilsSuite } from "./utils.test.js";
import { frameworkSuite } from "./framework.test.js";
import { themeSuite } from "./theme.test.js";
import { componentsSuite } from "./components.test.js";

export const SUITE_FACTORIES = [utilsSuite, frameworkSuite, themeSuite, componentsSuite];

export function createSuites() {
  return SUITE_FACTORIES.map((factory) => factory());
}

export function runAll() {
  return runSuites(createSuites());
}
