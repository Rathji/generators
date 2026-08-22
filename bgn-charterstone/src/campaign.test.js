// src/campaign.test.js — Task 43 campaign unlock schedule validation.
// Run in-page via ?test=campaign, or programmatically via window.__loadCampaignTests().
// Task 43: the rules/cards/components that unlock across the 12-game campaign
// (income icon, new rule/card types, guideposts, sky island, perils, minions,
// etc.) transcribe as a schedule. Unlocking at game N grants exactly the
// components listed for that game; rule stickers apply permanently (flipping
// chronicle flags), content stickers enter the sticker pool, and the bulk
// peril/minion defs reconcile against the box catalog (Task 42).

import { createGameState, restoreGameState } from "./serialization.js";
import { DEFAULT_ENGINE_DEFS } from "./buildings.js";
import { DEFAULT_CARDS } from "./cards.js";
import {
  CAMPAIGN_GAME_COUNT, CAMPAIGN_UNLOCKS, CAMPAIGN_END_SCORING,
  PERIL_DEFS, MINION_DEFS, perilIds, minionIds,
  unlockForGame, applyGameUnlocks, reconcileCatalog,
} from "./campaign.js";
import { BOX_CATALOG } from "./indexGuide.js";
import { STICKER_DEFS } from "./stickers.js";

export function runCampaignTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── schedule shape ──
  ok("the campaign lasts 12 games", CAMPAIGN_GAME_COUNT === 12);
  ok("every scheduled unlock is for a valid game in the campaign",
    Object.keys(CAMPAIGN_UNLOCKS).every(n => Number.isInteger(+n) && +n >= 1 && +n <= CAMPAIGN_GAME_COUNT));
  ok("every scheduled sticker exists in the sticker defs",
    Object.values(CAMPAIGN_UNLOCKS).flatMap(u => u.stickers).every(s => !!STICKER_DEFS[s]));
  ok("games without an entry unlock nothing extra",
    unlockForGame(1).stickers.length === 0 && unlockForGame(3).stickers.length === 0 && unlockForGame(12).stickers.length === 0);
  ok("game 2 unlocks the income rule and game 4 the drop-players rule",
    unlockForGame(2).stickers.join(",") === "rule-income" &&
    unlockForGame(4).stickers.join(",") === "rule-drop-players");
  ok("late-campaign content (guideposts, sky island, perils, minions) is scheduled",
    [6, 8, 9, 11].every(n => unlockForGame(n).stickers.length === 1) &&
    unlockForGame(6).stickers[0] === "content-guideposts" &&
    unlockForGame(8).stickers[0] === "content-sky-island" &&
    unlockForGame(9).stickers[0] === "content-perils" &&
    unlockForGame(11).stickers[0] === "content-minions");

  // ── bulk component sets reconcile with the box catalog ──
  ok("perils are 6 kinds × 6 copies = 36 cards",
    Object.keys(PERIL_DEFS).length === 6 && perilIds().length === 36 && new Set(perilIds()).size === 6);
  ok("minions are 6 kinds × 6 copies = 36 cards",
    Object.keys(MINION_DEFS).length === 6 && minionIds().length === 36 && new Set(minionIds()).size === 6);
  ok("peril/minion defs reconcile against the box catalog", reconcileCatalog().ok);
  ok("the box catalog counts resources (6×12) and coins (36)",
    Object.keys(BOX_CATALOG.resources).length === 6 &&
    Object.values(BOX_CATALOG.resources).every(n => n === 12) &&
    BOX_CATALOG.coins === 36 && BOX_CATALOG.influencePerCharter === 12);

  // ── end-of-campaign scoring categories ──
  ok("the end-of-campaign scoring categories are transcribed",
    CAMPAIGN_END_SCORING.length >= 5 &&
    CAMPAIGN_END_SCORING.some(c => c.id === "glory" && c.vp === "10") &&
    CAMPAIGN_END_SCORING.some(c => c.id === "victories" && c.vp === "6-8") &&
    CAMPAIGN_END_SCORING.some(c => c.id === "capacity" && c.vp === "1-3") &&
    CAMPAIGN_END_SCORING.some(c => c.id === "used-personas" && c.vp === "5-7") &&
    CAMPAIGN_END_SCORING.some(c => c.id === "building-value"));

  // ── applyGameUnlocks grants exactly the components listed for that game ──
  const g = createGameState({
    players: [{ id: "A", charterId: 0 }, { id: "B", charterId: 1 }],
    firstPlayer: "A",
    cards: DEFAULT_CARDS,
    buildingDefs: DEFAULT_ENGINE_DEFS,
  });
  const r2 = applyGameUnlocks(g, 2);
  ok("unlocking game 2 grants exactly the income rule and applies it",
    r2.ok && r2.added.stickers.length === 1 &&
    r2.added.stickers[0].id === "rule-income" && r2.added.stickers[0].applied === true &&
    g.stickerBook.isApplied("rule-income") && g.chronicle.flag("incomeEnabled") === true);
  const r9 = applyGameUnlocks(g, 9);
  ok("unlocking game 9 grants exactly the perils content sticker (pooled, not applied)",
    r9.ok && r9.added.stickers.length === 1 &&
    r9.added.stickers[0].id === "content-perils" && r9.added.stickers[0].applied === false &&
    g.stickerPool.has("content-perils"));
  ok("content stickers do not flip rule flags",
    g.chronicle.flag("incomeEnabled") === true && g.chronicle.flag("dropPlayers") === false);
  const r4 = applyGameUnlocks(g, 4);
  ok("unlocking game 4 grants the drop-players rule and unlocks the dropPlayer action",
    r4.ok && g.stickerBook.isApplied("rule-drop-players") &&
    g.chronicle.enabledActions().includes("dropPlayer"));
  ok("an out-of-range game grants nothing", applyGameUnlocks(g, 0).added.stickers.length === 0 && applyGameUnlocks(g, 13).added.stickers.length === 0);

  // ── campaign-applied state survives serialize → restore ──
  const g2 = restoreGameState(JSON.parse(g.serialize()));
  ok("campaign-applied rules and content survive serialize→restore",
    g2.stickerBook.isApplied("rule-income") && g2.chronicle.flag("incomeEnabled") === true &&
    g2.stickerBook.isApplied("rule-drop-players") && g2.chronicle.flag("dropPlayers") === true &&
    g2.stickerPool.has("content-perils"));

  const pass = results.filter(x => x.pass).length;
  const fail = results.length - pass;
  return { suite: "campaign", pass, fail, results };
}
