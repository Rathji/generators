// src/cards.test.js — Phase 6 validation suite (Tasks 25-28).
// Run in-page via ?test=cards, or programmatically via window.__loadCardsTests().
// Task 25: advancement mat re-seed from the reshuffled discard.
// Task 26: card-type schemas + legal channels per type.
// Task 27: assistant effects fire on the owner's core functions; naming.
// Task 28: discard flow; re-seed preserves the card multiset.

import { createGameState, restoreGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS, CARD_TYPES, validateCards, cardLegalChannels } from "./cards.js";
import { createAdvancement } from "./advancement.js";

export function runCardsTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  function makeGame(overrides = {}) {
    const g = createGameState({
      players: [
        { id: "A", charterId: 0, startingCoins: 4 },
        { id: "B", charterId: 1, startingCoins: 4 },
      ],
      firstPlayer: "A",
      buildingDefs: DEFAULT_ENGINE_DEFS,
      cards: DEFAULT_CARDS,
      advancementConfig: { deck: ["asst-1", "asst-2", "asst-3", "bldg-mine", "bldg-mill", "bldg-lumber"] },
      objectivesConfig: ["obj-1", "obj-2", "obj-3"],
      ...overrides,
    });
    const commons = {};
    for (const b of g.board.commonsBuildings()) commons[b.buildingId] = b.cell;
    g.commons = commons;
    g.cellA0 = g.board.legalConstructionCellsForCharter(0)[0];
    g.cellB0 = g.board.legalConstructionCellsForCharter(1)[0];
    return g;
  }
  function zeppelinCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "zeppelin").cell;
  }
  function treasuryCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell;
  }

  // ── Task 25: advancement mat ──
  const a = createAdvancement({ deck: ["a", "b", "c", "d", "e"] });
  ok("the mat shows 5 face-up cards seeded from the deck",
    a.mat().length === 5 && a.mat().every(Boolean) && a.deckCount() === 0);
  const ga = a.gainCard("P", "a");
  ok("gaining with an empty deck and empty discard leaves the slot null",
    ga.ok && ga.replacedFrom === null && a.mat()[0] === null && a.deckCount() === 0 && a.discardCount() === 0);

  const c = createAdvancement({ deck: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"] });
  const gc = c.gainCard("P", c.mat()[0]);
  ok("gaining a card replaces it from the deck's top",
    gc.ok && gc.replacedFrom === "d6" && c.onMat("d6") && c.deckCount() === 1 && c.discardCount() === 0);

  const b = createAdvancement({ deck: ["a", "b", "c", "d", "e"] });
  for (let i = 1; i <= 5; i++) b.discard("x" + i);
  const gainedIds = [];
  for (const id of b.mat()) gainedIds.push(b.gainCard("P", id).cardId);
  ok("after 5 gains with an empty deck the mat re-seeds from the reshuffled discard with correct counts",
    gainedIds.length === 5 && b.mat().filter(Boolean).length === 5 &&
    b.deckCount() === 0 && b.discardCount() === 0 &&
    b.mat().sort().join(",") === ["x1", "x2", "x3", "x4", "x5"].sort().join(",") &&
    gainedIds.sort().join(",") === ["a", "b", "c", "d", "e"].sort().join(","));

  // ── Task 26: card-type schemas & legal channels ──
  const v = validateCards(DEFAULT_CARDS);
  ok("every content card validates (unique ids, complete fields)",
    v.ok && v.errors.length === 0 && v.count === Object.keys(DEFAULT_CARDS).length);
  ok("duplicate card ids are rejected",
    !validateCards([{ ...DEFAULT_CARDS["asst-1"] }, { ...DEFAULT_CARDS["asst-1"] }]).ok);
  ok("an objective without a condition is rejected",
    !validateCards([{ ...DEFAULT_CARDS["obj-1"], condition: undefined }]).ok);
  ok("a constructed building with a bad crate number is rejected",
    !validateCards([{ ...DEFAULT_CARDS["cbldg-1"], crateNumber: 0 }]).ok);
  ok("an unknown card type is rejected",
    !validateCards([{ ...DEFAULT_CARDS["asst-1"], type: "gizmo" }]).ok);
  ok("each card type parses from content data",
    Object.values(CARD_TYPES).every(t => Object.values(DEFAULT_CARDS).some(c => c.type === t)));
  ok("legal channels match each type",
    cardLegalChannels(DEFAULT_CARDS["bldg-mine"]).join(",") === "construct" &&
    cardLegalChannels(DEFAULT_CARDS["cbldg-1"]).join(",") === "crate_unlock" &&
    cardLegalChannels(DEFAULT_CARDS["cbldg-2"]).length === 0 &&
    cardLegalChannels(DEFAULT_CARDS["asst-2"]).join(",") === "assist" &&
    cardLegalChannels(DEFAULT_CARDS["obj-1"]).join(",") === "score" &&
    cardLegalChannels(DEFAULT_CARDS["persona-1"]).join(",") === "persona");
  const gLeg = makeGame();
  gLeg.player("A").gainCard("obj-1");
  gLeg.economy.gain("A", { coal: 1, wood: 1, grain: 1, pumpkin: 1 });
  const rLeg = gLeg.engine.placeWorker("A", zeppelinCell(gLeg), { cardId: "obj-1", constructionCell: gLeg.cellA0 });
  ok("an objective card is not constructable (legal channels enforced)",
    !rLeg.ok && rLeg.reason === "not_constructable");

  // ── Task 27: assistant effects & naming ──
  const g = makeGame();
  g.player("A").gainCard("asst-2");
  g.player("A").gainCard("bldg-mill");
  g.economy.gain("A", { wood: 2, clay: 1 });
  const rA = g.engine.placeWorker("A", zeppelinCell(g), { cardId: "bldg-mill", constructionCell: g.cellA0 });
  ok("a 'gain 1 coin on construction' assistant fires on the owner's construction",
    rA.ok && g.player("A").coins() === 5 &&
    rA.assistants.some(x => x.cardId === "asst-2" && x.trigger === "construct" && x.granted.coins === 1));
  g.player("B").gainCard("bldg-lumber");
  g.economy.gain("B", { wood: 1, pumpkin: 1 });
  const rB = g.engine.placeWorker("B", zeppelinCell(g), { cardId: "bldg-lumber", constructionCell: g.cellB0 });
  ok("the assistant does NOT fire on another player's constructions",
    rB.ok && g.player("A").coins() === 5 && rB.assistants.length === 0);
  g.economy.gain("A", { clay: 1 });
  const rT = g.engine.placeWorker("A", treasuryCell(g), { resource: "clay" });
  ok("the assistant does NOT fire on unrelated actions (only the Treasury's own $1)",
    rT.ok && g.player("A").coins() === 6 && !rT.assistants.some(x => x.cardId === "asst-2"));

  const gM = makeGame();
  gM.player("A").gainCard("asst-3");
  gM.economy.gain("A", { clay: 1 });
  const rM = gM.engine.placeWorker("A", treasuryCell(gM), { resource: "clay" });
  ok("a 'gain 1 coin on Treasury' assistant fires when the owner uses the Treasury",
    rM.ok && rM.assistants.some(x => x.cardId === "asst-3" && x.trigger === "treasury" && x.granted.coins === 1) &&
    gM.player("A").coins() === 6);

  const gN = makeGame();
  ok("unnamed assistants may be named",
    gN.assistants.name("asst-1", "Boss").ok && gN.assistants.nameOf("asst-1") === "Boss" &&
    gN.assistants.isNamed("asst-1"));
  ok("named (printed-name) assistants cannot be renamed",
    !gN.assistants.name("asst-2", "Bob").ok && gN.assistants.name("asst-2", "Bob").reason === "not_unnamed");
  ok("naming a non-assistant card is rejected",
    !gN.assistants.name("bldg-mine", "x").ok && gN.assistants.name("bldg-mine", "x").reason === "not_assistant");
  const gN2 = restoreGameState(JSON.parse(gN.serialize()));
  ok("assistant names survive serialize→restore", gN2.assistants.nameOf("asst-1") === "Boss");

  // ── Task 28: discard flow ──
  const d = createAdvancement({ deck: ["d1", "d2", "d3", "d4", "d5"] });
  d.discard("y1"); d.discard("y2"); d.discard("y3");
  ok("discarded cards enter the discard pile",
    d.discardCount() === 3 && d.deckCount() === 0 && !d.onMat("y1"));
  ok("no re-seed while the deck still has cards",
    (() => {
      const d2 = createAdvancement({ deck: ["a", "b", "c", "d", "e", "f"] });
      d2.discard("z");
      d2.seedIfEmpty();
      return d2.deckCount() === 1 && d2.discardCount() === 1;
    })());
  const e = createAdvancement({ deck: ["a", "b", "c", "d", "e"] });
  for (let i = 1; i <= 5; i++) e.discard("r" + i);
  e.seedIfEmpty();
  ok("re-seed preserves the card multiset (identity + counts)",
    e.deckCount() === 5 && e.discardCount() === 0 &&
    e.toJSON().deck.sort().join(",") === ["r1", "r2", "r3", "r4", "r5"].join(","));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "cards", pass, fail, results };
}
