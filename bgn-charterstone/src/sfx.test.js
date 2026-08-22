// src/sfx.test.js — Phase 16 sound-effect validation (Task 73).
// Run in-page via ?test=sfx, or via window.__loadSfxTests().
// Task 73: WebAudio-synthesized SFX for placement, bump, coin gain,
// construction, crate unlock and game end, with a mute toggle. The mute
// contract: while muted, NOTHING is scheduled for playback.

import { createSFX, SFX_VERSION } from "./sfx.js";

export function runSfxTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  const sfx = createSFX();
  ok("sfx exposes version + all six effects", SFX_VERSION === 1 &&
    ["place", "bump", "coin", "construct", "crate", "end"].every(k => typeof sfx[k] === "function"));
  ok("sfx starts unmuted", sfx.muted === false);

  // ── muting silences all SFX ──
  sfx.setMuted(true);
  sfx.place(); sfx.bump(); sfx.coin(); sfx.construct(); sfx.crate(); sfx.end();
  ok("while muted every effect schedules nothing", sfx.scheduled === 0, "scheduled=" + sfx.scheduled);
  ok("mute state toggles", sfx.muted === true && sfx.setMuted(false).muted === false);

  // ── unmuted effects schedule output ──
  sfx.place();
  ok("unmuted placement schedules sound", sfx.scheduled === 1);
  sfx.bump(); sfx.coin();
  ok("bump + coin schedule sound", sfx.scheduled === 4); // 1 bump + 2 coin tones
  const before = sfx.scheduled;
  sfx.construct(); sfx.crate(); sfx.end();
  ok("all six effects schedule output when unmuted", sfx.scheduled === before + 10, "scheduled=" + sfx.scheduled); // construct 4 + crate 2 + end 4

  // ── mute toggle silences even an in-flight sequence ──
  sfx.setMuted(true);
  const frozen = sfx.scheduled;
  sfx.place(); sfx.construct(); sfx.end();
  ok("re-muting stops further scheduling immediately", sfx.scheduled === frozen);
  sfx.setMuted(false);

  // ── unlock is safe (creates/keeps an AudioContext, resumes if suspended) ──
  ok("unlock() runs without throwing", (() => { try { sfx.unlock(); return true; } catch (e) { return false; } })());
  ok("effects still schedule after unlock", (() => { const n = sfx.scheduled; sfx.place(); return sfx.scheduled === n + 1; })());

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "sfx", pass, fail, results };
}
