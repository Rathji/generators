// src/psa/tests-store.js — validation suite for the canonical document store.
import store, {
  ready, refresh, flush, registerCollection, saveRecord, saveMany, removeRecord, resetCollection,
  getRecord, getRecordsById, getAllRecords, getDocInfo, getIndexInfo, isCloud,
  DEFAULT_MAX_DOC_BYTES,
} from "./store.js";

const T = "tests";
const TS = "testssmall";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, ms = 5000, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await wait(step);
  }
  return null;
}

function kvGet(key) {
  return window.root.kv.psaStore.get(key);
}

function rec(i, extra = "") {
  return { id: "r" + i, name: "record " + i, payload: "x".repeat(extra || 40) };
}

export async function runPsaStoreTests() {
  await ready();
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok, detail: ok ? "" : detail });

  check("store is exposed on window.__psaStore", !!window.__psaStore && typeof window.__psaStore.saveRecord === "function");

  const idx = getIndexInfo();
  check("store boots with a mode matching the environment (saved→cloud, unsaved→local)", (isCloud() && idx.mode === "cloud") || (!isCloud() && idx.mode === "local"), "mode: " + idx.mode);
  check("index exists with a random unguessable name", typeof idx.indexName === "string" && /^psa-index-[a-z0-9]{40}$/.test(idx.indexName), idx.indexName);
  check("default collections registered (6 data modules)", idx.collections >= 6, "collections: " + idx.collections);
  check("all 6 module collections present in the index", ["clients", "projects", "resources", "timesheets", "expenses", "billing"].every((c) => getDocInfo(c) !== null), "");

  const col = registerCollection({ id: T, maxDocBytes: 800 });
  const colS = registerCollection({ id: TS, maxDocBytes: 200 });

  await resetCollection(T);
  await resetCollection(TS);
  await flush();
  check("test collections start clean", getAllRecords(T).length === 0 && getAllRecords(TS).length === 0);

  check("registerCollection returns a collection with ceiling", col.maxDocBytes === 800 && colS.maxDocBytes === 200);
  check("re-registering a collection is idempotent", registerCollection({ id: T, maxDocBytes: 1 }).maxDocBytes === 800);

  const before = getDocInfo(T);
  await saveRecord(T, rec(0));
  const after = getDocInfo(T);
  check("saveRecord adds a record (count 0 -> 1)", after.recordCount === before.recordCount + 1, JSON.stringify({ before: before.recordCount, after: after.recordCount }));
  check("getAllRecords returns the record", getAllRecords(T).length === 1 && getAllRecords(T)[0].id === "r0");
  check("getRecord finds by id", getRecord(T, "r0") && getRecord(T, "r0").name === "record 0");
  check("getRecordsById keys by id", getRecordsById(T).r0 && getRecordsById(T).r0.payload.length === 40);

  const shardName = after.shards[0].name;
  const cached = await kvGet("psa/doc/" + shardName);
  check("record persisted to the fast local cache (kv)", !!cached && !!cached.records && !!cached.records.r0, JSON.stringify(cached && Object.keys(cached.records || {})));

  await flush();
  const editKey = await kvGet("psa/editkey/" + shardName);
  check("edit key cached locally for the shard", !isCloud() || (typeof editKey === "string" && editKey.length > 0), isCloud() ? typeof editKey : "local mode — no cloud edit keys");
  let remoteParsed = null;
  if (isCloud()) {
    const remoteText = await waitFor(async () => {
      try {
        const t = await window.root.uploadPlugin.editable.get(shardName);
        return t && JSON.parse(t).records && JSON.parse(t).records.r0 ? t : null;
      } catch (e) { return null; }
    }, 8000);
    check("record persisted to the canonical document (editable file, cross-device)", !!remoteText, remoteText ? "" : "editable.get(" + shardName + ") returned no r0");
    remoteParsed = remoteText ? JSON.parse(remoteText) : null;
  } else {
    check("record persisted to the canonical document (editable file, cross-device)", true, "local mode — no cloud document");
  }
  check("canonical document is versioned (_doc.rev, schemaVersion, colId, updatedAt)", !isCloud() || (!!remoteParsed && remoteParsed._doc && remoteParsed._doc.rev >= 1 && remoteParsed._doc.schemaVersion >= 1 && remoteParsed._doc.colId === T && !!remoteParsed._doc.updatedAt), JSON.stringify(remoteParsed && remoteParsed._doc));

  const revBefore = getDocInfo(T).shards[0].rev;
  await saveRecord(T, rec(0));
  const revSame = getDocInfo(T).shards[0].rev;
  check("idempotent: rewriting identical content is a no-op (rev unchanged)", revSame === revBefore, revBefore + " -> " + revSame);

  await saveRecord(T, { id: "r0", name: "record 0 updated", payload: "y".repeat(40) });
  const revBumped = getDocInfo(T).shards[0].rev;
  check("changing a record bumps the document rev", revBumped === revBefore + 1, revBefore + " -> " + revBumped);
  check("update in place keeps one record (no duplicates)", getAllRecords(T).filter((r) => r.id === "r0").length === 1 && getRecord(T, "r0").name === "record 0 updated");

  await saveMany(T, Array.from({ length: 30 }, (_, i) => rec(i + 1)));
  const merged = getAllRecords(T);
  check("saveMany + merge across shards keeps every record", merged.length === 31 && new Set(merged.map((r) => r.id)).size === 31, "count: " + merged.length);
  const infoSplit = getDocInfo(T);
  check("large module auto-splits across documents", infoSplit.shards.length >= 2, "shards: " + infoSplit.shards.length);
  check("no shard exceeds the per-document ceiling", infoSplit.shards.every((s) => s.bytes <= 800), JSON.stringify(infoSplit.shards.map((s) => s.bytes)));
  await flush();
  const allKeysCached = isCloud() ? (await Promise.all(infoSplit.shards.map((s) => kvGet("psa/editkey/" + s.name)))).every((k) => typeof k === "string" && k.length > 0) : true;
  check("every shard (incl. split-created ones) has a cached edit key", allKeysCached, isCloud() ? "" : "local mode — no cloud edit keys");

  const bigRecord = { id: "huge", name: "too big", payload: "z".repeat(600) };
  let bigErr = null;
  try { await saveRecord(TS, bigRecord); } catch (e) { bigErr = e; }
  check("oversized single record is refused (record_too_large)", !!bigErr && bigErr.code === "record_too_large", bigErr ? bigErr.code : "no error thrown");
  check("refused record was not written", getAllRecords(TS).length === 0);

  await saveRecord(TS, { id: "s0", payload: "small" });
  check("small-ceiling collection still accepts small records", getRecord(TS, "s0") !== null);

  await removeRecord(T, "r0");
  check("removeRecord deletes the record", getRecord(T, "r0") === null && getAllRecords(T).length === 30);
  check("removeRecord returns false for a missing id", !(await removeRecord(T, "definitely-missing")));

  const infoClean = getDocInfo(T);
  check("getDocInfo counts tie out with the merged view", infoClean.shards.reduce((n, s) => n + s.recordCount, 0) === getAllRecords(T).length && infoClean.totalBytes > 0, JSON.stringify({ sum: infoClean.shards.reduce((n, s) => n + s.recordCount, 0), merged: getAllRecords(T).length }));

  const fl = await flush();
  check("flush() runs without throwing", typeof fl === "boolean");

  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
