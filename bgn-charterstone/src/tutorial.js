// src/tutorial.js — Phase 14 learn-as-you-play onboarding (Task 69).
// An interactive Game-1 walkthrough: setup, first turn (place + retrieve)
// and first construction, driving the REAL engine APIs at every step so
// the player learns the exact rules by doing them. Each step exposes an
// `action(tutorial)` that performs the engine call and returns {ok, detail}
// — the test suite drives every action and requires every one to succeed.

import { createGameState } from "./serialization.js";
import { DEFAULT_CARDS } from "./cards.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { STARTING_SETUP } from "./indexGuide.js";

export const TUTORIAL_VERSION = 1;

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A deterministic single-player Game-1 state primed for the walkthrough:
// P1 starts on turn with 4 coins, one of each construction resource for the
// Mine, one clay to pay the Treasury placement, and the Mine card in hand so
// the first construction is always legal.
export function createTutorialGame(opts = {}) {
  const g = createGameState({
    players: [{ id: "P1", charterId: 0, startingCoins: 4 }],
    firstPlayer: "P1",
    rng: opts.rng ?? lcg(opts.seed ?? 1),
    advancementConfig: { deck: [...STARTING_SETUP.advancementDeck] },
    objectivesConfig: [...STARTING_SETUP.objectives],
    cards: DEFAULT_CARDS,
    buildingDefs: DEFAULT_ENGINE_DEFS,
  });
  const personaId = STARTING_SETUP.personas[0];
  if (personaId) g.personas.add("P1", personaId);
  g.economy.gain("P1", { coal: 1, wood: 1, grain: 1, pumpkin: 1, clay: 1 });
  g.player("P1").gainCard("bldg-mine");
  return g;
}

function commonsCell(state, buildingId) {
  const b = state.board.commonsBuildings().find(x => x.buildingId === buildingId);
  return b ? b.cell : null;
}

function charterNames() {
  return ["Greengully", "Cinderhaven", "Whisperwood", "Goldreach", "Stormwatch", "Oakhollow"];
}

export function createTutorial(state, config = {}) {
  const container = config.container ?? document.body;
  const onStepChange = config.onStepChange ?? (() => {});
  const onResult = config.onResult ?? (() => {});
  let current = 0;
  const log = [];

  const steps = [
    {
      id: "setup",
      title: "1 · Welcome to Charterstone",
      body:
        "<p>Greengully is yours to build. The board shows <b>6 charters</b> around a central hex — The Commons — where every worker may go.</p>" +
        "<p>You are <b>Greengully</b>, starting with 4 coins and 2 workers. On the rails around the board live your <b>reputation</b>, <b>quota</b>, and the shared <b>progress</b> track; the <b>objectives</b> panel reveals your first goal.</p>" +
        "<p>Your hand already holds the <b>Mine card</b> plus the four resources (coal, wood, grain, pumpkin) it takes to build it. The engine has set up your board and placed you on turn.</p>",
      hint: "Press “I'm ready” — the engine confirms a legal action is available on your first turn.",
      action: async t => {
        const preview = state.engine.checkPlace("P1", commonsCell(state, "treasury"));
        return preview && preview.ok === true
          ? { ok: true, detail: "Treasury placement is legal — the action flow is live." }
          : { ok: false, detail: "checkPlace failed: " + (preview && preview.reason) };
      },
    },
    {
      id: "firstPlace",
      title: "2 · Your first turn — place a worker",
      body:
        "<p>On your turn you place one worker on an empty building slot. Placing is free unless the building charges a cost, and if another worker already sits there you <b>bump</b> it home — bumping never happens in the tutorial, but it is a real rule.</p>" +
        "<p>Watch the <b>Treasury</b> in the centre of the board. It accepts <b>any one resource</b> and pays you <b>1 coin</b>. You brought a spare clay to cover it.</p>",
      hint: "Press “Place at the Treasury” — the engine places your worker and pays you 1 coin.",
      action: async t => {
        const res = state.engine.placeWorker("P1", commonsCell(state, "treasury"), { resource: "clay" });
        return res && res.ok === true
          ? { ok: true, detail: "Worker placed at the Treasury (+1 coin)." }
          : { ok: false, detail: "placeWorker failed: " + (res && res.reason) };
      },
    },
    {
      id: "retrieve",
      title: "3 · Retrieving your workers",
      body:
        "<p>Workers stay where you put them until you <b>retrieve</b> them all — a free action you may take whenever you like. With both workers home again, you are ready to place again.</p>" +
        "<p>Retrieval is how a round winds down: place workers, retrieve, and repeat until the village is built.</p>",
      hint: "Press “Retrieve workers” — the engine calls the real retrieveWorkers API.",
      action: async t => {
        const res = state.engine.retrieveWorkers("P1");
        return res && res.ok === true && res.retrieved >= 1
          ? { ok: true, detail: "Retrieved " + res.retrieved + " worker(s)." }
          : { ok: false, detail: "retrieveWorkers failed: " + (res && res.reason) };
      },
    },
    {
      id: "construct",
      title: "4 · Build your first Mine",
      body:
        "<p>Construction is the heart of Charterstone. Place a worker at the <b>Zeppelin</b>, spend your Mine card and its four resources, and the Mine becomes a permanent new action on the board.</p>" +
        "<p>Buildings must be constructed on an empty hex <b>adjacent to your charter</b> (or a building you own). Construction also costs 3 influence from your personal pool.</p>",
      hint: "Press “Construct the Mine” — the engine picks a legal adjacent cell and runs the real construction path.",
      action: async t => {
        const legal = state.engine.legalConstructionCellsForPlayer("P1");
        if (!legal.length) return { ok: false, detail: "no legal construction cells" };
        const res = state.engine.placeWorker("P1", commonsCell(state, "zeppelin"), {
          cardId: "bldg-mine",
          constructionCell: legal[0].key,
        });
        return res && res.ok === true
          ? { ok: true, detail: "Mine constructed on " + res.cell + " (+5 VP)." }
          : { ok: false, detail: "construction failed: " + (res && res.reason) };
      },
    },
    {
      id: "done",
      title: "5 · You're ready to play",
      body:
        "<p>You have placed, retrieved, and built — the full loop. Your Mine now stands on the board, ready for any player to visit, and its leftover card sits in your supply.</p>" +
        "<p>From here the campaign begins for real: game 1 starts every player in the same position you just learned.</p>",
      hint: "Press “Finish” — the engine verifies your Mine is on the board.",
      action: async t => {
        const built = state.board.constructedBuildings().some(b => b.buildingId === "mine" && b.ownerId === "P1");
        return built ? { ok: true, detail: "The Mine stands on the board." } : { ok: false, detail: "Mine not found" };
      },
    },
  ];

  const tutorial = {
    version: TUTORIAL_VERSION,
    state,
    steps,
    log,
    charterNames: charterNames(),
    get currentIndex() { return current; },
    get finished() { return current >= steps.length; },
    currentStep() { return steps[Math.min(current, steps.length - 1)]; },
    async advance() {
      const step = steps[Math.min(current, steps.length - 1)];
      let result;
      try { result = await step.action(tutorial); } catch (err) { result = { ok: false, detail: err && err.message ? err.message : String(err) }; }
      result = { id: step.id, ok: !!result.ok, detail: result.detail || "", ...result };
      log.push(result);
      onResult(result, step);
      if (result.ok) {
        current = Math.min(current + 1, steps.length);
        onStepChange(tutorial.currentStep(), tutorial);
      }
      return result;
    },
    restart() {
      current = 0;
      log.length = 0;
      onStepChange(tutorial.currentStep(), tutorial);
    },
    goTo(i) {
      current = Math.max(0, Math.min(steps.length - 1, i));
      onStepChange(tutorial.currentStep(), tutorial);
    },
    render() {
      if (!container) return;
      let root = container.querySelector(".cs-tutorial");
      if (!root) {
        root = document.createElement("div");
        root.className = "cs-tutorial";
        container.appendChild(root);
      }
      const step = tutorial.currentStep();
      const idx = current;
      root.innerHTML =
        '<div class="cs-tut-card">' +
          '<div class="cs-tut-progress">' + steps.map((s, i) => '<span class="cs-tut-dot' + (i <= idx ? " on" : "") + '"></span>').join("") + "</div>" +
          "<h3 class=\"cs-tut-title\">" + step.title + "</h3>" +
          '<div class="cs-tut-body">' + step.body + "</div>" +
          '<div class="cs-tut-hint">💡 ' + step.hint + "</div>" +
          '<div class="cs-tut-actions">' +
            (idx > 0 ? '<button class="btn btn-ghost cs-tut-prev" type="button">← Back</button>' : "") +
            '<button class="btn btn-gold cs-tut-do" type="button">' + (idx === steps.length - 1 ? "Finish" : "Do it") + "</button>" +
          "</div>" +
          '<div class="cs-tut-result"></div>' +
        "</div>";
      root.querySelector(".cs-tut-do").addEventListener("click", async () => {
        const btn = root.querySelector(".cs-tut-do");
        const mode = btn.dataset.mode;
        if (mode === "next") { tutorial.render(); return; }
        if (mode === "finish") { if (root.parentNode) root.parentNode.removeChild(root); return; }
        btn.disabled = true;
        btn.textContent = "…";
        const result = await tutorial.advance();
        const out = root.querySelector(".cs-tut-result");
        out.textContent = (result.ok ? "✓ " : "✗ ") + result.detail;
        out.className = "cs-tut-result " + (result.ok ? "ok" : "err");
        if (result.ok) {
          btn.dataset.mode = tutorial.finished ? "finish" : "next";
          btn.textContent = tutorial.finished ? "Finish" : "Next →";
        } else {
          delete btn.dataset.mode;
          btn.disabled = false;
          btn.textContent = "Try again";
        }
      });
      const prev = root.querySelector(".cs-tut-prev");
      if (prev) prev.addEventListener("click", () => { tutorial.goTo(idx - 1); });
      return root;
    },
  };

  return tutorial;
}

export function injectTutorialStyles() {
  if (document.getElementById("cs-tutorial-styles")) return;
  const s = document.createElement("style");
  s.id = "cs-tutorial-styles";
  s.textContent =
    ".cs-tutorial{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;background:rgba(10,9,18,.72);backdrop-filter:blur(3px)}" +
    ".cs-tut-card{width:min(560px,92vw);max-height:84vh;overflow:auto;background:#171422;border:1px solid rgba(212,175,55,.45);border-radius:14px;padding:24px;box-shadow:0 18px 60px rgba(0,0,0,.5)}" +
    ".cs-tut-progress{display:flex;gap:8px;margin-bottom:14px}" +
    ".cs-tut-dot{width:10px;height:10px;border-radius:50%;background:#3a3550;border:1px solid #55506e}" +
    ".cs-tut-dot.on{background:#d4af37;border-color:#d4af37}" +
    ".cs-tut-title{margin:0 0 10px;color:#f6e6a4;font-size:1.3rem}" +
    ".cs-tut-body{color:#e7e1d2;font-size:.95rem;line-height:1.55;margin-bottom:12px}" +
    ".cs-tut-body b{color:#fff}" +
    ".cs-tut-hint{background:#12231f;border:1px solid rgba(47,174,140,.4);color:#9fd8c4;border-radius:8px;padding:9px 12px;font-size:.85rem;margin-bottom:14px}" +
    ".cs-tut-actions{display:flex;gap:10px;justify-content:flex-end}" +
    ".cs-tut-result{margin-top:12px;font-size:.85rem}" +
    ".cs-tut-result.ok{color:#9fd8c4}" +
    ".cs-tut-result.err{color:#ff8f6b}";
  document.head.appendChild(s);
}
