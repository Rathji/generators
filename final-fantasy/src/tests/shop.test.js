// Validation tests for Task #22: Shop Transaction System.

import { ShopSystem } from "../engine/shop.js";
import { SHOPS } from "../data/shops.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const party = new PartyManager({ gold: 300 });
  const inv = new Inventory({ maxSlots: 10, maxWeight: 100 });
  const shop = new ShopSystem(SHOPS.cornelia_item, party, inv);

  check("shop id/name", shop.id === "cornelia_item" && shop.name === "Cornelia Item Shop");
  check("potion price 50", shop.priceOf("potion") === 50);
  check("sell price halves", shop.sellPriceOf("potion") === 25);
  check("unknown item price null", shop.priceOf("nope") === null);

  const stock = shop.stockList();
  check("stock list length", stock.length === SHOPS.cornelia_item.stock.length);
  check("stock entries priced", stock.every((s) => s.price > 0));

  const buy = shop.buy("potion", 2);
  check("buy succeeds", buy.ok === true && buy.cost === 100 && inv.count("potion") === 2);
  check("gold deducted", party.gold === 200);

  const tooRich = shop.buy("cottage", 1);
  check("cottage unaffordable", tooRich.ok === false && tooRich.error === "insufficient gold" && party.gold === 200);

  const notStocked = shop.buy("ironSword", 1);
  check("not in stock rejected", notStocked.ok === false && notStocked.error === "not in stock");

  inv.add("goblinFang", 3);
  const sell = shop.sell("goblinFang", 2);
  check("sell succeeds", sell.ok === true && sell.gained === 8 && inv.count("goblinFang") === 1);
  check("gold gained", party.gold === 208);

  const noOwn = shop.sell("potion", 99);
  check("selling unowned rejected", noOwn.ok === false && noOwn.error === "not owned");

  const sellList = shop.sellableList();
  check("sellable list contains owned items", sellList.some((s) => s.id === "potion") && sellList.some((s) => s.id === "goblinFang"));

  party.gold = 1000;
  const fullInv = new Inventory({ maxSlots: 2, maxWeight: 100 });
  fullInv.add("potion", 1);
  fullInv.add("ether", 1);
  const shop2 = new ShopSystem(SHOPS.cornelia_item, party, fullInv);
  const full = shop2.buy("antidote", 1);
  check("inventory full blocks buy", full.ok === false && full.error === "inventory full" && party.gold === 1000);
  check("canBuy reflects affordability", shop2.canBuy("antidote", 1).error === "inventory full");
  check("canBuy unstocked", shop2.canBuy("dagger", 1).error === "not in stock");
  const canBuyOk = shop2.canBuy("potion", 1);
  check("canBuy ok path", canBuyOk.ok === true && canBuyOk.cost === 50);

  const priceModShop = new ShopSystem({ ...SHOPS.cornelia_weapon, priceMod: 1.5 }, party, inv);
  check("priceMod scales buy price", priceModShop.priceOf("ironSword") === 225);

  return out;
}
