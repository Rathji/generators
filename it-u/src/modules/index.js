// src/modules/index.js — the IT-U station registry. Order here defines the
// order in the sidebar navigation, and the first entry is the default route.
//
// Stations: Organizations, Assets, Documents, Trackers, Services, Library,
// Deployments, Integrations, Import, Search, Linter, Exports, Settings (roadmap
// task 1; Integrations added by task 28, Import by task 29, Library by task 35,
// Status by task 57).

import organizations from "./organizations.js";
import assets from "./assets.js";
import documents from "./documents.js";
import trackers from "./trackers.js";
import services from "./services.js";
import library from "./library.js";
import deployments from "./deployments.js";
import integrations from "./integrations.js";
import bulkImport from "./import.js";
import search from "./search.js";
import linter from "./linter.js";
import exports from "./exports.js";
import settings from "./settings.js";
import status from "./status.js";

export default [organizations, assets, documents, trackers, services, library, deployments, integrations, bulkImport, search, linter, exports, settings, status];
