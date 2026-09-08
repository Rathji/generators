// src/framework/store/backends.js — storage backends for the document store.
//
// The store is backend-agnostic: it talks to a `channel` (cloud layer, one
// physical file = one name) and a `cache` (fast local key/value layer). The
// real deployment uses upload-plugin's editable files (canonical, survives
// across devices/reloads) + kv-plugin (local cache + cached edit keys).
// Tests inject the in-memory backends defined here.

import { StoreError, CODES } from "./errors.js";

// ---------------------------------------------------------------------------
// Cloud channels
// ---------------------------------------------------------------------------

// In-memory channel — a Map of name -> text. Used by the test suite and as a
// fallback when plugins aren't available.
export function createMemoryChannel() {
  const files = new Map();
  return {
    files,
    async list() {
      return [...files.keys()].map((name) => ({ name }));
    },
    async get(name) {
      return files.has(name) ? files.get(name) : null;
    },
    async put(name, text) {
      const created = !files.has(name);
      files.set(name, text);
      return {
        url: "mem://" + name,
        size: new TextEncoder().encode(text).length,
        editKey: created ? "mem-key-" + name : null,
        editCount: 1,
        created,
        unchanged: files.get(name) === text,
        superseded: false,
        error: null,
      };
    },
    async del(name) {
      files.delete(name);
    },
  };
}

// Upload-plugin channel — one editable file per physical name.
//
// Edit keys are the only way to update an editable file after it's created,
// and they're returned exactly once (on creation), so we cache them in
// `keyStore` (the local kv cache) and pass them on every update. If the key
// is missing (e.g. the file was created on another device), the plugin
// rejects the write and we surface a typed EDIT_KEY_REQUIRED error.
export function createUploadChannel({ uploadPlugin, keyStore }) {
  const nameOk = (name) => typeof name === "string" && /^[a-z0-9-]{1,200}$/.test(name);
  return {
    async get(name) {
      if (!nameOk(name)) return null;
      try {
        return await uploadPlugin.editable.get(name);
      } catch {
        return null;
      }
    },
    async put(name, text) {
      if (!nameOk(name)) {
        throw new StoreError(CODES.INVALID_DATA, `Invalid document file name "${name}".`);
      }
      const opts = {};
      const key = await keyStore.get(name);
      if (key) opts.editKey = key;
      const res = await uploadPlugin.editable.set(name, text, opts);
      if (res && res.error) {
        if (res.error === "editable_requires_saved_generator") {
          throw new StoreError(
            CODES.STORAGE_UNAVAILABLE,
            "Saving the knowledge base needs the generator to be saved first — hit Save in the editor.",
          );
        }
        if (res.error === "edit_key_required" || res.error === "invalid_edit_key") {
          throw new StoreError(
            CODES.EDIT_KEY_REQUIRED,
            `This document file ("${name}") was created on another device. Only the device that created it can edit it.`,
          );
        }
        if (res.error === "file_too_big") {
          throw new StoreError(CODES.CHUNK_WRITE_FAILED, `Document file "${name}" exceeds the storage ceiling.`);
        }
        throw new StoreError(CODES.CHUNK_WRITE_FAILED, `Could not save "${name}" (${res.error}).`);
      }
      if (res && res.editKey) {
        try {
          await keyStore.set(name, res.editKey);
        } catch {}
      }
      return res || {};
    },
    async del(name) {
      // Editable files have no delete API; tombstone to an empty string
      // (a shrink, which is cheap) so reads of an un-referenced name return "".
      try {
        await this.put(name, "");
      } catch {}
    },
  };
}

// ---------------------------------------------------------------------------
// Local caches
// ---------------------------------------------------------------------------

export function createMemoryCache() {
  const m = new Map();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v) {
      m.set(k, v);
      return v;
    },
    async del(k) {
      m.delete(k);
    },
    async entries() {
      return [...m.entries()];
    },
  };
}

// kv-plugin cache — a named folder on the user's device. `folderName` is the
// store's storage namespace (e.g. "kb-system"), so the cache is scoped to the
// KB and never collides with other apps.
export function createKvCache(kv, folderName) {
  const folder = kv[folderName];
  return {
    async get(k) {
      return folder.get(k);
    },
    async set(k, v) {
      await folder.set(k, v);
      return v;
    },
    async del(k) {
      await folder.delete(k);
    },
    async entries() {
      return folder.entries();
    },
  };
}
