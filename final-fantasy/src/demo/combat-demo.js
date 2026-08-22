// Dev demo harness for Task #18: Combat UI Overlay.
// Launch via window.startCombatDemo() or ?demo=combat.

import { CombatResolver } from "../engine/combat.js";
import { CombatUI } from "../engine/combat-ui.js";
import { Character } from "../engine/character.js";
import { Inventory } from "../engine/inventory.js";

function goblin() {
  return { id: "goblin", name: "Goblin", hp: 18, maxHp: 18, mp: 0, maxMp: 0, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };
}

function imp() {
  return { id: "imp", name: "Imp", hp: 12, maxHp: 12, mp: 0, maxMp: 0, str: 5, atk: 3, int: 3, agi: 14, def: 1, mdef: 1 };
}

function buildParty() {
  const warrior = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  warrior.equipment.weapon = "ironSword";
  warrior.equipment.armor = "chain";
  warrior.damage(10);
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  const healer = new Character({ id: "healer", name: "Healer", classId: "whiteMage" });
  healer.damage(6);
  return [warrior, mage, healer];
}

let combat = null;
let ui = null;

function startBattle() {
  const inv = new Inventory();
  inv.add("potion", 3);
  combat = new CombatResolver({ inventory: inv });
  combat.begin(buildParty(), [goblin(), imp()]);
  ui.setCombat(combat);
  ui.clearLog();
  ui.pushLog("A pack of goblins blocks the path!");
  ui.render();
}

function enemyAction() {
  for (const e of combat.aliveEnemies()) {
    const targets = combat.aliveParty();
    if (!targets.length) break;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const res = combat.attack(e, target);
    for (const msg of res.messages) ui.pushLog(msg);
  }
}

function onCommand(cmd, u) {
  const party = combat.aliveParty();
  const enemies = combat.aliveEnemies();
  if (!party.length || !enemies.length) return;
  const target = enemies[u.selected % enemies.length];
  switch (cmd) {
    case "attack": {
      const res = combat.attack(party[0], target);
      for (const msg of res.messages) ui.pushLog(msg);
      break;
    }
    case "magic": {
      const mage = party.find((m) => m.canCast && m.canCast("fire")) ?? party[0];
      const res = combat.spell(mage, "fire", target);
      for (const msg of res.messages) ui.pushLog(msg);
      break;
    }
    case "item": {
      const res = combat.item(party[0], "potion", party[0]);
      for (const msg of res.messages) ui.pushLog(msg);
      break;
    }
    case "run": {
      const res = combat.tryRun();
      ui.pushLog(res.ok ? "The party fled successfully!" : "Could not escape!");
      break;
    }
    default:
      return;
  }
  if (!combat.isOver) enemyAction();
  if (combat.isVictory) ui.pushLog("Victory!");
  if (combat.isDefeat) ui.pushLog("The party has fallen...");
  ui.render();
}

export function startCombatDemo() {
  const title = document.getElementById("titleScreen");
  if (title) title.hidden = true;
  let host = document.getElementById("combatDemo");
  if (!host) {
    host = document.createElement("div");
    host.id = "combatDemo";
    host.style.cssText = "position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #05060f; z-index: 10;";
    document.body.appendChild(host);
  }
  host.hidden = false;
  if (!ui) {
    ui = new CombatUI(host, { onCommand });
    window.combatDemo = { combat: () => combat, ui };
  }
  startBattle();
}

window.startCombatDemo = startCombatDemo;

if (new URLSearchParams(location.search).get("demo") === "combat") {
  startCombatDemo();
}
