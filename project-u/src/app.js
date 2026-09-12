// ============================================================================
//  Project U — application bootstrap
//  Wires the framework together and paints the shell: config → storage →
//  branding → theme → state → registry → toaster → router. Keep this file
//  focused on assembly; screens belong in src/views/.
// ============================================================================

import { PU } from "./framework/pu.js";
import { createStorage } from "./framework/storage.js";
import { createBranding } from "./framework/branding.js";
import { createTheme } from "./framework/theme.js";
import { createAppState } from "./framework/state.js";
import { createPreferences } from "./framework/preferences.js";
import { createActivitySource } from "./framework/activity.js";
import { createMemberSource } from "./framework/members.js";
import { createRegistry } from "./framework/registry.js";
import { createRouter } from "./framework/router.js";
import { createToaster } from "./components/toast.js";
import { createCommandPalette } from "./components/command-palette.js";
import { h, mount, svgIcon, clear } from "./framework/dom.js";
import { colorFromString, initials } from "./framework/utils.js";
import { launchMember, markActiveMember, clearActiveMember, copyMemberLink, memberLink } from "./framework/launch.js";
import { buildCommands, runCommand, COMMAND_KINDS } from "./framework/commands.js";
import { runAll as runAllTests } from "./tests/index.js";
import * as homeView from "./views/home.js";
import * as activityView from "./views/activity.js";
import * as settingsView from "./views/settings.js";
import * as testsView from "./views/tests.js";
import * as aboutView from "./views/about.js";

const GROUP_ORDER = ["Hub", "Manage", "Resources", "General"];

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
    appTitle: "Project-U",
    appShortTitle: "PU",
    tagline: "Your Project U command centre",
    companyName: "Project U",
    version: PU.version,
    storageNamespace: "pu-project-u",
    defaultTheme: "navy",
    logoMark: "PU",
    copyright: "Project U",
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

const storage = createStorage({ namespace: config.storageNamespace || "pu-project-u" });
const branding = createBranding({}, { config });
const theme = createTheme({
  storage,
  defaultTheme: config.defaultTheme || "navy",
  extraTokens: () => branding.tokens(),
});
const state = createAppState();
const preferences = createPreferences({ storage });

// Phase 6, tasks 27-28 — QA switches for exercising the loading and error
// states in the live preview without touching the registry: `?fail=registry`
// makes the member directory unreachable, `?fail=activity` takes the activity
// source offline (combine with a comma). Normal visits carry neither.
const bootFlags = new Set(
  String(new URLSearchParams(location.search).get("fail") || "")
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean)
);
const roster = createMemberSource({
  latency: 240,
  failWith: bootFlags.has("registry") ? new Error("the member directory is unreachable") : null,
});
const activity = createActivitySource({
  failWith: bootFlags.has("activity") ? new Error("the activity service is offline") : null,
});
const toaster = createToaster({ container: document.getElementById("puToastCtn") });

const app = {
  config,
  storage,
  branding,
  theme,
  state,
  preferences,
  activity,
  roster,
  toaster,
  registry: null,
  router: null,
  views: {},
  members: PU.members,
  navigate: (path) => router.navigate(path),
  meta: PU.meta,
  // Member launch API (Phase 2) — keeps URL building + active-state tracking in
  // one place so every view launches members the same way.
  launchMember: (member, opts = {}) => {
    const result = launchMember(member, { state, ...opts });
    if (result.ok && result.member) preferences.recordRecent(result.member.id);
    return result;
  },
  markActiveMember: (member) => {
    const resolved = markActiveMember(member, { state });
    if (resolved) preferences.recordRecent(resolved.id);
    return resolved;
  },
  clearActiveMember: () => clearActiveMember({ state }),
  copyMemberLink: (member) => copyMemberLink(member),
  memberLink: (member) => memberLink(member),
  // Launcher ordering (Phase 4): pinned members first, then registry order.
  orderMembers: (members) => preferences.orderMembers(members),
  isPinned: (member) => preferences.isPinned(member && member.id ? member.id : member),
  togglePin: (member) => preferences.togglePin(member && member.id ? member.id : member),
  pinnedMembers: () => preferences.pinned.map((id) => PU.members.getMember(id)).filter(Boolean),
  recentMembers: () =>
    preferences
      .get()
      .recents.map((entry) => ({ id: entry.id, at: entry.at, member: PU.members.getMember(entry.id) }))
      .filter((entry) => entry.member),
  // Member directory (Phase 6, tasks 27-28): the launcher renders skeleton cards
  // until the async directory resolves, and falls back to the bundled registry
  // (with a retry) if it fails.
  reloadRoster: () => {
    roster.invalidate();
    return roster.fetch().then(
      () => router.render(),
      () => router.render()
    );
  },
};

// ------------------------------------------------------------------ registry --
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

registerView("home", { label: "Home", icon: "home", group: "Hub", order: 10, defaultEnabled: true }, homeView);
registerView(
  "activity",
  { label: "Activity", icon: "chart", group: "Hub", order: 20, defaultEnabled: true, description: "A live stream of events from across the -U suite." },
  activityView
);
registerView("settings", { label: "Settings", icon: "settings", group: "Manage", order: 10, defaultEnabled: true }, settingsView);
registerView("tests", { label: "Tests", icon: "check", group: "Resources", order: 20, optional: true, defaultEnabled: true, description: "Run the in-browser validation suite." }, testsView);
registerView("about", { label: "About", icon: "book", group: "Resources", order: 30, defaultEnabled: true }, aboutView);

// -------------------------------------------------------------------- router --
const router = createRouter({
  routes: registry.enabledRoutes(),
  defaultRoute: "home",
  notFound: {
    path: "not-found",
    render: (outlet) => {
      mount(
        outlet,
        h(
          "div",
          { class: "pu-page" },
          h("h1", { class: "pu-page-title" }, "Section not found"),
          h("p", { class: "pu-page-subtitle" }, "That section does not exist — it may have been disabled, or the link is wrong."),
          h("a", { class: "pu-btn pu-btn--primary", href: "#/home" }, "Back to Home")
        )
      );
    },
  },
});
app.router = router;

// Preference changes (pins, recents, launcher settings) repaint the current
// section so the launcher and its history row reflect them immediately.
preferences.subscribe(() => {
  if (app.router.current) app.router.render();
});

function onRegistryChange() {
  router.setRoutes(registry.enabledRoutes());
  renderNav();
  const currentPath = router.current && router.current.path;
  if (currentPath && registry.get(currentPath) && !registry.isEnabled(currentPath)) router.navigate("home");
}

// --------------------------------------------------------------------- shell --
const menuBtn = document.getElementById("menuBtn");
const backdrop = document.getElementById("puBackdrop");
const sidebar = document.getElementById("puSidebar");
const navCtn = document.getElementById("puNav");
const themeBtn = document.getElementById("puThemeBtn");
const settingsBtn = document.getElementById("puSettingsBtn");
const logo = document.getElementById("puLogo");
const quickNavBtn = document.getElementById("quickNavBtn");
const wsBtn = document.getElementById("puWorkspaceBtn");
const wsMenu = document.getElementById("puWorkspaceMenu");
const wsName = document.getElementById("puWorkspaceName");
const wsDot = document.getElementById("puWorkspaceDot");
const userBtn = document.getElementById("puUserBtn");
const userMenu = document.getElementById("puUserMenu");
const userAvatar = document.getElementById("puUserAvatar");
const userName = document.getElementById("puUserName");
const userRole = document.getElementById("puUserRole");

function renderNav() {
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
          svgIcon(item.icon, { size: 17 }),
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

// --------------------------------------------------- workspace selector + user --
function closeHeaderMenus(except) {
  if (wsMenu && except !== wsMenu) wsMenu.hidden = true;
  if (userMenu && except !== userMenu) userMenu.hidden = true;
  if (wsBtn && except !== wsMenu) wsBtn.setAttribute("aria-expanded", "false");
  if (userBtn && except !== userMenu) userBtn.setAttribute("aria-expanded", "false");
}

function renderWorkspaceMenu() {
  if (!wsMenu) return;
  const active = state.activeWorkspace();
  mount(
    wsMenu,
    h("div", { class: "pu-menu-head" }, "Switch workspace"),
    state.getWorkspaces().map((workspace) =>
      h(
        "button",
        {
          class: `pu-ws-item${active && workspace.id === active.id ? " is-active" : ""}`,
          type: "button",
          onclick: () => {
            state.setWorkspace(workspace.id);
            closeHeaderMenus();
            toaster.info(`Switched to ${workspace.name}.`, { duration: 1800 });
          },
        },
        h("span", { class: "pu-ws-dot", style: { background: colorFromString(workspace.id) } }),
        h("span", { class: "pu-ws-text" }, h("span", { class: "pu-ws-name" }, workspace.name), h("span", { class: "pu-ws-kind" }, workspace.kind)),
        workspace.id === (active && active.id) ? svgIcon("check", { size: 15, className: "pu-ws-check" }) : null
      )
    )
  );
}

function renderUserMenu() {
  if (!userMenu) return;
  const user = state.get().user;
  mount(
    userMenu,
    h("div", { class: "pu-menu-head" }, "Signed in"),
    h(
      "div",
      { class: "pu-user-card" },
      h("span", { class: "pu-avatar pu-avatar--lg" }, user.initials),
      h("span", { class: "pu-user-card-text" }, h("span", { class: "pu-user-card-name" }, user.name), h("span", { class: "pu-user-card-mail" }, user.email))
    ),
    h(
      "button",
      {
        class: "pu-menu-action",
        type: "button",
        onclick: () => {
          closeHeaderMenus();
          router.navigate("settings");
        },
      },
      svgIcon("settings", { size: 15 }),
      h("span", {}, "Manage preferences")
    )
  );
}

function renderIdentity() {
  const active = state.activeWorkspace();
  const user = state.get().user;
  if (wsName) wsName.textContent = active ? active.name : "No workspace";
  if (wsDot) wsDot.style.background = active ? colorFromString(active.id) : "var(--pu-text-subtle)";
  if (userName) userName.textContent = user.name;
  if (userRole) userRole.textContent = user.role;
  if (userAvatar) userAvatar.textContent = user.initials || initials(user.name);
  renderWorkspaceMenu();
  renderUserMenu();
}

wsBtn &&
  wsBtn.addEventListener("click", () => {
    const willOpen = wsMenu && wsMenu.hidden;
    closeHeaderMenus(wsMenu);
    if (wsMenu) wsMenu.hidden = !willOpen;
    wsBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
userBtn &&
  userBtn.addEventListener("click", () => {
    const willOpen = userMenu && userMenu.hidden;
    closeHeaderMenus(userMenu);
    if (userMenu) userMenu.hidden = !willOpen;
    userBtn.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

state.subscribe(() => {
  renderIdentity();
  if (router.current) router.render();
});

// ---------------------------------------------------------------- theme button --
function syncThemeButton() {
  if (!themeBtn) return;
  const mode = theme.get().mode;
  clear(themeBtn);
  themeBtn.appendChild(svgIcon(mode === "dark" ? "sun" : "moon", { size: 18 }));
  themeBtn.setAttribute("aria-label", mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
  themeBtn.title = mode === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
themeBtn &&
  themeBtn.addEventListener("click", () => {
    theme.toggleMode();
    toaster.info(`${theme.get().label} theme applied.`, { duration: 1800 });
  });
theme.subscribe(syncThemeButton);
settingsBtn && settingsBtn.addEventListener("click", () => router.navigate("settings"));
logo && logo.addEventListener("click", () => closeSidebar());

// --------------------------------------------------- command palette (Phase 3) --
// One search surface for the whole hub: members (deep-link launch + copy link),
// enabled sections (navigate) and quick actions (theme / focus). The header
// trigger and Ctrl/⌘+K both open it; the component owns focus + scroll lock.
function hubActions() {
  const darkMode = theme.get().mode === "dark";
  return [
    {
      id: "toggle-theme",
      title: `Switch to ${darkMode ? "light" : "dark"} mode`,
      subtitle: "Appearance",
      description: "Toggle the light / dark colour mode.",
      icon: darkMode ? "sun" : "moon",
      keywords: ["theme", "dark", "light", "appearance", "colour", "color", "mode"],
      order: 10,
      run: () => {
        theme.toggleMode();
        toaster.info(`${theme.get().label} theme applied.`, { duration: 1600 });
      },
    },
    {
      id: "clear-focus",
      title: "Clear generator focus",
      subtitle: "Launcher",
      description: "Forget which member the launcher currently has in focus.",
      icon: "close",
      keywords: ["focus", "clear", "active", "launcher", "reset", "unselect"],
      order: 20,
      run: () => {
        const had = state.activeMemberId ? PU.members.getMember(state.activeMemberId) : null;
        state.clearActiveMember();
        toaster.info(had ? `Cleared ${had.name} from focus.` : "Nothing was in focus.", { duration: 1800 });
      },
    },
  ];
}

function paletteSections() {
  return registry.list({ enabledOnly: true }).map((item) => ({
    id: item.id,
    title: item.label,
    group: item.group,
    icon: item.icon,
    description: item.description || "",
    order: item.order,
    path: item.id,
  }));
}

function paletteCommands() {
  return buildCommands({ members: preferences.orderMembers(PU.members.listMembers()), sections: paletteSections(), actions: hubActions() });
}

const palette = createCommandPalette({
  getCommands: paletteCommands,
  onRun: async (command, meta = {}) => {
    if (meta.action === "copy" && command.member) {
      const copied = await copyMemberLink(command.member);
      if (copied.ok) toaster.success(`${command.member.name} link copied.`, { duration: 2000 });
      else toaster.error(`Could not copy the link to ${command.member.name}.`);
      return copied;
    }
    const result = runCommand(command, {
      launchMember: (member) => app.launchMember(member),
      navigate: (path) => router.navigate(path),
    });
    if (!result.ok) {
      toaster.error(`Could not run “${command.title}”.`);
      return result;
    }
    if (command.kind === COMMAND_KINDS.MEMBER && command.member) {
      toaster.info(`Opening ${command.member.name}…`, { duration: 1600 });
    }
    return result;
  },
});
palette.mount();
app.palette = palette;

quickNavBtn && quickNavBtn.addEventListener("click", () => palette.open());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSidebar();
    closeHeaderMenus();
  }
});
document.addEventListener("click", (event) => {
  if (wsMenu && !wsMenu.hidden && wsBtn && !wsBtn.contains(event.target) && !wsMenu.contains(event.target)) wsMenu.hidden = true;
  if (userMenu && !userMenu.hidden && userBtn && !userBtn.contains(event.target) && !userMenu.contains(event.target)) userMenu.hidden = true;
});

// ---------------------------------------------------------------- route changes --
router.subscribe(() => {
  palette.close();
  closeSidebar();
  renderNav();
  const main = document.getElementById("puMain");
  if (main) main.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// --------------------------------------------------------------------- boot --
// The Perchance editor loads every preview inside a `#edit` sentinel hash.
// Treat it as "no deep link" so the hub opens on its default section instead of
// hitting the 404 route (a real, shared deep link still wins).
if (location.hash === "#edit") history.replaceState(null, "", `${location.pathname}${location.search}`);

branding.applyTo(document);
theme.apply();
const versionBadge = document.getElementById("puVersionBadge");
if (versionBadge) versionBadge.textContent = `v${branding.get().version || config.version}`;
syncThemeButton();
renderIdentity();
renderNav();
// Start the directory fetch before the first paint so its latency overlaps the
// shell render; whichever route is showing repaints once it resolves/fails.
const rosterReady = roster.fetch();
router.start(document.getElementById("puMain"));
rosterReady.then(
  () => router.render(),
  () => router.render()
);

// Developer API surface.
PU.app = app;
PU.tests = { runAll: runAllTests };
PU.config = config;
PU.state = state;
PU.preferences = preferences;
PU.activity = activity;
PU.roster = roster;
PU.palette = palette;
PU.version = branding.get().version || PU.version;
globalThis.PU = PU;

console.info(`[pu] ${config.appTitle} v${PU.version} ready — theme: ${theme.get().label} (${theme.get().mode})`);
