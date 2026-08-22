// Task #29: AoE Target Resolver — maps a spell's `target` scope to concrete
// target lists (single enemy, all enemies, single ally, all allies, self).

export const TARGET_SCOPES = Object.freeze([
  "single-enemy",
  "all-enemies",
  "single-ally",
  "all-allies",
  "self",
]);

export function isAlive(c) {
  return (c && (c.hp ?? 0) > 0) === true;
}

export class TargetResolver {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
  }

  alive(list) {
    return (list || []).filter(isAlive);
  }

  randomOf(list) {
    if (!list.length) return null;
    return list[Math.floor(this.rng() * list.length)];
  }

  // Pick a valid target honoring an optional chosen target (used for single
  // target spells). Falls back to a random alive member of the pool.
  pick(chosen, pool, fallback) {
    if (chosen && pool.includes(chosen) && isAlive(chosen)) return chosen;
    const alive = this.alive(pool);
    if (!alive.length) return null;
    return this.randomOf(alive) ?? fallback;
  }

  // Return the scope resolution for a spell: { scope, targets, source }.
  // `chosen` is an optional explicit target for single-target spells.
  resolveTargets(spell, source, party, enemies, chosen = null) {
    const scope = spell.target ?? "single-enemy";
    let targets = [];
    switch (scope) {
      case "single-enemy": {
        const t = this.pick(chosen, enemies, null);
        if (t) targets = [t];
        break;
      }
      case "all-enemies":
        targets = this.alive(enemies);
        break;
      case "single-ally": {
        const t = this.pick(chosen, party, source);
        if (t) targets = [t];
        break;
      }
      case "all-allies":
        targets = this.alive(party);
        break;
      case "self":
        targets = [source];
        break;
      default:
        targets = [];
    }
    return { scope, targets, source };
  }

  // Convenience: does this spell affect the whole enemy party?
  isArea(spell) {
    return spell.target === "all-enemies" || spell.target === "all-allies";
  }
}
