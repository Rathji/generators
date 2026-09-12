// ============================================================================
//  Validation tests — user preferences: pins, recents & persistence
//  (Phase 4, tasks 16-18)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import {
  createPreferences,
  normalizePreferences,
  orderByPinned,
  DEFAULT_PREFERENCES,
  MAX_RECENTS_LIMIT,
} from "../framework/preferences.js";
import { createStorage } from "../framework/storage.js";
import { createAppState } from "../framework/state.js";
import { createTheme } from "../framework/theme.js";
import { createBranding } from "../framework/branding.js";
import { createRegistry } from "../framework/registry.js";
import { listMembers, getMember, memberUrl } from "../framework/members.js";
import * as homeView from "../views/home.js";
import * as settingsView from "../views/settings.js";

function fakeBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

// A minimal app context so the home view can be rendered without booting the
// whole shell. Mirrors how src/app.js wires the launcher.
function fakeApp(preferences) {
  const state = createAppState();
  return {
    preferences,
    state,
    branding: { get: () => ({ appTitle: "Project-U", tagline: "Hub", version: "0.1.0" }) },
    theme: { get: () => ({ label: "Navy", mode: "light" }) },
    registry: { list: () => [{ id: "home" }, { id: "settings" }] },
    toaster: { success() {}, info() {}, error() {}, warning() {} },
    navigate() {},
    memberLink: (member) => memberUrl(member),
    launchMember: (member) => {
      state.setActiveMember(member.id);
      preferences.recordRecent(member.id);
      return { ok: true, member };
    },
    markActiveMember: (member) => {
      state.setActiveMember(member.id);
      preferences.recordRecent(member.id);
      return member;
    },
    copyMemberLink: async () => ({ ok: true }),
    orderMembers: (members) => preferences.orderMembers(members),
    recentMembers: () =>
      preferences
        .get()
        .recents.map((entry) => ({ ...entry, member: getMember(entry.id) }))
        .filter((entry) => entry.member),
    isPinned: (member) => preferences.isPinned(member.id),
    togglePin: (member) => preferences.togglePin(member.id),
  };
}

// A minimal app context for the Settings view: real theme/branding/registry/
// preferences over an in-memory backend, so the tabbed preference panel can be
// exercised end to end without booting the shell.
function fakeSettingsApp({ storage, preferences }) {
  const state = createAppState();
  const theme = createTheme({ storage, target: document.createElement("div") });
  const branding = createBranding({}, { config: {} });
  const registry = createRegistry({ storage });
  registry.register({ id: "home", label: "Home", icon: "home", order: 10, defaultEnabled: true });
  registry.register({ id: "tests", label: "Tests", icon: "check", order: 20, optional: true, defaultEnabled: true });
  return {
    storage,
    preferences,
    state,
    theme,
    branding,
    registry,
    config: {},
    toaster: { success() {}, info() {}, error() {}, warning() {} },
    navigate() {},
    renderNav() {},
    memberLink: (member) => memberUrl(member),
    pinnedMembers: () => preferences.pinned.map((id) => getMember(id)).filter(Boolean),
    recentMembers: () =>
      preferences
        .get()
        .recents.map((entry) => ({ ...entry, member: getMember(entry.id) }))
        .filter((entry) => entry.member),
  };
}

export function preferencesSuite() {
  return createSuite("preferences · pins, recents, persistence")
    .test("defaults are empty pins with a five-item recent history", () => {
      const prefs = createPreferences();
      assertDeepEqual(prefs.pinned, []);
      assertDeepEqual(prefs.recents, []);
      assertEqual(prefs.maxRecents, DEFAULT_PREFERENCES.maxRecents);
      assertEqual(prefs.trackRecents, true);
      assertEqual(prefs.pinFirst, true);
    })
    .test("pin / unpin / toggle keep a de-duplicated, newest-first order", () => {
      const prefs = createPreferences();
      assertEqual(prefs.pin("crm-u"), true);
      assertEqual(prefs.pin("crm-u"), false, "pinning twice is a no-op");
      assertEqual(prefs.pin("it-u"), true);
      assertDeepEqual(prefs.pinned, ["it-u", "crm-u"]);
      assertEqual(prefs.isPinned("crm-u"), true);
      assertEqual(prefs.togglePin("crm-u"), false);
      assertDeepEqual(prefs.pinned, ["it-u"]);
      assertEqual(prefs.togglePin("crm-u"), true);
      assertDeepEqual(prefs.pinned, ["crm-u", "it-u"]);
      assertEqual(prefs.pin(""), false, "a blank id is rejected");
      assertEqual(prefs.pin(null), false);
    })
    .test("subscribers fire on change, not on no-ops, and unsubscribe cleanly", () => {
      const prefs = createPreferences();
      const seen = [];
      const unsubscribe = prefs.subscribe((snapshot) => seen.push(snapshot.pinned.length), { immediate: true });
      prefs.pin("a");
      prefs.pin("a");
      prefs.unpin("a");
      unsubscribe();
      prefs.pin("b");
      assertDeepEqual(seen, [0, 1, 0]);
    })
    .test("recordRecent keeps the newest entries, de-duplicated and capped", () => {
      const prefs = createPreferences();
      for (const id of ["a", "b", "c", "d", "e", "f"]) prefs.recordRecent(id, 1);
      assertDeepEqual(prefs.recents.map((e) => e.id), ["f", "e", "d", "c", "b"]);
      prefs.recordRecent("c", 9);
      assertDeepEqual(prefs.recents.map((e) => e.id), ["c", "f", "e", "d", "b"]);
      prefs.setMaxRecents(3);
      assertDeepEqual(prefs.recents.map((e) => e.id), ["c", "f", "e"], "lowering the cap trims history");
      assertEqual(prefs.recents[0].at, 9, "fresh entries keep their timestamp");
    })
    .test("setMaxRecents clamps to a sane range", () => {
      const prefs = createPreferences();
      assertEqual(prefs.setMaxRecents(99), MAX_RECENTS_LIMIT);
      assertEqual(prefs.setMaxRecents("nonsense"), MAX_RECENTS_LIMIT, "invalid input keeps the current value");
      assertEqual(prefs.setMaxRecents(0), 1);
    })
    .test("trackRecents can be switched off and on", () => {
      const prefs = createPreferences();
      assertEqual(prefs.setTrackRecents(false), false);
      assertEqual(prefs.recordRecent("crm-u"), false, "recording is ignored while tracking is off");
      assertDeepEqual(prefs.recents, []);
      prefs.setTrackRecents(true);
      assertEqual(prefs.recordRecent("crm-u"), true);
      assertDeepEqual(prefs.recents.map((e) => e.id), ["crm-u"]);
    })
    .test("clearPins / clearRecents / reset restore a clean slate", () => {
      const prefs = createPreferences();
      prefs.pin("a");
      prefs.recordRecent("b");
      prefs.clearPins();
      prefs.clearRecents();
      assertDeepEqual(prefs.pinned, []);
      assertDeepEqual(prefs.recents, []);
      prefs.pin("a");
      prefs.reset();
      assertDeepEqual(prefs.pinned, []);
      assertEqual(prefs.pinFirst, true);
    })
    .test("pins and recents survive a new controller over the same storage", () => {
      const storage = createStorage({ namespace: "t", backend: fakeBackend() });
      const first = createPreferences({ storage });
      first.pin("quote-u");
      first.recordRecent("crm-u", 1000);
      first.recordRecent("it-u", 2000);

      const second = createPreferences({ storage });
      assertDeepEqual(second.pinned, ["quote-u"]);
      assertDeepEqual(second.recents.map((e) => e.id), ["it-u", "crm-u"]);
      assertEqual(second.recents[0].at, 2000);
      assert(storage.get("prefs:v1"), "preferences are written under prefs:v1");
    })
    .test("normalizePreferences sanitizes saved data", () => {
      const norm = normalizePreferences({
        pinned: ["a", "a", "", 3, "b"],
        recents: [{ id: "x", at: 5 }, { id: "x", at: 9 }, { id: "y" }, "z"],
        maxRecents: 99,
      });
      assertDeepEqual(norm.pinned, ["a", "b"]);
      assertEqual(norm.maxRecents, MAX_RECENTS_LIMIT);
      assertDeepEqual(norm.recents.map((e) => e.id), ["x", "y", "z"]);
      assertEqual(norm.recents[0].at, 5, "the first occurrence wins");
      assertDeepEqual(normalizePreferences(null).pinned, []);
    })
    .test("orderByPinned floats pins to the top and ignores unknown ids", () => {
      const members = [{ id: "a" }, { id: "b" }, { id: "c" }];
      assertDeepEqual(orderByPinned(members, ["c", "zz"]).map((m) => m.id), ["c", "a", "b"]);
      assertDeepEqual(orderByPinned(members, ["c"], { pinFirst: false }).map((m) => m.id), ["a", "b", "c"]);
      assertDeepEqual(orderByPinned(members, []).map((m) => m.id), ["a", "b", "c"]);
      assertDeepEqual(members.map((m) => m.id), ["a", "b", "c"], "the input array is not mutated");
    })
    .test("orderMembers respects the pinFirst setting", () => {
      const prefs = createPreferences();
      const members = listMembers();
      prefs.pin("psa-u");
      assertEqual(prefs.orderMembers(members)[0].id, "psa-u");
      prefs.setPinFirst(false);
      assertEqual(prefs.orderMembers(members)[0].id, members[0].id);
    })
    .test("home launcher reorders pinned cards and lists recents", () => {
      const preferences = createPreferences({ storage: createStorage({ namespace: "t", backend: fakeBackend() }) });
      const ctx = { app: fakeApp(preferences) };
      const outlet = document.createElement("div");

      homeView.render(outlet, ctx);
      assertEqual(outlet.querySelector(".pu-launch").dataset.member, "it-u", "registry order by default");

      preferences.pin("template-u");
      homeView.render(outlet, ctx);
      const afterPin = [...outlet.querySelectorAll(".pu-launch")].map((el) => el.dataset.member);
      assertEqual(afterPin[0], "template-u");
      assert(outlet.querySelector('.pu-launch[data-member="template-u"]').classList.contains("is-pinned"));

      const pinBtn = outlet.querySelector('.pu-launch[data-member="crm-u"] .pu-launch-pin');
      assert(pinBtn, "every card exposes a pin toggle");
      assertEqual(pinBtn.getAttribute("aria-pressed"), "false");
      pinBtn.click();
      assert(preferences.isPinned("crm-u"));
      homeView.render(outlet, ctx);
      assertEqual(outlet.querySelector(".pu-launch").dataset.member, "crm-u", "the newest pin sorts first");

      assert(outlet.querySelector(".pu-recent-empty"), "recents start with an empty hint");
      ctx.app.markActiveMember(getMember("psa-u"));
      homeView.render(outlet, ctx);
      const chips = [...outlet.querySelectorAll(".pu-recent")].map((el) => el.dataset.member);
      assertDeepEqual(chips, ["psa-u"]);
    })
    .test("settings exposes a tabbed preference panel backed by prefs", () => {
      const storage = createStorage({ namespace: "s", backend: fakeBackend() });
      const preferences = createPreferences({ storage });
      const app = fakeSettingsApp({ storage, preferences });
      const outlet = document.createElement("div");
      settingsView.render(outlet, { app });

      const tabs = [...outlet.querySelectorAll(".pu-tab")].map((tab) => tab.textContent.trim());
      assertDeepEqual(tabs, ["Appearance", "Branding", "Preferences", "Components", "Data", "About"]);
      assertEqual(outlet.querySelector(".pu-tab.is-active").textContent.trim(), "Appearance");

      outlet.querySelector("#puTab-preferences").click();
      const titles = [...outlet.querySelectorAll(".pu-card-title")].map((el) => el.textContent);
      assert(titles.includes("Account"), "account preferences must be present");
      assert(titles.includes("Launcher & history"));
      assert(titles.includes("Recent history"));
      assertEqual(storage.get("settings:tab"), "preferences", "the active tab is remembered");

      const nameInput = outlet.querySelector('input[name="accountName"]');
      nameInput.value = "Jamie Fox";
      [...outlet.querySelectorAll("button")].find((btn) => btn.textContent.includes("Save details")).click();
      assertEqual(app.state.user.name, "Jamie Fox");
      assertEqual(app.state.user.initials, "JF", "initials follow the new name");

      const trackInput = [...outlet.querySelectorAll(".pu-toggle-input")].find((input) => input.name === "trackRecents");
      assert(trackInput, "the launcher tracking toggle is interactive");
      trackInput.checked = false;
      trackInput.dispatchEvent(new Event("change", { bubbles: true }));
      assertEqual(preferences.trackRecents, false, "the toggle writes through to preferences");
    });
}
