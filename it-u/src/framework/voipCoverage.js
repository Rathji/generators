// src/framework/voipCoverage.js — VoIP relationship & lifecycle coverage
// (roadmap Phase 9, task 39).
//
// Task 36 models the voice platform as a structured Voice/PBX asset and task 37
// writes the deployment runbook; task 38 drives and proves the switch. Task 39
// is the COVERAGE guarantee: a voice deployment is only genuinely documented
// when everything around it is linked AND lifecycle-aware — every handset, PBX
// and SBC held as a configuration, every credential held as a password
// (embedded where it belongs to a device), every trunk held as an internet/WAN
// circuit relationship, every subscription surfaced through licensing, every
// vendor through the vendor asset, and every number/port date and support
// entitlement captured in the lifecycle trackers.
//
// ./voice.js answers "is the Voice/PBX asset itself described?" (its platform,
// deployment model, number inventory, emergency config, and the handful of links
// the linter already flags). This module answers the wider question — "is the
// DEPLOYMENT fully linked and lifecycle-aware?" — for the runbook/cutover/UI
// path. It is the single source of truth for:
//   • VOIP_COVERAGE_REQUIREMENTS — the relationship and lifecycle coverage a
//     complete voice deployment must satisfy;
//   • voipRelationshipCoverage / voipLifecycleCoverage — the per-requirement
//     evaluation (links AND the equivalent record-field references);
//   • voipLifecycleItems — the datable items belonging to the deployment;
//   • voipDeploymentCoverage — the combined report the UI renders;
//   • voipCoverageIssues — the Linter audit (./standardized.js folds it in),
//     deliberately using codes voice.js does NOT already emit, so nothing is
//     double-reported.
//
// A new lifecycle kind, `number-port`, surfaces the voice asset's port date in
// the Trackers lifecycle view (./lifecycle.js).

import { relationsOf, findRecord } from "./relationships.js";
import { VOICE_PBX_TYPE_ID, isPortComplete, portingStatusLabel } from "./voice.js";
import { extractLifecycleItems } from "./lifecycle.js";
import { expiryFieldOf } from "./renewals.js";
import { assetFieldsOf } from "./flexible.js";
import { builtinAssetType } from "./assetLibrary.js";

const str = (v) => String(v == null ? "" : v).trim();
const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const refOf = (r) => ({ type: r.type, id: r.id });

export const VOIP_COVERAGE_GROUPS = [
  { id: "relationships", label: "Relationships", description: "Every part of the deployment linked to the record that documents it." },
  { id: "lifecycle", label: "Lifecycle", description: "Every date that matters — ports and support entitlements — captured in the trackers." },
];

// ---- the coverage catalog ---------------------------------------------------
// `kinds` are the relationship kinds that satisfy the requirement; `fieldKeys`
// are the record-field references on the voice asset that satisfy it too (so a
// platform wired by field rather than link still counts). `linterCode` is the
// warning the Linter raises when a REQUIRED requirement is unmet — left empty
// where ./voice.js already reports the gap (its circuit/security/credential
// checks), so the linter never double-counts.
export const VOIP_COVERAGE_REQUIREMENTS = [
  // relationships
  {
    id: "endpoints",
    label: "Handsets, PBX & SBC as configurations",
    group: "relationships",
    level: "required",
    kinds: ["voice-configuration", "voice-sbc"],
    fieldKeys: ["pbxHostRecord", "sbcRecord"],
    collections: ["configurations"],
    detail: "The host or appliance running the PBX, and the SBC/firewall the voice traffic traverses, are configuration records.",
    fix: "Record the PBX host and the SBC/firewall as configurations and link them.",
    linterCode: "voip-no-endpoints",
  },
  {
    id: "credentials",
    label: "Credentials held as passwords",
    group: "relationships",
    level: "required",
    kinds: ["voice-password"],
    fieldKeys: ["adminCredential"],
    collections: ["passwords"],
    detail: "Administrator and service credentials are password records — embedded where the credential belongs to a specific device.",
    fix: "Add the platform's administrator credential as a password and link it (embedded if it belongs to a device).",
    linterCode: "", // voice.js already raises voice-no-credential
  },
  {
    id: "circuit",
    label: "Trunks held as internet/WAN circuits",
    group: "relationships",
    level: "required",
    kinds: ["voice-circuit"],
    fieldKeys: ["circuit"],
    collections: ["flexibleAssets"],
    detail: "The internet/WAN circuit (or trunk) carrying the voice traffic is a circuit record, not a note.",
    fix: "Create the internet/WAN circuit and link it to the voice platform.",
    linterCode: "", // voice.js already raises voice-no-circuit
  },
  {
    id: "security",
    label: "Security platform linked",
    group: "relationships",
    level: "required",
    kinds: ["voice-security"],
    fieldKeys: ["securityRecord"],
    collections: ["flexibleAssets"],
    detail: "The firewall and security platform protecting the voice service are linked.",
    fix: "Link the firewall/security platform that guards the voice service.",
    linterCode: "", // voice.js already raises voice-no-security
  },
  {
    id: "licensing",
    label: "Subscriptions through licensing",
    group: "relationships",
    level: "required",
    kinds: ["licence-application"],
    direction: "in",
    collections: ["flexibleAssets"],
    filterTypes: ["atype-licences"],
    detail: "Licences and subscriptions covering the voice platform are linked, so renewals surface in the lifecycle view.",
    fix: "Add the licence/subscription record and link it to the voice platform.",
    linterCode: "voip-no-licensing",
  },
  {
    id: "vendor",
    label: "Vendor through the vendor asset",
    group: "relationships",
    level: "required",
    kinds: ["voice-vendor"],
    fieldKeys: ["vendorRecord"],
    collections: ["flexibleAssets"],
    filterTypes: ["atype-vendor"],
    detail: "The provider or carrier the voice service is held with is a vendor record.",
    fix: "Create the vendor record and link it to the voice platform.",
    linterCode: "voip-no-vendor",
  },
  {
    id: "application",
    label: "Voice applications linked",
    group: "relationships",
    level: "recommended",
    kinds: ["voice-application"],
    fieldKeys: ["voiceApplication"],
    collections: ["flexibleAssets"],
    filterTypes: ["atype-applications"],
    detail: "The platform and its management/monitoring tools are application records.",
    fix: "Link the voice applications (platform and management tools).",
    linterCode: "",
  },
  {
    id: "documents",
    label: "Supporting documents linked",
    group: "relationships",
    level: "recommended",
    kinds: ["voice-document"],
    fieldKeys: ["document"],
    collections: ["documents"],
    detail: "Dial plans, deployment notes and platform documentation are linked.",
    fix: "Link the dial plan or deployment notes.",
    linterCode: "",
  },
  {
    id: "checklists",
    label: "Deployment checklists linked",
    group: "relationships",
    level: "recommended",
    kinds: ["voice-checklist"],
    fieldKeys: ["deploymentChecklist"],
    collections: ["checklists"],
    detail: "The build and cut-over checklists followed for the deployment are linked.",
    fix: "Link the deployment/cutover checklist.",
    linterCode: "",
  },
  {
    id: "contacts",
    label: "Ownership & contacts",
    group: "relationships",
    level: "required",
    kinds: ["contact-voice"],
    direction: "in",
    collections: ["contacts"],
    detail: "The people responsible for the voice platform are recorded and linked.",
    fix: "Record the responsible contact and link them to the voice platform.",
    linterCode: "voip-no-contact",
  },
  // lifecycle
  {
    id: "number-port",
    label: "Number/port date in the trackers",
    group: "lifecycle",
    level: "required",
    detail: "The port date (or an explicit “not required”) is recorded, so the switch is scheduled and tracked rather than remembered.",
    fix: "Record the number-port date on the voice asset, or mark porting “not required”.",
    linterCode: "voip-no-port-date",
  },
  {
    id: "support-entitlement",
    label: "Support entitlement expiry",
    group: "lifecycle",
    level: "required",
    detail: "A support or warranty expiry is recorded on one of the deployment's configurations, so cover is renewed before it lapses.",
    fix: "Record a support/warranty expiry (or a licence renewal date) for the deployment.",
    linterCode: "voip-no-support",
  },
  {
    id: "subscription-expiry",
    label: "Subscription/licence expiry",
    group: "lifecycle",
    level: "required",
    detail: "A linked licence or subscription carries a renewal/expiry date, so the lifecycle view tracks the voice spend.",
    fix: "Record a renewal/expiry date on the linked licence or subscription.",
    linterCode: "voip-no-subscription",
  },
];

export const voipCoverageRequirement = (id) => VOIP_COVERAGE_REQUIREMENTS.find((r) => r.id === id) || null;
export const requirementsOfGroup = (group) => VOIP_COVERAGE_REQUIREMENTS.filter((r) => r.group === group);

// ---- link helpers -----------------------------------------------------------
// Resolve a record-field reference by id across the set's collections (the
// record fields store a bare id, like the runbook generator's resolver).
function findAnyRecord(set, id) {
  if (isBlank(id) || !set || !set.records) return null;
  for (const t of Object.keys(set.records)) {
    if (!Array.isArray(set.records[t])) continue;
    const hit = set.records[t].find((r) => r.id === id);
    if (hit) return hit;
  }
  return null;
}

function uniqueRecords(list) {
  return [...new Map(list.filter(Boolean).map((r) => [r.id, r])).values()];
}

// Every record that satisfies a relationship requirement — via a typed link
// (respecting direction, collection and template filters) or via one of the
// voice asset's record fields.
export function voipRequirementRecords(voice, set, req) {
  if (!voice || !req || req.group !== "relationships") return [];
  const fields = assetFieldsOf(voice);
  const out = [];
  for (const rel of relationsOf(set, refOf(voice))) {
    if (!req.kinds.includes(rel.relationship.kind)) continue;
    if (req.direction && req.direction !== rel.direction) continue;
    const far = findRecord(set, rel.other);
    if (far) out.push(far);
  }
  for (const key of req.fieldKeys || []) {
    const far = findAnyRecord(set, fields[key]);
    if (far) out.push(far);
  }
  const filtered = uniqueRecords(out).filter((r) => {
    if (req.collections && !req.collections.includes(r.type)) return false;
    if (req.filterTypes && !req.filterTypes.includes(r.assetTypeId)) return false;
    return true;
  });
  return filtered;
}

// The embedded/general split of a requirement's records (used for the
// credentials requirement's hint: device credentials belong embedded).
const scopeOf = (r) => (r && r.scope === "embedded" ? "embedded" : "general");

// ---- relationship coverage --------------------------------------------------
export function voipRelationshipCoverage(voice, set) {
  const requirements = requirementsOfGroup("relationships").map((req) => {
    const records = voipRequirementRecords(voice, set, req);
    const met = records.length > 0;
    const detail = met
      ? records.length === 1
        ? records[0].name
        : records.length + " linked"
      : req.detail;
    const result = { id: req.id, label: req.label, group: req.group, level: req.level, met, count: records.length, records: records.map((r) => ({ type: r.type, id: r.id, name: r.name })), fix: req.fix, detail };
    if (req.id === "credentials" && met) {
      result.detail = records.map((r) => `${r.name} (${scopeOf(r)})`).join(", ");
    }
    return result;
  });
  return summarize(requirements);
}

// ---- lifecycle coverage -----------------------------------------------------
// Which linked records a requirement's records resolve to, as a Set of refKeys.
const refKey = (r) => r.type + ":" + r.id;

function linkedConfigurations(voice, set) {
  return voipRequirementRecords(voice, set, voipCoverageRequirement("endpoints"));
}

function linkedLicences(voice, set) {
  return voipRequirementRecords(voice, set, voipCoverageRequirement("licensing"));
}

// The asset template for a record: the injected resolver if given, else the
// shipped library (a custom template resolves to null and simply carries no
// recognised expiry field).
function typeOfRecord(record, opts) {
  if (typeof opts.typeOf === "function") return opts.typeOf(record) || null;
  return builtinAssetType(record && record.assetTypeId) || null;
}

// The datable items belonging to the deployment: the voice asset itself, its
// linked configurations and its linked licences — filtered out of the unified
// lifecycle extraction, so the new `number-port` kind and the standard
// support/licence kinds all appear here.
export function voipLifecycleItems(voice, set, opts = {}) {
  if (!voice) return [];
  const scope = new Set([refKey(voice)]);
  for (const r of [...linkedConfigurations(voice, set), ...linkedLicences(voice, set)]) scope.add(refKey(r));
  return extractLifecycleItems(set, opts).filter((it) => scope.has(refKey(it.source)));
}

export function voipLifecycleCoverage(voice, set, opts = {}) {
  const fields = assetFieldsOf(voice);
  const items = voipLifecycleItems(voice, set, opts);
  const configs = linkedConfigurations(voice, set);
  const licences = linkedLicences(voice, set);

  const portRecorded = !isBlank(fields.portDate);
  const portNotRequired = !isBlank(fields.portingStatus) && isPortComplete(fields.portingStatus);
  const numberPortMet = portRecorded || portNotRequired;

  const licenceExpiryName = (l) => {
    const field = expiryFieldOf(typeOfRecord(l, opts));
    return field && !isBlank(assetFieldsOf(l)[field.key]) ? l.name : null;
  };
  const supportSources = [
    ...configs.filter((c) => !isBlank(c.supportExpiryDate) || !isBlank(c.warrantyExpiryDate)).map((c) => c.name),
    ...licences.map(licenceExpiryName),
  ].filter(Boolean);
  const supportMet = supportSources.length > 0;

  const subscriptionSources = licences.map(licenceExpiryName).filter(Boolean);
  const subscriptionMet = subscriptionSources.length > 0;

  const requirements = requirementsOfGroup("lifecycle").map((req) => {
    let met = false;
    let detail = req.detail;
    if (req.id === "number-port") {
      met = numberPortMet;
      detail = portRecorded ? "Port date " + fields.portDate : portNotRequired ? portingStatusLabel(fields.portingStatus) : req.detail;
    } else if (req.id === "support-entitlement") {
      met = supportMet;
      detail = met ? supportSources.join(", ") : req.detail;
    } else if (req.id === "subscription-expiry") {
      met = subscriptionMet;
      detail = met ? subscriptionSources.join(", ") : req.detail;
    }
    return { id: req.id, label: req.label, group: req.group, level: req.level, met, count: met ? 1 : 0, records: [], fix: req.fix, detail };
  });
  return { ...summarize(requirements), items };
}

// ---- combined report --------------------------------------------------------
function summarize(requirements) {
  const met = requirements.filter((r) => r.met).length;
  const total = requirements.length;
  const required = requirements.filter((r) => r.level === "required");
  const requiredMet = required.filter((r) => r.met).length;
  const missing = requirements.filter((r) => !r.met).map((r) => r.id);
  return {
    requirements,
    met,
    total,
    requiredMet,
    requiredTotal: required.length,
    complete: requiredMet === required.length,
    percent: total ? Math.round((met / total) * 100) : 0,
    missing,
    missingRequired: required.filter((r) => !r.met).map((r) => r.id),
  };
}

export function voipDeploymentCoverage(voice, set, opts = {}) {
  const rel = voipRelationshipCoverage(voice, set);
  const life = voipLifecycleCoverage(voice, set, opts);
  const requirements = [...rel.requirements, ...life.requirements];
  return {
    voice: { id: voice && voice.id, name: voice && voice.name },
    groups: VOIP_COVERAGE_GROUPS.map((g) => ({ id: g.id, label: g.label, description: g.description, requirements: requirements.filter((r) => r.group === g.id) })),
    requirements,
    ...summarize(requirements),
    lifecycle: { items: life.items },
  };
}

// A one-line summary for a table cell.
export function voipCoverageLine(voice, set, opts = {}) {
  const c = voipDeploymentCoverage(voice, set, opts);
  return `${c.requiredMet}/${c.requiredTotal} required · ${c.percent}%`;
}

// ---- Linter audit -----------------------------------------------------------
// Required requirements with a linterCode that the voice platform does not yet
// satisfy. Codes are deliberately distinct from voice.js's, so a gap is
// reported once. Warnings, never errors — incomplete documentation is quality,
// not a broken graph.
export function voipCoverageIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || VOICE_PBX_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const report = voipDeploymentCoverage(r, set, opts);
    for (const req of report.requirements) {
      const def = voipCoverageRequirement(req.id);
      if (!def || req.met || def.level !== "required" || !def.linterCode) continue;
      issues.push({ level: "warning", code: def.linterCode, recordId: r.id, message: `Voice platform “${r.name}” is missing deployment coverage: ${def.label.toLowerCase()}.` });
    }
  }
  return issues;
}
