// Validation tests for Task #141: Proximity-Based NPC Barking — an NPC
// fires a single line when the player enters a radius, no interaction needed.

import { NpcBarkSystem } from "../engine/npc-barks.js";
import { NPC_BARKS } from "../data/npc-barks.js";
import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { MapManager } from "../engine/transitions.js";
import { GameState } from "../engine/state.js";

function registry() {
  const m = new MapManager();
  for (const def of MAPS) m.register(def);
  return m;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const placements = new NpcPlacementSystem(NPC_PLACEMENTS, registry(), { state });
  const barks = new NpcBarkSystem(NPC_BARKS, { state });
  barks.bindPlacements(placements);

  check("barks defined for towns", barks.defsFor("cornelia").length >= 3);
  check("no barks on other maps", barks.defsFor("caves_of_cornelia").length === 0);

  // Walk near the gate guard (8,3) -> he barks.
  const fired = barks.tick("cornelia", 9, 3);
  check("guard barks in range", fired.length === 1 && fired[0].npcId === "cornelia_guard" && fired[0].line.includes("Halt"));
  check("bark reports npc name", fired[0].npc === "Guard");

  // Cooldown suppresses the immediate next tick.
  check("cooldown suppresses repeat", barks.tick("cornelia", 9, 3).length === 0);
  // ...but ticks down: after cooldownSteps-1 more ticks it can fire again.
  let quiet = true;
  for (let i = 0; i < 10; i++) quiet = quiet && barks.tick("cornelia", 9, 3).length === 0;
  check("cooldown blocks for its duration", quiet === true);
  const again = barks.tick("cornelia", 9, 3);
  check("bark refires after cooldown", again.length === 1 && again[0].npcId === "cornelia_guard");

  // Out of range -> silence (far corner of Cornelia).
  check("no bark from far away", barks.tick("cornelia", 13, 6).length === 0);

  // A once-bark fires exactly once per save.
  const once = NPC_BARKS.find((b) => b.once) ?? { ...NPC_BARKS[0], once: true, id: "once_test", npc: "cornelia_elder", mapId: "cornelia", radius: 3 };
  const single = new NpcBarkSystem([once], { state });
  single.bindPlacements(placements);
  check("once bark fires", single.tick("cornelia", 2, 3).length === 1);
  check("once bark flag set", state.getFlag("npc_bark_" + once.id) === true);
  check("once bark never refires", single.tick("cornelia", 2, 3).length === 0);

  // Audit: all shipped barks reference placed NPCs on their map.
  check("barks audit clean", barks.audit(placements).length === 0);

  return out;
}
