// src/tests/store.test.js — validation tests for Phase 1 Task 2
// (canonical document store). Run in the live page:
//   await import("./src/tests/store.test.js").then((m) => m.run())
//
// Covers: write/read round-trips with versioning, no-op rewrites, chunking
// (documents split across multiple physical files when large), the document
// registry + listing, deletion, idempotent seeding, cross-"device" sync
// staleness, integrity checks, cache fast-path, and a best-effort live smoke
// test against the real cloud editable files (skips silently when the
// environment can't write, e.g. an unsaved preview).

import { runTests, assert, assertEq, skip } from "./harness.js";
import { createDocumentStore, StoreError } from "../framework/store/index.js";
import { createMemoryChannel, createMemoryCache, createUploadChannel, createKvCache } from "../framework/store/backends.js";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function freshBackends() {
  return { channel: createMemoryChannel(), cache: createMemoryCache() };
}

function makeStore(overrides = {}) {
  const { channel, cache } = freshBackends();
  const store = createDocumentStore({ namespace: "kb-test", channel, cache, ceiling: overrides.ceiling || 200 * 1024 });
  store._channel = channel;
  store._cache = cache;
  return store;
}

export async function run(opts = {}) {
  const tests = [
    {
      name: "round-trip: write then read returns the same data, version 1",
      fn: async () => {
        const s = makeStore();
        const w = await s.writeDocument("articles", { items: [{ title: "Onboarding" }] }, { updatedBy: "alice" });
        assert(w.changed, "write reports changed");
        assertEq(w.doc.version, 1, "first version");
        assertEq(w.doc.updatedBy, "alice", "writer recorded");
        const r = await s.readDocument("articles");
        assertEq(r.data.items[0].title, "Onboarding", "data round-trips");
        assertEq(r.version, 1, "read version matches");
      },
    },
    {
      name: "version bumps on change, identical rewrite is a no-op",
      fn: async () => {
        const s = makeStore();
        await s.writeDocument("articles", { items: [] });
        const again = await s.writeDocument("articles", { items: [] });
        assert(!again.changed, "identical rewrite is a no-op");
        assertEq(again.doc.version, 1, "version unchanged");
        const changed = await s.writeDocument("articles", { items: [{ t: 1 }] });
        assert(changed.changed, "change is a write");
        assertEq(changed.doc.version, 2, "version bumped");
      },
    },
    {
      name: "large documents split across chunk files and re-join correctly",
      fn: async () => {
        const s = makeStore({ ceiling: 128 });
        const big = { items: Array.from({ length: 80 }, (_, i) => ({ i, text: "The quick brown fox jumps over the lazy dog — " + i })) };
        const w = await s.writeDocument("articles", big);
        const r = await s.readDocument("articles");
        assertEq(r.data.items.length, 80, "all items survive split");
        assertEq(r.data.items[79].text, big.items[79].text, "tail item intact");
        assert(w.meta.chunks.length > 1, "multiple physical chunks written");
        for (const name of w.meta.chunks) {
          const text = s._channel.files.get(name);
          assert(text !== undefined, `chunk ${name} exists`);
          assert(new TextEncoder().encode(text).length <= 128, `chunk ${name} within ceiling`);
        }
      },
    },
    {
      name: "registry lists documents; stats report size vs ceiling",
      fn: async () => {
        const s = makeStore();
        await s.writeDocument("articles", { items: [{ a: 1 }] });
        await s.writeDocument("categories", [{ id: "ops", label: "Operations" }]);
        const list = await s.listDocuments();
        assertEq(list.length, 2, "two documents listed");
        assertEq(list.map((d) => d.id).join(","), "articles,categories", "sorted by id");
        const stats = await s.documentStats("articles");
        assert(stats.bytes > 0, "size reported");
        assertEq(stats.chunkCount, 1, "single chunk for small doc");
        assert(stats.ceiling >= stats.used, "used within capacity");
      },
    },
    {
      name: "deleteDocument removes the document from registry and cache",
      fn: async () => {
        const s = makeStore();
        await s.writeDocument("articles", { items: [] });
        const d = await s.deleteDocument("articles");
        assert(d.changed, "delete reports changed");
        const r = await s.readDocument("articles");
        assert(r === null, "doc gone after delete");
        assertEq((await s.listDocuments()).length, 0, "not listed");
      },
    },
    {
      name: "deleteDocument never destroys the chunk files (a stale registry read re-referencing them must stay readable — regression: live editable channel blanked chunks on delete, permanently corrupting the doc)",
      fn: async () => {
        const s = makeStore();
        await s.writeDocument("articles", { items: [{ title: "keep-me" }] });
        const meta = await s.meta("articles");
        const name = meta.chunks[0];
        const content = s._channel.files.get(name);
        assert(content && content.includes("keep-me"), "chunk written with content");
        const d = await s.deleteDocument("articles");
        assert(d.changed, "delete reports changed");
        assert(s._channel.files.has(name), "chunk file still physically present");
        assertEq(s._channel.files.get(name), content, "chunk content untouched (never blanked)");
        assertEq((await s.listDocuments()).length, 0, "doc gone from registry");
      },
    },
    {
      name: "ensure seeds only missing documents and never overwrites",
      fn: async () => {
        const s = makeStore();
        const seeded = await s.ensureMany({ articles: () => ({ items: [] }), categories: () => [{ id: "x" }] });
        assertEq(seeded.filter((c) => c.changed).length, 2, "both seeded on first boot");
        await s.writeDocument("articles", { items: [{ title: "Mine" }] });
        const reseed = await s.ensure("articles", () => ({ items: [{ title: "Seed" }] }));
        assert(!reseed[0] || reseed[0].changed === undefined || reseed[0].changed === false, "re-seed is a no-op");
        const r = await s.readDocument("articles");
        assertEq(r.data.items[0].title, "Mine", "existing doc untouched by seeding");
      },
    },
    {
      name: "a second device sees and can update the same cloud document",
      fn: async () => {
        const channel = createMemoryChannel();
        const a = createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() });
        await a.writeDocument("articles", { items: [{ title: "v1" }] }, { updatedBy: "alice" });

        const b = createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() });
        const readB = await b.readDocument("articles", { force: true });
        assertEq(readB.data.items[0].title, "v1", "device B reads A's document");
        await b.writeDocument("articles", { items: [{ title: "v2" }] }, { updatedBy: "bob" });
        const metaB = await b.meta("articles");
        assertEq(metaB.version, 2, "device B bumped the version");
      },
    },
    {
      name: "sync() flags a cache as stale after another device edits",
      fn: async () => {
        const channel = createMemoryChannel();
        const cacheA = createMemoryCache();
        const a = createDocumentStore({ namespace: "kb-test", channel, cache: cacheA });
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await a.readDocument("articles"); // warm A's cache at v1

        const b = createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() });
        await b.writeDocument("articles", { items: [{ title: "v2" }] }, { updatedBy: "bob" });

        const cachedBefore = await cacheA.get("doc-meta::articles");
        assertEq(cachedBefore.version, 1, "A still has v1 cached");
        const res = await a.sync();
        assertEq(res.stale, 1, "sync detects the stale document");
        const cachedAfter = await cacheA.get("doc-meta::articles");
        assertEq(cachedAfter.version, 2, "meta refreshed to v2");
        const fresh = await a.readDocument("articles", { force: true });
        assertEq(fresh.data.items[0].title, "v2", "force-read gets the newest content");
      },
    },
    {
      name: "corrupted chunk data fails the integrity check",
      fn: async () => {
        const s = makeStore();
        await s.writeDocument("articles", { items: [{ title: "x" }] });
        const meta = await s.meta("articles");
        const name = meta.chunks[0];
        s._channel.files.set(name, s._channel.files.get(name).replace("x", "Y"));
        s._cache.del("doc::articles");
        let threw = null;
        try {
          await s.readDocument("articles", { force: true });
        } catch (e) {
          threw = e;
        }
        assert(threw instanceof StoreError, "threw a typed error");
        assertEq(threw.code, "INTEGRITY", "integrity code");
      },
    },
    {
      name: "cache fast-path serves reads without touching the cloud",
      fn: async () => {
        const { channel, cache } = freshBackends();
        let gets = 0;
        const counting = {
          ...channel,
          get: async (name) => {
            gets++;
            return channel.get(name);
          },
        };
        const s = createDocumentStore({ namespace: "kb-test", channel: counting, cache });
        await s.writeDocument("articles", { items: [1, 2, 3] });
        gets = 0;
        const r1 = await s.readDocument("articles");
        assertEq(gets, 0, "cached read makes no cloud calls");
        assertEq(r1.data.items.length, 3, "cached content correct");
        await s.readDocument("articles", { force: true });
        assert(gets > 0, "forced read hits the cloud");
      },
    },
    {
      name: "the registry survives a full restart (new store, empty cache)",
      fn: async () => {
        const channel = createMemoryChannel();
        const first = createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() });
        await first.ensureMany({
          articles: () => ({ items: [] }),
          categories: () => [{ id: "ops", label: "Operations" }],
        });
        const second = createDocumentStore({ namespace: "kb-test", channel, cache: createMemoryCache() });
        const list = await second.listDocuments();
        assertEq(list.length, 2, "documents recovered after restart");
        const cat = await second.readDocument("categories", { force: true });
        assertEq(cat.data[0].label, "Operations", "content recovered after restart");
      },
    },
    {
      name: "live: cloud editable round-trip via real plugins (skips if unavailable)",
      fn: async () => {
        if (!opts.live) skip("live cloud test — pass {live:true} to run"); // only run when explicitly requested
        const kv = window.root && window.root.kv;
        const up = window.root && window.root.uploadPlugin;
        if (!kv || !up) throw new Error("plugins not loaded in this page");
        const cache = createKvCache(kv, "kb-test-live");
        const keyStore = {
          get: (k) => cache.get("editkey::" + k),
          set: (k, v) => cache.set("editkey::" + k, v),
          del: (k) => cache.del("editkey::" + k),
        };
        const channel = createUploadChannel({ uploadPlugin: up, keyStore });
        const store = createDocumentStore({ namespace: "kb-test-live", channel, cache, ceiling: 4000 });
        const id = "smoke-" + Date.now().toString(36);
        try {
          const data = { hello: "world", n: 42, ts: Date.now() };
          const w = await store.writeDocument(id, data, { updatedBy: "test" });
          assert(w.changed, "live write reported changed");
          const r = await store.readDocument(id, { force: true });
          assertEq(r.data.n, 42, "live round-trip data");
          assertEq(r.version, w.doc.version, "live version persisted");
          const again = await store.writeDocument(id, data, { updatedBy: "test" });
          assert(!again.changed, "live identical rewrite is a no-op");
          await store.deleteDocument(id);
          const gone = await store.readDocument(id, { force: true });
          assert(gone === null, "live document deleted");
        } catch (e) {
          const msg = String((e && e.message) || e);
          if (e && e.code === "STORAGE_UNAVAILABLE") skip("cloud storage unavailable in this environment (unsaved preview)"); // unsaved preview
          if (msg.includes("editable_requires_saved_generator")) skip("cloud editable files require a saved generator");
          throw e;
        }
      },
    },
  ];
  return runTests(tests);
}
