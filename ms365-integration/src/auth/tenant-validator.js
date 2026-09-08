// src/auth/tenant-validator.js
// MS365 Integration — Tenant & Account Validator.
//
// Verifies that the signed-in user belongs to a genuine Microsoft 365 tenant
// and holds the minimum organizational attributes required for the plugin to
// operate. Purely additive over the OAuth2 module: it reuses getValidToken()
// for a fresh access token and calls the Microsoft Graph with it.
//
// The validator is permission-aware and works in two tiers:
//   • JWT tier (no extra permission — needs only `openid`): tenant identity is
//     read from the id_token claims (`tid`, `oid`/`sub`) held in the stored
//     session profile. A personal/consumer Microsoft account is detected by its
//     well-known consumer tenant id and rejected.
//   • Account tier (needs `User.Read`): GET /me confirms the token talks to
//     Graph and checks accountEnabled / userType / licenses.
//   • Deep tenant tier (needs `Organization.Read.All`, admin consent): GET
//     /organization checks verified domains + enabled plans. This tier runs
//     only when the granted scopes include Organization.Read.All (or when
//     forced via opts.deepTenantCheck) and otherwise reports a soft skip.
//
// validateTenant(opts) → verdict
//   verdict = { valid, checks: [{name, pass, detail}], tenant, user, error }

import { getValidToken, resolveFetch, loadSession } from "./oauth2.js";

export const CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const ORG_READ_SCOPE = "Organization.Read.All";

const DEFAULT_OPTIONS = Object.freeze({
  requireVerifiedDomain: true,
  requireTenantPlans: true,
  requireMember: true,
  requireAccountEnabled: true,
  requireLicense: false,
  deepTenantCheck: null,
  fetchImpl: null,
  graphBase: GRAPH_BASE,
});

export async function validateTenant(opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail || "" });
  let error = null;

  let token = null;
  try {
    token = await getValidToken({ force: !!o.force });
  } catch (e) {
    error = e;
    add("authentication", false, e.message);
    return verdict(checks, null, null, error);
  }
  if (!token) {
    error = new Error("ms365.tenant: not authenticated — sign in first.");
    error.code = "not_authenticated";
    add("authentication", false, error.message);
    return verdict(checks, null, null, error);
  }
  add("authentication", true, "valid access token");

  const session = loadSession();
  const profile = (session && session.profile) || null;
  const scopes = (session && session.tokens && session.tokens.scope) || [];
  const tid = profile ? profile.tenantId || null : null;
  const oid = profile ? profile.oid || profile.sub || null : null;

  const tenant = { id: tid || null, displayName: null, verifiedDomains: [], assignedPlans: [] };
  const user = { id: null, upn: null, displayName: null, mail: null, userType: "", accountEnabled: true, licenseCount: 0 };

  if (!tid) {
    add("tenant_identity", false, "no id_token tenant claim — tenant unknown");
  } else if (!oid) {
    add("tenant_identity", false, "missing user object id (oid/sub) claim");
  } else {
    add("tenant_identity", true, "tenant id " + tid);
  }

  if (tid && String(tid).toLowerCase() === CONSUMER_TENANT_ID) {
    add("tenant_not_consumer", false, "personal Microsoft account (consumer tenant) — not a Microsoft 365 tenant");
  } else if (tid) {
    add("tenant_not_consumer", true, "work/school tenant " + tid);
  } else {
    add("tenant_not_consumer", false, "tenant unknown — cannot rule out a consumer account");
  }

  let me = null;
  try {
    me = await graphGet(o, "/me?$select=id,displayName,userPrincipalName,mail,userType,accountEnabled,assignedLicenses", token);
  } catch (e) {
    error = e;
    add("graph_me", false, e.message);
    return verdict(checks, tenant, user, error);
  }
  add("graph_me", true, "Graph /me responded for " + (me.userPrincipalName || me.id || "user"));
  user.id = me.id || null;
  user.upn = me.userPrincipalName || null;
  user.displayName = me.displayName || null;
  user.mail = me.mail || null;
  user.userType = me.userType || "";
  user.accountEnabled = me.accountEnabled !== false;
  user.licenseCount = Array.isArray(me.assignedLicenses) ? me.assignedLicenses.length : 0;

  if (oid && user.id && String(oid).toLowerCase() !== String(user.id).toLowerCase()) {
    add("user_identity", false, "Graph user id " + user.id + " does not match id_token oid " + oid);
  } else {
    add("user_identity", true, "Graph account matches the signed-in identity");
  }
  add("user_active", !o.requireAccountEnabled || user.accountEnabled, user.accountEnabled ? "account enabled" : "account disabled");
  const isMember = !user.userType || user.userType === "Member";
  add("user_member", !o.requireMember || isMember, user.userType ? "userType=" + user.userType : "userType unspecified");
  add("user_licensed", !o.requireLicense || user.licenseCount > 0, user.licenseCount + " assigned license(s)");

  const wantDeep = o.deepTenantCheck === null ? scopes.includes(ORG_READ_SCOPE) : !!o.deepTenantCheck;
  if (wantDeep) {
    try {
      const res = await graphGet(o, "/organization?$select=id,displayName,verifiedDomains,assignedPlans", token);
      const org = Array.isArray(res.value) ? res.value[0] : res.value || null;
      if (!org || !org.id) {
        add("tenant_deep", false, "organization endpoint returned no tenant record");
      } else {
        tenant.id = org.id;
        tenant.displayName = org.displayName || null;
        tenant.verifiedDomains = (org.verifiedDomains || []).map((d) => d && d.name).filter(Boolean);
        tenant.assignedPlans = (org.assignedPlans || [])
          .filter((p) => p && p.capabilityStatus === "Enabled")
          .map((p) => p.servicePlanName || p.service || "?");
        const verified = (org.verifiedDomains || []).some((d) => d && d.isVerified);
        add("tenant_verified", !o.requireVerifiedDomain || verified, verified ? "verified domains: " + tenant.verifiedDomains.join(", ") : "no verified domains");
        add("tenant_plans", !o.requireTenantPlans || tenant.assignedPlans.length > 0, tenant.assignedPlans.length + " enabled plan(s)");
        if (tid && String(tid).toLowerCase() !== String(org.id).toLowerCase()) {
          add("tenant_match", false, "id_token tenant " + tid + " does not match /organization tenant " + org.id);
        } else {
          add("tenant_match", true, "id_token and /organization agree on tenant " + (org.id || "?"));
        }
      }
      add("tenant_deep", true, "deep tenant check via /organization");
    } catch (e) {
      error = e;
      add("tenant_deep", false, e.message);
    }
  } else {
    const reason = o.deepTenantCheck === false ? "disabled" : "Organization.Read.All scope not granted";
    add("tenant_deep", true, "skipped — " + reason);
  }

  return verdict(checks, tenant, user, error);
}

function verdict(checks, tenant, user, error) {
  return { valid: checks.every((c) => c.pass), checks, tenant, user, error };
}

async function graphGet(o, path, token) {
  const fetchImpl = o.fetchImpl || resolveFetch();
  let res;
  try {
    res = await fetchImpl(o.graphBase + path, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
  } catch (err) {
    const e = new Error("ms365.tenant: Graph request failed at the network level: " + err.message);
    e.code = "graph_network";
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    const e = new Error("ms365.tenant: Graph returned a non-JSON response (HTTP " + (res && res.status) + ").");
    e.code = "graph_bad_json";
    e.httpStatus = res && res.status;
    throw e;
  }
  if (!res.ok || (data && data.error)) {
    throw graphError(data, res && res.status);
  }
  return data;
}

function graphError(data, status) {
  const code = (data && data.error && data.error.code) || "http_" + status;
  const msg = (data && data.error && data.error.message) || "Graph request failed (HTTP " + status + ").";
  const err = new Error("ms365.tenant: " + msg);
  err.code = code;
  err.httpStatus = status;
  err.isGraphError = true;
  return err;
}
