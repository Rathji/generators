// src/psa/backup.js — one-click full backup (downloadable file + published
// backup document) and validated restore. Restores are validated before they
// replace live data, and every write goes through the store's idempotent
// save path, so re-restoring identical content is a safe no-op.

import store from "./store.js";
import { downloadFile, toast } from "./core.js";
import { ALL_COLLECTION_IDS } from "./collections.js";
import { defaultCurrency } from "./derive.js";

export const BACKUP_VERSION = 1;

function randName(len = 32) {
  const A = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < len; i++) s += A[arr[i] % A.length];
  return s;
}

export async function buildBackup() {
  await store.ready();
  const collections = {};
  for (const id of ALL_COLLECTION_IDS) {
    collections[id] = store.getAllRecords(id);
  }
  return {
    app: "business-psa",
    kind: "psa-backup",
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    generator: window.generatorName || null,
    currency: defaultCurrency(),
    settings: window.__psaSettings || null,
    collections,
  };
}

export async function downloadBackup() {
  const backup = await buildBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile("psa-backup-" + stamp + ".json", JSON.stringify(backup, null, 2), "application/json");
  return backup;
}

export async function publishBackup() {
  const backup = await buildBackup();
  const name = "psa-backup-" + randName();
  const created = await window.root.uploadPlugin.editable.set(name, JSON.stringify(backup));
  if (created.error) throw new Error(created.error);
  const meta = { name, at: backup.createdAt, editKey: created.editKey || null, counts: Object.fromEntries(Object.entries(backup.collections).map(([k, v]) => [k, v.length])), url: "https://editable.uploads.dev/file/" + (window.generatorName || "unknown") + "/" + name };
  let list = [];
  try { list = (await window.root.kv.psaStore.get("psa/backups")) || []; } catch (e) {}
  list.push(meta);
  try { await window.root.kv.psaStore.set("psa/backups", list.slice(-20)); } catch (e) {}
  toast("Backup published to the backup document");
  return meta;
}

export async function listBackups() {
  try { return (await window.root.kv.psaStore.get("psa/backups")) || []; } catch (e) { return []; }
}

export function validateBackup(raw) {
  const errors = [];
  let data = raw;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { return { ok: false, errors: ["The file is not valid JSON."], summary: null }; }
  }
  if (!data || typeof data !== "object") return { ok: false, errors: ["Backup must be a JSON object."], summary: null };
  if (data.app !== "business-psa" || data.kind !== "psa-backup") {
    return { ok: false, errors: ["This doesn't look like a PSA backup (wrong app/kind marker)."], summary: null };
  }
  if (!data.collections || typeof data.collections !== "object") {
    return { ok: false, errors: ["Backup has no collections payload."], summary: null };
  }
  const cfg = store.getCollectionConfig();
  const counts = {};
  for (const id of Object.keys(data.collections)) {
    const recs = data.collections[id];
    if (!Array.isArray(recs)) { errors.push("Collection “" + id + "” is not an array."); continue; }
    counts[id] = recs.length;
    for (const r of recs) {
      if (!r || typeof r.id !== "string" || !r.id) { errors.push("Collection “" + id + "” has a record without a string id."); break; }
    }
    if (cfg[id] && recs.some((r) => JSON.stringify(r).length > cfg[id].maxDocBytes)) {
      errors.push("Collection “" + id + "” contains a record larger than its document ceiling.");
    }
  }
  return { ok: errors.length === 0, errors, summary: { counts, version: data.version, createdAt: data.createdAt, settings: data.settings } };
}

export async function restoreBackup(raw, opts = {}) {
  const v = validateBackup(raw);
  if (!v.ok) return { ok: false, errors: v.errors };
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  await store.ready();
  const results = {};
  for (const id of Object.keys(data.collections)) {
    try {
      const res = await store.replaceCollection(id, data.collections[id], { flush: false });
      results[id] = { count: res.count, unchanged: !!res.unchanged };
    } catch (e) {
      results[id] = { error: e && e.message };
    }
  }
  if (data.settings) {
    try { window.__psaSettings = Object.assign({}, window.__psaSettings, data.settings); await window.root.kv.psaStore.set("psa/appsettings", window.__psaSettings); } catch (e) {}
  }
  if (opts.flush !== false) await store.flush();
  const failed = Object.values(results).filter((r) => r.error);
  return { ok: failed.length === 0, results, summary: v.summary };
}

export async function fetchPublishedBackup(name) {
  const text = await window.root.uploadPlugin.editable.get(name);
  if (text == null) throw new Error("The published backup document is no longer available.");
  return JSON.parse(text);
}
