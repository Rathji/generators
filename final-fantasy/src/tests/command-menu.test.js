// Validation tests for Task #212: CommandMenuSystem core — opening/closing,
// root screen enablement, cursor navigation, submenu pushes, and the
// rebuild-on-pop behavior.

import { CommandMenuSystem } from "../engine/command-menu.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { ConsumableSystem } from "../engine/consumables.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";

function build() {
  const party = new PartyManager({ gold: 200 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  const inv = new Inventory();
  inv.add("potion", 3);
  inv.add("crystalKey", 1);
  const state = new GameState();
  state.setParty(party);
  state.setInventory(inv);
  const cm = new CommandMenuSystem({
    party,
    inventory: inv,
    consumables: new ConsumableSystem({ inventory: inv, party }),
    spells: new SpellCastingSystem(),
  });
  return { party, inv, state, cm };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const { party, inv, cm } = build();
  check("closed initially", cm.isOpen === false && cm.render() === null);

  const view = cm.open();
  check("open returns root view", !!view && view.title === "Command");
  check("root has five items", view.items.length === 5);
  check("root order", view.items.map((i) => i.id).join(",") === "items,magic,equip,status,formation");
  const byId = (id) => view.items.find((i) => i.id === id);
  check("items enabled (potions)", byId("items").disabled === false);
  check("magic enabled (white mage cure)", byId("magic").disabled === false);
  check("equip enabled", byId("equip").disabled === false);
  check("status enabled", byId("status").disabled === false);
  check("formation enabled (3 members)", byId("formation").disabled === false);

  // Empty-party edge: no casters, no items.
  const empty = new CommandMenuSystem({ party: new PartyManager(), inventory: new Inventory(), consumables: new ConsumableSystem({}), spells: new SpellCastingSystem() });
  const ev = empty.open();
  const eById = (id) => ev.items.find((i) => i.id === id);
  check("items disabled with no consumables", eById("items").disabled === true);
  check("magic disabled with no casters", eById("magic").disabled === true);
  check("formation disabled with 1 member", eById("formation").disabled === true);

  // Navigation wraps.
  check("navigate down moves to magic", cm.menu.navigate(1)?.id === "magic");
  cm.menu.select("items");
  const confirmRes = cm.menu.confirm();
  check("confirm items pushes submenu", !!confirmRes && cm.menu.depth === 2 && cm.render().title === "Items");
  check("submenu lists potion", cm.render().items.some((i) => i.id === "item_potion"));

  // Escape pops back and rebuilds.
  const back = cm.handleKey("Escape");
  check("escape pops submenu", back === "back" && cm.menu.depth === 1 && cm.render().title === "Command");

  // Root escape closes entirely.
  const closed = cm.handleKey("Escape");
  check("root escape closes", closed === "closed" && cm.isOpen === false);
  check("handleKey while closed is null", cm.handleKey("ArrowDown") === null);

  // Enter/z confirm; arrows move.
  cm.open();
  cm.menu.select("status");
  cm.handleKey("Enter");
  check("confirm via Enter pushes status", cm.render().title === "Status");
  cm.handleKey("Escape");
  check("cancel via Escape pops", cm.render().title === "Command");

  // Items remain enabled count is live (potion consumed elsewhere).
  inv.remove("potion", 3);
  cm.close();
  const v2 = cm.open();
  check("items disabled after potions gone", v2.items.find((i) => i.id === "items").disabled === true);

  return out;
}
