// Task #3: Global Game State Manager — centralized player progress,
// current location, party, inventory, and world flags.

export class GameState {
  constructor(opts = {}) {
    this.flags = {};
    this.gold = opts.gold ?? 0;
    this.location = { mapId: "overworld", x: 0, y: 0, facing: "S" };
    this.storyPhase = 0;
    this.party = null;
    this.inventory = null;
    this.playTimeSec = 0;
  }

  setFlag(name, value = true) {
    this.flags[name] = value;
    return this;
  }

  getFlag(name) {
    return !!this.flags[name];
  }

  hasFlag(name) {
    return this.getFlag(name);
  }

  clearFlag(name) {
    delete this.flags[name];
    return this;
  }

  toggleFlag(name) {
    this.flags[name] = !this.getFlag(name);
    return this.flags[name];
  }

  setLocation(mapId, x, y, facing = "S") {
    this.location = { mapId, x, y, facing };
    return this;
  }

  getLocation() {
    return this.location;
  }

  setStoryPhase(n) {
    this.storyPhase = n;
    return this;
  }

  getStoryPhase() {
    return this.storyPhase;
  }

  setParty(party) {
    this.party = party;
    return this;
  }

  setInventory(inventory) {
    this.inventory = inventory;
    return this;
  }

  snapshot() {
    return JSON.parse(
      JSON.stringify({
        version: 1,
        flags: this.flags,
        gold: this.gold,
        location: this.location,
        storyPhase: this.storyPhase,
        playTimeSec: this.playTimeSec,
      })
    );
  }

  restore(snap) {
    if (!snap) return this;
    this.flags = { ...(snap.flags ?? {}) };
    this.gold = snap.gold ?? this.gold;
    this.location = { ...(snap.location ?? this.location) };
    this.storyPhase = snap.storyPhase ?? this.storyPhase;
    this.playTimeSec = snap.playTimeSec ?? this.playTimeSec;
    return this;
  }
}
