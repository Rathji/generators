// Task #141: Proximity-Based NPC Barking data — an NPC fires a single line
// when the player enters a radius around them (no interaction required).
// `cooldownSteps` suppresses repeats for a number of world steps; `once`
// barks fire only a single time per save (tracked by an `npc_bark_<id>`
// flag). Lines read the NPC's CURRENT position (schedules/states applied).

export const NPC_BARKS = [
  { id: "guard_halt", npc: "cornelia_guard", mapId: "cornelia", radius: 3, line: "Halt! Who goes there?", cooldownSteps: 12 },
  { id: "blacksmith_sparks", npc: "cornelia_blacksmith", mapId: "cornelia", radius: 2, line: "Mind the sparks! The steel is hungry today.", cooldownSteps: 14 },
  { id: "elder_wisdom", npc: "cornelia_elder", mapId: "cornelia", radius: 3, line: "The crystals dim... walk softly, traveler.", cooldownSteps: 18 },
  { id: "elfheim_guard_pass", npc: "elfheim_guard", mapId: "elfheim", radius: 3, line: "The prince's hall lies ahead, hero.", cooldownSteps: 12 },
  { id: "windfall_fisher_nets", npc: "windfall_fisher", mapId: "windfall", radius: 3, line: "Nets came up heavy today — the sea favors us.", cooldownSteps: 15 },
  { id: "dwarfholm_miner_seams", npc: "dwarfholm_miner", mapId: "dwarfholm", radius: 3, line: "Mind your step — the floor drops by the old seams!", cooldownSteps: 12 },
  { id: "glacierport_captain_ice", npc: "glacierport_captain", mapId: "glacierport", radius: 3, line: "Ice floes drift in the channel — keep the sea at your back.", cooldownSteps: 16 },
];
