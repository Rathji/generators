// Validation tests for Task #57: Branching Dialogue Tree (choices).

import { DialogueEngine } from "../engine/dialogue.js";
import { GameState } from "../engine/state.js";

const CHOICE_DATA = {
  "hero.ask": {
    speaker: "Quest Giver",
    pages: ["I have a task for you.", "Will you help?"],
    choices: [
      { text: "Yes, gladly!", flag: "hero_accept", next: "hero.thanks" },
      { text: "Not right now.", flag: "hero_refuse", next: "hero.later" },
    ],
  },
  "hero.thanks": { speaker: "Quest Giver", pages: ["Splendid! Report to the gate captain."] },
  "hero.later": { speaker: "Quest Giver", pages: ["The gate stays open if you change your mind."] },
  "nochoice.end": { speaker: "Greeter", pages: ["Hello traveler."] },
};

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const state = new GameState();
  const eng = new DialogueEngine({ data: CHOICE_DATA, state });

  const first = eng.start("hero.ask");
  check("starts with first page", first.text === "I have a task for you.");
  const second = eng.advance();
  check("advances to second page", second.text === "Will you help?");
  const prompt = eng.advance();
  check("advance waits for choice", prompt.waitingForChoice === true && prompt.done === false);
  check("choices offered", Array.isArray(prompt.choices) && prompt.choices.length === 2);
  check("getChoices lists text", eng.getChoices().every((c) => typeof c.text === "string"));

  const chosen = eng.choose(0);
  check("choose returns ok", chosen.ok === true && chosen.choice === "Yes, gladly!");
  check("choice set flag", state.getFlag("hero_accept") === true);
  check("choice navigated to next node", chosen.next === "hero.thanks" && chosen.done === false);
  check("next node pages loaded", eng.isActive() === true && eng.getPage().text === "Splendid! Report to the gate captain.");

  const eng2 = new DialogueEngine({ data: CHOICE_DATA, state });
  eng2.start("hero.ask");
  eng2.advance();
  eng2.advance();
  const refuse = eng2.choose(1);
  check("second choice flags", refuse.ok === true && state.getFlag("hero_refuse") === true);
  check("second choice ends at later node", refuse.next === "hero.later");

  const eng3 = new DialogueEngine({ data: CHOICE_DATA });
  eng3.start("nochoice.end");
  check("no-choice node ends normally", eng3.advance().done === true);
  check("getChoices null without choices", eng3.getChoices() === null);

  check("choose without choices errors", eng3.choose(0).ok === false);
  check("invalid index errors", eng2.choose(99).ok === false);

  const flags = [];
  const eng4 = new DialogueEngine({
    data: {
      q: { pages: ["q"], choices: [{ text: "a", action: () => flags.push("ran") }] },
    },
  });
  eng4.start("q");
  eng4.advance();
  const acted = eng4.choose(0);
  check("choice action runs", flags.includes("ran") && acted.ok === true && acted.done === true);

  return out;
}
