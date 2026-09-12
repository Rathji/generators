import { suite, test, assert } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";
import { ROUTES } from "../views/routes.js";
import { loadDoc } from "./docs.test.js";

export async function loadSrc(name) {
  const url = new URL(`../${name}`, import.meta.url).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name} responded with HTTP ${response.status}`);
  return response.text();
}

suite("Phase 8 integration", () => {
  test("the internal build checklist no longer ships", async () => {
    let reached = false;
    try {
      await loadDoc("ROADMAP.md");
      reached = true;
    } catch (error) {}
    assert(!reached, "src/ROADMAP.md should have been removed before shipping");
    const readme = await loadDoc("README.md");
    assert(!/roadmap\.md/i.test(readme), "the README should not reference the removed checklist");
  });

  test("the README documents the finished project and the help centre", async () => {
    const readme = await loadDoc("README.md");
    assert(readme.includes("all eight phases are complete"), "README should state the project is finished");
    assert(readme.includes("Help & about"), "README should point at the in-app help centre");
  });

  test("the route registry is the single source of truth for the shell", () => {
    const ids = ROUTES.map((route) => route.id);
    assert(new Set(ids).size === ids.length, "route ids should be unique");
    for (const route of ROUTES) {
      assert(typeof route.id === "string" && route.id.length > 1, "each route needs an id");
      assert(typeof route.title === "string" && route.title.length > 1, `${route.id} needs a title`);
      assert(typeof route.render === "function", `${route.id} needs a render function`);
      assert(route.group, `${route.id} needs a nav group`);
    }
  });

  test("the home view marks every phase complete and points at the guide", () => {
    const node = ROUTES.find((route) => route.id === "home").render({ router: { go() {} }, config: getConfig(), shell: {}, hub: null, onDestroy: () => {} });
    const text = node.textContent;
    assert(text.includes("All 8 phases complete"), "home should show the finished status");
    assert(!/ — next\b/.test(text), "no phase should still be marked as next");
    const hrefs = Array.from(node.querySelectorAll('a[href="#/help"]'));
    assert(hrefs.length >= 1, "home should link to the help centre");
  });

  test("shipped source carries no leftover debug markers", async () => {
    const files = [
      "app.js",
      "core/hub.js",
      "core/monitor.js",
      "core/bundles.js",
      "framework/shell.js",
      "views/home.js",
      "views/help.js",
      "views/guides.js",
    ];
    const pattern = /\bTODO\b|\bFIXME\b|\bXXX\b|(^|[^\w.])debugger\s*;|console\.log\(/;
    for (const file of files) {
      const text = await loadSrc(file);
      assert(!pattern.test(text), `${file} should not contain leftover debug markers`);
    }
  });
});
