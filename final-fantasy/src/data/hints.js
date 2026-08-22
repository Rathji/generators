// Task #109: NPC help/hint data — directed one-line guidance keyed to the
// main-story milestones, so an NPC ("ask for a hint") can steer a stuck
// party toward the nearest objective.

export const HINTS = {
  meet_the_king: {
    objective: "Meet the King of Cornelia",
    text: "The King waits in the castle's throne room — the guard at the castle gate will let you in.",
  },
  rescue_the_princess: {
    objective: "Rescue the Princess from Garland",
    text: "Garland holds the princess in the Chaos Shrine beyond the mountain pass. The Caves of Cornelia lie west of town — the way to the shrine leads through them.",
  },
  find_the_four_crystals: {
    objective: "Find the Four Crystals",
    text: "Guardians yet hold the crystals: the Marsh Guardian in the Marsh Cave on the south coast, the Forge Golem in Mount Gulg's depths, and the last waits behind the dark altar.",
  },
  face_chaos: {
    objective: "Face Chaos in the Shrine",
    text: "Chaos waits in the shrine's dark altar. The Earth Crystal's light has opened the way — climb the mountain pass and enter the shrine.",
  },
  restore_the_crystals: {
    objective: "Restore the Four Crystals",
    text: "The four crystals are freed and blazing as one. Their light has bridged the eastern sea — the darkness must now be banished for good.",
  },
};
