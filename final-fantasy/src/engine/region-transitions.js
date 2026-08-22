// Task #120: Overworld Transition Visuals — fade + directional pan between
// maps when the travel crosses a region boundary (town <-> overworld <-> dun
// geon). The pan direction derives from optional map world-coordinates; with
// none it falls back to a plain crossfade. Core is DOM-free (injected wait /
// screen seams) so it is fully testable.

import { classifyMap } from "../data/music-regions.js";

const SLIDE_FOR = {
  E: "left", // travelling east -> the new scene slides in from the west
  W: "right",
  N: "down",
  S: "up",
};

export class RegionTransitionSystem {
  constructor(opts = {}) {
    this.screen = opts.screen ?? null; // ScreenTransitionSystem
    this.coords = opts.coords ?? null; // (mapId) => {x, y} | null
    this.duration = opts.duration ?? 220;
    this.log = [];
  }

  regionOf(mapId) {
    return classifyMap(mapId);
  }

  isRegionChange(fromMapId, toMapId) {
    if (!fromMapId || !toMapId || fromMapId === toMapId) return false;
    return classifyMap(fromMapId) !== classifyMap(toMapId);
  }

  // Cardinal direction of travel between two maps ("center" when unknown).
  direction(fromMapId, toMapId) {
    if (!this.coords) return "center";
    const a = this.coords(fromMapId);
    const b = this.coords(toMapId);
    if (!a || !b) return "center";
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "E" : "W";
    if (dy !== 0) return dy > 0 ? "S" : "N";
    return "center";
  }

  describe(fromMapId, toMapId) {
    return {
      from: fromMapId,
      to: toMapId,
      regionChange: this.isRegionChange(fromMapId, toMapId),
      fromRegion: this.regionOf(fromMapId),
      toRegion: this.regionOf(toMapId),
      direction: this.direction(fromMapId, toMapId),
    };
  }

  _record(name, opts) {
    this.log.push({ name, at: Date.now(), ...opts });
  }

  // Fade out, run `onSwap`, then pan/fade in from the travel direction.
  // Safe when no screen is attached (runs onSwap immediately).
  async transitionTo(fromMapId, toMapId, onSwap = null, opts = {}) {
    const dir = this.direction(fromMapId, toMapId);
    const d = opts.duration ?? this.duration;
    const screen = this.screen;
    let usedScreen = false;
    if (screen && !screen.isRunning()) {
      await screen.fadeOut({ ...opts, duration: d });
      usedScreen = true;
      this._record("fadeOut", { from: fromMapId, to: toMapId, duration: d });
    }
    if (onSwap) await onSwap();
    this._record("swap", { to: toMapId });
    if (screen && !screen.isRunning()) {
      if (dir === "center" || !SLIDE_FOR[dir]) {
        await screen.fadeIn({ ...opts, duration: d });
        this._record("fadeIn", { to: toMapId, duration: d });
      } else {
        await screen.slide(SLIDE_FOR[dir], { ...opts, duration: d });
        this._record("panIn", { to: toMapId, direction: dir, duration: d });
      }
      usedScreen = true;
    }
    return { ok: true, from: fromMapId, to: toMapId, direction: dir, usedScreen };
  }
}
