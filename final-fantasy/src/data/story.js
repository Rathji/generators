// Main story milestones (Task #38) — an ordered chain of narrative beats.
// Task #100: the chain now tracks the whole arc — after the rescue, the plot
// chapters (src/data/plot.js) recover each crystal, so the crystal-hunting
// milestones hand off to `face_chaos` and the final restoration. Each
// milestone becomes "ready" when all `flags` are set; starting it queues its
// `sequence`. A milestone is "done" when `completeOnFlag` is set (usually by
// its own sequence) or when its queued sequence finishes.

export const MAIN_STORY = [
  {
    id: "meet_the_king",
    name: "Meet the King of Cornelia",
    flags: [],
    completeOnFlag: "story_met_king",
    sequence: [
      { type: "setFlag", flag: "story_met_king", value: true },
      { type: "setFlag", flag: "story_started", value: true },
    ],
  },
  {
    id: "rescue_the_princess",
    name: "Rescue the Princess from Garland",
    flags: ["story_started"],
    completeOnFlag: "story_garland_defeated",
    sequence: [
      { type: "setFlag", flag: "crystal_fire_dungeon_unlocked", value: true },
    ],
  },
  {
    id: "find_the_four_crystals",
    name: "Find the Four Crystals",
    flags: ["story_garland_defeated"],
    completeOnFlag: "crystal_earth",
    sequence: null,
  },
  {
    id: "face_chaos",
    name: "Face Chaos in the Shrine",
    flags: ["crystal_earth"],
    completeOnFlag: "story_chaos_defeated",
    sequence: null,
  },
  {
    id: "restore_the_crystals",
    name: "Restore the Four Crystals",
    flags: ["story_chaos_defeated"],
    completeOnFlag: "story_crystals_restored",
    sequence: [
      { type: "setFlag", flag: "story_crystals_restored", value: true },
    ],
  },
];
