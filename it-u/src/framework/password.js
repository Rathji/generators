// src/framework/password.js — password / credential records (roadmap Phase 4,
// task 17).
//
// A credential is a STANDARDIZED record: the same field set for every one, so
// the whole credential estate can be listed, filtered, audited and — when the
// export phases arrive — redacted consistently.
//
// The task's central distinction is SCOPE:
//
//   • a GENERAL credential stands alone. It is linkable to many assets
//     (applications, configurations, sites, organizations) and carries its own
//     permission set.
//   • an EMBEDDED credential is created inside a specific asset's context and
//     INHERITS that asset's permissions. It is not independently permissioned;
//     effectivePermissions() resolves the inherited set from the owning record.
//
// Both scopes store the same shape: name, category, username/email, password,
// one-time-password secret (validated against otp.js), URL, notes, permissions
// and the related assets. Rotation is recorded here too — the METHOD by which
// the secret is changed (manual, or a connected product) lives on the record
// and is interpreted by credentialTools.js.
//
// This module is the single source of truth for the credential catalogs, the
// field schema, scope/permission resolution, the display line and the integrity
// audit; ./standardized.js folds it into the combined registry.

import { StoreError, CODES } from "./store/errors.js";
import { normalizeRef, sameRef, refKey, findRecord } from "./relationships.js";
import { validateOtpSecret } from "./otp.js";
import { ROTATION_METHODS, ROTATION_PRODUCTS, rotationMethod } from "./credentialTools.js";

export const PASSWORD_SCOPES = [
  {
    id: "general",
    label: "General credential",
    short: "General",
    description: "A standalone credential that can be linked to many assets and carries its own permissions.",
  },
  {
    id: "embedded",
    label: "Embedded credential",
    short: "Embedded",
    description: "A credential created in one asset's context that inherits that asset's permissions.",
  },
];

export const PASSWORD_CATEGORIES = [
  { id: "local-admin", label: "Local administrator", group: "Device", description: "A local admin account on a device or operating system." },
  { id: "domain-admin", label: "Directory administrator", group: "Directory", description: "A privileged directory-service account (AD, Entra, LDAP)." },
  { id: "service-account", label: "Service account", group: "Directory", description: "A non-human account used by a service or integration." },
  { id: "user-account", label: "User account", group: "Identity", description: "A named person's login." },
  { id: "application", label: "Application login", group: "Application", description: "A login to a business application." },
  { id: "database", label: "Database account", group: "Application", description: "A database or data-platform credential." },
  { id: "network-device", label: "Network device", group: "Network", description: "A router, switch, firewall or access-point login." },
  { id: "wireless", label: "Wireless network", group: "Network", description: "A wireless key or controller credential." },
  { id: "email", label: "Email system", group: "Service", description: "A mailbox or mail-platform credential." },
  { id: "cloud-service", label: "Cloud service", group: "Service", description: "A cloud console or SaaS administrator login." },
  { id: "backup", label: "Backup platform", group: "Service", description: "A backup or recovery platform credential." },
  { id: "voip", label: "Voice / SIP", group: "Service", description: "A phone-system, SIP or voicemail credential." },
  { id: "api-key", label: "API key / token", group: "Machine", description: "A programmatic key or bearer token." },
  { id: "certificate", label: "Certificate / private key", group: "Machine", description: "A certificate passphrase or private-key password." },
  { id: "other", label: "Other", group: "Other", description: "A credential that does not fit the standard categories." },
];

export const PASSWORD_PERMISSIONS = [
  { id: "view", label: "View the secret", description: "Reveal the stored password in the interface." },
  { id: "use", label: "Use / copy", description: "Copy the secret for use on a system." },
  { id: "edit", label: "Edit", description: "Change the credential's fields or secret." },
  { id: "rotate", label: "Rotate", description: "Change the secret on the system and record it here." },
  { id: "share", label: "Share", description: "Include the credential in a shared bundle or export." },
];

export const DEFAULT_PASSWORD_PERMISSIONS = ["view", "use", "edit", "rotate"];
// What an embedded credential inherits when its owning asset declares no
// permission set of its own — the safe minimum.
export const DEFAULT_INHERITED_PERMISSIONS = ["view", "use"];

export const PASSWORD_CATEGORY_LABELS = Object.fromEntries(PASSWORD_CATEGORIES.map((c) => [c.id, c.label]));
export const passwordCategory = (id) => PASSWORD_CATEGORIES.find((c) => c.id === id) || null;
export const passwordScope = (id) => PASSWORD_SCOPES.find((s) => s.id === id) || null;
export const passwordPermission = (id) => PASSWORD_PERMISSIONS.find((p) => p.id === id) || null;
export const permissionLabel = (id) => (passwordPermission(id) || {}).label || id;

const OWNABLE_COLLECTIONS = ["configurations", "flexibleAssets", "organizations", "locations", "documents", "checklists", "trackers", "runbooks"];

export const PASSWORD_FIELDS = [
  { key: "scope", label: "Credential scope", type: "select", options: PASSWORD_SCOPES, required: true, default: "general" },
  { key: "category", label: "Category", type: "select", options: PASSWORD_CATEGORIES, required: true, default: "user-account" },
  {
    key: "embeddedIn",
    label: "Embedded in",
    type: "record",
    of: OWNABLE_COLLECTIONS,
    placeholder: "— select the owning asset —",
    help: "An embedded credential is created inside an asset's context and inherits that asset's permissions.",
  },
  { key: "username", label: "Username / email", type: "text", placeholder: "name@example.com or DOMAIN\\user" },
  { key: "secret", label: "Password", type: "password", placeholder: "Stored in the documentation set" },
  { key: "otpSecret", label: "One-time-password secret", type: "text", placeholder: "Base32 secret from the authenticator enrolment" },
  { key: "url", label: "URL", type: "text", placeholder: "https://…" },
  { key: "permissions", label: "Permissions", type: "multiselect", options: PASSWORD_PERMISSIONS },
  { key: "rotationMethod", label: "Rotation path", type: "select", options: ROTATION_METHODS, default: "manual" },
  { key: "rotationProduct", label: "Rotation product", type: "select", options: ROTATION_PRODUCTS, default: "" },
  { key: "rotateEveryDays", label: "Rotate every (days)", type: "number", placeholder: "90" },
  { key: "rotatedAt", label: "Last rotated", type: "date" },
  { key: "allowExport", label: "Allow in bundles & exports", type: "checkbox" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

export const isEmbedded = (record) => !!(record && record.scope === "embedded");
export const isGeneral = (record) => !isEmbedded(record);

// The record an embedded credential belongs to (its permission source), if any.
export function ownerRef(record) {
  return normalizeRef(record && record.embeddedIn);
}

// The permissions that actually apply to a credential. A general credential
// uses its own list (defaulting to the standard set when none is stored); an
// embedded credential ignores any list of its own and inherits from the owning
// record's `credentialPermissions` (falling back to the safe minimum).
export function effectivePermissions(record, set) {
  if (!record) return { scope: null, permissions: [], source: "none", inheritedFrom: null, inherited: false };
  if (isEmbedded(record)) {
    const ref = ownerRef(record);
    const owner = ref ? findRecord(set, ref) : null;
    const declared = owner && Array.isArray(owner.credentialPermissions) ? owner.credentialPermissions.filter(passwordPermission) : [];
    return {
      scope: "embedded",
      permissions: declared.length ? [...declared] : DEFAULT_INHERITED_PERMISSIONS.slice(),
      source: declared.length ? "owner" : "default-inherited",
      inheritedFrom: ref,
      ownerName: owner ? owner.name : null,
      inherited: true,
    };
  }
  const hasOwn = Array.isArray(record.permissions);
  const list = hasOwn ? record.permissions.filter(passwordPermission) : [];
  return {
    scope: "general",
    permissions: hasOwn ? [...list] : DEFAULT_PASSWORD_PERMISSIONS.slice(),
    source: hasOwn ? "own" : "default",
    inheritedFrom: null,
    inherited: false,
  };
}

// Validate a credential's shape. Never throws — the docs service turns the
// errors into a refused save. Owner EXISTENCE is not checked here (that is the
// integrity audit's job, like every other standardized reference), but the
// reference must be well-formed and the OTP secret must be usable.
export function validatePassword(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A credential must be an object."] };
  const scope = passwordScope(record.scope);
  if (!scope) errors.push(`A credential must declare its scope (${PASSWORD_SCOPES.map((s) => `“${s.label}”`).join(" or ")}).`);
  if (!passwordCategory(record.category)) {
    errors.push(`A credential must declare a category (${PASSWORD_CATEGORIES.map((c) => c.id).join(", ")}).`);
  }
  if (record.scope === "embedded") {
    if (!ownerRef(record)) errors.push("An embedded credential must name the record it is embedded in.");
  } else if (record.embeddedIn != null && !isBlank(record.embeddedIn) && !ownerRef(record)) {
    errors.push("The embedded-in reference is malformed.");
  }
  if (!isBlank(record.otpSecret)) {
    const v = validateOtpSecret(record.otpSecret);
    if (!v.ok) errors.push(`The one-time-password secret is not usable: ${v.errors.join(" ")}`);
  }
  if (!isBlank(record.url) && !/^https?:\/\/\S+$/i.test(String(record.url).trim())) {
    errors.push("“URL” must be a valid http(s) URL.");
  }
  if (record.permissions != null && !Array.isArray(record.permissions)) {
    errors.push("Credentials permissions must be a list.");
  } else if (Array.isArray(record.permissions)) {
    const bad = record.permissions.filter((p) => !passwordPermission(p));
    if (bad.length) errors.push(`Unknown credential permission${bad.length === 1 ? "" : "s"}: ${bad.join(", ")}.`);
  }
  if (!isBlank(record.rotationMethod) && !rotationMethod(record.rotationMethod)) {
    errors.push("The rotation path must be manual or a connected password-management product.");
  }
  return { ok: errors.length === 0, errors };
}

export function requirePassword(record) {
  const { ok, errors } = validatePassword(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this credential";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

const nameById = (set, type, id) => {
  const arr = (set && set.records && set.records[type]) || [];
  const found = arr.find((r) => r.id === id);
  return found ? found.name : null;
};

// A one-line summary for a table row: category · scope · username · owner.
export function passwordDetailLine(record, set) {
  if (!record) return "";
  const cat = passwordCategory(record.category);
  const bits = [cat ? cat.label : "Credential"];
  if (isEmbedded(record)) {
    const ref = ownerRef(record);
    const owner = ref ? nameById(set, ref.type, ref.id) : null;
    bits.push(owner ? "Embedded in " + owner : "Embedded (no owner)");
  } else {
    bits.push("General");
  }
  if (record.username) bits.push(record.username);
  if (record.otpSecret) bits.push("OTP");
  return bits.join(" · ");
}

// Credentials in a set, split by scope / filtered by owner.
export function credentialsFor(set, ref) {
  const want = normalizeRef(ref);
  return ((set && set.records && set.records.passwords) || []).filter((p) => want && p.embeddedIn && sameRef(ownerRef(p), want));
}
export function generalCredentials(set) {
  return ((set && set.records && set.records.passwords) || []).filter((p) => !isEmbedded(p));
}
export function embeddedCredentials(set) {
  return ((set && set.records && set.records.passwords) || []).filter((p) => isEmbedded(p));
}

// ---- secret redaction ------------------------------------------------------
// Credential material must never leak into a non-credential export. This is the
// single place that knows which fields are secret.
export const SECRET_FIELDS = ["secret", "otpSecret"];

export function redactPassword(record, { mask = "••••••••" } = {}) {
  if (!record) return record;
  const out = { ...record };
  for (const f of SECRET_FIELDS) if (out[f]) out[f] = mask;
  return out;
}

export function isSecretField(key) {
  return SECRET_FIELDS.includes(key);
}

// ---- integrity audit (part of the set's graph audit) ------------------------

export function passwordIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const exists = (ref) => !!findRecord(set, ref);
  for (const r of set.records.passwords || []) {
    if (!passwordScope(r.scope)) {
      issues.push({ level: "error", code: "unknown-password-scope", recordId: r.id, message: `Credential “${r.name}” has an unknown scope “${r.scope}”.` });
    }
    if (!passwordCategory(r.category)) {
      issues.push({ level: "error", code: "unknown-password-category", recordId: r.id, message: `Credential “${r.name}” has an unknown category “${r.category}”.` });
    }
    if (isEmbedded(r)) {
      const ref = ownerRef(r);
      if (!ref) {
        issues.push({ level: "error", code: "embedded-no-owner", recordId: r.id, message: `Embedded credential “${r.name}” does not name the record it belongs to.` });
      } else if (!exists(ref)) {
        issues.push({ level: "error", code: "embedded-dangling-owner", recordId: r.id, message: `Embedded credential “${r.name}” belongs to a record that does not exist.` });
      }
    }
    if (!isBlank(r.otpSecret) && !validateOtpSecret(r.otpSecret).ok) {
      issues.push({ level: "warning", code: "bad-otp-secret", recordId: r.id, message: `Credential “${r.name}” has a malformed one-time-password secret.` });
    }
    if (!isBlank(r.rotationMethod) && !rotationMethod(r.rotationMethod)) {
      issues.push({ level: "error", code: "unknown-rotation-path", recordId: r.id, message: `Credential “${r.name}” has an unknown rotation path “${r.rotationMethod}”.` });
    }
  }
  return issues;
}
