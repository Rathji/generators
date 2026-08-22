// Task #156: Miss/Critical Hit Indicators — clear visual + textual feedback
// during attack resolution. Pure logic: a CombatResolver-style hit result
// becomes a presentable indicator {kind, label, color, sfx}, and a round of
// hits summarizes into {crits, misses, hits, dramatic, summary}. DOM-free so
// the combat log and the popup layer can both consume it.

export const HIT_KINDS = {
  miss: { label: "MISS", color: "#9aa4c0", sfx: "miss" },
  crit: { label: "CRITICAL!", color: "#ffe14d", sfx: "crit" },
  hit: { label: "HIT", color: "#ff8a8a", sfx: "hit" },
  blocked: { label: "NO EFFECT", color: "#7a4a52", sfx: "block" },
};

export class HitIndicatorSystem {
  constructor(opts = {}) {
    this.kinds = opts.kinds ?? HIT_KINDS;
    this.rng = opts.random ?? Math.random;
  }

  // Classify a single hit result (from CombatResolver.attack / multiAttack
  // hits, or enemy-AI turns). Recognized fields:
  //   missed, critical, blocked (status-blocked action), damage.
  classify(hit = {}) {
    if (hit.blocked) return { kind: "blocked", ...this.kinds.blocked };
    if (hit.missed) return { kind: "miss", ...this.kinds.miss };
    if (hit.critical) return { kind: "crit", ...this.kinds.crit };
    return { kind: "hit", ...this.kinds.hit };
  }

  // Popup spec for the DamagePopupSystem — text + popup kind per hit.
  popupSpec(hit = {}) {
    if (hit.blocked) return { text: "Blocked", kind: "miss" };
    if (hit.missed) return { text: "MISS", kind: "miss" };
    if (hit.critical) return { text: "-" + (hit.damage ?? 0), kind: "crit" };
    return { text: "-" + (hit.damage ?? 0), kind: "damage" };
  }

  // One combat-log line for a hit.
  line(hit = {}, attackerName = "?", targetName = "?") {
    if (hit.blocked) return targetName + " resists the blow.";
    if (hit.missed) return attackerName + " attacks " + targetName + "... but misses!";
    if (hit.critical) {
      return attackerName + " lands a CRITICAL HIT on " + targetName + " for " + (hit.damage ?? 0) + " damage!";
    }
    return attackerName + " attacks " + targetName + " for " + (hit.damage ?? 0) + " damage.";
  }

  // Summarize a full round of hits into headline counts + the most dramatic
  // outcome (for a banner or a loud log line).
  summarize(hits = []) {
    const counts = { hits: 0, crits: 0, misses: 0, blocked: 0 };
    for (const h of hits) {
      if (h.blocked) counts.blocked++;
      else if (h.missed) counts.misses++;
      else if (h.critical) counts.crits++;
      else counts.hits++;
    }
    const dramatic = counts.crits
      ? "crit"
      : counts.misses
        ? "miss"
        : counts.blocked
          ? "blocked"
          : "hit";
    return {
      ...counts,
      total: hits.length,
      dramatic,
      dramaticLine:
        dramatic === "crit"
          ? "CRITICAL! " + counts.crits + " strike" + (counts.crits === 1 ? "" : "s") + " land hard!"
          : dramatic === "miss"
            ? counts.misses === hits.length
              ? "Every attack whiffs through the air!"
              : counts.misses + " attack" + (counts.misses === 1 ? " misses" : "s miss") + "."
            : dramatic === "blocked"
              ? "The blows are turned aside."
              : "",
      hasCrit: counts.crits > 0,
      hasMiss: counts.misses > 0,
    };
  }
}
