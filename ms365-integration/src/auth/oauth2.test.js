// src/auth/oauth2.test.js
// Validation suite for the OAuth2 flow.
// Run via:  ?test=oauth2  on the generator page, or programmatically:
//   const t = await import("src/auth/oauth2.test.js"); return await t.runAll();

import * as o from "./oauth2.js";
import { TokenStore } from "./token-store.js";

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

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    const req = { url, init };
    calls.push(req);
    const out = await handler(req);
    return {
      ok: out.ok !== false,
      status: out.status || 200,
      json: async () => out.json,
      text: async () => JSON.stringify(out.json),
    };
  };
  impl.calls = calls;
  return impl;
}

function fakeIdToken(payload) {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return "header." + b64 + ".sig";
}

const TEST_CONFIG = {
  clientId: "00000000-0000-0000-0000-000000000000",
  tenant: "common",
  scopes: ["openid", "User.Read"],
  redirectUri: "https://example.com/cb",
  storage: () => new MemoryStorage(),
};

function freshConfig(extra = {}) {
  const base = { ...TEST_CONFIG, autoRefresh: false, store: new TokenStore(new MemoryStorage()) };
  delete base.storage;
  const pendingStore = new MemoryStorage();
  return { ...base, storage: () => pendingStore, ...extra };
}

// ── tests ──────────────────────────────────────────────────────────────────
test("configure: validates clientId, applies defaults, auto-adds offline_access", () => {
  o.configure(TEST_CONFIG);
  const cfg = o.getConfig();
  assertEq(cfg.tenant, "common");
  assertEq(cfg.clientId, TEST_CONFIG.clientId);
  assert(cfg.scopes.includes("offline_access"), "offline_access auto-added (needed for refresh tokens)");
  assert(cfg.scopes.includes("openid"), "openid scope kept");
  let threw = false;
  try { o.configure({}); } catch (e) { threw = true; }
  assert(threw, "configure without clientId throws");
});

test("configure: string scopes are normalized", () => {
  o.configure({ ...TEST_CONFIG, scopes: "openid profile email" });
  assertEq(o.getConfig().scopes.join(" "), "openid profile email offline_access");
});

test("PKCE: SHA-256 challenge matches the RFC 7636 reference vector", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = await o.computeCodeChallenge(verifier);
  assertEq(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "RFC 7636 S256 example");
});

test("generateCodeVerifier: length 43-128 and URL-safe alphabet", () => {
  for (let i = 0; i < 50; i++) {
    const v = o.generateCodeVerifier();
    assert(v.length >= 43 && v.length <= 128, "verifier length in range, got " + v.length);
    assert(/^[A-Za-z0-9\-._~]+$/.test(v), "verifier alphabet is URL-safe");
  }
  assertEq(o.generateCodeVerifier(43).length, 43, "min length honored");
});

test("generateState: prefixed and unique", () => {
  const a = o.generateState();
  const b = o.generateState();
  assert(a.startsWith("ms365_"), "state prefixed");
  assert(a !== b, "states differ");
});

test("buildAuthorizeUrl: every OAuth2 param present, encoded, tenant-substituted", async () => {
  o.configure({ ...TEST_CONFIG, scopes: "openid profile email", tenant: "contoso.onmicrosoft.com" });
  const built = await o.buildAuthorizeUrl({ codeVerifier: "verifier-1", state: "state-1" });
  const u = new URL(built.url);
  assertEq(u.origin + u.pathname, "https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
  assertEq(u.searchParams.get("client_id"), TEST_CONFIG.clientId);
  assertEq(u.searchParams.get("response_type"), "code");
  assertEq(u.searchParams.get("redirect_uri"), TEST_CONFIG.redirectUri);
  assertEq(u.searchParams.get("scope"), "openid profile email offline_access");
  assertEq(u.searchParams.get("code_challenge_method"), "S256");
  assertEq(u.searchParams.get("state"), "state-1");
  assertEq(u.searchParams.get("code_challenge").length, 43);
  assertEq(built.verifier, "verifier-1");
  assertEq(built.redirectUri, TEST_CONFIG.redirectUri);
});

test("redirect URI: auto-detects from window.location, excluding hash/query", async () => {
  o.configure({ ...TEST_CONFIG, redirectUri: "" });
  const built = await o.buildAuthorizeUrl({ codeVerifier: "v", state: "s" });
  const u = new URL(built.url);
  assertEq(u.searchParams.get("redirect_uri"), window.location.origin + window.location.pathname);
});

test("prompt=consent is forwarded to the authorize URL", async () => {
  o.configure({ ...TEST_CONFIG, prompt: "consent" });
  const built = await o.buildAuthorizeUrl({ codeVerifier: "v", state: "s" });
  const u = new URL(built.url);
  assertEq(u.searchParams.get("prompt"), "consent");
});

test("prepareAuth: persists state + verifier + redirectUri for the callback", async () => {
  const store = new MemoryStorage();
  o.configure({ ...TEST_CONFIG, storage: () => store });
  const built = await o.prepareAuth();
  const raw = store.getItem("ms365.oauth2.pending");
  assert(raw, "pending record stored");
  const p = JSON.parse(raw);
  assertEq(p.state, built.state);
  assertEq(p.verifier, built.verifier);
  assertEq(p.redirectUri, TEST_CONFIG.redirectUri);
  assert(typeof p.createdAt === "number", "timestamp recorded");
});

test("exchangeCodeForTokens: request shape and normalized tokens", async () => {
  const fetchImpl = mockFetch((req) => {
    assertEq(req.url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
    assertEq(req.init.method, "POST");
    assertEq(req.init.headers["Content-Type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(req.init.body);
    assertEq(body.get("grant_type"), "authorization_code");
    assertEq(body.get("code"), "auth-code-123");
    assertEq(body.get("redirect_uri"), TEST_CONFIG.redirectUri);
    assertEq(body.get("client_id"), TEST_CONFIG.clientId);
    assertEq(body.get("code_verifier"), "verifier-1");
    return { json: { access_token: "AT", refresh_token: "RT", id_token: "IT", token_type: "Bearer", scope: "openid User.Read", expires_in: 3599 } };
  });
  o.configure({ ...TEST_CONFIG, fetchImpl });
  const t = await o.exchangeCodeForTokens("auth-code-123", "verifier-1", { redirectUri: TEST_CONFIG.redirectUri });
  assertEq(t.accessToken, "AT");
  assertEq(t.refreshToken, "RT");
  assertEq(t.idToken, "IT");
  assertEq(t.tokenType, "Bearer");
  assert(t.expiresAt > Date.now() + 3500 * 1000, "expiresAt near now + expires_in");
  assert(fetchImpl.calls.length === 1, "exactly one token request made");
});

test("exchangeCodeForTokens: no refresh token if absent", async () => {
  const fetchImpl = mockFetch(() => ({ json: { access_token: "AT", expires_in: 3600 } }));
  o.configure({ ...TEST_CONFIG, fetchImpl });
  const t = await o.exchangeCodeForTokens("c", "v", { redirectUri: TEST_CONFIG.redirectUri });
  assertEq(t.refreshToken, null);
});

test("exchangeCodeForTokens: maps Microsoft error codes to friendly errors", async () => {
  const fetchImpl = mockFetch(() => ({
    status: 400, ok: false,
    json: { error: "invalid_grant", error_description: "AADSTS70000: code is expired." },
  }));
  o.configure({ ...TEST_CONFIG, fetchImpl });
  let err = null;
  try { await o.exchangeCodeForTokens("bad", "v", { redirectUri: TEST_CONFIG.redirectUri }); } catch (e) { err = e; }
  assert(err, "throws on error response");
  assert(err.isMs365Error, "flagged as ms365 error");
  assertEq(err.code, "invalid_grant");
  assert(err.message.includes("invalid or has expired"), "friendly message, got: " + err.message);
  assertEq(err.httpStatus, 400);
});

test("exchangeCodeForTokens: wraps network-level failures", async () => {
  const fetchImpl = async () => { throw new Error("boom"); };
  o.configure({ ...TEST_CONFIG, fetchImpl });
  let err = null;
  try { await o.exchangeCodeForTokens("c", "v", { redirectUri: TEST_CONFIG.redirectUri }); } catch (e) { err = e; }
  assert(err && err.message.includes("network level"), "network error wrapped");
});

test("handleCallback: no auth response → null", async () => {
  o.configure({ ...TEST_CONFIG, storage: () => new MemoryStorage() });
  const r = await o.handleCallback({ params: new URLSearchParams("") });
  assertEq(r, null);
});

test("handleCallback: rejects a mismatched state (CSRF guard)", async () => {
  const store = new MemoryStorage();
  o.configure({ ...TEST_CONFIG, storage: () => store });
  await o.prepareAuth();
  const r = await o.handleCallback({ params: new URLSearchParams("code=abc&state=EVILSTATE") });
  assert(r && r.status === "error", "error status on state mismatch");
  assert(r.error.message.includes("state"), "message mentions state");
});

test("handleCallback: full same-tab callback exchanges the code", async () => {
  const store = new MemoryStorage();
  const fetchImpl = mockFetch(() => ({
    json: { access_token: "AT", refresh_token: "RT", id_token: fakeIdToken({ name: "Ada Lovelace", preferred_username: "ada@contoso.com" }), token_type: "Bearer", scope: "openid User.Read", expires_in: 3600 },
  }));
  o.configure(freshConfig({ storage: () => store, fetchImpl }));
  const built = await o.prepareAuth();
  const params = new URLSearchParams("code=cb-code&state=" + encodeURIComponent(built.state));
  const r = await o.handleCallback({ params });
  assert(r.status === "success", "success status, got " + r.status);
  assertEq(r.tokens.accessToken, "AT");
  assertEq(r.tokens.refreshToken, "RT");
  assert(r.profile, "profile derived from id_token");
  assertEq(r.profile.email, "ada@contoso.com");
  assertEq(store.getItem("ms365.oauth2.pending"), null, "pending cleared after exchange");
});

test("handleCallback: access_denied maps to a friendly error", async () => {
  const store = new MemoryStorage();
  o.configure({ ...TEST_CONFIG, storage: () => store });
  const built = await o.prepareAuth();
  const params = new URLSearchParams("error=access_denied&error_description=The+user+canceled&state=" + encodeURIComponent(built.state));
  const r = await o.handleCallback({ params });
  assert(r.status === "error", "error status");
  assertEq(r.error.code, "access_denied");
  assert(r.error.message.includes("declined"), "friendly message, got: " + r.error.message);
});

test("profileFromIdToken: decodes name/email/tenant from the JWT payload", () => {
  const payload = { name: "Ada Lovelace", preferred_username: "ada@contoso.com", tid: "tenant-1", oid: "oid-1", sub: "sub-1" };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const p = o.profileFromIdToken("h." + b64 + ".s");
  assertEq(p.name, "Ada Lovelace");
  assertEq(p.email, "ada@contoso.com");
  assertEq(p.tenantId, "tenant-1");
  assertEq(o.profileFromIdToken("not-a-jwt"), null);
  assertEq(o.decodeJwtPayload(null), null);
});

test("launchAuthFlow: popup path exchanges the code posted back by the popup", async () => {
  const store = new MemoryStorage();
  const fetchImpl = mockFetch(() => ({
    json: { access_token: "AT", refresh_token: "RT", id_token: fakeIdToken({ name: "Ada" }), token_type: "Bearer", expires_in: 3600 },
  }));
  o.configure(freshConfig({ storage: () => store, fetchImpl, navigate: () => { throw new Error("popup mode must not navigate the main tab"); } }));
  const origOpen = window.open;
  window.open = () => ({ closed: false });
  try {
    const promise = o.launchAuthFlow({ state: "s-popup", codeVerifier: "v-popup" });
    await new Promise((r) => setTimeout(r, 30));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "ms365-auth", state: "s-popup", code: "popup-code" },
    }));
    const res = await promise;
    assertEq(res.tokens.accessToken, "AT");
    assertEq(res.tokens.refreshToken, "RT");
    assert(res.profile, "profile present");
  } finally {
    window.open = origOpen;
  }
});

test("launchAuthFlow: popup blocked → same-tab redirect to the authorize URL", async () => {
  const store = new MemoryStorage();
  let assigned = null;
  o.configure({ ...TEST_CONFIG, storage: () => store, navigate: (u) => { assigned = u; } });
  const origOpen = window.open;
  window.open = () => null;
  try {
    const r = await o.launchAuthFlow();
    assertEq(r, null, "returns null (page is navigating)");
    assert(assigned && assigned.startsWith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"), "navigates to the authorize URL");
  } finally {
    window.open = origOpen;
  }
});

// ═══════════════ Token Lifecycle Manager ══════════════════════════════════

test("token-store: save/load roundtrip, clear, and corrupt-safe reads", () => {
  const store = new TokenStore(new MemoryStorage());
  store.save({ tokens: { accessToken: "AT", refreshToken: "RT", expiresAt: 123456 }, profile: { name: "A" }, savedAt: 1 });
  const loaded = store.load();
  assertEq(loaded.tokens.accessToken, "AT");
  assertEq(loaded.tokens.expiresAt, 123456);
  assertEq(loaded.profile.name, "A");
  store.clear();
  assertEq(store.load(), null, "cleared");
  const corrupt = new TokenStore(new MemoryStorage());
  corrupt.storage.setItem("ms365.oauth2.session", "{not json");
  assertEq(corrupt.load(), null, "corrupt payload → null");
  const missing = new TokenStore(new MemoryStorage());
  missing.storage.setItem("ms365.oauth2.session", JSON.stringify({ tokens: null }));
  assertEq(missing.load(), null, "missing tokens → null");
});

test("saveSession/loadSession/clearSession route through the configured store", () => {
  const store = new TokenStore(new MemoryStorage());
  o.configure(freshConfig({ store }));
  assertEq(o.loadSession(), null, "empty store");
  o.saveSession({ tokens: { accessToken: "AT1", refreshToken: "RT1", expiresAt: 999 }, profile: { name: "Ada" } });
  const s = o.loadSession();
  assertEq(s.tokens.accessToken, "AT1");
  assertEq(s.profile.name, "Ada");
  o.clearSession();
  assertEq(o.loadSession(), null);
});

test("refreshTokens: posts the refresh_token grant and returns rotated tokens", async () => {
  const fetchImpl = mockFetch((req) => {
    assertEq(req.url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
    assertEq(req.init.method, "POST");
    const body = new URLSearchParams(req.init.body);
    assertEq(body.get("grant_type"), "refresh_token");
    assertEq(body.get("refresh_token"), "OLD-RT");
    assertEq(body.get("client_id"), TEST_CONFIG.clientId);
    assertEq(body.get("redirect_uri"), TEST_CONFIG.redirectUri);
    assert(body.get("scope").includes("offline_access"), "offline_access scope sent on refresh");
    return { json: { access_token: "NEW-AT", refresh_token: "NEW-RT", token_type: "Bearer", expires_in: 3600, scope: "openid User.Read" } };
  });
  o.configure(freshConfig({ fetchImpl }));
  const t = await o.refreshTokens("OLD-RT", { redirectUri: TEST_CONFIG.redirectUri });
  assertEq(t.accessToken, "NEW-AT");
  assertEq(t.refreshToken, "NEW-RT");
  assert(fetchImpl.calls.length === 1, "one request");
});

test("getValidToken: returns the cached token while valid (no network)", async () => {
  const store = new TokenStore(new MemoryStorage());
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => ({ access_token: "X" }) }; };
  o.configure(freshConfig({ store, fetchImpl }));
  o.saveSession({ tokens: { accessToken: "VALID", refreshToken: "RT", expiresAt: Date.now() + 60 * 60 * 1000 }, profile: null });
  const tok = await o.getValidToken();
  assertEq(tok, "VALID");
  assertEq(calls, 0, "no refresh while valid");
});

test("getValidToken: refreshes when expired and rotates the refresh token", async () => {
  const store = new TokenStore(new MemoryStorage());
  const fetchImpl = mockFetch(() => ({ json: { access_token: "NEW-AT", refresh_token: "NEW-RT", token_type: "Bearer", expires_in: 3600 } }));
  o.configure(freshConfig({ store, fetchImpl }));
  o.saveSession({ tokens: { accessToken: "OLD-AT", refreshToken: "OLD-RT", expiresAt: Date.now() - 5000 }, profile: { name: "Ada" } });
  const tok = await o.getValidToken();
  assertEq(tok, "NEW-AT");
  const saved = o.loadSession();
  assertEq(saved.tokens.accessToken, "NEW-AT");
  assertEq(saved.tokens.refreshToken, "NEW-RT", "refresh token rotated");
  assertEq(saved.profile.name, "Ada", "profile preserved");
  assertEq(fetchImpl.calls.length, 1);
});

test("getValidToken: refreshes when inside the safety margin", async () => {
  const store = new TokenStore(new MemoryStorage());
  const fetchImpl = mockFetch(() => ({ json: { access_token: "NEW-AT", refresh_token: "NEW-RT", token_type: "Bearer", expires_in: 3600 } }));
  o.configure(freshConfig({ store, fetchImpl }));
  store.save({
    tokens: { accessToken: "OLD", refreshToken: "RT", expiresAt: Date.now() + 60 * 1000 },
    profile: null,
    savedAt: Date.now() - 3600 * 1000,
  });
  const tok = await o.getValidToken();
  assertEq(tok, "NEW-AT", "refreshes pre-emptively inside the margin");
  assertEq(fetchImpl.calls.length, 1);
});

test("getValidToken: no session → null, no network", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, json: async () => ({}) }; };
  o.configure(freshConfig({ fetchImpl }));
  const tok = await o.getValidToken();
  assertEq(tok, null);
  assertEq(calls, 0);
});

test("getValidToken: expired without a refresh token → clears + fires sessionExpired", async () => {
  const store = new TokenStore(new MemoryStorage());
  o.configure(freshConfig({ store }));
  o.saveSession({ tokens: { accessToken: "OLD", refreshToken: null, expiresAt: Date.now() - 5000 }, profile: null });
  let expired = null;
  const off = o.onSessionExpired((err) => { expired = err; });
  const tok = await o.getValidToken();
  off();
  assertEq(tok, null);
  assertEq(o.loadSession(), null, "session cleared");
  assert(expired && expired.code === "no_refresh_token", "sessionExpired fired with code");
});

test("getValidToken: invalid_grant clears the session and fires sessionExpired", async () => {
  const store = new TokenStore(new MemoryStorage());
  const fetchImpl = mockFetch(() => ({ status: 400, ok: false, json: { error: "invalid_grant", error_description: "refresh token revoked" } }));
  o.configure(freshConfig({ store, fetchImpl }));
  o.saveSession({ tokens: { accessToken: "OLD", refreshToken: "RT", expiresAt: Date.now() - 5000 }, profile: null });
  let expired = null;
  const off = o.onSessionExpired((err) => { expired = err; });
  const tok = await o.getValidToken();
  off();
  assertEq(tok, null, "returns null on unrecoverable refresh");
  assertEq(o.loadSession(), null, "session cleared");
  assert(expired && expired.code === "invalid_grant", "sessionExpired fired with invalid_grant");
});

test("getValidToken: single-flight — concurrent callers share one refresh", async () => {
  const store = new TokenStore(new MemoryStorage());
  let calls = 0;
  const fetchImpl = mockFetch(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 40));
    return { json: { access_token: "AT-" + calls, refresh_token: "RT-" + calls, token_type: "Bearer", expires_in: 3600 } };
  });
  o.configure(freshConfig({ store, fetchImpl }));
  o.saveSession({ tokens: { accessToken: "OLD", refreshToken: "RT", expiresAt: Date.now() - 5000 }, profile: null });
  const [a, b] = await Promise.all([o.getValidToken(), o.getValidToken()]);
  assertEq(a, "AT-1");
  assertEq(b, "AT-1", "both callers get the same refreshed token");
  assertEq(calls, 1, "exactly one refresh despite two callers");
});

test("getValidToken: transient network error propagates (session kept)", async () => {
  const store = new TokenStore(new MemoryStorage());
  const fetchImpl = async () => { throw new Error("offline"); };
  o.configure(freshConfig({ store, fetchImpl }));
  o.saveSession({ tokens: { accessToken: "OLD", refreshToken: "RT", expiresAt: Date.now() - 5000 }, profile: null });
  let threw = null;
  try { await o.getValidToken(); } catch (e) { threw = e; }
  assert(threw && threw.message.includes("network level"), "network error surfaced");
  assert(o.loadSession(), "session preserved for retry");
});

test("scheduleAutoRefresh: schedules just before expiry", () => {
  const store = new TokenStore(new MemoryStorage());
  o.configure(freshConfig({ store, autoRefresh: true }));
  const orig = globalThis.setTimeout;
  let captured = null;
  globalThis.setTimeout = (fn, ms) => { captured = { fn, ms }; return 1; };
  try {
    o.saveSession({ tokens: { accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 60 * 60 * 1000 }, profile: null });
    const delay = o.scheduleAutoRefresh();
    assert(captured, "setTimeout scheduled");
    const expected = 60 * 60 * 1000 - 5 * 60 * 1000;
    assert(Math.abs(captured.ms - expected) < 5000, "delay ≈ lifetime − margin, got " + captured.ms);
    assertEq(delay, captured.ms, "returns the delay");
  } finally {
    globalThis.setTimeout = orig;
  }
});

test("scheduleAutoRefresh: no-op when autoRefresh is disabled", () => {
  const store = new TokenStore(new MemoryStorage());
  o.configure(freshConfig({ store, autoRefresh: false }));
  o.saveSession({ tokens: { accessToken: "A", refreshToken: "R", expiresAt: Date.now() + 3600 * 1000 }, profile: null });
  const delay = o.scheduleAutoRefresh();
  assertEq(delay, null);
});

test("handleCallback: persists the session to the token store", async () => {
  const store = new TokenStore(new MemoryStorage());
  const pendingStore = new MemoryStorage();
  const fetchImpl = mockFetch(() => ({ json: { access_token: "AT", refresh_token: "RT", id_token: fakeIdToken({ name: "Ada" }), token_type: "Bearer", expires_in: 3600 } }));
  o.configure(freshConfig({ store, storage: () => pendingStore, fetchImpl }));
  const built = await o.prepareAuth();
  const params = new URLSearchParams("code=cb-code&state=" + encodeURIComponent(built.state));
  const r = await o.handleCallback({ params });
  assert(r.status === "success", "success");
  const s = o.loadSession();
  assertEq(s.tokens.accessToken, "AT");
  assertEq(s.tokens.refreshToken, "RT");
  assertEq(s.profile.name, "Ada");
});

test("sign-out clears the stored session", () => {
  const store = new TokenStore(new MemoryStorage());
  o.configure(freshConfig({ store }));
  o.saveSession({ tokens: { accessToken: "A", refreshToken: "R", expiresAt: 999 }, profile: null });
  assert(o.loadSession(), "session present");
  o.clearSession();
  assertEq(o.loadSession(), null);
});
