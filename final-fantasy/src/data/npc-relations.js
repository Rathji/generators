// NPC relationship data (Task #151) — affinity scores per key NPC, earned
// by talking to them, trading with them, and helping them. Higher tiers
// unlock unique dialogue (matched by affinity in data/dialogue.js) and
// one-time reward grants.

export const NPC_RELATIONS = {
  cornelia_guard: {
    npcId: "cornelia_guard",
    talkGain: 1,
    exchangeGain: 3,
    tiers: [
      { score: 2, label: "Recognized", dialogueId: "cornelia.guard.affinity1", reward: { item: "potion", count: 1 } },
      { score: 4, label: "Trusted", dialogueId: "cornelia.guard.affinity2", reward: { gold: 100 } },
    ],
  },
  cornelia_elder: {
    npcId: "cornelia_elder",
    talkGain: 1,
    tiers: [
      { score: 3, label: "Respected", dialogueId: "cornelia.elder.affinity", reward: { item: "ether", count: 1 } },
    ],
  },
  elfheim_elder: {
    npcId: "elfheim_elder",
    talkGain: 1,
    tiers: [
      { score: 3, label: "Honored", dialogueId: "elfheim.elder.affinity", reward: { gold: 150 } },
    ],
  },
};
