// src/tests/flexible.test.js — validation tests for Phase 3 task 12 (flexible
// asset records & the template designer's data model). Run in the live page:
//   await import("./src/tests/flexible.test.js").then((m) => m.run())
//
// Covers: the field-type and reference catalogs; key/field normalization
// (stable keys, choice options, reference targets, defaults); asset-type
// validation (name, category, duplicate/unknown field types, choice options,
// reference targets, allowed references) and the refused save; blank-record
// field seeding and value presence; record validation against its type
// (required, number/email/url/select/multiselect) and the refused save; the
// table detail line + registry dispatch; and the integrity audit (structural
// errors, deep validation against supplied types, dangling record references).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import {
  ASSET_TYPE_SCHEMA,
  ASSET_CATEGORIES,
  ASSET_FIELD_TYPE_IDS,
  REFERENCE_TYPE_IDS,
  assetCategory,
  assetFieldType,
  referenceType,
  assetTypeId,
  fieldKey,
  normalizeField,
  normalizeAssetFields,
  validateAssetType,
  requireAssetType,
  makeAssetType,
  emptyAssetFields,
  assetFieldsOf,
  hasAssetValue,
  validateAssetRecord,
  requireAssetRecord,
  assetTypeIndex,
  assetDetailLine,
  flexibleAssetIssues,
} from "../framework/flexible.js";
import { validateRecordFields, recordDetailLine, STANDARDIZED_TYPES } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };

export async function run() {
  return runTests([
    {
      name: "the field-type and reference catalogs expose every designer option",
      fn: () => {
        assert(ASSET_FIELD_TYPE_IDS.includes("text"), "text");
        assert(ASSET_FIELD_TYPE_IDS.includes("textarea"), "textarea");
        assert(ASSET_FIELD_TYPE_IDS.includes("number"), "number");
        assert(ASSET_FIELD_TYPE_IDS.includes("date"), "date");
        assert(ASSET_FIELD_TYPE_IDS.includes("checkbox"), "checkbox");
        assert(ASSET_FIELD_TYPE_IDS.includes("select"), "select");
        assert(ASSET_FIELD_TYPE_IDS.includes("multiselect"), "multiselect");
        assert(ASSET_FIELD_TYPE_IDS.includes("url"), "url");
        assert(ASSET_FIELD_TYPE_IDS.includes("email"), "email");
        assert(ASSET_FIELD_TYPE_IDS.includes("phone"), "phone");
        assert(ASSET_FIELD_TYPE_IDS.includes("record"), "record");
        assertEq(ASSET_FIELD_TYPE_IDS.length, 11, "no extra field types");
        assertEq(assetFieldType("text").label, "Text", "field-type lookup");
        assertEq(assetFieldType("bogus"), null, "unknown field type is null");

        assertEq(REFERENCE_TYPE_IDS.length, 11, "eleven referenceable collections (domains added in task 31)");
        assert(REFERENCE_TYPE_IDS.includes("configurations"), "configurations referenceable");
        assert(REFERENCE_TYPE_IDS.includes("domains"), "domains referenceable");
        assert(REFERENCE_TYPE_IDS.includes("flexibleAssets"), "flexible assets referenceable");
        assertEq(referenceType("organizations").label, "Organization", "reference lookup");
        assertEq(referenceType("bogus"), null, "unknown reference is null");

        assertEq(assetCategory("applications").label, "Applications", "category lookup");
        assertEq(assetCategory("bogus"), null, "unknown category is null");
        assert(ASSET_CATEGORIES.length >= 6, "at least the shipped categories");
        assertEq(assetTypeId("My Little App"), "atype-my-little-app", "type id from name");
        assertEq(assetTypeId("My App", ["atype-my-app"]), "atype-my-app-2", "collisions numbered");
      },
    },
    {
      name: "field definitions normalize to a stable key, a known type, options and a reference target",
      fn: () => {
        assertEq(fieldKey("Licence Count"), "licence_count", "label to snake key");
        assertEq(fieldKey("Licence Count", ["licence_count"]), "licence_count_2", "duplicate key numbered");
        assertEq(fieldKey(""), "field", "blank label falls back");

        const email = normalizeField({ label: "Contact Email", type: "email" }, []);
        assertEq(email.key, "contact_email", "derived key");
        assertEq(email.type, "email", "known type kept");
        assertEq(email.required, false, "optional by default");

        const select = normalizeField({ label: "Plan", type: "select", options: ["Basic", "Pro"] }, []);
        assertEq(select.options.length, 2, "string options kept");
        assertEq(select.options[0].id, "basic", "option id slugified");
        assertEq(select.options[0].label, "Basic", "option label kept");

        const kept = normalizeField({ key: "plan", label: "Plan", type: "select", options: [{ id: "p", label: "P" }] }, []);
        assertEq(kept.key, "plan", "explicit key preserved");
        assertEq(normalizeField({ key: "plan", label: "Plan", type: "text" }, ["plan"]).key, "plan_2", "taken key re-derived");

        assertEq(normalizeField({ label: "X", type: "bogus" }).type, "text", "unknown type falls back to text");
        assertEq(normalizeField({ label: "Ref", type: "record", of: "configurations" }).of, "configurations", "record target kept");
        assertEq(normalizeField({ label: "Ref", type: "record", of: "bogus" }).of, "organizations", "bad record target falls back");

        const list = normalizeAssetFields([{ label: "Name", type: "text" }, { label: "Name", type: "text" }]);
        assertEq(list[0].key, "name", "first key");
        assertEq(list[1].key, "name_2", "unique keys across a list");
      },
    },
    {
      name: "an asset type is normalized (trimmed name, category default, unique keys, deduped references) and validated",
      fn: () => {
        const t = makeAssetType({
          name: "  My App  ",
          category: "bogus",
          fields: [{ label: "Name", type: "text" }, { label: "Name", type: "text" }],
          references: ["configurations", "configurations", "nope"],
        });
        assertEq(t.schema, ASSET_TYPE_SCHEMA, "schema stamped");
        assertEq(t.name, "My App", "name trimmed");
        assertEq(t.category, "custom", "unknown category falls back to custom");
        assertEq(t.icon, "layers", "default icon");
        assertEq(t.builtin, false, "authored types are not builtin");
        assertEq(t.customized, false, "not customized");
        assertEq(t.fields.length, 2, "both fields kept");
        assertEq(t.fields[1].key, "name_2", "normalization gives unique keys");
        assertEq(t.references.join(","), "configurations", "references deduped and filtered");
        assertEq(t.id, "atype-my-app", "id derived from name");
        assert(validateAssetType(t).ok, "a normalized type validates");

        assert(!validateAssetType({ fields: [] }).ok, "a type needs a name");
        assert(!validateAssetType({ name: "X", category: "bogus", fields: [] }).ok, "unknown category refused");
        assert(!validateAssetType({ name: "X" }).ok, "a fields array is required");
        assert(!validateAssetType({ name: "X", fields: [{ key: "a", label: "A", type: "text" }, { key: "a", label: "B", type: "text" }] }).ok, "duplicate keys refused");
        assert(!validateAssetType({ name: "X", fields: [{ key: "a", label: "A", type: "bogus" }] }).ok, "unknown field type refused");
        assert(!validateAssetType({ name: "X", fields: [{ key: "a", label: "A", type: "select" }] }).ok, "a choice field needs options");
        assert(!validateAssetType({ name: "X", fields: [{ key: "r", label: "R", type: "record", of: "bogus" }] }).ok, "a record field needs a real target");
        assert(!validateAssetType({ name: "X", fields: [], references: "no" }).ok, "references must be an array");
        assert(!validateAssetType({ name: "X", fields: [], references: ["bogus"] }).ok, "unknown allowed reference refused");
        assertEq(validateAssetType({ name: "X", fields: [] }).errors.length, 0, "empty fields list is valid");

        let threw = null;
        try {
          requireAssetType({ name: "", fields: [] });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireAssetType refuses with INVALID_DATA");

        assertEq(assetTypeIndex([{ id: "a" }, { id: "b" }]).get("b").id, "b", "index by id");
      },
    },
    {
      name: "a blank record's fields seed from the type, and value presence is type-aware",
      fn: () => {
        const type = makeAssetType({
          name: "T",
          fields: [
            { key: "a", label: "A", type: "checkbox" },
            { key: "b", label: "B", type: "multiselect", options: [{ id: "x", label: "X" }] },
            { key: "c", label: "C", type: "select", default: "x", options: [{ id: "x", label: "X" }] },
            { key: "d", label: "D", type: "text" },
          ],
        });
        const empty = emptyAssetFields(type);
        assertEq(empty.a, false, "checkbox seeds false");
        assertEq(Array.isArray(empty.b) && empty.b.length, 0, "multiselect seeds empty array");
        assertEq(empty.c, "x", "select seeds its default");
        assertEq(empty.d, "", "text seeds empty string");
        assertEq(Object.keys(emptyAssetFields(null)).length, 0, "no type seeds nothing");

        assertEq(hasAssetValue({ type: "checkbox" }, true), true, "checked box is present");
        assertEq(hasAssetValue({ type: "checkbox" }, false), false, "unchecked box is absent");
        assertEq(hasAssetValue({ type: "multiselect" }, ["x"]), true, "non-empty list present");
        assertEq(hasAssetValue({ type: "multiselect" }, []), false, "empty list absent");
        assertEq(hasAssetValue({ type: "text" }, "hi"), true, "text present");
        assertEq(hasAssetValue({ type: "text" }, "   "), false, "whitespace absent");

        assertEq(Object.keys(assetFieldsOf({ assetFields: { a: 1 } })).length, 1, "fields read back");
        assertEq(Object.keys(assetFieldsOf({ assetFields: [1] })).length, 0, "an array is not a fields object");
        assertEq(Object.keys(assetFieldsOf({})).length, 0, "missing fields read as empty");
      },
    },
    {
      name: "a record validates against its type (required, number, email, url, select, multiselect) and a bad save is refused",
      fn: () => {
        const type = makeAssetType({
          name: "Contact",
          fields: [
            { key: "email", label: "Email", type: "email", required: true },
            { key: "seats", label: "Seats", type: "number" },
            { key: "site", label: "Site", type: "url" },
            { key: "plan", label: "Plan", type: "select", options: [{ id: "basic", label: "Basic" }, { id: "pro", label: "Pro" }] },
            { key: "tags", label: "Tags", type: "multiselect", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
          ],
        });
        const bad = (fields) => validateAssetRecord(type, { name: "R", assetTypeId: type.id, assetFields: fields });
        assert(!bad({}).ok, "a missing required field is refused");
        assert(bad({}).errors.some((e) => e.includes("Email")), "the error names the field");
        assert(!bad({ email: "nope" }).ok, "a malformed email is refused");
        assert(!bad({ email: "a@b.co", seats: "abc" }).ok, "a non-numeric number is refused");
        assert(!bad({ email: "a@b.co", site: "ftp://x" }).ok, "a non-http URL is refused");
        assert(!bad({ email: "a@b.co", plan: "gold" }).ok, "an out-of-list select is refused");
        assert(!bad({ email: "a@b.co", tags: ["a", "z"] }).ok, "an unknown multiselect option is refused");
        assert(bad({ email: "a@b.co" }).ok, "only the required field is needed");
        assert(bad({ email: "a@b.co", seats: "5", site: "https://x.co", plan: "pro", tags: ["a", "b"] }).ok, "a full valid record passes");
        assert(validateAssetRecord(null, {}).errors.some((e) => e.includes("no asset type")), "a record without a type is refused");

        let threw = null;
        try {
          requireAssetRecord(type, { name: "R", assetFields: {} });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireAssetRecord refuses with INVALID_DATA");
      },
    },
    {
      name: "the table detail line shows the template then up to three filled fields, and the registry dispatches it",
      fn: () => {
        const type = makeAssetType({
          name: "Licence",
          fields: [
            { key: "product", label: "Product", type: "text" },
            { key: "seats", label: "Seats", type: "number" },
            { key: "plan", label: "Plan", type: "select", options: [{ id: "pro", label: "Pro" }] },
            { key: "extra", label: "Extra", type: "text" },
          ],
        });
        const record = { type: "flexibleAssets", name: "Acme", assetTypeId: type.id, assetFields: { product: "Acme Suite", seats: 5, plan: "pro", extra: "ignored" } };
        const line = assetDetailLine(record, type);
        assertEq(line, "Licence · Acme Suite · 5 · Pro", "template + three filled fields, choice by label");
        assertEq(assetDetailLine(record, null), "Unknown asset type", "a missing template is surfaced");
        assertEq(recordDetailLine(record, null, { assetTypes: [type] }), line, "registry dispatches to the flexible asset line");
        assertEq(recordDetailLine(record, null, { assetTypes: new Map([[type.id, type]]) }), line, "a Map of types also works");
        assert(STANDARDIZED_TYPES.includes("flexibleAssets"), "flexible assets are a standardized (detail-line) type");
        assert(validateRecordFields("flexibleAssets", { assetTypeId: "atype-x", assetFields: {} }).ok, "the combined registry accepts a typed asset");
        assert(!validateRecordFields("flexibleAssets", { assetFields: {} }).ok, "the combined registry requires a type");
        assert(!validateRecordFields("flexibleAssets", { assetTypeId: "x", assetFields: [1] }).ok, "malformed fields refused by the registry");
      },
    },
    {
      name: "the integrity audit flags a missing type, malformed fields, an unknown template, invalid values and dangling references",
      fn: async () => {
        const structural = flexibleAssetIssues({ records: { flexibleAssets: [{ id: "f1", name: "No Type" }] } });
        assert(structural.some((i) => i.code === "asset-missing-type" && i.level === "error"), "missing type is an error");
        const malformed = flexibleAssetIssues({ records: { flexibleAssets: [{ id: "f2", name: "Bad", assetTypeId: "atype-x", assetFields: [1] }] } });
        assert(malformed.some((i) => i.code === "asset-bad-fields" && i.level === "error"), "malformed fields is an error");

        const type = makeAssetType({
          name: "Server",
          fields: [
            { key: "email", label: "Owner email", type: "email", required: true },
            { key: "cfg", label: "Linked configuration", type: "record", of: "configurations" },
          ],
        });
        const unknown = flexibleAssetIssues({ records: { flexibleAssets: [{ id: "f3", name: "Ghost", assetTypeId: "atype-missing", assetFields: {} }] } }, [type]);
        assert(unknown.some((i) => i.code === "asset-unknown-type"), "an unknown template is flagged when types are supplied");
        const shallow = flexibleAssetIssues({ records: { flexibleAssets: [{ id: "f3", name: "Ghost", assetTypeId: "atype-missing", assetFields: {} }] } });
        assert(!shallow.some((i) => i.code === "asset-unknown-type"), "without types only structural checks run");

        const invalid = flexibleAssetIssues({ records: { flexibleAssets: [{ id: "f4", name: "Iv", assetTypeId: type.id, assetFields: { email: "nope" } }] } }, [type]);
        assert(invalid.some((i) => i.code === "asset-invalid"), "an invalid value is an error");

        const dangling = flexibleAssetIssues(
          { records: { flexibleAssets: [{ id: "f5", name: "Dangling", assetTypeId: type.id, assetFields: { email: "a@b.co", cfg: "cfg_missing" } }], configurations: [] } },
          [type],
        );
        assert(dangling.some((i) => i.code === "asset-dangling-reference"), "a dangling record reference is an error");

        const good = flexibleAssetIssues(
          { records: { flexibleAssets: [{ id: "f6", name: "Good", assetTypeId: type.id, assetFields: { email: "a@b.co", cfg: "cfg_1" } }], configurations: [{ id: "cfg_1" }] } },
          [type],
        );
        assertEq(good.length, 0, "a valid asset with a live reference is clean");
      },
    },
    {
      name: "the docs service stores a flexible asset record end-to-end and the set audit stays consistent",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-flex" });
        const set = await docs.create({ name: "Acme" });
        const type = makeAssetType({ name: "Appliances", fields: [{ key: "make", label: "Make", type: "text", required: true }] });
        const rec = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Coffee machine", assetTypeId: type.id, assetFields: { make: "Acme" }, ...CL })).record;
        assertEq(rec.assetTypeId, type.id, "type stored on the record");
        assertEq(rec.assetFields.make, "Acme", "fields stored on the record");
        const live = await docs.get(set.id, { force: true });
        assertEq(live.records.flexibleAssets.length, 1, "the record lives in the flexible assets collection");
        assert((await docs.integrity(set.id)).ok, "the structural audit passes");

        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "flexibleAssets", name: "Orphan", assetFields: {}, ...CL });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "the docs service refuses a flexible asset without a type");
      },
    },
  ]);
}
