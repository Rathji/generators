// Validation tests for Task #216: the Status screen — member listing and the
// per-member detail rows (level, HP/MP, stats, statuses, equipment).

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
  hero.equipment.weapon = "ironSword";
  hero.equipment.armor = "chain";
  hero.addStatus("poison");
  hero.damage(12);
  party.grantXp(3000);
  party.add(hero);
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

  cm.open();
  cm.menu.select("status");
  cm.menu.confirm();
  let view = cm.render();
  check("status screen lists members", view.items.some((i) => i.id === "member_hero"));
  check("member shows level", view.items.find((i) => i.id === "member_hero").label.includes("Lv "));

  cm.menu.select("member_hero");
  cm.menu.confirm();
  view = cm.render();
  check("detail title has name", view.title.includes("Hero"));
  const row = (id) => view.items.find((i) => i.id === "row_" + id);
  check("level row", row("level")?.hint === String(hero.level));
  check("hp row shows current/max", row("hp")?.hint.includes("/"));
  check("hp reflects damage", Number(row("hp").hint.split("/")[0]) === hero.getStats().maxHp - 12, "hint=" + row("hp").hint);
  check("atk row reflects weapon", Number(row("atk").hint) >= 8, "hint=" + row("atk").hint);
  check("status row shows poison", row("status")?.hint.includes("poison"));
  check("equipment row shows gear", row("equipment")?.hint.includes("Iron Sword") && row("equipment").hint.includes("Chain Mail"));
  check("detail rows are read-only", row("hp").disabled === true);
  check("back item present", view.items.some((i) => i.id === "back"));

  // Back returns to the status list.
  cm.menu.select("back");
  cm.menu.confirm();
  check("back returns to status list", cm.render().title === "Status");

  // Clean status shows "None".
  const clean = new PartyManager({ gold: 0 });
  clean.add(new Character({ id: "p", name: "Paladin", classId: "warrior" }));
  const cm2 = new CommandMenuSystem({ party: clean, inventory: new Inventory(), consumables: new ConsumableSystem({}), spells: new SpellCastingSystem() });
  cm2.open();
  cm2.menu.select("status");
  cm2.menu.confirm();
  cm2.menu.select("member_p");
  cm2.menu.confirm();
  const view2 = cm2.render();
  check("no status shows None", view2.items.find((i) => i.id === "row_status").hint === "None");
  check("no equipment shows dashes", view2.items.find((i) => i.id === "row_equipment").hint.includes("\u2014"));

  return out;
}
