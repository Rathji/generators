// src/quota.js — quota track (Task 10).
// A quota-icon building (e.g. Cloud Port) lets the acting player select any
// open quota space, pay its commodity (type + quantity) to the general
// supply, and place 1 influence token on the corresponding space. They gain
// the building's VP benefit (3 VP on the Cloud Port) plus the space's optional
// bonus: +1 VP, or +1 reputation (one more static placement on the reputation
// track). A space is closed once occupied for the rest of the game.
// The default space layout is provisional; Phase 9 content data replaces it.

export const QUOTA_BONUS = Object.freeze({ VP: "vp", REPUTATION: "reputation" });

export const DEFAULT_QUOTA_SPACES = Object.freeze([
  { id: "q1", commodity: { type: "wood", quantity: 2 }, bonus: QUOTA_BONUS.VP },
  { id: "q2", commodity: { type: "grain", quantity: 2 }, bonus: QUOTA_BONUS.REPUTATION },
  { id: "q3", commodity: { type: "clay", quantity: 2 }, bonus: QUOTA_BONUS.VP },
  { id: "q4", commodity: { type: "coal", quantity: 2 }, bonus: QUOTA_BONUS.REPUTATION },
]);

export function createQuotaTrack(config = {}) {
  const rawSpaces = config.spaces ?? DEFAULT_QUOTA_SPACES;
  if (!Array.isArray(rawSpaces) || rawSpaces.length < 1) {
    throw new Error("quota: spaces must be a non-empty array");
  }
  const seen = new Set();
  const spaces = rawSpaces.map(s => {
    if (!s || typeof s.id !== "string" || !s.id) throw new Error("quota: each space needs a string id");
    if (seen.has(s.id)) throw new Error("quota: duplicate space id '" + s.id + "'");
    seen.add(s.id);
    if (!s.commodity || typeof s.commodity.type !== "string" || !s.commodity.type ||
        !Number.isInteger(s.commodity.quantity) || s.commodity.quantity < 1) {
      throw new Error("quota: space '" + s.id + "' needs a commodity {type, quantity>0}");
    }
    if (s.bonus !== QUOTA_BONUS.VP && s.bonus !== QUOTA_BONUS.REPUTATION) {
      throw new Error("quota: space '" + s.id + "' has an unknown bonus '" + s.bonus + "'");
    }
    return { id: s.id, commodity: { type: s.commodity.type, quantity: s.commodity.quantity }, bonus: s.bonus, occupiedBy: null };
  });

  const influence = config.influence ?? null;
  const economy = config.economy ?? null;
  const reputation = config.reputation ?? null;
  const playerOf = config.playerOf ?? null;
  const vpBenefit = config.vpBenefit ?? 3;

  const track = {
    vpBenefit,
    spaces() {
      return spaces.map(s => ({ id: s.id, commodity: { ...s.commodity }, bonus: s.bonus, occupiedBy: s.occupiedBy }));
    },
    space(id) {
      const s = spaces.find(x => x.id === id);
      return s ? { id: s.id, commodity: { ...s.commodity }, bonus: s.bonus, occupiedBy: s.occupiedBy } : null;
    },
    isOpen(id) {
      const s = spaces.find(x => x.id === id);
      return !!s && s.occupiedBy === null;
    },
    occupant(id) {
      const s = spaces.find(x => x.id === id);
      return s ? s.occupiedBy : null;
    },

    sell(playerId, spaceId, opts = {}) {
      const sp = spaces.find(x => x.id === spaceId);
      if (!sp) return { ok: false, reason: "no_such_space", spaceId };
      if (sp.occupiedBy) return { ok: false, reason: "space_closed", spaceId, occupant: sp.occupiedBy };
      const commodity = sp.commodity;
      if (economy) {
        const afford = economy.canPay(playerId, { [commodity.type]: commodity.quantity });
        if (!afford) return { ok: false, reason: "insufficient", commodity: { ...commodity } };
      }
      if (influence) {
        const placed = influence.place(playerId, "quota:" + spaceId);
        if (!placed.ok) return placed;
      }
      if (economy) economy.pay(playerId, { [commodity.type]: commodity.quantity });
      sp.occupiedBy = playerId;

      let vpGained = opts.vpBenefit ?? vpBenefit;
      let reputationGained = 0;
      let bonusTaken = false;
      if (sp.bonus === QUOTA_BONUS.VP) {
        vpGained += 1;
        bonusTaken = true;
      } else if (sp.bonus === QUOTA_BONUS.REPUTATION && opts.takeBonus !== false) {
        if (reputation) {
          const repRes = reputation.place(playerId);
          if (repRes.ok) {
            reputationGained = 1;
            bonusTaken = true;
          }
        } else {
          reputationGained = 1;
          bonusTaken = true;
        }
      }
      if (vpGained > 0 && playerOf) {
        const p = playerOf(playerId);
        if (p && typeof p.addVp === "function") p.addVp(vpGained);
      }
      return { ok: true, spaceId, vpGained, reputationGained, bonusTaken, commodity: { ...commodity }, occupant: playerId };
    },

    toJSON() {
      return {
        kind: "quota",
        vpBenefit,
        spaces: spaces.map(s => ({ id: s.id, commodity: { ...s.commodity }, bonus: s.bonus, occupiedBy: s.occupiedBy })),
      };
    },
    fromJSON(data) {
      if (!data || typeof data !== "object") throw new Error("quota: bad fromJSON payload");
      for (const saved of data.spaces ?? []) {
        const sp = spaces.find(x => x.id === saved.id);
        if (!sp) throw new Error("quota: saved state references unknown space '" + saved.id + "'");
        sp.occupiedBy = saved.occupiedBy ?? null;
      }
      return track;
    },
  };
  return track;
}
