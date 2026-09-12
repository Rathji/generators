// ============================================================================
//  View — Validation tests
// ============================================================================

import { h, svgIcon } from "../framework/dom.js";
import { pageHeader, card, statTile, grid, badge, codeBlock, banner } from "./helpers.js";
import { runAll } from "../tests/index.js";

export function render(outlet, ctx) {
  const { app } = ctx;
  const resultsCtn = h("div", { class: "pu-stack-2" });
  const summaryCtn = h("div", { class: "pu-grid pu-grid--4 pu-gap-md" });
  const runBtn = h(
    "button",
    { class: "pu-btn pu-btn--primary", type: "button" },
    svgIcon("play", { size: 16 }),
    h("span", {}, "Run all tests")
  );

  let running = false;
  async function run() {
    if (running) return;
    running = true;
    runBtn.disabled = true;
    runBtn.classList.add("is-loading");
    summaryCtn.replaceChildren(statTile({ label: "Status", value: "Running…", icon: "refresh", hint: "executing suites" }));
    resultsCtn.replaceChildren(
      h("div", { class: "pu-loading" }, h("span", { class: "pu-spinner" }), h("span", {}, "Running validation tests…"))
    );
    try {
      const report = await runAll();
      renderReport(report);
      if (report.ok) app.toaster.success(`All ${report.total} tests passed.`);
      else app.toaster.error(`${report.failed} of ${report.total} tests failed.`);
    } catch (error) {
      console.error("[pu:tests] run failed", error);
      resultsCtn.replaceChildren(banner({ tone: "danger", title: "Test run crashed", children: error.message }));
      app.toaster.error("The test runner crashed.");
    } finally {
      running = false;
      runBtn.disabled = false;
      runBtn.classList.remove("is-loading");
    }
  }

  function renderReport(report) {
    summaryCtn.replaceChildren(
      statTile({ label: "Passed", value: String(report.passed), icon: "check", tone: "success" }),
      statTile({ label: "Failed", value: String(report.failed), icon: "error", tone: report.failed ? "danger" : "success" }),
      statTile({ label: "Total", value: String(report.total), icon: "table" }),
      statTile({ label: "Duration", value: `${report.durationMs} ms`, icon: "refresh" })
    );

    resultsCtn.replaceChildren(
      ...report.suites.map((suite) =>
        card({
          title: suite.name,
          subtitle: `${suite.passed}/${suite.results.length} passed`,
          actions: badge(suite.failed ? `${suite.failed} failed` : "All passed", suite.failed ? "danger" : "success", { icon: suite.failed ? "error" : "check" }),
          body: h(
            "ul",
            { class: "pu-test-list" },
            suite.results.map((test) =>
              h(
                "li",
                { class: `pu-test${test.ok ? " is-pass" : " is-fail"}` },
                h("span", { class: "pu-test-icon" }, svgIcon(test.ok ? "check" : "error", { size: 15 })),
                h("div", { class: "pu-test-body" }, h("span", { class: "pu-test-name" }, test.name), test.error ? h("span", { class: "pu-test-error" }, test.error) : null),
                h("span", { class: "pu-test-ms" }, `${test.ms} ms`)
              )
            )
          ),
        })
      )
    );
  }

  runBtn.addEventListener("click", run);

  outlet.replaceChildren(
    pageHeader({
      title: "Validation tests",
      subtitle: "The framework's self-check suite — pure-function, state and component tests.",
      icon: "check",
      actions: runBtn,
    }),
    banner({
      tone: "info",
      title: "How to read this",
      children: "Each suite exercises one part of the build. A green run means every framework module still behaves as specified after your changes.",
    }),
    summaryCtn,
    resultsCtn
  );

  run();
}
