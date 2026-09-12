// src/framework/sso.js — the identity-provider sign-in service (roadmap task 58).
//
// Task 58 lets people sign in to IT-U with the directory their organisation
// already runs (Microsoft Entra ID, Okta, Auth0, any OIDC issuer) instead of a
// separate IT-U password. This module is the CLIENT half of that flow; the
// server half — verifying the ID token against the provider's public signing
// keys and turning directory groups into scoped IT-U roles — lives in the
// server script in index.html.
//
// WHY A POPUP AND PKCE:
//   IT-U is public source with no trusted backend of its own, so it is an OIDC
//   PUBLIC client: Authorization Code flow with PKCE (no client secret) and the
//   redirect handled in a popup window (src/sso-callback.html). The popup hands
//   the authorization `code` and `state` back with postMessage; this service
//   exchanges the code for tokens, then presents the ID token to the SERVER,
//   which is the only thing that decides who the user is and what they may do.
//
// THE ATTEMPT: `begin()` writes an attempt record (state, nonce, PKCE verifier,
// redirect URI and a snapshot of the provider) to localStorage — the popup is a
// separate window on the same origin, but it does not need to read it, because
// the MAIN window keeps the attempt and only needs the `code`+`state` back. The
// record is one-shot and expires after ten minutes.
//
// THE SIMULATOR: a built-in, fully offline demo provider (see framework/idp.js)
// lets the whole path be exercised without a tenant. Its token is signed with a
// key that ships in public source, so it is a DEMO — it grants no roles by
// itself (its rules are empty server-side), and the UI says so plainly.

import {
  DEFAULT_REDIRECT_PATH,
  SIMULATOR_ID,
  PROVIDER_PRESETS,
  providerFromPreset,
  simulatorProvider,
  discoveryUrlFor,
  applyDiscovery,
  normalizeJwks,
  jwksKeyCount,
  buildAuthorizeUrl,
  parseCallback,
  createPkce,
  mintSimulatorIdToken,
  rolesFromRules,
  extractIdentity,
  providerSummary,
  normalizeProviders,
  sanitizeProviders,
} from "./idp.js";

const ATTEMPT_PREFIX = "itu-sso-attempt:";
const POINTER_KEY = "itu-sso-current";
const ATTEMPT_TTL = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;

// A couple of canned directory people the simulator can sign in as. They carry
// group claims so the Settings rule editor (and the server's mapping) can be
// seen working — but the simulator provider ships with no rules, so a simulated
// session is a viewer until an administrator maps a group to a role.
export const SIMULATOR_PERSONAS = [
  {
    id: "alice",
    label: "Alice — engineer",
    claims: { preferred_username: "alice@contoso.example", name: "Alice Nguyen", email: "alice@contoso.example", groups: ["itu-technicians", "eng-team"] },
  },
  {
    id: "bob",
    label: "Bob — IT administrator",
    claims: { preferred_username: "bob@contoso.example", name: "Bob Feld", email: "bob@contoso.example", groups: ["itu-admins", "it-ops"] },
  },
  {
    id: "carol",
    label: "Carol — contractor (read-only)",
    claims: { preferred_username: "carol@partner.example", name: "Carol Diaz", email: "carol@partner.example", groups: ["contractors"] },
  },
];

function memStore() {
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

function pickStore(storage) {
  if (storage) return storage;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("itu-sso-probe", "1");
      localStorage.removeItem("itu-sso-probe");
      return localStorage;
    }
  } catch {}
  return memStore();
}

export function createSsoService({ hub, toast, storage, location: loc, openWindow } = {}) {
  const win = () => loc || (typeof location !== "undefined" ? location : { href: "https://example.invalid/" });
  const store = pickStore(storage);
  const open = openWindow || ((url, name, features) => (typeof window !== "undefined" ? window.open(url, name, features) : null));
  let cached = null;
  const resultListeners = new Set();

  // ---- attempt storage -------------------------------------------------------
  function now() {
    return Date.now();
  }
  function pruneAttempts() {
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(ATTEMPT_PREFIX)) keys.push(k);
    }
    const records = keys
      .map((k) => {
        try {
          return { k, rec: JSON.parse(store.getItem(k)) };
        } catch {
          return { k, rec: null };
        }
      })
      .filter((r) => r.rec);
    // Drop expired attempts, then the oldest beyond the cap.
    records.filter((r) => now() - (r.rec.createdAt || 0) > ATTEMPT_TTL).forEach((r) => store.removeItem(r.k));
    const live = records.filter((r) => now() - (r.rec.createdAt || 0) <= ATTEMPT_TTL).sort((a, b) => (a.rec.createdAt || 0) - (b.rec.createdAt || 0));
    while (live.length > MAX_ATTEMPTS) store.removeItem(live.shift().k);
  }
  function saveAttempt(rec) {
    pruneAttempts();
    try {
      store.setItem(ATTEMPT_PREFIX + rec.state, JSON.stringify(rec));
      store.setItem(POINTER_KEY, rec.state);
    } catch {}
  }
  function loadAttempt(state) {
    if (!state) return null;
    try {
      const rec = JSON.parse(store.getItem(ATTEMPT_PREFIX + state));
      if (!rec) return null;
      if (now() - (rec.createdAt || 0) > ATTEMPT_TTL) {
        clearAttempt(state);
        return null;
      }
      return rec;
    } catch {
      return null;
    }
  }
  function clearAttempt(state) {
    try {
      if (state) store.removeItem(ATTEMPT_PREFIX + state);
      // Only clear the pointer when it names this attempt.
      const ptr = store.getItem(POINTER_KEY);
      if (!state || ptr === state) store.removeItem(POINTER_KEY);
    } catch {}
  }
  function pendingState() {
    try {
      return store.getItem(POINTER_KEY) || "";
    } catch {
      return "";
    }
  }

  // ---- result channel --------------------------------------------------------
  function emitResult(result) {
    for (const cb of [...resultListeners]) {
      try {
        cb(result);
      } catch {}
    }
  }

  // ---- network helpers -------------------------------------------------------
  // fetch first; on a CORS/network failure fall back to the platform proxy
  // (super-fetch-plugin) when it is available. Used for discovery + token
  // exchange, so a provider whose endpoints are not CORS-enabled can still work.
  async function request(url, opts) {
    const sf = typeof window !== "undefined" && window.root && window.root.superFetch;
    try {
      const res = await fetch(url, opts);
      if (res && (res.ok || res.status < 500)) return res;
      throw new Error("HTTP " + (res ? res.status : "?"));
    } catch (e) {
      if (!sf) throw e;
      const res = await sf(url, opts);
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " from " + url);
      return res;
    }
  }
  async function getJson(url) {
    const res = await request(url, { headers: { accept: "application/json" } });
    return res.json();
  }
  async function postForm(url, params) {
    const body = new URLSearchParams(params).toString();
    const res = await request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
    return res.json();
  }

  // ---- service ---------------------------------------------------------------
  const service = {
    // Whether sign-in through a provider is possible at all this session.
    get available() {
      return !!(hub && hub.connected);
    },
    get online() {
      return !!(hub && hub.connected);
    },
    // The redirect URI that must be registered with the provider. Resolved the
    // same way index.html resolves its own relative `src/...` references.
    redirectUri() {
      try {
        return new URL(DEFAULT_REDIRECT_PATH, win().href).href;
      } catch {
        return DEFAULT_REDIRECT_PATH;
      }
    },
    // The providers the server offers. Cached until `force`.
    async loadConfig(force = false) {
      if (!force && cached) return cached;
      if (!hub || !hub.connected) {
        cached = { providers: [], simulator: null, canEdit: false, offline: true };
        return cached;
      }
      const cfg = await hub.ssoConfig();
      cached = cfg;
      return cfg;
    },
    providers() {
      return (cached && cached.providers) || [];
    },
    simulator() {
      return (cached && cached.simulator) || null;
    },
    canEdit() {
      return !!(cached && cached.canEdit);
    },
    invalidate() {
      cached = null;
    },
    // Resolve a provider (id or object) to one suitable for the authorize URL.
    async resolve(providerId) {
      const cfg = await service.loadConfig();
      if (providerId === SIMULATOR_ID) return cfg.simulator || simulatorProvider();
      if (providerId && typeof providerId === "object") return providerId;
      return (cfg.providers || []).find((p) => p.id === providerId) || null;
    },
    // Start a real OIDC sign-in in a popup. Returns the popup window (or null if
    // the browser blocked it).
    async begin(providerId, { loginHint = "" } = {}) {
      if (!hub || !hub.connected) throw new Error("Sign-in needs the realtime hub — it is offline right now.");
      const provider = await service.resolve(providerId);
      if (!provider) throw new Error("That identity provider is not configured.");
      if (provider.kind === "simulator") return service.simulate();
      const redirectUri = service.redirectUri();
      const pkce = await createPkce();
      const { state, nonce } = await hub.ssoBegin(provider.id);
      const url = buildAuthorizeUrl(provider, {
        state,
        nonce,
        redirectUri,
        codeChallenge: pkce.challenge,
        codeChallengeMethod: pkce.method,
        loginHint: loginHint || undefined,
      });
      saveAttempt({
        providerId: provider.id,
        state,
        nonce,
        verifier: pkce.verifier,
        redirectUri,
        provider: { id: provider.id, name: provider.name, kind: provider.kind },
        createdAt: now(),
      });
      const popup = open(url, "itu-sso", "popup=yes,width=520,height=680,menubar=no,toolbar=no,location=yes,status=no");
      if (!popup) {
        clearAttempt(state);
        throw new Error("Your browser blocked the sign-in window — allow pop-ups for this site and try again.");
      }
      return popup;
    },
    // Sign in through the built-in simulator (no network, no popup). Exercises
    // the real server verification path with a demo-signed ID token.
    async simulate(personaId = "alice") {
      if (!hub || !hub.connected) throw new Error("Sign-in needs the realtime hub — it is offline right now.");
      const persona = SIMULATOR_PERSONAS.find((p) => p.id === personaId) || SIMULATOR_PERSONAS[0];
      const { state, nonce } = await hub.ssoBegin(SIMULATOR_ID);
      const idToken = await mintSimulatorIdToken({ nonce, claims: persona.claims });
      const res = await hub.ssoLogin({ idToken, state });
      const result = { ok: true, providerId: SIMULATOR_ID, providerName: "IT-U simulator (demo)", username: res.username, naturalUsername: res.naturalUsername || res.username, adjusted: !!res.adjusted, isAdmin: !!res.isAdmin, roles: res.roles || [], groups: res.groups || 0 };
      emitResult(result);
      return result;
    },
    // Complete a real sign-in from the popup's postMessage payload. Exchanges
    // the code for tokens, then hands the ID token to the server to verify.
    async complete({ code, state, error, errorDescription }) {
      const attempt = loadAttempt(state);
      if (error) {
        clearAttempt(state);
        throw new Error(errorDescription || error);
      }
      if (!attempt) throw new Error("This sign-in attempt has expired — please start again.");
      if (state !== attempt.state) throw new Error("The sign-in response did not match this attempt.");
      const provider = await service.resolve(attempt.providerId);
      if (!provider || !provider.tokenEndpoint) throw new Error("The provider has no token endpoint — run Discover in Settings.");
      let tokens;
      try {
        tokens = await postForm(provider.tokenEndpoint, {
          grant_type: "authorization_code",
          code,
          redirect_uri: attempt.redirectUri,
          client_id: provider.clientId,
          code_verifier: attempt.verifier,
        });
      } catch (e) {
        clearAttempt(state);
        throw new Error("Couldn’t exchange the authorization code: " + String((e && e.message) || e));
      }
      if (!tokens || !tokens.id_token) {
        clearAttempt(state);
        throw new Error("The provider did not return an ID token.");
      }
      const res = await hub.ssoLogin({ idToken: tokens.id_token, state: attempt.state });
      clearAttempt(state);
      const result = { ok: true, providerId: attempt.providerId, providerName: (attempt.provider && attempt.provider.name) || attempt.providerId, username: res.username, naturalUsername: res.naturalUsername || res.username, adjusted: !!res.adjusted, isAdmin: !!res.isAdmin, roles: res.roles || [], groups: res.groups || 0 };
      emitResult(result);
      return result;
    },
    // Handle a message from src/sso-callback.html. Returns true when the message
    // was ours (so a caller can ignore unrelated messages).
    handlePopupMessage(evt) {
      if (!evt || !evt.data) return false;
      if (String(evt.origin || "") !== win().origin) return false;
      const d = evt.data;
      if (!d || d.type !== "itu-sso-callback") return false;
      service
        .complete({ code: d.code, state: d.state, error: d.error, errorDescription: d.errorDescription })
        .then(() => {})
        .catch((e) => {
          const msg = String((e && e.message) || e);
          toast && toast(msg, "error", 7000);
          emitResult({ ok: false, error: msg });
        });
      return true;
    },
    onResult(cb) {
      resultListeners.add(cb);
      return () => resultListeners.delete(cb);
    },
    personas() {
      return SIMULATOR_PERSONAS;
    },
    pendingState,
    clearPending() {
      clearAttempt(pendingState());
    },
    // ---- discovery (Settings only) ------------------------------------------
    // Fetch a provider's discovery document and public signing keys. Pure
    // folding is done by idp.js; this only does the network part.
    async discover(provider) {
      const url = provider.discoveryUrl || discoveryUrlFor(provider.issuer);
      if (!url) throw new Error("Enter an issuer URL first.");
      const doc = await getJson(url);
      const fused = applyDiscovery(provider, doc);
      if (fused.provider.jwksUri) {
        try {
          const raw = await getJson(fused.provider.jwksUri);
          fused.provider.jwks = normalizeJwks(raw);
          if (!jwksKeyCount(fused.provider)) fused.errors.push("The provider’s key set published no usable RSA signing keys.");
        } catch (e) {
          fused.errors.push("Couldn’t fetch the signing keys: " + String((e && e.message) || e));
        }
      }
      return fused;
    },
    // Fetch just the public keys for a provider that already has a jwks_uri.
    async refreshKeys(provider) {
      if (!provider || !provider.jwksUri) throw new Error("Run Discover first — no key-set URL is known.");
      const raw = await getJson(provider.jwksUri);
      return normalizeJwks(raw);
    },
  };

  return service;
}

// Small pure re-exports so the Settings editor can build providers from presets
// without reaching into idp.js directly (and so tests have one import surface).
export { PROVIDER_PRESETS, providerFromPreset, providerSummary, normalizeProviders, sanitizeProviders, rolesFromRules, extractIdentity, parseCallback };
