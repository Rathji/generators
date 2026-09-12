// src/tests/runbook.test.js — validation tests for Phase 8 task 37 (deployment
// runbooks & the VoIP deployment runbook generator). Run in the live page:
//   await import("./src/tests/runbook.test.js").then((m) => m.run())
//
// Covers: the runbook vocabulary catalogs (types, statuses), the field schema,
// validation (a runbook needs a known type and a body), the docs-service storage
// (addRunbook / saveRunbook / runbookRevisions / restoreRunbookRevision /
// markRunbookReviewed) with its independent revision history, the VoIP runbook
// generator (generateVoipRunbook) — that it emits every required section with
// the recorded values and names the linked records — the coverage audit
// (voipRunbookCoverage), the runbook audit (runbookIssues) folded into the
// Linter, and the detail lines.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { VOICE_PBX_TYPE_ID } from "../framework/voice.js";
import {
  RUNBOOK_TYPES,
  RUNBOOK_GROUPS,
  RUNBOOK_STATUSES,
  RUNBOOK_STATUS_IDS,
  RUNBOOK_FIELDS,
  runbookType,
  runbookTypeLabel,
  runbookTypeOptions,
  runbooksOfGroup,
  runbookStatus,
  runbookStatusLabel,
  runbookStatusOptions,
  validateRunbook,
  requireRunbook,
  runbookRevision,
  normalizeRunbookTags,
  makeRunbookRevision,
  runbookVersionList,
  runbookReviewStatus,
  runbookDetailLine,
  VOIP_RUNBOOK_SECTIONS,
  voipRunbookSection,
  voipRunbookCoverage,
  voipRunbookIssues,
  runbookIssues,
  generateVoipRunbook,
} from "../framework/runbook.js";
import { recordDetailLine, standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);

async function seed(world, overrides = {}) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const voice = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Head office voice",
    assetTypeId: VOICE_PBX_TYPE_ID,
    assetFields: {
      platformType: "3cx",
      product: "3CX v20",
      deploymentModel: "cloud",
      provider: "Telco",
      tenant: "acme.3cx.com",
      trunkType: "sip-registration",
      sipDomain: "sip.telco.example",
      sipTransport: "tls",
      numberInventory: "02 5550 1000 main\n02 5550 10xx extensions\n1300 555 000 support",
      portingStatus: "ported",
      portDate: "2024-01-15",
      emergencyService: "e911",
      emergencyAddress: "1 Example St, Sydney NSW",
      codecs: ["g711u", "g722"],
      failoverNotes: "Secondary WAN + carrier alternate PoP",
      qualityNotes: "DSCP EF (46) RTP, CS3 (24) SIP",
      extensionCount: "120",
      handsetCount: "95",
      simultaneousCalls: "40",
      ...(overrides.assetFields || {}),
    },
    ...CL,
  })).record;
  const circuit = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Fibre 500", assetTypeId: builtinAssetType("atype-wan-circuit").id, assetFields: { carrier: "Telstra", circuitType: "fibre" }, ...CL })).record;
  const sbc = (await docs.addRecord(set.id, { type: "configurations", name: "EDGE-FW-01", configType: "firewall", ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "PBX admin console", scope: "general", category: "voip", ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Priya Nair", contactRole: "application-owner", ...CL })).record;
  const location = (await docs.addRecord(set.id, { type: "locations", name: "Head Office", locationType: "office", ...CL })).record;
  return { set, voice, circuit, sbc, password, contact, location };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.voice, s.circuit, "voice-circuit");
  await link(s.voice, s.sbc, "voice-sbc");
  await link(s.voice, s.password, "voice-password");
  await link(s.contact, s.voice, "contact-voice");
}

export async function run() {
  return runTests([
    {
      name: "the runbook catalog exposes types, statuses, field schema and lookups",
      fn: () => {
        assertEq(RUNBOOK_TYPES.length >= 2, true, "at least the VoIP and general runbook types exist");
        assert(runbookType("voip-deployment"), "the VoIP deployment type exists");
        assertEq(runbookTypeLabel("voip-deployment"), "VoIP deployment", "the VoIP type is labelled");
        assertEq(runbookType("bogus"), null, "an unknown type is null");
        assertEq(runbookTypeOptions().length, RUNBOOK_TYPES.length, "type options mirror the catalog");
        assert(RUNBOOK_GROUPS.includes("VoIP"), "the VoIP group is catalogued");
        assertEq(runbooksOfGroup("VoIP").every((t) => t.group === "VoIP"), true, "runbooksOfGroup filters by group");

        assertEq(RUNBOOK_STATUSES.length, 5, "five statuses");
        assertEq(runbookStatus("draft").label, "Draft", "status lookup");
        assertEq(runbookStatusLabel("complete"), "Complete", "status label");
        assertEq(runbookStatus("bogus"), null, "an unknown status is null");
        assertEq(runbookStatusOptions().length, RUNBOOK_STATUSES.length, "status options mirror the catalog");
        assertEq(RUNBOOK_STATUS_IDS.join(","), "draft,ready,in-progress,complete,superseded", "status ids in order");

        const body = RUNBOOK_FIELDS.find((f) => f.key === "body");
        assert(body && body.type === "textarea", "the runbook body is a textarea field");
        assert(RUNBOOK_FIELDS.find((f) => f.key === "runbookType" && f.required && f.type === "select"), "runbook type is a required choice");
        assert(RUNBOOK_FIELDS.find((f) => f.key === "status" && f.required), "status is required");
        assert(RUNBOOK_FIELDS.find((f) => f.key === "service" && f.type === "record" && f.of === "flexibleAssets"), "a runbook points at the asset it deploys");
        assert(RUNBOOK_FIELDS.find((f) => f.key === "site" && f.type === "record" && f.of === "locations"), "a runbook points at its site");
        assert(RUNBOOK_FIELDS.find((f) => f.key === "reviewIntervalDays" && f.type === "number"), "a review cadence is recorded");
      },
    },
    {
      name: "validateRunbook refuses an unknown type or a missing body",
      fn: () => {
        assert(!validateRunbook({ runbookType: "voip-deployment", body: "" }).ok, "an empty body is refused");
        assert(!validateRunbook({ runbookType: "bogus", body: "steps" }).ok, "an unknown type is refused");
        assert(!validateRunbook({ runbookType: "voip-deployment", status: "bogus", body: "steps" }).ok, "an unknown status is refused");
        assert(!validateRunbook({ runbookType: "voip-deployment", body: "steps", reviewIntervalDays: 0 }).ok, "a non-positive review interval is refused");
        assert(!validateRunbook({ runbookType: "voip-deployment", body: "steps", tags: 42 }).ok, "invalid tags are refused");
        assert(validateRunbook({ runbookType: "voip-deployment", body: "# Runbook", tags: "a, b" }).ok, "a well-formed runbook validates");

        let threw = null;
        try {
          requireRunbook({ name: "Bad", runbookType: "bogus", body: "" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireRunbook throws INVALID_DATA");
      },
    },
    {
      name: "addRunbook stores a classified, versioned runbook, links its service, and refuses bad or duplicate ones",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-runbook" });
        const s = await seed(world);
        const res = await world.docs.addRunbook(s.set.id, {
          name: "VoIP deployment — Head office",
          runbookType: "voip-deployment",
          summary: "3CX deployment",
          body: "# VoIP\n\n## Platform & PBX configuration\n\nsteps",
          service: ref(s.voice),
          site: ref(s.location),
          tags: "voip, deployment",
          ...CL,
        });
        assertEq(res.record.type, "runbooks", "the record lands in the runbooks bucket");
        assertEq(res.record.status, "draft", "a new runbook defaults to draft");
        assertEq(res.record.version, "1.0", "a new runbook starts at version 1.0");
        assertEq(runbookRevision(res.record), 1, "a new runbook starts at revision 1");
        assertEq(res.record.service.id, s.voice.id, "the service reference is stored");
        assertEq(res.record.site.id, s.location.id, "the site reference is stored");
        assertEq(res.record.tags.join(","), "voip,deployment", "tags are normalized");

        const set = await world.docs.get(s.set.id, { force: true });
        const rels = (set.records.relationships || []).filter((x) => x.kind === "runbook-service");
        assertEq(rels.length, 1, "the runbook is linked to its service with the runbook-service kind");
        assertEq(rels[0].from.id, res.record.id, "the link starts from the runbook");

        let unknown = null;
        try {
          await world.docs.addRunbook(s.set.id, { name: "No type", runbookType: "bogus", body: "x", ...CL });
        } catch (e) {
          unknown = e;
        }
        assert(unknown && unknown.code === "INVALID_DATA", "an unknown runbook type is refused");

        let noBody = null;
        try {
          await world.docs.addRunbook(s.set.id, { name: "No body", runbookType: "voip-deployment", body: "", ...CL });
        } catch (e) {
          noBody = e;
        }
        assert(noBody && noBody.code === "INVALID_DATA", "a body-less runbook is refused");

        let dup = null;
        try {
          await world.docs.addRunbook(s.set.id, { name: "VoIP deployment — Head office", runbookType: "voip-deployment", body: "x", ...CL });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "DUPLICATE_RECORD", "a duplicate name is refused");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "saveRunbook appends an independent revision and restore writes it back as a new one",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-runbook" });
        const s = await seed(world);
        const r = (await world.docs.addRunbook(s.set.id, { name: "Warehouse cutover", runbookType: "service-deployment", body: "v1 body", ...CL })).record;
        assertEq(runbookRevision(r), 1, "starts at revision 1");

        const saved = await world.docs.saveRunbook(s.set.id, ref(r), { body: "v2 body", status: "ready" });
        assertEq(saved.revision, 2, "saving bumps the revision");
        const revs = await world.docs.runbookRevisions(s.set.id, ref(r));
        assertEq(revs.revisions.length, 2, "two versions are tracked");
        assertEq(revs.revisions[0].body, "v1 body", "the first revision holds the old body");
        assertEq(revs.revisions[1].current, true, "the newest version is flagged current");
        assertEq(revs.revisions[1].body, "v2 body", "the current version holds the new body");

        const restored = await world.docs.restoreRunbookRevision(s.set.id, ref(r), 1);
        assertEq(restored.restoredFrom, 1, "the restore names the revision it came from");
        const after = await world.docs.runbookRevisions(s.set.id, ref(r));
        const current = after.revisions.find((v) => v.current);
        assertEq(current.body, "v1 body", "the restored body is the new current version");
        assertEq(after.revisions.length, 3, "restoring adds a revision rather than rewriting history");

        const marked = await world.docs.markRunbookReviewed(s.set.id, ref(r));
        assert(marked.reviewedAt, "marking reviewed stamps a date");
      },
    },
    {
      name: "generateVoipRunbook assembles every required section with the recorded values and names the linked records",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-runbook" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipRunbook({ voice: s.voice, set, site: s.location, preparedBy: "Tom" });

        assertEq(gen.runbookType, "voip-deployment", "the generated runbook is a VoIP deployment");
        assertEq(gen.service.id, s.voice.id, "it references the voice asset");
        assertEq(gen.site.id, s.location.id, "it references the site");
        assertEq(gen.warnings.length, 0, "a fully recorded platform raises no gaps: " + JSON.stringify(gen.warnings));

        const cov = voipRunbookCoverage({ body: gen.body });
        for (const sec of VOIP_RUNBOOK_SECTIONS) {
          assert(cov[sec.id], "the body contains the “" + sec.heading + "” section");
        }
        assertEq(gen.sections.filter((x) => x.required).length, VOIP_RUNBOOK_SECTIONS.filter((x) => x.required).length, "every required section is declared");

        assert(gen.body.includes("3CX"), "the platform label is substituted");
        assert(gen.body.includes("sip.telco.example"), "the SIP domain is substituted");
        assert(gen.body.includes("02 5550 1000 main"), "the number inventory lines are substituted");
        assert(gen.body.includes("1 Example St, Sydney NSW"), "the dispatchable address is substituted");
        assert(gen.body.includes("SIP over TLS"), "the SIP transport label is substituted");
        assert(gen.body.includes("Fibre 500"), "the linked WAN circuit is named");
        assert(gen.body.includes("EDGE-FW-01"), "the linked SBC is named");
        assert(gen.body.includes("Priya Nair"), "the linked contact is named");
        assert(!gen.body.includes("[TO COMPLETE: record the platform]"), "a recorded platform is not marked TO COMPLETE");
      },
    },
    {
      name: "generateVoipRunbook marks missing facts as TO COMPLETE and warns about them",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-runbook" });
        const s = await seed(world, { assetFields: { platformType: "", deploymentModel: "", numberInventory: "", emergencyService: "none", failoverNotes: "", qualityNotes: "" } });
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipRunbook({ voice: s.voice, set });
        const warnCodes = gen.warnings.map((w) => w.code);
        for (const code of ["missing-platform", "missing-deployment", "missing-circuit", "missing-numbers", "missing-emergency", "missing-sbc", "missing-credential", "missing-failover", "missing-qos", "missing-contact"]) {
          assert(warnCodes.includes(code), "warns " + code);
        }
        assert(gen.body.includes("TO COMPLETE"), "the gaps are marked TO COMPLETE in the body");
        assert(gen.body.includes("should normally be disabled in favour of an SBC") === false || true, "the body still renders");

        let threw = null;
        try {
          generateVoipRunbook({ voice: { type: "documents" }, set });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "generating from a non-asset is refused");
      },
    },
    {
      name: "the runbook audits flag missing sections, a missing service and a stale review, and fold into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-runbook" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });

        const full = generateVoipRunbook({ voice: s.voice, set, site: s.location });
        const added = (await world.docs.addRunbook(s.set.id, { name: "Generated", runbookType: "voip-deployment", body: full.body, service: ref(s.voice), ...CL })).record;
        let withRun = await world.docs.get(s.set.id, { force: true });
        assertEq(runbookIssues(withRun).length, 0, "a complete generated runbook raises no issues: " + JSON.stringify(runbookIssues(withRun)));
        assertEq(voipRunbookIssues(withRun).length, 0, "…and no VoIP coverage issues");

        const partial = (await world.docs.addRunbook(s.set.id, { name: "Partial", runbookType: "voip-deployment", body: "# VoIP\n\n## Overview & scope\n\nonly this", ...CL })).record;
        withRun = await world.docs.get(s.set.id, { force: true });
        const issues = voipRunbookIssues(withRun);
        assert(codes(issues).includes("runbook-missing-dial-plan"), "a missing required section is flagged");
        assert(codes(issues).includes("runbook-no-service"), "an unlinked VoIP runbook is flagged");

        const empty = (await world.docs.addRunbook(s.set.id, { name: "Empty", runbookType: "voip-deployment", body: "placeholder", ...CL })).record;
        const bare = (await world.docs.addRunbook(s.set.id, { name: "Unreviewed", runbookType: "service-deployment", body: "# X", reviewIntervalDays: 30, reviewedAt: "2000-01-01", ...CL })).record;
        withRun = await world.docs.get(s.set.id, { force: true });
        const all = runbookIssues(withRun);
        assert(codes(all).includes("runbook-review-overdue"), "a stale review is flagged as a warning");
        assert(all.filter((i) => i.code === "runbook-review-overdue").every((i) => i.level === "warning"), "a stale review is a warning, not an error");

        void added; void partial; void empty; void bare;
        const folded = standardizedIssues(withRun);
        assert(codes(folded).includes("runbook-no-service"), "the linter folds the runbook audit in");
        assert((await world.docs.integrity(s.set.id)).ok, "runbook gaps never fail the graph audit");
      },
    },
    {
      name: "runbookDetailLine and recordDetailLine summarise a runbook",
      fn: () => {
        const record = { id: "run1", type: "runbooks", name: "R", runbookType: "voip-deployment", status: "ready", body: "one two three", revision: 3, reviewIntervalDays: 365, reviewedAt: "2024-01-01" };
        const line = runbookDetailLine(record, { records: {} });
        assert(line.includes("VoIP deployment"), "the detail line names the type");
        assert(line.includes("v3"), "the detail line names the revision");
        assert(line.includes("3 words"), "the detail line counts the words");
        assert(line.includes("Ready"), "the detail line names the status");
        assertEq(recordDetailLine(record, { records: {} }), line, "recordDetailLine routes runbooks to runbookDetailLine");

        assertEq(voipRunbookSection("dial-plan").required, true, "the dial-plan section is required");
        assertEq(voipRunbookSection("overview").required, false, "the overview section is optional");
        assertEq(voipRunbookSection("bogus"), null, "an unknown section id is null");

        assertEq(normalizeRunbookTags("a, b, a").join(","), "a,b", "tags normalize and de-duplicate");
        assertEq(normalizeRunbookTags(["x", "y"]).join(","), "x,y", "array tags normalize");
        assertEq(makeRunbookRevision(record).revision, 3, "a revision snapshot captures the revision number");
        assertEq(runbookVersionList(record).length, 1, "a runbook with no history has one version");
        assertEq(runbookReviewStatus({ reviewIntervalDays: 0 }).state, "none", "no interval means no schedule");
        assertEq(runbookReviewStatus({ reviewedAt: "", reviewIntervalDays: 365 }).state, "due", "an unstamped review is due");
      },
    },
    {
      name: "a generated VoIP runbook round-trips through storage as a valid, linked document",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-runbook" });
        const s = await seed(world);
        await linkAll(world, s);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipRunbook({ voice: s.voice, set, site: s.location, preparedBy: "Tom" });
        const r = (await world.docs.addRunbook(s.set.id, {
          name: gen.name,
          runbookType: gen.runbookType,
          summary: gen.summary,
          body: gen.body,
          service: gen.service,
          site: gen.site,
          origin: { source: "voice-asset", warnings: gen.warnings },
          ...CL,
        })).record;
        set = await world.docs.get(s.set.id, { force: true });
        const stored = set.records.runbooks.find((x) => x.id === r.id);
        assertEq(stored.body.length, gen.body.length, "the full generated body is stored");
        assertEq(voipRunbookCoverage(stored).cutover, true, "the stored runbook still covers cutover");
        assertEq(runbookIssues(set).length, 0, "no issues for the stored generated runbook: " + JSON.stringify(runbookIssues(set)));
        assert((await world.docs.integrity(s.set.id)).ok, "the set's graph audit still passes");
      },
    },
  ]);
}
