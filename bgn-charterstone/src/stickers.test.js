// src/stickers.test.js — Phase 8 sticker-application validation (Task 35).
// Run in-page via ?test=stickers, or programmatically via window.__loadStickersTests().
// Task 35: rule and content stickers apply permanently to the Chronicle/board
// and mutate the active ruleset. Applying a rule sticker flips its rule flag
// on the chronicle and changes the set of legal actions; applied stickers
// survive serialize→restore.

import { createGameState, restoreGameState } from "./serialization.js";
import { createStickerBook, STICKER_DEFS, STICKER_TYPES } from "./stickers.js";
import { createChronicle } from "./chronicle.js";

export function runStickersTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  function makeGame(overrides = {}) {
    return createGameState({
      players: [
        { id: "A", charterId: 0, startingCoins: 4 },
        { id: "B", charterId: 1, startingCoins: 4 },
      ],
      firstPlayer: "A",
      ...overrides,
    });
  }

  // ── the sticker registry ──
  ok("every sticker def has an id, name and type",
    Object.values(STICKER_DEFS).every(d => typeof d.id === "string" && typeof d.name === "string" &&
      (d.type === STICKER_TYPES.RULE || d.type === STICKER_TYPES.CONTENT)));
  ok("rule stickers carry a rule flag, content stickers do not",
    Object.values(STICKER_DEFS).every(d => d.type === STICKER_TYPES.RULE ? typeof d.ruleFlag === "string" : d.ruleFlag == null));

  // ── Task 35: applying a rule sticker flips its flag and changes legal actions ──
  const g = makeGame();
  const before = g.chronicle.enabledActions().join(",");
  const res = g.stickerBook.apply("rule-drop-players");
  const after = g.chronicle.enabledActions().join(",");
  ok("applying a new-rule sticker flips its rule flag",
    res.ok && res.ruleFlag === "dropPlayers" &&
    g.chronicle.flag("dropPlayers") === true && g.stickerBook.isApplied("rule-drop-players"));
  ok("applying a new-rule sticker changes the set of legal actions",
    before === "place,retrieve" && after === "place,retrieve,dropPlayer" && before !== after);

  // ── the income rule flag is real: a game created under that chronicle has income on ──
  const c = createChronicle();
  const book = createStickerBook({ chronicle: c });
  book.apply("rule-income");
  const g3 = makeGame({ chronicle: c });
  ok("the income rule sticker enables income on a fresh game",
    g3.progress.isIncomeEnabled() && c.flag("incomeEnabled") === true);
  ok("without the sticker, income stays locked",
    makeGame().progress.isIncomeEnabled() === false);

  // ── content stickers apply without touching the ruleset ──
  const gC = makeGame();
  const rC = gC.stickerBook.apply("content-sky-island");
  ok("a content sticker applies permanently without changing the ruleset",
    rC.ok && rC.type === STICKER_TYPES.CONTENT && rC.ruleFlag === null &&
    gC.stickerBook.isApplied("content-sky-island") && gC.chronicle.flag("dropPlayers") === false);

  // ── rejections ──
  ok("a duplicate sticker application is rejected",
    !gC.stickerBook.apply("content-sky-island").ok && gC.stickerBook.apply("content-sky-island").reason === "already_applied");
  ok("an unknown sticker is rejected", !gC.stickerBook.apply("nope-9").ok);

  // ── serialization: applied stickers + flags persist ──
  g.stickerBook.apply("rule-drop-players");
  const gs = restoreGameState(JSON.parse(g.serialize()));
  ok("applied stickers and their rule flags survive serialize→restore",
    gs.stickerBook.isApplied("rule-drop-players") && gs.chronicle.flag("dropPlayers") === true &&
    gs.chronicle.enabledActions().join(",") === "place,retrieve,dropPlayer" &&
    JSON.stringify(gs.stickerBook.toJSON()) === JSON.stringify(g.stickerBook.toJSON()));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "stickers", pass, fail, results };
}
