// src/framework/site.js — site summaries (roadmap Phase 5, task 23).
//
// A SITE SUMMARY is a standardized record describing ONE physical facility — a
// data centre, comms room, office or branch — as a structured asset a
// technician can read before attending. It captures the practical facts prose
// documents bury (access and hours, power, cooling, connectivity, security and
// environment) and is the anchor the site's maps, network diagrams, rack
// elevations, floor plans and photos hang off.
//
// The site summary is the STRUCTURED half of task 23; the drawings themselves
// are `diagrams` records (see ./diagram.js), linked to the site, its location
// and the assets they describe. This module is pure data + pure functions; the
// site's own field form is rendered by the shared standardized-field builder.
//
// A site summary is deliberately NOT a location (a location is where a single
// record physically sits); it is the facility an engineer is briefed on — the
// door code, which cabinet has the spare power, where the fibre enters.

import { StoreError, CODES } from "./store/errors.js";

// `group` is the section the type is shown under; `icon` is an icons.js key.
export const SITE_TYPES = [
  { id: "datacentre", label: "Data centre", group: "Facility", icon: "server", description: "A commercial or private data centre / colocation cage." },
  { id: "comms-room", label: "Comms room / MDF", group: "Facility", icon: "box", description: "A dedicated comms room, MDF or IDF closet." },
  { id: "colo", label: "Colocation / hosted", group: "Facility", icon: "database", description: "Racks or space rented in a third party's facility." },
  { id: "office", label: "Office", group: "Premises", icon: "building", description: "A staffed office or headquarters." },
  { id: "branch", label: "Branch / remote site", group: "Premises", icon: "building", description: "A smaller branch or unattended remote site." },
  { id: "warehouse", label: "Warehouse / industrial", group: "Premises", icon: "box", description: "A warehouse, workshop or industrial premises." },
  { id: "other", label: "Other site", group: "Other", icon: "box", description: "A site that does not fit the standard types." },
];

export const SITE_GROUPS = ["Facility", "Premises", "Other"];

export const siteType = (id) => SITE_TYPES.find((s) => s.id === id) || null;
export const siteTypeLabel = (id) => (siteType(id) || {}).label || null;
export const sitesOfGroup = (group) => SITE_TYPES.filter((s) => s.group === group);

// The structured facts a site summary carries. `locationId` ties it to the
// standardized Location record; the rest are the practical notes an engineer
// needs before they walk in the door.
export const SITE_FIELDS = [
  { key: "siteType", label: "Site type", type: "select", options: SITE_TYPES, required: true, default: "office" },
  { key: "locationId", label: "Location", type: "record", of: "locations", placeholder: "— none —", help: "The standardized location record for this site." },
  { key: "accessNotes", label: "Access & hours", type: "textarea", placeholder: "Door codes, key-holders, building hours, escort requirements" },
  { key: "powerNotes", label: "Power", type: "textarea", placeholder: "Supply, circuits, UPS, generator, which racks have spare capacity" },
  { key: "coolingNotes", label: "Cooling", type: "textarea", placeholder: "Cooling type, set points, known hot spots" },
  { key: "connectivityNotes", label: "Connectivity & entry", type: "textarea", placeholder: "Carrier entry point, fibre/copper, who to call for the building" },
  { key: "securityNotes", label: "Security", type: "textarea", placeholder: "Alarm, CCTV, access control, sign-in process" },
  { key: "environmentNotes", label: "Environment", type: "textarea", placeholder: "Hazards, noise, ceiling/floor, ladder access, parking" },
  { key: "emergencyNotes", label: "Emergency & escalation", type: "textarea", placeholder: "Out-of-hours contacts, power-down procedure, emergency numbers" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

const nameById = (set, type, id) => {
  const found = ((set && set.records && set.records[type]) || []).find((r) => r.id === id);
  return found ? found.name : null;
};

// A one-line summary for a table row: type · location · the notes that exist.
export function siteDetailLine(record, set) {
  if (!record) return "";
  const t = siteType(record.siteType);
  const bits = [t ? t.label : "Site"];
  const loc = record.locationId ? nameById(set, "locations", record.locationId) : null;
  if (loc) bits.push(loc);
  const noteCount = SITE_FIELDS.filter((f) => f.type === "textarea" && !isBlank(record[f.key])).length;
  if (noteCount) bits.push(noteCount + " note" + (noteCount === 1 ? "" : "s"));
  return bits.join(" · ");
}

export function validateSite(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A site summary must be an object."] };
  if (!siteType(record.siteType)) {
    errors.push(`A site summary must declare a site type (${SITE_TYPES.map((s) => s.id).join(", ")}).`);
  }
  return { ok: errors.length === 0, errors };
}

export function requireSite(record) {
  const { ok, errors } = validateSite(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this site summary";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// The set's graph audit for site summaries: an unknown type is an error; a site
// with no location reference is a warning (it is usable, but not tied into the
// location graph); a reference to a location that no longer exists is an error.
export function siteIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const locIds = new Set(((set.records.locations) || []).map((r) => r.id));
  for (const r of set.records.sites || []) {
    const t = siteType(r.siteType);
    if (!t) {
      issues.push({ level: "error", code: "unknown-site-type", recordId: r.id, message: `Site summary “${r.name}” has an unknown site type “${r.siteType}”.` });
      continue;
    }
    if (!r.locationId) {
      issues.push({ level: "warning", code: "site-without-location", recordId: r.id, message: `Site summary “${r.name}” is not linked to a location record.` });
    } else if (!locIds.has(r.locationId)) {
      issues.push({ level: "error", code: "missing-site-location", recordId: r.id, message: `Site summary “${r.name}” references a location that does not exist.` });
    }
  }
  return issues;
}
