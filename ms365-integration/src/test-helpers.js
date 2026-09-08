// src/test-helpers.js
// Shared validation helpers for the feature-module test suites (Phases 2–6).
// Each suite builds a mock Microsoft environment via makeEnv(): a fake fetch
// that serves the token endpoint (refresh grants) and Graph routes (pathname
// keys with the "/v1.0" prefix stripped), plus a stored session so
// getValidToken()/graphRequest() run through the real module stack.

import * as o from "./auth/oauth2.js";
import { TokenStore } from "./auth/token-store.js";

export function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
export function assertEq(a, b, msg) {
  if (a !== b) throw new Error((msg || "assert") + " — expected " + JSON.stringify(b) + ", got " + JSON.stringify(a));
}
export function assertDeep(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg || "assertDeep") + " — expected " + e + ", got " + a);
}

export class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

export function mockRes(status, payload, headers = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const h = Object.assign({}, headers);
  const norm = {};
  for (const k of Object.keys(h)) norm[String(k).toLowerCase()] = h[k];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: h,
    async json() { if (typeof payload === "string") throw new Error("not json"); return payload; },
    async text() { return text; },
    async blob() { return new Blob([text], { type: norm["content-type"] || "application/octet-stream" }); },
    async arrayBuffer() { return new TextEncoder().encode(text).buffer; },
  };
}

export function fakeIdToken(overrides = {}) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64({ alg: "none", typ: "JWT" }) + "." +
    b64(Object.assign({ tid: "f8cdef31-0000-0000-0000-000000000000", oid: "u-1", preferred_username: "tester@contoso.com", name: "Test User" }, overrides)) +
    ".sig";
}

// Build a fully-wired mock environment.
//   routes: { "/me": { payload } | fn({url, init}) | {status, payload, headers} }
//   tokenHandler: optional fn to serve the token endpoint (refresh tests).
export function makeEnv({ scopes = ["openid", "User.Read"], routes = {}, tokenHandler } = {}) {
  const store = new TokenStore(new MemoryStorage());
  const pending = new MemoryStorage();
  const calls = { graph: [], token: [] };

  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/oauth2/v2.0/token")) {
      calls.token.push({ url: u, init });
      if (tokenHandler) return tokenHandler({ url: u, init });
      return mockRes(200, {
        access_token: "AT", refresh_token: "RT", id_token: fakeIdToken(),
        token_type: "Bearer", expires_in: 3600, scope: scopes.join(" "),
      });
    }
    calls.graph.push({ url: u, init });
    let key;
    try { key = new URL(u).pathname.replace(/^\/v1\.0/, ""); } catch (e) { key = u; }
    const hit = routes[key];
    if (!hit) return mockRes(404, { error: { code: "not_found", message: "no route " + key } });
    const out = typeof hit === "function" ? hit({ url: u, init }) : hit;
    return mockRes(
      out.status == null ? (out.payload !== undefined ? 200 : 204) : out.status,
      out.payload,
      out.headers || {}
    );
  };

  o.configure({
    clientId: "00000000-0000-0000-0000-000000000000",
    tenant: "common",
    scopes,
    fetchImpl,
    store,
    storage: () => pending,
    autoRefresh: false,
    navigate: () => {},
  });

  const profile = { oid: "u-1", tid: "t-1", preferred_username: "tester@contoso.com", name: "Test User" };
  o.saveSession({
    tokens: { accessToken: "AT", refreshToken: "RT", idToken: fakeIdToken(), tokenType: "Bearer", expiresAt: Date.now() + 3600 * 1000, scope: scopes },
    profile,
  });

  return { fetchImpl, calls, store, pending };
}

// Standard runAll() used by every suite: export `TESTS` then `runAll`.
export function makeSuite() {
  const TESTS = [];
  function test(name, fn) { TESTS.push({ name, fn }); }
  async function runAll() {
    const results = [];
    for (const { name, fn } of TESTS) {
      const t0 = performance.now();
      try {
        await fn();
        results.push({ name, pass: true, ms: Math.round(performance.now() - t0) });
      } catch (err) {
        results.push({ name, pass: false, ms: Math.round(performance.now() - t0), error: (err && err.message) || String(err) });
      }
    }
    return results;
  }
  return { TESTS, test, runAll };
}
