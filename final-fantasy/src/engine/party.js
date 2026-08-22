// Task #6: Party Management System — up to four active members, a reserve
// bench, shared gold, and party-wide XP/healing.

import { levelUpAll } from "./stats.js";

export class PartyManager {
  constructor(opts = {}) {
    this.maxActive = opts.maxActive ?? 4;
    this.members = [];
    this.reserve = [];
    this.gold = opts.gold ?? 0;
  }

  add(member, toReserve = false) {
    const list = toReserve ? this.reserve : this.members;
    if (!toReserve && list.length >= this.maxActive) return false;
    if (list.includes(member)) return false;
    list.push(member);
    return true;
  }

  remove(memberId) {
    const idx = this.members.findIndex((m) => m.id === memberId);
    if (idx !== -1) {
      this.members.splice(idx, 1);
      return true;
    }
    const r = this.reserve.findIndex((m) => m.id === memberId);
    if (r !== -1) {
      this.reserve.splice(r, 1);
      return true;
    }
    return false;
  }

  swap(activeIndex, reserveIndex) {
    if (activeIndex < 0 || activeIndex >= this.members.length) return false;
    if (reserveIndex < 0 || reserveIndex >= this.reserve.length) return false;
    const tmp = this.members[activeIndex];
    this.members[activeIndex] = this.reserve[reserveIndex];
    this.reserve[reserveIndex] = tmp;
    return true;
  }

  count() {
    return this.members.length;
  }

  allAlive() {
    return this.members.length > 0 && this.members.every((m) => m.isAlive());
  }

  anyAlive() {
    return this.members.some((m) => m.isAlive());
  }

  allDead() {
    return this.members.length > 0 && this.members.every((m) => !m.isAlive());
  }

  healAll() {
    for (const m of this.members) m.restoreAll();
  }

  addGold(n) {
    this.gold += Math.max(0, n);
    return this.gold;
  }

  spendGold(n) {
    if (n < 0 || this.gold < n) return false;
    this.gold -= n;
    return true;
  }

  grantXp(amount) {
    const results = [];
    for (const member of this.members) {
      if (!member.isAlive()) continue;
      member.xp += amount;
      const ups = levelUpAll(member, member.class);
      if (ups.length) {
        results.push({ member, level: member.level, levelUps: ups.length });
      }
    }
    return results;
  }

  avgLevel() {
    if (!this.members.length) return 0;
    return this.members.reduce((sum, m) => sum + m.level, 0) / this.members.length;
  }
}
