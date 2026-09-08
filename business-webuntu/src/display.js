// Webuntu OS — Display settings (Task 69)
// The "hardware panel" half of Control Center — brightness + night light:
// - Brightness is a black overlay (#dimOverlay, pointer-events:none) whose
//   opacity is (1 - brightness/100). It sits above everything except the boot
//   screen, so the whole screen — windows, menus, even the lock and power
//   screens — dims like a real panel.
// - Night light is a warm overlay (#nightOverlay, #ff9a3c,
//   mix-blend-mode:multiply) whose opacity follows the intensity setting —
//   the classic f.lux trick: whites turn cream, darks pick up a warm tint.
// Both persist in webuntu.settings (brightness / nightLight /
// nightIntensity) and re-apply on boot and after "Reset desktop" (Settings
// applyAll routes through here).
//
// The Control Center (src/settings.js) gets a Display section; the tray
// volume popup (src/systembar.js) carries the same quick controls.

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";
  const MIN_BRIGHTNESS = 5; // never allow a fully-black screen (unrecoverable)

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try {
      const s = Object.assign(loadSettings(), patch);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {}
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, Number(v) || lo)); }

  let dimEl = null;
  let nightEl = null;

  function ensureOverlays() {
    if (dimEl && nightEl) return;
    if (!dimEl) {
      dimEl = document.createElement("div");
      dimEl.id = "dimOverlay";
      // No opacity transition on purpose: dimming must apply instantly (and
      // not depend on animation frames firing, which can stall in some
      // embedded previews).
      dimEl.style.cssText =
        "position:fixed;inset:0;z-index:9900;pointer-events:none;background:#000;opacity:0;";
      document.body.appendChild(dimEl);
    }
    if (!nightEl) {
      nightEl = document.createElement("div");
      nightEl.id = "nightOverlay";
      nightEl.style.cssText =
        "position:fixed;inset:0;z-index:9890;pointer-events:none;background:#ff9a3c;mix-blend-mode:multiply;opacity:0;";
      document.body.appendChild(nightEl);
    }
  }

  function nightOpacity() {
    const s = loadSettings();
    const i = s.nightIntensity === undefined ? 50 : clamp(s.nightIntensity, 0, 100);
    return String(0.06 + 0.24 * (i / 100));
  }

  function setBrightness(v, persist = true) {
    ensureOverlays();
    const b = clamp(v, MIN_BRIGHTNESS, 100);
    dimEl.style.opacity = String((100 - b) / 100);
    if (persist) saveSettings({ brightness: b });
    return b;
  }
  function getBrightness() {
    const s = loadSettings();
    return s.brightness === undefined ? 100 : clamp(s.brightness, MIN_BRIGHTNESS, 100);
  }

  function setNightLight(on, persist = true) {
    ensureOverlays();
    const v = !!on;
    nightEl.style.opacity = v ? nightOpacity() : "0";
    if (persist) saveSettings({ nightLight: v });
    return v;
  }
  function getNightLight() { return !!loadSettings().nightLight; }

  function setNightIntensity(v, persist = true) {
    ensureOverlays();
    const i = clamp(v, 0, 100);
    if (getNightLight()) nightEl.style.opacity = String(0.06 + 0.24 * (i / 100));
    if (persist) saveSettings({ nightIntensity: i });
    return i;
  }
  function getNightIntensity() {
    const s = loadSettings();
    return s.nightIntensity === undefined ? 50 : clamp(s.nightIntensity, 0, 100);
  }

  // Re-apply everything from storage. Safe to call any time (boot, Reset,
  // app re-open) — values come from storage; nothing is written here.
  function applyAll() {
    setBrightness(getBrightness(), false);
    setNightIntensity(getNightIntensity(), false);
    setNightLight(getNightLight(), false);
  }

  window.Display = {
    applyAll,
    setBrightness, getBrightness,
    setNightLight, getNightLight,
    setNightIntensity, getNightIntensity,
  };

  applyAll();
})();
