// src/framework/email.js — the email vocabulary and structured-service audit
// (roadmap task 31).
//
// Task 31 asks IT-U to model the client's email infrastructure as a STRUCTURED
// SERVICE — its platform and deployment, tenant, domains, mail flow, the email
// authentication posture and archiving — related to the configurations,
// applications, documents, domains, passwords and other records it touches.
//
// The template (./assetLibrary.js, `atype-email-system`) carries the fields; the
// relationship catalog (./relationships.js) carries the typed links; and this
// module is the SHARED VOCABULARY both draw on, so a report or a suggestion can
// group email services by platform or deployment without parsing free text. It
// also holds the completeness audit the Linter folds in (./standardized.js), so
// an email service that records no platform, no mail domain or no administrator
// credential is flagged rather than silently incomplete.

import { relationsOf } from "./relationships.js";

// ---- platform & deployment -------------------------------------------------
// `deployment` is the model the platform normally implies, offered as the
// default when a record picks a platform; the record still stores its own.
export const EMAIL_PLATFORMS = [
  { id: "microsoft365", label: "Microsoft 365 (Exchange Online)", deployment: "cloud", description: "Microsoft's cloud mailbox service, administered from the Microsoft 365 admin centre." },
  { id: "exchange-hybrid", label: "Microsoft Exchange hybrid", deployment: "hybrid", description: "Mailboxes split between Exchange Online and an on-premises Exchange server, with shared routing and a connector between them." },
  { id: "exchange-onprem", label: "Microsoft Exchange on-premises", deployment: "on-premises", description: "Exchange Server running on the client's own hardware." },
  { id: "google-workspace", label: "Google Workspace (Gmail)", deployment: "cloud", description: "Google's cloud mailbox service, administered from the Google Admin console." },
  { id: "zimbra", label: "Zimbra", deployment: "on-premises", description: "Zimbra Collaboration on the client's own or hosted infrastructure." },
  { id: "mdaemon", label: "MDaemon", deployment: "on-premises", description: "MDaemon Messaging Server." },
  { id: "imap-hosted", label: "Hosted IMAP / POP", deployment: "hosted", description: "A mailbox service provided by a hosting company over IMAP/POP and SMTP." },
  { id: "other", label: "Other", deployment: "", description: "Any other mail platform." },
];

export const EMAIL_PLATFORM_IDS = EMAIL_PLATFORMS.map((p) => p.id);
export const emailPlatform = (id) => EMAIL_PLATFORMS.find((p) => p.id === id) || null;
export const emailPlatformLabel = (id) => (emailPlatform(id) || {}).label || "";
// The deployment model a platform normally implies ("" when it depends).
export const platformDeployment = (id) => (emailPlatform(id) || {}).deployment || "";
export const platformOptions = () => EMAIL_PLATFORMS.map((p) => ({ id: p.id, label: p.label }));

export const EMAIL_DEPLOYMENT_MODELS = [
  { id: "cloud", label: "Cloud / SaaS", description: "Mail is hosted and run entirely by the vendor." },
  { id: "hybrid", label: "Hybrid", description: "Mailboxes split between the cloud and on-premises servers." },
  { id: "on-premises", label: "On-premises", description: "The mail servers run on the client's own hardware." },
  { id: "hosted", label: "Hosted / managed", description: "A third party hosts the mail service for the client." },
];

export const EMAIL_DEPLOYMENT_IDS = EMAIL_DEPLOYMENT_MODELS.map((d) => d.id);
export const emailDeployment = (id) => EMAIL_DEPLOYMENT_MODELS.find((d) => d.id === id) || null;
export const deploymentOptions = () => EMAIL_DEPLOYMENT_MODELS.map((d) => ({ id: d.id, label: d.label }));

// ---- authentication posture ------------------------------------------------
// The mechanisms an email service SHOULD have configured. The first three are
// the core trio the audit checks for; the rest are stronger controls.
export const EMAIL_AUTH_MECHANISMS = [
  { id: "spf", label: "SPF", description: "Sender Policy Framework — which hosts may send for the domain." },
  { id: "dkim", label: "DKIM", description: "DomainKeys Identified Mail — a cryptographic signature on outgoing mail." },
  { id: "dmarc", label: "DMARC", description: "The policy that tells receivers what to do when SPF/DKIM fail, and where to report." },
  { id: "mta-sts", label: "MTA-STS", description: "Requires TLS and a valid certificate for inbound mail." },
  { id: "tls-rpt", label: "TLS-RPT", description: "Reporting for TLS failures in transit." },
  { id: "arc", label: "ARC", description: "Authenticated Received Chain — preserves authentication across forwarders." },
  { id: "bimi", label: "BIMI", description: "Brand Indicators for Message Identification — a verified sender logo." },
];

export const EMAIL_AUTH_MECHANISM_IDS = EMAIL_AUTH_MECHANISMS.map((m) => m.id);
// The mechanisms a healthy domain should always record.
export const EMAIL_CORE_AUTH_MECHANISMS = ["spf", "dkim", "dmarc"];
export const emailAuthMechanism = (id) => EMAIL_AUTH_MECHANISMS.find((m) => m.id === id) || null;
export const authOptions = () => EMAIL_AUTH_MECHANISMS.map((m) => ({ id: m.id, label: m.label }));

// ---- archiving & migration -------------------------------------------------
export const EMAIL_ARCHIVE_MODES = [
  { id: "none", label: "None" },
  { id: "journaling", label: "Journaling" },
  { id: "provider", label: "Provider archiving" },
  { id: "third-party", label: "Third-party archive" },
];

export const EMAIL_ARCHIVE_MODE_IDS = EMAIL_ARCHIVE_MODES.map((a) => a.id);
export const emailArchiveMode = (id) => EMAIL_ARCHIVE_MODES.find((a) => a.id === id) || null;
export const archiveOptions = () => EMAIL_ARCHIVE_MODES.map((a) => ({ id: a.id, label: a.label }));

export const EMAIL_MIGRATION_STATES = [
  { id: "not-started", label: "Not started" },
  { id: "in-progress", label: "In progress" },
  { id: "complete", label: "Complete" },
  { id: "not-applicable", label: "Not applicable" },
];

export const EMAIL_MIGRATION_STATE_IDS = EMAIL_MIGRATION_STATES.map((s) => s.id);
export const emailMigrationState = (id) => EMAIL_MIGRATION_STATES.find((s) => s.id === id) || null;
export const migrationOptions = () => EMAIL_MIGRATION_STATES.map((s) => ({ id: s.id, label: s.label }));

// ---- structured-service audit ----------------------------------------------
export const EMAIL_SYSTEM_TYPE_ID = "atype-email-system";

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");
const refOf = (r) => ({ type: r.type, id: r.id });

// Which of the email service's relation groups are actually linked.
export function emailCoverage(record, set) {
  const linkedKinds = new Set(relationsOf(set, refOf(record)).map((r) => r.relationship.kind));
  return {
    configurations: linkedKinds.has("email-configuration"),
    applications: linkedKinds.has("email-application"),
    domains: linkedKinds.has("email-domain"),
    credentials: linkedKinds.has("email-password"),
    documents: linkedKinds.has("email-document"),
    contacts: linkedKinds.has("contact-email"),
    vendor: linkedKinds.has("email-vendor"),
    security: linkedKinds.has("email-security"),
    certificates: linkedKinds.has("email-certificate"),
    licensing: linkedKinds.has("licence-application"),
  };
}

// Completeness/quality audit for the set's email services. Warnings are for
// facts the service should always hold; info flags are for links that are
// expected but may legitimately be absent early on. Warnings never fail the
// graph audit (./docsets.js treats only errors as failures).
export function emailSystemIssues(set, opts = {}) {
  const issues = [];
  if (!set || !set.records) return issues;
  const typeId = opts.typeId || EMAIL_SYSTEM_TYPE_ID;
  for (const r of set.records.flexibleAssets || []) {
    if (r.assetTypeId !== typeId) continue;
    const v = r.assetFields && typeof r.assetFields === "object" && !Array.isArray(r.assetFields) ? r.assetFields : {};
    const cov = emailCoverage(r, set);
    const rec = (level, code, message) => issues.push({ level, code, recordId: r.id, message });
    if (isBlank(v.platform)) rec("warning", "email-no-platform", `Email system “${r.name}” records no platform.`);
    if (isBlank(v.deployment)) rec("warning", "email-no-deployment", `Email system “${r.name}” records no deployment model.`);
    if (isBlank(v.primaryDomain) && !cov.domains) rec("warning", "email-no-domain", `Email system “${r.name}” records no mail domain.`);
    const auth = Array.isArray(v.authentication) ? v.authentication : [];
    const missing = EMAIL_CORE_AUTH_MECHANISMS.filter((id) => !auth.includes(id)).map((id) => (emailAuthMechanism(id) || {}).label || id);
    if (missing.length) rec("warning", "email-auth-gaps", `Email system “${r.name}” does not record ${missing.join(", ")}.`);
    if (!cov.configurations && isBlank(v.mailHostRecord)) rec("warning", "email-no-hosting", `Email system “${r.name}” is not linked to a hosting configuration.`);
    if (!cov.credentials && isBlank(v.adminCredential)) rec("warning", "email-no-credential", `Email system “${r.name}” has no administrator credential recorded.`);
    if (!cov.documents) rec("warning", "email-no-documents", `Email system “${r.name}” has no supporting documentation linked.`);
  }
  return issues;
}
