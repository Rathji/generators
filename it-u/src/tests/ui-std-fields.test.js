// src/tests/ui-std-fields.test.js — DOM tests for the standardized-field form
// builder (src/modules/std-fields.js), which turns a RECORD_FIELD_SCHEMAS entry
// into inputs and a `collect()` patch. Run in the live page:
//   await import("./src/tests/ui-std-fields.test.js").then((m) => m.run())

import { runTests, assert, assertEq } from "./harness.js";
import { buildStandardizedFields, parseRefValue } from "../modules/std-fields.js";
import { PASSWORD_PERMISSIONS } from "../framework/password.js";

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function run() {
  return runTests([
    {
      name: "parseRefValue splits a type:id reference and rejects malformed ones",
      fn: async () => {
        assert(deepEq(parseRefValue("organizations:abc"), { type: "organizations", id: "abc" }), "simple ref");
        assert(deepEq(parseRefValue("type:"), { type: "type", id: "" }), "empty id still parses");
        assertEq(parseRefValue(""), null, "empty string");
        assertEq(parseRefValue("nocolon"), null, "no colon");
        assertEq(parseRefValue(":id"), null, "no type");
        assertEq(parseRefValue(null), null, "null tolerated");
      },
    },
    {
      name: "an unknown record type yields an empty, hidden section",
      fn: async () => {
        const built = buildStandardizedFields(null, "not-a-type");
        assertEq(built.empty, true);
        assertEq(built.node.hidden, true, "hidden");
        assert(deepEq(built.collect(), {}), "collect is an empty patch");
      },
    },
    {
      name: "organizations fields collect defaults and prefilled values",
      fn: async () => {
        const set = { records: { organizations: [] } };
        const built = buildStandardizedFields(set, "organizations");
        assertEq(built.empty, false);
        assert(built.node.classList.contains("kb-std-section"));
        const defaults = built.collect();
        assertEq(defaults.orgKind, "organization", "select default applied");
        assertEq(defaults.legalName, "", "text defaults empty");
        assertEq(defaults.parentOrgId, "", "no parent by default");

        const prefilled = buildStandardizedFields(set, "organizations", {
          orgKind: "department",
          legalName: "Acme",
          notes: "  note  ",
        });
        const sel = prefilled.node.querySelector('[data-std="orgKind"]');
        assertEq(sel.value, "department", "select prefilled");
        const patch = prefilled.collect();
        assertEq(patch.orgKind, "department");
        assertEq(patch.legalName, "Acme");
        assertEq(patch.notes, "note", "textarea value is trimmed");
        assert(
          prefilled.node.querySelector(".kb-field-label").textContent.includes("*"),
          "the required field is marked",
        );
      },
    },
    {
      name: "organizations parent select lists records and never offers the record itself",
      fn: async () => {
        const set = { records: { organizations: [{ id: "o1", name: "Alpha" }, { id: "o2", name: "Beta" }] } };
        const built = buildStandardizedFields(set, "organizations");
        const sel = built.node.querySelector('[data-std="parentOrgId"]');
        assertEq(sel.options.length, 3, "placeholder + two records");
        assertEq(sel.options[0].value, "", "the none option leads");
        const values = Array.from(sel.options).map((o) => o.value);
        assert(values.includes("organizations:o1") && values.includes("organizations:o2"), "both records offered");
        sel.value = "organizations:o2";
        assertEq(built.collect().parentOrgId, "organizations:o2", "the chosen reference is collected");

        const editing = buildStandardizedFields(set, "organizations", { id: "o1" });
        const selfSel = editing.node.querySelector('[data-std="parentOrgId"]');
        const selfValues = Array.from(selfSel.options).map((o) => o.value);
        assert(!selfValues.includes("organizations:o1"), "a record is not its own parent");
        assert(selfValues.includes("organizations:o2"), "the other record remains");
      },
    },
    {
      name: "passwords fields render every control type and collect their values",
      fn: async () => {
        const set = { records: {} };
        const built = buildStandardizedFields(set, "passwords", {
          category: "database",
          secret: "s3cret",
          permissions: ["view", "rotate"],
          rotateEveryDays: 90,
          rotatedAt: "2024-01-02",
          allowExport: true,
          notes: "  hi  ",
        });
        const secret = built.node.querySelector('[data-std="secret"]');
        assertEq(secret.type, "password", "secret is masked");
        assertEq(built.node.querySelector('[data-std="rotateEveryDays"]').value, "90");
        assertEq(built.node.querySelector('[data-std="rotatedAt"]').value, "2024-01-02");
        assertEq(built.node.querySelector('[data-std="allowExport"]').checked, true);

        const boxes = Array.from(built.node.querySelectorAll('[data-std="permissions"]'));
        assertEq(boxes.length, PASSWORD_PERMISSIONS.length, "a checkbox per permission");
        const checked = boxes.filter((b) => b.checked).map((b) => b.dataset.opt);
        assertEq(checked.join(","), "view,rotate", "prefilled checkboxes");

        const patch = built.collect();
        assertEq(patch.category, "database");
        assertEq(patch.secret, "s3cret");
        assertEq(patch.permissions.join(","), "view,rotate");
        assertEq(patch.rotateEveryDays, "90", "number collected as a string");
        assertEq(patch.rotatedAt, "2024-01-02");
        assertEq(patch.allowExport, true);
        assertEq(patch.notes, "hi", "notes trimmed");

        boxes.find((b) => b.dataset.opt === "view").checked = false;
        boxes.find((b) => b.dataset.opt === "share").checked = true;
        assertEq(built.collect().permissions.join(","), "rotate,share", "collect reads the live checkboxes");
        built.node.querySelector('[data-std="allowExport"]').checked = false;
        assertEq(built.collect().allowExport, false, "checkbox toggles off");
      },
    },
    {
      name: "passwords embeddedIn is a multi-record select that collects a {type,id} reference",
      fn: async () => {
        const set = { records: { organizations: [{ id: "o1", name: "Alpha" }] } };
        const built = buildStandardizedFields(set, "passwords", { embeddedIn: { type: "organizations", id: "o1" } });
        const sel = built.node.querySelector('[data-std="embeddedIn"]');
        assertEq(sel.value, "organizations:o1", "the reference prefills");
        const values = Array.from(sel.options).map((o) => o.value);
        assert(values.includes("organizations:o1"), "the owner is offered");
        assert(deepEq(built.collect().embeddedIn, { type: "organizations", id: "o1" }), "collected as a reference");
        sel.value = "";
        assertEq(built.collect().embeddedIn, null, "an empty choice collects null");
      },
    },
  ]);
}
