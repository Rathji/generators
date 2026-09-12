// src/tests/playbook.test.js — validation tests for roadmap task 53
// (README & playbook). Run in the live page:
//   await import("./src/tests/playbook.test.js").then((m) => m.run())
//
// The playbook is documentation, so the things worth testing are the things
// that make documentation trustworthy: that it is DERIVED from the live
// catalogs (so a rename fails the build instead of the reader), that every
// extension guide is complete and points at real files, that the rendered
// markdown carries the required sections, and that the checked-in
// `src/PLAYBOOK.md` has not drifted from its generator.

import { runTests, assert, assertEq } from "./harness.js";
import {
  PLAYBOOK_SCHEMA,
  PLAYBOOK_FILES,
  contentModelReference,
  provenanceReference,
  relationshipReference,
  RELATIONSHIP_CONVENTIONS,
  DEPLOYMENT_FLOW,
  REDACTION_RULES,
  EXTENSION_KINDS,
  extensionGuides,
  extensionGuide,
  playbookCoverage,
  playbookToMarkdown,
} from "../framework/playbook.js";
import { INFORMATION_MODELS, PROVENANCE } from "../framework/classification.js";
import { RECORD_TYPES } from "../framework/docsets.js";
import { RELATIONSHIP_KINDS } from "../framework/relationships.js";
import { RUNBOOK_TYPES } from "../framework/runbook.js";
import { BUNDLE_TYPES } from "../framework/publication.js";
import { PACKET_KINDS } from "../framework/packet.js";

const fileSet = new Set(PLAYBOOK_FILES);

export async function run() {
  return runTests([
    {
      name: "the playbook declares a schema and derives its content model from the live classification catalog",
      fn: async () => {
        assertEq(PLAYBOOK_SCHEMA, "itu-playbook/1", "schema");
        const models = contentModelReference();
        assertEq(models.length, INFORMATION_MODELS.length, "one entry per information model");
        for (const m of INFORMATION_MODELS) {
          const ref = models.find((x) => x.id === m.id);
          assert(ref, "covers model " + m.id);
          assertEq(ref.label, m.label, "model label matches the catalog");
          assertEq(ref.description, m.description, "model description matches the catalog");
          assert(ref.recordTypes.length > 0, "model names its record types");
          for (const t of ref.recordTypes) assert(RECORD_TYPES.includes(t), "record type " + t + " exists");
        }
      },
    },
    {
      name: "the provenance guide mirrors the live provenance catalog including its required origin fields",
      fn: async () => {
        const prov = provenanceReference();
        assertEq(prov.length, PROVENANCE.length, "one entry per provenance");
        for (const p of PROVENANCE) {
          const ref = prov.find((x) => x.id === p.id);
          assert(ref, "covers provenance " + p.id);
          assertEq(ref.label, p.label, "provenance label");
          assertEq(ref.requires.join(","), (p.requires || []).join(","), "required origin fields for " + p.id);
        }
      },
    },
    {
      name: "the relationship reference reads the live kind catalog and the conventions explain the typed-link model",
      fn: async () => {
        const rel = relationshipReference();
        assertEq(rel.kindCount, RELATIONSHIP_KINDS.length, "kind count matches the catalog");
        assert(rel.kindCount > 100, "the catalog is substantial");
        assert(RELATIONSHIP_CONVENTIONS.length >= 4, "several conventions are documented");
        const text = RELATIONSHIP_CONVENTIONS.map((c) => c.title + " " + c.detail).join(" ");
        for (const needle of ["records.relationships", "RELATIONSHIP_KINDS", "relationsOf", "checkIntegrity"]) {
          assert(text.includes(needle), "conventions mention " + needle);
        }
      },
    },
    {
      name: "the deployment-doc flow explains how a service becomes an operational runbook and names its files",
      fn: async () => {
        assert(DEPLOYMENT_FLOW.length >= 4, "at least four stages");
        for (const s of DEPLOYMENT_FLOW) {
          assert(s.title && s.detail, "each stage has a title and detail");
          for (const f of s.files || []) assert(fileSet.has(f), "stage cites a known file: " + f);
        }
        const text = DEPLOYMENT_FLOW.map((s) => s.title + s.detail).join(" ");
        for (const needle of ["RUNBOOK_TYPES", "cutover", "generateVoipRunbook"]) {
          assert(text.includes(needle), "flow mentions " + needle);
        }
      },
    },
    {
      name: "the redaction rules state the default-deny posture and its leak guard",
      fn: async () => {
        assert(REDACTION_RULES.length >= 4, "several rules");
        const text = REDACTION_RULES.map((r) => r.title + " " + r.detail).join(" ");
        for (const needle of ["PUBLICATION_SCHEMA", "redactRecord", "scrubText", "validatePublication"]) {
          assert(text.includes(needle), "rules mention " + needle);
        }
      },
    },
    {
      name: "there is one complete extension guide for each required extension point",
      fn: async () => {
        const guides = extensionGuides();
        assertEq(guides.length, EXTENSION_KINDS.length, "one guide per kind");
        for (const kind of EXTENSION_KINDS) {
          const g = extensionGuide(kind.id);
          assert(g, "guide exists for " + kind.id);
          assertEq(g.id, kind.id, "guide id");
          assert(g.intro && g.intro.length > 40, "guide has an intro");
          assert(g.steps.length >= 5, g.id + " has at least five steps");
          for (const s of g.steps) {
            assert(s.title && s.detail, g.id + " step is complete");
            assert((s.files || []).length > 0, g.id + " step cites at least one file");
            for (const f of s.files) assert(fileSet.has(f), g.id + " step cites a known file: " + f);
          }
        }
        assertEq(extensionGuide("nope"), null, "an unknown kind returns null");
        const ids = guides.map((g) => g.id);
        for (const required of ["asset-type", "template", "runbook", "export"]) {
          assert(ids.includes(required), "the required extension point " + required + " is covered");
        }
      },
    },
    {
      name: "the coverage summary matches the live catalogs",
      fn: async () => {
        const cov = playbookCoverage();
        assertEq(cov.recordTypes.join(","), RECORD_TYPES.join(","), "record types");
        assertEq(cov.informationModels.join(","), INFORMATION_MODELS.map((m) => m.id).join(","), "information models");
        assertEq(cov.provenance.join(","), PROVENANCE.map((p) => p.id).join(","), "provenance");
        assertEq(cov.runbookTypes.join(","), RUNBOOK_TYPES.map((t) => t.id).join(","), "runbook types");
        assertEq(cov.bundleTypes.join(","), BUNDLE_TYPES.map((b) => b.id).join(","), "bundle types");
        assertEq(cov.packetKinds.join(","), PACKET_KINDS.map((k) => k.id).join(","), "packet kinds");
        assertEq(cov.relationshipKinds, RELATIONSHIP_KINDS.length, "relationship kinds");
      },
    },
    {
      name: "the rendered markdown carries every section, model, provenance and extension guide",
      fn: async () => {
        const md = playbookToMarkdown();
        assert(md.endsWith("\n"), "the document ends with a newline");
        for (const heading of [
          "# IT-U — Playbook",
          "## 1. The information model",
          "## 2. Provenance classifications",
          "## 3. Relationship conventions",
          "## 4. How deployment documentation is assembled",
          "## 5. The publication envelope & redaction",
          "## 6. Extension playbooks",
          "## 7. Coverage",
        ]) {
          assert(md.includes(heading), "markdown includes: " + heading);
        }
        for (const m of INFORMATION_MODELS) assert(md.includes(m.label), "markdown names model " + m.label);
        for (const p of PROVENANCE) assert(md.includes(p.label), "markdown names provenance " + p.label);
        for (const g of extensionGuides()) assert(md.includes(g.label), "markdown includes guide " + g.label);
      },
    },
    {
      name: "the checked-in src/PLAYBOOK.md has not drifted from its generator",
      fn: async () => {
        const res = await fetch(new URL("../PLAYBOOK.md", import.meta.url));
        assert(res.ok, "PLAYBOOK.md is reachable (status " + res.status + ")");
        const text = await res.text();
        const generated = playbookToMarkdown();
        assertEq(text, generated, "PLAYBOOK.md matches playbookToMarkdown() — regenerate it after changing playbook.js");
      },
    },
  ]);
}
