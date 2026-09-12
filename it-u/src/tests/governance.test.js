// src/tests/governance.test.js — validation tests for roadmap task 30
// ("Integration-managed record governance"). Run in the live page:
//   await import("./src/tests/governance.test.js").then((m) => m.run())
//
// Covers: the conflict-policy catalog (external / local / hold / newest) and its
// normalization; field ownership (only pulled fields are integration-owned);
// the authoritative-system reference stamped onto every managed record and its
// value baseline; drift detection when a local edit diverges from the baseline;
// conflict resolution by rule (external overwrites and records drift; local
// keeps the edit and queues a push-back; hold leaves an open conflict for manual
// resolution; newest compares update times); manual conflict resolution
// (one field or all); the governance roll-up; run summaries naming conflicts;
// and the whole thing end-to-end through the documentation-set service (a local
// edit plus a remote change surfaces a conflict, and the service resolves it).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld, assertThrowsCode } from "./testFixtures.js";
import {
  CONFLICT_POLICIES,
  conflictPolicy,
  makeIntegration,
  updateIntegration,
  normalizeEntities,
  ownedFields,
  ownedFieldKeys,
  authorityRef,
  recordBaseline,
  driftFields,
  recordGovernance,
  openConflictsOf,
  resolveSyncConflict,
  resolveAllSyncConflicts,
  governanceOverview,
  applyPull,
  applySync,
  makeSyncRun,
  runSummaryLine,
  isIntegrationManaged,
} from "../framework/integration.js";

const NOW = new Date(2026, 6, 1).getTime();

const blankSet = () => ({ records: { organizations: [], contacts: [], configurations: [], relationships: [] } });

const orgIntegration = (over = {}, entityOver = {}) =>
  makeIntegration({
    name: "Acme RMM",
    kind: "rmm",
    entities: { organizations: { enabled: true, direction: "pull", ...entityOver } },
    ...over,
  });

const remoteOrg = (fields = {}, over = {}) => ({
  externalId: "o1",
  name: "Northwind Trading",
  fields: { legalName: "Northwind Trading Pty Ltd", website: "https://northwind.example", ...fields },
  ...over,
});

function fakeProvider(data) {
  return {
    async sync({ entities }) {
      const out = {};
      for (const e of entities) out[e] = data[e] || [];
      return out;
    },
    async push({ entity, records }) {
      const assigned = records.filter((r) => r.isNew).map((r, i) => ({ localId: r.localId, externalId: "remote-" + entity.slice(0, 3) + "-" + (i + 1) }));
      return { pushed: records.length, assigned };
    },
  };
}

const tests = [
  ["the conflict-policy catalog is normalized onto the integration and per entity", () => {
    assertEq(CONFLICT_POLICIES.length, 4, "four policies");
    assertEq(CONFLICT_POLICIES.map((p) => p.id).join(","), "external,local,flag,newest");
    assertEq(conflictPolicy("hold"), null);
    assertEq(conflictPolicy("flag").short, "Hold");
    assertEq(makeIntegration({ name: "X" }).conflictPolicy, "external", "external is the default");
    assertEq(makeIntegration({ name: "X", conflictPolicy: "nonsense" }).conflictPolicy, "external", "an unknown policy falls back");
    assertEq(updateIntegration(makeIntegration({ name: "X" }), { conflictPolicy: "local" }).conflictPolicy, "local");
    const withEntity = makeIntegration({ name: "X", entities: { organizations: { enabled: true, direction: "pull", conflictPolicy: "newest" } } });
    assertEq(withEntity.entities.organizations.conflictPolicy, "newest");
    const norm = normalizeEntities({ organizations: { enabled: true, direction: "pull", conflictPolicy: "bogus" } });
    assertEq(norm.organizations.conflictPolicy, null, "an unknown per-entity policy is dropped");
  }],

  ["only pulled fields are integration-owned", () => {
    const i = makeIntegration({
      name: "X",
      entities: { organizations: { enabled: true, direction: "pull", fields: [{ local: "name", remote: "name" }, { local: "legalName", remote: "legalName", direction: "push" }] } },
    });
    const owned = ownedFields(i, "organizations");
    assert(owned.includes("name"), "name is owned");
    assert(!owned.includes("legalName"), "a push-only field is not owned");
    assertEq(ownedFieldKeys(i, "organizations").has("name"), true);
    // An entity that is not synchronized owns nothing.
    assertEq(ownedFields(makeIntegration({ name: "Y", entities: { organizations: { enabled: false } } }), "organizations").length, 0, "a disabled entity owns nothing");
    assert(ownedFields(makeIntegration({ name: "Z" }), "organizations").length > 0, "a default entity pulls its default fields");
  }],

  ["a created record carries its authoritative system and a value baseline", () => {
    const set = blankSet();
    const i = orgIntegration();
    const tally = applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    assertEq(tally.created, 1);
    const rec = set.records.organizations[0];
    assertEq(rec.origin.authority.name, "Acme RMM");
    assertEq(rec.origin.authority.id, i.id);
    assertEq(rec.origin.authority.kindLabel, "RMM");
    assertEq(rec.origin.synced.website, "https://northwind.example", "baseline captured");
    assertEq(recordBaseline(rec).legalName, "Northwind Trading Pty Ltd");
    assertEq(isIntegrationManaged(rec), true);
    const g = recordGovernance(rec);
    assertEq(g.managed, true);
    assertEq(g.authority.name, "Acme RMM");
    assert(g.ownedFields.includes("website"), "owned fields exposed");
    assertEq(g.drift.length, 0, "freshly synced — no drift");
    assertEq(authorityRef(i).name, "Acme RMM");
  }],

  ["a local edit is never clobbered while the external value is unchanged", () => {
    const set = blankSet();
    const i = orgIntegration();
    applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.updatedAt = NOW + 10;
    const again = applyPull(set, i, "organizations", [remoteOrg()], { now: NOW + 20 });
    assertEq(again.updated, 0, "nothing to update");
    assertEq(rec.website, "https://local.example", "the local edit survives");
    assertEq(driftFields(rec).length, 1, "the divergence is recorded as drift");
    assertEq(driftFields(rec)[0].field, "website");
  }],

  ["the external policy overwrites a colliding local edit and records the drift", () => {
    const set = blankSet();
    const i = orgIntegration({ conflictPolicy: "external" });
    applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.updatedAt = NOW + 10;
    const tally = applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote2.example" })], { now: NOW + 20 });
    assertEq(tally.overwritten, 1);
    assertEq(tally.conflicts, 1);
    assertEq(tally.drifts.length, 1);
    assertEq(tally.drifts[0].action, "overwritten");
    assertEq(rec.website, "https://remote2.example", "external wins");
    assertEq(openConflictsOf(rec).length, 0, "resolved automatically");
    assertEq(rec.syncConflicts[0].resolution, "external");
    assertEq(rec.syncConflicts[0].state, "resolved");
    assertEq(rec.origin.synced.website, "https://remote2.example", "baseline advanced");
  }],

  ["the local policy keeps the local edit and queues a push-back", () => {
    const set = blankSet();
    const i = orgIntegration({ conflictPolicy: "local" });
    applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.updatedAt = NOW + 10;
    const tally = applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote2.example" })], { now: NOW + 20 });
    assertEq(tally.overwritten, 0, "nothing overwritten");
    assertEq(tally.pushBack, 1);
    assertEq(rec.website, "https://local.example", "local wins");
    assert(rec.origin.pushBack.includes("website"), "queued for push-back");
    assertEq(openConflictsOf(rec).length, 0, "no manual conflict");
    assertEq(rec.syncConflicts[0].resolution, "local");
    assertEq(driftFields(rec).length, 1, "still drifted until pushed");
  }],

  ["the hold policy leaves an open conflict that can be resolved by hand", () => {
    const set = blankSet();
    const i = orgIntegration({ conflictPolicy: "flag" });
    applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.updatedAt = NOW + 10;
    const tally = applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote2.example" })], { now: NOW + 20 });
    assertEq(tally.held, 1);
    assertEq(rec.website, "https://local.example", "not overwritten while held");
    const open = openConflictsOf(rec);
    assertEq(open.length, 1);
    assertEq(open[0].field, "website");
    assertEq(open[0].localValue, "https://local.example");
    assertEq(open[0].remoteValue, "https://remote2.example");

    // Accept the external value.
    const r = resolveSyncConflict(rec, "website", "external", { now: NOW + 30, by: "admin" });
    assert(r, "resolved");
    assertEq(rec.website, "https://remote2.example", "external accepted");
    assertEq(openConflictsOf(rec).length, 0, "conflict closed");
    assertEq(rec.syncConflicts[0].resolution, "external");
    assertEq(rec.syncConflicts[0].resolvedBy, "admin");

    // A second hold, this time keeping the local value.
    rec.website = "https://local3.example";
    rec.updatedAt = NOW + 40;
    applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote3.example" })], { now: NOW + 50 });
    assertEq(openConflictsOf(rec).length, 1);
    resolveSyncConflict(rec, "website", "local", { now: NOW + 60, by: "admin" });
    assertEq(rec.website, "https://local3.example", "local kept");
    assert(rec.origin.pushBack.includes("website"), "queued for push-back");
  }],

  ["the newest policy keeps whichever side changed later", () => {
    const set = blankSet();
    const i = orgIntegration({ conflictPolicy: "newest" });
    applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.updatedAt = NOW + 100;
    // The remote record is older than the local edit — local wins.
    let tally = applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote-old.example" }, { updatedAt: NOW + 50 })], { now: NOW + 200 });
    assertEq(tally.pushBack, 1, "older remote loses");
    assertEq(rec.website, "https://local.example");
    // The remote record is newer — external wins.
    rec.updatedAt = NOW + 10;
    applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote-new.example" }, { updatedAt: NOW + 300 })], { now: NOW + 400 });
    assertEq(rec.website, "https://remote-new.example", "newer remote wins");
  }],

  ["all open conflicts on a record can be resolved at once", () => {
    const set = blankSet();
    const i = orgIntegration({ conflictPolicy: "flag" });
    applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.legalName = "Local Legal";
    rec.updatedAt = NOW + 10;
    applyPull(set, i, "organizations", [remoteOrg({ website: "https://remote2.example", legalName: "Remote Legal" })], { now: NOW + 20 });
    assertEq(openConflictsOf(rec).length, 2);
    const resolved = resolveAllSyncConflicts(rec, "external", { now: NOW + 30, by: "admin" });
    assertEq(resolved.length, 2);
    assertEq(openConflictsOf(rec).length, 0);
    assertEq(rec.website, "https://remote2.example");
    assertEq(rec.legalName, "Remote Legal");
  }],

  ["the governance roll-up counts managed records, systems, drift and conflicts", () => {
    const set = blankSet();
    const i = orgIntegration({ conflictPolicy: "flag" });
    applySync(set, i, { organizations: [remoteOrg()] }, { now: NOW });
    const rec = set.records.organizations[0];
    rec.website = "https://local.example";
    rec.updatedAt = NOW + 10;
    applySync(set, i, { organizations: [remoteOrg({ website: "https://remote2.example" })] }, { now: NOW + 20 });
    const ov = governanceOverview(set, [i]);
    assertEq(ov.managed, 1);
    assertEq(ov.openCount, 1);
    assertEq(ov.driftCount, 1);
    assertEq(ov.bySystem["Acme RMM"], 1);
    assertEq(ov.items[0].system, "Acme RMM");
    assertEq(ov.items[0].entityLabel, "Organizations");
    assert(ov.items[0].ownedFields.includes("website"));
    assertEq(ov.items[0].conflicts.length, 1);
  }],

  ["a run summary names the conflicts it recorded", () => {
    const i = orgIntegration();
    const run = makeSyncRun({
      integration: i,
      summary: { entities: {}, drifts: [{ field: "website" }], totals: { created: 0, updated: 1, adopted: 0, unchanged: 0, skipped: 0, deleted: 0, remoteDeleted: 0, conflicts: 2, overwritten: 2, held: 0, pushBack: 0 } },
      startedAt: NOW,
      finishedAt: NOW + 5,
    });
    assertEq(run.drifts.length, 1);
    assert(/2 conflicts/.test(runSummaryLine(run)), "conflicts named in the summary");
  }],

  ["the service syncs, detects a local-vs-remote conflict, and resolves it", async () => {
    const { docs } = makeWorld("kb-governance-svc");
    const set = await docs.create({ name: "Northwind", createdBy: "tester" });
    const add = await docs.addIntegration(
      set.id,
      { name: "Acme RMM", kind: "rmm", conflictPolicy: "flag", entities: { organizations: { enabled: true, direction: "pull" } } },
      { updatedBy: "tester" },
    );
    const first = await docs.syncIntegration(set.id, add.integration.id, { provider: fakeProvider({ organizations: [remoteOrg()] }), updatedBy: "tester" });
    assertEq(first.summary.totals.created, 1);

    const after = await docs.get(set.id, { force: true });
    const rec = after.records.organizations[0];
    assertEq(rec.origin.authority.name, "Acme RMM", "authoritative system recorded");
    await docs.updateRecord(set.id, { type: "organizations", id: rec.id }, { website: "https://local.example" }, { updatedBy: "tester" });

    const second = await docs.syncIntegration(set.id, add.integration.id, { provider: fakeProvider({ organizations: [remoteOrg({ website: "https://remote2.example" })] }), updatedBy: "tester" });
    assertEq(second.summary.totals.held, 1, "held for review");
    assertEq(second.summary.totals.conflicts, 1);

    const gov = await docs.integrationGovernance(set.id);
    assertEq(gov.managed, 1);
    assertEq(gov.openCount, 1);
    assertEq(gov.items[0].system, "Acme RMM");
    assert(gov.items[0].drift.some((d) => d.field === "website"));

    const one = await docs.recordGovernanceOf(set.id, rec.id);
    assertEq(one.managed, true);
    assertEq(one.conflicts.length, 1);

    const resolved = await docs.resolveIntegrationConflict(set.id, rec.id, "website", "external", { updatedBy: "tester" });
    assertEq(resolved.remaining, 0);
    const after2 = await docs.get(set.id, { force: true });
    assertEq(after2.records.organizations[0].website, "https://remote2.example", "external value applied");
    assertEq((await docs.integrationGovernance(set.id)).openCount, 0);
  }],

  ["the service refuses a bad resolution choice or a conflict that isn’t open", async () => {
    const { docs } = makeWorld("kb-governance-guard");
    const set = await docs.create({ name: "Guard", createdBy: "tester" });
    const add = await docs.addIntegration(set.id, { name: "Acme RMM", entities: { organizations: { enabled: true, direction: "pull" } } }, { updatedBy: "tester" });
    await docs.syncIntegration(set.id, add.integration.id, { provider: fakeProvider({ organizations: [remoteOrg()] }), updatedBy: "tester" });
    const after = await docs.get(set.id, { force: true });
    const rec = after.records.organizations[0];
    await assertThrowsCode(() => docs.resolveIntegrationConflict(set.id, rec.id, "website", "banana", { updatedBy: "tester" }), "INVALID_DATA", "bad choice refused");
    await assertThrowsCode(() => docs.resolveIntegrationConflict(set.id, rec.id, "website", "external", { updatedBy: "tester" }), "INVALID_DATA", "no open conflict refused");
  }],
];

export async function run() {
  return runTests(tests.map(([name, fn]) => ({ name, fn })));
}
