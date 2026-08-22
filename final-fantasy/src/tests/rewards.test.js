// Validation tests for Task #33: Combat Reward Resolver.

import { CombatRewardResolver } from "../engine/rewards.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const es = new EnemyTemplateSystem();
  const party = new PartyManager({ gold: 0 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  party.add(hero);
  party.add(mage);
  const inv = new Inventory();

  const rw = new CombatRewardResolver({ party, inventory: inv, enemySystem: es, random: () => 0 });
  const enemies = [es.createEnemy("goblin"), es.createEnemy("imp")]; // xp 22, gold 30
  const res = rw.resolve(enemies);

  check("xp total", res.xp === 22);
  check("gold total", res.gold === 30 && party.gold === 30);
  check("xp distributed to alive members", hero.xp === 22 && mage.xp === 22);
  check("guaranteed loot dropped", res.loot.includes("goblinFang") && inv.count("goblinFang") === 1);
  check("no level ups yet", res.levelUps.length === 0);

  const rw90 = new CombatRewardResolver({ party, inventory: inv, enemySystem: es, random: () => 0 });
  hero.xp = 90; // +22 => 112 => level 2
  mage.xp = 0;
  const ups = rw90.resolve([es.createEnemy("imp")]); // +10 xp
  check("level up granted", ups.levelUps.length === 1 && hero.level === 2);
  check("resolver is chainable", typeof rw90.summarize === "function");

  const tiny = new PartyManager({ gold: 0 });
  const tHero = new Character({ id: "th", name: "TH", classId: "warrior" });
  tiny.add(tHero);
  const smallInv = new Inventory({ maxSlots: 1 });
  const rwOver = new CombatRewardResolver({ party: tiny, inventory: smallInv, enemySystem: es, random: () => 0 });
  smallInv.add("potion", 1); // full
  const over = rwOver.resolve([es.createEnemy("goblin")]);
  check("overflow reported when inventory full", over.overflow.includes("goblinFang") && over.loot.length === 0);

  const bonus = new CombatRewardResolver({ party: tiny, inventory: smallInv, enemySystem: es, random: () => 0, xpBonus: 1.5, goldBonus: 2 });
  const totals = bonus.totals([es.createEnemy("goblin")]);
  check("bonus multipliers", totals.xp === 18 && totals.gold === 36);

  const noInv = new CombatRewardResolver({ party: tiny, enemySystem: es, random: () => 0 });
  const noInvRes = noInv.resolve([es.createEnemy("goblin")]);
  check("no inventory: loot still reported", noInvRes.loot.includes("goblinFang"));

  const manual = new CombatRewardResolver({ party: tiny, random: () => 0 });
  const manualLoot = manual.rollLoot([{ id: "x", loot: [{ itemId: "ironSword", chance: 1 }] }]);
  check("manual enemy loot fallback", manualLoot.includes("ironSword"));

  const deadParty = new PartyManager({ gold: 0 });
  const deadHero = new Character({ id: "dh", name: "DH", classId: "warrior" });
  deadHero.damage(999);
  deadParty.add(deadHero);
  const rwDead = new CombatRewardResolver({ party: deadParty, enemySystem: es, random: () => 0 });
  const deadRes = rwDead.resolve([es.createEnemy("goblin")]);
  check("downed members skip xp", deadHero.xp === 0 && deadRes.xp === 12);

  const summary = rwDead.summarize(deadRes);
  check("summary string", summary.includes("+12 XP") && summary.includes("gold"));

  return out;
}
