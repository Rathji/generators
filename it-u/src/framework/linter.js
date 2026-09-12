// src/framework/linter.js — the documentation quality linter (roadmap task 46).
//
// The graph audit (`integrity` / `standardizedIssues`) answers "is the
// documentation a valid, referentially-consistent graph?". The linter answers a
// different question: "is the documentation *good*?" — has each configuration
// been filled in, does every asset relate to something, has structured data been
// buried in free-text documents, is every known service actually covered, and is
// anything expired or quietly going stale?
//
// This module is pure: it reads a documentation set and returns a list of
// FINDINGS, each naming the check that produced it, a severity, the record it
// concerns, a human message and a suggested fix. The station
// (src/modules/linter.js) only renders; the fixes themselves (task 48) consume
// the `fix` descriptor each finding carries.
//
// The six checks (task 46's list):
//   configuration-completeness  — configurations missing required fields
//   orphan-records              — assets with no relationships
//   document-duplication        — documents repeating structured data in prose
//   service-coverage            — known services with no relationship/surface
//   expiry-attention            — expired or imminent-expiry items
//   stale-records               — records not reviewed in a long time
//   storage-model               — values held in the wrong information model (task 47)
//
// Task 47's storage-model check answers a question the other six cannot: "is
// this information in the right home?" — structured values stranded in free
// text, a paragraph of prose sitting in a structured field, a note that is
// really an asset, and the same value typed into two records that should have
// been linked. Every finding names where the value is now and where it belongs.

import { RECORD_TYPES, RECORD_TYPE_META } from "./docsets.js";
import { completenessReport, completenessRule, parseIpAddresses } from "./configuration.js";
import { assetFieldsOf } from "./flexible.js";
import { collectLifecycle } from "./lifecycle.js";
import { subjectAltNames } from "./certificate.js";
import { isEmbedded } from "./password.js";
import { VOICE_PBX_TYPE_ID } from "./voice.js";
import { WAN_SERVICE_TYPE_ID } from "./network.js";
import { WAN_CIRCUIT_TYPE_ID } from "./circuit.js";
import { EMAIL_SYSTEM_TYPE_ID } from "./email.js";
import { BACKUP_SERVICE_TYPE_ID } from "./backup.js";

// ---- severity ---------------------------------------------------------------
export const LINT_SEVERITIES = [
  { id: "error", label: "Error", tone: "danger", rank: 0, description: "Something is wrong and should be fixed." },
  { id: "warning", label: "Warning", tone: "warn", rank: 1, description: "A completeness or quality gap worth fixing." },
  { id: "info", label: "Notice", tone: "muted", rank: 2, description: "A suggestion or a record worth reviewing." },
];

export const severityDef = (id) => LINT_SEVERITIES.find((s) => s.id === id) || null;
export const severityRank = (id) => {
  const d = severityDef(id);
  return d ? d.rank : 99;
};
export const severityLabel = (id) => (severityDef(id) || {}).label || id;

// ---- the check catalog ------------------------------------------------------
export const LINT_CHECKS = [
  {
    id: "configuration-completeness",
    label: "Configuration completeness",
    icon: "server",
    description: "Configuration records missing one of their required fields.",
    hint: "Fill in the field, or record an exemption where it genuinely does not apply.",
  },
  {
    id: "service-coverage",
    label: "Service coverage",
    icon: "layers",
    description: "Known services with no relationships, or with no devices/credentials/documentation linked.",
    hint: "Link the service to the devices, credentials and documentation that make it up.",
  },
  {
    id: "document-duplication",
    label: "Documents duplicating structured data",
    icon: "article",
    description: "Values kept both as structured fields and as free text in a document.",
    hint: "Link the document to the record, or move the repeated values into the structured record.",
  },
  {
    id: "storage-model",
    label: "Information stored in the wrong model",
    icon: "layers",
    description: "Structured data buried in free text, prose kept in a structured field, notes that should be assets, and values duplicated instead of linked.",
    hint: "Move each value to the model it belongs in, then link the records together.",
  },
  {
    id: "expiry-attention",
    label: "Expired or imminent expiry",
    icon: "clock",
    description: "Dated records that are expired or expiring soon, and tracked records with no date.",
    hint: "Renew, replace or re-date the item, then update the record.",
  },
  {
    id: "orphan-records",
    label: "Records with no relationships",
    icon: "link",
    description: "Assets that are not linked to any other record.",
    hint: "Link each record to the assets, clients and services it belongs to.",
  },
  {
    id: "stale-records",
    label: "Stale records",
    icon: "clock",
    description: "Records that have not been updated in a long time.",
    hint: "Review the record and confirm it is still accurate.",
  },
];

export const lintCheck = (id) => LINT_CHECKS.find((c) => c.id === id) || null;
export const lintCheckLabel = (id) => (lintCheck(id) || {}).label || id;

// ---- small helpers ----------------------------------------------------------
const refKey = (ref) => (ref ? ref.type + ":" + ref.id : "");

function typeLabel(type, plural = false) {
  const m = RECORD_TYPE_META[type];
  if (!m) return type;
  return plural ? m.label : m.singular;
}

const refOf = (record, type) => ({ type, id: record.id, name: record.name });

function makeFinding({ check, code, severity, ref = null, recordName = null, recordType = null, message, detail = "", suggestion = "", fix = null, meta = {}, id = null }) {
  return {
    id: id || [code, refKey(ref), meta.ruleKey || meta.requirement || (meta.tokens || []).join("+")].filter(Boolean).join(":"),
    check,
    code,
    severity,
    scope: ref ? "record" : "set",
    ref: ref || null,
    recordId: ref ? ref.id : null,
    recordType: ref ? ref.type : recordType,
    recordName: recordName || (ref && ref.name) || null,
    message,
    detail,
    suggestion,
    fix,
    meta,
  };
}

// Every typed link, indexed at both ends. `links.get(key)` is an array of
// `{ rel, other: ref, direction: "out"|"in", kind }`.
function relationshipIndex(set) {
  const links = new Map();
  for (const rel of (set && set.records && set.records.relationships) || []) {
    if (!rel.from || !rel.to) continue;
    for (const [a, b, dir] of [[rel.from, rel.to, "out"], [rel.to, rel.from, "in"]]) {
      const k = refKey(a);
      if (!links.has(k)) links.set(k, []);
      links.get(k).push({ rel, other: b, direction: dir, kind: rel.kind });
    }
  }
  return links;
}

const linksFor = (index, ref) => index.get(refKey(ref)) || [];

// ---- check: configuration completeness --------------------------------------
// Reuses the task-10 completeness engine: a configuration is flagged once per
// required rule it is missing (exempted rules are not flagged).
export function lintConfigurationCompleteness(set) {
  const out = [];
  if (!set || !set.records) return out;
  const byId = new Map((set.records.configurations || []).map((r) => [r.id, r]));
  const report = completenessReport(set);
  for (const r of report.incompleteRecords) {
    const rec = byId.get(r.id);
    const ref = rec ? refOf(rec, "configurations") : { type: "configurations", id: r.id, name: r.name };
    for (const key of r.missing) {
      const rule = completenessRule(key);
      const label = rule ? rule.label : key;
      out.push(
        makeFinding({
          check: "configuration-completeness",
          code: "config-missing-field",
          severity: "warning",
          ref,
          message: `Configuration “${r.name}” is missing “${label}”.`,
          detail: rule ? rule.description : "",
          suggestion: `Fill in “${label}”, or record an exemption if it genuinely does not apply.`,
          fix: { kind: "fill-field", ruleKey: key, field: (rule && rule.field) || null, label },
          meta: { ruleKey: key },
        }),
      );
    }
  }
  return out;
}

// ---- check: orphan records --------------------------------------------------
// The asset types that should participate in the relationship graph. Embedded
// credentials are owned by their host record (not linked), so they are exempt.
export const ORPHAN_AUDIT_TYPES = ["configurations", "passwords", "flexibleAssets", "domains", "certificates", "diagrams", "sites", "runbooks"];

export function lintOrphanRecords(set) {
  const out = [];
  if (!set || !set.records) return out;
  const links = relationshipIndex(set);
  for (const type of ORPHAN_AUDIT_TYPES) {
    for (const r of set.records[type] || []) {
      if (type === "passwords" && isEmbedded(r)) continue;
      const ref = refOf(r, type);
      if (linksFor(links, ref).length) continue;
      out.push(
        makeFinding({
          check: "orphan-records",
          code: "orphan-record",
          severity: "info",
          ref,
          message: `${typeLabel(type)} “${r.name}” is not linked to any other record.`,
          suggestion: "Link it to the assets, clients or services it belongs to so it appears in relationship navigation.",
          fix: { kind: "link-records", ref },
        }),
      );
    }
  }
  return out;
}

// ---- check: documents duplicating structured data ---------------------------
const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const SERIAL_RE = /^[a-z0-9][a-z0-9._-]{4,}$/i;

// A token worth matching: an IP, a MAC, a dotted hostname, or an alphanumeric
// serial (with at least one digit and one letter, so plain words do not match).
export function isStructuredToken(value) {
  const s = String(value == null ? "" : value).trim();
  if (s.length < 4 || s.length > 120) return false;
  if (/\s/.test(s)) return false;
  if (IP_RE.test(s) || MAC_RE.test(s) || HOST_RE.test(s)) return true;
  if (SERIAL_RE.test(s) && /\d/.test(s) && /[a-z]/i.test(s)) return true;
  return false;
}

// Every identifying structured value the set holds, normalised for matching.
export function structuredTokens(set) {
  const out = [];
  if (!set || !set.records) return out;
  const push = (record, type, field, value) => {
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v == null) continue;
      const s = String(v).trim();
      if (!isStructuredToken(s)) continue;
      out.push({ token: s.toLowerCase(), ref: refOf(record, type), field, value: s });
    }
  };
  for (const r of set.records.configurations || []) {
    push(r, "configurations", "hostname", r.hostname);
    push(r, "configurations", "serialNumber", r.serialNumber);
    push(r, "configurations", "macAddress", r.macAddress);
    for (const ip of parseIpAddresses(r.ipAddresses)) push(r, "configurations", "ipAddresses", ip);
  }
  for (const r of set.records.domains || []) push(r, "domains", "name", r.name);
  for (const r of set.records.certificates || []) {
    push(r, "certificates", "hostname", r.hostname);
    push(r, "certificates", "certName", r.certName);
    for (const san of subjectAltNames(r)) push(r, "certificates", "subjectAltNames", san);
  }
  for (const r of set.records.flexibleAssets || []) {
    for (const [k, v] of Object.entries(r.assetFields || {})) {
      if (typeof v !== "string") continue;
      // A textarea that lists values one per line (or comma-separated) holds
      // each as a structured value, so scan the pieces as well as the whole.
      const pieces = v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      for (const piece of pieces.length ? pieces : [v]) push(r, "flexibleAssets", k, piece);
    }
  }
  // De-duplicate identical token/reference pairs.
  const seen = new Set();
  return out.filter((t) => {
    const k = t.token + "|" + refKey(t.ref) + "|" + t.field;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// A token matches on its own boundaries: the character before it must not be
// part of a larger token (so a domain name does not match inside a hostname it
// is a suffix of — "acme.example" must not match within "srv-01.acme.example"),
// while the character after it may be punctuation (a sentence-ending period).
const matchers = new Map();
function matcherFor(token) {
  if (!matchers.has(token)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matchers.set(token, new RegExp("(^|[^a-z0-9._:-])" + escaped + "($|[^a-z0-9:])", "i"));
  }
  return matchers.get(token);
}

export function lintDocumentDuplication(set) {
  const out = [];
  if (!set || !set.records) return out;
  const tokens = structuredTokens(set);
  if (!tokens.length) return out;
  const links = relationshipIndex(set);
  for (const doc of set.records.documents || []) {
    const docRef = refOf(doc, "documents");
    const text = (String(doc.name || "") + "\n" + String(doc.body || "")).toLowerCase();
    if (!text.trim()) continue;
    const linkedKeys = new Set(linksFor(links, docRef).map((l) => refKey(l.other)));
    const hits = new Map();
    for (const t of tokens) {
      if (!matcherFor(t.token).test(text)) continue;
      const k = refKey(t.ref);
      if (linkedKeys.has(k)) continue; // already linked — not a duplication problem
      if (!hits.has(k)) hits.set(k, { ref: t.ref, tokens: new Set(), fields: new Set() });
      hits.get(k).tokens.add(t.value);
      hits.get(k).fields.add(t.field);
    }
    for (const hit of hits.values()) {
      const values = [...hit.tokens];
      out.push(
        makeFinding({
          check: "document-duplication",
          code: "document-duplicates-record",
          severity: "warning",
          ref: docRef,
          message: `Document “${doc.name}” repeats ${typeLabel(hit.ref.type)} “${hit.ref.name}” data (${values.join(", ")}) in its text without linking to it.`,
          detail: values.length === 1 ? `The value “${values[0]}” also lives in the structured ${hit.fields.has("ipAddresses") ? "IP addressing" : typeLabel(hit.ref.type).toLowerCase()} record.` : "These values also live in the structured record.",
          suggestion: "Link the document to the record, or move the repeated values into the structured record instead of keeping them in prose.",
          fix: { kind: "link-records", ref: docRef, target: hit.ref },
          meta: { targetRef: hit.ref, tokens: values },
        }),
      );
    }
  }
  return out;
}

// ---- check: information stored in the wrong model (task 47) -----------------
// Four related signals that a value is not where it belongs:
//   storage-free-text-holds-structure — free text carrying structured values
//                                        that no structured record holds;
//   storage-structure-holds-prose     — a structured field carrying a paragraph
//                                        that belongs in a document;
//   storage-asset-as-note             — a note that reads as a structured asset;
//   storage-duplicated-value          — the same value typed into two records
//                                        that should have been linked.

export const PROSE_MIN_LENGTH = 200;
export const FREE_TEXT_MIN_VALUES = 2;
export const NOTE_PAIR_MIN = 3;
export const NOTE_PAIR_RATIO = 0.5;
export const NOTE_DOC_TYPES = ["operational-notes", "reference"];

// The value scanners used over free text, most-specific first so a URL is not
// also counted as a bare hostname and an email is not counted as a hostname.
const SCAN_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const SCAN_URL = /\bhttps?:\/\/[^\s<>"')]+/gi;
const SCAN_IP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const SCAN_MAC = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const SCAN_HOST = /\b[a-z0-9][a-z0-9-]*[a-z0-9](?:\.[a-z0-9][a-z0-9-]*[a-z0-9])+\b/gi;
const SCAN_SERIAL = /\b[A-Za-z0-9][A-Za-z0-9._-]{4,}\b/g;

// A serial-like token carries both a digit and a letter plus a separator (so a
// plain word never counts), and is either upper-cased, underscored or carries a
// run of digits — the shapes real serial numbers take.
function serialLike(s) {
  if (!/[0-9]/.test(s) || !/[a-z]/i.test(s) || !/[-_.]/.test(s)) return false;
  return /\d{2,}/.test(s) || /[A-Z]/.test(s) || s.includes("_");
}

// Scan free text for identifying values — emails, URLs, IPs, MACs, hostnames
// and serials — normalised and de-duplicated by kind + lowercased value.
export function scanStructuredValues(text) {
  const s = String(text == null ? "" : text);
  const found = new Map();
  const add = (kind, value) => {
    const v = String(value).trim().replace(/[.,;:)\]}'"]+$/, "");
    if (v.length < 4) return;
    const k = kind + "|" + v.toLowerCase();
    if (!found.has(k)) found.set(k, { kind, value: v });
  };
  for (const m of s.matchAll(SCAN_EMAIL)) add("email", m[0]);
  for (const m of s.matchAll(SCAN_URL)) add("url", m[0]);
  for (const m of s.matchAll(SCAN_IP)) add("ip", m[0]);
  for (const m of s.matchAll(SCAN_MAC)) add("mac", m[0]);
  for (const m of s.matchAll(SCAN_HOST)) add("hostname", m[0]);
  for (const m of s.matchAll(SCAN_SERIAL)) if (serialLike(m[0])) add("serial", m[0]);
  return [...found.values()];
}

// A value that reads as a paragraph: long, sentence-shaped and not a token.
export function isProse(value) {
  const s = String(value == null ? "" : value).trim();
  if (s.length < PROSE_MIN_LENGTH) return false;
  if (isStructuredToken(s)) return false;
  const sentences = (s.match(/[.!?](?:\s|$)/g) || []).length;
  const lines = s.split(/\n+/).filter((l) => l.trim().length > 0).length;
  return sentences >= 3 || (sentences >= 2 && lines >= 3);
}

// A "label: value" line, the shape of an asset kept as a note. The value must
// be short — a paragraph is not a field.
const PAIR_RE = /^\s*(?:[-*#>]+\s*)?([A-Za-z][A-Za-z0-9 _/&().'-]{0,48}?)\s*[:=]\s*(\S.*)$/;
export function noteFieldPairs(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  const labels = [];
  let nonEmpty = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    nonEmpty += 1;
    const m = line.match(PAIR_RE);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    if (!label || label.length < 2) continue;
    if (/^https?$/i.test(label)) continue;
    if (value.length > 140 || value.split(/\s+/).length > 12) continue;
    labels.push(label);
  }
  return { count: labels.length, nonEmpty, labels, ratio: nonEmpty ? labels.length / nonEmpty : 0 };
}

// ---- storage-model: free text carrying structure ----------------------------
// Values found in a document's text that NO structured record holds. Two or
// more is the signal that the document is standing in for an asset.
export function lintFreeTextStructure(set) {
  const out = [];
  if (!set || !set.records) return out;
  const known = new Set(structuredTokens(set).map((t) => t.token));
  const consider = (record, type, text) => {
    const found = scanStructuredValues(text).filter((v) => !known.has(v.value.toLowerCase()));
    if (found.length < FREE_TEXT_MIN_VALUES) return;
    const values = found.map((v) => v.value);
    const ref = refOf(record, type);
    out.push(
      makeFinding({
        check: "storage-model",
        code: "storage-free-text-holds-structure",
        severity: "warning",
        ref,
        message: `${typeLabel(type)} “${record.name}” buries ${values.length} structured values in free text that no structured record holds.`,
        detail: `${values.slice(0, 6).join(", ")}${values.length > 6 ? ", …" : ""}.`,
        suggestion: "Create a structured asset (or a configuration) to hold these values, then link this document to it.",
        fix: { kind: "convert-to-asset", ref, values },
        meta: { values, kinds: [...new Set(found.map((v) => v.kind))] },
      }),
    );
  };
  for (const doc of set.records.documents || []) consider(doc, "documents", [doc.name, doc.summary, doc.body].filter(Boolean).join("\n"));
  for (const rb of set.records.runbooks || []) consider(rb, "runbooks", [rb.name, rb.summary, rb.body, rb.content].filter(Boolean).join("\n"));
  return out;
}

// ---- storage-model: prose sitting in a structured field ---------------------
// A long paragraph in a record's free-text field belongs in a Document. Once a
// document is linked to the record the finding clears, so the fix is sticky.
export function lintStructuredProse(set, opts = {}) {
  const out = [];
  if (!set || !set.records) return out;
  const links = relationshipIndex(set);
  const linkedTypes = (ref) => new Set(linksFor(links, ref).map((l) => l.other.type));
  const typeOf = opts.typeOf || (() => null);
  const consider = (record, type, fieldKey, fieldLabel, value) => {
    if (!isProse(value)) return;
    const ref = refOf(record, type);
    if (linkedTypes(ref).has("documents")) return;
    const length = String(value).trim().length;
    out.push(
      makeFinding({
        check: "storage-model",
        code: "storage-structure-holds-prose",
        severity: "warning",
        ref,
        message: `${typeLabel(type)} “${record.name}” keeps a paragraph of prose in “${fieldLabel}”.`,
        detail: `The ${fieldLabel} field holds ${length} characters across several sentences.`,
        suggestion: "Move the prose into a Document (or a runbook), keep the structured field for short values, and link the document to this record.",
        fix: { kind: "extract-document", ref, field: fieldKey, label: fieldLabel },
        meta: { field: fieldKey, length },
      }),
    );
  };
  for (const r of set.records.configurations || []) consider(r, "configurations", "notes", "Notes", r.notes);
  for (const r of set.records.locations || []) consider(r, "locations", "notes", "Notes", r.notes);
  for (const r of set.records.domains || []) consider(r, "domains", "notes", "Notes", r.notes);
  for (const r of set.records.certificates || []) consider(r, "certificates", "notes", "Notes", r.notes);
  for (const r of set.records.flexibleAssets || []) {
    const type = typeOf(r) || null;
    const fieldByKey = new Map((((type && type.fields) || [])).map((f) => [f.key, f]));
    for (const [k, v] of Object.entries(assetFieldsOf(r))) {
      if (typeof v !== "string") continue;
      const def = fieldByKey.get(k);
      if (def && !["text", "textarea"].includes(def.type)) continue;
      consider(r, "flexibleAssets", k, (def && def.label) || k, v);
    }
  }
  return out;
}

// ---- storage-model: a note that is really an asset --------------------------
export function lintAssetAsNote(set) {
  const out = [];
  if (!set || !set.records) return out;
  for (const doc of set.records.documents || []) {
    if (!NOTE_DOC_TYPES.includes(doc.docType)) continue;
    const info = noteFieldPairs(doc.body || "");
    if (info.count < NOTE_PAIR_MIN || info.ratio < NOTE_PAIR_RATIO) continue;
    out.push(
      makeFinding({
        check: "storage-model",
        code: "storage-asset-as-note",
        severity: "warning",
        ref: refOf(doc, "documents"),
        message: `Document “${doc.name}” reads as a structured asset kept as a note (${info.count} field/value lines).`,
        detail: `Fields: ${info.labels.slice(0, 5).join(", ")}${info.labels.length > 5 ? ", …" : ""}.`,
        suggestion: "Convert it into a Flexible Asset — choose or design a template — move the fields into it and link the records it relates to.",
        fix: { kind: "convert-note-to-asset", ref: refOf(doc, "documents"), fields: info.labels },
        meta: { pairs: info.count, labels: info.labels },
      }),
    );
  }
  return out;
}

// ---- storage-model: a value duplicated instead of related -------------------
// The same identifying value held by two records that are not linked.
export function lintDuplicatedValues(set) {
  const out = [];
  if (!set || !set.records) return out;
  const byToken = new Map();
  for (const t of structuredTokens(set)) {
    if (!byToken.has(t.token)) byToken.set(t.token, []);
    const list = byToken.get(t.token);
    if (!list.some((x) => refKey(x.ref) === refKey(t.ref))) list.push(t);
  }
  const links = relationshipIndex(set);
  const linkedPair = (a, b) => linksFor(links, a).some((l) => refKey(l.other) === refKey(b));
  for (const [token, holders] of byToken) {
    if (holders.length < 2) continue;
    let pair = null;
    for (let i = 0; i < holders.length && !pair; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        if (!linkedPair(holders[i].ref, holders[j].ref)) {
          pair = [holders[i], holders[j]];
          break;
        }
      }
    }
    if (!pair) continue;
    const [a, b] = pair;
    out.push(
      makeFinding({
        check: "storage-model",
        code: "storage-duplicated-value",
        severity: "warning",
        ref: a.ref,
        message: `${typeLabel(a.ref.type)} “${a.ref.name}” and ${typeLabel(b.ref.type)} “${b.ref.name}” both record “${a.value}”.`,
        detail: `Held in “${a.field}” on ${a.ref.name} and “${b.field}” on ${b.ref.name}.`,
        suggestion: "Keep the value in one record and link the other to it — or use a record-reference field — instead of duplicating it.",
        fix: { kind: "link-records", ref: a.ref, target: b.ref },
        meta: { token, value: a.value, refs: holders.map((h) => h.ref), fields: holders.map((h) => h.field) },
      }),
    );
  }
  return out;
}

// Assemble every storage-model finding for a set.
export function lintStorageModel(set, opts = {}) {
  return [...lintFreeTextStructure(set), ...lintStructuredProse(set, opts), ...lintAssetAsNote(set), ...lintDuplicatedValues(set)];
}

// ---- check: service coverage ------------------------------------------------
// The known services IT-U documents, and the coverage each one should have. A
// requirement is satisfied by a typed link to a record of one of its
// collections; where the collection is `flexibleAssets` a `typeIds` list
// narrows it to the right template (a vendor link must not count as a circuit).
const VENDOR_TYPE_ID = "atype-vendor";
const APPLICATION_TYPE_ID = "atype-applications";

export const KNOWN_SERVICES = [
  {
    id: "voice",
    label: "Voice / PBX",
    typeId: VOICE_PBX_TYPE_ID,
    requires: [
      { id: "circuit", label: "internet/WAN circuit", collections: ["flexibleAssets"], typeIds: [WAN_CIRCUIT_TYPE_ID, WAN_SERVICE_TYPE_ID], hint: "Link the circuit the voice traffic is carried on." },
      { id: "credential", label: "credential", collections: ["passwords"], hint: "Add the platform's administrator credential and link it." },
      { id: "documentation", label: "supporting documentation", collections: ["documents", "runbooks", "checklists"], hint: "Link the deployment runbook or dial-plan documentation." },
    ],
  },
  {
    id: "wan-service",
    label: "Internet / WAN service",
    typeId: WAN_SERVICE_TYPE_ID,
    requires: [
      { id: "circuit", label: "circuit record", collections: ["flexibleAssets"], typeIds: [WAN_CIRCUIT_TYPE_ID], hint: "Link the circuit that carries the service." },
      { id: "vendor", label: "carrier or vendor", collections: ["flexibleAssets"], typeIds: [VENDOR_TYPE_ID], hint: "Link the carrier or vendor the service is held with." },
    ],
  },
  {
    id: "wan-circuit",
    label: "Internet circuit",
    typeId: WAN_CIRCUIT_TYPE_ID,
    requires: [
      { id: "upstream", label: "upstream provider", collections: ["flexibleAssets"], typeIds: [VENDOR_TYPE_ID], hint: "Link the wholesale provider the circuit is bought from." },
      { id: "configuration", label: "configurations", collections: ["configurations"], hint: "Record and link the CPE and any network devices on the circuit." },
    ],
  },
  {
    id: "email",
    label: "Email system",
    typeId: EMAIL_SYSTEM_TYPE_ID,
    requires: [
      { id: "application", label: "application", collections: ["flexibleAssets"], typeIds: [APPLICATION_TYPE_ID], hint: "Link the mail platform's application record." },
      { id: "vendor", label: "vendor", collections: ["flexibleAssets"], typeIds: [VENDOR_TYPE_ID], hint: "Link the supplier the mail service is held with." },
    ],
  },
  {
    id: "backup",
    label: "Backup service",
    typeId: BACKUP_SERVICE_TYPE_ID,
    requires: [
      { id: "application", label: "application", collections: ["flexibleAssets"], typeIds: [APPLICATION_TYPE_ID], hint: "Link the backup platform's application record." },
      { id: "credential", label: "credential", collections: ["passwords"], hint: "Add and link the backup console credential." },
    ],
  },
];

export const knownService = (id) => KNOWN_SERVICES.find((s) => s.id === id) || null;

const SURFACE_COLLECTIONS = ["configurations", "passwords", "documents", "runbooks", "checklists"];

function requirementSatisfied(req, linked) {
  return linked.some((record) => {
    if (!req.collections.includes(record.type)) return false;
    if (!req.typeIds || record.type !== "flexibleAssets") return true;
    return req.typeIds.includes(record.assetTypeId);
  });
}

export function lintServiceCoverage(set) {
  const out = [];
  if (!set || !set.records) return out;
  const links = relationshipIndex(set);
  const byKey = new Map();
  for (const type of RECORD_TYPES) for (const r of set.records[type] || []) byKey.set(refKey(refOf(r, type)), r);
  const linkedRecords = (ref) => linksFor(links, ref).map((l) => byKey.get(refKey(l.other))).filter(Boolean);
  for (const svc of KNOWN_SERVICES) {
    for (const r of (set.records.flexibleAssets || []).filter((x) => x.assetTypeId === svc.typeId)) {
      const ref = refOf(r, "flexibleAssets");
      const linked = linkedRecords(ref);
      if (!linked.length) {
        out.push(
          makeFinding({
            check: "service-coverage",
            code: "service-unlinked",
            severity: "warning",
            ref,
            message: `${svc.label} “${r.name}” has no relationships — nothing links to this service.`,
            suggestion: "Link the service to the devices, credentials and documentation that make it up, and to the vendor it is held with.",
            fix: { kind: "link-records", ref },
            meta: { service: svc.id },
          }),
        );
        continue;
      }
      const collections = new Set(linked.map((x) => x.type));
      if (!SURFACE_COLLECTIONS.some((c) => collections.has(c))) {
        out.push(
          makeFinding({
            check: "service-coverage",
            code: "service-no-surface",
            severity: "warning",
            ref,
            message: `${svc.label} “${r.name}” is linked, but none of its devices, credentials or documentation are.`,
            suggestion: "Link the configurations, credentials and documents that make up this service.",
            fix: { kind: "link-records", ref },
            meta: { service: svc.id },
          }),
        );
      }
      for (const req of svc.requires) {
        if (requirementSatisfied(req, linked)) continue;
        out.push(
          makeFinding({
            check: "service-coverage",
            code: "service-missing-coverage",
            severity: "info",
            ref,
            message: `${svc.label} “${r.name}” has no linked ${req.label}.`,
            suggestion: req.hint || `Link ${req.label}.`,
            fix: { kind: "link-records", ref, requirement: req.id },
            meta: { service: svc.id, requirement: req.id },
          }),
        );
      }
    }
  }
  return out;
}

// ---- check: expired / imminent expiry ---------------------------------------
export function lintExpiryAttention(set, opts = {}) {
  const out = [];
  if (!set || !set.records) return out;
  const rollup = collectLifecycle(set, { now: opts.now, typeOf: opts.typeOf, config: opts.lifecycleConfig });
  for (const item of rollup.attention) {
    const ref = { type: item.source.type, id: item.source.id, name: item.sourceName };
    const severity = item.state === "overdue" ? "error" : item.state === "due-soon" ? "warning" : "info";
    out.push(
      makeFinding({
        check: "expiry-attention",
        code: "expiry-" + item.state,
        severity,
        ref,
        message: `${item.title} for ${typeLabel(item.source.type)} “${item.sourceName}” — ${item.label}.`,
        detail: [item.fieldLabel, item.iso].filter(Boolean).join(" · "),
        suggestion: "Renew, replace or re-date the item, then update the record so the tracker is accurate.",
        fix: { kind: "open-record", ref },
        meta: { kind: item.kind, state: item.state, daysUntil: item.daysUntil, date: item.iso },
      }),
    );
  }
  for (const item of rollup.undated) {
    const ref = { type: item.source.type, id: item.source.id, name: item.sourceName };
    out.push(
      makeFinding({
        check: "expiry-attention",
        code: "expiry-undated",
        severity: "info",
        ref,
        message: `${typeLabel(item.source.type)} “${item.sourceName}” has no ${String(item.fieldLabel || item.title).toLowerCase()} recorded.`,
        suggestion: "Record the expiry date so the lifecycle tracker can watch it.",
        fix: { kind: "open-record", ref },
        meta: { kind: item.kind, undated: true },
      }),
    );
  }
  return out;
}

// ---- check: stale records ---------------------------------------------------
export const DEFAULT_STALE_DAYS = 540;

export function lintStaleRecords(set, opts = {}) {
  const out = [];
  if (!set || !set.records) return out;
  const now = opts.now != null ? opts.now : Date.now();
  const staleDays = opts.staleDays != null ? opts.staleDays : DEFAULT_STALE_DAYS;
  const cutoff = now - staleDays * 86400000;
  for (const type of RECORD_TYPES) {
    if (type === "relationships") continue;
    for (const r of set.records[type] || []) {
      const ts = r.updatedAt || r.createdAt;
      if (!ts || ts > cutoff) continue;
      const days = Math.round((now - ts) / 86400000);
      out.push(
        makeFinding({
          check: "stale-records",
          code: "stale-record",
          severity: "info",
          ref: refOf(r, type),
          message: `${typeLabel(type)} “${r.name}” has not been updated in ${days} day${days === 1 ? "" : "s"}.`,
          suggestion: "Review the record and confirm it is still accurate.",
          fix: { kind: "open-record", ref: refOf(r, type) },
          meta: { days, updatedAt: ts, staleDays },
        }),
      );
    }
  }
  return out;
}

// ---- assembly ---------------------------------------------------------------
export function summarizeLint(set, findings, { generatedAt = Date.now() } = {}) {
  const sorted = [...findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      String(a.check).localeCompare(String(b.check)) ||
      String(a.recordName || "").localeCompare(String(b.recordName || "")),
  );
  const bySeverity = { error: 0, warning: 0, info: 0 };
  const byCheck = {};
  for (const f of sorted) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCheck[f.check] = (byCheck[f.check] || 0) + 1;
  }
  const map = new Map();
  for (const f of sorted) {
    if (!f.ref) continue;
    const k = refKey(f.ref);
    if (!map.has(k)) map.set(k, { ref: f.ref, name: f.recordName, type: f.recordType, findings: [], worst: "info" });
    const group = map.get(k);
    group.findings.push(f);
    if (severityRank(f.severity) < severityRank(group.worst)) group.worst = f.severity;
  }
  const byRecord = [...map.values()].sort(
    (a, b) => severityRank(a.worst) - severityRank(b.worst) || String(a.name || "").localeCompare(String(b.name || "")),
  );
  return {
    set: set ? { id: set.id, name: set.name } : null,
    generatedAt,
    checks: LINT_CHECKS.map((c) => ({ ...c, count: byCheck[c.id] || 0 })),
    findings: sorted,
    counts: { ...bySeverity, total: sorted.length },
    bySeverity,
    byCheck,
    byRecord,
    ok: bySeverity.error === 0,
    clean: sorted.length === 0,
  };
}

// Lint one documentation set. `opts.typeOf` resolves a flexible asset's template
// (for the asset-expiry lifecycle kind); `opts.now`, `opts.staleDays` and
// `opts.lifecycleConfig` tune the audit.
export function lintDocumentationSet(set, opts = {}) {
  const generatedAt = opts.now != null ? opts.now : Date.now();
  const findings = [
    ...lintConfigurationCompleteness(set),
    ...lintServiceCoverage(set),
    ...lintDocumentDuplication(set),
    ...lintStorageModel(set, { typeOf: opts.typeOf }),
    ...lintExpiryAttention(set, { now: generatedAt, typeOf: opts.typeOf, lifecycleConfig: opts.lifecycleConfig }),
    ...lintOrphanRecords(set),
    ...lintStaleRecords(set, { now: generatedAt, staleDays: opts.staleDays }),
  ];
  return summarizeLint(set, findings, { generatedAt });
}

// Lint several sets (all clients) and merge. Each finding keeps its own set id.
export function lintAllSets(sets, opts = {}) {
  const generatedAt = opts.now != null ? opts.now : Date.now();
  const results = [];
  for (const set of sets || []) results.push(lintDocumentationSet(set, { ...opts, now: generatedAt }));
  const findings = results.flatMap((r, i) => r.findings.map((f) => ({ ...f, setId: (sets[i] && sets[i].id) || null })));
  const merged = summarizeLint(null, findings, { generatedAt });
  merged.sets = results.map((r) => ({ set: r.set, counts: r.counts, ok: r.ok, clean: r.clean }));
  return merged;
}
