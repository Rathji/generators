// src/framework/templates.js — save-as-template, apply, and duplicate
// (roadmap Phase 1, task 6; the template *designer* and shared library arrive
// with Phase 3 tasks 12–13).
//
// A TEMPLATE captures the reusable *structure* of a proven documentation set:
// the records it is made of (their type, name, classification and every field
// value) plus the typed links between them, with instance ids stripped so the
// whole thing can be re-instantiated for a new client. Applying a template
// creates a fresh documentation set and mints new ids for every record and
// link — so a house standard (the SOPs, the standard configurations, the
// standard relationships) is reusable in one action.
//
// DUPLICATE is the sibling operation: an exact copy of a live set (records +
// links re-minted), useful for a new client that looks like an existing one.

import { StoreError, CODES } from "./store/errors.js";
import { newId, slugify } from "./ids.js";
import { CLASSIFIED_TYPES } from "./docsets.js";
import { isStarterId, starterTemplate, listStarterTemplates } from "./orgTemplates.js";

export const TEMPLATE_PREFIX = "template-";
export const TEMPLATE_SCHEMA = "itu-template/1";

const META_FIELDS = new Set([
  "id",
  "type",
  "name",
  "informationModel",
  "provenance",
  "origin",
  "createdAt",
  "updatedAt",
  "createdBy",
  "archived",
  "archivedAt",
  "archivedBy",
  "archiveReason",
]);

export function templateId(name) {
  return TEMPLATE_PREFIX + (slugify(name) || newId("tpl"));
}

// Strip machine fields, keep everything the user authored.
function fieldsOf(record) {
  const fields = {};
  for (const [k, v] of Object.entries(record)) {
    if (META_FIELDS.has(k)) continue;
    fields[k] = v;
  }
  return fields;
}

function refKey(ref) {
  return ref && ref.type && ref.id ? ref.type + ":" + ref.id : null;
}

function captureRecords(set) {
  const records = [];
  const index = new Map();
  for (const t of CLASSIFIED_TYPES) {
    for (const r of (set.records && set.records[t]) || []) {
      index.set(refKey(r), records.length);
      records.push({
        type: t,
        name: r.name,
        informationModel: r.informationModel,
        provenance: r.provenance,
        origin: r.origin && typeof r.origin === "object" ? { ...r.origin } : {},
        fields: fieldsOf(r),
      });
    }
  }
  const links = [];
  for (const rel of (set.records && set.records.relationships) || []) {
    const from = index.get(refKey(rel.from));
    const to = index.get(refKey(rel.to));
    if (from === undefined || to === undefined) continue; // dangling links are not templated
    links.push({ kind: rel.kind, from, to, note: rel.note || "" });
  }
  return { records, links };
}

export function createTemplateService({ store, docs, now = () => Date.now() }) {
  const isTemplateId = (id) => typeof id === "string" && id.startsWith(TEMPLATE_PREFIX);

  async function uniqueId(name) {
    const existing = new Set((await store.listDocuments()).map((m) => m.id));
    const base = templateId(name);
    let id = base;
    let n = 2;
    while (existing.has(id)) id = base + "-" + n++;
    return id;
  }

  async function saveAsTemplate(setId, { name, description = "", createdBy = "system" } = {}) {
    const set = await docs.get(setId, { force: true });
    if (!set) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${setId}”.`);
    const clean = String(name == null ? "" : name).trim();
    if (!clean) throw new StoreError(CODES.INVALID_DATA, "A template needs a name.");
    const { records, links } = captureRecords(set);
    const id = await uniqueId(clean);
    const meta = await store.meta(setId).catch(() => null);
    const template = {
      schema: TEMPLATE_SCHEMA,
      id,
      name: clean,
      description: String(description || ""),
      kind: set.kind || "organization",
      basedOn: set.id,
      basedOnName: set.name,
      sourceVersion: meta ? meta.version : null,
      createdAt: now(),
      createdBy,
      records,
      links,
      counts: { records: records.length, links: links.length },
    };
    await store.writeDocument(id, template, { updatedBy: createdBy });
    return { template };
  }

  async function get(id) {
    if (isStarterId(id)) return starterTemplate(id);
    if (!isTemplateId(id)) return null;
    const doc = await store.readDocument(id).catch(() => null);
    return doc ? doc.data : null;
  }

  async function list() {
    const metas = (await store.listDocuments()).filter((m) => isTemplateId(m.id));
    const out = [];
    for (const m of metas) {
      const tpl = await get(m.id);
      if (!tpl) continue;
      out.push({
        id: m.id,
        name: tpl.name,
        description: tpl.description || "",
        kind: tpl.kind,
        basedOn: tpl.basedOn || null,
        basedOnName: tpl.basedOnName || null,
        createdAt: tpl.createdAt,
        createdBy: tpl.createdBy,
        counts: tpl.counts || { records: (tpl.records || []).length, links: (tpl.links || []).length },
        version: m.version,
      });
    }
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  // The built-in STARTER templates (see ./orgTemplates.js). These are not stored
  // documents — they ship with the app — so they are listed separately from the
  // saved templates above and can never be deleted.
  function listBuiltin() {
    return listStarterTemplates();
  }

  // Every template a chooser should offer: the built-ins first, then the saved
  // ones. `list()` deliberately stays saved-only so "what have I saved?" and
  // "what ships?" remain distinct questions.
  async function listAll() {
    return [...listBuiltin(), ...(await list())];
  }

  async function remove(id) {
    if (isStarterId(id)) return { changed: false, builtin: true };
    if (!isTemplateId(id)) return { changed: false };
    return store.deleteDocument(id);
  }

  async function apply(templateIdValue, { name, kind, createdBy = "system" } = {}) {
    const tpl = await get(templateIdValue);
    if (!tpl) throw new StoreError(CODES.UNKNOWN_RECORD, `No template “${templateIdValue}”.`);
    const setName = String(name == null ? "" : name).trim();
    if (!setName) throw new StoreError(CODES.INVALID_DATA, "A documentation set needs a name.");
    // The set is born with its whole structure in ONE write — records + typed
    // links are seeded during create() rather than in a second transaction.
    const set = await docs.create({
      name: setName,
      kind: kind || tpl.kind || "organization",
      createdBy,
      records: tpl.records || [],
      links: tpl.links || [],
    });
    const created = await docs.get(set.id, { force: true });
    return { set: created || set, setRecordCount: (tpl.records || []).length, links: (tpl.links || []).length };
  }

  // An exact copy of a live set — records and links re-minted under the new set.
  async function duplicate(setId, { name, createdBy = "system" } = {}) {
    const src = await docs.get(setId, { force: true });
    if (!src) throw new StoreError(CODES.UNKNOWN_RECORD, `No documentation set “${setId}”.`);
    const newName = String(name == null ? "" : name).trim();
    if (!newName) throw new StoreError(CODES.INVALID_DATA, "The copy needs a name.");
    const set = await docs.create({ name: newName, kind: src.kind || "organization", createdBy });
    const map = new Map();
    let records = 0;
    for (const t of CLASSIFIED_TYPES) {
      for (const r of (src.records && src.records[t]) || []) {
        const res = await docs.addRecord(
          set.id,
          { type: t, name: r.name, informationModel: r.informationModel, provenance: r.provenance, origin: r.origin || {}, ...fieldsOf(r) },
          { allowDuplicate: true, updatedBy: createdBy },
        );
        map.set(refKey(r), { type: t, id: res.record.id });
        records++;
      }
    }
    let links = 0;
    for (const rel of (src.records && src.records.relationships) || []) {
      const from = map.get(refKey(rel.from));
      const to = map.get(refKey(rel.to));
      if (!from || !to) continue;
      await docs.linkRecords(set.id, { from, to, kind: rel.kind, note: rel.note || "", createdBy });
      links++;
    }
    const created = await docs.get(set.id, { force: true });
    return { set: created || set, records, links };
  }

  return {
    saveAsTemplate,
    list,
    listBuiltin,
    listAll,
    get,
    apply,
    duplicate,
    remove,
    isTemplateId,
    isStarterId,
    isBuiltin: (id) => isStarterId(id),
    TEMPLATE_PREFIX,
    TEMPLATE_SCHEMA,
  };
}
