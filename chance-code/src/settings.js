// settings.js — theme / accent / text-size / motion settings, adapted from the
// rathji-template pattern: localStorage-persisted, URL-overridable, applied via
// html classes + CSS variables, editor theme switched through the CodeMirror
// theme compartment.

const SETTINGS_KEY = "chanceCodeSettings";
const SETTINGS_DEFAULTS = { theme: "dark", accent: "#7c5cff", size: 13, motion: false };
const SIZE_OPTIONS = [13, 15, 16, 18];

export function initSettings({ toast } = {}) {
  const settings = Object.assign({}, SETTINGS_DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) Object.assign(settings, SETTINGS_DEFAULTS, saved);
  } catch (e) {}

  const qp = new URLSearchParams(location.search);
  if (qp.get("theme") === "dark" || qp.get("theme") === "light") settings.theme = qp.get("theme");
  if (qp.get("accent") && /^#[0-9a-fA-F]{6}$/.test(qp.get("accent"))) settings.accent = qp.get("accent");
  const qSize = parseInt(qp.get("size"), 10);
  if (SIZE_OPTIONS.includes(qSize)) settings.size = qSize;
  const qMotion = qp.get("motion");
  if (qMotion !== null) settings.motion = qMotion === "true" || qMotion === "1" || qMotion === "on";

  function save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function apply() {
    const html = document.documentElement;
    html.classList.toggle("light", settings.theme === "light");
    html.classList.toggle("reduce-motion", settings.motion);
    html.style.setProperty("--accent", settings.accent);
    html.style.setProperty("--accent-2", settings.accent);
    html.style.fontSize = settings.size + "px";
    document.querySelectorAll("#themeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === settings.theme));
    document.querySelectorAll("#swatches button").forEach((b) => b.classList.toggle("on", b.dataset.accent === settings.accent));
    document.querySelectorAll("#sizeSeg button").forEach((b) => b.classList.toggle("on", parseInt(b.dataset.size, 10) === settings.size));
    document.getElementById("motionToggle").checked = settings.motion;
    if (window.PC && window.PC.editor && window.PC.editor().setTheme) {
      window.PC.editor().setTheme(settings.theme === "light");
    }
  }

  const panel = document.getElementById("settingsPanel");
  const btn = document.getElementById("actSettingsBtn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    btn.classList.toggle("active", !panel.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !e.target.closest("#settingsPanel") && !e.target.closest("#actSettingsBtn")) {
      panel.hidden = true;
      btn.classList.remove("active");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) { panel.hidden = true; btn.classList.remove("active"); }
  });

  document.getElementById("themeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    settings.theme = b.dataset.theme; save(); apply();
    if (toast) toast(b.dataset.theme === "light" ? "Light theme enabled" : "Dark theme enabled", "ok");
  });
  document.getElementById("swatches").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    settings.accent = b.dataset.accent; save(); apply();
  });
  document.getElementById("sizeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    settings.size = parseInt(b.dataset.size, 10); save(); apply();
  });
  document.getElementById("motionToggle").addEventListener("change", (e) => {
    settings.motion = e.target.checked; save(); apply();
  });
  document.getElementById("settingsReset").addEventListener("click", () => {
    Object.assign(settings, SETTINGS_DEFAULTS);
    save(); apply();
    if (toast) toast("Settings reset to defaults", "ok");
  });

  apply();
  return { apply };
}
