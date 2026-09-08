// src/health/connection-check.js
// Connection Health Check.
// Verifies end-to-end connectivity: obtains a valid token (refreshing if
// requested/needed) and pings the Graph /me endpoint, reporting latency, token
// status, granted scopes and the signed-in user's profile. Also exposes a
// throw-on-failure assertion helper for gating feature calls.
//
// Requires scope: User.Read (or any scope — /me works with a basic profile).

import { getValidToken, loadSession, getConfig } from "../auth/oauth2.js";
import { graphGet } from "../graph/graph-client.js";

const ME_SELECT = ["id", "displayName", "userPrincipalName", "mail", "userType", "mailboxSettings"].join(",");

// Run a connectivity check.
//   opts: { forceRefresh, fetchImpl, maxRetries }
// Returns:
//   { ok, latencyMs, tokenStatus ("valid"|"refreshed"|"none"|"expired"),
//     scopes, user: {id, displayName, upn, mail, userType, mailboxSettings} | null,
//     error: {code, message, friendly, category} | null }
export async function testConnection(opts = {}) {
  const t0 = performance.now();
  const session = loadSession();
  let token = null;
  let tokenStatus = "none";

  if (session && session.tokens && session.tokens.accessToken) {
    const t = session.tokens;
    const expired = (t.expiresAt || 0) <= Date.now();
    if (opts.forceRefresh || expired) {
      token = await getValidToken({ force: true });
      tokenStatus = token ? "refreshed" : (expired ? "expired" : "none");
    } else {
      token = t.accessToken;
      tokenStatus = "valid";
    }
  }

  const scopes = (session && session.tokens && session.tokens.scope && session.tokens.scope.length)
    ? session.tokens.scope
    : (getConfig() ? getConfig().scopes : []);

  if (!token) {
    const err = new Error("ms365.health: not connected — no valid access token.");
    err.code = "not_authenticated";
    err.category = "auth";
    err.friendly = "Not signed in — connect your Microsoft account first.";
    return { ok: false, latencyMs: 0, tokenStatus, scopes, user: null, error: err };
  }

  try {
    const me = await graphGet("/me", {
      query: { $select: ME_SELECT },
      fetchImpl: opts.fetchImpl,
      maxRetries: opts.maxRetries,
    });
    const latencyMs = Math.round(performance.now() - t0);
    return {
      ok: true,
      latencyMs,
      tokenStatus,
      scopes,
      user: {
        id: me.id || null,
        displayName: me.displayName || null,
        upn: me.userPrincipalName || null,
        mail: me.mail || null,
        userType: me.userType || null,
        mailboxSettings: me.mailboxSettings || null,
      },
      error: null,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    return {
      ok: false,
      latencyMs,
      tokenStatus,
      scopes,
      user: null,
      error: {
        code: err.code || "unknown",
        message: err.message,
        friendly: err.friendly || err.message,
        category: err.category || null,
        status: err.status || null,
      },
    };
  }
}

// Throws a friendly error when the connection is not healthy; otherwise
// returns the testConnection result. Good as a guard at the top of feature
// calls that require a live session.
export async function assertConnected(opts = {}) {
  const res = await testConnection(opts);
  if (!res.ok) {
    const err = new Error(res.error.friendly || res.error.message);
    err.code = res.error.code;
    err.category = res.error.category;
    err.connection = res;
    throw err;
  }
  return res;
}
