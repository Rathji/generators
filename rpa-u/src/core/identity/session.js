import { normalizeIdentityConfig, publicIdentityConfig, isEntraConfigured } from "./config.js";
import { createProviderRegistry } from "./provider.js";
import { decodeJwt, tokenLifetime, rolesFromClaims, tenantCheck, summarizeClaims } from "./claims.js";
import { can, check, readOnly, highestRole, roleLabel, knownRole } from "./rbac.js";

export const IDENTITY_STATUSES = ["signed-out", "authenticating", "authenticated", "expired", "wrong-tenant", "offline", "error"];
export const SESSION_COLLECTION = "identity_session";
export const PENDING_STORAGE_KEY = "identity-entra-pending";
const MAX_TIMER_MS = 2147000000;

export function createIdentitySession({
  config,
  db = null,
  collection = SESSION_COLLECTION,
  registry = null,
  clock = () => Date.now(),
  timers = {
    setTimeout: typeof setTimeout === "function" ? (fn, ms) => setTimeout(fn, ms) : null,
    clearTimeout: typeof clearTimeout === "function" ? (id) => clearTimeout(id) : null,
  },
  autoRenew = true,
  onEvent = null,
  windowRef = globalThis.window,
  fetchImpl = null,
  storage = typeof sessionStorage !== "undefined" ? sessionStorage : null,
} = {}) {
  const cfg = normalizeIdentityConfig(config);
  const providers = registry || createProviderRegistry({ config: cfg, clock, windowRef, fetchImpl });
  const listeners = new Set();

  function loadPending() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(PENDING_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function savePending(value) {
    if (!storage) return;
    try {
      storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(value));
    } catch (error) {}
  }

  function clearPendingStorage() {
    if (!storage) return;
    try {
      storage.removeItem(PENDING_STORAGE_KEY);
    } catch (error) {}
  }

  let status = "signed-out";
  let transition = null;
  let error = null;
  let user = null;
  let tokens = null;
  let claims = null;
  let roles = [];
  let mapping = { roles: [], matches: [], unknown: [], defaulted: false };
  let tenant = null;
  let pending = null;
  let renewalTimer = null;
  let hydration = null;
  let connectivityState = isEntraConfigured(cfg)
    ? { status: "unknown", lastProbeAt: null, latencyMs: null, reason: "" }
    : { status: "connected", lastProbeAt: null, latencyMs: null, reason: "The demo directory is always available." };
  let connectivityTimer = null;

  function now() {
    return clock();
  }

  function identityEnabled() {
    return cfg.enabled;
  }

  function configured() {
    return isEntraConfigured(cfg);
  }

  function snapshot() {
    const lifetime = claims ? tokenLifetime(claims, { clock }) : { expiresAt: null, expiresInMs: null, expired: false };
    return {
      enabled: cfg.enabled,
      requireSignIn: cfg.requireSignIn,
      status,
      transition,
      authenticated: status === "authenticated",
      providerId: providers.primary ? providers.primary.id : cfg.provider,
      providerKind: providers.primary ? providers.primary.kind : "oidc",
      configured: configured(),
      showSimulator: cfg.showSimulator,
      user: user ? { ...user } : null,
      roles: roles.slice(),
      roleLabels: roles.map(roleLabel),
      highestRole: highestRole(roles),
      highestRoleLabel: highestRole(roles) ? roleLabel(highestRole(roles)) : null,
      readOnly: readOnly(roles),
      permissions: permissions(),
      token: {
        present: !!tokens,
        expiresAt: lifetime.expiresAt,
        expiresInMs: lifetime.expiresInMs,
        expired: lifetime.expired,
        issuedAt: tokens ? tokens.issuedAt || null : null,
        hasRefreshToken: !!(tokens && tokens.refreshToken),
      },
      tenant: tenant ? { ...tenant } : null,
      mapping: { ...mapping, matches: mapping.matches.slice(), unknown: mapping.unknown.slice() },
      error,
      connectivity: { ...connectivityState },
      offline: connectivityState.status === "offline",
      at: now(),
    };
  }

  function permissions() {
    const list = [];
    for (const key of ["registry.view", "settings.view", "sync.view", "conflicts.view", "events.view", "links.view", "monitor.view", "openrpa.view", "identity.view", "bundles.view", "audit.view", "access.view"]) {
      if (can(roles, key)) list.push(key);
    }
    return list;
  }

  function notify(eventType) {
    const snap = snapshot();
    for (const listener of listeners) {
      try {
        listener(snap, eventType);
      } catch (e) {}
    }
    if (typeof onEvent === "function") {
      try {
        onEvent(eventType, snap);
      } catch (e) {}
    }
    return snap;
  }

  function setStatus(next, reason = null) {
    status = next;
    transition = reason;
  }

  function subscribeEvents() {
    for (const provider of providers.list || []) {
      if (typeof provider.onState === "function") provider.onState((state) => setConnectivity(state));
    }
  }

  function setConnectivity({ status: state, reason = "", latencyMs = null } = {}) {
    connectivityState = { status: state || "degraded", lastProbeAt: now(), latencyMs, reason };
    notify("identity.connectivity");
  }

  function scheduleConnectivityProbe() {
    if (!autoRenew || !timers.setTimeout || !configured() || cfg.providerProbeMs <= 0) return;
    connectivityTimer = timers.setTimeout(async () => {
      await probe();
      scheduleConnectivityProbe();
    }, cfg.providerProbeMs);
  }

  async function probe() {
    if (!configured()) {
      setConnectivity({ status: "connected", reason: "The demo directory is always available." });
      return connectivityState;
    }
    const result = await providers.entra.probe();
    setConnectivity({ status: result.status, reason: result.error || (result.ok ? "Identity provider reachable." : ""), latencyMs: result.latencyMs });
    return { ...result, connectivity: connectivityState };
  }

  function clearRenewal() {    if (renewalTimer && timers.clearTimeout) timers.clearTimeout(renewalTimer);
    renewalTimer = null;
  }

  function scheduleRenewal() {
    clearRenewal();
    if (!autoRenew || !timers.setTimeout || !tokens || !claims) return;
    const lifetime = tokenLifetime(claims, { clock });
    if (lifetime.expiresAt == null) return;
    const delay = Math.max(1000, Math.min(MAX_TIMER_MS, lifetime.expiresAt - now() - cfg.tokenRenewalSkewMs));
    renewalTimer = timers.setTimeout(() => {
      renew({ reason: "scheduled" });
    }, delay);
  }

  function persistable() {
    if (!tokens) return null;
    return {
      providerId: providers.primary ? providers.primary.id : cfg.provider,
      providerKind: providers.primary ? providers.primary.kind : "oidc",
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      expiresAt: tokens.expiresAt,
      issuedAt: tokens.issuedAt,
      user,
      roles,
      tenant,
      savedAt: now(),
    };
  }

  async function persist() {
    if (!db) return;
    const record = persistable();
    if (!record) {
      await db.remove(collection, "current");
      return;
    }
    await db.put(collection, "current", record);
  }

  async function clearPersisted() {
    if (!db) return;
    await db.remove(collection, "current");
  }

  function clearSessionState() {
    tokens = null;
    claims = null;
    user = null;
    roles = [];
    mapping = { roles: [], matches: [], unknown: [], defaulted: false };
    tenant = null;
    pending = null;
    clearPendingStorage();
    clearRenewal();
  }

  async function establish({ tokenSet, providerId, providerKind } = {}) {
    if (!tokenSet) {
      setStatus("error", "sign-in");
      error = "No token was returned by the identity provider.";
      await clearPersisted();
      return notify("identity.error");
    }
    const idToken = tokenSet.idToken || null;
    const accessToken = tokenSet.accessToken || null;
    const decoded = decodeJwt(idToken || accessToken);
    if (!decoded.ok) {
      setStatus("error", "sign-in");
      error = decoded.error;
      await clearPersisted();
      return notify("identity.error");
    }
    claims = decoded.payload;
    tokens = { ...tokenSet };

    const tenantResult = tenantCheck(claims, cfg);
    tenant = tenantResult;
    if (!tenantResult.ok) {
      setStatus("wrong-tenant", "wrong-tenant");
      error = tenantResult.reason;
      user = { ...summarizeIdentity(claims), roles: [] };
      roles = [];
      mapping = { roles: [], matches: [], unknown: [], defaulted: false };
      tokens = null;
      await clearPersisted();
      return notify("identity.wrong-tenant");
    }

    mapping = rolesFromClaims(claims, cfg);
    roles = mapping.roles.slice();
    user = { ...summarizeIdentity(claims) };
    const lifetime = tokenLifetime(claims, { clock });
    if (lifetime.expired) {
      setStatus("expired", "expired");
      error = "The identity token has already expired.";
      return notify("identity.expired");
    }
    setStatus("authenticated", "sign-in");
    error = null;
    await persist();
    scheduleRenewal();
    setConnectivity({ status: "connected", reason: "Signed in.", latencyMs: connectivityState.latencyMs });
    notify("identity.signed-in");
    return { ok: true, state: snapshot() };
  }

  function summarizeIdentity(payload) {
    const summary = summarizeClaims(payload, cfg);
    return {
      subject: summary.identity.subject,
      objectId: summary.identity.objectId,
      name: summary.identity.name,
      username: summary.identity.username,
      email: summary.identity.email,
      tenantId: summary.identity.tenantId,
      issuer: summary.identity.issuer,
      audience: summary.identity.audience,
      appId: summary.identity.appId,
      issuedAt: summary.identity.issuedAt,
      expiresAt: summary.identity.expiresAt,
    };
  }

  async function restore(record) {
    if (!record || !(record.idToken || record.accessToken)) return false;
    const decoded = decodeJwt(record.idToken || record.accessToken);
    if (!decoded.ok) return false;
    claims = decoded.payload;
    tokens = {
      accessToken: record.accessToken || null,
      idToken: record.idToken || null,
      refreshToken: record.refreshToken || null,
      tokenType: record.tokenType || "Bearer",
      expiresAt: record.expiresAt || null,
      issuedAt: record.issuedAt || null,
    };
    const tenantResult = tenantCheck(claims, cfg);
    tenant = tenantResult;
    if (!tenantResult.ok) {
      user = { ...summarizeIdentity(claims), roles: [] };
      roles = [];
      tokens = null;
      claims = null;
      setStatus("wrong-tenant", "restore");
      error = tenantResult.reason;
      await clearPersisted();
      return false;
    }
    mapping = rolesFromClaims(claims, cfg);
    roles = mapping.roles.slice();
    user = { ...summarizeIdentity(claims) };
    const lifetime = tokenLifetime(claims, { clock });
    if (lifetime.expired) {
      setStatus("expired", "restore");
      return renew({ reason: "restore" });
    }
    setStatus("authenticated", "restore");
    scheduleRenewal();
    return true;
  }

  async function start() {
    if (hydration) return hydration;
    hydration = (async () => {
      if (!cfg.enabled) {
        setStatus("signed-out", "disabled");
        return snapshot();
      }
      if (db) {
        await db.ready();
        const record = db.get(collection, "current");
        if (record) await restore(record);
      }
      if (typeof (windowRef && windowRef.navigator) === "object" && windowRef.navigator && windowRef.navigator.onLine === false) {
        setConnectivity({ status: "offline", reason: "The browser reports that it is offline." });
      }
      scheduleConnectivityProbe();
      return snapshot();
    })();
    return hydration;
  }

  async function signInWithSimulator(accountId) {
    if (!cfg.showSimulator) return { ok: false, error: "The demo directory is disabled in this deployment." };
    setStatus("authenticating", "simulator");
    notify("identity.signing-in");
    const result = providers.simulator.beginSignIn({ accountId });
    if (!result.ok) {
      setStatus("signed-out", "simulator");
      error = result.error;
      return notify("identity.error");
    }
    return establish({ tokenSet: result.tokens, providerId: "simulator", providerKind: "simulator" });
  }

  async function beginEntraSignIn(options = {}) {
    if (cfg.provider !== "entra" && !configured()) {
      return { ok: false, error: "Microsoft Entra ID sign-in is not enabled for this deployment." };
    }
    if (!configured()) return { ok: false, error: "Entra ID is not configured: set the tenant id and client id first." };
    setStatus("authenticating", "entra");
    notify("identity.signing-in");
    const begun = await providers.entra.beginSignIn(options);
    if (!begun.ok) {
      setStatus("signed-out", "entra");
      error = begun.error;
      return begun;
    }
    pending = { state: begun.state, nonce: begun.nonce, verifier: begun.verifier, redirectUri: begun.redirectUri, providerId: "entra", startedAt: now() };
    savePending(pending);
    return begun;
  }

  async function completeEntraSignIn(input) {
    let current = pending || loadPending();
    if (!current) {
      setStatus("signed-out", "callback");
      error = "No sign-in is in progress — start the Entra ID sign-in again.";
      return { ok: false, error: error };
    }
    const parsed = providers.entra.parseRedirect(input);
    if (parsed.error) {
      setStatus("signed-out", "callback");
      error = parsed.errorDescription || parsed.error;
      pending = null;
      clearPendingStorage();
      return { ok: false, error };
    }
    if (!parsed.code) {
      setStatus("signed-out", "callback");
      error = "The sign-in response carried no authorization code.";
      pending = null;
      clearPendingStorage();
      return { ok: false, error };
    }
    if (parsed.state !== current.state) {
      setStatus("signed-out", "callback");
      error = "The sign-in response failed the state check (possible request forgery).";
      pending = null;
      clearPendingStorage();
      return { ok: false, error };
    }
    const result = await providers.entra.exchangeCode({ code: parsed.code, verifier: current.verifier, redirectUri: current.redirectUri });
    pending = null;
    clearPendingStorage();
    if (!result.ok) {
      setStatus("signed-out", "callback");
      error = result.error;
      return { ok: false, error };
    }
    if (current.nonce && result.tokens && result.tokens.idToken) {
      const decoded = decodeJwt(result.tokens.idToken);
      if (decoded.ok && decoded.payload.nonce && decoded.payload.nonce !== current.nonce) {
        setStatus("error", "callback");
        error = "The ID token nonce did not match the sign-in request.";
        return { ok: false, error };
      }
    }
    return establish({ tokenSet: result.tokens, providerId: "entra", providerKind: "oidc" });
  }

  async function renew({ reason = "manual" } = {}) {
    if (!tokens && !(db && db.get(collection, "current"))) {
      return { ok: false, error: "There is no session to renew." };
    }
    if (!tokens) return { ok: false, error: "The session could not be restored." };
    notify("identity.renewing");
    let result = null;
    if (tokens.refreshToken && providers.entra && providers.entra.refresh) {
      result = await providers.entra.refresh({ refreshToken: tokens.refreshToken });
    }
    if (!result || !result.ok) {
      const silent = await silentRenew();
      if (silent && silent.ok) return silent;
      setStatus("expired", reason);
      error = (result && result.error) || (silent && silent.error) || "The identity token expired and could not be renewed silently.";
      return notify("identity.expired");
    }
    return establish({ tokenSet: result.tokens, providerId: "entra", providerKind: "oidc" });
  }

  async function silentRenew() {
    if (!cfg.silentRenewal || !configured()) return { ok: false, error: "Silent renewal is not available." };
    if (!windowRef || !windowRef.document || typeof windowRef.document.createElement !== "function") return { ok: false, error: "Silent renewal needs a browser window." };
    const url = providers.entra.buildSilentUrl({ redirectUri: cfg.redirectUri || undefined });
    return new Promise((resolve) => {
      const frame = windowRef.document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.position = "absolute";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        try {
          frame.remove();
        } catch (error) {}
        resolve(value);
      };
      const timeout = timers.setTimeout ? timers.setTimeout(() => finish({ ok: false, error: "Silent renewal timed out." }), 8000) : null;
      frame.addEventListener("load", async () => {
        try {
          const parsed = providers.entra.parseRedirect(frame.contentWindow.location.href);
          if (parsed.error || !parsed.code) {
            if (timeout && timers.clearTimeout) timers.clearTimeout(timeout);
            finish({ ok: false, error: parsed.errorDescription || parsed.error || "No authorization code in the silent response." });
            return;
          }
          const exchanged = await providers.entra.exchangeCode({ code: parsed.code, verifier: null, redirectUri: cfg.redirectUri || undefined });
          if (timeout && timers.clearTimeout) timers.clearTimeout(timeout);
          if (!exchanged.ok) {
            finish({ ok: false, error: exchanged.error });
            return;
          }
          finish(await establish({ tokenSet: exchanged.tokens, providerId: "entra", providerKind: "oidc" }));
        } catch (error) {
          if (timeout && timers.clearTimeout) timers.clearTimeout(timeout);
          finish({ ok: false, error: error && error.message ? error.message : "Silent renewal failed." });
        }
      });
      frame.src = url;
      windowRef.document.body.appendChild(frame);
    });
  }

  async function signOut() {
    clearSessionState();
    setStatus("signed-out", "sign-out");
    error = null;
    await clearPersisted();
    notify("identity.signed-out");
    return { ok: true, state: snapshot() };
  }

  function checkToken() {
    if (!tokens || !claims) return { present: false, expiresAt: null, expiresInMs: null, expired: false };
    const lifetime = tokenLifetime(claims, { clock });
    return { present: true, ...lifetime };
  }

  function canDo(key) {
    return can(roles, key);
  }

  function checkPermission(key) {
    return check(roles, key);
  }

  function connect() {
    return { ...connectivityState };
  }

  function debug() {
    return {
      providerId: providers.primary ? providers.primary.id : cfg.provider,
      configured: configured(),
      endpoints: configured() ? providers.entra.endpoints() : null,
      token: tokens
        ? { hasAccessToken: !!tokens.accessToken, hasIdToken: !!tokens.idToken, hasRefreshToken: !!tokens.refreshToken, expiresAt: tokens.expiresAt, issuedAt: tokens.issuedAt, tokenType: tokens.tokenType }
        : null,
      claims: claims ? summarizeClaims(claims, cfg) : null,
      rawClaims: claims ? JSON.parse(JSON.stringify(claims)) : null,
      mapping: { ...mapping, matches: mapping.matches.slice(), unknown: mapping.unknown.slice() },
    };
  }

  function accounts() {
    return providers.simulator ? providers.simulator.accounts() : [];
  }

  function publicConfig() {
    return publicIdentityConfig(cfg);
  }

  function destroy() {
    clearRenewal();
    if (connectivityTimer && timers.clearTimeout) timers.clearTimeout(connectivityTimer);
    connectivityTimer = null;
    listeners.clear();
  }

  const api = {
    collection,
    config: cfg,
    providers,
    publicConfig,
    enabled: identityEnabled,
    configured,
    start,
    snapshot,
    subscribe(fn) {
      if (typeof fn === "function") listeners.add(fn);
      return () => listeners.delete(fn);
    },
    signInWithSimulator,
    beginEntraSignIn,
    completeEntraSignIn,
    renew,
    signOut,
    checkToken,
    can: canDo,
    check: checkPermission,
    readOnly: () => readOnly(roles),
    highestRole: () => highestRole(roles),
    roles: () => roles.slice(),
    roleLabels: () => roles.map(roleLabel),
    user: () => (user ? { ...user } : null),
    accounts,
    connectivity: connect,
    probe,
    debug,
    setConnectivity,
    notify,
    isKnownRole: (id) => knownRole(id),
    pending: () => (pending ? { ...pending } : null),
    destroy,
    hydrate: async () => {
      if (!db) return null;
      await db.ready();
      const record = db.get(collection, "current");
      if (record) await restore(record);
      return snapshot();
    },
    reset: async () => {
      if (db) await db.clear(collection);
      clearSessionState();
      setStatus("signed-out", "reset");
      return snapshot();
    },
  };

  subscribeEvents();
  return api;
}
