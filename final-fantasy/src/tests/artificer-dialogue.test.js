// Validation tests for Task #174: Artificer & Gem Cutter NPCs + dialogue.

import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { TileMap } from "../engine/grid.js";
import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";

function mkWorld(flags = {}) {
  return { getFlag: (f) => !!flags[f], hasItem: () => false };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const npcs = NPC_PLACEMENTS.dwarfholm ?? [];
  const artificer = npcs.find((n) => n.id === "dwarfholm_artificer");
  const gemcutter = npcs.find((n) => n.id === "dwarfholm_gemcutter");
  check("artificer placed", !!artificer);
  check("gem cutter placed", !!gemcutter);
  check("artificer dialogue id", artificer?.dialogueId === "dwarfholm.artificer");
  check("gem cutter dialogue id", gemcutter?.dialogueId === "dwarfholm.gemcutter");

  const town = MAPS.find((m) => m.id === "dwarfholm");
  const tm = TileMap.fromAscii(town.rows, { tiles: town.tiles, solid: town.solid });
  for (const n of npcs) {
    check("npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
  }
  // No two NPCs share a tile.
  const seen = new Map();
  let collisions = 0;
  for (const n of npcs) {
    const key = n.x + "," + n.y;
    if (seen.has(key)) collisions++;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  check("no npc tile collisions", collisions === 0);

  // Artificer dialogue branches on the Forge's state.
  const d = new DialogueEngine({ data: DIALOGUE, world: mkWorld({}) });
  check("artificer sealed before colossus", d.start("dwarfholm.artificer") && d.current?.id === "dwarfholm.artificer.default");
  const d2 = new DialogueEngine({ data: DIALOGUE, world: mkWorld({ story_forge_colossus_defeated: true }) });
  d2.start("dwarfholm.artificer");
  check("artificer opens after colossus", d2.current?.id === "dwarfholm.artificer.forge");
  const choices = d2.getChoices();
  check("forge node offers choices", Array.isArray(choices) && choices.length === 3);
  const recipeChoice = (choices ?? []).find((c) => c.text.includes("forge"));
  check("recipes choice routes", !!recipeChoice && recipeChoice.next === "dwarfholm.artificer.recipes");

  const d3 = new DialogueEngine({ data: DIALOGUE, world: mkWorld({ sq_the_artificers_whetstone_done: true }) });
  check("artificer after-quest branch", d3.start("dwarfholm.artificer") && d3.current?.id === "dwarfholm.artificer.after");

  // Gem Cutter gates on the same forge.
  const g1 = new DialogueEngine({ data: DIALOGUE, world: mkWorld({}) });
  check("gem cutter sealed pre-forge", g1.start("dwarfholm.gemcutter") && g1.current?.id === "dwarfholm.gemcutter.default");
  const g2 = new DialogueEngine({ data: DIALOGUE, world: mkWorld({ story_forge_colossus_defeated: true }) });
  check("gem cutter ready post-forge", g2.start("dwarfholm.gemcutter") && g2.current?.id === "dwarfholm.gemcutter.ready");

  return out;
}
