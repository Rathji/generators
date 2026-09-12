// src/tests/roles.test.js — validation tests for Phase 13 task 54 (the IT-U
// role & access model: viewer / technician / administrator, scoped per client
// and per service). Run in the live page:
//   await import("./src/tests/roles.test.js").then((m) => m.run())
//
// Covers: the three-role catalog and its legacy aliases; the action → minimum
// role matrix; the scope algebra (global / client / service, most-specific
// ancestors); assignment normalization + validation; most-specific-wins role
// resolution (including a specific downgrade overriding a broad grant); the
// pure `can`/`explain` decisions; the access service folding a scoped role into
// the shipped groups' permission tokens; and the documentation service
// refusing a write outside the actor's assigned scope.

import { runTests, assert, assertEq } from "./harness.js";
import { makeAccessWorld } from "./testFixtures.js";
import { createDocumentStore } from "../framework/store/index.js";
import { createMemoryChannel, createMemoryCache } from "../framework/store/backends.js";
import { createAccessService } from "../framework/access.js";
import {
  ROLES,
  ROLE_IDS,
  ROLE_LABELS,
  ROLE_GROUP_IDS,
  ROLE_RANK,
  ACTIONS,
  ACTION_IDS,
  GLOBAL_SCOPE,
  SCOPE_MAX_LENGTH,
  normalizeRoleId,
  roleRank,
  highestRole,
  roleAtLeast,
  roleDef,
  roleAllows,
  actionsForRole,
  normalizeAction,
  actionDef,
  isScope,
  clientScope,
  serviceScope,
  parseScope,
  scopeFor,
  scopeLabel,
  scopeSpecificity,
  ancestorScopes,
  scopeApplies,
  normalizeAssignment,
  normalizeAssignments,
  validateAssignment,
  assignmentKey,
  resolveRole,
  assignmentsFor,
  can as roleCan,
  explain as roleExplain,
  summarizeAssignments,
} from "../framework/roles.js";

const C = { informationModel: "core-asset", provenance: "authored" };



export async function run() {
  return runTests([
    {
      name: "the three IT-U roles, their ranks and their shipped groups",
      fn: () => {
        assertEq(ROLE_IDS.join(","), "viewer,technician,administrator", "three roles, ordered by rank");
        assertEq(ROLES.length, 3, "three role definitions");
        for (const r of ROLES) {
          assert(ROLE_LABELS[r.id], r.id + " has a label");
          assertEq(ROLE_RANK[r.id], r.rank, r.id + " rank matches");
          assertEq(ROLE_GROUP_IDS[r.id], r.group, r.id + " maps to its shipped group");
          assert(r.summary && r.description, r.id + " documents itself");
        }
        assertEq(roleRank("administrator") > roleRank("technician"), true, "administrator outranks technician");
        assertEq(roleRank("technician") > roleRank("viewer"), true, "technician outranks viewer");
        assertEq(roleAtLeast("administrator", "technician"), true, "admin is at least technician");
        assertEq(roleAtLeast("viewer", "technician"), false, "viewer is not a technician");
        assertEq(highestRole("viewer", "administrator"), "administrator", "highest wins");
        assertEq(highestRole(null, "technician"), "technician", "null-safe");
        assertEq(roleDef("technician").label, "Technician", "role lookup");
      },
    },
    {
      name: "legacy role names fold onto the three IT-U roles",
      fn: () => {
        assertEq(normalizeRoleId("Editor"), "technician", "editor → technician");
        assertEq(normalizeRoleId("reviewer"), "technician", "reviewer → technician");
        assertEq(normalizeRoleId("admin"), "administrator", "admin → administrator");
        assertEq(normalizeRoleId("helpdesk"), "viewer", "helpdesk → viewer");
        assertEq(normalizeRoleId("owner"), "administrator", "owner → administrator");
        assertEq(normalizeRoleId("nonsense"), null, "unknown role → null");
      },
    },
    {
      name: "actions declare the minimum role that holds them",
      fn: () => {
        assertEq(actionDef("view").minRole, "viewer", "view is a viewer action");
        assertEq(actionDef("edit").minRole, "technician", "edit is a technician action");
        assertEq(actionDef("delete").minRole, "technician", "delete is a technician action");
        assertEq(actionDef("useCredential").minRole, "technician", "using a secret needs a technician");
        assertEq(actionDef("rotateCredential").minRole, "technician", "rotating a secret needs a technician");
        for (const a of ["share", "manageTemplates", "manageGroups", "managePublication", "manageUsers", "administer"]) {
          assertEq(actionDef(a).minRole, "administrator", a + " is administrators only");
        }
        assertEq(normalizeAction("write"), "edit", "legacy write → edit");
        assertEq(normalizeAction("publish"), "managePublication", "publish → managePublication");
        assertEq(normalizeAction("use"), "useCredential", "use → useCredential");
        assertEq(actionDef("nonsense"), null, "unknown action → null");
        for (const a of ACTION_IDS) assert(ACTIONS.find((x) => x.id === a), a + " is in the catalog");
      },
    },
    {
      name: "roleAllows gates an action by rank",
      fn: () => {
        assertEq(roleAllows("viewer", "view"), true, "viewer reads");
        assertEq(roleAllows("viewer", "edit"), false, "viewer cannot edit");
        assertEq(roleAllows("technician", "edit"), true, "technician edits");
        assertEq(roleAllows("technician", "useCredential"), true, "technician uses credentials");
        assertEq(roleAllows("technician", "manageGroups"), false, "technician cannot manage groups");
        assertEq(roleAllows("administrator", "manageGroups"), true, "administrator manages groups");
        assertEq(roleAllows("administrator", "view"), true, "administrator reads too");
        assertEq(actionsForRole("viewer").join(","), "view", "viewer holds only view");
        assert(actionsForRole("administrator").length > actionsForRole("technician").length, "administrator holds more than technician");
      },
    },
    {
      name: "scopes parse into global / client / service",
      fn: () => {
        const c = clientScope("docset-acme");
        const s = serviceScope("docset-acme", "cfg-1234");
        assertEq(c, "client:docset-acme", "client scope string");
        assertEq(s, "service:docset-acme/cfg-1234", "service scope string");
        assertEq(parseScope(GLOBAL_SCOPE).kind, "global", "global scope");
        assertEq(parseScope(c).kind, "client", "client kind");
        assertEq(parseScope(c).clientId, "docset-acme", "client id");
        assertEq(parseScope(s).kind, "service", "service kind");
        assertEq(parseScope(s).clientId, "docset-acme", "service's client");
        assertEq(parseScope(s).serviceId, "cfg-1234", "service id");
        assertEq(scopeSpecificity(s) > scopeSpecificity(c), true, "service is more specific than client");
        assertEq(scopeSpecificity(c) > scopeSpecificity(GLOBAL_SCOPE), true, "client is more specific than global");
        assertEq(ancestorScopes(s).join(" | "), "service:docset-acme/cfg-1234 | client:docset-acme | *", "service chain");
        assertEq(ancestorScopes(c).join(" | "), "client:docset-acme | *", "client chain");
        assertEq(scopeApplies(c, s), true, "a client grant applies to its services");
        assertEq(scopeApplies(GLOBAL_SCOPE, s), true, "a global grant applies everywhere");
        assertEq(scopeApplies(s, c), false, "a service grant does not apply to its whole client");
      },
    },
    {
      name: "isScope validates and caps scope strings",
      fn: () => {
        assertEq(isScope("*"), true, "global is a scope");
        assertEq(isScope("client:docset-acme"), true, "client scope valid");
        assertEq(isScope("service:docset-acme/cfg-1"), true, "service scope valid");
        assertEq(isScope("client:"), false, "empty client id rejected");
        assertEq(isScope("service:docset-acme"), false, "service without a service id rejected");
        assertEq(isScope("client:Bad Id"), false, "whitespace rejected");
        assertEq(isScope("client:" + "a".repeat(SCOPE_MAX_LENGTH)), false, "over-long scope rejected");
      },
    },
    {
      name: "scopeFor targets a record's service (or own) scope",
      fn: () => {
        assertEq(scopeFor({ setId: "docset-acme" }), "client:docset-acme", "set-only → client scope");
        assertEq(scopeFor({ setId: "docset-acme", record: { id: "cfg-1", type: "configurations" } }), "service:docset-acme/cfg-1", "record without a service → its own scope");
        assertEq(
          scopeFor({ setId: "docset-acme", record: { id: "run-1", type: "runbooks", service: { type: "flexibleAssets", id: "fx-voice" } } }),
          "service:docset-acme/fx-voice",
          "a runbook scopes to the service it deploys",
        );
        assertEq(scopeFor({ scope: "client:x" }), "client:x", "explicit scope wins");
        assertEq(scopeFor({}), GLOBAL_SCOPE, "nothing → global");
      },
    },
    {
      name: "assignments normalize, validate and dedupe per scope",
      fn: () => {
        const a = normalizeAssignment({ scope: "client:x", role: "Editor" });
        assertEq(a.scope, "client:x", "scope kept");
        assertEq(a.role, "technician", "role alias normalized");
        assertEq(validateAssignment({ scope: "client:x", role: "technician" }).ok, true, "valid assignment");
        assertEq(validateAssignment({ scope: "nope", role: "technician" }).ok, false, "bad scope rejected");
        assertEq(validateAssignment({ scope: "client:x", role: "wizard" }).ok, false, "bad role rejected");
        const merged = normalizeAssignments([
          { scope: "client:x", role: "viewer" },
          { scope: "client:x", role: "technician" },
          { scope: "*", role: "viewer" },
          { scope: "bad scope!", role: "technician" },
          { scope: "service:x/r1", role: "technician" },
        ]);
        assertEq(merged.length, 3, "duplicates + invalid dropped");
        const cx = merged.find((m) => m.scope === "client:x");
        assertEq(cx.role, "technician", "higher rank wins within a scope");
        assert(assignmentKey({ scope: "*", role: "admin" }) === "*::administrator", "assignment key");
        assertEq(assignmentsFor(merged, "x").length, 3, "assignments relevant to a client");
        assertEq(assignmentsFor(merged, "y").length, 1, "only the global one is relevant to another client");
      },
    },
    {
      name: "resolveRole is most-specific-wins (a specific downgrade overrides a broad grant)",
      fn: () => {
        const assignments = normalizeAssignments([
          { scope: "*", role: "technician" },
          { scope: "client:acme", role: "administrator" },
          { scope: "service:acme/fx-only", role: "viewer" },
        ]);
        assertEq(resolveRole(assignments, "service:acme/fx-other").role, "administrator", "service falls back to its client");
        assertEq(resolveRole(assignments, "client:acme").scope, "client:acme", "client scope matched");
        assertEq(resolveRole(assignments, "client:other").role, "technician", "another client falls back to global");
        assertEq(resolveRole(assignments, "service:other/x").role, "technician", "unknown client falls back to global");
        assertEq(resolveRole(assignments, "service:acme/fx-only").role, "viewer", "the specific downgrade wins");
        assertEq(resolveRole(normalizeAssignments([{ scope: "client:acme", role: "viewer" }]), "client:other"), null, "no match and no global → null");
        assertEq(resolveRole([], "client:acme", "viewer").role, "viewer", "explicit fallback role");
      },
    },
    {
      name: "can(): owner/admin bypass, viewer reads, technician edits, scoped denies",
      fn: () => {
        const assignments = normalizeAssignments([
          { scope: "*", role: "viewer" },
          { scope: "client:acme", role: "technician" },
          { scope: "service:acme/fx-a", role: "administrator" },
        ]);
        assertEq(roleCan({ assignments, scope: "*", action: "view" }).allow, true, "viewer reads everywhere");
        assertEq(roleCan({ assignments, scope: "client:acme", action: "edit" }).allow, true, "technician edits their client");
        assertEq(roleCan({ assignments, scope: "client:acme", action: "manageGroups" }).allow, false, "technician cannot manage groups");
        assertEq(roleCan({ assignments, scope: "service:acme/fx-a", action: "manageGroups" }).allow, true, "administrator at one service");
        assertEq(roleCan({ assignments, scope: "client:other", action: "edit" }).allow, false, "a viewer elsewhere cannot edit");
        assertEq(roleCan({ assignments, scope: "*", action: "view", isOwner: true }).code, "OWNER", "owner bypasses");
        assertEq(roleCan({ assignments: [], scope: "*", action: "administer", isAdmin: true }).allow, true, "administrator bypasses");
        assertEq(roleCan({ assignments: [], scope: "*", action: "wizardry" }).code, "UNKNOWN_ACTION", "unknown action denied");
        const denied = roleCan({ assignments, scope: "client:other", action: "delete" });
        assertEq(denied.code, "FORBIDDEN", "denied code");
        assert(denied.reason.includes("Technician") || denied.reason.includes("technician"), "reason names the required role");
      },
    },
    {
      name: "explain and summarizeAssignments describe a user's access",
      fn: () => {
        const assignments = normalizeAssignments([
          { scope: "*", role: "viewer" },
          { scope: "client:acme", role: "technician" },
          { scope: "service:acme/fx-a", role: "administrator" },
        ]);
        const ex = roleExplain({ assignments, scope: "client:acme" });
        assertEq(ex.role, "technician", "effective role at the client");
        assertEq(ex.actions.view.allow, true, "can view");
        assertEq(ex.actions.edit.allow, true, "can edit");
        assertEq(ex.actions.manageGroups.allow, false, "cannot manage groups");
        const sum = summarizeAssignments(assignments);
        assertEq(sum.total, 3, "three assignments");
        assertEq(sum.counts.technician, 1, "one technician assignment");
        assertEq(sum.counts.administrator, 1, "one administrator assignment");
        assertEq(sum.clients, 1, "one client assignment");
        assertEq(sum.services, 1, "one service assignment");
        assertEq(sum.global, "viewer", "global role recorded");
      },
    },
    {
      name: "the access service folds a scoped role into the shipped groups' tokens",
      fn: async () => {
        const channel = createMemoryChannel();
        const cache = createMemoryCache();
        const store = createDocumentStore({ namespace: "kb-roles-access", channel, cache });
        const assignmentsByUser = {
          kim: normalizeAssignments([{ scope: "*", role: "viewer" }, { scope: "client:acme", role: "technician" }]),
          sam: normalizeAssignments([{ scope: "*", role: "viewer" }]),
        };
        const access = createAccessService({ store, cache, getRole: (u) => "viewer", getAssignments: (u) => assignmentsByUser[u] || null });
        await access.load();
        const atAcme = access.scopedRole("kim", "client:acme");
        assertEq(atAcme.role, "technician", "kim is a technician at acme");
        assertEq(atAcme.tokens.includes("asset.edit"), true, "…with the technicians group's tokens");
        const atOther = access.scopedRole("kim", "client:other");
        assertEq(atOther.role, "viewer", "kim is only a viewer elsewhere");
        assertEq(atOther.tokens.includes("asset.edit"), false, "…and cannot edit");
        assertEq(access.canAtScope("sam", "client:acme", "edit").allow, false, "sam cannot edit");
        assertEq(access.canAtScope("kim", "client:acme", "edit").allow, true, "kim can edit at acme");
        assertEq(access.canAtScope("kim", "client:acme", "manageGroups").allow, false, "kim cannot manage groups");
        // A record request derives its own service scope.
        const rec = { id: "cfg-1", type: "configurations", name: "Router" };
        assertEq(access.can("kim", { action: "edit", record: rec, setId: "acme" }).allow, true, "record edit inherits the client grant");
        assertEq(access.can("sam", { action: "edit", record: rec, setId: "acme" }).allow, false, "a viewer cannot edit the record");
      },
    },
    {
      name: "the documentation service refuses a write outside the actor's assigned scope",
      fn: async () => {
        const { docs } = await makeAccessWorld("kb-roles-docs", () => "viewer");
        const set = await docs.create({ name: "Acme Corp", createdBy: "owner" });
        const a = await docs.addRecord(set.id, { type: "configurations", name: "Router A", configType: "router", ...C }, { updatedBy: "owner" });
        const b = await docs.addRecord(set.id, { type: "configurations", name: "Router B", configType: "router", ...C }, { updatedBy: "owner" });
        const scoped = { name: "tech", role: "viewer", assignments: normalizeAssignments([{ scope: serviceScope(set.id, a.record.id), role: "technician" }]) };
        // Assigned service: allowed.
        await docs.updateRecord(set.id, { type: "configurations", id: a.record.id }, { notes: "patched" }, { updatedBy: "tech", actor: scoped });
        // Sibling record: the same identity is a viewer there, so its write is refused.
        let threw = false;
        try {
          await docs.updateRecord(set.id, { type: "configurations", id: b.record.id }, { notes: "should fail" }, { updatedBy: "tech", actor: scoped });
        } catch (e) {
          threw = /not allowed/i.test(String(e && e.message));
        }
        assert(threw, "the documentation service refused the out-of-scope write");
        // A client-level technician may reach every record in the client.
        const clientTech = { name: "lead", role: "viewer", assignments: normalizeAssignments([{ scope: clientScope(set.id), role: "technician" }]) };
        await docs.updateRecord(set.id, { type: "configurations", id: b.record.id }, { notes: "ok" }, { updatedBy: "lead", actor: clientTech });
        const after = await docs.get(set.id, { force: true });
        const readA = after.records.configurations.find((r) => r.id === a.record.id);
        const readB = after.records.configurations.find((r) => r.id === b.record.id);
        assertEq(readA.notes, "patched", "the in-scope change landed");
        assertEq(readB.notes, "ok", "the client-level change landed");
      },
    },
  ]);
}
