// src/automa.js — the Automa rulebook as structured, executable behavior data
// (Task 44). The Automa is the solo opponent. Its printed rulebook is a
// SEPARATE book that the starting rulebook (mirrored at scratch/rules/
// rules-jina.txt — grep "Automa" there: no hits) does not include, so the
// rules below are PROVISIONAL but faithful to the real Automa's published
// design: a deck-driven bot that draws 1 Automa card per turn, resolves the
// action printed on it, and uses cubes (not workers) — it never bumps player
// workers, players may bump its cubes, and it scores exactly like a player.
//
// Every rule is one AUTOMA_RULES entry: { id, name, phase, rule, behave }.
// `behave(ctx)` is a deterministic pure function (ctx may carry {state, seed,
// playerId, ...}) returning a structured action descriptor — the executable
// data the Phase 12 bot core (Task 59) consumes. The Task 44 test asserts
// every REQUIRED_AUTOMA_RULES id is represented by a behavior entry, that
// every AUTOMA_CARDS action maps to a valid rule, and that resolveAutomaTurn
// is deterministic given a state + seed.

import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS, CARD_TYPES } from "./cards.js";
import { WORKER_ACTIONS } from "./engine.js";
import { TRACK_REASONS } from "./progress.js";
import { STARTING_SETUP } from "./indexGuide.js";
import { createGameState } from "./serialization.js";

export const AUTOMA_VERSION = 1;

export const AUTOMA_ID = "Automa";
export const AUTOMA_CUBES = 12;

export const AUTOMA_RULES = [
  {
    id: "automa-setup", name: "Automa Setup", phase: "setup",
    rule: "Automa players use the Automa deck and a supply of automa cubes instead of normal workers and influence tokens.",
    behave: ctx => ({ action: "setup", deck: "automa", cubes: ctx.cubeCount ?? 12 }),
  },
  {
    id: "automa-deck-draw", name: "Draw a Card", phase: "turn",
    rule: "At the start of its turn the Automa draws 1 Automa card from its deck and resolves the action printed on it; drawn cards cycle back into the deck.",
    behave: () => ({ action: "draw" }),
  },
  {
    id: "automa-place", name: "Automa Placement", phase: "turn",
    rule: "A placement card shows the building the Automa targets by priority. The Automa places a cube on that building; its cube does not bump a player's worker.",
    behave: ctx => ({ action: "place", buildingId: ctx.buildingId ?? "treasury", priority: ctx.priority ?? 0 }),
  },
  {
    id: "automa-retrieve", name: "Automa Retrieve", phase: "turn",
    rule: "When its action says so (or once all cubes are out), the Automa retrieves its cubes back to its supply.",
    behave: () => ({ action: "retrieve" }),
  },
  {
    id: "automa-construct", name: "Automa Construction", phase: "turn",
    rule: "A construction card names a building for the Automa to construct in its charter. The Automa pays an abstract cost (tracked as its card efficiency) rather than resources.",
    behave: ctx => ({ action: "construct", buildingId: ctx.buildingId ?? "bldg-mine", abstractCost: ctx.abstractCost ?? 1 }),
  },
  {
    id: "automa-bump-protection", name: "No Bumping", phase: "turn",
    rule: "The Automa never bumps a player's worker. Players may bump an Automa cube from a building to gain its benefit themselves.",
    behave: () => ({ action: "note", note: "no-bump", playersMayBump: true }),
  },
  {
    id: "automa-crate", name: "Automa Crates", phase: "turn",
    rule: "A crate card tells the Automa to unlock a specific crate number (simplified: it skips the cost and archives the constructed card).",
    behave: ctx => ({ action: "crate", crateNumber: ctx.crateNumber ?? 1 }),
  },
  {
    id: "automa-quota", name: "Automa Quota", phase: "turn",
    rule: "A quota card lets the Automa sell a commodity to an open quota space for its VP (plus the optional bonus).",
    behave: ctx => ({ action: "quota", spaceId: ctx.spaceId ?? null }),
  },
  {
    id: "automa-objective", name: "Automa Objectives", phase: "turn",
    rule: "The Automa scores a completed objective once, using a simplified evaluation of the objective's condition against its abstract board state.",
    behave: ctx => ({ action: "scoreObjective", objectiveId: ctx.objectiveId ?? null }),
  },
  {
    id: "automa-reputation", name: "Automa Reputation", phase: "turn",
    rule: "Reputation cards advance the Automa's influence token on the reputation track (abstracted to its end-game VP).",
    behave: ctx => ({ action: "reputation", amount: ctx.amount ?? 1 }),
  },
  {
    id: "automa-income", name: "Automa Income", phase: "turn",
    rule: "When income triggers, the Automa gains the printed income like a player.",
    behave: () => ({ action: "income" }),
  },
  {
    id: "automa-progress", name: "Automa Progress", phase: "turn",
    rule: "The Automa advances the progress token under the normal rules (construction, crate, objective, and the no-influence advance).",
    behave: ctx => ({ action: "progress", reason: ctx.reason ?? "automa" }),
  },
  {
    id: "automa-scoring", name: "Automa End-Game Scoring", phase: "scoring",
    rule: "The Automa scores end-game exactly like a player: reputation, scored objectives, constructed buildings, and crates. Ties break toward the human.",
    behave: () => ({ action: "scoreEndGame", like: "player", tieBreak: "human-favors" }),
  },
  {
    id: "automa-difficulty", name: "Difficulty Levels", phase: "setup",
    rule: "Difficulty levels adjust the Automa's VP gains and card efficiency (a deck card multiplier).",
    behave: ctx => ({ action: "difficulty", level: ctx.level ?? 1, multiplier: ctx.multiplier ?? 1 }),
  },
  {
    id: "automa-turn-order", name: "Turn Order", phase: "turn",
    rule: "Automas take turns in seating order interleaved with players; each Automa turn resolves instantly from its deck.",
    behave: () => ({ action: "turn", kind: "instant" }),
  },
  {
    id: "automa-deck-cycling", name: "Deck Cycling", phase: "turn",
    rule: "Resolved Automa cards are placed on top of the Automa deck, so the deck cycles in the same order each round.",
    behave: () => ({ action: "cycle" }),
  },
];

export const REQUIRED_AUTOMA_RULES = Object.freeze([
  "automa-setup",
  "automa-deck-draw",
  "automa-place",
  "automa-retrieve",
  "automa-construct",
  "automa-bump-protection",
  "automa-crate",
  "automa-quota",
  "automa-objective",
  "automa-reputation",
  "automa-income",
  "automa-progress",
  "automa-scoring",
  "automa-difficulty",
  "automa-turn-order",
  "automa-deck-cycling",
]);

// The Automa deck: each card names the rule it resolves (action = rule id).
// PROVISIONAL deck composition (12 cards, balanced across actions).
export const AUTOMA_CARDS = [
  { id: "auto-01", name: "Craft", action: "automa-place", priority: 0 },
  { id: "auto-02", name: "Trade", action: "automa-place", priority: 1 },
  { id: "auto-03", name: "Build", action: "automa-construct", buildingId: "bldg-mine" },
  { id: "auto-04", name: "Expand", action: "automa-construct", buildingId: "bldg-lumber" },
  { id: "auto-05", name: "Collect", action: "automa-retrieve" },
  { id: "auto-06", name: "Explore", action: "automa-crate", crateNumber: 1 },
  { id: "auto-07", name: "Supply", action: "automa-quota" },
  { id: "auto-08", name: "Glory", action: "automa-objective" },
  { id: "auto-09", name: "Prestige", action: "automa-reputation", amount: 1 },
  { id: "auto-10", name: "Favor", action: "automa-income" },
  { id: "auto-11", name: "Endeavor", action: "automa-place", priority: 2 },
  { id: "auto-12", name: "Crown", action: "automa-objective" },
];

export function ruleById(ruleId) {
  return AUTOMA_RULES.find(r => r.id === ruleId) ?? null;
}

export function cardById(cardId) {
  return AUTOMA_CARDS.find(c => c.id === cardId) ?? null;
}

// Resolve one Automa card's action. Deterministic in (ctx.deck, ctx.seed) —
// the same state + seed always produces the identical action descriptor.
export function automaAction(cardId, ctx = {}) {
  const card = cardById(cardId);
  if (!card) return { ok: false, reason: "no_such_card", cardId };
  const rule = ruleById(card.action);
  if (!rule) return { ok: false, reason: "no_such_rule", cardId, action: card.action };
  const behavior = rule.behave(ctx);
  return { ok: true, cardId, ruleId: card.action, rule: rule.id, behavior };
}

// Draw + resolve one Automa turn from the deck (the deck cycles: the card
// drawn is returned to the deck, so a later turn may draw it again).
export function resolveAutomaTurn(ctx = {}) {
  const deck = ctx.deck ?? AUTOMA_CARDS;
  const seed = Math.abs((ctx.seed ?? 0) | 0);
  const card = deck[seed % deck.length];
  const action = automaAction(card.id, ctx);
  return { ...action, cardId: card.id, cycle: { action: "cycle" } };
}

// ── Task 59: the Automa bot core ──
// The Automa is a real pseudo-player registered in the game state (it has a
// charter, an economy store, influence tokens, a reputation/quota presence and
// a seat in the turn machine), but it has 0 workers and uses cubes instead.
// runAutomaTurn resolves its deck card for its current turn, executes the
// resulting behavior against the real engine subsystems, and then advances the
// turn machine so play alternates with the human. It never bumps a human
// worker (per rule automa-bump-protection) and never mutates the human's
// position except through the shared board/objective/reputation/quota tracks.

// ── solo game setup ──
export function createSoloGame(config = {}) {
  const humanId = config.humanId ?? "P1";
  const automaId = config.automaId ?? AUTOMA_ID;
  const players = [
    { id: humanId, charterId: 0, startingCoins: config.startingCoins ?? 4 },
    { id: automaId, charterId: 1, workers: 0, startingCoins: config.startingCoins ?? 4 },
  ];
  const g = createGameState({
    players,
    firstPlayer: config.firstPlayer ?? humanId,
    rng: config.rng,
    advancementConfig: config.advancementConfig ?? { deck: [...STARTING_SETUP.advancementDeck] },
    objectivesConfig: config.objectivesConfig ?? [...STARTING_SETUP.objectives],
    cards: config.cards ?? DEFAULT_CARDS,
    buildingDefs: config.buildingDefs ?? DEFAULT_ENGINE_DEFS,
    progress: config.progress,
    incomeEnabled: config.incomeEnabled,
    chronicle: config.chronicle,
    board: config.board,
    economy: config.economy,
    crateContents: config.crateContents,
  });
  const personaId = STARTING_SETUP.personas[0];
  if (personaId) g.personas.add(humanId, personaId);
  const difficulty = normalizeDifficulty(config.difficulty);
  g.automaData = {
    automaId,
    cubes: config.cubes ?? difficulty.startCubes ?? AUTOMA_CUBES,
    cubesUsed: 0,
    placements: 0,
    constructedCards: [],
    scoredObjectives: [],
    scoreEvents: 0,
    difficulty,
    vpMultiplier: difficulty.multiplier,
  };
  // Scale EVERY VP grant to the Automa (subsystems call player.addVp directly
  // for objectives/quota, so patch the player object: all its VP gains —
  // construct/crate/objective/quota — now respect the difficulty multiplier).
  const ap = g.player(automaId);
  const realAddVp = ap.addVp.bind(ap);
  ap.addVp = n => realAddVp(Math.round((n ?? 0) * g.automaData.vpMultiplier));
  return g;
}

// Which building does a placement card target? The behavior may name one; if
// the default is used, fall back to the first building (in board order) that
// is free of a HUMAN worker — the Automa never bumps a player's worker.
function pickAutomaTarget(state, behavior, humanId, automaId) {
  const candidates = state.board.commonsBuildings().concat(state.board.constructedBuildings());
  const noHuman = candidates.filter(b => state.board.workerAt(b.cell) !== humanId);
  if (noHuman.length === 0) return null;
  if (behavior.buildingId && behavior.buildingId !== "treasury") {
    const exact = noHuman.find(b => b.buildingId === behavior.buildingId);
    if (exact) return exact;
  }
  return noHuman[0];
}

// Find a constructed building card (cbldg-*) carrying crate number n that has
// not yet been unlocked, so the Automa can "unlock crate n" like a player.
function constructedCardWithCrate(state, crateNumber) {
  for (const card of Object.values(state.cards ?? {})) {
    if (card.type !== CARD_TYPES.CONSTRUCTED_BUILDING) continue;
    if (card.crateNumber !== crateNumber) continue;
    if (state.crates.isUnlocked(card.id)) continue;
    return card.id;
  }
  return null;
}

function automaPlayer(state, automaId) {
  return state.player(automaId);
}

// Execute one behavior descriptor against the live state. Pure-ish: reads
// state, writes only the subsystems a real Automa turn would touch, and never
// throws on a failed sub-action (each failure becomes a log note). Returns
// {ok, actions:[{name,detail}]}.
export function execAutomaBehavior(state, behavior, ctx = {}) {
  const automaId = ctx.automaId ?? AUTOMA_ID;
  const humanId = ctx.humanId ?? "P1";
  const data = state.automaData ?? { cubes: AUTOMA_CUBES, cubesUsed: 0, placements: 0, constructedCards: [], scoredObjectives: [], scoreEvents: 0, vpMultiplier: 1, difficulty: normalizeDifficulty() };
  const p = automaPlayer(state, automaId);
  const actions = [];
  const note = (name, detail = "") => actions.push({ name, detail: String(detail) });
  const addVp = n => {
    if (n <= 0) return;
    p.addVp(Math.round(n));
    data.scoreEvents += 1;
  };
  const missed = () => data.difficulty && data.difficulty.misses && state.turns && state.turns.turnsTaken() % 4 === 0;

  switch (behavior.action) {
    case "setup": {
      data.cubes = behavior.cubes ?? data.cubes;
      note("setup", "cubes=" + data.cubes);
      break;
    }
    case "place": {
      if (data.cubesUsed >= data.cubes) { note("place", "no-cubes-available"); break; }
      const target = pickAutomaTarget(state, behavior, humanId, automaId);
      if (behavior.buildingId && behavior.buildingId !== "treasury") {
        const named = state.board.commonsBuildings().concat(state.board.constructedBuildings())
          .find(b => b.buildingId === behavior.buildingId);
        if (named && state.board.workerAt(named.cell) === humanId) note("no-bump", behavior.buildingId);
      }
      if (!target) { note("place", "no-target"); break; }
      state.board.placeWorker(target.cell, automaId);
      data.cubesUsed += 1;
      data.placements += 1;
      const def = state.engine.defs[target.buildingId];
      const vp = def && def.vp ? def.vp : 0;
      addVp(vp);
      note("place", target.buildingId + "@" + target.cell.key + (vp > 0 ? " vp=" + Math.round(vp * data.vpMultiplier) : ""));
      break;
    }
    case "retrieve": {
      const cells = state.board.workerCellsOf(automaId);
      for (const c of cells) state.board.removeWorker(c);
      if (cells.length > 0) data.cubesUsed = Math.max(0, data.cubesUsed - cells.length);
      note("retrieve", cells.length);
      break;
    }
    case "construct": {
      if (state.progress.endReached()) { note("construct", "game-ended"); break; }
      if (missed()) { note("construct", "missed"); break; }
      const cardId = behavior.buildingId ?? "bldg-mine";
      const card = state.cards ? state.cards[cardId] : null;
      if (!card || card.type !== CARD_TYPES.UNCONSTRUCTED_BUILDING) { note("construct", "no-card"); break; }
      if (data.constructedCards.includes(cardId)) { note("construct", "already-built"); break; }
      const legal = state.engine.legalConstructionCellsForPlayer(automaId);
      if (!legal || legal.length === 0) { note("construct", "no-legal-cell"); break; }
      const cell = state.board.placeBuilding(legal[0], card.buildingId, automaId);
      data.constructedCards.push(cardId);
      state.progress.advance(TRACK_REASONS.CONSTRUCT);
      addVp(5 + (data.difficulty && data.difficulty.bonusConstruct ? 2 : 0));
      note("construct", card.buildingId + "@" + cell.key);
      break;
    }
    case "crate": {
      if (state.progress.endReached()) { note("crate", "game-ended"); break; }
      if (missed()) { note("crate", "missed"); break; }
      const cardId = constructedCardWithCrate(state, behavior.crateNumber ?? 1);
      if (!cardId) { note("crate", "no-unlocked-crate-" + (behavior.crateNumber ?? 1)); break; }
      state.crates.unlock(automaId, cardId, behavior.crateNumber ?? 1);
      state.progress.advance(TRACK_REASONS.CRATE);
      addVp(5);
      note("crate", cardId + " #" + (behavior.crateNumber ?? 1));
      break;
    }
    case "quota": {
      if (missed()) { note("quota", "missed"); break; }
      const open = state.quota.spaces().find(s => !s.occupiedBy);
      if (!open) { note("quota", "no-open-space"); break; }
      if (state.influence && state.influence.availableOf(automaId) < 1) { note("quota", "no-influence"); break; }
      state.economy.gain(automaId, { [open.commodity.type]: open.commodity.quantity });
      const res = state.quota.sell(automaId, open.id);
      note("quota", open.id + " " + (res.ok ? "vp=" + res.vpGained : res.reason));
      if (res.ok) data.scoreEvents += 1;
      break;
    }
    case "scoreObjective": {
      if (state.progress.endReached()) { note("objective", "game-ended"); break; }
      if (missed()) { note("objective", "missed"); break; }
      const o = state.objectives;
      const candidates = o.revealedIds().filter(id => o.isCompleted(id) && !o.hasScored(id, automaId));
      if (candidates.length === 0) { note("objective", "none-completed"); break; }
      if (state.influence && state.influence.availableOf(automaId) < 1) { note("objective", "no-influence"); break; }
      const res = state.engine.scoreObjective(automaId, candidates[0]);
      if (res.ok) {
        data.scoredObjectives.push(candidates[0]);
        data.scoreEvents += 1;
        note("objective", candidates[0]);
      } else {
        note("objective", res.reason);
      }
      break;
    }
    case "reputation": {
      if (missed()) { note("reputation", "missed"); break; }
      if (state.influence && state.influence.availableOf(automaId) < 1) { note("reputation", "no-influence"); break; }
      const res = state.reputation.place(automaId);
      note("reputation", res.ok ? "space=" + res.space : res.reason);
      break;
    }
    case "bump": {
      note("bump", "no-bump-per-rules");
      break;
    }
    case "income": {
      const pos = state.progress.position;
      const sp = state.progress.spaceAt(pos);
      if (sp && sp.icon === "income" && state.progress.isIncomeEnabled()) {
        state.economy.gain(automaId, { coins: 1 });
        note("income", "coins=1");
      } else {
        note("income", "no-income-trigger");
      }
      break;
    }
    case "progress": {
      if (state.progress.endReached()) { note("progress", "game-ended"); break; }
      const adv = state.progress.advance(behavior.reason && behavior.reason !== "automa" ? behavior.reason : TRACK_REASONS.NO_INFLUENCE);
      note("progress", (behavior.reason ?? "automa") + " " + (adv.ok ? "to=" + adv.position : adv.reason));
      break;
    }
    case "difficulty": {
      data.vpMultiplier = behavior.multiplier ?? data.vpMultiplier;
      note("difficulty", "multiplier=" + data.vpMultiplier);
      break;
    }
    case "scoreEndGame": {
      note("scoreEndGame", "like-player");
      break;
    }
    case "note":
    case "turn":
    case "cycle":
    case "draw": {
      note(behavior.action, behavior.note ?? "");
      break;
    }
    default:
      note("unknown", behavior.action);
  }
  return { ok: true, actions };
}

// Run one Automa turn: resolve its deck card deterministically from the turn
// count + seed, execute the behavior, then advance the turn machine with a
// PLACE action (the Automa's cube placement IS its turn, per automa-turn-order).
export function runAutomaTurn(state, ctx = {}) {
  const automaId = ctx.automaId ?? AUTOMA_ID;
  if (!state.turns || state.turns.currentPlayerId !== automaId) {
    return { ok: false, reason: "not_automa_turn", currentPlayerId: state.turns ? state.turns.currentPlayerId : null };
  }
  const p = automaPlayer(state, automaId);
  if (p && p.workers > 0) p.spendWorkers(p.workers);
  const deck = ctx.deck ?? AUTOMA_CARDS;
  const seed = Math.abs((ctx.seed ?? 0) | 0);
  // The deck cycles in order per the Automa's OWN turns (automa-deck-cycling),
  // so index by the Automa's turn count, not the global turns-taken counter
  // (which counts the human's turns too and would sample every other card).
  const automaTurns = state.turns.counts ? state.turns.counts()[automaId] ?? 0 : state.turns.turnsTaken();
  const card = deck[(seed + automaTurns) % deck.length];
  const action = automaAction(card.id, ctx);
  const exec = execAutomaBehavior(state, action.behavior, { ...ctx, automaId });
  const turn = state.turns.takeTurn(automaId, WORKER_ACTIONS.PLACE);
  return {
    ok: true,
    turn,
    cardId: card.id,
    ruleId: action.ruleId,
    behavior: action.behavior,
    actions: exec.actions,
  };
}

// ── Task 61: Automa difficulty levels ──
// Easy/normal/hard adjust the Automa's VP gains (multiplier), how many cubes
// it starts with (startCubes), how reliably it executes its scoring actions
// (misses), and a small construction edge (bonusConstruct). All effects are
// deterministic given a seed + turn count. The multiplier scales every VP the
// Automa gains (its player.addVp is patched in createSoloGame), and scoreEndGame
// totals the Automa from that accumulated VP (plus end-game reputation).
export const AUTOMA_DIFFICULTIES = Object.freeze({
  easy: { id: "easy", label: "Easy", multiplier: 0.5, startCubes: 10, misses: true, bonusConstruct: false },
  normal: { id: "normal", label: "Normal", multiplier: 1.0, startCubes: 12, misses: false, bonusConstruct: false },
  hard: { id: "hard", label: "Hard", multiplier: 1.5, startCubes: 14, misses: false, bonusConstruct: true },
});

export function normalizeDifficulty(d) {
  if (typeof d === "string") return AUTOMA_DIFFICULTIES[d] ?? AUTOMA_DIFFICULTIES.normal;
  if (d && typeof d === "object") {
    return {
      id: d.id ?? "custom",
      label: d.label ?? "Custom",
      multiplier: typeof d.multiplier === "number" ? d.multiplier : 1,
      startCubes: typeof d.startCubes === "number" ? d.startCubes : 12,
      misses: !!d.misses,
      bonusConstruct: !!d.bonusConstruct,
    };
  }
  return AUTOMA_DIFFICULTIES.normal;
}

// ── Task 60: full solo game runner ──
// Plays a complete solo game by alternating the Automa's deck turns with a
// deterministic human policy. Deterministic in (seed, rng, difficulty, deck,
// humanPolicy): two runs with identical inputs produce byte-identical games.
export function runAutomaGame(config = {}) {
  const g = createSoloGame(config);
  const humanId = config.humanId ?? "P1";
  const policy = config.humanPolicy ?? defaultHumanPolicy;
  const seed = Math.abs((config.seed ?? 0) | 0);
  const maxTurns = config.maxTurns ?? 400;
  let steps = 0;
  const errors = [];
  const turnCtx = { seed, humanId, deck: config.deck };
  const step = () => {
    if (g.turns.currentPlayerId === AUTOMA_ID) {
      const r = runAutomaTurn(g, turnCtx);
      if (!r.ok) { errors.push("automa turn failed: " + r.reason); return false; }
    } else {
      const mv = policy(g, { humanId, seed, steps });
      if (mv && !mv.res && mv.type === "skip") return false;
      if (mv && mv.res && !mv.res.ok && mv.res.reason !== "game_ended") {
        errors.push("human move failed: " + mv.res.reason);
        return false;
      }
      if (mv && mv.res && mv.res.ok) return true;
      return false;
    }
    return true;
  };
  while (steps < maxTurns && !(g.progress.endReached() && g.turns.allCountsEqual())) {
    steps++;
    if (!step()) break;
  }
  while (!g.turns.allCountsEqual() && steps < maxTurns + 100) {
    steps++;
    if (!step()) break;
  }
  const end = g.engine.endGame();
  return {
    g,
    ok: errors.length === 0 && end.ok,
    errors,
    steps,
    standings: end.ok ? end.standings : null,
    winnerIds: end.ok ? end.winnerIds : [],
  };
}

// A deterministic, reasonable solo human policy. Order of preference keeps the
// human competitive: construct a building (progress + 5 VP + tile VP), score a
// completed objective (5 VP), then reputation and Treasury as fallbacks;
// retrieves when out of workers. Never touches Math.random.
export function defaultHumanPolicy(g, ctx = {}) {
  const pid = ctx.humanId ?? "P1";
  const p = g.player(pid);
  const legal = g.engine.legalActions(pid);
  if (legal.length === 0) return { type: "skip", res: { ok: false, reason: "no_actions" } };
  if (p.workers < 1) return { type: "retrieve", res: g.engine.retrieveWorkers(pid) };
  const influence = g.influence.availableOf(pid);
  const zeppelin = g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  const grandstand = g.board.commonsBuildings().find(b => b.buildingId === "grandstand").cell;

  // 1) reputation for end-game VP (a cheap, big swing — 10/7/4 tiers; keep
  // 4 influence in reserve so construction + objective scoring stay possible)
  if (influence >= 5 && !g.reputation.isFull()) {
    const repRes = g.reputation.place(pid);
    if (repRes.ok) {
      const treasury = g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell;
      g.economy.gain(pid, { clay: 1 });
      const tRes = g.engine.placeWorker(pid, treasury, { resource: "clay" });
      if (tRes.ok) return { type: "place", res: tRes, rep: repRes };
    }
  }

  // 2) construct a unique building (progress + 5 VP + the tile's printed VP)
  if (influence >= 3 && !g.progress.endReached()) {
    const cells = g.engine.legalConstructionCellsForPlayer(pid);
    if (cells.length > 0) {
      const built = new Set(g.board.constructedBuildings().map(b => b.buildingId));
      for (const cardId of ["bldg-mine", "bldg-mill", "bldg-lumber"]) {
        const card = g.cards[cardId];
        if (!card || built.has(card.buildingId)) continue;
        // gather the printed construction resources (a simplified "gather then
        // build" policy — the human takes the needed goods from the general
        // supply like it had been visiting the resource buildings).
        g.economy.gain(pid, { ...(card.constructionCost ?? {}) });
        try { g.player(pid).removeCard("cbldg-" + card.buildingId); } catch (e) { /* not held */ }
        try { g.player(pid).gainCard(cardId); } catch (e) { /* already held */ }
        if (!g.player(pid).hasCard(cardId)) continue;
        const res = g.engine.placeWorker(pid, zeppelin, { cardId, constructionCell: cells[0].key });
        if (res.ok) return { type: "place", res };
      }
    }
  }

  // 2) score a completed unscored objective (5 VP + progress advance)
  if (influence >= 1 && !g.progress.endReached()) {
    const done = g.objectives.revealedIds().filter(id => g.objectives.isCompleted(id) && !g.objectives.hasScored(id, pid));
    if (done.length > 0) {
      const res = g.engine.placeWorker(pid, grandstand, { objectiveId: done[0] });
      if (res.ok) return { type: "place", res };
    }
  }

  // 3) fall back to the Treasury ($1 per clay)
  g.economy.gain(pid, { clay: 1 });
  const treasury = g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell;
  const res2 = g.engine.placeWorker(pid, treasury, { resource: "clay" });
  if (res2.ok) return { type: "place", res: res2 };
  return { type: "retrieve", res: g.engine.retrieveWorkers(pid) };
}
