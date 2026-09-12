// src/framework/flexibleTypes.js — the GLOBAL Flexible Asset template library
// (roadmap tasks 12–13).
//
// Every Flexible Asset type lives in ONE library document (`flexible-types`)
// in IT-U's storage namespace — deliberately NOT inside any client's
// documentation set. That is the roadmap's "shared globally across
// organizations": a template defined or tuned once is immediately available to
// every client, and a house standard is reused rather than re-created.
//
// The library is seeded from ./assetLibrary.js (Applications, Licensing,
// Virtualization and the service templates). A shipped builtin can be edited in
// place (it is then marked `customized`), cloned and adapted, or reset to the
// shipped definition; custom types can be authored, exported and imported so a
// provider can share its house standards as JSON.

import { StoreError, CODES } from "./store/errors.js";
import {
  ASSET_TYPE_SCHEMA,
  ASSET_LIBRARY_SCHEMA,
  ASSET_LIBRARY_VERSION,
  REFERENCE_TYPE_IDS,
  makeAssetType,
  normalizeAssetFields,
  requireAssetType,
  assetTypeId,
} from "./flexible.js";
import { BUILTIN_ASSET_TYPES, builtinAssetType, BUILTIN_ASSET_TYPE_IDS } from "./assetLibrary.js";

export const LIBRARY_DOC = "flexible-types";

const clone = (v) => JSON.parse(JSON.stringify(v));

function seedData(now) {
  return {
    schema: ASSET_LIBRARY_SCHEMA,
    version: ASSET_LIBRARY_VERSION,
    types: BUILTIN_ASSET_TYPES.map(clone),
    createdAt: now,
    updatedAt: now,
    updatedBy: "system",
  };
}

export function createFlexibleTypeService({ store, cache, now = () => Date.now() }) {
  let memo = null;
  let reconciling = null;
  let queue = Promise.resolve();
  const run = (fn) => {
    const p = queue.then(fn, fn);
    queue = p.then(
      () => {},
      () => {},
    );
    return p;
  };

  // Bring an older library up to the shipped template version: add any shipped
  // template that is missing, refresh a shipped template the provider has NOT
  // customised (so label/option fixes reach existing installations), and remove
  // a shipped template that is no longer shipped (a retired builtin) — unless it
  // has been customised. Custom types and in-place customisations are preserved
  // untouched. Runs at most once per load, and never throws into the caller.
  function reconcile() {
    if (reconciling) return reconciling;
    const version = Number((memo && (memo.version || memo.libraryVersion)) || 1);
    if (version >= ASSET_LIBRARY_VERSION) return Promise.resolve({ changed: false });
    reconciling = (async () => {
      try {
        const data = { ...memo, types: (memo.types || []).map(clone) };
        const index = new Map(data.types.map((t) => [t.id, t]));
        const shippedIds = new Set(BUILTIN_ASSET_TYPE_IDS);
        let changed = false;
        for (const shipped of BUILTIN_ASSET_TYPES) {
          const existing = index.get(shipped.id);
          if (!existing) {
            data.types.push(clone(shipped));
            changed = true;
          } else if (existing.builtin && !existing.customized) {
            data.types[data.types.indexOf(existing)] = clone(shipped);
            changed = true;
          }
        }
        const kept = data.types.filter((t) => !(t.builtin && !t.customized && !shippedIds.has(t.id)));
        if (kept.length !== data.types.length) {
          data.types = kept;
          changed = true;
        }
        data.schema = ASSET_LIBRARY_SCHEMA;
        data.version = ASSET_LIBRARY_VERSION;
        data.updatedAt = now();
        data.updatedBy = "system";
        memo = data;
        if (changed) await store.writeDocument(LIBRARY_DOC, data, { updatedBy: "system" });
        return { changed, version: ASSET_LIBRARY_VERSION };
      } catch {
        return { changed: false };
      } finally {
        reconciling = null;
      }
    })();
    return reconciling;
  }

  async function load(force = false) {
    if (memo && !force) return memo;
    let doc = await store.readDocument(LIBRARY_DOC, force ? { force: true } : undefined).catch(() => null);
    if (!doc || !doc.data) {
      await store.ensure(LIBRARY_DOC, () => seedData(now()));
      doc = await store.readDocument(LIBRARY_DOC, { force: true }).catch(() => null);
    }
    memo = doc && doc.data ? doc.data : seedData(now());
    if (!Array.isArray(memo.types)) memo.types = [];
    await reconcile();
    return memo;
  }

  function write(mutator, updatedBy = "system") {
    return run(async () => {
      const lib = await load(true);
      const data = { ...lib, types: (lib.types || []).map(clone) };
      const result = mutator(data) || {};
      data.schema = ASSET_LIBRARY_SCHEMA;
      data.updatedAt = now();
      data.updatedBy = updatedBy;
      const w = await store.writeDocument(LIBRARY_DOC, data, { updatedBy });
      memo = data;
      return { ...result, library: data, changed: !!(w && w.changed) };
    });
  }

  async function list({ category } = {}) {
    const lib = await load();
    const types = (lib.types || []).filter((t) => !category || t.category === category);
    return types.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async function get(id) {
    const lib = await load();
    return (lib.types || []).find((t) => t.id === id) || null;
  }

  // Synchronous peek at the warm library (after the first list/get).
  function peek() {
    return memo;
  }

  async function libraryMeta() {
    const lib = await load();
    const types = lib.types || [];
    return {
      count: types.length,
      builtinCount: types.filter((t) => t.builtin).length,
      customCount: types.filter((t) => !t.builtin).length,
      customizedCount: types.filter((t) => t.customized).length,
      version: Number(lib.version || 0),
      shippedVersion: ASSET_LIBRARY_VERSION,
      updatedAt: lib.updatedAt,
      updatedBy: lib.updatedBy,
    };
  }

  async function assetTypeOptions() {
    const types = await load().then((lib) => lib.types || []);
    return types
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((t) => ({ id: t.id, name: t.name, category: t.category, builtin: !!t.builtin, fieldCount: (t.fields || []).length }));
  }

  async function create(input = {}) {
    return write((lib) => {
      const ids = lib.types.map((t) => t.id);
      const type = makeAssetType({ ...input }, { now: now() });
      type.id = input.id || assetTypeId(input.name, ids);
      type.builtin = false;
      requireAssetType(type);
      lib.types.push(type);
      return { type };
    }, input.createdBy || "system");
  }

  async function update(id, patch = {}, opts = {}) {
    return write((lib) => {
      const type = lib.types.find((t) => t.id === id);
      if (!type) throw new StoreError(CODES.UNKNOWN_RECORD, `No asset type “${id}”.`);
      if (patch.name != null) type.name = String(patch.name).trim();
      if (patch.description != null) type.description = String(patch.description).trim();
      if (patch.category != null) type.category = patch.category;
      if (patch.icon != null) type.icon = String(patch.icon);
      if (patch.fields != null) type.fields = normalizeAssetFields(patch.fields);
      if (patch.references != null) {
        type.references = Array.isArray(patch.references)
          ? [...new Set(patch.references.filter((r) => REFERENCE_TYPE_IDS.includes(r)))]
          : [];
      }
      type.schema = ASSET_TYPE_SCHEMA;
      type.id = id;
      type.updatedAt = now();
      if (type.builtin) type.customized = true;
      requireAssetType(type);
      return { type };
    }, opts.updatedBy || "system");
  }

  async function cloneType(id, { name, createdBy = "system" } = {}) {
    return write(
      (lib) => {
        const source = lib.types.find((t) => t.id === id);
        if (!source) throw new StoreError(CODES.UNKNOWN_RECORD, `No asset type “${id}”.`);
        const ids = lib.types.map((t) => t.id);
        const copy = {
          ...clone(source),
          id: assetTypeId(name || source.name + " (copy)", ids),
          name: String(name || source.name + " (copy)").trim(),
          builtin: false,
          customized: false,
          shipped: false,
          createdAt: now(),
          updatedAt: now(),
          createdBy,
        };
        requireAssetType(copy);
        lib.types.push(copy);
        return { type: copy };
      },
      createdBy,
    );
  }

  async function remove(id, opts = {}) {
    return write((lib) => {
      const idx = lib.types.findIndex((t) => t.id === id);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No asset type “${id}”.`);
      const type = lib.types[idx];
      if (type.builtin && !opts.force) {
        throw new StoreError(CODES.INVALID_DATA, `“${type.name}” is a shipped template — clone it, or delete it explicitly to remove the shipped copy.`);
      }
      lib.types.splice(idx, 1);
      return { removed: type };
    }, opts.updatedBy || "system");
  }

  // Restore a shipped builtin to its shipped definition (undo local edits).
  async function reset(id, opts = {}) {
    return write((lib) => {
      const idx = lib.types.findIndex((t) => t.id === id);
      if (idx < 0) throw new StoreError(CODES.UNKNOWN_RECORD, `No asset type “${id}”.`);
      const shipped = builtinAssetType(id);
      if (!shipped) throw new StoreError(CODES.INVALID_DATA, `“${lib.types[idx].name}” is not a shipped template — there is nothing to reset it to.`);
      const restored = clone(shipped);
      restored.updatedAt = now();
      lib.types[idx] = restored;
      return { type: restored };
    }, opts.updatedBy || "system");
  }

  // Re-add any shipped builtin that is missing from the library.
  async function restoreLibrary(opts = {}) {
    return write((lib) => {
      const present = new Set(lib.types.map((t) => t.id));
      const added = [];
      for (const t of BUILTIN_ASSET_TYPES) {
        if (present.has(t.id)) continue;
        lib.types.push(clone(t));
        added.push(t.id);
      }
      return { added };
    }, opts.updatedBy || "system");
  }

  // A portable JSON envelope for one type, for sharing house standards.
  function exportType(id) {
    return load().then((lib) => {
      const type = (lib.types || []).find((t) => t.id === id);
      if (!type) throw new StoreError(CODES.UNKNOWN_RECORD, `No asset type “${id}”.`);
      return JSON.stringify({ schema: ASSET_TYPE_SCHEMA, kind: "itu-asset-type-export", exportedAt: now(), type }, null, 2);
    });
  }

  function parseExport(json) {
    let parsed;
    try {
      parsed = typeof json === "string" ? JSON.parse(json) : json;
    } catch {
      throw new StoreError(CODES.INVALID_DATA, "That is not valid JSON.");
    }
    const type = parsed && parsed.type ? parsed.type : parsed;
    if (!type || typeof type !== "object" || !type.name) {
      throw new StoreError(CODES.INVALID_DATA, "That JSON does not contain an asset type (it needs at least a name).");
    }
    return type;
  }

  async function importType(json, { createdBy = "system", name } = {}) {
    const source = parseExport(json);
    return write(
      (lib) => {
        const ids = lib.types.map((t) => t.id);
        const base = name || source.name;
        const type = makeAssetType(
          {
            name: base,
            description: source.description,
            category: source.category,
            icon: source.icon,
            fields: source.fields,
            references: source.references,
            createdBy,
          },
          { now: now() },
        );
        type.id = assetTypeId(base, ids);
        type.builtin = false;
        requireAssetType(type);
        lib.types.push(type);
        return { type };
      },
      createdBy,
    );
  }

  return {
    LIBRARY_DOC,
    load,
    peek,
    list,
    get,
    libraryMeta,
    assetTypeOptions,
    create,
    update,
    clone: cloneType,
    remove,
    reset,
    restoreLibrary,
    exportType,
    importType,
    parseExport,
    isBuiltin: (id) => BUILTIN_ASSET_TYPE_IDS.includes(id),
  };
}
