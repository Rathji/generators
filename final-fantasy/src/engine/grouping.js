// Task #115: Monster Grouping System — a thin wrapper over
// EnemyTemplateSystem + ENEMY_GROUPS that validates every encounter group,
// expands groups into concrete enemy instances, rolls uniform group ids, and
// summarizes group stats for encounter building and UI.

import { ENEMY_GROUPS } from "../data/enemies.js";

export class MonsterGroupingSystem {
  constructor(opts = {}) {
    this.groups = opts.groups ?? ENEMY_GROUPS;
    this.enemySystem = opts.enemySystem ?? null;
  }

  allGroups() {
    return Object.keys(this.groups);
  }

  hasGroup(groupId) {
    return !!this.groups[groupId];
  }

  groupDef(groupId) {
    return this.groups[groupId] ?? null;
  }

  // Every group entry must reference a real enemy template with count >= 1.
  validate() {
    const errors = [];
    for (const [groupId, entries] of Object.entries(this.groups)) {
      if (!Array.isArray(entries) || !entries.length) {
        errors.push({ group: groupId, error: "group has no entries" });
        continue;
      }
      for (const entry of entries) {
        if (!this.enemySystem) {
          errors.push({ group: groupId, error: "no enemy system" });
          break;
        }
        if (!this.enemySystem.exists(entry.id)) {
          errors.push({ group: groupId, entry: entry.id, error: "unknown enemy id" });
        }
        if (!entry.count || entry.count < 1) {
          errors.push({ group: groupId, entry: entry.id, error: "count must be >= 1" });
        }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  isValid() {
    return this.validate().ok;
  }

  // Expand a group into concrete enemy battle instances ([] for unknown).
  expand(groupId) {
    if (!this.enemySystem) return [];
    return this.enemySystem.createGroup(groupId);
  }

  // Uniform random group id (or null when no groups exist).
  pick(rng = Math.random) {
    const keys = this.allGroups();
    if (!keys.length) return null;
    return keys[Math.floor(rng() * keys.length)];
  }

  // "2 × Goblin + 1 × Imp"
  describe(groupId) {
    const def = this.groupDef(groupId);
    if (!def) return "Unknown group.";
    const parts = def.map((e) => {
      const name = this.enemySystem?.template(e.id)?.name ?? e.id;
      return e.count + " \u00d7 " + name;
    });
    return parts.join(" + ");
  }

  // Aggregate stats over the group's member templates.
  stats(groupId) {
    const def = this.groupDef(groupId);
    if (!def) return null;
    let members = 0;
    let minHp = Infinity;
    let maxHp = 0;
    let totalHp = 0;
    let xp = 0;
    let gold = 0;
    for (const entry of def) {
      const t = this.enemySystem?.template(entry.id) ?? null;
      const count = entry.count ?? 1;
      members += count;
      if (t) {
        minHp = Math.min(minHp, t.hp);
        maxHp = Math.max(maxHp, t.hp);
        totalHp += t.hp * count;
        xp += (t.xp ?? 0) * count;
        gold += (t.gold ?? 0) * count;
      }
    }
    return { groupId, members, minHp: minHp === Infinity ? 0 : minHp, maxHp, totalHp, xp, gold };
  }
}
