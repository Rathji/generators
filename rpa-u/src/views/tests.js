import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { runTests, listSuites } from "../tests/harness.js";

function renderResults(container, report) {
  mount(container);
  if (!report) {
    container.appendChild(el("div.pu-empty", { text: "No results yet — run the suite to validate the hub." }));
    return;
  }

  const summary = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-bottom": "0.75rem" } });
  summary.appendChild(el(report.failed ? "span.pu-chip.fail" : "span.pu-chip.ok", { text: report.failed ? `${report.failed} failing` : "All passing" }));
  summary.appendChild(el("span.pu-chip", { text: `${report.passed}/${report.total} passed` }));
  summary.appendChild(el("span.pu-chip", { text: `${report.durationMs} ms` }));
  container.appendChild(summary);

  for (const s of report.suites) {
    const card = el("section.pu-card");
    card.appendChild(el("h3", { text: s.name }));
    for (const t of s.tests) {
      const row = el("div.pu-test-row");
      row.appendChild(el("span", { class: t.ok ? "pu-chip ok" : "pu-chip fail", text: t.ok ? "pass" : "fail" }));
      row.appendChild(el("span.pu-test-name", { text: t.name }));
      if (!t.ok) row.appendChild(el("span.pu-test-error", { text: t.error }));
      card.appendChild(row);
    }
    container.appendChild(card);
  }
}

export const testsView = {
  id: "tests",
  title: "Validation tests",
  group: "Developer",
  icon: "beaker",
  nav: true,
  render() {
    const root = el("div");
    root.appendChild(
      pageHead({
        eyebrow: "Developer",
        title: "Validation tests",
        subtitle: "Every roadmap task ships with tests. Run the suite after each change to confirm the hub still behaves.",
      })
    );

    const registered = listSuites();
    const count = registered.reduce((sum, s) => sum + s.tests.length, 0);
    const intro = el("section.pu-card");
    intro.appendChild(el("h2", { text: "Suite" }));
    intro.appendChild(el("p.pu-small", { text: `${count} test${count === 1 ? "" : "s"} across ${registered.length} suite${registered.length === 1 ? "" : "s"} are registered. Results run in the browser so they always reflect the live code.` }));

    const actions = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "0.75rem" } });
    const runBtn = el("button.pu-btn", { type: "button", text: "Run all tests" });
    actions.appendChild(runBtn);
    intro.appendChild(actions);
    root.appendChild(intro);

    const results = el("div", { style: { "margin-top": "1rem" } });
    renderResults(results, null);
    root.appendChild(results);

    runBtn.addEventListener("click", async () => {
      runBtn.disabled = true;
      runBtn.textContent = "Running…";
      try {
        const report = await runTests();
        renderResults(results, report);
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = "Run all tests";
      }
    });

    return root;
  },
};
