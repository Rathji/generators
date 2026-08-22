// Task #125: End-to-End Gameplay Smoke Test — drives the real core loops in
// order: Combat -> Level Up -> Gear -> Boss -> Rewards -> Chest -> Save/Load.

import { GameState } from "../engine/state.js";
import { Inventory } from "../engine/inventory.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";
import { EquipSystem } from "../engine/equipment.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { CombatResolver } from "../engine/combat.js";
import { EnemyAI } from "../engine/enemy-ai.js";
import { CombatRewardResolver } from "../engine/rewards.js";
import { ChestSystem } from "../engine/chests.js";
import { SaveManager, serializeGame, deserializeGame } from "../engine/save.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const rng = () => 0.4;
  const state = new GameState();
  const inv = new Inventory({ maxSlots: 30, maxWeight: 300 });
  const party = new PartyManager({ gold: 150 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  party.add(hero);
  party.add(mage);
  state.setParty(party);
  state.setInventory(inv);
  inv.add("potion", 5);
  inv.add("phoenixDown", 2);

  // GEAR: equip a real upgrade and confirm stats rise.
  const equip = new EquipSystem(inv);
  inv.add("ironSword", 1);
  const eq = equip.equip(hero, "ironSword");
  check("equip ironSword", eq.ok === true);
  const baseHero = new Character({ id: "b", name: "B", classId: "warrior" });
  check("gear raises attack", hero.getStats().atk > baseHero.getStats().atk);

  const templates = new EnemyTemplateSystem({ random: rng });
  const rewards = new CombatRewardResolver({ party, inventory: inv, enemySystem: templates, random: rng });

  function fight(groupId) {
    const enemies = templates.createGroup(groupId, rng);
    const combat = new CombatResolver({ random: rng, crits: false, inventory: inv });
    const ai = new EnemyAI({ random: rng });
    combat.begin(party.members, enemies);
    let guard = 0;
    while (!combat.isOver && guard++ < 300) {
      // Party heals up before acting, then attacks.
      for (const m of party.members) {
        if (m.hp <= 0) continue;
        const target = enemies.find((e) => e.hp > 0);
        if (!target) break;
        if (m.hp < m.getStats().maxHp * 0.5) combat.item(m, "potion", m);
        if (m.hp > 0) combat.attack(m, target);
      }
      // Downed members get revived.
      for (const m of party.members) {
        if (m.hp <= 0) combat.item(m, "phoenixDown", m);
      }
      // Enemies act.
      for (const e of enemies) {
        if (combat.isOver) break;
        if (e.hp <= 0) continue;
        const target = party.members.find((mm) => mm.hp > 0);
        if (!target) break;
        ai.turn(e, party.members, enemies, { combat });
      }
    }
    return { combat, enemies };
  }

  // COMBAT: a normal encounter.
  const fight1 = fight("goblins");
  check("goblins fight resolved as victory", fight1.combat.isVictory === true);
  const r1 = rewards.resolve(fight1.enemies);
  check("combat rewards granted", r1.xp === 24 && r1.gold === 36);
  check("gold landed in party", party.gold === 150 + 36);

  // BOSS: garland falls with better gear.
  inv.add("luminary", 1);
  inv.add("runePlate", 1);
  inv.add("powerGauntlet", 1);
  equip.equip(hero, "luminary");
  equip.equip(hero, "runePlate");
  equip.equip(hero, "powerGauntlet");
  const fight2 = fight("garland_ambush");
  check("garland is a boss", fight2.enemies[0].boss === true);
  check("boss fight won", fight2.combat.isVictory === true);
  const beforeLevels = party.members.map((m) => m.level);
  const r2 = rewards.resolve(fight2.enemies);
  check("boss xp applied", r2.xp === 220);
  check("party leveled up", party.members.some((m, i) => m.level > beforeLevels[i]));
  check("boss loot dropped", r2.loot.includes("mythrilSword") || inv.count("mythrilSword") > 0);
  check("party survived", party.members.every((m) => m.hp > 0));

  // CHEST: a real chest grants items once.
  const chests = new ChestSystem([{
    id: "smoke_chest", mapId: "cornelia", x: 1, y: 1,
    contents: { items: [{ itemId: "ether", count: 1 }], gold: 40 },
    flag: "chest_smoke_chest_opened",
  }], { state, inventory: inv, party, random: rng });
  const c1 = chests.open("cornelia", 1, 1);
  check("chest opened", c1.ok === true && inv.count("ether") === 1 && c1.gold === 40);
  const c2 = chests.open("cornelia", 1, 1);
  check("chest opens once", c2.ok === false && c2.error === "already opened");

  // SAVE/LOAD: the run persists through serialization.
  const saves = new SaveManager({});
  saves.save("smoke", { state, party, inventory: inv });
  const loaded = saves.load("smoke");
  check("save round-trips gold", loaded.party.gold === party.gold);
  check("save round-trips hero level", loaded.party.members[0].level === hero.level);
  check("save round-trips inventory", loaded.inventory.count("ether") === 1);
  check("save round-trips flags", loaded.state.getFlag("chest_smoke_chest_opened") === true);
  const json = serializeGame({ state, party, inventory: inv });
  const rt = deserializeGame(json);
  check("serialize/deserialize preserves gear", rt.party.members[0].equipment.weapon === "luminary");

  return out;
}
