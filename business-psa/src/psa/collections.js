// src/psa/collections.js — declares every document collection the PSA uses.
// Each entry is a store collection id (lowercase letters/numbers/hyphens).
// The six "data modules" (clients, projects, resources, timesheets, expenses,
// billing) are also registered by the store itself; everything else lives here.

import { registerCollection } from "./store.js";

export const DATA_COLLECTIONS = ["clients", "projects", "resources", "timesheets", "expenses", "billing"];

export const EXTRA_COLLECTIONS = [
  { id: "catalog", label: "Service catalog" },
  { id: "ratecards", label: "Rate cards" },
  { id: "sows", label: "Statements of work" },
  { id: "workplans", label: "Work plan tasks" },
  { id: "templates", label: "Project templates" },
  { id: "scopechanges", label: "Scope changes" },
  { id: "allocations", label: "Allocations" },
  { id: "reports", label: "Saved reports" },
  { id: "archive", label: "Archive" },
  { id: "opportunities", label: "Opportunities" },
  { id: "pipeline", label: "Pipeline bus" },
  { id: "conflicts", label: "Sync conflicts" },
  { id: "audit", label: "Audit log" },
];

export const ALL_COLLECTION_IDS = [...DATA_COLLECTIONS, ...EXTRA_COLLECTIONS.map((c) => c.id)];

export function registerAllCollections() {
  for (const id of DATA_COLLECTIONS) registerCollection({ id });
  for (const c of EXTRA_COLLECTIONS) registerCollection({ id: c.id });
}
