// Task #151: NPC Relationship Tracker — per-NPC affinity scored by
// interaction frequency (talk / exchange / quest help). Scores persist as
// raw number flags; crossing a tier threshold unlocks unique dialogue and
// grants its one-time reward. Dialogue reads scores through the dialogue
// world's `getAffinity(npcId)` helper.

export class NpcRelationSystem {
  constructor(defs = {}, opts = {}) {
    this.defs = defs; // npcId -> def
    this.state = opts.state ?? null;
    this.inventory = opts.inventory ?? null;
    this.party = opts.party ?? null;
  }

  all() {
    return Object.entries(this.defs).map(([npcId, d]) => ({ npcId, ...d }));
  }

  def(npcId) {
    return this.defs[npcId] ?? null;
  }

  // Raw numeric score (survives saves — flags ride the state snapshot).
  score(npcId) {
    return Number(this.state?.flags?.["npc_rel_" + npcId] ?? 0);
  }

  add(npcId, amount = 1) {
    const d = this.def(npcId);
    if (!d) return { ok: false, error: "unknown npc" };
    const next = Math.max(0, this.score(npcId) + Math.max(0, amount));
    if (this.state) this.state.flags["npc_rel_" + npcId] = next;
    const rewards = this.claimPending(npcId);
    return { ok: true, npcId, score: next, tier: this.tier(npcId), rewards };
  }

  // Highest tier whose threshold the current score meets (-1 below all).
  tierIndex(npcId) {
    const d = this.def(npcId);
    if (!d) return -1;
    const s = this.score(npcId);
    let idx = -1;
    for (let i = 0; i < d.tiers.length; i++) {
      if (s >= d.tiers[i].score) idx = i;
    }
    return idx;
  }

  tier(npcId) {
    const d = this.def(npcId);
    const i = this.tierIndex(npcId);
    return d && i >= 0 ? { ...d.tiers[i], index: i } : null;
  }

  tierLabel(npcId) {
    return this.tier(npcId)?.label ?? null;
  }

  // Grant the one-time reward for every tier just reached.
  claimPending(npcId) {
    const d = this.def(npcId);
    if (!d) return [];
    const granted = [];
    for (let i = 0; i < d.tiers.length; i++) {
      const t = d.tiers[i];
      if (this.score(npcId) < t.score) break;
      const flag = "npc_rel_" + npcId + "_tier_" + i;
      if (this.state && this.state.getFlag(flag)) continue;
      this.state?.setFlag(flag, true);
      const reward = this._grant(t.reward);
      granted.push({ tier: i, label: t.label, reward });
    }
    return granted;
  }

  _grant(reward) {
    if (!reward) return null;
    if (reward.item) {
      const ok = !!(this.inventory && this.inventory.add(reward.item, reward.count ?? 1));
      return { item: reward.item, count: reward.count ?? 1, ok };
    }
    if (reward.gold) {
      this.party?.addGold(reward.gold);
      return { gold: reward.gold };
    }
    if (reward.xp) {
      this.party?.grantXp(reward.xp);
      return { xp: reward.xp };
    }
    return null;
  }

  list() {
    return Object.keys(this.defs).map((npcId) => ({
      npcId,
      score: this.score(npcId),
      tier: this.tierLabel(npcId),
    }));
  }

  // Every relationship must reference a placed NPC.
  audit(placements) {
    const errors = [];
    for (const [npcId] of Object.entries(this.defs)) {
      if (!placements.npcById?.(npcId)) errors.push({ npcId, error: "no such placed NPC" });
    }
    return errors;
  }
}
