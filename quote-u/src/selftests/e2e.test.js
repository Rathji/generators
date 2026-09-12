(function () {
  const T = window.QU_SELFTEST;
  const E = window.QU_E2E;
  if (!T || !E) return;

  T.register("e2e: build → send → open → toggle → approve → downstream runs green against mock data", async () => {
    const run = await E.runScenario();
    if (!run.ok) {
      const bad = run.steps.filter(s => !s.ok).map(s => s.name + ": " + s.detail);
      return { pass: false, detail: bad.join(" | ") || "the scenario did not reach every step" };
    }
    if (run.steps.length !== E.SCENARIO.length) return { pass: false, detail: "ran " + run.steps.length + " of " + E.SCENARIO.length + " steps" };
    return { pass: true, detail: "all " + run.steps.length + " steps passed: " + run.steps.map(s => s.name).join(" → ") };
  });

  T.register("e2e: the boot smoke proves the live shell rendered every station", () => {
    const smoke = E.bootSmoke(document);
    return smoke.ok ? { pass: true, detail: smoke.nav + " stations rendered, view root ready" } : { pass: false, detail: smoke.problems.join(" | ") };
  });

  T.register("e2e: the portal abuse posture holds across the whole scenario", async () => {
    const run = await E.runScenario();
    const abuse = run.steps.find(s => s.name === "abuse");
    if (!abuse) return { pass: false, detail: "the abuse step did not run" };
    if (!abuse.ok) return { pass: false, detail: abuse.detail };
    // Every step's client view must stay cost/margin-free.
    const open = run.steps.find(s => s.name === "open");
    const toggle = run.steps.find(s => s.name === "toggle");
    if (!open.ok || !toggle.ok) return { pass: false, detail: "open/toggle failed: " + (open.detail || "") + " " + (toggle.detail || "") };
    return { pass: true, detail: "replay refused, second approval refused, guessed token denied; client views clean" };
  });
})();
