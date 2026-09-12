import { getConfig } from "./framework/config.js";
import { mountShell, pageHead } from "./framework/shell.js";
import { createRouter } from "./framework/router.js";
import { el, mount } from "./framework/dom.js";
import { createHub } from "./core/hub.js";
import { ROUTES } from "./views/routes.js";
import { screenGuide } from "./views/help.js";
import { runTests, listSuites } from "./tests/index.js";

const config = getConfig();
const main = document.getElementById("puMain");

async function bootHub() {
  let kv = null;
  try {
    kv = window.root?.kv || null;
  } catch (e) {}
  try {
    return await createHub({ kv, config }).ready();
  } catch (error) {
    console.warn("Integrate-U: persistent storage unavailable, continuing in memory.", error);
    return await createHub({ kv: null, config }).ready();
  }
}

const hub = await bootHub();
const routes = ROUTES;
const shell = mountShell({ config, routes });

function syncDriftBadge() {
  const open = hub.alerts.openCount();
  shell.setBadge("drift", open);
}

syncDriftBadge();
hub.bus.subscribe("alert.*", () => syncDriftBadge(), { label: "Drift alert badge", priority: -5 });

function renderNotFound(id) {
  const node = el("div");
  node.appendChild(pageHead({ eyebrow: "Not found", title: "Unknown section", subtitle: `No section matches "${id}". Pick one from the navigation.` }));
  const card = el("section.pu-card");
  const list = el("ul.pu-list");
  for (const route of routes) {
    list.appendChild(el("li", {}, el("a", { href: `#/${route.id}`, text: route.title })));
  }
  card.appendChild(list);
  node.appendChild(card);
  return node;
}

let teardown = [];

const router = createRouter({
  routes,
  fallbackId: "home",
  onRoute(route, id) {
    for (const fn of teardown) {
      try {
        fn();
      } catch (error) {
        console.warn("Integrate-U: view teardown failed", error);
      }
    }
    teardown = [];
    shell.setActive(route ? route.id : "");
    const ctx = { router, config, shell, hub, onDestroy: (fn) => { if (typeof fn === "function") teardown.push(fn); } };
    const view = route ? route.render(ctx) : renderNotFound(id);
    if (route && route.id !== "help" && view.nodeType === 1) {
      const guide = screenGuide(route.id);
      if (guide) view.appendChild(guide);
    }
    mount(main, view);
    window.scrollTo({ top: 0, behavior: "auto" });
  },
});

router.start();

window.puApp = { config, router, routes, hub };
window.puTests = { run: (options) => runTests(options), list: listSuites };
