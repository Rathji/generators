// src/tests/documents.test.js — validation tests for Phase 5 tasks 21–22
// (document authoring + SOPs & deployment procedures). Run in the live page:
//   await import("./src/tests/documents.test.js").then((m) => m.run())
//
// Covers: the document-type catalog and its seeded templates; validation
// (a document needs a type; SOP/deployment types need a body); the authoring
// flow (add seeds the template, every save appends an independent revision,
// restoring an old revision writes a NEW one, marking reviewed stamps the
// date); procedural extraction and the checklist rule; review-status
// computation; the documents integrity audit; and linking a document to the
// organizations/assets/services it concerns.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld, assertThrowsCode } from "./testFixtures.js";
import {
  DOCUMENT_TYPES,
  DOCUMENT_GROUPS,
  SOP_TYPES,
  isSopDoc,
  documentType,
  documentTypeLabel,
  documentsOfGroup,
  documentTemplate,
  extractProcedureSteps,
  checklistSuitability,
  documentReviewStatus,
  validateDocument,
  requireDocument,
  documentRevision,
  documentVersionList,
  normalizeTags,
  documentDetailLine,
  documentIssues,
  DOCUMENT_HISTORY_MAX,
} from "../framework/document.js";

const C = { informationModel: "core-asset", provenance: "authored" };
const DAY = 86400000;

export async function run() {
  return runTests([
    {
      name: "the document-type catalog ships the TSP's document types with templates",
      fn: () => {
        const ids = DOCUMENT_TYPES.map((d) => d.id);
        for (const id of [
          "installation-procedure",
          "troubleshooting",
          "help-desk",
          "recovery",
          "operational-notes",
          "client-technical",
          "public-instruction",
          "reference",
          "sop",
          "deployment",
        ]) {
          assert(ids.includes(id), "ships type " + id);
        }
        assertEq(DOCUMENT_TYPES.length, 10, "ten document types");
        assertEq(SOP_TYPES.join(","), "sop,deployment", "two standard procedure types");
        assert(isSopDoc({ docType: "sop" }), "sop is an SOP doc");
        assert(isSopDoc({ docType: "deployment" }), "deployment is an SOP doc");
        assert(!isSopDoc({ docType: "reference" }), "reference is not an SOP doc");
        assertEq(documentTypeLabel("sop"), "Standard operating procedure", "type label");
        assertEq(documentType("nope"), null, "unknown type is null");
        assertEq(documentsOfGroup("Standard procedures").length, 2, "standard procedures group holds two");
        assertEq(DOCUMENT_GROUPS.length, 4, "four groups");
        for (const d of DOCUMENT_TYPES) {
          const tpl = documentTemplate(d.id);
          assertEq(tpl.docType, d.id, "template of " + d.id);
          assert(tpl.body && tpl.body.trim().length > 0, d.id + " ships a body template");
        }
        assertEq(documentTemplate("nope").docType, "reference", "unknown type falls back to reference");
        assert(documentTemplate("sop").body.startsWith("# Standard operating procedure"), "sop template body");
      },
    },
    {
      name: "a document must declare a type, and SOP/deployment types must carry a body",
      fn: () => {
        assert(!validateDocument({ name: "X", body: "hi" }).ok, "missing type refused");
        assert(!validateDocument({ docType: "nope", body: "hi" }).ok, "unknown type refused");
        assert(validateDocument({ docType: "reference" }).ok, "a reference needs no body");
        assert(!validateDocument({ docType: "sop", body: "   " }).ok, "an SOP needs a body");
        assert(!validateDocument({ docType: "deployment", body: "" }).ok, "a deployment needs a body");
        assert(validateDocument({ docType: "sop", body: "1. Do it." }).ok, "an SOP with a body passes");
        assert(!validateDocument({ docType: "reference", reviewIntervalDays: -1 }).ok, "review interval must be positive");
        assert(!validateDocument({ docType: "reference", tags: { a: 1 } }).ok, "tags must be a list or string");
        assert(validateDocument({ docType: "reference", tags: "a, b" }).ok, "comma-separated tags ok");
        let threw = null;
        try {
          requireDocument({ docType: "sop", name: "No body" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireDocument throws INVALID_DATA");
      },
    },
    {
      name: "addDocument seeds the template, stamps revision 1 and refuses duplicates",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-add");
        const set = await docs.create({ name: "Acme" });
        const { record } = await docs.addDocument(set.id, { name: "Office setup", docType: "installation-procedure", ...C });
        assert(record.id.startsWith("doc_"), "id derived from the type prefix");
        assertEq(record.revision, 1, "starts at revision 1");
        assertEq(record.summary, documentTemplate("installation-procedure").summary, "summary seeded from the template");
        assert(record.body.includes("Installation procedure"), "body seeded from the template");
        assertEq(record.reviewIntervalDays, 365, "review interval seeded from the type");
        assert(/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt), "reviewedAt stamped as a date");
        assert(Array.isArray(record.revisions) && record.revisions.length === 0, "no prior revisions yet");

        await assertThrowsCode(() => docs.addDocument(set.id, { name: "Office setup", docType: "reference", ...C }), "DUPLICATE_RECORD", "duplicate title refused");
        await assertThrowsCode(() => docs.addDocument(set.id, { name: "No type", ...C }), "INVALID_DATA", "missing type refused");

        // An SOP created without a body is seeded with its template — which is
        // itself a valid body — but an SOP can never be SAVED blank.
        const sop = (await docs.addDocument(set.id, { name: "Lockup procedure", docType: "sop", ...C })).record;
        assert(sop.body && sop.body.trim().length > 0, "a bodyless SOP is seeded from the template");
        await assertThrowsCode(() => docs.saveDocument(set.id, { type: "documents", id: sop.id }, { body: "  " }), "INVALID_DATA", "an SOP cannot be saved with a blank body");

        const live = await docs.get(set.id);
        assertEq(live.records.documents.length, 2, "both good documents were saved");
        assert(live.records.documents.every((d) => d.type === "documents"), "stored under the documents type");
        assert(live.records.documents.some((d) => d.id === record.id), "the installation procedure persisted");
      },
    },
    {
      name: "saveDocument appends an independent revision and bumps the number",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-save");
        const set = await docs.create({ name: "Acme" });
        const { record } = await docs.addDocument(set.id, { name: "Runbook", docType: "operational-notes", summary: "one", body: "first", ...C });
        const ref = { type: "documents", id: record.id };
        const first = await docs.saveDocument(set.id, ref, { body: "second" }, { updatedBy: "alice" });
        assertEq(first.revision, 2, "revision bumped to 2");
        assertEq(first.record.body, "second", "content updated");
        const second = await docs.saveDocument(set.id, ref, { summary: "two", body: "third" }, { updatedBy: "bob" });
        assertEq(second.revision, 3, "revision bumped to 3");
        const list = documentVersionList(second.record);
        assertEq(list.length, 3, "three versions in total");
        assertEq(list[0].revision, 1, "oldest first");
        assertEq(list[0].body, "first", "first revision holds the original body");
        assertEq(list[0].savedBy, "system", "first revision authored at creation");
        assertEq(list[1].body, "second", "middle revision snapshotted");
        assertEq(list[1].savedBy, "alice", "middle revision names its author");
        assertEq(list[2].revision, 3, "current revision last");
        assertEq(list[2].current, true, "current revision flagged");
        assertEq(list[0].current, false, "prior revisions not flagged current");
        // Tags are normalized on save.
        const tagged = await docs.saveDocument(set.id, ref, { tags: "a, b, a" });
        assertEq(tagged.record.tags.join(","), "a,b", "tags normalized on save");
      },
    },
    {
      name: "documentRevisions lists history and restoring an old revision writes a new one",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-restore");
        const set = await docs.create({ name: "Acme" });
        const { record } = await docs.addDocument(set.id, { name: "Guide", docType: "reference", body: "v1", ...C });
        const ref = { type: "documents", id: record.id };
        await docs.saveDocument(set.id, ref, { body: "v2" });
        await docs.saveDocument(set.id, ref, { body: "v3" });
        const revs = await docs.documentRevisions(set.id, ref);
        assertEq(revs.revision, 3, "current revision reported");
        assertEq(revs.revisions.length, 3, "all revisions listed");

        const restored = await docs.restoreDocumentRevision(set.id, ref, 1, { updatedBy: "carol" });
        assertEq(restored.restoredFrom, 1, "names the restored revision");
        assertEq(restored.revision, 4, "restore is a NEW revision");
        assertEq(restored.record.body, "v1", "old content restored");
        const after = documentVersionList(restored.record);
        assertEq(after.length, 4, "history is not rewritten — now four versions");
        assertEq(after[3].body, "v1", "the newest version holds the restored content");
        assertEq(after[2].body, "v3", "the version we restored from is still present");

        await assertThrowsCode(() => docs.restoreDocumentRevision(set.id, ref, 99), "UNKNOWN_RECORD", "missing revision refused");
      },
    },
    {
      name: "markDocumentReviewed stamps the review date",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-review");
        const set = await docs.create({ name: "Acme" });
        const { record } = await docs.addDocument(set.id, { name: "Runbook", docType: "sop", body: "1. Do it.", reviewedAt: "2020-01-01", ...C });
        const res = await docs.markDocumentReviewed(set.id, { type: "documents", id: record.id }, { reviewedAt: "2026-03-04", updatedBy: "alice" });
        assertEq(res.reviewedAt, "2026-03-04", "review date stamped");
        assertEq(res.record.reviewedBy, "alice", "reviewer recorded");
      },
    },
    {
      name: "extractProcedureSteps reads numbered steps, falls back to headings, and skips code",
      fn: () => {
        const numbered = "# Title\n\n## Steps\n\n1. First\n2. Second\n3. Third\n";
        assertEq(extractProcedureSteps(numbered).join("|"), "First|Second|Third", "numbered list extracted");
        assertEq(extractProcedureSteps("1) One\n2) Two").join("|"), "One|Two", "parenthesis numbering");
        const headings = "## Prepare\n\nText here.\n\n## Execute\n\nMore text.\n\n## Verify\n\nDone.\n";
        assertEq(extractProcedureSteps(headings).join("|"), "Prepare|Execute|Verify", "headings fallback");
        const fenced = "## Steps\n\n1. Real step\n\n```\n1. Not a step\n2. Nor this\n```\n\n2. Another real step\n";
        assertEq(extractProcedureSteps(fenced).join("|"), "Real step|Another real step", "code fences ignored");
        // A checkbox list is not a procedure ordered-list.
        const tasks = "- [ ] not this\n- [x] nor this\n";
        assertEq(extractProcedureSteps(tasks).length, 0, "checklist items are not steps");
        assertEq(extractProcedureSteps("just some prose").join("|"), "", "prose yields nothing");
      },
    },
    {
      name: "the checklist rule flags a procedural document and turns its steps into a linked checklist",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-checklist");
        const set = await docs.create({ name: "Acme" });
        const prose = { docType: "troubleshooting", body: "Here is a long paragraph about fixing things that goes on and on without any steps at all, describing the situation in many words rather than in an ordered list of things to do, which is exactly the kind of prose the rule is meant to catch before it is published." };
        const notSuited = checklistSuitability(prose);
        assertEq(notSuited.suited, false, "prose is not suitable as-is");
        const stepDoc = { docType: "troubleshooting", body: "## Fix\n\n1. Check it\n2. Restart it\n3. Confirm it" };
        const suited = checklistSuitability(stepDoc);
        assertEq(suited.suited, true, "an ordered procedure is suitable");
        assertEq(suited.steps.length, 3, "steps read");
        assert(suited.reasons.length >= 1, "reasons given");
        assertEq(suited.docType, "troubleshooting", "type reported");

        const { record } = await docs.addDocument(set.id, { name: "Fix the printer", docType: "help-desk", body: "## Do\n\n1. Ask the caller\n2. Check the queue\n3. Reboot the print spooler", ...C });
        const res = await docs.documentToChecklist(set.id, { type: "documents", id: record.id });
        assertEq(res.itemCount, 3, "three items generated");
        assertEq(res.record.type, "checklists", "a checklist was created");
        assert(res.relationship, "a relationship was made");
        assertEq(res.relationship.kind, "document-checklist", "of the document→checklist kind");
        const live = await docs.get(set.id);
        assertEq(live.records.checklists.length, 1, "the checklist is in the set");
        assertEq(live.records.checklists[0].items.length, 3, "items persisted");
        assert(live.records.checklists[0].items[0].text.includes("Ask the caller"), "step text copied");
        assertEq(live.records.checklists[0].origin.documentId, record.id, "checklist records its source document");
        await assertThrowsCode(() => docs.documentToChecklist(set.id, { type: "documents", id: "doc-nope" }), "UNKNOWN_RECORD", "unknown document refused");
      },
    },
    {
      name: "review status reports none / due / ok / due-soon / overdue",
      fn: () => {
        const now = Date.UTC(2026, 5, 15);
        assertEq(documentReviewStatus({ docType: "reference", reviewIntervalDays: 0 }, { now }).state, "none", "no schedule");
        assertEq(documentReviewStatus({ docType: "reference", reviewIntervalDays: 365, reviewedAt: "" }, { now }).state, "due", "never reviewed");
        assertEq(documentReviewStatus({ docType: "reference", reviewIntervalDays: 365, reviewedAt: "2026-01-01" }, { now }).state, "ok", "recently reviewed");
        const soon = documentReviewStatus({ docType: "reference", reviewIntervalDays: 365, reviewedAt: "2025-07-01" }, { now });
        assertEq(soon.state, "due-soon", "due within 30 days");
        assert(soon.dueAt === "2026-07-01", "due date computed");
        const overdue = documentReviewStatus({ docType: "reference", reviewIntervalDays: 365, reviewedAt: "2024-01-01" }, { now });
        assertEq(overdue.state, "overdue", "past due");
        assert(overdue.label.toLowerCase().includes("overdue"), "overdue labelled");
      },
    },
    {
      name: "the documents audit flags unknown types, missing SOP bodies, overdue and prose procedures",
      fn: () => {
        const now = Date.UTC(2026, 5, 15);
        const set = {
          records: {
            documents: [
              { id: "d1", name: "Bad type", docType: "nope", body: "x" },
              { id: "d2", name: "Empty SOP", docType: "sop", body: "" },
              { id: "d3", name: "Old guide", docType: "reference", body: "hi", reviewIntervalDays: 365, reviewedAt: "2020-01-01" },
              { id: "d4", name: "Wall of words", docType: "troubleshooting", body: "This is a long prose description of a troubleshooting problem with no ordered steps whatsoever, written in sentence after sentence after sentence so that it comfortably passes the sixty word threshold the rule uses to decide that something is prose rather than a procedure people can follow, and it keeps going for a while longer to be quite certain that the count is comfortably above the threshold by adding yet more words to this deliberately rambling paragraph that never once presents a numbered list." },
              { id: "d5", name: "Good doc", docType: "reference", body: "fine", reviewIntervalDays: 0 },
            ],
          },
        };
        const issues = documentIssues(set);
        assert(issues.some((i) => i.code === "unknown-document-type" && i.recordId === "d1"), "unknown type flagged");
        assert(issues.some((i) => i.code === "sop-missing-body" && i.recordId === "d2"), "missing SOP body flagged");
        assert(issues.some((i) => i.code === "document-review-overdue" && i.recordId === "d3"), "overdue flagged");
        assert(issues.some((i) => i.code === "prose-could-be-checklist" && i.recordId === "d4"), "prose procedure flagged");
        assert(!issues.some((i) => i.recordId === "d5"), "a fine document is not flagged");
        assertEq(issues.find((i) => i.recordId === "d1").level, "error", "unknown type is an error");
        assertEq(issues.find((i) => i.recordId === "d3").level, "warning", "overdue is a warning");
      },
    },
    {
      name: "a document links to the organization, assets and services it concerns",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-links");
        const set = await docs.create({ name: "Acme" });
        const org = (await docs.addRecord(set.id, { type: "organizations", name: "Acme Corp", orgKind: "organization", ...C })).record;
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "fw-01", configType: "firewall", ...C })).record;
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C })).record;
        const svc = (await docs.addRecord(set.id, { type: "runbooks", name: "Managed firewall", runbookType: "service-deployment", body: "# Build\n\n1. Step", ...C })).record;
        const doc = (await docs.addDocument(set.id, { name: "Firewall baseline", docType: "sop", body: "## Procedure\n\n1. Back up\n2. Apply\n3. Verify", ...C })).record;
        const ref = { type: "documents", id: doc.id };
        await docs.linkRecords(set.id, { from: ref, to: { type: "organizations", id: org.id }, kind: "document-organization" });
        await docs.linkRecords(set.id, { from: ref, to: { type: "configurations", id: cfg.id }, kind: "document-asset" });
        await docs.linkRecords(set.id, { from: ref, to: { type: "runbooks", id: svc.id }, kind: "document-service" });
        await docs.linkRecords(set.id, { from: ref, to: { type: "locations", id: loc.id }, kind: "document-location" });
        const live = await docs.get(set.id);
        const links = live.records.relationships.filter((r) => r.from.id === doc.id);
        assertEq(links.length, 4, "four links recorded");
        assert(links.some((r) => r.kind === "document-organization"), "organization link");
        assert(links.some((r) => r.kind === "document-asset"), "asset link");
        assert(links.some((r) => r.kind === "document-service"), "service link");
        // The detail line summarises the document for the records table.
        const line = documentDetailLine(doc, live);
        assert(line.includes("v1"), "detail line carries the revision");
        assert(line.toLowerCase().includes("word"), "detail line carries the word count");
        assertEq(normalizeTags(" b , a , b ").join(","), "b,a", "tag helper normalizes");
        assertEq(documentRevision({ revision: 5 }), 5, "revision helper");
        assert(DOCUMENT_HISTORY_MAX >= 10, "history cap is generous");
      },
    },
    {
      name: "a deployment procedure is a standard procedure that versions independently and links to the service it concerns",
      fn: async () => {
        const { docs } = await makeWorld("kb-doc-deploy");
        const set = await docs.create({ name: "Acme" });
        const svc = (await docs.addRecord(set.id, { type: "runbooks", name: "Managed firewall", runbookType: "service-deployment", body: "# Build\n\n1. Step", ...C })).record;
        const dep = (await docs.addDocument(set.id, { name: "fw-01 cutover", docType: "deployment", body: "## Cutover\n\n1. Stage\n2. Cut over\n3. Verify", ...C })).record;
        assertEq(documentTypeLabel("deployment"), "Deployment procedure", "deployment label");
        assert(isSopDoc(dep), "a deployment is a standard procedure");
        assertEq(documentType(dep.docType).reviewIntervalDays, 365, "deployments carry a review cadence");
        // It versions on its own timeline, independent of the rest of the set.
        await docs.saveDocument(set.id, { type: "documents", id: dep.id }, { body: dep.body + "\n4. Roll back if needed" });
        const live = await docs.get(set.id);
        const stored = live.records.documents.find((d) => d.id === dep.id);
        assertEq(documentRevision(stored), 2, "the deployment versioned independently");
        assertEq(documentVersionList(stored).length, 2, "both revisions kept");
        // It is linked to the service it deploys.
        await docs.linkRecords(set.id, { from: { type: "documents", id: dep.id }, to: { type: "runbooks", id: svc.id }, kind: "document-service" });
        const after = await docs.get(set.id);
        assert(after.records.relationships.some((r) => r.from.id === dep.id && r.kind === "document-service" && r.to.id === svc.id), "linked to its service");
      },
    },
  ]);
}

