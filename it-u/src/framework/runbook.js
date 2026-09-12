// src/framework/runbook.js — deployment runbooks & the VoIP runbook generator
// (roadmap task 37).
//
// A DEPLOYMENT RUNBOOK is a standardized record that captures the full build of
// a service so a TECHNICIAN WHO DID NOT DESIGN IT can execute it. It is the
// procedural counterpart of the structured service asset: the Voice/PBX asset
// records WHAT the telephony is; the runbook records HOW to stand it up, in the
// order it must happen, with the real values already filled in.
//
// Structure & versioning mirror documents (./document.js): a runbook has a
// TYPE, a status, a version label, a markdown BODY and a review cadence, and it
// is versioned independently of the rest of the set (see ./docsets.js —
// addRunbook / saveRunbook / runbookRevisions / restoreRunbookRevision).
//
// TASK 37 is the VoIP deployment runbook. `generateVoipRunbook` reads the
// Voice/PBX asset (./voice.js), its fields and its linked records, and assembles
// a runbook covering the whole build:
//   • platform / PBX configuration          • dial plan, extensions & ring groups
//   • SIP trunk(s)                          • DID & number inventory (+ porting)
//   • emergency calling (E911) per site     • codecs & QoS
//   • firewall, SBC & NAT traversal         • failover & redundancy
//   • handsets & softphones                 • per-site network readiness
//   • cutover, verification & rollback
// Every section is always emitted; where a fact is missing it is written as a
// clearly-marked `TO COMPLETE` so the gap is visible, and returned in `warnings`
// so the generator UI can point the user at what to fill in.
//
// Later phases add more runbook types (internet/ISP provisioning, circuit
// cutover & decommission); RUNBOOK_TYPES is the shared catalog they extend.

import { relationsOf, findRecord } from "./relationships.js";
import {
  voicePlatformLabel,
  voiceDeploymentLabel,
  voiceTrunkTypeLabel,
  voiceSipTransportLabel,
  voiceCodecLabel,
  voiceServiceLabels,
  emergencyServiceLabel,
  portingStatusLabel,
  isPortComplete,
  isEmergencyConfigured,
} from "./voice.js";
import { StoreError, CODES } from "./store/errors.js";

// ---- runbook catalog -------------------------------------------------------
// `group` is the section the type is shown under; `reviewIntervalDays` is the
// default review cadence; `checklistProne` says a runbook of this type is
// normally worked through in order.
export const RUNBOOK_TYPES = [
  {
    id: "voip-deployment",
    label: "VoIP deployment",
    group: "VoIP",
    icon: "phone",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "Stand up a voice platform end to end — from the PBX and dial plan to the handsets and cutover.",
  },
  {
    id: "circuit-provisioning",
    label: "Internet/ISP circuit provisioning",
    group: "Internet",
    icon: "globe",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "Bring a resold internet/WAN circuit live — from order capture and carrier handoff to acceptance.",
  },
  {
    id: "circuit-migration",
    label: "Internet/ISP circuit migration",
    group: "Internet",
    icon: "link",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "Change or retire a resold circuit — carrier change, re-rate, renumber, hardware swap, relocation or offboarding.",
  },
  {
    id: "service-deployment",
    label: "Service deployment",
    group: "General",
    icon: "rocket",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "The ordered build of any service, system or site.",
  },
];

export const RUNBOOK_GROUPS = ["VoIP", "Internet", "General"];
export const runbookType = (id) => RUNBOOK_TYPES.find((t) => t.id === id) || null;
export const runbookTypeLabel = (id) => (runbookType(id) || {}).label || id;
export const runbookTypeOptions = () => RUNBOOK_TYPES.map((t) => ({ id: t.id, label: t.label }));
export const runbooksOfGroup = (group) => RUNBOOK_TYPES.filter((t) => t.group === group);

// The status a runbook moves through as it is prepared and executed.
export const RUNBOOK_STATUSES = [
  { id: "draft", label: "Draft", description: "Being written — not yet fit to execute." },
  { id: "ready", label: "Ready", description: "Reviewed and ready to be used on site." },
  { id: "in-progress", label: "In progress", description: "Being executed right now." },
  { id: "complete", label: "Complete", description: "Executed and signed off." },
  { id: "superseded", label: "Superseded", description: "Replaced by a newer runbook." },
];

export const RUNBOOK_STATUS_IDS = RUNBOOK_STATUSES.map((s) => s.id);
export const runbookStatus = (id) => RUNBOOK_STATUSES.find((s) => s.id === id) || null;
export const runbookStatusLabel = (id) => (runbookStatus(id) || {}).label || "";
export const runbookStatusOptions = () => RUNBOOK_STATUSES.map((s) => ({ id: s.id, label: s.label }));

// ---- field schema ----------------------------------------------------------
export const RUNBOOK_FIELDS = [
  { key: "runbookType", label: "Runbook type", type: "select", options: RUNBOOK_TYPES, required: true, default: "service-deployment" },
  { key: "status", label: "Status", type: "select", options: RUNBOOK_STATUSES, required: true, default: "draft" },
  { key: "version", label: "Version", type: "text", placeholder: "e.g. 1.0" },
  { key: "summary", label: "Summary", type: "text", placeholder: "One line saying what this runbook deploys" },
  { key: "service", label: "Service / asset", type: "record", of: "flexibleAssets", help: "The asset this runbook deploys." },
  { key: "site", label: "Site", type: "record", of: "locations", help: "The site or location the deployment is performed at." },
  { key: "body", label: "Runbook body", type: "textarea", placeholder: "# Runbook\n\nWrite the build as ordered, executable steps in markdown." },
  { key: "tags", label: "Tags", type: "tags", placeholder: "comma, separated, words" },
  { key: "reviewIntervalDays", label: "Review every (days)", type: "number", placeholder: "365" },
  { key: "reviewedAt", label: "Last reviewed", type: "date" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const asArray = (v) => (Array.isArray(v) ? v : isBlank(v) ? [] : String(v).split(",").map((s) => s.trim()).filter(Boolean));

// ---- validation ------------------------------------------------------------
export function validateRunbook(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A runbook must be an object."] };
  const type = runbookType(record.runbookType);
  if (!type) {
    errors.push(`A runbook must declare a runbook type (${RUNBOOK_TYPES.map((t) => t.id).join(", ")}).`);
  }
  if (isBlank(record.body)) {
    errors.push("A runbook needs a body — the steps a technician follows.");
  }
  if (record.status != null && !isBlank(record.status) && !runbookStatus(record.status)) {
    errors.push(`Unknown runbook status “${record.status}” (${RUNBOOK_STATUS_IDS.join(", ")}).`);
  }
  if (!isBlank(record.reviewIntervalDays) && !(Number(record.reviewIntervalDays) > 0)) {
    errors.push("The review interval must be a positive number of days.");
  }
  if (record.tags != null && !Array.isArray(record.tags) && typeof record.tags !== "string") {
    errors.push("Tags must be a list or a comma-separated string.");
  }
  return { ok: errors.length === 0, errors };
}

export function requireRunbook(record) {
  const { ok, errors } = validateRunbook(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this runbook";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// ---- revisions (mirrors document.js) ---------------------------------------
export const RUNBOOK_HISTORY_MAX = 25;

export const runbookRevision = (record) => Number(record && record.revision) || 1;

export function normalizeRunbookTags(tags) {
  if (Array.isArray(tags)) return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
  if (typeof tags === "string") return normalizeRunbookTags(tags.split(","));
  return [];
}

const refOf = (r) => (r && r.type && r.id ? { type: r.type, id: r.id } : null);

export function makeRunbookRevision(record, { by = "system", now = Date.now() } = {}) {
  return {
    revision: runbookRevision(record),
    savedAt: now,
    savedBy: by,
    runbookType: (record && record.runbookType) || "",
    status: (record && record.status) || "draft",
    version: (record && record.version) || "",
    summary: (record && record.summary) || "",
    body: (record && record.body) || "",
    service: refOf(record && record.service),
    site: refOf(record && record.site),
    tags: normalizeRunbookTags(record && record.tags),
    reviewIntervalDays: record && record.reviewIntervalDays != null ? record.reviewIntervalDays : null,
    reviewedAt: (record && record.reviewedAt) || "",
  };
}

// Every version of a runbook, oldest first, the current one flagged.
export function runbookVersionList(record) {
  if (!record) return [];
  const history = Array.isArray(record.revisions) ? record.revisions : [];
  return [
    ...history.map((h) => ({ ...h, current: false })),
    { ...makeRunbookRevision(record, { by: record.updatedBy || "system", now: record.updatedAt || Date.now() }), current: true },
  ];
}

// ---- review status (mirrors documents) -------------------------------------
export function runbookReviewStatus(record, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const dueSoonDays = opts.dueSoonDays != null ? opts.dueSoonDays : 30;
  const type = runbookType(record && record.runbookType);
  const interval = Number(record && record.reviewIntervalDays) || (type && type.reviewIntervalDays) || 0;
  const reviewedAt = (record && record.reviewedAt) || "";
  if (!interval) return { state: "none", intervalDays: 0, reviewedAt, dueAt: null, daysUntil: null, label: "No review schedule" };
  const reviewed = reviewedAt ? new Date(reviewedAt).getTime() : null;
  if (!reviewed || Number.isNaN(reviewed)) return { state: "due", intervalDays: interval, reviewedAt, dueAt: null, daysUntil: null, label: "Never reviewed — due now" };
  const due = reviewed + interval * 86400000;
  const daysUntil = Math.ceil((due - now) / 86400000);
  const state = daysUntil < 0 ? "overdue" : daysUntil <= dueSoonDays ? "due-soon" : "ok";
  const label =
    state === "overdue"
      ? `Review overdue by ${-daysUntil} day${-daysUntil === 1 ? "" : "s"}`
      : state === "due-soon"
        ? `Review due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
        : `Reviewed — next review in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  return { state, intervalDays: interval, reviewedAt, dueAt: new Date(due).toISOString().slice(0, 10), daysUntil, label };
}

// ---- detail line -----------------------------------------------------------
const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

export function runbookDetailLine(record, set) {
  if (!record) return "";
  const type = runbookType(record.runbookType);
  const review = runbookReviewStatus(record);
  const bits = [type ? type.label : "Runbook", "v" + runbookRevision(record)];
  const status = runbookStatus(record.status);
  if (status) bits.push(status.label);
  const words = wordCount(record.body);
  if (words) bits.push(words + " word" + (words === 1 ? "" : "s"));
  bits.push(review.state === "none" ? "No review" : review.label);
  return bits.join(" · ");
}

// ---- VoIP runbook structure ------------------------------------------------
// Each section is emitted by the generator with `## <heading>`. The audit below
// reads the body back for those headings, so a runbook whose body was edited to
// drop a section is flagged. `required` sections are the task-37 obligations.
export const VOIP_RUNBOOK_SECTIONS = [
  { id: "overview", heading: "Overview & scope", required: false },
  { id: "prerequisites", heading: "Prerequisites & access", required: false },
  { id: "platform", heading: "Platform & PBX configuration", required: true },
  { id: "dial-plan", heading: "Dial plan, extensions & ring groups", required: true },
  { id: "trunk", heading: "SIP trunk(s)", required: true },
  { id: "numbers", heading: "DID & number inventory", required: true },
  { id: "emergency", heading: "Emergency calling (E911)", required: true },
  { id: "codecs-qos", heading: "Codecs & QoS", required: true },
  { id: "firewall-nat", heading: "Firewall, SBC & NAT traversal", required: true },
  { id: "failover", heading: "Failover & redundancy", required: true },
  { id: "endpoints", heading: "Handsets & softphones", required: true },
  { id: "network-readiness", heading: "Per-site network readiness", required: true },
  { id: "cutover", heading: "Cutover steps", required: true },
  { id: "verification", heading: "Verification & acceptance", required: true },
  { id: "rollback", heading: "Rollback", required: true },
  { id: "signoff", heading: "Roles, contacts & sign-off", required: false },
];

export const voipRunbookSection = (id) => VOIP_RUNBOOK_SECTIONS.find((s) => s.id === id) || null;

// Which required sections a VoIP runbook's body actually contains.
export function voipRunbookCoverage(record) {
  const body = String((record && record.body) || "");
  const heads = new Set(
    body
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((l) => l.match(/^##\s+(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => m[1].trim().toLowerCase()),
  );
  const out = {};
  for (const s of VOIP_RUNBOOK_SECTIONS) out[s.id] = heads.has(s.heading.toLowerCase());
  return out;
}

// ---- VoIP runbook audit ----------------------------------------------------
// Flags a VoIP runbook that is missing one of the task-37 required sections, or
// that is not linked to the voice platform it deploys. General runbook checks
// (missing body, overdue review, unknown type) live in runbookIssues below.
export function voipRunbookIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.runbooks || []) {
    if (r.runbookType !== "voip-deployment") continue;
    if (isBlank(r.body)) continue; // runbookIssues reports the missing body
    const cov = voipRunbookCoverage(r);
    for (const s of VOIP_RUNBOOK_SECTIONS) {
      if (!s.required || cov[s.id]) continue;
      issues.push({
        level: "warning",
        code: "runbook-missing-" + s.id,
        recordId: r.id,
        message: `VoIP runbook “${r.name}” is missing the “${s.heading}” section.`,
      });
    }
    const linked = relationsOf(set, refOf(r)).some((x) => ["runbook-service", "asset-reference"].includes(x.relationship.kind));
    const hasService = !!refOf(r.service) || linked;
    if (!hasService) {
      issues.push({ level: "warning", code: "runbook-no-service", recordId: r.id, message: `VoIP runbook “${r.name}” is not linked to the voice platform it deploys.` });
    }
  }
  return issues;
}

// The general runbook audit the Linter folds in. A runbook with no body or an
// unknown type is an error; a stale review is a warning.
export function runbookIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.runbooks || []) {
    const type = runbookType(r.runbookType);
    if (!type) {
      issues.push({ level: "error", code: "unknown-runbook-type", recordId: r.id, message: `Runbook “${r.name}” has an unknown runbook type “${r.runbookType}”.` });
      continue;
    }
    if (isBlank(r.body)) {
      issues.push({ level: "error", code: "runbook-missing-body", recordId: r.id, message: `Runbook “${r.name}” has no body — the steps themselves are required.` });
    }
    const review = runbookReviewStatus(r);
    if (review.state === "overdue") {
      issues.push({ level: "warning", code: "runbook-review-overdue", recordId: r.id, message: `Runbook “${r.name}” is ${review.label.toLowerCase()}.` });
    }
  }
  return [...issues, ...voipRunbookIssues(set, opts)];
}

// ---- the VoIP deployment generator -----------------------------------------
// Resolve a record id (as stored in a `record` field) across the set's
// collections, or null.
function findAnyRecord(set, id) {
  if (!id || !set || !set.records) return null;
  for (const t of Object.keys(set.records)) {
    if (!Array.isArray(set.records[t])) continue;
    const hit = set.records[t].find((r) => r.id === id);
    if (hit) return hit;
  }
  return null;
}

// Far-side records of the voice platform, keyed by the relationship kinds we
// care about, plus the record-field references. Everything is name-resolved so
// the runbook can name the exact devices, circuits and people.
function voipSources(set, voice) {
  const fields = (voice && voice.assetFields && typeof voice.assetFields === "object" && !Array.isArray(voice.assetFields)) ? voice.assetFields : {};
  const byKind = {};
  for (const rel of relationsOf(set, refOf(voice))) {
    const far = findRecord(set, rel.other);
    if (!far) continue;
    (byKind[rel.relationship.kind] = byKind[rel.relationship.kind] || []).push(far);
  }
  const fieldRef = (key) => findAnyRecord(set, fields[key]);
  const unique = (arr) => [...new Map((arr || []).filter(Boolean).map((r) => [r.id, r])).values()];
  return {
    fields,
    circuits: unique([...((byKind["voice-circuit"] || [])), fieldRef("circuit")]),
    pbxHosts: unique([...(byKind["voice-configuration"] || []), fieldRef("pbxHostRecord")]),
    sbcs: unique([...(byKind["voice-sbc"] || []), fieldRef("sbcRecord")]),
    security: unique([...(byKind["voice-security"] || []), fieldRef("securityRecord")]),
    applications: unique([...(byKind["voice-application"] || []), fieldRef("voiceApplication")]),
    vendors: unique([...(byKind["voice-vendor"] || []), fieldRef("vendorRecord")]),
    credentials: unique([...(byKind["voice-password"] || []), fieldRef("adminCredential")]),
    licences: unique(byKind["licence-application"] || []),
    documents: unique([...(byKind["voice-document"] || []), fieldRef("document")]),
    checklists: unique([...(byKind["voice-checklist"] || []), fieldRef("deploymentChecklist")]),
    contacts: unique(byKind["contact-voice"] || []),
  };
}

const names = (arr) => (arr || []).map((r) => r.name);

// The concrete facts a section needs, as `label: value` pairs, with a
// TO COMPLETE note where the voice asset records nothing.
function factLines(pairs) {
  return pairs.map(([label, value]) => {
    if (isBlank(value)) return `- **${label}:** _[TO COMPLETE: record the ${label.toLowerCase()}]_`;
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    return `- **${label}:** ${text}`;
  });
}

// Build the runbook body. `warnings` collects the gaps the UI should surface.
export function generateVoipRunbook({ voice, set, site, preparedBy, title, now = Date.now() } = {}) {
  if (!voice || voice.type !== "flexibleAssets") {
    throw new StoreError(CODES.INVALID_DATA, "A VoIP deployment runbook needs a Voice/PBX asset to generate from.");
  }
  const v = voipSources(set, voice);
  const f = v.fields;
  const warnings = [];
  const warn = (code, message) => warnings.push({ code, message });
  const L = [];
  const push = (...lines) => L.push(...lines);
  const section = (heading) => push("", "## " + heading, "");
  const stepList = (steps) => steps.forEach((s, i) => L.push(`${i + 1}. ${s}`));

  const platformName = voicePlatformLabel(f.platformType) || "the voice platform";
  const deployment = voiceDeploymentLabel(f.deploymentModel);
  const services = voiceServiceLabels(f.services);
  const codecLabels = asArray(f.codecs).map((id) => voiceCodecLabel(id) || id);
  const siteLabel = site && (site.name || site.label) ? (site.name || site.label) : "";
  const generatedOn = new Date(now).toISOString().slice(0, 10);

  if (isBlank(f.platformType)) warn("missing-platform", "The voice asset records no platform type.");
  if (isBlank(f.deploymentModel)) warn("missing-deployment", "The voice asset records no deployment model.");
  if (!v.circuits.length && isBlank(f.circuit)) warn("missing-circuit", "No internet/WAN circuit is recorded or linked for the voice service.");
  if (isBlank(f.numberInventory)) warn("missing-numbers", "The voice asset records no number inventory.");
  if (!isEmergencyConfigured(f.emergencyService) && f.e911 !== true) warn("missing-emergency", "No emergency-calling configuration is recorded.");
  if (!v.sbcs.length && isBlank(f.sbcRecord)) warn("missing-sbc", "No SBC or firewall is recorded or linked.");
  if (!v.credentials.length && isBlank(f.adminCredential)) warn("missing-credential", "No administrator credential is recorded or linked.");
  if (isBlank(f.failoverNotes)) warn("missing-failover", "No failover or redundancy notes are recorded.");
  if (isBlank(f.qualityNotes)) warn("missing-qos", "No QoS or call-quality notes are recorded.");
  if (!v.contacts.length) warn("missing-contact", "No responsible contact is linked.");

  push(`# VoIP deployment runbook — ${voice.name}`, "");
  push(`Deployment of **${voice.name}** (${platformName}${deployment ? ", " + deployment.toLowerCase() : ""})${siteLabel ? " at **" + siteLabel + "**" : ""}.`, "");
  push(`_Generated from the Voice/PBX asset “${voice.name}” on ${generatedOn}${preparedBy ? " by " + preparedBy : ""}. Written so a technician who did not design the deployment can execute it: every step uses the recorded values, and every gap is marked TO COMPLETE._`);

  // ---- overview ----
  section("Overview & scope");
  push("This runbook covers the full build of the voice service: the platform and PBX configuration, the dial plan, the SIP trunk(s), the number inventory and porting, emergency calling, codecs and QoS, the firewall/SBC path, failover, the handsets, and the per-site network readiness checks — followed by cutover, verification and rollback.", "");
  push(...factLines([
    ["Service asset", voice.name],
    ["Platform", platformName],
    ["Product / version", f.product],
    ["Deployment model", deployment],
    ["Voice service provider", f.provider],
    ["Tenant / account", f.tenant],
    ["Site", siteLabel],
    ["Services delivered", services],
  ]));
  if (services.length) push("", `The client uses: ${services.join(", ")}.`);

  // ---- prerequisites ----
  section("Prerequisites & access");
  push("Confirm every prerequisite before touching the live service. Do not begin the cutover until all of these are ticked.", "");
  stepList([
    `Administrator access to the ${platformName} management console.`,
    "Administrator access to the SBC/firewall and the switching/routing equipment at the site.",
    `The internet/WAN circuit is installed, activated and passing traffic${v.circuits.length ? " (" + names(v.circuits).join(", ") + ")" : ""}.`,
    "The number port has been submitted with the carrier and its planned date confirmed (see the number inventory below).",
    "A maintenance window and a rollback decision point are agreed with the client.",
    "The old service remains available until the new one is verified.",
  ]);
  push("", "**Credentials & access records**", "");
  push(...(v.credentials.length ? v.credentials.map((c) => `- ${c.name}`) : ["- _[TO COMPLETE: add the platform's administrator credential to the set and link it here]_"]));
  if (v.vendors.length) push("", `**Vendor / carrier:** ${names(v.vendors).join(", ")}${f.supportUrl ? " — support portal: " + f.supportUrl : ""}`);

  // ---- platform / PBX ----
  section("Platform & PBX configuration");
  push(...factLines([
    ["Platform", platformName],
    ["Product / version", f.product],
    ["Deployment model", deployment],
    ["Provider", f.provider],
    ["Tenant / account reference", f.tenant],
    ["Admin portal", f.adminUrl],
    ["Extensions", f.extensionCount],
    ["Handsets / endpoints", f.handsetCount],
    ["Simultaneous calls (channels)", f.simultaneousCalls],
  ]));
  push("");
  if (v.pbxHosts.length) push("**PBX / host configuration:** " + names(v.pbxHosts).join(", "), "");
  stepList([
    `Sign in to the ${platformName} management console at the admin portal above.`,
    "Confirm the tenant/account and the licence level (see licensing below) match what the client purchased.",
    `Record the platform's software/firmware version before changing anything${isBlank(f.product) ? " and note it here" : " (recorded as " + f.product + ")"}.`,
    "Create or confirm the site and its time zone, so voicemail, schedules and call detail times are correct.",
    v.pbxHosts.length
      ? `Confirm the PBX/host (${names(v.pbxHosts).join(", ")}) is reachable, licensed and has a validated configuration backup.`
      : "_[TO COMPLETE: record and link the server or appliance running the PBX.]_",
    "Apply the standard provider configuration, then re-verify before moving on.",
  ]);

  // ---- dial plan ----
  section("Dial plan, extensions & ring groups");
  push("The dial plan is what every other step depends on — build and test it before the trunks and numbers go live.", "");
  push(...factLines([
    ["Extensions planned", f.extensionCount],
    ["Services relying on the dial plan", services.filter((s) => /extension|ring|hunt|queue|attendant|ivr|park|pickup|presence/i.test(s))],
  ]));
  push("");
  stepList([
    "Agree the extension range and reserve blocks for each department, plus a separate range for shared/role endpoints.",
    "Create the auto attendant / IVR and record its greeting, menus and time-of-day routing.",
    `Build the ring/hunt groups and call queues the client needs${services.length ? " — the delivered services list includes " + services.filter((s) => /ring|hunt|queue/i.test(s)).join(", ") || "none recorded" : ""}.`,
    "Set the outbound dial-plan rules, including any prefixes, barred numbers and international permissions.",
    "Set call-park/pickup, transfer and voicemail behaviour, then document the extension list below (or in a linked document).",
  ]);
  if (v.documents.length) push("", `**Reference documents:** ${names(v.documents).join(", ")}`);
  push("", "| Extension | Name / role | Type | Notes |", "| --- | --- | --- | --- |", "| _[TO COMPLETE]_ | | | |");

  // ---- trunk ----
  section("SIP trunk(s)");
  push(...factLines([
    ["Trunk type", voiceTrunkTypeLabel(f.trunkType)],
    ["SIP domain / registrar", f.sipDomain],
    ["SIP transport / security", voiceSipTransportLabel(f.sipTransport)],
    ["Provider", f.provider],
    ["Simultaneous calls (channels)", f.simultaneousCalls],
    ["Internet / WAN circuit(s)", names(v.circuits)],
  ]));
  push("");
  stepList([
    `Create the trunk on the ${platformName} platform using the carrier's provisioning details, then confirm it registers (or authenticates by IP) and shows as up.`,
    "Confirm the number of simultaneous channels matches the client's needs and the carrier's order.",
    `Set the SIP transport and media encryption to match the agreed standard${isBlank(f.sipTransport) ? " (decide and record SIP over TLS where the carrier supports it)" : " (recorded as " + voiceSipTransportLabel(f.sipTransport) + ")"}.`,
    "Restrict the trunk to the expected source IPs/credentials and apply fail2ban or equivalent protection against registration attacks.",
    "Place an outbound test call and confirm the carrier sees the expected calling number; place an inbound test call to each trunk.",
    "Record the trunk and its circuit as relationships on the voice asset so the dependency is documented.",
  ]);

  // ---- numbers ----
  section("DID & number inventory");
  push(...factLines([
    ["Porting status", portingStatusLabel(f.portingStatus)],
    ["Port date", f.portDate],
  ]));
  push("", "**Number inventory:**", "");
  if (isBlank(f.numberInventory)) {
    push("_[TO COMPLETE: record the DIDs, main, toll-free and fax numbers and the extensions in use.]_", "");
  } else {
    for (const line of String(f.numberInventory).replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean)) {
      push("- " + line);
    }
    push("");
  }
  if (!isPortComplete(f.portingStatus) && !isBlank(f.portingStatus)) {
    push(`> **Porting is not complete (${portingStatusLabel(f.portingStatus)}).** Do not cancel the old service until every number is confirmed ported and tested.`, "");
  }
  stepList([
    "Reconcile the recorded number inventory against the carrier's order and the client's bills; every number must be accounted for.",
    "Confirm each number's routing (auto attendant, ring group, extension or fax) and record it.",
    "For each number being ported, confirm the port request, the losing carrier's approval and the port date.",
    "On port day, test inbound call completion to every ported number before any other change.",
    "Update the number inventory above and the voice asset after the port completes.",
  ]);

  // ---- emergency ----
  section("Emergency calling (E911)");
  push(...factLines([
    ["Emergency service", emergencyServiceLabel(f.emergencyService)],
    ["Dispatchable location / address", f.emergencyAddress],
    ["Site", siteLabel],
  ]));
  push("");
  stepList([
    `Register the dispatchable address for each site with the ${platformName} emergency service.`,
    "Assign the correct emergency location to every user, handset and softphone — including remote/home workers, whose addresses must be captured separately.",
    "Confirm the emergency callback number is set and reaches a monitored extension.",
    "Place an actual emergency test call (notify the monitoring centre first) and confirm the correct address and callback arrive.",
    "Re-test after any move, add or change of a user or site.",
  ]);
  if (!isEmergencyConfigured(f.emergencyService) && f.e911 !== true) {
    push("", "> **TO COMPLETE: no emergency-calling configuration is recorded. E911 must be configured and tested before go-live.**");
  }

  // ---- codecs & QoS ----
  section("Codecs & QoS");
  push(...factLines([
    ["Codecs (preference order)", codecLabels],
    ["QoS / call-quality notes", f.qualityNotes],
  ]));
  push("");
  stepList([
    `Set the codec preference order on the platform and the endpoints${codecLabels.length ? " (recorded as " + codecLabels.join(" → ") + ")" : " — use a narrowband baseline for reliability and a wideband codec where bandwidth allows"}.`,
    "Mark voice traffic with DSCP EF (46) for RTP and CS3 (24) for SIP, and preserve the marking end to end.",
    "Place voice on its own VLAN and give RTP a guaranteed share of the link (see network readiness below).",
    "Calculate the bandwidth per concurrent call (about 87 kbps for G.711 with overhead; less with a compressed codec) and confirm the link and the carrier channel count cover peak load.",
    "Measure one-way latency (< 150 ms), jitter (< 30 ms) and packet loss (< 1%) on a test call at peak time.",
  ]);

  // ---- firewall / SBC ----
  section("Firewall, SBC & NAT traversal");
  push(...factLines([
    ["SBC / firewall", names(v.sbcs)],
    ["SIP transport / security", voiceSipTransportLabel(f.sipTransport)],
    ["Security platform", names(v.security)],
  ]));
  push("");
  stepList([
    `Open only the required ports to the carrier's signalling and media ranges (typically SIP 5060/5061 and the RTP UDP range) and restrict them to the carrier's addresses.`,
    "Configure the firewall to keep SIP/RTP sessions open for the duration of a call (SIP ALG should normally be disabled in favour of an SBC).",
    `If the platform sits behind NAT, enable a session border controller or the platform's NAT traversal so signalling and media addresses are rewritten correctly${v.sbcs.length ? " (" + names(v.sbcs).join(", ") + ")" : ""}.`,
    "Confirm remote/softphone endpoints register through the SBC and that media is not hairpinning through the site unnecessarily.",
    "Test inbound, outbound and internal calls through the firewall, and confirm the security platform raises no false positives on voice traffic.",
  ]);

  // ---- failover ----
  section("Failover & redundancy");
  push(...factLines([
    ["Recorded failover notes", f.failoverNotes],
    ["Internet / WAN circuit(s)", names(v.circuits)],
    ["Simultaneous channels", f.simultaneousCalls],
  ]));
  push("");
  stepList([
    "Identify every single point of failure: the circuit, the firewall/SBC, the PBX host and the carrier trunk.",
    "Where a second circuit exists, confirm it is configured for automatic failover and that the voice service survives the switch.",
    "Configure the trunk to fail over to a secondary route or the carrier's alternate PoP if the primary is unavailable.",
    "Confirm the platform's own redundancy (hosted SLA, or a standby PBX for on-premises) and record its recovery expectations.",
    "Test the failover path deliberately during the maintenance window and record how long service was interrupted.",
  ]);
  if (isBlank(f.failoverNotes)) push("", "> **TO COMPLETE: no failover or redundancy design is recorded. Do not assume the platform fails over gracefully — test it.**");

  // ---- endpoints ----
  section("Handsets & softphones");
  push(...factLines([
    ["Handsets / endpoints", f.handsetCount],
    ["Services delivered", services.filter((s) => /softphone|mobile|presence/i.test(s))],
  ]));
  push("");
  stepList([
    "Record each handset's make, model, MAC address and assigned extension as a configuration, and link it to the voice asset.",
    "Provision the handsets (auto-provisioning where available) and confirm they register with the correct extension and location.",
    "Configure the softphone/mobile app users, including their emergency location (remote workers especially).",
    "Set the correct time zone, dial tone and locale on every endpoint and verify the directory is populated.",
    "Confirm shared/role endpoints (reception, meeting rooms) behave as designed and that voicemail and call forwarding work from each device.",
  ]);

  // ---- network readiness ----
  section("Per-site network readiness");
  push("Complete these checks at the site before cutover. Record the measured values, not the expected ones.", "");
  push("| Check | Target | Measured | Pass |", "| --- | --- | --- | --- |",
    "| Voice VLAN configured and tagged on the switch uplinks | VLAN present, RTP prioritised | | |",
    "| PoE on every handset port | Per handset datasheet (class 2–4) | | |",
    "| Available bandwidth for concurrent calls | ≥ channels × 100 kbps + data headroom | | |",
    "| One-way latency | < 150 ms | | |",
    "| Jitter | < 30 ms | | |",
    "| Packet loss | < 1% | | |",
    "| DHCP option 66/160 (provisioning) | Handsets reach the provisioning server | | |",
    "| DNS resolution for the SIP registrar | Resolves from the voice VLAN | | |");
  push("");
  stepList([
    "Confirm the voice VLAN exists, is trunked to every switch a handset hangs off, and is separate from data.",
    "Confirm PoE is available on every port a handset will use; verify the switch's power budget covers all handsets.",
    "Confirm DHCP scopes cover the handsets and offer the provisioning option, and that the SIP registrar resolves from the voice VLAN.",
    "Run a sustained bandwidth test at peak hours and confirm voice remains within the latency/jitter/loss targets above.",
    "Correct any failing check before proceeding — a network problem will look like a platform problem once calls go live.",
  ]);

  // ---- cutover ----
  section("Cutover steps");
  push("Execute in order. Each step is a clear checkpoint: do not continue until the step before it has passed.", "");
  stepList([
    "Confirm the prerequisites are met and the completed runbook has been reviewed by the client contact.",
    "Take a final backup/export of the old voice configuration and the current number routing.",
    "Build and test the dial plan, trunk and endpoints on the new platform (calls between internal extensions should work).",
    "At the maintenance window, port the numbers (or swing the routing) to the new platform.",
    "Test inbound and outbound calls on every number, including emergency calling.",
    "Migrate the handsets to the new platform and confirm each registers and can call internally and externally.",
    "Update DNS/SRV records and any firewall rules that referenced the old platform.",
    "Run the verification below, then hand over and record the outcome.",
  ]);

  // ---- verification ----
  section("Verification & acceptance");
  push("Verify each item and record who signed it off.", "");
  push("| # | Verification | Result |", "| --- | --- | --- |",
    "| 1 | Every ported number receives inbound calls | |",
    "| 2 | Outbound calls present the correct calling number | |",
    "| 3 | Internal extension-to-extension calls work | |",
    "| 4 | Voicemail records and delivers to the right mailbox | |",
    "| 5 | Ring groups, queues and the auto attendant behave as designed | |",
    "| 6 | Emergency call reaches the right address and callback | |",
    "| 7 | Call recording (where licensed) records and retains correctly | |",
    "| 8 | Failover path tested | |",
    "| 9 | Call quality within latency/jitter/loss targets | |",
    "| 10 | Monitoring/alerts configured for trunk and platform availability | |");

  // ---- rollback ----
  section("Rollback");
  push("If the cutover fails and cannot be corrected within the maintenance window, roll back rather than improvise.", "");
  stepList([
    "Re-point the numbers (or the routing) back to the old platform.",
    "Re-register the original handsets/provisioning and confirm service is restored.",
    "Restore any DNS, firewall or routing changes that were made for the cutover.",
    "Confirm inbound, outbound and emergency calling are working on the old service.",
    "Record what failed and the point of no return, so the next attempt can avoid it.",
  ]);

  // ---- sign-off ----
  section("Roles, contacts & sign-off");
  push("**Responsible contacts**", "");
  push(...(v.contacts.length ? v.contacts.map((c) => `- ${c.name}`) : ["- _[TO COMPLETE: link the people responsible for the voice platform.]_"]));
  push("", "| Role | Name | Contact |", "| --- | --- | --- |",
    "| Deployment lead | | |",
    "| Carrier / provider | | |",
    "| Client approver | | |", "");
  push(`_Runbook generated for “${voice.name}” on ${generatedOn}. Review and re-verify before every subsequent deployment._`);

  const body = L.join("\n");
  const summary = `${platformName} deployment for ${voice.name}` + (siteLabel ? ` at ${siteLabel}` : "") + ".";
  const name = title && !isBlank(title) ? title : `VoIP deployment — ${voice.name}` + (siteLabel ? ` (${siteLabel})` : "");

  return {
    name,
    summary,
    body,
    runbookType: "voip-deployment",
    service: refOf(voice),
    site: site && (site.id) ? refOf(site) : null,
    sections: VOIP_RUNBOOK_SECTIONS.map((s) => ({ id: s.id, heading: s.heading, required: s.required })),
    warnings,
    generatedAt: now,
  };
}
