// Plot data (Task #59) — the main questline as an ordered chapter chain.
// Task #100: expanded to the full arc — each guardian falls, its crystal is
// recovered, and the final confrontation with Chaos restores the light.
// Each chapter fires once its triggers are met; dialogue nodes live in
// src/data/dialogue.js ("plot.*").

export const PLOT = [
  {
    id: "ch1_kings_plea",
    name: "The King's Plea",
    triggers: [{ type: "flag", flag: "intro_seen" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.king_plea" },
      { type: "setFlag", flag: "plot_ch1_reward_ready" },
    ],
  },
  {
    id: "ch2_dark_knight",
    name: "The Dark Knight",
    triggers: [{ type: "flag", flag: "crystal_key_found" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.garland_warning" },
      { type: "setFlag", flag: "plot_ch2_done" },
    ],
  },
  {
    id: "ch3_garland_falls",
    name: "Garland Falls",
    triggers: [{ type: "flag", flag: "story_garland_defeated" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.garland_defeated" },
      { type: "setFlag", flag: "crystal_fire", value: true },
      { type: "setFlag", flag: "crystal_fire_dungeon_unlocked", value: true },
    ],
  },
  {
    id: "ch4_marsh_guardian_falls",
    name: "The Marsh Guardian Slain",
    triggers: [{ type: "flag", flag: "story_marsh_guardian_defeated" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.marsh_guardian_defeated" },
      { type: "setFlag", flag: "crystal_water", value: true },
      { type: "setFlag", flag: "crystal_water_dungeon_unlocked", value: true },
    ],
  },
  {
    id: "ch5_gulg_guardian_falls",
    name: "The Forge Golem Slain",
    triggers: [{ type: "flag", flag: "story_gulg_guardian_defeated" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.gulg_guardian_defeated" },
      { type: "setFlag", flag: "crystal_earth", value: true },
    ],
  },
  {
    id: "ch6_chaos_awaits",
    name: "Chaos Awaits",
    triggers: [{ type: "flag", flag: "crystal_earth" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.chaos_awaits" },
      { type: "setFlag", flag: "chaos_awaited", value: true },
    ],
  },
  {
    id: "ch7_chaos_defeated",
    name: "Chaos Falls",
    triggers: [{ type: "flag", flag: "story_chaos_defeated" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.chaos_defeated" },
      { type: "setFlag", flag: "crystal_wind", value: true },
    ],
  },
  {
    id: "ch8_light_restored",
    name: "The Light Returns",
    triggers: [{ type: "flag", flag: "crystal_wind" }],
    sequence: [
      { type: "dialogue", dialogueId: "plot.crystals_restored" },
      { type: "setFlag", flag: "story_crystals_restored", value: true },
      // Task #104: once the light returns, the ending becomes available.
      { type: "event", name: "ending" },
    ],
  },
];
