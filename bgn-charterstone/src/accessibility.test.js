// src/accessibility.test.js — Phase 16 accessibility validation (Task 76).
// Run in-page via ?test=accessibility, or via window.__loadAccessibilityTests().
// Task 76: keyboard-only play for the action flow (place → pick a cell →
// choose an option → confirm / retrieve / cancel), color-blind-safe tokens
// (shape + color per charter), reduced-motion CSS, and WCAG AA contrast.

import { createGameUI } from "./gameUI.js";
import { createGameState } from "./serialization.js";
import { STARTING_SETUP } from "./indexGuide.js";
import {
  ACCESSIBILITY_VERSION, PLAYER_SHAPES, shapeForCharter,
  prefersReducedMotion, luminance, contrastRatio, accessibleTextColor,
  isAAOnDark, allChartersAA, createAccessibility,
} from "./accessibility.js";

function buildState() {
  const players = [{ id: "P1", charterId: 0, startingCoins: 4 }];
  return createGameState({ players, firstPlayer: "P1", rng: Math.random });
}

export function runAccessibilityTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  // ── color-blind-safe tokens: shape + color ──
  ok("accessibility exposes version + shapes", ACCESSIBILITY_VERSION === 1 && PLAYER_SHAPES.length >= 6);
  ok("every charter has a distinct shape", [...new Set([0, 1, 2, 3, 4, 5].map(shapeForCharter))].length === 6);

  // ── WCAG AA contrast ──
  ok("luminance helper computes standard relative luminance",
    Math.abs(luminance("#ffffff") - 1) < 0.01 && luminance("#000000") === 0);
  ok("contrastRatio of black/white is ~21:1", Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.5);
  const aa = allChartersAA();
  ok("every charter color passes WCAG AA contrast on the dark board", aa.length === 6 && aa.every(c => c.pass === true),
    aa.filter(c => !c.pass).map(c => c.color + " " + c.ratio).join(","));
  ok("accessibleTextColor picks a legible text color per background", (() => {
    for (const c of aa) {
      const tc = accessibleTextColor(c.color);
      const r = contrastRatio(c.color, tc);
      if (r === null || r < 4.5) return false;
    }
    return true;
  })());
  ok("isAAOnDark flags only passing colors", aa.every(c => isAAOnDark(c.color) === c.pass));

  // ── reduced motion ──
  ok("prefersReducedMotion() returns a boolean", typeof prefersReducedMotion() === "boolean");
  const rmContainer = document.createElement("div");
  const rmState = buildState();
  const rmUI = createGameUI(rmState, { container: rmContainer });
  const rmA11y = createAccessibility({ state: rmState, ui: rmUI, container: rmContainer, reducedMotion: true });
  rmA11y.enable();
  ok("reduced-motion mode adds the CSS class", rmContainer.classList.contains("cs-reduced-motion"));
  rmA11y.disable();
  rmContainer.remove();

  // ── keyboard-only action flow ──
  const div = document.createElement("div");
  div.id = "a11yTestHost";
  document.body.appendChild(div);
  const g = buildState();
  g.economy.gain("P1", { metal: 1, coal: 1, clay: 2 }); // afford Treasury costs for the keyboard flow
  const ui = createGameUI(g, { container: div });
  const a11y = createAccessibility({ state: g, ui, container: div, reducedMotion: true });
  a11y.enable();
  ok("a11y enables and exposes the focus cursor", a11y.enabled === true && a11y.focusKey !== null);

  const treasury = g.board.commonsBuildings().find(b => b.buildingId === "treasury").cell;
  a11y.cursorTo(treasury.key);

  const key = k => new KeyboardEvent("keydown", { key: k, cancelable: true });
  div.dispatchEvent(key("p"));
  ok("key P enters placement mode", (div.querySelector(".g-actionbar") || {}).dataset.mode === "place");
  div.dispatchEvent(key("Enter"));
  ok("Enter selects the focused cell (Treasury → option chooser)", (() => {
    const ch = div.querySelector("#chooserPanel");
    return !!ch && ch.hidden === false;
  })());
  div.dispatchEvent(key("1"));
  ok("a digit key picks an option", ui.getSel() && ui.getSel().opts && typeof ui.getSel().opts.resource === "string");
  div.dispatchEvent(key("c"));
  ok("key C confirms the placement", g.board.workerAt(treasury) === "P1");
  ok("action flow returns to idle after confirm", (div.querySelector(".g-actionbar") || {}).dataset.mode === "idle");
  ok("the placed worker carries its charter's shape in the board DOM", (() => {
    const cellEl = div.querySelector('.g-cell[data-cell="' + treasury.key + '"]');
    const shape = cellEl && cellEl.querySelector(".g-worker-shape");
    return !!shape && shape.textContent === shapeForCharter(0);
  })());
  ok("P1 spent a worker on the placement", g.player("P1").workers === 1);
  div.dispatchEvent(key("r"));
  ok("key R retrieves workers", g.player("P1").workers === 2 && g.board.workerAt(treasury) === null);

  // arrow-key navigation moves the cursor while in placement mode
  div.dispatchEvent(key("p"));
  const before = a11y.focusKey;
  div.dispatchEvent(key("ArrowRight"));
  ok("arrow keys move the focus cursor", a11y.focusKey !== before);
  div.dispatchEvent(key("Escape"));
  ok("Escape cancels placement mode", (div.querySelector(".g-actionbar") || {}).dataset.mode === "idle");

  // the whole flow is also reachable through moveCursor → selectCell
  ui.act("enterPlace");
  a11y.cursorTo(treasury.key);
  div.dispatchEvent(key("Enter"));
  div.dispatchEvent(key("2"));
  div.dispatchEvent(key("Enter"));
  ok("a second keyboard-only turn completes (Enter to confirm too)", g.board.workerAt(treasury) === "P1");

  a11y.disable();
  ok("a11y disables cleanly", a11y.enabled === false && !div.classList.contains("cs-a11y"));
  div.remove();

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "accessibility", pass, fail, results };
}
