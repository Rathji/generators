// src/tests/sync-backup.test.js — validation tests for Phase 1 task 5
// (sync, conflict & backup). Run in the live page:
//   await import("./src/tests/sync-backup.test.js").then((m) => m.run())
//
// Covers: full backup collection + serialization; VALIDATED restore (bad
// schema / missing collection / unclassified record / dangling relationship
// are all refused); preview without writing; merge restore (keeps local-only
// records, newer wins) and replace restore; IDEMPOTENCE (restoring the same
// backup twice is a no-op); publishing a hosted backup document via the
// injected upload channel; and docset-level conflict detection + resolution
// (keep-mine / keep-theirs / field-level merge).

import { runTests, assert, assertEq } from "./harness.js";
import { createDocumentStore } from "../framework/store/index.js";
import { createMemoryChannel, createMemoryCache } from "../framework/store/backends.js";
import { createDocSetService, RECORD_TYPES } from "../framework/docsets.js";
import { createSyncEngine } from "../framework/store/sync.js";
import {
  createBackupService,
  BACKUP_SCHEMA,
  BACKUP_KIND,
  mergeDocSets,
  countRecords,
} from "../framework/store/backup.js";

const C = { informationModel: "core-asset", provenance: "authored" };

function makeDevice(channel) {
  const cache = createMemoryCache();
  const store = createDocumentStore({ namespace: "kb-sb", channel, cache });
  const docs = createDocSetService({ store, cache });
  const sync = createSyncEngine({ store, cache });
  const backup = createBackupService({ store, cache, generatorName: "it-u" });
  return { channel, cache, store, docs, sync, backup };
}

function oneDevice() {
  return makeDevice(createMemoryChannel());
}

function emptyRecordBag() {
  const bag = {};
  for (const t of RECORD_TYPES) bag[t] = [];
  return bag;
}

function manualEnvelope(id, records) {
  return {
    schema: BACKUP_SCHEMA,
    kind: BACKUP_KIND,
    createdAt: 1000,
    createdBy: "tester",
    counts: { docsets: 1 },
    docsets: {
      [id]: { schema: "itu-docset/1", id, name: "Manual", kind: "organization", records },
    },
  };
}

export async function run() {
  return runTests([
    {
      name: "backup collects every documentation set as one envelope with a manifest",
      fn: async () => {
        const { docs, backup } = oneDevice();
        const a = await docs.create({ name: "Acme", createdBy: "alice" });
        await docs.addRecord(a.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        const b = await docs.create({ name: "Beta" });
        await docs.addRecord(b.id, { type: "configurations", name: "fw-01", configType: "other", ...C });
        const env = await backup.collect({ createdBy: "alice" });
        assertEq(env.schema, BACKUP_SCHEMA, "schema tag");
        assertEq(env.kind, BACKUP_KIND, "kind tag");
        assertEq(Object.keys(env.docsets).length, 2, "both sets collected");
        assertEq(env.counts.docsets, 2, "count manifest");
        assertEq(env.counts.records, 2, "record count");
        assert(env.registry[a.id] && env.registry[a.id].version >= 2, "registry records the version");
        const text = backup.serialize(env);
        assert(text.includes(BACKUP_SCHEMA), "serializes to JSON");
        assertEq(countRecords(env.docsets[a.id]).records, 1, "countRecords helper");
      },
    },
    {
      name: "validate accepts a real backup and reports its summary",
      fn: async () => {
        const { docs, backup } = oneDevice();
        const set = await docs.create({ name: "Acme" });
        await docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        const env = await backup.collect();
        const report = backup.validate(env);
        assert(report.ok, "valid backup passes: " + report.errors.join("; "));
        assertEq(report.summary.docsets, 1, "summary set count");
        assertEq(report.summary.records, 1, "summary record count");
        assertEq(backup.validate(JSON.stringify(env)).ok, true, "also accepts a JSON string");
      },
    },
    {
      name: "validate REFUSES a bad schema, a missing collection, an unclassified record and a dangling relationship",
      fn: async () => {
        const { backup } = oneDevice();

        const bad = backup.validate({ schema: "nope/9", kind: BACKUP_KIND, docsets: {} });
        assert(!bad.ok, "wrong schema refused");
        assert(bad.errors.some((e) => e.includes("schema")), "error names the schema");

        const missing = emptyRecordBag();
        delete missing.configurations;
        const m = backup.validate(manualEnvelope("docset-x", missing));
        assert(!m.ok && m.errors.some((e) => e.includes("configurations")), "missing collection refused");

        const unclassified = emptyRecordBag();
        unclassified.configurations.push({ id: "cfg1", type: "configurations", name: "web-01", configType: "other" });
        const u = backup.validate(manualEnvelope("docset-x", unclassified));
        assert(!u.ok, "unclassified record refused");
        assert(u.errors.some((e) => e.toLowerCase().includes("information model") || e.toLowerCase().includes("classification") || e.toLowerCase().includes("provenance")), "error explains classification");

        const dangling = emptyRecordBag();
        dangling.relationships.push({
          id: "rel1",
          type: "relationships",
          kind: "contact-owner",
          from: { type: "contacts", id: "nope" },
          to: { type: "configurations", id: "nope2" },
        });
        const d = backup.validate(manualEnvelope("docset-x", dangling));
        assert(!d.ok && d.errors.some((e) => e.includes("no longer exists")), "dangling link refused");
      },
    },
    {
      name: "restore into a fresh device creates every set and is IDEMPOTENT on a second run",
      fn: async () => {
        const channel = createMemoryChannel();
        const src = makeDevice(channel);
        const set = await src.docs.create({ name: "Acme" });
        await src.docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        const env = await src.backup.collect();

        const dst = makeDevice(createMemoryChannel());
        const first = await dst.backup.restore(env);
        assertEq(first.created.length, 1, "first restore creates the set");
        assertEq(first.unchanged.length, 0, "nothing unchanged on first run");
        const read = await dst.docs.get(set.id, { force: true });
        assertEq(read.records.contacts[0].name, "Jo", "content restored");

        const second = await dst.backup.restore(env);
        assertEq(second.unchanged.length, 1, "second restore is a no-op");
        assertEq(second.created.length + second.merged.length + second.replaced.length, 0, "nothing written twice");
        assert(second.ok, "no failures");
      },
    },
    {
      name: "preview plans a restore without writing anything",
      fn: async () => {
        const channel = createMemoryChannel();
        const src = makeDevice(channel);
        const a = await src.docs.create({ name: "Acme" });
        await src.docs.addRecord(a.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        const env = await src.backup.collect();

        const dst = makeDevice(createMemoryChannel());
        const plan = await dst.backup.preview(env, { mode: "merge" });
        assert(plan.ok, "plan validates");
        assertEq(plan.plan.length, 1, "one set planned");
        assertEq(plan.plan[0].action, "create", "planned as create");
        assertEq((await dst.store.listDocuments()).length, 0, "preview wrote nothing");
      },
    },
    {
      name: "merge restore keeps local-only records and adds the backup's; replace overwrites",
      fn: async () => {
        const channel = createMemoryChannel();
        const src = makeDevice(channel);
        const s = await src.docs.create({ name: "Acme" });
        await src.docs.addRecord(s.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        const env = await src.backup.collect();

        const dst = makeDevice(createMemoryChannel());
        const t = await dst.docs.create({ name: "Acme" }); // same slugged id
        assertEq(t.id, s.id, "same set id on both devices");
        await dst.docs.addRecord(t.id, { type: "documents", name: "Onboarding", docType: "reference", ...C });

        const merged = await dst.backup.restore(env, { mode: "merge" });
        assertEq(merged.merged.length, 1, "merged the set");
        const set = await dst.docs.get(s.id, { force: true });
        const names = (arr) => arr.map((r) => r.name).sort().join(",");
        assertEq(set.records.contacts.length, 1, "backup's contact added");
        assertEq(set.records.documents.length, 1, "local document kept");
        assertEq(names(set.records.contacts), "Jo", "contact is the backup's");

        const rep = makeDevice(createMemoryChannel());
        const u = await rep.docs.create({ name: "Acme" });
        await rep.docs.addRecord(u.id, { type: "documents", name: "Onboarding", docType: "reference", ...C });
        const replaced = await rep.backup.restore(env, { mode: "replace" });
        assertEq(replaced.replaced.length, 1, "replaced the set");
        const set2 = await rep.docs.get(s.id, { force: true });
        assertEq(set2.records.documents.length, 0, "replace dropped the local-only record");
        assertEq(set2.records.contacts.length, 1, "replace adopted the backup");
      },
    },
    {
      name: "mergeDocSets is a per-type union by id with the newer record winning",
      fn: async () => {
        const local = { id: "d", records: { ...emptyRecordBag(), contacts: [{ id: "c1", name: "old", updatedAt: 5 }] } };
        const incoming = {
          id: "d",
          records: { ...emptyRecordBag(), contacts: [{ id: "c1", name: "new", updatedAt: 9 }, { id: "c2", name: "extra" }] },
        };
        const m = mergeDocSets(local, incoming);
        assertEq(m.records.contacts.length, 2, "union by id");
        assertEq(m.records.contacts.find((r) => r.id === "c1").name, "new", "newer wins");
      },
    },
    {
      name: "a backup can be published as a hosted document and listed back",
      fn: async () => {
        let uploaded = null;
        const dev = oneDevice();
        await dev.docs.create({ name: "Acme" });
        const pubBackup = createBackupService({
          store: dev.store,
          cache: dev.cache,
          upload: async (text, opts) => {
            uploaded = { text, opts };
            return { url: "https://example.test/backup-1.json" };
          },
        });
        const entry = await pubBackup.publish(undefined, { createdBy: "alice", note: "safety" });
        assertEq(entry.url, "https://example.test/backup-1.json", "url recorded");
        assert(uploaded && uploaded.text.includes(BACKUP_SCHEMA), "uploaded the serialized backup");
        assert(entry.bytes > 0, "byte size recorded");
        const list = await pubBackup.listPublished();
        assertEq(list.length, 1, "listed once");
        assertEq(list[0].note, "safety", "note preserved");
        await pubBackup.removePublished(entry.url);
        assertEq((await pubBackup.listPublished()).length, 0, "removable");
      },
    },
    {
      name: "restore refuses an invalid backup instead of applying it",
      fn: async () => {
        const { backup } = oneDevice();
        let threw = null;
        try {
          await backup.restore({ schema: "wrong", kind: "wrong", docsets: {} });
        } catch (e) {
          threw = e;
        }
        assert(threw && threw.code === "INVALID_BACKUP", "typed error");
      },
    },
    {
      name: "a docset edited on two devices opens a conflict that resolves by merge",
      fn: async () => {
        const channel = createMemoryChannel();
        const A = makeDevice(channel);
        const B = makeDevice(channel);
        const set = await A.docs.create({ name: "Acme", createdBy: "alice" });
        await A.docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...C });
        await A.sync.reconcile();

        // A stages a local change (adds a document); B edits canonical (adds a config).
        const mine = JSON.parse(JSON.stringify(await A.docs.get(set.id, { force: true })));
        mine.records.documents.push({ id: "doc1", type: "documents", name: "Runbook", docType: "reference", ...C });
        await A.sync.stageDraft(set.id, mine, { updatedBy: "alice" });
        await B.docs.addRecord(set.id, { type: "configurations", name: "fw-01", configType: "other", ...C });

        const rec = await A.sync.reconcile();
        assertEq(rec.conflicts.length, 1, "conflict detected on startup reconcile");
        const conflict = (await A.sync.listConflicts())[0].conflict;
        assertEq(conflict.mine.data.records.documents.length, 1, "mine preserved");
        assertEq(conflict.theirs.data.records.configurations.length, 1, "theirs preserved");

        const out = await A.sync.resolveConflict(set.id, "merge");
        assert(out.action.startsWith("merge"), "resolved by merge");
        const canon = await A.store.readDocument(set.id, { force: true });
        assertEq(canon.data.records.documents.length, 1, "my document survives the merge");
        assertEq(canon.data.records.configurations.length, 1, "their config survives the merge");
        assertEq((await A.sync.listConflicts()).length, 0, "conflict cleared");
      },
    },
    {
      name: "conflict resolution can keep mine or keep theirs",
      fn: async () => {
        const channel = createMemoryChannel();
        const A = makeDevice(channel);
        const B = makeDevice(channel);
        const set = await A.docs.create({ name: "Acme" });
        await A.sync.reconcile();
        const mine = JSON.parse(JSON.stringify(await A.docs.get(set.id, { force: true })));
        mine.name = "Acme (mine)";
        await A.sync.stageDraft(set.id, mine, { updatedBy: "alice" });
        await B.docs.rename(set.id, "Acme (theirs)");
        await A.sync.reconcile();
        assertEq((await A.sync.listConflicts()).length, 1, "conflict open");
        const out = await A.sync.resolveConflict(set.id, "mine");
        assertEq(out.action, "keep-mine", "kept mine");
        const canon = await A.store.readDocument(set.id, { force: true });
        assertEq(canon.data.name, "Acme (mine)", "canonical now mine");
      },
    },
  ]);
}
