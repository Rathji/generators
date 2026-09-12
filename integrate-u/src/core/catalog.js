export const CONNECTORS = [
  {
    id: "crm-u",
    name: "CRM-U",
    label: "Customer relationship management",
    accent: "#7c3aed",
    entityTypes: ["company", "customer"],
  },
  {
    id: "psa-u",
    name: "PSA-U",
    label: "Professional services & ticketing",
    accent: "#0d9488",
    entityTypes: ["company", "customer", "device", "ticket", "invoice"],
  },
  {
    id: "it-u",
    name: "IT-U",
    label: "IT documentation & asset inventory",
    accent: "#1e3a8a",
    entityTypes: ["company", "customer", "device"],
  },
  {
    id: "rmm-u",
    name: "RMM-U",
    label: "Remote monitoring & management",
    accent: "#b45309",
    entityTypes: ["company", "customer", "device"],
  },
  {
    id: "iu",
    name: "Integrate-U",
    label: "Integration hub (this app)",
    accent: "#0284c7",
    entityTypes: ["company", "customer", "device", "ticket", "invoice"],
    hub: true,
  },
];

export const ENTITY_TYPES = [
  {
    id: "company",
    collection: "companies",
    label: "Company",
    plural: "Companies",
    idPrefix: "co",
    nameField: "name",
    naturalKeys: ["domain", "name + city", "source reference"],
  },
  {
    id: "customer",
    collection: "customers",
    label: "Customer",
    plural: "Customers",
    idPrefix: "ct",
    nameField: "fullName",
    naturalKeys: ["email", "name + company", "source reference"],
  },
  {
    id: "device",
    collection: "devices",
    label: "Device",
    plural: "Devices",
    idPrefix: "dv",
    nameField: "hostname",
    naturalKeys: ["serial", "hostname", "source reference"],
  },
  {
    id: "ticket",
    collection: "tickets",
    label: "Ticket",
    plural: "Tickets",
    idPrefix: "tk",
    nameField: "subject",
    naturalKeys: ["source reference"],
  },
  {
    id: "invoice",
    collection: "invoices",
    label: "Invoice",
    plural: "Invoices",
    idPrefix: "iv",
    nameField: "number",
    naturalKeys: ["number", "source reference"],
  },
];

export const DIRECTIONS = [
  { id: "push", label: "Push", description: "The owner publishes changes out to the hub and every other tool." },
  { id: "pull", label: "Pull", description: "The hub reads the value from the owner on demand; it is never written anywhere else." },
  { id: "bidirectional", label: "Two-way", description: "Either side may propose changes; the owner's value wins when they disagree." },
  { id: "none", label: "Not synced", description: "The field stays inside its owning tool and is not shared." },
];

export const FIELD_MODEL = {
  company: [
    { key: "name", label: "Legal name", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "domain", label: "Primary domain", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "phone", label: "Main phone", owner: "crm-u", authoritative: true, direction: "bidirectional" },
    { key: "address", label: "Billing address", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "taxId", label: "Tax ID", owner: "crm-u", authoritative: true, direction: "push", sensitive: true },
    { key: "accountTier", label: "Account tier", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "documentationUrl", label: "Documentation link", owner: "it-u", authoritative: true, direction: "push" },
    { key: "assetCount", label: "Managed asset count", owner: "rmm-u", authoritative: true, direction: "pull", computed: true },
    { key: "openTicketCount", label: "Open ticket count", owner: "psa-u", authoritative: true, direction: "pull", computed: true },
    { key: "accountNotes", label: "Internal account notes", owner: "iu", authoritative: true, direction: "none" },
  ],
  customer: [
    { key: "fullName", label: "Full name", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "email", label: "Email", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "phone", label: "Phone", owner: "crm-u", authoritative: true, direction: "bidirectional" },
    { key: "jobTitle", label: "Job title", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "company", label: "Company", owner: "crm-u", authoritative: true, direction: "push" },
    { key: "itNotes", label: "IT notes", owner: "it-u", authoritative: true, direction: "push" },
    { key: "openTicketCount", label: "Open ticket count", owner: "psa-u", authoritative: true, direction: "pull", computed: true },
    { key: "lastSeenDevice", label: "Last seen device", owner: "rmm-u", authoritative: true, direction: "pull", computed: true },
  ],
  device: [
    { key: "hostname", label: "Hostname", owner: "rmm-u", authoritative: true, direction: "push" },
    { key: "serial", label: "Serial number", owner: "rmm-u", authoritative: true, direction: "push" },
    { key: "os", label: "Operating system", owner: "rmm-u", authoritative: true, direction: "push" },
    { key: "company", label: "Assigned company", owner: "rmm-u", authoritative: true, direction: "push" },
    { key: "assignedTo", label: "Assigned user", owner: "it-u", authoritative: true, direction: "bidirectional" },
    { key: "warrantyEnd", label: "Warranty end", owner: "it-u", authoritative: true, direction: "push" },
    { key: "lastCheckIn", label: "Last check-in", owner: "rmm-u", authoritative: true, direction: "pull", computed: true },
    { key: "openTicketCount", label: "Open ticket count", owner: "psa-u", authoritative: true, direction: "pull", computed: true },
  ],
  ticket: [
    { key: "subject", label: "Subject", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "status", label: "Status", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "priority", label: "Priority", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "assignee", label: "Assignee", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "company", label: "Company", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "linkedDevice", label: "Linked device", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "timeLogged", label: "Time logged (minutes)", owner: "psa-u", authoritative: true, direction: "pull", computed: true },
  ],
  invoice: [
    { key: "number", label: "Invoice number", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "amount", label: "Amount", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "status", label: "Status", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "dueDate", label: "Due date", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "company", label: "Company", owner: "psa-u", authoritative: true, direction: "push" },
    { key: "balance", label: "Outstanding balance", owner: "psa-u", authoritative: true, direction: "pull", computed: true },
  ],
};

export const CAPABILITIES = [
  { id: "*", label: "Full access", wildcard: true },
  { id: "identity.read", label: "View canonical identities" },
  { id: "identity.write", label: "Create, edit and merge identities" },
  { id: "registry.read", label: "View the integration registry" },
  { id: "registry.write", label: "Edit the integration registry" },
  { id: "permissions.read", label: "View permission mappings" },
  { id: "company.read", label: "View companies" },
  { id: "company.write", label: "Edit companies" },
  { id: "customer.read", label: "View customers" },
  { id: "customer.write", label: "Edit customers" },
  { id: "device.read", label: "View devices" },
  { id: "device.control", label: "Control managed devices" },
  { id: "ticket.read", label: "View tickets" },
  { id: "ticket.write", label: "Create and edit tickets" },
  { id: "invoice.read", label: "View invoices" },
  { id: "invoice.write", label: "Issue and edit invoices" },
  { id: "bundle.publish", label: "Publish data bundles" },
  { id: "audit.read", label: "Read the audit log" },
  { id: "monitor.read", label: "View connector monitoring" },
];

const ALL = CAPABILITIES.filter((c) => !c.wildcard).map((c) => c.id);

export const CANONICAL_ROLES = {
  owner: { label: "Owner", description: "Unrestricted access to the whole hub.", capabilities: ["*"] },
  admin: { label: "Administrator", description: "Manages integration setup and all customer data.", capabilities: ALL },
  dispatcher: {
    label: "Dispatcher",
    description: "Coordinates work and tickets for customers.",
    capabilities: ["identity.read", "company.read", "customer.read", "customer.write", "device.read", "ticket.read", "ticket.write", "invoice.read", "monitor.read"],
  },
  technician: {
    label: "Technician",
    description: "Works tickets and manages devices in the field.",
    capabilities: ["company.read", "customer.read", "device.read", "device.control", "ticket.read", "ticket.write"],
  },
  account_manager: {
    label: "Account manager",
    description: "Owns the commercial relationship with customers.",
    capabilities: ["identity.read", "company.read", "company.write", "customer.read", "customer.write", "ticket.read", "invoice.read"],
  },
  billing: {
    label: "Billing",
    description: "Handles invoicing and finance records.",
    capabilities: ["company.read", "customer.read", "ticket.read", "invoice.read", "invoice.write"],
  },
  auditor: {
    label: "Auditor",
    description: "Read-only access to records and the audit trail.",
    capabilities: ["identity.read", "registry.read", "permissions.read", "company.read", "customer.read", "device.read", "ticket.read", "invoice.read", "audit.read", "monitor.read"],
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to customer records.",
    capabilities: ["identity.read", "company.read", "customer.read", "device.read", "ticket.read", "invoice.read", "monitor.read"],
  },
};

export const TOOL_ROLE_MAPS = {
  "crm-u": {
    "CRM Administrator": "admin",
    "Sales Manager": "account_manager",
    "Sales Rep": "account_manager",
    "Read-only Analyst": "viewer",
  },
  "psa-u": {
    "Service Manager": "admin",
    Dispatcher: "dispatcher",
    Technician: "technician",
    Accountant: "billing",
  },
  "it-u": {
    "IT Manager": "admin",
    "IT Technician": "technician",
    "Documentation Auditor": "auditor",
  },
  "rmm-u": {
    "RMM Administrator": "admin",
    "NOC Engineer": "technician",
    "Monitoring Viewer": "viewer",
  },
  iu: {
    "Hub Owner": "owner",
    "Hub Administrator": "admin",
    "Hub Auditor": "auditor",
  },
};
