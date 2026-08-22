// Validation tests for Tasks #77/#78: UI Screen Transition Animations.

import { ScreenTransitionSystem, TRANSITION_KINDS } from "../engine/screen-transitions.js";

// Fake time: instant waits, record every style application.
function makeSys() {
  const applied = [];
  let waitMs = 0;
  const sys = new ScreenTransitionSystem({
    duration: 50,
    wait: async (ms) => {
      waitMs += ms;
    },
    apply: (styles) => applied.push(styles),
  });
  sys._testWaitMs = () => waitMs;
  return { sys, applied, get waitMs() { return waitMs; } };
}

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  check("transition kinds defined", TRANSITION_KINDS.FADE === "fade" && TRANSITION_KINDS.SLIDE === "slide");

  const { sys, applied } = makeSys();
  check("not running initially", !sys.isRunning());

  // fadeOut applies opacity 1 and waits.
  return (async () => {
    await sys.fadeOut();
    check("fadeOut records phase", sys.log.some((l) => l.name === "fadeOut"));
    check("fadeOut applied opacity 1", applied.some((s) => s.opacity === "1"));
    check("fadeOut waited duration", sys._testWaitMs() >= 50);

    await sys.fadeIn();
    check("fadeIn applied opacity 0", applied.some((s) => s.opacity === "0"));

    // transition() runs the mid-step between out and in.
    const mid = makeSys();
    let ran = 0;
    const res = await mid.sys.transition(() => {
      ran++;
      return 42;
    });
    check("transition ran mid fn", ran === 1 && res.mid === 42);
    check("transition toggled running", !mid.sys.isRunning());
    const phases = mid.sys.log.map((l) => l.name);
    check("transition is fadeOut then fadeIn", phases[0] === "fadeOut" && phases[1] === "fadeIn");

    // flash applies a color and clears.
    const fl = makeSys();
    await fl.sys.flash("red", 10);
    check("flash applied background", fl.applied.some((s) => s.background === "red"));
    check("flash logged", fl.sys.log.some((l) => l.name === "flash"));

    // slide records direction.
    const sl = makeSys();
    await sl.sys.slide("right");
    check("slide logged with direction", sl.sys.log.some((l) => l.name === "slide" && l.dir === "right"));
    check("slide applied transform", sl.applied.some((s) => typeof s.transform === "string"));

    // Reentrancy guard.
    const re = makeSys();
    re.sys.running = true;
    const denied = await re.sys.transition(() => {});
    check("transition rejected while running", denied.ok === false && denied.error.includes("running"));

    return out;
  })();
}
