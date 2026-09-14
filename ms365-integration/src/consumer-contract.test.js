// src/consumer-contract.test.js
// Consumer Contract suite — the "can someone actually import this?" checks.
//
// Everything else under src/ validates the feature modules. This suite instead
// drives the API exactly the way ANOTHER generator does: it takes the object
// root.getMs365Api() (== what `{import:...}` gives an importer as root.<handle>)
// and uses nothing else — no src/ module imports, no window.ms365, no plugin
// HTML, no DOM, no window.__m365 bridge. Every call goes through an injected
// fetch + an injected async storage, i.e. fully headless.
//
// Run via ?test=consumer, or:
//   const t = await import("src/consumer-contract.test.js"); return await t.runAll();

import { makeSuite, assert, assertEq } from "./test-helpers.js";
import { ms365Api } from "./runtime.js";

const { test, runAll } = makeSuite();
export { runAll };

// ── helpers ────────────────────────────────────────────────────────────────
// A storage whose get/set/remove all return promises (the kv/IndexedDB shape).
function asyncStore() {
  const m = new Map();
  return {
    m,
    writes: [],
    reads: [],
    async get(k) { this.reads.push(k); return m.has(k) ? m.get(k) : null; },
    async set(k, v) { this.writes.push(k); m.set(k, String(v)); },
    async remove(k) { m.delete(k); },
  };
}

function mockRes(status, payload, headers = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    async json() { if (typeof payload === "string") throw new Error("not json"); return payload; },
    async text() { return text; },
    async arrayBuffer() { return new TextEncoder().encode(text).buffer; },
  };
}

const BASE_OPTS = {
  clientId: "consumer-app-0000",
  tenant: "contoso.onmicrosoft.com",
  scopes: "openid User.Read",
  redirectUri: "https://example.com/cb",
  autoRefresh: false,
};

function consumerSession(overrides = {}) {
  return Object.assign({
    tokens: { accessToken: "AT-1", refreshToken: "RT-1", expiresAt: Date.now() + 60 * 60 * 1000, scope: ["openid", "User.Read"] },
    profile: { name: "Ada", oid: "u-1", tenantId: "t-1" },
  }, overrides);
}

// ── tests ──────────────────────────────────────────────────────────────────

test("contract: the imported object is callable and exposes every documented namespace", () => {
  const api = ms365Api();
  assert(typeof api === "function", "the API object is callable (renders the widget)");
  assertEq(api.version, "2.0.0");
  assertEq(typeof api.capabilities, "function");
  for (const name of ["configure", "config", "reset"]) assertEq(typeof api[name], "function", name);
  for (const ns of ["auth", "oauth2", "tokenStore", "tenantValidator", "scopedPermissions", "graph", "errorMapper", "mail", "files", "tasks", "health"]) {
    assert(api[ns] && typeof api[ns] === "object", ns + " namespace present");
  }
  assertEq(api.auth, api.oauth2, "auth is an alias of oauth2");
  assertEq(typeof api.auth.launchAuthFlow, "function");
  assertEq(typeof api.auth.getValidToken, "function");
  assertEq(typeof api.auth.handleCallback, "function");
  assertEq(typeof api.health.testConnection, "function");
  assertEq(typeof api.files.discover.listFiles, "function");
  assertEq(typeof api.files.discover.getFileByPath, "function");
  assertEq(typeof api.files.transfer.downloadFile, "function");
  assertEq(typeof api.files.transfer.uploadFile, "function");
  assertEq(typeof api.graph.graphGet, "function");
  assertEq(typeof api.graph.getAllPages, "function");
  assertEq(typeof api.mail.send.sendEmail, "function");
  assertEq(typeof api.mail.calendar.listUpcomingEvents, "function");
  assertEq(typeof api.tasks.sync.listTaskLists, "function");
  assertEq(typeof api.scopedPermissions.ensureScopes, "function");
  assertEq(typeof api.widget, "function");
  const caps = api.capabilities();
  assert(caps.namespaces.indexOf("graph") >= 0 && caps.namespaces.indexOf("files") >= 0, "capabilities() lists namespaces");
  assert(caps.featureScopes.mailSend.join(",") === "Mail.Send", "capabilities() lists feature scopes");
});

test("contract: building the API is side-effect-free — no fetch, no popup, no window.ms365, no DOM", () => {
  const realFetch = window.fetch;
  const realOpen = window.open;
  let fetchCalls = 0, popupCalls = 0;
  const domBefore = document.body.innerHTML;
  window.fetch = function (...a) { fetchCalls++; return realFetch.apply(this, a); };
  window.open = function (...a) { popupCalls++; return realOpen.apply(this, a); };
  try {
    const prevApi = window.__ms365Internal.api;
    delete window.__ms365Internal.api;          // force a real construction
    const api = root.getMs365Api();
    assert(typeof api === "function" && typeof api.graph.graphGet === "function", "rebuilt api");
    assertEq(fetchCalls, 0, "construction makes no network calls");
    assertEq(popupCalls, 0, "construction opens no windows");
    assertEq(typeof window.__m365, "undefined", "the legacy window.__m365 bridge is gone");
    assertEq(typeof window.ms365, "undefined", "the plugin does not claim window.ms365");
    assertEq(document.body.innerHTML, domBefore, "construction does not touch the DOM");
    window.__ms365Internal.api = prevApi;      // keep the cached identity stable
  } finally {
    window.fetch = realFetch;
    window.open = realOpen;
  }
});

test("contract: configure() round-trips, merges on repeat calls, and config() returns a copy", async () => {
  const api = ms365Api();
  await api.reset();
  const cfg = api.configure(BASE_OPTS);
  assertEq(cfg.clientId, "consumer-app-0000");
  assertEq(cfg.tenant, "contoso.onmicrosoft.com");
  assertEq(cfg.scopes.join(" "), "openid User.Read offline_access", "scopes normalized + offline_access added");
  assertEq(cfg.redirectUri, "https://example.com/cb");
  assert(api.config().scopes.indexOf("User.Read") >= 0);

  api.configure({ prompt: "consent" });
  assertEq(api.config().clientId, "consumer-app-0000", "merge keeps the previous clientId");
  assertEq(api.config().prompt, "consent", "merge applies the new key");

  const a = api.config(), b = api.config();
  assert(a !== b, "config() returns a fresh object each call");
  a.scopes.push("Tampered.Scope");
  assert(api.config().scopes.indexOf("Tampered.Scope") < 0, "mutating the returned copy can't corrupt state");

  let threw = false;
  try { api.configure({ clientId: "   " }); } catch (e) { threw = true; }
  assert(threw, "configure without a clientId throws");
  assertEq(api.config().clientId, "consumer-app-0000", "a rejected configure leaves the old config intact");
});

test("contract: a generic Graph call works with an injected fetch and an injected ASYNC storage", async () => {
  const api = ms365Api();
  const store = asyncStore();
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).indexOf("/oauth2/v2.0/token") >= 0) {
      return mockRes(200, { access_token: "AT-2", refresh_token: "RT-2", token_type: "Bearer", expires_in: 3600, scope: "openid User.Read" });
    }
    return mockRes(200, { id: "me-1", displayName: "Ada" });
  };

  await api.reset();
  api.configure(Object.assign({}, BASE_OPTS, { fetchImpl: impl, storage: store }));
  await api.auth.saveSession(consumerSession());

  const me = await api.graph.graphGet("/me", { query: { $select: "id,displayName" } });
  assertEq(me.displayName, "Ada");
  assertEq(calls.length, 1, "one Graph call, no token traffic while the token is valid");
  assertEq(calls[0].init.headers.Authorization, "Bearer AT-1");
  assertEq(calls[0].url, "https://graph.microsoft.com/v1.0/me?$select=id%2CdisplayName", "OData query built with a literal $ key");

  // the async store really is the backing store, and it is namespaced per connection
  const keys = api.auth.storageKeys();
  assertEq(keys.namespace, "consumer-app-0000|contoso.onmicrosoft.com");
  assert(store.writes.indexOf(keys.session) >= 0, "session written through the injected async storage");
  assert((await store.get(keys.session)) !== null, "value readable back from the async storage");
  const loaded = await api.auth.loadSession();
  assertEq(loaded.tokens.accessToken, "AT-1", "session round-trips through the promise-returning store");
});

test("contract: a 401 triggers a refresh-and-retry (single-flight token lifecycle intact)", async () => {
  const api = ms365Api();
  const store = asyncStore();
  let tokenHits = 0, graphHits = 0;
  const impl = async (url) => {
    if (String(url).indexOf("/oauth2/v2.0/token") >= 0) {
      tokenHits++;
      return mockRes(200, { access_token: "AT-2", refresh_token: "RT-2", token_type: "Bearer", expires_in: 3600, scope: "openid User.Read" });
    }
    graphHits++;
    if (graphHits === 1) return mockRes(401, { error: { code: "InvalidAuthenticationToken", message: "expired" } });
    return mockRes(200, { id: "me-1" });
  };

  await api.reset();
  api.configure(Object.assign({}, BASE_OPTS, { fetchImpl: impl, storage: store }));
  await api.auth.saveSession(consumerSession());

  const me = await api.graph.graphGet("/me");
  assertEq(me.id, "me-1", "the retry succeeded");
  assertEq(tokenHits, 1, "exactly one refresh");
  assertEq(graphHits, 2, "initial 401 + one retry");
  const stored = await api.auth.loadSession();
  assertEq(stored.tokens.accessToken, "AT-2", "the rotated token was persisted");
});

test("contract: errors surface as friendly mapped errors (code/status/friendly/category/hint/retryable)", async () => {
  const api = ms365Api();
  const impl = async () => mockRes(403, { error: { code: "accessDenied", message: "Nope." } });
  await api.reset();
  api.configure(Object.assign({}, BASE_OPTS, { fetchImpl: impl, storage: asyncStore() }));
  await api.auth.saveSession(consumerSession());

  let err = null;
  try { await api.graph.graphGet("/me"); } catch (e) { err = e; }
  assert(err, "throws");
  assertEq(err.status, 403);
  assertEq(err.code, "accessDenied");
  assertEq(err.category, "permission");
  assert(/permission/i.test(err.friendly), "friendly message");
  assert(err.hint.length > 0, "hint present");
  assertEq(err.retryable, false, "403 is not retryable");
});

test("contract: reset() clears config + stored session/pending, and $output is the API object (not a string)", async () => {
  const api = ms365Api();
  const store = asyncStore();
  await api.reset();
  api.configure(Object.assign({}, BASE_OPTS, { storage: store, fetchImpl: async () => mockRes(200, {}) }));
  await api.auth.saveSession(consumerSession());
  await api.auth.prepareAuth({ codeVerifier: "verifier-1", state: "state-1" });
  const keys = api.auth.storageKeys();
  assert((await store.get(keys.session)) !== null, "session stored");
  assert((await store.get(keys.pending)) !== null, "pending auth record stored");

  await api.reset();
  assertEq(api.config(), null, "config cleared");
  assertEq(await store.get(keys.session), null, "session cleared");
  assertEq(await store.get(keys.pending), null, "pending cleared");

  // $output = [getMs365Api()] — the imported handle must be the API object, not
  // the widget markup string the old version returned.
  const api2 = ms365Api();
  assert(typeof api2 !== "string", "the exported value is not a string");
  assert(typeof api2 === "function" && typeof api2.graph.graphGet === "function", "the exported value is the API object");
  assertEq(api2, root.getMs365Api(), "getMs365Api() is stable/cached");
});

test("contract: relay mode points redirect_uri at the plugin's own page (one shared Azure redirect URI)", async () => {
  const api = ms365Api();
  await api.reset();
  const opts = Object.assign({}, BASE_OPTS, { relay: true });
  delete opts.redirectUri;
  api.configure(opts);

  assertEq(api.auth.relayRedirect(api.config()), "https://perchance.org/ms365-integration", "relay:true → the plugin's page");
  assertEq(api.auth.relayRedirect(api.config(), { relay: "my-fork" }), "https://perchance.org/my-fork", "a name is resolved to a page URL");
  assertEq(api.auth.relayRedirect(api.config(), { relay: "https://example.com/relay" }), "https://example.com/relay", "an absolute URL passes through");
  assertEq(api.auth.relayRedirect(api.config(), { relay: false }), "", "no relay → no override");

  const built = await api.auth.buildAuthorizeUrl({ codeVerifier: "v-1", state: "s-1" });
  assertEq(built.redirectUri, "https://perchance.org/ms365-integration");
  assertEq(new URL(built.url).searchParams.get("redirect_uri"), "https://perchance.org/ms365-integration", "the authorize request carries the shared URI");
});

test("contract: the relay page forwards {code, state} to the opener instead of erroring", async () => {
  const api = ms365Api();
  await api.reset();
  const msgs = [];
  const desc = Object.getOwnPropertyDescriptor(window, "opener");
  const realClose = window.close;
  let closed = 0;
  Object.defineProperty(window, "opener", { configurable: true, value: { postMessage: (m, o) => msgs.push({ m, o }) } });
  window.close = () => { closed++; };
  try {
    const ok = await api.auth.handleCallback({ params: new URLSearchParams("code=C1&state=S1&__ms365_relay=1") });
    assertEq(ok.status, "relayed");
    assertEq(msgs.length, 1, "one message posted");
    assertEq(msgs[0].m.type, "ms365:auth");
    assertEq(msgs[0].m.code, "C1");
    assertEq(msgs[0].m.state, "S1");
    assertEq(msgs[0].o, "*");
    assertEq(closed, 1, "asked to close itself");

    msgs.length = 0;
    const bad = await api.auth.handleCallback({ params: new URLSearchParams("error=access_denied&error_description=Denied&state=S2&__ms365_relay=1") });
    assertEq(bad.status, "relayed");
    assertEq(msgs[0].m.error, "access_denied");
    assertEq(msgs[0].m.errorDescription, "Denied");

    // no auth params → no-op (safe to call on every page load)
    assertEq(await api.auth.handleCallback({ params: new URLSearchParams("foo=bar") }), null);
  } finally {
    window.close = realClose;
    try { delete window.opener; } catch (e) { window.opener = null; }
    if (desc) Object.defineProperty(window, "opener", desc);
  }
});

test("contract: launchAuthFlow accepts a cross-origin relay message and closes the popup", async () => {
  const api = ms365Api();
  const store = asyncStore();
  const tokenCalls = [];
  const impl = async (url) => {
    tokenCalls.push(String(url));
    return mockRes(200, { access_token: "AT-RELAY", refresh_token: "RT-RELAY", token_type: "Bearer", expires_in: 3600, scope: "openid User.Read" });
  };
  await api.reset();
  const opts = Object.assign({}, BASE_OPTS, { relay: true, fetchImpl: impl, storage: store });
  delete opts.redirectUri;
  api.configure(opts);

  const realOpen = window.open;
  let openedUrl = null;
  const fakePopup = { closed: false, close() { this.closed = true; } };
  window.open = (url) => { openedUrl = url; return fakePopup; };
  const flow = api.auth.launchAuthFlow({});
  try {
    for (let i = 0; i < 100 && !openedUrl; i++) await new Promise((r) => setTimeout(r, 5));
    assert(openedUrl, "popup opened");
    const state = new URL(openedUrl).searchParams.get("state");
    assert(state, "state present in the authorize URL");

    // Simulate the relay page (a different origin, a window we have no handle
    // on) posting the authorization response back to us.
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "ms365:auth", state, code: "RELAY-CODE" },
      origin: "https://02a6bc0dc856b0a1a76b86f74c92f7bb.perchance.org",
      source: window,
    }));

    const res = await flow;
    assertEq(res.tokens.accessToken, "AT-RELAY", "the relayed code was exchanged");
    assertEq(tokenCalls.length, 1, "exactly one token request");
    assert(fakePopup.closed === true, "the opener closed the sign-in popup");
    assertEq((await api.auth.loadSession()).tokens.accessToken, "AT-RELAY", "session persisted");
  } finally {
    window.open = realOpen;
  }
});
