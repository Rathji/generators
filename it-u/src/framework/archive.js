// src/framework/archive.js — capacity, read-only archival & version accounting
// (roadmap Phase 1, task 6).
//
// A retired client (or a documentation set that is no longer live) is ARCHIVED
// rather than deleted: the set's whole versioned document stays exactly where it
// is, gains an `archived` stamp, and becomes READ-ONLY (the docs service refuses
// every mutation of an archived set — see `ARCHIVED_SET`), so history, records
// and relationships are preserved without cluttering the active client list.
// Archiving is reversible.
//
// `capacity()` shows every set's size against the configured storage ceiling,
// flags the ones that are near or over it, and points at the archival action —
// the 'guided archival of retired clients' the roadmap asks for. Version
// accounting reports how many prior versions a set can still be restored to.

import { StoreError, CODES } from "./store/errors.js";

export const DEFAULT_STORAGE_CEILING = 2 * 1024 * 1024; // 2 MiB per documentation set
export const NEAR_CEILING_RATIO = 0.8;

export function createArchiveService({ store, docs, now = () => Date.now(), ceiling = DEFAULT_STORAGE_CEILING }) {
  const prefix = docs.DOCSET_PREFIX;
  const isSetId = (id) => typeof id === "string" && id.startsWith(prefix);

  function statsFor(meta) {
    const bytes = (meta && meta.bytes) || 0;
    const pct = ceiling > 0 ? bytes / ceiling : 0;
    const state = bytes >= ceiling ? "over" : pct >= NEAR_CEILING_RATIO ? "near" : "ok";
    return { bytes, ceiling, pct, state };
  }

  function countFromSet(set) {
    let records = 0;
    let relationships = 0;
    for (const t of docs.RECORD_TYPES) {
      const n = (set && set.records && set.records[t] ? set.records[t].length : 0);
      if (t === "relationships") relationships += n;
      else records += n;
    }
    return { records, relationships };
  }

  // ---- archival ------------------------------------------------------------
  async function archive(id, { updatedBy = "system", reason = "" } = {}) {
    const set = await docs.get(id, { force: true });
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    if (set.archived) return { id, changed: false, alreadyArchived: true };
    const next = { ...set, archived: true, archivedAt: now(), archivedBy: updatedBy, archiveReason: String(reason || "") };
    const w = await store.writeDocument(id, next, { updatedBy });
    return { id, changed: !!(w && w.changed), version: w && w.doc ? w.doc.version : null };
  }

  async function unarchive(id, { updatedBy = "system" } = {}) {
    const set = await docs.get(id, { force: true });
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    if (!set.archived) return { id, changed: false, notArchived: true };
    const next = { ...set };
    delete next.archived;
    delete next.archivedAt;
    delete next.archivedBy;
    delete next.archiveReason;
    const w = await store.writeDocument(id, next, { updatedBy });
    return { id, changed: !!(w && w.changed), version: w && w.doc ? w.doc.version : null };
  }

  // Permanently delete an ARCHIVED set (the only destructive path; the active
  // list's "delete" already exists, this one is for the archive view).
  async function purge(id) {
    const set = await docs.get(id, { force: true });
    if (!set) return { id, changed: false };
    return docs.remove(id);
  }

  async function listArchived() {
    const metas = (await store.listDocuments()).filter((m) => isSetId(m.id));
    const out = [];
    for (const m of metas) {
      const set = await docs.get(m.id).catch(() => null);
      if (!set || !set.archived) continue;
      out.push({
        id: m.id,
        name: set.name,
        kind: set.kind,
        archivedAt: set.archivedAt || null,
        archivedBy: set.archivedBy || null,
        archiveReason: set.archiveReason || "",
        version: m.version,
        bytes: m.bytes,
        ...countFromSet(set),
      });
    }
    return out.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  }

  // ---- capacity ------------------------------------------------------------
  async function capacity() {
    const metas = (await store.listDocuments()).filter((m) => isSetId(m.id));
    const docsets = [];
    let totalBytes = 0;
    let totalRecords = 0;
    let archivedCount = 0;
    for (const m of metas) {
      const set = await docs.get(m.id).catch(() => null);
      const counts = countFromSet(set);
      const s = {
        id: m.id,
        name: set ? set.name : m.id,
        archived: !!(set && set.archived),
        version: m.version,
        ...counts,
        ...statsFor(m),
      };
      totalBytes += s.bytes;
      totalRecords += s.records;
      if (s.archived) archivedCount++;
      docsets.push(s);
    }
    docsets.sort((a, b) => b.bytes - a.bytes);
    return {
      ceiling,
      nearRatio: NEAR_CEILING_RATIO,
      totalBytes,
      totalRecords,
      activeCount: docsets.length - archivedCount,
      archivedCount,
      docsets,
      over: docsets.filter((d) => d.state === "over" && !d.archived),
      near: docsets.filter((d) => d.state === "near" && !d.archived),
      largest: docsets[0] || null,
    };
  }

  // ---- version accounting --------------------------------------------------
  async function versionStats(id) {
    const hist = await store.history(id).catch(() => []);
    const meta = await store.meta(id).catch(() => null);
    return {
      versions: hist.length,
      keep: store.historyMax || null,
      currentVersion: meta ? meta.version : null,
      oldestKept: hist.length ? hist[hist.length - 1].version : null,
      bytes: meta ? meta.bytes : 0,
    };
  }

  return {
    archive,
    unarchive,
    purge,
    listArchived,
    capacity,
    versionStats,
    ceiling,
  };
}
