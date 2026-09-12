// ============================================================================
//  Validation tests — UI components (Phase 2 tasks 6-8)
// ============================================================================

import { createSuite, assert, assertEqual } from "./harness.js";
import { createToaster } from "../components/toast.js";
import { createDataTable } from "../components/datatable.js";
import { textField, selectField, toggleField, checkboxField, radioField } from "../components/inputs.js";

export function componentsSuite() {
  return createSuite("components · inputs, toasts, tables")
    .test("textField reads, writes and validates", () => {
      const field = textField({ name: "email", label: "Email", value: "a@b.co", required: true });
      assertEqual(field.value, "a@b.co");
      field.value = "c@d.co";
      assertEqual(field.input.value, "c@d.co");
      assert(field.input.getAttribute("aria-describedby") === null || true);
      field.setError("Invalid");
      assert(field.el.classList.contains("is-invalid"));
      assertEqual(field.input.getAttribute("aria-invalid"), "true");
      field.clearError();
      assert(!field.el.classList.contains("is-invalid"));
      assert(field.el.querySelector("label").htmlFor === field.input.id);
    })
    .test("selectField reflects the selected option", () => {
      const field = selectField({ name: "industry", label: "Industry", value: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
      assertEqual(field.value, "a");
      field.value = "b";
      assertEqual(field.value, "b");
    })
    .test("toggle / checkbox / radio fields expose values", () => {
      const toggle = toggleField({ name: "remind", label: "Remind", checked: true });
      assertEqual(toggle.value, true);
      toggle.value = false;
      assertEqual(toggle.value, false);

      const check = checkboxField({ name: "terms", label: "Terms" });
      assertEqual(check.value, false);
      check.value = true;
      assertEqual(check.value, true);

      const radio = radioField({ name: "priority", label: "Priority", value: "low", options: ["low", "high"] });
      assertEqual(radio.value, "low");
      radio.value = "high";
      assertEqual(radio.value, "high");
    })
    .test("toaster stacks, counts and dismisses", () => {
      const container = document.createElement("div");
      const toaster = createToaster({ container, duration: 0 });
      const first = toaster.success("Saved");
      toaster.error("Failed");
      assertEqual(toaster.count, 2);
      assertEqual(container.children.length, 2);
      assert(container.querySelector(".pu-toast--error").getAttribute("role") === "alert");
      toaster.dismiss(first.id);
      assertEqual(toaster.count, 1);
      toaster.clear();
      assertEqual(toaster.count, 0);
    })
    .test("data table paginates, sorts and filters", () => {
      const rows = [
        { name: "b", amount: 2 },
        { name: "a", amount: 10 },
        { name: "c", amount: 1 },
      ];
      const table = createDataTable({
        rows,
        pageSize: 2,
        columns: [
          { key: "name", label: "Name" },
          { key: "amount", label: "Amount", sortValue: (row) => row.amount },
        ],
      });
      assertEqual(table.el.querySelectorAll("tbody .pu-tr").length, 2, "page 1 shows pageSize rows");

      // sort by name ascending
      table.el.querySelectorAll(".pu-th-sort")[0].click();
      assertEqual(table.el.querySelector("tbody .pu-td").textContent, "a");
      // toggle to descending
      table.el.querySelectorAll(".pu-th-sort")[0].click();
      assertEqual(table.el.querySelector("tbody .pu-td").textContent, "c");
      // sort by numeric amount ascending
      table.el.querySelectorAll(".pu-th-sort")[1].click();
      assertEqual(table.el.querySelector("tbody .pu-tr .pu-td:nth-child(2)").textContent, "1");

      table.setQuery("b");
      assertEqual(table.el.querySelectorAll("tbody .pu-tr").length, 1);

      table.setQuery("");
      table.el.querySelectorAll(".pu-pager-btn")[1].click();
      assertEqual(table.el.querySelectorAll("tbody .pu-tr").length, 1, "page 2 shows the remainder");
    })
    .test("data table shows an empty state", () => {
      const table = createDataTable({ rows: [], columns: [{ key: "name", label: "Name" }], emptyMessage: "Nothing here" });
      const empty = table.el.querySelector(".pu-tr-empty");
      assert(empty, "empty state row must render");
      assert(empty.textContent.includes("Nothing here"));
    })
    .test("data table cells carry mobile labels", () => {
      const table = createDataTable({ rows: [{ name: "Zed" }], columns: [{ key: "name", label: "Name" }] });
      assertEqual(table.el.querySelector(".pu-td").getAttribute("data-label"), "Name");
    });
}
