// Validation tests for Task #178: the forge arc — drop, craft, equip,
// enchant, and quest, end to end.

import { EnemyTemplateSystem } from "../engine/enemies.js";
import { ENEMIES } from "../data/enemies.js";
import { CraftingSystem } from "../engine/crafting.js";
import { RECIPES } from "../data/recipes.js";
import { EnchantingSystem } from "../engine/enchanting.js";
import { ENCHANTS } from "../data/enchants.js";
import { EquipSystem } from "../engine/equipment.js";
import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";
import { getEffectiveStats, setExtraItemMods } from "../engine/stats.js";
import { ITEMS } from "../data/items.js";

// Roll every loot table open so each enemy drops all its items once.
function farm(es, enemyId, itemId) {
  const e = es.createEnemy(enemyId);
  const drops = es.lootFor(e, () => 0);
  return { enemyId, drops, has: drops.includes(itemId) };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  // 1) Materials come from real monsters.
  const es = new EnemyTemplateSystem();
  const sources = {
    runeShard: ["oreGolem", "runeSentinel"],
    goblinFang: ["goblin"],
    coralPearl: ["coralCrab"],
    wyrmScale: ["tideEel", "skySerpent"],
    fireGem: ["fireElemental"],
  };
  for (const [mat, enemies] of Object.entries(sources)) {
    check(mat + " farmable", enemies.some((id) => ENEMIES[id] && farm(es, id, mat).has), mat);
  }

  // 2) Craft the Rune Sabre + Pearl Charm.
  const state = new GameState();
  const party = new PartyManager({ gold: 2000 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior", level: 10 });
  party.add(hero);
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const crafting = new CraftingSystem(RECIPES, { inventory: inv, party, state });

  inv.add("runeShard", 3);
  inv.add("goblinFang", 2);
  inv.add("coralPearl", 3);
  const sabre = crafting.craft("runeSabre");
  const charm = crafting.craft("pearlCharm");
  check("rune sabre crafted", sabre.ok === true && inv.count("runeSabre") === 1);
  check("pearl charm crafted", charm.ok === true && inv.count("pearlCharm") === 1);
  check("materials consumed", inv.count("runeShard") === 0 && inv.count("coralPearl") === 0);
  check("gold spent (2000-200-120)", party.gold === 1680);

  // 3) Equip the sabre — effective attack jumps by its atk.
  const equip = new EquipSystem(inv);
  hero.equipment = { weapon: null, armor: null, accessory: null };
  const noWeapon = getEffectiveStats(hero, hero.class, ITEMS).atk;
  equip.equip(hero, "runeSabre");
  const withSabre = getEffectiveStats(hero, hero.class, ITEMS).atk;
  check("sabre raised attack", withSabre === noWeapon + 24, `before=${noWeapon} after=${withSabre}`);

  // 4) Enchant it with fire — one gem, gone for good, attack rises further.
  inv.add("fireGem", 1);
  const enchanting = new EnchantingSystem(ENCHANTS, { inventory: inv, party, state });
  const enc = enchanting.enchant("runeSabre", "fire");
  check("sabre enchanted", enc.ok === true && enc.mods.atk === 3);
  check("gem consumed", inv.count("fireGem") === 0);
  setExtraItemMods((itemId) => enchanting.enchantMods(itemId));
  const withEnchant = getEffectiveStats(hero, hero.class, ITEMS).atk;
  check("enchant raised attack", withEnchant === withSabre + 3, `sabre=${withSabre} enchanted=${withEnchant}`);
  check("re-enchant impossible", enchanting.canEnchant("runeSabre", "thunder").ok === false);

  // 5) The whetstone quest — gather the forge's stock and turn it in.
  state.setFlag("story_forge_colossus_defeated");
  const sq = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });
  check("whetstone quest startable", sq.canStart("the_artificers_whetstone") === true);
  sq.start("the_artificers_whetstone");
  sq.completeStep("the_artificers_whetstone", "sq_artificers_whetstone_materials");
  sq.completeStep("the_artificers_whetstone", "sq_artificers_whetstone_delivered");
  const reward = sq.checkComplete("the_artificers_whetstone");
  check("quest rewarded elixirs", reward.ok === true && inv.count("elixir") === 2);
  check("quest gold (1280 after enchant + 500)", party.gold === 1780);

  setExtraItemMods(null);

  return out;
}
