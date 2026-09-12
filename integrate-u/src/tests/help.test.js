import { suite, test, assert, assertEquals } from "./harness.js";
import { createHub } from "../core/hub.js";
import { getConfig } from "../framework/config.js";
import { ROUTES } from "../views/routes.js";
import { GUIDES, CONCEPTS } from "../views/guides.js";
import { helpView, screenGuide } from "../views/help.js";

const ROUTE_IDS = ROUTES.map((route) => route.id);

function renderRoute(route, hub) {
  const destroys = [];
  const byId = new Map(ROUTES.map((entry) => [entry.id, entry]));
  const router = { go() {}, currentId: () => route.id, routes: ROUTES, byId, resolve: (id) => byId.get(id) || null };
  const shell = { setActive() {}, setBadge() {}, setNavOpen() {} };
  const ctx = { router, config: getConfig(), shell, hub, onDestroy: (fn) => { if (typeof fn === "function") destroys.push(fn); } };
  const node = route.render(ctx);
  return { node, destroys };
}

function teardown(destroys) {
  for (const fn of destroys) {
    try {
      fn();
    } catch (error) {}
  }
}

suite("Help & guides", () => {
  test("every route has a guide and every guide maps to a route", () => {
    const guideIds = GUIDES.map((guide) => guide.id).sort();
    assert(guideIds.length === ROUTE_IDS.length, `expected ${ROUTE_IDS.length} guides, got ${guideIds.length}`);
    assertEquals(guideIds, ROUTE_IDS.slice().sort());
    assert(new Set(guideIds).size === guideIds.length, "guide ids should be unique");
  });

  test("every guide is substantive and has a purpose and numbered steps", () => {
    for (const guide of GUIDES) {
      assert(guide.title && guide.title.length > 2, `${guide.id} should have a title`);
      assert(typeof guide.purpose === "string" && guide.purpose.length > 40, `${guide.id} should have a real purpose`);
      assert(Array.isArray(guide.steps) && guide.steps.length >= 2, `${guide.id} should list at least two steps`);
      for (const step of guide.steps) assert(typeof step === "string" && step.length > 20, `${guide.id} has a short step: ${step}`);
    }
  });

  test("the glossary defines the shared vocabulary", () => {
    assert(CONCEPTS.length >= 8, "the glossary should cover the core concepts");
    for (const concept of CONCEPTS) {
      assert(concept.term && concept.term.length > 2, "every concept needs a term");
      assert(concept.detail && concept.detail.length > 30, `concept "${concept.term}" needs a real definition`);
    }
  });

  test("screenGuide builds a disclosure for every screen and nothing for unknown ids", () => {
    for (const id of ROUTE_IDS) {
      if (id === "help") continue;
      const node = screenGuide(id);
      assert(node && node.tagName === "DETAILS", `${id} should get a guide panel`);
      assert(node.textContent.includes("How to use this screen"), `${id} guide should be labelled`);
    }
    assert(screenGuide("does-not-exist") === null, "unknown screens get no guide");
  });

  test("every route renders, carries a guide and links only to known routes", async () => {
    const hub = await createHub({ kv: null }).ready();
    const known = new Set(ROUTE_IDS);
    for (const route of ROUTES) {
      const { node, destroys } = renderRoute(route, hub);
      try {
        assert(node && node.nodeType === 1, `${route.id} should render an element`);
        assert(node.textContent.trim().length > 0, `${route.id} should render content`);
        const guide = screenGuide(route.id);
        if (route.id !== "help" && guide) node.appendChild(guide);
        const hrefs = Array.from(node.querySelectorAll('a[href^="#/"]')).map((a) => a.getAttribute("href"));
        for (const href of hrefs) {
          const target = href.slice(2).split("?")[0].replace(/\/+$/, "");
          if (!target) continue;
          assert(known.has(target), `${route.id} links to unknown route "${href}"`);
        }
      } finally {
        teardown(destroys);
      }
    }
  });

  test("the help view presents the quick start, index, guides, glossary and about", () => {
    const hub = createHub({ kv: null });
    const node = helpView.render({ router: { go() {} }, config: getConfig(), shell: {}, hub, routes: ROUTES, onDestroy: () => {} });
    const text = node.textContent;
    for (const heading of ["New here?", "What each screen is for", "Step-by-step guides", "Key concepts", "About Integrate-U"]) {
      assert(text.includes(heading), `Help view should contain "${heading}"`);
    }
    assert(text.includes(`v${getConfig().version}`), "Help view should show the version");
    assert(text.includes("Integrate-U"), "Help view should name the product");
  });
});
