// src/framework/document.js — long-form documents, SOPs & deployment
// procedures (roadmap Phase 5, tasks 21–22).
//
// A DOCUMENT is a standardized record holding narrative or procedural content
// as markdown, plus the governance metadata the roadmap asks for: a document
// TYPE, a summary, tags, a review interval and the date it was last reviewed.
// Documents are versioned INDEPENDENTLY of the rest of the set — every save
// appends a revision — and can be linked to the organizations, assets, services
// and locations they concern.
//
//   • TASK 21 — document authoring: the eight document types a TSP writes
//     (installation procedures, troubleshooting guides, help-desk instructions,
//     recovery procedures, operational notes, client-specific technical
//     documentation, public-facing instructions, reference material), each with
//     a seeded template, and the rule that a PROCEDURE a client must follow
//     becomes a checklist where a checklist fits better than prose. That rule is
//     `checklistSuitability` + `extractProcedureSteps` — IT-U reads the body,
//     finds the ordered steps, and offers to turn them into a real checklist.
//   • TASK 22 — SOPs & deployment instructions: the two STANDARD procedure
//     types (`sop`, `deployment`), which require a body, carry a review date,
//     and are meant to be linked to the assets and services they concern and
//     versioned independently.
//
// This module is pure data + pure functions; the stateful authoring/versioning
// flow lives in ./docsets.js (`addDocument`, `saveDocument`,
// `documentRevisions`, `restoreDocumentRevision`, `markDocumentReviewed`,
// `documentToChecklist`), and the editor is modules/document-view.js.

import { StoreError, CODES } from "./store/errors.js";

// `group` is the section the type is shown under; `reviewIntervalDays` is the
// sensible default review cadence (null = no scheduled review); `checklistProne`
// says a document of this type is normally followed step by step.
export const DOCUMENT_TYPES = [
  {
    id: "installation-procedure",
    label: "Installation procedure",
    group: "Procedures",
    icon: "rocket",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "The ordered steps to install, build or configure a system.",
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting guide",
    group: "Procedures",
    icon: "alert",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "Symptoms, likely causes and the fix.",
  },
  {
    id: "help-desk",
    label: "Help-desk instructions",
    group: "Procedures",
    icon: "chat",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "What the first line does when a call comes in.",
  },
  {
    id: "recovery",
    label: "Recovery procedure",
    group: "Procedures",
    icon: "history",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "How service is restored after a failure.",
  },
  {
    id: "operational-notes",
    label: "Operational notes",
    group: "Reference",
    icon: "article",
    reviewIntervalDays: 540,
    checklistProne: false,
    description: "Day-to-day notes that do not belong in a structured record.",
  },
  {
    id: "client-technical",
    label: "Client technical documentation",
    group: "Reference",
    icon: "server",
    reviewIntervalDays: 365,
    checklistProne: false,
    description: "A client-specific explanation of their environment.",
  },
  {
    id: "public-instruction",
    label: "Public-facing instructions",
    group: "Client-facing",
    icon: "eye",
    reviewIntervalDays: 540,
    checklistProne: false,
    description: "Instructions a client's staff can follow unaided.",
  },
  {
    id: "reference",
    label: "Reference material",
    group: "Reference",
    icon: "browse",
    reviewIntervalDays: null,
    checklistProne: false,
    description: "Background that is read, not followed.",
  },
  {
    id: "sop",
    label: "Standard operating procedure",
    group: "Standard procedures",
    icon: "clipboard",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "A procedure the provider follows the same way every time.",
  },
  {
    id: "deployment",
    label: "Deployment procedure",
    group: "Standard procedures",
    icon: "rocket",
    reviewIntervalDays: 365,
    checklistProne: true,
    description: "The ordered steps to deploy a service, system or site.",
  },
];

// The two STANDARD procedure types (task 22). They demand a body and carry a
// review date; `isSopDoc` is the predicate the rest of the app uses.
export const SOP_TYPES = ["sop", "deployment"];
export const isSopDoc = (record) => !!(record && SOP_TYPES.includes(record.docType));

export const DOCUMENT_GROUPS = ["Procedures", "Standard procedures", "Reference", "Client-facing"];

export const documentType = (id) => DOCUMENT_TYPES.find((d) => d.id === id) || null;
export const documentTypeLabel = (id) => (documentType(id) || {}).label || id;
export const documentsOfGroup = (group) => DOCUMENT_TYPES.filter((d) => d.group === group);

export const DOCUMENT_FIELDS = [
  { key: "docType", label: "Document type", type: "select", options: DOCUMENT_TYPES, required: true, default: "reference" },
  { key: "summary", label: "Summary", type: "text", placeholder: "One line saying what this document is for" },
  { key: "body", label: "Body", type: "textarea", placeholder: "# Heading\n\nWrite in markdown — headings, lists, tables and code are all rendered." },
  { key: "tags", label: "Tags", type: "tags", placeholder: "comma, separated, words" },
  { key: "reviewIntervalDays", label: "Review every (days)", type: "number", placeholder: "365" },
  { key: "reviewedAt", label: "Last reviewed", type: "date" },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// ---- seeded templates (task 21) -------------------------------------------
// Every type ships a skeleton so a new document starts structured rather than
// blank. The body is markdown; the ordered lists are what `extractProcedureSteps`
// turns into a checklist.
export const DOCUMENT_TEMPLATES = {
  "installation-procedure": {
    summary: "How to install and verify the system.",
    body: [
      "# Installation procedure",
      "",
      "## Overview",
      "",
      "Describe what is being installed and where.",
      "",
      "## Prerequisites",
      "",
      "- Access and permissions required",
      "- Parts, licences or connectivity required",
      "",
      "## Steps",
      "",
      "1. Confirm the prerequisites above are met.",
      "2. Install the system.",
      "3. Apply the standard configuration.",
      "",
      "## Verification",
      "",
      "1. Confirm the system is reachable and operating.",
      "2. Update the client's documentation.",
      "",
      "## Rollback",
      "",
      "1. Describe how to undo the installation.",
    ].join("\n"),
  },
  troubleshooting: {
    summary: "Symptoms, causes and the fix.",
    body: [
      "# Troubleshooting guide",
      "",
      "## Symptoms",
      "",
      "What the user reports.",
      "",
      "## Diagnosis",
      "",
      "1. Check the obvious first.",
      "2. Narrow the cause.",
      "",
      "## Resolution",
      "",
      "1. Apply the fix.",
      "2. Verify the service works.",
      "",
      "## Prevention",
      "",
      "What would stop this recurring.",
    ].join("\n"),
  },
  "help-desk": {
    summary: "What the first line does when this call comes in.",
    body: [
      "# Help-desk instructions",
      "",
      "## When this applies",
      "",
      "The call this covers.",
      "",
      "## Steps",
      "",
      "1. Record the caller and the issue.",
      "2. Perform the first-line checks.",
      "3. Resolve or escalate.",
      "",
      "## Escalate when",
      "",
      "- The checks above do not resolve it.",
    ].join("\n"),
  },
  recovery: {
    summary: "How service is restored after a failure.",
    body: [
      "# Recovery procedure",
      "",
      "## Trigger",
      "",
      "What failure this recovery answers.",
      "",
      "## Recovery steps",
      "",
      "1. Confirm the failure and its scope.",
      "2. Restore from the most recent good state.",
      "3. Bring the service back in a controlled order.",
      "",
      "## Validation",
      "",
      "1. Confirm the service is healthy.",
      "2. Confirm data is intact and current.",
      "",
      "## After the event",
      "",
      "What to record once service is restored.",
    ].join("\n"),
  },
  "operational-notes": {
    summary: "Day-to-day notes for this client.",
    body: ["# Operational notes", "", "## Notes", "", "- ", ""].join("\n"),
  },
  "client-technical": {
    summary: "A client-specific explanation of their environment.",
    body: [
      "# Client technical documentation",
      "",
      "## Environment",
      "",
      "The systems and services this client relies on.",
      "",
      "## How it fits together",
      "",
      "The relationships between them.",
      "",
      "## Key services and contacts",
      "",
      "- ",
    ].join("\n"),
  },
  "public-instruction": {
    summary: "Instructions a client's staff can follow unaided.",
    body: [
      "# Instructions",
      "",
      "## What you need",
      "",
      "- ",
      "",
      "## Steps",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## If something goes wrong",
      "",
      "Who to contact for help.",
    ].join("\n"),
  },
  reference: {
    summary: "Background reference material.",
    body: ["# Reference", "", "## Summary", "", "## Details", "", "- "].join("\n"),
  },
  sop: {
    summary: "A procedure the provider follows the same way every time.",
    body: [
      "# Standard operating procedure",
      "",
      "## Purpose",
      "",
      "Why this procedure exists.",
      "",
      "## Scope",
      "",
      "Where and when it applies.",
      "",
      "## Procedure",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## Roles",
      "",
      "Who is responsible for each step.",
      "",
      "## Review",
      "",
      "This procedure is reviewed every 12 months.",
    ].join("\n"),
  },
  deployment: {
    summary: "The ordered steps to deploy a service, system or site.",
    body: [
      "# Deployment procedure",
      "",
      "## Scope",
      "",
      "What this deployment delivers.",
      "",
      "## Prerequisites",
      "",
      "- ",
      "",
      "## Deployment steps",
      "",
      "1. ",
      "2. ",
      "3. ",
      "",
      "## Verification",
      "",
      "1. ",
      "",
      "## Rollback",
      "",
      "1. ",
      "",
      "## Review",
      "",
      "This procedure is reviewed every 12 months.",
    ].join("\n"),
  },
};

// The seeded template for a type (never null — unknown types fall back to
// reference material).
export function documentTemplate(docType) {
  const type = documentType(docType) || documentType("reference");
  const tpl = DOCUMENT_TEMPLATES[type.id] || DOCUMENT_TEMPLATES.reference;
  return { docType: type.id, summary: tpl.summary, body: tpl.body, reviewIntervalDays: type.reviewIntervalDays, checklistProne: type.checklistProne };
}

// ---- procedure extraction & the checklist rule (task 21) -------------------
// Read a markdown body and return its ordered steps. A body's numbered list is
// the canonical procedure; when there is none, the level-2/3 headings are used
// as the outline. Code fences are ignored.
export function extractProcedureSteps(body, opts = {}) {
  const min = opts.min != null ? opts.min : 2;
  const lines = String(body || "").replace(/\r\n?/g, "\n").split("\n");
  const numbered = [];
  const heads = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m && m[1].trim() && !/^\[\s*\]/.test(m[1].trim())) numbered.push(m[1].trim());
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h && h[2].trim()) heads.push(h[2].trim());
  }
  if (numbered.length >= min) return numbered;
  if (heads.length >= min) return heads;
  return numbered;
}

const PROCEDURE_WORDS = /\b(step|then|next|after that|finally|verify|confirm|ensure)\b/i;

// The task-21 rule: does this document read as prose that should really be a
// checklist? Returns a judgement with the reasons, so the editor can explain
// rather than silently nag.
export function checklistSuitability(record, opts = {}) {
  const minSteps = opts.minSteps != null ? opts.minSteps : 3;
  const type = documentType(record && record.docType);
  const body = (record && record.body) || "";
  const steps = extractProcedureSteps(body);
  const reasons = [];
  let score = 0;
  if (steps.length) {
    score += Math.min(steps.length, 10);
    reasons.push(`${steps.length} sequential step${steps.length === 1 ? "" : "s"} detected`);
  }
  if (type && type.checklistProne) {
    score += 2;
    reasons.push(`“${type.label}” is normally followed step by step`);
  }
  if (PROCEDURE_WORDS.test(body)) {
    score += 1;
    reasons.push("the wording is imperative (step / then / verify)");
  }
  const suited = steps.length >= minSteps || (!!(type && type.checklistProne) && steps.length >= 2);
  return { suited, score, steps, reasons, docType: type ? type.id : null };
}

// The steps as checklist items (the shape checklist.js builds on).
export function documentToChecklistItems(record) {
  return extractProcedureSteps((record && record.body) || "").map((text) => ({ text }));
}

// ---- review status (task 22) ----------------------------------------------
// How is this document's review cadence holding up? state: none | due | ok |
// due-soon | overdue.
export function documentReviewStatus(record, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const dueSoonDays = opts.dueSoonDays != null ? opts.dueSoonDays : 30;
  const type = documentType(record && record.docType);
  const interval = Number(record && record.reviewIntervalDays) || (type && type.reviewIntervalDays) || 0;
  const reviewedAt = (record && record.reviewedAt) || "";
  if (!interval) {
    return { state: "none", intervalDays: 0, reviewedAt, dueAt: null, daysUntil: null, label: "No review schedule" };
  }
  const reviewed = reviewedAt ? new Date(reviewedAt).getTime() : null;
  if (!reviewed || Number.isNaN(reviewed)) {
    return { state: "due", intervalDays: interval, reviewedAt, dueAt: null, daysUntil: null, label: "Never reviewed — due now" };
  }
  const due = reviewed + interval * 86400000;
  const daysUntil = Math.ceil((due - now) / 86400000);
  const state = daysUntil < 0 ? "overdue" : daysUntil <= dueSoonDays ? "due-soon" : "ok";
  const label =
    state === "overdue"
      ? `Review overdue by ${-daysUntil} day${-daysUntil === 1 ? "" : "s"}`
      : state === "due-soon"
        ? `Review due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
        : `Reviewed — next review in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;
  return { state, intervalDays: interval, reviewedAt, dueAt: new Date(due).toISOString().slice(0, 10), daysUntil, label };
}

// ---- validation -----------------------------------------------------------
export function validateDocument(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A document must be an object."] };
  const type = documentType(record.docType);
  if (!type) {
    errors.push(`A document must declare a document type (${DOCUMENT_TYPES.map((d) => d.id).join(", ")}).`);
  }
  if (type && SOP_TYPES.includes(type.id) && isBlank(record.body)) {
    errors.push(`A ${type.label.toLowerCase()} needs a body — the procedure itself.`);
  }
  if (!isBlank(record.reviewIntervalDays) && !(Number(record.reviewIntervalDays) > 0)) {
    errors.push("The review interval must be a positive number of days.");
  }
  if (record.tags != null && !Array.isArray(record.tags) && typeof record.tags !== "string") {
    errors.push("Tags must be a list or a comma-separated string.");
  }
  return { ok: errors.length === 0, errors };
}

export function requireDocument(record) {
  const { ok, errors } = validateDocument(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this document";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// ---- revisions ------------------------------------------------------------
export const DOCUMENT_HISTORY_MAX = 25;

export const documentRevision = (record) => Number(record && record.revision) || 1;

export function normalizeTags(tags) {
  if (Array.isArray(tags)) return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
  if (typeof tags === "string") return normalizeTags(tags.split(","));
  return [];
}

// A snapshot of a document's authored content at one revision.
export function makeDocumentRevision(record, { by = "system", now = Date.now() } = {}) {
  return {
    revision: documentRevision(record),
    savedAt: now,
    savedBy: by,
    docType: (record && record.docType) || "",
    summary: (record && record.summary) || "",
    body: (record && record.body) || "",
    tags: normalizeTags(record && record.tags),
    reviewIntervalDays: record && record.reviewIntervalDays != null ? record.reviewIntervalDays : null,
    reviewedAt: (record && record.reviewedAt) || "",
  };
}

// Every version of a document, oldest first, the current one flagged. The
// stored `revisions` are the PRIOR versions; the current revision is derived.
export function documentVersionList(record) {
  if (!record) return [];
  const history = Array.isArray(record.revisions) ? record.revisions : [];
  return [
    ...history.map((h) => ({ ...h, current: false })),
    { ...makeDocumentRevision(record, { by: record.updatedBy || "system", now: record.updatedAt || Date.now() }), current: true },
  ];
}

// ---- detail line & audit --------------------------------------------------
const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

export function documentDetailLine(record, set) {
  if (!record) return "";
  const type = documentType(record.docType);
  const review = documentReviewStatus(record);
  const bits = [type ? type.label : "Document", "v" + documentRevision(record)];
  const words = wordCount(record.body);
  if (words) bits.push(words + " word" + (words === 1 ? "" : "s"));
  bits.push(review.state === "none" ? "No review" : review.label);
  return bits.join(" · ");
}

export function documentIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.documents || []) {
    const type = documentType(r.docType);
    if (!type) {
      issues.push({ level: "error", code: "unknown-document-type", recordId: r.id, message: `Document “${r.name}” has an unknown document type “${r.docType}”.` });
      continue;
    }
    if (SOP_TYPES.includes(type.id) && isBlank(r.body)) {
      issues.push({ level: "error", code: "sop-missing-body", recordId: r.id, message: `${type.label} “${r.name}” has no body — the procedure itself is required.` });
    }
    const review = documentReviewStatus(r);
    if (review.state === "overdue") {
      issues.push({ level: "warning", code: "document-review-overdue", recordId: r.id, message: `Document “${r.name}” is ${review.label.toLowerCase()}.` });
    }
    const suit = checklistSuitability(r);
    if (type.checklistProne && !isBlank(r.body) && suit.steps.length < 2 && wordCount(r.body) > 60) {
      issues.push({
        level: "warning",
        code: "prose-could-be-checklist",
        recordId: r.id,
        message: `Document “${r.name}” is a ${type.label.toLowerCase()} written as prose — consider turning it into a checklist.`,
      });
    }
  }
  return issues;
}
