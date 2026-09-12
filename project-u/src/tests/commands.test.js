// ============================================================================
//  Validation tests — command model, search & palette (Phase 3, tasks 11-14)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import {
  buildCommands,
  memberCommand,
  sectionCommand,
  actionCommand,
  searchCommands,
  scoreCommand,
  groupCommands,
  runCommand,
  COMMAND_KINDS,
} from "../framework/commands.js";
import { listMembers, getMember } from "../framework/members.js";
import { createCommandPalette } from "../components/command-palette.js";

const SECTIONS = [
  { id: "home", title: "Home", group: "Hub", icon: "home", description: "The launcher grid." },
  { id: "settings", title: "Settings", group: "Manage", icon: "settings", description: "Preferences." },
];
const ACTIONS = [
  { id: "toggle-theme", title: "Switch to dark mode", icon: "moon", keywords: ["theme", "dark", "appearance"], run: () => "toggled" },
];

function fixtureCommands() {
  return buildCommands({ members: listMembers(), sections: SECTIONS, actions: ACTIONS });
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Palette focus/scroll tests need the overlay actually attached to the document.
function testHost() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

function keyEvent(key, extra = {}) {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
}

function closeHostPalette() {
  try {
    if (globalThis.PU && globalThis.PU.palette) globalThis.PU.palette.close();
  } catch (_) {
    /* host palette may not exist in isolation */
  }
}

export function commandsSuite() {
  return createSuite("commands · palette & search")
    .test("buildCommands maps members, sections and actions to one shape", () => {
      const commands = fixtureCommands();
      assertEqual(commands.length, listMembers().length + SECTIONS.length + ACTIONS.length);
      const quote = commands.find((c) => c.id === "member:quote-u");
      assertEqual(quote.kind, COMMAND_KINDS.MEMBER);
      assertEqual(quote.group, "Generators");
      assertEqual(quote.member.id, "quote-u");
      assertEqual(quote.action.type, "launch");
      const settings = commands.find((c) => c.id === "section:settings");
      assertEqual(settings.kind, COMMAND_KINDS.SECTION);
      assertEqual(settings.action.path, "settings");
      const theme = commands.find((c) => c.id === "action:toggle-theme");
      assertEqual(theme.kind, COMMAND_KINDS.ACTION);
      assertEqual(typeof theme.action.run, "function");
    })
    .test("an empty query returns the default ordering: members, then sections, then actions", () => {
      const results = searchCommands(fixtureCommands(), "");
      assertEqual(results[0].kind, COMMAND_KINDS.MEMBER);
      const kinds = results.map((c) => c.kind);
      assertEqual(kinds.indexOf(COMMAND_KINDS.MEMBER), 0);
      assert(kinds.lastIndexOf(COMMAND_KINDS.SECTION) < kinds.indexOf(COMMAND_KINDS.ACTION), "sections before actions");
    })
    .test("search filters members by name, case-insensitively", () => {
      const commands = fixtureCommands();
      assertEqual(searchCommands(commands, "quote")[0].id, "member:quote-u");
      assertEqual(searchCommands(commands, "QUOTE-U")[0].id, "member:quote-u");
      assertEqual(searchCommands(commands, "crm")[0].id, "member:crm-u");
    })
    .test("search reaches member tags and section/action keywords", () => {
      const commands = fixtureCommands();
      assertEqual(searchCommands(commands, "timesheets")[0].id, "member:psa-u");
      assertEqual(searchCommands(commands, "settings")[0].id, "section:settings");
      assertEqual(searchCommands(commands, "dark")[0].id, "action:toggle-theme");
      assertEqual(searchCommands(commands, "nothing-matches-this").length, 0);
    })
    .test("multi-term queries use AND semantics", () => {
      const commands = fixtureCommands();
      assertEqual(searchCommands(commands, "quote approvals")[0].id, "member:quote-u");
      assertEqual(searchCommands(commands, "quote zzzz").length, 0);
    })
    .test("loose fuzzy matches are rejected", () => {
      const commands = fixtureCommands();
      // "crm" appears in order inside "switch to dark mode" but must not surface it.
      assert(!searchCommands(commands, "crm").some((c) => c.kind === COMMAND_KINDS.ACTION), "weak subsequences must not match");
    })
    .test("fuzzy subsequence matching tolerates skipped characters", () => {
      const commands = fixtureCommands();
      assert(searchCommands(commands, "qtu").some((c) => c.id === "member:quote-u"), "q-t-u should fuzzy-match Quote-U");
    })
    .test("scoreCommand ranks exact titles above vague keyword hits", () => {
      const commands = fixtureCommands();
      const exact = scoreCommand(commands.find((c) => c.id === "member:quote-u"), "quote-u");
      const loose = scoreCommand(commands.find((c) => c.id === "member:quote-u"), "quote");
      assert(exact > loose, "an exact title match must outrank a partial one");
    })
    .test("groupCommands buckets results by group in order", () => {
      const results = searchCommands(fixtureCommands(), "");
      const groups = groupCommands(results);
      assertEqual(groups[0].group, "Generators");
      assert(groups.every((bucket) => bucket.commands.length > 0), "no empty buckets");
      const total = groups.reduce((sum, bucket) => sum + bucket.commands.length, 0);
      assertEqual(total, results.length);
    })
    .test("runCommand launches members through the injected launcher", () => {
      const opened = [];
      const result = runCommand(memberCommand(getMember("crm-u")), { launchMember: (member) => (opened.push(member.id), { ok: true, url: "x" }) });
      assert(result.ok);
      assertDeepEqual(opened, ["crm-u"]);
      assertEqual(result.command.id, "member:crm-u");
    })
    .test("runCommand navigates sections and invokes actions", () => {
      const visited = [];
      const nav = runCommand(sectionCommand({ id: "settings", title: "Settings" }), { navigate: (path) => visited.push(path) });
      assert(nav.ok);
      assertDeepEqual(visited, ["settings"]);
      assertEqual(nav.path, "settings");

      const invoked = runCommand(actionCommand(ACTIONS[0]));
      assertEqual(invoked.ok, true);
      assertEqual(invoked.value, "toggled");
    })
    .test("runCommand fails gracefully without its dependencies", () => {
      const noLauncher = runCommand(memberCommand(getMember("it-u")), {});
      assert(!noLauncher.ok);
      assert(noLauncher.error.includes("launcher"));
      const noNavigator = runCommand(sectionCommand({ id: "home" }), {});
      assert(!noNavigator.ok);
      const badAction = runCommand({ action: { type: "mystery" } });
      assert(!badAction.ok);
      assertEqual(runCommand(null).ok, false);
    })
    .test("runCommand catches a throwing action", () => {
      const result = runCommand(actionCommand({ id: "boom", title: "Boom", run: () => { throw new Error("kaboom"); } }));
      assert(!result.ok);
      assertEqual(result.error, "kaboom");
    })
    .test("palette opens, locks scroll and restores focus on close", () => {
      closeHostPalette();
      const trigger = document.createElement("button");
      document.body.appendChild(trigger);
      trigger.focus();
      const host = testHost();
      const palette = createCommandPalette({ container: host, getCommands: () => fixtureCommands(), onRun: () => ({ ok: true }) });
      palette.mount();
      assert(!palette.isOpen, "starts closed");
      assert(palette.el.hidden, "overlay starts hidden");

      palette.open();
      assert(palette.isOpen);
      assert(!palette.el.hidden);
      assert(document.body.classList.contains("pu-palette-open"), "body must be scroll-locked");
      assertEqual(document.activeElement, palette.input, "focus moves to the search field");

      palette.close();
      assert(!palette.isOpen);
      assert(palette.el.hidden);
      assert(!document.body.classList.contains("pu-palette-open"), "scroll lock released");
      assertEqual(document.activeElement, trigger, "focus returns to the trigger");

      palette.destroy();
      host.remove();
      trigger.remove();
    })
    .test("palette filters results in real time and groups them", () => {
      const host = testHost();
      const palette = createCommandPalette({ container: host, getCommands: () => fixtureCommands(), onRun: () => ({ ok: true }) });
      palette.mount();
      palette.open();
      palette.setQuery("quote");
      assertEqual(palette.results.length, 1);
      assertEqual(palette.results[0].id, "member:quote-u");
      const item = palette.el.querySelector(".pu-palette-item");
      assert(item.textContent.includes("Quote-U"));
      assert(item.textContent.includes("Open"));

      palette.setQuery("");
      assert(palette.el.querySelectorAll(".pu-palette-item").length > 1);
      assert(palette.el.querySelector(".pu-palette-group"), "results are grouped");

      palette.setQuery("zzzzzz");
      assertEqual(palette.results.length, 0);
      assert(!palette.el.querySelector(".pu-palette-empty").hidden, "empty state shows");
      palette.destroy();
      host.remove();
    })
    .test("palette keyboard: arrows move the selection and Enter runs it", async () => {
      const calls = [];
      const host = testHost();
      const palette = createCommandPalette({
        container: host,
        getCommands: () => fixtureCommands(),
        onRun: (command, meta) => {
          calls.push([command.id, meta.action]);
          return { ok: true };
        },
      });
      palette.mount();
      palette.open();
      palette.setQuery("");
      assertEqual(palette.activeIndex, 0);
      palette.input.dispatchEvent(keyEvent("ArrowDown"));
      assertEqual(palette.activeIndex, 1);
      palette.input.dispatchEvent(keyEvent("ArrowUp"));
      assertEqual(palette.activeIndex, 0);

      palette.setQuery("quote");
      assertEqual(palette.activeIndex, 0, "typing resets the selection");
      palette.input.dispatchEvent(keyEvent("Enter"));
      await tick();
      assertDeepEqual(calls, [["member:quote-u", "default"]]);
      assert(!palette.isOpen, "running a command closes the palette");
      palette.destroy();
      host.remove();
    })
    .test("palette keyboard: Escape closes and Ctrl/⌘+K toggles", async () => {
      closeHostPalette();
      const host = testHost();
      const palette = createCommandPalette({ container: host, getCommands: () => fixtureCommands(), onRun: () => ({ ok: true }) });
      palette.mount();

      palette.open();
      document.dispatchEvent(keyEvent("Escape"));
      assert(!palette.isOpen, "Escape closes the palette");

      document.dispatchEvent(keyEvent("k", { metaKey: true }));
      assert(palette.isOpen, "⌘K opens the palette");
      document.dispatchEvent(keyEvent("k", { ctrlKey: true }));
      assert(!palette.isOpen, "Ctrl+K closes it again");

      palette.destroy();
      host.remove();
      closeHostPalette();
    })
    .test("palette row copy control runs the copy action and keeps it open", async () => {
      const calls = [];
      const host = testHost();
      const palette = createCommandPalette({
        container: host,
        getCommands: () => fixtureCommands(),
        onRun: (command, meta) => {
          calls.push([command.id, meta.action]);
          return { ok: true };
        },
      });
      palette.mount();
      palette.open();
      palette.setQuery("quote");
      const copyBtn = palette.el.querySelector(".pu-palette-item-action");
      assert(copyBtn, "member rows expose a copy control");
      copyBtn.click();
      await tick();
      assertDeepEqual(calls, [["member:quote-u", "copy"]]);
      assert(palette.isOpen, "copying keeps the palette open");
      palette.destroy();
      host.remove();
    })
    .test("palette Alt+Enter copies the active member link", async () => {
      const calls = [];
      const host = testHost();
      const palette = createCommandPalette({
        container: host,
        getCommands: () => fixtureCommands(),
        onRun: (command, meta) => {
          calls.push([command.id, meta.action]);
          return { ok: true };
        },
      });
      palette.mount();
      palette.open();
      palette.setQuery("psa");
      palette.input.dispatchEvent(keyEvent("Enter", { altKey: true }));
      await tick();
      assertDeepEqual(calls, [["member:psa-u", "copy"]]);
      palette.destroy();
      host.remove();
    });
}
