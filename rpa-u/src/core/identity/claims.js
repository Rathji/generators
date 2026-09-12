import { knownRole, roleIdOf, DEFAULT_ROLE_ID } from "./rbac.js";

function base64UrlToString(input) {
  const value = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  if (typeof atob !== "function") return "";
  const binary = atob(padded);
  try {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch (error) {
    return binary;
  }
}

export function decodeJwtPart(part) {
  try {
    const text = base64UrlToString(part);
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

export function decodeJwt(token) {
  const raw = String(token == null ? "" : token).trim();
  if (!raw) return { ok: false, error: "No token was supplied." };
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false, error: "The token is not a well-formed JWT (expected three dot-separated parts)." };
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (!header || !payload) return { ok: false, error: "The token header or payload could not be decoded." };
  return { ok: true, token: raw, parts, header, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` };
}

export function tokenExpiry(payload) {
  const exp = payload && Number(payload.exp);
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
}

export function tokenIssuedAt(payload) {
  const iat = payload && Number(payload.iat);
  return Number.isFinite(iat) && iat > 0 ? iat * 1000 : null;
}

export function isExpired(payload, { clock = () => Date.now(), skewMs = 0 } = {}) {
  const expiry = tokenExpiry(payload);
  if (!expiry) return false;
  return expiry - skewMs <= clock();
}

export function tokenLifetime(payload, { clock = () => Date.now() } = {}) {
  const expiry = tokenExpiry(payload);
  if (!expiry) return { expiresAt: null, expiresInMs: null, expired: false };
  const now = clock();
  return { expiresAt: expiry, expiresInMs: expiry - now, expired: expiry <= now };
}

export function claimsIdentity(payload) {
  const claims = payload && typeof payload === "object" ? payload : {};
  return {
    subject: claims.sub || claims.oid || null,
    objectId: claims.oid || null,
    name: claims.name || claims.preferred_username || claims.upn || claims.email || "Signed-in user",
    username: claims.preferred_username || claims.upn || claims.email || null,
    email: claims.email || claims.preferred_username || null,
    tenantId: claims.tid || null,
    issuer: claims.iss || null,
    audience: claims.aud || null,
    appId: claims.appid || claims.azp || null,
    issuedAt: tokenIssuedAt(claims),
    expiresAt: tokenExpiry(claims),
  };
}

export function rawRoles(payload) {
  const claims = payload && typeof payload === "object" ? payload : {};
  const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
  const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
  return { roles, groups };
}

export function rolesFromClaims(payload, config, { allowDefault = true } = {}) {
  const { roles, groups } = rawRoles(payload);
  const appRoles = (config && config.appRoles) || {};
  const groupMap = (config && config.groups) || {};
  const matches = [];
  const unknown = [];
  const seen = new Set();

  for (const value of roles) {
    const mapped = roleIdOf(appRoles[value]) || (knownRole(appRoles[value]) ? appRoles[value] : null);
    if (mapped) {
      matches.push({ source: "app-role", value, role: mapped });
      seen.add(mapped);
    } else {
      unknown.push({ source: "app-role", value });
    }
  }
  for (const value of groups) {
    const mapped = roleIdOf(groupMap[value]);
    if (mapped) {
      matches.push({ source: "group", value, role: mapped });
      seen.add(mapped);
    } else {
      unknown.push({ source: "group", value });
    }
  }

  let resolved = Array.from(seen);
  let defaulted = false;
  if (!resolved.length && allowDefault) {
    const fallback = roleIdOf(config && config.defaultRole) || DEFAULT_ROLE_ID;
    if (fallback) {
      resolved = [fallback];
      defaulted = true;
    }
  }

  return {
    roles: resolved,
    matches,
    unknown,
    defaulted,
    claimsRoles: roles,
    claimsGroups: groups,
  };
}

export function tenantCheck(payload, config) {
  const identity = claimsIdentity(payload);
  const tenantId = identity.tenantId;
  const configured = config && config.tenantId ? String(config.tenantId) : "";
  const allowed = config && Array.isArray(config.allowedTenants) ? config.allowedTenants.slice() : [];
  if (!allowed.length && configured && configured !== "common") allowed.push(configured);
  if (!allowed.length) {
    return { ok: true, tenantId, allowed: [], reason: tenantId ? `Tenant “${tenantId}” accepted (any tenant is allowed).` : "No tenant claim and no tenant restriction configured." };
  }
  if (!tenantId) {
    return { ok: false, tenantId: null, allowed, reason: "The token carries no tenant id (tid) claim, so it cannot be checked against the authorised tenant." };
  }
  const ok = allowed.includes(tenantId);
  return {
    ok,
    tenantId,
    allowed,
    reason: ok ? `Tenant “${tenantId}” is authorised.` : `Tenant “${tenantId}” is not authorised (expected ${allowed.join(" or ")}).`,
  };
}

export function debugClaims(payload) {
  const claims = payload && typeof payload === "object" ? payload : {};
  const rows = [];
  for (const [claim, value] of Object.entries(claims)) {
    let display;
    if (Array.isArray(value)) display = value.join(", ");
    else if (value && typeof value === "object") display = JSON.stringify(value);
    else display = String(value);
    if (claim === "exp" || claim === "iat" || claim === "nbf") {
      const ms = Number(value) * 1000;
      if (Number.isFinite(ms)) display = `${value} (${new Date(ms).toISOString()})`;
    }
    rows.push({ claim, value: display, kind: Array.isArray(value) ? "array" : typeof value });
  }
  return rows.sort((a, b) => a.claim.localeCompare(b.claim));
}

export function summarizeClaims(payload, config) {
  const identity = claimsIdentity(payload);
  const mapping = rolesFromClaims(payload, config);
  const tenant = tenantCheck(payload, config);
  return { identity, mapping, tenant, claims: debugClaims(payload) };
}
