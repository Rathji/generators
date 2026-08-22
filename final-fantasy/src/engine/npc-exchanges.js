// Task #140: NpcExchangeSystem — player->NPC item gifts. A gift consumes the
// item(s) from the inventory, grants the reward, and (when `once`) marks the
// exchange complete so it can never be repeated on that save.

import { NPC_EXCHANGES } from "../data/npc-exchanges.js";

export class NpcExchangeSystem {
  constructor(defs = NPC_EXCHANGES, opts = {}) {
    this.defs = defs;
    this.state = opts.state ?? null;
    this.party = opts.party ?? null;
    this.inventory = opts.inventory ?? null;
  }

  all() {
    return Object.values(this.defs);
  }

  def(id) {
    return this.defs[id] ?? null;
  }

  flagFor(id) {
    return "npc_exchange_" + id + "_done";
  }

  isDone(id) {
    return !!(this.state && this.state.getFlag(this.flagFor(id)));
  }

  // Exchanges currently open for an NPC (not done and never-done ones).
  offersFor(npcId) {
    return this.all().filter((d) => d.npc === npcId && !this.isDone(d.id));
  }

  // The exchange an NPC will accept for a given item, if any.
  accepts(npcId, itemId) {
    return this.offersFor(npcId).find((d) => d.itemId === itemId) ?? null;
  }

  canOffer(defOrId) {
    const def = typeof defOrId === "string" ? this.def(defOrId) : defOrId;
    if (!def) return { ok: false, error: "unknown exchange" };
    if (this.isDone(def.id)) return { ok: false, error: "already done", def };
    const need = def.count ?? 1;
    if (this.inventory && !this.inventory.has(def.itemId, need)) {
      return { ok: false, error: "insufficient item", def, need: { itemId: def.itemId, count: need } };
    }
    return { ok: true, def };
  }

  // Hand the item over; on success the item is consumed and the reward
  // granted. Report overflow/insufficiencies through the return value so the
  // UI can say what happened.
  offer(id) {
    const check = this.canOffer(id);
    if (!check.ok) return check;
    const def = check.def;
    if (this.inventory) this.inventory.remove(def.itemId, def.count ?? 1);
    let granted = null;
    if (typeof def.reward?.gold === "number" && this.party) this.party.addGold(def.reward.gold);
    if (typeof def.reward?.xp === "number" && this.party) this.party.grantXp(def.reward.xp);
    if (def.reward?.itemId && this.inventory) {
      granted = this.inventory.add(def.reward.itemId, def.reward.count ?? 1)
        ? { itemId: def.reward.itemId, count: def.reward.count ?? 1 }
        : null;
    }
    if (def.once) this.state?.setFlag(this.flagFor(def.id), true);
    return {
      ok: true,
      def,
      consumed: { itemId: def.itemId, count: def.count ?? 1 },
      gold: def.reward?.gold ?? 0,
      xp: def.reward?.xp ?? 0,
      granted,
    };
  }

  describe(id) {
    const def = this.def(id);
    if (!def) return "";
    const parts = [];
    if (def.reward?.gold) parts.push(def.reward.gold + "g");
    if (def.reward?.xp) parts.push(def.reward.xp + "xp");
    if (def.reward?.itemId) parts.push((def.reward.count > 1 ? def.reward.count + "x " : "") + def.reward.itemId);
    return "Give " + (def.count > 1 ? def.count + "x " : "") + def.itemId + " to " + def.npc + (parts.length ? " for " + parts.join(", ") : "");
  }

  status() {
    return this.all().map((d) => ({
      id: d.id,
      npc: d.npc,
      itemId: d.itemId,
      done: this.isDone(d.id),
    }));
  }

  // Audit: every exchange must reference a real NPC in the placements and a
  // real item; rewards must resolve against the item db. `placements` may be
  // a NpcPlacementSystem or a raw mapId->list data object.
  audit(placements = null, itemDb = null) {
    const report = [];
    const knownNpc = (id) => {
      if (!placements) return true;
      if (typeof placements.npcById === "function") return !!placements.npcById(id);
      return Object.values(placements).some((list) => list.some((n) => n.id === id));
    };
    for (const def of this.all()) {
      if (def.once && !this.state) report.push({ id: def.id, error: "once exchange but no state to mark it" });
      if (itemDb && !itemDb[def.itemId]) report.push({ id: def.id, error: "unknown item " + def.itemId });
      if (itemDb && def.reward?.itemId && !itemDb[def.reward.itemId]) report.push({ id: def.id, error: "unknown reward item " + def.reward.itemId });
      if (!knownNpc(def.npc)) report.push({ id: def.id, error: "unknown npc " + def.npc });
    }
    return report;
  }
}
