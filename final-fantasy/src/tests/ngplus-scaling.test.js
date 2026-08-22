// Validation tests for Task #192: New Game+ enemy scaling — the growth
// curve per cycle for mobs and bosses, and the scaled enemy copies.

import { NgPlusSystem } from "../engine/ngplus.js";
import { GameState } from "../engine/state.js";
import { ENEMIES } from "../data/enemies.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const es = new EnemyTemplateSystem();
  const ng = new NgPlusSystem({ state, enemySystem: es });

  check("cycle 1 default", ng.cycle() === 1);
  check("cycle 1 growth = 1", ng.growthFor(false) === 1 && ng.growthFor(true) === 1);
  state.setFlag("ngplus_cycle", 2);
  check("cycle read from state", ng.cycle() === 2);
  check("cycle 2 mob growth 1.35", Math.abs(ng.growthFor(false) - 1.35) < 1e-9);
  check("cycle 2 boss growth 1.5", Math.abs(ng.growthFor(true) - 1.5) < 1e-9);
  state.setFlag("ngplus_cycle", 3);
  check("cycle 3 mob growth 1.8225", Math.abs(ng.growthFor(false) - 1.35 * 1.35) < 1e-9);
  check("cycle 3 boss growth 2.25", Math.abs(ng.growthFor(true) - 2.25) < 1e-9);

  // A goblin, doubled.
  state.setFlag("ngplus_cycle", 2);
  const goblin = es.createEnemy("goblin");
  const scaled = ng.scaleEnemy(goblin);
  const base = ENEMIES.goblin;
  check("mob hp scaled", scaled.hp === Math.round(base.hp * 1.35), `${base.hp}->${scaled.hp}`);
  check("mob atk scaled", scaled.atk === Math.round(base.atk * 1.35));
  check("mob xp scaled with xp mult", scaled.xp === Math.round(base.xp * 1.35 * 1.25), `${base.xp}->${scaled.xp}`);
  check("mob gold scaled with gold mult", scaled.gold === Math.round(base.gold * 1.35 * 1.25));
  check("mob name intact", scaled.name === base.name);

  // A boss, scaled harder.
  const boss = es.createEnemy("chrono");
  const scaledBoss = ng.scaleEnemy(boss);
  check("boss hp scaled x1.5", scaledBoss.hp === Math.round(ENEMIES.chrono.hp * 1.5), `${ENEMIES.chrono.hp}->${scaledBoss.hp}`);
  check("boss ai intact", scaledBoss.ai?.spellChance === ENEMIES.chrono.ai.spellChance);

  // Echo boss scales too.
  state.setFlag("ngplus_cycle", 2);
  const echo = ng.echoBoss();
  check("echo boss exists and scaled", echo.id === "echoOfCreation" && echo.hp === Math.round(ENEMIES.echoOfCreation.hp * 1.5), `echo hp ${echo.hp}`);

  // scaleEncounter maps over a party of enemies.
  const group = es.createGroup("echo_creation");
  const scaledGroup = ng.scaleEncounter(group);
  check("group scaled", scaledGroup.length === group.length && scaledGroup[0].hp >= group[0].hp);

  // No mutation of the template database.
  check("templates untouched", ENEMIES.goblin.hp === base.hp && es.template("goblin").hp === base.hp);

  return out;
}
