// Validation tests for Task #213: the Items screen — listing consumables,
// target selection (Auto + members), using items through ConsumableSystem,
// and disabled states. Party state is damaged/drained BEFORE opening a
// target screen so the target rows are enabled.

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
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  party.add(mage);
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage" }));
  const inv = new Inventory();
  inv.add("potion", 2);
  inv.add("ether", 1);
  inv.add("phoenixDown", 1);
  inv.add("cottage", 1);
  inv.add("crystalKey", 1);
  const cm = new CommandMenuSystem({
    party,
    inventory: inv,
    consumables: new ConsumableSystem({ inventory: inv, party }),
    spells: new SpellCastingSystem(),
    log: () => {},
  });

  const toRoot = () => { while (cm.menu.depth > 1) cm.handleKey("Escape"); };
  const openItems = () => {
    toRoot();
    cm.menu.select("items");
    cm.menu.confirm();
  };

  // Damage the hero and drain the mage BEFORE opening target screens.
  hero.damage(30);
  mage.mp = 2;

  // Open Items.
  cm.open();
  cm.menu.select("items");
  cm.menu.confirm();
  let view = cm.render();
  check("items screen lists potion x2", view.items.some((i) => i.id === "item_potion" && i.label.includes("x2")));
  check("items screen lists ether", view.items.some((i) => i.id === "item_ether"));
  check("items screen lists phoenix down", view.items.some((i) => i.id === "item_phoenixDown"));
  check("items screen lists cottage", view.items.some((i) => i.id === "item_cottage"));
  check("non-consumable excluded", !view.items.some((i) => i.id === "item_crystalKey"));

  // Potion: single-target -> member submenu with Auto + the hurt hero enabled.
  cm.menu.select("item_potion");
  cm.menu.confirm();
  view = cm.render();
  check("potion opens target screen", view.title === "Potion");
  check("target screen has Auto + members", view.items.length === 4 && view.items[0].id === "auto");
  check("auto enabled for a hurt hero", view.items[0].disabled === false);
  check("hurt hero target enabled", view.items.find((i) => i.id === "target_hero").disabled === false);
  check("full-hp healer target disabled", view.items.find((i) => i.id === "target_healer").disabled === true);

  // Use potion on the hero explicitly.
  cm.menu.select("target_hero");
  cm.menu.confirm();
  check("potion used on hero", hero.hp === hero.getStats().maxHp, "hp=" + hero.hp);
  check("potion consumed", inv.count("potion") === 1);
  check("screen refreshed to target screen", cm.render().title === "Potion");
  check("message mentions HP", (cm.lastMessage ?? "").includes("HP"));

  // Cottage (healAll) uses immediately without a target screen.
  party.members.forEach((m) => m.damage(20));
  openItems();
  cm.menu.select("item_cottage");
  cm.menu.confirm();
  check("cottage used directly (no target screen)", cm.render().title === "Items");
  check("cottage consumed", inv.count("cottage") === 0);
  check("cottage healed the party", party.members.every((m) => m.hp === m.getStats().maxHp));

  // Ether -> target the drained mage (cottage topped everyone off, so drain).
  mage.mp = 2;
  openItems();
  cm.menu.select("item_ether");
  cm.menu.confirm();
  view = cm.render();
  check("ether targets magic users", view.items.find((i) => i.id === "target_mage").disabled === false);
  cm.menu.select("target_mage");
  cm.menu.confirm();
  check("ether restored mage MP", mage.mp === 12, "mp=" + mage.mp);
  check("ether consumed", inv.count("ether") === 0);

  // Phoenix Down: kill the hero, revive them.
  hero.damage(9999);
  openItems();
  cm.menu.select("item_phoenixDown");
  cm.menu.confirm();
  view = cm.render();
  check("revive shows downed hero enabled", view.items.find((i) => i.id === "target_hero").disabled === false);
  cm.menu.select("target_hero");
  cm.menu.confirm();
  check("hero revived", hero.hp > 0 && hero.isAlive());
  check("phoenix down consumed", inv.count("phoenixDown") === 0);

  return out;
}
