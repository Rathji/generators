// ============================================================================
//  Project U — framework runtime namespace (Developer API surface)
//  Aggregates every framework module behind a single object so views and inline
//  handlers can reach the API from the console or another module via window.PU.
// ============================================================================

import * as utils from "./utils.js";
import * as dom from "./dom.js";
import { bus, createBus } from "./bus.js";
import { createStore, withPersistence } from "./store.js";
import { createStorage } from "./storage.js";
import * as theme from "./theme.js";
import { createBranding, DEFAULT_BRANDING, mix, contrastText, luminance } from "./branding.js";
import { createRouter } from "./router.js";
import { createRegistry } from "./registry.js";
import * as meta from "./meta.js";
import * as members from "./members.js";
import * as launch from "./launch.js";
import * as commands from "./commands.js";
import * as activity from "./activity.js";
import { createAppState } from "./state.js";
import { createPreferences, normalizePreferences, orderByPinned } from "./preferences.js";
import { createToaster } from "../components/toast.js";
import { createDataTable } from "../components/datatable.js";
import { createCommandPalette } from "../components/command-palette.js";
import { createActivityFeed } from "../components/activity-feed.js";
import * as skeleton from "../components/skeleton.js";
import * as inputs from "../components/inputs.js";

export const PU = {
  name: "project-u",
  family: "Project U",
  version: "0.1.0",
  utils,
  dom,
  bus,
  createBus,
  createStore,
  withPersistence,
  createStorage,
  theme,
  branding: { createBranding, DEFAULT_BRANDING, mix, contrastText, luminance },
  createRouter,
  createRegistry,
  createAppState,
  createPreferences,
  normalizePreferences,
  orderByPinned,
  members,
  launch,
  commands,
  activity,
  meta,
  components: { createToaster, createDataTable, createCommandPalette, createActivityFeed, ...skeleton, ...inputs },
};

export default PU;
