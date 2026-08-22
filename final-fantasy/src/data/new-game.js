// Task #201: New Game configuration — the starting state every fresh
// adventure is built from. The boot controller resets the live game to
// exactly this, so the values here are the single source of truth for what
// a brand-new save looks like.

export const NEW_GAME = {
  // Where a fresh hero stands when the prologue ends.
  start: { mapId: "cornelia", x: 7, y: 5, facing: "S" },

  // Shared starting gold (mirrors the party's gold).
  gold: 150,

  // Initial party — three heroes of light.
  party: [
    { id: "hero", name: "Hero", classId: "warrior" },
    { id: "mage", name: "Mage", classId: "blackMage" },
    { id: "healer", name: "Healer", classId: "whiteMage" },
  ],

  // Starting inventory as [itemId, count] pairs.
  items: [
    ["potion", 5],
    ["crystalKey", 1],
    // Task #148: every hero sets out with a lantern for the dark places.
    ["lantern", 1],
  ],

  // Flags every new game begins with.
  flags: { intro_seen: true },

  // Respawn point for the first GameOver checkpoint.
  checkpoint: { mapId: "cornelia", x: 7, y: 5, facing: "S", name: "Cornelia" },

  // Prologue narration shown the first time a new game boots.
  prologue: [
    "The world once lived in balance, governed by the power of the four Crystals.",
    "But darkness has swallowed the land, and the Crystals lie shattered...",
    "Four heroes of light set out from the town of Cornelia to restore them.",
  ],
};
