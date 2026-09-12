// src/tests/docsets.test.js — validation tests for roadmap Phase 1 task 2
// (documentation-set storage). Run in the live page:
//   await import("./src/tests/docsets.test.js").then((m) => m.run())
//
// Covers: each client's documentation as ONE versioned JSON document holding
// every record type; record add/read/update/remove; version bumping; the fast
// local cache; listing/summaries/counts; deletion; and survival across devices
// and reloads (a fresh store + cache reading the same cloud channel).

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { createDocumentStore } from "../framework/store/index.js";
import { createMemoryChannel, createMemoryCache } from "../framework/store/backends.js";
import { createDocSetService, RECORD_TYPES, CLASSIFIED_TYPES, emptyDocSet, docSetId } from "../framework/docsets.js";

const CLASSIFIED = { informationModel: "core-asset", provenance: "authored" };

export async function run() {
  return runTests([
    {
      name: "a new documentation set is one versioned document holding every record type",
      fn: async () => {
        const { store, docs } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme Corp", createdBy: "alice" });
        assertEq(set.name, "Acme Corp", "name stored");
        assertEq(set.id, "docset-acme-corp", "id slugged from the name");
        assertEq(set.schema, "itu-docset/1", "schema tag");
        assertEq(set.version, 1, "first version");
        for (const t of RECORD_TYPES) assert(Array.isArray(set.records[t]), "records." + t + " is a collection");
        const list = await store.listDocuments();
        assertEq(list.length, 1, "exactly one underlying document per client");
        assertEq(list[0].id, set.id, "the document id is the set id");
      },
    },
    {
      name: "create requires a name and keeps ids unique",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        let threw = null;
        try {
          await docs.create({ name: "   " });
        } catch (e) {
          threw = e;
        }
        assert(threw, "blank name refused");
        const a = await docs.create({ name: "Acme" });
        const b = await docs.create({ name: "Acme" });
        assert(a.id !== b.id, "second set with the same name gets a unique id");
      },
    },
    {
      name: "records of every type live inside the one set document; add + read them back",
      fn: async () => {
        const { docs, store } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme" });
        const made = {};
        for (const t of CLASSIFIED_TYPES) {
          const std =
            t === "organizations"
              ? { orgKind: "organization" }
              : t === "locations"
                ? { locationType: "office" }
                : t === "contacts"
                  ? { contactRole: "client-primary" }
                  : t === "configurations"
                    ? { configType: "other" }
                    : t === "flexibleAssets"
                      ? { assetTypeId: "atype-applications", assetFields: {} }
                      : t === "passwords"
                        ? { scope: "general", category: "service-account" }
                        : t === "documents"
                          ? { docType: "reference" }
                          : t === "sites"
                            ? { siteType: "office" }
                            : t === "diagrams"
                              ? { diagramType: "network-diagram" }
                              : t === "domains"
                                ? { name: "example.com" }
                                : t === "certificates"
                                  ? { name: "www.example.com" }
                                  : t === "runbooks"
                                    ? { runbookType: "service-deployment", body: "# Steps\n\n1. Do it" }
                                    : {};
          const r = await docs.addRecord(set.id, { type: t, name: t + " record", ...CLASSIFIED, ...std });
          made[t] = r.record;
        }
        // reload the underlying document straight from the store — everything is in it
        const doc = await store.readDocument(set.id, { force: true });
        for (const t of CLASSIFIED_TYPES) assertEq(doc.data.records[t].length, 1, "one " + t + " inside the single doc");
        const read = await docs.listRecords(set.id, "configurations");
        assertEq(read.length, 1, "listRecords reads back");
        assertEq(read[0].id, made.configurations.id, "same record id");
      },
    },
    {
      name: "every mutation bumps the document version",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme" });
        assertEq(set.version, 1, "v1 on create");
        const add = await docs.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...CLASSIFIED });
        assertEq(add.version, 2, "add bumps to v2");
        const upd = await docs.updateRecord(set.id, { type: "contacts", id: add.record.id }, { role: "Owner" });
        assertEq(upd.version, 3, "update bumps to v3");
        const rm = await docs.removeRecord(set.id, { type: "contacts", id: add.record.id });
        assertEq(rm.version, 4, "remove bumps to v4");
        const got = await docs.get(set.id);
        assertEq(got.records.contacts.length, 0, "record gone after remove");
      },
    },
    {
      name: "fast local cache: a read is served from memory and the store cache is warm + versioned",
      fn: async () => {
        const { docs, store, cache } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme" });
        await docs.addRecord(set.id, { type: "documents", name: "Runbook", docType: "reference", ...CLASSIFIED });
        // memo is populated
        assert(docs.peek(set.id), "in-memory memo holds the set");
        // and the store's own local cache holds the versioned document + meta
        const cachedDoc = await cache.get("doc::" + set.id);
        const cachedMeta = await cache.get("doc-meta::" + set.id);
        assert(cachedDoc && cachedDoc.data, "document cached locally");
        assert(cachedMeta && cachedMeta.version >= 2, "meta cached with its version");
        // repeated reads return the memoised set (no re-read)
        const a = await docs.get(set.id);
        const b = await docs.get(set.id);
        assert(a === b, "second read served from memo");
      },
    },
    {
      name: "summaries + counts report per-type totals for the list view",
      fn: async () => {
        const { docs } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Beta Ltd" });
        await docs.addRecord(set.id, { type: "locations", name: "HQ", locationType: "office", ...CLASSIFIED });
        await docs.addRecord(set.id, { type: "configurations", name: "fw-01", configType: "other", ...CLASSIFIED });
        await docs.addRecord(set.id, { type: "configurations", name: "sw-01", configType: "other", ...CLASSIFIED });
        const c = await docs.counts(set.id);
        assertEq(c.configurations, 2, "configuration count");
        assertEq(c.locations, 1, "location count");
        assertEq(c.passwords, 0, "empty type reports zero");
        assertEq(await docs.countRecords(set.id), 3, "total entity records");
        const sums = await docs.summaries();
        assertEq(sums.length, 1, "one summary");
        assertEq(sums[0].name, "Beta Ltd", "summary carries the name");
        assertEq(sums[0].recordCount, 3, "summary carries the record count");
      },
    },
    {
      name: "documentation survives a reload: a fresh store + cache reads the same set",
      fn: async () => {
        const channel = createMemoryChannel();
        const first = createDocSetService({
          store: createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() }),
          cache: createMemoryCache(),
        });
        const set = await first.create({ name: "Acme" });
        await first.addRecord(set.id, { type: "passwords", name: "Router admin", scope: "general", category: "network-device", ...CLASSIFIED });

        // "reload": brand-new store, brand-new local cache, same cloud channel
        const second = createDocSetService({
          store: createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() }),
          cache: createMemoryCache(),
        });
        const restored = await second.get(set.id, { force: true });
        assert(restored, "set recovered after reload");
        assertEq(restored.name, "Acme", "name recovered");
        assertEq(restored.records.passwords.length, 1, "records recovered");
        assertEq(restored.records.passwords[0].name, "Router admin", "record content recovered");
      },
    },
    {
      name: "documentation survives across devices: a second device sees and extends the set",
      fn: async () => {
        const channel = createMemoryChannel();
        const deviceA = createDocSetService({
          store: createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() }),
          cache: createMemoryCache(),
        });
        const set = await deviceA.create({ name: "Acme", createdBy: "alice" });
        await deviceA.addRecord(set.id, { type: "contacts", name: "Jo", contactRole: "client-primary", ...CLASSIFIED });

        const deviceB = createDocSetService({
          store: createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() }),
          cache: createMemoryCache(),
        });
        const seen = await deviceB.get(set.id, { force: true });
        assertEq(seen.records.contacts.length, 1, "device B sees A's record");
        await deviceB.addRecord(set.id, { type: "documents", name: "Onboarding", docType: "reference", ...CLASSIFIED });
        const backOnA = await deviceA.get(set.id, { force: true });
        assertEq(backOnA.records.documents.length, 1, "device A sees B's addition");
      },
    },
    {
      name: "remove deletes the whole set document",
      fn: async () => {
        const { docs, store } = makeWorld({ namespace: "kb-test" });
        const set = await docs.create({ name: "Acme" });
        await docs.remove(set.id);
        assertEq(await docs.get(set.id, { force: true }), null, "set gone");
        assertEq((await store.listDocuments()).length, 0, "underlying document gone");
      },
    },
    {
      name: "emptyDocSet / docSetId helpers shape ids and the empty record bag",
      fn: async () => {
        const set = emptyDocSet({ id: docSetId("Müller & Sons Ltd."), name: "Müller & Sons Ltd." });
        assertEq(set.id, "docset-muller-sons-ltd", "unicode + punctuation slugged");
        for (const t of RECORD_TYPES) assertEq(set.records[t].length, 0, t + " starts empty");
      },
    },
  ]);
}
