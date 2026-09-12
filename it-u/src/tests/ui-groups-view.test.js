// src/tests/ui-groups-view.test.js — DOM tests for the Groups & access card
// (src/modules/groups-view.js) as rendered in the Settings station.
// Run in the live page:
//   await import("./src/tests/ui-groups-view.test.js").then((m) => m.run())

import { runTests, assert, assertEq } from "./harness.js";
import { renderGroupsCard } from "../modules/groups-view.js";

const ctx = { hub: { username: "owner" }, toast() {}, access: null };
const GROUPS = [
  { id: "g1", name: "Administrators", builtin: true, permissions: ["a", "b"], members: ["alice"] },
  { id: "g2", name: "Field techs", permissions: ["a"], members: [] },
];

export async function run() {
  return runTests([
    {
      name: "the card renders its shell, heading, count and new-group button",
      fn: async () => {
        const card = renderGroupsCard(ctx, { groups: GROUPS }, () => {});
        assert(card.classList.contains("kb-card"), "kb-card root");
        assertEq(card.dataset.card, "access");
        assertEq(card.querySelector(".kb-section-name").textContent, "Groups & access");
        assertEq(card.querySelector(".kb-count-pill").textContent, "2", "the group count is shown");
        assert(card.querySelector("#kbNewGroupBtn"), "the new-group button is present");
        assertEq(card.querySelectorAll(".kb-group-item").length, 2);
      },
    },
    {
      name: "an accessMeta count overrides the group tally",
      fn: async () => {
        const card = renderGroupsCard(ctx, { groups: GROUPS, accessMeta: { count: 7 } }, () => {});
        assertEq(card.querySelector(".kb-count-pill").textContent, "7");
      },
    },
    {
      name: "each group row shows its permissions, members and badges",
      fn: async () => {
        const card = renderGroupsCard(ctx, { groups: GROUPS }, () => {});
        const rows = card.querySelectorAll(".kb-group-item");
        const builtin = Array.from(rows).find((r) => r.dataset.id === "g1");
        const custom = Array.from(rows).find((r) => r.dataset.id === "g2");

        assert(builtin.classList.contains("kb-group-item--builtin"), "builtin row class");
        assertEq(builtin.querySelector(".kb-group-name").textContent, "Administrators");
        assertEq(builtin.querySelector(".kb-badge-builtin").textContent, "Shipped");
        assertEq(builtin.querySelector(".kb-group-meta").textContent, "2 permissions · 1 member");
        assertEq(builtin.querySelector(".kb-group-members").textContent, "alice");

        assert(!custom.classList.contains("kb-group-item--builtin"), "custom row has no builtin class");
        assertEq(custom.querySelector(".kb-badge-builtin"), null, "no Shipped badge");
        assertEq(custom.querySelector(".kb-group-meta").textContent, "1 permission · no members");
        assertEq(custom.querySelector(".kb-group-members"), null, "no member line when empty");
      },
    },
    {
      name: "the row actions differ for shipped and custom groups",
      fn: async () => {
        const card = renderGroupsCard(ctx, { groups: GROUPS }, () => {});
        const rowFor = (id) => Array.from(card.querySelectorAll(".kb-group-item")).find((r) => r.dataset.id === id);
        const labelOf = (row) => Array.from(row.querySelectorAll("button")).map((b) => b.textContent.trim());
        assertEq(labelOf(rowFor("g1")).join(","), "Edit,Clone,Reset", "a shipped group can be reset");
        assertEq(labelOf(rowFor("g2")).join(","), "Edit,Clone,Delete", "a custom group can be deleted");
      },
    },
    {
      name: "an empty group library shows the guidance message",
      fn: async () => {
        const card = renderGroupsCard(ctx, { groups: [] }, () => {});
        assertEq(card.querySelectorAll(".kb-group-item").length, 0);
        assertEq(card.querySelector(".kb-count-pill").textContent, "0");
        assert(/No groups yet/.test(card.querySelector(".kb-group-list .kb-muted").textContent), "empty guidance shown");
      },
    },
  ]);
}
