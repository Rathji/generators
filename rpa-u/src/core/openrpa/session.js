import { OPENRPA_ID, OPENRPA_SESSION_COLLECTION } from "./constants.js";

export function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input) {
  const normalized = String(input).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function mintJwt({ username = "", name = "", roles = [], ttlSeconds = 3600, now = Date.now(), extra = {} } = {}) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: username || name || "openflow-user",
    username,
    name: name || username,
    roles: roles.map((role) => (typeof role === "string" ? { _id: role, name: role } : role)),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds,
    ...extra,
  };
  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}.openrpa-demo-signature`;
}

export function decodeJwt(token, { clock = () => Date.now() } = {}) {
  if (!token || typeof token !== "string") return { ok: false, error: "No token was supplied." };
  const parts = token.split(".");
  if (parts.length < 2) return { ok: false, error: "A JWT needs at least a header and a payload." };
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]));
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch (error) {
    return { ok: false, error: "The token could not be decoded as base64url JSON." };
  }
  if (!payload || typeof payload !== "object") return { ok: false, error: "The token payload is not an object." };
  const expiresAt = payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
  const issuedAt = payload.iat ? new Date(payload.iat * 1000).toISOString() : null;
  return {
    ok: true,
    header,
    payload,
    signature: parts[2] || "",
    header64: parts[0],
    payload64: parts[1],
    issuedAt,
    expiresAt,
    expired: expiresAt ? clock() >= payload.exp * 1000 : false,
  };
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((role) => {
      if (!role) return null;
      if (typeof role === "string") return { _id: role, name: role };
      return { _id: role._id || role.id || role.name || null, name: role.name || role.id || null };
    })
    .filter((role) => role && role.name);
}

export function createSessionManager({
  resolveClient,
  clock = () => Date.now(),
  roleMaps = {},
  permissions = null,
  db = null,
  collection = OPENRPA_SESSION_COLLECTION,
} = {}) {
  let session = null;

  const iso = () => new Date(clock()).toISOString();

  function canonicalRolesFor(roleNames) {
    const out = [];
    const map = roleMaps[OPENRPA_ID] || {};
    for (const name of roleNames) {
      const mapped = map[name];
      if (mapped) {
        for (const role of Array.isArray(mapped) ? mapped : [mapped]) if (!out.includes(role)) out.push(role);
        continue;
      }
      if (permissions && permissions.roles && permissions.roles[name] && !out.includes(name)) out.push(name);
    }
    return out;
  }

  function capabilities() {
    if (!session || !permissions) return [];
    return Array.from(permissions.capabilitiesFor(session.canonicalRoles)).sort();
  }

  function isExpired(skewSeconds = 0) {
    if (!session || !session.expiresAt) return false;
    const ms = Date.parse(session.expiresAt);
    if (Number.isNaN(ms)) return false;
    return clock() >= ms - skewSeconds * 1000;
  }

  function secondsRemaining() {
    if (!session || !session.expiresAt) return null;
    const ms = Date.parse(session.expiresAt);
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.round((ms - clock()) / 1000));
  }

  async function persist() {
    if (!db) return;
    try {
      if (session) await db.put(collection, "session", session);
      else await db.remove(collection, "session");
    } catch (error) {}
  }

  function capture(result, { source = "password", token = null, refreshable = false } = {}) {
    const resolvedToken = (result && result.token) || token || null;
    const user = (result && result.user) || {};
    const decoded = resolvedToken ? decodeJwt(resolvedToken, { clock }) : { ok: false };
    const roleObjects = normalizeRoles(user.roles || (result && result.roles));
    const roleNames = roleObjects.map((role) => role.name);
    session = {
      token: resolvedToken,
      refreshToken: (result && result.refreshToken) || null,
      refreshable: refreshable || !!(result && result.refreshToken),
      user: {
        _id: user._id || null,
        name: user.name || user.username || (decoded.ok ? decoded.payload.name : null) || "OpenFlow user",
        username: user.username || (decoded.ok ? decoded.payload.username : null) || null,
      },
      roles: roleNames,
      roleObjects,
      canonicalRoles: canonicalRolesFor(roleNames),
      source,
      signedInAt: iso(),
      expiresAt: (result && result.expiresAt) || (decoded.ok ? decoded.expiresAt : null) || null,
    };
    return session;
  }

  function sessionInfo() {
    if (!session) {
      return {
        signedIn: false,
        user: null,
        username: null,
        roles: [],
        canonicalRoles: [],
        capabilities: [],
        expiresAt: null,
        secondsRemaining: null,
        expired: false,
        source: null,
        signedInAt: null,
      };
    }
    return {
      signedIn: true,
      user: session.user,
      username: session.user.username,
      roles: session.roles.slice(),
      canonicalRoles: session.canonicalRoles.slice(),
      capabilities: capabilities(),
      expiresAt: session.expiresAt,
      secondsRemaining: secondsRemaining(),
      expired: isExpired(0),
      source: session.source,
      signedInAt: session.signedInAt,
    };
  }

  async function signIn(credentials = {}) {
    const client = resolveClient();
    if (!client) return { ok: false, error: "Connect to OpenFlow before signing in." };
    const source = credentials.jwt ? "jwt" : "password";
    if (source === "password") {
      if (!credentials.username || !credentials.password) return { ok: false, error: "A username and password are required." };
    } else if (typeof credentials.jwt !== "string" || credentials.jwt.trim().length < 10) {
      return { ok: false, error: "That does not look like a JWT." };
    }
    let result;
    try {
      result = await client.request("signin", source === "jwt" ? { jwt: credentials.jwt.trim() } : { username: credentials.username, password: credentials.password });
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : "Sign-in failed." };
    }
    const captured = capture(result, { source, token: source === "jwt" ? credentials.jwt.trim() : null, refreshable: source === "jwt" });
    await persist();
    return { ok: true, session: captured, info: sessionInfo() };
  }

  async function refresh() {
    if (!session) return { ok: false, error: "Not signed in." };
    const client = resolveClient();
    if (!client) return { ok: false, error: "No OpenFlow connection is available." };
    try {
      const result = await client.request("refreshtoken", { token: session.token });
      const captured = capture(result, { source: session.source, token: session.token });
      await persist();
      return { ok: true, session: captured, info: sessionInfo() };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : "The session could not be refreshed." };
    }
  }

  async function ensureFresh({ skewSeconds = 60 } = {}) {
    if (!session) return { ok: false, error: "Not signed in." };
    if (!isExpired(skewSeconds)) return { ok: true, refreshed: false, info: sessionInfo() };
    const result = await refresh();
    return { ...result, refreshed: result.ok };
  }

  async function signOut() {
    const client = resolveClient();
    if (client && session) {
      try {
        await client.request("signout", { token: session.token }, { attempts: 1, timeoutMs: 3000 });
      } catch (error) {}
    }
    session = null;
    await persist();
    return { ok: true };
  }

  async function ready() {
    if (!db) return { session: false };
    const stored = db.get(collection, "session");
    if (stored && stored.user) session = stored;
    return { session: !!session };
  }

  async function reset() {
    session = null;
    if (db) {
      try {
        await db.clear(collection);
      } catch (error) {}
    }
  }

  function stats() {
    return {
      signedIn: !!session,
      username: session ? session.user.username : null,
      roles: session ? session.roles.length : 0,
      canonicalRoles: session ? session.canonicalRoles.length : 0,
      capabilities: capabilities().length,
      expired: isExpired(0),
      expiresAt: session ? session.expiresAt : null,
    };
  }

  return {
    collection,
    signIn,
    signOut,
    refresh,
    ensureFresh,
    sessionInfo,
    current: () => (session ? { ...session } : null),
    isSignedIn: () => !!session,
    isExpired,
    secondsRemaining,
    capabilities,
    hasCapability: (capability) => (session && permissions ? permissions.hasCapability({ roles: session.canonicalRoles }, capability) : false),
    canonicalRolesFor,
    decode: (token) => decodeJwt(token, { clock }),
    ready,
    reset,
    stats,
    hydrate: ready,
  };
}
