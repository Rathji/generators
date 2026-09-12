// src/framework/contact.js — contacts & responsibility mapping (roadmap Phase 2,
// task 8).
//
// A contact is a person the documentation set cares about: someone at the
// client (primary / technical / billing / after-hours), an application owner, a
// site manager, a security officer, a vendor representative or support contact,
// an ISP/carrier contact, or the provider's own support desk.
//
// What makes a contact useful is RESPONSIBILITY MAPPING: each role declares the
// areas it is responsible for, and the contact is then linked to the records it
// is responsible for (an application, a configuration, a site, a licence, a
// security system, a vendor, a whole organization) through the typed
// `contact-*` relationship kinds in relationships.js. Nothing about "who owns
// this?" is re-typed into the owned record — it is one link, visible from both
// ends.
//
// This module is the single source of truth for the contact-role catalog and
// the contact field schema; ./standardized.js folds it into the combined
// registry.

export const CONTACT_ROLES = [
  {
    id: "client-primary",
    label: "Client primary contact",
    group: "Client",
    responsibility: ["General", "Escalation"],
    description: "The main day-to-day point of contact at the client.",
  },
  {
    id: "client-technical",
    label: "Client technical contact",
    group: "Client",
    responsibility: ["General", "Technical"],
    description: "The client's technical decision-maker or IT liaison.",
  },
  {
    id: "client-billing",
    label: "Client billing contact",
    group: "Client",
    responsibility: ["Billing"],
    description: "Receives invoices and handles accounts-payable questions.",
  },
  {
    id: "client-afterhours",
    label: "After-hours contact",
    group: "Client",
    responsibility: ["Escalation"],
    description: "Reachable outside business hours for urgent incidents.",
  },
  {
    id: "application-owner",
    label: "Application owner",
    group: "Responsibility",
    responsibility: ["Applications"],
    description: "Owns one or more business applications and their support arrangements.",
  },
  {
    id: "site-manager",
    label: "Site manager",
    group: "Responsibility",
    responsibility: ["Sites", "Access"],
    description: "Responsible for a physical site, its access and its facilities.",
  },
  {
    id: "security-officer",
    label: "Security officer",
    group: "Responsibility",
    responsibility: ["Security systems"],
    description: "Responsible for security systems (alarms, cameras, access control).",
  },
  {
    id: "vendor-rep",
    label: "Vendor representative",
    group: "Vendor",
    responsibility: ["Vendors"],
    description: "A named representative at a technology supplier or service provider.",
  },
  {
    id: "vendor-support",
    label: "Vendor support",
    group: "Vendor",
    responsibility: ["Vendors", "Escalation"],
    description: "A vendor's support/helpdesk contact — the number you escalate through.",
  },
  {
    id: "isp-carrier",
    label: "ISP / carrier contact",
    group: "Vendor",
    responsibility: ["Circuits", "Internet"],
    description: "The internet/telephony carrier contact for a circuit or service.",
  },
  {
    id: "support-desk",
    label: "Support desk",
    group: "Provider",
    responsibility: ["General", "Support"],
    description: "The provider's own support desk or service desk.",
  },
  {
    id: "escalation",
    label: "Escalation contact",
    group: "Provider",
    responsibility: ["Escalation"],
    description: "Where an incident escalates when front-line support cannot resolve it.",
  },
  { id: "other", label: "Other", group: "Other", responsibility: [], description: "A contact that does not fit a standard role." },
];

export const CONTACT_ROLE_LABELS = Object.fromEntries(CONTACT_ROLES.map((r) => [r.id, r.label]));
export const contactRole = (id) => CONTACT_ROLES.find((r) => r.id === id) || null;
export const contactRoleLabel = (id) => CONTACT_ROLE_LABELS[id] || null;

export const CONTACT_METHODS = [
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "mobile", label: "Mobile" },
  { id: "sms", label: "SMS" },
  { id: "other", label: "Other" },
];
export const contactMethod = (id) => CONTACT_METHODS.find((m) => m.id === id) || null;

export const CONTACT_FIELDS = [
  { key: "contactRole", label: "Contact role", type: "select", options: CONTACT_ROLES, required: true, default: "client-primary" },
  { key: "organizationId", label: "Organization", type: "record", of: "organizations", placeholder: "— none —" },
  { key: "jobTitle", label: "Job title", type: "text", placeholder: "e.g. IT Manager" },
  { key: "email", label: "Email", type: "text", placeholder: "name@example.com" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "mobile", label: "Mobile", type: "text" },
  { key: "afterHoursPhone", label: "After-hours phone", type: "text" },
  { key: "preferredMethod", label: "Preferred contact method", type: "select", options: CONTACT_METHODS, default: "email" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const nameById = (set, type, id) => {
  const arr = (set && set.records && set.records[type]) || [];
  const found = arr.find((r) => r.id === id);
  return found ? found.name : null;
};

// A one-line summary for a table row: role · organization · best way to reach
// them.
export function contactDetailLine(record, set) {
  if (!record) return "";
  const role = contactRole(record.contactRole);
  const bits = [role ? role.label : "Contact"];
  const org = record.organizationId ? nameById(set, "organizations", record.organizationId) : null;
  if (org) bits.push(org);
  else if (record.jobTitle) bits.push(record.jobTitle);
  const reach = record.email || record.mobile || record.phone || record.afterHoursPhone;
  if (reach) bits.push(reach);
  return bits.join(" · ");
}

// Integrity checks for a whole set's contacts: unknown roles and organization
// references that point at nothing.
export function contactIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const orgIds = new Set(((set.records.organizations) || []).map((r) => r.id));
  for (const r of set.records.contacts || []) {
    if (!contactRole(r.contactRole)) {
      issues.push({ level: "error", code: "unknown-contact-role", recordId: r.id, message: `Contact “${r.name}” has an unknown contact role “${r.contactRole}”.` });
    }
    if (r.organizationId && !orgIds.has(r.organizationId)) {
      issues.push({ level: "error", code: "missing-contact-org", recordId: r.id, message: `Contact “${r.name}” is attached to an organization that does not exist.` });
    }
  }
  return issues;
}
