// src/tests/sync.test.js — validation tests for Phase 1 Task 3
// (sync, conflict & concurrency handling). Run in the live page:
//   await import("./src/tests/sync.test.js").then((m) => m.run())
//
// Covers: startup reconcile (refresh / draft-push / conflict), the
// keep-mine / keep-theirs / field-merge resolution paths (nothing ever
// silently discarded — both sides are preserved in a resolution history),
// 3-way and 2-way field-level merges, offline write staging, concurrent
// same-document writes (never clobber the canonical, preserve both sides,
// content-hash chunk names so the losing side's data physically survives),
// and deleted-remote handling.

import { runTests, assert, assertEq } from "./harness.js";
import { createDocumentStore, StoreError } from "../framework/store/index.js";
import { createSyncEngine, merge3 } from "../framework/store/sync.js";
import { createMemoryChannel, createMemoryCache } from "../framework/store/backends.js";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function makeStore(overrides = {}) {
  const channel = overrides.channel || createMemoryChannel();
  const cache = overrides.cache || createMemoryCache();
  const store = createDocumentStore({ namespace: "kb-sync", channel, cache });
  store._channel = channel;
  store._cache = cache;
  return store;
}

function makeEngine(store) {
  return createSyncEngine({ store, cache: store._cache, now: () => Date.now() });
}

// A two-"device" setup: shared cloud channel, independent local caches, each
// with its own store + engine (the same shape as the real app's deployments).
function twoDevices() {
  const channel = createMemoryChannel();
  const a = makeStore({ channel });
  const b = makeStore({ channel });
  const ea = makeEngine(a);
  const eb = makeEngine(b);
  return { channel, a, b, ea, eb };
}

// Simulates the live editable-file channel returning a STALE value for the
// registry read that immediately follows a registry put (the plugin can serve
// a cached pre-write read). The put itself lands. A single sequential writer
// must still never be misreported as a concurrent conflict.
function makeStaleVerifyChannel() {
  const mem = createMemoryChannel();
  let lastPut = null; // {name, prev} — the most recent put and its pre-write value
  const ch = {
    files: mem.files,
    async list() {
      return mem.list();
    },
    async get(name) {
      if (lastPut && name === lastPut.name) {
        const stale = lastPut.prev ?? null;
        lastPut = null; // stale read served once per put
        return stale;
      }
      return mem.get(name);
    },
    async put(name, text) {
      lastPut = { name, prev: mem.files.get(name) };
      return mem.put(name, text);
    },
    async del(name) {
      return mem.del(name);
    },
  };
  return ch;
}

// Simulates the live editable-file channel coalescing a registry put: the put
// LANDS but the first one reports `superseded`, so commitRegistry retries and
// re-reads its own just-landed write.
function makeSupersededChannel() {
  const mem = createMemoryChannel();
  let supersededOnce = false;
  const ch = {
    files: mem.files,
    async list() {
      return mem.list();
    },
    async get(name) {
      return mem.get(name);
    },
    async put(name, text) {
      const res = await mem.put(name, text);
      if (!supersededOnce && name.endsWith("-registry")) {
        supersededOnce = true;
        return { ...res, superseded: true };
      }
      return res;
    },
    async del(name) {
      return mem.del(name);
    },
  };
  return ch;
}

export async function run() {
  const tests = [
    {
      name: "merge3: 3-way field merge keeps each side's unique edits and resolves shared edits",
      fn: () => {
        const base = { title: "T", summary: "S", tags: ["a"], owner: { name: "Alice" }, steps: [{ id: 1, text: "one" }] };
        const mine = { title: "T", summary: "S2", tags: ["a", "b"], owner: { name: "Alice" }, steps: [{ id: 1, text: "one-mine" }, { id: 2, text: "two" }] };
        const theirs = { title: "T2", summary: "S", tags: ["a", "c"], owner: { name: "Bob" }, steps: [{ id: 1, text: "one-theirs" }] };
        const m = merge3(mine, theirs, base);
        assertEq(m.title, "T2", "only theirs changed title → theirs");
        assertEq(m.summary, "S2", "only mine changed summary → mine");
        assertEq(m.owner.name, "Bob", "only theirs changed owner → theirs");
        assertEq(m.tags.join(","), "a,c,b", "both changed tags → union (theirs first, mine's new items appended)");
        assertEq(m.steps.length, 2, "steps unioned by id");
        assertEq(m.steps[0].text, "one-theirs", "same-id step both changed → scalar policy (theirs)");
        assertEq(m.steps[1].text, "two", "mine's new step preserved");
      },
    },
    {
      name: "merge3: scalar policy 'mine' picks mine when both sides changed a scalar",
      fn: () => {
        const m = merge3({ a: 1, b: 2 }, { a: 9, b: 2 }, { a: 1, b: 2 }, { scalar: "mine" });
        assertEq(m.a, 9, "both changed a → mine (9)");
        assertEq(m.b, 2, "only theirs changed b → theirs");
      },
    },
    {
      name: "merge3: 2-way merge (no base) still preserves both sides",
      fn: () => {
        const m = merge3({ a: 1, items: [{ id: "x", v: 1 }] }, { a: 1, b: 2, items: [{ id: "x", v: 9 }, { id: "y", v: 3 }] });
        assertEq(m.a, 1, "equal field kept");
        assertEq(m.b, 2, "theirs-only field kept");
        assertEq(m.items.length, 2, "both sides' items survive (union)");
      },
    },
    {
      name: "startup reconcile refreshes a stale cache without inventing a conflict",
      fn: async () => {
        const { a, b, ea } = twoDevices();
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await ea.reconcile(); // A syncs at v1
        await b.writeDocument("articles", { items: [{ title: "v2" }] }); // upstream advances
        const res = await ea.reconcile();
        assertEq(res.conflicts.length, 0, "no draft → no conflict");
        assert(res.refreshed >= 1, "cache refreshed");
        const st = await ea.getDocStatus("articles");
        assertEq(st.state, "synced", "now in sync");
        assertEq(st.canonical.version, 2, "tracks the new canonical version");
      },
    },
    {
      name: "an offline-staged draft is pushed automatically when the canonical hasn't moved",
      fn: async () => {
        const { a, ea } = twoDevices();
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await ea.reconcile();
        await ea.stageDraft("articles", { items: [{ title: "offline-edit" }] }, { updatedBy: "alice" });
        const res = await ea.reconcile();
        assertEq(res.pushed, 1, "draft pushed");
        const doc = await a.readDocument("articles", { force: true });
        assertEq(doc.data.items[0].title, "offline-edit", "canonical now has the draft");
        assertEq((await ea.listDrafts()).length, 0, "draft cleared");
      },
    },
    {
      name: "draft based on an older canonical + upstream advance → conflict with BOTH sides preserved",
      fn: async () => {
        const { a, b, ea } = twoDevices();
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await ea.reconcile();
        await ea.stageDraft("articles", { items: [{ title: "my-edit" }] }, { updatedBy: "alice" });
        await b.writeDocument("articles", { items: [{ title: "v2-other" }] }); // upstream advances
        const res = await ea.reconcile();
        assertEq(res.conflicts.length, 1, "conflict detected");
        const st = await ea.getDocStatus("articles");
        assertEq(st.state, "conflict", "status = conflict");
        const conflicts = await ea.listConflicts();
        const c = conflicts[0];
        assertEq(c.conflict.mine.data.items[0].title, "my-edit", "mine preserved");
        assertEq(c.conflict.theirs.data.items[0].title, "v2-other", "theirs preserved");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.items[0].title, "v2-other", "canonical untouched until resolution");
      },
    },
    {
      name: "resolve keep-theirs adopts the canonical and keeps the local side in history",
      fn: async () => {
        const { a, b, ea } = twoDevices();
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await ea.reconcile();
        await ea.stageDraft("articles", { items: [{ title: "my-edit" }] });
        await b.writeDocument("articles", { items: [{ title: "v2-other" }] });
        await ea.reconcile();
        const out = await ea.resolveConflict("articles", "theirs");
        assertEq(out.action, "theirs", "adopted theirs");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.items[0].title, "v2-other", "canonical is theirs");
        assertEq((await ea.listConflicts()).length, 0, "conflict cleared");
        assertEq((await ea.listDrafts()).length, 0, "draft cleared");
        const hist = await a._cache.get("resolution::articles");
        assert(hist && hist.length === 1, "resolution recorded");
        assertEq(hist[0].mine.data.items[0].title, "my-edit", "mine kept in resolution history (not discarded)");
      },
    },
    {
      name: "resolve keep-mine writes the draft (device owns the document)",
      fn: async () => {
        const { a, b, ea } = twoDevices();
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await ea.reconcile();
        await ea.stageDraft("articles", { items: [{ title: "my-edit" }] });
        await b.writeDocument("articles", { items: [{ title: "v2-other" }] });
        await ea.reconcile();
        const out = await ea.resolveConflict("articles", "mine");
        assertEq(out.action, "keep-mine", "kept mine");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.items[0].title, "my-edit", "canonical now has my edit");
        assertEq(canon.version, 3, "version bumped past theirs");
        const st = await ea.getDocStatus("articles");
        assertEq(st.state, "synced", "conflict resolved");
      },
    },
    {
      name: "resolve merge writes the field-merged document",
      fn: async () => {
        const { a, b, ea } = twoDevices();
        const base = { title: "T", summary: "S", owner: "Alice", tags: ["a"] };
        await a.writeDocument("articles", base);
        await ea.reconcile();
        await ea.stageDraft("articles", { title: "T", summary: "S2", owner: "Alice", tags: ["a", "b"] }, { updatedBy: "alice" });
        await b.writeDocument("articles", { title: "T2", summary: "S", owner: "Bob", tags: ["a", "c"] });
        await ea.reconcile();
        const out = await ea.resolveConflict("articles", "merge");
        assertEq(out.action, "merge", "real merge happened");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.title, "T2", "title → theirs (only they changed)");
        assertEq(canon.data.summary, "S2", "summary → mine (only I changed)");
        assertEq(canon.data.owner, "Bob", "owner → theirs (only they changed)");
        assertEq(canon.data.tags.join(","), "a,c,b", "tags unioned");
        assertEq((await ea.listConflicts()).length, 0, "conflict cleared");
      },
    },
    {
      name: "concurrent same-doc write never clobbers: loser becomes a conflict, canonical stays intact",
      fn: async () => {
        const { a, b } = twoDevices();
        await a.writeDocument("articles", { title: "v1" });
        // Make B's commit re-read the registry AFTER A commits a competing v2:
        // B will then see the canonical moved since it based its write on v1.
        const origGet = a._channel.get.bind(a._channel);
        let count = 0;
        let fired = false;
        a._channel.get = async (name) => {
          const val = await origGet(name);
          if (!fired && name === "kb-sync-registry") {
            count++;
            if (count === 2) {
              fired = true;
              await a.writeDocument("articles", { title: "v2-other" });
              return origGet(name); // now reflects v2-other
            }
          }
          return val;
        };
        const res = await b.writeDocument("articles", { title: "b-mine" });
        assert(res.conflicted, "B's write reports a concurrent conflict");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.title, "v2-other", "A's canonical untouched");
        const draft = await b._cache.get("draft::articles");
        assert(draft, "B's change preserved as a draft");
        assertEq(draft.data.title, "b-mine", "draft has B's content");
        const conflict = await b._cache.get("conflict::articles");
        assert(conflict, "conflict record opened");
        assertEq(conflict.theirs.data.title, "v2-other", "theirs = A's canonical");
        // Physical survival: both sides' chunks exist under different names.
        const files = [...a._channel.files.keys()];
        assert(files.some((n) => n.includes("articles-v2-") && a._channel.files.get(n).includes("b-mine")), "B's chunk physically preserved");
        assert(files.some((n) => n.includes("articles-v2-") && a._channel.files.get(n).includes("v2-other")), "A's chunk physically preserved");
      },
    },
    {
      name: "offline write is staged locally and pushed once the cloud is reachable",
      fn: async () => {
        const { a, ea } = twoDevices();
        await a.writeDocument("articles", { items: [] });
        await ea.reconcile();
        let offline = true;
        const origPut = a._channel.put.bind(a._channel);
        a._channel.put = async (name, text) => {
          if (offline) throw new StoreError("STORAGE_UNAVAILABLE", "offline");
          return origPut(name, text);
        };
        let err = null;
        try {
          await a.writeDocument("articles", { items: [{ title: "offline-edit" }] });
        } catch (e) {
          err = e;
        }
        assert(err, "write failed while offline");
        assert(err.staged, "failed write reports it was staged");
        const draft = await a._cache.get("draft::articles");
        assert(draft, "change preserved as a draft");
        assertEq(draft.data.items[0].title, "offline-edit", "draft has the offline change");
        const canonOffline = await a.readDocument("articles", { force: true });
        assertEq(canonOffline.data.items.length, 0, "canonical unchanged while offline");
        offline = false;
        const res = await ea.reconcile();
        assertEq(res.pushed, 1, "draft pushed on reconnect");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.items[0].title, "offline-edit", "canonical now has the offline edit");
      },
    },
    {
      name: "document deleted upstream keeps the local copy (deleted-remote), nothing discarded",
      fn: async () => {
        const { a, b, ea } = twoDevices();
        await a.writeDocument("articles", { items: [{ title: "keep-me" }] });
        await ea.reconcile();
        await b.deleteDocument("articles");
        const res = await ea.reconcile();
        assertEq(res.deletedRemote, 1, "deleted-remote detected");
        const st = await ea.getDocStatus("articles");
        assertEq(st.state, "deleted-remote", "status = deleted-remote");
        const cached = await a._cache.get("doc::articles");
        assert(cached, "local copy retained");
        assertEq(cached.data.items[0].title, "keep-me", "local content intact");
      },
    },
    {
      name: "attach(): a confirmed write fulfills a draft of the same content; different content surfaces as a conflict (never silently discarded)",
      fn: async () => {
        const { a, ea } = twoDevices();
        ea.attach(a);
        await a.writeDocument("articles", { items: [{ title: "v1" }] });
        await ea.reconcile();
        // Same-content write → draft fulfilled, no conflict.
        await ea.stageDraft("articles", { items: [{ title: "fulfilled" }] });
        await a.writeDocument("articles", { items: [{ title: "fulfilled" }] });
        let res = await ea.reconcile();
        assertEq(res.conflicts.length, 0, "same-content write → no conflict");
        assertEq((await ea.listDrafts()).length, 0, "fulfilled draft cleared");
        // Different-content write → the staged draft is a genuine divergence.
        await ea.stageDraft("articles", { items: [{ title: "divergent-draft" }] });
        await a.writeDocument("articles", { items: [{ title: "fresh-save" }] });
        res = await ea.reconcile();
        assertEq(res.conflicts.length, 1, "different-content write → conflict surfaced");
        const conflicts = await ea.listConflicts();
        assertEq(conflicts[0].conflict.mine.data.items[0].title, "divergent-draft", "my draft preserved");
        assertEq(conflicts[0].conflict.theirs.data.items[0].title, "fresh-save", "their write preserved");
      },
    },
    {
      name: "content-hash chunk names: different content never reuses the same physical file",
      fn: async () => {
        const { a } = twoDevices();
        const w1 = await a.writeDocument("articles", { title: "one" });
        const n1 = w1.meta.chunks[0];
        assert(n1.includes("-v1-"), "chunk name stamped with version");
        const w2 = await a.writeDocument("articles", { title: "two" });
        const n2 = w2.meta.chunks[0];
        assert(n2.includes("-v2-"), "new version, new name");
        assert(n1 !== n2, "different content → different file");
        assert(a._channel.files.has(n1), "v1 chunk still present (history/orphans preserved)");
        assert(a._channel.files.has(n2), "v2 chunk present");
      },
    },
    {
      name: "a fresh device reconcile adopts every canonical doc as in-sync",
      fn: async () => {
        const { a, channel } = twoDevices();
        await a.ensureMany({
          articles: () => ({ items: [] }),
          categories: () => [{ id: "ops", label: "Operations" }],
        });
        const fresh = makeStore({ channel });
        const ef = makeEngine(fresh);
        const res = await ef.reconcile();
        assertEq(res.checked, 2, "checked both docs");
        assertEq(res.conflicts.length, 0, "no conflicts from cold start");
        const ov = await ef.getOverview();
        assertEq(ov.docCount, 2, "overview sees both");
        const st = await ef.getDocStatus("categories");
        assertEq(st.state, "synced", "categories in sync");
      },
    },
    {
      name: "a stale post-put registry read is NOT reported as a concurrent conflict (regression: live merge wrote but threw CONCURRENT_WRITE)",
      fn: async () => {
        const a = makeStore({ channel: makeStaleVerifyChannel() });
        const ea = makeEngine(a);
        await a.writeDocument("articles", { title: "v1" });
        await ea.reconcile();
        const res = await a.writeDocument("articles", { title: "v2" });
        assertEq(res.conflicted, false, "sequential write not flagged as a conflict");
        assertEq(res.changed, true, "write reported as changed");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.title, "v2", "canonical is the new content");
        assertEq(canon.version, 2, "version bumped once, not stuck on stale reg");
        assertEq((await a._cache.get("draft::articles")), undefined, "no draft staged");
        assertEq((await a._cache.get("conflict::articles")), undefined, "no conflict opened");
      },
    },
    {
      name: "a superseded (coalesced) registry put whose write landed is NOT a conflict (regression: live coalescing caused false CONCURRENT_WRITE)",
      fn: async () => {
        const a = makeStore({ channel: makeSupersededChannel() });
        const ea = makeEngine(a);
        await a.writeDocument("articles", { title: "v1" });
        await ea.reconcile();
        const res = await a.writeDocument("articles", { title: "v2" });
        assertEq(res.conflicted, false, "write that landed via coalescing is not a conflict");
        const canon = await a.readDocument("articles", { force: true });
        assertEq(canon.data.title, "v2", "canonical is the new content");
        assertEq(canon.version, 2, "registry reflects exactly one bump");
        assertEq((await a._cache.get("draft::articles")), undefined, "no draft staged");
      },
    },
  ];
  return runTests(tests);
}
