// Task #114: Monster Archetype System — resolves an enemy's archetype and
// merges archetype-level elemental affinities with the enemy template's own,
// so every monster's effective weakness/resistance profile is auditable.

import { ENEMY_ARCHETYPES, ENEMY_ARCHETYPE_ASSIGN } from "../data/archetypes.js";

export class MonsterArchetypeSystem {
  constructor(opts = {}) {
    this.archetypes = opts.archetypes ?? ENEMY_ARCHETYPES;
    this.assign = opts.assign ?? ENEMY_ARCHETYPE_ASSIGN;
    this.enemySystem = opts.enemySystem ?? null;
  }

  def(archetypeId) {
    return this.archetypes[archetypeId] ?? null;
  }

  defs() {
    return Object.entries(this.archetypes).map(([id, d]) => ({ id, ...d }));
  }

  archetypeOf(enemyId) {
    const aid = this.assign[enemyId];
    if (!aid) return null;
    return this.archetypes[aid] ?? null;
  }

  monstersIn(archetypeId) {
    return Object.entries(this.assign)
      .filter(([, aid]) => aid === archetypeId)
      .map(([id]) => id);
  }

  // Enemy ids with no archetype assignment (should be empty).
  uncovered() {
    if (!this.enemySystem) return [];
    return Object.keys(this.enemySystem.templates).filter((id) => !this.assign[id]);
  }

  effectiveWeaknesses(enemyId) {
    const t = this.enemySystem?.template(enemyId) ?? null;
    const a = this.archetypeOf(enemyId);
    return [...new Set([...(t?.elements?.weak ?? []), ...(a?.sharedWeak ?? [])])];
  }

  effectiveResists(enemyId) {
    const t = this.enemySystem?.template(enemyId) ?? null;
    const a = this.archetypeOf(enemyId);
    return [...new Set([...(t?.elements?.resist ?? []), ...(a?.sharedResist ?? [])])];
  }

  effectiveImmunes(enemyId) {
    const t = this.enemySystem?.template(enemyId) ?? null;
    const a = this.archetypeOf(enemyId);
    return [...new Set([...(t?.elements?.immune ?? []), ...(a?.sharedImmune ?? [])])];
  }

  describe(enemyId) {
    const t = this.enemySystem?.template(enemyId) ?? null;
    if (!t) return "Unknown enemy.";
    const a = this.archetypeOf(enemyId);
    if (!a) return t.name + " — no archetype.";
    const weak = this.effectiveWeaknesses(enemyId);
    const resist = this.effectiveResists(enemyId);
    return (
      t.name + " (" + a.name + ") — weak: " +
      (weak.length ? weak.join(", ") : "none") +
      "; resists: " + (resist.length ? resist.join(", ") : "none")
    );
  }

  audit() {
    const errors = [];
    for (const [id, d] of Object.entries(this.archetypes)) {
      if (!d.name) errors.push({ archetype: id, error: "missing name" });
      for (const key of ["sharedWeak", "sharedResist", "sharedImmune"]) {
        if (d[key] && !Array.isArray(d[key])) errors.push({ archetype: id, error: key + " not an array" });
      }
    }
    for (const [enemyId, aid] of Object.entries(this.assign)) {
      if (!this.archetypes[aid]) errors.push({ enemy: enemyId, archetype: aid, error: "unknown archetype" });
    }
    for (const id of this.uncovered()) errors.push({ enemy: id, error: "no archetype assigned" });
    return { ok: errors.length === 0, errors };
  }
}
