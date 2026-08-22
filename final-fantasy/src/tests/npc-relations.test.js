// Validation tests for Task #151: NPC Relationship Tracker — affinity
// gained by interaction frequency, tier rewards, and affinity-gated dialogue.

import { NpcRelationSystem } from "../engine/npc-relations.js";
import { NPC_RELATIONS } from "../data/npc-relations.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { DialogueEngine, createDialogueWorld } from "../engine/dialogue.js";
import { NpcPlacementSystem } from "../engine/npcs.js";
import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MapManager } from "../engine/transitions.js";
import { MAPS } from "../data/maps.js";

function registry() {
  const m = new MapManager();
  for (const d of MAPS) m.register(d);
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
  const inventory = new Inventory();
  const party = new PartyManager({ gold: 200 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  const rel = new NpcRelationSystem(NPC_RELATIONS, { state, inventory, party });

  check("relations defined for key NPCs", NPC_RELATIONS.cornelia_guard && NPC_RELATIONS.cornelia_elder && NPC_RELATIONS.elfheim_elder);
  check("score starts at zero", rel.score("cornelia_guard") === 0);
  check("tier starts null", rel.tier("cornelia_guard") === null);

  // One talk -> score 1 (below the first tier).
  const r1 = rel.add("cornelia_guard", 1);
  check("talking adds affinity", r1.ok === true && r1.score === 1);
  check("below tier 1 no reward", r1.rewards.length === 0);

  // Score 2 -> Recognized tier, potion reward.
  const r2 = rel.add("cornelia_guard", 1);
  check("crossing tier 1 grants its reward", r2.rewards.length === 1 && r2.rewards[0].label === "Recognized");
  check("reward is a potion", r2.rewards[0].reward.item === "potion" && inventory.has("potion"));
  check("tier label reports Recognized", rel.tierLabel("cornelia_guard") === "Recognized");
  check("no double reward", rel.add("cornelia_guard", 0).rewards.length === 0);

  // Score 4 -> Trusted tier, gold reward.
  const r3 = rel.add("cornelia_guard", 2);
  check("crossing tier 2 grants gold", r3.rewards.length === 1 && r3.rewards[0].label === "Trusted" && r3.rewards[0].reward.gold === 100);
  check("score persisted as a raw flag", state.flags["npc_rel_cornelia_guard"] === 4);

  // Affinity-gated dialogue: at score 4 the guard uses his Trusted lines.
  const game = { state, inventory, party, npcRelations: rel };
  const world = createDialogueWorld(game);
  const engine = new DialogueEngine({ world, state });
  engine.start("cornelia.guard");
  const page = engine.getPage();
  check("high affinity unlocks trusted dialogue", page && page.text.includes("earned this town's trust"));

  // A fresh guard (score 0) with no flags still resolves to the default lines.
  const rel2 = new NpcRelationSystem(NPC_RELATIONS, { state: new GameState(), inventory, party });
  const engine2 = new DialogueEngine({ world: createDialogueWorld({ state: new GameState(), inventory, party, npcRelations: rel2 }), state });
  engine2.start("cornelia.guard");
  const page2 = engine2.getPage();
  check("low affinity falls back to default", page2 && page2.text.includes("Welcome to Cornelia"));

  check("list reports every tracked NPC", rel.list().length === Object.keys(NPC_RELATIONS).length);
  check("every relationship maps to a placed NPC", rel.audit(new NpcPlacementSystem(NPC_PLACEMENTS, registry(), { state })).length === 0);

  return out;
}
