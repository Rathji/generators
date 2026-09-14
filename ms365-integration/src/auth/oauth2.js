// src/auth/oauth2.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const configure = (...a) => ms365Api().oauth2.configure(...a);
export const getConfig = (...a) => ms365Api().oauth2.getConfig(...a);
export const reset = (...a) => ms365Api().oauth2.reset(...a);
export const launchAuthFlow = (...a) => ms365Api().oauth2.launchAuthFlow(...a);
export const prepareAuth = (...a) => ms365Api().oauth2.prepareAuth(...a);
export const buildAuthorizeUrl = (...a) => ms365Api().oauth2.buildAuthorizeUrl(...a);
export const handleCallback = (...a) => ms365Api().oauth2.handleCallback(...a);
export const getValidToken = (...a) => ms365Api().oauth2.getValidToken(...a);
export const refreshSession = (...a) => ms365Api().oauth2.refreshSession(...a);
export const refreshTokens = (...a) => ms365Api().oauth2.refreshTokens(...a);
export const exchangeCodeForTokens = (...a) => ms365Api().oauth2.exchangeCodeForTokens(...a);
export const saveSession = (...a) => ms365Api().oauth2.saveSession(...a);
export const loadSession = (...a) => ms365Api().oauth2.loadSession(...a);
export const clearSession = (...a) => ms365Api().oauth2.clearSession(...a);
export const onSessionChange = (...a) => ms365Api().oauth2.onSessionChange(...a);
export const onSessionExpired = (...a) => ms365Api().oauth2.onSessionExpired(...a);
export const scheduleAutoRefresh = (...a) => ms365Api().oauth2.scheduleAutoRefresh(...a);
export const stopAutoRefresh = (...a) => ms365Api().oauth2.stopAutoRefresh(...a);
export const profileFromIdToken = (...a) => ms365Api().oauth2.profileFromIdToken(...a);
export const decodeJwtPayload = (...a) => ms365Api().oauth2.decodeJwtPayload(...a);
export const generateCodeVerifier = (...a) => ms365Api().oauth2.generateCodeVerifier(...a);
export const generateState = (...a) => ms365Api().oauth2.generateState(...a);
export const computeCodeChallenge = (...a) => ms365Api().oauth2.computeCodeChallenge(...a);
export const storageKeys = (...a) => ms365Api().oauth2.storageKeys(...a);
export const relayRedirect = (...a) => ms365Api().oauth2.relayRedirect(...a);
