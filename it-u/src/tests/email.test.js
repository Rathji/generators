// src/tests/email.test.js — validation tests for Phase 8 task 31 (the
// Email-system asset). Run in the live page:
//   await import("./src/tests/email.test.js").then((m) => m.run())
//
// Covers: the email vocabulary catalogs (platforms, deployment models,
// authentication mechanisms, archiving, migration); the enriched
// `atype-email-system` template and its record-reference fields; the typed
// relationships an email service holds to its configurations, applications,
// domains, credentials, documents, security platform, vendor, licensing,
// certificates and people; the labelled relationship GROUPS the profile shows;
// the link-parameter/candidate computation behind those groups; and the
// structured-service completeness audit folded into the Linter.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { validateAssetType } from "../framework/flexible.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";
import {
  EMAIL_PLATFORMS,
  EMAIL_DEPLOYMENT_MODELS,
  EMAIL_AUTH_MECHANISMS,
  EMAIL_CORE_AUTH_MECHANISMS,
  EMAIL_ARCHIVE_MODES,
  EMAIL_MIGRATION_STATES,
  emailPlatform,
  emailPlatformLabel,
  platformDeployment,
  platformOptions,
  emailDeployment,
  deploymentOptions,
  emailAuthMechanism,
  authOptions,
  emailArchiveMode,
  archiveOptions,
  emailMigrationState,
  migrationOptions,
  emailCoverage,
  emailSystemIssues,
  EMAIL_SYSTEM_TYPE_ID,
} from "../framework/email.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const fx = (id) => builtinAssetType(id);
  const email = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Acme mail", assetTypeId: EMAIL_SYSTEM_TYPE_ID, assetFields: { platform: "microsoft365", deployment: "cloud", primaryDomain: "acme.example", authentication: ["spf", "dkim", "dmarc"], mailboxCount: 120 }, ...CL })).record;
  const config = (await docs.addRecord(set.id, { type: "configurations", name: "MAIL-01", configType: "server-virtual", ...CL })).record;
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Exchange Online", assetTypeId: fx("atype-applications").id, assetFields: { applicationType: "cloud" }, ...CL })).record;
  const domain = (await docs.addRecord(set.id, { type: "domains", name: "acme.example", ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "M365 global admin", scope: "general", category: "domain-admin", ...CL })).record;
  const doc = (await docs.addRecord(set.id, { type: "documents", name: "Mail migration plan", docType: "reference", ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Jo Bloggs", contactRole: "application-owner", ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Contoso", assetTypeId: fx("atype-vendor").id, assetFields: { vendorType: "software" }, ...CL })).record;
  const security = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Contoso Mail Protection", assetTypeId: fx("atype-security-platform").id, assetFields: { product: "Contoso Filter", platformType: "email-security" }, ...CL })).record;
  const licence = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "M365 E3", assetTypeId: fx("atype-licences").id, assetFields: { product: "Microsoft 365 E3", licenceType: "subscription" }, ...CL })).record;
  const cert = (await docs.addRecord(set.id, { type: "certificates", name: "mail.acme.example", ...CL })).record;
  return { set, email, config, app, domain, password, doc, contact, vendor, security, licence, cert };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.email, s.config, "email-configuration");
  await link(s.email, s.app, "email-application");
  await link(s.email, s.domain, "email-domain");
  await link(s.email, s.password, "email-password");
  await link(s.email, s.doc, "email-document");
  await link(s.email, s.security, "email-security");
  await link(s.email, s.vendor, "email-vendor");
  await link(s.email, s.cert, "email-certificate");
  await link(s.contact, s.email, "contact-email");
  await link(s.licence, s.email, "licence-application");
}

const codes = (issues) => issues.map((i) => i.code);

export async function run() {
  return runTests([
    {
      name: "the email-system template models the client's email infrastructure as a structured service",
      fn: () => {
        const type = builtinAssetType("atype-email-system");
        assert(validateAssetType(type).ok, "the shipped template validates");
        assertEq(type.category, "applications", "the email system lives in the applications category");

        const platform = type.fields.find((f) => f.key === "platform");
        assert(platform && platform.required && platform.type === "select", "platform is a required choice");
        assertEq(platform.options.length, EMAIL_PLATFORMS.length, "platform options come from the shared catalog");
        const deployment = type.fields.find((f) => f.key === "deployment");
        assert(deployment && deployment.required, "deployment model is required");
        assertEq(deployment.options.length, EMAIL_DEPLOYMENT_MODELS.length, "deployment options come from the catalog");

        const auth = type.fields.find((f) => f.key === "authentication");
        assert(auth && auth.type === "multiselect" && auth.options.length === EMAIL_AUTH_MECHANISMS.length, "authentication is a multi-choice over the mechanism catalog");
        assert(type.fields.find((f) => f.key === "archiving" && f.type === "select"), "archiving is recorded");
        assert(type.fields.find((f) => f.key === "migrationState" && f.type === "select"), "migration state is recorded");
        assert(type.fields.find((f) => f.key === "mailboxCount" && f.type === "number"), "mailbox count is numeric");
        assert(type.fields.find((f) => f.key === "mailFlow" && f.type === "textarea"), "mail flow is captured");
        assert(type.fields.find((f) => f.key === "mxRecord"), "the MX record is captured");

        assert(type.fields.find((f) => f.key === "mailHostRecord" && f.type === "record" && f.of === "configurations"), "points at a hosting configuration");
        assert(type.fields.find((f) => f.key === "adminCredential" && f.type === "record" && f.of === "passwords"), "points at an administrator credential");
        assert(type.fields.find((f) => f.key === "domainRecord" && f.type === "record" && f.of === "domains"), "points at the primary domain record");
        assert(type.fields.find((f) => f.key === "mailApplication" && f.type === "record" && f.of === "flexibleAssets"), "points at the mail application");

        for (const r of ["configurations", "contacts", "passwords", "flexibleAssets", "documents", "domains"]) {
          assert(type.references.includes(r), "may reference " + r);
        }
      },
    },
    {
      name: "the email catalogs expose platforms, deployments, authentication, archiving and migration",
      fn: () => {
        assertEq(emailPlatform("microsoft365").label, "Microsoft 365 (Exchange Online)", "platform lookup");
        assertEq(platformDeployment("exchange-hybrid"), "hybrid", "a platform implies its usual deployment");
        assertEq(emailPlatformLabel("google-workspace"), "Google Workspace (Gmail)", "platform label");
        assertEq(emailPlatform("bogus"), null, "an unknown platform is null");
        assertEq(emailDeployment("on-premises").label, "On-premises", "deployment lookup");
        assertEq(emailDeployment("bogus"), null, "an unknown deployment is null");
        assertEq(emailAuthMechanism("dmarc").label, "DMARC", "auth mechanism lookup");
        assertEq(emailAuthMechanism("bogus"), null, "an unknown mechanism is null");
        assertEq(EMAIL_CORE_AUTH_MECHANISMS.join(","), "spf,dkim,dmarc", "the core authentication trio");
        assertEq(emailArchiveMode("journaling").label, "Journaling", "archive mode lookup");
        assertEq(emailMigrationState("in-progress").label, "In progress", "migration state lookup");
        assertEq(platformOptions().length, EMAIL_PLATFORMS.length, "platform options mirror the catalog");
        assertEq(deploymentOptions().length, EMAIL_DEPLOYMENT_MODELS.length, "deployment options mirror the catalog");
        assertEq(authOptions().length, EMAIL_AUTH_MECHANISMS.length, "auth options mirror the catalog");
        assertEq(archiveOptions().length, EMAIL_ARCHIVE_MODES.length, "archive options mirror the catalog");
        assertEq(migrationOptions().length, EMAIL_MIGRATION_STATES.length, "migration options mirror the catalog");
        assert([platformOptions(), deploymentOptions(), authOptions(), archiveOptions(), migrationOptions()].every((opts) => opts.every((o) => o.id && o.label)), "every option is well formed");
      },
    },
    {
      name: "an email system relates to its configurations, applications, domains, credentials, documents, security, vendor, licensing, certificates and people",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-email" });
        const s = await seed(world);
        await linkAll(world, s);
        const rels = await world.docs.relations(s.set.id, ref(s.email));
        assertEq(rels.length, 10, "ten relationships touch the email system");
        assertEq(
          rels.map((r) => r.relationship.kind).sort().join(","),
          ["contact-email", "email-application", "email-certificate", "email-configuration", "email-document", "email-domain", "email-password", "email-security", "email-vendor", "licence-application"].join(","),
          "every requested relation kind is present",
        );
        const incoming = rels.filter((r) => r.direction === "in").map((r) => r.relationship.kind).sort();
        assertEq(incoming.join(","), "contact-email,licence-application", "the owner and the licence attach from their own side, visible from the email system");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "the relationship catalog refuses links that break it, duplicates and self-links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-email" });
        const s = await seed(world);
        let threw = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.email), to: ref(s.contact), kind: "email-domain" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "an email→domain link to a contact is refused");

        await world.docs.linkRecords(s.set.id, { from: ref(s.email), to: ref(s.config), kind: "email-configuration" });
        let dup = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.email), to: ref(s.config), kind: "email-configuration" });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "INVALID_DATA", "a duplicate link is refused");
        let self = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.email), to: ref(s.email), kind: "email-vendor" });
        } catch (e) {
          self = e;
        }
        assert(self && self.code === "INVALID_DATA", "a self-link is refused");
      },
    },
    {
      name: "the profile groups an email system's links into labelled buckets",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-email" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const type = builtinAssetType("atype-email-system");
        const grouped = groupLinks(s.email, set, type);
        assertEq(grouped.total, 10, "all ten links are accounted for");
        assertEq(grouped.leftovers.length, 0, "no links fall outside the named groups");
        const byId = Object.fromEntries(grouped.groups.map((g) => [g.id, g]));
        for (const id of ["configurations", "applications", "domains", "passwords", "documents", "security", "vendor", "licence", "certificates", "contacts"]) {
          assert(byId[id], "the " + id + " group exists");
          assertEq(byId[id].links.length, 1, "one link in the " + id + " group");
        }
        assertEq(byId.licence.direction, "in", "the licensing group attaches from the licence side");
        assertEq(byId.contacts.direction, "in", "the contacts group attaches from the contact side");
        assertEq(byId.configurations.links[0].other.name, "MAIL-01", "the far-side record is resolved");
        assertEq(byId.domains.label, "Mail domains", "the domain group is labelled");
      },
    },
    {
      name: "group link parameters and candidate lists drive the profile's link pickers",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-email" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const byId = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-email-system")).map((g) => [g.id, g]));

        const outParams = linkParamsFor(s.email, byId.configurations, s.config);
        assertEq(outParams.from.id, s.email.id, "an out group links from the email system");
        assertEq(outParams.to.id, s.config.id, "…to the candidate");
        assertEq(outParams.kind, "email-configuration", "…with the group's primary kind");
        const inParams = linkParamsFor(s.email, byId.licence, s.licence);
        assertEq(inParams.from.id, s.licence.id, "an in group links from the candidate");
        assertEq(inParams.to.id, s.email.id, "…to the email system");

        assert(relationCandidates(s.email, set, byId.vendor).some((r) => r.id === s.vendor.id), "an unlinked vendor is offered");
        await world.docs.linkRecords(s.set.id, { from: ref(s.email), to: ref(s.vendor), kind: "email-vendor" });
        const after = await world.docs.get(s.set.id, { force: true });
        assert(!relationCandidates(s.email, after, byId.vendor).some((r) => r.id === s.vendor.id), "a linked vendor drops out of the candidates");
        assert(!relationCandidates(s.email, after, byId.domains).some((r) => r.id === s.email.id), "a group never offers the email system itself");
        assert(!relationCandidates(s.email, after, byId.security).some((r) => r.id === s.app.id), "the template filter keeps a plain application out of the security group");
      },
    },
    {
      name: "emailSystemIssues audits the structured service's completeness and folds into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-email" });
        const set = await world.docs.create({ name: "Bare" });
        const bare = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Unplanned mail", assetTypeId: EMAIL_SYSTEM_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareSet = await world.docs.get(set.id, { force: true });
        const cov = emailCoverage(bare, bareSet);
        assert(!cov.configurations && !cov.credentials && !cov.documents && !cov.domains, "an empty service covers nothing");
        const issues = emailSystemIssues(bareSet);
        assertEq(issues.length, 7, "seven gaps flagged for a bare service");
        assert(codes(issues).includes("email-no-platform"), "missing platform");
        assert(codes(issues).includes("email-no-deployment"), "missing deployment");
        assert(codes(issues).includes("email-no-domain"), "missing domain");
        assert(codes(issues).includes("email-auth-gaps"), "missing authentication posture");
        assert(codes(issues).includes("email-no-credential"), "missing credential");
        assert(issues.every((i) => i.recordId === bare.id), "every issue names the record it concerns");
        assert(issues.every((i) => i.level === "warning"), "gaps are warnings, not errors");

        const folded = standardizedIssues(bareSet);
        assert(codes(folded).includes("email-no-platform"), "the linter folds the email audit in");
        assert((await world.docs.integrity(set.id)).ok, "completeness gaps never fail the graph audit");

        const s = await seed(world);
        await linkAll(world, s);
        const fullSet = await world.docs.get(s.set.id, { force: true });
        const full = emailSystemIssues(fullSet);
        assertEq(full.length, 0, "a fully documented and linked service raises no issues: " + JSON.stringify(full));
      },
    },
  ]);
}
