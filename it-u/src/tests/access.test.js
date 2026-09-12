// src/tests/access.test.js — validation tests for Phase 4 task 20 (groups,
// permissions & the access model). Run in the live page:
//   await import("./src/tests/access.test.js").then((m) => m.run())
//
// Covers: the level/action catalogs and the token model (which actions may be
// granted at which level); group normalization/validation; the groups IT-U
// ships; the union of role-default + assigned + membership permissions; the
// resource → level mapping (including the embedded-credential rule — an
// embedded credential is governed by the record it belongs to, and by that
// record's declared credential-permission set); the never-throwing `can` and
// the throwing `require`; the persistent group library (create/update/clone/
// remove/reset/restore/assign); and the enforcement of the model by the
// documentation service.

import { runTests, assert, assertEq } from "./harness.js";
import { makeAccessWorld, assertThrowsCode } from "./testFixtures.js";
import {
  ACCESS_LEVELS,
  ACCESS_ACTIONS,
  ACCESS_MATRIX,
  OWNER_PERMISSIONS,
  BUILTIN_GROUPS,
  ROLE_GROUPS,
  permissionToken,
  parsePermission,
  isKnownPermission,
  normalizeGroup,
  validateGroup,
  requireGroup,
  levelForType,
  credentialActionLevelAction,
  combinePermissions,
} from "../framework/groups.js";

const C = { informationModel: "core-asset", provenance: "authored" };

// A deterministic role map for the tests: the "owner" string already resolves
// to the owner before getRole is consulted; every other identity maps here.
const ROLES = { alice: "technician", bob: "viewer", carol: "helpdesk", dave: "admin" };

const makeWorld = (ns = "kb-access") => makeAccessWorld(ns, (u) => ROLES[u] || "viewer");

export async function run() {
  return runTests([
    {
      name: "the level/action catalogs define the permission tokens",
      fn: () => {
        assertEq(ACCESS_LEVELS.map((l) => l.id).join(","), "organization,asset,document,general-password,administrative", "five levels");
        for (const a of ["view", "use", "edit", "create", "delete", "rotate", "share", "administer"]) {
          assert(ACCESS_ACTIONS.some((x) => x.id === a), "action " + a);
        }
        assert(ACCESS_MATRIX["general-password"].includes("rotate"), "rotate is a credential action");
        assert(!ACCESS_MATRIX.asset.includes("rotate"), "rotate is not an asset action");
        assertEq(permissionToken("asset", "edit"), "asset.edit", "token shape");
        assertEq(parsePermission("general-password.rotate").action, "rotate", "parse action");
        assertEq(parsePermission("nonsense.view"), null, "unknown level does not parse");
        assert(isKnownPermission("general-password.rotate"), "known credential permission");
        assert(!isKnownPermission("asset.rotate"), "rotate is not grantable at the asset level");
        assertEq(OWNER_PERMISSIONS.length, combinePermissions([{ permissions: OWNER_PERMISSIONS }]).size, "owner holds every grantable token");
        assert(OWNER_PERMISSIONS.includes("administrative.administer"), "owner can administer");
      },
    },
    {
      name: "a group is normalized and validated — unknown permissions are refused",
      fn: () => {
        const g = normalizeGroup({ name: "  Field techs  ", permissions: ["asset.view", "asset.edit", "asset.view", "bogus.perm"] });
        assertEq(g.name, "Field techs", "name trimmed");
        assertEq(g.permissions.join(","), "asset.edit,asset.view", "deduped and sorted, unknown dropped");
        assertEq(g.members.length, 0, "no members");
        assert(!validateGroup({ permissions: [] }).ok, "a group needs a name");
        assert(!validateGroup({ name: "x", permissions: ["asset.teleport"] }).ok, "unknown permission rejected");
        assert(!validateGroup({ name: "x", permissions: ["asset.view"], members: "alice" }).ok, "members must be a list");
        assert(validateGroup({ name: "x", permissions: ["asset.view"], members: ["alice"] }).ok, "a well-formed group passes");
        let threw = null;
        try {
          requireGroup({ name: "", permissions: [] });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "requireGroup throws INVALID_DATA");
      },
    },
    {
      name: "IT-U ships the groups a TSP works with",
      fn: () => {
        const ids = BUILTIN_GROUPS.map((g) => g.id);
        for (const id of ["group-administrators", "group-technicians", "group-helpdesk", "group-viewers", "group-credential-custodians"]) {
          assert(ids.includes(id), "ships " + id);
        }
        assert(BUILTIN_GROUPS.every((g) => g.builtin === true), "all flagged builtin");
        const admins = BUILTIN_GROUPS.find((g) => g.id === "group-administrators");
        assertEq(admins.permissions.length, OWNER_PERMISSIONS.length, "administrators hold every permission");
        const techs = BUILTIN_GROUPS.find((g) => g.id === "group-technicians");
        assert(techs.permissions.includes("general-password.rotate"), "technicians may rotate general credentials");
        assert(!techs.permissions.includes("administrative.administer"), "technicians may not administer");
        assert(!techs.permissions.some((p) => p.startsWith("general-password.share")), "technicians may not share secrets");
        const viewers = BUILTIN_GROUPS.find((g) => g.id === "group-viewers");
        assert(viewers.permissions.every((p) => p.endsWith(".view")), "viewers hold view permissions only");
        assert(!viewers.permissions.some((p) => p.startsWith("general-password")), "viewers hold no credential grant");
        assertEq(ROLE_GROUPS.technician, "group-technicians", "role default mapping");
      },
    },
    {
      name: "effective access is the union of the role default, assigned groups and membership",
      fn: async () => {
        const { access } = await makeWorld("kb-access-effective");
        // Owner — full tokens, flagged owner.
        const owner = access.effectiveAccess("owner");
        assertEq(owner.owner, true, "owner flagged");
        assertEq(owner.tokens.size, OWNER_PERMISSIONS.length, "owner holds everything");
        // Role default.
        assert(access.effectiveAccess("alice").tokens.has("asset.edit"), "technician role grants asset.edit");
        assert(!access.effectiveAccess("bob").tokens.has("asset.edit"), "viewer role is read-only");
        // Admin role — everything, but not the owner flag.
        const dave = access.effectiveAccess("dave");
        assertEq(dave.owner, false, "an admin is not the owner");
        assertEq(dave.tokens.size, OWNER_PERMISSIONS.length, "admin holds every token");
        // Membership is additive.
        await access.assignGroups("erin", ["group-credential-custodians"]);
        const erin = access.effectiveAccess("erin");
        assert(erin.tokens.has("general-password.share"), "membership adds credential tokens");
        assert(erin.groups.some((g) => g.id === "group-credential-custodians"), "membership listed");
        assertEq((await access.groupsFor("erin")).length, 1, "groupsFor finds the membership");
        // Explicit groups passed on the actor are honoured.
        const viaActor = access.effectiveAccess({ id: "frank", name: "Frank", role: "viewer", groups: ["group-technicians"] });
        assert(viaActor.tokens.has("asset.edit"), "explicitly passed group applies");
      },
    },
    {
      name: "records map to levels and credential actions map onto the owning level",
      fn: () => {
        assertEq(levelForType("organizations"), "organization", "organization level");
        assertEq(levelForType("locations"), "asset", "locations are assets");
        assertEq(levelForType("configurations"), "asset", "configurations are assets");
        assertEq(levelForType("documents"), "document", "document level");
        assertEq(levelForType("passwords"), "general-password", "credential level");
        assertEq(credentialActionLevelAction("view"), "view", "view maps to view");
        assertEq(credentialActionLevelAction("use"), "view", "use maps to view");
        assertEq(credentialActionLevelAction("edit"), "edit", "edit maps to edit");
        assertEq(credentialActionLevelAction("rotate"), "edit", "rotate maps to edit");
        assertEq(credentialActionLevelAction("share"), "edit", "share maps to edit");
      },
    },
    {
      name: "can() never throws and require() throws FORBIDDEN when a token is missing",
      fn: async () => {
        const { access } = await makeWorld("kb-access-can");
        const badToken = access.can("bob", { level: "asset", action: "edit" });
        assertEq(badToken.allow, false, "viewer cannot edit assets");
        assertEq(badToken.code, "FORBIDDEN", "denial is coded");
        const ok = access.can("alice", { level: "asset", action: "edit" });
        assertEq(ok.allow, true, "technician can edit assets");
        assertEq(ok.code, "GRANTED", "grant is coded");
        assertEq(access.can("bob", { level: null, action: null }).allow, true, "an unscoped request is not gated");
        let threw = null;
        try {
          access.require("bob", { level: "asset", action: "edit" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "FORBIDDEN", "require throws FORBIDDEN");
        assert(String(threw.message).includes("Viewer"), "the refusal names the role");
      },
    },
    {
      name: "a general credential is gated at the credential level; an embedded one follows its owner",
      fn: async () => {
        const { access, docs } = await makeWorld("kb-access-credentials");
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        const general = (await docs.addRecord(set.id, { type: "passwords", name: "Domain admin", scope: "general", category: "domain-admin", secret: "S3cret!", ...C })).record;
        const embedded = (await docs.addRecord(set.id, { type: "passwords", name: "web-01 local admin", scope: "embedded", category: "local-admin", embeddedIn: { type: "configurations", id: cfg.id }, secret: "Loc4l!", ...C })).record;
        const live = await docs.get(set.id);

        // General credentials need their OWN level token — a viewer holds none.
        assertEq(access.can("bob", { record: general, set: live }).allow, false, "viewer cannot view a general credential");
        assertEq(access.can("alice", { record: general, set: live }).allow, true, "technician can view a general credential");
        assertEq(access.can("carol", { record: general, set: live }).allow, true, "help desk can view a general credential");
        assertEq(access.can("carol", { record: general, set: live, action: "rotate" }).allow, false, "help desk cannot rotate");

        // Embedded credentials resolve through the owning asset (asset level).
        const seeEmbedded = access.describe("bob", { record: embedded, set: live });
        assertEq(seeEmbedded.level, "asset", "embedded credential resolves to the asset level");
        assertEq(seeEmbedded.embedded, true, "recognised as embedded");
        assertEq(seeEmbedded.view, true, "a viewer who sees the asset may see its embedded credential");
        assertEq(seeEmbedded.edit, false, "a viewer may not edit it");
        assertEq(seeEmbedded.rotate, false, "a viewer may not rotate it");

        // A technician may view the embedded credential, but the owner has
        // declared no credential permissions, so the safe minimum applies and
        // rotation is still refused by the record's inherited permission set.
        const tech = access.describe("alice", { record: embedded, set: live });
        assertEq(tech.view, true, "technician may view the embedded credential");
        assertEq(tech.rotate, false, "safe-minimum inherited set withholds rotate");

        // Once the owning asset declares its credential permissions, the group
        // token and the declared set must BOTH allow the action.
        await docs.updateRecord(set.id, { type: "configurations", id: cfg.id }, { credentialPermissions: ["view", "use", "edit", "rotate"] });
        const live2 = await docs.get(set.id);
        const embedded2 = live2.records.passwords.find((p) => p.id === embedded.id);
        assertEq(access.can("alice", { record: embedded2, set: live2, action: "rotate" }).allow, true, "technician rotates once the owner allows it");
        assertEq(access.can("bob", { record: embedded2, set: live2, action: "rotate" }).allow, false, "the viewer still cannot rotate");
        assertEq(access.can("dave", { record: embedded2, set: live2, action: "edit" }).allow, true, "an administrator can edit");

        // A general credential can be narrowed to view-only by its own set.
        await docs.updateRecord(set.id, { type: "passwords", id: general.id }, { permissions: ["view"] });
        const live3 = await docs.get(set.id);
        const general2 = live3.records.passwords.find((p) => p.id === general.id);
        assertEq(access.can("alice", { record: general2, set: live3, action: "rotate" }).allow, false, "a view-only credential cannot be rotated even by a technician");
      },
    },
    {
      name: "the group library persists, and shipped groups are protected and resettable",
      fn: async () => {
        const { access, store } = await makeWorld("kb-access-library");
        const created = await access.create({ name: "Field techs — North", permissions: ["asset.view", "asset.edit"], members: ["zoe"] });
        assert(created.group.id.startsWith("group-field-techs"), "id derived from the name");
        assertEq(created.group.builtin, false, "custom group is not builtin");
        await access.update(created.group.id, { description: "Northern field team", permissions: ["asset.view", "asset.edit", "document.view"] });
        const updated = await access.get(created.group.id);
        assertEq(updated.description, "Northern field team", "description saved");
        assertEq(updated.permissions.length, 3, "permissions updated");
        const clone = await access.clone(created.group.id, { name: "Field techs — South" });
        assertEq(clone.group.permissions.length, 3, "clone carries the permissions");
        assert(!clone.group.builtin, "clone is not builtin");

        // A shipped group cannot be deleted by accident, only reset.
        let threw = null;
        try {
          await access.remove("group-viewers");
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "shipped group defends against removal");
        await access.update("group-viewers", { permissions: ["asset.view", "asset.edit"] });
        assert((await access.get("group-viewers")).permissions.includes("asset.edit"), "shipped group can be customised");
        await access.reset("group-viewers", {});
        assert(!(await access.get("group-viewers")).permissions.includes("asset.edit"), "reset restores the shipped permissions");

        // The library is stored as one versioned document.
        const raw = await store.readDocument("access-groups");
        assert(raw && raw.data && raw.data.schema === "itu-access-groups/1", "library persisted under its schema");
        assert(raw.data.groups.some((g) => g.id === created.group.id), "custom group persisted");
        assertEqualCount(await access.libraryMeta(), raw.data.groups.length, "library meta counts groups");
      },
    },
    {
      name: "the documentation service enforces the access model when an actor is supplied",
      fn: async () => {
        const { access, docs } = await makeWorld("kb-access-enforce");
        const set = await docs.create({ name: "Acme" });
        const cred = (await docs.addRecord(set.id, { type: "passwords", name: "Domain admin", scope: "general", category: "domain-admin", secret: "S3cret!", ...C })).record;
        const credRef = { type: "passwords", id: cred.id };
        const orgInput = { type: "organizations", name: "Acme Corp", orgKind: "organization", ...C };

        // A viewer may not create, edit or delete records.
        await assertThrowsCode(() => docs.addRecord(set.id, orgInput, { actor: "bob", updatedBy: "bob" }), "FORBIDDEN", "viewer cannot create");
        await assertThrowsCode(() => docs.updateRecord(set.id, credRef, { username: "x" }, { actor: "bob" }), "FORBIDDEN", "viewer cannot edit");
        await assertThrowsCode(() => docs.removeRecord(set.id, credRef, { actor: "bob" }), "FORBIDDEN", "viewer cannot delete");
        await assertThrowsCode(() => docs.configureCompleteness(set.id, { required: ["serialNumber"] }, { actor: "bob" }), "FORBIDDEN", "viewer cannot administer");
        await assertThrowsCode(() => docs.remove(set.id, { actor: "bob" }), "FORBIDDEN", "viewer cannot delete the set");
        await assertThrowsCode(() => docs.rename(set.id, "Renamed", { actor: "bob" }), "FORBIDDEN", "viewer cannot rename the set");

        // The owner (and, back-compatibly, a caller that supplies no actor) may.
        const org = (await docs.addRecord(set.id, orgInput, { actor: "owner" })).record;
        assert(org.id, "owner may create");
        const noActor = await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C }, { updatedBy: "bob" });
        assert(noActor.record.id, "with no actor the check is skipped (local mode)");
        await docs.updateRecord(set.id, { type: "organizations", id: org.id }, { name: "Acme Corporation" }, { actor: "owner" });

        // Revealing and rotating a credential are separately gated.
        await assertThrowsCode(() => docs.revealCredential(set.id, credRef, { actor: "bob" }), "FORBIDDEN", "viewer cannot reveal");
        const revealed = await docs.revealCredential(set.id, credRef, { actor: "owner" });
        assertEq(revealed.secret, "S3cret!", "owner sees the secret");
        assertEq(revealed.permissions.permissions.join(","), "view,use,edit,rotate", "permissions reported alongside the secret");
        const noActorReveal = await docs.revealCredential(set.id, credRef, {});
        assertEq(noActorReveal.secret, "S3cret!", "no actor → not gated");
        const techReveal = await docs.revealCredential(set.id, credRef, { actor: "alice" });
        assertEq(techReveal.secret, "S3cret!", "technician may view the general credential");
        await assertThrowsCode(() => docs.rotateCredential(set.id, credRef, { secret: "N3w!" }, { actor: "carol" }), "FORBIDDEN", "help desk cannot rotate");
        const rotated = await docs.rotateCredential(set.id, credRef, { secret: "N3w!", rotatedAt: "2026-01-02" }, { actor: "alice", updatedBy: "alice" });
        assertEq(rotated.record.secret, "N3w!", "technician rotated the secret");
        assertEq(rotated.record.rotatedAt, "2026-01-02", "rotation recorded");

        // Assigning a group changes what an identity may do.
        await access.assignGroups("bob", ["group-technicians"]);
        const afterAssign = await docs.addRecord(set.id, { type: "locations", name: "Depot", locationType: "site", ...C }, { actor: "bob" });
        assert(afterAssign.record.id, "a viewer promoted by group membership may now create");
      },
    },
  ]);
}

function assertEqualCount(meta, n, label) {
  assertEq(meta.count, n, label);
}
