// src/framework/flexible.js — Flexible Asset types & records (roadmap Phase 3,
// tasks 12–13).
//
// A Flexible Asset is the user-defined counterpart of a standardized Core
// Asset: information that does not fit organizations/locations/contacts/
// configurations gets a user-authored TYPE (a "template") that declares its
// fields, each field's type, which fields are required, and which record types
// the asset is allowed to reference. Types live in ONE GLOBAL library
// (./flexibleTypes.js, ./assetLibrary.js) shared across every documentation set,
// so a house standard is defined once and used for every client.
//
// This module is the single source of truth for the field-type catalog, the
// asset-type shape, its validation, the default values / normalization of a
// record's `assetFields`, and the display line + integrity audit that
// ./standardized.js folds into the combined registry.

import { StoreError, CODES } from "./store/errors.js";
import { newId, slugify } from "./ids.js";

export const ASSET_TYPE_SCHEMA = "itu-asset-type/1";
export const ASSET_LIBRARY_SCHEMA = "itu-flexible-types/1";
// Bumped whenever the SHIPPED template set changes shape. The global library
// reconciles itself up to this version on load (./flexibleTypes.js): missing
// shipped templates are added, un-customised builtins are refreshed, and shipped
// templates that are no longer shipped (retired builtins) are removed — while
// custom types and in-place customisations are preserved.
export const ASSET_LIBRARY_VERSION = 12;

export const ASSET_CATEGORIES = [
  { id: "applications", label: "Applications", description: "Line-of-business, cloud and platform software." },
  { id: "commercial", label: "Commercial", description: "Vendors, licensing and subscription arrangements." },
  { id: "infrastructure", label: "Infrastructure", description: "Virtualization, backup, storage and other platform services." },
  { id: "security", label: "Security", description: "Security platforms, remote access and protective controls." },
  { id: "connectivity", label: "Connectivity", description: "Internet/WAN circuits, LAN and wireless services." },
  { id: "workforce", label: "Workforce", description: "People-side structure: user roles and the software builds they use." },
  { id: "custom", label: "Custom", description: "Anything else a client's environment needs." },
];

export const ASSET_CATEGORY_LABELS = Object.fromEntries(ASSET_CATEGORIES.map((c) => [c.id, c.label]));
export const assetCategory = (id) => ASSET_CATEGORIES.find((c) => c.id === id) || null;

export const ASSET_FIELD_TYPES = [
  { id: "text", label: "Text", description: "A single line of text." },
  { id: "textarea", label: "Long text", description: "Several lines of text." },
  { id: "number", label: "Number", description: "A numeric value." },
  { id: "date", label: "Date", description: "A calendar date." },
  { id: "checkbox", label: "Yes / no", description: "A checkbox." },
  { id: "select", label: "Single choice", description: "One value from a fixed list." },
  { id: "multiselect", label: "Multiple choice", description: "Any number of values from a fixed list." },
  { id: "url", label: "URL", description: "A web address." },
  { id: "email", label: "Email", description: "An email address." },
  { id: "phone", label: "Phone", description: "A phone number." },
  { id: "record", label: "Record reference", description: "A link to another record in the same client set." },
];

export const ASSET_FIELD_TYPE_IDS = ASSET_FIELD_TYPES.map((t) => t.id);
export const assetFieldType = (id) => ASSET_FIELD_TYPES.find((t) => t.id === id) || null;

// The record collections a template may reference, and the option label.
export const REFERENCE_TYPES = [
  { id: "organizations", label: "Organization" },
  { id: "locations", label: "Location" },
  { id: "contacts", label: "Contact" },
  { id: "configurations", label: "Configuration" },
  { id: "passwords", label: "Password" },
  { id: "documents", label: "Document" },
  { id: "domains", label: "Domain" },
  { id: "checklists", label: "Checklist" },
  { id: "flexibleAssets", label: "Flexible asset" },
  { id: "trackers", label: "Tracker" },
  { id: "runbooks", label: "Runbook" },
];
export const REFERENCE_TYPE_IDS = REFERENCE_TYPES.map((t) => t.id);
export const referenceType = (id) => REFERENCE_TYPES.find((t) => t.id === id) || null;

const str = (v) => String(v == null ? "" : v).trim();
const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

export function assetTypeId(name, taken = []) {
  const base = "atype-" + (slugify(name) || newId("type").slice(7));
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(base + "-" + n)) n += 1;
  return base + "-" + n;
}

// A field key unique within the type, derived from its label.
export function fieldKey(label, taken = []) {
  let base = slugify(label).replace(/-/g, "_") || "field";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(base + "_" + n)) n += 1;
  return base + "_" + n;
}

// Normalize an authored field definition: a stable key, a known type, options
// for choice fields, and a reference collection for record fields.
export function normalizeField(field = {}, taken = []) {
  const label = str(field.label) || "Field";
  const type = ASSET_FIELD_TYPE_IDS.includes(field.type) ? field.type : "text";
  const out = {
    key: field.key && !taken.includes(field.key) ? field.key : fieldKey(label, taken),
    label,
    type,
    required: !!field.required,
    placeholder: str(field.placeholder),
    help: str(field.help),
  };
  // A field flagged `expiry` is the record's renewal/expiry date: the renewals
  // engine (./renewals.js) reads it to raise upcoming/overdue reminders, and the
  // template designer exposes the flag on date fields.
  if (field.expiry) out.expiry = true;
  if (type === "select" || type === "multiselect") {
    const options = Array.isArray(field.options) ? field.options : [];
    out.options = options
      .map((o) => (typeof o === "string" ? { id: slugify(o) || o, label: o } : { id: str(o && o.id), label: str(o && o.label) }))
      .filter((o) => o.id && o.label);
    if (field.default != null) out.default = str(field.default);
  } else if (type === "record") {
    out.of = REFERENCE_TYPE_IDS.includes(field.of) ? field.of : "organizations";
  } else if (field.default != null && str(field.default) !== "") {
    // Preserve a seeded default for the remaining editable field types.
    out.default = str(field.default);
  }
  return out;
}

// Normalize an authored field list: assign unique keys, drop nothing silently,
// keep order.
export function normalizeAssetFields(fields) {
  const taken = [];
  return (Array.isArray(fields) ? fields : []).map((f) => {
    const nf = normalizeField(f, taken);
    taken.push(nf.key);
    return nf;
  });
}

// Validate an asset TYPE (a template). Never throws — the service turns the
// errors into a refused save.
export function validateAssetType(type) {
  const errors = [];
  if (!type || typeof type !== "object") return { ok: false, errors: ["An asset type must be an object."] };
  if (!str(type.name)) errors.push("An asset type needs a name.");
  if (type.category && !assetCategory(type.category)) errors.push(`Unknown asset type category “${type.category}”.`);
  if (!Array.isArray(type.fields)) {
    errors.push("An asset type needs a fields array.");
    return { ok: errors.length === 0, errors };
  }
  const keys = new Set();
  for (const f of type.fields) {
    if (!f || typeof f !== "object") {
      errors.push("Every field must be an object.");
      continue;
    }
    if (!str(f.label)) errors.push("Every field needs a label.");
    if (!f.key) errors.push(`Field “${str(f.label) || "?"}” has no key.`);
    else if (keys.has(f.key)) errors.push(`Duplicate field key “${f.key}”.`);
    else keys.add(f.key);
    if (!ASSET_FIELD_TYPE_IDS.includes(f.type)) {
      errors.push(`Field “${str(f.label) || f.key}” has an unknown field type “${f.type}”.`);
    } else if ((f.type === "select" || f.type === "multiselect") && (!Array.isArray(f.options) || !f.options.length)) {
      errors.push(`Choice field “${str(f.label) || f.key}” needs at least one option.`);
    } else if (f.type === "record" && !REFERENCE_TYPE_IDS.includes(f.of)) {
      errors.push(`Reference field “${str(f.label) || f.key}” must name a referenceable record type.`);
    }
  }
  if (Array.isArray(type.references)) {
    for (const r of type.references) {
      if (!REFERENCE_TYPE_IDS.includes(r)) errors.push(`Unknown allowed reference “${r}”.`);
    }
  } else if (type.references != null) {
    errors.push("Allowed references must be an array of record types.");
  }
  return { ok: errors.length === 0, errors };
}

export function requireAssetType(type) {
  const { ok, errors } = validateAssetType(type);
  if (!ok) {
    const name = type && type.name ? String(type.name) : "This asset type";
    throw new StoreError(CODES.INVALID_DATA, `${name} cannot be saved — ${errors.join(" ")}`);
  }
  return type;
}

export function makeAssetType(input = {}, { now = Date.now() } = {}) {
  const fields = normalizeAssetFields(input.fields);
  const references = Array.isArray(input.references) ? [...new Set(input.references.filter((r) => REFERENCE_TYPE_IDS.includes(r)))] : [];
  return {
    schema: ASSET_TYPE_SCHEMA,
    id: input.id || assetTypeId(input.name),
    name: str(input.name),
    description: str(input.description),
    category: assetCategory(input.category) ? input.category : "custom",
    icon: str(input.icon) || "layers",
    fields,
    references,
    builtin: !!input.builtin,
    customized: false,
    createdAt: input.createdAt || now,
    updatedAt: now,
    createdBy: input.createdBy || "system",
  };
}

// A blank record's fields for a type (defaults applied).
export function emptyAssetFields(type) {
  const out = {};
  for (const f of (type && type.fields) || []) {
    if (f.type === "checkbox") out[f.key] = false;
    else if (f.type === "multiselect") out[f.key] = [];
    else if (f.default != null) out[f.key] = f.default;
    else out[f.key] = "";
  }
  return out;
}

export function assetFieldsOf(record) {
  return record && record.assetFields && typeof record.assetFields === "object" && !Array.isArray(record.assetFields) ? record.assetFields : {};
}

// Is a field's stored value considered present?
export function hasAssetValue(field, value) {
  if (!field) return false;
  if (field.type === "checkbox") return value === true;
  if (field.type === "multiselect") return Array.isArray(value) ? value.length > 0 : !isBlank(value);
  return !isBlank(value);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate a record's fields against its type. Never throws — the assets
// service turns the errors into a refused save.
export function validateAssetRecord(type, record) {
  const errors = [];
  if (!type) return { ok: false, errors: ["This flexible asset has no asset type."] };
  if (!record || typeof record !== "object") return { ok: false, errors: ["A flexible asset must be an object."] };
  const values = assetFieldsOf(record);
  for (const f of type.fields || []) {
    const value = values[f.key];
    if (f.required && !hasAssetValue(f, value)) {
      errors.push(`“${f.label}” is required.`);
      continue;
    }
    if (!hasAssetValue(f, value)) continue;
    if (f.type === "number" && (value === "" || value == null || Number.isNaN(Number(value)))) {
      errors.push(`“${f.label}” must be a number.`);
    } else if (f.type === "email" && !EMAIL.test(String(value))) {
      errors.push(`“${f.label}” must be a valid email address.`);
    } else if (f.type === "url" && !/^https?:\/\/\S+$/i.test(String(value))) {
      errors.push(`“${f.label}” must be a valid http(s) URL.`);
    } else if (f.type === "select" && !(f.options || []).some((o) => o.id === value)) {
      errors.push(`“${f.label}” must be one of its allowed options.`);
    } else if (f.type === "multiselect") {
      const arr = Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
      const bad = arr.filter((v) => !(f.options || []).some((o) => o.id === v));
      if (bad.length) errors.push(`“${f.label}” contains an unknown option: ${bad.join(", ")}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function requireAssetRecord(type, record) {
  const { ok, errors } = validateAssetRecord(type, record);
  if (!ok) {
    const name = record && record.name ? String(record.name) : "This flexible asset";
    throw new StoreError(CODES.INVALID_DATA, `${name} cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// Index an array of types by id.
export function assetTypeIndex(types) {
  const map = new Map();
  for (const t of types || []) if (t && t.id) map.set(t.id, t);
  return map;
}

// A one-line summary for a table row: the type, then up to three filled fields
// (choice fields rendered with their option label).
export function assetDetailLine(record, type) {
  if (!record) return "";
  if (!type) return "Unknown asset type";
  const bits = [type.name];
  const values = assetFieldsOf(record);
  let shown = 0;
  for (const f of type.fields || []) {
    if (shown >= 3) break;
    const v = values[f.key];
    if (!hasAssetValue(f, v)) continue;
    if (f.type === "checkbox") bits.push(f.label);
    else if (f.type === "select") bits.push((f.options.find((o) => o.id === v) || {}).label || v);
    else if (f.type === "multiselect") {
      const arr = Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);
      bits.push(arr.map((x) => (f.options.find((o) => o.id === x) || {}).label || x).join(", "));
    } else bits.push(String(v));
    shown += 1;
  }
  return bits.join(" · ");
}

// Integrity audit for a set's flexible assets. Structural checks always run;
// pass the shared `types` (array or Map) to also validate each record against
// its template and to flag dangling record references.
export function flexibleAssetIssues(set, types = null) {
  const issues = [];
  if (!set || !set.records) return issues;
  const index = types ? (types instanceof Map ? types : assetTypeIndex(types)) : null;
  const exists = (collection, id) => (set.records[collection] || []).some((r) => r.id === id);
  for (const r of set.records.flexibleAssets || []) {
    if (!str(r.assetTypeId)) {
      issues.push({ level: "error", code: "asset-missing-type", recordId: r.id, message: `Flexible asset “${r.name}” has no asset type.` });
      continue;
    }
    if (r.assetFields != null && (typeof r.assetFields !== "object" || Array.isArray(r.assetFields))) {
      issues.push({ level: "error", code: "asset-bad-fields", recordId: r.id, message: `Flexible asset “${r.name}” has malformed fields.` });
      continue;
    }
    if (!index) continue;
    const type = index.get(r.assetTypeId) || null;
    if (!type) {
      issues.push({ level: "error", code: "asset-unknown-type", recordId: r.id, message: `Flexible asset “${r.name}” uses an asset type “${r.assetTypeId}” that is not in the library.` });
      continue;
    }
    const v = validateAssetRecord(type, r);
    for (const message of v.errors) {
      issues.push({ level: "error", code: "asset-invalid", recordId: r.id, message: `Flexible asset “${r.name}”: ${message}` });
    }
    const values = assetFieldsOf(r);
    for (const f of type.fields || []) {
      if (f.type !== "record") continue;
      const id = values[f.key];
      if (isBlank(id)) continue;
      if (!exists(f.of, id)) {
        issues.push({
          level: "error",
          code: "asset-dangling-reference",
          recordId: r.id,
          message: `Flexible asset “${r.name}”: “${f.label}” references a ${referenceType(f.of) ? referenceType(f.of).label.toLowerCase() : f.of} that does not exist.`,
        });
      }
    }
  }
  return issues;
}
