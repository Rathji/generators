// Task #23: Inn Restoration System — restore the party's HP/MP (and clear
// status ailments) for gold on Inn NPC/tile interaction.

export class InnSystem {
  constructor(opts = {}) {
    this.party = opts.party ?? null;
    this.cost = opts.cost ?? 40;
    this.freeIfFlag = opts.freeIfFlag ?? null;
    this.state = opts.state ?? null;
  }

  effectiveCost() {
    if (this.freeIfFlag && this.state && this.state.getFlag(this.freeIfFlag)) return 0;
    return this.cost;
  }

  // Which members actually need the inn (wounded, low MP, or afflicted)?
  membersNeedingRest() {
    if (!this.party) return [];
    return this.party.members.filter((m) => {
      const stats = m.getStats();
      return m.hp < stats.maxHp || m.mp < stats.maxMp || m.statuses.length > 0;
    });
  }

  canRest() {
    if (!this.party) return { ok: false, error: "no party" };
    if (!this.membersNeedingRest().length) return { ok: false, error: "already rested" };
    const cost = this.effectiveCost();
    if (this.party.gold < cost) return { ok: false, error: "insufficient gold", cost };
    return { ok: true, cost };
  }

  rest() {
    const check = this.canRest();
    if (!check.ok) return check;
    const cost = check.cost;
    if (cost > 0 && !this.party.spendGold(cost)) {
      return { ok: false, error: "gold transaction failed", cost };
    }
    for (const member of this.party.members) {
      member.restoreAll();
      member.statuses = [];
    }
    return { ok: true, cost, restored: this.party.members.length };
  }
}
