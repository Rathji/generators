import { ENTRA_DEFAULT_AUTHORITY, DEFAULT_ROLE_ID, ROLE_IDS } from "./rbac.js";

export const IDENTITY_PROVIDERS = [
  {
    id: "entra",
    label: "Microsoft Entra ID",
    description: "OpenID Connect sign-in against your Entra ID tenant using the authorization-code flow with PKCE.",
  },
  {
    id: "simulator",
    label: "Demo directory (offline)",
    description: "A local, credential-free identity provider used to exercise the RBAC flow without a live tenant.",
  },
];

export const DEFAULT_IDENTITY_CONFIG = {
  enabled: true,
  requireSignIn: true,
  showSimulator: true,
  provider: "entra",
  tenantId: "",
  allowedTenants: [],
  clientId: "",
  authority: ENTRA_DEFAULT_AUTHORITY,
  redirectUri: "",
  scopes: ["openid", "profile", "email", "offline_access"],
  appRoles: {},
  groups: {},
  defaultRole: DEFAULT_ROLE_ID,
  tokenRenewalSkewMs: 120000,
  providerProbeMs: 60000,
  silentRenewal: true,
};

function str(value, fallback) {
  if (value == null) return fallback;
  let out;
  try {
    out = String(value);
  } catch (error) {
    return fallback;
  }
  out = out.trim();
  return out.length ? out : fallback;
}

function bool(value, fallback) {
  if (value === true || value === false) return value;
  const text = str(value, "").toLowerCase();
  if (["true", "yes", "1", "on"].includes(text)) return true;
  if (["false", "no", "0", "off"].includes(text)) return false;
  return fallback;
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function list(value, fallback = []) {
  if (Array.isArray(value)) return value.map((entry) => str(entry, "")).filter(Boolean);
  const text = str(value, "");
  if (!text) return fallback.slice();
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function objectEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const keys = Array.isArray(value.$allKeys) ? value.$allKeys : Object.keys(value);
  const out = [];
  for (const key of keys) {
    if (typeof key !== "string" || !key || key.startsWith("$")) continue;
    let entry;
    try {
      entry = value[key];
    } catch (error) {
      continue;
    }
    if (entry == null || typeof entry === "function") continue;
    out.push([key, entry]);
  }
  return out;
}

function roleMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, role] of objectEntries(value)) {
    const id = ROLE_IDS[String(role).trim().toLowerCase().replace(/[\s-]+/g, "_")];
    if (key && id) out[key] = id;
  }
  return out;
}

export function normalizeIdentityConfig(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const provider = str(source.provider, DEFAULT_IDENTITY_CONFIG.provider).toLowerCase();
  const defaultRole = ROLE_IDS[str(source.defaultRole, DEFAULT_ROLE_ID).toLowerCase().replace(/[\s-]+/g, "_")];
  const scopes = list(source.scopes, DEFAULT_IDENTITY_CONFIG.scopes);
  return {
    enabled: bool(source.enabled, DEFAULT_IDENTITY_CONFIG.enabled),
    requireSignIn: bool(source.requireSignIn, DEFAULT_IDENTITY_CONFIG.requireSignIn),
    showSimulator: bool(source.showSimulator, DEFAULT_IDENTITY_CONFIG.showSimulator),
    provider: IDENTITY_PROVIDERS.some((entry) => entry.id === provider) ? provider : DEFAULT_IDENTITY_CONFIG.provider,
    tenantId: str(source.tenantId, ""),
    allowedTenants: list(source.allowedTenants),
    clientId: str(source.clientId, ""),
    authority: str(source.authority, ENTRA_DEFAULT_AUTHORITY).replace(/\/+$/, ""),
    redirectUri: str(source.redirectUri, ""),
    scopes: scopes.length ? scopes : DEFAULT_IDENTITY_CONFIG.scopes.slice(),
    appRoles: roleMap(source.appRoles),
    groups: roleMap(source.groups),
    defaultRole: defaultRole || DEFAULT_ROLE_ID,
    tokenRenewalSkewMs: num(source.tokenRenewalSkewMs, DEFAULT_IDENTITY_CONFIG.tokenRenewalSkewMs),
    providerProbeMs: num(source.providerProbeMs, DEFAULT_IDENTITY_CONFIG.providerProbeMs),
    silentRenewal: bool(source.silentRenewal, DEFAULT_IDENTITY_CONFIG.silentRenewal),
  };
}

export function entraAuthority(config) {
  const base = str(config && config.authority, ENTRA_DEFAULT_AUTHORITY).replace(/\/+$/, "");
  const tenant = str(config && config.tenantId, "") || "common";
  return `${base}/${tenant}`;
}

export function entraEndpoints(config) {
  const base = entraAuthority(config);
  const authority = str(config && config.authority, ENTRA_DEFAULT_AUTHORITY).replace(/\/+$/, "");
  const tenant = str(config && config.tenantId, "") || "common";
  return {
    metadata: `${authority}/${tenant}/v2.0/.well-known/openid-configuration`,
    authorize: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
  };
}

export function isEntraConfigured(config) {
  if (!config) return false;
  return !!(str(config.tenantId, "") && str(config.clientId, ""));
}

export function identityRolePool(config) {
  const out = new Set();
  for (const role of Object.values(config && config.appRoles ? config.appRoles : {})) out.add(role);
  if (config && config.defaultRole) out.add(config.defaultRole);
  return out;
}

export function validateIdentityConfig(config, { roleExists = (id) => !!ROLE_IDS[id] } = {}) {
  const issues = [];
  const add = (level, code, message, ref) => issues.push({ level, code, message, ref });
  if (!config) return { ok: false, issues: [{ level: "error", code: "missing-config", message: "No identity configuration was provided.", ref: "identity" }], counts: { error: 1, warn: 0, info: 0 } };

  if (config.enabled && config.provider === "entra" && !isEntraConfigured(config)) {
    add("warn", "unconfigured", "Entra ID is selected but the tenant id and client id are empty — the demo directory will be used instead.", "identity");
  }
  for (const [claim, role] of Object.entries(config.appRoles || {})) {
    if (!roleExists(role)) add("error", "unknown-role", `App role “${claim}” maps to unknown role “${role}”.`, claim);
  }
  for (const [claim, role] of Object.entries(config.groups || {})) {
    if (!roleExists(role)) add("error", "unknown-role", `Group “${claim}” maps to unknown role “${role}”.`, claim);
  }
  if (!roleExists(config.defaultRole)) add("error", "unknown-default-role", `Default role “${config.defaultRole}” is not a known role.`, "defaultRole");
  if (config.allowedTenants && config.allowedTenants.length === 0 && config.tenantId && config.tenantId !== "common") {
    add("info", "tenant-locked", `Only tenant “${config.tenantId}” is accepted for sign-in.`, "tenantId");
  }
  const counts = { error: 0, warn: 0, info: 0 };
  for (const issue of issues) counts[issue.level] = (counts[issue.level] || 0) + 1;
  return { ok: counts.error === 0, issues, counts };
}

export function publicIdentityConfig(config) {
  const cfg = normalizeIdentityConfig(config);
  const endpoints = entraEndpoints(cfg);
  return {
    enabled: cfg.enabled,
    requireSignIn: cfg.requireSignIn,
    showSimulator: cfg.showSimulator,
    provider: cfg.provider,
    tenantId: cfg.tenantId,
    allowedTenants: cfg.allowedTenants.slice(),
    clientId: cfg.clientId,
    authority: cfg.authority,
    redirectUri: cfg.redirectUri,
    scopes: cfg.scopes.slice(),
    defaultRole: cfg.defaultRole,
    silentRenewal: cfg.silentRenewal,
    appRoleCount: Object.keys(cfg.appRoles).length,
    groupCount: Object.keys(cfg.groups).length,
    configured: isEntraConfigured(cfg),
    endpoints,
  };
}
