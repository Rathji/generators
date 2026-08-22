// Validation tests for Task #196: New Game+ rewards — the per-cycle loyalty
// gift and the Echo of Creation's hoard (Shattered Blade + gold + XP),
// granted once each.

import { NgPlusSystem } from "../engine/ngplus.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("all reward items in db", ["cycleEmblem", "shatteredRelic", "shatteredBlade"].every((i) => !!ITEMS[i]));
  check("shattered blade strongest", ITEMS.shatteredBlade.mods.atk === 46 && ITEMS.shatteredBlade.mods.agi === 5);

  const state = new GameState();
  const party = new PartyManager({ gold: 100 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior", level: 15, xp: 0 });
  party.add(hero);
  const inv = new Inventory();

  const ng = new NgPlusSystem({ state, party, inventory: inv });

  // Cycle 2 loyalty.
  state.setFlag("story_chrono_defeated", true);
  const c2 = ng.startCycle();
  check("cycle 2 reward emblem", c2.ok === true && c2.reward?.item === "cycleEmblem" && inv.count("cycleEmblem") === 1);
  check("cycle 2 gold (100+1000)", party.gold === 1100);
  check("cycle 2 xp (300)", party.members[0].xp === 300);

  // No repeat loyalty mid-cycle.
  check("no double emblem", inv.count("cycleEmblem") === 1);

  // Echo hoard on cycle 2.
  const before = party.gold;
  const win = ng.recordEchoDefeat();
  check("echo win recorded", win.ok === true);
  check("shattered blade granted", inv.count("shatteredBlade") === 1);
  check("echo gold (1100+5000)", party.gold === before + 5000, "gold=" + party.gold);
  check("echo xp (300+1500)", party.members[0].xp === 1800, "xp=" + party.members[0].xp);

  // Echo reward is one-time per system.
  const again = ng.recordEchoDefeat();
  check("no repeat echo reward", again.ok === false && inv.count("shatteredBlade") === 1);

  // Cycle 3 loyalty — the relic.
  state.setFlag("story_chrono_defeated", true);
  const c3 = ng.startCycle();
  check("cycle 3 reward relic", c3.ok === true && c3.cycle === 3 && c3.reward?.item === "shatteredRelic");
  check("shattered relic granted", inv.count("shatteredRelic") === 1);
  check("emblem survived into cycle 3", inv.count("cycleEmblem") === 1);
  check("blade survived into cycle 3", inv.count("shatteredBlade") === 1);
  check("cycle 3 gold (6100+2000)", party.gold === 8100, "gold=" + party.gold);
  check("at max cycle", ng.atMaxCycle() === true);
  check("cycle 3 cannot begin again", ng.canBeginCycle() === false);

  return out;
}
