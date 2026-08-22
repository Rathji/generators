// Validation tests for Task #39: Side Quest Event Chain.

import { SideQuestSystem } from "../engine/side-quests.js";
import { SIDE_QUESTS } from "../data/side-quests.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Inventory } from "../engine/inventory.js";
import { Character } from "../engine/character.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  state.setFlag("intro_seen");
  const party = new PartyManager({ gold: 0 });
  const hero = new Character({ id: "hero", name: "Hero", classId: "warrior" });
  party.add(hero);
  const inv = new Inventory();
  const sq = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory: inv });

  check("quests registered", sq.all().length === 15);
  check("herbalist can start", sq.canStart("herbalists_request") === true);
  check("not started initially", sq.isStarted("herbalists_request") === false);

  const startRes = sq.start("herbalists_request");
  check("start succeeds", startRes.ok === true && sq.isStarted("herbalists_request") === true);
  check("cannot double start", sq.start("herbalists_request").ok === false);
  check("steps total", sq.stepsTotal("herbalists_request") === 1);

  const step = sq.completeStep("herbalists_request", "sq_herbalists_request_herb");
  check("step completes quest", step.ok === true && step.done === true && step.progress === 1);

  const done = sq.checkComplete("herbalists_request");
  check("reward granted", done.ok === true && done.reward.gold === 50);
  check("gold paid", party.gold === 50);
  check("items rewarded", inv.count("hiPotion") === 2);
  check("xp granted", hero.xp === 30);
  check("quest marked complete", sq.isComplete("herbalists_request") === true);
  check("no repeat reward", sq.checkComplete("herbalists_request").ok === false);

  check("scholar blocked without flag", sq.canStart("lost_crystal_shard") === false);
  check("step on unstarted quest blocked", sq.completeStep("lost_crystal_shard", "sq_lost_crystal_shard_found").error === "not started");

  state.setFlag("story_garland_defeated");
  check("scholar can start now", sq.canStart("lost_crystal_shard") === true);
  sq.start("lost_crystal_shard");
  const s1 = sq.completeStep("lost_crystal_shard", "sq_lost_crystal_shard_found");
  check("first step done", s1.ok === true && s1.done === false && s1.progress === 1);
  const incomplete = sq.checkComplete("lost_crystal_shard");
  check("incomplete quest not completable", incomplete.ok === false && incomplete.error === "steps incomplete");
  sq.completeStep("lost_crystal_shard", "sq_lost_crystal_shard_returned");
  const s2 = sq.checkComplete("lost_crystal_shard");
  check("second quest rewarded", s2.ok === true && inv.count("ether") === 1 && party.gold === 170);

  const report = sq.progressReport("lost_crystal_shard");
  check("progress report", report.complete === true && report.progress === 2 && report.total === 2);
  check("active lists in-progress only", sq.active().length === 0);

  const state2 = new GameState();
  const sq2 = new SideQuestSystem(SIDE_QUESTS, { state: state2 });
  check("without flags nothing starts", sq2.canStart("herbalists_request") === false);
  check("no party = no gold crash", sq2.def("herbalists_request").reward.gold === 50);

  return out;
}
