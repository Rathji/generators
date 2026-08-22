// Validation tests for Task #26: Spell Casting Logic.
// Exercises MP consumption, knowledge checks, single-target + AoE spells,
// and elemental affinity integration (Tasks #27/#29).

import { SpellCastingSystem } from "../engine/spellcasting.js";
import { Character } from "../engine/character.js";
import { SPELLS } from "../data/spells.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sc = new SpellCastingSystem({ random: () => 0.5 });
  const mage = new Character({ id: "m", name: "Mage", classId: "blackMage" });
  const es = new EnemyTemplateSystem();
  const goblin = es.createEnemy("goblin");
  const zombie = es.createEnemy("zombie");
  const imp = es.createEnemy("imp");
  const enemies = [goblin, zombie, imp];

  check("lvl1 mage knows fire", sc.knows(mage, "fire") === true);
  check("lvl1 mage cannot fira", sc.knows(mage, "fira") === false);
  check("canCast with mp", sc.canCast(mage, "fire") === true);

  const res = sc.cast(mage, "fire", [mage], enemies, goblin);
  check("fire cast ok", res.ok === true && res.spellId === "fire");
  check("mp consumed", res.mpCost === SPELLS.fire.mp && mage.mp === mage.getStats().maxMp - 4);
  check("single target hit", res.results.length === 1 && res.results[0].target === goblin);
  check("fire damage applied", goblin.hp === goblin.maxHp - res.results[0].damage && res.results[0].damage > 0);
  check("weak fire dealt to goblin", res.results[0].weak === true && res.results[0].multiplier === 1.5);

  const unlearned = sc.cast(mage, "fira", [mage], enemies, goblin);
  check("unlearned spell blocked", unlearned.ok === false && unlearned.error === "spell not learned");

  mage.spendMp(16);
  const noMp = sc.cast(mage, "fire", [mage], enemies, goblin);
  check("insufficient MP blocked", noMp.ok === false && noMp.error === "insufficient MP");

  const aoeEnemies = [es.createEnemy("goblin"), es.createEnemy("zombie"), es.createEnemy("imp")];
  const fullMage = new Character({ id: "m2", name: "Mage2", classId: "blackMage" });
  fullMage.mp = 40;
  fullMage.learnSpell("firaga");
  const aoE = sc.cast(fullMage, "firaga", [fullMage], aoeEnemies, null);
  check("aoe spell targets all enemies", aoE.ok === true && aoE.results.length === 3);
  check("aoe kills only when damage enough", aoE.results.every((r) => r.type === "damage"));
  check("aoe mp cost", fullMage.mp === 40 - 22);

  const healer = new Character({ id: "h", name: "Healer", classId: "whiteMage" });
  const ally = new Character({ id: "a", name: "Ally", classId: "warrior" });
  ally.damage(30);
  const party = [healer, ally];
  const heal = sc.cast(healer, "cure", party, [goblin], ally);
  check("cure heals ally", heal.ok === true && heal.results[0].type === "heal" && ally.hp > 0 && heal.results[0].amount > 0);
  check("heal mp cost", healer.mp === healer.getStats().maxMp - 4);

  const healer2 = new Character({ id: "h2", name: "Healer2", classId: "whiteMage", level: 7 });
  const w1 = new Character({ id: "w1", name: "W1", classId: "warrior" });
  const w2 = new Character({ id: "w2", name: "W2", classId: "warrior" });
  w1.damage(30);
  w2.damage(30);
  const party2 = [healer2, w1, w2];
  const curaga = sc.cast(healer2, "curaga", party2, [goblin], null);
  check("curaga targets all allies", curaga.ok === true && curaga.results.length === 3 && curaga.results.every((r) => r.type === "heal"));
  check("all allies restored", w1.hp === w1.getStats().maxHp && w2.hp === w2.getStats().maxHp);

  const iceZombie = es.createEnemy("zombie");
  const iceMage = new Character({ id: "im", name: "IceMage", classId: "blackMage", level: 2 });
  const ice = sc.cast(iceMage, "blizzard", [iceMage], [iceZombie], iceZombie);
  check("zombie resists ice", ice.results[0].resisted === true && ice.results[0].multiplier === 0.5);

  const holyZombie = es.createEnemy("zombie");
  const diaCaster = new Character({ id: "dc", name: "DiaCaster", classId: "whiteMage", level: 2 });
  const holy = sc.cast(diaCaster, "dia", [diaCaster], [holyZombie], holyZombie);
  check("zombie weak to holy", holy.results[0].weak === true);

  const dead = es.createEnemy("goblin");
  dead.hp = 0;
  fullMage.mp = 40;
  const noTarget = sc.cast(fullMage, "firaga", [fullMage], [dead], null);
  check("no valid targets blocks cast", noTarget.ok === false && noTarget.error === "no valid targets");

  return out;
}
