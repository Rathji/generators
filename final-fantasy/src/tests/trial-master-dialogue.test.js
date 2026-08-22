// Validation tests for Task #162: Trial Master & Chronicler NPCs and dialogue.

import { NPC_PLACEMENTS } from "../data/npcs.js";
import { MAPS } from "../data/maps.js";
import { TileMap } from "../engine/grid.js";
import { DialogueEngine } from "../engine/dialogue.js";
import { DIALOGUE } from "../data/dialogue.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const npcs = NPC_PLACEMENTS.trial_hall ?? [];
  check("trial hall has NPCs", npcs.length >= 2);
  const master = npcs.find((n) => n.id === "trial_master");
  const chronicler = npcs.find((n) => n.id === "trial_chronicler");
  check("trial master placed", !!master);
  check("chronicler placed", !!chronicler);
  check("master dialogue id", master?.dialogueId === "trial_master");
  check("chronicler dialogue id", chronicler?.dialogueId === "trial_chronicler");

  // Both NPCs stand on walkable tiles inside the hall.
  const hall = MAPS.find((m) => m.id === "trial_hall");
  const tm = TileMap.fromAscii(hall.rows, { tiles: hall.tiles, solid: hall.solid });
  for (const n of npcs) {
    check("npc walkable: " + n.id, tm.inBounds(n.x, n.y) && tm.canStand(n.x, n.y));
  }

  // Dialogue nodes resolve correctly against flags (conditions read the world).
  const mkWorld = (flags) => ({ getFlag: (f) => !!flags[f], hasItem: () => false });
  const d = new DialogueEngine({ data: DIALOGUE, world: mkWorld({}) });
  check("master dialogue exists", !!DIALOGUE["trial_master"]);
  check("master sealed pre-chrono", d.start("trial_master") && d.current?.id === "trial_master.sealed");

  const chronoFlags = { story_chrono_defeated: true };
  const d2 = new DialogueEngine({ data: DIALOGUE, world: mkWorld(chronoFlags) });
  d2.start("trial_master");
  check("master ready post-chrono", d2.current?.id === "trial_master.ready");
  const choices = d2.getChoices();
  check("ready node offers choices", Array.isArray(choices) && choices.length === 4);
  const tradeChoice = (choices ?? []).find((c) => c.text.includes("trade"));
  check("choice about rewards", !!tradeChoice && tradeChoice.next === "trial_master.tokens");

  const progFlags = { story_chrono_defeated: true, any_trial_cleared: true };
  const d3 = new DialogueEngine({ data: DIALOGUE, world: mkWorld(progFlags) });
  check("master progress branch", d3.start("trial_master") && d3.current?.id === "trial_master.progress");

  const d4 = new DialogueEngine({ data: DIALOGUE, world: mkWorld({ trial_apex_cleared: true }) });
  check("master apex branch", d4.start("trial_master") && d4.current?.id === "trial_master.apex_done");

  const chroniclerRes = d.start("trial_chronicler");
  check("chronicler dialogue resolves", !!chroniclerRes && chroniclerRes.speaker === "Chronicler");

  return out;
}
