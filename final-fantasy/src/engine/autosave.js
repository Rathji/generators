// Task #160: Auto-Save Trigger Logic — a temporary quick-save written on
// every map-ID transition, kept entirely apart from the three manual slots.
// The quick-save lives under its own storage key so it can never clobber a
// player save; restoring it hands the caller the same deserialized shape as
// SaveSlotSystem.read.

import { SaveManager, serializeGame } from "./save.js";

export const QUICKSAVE_KEY = "quicksave";

export class AutoSaveSystem {
  constructor(opts = {}) {
    this.manager = opts.manager ?? new SaveManager({ storage: opts.storage ?? null });
    this.key = opts.key ?? QUICKSAVE_KEY;
    this.enabled = opts.enabled ?? true;
    this.last = null; // { at, from, to }
    this.onSaved = opts.onSaved ?? null; // (info) => void
  }

  has() {
    return this.manager.has(this.key);
  }

  // Called on every map transition. Same-map steps are ignored; only a
  // change of map ID triggers a write.
  onTransition(from, to, game, meta = {}) {
    if (!this.enabled) return { ok: false, reason: "disabled" };
    if (from === to) return { ok: false, reason: "same_map" };
    const at = Date.now();
    const m = {
      ...meta,
      quicksave: true,
      at,
      from,
      to,
      playTimeSec: game?.state?.playTimeSec ?? 0,
      steps: game?.state?.flags?.["playtime_steps"] ?? 0,
    };
    this.manager.store(this.key, serializeGame(game, { meta: m }));
    this.last = { at, from, to };
    if (this.onSaved) this.onSaved(this.last);
    return { ok: true, savedAt: at, from, to };
  }

  // Read back the quick-save (same shape as SaveSlotSystem.read: parsed game
  // or {error}).
  read() {
    if (!this.has()) return null;
    return this.manager.load(this.key);
  }

  meta() {
    const r = this.read();
    return r?.meta ?? null;
  }

  note() {
    const m = this.meta();
    if (!m) return "No auto-save yet.";
    return "Auto-saved at " + m.from + " -> " + m.to + ".";
  }

  erase() {
    this.manager.delete(this.key);
    this.last = null;
    return this;
  }

  // Turn the quick-save into a real slot save (e.g. the player quicksaves
  // over a slot — implemented by the caller via slots.write).
  summary() {
    return {
      has: this.has(),
      key: this.key,
      last: this.last,
      meta: this.meta(),
    };
  }
}
