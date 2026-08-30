// Five Realms — regeneration (roadmap Phase 8, task 25).
// The five-realms-plugin has no regeneration template: its frApplyOneEffect template
// library (damage / damageAll / life / draw / discard / destroy / pump / tap / untap /
// shield / scry / addMana / token / counter / tutor) has no "regenerate" op, so a
// Drudge Skeletons-style "Regenerate this creature" ability would resolve to nothing.
// This module implements the 1993 Alpha regeneration rule locally:
//
//   • grantShield — an activated regeneration effect creates one shield on the creature
//     (stacked: two activations = two shields). Declared on card.abilities as
//     { op: "regenerate", targets: ["self"] } (src/cards/abilities.js).
//   • saveCreature — when the creature would be destroyed (lethal damage or a destroy
//     effect), a shield replaces that destruction: the creature is TAPPED, removed from
//     combat, and all damage is removed from it — it stays on the battlefield with its
//     auras attached, and the shield is consumed. (The 1993 rulebook: "a regenerating
//     creature is tapped, removed from combat, and all damage is removed from it".)
//   • reconcileDeaths — the plugin destroys a shielded creature before this module can
//     intervene (its SBA loop runs inside the reducer). turn.doAction captures the
//     battlefield before each action, then this module resurrects every creature that
//     died battlefield→graveyard this action while holding a shield (restoring its
//     attachments and their buffs), so downstream observers (death triggers, global
//     pumps) see it never died. Sacrifice and toughness<=0 are NOT preventable (no
//     sacrifice framework exists yet; toughness<=0 is not a destruction event) and a
//     bounce to hand/exile leaves the battlefield set untouched, so neither is wrongly
//     resurrected.
//   • grantFromResolved — shields are granted when the regeneration ability RESOLVES,
//     not when it activates (so destroying the creature while the ability is on the
//     stack still works). turn.doAction detects the top stack entry being a
//     regeneration ability and, once an action resolves it (stack shrank), grants the
//     shield. This covers both resolution paths — the plugin's native all-pass resolve
//     and resolve.js's resolveTop/resolveAll (which route through turn.pass).
//   • endTurnShields — regeneration effects last "until end of turn": when the active
//     player changes (the turn ended), all shields are dropped.
//
// Only the wrapper state (game._regenerating) is local; it survives the plugin's
// deep-clone reducer and is carried by engine.snapshot/restore like _keywordOverlay.

import * as engine from "./engine.js";
import * as target from "./target.js";

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// ── tracker / log ─────────────────────────────────────────────────────────────────────
export function initRegeneration(game) {
  if (!game._regenerating) game._regenerating = {};
  if (!Array.isArray(game._regenLog)) game._regenLog = [];
  return game;
}

export function regenerationLog(game) {
  return Array.isArray(game._regenLog) ? game._regenLog.slice() : [];
}

function logRegen(game, entry) {
  initRegeneration(game);
  game._regenLog.push(Object.assign({ at: Date.now() }, entry));
}

function nameOf(game, objId) {
  const inst = objId != null ? engine.cardInstance(game, objId) : null;
  return inst && inst.card && inst.card.name ? inst.card.name : String(objId);
}

// ── shields ────────────────────────────────────────────────────────────────────────────
// shields(game, objId) -> how many regeneration shields the creature currently holds.
export function shields(game, objId) {
  return (game._regenerating && game._regenerating[objId]) || 0;
}

// grantShield(game, objId, sourceId) -> put one regeneration shield on a battlefield
// creature (no-op if the target isn't on the battlefield).
export function grantShield(game, objId, sourceId) {
  if (!objId) return;
  const obj = game.raw.objects[objId];
  if (!obj || obj.zone !== "battlefield") return;
  initRegeneration(game);
  game._regenerating[objId] = (game._regenerating[objId] || 0) + 1;
  logRegen(game, { action: "shield", id: objId, source: sourceId || null, name: nameOf(game, objId) });
}

function consumeShield(game, objId) {
  initRegeneration(game);
  const c = game._regenerating[objId] || 0;
  if (c > 1) game._regenerating[objId] = c - 1;
  else delete game._regenerating[objId];
  logRegen(game, { action: "saved", id: objId, name: nameOf(game, objId) });
}

// saveCreature(game, objId) -> the in-place save used by the LOCAL trigger path
// (triggers.js): the creature is about to be destroyed by localDamage/localSba or a
// local destroy effect — consume a shield, tap it, remove it from combat, clear damage.
// Auras stay attached (it never left the battlefield). Returns true when a shield was
// consumed.
export function saveCreature(game, objId) {
  if (shields(game, objId) <= 0) return false;
  const obj = game.raw.objects[objId];
  if (!obj || obj.zone !== "battlefield") return false;
  consumeShield(game, objId);
  obj.damage = 0;
  obj.deathtouchLethal = false;
  obj.attacking = false;
  obj.blocking = null;
  obj.tapped = true;
  return true;
}

// endTurnShields(game, prevActive) -> regeneration effects last until end of turn: when
// the active player changed this action, every shield expires. Called by turn.doAction
// before reconcileDeaths so a cleanup-time death is never wrongly saved.
export function endTurnShields(game, prevActive) {
  if (prevActive !== undefined && game.raw.activePlayer !== prevActive) {
    initRegeneration(game);
    game._regenerating = {};
  }
}

// ── resolution grant ───────────────────────────────────────────────────────────────────
// stackTopRegeneration(game) -> the top stack entry when it is an activated ability whose
// declared effects include a "regenerate" op, else null.
export function stackTopRegeneration(game) {
  const arr = game.raw.stack;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const e = arr[arr.length - 1];
  if (!e || e.kind !== "ability") return null;
  const card = target.cardDefFor(game, e.cardId);
  if (!card || !Array.isArray(card.abilities)) return null;
  for (const a of card.abilities) {
    if (!a || a.name !== e.abilityName || !Array.isArray(a.effects)) continue;
    for (const fx of a.effects) {
      if (fx && fx.op === "regenerate") return e;
    }
  }
  return null;
}

// grantFromResolved(game, entry) -> after the regeneration entry resolved, grant a shield
// to each effect target still on the battlefield. Target refs: "self" is the source
// permanent, a number indexes the entry's chosen targets ("controller" is a player, which
// a regenerate effect never targets — skipped).
export function grantFromResolved(game, entry) {
  if (!entry) return;
  const card = target.cardDefFor(game, entry.cardId);
  if (!card || !Array.isArray(card.abilities)) return;
  let ability = null;
  for (const a of card.abilities) {
    if (a && a.name === entry.abilityName) { ability = a; break; }
  }
  if (!ability || !Array.isArray(ability.effects)) return;
  for (const fx of ability.effects) {
    if (!fx || fx.op !== "regenerate") continue;
    const refs = Array.isArray(fx.targets) ? fx.targets : [];
    for (const ref of refs) {
      let targetId = null;
      if (ref === "self") targetId = entry.objId;
      else if (typeof ref === "number" && Array.isArray(entry.targets)) targetId = entry.targets[ref];
      if (targetId == null) continue;
      grantShield(game, targetId, entry.objId);
    }
  }
}

// ── death reconciliation (the plugin already destroyed it — resurrect if shielded) ─────
// captureBattlefield(game) -> snapshot of battlefield order + each permanent's attachment
// list, taken by turn.doAction before the reducer runs (the baseline for what "died this
// action" means).
export function captureBattlefield(game) {
  const raw = game.raw;
  const bf = Array.isArray(raw.battlefield) ? raw.battlefield.slice() : [];
  const byId = {};
  for (let i = 0; i < bf.length; i++) {
    const o = raw.objects[bf[i]];
    byId[bf[i]] = {
      bfIndex: i,
      attachments: o && Array.isArray(o.attachments) ? o.attachments.slice() : [],
    };
  }
  return { bf, byId };
}

function moveBackToBattlefield(game, id, owner, bfIndex) {
  const raw = game.raw;
  const pl = raw.players[owner];
  if (!pl) return;
  const gyIdx = pl.graveyard.indexOf(id);
  if (gyIdx !== -1) pl.graveyard.splice(gyIdx, 1);
  const at = raw.battlefield.indexOf(id);
  if (at === -1) {
    const idx = bfIndex == null ? raw.battlefield.length : Math.min(bfIndex, raw.battlefield.length);
    raw.battlefield.splice(idx, 0, id);
  }
  raw.objects[id].zone = "battlefield";
}

// restoreAttachment(game, auraId, enchId) -> move a dead aura back to the battlefield,
// re-attach it, and re-add its layer-7 buff (the plugin's frDeathDestroy removed the
// aura's effect entries when it died).
function restoreAttachment(game, auraId, enchId) {
  const raw = game.raw;
  const ao = raw.objects[auraId];
  if (!ao || ao.zone !== "graveyard") return;
  moveBackToBattlefield(game, auraId, ao.owner, null);
  ao.attachedTo = enchId;
  const ench = raw.objects[enchId];
  if (ench && Array.isArray(ench.attachments) && ench.attachments.indexOf(auraId) === -1) {
    ench.attachments.push(auraId);
  }
  const acard = engine.cardInstance(game, auraId).card;
  if (acard && acard.auraBuff) {
    raw.effects.push({
      id: "fx" + raw.nextEffectStamp,
      timestamp: raw.nextEffectStamp,
      sourceId: auraId,
      targetId: enchId,
      layer: 7,
      power: acard.auraBuff.power || 0,
      toughness: acard.auraBuff.toughness || 0,
      untilEot: false,
    });
    raw.nextEffectStamp += 1;
  }
}

// reconcileDeaths(game, before) -> for every permanent that was on the battlefield before
// the action and is now in the graveyard, resurrect it (consuming a shield) if it still
// holds one. Returns the resurrected ids. Called by turn.doAction after the reducer, so
// nothing downstream (death triggers, global-pump resync) ever sees the regenerated
// creature die.
export function reconcileDeaths(game, before) {
  const raw = game.raw;
  const saved = [];
  if (!before || !Array.isArray(before.bf)) return saved;
  for (const id of before.bf) {
    const obj = raw.objects[id];
    if (!obj || obj.zone !== "graveyard") continue;
    if (shields(game, id) <= 0) continue;
    const cap = before.byId[id] || { bfIndex: null, attachments: [] };
    for (const a of cap.attachments) {
      const ao = raw.objects[a];
      if (ao && ao.zone === "graveyard") restoreAttachment(game, a, id);
    }
    moveBackToBattlefield(game, id, obj.owner, cap.bfIndex);
    raw.objects[id].tapped = true;
    consumeShield(game, id);
    saved.push(id);
  }
  return saved;
}
