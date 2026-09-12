// src/tests/field.test.js — validation tests for roadmap task 51
// (field access & responsive UI). Run in the live page:
//   await import("./src/tests/field.test.js").then((m) => m.run())
//
// Covers: staged-write detection & notices, the pending-draft summary, the
// connectivity watcher (browser events, probe, sync lifecycle, subscribe), the
// header pill summary, the field-checklist tick helpers (immutable, stamped,
// next-open-step), the quick-query parser / chips / search, and the end-to-end
// offline story: an edit made with the cloud unreachable is preserved as a
// local draft, the set still reads back locally, and the edit reconciles onto
// the canonical document once the connection returns.

import { runTests, assert, assertEq } from "./harness.js";
import { makeWorld } from "./testFixtures.js";
import { StoreError } from "../framework/store/index.js";
import {
  isStagedWrite,
  stagedWriteNotice,
  pendingDraftsSummary,
  createConnectivity,
  connectivitySummary,
  setChecklistStepDone,
  toggleChecklistStep,
  nextOpenStep,
  parseQuickQuery,
  quickSearch,
  quickChips,
} from "../framework/field.js";

const CLASSIFIED = { informationModel: "core-asset", provenance: "authored" };



// A fake window supporting the two events the connectivity watcher binds.
function fakeWin() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (handlers.has(type)) handlers.get(type).delete(fn);
    },
    fire(type) {
      for (const fn of handlers.get(type) || []) fn({ type });
    },
    count(type) {
      return (handlers.get(type) || new Set()).size;
    },
  };
}

const STEPS = [
  { id: "s1", text: "Open the cabinet", done: false, doneAt: null, doneBy: "", assignee: "alice" },
  { id: "s2", text: "Patch the uplink", done: false, doneAt: null, doneBy: "" },
  { id: "s3", text: "Label the runs", done: true, doneAt: 111, doneBy: "bob" },
];

// A tiny search index in the shape buildCombinedIndex produces, so quickSearch
// can be exercised without a live store.
function fakeIndex() {
  const mk = (collection, name, client, text, extra = {}) => ({
    key: collection + ":" + name,
    collection,
    ref: { type: collection, id: name },
    type: collection,
    name,
    client: { id: client.id, name: client.name },
    informationModel: extra.informationModel || "core-asset",
    provenance: extra.provenance || "authored",
    modelLabel: "Core asset",
    provenanceLabel: "Authored",
    lifecycle: extra.lifecycle || "none",
    text: name + " " + text,
    haystack: name + " " + name + " " + text,
    record: { type: collection, id: name, name },
  });
  const acme = { id: "docset-acme", name: "Acme Corp" };
  const globex = { id: "docset-globex", name: "Globex" };
  return {
    entries: [
      mk("configurations", "Core Switch", acme, "vlan 40 uplink"),
      mk("configurations", "Edge Firewall", acme, "vlan 10 wan"),
      mk("documents", "VLAN Plan", acme, "vlan reference"),
      mk("flexibleAssets", "Core Switch", globex, "vlan 99", { informationModel: "flexible-asset", provenance: "synced" }),
    ],
    bySet: new Map(),
    sets: [],
  };
}

export async function run() {
  return runTests([
    {
      name: "staged-write detection recognises the store's offline/unsaved error shapes",
      fn: async () => {
        const err = new StoreError("STORAGE_UNAVAILABLE", "offline");
        err.staged = true;
        assert(isStagedWrite(err), "a store error with .staged is a staged write");
        const bare = new StoreError("EDIT_KEY_REQUIRED", "no key");
        assert(isStagedWrite(bare), "an edit-key error is a staged write even without the flag");
        assert(!isStagedWrite(new StoreError("MISSING_CHUNK", "boom")), "an unrelated store error is not");
        assert(!isStagedWrite(null), "null is not");
        assert(!isStagedWrite(new Error("plain")), "a plain error is not");
        assertEq(isStagedWrite({ code: "STORAGE_UNAVAILABLE" }), true, "a bare code object is detected");
      },
    },
    {
      name: "stagedWriteNotice keeps the store's own message but gives a friendly one otherwise",
      fn: async () => {
        assertEq(
          stagedWriteNotice({ message: "Saved locally for later sync — offline." }),
          "Saved locally for later sync — offline.",
          "store message preserved",
        );
        const notice = stagedWriteNotice({ message: "offline" });
        assert(/sync automatically/i.test(notice), "fallback notice explains the auto-sync");
        assert(notice.length > 0, "never empty");
      },
    },
    {
      name: "pendingDraftsSummary counts the local draft log with a human label",
      fn: async () => {
        assertEq(pendingDraftsSummary([]).count, 0, "empty");
        assertEq(pendingDraftsSummary([]).label, "No pending changes", "empty label");
        assertEq(pendingDraftsSummary([{ id: "a" }]).count, 1, "one");
        assertEq(pendingDraftsSummary([{ id: "a" }]).label, "1 change waiting to sync", "singular");
        const two = pendingDraftsSummary([{ id: "a" }, { id: "b" }]);
        assertEq(two.count, 2, "two");
        assertEq(two.ids.join(","), "a,b", "ids preserved");
        assertEq(pendingDraftsSummary(null).count, 0, "null tolerated");
      },
    },
    {
      name: "connectivity follows the browser online/offline events and reports transitions",
      fn: async () => {
        const win = fakeWin();
        const nav = { onLine: true };
        let now = 1000;
        const conn = createConnectivity({ win, nav, now: () => now });
        conn.start();
        assertEq(win.count("online"), 1, "online listener registered");
        assertEq(win.count("offline"), 1, "offline listener registered");
        assert(conn.online, "starts online");

        const seen = [];
        const off = conn.subscribe((s) => seen.push({ online: s.online, previous: s.previous }));
        now = 2000;
        win.fire("offline");
        assertEq(conn.online, false, "offline event flips the state");
        now = 3000;
        win.fire("online");
        assertEq(conn.online, true, "online event flips it back");
        assertEq(seen.length, 2, "two transitions observed");
        assertEq(seen[0].previous, true, "offline transition records the previous state");
        assertEq(seen[1].previous, false, "online transition records the previous state");
        assertEq(conn.state().since, 3000, "the changed-at timestamp tracks the last flip");

        conn.setOnline(true); // no-op
        assertEq(seen.length, 2, "a same-state set does not emit");
        off();
        win.fire("offline");
        assertEq(seen.length, 2, "unsubscribed listeners stop receiving");
        conn.stop();
        assertEq(win.count("offline"), 0, "stop removes the listeners");
      },
    },
    {
      name: "connectivity check() consults the browser flag and an optional reachability probe",
      fn: async () => {
        const win = fakeWin();
        const nav = { onLine: true };
        let probeOk = false;
        const conn = createConnectivity({
          win,
          nav,
          probe: async () => {
            if (!probeOk) throw new Error("cloud unreachable");
          },
        });
        conn.start();
        assertEq(await conn.check(), false, "browser online but probe failing → reported offline");
        probeOk = true;
        assertEq(await conn.check(), true, "probe succeeding → online");
        nav.onLine = false;
        assertEq(await conn.check(), false, "browser offline wins even with a passing probe");
        conn.stop();
      },
    },
    {
      name: "connectivity tracks the sync lifecycle",
      fn: async () => {
        let now = 10;
        const conn = createConnectivity({ win: fakeWin(), nav: { onLine: true }, now: () => now });
        assertEq(conn.state().syncing, false, "idle by default");
        conn.beginSync();
        assertEq(conn.state().syncing, true, "beginSync");
        now = 20;
        conn.endSync({ pushed: 2 });
        assertEq(conn.state().syncing, false, "endSync clears it");
        assertEq(conn.state().lastSyncAt, 20, "records when");
        assertEq(conn.state().lastResult.pushed, 2, "records the result");
      },
    },
    {
      name: "connectivitySummary gives the header pill its label and tone",
      fn: async () => {
        assertEq(connectivitySummary({ online: true }, 0).tone, "online", "online");
        assertEq(connectivitySummary({ online: true }, 0).label, "Online", "online label");
        assertEq(connectivitySummary({ syncing: true, online: true }, 0).tone, "syncing", "syncing wins");
        assertEq(connectivitySummary({ syncing: true, online: true }, 0).label, "Syncing…", "syncing label");
        assertEq(connectivitySummary({ online: true }, 3).tone, "pending", "pending while online");
        assertEq(connectivitySummary({ online: true }, 3).label, "3 to sync", "pending label");
        const offline = connectivitySummary({ online: false }, 2);
        assertEq(offline.tone, "offline", "offline tone");
        assertEq(offline.label, "Offline · 2 pending", "offline label carries the count");
        assertEq(connectivitySummary({ online: false }, 0).label, "Offline", "offline with nothing pending");
      },
    },
    {
      name: "field-checklist helpers set/toggle a step's completion immutably and stamp who/when",
      fn: async () => {
        const next = setChecklistStepDone(STEPS, "s1", true, { by: "carol", at: 5000 });
        assert(STEPS[0].done === false && STEPS[0].doneAt === null, "the input array is not mutated");
        const one = next.find((s) => s.id === "s1");
        assertEq(one.done, true, "step marked done");
        assertEq(one.doneAt, 5000, "stamped with the time");
        assertEq(one.doneBy, "carol", "stamped with the actor");
        assertEq(next.find((s) => s.id === "s2").done, false, "other steps untouched");

        const opened = setChecklistStepDone(next, "s1", false, { by: "carol" });
        const reopened = opened.find((s) => s.id === "s1");
        assertEq(reopened.done, false, "re-opened");
        assertEq(reopened.doneAt, null, "the stamp is cleared");
        assertEq(reopened.doneBy, "", "the actor is cleared");

        const toggled = toggleChecklistStep(opened, "s2", { by: "dave", at: 6000 });
        const s2 = toggled.find((s) => s.id === "s2");
        assertEq(s2.done, true, "toggle flips an open step to done");
        assertEq(s2.doneBy, "dave", "toggle stamps the actor");
        const back = toggleChecklistStep(toggled, "s2", { by: "dave" });
        assertEq(back.find((s) => s.id === "s2").done, false, "toggle flips it back");
      },
    },
    {
      name: "nextOpenStep walks to the next outstanding step",
      fn: async () => {
        assertEq(nextOpenStep(STEPS).id, "s1", "the first open step");
        assertEq(nextOpenStep(STEPS, "s1").id, "s2", "the step after s1");
        assertEq(nextOpenStep(STEPS, "s2"), null, "nothing open after s2 (s3 is done)");
        assertEq(nextOpenStep([], null), null, "empty list");
      },
    },
    {
      name: "parseQuickQuery splits filter tokens from free text",
      fn: async () => {
        const p = parseQuickQuery("vlan type:configurations client:acme");
        assertEq(p.text, "vlan", "free text kept");
        assertEq(p.filters.collection, "configurations", "type alias maps to the record collection");
        assertEq(p.filters.client, "acme", "client filter");
        assertEq(p.chips.length, 2, "one chip per filter");
        assertEq(p.chips[0].label, "Type", "chip label");

        const q = parseQuickQuery("switch model:flexible-asset prov:synced life:attention due:30");
        assertEq(q.text, "switch", "free text kept");
        assertEq(q.filters.informationModel, "flexible-asset", "model alias");
        assertEq(q.filters.provenance, "synced", "prov alias");
        assertEq(q.filters.lifecycle, "attention", "life alias");
        assertEq(q.filters.expiryDays, "30", "due alias");

        const plain = parseQuickQuery("10.0.0.1");
        assertEq(plain.text, "10.0.0.1", "an ordinary query is not mangled");
        assertEq(Object.keys(plain.filters).length, 0, "no filters parsed");
        const unknown = parseQuickQuery("http://example.com/x");
        assertEq(unknown.text, "http://example.com/x", "an unknown key:value stays as text");
      },
    },
    {
      name: "quickSearch narrows to a single client and returns only the top hits",
      fn: async () => {
        const index = fakeIndex();
        const all = quickSearch(index, "switch");
        assertEq(all.total, 2, "two switches across clients");
        assertEq(all.results.length, 2, "both fit the limit");

        const scoped = quickSearch(index, "switch client:acme");
        assertEq(scoped.total, 1, "client name resolves to the client id and narrows the hit");
        assertEq(scoped.results[0].name, "Core Switch", "the Acme switch");

        const byId = quickSearch(index, "switch client:docset-globex");
        assertEq(byId.total, 1, "a client id works too");
        assertEq(byId.results[0].client.id, "docset-globex", "the Globex switch");

        const typed = quickSearch(index, "vlan type:documents");
        assertEq(typed.total, 1, "type filter narrows");
        assertEq(typed.results[0].collection, "documents", "only documents");

        const limited = quickSearch(index, "", { limit: 2 });
        assertEq(limited.results.length, 2, "limit caps the returned rows");
        assert(limited.total >= 2, "total reports the true count");
      },
    },
    {
      name: "quickChips resolves filter values to their display labels",
      fn: async () => {
        const chips = quickChips("type:configurations model:core-asset prov:authored life:attention due:30");
        const byKey = Object.fromEntries(chips.map((c) => [c.key, c.display]));
        assertEq(byKey.collection, "Configurations", "record-type label");
        assertEq(byKey.informationModel, "Core Asset", "model label");
        assertEq(byKey.provenance, "Directly authored", "provenance label");
        assertEq(byKey.lifecycle, "Needs attention", "lifecycle label");
        assertEq(byKey.expiryDays, "30", "expiry shown as typed");
        assertEq(quickChips("type:nope")[0].display, "nope", "unknown value falls back to itself");
      },
    },
    {
      name: "offline: an edit with the cloud unreachable is staged, still readable locally, and reconciles on reconnect",
      fn: async () => {
        const { channel, cache, store, docs, sync } = makeWorld({ namespace: "kb-field", sync: true });
        const set = await docs.create({ name: "Acme Corp", createdBy: "alice" });
        const { record } = await docs.addRecord(
          set.id,
          { type: "organizations", name: "Acme HQ", ...CLASSIFIED, orgKind: "organization" },
          { updatedBy: "alice" },
        );

        // Simulate the connection dropping: every cloud put is refused.
        const origPut = channel.put.bind(channel);
        let online = true;
        channel.put = async (name, text) => {
          if (!online) throw new StoreError("STORAGE_UNAVAILABLE", "network offline");
          return origPut(name, text);
        };

        online = false;
        const res = await docs.updateRecord(
          set.id,
          { type: "organizations", id: record.id },
          { name: "Acme Headquarters" },
          { updatedBy: "alice" },
        );
        assertEq(res.staged, true, "the write reports it was staged, not failed");
        assertEq(res.record.name, "Acme Headquarters", "the in-memory record carries the edit");

        const local = await docs.get(set.id);
        assertEq(local.records.organizations[0].name, "Acme Headquarters", "the edit is readable locally at once");

        const drafts = await sync.listDrafts();
        assertEq(drafts.length, 1, "exactly one pending draft");
        assertEq(pendingDraftsSummary(drafts).count, 1, "the pill would show one pending change");

        const canonOffline = await store.readDocument(set.id, { force: true });
        assertEq(canonOffline.data.records.organizations[0].name, "Acme HQ", "the canonical is untouched while offline");

        // The connection returns; reconcile pushes the draft.
        online = true;
        const r = await sync.reconcile();
        assertEq(r.pushed, 1, "the draft was pushed on reconnect");
        assertEq((await sync.listDrafts()).length, 0, "no drafts left");
        const canon = await store.readDocument(set.id, { force: true });
        assertEq(canon.data.records.organizations[0].name, "Acme Headquarters", "the canonical now holds the field edit");
        assertEq(pendingDraftsSummary(await sync.listDrafts()).count, 0, "nothing pending");
        void cache;
      },
    },
  ]);
}
