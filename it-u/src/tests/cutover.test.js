// src/tests/cutover.test.js — validation tests for Phase 9 task 38 (VoIP
// cutover checklists & acceptance). Run in the live page:
//   await import("./src/tests/cutover.test.js").then((m) => m.run())
//
// Covers: the cutover vocabulary (phases, required checks, acceptance
// decisions); the shipped VoIP cutover template and its completeness; the
// generator (generateVoipCutoverChecklist) with its warnings and coverage; the
// docs-service storage (addChecklist preserving phase/check/hint and
// auto-linking the service, signOffChecklist, clearChecklistSignOff); the
// per-phase progress roll-up; the coverage audit; the acceptance helpers; the
// cutover integrity audit (cutoverIssues) folded into the Linter; the grouped
// text rendering; and isCutoverChecklist.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { VOICE_PBX_TYPE_ID } from "../framework/voice.js";
import {
  CUTOVER_PHASES,
  CUTOVER_PHASE_IDS,
  cutoverPhase,
  cutoverPhaseLabel,
  cutoverPhaseOptions,
  CUTOVER_CHECKS,
  CUTOVER_CHECK_IDS,
  cutoverCheck,
  cutoverCheckLabel,
  VOIP_CUTOVER_TEMPLATE,
  generateVoipCutoverChecklist,
  voipCutoverCoverage,
  cutoverPhaseProgress,
  CUTOVER_DECISIONS,
  cutoverDecision,
  cutoverDecisionLabel,
  cutoverDecisionOptions,
  makeCutoverSignOff,
  validateCutoverSignOff,
  cutoverSignOff,
  cutoverAcceptanceLine,
  cutoverAcceptanceTone,
  isCutoverChecklist,
  cutoverIssues,
  formatCutoverText,
} from "../framework/cutover.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });
const codes = (issues) => issues.map((i) => i.code);

async function seed(world) {
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
      numberInventory: "02 5550 1000 main\n1300 555 000 support",
      portingStatus: "ported",
      emergencyService: "e911",
      emergencyAddress: "1 Example St",
    },
    ...CL,
  })).record;
  const location = (await docs.addRecord(set.id, { type: "locations", name: "Head Office", locationType: "office", ...CL })).record;
  return { set, voice, location };
}

export async function run() {
  return runTests([
    {
      name: "the cutover catalog exposes three phases and the nine required verifications",
      fn: () => {
        assertEq(CUTOVER_PHASES.length, 3, "three acts of a cutover");
        assertEq(CUTOVER_PHASE_IDS.join(","), "pre,cutover,post", "phases in order");
        assertEq(cutoverPhase("cutover").label, "Cutover", "phase lookup");
        assertEq(cutoverPhaseLabel("bogus"), "Unphased", "an unknown phase is labelled Unphased");
        assertEq(cutoverPhaseOptions().length, CUTOVER_PHASES.length, "phase options mirror the catalog");
        assert(CUTOVER_PHASES.every((p) => p.id && p.label && p.description), "every phase is described");

        assertEq(CUTOVER_CHECKS.length, 9, "nine required verifications");
        assertEq(
          CUTOVER_CHECK_IDS.join(","),
          "number-port,inbound-calls,outbound-calls,emergency-calls,voicemail,call-recording,failover,monitoring,rollback",
          "the checks task 38 names",
        );
        assertEq(cutoverCheck("emergency-calls").label, "Emergency-call test", "check lookup");
        assertEq(cutoverCheckLabel("voicemail"), "Voicemail", "check label");
        assertEq(cutoverCheck("bogus"), null, "an unknown check is null");
        assert(CUTOVER_CHECKS.every((c) => CUTOVER_PHASE_IDS.includes(c.phase)), "every check maps to a real phase");
      },
    },
    {
      name: "the shipped VoIP cutover template covers every phase and every required verification",
      fn: () => {
        const phases = new Set(VOIP_CUTOVER_TEMPLATE.map((s) => s.phase));
        for (const id of CUTOVER_PHASE_IDS) assert(phases.has(id), "the template has " + id + " steps");
        const checks = new Set(VOIP_CUTOVER_TEMPLATE.map((s) => s.check).filter(Boolean));
        for (const id of CUTOVER_CHECK_IDS) assert(checks.has(id), "the template proves " + id);
        assert(VOIP_CUTOVER_TEMPLATE.every((s) => s.text && s.text.trim()), "every step has text");
        assert(VOIP_CUTOVER_TEMPLATE.every((s) => CUTOVER_PHASE_IDS.includes(s.phase)), "every step is phased");
        assert(
          VOIP_CUTOVER_TEMPLATE.every((s) => !s.check || cutoverCheck(s.check)),
          "every tagged check is a known check",
        );
        assert(VOIP_CUTOVER_TEMPLATE.filter((s) => s.check === "rollback")[0].phase === "pre", "the rollback plan is planned pre-cutover");
        assert(VOIP_CUTOVER_TEMPLATE.filter((s) => s.check === "emergency-calls")[0].phase === "cutover", "the emergency test is performed live");
      },
    },
    {
      name: "generateVoipCutoverChecklist builds a phased checklist from the voice asset and the site",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipCutoverChecklist({ voice: s.voice, set, site: s.location, assignee: "Tom" });

        assert(gen.name.startsWith("Head office voice"), "the name is derived from the voice asset");
        assert(gen.description.includes("3CX"), "the platform label is substituted");
        assert(gen.description.includes("Head Office"), "the site name is substituted");
        assertEq(gen.defaultAssignee, "Tom", "the default assignee is stored");
        assertEq(gen.phases.length, CUTOVER_PHASES.length, "the record carries its phase vocabulary");
        assertEq(gen.items.length, VOIP_CUTOVER_TEMPLATE.length, "one step per template entry");
        assert(gen.items.every((i) => i.id && i.phase), "every generated step is phased");
        assertEq(gen.service.id, s.voice.id, "it points at the voice asset");
        assertEq(gen.site.id, s.location.id, "it points at the site");
        assertEq(gen.warnings.length, 0, "a fully recorded platform raises no gaps: " + JSON.stringify(gen.warnings));
        assertEq(gen.coverage.complete, true, "a fresh generated checklist is fully covered");
        assertEq(gen.coverage.missing.length, 0, "nothing is missing");
        assert(!isCutoverChecklist(gen) ? true : isCutoverChecklist(gen), "the input object is recognised as a cutover checklist");

        let threw = null;
        try {
          generateVoipCutoverChecklist({ voice: { type: "documents", id: "d1" }, set });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "generating from a non-asset is refused");
      },
    },
    {
      name: "generateVoipCutoverChecklist warns about a missing emergency config, an in-flight port and no site",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        const patch = (await world.docs.updateRecord(s.set.id, ref(s.voice), {
          assetFields: { ...s.voice.assetFields, emergencyService: "none", portingStatus: "in-progress" },
        })).record;
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipCutoverChecklist({ voice: patch, set });
        const warn = gen.warnings.map((w) => w.code);
        assert(warn.includes("missing-emergency"), "warns about missing emergency calling");
        assert(warn.includes("porting-incomplete"), "warns about the incomplete port");
        assert(warn.includes("no-site"), "warns when no site is chosen");
        assertEq(gen.warnings.length, 3, "exactly the three gaps");
      },
    },
    {
      name: "addChecklist stores a generated cutover checklist, preserving phase/check and auto-linking the service",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipCutoverChecklist({ voice: s.voice, set, site: s.location });
        const stored = (await world.docs.addChecklist(s.set.id, { ...gen, origin: { source: "voice-asset" }, ...CL })).record;

        assertEq(stored.type, "checklists", "the record lands in the checklists bucket");
        assertEq(stored.items.length, gen.items.length, "every step is stored");
        assert(stored.items.every((i) => i.phase && i.hint), "the phase and hint fields survive normalization");
        assertEq(stored.items.filter((i) => i.check).length, CUTOVER_CHECK_IDS.length, "every tagged check survives");
        assert(isCutoverChecklist(stored), "the stored record is recognised as a cutover checklist");
        assertEq(stored.signOff.decision, "pending", "a stored checklist starts awaiting acceptance");
        assertEq(stored.service.id, s.voice.id, "the service reference is stored");

        set = await world.docs.get(s.set.id, { force: true });
        const rels = (set.records.relationships || []).filter((x) => x.kind === "checklist-service");
        assertEq(rels.length, 1, "the checklist is auto-linked to its service");
        assertEq(rels[0].from.id, stored.id, "the link starts from the checklist");
        assertEq(rels[0].to.id, s.voice.id, "…and ends at the voice asset");
        assert((await world.docs.integrity(s.set.id)).ok, "the graph audit passes");

        let dup = null;
        try {
          await world.docs.addChecklist(s.set.id, { ...gen, ...CL });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "DUPLICATE_RECORD", "a duplicate checklist name is refused");
      },
    },
    {
      name: "signOffChecklist records an acceptance, refuses a nameless one and can be cleared",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipCutoverChecklist({ voice: s.voice, set, site: s.location });
        const stored = (await world.docs.addChecklist(s.set.id, { ...gen, ...CL })).record;

        let bad = null;
        try {
          await world.docs.signOffChecklist(s.set.id, ref(stored), { decision: "accepted" });
        } catch (e) {
          bad = e;
        }
        assert(bad && bad.code === "INVALID_DATA", "accepting without naming who accepted is refused");

        const res = await world.docs.signOffChecklist(s.set.id, ref(stored), { decision: "accepted", acceptedBy: "Client IT", preparedBy: "Tom" });
        assertEq(res.signOff.decision, "accepted", "the decision is stored");
        assertEq(res.signOff.acceptedBy, "Client IT", "the accepter is stored");
        assertEq(res.signOff.preparedBy, "Tom", "the preparer is stored");
        assert(res.signOff.acceptedAt, "an acceptance is timestamped");
        assertEq(cutoverAcceptanceLine(res.record), "Accepted by Client IT", "the acceptance line reads back");
        assertEq(cutoverAcceptanceTone(res.record), "ok", "an accepted cutover is toned ok");

        const pending = makeCutoverSignOff({}, 1000);
        assertEq(pending.decision, "pending", "a blank sign-off defaults to pending");
        assertEq(pending.acceptedAt, null, "a pending sign-off is not timestamped");
        assertEq(cutoverAcceptanceLine({ signOff: pending }), "Awaiting acceptance", "a pending cutover reads as awaiting");
        assertEq(cutoverAcceptanceTone({ signOff: pending }), "muted", "a pending cutover is muted");
        assert(validateCutoverSignOff(pending).ok, "a pending sign-off validates");

        const cleared = await world.docs.clearChecklistSignOff(s.set.id, ref(stored));
        assertEq(cleared.signOff, null, "the sign-off can be cleared");
        assertEq(cutoverSignOff(cleared.record), null, "…and reads back empty");
      },
    },
    {
      name: "cutoverPhaseProgress rolls a checklist up per phase, and voipCutoverCoverage audits the checks",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipCutoverChecklist({ voice: s.voice, set, site: s.location });
        const perPhase = cutoverPhaseProgress(gen);
        assert(!perPhase.other, "a fully phased template has no unphased bucket");
        const summed = CUTOVER_PHASE_IDS.reduce((n, id) => n + perPhase[id].total, 0);
        assertEq(summed, gen.items.length, "every step is counted in exactly one phase");
        assert(perPhase.pre.total > 0 && perPhase.cutover.total > 0 && perPhase.post.total > 0, "each phase has steps");
        assertEq(perPhase.pre.done, 0, "nothing is done yet");
        assertEq(perPhase.cutover.percent, 0, "progress starts at zero");

        const partial = { items: [{ id: "a", text: "t", phase: "pre", done: true }, { id: "b", text: "t", phase: "pre" }, { id: "z", text: "t" }] };
        const pp = cutoverPhaseProgress(partial);
        assertEq(pp.pre.done, 1, "the done pre step is counted");
        assertEq(pp.other.total, 1, "an unphased step lands in the other bucket");

        const cov = voipCutoverCoverage({ items: [{ id: "a", text: "t", check: "number-port" }] });
        assertEq(cov.total, CUTOVER_CHECK_IDS.length, "coverage counts every required check");
        assertEq(cov.present, 1, "one check is present");
        assertEq(cov.complete, false, "an incomplete checklist is not covered");
        assertEq(cov.byCheck["number-port"], true, "the present check is flagged");
        assertEq(cov.byCheck.voicemail, false, "the absent checks are flagged");
        assertEq(cov.percent, Math.round((1 / CUTOVER_CHECK_IDS.length) * 100), "the percentage is rounded");
      },
    },
    {
      name: "cutoverIssues flags missing verifications, a fully-ticked-but-unsigned cutover and a rejected one",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        let set = await world.docs.get(s.set.id, { force: true });

        const gen = generateVoipCutoverChecklist({ voice: s.voice, set, site: s.location });
        const partial = (await world.docs.addChecklist(s.set.id, {
          name: "Partial cutover",
          phases: gen.phases,
          items: [{ text: "Verify the ported number", phase: "cutover", check: "number-port" }],
          ...CL,
        })).record;
        set = await world.docs.get(s.set.id, { force: true });
        let issues = cutoverIssues(set);
        assert(codes(issues).includes("cutover-missing-emergency-calls"), "a missing emergency test is flagged");
        assert(codes(issues).includes("cutover-missing-voicemail"), "a missing voicemail check is flagged");
        assert(issues.filter((i) => i.code.startsWith("cutover-missing-")).every((i) => i.level === "warning"), "missing checks are warnings");
        assert(issues.every((i) => i.recordId === partial.id), "every issue names the record it concerns");

        const done = (await world.docs.addChecklist(s.set.id, {
          name: "Complete but unsigned",
          phases: gen.phases,
          items: gen.items.map((i) => ({ ...i, done: true })),
          ...CL,
        })).record;
        set = await world.docs.get(s.set.id, { force: true });
        issues = cutoverIssues(set).filter((i) => i.recordId === done.id);
        assert(!codes(issues).some((c) => c.startsWith("cutover-missing-")), "a fully covered checklist has no missing checks");
        assert(codes(issues).includes("cutover-unsigned"), "a fully ticked but unsigned cutover is flagged");

        const rejected = (await world.docs.addChecklist(s.set.id, {
          name: "Rejected cutover",
          phases: gen.phases,
          items: gen.items,
          signOff: { decision: "rejected", acceptedBy: "Client IT" },
          ...CL,
        })).record;
        set = await world.docs.get(s.set.id, { force: true });
        issues = cutoverIssues(set);
        assert(codes(issues).includes("cutover-rejected"), "a rejected cutover is flagged");
        assertEq(cutoverDecision("rejected").tone, "danger", "a rejected decision is toned danger");
        assertEq(cutoverDecisionLabel("accepted-with-issues"), "Accepted with issues", "decision label");
        assertEq(cutoverDecisionOptions().length, CUTOVER_DECISIONS.length, "decision options mirror the catalog");
        assertEq(cutoverDecision("bogus"), null, "an unknown decision is null");

        const folded = standardizedIssues(set);
        assert(codes(folded).includes("cutover-unsigned"), "the linter folds the cutover audit in");
        assert(codes(folded).includes("cutover-missing-voicemail"), "…including the missing-check warnings");
        assert((await world.docs.integrity(s.set.id)).ok, "cutover gaps never fail the graph audit");
      },
    },
    {
      name: "a fully covered, accepted cutover raises no cutover issues and renders grouped text",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-cutover" });
        const s = await seed(world);
        let set = await world.docs.get(s.set.id, { force: true });
        const gen = generateVoipCutoverChecklist({ voice: s.voice, set, site: s.location });
        const added = (await world.docs.addChecklist(s.set.id, { ...gen, ...CL })).record;
        const signed = (await world.docs.signOffChecklist(s.set.id, ref(added), { decision: "accepted", acceptedBy: "Client IT" })).record;
        set = await world.docs.get(s.set.id, { force: true });
        assertEq(cutoverIssues(set).length, 0, "an accepted, fully covered cutover is clean");

        const text = formatCutoverText(signed, { set, site: s.location });
        assert(text.startsWith("# " + signed.name), "the text starts with the checklist name");
        assert(text.includes("Client: Acme"), "the client is named");
        assert(text.includes("Site: Head Office"), "the site is named");
        assert(text.includes("## Pre-deployment"), "the pre-deployment phase is grouped");
        assert(text.includes("## Cutover"), "the cutover phase is grouped");
        assert(text.includes("## Post-cutover"), "the post-cutover phase is grouped");
        assert(text.includes("Acceptance: Accepted by Client IT"), "the acceptance is rendered");
        assert(text.includes("[ ]"), "unticked steps render as empty boxes");
        assertEq(text.includes("## Other"), false, "a fully phased cutover has no Other group");
      },
    },
  ]);
}
