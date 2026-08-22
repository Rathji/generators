// Validation tests for Task #60: Flavor Text Database.

import { FlavorSystem } from "../engine/flavor.js";
import { FLAVOR_TEXTS } from "../data/flavor.js";

function seeded() {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return rnd;
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("database has categories", ["town", "inn", "cave", "castle", "rumor", "weather"].every((c) => FLAVOR_TEXTS[c]?.length));

  const sys = new FlavorSystem(FLAVOR_TEXTS, { random: seeded() });
  check("categories", sys.categories().includes("town") && sys.categories().length === Object.keys(FLAVOR_TEXTS).length);
  check("line count", sys.count("town") === 5);

  const first = sys.pick("town");
  check("pick returns a line", first && typeof first.text === "string");
  check("first pick is fresh", first.fresh === true);
  check("text belongs to category", FLAVOR_TEXTS.town.some((l) => (typeof l === "string" ? l === first.text : l.text === first.text)));

  check("seen counted", sys.seenCount() === 1 && sys.seenCount("town") === 1);

  // Keep picking; every line is fresh until the category is exhausted.
  let n = 0;
  const cyc = () => (n++ % 6) / 6;
  const f = new FlavorSystem(FLAVOR_TEXTS, { random: cyc });
  const ids = [];
  for (let i = 0; i < f.count("town"); i++) {
    ids.push(f.pick("town").id);
  }
  check("first five picks are all unique", new Set(ids).size === ids.length);
  check("unseen empty after exhaustion", f.unseen("town").length === 0);
  check("exhausted after all seen", f.exhausted("town") === true);

  check("pickMany", sys.pickMany("rumor", 2).length === 2);

  check("noRepeat false allows repeats", (() => {
    const f = new FlavorSystem({ x: ["a", "b"] }, { random: () => 0 });
    const a = f.pick("x", { noRepeat: false });
    const b = f.pick("x", { noRepeat: false });
    return a.text === "a" && b.text === "a" && a.fresh === true && b.fresh === false;
  })());

  check("empty category null", new FlavorSystem().pick("nope") === null);
  check("string entries supported", (() => {
    const f = new FlavorSystem({ town: ["Plain line"] }, { random: () => 0 });
    return f.pick("town").text === "Plain line";
  })());

  check("resetSeen", (() => {
    const f = new FlavorSystem({ cave: [{ id: "c1", text: "a" }] }, { random: () => 0 });
    f.pick("cave");
    f.resetSeen();
    return f.seenCount() === 0 && f.exhausted("cave") === false;
  })());

  check("speaker passthrough", (() => {
    const f = new FlavorSystem({ town: [{ id: "t1", text: "hi", speaker: "Elder" }] }, { random: () => 0 });
    return f.pick("town").speaker === "Elder";
  })());

  return out;
}
