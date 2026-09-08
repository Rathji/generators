// src/graph/graph-client.test.js
// Validation suite for the Generic Graph Request Wrapper.
// Run via:  ?test=graph  on the generator page, or programmatically:
//   const t = await import("src/graph/graph-client.test.js"); return await t.runAll();

import * as g from "./graph-client.js";
import * as o from "../auth/oauth2.js";
import { TokenStore } from "../auth/token-store.js";

const TESTS = [];

function test(name, fn) { TESTS.push({ name, fn }); }

export async function runAll() {
  const results = [];
  for (const { name, fn } of TESTS) {
    const t0 = performance.now();
    try {
      await fn();
      results.push({ name, pass: true, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      results.push({ name, pass: false, ms: Math.round(performance.now() - t0), error: err.message });
    }
  }
  return results;
}

// ── helpers ────────────────────────────────────────────────────────────────
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error((msg || "assert") + " — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}

class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

function mockRes(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    async json() { if (typeof payload === "string") throw new Error("not json"); return payload; },
    async text() { return typeof payload === "string" ? payload : JSON.stringify(payload); },
  };
}

function graphFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    const key = u.pathname.replace(/^\/v1\.0/, "");
    const hit = routes[key];
    if (!hit) return mockRes(404, { error: { code: "not_found", message: "no route " + key } });
    const out = typeof hit === "function" ? hit({ url, init }) : hit;
    return mockRes(out.status == null ? (out.payload !== undefined ? 200 : 204) : out.status, out.payload, out.headers || {});
  };
  impl.calls = calls;
  return impl;
}

const JWT_AT = "T";
const T = (routes) => ({ token: JWT_AT, fetchImpl: graphFetch(routes) });

// ── tests ──────────────────────────────────────────────────────────────────
test("graphGet: bearer auth + JSON accept, parses the value payload", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/me": { status: 200, payload: { displayName: "Ada", id: "u1" } } });
  const data = await g.graphGet("/me", { token: "SECRET", fetchImpl: f });
  assertEq(data.displayName, "Ada");
  const req = f.calls[0];
  assertEq(req.init.headers.Authorization, "Bearer SECRET");
  assertEq(req.init.headers.Accept, "application/json");
  assertEq(req.init.method, "GET");
  assertEq(req.url, "https://graph.microsoft.com/v1.0/me");
});

test("graphGet: relative path without a leading slash is joined to graphBase", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/me": { status: 200, payload: {} } });
  await g.graphGet("me", { token: JWT_AT, fetchImpl: f });
  assertEq(f.calls[0].url, "https://graph.microsoft.com/v1.0/me");
});

test("graphGet: absolute URLs are passed through untouched", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/custom": { status: 200, payload: { ok: true } } });
  const data = await g.graphGet("https://graph.microsoft.com/v1.0/custom", { token: JWT_AT, fetchImpl: f });
  assertEq(data.ok, true);
  assertEq(f.calls[0].url, "https://graph.microsoft.com/v1.0/custom");
});

test("query params: $select/$filter/$top use literal $ keys and encode values", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/users": { status: 200, payload: { value: [] } } });
  await g.graphGet("/users", { token: JWT_AT, fetchImpl: f, query: { $select: "id,displayName", $filter: "startsWith(displayName,'A')", $top: 5 } });
  const url = f.calls[0].url;
  assert(url.includes("$select="), "literal $ in key, got " + url);
  const u = new URL(url);
  assertEq(u.searchParams.get("$select"), "id,displayName");
  assertEq(u.searchParams.get("$filter"), "startsWith(displayName,'A')");
  assertEq(u.searchParams.get("$top"), "5");
});

test("query params: array values become repeated keys", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/x": { status: 200, payload: {} } });
  await g.graphGet("/x", { token: JWT_AT, fetchImpl: f, query: { expand: ["a", "b"] } });
  const u = new URL(f.calls[0].url);
  assertEq(u.searchParams.getAll("expand").join(","), "a,b");
});

test("graphPost: JSON body serialized with content-type", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/messages": { status: 201, payload: { id: "m1" } } });
  const body = { subject: "Hi", body: { content: "Hello" } };
  const data = await g.graphPost("/messages", { token: JWT_AT, fetchImpl: f, body });
  assertEq(data.id, "m1");
  const req = f.calls[0];
  assertEq(req.init.method, "POST");
  assertEq(req.init.headers["Content-Type"], "application/json");
  assertEq(JSON.parse(req.init.body).subject, "Hi");
});

test("graphPost: raw string body + custom content-type override", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/x": { status: 200, payload: {} } });
  await g.graphPost("/x", { token: JWT_AT, fetchImpl: f, body: "raw=1", contentType: "application/x-www-form-urlencoded" });
  assertEq(f.calls[0].init.body, "raw=1");
  assertEq(f.calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
});

test("graphDelete: 204 → null", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/messages/m1": { status: 204, payload: undefined } });
  const r = await g.graphDelete("/messages/m1", { token: JWT_AT, fetchImpl: f });
  assertEq(r, null);
});

test("429 with Retry-After: waits the server-suggested delay then succeeds", async () => {
  g.resetGraphConfig();
  let n = 0;
  const f = graphFetch({ "/me": () => (n++ === 0 ? { status: 429, payload: null, headers: { "Retry-After": "0" } } : { status: 200, payload: { ok: true } }) });
  const data = await g.graphGet("/me", { token: JWT_AT, fetchImpl: f });
  assertEq(data.ok, true);
  assertEq(f.calls.length, 2, "one retry after 429");
});

test("429 without Retry-After: exponential backoff is used, error is retryable", async () => {
  g.resetGraphConfig({ maxRetries: 2, baseBackoffMs: 1 });
  const f = graphFetch({ "/x": { status: 429, payload: { error: { code: "activityLimitReached", message: "throttled" } } } });
  let err = null;
  try { await g.graphGet("/x", { token: JWT_AT, fetchImpl: f }); } catch (e) { err = e; }
  assert(err, "throws after exhausting retries");
  assertEq(f.calls.length, 3, "initial + 2 retries");
  assertEq(err.code, "activityLimitReached");
  assertEq(err.status, 429);
  assert(err.retryable, "429 marked retryable");
});

test("503 is retried, then succeeds", async () => {
  g.resetGraphConfig({ maxRetries: 2, baseBackoffMs: 1 });
  let n = 0;
  const f = graphFetch({ "/x": () => (n++ < 2 ? { status: 503, payload: null } : { status: 200, payload: { ok: true } }) });
  const data = await g.graphGet("/x", { token: JWT_AT, fetchImpl: f });
  assertEq(data.ok, true);
  assertEq(f.calls.length, 3);
});

test("network failure: retried with backoff, then wrapped as network_error", async () => {
  g.resetGraphConfig({ maxRetries: 2, baseBackoffMs: 1 });
  let calls = 0;
  const f = async () => { calls++; throw new Error("offline"); };
  let err = null;
  try { await g.graphGet("/x", { token: JWT_AT, fetchImpl: f }); } catch (e) { err = e; }
  assert(err && err.message.includes("network level"), "wrapped network error");
  assertEq(err.code, "network_error");
  assert(err.retryable, "transient network error marked retryable");
  assertEq(calls, 3, "initial + 2 retries");
});

test("401: forces one token refresh and retries with the new token", async () => {
  g.resetGraphConfig();
  let tokenRefreshes = 0;
  const tokenFetch = async () => {
    tokenRefreshes++;
    return { ok: true, status: 200, json: async () => ({ access_token: "AT-2", refresh_token: "RT-2", token_type: "Bearer", expires_in: 3600 }) };
  };
  o.configure({
    clientId: "00000000-0000-0000-0000-000000000000",
    tenant: "common",
    scopes: ["openid", "User.Read", "offline_access"],
    redirectUri: "https://example.com/cb",
    autoRefresh: false,
    store: new TokenStore(new MemoryStorage()),
    storage: () => new MemoryStorage(),
    fetchImpl: tokenFetch,
  });
  o.saveSession({
    tokens: { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: Date.now() + 60 * 60 * 1000, scope: ["openid", "User.Read"] },
    profile: { name: "Ada" },
  });
  let n = 0;
  const f = graphFetch({ "/me": () => (n++ === 0 ? { status: 401, payload: { error: { code: "InvalidAuthenticationToken", message: "expired" } } } : { status: 200, payload: { id: "u1" } }) });
  const data = await g.graphGet("/me", { fetchImpl: f });
  assertEq(data.id, "u1");
  assertEq(tokenRefreshes, 1, "exactly one forced token refresh");
  assertEq(f.calls.length, 2);
  assertEq(f.calls[0].init.headers.Authorization, "Bearer AT-1");
  assertEq(f.calls[1].init.headers.Authorization, "Bearer AT-2", "retried with the refreshed token");
});

test("401 with allowTokenRetry:false → error surfaces, no refresh", async () => {
  g.resetGraphConfig();
  let tokenRefreshes = 0;
  o.configure({
    clientId: "00000000-0000-0000-0000-000000000000",
    tenant: "common",
    scopes: ["openid", "User.Read", "offline_access"],
    redirectUri: "https://example.com/cb",
    autoRefresh: false,
    store: new TokenStore(new MemoryStorage()),
    storage: () => new MemoryStorage(),
    fetchImpl: async () => { tokenRefreshes++; return { ok: true, status: 200, json: async () => ({ access_token: "AT-2", refresh_token: "RT-2", token_type: "Bearer", expires_in: 3600 }) }; },
  });
  o.saveSession({
    tokens: { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: Date.now() + 60 * 60 * 1000, scope: ["openid", "User.Read"] },
    profile: { name: "Ada" },
  });
  const f = graphFetch({ "/me": { status: 401, payload: { error: { code: "InvalidAuthenticationToken", message: "expired" } } } });
  let err = null;
  try { await g.graphGet("/me", { fetchImpl: f, allowTokenRetry: false }); } catch (e) { err = e; }
  assert(err && err.code === "InvalidAuthenticationToken", "401 surfaced");
  assertEq(tokenRefreshes, 0, "no refresh when disabled");
});

test("maxRetries exhausted: retryable Graph error with status surfaced", async () => {
  g.resetGraphConfig({ maxRetries: 1, baseBackoffMs: 1 });
  const f = graphFetch({ "/x": { status: 429, payload: { error: { code: "throttle", message: "slow down" } } } });
  let err = null;
  try { await g.graphGet("/x", { token: JWT_AT, fetchImpl: f }); } catch (e) { err = e; }
  assert(err && err.isGraphError && err.status === 429);
  assert(err.message.includes("slow down"), "message from Graph body, got: " + err.message);
});

test("non-JSON 2xx response is returned as text", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/plain": { status: 200, payload: "hello world" } });
  const r = await g.graphGet("/plain", { token: JWT_AT, fetchImpl: f });
  assertEq(r, "hello world");
});

test("empty 2xx body → null", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/empty": { status: 200, payload: "" } });
  const r = await g.graphGet("/empty", { token: JWT_AT, fetchImpl: f });
  assertEq(r, null);
});

test("rawResponse: returns the raw response object (for downloads)", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/blob": { status: 200, payload: "abc" } });
  const r = await g.graphGet("/blob", { token: JWT_AT, fetchImpl: f, rawResponse: true });
  assert(r && typeof r.text === "function", "raw response returned");
  assertEq(await r.text(), "abc");
});

test("getAllPages: walks @odata.nextLink and aggregates value", async () => {
  g.resetGraphConfig();
  const f = graphFetch({
    "/users": (req) => {
      const u = new URL(req.url);
      return u.searchParams.get("$skiptoken")
        ? { status: 200, payload: { value: [{ id: "2" }, { id: "3" }] } }
        : { status: 200, payload: { value: [{ id: "1" }], "@odata.count": 3, "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?$skiptoken=abc" } };
    },
  });
  const res = await g.getAllPages("/users", { token: JWT_AT, fetchImpl: f });
  assertEq(res.count, 3);
  assertEq(res.totalCount, 3);
  assertEq(res.value.map((v) => v.id).join(","), "1,2,3");
  assertEq(f.calls.length, 2);
});

test("getAllPages: respects maxPages", async () => {
  g.resetGraphConfig();
  const f = graphFetch({ "/x": { status: 200, payload: { value: [{}], "@odata.nextLink": "https://graph.microsoft.com/v1.0/x?next=1" } } });
  const res = await g.getAllPages("/x", { token: JWT_AT, fetchImpl: f, maxPages: 3 });
  assertEq(res.value.length, 3);
  assertEq(f.calls.length, 3);
});

test("stats: requests/retries/throttledCount tracked and resettable", async () => {
  g.resetGraphConfig();
  g.resetGraphStats();
  let n = 0;
  const f = graphFetch({ "/x": () => (n++ < 2 ? { status: 429, payload: null, headers: { "Retry-After": "0" } } : { status: 200, payload: { ok: true } }) });
  await g.graphGet("/x", { token: JWT_AT, fetchImpl: f });
  const s = g.getGraphStats();
  assertEq(s.requests, 1, "one logical request");
  assertEq(s.retries, 2, "two retries");
  assertEq(s.throttledCount, 2, "two 429s observed");
  g.resetGraphStats();
  assertEq(g.getGraphStats().requests, 0);
});

test("onRetry callback reports attempt/status/delay", async () => {
  g.resetGraphConfig({ maxRetries: 1, baseBackoffMs: 1 });
  const seen = [];
  let n = 0;
  const f = graphFetch({ "/x": () => (n++ === 0 ? { status: 429, payload: null, headers: { "Retry-After": "0" } } : { status: 200, payload: {} }) });
  await g.graphGet("/x", { token: JWT_AT, fetchImpl: f, onRetry: (e) => seen.push(e) });
  assertEq(seen.length, 1);
  assertEq(seen[0].status, 429);
  assertEq(seen[0].attempt, 0);
  assertEq(seen[0].delayMs, 0, "honors Retry-After: 0");
});
