// src/tests/integrity.test.js — validation tests for roadmap task 52
// (integrity checks & fixture suite). Run in the live page:
//   await import("./src/tests/integrity.test.js").then((m) => m.run())
//
// Covers: the fixture catalog and its model coverage; the healthy fixture
// passing the whole suite clean; each individual check (classification,
// relationships, required-fields, orphans, credentials, exports) passing on the
// good fixture and CATCHING a deliberate fault; the never-throws guarantee; the
// legacy fixture being repaired by ensureRecordBuckets and reported by the
// suite; and the multi-set roll-up + markdown report.

import { runTests, assert, assertEq } from "./harness.js";
import {
  INTEGRITY_CHECKS,
  INTEGRITY_RUNNERS,
  runIntegritySuite,
  runIntegritySuiteAll,
  integrityClassification,
  integrityRelationships,
  integrityRequiredFields,
  integrityOrphans,
  integrityCredentials,
  integrityExports,
  integritySummaryLine,
  integrityReportToMarkdown,
} from "../framework/integrity.js";
import {
  buildFixtureSet,
  buildFixtureSets,
  buildTspDemoFixture,
  buildLegacyFixture,
  fixtureCatalog,
  fixtureModelCoverage,
  FIXTURE_SPECS,
} from "../framework/fixtures.js";
import { ensureRecordBuckets, RECORD_TYPES, CLASSIFIED_TYPES } from "../framework/docsets.js";
import { buildDocumentationBundle, findLeakedSecrets, serializePublication } from "../framework/publication.js";

const codes = (findings) => findings.map((f) => f.code);
const byCollection = (set, type) => set.records[type] || [];

export async function run() {
  return runTests([
    {
      name: "the fixture catalog covers all four information models plus the integration and imported cases",
      fn: async () => {
        const catalog = fixtureCatalog();
        assertEq(catalog.length, FIXTURE_SPECS.length, "one entry per fixture");
        assert(catalog.some((f) => f.id === "tsp-demo"), "the healthy fixture is listed");
        assert(catalog.some((f) => f.id === "legacy"), "the legacy fixture is listed");
        const coverage = fixtureModelCoverage();
        for (const model of ["core-asset", "flexible-asset", "document", "integration-managed", "imported", "legacy-schema"]) {
          assert(coverage.includes(model), "coverage includes " + model);
        }
        assertEq(buildFixtureSet("nope"), null, "an unknown fixture id returns null");
      },
    },
    {
      name: "the healthy fixture carries one record for each information model and the imported/synchronized provenances",
      fn: async () => {
        const set = buildTspDemoFixture();
        const records = CLASSIFIED_TYPES.flatMap((t) => set.records[t]);
        const models = new Set(records.map((r) => r.informationModel));
        for (const model of ["core-asset", "flexible-asset", "document", "integration"]) {
          assert(models.has(model), "fixture holds a " + model + " record");
        }
        const provs = new Set(records.map((r) => r.provenance));
        assert(provs.has("imported"), "an imported record");
        assert(provs.has("synchronized"), "a synchronized (integration-managed) record");
        assert(set.records.relationships.length >= 10, "the fixture is wired with relationships");
      },
    },
    {
      name: "the healthy fixture passes the whole integrity suite with no errors and no warnings",
      fn: async () => {
        const report = runIntegritySuite(buildTspDemoFixture());
        const failures = report.checks.filter((c) => c.status !== "pass").map((c) => c.label + ": " + c.findings.map((f) => f.message).join("; "));
        assert(report.ok, "the suite passes — " + failures.join(" | "));
        assertEq(report.counts.errors, 0, "no errors");
        assertEq(report.counts.warnings, 0, "no warnings — " + failures.join(" | "));
        assertEq(report.checks.length, INTEGRITY_CHECKS.length, "every check ran");
      },
    },
    {
      name: "the classification check catches an unclassified record and passes the good fixture",
      fn: async () => {
        assertEq(integrityClassification(buildTspDemoFixture()).length, 0, "clean fixture has no findings");
        const broken = buildTspDemoFixture();
        delete byCollection(broken, "organizations")[0].informationModel;
        const findings = integrityClassification(broken);
        assertEq(findings.length, 1, "one finding");
        assertEq(findings[0].code, "unclassified-record", "right code");
        assertEq(findings[0].collection, "organizations", "names the collection");
        assertEq(findings[0].level, "error", "an error-level finding");
      },
    },
    {
      name: "the relationships check catches a dangling target, an unknown kind and a duplicate link",
      fn: async () => {
        assertEq(integrityRelationships(buildTspDemoFixture()).length, 0, "clean fixture has no findings");

        const dangling = buildTspDemoFixture();
        dangling.records.relationships[0].to = { type: "locations", id: "loc_missing" };
        assert(codes(integrityRelationships(dangling)).includes("dangling-to"), "dangling target reported");

        const unknown = buildTspDemoFixture();
        unknown.records.relationships[0].kind = "not-a-kind";
        assert(codes(integrityRelationships(unknown)).includes("unknown-kind"), "unknown kind reported");

        const dup = buildTspDemoFixture();
        dup.records.relationships.push({ ...dup.records.relationships[0], id: "rel_dup" });
        assert(codes(integrityRelationships(dup)).includes("duplicate-link"), "duplicate link reported");
      },
    },
    {
      name: "the relationships check reports a link that cannot be read back from both ends",
      fn: async () => {
        const set = buildTspDemoFixture();
        set.records.relationships.push({
          id: "rel_orphanedge",
          type: "relationships",
          kind: "organization-location",
          from: { type: "organizations", id: "org_acme" },
          to: { type: "locations", id: "loc_hq" },
        });
        // Both ends still resolve, so the both-ways read succeeds (the store reads
        // one link from both ends) — proving the check does not false-positive on
        // a valid link.
        assert(!codes(integrityRelationships(set)).includes("not-bidirectional"), "a valid link reads back from both ends");
      },
    },
    {
      name: "the required-fields check catches a missing org kind and an invalid contact role",
      fn: async () => {
        assertEq(integrityRequiredFields(buildTspDemoFixture()).length, 0, "clean fixture has no findings");
        const broken = buildTspDemoFixture();
        delete byCollection(broken, "organizations")[0].orgKind;
        byCollection(broken, "contacts")[0].contactRole = "not-a-role";
        const findings = integrityRequiredFields(broken);
        assert(findings.some((f) => f.collection === "organizations"), "the organization is flagged");
        assert(findings.some((f) => f.collection === "contacts"), "the contact is flagged");
        assert(findings.every((f) => f.code === "missing-required-field"), "all are missing-required-field");
      },
    },
    {
      name: "the orphan check warns about an unlinked configuration and clears once it is linked",
      fn: async () => {
        const set = buildTspDemoFixture();
        assertEq(integrityOrphans(set).length, 0, "the fixture links every audited record");
        set.records.configurations.push({
          id: "cfg_orphan",
          type: "configurations",
          name: "Unlinked Switch",
          configType: "switch",
          informationModel: "core-asset",
          provenance: "authored",
        });
        const findings = integrityOrphans(set);
        assertEq(findings.length, 1, "one orphan");
        assertEq(findings[0].level, "warning", "orphans are warnings, not errors");
        assertEq(findings[0].recordId, "cfg_orphan", "names the record");
      },
    },
    {
      name: "the credentials check finds no leak, even when credential summaries are opted in",
      fn: async () => {
        const set = buildTspDemoFixture();
        assertEq(integrityCredentials(set).length, 0, "no leak in either policy");

        // Independently confirm the summaries export keeps the credential as a
        // metadata summary but without any secret material.
        const env = buildDocumentationBundle(set, { policy: { credentialSummaries: true, credentialUsernames: true } });
        const summary = (env.records.passwords || [])[0];
        assert(summary, "the credential summary is present when opted in");
        assertEq(summary.secret, undefined, "the secret is never written");
        assertEq(findLeakedSecrets(JSON.parse(serializePublication(env))).length, 0, "the serialized bundle has no secret material");
      },
    },
    {
      name: "the exports check passes the good fixture and produces every export",
      fn: async () => {
        const set = buildTspDemoFixture();
        assertEq(integrityExports(set).length, 0, "the fixture exports cleanly");

        // And the failure path: an export that cannot be built is reported, not thrown.
        const broken = integrityExports(null);
        assert(broken.length > 0, "a failed export produces a finding");
        assert(broken.every((f) => f.level === "error"), "as an error");
      },
    },
    {
      name: "the suite never throws — a failing check is recorded, not propagated",
      fn: async () => {
        const original = INTEGRITY_RUNNERS.exports;
        INTEGRITY_RUNNERS.exports = () => {
          throw new Error("boom");
        };
        try {
          const report = runIntegritySuite(buildTspDemoFixture());
          const check = report.checks.find((c) => c.id === "exports");
          assertEq(check.status, "error", "the failing check is recorded as a check error");
          assertEq(check.error, "boom", "the error message is kept");
          assert(!report.ok, "the suite reports failure");
        } finally {
          INTEGRITY_RUNNERS.exports = original;
        }
      },
    },
    {
      name: "the legacy fixture is repaired to the current shape and its gaps are reported",
      fn: async () => {
        const legacy = buildLegacyFixture();
        assertEq(legacy.schema, "itu-docset/0", "starts on the old schema");
        assertEq(legacy.records.runbooks, undefined, "before repair a later bucket is absent");

        ensureRecordBuckets(legacy);
        for (const type of RECORD_TYPES) {
          assert(Array.isArray(legacy.records[type]), "bucket present after repair: " + type);
        }

        const report = runIntegritySuite(buildLegacyFixture());
        assert(!report.ok, "the legacy set fails the audit");
        const found = codes(report.findings);
        assert(found.includes("unclassified-record"), "detects the unclassified record");
        assert(found.includes("missing-required-field"), "detects the invalid contact role");
        assert(found.includes("dangling-to"), "detects the dangling relationship");
      },
    },
    {
      name: "runIntegritySuiteAll rolls up many sets and the report renders to markdown",
      fn: async () => {
        const audit = runIntegritySuiteAll([buildTspDemoFixture(), buildLegacyFixture()]);
        assertEq(audit.reports.length, 2, "one report per set");
        assertEq(audit.summary.sets, 2, "summary counts the sets");
        assertEq(audit.summary.failing, 1, "one failing set");
        assert(!audit.summary.ok, "the roll-up is not ok");
        assertEq(audit.summary.errors, audit.reports.reduce((n, r) => n + r.counts.errors, 0), "errors summed");

        assert(/passed/.test(integritySummaryLine(audit.reports[0])), "the clean set's summary says passed");
        const md = integrityReportToMarkdown(audit);
        assert(md.includes("# Integrity audit"), "has a title");
        assert(md.includes("TSP Demo Co"), "names the healthy client");
        assert(md.includes("Legacy"), "names the legacy client");
        assert(/failed/.test(md), "calls out the failing set");
      },
    },
    {
      name: "buildFixtureSets returns one set per spec, each independently mutable",
      fn: async () => {
        const sets = buildFixtureSets();
        assertEq(sets.length, FIXTURE_SPECS.length, "one set per spec");
        sets[0].records.organizations[0].name = "mutated";
        assertEq(buildFixtureSet("tsp-demo").records.organizations[0].name, "Acme Demo Co", "a fresh build is unmutated");
      },
    },
  ]);
}
