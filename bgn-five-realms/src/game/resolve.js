// Five Realms — spell resolution & fizzle (roadmap Phase 6, task 22).
// The plugin's engine resolves the topmost object on an all-pass round (see stack.js),
// but it never re-checks target legality at resolution: a spell whose targets became
// illegal before it resolved (creature killed, spell countered, protection gained, ...)
// would still apply its effect. This module layers the missing resolution rules on top
// of the plugin's resolve machinery:
//   • checkTargetsAtResolve — re-check the resolving object's chosen targets against the
//     current board with the same slot legality the cast pipeline used (src/game/target.js),
//     so cast-time and resolve-time legality always agree.
//   • enforceFizzle — before the top object resolves, trim its target list to the still-
//     legal subset. If EVERY target is now illegal the object "fizzles": the list is
//     emptied, the plugin's effect templates resolve nothing, and the object still moves
//     to the graveyard on resolution (an Alpha spell that loses all targets has no
//     effect). If only some are illegal, only the legal subset is affected (partial
//     legality). Auras whose enchant target left the battlefield likewise go to the
//     graveyard, matching the plugin's own aura resolution path.
//   • resolveTop / resolveAll — resolve with fizzle enforcement, returning the resolution
//     report (what resolved, what entered, triggers, countered spells) plus the fizzle
//     decision: `fizzled`, `chosenTargets` (as cast), `targets` (effective at
//     resolution) and `illegalTargets` (what was trimmed and why).
//
// Fizzle is a pre-resolution adjustment: enforceFizzle mutates the top stack entry's
// targets on the live game state, and the plugin's reducer deep-clones that state when
// the all-pass round resolves it, so the trimmed list is exactly what resolution sees.

import * as engine from "./engine.js";
import { stackEntries, stackIsEmpty, allPassRound } from "./stack.js";
import * as target from "./target.js";

// ── the declared targeting of the object about to resolve ─────────────────────────────
// Spells read card.targeting / the chosen mode's targeting (Alpha + fixture shape).
// Abilities read card.abilityTargeting (Alpha shape) or card.abilities[].targeting
// (fixture shape). null when the object takes no targets.
function targetingForResolving(game, entry) {
  if (!entry) return null;
  if (entry.kind === "ability") {
    const viaAlpha = target.abilityTargetingFor(game, entry.cardId, entry.abilityName);
    if (viaAlpha) return viaAlpha;
    const card = target.cardDefFor(game, entry.cardId);
    if (card && Array.isArray(card.abilities)) {
      for (const a of card.abilities) {
        if (a && a.name === entry.abilityName && a.targeting) return a.targeting;
      }
    }
    return null;
  }
  return target.cardTargeting(game, entry.objId, entry.mode);
}

// checkTargetsAtResolve(game, entry) -> { targeting, chosen, legal, illegal }. Re-checks
// each chosen target (as cast) against its slot's legality on the CURRENT board. illegal
// carries { target, reason, slot } for every target that is no longer legal.
export function checkTargetsAtResolve(game, entry) {
  const t = targetingForResolving(game, entry);
  if (!t) return { targeting: null, chosen: [], legal: [], illegal: [] };
  const chosen = Array.isArray(entry.targets) ? entry.targets.slice()
    : entry.target != null ? [entry.target] : [];
  const obj = entry.objId ? game.raw.objects[entry.objId] : null;
  const caster = obj ? obj.controller : entry.player;
  const src = target.sourceColorsFor(game, entry.cardId);
  const slots = target.targetingSlots(t);
  const legal = [];
  const illegal = [];
  for (let i = 0; i < chosen.length; i++) {
    const slot = slots[Math.min(i, slots.length - 1)];
    const v = target.slotTargetLegal(game, chosen[i], slot, caster, { sourceColors: src, x: entry.x });
    if (v.ok) legal.push(chosen[i]);
    else illegal.push({ target: chosen[i], reason: v.reason, slot: i });
  }
  return { targeting: t, chosen, legal, illegal };
}

// enforceFizzle(game) -> the fizzle decision for the top stack entry, mutating the
// entry's targets/target in place (see the header note on why this works). Never throws.
export function enforceFizzle(game) {
  const arr = game.raw && Array.isArray(game.raw.stack) ? game.raw.stack : [];
  if (arr.length === 0) return { fizzled: false, targeting: null, chosen: [], legal: [], illegal: [] };
  const entry = arr[arr.length - 1];
  const r = checkTargetsAtResolve(game, entry);
  if (!r.targeting || r.chosen.length === 0) {
    return { fizzled: false, targeting: r.targeting, chosen: r.chosen, legal: r.chosen, illegal: [] };
  }
  const fizzled = r.legal.length === 0;
  if (r.illegal.length > 0) {
    entry.targets = r.legal.slice();
    entry.target = r.legal.length ? r.legal[0] : null;
    entry.fizzled = fizzled;
  }
  return { fizzled, targeting: r.targeting, chosen: r.chosen, legal: r.legal, illegal: r.illegal };
}

// ── resolution report (moved here from stack.js with the fizzle fields) ───────────────
function cardEffectsForMode(card, mode) {
  if (!card) return null;
  if (mode && Array.isArray(card.modes)) {
    for (const m of card.modes) if (m.name === mode) return m.effects || [];
    return [];
  }
  return card.effects || [];
}

function hasCounterEffect(card, mode) {
  const fx = cardEffectsForMode(card, mode);
  return Array.isArray(fx) && fx.some((e) => e && e.op === "counter");
}

function captureBefore(game) {
  const raw = game.raw;
  const entries = stackEntries(game);
  const battlefieldSet = {};
  for (const id of raw.battlefield || []) battlefieldSet[id] = true;
  const stackIds = new Set();
  for (const e of entries) stackIds.add(e.objId);
  return { entries, top: entries.length ? entries[entries.length - 1] : null, battlefieldSet, stackIds };
}

function reportResolution(game, before) {
  const top = before.top;
  const raw = game.raw;
  const inst = top.objId ? engine.cardInstance(game, top.objId) : null;
  const obj = inst ? inst.obj : null;
  const card = inst ? inst.card : null;
  const zone = obj ? obj.zone : null;
  let outcome = "resolved";
  if (top.kind === "spell" && zone === "battlefield") outcome = "permanent-entered";
  if (top.kind === "trigger") outcome = "trigger-resolved";
  const entered = [];
  for (const id of raw.battlefield || []) {
    if (before.battlefieldSet[id]) continue;
    const o = raw.objects[id];
    if (!o) continue;
    const c = engine.cardInstance(game, id).card;
    entered.push({ sourceId: id, cardId: o.cardId, name: c && c.name ? c.name : o.cardId });
  }
  const triggersFired = [];
  for (const en of entered) {
    const c = engine.cardInstance(game, en.sourceId).card;
    if (!c || !Array.isArray(c.triggers)) continue;
    for (const t of c.triggers) {
      if (t.when !== "enter") continue;
      triggersFired.push({ when: t.when, sourceId: en.sourceId, cardId: en.cardId, name: en.name, effects: t.effects });
    }
  }
  const countered = [];
  if (card && hasCounterEffect(card, top.mode)) {
    for (const t of top.targets) {
      if (before.stackIds.has(t) && !(raw.stack || []).some((e) => e.objId === t)) countered.push(t);
    }
  }
  return {
    stackSizeWhenResolved: before.entries.length,
    index: top.index,
    depth: top.depth,
    kind: top.kind,
    objId: top.objId,
    cardId: top.cardId,
    name: top.name,
    controller: top.controller,
    targets: top.targets.slice(),
    mode: top.mode,
    x: top.x,
    abilityName: top.abilityName,
    triggerWhen: top.kind === "trigger" ? top.when : null,
    triggerEffects: top.kind === "trigger" ? (top.effects || []) : null,
    outcome,
    entered,
    triggersFired,
    countered,
  };
}

// resolveTop(game) -> resolve exactly the topmost object with fizzle enforcement (one
// all-pass round). Returns the resolution report (with the fizzle fields), or null if
// the stack was empty. Never advances the step.
export function resolveTop(game) {
  if (stackIsEmpty(game)) return null;
  const before = captureBefore(game);
  const fz = enforceFizzle(game);
  const round = allPassRound(game);
  if (!round.resolved) return null;
  const report = reportResolution(game, before);
  report.fizzled = fz.fizzled;
  report.chosenTargets = fz.chosen.slice();
  report.illegalTargets = fz.illegal.slice();
  report.targets = fz.targeting ? fz.legal.slice() : fz.chosen.slice();
  return report;
}

// resolveAll(game) -> resolve the whole stack in LIFO order (each resolution firing its
// triggers between resolutions), then perform the final empty-stack all-pass that
// advances the step. Returns { resolutions, stepAdvanced, step, turnNumber, gameOver,
// winner }.
export function resolveAll(game) {
  const resolutions = [];
  let stepAdvanced = false;
  let guard = 0;
  while (!game.raw.gameOver && guard < 1000) {
    guard++;
    const r = resolveTop(game);
    if (r) {
      resolutions.push(r);
      continue;
    }
    const round = allPassRound(game);
    stepAdvanced = round.stepAdvanced;
    break;
  }
  return {
    resolutions,
    stepAdvanced,
    step: game.raw.step,
    turnNumber: game.raw.turnNumber,
    gameOver: !!game.raw.gameOver,
    winner: game.raw.gameOver ? game.raw.winner : null,
  };
}
