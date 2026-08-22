// src/music.js — Phase 16 ambient music (Task 74).
// A looping village theme with region-based variation, starting after a
// user gesture (browser autoplay rules). Two same-family tracks — a calm
// village theme and a livelier market variant — crossfade on setRegion().
// Each track is a single <audio> with loop=true (gapless: no re-trigger
// gaps). `unlock()` must be called inside the first user gesture; `start()`
// is a no-op until then.

export const MUSIC_VERSION = 1;

// Rebuild recipe: src/generate_music prompts "calm warm village theme" /
// "lively medieval market variant" (music-generation skill) → MP3 →
// upload_file. URLs below are permanent uploads from this session.
export const MUSIC_TRACKS = {
  village: {
    name: "Village Theme",
    url: "https://user.uploads.dev/file/622eba22fb9473bab48cf02d300ac83c.mp3",
    gain: 0.5,
  },
  market: {
    name: "Market Theme",
    url: "https://user.uploads.dev/file/f02d96ecdf563c1caadf266694f6de14.mp3",
    gain: 0.45,
  },
};

export const REGIONS = Object.freeze(Object.keys(MUSIC_TRACKS));

export function createMusic(opts = {}) {
  const tracks = opts.tracks ?? MUSIC_TRACKS;
  const autoplay = opts.autoplay ?? true;
  let unlocked = false;
  let region = opts.region ?? "village";
  let volume = opts.volume ?? 0.5;
  let started = false;
  let current = null;

  const audio = new Audio();
  audio.loop = true;
  audio.preload = "auto";

  function applyGain(a, target, rampMs = 0) {
    if (!a) return;
    if (rampMs > 0 && a.volume !== target) {
      a.volume = target;
    } else {
      a.volume = target;
    }
  }

  function playTrack(name) {
    const t = tracks[name];
    if (!t) return null;
    const a = new Audio(t.url);
    a.loop = true;
    a.preload = "auto";
    a.volume = 0;
    try { a.play().catch(() => {}); } catch (e) { /* autoplay may reject */ }
    applyGain(a, volume * t.gain, 600);
    return a;
  }

  function stopTrack(a) {
    if (!a) return;
    try { a.pause(); } catch (e) {}
    a.currentTime = 0;
  }

  const music = {
    version: MUSIC_VERSION,
    get unlocked() { return unlocked; },
    get started() { return started; },
    get region() { return region; },
    get volume() { return volume; },
    get audio() { return current; },
    get loop() { return current ? current.loop : audio.loop; },
    set volume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (current) applyGain(current, volume * (tracks[region] ? tracks[region].gain : 0.5), 200);
      return music;
    },
    // MUST be called from a user gesture; thereafter autoplay is permitted.
    unlock() {
      unlocked = true;
      if (autoplay && started && !current) music.start();
      return music;
    },
    start() {
      if (!unlocked) return false;
      if (current) return true;
      started = true;
      current = playTrack(region);
      return true;
    },
    stop() {
      stopTrack(current);
      current = null;
      started = false;
      return music;
    },
    // Crossfade between regions (village theme vs. market variant).
    setRegion(name) {
      if (!tracks[name]) return music;
      if (name === region && current) return music;
      region = name;
      if (!started) return music;
      const old = current;
      current = playTrack(name);
      stopTrack(old);
      return music;
    },
  };
  return music;
}
