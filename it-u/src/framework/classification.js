// src/framework/classification.js — record classification & provenance
// (roadmap Phase 1, task 3).
//
// IT-U requires EVERY entity record to carry two classifications, and refuses
// to save a record without them:
//
//   • informationModel — which of the four information models the record
//     belongs to: Core Asset, Flexible Asset, Document, or Integration-managed.
//   • provenance — where the record's content came from and how it is kept:
//     directly authored, imported once, continuously synchronized, related to
//     another record, linked to an external authoritative source, or stored as
//     an attachment/document.
//
// Relationship records are typed links rather than documented entities (they
// carry from/to/kind instead of content), so they are exempt — see
// relationships.js and RECORD_TYPES in docsets.js.
//
// Both catalogs are data, so the UI, the linter and exports all read the same
// source of truth. A provenance may REQUIRE extra origin detail (e.g. a
// synchronized record must name the system that syncs it); those requirements
// are declared here and enforced on save.

import { StoreError, CODES } from "./store/errors.js";

export const INFORMATION_MODELS = [
  {
    id: "core-asset",
    label: "Core Asset",
    short: "Core",
    description:
      "A standardized asset type whose shape is fixed by IT-U and never reshaped by the user.",
  },
  {
    id: "flexible-asset",
    label: "Flexible Asset",
    short: "Flexible",
    description: "A customizable structured record defined by a Flexible Asset template.",
  },
  {
    id: "document",
    label: "Document",
    short: "Doc",
    description:
      "Long-form authoring: documents, SOPs, checklists, site summaries and deployment runbooks.",
  },
  {
    id: "integration",
    label: "Integration-managed",
    short: "Integration",
    description: "A record kept in step by an external system of record (PSA/RMM/ISP/voice platform).",
  },
];

export const PROVENANCE = [
  {
    id: "authored",
    label: "Directly authored",
    short: "Authored",
    description: "Written directly in IT-U by a person.",
    requires: [],
  },
  {
    id: "imported",
    label: "Imported once",
    short: "Imported",
    description: "Imported from an external source once, and maintained here thereafter.",
    requires: ["source"],
    requireLabel: "Import source",
    placeholder: "e.g. CSV import from the previous documentation tool",
  },
  {
    id: "synchronized",
    label: "Continuously synchronized",
    short: "Synced",
    description: "Kept in step by an external system of record.",
    requires: ["source"],
    requireLabel: "Synchronizing system",
    placeholder: "e.g. RMM platform, ISP portal",
  },
  {
    id: "related",
    label: "Related to another record",
    short: "Related",
    description: "Derived from, or reflecting, another record it links to.",
    requires: ["sourceId"],
    requireLabel: "Related record",
    placeholder: "The id of the related record",
  },
  {
    id: "external",
    label: "Linked to an external authoritative source",
    short: "External",
    description: "Points at an authoritative external source (a live URL).",
    requires: ["sourceUrl"],
    requireLabel: "Source URL",
    placeholder: "https://…",
  },
  {
    id: "attachment",
    label: "Stored as an attachment/document",
    short: "Attachment",
    description: "Stored as a file or attachment rather than structured fields.",
    requires: ["attachmentUrl"],
    requireLabel: "Attachment URL",
    placeholder: "https://…",
  },
];

export const informationModel = (id) => INFORMATION_MODELS.find((m) => m.id === id) || null;
export const provenanceDef = (id) => PROVENANCE.find((p) => p.id === id) || null;

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// Read an origin field from `record.origin` (falling back to the record's own
// top-level field, so callers can pass either shape).
export function originValue(record, field) {
  if (!record) return undefined;
  const o = record.origin;
  if (o && typeof o === "object" && o[field] !== undefined) return o[field];
  return record[field];
}

// Validate a record's classification. Returns { ok, errors[] } — never throws,
// so callers (forms, the linter) can show the problems instead of failing hard.
export function validateClassification(record) {
  const errors = [];
  if (!record || typeof record !== "object") {
    return { ok: false, errors: ["A record must be an object to be classified."] };
  }
  if (!informationModel(record.informationModel)) {
    errors.push(
      "An information model is required (Core Asset, Flexible Asset, Document, or Integration-managed).",
    );
  }
  const p = provenanceDef(record.provenance);
  if (!p) {
    errors.push(
      "A provenance classification is required (directly authored, imported once, continuously synchronized, related to another record, linked to an external source, or stored as an attachment).",
    );
  } else {
    for (const field of p.requires) {
      if (isBlank(originValue(record, field))) {
        errors.push(`${p.label} provenance requires a value for “${p.requireLabel || field}”.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function classificationError(record) {
  const { ok, errors } = validateClassification(record);
  return ok ? null : errors.join(" ");
}

// Throw a typed store error when the record is not properly classified — the
// "refuse to save without one" guarantee. Returns the record on success so it
// can be used inline.
export function requireClassification(record) {
  const { ok, errors } = validateClassification(record);
  if (!ok) {
    const name = record && (record.name || record.id || record.type) ? String(record.name || record.id) : "this record";
    throw new StoreError(
      CODES.UNCLASSIFIED_RECORD,
      `“${name}” cannot be saved without a classification — ${errors.join(" ")}`,
    );
  }
  return record;
}

// A snapshot of a record's classification for display (badge labels etc.).
export function classificationOf(record) {
  const m = informationModel(record && record.informationModel);
  const p = provenanceDef(record && record.provenance);
  return {
    informationModel: (record && record.informationModel) || null,
    provenance: (record && record.provenance) || null,
    model: m,
    provenanceDef: p,
    modelLabel: m ? m.label : "Unclassified",
    provenanceLabel: p ? p.label : "Unclassified",
  };
}
