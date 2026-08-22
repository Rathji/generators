// src/automa.test.js — Task 44 Automa rulebook validation.
// Run in-page via ?test=automa, or programmatically via window.__loadAutomaTests().
// Task 44: the solo bot's deck-driven rules transcribe as structured,
// executable behavior data. Every REQUIRED_AUTOMA_RULES id must be represented
// by an AUTOMA_RULES entry with a `behave` function, every Automa card must
// map to a known rule, and resolving a turn must be deterministic given a
// state + seed. NOTE: the Automa rulebook is a SEPARATE printed book not in
// the starting rulebook mirror, so the entries are PROVISIONAL but follow the
// published Automa design (deck-driven, cube-based, never bumps players).

import {
  AUTOMA_RULES, AUTOMA_VERSION, REQUIRED_AUTOMA_RULES, AUTOMA_CARDS,
  ruleById, cardById, automaAction, resolveAutomaTurn,
  createSoloGame, execAutomaBehavior, runAutomaTurn, AUTOMA_ID, AUTOMA_CUBES,
  AUTOMA_DIFFICULTIES, normalizeDifficulty, runAutomaGame, defaultHumanPolicy,
} from "./automa.js";
import { createProgressTrack } from "./progress.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function scriptedHumanMove(g, humanId = "P1") {
  const pid = humanId;
  const p = g.player(pid);
  if (g.engine.legalActions(pid).length === 0) return { type: "skip", res: { ok: false, reason: "no_actions" } };
  if (p.workers < 1) return { type: "retrieve", res: g.engine.retrieveWorkers(pid) };
  const legal = g.engine.legalConstructionCellsForPlayer(pid);
  if (legal.length > 0 && g.influence.availableOf(pid) >= 3 && !g.progress.endReached()) {
    try { g.player(pid).removeCard("cbldg-mine"); } catch (e) { /* not held */ }
    try { g.player(pid).gainCard("bldg-mine"); } catch (e) { /* already held */ }
    if (g.player(pid).hasCard("bldg-mine")) {
      g.economy.gain(pid, { ...(g.cards["bldg-mine"].constructionCost ?? {}) });
      const zeppelin = g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
      const res = g.engine.placeWorker(pid, zeppelin, { cardId: "bldg-mine", constructionCell: legal[0].key });
      if (res.ok) return { type: "place", res };
    }
  }
  g.economy.gain(pid, { clay: 1 });
  const treasury = g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell;
  const res2 = g.engine.placeWorker(pid, treasury, { resource: "clay" });
  if (res2.ok) return { type: "place", res: res2 };
  return { type: "retrieve", res: g.engine.retrieveWorkers(pid) };
}

export function runAutomaTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── every required rule is a behavior entry ──
  ok("every required Automa rule is represented by a behavior entry",
    REQUIRED_AUTOMA_RULES.every(id => {
      const r = ruleById(id);
      return !!r && typeof r.behave === "function" && typeof r.rule === "string" && r.rule.length > 0;
    }));
  ok("required rules are exactly the transcribed rule set",
    REQUIRED_AUTOMA_RULES.length === AUTOMA_RULES.length &&
    new Set(REQUIRED_AUTOMA_RULES).size === AUTOMA_RULES.length &&
    REQUIRED_AUTOMA_RULES.every(id => AUTOMA_RULES.some(r => r.id === id)));
  ok("rule ids are unique", new Set(AUTOMA_RULES.map(r => r.id)).size === AUTOMA_RULES.length);
  ok("the rules span the setup, turn, and scoring phases",
    ["setup", "turn", "scoring"].every(phase => AUTOMA_RULES.some(r => r.phase === phase)));
  ok("the Automa rulebook is versioned", AUTOMA_VERSION === 1);

  // ── deck-driven structure ──
  ok("every Automa card maps to a known rule and resolves to a behavior",
    AUTOMA_CARDS.every(c => !!ruleById(c.action) && !!c.id && !!c.name && automaAction(c.id, {}).ok));
  ok("the deck exercises placement, construction, retrieval, crates, quota, objectives, reputation, and income",
    ["automa-place", "automa-construct", "automa-retrieve", "automa-crate", "automa-quota", "automa-objective", "automa-reputation", "automa-income"]
      .every(ruleId => AUTOMA_CARDS.some(c => c.action === ruleId)));

  // ── behaviors are executable & deterministic ──
  const a = automaAction("auto-01", { seed: 7 });
  ok("resolving an Automa card returns its rule's behavior",
    a.ok && a.ruleId === "automa-place" && a.behavior.action === "place" && a.behavior.buildingId === "treasury");
  ok("an unknown Automa card is rejected", !automaAction("auto-99", {}).ok && automaAction("auto-99", {}).reason === "no_such_card");
  ok("an unknown card id is rejected by the lookup", cardById("auto-99") === null && cardById("auto-01").id === "auto-01");

  let det = true;
  for (let s = 0; s < 24; s++) {
    const x = resolveAutomaTurn({ seed: s });
    const y = resolveAutomaTurn({ seed: s, state: null, playerId: "A" });
    if (JSON.stringify(x) !== JSON.stringify(y)) det = false;
  }
  ok("an Automa turn is deterministic given a state + seed (whole deck)", det);
  ok("the drawn card follows the seed deterministically",
    resolveAutomaTurn({ seed: 3 }).cardId === AUTOMA_CARDS[3 % AUTOMA_CARDS.length].id &&
    resolveAutomaTurn({ seed: 3 }).ok);
  ok("every turn resolves to a known rule behavior",
    AUTOMA_CARDS.every(c => resolveAutomaTurn({ seed: AUTOMA_CARDS.indexOf(c) }).ruleId === c.action));

  // ── Task 59: the Automa bot core ──
  const solo = createSoloGame({ rng: lcg(7), difficulty: { multiplier: 1 } });
  ok("a solo game has exactly the human and the Automa, with the Automa on its own charter",
    solo.playerIds().length === 2 && solo.playerIds().includes("P1") && solo.playerIds().includes(AUTOMA_ID) &&
    solo.turns.playerCharter(AUTOMA_ID) === 1);
  ok("the Automa starts with no workers and a cube pool", solo.player(AUTOMA_ID).workers === 0 &&
    solo.automaData.cubes === AUTOMA_CUBES && solo.automaData.cubesUsed === 0);
  const notAutoma = runAutomaTurn(solo, { seed: 1 });
  ok("runAutomaTurn refuses to act off-turn", !notAutoma.ok && notAutoma.reason === "not_automa_turn");

  const placeAction = automaAction("auto-01", { seed: 1 });
  const exec = execAutomaBehavior(solo, placeAction.behavior, { seed: 1 });
  ok("a place behavior resolves into executed actions", exec.ok && exec.actions.length >= 1);
  ok("a placement records a cube on the board", solo.automaData.placements === 1 && solo.automaData.cubesUsed === 1);

  const solo2 = createSoloGame({ rng: lcg(7) });
  for (const b of solo2.board.commonsBuildings()) solo2.board.placeWorker(b.cell, "P1");
  const exec2 = execAutomaBehavior(solo2, placeAction.behavior, { seed: 1, humanId: "P1" });
  ok("the Automa never bumps a human worker (it skips occupied buildings)",
    exec2.actions.some(a => String(a.detail).includes("no-target")) && solo2.automaData.placements === 0);
  ok("a retrieve behavior returns the Automa's cubes to its supply",
    (() => {
      const s3 = createSoloGame({ rng: lcg(7) });
      const t = s3.board.commonsBuildings()[0].cell;
      s3.board.placeWorker(t, AUTOMA_ID);
      s3.automaData.cubesUsed = 1;
      const r3 = execAutomaBehavior(s3, { action: "retrieve" }, {});
      return r3.ok && s3.board.workerAt(t) === null && s3.automaData.cubesUsed === 0;
    })());

  const track = createProgressTrack({ spaces: [null, null, null, null, null, "end"], startSpace: 2, incomeEnabled: false });
  const g = createSoloGame({ rng: lcg(7), progress: track, difficulty: { multiplier: 1 } });
  const humanId = "P1";
  const errors = [];
  let steps = 0;
  let automaTurns = 0;
  try {
    while (steps < 300 && !(g.progress.endReached() && g.turns.allCountsEqual())) {
      steps++;
      if (g.turns.currentPlayerId === AUTOMA_ID) {
        const r = runAutomaTurn(g, { seed: 0, humanId });
        automaTurns++;
        if (!r.ok) { errors.push("automa turn failed: " + r.reason); break; }
        if (!r.turn.ok) { errors.push("automa turn machine refused: " + r.turn.reason); break; }
      } else {
        const mv = scriptedHumanMove(g, humanId);
        if (mv.type !== "skip" && mv.res && !mv.res.ok && mv.res.reason !== "game_ended") {
          errors.push("human move failed: " + mv.res.reason);
          break;
        }
      }
    }
    while (!g.turns.allCountsEqual() && steps < 400) {
      steps++;
      if (g.turns.currentPlayerId === AUTOMA_ID) {
        runAutomaTurn(g, { seed: 0, humanId });
      } else {
        scriptedHumanMove(g, humanId);
      }
    }
  } catch (e) {
    errors.push("exception: " + e.message);
  }
  ok("a full seeded solo game completes without rule violations", errors.length === 0, errors.join(" | "));
  ok("the progress token reaches the end", g.progress.endReached());
  const end = g.engine.endGame();
  ok("end-game scoring runs for both players", end.ok && end.standings.length === 2, end.reason ?? "");
  ok("the Automa scores VP from its actions", g.player(AUTOMA_ID).vp > 0, "vp=" + g.player(AUTOMA_ID).vp);
  ok("the Automa placed cubes on the board", g.automaData.placements > 0, "placements=" + g.automaData.placements);
  ok("the Automa's deck drove multiple turns", automaTurns >= 2, "turns=" + automaTurns);
  ok("the Automa never ended with phantom workers", g.player(AUTOMA_ID).workers === 0);

  // ── Task 60: Automa construction & interaction ──
  const shortTrack = () => createProgressTrack({ spaces: [null, null, null, null, null, "end"], startSpace: 2, incomeEnabled: false });
  const mk60 = () => createSoloGame({ rng: lcg(11), difficulty: "normal", progress: shortTrack() });

  {
    const a = mk60();
    const b = mk60();
    const runBoth = st => {
      let steps = 0;
      while (steps < 300 && !(st.progress.endReached() && st.turns.allCountsEqual())) {
        steps++;
        if (st.turns.currentPlayerId === AUTOMA_ID) runAutomaTurn(st, { seed: 3 });
        else scriptedHumanMove(st);
      }
      while (!st.turns.allCountsEqual() && steps < 400) {
        steps++;
        if (st.turns.currentPlayerId === AUTOMA_ID) runAutomaTurn(st, { seed: 3 });
        else scriptedHumanMove(st);
      }
    };
    runBoth(a); runBoth(b);
    const stripAt = json => { const o = JSON.parse(json); (o.log || []).forEach(e => delete e.at); return JSON.stringify(o); };
    const sa = stripAt(a.serialize()); const sb = stripAt(b.serialize());
    ok("two identical seeded solo games produce identical states (Task 60 determinism)", sa === sb);
    const consA = a.board.constructedBuildings().map(x => x.buildingId).sort();
    const consB = b.board.constructedBuildings().map(x => x.buildingId).sort();
    ok("the Automa constructs buildings identically across identical seeds",
      JSON.stringify(consA) === JSON.stringify(consB) && consA.length >= 1,
      "constructed=" + JSON.stringify(consA));
    ok("every Automa-constructed building is adjacent to its charter or another of its buildings",
      (() => {
        const mine = a.board.constructedBuildings().filter(b => a.board.ownerAt(b.cell) === AUTOMA_ID);
        if (mine.length === 0) return false;
        const charterCell = a.board.charterCell(a.turns.playerCharter(AUTOMA_ID));
        const ownedKeys = new Set(mine.map(b => b.cell.key));
        return mine.every(b =>
          a.board.isAdjacent(b.cell, charterCell) ||
          mine.some(o => o !== b && a.board.isAdjacent(b.cell, o.cell)));
      })(),
      "owners=" + JSON.stringify(a.board.constructedBuildings().map(b => a.board.ownerAt(b.cell))));
  }

  ok("AUTOMA_DIFFICULTIES ships easy/normal/hard with ordered multipliers",
    AUTOMA_DIFFICULTIES.easy.multiplier < AUTOMA_DIFFICULTIES.normal.multiplier &&
    AUTOMA_DIFFICULTIES.normal.multiplier < AUTOMA_DIFFICULTIES.hard.multiplier &&
    AUTOMA_DIFFICULTIES.easy.misses === true && AUTOMA_DIFFICULTIES.hard.misses === false &&
    AUTOMA_DIFFICULTIES.hard.bonusConstruct === true);
  ok("normalizeDifficulty handles strings, objects, and unknown values",
    normalizeDifficulty("easy") === AUTOMA_DIFFICULTIES.easy &&
    normalizeDifficulty("hard").id === "hard" &&
    normalizeDifficulty({ multiplier: 2, misses: true }).multiplier === 2 &&
    normalizeDifficulty({ multiplier: 2, misses: true }).misses === true &&
    normalizeDifficulty("nope") === AUTOMA_DIFFICULTIES.normal &&
    normalizeDifficulty(undefined) === AUTOMA_DIFFICULTIES.normal);
  {
    const s = createSoloGame({ rng: lcg(5), difficulty: "hard" });
    ok("createSoloGame wires the difficulty into automaData (Task 61)",
      s.automaData.difficulty.id === "hard" && s.automaData.vpMultiplier === AUTOMA_DIFFICULTIES.hard.multiplier,
      "mult=" + s.automaData.vpMultiplier);
    ok("the hard Automa starts with more cubes than easy",
      createSoloGame({ rng: lcg(1), difficulty: "easy" }).automaData.cubes < s.automaData.cubes,
      "easy=" + createSoloGame({ rng: lcg(1), difficulty: "easy" }).automaData.cubes + " hard=" + s.automaData.cubes);
  }
  {
    // no-bump: a named building the human occupies is never bumped; the Automa
    // targets another building instead (rule automa-bump-protection)
    const s = createSoloGame({ rng: lcg(5), difficulty: "normal", progress: shortTrack() });
    const market = s.board.commonsBuildings().find(b => b.buildingId === "market").cell;
    s.board.placeWorker(market, "P1");
    const exec = execAutomaBehavior(s, { action: "place", buildingId: "market" }, { humanId: "P1", seed: 1 });
    ok("the Automa never bumps a human worker on a named building (no-bump)",
      exec.actions.some(a => a.name === "no-bump") &&
      s.board.workerAt(market) === "P1" &&
      !exec.actions.some(a => a.name === "place" && String(a.detail).includes("market")),
      JSON.stringify(exec.actions));
  }
  {
    // interaction: the Automa uses the engine's shared tracks/objectives/quota
    const s = createSoloGame({ rng: lcg(7), difficulty: "normal", progress: shortTrack() });
    scriptedHumanMove(s);
    const r1 = runAutomaTurn(s, { seed: 0 });
    ok("an Automa turn executes against the real engine subsystems",
      r1.ok && Array.isArray(r1.actions) && r1.actions.length >= 1 && r1.turn.ok,
      r1.ok ? "" : r1.reason);
  }
  {
    // full-game runner is deterministic end to end
    const a = runAutomaGame({ rng: lcg(9), seed: 9, difficulty: "normal", progress: shortTrack(), maxTurns: 300 });
    const b = runAutomaGame({ rng: lcg(9), seed: 9, difficulty: "normal", progress: shortTrack(), maxTurns: 300 });
    ok("runAutomaGame is deterministic given identical inputs (Task 60)",
      a.ok && b.ok && JSON.stringify(a.standings) === JSON.stringify(b.standings) &&
      JSON.stringify(a.winnerIds) === JSON.stringify(b.winnerIds) && a.steps === b.steps);
    ok("the solo runner produces valid end-game standings for both players",
      a.ok && a.standings.length === 2 && a.winnerIds.length >= 1);
  }

  // ── Task 61: Automa difficulty win rates ──
  {
    const mkTrack = () => createProgressTrack({ spaces: [null, null, null, null, null, null, null, "end"], startSpace: 2, incomeEnabled: false });
    const sample = (difficulty, baseSeed) => {
      let wins = 0, ok = 0;
      for (let i = 0; i < 40; i++) {
        const r = runAutomaGame({ rng: lcg(baseSeed + i), seed: baseSeed + i, difficulty, progress: mkTrack(), maxTurns: 300 });
        if (r.ok) { ok++; if (r.winnerIds.includes("P1")) wins++; }
      }
      return { wins, ok };
    };
    const easy = sample("easy", 5000);
    const normal = sample("normal", 5200);
    const hard = sample("hard", 5400);
    ok("human win rate rises monotonically from hard to easy across 100 seeded solo games",
      easy.wins >= normal.wins && normal.wins >= hard.wins && easy.wins > hard.wins,
      "easy=" + easy.wins + "/" + easy.ok + " normal=" + normal.wins + "/" + normal.ok + " hard=" + hard.wins + "/" + hard.ok);
    ok("every sampled difficulty game completes (no stalls)",
      easy.ok === 40 && normal.ok === 40 && hard.ok === 40,
      "easy=" + easy.ok + " normal=" + normal.ok + " hard=" + hard.ok);
  }

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "automa", pass, fail, results };
}
