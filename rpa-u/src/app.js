import { getConfig } from "./framework/config.js";
import { mountShell, pageHead } from "./framework/shell.js";
import { createRouter } from "./framework/router.js";
import { el, mount } from "./framework/dom.js";
import { toast } from "./framework/toast.js";
import { createHub } from "./core/hub.js";
import { createAccessControl } from "./core/identity/guards.js";
import { ROUTES } from "./views/routes.js";
import { screenGuide } from "./views/help.js";
import { renderSignin } from "./views/signin.js";
import { identityIndicator } from "./views/identity-ui.js";
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
    console.warn("RPA-U: persistent storage unavailable, continuing in memory.", error);
    return await createHub({ kv: null, config }).ready();
  }
}

const hub = await bootHub();
const routes = ROUTES;
const shell = mountShell({ config, routes });

const access = createAccessControl({
  session: hub.auth,
  onDenied: (denial) => toast(denial.message, { tone: "error" }),
});
access.applyHub(hub);

const identityCtn = document.getElementById("puIdentityCtn");

function renderIdentity() {
  if (!identityCtn) return;
  const snap = hub.auth.snapshot();
  const show = access.enabled() && snap.authenticated;
  identityCtn.hidden = !show;
  if (!show) {
    mount(identityCtn);
    return;
  }
  mount(identityCtn, identityIndicator(hub, { onOpen: () => router.go("access") }));
}

function syncDriftBadge() {
  const open = hub.alerts.openCount();
  shell.setBadge("drift", open);
}

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

function renderUnauthorized(route) {
  const required = access.routePermission(route.id);
  const denial = access.denialFor(required);
  const node = el("div");
  node.appendChild(
    pageHead({
      eyebrow: "Unauthorized",
      title: "Access denied",
      subtitle: `Your role does not permit the “${route.title || route.id}” screen.`,
    })
  );
  const card = el("section.pu-card");
  card.appendChild(el("div.pu-alert", { class: "fail", text: denial.message }));
  const snap = hub.auth.snapshot();
  card.appendChild(
    el("p.pu-small", {
      text: `You are signed in as ${(snap.user && snap.user.name) || "a user"} with ${snap.roleLabels.join(", ") || "no role"}. Ask an administrator to grant the ${denial.requiredLabel} role or higher.`,
    })
  );
  const actions = el("div.pu-form-actions");
  actions.appendChild(el("a.pu-btn.secondary", { href: "#/home", text: "Back to overview" }));
  actions.appendChild(el("a.pu-btn.secondary", { href: "#/access", text: "View your roles & permissions" }));
  card.appendChild(actions);
  node.appendChild(card);
  return node;
}

let teardown = [];
let gateDestroy = null;

function clearGate() {
  if (gateDestroy) {
    try {
      gateDestroy();
    } catch (error) {}
    gateDestroy = null;
  }
}

function renderSigninGate() {
  clearGate();
  const gate = renderSignin({ hub, config });
  gateDestroy = gate.destroy;
  mount(main, gate.node);
  access.applyDom(document);
  window.scrollTo({ top: 0, behavior: "auto" });
}

const overlay = el("div.pu-session-overlay", { hidden: true });
const overlayCard = el("div.pu-session-card.pu-card");
const overlayBody = el("div");
overlayCard.appendChild(overlayBody);
overlay.appendChild(overlayCard);
document.body.appendChild(overlay);

function hideOverlay() {
  overlay.hidden = true;
}

function showExpiredOverlay(snap) {
  mount(overlayBody);
  overlayBody.appendChild(el("h2", { text: "Your session has expired" }));
  overlayBody.appendChild(
    el("p.pu-small", {
      text: snap.error || "The identity token is no longer valid. Sign in again to continue — you will return to the same screen.",
    })
  );
  const actions = el("div.pu-form-actions");
  const again = el("button.pu-btn", { type: "button", text: "Sign in again" });
  again.addEventListener("click", () => {
    hideOverlay();
    router.go(router.currentId());
  });
  const out = el("button.pu-btn.secondary", { type: "button", text: "Sign out" });
  out.addEventListener("click", async () => {
    await hub.auth.signOut();
  });
  actions.appendChild(again);
  actions.appendChild(out);
  overlayBody.appendChild(actions);

  const accounts = hub.auth.accounts();
  if (snap.showSimulator && accounts.length) {
    overlayBody.appendChild(el("p.pu-small.pu-muted", { text: "Or resume instantly with a demo account:" }));
    const quick = el("div.pu-chips");
    for (const account of accounts) {
      const btn = el("button.pu-chip.pu-chip-btn", { type: "button", text: account.roleLabel || account.role });
      btn.title = `${account.name} — ${account.roleLabel || account.role}`;
      btn.addEventListener("click", async () => {
        await hub.auth.signInWithSimulator(account.id);
      });
      quick.appendChild(btn);
    }
    overlayBody.appendChild(quick);
  }
  overlay.hidden = false;
}

function handleAuthChange(snap) {
  renderIdentity();
  access.applyDom(document);
  if (!access.enabled()) return;
  if (snap.authenticated) {
    hideOverlay();
    router.go(router.currentId());
    return;
  }
  if (snap.status === "expired") {
    showExpiredOverlay(snap);
    return;
  }
  hideOverlay();
  router.go(router.currentId());
}

const router = createRouter({
  routes,
  fallbackId: "home",
  onRoute(route, id) {
    for (const fn of teardown) {
      try {
        fn();
      } catch (error) {
        console.warn("RPA-U: view teardown failed", error);
      }
    }
    teardown = [];
    clearGate();

    const snap = hub.auth.snapshot();
    shell.setActive(route ? route.id : "");

    if (access.enabled() && !snap.authenticated && snap.requireSignIn) {
      document.body.classList.add("pu-signed-out");
      renderSigninGate();
      return;
    }
    document.body.classList.remove("pu-signed-out");

    const targetId = route ? route.id : id;
    const required = access.routePermission(targetId);
    if (access.enabled() && snap.authenticated && required && !access.can(required)) {
      shell.setActive("");
      mount(main, renderUnauthorized(route || { id: targetId, title: targetId }));
      access.notifyDenied(required, { route: targetId });
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const ctx = { router, config, shell, hub, access, onDestroy: (fn) => { if (typeof fn === "function") teardown.push(fn); } };
    const view = route ? route.render(ctx) : renderNotFound(id);
    if (route && route.id !== "help" && view.nodeType === 1) {
      const guide = screenGuide(route.id);
      if (guide) view.appendChild(guide);
    }
    mount(main, view);
    access.applyDom(main);
    window.scrollTo({ top: 0, behavior: "auto" });
  },
});

let lastStatus = hub.auth.snapshot().status;
hub.auth.subscribe((snap) => {
  const changed = snap.status !== lastStatus;
  lastStatus = snap.status;
  renderIdentity();
  access.applyDom(document);
  if (changed) handleAuthChange(snap);
});

syncDriftBadge();
hub.bus.subscribe("alert.*", () => syncDriftBadge(), { label: "Drift alert badge", priority: -5 });

let applyScheduled = false;
function scheduleApplyDom() {
  if (applyScheduled) return;
  applyScheduled = true;
  setTimeout(() => {
    applyScheduled = false;
    access.applyDom(main);
  }, 0);
}
try {
  const observer = new MutationObserver(() => scheduleApplyDom());
  observer.observe(main, { childList: true, subtree: true });
} catch (error) {}

async function handleEntraRedirect() {
  if (!access.enabled()) return;
  const parsed = hub.auth.providers.entra.parseRedirect(window.location.href);
  if (!parsed.code && !parsed.error) return;
  await hub.auth.completeEntraSignIn(window.location.href);
  try {
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState(null, document.title, clean);
  } catch (error) {}
}

await handleEntraRedirect();
renderIdentity();
router.start();

window.puApp = { config, router, routes, hub, access };
window.puTests = { run: (options) => runTests(options), list: listSuites };
