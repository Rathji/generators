// src/framework/linterReport.js — the saved and exported linter report
// (roadmap task 48).
//
// `summarizeLint` (./linter.js) produces the machine-readable audit; this module
// turns it into the human artifact: a report grouped BY SEVERITY, with the
// client, the record and the check each finding concerns, ready to save or
// export. The report is deliberately built from the finding messages and
// suggested fixes only — the linter never collects credential secrets — so a
// report is safe to hand to a client or publish.
//
//   buildLintReport(result, { sets, title, generatedAt, notes }) → report object
//   reportToMarkdown(report)            → the report as Markdown text
//   reportToCsv(report)                 → the report as CSV rows
//   reportFilename(report, extension)   → a tidy file name
//   reportSummaryLine(report)           → one-line summary for a toast

import { LINT_CHECKS, LINT_SEVERITIES } from "./linter.js";
import { RECORD_TYPE_META } from "./docsets.js";

export const LINT_REPORT_SCHEMA = "itu-lint-report/1";

const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).singular || t;
const checkLabel = (id) => (LINT_CHECKS.find((c) => c.id === id) || {}).label || id;

// Turn a `lintAllSets` (or `lintDocumentationSet`) result into a severity-grouped
// report. `sets` supplies the client names; findings tagged with a `setId` that
// is not in `sets` fall back to the id.
export function buildLintReport(result, { sets = [], title = "IT-U documentation linter report", generatedAt, notes = "" } = {}) {
  const at = generatedAt != null ? generatedAt : (result && result.generatedAt) || Date.now();
  const byId = new Map((sets || []).map((s) => [s.id, s]));
  const nameOf = (id) => {
    if (!id) return "—";
    const s = byId.get(id);
    return s ? s.name || s.id : id;
  };
  const findings = (result && result.findings) || [];
  const sections = [];
  for (const sev of LINT_SEVERITIES) {
    const rows = findings
      .filter((f) => f.severity === sev.id)
      .map((f) => ({
        setId: f.setId || null,
        client: nameOf(f.setId),
        check: f.check,
        checkLabel: checkLabel(f.check),
        code: f.code,
        recordName: f.recordName || (f.ref && f.ref.name) || "—",
        recordType: f.recordType || (f.ref && f.ref.type) || null,
        recordTypeLabel: typeLabel(f.recordType || (f.ref && f.ref.type)),
        message: f.message || "",
        suggestion: f.suggestion || "",
      }));
    if (rows.length) sections.push({ severity: sev.id, label: sev.label, tone: sev.tone, count: rows.length, rows });
  }
  const totals = result && result.counts ? { ...result.counts } : { error: 0, warning: 0, info: 0, total: findings.length };
  return {
    schema: LINT_REPORT_SCHEMA,
    title,
    generatedAt: at,
    notes: notes || "",
    totals,
    clients: (sets || []).map((s) => ({ id: s.id, name: s.name || s.id, findings: findings.filter((f) => f.setId === s.id).length })),
    checks: LINT_CHECKS.map((c) => ({ id: c.id, label: c.label, count: findings.filter((f) => f.check === c.id).length })).filter((c) => c.count > 0),
    sections,
    ok: !findings.some((f) => f.severity === "error"),
    rowCount: findings.length,
  };
}

const fmtDate = (ts) => {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts || "");
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
};

// One-line summary: "12 findings — 1 error, 9 warnings, 2 notices".
export function reportSummaryLine(report) {
  const t = (report && report.totals) || {};
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  return (
    plural(t.total || 0, "finding") +
    " — " + plural(t.error || 0, "error") +
    ", " + plural(t.warning || 0, "warning") +
    ", " + plural(t.info || 0, "notice")
  );
}

export function reportToMarkdown(report) {
  const r = report || {};
  const lines = [];
  lines.push("# " + (r.title || "Linter report"));
  lines.push("");
  lines.push("_" + fmtDate(r.generatedAt) + " · " + reportSummaryLine(r) + "_");
  if (r.notes) {
    lines.push("");
    lines.push(r.notes);
  }
  if (r.clients && r.clients.length) {
    lines.push("");
    lines.push("**Clients:** " + r.clients.map((c) => c.name + " (" + c.findings + ")").join(", "));
  }
  lines.push("");
  for (const section of r.sections || []) {
    lines.push("## " + section.label + " (" + section.count + ")");
    lines.push("");
    let lastClient = null;
    for (const row of section.rows) {
      if (row.client !== lastClient) {
        lines.push("### " + row.client);
        lines.push("");
        lastClient = row.client;
      }
      lines.push("- **" + row.recordName + "** (" + row.recordTypeLabel + ") — " + row.checkLabel);
      lines.push("  - " + row.message);
      if (row.suggestion) lines.push("  - _Suggested fix:_ " + row.suggestion);
    }
    lines.push("");
  }
  if (!(r.sections || []).length) lines.push("No findings — the documentation is clean.");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function reportToCsv(report) {
  const r = report || {};
  const rows = [["Severity", "Client", "Check", "Record", "Type", "Finding", "Suggested fix"]];
  for (const section of r.sections || []) {
    for (const row of section.rows) {
      rows.push([section.label, row.client, row.checkLabel, row.recordName, row.recordTypeLabel, row.message, row.suggestion]);
    }
  }
  return rows;
}

export function reportFilename(report, extension = "md") {
  const r = report || {};
  const stamp = new Date(r.generatedAt || Date.now()).toISOString().slice(0, 10);
  return "itu-linter-report-" + stamp + "." + extension;
}
