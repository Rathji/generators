// Validation tests for Task #214: the Magic screen — caster listing, ally
// spell filtering (damage spells excluded out of battle), MP gating, and
// out-of-battle casting (cure / curaga).

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
  party.add(new Character({ id: "mage", name: "Mage", classId: "blackMage", extraSpells: ["cura"] }));
  party.add(new Character({ id: "healer", name: "Healer", classId: "whiteMage", extraSpells: ["curaga"] }));
  const inv = new Inventory();
  inv.add("potion", 1);
  const cm = new CommandMenuSystem({
    party,
    inventory: inv,
    consumables: new ConsumableSystem({ inventory: inv, party }),
    spells: new SpellCastingSystem(),
    log: () => {},
  });

  const toRoot = () => { while (cm.menu.depth > 1) cm.handleKey("Escape"); };
  const openCaster = (id) => {
    toRoot();
    cm.menu.select("magic");
    cm.menu.confirm();
    cm.menu.select("caster_" + id);
    cm.menu.confirm();
  };

  // Magic screen lists casters.
  cm.open();
  cm.menu.select("magic");
  cm.menu.confirm();
  let view = cm.render();
  check("magic screen lists caster", view.items.some((i) => i.id === "caster_healer"));
  check("warrior disabled as caster", view.items.find((i) => i.id === "caster_hero").disabled === true);
  check("mage listed as caster", view.items.some((i) => i.id === "caster_mage"));

  // Caster screen: ally spells only.
  openCaster("healer");
  view = cm.render();
  const ids = view.items.map((i) => i.id);
  check("healer knows cure", ids.includes("spell_cure"));
  check("healer knows curaga (extra)", ids.includes("spell_curaga"));
  check("damage spells excluded", !ids.includes("spell_dia") && !ids.includes("spell_fire"));

  // Damage the hero, cast Cure on him.
  hero.damage(25);
  const healerMpBefore = party.members[2].mp;
  cm.menu.select("spell_cure");
  cm.menu.confirm();
  view = cm.render();
  check("cure opens target screen", view.title.includes("Cure"));
  cm.menu.select("target_hero");
  cm.menu.confirm();
  check("hero healed", hero.hp > hero.getStats().maxHp - 25, "hp=" + hero.hp);
  check("healer spent MP", party.members[2].mp === healerMpBefore - 4);
  check("refreshed to caster screen", cm.render().title.includes("Magic"));
  check("message mentions cure", (cm.lastMessage ?? "").includes("Cure"));

  // Full party wipe: spells have no valid target -> disabled.
  for (const m of party.members) m.damage(99999);
  openCaster("healer");
  view = cm.render();
  check("cure disabled with no alive ally", view.items.find((i) => i.id === "spell_cure").disabled === true);
  check("curaga disabled with no alive ally", view.items.find((i) => i.id === "spell_curaga").disabled === true);

  // Revive via phoenix + curaga targets everyone directly.
  party.members[2].mp = 99; // curaga costs 16 MP
  party.members[0].hp = 1;
  openCaster("healer");
  const curaga = cm.render().items.find((i) => i.id === "spell_curaga");
  check("curaga enabled with an alive ally", curaga.disabled === false);
  cm.menu.select("spell_curaga");
  cm.menu.confirm();
  check("curaga cast directly (no target screen)", cm.render().title.includes("Magic"));
  check("curaga healed the survivor", party.members[0].hp === party.members[0].getStats().maxHp);

  // MP gating: drain healer MP, cure should be disabled.
  party.members[2].mp = 0;
  openCaster("healer");
  view = cm.render();
  check("cure disabled when MP empty", view.items.find((i) => i.id === "spell_cure").disabled === true);

  return out;
}
