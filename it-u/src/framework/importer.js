// src/framework/importer.js — user-initiated bulk CSV import (roadmap task 29).
//
// Task 28 keeps a set in step with a live system of record. Task 29 covers the
// other direction of onboarding: a one-time, user-driven CSV import that
// populates a client's documentation from a spreadsheet export — organizations,
// contacts, configurations, credentials or flexible assets.
//
// The import is deliberately a THREE-STEP, dry-run-first flow, because "instead
// of silent drops" is the whole point of the task:
//
//   1. parse    — parseCsv() reads the file into headers + rows (RFC-4180-ish:
//                 quoted fields, embedded commas/newlines and doubled quotes,
//                 CRLF or LF, a leading BOM, and a delimiter the user can pick).
//   2. map      — autoMapColumns() proposes a column → field mapping from the
//                 headers (against each field's key, label and aliases); the UI
//                 lets the user correct it.
//   3. plan     — buildImportPlan() validates every row WITHOUT writing anything:
//                 each row is classified ready / duplicate / invalid / empty,
//                 carrying the exact errors that stopped it. This is the
//                 dry-run report.
//
// Only then does the documentation-set service (docsets.importRecords) consume
// the plan's ready rows, one transaction, and return a per-row result — so a row
// that fails mid-import is reported, never dropped. This module is pure: it
// never touches the store, the network or the DOM.

import { RECORD_FIELD_SCHEMAS } from "./standardized.js";

export const IMPORT_SCHEMA = "itu-import/1";

// Normalize a header / option name for comparison: lower-case, punctuation and
// runs of whitespace collapsed to single spaces.
export function normalizeHeader(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[_\-/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const normHeader = normalizeHeader;

// Resolve a user-entered value against a catalog of {id,label} options: the id
// first, then a normalized label / id comparison. Returns the option or null.
export function resolveOption(options, raw) {
  const wanted = normHeader(raw);
  if (!wanted) return null;
  for (const o of options || []) {
    if (String(o.id).toLowerCase() === String(raw).trim().toLowerCase()) return o;
  }
  for (const o of options || []) {
    if (normHeader(o.id) === wanted || normHeader(o.label) === wanted) return o;
  }
  for (const o of options || []) {
    if (normHeader(o.label).includes(wanted) || wanted.includes(normHeader(o.label))) return o;
  }
  return null;
}

const NAME_FIELD = {
  key: "name",
  label: "Name",
  required: true,
  type: "text",
  aliases: ["name", "record name", "title", "display name", "label", "record"],
};

// Extra header synonyms, per target, for columns whose spreadsheet heading will
// rarely match the schema label. Keys must exist in the target's field schema.
const FIELD_ALIASES = {
  organizations: {
    orgKind: ["kind", "organization kind", "org type", "type"],
    parentOrgId: ["parent", "parent organization", "parent org"],
    legalName: ["legal name", "legal"],
    tradingName: ["trading name", "trading", "trading as"],
    taxId: ["tax id", "tax", "abn", "acn", "vat", "registration", "company number"],
    website: ["website", "web", "url"],
    primaryPhone: ["phone", "primary phone", "telephone", "main phone"],
    notes: ["notes", "comment", "comments"],
  },
  contacts: {
    contactRole: ["role", "contact role", "type"],
    organizationId: ["organization", "org", "company", "client", "account"],
    jobTitle: ["job title", "title", "position"],
    email: ["email", "e-mail", "email address"],
    phone: ["phone", "telephone", "work phone"],
    mobile: ["mobile", "cell", "mobile phone", "mobile number"],
    afterHoursPhone: ["after hours", "after-hours phone", "afterhours", "after hours phone"],
    preferredMethod: ["preferred method", "contact method", "preferred contact"],
    notes: ["notes", "comment", "comments"],
  },
  configurations: {
    configType: ["type", "device type", "configuration type", "category"],
    locationId: ["location", "site", "office", "facility"],
    manufacturer: ["manufacturer", "make", "vendor", "brand"],
    model: ["model"],
    serialNumber: ["serial", "serial number", "serial no", "sn", "service tag"],
    hostname: ["hostname", "host name", "device name", "computer name", "name of device"],
    ipAddresses: ["ip", "ip address", "ip address(es)", "ip addresses", "ips", "address"],
    macAddress: ["mac", "mac address", "physical address"],
    assetTag: ["asset tag", "asset id", "tag", "asset number"],
    supportExpiryDate: ["support expiry", "support expires", "support date", "support end", "support end date"],
    warrantyExpiryDate: ["warranty expiry", "warranty", "warranty date", "warranty end", "warranty end date"],
    endOfLifeDate: ["end of life", "eol", "eol date", "end-of-life", "retire date"],
    notes: ["notes", "comment", "comments"],
  },
  passwords: {
    scope: ["scope"],
    category: ["category", "credential category", "type"],
    embeddedIn: ["embedded in", "owner", "owning asset"],
    username: ["username", "user", "username / email", "login", "account", "user id"],
    secret: ["password", "secret", "pass", "passphrase"],
    otpSecret: ["otp", "otp secret", "totp", "totp secret", "2fa secret"],
    url: ["url", "website", "link", "site"],
    permissions: ["permissions", "permission"],
    rotationMethod: ["rotation method", "rotation path"],
    rotationProduct: ["rotation product"],
    rotateEveryDays: ["rotate every", "rotate every days", "rotation days"],
    rotatedAt: ["last rotated", "rotated at", "rotation date"],
    allowExport: ["allow export", "exportable", "allow in exports"],
    notes: ["notes", "comment", "comments"],
  },
};

// The five record types a CSV can populate, and the classification every
// imported record is stamped with (provenance "imported" — the task's
// "imported once, maintained here thereafter"). Flexible assets are dynamic:
// their fields come from the chosen template (see the `extraFields` option).
export const IMPORT_TARGETS = [
  {
    id: "organizations",
    recordType: "organizations",
    label: "Organizations",
    singular: "Organization",
    icon: "building",
    informationModel: "core-asset",
    provenance: "imported",
    fields: RECORD_FIELD_SCHEMAS.organizations,
  },
  {
    id: "contacts",
    recordType: "contacts",
    label: "Contacts",
    singular: "Contact",
    icon: "user",
    informationModel: "core-asset",
    provenance: "imported",
    fields: RECORD_FIELD_SCHEMAS.contacts,
  },
  {
    id: "configurations",
    recordType: "configurations",
    label: "Configurations",
    singular: "Configuration",
    icon: "server",
    informationModel: "core-asset",
    provenance: "imported",
    fields: RECORD_FIELD_SCHEMAS.configurations,
  },
  {
    id: "passwords",
    recordType: "passwords",
    label: "Credentials",
    singular: "Credential",
    icon: "shield",
    informationModel: "core-asset",
    provenance: "imported",
    fields: RECORD_FIELD_SCHEMAS.passwords,
  },
  {
    id: "flexibleAssets",
    recordType: "flexibleAssets",
    label: "Flexible assets",
    singular: "Flexible asset",
    icon: "layers",
    informationModel: "flexible-asset",
    provenance: "imported",
    dynamic: true,
    fields: [],
    summaryField: "assetTypeName",
  },
];

export const importTarget = (id) => IMPORT_TARGETS.find((t) => t.id === id) || null;

// The full ordered field list for a plan: the name field, then the target's
// schema fields (with alias synonyms merged in). A dynamic (flexible-asset)
// target gets its template's fields from `extraFields` instead.
export function targetFields(target, extraFields = []) {
  const t = typeof target === "string" ? importTarget(target) : target;
  if (!t) return [];
  if (t.dynamic) {
    return [NAME_FIELD, ...(extraFields || []).map((f) => ({ ...f, required: !!f.required, aliases: f.aliases || [] }))];
  }
  const aliases = FIELD_ALIASES[t.id] || {};
  return [NAME_FIELD, ...(t.fields || []).map((f) => ({ ...f, aliases: aliases[f.key] || [] }))];
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

// Pick the most likely delimiter from the header line: whichever of , ; \t |
// appears most often outside quotes. Falls back to a comma.
export function detectDelimiter(text) {
  const src = String(text == null ? "" : text).replace(/^\uFEFF/, "");
  let firstLine = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') inQuotes = !inQuotes;
    else if ((c === "\n" || c === "\r") && !inQuotes) break;
    else firstLine += c;
  }
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

// Parse CSV text into { delimiter, headers, rows }. `rows` are arrays of cell
// strings (the header row is removed). Handles quoted fields with embedded
// delimiters/newlines, doubled quotes as an escaped quote, CRLF/LF and a BOM.
export function parseCsv(text, opts = {}) {
  const src = String(text == null ? "" : text).replace(/^\uFEFF/, "");
  const delimiter = opts.delimiter || detectDelimiter(src);
  const grid = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    grid.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (c === delimiter) {
      pushField();
      sawAny = true;
    } else if (c === "\n") {
      pushRow();
      sawAny = false;
    } else if (c === "\r") {
      // swallow; \r\n handled by the following \n, lone \r acts as a break
      if (src[i + 1] !== "\n") pushRow();
      sawAny = false;
    } else {
      field += c;
      sawAny = true;
    }
  }
  if (field.length || row.length || sawAny) pushRow();
  // Drop trailing all-blank rows.
  while (grid.length && grid[grid.length - 1].every((c) => String(c).trim() === "")) grid.pop();
  const headers = (grid.shift() || []).map((h) => String(h).trim());
  const width = headers.length;
  const rows = grid.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push("");
    return out;
  });
  return { delimiter, headers, rows };
}

// ---------------------------------------------------------------------------
// column mapping
// ---------------------------------------------------------------------------

// Propose a column → field mapping from headers, matching each field's key,
// label and aliases exactly first, then by substring. Returns { fieldKey: colIndex }.
export function autoMapColumns(headers, target, extraFields = []) {
  const fields = targetFields(target, extraFields);
  const normalized = headers.map((h) => normHeader(h));
  const map = {};
  const used = new Set();
  const candidatesFor = (f) => [f.key, f.label, ...(f.aliases || [])].map(normHeader).filter(Boolean);
  for (const f of fields) {
    const cands = candidatesFor(f);
    const idx = normalized.findIndex((h, i) => !used.has(i) && h && cands.includes(h));
    if (idx >= 0) {
      map[f.key] = idx;
      used.add(idx);
    }
  }
  for (const f of fields) {
    if (map[f.key] != null) continue;
    const cands = candidatesFor(f);
    const idx = normalized.findIndex((h, i) => !used.has(i) && h && cands.some((c) => c.length > 2 && h.includes(c)));
    if (idx >= 0) {
      map[f.key] = idx;
      used.add(idx);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// planning (the dry run)
// ---------------------------------------------------------------------------

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

const checkboxValue = (raw) => {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return undefined;
  if (["1", "true", "yes", "y", "on", "x", "✓", "checked"].includes(s)) return true;
  if (["0", "false", "no", "n", "off", "-", "unchecked"].includes(s)) return false;
  return undefined;
};

// Coerce a raw cell into the shape the record field expects.
export function coerceValue(field, raw) {
  if (isBlank(raw)) return undefined;
  const s = String(raw).trim();
  if (field.type === "number") {
    const n = Number(s.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  if (field.type === "checkbox") return checkboxValue(s);
  if (field.type === "multiselect") return s.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  return s;
}

// Resolve a `select` field's value (an option id or a friendly label) to the id.
function resolveSelect(field, raw) {
  const options = field.options || [];
  const found = resolveOption(options, raw);
  return found ? found.id : null;
}

// Resolve a `record` field's value (a record id, or a record name) to an id.
// `records` maps a collection name to that collection's records.
function resolveRecordRef(field, raw, records) {
  const collections = Array.isArray(field.of) ? field.of : [field.of];
  const wanted = String(raw).trim().toLowerCase();
  for (const coll of collections) {
    const arr = (records && records[coll]) || [];
    const byId = arr.find((r) => r.id === String(raw).trim());
    if (byId) return { id: byId.id, name: byId.name };
    const byName = arr.find((r) => String(r.name || "").trim().toLowerCase() === wanted);
    if (byName) return { id: byName.id, name: byName.name };
  }
  return null;
}

const normName = (s) => String(s == null ? "" : s).trim().toLowerCase();

// Build a plan (dry run). Nothing is written. Each row is classified as
// "ready" (will import), "duplicate" (name already present), "invalid" (has
// errors) or "empty" (no usable cells). `existing` are the target type's
// existing records (for duplicate detection); `records` is the whole set's
// records (to resolve record-reference columns).
export function buildImportPlan({
  target,
  headers = [],
  rows = [],
  mapping = {},
  existing = [],
  records = null,
  source = "CSV import",
  defaults = {},
  allowDuplicates = false,
  extraFields = [],
  assetType = null,
  maxErrors = 25,
} = {}) {
  const t = typeof target === "string" ? importTarget(target) : target;
  if (!t) throw new Error("Unknown import target.");
  const fields = targetFields(t, extraFields);
  const existingNames = new Set(existing.map((r) => normName(r.name)));

  const plan = {
    target: t.id,
    recordType: t.recordType,
    columns: headers.slice(),
    mapping: { ...mapping },
    source,
    assetTypeId: t.dynamic && assetType ? assetType.id : null,
    assetTypeName: t.dynamic && assetType ? assetType.name : null,
    fields: fields.map((f) => ({ key: f.key, label: f.label, type: f.type || "text", required: !!f.required })),
    rows: [],
    counts: { total: 0, ready: 0, duplicate: 0, invalid: 0, empty: 0 },
  };

  const col = (key) => (mapping[key] == null ? null : mapping[key]);
  const cellFor = (row, key) => {
    const c = col(key);
    if (c == null || c < 0 || c >= row.length) return "";
    return row[c];
  };

  rows.forEach((row, index) => {
    plan.counts.total += 1;
    const allBlank = row.every((c) => isBlank(c));
    if (allBlank) {
      plan.counts.empty += 1;
      plan.rows.push({ index, line: index + 2, status: "empty", errors: [], values: {}, candidate: null, duplicate: null });
      return;
    }

    const errors = [];
    const values = {};
    const candidate = { informationModel: t.informationModel, provenance: t.provenance, origin: { source } };

    for (const field of fields) {
      let raw = cellFor(row, field.key);
      const mapped = col(field.key) != null;

      if (field.type === "record" && !isBlank(raw)) {
        const ref = resolveRecordRef(field, raw, records);
        if (!ref) {
          errors.push(`${field.label}: no existing record named “${String(raw).trim()}”.`);
          continue;
        }
        values[field.key] = ref.id;
        candidate[field.key] = ref.id;
        continue;
      }

      if ((field.type === "select" || field.options) && !isBlank(raw)) {
        const id = resolveSelect(field, raw);
        if (!id) {
          errors.push(`${field.label}: “${String(raw).trim()}” is not one of the allowed values.`);
          continue;
        }
        values[field.key] = id;
        candidate[field.key] = id;
        continue;
      }

      let value = coerceValue(field, raw);
      if (value === undefined && defaults[field.key] !== undefined) value = defaults[field.key];
      if (value === undefined && field.default !== undefined && field.default !== "") value = field.default;
      if (value !== undefined) {
        values[field.key] = value;
        candidate[field.key] = value;
      }
    }

    // A blank name is fatal; a missing required field lists against the row.
    if (isBlank(candidate.name)) {
      if (t.dynamic) errors.push("Name is required (map a name column, or use a template default).");
      else errors.push("Name is required.");
    }

    // Flexible assets: collect the mapped template fields into assetFields.
    if (t.dynamic) {
      const assetFields = {};
      for (const field of fields) {
        if (field.key === "name") continue;
        if (values[field.key] !== undefined) assetFields[field.key] = values[field.key];
        delete candidate[field.key];
      }
      candidate.assetTypeId = plan.assetTypeId;
      candidate.assetFields = assetFields;
    }

    // Validate against the real record schema so the dry run matches the save.
    if (!isBlank(candidate.name)) {
      const shape = validateCandidate(t, candidate, assetType);
      for (const e of shape) if (!errors.includes(e)) errors.push(e);
    }

    let status = errors.length ? "invalid" : "ready";
    let duplicate = null;
    if (!errors.length) {
      const clash = existingNames.has(normName(candidate.name));
      if (clash) {
        duplicate = candidate.name;
        status = allowDuplicates ? "ready" : "duplicate";
        if (!allowDuplicates) errors.push(`“${String(candidate.name).trim()}” already exists in this set — it will be skipped.`);
      }
    }

    plan.counts[status] += 1;
    plan.rows.push({
      index,
      line: index + 2,
      status,
      errors: errors.slice(0, maxErrors),
      values,
      candidate,
      duplicate,
    });
  });

  return plan;
}

// Run the standardized record validation for a candidate. Kept local so the
// engine owns the dry run's notion of "valid".
function validateCandidate(target, candidate, assetType) {
  const errors = [];
  const schema = RECORD_FIELD_SCHEMAS[target.recordType];
  if (schema) {
    for (const f of schema) {
      if (f.required && isBlank(candidate[f.key])) errors.push(`“${f.label}” is required.`);
    }
  }
  if (target.dynamic) {
    if (!candidate.assetTypeId) errors.push("Pick a flexible-asset template for this import.");
    if (assetType && assetType.fields) {
      for (const f of assetType.fields) {
        if (f.required) {
          const v = candidate.assetFields ? candidate.assetFields[f.key] : undefined;
          if (isBlank(v) || (Array.isArray(v) && !v.length)) errors.push(`“${f.label}” is required.`);
        }
      }
    }
  }
  return errors;
}

// A short human summary of a plan (used in toasts and the import log).
export function planSummary(plan) {
  const c = plan.counts;
  const parts = [`${c.ready} ready`];
  if (c.duplicate) parts.push(`${c.duplicate} duplicate`);
  if (c.invalid) parts.push(`${c.invalid} invalid`);
  if (c.empty) parts.push(`${c.empty} empty`);
  return parts.join(" · ");
}

// The rows a plan would actually import.
export function readyRows(plan, { allowDuplicates = false } = {}) {
  return plan.rows.filter((r) => r.status === "ready" || (allowDuplicates && r.status === "duplicate"));
}
