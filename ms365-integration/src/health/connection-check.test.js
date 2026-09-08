// src/health/connection-check.test.js
// Validation suite for the Connection Health Check.
// Run via ?test=health, or: await (await import("src/health/connection-check.test.js")).runAll();

import { makeSuite, assert, assertEq, assertDeep, makeEnv } from "../test-helpers.js";
import * as o from "../auth/oauth2.js";
import * as hc from "./connection-check.js";

const { test, runAll } = makeSuite();
export { runAll };

const ME = {
  id: "u-1", displayName: "Test User", userPrincipalName: "tester@contoso.com",
  mail: "tester@contoso.com", userType: "Member", mailboxSettings: { timeZone: "UTC" },
};

test("testConnection: valid token + healthy /me → ok, tokenStatus valid, user mapped", async () => {
  const env = makeEnv({ routes: { "/me": { payload: ME } } });
  const res = await hc.testConnection();
  assertEq(res.ok, true);
  assertEq(res.tokenStatus, "valid");
  assert(/\/me/.test(env.calls.graph[0].url.split("?")[0]), "pings /me");
  assert(/\$select=id,displayName,userPrincipalName,mail,userType,mailboxSettings/.test(decodeURIComponent(env.calls.graph[0].url)), "select");
  assertEq(res.user.id, "u-1");
  assertEq(res.user.displayName, "Test User");
  assertEq(res.user.upn, "tester@contoso.com");
  assertEq(res.user.mail, "tester@contoso.com");
  assertEq(res.user.mailboxSettings.timeZone, "UTC");
  assert(res.latencyMs >= 0, "latency measured");
  assert(res.scopes.includes("User.Read"), "scopes reported");
  assertEq(res.error, null);
});

test("testConnection: no session → ok:false, not_authenticated, tokenStatus none", async () => {
  const env = makeEnv({});
  o.clearSession();
  const res = await hc.testConnection();
  assertEq(res.ok, false);
  assertEq(res.tokenStatus, "none");
  assertEq(res.user, null);
  assertEq(res.error.code, "not_authenticated");
  assertEq(res.error.category, "auth");
});

test("testConnection: forceRefresh → tokenStatus refreshed (token endpoint hit)", async () => {
  const env = makeEnv({ routes: { "/me": { payload: ME } } });
  const res = await hc.testConnection({ forceRefresh: true });
  assertEq(res.ok, true);
  assertEq(res.tokenStatus, "refreshed");
  assertEq(env.calls.token.length, 1, "refresh token request made");
});

test("testConnection: expired token with refresh token → auto-refresh, tokenStatus refreshed", async () => {
  const env = makeEnv({ routes: { "/me": { payload: ME } } });
  const s = o.loadSession();
  s.tokens.expiresAt = Date.now() - 1000;
  o.saveSession(s);
  const res = await hc.testConnection();
  assertEq(res.ok, true);
  assertEq(res.tokenStatus, "refreshed");
  assert(env.calls.token.length >= 1, "refresh triggered");
});

test("testConnection: expired token with no refresh token → tokenStatus expired", async () => {
  const env = makeEnv({});
  const s = o.loadSession();
  s.tokens.expiresAt = Date.now() - 1000;
  s.tokens.refreshToken = null;
  o.saveSession(s);
  const res = await hc.testConnection();
  assertEq(res.ok, false);
  assertEq(res.tokenStatus, "expired");
  assertEq(res.error.code, "not_authenticated");
});

test("testConnection: 401 on /me then 200 → graph auto-refresh recovers, ok:true", async () => {
  let calls = 0;
  const routes = {
    "/me": () => {
      calls++;
      if (calls === 1) return { status: 401, payload: { error: { code: "InvalidAuthenticationToken", message: "expired" } } };
      return { payload: ME };
    },
  };
  const env = makeEnv({ routes });
  const res = await hc.testConnection();
  assertEq(calls, 2, "retried once after 401");
  assertEq(res.ok, true);
  assert(env.calls.token.length >= 1, "refresh happened on 401");
});

test("testConnection: graph error surfaces as structured error", async () => {
  const env = makeEnv({ routes: { "/me": { status: 503, payload: { error: { code: "ServiceUnavailable", message: "down" } } } } });
  const res = await hc.testConnection();
  assertEq(res.ok, false);
  assertEq(res.error.code, "ServiceUnavailable");
  assert(res.error.friendly.length > 0, "friendly message");
});

test("assertConnected: throws friendly error when not connected, returns result when ok", async () => {
  const env = makeEnv({ routes: { "/me": { payload: ME } } });
  const good = await hc.assertConnected();
  assertEq(good.ok, true);

  o.clearSession();
  let threw = false;
  let errCode = null;
  try { await hc.assertConnected(); } catch (e) { threw = true; errCode = e.code; }
  assert(threw, "assertConnected throws when not connected");
  assertEq(errCode, "not_authenticated");
});
