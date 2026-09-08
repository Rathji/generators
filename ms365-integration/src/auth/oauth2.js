// src/auth/oauth2.js
// MS365 Integration — OAuth2 Authorization Code + PKCE flow
// against the Microsoft Identity Platform (v2.0 endpoints).
//
// The module is dependency-injectable (configure({ storage, fetchImpl, ... }))
// so its validation suite (oauth2.test.js) can run it with mocks.
// Production network calls go through super-fetch-plugin (token endpoint is
// not CORS-enabled), falling back to plain fetch when that is unavailable.

import { TokenStore } from "./token-store.js";

const DEFAULTS = Object.freeze({
  clientId: "",
  tenant: "common",
  scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
  authorizeUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  redirectUri: "",
  prompt: null,
  storage: null,
  fetchImpl: null,
  navigate: null,
  store: null,
  refreshMarginMs: 5 * 60 * 1000,
  autoRefresh: true,
  popupWidth: 600,
  popupHeight: 700,
  authTimeoutMs: 5 * 60 * 1000,
});

const PENDING_KEY = "ms365.oauth2.pending";
const STATE_PREFIX = "ms365";
const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read"];

let config = null;

// ── configuration ────────────────────────────────────────────────────────────
export function configure(partial = {}) {
  if (!partial || typeof partial !== "object") {
    throw new TypeError("ms365.oauth2.configure: expected an options object");
  }
  const next = Object.assign({}, DEFAULTS, partial);
  if (typeof next.clientId !== "string" || !next.clientId.trim()) {
    throw new Error("ms365.oauth2: `clientId` is required — register an app at https://aka.ms/aadappreg and paste its Application (client) ID.");
  }
  next.clientId = next.clientId.trim();
  next.scopes = normalizeScopes(next.scopes);
  if (!next.scopes.includes("offline_access")) next.scopes.push("offline_access");
  config = next;
  return getConfig();
}

export function getConfig() {
  return config ? { ...config, scopes: [...config.scopes] } : null;
}

export function requireConfig() {
  if (!config) {
    throw new Error("ms365.oauth2: not configured — call configure({ clientId, tenant, ... }) first.");
  }
  return config;
}

function normalizeScopes(scopes) {
  const list = [];
  const push = (s) => { s = String(s).trim(); if (s && !list.includes(s)) list.push(s); };
  if (Array.isArray(scopes)) scopes.forEach(push);
  else if (typeof scopes === "string") scopes.split(/[\s,]+/).forEach(push);
  return list.length ? list : [...DEFAULT_SCOPES];
}

// ── storage helpers (injectable for tests) ──────────────────────────────────
function getStorage() {
  if (config && config.storage) return config.storage();
  if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  return null;
}
function persistPending(p) {
  try { getStorage().setItem(PENDING_KEY, JSON.stringify(p)); } catch (e) {}
}
function readPending() {
  try {
    const raw = getStorage().getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearPending() {
  try { getStorage().removeItem(PENDING_KEY); } catch (e) {}
}

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────────
const PKCE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

export function generateCodeVerifier(length = 64) {
  const n = Math.max(43, Math.min(128, length));
  const bytes = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < n; i++) out += PKCE_CHARS[bytes[i] % PKCE_CHARS.length];
  return out;
}

export async function computeCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateState() {
  return STATE_PREFIX + "_" + generateCodeVerifier(32);
}

function base64UrlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── URL building ────────────────────────────────────────────────────────────
function endpoint(url) {
  const c = requireConfig();
  return String(url).replace("{tenant}", encodeURIComponent(c.tenant));
}

function resolveRedirectUri(explicit) {
  const c = requireConfig();
  if (explicit) return explicit;
  if (typeof c.redirectUri === "function") return c.redirectUri();
  if (c.redirectUri) return c.redirectUri;
  if (typeof window !== "undefined" && window.location && window.location.pathname) {
    return window.location.origin + window.location.pathname;
  }
  return "";
}

export async function buildAuthorizeUrl(overrides = {}) {
  const c = requireConfig();
  const verifier = overrides.codeVerifier || generateCodeVerifier();
  const state = overrides.state || generateState();
  const challenge = await computeCodeChallenge(verifier);
  const redirectUri = resolveRedirectUri(overrides.redirectUri);
  const params = {
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: (overrides.extraScopes && overrides.extraScopes.length ? [...c.scopes, ...overrides.extraScopes] : c.scopes).join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  };
  if (overrides.prompt || c.prompt) params.prompt = overrides.prompt || c.prompt;
  return {
    url: endpoint(c.authorizeUrl) + "?" + new URLSearchParams(params).toString(),
    verifier,
    state,
    challenge,
    redirectUri,
  };
}

export async function prepareAuth(overrides = {}) {
  const built = await buildAuthorizeUrl(overrides);
  persistPending({ state: built.state, verifier: built.verifier, redirectUri: built.redirectUri, createdAt: Date.now() });
  return built;
}

// ── token exchange ──────────────────────────────────────────────────────────
export async function exchangeCodeForTokens(code, verifier, opts = {}) {
  const c = requireConfig();
  const pending = readPending() || {};
  const redirectUri = opts.redirectUri || pending.redirectUri || resolveRedirectUri();
  const body = new URLSearchParams({
    client_id: c.clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  const fetchImpl = opts.fetchImpl || resolveFetch();
  let res;
  try {
    res = await fetchImpl(endpoint(c.tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error("ms365.oauth2: token request failed at the network level: " + err.message);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("ms365.oauth2: token endpoint returned a non-JSON response (HTTP " + (res && res.status) + ").");
  }
  if (!res.ok || data.error || !data.access_token) {
    throw mapTokenError(data, res && res.status);
  }
  clearPending();
  return normalizeTokens(data);
}

export function resolveFetch() {
  const c = requireConfig();
  if (c.fetchImpl) return c.fetchImpl;
  const bridge = typeof window !== "undefined" ? window.__m365 : null;
  if (bridge && bridge.superFetch) return bridge.superFetch;
  if (typeof fetch === "function") return fetch;
  throw new Error("ms365.oauth2: no fetch available — import super-fetch-plugin in main.pjs or pass fetchImpl.");
}

function normalizeTokens(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    idToken: data.id_token || null,
    tokenType: data.token_type || "Bearer",
    scope: data.scope ? data.scope.split(/[\s,]+/).filter(Boolean) : [],
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    raw: data,
  };
}

// ── session store & lifecycle ──────────────────────────────────────────────
let defaultStore = null;
function getStore() {
  if (config && config.store) return config.store;
  if (!defaultStore) defaultStore = new TokenStore();
  return defaultStore;
}

export function saveSession(session) {
  const stored = { tokens: session.tokens, profile: session.profile || null, savedAt: Date.now() };
  getStore().save(stored);
  return stored;
}
export function loadSession() { return getStore().load(); }
export function clearSession() { getStore().clear(); }

function commitSession(tokens, profile) {
  const session = saveSession({ tokens, profile });
  scheduleAutoRefresh(session);
  emitSessionChange(session);
  return session;
}

const listeners = { change: [], expired: [] };
export function onSessionChange(fn) {
  listeners.change.push(fn);
  return () => { const i = listeners.change.indexOf(fn); if (i >= 0) listeners.change.splice(i, 1); };
}
export function onSessionExpired(fn) {
  listeners.expired.push(fn);
  return () => { const i = listeners.expired.indexOf(fn); if (i >= 0) listeners.expired.splice(i, 1); };
}
function emitSessionChange(session) { listeners.change.forEach((fn) => { try { fn(session); } catch (e) {} }); }
function emitSessionExpired(err) { listeners.expired.forEach((fn) => { try { fn(err); } catch (e) {} }); }

// ── token refresh ──────────────────────────────────────────────────────────
export async function refreshTokens(refreshToken, opts = {}) {
  const c = requireConfig();
  const body = new URLSearchParams({
    client_id: c.clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    redirect_uri: opts.redirectUri || resolveRedirectUri(),
    scope: c.scopes.join(" "),
  });
  const fetchImpl = opts.fetchImpl || resolveFetch();
  let res;
  try {
    res = await fetchImpl(endpoint(c.tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (err) {
    throw new Error("ms365.oauth2: token refresh failed at the network level: " + err.message);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("ms365.oauth2: token endpoint returned a non-JSON response (HTTP " + (res && res.status) + ").");
  }
  if (!res.ok || data.error || !data.access_token) {
    throw mapTokenError(data, res && res.status);
  }
  return normalizeTokens(data);
}

function refreshMargin() {
  const c = requireConfig();
  const s = loadSession();
  if (!s || !s.tokens || !s.savedAt) return c.refreshMarginMs;
  const lifetime = s.tokens.expiresAt - s.savedAt;
  if (!(lifetime > 0)) return c.refreshMarginMs;
  return Math.min(c.refreshMarginMs, lifetime * 0.2);
}

let refreshInFlight = null;

export async function getValidToken(opts = {}) {
  const session = loadSession();
  if (!session || !session.tokens || !session.tokens.accessToken) return null;
  const t = session.tokens;
  if (!opts.force && t.expiresAt - refreshMargin() > Date.now()) {
    return t.accessToken;
  }
  if (refreshInFlight) return refreshInFlight;
  const promise = (async () => {
    try {
      if (!t.refreshToken) {
        clearSession();
        const err = new Error("ms365.oauth2: access token expired and no refresh token is available — sign in again.");
        err.code = "no_refresh_token";
        emitSessionExpired(err);
        return null;
      }
      const newTokens = await refreshTokens(t.refreshToken, opts);
      const next = commitSession(newTokens, session.profile);
      return next.tokens.accessToken;
    } catch (err) {
      if (err && (err.code === "invalid_grant" || err.code === "interaction_required" || err.code === "consent_required" || err.code === "login_required")) {
        clearSession();
        emitSessionExpired(err);
        return null;
      }
      throw err;
    }
  })();
  promise.then(
    () => { if (refreshInFlight === promise) refreshInFlight = null; },
    () => { if (refreshInFlight === promise) refreshInFlight = null; }
  );
  refreshInFlight = promise;
  return promise;
}

export async function refreshSession(opts = {}) {
  return getValidToken({ force: true, ...opts });
}

let autoTimer = null;
export function scheduleAutoRefresh(session, opts = {}) {
  stopAutoRefresh();
  const c = requireConfig();
  if (!c.autoRefresh) return null;
  const s = session || loadSession();
  if (!s || !s.tokens || !s.tokens.expiresAt) return null;
  let delay = s.tokens.expiresAt - refreshMargin() - Date.now();
  if (delay < 5000) delay = 5000;
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    try {
      await getValidToken();
    } catch (e) {
      scheduleAutoRefresh();
    }
  }, delay);
  return delay;
}
export function stopAutoRefresh() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
}

// ── error mapping ───────────────────────────────────────────────────────────
const AUTH_ERROR_MESSAGES = {
  access_denied: "Sign-in was declined — retry when you are ready.",
  invalid_scope: "One or more requested permission scopes are not supported or not consented.",
  login_required: "Microsoft requires an interactive sign-in for this request.",
  consent_required: "Consent for this application's permissions is required.",
  interaction_required: "The request needs your interaction with Microsoft.",
  temporarily_unavailable: "Microsoft sign-in is temporarily unavailable — please retry.",
  invalid_grant: "The authorization code is invalid or has expired — please sign in again.",
  invalid_client: "The application (client) ID or its configuration is invalid — check the Azure app registration.",
  unauthorized_client: "This application is not authorized for the requested scope.",
  unsupported_grant_type: "The token grant type is not supported by Microsoft.",
  server_error: "Microsoft reported a server error — please retry shortly.",
};

export function buildAuthError(code, description) {
  const friendly = AUTH_ERROR_MESSAGES[code] || "Microsoft authentication failed.";
  const err = new Error(friendly);
  err.code = code;
  err.original = description || "";
  err.isMs365Error = true;
  return err;
}

export function mapTokenError(data, status) {
  const err = buildAuthError((data && data.error) || "http_" + status, (data && data.error_description) || "");
  err.httpStatus = status;
  return err;
}

// ── id_token / profile ──────────────────────────────────────────────────────
export function decodeJwtPayload(token) {
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) { return null; }
}

export function profileFromIdToken(idToken) {
  const p = decodeJwtPayload(idToken);
  if (!p) return null;
  return {
    name: p.name || p.preferred_username || p.email || null,
    preferredUsername: p.preferred_username || null,
    email: p.email || p.preferred_username || null,
    sub: p.sub || null,
    oid: p.oid || null,
    tenantId: p.tid || null,
    raw: p,
  };
}

// ── interactive flow ────────────────────────────────────────────────────────
function defaultNavigate(url) {
  if (typeof window !== "undefined" && window.location) window.location.assign(url);
}

export async function launchAuthFlow(opts = {}) {
  const built = await prepareAuth(opts);
  const popup = openPopup(built.url);
  if (popup) {
    return registerPopupAuth(built.state, built.verifier, built.redirectUri, popup);
  }
  const navigate = requireConfig().navigate || defaultNavigate;
  navigate(built.url);
  return null;
}

function openPopup(url) {
  const c = requireConfig();
  try {
    const w = Math.min(c.popupWidth, 900);
    const h = Math.min(c.popupHeight, 800);
    const left = Math.max(0, Math.round((window.screen.width - w) / 2));
    const top = Math.max(0, Math.round((window.screen.height - h) / 2));
    return window.open(url, "ms365-auth", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top + ",resizable=yes,scrollbars=yes");
  } catch (e) { return null; }
}

export function registerPopupAuth(state, verifier, redirectUri, popup) {
  const c = requireConfig();
  return new Promise((resolve, reject) => {
    const entry = { settled: false, timer: null };
    entry.timer = setTimeout(() => {
      entry.settled = true;
      cleanup();
      reject(new Error("ms365.oauth2: sign-in timed out."));
    }, c.authTimeoutMs);

    function cleanup() {
      clearTimeout(entry.timer);
      window.removeEventListener("message", onMessage);
    }
    function onMessage(ev) {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data;
      if (!d || d.type !== "ms365-auth" || d.state !== state) return;
      entry.settled = true;
      if (d.error) {
        cleanup();
        reject(buildAuthError(d.error, d.errorDescription));
        return;
      }
      exchangeCodeForTokens(d.code, verifier, { redirectUri })
        .then((tokens) => {
          cleanup();
          const profile = profileFromIdToken(tokens.idToken);
          commitSession(tokens, profile);
          resolve({ tokens, profile });
        })
        .catch((err) => { cleanup(); reject(err); });
    }
    window.addEventListener("message", onMessage);
    if (popup) watchPopupClose(popup, entry, () => {
      entry.settled = true;
      cleanup();
      reject(new Error("ms365.oauth2: sign-in window was closed before completing."));
    });
  });
}

function watchPopupClose(popup, entry, onClosed) {
  const poll = setInterval(() => {
    if (entry.settled) { clearInterval(poll); return; }
    if (popup.closed) {
      clearInterval(poll);
      setTimeout(() => { if (!entry.settled) onClosed(); }, 1200);
    }
  }, 500);
}

export async function handleCallback(opts = {}) {
  const params = opts.params || (typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null);
  if (!params) return null;
  const state = params.get("state");
  if (!state) return null;

  const pending = readPending();
  if (!pending || pending.state !== state) {
    if (state) clearPending();
    return { status: "error", error: new Error("ms365.oauth2: state mismatch — authentication was rejected (possible CSRF).") };
  }
  clearPending();

  const isPopup = typeof window !== "undefined" && !!window.opener;
  if (isPopup) {
    const msg = { type: "ms365-auth", state };
    if (params.get("code")) msg.code = params.get("code");
    else {
      msg.error = params.get("error") || "unknown_error";
      msg.errorDescription = params.get("error_description") || "";
    }
    try { window.opener.postMessage(msg, window.location.origin); } catch (e) {}
    try { window.close(); } catch (e) {}
    return { status: "forwarded", state };
  }

  if (params.get("error")) {
    const err = buildAuthError(params.get("error"), params.get("error_description"));
    return { status: "error", error: err };
  }
  const code = params.get("code");
  if (!code) {
    return { status: "error", error: new Error("ms365.oauth2: authorization response did not include a code.") };
  }
  try {
    const tokens = await exchangeCodeForTokens(code, pending.verifier, { redirectUri: pending.redirectUri });
    const profile = profileFromIdToken(tokens.idToken);
    commitSession(tokens, profile);
    return { status: "success", tokens, profile };
  } catch (error) {
    return { status: "error", error };
  }
}
