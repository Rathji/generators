import { suite, test, assert, assertEquals } from "./harness.js";
import { parseHash } from "../framework/router.js";
import { escapeHtml, el } from "../framework/dom.js";

suite("Framework", () => {
  test("router parses hash routes", () => {
    assertEquals(parseHash("#/home"), "home");
    assertEquals(parseHash("#/registry"), "registry");
    assertEquals(parseHash(""), "");
  });

  test("router ignores foreign hashes (e.g. the editor's #edit)", () => {
    assertEquals(parseHash("#edit"), "");
    assertEquals(parseHash("#anything"), "");
  });

  test("router strips query strings and trailing slashes", () => {
    assertEquals(parseHash("#/entities?company=acme"), "entities");
    assertEquals(parseHash("#/sync/"), "sync");
  });

  test("escapeHtml neutralises markup", () => {
    assertEquals(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    assertEquals(escapeHtml("a & b"), "a &amp; b");
  });

  test("el builds elements with classes, attrs and children", () => {
    const node = el("div.pu-card.accent", { dataset: { id: "x" }, attrs: { "aria-label": "hi" } }, "text ", el("span", { text: "child" }));
    assert(node.classList.contains("pu-card") && node.classList.contains("accent"), "classes missing");
    assertEquals(node.dataset.id, "x");
    assertEquals(node.getAttribute("aria-label"), "hi");
    assertEquals(node.textContent, "text child");
  });
});
