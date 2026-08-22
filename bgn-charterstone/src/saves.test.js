// src/saves.test.js — Phase 15 save slots & continue validation (Task 72).
// Run in-page via ?test=saves, or via window.__loadSavesTests().
// Task 72: campaign autosave with manual slots and a "continue campaign"
// flow resuming mid-game or between-games state. A saved mid-game restore
// must pass the serialization round-trip test.

import { createSaves, SAVES_VERSION, AUTOSAVE_SLOT } from "./saves.js";
import { createGameState, serializeGameState, restoreGameState } from "./serialization.js";
import { createCampaignState, finishGame, beginNextGame } from "./campaignState.js";
import { STARTING_SETUP } from "./indexGuide.js";

const TEST_FOLDER = "charterstone-saves-test";

export async function runSavesTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const kv = (typeof window !== "undefined" && (window.root && window.root.kv || window.kv)) || null;
  ok("kv-plugin is available for the save-slot test", !!kv);
  if (!kv) return { suite: "saves", pass: results.filter(r => r.pass).length, fail: results.filter(r => !r.pass).length, results };

  const saves = createSaves({ kv, folder: TEST_FOLDER });

  // ── build a mid-game board ──
  const players = [{ id: "P1", charterId: 0, startingCoins: 4 }, { id: "P2", charterId: 1, startingCoins: 4 }];
  const g = createGameState({ players, firstPlayer: "P1", rng: Math.random });
  const treasury = g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell;
  g.economy.gain("P1", { clay: 1 });
  const placed = g.engine.placeWorker("P1", treasury, { resource: "clay" });
  ok("mid-game board prepared (a worker was placed)", placed.ok === true);
  const before = serializeGameState(g);

  // ── autosave + round-trip ──
  const meta = await saves.autosave({ state: g, campaign: null }, { note: "mid-game autosave" });
  ok("autosave recorded", meta && meta.slot === AUTOSAVE_SLOT && meta.hasState === true && meta.gameNumber === null);
  const list = await saves.list();
  ok("autosave appears in the slot list", list.length >= 1 && list[0].name === AUTOSAVE_SLOT);
  const loaded = await saves.load(AUTOSAVE_SLOT);
  ok("autosave loads a state record", !!loaded && !!loaded.state);
  ok("saved mid-game restore passes the serialization round-trip",
    (() => {
      try {
        const restored = restoreGameState(loaded.state);
        return serializeGameState(restored) === before;
      } catch (e) { return false; }
    })(),
    "expected identical serialize output");

  // ── manual named slot + campaign (between-games) ──
  const campaign = createCampaignState({ players: players.map(p => ({ id: p.id, charterId: p.charterId })) });
  finishGame(campaign, { winnerId: "P1" });
  finishGame(campaign, { winnerId: "P2", legacy: { stickers: ["sticker-legacy-x"] } });
  const campMeta = await saves.save("campaign-one", { campaign }, { note: "after game 2" });
  ok("manual campaign slot recorded", campMeta && campMeta.slot === "campaign-one" && campMeta.kind === "campaign" && campMeta.gameNumber === 3);

  // ── continue campaign (mid-game preferred, then between-games) ──
  const continuedMid = await saves.continueCampaign({ campaignId: campaign.id });
  ok("continue resumes the mid-game autosave first", !!continuedMid && !!continuedMid.state);
  ok("resumed mid-game board restores identically", (() => {
    try { const r = restoreGameState(continuedMid.state); return serializeGameState(r) === before; } catch (e) { return false; }
  })());

  const saves2 = createSaves({ kv, folder: TEST_FOLDER + "-between" });
  await saves2.autosave({ campaign }, {});
  const continuedCamp = await saves2.continueCampaign({ campaignId: campaign.id });
  ok("continue resumes an between-games campaign record", !!continuedCamp && !!continuedCamp.campaign && !continuedCamp.state);
  ok("resumed campaign is at game 3 with legacy intact",
    continuedCamp.campaign.gameNumber === 3 && continuedCamp.campaign.stickers.includes("sticker-legacy-x"));
  const next = beginNextGame(continuedCamp.campaign);
  ok("resumed campaign reopens the next game", !!(next && next.gameNumber === 3 && next.board));
  await saves2.remove(AUTOSAVE_SLOT);

  // ── removal ──
  await saves.remove("campaign-one");
  const after = await saves.list();
  ok("removed slot leaves the list", !after.some(s => s.name === "campaign-one"));
  await saves.remove(AUTOSAVE_SLOT);

  // cleanup the test folders
  try { await kv[TEST_FOLDER].delete("index"); } catch (e) {}
  try { await kv[TEST_FOLDER].delete("slot:" + AUTOSAVE_SLOT); } catch (e) {}
  try { await kv[TEST_FOLDER + "-between"].delete("index"); } catch (e) {}
  try { await kv[TEST_FOLDER + "-between"].delete("slot:" + AUTOSAVE_SLOT); } catch (e) {}

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "saves", pass, fail, results };
}
