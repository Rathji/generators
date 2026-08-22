// Task #161: Game Settings Menu data — the tunable settings and their
// allowed values. `type` drives the menu UI (range / toggle / select);
// `default` seeds a fresh profile.

export const SETTINGS_DEFAULTS = {
  audio: {
    label: "Audio Volume",
    type: "range",
    min: 0,
    max: 1,
    step: 0.1,
    default: 0.2,
    hint: "Master volume for sound effects and music",
  },
  muted: {
    label: "Muted",
    type: "toggle",
    default: true,
    hint: "Silence all audio (off by default — turn it on here or via the Audio button)",
  },
  textSpeed: {
    label: "Text Speed",
    type: "select",
    options: [
      { value: "slow", label: "Slow" },
      { value: "normal", label: "Normal" },
      { value: "fast", label: "Fast" },
    ],
    default: "normal",
    hint: "Dialogue scroll rate",
  },
  screen: {
    label: "Screen Size",
    type: "select",
    options: [
      { value: "small", label: "Compact" },
      { value: "normal", label: "Normal" },
      { value: "large", label: "Large" },
    ],
    default: "normal",
    hint: "UI scale (screen resolution option)",
  },
};

// Characters-per-second for each text-speed option.
export const TEXT_SPEED_CPS = Object.freeze({
  slow: 30,
  normal: 45,
  fast: 90,
});

// CSS font-size scale for each screen-size option (0.9 / 1 / 1.15).
export const SCREEN_SCALES = Object.freeze({
  small: 0.9,
  normal: 1,
  large: 1.15,
});
