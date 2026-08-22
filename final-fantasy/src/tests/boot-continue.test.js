// Validation tests for Task #204: boot.continue — a saved adventure is
// restored onto the LIVE game objects exactly, including gear, statuses,
// spells, flags, location, and NG+ cycle.

import { GameBootSystem } from "../engine/boot.js";
import { SaveSlotSystem } from "../engine/save-slots.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // The "real" live game as main.js constructs it.
  const state = new GameState();
  const party = new PartyManager({ gold: 150 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  const inv = new Inventory();
  inv.add("potion", 5);
  inv.add("crystalKey", 1);
  state.setParty(party);
  state.setInventory(inv);
  state.setLocation("cornelia", 7, 5, "S");
  state.setFlag("intro_seen", true);

  const slots = new SaveSlotSystem();
  const boot = new GameBootSystem({ state, party, inventory: inv, slots });

  // Play: level up, gear up, wander to a dungeon, set flags.
  const hero = party.members[0];
  party.grantXp(2000);
  hero.equipment.weapon = "windBlade";
  hero.equipment.armor = "chain";
  hero.equipment.accessory = "wayfarerCharm";
  hero.damage(40);
  const heroHpAtSave = hero.hp;
  hero.addStatus("poison");
  const mage = party.members[1];
  mage.learnSpell("firaga");
  mage.damage(12);
  const mageHpAtSave = mage.hp;
  party.gold = 2700;
  state.setFlag("story_garland_defeated", true);
  state.setFlag("crystal_fire_restored", true);
  state.setFlag("waystone_cornelia", true);
  state.setFlag("keeper_tokens", 3);
  state.setFlag("ngplus_cycle", 1);
  state.setLocation("caves_of_cornelia", 4, 3, "W");
  state.playTimeSec = 1250;
  inv.add("elixir", 2);
  inv.add("masamune", 1);

  // A second save object captures everything at save time.
  const saveGame = { state, party, inventory: inv };
  const sw = slots.write("A", saveGame);
  check("save written", sw.ok === true);

  // Mutate the live game into a completely different state.
  boot.newGame();
  check("live game reset by newGame", party.members.length === 3 && party.gold === 150 && inv.count("masamune") === 0);

  const res = boot.continue("A");
  check("continue ok", res.ok === true && res.fresh === false && res.slot === "A");
  check("summary location", res.location.mapId === "caves_of_cornelia" && res.location.x === 4);
  check("summary gold", res.gold === 2700);
  check("summary level", res.level >= 3);
  check("summary playtime", res.playTimeSec === 1250);
  check("active slot set", boot.activeSlot === "A");

  check("party object preserved", boot.party === party);
  check("state object preserved", boot.state === state);
  check("inventory object preserved", boot.inventory === inv);

  const h = party.members[0];
  check("hero level restored", h.level >= 3 && h.xp === 2000);
  check("hero equipment restored", h.equipment.weapon === "windBlade" && h.equipment.armor === "chain" && h.equipment.accessory === "wayfarerCharm");
  check("hero hp preserved", h.hp === heroHpAtSave, "hp=" + h.hp);
  check("hero status preserved", h.hasStatus("poison"));
  check("hero weapon stats re-derived", h.getStats().atk >= 22, "atk=" + h.getStats().atk);
  check("mage spell preserved", party.members[1].knowsSpell("firaga"));
  check("mage hp preserved", party.members[1].hp === mageHpAtSave);

  check("gold restored", party.gold === 2700);
  check("location restored", state.location.mapId === "caves_of_cornelia" && state.location.facing === "W");
  check("story flags restored", state.getFlag("story_garland_defeated") && state.getFlag("crystal_fire_restored"));
  check("meta flags restored", state.getFlag("waystone_cornelia") && state.flags.keeper_tokens === 3);
  check("cycle restored", (state.flags["ngplus_cycle"] ?? 1) === 1);
  check("playtime restored", state.playTimeSec === 1250);
  check("inventory restored", inv.count("elixir") === 2 && inv.count("masamune") === 1 && inv.count("potion") === 5);

  // Empty / invalid slots fail gracefully.
  const res2 = boot.continue("C");
  check("empty slot refused", res2.ok === false && res2.reason === "empty");
  const res3 = boot.continue("Z");
  check("unknown slot refused", res3.ok === false && res3.reason === "empty");

  return out;
}
