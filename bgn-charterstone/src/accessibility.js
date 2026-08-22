// src/accessibility.js — Phase 16 accessibility (Task 76).
// Keyboard-only play for the action flow (place → select cell → choose
// option → confirm / retrieve / cancel), color-blind-safe tokens (every
// player/charter also gets a distinct SHAPE, not just a color),
// reduced-motion support (animation classes are skipped when
// prefers-reduced-motion), and WCAG-AA contrast helpers. The keyboard
// model drives the game UI's programmatic action API, so a keyboard-only
// player can complete the whole turn flow.

import { CHARTER_COLORS } from "./player.js";

export const ACCESSIBILITY_VERSION = 1;

export const PLAYER_SHAPES = ["▲", "●", "■", "◆", "⬠", "✚"];

export function shapeForCharter(charterId) {
  const i = ((Number(charterId) % PLAYER_SHAPES.length) + PLAYER_SHAPES.length) % PLAYER_SHAPES.length;
  return PLAYER_SHAPES[i];
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ── WCAG AA contrast (relative luminance per WCAG 2.x) ──
export function luminance(hex) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function isAAOnDark(hex) {
  const r = contrastRatio(hex, "#0d0b14");
  return r !== null && r >= 4.5;
}

export function accessibleTextColor(bgHex) {
  if (bgHex === null || bgHex === undefined) return "#fff";
  const r = contrastRatio(bgHex, "#ffffff");
  if (r === null) return "#fff";
  return r >= 4.5 ? "#ffffff" : "#111111";
}

export function allChartersAA() {
  return Object.entries(CHARTER_COLORS).map(([id, color]) => ({
    charterId: Number(id),
    color,
    pass: isAAOnDark(color),
    ratio: contrastRatio(color, "#0d0b14"),
  }));
}

// ── keyboard control for the action flow ──
export function createAccessibility(opts = {}) {
  const state = opts.state;
  const ui = opts.ui;
  const container = opts.container ?? (typeof document !== "undefined" ? document.body : null);
  const reducedMotion = opts.reducedMotion ?? prefersReducedMotion();

  let enabled = false;
  let cursorKey = null;
  const cellKeys = state ? [...state.board.cells.keys()] : [];
  if (cellKeys.length) cursorKey = cellKeys[0];

  function focusEl() {
    if (!container || !cursorKey) return null;
    const el = container.querySelector('.g-cell[data-cell="' + cursorKey + '"]');
    return el;
  }
  function clearFocus() {
    if (!container) return;
    for (const el of container.querySelectorAll(".g-cell.cs-focus")) el.classList.remove("cs-focus");
  }
  function applyFocus() {
    clearFocus();
    const el = focusEl();
    if (el) el.classList.add("cs-focus");
  }
  function moveCursor(dx, dy) {
    if (!state || !cursorKey) return cursorKey;
    const cell = state.board.cell(cursorKey);
    const target = state.board.cell(cell.q + dx, cell.r + dy);
    if (target && cellKeys.includes(target.key)) cursorKey = target.key;
    applyFocus();
    return cursorKey;
  }
  function cursorTo(key) {
    if (cellKeys.includes(key)) { cursorKey = key; applyFocus(); return true; }
    return false;
  }
  function cursorForward(step) {
    const i = cellKeys.indexOf(cursorKey);
    const j = (i + step + cellKeys.length) % cellKeys.length;
    cursorKey = cellKeys[j];
    applyFocus();
    return cursorKey;
  }

  function handleKey(event) {
    if (!enabled) return false;
    const k = event.key;
    const bar = (container && container.querySelector(".g-actionbar")) || (document && document.querySelector(".g-actionbar"));
    const mode = ui && ui.actions && bar ? bar.dataset.mode : "idle";

    if (k === "Escape") { ui.act("cancel"); return true; }
    if (k === "p" || k === "P") { ui.act("enterPlace"); applyFocus(); return true; }
    if (k === "r" || k === "R") { ui.act("retrieve"); return true; }
    if (k === "Tab") return false; // let normal tab order handle focus

    if (mode === "place" || mode === "construct") {
      const moved = (dx, dy) => {
        const beforeKey = cursorKey;
        moveCursor(dx, dy);
        if (cursorKey === beforeKey) cursorForward(1); // no axial neighbour → step the ring order
        return true;
      };
      if (k === "ArrowRight" || k === "d" || k === "D") { event.preventDefault(); moved(1, 0); return true; }
      if (k === "ArrowLeft" || k === "a" || k === "A") { event.preventDefault(); moved(-1, 0); return true; }
      if (k === "ArrowDown" || k === "s" || k === "S") { event.preventDefault(); moved(0, 1); return true; }
      if (k === "ArrowUp" || k === "w" || k === "W") { event.preventDefault(); moved(0, -1); return true; }
      if (k === "Enter" || k === " ") {
        event.preventDefault();
        const s = ui && ui.getSel ? ui.getSel() : null;
        if (mode === "construct") {
          if (cursorKey) ui.act("selectCell", cursorKey);
        } else if (s && s.cellKey && s.opts) {
          ui.act("confirm"); // a full selection is armed — Enter confirms
        } else if (cursorKey) {
          ui.act("selectCell", cursorKey);
        }
        return true;
      }
      if (/^[1-9]$/.test(k)) {
        ui.act("chooseOption", String(Number(k) - 1));
        return true;
      }
      if (k === "c" || k === "C") { ui.act("confirm"); return true; }
    }
    return false;
  }

  const a11y = {
    version: ACCESSIBILITY_VERSION,
    get enabled() { return enabled; },
    get reducedMotion() { return reducedMotion; },
    get focusKey() { return cursorKey; },
    get cellKeys() { return [...cellKeys]; },
    enable() {
      if (enabled) return a11y;
      enabled = true;
      if (container) {
        container.classList.add("cs-a11y");
        if (reducedMotion) container.classList.add("cs-reduced-motion");
        container.addEventListener("keydown", handleKey);
      }
      applyFocus();
      return a11y;
    },
    disable() {
      if (!enabled) return a11y;
      enabled = false;
      if (container) {
        container.classList.remove("cs-a11y");
        container.classList.remove("cs-reduced-motion");
        container.removeEventListener("keydown", handleKey);
      }
      clearFocus();
      return a11y;
    },
    moveCursor,
    cursorTo,
    cursorForward,
    handleKey,
    applyFocus,
  };
  return a11y;
}
