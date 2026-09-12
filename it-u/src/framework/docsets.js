// src/framework/docsets.js — documentation-set storage (roadmap Phase 1,
// tasks 2–4).
//
// TASK 2 — one versioned document per client. A "documentation set" is the
// whole of one client's documentation (its organizations/departments, locations,
// contacts, configurations, passwords, documents, checklists, flexible assets,
// trackers, relationships and deployment runbooks) held as ONE versioned JSON
// document in IT-U's own storage namespace. It rides on the document store, so
// it inherits: versioning, chunking past the size ceiling, the local edit-key
// cache, the fast local cache, cross-device survival, and the concurrency
// guard. This module adds the domain shape on top.
//
// TASK 3 — every entity record must carry an information-model + provenance
// classification; addRecord/updateRecord refuse to save an unclassified record.
//
// TASK 4 — relationships are first-class typed links stored alongside the
// records; adding/removing records keeps the link graph consistent and refuses
// free-form duplicates of existing records.
//
// The service tracks a small in-memory memo on top of the store's own cache so
// the UI can read a set repeatedly (per render) without a storage round-trip;
// the memo is dropped whenever the store reports the document changed.

import { StoreError, CODES } from "./store/errors.js";
import { newId, slugify } from "./ids.js";
import {
  INFORMATION_MODELS,
  PROVENANCE,
  informationModel,
  provenanceDef,
  validateClassification,
  requireClassification,
} from "./classification.js";
import {
  RELATIONSHIP_KINDS,
  relationshipKind,
  validateLink,
  makeRelationship,
  relationsOf,
  cascadedRelationships,
  suggestLinks,
  findDuplicate,
  findRecord,
  checkIntegrity,
  sameRef,
  refKey,
  normalizeRef,
} from "./relationships.js";
import { requireRecordFields, standardizedIssues, STANDARDIZED_TYPES } from "./standardized.js";
import { makeChecklistItem, checklistItems, requireChecklist, cloneChecklistItems, normalizeChecklistStep } from "./checklist.js";
import { makeCutoverSignOff, validateCutoverSignOff } from "./cutover.js";
import { completenessReport, normalizeCompletenessConfig, makeExemption, completenessRule } from "./configuration.js";
import { effectivePermissions, credentialsFor as credentialsForSet } from "./password.js";
import { levelForType } from "./groups.js";
import {
  DOCUMENT_TYPES,
  documentType,
  requireDocument,
  makeDocumentRevision,
  documentVersionList,
  documentRevision,
  DOCUMENT_HISTORY_MAX,
  documentTemplate,
  extractProcedureSteps,
  normalizeTags,
} from "./document.js";
import {
  runbookType,
  runbookStatus,
  requireRunbook,
  makeRunbookRevision,
  runbookVersionList,
  runbookRevision,
  RUNBOOK_HISTORY_MAX,
  normalizeRunbookTags,
} from "./runbook.js";
import { collectLifecycle } from "./lifecycle.js";
import {
  normalizeWorkflowState,
  normalizeLifecycleConfig,
  buildWorkflow,
  assignOwner,
  snoozeItem,
  recordItemAction,
  renewalScheduleRows,
  scheduleToCsv,
  workflowSummary,
} from "./workflow.js";
import {
  normalizeIntegrations,
  makeIntegration,
  updateIntegration,
  enabledEntityIds,
  SYNC_ENTITIES,
  pullEntityIds,
  pushEntityIds,
  applySync,
  applyPushResult,
  pushPayload,
  makeSyncRun,
  runSummaryLine,
  governanceOverview,
  recordGovernance,
  resolveSyncConflict,
  resolveAllSyncConflicts,
  openConflictsOf,
  CONFLICT_POLICIES,
} from "./integration.js";
import { importTarget } from "./importer.js";

export const DOCSET_PREFIX = "docset-";
export const DOCSET_SCHEMA = "itu-docset/1";

// The record types a documentation set holds (roadmap task 2's list).
export const RECORD_TYPES = [
  "organizations",
  "locations",
  "contacts",
  "configurations",
  "passwords",
  "documents",
  "sites",
  "diagrams",
  "checklists",
  "flexibleAssets",
  "trackers",
  "domains",
  "certificates",
  "relationships",
  "runbooks",
];

export const RECORD_TYPE_META = {
  organizations: { label: "Organizations", singular: "Organization", icon: "building" },
  locations: { label: "Locations", singular: "Location", icon: "building" },
  contacts: { label: "Contacts", singular: "Contact", icon: "building" },
  configurations: { label: "Configurations", singular: "Configuration", icon: "server" },
  passwords: { label: "Passwords", singular: "Password", icon: "shield" },
  documents: { label: "Documents", singular: "Document", icon: "article" },
  sites: { label: "Site summaries", singular: "Site summary", icon: "map" },
  diagrams: { label: "Diagrams & source files", singular: "Diagram", icon: "image" },
  checklists: { label: "Checklists", singular: "Checklist", icon: "clipboard" },
  flexibleAssets: { label: "Flexible Assets", singular: "Flexible Asset", icon: "layers" },
  trackers: { label: "Trackers", singular: "Tracker", icon: "clock" },
  domains: { label: "Domains", singular: "Domain", icon: "globe" },
  certificates: { label: "SSL certificates", singular: "SSL certificate", icon: "lock" },
  relationships: { label: "Relationships", singular: "Relationship", icon: "link" },
  runbooks: { label: "Deployment Runbooks", singular: "Runbook", icon: "rocket" },
};

// Entity record types that MUST be classified (relationships are typed links —
// see classification.js).
export const CLASSIFIED_TYPES = RECORD_TYPES.filter((t) => t !== "relationships");

export const RECORD_KINDS = ["organization", "department", "business-unit"];
export const RECORD_KIND_LABELS = {
  organization: "Organization (client)",
  department: "Department",
  "business-unit": "Business unit",
};

export function emptyRecords() {
  const r = {};
  for (const t of RECORD_TYPES) r[t] = [];
  return r;
}

export function emptyDocSet({ id, name, kind = "organization", createdBy = "system", now = Date.now() } = {}) {
  return {
    schema: DOCSET_SCHEMA,
    id,
    name,
    kind,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    records: emptyRecords(),
  };
}

export function docSetId(name) {
  return DOCSET_PREFIX + (slugify(name) || newId("client"));
}

// The record ids we mint are prefixed by their type so a bare id is readable.
function recordIdFor(type) {
  return newId({ configurations: "cfg", locations: "loc", contacts: "con", passwords: "pwd", documents: "doc", checklists: "chk", flexibleAssets: "fx", trackers: "trk", runbooks: "run", organizations: "org", relationships: "rel", sites: "site", diagrams: "dia", domains: "dom", certificates: "cert" }[type] || "rec");
}

// Older documentation sets were written before later record buckets existed.
// Bring any read set up to the current RECORD_TYPES shape (in memory; the next
// mutation persists it), so a new record type can always be added to an
// existing client.
export function ensureRecordBuckets(set) {
  if (!set || typeof set !== "object") return set;
  if (!set.records || typeof set.records !== "object") set.records = {};
  for (const t of RECORD_TYPES) if (!Array.isArray(set.records[t])) set.records[t] = [];
  return set;
}

export function createDocSetService({ store, cache, now = () => Date.now(), access = null }) {
  const memo = new Map();
  let queue = Promise.resolve();
  // Authorization (roadmap task 20): when an access service is supplied AND the
  // caller identifies itself (`opts.actor`), every sensitive mutation is gated
  // through it. With no access service — or no actor, as in the single-user
  // local mode and the test fixtures — the check is a no-op, so the framework
  // degrades gracefully exactly as the hub does.
  let accessReady = false;
  const ensureAccess = async () => {
    if (!access || accessReady) return;
    try {
      await access.load();
    } catch {}
    accessReady = true;
  };
  // Synchronous gate, called from inside the serialized mutation body (where
  // the fully-read set is available to resolve embedded-credential ownership).
  const gate = (opts, request) => {
    if (!access || !opts || opts.actor === undefined) return;
    // Roadmap task 54: hand the request the documentation set it targets so a
    // SCOPED role (client / service) resolves correctly. access.can() then
    // narrows a record-level request to that record's service.
    const setId = request.setId || (request.set && request.set.id) || null;
    access.require(opts.actor, setId ? { setId, ...request } : request);
  };
  const today = () => new Date(now()).toISOString().slice(0, 10);
  // Serialize read-modify-write mutations inside this service (cross-device
  // races are caught by the store's own concurrency guard).
  const run = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.then(
      () => {},
      () => {},
    );
    return p;
  };

  // Drop our memo whenever the store reports a docset changed (our own writes
  // re-populate it immediately afterwards; other devices' writes fall away).
  if (store.onChange) {
    store.onChange((evt) => {
      if (evt && evt.id && String(evt.id).startsWith(DOCSET_PREFIX)) memo.delete(evt.id);
    });
  }

  const isDocSetId = (id) => typeof id === "string" && id.startsWith(DOCSET_PREFIX);

  async function readFromStore(id, force) {
    const doc = await store.readDocument(id, force ? { force: true } : undefined);
    if (doc) memo.set(id, ensureRecordBuckets(doc.data));
    else memo.delete(id);
    return doc ? doc.data : null;
  }

  // Fast local read: memo → store cache → cloud.
  async function get(id, opts = {}) {
    if (!isDocSetId(id)) return null;
    if (opts.force) return readFromStore(id, true);
    if (memo.has(id)) return memo.get(id);
    return readFromStore(id, false);
  }

  // Synchronous peek at the in-memory memo (used to check "is it already warm").
  function peek(id) {
    return memo.has(id) ? memo.get(id) : null;
  }

  async function list() {
    const metas = (await store.listDocuments()).filter((m) => isDocSetId(m.id));
    return metas.map((m) => ({ id: m.id, version: m.version, updatedAt: m.updatedAt, updatedBy: m.updatedBy, bytes: m.bytes }));
  }

  // Summaries for the UI: meta + the set's name/kind/counts. Reads each set
  // (memo-cached), so call it for the list view rather than per row.
  async function summaries({ includeArchived = false } = {}) {
    const metas = await list();
    const out = [];
    for (const m of metas) {
      const set = await get(m.id).catch(() => null);
      const archived = !!(set && set.archived);
      if (archived && !includeArchived) continue;
      out.push({
        ...m,
        name: set ? set.name : m.id,
        kind: set ? set.kind : "organization",
        archived,
        archivedAt: (set && set.archivedAt) || null,
        counts: set ? counts(set) : null,
        recordCount: set ? countRecords(set) : 0,
      });
    }
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function countRecords(set) {
    if (!set || !set.records) return 0;
    let n = 0;
    for (const t of CLASSIFIED_TYPES) n += (set.records[t] || []).length;
    return n;
  }

  function counts(set) {
    const c = {};
    for (const t of RECORD_TYPES) c[t] = (set && set.records && set.records[t] ? set.records[t].length : 0);
    return c;
  }

  // Seed a (fresh or loaded) set with a batch of records plus the typed links
  // between them, IN PLACE. `records` carry the same shape as a template's
  // captured records ({ type, name, informationModel, provenance, origin,
  // fields }); `links` reference records by their INDEX in the `records` array.
  // Shared by addRecordsBulk() and by create() when a new set is born from a
  // template, so both paths enforce identical validation and gate identically.
  function seedRecordsInto(set, records, links, opts, setId) {
    const map = [];
    let recordsAdded = 0;
    for (const r of records || []) {
      const type = r.type;
      if (!RECORD_TYPES.includes(type) || type === "relationships") {
        throw new StoreError(CODES.INVALID_DATA, `Unknown record type “${type}”.`);
      }
      const input = {
        type,
        name: r.name,
        informationModel: r.informationModel,
        provenance: r.provenance,
        origin: r.origin && typeof r.origin === "object" ? { ...r.origin } : {},
        ...(r.fields || {}),
      };
      const name = String(input.name == null ? "" : input.name).trim();
      if (!name) throw new StoreError(CODES.INVALID_DATA, "A record needs a name.");
      requireClassification(input);
      requireRecordFields(type, input);
      gate(opts, { action: "create", level: levelForType(type), setId });
      const dup = findDuplicate(set, { type, name });
      if (dup && !opts.allowDuplicate) {
        const err = new StoreError(CODES.DUPLICATE_RECORD, `“${name}” already exists in this documentation set as a ${RECORD_TYPE_META[type].singular.toLowerCase()}.`);
        err.existing = { id: dup.id, type: dup.type, name: dup.name };
        err.hint = "Link the existing record instead of adding a duplicate.";
        throw err;
      }
      const record = {
        id: recordIdFor(type),
        type,
        name,
        informationModel: input.informationModel,
        provenance: input.provenance,
        origin: input.origin,
        createdAt: now(),
        updatedAt: now(),
        createdBy: (opts && opts.updatedBy) || "system",
      };
      for (const [k, v] of Object.entries(input)) {
        if (["id", "type", "name", "informationModel", "provenance", "origin", "createdAt", "updatedAt", "createdBy"].includes(k)) continue;
        record[k] = v;
      }
      set.records[type].push(record);
      map.push({ type, id: record.id });
      recordsAdded += 1;
    }
    let linksAdded = 0;
    for (const l of links || []) {
      const from = map[l.from];
      const to = map[l.to];
      if (!from || !to) continue; // a bad index is skipped, never a crash
      const v = validateLink(set, { from, to, kind: l.kind });
      if (!v.ok) throw new StoreError(CODES.INVALID_DATA, v.errors.join(" "));
      set.records.relationships.push(
        makeRelationship({ from, to, kind: l.kind, note: l.note || "", createdBy: (opts && opts.updatedBy) || "system", now: now() }),
      );
      linksAdded += 1;
    }
    return { records: recordsAdded, links: linksAdded, ids: map };
  }

  async function create({ name, kind = "organization", createdBy = "system", actor, records = [], links = [] } = {}) {
    const clean = String(name == null ? "" : name).trim();
    if (!clean) {
      throw new StoreError(CODES.INVALID_DATA, "A documentation set needs a name — the client, department or business unit.");
    }
    if (!RECORD_KINDS.includes(kind)) {
      throw new StoreError(CODES.INVALID_DATA, `Unknown set kind “${kind}”.`);
    }
    if (access && actor !== undefined) {
      await ensureAccess();
      access.require(actor, { action: "create", level: "organization" });
    }
    const existing = new Set((await list()).map((m) => m.id));
    const base = docSetId(clean);
    let id = base;
    let n = 2;
    while (existing.has(id)) id = base + "-" + n++;
    const set = emptyDocSet({ id, name: clean, kind, createdBy, now: now() });
    // A set can be born from a template: seed its records + links before the
    // single write, so instantiating a starter costs ONE cloud round-trip
    // instead of create-then-bulk (two). `actor` is threaded through so the
    // seeded records are gated exactly as if added one by one.
    if ((records && records.length) || (links && links.length)) {
      seedRecordsInto(set, records, links, { actor, updatedBy: createdBy, allowDuplicate: true }, id);
    }
    const w = await store.writeDocument(id, set, { updatedBy: createdBy });
    memo.set(id, set);
    return { ...set, version: w && w.doc ? w.doc.version : 1 };
  }

  // The generic read-modify-write used by every mutation below. `mutate` gets a
  // pristine copy and returns any extra result data; the set is then stamped,
  // persisted, and re-memoized.
  function mutate(id, updatedBy, mutateFn, opts = {}) {
    return run(async () => {
      const set = await get(id, { force: true });
      if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
      if (set.archived && !opts.allowArchived) {
        throw new StoreError(
          CODES.ARCHIVED_SET,
          `“${set.name}” is archived and read-only — restore it before making changes.`,
        );
      }
      const result = mutateFn(set) || {};
      set.updatedAt = now();
      set.updatedBy = updatedBy;
      let w;
      try {
        w = await store.writeDocument(id, set, { updatedBy });
      } catch (e) {
        // Roadmap task 51: a write the cloud can't take right now (offline,
        // unsaved preview, lost edit key) is preserved by the store as a local
        // draft. Treat it as a soft success so field edits keep working: the
        // set is memoized locally and the draft is pushed on the next
        // reconcile, which runs automatically when the connection returns.
        if (e && e.staged) {
          memo.set(id, set);
          return { ...result, docset: set, changed: true, staged: true, draftId: id };
        }
        throw e;
      }
      memo.set(id, set);
      return { ...result, docset: set, changed: !!(w && w.changed), version: w && w.doc ? w.doc.version : undefined };
    });
  }

  // ---- records (task 2 shape + task 3 classification + task 4 dedupe) -------
  async function addRecord(id, input = {}, opts = {}) {
    const type = input.type;
    if (!RECORD_TYPES.includes(type)) {
      throw new StoreError(CODES.INVALID_DATA, `Unknown record type “${type}”.`);
    }
    if (type === "relationships") {
      throw new StoreError(CODES.INVALID_DATA, "Relationships are created with linkRecords(), not addRecord() — a link needs a kind and two record references.");
    }
    const name = String(input.name == null ? "" : input.name).trim();
    if (!name) throw new StoreError(CODES.INVALID_DATA, "A record needs a name.");
    requireClassification(input); // task 3: refuse to save an unclassified record
    requireRecordFields(type, input); // task 7: standardized org/location fields

    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      // task 20: creating a record needs `create` at the record's level. A new
      // EMBEDDED credential is the exception — it has no independent grant, so
      // it needs `edit` on the asset it belongs to instead.
      if (type === "passwords" && (input.scope === "embedded" || input.embeddedIn)) {
        const ref = normalizeRef(input.embeddedIn);
        const owner = ref ? findRecord(set, ref) : null;
        gate(opts, { action: "edit", record: owner || { type: "configurations", id: "" }, set });
      } else {
        gate(opts, { action: "create", level: levelForType(type), setId: id });
      }
      // task 4: refuse free-form duplicates; suggest linking the existing one.
      const dup = findDuplicate(set, { type, name });
      if (dup && !opts.allowDuplicate) {
        const err = new StoreError(
          CODES.DUPLICATE_RECORD,
          `“${name}” already exists in this documentation set as a ${RECORD_TYPE_META[type].singular.toLowerCase()}.`,
        );
        err.existing = { id: dup.id, type: dup.type, name: dup.name };
        err.hint = "Link the existing record instead of adding a duplicate.";
        throw err;
      }
      const record = {
        id: recordIdFor(type),
        type,
        name,
        informationModel: input.informationModel,
        provenance: input.provenance,
        origin: input.origin && typeof input.origin === "object" ? { ...input.origin } : {},
        createdAt: now(),
        updatedAt: now(),
        createdBy: opts.updatedBy || "system",
      };
      for (const [k, v] of Object.entries(input)) {
        if (["id", "type", "name", "informationModel", "provenance", "origin", "createdAt", "updatedAt", "createdBy"].includes(k)) continue;
        record[k] = v;
      }
      set.records[type].push(record);
      return { record };
    }, opts);
  }

  // Bulk-create a batch of records plus the typed links between them in ONE
  // transaction. Used by templates (and any "instantiate a whole structure"
  // flow): without it a 20-record template with 60 links would issue 80 separate
  // read-modify-writes, which is needlessly slow. The actual seeding is shared
  // with create() (see seedRecordsInto) so a from-template create is one write.
  async function addRecordsBulk(id, { records = [], links = [] } = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => seedRecordsInto(set, records, links, opts, id), opts);
  }

  async function updateRecord(id, ref, patch = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = findRecord(set, ref);
      if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref.type} record “${ref.id}”.`);
      gate(opts, { action: "edit", record: rec, set });
      const next = { ...rec, ...patch };
      next.id = rec.id;
      next.type = rec.type;
      requireClassification(next); // task 3 still holds after an edit
      const name = String(next.name == null ? "" : next.name).trim();
      if (!name) throw new StoreError(CODES.INVALID_DATA, "A record needs a name.");
      next.name = name;
      requireRecordFields(rec.type, next); // task 7: standardized org/location fields
      const dup = findDuplicate(set, { type: rec.type, name, excludeId: rec.id });
      if (dup && !opts.allowDuplicate) {
        const err = new StoreError(CODES.DUPLICATE_RECORD, `“${name}” already exists in this documentation set.`);
        err.existing = { id: dup.id, type: dup.type, name: dup.name };
        err.hint = "Link the existing record instead of renaming this one to duplicate it.";
        throw err;
      }
      Object.assign(rec, next, { updatedAt: now() });
      return { record: rec };
    }, opts);
  }

  // Remove a record and cascade away every relationship touching it (task 4).
  async function removeRecord(id, ref, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const arr = set.records[ref.type];
      if (!Array.isArray(arr)) throw new StoreError(CODES.UNKNOWN_RECORD, `Unknown record type “${ref.type}”.`);
      const idx = arr.findIndex((r) => r.id === ref.id);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref.type} record “${ref.id}”.`);
      gate(opts, { action: "delete", record: arr[idx], set });
      const [removed] = arr.splice(idx, 1);
      const doomed = cascadedRelationships(set, ref);
      if (doomed.length) {
        const doomedIds = new Set(doomed.map((r) => r.id));
        set.records.relationships = set.records.relationships.filter((r) => !doomedIds.has(r.id));
      }
      return { removed, cascaded: doomed.length, cascadedRelationships: doomed };
    }, opts);
  }

  async function listRecords(id, type) {
    const set = await get(id);
    if (!set || !set.records[type]) return [];
    return set.records[type];
  }

  // ---- relationships (task 4) ----------------------------------------------
  async function linkRecords(id, { from, to, kind, note = "", createdBy = "system" } = {}, opts = {}) {
    return mutate(id, createdBy, (set) => {
      const v = validateLink(set, { from, to, kind });
      if (!v.ok) throw new StoreError(CODES.INVALID_DATA, v.errors.join(" "));
      const relationship = makeRelationship({ from, to, kind, note, createdBy, now: now() });
      set.records.relationships.push(relationship);
      return { relationship };
    }, { allowArchived: opts.allowArchived });
  }

  async function unlinkRecords(id, relationshipId, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const idx = set.records.relationships.findIndex((r) => r.id === relationshipId);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No relationship “${relationshipId}”.`);
      const [removed] = set.records.relationships.splice(idx, 1);
      return { removed };
    }, opts);
  }

  async function relations(id, ref) {
    return relationsOf(await get(id), ref);
  }

  async function linksFor(id, ref, kindId) {
    return suggestLinks(await get(id), ref, kindId);
  }

  // ---- checklists (task 11) ------------------------------------------------
  // A checklist is a document-model record holding an ordered list of steps
  // (see checklist.js). These methods are the programmatic step API — the UI's
  // editor writes the whole items array through updateRecord(), but trackers,
  // runbooks and imports use these to tick a single step, delegate it, reorder
  // or reuse a whole checklist.
  function mustBeChecklist(set, ref) {
    const rec = findRecord(set, ref);
    if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref && ref.type ? ref.type : "record"} record “${ref && ref.id}”.`);
    if (rec.type !== "checklists") throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” is not a checklist.`);
    return rec;
  }

  function findStep(record, itemId) {
    const step = checklistItems(record).find((s) => s.id === itemId);
    if (!step) throw new StoreError(CODES.UNKNOWN_RECORD, `No checklist step “${itemId}”.`);
    return step;
  }

  function addChecklistItem(id, ref, item = {}, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      if (!Array.isArray(rec.items)) rec.items = [];
      const step = makeChecklistItem(item, now());
      rec.items.push(step);
      requireChecklist(rec);
      rec.updatedAt = now();
      return { record: rec, item: step };
    }, opts);
  }

  function updateChecklistItem(id, ref, itemId, patch = {}, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      const step = findStep(rec, itemId);
      const next = { ...step, ...patch };
      next.id = step.id;
      if (patch.done !== undefined) {
        next.done = !!patch.done;
        next.doneAt = next.done ? patch.doneAt || now() : null;
        next.doneBy = next.done ? patch.doneBy || opts.updatedBy || "system" : "";
      }
      Object.assign(step, next);
      requireChecklist(rec);
      rec.updatedAt = now();
      return { record: rec, item: step };
    }, opts);
  }

  function toggleChecklistItem(id, ref, itemId, done, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      const step = findStep(rec, itemId);
      const nextDone = done == null ? !step.done : !!done;
      step.done = nextDone;
      step.doneAt = nextDone ? now() : null;
      step.doneBy = nextDone ? opts.updatedBy || "system" : "";
      rec.updatedAt = now();
      return { record: rec, item: step };
    }, opts);
  }

  function removeChecklistItem(id, ref, itemId, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      const items = checklistItems(rec);
      const idx = items.findIndex((s) => s.id === itemId);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No checklist step “${itemId}”.`);
      const [removed] = items.splice(idx, 1);
      rec.updatedAt = now();
      return { record: rec, removed };
    }, opts);
  }

  function moveChecklistItem(id, ref, itemId, position, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      const items = checklistItems(rec);
      const idx = items.findIndex((s) => s.id === itemId);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No checklist step “${itemId}”.`);
      const target = Math.max(0, Math.min(items.length - 1, Math.floor(Number(position))));
      const [step] = items.splice(idx, 1);
      items.splice(target, 0, step);
      rec.updatedAt = now();
      return { record: rec, position: target };
    }, opts);
  }

  // Reuse a checklist for another client or deployment: copy it into the target
  // documentation set with fresh step ids (progress optionally reset, so a
  // template checklist starts clean). The name is de-duplicated within the
  // target set.
  async function cloneChecklist(sourceId, ref, targetId, opts = {}) {
    const sourceSet = await get(sourceId, { force: true });
    if (!sourceSet) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${sourceId}”.`);
    const src = mustBeChecklist(sourceSet, ref);
    const resetProgress = opts.resetProgress !== false;
    const items = cloneChecklistItems(src, { resetProgress, now });
    const root = String(opts.name || src.name || "Checklist").trim();
    return mutate(targetId, opts.updatedBy || "system", (set) => {
      let name = root + " (copy)";
      let n = 2;
      while (findDuplicate(set, { type: "checklists", name })) name = root + " (copy " + n++ + ")";
      const record = {
        id: recordIdFor("checklists"),
        type: "checklists",
        name,
        description: src.description || "",
        defaultAssignee: src.defaultAssignee || "",
        dueDate: opts.dueDate != null ? opts.dueDate : src.dueDate || "",
        items,
        informationModel: opts.informationModel || src.informationModel,
        provenance: opts.provenance || src.provenance,
        origin: {},
        createdAt: now(),
        updatedAt: now(),
        createdBy: opts.updatedBy || "system",
      };
      requireClassification(record);
      requireChecklist(record);
      set.records.checklists.push(record);
      return { record, itemCount: items.length, source: { type: "checklists", id: src.id }, targetSetId: targetId };
    }, opts);
  }

  // Create a checklist directly (task 38's generated cutover checklist, imports
  // and templates all use it). Steps are normalized to the checklist shape while
  // preserving extra fields (phase/check/hint), and an optional `service`
  // reference is auto-linked as a `checklist-service` link.
  async function addChecklist(id, input = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      gate(opts, { action: "create", level: levelForType("checklists"), setId: id });
      const name = String(input.name == null ? "" : input.name).trim();
      if (!name) throw new StoreError(CODES.INVALID_DATA, "A checklist needs a name.");
      const dup = findDuplicate(set, { type: "checklists", name });
      if (dup && !opts.allowDuplicate) {
        const err = new StoreError(CODES.DUPLICATE_RECORD, `“${name}” already exists in this documentation set as a checklist.`);
        err.existing = { id: dup.id, type: dup.type, name: dup.name };
        err.hint = "Open the existing checklist, or give this one a different name.";
        throw err;
      }
      const items = (Array.isArray(input.items) ? input.items : []).map((it) => normalizeChecklistStep(it, now()));
      const record = {
        id: recordIdFor("checklists"),
        type: "checklists",
        name,
        description: input.description != null ? String(input.description) : "",
        defaultAssignee: input.defaultAssignee != null ? String(input.defaultAssignee) : "",
        dueDate: input.dueDate != null ? String(input.dueDate) : "",
        phases: Array.isArray(input.phases) ? input.phases.map((p) => ({ ...p })) : [],
        items,
        signOff: input.signOff ? makeCutoverSignOff(input.signOff, now()) : null,
        informationModel: input.informationModel,
        provenance: input.provenance,
        origin: input.origin && typeof input.origin === "object" ? { ...input.origin } : {},
        createdAt: now(),
        updatedAt: now(),
        createdBy: opts.updatedBy || "system",
        updatedBy: opts.updatedBy || "system",
      };
      const shaped = ["id", "type", "name", "description", "defaultAssignee", "dueDate", "phases", "items", "signOff", "informationModel", "provenance", "origin", "createdAt", "updatedAt", "createdBy", "updatedBy"];
      for (const [k, v] of Object.entries(input)) {
        if (shaped.includes(k)) continue;
        record[k] = v;
      }
      record.service = normalizeRef(input.service) || null;
      record.site = normalizeRef(input.site) || null;
      requireClassification(record);
      requireChecklist(record);
      set.records.checklists.push(record);
      if (record.service) {
        const rel = makeRelationship({
          from: { type: "checklists", id: record.id },
          to: record.service,
          kind: relationshipKind("checklist-service") ? "checklist-service" : "asset-reference",
          createdBy: opts.updatedBy || "system",
        });
        set.records.relationships.push(rel);
      }
      return { record };
    }, opts);
  }

  // Record (or clear) the client ACCEPTANCE / sign-off on a checklist (task 38).
  // The decision vocabulary and validation live in ./cutover.js.
  async function signOffChecklist(id, ref, input = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      gate(opts, { action: "edit", record: rec, set });
      const signOff = makeCutoverSignOff(input, now());
      const v = validateCutoverSignOff(signOff);
      if (!v.ok) throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” — ${v.errors.join(" ")}`);
      rec.signOff = signOff;
      rec.updatedBy = opts.updatedBy || "system";
      rec.updatedAt = now();
      return { record: rec, signOff };
    }, opts);
  }

  async function clearChecklistSignOff(id, ref, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeChecklist(set, ref);
      gate(opts, { action: "edit", record: rec, set });
      rec.signOff = null;
      rec.updatedAt = now();
      return { record: rec, signOff: null };
    }, opts);
  }

  // ---- passwords / credentials (task 17) -----------------------------------
  // ---- documents (tasks 21–22) ---------------------------------------------
  // A document is a standardized record whose body is markdown and whose
  // versions are tracked independently of the rest of the set. Every save
  // appends a revision; restoring an old revision is itself a new revision, so
  // nothing is ever lost.
  function mustBeDocument(set, ref) {
    const rec = findRecord(set, ref);
    if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref && ref.type ? ref.type : "record"} record “${ref && ref.id}”.`);
    if (rec.type !== "documents") throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” is not a document.`);
    return rec;
  }

  async function addDocument(id, input = {}, opts = {}) {
    await ensureAccess();
    const type = documentType(input.docType);
    if (!type) {
      throw new StoreError(CODES.INVALID_DATA, `A document must declare one of the document types: ${DOCUMENT_TYPES.map((d) => d.id).join(", ")}.`);
    }
    return mutate(id, opts.updatedBy || "system", (set) => {
      gate(opts, { action: "create", level: levelForType("documents"), setId: id });
      const name = String(input.name == null ? "" : input.name).trim();
      if (!name) throw new StoreError(CODES.INVALID_DATA, "A document needs a title.");
      const dup = findDuplicate(set, { type: "documents", name });
      if (dup && !opts.allowDuplicate) {
        const err = new StoreError(CODES.DUPLICATE_RECORD, `“${name}” already exists in this documentation set as a document.`);
        err.existing = { id: dup.id, type: dup.type, name: dup.name };
        err.hint = "Open the existing document, or give this one a different title.";
        throw err;
      }
      const tpl = documentTemplate(type.id);
      const record = {
        id: recordIdFor("documents"),
        type: "documents",
        name,
        docType: type.id,
        summary: input.summary != null ? String(input.summary) : tpl.summary || "",
        body: input.body != null && input.body !== "" ? String(input.body) : tpl.body,
        tags: normalizeTags(input.tags),
        reviewIntervalDays:
          input.reviewIntervalDays != null && input.reviewIntervalDays !== "" ? input.reviewIntervalDays : type.reviewIntervalDays,
        reviewedAt: input.reviewedAt || today(),
        revision: 1,
        revisions: [],
        informationModel: input.informationModel,
        provenance: input.provenance,
        origin: input.origin && typeof input.origin === "object" ? { ...input.origin } : {},
        createdAt: now(),
        updatedAt: now(),
        createdBy: opts.updatedBy || "system",
        updatedBy: opts.updatedBy || "system",
      };
      const shaped = ["id", "type", "name", "docType", "summary", "body", "tags", "reviewIntervalDays", "reviewedAt", "revision", "revisions", "informationModel", "provenance", "origin", "createdAt", "updatedAt", "createdBy", "updatedBy"];
      for (const [k, v] of Object.entries(input)) {
        if (!shaped.includes(k)) record[k] = v;
      }
      requireClassification(record);
      requireDocument(record);
      set.records.documents.push(record);
      return { record };
    }, opts);
  }

  // Save a document's authored content as a NEW revision. The previous version
  // is snapshotted into `revisions` first, so the history is complete.
  async function saveDocument(id, ref, patch = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeDocument(set, ref);
      gate(opts, { action: "edit", record: rec, set });
      const history = Array.isArray(rec.revisions) ? rec.revisions.slice() : [];
      history.push(makeDocumentRevision(rec, { by: rec.updatedBy || rec.createdBy || "system", now: now() }));
      const next = { ...rec, ...patch, id: rec.id, type: rec.type };
      if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
      requireClassification(next);
      requireDocument(next);
      Object.assign(rec, patch);
      if (patch.tags !== undefined) rec.tags = normalizeTags(patch.tags);
      rec.revisions = history.slice(-DOCUMENT_HISTORY_MAX);
      rec.revision = documentRevision(rec) + 1;
      rec.updatedBy = opts.updatedBy || "system";
      rec.updatedAt = now();
      return { record: rec, revision: rec.revision };
    }, opts);
  }

  async function documentRevisions(id, ref) {
    const set = await get(id);
    const rec = mustBeDocument(set, ref);
    return { record: rec, revision: documentRevision(rec), revisions: documentVersionList(rec) };
  }

  // Restoring an old revision writes it back as the NEWEST revision — history is
  // never rewritten.
  async function restoreDocumentRevision(id, ref, revisionNumber, opts = {}) {
    const set = await get(id);
    const rec = mustBeDocument(set, ref);
    const entry = documentVersionList(rec).find((v) => v.revision === Number(revisionNumber));
    if (!entry) throw new StoreError(CODES.UNKNOWN_RECORD, `Document “${rec.name}” has no revision ${revisionNumber}.`);
    const res = await saveDocument(
      id,
      ref,
      { docType: entry.docType, summary: entry.summary, body: entry.body, tags: entry.tags, reviewIntervalDays: entry.reviewIntervalDays },
      opts,
    );
    return { ...res, restoredFrom: entry.revision };
  }

  async function markDocumentReviewed(id, ref, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeDocument(set, ref);
      gate(opts, { action: "edit", record: rec, set });
      rec.reviewedAt = opts.reviewedAt || today();
      rec.reviewedBy = opts.updatedBy || "system";
      rec.updatedAt = now();
      return { record: rec, reviewedAt: rec.reviewedAt };
    }, opts);
  }

  // The task-21 rule made real: read a procedure's body, extract its ordered
  // steps, and create a proper checklist linked back to the document.
  async function documentToChecklist(id, ref, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeDocument(set, ref);
      gate(opts, { action: "create", level: levelForType("checklists"), setId: id });
      const steps = extractProcedureSteps(rec.body);
      if (!steps.length) {
        throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” has no ordered steps to turn into a checklist — write them as a numbered list first.`);
      }
      const items = steps.map((text) => makeChecklistItem({ text }, now()));
      const root = String(opts.name || rec.name).trim();
      let name = root + " — checklist";
      let n = 2;
      while (findDuplicate(set, { type: "checklists", name })) name = root + " — checklist " + n++;
      const checklist = {
        id: recordIdFor("checklists"),
        type: "checklists",
        name,
        description: "Generated from the document “" + rec.name + "”.",
        defaultAssignee: "",
        dueDate: "",
        items,
        informationModel: rec.informationModel,
        provenance: rec.provenance,
        origin: { source: "document", documentId: rec.id },
        createdAt: now(),
        updatedAt: now(),
        createdBy: opts.updatedBy || "system",
      };
      requireClassification(checklist);
      requireChecklist(checklist);
      set.records.checklists.push(checklist);
      const relationship = makeRelationship({
        from: { type: "documents", id: rec.id },
        to: { type: "checklists", id: checklist.id },
        kind: "document-checklist",
        createdBy: opts.updatedBy || "system",
        now: now(),
      });
      set.records.relationships.push(relationship);
      rec.updatedAt = now();
      return { record: checklist, document: rec, itemCount: items.length, steps, relationship };
    }, opts);
  }

  // ---- deployment runbooks (task 37) ---------------------------------------
  // A runbook mirrors a document (typed, versioned, reviewed) but records the
  // ordered build of a service. The VoIP generator (./runbook.js) produces the
  // body; addRunbook stores it and links it back to the voice asset it deploys.
  function mustBeRunbook(set, ref) {
    const rec = findRecord(set, ref);
    if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref && ref.type ? ref.type : "record"} record “${ref && ref.id}”.`);
    if (rec.type !== "runbooks") throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” is not a runbook.`);
    return rec;
  }

  async function addRunbook(id, input = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      gate(opts, { action: "create", level: levelForType("runbooks"), setId: id });
      const type = runbookType(input.runbookType);
      if (!type) {
        throw new StoreError(CODES.INVALID_DATA, `A runbook must declare a runbook type (see the runbook catalog).`);
      }
      const name = String(input.name == null ? "" : input.name).trim();
      if (!name) throw new StoreError(CODES.INVALID_DATA, "A runbook needs a name.");
      const dup = findDuplicate(set, { type: "runbooks", name });
      if (dup && !opts.allowDuplicate) {
        const err = new StoreError(CODES.DUPLICATE_RECORD, `“${name}” already exists in this documentation set as a runbook.`);
        err.existing = { id: dup.id, type: dup.type, name: dup.name };
        err.hint = "Open the existing runbook, or give this one a different name.";
        throw err;
      }
      const record = {
        id: recordIdFor("runbooks"),
        type: "runbooks",
        name,
        runbookType: type.id,
        status: input.status && runbookStatus(input.status) ? input.status : "draft",
        version: input.version != null && input.version !== "" ? String(input.version) : "1.0",
        summary: input.summary != null ? String(input.summary) : "",
        body: input.body != null ? String(input.body) : "",
        tags: normalizeRunbookTags(input.tags),
        reviewIntervalDays:
          input.reviewIntervalDays != null && input.reviewIntervalDays !== "" ? input.reviewIntervalDays : type.reviewIntervalDays,
        reviewedAt: input.reviewedAt || today(),
        revision: 1,
        revisions: [],
        informationModel: input.informationModel,
        provenance: input.provenance,
        origin: input.origin && typeof input.origin === "object" ? { ...input.origin } : {},
        createdAt: now(),
        updatedAt: now(),
        createdBy: opts.updatedBy || "system",
        updatedBy: opts.updatedBy || "system",
      };
      const shaped = ["id", "type", "name", "runbookType", "status", "version", "summary", "body", "tags", "reviewIntervalDays", "reviewedAt", "revision", "revisions", "informationModel", "provenance", "origin", "createdAt", "updatedAt", "createdBy", "updatedBy"];
      for (const [k, v] of Object.entries(input)) {
        if (!shaped.includes(k)) record[k] = v;
      }
      record.service = normalizeRef(input.service) || null;
      record.site = normalizeRef(input.site) || null;
      requireClassification(record);
      requireRunbook(record);
      set.records.runbooks.push(record);
      if (record.service) {
        const rel = makeRelationship({
          from: { type: "runbooks", id: record.id },
          to: record.service,
          kind: "runbook-service",
          createdBy: opts.updatedBy || "system",
        });
        set.records.relationships.push(rel);
      }
      return { record };
    }, opts);
  }

  async function saveRunbook(id, ref, patch = {}, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeRunbook(set, ref);
      gate(opts, { action: "edit", record: rec, set });
      const history = Array.isArray(rec.revisions) ? rec.revisions.slice() : [];
      history.push(makeRunbookRevision(rec, { by: rec.updatedBy || rec.createdBy || "system", now: now() }));
      const next = { ...rec, ...patch, id: rec.id, type: rec.type };
      if (patch.tags !== undefined) next.tags = normalizeRunbookTags(patch.tags);
      requireClassification(next);
      requireRunbook(next);
      Object.assign(rec, patch);
      if (patch.tags !== undefined) rec.tags = normalizeRunbookTags(patch.tags);
      rec.revisions = history.slice(-RUNBOOK_HISTORY_MAX);
      rec.revision = runbookRevision(rec) + 1;
      rec.updatedBy = opts.updatedBy || "system";
      rec.updatedAt = now();
      return { record: rec, revision: rec.revision };
    }, opts);
  }

  async function runbookRevisions(id, ref) {
    const set = await get(id);
    const rec = mustBeRunbook(set, ref);
    return { record: rec, revision: runbookRevision(rec), revisions: runbookVersionList(rec) };
  }

  async function restoreRunbookRevision(id, ref, revisionNumber, opts = {}) {
    const set = await get(id);
    const rec = mustBeRunbook(set, ref);
    const entry = runbookVersionList(rec).find((v) => v.revision === Number(revisionNumber));
    if (!entry) throw new StoreError(CODES.UNKNOWN_RECORD, `Runbook “${rec.name}” has no revision ${revisionNumber}.`);
    const res = await saveRunbook(
      id,
      ref,
      { runbookType: entry.runbookType, status: entry.status, version: entry.version, summary: entry.summary, body: entry.body, tags: entry.tags, reviewIntervalDays: entry.reviewIntervalDays, service: entry.service, site: entry.site },
      opts,
    );
    return { ...res, restoredFrom: entry.revision };
  }

  async function markRunbookReviewed(id, ref, opts = {}) {
    await ensureAccess();
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = mustBeRunbook(set, ref);
      gate(opts, { action: "edit", record: rec, set });
      rec.reviewedAt = opts.reviewedAt || today();
      rec.reviewedBy = opts.updatedBy || "system";
      rec.updatedAt = now();
      return { record: rec, reviewedAt: rec.reviewedAt };
    }, opts);
  }

  // ---- passwords / credentials (task 17) -----------------------------------
  // An EMBEDDED credential is "created in a specific asset's context". This
  // helper sets its `embeddedIn` owner AND records the ownership link, so the
  // credential both inherits the owner's permissions and appears in the graph.
  // (A general credential is added with the normal addRecord/updateRecord flow.)
  async function addEmbeddedCredential(id, owner, input = {}, opts = {}) {
    const ref = normalizeRef(owner);
    if (!ref) throw new StoreError(CODES.INVALID_DATA, "An embedded credential needs the record it belongs to.");
    const res = await addRecord(id, { ...input, type: "passwords", scope: "embedded", embeddedIn: ref }, opts);
    await linkRecords(
      id,
      { from: { type: "passwords", id: res.record.id }, to: ref, kind: "password-embedded-in", createdBy: opts.updatedBy || "system" },
      { allowArchived: opts.allowArchived },
    );
    const set = await get(id, { force: true });
    return { ...res, record: findRecord(set, { type: "passwords", id: res.record.id }), docset: set };
  }

  // The credentials embedded in a specific record.
  async function credentialsFor(id, owner) {
    const set = await get(id);
    return set ? credentialsForSet(set, owner) : [];
  }

  // The permissions that actually apply to a credential — a general credential's
  // own list, or an embedded credential's inherited set.
  async function credentialPermissions(id, ref) {
    const set = await get(id);
    const rec = findRecord(set, ref);
    if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref && ref.type ? ref.type : "record"} record “${ref && ref.id}”.`);
    return effectivePermissions(rec, set);
  }

  // ---- credential authorisation (task 20) ----------------------------------
  // Revealing a secret is a distinct, auditable act: it needs `view` (or
  // `use` to copy it without displaying it). The caller passes its identity as
  // opts.actor; the embedded-credential rule is applied by the access service,
  // so an embedded credential is governed by the asset it belongs to.
  async function revealCredential(id, ref, opts = {}) {
    const set = await get(id);
    const rec = findRecord(set, ref);
    if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref && ref.type ? ref.type : "record"} record “${ref && ref.id}”.`);
    if (rec.type !== "passwords") throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” is not a credential.`);
    await ensureAccess();
    gate(opts, { action: opts.action || "view", record: rec, set });
    return {
      record: rec,
      secret: rec.secret || "",
      otpSecret: rec.otpSecret || "",
      permissions: effectivePermissions(rec, set),
    };
  }

  // Rotate a credential's secret and record the rotation. Requires `rotate`
  // (which, for an embedded credential, means `edit` on its owning asset).
  async function rotateCredential(id, ref, input = {}, opts = {}) {
    await ensureAccess();
    const today = () => new Date(now()).toISOString().slice(0, 10);
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = findRecord(set, ref);
      if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref && ref.type ? ref.type : "record"} record “${ref && ref.id}”.`);
      if (rec.type !== "passwords") throw new StoreError(CODES.INVALID_DATA, `“${rec.name}” is not a credential.`);
      gate(opts, { action: "rotate", record: rec, set });
      if (input.secret !== undefined) rec.secret = input.secret;
      if (input.otpSecret !== undefined) rec.otpSecret = input.otpSecret;
      if (input.notes !== undefined) rec.notes = input.notes;
      if (input.rotateEveryDays !== undefined) rec.rotateEveryDays = input.rotateEveryDays;
      if (input.rotationMethod !== undefined) rec.rotationMethod = input.rotationMethod;
      if (input.rotationProduct !== undefined) rec.rotationProduct = input.rotationProduct;
      rec.rotatedAt = input.rotatedAt || today();
      rec.rotatedBy = opts.updatedBy || "system";
      rec.updatedAt = now();
      return { record: rec };
    }, opts);
  }

  async function integrity(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const graph = checkIntegrity(set);
    const standardized = standardizedIssues(set); // tasks 7–9: containment + standardized references
    const issues = [...graph.issues, ...standardized];
    return { ok: issues.filter((i) => i.level !== "warning").length === 0, issues };
  }

  // ---- configuration completeness (task 10) --------------------------------
  // A configurable required-field set, per documentation set. The defaults are
  // the classic expectation; a set may override them. An incomplete record is
  // FLAGGED (never blocked), and a field that genuinely does not apply carries a
  // recorded exemption.
  async function completenessConfig(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    return normalizeCompletenessConfig(set.completeness);
  }

  async function configureCompleteness(id, config = {}, opts = {}) {
    const required = Array.isArray(config.required) ? config.required : null;
    if (required) {
      const unknown = required.filter((k) => !completenessRule(k));
      if (unknown.length) {
        throw new StoreError(CODES.INVALID_DATA, `Unknown completeness rule${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
      }
    }
    await ensureAccess();
    gate(opts, { action: "administer", level: "administrative", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const next = normalizeCompletenessConfig(required ? { required } : undefined);
      set.completeness = { required: next.required, configuredAt: now(), configuredBy: opts.updatedBy || "system" };
      return { completeness: normalizeCompletenessConfig(set.completeness) };
    }, opts);
  }

  async function completeness(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    return completenessReport(set);
  }

  // Record an explicit exception on a configuration rule.
  function setExemption(id, ref, ruleKey, reason, opts = {}) {
    if (!completenessRule(ruleKey)) {
      throw new StoreError(CODES.INVALID_DATA, `Unknown completeness rule “${ruleKey}”.`);
    }
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = findRecord(set, ref);
      if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref.type} record “${ref.id}”.`);
      if (rec.type !== "configurations") throw new StoreError(CODES.INVALID_DATA, "Completeness exemptions apply to configuration records.");
      rec.exemptions = { ...(rec.exemptions || {}), [ruleKey]: makeExemption({ reason, by: opts.updatedBy || "system", now: now() }) };
      rec.updatedAt = now();
      return { record: rec, exemption: rec.exemptions[ruleKey] };
    }, opts);
  }

  function clearExemption(id, ref, ruleKey, opts = {}) {
    return mutate(id, opts.updatedBy || "system", (set) => {
      const rec = findRecord(set, ref);
      if (!rec) throw new StoreError(CODES.UNKNOWN_RECORD, `No ${ref.type} record “${ref.id}”.`);
      if (rec.exemptions) {
        const next = { ...rec.exemptions };
        delete next[ruleKey];
        rec.exemptions = next;
        rec.updatedAt = now();
      }
      return { record: rec };
    }, opts);
  }

  function setCompleteness(id, config, opts = {}) {
    return configureCompleteness(id, config, opts);
  }

  // ---- lifecycle & expiry workflow (tasks 26–27) ---------------------------
  // Task 26: aggregate every dated item in the set into one lifecycle view (per
  // client) with a per-asset roll-up. Task 27: the workflow built on top —
  // configurable per-kind lead times, owner assignment, snooze, escalation, an
  // action log and an exportable renewal schedule. Workflow state lives on the
  // set under `lifecycle` so it versions with the rest of the documentation.
  const workflowStateOf = (set) => normalizeWorkflowState(set && set.lifecycle);

  async function lifecycle(id, opts = {}) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const state = workflowStateOf(set);
    return collectLifecycle(set, { now: opts.now, config: state.config, typeOf: opts.typeOf, includeUndated: opts.includeUndated });
  }

  async function lifecycleConfig(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    return workflowStateOf(set).config;
  }

  async function configureLifecycle(id, config = {}, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "administer", level: "administrative", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const current = workflowStateOf(set);
      const next = normalizeLifecycleConfig({ ...current.config, ...config, updatedAt: now(), updatedBy: opts.updatedBy || "system" });
      set.lifecycle = { ...current, config: next, updatedAt: now(), updatedBy: opts.updatedBy || "system" };
      return { config: next };
    }, opts);
  }

  // The items plus the workflow queues/counts and the raw state, in one read.
  async function lifecycleWorkflow(id, opts = {}) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const state = workflowStateOf(set);
    const aggregate = collectLifecycle(set, { now: opts.now, config: state.config, typeOf: opts.typeOf, includeUndated: opts.includeUndated });
    const workflow = buildWorkflow(aggregate.items, state, { now: opts.now });
    return { ...aggregate, ...workflow, items: workflow.enriched, config: state.config, assignments: state.assignments, actions: state.actions };
  }

  async function assignLifecycle(id, itemId, owner, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "edit", level: "asset", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = workflowStateOf(set);
      const res = assignOwner(state, itemId, owner, { by: opts.updatedBy || "system", now: now(), dueAt: opts.dueAt, note: opts.note });
      set.lifecycle = res.state;
      return { assignment: res.assignment, action: res.action };
    }, opts);
  }

  async function snoozeLifecycle(id, itemId, until, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "edit", level: "asset", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = workflowStateOf(set);
      const res = snoozeItem(state, itemId, until, { by: opts.updatedBy || "system", now: now(), note: opts.note });
      set.lifecycle = res.state;
      return { assignment: res.assignment, action: res.action };
    }, opts);
  }

  async function recordLifecycleAction(id, itemId, action, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "edit", level: "asset", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = workflowStateOf(set);
      const res = recordItemAction(state, itemId, action, { by: opts.updatedBy || "system", now: now(), note: opts.note, meta: opts.meta });
      set.lifecycle = res.state;
      return { action: res.action };
    }, opts);
  }

  async function renewalSchedule(id, opts = {}) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const state = workflowStateOf(set);
    const aggregate = collectLifecycle(set, { now: opts.now, config: state.config, typeOf: opts.typeOf, includeUndated: opts.includeUndated });
    const rows = renewalScheduleRows(aggregate.items, state, { now: opts.now, includeOk: opts.includeOk });
    return { rows, csv: scheduleToCsv(rows), summary: workflowSummary(aggregate.items, state, { now: opts.now }) };
  }

  // ---- integrations: PSA/RMM synchronization (task 28) ---------------------
  // Integration definitions and sync runs live on the set under `integrations`
  // (like `lifecycle`), so they version with the rest of the documentation. A
  // provider adapter is injected into syncIntegration() — the engine itself is
  // pure (framework/integration.js) and touches no network.
  const integrationsStateOf = (set) => normalizeIntegrations(set && set.integrations);

  async function listIntegrations(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    return integrationsStateOf(set).integrations;
  }

  async function integrationRuns(id, integrationId) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const runs = integrationsStateOf(set).runs;
    return integrationId ? runs.filter((r) => r.integrationId === integrationId) : runs;
  }

  async function addIntegration(id, def = {}, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "administer", level: "administrative", setId: id });
    let made;
    try {
      made = makeIntegration(def, { now: now(), createdBy: opts.updatedBy || "system" });
    } catch (e) {
      throw new StoreError(CODES.INVALID_DATA, String((e && e.message) || e));
    }
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = integrationsStateOf(set);
      const clash = state.integrations.some((i) => String(i.name).toLowerCase() === made.name.toLowerCase());
      if (clash && !opts.allowDuplicate) {
        throw new StoreError(CODES.DUPLICATE_RECORD, `An integration named “${made.name}” already exists in this set.`);
      }
      set.integrations = { ...state, integrations: [...state.integrations, made], updatedAt: now(), updatedBy: opts.updatedBy || "system" };
      return { integration: made };
    }, opts);
  }

  async function saveIntegration(id, integrationId, patch = {}, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "administer", level: "administrative", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = integrationsStateOf(set);
      const idx = state.integrations.findIndex((i) => i.id === integrationId);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No integration “${integrationId}”.`);
      const next = updateIntegration(state.integrations[idx], patch, { now: now(), by: opts.updatedBy || "system" });
      const clash = state.integrations.some((i) => i.id !== integrationId && String(i.name).toLowerCase() === String(next.name).toLowerCase());
      if (clash) throw new StoreError(CODES.DUPLICATE_RECORD, `An integration named “${next.name}” already exists in this set.`);
      const integrations = state.integrations.slice();
      integrations[idx] = next;
      set.integrations = { ...state, integrations, updatedAt: now(), updatedBy: opts.updatedBy || "system" };
      return { integration: next };
    }, opts);
  }

  async function removeIntegration(id, integrationId, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "administer", level: "administrative", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = integrationsStateOf(set);
      const integration = state.integrations.find((i) => i.id === integrationId);
      if (!integration) throw new StoreError(CODES.UNKNOWN_RECORD, `No integration “${integrationId}”.`);
      const integrations = state.integrations.filter((i) => i.id !== integrationId);
      set.integrations = { ...state, integrations, updatedAt: now(), updatedBy: opts.updatedBy || "system" };
      return { removed: integration };
    }, opts);
  }

  // Run one integration against an injected provider. Pull entities are
  // reconciled from the remote snapshot; push entities are sent to the provider
  // and any external ids it returns are recorded back onto the local records.
  async function syncIntegration(id, integrationId, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "edit", level: "organization", setId: id });
    const preview = await get(id);
    if (!preview) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const integration = integrationsStateOf(preview).integrations.find((i) => i.id === integrationId);
    if (!integration) throw new StoreError(CODES.UNKNOWN_RECORD, `No integration “${integrationId}”.`);
    if (!integration.enabled && !opts.force) {
      throw new StoreError(CODES.INVALID_DATA, `“${integration.name}” is disabled — enable it before syncing.`);
    }
    const provider = opts.provider || null;
    const pulls = pullEntityIds(integration);
    const pushes = pushEntityIds(integration);
    if (!pulls.length && !pushes.length) {
      throw new StoreError(CODES.INVALID_DATA, `“${integration.name}” has no enabled entities — turn on at least one entity and a direction.`);
    }
    if (pulls.length && (!provider || typeof provider.sync !== "function")) {
      throw new StoreError(CODES.INVALID_DATA, `Syncing “${integration.name}” needs a provider adapter that implements sync().`);
    }
    const startedAt = now();
    const errors = [];
    let remote = null;
    if (pulls.length) {
      try {
        remote = await provider.sync({ integration, entities: pulls });
      } catch (e) {
        throw new StoreError(CODES.INVALID_DATA, `Sync with “${integration.name}” failed while pulling: ${String((e && e.message) || e)}`);
      }
    }
    const pushResults = {};
    for (const entityId of pushes) {
      if (!provider || typeof provider.push !== "function") {
        errors.push(`${entityId}: the provider does not implement push()`);
        continue;
      }
      const payload = pushPayload(preview, integration, entityId);
      try {
        pushResults[entityId] = (await provider.push({ integration, entity: entityId, records: payload })) || {};
      } catch (e) {
        errors.push(`${entityId}: ${String((e && e.message) || e)}`);
      }
    }
    return mutate(id, opts.updatedBy || "system", (set) => {
      const state = integrationsStateOf(set);
      const integ = state.integrations.find((i) => i.id === integrationId);
      if (!integ) throw new StoreError(CODES.UNKNOWN_RECORD, `No integration “${integrationId}”.`);
      let summary = { entities: {}, totals: { created: 0, updated: 0, adopted: 0, unchanged: 0, skipped: 0, deleted: 0, remoteDeleted: 0 } };
      if (remote) summary = applySync(set, integ, remote, { now: now() });
      for (const [entityId, res] of Object.entries(pushResults)) {
        const t = applyPushResult(set, integ, entityId, res, { now: now() });
        summary.entities[entityId] = { ...(summary.entities[entityId] || {}), pushed: t.pushed, assigned: t.assigned, skipped: t.skipped };
      }
      const run = makeSyncRun({
        integration: integ,
        summary,
        startedAt,
        finishedAt: now(),
        mode: pushes.length && pulls.length ? "both" : pushes.length ? "push" : "pull",
        status: errors.length ? "partial" : "ok",
        errors,
      });
      const runs = [run, ...state.runs].slice(0, 60);
      const integrations = state.integrations.map((i) =>
        i.id === integrationId ? { ...i, lastRunAt: run.finishedAt, lastRunId: run.id, lastStatus: run.status, lastSummary: runSummaryLine(run) } : i,
      );
      set.integrations = { ...state, integrations, runs, updatedAt: now(), updatedBy: opts.updatedBy || "system" };
      return { run, summary };
    }, opts);
  }

  // ---- integration-managed record governance (task 30) ---------------------
  // A pulled field is integration-owned; a local edit colliding with an incoming
  // remote change is resolved by the integration's conflict policy, recorded,
  // and surfaced. These helpers read the governance roll-up and resolve open
  // conflicts by hand.
  async function integrationGovernance(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    return governanceOverview(set, integrationsStateOf(set).integrations);
  }

  function findRecordEverywhere(set, recordId) {
    for (const entity of SYNC_ENTITIES) {
      const rows = (set.records && set.records[entity.collection]) || [];
      const found = rows.find((r) => r.id === recordId);
      if (found) return { record: found, entityId: entity.id, collection: entity.collection };
    }
    return null;
  }

  async function recordGovernanceOf(id, recordId) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    const found = findRecordEverywhere(set, recordId);
    if (!found) throw new StoreError(CODES.UNKNOWN_RECORD, `No record “${recordId}”.`);
    return recordGovernance(found.record);
  }

  async function resolveIntegrationConflict(id, recordId, field, choice, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "edit", level: "organization", setId: id });
    if (choice !== "external" && choice !== "local") {
      throw new StoreError(CODES.INVALID_DATA, "A conflict resolution must be “external” (accept the remote value) or “local” (keep the local edit).");
    }
    return mutate(id, opts.updatedBy || "system", (set) => {
      const found = findRecordEverywhere(set, recordId);
      if (!found) throw new StoreError(CODES.UNKNOWN_RECORD, `No record “${recordId}”.`);
      const before = openConflictsOf(found.record).length;
      const resolved = field ? [resolveSyncConflict(found.record, field, choice, { now: now(), by: opts.updatedBy || "system" })].filter(Boolean).map((r) => r.conflict) : resolveAllSyncConflicts(found.record, choice, { now: now(), by: opts.updatedBy || "system" });
      if (!resolved.length) throw new StoreError(CODES.INVALID_DATA, field ? `No open conflict on “${field}”.` : "No open conflicts on this record.");
      return { record: found.record, resolved, remaining: openConflictsOf(found.record).length, was: before };
    }, opts);
  }

  // ---- bulk CSV import (task 29) -------------------------------------------
  // A plan is built in the UI by framework/importer.js (a pure dry run). Here we
  // apply it: every ready row becomes a classified record in ONE transaction,
  // and each row's outcome is returned — imported, skipped as a duplicate, or
  // an error with the reason. Nothing is ever silently dropped, and the import
  // itself is logged on the set under `imports`.
  const importReserved = ["id", "type", "name", "informationModel", "provenance", "origin", "createdAt", "updatedAt", "createdBy"];

  async function importRecords(id, { target, plan, source, allowDuplicates = false } = {}, opts = {}) {
    const t = typeof target === "string" ? importTarget(target) : target;
    if (!t) throw new StoreError(CODES.INVALID_DATA, `Unknown import target “${target}”.`);
    if (!plan || !Array.isArray(plan.rows)) throw new StoreError(CODES.INVALID_DATA, "An import needs a plan — run the dry run first.");
    await ensureAccess();
    gate(opts, { action: "create", level: levelForType(t.recordType), setId: id });
    const src = String(source || plan.source || "CSV import").trim() || "CSV import";
    // Attempt every row the plan considered importable; duplicate rows are
    // attempted too so they appear in the result as "skipped", never dropped.
    const candidates = plan.rows.filter((r) => r.status === "ready" || r.status === "duplicate");
    return mutate(id, opts.updatedBy || "system", (set) => {
      const results = [];
      let created = 0;
      let skipped = 0;
      let failed = 0;
      const accepted = [];
      for (const row of candidates) {
        const base = { index: row.index, line: row.line, name: (row.candidate && row.candidate.name) || "" };
        try {
          const input = { ...(row.candidate || {}) };
          input.informationModel = t.informationModel;
          input.provenance = t.provenance;
          input.origin = { ...(input.origin || {}), source: src };
          requireClassification(input);
          requireRecordFields(t.recordType, input);
          const name = String(input.name == null ? "" : input.name).trim();
          if (!name) throw new StoreError(CODES.INVALID_DATA, "A record needs a name.");
          input.name = name;
          const dup = findDuplicate(set, { type: t.recordType, name });
          if (dup && !allowDuplicates && !opts.allowDuplicate) {
            skipped += 1;
            results.push({ ...base, status: "duplicate", error: `“${name}” already exists as a ${RECORD_TYPE_META[t.recordType].singular.toLowerCase()} — skipped.`, existingId: dup.id });
            continue;
          }
          const record = {
            id: recordIdFor(t.recordType),
            type: t.recordType,
            name,
            informationModel: input.informationModel,
            provenance: input.provenance,
            origin: input.origin,
            createdAt: now(),
            updatedAt: now(),
            createdBy: opts.updatedBy || "system",
          };
          for (const [k, v] of Object.entries(input)) if (!importReserved.includes(k)) record[k] = v;
          accepted.push(record);
          created += 1;
          results.push({ ...base, status: "created", id: record.id, name: record.name });
        } catch (e) {
          failed += 1;
          results.push({ ...base, status: "error", error: String((e && e.message) || e) });
        }
      }
      if (accepted.length) set.records[t.recordType].push(...accepted);
      const log = {
        id: newId("imp"),
        target: t.id,
        recordType: t.recordType,
        at: now(),
        by: opts.updatedBy || "system",
        source: src,
        total: plan.rows.length,
        attempted: candidates.length,
        created,
        skipped,
        failed,
      };
      const imports = [log, ...(Array.isArray(set.imports) ? set.imports : [])].slice(0, 40);
      set.imports = imports;
      return { log, results, created, skipped, failed };
    }, opts);
  }

  async function importHistory(id) {
    const set = await get(id);
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${id}”.`);
    return Array.isArray(set.imports) ? set.imports : [];
  }

  async function remove(id, opts = {}) {
    await ensureAccess();
    gate(opts, { action: "delete", level: "organization", setId: id });
    const res = await store.deleteDocument(id);
    memo.delete(id);
    return res;
  }

  async function rename(id, name, opts = {}) {
    const clean = String(name == null ? "" : name).trim();
    if (!clean) throw new StoreError(CODES.INVALID_DATA, "A documentation set needs a name.");
    await ensureAccess();
    gate(opts, { action: "edit", level: "organization", setId: id });
    return mutate(id, opts.updatedBy || "system", (set) => {
      const prev = set.name;
      set.name = clean;
      return { previousName: prev };
    }, opts);
  }

  return {
    DOCSET_PREFIX,
    RECORD_TYPES,
    // catalogs (re-exported so UI/tests read one source of truth)
    INFORMATION_MODELS,
    PROVENANCE,
    RELATIONSHIP_KINDS,
    STANDARDIZED_TYPES,
    // reads
    isDocSetId,
    get,
    peek,
    list,
    summaries,
    meta: (id) => store.meta(id),
    counts: (id) => get(id).then((s) => (s ? counts(s) : null)),
    countRecords: (id) => get(id).then((s) => (s ? countRecords(s) : 0)),
    listRecords,
    relations,
    linksFor,
    integrity,
    completeness,
    completenessConfig,
    // writes
    create,
    rename,
    remove,
    addRecord,
    addRecordsBulk,
    updateRecord,
    removeRecord,
    linkRecords,
    unlinkRecords,
    addChecklistItem,
    updateChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    moveChecklistItem,
    cloneChecklist,
    addChecklist,
    signOffChecklist,
    clearChecklistSignOff,
    addDocument,
    saveDocument,
    documentRevisions,
    restoreDocumentRevision,
    markDocumentReviewed,
    documentToChecklist,
    addRunbook,
    saveRunbook,
    runbookRevisions,
    restoreRunbookRevision,
    markRunbookReviewed,
    addEmbeddedCredential,
    credentialsFor,
    credentialPermissions,
    revealCredential,
    rotateCredential,
    configureCompleteness,
    setCompleteness,
    setExemption,
    clearExemption,
    // lifecycle aggregation & expiry workflow (tasks 26–27)
    lifecycle,
    lifecycleConfig,
    configureLifecycle,
    lifecycleWorkflow,
    assignLifecycle,
    snoozeLifecycle,
    recordLifecycleAction,
    renewalSchedule,
    // integrations: PSA/RMM synchronization (task 28)
    listIntegrations,
    addIntegration,
    updateIntegration: saveIntegration,
    removeIntegration,
    syncIntegration,
    integrationRuns,
    // integration-managed record governance (task 30)
    integrationGovernance,
    recordGovernanceOf,
    resolveIntegrationConflict,
    // bulk CSV import (task 29)
    importRecords,
    importHistory,
    // helpers
    validateClassification,
    requireClassification,
    relationshipKind,
    findRecord,
  };
}
