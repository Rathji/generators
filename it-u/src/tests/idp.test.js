// src/tests/idp.test.js — validation tests for Phase 13 task 58 (single sign-on
// against an external identity provider). Run in the live page:
//   await import("./src/tests/idp.test.js").then((m) => m.run())
//
// Covers: provider presets and their seeding; provider normalization and
// validation; discovery-URL derivation and folding a discovery document in;
// claim path reading (dotted and literal); identity + group extraction from
// Entra/Okta-shaped claims; the group → scoped-role rules; the OIDC authorize
// URL; callback parsing (query, fragment and error); JWT decoding; audience
// matching; PKCE generation and its S256 relationship; and the simulator's
// HMAC-signed ID token (including the header/payload/nonce it carries).

import { runTests, assert, assertEq } from "./harness.js";
import {
  PROVIDER_PRESETS,
  SIMULATOR_CLIENT_ID,
  SIMULATOR_ISSUER,
  SIMULATOR_SECRET,
  DEFAULT_SCOPES,
  presetFor,
  providerFromPreset,
  simulatorProvider,
  isProviderId,
  providerSlug,
  shortHash,
  normalizeUsername,
  claimValue,
  claimString,
  claimList,
  extractIdentity,
  groupMatches,
  rolesFromRules,
  ruleSummary,
  validateRule,
  normalizeProvider,
  normalizeProviders,
  validateProvider,
  discoveryUrlFor,
  needsDiscovery,
  applyDiscovery,
  normalizeJwks,
  jwksKeyCount,
  buildAuthorizeUrl,
  parseCallback,
  base64UrlEncode,
  base64UrlDecode,
  decodeJwt,
  audienceIncludes,
  describeClaims,
  createPkce,
  sha256Base64Url,
  hmacSha256Base64Url,
  mintSimulatorIdToken,
  sanitizeProvider,
  sanitizeProviders,
  providerSummary,
} from "../framework/idp.js";

const valid = {
  id: "entra",
  name: "Entra",
  kind: "oidc",
  issuer: "https://login.microsoftonline.com/tenant/v2.0",
  authorizationEndpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
  jwksUri: "https://login.microsoftonline.com/tenant/discovery/v2.0/keys",
  clientId: "11111111-2222-3333-4444-555555555555",
  scopes: DEFAULT_SCOPES,
  usernameClaim: "preferred_username",
  nameClaim: "name",
  emailClaim: "email",
  groupsClaim: "groups",
  defaultRole: "viewer",
  rules: [],
};

const entraClaims = () => ({
  iss: "https://login.microsoftonline.com/tenant/v2.0",
  aud: "11111111-2222-3333-4444-555555555555",
  sub: "abc-123",
  preferred_username: "Jordan.Tech@acme.example",
  name: "Jordan Technician",
  email: "jordan.tech@acme.example",
  groups: ["11111111-aaaa-bbbb-cccc-000000000001", "team-helpdesk"],
});

export async function run() {
  return runTests([
    {
      name: "every preset is distinct and names a real kind",
      fn: async () => {
        const ids = new Set();
        for (const p of PROVIDER_PRESETS) {
          assert(isProviderId(p.id), "preset id “" + p.id + "”");
          assert(!ids.has(p.id), "duplicate preset " + p.id);
          ids.add(p.id);
          assert(p.name && p.name.length > 0, p.id + " name");
          assert(p.kind === "oidc" || p.kind === "simulator", p.id + " kind");
        }
        assert(PROVIDER_PRESETS.length >= 5, "a useful spread of presets");
      },
    },
    {
      name: "presetFor and providerFromPreset seed an editable provider",
      fn: async () => {
        assertEq(presetFor("nope"), null, "unknown preset");
        const p = providerFromPreset("entra-roles");
        assertEq(p.id, "entra-roles", "id from preset");
        assertEq(p.groupsClaim, "roles", "app-roles preset reads the roles claim");
        assertEq(p.kind, "oidc", "kind");
        assertEq(p.defaultRole, "viewer", "default role");
        assertEq(validateProvider(p).ok, false, "a fresh preset still needs an issuer");
      },
    },
    {
      name: "the simulator provider is valid and marked as a demo",
      fn: async () => {
        const sim = simulatorProvider();
        assertEq(sim.kind, "simulator", "kind");
        assertEq(sim.demo, true, "demo flag");
        assertEq(sim.clientId, SIMULATOR_CLIENT_ID, "client id");
        assertEq(sim.issuer, SIMULATOR_ISSUER, "issuer");
        assertEq(validateProvider(sim).ok, true, "valid");
      },
    },
    {
      name: "provider ids and slugs are constrained",
      fn: async () => {
        assertEq(isProviderId("entra"), true, "simple");
        assertEq(isProviderId("entra-id.v2"), true, "dots and dashes");
        assertEq(isProviderId("Entra ID"), false, "spaces/caps rejected");
        assertEq(isProviderId(""), false, "empty rejected");
        assertEq(providerSlug("Microsoft Entra ID"), "microsoft-entra-id", "slugify");
        assertEq(providerSlug("entra", ["entra"]), "entra-2", "uniquify");
        assertEq(providerSlug("", []), "provider", "fallback");
      },
    },
    {
      name: "normalizeUsername folds a claim into a valid IT-U username",
      fn: async () => {
        assertEq(normalizeUsername("Jordan.Tech@acme.example"), "jordan.tech", "email → local part");
        assertEq(normalizeUsername("ACME\\jordan"), "acme-jordan", "domain slash sanitized");
        assertEq(normalizeUsername("j"), "sso-" + shortHash("j"), "too short → hashed fallback");
        const uniq = normalizeUsername("jordan.tech", { subject: "abc", taken: (u) => u === "jordan.tech" });
        assert(uniq !== "jordan.tech" && uniq.length <= 24, "collision disambiguated");
      },
    },
    {
      name: "claim readers handle scalars, arrays, space-lists and dotted/literal paths",
      fn: async () => {
        const claims = { a: { b: "deep" }, list: ["x", "y"], spaced: "x y z", "https://itu/roles": ["admin"], num: 7 };
        assertEq(claimValue(claims, "a.b"), "deep", "dotted path");
        assertEq(claimValue(claims, "_https://itu/roles").length, 1, "literal leading underscore");
        assertEq(claimString(claims, "a.b"), "deep", "string");
        assertEq(claimString(claims, "missing"), "", "missing");
        assertEq(claimString(claims, "list"), "x", "array first");
        assertEq(claimList(claims, "list").join(","), "x,y", "array");
        assertEq(claimList(claims, "spaced").join(","), "x,y,z", "space list");
        assertEq(claimList(claims, "num").join(","), "7", "scalar");
        assertEq(claimList(claims, "missing").length, 0, "missing → []");
      },
    },
    {
      name: "extractIdentity reads an Entra-shaped token (username, name, groups, subject)",
      fn: async () => {
        const p = normalizeProvider({ ...valid, groupsClaim: "groups" }).provider;
        const id = extractIdentity(p, entraClaims());
        assertEq(id.username, "jordan.tech", "username");
        assertEq(id.name, "Jordan Technician", "display name");
        assertEq(id.email, "jordan.tech@acme.example", "email");
        assertEq(id.subject, "abc-123", "subject");
        assertEq(id.groups.length, 2, "two groups");
        assert(id.groups.includes("team-helpdesk"), "named group kept");
      },
    },
    {
      name: "extractIdentity falls back to roles and to a hashed username",
      fn: async () => {
        const p = normalizeProvider({ ...valid, groupsClaim: "roles", usernameClaim: "preferred_username" }).provider;
        const id = extractIdentity(p, { sub: "only-sub", roles: ["ITU.Admin"] });
        assert(id.groups.includes("ITU.Admin"), "roles read when groupsClaim is roles");
        assert(/^sso-/.test(id.username), "opaque subject → hashed username, got " + id.username);
      },
    },
    {
      name: "groupMatches supports exact, case-insensitive and glob patterns",
      fn: async () => {
        assertEq(groupMatches("team-helpdesk", "Team-Helpdesk"), true, "case-insensitive exact");
        assertEq(groupMatches("it-*", "it-support"), true, "prefix glob");
        assertEq(groupMatches("*-admin", "itu-admin"), true, "suffix glob");
        assertEq(groupMatches("*eng*", "platform-engineering"), true, "infix glob");
        assertEq(groupMatches("security", "platform"), false, "no match");
        assertEq(groupMatches("", "anything"), false, "empty pattern never matches");
        assertEq(groupMatches("*", "anything"), true, "star matches all");
      },
    },
    {
      name: "rolesFromRules grants scoped roles from directory groups",
      fn: async () => {
        const p = normalizeProvider({
          ...valid,
          rules: [
            { match: "team-helpdesk", role: "technician", scope: "client:acme" },
            { match: "*-admin", role: "administrator", scope: "*" },
            { match: "everyone-ignored", role: "technician", scope: "*" },
          ],
        }).provider;
        const grants = rolesFromRules(p, ["team-helpdesk", "itu-admin"]);
        const keys = grants.map((g) => g.role + "@" + g.scope).sort();
        assertEq(keys.join(" "), "administrator@* technician@client:acme", "rules applied, non-matches skipped");
        const only = rolesFromRules(p, ["team-helpdesk"]);
        assertEq(only.length, 1, "one grant when one rule matches");
      },
    },
    {
      name: "rolesFromRules treats an empty or starred match as everyone, and applies a default role",
      fn: async () => {
        const p = normalizeProvider({
          ...valid,
          defaultRole: "technician",
          rules: [{ match: "", role: "viewer", scope: "*" }, { match: "*", role: "administrator", scope: "*" }],
        }).provider;
        const grants = rolesFromRules(p, []);
        const keys = grants.map((g) => g.role + "@" + g.scope).sort();
        assert(keys.includes("administrator@*"), "star rule applied to all");
        assert(keys.includes("technician@*"), "default role applied");
        assertEq(ruleSummary({ match: "", role: "technician", scope: "*" }), "everyone → Technician at the whole repository", "rule summary");
      },
    },
    {
      name: "validateRule and validateProvider reject bad input",
      fn: async () => {
        assertEq(validateRule({ role: "nope", scope: "*" }).ok, false, "bad role");
        assertEq(validateRule({ role: "technician", scope: "nonsense scope" }).ok, false, "bad scope");
        assertEq(validateRule({ role: "technician", scope: "client:acme" }).ok, true, "good rule");
        assertEq(validateProvider(normalizeProvider({ ...valid, clientId: "" }).provider).ok, false, "missing client id");
        assertEq(validateProvider(normalizeProvider({ ...valid, issuer: "ftp://x" }).provider).ok, false, "non-http issuer");
        assertEq(validateProvider(normalizeProvider(valid).provider).ok, true, "valid provider");
      },
    },
    {
      name: "normalizeProvider coerces the shape and normalizes rules",
      fn: async () => {
        const { provider } = normalizeProvider({
          id: "Entra-ID",
          name: "  Entra  ",
          issuer: "https://x.example/",
          rules: [{ match: "a", role: "Admin", scope: "" }],
          junk: 1,
        });
        assertEq(provider.id, "entra-id", "id lowercased");
        assertEq(provider.name, "Entra", "name trimmed");
        assertEq(provider.issuer, "https://x.example", "trailing slash removed");
        assertEq(provider.scopes, DEFAULT_SCOPES, "default scopes");
        assertEq(provider.rules[0].role, "administrator", "role alias folded");
        assertEq(provider.rules[0].scope, "*", "empty scope → global");
        assertEq(provider.junk, undefined, "unknown fields dropped");
      },
    },
    {
      name: "normalizeProviders drops duplicates and keys errors by id",
      fn: async () => {
        const { providers, errorsById } = normalizeProviders([
          { ...valid, id: "a", name: "A" },
          { ...valid, id: "a", name: "A again" },
          { id: "b", name: "B", kind: "oidc" },
        ]);
        assertEq(providers.length, 2, "duplicate removed");
        assertEq(providers[0].name, "A", "first wins");
        assertEq(providers[1].id, "b", "second kept");
        assert(Array.isArray(errorsById.b) && errorsById.b.length > 0, "incomplete provider flagged");
        assertEq(errorsById.a, undefined, "valid provider has no errors");
      },
    },
    {
      name: "discovery URL derivation and needsDiscovery",
      fn: async () => {
        assertEq(discoveryUrlFor("https://login.microsoftonline.com/t/v2.0"), "https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration", "issuer + path");
        assertEq(discoveryUrlFor("https://x/.well-known/openid-configuration"), "https://x/.well-known/openid-configuration", "already a discovery URL");
        assertEq(discoveryUrlFor(""), "", "empty");
        const p = normalizeProvider(valid).provider;
        assertEq(needsDiscovery(p), false, "endpoints present");
        assertEq(needsDiscovery(normalizeProvider({ ...valid, authorizationEndpoint: "", tokenEndpoint: "", jwksUri: "" }).provider), true, "room to discover");
        assertEq(needsDiscovery(simulatorProvider()), false, "simulator never discovers");
      },
    },
    {
      name: "applyDiscovery folds a document in (issuer wins, keys noted)",
      fn: async () => {
        const before = normalizeProvider({ ...valid, issuer: "https://old.example", authorizationEndpoint: "", tokenEndpoint: "", jwksUri: "" }).provider;
        const { provider, errors } = applyDiscovery(before, {
          issuer: "https://new.example/",
          authorization_endpoint: "https://new.example/authorize",
          token_endpoint: "https://new.example/token",
          jwks_uri: "https://new.example/keys",
          end_session_endpoint: "https://new.example/logout",
        });
        assertEq(errors.length, 0, "no errors");
        assertEq(provider.issuer, "https://new.example", "issuer replaced + trimmed");
        assertEq(provider.authorizationEndpoint, "https://new.example/authorize", "authorize endpoint");
        assertEq(provider.jwksUri, "https://new.example/keys", "jwks uri");
        assertEq(provider.endSessionEndpoint, "https://new.example/logout", "logout endpoint");
        const bad = applyDiscovery(before, { nope: true });
        assert(bad.errors.length > 0, "invalid document reported");
        assertEq(bad.provider.authorizationEndpoint, "", "invalid document leaves provider unchanged");
      },
    },
    {
      name: "normalizeJwks keeps only usable keys and counts them",
      fn: async () => {
        const jwks = normalizeJwks({ keys: [{ kty: "RSA", n: "abc", e: "AQAB" }, { kty: "RSA" }, null, "x"] });
        assertEq(jwks.keys.length, 1, "only the usable key kept");
        assertEq(jwksKeyCount({ jwks }), 1, "count");
        assertEq(jwksKeyCount({}), 0, "no keys");
        assertEq(jwksKeyCount(simulatorProvider()), 0, "simulator has no pinned keys");
      },
    },
    {
      name: "buildAuthorizeUrl assembles a PKCE authorization request",
      fn: async () => {
        const url = buildAuthorizeUrl(normalizeProvider(valid).provider, {
          redirectUri: "https://g.example/src/sso-callback.html",
          state: "st-123",
          nonce: "no-456",
          codeChallenge: "ch-789",
          loginHint: "jordan@acme.example",
        });
        const u = new URL(url);
        assertEq(u.origin + u.pathname, "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize", "endpoint");
        assertEq(u.searchParams.get("client_id"), valid.clientId, "client id");
        assertEq(u.searchParams.get("response_type"), "code", "code flow");
        assertEq(u.searchParams.get("redirect_uri"), "https://g.example/src/sso-callback.html", "redirect");
        assertEq(u.searchParams.get("state"), "st-123", "state");
        assertEq(u.searchParams.get("nonce"), "no-456", "nonce");
        assertEq(u.searchParams.get("code_challenge"), "ch-789", "challenge");
        assertEq(u.searchParams.get("code_challenge_method"), "S256", "method");
        assertEq(u.searchParams.get("scope"), DEFAULT_SCOPES, "scope");
        assertEq(u.searchParams.get("login_hint"), "jordan@acme.example", "hint");
        let threw = false;
        try {
          buildAuthorizeUrl(normalizeProvider(simulatorProvider()).provider, { redirectUri: "x" });
        } catch {
          threw = true;
        }
        assertEq(threw, true, "simulator has no authorize endpoint → throws");
      },
    },
    {
      name: "parseCallback reads query, fragment and error responses",
      fn: async () => {
        const q = parseCallback("https://g.example/src/sso-callback.html?code=abc&state=st%2B1");
        assertEq(q.code, "abc", "query code");
        assertEq(q.state, "st+1", "decoded state");
        const h = parseCallback("https://g.example/cb#code=xyz&state=s2");
        assertEq(h.code, "xyz", "fragment code");
        assertEq(h.state, "s2", "fragment state");
        const e = parseCallback("https://g.example/cb?error=access_denied&error_description=User%20said%20no");
        assertEq(e.error, "access_denied", "error");
        assertEq(e.errorDescription, "User said no", "error description");
      },
    },
    {
      name: "base64url round-trips and decodeJwt reads a minted token",
      fn: async () => {
        assertEq(base64UrlDecode(base64UrlEncode("héllo ✓")), "héllo ✓", "round-trip");
        const token = await mintSimulatorIdToken({ nonce: "no-1", claims: { preferred_username: "jordan" } });
        const decoded = decodeJwt(token);
        assertEq(decoded.header.alg, "HS256", "alg");
        assertEq(decoded.payload.nonce, "no-1", "nonce echoed");
        assertEq(decoded.payload.preferred_username, "jordan", "claim present");
        assertEq(decoded.payload.aud, SIMULATOR_CLIENT_ID, "audience");
        assertEq(decoded.payload.iss, SIMULATOR_ISSUER, "issuer");
        assertEq(decodeJwt("not-a-token"), null, "garbage rejected");
        assertEq(decodeJwt("a.b"), null, "short token rejected");
      },
    },
    {
      name: "audienceIncludes accepts a string or an array",
      fn: async () => {
        assertEq(audienceIncludes("c1", "c1"), true, "string match");
        assertEq(audienceIncludes(["c0", "c1"], "c1"), true, "array match");
        assertEq(audienceIncludes(["c0"], "c1"), false, "array miss");
        assertEq(audienceIncludes("", "c1"), false, "empty");
      },
    },
    {
      name: "describeClaims summarises a token for the identity preview",
      fn: async () => {
        const token = await mintSimulatorIdToken({ claims: { preferred_username: "jordan", name: "Jordan" } });
        const d = describeClaims(token);
        assertEq(d.algorithm, "HS256", "alg");
        assertEq(d.keyId, "simulator", "kid");
        assertEq(d.username, "jordan", "username");
        assertEq(d.name, "Jordan", "name");
        assert(d.expires > Math.floor(Date.now() / 1000), "expiry in the future");
        assertEq(describeClaims("nope"), null, "unreadable → null");
      },
    },
    {
      name: "createPkce produces an S256 challenge over the verifier",
      fn: async () => {
        const { verifier, challenge, method } = await createPkce();
        assertEq(method, "S256", "method");
        assert(verifier.length >= 43 && verifier.length <= 128, "verifier length in range (" + verifier.length + ")");
        assert(/^[A-Za-z0-9_-]+$/.test(verifier), "verifier is base64url");
        assertEq(challenge, await sha256Base64Url(verifier), "challenge is SHA-256(verifier)");
        const second = await createPkce();
        assert(second.verifier !== verifier, "fresh verifier each attempt");
      },
    },
    {
      name: "the simulator token's HMAC matches a server-style verification input",
      fn: async () => {
        const token = await mintSimulatorIdToken({ nonce: "n", claims: { preferred_username: "jordan" } });
        const decoded = decodeJwt(token);
        const expected = await hmacSha256Base64Url(SIMULATOR_SECRET, decoded.signingInput);
        assertEq(decoded.signature, expected, "signature is HMAC over the signing input");
      },
    },
    {
      name: "sanitizeProvider strips a secret and providerSummary describes a row",
      fn: async () => {
        const s = sanitizeProvider({ ...valid, demoSecret: "shh" });
        assertEq(s.demoSecret, undefined, "secret stripped");
        assertEq(s.clientId, valid.clientId, "other fields kept");
        assertEq(sanitizeProviders([valid], { includeJwks: false })[0].jwks, undefined, "jwks stripped on request");
        assert(/login\.microsoftonline/.test(providerSummary(normalizeProvider(valid).provider)), "summary mentions the issuer");
        assert(/simulator/.test(providerSummary(simulatorProvider()).toLowerCase()), "simulator summary");
      },
    },
  ]);
}
