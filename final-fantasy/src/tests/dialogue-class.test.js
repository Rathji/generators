// Validation tests for Task #58: Character-Specific Dialogue Hooks.

import { DialogueEngine, createDialogueWorld } from "../engine/dialogue.js";
import { GameState } from "../engine/state.js";
import { PartyManager } from "../engine/party.js";
import { Character } from "../engine/character.js";

const DATA = {
  "gate.react": {
    speaker: "Guard",
    byClass: {
      warrior: "gate.react.warrior",
      thief: "gate.react.thief",
      default: "gate.react.default",
    },
  },
  "gate.react.warrior": { speaker: "Guard", pages: ["A warrior! The captain wants you at the east gate."] },
  "gate.react.thief": { speaker: "Guard", pages: ["A thief, eh? I'll be watching my coin purse."] },
  "gate.react.default": { speaker: "Guard", pages: ["Pass, traveler."] },
};

function worldForClass(classId) {
  return { getFlag: () => false, hasItem: () => false, getLeaderClass: () => classId };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const warrior = new DialogueEngine({ data: DATA, world: worldForClass("warrior") });
  const w = warrior.start("gate.react");
  check("warrior hook resolves", w.id === "gate.react.warrior" && w.text.includes("warrior"));

  const thief = new DialogueEngine({ data: DATA, world: worldForClass("thief") });
  const t = thief.start("gate.react");
  check("thief hook resolves", t.id === "gate.react.thief" && t.text.includes("thief"));

  const mage = new DialogueEngine({ data: DATA, world: worldForClass("blackMage") });
  const m = mage.start("gate.react");
  check("unmapped class falls to default", m.id === "gate.react.default");

  const noWorld = new DialogueEngine({ data: DATA });
  check("no world -> no class resolution", noWorld.start("gate.react").id === "gate.react");

  // byClass maps to a node that itself branches on a flag.
  const branching = {
    n: {
      byClass: { warrior: "n.warrior" },
    },
    "n.warrior": {
      branches: [
        { when: { flag: "king_met" }, id: "n.warrior.after" },
        { id: "n.warrior.before" },
      ],
    },
    "n.warrior.before": { pages: ["You've not met the king."] },
    "n.warrior.after": { pages: ["The king awaits."] },
  };
  const bWorld = { getFlag: (n) => n === "king_met", getLeaderClass: () => "warrior" };
  const bEng = new DialogueEngine({ data: branching, world: bWorld });
  check("class hook then branch resolves", bEng.start("n").id === "n.warrior.after");

  // createDialogueWorld derives leader class from the party.
  const game = { state: new GameState(), inventory: null, party: new PartyManager() };
  game.party.add(new Character({ id: "h", name: "H", classId: "whiteMage" }));
  const dw = createDialogueWorld(game);
  check("world exposes leader class", dw.getLeaderClass() === "whiteMage");
  const viaWorld = new DialogueEngine({ data: DATA, world: dw });
  check("engine reads leader from world", viaWorld.start("gate.react").id === "gate.react.default");

  game.party.members[0] = new Character({ id: "r", name: "R", classId: "redMage" });
  check("leader class updates", createDialogueWorld(game).getLeaderClass() === "redMage");

  return out;
}
