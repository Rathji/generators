// src/framework/idp.js — the identity-provider (SSO) model (roadmap task 58).
//
// TASK 58 — single sign-on against an external identity provider (Entra ID,
// Okta, Auth0, any OIDC issuer) so IT-U identities and roles can be driven by
// the directory a provider already runs, instead of a separate IT-U password.
//
// WHAT THIS FILE IS: the pure, network-free half of the integration. It knows
// the shape of a provider configuration, where an issuer's discovery document
// lives, how to build an OIDC Authorization-Code + PKCE request, how to read a
// token response and an ID token, how to pull an identity and its groups out of
// the claims, and how to turn directory groups into IT-U scoped roles. Nothing
// here touches the DOM, the browser location or the network, so every rule can
// be exercised in isolation (see src/tests/idp.test.js).
//
// WHY PKCE AND NOTHING SECRET: an IT-U generator is public source and has no
// trusted backend of its own. A browser-only client must therefore be an OIDC
// PUBLIC client: Authorization Code flow with PKCE (RFC 7636) and no client
// secret. The token endpoint is called directly from the browser, which is safe
// because a stolen authorization code is useless without the per-attempt
// verifier. The server script never holds a secret; it verifies the ID token
// against the provider's PUBLIC signing keys (JWKS), which is why those keys —
// and only those keys — are stored server-side (see index.html and
// src/framework/sso.js).
//
// THE FLOW (all of it lives across sso.js + src/sso-callback.js):
//   1. begin()        builds the authorize URL (state + nonce + PKCE challenge)
//                     and opens the provider in a popup.
//   2. the provider   authenticates the user and redirects the popup back to
//                     src/sso-callback.html with ?code&state.
//   3. callback       exchanges code+verifier for a token set and hands the ID
//                     token back to the app.
//   4. ssoLogin       the SERVER verifies the ID token (signature, iss, aud,
//                     exp, nonce), maps claims to roles, and opens a hub
//                     session. The client never gets to assert its own identity.
//
// Group → role mapping reuses the scoped role vocabulary in ./roles.js, so a
// directory group can grant technician at one client, or administrator across
// the repository, exactly like a hand-made grant.

import { ROLE_IDS, ROLE_LABELS, normalizeRoleId, isScope, GLOBAL_SCOPE } from "./roles.js";

export const IDP_SCHEMA = "itu-idp/1";
export const PROVIDER_KINDS = ["oidc", "simulator"];

// The scopes an OIDC sign-in needs by default: prove who you are, read the
// profile, read the e-mail/UPN.
export const DEFAULT_SCOPES = "openid profile email";
export const DEFAULT_REDIRECT_PATH = "src/sso-callback.html";

// The built-in simulator is a LOCAL, fully offline provider used to exercise the
// whole flow (and the server's token verification) without a real tenant. It is
// signed with HMAC-SHA256 and a key that ships in public source, so it is a demo
// and NEVER a security boundary — the UI says so plainly.
export const SIMULATOR_ID = "simulator";
export const SIMULATOR_ISSUER = "https://simulator.itu.local";
export const SIMULATOR_CLIENT_ID = "itu-simulator";
export const SIMULATOR_SECRET = "itu-simulator-demo-key-not-a-secret";

// ---- provider presets ------------------------------------------------------
// A preset seeds the "Add provider" editor with the defaults a given directory
// expects. They are deliberately data, not behaviour: the editor still lets the
// administrator override every field, and every preset goes through the same
// normalization + validation as a hand-written provider.

export const PROVIDER_PRESETS = [
  {
    id: "entra",
    name: "Microsoft Entra ID",
    kind: "oidc",
    issuerTemplate: "https://login.microsoftonline.com/{tenantId}/v2.0",
    issuerPlaceholder: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    scopes: "openid profile email",
    usernameClaim: "preferred_username",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "groups",
    notes:
      "Register an app in Entra ID as a Single-page application, add the redirect URI shown below, and (to receive group claims) set “groupMembershipClaims” to “SecurityGroup” and, if you have more than a handful of groups, enable “groups assigned to the application”. IT-U reads the object IDs (GUIDs) from the groups claim.",
  },
  {
    id: "entra-roles",
    name: "Microsoft Entra ID (app roles)",
    kind: "oidc",
    issuerTemplate: "https://login.microsoftonline.com/{tenantId}/v2.0",
    issuerPlaceholder: "https://login.microsoftonline.com/<tenant-id>/v2.0",
    scopes: "openid profile email",
    usernameClaim: "preferred_username",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "roles",
    notes:
      "The same app but mapping Entra “App roles” instead of security groups: the roles claim carries short names you define, which are easier to map than GUIDs. Assign users (or groups) to the app roles in Entra.",
  },
  {
    id: "okta",
    name: "Okta",
    kind: "oidc",
    issuerTemplate: "https://{yourOktaDomain}/oauth2/default",
    issuerPlaceholder: "https://example.okta.com/oauth2/default",
    scopes: "openid profile email groups",
    usernameClaim: "preferred_username",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "groups",
    notes: "Create an OIDC Single-Page Application; add the redirect URI below; include a groups claim if you want group-based roles.",
  },
  {
    id: "auth0",
    name: "Auth0",
    kind: "oidc",
    issuerTemplate: "https://{yourTenant}.{region}.auth0.com/",
    issuerPlaceholder: "https://example.eu.auth0.com/",
    scopes: "openid profile email",
    usernameClaim: "email",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "https://itu/roles",
    notes: "Register a Single Page Application; add the redirect URI below; add a custom namespaced roles claim with an Auth0 Action if you want group-based roles.",
  },
  {
    id: "google",
    name: "Google Workspace",
    kind: "oidc",
    issuerTemplate: "https://accounts.google.com",
    issuerPlaceholder: "https://accounts.google.com",
    scopes: "openid profile email",
    usernameClaim: "email",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "",
    notes: "Google issues ID tokens to a “Web application” client, which normally requires a client secret — so a browser-only IT-U may not be able to exchange the code. Prefer Entra ID, Okta or Auth0 for secret-free PKCE.",
  },
  {
    id: "generic",
    name: "Generic OIDC",
    kind: "oidc",
    issuerTemplate: "",
    issuerPlaceholder: "https://idp.example.com/realms/main",
    scopes: DEFAULT_SCOPES,
    usernameClaim: "preferred_username",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "groups",
    notes: "Any standards-compliant OIDC provider with a discovery document. IT-U discovers the endpoints and public keys from the issuer, then verifies ID tokens against them.",
  },
];

export function presetFor(id) {
  return PROVIDER_PRESETS.find((p) => p.id === id) || null;
}

// A new provider config seeded from a preset (used by the Settings editor).
export function providerFromPreset(presetId, { id = "", name = "" } = {}) {
  const preset = presetFor(presetId) || presetFor("generic");
  return normalizeProvider({
    id: id || preset.id,
    name: name || preset.name,
    kind: preset.kind || "oidc",
    issuer: "",
    scopes: preset.scopes || DEFAULT_SCOPES,
    usernameClaim: preset.usernameClaim || "preferred_username",
    nameClaim: preset.nameClaim || "name",
    emailClaim: preset.emailClaim || "email",
    groupsClaim: preset.groupsClaim || "groups",
    defaultRole: "viewer",
    rules: [],
  }).provider;
}

// The built-in simulator provider, shown when the app enables it.
export function simulatorProvider() {
  return normalizeProvider({
    id: SIMULATOR_ID,
    name: "IT-U simulator",
    kind: "simulator",
    issuer: SIMULATOR_ISSUER,
    clientId: SIMULATOR_CLIENT_ID,
    scopes: DEFAULT_SCOPES,
    usernameClaim: "preferred_username",
    nameClaim: "name",
    emailClaim: "email",
    groupsClaim: "groups",
    defaultRole: "viewer",
    rules: [],
    demo: true,
  }).provider;
}

// ---- small pure helpers ----------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,23}$/;

export function isProviderId(id) {
  return ID_RE.test(String(id == null ? "" : id));
}

export function providerSlug(name, existing = []) {
  let base = String(name || "provider").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!base) base = "provider";
  base = base.slice(0, 24);
  if (!existing.includes(base) && ID_RE.test(base)) return base;
  let n = 2;
  while (existing.includes(base + "-" + n)) n += 1;
  return (base + "-" + n).slice(0, 32);
}

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const v of list || []) {
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// A short, stable, non-reversible-enough token derived from a string (used to
// build a fallback username from an opaque subject). Not security-sensitive.
export function shortHash(str) {
  let h = 2166136261 >>> 0;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Fold a claim value or subject into a valid IT-U username (lowercase slug,
// 2–24 chars). Falls back to the e-mail local part, then to a hash of the
// subject, so a provider that returns only an opaque `sub` still gets an
// account. `uniquify` appends a short subject hash when the slug is taken.
export function normalizeUsername(raw, { subject = "", taken = null } = {}) {
  let s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s.includes("@")) s = s.split("@")[0];
  s = s.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").replace(/\.+/g, ".").slice(0, 24);
  if (!USERNAME_RE.test(s)) {
    const tail = shortHash(subject || raw);
    s = ("sso-" + tail).slice(0, 24);
  }
  if (taken && typeof taken === "function" && taken(s)) {
    const tail = shortHash(subject || raw || s);
    s = (s.slice(0, 18) + "-" + tail.slice(0, 4)).slice(0, 24);
  }
  return s;
}

// ---- claims ----------------------------------------------------------------

// Read a (possibly dotted) claim path. A leading underscore reads the claim
// literally even when it contains dots (`_https://itu/roles`).
export function claimValue(claims, path) {
  if (claims == null || !path) return undefined;
  const p = String(path);
  if (p.startsWith("_")) return claims[p.slice(1)];
  return p.split(".").reduce((o, k) => (o == null ? o : o[k]), claims);
}

export function claimString(claims, path) {
  const v = claimValue(claims, path);
  if (v == null) return "";
  if (Array.isArray(v)) return v.length ? String(v[0]) : "";
  return typeof v === "object" ? "" : String(v);
}

// A claim that may be an array, a space/comma-separated string, or a scalar.
export function claimList(claims, path) {
  const v = claimValue(claims, path);
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string") return v.split(/[\s,]+/).filter(Boolean);
  if (typeof v === "object") return [];
  return [String(v)];
}

// The directory identity behind an ID token, expressed in IT-U's terms.
export function extractIdentity(provider, claims) {
  const p = provider || {};
  const subject = claimString(claims, "sub") || claimString(claims, "oid") || claimString(claims, "objectId");
  const rawUser = p.usernameClaim ? claimString(claims, p.usernameClaim) : "";
  const username = normalizeUsername(rawUser || claimString(claims, "email"), { subject });
  const name = claimString(claims, p.nameClaim) || claimString(claims, "displayName") || username;
  const email = claimString(claims, p.emailClaim) || claimString(claims, "email");
  const groups = uniq([
    ...(p.groupsClaim ? claimList(claims, p.groupsClaim) : []),
    ...(p.groupsClaim && p.groupsClaim !== "roles" ? claimList(claims, "roles") : []),
  ]);
  return { username, name, email, groups, subject };
}

// Exact (case-insensitive) match, or a `*` glob (`*eng*`, `it-*`, `*-admin`).
export function groupMatches(pattern, value) {
  const p = String(pattern == null ? "" : pattern).trim();
  const v = String(value == null ? "" : value).trim();
  if (!p) return false;
  if (p === "*") return true;
  if (!p.includes("*")) return p.toLowerCase() === v.toLowerCase();
  const rx = new RegExp("^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return rx.test(v);
}

// ---- role mapping ----------------------------------------------------------

// Turn the groups a token carries into IT-U grants, using the provider's rules.
// A rule whose `match` is empty or `*` applies to everyone; otherwise it fires
// when any group matches. The optional `defaultRole` grants a base role at the
// repository scope (viewer is a no-op — everyone is a viewer by default).
export function rolesFromRules(provider, groups = []) {
  const p = provider || {};
  const out = [];
  const seen = new Set();
  const add = (role, scope) => {
    const r = normalizeRoleId(role);
    const sc = scope || GLOBAL_SCOPE;
    if (!r || !isScope(sc)) return;
    const key = r + "@" + sc;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ role: r, scope: sc });
  };
  for (const rule of Array.isArray(p.rules) ? p.rules : []) {
    if (!rule || !rule.role) continue;
    const match = rule.match == null ? "" : String(rule.match).trim();
    if (!match || match === "*" || (Array.isArray(groups) && groups.some((g) => groupMatches(match, g)))) {
      add(rule.role, rule.scope);
    }
  }
  if (p.defaultRole && normalizeRoleId(p.defaultRole) !== "viewer") add(p.defaultRole, GLOBAL_SCOPE);
  return out;
}

// A compact human summary of a rule, for the Settings list.
export function ruleSummary(rule) {
  const match = rule && rule.match ? rule.match : "everyone";
  const role = (rule && rule.role) || "viewer";
  const scope = rule && rule.scope ? rule.scope : GLOBAL_SCOPE;
  return `${match} → ${ROLE_LABELS[role] || role} at ${scope === GLOBAL_SCOPE ? "the whole repository" : scope}`;
}

// ---- provider configuration ------------------------------------------------

export function validateRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== "object") return { ok: false, errors: ["A rule must be an object."] };
  if (normalizeRoleId(rule.role) === null) errors.push(`“${rule.role}” is not one of the IT-U roles (viewer, technician, administrator).`);
  if (rule.scope != null && rule.scope !== "" && !isScope(rule.scope)) errors.push(`“${rule.scope}” is not a valid scope (use “*”, “client:<id>” or “service:<id>/<id>”).`);
  return { ok: errors.length === 0, errors };
}

// Coerce a raw provider into the canonical shape, dropping anything unknown.
// Always returns `{ provider, errors }` so a caller can validate without a
// second pass (an invalid provider still normalizes to something renderable).
export function normalizeProvider(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const kind = PROVIDER_KINDS.includes(src.kind) ? src.kind : "oidc";
  const id = String(src.id || "").trim().toLowerCase();
  const rules = [];
  for (const r of Array.isArray(src.rules) ? src.rules : []) {
    if (!r || typeof r !== "object") continue;
    const check = validateRule({ ...r, scope: r.scope == null || r.scope === "" ? GLOBAL_SCOPE : r.scope });
    rules.push({
      match: r.match == null ? "" : String(r.match).trim(),
      role: normalizeRoleId(r.role) || String(r.role || ""),
      scope: r.scope == null || r.scope === "" ? GLOBAL_SCOPE : String(r.scope),
      valid: check.ok,
    });
  }
  const provider = {
    id,
    name: String(src.name || "").trim(),
    kind,
    issuer: String(src.issuer || "").trim().replace(/\/+$/, ""),
    discoveryUrl: String(src.discoveryUrl || "").trim(),
    authorizationEndpoint: String(src.authorizationEndpoint || "").trim(),
    tokenEndpoint: String(src.tokenEndpoint || "").trim(),
    jwksUri: String(src.jwksUri || "").trim(),
    endSessionEndpoint: String(src.endSessionEndpoint || "").trim(),
    clientId: String(src.clientId || "").trim(),
    scopes: String(src.scopes || DEFAULT_SCOPES).trim() || DEFAULT_SCOPES,
    usernameClaim: String(src.usernameClaim || "preferred_username").trim(),
    nameClaim: String(src.nameClaim || "name").trim(),
    emailClaim: String(src.emailClaim || "email").trim(),
    groupsClaim: src.groupsClaim == null ? "groups" : String(src.groupsClaim).trim(),
    defaultRole: normalizeRoleId(src.defaultRole) || "viewer",
    rules,
    jwks: src.jwks && typeof src.jwks === "object" ? src.jwks : null,
    demo: !!src.demo || kind === "simulator",
  };
  const errors = validateProvider(provider).errors;
  return { provider, errors };
}

// Normalize a whole provider list, dropping duplicates and returning the
// non-fatal errors keyed by provider id (so an editor can mark one bad row).
export function normalizeProviders(rawList) {
  const list = [];
  const errorsById = {};
  const seen = new Set();
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    const { provider, errors } = normalizeProvider(raw);
    if (!provider.id || seen.has(provider.id)) continue;
    seen.add(provider.id);
    list.push(provider);
    if (errors.length) errorsById[provider.id] = errors;
  }
  return { providers: list, errorsById };
}

export function validateProvider(provider) {
  const errors = [];
  const p = provider || {};
  if (!isProviderId(p.id)) errors.push("The provider id must be a lowercase slug (letters, digits, . _ -).");
  if (!p.name) errors.push("Give the provider a name people will recognise on the sign-in screen.");
  if (!PROVIDER_KINDS.includes(p.kind)) errors.push("Unknown provider kind.");
  if (p.kind === "oidc") {
    if (!p.issuer) errors.push("An issuer URL is required.");
    else if (!/^https?:\/\//i.test(p.issuer)) errors.push("The issuer must be an http(s) URL.");
    if (!p.clientId) errors.push("A client (application) id is required.");
    if (!p.authorizationEndpoint && !discoveryUrlFor(p.issuer)) errors.push("No authorization endpoint and no discovery document could be derived from the issuer.");
  }
  for (const r of p.rules || []) {
    if (r.valid === false) errors.push(`Rule “${r.match || "everyone"}” is invalid (bad role or scope).`);
  }
  return { ok: errors.length === 0, errors };
}

// The discovery document URL for an issuer. If the issuer already points at a
// `.well-known/openid-configuration` it is returned unchanged.
export function discoveryUrlFor(issuer) {
  const s = String(issuer == null ? "" : issuer).trim().replace(/\/+$/, "");
  if (!s) return "";
  if (/\/\.well-known\/openid-configuration$/i.test(s)) return s;
  return s + "/.well-known/openid-configuration";
}

// True when the provider still needs its endpoints filled in from discovery.
export function needsDiscovery(provider) {
  const p = provider || {};
  if (p.kind !== "oidc") return false;
  return !p.authorizationEndpoint || !p.tokenEndpoint || !p.jwksUri;
}

// Fold a discovery document into a provider (pure). Endpoints come from the
// document; the issuer it advertises wins over the one typed in, so both ends
// agree on `iss` before any token is verified. Returns `{ provider, errors }`.
export function applyDiscovery(provider, doc) {
  const errors = [];
  const d = doc && typeof doc === "object" ? doc : null;
  if (!d || !d.authorization_endpoint || !d.token_endpoint) {
    return { provider: { ...(provider || {}) }, errors: ["That URL did not return a valid OIDC discovery document."] };
  }
  const next = { ...(provider || {}) };
  next.authorizationEndpoint = String(d.authorization_endpoint);
  next.tokenEndpoint = String(d.token_endpoint);
  next.jwksUri = String(d.jwks_uri || next.jwksUri || "");
  if (d.end_session_endpoint) next.endSessionEndpoint = String(d.end_session_endpoint);
  if (d.issuer) next.issuer = String(d.issuer).replace(/\/+$/, "");
  if (!next.jwksUri) errors.push("The discovery document did not include a jwks_uri, so ID tokens cannot be verified.");
  return { provider: next, errors };
}

// The signing keys an admin fetched for the provider (public — safe to store and
// show). Kept as a plain JWKS object so the server can verify against it.
export function normalizeJwks(raw) {
  const j = raw && typeof raw === "object" ? raw : {};
  const keys = Array.isArray(j.keys) ? j.keys.filter((k) => k && k.kty && (k.x5c || k.n)) : [];
  return { keys };
}

export function jwksKeyCount(provider) {
  return provider && provider.jwks && Array.isArray(provider.jwks.keys) ? provider.jwks.keys.length : 0;
}

// ---- OIDC request building -------------------------------------------------

// Build the authorization request URL. Requires an authorization endpoint and a
// client id; `state`, `nonce` and `codeChallenge` are produced per attempt.
export function buildAuthorizeUrl(provider, opts = {}) {
  const p = provider || {};
  const redirectUri = opts.redirectUri || "";
  const base = p.authorizationEndpoint;
  if (!base) throw new Error("This provider has no authorization endpoint — run Discover first.");
  if (!p.clientId) throw new Error("This provider has no client id.");
  if (!redirectUri) throw new Error("A redirect URI is required.");
  const params = {
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: opts.scope || p.scopes || DEFAULT_SCOPES,
    state: opts.state || "",
    nonce: opts.nonce || "",
    code_challenge: opts.codeChallenge || "",
    code_challenge_method: opts.codeChallengeMethod || "S256",
    response_mode: opts.responseMode || "query",
  };
  if (opts.loginHint) params.login_hint = opts.loginHint;
  if (opts.prompt) params.prompt = opts.prompt;
  const qs = Object.entries(params)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
  return base + (base.includes("?") ? "&" : "?") + qs;
}

// Read the OAuth response from a callback URL — from the query string or, when
// the provider used fragment mode, the hash. Returns `{ code, state, error,
// errorDescription }`; a caller checks `error` first.
export function parseCallback(url) {
  const out = { code: "", state: "", error: "", errorDescription: "" };
  const s = String(url == null ? "" : url);
  const qi = s.indexOf("?");
  const hi = s.indexOf("#");
  const parts = [];
  if (qi >= 0) parts.push(s.slice(qi + 1, hi > qi ? hi : undefined));
  if (hi >= 0) parts.push(s.slice(hi + 1));
  for (const section of parts) {
    for (const pair of section.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
      const v = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
      if (k === "code") out.code = v;
      else if (k === "state") out.state = v;
      else if (k === "error") out.error = v;
      else if (k === "error_description") out.errorDescription = v;
    }
  }
  return out;
}

// ---- token / JWT reading ---------------------------------------------------

export function base64UrlDecode(str) {
  let s = String(str == null ? "" : str).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  if (typeof atob === "function") {
    const bin = atob(s);
    if (typeof TextDecoder === "function") return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    let out = "";
    try {
      out = decodeURIComponent(escape(bin));
    } catch {
      out = bin;
    }
    return out;
  }
  return "";
}

export function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(String(str == null ? "" : str));
  return base64UrlFromBytes(bytes);
}

export function base64UrlFromBytes(bytes) {
  let bin = "";
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : "";
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Decode a JWT WITHOUT verifying it. Verification is the server's job — this is
// only for reading the claims to show (or to pick a key), never for trust.
export function decodeJwt(token) {
  const parts = String(token == null ? "" : token).split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (!header || !payload) return null;
    return { header, payload, signature: parts[2], signingInput: parts[0] + "." + parts[1] };
  } catch {
    return null;
  }
}

// Does the ID token's audience include our client id? (`aud` may be a string or
// an array, per the spec.)
export function audienceIncludes(aud, clientId) {
  if (Array.isArray(aud)) return aud.map(String).includes(String(clientId));
  return String(aud) === String(clientId);
}

// A short, safe label for an ID token, for the identity preview.
export function describeClaims(token) {
  const decoded = decodeJwt(token);
  if (!decoded) return null;
  const c = decoded.payload || {};
  return {
    issuer: c.iss || "",
    audience: c.aud || "",
    subject: c.sub || "",
    name: c.name || c.displayName || "",
    username: c.preferred_username || c.upn || c.email || c.unique_name || "",
    email: c.email || "",
    expires: c.exp || 0,
    algorithm: (decoded.header && decoded.header.alg) || "",
    keyId: (decoded.header && decoded.header.kid) || "",
  };
}

// ---- PKCE ------------------------------------------------------------------

export async function randomBytes(n) {
  const arr = new Uint8Array(n);
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (c && c.getRandomValues) c.getRandomValues(arr);
  else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

export async function randomToken(bytes = 24) {
  return base64UrlFromBytes(await randomBytes(bytes));
}

// SHA-256 as base64url — the PKCE S256 challenge.
export async function sha256Base64Url(text) {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (!c || !c.subtle) throw new Error("This browser cannot compute SHA-256 (PKCE needs Web Crypto).");
  const digest = await c.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return base64UrlFromBytes(new Uint8Array(digest));
}

// A fresh PKCE verifier/challenge pair (S256).
export async function createPkce() {
  const verifier = await randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge, method: "S256" };
}

// HMAC-SHA256 → base64url. Used ONLY by the simulator to mint a demo ID token
// (a real provider signs with its own private key; we just hold its public keys).
export async function hmacSha256Base64Url(secret, message) {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (!c || !c.subtle) throw new Error("This browser cannot compute HMAC (the simulator needs Web Crypto).");
  const enc = new TextEncoder();
  const key = await c.subtle.importKey("raw", enc.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await c.subtle.sign("HMAC", key, enc.encode(String(message)));
  return base64UrlFromBytes(new Uint8Array(sig));
}

// Mint a simulator ID token with the given claims. `nonce` is echoed so the
// server's replay check passes; the server verifies the HMAC with the same
// public demo key, so this exercises the real verification path end to end.
export async function mintSimulatorIdToken({ clientId = SIMULATOR_CLIENT_ID, issuer = SIMULATOR_ISSUER, secret = SIMULATOR_SECRET, nonce = "", claims = {}, lifetimeSeconds = 600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", kid: "simulator" };
  const payload = {
    iss: issuer,
    aud: clientId,
    sub: claims.sub || "sim-" + shortHash(claims.preferred_username || claims.email || String(now)),
    nonce,
    iat: now,
    nbf: now,
    exp: now + lifetimeSeconds,
    ...claims,
  };
  const signingInput = base64UrlEncode(JSON.stringify(header)) + "." + base64UrlEncode(JSON.stringify(payload));
  const signature = await hmacSha256Base64Url(secret, signingInput);
  return signingInput + "." + signature;
}

// ---- presentation ----------------------------------------------------------

// A safe copy of a provider for the client to hold (no demo secret). The JWKS is
// public, but it is large; callers can strip it for a listing.
export function sanitizeProvider(provider) {
  const { ...p } = provider || {};
  delete p.clientSecret;
  delete p.demoSecret;
  return p;
}

export function sanitizeProviders(providers, { includeJwks = true } = {}) {
  return (Array.isArray(providers) ? providers : []).map((p) => {
    const s = sanitizeProvider(p);
    if (!includeJwks) delete s.jwks;
    return s;
  });
}

// A one-line description for a listing row.
export function providerSummary(provider) {
  const p = provider || {};
  if (p.kind === "simulator") return "Built-in simulator — no directory required (demo only).";
  const verified = jwksKeyCount(p) ? `${jwksKeyCount(p)} signing key${jwksKeyCount(p) === 1 ? "" : "s"}` : "signing keys not fetched yet";
  return `${p.issuer || "no issuer"} · ${p.clientId || "no client id"} · ${verified}`;
}

export const IDP_ROLES = Object.keys(ROLE_IDS);
