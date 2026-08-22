// Task #203: Three-slot save system with metadata, built on the versioned
// SaveManager. Task #205: resilient reads — corrupt saves fall back to the
// previous write's backup, and future save versions are refused cleanly.

import { SaveManager, serializeGame, deserializeGame, SAVE_VERSION } from "./save.js";

export const SAVE_SLOT_IDS = ["A", "B", "C"];
export const SAVE_SLOT_NAMES = Object.freeze({ A: "Slot A", B: "Slot B", C: "Slot C" });

export class SaveSlotSystem {
  constructor(opts = {}) {
    this.manager = opts.manager ?? new SaveManager({ storage: opts.storage ?? null });
    this.ids = [...(opts.ids ?? SAVE_SLOT_IDS)];
  }

  has(slot) {
    return this.ids.includes(slot) && this.manager.has(slot);
  }

  any() {
    return this.ids.some((s) => this.manager.has(s));
  }

  computeMeta(slot, game) {
    const state = game.state;
    const party = game.party;
    const loc = state?.getLocation?.() ?? null;
    const levels = party?.members?.map((m) => m.level) ?? [];
    return {
      slot,
      name: SAVE_SLOT_NAMES[slot] ?? slot,
      savedAt: Date.now(),
      level: levels.length ? Math.max(...levels) : 0,
      gold: party?.gold ?? 0,
      partyCount: party?.members?.length ?? 0,
      members: (party?.members ?? []).map((m) => ({ id: m.id, name: m.name, classId: m.classId, level: m.level })),
      mapId: loc?.mapId ?? null,
      location: loc ? `${loc.mapId} (${loc.x},${loc.y})` : "\u2014",
      playTimeSec: state?.playTimeSec ?? 0,
      cycle: state?.flags?.["ngplus_cycle"] ?? 1,
      // Task #105: completed saves show a ★ and offer Free Roam on the title.
      completed: !!state?.flags?.["game_completed"],
      freeRoam: !!state?.flags?.["free_roam"],
    };
  }

  write(slot, game) {
    if (!this.ids.includes(slot)) return { ok: false, reason: "invalid_slot" };
    const meta = this.computeMeta(slot, game);
    const json = serializeGame(game, { meta });
    const prev = this.manager.raw(slot);
    this.manager.store(slot, json);
    if (prev != null) this.manager.store(slot + "_bak", prev);
    return { ok: true, meta };
  }

  // Parse raw save JSON. Returns { state, party, inventory, version, meta }
  // on success, or { error: "corrupt" | "version" }.
  parse(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { error: "corrupt" };
    }
    if (!data || typeof data !== "object") return { error: "corrupt" };
    if (data.version == null || typeof data.version !== "number") return { error: "version" };
    if (data.version > SAVE_VERSION) return { error: "version" };
    try {
      const game = deserializeGame(data);
      return {
        state: game.state,
        party: game.party,
        inventory: game.inventory,
        version: data.version,
        meta: data.meta ?? null,
      };
    } catch {
      return { error: "corrupt" };
    }
  }

  read(slot) {
    if (!this.ids.includes(slot) || !this.manager.has(slot)) return null;
    const res = this.parse(this.manager.raw(slot));
    if (res?.error === "corrupt") {
      const bak = this.manager.raw(slot + "_bak");
      if (bak != null) {
        const r2 = this.parse(bak);
        if (r2 && !r2.error) {
          r2.fromBackup = true;
          return r2;
        }
      }
    }
    return res;
  }

  meta(slot) {
    const res = this.read(slot);
    if (!res || res.error) return null;
    return res.meta ?? null;
  }

  // Every slot with its presence + metadata (for list UIs).
  list() {
    return this.ids.map((id) => ({ slot: id, has: this.has(id), meta: this.meta(id) }));
  }

  // The most recently written occupied slot (drives \"Continue\" shortcuts).
  mostRecent() {
    let best = null;
    for (const id of this.ids) {
      const m = this.meta(id);
      if (!m) continue;
      if (!best || m.savedAt > best.meta.savedAt) best = { slot: id, meta: m };
    }
    return best;
  }

  erase(slot) {
    if (!this.ids.includes(slot)) return { ok: false, reason: "invalid_slot" };
    this.manager.delete(slot);
    this.manager.delete(slot + "_bak");
    return { ok: true };
  }
}
