// src/framework/certificate.js — the SSL certificate tracker (roadmap Phase 6,
// task 25).
//
// An SSL/TLS CERTIFICATE record documents one internet-facing certificate: the
// host it protects (and the port), its subject and subject alternative names,
// the issuing authority, the serial number and signature algorithm, the validity
// window, and the SHA-256 fingerprint. Expiry is the fact the tracker exists
// for, and it is classified with the same overdue / due-soon / upcoming / ok
// vocabulary as the rest of the lifecycle engine (./renewals.js).
//
// The private key, when IT-U holds it, is stored as a PASSWORD record (task 17)
// and referenced from the certificate — never inlined here — so it inherits the
// credential model's access rules. The certificate links to the service it
// protects (a configuration, a flexible asset or a domain), so "which
// certificate protects sign-in?" is one link.
//
// `lookupCertificate` retrieves, best-effort, the certificate's PUBLIC details
// from the Certificate Transparency logs (crt.sh) — issuer, subject, SANs,
// serial and validity — so the record can be populated without retyping what is
// already public. The lookup is isolated behind a `fetchImpl` and unit-tested
// with a stub.

import { StoreError, CODES } from "./store/errors.js";
import { parseDate } from "./renewals.js";

export const CERTIFICATE_FIELDS = [
  { key: "port", label: "Port", type: "number", placeholder: "443", help: "The port the certificate is served on." },
  { key: "subject", label: "Subject / common name", type: "text", placeholder: "e.g. www.example.com" },
  { key: "subjectAltNames", label: "Subject alternative names", type: "textarea", placeholder: "One per line (DNS names and IPs)" },
  { key: "issuer", label: "Issuer", type: "text", placeholder: "e.g. Let's Encrypt R3" },
  { key: "serialNumber", label: "Serial number", type: "text" },
  { key: "signatureAlgorithm", label: "Signature algorithm", type: "text", placeholder: "e.g. SHA256-RSA" },
  { key: "keyType", label: "Key type", type: "text", placeholder: "e.g. RSA-2048, EC-P256" },
  { key: "validFrom", label: "Valid from", type: "date" },
  { key: "validTo", label: "Expiry date", type: "date", help: "The date the certificate expires — the whole point of the tracker." },
  { key: "fingerprintSha256", label: "SHA-256 fingerprint", type: "text" },
  { key: "protectedServiceRef", label: "Protected service", type: "record", of: ["configurations", "flexibleAssets", "domains"], placeholder: "— none —", help: "The service or host this certificate protects." },
  { key: "privateKeyRef", label: "Private key", type: "record", of: "passwords", placeholder: "— none —", help: "Store the private key as a password record (task 17) and reference it here — never paste key material into this record." },
  { key: "wildcard", label: "Wildcard certificate", type: "checkbox" },
  { key: "renewalAlertDays", label: "Alert lead time (days)", type: "number", placeholder: "30" },
  { key: "notes", label: "Notes", type: "textarea" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// A hostname as a certificate uses it: lower-cased, no scheme/path/port. A
// leading wildcard label is preserved.
export function normalizeHostname(value) {
  let s = String(value == null ? "" : value).trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, "");
  s = s.replace(/\.+$/, "");
  return s;
}

// A DNS hostname, optionally starting with a single "*." wildcard label.
const HOST_RE = /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function isValidHostname(value) {
  return HOST_RE.test(normalizeHostname(value));
}

export function isWildcard(value) {
  return normalizeHostname(value).startsWith("*.");
}

// ---- subject alternative names ---------------------------------------------
export function normalizeHostnameList(value) {
  if (Array.isArray(value)) return [...new Set(value.map((v) => normalizeHostname(v)).filter(Boolean))];
  return [...new Set(String(value || "").split(/[\s,;]+/).map((v) => normalizeHostname(v)).filter(Boolean))];
}

export const subjectAltNames = (record) => normalizeHostnameList(record && record.subjectAltNames);

// Do these names cover `hostname`? A wildcard SAN covers one level beneath it.
export function coversHostname(record, hostname) {
  const target = normalizeHostname(hostname);
  if (!target) return false;
  const names = [normalizeHostname(record && record.name), ...subjectAltNames(record)];
  for (const n of names) {
    if (!n) continue;
    if (n === target) return true;
    if (n.startsWith("*.")) {
      const base = n.slice(2);
      if (target === base) return true;
      if (target.endsWith("." + base) && target.slice(0, -("." + base).length).indexOf(".") === -1) return true;
    }
  }
  return false;
}

// ---- expiry ----------------------------------------------------------------
export function certificateExpiryStatus(record, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const dueSoonDays = opts.dueSoonDays != null ? opts.dueSoonDays : 14;
  const alert = Number.isFinite(Number(record && record.renewalAlertDays)) && Number(record.renewalAlertDays) >= 0 ? Number(record.renewalAlertDays) : opts.alertDays != null ? opts.alertDays : 30;
  const date = parseDate(record && record.validTo);
  if (!date) return { state: "none", date: null, iso: null, daysUntil: null, alert, label: "No expiry date" };
  const start = new Date(now);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const daysUntil = Math.round((date.getTime() - midnight) / 86400000);
  let state;
  if (daysUntil < 0) state = "overdue";
  else if (daysUntil <= Math.min(alert, dueSoonDays)) state = "due-soon";
  else if (daysUntil <= alert) state = "upcoming";
  else state = "ok";
  const label =
    state === "overdue"
      ? `Expired ${-daysUntil} day${-daysUntil === 1 ? "" : "s"} ago`
      : `Expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  return { state, date, iso: date.toISOString().slice(0, 10), daysUntil, alert, label };
}

// ---- validation ------------------------------------------------------------
export function validateCertificate(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A certificate must be an object."] };
  if (!isValidHostname(record.name)) {
    errors.push("A certificate record needs a valid hostname in its Name (e.g. www.example.com).");
  }
  if (!isBlank(record.validTo) && !parseDate(record.validTo)) {
    errors.push("The certificate's expiry date is not a valid date.");
  }
  if (!isBlank(record.port) && !(Number(record.port) >= 1 && Number(record.port) <= 65535)) {
    errors.push("The port must be between 1 and 65535.");
  }
  return { ok: errors.length === 0, errors };
}

export function requireCertificate(record) {
  const { ok, errors } = validateCertificate(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this certificate";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// ---- detail line & audit ---------------------------------------------------
export function certificateDetailLine(record) {
  if (!record) return "";
  const bits = [];
  const host = normalizeHostname(record.name) + (record.port ? ":" + record.port : "");
  bits.push(host);
  if (record.issuer) bits.push(record.issuer);
  const st = certificateExpiryStatus(record);
  bits.push(st.state === "none" ? "no expiry date" : "expires " + st.iso);
  return bits.join(" · ");
}

export function certificateIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  const exists = (type, id) => (set.records[type] || []).some((r) => r.id === id);
  for (const r of set.records.certificates || []) {
    if (!isValidHostname(r.name)) {
      issues.push({ level: "error", code: "invalid-cert-hostname", recordId: r.id, message: `Certificate “${r.name}” is not a valid hostname.` });
    }
    const st = certificateExpiryStatus(r);
    if (st.state === "overdue") {
      issues.push({ level: "error", code: "certificate-expired", recordId: r.id, message: `Certificate “${r.name}” expired on ${st.iso}.` });
    } else if (st.state === "due-soon") {
      issues.push({ level: "warning", code: "certificate-expiring", recordId: r.id, message: `Certificate “${r.name}” expires in ${st.daysUntil} day(s).` });
    } else if (st.state === "none") {
      issues.push({ level: "warning", code: "certificate-no-expiry", recordId: r.id, message: `Certificate “${r.name}” has no expiry date recorded — the tracker cannot watch it.` });
    }
    if (r.privateKeyRef && r.privateKeyRef.id && !exists(r.privateKeyRef.type || "passwords", r.privateKeyRef.id)) {
      issues.push({ level: "error", code: "certificate-missing-key", recordId: r.id, message: `Certificate “${r.name}” references a private-key credential that does not exist.` });
    }
    if (r.protectedServiceRef && r.protectedServiceRef.id && !exists(r.protectedServiceRef.type, r.protectedServiceRef.id)) {
      issues.push({ level: "error", code: "certificate-missing-service", recordId: r.id, message: `Certificate “${r.name}” references a protected service that does not exist.` });
    }
  }
  return issues;
}

// ---- best-effort live lookup (task 25) -------------------------------------
// Retrieve the PUBLIC certificate details from the Certificate Transparency
// logs via crt.sh. Returns the most recently-expiring matching entry so the
// record can be populated with what is already public.
const CRTSH_ENDPOINT = "https://crt.sh/";

function pickLatest(entries, hostname) {
  const usable = (entries || []).filter((e) => e && e.not_after);
  if (!usable.length) return null;
  const exact = usable.filter((e) => normalizeHostname(e.common_name) === hostname);
  const pool = exact.length ? exact : usable;
  return pool.slice().sort((a, b) => new Date(b.not_after).getTime() - new Date(a.not_after).getTime())[0];
}

export async function lookupCertificate(value, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const hostname = normalizeHostname(value);
  const result = { ok: false, hostname, certificate: {}, errors: [] };
  if (!hostname) {
    result.errors.push("Enter a hostname to look up.");
    return result;
  }
  if (!fetchImpl) {
    result.errors.push("No network available for a lookup.");
    return result;
  }
  try {
    const url = `${CRTSH_ENDPOINT}?q=${encodeURIComponent(hostname)}&output=json`;
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res || !res.ok) {
      result.errors.push(`CT lookup: HTTP ${res ? res.status : "error"}`);
      return result;
    }
    const json = await res.json();
    const entry = pickLatest(Array.isArray(json) ? json : [], hostname);
    if (!entry) {
      result.errors.push("No certificate found in the transparency logs.");
      return result;
    }
    const cert = {};
    if (entry.issuer_name) cert.issuer = String(entry.issuer_name);
    if (entry.common_name) cert.subject = String(entry.common_name);
    if (entry.name_value) cert.subjectAltNames = String(entry.name_value).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (entry.serial_number) cert.serialNumber = String(entry.serial_number);
    if (entry.not_before) cert.validFrom = String(entry.not_before).slice(0, 10);
    if (entry.not_after) cert.validTo = String(entry.not_after).slice(0, 10);
    result.certificate = cert;
    result.ok = Object.keys(cert).length > 0;
    return result;
  } catch (e) {
    result.errors.push("CT lookup: " + ((e && e.message) || e));
    return result;
  }
}
