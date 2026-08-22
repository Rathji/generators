// Task #28: Spell Learning/Acquisition — gain spells via NPC teachers or
// consumable tomes/scrolls. The item path is handled in inventory.js
// (effect.kind === "learnSpell"); this module covers NPC teachers and
// class-based "scroll" acquisition.

import { SPELLS } from "../data/spells.js";

export class SpellLearningSystem {
  constructor(opts = {}) {
    // teachers: map of npcId -> { spellId, requiresItem?, requiredFlag?, dialogue }
    this.teachers = opts.teachers ?? {};
  }

  registerTeacher(npcId, def) {
    this.teachers[npcId] = def;
    return this;
  }

  teacher(npcId) {
    return this.teachers[npcId] ?? null;
  }

  canLearn(character, spellId) {
    if (!character || !SPELLS[spellId]) return false;
    if (typeof character.knowsSpell === "function") return !character.knowsSpell(spellId);
    return !character.getSpells().includes(spellId);
  }

  // Direct teaching (NPC dialogue, quest reward, level-up bonus, etc.).
  teach(character, spellId) {
    if (!this.canLearn(character, spellId)) {
      return { ok: false, error: "cannot learn", spellId };
    }
    if (typeof character.learnSpell === "function") {
      character.learnSpell(spellId);
    } else {
      character.extraSpells = character.extraSpells || [];
      character.extraSpells.push(spellId);
    }
    return { ok: true, spellId, spell: SPELLS[spellId].name };
  }

  // Trigger a registered NPC teacher. Returns an action result the dialogue
  // system can consume: { ok, dialogue?, learned?, error? }.
  visitTeacher(npcId, character, opts = {}) {
    const t = this.teachers[npcId];
    if (!t) return { ok: false, error: "not a teacher" };
    if (t.requiredItem && !(opts.inventory && opts.inventory.has(t.requiredItem))) {
      return { ok: false, error: "item required", requiredItem: t.requiredItem, dialogue: t.blockedDialogue ?? null };
    }
    if (t.requiredFlag && !(opts.state && opts.state.getFlag(t.requiredFlag))) {
      return { ok: false, error: "flag required", requiredFlag: t.requiredFlag, dialogue: t.blockedDialogue ?? null };
    }
    if (!this.canLearn(character, t.spellId)) {
      return { ok: false, error: "already known", spellId: t.spellId, dialogue: t.knownDialogue ?? null };
    }
    this.teach(character, t.spellId);
    return { ok: true, learned: t.spellId, spell: SPELLS[t.spellId].name, dialogue: t.successDialogue ?? null };
  }
}
