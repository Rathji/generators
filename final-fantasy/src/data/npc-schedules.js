// Task #138: NPC Schedule Data — timer-based movement between coordinates
// based on the game clock. Each entry lists the hour windows (0-23, `from`
// inclusive, `to` exclusive) during which the NPC stands at a position. An
// NPC with no matching window for the current hour simply stays at its base
// placement. Schedules never override quest `states` (a resolved state pins
// the NPC in place).

export const NPC_SCHEDULES = {
  // The Cornelia gate guard patrols the town gate by day, the castle road by
  // afternoon, and returns to the gate at night.
  cornelia_guard: [
    { from: 6, to: 12, x: 8, y: 3, facing: "S" },
    { from: 12, to: 18, x: 9, y: 3, facing: "E" },
    { from: 18, to: 24, x: 8, y: 3, facing: "S" },
    { from: 0, to: 6, x: 8, y: 3, facing: "S" },
  ],
  // The blacksmith works the forge by day and drinks at the inn at night.
  cornelia_blacksmith: [
    { from: 7, to: 17, x: 3, y: 5, facing: "W" },
    { from: 17, to: 22, x: 4, y: 4, facing: "N" },
  ],
  // The Cornelia elder sits by the fountain in the morning, by the garden
  // wall in the afternoon.
  cornelia_elder: [
    { from: 6, to: 12, x: 2, y: 3, facing: "E" },
    { from: 12, to: 18, x: 2, y: 4, facing: "S" },
  ],
  // The Elfheim guard trades shifts at the gate.
  elfheim_guard: [
    { from: 6, to: 14, x: 8, y: 1, facing: "S" },
    { from: 14, to: 22, x: 7, y: 1, facing: "S" },
  ],
  // The Windfall fisher mends nets by the pier at midday.
  windfall_fisher: [
    { from: 10, to: 14, x: 12, y: 6, facing: "N" },
    { from: 6, to: 10, x: 12, y: 5, facing: "N" },
    { from: 14, to: 20, x: 12, y: 5, facing: "W" },
  ],
  // The Dwarfholm miner walks the old seams in the afternoon.
  dwarfholm_miner: [
    { from: 8, to: 12, x: 2, y: 3, facing: "E" },
    { from: 12, to: 18, x: 3, y: 3, facing: "S" },
  ],
};
