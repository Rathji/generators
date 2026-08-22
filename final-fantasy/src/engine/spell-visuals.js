// Task #67: Spell Casting Visual Cues — per-spell visual descriptors (effect
// name, color, particle count, duration) for renderer feedback, keyed by
// spell, with element/kind fallbacks.

import { SPELLS } from "../data/spells.js";

const ELEMENT_VISUALS = {
  fire: { effect: "fireball", color: "#ff6b3d", particles: 24, duration: 650 },
  ice: { effect: "iceShards", color: "#7fd4ff", particles: 22, duration: 600 },
  lightning: { effect: "lightningBolt", color: "#ffe14d", particles: 18, duration: 500 },
  water: { effect: "waterSplash", color: "#4da6ff", particles: 26, duration: 700 },
  wind: { effect: "gust", color: "#cfe0ff", particles: 20, duration: 550 },
  earth: { effect: "quake", color: "#c9a25a", particles: 30, duration: 800 },
  holy: { effect: "radiance", color: "#fff3b0", particles: 16, duration: 650 },
};

const KIND_VISUALS = {
  heal: { effect: "healGlow", color: "#7dffa6", particles: 20, duration: 700 },
  cureStatus: { effect: "purify", color: "#ffffff", particles: 18, duration: 650 },
};

export const SPELL_VISUALS = {
  // Explicit per-spell overrides live here (e.g. nuke: { effect: "nova", color: "#ff9d3d", ... }).
};

export class SpellVisualCueSystem {
  constructor(opts = {}) {
    this.overrides = opts.overrides ?? SPELL_VISUALS;
    this.db = opts.spells ?? SPELLS;
  }

  cueFor(spellId) {
    const spell = this.db[spellId];
    if (!spell) return null;
    if (this.overrides[spellId]) return { ...this.overrides[spellId], spellId, name: spell.name };
    if (spell.kind === "heal") return { ...KIND_VISUALS.heal, spellId, name: spell.name };
    if (spell.kind === "cureStatus") return { ...KIND_VISUALS.cureStatus, spellId, name: spell.name };
    const el = ELEMENT_VISUALS[spell.element];
    if (el) return { ...el, spellId, name: spell.name };
    return { effect: "magicSparkle", color: "#c9a2ff", particles: 16, duration: 550, spellId, name: spell.name };
  }

  cueForElement(element) {
    return ELEMENT_VISUALS[element] ?? null;
  }

  elementColors() {
    return Object.fromEntries(Object.entries(ELEMENT_VISUALS).map(([el, v]) => [el, v.color]));
  }

  all() {
    return Object.keys(this.db).map((id) => this.cueFor(id)).filter(Boolean);
  }
}
