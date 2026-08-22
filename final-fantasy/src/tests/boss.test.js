// Validation tests for Task #32: Boss Phase Transition Logic.

import { BossPhaseController } from "../engine/boss.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const es = new EnemyTemplateSystem();
  const boss = new BossPhaseController();
  const goblin = es.createEnemy("goblin");
  const chief = es.createEnemy("goblinChief");

  check("boss flag set", chief.boss === true && goblin.boss === false);
  check("isBoss", boss.isBoss(chief) === true && boss.isBoss(goblin) === false);
  check("phases cloned", chief.phases.length === 1 && chief.phases[0].name === "Enraged");

  check("full HP no transition", boss.checkPhase(chief) === null);
  check("phase state base", boss.phaseState(chief).phase === 0);

  const str0 = chief.str;
  chief.hp = 30; // ratio 0.5 => phase 1
  const t = boss.checkPhase(chief);
  check("phase triggers at threshold", t !== null && t.transitions.length === 1 && t.transitions[0].phase === 1 && t.transitions[0].name === "Enraged");
  check("phase stats applied", chief.str === str0 + 4 && chief.atk === 8 + 3 && chief.agi === 8 + 3);
  check("phase ai override", chief.ai.spellChance === 0.7 && chief.ai.spells.includes("fire"));
  check("currentPhase recorded", chief.currentPhase === 1);
  check("phase history", chief.phaseTransitions.length === 1);
  check("no repeat at same phase", boss.checkPhase(chief) === null);
  check("phase state after trigger", boss.phaseState(chief).phase === 1 && boss.phaseState(chief).name === "Enraged");

  chief.hp = 20;
  check("no extra phase below threshold", boss.checkPhase(chief) === null);

  const garland = es.createEnemy("garland");
  check("two-phase boss", garland.phases.length === 2);
  garland.hp = 90; // ratio 0.64 => phase 1
  const g1 = boss.checkPhase(garland);
  check("phase 1 triggered", g1.transitions.length === 1 && g1.transitions[0].phase === 1 && g1.transitions[0].name === "Roused");
  const strG = garland.str;
  garland.hp = 40; // ratio 0.28 => phase 2
  const g2 = boss.checkPhase(garland);
  check("phase 2 triggered", g2.transitions.length === 1 && g2.transitions[0].phase === 2 && g2.transitions[0].name === "Enraged");
  check("phase 2 stacks on phase 1", garland.str === strG + 5);
  check("phase 2 ai", garland.ai.spellChance === 0.9);

  const g2again = boss.checkPhase(garland);
  check("no third transition", g2again === null);

  const resetChief = es.createEnemy("goblinChief");
  resetChief.hp = 30;
  boss.checkPhase(resetChief);
  boss.reset(resetChief);
  check("reset clears phases", resetChief.currentPhase === 0 && resetChief.phaseTransitions.length === 0);

  check("non-boss never phases", boss.checkPhase(goblin) === null && boss.phaseState(goblin).phase === 0);
  check("history accumulates", boss.history.length >= 3);

  const hpBonus = es.createEnemy("garland");
  hpBonus.hp = 41; // ratio 0.29 => phase 2 directly
  const hb = boss.checkPhase(hpBonus);
  check("skip-ahead applies both phases", hb.transitions.length === 2 && hpBonus.currentPhase === 2);

  return out;
}
