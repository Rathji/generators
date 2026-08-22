// Validation tests for Task #161: Game Settings Menu — validated persisted
// values, apply hooks into live systems, and derived text-speed / screen
// scale helpers.

import { SettingsStore } from "../engine/settings.js";
import { SETTINGS_DEFAULTS, TEXT_SPEED_CPS, SCREEN_SCALES } from "../data/settings.js";

function fakeStorage() {
  const map = {};
  return {
    setItem(k, v) { map[k] = v; },
    getItem(k) { return k in map ? map[k] : null; },
    removeItem(k) { delete map[k]; },
    dump: () => map,
  };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("defaults defined", SETTINGS_DEFAULTS.audio.default === 0.2 && SETTINGS_DEFAULTS.muted.default === true);
  check("text speed map", TEXT_SPEED_CPS.fast === 90 && TEXT_SPEED_CPS.slow === 30);
  check("screen scales", SCREEN_SCALES.normal === 1 && SCREEN_SCALES.large === 1.15);

  const storage = fakeStorage();
  const s = new SettingsStore({ storage });

  check("defaults loaded", s.get("audio") === 0.2 && s.get("muted") === true && s.get("textSpeed") === "normal");
  check("textCps default", s.textCps() === 45);
  check("screenScale default", s.screenScale() === 1);

  // Validation: range clamps.
  s.set("audio", 5);
  check("range clamps high", s.get("audio") === 1);
  s.set("audio", -3);
  check("range clamps low", s.get("audio") === 0);
  s.set("audio", 0.6);
  check("range accepts in-band", s.get("audio") === 0.6);

  // Toggle coercion.
  s.set("muted", true);
  check("toggle set", s.get("muted") === true);
  s.set("muted", "false");
  check("toggle coerces string", s.get("muted") === false);

  // Select values pass through.
  s.set("textSpeed", "fast");
  check("select passes through", s.get("textSpeed") === "fast" && s.textCps() === 90);

  // Persistence writes through.
  check("persisted", storage.dump()["ff_settings_audio"] === "0.6" && storage.dump()["ff_settings_textSpeed"] === "fast");

  // Unknown keys are rejected.
  check("unknown rejected", s.set("nope", 1).ok === false);

  // A second store over the same storage picks up persisted values.
  const s2 = new SettingsStore({ storage });
  check("reload restores", s2.get("audio") === 0.6 && s2.get("textSpeed") === "fast");

  // Apply hooks fire on set.
  const calls = {};
  s.on("audio", (v) => { calls.audio = v; });
  s.on("textSpeed", () => { calls.cps = s.textCps(); });
  s.set("audio", 0.25);
  s.set("textSpeed", "slow");
  check("hooks fired", calls.audio === 0.25 && calls.cps === 30);

  // applyTo wires the game systems (mocked ff).
  const store = new SettingsStore({ storage: fakeStorage() });
  const touched = { sound: null, muted: null, cps: null };
  store.applyTo({
    sounds: { setVolume: (v) => { touched.sound = v; } },
    music: { setMuted: (v) => { touched.muted = v; } },
    textScroller: { cps: null },
  });
  store.set("audio", 0.9);
  store.set("muted", true);
  store.set("textSpeed", "fast");
  check("applyTo drives sound volume", touched.sound === 0.9);
  check("applyTo drives mute", touched.muted === true);
  check("applyTo drives text speed", store.values.textSpeed === "fast");

  // Reset restores every default.
  s.set("audio", 0.3);
  s.set("textSpeed", "slow");
  s.reset();
  check("reset restores defaults", s.get("audio") === 0.2 && s.get("textSpeed") === "normal" && s.get("muted") === true);

  return out;
}
