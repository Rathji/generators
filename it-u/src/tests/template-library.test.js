// src/tests/template-library.test.js — validation tests for Phase 3 task 13
// (the template library & sharing). Run in the live page:
//   await import("./src/tests/template-library.test.js").then((m) => m.run())
//
// Covers: the shipped library (Applications, Licensing, Virtualization + the
// service templates) seeding and validating; the library being GLOBAL — a type
// authored once is visible to every client and to a fresh service on the same
// store; editing a shipped template in place (marked customized) and resetting
// it to the shipped definition; cloning / protected removal / restore; the
// export→import round-trip for sharing house standards; and the picker options.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { createMemoryCache } from "../framework/store/backends.js";
import { createFlexibleTypeService } from "../framework/flexibleTypes.js";
import { validateAssetType } from "../framework/flexible.js";
import { BUILTIN_ASSET_TYPES, BUILTIN_ASSET_TYPE_IDS } from "../framework/assetLibrary.js";



export async function run() {
  return runTests([
    {
      name: "the library seeds Applications, Licensing and Virtualization plus the service templates, all valid",
      fn: async () => {
        const { assetTypes } = makeWorld({ namespace: "kb-lib", assetTypes: true });
        const types = await assetTypes.list();
        assertEq(types.length, BUILTIN_ASSET_TYPES.length, "one entry per shipped template");
        const ids = types.map((t) => t.id);
        assert(ids.includes("atype-applications"), "Applications shipped");
        assert(ids.includes("atype-licences"), "Licensing shipped");
        assert(ids.includes("atype-virtualization"), "Virtualization shipped");
        assert(ids.includes("atype-email-system"), "the email service template shipped");
        assert(ids.includes("atype-backup-service"), "the backup service template shipped");
        assert(ids.includes("atype-wan-circuit"), "the WAN circuit template shipped");
        assert(types.every((t) => t.builtin), "everything seeded is a builtin");
        assert(types.every((t) => validateAssetType(t).ok), "every shipped template validates");
        assert(BUILTIN_ASSET_TYPE_IDS.length === BUILTIN_ASSET_TYPES.length, "the id list matches the shipped set");

        const apps = await assetTypes.get("atype-applications");
        assertEq(apps.category, "applications", "Applications category");
        assert(apps.fields.some((f) => f.key === "applicationType" && f.required), "Applications requires a type");
        assert(assetTypes.isBuiltin("atype-applications"), "isBuiltin distinguishes shipped templates");
        assert(!assetTypes.isBuiltin("atype-not-real"), "unknown id is not builtin");

        const meta = await assetTypes.libraryMeta();
        assertEq(meta.count, BUILTIN_ASSET_TYPES.length, "meta counts the library");
        assertEq(meta.builtinCount, BUILTIN_ASSET_TYPES.length, "all builtin");
        assertEq(meta.customCount, 0, "no custom types yet");
        assertEq(meta.customizedCount, 0, "nothing customized yet");

        const commercial = await assetTypes.list({ category: "commercial" });
        assert(commercial.length > 0, "the commercial category has templates");
        assert(commercial.every((t) => t.category === "commercial"), "category filter applies");
      },
    },
    {
      name: "the library is global: a type authored once is shared by every client and a fresh service on the same store",
      fn: async () => {
        const { store, assetTypes } = makeWorld({ namespace: "kb-lib", assetTypes: true });
        await assetTypes.list();
        const created = await assetTypes.create({ name: "House Widget", category: "custom", fields: [{ label: "Serial", type: "text", required: true }] });
        assertEq(created.type.builtin, false, "authored types are not builtin");
        assertEq(created.type.name, "House Widget", "name kept");
        assert((await assetTypes.list()).some((t) => t.id === created.type.id), "the new type is in the global list");

        const second = createFlexibleTypeService({ store, cache: createMemoryCache() });
        const seen = await second.list();
        assert(seen.some((t) => t.id === created.type.id), "a fresh service on the same store sees the shared type");
        assertEq((await second.libraryMeta()).customCount, 1, "the custom type is counted");

        let threw = null;
        try {
          await second.create({ name: "", fields: [] });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a nameless type is refused");
      },
    },
    {
      name: "a shipped template can be adapted in place (marked customized) and reset to the shipped definition",
      fn: async () => {
        const { assetTypes } = makeWorld({ namespace: "kb-lib", assetTypes: true });
        const shipped = await assetTypes.get("atype-applications");
        const before = shipped.fields.length;
        await assetTypes.update("atype-applications", { name: "Applications (house standard)", fields: [...shipped.fields, { label: "Approved by", type: "text" }] });
        const edited = await assetTypes.get("atype-applications");
        assertEq(edited.name, "Applications (house standard)", "edited in place");
        assertEq(edited.customized, true, "an edited builtin is marked customized");
        assertEq(edited.fields.length, before + 1, "the house field was added");
        assertEq((await assetTypes.libraryMeta()).customizedCount, 1, "meta counts the customization");

        await assetTypes.reset("atype-applications");
        const restored = await assetTypes.get("atype-applications");
        assertEq(restored.name, "Applications", "reset restores the shipped name");
        assertEq(restored.fields.length, before, "reset restores the shipped fields");
        assertEq(restored.customized, false, "reset clears the customized flag");

        const { type: copy } = await assetTypes.clone("atype-applications", { name: "Our Applications" });
        assertEq(copy.name, "Our Applications", "clone renamed");
        assertEq(copy.builtin, false, "a clone is not builtin");
        assert(copy.id !== "atype-applications", "a clone gets a new id");
        assertEq(copy.fields.length, before, "a clone carries the shipped fields");
        assertEq((await assetTypes.get("atype-applications")).name, "Applications", "cloning leaves the shipped template untouched");

        let threw = null;
        try {
          await assetTypes.reset("atype-not-real");
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "UNKNOWN_RECORD", "resetting an unknown id is refused");
      },
    },
    {
      name: "a shipped template is protected from deletion, can be removed with force, and the library can be restored",
      fn: async () => {
        const { assetTypes } = makeWorld({ namespace: "kb-lib", assetTypes: true });
        await assetTypes.list();
        let threw = null;
        try {
          await assetTypes.remove("atype-applications");
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "an unforced removal of a shipped template is refused");

        await assetTypes.remove("atype-applications", { force: true });
        assertEq(await assetTypes.get("atype-applications"), null, "forced removal deletes the shipped copy");
        assertEq((await assetTypes.libraryMeta()).count, BUILTIN_ASSET_TYPES.length - 1, "one fewer type");

        const { added } = await assetTypes.restoreLibrary();
        assert(added.includes("atype-applications"), "restore re-adds the missing builtin");
        assert(await assetTypes.get("atype-applications"), "the builtin is back");
        assertEq((await assetTypes.restoreLibrary()).added.length, 0, "a second restore is a no-op");

        const { type } = await assetTypes.create({ name: "Temporary", fields: [] });
        await assetTypes.remove(type.id);
        assertEq(await assetTypes.get(type.id), null, "a custom type can be removed freely");
      },
    },
    {
      name: "a house standard can be exported and imported as portable JSON, with junk refused",
      fn: async () => {
        const { assetTypes } = makeWorld({ namespace: "kb-lib", assetTypes: true });
        await assetTypes.list();
        const created = await assetTypes.create({
          name: "House Widget",
          category: "custom",
          description: "A widget",
          fields: [{ label: "Serial", type: "text", required: true }, { label: "Kind", type: "select", options: [{ id: "a", label: "A" }] }],
          references: ["configurations"],
        });
        const json = await assetTypes.exportType(created.type.id);
        const parsed = JSON.parse(json);
        assertEq(parsed.kind, "itu-asset-type-export", "export envelope is labelled");
        assertEq(parsed.type.name, "House Widget", "the type travels in the envelope");

        const { type: imported } = await assetTypes.importType(json);
        assertEq(imported.name, "House Widget", "import keeps the name");
        assert(imported.id !== created.type.id, "import mints a fresh id");
        assertEq(imported.fields.length, 2, "fields travel");
        assertEq(imported.references.join(","), "configurations", "allowed references travel");
        assert(imported.builtin === false, "an imported type is not builtin");
        assert((await assetTypes.list()).filter((t) => t.name === "House Widget").length, 2, "both copies coexist");

        let bad = null;
        try {
          assetTypes.parseExport("{not json");
        } catch (e) {
          bad = e;
        }
        assert(bad && bad.code === "INVALID_DATA", "malformed JSON is refused");
        let noType = null;
        try {
          assetTypes.parseExport('{"foo":1}');
        } catch (e) {
          noType = e;
        }
        assert(noType && noType.code === "INVALID_DATA", "JSON without a type is refused");

        let unknown = null;
        try {
          await assetTypes.exportType("atype-not-real");
        } catch (e) {
          unknown = e;
        }
        assert(unknown && unknown.code === "UNKNOWN_RECORD", "exporting an unknown id is refused");
      },
    },
    {
      name: "assetTypeOptions summarizes the whole library (sorted, with field counts) for pickers",
      fn: async () => {
        const { assetTypes } = makeWorld({ namespace: "kb-lib", assetTypes: true });
        const opts = await assetTypes.assetTypeOptions();
        assertEq(opts.length, BUILTIN_ASSET_TYPES.length, "one option per template");
        const app = opts.find((o) => o.id === "atype-applications");
        assertEq(app.name, "Applications", "option carries the name");
        assertEq(app.category, "applications", "option carries the category");
        assert(app.fieldCount > 0, "option carries a field count");
        assertEq(app.builtin, true, "option marks builtins");
        const names = opts.map((o) => o.name);
        assertEq(names.join("|"), names.slice().sort((a, b) => a.localeCompare(b)).join("|"), "options are sorted by name");
      },
    },
  ]);
}
