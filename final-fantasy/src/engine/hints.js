// Task #109: HintSystem — optional dialogue hints toward the nearest
// objective. Reads the main-story milestone chain (and falls back to the
// plot chapters) and returns a directed hint string keyed to the current
// objective, so NPCs can offer help when a player is stuck. Pure logic.

import { HINTS } from "../data/hints.js";

export class HintSystem {
  constructor(opts = {}) {
    this.director = opts.director ?? null; // StoryDirector (milestones)
    this.plot = opts.plot ?? null; // PlotSequenceSystem (chapters)
    this.state = opts.state ?? null;
    this.hints = opts.hints ?? HINTS;
  }

  // The current story objective: the active/next main-story milestone, else
  // the next undone plot chapter.
  objective() {
    const dir = this.director;
    if (dir) {
      const ms = dir.currentMilestone ?? dir.nextMilestone();
      if (ms) {
        const st = dir.milestoneState(ms.id);
        if (!st.done) {
          return {
            id: ms.id,
            name: ms.name ?? ms.id,
            hint: this.hints[ms.id]?.text ?? this.hints[ms.id]?.objective ?? null,
          };
        }
      }
    }
    if (this.plot) {
      const ch = this.plot.nextChapter();
      if (ch) {
        const key = "ch_" + ch.id;
        return {
          id: ch.id,
          name: ch.name,
          hint: this.hints[key]?.text ?? this.hints[key]?.objective ?? null,
        };
      }
    }
    return { id: null, name: null, hint: null };
  }

  hintText() {
    const o = this.objective();
    return o.hint ?? "Keep exploring — the path reveals itself to those who press on.";
  }

  // An NPC's offered help, optionally prefixed with who is speaking.
  helpFor(npcId = null, npcName = null) {
    const o = this.objective();
    const core = o.hint
      ? o.hint
      : "The road ahead is open. Speak with the elders of each town for the way forward.";
    return {
      npcId,
      speaker: npcName ?? null,
      objective: o.name,
      text: (npcName ? npcName + ": " : "") + core,
    };
  }

  describe() {
    const o = this.objective();
    return {
      objective: o.name,
      hint: o.hint,
      fallback: o.hint === null,
    };
  }
}
