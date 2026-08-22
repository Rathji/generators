// Validation tests for Task #193: New Game+ cycle — carryover of levels,
// gold, and non-key items into a fresh cycle, with the cycle's loyalty
// reward granted on entry.

import { NgPlusSystem } from "../engine/ngplus.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const party = new PartyManager({ gold: 1000 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior", level: 12, xp: 400 });
  party.add(hero);
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage", level: 11, xp: 300 });
  mage.extraSpells = ["firaga"];
  party.add(mage);
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inv.add("potion", 5);
  inv.add("elixir", 2);
  inv.add("crystalKey", 1);   // key item -> stripped
  inv.add("airshipEngine", 1); // key item -> stripped
  inv.add("wayfarerCharm", 1); // accessory -> kept

  const ng = new NgPlusSystem({ state, party, inventory: inv });

  check("cannot begin before chrono", ng.canBeginCycle() === false);
  check("blocked start before chrono", ng.startCycle().ok === false);

  state.setFlag("story_chrono_defeated", true);
  state.setFlag("waystone_cornelia", true);
  check("can begin after chrono", ng.canBeginCycle() === true);

  const r = ng.startCycle();
  check("cycle started", r.ok === true && r.cycle === 2);
  check("loyalty reward cycle 2", r.reward?.cycle === 2 && r.reward?.gold === 1000 && r.reward?.item === "cycleEmblem");

  check("gold carried + rewarded (1000+1000)", party.gold === 2000, "gold=" + party.gold);
  check("hero level carried", party.members[0].level === 12);
  check("hero xp carried + reward", party.members[0].xp === 700, "xp=" + party.members[0].xp);
  check("members kept", party.members.length === 2 && party.members[0].id === "hero");
  check("extra spells carried", party.members[1].extraSpells?.includes("firaga"));

  check("key item stripped", inv.count("crystalKey") === 0 && inv.count("airshipEngine") === 0);
  check("consumables kept", inv.count("potion") === 5 && inv.count("elixir") === 2);
  check("gear kept", inv.count("wayfarerCharm") === 1);
  check("loyalty item granted", inv.count("cycleEmblem") === 1);

  check("story flag reset", state.getFlag("story_chrono_defeated") === false);
  check("waystone preserved", state.getFlag("waystone_cornelia") === true);
  check("cycle counter is 2", ng.cycle() === 2);
  check("echo gate unlocked", state.getFlag("ngplus_echo_unlocked") === true);
  check("location reset to cornelia", state.getLocation().mapId === "cornelia" && state.getLocation().x === 7 && state.getLocation().y === 5);

  check("second cycle needs chrono again", ng.canBeginCycle() === false);

  return out;
}
