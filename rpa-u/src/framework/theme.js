import { storageKey } from "./config.js";

const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/></svg>';
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

export function currentMode() {
  return document.documentElement.getAttribute("data-mode") === "dark" ? "dark" : "light";
}

export function applyMode(mode) {
  const next = mode === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-mode", next);
  document.documentElement.style.colorScheme = next;
  return next;
}

export function persistMode(config, mode) {
  try {
    localStorage.setItem(storageKey(config, "theme:v1"), JSON.stringify({ mode }));
  } catch (e) {}
}

export function applyBranding(config) {
  const root = document.documentElement;
  const b = config.branding || {};
  if (b.primary) root.style.setProperty("--pu-primary", b.primary);
  if (b.accent) root.style.setProperty("--pu-accent", b.accent);
  if (b.fontSans) root.style.setProperty("--pu-font-sans", `"${b.fontSans}", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`);
}

export function initTheme(config, button) {
  applyBranding(config);
  const sync = () => {
    if (!button) return;
    const dark = currentMode() === "dark";
    button.innerHTML = dark ? SUN : MOON;
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  };
  sync();
  if (button) {
    button.addEventListener("click", () => {
      const next = applyMode(currentMode() === "dark" ? "light" : "dark");
      persistMode(config, next);
      sync();
    });
  }
}
