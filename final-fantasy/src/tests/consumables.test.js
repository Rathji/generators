// Validation tests for Task #42: Consumable Item Effect System.

import { ConsumableSystem } from "../engine/consumables.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

function partyWith() {
  const party = new PartyManager();
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  party.add(hero);
  party.add(mage);
  return { party, hero, mage };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const { party, hero, mage } = partyWith();
  const inv = new Inventory({ maxSlots: 30, maxWeight: 100 });
  inv.add("potion", 3);
  inv.add("ether", 1);
  inv.add("antidote", 1);
  inv.add("phoenixDown", 1);
  inv.add("elixir", 1);
  inv.add("cottage", 1);
  inv.add("fireScroll", 1);
  const cs = new ConsumableSystem({ inventory: inv, party });

  hero.damage(20);
  mage.damage(5);
  const heal = cs.use("potion");
  check("heal auto-targets lowest HP", heal.targetId === "hero" && heal.ok && heal.healed > 0);
  check("consumed on success", inv.count("potion") === 2);

  hero.heal(999);
  mage.heal(999);
  const fullHeal = cs.use("potion");
  check("use on full HP rejected", fullHeal.ok === false);
  check("failed use not consumed", inv.count("potion") === 2);

  mage.spendMp(6);
  const mp = cs.use("ether");
  check("ether targets lowest MP", mp.targetId === "mage" && mp.ok && mp.restored === 6);

  hero.addStatus("poison");
  const cure = cs.use("antidote");
  check("antidote finds poisoned member", cure.targetId === "hero" && cure.ok);
  check("poison cleared", hero.hasStatus("poison") === false);
  check("antidote consumed", inv.count("antidote") === 0);
  check("antidote with no one poisoned rejected", cs.use("antidote").ok === false);

  hero.damage(999);
  const revive = cs.use("phoenixDown");
  check("phoenix down targets downed member", revive.targetId === "hero" && revive.ok);
  check("revived at half HP", hero.hp === Math.max(1, Math.floor(hero.getStats().maxHp * 0.5)));
  check("phoenix down consumed", inv.count("phoenixDown") === 0);
  check("phoenix down with no downed rejected", cs.use("phoenixDown").ok === false);

  hero.heal(999);
  hero.damage(20);
  mage.damage(15);
  const elixir = cs.use("elixir");
  check("elixir fully restores neediest member", elixir.ok === true && hero.hp === hero.getStats().maxHp);
  check("elixir consumed", inv.count("elixir") === 0);

  const cottage = cs.use("cottage");
  check("cottage heals whole party", cottage.ok === true);

  mage.mp = 0;
  mage.extraSpells = [];
  const scroll = cs.use("fireScroll");
  check("scroll teaches fira to caster", scroll.targetId === "mage" && mage.knowsSpell("fira"));
  check("scroll consumed", inv.count("fireScroll") === 0);
  check("scroll cannot be reused", cs.use("fireScroll").ok === false);

  check("explicit target override", (() => {
    hero.damage(5);
    const before = hero.hp;
    return cs.use("potion", { target: hero }).targetId === "hero" && hero.hp > before;
  })());

  check("non-consumable rejected", cs.use("ironSword").ok === false);
  check("unknown item rejected", cs.use("nope").ok === false);
  check("not-owned rejected", cs.use("hiPotion").ok === false);
  check("list only consumables", cs.list().every((e) => e.type === "consumable"));

  const empty = new ConsumableSystem({ inventory: inv });
  check("no party: heal fails cleanly", empty.use("potion").ok === false);

  const explicit = new Character({ id: "e", name: "E", classId: "whiteMage" });
  const res = cs.canUse("potion", explicit);
  check("canUse validates against explicit target", res.ok === false);

  // Task #213 regression: canUse must NOT mutate the party (dry-run only).
  const beforeHp = party.members.map((m) => m.hp).join(",");
  const beforeStatuses = party.members.map((m) => (m.statuses ?? []).join("|")).join(",");
  const beforeCount = inv.count("potion");
  cs.canUse("potion");
  cs.canUse("cottage");
  const afterHp = party.members.map((m) => m.hp).join(",");
  const afterStatuses = party.members.map((m) => (m.statuses ?? []).join("|")).join(",");
  check("canUse does not heal anyone", afterHp === beforeHp);
  check("canUse does not alter statuses", afterStatuses === beforeStatuses);
  check("canUse consumes nothing", inv.count("potion") === beforeCount);

  return out;
}
