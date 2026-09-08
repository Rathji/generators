// src/psa/store.js — Canonical document store (Task 2).
//
// Every module's data lives in versioned JSON documents under the PSA storage
// namespace (per-generator editable files). Each module gets its own document
// (a "shard"); when a module grows past the per-document ceiling it is split
// across more shards automatically. Writes are versioned (rev), idempotent
// (rewriting identical content is a no-op), and refuse to exceed the storage
// ceiling. Edit keys are cached locally (kv + localStorage) so writes keep
// working across reloads, and a fast local cache (kv) makes startup instant
// while the canonical copy syncs in the background. While the generator is
// unsaved (no public namespace yet) the store degrades to local-only mode and
// every record is still durable in the local cache.
//
// Write path: mutations apply immediately to in-memory state and the kv cache
// (fast, never blocks the UI), then a debounced background loop coalesces each
// dirty document into a single remote write. Editable files allow one commit
// per name per ~10s, so the loop spaces out writes per name and always sends
// the latest content — a burst of edits costs one remote write, not one per
// edit. `flush()` awaits a full sync cycle (used by tests and "Sync now").
//
// The bootstrap "index" document maps module id -> shard names. Its own name is
// random and remembered in local storage; losing it means a fresh install.

const KV_BOOT = "psa/boot";
const LS_BOOT = "psa.boot";
const KV_INDEX = "psa/index";
const KV_DOC_PREFIX = "psa/doc/";
const KV_KEY_PREFIX = "psa/editkey/";

export const STORE_VERSION = 1;
export const DEFAULT_MAX_DOC_BYTES = 262144;
const SYNC_INTERVAL_MS = 10000;
const SYNC_DEBOUNCE_MS = 400;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randName(len = 40) {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[arr[i] % ALPHABET.length];
  return s;
}

function utf8Size(str) {
  return new TextEncoder().encode(str).length;
}

const nowIso = () => new Date().toISOString();

function storeError(code, message, fatal = false) {
  const e = new Error(message);
  e.code = code;
  if (fatal) e.fatal = true;
  return e;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kv = () => window.root.kv.psaStore;
const up = () => window.root.uploadPlugin;

const state = {
  mode: "local",
  ready: false,
  readyPromise: null,
  index: null,
  indexName: null,
  indexEditKey: null,
  indexDirty: false,
  collections: {},
  shards: {},
  listeners: [],
  lastSyncAt: {},
  syncTimer: null,
  syncInFlight: null,
};

function emptyIndex() {
  return { _doc: { schemaVersion: STORE_VERSION, rev: 0, createdAt: nowIso(), updatedAt: nowIso() }, collections: {} };
}

function normalizeIndex(raw) {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const d = raw._doc || {};
  const collections = {};
  if (raw.collections && typeof raw.collections === "object") {
    for (const k of Object.keys(raw.collections)) {
      const c = raw.collections[k];
      collections[k] = { shards: Array.isArray(c && c.shards) ? c.shards.slice() : [] };
    }
  }
  return { _doc: { schemaVersion: Number(d.schemaVersion) || STORE_VERSION, rev: Number(d.rev) || 0, createdAt: d.createdAt || null, updatedAt: d.updatedAt || null }, collections };
}

function normalizeDoc(raw) {
  if (!raw || typeof raw !== "object") throw storeError("bad_doc", "Malformed document payload.");
  const d = raw._doc || {};
  const records = raw.records && typeof raw.records === "object" ? raw.records : {};
  return { rev: Number(d.rev) || 0, createdAt: d.createdAt || null, updatedAt: d.updatedAt || null, colId: d.colId || null, records };
}

function emptyShard(name, colId) {
  return { name, colId, rev: 0, createdAt: nowIso(), updatedAt: null, records: {}, lastJson: null, editKey: null, remoteExists: false, synced: true, dirty: false, inConflict: false };
}

function shardDoc(shard) {
  return { _doc: { schemaVersion: STORE_VERSION, colId: shard.colId, rev: shard.rev, createdAt: shard.createdAt, updatedAt: shard.updatedAt }, records: shard.records };
}

function shardJson(shard) {
  return JSON.stringify(shardDoc(shard));
}

function shardBytes(shard) {
  return utf8Size(shardJson(shard));
}

function handleRemoteError(error) {
  if (error === "editable_requires_saved_generator") {
    state.mode = "local";
    return "local";
  }
  if (error === "over_daily_allowance") {
    throw storeError("quota", "Daily storage allowance reached. Try again later, or archive older data to reduce volume.", true);
  }
  if (error === "file_too_big") {
    throw storeError("doc_too_large", "Document is too large for the storage ceiling.", true);
  }
  if (error === "edit_key_required" || error === "invalid_edit_key") {
    throw storeError("lost_edit_key", "This document's edit key is missing or wrong, so it can't be updated. Restore from a backup to regain write access.", true);
  }
  if (error === "invalid_editable_name") {
    throw storeError("invalid_doc_name", "This document's storage name is invalid (lowercase letters, numbers and hyphens only).", true);
  }
  throw storeError("remote_write_failed", "Writing to cloud storage failed: " + error);
}

async function saveBoot(boot) {
  try { await kv().set(KV_BOOT, boot); } catch (e) {}
  try { localStorage.setItem(LS_BOOT, JSON.stringify(boot)); } catch (e) {}
}

async function ensureBoot() {
  let boot = null;
  try { boot = await kv().get(KV_BOOT); } catch (e) {}
  if (!boot) {
    try { boot = JSON.parse(localStorage.getItem(LS_BOOT) || "null"); } catch (e) {}
  }
  if (!boot || !boot.indexName) {
    boot = { v: STORE_VERSION, indexName: "psa-index-" + randName(40), indexEditKey: null };
    await saveBoot(boot);
  }
  state.indexName = boot.indexName;
  state.indexEditKey = boot.indexEditKey || null;
}

async function loadIndex() {
  let cache = null;
  try { cache = await kv().get(KV_INDEX); } catch (e) {}
  state.index = cache ? normalizeIndex(cache) : emptyIndex();
  if (isCloud()) {
    try {
      const remote = await up().editable.get(state.indexName);
      if (remote != null) {
        const parsed = normalizeIndex(JSON.parse(remote));
        if (parsed._doc.rev >= state.index._doc.rev) {
          state.index = parsed;
          state.indexDirty = false;
          try { await kv().set(KV_INDEX, parsed); } catch (e) {}
        } else {
          state.indexDirty = true;
        }
      }
    } catch (e) {
      state.indexDirty = state.index._doc.rev > 0;
    }
  }
}

async function loadAllShardCaches() {
  for (const colId of Object.keys(state.index.collections)) {
    for (const name of state.index.collections[colId].shards) {
      await loadShardCache(name, colId);
    }
  }
}

async function loadShardCache(name, colId) {
  try {
    const cached = await kv().get(KV_DOC_PREFIX + name);
    if (cached && cached.records && typeof cached.records === "object") {
      const editKey = await kv().get(KV_KEY_PREFIX + name);
      state.shards[name] = {
        name, colId,
        rev: Number(cached.rev) || 0,
        createdAt: cached.createdAt || null,
        updatedAt: cached.updatedAt || null,
        records: cached.records,
        lastJson: null,
        editKey: editKey || null,
        remoteExists: true,
        synced: true,
        dirty: false,
        inConflict: false,
      };
    }
  } catch (e) {}
}

function ensureShard(name, colId) {
  if (!state.shards[name]) state.shards[name] = emptyShard(name, colId);
  return state.shards[name];
}

function collectionShards(colId) {
  const col = state.collections[colId];
  if (!col) throw storeError("unknown_collection", "No collection registered for '" + colId + "'.");
  const entry = state.index.collections[colId] || { shards: [] };
  return entry.shards.map((name) => ensureShard(name, colId));
}

function pickShardFor(colId, recordId) {
  const shards = collectionShards(colId);
  if (!shards.length) {
    const name = "psa-" + colId + "-s-" + randName(40);
    state.index.collections[colId].shards.push(name);
    state.indexDirty = true;
    return ensureShard(name, colId);
  }
  for (const s of shards) if (s.records[recordId] != null) return s;
  let best = null;
  for (const s of shards) {
    if (s.inConflict) continue;
    if (!best || shardBytes(s) < shardBytes(best)) best = s;
  }
  if (!best) best = shards[0];
  return best;
}

// ---- local persistence (fast, never blocks the UI) ----

async function persistShardLocally(name) {
  const shard = state.shards[name];
  try {
    await kv().set(KV_DOC_PREFIX + name, { rev: shard.rev, createdAt: shard.createdAt, updatedAt: shard.updatedAt, records: shard.records });
  } catch (e) {}
}

function markShardDirty(name) {
  const shard = state.shards[name];
  if (!shard) return;
  shard.synced = false;
  shard.dirty = true;
  scheduleSync();
}

function markIndexDirty() {
  state.indexDirty = true;
  scheduleSync();
}

// ---- remote sync loop (coalesced, spaced per name) ----

function dirtyNames() {
  const names = Object.keys(state.shards).filter((n) => {
    const s = state.shards[n];
    return s.dirty && !s.inConflict;
  });
  if (state.indexDirty) names.push("__index__");
  return names;
}

export function pendingConflicts() {
  const col = state.collections.conflicts;
  if (!col) return [];
  return getAllRecords("conflicts")
    .filter((c) => c.status === "pending")
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

export function getSyncState() {
  const shards = Object.keys(state.shards).map((name) => {
    const s = state.shards[name];
    return {
      name, colId: s.colId, rev: s.rev, dirty: s.dirty, synced: s.synced,
      inConflict: !!s.inConflict, bytes: shardBytes(s), recordCount: Object.keys(s.records).length,
      error: s.syncError || null,
    };
  });
  return { mode: state.mode, indexName: state.indexName, indexDirty: state.indexDirty, shards };
}

function remainingCooldown(name) {
  const last = state.lastSyncAt[name] || 0;
  return Math.max(0, SYNC_INTERVAL_MS - (Date.now() - last));
}

function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  if (state.syncTimer) clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    state.syncTimer = null;
    runSync();
  }, delay);
}

async function runSync() {
  if (state.syncInFlight) return state.syncInFlight;
  state.syncInFlight = (async () => {
    const names = dirtyNames();
    let deferred = false;
    for (const name of names) {
      if (remainingCooldown(name) > 0) { deferred = true; continue; }
      try {
        await syncName(name);
      } catch (e) {
        console.warn("[psa] sync failed for " + name + ":", e && e.message);
        if (name !== "__index__" && e && e.fatal) {
          const shard = state.shards[name];
          if (shard) {
            shard.dirty = false;
            shard.syncError = { code: e.code, message: e.message };
          }
        }
      }
    }
    if (dirtyNames().length || deferred) {
      const waits = dirtyNames().map(remainingCooldown);
      scheduleSync(Math.min(3000, Math.max(120, ...waits)));
    }
  })().finally(() => { state.syncInFlight = null; });
  return state.syncInFlight;
}

async function syncName(name) {
  if (name === "__index__") {
    await syncIndexRemote();
    return;
  }
  const shard = state.shards[name];
  if (!shard || !shard.dirty) return;
  if (shard.inConflict) return;
  const json = shardJson(shard);
  if (shard.lastJson === json) {
    shard.dirty = false;
    shard.synced = true;
    return;
  }
  const col = state.collections[shard.colId];
  if (utf8Size(json) > (col ? col.maxDocBytes : DEFAULT_MAX_DOC_BYTES)) {
    shard.dirty = false;
    throw storeError("doc_too_large", "Document '" + name + "' is too large for the storage ceiling. Split it into more records or archive older ones.");
  }
  if (isCloud()) {
    await persistRemoteShard(shard, json);
    state.lastSyncAt[name] = Date.now();
  }
  shard.lastJson = json;
  shard.synced = true;
  shard.dirty = false;
}

async function syncIndexRemote() {
  if (!state.indexDirty) return;
  state.index._doc.rev += 1;
  state.index._doc.updatedAt = nowIso();
  const json = JSON.stringify(state.index);
  try { await kv().set(KV_INDEX, state.index); } catch (e) {}
  if (!isCloud()) {
    state.indexDirty = false;
    return;
  }
  try {
    if (state.indexEditKey == null) {
      const created = await up().editable.set(state.indexName, json);
      if (created.error) { handleRemoteError(created.error); return; }
      if (created.editKey) {
        state.indexEditKey = created.editKey;
        await saveBoot({ v: STORE_VERSION, indexName: state.indexName, indexEditKey: created.editKey });
      }
    } else {
      const res = await up().editable.set(state.indexName, json, { editKey: state.indexEditKey });
      if (res.error) { handleRemoteError(res.error); return; }
    }
    state.indexDirty = false;
    state.lastSyncAt.__index__ = Date.now();
  } catch (e) {
    console.warn("[psa] index sync failed:", e && e.message);
    if (e && e.fatal) {
      state.indexDirty = false;
      state.indexSyncError = { code: e.code, message: e.message };
    }
  }
}

async function persistRemoteShard(shard, json) {
  let key = shard.editKey;
  if (key == null) {
    try { key = await kv().get(KV_KEY_PREFIX + shard.name); } catch (e) {}
  }
  if (key == null) {
    if (shard.remoteExists) {
      throw storeError("lost_edit_key", "This document exists online but its local edit key is missing, so it can't be updated. Restore from a backup to regain write access.");
    }
    const created = await up().editable.set(shard.name, json);
    if (created.error) return handleRemoteError(created.error);
    if (created.editKey) {
      shard.editKey = created.editKey;
      try { await kv().set(KV_KEY_PREFIX + shard.name, created.editKey); } catch (e) {}
    }
    shard.remoteExists = true;
    return "ok";
  }
  const res = await up().editable.set(shard.name, json, { editKey: key });
  if (res.error) return handleRemoteError(res.error);
  shard.remoteExists = true;
  return "ok";
}

// ---- mutations ----

export async function saveRecord(colId, record) {
  await ready();
  if (!record || typeof record.id !== "string" || !record.id) throw storeError("bad_record", "Records need a non-empty string 'id'.");
  const col = state.collections[colId];
  if (!col) throw storeError("unknown_collection", "No collection registered for '" + colId + "'.");
  const recordBytes = utf8Size(JSON.stringify(record));
  if (recordBytes > col.maxDocBytes) {
    throw storeError("record_too_large", "This record (" + recordBytes + " bytes) is larger than the document ceiling for '" + colId + "' (" + col.maxDocBytes + " bytes). Split it into smaller records.");
  }
  const shard = pickShardFor(colId, record.id);
  const existing = shard.records[record.id];
  if (existing && JSON.stringify(existing) === JSON.stringify(record)) {
    return record;
  }
  shard.records[record.id] = record;
  shard.rev += 1;
  shard.updatedAt = nowIso();
  if (shardBytes(shard) > col.maxDocBytes) {
    await splitShard(colId, shard.name);
  } else {
    await persistShardLocally(shard.name);
    markShardDirty(shard.name);
  }
  notify(colId, "put", record.id);
  return record;
}

export async function saveMany(colId, records) {
  for (const r of records) await saveRecord(colId, r);
  return records.length;
}

export async function removeRecord(colId, id) {
  await ready();
  const shards = collectionShards(colId);
  for (const s of shards) {
    if (s.records[id] != null) {
      delete s.records[id];
      s.rev += 1;
      s.updatedAt = nowIso();
      await persistShardLocally(s.name);
      markShardDirty(s.name);
      notify(colId, "delete", id);
      return true;
    }
  }
  return false;
}

export async function resetCollection(colId) {
  await ready();
  const entry = state.index.collections[colId];
  if (!entry) return;
  const names = entry.shards.slice();
  entry.shards = [];
  for (const name of names) {
    const shard = state.shards[name];
    if (shard) {
      shard.records = {};
      await persistShardLocally(name);
      markShardDirty(name);
    }
  }
  markIndexDirty();
  notify(colId, "reset", null);
}

async function splitShard(colId, name) {
  const shard = state.shards[name];
  const entries = Object.entries(shard.records);
  if (entries.length <= 1) {
    throw storeError("doc_too_large", "Document '" + name + "' is too large and cannot be split further.");
  }
  const half = Math.ceil(entries.length / 2);
  const newName = "psa-" + colId + "-s-" + randName(40);
  const newShard = emptyShard(newName, colId);
  for (let i = half; i < entries.length; i++) {
    newShard.records[entries[i][0]] = entries[i][1];
    delete shard.records[entries[i][0]];
  }
  newShard.rev += 1;
  newShard.updatedAt = nowIso();
  shard.rev += 1;
  shard.updatedAt = nowIso();
  state.shards[newName] = newShard;
  state.index.collections[colId].shards.push(newName);
  await persistShardLocally(newName);
  markShardDirty(newName);
  await persistShardLocally(name);
  markShardDirty(name);
  markIndexDirty();
}

// ---- reads ----

export function registerCollection(opts) {
  const id = opts.id;
  if (!id || typeof id !== "string") throw storeError("bad_collection", "Collection id is required.");
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw storeError("bad_collection", "Collection id '" + id + "' may only contain lowercase letters, numbers and hyphens.");
  }
  if (!state.collections[id]) {
    state.collections[id] = { id, maxDocBytes: opts.maxDocBytes || DEFAULT_MAX_DOC_BYTES };
  }
  if (!state.index.collections[id]) state.index.collections[id] = { shards: [] };
  return state.collections[id];
}

export const DEFAULT_COLLECTIONS = ["clients", "projects", "resources", "timesheets", "expenses", "billing"];

export function getRecordsById(colId) {
  const out = {};
  for (const s of collectionShards(colId)) Object.assign(out, s.records);
  return out;
}

export function getAllRecords(colId) {
  return Object.values(getRecordsById(colId));
}

export function getRecord(colId, id) {
  return getRecordsById(colId)[id] || null;
}

export function getDocInfo(colId) {
  const shards = collectionShards(colId);
  const info = { colId, shards: [], totalBytes: 0, recordCount: 0 };
  for (const s of shards) {
    const b = shardBytes(s);
    info.shards.push({ name: s.name, rev: s.rev, recordCount: Object.keys(s.records).length, bytes: b, synced: s.synced, dirty: s.dirty, error: s.syncError || null });
    info.totalBytes += b;
    info.recordCount += Object.keys(s.records).length;
  }
  return info;
}

export function getIndexInfo() {
  return {
    mode: state.mode,
    indexName: state.indexName,
    indexRev: state.index._doc.rev,
    indexDirty: state.indexDirty,
    indexSyncError: state.indexSyncError || null,
    collections: Object.keys(state.collections).length,
    shardCount: Object.keys(state.shards).length,
  };
}

export function isCloud() {
  return state.mode === "cloud";
}

export function onChange(fn) {
  state.listeners.push(fn);
}

function notify(colId, op, id) {
  for (const fn of state.listeners) {
    try { fn({ colId, op, id }); } catch (e) {}
  }
}

// ---- lifecycle ----

export async function ready() {
  if (state.ready) return state;
  if (!state.readyPromise) state.readyPromise = init();
  return state.readyPromise;
}

async function init() {
  state.mode = window.generatorIsUnsaved ? "local" : "cloud";
  state.index = emptyIndex();
  for (const id of DEFAULT_COLLECTIONS) registerCollection({ id });
  registerCollection({ id: "conflicts" });
  await ensureBoot();
  await loadIndex();
  await loadAllShardCaches();
  markConflictedFromPersisted();
  state.ready = true;
  return state;
}

export async function refresh() {
  await ready();
  if (!isCloud()) return state;
  try {
    const remote = await up().editable.get(state.indexName);
    if (remote != null) {
      const parsed = normalizeIndex(JSON.parse(remote));
      if (parsed._doc.rev > state.index._doc.rev) {
        state.index = parsed;
        state.indexDirty = false;
        try { await kv().set(KV_INDEX, parsed); } catch (e) {}
      }
    }
  } catch (e) {}
  for (const colId of Object.keys(state.index.collections)) {
    for (const name of state.index.collections[colId].shards) {
      try {
        const cached = state.shards[name];
        const remote = await up().editable.get(name);
        if (remote == null) continue;
        const parsed = normalizeDoc(JSON.parse(remote));
        if (cached && !cached.synced) {
          if (parsed.rev > localRev && !cached.inConflict) {
            try { await recordConflict(cached, parsed); } catch (e) { console.warn("[psa] conflict record failed:", e && e.message); }
          }
          continue;
        }
        const localRev = cached ? cached.rev : 0;
        if (parsed.rev > localRev) {
          const shard = cached || ensureShard(name, colId);
          shard.rev = parsed.rev;
          shard.createdAt = parsed.createdAt;
          shard.updatedAt = parsed.updatedAt;
          shard.records = parsed.records;
          shard.lastJson = null;
          shard.remoteExists = true;
          shard.synced = true;
          shard.dirty = false;
          try {
            await kv().set(KV_DOC_PREFIX + name, { rev: shard.rev, createdAt: shard.createdAt, updatedAt: shard.updatedAt, records: shard.records });
          } catch (e) {}
        } else if (!cached) {
          const shard = ensureShard(name, colId);
          shard.records = parsed.records;
          shard.rev = parsed.rev;
          shard.createdAt = parsed.createdAt;
          shard.updatedAt = parsed.updatedAt;
          shard.lastJson = null;
          shard.remoteExists = true;
          shard.synced = true;
          shard.dirty = false;
          try {
            await kv().set(KV_DOC_PREFIX + name, { rev: shard.rev, createdAt: shard.createdAt, updatedAt: shard.updatedAt, records: shard.records });
          } catch (e) {}
        }
      } catch (e) {}
    }
  }
  return state;
}

export async function flush() {
  await ready();
  if (state.syncTimer) { clearTimeout(state.syncTimer); state.syncTimer = null; }
  let attempts = 0;
  while (dirtyNames().length && attempts++ < 80) {
    const waits = dirtyNames().map(remainingCooldown);
    const max = Math.max(0, ...waits);
    if (max > 0) await sleep(max + 50);
    await runSync();
  }
  return !dirtyNames().length;
}

// ---- conflict handling (Task 3) ----

function conflictIdFor(shardName, remoteRev) {
  return "cf-" + shardName + "@" + remoteRev;
}

async function recordConflict(shard, remoteParsed) {
  const id = conflictIdFor(shard.name, remoteParsed.rev);
  const existing = getRecord("conflicts", id);
  if (existing) return existing;
  const doc = {
    id,
    kind: "conflict",
    shardName: shard.name,
    colId: shard.colId,
    localRev: shard.rev,
    remoteRev: remoteParsed.rev,
    localRecords: shard.records,
    remoteRecords: remoteParsed.records,
    remoteUpdatedAt: remoteParsed.updatedAt || null,
    localUpdatedAt: shard.updatedAt || null,
    status: "pending",
    resolution: null,
    resolvedAt: null,
    resolvedBy: null,
    perRecord: null,
    createdAt: nowIso(),
  };
  await saveRecord("conflicts", doc);
  shard.inConflict = true;
  notify(shard.colId, "conflict", shard.name);
  return doc;
}

function markConflictedFromPersisted() {
  for (const c of getAllRecords("conflicts")) {
    if (c.status !== "pending") continue;
    const shard = state.shards[c.shardName];
    if (shard) shard.inConflict = true;
  }
}

function applyMergedRecords(conflict) {
  const out = {};
  const both = new Set([...Object.keys(conflict.localRecords), ...Object.keys(conflict.remoteRecords)]);
  for (const id of both) {
    const l = conflict.localRecords[id];
    const r = conflict.remoteRecords[id];
    if (l != null && r == null) { out[id] = l; continue; }
    if (r != null && l == null) { out[id] = r; continue; }
    const same = JSON.stringify(l) === JSON.stringify(r);
    if (same) { out[id] = l; continue; }
    const changedLocally = JSON.stringify(l) !== JSON.stringify(conflict.snapshotRecords ? conflict.snapshotRecords[id] : l);
    const changedRemotely = !conflict.snapshotRecords || JSON.stringify(r) !== JSON.stringify(conflict.snapshotRecords[id]);
    if (changedLocally && !changedRemotely) { out[id] = l; continue; }
    if (!changedLocally && changedRemotely) { out[id] = r; continue; }
    const choice = conflict.perRecord && conflict.perRecord[id];
    out[id] = choice === "theirs" ? r : l;
  }
  return out;
}

export async function resolveConflict(conflictId, resolution, opts = {}) {
  await ready();
  const conflict = getRecord("conflicts", conflictId);
  if (!conflict) throw storeError("unknown_conflict", "That conflict is no longer in the queue.");
  if (conflict.status === "resolved") return conflict;
  const shard = state.shards[conflict.shardName];
  if (!shard) throw storeError("unknown_conflict", "The document behind this conflict is missing.");
  const updates = {
    resolution,
    resolvedAt: nowIso(),
    resolvedBy: opts.resolvedBy || "local",
    perRecord: opts.perRecord || conflict.perRecord || null,
  };
  if (resolution === "keep-mine") {
    shard.inConflict = false;
    shard.dirty = true;
    shard.synced = false;
    if (shard.rev <= conflict.remoteRev) shard.rev = conflict.remoteRev + 1;
    updates.outcome = "local content pushed to cloud; remote's version kept in this record for reference.";
  } else if (resolution === "keep-theirs") {
    shard.records = conflict.remoteRecords;
    shard.rev = conflict.remoteRev;
    shard.inConflict = false;
    shard.dirty = false;
    shard.synced = true;
    shard.lastJson = null;
    await persistShardLocally(shard.name);
    updates.outcome = "cloud content adopted; local version kept in this record for reference.";
  } else if (resolution === "merge") {
    const merged = applyMergedRecords(conflict);
    shard.records = merged;
    shard.rev = Math.max(conflict.localRev, conflict.remoteRev) + 1;
    shard.inConflict = false;
    shard.dirty = true;
    shard.synced = false;
    await persistShardLocally(shard.name);
    updates.outcome = "field-level merge applied; merged content pushed to cloud.";
  } else {
    throw storeError("bad_resolution", "Resolution must be keep-mine, keep-theirs or merge.");
  }
  const saved = await saveRecord("conflicts", Object.assign({}, conflict, updates, { status: "resolved" }));
  notify(conflict.colId, "conflict-resolved", conflict.shardName);
  return saved;
}

export function getCollectionConfig() {
  const out = {};
  for (const id of Object.keys(state.collections)) {
    out[id] = { id, maxDocBytes: state.collections[id].maxDocBytes, recordCount: getAllRecords(id).length };
  }
  return out;
}

export async function replaceCollection(colId, records, opts = {}) {
  await ready();
  const col = state.collections[colId];
  if (!col) throw storeError("unknown_collection", "No collection registered for '" + colId + "'.");
  if (!Array.isArray(records)) throw storeError("bad_records", "Records must be an array.");
  for (const r of records) {
    if (!r || typeof r.id !== "string" || !r.id) throw storeError("bad_records", "Every record needs a non-empty string 'id'.");
    if (utf8Size(JSON.stringify(r)) > col.maxDocBytes) {
      throw storeError("record_too_large", "A record in the restore is larger than the ceiling for '" + colId + "'.");
    }
  }
  const current = getAllRecords(colId);
  const same =
    current.length === records.length &&
    current.every((r) => records.some((n) => n.id === r.id && JSON.stringify(n) === JSON.stringify(r)));
  if (same) return { unchanged: true, count: records.length };
  const currentIds = new Set(current.map((r) => r.id));
  const incomingIds = new Set(records.map((r) => r.id));
  for (const id of currentIds) if (!incomingIds.has(id)) await removeRecord(colId, id);
  for (const r of records) await saveRecord(colId, r);
  if (opts.flush !== false) await flush();
  return { unchanged: false, count: records.length };
}

export const store = {
  ready,
  refresh,
  flush,
  registerCollection,
  saveRecord,
  saveMany,
  removeRecord,
  resetCollection,
  getRecord,
  getRecordsById,
  getAllRecords,
  getDocInfo,
  getIndexInfo,
  getSyncState,
  getCollectionConfig,
  replaceCollection,
  pendingConflicts,
  resolveConflict,
  onChange,
  isCloud,
  STORE_VERSION,
  DEFAULT_MAX_DOC_BYTES,
  DEFAULT_COLLECTIONS,
};

export default store;
