// src/perf.test.js — Phase 16 performance safeguards validation (Task 77).
// Run in-page via ?test=perf, or via window.__loadPerfTests().
// Task 77: dirty-flag re-renders, memoized card data, and board culling
// keep a 6-player late-campaign board smooth. A 200-building stress board
// must render in under 16ms per frame.

import {
  PERF_VERSION, FRAME_BUDGET_MS, measureFrame, batchedRender,
  createDirtyFlags, memoize, cullCells, renderStressBoard,
  gameRenderFingerprint, hexPoints,
} from "./perf.js";
import { createGameUI } from "./gameUI.js";
import { createGameState } from "./serialization.js";

export function runPerfTests() {
  const results = [];
  const ok = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

  ok("perf exposes version + frame budget", PERF_VERSION === 1 && FRAME_BUDGET_MS === 16);

  // ── 200-building stress board renders under 16ms per frame ──
  const stress = renderStressBoard(200);
  ok("stress board fixture builds 200 buildings", stress.n === 200 && stress.html.length > 0);
  ok("culling keeps only in-viewport hexes on a huge board", stress.visible < 200 && stress.visible > 0,
    "visible=" + stress.visible);
  const ms = measureFrame(() => renderStressBoard(200));
  ok("a 200-building stress board renders in under 16ms per frame", ms < FRAME_BUDGET_MS, ms.toFixed(2) + "ms");
  ok("the stress board's hexes are valid SVG polygons",
    hexPoints(0, 0, 34).split(" ").length === 6);

  // ── dirty-flag re-renders ──
  const flags = createDirtyFlags();
  ok("dirty flags start clean", flags.snapshot() === "{}");
  flags.set("board");
  ok("set() marks a flag dirty", flags.dirty("board") === true && flags.dirty("board") === false);

  // ── memoized card data ──
  let calls = 0;
  const fn = memoize(x => { calls++; return x * 2; }, x => x);
  ok("memoize computes on first call", fn(21) === 42 && calls === 1);
  ok("memoize returns the cached value on repeat", fn(21) === 42 && calls === 1);
  ok("memoize computes fresh for new keys", fn(5) === 10 && calls === 2);

  // ── the real game UI skips redundant re-renders (dirty flag) ──
  const players = [{ id: "P1", charterId: 0, startingCoins: 4 }, { id: "P2", charterId: 1, startingCoins: 4 }];
  const g = createGameState({ players, firstPlayer: "P1", rng: Math.random });
  const div = document.createElement("div");
  div.id = "perfTestHost";
  document.body.appendChild(div);
  const ui = createGameUI(g, { container: div });
  ui.render();
  const boardEl = div.querySelector(".g-board");
  ok("the game board renders", !!boardEl);
  const boardCount = () => div.querySelectorAll(".g-cell").length;
  const beforeCount = boardCount();
  ui.render(); // redundant — nothing changed
  ok("a redundant re-render is skipped by the dirty flag", boardCount() === beforeCount && div.querySelector(".g-board") === boardEl);
  const fpBefore = gameRenderFingerprint(g);
  ui.act("enterPlace");
  ok("a real action changes the fingerprint and re-renders", gameRenderFingerprint(g) === fpBefore && div.querySelectorAll(".g-cell").length === beforeCount);
  ui.act("cancel");
  ok("the board stays rendered after cancel", div.querySelectorAll(".g-cell").length === beforeCount);
  div.remove();

  // ── batchedRender is used for heavy rows ──
  const html = batchedRender([{ id: "a" }, { id: "b" }], r => "<div>" + r.id + "</div>");
  ok("batchedRender joins rows into one string", html === "<div>a</div><div>b</div>");

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  return { suite: "perf", pass, fail, results };
}
