// src/army.js — Army composition, recruitment, capacity, and casualties
// (Roadmap tasks 7, 8, 9, 10). Operates on the hero's `army` slot list.

import { UNITS, UNIT_BY_ID, MAX_ARMY_SLOTS, MAX_UNITS_PER_SLOT } from "./units.js";

export function armySize(hero) {
  return (hero.army || []).reduce((s, slot) => s + slot.count, 0);
}

export function findSlot(hero, id) {
  return (hero.army || []).find(s => s.id === id);
}

export function slotsUsed(hero) {
  return (hero.army || []).length;
}

export function canRecruit(hero, id, count) {
  const unit = UNIT_BY_ID[id];
  if (!unit) return { ok: false, reason: "unknown unit" };
  const cost = unit.cost * count;
  if ((hero.gold || 0) < cost) return { ok: false, reason: "gold" };
  const slot = findSlot(hero, id);
  if (!slot && slotsUsed(hero) >= MAX_ARMY_SLOTS) return { ok: false, reason: "slots" };
  const newCount = (slot ? slot.count : 0) + count;
  if (newCount > MAX_UNITS_PER_SLOT) return { ok: false, reason: "capacity" };
  return { ok: true, unit, cost, newCount };
}

export function recruit(hero, id, count) {
  const r = canRecruit(hero, id, count);
  if (!r.ok) return r;
  hero.gold -= r.cost;
  const slot = findSlot(hero, id);
  if (slot) slot.count += count;
  else hero.army.push({ id, count });
  return { ok: true, id, count, cost: r.cost, name: r.unit.name, newCount: r.newCount };
}

export function takeCasualties(hero, losses) {
  // losses: { [unitId]: number } — permanently reduces counts; empty slots are freed.
  const removed = [];
  for (const id of Object.keys(losses || {})) {
    const slot = findSlot(hero, id);
    if (!slot) continue;
    slot.count = Math.max(0, slot.count - (losses[id] || 0));
    if (slot.count === 0) removed.push(id);
  }
  if (hero.army) hero.army = hero.army.filter(s => s.count > 0);
  return { removed, remaining: armySize(hero) };
}

export function armySummary(hero) {
  return (hero.army || []).map(s => {
    const u = UNIT_BY_ID[s.id];
    return { id: s.id, name: u ? u.name : s.id, count: s.count, atk: u ? u.atk : 0, def: u ? u.def : 0, hp: u ? u.hp : 0 };
  });
}
