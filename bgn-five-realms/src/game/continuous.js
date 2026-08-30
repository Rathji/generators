// Five Realms — continuous / static effects runtime (roadmap Phase 7, task 24).
// The five-realms-plugin models continuous effects only as exact-target layer-7 entries
// in state.effects (frEffectAdd → frEffectsFor matches by targetId), created when pumps /
// auras resolve. It has NO way to express a *global* static effect — Crusade's "White
// creatures get +1/+1", Lord of Atlantis's "Other Merfolk get +1/+1 and have islandwalk",
// Castle's conditional pump — or a rule-modifying one (Mana Flare). This module implements
// those from the card.continuous declarations in src/cards/continuous.js:
//
//   • syncContinuousEffects(game) — the core. On every relevant state change it clears the
//     previously-synced global entries (marked global:true) from state.effects and
//     re-adds fresh per-target layer-7 entries for every permanent currently matching an
//     active "powerToughness" declaration. Because the entries live in state.effects with
//     the plugin's own shape, the plugin's frPower/frToughness — combat damage, blocker
//     legality, the SBA loop — automatically see the buffs, and so do the local queries
//     (derivedPower/derivedToughness mirror that same formula). The sync also rebuilds
//     game._keywordOverlay, the granted-keyword grants from the same declarations.
//   • derivedPower / derivedToughness — the local query mirroring the plugin's frPower /
//     frToughness (base + +1/+1 counters + buffsUntilEot + layer-7 effects), so local
//     rules (target filters, the trigger applier's SBA) read the same numbers the engine
//     does.
//   • grantedKeywords — a card's base keywords plus any granted by active continuous
//     effects. Consumed by the local SBA's indestructible check (triggers.js) and by any
//     query/UI layer. The plugin's own keyword reads (flying/reach blocking legality,
//     hexproof/ward targeting) cannot see grants — a documented plugin gap (combat tasks
//     27-30 will need a local blocking-legality overlay to close it).
//   • Mana Flare ("mana" layer) — bonusForLandTap adds +1 of the produced colour to the
//     tapping player's pool whenever a land is tapped for mana while a flare is on the
//     battlefield, hooked into turn.doAction (the plugin's activateAbility path) and
//     mana.activateManaAbility (the local dual-land path). Matches Alpha wording: the
//     bonus applies to any player's land taps, regardless of who controls the flare.
//
// turn.doAction calls sync before the reducer (so the plugin's combat/SBA math sees the
// current board) and again after it (so trigger-time SBA sees the post-action board), then
// the flare hook before mana.observe (so the produced-mana tracker counts the bonus).
// Documented simplification: a permanent that enters and must rely on a global pump to
// survive lethal SBA *within the same resolution* is not saved (its entry happens inside
// the plugin reducer, after the pre-action sync) — no Alpha creature has base toughness 0,
// so this never arises with real cards.

import * as engine from "./engine.js";
import { PLUGIN_CARD_MAP } from "../cards/plugin.js";

function cardDefFor(game, objId) {
  const inst = engine.cardInstance(game, objId);
  if (inst && inst.card) return inst.card;
  const obj = game.raw.objects[objId];
  if (obj && PLUGIN_CARD_MAP[obj.cardId]) return PLUGIN_CARD_MAP[obj.cardId];
  return null;
}

// ── tracker / log ─────────────────────────────────────────────────────────────────────
export function initContinuous(game) {
  if (!Array.isArray(game._contLog)) game._contLog = [];
  if (!game._keywordOverlay) game._keywordOverlay = {};
  return game;
}

export function continuousLog(game) {
  return Array.isArray(game._contLog) ? game._contLog.slice() : [];
}

function logContinuous(game, entry) {
  initContinuous(game);
  game._contLog.push(Object.assign({ at: Date.now() }, entry));
}

// ── matching ───────────────────────────────────────────────────────────────────────────
// A declaration's filter reads the TARGET's own card definition; controller/exclude/
// condition constrain the TARGET relative to the SOURCE permanent.
function matchesFilter(game, sourceObj, targetObj, decl) {
  const targetCard = cardDefFor(game, targetObj.id);
  if (!targetCard) return false;
  const f = decl.filter || {};
  if (Array.isArray(f.types)) {
    for (const t of f.types) if (!targetCard.types.includes(t)) return false;
  }
  if (Array.isArray(f.subtypes)) {
    for (const s of f.subtypes) if (!(targetCard.subtypes || []).includes(s)) return false;
  }
  if (Array.isArray(f.colors)) {
    for (const c of f.colors) if (!(targetCard.colors || []).includes(c)) return false;
  }
  if (decl.controller === "self" && targetObj.controller !== sourceObj.controller) return false;
  if (decl.exclude === "self" && targetObj.id === sourceObj.id) return false;
  if (typeof decl.condition === "function" && !decl.condition(targetObj, targetCard)) return false;
  return true;
}

// ── the sync ───────────────────────────────────────────────────────────────────────────
// Clear every previously-synced global entry, then re-scan the board: for each battlefield
// permanent carrying a "powerToughness" declaration, push a fresh per-target layer-7 entry
// (plugin frEffectAdd shape + global:true marker) for each matching creature, and record
// any granted keywords on the overlay. Idempotent; safe to run on any game wrapper.
export function syncContinuousEffects(game) {
  const raw = game.raw;
  if (!raw || !Array.isArray(raw.effects) || !Array.isArray(raw.battlefield)) return game;
  initContinuous(game);
  for (let i = raw.effects.length - 1; i >= 0; i--) {
    if (raw.effects[i] && raw.effects[i].global) raw.effects.splice(i, 1);
  }
  game._keywordOverlay = {};
  for (const sid of raw.battlefield) {
    const source = raw.objects[sid];
    if (!source || source.zone !== "battlefield") continue;
    const scard = cardDefFor(game, sid);
    if (!scard || !Array.isArray(scard.continuous)) continue;
    for (const decl of scard.continuous) {
      if (!decl || decl.layer !== "powerToughness") continue;
      let appliedAny = false;
      for (const tid of raw.battlefield) {
        const target = raw.objects[tid];
        if (!target || target.zone !== "battlefield") continue;
        const tcard = cardDefFor(game, tid);
        if (!tcard || !tcard.types.includes("Creature")) continue;
        if (!matchesFilter(game, source, target, decl)) continue;
        if (decl.power || decl.toughness) {
          raw.effects.push({
            id: "fx" + raw.nextEffectStamp,
            timestamp: raw.nextEffectStamp,
            sourceId: sid,
            targetId: tid,
            layer: 7,
            power: decl.power || 0,
            toughness: decl.toughness || 0,
            untilEot: false,
            global: true,
          });
          raw.nextEffectStamp += 1;
        }
        if (Array.isArray(decl.keywords) && decl.keywords.length) {
          if (!game._keywordOverlay[tid]) game._keywordOverlay[tid] = [];
          for (const kw of decl.keywords) {
            if (game._keywordOverlay[tid].indexOf(kw) === -1) game._keywordOverlay[tid].push(kw);
          }
        }
        appliedAny = true;
      }
      if (appliedAny) {
        logContinuous(game, {
          action: "sync",
          source: sid,
          sourceName: scard.name,
          layer: "powerToughness",
          power: decl.power || 0,
          toughness: decl.toughness || 0,
          keywords: decl.keywords || [],
        });
      }
    }
  }
  return game;
}

// ── local P/T queries (mirror the plugin's frPower/frToughness) ────────────────────────
function effectSum(raw, objId, key) {
  let sum = 0;
  for (const e of raw.effects) {
    if (e.targetId === objId && typeof e[key] === "number") sum += e[key];
  }
  return sum;
}

export function derivedPower(game, objId) {
  const raw = game.raw;
  const obj = raw.objects[objId];
  if (!obj) return 0;
  const card = cardDefFor(game, objId);
  const base = card && typeof card.power === "number" ? card.power : 0;
  return base + (obj.counters.p1p1 || 0) + ((obj.buffsUntilEot && obj.buffsUntilEot.power) || 0) + effectSum(raw, objId, "power");
}

export function derivedToughness(game, objId) {
  const raw = game.raw;
  const obj = raw.objects[objId];
  if (!obj) return 0;
  const card = cardDefFor(game, objId);
  const base = card && typeof card.toughness === "number" ? card.toughness : 0;
  return base + (obj.counters.p1p1 || 0) + ((obj.buffsUntilEot && obj.buffsUntilEot.toughness) || 0) + effectSum(raw, objId, "toughness");
}

// ── granted keywords ───────────────────────────────────────────────────────────────────
export function grantedKeywords(game, objId) {
  const card = cardDefFor(game, objId);
  const base = card && Array.isArray(card.keywords) ? card.keywords : [];
  const extra = game._keywordOverlay && game._keywordOverlay[objId] ? game._keywordOverlay[objId] : [];
  const out = base.slice();
  for (const kw of extra) if (out.indexOf(kw) === -1) out.push(kw);
  return out;
}

// ── Mana Flare ("mana" layer) ──────────────────────────────────────────────────────────
function manaSourcesFor(game, objId) {
  const raw = game.raw;
  const out = [];
  const target = raw.objects[objId];
  if (!target) return out;
  for (const id of raw.battlefield) {
    const obj = raw.objects[id];
    if (!obj || obj.zone !== "battlefield") continue;
    const card = cardDefFor(game, id);
    if (!card || !Array.isArray(card.continuous)) continue;
    for (const decl of card.continuous) {
      if (decl && decl.layer === "mana" && matchesFilter(game, obj, target, decl)) {
        out.push({ source: obj.id, sourceName: card.name });
      }
    }
  }
  return out;
}

// bonusForLandTap(game, player, objId, color) -> add +1 mana of `color` to the tapping
// player's pool for every active "mana"-layer source whose filter matches the tapped
// permanent. Returns the number of bonuses applied (0 when no flare is active).
export function bonusForLandTap(game, player, objId, color) {
  if (typeof color !== "string" || color.length !== 1) return 0;
  const flares = manaSourcesFor(game, objId);
  if (flares.length === 0) return 0;
  initContinuous(game);
  for (const f of flares) {
    game.raw.players[player].manaPool[color] += 1;
    logContinuous(game, { action: "manaBonus", source: f.source, sourceName: f.sourceName, player, color });
  }
  return flares.length;
}

// observeManaFlare(game, action) -> the turn.doAction hook for the plugin's land-tap
// path: an activateAbility action with no abilityName (the plugin's mana-ability route)
// tapping a permanent whose card produces mana. Applies the flare bonus for the produced
// colour (single-colour source, or the action's chosenColor for a multi-colour one).
export function observeManaFlare(game, action) {
  if (!action || action.type !== "activateAbility" || action.abilityName) return game;
  const raw = game.raw;
  const objId = action.objectId;
  const obj = objId != null ? raw.objects[objId] : null;
  if (!obj) return game;
  const card = cardDefFor(game, objId);
  if (!card || typeof card.producesMana !== "string" || card.producesMana === "") return game;
  let color = null;
  if (card.producesMana.length === 1) color = card.producesMana;
  else if (typeof action.chosenColor === "string") color = action.chosenColor;
  if (!color) return game;
  bonusForLandTap(game, action.player, objId, color);
  return game;
}

// postAction(game, action) -> called by turn.doAction after the reducer runs (and after
// the pre-action sync). Applies any Mana Flare bonus for this action's land tap, then
// re-syncs the global pump entries so trigger-time SBA and everything after sees the
// post-action board.
export function postAction(game, action) {
  observeManaFlare(game, action);
  return syncContinuousEffects(game);
}

// effectSummary(game) -> a readable view of every active continuous effect and the
// permanents it currently applies to (ids in `applied`), for tests and the UI.
export function effectSummary(game) {
  const raw = game.raw;
  const out = [];
  if (!raw || !Array.isArray(raw.battlefield)) return out;
  for (const sid of raw.battlefield) {
    const source = raw.objects[sid];
    if (!source || source.zone !== "battlefield") continue;
    const scard = cardDefFor(game, sid);
    if (!scard || !Array.isArray(scard.continuous)) continue;
    for (const decl of scard.continuous) {
      if (!decl) continue;
      if (decl.layer === "powerToughness") {
        const applied = [];
        for (const tid of raw.battlefield) {
          const target = raw.objects[tid];
          if (!target) continue;
          const tcard = cardDefFor(game, tid);
          if (tcard && tcard.types.includes("Creature") && matchesFilter(game, source, target, decl)) applied.push(tid);
        }
        out.push({
          source: sid,
          sourceName: scard.name,
          layer: "powerToughness",
          power: decl.power || 0,
          toughness: decl.toughness || 0,
          keywords: decl.keywords || [],
          applied,
        });
      } else if (decl.layer === "mana") {
        out.push({ source: sid, sourceName: scard.name, layer: "mana", appliesToLands: true });
      }
    }
  }
  return out;
}
