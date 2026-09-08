// src/auth/tenant-validator.test.js
// Validation suite for the Tenant & Account Validator.
// Run via:  ?test=tenant  on the generator page, or programmatically:
//   const t = await import("src/auth/tenant-validator.test.js"); return await t.runAll();

import * as o from "./oauth2.js";
import { TokenStore } from "./token-store.js";
import * as tv from "./tenant-validator.js";

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

const TEST_CONFIG = {
  clientId: "00000000-0000-0000-0000-000000000000",
  tenant: "common",
  scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
  redirectUri: "https://example.com/cb",
};

function configureFresh(extra = {}) {
  o.configure({
    ...TEST_CONFIG,
    autoRefresh: false,
    store: new TokenStore(new MemoryStorage()),
    storage: () => new MemoryStorage(),
    ...extra,
  });
}

const WORK_SCOPE = ["openid", "profile", "email", "offline_access", "User.Read"];

function saveSession({ profile, scope = WORK_SCOPE, expiresAt = Date.now() + 60 * 60 * 1000 } = {}) {
  o.saveSession({
    tokens: { accessToken: "AT-VALID", refreshToken: "RT", expiresAt, scope },
    profile,
  });
}

const WORK_PROFILE = {
  name: "Ada Lovelace",
  preferredUsername: "ada@contoso.com",
  email: "ada@contoso.com",
  sub: "u-sub-1",
  oid: "u-oid-1",
  tenantId: "t-1",
};

const ME = {
  id: "u-oid-1",
  displayName: "Ada Lovelace",
  userPrincipalName: "ada@contoso.com",
  mail: "ada@contoso.com",
  userType: "Member",
  accountEnabled: true,
  assignedLicenses: [{ skuId: "sku-1", servicePlanId: "sp-1" }],
};

const ORG = {
  value: [{
    id: "t-1",
    displayName: "Contoso",
    verifiedDomains: [{ name: "contoso.com", isDefault: true, isInitial: true, isVerified: true }],
    assignedPlans: [{ capabilityStatus: "Enabled", service: "exchange", servicePlanName: "EXCHANGE_S_ENTERPRISE", servicePlanId: "x" }],
  }],
};

function graphMock(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    const u = new URL(url);
    const p = u.pathname.replace(/^\/v1\.0/, "");
    const hit = routes[p];
    if (!hit) {
      return { ok: false, status: 404, json: async () => ({ error: { code: "not_found", message: "no route " + p } }) };
    }
    const out = typeof hit === "function" ? hit({ url, init }) : hit;
    return { ok: out.ok !== false, status: out.status || 200, json: async () => out.json };
  };
  impl.calls = calls;
  return impl;
}

function check(verdict, name) { return verdict.checks.find((c) => c.name === name); }

// ── tests ──────────────────────────────────────────────────────────────────
test("validateTenant: not signed in → invalid, authentication check fails", async () => {
  configureFresh();
  const v = await tv.validateTenant();
  assertEq(v.valid, false);
  const c = check(v, "authentication");
  assert(c && !c.pass, "authentication check failed");
});

test("validateTenant: valid work account, deep check skipped → valid", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const g = graphMock({ "/me": { json: ME } });
  const v = await tv.validateTenant({ fetchImpl: g });
  assertEq(v.valid, true, JSON.stringify(v.checks));
  assert(check(v, "tenant_identity") && check(v, "tenant_identity").pass, "tenant identity from id_token");
  const deep = check(v, "tenant_deep");
  assert(deep && deep.pass && deep.detail.includes("skipped"), "deep check soft-skipped without Organization.Read.All");
  assertEq(v.user.upn, "ada@contoso.com");
  assertEq(v.user.licenseCount, 1);
  assertEq(v.tenant.id, "t-1");
  assertEq(g.calls.length, 1, "exactly one Graph call (/me)");
});

test("validateTenant: personal/consumer account rejected", async () => {
  configureFresh();
  saveSession({ profile: { ...WORK_PROFILE, tenantId: tv.CONSUMER_TENANT_ID } });
  const v = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: ME } }) });
  assertEq(v.valid, false);
  const c = check(v, "tenant_not_consumer");
  assert(c && !c.pass && c.detail.includes("personal"), "consumer tenant flagged: " + (c && c.detail));
});

test("validateTenant: guest user rejected when requireMember", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const v = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: { ...ME, userType: "Guest" } } }) });
  assertEq(v.valid, false);
  const c = check(v, "user_member");
  assert(c && !c.pass, "guest membership check fails");
});

test("validateTenant: disabled account rejected when requireAccountEnabled", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const v = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: { ...ME, accountEnabled: false } } }) });
  assertEq(v.valid, false);
  const c = check(v, "user_active");
  assert(c && !c.pass, "disabled account check fails");
});

test("validateTenant: missing id_token profile → tenant_identity fails", async () => {
  configureFresh();
  saveSession({ profile: null });
  const v = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: ME } }) });
  assertEq(v.valid, false);
  const c = check(v, "tenant_identity");
  assert(c && !c.pass, "no id_token claims");
});

test("validateTenant: /me 401 → invalid with a mapped Graph error", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const v = await tv.validateTenant({
    fetchImpl: graphMock({ "/me": { ok: false, status: 401, json: { error: { code: "InvalidAuthenticationToken", message: "token invalid" } } } }),
  });
  assertEq(v.valid, false);
  const c = check(v, "graph_me");
  assert(c && !c.pass, "graph_me fails");
  assert(v.error && v.error.isGraphError && v.error.code === "InvalidAuthenticationToken", "mapped Graph error surfaced");
});

test("validateTenant: network failure on /me → graceful invalid verdict", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const v = await tv.validateTenant({ fetchImpl: async () => { throw new Error("offline"); } });
  assertEq(v.valid, false);
  assert(v.error && v.error.code === "graph_network", "network error surfaced with code");
});

test("validateTenant: deep check runs when Organization.Read.All is granted — verified tenant valid", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE, scope: [...WORK_SCOPE, "Organization.Read.All"] });
  const v = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: ME }, "/organization": { json: ORG } }) });
  assertEq(v.valid, true, JSON.stringify(v.checks));
  const deep = check(v, "tenant_deep");
  assert(deep && deep.pass && !deep.detail.includes("skipped"), "deep check actually ran");
  assertEq(v.tenant.verifiedDomains[0], "contoso.com");
  assert(check(v, "tenant_match").pass, "id_token tenant matches /organization tenant");
});

test("validateTenant: deep check rejects a tenant with no verified domains", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE, scope: [...WORK_SCOPE, "Organization.Read.All"] });
  const v = await tv.validateTenant({
    fetchImpl: graphMock({ "/me": { json: ME }, "/organization": { json: { value: [{ ...ORG.value[0], verifiedDomains: [{ name: "contoso.com", isVerified: false }] }] } } }),
  });
  assertEq(v.valid, false);
  const c = check(v, "tenant_verified");
  assert(c && !c.pass, "unverified domain rejected");
});

test("validateTenant: deep check rejects a tenant with no enabled plans", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE, scope: [...WORK_SCOPE, "Organization.Read.All"] });
  const v = await tv.validateTenant({
    fetchImpl: graphMock({ "/me": { json: ME }, "/organization": { json: { value: [{ ...ORG.value[0], assignedPlans: [] }] } } }),
  });
  assertEq(v.valid, false);
  const c = check(v, "tenant_plans");
  assert(c && !c.pass, "planless tenant rejected");
});

test("validateTenant: deep check 403 → invalid with tenant_deep failure", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE, scope: [...WORK_SCOPE, "Organization.Read.All"] });
  const v = await tv.validateTenant({
    fetchImpl: graphMock({
      "/me": { json: ME },
      "/organization": { ok: false, status: 403, json: { error: { code: "Authorization_RequestDenied", message: "Not authorized to read organization." } } },
    }),
  });
  assertEq(v.valid, false);
  const c = check(v, "tenant_deep");
  assert(c && !c.pass, "failed deep check reported");
});

test("validateTenant: deep check catches a tid/organization mismatch", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE, scope: [...WORK_SCOPE, "Organization.Read.All"] });
  const v = await tv.validateTenant({
    fetchImpl: graphMock({ "/me": { json: ME }, "/organization": { json: { value: [{ ...ORG.value[0], id: "t-OTHER" }] } } }),
  });
  assertEq(v.valid, false);
  const c = check(v, "tenant_match");
  assert(c && !c.pass, "mismatched tenant flagged");
});

test("validateTenant: requireLicense — unlicensed user rejected when required, allowed by default", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const unlicensed = { ...ME, assignedLicenses: [] };
  const strict = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: unlicensed } }), requireLicense: true });
  assertEq(strict.valid, false, "requireLicense=true rejects unlicensed user");
  const lax = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: unlicensed } }) });
  assertEq(lax.valid, true, "default allows unlicensed user (license requirement opt-in)");
});

test("validateTenant: Graph user id mismatching the id_token oid fails", async () => {
  configureFresh();
  saveSession({ profile: WORK_PROFILE });
  const v = await tv.validateTenant({ fetchImpl: graphMock({ "/me": { json: { ...ME, id: "someone-else" } } }) });
  assertEq(v.valid, false);
  const c = check(v, "user_identity");
  assert(c && !c.pass, "identity mismatch flagged");
});

test("validateTenant: expired token triggers refresh via the lifecycle manager", async () => {
  configureFresh();
  let refreshCalls = 0;
  const tokenFetch = async (url, init) => {
    refreshCalls++;
    return { ok: true, status: 200, json: async () => ({ access_token: "REFRESHED-AT", refresh_token: "NEW-RT", token_type: "Bearer", expires_in: 3600, scope: "openid User.Read" }) };
  };
  o.configure({ ...TEST_CONFIG, autoRefresh: false, store: new TokenStore(new MemoryStorage()), storage: () => new MemoryStorage(), fetchImpl: tokenFetch });
  o.saveSession({
    tokens: { accessToken: "EXPIRED", refreshToken: "RT", expiresAt: Date.now() - 5000, scope: WORK_SCOPE },
    profile: WORK_PROFILE,
  });
  const g = graphMock({ "/me": { json: ME } });
  const v = await tv.validateTenant({ fetchImpl: g });
  assertEq(v.valid, true, JSON.stringify(v.checks));
  assertEq(refreshCalls, 1, "one token refresh performed for the expired session");
  assertEq(g.calls.length, 1, "one Graph /me call with the refreshed session");
});
