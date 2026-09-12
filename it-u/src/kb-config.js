// src/kb-config.js — reads the `kb` boot config from main.pjs (window.root.kb)
// and normalizes it into plain JS. Falls back to sensible defaults if the
// config list is absent (e.g. during isolated tests). The `kb` name is the
// retained framework identifier for the IT-U app config.

const ev = (v) => (v && typeof v === "object" && typeof v.evaluateItem !== "undefined" ? v.evaluateItem : v);

const DEFAULTS = {
  appTitle: "IT-U",
  appShortTitle: "IT-U",
  tagline: "Client documentation for a Technology Solutions Provider",
  storageNamespace: "kb-system",
  storageCeiling: 2 * 1024 * 1024,
  ssoEnabled: true,
  showSimulator: true,
};

export function getKbConfig() {
  const kb = window.root && window.root.kb;
  if (!kb) return { ...DEFAULTS };
  const ceiling = ev(kb.storageCeiling);
  return {
    appTitle: ev(kb.appTitle) || DEFAULTS.appTitle,
    appShortTitle: ev(kb.appShortTitle) || DEFAULTS.appShortTitle,
    tagline: ev(kb.tagline) || DEFAULTS.tagline,
    storageNamespace: ev(kb.storageNamespace) || DEFAULTS.storageNamespace,
    storageCeiling: Number(ceiling) > 0 ? Number(ceiling) : DEFAULTS.storageCeiling,
    // Single sign-on against an external identity provider (roadmap task 58).
    // `ssoEnabled` hides the whole feature; `showSimulator` hides only the
    // built-in, role-free demo provider.
    ssoEnabled: ev(kb.ssoEnabled) !== false,
    showSimulator: ev(kb.showSimulator) !== false,
  };
}
