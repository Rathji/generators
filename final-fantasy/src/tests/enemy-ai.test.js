// Validation tests for Task #31: Basic Enemy Action Logic.

import { EnemyAI } from "../engine/enemy-ai.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { CombatResolver } from "../engine/combat.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const es = new EnemyTemplateSystem();
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  const mage = new Character({ id: "mage", name: "Mage", classId: "blackMage" });
  const party = [hero, mage];

  const ai = new EnemyAI({ random: () => 0 });
  const goblin = es.createEnemy("goblin");
  const act = ai.decide(goblin, party, []);
  check("no-ai enemy attacks", act.type === "attack" && party.includes(act.target));

  const chief = es.createEnemy("goblinChief");
  check("boss has ai spells", Array.isArray(chief.ai.spells) && chief.ai.spells.includes("fire"));
  const spellAct = ai.decide(chief, party, []);
  check("spell-capable enemy casts", spellAct.type === "spell" && spellAct.spellId === "fire");
  check("spell targets single enemy scope", spellAct.target === hero);

  const dryChief = es.createEnemy("goblinChief");
  dryChief.mp = 0;
  const dryAct = ai.decide(dryChief, party, []);
  check("no MP falls back to attack", dryAct.type === "attack");

  const deadParty = [new Character({ id: "d1", name: "D1", classId: "warrior" }), new Character({ id: "d2", name: "D2", classId: "warrior" })];
  deadParty[0].damage(999);
  deadParty[1].damage(999);
  const waitAct = ai.decide(goblin, deadParty, []);
  check("no living targets => wait", waitAct.type === "wait");

  const lowChance = new EnemyAI({ random: () => 0.99 });
  const lowAct = lowChance.decide(chief, party, []);
  check("high roll skips spell", lowAct.type === "attack");

  const cr = new CombatResolver({ random: () => 0.5 });
  cr.begin(party, [goblin]);
  const execRes = ai.execute({ type: "attack", enemy: goblin, target: hero }, { combat: cr });
  check("attack executes via combat", execRes.messages.length === 1 && (execRes.damage > 0 || execRes.missed === true));

  const cr2 = new CombatResolver({ random: () => 0.5 });
  const chief2 = es.createEnemy("goblinChief");
  cr2.begin(party, [chief2]);
  const spellRes = ai.execute({ type: "spell", enemy: chief2, spellId: "fire", spell: { name: "Fire" }, target: hero }, { combat: cr2 });
  check("spell executes via combat", spellRes.ok === true && spellRes.element === "fire");
  check("spell consumes enemy MP", chief2.mp === 8 - 4);

  const cr3 = new CombatResolver({ random: () => 0.5 });
  cr3.begin(party, [goblin]);
  const t = ai.turn(goblin, party, [goblin], { combat: cr3 });
  check("turn combines decide+execute", t.action.type === "attack" && Array.isArray(t.result.messages));

  check("alive filter", ai.alive([goblin, { hp: 0 }]).length === 1);
  check("canCast gates by MP", ai.canCast(chief, "fire") === true && ai.canCast(dryChief, "fire") === false);

  return out;
}
