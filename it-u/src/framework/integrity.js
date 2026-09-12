// src/framework/integrity.js — the integrity-check suite (roadmap task 52).
//
// Task 52 asks for automated integrity checks, run together, over any
// documentation set:
//
//   • classification    — every record carries an information-model and a
//                         provenance classification (task 3's guarantee);
//   • relationships     — every relationship target exists, and reads
//                         consistently from BOTH ends (task 4's guarantee);
//   • required-fields   — every record satisfies its type's required-field rule
//                         set (tasks 7–10's guarantee);
//   • orphans           — no record is stranded outside the relationship graph;
//   • credentials       — no credential secret leaks into a non-credential
//                         export, even when the operator opts into credential
//                         summaries (task 49's default-deny guarantee);
//   • exports           — every export (bundle + packet) parses and validates.
//
// The suite reuses the existing pure engines — validateClassification,
// checkIntegrity, validateRecordFields, lintOrphanRecords, the publication and
// packet builders — rather than re-implementing them, so there is ONE definition
// of each rule. It never throws: a check that itself fails is reported as a
// failed check, so an audit always produces a report. `ok` is true when no check
// reported an error-level finding (warnings do not fail the suite).
//
// The companion module `fixtures.js` ships fixture documentation sets covering
// all four information models, the integration-managed and imported cases, and
// an older schema — the suite is expected to PASS the good fixtures and to CATCH
// the deliberate gaps in the legacy one.

import { CLASSIFIED_TYPES, RECORD_TYPE_META } from "./docsets.js";
import { validateClassification } from "./classification.js";
import { checkIntegrity, relationsOf } from "./relationships.js";
import { validateRecordFields } from "./standardized.js";
import { lintOrphanRecords } from "./linter.js";
import {
  buildDocumentationBundle,
  buildDeploymentBundle,
  validatePublication,
  findLeakedSecrets,
  serializePublication,
} from "./publication.js";
import {
  buildDocumentationPacket,
  buildDeploymentPacket,
  packetToMarkdown,
  packetToHtml,
  packetToStandaloneHtml,
} from "./packet.js";
import { SECRET_FIELDS } from "./password.js";

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const typeLabel = (t) => (RECORD_TYPE_META[t] && RECORD_TYPE_META[t].singular) || t;

// The checks the suite runs, in report order.
export const INTEGRITY_CHECKS = [
  { id: "classification", label: "Classification", description: "Every record carries an information-model and a provenance classification." },
  { id: "relationships", label: "Relationships", description: "Every relationship target exists and reads consistently from both ends." },
  { id: "required-fields", label: "Required fields", description: "Every record satisfies its type's required-field rule set." },
  { id: "orphans", label: "Orphan records", description: "No record is stranded outside the relationship graph." },
  { id: "credentials", label: "Credential safety", description: "No credential secret leaks into a non-credential export." },
  { id: "exports", label: "Export parsing", description: "Every export (bundle and packet) parses and validates." },
];

export const INTEGRITY_CHECK_IDS = INTEGRITY_CHECKS.map((c) => c.id);
export const integrityCheck = (id) => INTEGRITY_CHECKS.find((c) => c.id === id) || null;

function finding(check, level, code, message, extra = {}) {
  return { check, level, code, message, ...extra };
}

function eachRecord(set, fn) {
  if (!set || !isObj(set.records)) return;
  for (const type of CLASSIFIED_TYPES) {
    for (const record of set.records[type] || []) fn(type, record);
  }
}

// ---- check: classification --------------------------------------------------
export function integrityClassification(set) {
  const out = [];
  eachRecord(set, (type, record) => {
    const { ok, errors } = validateClassification(record);
    if (ok) return;
    for (const message of errors) {
      out.push(finding("classification", "error", "unclassified-record", `${typeLabel(type)} “${record.name || record.id}” — ${message}`, { recordId: record.id, collection: type }));
    }
  });
  return out;
}

// ---- check: relationships ---------------------------------------------------
export function integrityRelationships(set) {
  const out = [];
  const graph = checkIntegrity(set);
  for (const issue of graph.issues) {
    out.push(finding("relationships", "error", issue.code, issue.message, { relationshipId: issue.relationshipId }));
  }
  const rels = (set && set.records && set.records.relationships) || [];
  for (const rel of rels) {
    if (!rel || !rel.from || !rel.to) continue;
    for (const side of ["from", "to"]) {
      const ref = rel[side];
      const found = relationsOf(set, ref).some((entry) => entry.relationship && entry.relationship.id === rel.id);
      if (!found) {
        out.push(
          finding("relationships", "error", "not-bidirectional", `Relationship ${rel.id} cannot be read back from its ${side === "from" ? "source" : "target"} record.`, { relationshipId: rel.id }),
        );
      }
    }
  }
  return out;
}

// ---- check: required fields -------------------------------------------------
export function integrityRequiredFields(set) {
  const out = [];
  eachRecord(set, (type, record) => {
    const { ok, errors } = validateRecordFields(type, record);
    if (ok) return;
    for (const message of errors) {
      out.push(finding("required-fields", "error", "missing-required-field", `${typeLabel(type)} “${record.name || record.id}” — ${message}`, { recordId: record.id, collection: type }));
    }
  });
  return out;
}

// ---- check: orphan records --------------------------------------------------
export function integrityOrphans(set) {
  return lintOrphanRecords(set).map((f) =>
    finding("orphans", "warning", f.code || "orphan-record", f.message, {
      recordId: f.ref && f.ref.id,
      collection: f.ref && f.ref.type,
      suggestion: f.suggestion,
    }),
  );
}

// ---- check: credential safety ----------------------------------------------
// The export must expose no credential secret under ANY redaction policy — not
// the default deny, and not even after the operator opts into credential
// summaries. We scan the built envelope and its serialization for secret fields
// and private-key material, and re-run the publication validator.
const INSPECT_POLICIES = [
  { label: "default-deny", policy: undefined },
  { label: "credential-summaries", policy: { credentialSummaries: true, credentialUsernames: true, embeddedCredentials: true, scrubSecrets: true } },
];

export function integrityCredentials(set) {
  const out = [];
  for (const { label, policy } of INSPECT_POLICIES) {
    let bundle;
    try {
      bundle = buildDocumentationBundle(set, { policy });
    } catch (e) {
      out.push(finding("credentials", "error", "export-build-failed", `The ${label} documentation export could not be built — ${String((e && e.message) || e)}`));
      continue;
    }
    for (const leak of findLeakedSecrets(bundle)) {
      out.push(finding("credentials", "error", "credential-leak", `Secret material (${leak.reason}) leaked into the ${label} export at ${leak.path}.`, { path: leak.path, reason: leak.reason, policy: label }));
    }
    const passwords = (bundle.records && bundle.records.passwords) || [];
    for (const record of passwords) {
      for (const field of SECRET_FIELDS) {
        if (record[field] != null && record[field] !== "") {
          out.push(finding("credentials", "error", "credential-leak", `A credential's “${field}” field reached the ${label} export.`, { recordId: record.id, field, policy: label }));
        }
      }
    }
    const validation = validatePublication(serializePublication(bundle));
    if (!validation.ok) {
      out.push(finding("credentials", "error", "export-refused", `The ${label} export failed validation — ${validation.errors[0] || "unknown reason"}.`, { policy: label }));
    }
  }
  return out;
}

// ---- check: export parsing --------------------------------------------------
// Every export the app can produce must be constructible, string-producible and
// round-trip parseable. A documentation packet always exists; a deployment
// packet is built only when the set has a runbook or checklist to scope.
function packetScopes(set) {
  const runbooks = ((set && set.records && set.records.runbooks) || []).filter(Boolean);
  const checklists = ((set && set.records && set.records.checklists) || []).filter(Boolean);
  const scopes = [];
  if (runbooks[0]) scopes.push({ label: "runbook", opts: { runbookIds: [runbooks[0].id] } });
  else if (checklists[0]) scopes.push({ label: "checklist", opts: { checklistIds: [checklists[0].id] } });
  return scopes;
}

export function integrityExports(set) {
  const out = [];
  const fail = (code, message) => out.push(finding("exports", "error", code, message));

  const checkParses = (value, what) => {
    try {
      JSON.parse(JSON.stringify(value));
      return true;
    } catch (e) {
      fail("export-unparsable", `${what} is not JSON-serializable — ${String((e && e.message) || e)}`);
      return false;
    }
  };
  const checkString = (value, what) => {
    if (typeof value !== "string" || !value.trim()) {
      fail("export-empty", `${what} produced no text.`);
      return false;
    }
    return true;
  };

  // 1. the raw documentation bundle (serialize → parse → validate).
  let bundle;
  try {
    bundle = buildDocumentationBundle(set);
    if (checkParses(bundle, "The documentation bundle")) {
      const text = serializePublication(bundle);
      try {
        const round = JSON.parse(text);
        if (!isObj(round)) fail("export-unparsable", "The documentation bundle did not round-trip to an object.");
        const validation = validatePublication(text);
        if (!validation.ok) fail("export-invalid", `The documentation bundle failed validation — ${validation.errors[0] || "unknown reason"}.`);
      } catch (e) {
        fail("export-unparsable", `The serialized documentation bundle did not parse — ${String((e && e.message) || e)}`);
      }
    }
  } catch (e) {
    fail("export-build-failed", `The documentation bundle could not be built — ${String((e && e.message) || e)}`);
  }

  // 2. the printable documentation packet (markdown + html + standalone html).
  try {
    const packet = buildDocumentationPacket(set);
    if (checkParses(packet, "The documentation packet")) {
      checkString(packetToMarkdown(packet), "The documentation packet's markdown");
      const html = packetToHtml(packet);
      if (!isObj(html) || typeof html.html !== "string") fail("export-empty", "The documentation packet's HTML render produced no markup.");
      const standalone = packetToStandaloneHtml(packet);
      if (checkString(standalone, "The standalone print view") && !/<\/html>\s*$/i.test(standalone)) {
        fail("export-incomplete", "The standalone print view is not a complete HTML document.");
      }
    }
  } catch (e) {
    fail("export-build-failed", `The documentation packet could not be built — ${String((e && e.message) || e)}`);
  }

  // 3. a deployment bundle + packet per available scope.
  for (const scope of packetScopes(set)) {
    try {
      const dep = buildDeploymentBundle(set, scope.opts);
      if (checkParses(dep, `The ${scope.label} deployment bundle`)) {
        const validation = validatePublication(serializePublication(dep));
        if (!validation.ok) fail("export-invalid", `The ${scope.label} deployment bundle failed validation — ${validation.errors[0] || "unknown reason"}.`);
      }
    } catch (e) {
      fail("export-build-failed", `The ${scope.label} deployment bundle could not be built — ${String((e && e.message) || e)}`);
    }
    try {
      const dPacket = buildDeploymentPacket(set, scope.opts);
      checkString(packetToMarkdown(dPacket), `The ${scope.label} deployment packet's markdown`);
    } catch (e) {
      fail("export-build-failed", `The ${scope.label} deployment packet could not be built — ${String((e && e.message) || e)}`);
    }
  }

  return out;
}

// A dispatcher so a caller can run one check by id.
export const INTEGRITY_RUNNERS = {
  classification: integrityClassification,
  relationships: integrityRelationships,
  "required-fields": integrityRequiredFields,
  orphans: integrityOrphans,
  credentials: integrityCredentials,
  exports: integrityExports,
};

// ---- the suite --------------------------------------------------------------
// Run every check over one set. Never throws: a check that throws is recorded
// as a failed check with its error. Returns a report object.
export function runIntegritySuite(set, opts = {}) {
  const generatedAt = opts.now != null ? opts.now : Date.now();
  const findings = [];
  const checks = INTEGRITY_CHECKS.map((def) => {
    let checkFindings = [];
    let error = null;
    try {
      const runner = INTEGRITY_RUNNERS[def.id];
      checkFindings = runner(set, opts) || [];
    } catch (e) {
      error = String((e && e.message) || e);
    }
    for (const f of checkFindings) findings.push({ ...f, check: def.id });
    const errors = checkFindings.filter((f) => f.level === "error").length;
    const warnings = checkFindings.filter((f) => f.level !== "error").length;
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      status: error ? "error" : errors ? "fail" : warnings ? "warn" : "pass",
      errors,
      warnings,
      count: checkFindings.length,
      error,
      findings: checkFindings,
    };
  });
  const errorCount = findings.filter((f) => f.level === "error").length;
  const warningCount = findings.length - errorCount;
  const checkErrors = checks.filter((c) => c.status === "error").length;
  return {
    setId: set && set.id ? set.id : null,
    client: set && set.name ? set.name : (set && set.id) || null,
    schema: set && set.schema ? set.schema : null,
    generatedAt,
    ok: errorCount === 0 && checkErrors === 0,
    checks,
    findings,
    counts: {
      records: set ? CLASSIFIED_TYPES.reduce((n, t) => n + ((set.records && set.records[t]) || []).length, 0) : 0,
      relationships: (set && set.records && set.records.relationships ? set.records.relationships.length : 0),
      checks: checks.length,
      passed: checks.filter((c) => c.status === "pass").length,
      warned: checks.filter((c) => c.status === "warn").length,
      failed: checks.filter((c) => c.status === "fail" || c.status === "error").length,
      errors: errorCount,
      warnings: warningCount,
    },
  };
}

// Run the suite over many sets (one report per set, plus a rolled-up summary).
export function runIntegritySuiteAll(sets, opts = {}) {
  const list = Array.isArray(sets) ? sets : [];
  const reports = list.map((set) => runIntegritySuite(set, opts));
  const failing = reports.filter((r) => !r.ok);
  return {
    generatedAt: opts.now != null ? opts.now : Date.now(),
    reports,
    summary: {
      sets: reports.length,
      ok: failing.length === 0,
      clean: reports.filter((r) => r.ok && r.counts.warnings === 0).length,
      failing: failing.length,
      errors: reports.reduce((n, r) => n + r.counts.errors, 0),
      warnings: reports.reduce((n, r) => n + r.counts.warnings, 0),
    },
  };
}

export function integrityStatusLabel(status) {
  return { pass: "Passed", warn: "Warnings", fail: "Failed", error: "Check error" }[status] || status;
}

// A compact verdict line for a single set's report.
export function integritySummaryLine(report) {
  if (!report) return "No report.";
  const c = report.counts;
  const name = report.client || report.setId || "Set";
  return `${name}: ${report.ok ? "passed" : "failed"} — ${c.passed}/${c.checks} checks clean, ${c.errors} error(s), ${c.warnings} warning(s).`;
}

// Render a whole multi-set audit to markdown (a downloadable artifact).
export function integrityReportToMarkdown(audit) {
  const lines = [];
  lines.push("# Integrity audit");
  lines.push("");
  lines.push(`Generated ${new Date(audit.generatedAt).toISOString()}.`);
  lines.push("");
  lines.push(`**${audit.summary.sets} set(s) checked — ${audit.summary.ok ? "all passed" : audit.summary.failing + " failing"}, ${audit.summary.errors} error(s), ${audit.summary.warnings} warning(s).**`);
  for (const report of audit.reports) {
    lines.push("", `## ${report.client || report.setId}`, "", integritySummaryLine(report));
    const flagged = report.checks.filter((c) => c.status !== "pass");
    if (!flagged.length) {
      lines.push("", "All checks passed.");
      continue;
    }
    for (const check of flagged) {
      lines.push("", `### ${check.label} — ${integrityStatusLabel(check.status)}${check.error ? ` (${check.error})` : ""}`);
      if (check.error) continue;
      for (const f of check.findings.slice(0, 50)) lines.push(`- ${f.level === "error" ? "**error**" : "warning"} — ${f.message}`);
      if (check.findings.length > 50) lines.push(`- …and ${check.findings.length - 50} more.`);
    }
  }
  return lines.join("\n") + "\n";
}
