// Task #27: Elemental Affinity System — Fire/Water/Earth/Wind (etc.) damage
// modifiers vs a target's weaknesses, resistances, and immunities.

import { ELEMENTS } from "../data/elements.js";

export const AFFINITY_MULTIPLIERS = Object.freeze({
  weak: 1.5,
  resist: 0.5,
  immune: 0,
});

// A target's affinity is described by an `elements` object supporting two
// shapes:
//   array form:  { weak: ["fire"], resist: ["ice"], immune: ["lightning"] }
//   map form:    { fire: 1.5, ice: 0.5, lightning: 0 }
// Unknown/absent affinities default to 1 (no modifier).
export function elementalMultiplier(element, target) {
  if (!element) return 1;
  const el = target && typeof target === "object" ? target.elements : null;
  if (!el) return 1;
  if (Array.isArray(el.immune) && el.immune.includes(element)) return 0;
  if (Array.isArray(el.resist) && el.resist.includes(element)) return AFFINITY_MULTIPLIERS.resist;
  if (Array.isArray(el.weak) && el.weak.includes(element)) return AFFINITY_MULTIPLIERS.weak;
  if (typeof el[element] === "number") return el[element];
  return 1;
}

export function isImmune(element, target) {
  return elementalMultiplier(element, target) <= 0;
}

export function isWeakTo(element, target) {
  return elementalMultiplier(element, target) > 1;
}

export function isResistantTo(element, target) {
  return elementalMultiplier(element, target) < 1;
}

// Apply an elemental modifier to a base damage roll.
export function applyElemental(baseDamage, element, target) {
  const multiplier = elementalMultiplier(element, target);
  const damage = Math.max(1, Math.round(baseDamage * multiplier));
  return { damage, multiplier, element };
}

export function validElements() {
  return [...ELEMENTS];
}
