// Validation tests for Task #18: Combat UI Overlay.

import { CombatUI } from "../engine/combat-ui.js";
import { CombatResolver } from "../engine/combat.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const host = document.createElement("div");
  const commands = [];
  const ui = new CombatUI(host, { onCommand: (cmd) => commands.push(cmd) });

  const combat = new CombatResolver();
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  hero.damage(10);
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  const goblin = { id: "goblin", name: "Goblin", hp: 18, maxHp: 18, mp: 0, maxMp: 0, str: 6, atk: 4, int: 2, agi: 6, def: 2, mdef: 1 };
  combat.begin([hero, mage], [goblin]);
  ui.setCombat(combat);
  ui.pushLog("Battle start!");
  ui.render();

  const text = host.textContent;
  check("party names rendered", text.includes("Hero") && text.includes("Mage"));
  check("enemy name rendered", text.includes("Goblin"));
  check("hp values rendered", text.includes("HP 38/48") && text.includes("HP 18/18"));
  check("mp values rendered", text.includes("MP 18/18"));
  check("log message rendered", text.includes("Battle start!"));
  check("target marker on first enemy", host.querySelector(".cu-target") !== null);

  combat.enemies.push({ id: "imp", name: "Imp", hp: 12, maxHp: 12, mp: 0, maxMp: 0, str: 5, atk: 3, int: 3, agi: 14, def: 1, mdef: 1 });
  ui.setTarget(1);
  ui.render();
  check("one target marker after selection", host.querySelectorAll(".cu-target").length === 1);

  goblin.hp = 0;
  ui.render();
  check("dead enemy gets dead styling", host.querySelector(".cu-row.dead") !== null);

  ui.pushLog("second message");
  check("log accumulates", ui.messages.length === 2 && ui.messages[1] === "second message");

  const btns = [...host.querySelectorAll(".cu-commands button")];
  check("four command buttons", btns.length === 4 && btns.map((b) => b.textContent).join(",") === "Attack,Magic,Item,Run");
  btns[0].click();
  check("attack command wired", commands.includes("attack"));
  check("target index bounds", ui.setTarget(99).selected === 1 && ui.setTarget(-1).selected === 0);

  ui.clearLog();
  check("clearLog empties", ui.messages.length === 0 && host.querySelector("#cuLog").children.length === 0);

  const ui2 = new CombatUI(document.createElement("div"));
  ui2.render();
  check("render without combat is safe", ui2.enemyCount() === 0);

  return out;
}
