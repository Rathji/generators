// ============================================================================
//  Project U — framework runtime namespace (Developer API surface)
//  Aggregates every framework module behind a single object so member
//  generators can reach the API from inline handlers, the console, or other
//  modules via `window.PU`.
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
import { createToaster } from "../components/toast.js";
import { createDataTable } from "../components/datatable.js";
import * as inputs from "../components/inputs.js";

export const PU = {
  name: "template-u",
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
  meta,
  components: { createToaster, createDataTable, ...inputs },
};

export default PU;
