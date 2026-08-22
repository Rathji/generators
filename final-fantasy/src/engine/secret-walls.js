// Task #149: Secret Wall Detection — a solid wall coordinate hides a secret
// (a hidden path and/or a cache of loot). Walking INTO that wall (an
// attempted move that fails) reveals it. Revealed path walls become
// passable through the `passabilityOverride` hook (MovementSystem).

import { TileMap } from "./grid.js";

export class SecretWallSystem {
  constructor(walls = [], opts = {}) {
    this.walls = walls;
    this.state = opts.state ?? null;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
    this.random = opts.random ?? Math.random;
  }

  all() {
    return [...this.walls];
  }

  wallById(id) {
    return this.walls.find((w) => w.id === id) ?? null;
  }

  wallAt(mapId, x, y) {
    return this.walls.find((w) => w.mapId === mapId && w.x === x && w.y === y) ?? null;
  }

  isRevealed(wall) {
    if (!wall) return false;
    const flag = wall.revealFlag ?? "secret_" + wall.id;
    return !!(this.state && this.state.getFlag(flag));
  }

  revealed() {
    return this.walls.filter((w) => this.isRevealed(w));
  }

  // The player walked INTO a wall tile (a blocked step targeted it).
  probe(mapId, x, y) {
    const wall = this.wallAt(mapId, x, y);
    if (!wall) return { ok: false, error: "nothing here" };
    if (this.isRevealed(wall)) return { ok: false, error: "already revealed", wall };
    this.state?.setFlag(wall.revealFlag ?? "secret_" + wall.id, true);
    const effects = this._apply(wall.effects ?? []);
    return { ok: true, wall, line: wall.line, effects };
  }

  _apply(effects) {
    const out = [];
    for (const ef of effects) {
      if (ef.type === "path") {
        out.push({ type: "path", tiles: (ef.tiles ?? []).map((t) => ({ ...t })) });
      } else if (ef.type === "chest") {
        const contents = ef.contents ?? {};
        const items = [];
        for (const it of contents.items ?? []) items.push({ ...it });
        for (const l of contents.loot ?? []) {
          if (l.chance >= 1 || this.random() <= l.chance) items.push({ itemId: l.itemId, count: l.count ?? 1 });
        }
        const granted = [];
        for (const it of items) {
          if (this.inventory && this.inventory.add(it.itemId, it.count)) granted.push({ ...it });
        }
        const gold = contents.gold ?? 0;
        const xp = contents.xp ?? 0;
        if (gold && this.party) this.party.addGold(gold);
        if (xp && this.party) this.party.grantXp(xp);
        out.push({ type: "chest", items: granted, gold, xp });
      }
    }
    return out;
  }

  // Movement hook: "open" for revealed path walls, null elsewhere.
  passabilityOverride(mapId, x, y) {
    const w = this.wallAt(mapId, x, y);
    if (!w || !this.isRevealed(w)) return null;
    const opens = (w.effects ?? []).some(
      (ef) => ef.type === "path" && ef.tiles.some((t) => t.x === x && t.y === y)
    );
    return opens ? "open" : null;
  }

  // Every secret wall must sit on a solid tile (it's something to bump into).
  audit(registry) {
    const errors = [];
    for (const w of this.walls) {
      const def = registry?.get?.(w.mapId);
      if (!def) {
        errors.push({ id: w.id, error: "no such map: " + w.mapId });
        continue;
      }
      const tm = TileMap.fromAscii(def.rows, { tiles: def.tiles, solid: def.solid });
      if (!tm.isSolid(w.x, w.y)) errors.push({ id: w.id, error: "wall tile is not solid at " + w.x + "," + w.y });
    }
    return errors;
  }
}
