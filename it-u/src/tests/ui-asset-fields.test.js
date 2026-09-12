// src/tests/ui-asset-fields.test.js — DOM tests for the Flexible-Asset field
// renderer (src/modules/asset-fields.js): every field type the template
// designer can define, its prefill, and what `collect()` returns.
// Run in the live page:
//   await import("./src/tests/ui-asset-fields.test.js").then((m) => m.run())

import { runTests, assert, assertEq } from "./harness.js";
import { renderAssetFields } from "../modules/asset-fields.js";

const TYPE = {
  id: "t1",
  name: "Widget",
  fields: [
    { key: "title", label: "Title", type: "text" },
    { key: "desc", label: "Description", type: "textarea" },
    { key: "kind", label: "Kind", type: "select", required: true, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    { key: "tier", label: "Tier", type: "select", options: [{ id: "gold", label: "Gold" }, { id: "silver", label: "Silver" }] },
    { key: "tags", label: "Tags", type: "multiselect", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] },
    { key: "active", label: "Active", type: "checkbox" },
    { key: "count", label: "Count", type: "number" },
    { key: "when", label: "When", type: "date" },
    { key: "email", label: "Email", type: "email" },
    { key: "site", label: "Site", type: "url" },
    { key: "phone", label: "Phone", type: "phone" },
    { key: "owner", label: "Owner", type: "record", of: "organizations" },
  ],
};

const EMPTY_SET = { records: { organizations: [] } };
const SET = { records: { organizations: [{ id: "o1", name: "Alpha" }] } };

export async function run() {
  return runTests([
    {
      name: "a type with no fields renders a notice and collects nothing",
      fn: async () => {
        const built = renderAssetFields({ id: "t", name: "Empty", fields: [] }, {}, null);
        assertEq(built.empty, true);
        assert(built.node.classList.contains("kb-asset-fields"), "kb-asset-fields root");
        assertEq(built.node.querySelector(".kb-muted").textContent, "This asset type defines no fields yet.");
        assertEq(built.node.querySelectorAll(".kb-asset-field").length, 0);
        assertEq(Object.keys(built.collect()).length, 0);
        assertEq(renderAssetFields(null).empty, true, "a null type is empty too");
      },
    },
    {
      name: "defaults carry through collect and each field type maps to the right input",
      fn: async () => {
        const built = renderAssetFields(TYPE, {}, EMPTY_SET);
        assertEq(built.empty, false);
        assertEq(built.node.querySelector(".kb-subhead").textContent, "Widget", "the type name heads the section");
        assertEq(built.node.querySelectorAll(".kb-asset-field").length, TYPE.fields.length);
        const byKey = (k) => built.node.querySelector(`[data-af="${k}"]`);
        assertEq(byKey("email").type, "email");
        assertEq(byKey("site").type, "url");
        assertEq(byKey("phone").type, "tel");
        assertEq(byKey("count").type, "number");
        assertEq(byKey("when").type, "date");
        assertEq(byKey("desc").tagName, "TEXTAREA");
        const patch = built.collect();
        assertEq(patch.kind, "a", "a required select falls back to its first option");
        assertEq(patch.tier, "", "an optional select can be blank");
        assertEq(patch.active, false, "a checkbox defaults off");
        assertEq(patch.count, "");
        assertEq(patch.owner, "");
      },
    },
    {
      name: "a required field is marked in the label and the row",
      fn: async () => {
        const built = renderAssetFields(TYPE, {}, EMPTY_SET);
        const kindRow = built.node.querySelector('[data-af="kind"]').closest(".kb-asset-field");
        assert(kindRow.classList.contains("kb-asset-field--required"), "required row class");
        const kindLabel = kindRow.querySelector(".kb-field-label");
        assert(kindLabel.textContent.includes("*"), "required marker in the label");
        const titleRow = built.node.querySelector('[data-af="title"]').closest(".kb-asset-field");
        assert(!titleRow.classList.contains("kb-asset-field--required"), "an optional row is not marked");
      },
    },
    {
      name: "initial values prefill the controls and collect reads them back",
      fn: async () => {
        const built = renderAssetFields(
          TYPE,
          {
            title: "T",
            desc: "  d  ",
            kind: "b",
            tier: "gold",
            tags: "x, y",
            active: true,
            count: 3,
            when: "2024-05-06",
            email: "a@b.c",
            site: "https://b.c",
            phone: "555",
            owner: "o1",
          },
          SET,
        );
        const checked = Array.from(built.node.querySelectorAll('[data-af="tags"]'))
          .filter((b) => b.checked)
          .map((b) => b.dataset.opt);
        assertEq(checked.join(","), "x,y", "a comma-separated string checks the boxes");
        const patch = built.collect();
        assertEq(patch.title, "T");
        assertEq(patch.desc, "d", "textarea trimmed");
        assertEq(patch.kind, "b");
        assertEq(patch.tier, "gold");
        assertEq(patch.tags.join(","), "x,y");
        assertEq(patch.active, true);
        assertEq(patch.count, "3");
        assertEq(patch.when, "2024-05-06");
        assertEq(patch.email, "a@b.c");
        assertEq(patch.site, "https://b.c");
        assertEq(patch.phone, "555");
        assertEq(patch.owner, "o1");
      },
    },
    {
      name: "a record picker lists the set's records and flags a missing reference",
      fn: async () => {
        const built = renderAssetFields(TYPE, { owner: "o1" }, SET);
        const sel = built.node.querySelector('[data-af="owner"]');
        const values = Array.from(sel.options).map((o) => o.value);
        assert(values.includes("") && values.includes("o1"), "none option plus the record");
        assertEq(sel.value, "o1", "the reference prefills");
        assertEq(built.collect().owner, "o1");

        const missing = renderAssetFields(TYPE, { owner: "o9" }, SET);
        const sel2 = missing.node.querySelector('[data-af="owner"]');
        const last = sel2.options[sel2.options.length - 1];
        assertEq(last.value, "o9", "the dangling reference is still selectable");
        assert(last.textContent.includes("missing record"), "and is labelled");
        assertEq(missing.collect().owner, "o9", "it survives a round-trip");
      },
    },
  ]);
}
