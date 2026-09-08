// src/auth/token-store.js
// MS365 Integration — token/session persistence.
//
// Security model: sessions are stored in the generator's OWN origin partition
// (https://<publicId>.perchance.org/<name> — the same browser partition MSAL
// uses for SPA token storage). Only code running in this generator's origin can
// read them; they are never sent to or stored on any server. Pass an injected
// `storage` for tests. Swap in sessionStorage for a stricter (tab-scoped) mode.

const SESSION_KEY = "ms365.oauth2.session";

function defaultStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch (e) {}
  try {
    if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage;
  } catch (e) {}
  return null;
}

export class TokenStore {
  constructor(storage) {
    this.storage = storage || defaultStorage();
  }

  save(session) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch (e) { return false; }
  }

  load() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.tokens || !s.tokens.accessToken) return null;
      return s;
    } catch (e) { return null; }
  }

  clear() {
    if (!this.storage) return;
    try { this.storage.removeItem(SESSION_KEY); } catch (e) {}
  }
}
