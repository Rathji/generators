// Plot-twist data (Task #150) — a mid-game global event that changes the
// party's goal. Fires once when all `require.flags` are met: it sets new
// `setFlags` (rewriting what the party is working toward) and updates the
// quest log headline until the story catches up (`resolvedFlag`).

export const PLOT_TWISTS = [
  {
    id: "king_conspiracy",
    name: "The King's Conspiracy",
    description:
      "Garland fell too easily — he was a puppet. The King's decree was honeyed poison, and the true enemy wears a crown. Seek the truth beyond the eastern sea.",
    dialogueId: "plot.twist_king",
    require: { flags: ["story_garland_defeated", "crystal_water"] },
    setFlags: {
      goal_seek_truth: true,
      twist_king_conspiracy_seen: true,
    },
    resolvedFlag: "story_chaos_defeated",
  },
];
