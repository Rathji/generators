// Validation tests for Task #176: the enchanting engine & stat integration.

import { EnchantingSystem } from "../engine/enchanting.js";
import { ENCHANTS } from "../data/enchants.js";
import { ITEMS } from "../data/items.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { getEffectiveStats, setExtraItemMods } from "../engine/stats.js";

function fakeState(flags = {}) {
  return {
    flags,
    setFlag: (n, v) => {
      flags[n] = v ?? true;
    },
    getFlag: (n) => !!flags[n],
  };
}

function partyWith(gold) {
  const p = new PartyManager({ gold });
  p.add(new Character({ id: "hero", name: "Hero", classId: "warrior", level: 10 }));
  return p;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const flags = {};
  const state = fakeState(flags);
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const party = partyWith(2000);
  const sys = new EnchantingSystem(ENCHANTS, { inventory: inv, party, state });

  check("enchant lookup", sys.enchantById("fire")?.gem === "fireGem");

  // Cannot enchant without the gem / gear / gold.
  inv.add("ironSword", 1);
  check("missing gem blocked", sys.canEnchant("ironSword", "fire").ok === false);
  check("unknown enchantment safe", sys.canEnchant("ironSword", "bogus").ok === false);
  check("not equipment blocked", sys.canEnchant("potion", "fire").ok === false);
  check("unknown item blocked", sys.canEnchant("bogus", "fire").ok === false);

  // Enchant the iron sword with fire.
  inv.add("fireGem", 1);
  check("ready to enchant", sys.canEnchant("ironSword", "fire").ok === true);
  const r = sys.enchant("ironSword", "fire");
  check("enchant succeeds", r.ok === true && r.enchantment === "fire" && r.mods.atk === 3);
  check("gem consumed", inv.count("fireGem") === 0);
  check("gold charged (2000-400)", party.gold === 1600);
  check("flag recorded", state.getFlag("enchanted_ironSword") === true);
  check("isEnchanted true", sys.isEnchanted("ironSword") === true);
  check("enchantMods merged", sys.enchantMods("ironSword").atk === 3 && sys.enchantMods("ironSword").int === 2);

  // One enchantment per piece, permanent.
  inv.add("fireGem", 1);
  check("re-enchant blocked", sys.canEnchant("ironSword", "fire").ok === false && sys.canEnchant("ironSword", "void").ok === false);
  check("re-enchant refused", sys.enchant("ironSword", "void").ok === false);

  // Unenchanted gear has no overlay.
  inv.add("chain", 1);
  check("unenchanted has no mods", Object.keys(sys.enchantMods("chain")).length === 0);

  // Decorated item DB merges enchant mods.
  const db = sys.decoratedItemDb();
  check("decorated db base intact", db.chain?.mods?.def === 7);
  check("decorated db merges enchant", db.ironSword?.mods?.atk === 11 && db.ironSword?.mods?.int === 2);

  // Character stats reflect the enchantment through the extra-mods hook.
  const hero = party.members[0];
  setExtraItemMods((itemId) => sys.enchantMods(itemId));
  hero.equipment.weapon = "ironSword";
  const withEnchant = getEffectiveStats(hero, hero.class, ITEMS);
  setExtraItemMods(null);
  hero.equipment.weapon = "ironSword";
  const without = getEffectiveStats(hero, hero.class, ITEMS);
  check("enchant adds atk to effective stats", withEnchant.atk === without.atk + 3, `with=${withEnchant.atk} without=${without.atk}`);
  setExtraItemMods(null);

  // Not enough gold.
  const poorParty = partyWith(100);
  const poor = new EnchantingSystem(ENCHANTS, { inventory: inv, party: poorParty, state: fakeState({}) });
  inv.add("fireGem", 1);
  check("poor cannot enchant", poor.canEnchant("ironSword", "fire").ok === false);

  // Describe.
  check("describe enchant", sys.describe("ironSword")?.includes("Fire Essence"));
  check("describe unenchanted null", sys.describe("chain") === null);

  return out;
}
