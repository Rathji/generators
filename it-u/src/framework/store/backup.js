// src/framework/store/backup.js — full backup & validated restore
// (roadmap Phase 1, task 5).
//
// A "backup" is ONE JSON envelope holding every documentation set exactly as
// it is stored — each client's whole record set plus a small manifest of the
// versions/hashes the backup was taken from. It can be:
//   • downloaded as a file,
//   • published as a hosted "backup document" (so it survives the device), and
//   • restored from either, after VALIDATION — a backup is never applied until
//     its schema, its records (classification) and its relationship graph have
//     been checked, and restore is IDEMPOTENT (a store write of identical
//     content is a free no-op, so re-restoring the same backup changes
//     nothing).
//
// Restore supports two modes:
//   • merge (default) — per-record union by id, newer `updatedAt` wins, local
//     records are never dropped. Safe to run repeatedly / on a live set.
//   • replace — the backed-up document becomes the set verbatim.
//
// The service is deliberately free of DOM/browser assumptions (download() is
// the only method that touches the browser), so the whole flow is testable
// against the in-memory store.

import { StoreError, CODES } from "./errors.js";
import { hashString } from "./chunking.js";
import { RECORD_TYPES, CLASSIFIED_TYPES } from "../docsets.js";
import { validateClassification } from "../classification.js";
import { checkIntegrity } from "../relationships.js";

export const BACKUP_SCHEMA = "itu-backup/1";
export const BACKUP_KIND = "itu-documentation-backup";
export const BACKUP_PREFIX = "backup-";

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// Count every entity record across every type (relationships counted apart).
export function countRecords(set) {
  if (!set || !isObj(set.records)) return { records: 0, relationships: 0, byType: {} };
  const byType = {};
  let records = 0;
  let relationships = 0;
  for (const t of RECORD_TYPES) {
    const n = Array.isArray(set.records[t]) ? set.records[t].length : 0;
    byType[t] = n;
    if (t === "relationships") relationships += n;
    else records += n;
  }
  return { records, relationships, byType };
}

function emptyRecordBag() {
  const bag = {};
  for (const t of RECORD_TYPES) bag[t] = [];
  return bag;
}

// Merge one incoming set into the local set: per-type union by record id, with
// the newer `updatedAt` winning when both sides hold the same id. Nothing local
// is ever removed.
export function mergeDocSets(local, incoming) {
  const base = isObj(local) ? local : {};
  const out = { ...base };
  out.records = emptyRecordBag();
  for (const t of RECORD_TYPES) {
    const localArr = (base.records && Array.isArray(base.records[t]) && base.records[t]) || [];
    const incArr = (incoming.records && Array.isArray(incoming.records[t]) && incoming.records[t]) || [];
    const byId = new Map();
    const order = [];
    const put = (rec) => {
      const key = rec && rec.id ? rec.id : "v:" + hashString(JSON.stringify(rec));
      if (!byId.has(key)) {
        byId.set(key, rec);
        order.push(key);
        return;
      }
      const existing = byId.get(key);
      const et = (existing && existing.updatedAt) || 0;
      const it = (rec && rec.updatedAt) || 0;
      if (it > et) byId.set(key, rec);
    };
    for (const r of localArr) put(r);
    for (const r of incArr) put(r);
    out.records[t] = order.map((k) => byId.get(k));
  }
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "records" || k === "id") continue;
    if (out[k] === undefined) out[k] = v;
  }
  out.id = base.id || incoming.id;
  return out;
}

export function createBackupService({
  store,
  cache,
  now = () => Date.now(),
  upload = null,
  generatorName = null,
  prefix = "docset-",
  publishedKey = "backup::published",
  maxPublished = 12,
}) {
  const cacheGet = async (k) => {
    try {
      return await cache.get(k);
    } catch {
      return undefined;
    }
  };
  const cacheSet = async (k, v) => {
    try {
      await cache.set(k, v);
    } catch {}
  };

  const isSetId = (id) => typeof id === "string" && id.startsWith(prefix);

  async function listSetMetas() {
    const all = await store.listDocuments().catch(() => []);
    return all.filter((m) => isSetId(m.id));
  }

  // ---- collect -------------------------------------------------------------
  async function collect({ createdBy = "system", note = "" } = {}) {
    const metas = await listSetMetas();
    const docsets = {};
    const registry = {};
    let records = 0;
    let relationships = 0;
    for (const m of metas) {
      const doc = await store.readDocument(m.id, { force: true }).catch(() => null);
      if (!doc) continue;
      docsets[m.id] = doc.data;
      registry[m.id] = {
        version: m.version,
        hash: m.hash,
        bytes: m.bytes,
        updatedAt: m.updatedAt,
        updatedBy: m.updatedBy,
      };
      const c = countRecords(doc.data);
      records += c.records;
      relationships += c.relationships;
    }
    return {
      schema: BACKUP_SCHEMA,
      kind: BACKUP_KIND,
      app: { name: "IT-U", generator: generatorName || null },
      note,
      createdAt: now(),
      createdBy,
      docsets,
      registry,
      counts: { docsets: Object.keys(docsets).length, records, relationships },
    };
  }

  function serialize(envelope) {
    return JSON.stringify(envelope, null, 2);
  }

  function parse(input) {
    if (typeof input === "string") {
      try {
        return { value: JSON.parse(input), error: null };
      } catch (e) {
        return { value: null, error: "This does not look like a JSON backup file — it could not be parsed." };
      }
    }
    if (isObj(input)) return { value: input, error: null };
    return { value: null, error: "A backup must be a JSON object or a JSON string." };
  }

  // ---- validate ------------------------------------------------------------
  // Structure, schema, per-record classification and the whole relationship
  // graph are checked BEFORE anything is restored. Never throws.
  function validate(input) {
    const errors = [];
    const warnings = [];
    const { value, error } = parse(input);
    if (error) return { ok: false, errors: [error], warnings, summary: null };
    const env = value;

    if (!isObj(env)) return { ok: false, errors: ["A backup must be a JSON object."], warnings, summary: null };
    if (env.schema !== BACKUP_SCHEMA) {
      errors.push(`Unsupported backup schema “${env.schema || "(missing)"}” — expected “${BACKUP_SCHEMA}”.`);
    }
    if (env.kind !== BACKUP_KIND) {
      errors.push(`Unsupported backup kind “${env.kind || "(missing)"}” — expected “${BACKUP_KIND}”.`);
    }
    if (!isObj(env.docsets)) {
      errors.push("The backup has no `docsets` map.");
      return { ok: false, errors, warnings, summary: null };
    }

    let records = 0;
    let relationships = 0;
    let setCount = 0;
    for (const [id, set] of Object.entries(env.docsets)) {
      setCount++;
      if (!isSetId(id)) warnings.push(`Documentation set “${id}” does not use the “${prefix}” prefix — it will be restored anyway.`);
      if (!isObj(set)) {
        errors.push(`Documentation set “${id}” is not an object.`);
        continue;
      }
      if (!set.name) warnings.push(`Documentation set “${id}” has no name.`);
      if (!isObj(set.records)) {
        errors.push(`Documentation set “${id}” has no records.`);
        continue;
      }
      for (const t of RECORD_TYPES) {
        if (!Array.isArray(set.records[t])) {
          errors.push(`Documentation set “${id}” is missing the “${t}” collection.`);
          continue;
        }
        if (t !== "relationships") {
          const names = new Set();
          for (const rec of set.records[t]) {
            if (!isObj(rec) || !rec.id) {
              errors.push(`A ${t} record in “${id}” has no id.`);
              continue;
            }
            const cls = validateClassification(rec);
            if (!cls.ok) errors.push(`“${rec.name || rec.id}” (${t}) in “${id}”: ${cls.errors.join(" ")}`);
            const low = String(rec.name || "").trim().toLowerCase();
            if (low && names.has(low)) warnings.push(`“${id}” contains two ${t} records named “${rec.name}”.`);
            names.add(low);
          }
        }
      }
      const integrity = checkIntegrity(set);
      for (const issue of integrity.issues) errors.push(`“${id}”: ${issue.message}`);
      const c = countRecords(set);
      records += c.records;
      relationships += c.relationships;
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      summary: { docsets: setCount, records, relationships, createdAt: env.createdAt || null, createdBy: env.createdBy || null },
    };
  }

  // ---- preview (validated restore, without writing) ------------------------
  async function preview(input, { mode = "merge" } = {}) {
    const report = validate(input);
    if (!report.ok) return { ...report, mode, plan: [] };
    const env = parse(input).value;
    const plan = [];
    for (const [id, set] of Object.entries(env.docsets)) {
      const local = await store.readDocument(id, { force: true }).catch(() => null);
      const inc = countRecords(set);
      if (!local) {
        plan.push({ id, name: set.name || id, action: "create", records: inc.records, relationships: inc.relationships });
        continue;
      }
      if (mode === "replace") {
        plan.push({ id, name: (local.data && local.data.name) || id, action: "replace", records: inc.records, relationships: inc.relationships });
        continue;
      }
      const merged = mergeDocSets(local.data, set);
      const before = countRecords(local.data);
      const after = countRecords(merged);
      plan.push({
        id,
        name: (local.data && local.data.name) || id,
        action: "merge",
        records: inc.records,
        relationships: inc.relationships,
        addedRecords: after.records - before.records,
        addedRelationships: after.relationships - before.relationships,
      });
    }
    return { ...report, mode, plan };
  }

  // ---- restore -------------------------------------------------------------
  async function restore(input, { mode = "merge", updatedBy = "restore" } = {}) {
    const report = validate(input);
    if (!report.ok) {
      const err = new StoreError(CODES.INVALID_BACKUP, "This backup failed validation and was not restored: " + report.errors.slice(0, 3).join(" "));
      err.errors = report.errors;
      throw err;
    }
    const env = parse(input).value;
    const result = { mode, created: [], replaced: [], merged: [], unchanged: [], failures: [], docsets: [] };
    for (const [id, set] of Object.entries(env.docsets)) {
      try {
        const local = await store.readDocument(id, { force: true }).catch(() => null);
        let data;
        let action;
        if (!local) {
          data = set;
          action = "create";
        } else if (mode === "replace") {
          data = set;
          action = "replace";
        } else {
          data = mergeDocSets(local.data, set);
          action = "merge";
        }
        const w = await store.writeDocument(id, data, { updatedBy });
        const changed = !!(w && w.changed);
        const finalAction = changed ? { create: "created", merge: "merged", replace: "replaced" }[action] : "unchanged";
        result[finalAction].push(id);
        result.docsets.push({ id, action: finalAction, version: w && w.doc ? w.doc.version : null });
      } catch (e) {
        result.failures.push({ id, error: String((e && e.message) || e) });
      }
    }
    result.ok = result.failures.length === 0;
    result.summary = report.summary;
    return result;
  }

  // ---- download ------------------------------------------------------------
  async function download({ createdBy = "system", note = "" } = {}) {
    const env = await collect({ createdBy, note });
    const text = serialize(env);
    const stamp = new Date(env.createdAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `itu-backup-${stamp}.json`;
    if (typeof document !== "undefined") {
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    return { filename, text, bytes: text.length, envelope: env, counts: env.counts };
  }

  // ---- publish (hosted backup document) ------------------------------------
  async function publish(input, { createdBy = "system", note = "", expires = null } = {}) {
    if (!upload) {
      throw new StoreError(CODES.STORAGE_UNAVAILABLE, "Publishing a backup needs the generator to be saved (upload plugin unavailable).");
    }
    const env = input && isObj(input) && input.schema === BACKUP_SCHEMA ? input : await collect({ createdBy, note });
    const text = serialize(env);
    const res = await upload(text, expires ? { expires } : {});
    if (!res || !res.url) {
      throw new StoreError(CODES.STORAGE_UNAVAILABLE, (res && res.error) ? `Publish failed: ${res.error}` : "Publish failed.");
    }
    const entry = {
      url: res.url,
      at: now(),
      bytes: new TextEncoder().encode(text).length,
      counts: env.counts,
      createdBy,
      note,
      schema: env.schema,
    };
    const list = (await cacheGet(publishedKey)) || [];
    list.unshift(entry);
    await cacheSet(publishedKey, list.slice(0, maxPublished));
    return entry;
  }

  async function listPublished() {
    const list = (await cacheGet(publishedKey)) || [];
    return Array.isArray(list) ? list : [];
  }

  async function removePublished(url) {
    const list = (await cacheGet(publishedKey)) || [];
    const next = list.filter((e) => e.url !== url);
    await cacheSet(publishedKey, next);
    return next;
  }

  return {
    collect,
    serialize,
    validate,
    preview,
    restore,
    download,
    publish,
    listPublished,
    removePublished,
    parse,
    listSetMetas,
  };
}
