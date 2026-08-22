// Task #30: Enemy Stat Template System — instantiate enemies from the
// data-driven ENEMIES templates (with mutable battle state), build encounter
// groups, and roll loot tables.

import { ENEMIES, ENEMY_GROUPS } from "../data/enemies.js";

const cloneElements = (el) => ({
  weak: Array.isArray(el.weak) ? [...el.weak] : [],
  resist: Array.isArray(el.resist) ? [...el.resist] : [],
  immune: Array.isArray(el.immune) ? [...el.immune] : [],
});

export class EnemyTemplateSystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
    this.templates = opts.templates ?? ENEMIES;
    this.groups = opts.groups ?? ENEMY_GROUPS;
  }

  template(id) {
    return this.templates[id] ?? null;
  }

  exists(id) {
    return !!this.templates[id];
  }

  groupDef(groupId) {
    return this.groups[groupId] ?? null;
  }

  hasGroup(groupId) {
    return !!this.groups[groupId];
  }

  // Fresh battle instance — max stats preserved, current hp/mp mutable.
  createEnemy(id) {
    const t = this.templates[id];
    if (!t) return null;
    const enemy = {
      id: t.id,
      name: t.name,
      hp: t.hp,
      maxHp: t.hp,
      mp: t.mp,
      maxMp: t.mp,
      str: t.str,
      atk: t.atk,
      int: t.int,
      agi: t.agi,
      def: t.def,
      mdef: t.mdef,
      xp: t.xp ?? 0,
      gold: t.gold ?? 0,
      elements: cloneElements(t.elements ?? {}),
      loot: Array.isArray(t.loot) ? t.loot.map((l) => ({ ...l })) : [],
      ai: t.ai ? { ...t.ai, spells: t.ai.spells ? [...t.ai.spells] : [] } : null,
      boss: t.boss ?? false,
      phases: Array.isArray(t.phases) ? t.phases.map((p) => ({ ...p, ai: p.ai ? { ...p.ai, spells: p.ai.spells ? [...p.ai.spells] : [] } : null })) : [],
      currentPhase: 0,
      phaseTransitions: [],
    };
    if (t.ai && Array.isArray(t.ai.spells) && t.ai.spells.length) {
      enemy.getSpells = () => [...t.ai.spells];
    }
    return enemy;
  }

  createGroup(groupId, rng = this.rng) {
    const def = this.groups[groupId];
    if (!def) return [];
    const out = [];
    for (const entry of def) {
      for (let i = 0; i < entry.count; i++) {
        const e = this.createEnemy(entry.id);
        if (e) out.push(e);
      }
    }
    return out;
  }

  // Roll the enemy's loot table. Returns an array of dropped item ids.
  lootFor(enemy, rng = this.rng) {
    if (!enemy || !Array.isArray(enemy.loot)) return [];
    const dropped = [];
    for (const entry of enemy.loot) {
      if (rng() < entry.chance) dropped.push(entry.itemId);
    }
    return dropped;
  }

  // Total XP/gold available from a group of enemies (for reward resolution).
  rewardsFor(enemies) {
    return enemies.reduce(
      (acc, e) => ({ xp: acc.xp + (e.xp ?? 0), gold: acc.gold + (e.gold ?? 0) }),
      { xp: 0, gold: 0 }
    );
  }
}
