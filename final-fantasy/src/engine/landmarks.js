// Task #73: Overworld Landmark Markers — highlights/labels for key landmarks
// on the world map. Landmarks may be hidden behind a reveal flag (e.g. the
// Chaos Shrine only appears once the player learns of it).

import { LANDMARKS } from "../data/landmarks.js";

export class LandmarkMarkerSystem {
  constructor(landmarks = LANDMARKS, opts = {}) {
    this.landmarks = landmarks;
    this.state = opts.state ?? null;
  }

  bindState(state) {
    this.state = state;
    return this;
  }

  all() {
    return this.landmarks;
  }

  landmarkById(id) {
    return this.landmarks.find((m) => m.id === id) ?? null;
  }

  markersFor(mapId) {
    return this.landmarks.filter((m) => m.mapId === mapId);
  }

  markerAt(mapId, x, y) {
    return this.landmarks.find((m) => m.mapId === mapId && m.x === x && m.y === y) ?? null;
  }

  isRevealed(m) {
    if (!m.revealFlag) return true;
    if (!this.state) return false;
    return !!this.state.getFlag?.(m.revealFlag) ?? !!this.state.flags?.[m.revealFlag];
  }

  revealed(mapId) {
    return this.markersFor(mapId).filter((m) => this.isRevealed(m));
  }

  // Landmarks within `radius` tiles of the player (Manhattan distance).
  markersNear(mapId, x, y, radius = 2) {
    return this.revealed(mapId).filter((m) => Math.abs(m.x - x) + Math.abs(m.y - y) <= radius);
  }

  hint(m, x, y) {
    const dx = m.x - x;
    const dy = m.y - y;
    if (dx === 0 && dy === 0) return m.icon + " " + m.label + " — you are here.";
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "to the east" : "to the west") : dy > 0 ? "to the south" : "to the north";
    return m.icon + " " + m.label + " lies " + dir + ".";
  }

  // Compass hint for the nearest revealed landmark on the map.
  nearestHint(mapId, x, y) {
    const ms = this.revealed(mapId);
    if (!ms.length) return null;
    let best = null;
    for (const m of ms) {
      const d = Math.abs(m.x - x) + Math.abs(m.y - y);
      if (!best || d < best.d) best = { m, d };
    }
    return this.hint(best.m, x, y);
  }

  summary(mapId, x, y) {
    return this.revealed(mapId).map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      label: m.label,
      x: m.x,
      y: m.y,
      distance: Math.abs(m.x - x) + Math.abs(m.y - y),
    }));
  }
}
