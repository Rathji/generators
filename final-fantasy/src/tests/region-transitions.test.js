// Validation tests for Task #120: overworld transition visuals (region fade/pan).

import { RegionTransitionSystem } from "../engine/region-transitions.js";

function fakeScreen() {
  const calls = [];
  return {
    calls,
    isRunning: () => false,
    async fadeOut(opts = {}) { calls.push("fadeOut:" + (opts.duration ?? 220)); },
    async fadeIn(opts = {}) { calls.push("fadeIn:" + (opts.duration ?? 220)); },
    async slide(dir, opts = {}) { calls.push("slide:" + dir + ":" + (opts.duration ?? 220)); },
    async flash() {},
  };
}

export async function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const coords = (id) => ({
    overworld: { x: 0, y: 0 },
    cornelia: { x: 0, y: 1 },
    pravog: { x: 2, y: 0 },
    caves_of_cornelia: { x: 0, y: 2 },
  }[id] ?? null);

  const screen = fakeScreen();
  const sys = new RegionTransitionSystem({ screen, coords });

  check("regionOf overworld", sys.regionOf("overworld") === "overworld");
  check("regionOf town", sys.regionOf("cornelia") === "town");
  check("regionOf dungeon", sys.regionOf("caves_of_cornelia") === "dungeon");

  check("region change overworld->cornelia", sys.isRegionChange("overworld", "cornelia") === true);
  check("region change same map false", sys.isRegionChange("cornelia", "cornelia") === false);
  check("region change same region false", sys.isRegionChange("cornelia", "cornelia_inn") === false);
  check("region change town->dungeon", sys.isRegionChange("cornelia", "caves_of_cornelia") === true);

  check("direction overworld->cornelia S", sys.direction("overworld", "cornelia") === "S");
  check("direction overworld->pravog E", sys.direction("overworld", "pravog") === "E");
  check("direction pravog->overworld W", sys.direction("pravog", "overworld") === "W");
  check("direction overworld->caves S", sys.direction("overworld", "caves_of_cornelia") === "S");
  check("direction unknown center", sys.direction("overworld", "nope") === "center");

  const d = sys.describe("overworld", "cornelia");
  check("describe reports region change + direction", d.regionChange === true && d.direction === "S");

  let swaps = 0;
  const res = await (async () => sys.transitionTo("overworld", "cornelia", () => { swaps++; }, { duration: 100 }))();
  check("transition ok", res.ok === true && res.direction === "S");
  check("swap ran once", swaps === 1);
  check("fade out then pan in", screen.calls[0] === "fadeOut:100" && screen.calls[1] === "slide:up:100");
  check("transition log recorded", sys.log.some((l) => l.name === "fadeOut") && sys.log.some((l) => l.name === "panIn"));

  const noScreen = new RegionTransitionSystem({ coords });
  let swaps2 = 0;
  const res2 = await (async () => noScreen.transitionTo("overworld", "cornelia", () => { swaps2++; }))();
  check("no-screen mode swaps immediately", swaps2 === 1 && res2.usedScreen === false);

  const s2 = fakeScreen();
  const sys2 = new RegionTransitionSystem({ screen: s2, coords });
  await (async () => sys2.transitionTo("overworld", "nope", () => {}, {}))();
  check("unknown dest uses fade (center)", s2.calls.includes("fadeIn:" + sys2.duration));

  return out;
}
