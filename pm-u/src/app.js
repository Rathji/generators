// ============================================================================
//  PM-U — application bootstrap
//  The Project Manager member of the Project U family, built on the
//  Template-U framework (https://perchance.org/template-u) with the
//  project-master feature modules (src/pm/*) vendored underneath.
//
//  This file wires the framework together and paints the shell:
//  config → storage → branding → theme → toaster → PM store → registry →
//  router. Views live in src/views.js; the shell markup is index.html.
// ============================================================================

import { PU } from "./framework/pu.js";
import { createStorage } from "./framework/storage.js";
import { createBranding } from "./framework/branding.js";
import { createTheme } from "./framework/theme.js";
import { createRegistry } from "./framework/registry.js";
import { createRouter } from "./framework/router.js";
import { createToaster } from "./components/toast.js";
import { h, mount, clear } from "./framework/dom.js";
import { runAll as runAllFrameworkTests } from "./tests/index.js";
import { Store } from "./pm/store.js";
import { setToaster, toast } from "./pm/ui.js";
import { ICONS as PM_ICONS } from "./pm/icons.js";
import { Palette } from "./pm/palette.js";
import { importIdentityFromParams } from "./pm/identities.js";
import { buildMemberDescriptor, member, memberUrl, recordHref, mintSharedId, parseSharedId, MEMBERS } from "./pm/integrate.js";
import * as pmTests from "./pm/tests.js";
import { openHelp } from "./pm/help.js";
import * as views from "./views.js";

const GROUP_ORDER = ["Overview", "Plan", "Track", "Tools", "System"];

// --------------------------------------------------------------- config -----
function readNodeValue(value) {
  if (value == null) return undefined;
  if (typeof value === "object") {
    try {
      const evaluated =
        typeof value.evaluateItem === "boolean" || typeof value.evaluateItem === "number" || typeof value.evaluateItem === "string"
          ? value.evaluateItem
          : undefined;
      if (evaluated !== undefined && evaluated !== "") return String(evaluated);
      return undefined;
    } catch (_) {
      return undefined;
    }
  }
  const str = String(value).trim();
  return str || undefined;
}

function readConfig() {
  const fallback = {
    appTitle: "PM-U",
    appShortTitle: "PMU",
    tagline: "Project Manager for the Project U family",
    companyName: "Project U",
    version: PU.version,
    storageNamespace: "pu-pm",
    defaultTheme: "navy",
    logoMark: "PMU",
    footer: "Project U",
    branding: { primary: "", accent: "", fontSans: "Inter" },
  };
  const root = globalThis.root;
  if (!root || !root.pu) return fallback;
  const node = root.pu;
  const config = { ...fallback, branding: { ...fallback.branding } };
  for (const key of Object.keys(config)) {
    if (key === "branding") continue;
    const value = readNodeValue(node[key]);
    if (value !== undefined) config[key] = value;
  }
  if (node.branding) {
    for (const key of ["primary", "accent", "fontSans", "logoUrl", "footer"]) {
      const value = readNodeValue(node.branding[key]);
      if (value !== undefined) config.branding[key] = value;
    }
  }
  return config;
}

const config = readConfig();

// ------------------------------------------------------------- framework ----
const storage = createStorage({ namespace: config.storageNamespace || "pu-pm" });
// Runtime branding overrides live in framework storage (namespace `pu-pm`),
// keyed `branding:v1`; they merge over the main.pjs `pu.branding` config so the
// Settings view can rebrand the app without a source edit (task 14).
const BRANDING_KEY = "branding:v1";
let branding = createBranding(storage.get(BRANDING_KEY, {}) || {}, { config });
const theme = createTheme({
  storage,
  defaultTheme: config.defaultTheme || "navy",
  extraTokens: () => branding.tokens(),
});
const toaster = createToaster({ container: document.getElementById("puToastCtn") });
setToaster(toaster);

// ------------------------------------------------------- PM local store -----
const kv = (globalThis.root && globalThis.root.kv) || null;
const store = new Store({ kv, folder: "pm" });
await store.load();
store.attachFlush();

const pmApi = (window.pm = window.pm || {});
pmApi.store = store;
pmApi.appTitle = branding.get().appTitle || config.appTitle;
pmApi.branding = branding.get();

// ---- branding persistence (Settings → template-u branding config) ----------
// saveBranding(partial) merges overrides, rebuilds the branding controller (so
// switching a theme still resolves brand tokens), re-applies the shell text +
// theme tokens, and mirrors the title into window.pm for generated artifacts.
function applyBranding() {
  branding.applyTo(document);
  theme.apply();
  pmApi.appTitle = branding.get().appTitle;
  pmApi.branding = branding.get();
  return branding.get();
}
function saveBranding(partial) {
  const merged = { ...(storage.get(BRANDING_KEY, {}) || {}), ...partial };
  storage.set(BRANDING_KEY, merged);
  branding = createBranding(merged, { config });
  app.branding = branding;
  const badge = document.getElementById("puVersionBadge");
  if (badge) badge.textContent = `v${branding.get().version || config.version}`;
  return applyBranding();
}
function resetBranding() {
  storage.remove(BRANDING_KEY);
  branding = createBranding({}, { config });
  app.branding = branding;
  const badge = document.getElementById("puVersionBadge");
  if (badge) badge.textContent = `v${branding.get().version || config.version}`;
  return applyBranding();
}

const app = {
  config,
  storage,
  branding,
  theme,
  toaster,
  store,
  registry: null,
  router: null,
  views: {},
  meta: PU.meta,
  saveBranding,
  resetBranding,
};
app.navigate = (path, params) => router.navigate(path, params ? { query: params } : undefined);
app.render = () => router.render();

pmApi.navigate = app.navigate;

// --------------------------------------------------------------- registry ---
const registry = createRegistry({ storage, onChange: () => onRegistryChange() });
app.registry = registry;

function registerView(id, meta, module) {
  registry.register({
    ...meta,
    id,
    render: (outlet, ctx) => module.render(outlet, { ...ctx, app }),
  });
  app.views[id] = module;
}

registerView("dashboard", { label: "Dashboard", icon: "home", group: "Overview", order: 10 }, views.dashboard);
registerView("today", { label: "Today", icon: "timer", group: "Overview", order: 20 }, views.today);
registerView("portfolio", { label: "Portfolio", icon: "chart", group: "Plan", order: 10 }, views.portfolio);
registerView("projects", { label: "Projects", icon: "folder", group: "Plan", order: 20 }, views.projects);
registerView("tasks", { label: "Tasks", icon: "check", group: "Plan", order: 30 }, views.tasks);
registerView("calendar", { label: "Calendar", icon: "calendar", group: "Plan", order: 40 }, views.calendar);
registerView("checklists", { label: "Checklists", icon: "checkSquare", group: "Track", order: 10 }, views.checklists);
registerView("notes", { label: "Notes", icon: "file", group: "Track", order: 20 }, views.notes);
registerView("habits", { label: "Habits", icon: "zap", group: "Track", order: 30 }, views.habits);
registerView("focus", { label: "Focus", icon: "play", group: "Track", order: 40 }, views.focus);
registerView("boards", { label: "Boards", icon: "grid", group: "Tools", order: 10 }, views.boards);
registerView("tags", { label: "Tags", icon: "tag", group: "Tools", order: 20 }, views.tags);
registerView(
  "ecosystem",
  { label: "Project U", icon: "network", group: "Tools", order: 40, description: "Launch sibling Project U tools and share identities by global id." },
  views.ecosystem
);
registerView(
  "assistant",
  {
    label: "Assistant",
    icon: "sparkle",
    group: "Tools",
    order: 30,
    optional: true,
    description: "A local-data-aware AI assistant for planning and reporting.",
  },
  views.assistant
);
registerView("settings", { label: "Settings", icon: "settings", group: "System", order: 10 }, views.settings);
registerView(
  "diagnostics",
  { label: "Diagnostics", icon: "help", group: "System", order: 20, optional: true, description: "Run the in-browser validation suite." },
  views.diagnostics
);
registerView("about", { label: "About", icon: "briefcase", group: "System", order: 30 }, views.about);

// ----------------------------------------------------------------- router ---
const router = createRouter({
  routes: registry.enabledRoutes(),
  defaultRoute: "dashboard",
  notFound: {
    path: "not-found",
    render: (outlet) => {
      outlet.innerHTML = `
        <div class="view-head"><h1>Section not found</h1></div>
        <div class="coming">
          <div class="coming-ico">${PM_ICONS.search}</div>
          <h2>That section doesn't exist</h2>
          <p>It may have been disabled, or the link is wrong.</p>
          <p><a class="btn btn-primary" href="#/dashboard">Back to Dashboard</a></p>
        </div>`;
    },
  },
});
app.router = router;
pmApi.renderView = () => router.render();

function onRegistryChange() {
  router.setRoutes(registry.enabledRoutes());
  renderNav();
  const currentPath = router.current && router.current.path;
  if (currentPath && registry.get(currentPath) && !registry.isEnabled(currentPath)) router.navigate("dashboard");
}

// ------------------------------------------------------------------ shell ---
const menuBtn = document.getElementById("menuBtn");
const backdrop = document.getElementById("puBackdrop");
const sidebar = document.getElementById("puSidebar");
const navCtn = document.getElementById("puNav");
const themeBtn = document.getElementById("puThemeBtn");
const settingsBtn = document.getElementById("puSettingsBtn");
const helpBtn = document.getElementById("puHelpBtn");
const logo = document.getElementById("puLogo");
const searchInput = document.getElementById("quickNavInput");
const searchResults = document.getElementById("quickNavResults");
const saveInd = document.getElementById("puSaveInd");

function pmIcon(name, size = 17) {
  const span = document.createElement("span");
  span.className = "pu-icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = PM_ICONS[name] || "";
  const svg = span.firstElementChild;
  if (svg) {
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.style.display = "block";
  }
  return span;
}

function renderNav() {
  if (!navCtn) return;
  clear(navCtn);
  const items = registry.list({ enabledOnly: true });
  const groups = new Map();
  for (const item of items) {
    const group = item.group || "General";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(item);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => (GROUP_ORDER.indexOf(a[0]) + 1 || 99) - (GROUP_ORDER.indexOf(b[0]) + 1 || 99)
  );
  const current = router.current && router.current.path;
  for (const [group, groupItems] of ordered) {
    const groupEl = h("div", { class: "pu-nav-group" }, h("div", { class: "pu-nav-label" }, group));
    for (const item of groupItems) {
      groupEl.appendChild(
        h(
          "a",
          {
            class: `pu-nav-link${item.id === current ? " is-active" : ""}`,
            href: router.href(item.id),
            dataset: { nav: item.id },
            onclick: () => closeSidebar(),
          },
          pmIcon(item.icon, 17),
          h("span", {}, item.label)
        )
      );
    }
    navCtn.appendChild(groupEl);
  }
}
app.renderNav = renderNav;

function openSidebar() {
  sidebar && sidebar.classList.add("is-open");
  if (backdrop) backdrop.hidden = false;
  menuBtn && menuBtn.setAttribute("aria-expanded", "true");
  document.body.classList.add("pu-nav-open");
}
function closeSidebar() {
  sidebar && sidebar.classList.remove("is-open");
  if (backdrop) backdrop.hidden = true;
  menuBtn && menuBtn.setAttribute("aria-expanded", "false");
  document.body.classList.remove("pu-nav-open");
}
function toggleSidebar() {
  if (sidebar && sidebar.classList.contains("is-open")) closeSidebar();
  else openSidebar();
}

menuBtn && menuBtn.addEventListener("click", toggleSidebar);
backdrop && backdrop.addEventListener("click", closeSidebar);
logo && logo.addEventListener("click", () => closeSidebar());

// ------------------------------------------------------------ theme button --
function syncThemeButton() {
  if (!themeBtn) return;
  const mode = theme.get().mode;
  clear(themeBtn);
  themeBtn.appendChild(pmIcon(mode === "dark" ? "sun" : "moon", 18));
  themeBtn.setAttribute("aria-label", mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
  themeBtn.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
themeBtn && themeBtn.addEventListener("click", () => {
  theme.toggleMode();
  toast(`${theme.get().label} theme applied.`, "info", 1800);
});
theme.subscribe(syncThemeButton);
settingsBtn && settingsBtn.addEventListener("click", () => router.navigate("settings"));

// -------------------------------------------------------------- help button --
// The header "?" opens instructions for whichever section is on screen, and the
// same entry is reachable via the palette's `/help` command and the `?` key.
function openCurrentHelp() {
  const current = router.current || {};
  const tab = current.query && current.query.tab;
  openHelp(current.path || "dashboard", tab ? { tab } : undefined);
}
helpBtn && helpBtn.addEventListener("click", openCurrentHelp);

// ------------------------------------------------------- quick navigation ---
function hideSearchResults() {
  if (searchResults) {
    searchResults.hidden = true;
    searchResults.replaceChildren();
  }
}

function showSearchResults(query) {
  if (!searchResults) return;
  const q = String(query || "").trim().toLowerCase();
  if (!q) {
    hideSearchResults();
    return;
  }
  const matches = registry
    .list({ enabledOnly: true })
    .filter((item) => `${item.label} ${item.description || ""} ${item.group}`.toLowerCase().includes(q));
  if (!matches.length) {
    mount(searchResults, h("div", { class: "pu-search-empty" }, "No matching sections"));
    searchResults.hidden = false;
    return;
  }
  mount(
    searchResults,
    matches.map((item) =>
      h(
        "button",
        {
          class: "pu-search-item",
          type: "button",
          onclick: () => {
            router.navigate(item.id);
            hideSearchResults();
            if (searchInput) searchInput.value = "";
          },
        },
        pmIcon(item.icon, 16),
        h("span", {}, item.label),
        h("span", { class: "pu-search-group" }, item.group)
      )
    )
  );
  searchResults.hidden = false;
}

searchInput && searchInput.addEventListener("input", (event) => showSearchResults(event.target.value));
searchInput && searchInput.addEventListener("focus", (event) => showSearchResults(event.target.value));
searchInput && searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = searchResults && searchResults.querySelector(".pu-search-item");
    if (first) first.click();
  }
});
document.addEventListener("click", (event) => {
  if (!searchResults) return;
  if (!searchResults.contains(event.target) && event.target !== searchInput) hideSearchResults();
});

// ------------------------------------------------------- global shortcuts ---
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSidebar();
    hideSearchResults();
  }
  if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    palette.toggle();
    return;
  }
  // "?" — help for the current section (ignored while typing or with a modal open).
  if (event.key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const tag = (event.target && event.target.tagName) || "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (event.target && event.target.isContentEditable);
    const modalOpen = !!document.querySelector(".modal-backdrop") || !!document.querySelector(".palette-backdrop");
    if (!typing && !modalOpen) {
      event.preventDefault();
      openCurrentHelp();
    }
  }
});

// ------------------------------------------------------------ save state ----
const SAVE_TEXT = { idle: "Saved locally", saving: "Saving…", saved: "Saved locally", error: "Save error" };
function renderSaveInd(state) {
  if (!saveInd) return;
  saveInd.textContent = SAVE_TEXT[state] || SAVE_TEXT.idle;
  saveInd.dataset.state = state;
  saveInd.title = state === "error" ? "Click to retry the failed write" : "All data is stored locally in your browser";
}
store.subscribe((evt) => {
  if (evt.type === "savestate") {
    renderSaveInd(evt.state);
    if (evt.state === "saved") import("./pm/backup.js").then((B) => B.maybeAutoSnapshot(store)).catch(() => {});
  }
});
saveInd && saveInd.addEventListener("click", () => {
  if (store.saveState === "error") {
    toast("Retrying save…");
    store.save();
  }
});

// ---------------------------------------------------- palette + capture ----
const palette = (window.pm.palette = new Palette(store, {
  navigate: (view, params) => app.navigate(view, params),
  cycleTheme: () => {
    theme.toggleMode();
    toast(`${theme.get().label} theme applied.`, "info", 1800);
  },
  help: () => openCurrentHelp(),
  openItem: (type, rec) => {
    const view = { task: "tasks", note: "notes", event: "calendar", checklist: "checklists", project: "projects", board: "boards" }[type] || "dashboard";
    if (type === "project" || type === "board") app.navigate(view, { id: rec.id });
    else app.navigate(view);
  },
}));

import("./pm/quickcapture.js").then((Q) => Q.initQuickCapture(store)).catch(() => {});

// --------------------------------------------------- store → view refresh --
let refreshTimer = null;
store.subscribe((evt) => {
  if (evt.type === "savestate" || evt.type === "loaded") return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (palette.isOpen && palette.isOpen()) return;
    router.render();
  }, 40);
});

// ---------------------------------------------------------------- routes ----
router.subscribe((ctx) => {
  closeSidebar();
  renderNav();
  // The Focus view owns document.title (it shows the live countdown); every
  // other section updates it to "<Section> · <App>".
  if (!ctx || ctx.path !== "focus") {
    const label = ctx && ctx.route && ctx.route.title;
    const b = branding.get();
    document.title = label ? `${label} · ${b.appTitle}` : `${b.appTitle} — ${b.tagline}`;
  }
});

// ------------------------------------------------------------------ boot ----
// The Perchance editor preview appends `#edit` to the iframe URL; treat it as
// "no route" so the default section opens instead of a 404. Harmless in the
// published page (where the hash is normally empty).
if (location.hash === "#edit") history.replaceState(null, "", location.pathname + location.search);

branding.applyTo(document);
theme.apply();
const versionBadge = document.getElementById("puVersionBadge");
if (versionBadge) versionBadge.textContent = `v${branding.get().version || config.version}`;
syncThemeButton();
renderSaveInd(store.saveState);
renderNav();
router.start(document.getElementById("puMain"));

// Developer API surface (see src/API.md).
PU.app = app;
PU.tests = {
  runFramework: runAllFrameworkTests,
  runData: () => pmTests.runAllTests(),
};
PU.config = config;
PU.version = branding.get().version || PU.version;
globalThis.PU = PU;

// Project-U member descriptor (task 21) — the machine-readable manifest the
// central dashboard / Integrate-U read to list, theme and launch pm-u. Mirrors
// the static copy at src/member.json.
PU.member = buildMemberDescriptor({
  title: config.appTitle,
  version: branding.get().version || config.version,
  accent: (config.branding && config.branding.accent) || undefined,
});
pmApi.integrate = { descriptor: PU.member, member, memberUrl, recordHref, mintSharedId, parseSharedId, members: MEMBERS };

// Inbound identity link (task 22): a sibling tool can deep-link here with
// ?ref=<sharedId>&name=<label>; adopt that identity locally and open the hub.
try {
  const parsedQuery = (router.parse(location.hash) || {}).query || {};
  if (parsedQuery.ref) {
    const rec = importIdentityFromParams(store, parsedQuery);
    if (rec) {
      toast("Linked " + rec.type + " “" + rec.name + "” from Project U", "success", 4000);
      app.navigate("ecosystem");
    }
  }
} catch (e) {
  console.warn("[pm-u] identity link skipped:", e);
}

console.info(`[pm-u] ${config.appTitle} v${PU.version} ready — theme: ${theme.get().label} (${theme.get().mode})`);
