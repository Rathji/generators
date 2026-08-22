// Task #223: Music controller — picks the song for the current game state
// (title / area / battle / boss / victory / game over) and drives the
// chiptune engine (Task #222), ducking the volume while modal overlays
// (command menu, save panel) are open.

export class MusicController {
  constructor(opts = {}) {
    this.engine = opts.engine ?? null;
    this.songs = opts.songs ?? {};
    this.regionSongs = opts.regionSongs ?? {};
    this.classify = opts.classify ?? null; // (mapId) => region
    // Task #119: per-map song overrides that win over the region default.
    this.mapSongs = opts.mapSongs ?? {};
    this.enabled = opts.enabled ?? true;
    this.baseVolume = opts.baseVolume ?? 0.22;
    this.duckVolume = opts.duckVolume ?? 0.35; // multiplier while an overlay is open
    // Task #227: audio is off by default — the player turns it on.
    this._muted = opts.startMuted ?? true;
    this._inTitle = opts.startInTitle ?? true;
    this._mapId = null;
    this._region = null;
    this._battle = false;
    this._boss = false;
    this._overlay = false;
    this._transient = null; // { id, onDone } while a one-shot jingle plays
    if (this.engine) {
      for (const [id, def] of Object.entries(this.songs)) this.engine.register(id, def);
      this.engine.onEnd = (id) => this._onEngineEnd(id);
    }
    this._apply();
  }

  // Call on the first user gesture so the audio context can start.
  unlock() {
    if (this.engine && typeof this.engine.unlock === "function") this.engine.unlock();
    this._apply();
    return this;
  }

  setTitle(on) {
    this._inTitle = !!on;
    return this._apply();
  }

  setLocation(mapIdOrRegion) {
    this._mapId = typeof mapIdOrRegion === "string" ? mapIdOrRegion : null;
    this._region =
      this.classify && this._mapId
        ? this.classify(this._mapId)
        : typeof mapIdOrRegion === "string"
          ? mapIdOrRegion
          : null;
    return this._apply();
  }

  setBattle({ active, boss = false }) {
    this._battle = !!active;
    this._boss = !!boss;
    return this._apply();
  }

  // Play a one-shot fanfare/dirge; area music resumes when it ends.
  victory() {
    this._playTransient("victory");
    return this._apply();
  }

  gameOver() {
    this._playTransient("gameover");
    return this._apply();
  }

  setOverlay(on) {
    this._overlay = !!on;
    return this._apply();
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.engine) {
      if (!this.enabled) this.engine.stop();
      else this._apply();
    }
    return this;
  }

  get enabledState() {
    return this.enabled;
  }

  setMuted(m) {
    this._muted = !!m;
    this.engine?.setMuted(this._muted);
    return this;
  }

  mute() {
    return this.setMuted(true);
  }

  unmute() {
    return this.setMuted(false);
  }

  get muted() {
    return this._muted;
  }

  get state() {
    const id = this.engine?.songId ?? null;
    return {
      songId: id,
      label: this.songName(id),
      region: this._region,
      mapId: this._mapId,
      title: this._inTitle,
      battle: this._battle,
      boss: this._boss,
      overlay: this._overlay,
      transient: this._transient?.id ?? null,
      ducked: this._overlay,
      muted: this._muted,
      enabled: this.enabled,
      playing: this.engine?.playing ?? false,
    };
  }

  songName(id) {
    if (!id) return null;
    return this.songs[id]?.name ?? this.engine?.songDef(id)?.name ?? id;
  }

  _playTransient(id) {
    if (this.songs[id]) this._transient = { id };
    return this;
  }

  _desired() {
    if (!this.enabled) return null;
    if (this._transient) return this._transient.id;
    if (this._inTitle) return "menu";
    if (this._battle) return this._boss ? "boss" : "battle";
    if (this._mapId && this.mapSongs[this._mapId]) return this.mapSongs[this._mapId];
    if (this._region) return this.regionSongs[this._region] ?? null;
    return "menu";
  }

  _targetVolume() {
    if (!this.enabled) return 0;
    const mult = this._overlay ? this.duckVolume : 1;
    return this.baseVolume * mult;
  }

  _apply() {
    if (!this.engine) return this;
    const id = this._desired();
    if (this._transient && id !== this._transient.id) this._transient = null;
    if (id) {
      if (this.engine.songId !== id) this.engine.play(id);
    } else {
      this.engine.stop();
    }
    this.engine.setVolume(this._targetVolume());
    this.engine.setMuted(this._muted);
    return this;
  }

  _onEngineEnd(endedId) {
    if (this._transient && this._transient.id === endedId) {
      this._transient = null;
      this._apply();
    }
  }
}
