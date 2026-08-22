// Task #161: Game Settings Menu engine — a persisted settings store with
// validated values and per-key apply hooks. The menu UI renders `all()` and
// writes through `set()`; hooks push values into the live systems (music,
// sound, text speed, UI scale). Persists as individual prefixed storage keys.

import { SETTINGS_DEFAULTS, TEXT_SPEED_CPS, SCREEN_SCALES } from "../data/settings.js";

export class SettingsStore {
  constructor(opts = {}) {
    this.defs = opts.defs ?? SETTINGS_DEFAULTS;
    this.storage = opts.storage ?? null;
    this.prefix = opts.prefix ?? "ff_settings_";
    this.hooks = {}; // key -> (value) => void
    this.values = {};
    for (const [k, d] of Object.entries(this.defs)) this.values[k] = this._load(k, d);
  }

  _load(k, d) {
    if (!this.storage) return d.default;
    const raw = this.storage.getItem(this.prefix + k);
    if (raw == null) return d.default;
    return this._coerce(String(raw), d);
  }

  _coerce(raw, d) {
    if (d.type === "toggle") return raw === "true";
    if (d.type === "range") {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return d.default;
      return Math.min(d.max, Math.max(d.min, n));
    }
    return String(raw);
  }

  get(k) {
    return k in this.values ? this.values[k] : this.defs[k]?.default ?? null;
  }

  // Validate + persist a new value, then fire that key's hook (if any).
  set(k, v) {
    const d = this.defs[k];
    if (!d) return { ok: false, error: "unknown_setting", key: k };
    const coerced = this._coerce(String(v), d);
    this.values[k] = coerced;
    if (this.storage) this.storage.setItem(this.prefix + k, String(coerced));
    if (this.hooks[k]) {
      try {
        this.hooks[k](coerced);
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e), key: k };
      }
    }
    return { ok: true, key: k, value: coerced };
  }

  on(k, fn) {
    this.hooks[k] = fn;
    return this;
  }

  all() {
    return Object.keys(this.defs).map((k) => ({ key: k, def: this.defs[k], value: this.values[k] }));
  }

  reset() {
    for (const k of Object.keys(this.defs)) this.set(k, this.defs[k].default);
    return this;
  }

  // Derived conveniences used by the UI.
  textCps() {
    return TEXT_SPEED_CPS[this.get("textSpeed")] ?? TEXT_SPEED_CPS.normal;
  }

  screenScale() {
    return SCREEN_SCALES[this.get("screen")] ?? SCREEN_SCALES.normal;
  }

  // Wire hooks into the live game systems (music, sounds, text scroller).
  applyTo(ff) {
    this.on("audio", (v) => {
      ff?.sounds?.setVolume?.(v);
      ff?.music?.setVolume?.(v);
    });
    this.on("muted", (v) => {
      ff?.music?.setMuted?.(v);
      ff?.sounds?.setMuted?.(v);
    });
    this.on("textSpeed", () => {
      if (ff?.textScroller) ff.textScroller.cps = this.textCps();
    });
    this.on("screen", () => {
      if (ff?.screenScale) ff.screenScale.set(this.screenScale());
    });
    // Push current values out to the systems on (re)wiring.
    for (const k of Object.keys(this.defs)) this.hooks[k]?.(this.get(k));
    return this;
  }

  // Live-screen scale controller (settings-driven UI zoom).
  static createScale(opts = {}) {
    const ctl = {
      scale: 1,
      el: opts.root ?? null,
      set(s) {
        this.scale = s;
        if (this.el) this.el.style.fontSize = (16 * s).toFixed(1) + "px";
        return this.scale;
      },
      // Attach a root element later (the demo UI mounts asynchronously).
      bind(el) {
        this.el = el;
        return this.set(this.scale);
      },
    };
    return ctl;
  }
}
