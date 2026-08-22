// Task #25: Random Encounter Generator — probability-based combat from step
// count plus the current map's encounter table. Guarantees a minimum step
// gap between fights and weights groups within a table.

import { ENCOUNTERS } from "../data/encounters.js";
import { EnemyTemplateSystem } from "./enemies.js";

export class EncounterGenerator {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.enemies = opts.enemySystem ?? new EnemyTemplateSystem({ random: this.rng });
    this.tables = opts.tables ?? ENCOUNTERS;
    // Task #198: optional post-creation scaler (the New Game+ system hooks
    // in here to grow every random encounter with the cycle).
    this.scaler = opts.scaler ?? null;
    // Task #122: optional global encounter-rate modifier.
    this.balance = opts.balance ?? null;
    this.totalSteps = 0;
    this.sinceLast = 0;
    this.lastEncounter = null;
  }

  // A map def may set `useGlobal: true` to roll from the global overworld
  // monster table (Task #37) or `theme` to roll from a themed dungeon table
  // (Task #56) instead of its own per-map table.
  tableFor(mapId) {
    const def = this.tables[mapId];
    if (!def) return null;
    if (def.useGlobal) return this.tables.global ?? null;
    if (def.theme) return this.tables[def.theme] ?? def;
    return def;
  }

  rawTable(mapId) {
    return this.tables[mapId] ?? null;
  }

  themeOf(mapId) {
    const def = this.rawTable(mapId);
    return def?.theme ?? null;
  }

  encounterRate(mapId) {
    const t = this.tableFor(mapId);
    return t ? t.rate : 0;
  }

  minGap(mapId) {
    const t = this.tableFor(mapId);
    return t && typeof t.minGap === "number" ? t.minGap : 1;
  }

  hasTable(mapId) {
    return !!this.rawTable(mapId);
  }

  usesGlobal(mapId) {
    const def = this.rawTable(mapId);
    return !!def && def.useGlobal === true;
  }

  reset() {
    this.totalSteps = 0;
    this.sinceLast = 0;
    this.lastEncounter = null;
    return this;
  }

  pickGroup(mapId, rng = this.rng) {
    const t = this.tableFor(mapId);
    if (!t || !t.table.length) return null;
    const total = t.table.reduce((sum, e) => sum + (e.weight ?? 1), 0);
    let roll = rng() * total;
    for (const entry of t.table) {
      roll -= entry.weight ?? 1;
      if (roll < 0) return entry;
    }
    return t.table[t.table.length - 1];
  }

  // Advance `steps` on the given map. Returns an encounter object when a
  // fight triggers, otherwise null.
  onStep(mapId, steps = 1) {
    this.totalSteps += steps;
    this.sinceLast += steps;
    const t = this.tableFor(mapId);
    if (!t || !t.rate || this.sinceLast < (t.minGap ?? 1)) return null;
    const rate = this.balance ? this.balance.encounterRate(t.rate) : t.rate;
    if (!rate || this.rng() >= rate) return null;
    const entry = this.pickGroup(mapId);
    if (!entry) return null;
    const enemies = this.enemies.createGroup(entry.group, this.rng);
    if (!enemies.length) return null;
    if (this.scaler) this.scaler(enemies);
    this.sinceLast = 0;
    this.lastEncounter = { mapId, groupId: entry.group, enemies, totalSteps: this.totalSteps };
    return this.lastEncounter;
  }

  // Force an encounter for a given map (used by triggers/bosses).
  forceEncounter(mapId, groupId = null) {
    const t = this.tableFor(mapId);
    const entry = groupId ? { group: groupId } : this.pickGroup(mapId);
    if (!entry) return null;
    const enemies = this.enemies.createGroup(entry.group, this.rng);
    if (!enemies.length) return null;
    if (this.scaler) this.scaler(enemies);
    this.lastEncounter = { mapId, groupId: entry.group, enemies, forced: true, totalSteps: this.totalSteps };
    return this.lastEncounter;
  }
}
