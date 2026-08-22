// src/indexGuide.test.js — Phase 8 crate contents & Index Guide validation (Task 34).
// Run in-page via ?test=indexGuide, or programmatically via window.__loadIndexGuideTests().
// Task 34: each crate number maps to exact components to extract (advancement
// cards, personas, stickers) per the Index Guide; unlocking crate N adds
// exactly its listed components to the correct pools — advancement cards to
// the advancement deck, objectives to the objective pool, personas to the
// unlocking player's Charter Chest, stickers to the sticker pool.

import { createGameState, restoreGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS, CARD_TYPES } from "./cards.js";
import { CRATE_CONTENTS, crateContents, applyCrateContents, BOX_CATALOG, STARTING_SETUP, STORY_CARDS } from "./indexGuide.js";
import { reconcileCatalog } from "./campaign.js";

export function runIndexGuideTests() {
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
    return g;
  }
  function charterstoneCell(g) {
    return g.board.commonsBuildings().find(b => b.buildingId === "charterstone").cell;
  }

  // ── data integrity ──
  const entries = Object.entries(CRATE_CONTENTS);
  ok("every crate number maps to a component list",
    entries.length > 0 &&
    entries.every(([n, c]) => Number.isInteger(+n) && +n >= 1 &&
      Array.isArray(c.cardIds) && Array.isArray(c.personas) && Array.isArray(c.stories) && Array.isArray(c.stickers)));
  ok("every listed card/persona exists in the card registry with the right type",
    entries.every(([, c]) =>
      c.cardIds.every(id => !!DEFAULT_CARDS[id]) &&
      c.personas.every(id => !!DEFAULT_CARDS[id] && DEFAULT_CARDS[id].type === CARD_TYPES.PERSONA) &&
      c.stickers.every(s => typeof s === "string" && s.length > 0) &&
      c.stories.every(s => !!STORY_CARDS[s])));
  ok("every special card routed to the deck carries the special subtype",
    entries.every(([, c]) => c.cardIds.every(id =>
      DEFAULT_CARDS[id].type !== CARD_TYPES.SPECIAL || (DEFAULT_CARDS[id].subtype && typeof DEFAULT_CARDS[id].subtype === "string"))));
  ok("crateContents returns a detached copy and null for unknown crates",
    crateContents(1) !== CRATE_CONTENTS[1] &&
    JSON.stringify(crateContents(1)) === JSON.stringify(CRATE_CONTENTS[1]) &&
    crateContents(999) === null);

  // ── routing: advancement cards → deck, objectives → objective pool ──
  const g = makeGame();
  const deckBefore = g.advancement.deckCount();
  const res = applyCrateContents(g, 2, "A");
  ok("unlocking crate 2 adds exactly its listed advancement cards to the deck",
    res.ok && g.advancement.deckCount() === deckBefore + 5 &&
    g.advancement.toJSON().deck.includes("bldg-quarry") &&
    g.advancement.toJSON().deck.includes("bldg-grainery") &&
    res.added.deck.sort().join(",") ===
      ["bldg-grainery", "bldg-quarry", "spc-friend-3", "spc-guest-2", "spc-item-2"].sort().join(","));
  ok("crate personas enter the unlocking player's Charter Chest",
    res.added.personas.join(",") === "persona-4" &&
    g.personas.of("A").join(",") === "persona-4" && g.personas.of("B").length === 0);

  const g2 = makeGame();
  const r2 = applyCrateContents(g2, 3, "B");
  ok("sticker components enter the sticker pool", r2.ok && g2.stickerPool.has("rule-advanced-actions"));
  const r5 = applyCrateContents(g2, 5, "B");
  ok("objective components enter the objective pool",
    r5.ok && g2.objectivePool.all().join(",") === "obj-6" &&
    g2.personas.of("B").join(",") === "persona-6");
  const r3 = applyCrateContents(g2, 10, "B");
  ok("multi-card crates add every listed component",
    r3.ok && g2.advancement.toJSON().deck.includes("spc-item-1") &&
    g2.advancement.toJSON().deck.includes("spc-guest-1"));
  ok("an unknown crate number is rejected", !applyCrateContents(g2, 999, "A").ok);

  // ── engine path: a Charterstone unlock extracts the crate's components ──
  const gE = makeGame();
  gE.player("A").gainCard("cbldg-1");   // constructed card with crate 1
  const rE = gE.engine.placeWorker("A", charterstoneCell(gE), { cardId: "cbldg-1" });
  ok("a Charterstone unlock extracts the crate's components into the correct pools",
    rE.ok && rE.benefit.contents && rE.benefit.contents.ok &&
    rE.benefit.contents.added.personas.join(",") === "persona-3" &&
    gE.personas.of("A").join(",") === "persona-3" &&
    gE.advancement.toJSON().deck.includes("asst-4") &&
    gE.crates.crateOf("cbldg-1") === 1);
  const rE2 = (() => {
    gE.engine.retrieveWorkers("B");
    gE.player("A").gainCard("cbldg-grainery");
    gE.economy.gain("A", { coins: 4 });
    return gE.engine.placeWorker("A", charterstoneCell(gE), { cardId: "cbldg-grainery" });
  })();
  ok("a different crate (2) routes its distinct components", rE2.ok &&
    gE.personas.of("A").join(",") === "persona-3,persona-4" &&
    gE.advancement.toJSON().deck.includes("bldg-quarry"));

  // ── serialization round-trip ──
  const gS = makeGame();
  applyCrateContents(gS, 5, "B");
  const gS2 = restoreGameState(JSON.parse(gS.serialize()));
  ok("persona/sticker/objective/story pools survive serialize→restore",
    JSON.stringify(gS2.personas.toJSON()) === JSON.stringify(gS.personas.toJSON()) &&
    JSON.stringify(gS2.stickerPool.toJSON()) === JSON.stringify(gS.stickerPool.toJSON()) &&
    JSON.stringify(gS2.objectivePool.toJSON()) === JSON.stringify(gS.objectivePool.toJSON()) &&
    JSON.stringify(gS2.storyPool.toJSON()) === JSON.stringify(gS.storyPool.toJSON()) &&
    gS2.personas.of("B").join(",") === "persona-6" && gS2.objectivePool.all().join(",") === "obj-6");

  // ── Task 42: crate contents sum to the box contents catalog ──
  function countCrateComponents() {
    const counts = {
      assistants: 0, unconstructed: 0, personas: 0, objectives: 0,
      friends: 0, items: 0, guests: 0, treasures: 0, guideposts: 0, companions: 0,
      stories: 0, stickers: 0, cards: 0,
    };
    for (const c of Object.values(CRATE_CONTENTS)) {
      counts.cards += c.cardIds.length;
      counts.personas += c.personas.length;
      counts.stories += c.stories.length;
      counts.stickers += c.stickers.length;
      for (const id of c.cardIds) {
        const card = DEFAULT_CARDS[id];
        if (!card) continue;
        if (card.type === CARD_TYPES.ASSISTANT) counts.assistants++;
        else if (card.type === CARD_TYPES.UNCONSTRUCTED_BUILDING) counts.unconstructed++;
        else if (card.type === CARD_TYPES.OBJECTIVE) counts.objectives++;
        else if (card.type === CARD_TYPES.SPECIAL) {
          if (id.startsWith("spc-friend-")) counts.friends++;
          else if (id.startsWith("spc-item-")) counts.items++;
          else if (id.startsWith("spc-guest-")) counts.guests++;
          else if (id.startsWith("spc-treasure-")) counts.treasures++;
          else if (id.startsWith("spc-guidepost")) counts.guideposts++;
          else if (id.startsWith("spc-companion-")) counts.companions++;
        }
      }
    }
    return counts;
  }
  const cat = BOX_CATALOG.cards;
  const c = countCrateComponents();
  const startDeck = STARTING_SETUP.advancementDeck;
  const startAssts = startDeck.filter(id => DEFAULT_CARDS[id].type === CARD_TYPES.ASSISTANT).length;
  const startBldgs = startDeck.filter(id => DEFAULT_CARDS[id].type === CARD_TYPES.UNCONSTRUCTED_BUILDING).length;
  ok("crates + starting setup account for all 8 assistants",
    c.assistants + startAssts === cat.assistants && startAssts === 3 && c.assistants === 5);
  ok("crates + starting setup account for all 12 unconstructed buildings",
    c.unconstructed + startBldgs === 12 && startBldgs === 3 && c.unconstructed === 9);
  ok("crates + starting setup account for all 8 personas",
    c.personas + STARTING_SETUP.personas.length === cat.personas && c.personas === 6);
  ok("crates + starting setup account for all 8 objectives",
    c.objectives + STARTING_SETUP.objectives.length === cat.objectives && c.objectives === 5);
  ok("crates carry all 12 friends", c.friends === cat.friends);
  ok("crates carry all 12 items", c.items === cat.items);
  ok("crates carry all 12 guests", c.guests === cat.guests);
  ok("crates carry all 15 treasures", c.treasures === cat.treasures);
  ok("crates carry the single guidepost", c.guideposts === cat.guideposts && c.guideposts === 1);
  ok("crates carry all 6 companions", c.companions === cat.companions);
  ok("crates + story-1 account for all 18 story cards",
    c.stories + STARTING_SETUP.stories.length === cat.stories && c.stories === 17);
  ok("starting setup cards are real, catalog-consistent cards",
    startDeck.length === 6 && startDeck.every(id => !!DEFAULT_CARDS[id]) &&
    STARTING_SETUP.personas.every(id => DEFAULT_CARDS[id].type === CARD_TYPES.PERSONA) &&
    STARTING_SETUP.objectives.every(id => DEFAULT_CARDS[id].type === CARD_TYPES.OBJECTIVE) &&
    STARTING_SETUP.stories.every(id => !!STORY_CARDS[id]));
  const allCrateComponents = Object.values(CRATE_CONTENTS).flatMap(cr => [
    ...cr.cardIds, ...cr.personas, ...cr.stories, ...cr.stickers,
  ]);
  ok("no crate component appears in more than one crate",
    new Set(allCrateComponents).size === allCrateComponents.length && allCrateComponents.length === c.cards + c.personas + c.stories + c.stickers);
  ok("the story catalog covers story-1..18",
    Object.keys(STORY_CARDS).length === 18 &&
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].every(n => !!STORY_CARDS["story-" + n]));
  ok("peril/minion bulk sets reconcile against the catalog", reconcileCatalog().ok);
  ok("the catalog itself is internally consistent (6 resource types × 12, 36 coins, 12 influence)",
    Object.keys(BOX_CATALOG.resources).length === 6 &&
    Object.values(BOX_CATALOG.resources).every(n => n === 12) &&
    BOX_CATALOG.coins === 36 && BOX_CATALOG.influencePerCharter === 12);

  // ── Task 42: story routing on unlock ──
  const gSt = makeGame();
  const rSt = applyCrateContents(gSt, 12, "A");
  ok("unlocking crate 12 adds its stories to the story pool",
    rSt.ok && gSt.storyPool.all().join(",") === "story-13,story-14,story-15,story-16,story-17,story-18" &&
    rSt.added.stories.length === 6);

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "indexGuide", pass, fail, results };
}
