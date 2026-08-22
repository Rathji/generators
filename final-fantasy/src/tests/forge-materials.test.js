// Validation tests for Task #171: forge materials & monster drops.

import { ITEMS } from "../data/items.js";
import { ENEMIES } from "../data/enemies.js";
import { EnemyTemplateSystem } from "../engine/enemies.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const materials = ["ashEmber", "frostShard", "runeShard", "wyrmScale", "coralPearl", "spiritEssence", "voidShard"];
  const gems = ["fireGem", "iceGem", "thunderGem", "holyGem", "voidGem"];

  for (const id of materials) {
    check(id + " defined", !!ITEMS[id]);
    check(id + " is a material", ITEMS[id]?.type === "material");
    check(id + " stacks", (ITEMS[id]?.stackMax ?? 0) >= 99);
  }
  for (const id of gems) {
    check(id + " defined", !!ITEMS[id]);
    check(id + " is a material", ITEMS[id]?.type === "material");
    check(id + " is rare", ITEMS[id]?.rarity === "rare");
  }

  // Every enemy drop references a real item with a sane chance.
  const es = new EnemyTemplateSystem();
  let dropCount = 0;
  const dropsPerItem = {};
  const bad = [];
  for (const enemy of Object.values(ENEMIES)) {
    for (const drop of enemy.loot ?? []) {
      dropCount++;
      if (!ITEMS[drop.itemId]) bad.push(enemy.id + "->" + drop.itemId);
      if (typeof drop.chance !== "number" || drop.chance <= 0 || drop.chance > 1) bad.push(enemy.id + "->" + drop.itemId + " chance " + drop.chance);
      dropsPerItem[drop.itemId] = (dropsPerItem[drop.itemId] ?? 0) + 1;
    }
  }
  check("drops reference real items", bad.length === 0, bad.join(", "));
  check("drops exist across the realm", dropCount >= 20);

  // Every new material and gem drops from at least one monster.
  for (const id of [...materials, ...gems]) {
    check(id + " drops from a monster", (dropsPerItem[id] ?? 0) >= 1, String(dropsPerItem[id] ?? 0));
  }

  // Spot-check a few tables.
  const flame = es.createEnemy("flame");
  const drops = es.lootFor(flame, () => 0);
  check("flame drops ash ember", drops.includes("ashEmber"));
  const voidGolem = es.createEnemy("voidGolem");
  check("void golem drops void shard + gem", es.lootFor(voidGolem, () => 0).includes("voidShard"));
  const rune = es.createEnemy("runeSentinel");
  check("rune sentinel drops rune shard", es.lootFor(rune, () => 0).includes("runeShard"));

  return out;
}
