// Validation tests for Task #41: Quest Objective Log.

import { QuestLogSystem } from "../engine/quest-log.js";
import { QuestTracker } from "../engine/quests.js";
import { QUESTS } from "../data/quests.js";
import { StoryDirector } from "../engine/events.js";
import { MAIN_STORY } from "../data/story.js";
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
  const party = new PartyManager({ gold: 100 });
  party.add(new Character({ id: "h", name: "H", classId: "warrior" }));
  const inventory = new Inventory();
  const quests = new QuestTracker(QUESTS, state);
  const director = new StoryDirector({ state });
  director.registerMilestones(MAIN_STORY);
  const sideQuests = new SideQuestSystem(SIDE_QUESTS, { state, party, inventory });

  const log = new QuestLogSystem({ quests, director, sideQuests });

  const emptyDir = new StoryDirector({ state: new GameState() });
  const emptyLog = new QuestLogSystem({ director: emptyDir });
  check("empty log when no milestones", emptyLog.isEmpty() === true);
  check("activeGoal default", emptyLog.activeGoal() === "No active objectives");

  director.advanceMilestones();
  let entries = log.entries();
  check("story milestone appears", entries.length >= 1 && entries[0].kind === "story");
  check("story milestone is primary", entries[0].primary === true);
  check("first milestone name", log.activeGoal() === "Meet the King of Cornelia");

  director.advance();
  director.advanceMilestones();
  entries = log.entries();
  check("second milestone now active", entries[0].id === "rescue_the_princess");
  check("activeGoal shows story milestone", log.activeGoal() === "Rescue the Princess from Garland");

  state.setFlag("intro_seen", true);
  sideQuests.start("herbalists_request");
  const withSide = log.entries();
  check("side quest appears after story", withSide[0].kind === "story" && withSide[1]?.kind === "side");
  check("side quest objective text present", withSide[1].objectives[0].text.includes("Herb"));

  sideQuests.completeStep("herbalists_request", "sq_herbalists_request_herb");
  const report = log.entries().find((e) => e.kind === "side");
  check("side quest progress reported", report.progress === 1 && report.total === 1);

  quests.bind(state);
  state.setFlag("prologue_started", true);
  const qEntries = log.entries();
  check("tracked quest included", qEntries.some((e) => e.kind === "quest" && e.id === "prologue"));
  const prologue = qEntries.find((e) => e.id === "prologue");
  check("tracked objectives with done state", prologue.objectives.length === 2 && prologue.objectives[0].done === false);

  state.setFlag("entered_castle", true);
  const refreshed = log.entries().find((e) => e.id === "prologue");
  check("objective flips to done", refreshed.objectives[0].done === true);

  const rendered = log.render();
  check("render includes objective markers", rendered.includes("[ ]") && rendered.includes("Castle Cornelia"));

  const dir2 = new StoryDirector({ state: new GameState() });
  dir2.registerMilestones(MAIN_STORY);
  const log2 = new QuestLogSystem({ director: dir2 });
  check("log works with director only", log2.activeGoal() === "Meet the King of Cornelia");

  check("view returns clean copies", Array.isArray(log.view()) && log.view().every((e) => typeof e.name === "string"));

  return out;
}
