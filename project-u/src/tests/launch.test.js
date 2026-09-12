// ============================================================================
//  Validation tests — member launch logic (Phase 2, tasks 6-9)
// ============================================================================

import { createSuite, assert, assertEqual, assertDeepEqual } from "./harness.js";
import { resolveMember, isLaunchable, memberLink, markActiveMember, clearActiveMember, launchMember, copyMemberLink } from "../framework/launch.js";
import { createAppState } from "../framework/state.js";

function fakeClipboard() {
  const written = [];
  return {
    written,
    clipboard: {
      writeText: async (text) => {
        written.push(text);
      },
    },
  };
}

export function launchSuite() {
  return createSuite("launch · member deep links")
    .test("resolveMember accepts an id, a slug, or a member object", () => {
      assertEqual(resolveMember("quote-u").id, "quote-u");
      assertEqual(resolveMember("QUOTE-U").id, "quote-u");
      const member = resolveMember("crm-u");
      assertEqual(resolveMember(member).id, "crm-u");
      assertEqual(resolveMember("nope"), null);
      assertEqual(resolveMember(null), null);
    })
    .test("memberLink points at the top-level page, never the iframe subdomain", () => {
      assertEqual(memberLink("quote-u"), "https://perchance.org/quote-u");
      assert(!memberLink("it-u").includes(".perchance.org"), "must not use a subdomain URL");
      assertEqual(memberLink("ghost"), null);
    })
    .test("isLaunchable is true only for registered members", () => {
      assert(isLaunchable("psa-u"));
      assert(!isLaunchable("not-a-member"));
    })
    .test("launchMember marks the member active and opens its registered URL", () => {
      const state = createAppState();
      const opened = [];
      const result = launchMember("crm-u", { state, open: (url, member) => opened.push([url, member.id]) });
      assert(result.ok, "launch should succeed");
      assertEqual(result.url, "https://perchance.org/crm-u");
      assertEqual(state.activeMemberId, "crm-u");
      assertDeepEqual(opened, [["https://perchance.org/crm-u", "crm-u"]]);
    })
    .test("launchMember rejects unknown members and never opens a tab", () => {
      const state = createAppState();
      let opens = 0;
      const result = launchMember("ghost", { state, open: () => opens++ });
      assert(!result.ok, "unknown member must fail");
      assertEqual(opens, 0, "no tab should open for an unknown member");
      assertEqual(state.activeMemberId, null);
    })
    .test("newTab:false marks active without opening", () => {
      const state = createAppState();
      let opens = 0;
      const result = launchMember("psa-u", { state, newTab: false, open: () => opens++ });
      assert(result.ok);
      assertEqual(opens, 0);
      assertEqual(state.activeMemberId, "psa-u");
    })
    .test("markActiveMember / clearActiveMember drive the focus state", () => {
      const state = createAppState();
      assertEqual(markActiveMember("it-u", { state }).id, "it-u");
      assertEqual(state.activeMemberId, "it-u");
      assertEqual(markActiveMember("ghost", { state }), null);
      assertEqual(state.activeMemberId, "it-u", "an unknown member must not change focus");
      clearActiveMember({ state });
      assertEqual(state.activeMemberId, null);
    })
    .test("copyMemberLink writes the shareable URL to the clipboard", async () => {
      const { clipboard, written } = fakeClipboard();
      const result = await copyMemberLink("quote-u", { clipboard });
      assert(result.ok);
      assertDeepEqual(written, ["https://perchance.org/quote-u"]);
    })
    .test("copyMemberLink reports when the clipboard is unavailable", async () => {
      const result = await copyMemberLink("quote-u", { clipboard: null, fallback: false });
      assert(!result.ok, "no clipboard backend must fail gracefully");
      assertEqual(result.url, "https://perchance.org/quote-u");
    })
    .test("copyMemberLink falls back when writeText throws", async () => {
      const result = await copyMemberLink("quote-u", {
        clipboard: {
          writeText: async () => {
            throw new Error("denied");
          },
        },
      });
      assert(typeof result.ok === "boolean");
      assertEqual(result.url, "https://perchance.org/quote-u");
    });
}
