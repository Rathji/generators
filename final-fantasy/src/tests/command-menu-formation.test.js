// Validation tests for Task #217: the Formation screen — reordering the
// active party by swapping each member with the next (wrapping at the end).

import { CommandMenuSystem } from "../engine/command-menu.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { ConsumableSystem } from "../engine/consumables.js";
import { SpellCastingSystem } from "../engine/spellcasting.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const party = new PartyManager({ gold: 200 });
  party.add(new Character({ id: "hero", name: "Hero", classId: "warrior" }));
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage" }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  const inv = new Inventory();
  inv.add("potion", 1);
  const cm = new CommandMenuSystem({
    party,
    inventory: inv,
    consumables: new ConsumableSystem({ inventory: inv, party }),
    spells: new SpellCastingSystem(),
    log: () => {},
  });

  const order = () => party.members.map((m) => m.id).join(",");

  cm.open();
  cm.menu.select("formation");
  cm.menu.confirm();
  let view = cm.render();
  check("formation screen lists in order", view.items.map((i) => i.id).join(",") === "member_hero,member_mage,member_healer");
  check("rows numbered", view.items[0].label.startsWith("1.") && view.items[1].label.startsWith("2."));

  // Confirm on hero (index 0) -> swaps with mage.
  cm.menu.select("member_hero");
  cm.menu.confirm();
  check("hero swapped with mage", order() === "mage,hero,healer");
  check("message shows new order", (cm.lastMessage ?? "").toLowerCase().includes("mage") && (cm.lastMessage ?? "").toLowerCase().includes("hero"));
  check("screen refreshed with new order", cm.render().items.map((i) => i.id).join(",") === "member_mage,member_hero,member_healer");

  // Confirm on the last member -> wraps to swap with the front.
  cm.menu.select("member_healer");
  cm.menu.confirm();
  check("last member swaps to front", order() === "healer,hero,mage");

  // Confirm on the middle member -> swaps with the next (last).
  cm.menu.select("member_hero");
  cm.menu.confirm();
  check("middle member swaps with next", order() === "healer,mage,hero");

  // Escape returns to the root.
  cm.handleKey("Escape");
  check("formation pops back to root", cm.render().title === "Command");

  // A single-member party cannot form a formation (root entry disabled).
  const solo = new PartyManager({ gold: 0 });
  solo.add(new Character({ id: "only", name: "Solo", classId: "warrior" }));
  const cm2 = new CommandMenuSystem({ party: solo, inventory: new Inventory(), consumables: new ConsumableSystem({}), spells: new SpellCastingSystem() });
  const v2 = cm2.open();
  check("formation disabled for solo party", v2.items.find((i) => i.id === "formation").disabled === true);

  return out;
}
