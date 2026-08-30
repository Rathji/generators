// src/store.js — Local-first persistence layer (Roadmap Task 1)
//
// Every entity (project, task, event, checklist, note, habit, board) is a
// VERSIONED record. The in-memory cache is the single source of truth; a
// debounced autosave (~800ms after the last change) writes ONLY the records
// that actually changed, straight into IndexedDB via the kv-plugin.
// Nothing is ever uploaded to a server.

export const SCHEMA_VERSION = 1;

export const ENTITY_TYPES = ["project", "task", "event", "checklist", "note", "habit", "board", "focuslog"];

export const DEFAULT_SETTINGS = {
  profileName: "",
  theme: "dark",
  focusWork: 25,
  focusShort: 5,
  focusLong: 15,
};

export function uid() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

const now = () => Date.now();

export class Store {
  // kv: root.kv (the kv-plugin folder namespace)
  // folder: the kv folder name to persist into
  // writeLog: optional test hook called with the array of keys written on each save
  constructor({ kv, folder = "pm", writeLog = null, debounceMs = 800 } = {}) {
    this.kv = kv || null;
    this.folder = folder;
    this.kvFolder = kv ? kv[folder] : null;
    this.debounceMs = debounceMs;
    this.writeLog = writeLog || null;

    this.records = new Map();   // "r:type:id" -> record
    this.dirty = new Set();     // keys needing a write
    this.deleted = new Set();   // keys to delete on next save
    this.settingsDirty = false;
    this.listeners = new Set();
    this.saveState = "idle";    // idle | saving | saved | error
    this.saveTimer = null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.meta = { schemaVersion: SCHEMA_VERSION };
    this.ready = false;
  }

  // ── subscriptions ────────────────────────────────────────────────
  // Events: {type:"change", entityType, id, action:"upsert"|"remove"}
  //         {type:"settings", settings}
  //         {type:"savestate", state}
  //         {type:"loaded"}
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { for (const fn of this.listeners) { try { fn(evt); } catch (e) { console.error("store listener error", e); } } }
  setSaveState(s) { this.saveState = s; this.emit({ type: "savestate", state: s }); }

  // ── load ─────────────────────────────────────────────────────────
  async load() {
    let entries = [];
    try {
      if (this.kvFolder) entries = (await this.kvFolder.entries()) || [];
    } catch (e) {
      console.error("store: load failed", e);
    }
    for (const [key, val] of entries) {
      if (key === "__settings") { this.settings = Object.assign({}, DEFAULT_SETTINGS, val || {}); continue; }
      if (key === "__meta") { this.meta = Object.assign({ schemaVersion: SCHEMA_VERSION }, val || {}); continue; }
      if (typeof key === "string" && key.startsWith("r:")) this.records.set(key, val);
    }
    this.ready = true;
    this.emit({ type: "loaded" });
    this.setSaveState("saved");
    return this;
  }

  // Flush pending writes when the tab hides/closes so the last ~800ms of
  // edits aren't lost. Best-effort (IndexedDB is async, but writes issued on
  // unload generally still land).
  attachFlush() {
    window.addEventListener("beforeunload", () => { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; this.save(); } });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; this.save(); } });
  }

  // ── record access ────────────────────────────────────────────────
  key(type, id) { return "r:" + type + ":" + id; }
  get(type, id) { return this.records.get(this.key(type, id)) || null; }
  all(type) {
    const out = [];
    const prefix = "r:" + type + ":";
    for (const [k, r] of this.records) if (k.startsWith(prefix)) out.push(r);
    return out;
  }
  count(type) { return this.all(type).length; }

  // ── mutations ────────────────────────────────────────────────────
  create(type, fields = {}) {
    const id = fields.id || uid();
    const rec = this.upsert(type, id, fields);
    return rec;
  }

  upsert(type, id, fields) {
    const key = this.key(type, id);
    const prev = this.records.get(key) || null;
    const rec = Object.assign({}, prev, fields, { id, type, updated: now() });
    if (!rec.created) rec.created = now();
    if (rec.v === undefined) rec.v = SCHEMA_VERSION;
    this.records.set(key, rec);
    this.deleted.delete(key);
    this.dirty.add(key);
    this.scheduleSave();
    this.emit({ type: "change", entityType: type, id, record: rec, action: "upsert" });
    return rec;
  }

  remove(type, id) {
    const key = this.key(type, id);
    const existed = this.records.has(key);
    this.records.delete(key);
    this.dirty.delete(key);
    if (existed) this.deleted.add(key);
    this.scheduleSave();
    this.emit({ type: "change", entityType: type, id, action: "remove" });
  }

  // ── settings (persisted through the same save pipeline) ─────────
  setSetting(k, v) { this.settings[k] = v; this.settingsDirty = true; this.scheduleSave(); this.emit({ type: "settings", settings: this.settings }); }
  updateSettings(patch) { Object.assign(this.settings, patch); this.settingsDirty = true; this.scheduleSave(); this.emit({ type: "settings", settings: this.settings }); }

  // ── debounced autosave ──────────────────────────────────────────
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, this.debounceMs);
  }

  async save() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.dirty.size === 0 && this.deleted.size === 0 && !this.settingsDirty) return;
    this.setSaveState("saving");

    const writes = {};
    for (const key of this.dirty) {
      const rec = this.records.get(key);
      if (rec) writes[key] = rec;
      else this.deleted.add(key);
    }
    this.dirty.clear();
    const deletes = [...this.deleted];
    this.deleted.clear();
    if (this.settingsDirty) { writes["__settings"] = this.settings; this.settingsDirty = false; }
    writes["__meta"] = Object.assign({}, this.meta, { schemaVersion: SCHEMA_VERSION, savedAt: now() });

    if (this.writeLog) {
      try { this.writeLog(Object.keys(writes)); } catch (e) {}
    }

    try {
      if (this.kvFolder) {
        if (Object.keys(writes).length) await this.kvFolder.setMany(Object.entries(writes));
        for (const k of deletes) await this.kvFolder.delete(k);
      }
      this.setSaveState("saved");
    } catch (e) {
      console.error("store: save failed", e);
      // Restore dirty state so the records can be retried.
      for (const key of Object.keys(writes)) {
        if (key !== "__settings" && key !== "__meta" && this.records.has(key)) this.dirty.add(key);
      }
      for (const k of deletes) this.deleted.add(k);
      this.setSaveState("error");
    }
  }

  // ── whole-dataset helpers (backup / restore / wipe) ──────────────
  exportAll() {
    const data = {};
    for (const [k, r] of this.records) {
      const parts = k.split(":");
      const type = parts[1];
      (data[type] = data[type] || []).push(JSON.parse(JSON.stringify(r)));
    }
    return {
      app: "project-master",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now(),
      settings: JSON.parse(JSON.stringify(this.settings)),
      entities: data,
    };
  }

  // Validate a backup payload WITHOUT touching data. Throws with a message on
  // invalid/mismatched payloads. Used by the import flow before confirming.
  validateBackup(data) {
    if (!data || typeof data !== "object" || (data.app !== "project-master" && data.app !== "project-manager")) {
      throw new Error("not a Project Master backup (missing app marker)");
    }
    if (!data.entities || typeof data.entities !== "object") {
      throw new Error("missing entity data");
    }
    if (typeof data.schemaVersion !== "number") {
      throw new Error("missing schema version");
    }
    if (data.schemaVersion > SCHEMA_VERSION) {
      throw new Error("backup is from a newer app version (schema v" + data.schemaVersion + " > current v" + SCHEMA_VERSION + ")");
    }
    const known = new Set(ENTITY_TYPES);
    for (const type of Object.keys(data.entities)) {
      if (!known.has(type)) throw new Error("unknown entity type \"" + type + "\" in backup");
      if (!Array.isArray(data.entities[type])) throw new Error("entities." + type + " must be a list");
    }
  }

  // Replace ALL current data with a validated backup payload. Throws on
  // invalid/mismatched payloads WITHOUT touching existing data.
  restoreFromBackup(data) {
    this.validateBackup(data);
    if (!data || typeof data !== "object" || (data.app !== "project-master" && data.app !== "project-manager")) {
      throw new Error("Not a valid Project Master backup file (missing app marker).");
    }
    if (!data.entities || typeof data.entities !== "object") {
      throw new Error("Not a valid Project Manager backup file (missing entities).");
    }
    const sv = typeof data.schemaVersion === "number" ? data.schemaVersion : 0;
    if (sv > SCHEMA_VERSION) {
      throw new Error("This backup is from a newer app version (schema v" + sv + " > current v" + SCHEMA_VERSION + "). Please update the app first.");
    }
    for (const key of this.records.keys()) this.deleted.add(key);
    this.records.clear();
    this.dirty.clear();
    for (const type of Object.keys(data.entities)) {
      for (const rec of data.entities[type]) {
        if (!rec || typeof rec.id !== "string" || !rec.id) continue;
        const key = this.key(type, rec.id);
        this.records.set(key, Object.assign({}, rec, { id: rec.id, type, v: SCHEMA_VERSION }));
        this.dirty.add(key);
        this.deleted.delete(key);
      }
    }
    if (data.settings && typeof data.settings === "object") {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
      this.settingsDirty = true;
    }
    this.emit({ type: "restored" });
    this.scheduleSave();
  }

  // Wipe every record (settings kept). Used by the danger-zone clear-all.
  wipeAll() {
    for (const key of this.records.keys()) this.deleted.add(key);
    this.records.clear();
    this.dirty.clear();
    this.emit({ type: "restored" });
    this.scheduleSave();
  }
}
