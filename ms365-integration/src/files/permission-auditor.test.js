// src/files/permission-auditor.test.js
// Validation suite for the Document Permission Auditor.
// Run via ?test=file-perms, or: await (await import("src/files/permission-auditor.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep, makeEnv } from "../test-helpers.js";
import * as pa from "./permission-auditor.js";

const { test, runAll } = makeSuite();
export { runAll };

const BASE = {
  "/me/drive/items/f1/permissions": {
    payload: {
      value: [
        { id: "p1", roles: ["write"], grantedTo: { user: { id: "u-1", email: "tester@contoso.com", displayName: "Test User" } } },
        { id: "p2", roles: ["read"], inheritedFrom: { id: "folder", path: "/DriveItem/folder" }, link: { type: "view", scope: "organization", webUrl: "https://1drv.ms/view" } },
        { id: "p3", roles: ["owner"], grantedToIdentities: [{ user: { id: "u-9" } }], link: { type: "edit", scope: "users", webUrl: "https://1drv.ms/edit" } },
      ],
    },
  },
};

test("getPermissions: fetches item permissions with $select, normalizes entries", async () => {
  const env = makeEnv({ routes: BASE });
  const perms = await pa.getPermissions({ itemId: "f1" });
  const url = env.calls.graph[0].url;
  assert(/\/me\/drive\/items\/f1\/permissions/.test(url.split("?")[0]), "endpoint");
  assert(/\$select=id,roles,link,inheritedFrom,grantedTo,grantedToIdentities,hasLinks,shareId/.test(decodeURIComponent(url)), "select");
  assertEq(perms.length, 3);
  const p1 = perms[0];
  assertDeep(p1.roles, ["write"]);
  assertEq(p1.grantedTo.email, "tester@contoso.com");
  assertEq(p1.inheritedFrom, null);
  const p2 = perms[1];
  assertEq(p2.inheritedFrom.id, "folder");
  assertEq(p2.link.type, "view");
  assertEq(p2.link.webUrl, "https://1drv.ms/view");
});

test("checkAccess: owner role → admin (can read/write/admin)", async () => {
  const env = makeEnv({ routes: BASE });
  const v = await pa.checkAccess({ itemId: "f1" });
  assertEq(v.access, "admin");
  assertEq(v.canRead, true);
  assertEq(v.canWrite, true);
  assertEq(v.canAdmin, true);
  assertDeep(v.effectiveRoles, ["owner", "write", "read"]);
});

test("checkAccess: write + read (no owner) → write", async () => {
  const env = makeEnv({
    routes: { "/me/drive/items/f2/permissions": { payload: { value: [{ id: "p1", roles: ["write"] }, { id: "p2", roles: ["read"] }] } } },
  });
  const v = await pa.checkAccess({ itemId: "f2" });
  assertEq(v.access, "write");
  assertEq(v.canRead, true);
  assertEq(v.canWrite, true);
  assertEq(v.canAdmin, false);
});

test("checkAccess: read-only → read; no permissions → none", async () => {
  const env = makeEnv({
    routes: {
      "/me/drive/items/f3/permissions": { payload: { value: [{ id: "p1", roles: ["read"] }] } },
      "/me/drive/items/f4/permissions": { payload: { value: [] } },
    },
  });
  const v = await pa.checkAccess({ itemId: "f3" });
  assertEq(v.access, "read");
  assertEq(v.canWrite, false);
  const v2 = await pa.checkAccess({ itemId: "f4" });
  assertEq(v2.access, "none");
  assertEq(v2.canRead, false);
});

test("analyzePermissions: direct vs inherited split + edit link priority", () => {
  const v = pa.analyzePermissions([
    { id: "a", roles: ["owner"], link: { type: "edit", scope: "users", webUrl: "https://1drv.ms/e" } },
    { id: "b", roles: ["read"], inheritedFrom: { id: "folder", path: "/x" }, link: { type: "view", webUrl: "https://1drv.ms/v" } },
  ]);
  assertEq(v.directPermissionCount, 1);
  assertEq(v.inheritedPermissionCount, 1);
  assertEq(v.access, "admin");
  assertEq(v.sharingLink.type, "edit");
  assertEq(v.sharingLink.webUrl, "https://1drv.ms/e");
});

test("analyzePermissions: role aliases (contributor/edit, fullcontrol/manage, view/reader)", () => {
  const v = pa.analyzePermissions([
    { id: "a", roles: ["contributor"] },
    { id: "b", roles: ["fullcontrol"] },
    { id: "c", roles: ["view"] },
  ]);
  assertEq(v.access, "admin");
  const w = pa.analyzePermissions([{ id: "a", roles: ["contributor"] }]);
  assertEq(w.access, "write");
  const r = pa.analyzePermissions([{ id: "a", roles: ["reader"] }]);
  assertEq(r.access, "read");
});

test("describeAccess: friendly labels", () => {
  assertEq(pa.describeAccess({ access: "admin" }), "admin (full control)");
  assertEq(pa.describeAccess({ access: "write" }), "read/write");
  assertEq(pa.describeAccess({ access: "read" }), "read-only");
  assertEq(pa.describeAccess({ access: "none" }), "no access");
});

test("getPermissions: missing itemId throws", async () => {
  let threw = false;
  try { await pa.getPermissions({}); } catch (e) { threw = true; }
  assert(threw, "itemId required");
});

test("normalizePermission: bare / group / application identities", () => {
  const p = pa.normalizePermission({ id: "x", roles: ["read"], grantedTo: { group: { id: "g1", email: "team@contoso.com", displayName: "Team" } } });
  assertEq(p.grantedTo.id, "g1");
  assertDeep(p.roles, ["read"]);
  const app = pa.normalizePermission({ id: "y", grantedTo: { application: { id: "a1", displayName: "App" } } });
  assertEq(app.grantedTo.displayName, "App");
  assertEq(pa.normalizePermission(null), null);
});
