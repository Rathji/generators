// Task #232-#234: The Codex engine — tracks what the player has discovered
// (enemies/items/locations/quests/classes). The core is a persistent
// discovery set per section, with progress and totals. The static entries live
// in data/codex.js. Persists per-key to storage (localStorage).

import { CODEX_SECTIONS, catalogFor } from "../data/codex.js";

export class CodexSystem {
  constructor(opts = {}) {
    this.storage = opts.storage ?? null;
    this.prefix = opts.prefix ?? "ff_codex_";
    this.sections = opts.sections ?? CODEX_SECTIONS;
    this.onDiscover = opts.onDiscover ?? null; // (section, id) => void
    this.known = {}; // section -> Set(ids)
    for (const s of this.sections) {
      this.known[s.id] = new Set(this._load(s.id));
    }
  }

  _load(section) {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(this.prefix + section);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _save(section) {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.prefix + section, JSON.stringify([...this.known[section]]));
    } catch {
      /* storage full/blocked — non-fatal */
    }
  }

  // Mark one id in a section as discovered. Returns true if newly added.
  discover(section, id) {
    if (!this.known[section]) return false;
    if (this.known[section].has(id)) return false;
    this.known[section].add(id);
    this._save(section);
    if (this.onDiscover) this.onDiscover(section, id);
    return true;
  }

  discoverMany(section, ids) {
    const added = [];
    for (const id of ids) if (this.discover(section, id)) added.push(id);
    return added;
  }

  isKnown(section, id) {
    return !!this.known[section]?.has(id);
  }

  sectionInfo(section) {
    const def = this.sections.find((s) => s.id === section);
    const all = catalogFor(section);
    const known = this.known[section] ?? new Set();
    return {
      id: section,
      label: def?.label ?? section,
      total: all.length,
      known: all.filter((e) => known.has(e.id)).map((e) => e.id).length,
      discovered: all.filter((e) => known.has(e.id)),
      locked: all.filter((e) => !known.has(e.id)).map((e) => e.id),
    };
  }

  sectionsInfo() {
    return this.sections.map((s) => this.sectionInfo(s.id));
  }

  entries(section) {
    return catalogFor(section).map((e) => ({
      ...e,
      discovered: this.isKnown(section, e.id),
    }));
  }

  // An entry plus a human progress string for the section list.
  entry(section, id) {
    const e = catalogFor(section).find((x) => x.id === id) ?? null;
    return e ? { ...e, discovered: this.isKnown(section, id) } : null;
  }

  totalDiscovered() {
    return this.sectionsInfo().reduce((s, x) => s + x.known, 0);
  }

  totalEntries() {
    return this.sectionsInfo().reduce((s, x) => s + x.total, 0);
  }

  summary() {
    return { sections: this.sectionsInfo(), discovered: this.totalDiscovered(), total: this.totalEntries() };
  }
}
