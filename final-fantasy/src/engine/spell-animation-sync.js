// Task #130: Spell Casting Animation Sync — maps a spell cast to a sequence
// of animation stages (cast -> release -> impact) whose frames and durations
// are synchronized with the spell-execution text that would be logged/typed
// at each moment. Elements map to sprite frames; heal/cure use their own.

import { SPELLS } from "../data/spells.js";
import { SpellVisualCueSystem } from "./spell-visuals.js";

const ELEMENT_FRAME = {
  fire: 2,
  ice: 3,
  lightning: 4,
  water: 5,
  wind: 6,
  earth: 7,
  holy: 8,
};

const KIND_FRAME = {
  heal: 9,
  cureStatus: 10,
};

export class SpellAnimationSyncSystem {
  constructor(opts = {}) {
    this.visuals = opts.visuals ?? new SpellVisualCueSystem();
    this.db = opts.spells ?? SPELLS;
    this.baseFps = opts.fps ?? 8;
  }

  elementFrame(spell) {
    if (spell.kind === "heal") return KIND_FRAME.heal;
    if (spell.kind === "cureStatus") return KIND_FRAME.cureStatus;
    return ELEMENT_FRAME[spell.element] ?? 1;
  }

  // Timeline of animation stages for a spell, each with a sprite frame,
  // a duration (derived from the spell's visual cue), and the text shown
  // at that stage of casting/execution.
  timeline(spellId) {
    const spell = this.db[spellId];
    if (!spell) return null;
    const cue = this.visuals.cueFor(spellId);
    const total = cue?.duration ?? 550;
    const castDur = Math.round(total * 0.4);
    const impactDur = total - castDur;
    const frame = this.elementFrame(spell);
    return [
      { stage: "cast", frame: 0, durationMs: castDur, text: "The caster begins to chant..." },
      { stage: "release", frame, durationMs: Math.max(60, Math.round(castDur / 2)), text: "Arcane energy gathers!" },
      { stage: "impact", frame, durationMs: impactDur, text: spell.name + " takes effect!" },
    ];
  }

  framesFor(spellId) {
    const t = this.timeline(spellId);
    return t ? t.map((s) => s.frame) : [];
  }

  stages(spellId) {
    const t = this.timeline(spellId);
    return t ? t.map((s) => s.stage) : [];
  }

  stageFor(spellId, stage) {
    return this.timeline(spellId)?.find((s) => s.stage === stage) ?? null;
  }

  totalDuration(spellId) {
    const t = this.timeline(spellId);
    return t ? t.reduce((sum, s) => sum + s.durationMs, 0) : 0;
  }

  // Register one non-looping animation per stage on a SpriteAnimationController.
  syncController(spellId, controller) {
    const t = this.timeline(spellId);
    if (!t || !controller) return null;
    for (const s of t) {
      controller.addAnimation("spell_" + s.stage, { frames: [s.frame], fps: this.baseFps, loop: false });
    }
    return t;
  }

  // Map a sequence of execution log lines onto the spell's animation frames
  // (lines 1..N -> stages cast, release, impact, repeating the last stage).
  timelineForText(spellId, messages) {
    const t = this.timeline(spellId);
    if (!t) return [];
    return (messages ?? []).map((text, i) => {
      const stage = t[Math.min(i, t.length - 1)];
      return { text, frame: stage.frame, durationMs: stage.durationMs, stage: stage.stage };
    });
  }

  describe(spellId) {
    const spell = this.db[spellId];
    const t = this.timeline(spellId);
    if (!spell || !t) return null;
    return {
      spellId,
      name: spell.name,
      frames: t.map((s) => s.frame),
      stages: t.map((s) => s.stage),
      durationMs: this.totalDuration(spellId),
      text: t.map((s) => s.text),
    };
  }

  audit() {
    const errors = [];
    for (const [id, spell] of Object.entries(this.db)) {
      if (!this.timeline(id)) errors.push({ spell: id, error: "no timeline" });
      if (!spell.kind) errors.push({ spell: id, error: "missing kind" });
    }
    return { ok: errors.length === 0, errors };
  }
}
