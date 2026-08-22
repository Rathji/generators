// Task #147: Environmental Damage Zones — lava/acid tiles that deal damage
// per step (and may inflict statuses) while the party stands on them, unless
// protected. Protection is delegated to an optional hook (e.g. the party
// wearing the Magma Heart), so zones are gear-protectable by design.

import { TileMap } from "./grid.js";

export class HazardZoneSystem {
  constructor(zones = [], opts = {}) {
    this.zones = zones;
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.status = opts.status ?? null;
    this.random = opts.random ?? Math.random;
    this.protectionHook = opts.protectionHook ?? null; // (zone, party) => boolean
  }

  all() {
    return [...this.zones];
  }

  zoneById(id) {
    return this.zones.find((z) => z.id === id) ?? null;
  }

  zonesFor(mapId) {
    return this.zones.filter((z) => z.mapId === mapId);
  }

  zoneAt(mapId, x, y) {
    return (
      this.zones.find((z) => z.mapId === mapId && z.tiles.some((t) => t.x === x && t.y === y)) ??
      null
    );
  }

  // Whether the party is currently protected from this zone (gear/hook).
  isProtected(zone) {
    return this.protectionHook ? !!this.protectionHook(zone, this.party) : false;
  }

  // The party stands on (mapId, x, y): apply zone damage/status for this step.
  step(mapId, x, y) {
    const zone = this.zoneAt(mapId, x, y);
    if (!zone) return { ok: false, error: "no hazard", zone: null };
    if (this.isProtected(zone)) {
      return { ok: true, zone, protected: true, damage: 0, status: null, events: [] };
    }
    const events = [];
    const members = this.party?.members ?? [];
    for (const m of members) {
      if (m.hp <= 0) continue;
      if (zone.damage) {
        if (typeof m.damage === "function") m.damage(zone.damage);
        else m.hp = Math.max(0, m.hp - zone.damage);
        events.push({ type: "damage", member: m, amount: zone.damage });
      }
      if (zone.status && this.status && m.hp > 0) {
        const r = this.status.apply(m, zone.status.id, {
          chance: zone.status.chance ?? 1,
          turns: zone.status.turns,
        });
        if (r.ok) events.push({ type: "status", member: m, status: zone.status.id });
      }
    }
    return {
      ok: true,
      zone,
      protected: false,
      damage: zone.damage ?? 0,
      status: zone.status?.id ?? null,
      events,
      line: zone.line,
    };
  }

  // Every zone tile must be a walkable tile of its map.
  audit(registry) {
    const errors = [];
    for (const z of this.zones) {
      const def = registry?.get?.(z.mapId);
      if (!def) {
        errors.push({ id: z.id, error: "no such map: " + z.mapId });
        continue;
      }
      const tm = TileMap.fromAscii(def.rows, { tiles: def.tiles, solid: def.solid });
      for (const t of z.tiles) {
        if (!tm.canStand(t.x, t.y)) {
          errors.push({ id: z.id, error: "tile not walkable at " + t.x + "," + t.y });
        }
      }
    }
    return errors;
  }
}
