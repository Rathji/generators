// Task #122: Combat Math Balancing Pass — one data-driven place for the
// global damage/encounter/reward modifiers that tune the game's difficulty.
// All multipliers default to 1 (identity) so the baseline math is untouched;
// the BalanceSystem applies them at the combat seams.

export const BALANCE = Object.freeze({
  // Damage formula modifiers (applied after variance, before rounding).
  damageMultiplier: 1,
  // Encounter rate multiplier (0 = no random fights, 2 = twice as often).
  encounterRateMultiplier: 1,
  // Reward scaling.
  goldMultiplier: 1,
  xpMultiplier: 1,
  // Sanity window the audit checks the config lives in.
  audit: {
    minMultiplier: 0,
    maxMultiplier: 5,
  },
});
