// Task #168: the Codex of Fiends — the Chronicler's record of the realm's
// great shadows. A page is `known` once its first defeat flag is set; the
// Codex is complete when every page (including the Apex's) is known.

export class BestiarySystem {
  constructor(entries = [], opts = {}) {
    this.entriesList = entries;
    this.state = opts.state ?? null;
  }

  entries() {
    return [...this.entriesList];
  }

  entry(bossId) {
    return this.entriesList.find((e) => e.bossId === bossId && !e.apex) ?? null;
  }

  isKnown(entry) {
    if (!entry || !this.state) return false;
    return !!this.state.getFlag(entry.firstDefeatFlag);
  }

  // "Slain again" = its echo fell in the Hall of Trials.
  isSlainAgain(entry) {
    if (!entry || !entry.trialId || !this.state) return false;
    return !!this.state.getFlag("trial_" + entry.trialId + "_cleared");
  }

  knownCount() {
    return this.entriesList.filter((e) => this.isKnown(e)).length;
  }

  slainAgainCount() {
    return this.entriesList.filter((e) => this.isSlainAgain(e)).length;
  }

  total() {
    return this.entriesList.length;
  }

  // Every page read — the last page only opens when the Apex itself falls.
  complete() {
    return this.entriesList.every((e) => this.isKnown(e));
  }

  report() {
    return this.entriesList.map((e) => ({
      bossId: e.bossId,
      name: e.name,
      title: e.title,
      apex: !!e.apex,
      known: this.isKnown(e),
      slainAgain: this.isSlainAgain(e),
      complete: this.complete(),
    }));
  }
}
