// Task #145: GearDurabilitySystem — tracks per-character wear on high-tier
// gear, rolls a break chance after every battle, and handles repair (the
// inn mends all; the cost scales with the piece's value). Broken gear stays
// equipped but contributes no stats until repaired — the stats pipeline
// consults `brokenSet(char)` through the setBrokenItems hook in main.js.
//
// Wear lives on the Character (`char.gearWear = { itemId: {cur, max} }`),
// which is optional and serialized additively by the save system.

import { GEAR_DURABILITY } from "../data/gear-durability.js";
import { ITEMS } from "../data/items.js";

export class GearDurabilitySystem {
  constructor(defs = GEAR_DURABILITY, opts = {}) {
    this.defs = defs;
    this.rng = opts.random ?? Math.random;
    this.party = opts.party ?? null;
  }

  tracked(itemId) {
    return this.defs[itemId] ?? null;
  }

  // The character's wear ledger (created on demand).
  wear(char) {
    if (!char.gearWear || typeof char.gearWear !== "object") char.gearWear = {};
    return char.gearWear;
  }

  _ensure(char, itemId) {
    const def = this.tracked(itemId);
    if (!def) return null;
    const w = this.wear(char);
    if (!w[itemId]) w[itemId] = { cur: def.max, max: def.max };
    return w[itemId];
  }

  durabilityOf(char, itemId) {
    const w = this.wear(char)[itemId];
    return w ? { ...w } : null;
  }

  isBroken(char, itemId) {
    const w = this.wear(char)[itemId];
    return !!w && w.cur <= 0;
  }

  brokenItems(char) {
    return Object.entries(this.wear(char))
      .filter(([, w]) => w.cur <= 0)
      .map(([id]) => id);
  }

  // The Set consumed by stats.js — broken pieces contribute no mods.
  brokenSet(char) {
    return new Set(this.brokenItems(char));
  }

  // Roll durability loss for every equipped tracked piece of one character
  // after a battle. Returns the events ({itemId, durability, max, broken}).
  afterBattle(char) {
    const events = [];
    for (const itemId of Object.values(char.equipment ?? {})) {
      if (!itemId) continue;
      const def = this.tracked(itemId);
      if (!def) continue;
      const w = this._ensure(char, itemId);
      if (w.cur <= 0) continue;
      if (this.rng() < def.breakChance) {
        w.cur -= 1;
        events.push({ itemId, durability: w.cur, max: w.max, broken: w.cur <= 0 });
      }
    }
    return events;
  }

  afterBattleParty(members = []) {
    return members.flatMap((m) =>
      this.afterBattle(m).map((e) => ({ ...e, memberId: m.id, name: m.name, itemName: ITEMS[e.itemId]?.name ?? e.itemId }))
    );
  }

  // Gold cost to fully restore one piece (a quarter of its base value,
  // prorated by how worn it is; broken pieces are always fully charged).
  repairCost(char, itemId) {
    const def = this.tracked(itemId);
    const w = this.wear(char)[itemId];
    if (!def || !w || w.cur >= w.max) return 0;
    const value = ITEMS[itemId]?.price ?? 100;
    return Math.max(1, Math.ceil((def.max - w.cur) * value * 0.25));
  }

  repair(char, itemId) {
    const def = this.tracked(itemId);
    const w = this.wear(char)[itemId];
    if (!def || !w) return { ok: false, error: "not damaged" };
    if (w.cur >= w.max) return { ok: false, error: "already pristine", itemId };
    const cost = this.repairCost(char, itemId);
    if (this.party && this.party.gold < cost) return { ok: false, error: "insufficient gold", cost, itemId };
    if (this.party) this.party.spendGold(cost);
    w.cur = w.max;
    return { ok: true, cost, itemId, itemName: ITEMS[itemId]?.name ?? itemId };
  }

  repairAll(char) {
    return this.brokenItems(char)
      .concat(
        Object.entries(this.wear(char))
          .filter(([, w]) => w.cur < w.max && w.cur > 0)
          .map(([id]) => id)
      )
      .map((itemId) => this.repair(char, itemId));
  }

  repairAllParty(members = []) {
    const events = [];
    for (const m of members) {
      for (const r of this.repairAll(m)) {
        events.push({ ...r, memberId: m.id, name: m.name });
      }
    }
    return events;
  }

  summary(char) {
    return Object.entries(this.wear(char)).map(([itemId, w]) => ({
      itemId,
      itemName: ITEMS[itemId]?.name ?? itemId,
      cur: w.cur,
      max: w.max,
      broken: w.cur <= 0,
    }));
  }

  // Audit: every def must reference a real item with a sane break chance.
  audit(itemDb = ITEMS) {
    const report = [];
    for (const [itemId, def] of Object.entries(this.defs)) {
      if (!itemDb[itemId]) report.push({ itemId, error: "unknown item" });
      if (!(def.max > 0)) report.push({ itemId, error: "bad max" });
      if (def.breakChance < 0 || def.breakChance > 1) report.push({ itemId, error: "bad breakChance" });
    }
    return report;
  }
}
