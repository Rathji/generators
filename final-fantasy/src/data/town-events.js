// Town event data (Task #51) — per-town scripts triggered by world flags.
// Each event fires when its trigger is met and (when `once`) only until its
// onDoneFlag is set.

export const TOWN_EVENTS = {
  cornelia: [
    {
      id: "cornelia_festival",
      name: "Festival of Light",
      trigger: { flag: "crystal_fire" },
      event: { type: "dialogue", dialogueId: "cornelia.festival" },
      once: true,
      onDoneFlag: "cornelia_festival_done",
    },
    {
      id: "cornelia_guard_warn",
      name: "Guard Warning",
      trigger: { flag: "story_started" },
      event: { type: "dialogue", dialogueId: "cornelia.guard_warn" },
      once: true,
      onDoneFlag: "cornelia_guard_warn_done",
    },
    {
      id: "cornelia_bandit_raid",
      name: "Bandit Raid",
      trigger: { notFlag: "story_garland_defeated" },
      event: { type: "battle", group: "bandits" },
      once: true,
      onDoneFlag: "cornelia_bandit_raid_done",
    },
  ],
  cornelia_inn: [
    {
      id: "inn_free_night",
      name: "Innkeeper's Favor",
      trigger: { flag: "prologue_seen" },
      event: { type: "setFlag", flag: "inn_free_night", value: true },
      once: true,
      onDoneFlag: "inn_free_night_given",
    },
  ],
  caves_of_cornelia: [
    {
      id: "cave_hermit_gift",
      name: "Hermit's Gift",
      trigger: { flag: "crystal_key_found" },
      event: { type: "giveItem", itemId: "potion", count: 2 },
      once: true,
      onDoneFlag: "cave_hermit_gift_done",
    },
  ],
};
