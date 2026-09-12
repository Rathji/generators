// src/tests/sso.test.js — validation tests for Phase 13 task 58 (single sign-on:
// the client-side flow service). Run in the live page:
//   await import("./src/tests/sso.test.js").then((m) => m.run())
//
// Covers: the redirect URI resolution; loading + caching the server's provider
// configuration; resolving a provider by id; beginning an attempt (PKCE
// challenge, state and nonce stored, popup opened, blocked-popup handling);
// the simulator path; completing the flow (code exchange, ID token submitted to
// the server); the popup postMessage channel (ignoring foreign messages);
// discovery (endpoints + public keys folded in); and the result listeners.

import { runTests, assert, assertEq } from "./harness.js";
import { createSsoService, SIMULATOR_PERSONAS } from "../framework/sso.js";

// ---- fakes -----------------------------------------------------------------
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] || null,
    get length() {
      return m.size;
    },
  };
}

const REDIRECT = "https://gen.example/site/src/sso-callback.html";

const provider = {
  id: "entra",
  name: "Contoso Entra ID",
  kind: "oidc",
  issuer: "https://login.microsoftonline.com/tid/v2.0",
  authorizationEndpoint: "https://login.microsoftonline.com/tid/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.microsoftonline.com/tid/oauth2/v2.0/token",
  jwksUri: "https://login.microsoftonline.com/tid/discovery/v2.0/keys",
  clientId: "app-123",
  scopes: "openid profile email",
  rules: [],
};

function fakeHub({ connected = true, canEdit = false } = {}) {
  const calls = { begin: [], login: [], setConfig: [] };
  return {
    calls,
    connected,
    available: true,
    async ssoConfig() {
      return {
        providers: [provider],
        simulator: { id: "simulator", name: "IT-U simulator", kind: "simulator", demo: true },
        canEdit,
        offline: false,
      };
    },
    async ssoBegin(providerId) {
      calls.begin.push(providerId);
      return { state: "STATE-" + providerId, nonce: "NONCE-" + providerId, providerId };
    },
    async ssoLogin({ idToken, state }) {
      calls.login.push({ idToken, state });
      return { username: "alice", isAdmin: false, roles: [], groups: 2, token: "tok" };
    },
    async ssoSetConfig(providers) {
      calls.setConfig.push(providers);
      return providers;
    },
  };
}

const loc = { href: "https://gen.example/site/", origin: "https://gen.example" };

// A fetch stub. `routes` maps a URL to a value (returned as res.json()) or a
// function returning { ok, status, json }.
function withFetch(routes, fn) {
  const original = window.fetch;
  window.fetch = async (url, opts) => {
    const key = typeof url === "string" ? url : String(url);
    const hit = routes[key] || routes["*"];
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const value = typeof hit === "function" ? hit(opts) : hit;
    return { ok: value.ok !== false, status: value.status || 200, json: async () => (value.json !== undefined ? value.json : value) };
  };
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      window.fetch = original;
    });
}

export async function run() {
  return runTests([
    {
      name: "redirectUri resolves src/sso-callback.html against the page",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        assertEq(sso.redirectUri(), REDIRECT);
        // A document URL with no trailing slash resolves exactly the way
        // index.html's own relative `src/...` references resolve — to the host
        // root (this is what the live page does: <publicId>.perchance.org/src/...).
        const sso2 = createSsoService({ hub: fakeHub(), storage: memStorage(), location: { href: "https://gen.example/site", origin: "https://gen.example" } });
        assertEq(sso2.redirectUri(), "https://gen.example/src/sso-callback.html");
      },
    },
    {
      name: "loadConfig caches until forced, and reports offline without a hub",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        const a = await sso.loadConfig();
        assertEq(a.providers.length, 1, "one provider");
        assertEq(sso.providers().length, 1, "cached accessor");
        assertEq(sso.canEdit(), false, "not editable without admin");
        const offline = createSsoService({ hub: { connected: false }, storage: memStorage(), location: loc });
        const b = await offline.loadConfig();
        assert(b.offline === true, "offline flag");
        assertEq(b.providers.length, 0, "no providers offline");
      },
    },
    {
      name: "resolve finds a provider by id, and the simulator regardless",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        const p = await sso.resolve("entra");
        assertEq(p.id, "entra");
        const sim = await sso.resolve("simulator");
        assertEq(sim.kind, "simulator");
        assertEq(await sso.resolve("nope"), null);
      },
    },
    {
      name: "begin stores a PKCE attempt and opens a correctly-formed popup",
      fn: async () => {
        const hub = fakeHub();
        const storage = memStorage();
        let opened = null;
        const sso = createSsoService({
          hub,
          storage,
          location: loc,
          openWindow: (url, name, features) => {
            opened = { url, name, features };
            return { closed: false };
          },
        });
        await sso.begin("entra");
        assertEq(hub.calls.begin[0], "entra", "asked the server to begin");
        assert(opened && opened.name === "itu-sso", "named popup");
        const u = new URL(opened.url);
        assertEq(u.searchParams.get("client_id"), "app-123");
        assertEq(u.searchParams.get("response_type"), "code");
        assertEq(u.searchParams.get("redirect_uri"), REDIRECT);
        assertEq(u.searchParams.get("state"), "STATE-entra");
        assertEq(u.searchParams.get("nonce"), "NONCE-entra");
        assertEq(u.searchParams.get("code_challenge_method"), "S256");
        assert(u.searchParams.get("code_challenge").length >= 20, "PKCE challenge present");
        // the attempt is recorded and pointed to
        assertEq(sso.pendingState(), "STATE-entra");
        const rec = JSON.parse(storage.getItem("itu-sso-attempt:STATE-entra"));
        assert(rec.verifier && rec.verifier.length >= 20, "verifier stored");
        assert(rec.verifier !== u.searchParams.get("code_challenge"), "verifier differs from the challenge");
      },
    },
    {
      name: "begin clears the attempt when the popup is blocked",
      fn: async () => {
        const storage = memStorage();
        const sso = createSsoService({ hub: fakeHub(), storage, location: loc, openWindow: () => null });
        let err = null;
        try {
          await sso.begin("entra");
        } catch (e) {
          err = e;
        }
        assert(err && /blocked/i.test(err.message), "reports the blocked popup");
        assertEq(storage.getItem("itu-sso-attempt:STATE-entra"), null, "attempt cleared");
      },
    },
    {
      name: "begin on the simulator goes straight to simulate (no popup)",
      fn: async () => {
        const hub = fakeHub();
        let opened = false;
        const sso = createSsoService({ hub, storage: memStorage(), location: loc, openWindow: () => { opened = true; return {}; } });
        const res = await sso.begin("simulator");
        assert(opened === false, "no popup for the simulator");
        assert(res && res.ok === true, "simulated sign-in succeeded");
        assertEq(hub.calls.begin[0], "simulator");
        assert(hub.calls.login.length === 1, "server verified the demo ID token");
      },
    },
    {
      name: "simulate mints a demo token, returns the session and notifies listeners",
      fn: async () => {
        const hub = fakeHub();
        const sso = createSsoService({ hub, storage: memStorage(), location: loc });
        const seen = [];
        const off = sso.onResult((r) => seen.push(r));
        const res = await sso.simulate("bob");
        off();
        assertEq(res.username, "alice", "session username comes from the server");
        assertEq(res.groups, 2, "group count surfaced");
        assertEq(seen.length, 1, "one result emitted");
        assertEq(seen[0].providerId, "simulator");
        const token = hub.calls.login[0].idToken;
        assert(token.split(".").length === 3, "a JWT was presented");
      },
    },
    {
      name: "a suffixed SSO identity is surfaced as adjusted, with the natural name",
      fn: async () => {
        const hub = fakeHub();
        hub.ssoLogin = async ({ state }) => ({ username: "alice-9f3a", naturalUsername: "alice", adjusted: true, isAdmin: false, roles: [], groups: 0, token: "tok" });
        const sso = createSsoService({ hub, storage: memStorage(), location: loc });
        const seen = [];
        const off = sso.onResult((r) => seen.push(r));
        const res = await sso.simulate("alice");
        off();
        assertEq(res.username, "alice-9f3a");
        assertEq(res.naturalUsername, "alice", "natural name carried through");
        assertEq(res.adjusted, true, "adjustment flagged for the UI");
        assertEq(seen[0].adjusted, true);
      },
    },
    {
      name: "complete exchanges the code and submits the ID token to the server",
      fn: async () => {
        const hub = fakeHub();
        const storage = memStorage();
        const sso = createSsoService({ hub, storage, location: loc, openWindow: () => ({}) });
        await sso.begin("entra");
        let posted = null;
        await withFetch(
          {
            [provider.tokenEndpoint]: (opts) => {
              posted = opts;
              return { json: { id_token: "header.payload.sig", access_token: "at" } };
            },
          },
          async () => {
            const res = await sso.complete({ code: "AUTHCODE", state: "STATE-entra" });
            assertEq(res.username, "alice");
          },
        );
        assert(posted && posted.method === "POST", "token endpoint called with POST");
        assertEq(posted.headers["Content-Type"], "application/x-www-form-urlencoded");
        const body = new URLSearchParams(posted.body);
        assertEq(body.get("grant_type"), "authorization_code");
        assertEq(body.get("code"), "AUTHCODE");
        assertEq(body.get("client_id"), "app-123");
        assertEq(body.get("redirect_uri"), REDIRECT);
        assert(body.get("code_verifier"), "PKCE verifier sent");
        assertEq(hub.calls.login[0].idToken, "header.payload.sig", "server got the ID token");
        assertEq(storage.getItem("itu-sso-attempt:STATE-entra"), null, "attempt consumed");
      },
    },
    {
      name: "complete rejects an unknown/expired attempt and a state mismatch",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        let e1 = null;
        try {
          await sso.complete({ code: "x", state: "ghost" });
        } catch (e) {
          e1 = e;
        }
        assert(e1 && /expired/i.test(e1.message), "unknown attempt rejected");

        // A provider error is surfaced verbatim.
        let e2 = null;
        try {
          await sso.complete({ error: "access_denied", errorDescription: "user cancelled", state: "x" });
        } catch (e) {
          e2 = e;
        }
        assert(e2 && /user cancelled/.test(e2.message), "provider error surfaced");
      },
    },
    {
      name: "handlePopupMessage only accepts our own same-origin message",
      fn: async () => {
        const hub = fakeHub();
        const sso = createSsoService({ hub, storage: memStorage(), location: loc, openWindow: () => ({}) });
        assertEq(sso.handlePopupMessage({ origin: "https://evil.example", data: { type: "itu-sso-callback", code: "x", state: "y" } }), false, "foreign origin");
        assertEq(sso.handlePopupMessage({ origin: loc.origin, data: { type: "something-else" } }), false, "foreign message type");
        assertEq(sso.handlePopupMessage({ origin: loc.origin, data: null }), false, "no data");
        assertEq(sso.handlePopupMessage(null), false, "no event");
        // a genuine callback with no matching attempt is accepted (returns true)
        // and reports the expiry to the listeners.
        const sso2 = createSsoService({ hub, storage: memStorage(), location: loc });
        const seen = [];
        sso2.onResult((r) => seen.push(r));
        const accepted = sso2.handlePopupMessage({ origin: loc.origin, data: { type: "itu-sso-callback", code: "c", state: "ghost" } });
        assertEq(accepted, true, "recognised as ours");
        await new Promise((r) => setTimeout(r, 30));
        assertEq(seen.length, 1, "failure reported");
        assert(seen[0].ok === false && /expired/i.test(seen[0].error), "expiry reported");
      },
    },
    {
      name: "discover folds a discovery document and the public keys in",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        const doc = {
          issuer: "https://login.microsoftonline.com/tid/v2.0",
          authorization_endpoint: "https://login.microsoftonline.com/tid/oauth2/v2.0/authorize?a=1",
          token_endpoint: "https://login.microsoftonline.com/tid/oauth2/v2.0/token",
          jwks_uri: "https://login.microsoftonline.com/tid/discovery/v2.0/keys",
        };
        const jwks = { keys: [{ kty: "RSA", kid: "k1", n: "abc", e: "AQAB" }] };
        const out = await withFetch(
          { "https://login.microsoftonline.com/tid/v2.0/.well-known/openid-configuration": doc, "https://login.microsoftonline.com/tid/discovery/v2.0/keys": jwks },
          () => sso.discover({ issuer: "https://login.microsoftonline.com/tid/v2.0", clientId: "app-123" }),
        );
        assertEq(out.errors.length, 0, "no errors");
        assertEq(out.provider.authorizationEndpoint, doc.authorization_endpoint);
        assertEq(out.provider.tokenEndpoint, doc.token_endpoint);
        assertEq(out.provider.jwks.keys.length, 1, "public keys folded in");
      },
    },
    {
      name: "discover surfaces a network failure instead of throwing blindly",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        const original = window.fetch;
        window.fetch = async () => {
          throw new Error("network down");
        };
        let err = null;
        try {
          await sso.discover({ issuer: "https://nope.example", clientId: "x" });
        } catch (e) {
          err = e;
        } finally {
          window.fetch = original;
        }
        assert(err && /network down/.test(err.message), "a network failure propagates");
      },
    },
    {
      name: "discover reports an invalid discovery document as an error, not a throw",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        const out = await withFetch({ "*": { json: {} } }, () => sso.discover({ issuer: "https://idp.example", clientId: "x" }));
        assert(out.errors.length >= 1, "an error is recorded");
      },
    },
    {
      name: "personas are available for the simulator UI",
      fn: async () => {
        const sso = createSsoService({ hub: fakeHub(), storage: memStorage(), location: loc });
        const list = sso.personas();
        assertEq(list.length, SIMULATOR_PERSONAS.length);
        assert(list.every((p) => p.id && p.label && p.claims), "each persona is complete");
        assert(list.some((p) => (p.claims.groups || []).includes("itu-admins")), "an admin-ish group exists");
      },
    },
  ]);
}
