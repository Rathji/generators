// Validation tests for Task #116: monster ability mapping & resolution.

import { MonsterAbilitySystem } from "../engine/monster-abilities.js";
import { MONSTER_ABILITIES, MONSTER_ABILITY_ASSIGN } from "../data/monster-abilities.js";
import { ENEMIES } from "../data/enemies.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";
import { CombatResolver } from "../engine/combat.js";
import { EnemyAI } from "../engine/enemy-ai.js";
import { StatusEffectSystem } from "../engine/status.js";

function makeSys() {
  return new MonsterAbilitySystem({ enemySystem: new EnemyTemplateSystem() });
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const sys = makeSys();
  check("wolf has rendingBite", sys.abilityOf("wolf")?.id === "rendingBite");
  check("abilityOf unknown null", sys.abilityOf("nope") === null);
  check("ability lookup by id", sys.ability("warCry")?.name === "War Cry");
  check("ability unknown null", sys.ability("nope") === null);
  check("hasAbility true/false", sys.hasAbility("wolf") === true && sys.hasAbility("goblin") === false);

  check("all assignments reference real enemies", Object.keys(MONSTER_ABILITY_ASSIGN).every((id) => ENEMIES[id]));
  check("all assignments reference real abilities", Object.values(MONSTER_ABILITY_ASSIGN).every((id) => MONSTER_ABILITIES[id]));
  check("audit ok", sys.audit().ok === true);

  const desc = sys.describe("frostWyrm");
  check("describe summarizes", desc.summary.includes("Frost Wyrm") && desc.summary.includes("Frozen Breath"));
  check("describe unknown null", sys.describe("nope") === null);

  // Damage ability resolution.
  const enemy = { id: "wolf", name: "Wolf", hp: 50, maxHp: 50, str: 7, atk: 5, int: 1, agi: 9, def: 3, mdef: 1, elements: {} };
  const target = { id: "hero", name: "Hero", hp: 40, maxHp: 40, str: 5, atk: 3, int: 1, agi: 5, def: 2, mdef: 1, elements: {} };
  const res = sys.resolveAbility(sys.ability("rendingBite"), enemy, target, {
    random: () => 0.5,
    statsOf: (c) => c,
    hurt: (c, n) => { const b = c.hp; c.hp = Math.max(0, c.hp - n); return b - c.hp; },
    heal: (c, n) => { c.hp = Math.min(c.maxHp, c.hp + n); },
    status: null,
    affinity: () => 1,
  });
  check("rendingBite dealt damage", res.ok === true && res.damage > 0 && target.hp < 40);
  check("rendingBite message mentions wolf", res.messages[0].includes("Wolf"));

  // Elemental weakness amplification (zombie weak to fire).
  const weakMage = { id: "mage", name: "Mage", hp: 60, maxHp: 60, str: 2, atk: 1, int: 8, agi: 4, def: 1, mdef: 3, elements: { weak: ["fire"] } };
  const plainMage = { id: "mage2", name: "Mage", hp: 60, maxHp: 60, str: 2, atk: 1, int: 8, agi: 4, def: 1, mdef: 3, elements: {} };
  const flameCaster = { id: "flame", name: "Flame", hp: 50, maxHp: 50, str: 3, atk: 2, int: 6, agi: 5, def: 1, mdef: 2, elements: {} };
  const fire = sys.resolveAbility(sys.ability("emberBurst"), flameCaster, weakMage, {
    random: () => 0.5, statsOf: (c) => c, hurt: (c, n) => (c.hp -= n, n), heal: () => {}, status: null,
    affinity: (el, t) => (t.elements?.weak?.includes(el) ? 1.5 : 1),
  });
  check("fire ability vs weak target boosted", fire.damage > 0);
  const neutral = sys.resolveAbility(sys.ability("emberBurst"), flameCaster, plainMage, {
    random: () => 0.5, statsOf: (c) => c, hurt: (c, n) => (c.hp -= n, n), heal: () => {}, status: null, affinity: (el, t) => (t.elements?.weak?.includes(el) ? 1.5 : 1),
  });
  check("weak-target damage exceeds neutral", fire.damage > neutral.damage);

  // Debuff applies a status.
  const status = new StatusEffectSystem({ random: () => 0.1 });
  const hero = { id: "hero", name: "Hero", hp: 50, maxHp: 50, str: 6, atk: 4, int: 1, agi: 5, def: 4, mdef: 2, elements: {} };
  const clawCaster = { id: "zombie", name: "Zombie", hp: 100, maxHp: 100, str: 6, atk: 4, int: 1, agi: 3, def: 5, mdef: 4, elements: {} };
  const claw = sys.resolveAbility(sys.ability("putridClaw"), clawCaster, hero, {
    random: () => 0.1, statsOf: (c) => c, hurt: (c, n) => { const b = c.hp; c.hp = Math.max(0, c.hp - n); return b - c.hp; }, heal: () => {}, status, affinity: () => 1,
  });
  check("debuff applies poison", claw.status === "poison" && status.has(hero, "poison"));

  // Buff bumps the enemy's stat.
  const chief = { id: "goblinChief", name: "Goblin Chief", hp: 60, maxHp: 60, str: 10, atk: 8, int: 4, agi: 8, def: 5, mdef: 2, elements: {} };
  const wc = sys.resolveAbility(sys.ability("warCry"), chief, null, { random: () => 0.5, statsOf: (c) => c, hurt: () => 0, heal: () => {}, status: null, affinity: () => 1 });
  check("buff applied to self", wc.ok === true && wc.buff?.stat === "atk" && chief.buffs.length === 1);

  // CombatResolver integration.
  const templates = new EnemyTemplateSystem({ random: () => 0.5 });
  const wolf = templates.createEnemy("wolf");
  const hero2 = { id: "hero", name: "Hero", hp: 80, maxHp: 80, str: 8, atk: 10, int: 2, agi: 6, def: 6, mdef: 3, elements: {} };
  const combat = new CombatResolver({ random: () => 0.5, crits: false, abilitySystem: sys });
  combat.begin([hero2], [wolf]);
  const ab = combat.ability(wolf, "rendingBite", hero2);
  check("combat.ability resolves", ab.ok === true && ab.damage > 0 && hero2.hp < 80);
  check("combat.ability no system", new CombatResolver({}).ability(wolf, "x", hero2).ok === false);
  check("combat.ability unknown id", combat.ability(wolf, "nope", hero2).error === "unknown ability");

  // EnemyAI integration: forces the ability branch via rng < abilityChance.
  const ai = new EnemyAI({ random: () => 0.1, abilities: sys });
  const d = ai.decide(wolf, [hero2]);
  check("enemyAI chooses ability", d.type === "ability" && d.abilityId === "rendingBite");
  const aiNo = new EnemyAI({ random: () => 0.9, abilities: sys });
  check("enemyAI may skip ability", aiNo.decide(wolf, [hero2]).type === "attack");

  return out;
}
