// Validation tests for Task #177: The Artificer's Whetstone side quest.

import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const q = SIDE_QUESTS.the_artificers_whetstone;
  check("quest defined", !!q);
  check("two steps", q?.steps?.length === 2);
  check("materials step references the forge's stock", q?.steps?.[0]?.description.includes("Wyrm Scale") && q?.steps?.[0]?.description.includes("Rune Shard"));
  check("reward items exist", !!ITEMS[q?.reward?.item]);

  const state = new GameState();
  const party = new PartyManager({ gold: 0 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  const inv = new Inventory();
  const sq = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });

  check("blocked before colossus", sq.canStart("the_artificers_whetstone") === false);
  state.setFlag("story_forge_colossus_defeated");
  check("startable after colossus", sq.canStart("the_artificers_whetstone") === true);
  const start = sq.start("the_artificers_whetstone");
  check("started", start.ok === true);

  const s1 = sq.completeStep("the_artificers_whetstone", "sq_artificers_whetstone_materials");
  check("materials step done", s1.ok === true && s1.done === false && s1.progress === 1);
  check("not completable mid-quest", sq.checkComplete("the_artificers_whetstone").ok === false);
  const s2 = sq.completeStep("the_artificers_whetstone", "sq_artificers_whetstone_delivered");
  check("delivery step done", s2.ok === true && s2.done === true);

  const goldBefore = party.gold;
  const done = sq.checkComplete("the_artificers_whetstone");
  check("reward granted", done.ok === true && done.reward.gold === 500);
  check("gold paid", party.gold === goldBefore + 500);
  check("elixirs rewarded", inv.count("elixir") === 2);
  check("xp granted", hero.xp === 200);
  check("quest complete", sq.isComplete("the_artificers_whetstone") === true);
  check("no repeat reward", sq.checkComplete("the_artificers_whetstone").ok === false);

  return out;
}
