// Validation tests for Task #27: Elemental Affinity System.

import {
  elementalMultiplier,
  applyElemental,
  isImmune,
  isWeakTo,
  isResistantTo,
  AFFINITY_MULTIPLIERS,
} from "../engine/affinity.js";
import { ELEMENTS, ELEMENT_NAMES } from "../data/elements.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("element list complete", ELEMENTS.length === 7 && ELEMENT_NAMES.fire === "Fire");
  check("no element => 1", elementalMultiplier(null, {}) === 1 && elementalMultiplier("fire", null) === 1);
  check("no affinities => 1", elementalMultiplier("fire", {}) === 1);

  const zombie = { elements: { weak: ["fire", "holy"], resist: ["ice"] } };
  check("weak multiplier", elementalMultiplier("fire", zombie) === AFFINITY_MULTIPLIERS.weak);
  check("resist multiplier", elementalMultiplier("ice", zombie) === AFFINITY_MULTIPLIERS.resist);
  check("neutral element", elementalMultiplier("wind", zombie) === 1);

  const golem = { elements: { immune: ["fire"] } };
  check("immune multiplier", elementalMultiplier("fire", golem) === 0);

  const mapForm = { elements: { fire: 2 } };
  check("map form multiplier", elementalMultiplier("fire", mapForm) === 2);

  check("isWeakTo", isWeakTo("fire", zombie) === true && isWeakTo("ice", zombie) === false);
  check("isResistantTo", isResistantTo("ice", zombie) === true && isResistantTo("fire", zombie) === false);
  check("isImmune", isImmune("fire", golem) === true && isImmune("ice", golem) === false);

  const hit = applyElemental(100, "fire", zombie);
  check("applyElemental weak dmg", hit.damage === 150 && hit.multiplier === 1.5 && hit.element === "fire");
  const resistHit = applyElemental(100, "ice", zombie);
  check("applyElemental resist dmg", resistHit.damage === 50 && resistHit.multiplier === 0.5);
  const immuneHit = applyElemental(100, "fire", golem);
  check("applyElemental immune floors at 1", immuneHit.damage === 1 && immuneHit.multiplier === 0);
  const neutral = applyElemental(99, "wind", zombie);
  check("applyElemental neutral rounds", neutral.damage === 99 && neutral.multiplier === 1);

  check("applyElemental no element", applyElemental(42, null, {}).multiplier === 1 && applyElemental(42, null, {}).damage === 42);

  return out;
}
