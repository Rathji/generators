// Task #9: Inventory Management System — stackable item storage with
// slot and weight limits, plus consumable effect resolution.
// Task #142: Item Stack Management — identical consumables/materials group
// into stacks with a per-slot cap (item.stackMax). When a single stack
// fills up, MORE stacks of the same item may be opened (up to maxSlots),
// so a potion hoard occupies several slots instead of being capped forever.
// Non-stackable items (keys, gear; stackMax <= 1) are still capped at one
// stack of 1 — two crystal keys still fail. `count()` remains the source
// of truth for how many of an item exist, and save serialization is done
// through `summary()` (aggregated), so old save files keep loading.

import { ITEMS } from "../data/items.js";
import { resolveItemEffect } from "./consumables.js";

const applyItemEffect = resolveItemEffect;
export { applyItemEffect };

export class Inventory {
  constructor(opts = {}) {
    this.maxSlots = opts.maxSlots ?? 30;
    this.maxWeight = opts.maxWeight ?? 100;
    this.stacks = new Map(); // itemId -> number[] of per-stack counts
    this.onAdd = opts.onAdd ?? null; // (itemId, count) => void
  }

  item(itemId) {
    return ITEMS[itemId];
  }

  stackCap(itemId) {
    const item = ITEMS[itemId];
    return item ? (item.stackMax ?? 1) : 1;
  }

  // Items whose stackMax > 1 may split across multiple stacks.
  stackable(itemId) {
    return this.stackCap(itemId) > 1;
  }

  count(itemId) {
    const arr = this.stacks.get(itemId);
    return arr ? arr.reduce((a, b) => a + b, 0) : 0;
  }

  has(itemId, n = 1) {
    return this.count(itemId) >= n;
  }

  usedSlots() {
    let n = 0;
    for (const arr of this.stacks.values()) n += arr.length;
    return n;
  }

  totalWeight() {
    let w = 0;
    for (const [id, arr] of this.stacks) {
      const total = arr.reduce((a, b) => a + b, 0);
      w += (ITEMS[id].weight || 0) * total;
    }
    return w;
  }

  // Number of brand-new stacks an add of `count` would need to open, given
  // how much room the existing stacks already have.
  _newStacksNeeded(item, count) {
    if (!item || count <= 0) return 0;
    const cap = this.stackCap(item.id);
    const cur = this.stacks.get(item.id) ?? [];
    let remaining = count;
    for (const s of cur) {
      if (remaining <= 0) break;
      remaining -= Math.max(0, cap - s);
    }
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / cap);
  }

  canAdd(itemId, count = 1) {
    const item = ITEMS[itemId];
    if (!item) return false;
    if (!(count > 0)) return false;
    const cap = this.stackCap(itemId);
    const cur = this.stacks.get(itemId) ?? [];
    // Non-stackable: never more than one stack of 1.
    if (cap <= 1) {
      if (cur.length > 0 || count > 1) return false;
    }
    const needed = this._newStacksNeeded(item, count);
    if (this.usedSlots() + needed > this.maxSlots) return false;
    if (this.totalWeight() + (item.weight || 0) * count > this.maxWeight) return false;
    return true;
  }

  // Add `count` of an item, filling existing partial stacks first and
  // opening new stacks (of up to stackMax) only as needed. Handles count
  // values larger than one stack's cap.
  add(itemId, count = 1) {
    if (!this.canAdd(itemId, count)) return false;
    const cap = this.stackCap(itemId);
    if (!this.stacks.has(itemId)) this.stacks.set(itemId, []);
    const cur = this.stacks.get(itemId);
    let remaining = count;
    for (let i = 0; i < cur.length && remaining > 0; i++) {
      const room = cap - cur[i];
      if (room <= 0) continue;
      const put = Math.min(room, remaining);
      cur[i] += put;
      remaining -= put;
    }
    while (remaining > 0) {
      const put = Math.min(cap, remaining);
      cur.push(put);
      remaining -= put;
    }
    if (this.onAdd) this.onAdd(itemId, count);
    return true;
  }

  // Remove `count` from the stacks (starting with the last stack).
  remove(itemId, count = 1) {
    if (this.count(itemId) < count) return false;
    const cur = this.stacks.get(itemId);
    let remaining = count;
    for (let i = cur.length - 1; i >= 0 && remaining > 0; i--) {
      const take = Math.min(cur[i], remaining);
      cur[i] -= take;
      remaining -= take;
    }
    const kept = cur.filter((n) => n > 0);
    if (kept.length) this.stacks.set(itemId, kept);
    else this.stacks.delete(itemId);
    return true;
  }

  // Split `count` off a specific stack into a new stack (must leave at
  // least 1 in the source, and the split amount must fit a fresh stack).
  split(itemId, stackIndex, count = 1) {
    const cur = this.stacks.get(itemId);
    if (!cur || stackIndex < 0 || stackIndex >= cur.length) return { ok: false, error: "no such stack" };
    if (count <= 0 || count >= cur[stackIndex]) return { ok: false, error: "invalid split count" };
    const cap = this.stackCap(itemId);
    if (count > cap) return { ok: false, error: "split exceeds stack cap" };
    if (this.usedSlots() >= this.maxSlots) return { ok: false, error: "no free slot" };
    cur[stackIndex] -= count;
    cur.push(count);
    return { ok: true, stacks: [...cur] };
  }

  // Consolidate partial stacks of one item into full stacks (fewer slots).
  merge(itemId) {
    const cur = this.stacks.get(itemId);
    if (!cur || cur.length <= 1) return { ok: false, error: "nothing to merge" };
    const cap = this.stackCap(itemId);
    const total = cur.reduce((a, b) => a + b, 0);
    const merged = [];
    let remaining = total;
    while (remaining > 0) {
      merged.push(Math.min(cap, remaining));
      remaining -= Math.min(cap, remaining);
    }
    this.stacks.set(itemId, merged);
    return { ok: true, stacks: [...merged] };
  }

  // Per-stack breakdown for one item (Task #142 diagnostic + UI).
  stackInfo(itemId) {
    return {
      itemId,
      cap: this.stackCap(itemId),
      stackable: this.stackable(itemId),
      stacks: [...(this.stacks.get(itemId) ?? [])],
      count: this.count(itemId),
      slots: (this.stacks.get(itemId) ?? []).length,
    };
  }

  stackStats() {
    return {
      slots: this.usedSlots(),
      maxSlots: this.maxSlots,
      weight: this.totalWeight(),
      maxWeight: this.maxWeight,
    };
  }

  // Aggregated counts — the serialization format used by save.js.
  summary() {
    return [...this.stacks.entries()].map(([id, arr]) => ({
      id,
      count: arr.reduce((a, b) => a + b, 0),
      stacks: arr.length,
    }));
  }

  use(itemId, target) {
    const item = ITEMS[itemId];
    if (!item) return { ok: false, error: "unknown item" };
    if (item.type !== "consumable") return { ok: false, error: "not usable" };
    if (!this.has(itemId)) return { ok: false, error: "not owned" };
    const result = applyItemEffect(item, target);
    if (result.ok) this.remove(itemId, 1);
    return result;
  }

  list() {
    return [...this.stacks.entries()].map(([id, arr]) => {
      const total = arr.reduce((a, b) => a + b, 0);
      return {
        id,
        name: ITEMS[id].name,
        type: ITEMS[id].type,
        count: total,
        stacks: arr.length,
        weight: ITEMS[id].weight || 0,
      };
    });
  }
}
