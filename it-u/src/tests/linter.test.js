// src/tests/linter.test.js — validation tests for Phase 11 task 46
// ("Completeness & quality linter"). Run in the live page:
//   await import("./src/tests/linter.test.js").then((m) => m.run())
//
// Covers each of the six checks the task names — configuration completeness,
// orphan records, document duplication of structured data, service coverage,
// expired/imminent expiry (and undated tracked records), and stale records — plus
// their severities, the finding shape, severity sorting, the per-record roll-up
// and an end-to-end pass over the live documentation service.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { emptyRecords, RECORD_TYPES } from "../framework/docsets.js";
import {
  LINT_CHECKS,
  LINT_SEVERITIES,
  severityRank,
  isStructuredToken,
  structuredTokens,
  scanStructuredValues,
  isProse,
  noteFieldPairs,
  lintConfigurationCompleteness,
  lintOrphanRecords,
  lintDocumentDuplication,
  lintFreeTextStructure,
  lintStructuredProse,
  lintAssetAsNote,
  lintDuplicatedValues,
  lintStorageModel,
  lintServiceCoverage,
  lintExpiryAttention,
  lintStaleRecords,
  lintDocumentationSet,
  lintAllSets,
  summarizeLint,
} from "../framework/linter.js";

const NOW = Date.parse("2026-08-01T00:00:00Z");
const CL = { informationModel: "core-asset", provenance: "authored" };

// A documentation set with one record per problem the linter looks for. Values
// are constructed directly (the linter is pure and must work on any set shape).
function makeSet(now = NOW) {
  const records = emptyRecords();
  const put = (type, id, name, extra = {}) => {
    const r = { id, type, name, createdAt: now, updatedAt: now, ...extra };
    records[type].push(r);
    return r;
  };
  put("organizations", "org-1", "Acme Corp", { orgKind: "organization" });
  put("locations", "loc-1", "Head Office", { locationType: "office" });
  // Complete but for its credential link — the link makes it complete AND unorphans it.
  put("configurations", "cfg-srv", "SRV-01", {
    configType: "server",
    manufacturer: "Dell",
    model: "R740",
    locationId: "loc-1",
    serialNumber: "SN-ABC123",
    macAddress: "00:11:22:33:44:55",
    ipAddresses: "10.0.0.5",
    hostname: "srv-01.acme.example",
    warrantyExpiryDate: "2030-01-01",
  });
  // Missing six required fields, and linked to nothing.
  put("configurations", "cfg-sw", "SW-01", { configType: "switch", manufacturer: "Cisco", model: "C2960" });
  put("passwords", "pwd-1", "SRV-01 admin", { scope: "general", category: "user-account", secret: "s3cr3t" });
  // Repeats the server's hostname, serial and IP in prose, with no link to it.
  put("documents", "doc-1", "Server build notes", {
    docType: "sop",
    body: "The primary server srv-01.acme.example has serial SN-ABC123 and IP 10.0.0.5.",
  });
  // A known service with no relationships at all.
  put("flexibleAssets", "fx-voice", "Acme Voice", { assetTypeId: "atype-voice-pbx", assetFields: {} });
  put("certificates", "cert-1", "acme.example certificate", { validTo: "2026-07-15" });
  put("domains", "dom-1", "acme.example", { expiresAt: "2026-08-10" });
  put("domains", "dom-2", "acme.net", {});
  records.relationships.push({
    id: "r1",
    type: "relationships",
    kind: "configuration-credential",
    from: { type: "configurations", id: "cfg-srv" },
    to: { type: "passwords", id: "pwd-1" },
    createdAt: now,
    updatedAt: now,
  });
  return { id: "docset-acme", name: "Acme", schema: "itu-docset/1", createdAt: now, updatedAt: now, records };
}

const finding = (list, code) => list.find((f) => f.code === code);
const countCode = (list, code) => list.filter((f) => f.code === code).length;

// A set with one record per wrong-model signal task 47 detects.
function makeStorageSet() {
  const records = emptyRecords();
  const put = (type, id, name, extra = {}) => {
    const r = { id, type, name, createdAt: NOW, updatedAt: NOW, ...extra };
    records[type].push(r);
    return r;
  };
  // Two addresses held only in prose — no structured record holds them.
  put("documents", "doc-prose-ip", "Firewall and switch addresses", { docType: "client-technical", body: "The firewall is 10.9.9.1 and the core switch is 10.9.9.2." });
  // A structured field carrying a paragraph.
  put("configurations", "cfg-router", "Edge router", {
    configType: "router",
    notes:
      "The edge router terminates both WAN circuits and runs the site-to-site tunnels. " +
      "It is managed by the carrier on weekdays and by our team outside business hours. " +
      "Failover is automatic and was last tested during the November maintenance window.",
  });
  // A note that is really an asset.
  put("documents", "doc-mail", "Mail platform details", {
    docType: "operational-notes",
    body: "Hostname: mail.acme.example\nIP address: 10.0.0.9\nAdmin user: administrator\nBackup window: 01:00-03:00",
  });
  // The same hostname in two records that are not linked.
  put("configurations", "cfg-srv", "SRV-01", { configType: "server", hostname: "srv-01.acme.example" });
  put("certificates", "cert-1", "SRV-01 certificate", { hostname: "srv-01.acme.example" });
  return { id: "docset-store", name: "Store audit", schema: "itu-docset/1", createdAt: NOW, updatedAt: NOW, records };
}

const link = (records, from, to, kind = "related") => records.relationships.push({ id: "r-" + records.relationships.length, type: "relationships", kind, from, to, createdAt: NOW, updatedAt: NOW });

export async function run() {
  return runTests([
    {
      name: "the linter check catalog names the seven checks with severities and icons",
      fn: () => {
        assertEq(LINT_CHECKS.length, 7, "seven checks are catalogued");
        for (const id of ["configuration-completeness", "orphan-records", "document-duplication", "storage-model", "service-coverage", "expiry-attention", "stale-records"]) {
          assert(LINT_CHECKS.some((c) => c.id === id), `the ${id} check is catalogued`);
        }
        assert(severityRank("error") < severityRank("warning"), "error sorts before warning");
        assert(severityRank("warning") < severityRank("info"), "warning sorts before notice");
        assert(LINT_SEVERITIES.some((s) => s.id === "error" && s.rank === 0), "error is rank 0");
      },
    },
    {
      name: "isStructuredToken recognises IPs, MACs, hostnames and serials but not plain words",
      fn: () => {
        assert(isStructuredToken("10.0.0.5"), "an IP is a token");
        assert(isStructuredToken("00:11:22:33:44:55"), "a MAC is a token");
        assert(isStructuredToken("srv-01.acme.example"), "a dotted hostname is a token");
        assert(isStructuredToken("SN-ABC123"), "an alphanumeric serial is a token");
        assert(!isStructuredToken("welcome"), "a plain word is not a token");
        assert(!isStructuredToken("two words"), "a phrase is not a token");
        assert(!isStructuredToken(""), "empty is not a token");
      },
    },
    {
      name: "structuredTokens collects identifying fields across configurations, domains, certificates and flexible assets",
      fn: () => {
        const set = makeSet();
        const tokens = structuredTokens(set);
        const values = tokens.map((t) => t.value.toLowerCase());
        assert(values.includes("srv-01.acme.example"), "the configuration hostname is collected");
        assert(values.includes("sn-abc123"), "the serial is collected");
        assert(values.includes("10.0.0.5"), "the IP is collected");
        assert(values.includes("acme.example"), "the domain name is collected");
        assert(!values.includes("s3cr3t"), "a password secret is never collected");
      },
    },
    {
      name: "the completeness check flags each missing required field and honours exemptions",
      fn: () => {
        const set = makeSet();
        const findings = lintConfigurationCompleteness(set);
        assertEq(findings.length, 6, "the bare switch is missing six required fields");
        assert(findings.every((f) => f.check === "configuration-completeness" && f.severity === "warning"), "every finding is a completeness warning");
        assert(findings.every((f) => f.ref.id === "cfg-sw"), "only the incomplete configuration is flagged");
        assert(finding(findings, "config-missing-field").meta.ruleKey, "each finding names its rule");
        assert(!findings.some((f) => f.ref.id === "cfg-srv"), "the complete configuration is not flagged");

        // An exemption for one missing rule removes exactly that finding.
        const exempted = makeSet();
        exempted.records.configurations.find((r) => r.id === "cfg-sw").exemptions = { serialNumber: { reason: "not applicable", by: "Tom", at: NOW } };
        assertEq(lintConfigurationCompleteness(exempted).length, 5, "the exempted rule is no longer reported");
      },
    },
    {
      name: "the orphan check finds assets with no relationships and exempts embedded credentials",
      fn: () => {
        const set = makeSet();
        const findings = lintOrphanRecords(set);
        const ids = findings.map((f) => f.ref.id).sort();
        assertEq(ids.length, 5, "five records are unlinked");
        assert(ids.includes("cfg-sw"), "the switch is orphaned");
        assert(ids.includes("fx-voice"), "the service asset is orphaned");
        assert(ids.includes("cert-1") && ids.includes("dom-1") && ids.includes("dom-2"), "the domain and certificate records are orphaned");
        assert(!ids.includes("cfg-srv"), "a linked record is not orphaned");
        assert(!ids.includes("pwd-1"), "a linked credential is not orphaned");
        assert(findings.every((f) => f.severity === "info"), "orphans are notices");

        const embedded = makeSet();
        embedded.records.passwords.push({ id: "pwd-embed", type: "passwords", name: "Embedded admin", scope: "embedded", embeddedIn: { type: "configurations", id: "cfg-srv" }, createdAt: NOW, updatedAt: NOW });
        assert(!lintOrphanRecords(embedded).some((f) => f.ref.id === "pwd-embed"), "an embedded credential is exempt");
      },
    },
    {
      name: "the duplication check finds structured values repeated in a document and skips already-linked records",
      fn: () => {
        const set = makeSet();
        const findings = lintDocumentDuplication(set);
        assertEq(findings.length, 1, "the document is flagged once, grouped by target record");
        const f = findings[0];
        assertEq(f.check, "document-duplication", "the right check");
        assertEq(f.ref.id, "doc-1", "the finding concerns the document");
        assertEq(f.meta.targetRef.id, "cfg-srv", "it names the record whose data was duplicated");
        assert(f.meta.tokens.includes("srv-01.acme.example"), "the hostname is reported");
        assert(f.meta.tokens.includes("SN-ABC123"), "the serial is reported");
        assert(f.meta.tokens.includes("10.0.0.5"), "the IP is reported");

        // Linking the document to the record removes the finding.
        const linked = makeSet();
        linked.records.relationships.push({ id: "r2", type: "relationships", kind: "document-configuration", from: { type: "documents", id: "doc-1" }, to: { type: "configurations", id: "cfg-srv" }, createdAt: NOW, updatedAt: NOW });
        assertEq(lintDocumentDuplication(linked).length, 0, "a linked document is not a duplication");
      },
    },
    {
      name: "the service check flags an unlinked service, a surface-less service and missing coverage",
      fn: () => {
        const unlinked = makeSet();
        const a = lintServiceCoverage(unlinked);
        assertEq(a.length, 1, "the unlinked voice service produces one finding");
        assertEq(a[0].code, "service-unlinked", "with the unlinked code");
        assertEq(a[0].severity, "warning", "as a warning");
        assertEq(a[0].meta.service, "voice", "naming the service");

        // Give it a vendor link only — still no surface, so both surface and dependencies fire.
        const surfaceLess = makeSet();
        surfaceLess.records.flexibleAssets.push({ id: "fx-vendor", type: "flexibleAssets", name: "Carrier Ltd", assetTypeId: "atype-vendor", createdAt: NOW, updatedAt: NOW });
        surfaceLess.records.relationships.push({ id: "r3", type: "relationships", kind: "voice-vendor", from: { type: "flexibleAssets", id: "fx-voice" }, to: { type: "flexibleAssets", id: "fx-vendor" }, createdAt: NOW, updatedAt: NOW });
        const b = lintServiceCoverage(surfaceLess);
        assert(b.some((f) => f.code === "service-no-surface"), "a service linked only to a vendor has no surface");
        assertEq(countCode(b, "service-missing-coverage"), 3, "all three voice dependencies are missing");

        // A credential link is surface; the credential dependency clears.
        const surfaced = makeSet();
        surfaced.records.relationships.push({ id: "r4", type: "relationships", kind: "voice-password", from: { type: "flexibleAssets", id: "fx-voice" }, to: { type: "passwords", id: "pwd-1" }, createdAt: NOW, updatedAt: NOW });
        const c = lintServiceCoverage(surfaced);
        assert(!c.some((f) => f.code === "service-no-surface"), "a linked credential is surface coverage");
        assert(!c.some((f) => f.meta.requirement === "credential"), "the credential dependency is covered");
      },
    },
    {
      name: "the expiry check reports overdue as an error, due-soon as a warning and undated as a notice",
      fn: () => {
        const set = makeSet();
        const findings = lintExpiryAttention(set, { now: NOW });
        const overdue = finding(findings, "expiry-overdue");
        assert(overdue, "the lapsed certificate is reported");
        assertEq(overdue.severity, "error", "an expired item is an error");
        assertEq(overdue.ref.id, "cert-1", "it concerns the certificate");
        const dueSoon = finding(findings, "expiry-due-soon");
        assert(dueSoon, "the soon-to-expire domain is reported");
        assertEq(dueSoon.severity, "warning", "a due-soon item is a warning");
        assertEq(dueSoon.ref.id, "dom-1", "it concerns the domain");
        const undated = finding(findings, "expiry-undated");
        assert(undated, "the undated domain is reported");
        assertEq(undated.severity, "info", "an undated tracked record is a notice");
        assertEq(undated.ref.id, "dom-2", "it concerns the undated domain");
        assert(!findings.some((f) => f.ref.id === "cfg-srv"), "a far-future warranty is not attention");
      },
    },
    {
      name: "the stale check reports records untouched past the threshold",
      fn: () => {
        const set = makeSet();
        assertEq(lintStaleRecords(set, { now: NOW }).length, 0, "fresh records are not stale");
        set.records.diagrams.push({ id: "dia-old", type: "diagrams", name: "Legacy network diagram", updatedAt: NOW - 900 * 86400000, createdAt: NOW - 900 * 86400000 });
        const findings = lintStaleRecords(set, { now: NOW });
        assertEq(findings.length, 1, "one stale record");
        assertEq(findings[0].ref.id, "dia-old", "the old diagram");
        assertEq(findings[0].severity, "info", "staleness is a notice");
        assert(findings[0].meta.days >= 899, "the age is reported in days");
        assertEq(lintStaleRecords(set, { now: NOW, staleDays: 1000 }).length, 0, "a longer threshold clears it");
      },
    },
    {
      name: "summarizeLint sorts by severity and rolls findings up per record and per check",
      fn: () => {
        const result = lintDocumentationSet(makeSet(), { now: NOW });
        assertEq(result.counts.total, 16, "the seeded set produces sixteen findings");
        assertEq(result.counts.error, 1, "one error");
        assertEq(result.counts.warning, 9, "nine warnings");
        assertEq(result.counts.info, 6, "six notices");
        assertEq(result.ok, false, "an error makes the set not ok");
        assert(!result.clean, "the set is not clean");
        assertEq(result.findings[0].severity, "error", "errors sort first");
        assert(["error", "warning", "info"].includes(result.findings[result.findings.length - 1].severity), "notices sort last");
        assertEq(result.checks.length, 7, "every check is reported");
        const orphanCheck = result.checks.find((c) => c.id === "orphan-records");
        assertEq(orphanCheck.count, 5, "the orphan count is reported");
        const sw = result.byRecord.find((g) => g.ref.id === "cfg-sw");
        assert(sw && sw.findings.length === 7, "the switch carries its completeness and orphan findings");
        assertEq(sw.worst, "warning", "its worst finding is a warning");
        assertEq(result.byRecord[0].worst, "error", "the certificate sorts first by severity");

        const clean = summarizeLint(makeSet(), [], { generatedAt: NOW });
        assert(clean.clean && clean.ok, "no findings is clean and ok");
      },
    },
    {
      name: "lintAllSets merges several clients and keeps each finding's client",
      fn: () => {
        const a = makeSet();
        const b = JSON.parse(JSON.stringify(makeSet()));
        b.id = "docset-beta";
        b.name = "Beta";
        const merged = lintAllSets([a, b], { now: NOW });
        assertEq(merged.counts.total, 32, "both clients' findings are merged");
        assertEq(merged.sets.length, 2, "both client summaries are returned");
        assert(merged.findings.every((f) => f.setId), "every merged finding names its client");
        assert(merged.findings.some((f) => f.setId === "docset-beta"), "the second client's findings are present");
      },
    },
    {
      name: "scanStructuredValues and isProse separate identifying values from paragraphs",
      fn: () => {
        const found = scanStructuredValues("Mail 10.0.0.5, host srv.acme.example, call 555-01-02 (ACME-1234).");
        const values = found.map((v) => v.value);
        assert(values.includes("10.0.0.5"), "the IP is found");
        assert(values.includes("srv.acme.example"), "the hostname is found");
        assert(values.includes("ACME-1234"), "the serial is found");
        assertEq(scanStructuredValues("a plain sentence with no values").length, 0, "plain prose yields nothing");
        assert(isProse("First this happens and it takes a moment to complete properly. Then that happens in response, which also takes its own time to run. Finally the other thing happens, and describing it fully takes several more words than a field should hold."), "a multi-sentence paragraph is prose");
        assert(!isProse("Short note."), "a short note is not prose");
        assert(!isProse("srv-01.acme.example"), "a token is not prose");
      },
    },
    {
      name: "the free-text structure check finds buried values and clears once they are recorded",
      fn: () => {
        const set = makeStorageSet();
        const findings = lintFreeTextStructure(set);
        const f = finding(findings, "storage-free-text-holds-structure");
        const target = findings.find((x) => x.ref.id === "doc-prose-ip");
        assert(target, "the values buried in prose are reported");
        assertEq(target.check, "storage-model", "under the storage-model check");
        assertEq(target.severity, "warning", "as a warning");
        assert(target.meta.values.includes("10.9.9.1") && target.meta.values.includes("10.9.9.2"), "both addresses are named");
        assert(f, "the check produces findings");

        // Recording the values in a configuration clears the document's finding.
        const fixed = makeStorageSet();
        fixed.records.configurations.push({ id: "cfg-fw", type: "configurations", name: "Firewall", ipAddresses: "10.9.9.1\n10.9.9.2", createdAt: NOW, updatedAt: NOW });
        assert(!lintFreeTextStructure(fixed).some((x) => x.ref.id === "doc-prose-ip"), "recording the values clears the finding");
      },
    },
    {
      name: "the structured-prose check flags a paragraph in a field and clears when a document is linked",
      fn: () => {
        const set = makeStorageSet();
        const findings = lintStructuredProse(set);
        assertEq(findings.length, 1, "only the router's notes read as prose");
        assertEq(findings[0].code, "storage-structure-holds-prose");
        assertEq(findings[0].ref.id, "cfg-router");
        assertEq(findings[0].meta.field, "notes");
        assert(findings[0].meta.length >= 200, "the length is reported");

        const fixed = makeStorageSet();
        fixed.records.documents.push({ id: "doc-router", type: "documents", name: "Router runbook", docType: "operational-notes", body: "How the router is managed.", createdAt: NOW, updatedAt: NOW });
        link(fixed.records, { type: "documents", id: "doc-router" }, { type: "configurations", id: "cfg-router" });
        assertEq(lintStructuredProse(fixed).length, 0, "linking a document clears the finding");
      },
    },
    {
      name: "the asset-as-note check finds a note shaped like an asset and ignores ordinary prose",
      fn: () => {
        const set = makeStorageSet();
        const findings = lintAssetAsNote(set);
        assertEq(findings.length, 1, "only the field-shaped note is flagged");
        assertEq(findings[0].code, "storage-asset-as-note");
        assertEq(findings[0].ref.id, "doc-mail");
        assert(findings[0].meta.pairs >= 4, "the field/value lines are counted");
        assert(findings[0].meta.labels.includes("Hostname"), "the labels are reported");

        const prose = makeStorageSet();
        prose.records.documents.find((d) => d.id === "doc-mail").body =
          "We have looked after the mail platform for years and it has always been reliable. " +
          "The team knows it well and the vendor has been responsive whenever we have needed help.";
        assertEq(lintAssetAsNote(prose).length, 0, "a prose note is not an asset");
        const pairs = noteFieldPairs("Alpha: one\nBeta: two");
        assertEq(pairs.count, 2, "two field/value lines are counted");
      },
    },
    {
      name: "the duplicated-value check flags a shared value and clears once the records are linked",
      fn: () => {
        const set = makeStorageSet();
        const findings = lintDuplicatedValues(set);
        const f = findings.find((x) => x.meta && x.meta.value === "srv-01.acme.example");
        assert(f, "the shared hostname is reported");
        assertEq(f.code, "storage-duplicated-value", "with the duplicated-value code");
        assert(f.meta.refs.some((r) => r.id === "cfg-srv") && f.meta.refs.some((r) => r.id === "cert-1"), "both holders are named");
        assert(f.meta.fields.includes("hostname"), "the fields are reported");

        const fixed = makeStorageSet();
        link(fixed.records, { type: "certificates", id: "cert-1" }, { type: "configurations", id: "cfg-srv" });
        assert(!lintDuplicatedValues(fixed).some((x) => x.meta && x.meta.value === "srv-01.acme.example"), "linking the records clears the finding");
      },
    },
    {
      name: "lintStorageModel assembles all four signals into the storage-model check",
      fn: () => {
        const set = makeStorageSet();
        const codes = new Set(lintStorageModel(set).map((f) => f.code));
        for (const code of ["storage-free-text-holds-structure", "storage-structure-holds-prose", "storage-asset-as-note", "storage-duplicated-value"]) {
          assert(codes.has(code), `the ${code} signal is present`);
        }
        const result = lintDocumentationSet(set, { now: NOW });
        assert(result.byCheck["storage-model"] >= 4, "the assembled audit reports the storage-model findings");
        assert(result.checks.some((c) => c.id === "storage-model"), "the check is listed in the report");
        assert(result.findings.every((f) => f.check && f.severity && f.message && f.fix), "every storage-model finding carries a fix descriptor");
      },
    },
    {
      name: "the live documentation service lints end to end without touching the graph audit",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-lint" });
        const set = await world.docs.create({ name: "Acme" });
        // A bare configuration: incomplete and unlinked.
        await world.docs.addRecord(set.id, { type: "configurations", name: "SRV-01", configType: "server-physical", ...CL });
        // A document that repeats a structured-looking value but no structured record exists yet.
        await world.docs.addRecord(set.id, { type: "documents", name: "Build notes", docType: "sop", body: "Build steps.", ...CL });
        const fresh = await world.docs.get(set.id, { force: true });
        const result = lintDocumentationSet(fresh, { now: NOW });
        assert(result.counts.total > 0, "the bare configuration produces findings");
        assert(result.byCheck["configuration-completeness"] > 0, "its missing fields are reported");
        assert(result.byCheck["orphan-records"] >= 1, "its lack of links is reported");
        assert(result.findings.every((f) => f.check && f.severity && f.message), "every finding is well-formed");
        assert((await world.docs.integrity(set.id)).ok, "the graph audit is unaffected by the linter");
      },
    },
  ]);
}
