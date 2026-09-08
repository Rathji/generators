// src/auth/scoped-permissions.test.js
// Validation suite for the Scoped Permission Requestor.
// Run via ?test=scoped, or: await (await import("src/auth/scoped-permissions.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep, makeEnv } from "../test-helpers.js";
import * as o from "./oauth2.js";
import * as sp from "./scoped-permissions.js";

const { test, runAll } = makeSuite();
export { runAll };

test("scopesForFeature: feature names expand, raw scopes pass through, arrays dedupe", () => {
  assertDeep(sp.scopesForFeature("mail"), ["Mail.ReadWrite"]);
  assertDeep(sp.scopesForFeature("mailSend"), ["Mail.Send"]);
  assertDeep(sp.scopesForFeature(["mail", "calendar", "Tasks.ReadWrite"]), ["Mail.ReadWrite", "Calendars.ReadWrite", "Tasks.ReadWrite"]);
  assertDeep(sp.scopesForFeature("custom.Scope"), ["custom.Scope"]);
});

test("hasScopes/missingScopes: reflects the active config", async () => {
  const env = makeEnv({});
  assertEq(sp.hasScopes("mail"), false);
  assertEq(sp.hasScopes("tenant"), false);
  assertDeep(sp.missingScopes("mail"), ["Mail.ReadWrite"]);
  const cfg = o.getConfig();
  o.configure({ ...cfg, scopes: [...cfg.scopes, "Mail.ReadWrite"] });
  assertEq(sp.hasScopes("mail"), true);
  assertDeep(sp.missingScopes("mail"), []);
});

test("ensureScopes: all scopes present → immediate grant, no auth flow", async () => {
  const env = makeEnv({});
  const cfg = o.getConfig();
  o.configure({ ...cfg, scopes: [...cfg.scopes, "Mail.ReadWrite"] });
  const res = await sp.ensureScopes("mail");
  assertEq(res.granted, true);
  assertDeep(res.added, []);
  assertDeep(res.missing, []);
  assertEq(env.calls.token.length, 0, "no token endpoint hit");
  assertEq(env.calls.graph.length, 0, "no graph hit");
});

test("ensureScopes: popup blocked → aborted:true, missing preserved, no consent", async () => {
  const env = makeEnv({});
  const origOpen = window.open;
  window.open = () => null;
  try {
    const res = await sp.ensureScopes("mail");
    assertEq(res.granted, false);
    assertEq(res.aborted, true);
    assertDeep(res.missing, ["Mail.ReadWrite"]);
    assertDeep(res.added, []);
    assertEq(env.calls.token.length, 0, "no token exchange on abort");
  } finally {
    window.open = origOpen;
  }
});

test("ensureScopes: popup flow grants ONLY the missing scope and merges it into config", async () => {
  const env = makeEnv({});
  const origOpen = window.open;
  const fakePopup = { closed: false, url: "" };
  window.open = (url) => { fakePopup.url = url; return fakePopup; };
  try {
    const p = sp.ensureScopes("mail");
    let pending = null;
    for (let i = 0; i < 50; i++) {
      pending = JSON.parse(env.pending.getItem("ms365.oauth2.pending"));
      if (pending) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert(pending && pending.state, "pending auth record persisted");
    assert(fakePopup.url.includes("Mail.ReadWrite"), "authorize URL carries the missing scope");
    assert(fakePopup.url.includes("prompt=consent"), "authorize URL forces incremental consent");
    assert(!fakePopup.url.includes("Calendars.ReadWrite"), "unrelated scopes not requested");

    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "ms365-auth", state: pending.state, code: "CODE" },
      origin: window.location.origin,
    }));

    const res = await p;
    assertEq(res.granted, true);
    assertDeep(res.added, ["Mail.ReadWrite"]);
    assertDeep(res.missing, []);
    assertEq(env.calls.token.length, 1, "authorization_code exchange happened");
    const scopes = o.getConfig().scopes;
    assert(scopes.includes("Mail.ReadWrite"), "config merged the new scope");
  } finally {
    window.open = origOpen;
  }
});
