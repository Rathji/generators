// src/tests/versioning.test.js — validation tests for Phase 1 task 6
// (capacity, archival, versioning & templates). Run in the live page:
//   await import("./src/tests/versioning.test.js").then((m) => m.run())
//
// Covers: document version history (growth + cap), reading a superseded
// version back, restoring an old version as a NEW version (reversible);
// archiving makes a set read-only and unarchiving restores editability;
// per-set capacity accounting against the storage ceiling with over/near
// flags; save-as-template + apply (structure re-instantiated with fresh ids);
// and duplicate (an exact copy of a live set).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld as makeFixtureWorld } from "./testFixtures.js";
import { DEFAULT_STORAGE_CEILING } from "../framework/archive.js";

const C = { informationModel: "core-asset", provenance: "authored" };

const makeWorld = (ceiling) => makeFixtureWorld({ namespace: "kb-ver", archive: true, archiveCeiling: ceiling, templates: true });

async function seedOrg(world, name) {
  const set = await world.docs.create({ name });
  const org = (await world.docs.addRecord(set.id, { type: "organizations", name: "Head Office", orgKind: "organization", ...C })).record;
  const loc = (await world.docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", city: "Brisbane", ...C })).record;
  await world.docs.linkRecords(set.id, { from: { type: "organizations", id: org.id }, to: { type: "locations", id: loc.id }, kind: "organization-location" });
  return { set, org, loc };
}

export async function run() {
  return runTests([
    {
      name: "version history grows with every write and reflects the current version",
      fn: async () => {
        const { store } = makeWorld();
        await store.writeDocument("d", { v: 1 });
        await store.writeDocument("d", { v: 2 });
        await store.writeDocument("d", { v: 3 });
        const h = await store.history("d");
        assertEq(h.length, 3, "current + two superseded");
        assertEq(h[0].version, 3, "current first");
        assert(h[0].current === true, "current flagged");
        assertEq(h[1].version, 2, "prior version listed");
        assertEq(h[2].version, 1, "oldest listed");
      },
    },
    {
      name: "history is capped, and a pruned version can no longer be read",
      fn: async () => {
        const { store } = makeWorld();
        for (let i = 1; i <= 40; i++) await store.writeDocument("d", { v: i });
        const h = await store.history("d");
        assertEq(h.length, store.historyMax + 1, "capped at historyMax + current");
        const oldestKept = h[h.length - 1].version;
        assert(oldestKept > 1, "oldest versions were pruned");
        assert(await store.readVersion("d", oldestKept), "the oldest KEPT version is readable");
        assertEq(await store.readVersion("d", 1), null, "a pruned version is gone");
      },
    },
    {
      name: "reading a superseded version returns its exact content",
      fn: async () => {
        const { store } = makeWorld();
        await store.writeDocument("d", { n: 1, tags: ["a"] });
        await store.writeDocument("d", { n: 2, tags: ["a", "b"] });
        const old = await store.readVersion("d", 1);
        assertEq(old.version, 1, "version reported");
        assertEq(old.data.n, 1, "old content");
        assertEq(old.data.tags.length, 1, "old array content");
        assertEq(old.current, false, "not current");
        assertEq((await store.readVersion("d", 2)).current, true, "current version readable too");
      },
    },
    {
      name: "restoring an old version writes it as a NEW version (reversible — nothing destroyed)",
      fn: async () => {
        const { store } = makeWorld();
        await store.writeDocument("d", { v: "one" });
        await store.writeDocument("d", { v: "two" });
        const res = await store.restoreVersion("d", 1, { updatedBy: "bob" });
        assertEq(res.restoredFrom, 1, "restored from v1");
        assertEq(res.version, 3, "restore produced v3");
        const cur = await store.readDocument("d", { force: true });
        assertEq(cur.data.v, "one", "content is back to v1");
        const h = await store.history("d");
        assert(h.find((x) => x.version === 2), "v2 still in history");
        assert(h.find((x) => x.version === 1), "v1 still in history");
      },
    },
    {
      name: "archiving makes a set read-only; unarchiving restores editability",
      fn: async () => {
        const world = makeWorld();
        const { set } = await seedOrg(world, "Acme");
        const res = await world.archive.archive(set.id, { reason: "retired", updatedBy: "alice" });
        assert(res.changed, "archive changed the set");
        const archived = await world.docs.get(set.id, { force: true });
        assert(archived.archived, "archived flag set");
        assertEq(archived.archiveReason, "retired", "reason stored");

        let threw = null;
        try {
          await world.docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "ARCHIVED_SET", "mutation of an archived set refused");

        // The active list hides it; the archive view shows it.
        assertEq((await world.docs.summaries()).length, 0, "hidden from the active list");
        assertEq((await world.docs.summaries({ includeArchived: true })).length, 1, "shown when archived included");
        const listed = await world.archive.listArchived();
        assertEq(listed.length, 1, "listed in the archive view");
        assertEq(listed[0].archiveReason, "retired", "archive reason surfaced");

        await world.archive.unarchive(set.id, { updatedBy: "alice" });
        const back = await world.docs.get(set.id, { force: true });
        assert(!back.archived, "archived flag cleared");
        const added = await world.docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        assert(added.record, "editable again");
      },
    },
    {
      name: "capacity reports each set's bytes against the ceiling with state flags",
      fn: async () => {
        const world = makeWorld();
        await seedOrg(world, "Acme");
        const cap = await world.archive.capacity();
        assertEq(cap.ceiling, DEFAULT_STORAGE_CEILING, "ceiling reported");
        assertEq(cap.docsets.length, 1, "one set measured");
        assert(cap.docsets[0].bytes > 0, "bytes measured");
        assertEq(cap.docsets[0].state, "ok", "well under the ceiling");
        assertEq(cap.activeCount, 1, "active count");
        assertEq(cap.over.length, 0, "nothing over");
      },
    },
    {
      name: "capacity flags a set that exceeds the ceiling so archival is guided",
      fn: async () => {
        const world = makeWorld(1); // 1-byte ceiling forces everything over
        await seedOrg(world, "Acme");
        const cap = await world.archive.capacity();
        assertEq(cap.docsets[0].state, "over", "over the ceiling");
        assertEq(cap.over.length, 1, "listed in the over set");
        assert(cap.largest && cap.largest.id === cap.docsets[0].id, "largest set pointed out");
      },
    },
    {
      name: "save-as-template captures structure, and applying it re-instantiates records + links with fresh ids",
      fn: async () => {
        const world = makeWorld();
        const { set, org, loc } = await seedOrg(world, "Acme");
        const { template } = await world.templates.saveAsTemplate(set.id, { name: "Standard client", createdBy: "alice" });
        assertEq(template.counts.records, 2, "two records captured");
        assertEq(template.counts.links, 1, "one link captured");
        const list = await world.templates.list();
        assertEq(list.length, 1, "template listed");
        assertEq(list[0].name, "Standard client", "template name");

        const applied = await world.templates.apply(template.id, { name: "New Client", createdBy: "alice" });
        const created = applied.set;
        assert(created.id !== set.id, "a brand-new set");
        assertEq(created.records.organizations.length, 1, "organization recreated");
        assertEq(created.records.locations.length, 1, "location recreated");
        assertEq(created.records.relationships.length, 1, "link recreated");
        assertEq(created.records.organizations[0].orgKind, "organization", "standardized field carried over");
        assertEq(created.records.locations[0].locationType, "office", "location type carried over");
        assert(created.records.organizations[0].id !== org.id, "fresh record id");
        assert(created.records.locations[0].id !== loc.id, "fresh record id");
      },
    },
    {
      name: "duplicate makes an exact copy of a live set (records + links re-minted)",
      fn: async () => {
        const world = makeWorld();
        const { set } = await seedOrg(world, "Acme");
        const res = await world.templates.duplicate(set.id, { name: "Acme Copy", createdBy: "alice" });
        assertEq(res.records, 2, "copied every record");
        assertEq(res.links, 1, "copied every link");
        assert(res.set.id !== set.id, "new set id");
        assertEq(res.set.records.relationships.length, 1, "link graph intact in the copy");
        const rel = res.set.records.relationships[0];
        assertEq(rel.kind, "organization-location", "same relationship kind");
      },
    },
  ]);
}
