// Task #110/#111: GearTierSystem — the weapon/armor tier progression mapper.
// Answers "what tier is this, what upgrades it, and how far does the chain
// go?" for every piece of gear in the tier data, and audits that each chain
// steps up (never down) in its primary stat and contains only real items.

import { WEAPON_TIERS, ARMOR_TIERS } from "../data/gear-tiers.js";
import { ITEMS } from "../data/items.js";

const PRIMARY = { weapon: "atk", armor: "def" };

export class GearTierSystem {
  constructor(opts = {}) {
    this.items = opts.items ?? ITEMS;
    this.weaponChains = opts.weaponChains ?? WEAPON_TIERS;
    this.armorChains = opts.armorChains ?? ARMOR_TIERS;
  }

  _chainFor(itemId) {
    const item = this.items[itemId];
    if (!item) return null;
    const tables = item.type === "weapon" ? this.weaponChains : item.type === "armor" ? this.armorChains : null;
    if (!tables) return null;
    for (const [name, chain] of Object.entries(tables)) {
      const i = chain.indexOf(itemId);
      if (i >= 0) return { kind: item.type, chainName: name, chain, index: i };
    }
    return null;
  }

  // { kind, chainName, chain, index, item, next, prev } or null.
  tierOf(itemId) {
    const hit = this._chainFor(itemId);
    if (!hit) return null;
    const { kind, chainName, chain, index } = hit;
    return {
      itemId,
      kind,
      chainName,
      chain,
      index,
      size: chain.length,
      next: index + 1 < chain.length ? chain[index + 1] : null,
      prev: index > 0 ? chain[index - 1] : null,
    };
  }

  chain(itemId) {
    const t = this.tierOf(itemId);
    return t ? [...t.chain] : null;
  }

  nextTier(itemId) {
    return this.tierOf(itemId)?.next ?? null;
  }

  prevTier(itemId) {
    return this.tierOf(itemId)?.prev ?? null;
  }

  // True when `up` is strictly later in the same chain as `from`.
  isUpgrade(fromId, upId) {
    const a = this.tierOf(fromId);
    const b = this.tierOf(upId);
    if (!a || !b) return false;
    return a.chainName === b.chainName && b.index > a.index;
  }

  // The remaining upgrade path from an item to the top of its chain.
  upgradePath(itemId) {
    const t = this.tierOf(itemId);
    if (!t || !t.next) return [];
    return t.chain.slice(t.index + 1);
  }

  // Description, e.g. "Iron Sword — sword tier 2/11, +5 atk over previous."
  describe(itemId) {
    const t = this.tierOf(itemId);
    if (!t) return null;
    const item = this.items[itemId];
    const stat = PRIMARY[t.kind];
    const parts = [];
    if (t.prev) {
      const prev = this.items[t.prev];
      const d = (item.mods?.[stat] ?? 0) - (prev.mods?.[stat] ?? 0);
      if (d > 0) parts.push("+" + d + " " + stat + " over " + prev.name);
    }
    if (t.next) parts.push("next: " + this.items[t.next]?.name);
    else parts.push("pinnacle of its line");
    return {
      itemId,
      name: item.name,
      tier: t.index + 1,
      size: t.size,
      chain: t.chainName,
      next: t.next,
      summary: (item.name + " — " + t.chainName + " tier " + (t.index + 1) + "/" + t.size + (parts.length ? "; " + parts.join("; ") : "")),
    };
  }

  // Every chain's items in order, with names.
  report() {
    return {
      weapon: Object.entries(this.weaponChains).map(([name, chain]) => ({
        chain: name,
        items: chain.map((id) => ({ id, name: this.items[id]?.name ?? id })),
      })),
      armor: Object.entries(this.armorChains).map(([name, chain]) => ({
        chain: name,
        items: chain.map((id) => ({ id, name: this.items[id]?.name ?? id })),
      })),
    };
  }

  // Audit: every chain item exists, is the right type, and the primary stat
  // never decreases along the chain.
  audit() {
    const issues = [];
    const check = (kind, tables) => {
      const stat = PRIMARY[kind];
      for (const [name, chain] of Object.entries(tables)) {
        if (!Array.isArray(chain) || chain.length === 0) {
          issues.push({ chain: name, error: "empty chain" });
          continue;
        }
        let prevStat = -Infinity;
        let prevId = null;
        for (const id of chain) {
          const item = this.items[id];
          if (!item) {
            issues.push({ chain: name, item: id, error: "unknown item" });
            continue;
          }
          if (item.type !== kind) {
            issues.push({ chain: name, item: id, error: "wrong type: " + item.type });
            continue;
          }
          const s = item.mods?.[stat] ?? 0;
          if (s < prevStat) {
            issues.push({ chain: name, item: id, error: "stat drops: " + prevId + "(" + prevStat + ") -> " + id + "(" + s + ")" });
          }
          prevStat = s;
          prevId = id;
        }
      }
    };
    check("weapon", this.weaponChains);
    check("armor", this.armorChains);
    return { ok: issues.length === 0, issues };
  }
}
