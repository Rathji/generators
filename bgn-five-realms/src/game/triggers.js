// Five Realms — triggered abilities runtime (roadmap Phase 7, task 23).
// The five-realms-plugin fires three trigger conditions natively — "enter"
// (frTriggersOnEnter), "attack" (frTriggersOnDeclareAttack) and
// "combatDamageToPlayer" — resolving them immediately at the event (the classic Alpha
// default). It fires NO others: upkeep triggers, death triggers and draw triggers are
// invisible to the engine. This module is the local trigger system that fires the
// remaining conditions by watching the game for events and reading the same
// card.triggers data model (see src/cards/triggers.js for the Alpha declarations):
//   • upkeep     — when the step transitions into the active player's upkeep, fire every
//                  "upkeep" trigger on the battlefield (firesFor "controller" = the
//                  permanent's controller is active; firesFor "each" = any upkeep).
//   • death      — when a permanent leaves the battlefield to the graveyard, fire its own
//                  "death" triggers and the battlefield watchers' "creatureDies" /
//                  "landDies" triggers (filtered by the dying card's colors/types).
//   • draw       — when a player's hand grows, fire "draw" triggers (player "opponent"
//                  = only an opponent's draws; "controller" = own draws; "each" = any).
// A configurable rule toggle decides how a fired trigger resolves: game._rules.
// triggersImmediate (default true — classic Alpha resolves triggers immediately at the
// event) routes triggers straight through the local effect applier; when false, the
// trigger is queued onto the plugin's stack in timestamp order and resolves on an
// all-pass round exactly like a spell (see turn.doAction's pass interception and
// resolveTriggerTop below). The plugin-native conditions are not rerouted by the toggle
// — they resolve immediately in the engine regardless, matching the Alpha-era default.
//
// The local effect applier (applyEffects) mirrors the plugin's frApplyOneEffect
// template library for the ops triggers use — draw/discard/life/damage/destroy/
// sacrifice/pump/counter/tap/untap/addMana/scry/shield/token — including the SBA loop
// (lethal-damage death), and reports which objects died so death triggers can cascade.
// Documented simplifications: draws are observed as net hand-size growth (a draw that
// nets to zero with an accompanying discard in the same action is missed); aura-legality
// SBA is left to the plugin's own loop on the next pass; trigger targeting is automatic
// (Alpha triggers that require a choice at trigger time — pay-or-sacrifice upkeeps,
// Black Vise's "choose an opponent" — are not modelled yet; see src/cards/triggers.js).

import * as engine from "./engine.js";
import * as continuous from "./continuous.js";
import * as regenerate from "./regenerate.js";

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// ── tracker / log ─────────────────────────────────────────────────────────────────────
export function initTriggerTracker(game) {
  if (!Array.isArray(game._triggerLog)) game._triggerLog = [];
  return game;
}

export function triggerLog(game) {
  return Array.isArray(game._triggerLog) ? game._triggerLog.slice() : [];
}

// Immediate resolution is the default (classic Alpha); the stack toggle switches it off.
export function triggersImmediate(game) {
  return !(game._rules && game._rules.triggersImmediate === false);
}

function logTrigger(game, entry) {
  initTriggerTracker(game);
  game._triggerLog.push(Object.assign({ at: Date.now() }, entry));
}

// ── event capture (pre-action snapshot for doAction) ─────────────────────────────────
export function captureEvents(game) {
  const raw = game.raw;
  const hands = [];
  for (const pl of raw.players) hands.push(pl.hand.length);
  return {
    step: raw.step,
    hands,
    battlefield: Array.isArray(raw.battlefield) ? raw.battlefield.slice() : [],
  };
}

// ── effect-application core (mirrors the plugin's template library) ──────────────────
function effectAmount(value, x) {
  if (value === "X") return typeof x === "number" ? x : 0;
  return typeof value === "number" ? value : 0;
}

function cardFor(game, objId) {
  const inst = objId != null ? engine.cardInstance(game, objId) : null;
  return inst && inst.card ? inst.card : null;
}

// Resolve a trigger's effect target refs: a number indexes the entry's chosen target-set
// (none here — triggers are automatic), "self" is the source permanent, "controller" /
// "opponent" / "owner" / "activePlayer" / "drawingPlayer" / "diedController" are the
// event facts captured on the trigger's context.
function resolveTargets(ctx, refs) {
  const out = [];
  const list = Array.isArray(refs) ? refs : (refs === undefined ? [] : [refs]);
  for (const r of list) {
    if (typeof r === "number") {
      if (ctx.targets && ctx.targets[r] !== undefined) out.push(ctx.targets[r]);
    } else if (r === "self") {
      if (ctx.self != null) out.push(ctx.self);
    } else if (r === "controller") out.push(ctx.controller);
    else if (r === "opponent") out.push(ctx.opponent);
    else if (r === "owner") out.push(ctx.owner);
    else if (r === "activePlayer") out.push(ctx.activePlayer);
    else if (r === "drawingPlayer") out.push(ctx.drawingPlayer);
    else if (r === "diedController") out.push(ctx.diedController);
  }
  return out;
}

// localToughness / hasKeyword fold the continuous-effects layer (global pumps + granted
// keywords) in alongside the plugin's own exact-target effects, so trigger-time SBA
// (lethal damage, toughness <= 0) and indestructible checks see the same numbers the
// engine does.
function localToughness(game, obj) {
  return continuous.derivedToughness(game, obj.id);
}

// Move a battlefield object (and everything attached to it) to the graveyard and reset
// its combat bookkeeping — mirror of the plugin's frDeathDestroy.
function hasKeyword(game, objId, kw) {
  return continuous.grantedKeywords(game, objId).includes(kw);
}

function localDeathDestroy(game, id) {
  const raw = game.raw;
  const obj = raw.objects[id];
  if (!obj || obj.zone !== "battlefield") return;
  while (obj.attachments.length > 0) {
    const a = obj.attachments.pop();
    const ao = raw.objects[a];
    if (ao) {
      for (let i = raw.effects.length - 1; i >= 0; i--) {
        if (raw.effects[i].sourceId === a) raw.effects.splice(i, 1);
      }
      ao.zone = "graveyard";
      raw.players[ao.owner].graveyard.push(a);
      const bfIdx = raw.battlefield.indexOf(a);
      if (bfIdx !== -1) raw.battlefield.splice(bfIdx, 1);
    }
  }
  for (let i = raw.effects.length - 1; i >= 0; i--) {
    if (raw.effects[i].sourceId === id) raw.effects.splice(i, 1);
  }
  obj.zone = "graveyard";
  obj.damage = 0;
  obj.deathtouchLethal = false;
  obj.attacking = false;
  obj.blocking = null;
  obj.buffsUntilEot = { power: 0, toughness: 0 };
  raw.players[obj.owner].graveyard.push(id);
  const bfIdx = raw.battlefield.indexOf(id);
  if (bfIdx !== -1) raw.battlefield.splice(bfIdx, 1);
}

// The SBA sweep used after trigger damage/destroy effects: lethal damage and toughness<=0
// send creatures to the graveyard, a player at 0 or less life loses. Returns the ids of
// every creature sent to the graveyard this pass (so death triggers can cascade).
function localSba(game) {
  const raw = game.raw;
  const died = [];
  let changed = true;
  let guard = 0;
  while (changed && guard < 100) {
    changed = false;
    for (let i = raw.battlefield.length - 1; i >= 0; i--) {
      const id = raw.battlefield[i];
      const obj = raw.objects[id];
      if (!obj || obj.zone !== "battlefield") continue;
      const card = cardFor(game, id);
      if (!card || !card.types.includes("Creature")) continue;
      const toughness = localToughness(game, obj);
      if (toughness <= 0) {
        // Regeneration does NOT save a creature from toughness <= 0 (not a destruction
        // event) — only lethal damage and destroy effects below.
        localDeathDestroy(game, id);
        died.push(id);
        changed = true;
        continue;
      }
      if (!hasKeyword(game, id, "indestructible") && (obj.damage >= toughness || (obj.deathtouchLethal && obj.damage > 0))) {
        if (regenerate.shields(game, id) > 0) {
          regenerate.saveCreature(game, id);
        } else {
          localDeathDestroy(game, id);
          died.push(id);
        }
        changed = true;
      }
    }
    for (let p = 0; p < raw.players.length; p++) {
      if (raw.players[p].life <= 0 && !raw.players[p].lost) {
        raw.players[p].lost = true;
        raw.gameOver = true;
        raw.winner = (p + 1) % raw.players.length;
        changed = true;
      }
    }
    guard++;
  }
  return died;
}

// Draw one card (top of library to hand) with the plugin's deck-out loss semantics.
function localDrawOne(game, player) {
  const raw = game.raw;
  const pl = raw.players[player];
  if (pl.library.length === 0) {
    pl.lost = true;
    raw.gameOver = true;
    raw.winner = (player + 1) % raw.players.length;
    return false;
  }
  const objId = pl.library.shift();
  pl.hand.push(objId);
  raw.objects[objId].zone = "hand";
  return true;
}

function applyShields(game, target, amount) {
  const raw = game.raw;
  let remaining = amount;
  for (let i = raw.effects.length - 1; i >= 0 && remaining > 0; i--) {
    const e = raw.effects[i];
    if (!e || e.type !== "shield") continue;
    let hits = false;
    for (const t of e.targets || []) {
      if (t === target) { hits = true; break; }
    }
    if (!hits) continue;
    const used = Math.min(remaining, e.amount);
    e.amount -= used;
    remaining -= used;
    if (e.amount <= 0) raw.effects.splice(i, 1);
  }
  return remaining;
}

function applyDamage(game, target, amount, sourceId) {
  const raw = game.raw;
  if (amount <= 0) return [];
  const remaining = applyShields(game, target, amount);
  if (remaining <= 0) return [];
  if (typeof target === "number") {
    if (raw.players[target]) raw.players[target].life -= remaining;
    return localSba(game);
  }
  const t = raw.objects[target];
  if (t && t.zone === "battlefield" && !hasKeyword(game, target, "indestructible")) {
    t.damage += remaining;
  }
  return localSba(game);
}

function effectAdd(game, sourceId, targetId, opts) {
  const raw = game.raw;
  const eff = {
    id: "fx" + raw.nextEffectStamp,
    timestamp: raw.nextEffectStamp,
    sourceId,
    targetId,
    layer: opts.layer,
    power: opts.power || 0,
    toughness: opts.toughness || 0,
    untilEot: !!opts.untilEot,
  };
  raw.nextEffectStamp += 1;
  raw.effects.push(eff);
}

function applyOneEffect(game, eff, ctx) {
  const raw = game.raw;
  const amount = effectAmount(eff.amount, ctx.x);
  const died = [];
  const op = eff.op;
  if (op === "damage") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      for (const d of applyDamage(game, t, amount, ctx.sourceId)) if (died.indexOf(d) === -1) died.push(d);
    }
  } else if (op === "damageAll") {
    const scope = eff.scope || {};
    if (scope.creatures) {
      for (const id of raw.battlefield.slice()) {
        const o = raw.objects[id];
        if (!o) continue;
        const card = cardFor(game, id);
        if (card && card.types.includes("Creature")) {
          for (const d of applyDamage(game, id, amount, ctx.sourceId)) if (died.indexOf(d) === -1) died.push(d);
        }
      }
    }
    if (scope.players) {
      for (let p = 0; p < raw.players.length; p++) {
        applyDamage(game, p, amount, ctx.sourceId);
      }
    }
  } else if (op === "life") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      const pl = raw.players[t];
      if (pl) {
        if (eff.gain) pl.life += amount;
        else pl.life -= amount;
      }
    }
    for (const d of localSba(game)) if (died.indexOf(d) === -1) died.push(d);
  } else if (op === "draw") {
    let player = eff.player === "controller" ? ctx.controller : eff.player;
    if (typeof player === "number" && raw.players[player]) {
      for (let i = 0; i < amount; i++) localDrawOne(game, player);
    }
  } else if (op === "discard") {
    const list = eff.player !== undefined ? resolveTargets(ctx, [eff.player]) : resolveTargets(ctx, eff.targets);
    for (const t of list) {
      const pl = raw.players[t];
      if (!pl) continue;
      for (let d = 0; d < amount; d++) {
        if (pl.hand.length === 0) break;
        const c = pl.hand.pop();
        raw.objects[c].zone = "graveyard";
        pl.graveyard.push(c);
      }
    }
  } else if (op === "destroy") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      const o = raw.objects[t];
      if (o && o.zone === "battlefield" && !hasKeyword(game, t, "indestructible")) {
        if (regenerate.shields(game, t) > 0) {
          regenerate.saveCreature(game, t);
        } else {
          localDeathDestroy(game, t);
          died.push(t);
        }
      }
    }
  } else if (op === "sacrifice") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      const o = raw.objects[t];
      if (o && o.zone === "battlefield") {
        localDeathDestroy(game, t);
        died.push(t);
      }
    }
  } else if (op === "pump") {
    const power = effectAmount(eff.power, ctx.x);
    const toughness = effectAmount(eff.toughness !== undefined ? eff.toughness : eff.power, ctx.x);
    for (const t of resolveTargets(ctx, eff.targets)) {
      const o = raw.objects[t];
      if (!o || o.zone !== "battlefield") continue;
      if (eff.counters) {
        o.counters.p1p1 = (o.counters.p1p1 || 0) + power;
      } else {
        effectAdd(game, ctx.sourceId, t, { layer: 7, power, toughness, untilEot: eff.untilEot !== false });
      }
    }
  } else if (op === "tap" || op === "untap") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      const o = raw.objects[t];
      if (o && o.zone === "battlefield") o.tapped = op === "tap";
    }
  } else if (op === "shield") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      raw.effects.push({ type: "shield", amount, targets: [t], untilEot: true, sourceId: ctx.sourceId });
    }
  } else if (op === "scry") {
    let player = eff.player === "controller" ? ctx.controller : eff.player;
    const pl = typeof player === "number" ? raw.players[player] : null;
    if (pl) {
      for (let i = 0; i < amount; i++) {
        if (pl.library.length === 0) break;
        pl.library.push(pl.library.shift());
      }
    }
  } else if (op === "addMana") {
    const pool = raw.players[ctx.controller].manaPool;
    for (const color in (eff.mana || {})) {
      if (Object.prototype.hasOwnProperty.call(eff.mana, color)) pool[color] = (pool[color] || 0) + eff.mana[color];
    }
  } else if (op === "counter") {
    for (const t of resolveTargets(ctx, eff.targets)) {
      const o = raw.objects[t];
      if (!o || o.zone !== "stack") continue;
      for (let s = raw.stack.length - 1; s >= 0; s--) {
        const e = raw.stack[s];
        if (e && e.kind === "spell" && e.objId === t) {
          raw.stack.splice(s, 1);
          break;
        }
      }
      o.zone = "graveyard";
      const gy = raw.players[o.owner].graveyard;
      if (gy.indexOf(t) === -1) gy.push(t);
    }
  } else if (op === "token") {
    // The local layer cannot manufacture a token definition that is not in the active DB;
    // this op is only meaningful once a token source exists — skipped (documented).
  }
  return died;
}

// applyEffects(game, effects, ctx) -> run each effect op in order, mutating game.raw in
// place, and return the object ids that died as a result (lethal damage, destroy,
// sacrifice) so the caller can cascade death triggers.
export function applyEffects(game, effects, ctx) {
  const died = [];
  if (!Array.isArray(effects)) return died;
  for (const eff of effects) {
    if (!eff || typeof eff.op !== "string") continue;
    const extra = applyOneEffect(game, eff, ctx);
    for (const d of extra) if (died.indexOf(d) === -1) died.push(d);
  }
  return died;
}

// ── firing ────────────────────────────────────────────────────────────────────────────
function baseCtx(game, sourceId) {
  const raw = game.raw;
  const obj = sourceId != null ? raw.objects[sourceId] : null;
  return {
    x: 0,
    targets: [],
    self: sourceId,
    controller: obj ? obj.controller : 0,
    opponent: obj ? (obj.controller + 1) % raw.players.length : 1,
    owner: obj ? obj.owner : (obj ? obj.controller : 0),
    activePlayer: raw.activePlayer,
    drawingPlayer: null,
    diedId: null,
    diedController: null,
  };
}

// fireOne routes one collected trigger through the immediate/stack toggle. The depth
// guard bounds trigger-storm recursion (a trigger effect that itself triggers...).
function fireOne(game, trigger, sourceId, ctx, order) {
  if (game.raw.gameOver) return;
  game._triggerDepth = (game._triggerDepth || 0) + 1;
  try {
    if (game._triggerDepth > 40) return;
    if (triggersImmediate(game)) {
      applyTrigger(game, trigger, sourceId, ctx, order);
    } else {
      queueTrigger(game, trigger, sourceId, ctx, order);
    }
  } finally {
    game._triggerDepth -= 1;
  }
}

function triggerName(game, sourceId) {
  const card = cardFor(game, sourceId);
  return card && card.name ? card.name : (game.raw.objects[sourceId] ? game.raw.objects[sourceId].cardId : "?");
}

function applyTrigger(game, trigger, sourceId, ctx, order) {
  const died = applyEffects(game, trigger.effects, ctx);
  logTrigger(game, {
    when: trigger.when, sourceId, order,
    cardId: game.raw.objects[sourceId] ? game.raw.objects[sourceId].cardId : null,
    name: triggerName(game, sourceId),
    effects: trigger.effects,
    immediate: true,
  });
  if (died.length) fireDeath(game, died);
}

function queueTrigger(game, trigger, sourceId, ctx, order) {
  const raw = game.raw;
  raw.stack = Array.isArray(raw.stack) ? raw.stack : [];
  game._triggerSeq = (game._triggerSeq || 0) + 1;
  const entry = {
    kind: "trigger",
    id: "trg" + game._triggerSeq,
    objId: sourceId,
    cardId: raw.objects[sourceId] ? raw.objects[sourceId].cardId : null,
    controller: ctx.controller,
    when: trigger.when,
    effects: clone(trigger.effects || []),
    ctx: {
      x: 0, targets: [], self: ctx.self, controller: ctx.controller, opponent: ctx.opponent,
      owner: ctx.owner, activePlayer: ctx.activePlayer, drawingPlayer: ctx.drawingPlayer,
      diedId: ctx.diedId, diedController: ctx.diedController,
    },
    order,
  };
  raw.stack.push(entry);
  logTrigger(game, {
    when: trigger.when, sourceId, order,
    cardId: entry.cardId, name: triggerName(game, sourceId),
    effects: trigger.effects, immediate: false, queued: true,
  });
}

// ── event handlers ────────────────────────────────────────────────────────────────────
function filterMatches(filter, deadCard) {
  if (!filter || !deadCard) return true;
  if (Array.isArray(filter.colors)) {
    for (const c of filter.colors) {
      if (!(deadCard.colors || []).includes(c)) return false;
    }
  }
  if (Array.isArray(filter.types)) {
    for (const t of filter.types) {
      if (!(deadCard.types || []).includes(t)) return false;
    }
  }
  return true;
}

export function fireUpkeep(game) {
  const raw = game.raw;
  const active = raw.activePlayer;
  const list = [];
  for (let i = 0; i < raw.battlefield.length; i++) {
    const id = raw.battlefield[i];
    const obj = raw.objects[id];
    if (!obj || obj.zone !== "battlefield") continue;
    const card = cardFor(game, id);
    if (!card || !Array.isArray(card.triggers)) continue;
    for (const t of card.triggers) {
      if (!t || t.when !== "upkeep") continue;
      if (t.firesFor !== "each" && obj.controller !== active) continue;
      list.push({ sourceId: id, trigger: t, order: i });
    }
  }
  for (const item of list) {
    const ctx = baseCtx(game, item.sourceId);
    ctx.activePlayer = active;
    fireOne(game, item.trigger, item.sourceId, ctx, item.order);
  }
  return game;
}

// fireDeath(game, diedIds) -> fire the death triggers for objects that just left the
// battlefield to the graveyard: each dead permanent's own "death" triggers first, then
// every battlefield watcher's "creatureDies"/"landDies" triggers in timestamp order.
// Recurses (via applyTrigger) when a trigger effect itself kills something.
export function fireDeath(game, diedIds) {
  if (!Array.isArray(diedIds) || diedIds.length === 0) return game;
  const raw = game.raw;
  if (game._triggerDepth > 40) return game;
  for (const id of diedIds) {
    if (raw.gameOver) break;
    const obj = raw.objects[id];
    if (!obj) continue;
    const card = cardFor(game, id);
    if (card && Array.isArray(card.triggers)) {
      for (const t of card.triggers) {
        if (t && t.when === "death") {
          const ctx = baseCtx(game, id);
          ctx.self = id;
          fireOne(game, t, id, ctx, 0);
        }
      }
    }
    if (raw.gameOver) break;
    for (let i = 0; i < raw.battlefield.length; i++) {
      const wid = raw.battlefield[i];
      const w = raw.objects[wid];
      if (!w) continue;
      const wcard = cardFor(game, wid);
      if (!wcard || !Array.isArray(wcard.triggers)) continue;
      for (const t of wcard.triggers) {
        if (!t || (t.when !== "creatureDies" && t.when !== "landDies")) continue;
        if (t.when === "creatureDies" && !(card && card.types.includes("Creature"))) continue;
        if (t.when === "landDies" && !(card && card.types.includes("Land"))) continue;
        if (!filterMatches(t.filter, card)) continue;
        const ctx = baseCtx(game, wid);
        ctx.diedId = id;
        ctx.diedController = obj.controller;
        fireOne(game, t, wid, ctx, i);
      }
    }
  }
  return game;
}

export function fireDraw(game, player, count) {
  if (!Number.isInteger(count) || count <= 0) return game;
  const raw = game.raw;
  const list = [];
  for (let i = 0; i < raw.battlefield.length; i++) {
    const id = raw.battlefield[i];
    const obj = raw.objects[id];
    if (!obj || obj.zone !== "battlefield") continue;
    const card = cardFor(game, id);
    if (!card || !Array.isArray(card.triggers)) continue;
    for (const t of card.triggers) {
      if (!t || t.when !== "draw") continue;
      if (t.player === "opponent" && obj.controller === player) continue;
      if (t.player === "controller" && obj.controller !== player) continue;
      list.push({ sourceId: id, trigger: t, order: i });
    }
  }
  for (let c = 0; c < count; c++) {
    for (const item of list) {
      if (raw.gameOver) break;
      const ctx = baseCtx(game, item.sourceId);
      ctx.drawingPlayer = player;
      fireOne(game, item.trigger, item.sourceId, ctx, item.order);
    }
  }
  return game;
}

// observe(game, action, prev) -> called by turn.doAction after every accepted action
// (and after local trigger resolutions). Detects the events that fired this action —
// an upkeep-step entry, permanents that left the battlefield to the graveyard, hand-size
// growth (draws) — and fires the matching triggers. prev is a captureEvents() snapshot
// taken before the action.
export function observe(game, action, prev) {
  const raw = game.raw;
  if (!prev || !raw || !Array.isArray(raw.players) || raw.gameOver) return game;

  if (prev.step !== "upkeep" && raw.step === "upkeep") {
    fireUpkeep(game);
  }

  const died = [];
  for (const id of prev.battlefield) {
    const o = raw.objects[id];
    if (o && o.zone === "graveyard" && raw.battlefield.indexOf(id) === -1) died.push(id);
  }
  if (died.length) fireDeath(game, died);

  for (let p = 0; p < raw.players.length; p++) {
    const grew = raw.players[p].hand.length - (prev.hands[p] || 0);
    if (grew > 0) fireDraw(game, p, grew);
  }
  return game;
}

// ── stack-mode resolution ─────────────────────────────────────────────────────────────
// In stack mode the trigger sits on the plugin's stack; the plugin's own passPriority
// would try to resolve it as a spell, so turn.doAction intercepts passes while the top
// entry is a local trigger (see turn.js). resolveTriggerTop does what the plugin's
// resolve branch would have: pop + apply + reset the pass bookkeeping.
export function isTriggerOnTop(game) {
  const s = game.raw.stack;
  return Array.isArray(s) && s.length > 0 && s[s.length - 1].kind === "trigger";
}

export function resolveTriggerTop(game) {
  const raw = game.raw;
  const stack = Array.isArray(raw.stack) ? raw.stack : [];
  const entry = stack.length ? stack[stack.length - 1] : null;
  if (!entry || entry.kind !== "trigger") return null;
  stack.pop();
  const ctx = entry.ctx || baseCtx(game, entry.objId);
  const died = applyEffects(game, entry.effects, ctx);
  raw.passedPlayers = [];
  raw.priorityPlayer = raw.activePlayer;
  logTrigger(game, {
    when: entry.when, sourceId: entry.objId, order: entry.order,
    cardId: entry.cardId, name: triggerName(game, entry.objId),
    effects: entry.effects, immediate: false, resolved: true,
  });
  if (died.length) fireDeath(game, died);
  return entry;
}

// describeTrigger(trigger, name) -> human-readable summary for the game log / UI.
export function describeTrigger(trigger, name) {
  const s = name || "a permanent";
  if (trigger.when === "upkeep") return s + "'s upkeep trigger";
  if (trigger.when === "death") return s + "'s death trigger";
  if (trigger.when === "creatureDies") return s + "'s \"creature dies\" trigger";
  if (trigger.when === "landDies") return s + "'s \"land dies\" trigger";
  if (trigger.when === "draw") return s + "'s draw trigger";
  return s + "'s trigger";
}
