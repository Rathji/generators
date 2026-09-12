// src/tests/passwords.test.js — validation tests for Phase 4 task 17 (password
// records — general vs embedded). Run in the live page:
//   await import("./src/tests/passwords.test.js").then((m) => m.run())
//
// Covers: the credential scope/category/permission catalogs; the standardized
// rule that a credential must declare its scope and category (and that an
// embedded credential must name its owner); a general credential's own
// permissions versus an embedded credential's INHERITED permissions; the
// credential relationship kinds; the addEmbeddedCredential context-create flow
// (owner set + ownership link + credentialsFor); and the integrity audit
// (unknown category, dangling embedded owner, malformed OTP secret).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { validateRecordFields } from "../framework/standardized.js";
import {
  PASSWORD_SCOPES,
  PASSWORD_CATEGORIES,
  PASSWORD_PERMISSIONS,
  DEFAULT_INHERITED_PERMISSIONS,
  validatePassword,
  passwordDetailLine,
  passwordIssues,
  effectivePermissions,
  isEmbedded,
  generalCredentials,
  embeddedCredentials,
} from "../framework/password.js";

const C = { informationModel: "core-asset", provenance: "authored" };

export async function run() {
  return runTests([
    {
      name: "the credential catalogs cover both scopes, the expected categories and the permission set",
      fn: () => {
        assertEq(PASSWORD_SCOPES.map((s) => s.id).join(","), "general,embedded", "both scopes");
        for (const id of ["local-admin", "domain-admin", "service-account", "user-account", "application", "database", "network-device", "cloud-service", "api-key", "certificate"]) {
          assert(PASSWORD_CATEGORIES.some((c) => c.id === id), "category " + id);
        }
        assert(PASSWORD_CATEGORIES.every((c) => c.group), "every category declares a group");
        for (const p of ["view", "use", "edit", "rotate", "share"]) assert(PASSWORD_PERMISSIONS.some((x) => x.id === p), "permission " + p);
      },
    },
    {
      name: "a credential must declare its scope and category — an embedded one must name its owner",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-passwords" });
        const set = await docs.create({ name: "Acme" });
        assert(!validatePassword({ name: "x", category: "user-account" }).ok, "missing scope refused by the validator");
        assert(!validateRecordFields("passwords", { name: "x", scope: "general" }).ok, "missing category refused by the validator");
        assert(validatePassword({ name: "x", scope: "general", category: "user-account" }).ok, "a general credential needs no owner");

        let threw = null;
        try {
          await docs.addRecord(set.id, { type: "passwords", name: "Domain admin", scope: "general", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "categoriless credential refused by the service");

        threw = null;
        try {
          await docs.addRecord(set.id, { type: "passwords", name: "Embedded one", scope: "embedded", category: "local-admin", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "embedded credential without an owner refused");
      },
    },
    {
      name: "a general credential carries its own permissions and links to many assets",
      fn: async () => {
        const { docs } = makeWorld("kb-passwords-general");
        const set = await docs.create({ name: "Acme" });
        const org = (await docs.addRecord(set.id, { type: "organizations", name: "Acme Corp", orgKind: "organization", ...C })).record;
        const loc = (await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...C })).record;
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "fw-01", configType: "firewall", ...C })).record;
        const pwd = (
          await docs.addRecord(set.id, {
            type: "passwords",
            name: "Domain admin",
            scope: "general",
            category: "domain-admin",
            username: "Administrator",
            secret: "S3cret!",
            permissions: ["view", "use"],
            ...C,
          })
        ).record;
        assertEq(isEmbedded(pwd), false, "general scope");
        const own = effectivePermissions(pwd, await docs.get(set.id));
        assertEq(own.inherited, false, "general permissions are its own");
        assertEq(own.permissions.join(","), "view,use", "stored permissions honoured");

        await docs.linkRecords(set.id, { from: { type: "passwords", id: pwd.id }, to: { type: "organizations", id: org.id }, kind: "password-organization" });
        await docs.linkRecords(set.id, { from: { type: "passwords", id: pwd.id }, to: { type: "locations", id: loc.id }, kind: "password-location" });
        await docs.linkRecords(set.id, { from: { type: "configurations", id: cfg.id }, to: { type: "passwords", id: pwd.id }, kind: "configuration-credential" });
        assertEq((await docs.relations(set.id, { type: "passwords", id: pwd.id })).length, 3, "one credential links to several assets");

        const line = passwordDetailLine(pwd, await docs.get(set.id));
        assert(line.startsWith("Directory administrator"), "detail line leads with the category");
        assert(line.includes("General"), "detail line states the scope");
        assert(line.includes("Administrator"), "detail line includes the username");
      },
    },
    {
      name: "an embedded credential inherits its owner's permissions instead of its own",
      fn: async () => {
        const { docs } = makeWorld("kb-passwords-embedded");
        const set = await docs.create({ name: "Acme" });
        const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Billing App", assetTypeId: "atype-applications", assetFields: {}, ...C })).record;
        await docs.updateRecord(set.id, { type: "flexibleAssets", id: app.id }, { credentialPermissions: ["view", "use", "rotate"] });
        const emb = (
          await docs.addRecord(set.id, {
            type: "passwords",
            name: "Billing service account",
            scope: "embedded",
            category: "service-account",
            embeddedIn: { type: "flexibleAssets", id: app.id },
            permissions: ["share"],
            ...C,
          })
        ).record;
        assertEq(isEmbedded(emb), true, "embedded scope");
        const perms = await docs.credentialPermissions(set.id, { type: "passwords", id: emb.id });
        assertEq(perms.inherited, true, "permissions are inherited");
        assertEq(perms.source, "owner", "the owner declared a set");
        assertEq(perms.permissions.join(","), "view,use,rotate", "the credential's own list is ignored");
        assert(!perms.permissions.includes("share"), "the embedded credential's own permission does not apply");

        // No declared set on the owner → the safe minimum applies.
        const app2 = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Mail App", assetTypeId: "atype-applications", assetFields: {}, ...C })).record;
        const emb2 = (await docs.addRecord(set.id, { type: "passwords", name: "Mail account", scope: "embedded", category: "email", embeddedIn: { type: "flexibleAssets", id: app2.id }, ...C })).record;
        const perms2 = await docs.credentialPermissions(set.id, { type: "passwords", id: emb2.id });
        assertEq(perms2.source, "default-inherited", "safe minimum when the owner declares nothing");
        assertEq(perms2.permissions.join(","), DEFAULT_INHERITED_PERMISSIONS.join(","), "default inherited set");
      },
    },
    {
      name: "addEmbeddedCredential creates the credential in the owner's context, with its ownership link",
      fn: async () => {
        const { docs } = makeWorld("kb-passwords-context");
        const set = await docs.create({ name: "Acme" });
        const cfg = (await docs.addRecord(set.id, { type: "configurations", name: "web-01", configType: "server-virtual", ...C })).record;
        const res = await docs.addEmbeddedCredential(set.id, { type: "configurations", id: cfg.id }, { name: "web-01 local admin", category: "local-admin", username: "Administrator", ...C });
        assertEq(res.record.scope, "embedded", "scope forced to embedded");
        assertEq(res.record.embeddedIn.type, "configurations", "owner stored");
        assertEq(res.record.embeddedIn.id, cfg.id, "owner id stored");
        const rels = await docs.relations(set.id, { type: "passwords", id: res.record.id });
        assert(rels.some((r) => r.relationship.kind === "password-embedded-in"), "ownership link created");
        const set2 = await docs.get(set.id);
        assertEq(generalCredentials(set2).length, 0, "not a general credential");
        assertEq(embeddedCredentials(set2).length, 1, "counted as embedded");
        assertEq((await docs.credentialsFor(set.id, { type: "configurations", id: cfg.id })).length, 1, "listed for its owner");

        let threw = null;
        try {
          await docs.addEmbeddedCredential(set.id, null, { name: "orphan", category: "other", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "an embedded credential needs an owner");
      },
    },
    {
      name: "the credential audit flags an unknown category, a dangling embedded owner and a malformed OTP secret",
      fn: async () => {
        const { docs } = makeWorld("kb-passwords-audit");
        const set = await docs.create({ name: "Acme" });
        const pwd = (await docs.addRecord(set.id, { type: "passwords", name: "web-01 local admin", scope: "general", category: "local-admin", ...C })).record;
        assertEq((await docs.integrity(set.id)).ok, true, "a valid general credential audits clean");
        const live = await docs.get(set.id);
        live.records.passwords[0].category = "made-up";
        live.records.passwords[0].scope = "embedded";
        live.records.passwords[0].embeddedIn = { type: "configurations", id: "cfg-nope" };
        live.records.passwords[0].otpSecret = "abc188";
        const issues = passwordIssues(live);
        assert(issues.some((i) => i.code === "unknown-password-category" && i.level === "error"), "unknown category");
        assert(issues.some((i) => i.code === "embedded-dangling-owner" && i.level === "error"), "dangling owner");
        assert(issues.some((i) => i.code === "bad-otp-secret" && i.level === "warning"), "malformed OTP is a warning");
        assert(issues.every((i) => !i.recordId || i.recordId === pwd.id), "issues name the record");
      },
    },
  ]);
}
