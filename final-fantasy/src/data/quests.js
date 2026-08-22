export const QUESTS = [
  {
    id: "prologue",
    name: "A Light in the Darkness",
    description: "Speak with the king of Cornelia about the failing crystal.",
    startsOnFlag: "prologue_started",
    completesOnFlag: "king_met",
    objectives: [
      { text: "Enter Castle Cornelia", flag: "entered_castle" },
      { text: "Speak with King Cornelia", flag: "king_met" },
    ],
  },
  {
    id: "crystal_one",
    name: "Restore the Earth Crystal",
    description: "Retrieve the Earth Crystal from the Caves of Cornelia.",
    startsOnFlag: "earth_crystal_quest",
    completesOnFlag: "earth_crystal_restored",
    failsOnFlag: "earth_crystal_lost",
    objectives: [
      { text: "Find the Crystal Key", flag: "crystal_key_found" },
      { text: "Defeat the Guardian", flag: "earth_guardian_defeated" },
      { text: "Restore the Earth Crystal", flag: "earth_crystal_restored" },
    ],
  },
  {
    id: "lost_cat",
    name: "The Missing Cat",
    description: "Find the blacksmith's cat somewhere in Cornelia.",
    startsOnFlag: "lost_cat_started",
    completesOnFlag: "lost_cat_found",
    objectives: [{ text: "Find the cat", flag: "lost_cat_found" }],
  },
];
