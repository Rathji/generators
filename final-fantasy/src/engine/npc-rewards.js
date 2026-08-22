// Task #107: NpcRewardSystem — distributes one-time item/gold/xp grants from
// NPCs on dialogue-driven quest completion. Each reward hands out exactly
// once per save (`npc_reward_<id>_granted` flag), so a dialogue can safely
// call `grant()` as often as the player talks to the NPC. Pure logic, no DOM.

import { NPC_REWARDS } from "../data/npc-rewards.js";

export class NpcRewardSystem {
  constructor(defs = NPC_REWARDS, opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
    this.handlers = opts.handlers ?? {};
  }

  all() {
    return Object.values(this.defs);
  }

  def(id) {
    return this.defs[id] ?? null;
  }

  flagFor(id) {
    return "npc_reward_" + id + "_granted";
  }

  isGranted(id) {
    return !!(this.state && this.state.getFlag(this.flagFor(id)));
  }

  canGrant(id) {
    return !!this.def(id) && !this.isGranted(id);
  }

  // Hand the reward out (once). Returns what was given; item grants report
  // overflow via handlers.onFailed so the UI can say the inventory is full.
  grant(id) {
    const r = this.def(id);
    if (!r) return { ok: false, error: "unknown reward" };
    if (this.isGranted(id)) return { ok: false, error: "already granted", reward: r };
    if (typeof r.gold === "number" && this.party) this.party.addGold(r.gold);
    if (typeof r.xp === "number" && this.party) this.party.grantXp(r.xp);
    let added = true;
    if (r.item && this.inventory) added = this.inventory.add(r.item, r.count ?? 1);
    if (!added && this.handlers.onFailed) this.handlers.onFailed(r);
    this.state?.setFlag(this.flagFor(id), true);
    return {
      ok: true,
      reward: r,
      item: added && r.item ? { itemId: r.item, count: r.count ?? 1 } : null,
    };
  }

  // Human-readable description of what the reward grants.
  describe(id) {
    const r = this.def(id);
    if (!r) return "";
    const parts = [];
    if (r.item) parts.push((r.count > 1 ? r.count + "x " : "") + r.item);
    if (r.gold) parts.push(r.gold + "g");
    if (r.xp) parts.push(r.xp + "xp");
    return r.line ?? r.name + (parts.length ? " — " + parts.join(", ") : "");
  }

  status() {
    return this.all().map((r) => ({
      id: r.id,
      npc: r.npc,
      name: r.name,
      granted: this.isGranted(r.id),
    }));
  }
}
