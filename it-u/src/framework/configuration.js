// src/framework/configuration.js — configurations (roadmap Phase 2, tasks 9–10).
//
// A configuration is a STANDARDIZED record for one managed physical or virtual
// device: servers (physical and virtual), workstations, laptops, firewalls,
// switches, access points, printers/scanners, displays, cameras, security
// panels/alarms, backup power supplies, storage devices and other managed
// equipment. Every configuration carries the same attribute set — name, type,
// manufacturer, model, serial number, hostname, IP address(es), MAC address,
// physical location, and support/warranty expiry — so the whole estate can be
// queried, exported and audited consistently.
//
// TASK 10 lives here too: the COMPLETENESS RULES. A configurable required-field
// set (defaulting to the classic expectation — common name, manufacturer,
// model, precise location, serial number, MAC address, one or more IP
// addresses, warranty or support expiry, and at least one associated
// credential) is evaluated per configuration. An incomplete configuration is
// FLAGGED, never blocked, and a field that genuinely does not apply can carry
// an explicit, RECORDED exception (who exempted it, why, and when).
//
// This module is the single source of truth for the configuration-type catalog,
// the field schema, the IP parsing, the completeness rules and the reference
// integrity checks; ./standardized.js folds it into the combined registry.

import { refKey } from "./relationships.js";

export const CONFIGURATION_TYPES = [
  { id: "server-physical", label: "Physical server", group: "Server", description: "A physical rack, tower or blade server." },
  { id: "server-virtual", label: "Virtual server (VM)", group: "Server", description: "A virtual machine hosted on a hypervisor." },
  { id: "workstation", label: "Workstation", group: "Endpoint", description: "A desktop computer or fixed workstation." },
  { id: "laptop", label: "Laptop", group: "Endpoint", description: "A portable computer." },
  { id: "firewall", label: "Firewall", group: "Network", description: "A firewall, UTM or security gateway." },
  { id: "router", label: "Router", group: "Network", description: "A router or gateway routing between networks." },
  { id: "switch", label: "Switch", group: "Network", description: "A network switch (managed or unmanaged)." },
  { id: "access-point", label: "Access point", group: "Network", description: "A wireless access point." },
  { id: "printer", label: "Printer / scanner", group: "Peripheral", description: "A networked printer, scanner or MFP." },
  { id: "display", label: "Display", group: "Peripheral", description: "A display, screen or digital signage unit." },
  { id: "camera", label: "Camera", group: "Security", description: "An IP camera or video endpoint." },
  { id: "security-panel", label: "Security panel / alarm", group: "Security", description: "An alarm panel or access-control system." },
  { id: "ups", label: "Backup power supply (UPS)", group: "Infrastructure", description: "A UPS or other backup power supply." },
  { id: "storage", label: "Storage device", group: "Infrastructure", description: "A NAS, SAN or other storage appliance." },
  { id: "other", label: "Other managed equipment", group: "Other", description: "Managed equipment that does not fit the standard types." },
];

export const CONFIGURATION_TYPE_LABELS = Object.fromEntries(CONFIGURATION_TYPES.map((t) => [t.id, t.label]));
export const configurationType = (id) => CONFIGURATION_TYPES.find((t) => t.id === id) || null;
export const configurationTypeLabel = (id) => CONFIGURATION_TYPE_LABELS[id] || null;

export const CONFIGURATION_FIELDS = [
  { key: "configType", label: "Configuration type", type: "select", options: CONFIGURATION_TYPES, required: true, default: "workstation" },
  { key: "locationId", label: "Physical location", type: "record", of: "locations", placeholder: "— none —" },
  { key: "manufacturer", label: "Manufacturer", type: "text", placeholder: "e.g. Dell, HP, Cisco" },
  { key: "model", label: "Model", type: "text" },
  { key: "serialNumber", label: "Serial number", type: "text" },
  { key: "hostname", label: "Hostname", type: "text", placeholder: "e.g. web-01" },
  { key: "ipAddresses", label: "IP address(es)", type: "textarea", placeholder: "One per line, or comma-separated" },
  { key: "macAddress", label: "MAC address", type: "text", placeholder: "aa:bb:cc:dd:ee:ff" },
  { key: "assetTag", label: "Asset tag", type: "text" },
  { key: "supportExpiryDate", label: "Support expiry", type: "date" },
  { key: "warrantyExpiryDate", label: "Warranty expiry", type: "date" },
  { key: "endOfLifeDate", label: "End of life", type: "date" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// ---- IP address handling ---------------------------------------------------
// A configuration may hold one or more IP addresses (management, data, iLO, …).
// Accept a newline/comma/semicolon/space separated string, or an array.
export function parseIpAddresses(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (isBlank(value)) return [];
  return String(value)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]{2,39}$/;
export function isValidIpAddress(ip) {
  const s = String(ip || "").trim();
  if (!s) return false;
  if (IPV4.test(s)) return true;
  return s.includes(":") && s.split(":").length >= 3 && IPV6.test(s);
}

export function invalidIpAddresses(value) {
  return parseIpAddresses(value).filter((ip) => !isValidIpAddress(ip));
}

const nameById = (set, type, id) => {
  const arr = (set && set.records && set.records[type]) || [];
  const found = arr.find((r) => r.id === id);
  return found ? found.name : null;
};

// A one-line summary for a table row: type · manufacturer model · location.
export function configurationDetailLine(record, set) {
  if (!record) return "";
  const t = configurationType(record.configType);
  const bits = [t ? t.label : "Configuration"];
  const make = [record.manufacturer, record.model].filter(Boolean).join(" ");
  if (make) bits.push(make);
  if (record.serialNumber) bits.push("S/N " + record.serialNumber);
  const loc = record.locationId ? nameById(set, "locations", record.locationId) : null;
  if (loc) bits.push(loc);
  return bits.join(" · ");
}

// ---- completeness rules (task 10) ------------------------------------------
//
// Each rule is either a FIELD rule (a field on the record must carry a value)
// or a RELATIONSHIP rule (a typed link must exist). The default required set is
// the "classic expectation"; a documentation set can override it.

export const COMPLETENESS_RULES = [
  { key: "name", label: "Common name", kind: "field", field: "name", description: "The configuration's common name." },
  { key: "manufacturer", label: "Manufacturer", kind: "field", field: "manufacturer", description: "Who made the device." },
  { key: "model", label: "Model", kind: "field", field: "model", description: "The manufacturer's model designation." },
  { key: "locationId", label: "Precise location", kind: "field", field: "locationId", description: "The location the device physically sits in." },
  { key: "serialNumber", label: "Serial number", kind: "field", field: "serialNumber", description: "The device's serial number." },
  { key: "macAddress", label: "MAC address", kind: "field", field: "macAddress", description: "The device's hardware (MAC) address." },
  {
    key: "ipAddresses",
    label: "One or more IP addresses",
    kind: "field",
    description: "At least one valid IP address (management, data, iLO, …).",
    test: (r) => parseIpAddresses(r.ipAddresses).filter(isValidIpAddress).length > 0,
  },
  {
    key: "expiry",
    label: "Warranty or support expiry",
    kind: "field",
    description: "A warranty or support expiry date, so the lifecycle tracker can watch it.",
    test: (r) => !isBlank(r.warrantyExpiryDate) || !isBlank(r.supportExpiryDate),
  },
  {
    key: "credential",
    label: "At least one associated credential",
    kind: "relationship",
    kindId: "configuration-credential",
    description: "A password record linked to the configuration.",
  },
  { key: "hostname", label: "Hostname", kind: "field", field: "hostname", description: "The device's network hostname." },
  { key: "assetTag", label: "Asset tag", kind: "field", field: "assetTag", description: "The organisation's asset tag." },
];

export const COMPLETENESS_RULE_KEYS = COMPLETENESS_RULES.map((r) => r.key);
export const DEFAULT_REQUIRED_FIELDS = [
  "name",
  "manufacturer",
  "model",
  "locationId",
  "serialNumber",
  "macAddress",
  "ipAddresses",
  "expiry",
  "credential",
];

export const completenessRule = (key) => COMPLETENESS_RULES.find((r) => r.key === key) || null;

// Normalize a stored/partial completeness config. A missing config means "use
// the defaults"; an explicitly provided `required` array (even empty) is
// honoured.
export function normalizeCompletenessConfig(config) {
  const src = config && typeof config === "object" ? config : {};
  const required = Array.isArray(src.required) ? src.required.filter((k) => COMPLETENESS_RULE_KEYS.includes(k)) : DEFAULT_REQUIRED_FIELDS.slice();
  return { required: [...new Set(required)] };
}

// Does this rule hold for this record? Relationship rules look at the set's
// typed links (a link is stored once and read from both ends).
export function isRuleSatisfied(record, rule, set) {
  if (!rule || !record) return false;
  if (rule.kind === "relationship") {
    const key = refKey({ type: "configurations", id: record.id });
    return ((set && set.records && set.records.relationships) || []).some(
      (rel) => rel.kind === rule.kindId && (refKey(rel.from) === key || refKey(rel.to) === key),
    );
  }
  if (typeof rule.test === "function") return !!rule.test(record);
  if (rule.field) return !isBlank(record[rule.field]);
  return false;
}

export function recordExemptions(record) {
  return (record && record.exemptions && typeof record.exemptions === "object" && record.exemptions) || {};
}

// Evaluate one configuration against its required set. Returns the missing and
// exempted rules (with the recorded exception), so the UI and the linter can
// flag it precisely.
export function configurationCompleteness(record, set, config) {
  const cfg = normalizeCompletenessConfig(config);
  const rules = cfg.required.map(completenessRule).filter(Boolean);
  const exemptions = recordExemptions(record);
  const missing = [];
  const exempt = [];
  const satisfied = [];
  for (const rule of rules) {
    const exemption = exemptions[rule.key];
    if (exemption) {
      exempt.push({ rule, exemption });
      continue;
    }
    if (isRuleSatisfied(record, rule, set)) satisfied.push(rule);
    else missing.push(rule);
  }
  return {
    complete: missing.length === 0,
    config: cfg,
    rules,
    satisfied,
    missing,
    exempt,
    missingKeys: missing.map((r) => r.key),
    missingLabels: missing.map((r) => r.label),
    exemptKeys: exempt.map((x) => x.rule.key),
  };
}

export const isConfigurationComplete = (record, set, config) => configurationCompleteness(record, set, config).complete;

// The exception record the UI writes when a rule genuinely does not apply.
export function makeExemption({ reason = "", by = "system", now = Date.now() } = {}) {
  return { reason: String(reason || "").trim(), by, at: now };
}

// The whole-set completeness report (per-set config in `set.completeness`).
export function completenessReport(set) {
  const cfg = normalizeCompletenessConfig(set && set.completeness);
  const records = (set && set.records && set.records.configurations) || [];
  const out = records.map((r) => {
    const c = configurationCompleteness(r, set, cfg);
    return {
      id: r.id,
      name: r.name,
      complete: c.complete,
      missing: c.missingKeys,
      missingLabels: c.missingLabels,
      exempt: c.exemptKeys,
    };
  });
  const incomplete = out.filter((r) => !r.complete);
  return {
    ok: incomplete.length === 0,
    config: cfg,
    configured: !!(set && set.completeness),
    total: out.length,
    completeCount: out.length - incomplete.length,
    incompleteCount: incomplete.length,
    records: out,
    incompleteRecords: incomplete,
  };
}

// ---- reference integrity (part of the set's graph audit) --------------------

export function configurationIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const locIds = new Set(((set.records.locations) || []).map((r) => r.id));
  for (const r of set.records.configurations || []) {
    if (!configurationType(r.configType)) {
      issues.push({ level: "error", code: "unknown-config-type", recordId: r.id, message: `Configuration “${r.name}” has an unknown configuration type “${r.configType}”.` });
    }
    if (r.locationId && !locIds.has(r.locationId)) {
      issues.push({ level: "error", code: "missing-config-location", recordId: r.id, message: `Configuration “${r.name}” is located at a location that does not exist.` });
    }
    const bad = invalidIpAddresses(r.ipAddresses);
    if (bad.length) {
      issues.push({ level: "warning", code: "invalid-ip", recordId: r.id, message: `Configuration “${r.name}” has a malformed IP address: ${bad.join(", ")}.` });
    }
  }
  return issues;
}
