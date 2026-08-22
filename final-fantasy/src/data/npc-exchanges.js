// Task #140: NPC Inventory Interaction data — the specific items a player
// can hand to an NPC to trigger dialogue/rewards. Each exchange is a
// player->NPC gift: the player trades away `itemId` x`count` and the NPC
// rewards gold, xp, and/or an item. `once` exchanges are tracked by an
// `npc_exchange_<id>_done` flag so they cannot be farmed.

export const NPC_EXCHANGES = {
  // The Cornelia blacksmith pays well for goblin fangs.
  cornelia_fangs: {
    id: "cornelia_fangs",
    npc: "cornelia_blacksmith",
    itemId: "goblinFang",
    count: 3,
    reward: { gold: 120, xp: 10 },
    once: false,
    line: "Good fangs — the blade will bite deeper with these folded into the steel.",
  },
  // The Dwarfholm Gem Cutter trades a thunder gem for distilled spirits.
  dwarfholm_essence: {
    id: "dwarfholm_essence",
    npc: "dwarfholm_gemcutter",
    itemId: "spiritEssence",
    count: 2,
    reward: { itemId: "thunderGem", count: 1 },
    once: true,
    line: "A spirit essence distilled this finely? I'll set its charge into a gem for you.",
  },
  // The Glacierport merchant swaps a sunstone's warmth for a pearl charm.
  glacierport_sunstone: {
    id: "glacierport_sunstone",
    npc: "glacierport_merchant",
    itemId: "sunstone",
    count: 1,
    reward: { itemId: "pearlCharm", count: 1 },
    once: true,
    line: "A Sunstone! The Elder will want this for the braziers — take my pearl charm in kind.",
  },
};
