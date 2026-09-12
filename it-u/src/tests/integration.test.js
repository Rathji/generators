// src/tests/integration.test.js — validation tests for roadmap task 28
// ("PSA/RMM synchronization"). Run in the live page:
//   await import("./src/tests/integration.test.js").then((m) => m.run())
//
// Covers: the integration definition (name required, kind/direction/field-map
// normalization, per-entity enable + direction); updating without losing
// identity; matching remote records by external id (and never stealing another
// integration's record); adoption by name when the integration opts in;
// pull field mapping (including the remote→local configuration-type map) and
// its direction rules; create / update-in-place / unchanged / skip tallies; a
// remote deletion being flagged by default and pruned (with its relationships)
// when the integration opts in; a whole multi-entity run; the push payload and
// the write-back of external ids the provider assigns; the sync-run record; and
// the whole thing end-to-end through the documentation-set service with an
// injected provider (create then re-sync with no duplicates, detect an update,
// log the run, and surface a provider failure).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld, assertThrowsCode } from "./testFixtures.js";
import {
  INTEGRATION_KINDS,
  SYNC_DIRECTIONS,
  SYNC_ENTITIES,
  DEFAULT_FIELD_MAPS,
  integrationKind,
  syncDirection,
  normalizeEntities,
  makeIntegration,
  updateIntegration,
  normalizeIntegrations,
  enabledEntityIds,
  pullEntityIds,
  pushEntityIds,
  findLinkedRecord,
  pullFieldValues,
  pushFieldValues,
  applyPull,
  applySync,
  pushPayload,
  applyPushResult,
  makeSyncRun,
  runSummaryLine,
} from "../framework/integration.js";

const NOW = new Date(2026, 5, 15).getTime();

const blankSet = () => ({ records: { organizations: [], contacts: [], configurations: [], relationships: [] } });

// A pull-only integration over organizations (plus helpers to extend it).
const orgIntegration = (over = {}) =>
  makeIntegration({
    name: "Acme RMM",
    kind: "rmm",
    typeMap: { "Physical Server": "server-physical" },
    entities: { organizations: { enabled: true, direction: "pull" } },
    ...over,
  });

const remoteOrg = (over = {}) => ({ externalId: "o1", name: "Northwind Trading", fields: { legalName: "Northwind Trading Pty Ltd", website: "https://northwind.example" }, ...over });

function fakeProvider(data, opts = {}) {
  const calls = { sync: 0, push: 0 };
  return {
    calls,
    async sync({ entities }) {
      calls.sync += 1;
      if (opts.failSync) throw new Error("API down");
      const out = {};
      for (const e of entities) out[e] = data[e] || [];
      return out;
    },
    async push({ entity, records }) {
      calls.push += 1;
      if (opts.failPush) throw new Error("push rejected");
      const assigned = records.filter((r) => r.isNew).map((r, i) => ({ localId: r.localId, externalId: "remote-" + entity.slice(0, 3) + "-" + (i + 1) }));
      return { pushed: records.length, assigned };
    },
  };
}

const REMOTE = {
  organizations: [{ externalId: "o1", name: "Northwind Trading", fields: { legalName: "Northwind Trading Pty Ltd", website: "https://northwind.example", primaryPhone: "555-1000" } }],
  contacts: [{ externalId: "c1", name: "Jo Bloggs", fields: { jobTitle: "IT Manager", email: "jo@northwind.example" } }],
  configurations: [
    { externalId: "m1", name: "NW-DC01", fields: { configType: "Physical Server", manufacturer: "Dell", model: "R650", serialNumber: "SN123", hostname: "nw-dc01", ipAddresses: "10.0.0.10" } },
  ],
};

const tests = [
  ["the integration catalogues name real kinds and directions", () => {
    assert(INTEGRATION_KINDS.length >= 4, "kinds");
    assertEq(integrationKind("rmm").short, "RMM");
    assertEq(integrationKind("nope"), null);
    assertEq(syncDirection("both").short, "Both");
    assertEq(SYNC_ENTITIES.length, 3, "organizations, contacts, configurations");
    assert(DEFAULT_FIELD_MAPS.configurations.length > 4, "configuration default field map");
  }],

  ["makeIntegration requires a name and fills sensible defaults", () => {
    let threw = false;
    try {
      makeIntegration({});
    } catch {
      threw = true;
    }
    assert(threw, "a nameless integration is refused");
    const i = makeIntegration({ name: "  Acme PSA  ", kind: "bogus", entities: undefined });
    assertEq(i.name, "Acme PSA", "trimmed");
    assertEq(i.kind, "other", "unknown kind falls back");
    assert(i.id.startsWith("intg_"), "id minted");
    assertEq(i.matchOn, "externalId");
    assertEq(i.enabled, true);
    assertEq(enabledEntityIds(i).length, 3, "a bare integration synchronizes all three entities");
    assertEq(i.entities.organizations.direction, "pull");
    assertEq(i.entities.configurations.fields.map((f) => f.local).includes("serialNumber"), true);
  }],

  ["entity + direction + field-map configuration normalizes", () => {
    const ents = normalizeEntities(
      {
        organizations: { enabled: true, direction: "both" },
        contacts: { enabled: false, direction: "pull" },
        configurations: { enabled: true, direction: "push", fields: { name: "hostname", serialNumber: "serial" } },
      },
      { defaultEnabled: false },
    );
    assertEq(enabledEntityIds({ entities: ents }).join(","), "organizations,configurations");
    assertEq(pullEntityIds({ entities: ents }).join(","), "organizations");
    assertEq(pushEntityIds({ entities: ents }).join(","), "organizations,configurations");
    assertEq(ents.configurations.fields[0].local, "name");
    assertEq(ents.configurations.fields[0].remote, "hostname");
    // an explicit but disabled entity contributes nothing
    assertEq(ents.contacts.enabled, false);
  }],

  ["updateIntegration keeps identity and normalizes entity edits", () => {
    const i = makeIntegration({ name: "X", entities: { organizations: { enabled: true, direction: "pull" } } });
    const j = updateIntegration(i, { name: "Y", kind: "psa", entities: { contacts: { enabled: true, direction: "pull" } } }, { now: 999, by: "tester" });
    assertEq(j.id, i.id);
    assertEq(j.createdAt, i.createdAt);
    assertEq(j.name, "Y");
    assertEq(j.kind, "psa");
    assertEq(enabledEntityIds(j).join(","), "contacts", "entity config replaced wholesale");
    assertEq(j.updatedAt, 999);
  }],

  ["a remote record is matched by external id, never another integration's", () => {
    const set = blankSet();
    const mine = orgIntegration();
    const theirs = makeIntegration({ name: "Other RMM", entities: { organizations: { enabled: true, direction: "pull" } } });
    set.records.organizations.push({ id: "org_x", type: "organizations", name: "Northwind Trading", origin: { source: "Other RMM", externalId: "o1", integrationId: theirs.id } });
    assertEq(findLinkedRecord(set, mine, "organizations", remoteOrg()), null, "an unlinked name match without adoption is not ours");
    set.records.organizations[0].origin = { source: "Acme RMM", externalId: "o1", integrationId: mine.id };
    assertEq(findLinkedRecord(set, mine, "organizations", remoteOrg()).id, "org_x", "matched by external id");
    const adopted = orgIntegration({ matchOn: "name" });
    const local = { id: "org_y", type: "organizations", name: "Northwind Trading", origin: {} };
    set.records.organizations.push(local);
    assertEq(findLinkedRecord(set, adopted, "organizations", remoteOrg()).id, "org_x", "an existing external-id match still wins");
    set.records.organizations = [local];
    assertEq(findLinkedRecord(set, adopted, "organizations", remoteOrg()).id, "org_y", "adoption by name when unlinked");
  }],

  ["pull maps fields, honours directions and translates the configuration type", () => {
    const i = makeIntegration({
      name: "RMM",
      typeMap: { "Physical Server": "server-physical" },
      entities: { configurations: { enabled: true, direction: "pull", fields: [["name", "name"], ["configType", "configType"], ["serialNumber", "serialNumber"]] } },
    });
    const values = pullFieldValues(i, "configurations", REMOTE.configurations[0]);
    assertEq(values.name, "NW-DC01");
    assertEq(values.configType, "server-physical", "remote type mapped to a local type");
    assertEq(values.serialNumber, "SN123");
    assertEq(values.hostname, undefined, "unmapped local field is not touched");

    const pushOnly = makeIntegration({ name: "P", entities: { configurations: { enabled: true, direction: "push", fields: [["name", "hostname"]] } } });
    assertEq(Object.keys(pullFieldValues(pushOnly, "configurations", REMOTE.configurations[0])).length, 0, "a push entity contributes no pull values");
    assertEq(pushFieldValues(pushOnly, "configurations", { name: "NW-DC01", serialNumber: "SN123" }).hostname, "NW-DC01");

    const unknown = makeIntegration({ name: "U", entities: { configurations: { enabled: true, direction: "pull", fields: [["configType", "configType"]] } } });
    assertEq(pullFieldValues(unknown, "configurations", { externalId: "z", name: "z", fields: { configType: "Weird Thing" } }).configType, "other", "an unknown remote type falls back to other");
  }],

  ["applyPull creates integration-managed records and is idempotent", () => {
    const set = blankSet();
    const i = orgIntegration();
    const first = applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    assertEq(first.created, 1);
    assertEq(set.records.organizations.length, 1);
    const rec = set.records.organizations[0];
    assertEq(rec.informationModel, "integration");
    assertEq(rec.provenance, "synchronized");
    assertEq(rec.origin.externalId, "o1");
    assertEq(rec.origin.integrationId, i.id);
    assertEq(rec.legalName, "Northwind Trading Pty Ltd");
    assertEq(rec.orgKind, "organization", "standardized required field defaulted");

    const second = applyPull(set, i, "organizations", [remoteOrg()], { now: NOW + 1 });
    assertEq(second.created, 0, "no duplicate");
    assertEq(second.unchanged, 1);
    assertEq(set.records.organizations.length, 1);

    const third = applyPull(set, i, "organizations", [remoteOrg({ name: "Northwind Trading Co", fields: { website: "https://new.example" } })], { now: NOW + 2 });
    assertEq(third.updated, 1, "a changed remote record updates in place");
    assertEq(set.records.organizations[0].name, "Northwind Trading Co");
    assertEq(set.records.organizations[0].website, "https://new.example");
    assertEq(set.records.organizations.length, 1, "still one record");
  }],

  ["applyPull adopts an unlinked record by name when asked", () => {
    const set = blankSet();
    set.records.organizations.push({ id: "org_me", type: "organizations", name: "Northwind Trading", informationModel: "core-asset", provenance: "authored", origin: {}, notes: "hand written" });
    const i = orgIntegration({ matchOn: "name" });
    const res = applyPull(set, i, "organizations", [remoteOrg()], { now: NOW });
    assertEq(res.adopted, 1);
    assertEq(res.created, 0);
    const rec = set.records.organizations[0];
    assertEq(rec.id, "org_me", "the existing record is kept");
    assertEq(rec.informationModel, "integration", "reclassified as integration-managed");
    assertEq(rec.provenance, "synchronized");
    assertEq(rec.notes, "hand written", "unmapped local data survives");
  }],

  ["applyPull never overwrites another integration's record", () => {
    const set = blankSet();
    const mine = orgIntegration();
    const theirs = makeIntegration({ name: "Other RMM", entities: { organizations: { enabled: true, direction: "pull" } } });
    set.records.organizations.push({ id: "org_x", type: "organizations", name: "Northwind Trading", origin: { source: "Other RMM", externalId: "o1", integrationId: theirs.id } });
    const res = applyPull(set, mine, "organizations", [remoteOrg()], { now: NOW });
    assertEq(res.skipped, 1);
    assertEq(res.created, 0);
    assertEq(set.records.organizations.length, 1);
  }],

  ["a remote deletion is flagged by default and pruned when the integration opts in", () => {
    const set = blankSet();
    const flagged = orgIntegration();
    applyPull(set, flagged, "organizations", [remoteOrg()], { now: NOW });
    const res1 = applyPull(set, flagged, "organizations", [remoteOrg({ deleted: true })], { now: NOW + 1 });
    assertEq(res1.remoteDeleted, 1, "reported when not pruning");
    assertEq(set.records.organizations.length, 1, "kept when not pruning");
    assert(set.records.organizations[0].origin.remoteDeletedAt, "flagged as removed remotely");

    const pruning = orgIntegration({ prune: true });
    const set2 = blankSet();
    applyPull(set2, pruning, "organizations", [remoteOrg()], { now: NOW });
    set2.records.relationships.push({ id: "rel1", type: "relationships", kind: "org-contact", from: { type: "organizations", id: set2.records.organizations[0].id }, to: { type: "contacts", id: "con_x" } });
    const res2 = applyPull(set2, pruning, "organizations", [remoteOrg({ deleted: true })], { now: NOW + 1 });
    assertEq(res2.deleted, 1);
    assertEq(set2.records.organizations.length, 0);
    assertEq(set2.records.relationships.length, 0, "relationships to the pruned record are cascaded away");
  }],

  ["a whole run reconciles every enabled entity and totals them", () => {
    const set = blankSet();
    const i = makeIntegration({
      name: "Acme RMM",
      typeMap: { "Physical Server": "server-physical" },
      entities: { organizations: { enabled: true, direction: "pull" }, contacts: { enabled: true, direction: "pull" }, configurations: { enabled: true, direction: "pull" } },
    });
    const { entities, totals } = applySync(set, i, REMOTE, { now: NOW });
    assertEq(totals.created, 3, "one of each");
    assertEq(entities.configurations.created, 1);
    assertEq(set.records.configurations[0].configType, "server-physical");
    assertEq(set.records.contacts[0].contactRole, "client-primary", "contact required field defaulted");
    const again = applySync(set, i, REMOTE, { now: NOW + 1 });
    assertEq(again.totals.created, 0);
    assertEq(again.totals.unchanged, 3);
  }],

  ["push builds remote payloads and writes assigned ids back", () => {
    const set = blankSet();
    const i = makeIntegration({ name: "Acme PSA", entities: { configurations: { enabled: true, direction: "push", fields: [["name", "hostname"], ["serialNumber", "serialNumber"]] } } });
    set.records.configurations.push({ id: "cfg_1", type: "configurations", name: "NW-DC01", serialNumber: "SN1", origin: { source: "Acme PSA", integrationId: i.id, externalId: "m1" } });
    set.records.configurations.push({ id: "cfg_2", type: "configurations", name: "NW-DC02", serialNumber: "SN2", origin: { source: "Acme PSA", integrationId: i.id } });
    set.records.configurations.push({ id: "cfg_3", type: "configurations", name: "Not ours", origin: {} });
    const payload = pushPayload(set, i, "configurations");
    assertEq(payload.length, 2, "only the integration's own records are pushed");
    const second = payload.find((p) => p.localId === "cfg_2");
    assertEq(second.isNew, true, "a record with no external id is new");
    assertEq(second.fields.hostname, "NW-DC02");
    const res = applyPushResult(set, i, "configurations", { pushed: 2, assigned: [{ localId: "cfg_2", externalId: "m2" }] }, { now: NOW });
    assertEq(res.assigned, 1);
    assertEq(set.records.configurations.find((r) => r.id === "cfg_2").origin.externalId, "m2");
  }],

  ["a sync run summarizes itself", () => {
    const i = makeIntegration({ name: "Acme RMM" });
    const run = makeSyncRun({ integration: i, summary: { entities: {}, totals: { created: 2, updated: 1, adopted: 0, unchanged: 0, skipped: 0, deleted: 0, remoteDeleted: 0 } }, startedAt: NOW, finishedAt: NOW + 5 });
    assertEq(run.status, "ok");
    assertEq(run.integrationId, i.id);
    assert(/2 created, 1 updated/.test(runSummaryLine(run)));
    assert(/Failed/.test(runSummaryLine({ status: "error", errors: ["API down"] })));
  }],

  ["the service syncs a client end-to-end with an injected provider", async () => {
    const { docs } = makeWorld("kb-integration-svc");
    const set = await docs.create({ name: "Northwind" , createdBy: "tester" });
    const add = await docs.addIntegration(set.id, {
      name: "Acme RMM",
      kind: "rmm",
      typeMap: { "Physical Server": "server-physical" },
      entities: { organizations: { enabled: true, direction: "pull" }, contacts: { enabled: true, direction: "pull" }, configurations: { enabled: true, direction: "pull" } },
    }, { updatedBy: "tester" });
    const integration = add.integration;
    assertEq((await docs.listIntegrations(set.id)).length, 1);

    const provider = fakeProvider(REMOTE);
    const first = await docs.syncIntegration(set.id, integration.id, { provider, updatedBy: "tester" });
    assertEq(first.summary.totals.created, 3);
    assertEq(provider.calls.sync, 1);

    const after = await docs.get(set.id, { force: true });
    assertEq(after.records.organizations.length, 1);
    assertEq(after.records.organizations[0].informationModel, "integration");
    assertEq(after.records.configurations[0].configType, "server-physical");

    // re-sync: no duplicates
    const second = await docs.syncIntegration(set.id, integration.id, { provider, updatedBy: "tester" });
    assertEq(second.summary.totals.created, 0);
    assertEq(second.summary.totals.unchanged, 3);
    assertEq((await docs.listIntegrations(set.id))[0].lastStatus, "ok");
    assert((await docs.listIntegrations(set.id))[0].lastSummary, "a run summary is recorded");

    // a changed + a new remote record
    const changed = { ...REMOTE, configurations: [...REMOTE.configurations, { externalId: "m2", name: "NW-DC02", fields: { configType: "Virtual Server", hostname: "nw-dc02" } }] };
    const third = await docs.syncIntegration(set.id, integration.id, { provider: fakeProvider(changed), updatedBy: "tester" });
    assertEq(third.summary.totals.created, 1, "the new device is created");
    const runs = await docs.integrationRuns(set.id, integration.id);
    assertEq(runs.length, 3, "three runs logged");
    assertEq(runs[0].id, third.run.id, "newest run first");

    // provider failure surfaces
    await assertThrowsCode(() => docs.syncIntegration(set.id, integration.id, { provider: fakeProvider(REMOTE, { failSync: true }), updatedBy: "tester" }), "INVALID_DATA", "provider failure surfaces");

    // removal
    await docs.removeIntegration(set.id, integration.id, { updatedBy: "tester" });
    assertEq((await docs.listIntegrations(set.id)).length, 0);
  }],

  ["a disabled integration refuses to sync, and names must be unique", async () => {
    const { docs } = makeWorld("kb-integration-guard");
    const set = await docs.create({ name: "Guard", createdBy: "tester" });
    const add = await docs.addIntegration(set.id, { name: "Acme RMM", enabled: false, entities: { organizations: { enabled: true, direction: "pull" } } }, { updatedBy: "tester" });
    await assertThrowsCode(() => docs.syncIntegration(set.id, add.integration.id, { provider: fakeProvider(REMOTE), updatedBy: "tester" }), "INVALID_DATA", "a disabled integration will not sync");
    await assertThrowsCode(() => docs.addIntegration(set.id, { name: "Acme RMM" }, { updatedBy: "tester" }), "DUPLICATE_RECORD", "duplicate integration name");
    const pushed = await docs.syncIntegration(set.id, add.integration.id, { provider: fakeProvider(REMOTE), force: true, updatedBy: "tester" });
    assertEq(pushed.summary.totals.created, 1);
  }],
];

export async function run() {
  return runTests(tests.map(([name, fn]) => ({ name, fn })));
}
