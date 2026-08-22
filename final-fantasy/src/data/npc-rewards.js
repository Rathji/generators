// Task #107: NPC reward distribution data — one-time grants handed out by
// NPCs on dialogue-driven quest completion (independent of the side-quest
// chain rewards; this is the generic "the NPC gives you a gift" path). Each
// reward grants once per save, tracked by an `npc_reward_<id>_granted` flag.

export const NPC_REWARDS = {
  herbalists_gift: {
    id: "herbalists_gift",
    npc: "cornelia_herbalist",
    name: "The Herbalist's Gift",
    item: "potion",
    count: 3,
    gold: 20,
    xp: 10,
    line: "The Herbalist presses three potions into your hands for your trouble.",
  },
  smiths_tempering: {
    id: "smiths_tempering",
    npc: "cornelia_blacksmith",
    name: "The Blacksmith's Tempering",
    item: "goldNeedle",
    count: 1,
    gold: 0,
    xp: 15,
    line: "The Blacksmith tosses you a gold needle — proof his forge favors brave hearts.",
  },
  captains_cheer: {
    id: "captains_cheer",
    npc: "pravog_harbormaster",
    name: "The Captain's Cheer",
    item: "ether",
    count: 1,
    gold: 50,
    xp: 20,
    line: "The Harbor Captain toasts your voyage and slips you an ether.",
  },
};
