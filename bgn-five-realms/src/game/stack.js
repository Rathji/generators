// Five Realms — the stack layer (roadmap Phase 6, task 20).
// The five-realms-plugin owns the stack machinery: state.stack is a LIFO array, spells
// (frActionCastSpell) and activated abilities (frActionActivateAbility) push entries onto
// the top, and its passPriority reducer resolves the topmost object whenever all players
// have passed with a non-empty stack — advancing the step only when the stack is empty.
// This module is the client-facing VIEW of the stack:
//   • stackEntries/stackTop/stackCount/stackIsEmpty — an ordered view of the stack,
//   • allPassRound  — pass once for every player (exactly one all-pass round: either the
//     top object resolves or, with an empty stack, the step advances),
//   • describeEntry — a human-readable summary for the game log / UI.
// Resolution itself — resolveTop/resolveAll, fizzle enforcement, and the resolution
// report — lives in src/game/resolve.js (roadmap Phase 6, task 22); it sits on top of
// this module's allPassRound. Triggered abilities resolve immediately in the engine (the
// Alpha-era default; the task 23 toggle will route them through the stack), so "triggers
// firing between resolutions" is observed by diffing the battlefield across a resolution.

import * as engine from "./engine.js";
import * as turn from "./turn.js";

// stackEntries(game) -> bottom-to-top array of stack-entry metadata. Each entry:
//   { index, top, depth, stackSize, kind, objId, cardId, name, controller, targets,
//     mode, x, abilityName, zone }
// depth is 1 for the topmost object; stackSize is the total number of objects on the
// stack when this snapshot was taken.
export function stackEntries(game) {
  const raw = game.raw;
  const arr = Array.isArray(raw.stack) ? raw.stack : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    const inst = e.objId ? engine.cardInstance(game, e.objId) : null;
    const obj = inst ? inst.obj : null;
    const card = inst ? inst.card : null;
    out.push({
      index: i,
      top: i === arr.length - 1,
      depth: arr.length - i,
      stackSize: arr.length,
      kind: e.kind,
      objId: e.objId,
      cardId: e.cardId,
      name: card && card.name ? card.name : e.cardId,
      controller: obj ? obj.controller : null,
      targets: Array.isArray(e.targets) ? e.targets.slice() : e.target != null ? [e.target] : [],
      mode: e.mode || null,
      x: typeof e.x === "number" ? e.x : null,
      abilityName: e.abilityName || null,
      when: e.kind === "trigger" ? e.when : null,
      effects: e.kind === "trigger" ? (e.effects || []) : null,
      zone: obj ? obj.zone : null,
    });
  }
  return out;
}

export function stackCount(game) {
  const arr = game.raw && Array.isArray(game.raw.stack) ? game.raw.stack : [];
  return arr.length;
}

export function stackIsEmpty(game) {
  return stackCount(game) === 0;
}

export function stackTop(game) {
  const entries = stackEntries(game);
  return entries.length ? entries[entries.length - 1] : null;
}

// allPassRound(game) -> pass priority once for every player (whoever holds priority each
// turn), completing exactly one all-pass round. With a non-empty stack the topmost object
// resolves (see resolve.js for the resolution report); with an empty stack the step
// advances. Returns { passes, resolved, stackLen, stepAdvanced, step, turnNumber }.
export function allPassRound(game) {
  const raw = game.raw;
  const n = raw.players.length;
  const startStackLen = stackCount(game);
  const startStep = raw.step;
  const startTurn = raw.turnNumber;
  const passes = [];
  for (let i = 0; i < n; i++) {
    const p = game.raw.priorityPlayer;
    turn.pass(game, p);
    passes.push(p);
  }
  return {
    passes,
    resolved: startStackLen > 0,
    stackLen: stackCount(game),
    stepAdvanced: startStep !== game.raw.step || startTurn !== game.raw.turnNumber,
    step: game.raw.step,
    turnNumber: game.raw.turnNumber,
  };
}

// describeEntry(entry, game) -> a human-readable summary of a stack entry for the game
// log / UI, e.g. "Cinder Bolt targeting Player 2" or "Ember Hound's snap targeting Player 2"
// or "Tide Banishment targeting the spell Sunward Sentinel".
export function describeEntry(entry, game) {
  const targets = (entry.targets || []).map((t) => {
    if (typeof t === "number") return "Player " + (t + 1);
    const inst = engine.cardInstance(game, t);
    const o = inst ? inst.obj : null;
    if (o && o.zone === "stack") {
      const n = inst && inst.card && inst.card.name ? inst.card.name : t;
      return "the spell " + n;
    }
    return inst && inst.card && inst.card.name ? inst.card.name : String(t);
  });
  const tgt = targets.length ? " targeting " + targets.join(" and ") : "";
  if (entry.kind === "ability") {
    return entry.name + "'s " + (entry.abilityName || "activated ability") + tgt;
  }
  if (entry.kind === "trigger") {
    return entry.name + "'s " + (entry.when || "trigger") + " trigger" + tgt;
  }
  return entry.name + tgt;
}
