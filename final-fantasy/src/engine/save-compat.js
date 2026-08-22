// Task #124: Save File Compatibility — version checking and migration for
// save data across builds. Every save carries a `version`; this system
// inspects arbitrary JSON, reports compatibility, and migrates older formats
// forward (v1 -> v2 adds `meta`/`reserve` defaults).

import { SAVE_VERSION } from "./save.js";

export const KNOWN_SAVE_VERSIONS = Object.freeze([1, 2]);

export class SaveCompatibilitySystem {
  constructor(opts = {}) {
    this.current = opts.current ?? SAVE_VERSION;
    this.known = opts.known ?? KNOWN_SAVE_VERSIONS;
  }

  parse(json) {
    if (typeof json !== "string") return { ok: false, error: "not a string" };
    try {
      return { ok: true, data: JSON.parse(json) };
    } catch (e) {
      return { ok: false, error: "corrupt json" };
    }
  }

  // Structural inspection without migrating.
  inspect(json) {
    const p = this.parse(json);
    if (!p.ok) return { ok: false, error: p.error, version: null };
    const data = p.data;
    return {
      ok: true,
      version: data.version ?? null,
      savedAt: data.savedAt ?? null,
      hasState: !!data.state,
      gold: data.gold ?? null,
      partyCount: Array.isArray(data.party) ? data.party.length : 0,
      inventoryCount: Array.isArray(data.inventory) ? data.inventory.length : 0,
      hasMeta: !!data.meta,
      compatible: this.known.includes(data.version),
      migratable: typeof data.version === "number" && data.version < this.current,
    };
  }

  check(json) {
    const i = this.inspect(json);
    if (!i.ok) return { ok: false, ...i, compatible: false };
    const issues = [];
    if (!i.compatible) issues.push("unsupported version: " + i.version);
    if (!i.hasState) issues.push("missing state block");
    return { ok: i.ok && i.compatible && issues.length === 0, compatible: i.compatible, version: i.version, issues };
  }

  isCurrent(json) {
    const i = this.inspect(json);
    return i.ok && i.version === this.current;
  }

  // Migrate a save to the current version (returns the v2-shaped object,
  // ready to be re-serialized). Identity when already current.
  migrate(json) {
    const p = this.parse(json);
    if (!p.ok) return { ok: false, error: p.error };
    const data = p.data;
    const version = data.version ?? 0;
    if (version > this.current) {
      return { ok: false, error: "save is from a newer build", version };
    }
    let out = { ...data };
    if (version < 2) {
      // v1 -> v2: optional meta block, reserve roster, and safe defaults.
      out = {
        ...out,
        version: 2,
        meta: out.meta ?? null,
        reserve: Array.isArray(out.reserve) ? out.reserve : [],
        state: out.state ?? {},
        party: Array.isArray(out.party) ? out.party : [],
        inventory: Array.isArray(out.inventory) ? out.inventory : [],
        gold: typeof out.gold === "number" ? out.gold : 0,
      };
    }
    return { ok: true, version: out.version, data: out, migrated: version !== out.version };
  }
}
