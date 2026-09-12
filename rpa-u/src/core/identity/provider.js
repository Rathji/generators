import { entraEndpoints, isEntraConfigured, normalizeIdentityConfig } from "./config.js";
import { roleLabel, roleIdOf } from "./rbac.js";

export const SIMULATOR_ACCOUNTS = [
  { id: "admin", name: "Avery Chen", username: "avery.chen@contoso.example", email: "avery.chen@contoso.example", jobTitle: "Head of IT", role: "administrator", tenantId: "contoso-demo" },
  { id: "manager", name: "Morgan Lee", username: "morgan.lee@contoso.example", email: "morgan.lee@contoso.example", jobTitle: "Integrations Lead", role: "integration_manager", tenantId: "contoso-demo" },
  { id: "operator", name: "Riley Okafor", username: "riley.okafor@contoso.example", email: "riley.okafor@contoso.example", jobTitle: "Automation Engineer", role: "operator", tenantId: "contoso-demo" },
  { id: "auditor", name: "Sam Rivera", username: "sam.rivera@contoso.example", email: "sam.rivera@contoso.example", jobTitle: "Compliance Auditor", role: "auditor", tenantId: "contoso-demo" },
  { id: "viewer", name: "Kai Nakamura", username: "kai.nakamura@contoso.example", email: "kai.nakamura@contoso.example", jobTitle: "Service Desk", role: "viewer", tenantId: "contoso-demo" },
  { id: "foreign", name: "Jordan Bell", username: "jordan.bell@fabrikam.example", email: "jordan.bell@fabrikam.example", jobTitle: "External Contractor", role: "administrator", tenantId: "fabrikam-demo" },
];

function bytesToBase64Url(bytes) {
  let binary = "";
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(cryptoRef, length) {
  const out = new Uint8Array(length);
  if (cryptoRef && cryptoRef.getRandomValues) cryptoRef.getRandomValues(out);
  else for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function randomToken(cryptoRef, length = 32) {
  return bytesToBase64Url(randomBytes(cryptoRef, length));
}

export async function createPkcePair(cryptoRef = globalThis.crypto) {
  const verifier = randomToken(cryptoRef, 48);
  let challenge = verifier;
  if (cryptoRef && cryptoRef.subtle && typeof cryptoRef.subtle.digest === "function") {
    const digest = await cryptoRef.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    challenge = bytesToBase64Url(new Uint8Array(digest));
  }
  return { verifier, challenge, method: "S256" };
}

export function defaultRedirectUri(windowRef = globalThis.window) {
  if (!windowRef || !windowRef.location) return "";
  const { origin, pathname } = windowRef.location;
  return `${origin}${pathname}`;
}

export function buildAuthorizeUrl({ config, endpoints, clientId, redirectUri, scopes, codeChallenge, state, nonce, prompt, loginHint, responseMode = "query" } = {}) {
  const base = (endpoints && endpoints.authorize) || entraEndpoints(config).authorize;
  const url = new URL(base);
  url.searchParams.set("client_id", clientId || (config && config.clientId) || "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri || defaultRedirectUri());
  url.searchParams.set("response_mode", responseMode);
  url.searchParams.set("scope", (scopes || (config && config.scopes) || []).join(" "));
  url.searchParams.set("state", state || "");
  url.searchParams.set("nonce", nonce || "");
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (prompt) url.searchParams.set("prompt", prompt);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export function parseRedirect(input) {
  let url;
  try {
    url = new URL(String(input || ""), typeof window !== "undefined" ? window.location.href : "https://example.invalid/");
  } catch (error) {
    return { ok: false, error: "The sign-in response is not a valid URL." };
  }
  const params = new URLSearchParams(url.search);
  const hash = String(url.hash || "").replace(/^#/, "");
  if (hash && hash.includes("=") && !hash.startsWith("/")) {
    for (const [key, value] of new URLSearchParams(hash)) if (!params.has(key)) params.set(key, value);
  }
  const error = params.get("error");
  return {
    ok: !error,
    code: params.get("code"),
    state: params.get("state"),
    error,
    errorDescription: params.get("error_description"),
    params,
  };
}

export function normalizeTokenSet(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const expiresIn = Number(data.expires_in);
  const issuedAt = Date.now();
  return {
    accessToken: data.access_token || null,
    idToken: data.id_token || null,
    refreshToken: data.refresh_token || null,
    tokenType: data.token_type || "Bearer",
    scope: data.scope || "",
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
    expiresAt: Number.isFinite(expiresIn) ? issuedAt + expiresIn * 1000 : null,
    issuedAt,
  };
}

export function createEntraProvider({ config, fetchImpl, cryptoRef = globalThis.crypto, clock = () => Date.now(), windowRef = globalThis.window } = {}) {
  const cfg = normalizeIdentityConfig(config);

  function endpoints() {
    return entraEndpoints(cfg);
  }

  function configured() {
    return isEntraConfigured(cfg);
  }

  async function beginSignIn({ prompt = null, loginHint = null, redirectUri } = {}) {
    if (!configured()) return { ok: false, error: "Entra ID is not configured: set the tenant id and client id first." };
    const pkce = await createPkcePair(cryptoRef);
    const state = randomToken(cryptoRef, 24);
    const nonce = randomToken(cryptoRef, 24);
    const url = buildAuthorizeUrl({
      config: cfg,
      endpoints: endpoints(),
      redirectUri: redirectUri || cfg.redirectUri || defaultRedirectUri(windowRef),
      codeChallenge: pkce.challenge,
      state,
      nonce,
      prompt,
      loginHint,
    });
    return { ok: true, url, state, nonce, verifier: pkce.verifier, redirectUri: redirectUri || cfg.redirectUri || defaultRedirectUri(windowRef) };
  }

  async function exchangeCode({ code, verifier, redirectUri } = {}) {
    const body = new URLSearchParams();
    body.set("client_id", cfg.clientId);
    body.set("grant_type", "authorization_code");
    body.set("code", code || "");
    body.set("redirect_uri", redirectUri || cfg.redirectUri || defaultRedirectUri(windowRef));
    body.set("code_verifier", verifier || "");
    body.set("scope", cfg.scopes.join(" "));
    return post(endpoints().token, body);
  }

  async function refresh({ refreshToken } = {}) {
    if (!refreshToken) return { ok: false, error: "No refresh token is available." };
    const body = new URLSearchParams();
    body.set("client_id", cfg.clientId);
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("scope", cfg.scopes.join(" "));
    return post(endpoints().token, body);
  }

  async function post(url, body) {
    const started = clock();
    try {
      const response = await (fetchImpl || fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      const latencyMs = clock() - started;
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (error) {}
      if (!response.ok) {
        return { ok: false, status: response.status, latencyMs, error: (json && (json.error_description || json.error)) || `Token endpoint responded with HTTP ${response.status}.` };
      }
      if (!json || !json.access_token) return { ok: false, status: response.status, latencyMs, error: "The token endpoint response carried no access token." };
      return { ok: true, status: response.status, latencyMs, tokens: normalizeTokenSet(json) };
    } catch (error) {
      return { ok: false, latencyMs: clock() - started, error: error && error.message ? error.message : "The token endpoint could not be reached." };
    }
  }

  async function probe() {
    const started = clock();
    if (!configured()) return { ok: false, status: "unconfigured", latencyMs: 0, error: "Entra ID is not configured." };
    try {
      const response = await (fetchImpl || fetch)(endpoints().metadata, { headers: { accept: "application/json" } });
      const latencyMs = clock() - started;
      if (!response.ok) return { ok: false, status: "degraded", latencyMs, error: `Discovery document responded with HTTP ${response.status}.` };
      const json = await response.json();
      return { ok: true, status: "connected", latencyMs, endpoints: { issuer: json.issuer || null, authorization_endpoint: json.authorization_endpoint || null, token_endpoint: json.token_endpoint || null } };
    } catch (error) {
      return { ok: false, status: "offline", latencyMs: clock() - started, error: error && error.message ? error.message : "The identity provider could not be reached." };
    }
  }

  return {
    id: "entra",
    kind: "oidc",
    label: "Microsoft Entra ID",
    configured,
    endpoints,
    beginSignIn,
    exchangeCode,
    refresh,
    probe,
    buildSilentUrl({ redirectUri, loginHint } = {}) {
      return buildAuthorizeUrl({
        config: cfg,
        endpoints: endpoints(),
        redirectUri: redirectUri || cfg.redirectUri || defaultRedirectUri(windowRef),
        scopes: cfg.scopes.filter((scope) => scope !== "offline_access"),
        state: randomToken(cryptoRef, 16),
        nonce: randomToken(cryptoRef, 16),
        prompt: "none",
        loginHint,
      });
    },
    parseRedirect,
  };
}

function pascal(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function entraRoleNameFor(config, roleId) {
  const appRoles = (config && config.appRoles) || {};
  for (const [claim, role] of Object.entries(appRoles)) if (role === roleId) return claim;
  return `RPAU.${pascal(roleId)}`;
}

function unsignedJwt(header, payload) {
  const encode = (value) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(header)}.${encode(payload)}.`;
}

export function createSimulatorProvider({ config, clock = () => Date.now() } = {}) {
  const cfg = normalizeIdentityConfig(config);

  function accounts() {
    return SIMULATOR_ACCOUNTS.map((account) => ({ ...account, roleLabel: roleLabel(account.role) }));
  }

  function mint(accountId) {
    const account = SIMULATOR_ACCOUNTS.find((entry) => entry.id === accountId);
    if (!account) return { ok: false, error: `Unknown demo account “${accountId}”.` };
    const issuedAt = Math.floor(clock() / 1000);
    const payload = {
      iss: `https://login.microsoftonline.com/${account.tenantId}/v2.0`,
      aud: cfg.clientId || "rpa-u-demo",
      sub: `demo-${account.id}`,
      oid: `demo-${account.id}`,
      tid: account.tenantId,
      name: account.name,
      preferred_username: account.username,
      upn: account.username,
      email: account.email,
      jobTitle: account.jobTitle,
      roles: [entraRoleNameFor(cfg, account.role)],
      groups: [],
      ver: "2.0",
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + 3600,
    };
    const idToken = unsignedJwt({ alg: "none", typ: "JWT", kid: "simulator" }, payload);
    return {
      ok: true,
      tokens: { accessToken: idToken, idToken, refreshToken: `sim-refresh-${account.id}`, tokenType: "Bearer", expiresIn: 3600, expiresAt: clock() + 3600000, issuedAt: clock() },
      account: { id: account.id, name: account.name, username: account.username, role: account.role },
    };
  }

  return {
    id: "simulator",
    kind: "simulator",
    label: "Demo directory",
    configured: () => true,
    accounts,
    beginSignIn({ accountId } = {}) {
      return mint(accountId);
    },
    exchangeCode() {
      return { ok: false, error: "The demo directory does not use an authorization-code exchange." };
    },
    refresh({ refreshToken } = {}) {
      const accountId = String(refreshToken || "").replace(/^sim-refresh-/, "");
      const minted = mint(accountId);
      if (!minted.ok) return { ok: false, error: "The demo refresh token is not recognised." };
      return { ok: true, tokens: minted.tokens };
    },
    probe() {
      return { ok: true, status: "connected", latencyMs: 0 };
    },
    buildSilentUrl() {
      return "";
    },
    parseRedirect,
  };
}

export function createProviderRegistry({ config, fetchImpl, cryptoRef, clock, windowRef } = {}) {
  const cfg = normalizeIdentityConfig(config);
  const entra = createEntraProvider({ config: cfg, fetchImpl, cryptoRef, clock, windowRef });
  const simulator = createSimulatorProvider({ config: cfg, clock });
  const wanted = cfg.provider;
  const primary = wanted === "simulator" ? simulator : entra;
  const list = [];
  if (wanted === "entra") list.push(entra);
  if (cfg.showSimulator) list.push(simulator);
  return {
    config: cfg,
    entra,
    simulator,
    primary,
    list,
    get(id) {
      if (id === "simulator") return simulator;
      if (id === "entra") return entra;
      return null;
    },
  };
}

export function createIdentityProvider({ config, fetchImpl, cryptoRef, clock, windowRef, preferredId } = {}) {
  const registry = createProviderRegistry({ config, fetchImpl, cryptoRef, clock, windowRef });
  if (preferredId && registry.get(preferredId)) return registry.get(preferredId);
  return registry.primary;
}
