// Task #54: Chest/Loot Spawn System — coordinate-based treasure chests that
// grant items (from weighted loot tables) and gold once; opened state is
// persisted via a world flag.

export class ChestSystem {
  constructor(chests = [], opts = {}) {
    this.chests = chests;
    this.state = opts.state ?? null;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
    this.random = opts.random ?? Math.random;
  }

  all() {
    return [...this.chests];
  }

  chestById(id) {
    return this.chests.find((c) => c.id === id) ?? null;
  }

  chestsFor(mapId) {
    return this.chests.filter((c) => c.mapId === mapId);
  }

  chestAt(mapId, x, y) {
    return this.chests.find((c) => c.mapId === mapId && c.x === x && c.y === y) ?? null;
  }

  isOpened(chest) {
    if (!chest) return false;
    if (!chest.flag || !this.state) return false;
    return this.state.getFlag(chest.flag);
  }

  canOpen(mapId, x, y) {
    const c = this.chestAt(mapId, x, y);
    if (!c) return { ok: false, error: "no chest", chest: null };
    if (this.isOpened(c)) return { ok: false, error: "already opened", chest: c };
    return { ok: true, chest: c };
  }

  // Roll a loot table (weighted? chance-based) into concrete item grants.
  rollContents(contents) {
    const items = [];
    for (const entry of contents.loot ?? []) {
      const chance = entry.chance ?? 1;
      if (chance >= 1 || this.random() > 1 - chance) {
        items.push({ itemId: entry.itemId, count: entry.count ?? 1 });
      }
    }
    for (const entry of contents.items ?? []) {
      items.push({ itemId: entry.itemId, count: entry.count ?? 1 });
    }
    return {
      items,
      gold: contents.gold ?? 0,
      xp: contents.xp ?? 0,
    };
  }

  // Task #112: rare item spawns — a chest may carry a rare item on a
  // separate, independent roll (`rare: { itemId, count, chance }`).
  rollRare(rare) {
    if (!rare) return null;
    const chance = rare.chance ?? 1;
    if (chance < 1 && this.random() >= chance) return null;
    return { itemId: rare.itemId, count: rare.count ?? 1 };
  }

  // Open a chest: roll contents, grant to inventory/party, mark opened.
  open(mapId, x, y) {
    const check = this.canOpen(mapId, x, y);
    if (!check.ok) return check;
    const chest = check.chest;
    const rolled = this.rollContents(chest.contents ?? {});
    const rare = this.rollRare(chest.rare ?? null);
    const granted = [];
    const overflow = [];
    for (const it of [...rolled.items, ...(rare ? [rare] : [])]) {
      if (this.inventory) {
        if (this.inventory.add(it.itemId, it.count)) granted.push({ ...it });
        else overflow.push({ ...it });
      } else {
        granted.push({ ...it });
      }
    }
    if (rolled.gold && this.party) this.party.addGold(rolled.gold);
    if (rolled.xp && this.party) this.party.grantXp(rolled.xp);
    if (chest.flag && this.state) this.state.setFlag(chest.flag, true);
    return {
      ok: true,
      chest: chest.id,
      items: granted,
      overflow,
      rare: rare && granted.some((g) => g.itemId === rare.itemId) ? { ...rare } : null,
      gold: rolled.gold,
      xp: rolled.xp,
    };
  }

  openedChests() {
    return this.chests.filter((c) => this.isOpened(c));
  }

  remaining() {
    return this.chests.filter((c) => !this.isOpened(c));
  }

  // Reset every opened flag (for new game / testing).
  reset() {
    for (const c of this.chests) {
      if (c.flag && this.state) this.state.clearFlag(c.flag);
    }
    return this;
  }
}
