// Target selection (roadmap Phase 6, task 21). The plugin owns cast-time target legality
// (its reducer validates `targets` against each card's declared targeting when a spell is
// cast or an ability activated), but exposes no targeting query. This module is that query
// layer: given a board state it returns every legal target for a slot and validates whole
// target-sets with a clear reason for each rejection — mirroring the plugin's own
// frSlotTargetLegal / frTargetSetLegalForTargeting semantics (min/max/distinct, player /
// spell / permanent slots, hexproof vs. opponent casters, zone, types, toughness), extended
// with the Alpha filters the plugin's slot model lacks: non-{type/color/subtype} exclusions
// (Terror, Nettling Imp, Cyclopean Tomb), required color (Red Elemental Blast), spell
// color/type filters (Deathgrip, Fork), tapped/owner requirements (Royal Assassin,
// Simulacrum), graveyard-card targets (Raise Dead, Regrowth), and innate protection
// (White Knight can't be Terror'd). Declarations live on the Alpha projection records
// (src/cards/targeting.js + plugin.js).

import { PLUGIN_CARD_MAP } from "../cards/plugin.js";
import { describeTargeting as describeTargetingText } from "../cards/targeting.js";
import { requireEngine } from "./engine.js";
import * as continuous from "./continuous.js";

export { describeTargetingText as describeTargeting };

// ── card resolution ─────────────────────────────────────────────────────────────────────
// Alpha ids resolve through the 295-card projection; plugin-fixture ids (used in reducer
// tests) resolve through the plugin's own DB.
export function cardDefFor(game, cardId) {
  if (PLUGIN_CARD_MAP[cardId]) return PLUGIN_CARD_MAP[cardId];
  try {
    const c = requireEngine()("card", cardId);
    if (c && typeof c === "object" && c.id) return c;
  } catch (e) {}
  return null;
}

// The colors of a source (the spell being cast, or the permanent whose ability is being
// activated) — used for the protection legality gate.
export function sourceColorsFor(game, sourceCardId) {
  const card = cardDefFor(game, sourceCardId);
  return card && Array.isArray(card.colors) ? card.colors.slice() : [];
}

// ── targeting specs (the declared requirements) ────────────────────────────────────────
export function targetingOf(card) {
  if (!card) return null;
  return card.targeting || null;
}

export function targetingForId(game, cardId, mode) {
  const card = cardDefFor(game, cardId);
  if (!card) return null;
  if (mode !== undefined && mode !== null) {
    if (!Array.isArray(card.modes)) return null;
    for (const m of card.modes) if (m.name === mode) return m.targeting || null;
    return null;
  }
  return card.targeting || null;
}

// The targeting declared for the object (permanent/spell on the battlefield/stack): the
// card's own targeting, or the chosen mode's when the card is modal.
export function cardTargeting(game, objId, mode) {
  const obj = game.raw.objects[objId];
  if (!obj) return null;
  return targetingForId(game, obj.cardId, mode);
}

// Ability targeting: [{ name, targeting }] for a card's activated abilities that target.
export function abilityTargeting(game, cardId) {
  const card = cardDefFor(game, cardId);
  return card && Array.isArray(card.abilityTargeting) ? card.abilityTargeting : [];
}

// The targeting spec for one named ability of a card (null if it doesn't target).
export function abilityTargetingFor(game, cardId, abilityName) {
  for (const a of abilityTargeting(game, cardId)) if (a.name === abilityName) return a.targeting;
  return null;
}

// ── targeting object helpers (mirror the plugin's frTargetingMin/Max/Slots) ────────────
export function targetingMin(t) {
  return typeof t.min === "number" ? t.min : 0;
}

export function targetingMax(t, x) {
  if (t.max === "X") return typeof x === "number" && x > 0 ? x : 0;
  return typeof t.max === "number" ? t.max : 1;
}

export function targetingSlots(t) {
  return Array.isArray(t.slots) && t.slots.length ? t.slots : [{ player: true, permanent: true }];
}

function slotHasPermanentCriteria(slot) {
  return slot.permanent === true || (Array.isArray(slot.types) && slot.types.length > 0) ||
    typeof slot.toughnessLE === "number";
}

// ── object characteristics ──────────────────────────────────────────────────────────────
export function hasKeyword(game, obj, kw) {
  if (Array.isArray(obj.keywords)) return obj.keywords.indexOf(kw) !== -1;
  const card = cardDefFor(game, obj.cardId);
  return !!(card && Array.isArray(card.keywords) && card.keywords.indexOf(kw) !== -1);
}

function numPT(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// powerOf / toughnessOf fold the continuous-effects layer (global pumps, counters,
// buffsUntilEot) via continuous.derivedPower/derivedToughness — same numbers the engine's
// frPower/frToughness produce — so a toughnessLE/powerLE slot (Withering Grasp) sees a
// Crusade pump. A `*` power/toughness stays null (unknowable → the filter can't apply).
export function powerOf(game, obj, card) {
  const card2 = card || cardDefFor(game, obj.cardId);
  if (numPT(card2 && card2.power) === null) return null;
  return continuous.derivedPower(game, obj.id);
}

export function toughnessOf(game, obj, card) {
  const card2 = card || cardDefFor(game, obj.cardId);
  if (numPT(card2 && card2.toughness) === null) return null;
  return continuous.derivedToughness(game, obj.id);
}

function cardHasAny(card, key, values) {
  const list = Array.isArray(card) ? card : card && Array.isArray(card[key]) ? card[key] : null;
  if (!list) return false;
  for (const v of values) if (list.indexOf(v) !== -1) return true;
  return false;
}

// ── single-target legality (mirrors + extends the plugin's frSlotTargetLegal) ──────────
// target is a player index (number) or an object id (string). Returns { ok, reason }.
// opts: { sourceColors } — the colors of the source, for the protection gate.
export function slotTargetLegal(game, target, slot, caster, opts = {}) {
  const state = game.raw;
  if (typeof target === "number") {
    if (slot.player && state.players[target]) {
      if (slot.opponent && target === caster) return { ok: false, reason: "must be an opponent" };
      return { ok: true, reason: null };
    }
    return { ok: false, reason: "not a valid player target" };
  }

  const obj = state.objects[target];
  if (!obj) return { ok: false, reason: "unknown object" };
  const card = cardDefFor(game, obj.cardId);
  if (!card) return { ok: false, reason: "unknown card" };

  // Spells on the stack (with optional color/type filters).
  if (slot.spell) {
    if (obj.zone !== "stack") return { ok: false, reason: "not a spell on the stack" };
    if (Array.isArray(slot.spellColors) && slot.spellColors.length &&
        !cardHasAny(card, "colors", slot.spellColors)) {
      return { ok: false, reason: "not the required color of spell" };
    }
    if (Array.isArray(slot.spellTypes) && slot.spellTypes.length &&
        !cardHasAny(card, "types", slot.spellTypes)) {
      return { ok: false, reason: "not the required type of spell" };
    }
    return { ok: true, reason: null };
  }

  // Cards in a graveyard (Raise Dead, Regrowth, Animate Dead).
  if (slot.zone === "graveyard") {
    if (obj.zone !== "graveyard") return { ok: false, reason: "not a card in a graveyard" };
    if (slot.owner === "self" && obj.owner !== caster) return { ok: false, reason: "not in your graveyard" };
    if (typeof slot.owner === "number" && obj.owner !== slot.owner) return { ok: false, reason: "wrong graveyard" };
    if (Array.isArray(slot.types) && slot.types.length && !cardHasAny(card, "types", slot.types)) {
      return { ok: false, reason: "not the required card type" };
    }
    return { ok: true, reason: null };
  }

  // Battlefield permanents.
  if (obj.zone !== "battlefield") return { ok: false, reason: "not on the battlefield" };
  if (!slotHasPermanentCriteria(slot)) return { ok: false, reason: "not a valid permanent target" };
  if (slot.owner === "self" && obj.controller !== caster) return { ok: false, reason: "not a permanent you control" };
  if (typeof slot.owner === "number" && obj.controller !== slot.owner) return { ok: false, reason: "wrong controller" };
  if (slot.tapped !== undefined && obj.tapped !== slot.tapped) {
    return { ok: false, reason: slot.tapped ? "must be tapped" : "must be untapped" };
  }
  if (obj.controller !== caster && hasKeyword(game, obj, "hexproof")) {
    return { ok: false, reason: "has hexproof" };
  }
  const prot = Array.isArray(card.protections) ? card.protections : [];
  const src = opts.sourceColors || [];
  if (prot.length && src.length && src.some((c) => prot.indexOf(c) !== -1)) {
    return { ok: false, reason: "has protection from the source's color" };
  }
  if (Array.isArray(slot.types) && slot.types.length && !cardHasAny(card, "types", slot.types)) {
    return { ok: false, reason: "wrong permanent type" };
  }
  if (Array.isArray(slot.notTypes) && slot.notTypes.length && cardHasAny(card, "types", slot.notTypes)) {
    return { ok: false, reason: "forbidden permanent type" };
  }
  if (Array.isArray(slot.subtypes) && slot.subtypes.length && !cardHasAny(card, "subtypes", slot.subtypes)) {
    return { ok: false, reason: "wrong subtype" };
  }
  if (Array.isArray(slot.notSubtypes) && slot.notSubtypes.length && cardHasAny(card, "subtypes", slot.notSubtypes)) {
    return { ok: false, reason: "forbidden subtype" };
  }
  if (Array.isArray(slot.colors) && slot.colors.length && !cardHasAny(card, "colors", slot.colors)) {
    return { ok: false, reason: "wrong color" };
  }
  if (Array.isArray(slot.notColors) && slot.notColors.length && cardHasAny(card, "colors", slot.notColors)) {
    return { ok: false, reason: "forbidden color" };
  }
  if (typeof slot.toughnessLE === "number") {
    const t = toughnessOf(game, obj, card);
    if (t !== null && t > slot.toughnessLE) return { ok: false, reason: "toughness too high" };
  }
  if (typeof slot.powerLE === "number") {
    const p = powerOf(game, obj, card);
    if (p !== null && p > slot.powerLE) return { ok: false, reason: "power too high" };
  }
  return { ok: true, reason: null };
}

// ── the targeting query ─────────────────────────────────────────────────────────────────
// All legal targets for one slot (player indices and object ids, in board order).
export function legalTargetsForSlot(game, slot, caster, opts = {}) {
  const state = game.raw;
  const out = [];
  if (slot.spell) {
    for (const e of state.stack || []) {
      if (!e || e.kind !== "spell") continue;
      const o = state.objects[e.objId];
      if (o && o.zone === "stack" && slotTargetLegal(game, o.id, slot, caster, opts).ok) out.push(o.id);
    }
  }
  if (slot.player) {
    for (let p = 0; p < state.players.length; p++) {
      if (slotTargetLegal(game, p, slot, caster, opts).ok) out.push(p);
    }
  }
  if (slot.zone === "graveyard") {
    for (const pl of state.players) {
      for (const id of pl.graveyard || []) {
        const o = state.objects[id];
        if (o && slotTargetLegal(game, id, slot, caster, opts).ok) out.push(id);
      }
    }
  } else if (slotHasPermanentCriteria(slot)) {
    for (const id of state.battlefield || []) {
      const o = state.objects[id];
      if (o && o.zone === "battlefield" && slotTargetLegal(game, id, slot, caster, opts).ok) out.push(id);
    }
  }
  return out;
}

// Whole-set validation against a declared targeting (mirrors the plugin's
// frTargetSetLegalForTargeting): min/max count, per-slot legality in order, distinctness.
// opts: { x, sourceColors }.
export function targetSetLegal(game, targeting, targets, caster, opts = {}) {
  if (!targeting) {
    if (Array.isArray(targets) && targets.length > 0) {
      return { ok: false, reason: "this spell does not take targets" };
    }
    return { ok: true, reason: null };
  }
  const list = Array.isArray(targets) ? targets : [];
  const min = targetingMin(targeting);
  const max = targetingMax(targeting, opts.x);
  if (list.length < min) {
    return { ok: false, reason: "requires at least " + min + " target" + (min === 1 ? "" : "s") };
  }
  if (list.length > max) {
    return { ok: false, reason: "requires at most " + max + " target" + (max === 1 ? "" : "s") };
  }
  const slots = targetingSlots(targeting);
  const distinct = targeting.distinct !== false;
  for (let i = 0; i < list.length; i++) {
    const slot = slots[Math.min(i, slots.length - 1)] || slots[slots.length - 1];
    const v = slotTargetLegal(game, list[i], slot, caster, opts);
    if (!v.ok) return { ok: false, reason: "invalid target #" + (i + 1) + ": " + v.reason };
    if (distinct) {
      for (let j = 0; j < i; j++) {
        if (list[i] === list[j]) return { ok: false, reason: "targets must be distinct" };
      }
    }
  }
  return { ok: true, reason: null };
}

// Enumerates every legal ordered target-set (mirrors the plugin's bounded enumeration:
// sets are capped at 2 targets each by default so a large board stays enumerable; raise
// via opts.cap — e.g. Fireball with X>2). opts: { x, sourceColors, cap }.
export function legalTargetSets(game, targeting, caster, opts = {}) {
  if (!targeting) return [];
  const min = targetingMin(targeting);
  const max = targetingMax(targeting, opts.x);
  const cap = opts.cap === undefined ? Math.min(max, 2) : Math.min(opts.cap, 40);
  const slots = targetingSlots(targeting);
  const out = [];
  for (let k = Math.max(min, 0); k <= Math.min(max, cap); k++) {
    combos(game, slots, k, caster, [], out, opts);
  }
  return out;
}

function combos(game, slots, count, caster, chosen, out, opts) {
  if (chosen.length === count) {
    out.push(chosen.slice());
    return;
  }
  const slot = slots[chosen.length] || slots[slots.length - 1];
  const candidates = legalTargetsForSlot(game, slot, caster, opts);
  for (const c of candidates) {
    if (chosen.indexOf(c) !== -1) continue;
    chosen.push(c);
    combos(game, slots, count, caster, chosen, out, opts);
    chosen.pop();
  }
}

// ── display helpers ─────────────────────────────────────────────────────────────────────
export function targetName(game, target) {
  if (typeof target === "number") {
    const pl = game.raw.players[target];
    return pl && pl.name ? pl.name : "Player " + target;
  }
  const obj = game.raw.objects[target];
  if (!obj) return "unknown";
  const card = cardDefFor(game, obj.cardId);
  return card ? card.name : obj.cardId;
}

export function describeTarget(game, target) {
  if (typeof target === "number") return targetName(game, target);
  const obj = game.raw.objects[target];
  const zone = obj && obj.zone;
  const name = targetName(game, target);
  if (zone === "stack") return "the spell " + name;
  if (zone === "graveyard") return name + " in a graveyard";
  return name;
}
