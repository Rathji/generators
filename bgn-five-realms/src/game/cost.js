// Five Realms — cost payment engine (roadmap Phase 5, task 18).
// Given a card's mana cost (including X costs) and the caster's available mana — the
// floating pool plus untapped mana-producing permanents — compute a payment plan: resolve
// X, choose which sources to tap (and which colour each dual land produces), and leave
// the pool able to pay. The five-realms-plugin reducer performs the actual spend on
// castSpell via frManaTryPay, so this module mirrors that feasibility check (canPayPool)
// and only needs to arrange the taps; the taps themselves go through mana.activateManaAbility
// so the per-turn production tracker stays accurate and every legality check (priority,
// tapped, summoning sickness) is enforced once.
//
// Two payment strategies are supported:
//   "pool-first"    (default) — use floating pool mana first; tap sources only for the
//                   shortfall, minimising the number of lands tapped.
//   "sources-first" — tap sources to cover as much of the cost as possible (up to the
//                   cost's total), leaving the floating pool as full as it can be.
// X is resolved to a chosen non-negative integer; X=0 is always a legal payment for a
// free X spell. "max" picks the largest X the caster can afford.

import * as engine from "./engine.js";
import * as mana from "./mana.js";

// Mana symbols the engine understands (mirrors the plugin's frManaParseSymbol).
const MAX_SEARCH_SOURCES = 12;

const SYMBOL_ORDER = { colored: 0, colorless: 0, hybridColored: 1, hybridGeneric: 2, generic: 3, variable: 4 };

// parseCost("{2}{W}{X}") -> { symbols:[{kind,...}], cmc, colors, xCount }.
// Mirrors the plugin's frManaParseCost so a plan that canPayPool says "payable" is
// guaranteed to be accepted by the reducer. {T} is the tap symbol, not a mana symbol —
// it throws here, just as it does inside the plugin's cost parser.
export function parseCost(costStr) {
  if (typeof costStr !== "string") throw new Error("parseCost: cost string required");
  const symbols = [];
  let i = 0;
  while (i < costStr.length) {
    if (costStr[i] !== "{") throw new Error("parseCost: malformed manaCost — expected { at index " + i);
    const close = costStr.indexOf("}", i);
    if (close === -1) throw new Error("parseCost: malformed manaCost — unterminated { at index " + i);
    const body = costStr.slice(i + 1, close);
    symbols.push(parseSymbol(body));
    i = close + 1;
  }
  let cmc = 0;
  let xCount = 0;
  const colors = [];
  for (const s of symbols) {
    cmc += s.cmc;
    if (s.kind === "variable") xCount += 1;
    for (const c of s.colors) {
      if (!colors.includes(c)) colors.push(c);
    }
  }
  return { symbols, cmc, colors, xCount };
}

function parseSymbol(body) {
  if (body === "T") {
    throw new Error("parseCost: {T} is the tap symbol, not a mana symbol");
  }
  if (/^[0-9]+$/.test(body)) {
    return { kind: "generic", n: parseInt(body, 10), cmc: parseInt(body, 10), colors: [] };
  }
  if (body === "X") {
    return { kind: "variable", cmc: 0, colors: [] };
  }
  if (body === "C") {
    return { kind: "colorless", cmc: 1, colors: [] };
  }
  if (/^[WUBRG]$/.test(body)) {
    return { kind: "colored", color: body, cmc: 1, colors: [body] };
  }
  if (/^[WUBRG]\/[WUBRG]$/.test(body)) {
    const parts = body.split("/");
    return { kind: "hybridColored", options: parts, cmc: 1, colors: parts };
  }
  if (/^[0-9]+\/[WUBRG]$/.test(body)) {
    const parts = body.split("/");
    const n = parseInt(parts[0], 10);
    return { kind: "hybridGeneric", n, color: parts[1], cmc: n, colors: [parts[1]] };
  }
  throw new Error("parseCost: malformed mana symbol {" + body + "}");
}

// canPayPool(pool, cost, x) -> whether the floating pool alone can pay the cost at X=x.
// Mirrors the plugin's frManaTryPay feasibility (colored symbols need their colour,
// {C} needs colourless, hybrids pick an option, generic is summed and paid from any
// leftover, and X contributes x * xCount generic mana). x is validated like the reducer:
// omitted defaults to 0; a negative/non-integer x is not a legal choice.
export function canPayPool(pool, cost, x) {
  if (cost.xCount > 0) {
    if (x === undefined) x = 0;
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0) return false;
  }
  const working = {};
  for (const k in pool) working[k] = pool[k] || 0;
  const symbols = cost.symbols.slice().sort((a, b) => SYMBOL_ORDER[a.kind] - SYMBOL_ORDER[b.kind]);
  let genericNeeded = 0;
  for (const sym of symbols) {
    if (sym.kind === "colored") {
      if ((working[sym.color] || 0) > 0) working[sym.color] -= 1;
      else return false;
    } else if (sym.kind === "colorless") {
      if ((working.C || 0) > 0) working.C -= 1;
      else return false;
    } else if (sym.kind === "hybridColored") {
      let paid = false;
      for (const o of sym.options) {
        if ((working[o] || 0) > 0) {
          working[o] -= 1;
          paid = true;
          break;
        }
      }
      if (!paid) return false;
    } else if (sym.kind === "hybridGeneric") {
      if ((working[sym.color] || 0) > 0) working[sym.color] -= 1;
      else genericNeeded += sym.n;
    } else if (sym.kind === "generic") {
      genericNeeded += sym.n;
    }
  }
  if (cost.xCount > 0) genericNeeded += x * cost.xCount;
  let total = 0;
  for (const k in working) total += working[k];
  return total >= genericNeeded;
}

// manaSources(game, player) -> the untapped mana-producing permanents the player controls
// that could be tapped for mana right now: on the battlefield, not tapped, not a
// summoning-sick creature, and with a producesMana ability (any colour string from the
// plugin DB or the 295-card Alpha projection). Each entry carries the colours it can
// produce ({objId, cardId, colors}).
export function manaSources(game, player) {
  const raw = game.raw;
  const out = [];
  for (const objId of raw.battlefield) {
    const obj = raw.objects[objId];
    if (!obj || obj.zone !== "battlefield" || obj.controller !== player) continue;
    if (obj.tapped) continue;
    const card = mana.cardDefFor(game, objId);
    if (!card || typeof card.producesMana !== "string" || card.producesMana === "") continue;
    if (card.types && card.types.includes("Creature") && obj.summoningSickness) continue;
    out.push({ objId, cardId: obj.cardId, colors: card.producesMana.split("") });
  }
  return out;
}

// solveTaps(pool, sources, cost, x, strategy, maxTaps) -> the chosen taps
// [{objId, chosenColor}] that make canPayPool(pool + taps, cost, x) true, or null when no
// such set exists. "pool-first" minimises the tap count; "sources-first" maximises it
// (bounded by the cost's total and maxTaps). Exhaustive over subsets of sources and their
// colour choices, so it always finds a payment when one exists (capped at MAX_SEARCH_SOURCES).
function solveTaps(pool, sources, cost, x, strategy, maxTaps) {
  const N = sources.length;
  if (N > MAX_SEARCH_SOURCES) {
    throw new Error("cost: " + N + " mana sources is too many for the payment planner (max " + MAX_SEARCH_SOURCES + ")");
  }
  const totalPaid = cost.cmc + x * cost.xCount;
  const cap = maxTaps === undefined ? totalPaid : Math.min(maxTaps, totalPaid);
  const maxK = Math.min(N, cap);
  const ks = [];
  if (strategy === "sources-first") {
    for (let k = maxK; k >= 0; k--) ks.push(k);
  } else {
    for (let k = 0; k <= maxK; k++) ks.push(k);
  }
  for (const K of ks) {
    const sol = searchExact(pool, sources, cost, x, K);
    if (sol) return sol;
  }
  return null;
}

function searchExact(pool, sources, cost, x, K) {
  if (K > sources.length) return null;
  const pool2 = { ...pool };
  const chosen = [];
  let found = null;
  (function rec(start, depth) {
    if (found) return;
    if (depth === K) {
      if (canPayPool(pool2, cost, x)) {
        found = chosen.map((c) => ({ objId: sources[c.idx].objId, chosenColor: c.color }));
      }
      return;
    }
    const need = K - depth;
    for (let i = start; i + need <= sources.length; i++) {
      const src = sources[i];
      for (let ci = 0; ci < src.colors.length; ci++) {
        const color = src.colors[ci];
        pool2[color] = (pool2[color] || 0) + 1;
        chosen.push({ idx: i, color });
        rec(i + 1, depth + 1);
        chosen.pop();
        pool2[color] -= 1;
      }
    }
  })(0, 0);
  return found;
}

// maxAffordableX(game, player, costStr, opts?) -> the largest integer X the player can
// afford for a cost with X symbols (using pool + sources), or null when even X=0 is
// unpayable, or when the cost has no X at all.
export function maxAffordableX(game, player, costStr, opts = {}) {
  const cost = parseCost(costStr);
  return maxAffordableXForCost(game, player, cost, opts);
}

function maxAffordableXForCost(game, player, cost, opts) {
  if (cost.xCount === 0) return null;
  const pool = engine.manaPool(game, player);
  const sources = manaSources(game, player);
  const strategy = opts.strategy === "sources-first" ? "sources-first" : "pool-first";
  const upper = Math.floor((mana.poolTotalOf(pool) + sources.length) / cost.xCount);
  for (let x = upper; x >= 0; x--) {
    if (solveTaps(pool, sources, cost, x, strategy, opts.maxTaps)) return x;
  }
  return null;
}

// buildPayment(game, player, costStr, opts?) -> a payment plan without mutating anything.
//   opts: { x?: number|"max", strategy?: "pool-first"|"sources-first", maxTaps?: number }
// Returns { ok:true, x, taps, costStr, cost, totalPaid, strategy, poolBefore, poolAfter }
// or { ok:false, reason, x, taps:[] }. A malformed cost string or an invalid x (negative /
// non-integer when the cost has X) throws — those are programming errors, not unpayable
// costs. An unpayable cost returns ok:false.
export function buildPayment(game, player, costStr, opts = {}) {
  const cost = parseCost(costStr);
  const strategy = opts.strategy === "sources-first" ? "sources-first" : "pool-first";
  const pool = engine.manaPool(game, player);
  const sources = manaSources(game, player);

  let x = 0;
  if (cost.xCount > 0) {
    if (opts.x === "max") {
      x = maxAffordableXForCost(game, player, cost, opts);
      if (x === null) {
        return { ok: false, reason: "cannot pay " + costStr + " at any X", x: 0, taps: [] };
      }
    } else {
      x = opts.x === undefined ? 0 : opts.x;
      if (typeof x !== "number" || !Number.isInteger(x) || x < 0) {
        throw new Error("buildPayment: x must be a non-negative integer");
      }
    }
  }

  const taps = solveTaps(pool, sources, cost, x, strategy, opts.maxTaps);
  if (!taps) {
    return {
      ok: false,
      reason: "cannot pay " + costStr + (cost.xCount > 0 ? " at X=" + x : ""),
      x,
      taps: [],
    };
  }
  const poolAfter = { ...pool };
  for (const t of taps) poolAfter[t.chosenColor] = (poolAfter[t.chosenColor] || 0) + 1;
  if (!canPayPool(poolAfter, cost, x)) {
    throw new Error("buildPayment: internal plan verification failed for " + costStr);
  }
  return {
    ok: true,
    x,
    taps,
    costStr,
    cost,
    totalPaid: cost.cmc + x * cost.xCount,
    strategy,
    poolBefore: pool,
    poolAfter,
  };
}

// executePayment(game, player, plan) -> apply a payable plan: tap each chosen source via
// mana.activateManaAbility (which enforces priority/tap/sickness and records production),
// then verify the resulting pool can pay the cost. Throws on any failure. The caller then
// casts (the reducer pays the pool on castSpell); until then the mana sits in the pool.
export function executePayment(game, player, plan) {
  if (!plan || plan.ok !== true) throw new Error("executePayment: no payable plan");
  if (game.raw.priorityPlayer !== player) {
    throw new Error("executePayment: player " + player + " does not have priority");
  }
  for (const t of plan.taps) {
    mana.activateManaAbility(game, player, t.objId, t.chosenColor);
  }
  const pool = engine.manaPool(game, player);
  if (!canPayPool(pool, plan.cost, plan.x)) {
    throw new Error("executePayment: plan verification failed after tapping");
  }
  return game.raw;
}

// payCost(game, player, costStr, opts?) -> buildPayment + executePayment in one call.
// Returns the plan (ok:false plans are returned unexecuted, so callers can inspect the
// reason); a successful plan has already tapped the sources and left the pool ready.
export function payCost(game, player, costStr, opts = {}) {
  const plan = buildPayment(game, player, costStr, opts);
  if (plan.ok) executePayment(game, player, plan);
  return plan;
}
