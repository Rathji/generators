// Validation tests for Task #45: Item Rarity/Tiering System.

import { ItemRaritySystem, rarityOfItem, priceWithRarity, sellPriceWithRarity } from "../engine/rarity.js";
import { ITEMS } from "../data/items.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = new ItemRaritySystem();

  check("potion is common", sys.rarityOf("potion").id === "common");
  check("crystal key is legendary", sys.rarityOf("crystalKey").id === "legendary");
  check("mythril sword is rare", sys.rarityOf("mythrilSword").id === "rare");
  check("missing rarity defaults to common", rarityOfItem({ price: 10 }).id === "common");

  check("legendary outranks common", sys.rankOf("crystalKey") > sys.rankOf("potion"));
  check("isAtLeast tier check", sys.isAtLeast("mythrilSword", "rare") === true && sys.isAtLeast("potion", "uncommon") === false);

  check("common price unmodified", sys.buyPrice("potion") === 50);
  check("common sell is half", sys.sellPrice("potion") === 25);
  check("uncommon price scaled", sys.buyPrice("ironSword") === Math.floor(150 * 1.2));
  check("uncommon sell scaled", sys.sellPrice("ironSword") === Math.floor(Math.floor(150 * 1.2) * 0.6));
  check("epic elixir price", sys.buyPrice("elixir") === Math.floor(900 * 2.0));
  check("standalone helpers agree", priceWithRarity(ITEMS.potion) === 50 && sellPriceWithRarity(ITEMS.potion) === 25);

  const desc = sys.describe("mythrilSword");
  check("describe returns tier info", desc.label === "Rare" && desc.rank === 2 && typeof desc.color === "string");
  check("describe unknown returns null", sys.describe("nope") === null);

  const sorted = sys.sortedByIds(["mythrilSword", "potion", "crystalKey", "ironSword"], true);
  check("sorted ascending by rarity", sorted[0] === "potion" && sorted[sorted.length - 1] === "crystalKey");
  const descSorted = sys.sortedByIds(["mythrilSword", "potion", "crystalKey"], false);
  check("sorted descending", descSorted[0] === "crystalKey");

  check("itemsOfTier common nonempty", sys.itemsOfTier("common").includes("potion"));
  check("all tiers ordered", sys.all().map((t) => t.id).join(",") === "common,uncommon,rare,epic,legendary");

  check("every item has valid rarity", Object.keys(ITEMS).every((id) => ITEMS[id].rarity !== undefined));

  return out;
}
