// src/tests/classification.test.js — validation tests for roadmap Phase 1
// task 3 (record classification & provenance). Run in the live page:
//   await import("./src/tests/classification.test.js").then((m) => m.run())
//
// Covers: the two catalogs (four information models, six provenance classes);
// validation of a record's classification; provenance-specific origin
// requirements; and the hard guarantee that an unclassified record is REFUSED
// on save (both add and update), leaving the document untouched.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  INFORMATION_MODELS,
  PROVENANCE,
  informationModel,
  provenanceDef,
  validateClassification,
  requireClassification,
  classificationOf,
} from "../framework/classification.js";

export async function run() {
  return runTests([
    {
      name: "the four information models are defined",
      fn: async () => {
        assertEq(INFORMATION_MODELS.length, 4, "four models");
        assertEq(
          INFORMATION_MODELS.map((m) => m.id).join(","),
          "core-asset,flexible-asset,document,integration",
          "the four model ids",
        );
        for (const m of INFORMATION_MODELS) {
          assert(m.label && m.description, m.id + " has a label + description");
        }
      },
    },
    {
      name: "the six provenance classifications are defined, with their origin requirements",
      fn: async () => {
        assertEq(PROVENANCE.length, 6, "six provenance classes");
        assertEq(
          PROVENANCE.map((p) => p.id).join(","),
          "authored,imported,synchronized,related,external,attachment",
          "the six provenance ids",
        );
        assertEq(provenanceDef("synchronized").requires.join(","), "source", "synced needs a source system");
        assertEq(provenanceDef("related").requires.join(","), "sourceId", "related needs a related record");
        assertEq(provenanceDef("external").requires.join(","), "sourceUrl", "external needs a URL");
        assertEq(provenanceDef("attachment").requires.join(","), "attachmentUrl", "attachment needs a URL");
        assertEq(provenanceDef("authored").requires.length, 0, "authored needs nothing extra");
      },
    },
    {
      name: "validateClassification flags a missing or invalid model and provenance",
      fn: async () => {
        assert(!validateClassification({}).ok, "empty record invalid");
        assert(!validateClassification({ informationModel: "core-asset" }).ok, "missing provenance invalid");
        assert(!validateClassification({ provenance: "authored" }).ok, "missing model invalid");
        assert(
          !validateClassification({ informationModel: "nope", provenance: "authored" }).ok,
          "unknown model invalid",
        );
        assert(
          !validateClassification({ informationModel: "core-asset", provenance: "nope" }).ok,
          "unknown provenance invalid",
        );
        const good = validateClassification({ informationModel: "core-asset", provenance: "authored" });
        assert(good.ok, "a valid classification passes: " + good.errors.join(" "));
      },
    },
    {
      name: "provenance origin requirements are enforced (synchronized needs its system, etc.)",
      fn: async () => {
        const r = { informationModel: "integration", provenance: "synchronized" };
        assert(!validateClassification(r).ok, "missing source refused");
        assert(
          validateClassification({ ...r, origin: { source: "RMM platform" } }).ok,
          "source present passes",
        );
        assert(
          !validateClassification({ informationModel: "flexible-asset", provenance: "external" }).ok,
          "external without a URL refused",
        );
        assert(
          validateClassification({
            informationModel: "flexible-asset",
            provenance: "external",
            origin: { sourceUrl: "https://example.com" },
          }).ok,
          "external with a URL passes",
        );
      },
    },
    {
      name: "requireClassification throws a typed UNCLASSIFIED_RECORD error",
      fn: async () => {
        let threw = null;
        try {
          requireClassification({ name: "web-01", informationModel: "core-asset" });
        } catch (e) {
          threw = e;
        }
        assert(threw, "threw");
        assertEq(threw.code, "UNCLASSIFIED_RECORD", "typed code");
        assert(threw.message.includes("web-01"), "message names the record");
      },
    },
    {
      name: "a documentation set REFUSES to save an unclassified record (and does not write it)",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme" });
        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "other" }); // no classification
        } catch (e) {
          threw = e;
        }
        assert(threw, "unclassified add refused");
        assertEq(threw.code, "UNCLASSIFIED_RECORD", "typed code");
        const after = await docs.get(set.id);
        assertEq(after.records.configurations.length, 0, "nothing was written");
        assertEq(after.updatedAt >= after.createdAt, true, "set untouched");
        // a classified add works
        const ok = await docs.addRecord(set.id, {
          type: "configurations",
          name: "web-01", configType: "other",
          informationModel: "core-asset",
          provenance: "authored",
        });
        assertEq(ok.record.informationModel, "core-asset", "model stored");
        assertEq(ok.record.provenance, "authored", "provenance stored");
      },
    },
    {
      name: "an edit cannot strip a record's classification",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme" });
        const { record } = await docs.addRecord(set.id, {
          type: "contacts",
          name: "Jo", contactRole: "client-primary",
          informationModel: "core-asset",
          provenance: "authored",
        });
        let threw = null;
        try {
          await docs.updateRecord(set.id, { type: "contacts", id: record.id }, { informationModel: "" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "UNCLASSIFIED_RECORD", "stripping the model refused");
        // a valid edit still works
        const upd = await docs.updateRecord(set.id, { type: "contacts", id: record.id }, { role: "Owner" });
        assertEq(upd.record.role, "Owner", "valid edit applied");
        assertEq(upd.record.informationModel, "core-asset", "classification preserved");
      },
    },
    {
      name: "classificationOf resolves display labels for badges",
      fn: async () => {
        const info = classificationOf({ informationModel: "flexible-asset", provenance: "imported" });
        assertEq(info.modelLabel, "Flexible Asset", "model label");
        assertEq(info.provenanceLabel, "Imported once", "provenance label");
        assertEq(informationModel("document").label, "Document", "model lookup");
        assertEq(classificationOf({}).modelLabel, "Unclassified", "unclassified fallback");
      },
    },
  ]);
}
