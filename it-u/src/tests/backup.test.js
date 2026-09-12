// src/tests/backup.test.js — validation tests for Phase 8 task 32 (the Backup
// asset). Run in the live page:
//   await import("./src/tests/backup.test.js").then((m) => m.run())
//
// Covers: the backup vocabulary catalogs (architectures, deployment models,
// destinations, schedules, restore-test results); the enriched
// `atype-backup-service` template and its record-reference fields; the typed
// relationships a backup service holds to its protected configurations, its
// application, storage, vendor, credentials, procedures/recovery documents,
// supporting documents, reference checklist and people; the labelled
// relationship GROUPS the profile shows; the link-parameter/candidate
// computation behind those groups; and the structured-service completeness
// audit folded into the Linter.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { builtinAssetType } from "../framework/assetLibrary.js";
import { validateAssetType } from "../framework/flexible.js";
import { relationGroupsFor, groupLinks, relationCandidates, linkParamsFor } from "../framework/assetRelations.js";
import {
  BACKUP_ARCHITECTURES,
  BACKUP_DEPLOYMENT_MODELS,
  BACKUP_DESTINATIONS,
  BACKUP_SCHEDULES,
  BACKUP_TEST_RESULTS,
  backupArchitecture,
  backupArchitectureLabel,
  backupDeployment,
  backupDestination,
  isOffsiteDestination,
  OFFSITE_DESTINATION_IDS,
  backupSchedule,
  backupTestResult,
  isSuccessfulTest,
  architectureOptions,
  backupDeploymentOptions,
  destinationOptions,
  scheduleOptions,
  testResultOptions,
  backupCoverage,
  backupIssues,
  BACKUP_SERVICE_TYPE_ID,
} from "../framework/backup.js";
import { standardizedIssues } from "../framework/standardized.js";

const CL = { informationModel: "document", provenance: "authored" };
const ref = (r) => ({ type: r.type, id: r.id });

async function seed(world) {
  const { docs } = world;
  const set = await docs.create({ name: "Acme" });
  const fx = (id) => builtinAssetType(id);
  const backup = (await docs.addRecord(set.id, {
    type: "flexibleAssets",
    name: "Veeam nightly",
    assetTypeId: BACKUP_SERVICE_TYPE_ID,
    assetFields: { product: "Veeam Backup & Replication", architecture: "image", deploymentModel: "agent", destinations: ["nas", "cloud"], lastRestoreTest: "2026-08-01", lastRestoreResult: "success" },
    ...CL,
  })).record;
  const fileServer = (await docs.addRecord(set.id, { type: "configurations", name: "FILE-01", configType: "server-virtual", ...CL })).record;
  const app = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Veeam Console", assetTypeId: fx("atype-applications").id, assetFields: { applicationType: "server" }, ...CL })).record;
  const storage = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Backup NAS", assetTypeId: fx("atype-file-sharing").id, assetFields: { product: "Synology", storageType: "nas" }, ...CL })).record;
  const vendor = (await docs.addRecord(set.id, { type: "flexibleAssets", name: "Veeam", assetTypeId: fx("atype-vendor").id, assetFields: { vendorType: "software" }, ...CL })).record;
  const password = (await docs.addRecord(set.id, { type: "passwords", name: "Backup console admin", scope: "general", category: "backup", ...CL })).record;
  const procedure = (await docs.addRecord(set.id, { type: "documents", name: "Nightly backup runbook", docType: "sop", body: "# Backup runbook\n\n1. Check the job status.\n2. Investigate failures.", ...CL })).record;
  const recovery = (await docs.addRecord(set.id, { type: "documents", name: "Disaster recovery plan", docType: "recovery", ...CL })).record;
  const supporting = (await docs.addRecord(set.id, { type: "documents", name: "Vendor backup guide", docType: "reference", ...CL })).record;
  const checklist = (await docs.addRecord(set.id, { type: "checklists", name: "Restore test checklist", items: [], ...CL })).record;
  const contact = (await docs.addRecord(set.id, { type: "contacts", name: "Dana Reed", contactRole: "application-owner", ...CL })).record;
  return { set, backup, fileServer, app, storage, vendor, password, procedure, recovery, supporting, checklist, contact };
}

async function linkAll(world, s) {
  const link = (from, to, kind) => world.docs.linkRecords(s.set.id, { from: ref(from), to: ref(to), kind });
  await link(s.backup, s.fileServer, "backup-protected-configs");
  await link(s.backup, s.app, "backup-application");
  await link(s.backup, s.storage, "backup-storage");
  await link(s.backup, s.vendor, "backup-vendor");
  await link(s.backup, s.password, "backup-password");
  await link(s.backup, s.procedure, "backup-procedure");
  await link(s.backup, s.recovery, "backup-recovery");
  await link(s.backup, s.supporting, "backup-document");
  await link(s.backup, s.checklist, "backup-checklist");
  await link(s.contact, s.backup, "contact-backup");
}

const codes = (issues) => issues.map((i) => i.code);

export async function run() {
  return runTests([
    {
      name: "the backup template models the client's backup arrangement as a structured service",
      fn: () => {
        const type = builtinAssetType("atype-backup-service");
        assert(validateAssetType(type).ok, "the shipped template validates");
        assertEq(type.category, "infrastructure", "the backup service lives in the infrastructure category");

        const arch = type.fields.find((f) => f.key === "architecture");
        assert(arch && arch.required && arch.type === "select", "architecture is a required choice");
        assertEq(arch.options.length, BACKUP_ARCHITECTURES.length, "architecture options come from the shared catalog");
        const deploy = type.fields.find((f) => f.key === "deploymentModel");
        assert(deploy && deploy.type === "select", "deployment model is a choice");
        assertEq(deploy.options.length, BACKUP_DEPLOYMENT_MODELS.length, "deployment options come from the catalog");
        const dest = type.fields.find((f) => f.key === "destinations");
        assert(dest && dest.type === "multiselect" && dest.options.length === BACKUP_DESTINATIONS.length, "destinations are a multi-choice over the destination catalog");
        assert(type.fields.find((f) => f.key === "schedule" && f.type === "select"), "schedule is recorded");
        assert(type.fields.find((f) => f.key === "retention"), "retention is captured");
        assert(type.fields.find((f) => f.key === "lastRestoreTest" && f.type === "date"), "the last restore test is dated");
        assert(type.fields.find((f) => f.key === "lastRestoreResult" && f.type === "select"), "the restore test result is recorded");
        assert(type.fields.find((f) => f.key === "businessRules" && f.type === "textarea"), "client business rules are captured");

        assert(type.fields.find((f) => f.key === "backupHost" && f.type === "record" && f.of === "configurations"), "points at a backup host configuration");
        assert(type.fields.find((f) => f.key === "adminCredential" && f.type === "record" && f.of === "passwords"), "points at an administrator credential");
        assert(type.fields.find((f) => f.key === "backupApplication" && f.type === "record" && f.of === "flexibleAssets"), "points at the backup application");
        assert(type.fields.find((f) => f.key === "recoveryDocument" && f.type === "record" && f.of === "documents"), "points at a recovery document");
        assert(type.fields.find((f) => f.key === "referenceChecklist" && f.type === "record" && f.of === "checklists"), "points at a reference checklist");

        for (const r of ["configurations", "contacts", "passwords", "flexibleAssets", "documents", "checklists"]) {
          assert(type.references.includes(r), "may reference " + r);
        }
      },
    },
    {
      name: "the backup catalogs expose architectures, deployments, destinations, schedules and restore results",
      fn: () => {
        assertEq(backupArchitecture("image").label, "Image / bare metal", "architecture lookup");
        assertEq(backupArchitectureLabel("cloud-to-cloud"), "Cloud-to-cloud", "architecture label");
        assertEq(backupArchitecture("bogus"), null, "an unknown architecture is null");
        assertEq(backupDeployment("agent").label, "Agent-based", "deployment lookup");
        assertEq(backupDestination("cloud").label, "Cloud / object storage", "destination lookup");
        assert(isOffsiteDestination("cloud") && isOffsiteDestination("offsite-vault") && isOffsiteDestination("secondary-site"), "cloud, vault and secondary site are off-site");
        assert(!isOffsiteDestination("nas") && !isOffsiteDestination("tape"), "NAS and tape are not off-site on their own");
        assertEq(OFFSITE_DESTINATION_IDS.join(","), "cloud,offsite-vault,secondary-site", "the off-site destination set");
        assertEq(backupSchedule("weekly").label, "Weekly", "schedule lookup");
        assertEq(backupTestResult("success").label, "Success", "result lookup");
        assert(isSuccessfulTest("success") && !isSuccessfulTest("partial") && !isSuccessfulTest("failed") && !isSuccessfulTest("not-tested"), "only a successful test counts");
        assertEq(architectureOptions().length, BACKUP_ARCHITECTURES.length, "architecture options mirror the catalog");
        assertEq(backupDeploymentOptions().length, BACKUP_DEPLOYMENT_MODELS.length, "deployment options mirror the catalog");
        assertEq(destinationOptions().length, BACKUP_DESTINATIONS.length, "destination options mirror the catalog");
        assertEq(scheduleOptions().length, BACKUP_SCHEDULES.length, "schedule options mirror the catalog");
        assertEq(testResultOptions().length, BACKUP_TEST_RESULTS.length, "result options mirror the catalog");
        assert([architectureOptions(), backupDeploymentOptions(), destinationOptions(), scheduleOptions(), testResultOptions()].every((opts) => opts.every((o) => o.id && o.label)), "every option is well formed");
      },
    },
    {
      name: "a backup service relates to its protected configurations, application, storage, vendor, credential, documents, checklist and people",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-backup" });
        const s = await seed(world);
        await linkAll(world, s);
        const rels = await world.docs.relations(s.set.id, ref(s.backup));
        assertEq(rels.length, 10, "ten relationships touch the backup service");
        assertEq(
          rels.map((r) => r.relationship.kind).sort().join(","),
          ["backup-application", "backup-checklist", "backup-document", "backup-password", "backup-procedure", "backup-protected-configs", "backup-recovery", "backup-storage", "backup-vendor", "contact-backup"].join(","),
          "every requested relation kind is present",
        );
        const incoming = rels.filter((r) => r.direction === "in").map((r) => r.relationship.kind).sort();
        assertEq(incoming.join(","), "contact-backup", "the owner attaches from the contact side, visible from the backup service");

        const integrity = await world.docs.integrity(s.set.id);
        assert(integrity.ok, "the graph audit passes: " + JSON.stringify(integrity.issues));
      },
    },
    {
      name: "the relationship catalog refuses links that break it, duplicates and self-links",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-backup" });
        const s = await seed(world);
        let threw = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.backup), to: ref(s.contact), kind: "backup-checklist" });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_DATA", "a backup→checklist link to a contact is refused");

        await world.docs.linkRecords(s.set.id, { from: ref(s.backup), to: ref(s.fileServer), kind: "backup-protected-configs" });
        let dup = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.backup), to: ref(s.fileServer), kind: "backup-protected-configs" });
        } catch (e) {
          dup = e;
        }
        assert(dup && dup.code === "INVALID_DATA", "a duplicate link is refused");
        let self = null;
        try {
          await world.docs.linkRecords(s.set.id, { from: ref(s.backup), to: ref(s.backup), kind: "backup-application" });
        } catch (e) {
          self = e;
        }
        assert(self && self.code === "INVALID_DATA", "a self-link is refused");
      },
    },
    {
      name: "the profile groups a backup service's links into labelled buckets",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-backup" });
        const s = await seed(world);
        await linkAll(world, s);
        const set = await world.docs.get(s.set.id, { force: true });
        const type = builtinAssetType("atype-backup-service");
        const grouped = groupLinks(s.backup, set, type);
        assertEq(grouped.total, 10, "all ten links are accounted for");
        assertEq(grouped.leftovers.length, 0, "no links fall outside the named groups");
        const byId = Object.fromEntries(grouped.groups.map((g) => [g.id, g]));
        for (const id of ["configurations", "applications", "storage", "vendor", "passwords", "procedures", "documents", "checklists", "contacts"]) {
          assert(byId[id], "the " + id + " group exists");
        }
        assertEq(byId.procedures.links.length, 2, "the procedures group holds the procedure and recovery documents");
        assertEq(byId.contacts.direction, "in", "the contacts group attaches from the contact side");
        assertEq(byId.configurations.links[0].other.name, "FILE-01", "the far-side record is resolved");
        assertEq(byId.configurations.label, "Protected systems", "the protected-systems group is labelled");
      },
    },
    {
      name: "group link parameters and candidate lists drive the profile's link pickers",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-backup" });
        const s = await seed(world);
        const set = await world.docs.get(s.set.id, { force: true });
        const byId = Object.fromEntries(relationGroupsFor(builtinAssetType("atype-backup-service")).map((g) => [g.id, g]));

        const outParams = linkParamsFor(s.backup, byId.configurations, s.fileServer);
        assertEq(outParams.from.id, s.backup.id, "an out group links from the backup service");
        assertEq(outParams.to.id, s.fileServer.id, "…to the candidate");
        assertEq(outParams.kind, "backup-protected-configs", "…with the group's primary kind");
        const inParams = linkParamsFor(s.backup, byId.contacts, s.contact);
        assertEq(inParams.from.id, s.contact.id, "an in group links from the candidate");
        assertEq(inParams.to.id, s.backup.id, "…to the backup service");

        assert(relationCandidates(s.backup, set, byId.vendor).some((r) => r.id === s.vendor.id), "an unlinked vendor is offered");
        await world.docs.linkRecords(s.set.id, { from: ref(s.backup), to: ref(s.vendor), kind: "backup-vendor" });
        const after = await world.docs.get(s.set.id, { force: true });
        assert(!relationCandidates(s.backup, after, byId.vendor).some((r) => r.id === s.vendor.id), "a linked vendor drops out of the candidates");
        assert(!relationCandidates(s.backup, after, byId.configurations).some((r) => r.id === s.backup.id), "a group never offers the backup service itself");
        assert(!relationCandidates(s.backup, after, byId.applications).some((r) => r.id === s.storage.id), "the template filter keeps a storage record out of the application group");
      },
    },
    {
      name: "backupIssues audits the structured service's completeness and folds into the linter",
      fn: async () => {
        const world = makeWorld({ namespace: "kb-backup" });
        const set = await world.docs.create({ name: "Bare" });
        const bare = (await world.docs.addRecord(set.id, { type: "flexibleAssets", name: "Untested backup", assetTypeId: BACKUP_SERVICE_TYPE_ID, assetFields: {}, ...CL })).record;
        const bareSet = await world.docs.get(set.id, { force: true });
        const cov = backupCoverage(bare, bareSet);
        assert(!cov.protectedConfigurations && !cov.storage && !cov.credentials && !cov.documents, "an empty service covers nothing");
        const issues = backupIssues(bareSet);
        assertEq(issues.length, 9, "nine gaps flagged for a bare service");
        for (const code of ["backup-no-architecture", "backup-no-deployment", "backup-no-destination", "backup-no-offsite", "backup-no-protected-systems", "backup-untested", "backup-no-recovery-doc", "backup-no-credential", "backup-no-vendor"]) {
          assert(codes(issues).includes(code), "flags " + code);
        }
        assert(issues.every((i) => i.recordId === bare.id), "every issue names the record it concerns");
        assert(issues.every((i) => i.level === "warning"), "gaps are warnings, not errors");

        const folded = standardizedIssues(bareSet);
        assert(codes(folded).includes("backup-no-architecture"), "the linter folds the backup audit in");
        assert((await world.docs.integrity(set.id)).ok, "completeness gaps never fail the graph audit");

        const s = await seed(world);
        await linkAll(world, s);
        const fullSet = await world.docs.get(s.set.id, { force: true });
        const full = backupIssues(fullSet);
        assertEq(full.length, 0, "a fully documented and linked service raises no issues: " + JSON.stringify(full));
      },
    },
  ]);
}
