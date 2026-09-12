// src/tests/linter-fixes.test.js — validation tests for Phase 11 task 48
// ("Linter report & one-click fixes"). Run in the live page:
//   await import("./src/tests/linter-fixes.test.js").then((m) => m.run())
//
// Covers the relationship picker, the fix planner (which fixes are auto-
// appliable and which need input), each fix applied end-to-end against a real
// documentation service (and the finding it clears), and the severity-grouped
// report and its Markdown / CSV exports.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { lintDocumentationSet, lintAllSets } from "../framework/linter.js";
import { linkKindsFor, pickLink, fixPlan, canAutoFix, applyLintFix, CUSTOM_ASSET_TYPE_ID } from "../framework/linterFixes.js";
import { buildLintReport, reportToMarkdown, reportToCsv, reportFilename, reportSummaryLine } from "../framework/linterReport.js";

const NOW = Date.parse("2026-08-01T00:00:00Z");
const CL = { informationModel: "core-asset", provenance: "authored" };
const DOC = { informationModel: "document", provenance: "authored" };
const PROSE =
  "The edge router terminates both WAN circuits and runs the site-to-site tunnels. " +
  "It is managed by the carrier on weekdays and by our team outside business hours. " +
  "Failover is automatic and was last tested during the November maintenance window.";

const fresh = (docs, id) => docs.get(id, { force: true });
const findRec = (set, ref) => (set.records[ref.type] || []).find((r) => r.id === ref.id);
const hasFinding = (result, code, refId) => result.findings.some((f) => f.code === code && (!refId || (f.ref && f.ref.id === refId)));
const lint = (set) => lintDocumentationSet(set, { now: NOW });

export async function run() {
  return runTests([
    {
      name: "pickLink finds a valid relationship kind, reversing the direction when needed",
      fn: () => {
        assert(linkKindsFor("documents", "configurations").includes("document-asset"), "a document can link to a configuration");
        assert(linkKindsFor("certificates", "domains").includes("certificate-service"), "a certificate can link to a domain");
        assertEq(linkKindsFor("configurations", "certificates").length, 0, "there is no configuration → certificate kind");

        const reversed = pickLink({ type: "configurations", id: "c1" }, { type: "certificates", id: "s1" });
        assert(reversed && reversed.kind === "certificate-service", "the reversed kind is chosen");
        assertEq(reversed.from.type, "certificates", "the certificate becomes the source");
        assertEq(reversed.to.type, "configurations", "the configuration becomes the target");

        const forward = pickLink({ type: "documents", id: "d1" }, { type: "configurations", id: "c1" });
        assertEq(forward.kind, "document-asset", "the natural direction is preferred");

        assertEq(pickLink({ type: "organizations", id: "o1" }, { type: "domains", id: "d1" }), null, "no kind joins an organization to a domain");
        assertEq(pickLink({ type: "organizations", id: "o1" }, { type: "domains", id: "" }), null, "an incomplete ref yields nothing");
      },
    },
    {
      name: "fixPlan describes each fix — what is automatic, what needs input, what is destructive",
      fn: () => {
        const configRef = { type: "configurations", id: "c1", name: "SRV-01" };
        const docRef = { type: "documents", id: "d1", name: "Notes" };

        const value = fixPlan({ fix: { kind: "fill-field", field: "serialNumber", label: "Serial number", ref: configRef } });
        assert(!value.auto && value.needs.includes("value"), "filling a field needs a value");

        const cred = fixPlan({ fix: { kind: "fill-field", ruleKey: "credential", label: "At least one associated credential", ref: configRef } });
        assertEq(cred.kind, "link-records", "a relationship rule becomes a link");
        assert(cred.needs.includes("target") && cred.targetType === "passwords", "and needs a password to link to");

        const auto = fixPlan({ fix: { kind: "link-records", ref: docRef, target: configRef } });
        assert(auto.auto && auto.link && auto.link.kind === "document-asset", "a link with a valid kind is automatic");

        const guided = fixPlan({ fix: { kind: "link-records", ref: configRef } });
        assert(!guided.auto && guided.needs.includes("target"), "an orphan link needs a target chosen");

        const extract = fixPlan({ fix: { kind: "extract-document", ref: configRef, field: "notes", label: "Notes" } });
        assert(extract.auto && extract.link, "extracting prose is automatic and re-links the document");

        const toAsset = fixPlan({ fix: { kind: "convert-to-asset", ref: docRef, values: ["10.0.0.1"] } });
        assert(toAsset.auto && !toAsset.destructive, "converting free text is automatic and non-destructive");

        const noteAsset = fixPlan({ fix: { kind: "convert-note-to-asset", ref: docRef } });
        assert(noteAsset.auto && noteAsset.destructive, "converting a note is automatic but replaces the note");

        const nav = fixPlan({ fix: { kind: "open-record", ref: configRef } });
        assert(nav.navigational && !canAutoFix({ fix: { kind: "open-record", ref: configRef } }), "opening a record is a navigation, not an auto-fix");
        assertEq(fixPlan({}), null, "a finding without a fix plans nothing");
      },
    },
    {
      name: "the fill-field fix sets the value and clears its completeness finding",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Acme" });
        await w.docs.addRecord(set.id, { type: "configurations", name: "SRV-01", configType: "server-physical", ...CL });
        const ctx = { docs: w.docs, setId: set.id, actor: "alice" };

        let result = lint(await fresh(w.docs, set.id));
        const f = result.findings.find((x) => x.code === "config-missing-field" && x.meta.ruleKey === "serialNumber");
        assert(f, "the missing serial is reported");

        const needs = await applyLintFix(ctx, f, {});
        assert(!needs.ok && needs.needs.includes("value"), "without a value it asks for one");

        const res = await applyLintFix(ctx, f, { value: "SN-999" });
        assert(res.ok, "the fix applies");
        const after = await fresh(w.docs, set.id);
        assertEq(findRec(after, f.ref).serialNumber, "SN-999", "the field now holds the value");
        assertEq(after.updatedBy, "alice", "the actor is recorded on the set");

        result = lint(after);
        assert(!result.findings.some((x) => x.meta && x.meta.ruleKey === "serialNumber"), "the finding clears after the fix");
      },
    },
    {
      name: "the link fix joins two records that share a value and clears the duplicate finding",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Beta" });
        await w.docs.addRecord(set.id, { type: "domains", name: "acme.example", ...CL });
        await w.docs.addRecord(set.id, { type: "certificates", name: "secure.acme.example", hostname: "acme.example", ...CL });

        let result = lint(await fresh(w.docs, set.id));
        const f = result.findings.find((x) => x.code === "storage-duplicated-value");
        assert(f, "the shared hostname is reported");
        assert(f.fix.target, "the fix names the other holder");
        assert(fixPlan(f).auto, "the link can be applied in one click");

        const res = await applyLintFix({ docs: w.docs, setId: set.id, actor: "bob" }, f);
        assert(res.ok && res.link, "the relationship is created");
        result = lint(await fresh(w.docs, set.id));
        assert(!hasFinding(result, "storage-duplicated-value"), "the duplicate finding clears once they are linked");
      },
    },
    {
      name: "the extract-document fix moves prose out of a field and clears the finding",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Gamma" });
        await w.docs.addRecord(set.id, { type: "configurations", name: "Edge router", configType: "router", notes: PROSE, ...CL });

        let result = lint(await fresh(w.docs, set.id));
        const f = result.findings.find((x) => x.code === "storage-structure-holds-prose");
        assert(f, "the paragraph in the notes field is reported");

        const res = await applyLintFix({ docs: w.docs, setId: set.id, actor: "carol" }, f);
        assert(res.ok && res.created && res.linked, "a document is created and linked back");
        const after = await fresh(w.docs, set.id);
        const doc = findRec(after, res.created);
        assert(doc.body.includes("edge router terminates"), "the prose moved into the document");
        assertEq(findRec(after, f.ref).notes, "See the linked document.", "the structured field is shortened");

        result = lint(after);
        assert(!hasFinding(result, "storage-structure-holds-prose", f.ref.id), "the finding clears");
      },
    },
    {
      name: "the convert-to-asset fix structures buried values and clears the free-text finding",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Delta" });
        await w.docs.addRecord(set.id, { type: "documents", name: "Addresses", docType: "client-technical", body: "The firewall is 10.9.9.1 and the switch is 10.9.9.2.", ...DOC });

        let result = lint(await fresh(w.docs, set.id));
        const f = result.findings.find((x) => x.code === "storage-free-text-holds-structure");
        assert(f, "values buried in the document are reported");

        const res = await applyLintFix({ docs: w.docs, setId: set.id, actor: "dan" }, f);
        assert(res.ok && res.created && res.created.type === "flexibleAssets", "a flexible asset is created");
        assert(res.linked, "the source document is linked to it");
        const after = await fresh(w.docs, set.id);
        const asset = findRec(after, res.created);
        assertEq(asset.assetTypeId, CUSTOM_ASSET_TYPE_ID, "it uses the custom-asset template");
        assert(asset.assetFields.details.includes("10.9.9.1"), "the values are held in the asset");

        result = lint(after);
        assert(!hasFinding(result, "storage-free-text-holds-structure", f.ref.id), "the finding clears once the values are structured");
      },
    },
    {
      name: "the convert-note-to-asset fix replaces the note and clears the note-as-asset finding",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Epsilon" });
        const body = "Hostname: mail.acme.example\nIP address: 10.0.0.9\nAdmin user: administrator\nBackup window: 01:00-03:00";
        await w.docs.addRecord(set.id, { type: "documents", name: "Mail details", docType: "operational-notes", body, ...DOC });

        let result = lint(await fresh(w.docs, set.id));
        const f = result.findings.find((x) => x.code === "storage-asset-as-note");
        assert(f, "the field-shaped note is reported");
        assert(fixPlan(f).destructive, "the plan warns the note is replaced");

        const res = await applyLintFix({ docs: w.docs, setId: set.id, actor: "erin" }, f);
        assert(res.ok && res.removed, "the note is removed after conversion");
        const after = await fresh(w.docs, set.id);
        assert(!after.records.documents.some((d) => d.id === f.ref.id), "the note is gone");
        const asset = after.records.flexibleAssets.find((a) => a.name === "Mail details");
        assert(asset, "the asset carries the note's name");
        assert(asset.assetFields.details.includes("mail.acme.example"), "the note's contents moved into the asset");

        result = lint(after);
        assert(!hasFinding(result, "storage-asset-as-note"), "the finding clears");
      },
    },
    {
      name: "the fix engine refuses a link whose catalog kind does not exist",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Refuse" });
        const org = (await w.docs.addRecord(set.id, { type: "organizations", name: "Parent", orgKind: "organization", ...CL })).record;
        const domain = (await w.docs.addRecord(set.id, { type: "domains", name: "refuse.example", ...CL })).record;
        const finding = { fix: { kind: "link-records", ref: { type: "organizations", id: org.id, name: org.name } } };
        const res = await applyLintFix({ docs: w.docs, setId: set.id }, finding, { target: { type: "domains", id: domain.id } });
        assert(!res.ok && res.error, "no kind means no link");
        assertEq((await fresh(w.docs, set.id)).records.relationships.length, 0, "nothing was written");
      },
    },
    {
      name: "buildLintReport groups findings by severity and exports Markdown and CSV",
      fn: async () => {
        const w = makeWorld({ namespace: "kb-fix" });
        const set = await w.docs.create({ name: "Zeta" });
        await w.docs.addRecord(set.id, { type: "configurations", name: "Bare switch", configType: "switch", ...CL });
        await w.docs.addRecord(set.id, { type: "documents", name: "Notes", docType: "client-technical", body: "Idle.", ...DOC });
        const result = lintAllSets([await fresh(w.docs, set.id)], { now: NOW });
        const report = buildLintReport(result, { sets: [{ id: set.id, name: "Zeta" }], generatedAt: NOW, title: "Zeta audit" });

        assertEq(report.totals.total, result.counts.total, "the totals carry across");
        assert(report.sections.length >= 2, "findings are grouped into more than one severity band");
        assert(report.sections.every((s, i, a) => i === 0 || a[i - 1].count > 0), "each band carries its findings");
        assert(report.sections.every((s) => ["error", "warning", "info"].includes(s.severity)), "bands are named by severity");
        assertEq(report.clients[0].findings, result.counts.total, "the whole count is attributed to the one client");
        assert(report.checks.length >= 1, "the per-check counts are reported");

        const md = reportToMarkdown(report);
        assert(md.startsWith("# Zeta audit"), "the Markdown is titled");
        assert(md.includes("## "), "the Markdown has severity sections");
        assert(md.includes("Bare switch"), "a record name appears in the report");

        const csv = reportToCsv(report);
        assertEq(csv[0][0], "Severity", "the CSV has a header");
        assertEq(csv.length, 1 + result.counts.total, "one CSV row per finding");
        assertEq(reportFilename(report), "itu-linter-report-2026-08-01.md", "the file name is stamped with the date");
        assertEq(reportFilename(report, "csv"), "itu-linter-report-2026-08-01.csv", "the extension is honoured");
        assert(reportSummaryLine(report).includes("finding"), "the summary line reads well");

        const clean = buildLintReport({ findings: [], counts: { error: 0, warning: 0, info: 0, total: 0 } }, { sets: [] });
        assert(clean.ok && clean.sections.length === 0, "a clean report has no sections");
        assert(reportToMarkdown(clean).includes("No findings"), "and reads as clean");
      },
    },
  ]);
}
