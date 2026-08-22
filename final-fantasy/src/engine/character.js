// Task #6/7/8: Character model — class-based stats, equipment slots,
// spell knowledge, and HP/MP/status helpers.

import { CLASSES } from "../data/classes.js";
import { ITEMS } from "../data/items.js";
import { SPELLS } from "../data/spells.js";
import { getEffectiveStats } from "./stats.js";

export class Character {
  constructor(opts = {}) {
    this.id = opts.id;
    this.name = opts.name;
    this.classId = opts.classId;
    this.level = opts.level ?? 1;
    this.xp = opts.xp ?? 0;
    this.equipment = { weapon: opts.weapon ?? null, armor: opts.armor ?? null, accessory: opts.accessory ?? null };
    this.statuses = [];
    this.extraSpells = opts.extraSpells ? [...opts.extraSpells] : [];
    const stats = this.getStats();
    this.hp = opts.hp ?? stats.maxHp;
    this.mp = opts.mp ?? stats.maxMp;
  }

  get class() {
    return CLASSES[this.classId];
  }

  getStats() {
    return getEffectiveStats(this, this.class, ITEMS);
  }

  // Class spells unlocked by level, plus any extra spells learned (Task #28).
  getSpells() {
    const learned = new Set(this.class.spells.filter((s) => s.lvl <= this.level).map((s) => s.spell));
    for (const id of this.extraSpells) learned.add(id);
    return [...learned];
  }

  canCast(spellId) {
    return this.getSpells().includes(spellId);
  }

  knowsSpell(spellId) {
    return this.getSpells().includes(spellId);
  }

  learnSpell(spellId) {
    if (!SPELLS[spellId]) return false;
    if (this.knowsSpell(spellId)) return false;
    this.extraSpells.push(spellId);
    return true;
  }

  forgetSpell(spellId) {
    const idx = this.extraSpells.indexOf(spellId);
    if (idx === -1) return false;
    this.extraSpells.splice(idx, 1);
    return true;
  }

  damage(n) {
    this.hp = Math.max(0, this.hp - Math.max(0, n));
  }

  heal(n) {
    this.hp = Math.min(this.getStats().maxHp, this.hp + Math.max(0, n));
  }

  spendMp(n) {
    this.mp = Math.max(0, this.mp - Math.max(0, n));
  }

  restoreMp(n) {
    this.mp = Math.min(this.getStats().maxMp, this.mp + Math.max(0, n));
  }

  restoreAll() {
    const s = this.getStats();
    this.hp = s.maxHp;
    this.mp = s.maxMp;
  }

  isAlive() {
    return this.hp > 0;
  }

  addStatus(status) {
    if (!this.statuses.includes(status)) this.statuses.push(status);
  }

  removeStatus(status) {
    this.statuses = this.statuses.filter((s) => s !== status);
  }

  hasStatus(status) {
    return this.statuses.includes(status);
  }
}
