// src/framework/organization.js — organizations & locations (roadmap Phase 2,
// task 7).
//
// Organizations are the top-level containers of the documentation model. A
// documentation set IS one top-level organization (a client, a department or a
// business unit — the set's `kind`), and organization RECORDS let a set express
// its own internal structure: departments and business units inside the client,
// optionally nested under a parent organization.
//
// Locations are STANDARDIZED: a location record must declare one of the fixed
// location types (office / branch / site / datacentre / other), so "where is
// this?" always has a consistent answer, and a location can be related to the
// configurations, contacts, documents and flexible assets it houses through the
// `location-record` relationship.
//
// This module owns the two catalogs, their field schemas, the display
// formatting the tables use, and the organization/location containment audit.
// The COMBINED standardized-record registry (organizations + locations +
// contacts + configurations) lives in ./standardized.js, which re-exports these
// pieces.

export const ORGANIZATION_KINDS = [
  {
    id: "organization",
    label: "Organization (client)",
    description: "The client itself — the top-level container for everything documented.",
  },
  { id: "department", label: "Department", description: "An internal department of a client or business unit." },
  { id: "business-unit", label: "Business unit", description: "A division, branch or trading entity of a client." },
];

export const ORGANIZATION_KIND_LABELS = Object.fromEntries(ORGANIZATION_KINDS.map((k) => [k.id, k.label]));
export const organizationKind = (id) => ORGANIZATION_KINDS.find((k) => k.id === id) || null;

export const LOCATION_TYPES = [
  { id: "office", label: "Office", description: "An administrative or staffed workplace." },
  { id: "branch", label: "Branch", description: "A secondary or satellite office." },
  { id: "site", label: "Site", description: "A customer or operational site (may be unstaffed)." },
  { id: "datacentre", label: "Datacentre", description: "A facility hosting servers, network and storage." },
  { id: "other", label: "Other", description: "A location that does not fit the standard types." },
];

export const LOCATION_TYPE_LABELS = Object.fromEntries(LOCATION_TYPES.map((t) => [t.id, t.label]));
export const locationType = (id) => LOCATION_TYPES.find((t) => t.id === id) || null;

// The field schemas the add/edit UI renders for these two standardized record
// types. `type: "record"` fields are selects populated from the set's existing
// records of `of`; `select` fields use `options`.
export const ORGANIZATION_FIELDS = [
  { key: "orgKind", label: "Organization kind", type: "select", options: ORGANIZATION_KINDS, required: true, default: "organization" },
  { key: "parentOrgId", label: "Parent organization", type: "record", of: "organizations", placeholder: "— none (top level) —" },
  { key: "legalName", label: "Legal name", type: "text", placeholder: "e.g. Northwind Trading Pty Ltd" },
  { key: "tradingName", label: "Trading name", type: "text" },
  { key: "taxId", label: "Tax / registration id", type: "text" },
  { key: "website", label: "Website", type: "text", placeholder: "https://…" },
  { key: "primaryPhone", label: "Primary phone", type: "text" },
  { key: "notes", label: "Notes", type: "textarea" },
];

export const LOCATION_FIELDS = [
  { key: "locationType", label: "Location type", type: "select", options: LOCATION_TYPES, required: true, default: "office" },
  { key: "siteCode", label: "Site code", type: "text", placeholder: "e.g. BNE-01" },
  { key: "parentLocationId", label: "Parent location", type: "record", of: "locations", placeholder: "— none —" },
  { key: "addressLine1", label: "Address line 1", type: "text" },
  { key: "addressLine2", label: "Address line 2", type: "text" },
  { key: "city", label: "City / suburb", type: "text" },
  { key: "region", label: "State / region", type: "text" },
  { key: "postalCode", label: "Postal code", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "timezone", label: "Time zone", type: "text", placeholder: "e.g. Australia/Brisbane" },
  { key: "phone", label: "Site phone", type: "text" },
  { key: "accessNotes", label: "Access notes", type: "textarea", placeholder: "Gate codes, parking, after-hours access…" },
];

// ---- display ---------------------------------------------------------------

export function formatAddress(record) {
  if (!record) return "";
  const parts = [
    record.addressLine1,
    record.addressLine2,
    [record.city, record.region, record.postalCode].filter(Boolean).join(" "),
    record.country,
  ].filter((p) => p && String(p).trim());
  return parts.join(", ");
}

const nameById = (set, type, id) => {
  const arr = (set && set.records && set.records[type]) || [];
  const found = arr.find((r) => r.id === id);
  return found ? found.name : id;
};

// A one-line summary for a table row: locations show type + address, orgs show
// kind + parent.
export function locationDetailLine(record, set) {
  if (!record) return "";
  const t = locationType(record.locationType);
  const bits = [t ? t.label : "Location"];
  const addr = formatAddress(record);
  if (addr) bits.push(addr);
  else if (record.siteCode) bits.push("Site " + record.siteCode);
  return bits.join(" · ");
}

export function organizationDetailLine(record, set) {
  if (!record) return "";
  const k = organizationKind(record.orgKind);
  const bits = [k ? k.label : "Organization"];
  if (record.parentOrgId) bits.push("under " + nameById(set, "organizations", record.parentOrgId));
  if (record.siteCode) bits.push(record.siteCode);
  return bits.join(" · ");
}

// ---- containment integrity (part of the set's graph audit) ------------------

const walkCycle = (start, next) => {
  const seen = new Set();
  let cur = start;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = next(cur);
  }
  return false;
};

export function containmentIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const orgIds = new Set(((set.records.organizations) || []).map((r) => r.id));
  const locIds = new Set(((set.records.locations) || []).map((r) => r.id));
  const orgParent = new Map();
  const locParent = new Map();
  for (const r of set.records.organizations || []) {
    if (r.parentOrgId) {
      if (!orgIds.has(r.parentOrgId)) {
        issues.push({ level: "error", code: "missing-parent-org", recordId: r.id, message: `Organization “${r.name}” names a parent organization that does not exist.` });
      } else if (r.parentOrgId === r.id) {
        issues.push({ level: "error", code: "self-parent-org", recordId: r.id, message: `Organization “${r.name}” is its own parent.` });
      }
      orgParent.set(r.id, r.parentOrgId);
    }
    if (!organizationKind(r.orgKind)) {
      issues.push({ level: "error", code: "unknown-org-kind", recordId: r.id, message: `Organization “${r.name}” has an unknown organization kind “${r.orgKind}”.` });
    }
  }
  for (const r of set.records.locations || []) {
    if (r.parentLocationId) {
      if (!locIds.has(r.parentLocationId)) {
        issues.push({ level: "error", code: "missing-parent-location", recordId: r.id, message: `Location “${r.name}” names a parent location that does not exist.` });
      } else if (r.parentLocationId === r.id) {
        issues.push({ level: "error", code: "self-parent-location", recordId: r.id, message: `Location “${r.name}” is its own parent.` });
      }
      locParent.set(r.id, r.parentLocationId);
    }
    if (!locationType(r.locationType)) {
      issues.push({ level: "error", code: "unknown-location-type", recordId: r.id, message: `Location “${r.name}” has an unknown location type “${r.locationType}”.` });
    }
  }
  for (const [id] of orgParent) {
    if (walkCycle(id, (x) => orgParent.get(x))) {
      issues.push({ level: "error", code: "org-cycle", recordId: id, message: "Organization containment contains a cycle." });
      break;
    }
  }
  for (const [id] of locParent) {
    if (walkCycle(id, (x) => locParent.get(x))) {
      issues.push({ level: "error", code: "location-cycle", recordId: id, message: "Location containment contains a cycle." });
      break;
    }
  }
  return issues;
}
