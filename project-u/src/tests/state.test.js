// ============================================================================
//  Validation tests — global application state (Phase 1, task 3)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import { createAppState, DEFAULT_WORKSPACES, DEFAULT_USER } from "../framework/state.js";

export function stateSuite() {
  return createSuite("state · workspace & user")
    .test("defaults to the first workspace", () => {
      const state = createAppState();
      assertEqual(state.activeWorkspace().id, DEFAULT_WORKSPACES[0].id);
      assertEqual(state.workspaceId, DEFAULT_WORKSPACES[0].id);
    })
    .test("setWorkspace switches the active workspace and notifies subscribers", () => {
      const state = createAppState();
      const seen = [];
      state.subscribe(() => seen.push(state.workspaceId));
      state.setWorkspace("northwind-it");
      assertEqual(state.activeWorkspace().name, "Northwind IT Services");
      assertDeepEqual(seen, ["northwind-it"]);
    })
    .test("setWorkspace ignores unknown ids", () => {
      const state = createAppState();
      const before = state.workspaceId;
      state.setWorkspace("does-not-exist");
      assertEqual(state.workspaceId, before);
    })
    .test("setUser merges a partial update and derives initials", () => {
      const state = createAppState();
      const updated = state.setUser({ name: "Jamie Fox", role: "Admin" });
      assertEqual(updated.name, "Jamie Fox");
      assertEqual(updated.role, "Admin");
      assertEqual(updated.email, DEFAULT_USER.email, "unspecified fields must be preserved");
      assertEqual(updated.initials, "JF");
      assertEqual(state.user.name, "Jamie Fox");
    })
    .test("selectSubscribe fires only when the selected value changes", () => {
      const state = createAppState();
      const ids = [];
      state.selectSubscribe((s) => s.workspaceId, (id) => ids.push(id));
      state.setWorkspace(DEFAULT_WORKSPACES[1].id);
      state.setWorkspace(DEFAULT_WORKSPACES[1].id);
      state.setWorkspace(DEFAULT_WORKSPACES[2].id);
      assertDeepEqual(ids, [DEFAULT_WORKSPACES[1].id, DEFAULT_WORKSPACES[2].id]);
    })
    .test("the workspace list is exposed and safe to iterate", () => {
      const state = createAppState();
      assertEqual(state.getWorkspaces().length, DEFAULT_WORKSPACES.length);
      assert(state.getWorkspaces().every((w) => w.id && w.name));
    })
    .test("addWorkspaces appends new workspaces without duplicating ids", () => {
      const state = createAppState();
      const count = state.getWorkspaces().length;
      state.addWorkspaces([{ id: "new-co", name: "New Co", kind: "Retail", plan: "Starter" }]);
      state.addWorkspaces([{ id: "new-co", name: "Duplicate", kind: "Retail", plan: "Starter" }]);
      assertEqual(state.getWorkspaces().length, count + 1);
    })
    .test("reset restores the initial workspace", () => {
      const state = createAppState();
      state.setWorkspace(DEFAULT_WORKSPACES[2].id);
      state.reset();
      assertEqual(state.workspaceId, DEFAULT_WORKSPACES[0].id);
    })
    .test("active member focus defaults to none and can be set/cleared", () => {
      const state = createAppState();
      assertEqual(state.activeMemberId, null);
      state.setActiveMember("quote-u");
      assertEqual(state.activeMemberId, "quote-u");
      state.clearActiveMember();
      assertEqual(state.activeMemberId, null);
    })
    .test("setActiveMember notifies subscribers and accepts an initial id", () => {
      const state = createAppState({ initialMemberId: "psa-u" });
      assertEqual(state.activeMemberId, "psa-u");
      const seen = [];
      state.selectSubscribe((s) => s.activeMemberId, (id) => seen.push(id));
      state.setActiveMember("crm-u");
      state.setActiveMember("crm-u");
      assertDeepEqual(seen, ["crm-u"]);
    });
}
