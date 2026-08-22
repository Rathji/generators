// Validation tests for Task #54: Chest/Loot Spawn System.

import { ChestSystem } from "../engine/chests.js";
import { CHESTS } from "../data/chests.js";
import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  const party = new PartyManager({ gold: 0 });
  const sys = new ChestSystem(CHESTS, { state, inventory: inv, party, random: () => 0 });

  check("chests listed", sys.all().length === 31);
  check("chestsFor map", sys.chestsFor("caves_of_cornelia").length === 2);
  check("chestAt finds", sys.chestAt("caves_of_cornelia", 10, 9)?.id === "cave_chest_upper");
  check("chestAt empty", sys.chestAt("caves_of_cornelia", 0, 0) === null);
  check("chestById", sys.chestById("house_chest")?.mapId === "cornelia_house");

  check("unopened chest can open", sys.canOpen("caves_of_cornelia", 10, 9).ok === true);

  // random()=0 -> chance-based loot below 1 never drops; only chance:1 + items
  const opened = sys.open("caves_of_cornelia", 10, 9);
  check("open grants guaranteed loot", opened.ok === true && opened.items.some((i) => i.itemId === "potion"));
  check("chance-0.5 loot missed with rng 0", opened.items.every((i) => i.itemId !== "phoenixDown"));
  check("gold granted", opened.gold === 40 && party.gold === 40);
  check("items added to inventory", inv.count("potion") === 2);
  check("opened flag set", state.getFlag("chest_cave_upper_opened") === true);
  check("second open blocked", sys.open("caves_of_cornelia", 10, 9).ok === false && sys.canOpen("caves_of_cornelia", 10, 9).ok === false);

  const lower = sys.open("caves_of_cornelia_b2", 4, 5);
  check("fixed items granted", lower.ok === true && lower.items[0].itemId === "ironSword" && inv.count("ironSword") === 1);
  check("xp granted", lower.xp === 30);

  const lucky = new ChestSystem(CHESTS, { state: new GameState(), inventory: inv, party, random: () => 0.99 });
  const luckyOpen = lucky.open("caves_of_cornelia", 10, 9);
  check("high rng drops chance loot", luckyOpen.ok === true && luckyOpen.items.some((i) => i.itemId === "phoenixDown"));

  const small = new Inventory({ maxSlots: 1 });
  small.add("potion", 1);
  const over = new ChestSystem(CHESTS, { state: new GameState(), inventory: small, random: () => 0.99 });
  const overRes = over.open("caves_of_cornelia", 10, 9);
  check("overflow reported when inventory full", overRes.overflow.some((i) => i.itemId === "phoenixDown"));

  const noInv = new ChestSystem(CHESTS, { state: new GameState(), random: () => 0 });
  const noInvRes = noInv.open("caves_of_cornelia", 10, 9);
  check("no inventory still reports items", noInvRes.ok === true && noInvRes.items.length > 0);

  const reset = new ChestSystem(CHESTS, { state: new GameState() });
  reset.open("cornelia_house", 1, 3);
  check("remaining count", reset.remaining().length === 30);
  reset.reset();
  check("reset reopens all", reset.remaining().length === 31);

  return out;
}
