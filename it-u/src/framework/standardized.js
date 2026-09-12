// src/framework/standardized.js — the STANDARDIZED record-type registry
// (roadmap Phase 2, tasks 7–10).
//
// Four record types have a shape IT-U fixes itself rather than the user: an
// organization must declare its kind, a location its standardized type, a
// contact its role, and a configuration its device type. Each type owns a field
// schema (rendered by the add/edit dialog) and a display line (the table
// Details column); this module folds the four into the ONE catalog the docs
// service validates against and the UI reads from:
//
//   organizations  → organization.js
//   locations      → organization.js
//   contacts       → contact.js
//   configurations → configuration.js
//
// It also owns the shared validation (unknown standardized type / missing
// required field → a refused save) and the unified integrity audit for the
// standardized types (org/location containment, contact and configuration
// references).

import { StoreError } from "./store/errors.js";
import {
  ORGANIZATION_KINDS,
  ORGANIZATION_FIELDS,
  LOCATION_TYPES,
  LOCATION_FIELDS,
  locationType,
  organizationKind,
  organizationDetailLine,
  locationDetailLine,
  containmentIssues,
} from "./organization.js";
import { CONTACT_ROLES, CONTACT_FIELDS, contactRole, contactDetailLine, contactIssues } from "./contact.js";
import {
  validateChecklist,
  requireChecklist,
  checklistDetailLine,
  checklistIssues,
  checklistProgress,
  checklistItems,
} from "./checklist.js";
import { assetDetailLine, flexibleAssetIssues } from "./flexible.js";
import {
  PASSWORD_FIELDS,
  validatePassword,
  requirePassword,
  passwordDetailLine,
  passwordIssues,
  passwordScope,
  passwordCategory,
  passwordPermission,
  effectivePermissions,
  isEmbedded,
  ownerRef,
  credentialsFor,
  generalCredentials,
  embeddedCredentials,
  redactPassword,
} from "./password.js";
import {
  CONFIGURATION_TYPES,
  CONFIGURATION_FIELDS,
  configurationType,
  configurationDetailLine,
  configurationIssues,
  configurationCompleteness,
  normalizeCompletenessConfig,
  completenessReport,
} from "./configuration.js";
import {
  DOCUMENT_TYPES,
  DOCUMENT_FIELDS,
  documentType,
  validateDocument,
  requireDocument,
  documentDetailLine,
  documentIssues,
  documentReviewStatus,
  checklistSuitability,
  extractProcedureSteps,
  documentTemplate,
  isSopDoc,
  normalizeTags,
} from "./document.js";
import { SITE_TYPES, SITE_FIELDS, siteType, validateSite, requireSite, siteDetailLine, siteIssues } from "./site.js";
import {
  DIAGRAM_TYPES,
  DIAGRAM_FIELDS,
  RENDITION_FORMATS,
  SOURCE_FORMATS,
  diagramType,
  renditionFormat,
  sourceFormat,
  isImageFormat,
  validateDiagram,
  requireDiagram,
  diagramDetailLine,
  diagramIssues,
  diagramRenditions,
  hasEditableSource,
  primaryRendition,
} from "./diagram.js";
import {
  DNS_RECORD_TYPES,
  DOMAIN_STATUSES,
  DOMAIN_FIELDS,
  dnsRecordType,
  domainStatus,
  normalizeDomainName,
  isValidDomainName,
  validateDomain,
  requireDomain,
  domainDetailLine,
  domainIssues,
  domainExpiryStatus,
  dnsRecords,
  dnsSummary,
  lookupDomain,
} from "./domain.js";
import {
  CERTIFICATE_FIELDS,
  normalizeHostname,
  isValidHostname,
  validateCertificate,
  requireCertificate,
  certificateDetailLine,
  certificateIssues,
  certificateExpiryStatus,
  subjectAltNames,
  coversHostname,
  lookupCertificate,
} from "./certificate.js";
import { emailSystemIssues } from "./email.js";
import { backupIssues } from "./backup.js";
import { networkServiceIssues } from "./network.js";
import { circuitIssues } from "./circuit.js";
import { circuitProvisioningIssues } from "./circuitProvisioning.js";
import { circuitMigrationIssues } from "./circuitMigration.js";
import { addressingIssues } from "./addressing.js";
import { billingIssues } from "./billing.js";
import { serviceAssetIssues } from "./serviceAssets.js";
import { voicePlatformIssues } from "./voice.js";
import { voipCoverageIssues } from "./voipCoverage.js";
import { RUNBOOK_FIELDS, validateRunbook, runbookDetailLine, runbookIssues } from "./runbook.js";
import { cutoverIssues, isCutoverChecklist, cutoverAcceptanceLine } from "./cutover.js";

export const RECORD_FIELD_SCHEMAS = {
  organizations: ORGANIZATION_FIELDS,
  locations: LOCATION_FIELDS,
  contacts: CONTACT_FIELDS,
  configurations: CONFIGURATION_FIELDS,
  passwords: PASSWORD_FIELDS,
  documents: DOCUMENT_FIELDS,
  sites: SITE_FIELDS,
  diagrams: DIAGRAM_FIELDS,
  domains: DOMAIN_FIELDS,
  certificates: CERTIFICATE_FIELDS,
  runbooks: RUNBOOK_FIELDS,
};

export const STANDARDIZED_TYPES = [...Object.keys(RECORD_FIELD_SCHEMAS), "checklists", "flexibleAssets"];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// Validate a record against its standardized type. Never throws — the docs
// service turns the errors into a refused save.
export function validateRecordFields(type, record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A record must be an object."] };
  if (type === "organizations") {
    if (!organizationKind(record.orgKind)) {
      errors.push(`An organization record needs an organization kind (${ORGANIZATION_KINDS.map((x) => x.id).join(", ")}).`);
    }
  } else if (type === "locations") {
    if (!locationType(record.locationType)) {
      errors.push(`A location record needs a standardized location type (${LOCATION_TYPES.map((x) => x.id).join(", ")}).`);
    }
  } else if (type === "contacts") {
    if (!contactRole(record.contactRole)) {
      errors.push(`A contact record needs a contact role (${CONTACT_ROLES.map((x) => x.id).join(", ")}).`);
    }
  } else if (type === "configurations") {
    if (!configurationType(record.configType)) {
      errors.push(`A configuration record needs a configuration type (${CONFIGURATION_TYPES.map((x) => x.id).join(", ")}).`);
    }
  } else if (type === "passwords") {
    return validatePassword(record);
  } else if (type === "documents") {
    return validateDocument(record);
  } else if (type === "checklists") {
    return validateChecklist(record);
  } else if (type === "sites") {
    return validateSite(record);
  } else if (type === "diagrams") {
    return validateDiagram(record);
  } else if (type === "domains") {
    return validateDomain(record);
  } else if (type === "certificates") {
    return validateCertificate(record);
  } else if (type === "runbooks") {
    return validateRunbook(record);
  } else if (type === "flexibleAssets") {
    if (!record.assetTypeId || typeof record.assetTypeId !== "string" || !record.assetTypeId.trim()) {
      errors.push("A flexible asset needs an asset type (pick a template from the library).");
    }
    if (record.assetFields != null && (typeof record.assetFields !== "object" || Array.isArray(record.assetFields))) {
      errors.push("A flexible asset's fields must be an object.");
    }
    return { ok: errors.length === 0, errors };
  } else {
    return { ok: true, errors: [] };
  }
  for (const f of RECORD_FIELD_SCHEMAS[type] || []) {
    if (f.required && isBlank(record[f.key])) errors.push(`“${f.label}” is required.`);
  }
  return { ok: errors.length === 0, errors };
}

export function requireRecordFields(type, record) {
  const { ok, errors } = validateRecordFields(type, record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this record";
    throw new StoreError("INVALID_DATA", `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// The table Details line for any standardized record type. `opts.assetTypes`
// (a Map or array) lets a flexible asset render its template's summary.
export function recordDetailLine(record, set, opts = {}) {
  if (!record) return "";
  if (record.type === "organizations") return organizationDetailLine(record, set);
  if (record.type === "locations") return locationDetailLine(record, set);
  if (record.type === "contacts") return contactDetailLine(record, set);
  if (record.type === "configurations") return configurationDetailLine(record, set);
  if (record.type === "passwords") return passwordDetailLine(record, set);
  if (record.type === "documents") return documentDetailLine(record, set);
  if (record.type === "checklists") {
    const base = checklistDetailLine(record);
    return isCutoverChecklist(record) ? `${base} · ${cutoverAcceptanceLine(record)}` : base;
  }
  if (record.type === "sites") return siteDetailLine(record, set);
  if (record.type === "diagrams") return diagramDetailLine(record);
  if (record.type === "domains") return domainDetailLine(record, set);
  if (record.type === "certificates") return certificateDetailLine(record);
  if (record.type === "runbooks") return runbookDetailLine(record, set);
  if (record.type === "flexibleAssets") {
    const source = opts.assetTypes;
    const type = source instanceof Map ? source.get(record.assetTypeId) : (source || []).find((t) => t.id === record.assetTypeId);
    return assetDetailLine(record, type || null);
  }
  return "";
}

// The unified integrity audit for the standardized types. Completeness is
// deliberately NOT here — an incomplete configuration is a *quality* flag
// (completenessReport / configurationCompleteness), not a broken graph, so it
// must never make the set's graph audit fail.
export function standardizedIssues(set) {
  return [
    ...containmentIssues(set),
    ...contactIssues(set),
    ...configurationIssues(set),
    ...checklistIssues(set),
    ...flexibleAssetIssues(set),
    ...passwordIssues(set),
    ...documentIssues(set),
    ...siteIssues(set),
    ...diagramIssues(set),
    ...domainIssues(set),
    ...certificateIssues(set),
    ...emailSystemIssues(set),
    ...backupIssues(set),
    ...networkServiceIssues(set),
    ...circuitIssues(set),
    ...addressingIssues(set),
    ...billingIssues(set),
    ...serviceAssetIssues(set),
    ...voicePlatformIssues(set),
    ...voipCoverageIssues(set),
    ...runbookIssues(set),
    ...circuitProvisioningIssues(set),
    ...circuitMigrationIssues(set),
    ...cutoverIssues(set),
  ];
}

export {
  ORGANIZATION_KINDS,
  LOCATION_TYPES,
  CONTACT_ROLES,
  CONFIGURATION_TYPES,
  organizationKind,
  locationType,
  contactRole,
  configurationType,
  containmentIssues,
  configurationCompleteness,
  normalizeCompletenessConfig,
  completenessReport,
  validateChecklist,
  requireChecklist,
  checklistDetailLine,
  checklistIssues,
  checklistProgress,
  checklistItems,
  PASSWORD_FIELDS,
  validatePassword,
  requirePassword,
  passwordDetailLine,
  passwordIssues,
  passwordScope,
  passwordCategory,
  passwordPermission,
  effectivePermissions,
  isEmbedded,
  ownerRef,
  credentialsFor,
  generalCredentials,
  embeddedCredentials,
  redactPassword,
  DOCUMENT_TYPES,
  DOCUMENT_FIELDS,
  documentType,
  validateDocument,
  requireDocument,
  documentDetailLine,
  documentIssues,
  documentReviewStatus,
  checklistSuitability,
  extractProcedureSteps,
  documentTemplate,
  isSopDoc,
  normalizeTags,
  SITE_TYPES,
  SITE_FIELDS,
  siteType,
  validateSite,
  requireSite,
  siteDetailLine,
  siteIssues,
  DIAGRAM_TYPES,
  DIAGRAM_FIELDS,
  RENDITION_FORMATS,
  SOURCE_FORMATS,
  diagramType,
  renditionFormat,
  sourceFormat,
  isImageFormat,
  validateDiagram,
  requireDiagram,
  diagramDetailLine,
  diagramIssues,
  diagramRenditions,
  hasEditableSource,
  primaryRendition,
  DNS_RECORD_TYPES,
  DOMAIN_STATUSES,
  DOMAIN_FIELDS,
  dnsRecordType,
  domainStatus,
  normalizeDomainName,
  isValidDomainName,
  validateDomain,
  requireDomain,
  domainDetailLine,
  domainIssues,
  domainExpiryStatus,
  dnsRecords,
  dnsSummary,
  lookupDomain,
  CERTIFICATE_FIELDS,
  normalizeHostname,
  isValidHostname,
  validateCertificate,
  requireCertificate,
  certificateDetailLine,
  certificateIssues,
  certificateExpiryStatus,
  subjectAltNames,
  coversHostname,
  lookupCertificate,
  RUNBOOK_FIELDS,
  validateRunbook,
  runbookDetailLine,
  runbookIssues,
  cutoverIssues,
  isCutoverChecklist,
  cutoverAcceptanceLine,
  voipCoverageIssues,
  circuitProvisioningIssues,
  circuitMigrationIssues,
  addressingIssues,
  billingIssues,
};
