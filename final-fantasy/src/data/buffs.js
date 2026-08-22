// Task #128: Buff/Debuff Definitions — temporary stat modifiers applied to
// combatants (party-wide via BuffSystem). Each def may carry flat statMods
// (applied to the effective stat total), a hitChance modifier (additive, for
// Blind and similar), and a duration in turns.

export const BUFF_DEFS = {
  haste: { id: "haste", name: "Haste", friendly: true, statMods: { agi: 3 }, hitChance: 0, turns: 3, summary: "+3 AGI for 3 turns." },
  slow: { id: "slow", name: "Slow", friendly: false, statMods: { agi: -3 }, hitChance: 0, turns: 3, summary: "-3 AGI for 3 turns." },
  blind: { id: "blind", name: "Blind", friendly: false, statMods: {}, hitChance: -0.25, turns: 3, summary: "-25% hit chance for 3 turns." },
  might: { id: "might", name: "Might", friendly: true, statMods: { str: 3 }, hitChance: 0, turns: 4, summary: "+3 STR for 4 turns." },
  guard: { id: "guard", name: "Guard", friendly: true, statMods: { def: 3 }, hitChance: 0, turns: 4, summary: "+3 DEF for 4 turns." },
  barrier: { id: "barrier", name: "Barrier", friendly: true, statMods: { mdef: 3 }, hitChance: 0, turns: 4, summary: "+3 MDEF for 4 turns." },
  focus: { id: "focus", name: "Focus", friendly: true, statMods: { int: 3 }, hitChance: 0, turns: 4, summary: "+3 INT for 4 turns." },
  rage: { id: "rage", name: "Rage", friendly: true, statMods: { str: 4, def: -2 }, hitChance: 0, turns: 4, summary: "+4 STR, -2 DEF for 4 turns." },
};

export const BUFF_IDS = Object.freeze(Object.keys(BUFF_DEFS));
