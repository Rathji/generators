// src/framework/backup.js — the backup vocabulary and structured-service audit
// (roadmap task 32).
//
// Task 32 asks IT-U to model the client's backup arrangement as a STRUCTURED
// SERVICE — the backup platform and how it is deployed, what it protects, where
// the copies land, how they are scheduled and retained, whether they are tested
// and how they recover — related to the configurations it protects, the
// applications and storage it uses, the procedures and recovery documents it
// depends on and its reference checklists.
//
// The template (./assetLibrary.js, `atype-backup-service`) carries the fields;
// the relationship catalog (./relationships.js) carries the typed links; and
// this module is the SHARED VOCABULARY both draw on, so a report or a suggestion
// can group backup services by architecture or destination without parsing free
// text. It also holds the completeness audit the Linter folds in
// (./standardized.js), so a backup service that records no architecture, no
// destination or — most importantly — no restore test is flagged rather than
// silently assumed to work.

import { relationsOf } from "./relationships.js";

// ---- architecture & deployment ---------------------------------------------
// `architecture` is WHAT is captured; `deploymentModel` is HOW the agent or
// appliance reaches the data.
export const BACKUP_ARCHITECTURES = [
  { id: "image", label: "Image / bare metal", description: "A whole-system image that can be restored to bare metal or a hypervisor." },
  { id: "file", label: "File-level", description: "Selected files and folders, restored individually." },
  { id: "application", label: "Application / item-level", description: "Discrete items inside an application — mailboxes, sites, mail items, SaaS records." },
  { id: "database", label: "Database", description: "A database-aware backup using the database's own consistency mechanism." },
  { id: "cloud-to-cloud", label: "Cloud-to-cloud", description: "One cloud service backing up another (for example Microsoft 365 to object storage)." },
  { id: "hybrid", label: "Hybrid", description: "More than one of the above combined across the estate." },
  { id: "snapshot", label: "Storage snapshot", description: "Array- or hypervisor-level snapshots rather than a separate backup pipeline." },
  { id: "continuous", label: "Continuous (CDP)", description: "Near-continuous replication with a very small recovery point." },
  { id: "other", label: "Other", description: "Any other backup architecture." },
];

export const BACKUP_ARCHITECTURE_IDS = BACKUP_ARCHITECTURES.map((a) => a.id);
export const backupArchitecture = (id) => BACKUP_ARCHITECTURES.find((a) => a.id === id) || null;
export const backupArchitectureLabel = (id) => (backupArchitecture(id) || {}).label || "";
export const architectureOptions = () => BACKUP_ARCHITECTURES.map((a) => ({ id: a.id, label: a.label }));

export const BACKUP_DEPLOYMENT_MODELS = [
  { id: "agent", label: "Agent-based", description: "Software installed on each protected system." },
  { id: "agentless", label: "Agentless", description: "The backup server reaches the systems over the network with no agent." },
  { id: "appliance", label: "Appliance", description: "A dedicated backup appliance or gateway." },
  { id: "cloud-managed", label: "Cloud-managed", description: "The vendor's service runs the schedule and stores the copies." },
  { id: "hybrid", label: "Hybrid", description: "A mix of agent, appliance and cloud components." },
];

export const BACKUP_DEPLOYMENT_IDS = BACKUP_DEPLOYMENT_MODELS.map((d) => d.id);
export const backupDeployment = (id) => BACKUP_DEPLOYMENT_MODELS.find((d) => d.id === id) || null;
export const backupDeploymentOptions = () => BACKUP_DEPLOYMENT_MODELS.map((d) => ({ id: d.id, label: d.label }));

// ---- destinations, schedules & results -------------------------------------
// Where the copies land. A healthy arrangement normally has at least one
// OFF-SITE destination (cloud, offsite vault or a replicated secondary site) —
// the audit checks for exactly that.
export const BACKUP_DESTINATIONS = [
  { id: "local-disk", label: "Local disk / appliance", offsite: false },
  { id: "nas", label: "NAS", offsite: false },
  { id: "san", label: "SAN", offsite: false },
  { id: "tape", label: "Tape", offsite: false },
  { id: "removable", label: "Removable media", offsite: false },
  { id: "cloud", label: "Cloud / object storage", offsite: true },
  { id: "offsite-vault", label: "Offsite vault", offsite: true },
  { id: "secondary-site", label: "Secondary site / replication", offsite: true },
];

export const BACKUP_DESTINATION_IDS = BACKUP_DESTINATIONS.map((d) => d.id);
export const backupDestination = (id) => BACKUP_DESTINATIONS.find((d) => d.id === id) || null;
export const destinationOptions = () => BACKUP_DESTINATIONS.map((d) => ({ id: d.id, label: d.label }));
export const isOffsiteDestination = (id) => !!(backupDestination(id) || {}).offsite;
export const OFFSITE_DESTINATION_IDS = BACKUP_DESTINATIONS.filter((d) => d.offsite).map((d) => d.id);

export const BACKUP_SCHEDULES = [
  { id: "continuous", label: "Continuous" },
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "custom", label: "Custom / mixed" },
];

export const BACKUP_SCHEDULE_IDS = BACKUP_SCHEDULES.map((s) => s.id);
export const backupSchedule = (id) => BACKUP_SCHEDULES.find((s) => s.id === id) || null;
export const scheduleOptions = () => BACKUP_SCHEDULES.map((s) => ({ id: s.id, label: s.label }));

// The outcome of the last restore TEST — the fact that makes a backup credible.
export const BACKUP_TEST_RESULTS = [
  { id: "success", label: "Success", ok: true },
  { id: "partial", label: "Partial", ok: false },
  { id: "failed", label: "Failed", ok: false },
  { id: "not-tested", label: "Not tested", ok: false },
];

export const BACKUP_TEST_RESULT_IDS = BACKUP_TEST_RESULTS.map((t) => t.id);
export const backupTestResult = (id) => BACKUP_TEST_RESULTS.find((t) => t.id === id) || null;
export const testResultOptions = () => BACKUP_TEST_RESULTS.map((t) => ({ id: t.id, label: t.label }));
export const isSuccessfulTest = (id) => !!(backupTestResult(id) || {}).ok;

// ---- structured-service audit ----------------------------------------------
export const BACKUP_SERVICE_TYPE_ID = "atype-backup-service";

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const asArray = (v) => (Array.isArray(v) ? v : isBlank(v) ? [] : String(v).split(",").map((s) => s.trim()).filter(Boolean));
const refOf = (r) => ({ type: r.type, id: r.id });

// Which of the backup service's relation groups are actually linked.
export function backupCoverage(record, set) {
  const kinds = new Set(relationsOf(set, refOf(record)).map((r) => r.relationship.kind));
  return {
    protectedConfigurations: kinds.has("backup-protected-configs"),
    applications: kinds.has("backup-application"),
    storage: kinds.has("backup-storage"),
    credentials: kinds.has("backup-password"),
    documents: kinds.has("backup-document") || kinds.has("backup-procedure") || kinds.has("backup-recovery"),
    checklists: kinds.has("backup-checklist"),
    vendor: kinds.has("backup-vendor"),
    contacts: kinds.has("contact-backup"),
  };
}

// Completeness/quality audit for the set's backup services. Warnings are for
// facts a backup arrangement should always hold; a backup that has never been
// test-restored is the headline gap. Warnings never fail the graph audit
// (./docsets.js treats only errors as failures).
export function backupIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || BACKUP_SERVICE_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = backupCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });

    if (isBlank(v.architecture)) rec("warning", "backup-no-architecture", `Backup service “${r.name}” records no backup architecture.`);
    if (isBlank(v.deploymentModel)) rec("warning", "backup-no-deployment", `Backup service “${r.name}” records no deployment model.`);
    const destinations = asArray(v.destinations);
    if (!destinations.length && !cov.storage) rec("warning", "backup-no-destination", `Backup service “${r.name}” records no backup destination.`);
    const hasOffsite = destinations.some((d) => isOffsiteDestination(d)) || v.offsite === true || cov.storage;
    if (!hasOffsite) rec("warning", "backup-no-offsite", `Backup service “${r.name}” keeps no copy off-site.`);
    if (!cov.protectedConfigurations && isBlank(v.protectedSystems)) rec("warning", "backup-no-protected-systems", `Backup service “${r.name}” names no protected systems or configurations.`);
    if (isBlank(v.lastRestoreTest)) rec("warning", "backup-untested", `Backup service “${r.name}” has no restore test recorded.`);
    else if (!isSuccessfulTest(v.lastRestoreResult)) rec("warning", "backup-test-unsuccessful", `Backup service “${r.name}”'s last restore test did not succeed.`);
    if (!cov.documents && isBlank(v.recoveryDocument)) rec("warning", "backup-no-recovery-doc", `Backup service “${r.name}” has no recovery or procedure document linked.`);
    if (!cov.credentials && isBlank(v.adminCredential)) rec("warning", "backup-no-credential", `Backup service “${r.name}” has no administrator credential recorded.`);
    if (!cov.vendor && isBlank(v.vendorRecord) && isBlank(v.provider)) rec("warning", "backup-no-vendor", `Backup service “${r.name}” records no vendor or provider.`);
  }
  return issues;
}
