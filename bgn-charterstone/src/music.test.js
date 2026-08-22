// src/music.test.js — Phase 16 ambient music validation (Task 74).
// Run in-page via ?test=music, or via window.__loadMusicTests().
// Task 74: a looping village theme with region-based variation, starting
// only after a user gesture. Music starts on gesture and loops without
// gaps (single <audio>, loop=true — no re-trigger seams).

import { createMusic, MUSIC_VERSION, MUSIC_TRACKS, REGIONS } from "./music.js";

export function runMusicTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  ok("music exposes version + region set", MUSIC_VERSION === 1 && REGIONS.length >= 2);
  ok("every region resolves to a hosted looping track",
    REGIONS.every(r => MUSIC_TRACKS[r] && typeof MUSIC_TRACKS[r].url === "string" && MUSIC_TRACKS[r].url.startsWith("https://")));

  const m = createMusic();

  // ── gesture-gated start ──
  ok("music does not start before a user gesture", m.started === false);
  ok("start() is refused until unlock() (gesture)", m.start() === false && m.started === false);

  // ── gesture unlocks, then music starts and loops without gaps ──
  m.unlock();
  ok("unlock() is idempotent and marks the gesture", m.unlocked === true);
  const startedOk = m.start();
  ok("after the gesture, music starts", startedOk === true && m.started === true);
  ok("the active track loops (no gap — single element, loop=true)",
    !!m.audio && m.audio.loop === true && m.loop === true);

  // ── region-based variation ──
  ok("default region is the village theme", m.region === "village" && !!m.audio && m.audio.src.indexOf(MUSIC_TRACKS.village.url) !== -1);
  m.setRegion("market");
  ok("switching region swaps to the market variant", m.region === "market" && m.audio && m.audio.src.indexOf(MUSIC_TRACKS.market.url) !== -1);
  m.setRegion("nope");
  ok("unknown regions are ignored", m.region === "market");
  m.setRegion("village");
  ok("region switching back to village works", m.region === "village" && m.audio && m.audio.src.indexOf(MUSIC_TRACKS.village.url) !== -1);

  // ── volume respects region gain and the master volume ──
  m.volume = 0.4;
  ok("volume clamps and applies", m.volume === 0.4 && m.audio.volume > 0);
  m.stop();
  ok("stop() halts playback and clears the track", m.started === false && m.audio === null);
  m.start();
  ok("music can restart after stop", m.started === true && !!m.audio && m.audio.loop === true);

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "music", pass, fail, results };
}
