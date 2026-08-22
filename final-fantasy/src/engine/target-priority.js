// Task #64: Target Priority AI — enemies pick party targets by threat level
// (explicit aggro/tankiness) or HP percentage (weakest-link targeting),
// with a random fallback and deterministic tie-breaking.

export class TargetPrioritySystem {
  constructor(opts = {}) {
    this.rng = opts.random ?? Math.random;
  }

  // Threat score of a member: explicit `member.threat`, or an optional
  // lookup table keyed by id/name, defaulting to 0.
  threatOf(member, opts = {}) {
    if (typeof member?.threat === "number") return member.threat;
    const key = member?.id ?? member?.name;
    if (opts.threats && typeof opts.threats[key] === "number") return opts.threats[key];
    return 0;
  }

  hpFrac(m) {
    const max = m?.maxHp ?? (typeof m?.getStats === "function" ? m.getStats().maxHp : 1) ?? 1;
    return Math.max(0, (m?.hp ?? 0) / Math.max(1, max));
  }

  // Pick a target. Modes: "threat" (highest), "weakest"/"lowestHp"
  // (lowest HP fraction / lowest raw HP), "strongest", or "random".
  pick(candidates, opts = {}) {
    const list = [...candidates];
    if (!list.length) return null;
    const mode = opts.mode ?? "threat";
    if (mode === "random") return list[Math.floor(this.rng() * list.length)];
    const scorer =
      mode === "weakest"
        ? (m) => this.hpFrac(m)
        : mode === "lowestHp"
        ? (m) => (m?.hp ?? 0)
        : mode === "strongest"
        ? (m) => -this.hpFrac(m)
        : (m) => -this.threatOf(m, opts);
    const scored = list.map((m, i) => ({ m, i, s: scorer(m) })).sort((a, b) => a.s - b.s || a.i - b.i);
    const top = scored[0].s;
    const ties = scored.filter((x) => x.s === top);
    return ties[Math.floor(this.rng() * ties.length)].m;
  }

  // Full breakdown for UI/debugging.
  priorities(candidates, opts = {}) {
    return candidates.map((m) => ({
      target: m,
      threat: this.threatOf(m, opts),
      hp: m?.hp ?? 0,
      hpFrac: Math.round(this.hpFrac(m) * 100) / 100,
    }));
  }
}
