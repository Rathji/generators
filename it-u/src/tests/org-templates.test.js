// src/tests/org-templates.test.js — validation tests for the shipped starter
// (organization) templates. Run in the live page:
//   await import("./src/tests/org-templates.test.js").then((m) => m.run())
//
// Covers: the definitions are internally valid (unique records, known link
// kinds and endpoints, shipped asset types); the template service lists and
// resolves starters but keeps list() saved-only; applying each starter creates a
// new set whose records + links match the template and whose graph passes the
// integrity audit; the composed full-service starter is a superset that shares
// one organization; every seeded flexible asset validates against its built-in
// type; starters cannot be deleted; and every seeded record is classified.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { CLASSIFIED_TYPES } from "../framework/docsets.js";
import { isStarterId, listStarterTemplates, validateStarterDefinitions, starterTemplate } from "../framework/orgTemplates.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { validateAssetRecord } from "../framework/flexible.js";



const STARTER_IDS = ["starter-managed-it", "starter-voip", "starter-isp-connectivity", "starter-full-service"];

export async function run() {
  return runTests([
    {
      name: "the shipped starter definitions are internally valid",
      fn: async () => {
        const problems = validateStarterDefinitions();
        assertEq(problems.length, 0, "definition problems: " + problems.join(" | "));
      },
    },
    {
      name: "the starter catalog exposes the four built-ins with record counts",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        const starters = world.templates.listBuiltin();
        assertEq(starters.length, 4, "four starters");
        assertEq(
          starters.map((s) => s.id).sort().join(","),
          [...STARTER_IDS].sort().join(","),
          "ids",
        );
        for (const s of starters) {
          assert(s.builtin === true, s.id + " is marked built-in");
          assert(s.counts.records > 0, s.id + " has records");
          assert(s.counts.links > 0, s.id + " has links");
          assert(typeof s.name === "string" && s.name.length > 0, s.id + " has a name");
        }
      },
    },
    {
      name: "starter ids are recognised by the template service and resolve to a full template",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        for (const id of STARTER_IDS) {
          assert(isStarterId(id), id + " recognised");
          assert(world.templates.isStarterId(id), id + " recognised by the service");
          const tpl = await world.templates.get(id);
          assert(tpl, id + " resolves");
          assertEq(tpl.id, id, "resolved id");
          assertEq(tpl.records.length, tpl.counts.records, id + " record count matches");
          assertEq(tpl.links.length, tpl.counts.links, id + " link count matches");
        }
        assert(!isStarterId("template-foo"), "saved template ids are not starters");
        assertEq(await world.templates.get("template-missing"), null, "unknown template is null");
        assertEq(starterTemplate("nope"), null, "unknown starter is null");
      },
    },
    {
      name: "applying each starter creates a new set whose records and links match and whose graph is sound",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        for (const s of listStarterTemplates()) {
          const res = await world.templates.apply(s.id, { name: "Client " + s.id, createdBy: "alice" });
          const set = res.set;
          assert(set && set.id, s.id + " created a set");
          assertEq(res.setRecordCount, s.counts.records, s.id + " recreated every record");
          assertEq(res.links, s.counts.links, s.id + " recreated every link");
          assertEq(set.records.organizations.length, 1, s.id + " has one organization");
          assert(set.records.locations.length >= 1, s.id + " has a location");
          assert(set.records.contacts.length >= 2, s.id + " has contacts");
          assert(set.records.configurations.length >= 1, s.id + " has configurations");
          const audit = await world.docs.integrity(set.id);
          assert(audit.ok, s.id + " integrity: " + audit.issues.filter((i) => i.level === "error").map((i) => i.message).join(" | "));
        }
      },
    },
    {
      name: "every seeded flexible asset validates against its built-in type",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        for (const s of listStarterTemplates()) {
          const res = await world.templates.apply(s.id, { name: "Assets " + s.id, createdBy: "alice" });
          const assets = res.set.records.flexibleAssets;
          assert(assets.length > 0, s.id + " seeds flexible assets");
          for (const r of assets) {
            const type = builtinAssetType(r.assetTypeId);
            assert(type, s.id + ": “" + r.name + "” uses a shipped asset type");
            const v = validateAssetRecord(type, r);
            assert(v.ok, s.id + ": “" + r.name + "” — " + v.errors.join(" "));
          }
        }
      },
    },
    {
      name: "every seeded record carries a classification",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        const res = await world.templates.apply("starter-full-service", { name: "Classified", createdBy: "alice" });
        for (const t of CLASSIFIED_TYPES) {
          for (const r of res.set.records[t] || []) {
            assert(r.informationModel, t + " “" + r.name + "” has an information model");
            assert(r.provenance, t + " “" + r.name + "” has a provenance");
          }
        }
      },
    },
    {
      name: "the composed full-service starter is a superset that shares one organization",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        const it = listStarterTemplates().find((s) => s.id === "starter-managed-it");
        const voip = listStarterTemplates().find((s) => s.id === "starter-voip");
        const full = listStarterTemplates().find((s) => s.id === "starter-full-service");
        assert(full.counts.records > it.counts.records, "full service has more records than managed IT");
        assert(full.counts.records > voip.counts.records, "full service has more records than VoIP");
        assert(full.counts.links > it.counts.links, "full service has more links than managed IT");
        const res = await world.templates.apply(full.id, { name: "Everything", createdBy: "alice" });
        assertEq(res.set.records.organizations.length, 1, "the three starters share one organization");
        assertEq(res.set.records.locations.length, 1, "and one head-office location");
        // Both the voice and the connectivity records survive the merge.
        assert(res.set.records.flexibleAssets.some((r) => r.assetTypeId === "atype-voice-pbx"), "voice platform present");
        assert(res.set.records.flexibleAssets.some((r) => r.assetTypeId === "atype-wan-circuit"), "circuit present");
        assert(res.set.records.runbooks.length >= 2, "both runbooks present");
      },
    },
    {
      name: "list() stays saved-only while listAll() includes the built-ins, and starters cannot be deleted",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-orgtpl", templates: true });
        const set = await world.docs.create({ name: "Acme" });
        await world.docs.addRecord(set.id, { type: "organizations", name: "Acme HQ", orgKind: "organization", informationModel: "core-asset", provenance: "authored" });
        const { template } = await world.templates.saveAsTemplate(set.id, { name: "My house standard", createdBy: "alice" });

        assertEq((await world.templates.list()).length, 1, "list() shows only the saved template");
        assertEq(template.id, "template-my-house-standard", "saved template id");
        assertEq((await world.templates.listAll()).length, 5, "listAll() adds the four built-ins");

        const refused = await world.templates.remove("starter-managed-it");
        assertEq(refused.changed, false, "removing a starter is refused");
        assertEq(refused.builtin, true, "and says why");
        assert(await world.templates.get("starter-managed-it"), "the starter still resolves");
        assertEq((await world.templates.listAll()).length, 5, "still five templates");

        const removed = await world.templates.remove(template.id);
        assertEq(removed.changed, true, "a saved template can still be removed");
        assertEq((await world.templates.listAll()).length, 4, "back to the four built-ins");
      },
    },
  ]);
}
